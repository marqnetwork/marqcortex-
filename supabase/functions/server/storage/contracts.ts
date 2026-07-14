/**
 * Canonical storage contracts — diagnostic domain (MCV2-S7.2-IMPLEMENT-007)
 *
 * Provider/storage-neutral types shared by the diagnostic storage gateway,
 * the KV adapter, configuration, and telemetry.
 *
 * Design constraints (Phase 1):
 *   - No Supabase-specific types leak upstream through these contracts.
 *   - Route handlers consume `ReadResult<T>` and never raw KV/SQL rows.
 *   - Only `kv_only` is an active read mode this phase; other modes are
 *     represented for forward-compatibility but are inert.
 *   - Written to be importable by both Deno (runtime) and Node's
 *     `--experimental-strip-types` test runner: no `enum`, no TS parameter
 *     properties, type-only imports erased.
 */

// ---------------------------------------------------------------------------
// Storage source
// ---------------------------------------------------------------------------

export const StorageSource = {
  KV: 'kv',
  SQL: 'sql',
} as const;
export type StorageSource = (typeof StorageSource)[keyof typeof StorageSource];

// ---------------------------------------------------------------------------
// Read modes — only KV_ONLY is active in Phase 1
// ---------------------------------------------------------------------------

export const ReadMode = {
  KV_ONLY: 'kv_only',
  KV_PRIMARY_SHADOW_SQL: 'kv_primary_shadow_sql',
  SQL_PRIMARY_KV_FALLBACK: 'sql_primary_kv_fallback',
  SQL_ONLY: 'sql_only',
  DISABLED: 'disabled',
} as const;
export type ReadMode = (typeof ReadMode)[keyof typeof ReadMode];

/** The only mode the Phase 1 runtime can actually execute. */
export const ACTIVE_READ_MODE: ReadMode = ReadMode.KV_ONLY;

/** Modes that are recognised as valid configuration values. */
export const KNOWN_READ_MODES: readonly ReadMode[] = [
  ReadMode.KV_ONLY,
  ReadMode.KV_PRIMARY_SHADOW_SQL,
  ReadMode.SQL_PRIMARY_KV_FALLBACK,
  ReadMode.SQL_ONLY,
  ReadMode.DISABLED,
];

// ---------------------------------------------------------------------------
// Diagnostic entities in scope for Phase 1
// ---------------------------------------------------------------------------

export const DiagnosticEntity = {
  SUBMISSION: 'submission',
  SUBMISSION_LIST: 'submission_list',
  OUTCOME: 'outcome',
  REPORT: 'report',
  LEAD: 'lead',
} as const;
export type DiagnosticEntity = (typeof DiagnosticEntity)[keyof typeof DiagnosticEntity];

// ---------------------------------------------------------------------------
// Actor + read context
// ---------------------------------------------------------------------------

export type ActorKind = 'team' | 'client' | 'public';

export interface ReadActor {
  kind: ActorKind;
  id?: string | null;
}

/**
 * Server-resolved context for a read. `organizationId` and `actor` are set by
 * the route handler and are NEVER derived from client-supplied source hints.
 */
export interface ReadContext {
  requestId: string;
  organizationId?: string | null;
  actor: ReadActor;
  route: string;
  entity: DiagnosticEntity;
}

// ---------------------------------------------------------------------------
// Read result
// ---------------------------------------------------------------------------

export interface ReadResult<T> {
  /** Canonical business data — identical shape to the pre-gateway value. */
  data: T | null;
  /** Whether the underlying store held a record for the key. */
  found: boolean;
  /** Which store served the returned value. Always KV in Phase 1. */
  returnedSource: StorageSource;
  /** Mode actually executed (after fail-safe resolution). Always KV_ONLY in Phase 1. */
  mode: ReadMode;
  /** Internal latency metadata; not serialised into API responses. */
  latency: { kvMs?: number; sqlMs?: number };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type StorageReadErrorCode =
  | 'KV_READ_ERROR'
  | 'INVALID_MODE'
  | 'UNSUPPORTED_MODE'
  | 'ADAPTER_ERROR';

/**
 * Error raised by the storage layer. Carries a stable `code` and the original
 * `cause` so route handlers can reproduce their existing error envelopes.
 * (No TS parameter properties — kept strip-types friendly.)
 */
export class StorageReadError extends Error {
  code: StorageReadErrorCode;
  cause?: unknown;

  constructor(message: string, code: StorageReadErrorCode, cause?: unknown) {
    super(message);
    this.name = 'StorageReadError';
    this.code = code;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// KV port + adapter contracts
// ---------------------------------------------------------------------------

/**
 * Minimal read surface of the KV helper the diagnostic reads depend on.
 * `kv_store.tsx` already satisfies this structurally, so the runtime injects
 * the real module and tests inject an in-memory fake — no Deno import here.
 */
export interface KvDiagnosticPort {
  get(key: string): Promise<unknown>;
  getByPrefix(prefix: string): Promise<unknown[]>;
}

/** Canonical KV read operations for the diagnostic domain. */
export interface KvDiagnosticAdapter {
  getSubmission(id: string): Promise<{ data: unknown; found: boolean }>;
  listSubmissions(): Promise<{ data: unknown[]; found: boolean }>;
  getOutcome(submissionId: string): Promise<{ data: unknown; found: boolean }>;
}

// ---------------------------------------------------------------------------
// Gateway contract
// ---------------------------------------------------------------------------

export interface DiagnosticStorageGateway {
  getSubmission(id: string, ctx: ReadContext): Promise<ReadResult<unknown>>;
  listSubmissions(ctx: ReadContext): Promise<ReadResult<unknown[]>>;
  getOutcome(submissionId: string, ctx: ReadContext): Promise<ReadResult<unknown>>;
}

// ---------------------------------------------------------------------------
// Feature configuration contract
// ---------------------------------------------------------------------------

/** Resolved, per-entity storage configuration. */
export interface StorageConfig {
  /** Master gate. When false, every entity is forced to KV_ONLY. */
  dualReadEnabled: boolean;
  /** Effective per-entity mode (already fail-safe resolved). */
  modeByEntity: Record<DiagnosticEntity, ReadMode>;
  /** Telemetry emission toggle. Disabled by default. */
  telemetryEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Telemetry contract
// ---------------------------------------------------------------------------

export interface StorageReadTelemetryEvent {
  requestId: string;
  entity: DiagnosticEntity;
  configuredMode: ReadMode;
  returnedSource: StorageSource;
  kvMs?: number;
  sqlMs?: number;
  errorClass?: string;
  route: string;
  organizationId?: string | null;
}

/**
 * Telemetry sink. Implementations MUST NOT throw to callers and MUST NOT
 * receive raw payloads or secrets — only the approved identifiers above.
 */
export interface StorageTelemetrySink {
  readonly enabled: boolean;
  emit(event: StorageReadTelemetryEvent): void;
}
