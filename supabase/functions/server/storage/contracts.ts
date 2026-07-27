/**
 * Canonical storage contracts — diagnostic domain (MCV2-S7.2-IMPLEMENT-007)
 *
 * Provider/storage-neutral types shared by the diagnostic storage gateway,
 * the KV adapter, configuration, telemetry, and the Outcome shadow read.
 *
 * MCV2-S7.4-REMEDIATION (gaps G1/G3/G4/G6):
 *   - Comparison statuses collapsed to the canonical, distinct set the audit
 *     requires: match, mismatch, partial, missing_sql, missing_kv, skipped,
 *     error (G3 adds `partial`).
 *   - Background scheduling + durable telemetry contracts added (G1/G4).
 *
 * Design constraints:
 *   - No Supabase-specific types leak upstream through these contracts.
 *   - Route handlers consume `ReadResult<T>` and never raw KV/SQL rows.
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
// Read modes — only KV_ONLY is active
// ---------------------------------------------------------------------------

export const ReadMode = {
  KV_ONLY: 'kv_only',
  KV_PRIMARY_SHADOW_SQL: 'kv_primary_shadow_sql',
  SQL_PRIMARY_KV_FALLBACK: 'sql_primary_kv_fallback',
  SQL_ONLY: 'sql_only',
  DISABLED: 'disabled',
} as const;
export type ReadMode = (typeof ReadMode)[keyof typeof ReadMode];

/** The only mode the runtime can actually execute. KV stays authoritative. */
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
// Diagnostic entities in scope
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
  /** Which store served the returned value. Always KV. */
  returnedSource: StorageSource;
  /** Mode actually executed (after fail-safe resolution). Always KV_ONLY. */
  mode: ReadMode;
  /** Internal latency metadata; not serialised into API responses. */
  latency: { kvMs?: number; sqlMs?: number };
  /**
   * Coarse shadow disposition for this read (MCV2-S7.4). `null` when no shadow
   * was applicable (non-outcome entities). For outcome reads it is `skipped`
   * when the shadow was ineligible, or `scheduled` when a background shadow was
   * handed to the scheduler. The authoritative `data`/`returnedSource` stay KV
   * regardless.
   */
  shadowStatus?: ShadowDisposition | null;
  /**
   * Test/telemetry-only handle to the scheduled shadow comparison. Present only
   * when a shadow was scheduled. It ALWAYS resolves (never rejects). The route
   * never awaits it; tests await it to inspect the comparison. SQL is never
   * returned to callers — `data`/`returnedSource` stay KV.
   */
  shadow?: Promise<OutcomeComparison>;
}

export type ShadowDisposition = 'skipped' | 'scheduled';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type StorageReadErrorCode =
  | 'KV_READ_ERROR'
  | 'INVALID_MODE'
  | 'UNSUPPORTED_MODE'
  | 'ADAPTER_ERROR';

