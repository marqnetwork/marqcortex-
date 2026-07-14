/**
 * Storage read-mode configuration — diagnostic domain (MCV2-S7.2-IMPLEMENT-007)
 *
 * Server-side only. Resolves per-entity read modes from environment variables
 * with a hard fail-safe to KV_ONLY. There is NO frontend control and NO
 * user-supplied source switching.
 *
 * Phase 1 invariant: even when a flag names a future SQL mode, the gateway
 * cannot execute it (no SQL adapter exists), so `resolveActiveMode` clamps
 * every entity to KV_ONLY. Flags are parsed and surfaced for forward-compat
 * only.
 *
 * Environment variables (all optional; safe defaults shown):
 *   STORAGE_DUAL_READ_ENABLED   master gate           default "false"
 *   STORAGE_MODE_SUBMISSION     per-entity mode       default "kv_only"
 *   STORAGE_MODE_OUTCOME        per-entity mode       default "kv_only"
 *   STORAGE_MODE_REPORT         per-entity mode       default "kv_only"
 *   STORAGE_MODE_LEAD           per-entity mode       default "kv_only"
 *   STORAGE_READ_TELEMETRY_ENABLED  telemetry toggle  default "false"
 *
 * Precedence (highest wins):
 *   1. STORAGE_DUAL_READ_ENABLED=false  -> force KV_ONLY for every entity (kill switch)
 *   2. Unknown / malformed per-entity value -> KV_ONLY (fail safe)
 *   3. Per-entity STORAGE_MODE_*
 *   4. Global default KV_ONLY
 * Phase 1 additionally clamps any non-KV_ONLY resolved mode to KV_ONLY.
 */

import {
  ACTIVE_READ_MODE,
  DiagnosticEntity,
  KNOWN_READ_MODES,
  ReadMode,
  type StorageConfig,
} from './contracts.ts';

export type EnvSource = Record<string, string | undefined> | { get(key: string): string | undefined };

export const STORAGE_ENV_KEYS = {
  DUAL_READ_ENABLED: 'STORAGE_DUAL_READ_ENABLED',
  MODE_SUBMISSION: 'STORAGE_MODE_SUBMISSION',
  MODE_OUTCOME: 'STORAGE_MODE_OUTCOME',
  MODE_REPORT: 'STORAGE_MODE_REPORT',
  MODE_LEAD: 'STORAGE_MODE_LEAD',
  TELEMETRY_ENABLED: 'STORAGE_READ_TELEMETRY_ENABLED',
  // --- Outcome shadow-read (MCV2-S7.4) ---
  FORCE_KV_ONLY: 'STORAGE_FORCE_KV_ONLY',
  SHADOW_OUTCOME_ENABLED: 'STORAGE_SHADOW_OUTCOME_ENABLED',
  SHADOW_OUTCOME_ORG_ALLOWLIST: 'STORAGE_SHADOW_OUTCOME_ORG_ALLOWLIST',
  SHADOW_DEFAULT_ORG_ID: 'STORAGE_SHADOW_DEFAULT_ORG_ID',
  SHADOW_SQL_TIMEOUT_MS: 'STORAGE_SHADOW_SQL_TIMEOUT_MS',
  ENVIRONMENT: 'STORAGE_ENVIRONMENT',
} as const;

function readEnv(source: EnvSource | undefined, key: string): string | undefined {
  if (!source) return undefined;
  if (typeof (source as { get?: unknown }).get === 'function') {
    return (source as { get(k: string): string | undefined }).get(key);
  }
  return (source as Record<string, string | undefined>)[key];
}

/** Parse a boolean flag; anything that is not exactly "true" is false. */
function parseBool(raw: string | undefined): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'true';
}

/**
 * Parse a configured mode string into a known ReadMode, or KV_ONLY if the
 * value is missing/unknown/malformed (fail safe).
 */
export function parseReadMode(raw: string | undefined): ReadMode {
  const normalized = String(raw ?? '').trim().toLowerCase();
  const match = KNOWN_READ_MODES.find((m) => m === normalized);
  return (match ?? ReadMode.KV_ONLY) as ReadMode;
}

/**
 * Read the raw, unclamped configuration from the environment. Useful for
 * diagnostics/telemetry. Does NOT apply the Phase 1 KV_ONLY clamp.
 */
export function readStorageConfig(source?: EnvSource): StorageConfig {
  const dualReadEnabled = parseBool(readEnv(source, STORAGE_ENV_KEYS.DUAL_READ_ENABLED));
  const telemetryEnabled = parseBool(readEnv(source, STORAGE_ENV_KEYS.TELEMETRY_ENABLED));

  const submissionMode = parseReadMode(readEnv(source, STORAGE_ENV_KEYS.MODE_SUBMISSION));
  const outcomeMode = parseReadMode(readEnv(source, STORAGE_ENV_KEYS.MODE_OUTCOME));
  const reportMode = parseReadMode(readEnv(source, STORAGE_ENV_KEYS.MODE_REPORT));
  const leadMode = parseReadMode(readEnv(source, STORAGE_ENV_KEYS.MODE_LEAD));

  // Kill switch: master gate off forces KV_ONLY regardless of per-entity flags.
  const clampMaster = (mode: ReadMode): ReadMode => (dualReadEnabled ? mode : ReadMode.KV_ONLY);

  const modeByEntity: Record<DiagnosticEntity, ReadMode> = {
    [DiagnosticEntity.SUBMISSION]: clampMaster(submissionMode),
    [DiagnosticEntity.SUBMISSION_LIST]: clampMaster(submissionMode),
    [DiagnosticEntity.OUTCOME]: clampMaster(outcomeMode),
    [DiagnosticEntity.REPORT]: clampMaster(reportMode),
    [DiagnosticEntity.LEAD]: clampMaster(leadMode),
  };

  return { dualReadEnabled, modeByEntity, telemetryEnabled };
}

