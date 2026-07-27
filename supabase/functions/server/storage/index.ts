/**
 * Diagnostic storage gateway — public surface
 * (MCV2-S7.2-IMPLEMENT-007 · MCV2-S7.4 · MCV2-S7.4-REMEDIATION)
 *
 * Barrel exports + the runtime composition factory used by index.tsx.
 *
 * NOTE: This barrel is deliberately Supabase-free so it stays Node-testable.
 * The Deno-only runtime bridges (`runtimeSqlOutcome.ts`,
 * `runtimeShadowTelemetry.ts`) are imported directly by the edge entrypoint,
 * never from here.
 */

export * from './contracts.ts';
export { createKvDiagnosticAdapter } from './kvAdapter.ts';
export { createDiagnosticStorageGateway, type GatewayDeps } from './gateway.ts';
export {
  createNoopTelemetrySink,
  createInMemoryTelemetrySink,
  safeEmit,
} from './telemetry.ts';
export {
  createDurableTelemetrySink,
  createInMemoryShadowTelemetryRepository,
  aggregateKeyString,
  type DurableTelemetryDeps,
} from './durableTelemetry.ts';
export {
  createBackgroundScheduler,
  resolveEdgeWaitUntil,
  type WaitUntil,
} from './scheduler.ts';
export {
  STORAGE_ENV_KEYS,
  parseReadMode,
  readStorageConfig,
  resolveActiveMode,
  readRuntimeStorageConfig,
  readOutcomeShadowConfig,
  readRuntimeOutcomeShadowConfig,
  resolveOutcomeShadowEligibility,
  type EnvSource,
  type OutcomeShadowConfig,
  type OutcomeShadowEligibility,
} from './config.ts';
export { safeJsonParse, parseSubmissions, sortSubmissionsBySubmittedAtDesc } from './kvParse.ts';
export { createSqlOutcomeAdapter, type SqlOutcomeAdapter } from './sqlOutcomeAdapter.ts';
export {
  normalizeKvOutcome,
  normalizeSqlOutcome,
  projectOutcomeRecord,
  OUTCOME_IGNORED_FIELDS,
  SQL_LIFECYCLE_STATUSES,
} from './outcomeNormalize.ts';
export {
  compareOutcome,
  outcomeErrorComparison,
  outcomeSkippedComparison,
  hashEntityRef,
  type CompareMeta,
} from './outcomeCompare.ts';
export { handleGetOutcome, OUTCOME_ROUTE, type OutcomeRouteResult } from './outcomeRoute.ts';
export { buildReadContext } from './context.ts';

import type {
  BackgroundScheduler,
  DiagnosticStorageGateway,
  KvDiagnosticPort,
  OutcomeSqlPort,
  StorageTelemetrySink,
} from './contracts.ts';
import { createKvDiagnosticAdapter } from './kvAdapter.ts';
import { createDiagnosticStorageGateway } from './gateway.ts';
import { createNoopTelemetrySink } from './telemetry.ts';
import { createBackgroundScheduler } from './scheduler.ts';
import { readRuntimeStorageConfig, readRuntimeOutcomeShadowConfig } from './config.ts';

/**
 * Compose the runtime diagnostic gateway from the live KV helper. Reads config
 * from the ambient environment. KV is authoritative and the returned source.
 *
 * `opts.sqlOutcomePort` (Deno-only, service-role backed) enables the Outcome
 * SHADOW read when — and only when — `STORAGE_SHADOW_OUTCOME_ENABLED=true` and
 * the kill switch is off. `opts.telemetry` supplies the durable sink. Neither is
 * imported here, so this barrel stays Node-testable and Supabase-free.
 */
export function createRuntimeDiagnosticGateway(
  kv: KvDiagnosticPort,
  opts?: {
    sqlOutcomePort?: OutcomeSqlPort;
    telemetry?: StorageTelemetrySink;
    scheduler?: BackgroundScheduler;
  },
): DiagnosticStorageGateway {
  return createDiagnosticStorageGateway({
    kvAdapter: createKvDiagnosticAdapter(kv),
    config: readRuntimeStorageConfig(),
    telemetry: opts?.telemetry ?? createNoopTelemetrySink(),
    scheduler: opts?.scheduler ?? createBackgroundScheduler(),
    sqlOutcomePort: opts?.sqlOutcomePort,
    outcomeShadow: readRuntimeOutcomeShadowConfig(),
  });
}