export class StorageReadError extends Error {
  code: StorageReadErrorCode;
  override cause?: unknown;

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

export interface KvDiagnosticPort {
  get(key: string): Promise<unknown>;
  getByPrefix(prefix: string): Promise<unknown[]>;
}

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

export interface StorageConfig {
  dualReadEnabled: boolean;
  modeByEntity: Record<DiagnosticEntity, ReadMode>;
  telemetryEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Background scheduling contract (MCV2-S7.4 · G1)
// ---------------------------------------------------------------------------

/**
 * Post-response background scheduler. Implementations MUST return synchronously
 * (never block the response path) and MUST NOT allow a scheduled task's failure
 * to surface to the caller.
 */
export interface BackgroundScheduler {
  /** The name of the scheduling strategy actually in effect (for telemetry/tests). */
  readonly strategy: 'edge_wait_until' | 'detached';
  /** Hand a task off to run after the response. Returns immediately. */
  schedule(task: () => Promise<unknown>): void;
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
  // --- shadow-read fields (MCV2-S7.4, Outcome only; absent when no shadow) ---
  shadowAttempted?: boolean;
  comparisonStatus?: ComparisonStatus;
  mismatchCount?: number;
  mismatchFields?: string[];
  mismatchSeverity?: MismatchSeverity;
  sqlErrorClass?: string;
  environment?: string;
}

/**
 * Telemetry sink. Implementations MUST NOT throw to callers and MUST NOT
 * receive raw payloads or secrets — only the approved identifiers above.
 */
export interface StorageTelemetrySink {
  readonly enabled: boolean;
  emit(event: StorageReadTelemetryEvent): void;
}

// ---------------------------------------------------------------------------
// Durable telemetry contract (MCV2-S7.4 · G4)
// ---------------------------------------------------------------------------

/**
 * The minimal aggregate row the durable sink persists. Keyed by
 * (domain, status, mismatchFields); the store increments occurrenceCount and
 * advances lastObservedAt on repeat observations (restart-safe, cross-instance).
 */
export interface ShadowTelemetryAggregateKey {
  domain: string;
  status: ComparisonStatus;
  mismatchFields: string[];
}

export interface ShadowTelemetryAggregate extends ShadowTelemetryAggregateKey {
  occurrenceCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

/**
 * Durable aggregation port. The concrete implementation is a Supabase-backed
 * repository (Deno-only). Tests inject an in-memory fake. `record` performs an
 * atomic upsert-increment and MUST reject on failure so the caller can fall
 * back to structured logs — but it is always invoked from a background task, so
 * a rejection never reaches the response path.
 */
export interface ShadowTelemetryRepository {
  record(key: ShadowTelemetryAggregateKey): Promise<void>;
}

// ---------------------------------------------------------------------------
// Outcome shadow-read contracts (MCV2-S7.4) — Outcome ENTITY ONLY
// ---------------------------------------------------------------------------

/**
 * Canonical comparison statuses (MCV2-S7.4-REMEDIATION · G3). Each value is
 * distinct and mutually exclusive:
 *   - match       KV and SQL agree on every populated comparable field
 *   - mismatch    a comparable field is populated on BOTH sides but differs
 *   - partial     SQL row exists but a field KV populated is null/absent in SQL
 *   - missing_sql KV present, SQL row absent
 *   - missing_kv  SQL present, KV record absent
 *   - skipped     shadow ineligible / not executed
 *   - error       SQL read failed or timed out
 */
export const ComparisonStatus = {
  MATCH: 'match',
  MISMATCH: 'mismatch',
  PARTIAL: 'partial',
  MISSING_SQL: 'missing_sql',
  MISSING_KV: 'missing_kv',
  SKIPPED: 'skipped',
  ERROR: 'error',
} as const;
export type ComparisonStatus = (typeof ComparisonStatus)[keyof typeof ComparisonStatus];

export type MismatchSeverity = 'info' | 'low' | 'high' | 'critical';

/** Canonical, business-critical Outcome shape used for KV↔SQL comparison. */
export interface OutcomeDTO {
  submissionId: string | null;
  didConvert: boolean | null;
  conversionValue: number | null;
  lostReason: string | null;
  recommendationWorked: boolean | null;
  whatWeLearned: string | null;
  improvementAreas: string[];
  status: string | null;
}

export interface OutcomeComparison {
  status: ComparisonStatus;
  requestId: string;
  organizationId: string | null;
  entityType: 'outcome';
  entityRefHash: string; // hashed reference — never a raw id/payload
  kvMs?: number;
  sqlMs?: number;
  mismatchCount: number;
  mismatchFields: string[]; // field paths only — never values
  severity: MismatchSeverity;
  comparisonTimestamp: string;
  sqlErrorClass?: string;
}

/**
 * Minimal read surface of the Outcome SQL repository the shadow read needs.
 * The concrete repository (which imports `jsr:@supabase/...`) is adapted to
 * this port by a Deno-only runtime module, so pure/tested code never imports
 * Supabase. Tenant scope is mandatory.
 */
export interface OutcomeSqlPort {
  getOutcomeBySubmission(submissionId: string, organizationId: string): Promise<unknown>;
}