/**
 * Resolve the mode the gateway will ACTUALLY execute for an entity.
 *
 * Phase 1: the runtime has no SQL path, so any resolved mode other than
 * KV_ONLY is clamped down to KV_ONLY (the only active mode). This makes the
 * gateway safe even if a future flag is set prematurely.
 */
export function resolveActiveMode(config: StorageConfig, entity: DiagnosticEntity): ReadMode {
  const configured = config.modeByEntity[entity] ?? ReadMode.KV_ONLY;
  if (configured === ACTIVE_READ_MODE) return ACTIVE_READ_MODE;
  // Non-active mode requested but not executable this phase -> fail safe.
  return ReadMode.KV_ONLY;
}

/**
 * Read configuration from the ambient runtime environment. Guards `Deno`
 * access so the module also loads under Node (tests), where it returns the
 * safe defaults (all KV_ONLY, telemetry off).
 */
export function readRuntimeStorageConfig(): StorageConfig {
  const denoEnv = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
  if (denoEnv && typeof denoEnv.get === 'function') {
    return readStorageConfig({ get: (k: string) => denoEnv.get(k) });
  }
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (processEnv) {
    return readStorageConfig(processEnv);
  }
  return readStorageConfig(undefined);
}

// ---------------------------------------------------------------------------
// Outcome shadow-read configuration (MCV2-S7.4) — Outcome ENTITY ONLY
// ---------------------------------------------------------------------------

export interface OutcomeShadowConfig {
  /** Master shadow toggle for Outcome. Disabled by default. */
  enabled: boolean;
  /** Global kill switch: when true, forces KV-only and disables all shadow. */
  forceKvOnly: boolean;
  /** Org allowlist. Empty = no org restriction (still gated by `enabled`). */
  orgAllowlist: string[];
  /** Default org id used to scope the SQL shadow when the request org is null. */
  defaultOrgId: string | null;
  /** Hard SQL read timeout (ms). */
  sqlTimeoutMs: number;
  /** Environment label for telemetry. */
  environment: string | null;
}

function parseCsv(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseTimeout(raw: string | undefined): number {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 250; // safe default
  return Math.min(n, 2000); // hard cap
}

/**
 * Read Outcome shadow config. Invalid/missing values resolve to the safe
 * (disabled) state. There is no frontend control and no request-parameter
 * activation — this reads server env only.
 */
export function readOutcomeShadowConfig(source?: EnvSource): OutcomeShadowConfig {
  const forceKvOnly = parseBool(readEnv(source, STORAGE_ENV_KEYS.FORCE_KV_ONLY));
  return {
    enabled: parseBool(readEnv(source, STORAGE_ENV_KEYS.SHADOW_OUTCOME_ENABLED)) && !forceKvOnly,
    forceKvOnly,
    orgAllowlist: parseCsv(readEnv(source, STORAGE_ENV_KEYS.SHADOW_OUTCOME_ORG_ALLOWLIST)),
    defaultOrgId: readEnv(source, STORAGE_ENV_KEYS.SHADOW_DEFAULT_ORG_ID)?.trim() || null,
    sqlTimeoutMs: parseTimeout(readEnv(source, STORAGE_ENV_KEYS.SHADOW_SQL_TIMEOUT_MS)),
    environment: readEnv(source, STORAGE_ENV_KEYS.ENVIRONMENT)?.trim() || null,
  };
}

export function readRuntimeOutcomeShadowConfig(): OutcomeShadowConfig {
  const denoEnv = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
  if (denoEnv && typeof denoEnv.get === 'function') {
    return readOutcomeShadowConfig({ get: (k: string) => denoEnv.get(k) });
  }
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (processEnv) return readOutcomeShadowConfig(processEnv);
  return readOutcomeShadowConfig(undefined);
}

export interface OutcomeShadowEligibility {
  eligible: boolean;
  /** Server-resolved org to scope the SQL query. Null when ineligible. */
  effectiveOrg: string | null;
  reason: string;
}

/**
 * Decide whether an Outcome shadow read may execute. Fails closed on any
 * uncertainty. `hasSqlPort` reflects whether an SQL port was wired at runtime.
 */
export function resolveOutcomeShadowEligibility(
  config: OutcomeShadowConfig,
  params: { organizationId: string | null; hasSqlPort: boolean },
): OutcomeShadowEligibility {
  const ineligible = (reason: string): OutcomeShadowEligibility => ({ eligible: false, effectiveOrg: null, reason });

  if (config.forceKvOnly) return ineligible('kill_switch');
  if (!config.enabled) return ineligible('disabled');
  if (!params.hasSqlPort) return ineligible('no_sql_port');

  const effectiveOrg = params.organizationId ?? config.defaultOrgId;
  if (!effectiveOrg) return ineligible('no_org_scope');

  if (config.orgAllowlist.length > 0 && !config.orgAllowlist.includes(effectiveOrg)) {
    return ineligible('org_not_allowlisted');
  }
  return { eligible: true, effectiveOrg, reason: 'eligible' };
}
