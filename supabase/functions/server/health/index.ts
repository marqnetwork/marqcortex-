/**
 * The Operational Health Framework — blueprint §IV-51.
 *
 * Rolls health signals the platform already publishes up to the four approved
 * dimensions. No SLOs, no thresholds, no alerting, no dashboard: §IV-51 defers
 * monitoring instrumentation and §IV-48 puts numeric targets out of scope, so a
 * framework that invented either would be inventing product.
 */

export type {
  DimensionHealth,
  EnterpriseHealth,
  HealthDimension,
  HealthSignal,
  HealthSignalSource,
  HealthState,
} from './contracts.ts';
export { HEALTH_DIMENSIONS, HEALTH_SEVERITY } from './contracts.ts';
export { buildEnterpriseHealth, rollUpDimension, worse } from './rollup.ts';
export {
  aiControlPlaneSource,
  aiGovernanceSource,
  governanceFrameSource,
  productProgressionSource,
  shadowReadSource,
  storageSource,
} from './sources.ts';
