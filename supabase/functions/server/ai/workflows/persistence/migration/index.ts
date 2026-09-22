/**
 * The BP-004 workflow cutover preflight surface (A2).
 *
 * READINESS ONLY. Nothing behind this index writes, deploys, connects, reads a
 * hosted system, or moves production authority. `ai/bootstrap.ts` must not
 * import it, and `tests/system/ai_boundary.test.ts` asserts that it does not.
 */

export type {
  ActiveRunCensus,
  CanonicalOrganization,
  FingerprintMode,
  ReadinessManifest,
  ReadinessVerdict,
  TenantClassification,
  TenantReadiness,
  TenantResolution,
  WorkflowFingerprint,
  WorkflowInventoryRow,
  WorkflowRowClassification,
  WorkflowSourceKind,
  WorkflowSourceRow,
  WorkflowTenantMappingEntry,
} from './contracts.ts';
export {
  BLOCKING_ROW_CLASSIFICATIONS,
  CHECKPOINT_VERSION_WIDTH,
  PREFLIGHT_TOOL,
  PREFLIGHT_TOOL_VERSION,
  RESOLVED_TENANT_CLASSIFICATIONS,
  SCHEMA_MARKER_FIELD,
  TENANT_CLASSIFICATIONS,
  WORKFLOW_ROW_CLASSIFICATIONS,
  WORKFLOW_SOURCE_KINDS,
  WORKFLOW_SOURCE_NAMESPACE,
  WORKFLOW_SOURCE_SCHEMA,
  isBlockingClassification,
  isEligibleOrganization,
  isResolvedTenant,
} from './contracts.ts';

export type {
  WorkflowRunBundle,
  WorkflowSourceInventory,
  WorkflowTenantInventory,
} from './inventory.ts';
export { inventoryWorkflowSource, isTransformableBundle, parseWorkflowSourceKey } from './inventory.ts';

export type { TenantMappingInput, TenantMappingResult } from './tenantMapping.ts';
export { isCanonicalOrganizationId, resolveTenantMappings } from './tenantMapping.ts';

export type { CheckpointDigestMapping, TransformVerdict, TransformedBundle } from './transform.ts';
export { transformTenant } from './transform.ts';

export type { FingerprintVerdict, FingerprintableBundle } from './fingerprint.ts';
export { compareFingerprints, fingerprintBundles } from './fingerprint.ts';

export type { PreflightInput, PreflightResult, TransformedTenantPlan } from './readiness.ts';
export { runWorkflowCutoverPreflight } from './readiness.ts';

export type { LocalDatabaseVerdict } from './localOnly.ts';
export { LOCAL_DATABASE_HOSTS, classifyDatabaseTarget } from './localOnly.ts';
