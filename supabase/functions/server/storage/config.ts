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
