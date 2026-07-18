/**
 * Runtime Storage Gateway (MCV2-S7.4 → S7.8) — public surface.
 *
 * Reads stay authoritative from KV; shadow reads compare the SQL repositories
 * against KV and emit drift telemetry, without changing what callers receive.
 */
export { shadowRead, shadowReadWithReport, consoleTelemetry } from './gateway.ts';
export type { ShadowReadOptions } from './gateway.ts';
export { diffProjections } from './drift.ts';
export { RUNTIME_STORAGE_AUTHORITY, isShadowReadEnabled } from './config.ts';
export {
  shadowReadOutcome,
  shadowReadLeadByEmail,
  shadowReadSubmission,
} from './shadowReads.ts';
export type {
  ShadowDomain,
  StorageAuthority,
  DriftReport,
  DriftField,
  DriftStatus,
  DriftTelemetry,
} from './types.ts';
