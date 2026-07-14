/**
 * Diagnostic storage gateway — public surface (MCV2-S7.2-IMPLEMENT-007)
 *
 * Barrel exports + the runtime composition factory used by index.tsx.
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
  OUTCOME_IGNORED_FIELDS,
} from './outcomeNormalize.ts';
export { compareOutcome, outcomeErrorComparison, hashEntityRef } from './outcomeCompare.ts';

import type {
  DiagnosticStorageGateway,
  KvDiagnosticPort,
  OutcomeSqlPort,
  ReadActor,
  ReadContext,
  DiagnosticEntity,
  StorageTelemetrySink,
} from './contracts.ts';
import { createKvDiagnosticAdapter } from './kvAdapter.ts';
import { createDiagnosticStorageGateway } from './gateway.ts';
import { createNoopTelemetrySink } from './telemetry.ts';
import { readRuntimeStorageConfig, readRuntimeOutcomeShadowConfig } from './config.ts';

/**
 * Compose the runtime diagnostic gateway from the live KV helper. Reads config
 * from the ambient environment. KV is authoritative and the returned source.
 *
 * `opts.sqlOutcomePort` (Deno-only, service-role backed) enables the Outcome
 * SHADOW read when — and only when — `STORAGE_SHADOW_OUTCOME_ENABLED=true` and
 * the kill switch is off. It is never imported here, so this barrel stays
 * Node-testable and free of Supabase imports.
 */
export function createRuntimeDiagnosticGateway(
  kv: KvDiagnosticPort,
  opts?: { sqlOutcomePort?: OutcomeSqlPort; telemetry?: StorageTelemetrySink },
): DiagnosticStorageGateway {
  return createDiagnosticStorageGateway({
    kvAdapter: createKvDiagnosticAdapter(kv),
    config: readRuntimeStorageConfig(),
    telemetry: opts?.telemetry ?? createNoopTelemetrySink(),
    sqlOutcomePort: opts?.sqlOutcomePort,
    outcomeShadow: readRuntimeOutcomeShadowConfig(),
  });
}

/**
 * Small helper to build a ReadContext inside route handlers. `organizationId`
 * and `actor` are server-resolved by the caller; `requestId` is generated here
 * if not supplied.
 */
export function buildReadContext(params: {
  route: string;
  entity: DiagnosticEntity;
  actor: ReadActor;
  organizationId?: string | null;
  requestId?: string;
}): ReadContext {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?(): string } }).crypto;
  const requestId =
    params.requestId ??
    (cryptoObj && typeof cryptoObj.randomUUID === 'function'
      ? cryptoObj.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  return {
    requestId,
    organizationId: params.organizationId ?? null,
    actor: params.actor,
    route: params.route,
    entity: params.entity,
  };
}
