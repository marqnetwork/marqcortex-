/**
 * The Cortex Cost Compression Engine — public surface (AI-01 Batch 3B, Part 6A).
 *
 * ONE ENTRY POINT, and it returns advice.
 *
 * `compressCost` produces a `CompressionPlan`. It never executes one. Nothing
 * exported here can call a provider, hold a credential, name a model, widen an
 * allow list, touch the spend ledger, spend an approval or reach the Tool
 * Gateway — the certified AI Control Plane remains the only execution authority
 * and the agent runtime's router remains the only thing that resolves a concrete
 * model. A boundary scan asserts that on the source rather than trusting this
 * paragraph.
 *
 * DEFERRED TO PART 6B, deliberately: semantic reuse and exact-response caching.
 * Both need tenant, freshness, provenance and invalidation contracts that
 * deserve their own review, and shipping them beside the accounting they would
 * feed would mean one review for two things that fail in different ways. What
 * Part 6A takes is a `ValidatedPriorOutput` the CALLER has already re-validated;
 * what it never does is decide that a prior output is still valid.
 */

export type {
  CapabilityProfile,
  CompressionDecision,
  CompressionFailureCode,
  CompressionReason,
  QualityProfile,
} from './contracts/compression.ts';
export {
  CAPABILITY_PROFILES,
  CAPABILITY_RANK,
  COMPRESSION_DECISIONS,
  COMPRESSION_REASONS,
  CompressionError,
  NON_EXECUTING_DECISIONS,
  QUALITY_CAPABILITY_FLOOR,
  QUALITY_PROFILES,
  QUALITY_RANK,
  avoidsInference,
  compressionFailure,
  isCompressionError,
  nextCapabilityProfile,
  qualityFloorSatisfied,
} from './contracts/compression.ts';

export type {
  AiTaskDescriptor,
  AiTaskKind,
  ControlPlaneEnvelope,
  DeterministicCapability,
  ValidatedPriorOutput,
} from './contracts/task.ts';
export { AI_TASK_KINDS } from './contracts/task.ts';

export type {
  ContextExclusion,
  ContextExclusionReason,
  ContextItem,
  ContextNecessity,
  ContextSelection,
  ContextSensitivity,
  ContextSource,
} from './contracts/context.ts';
export {
  ALWAYS_REQUIRED_SOURCES,
  CONTEXT_SOURCES,
  CONTEXT_SOURCE_AUTHORITY,
} from './contracts/context.ts';

export type {
  BaselineAssumption,
  BaselineEstimate,
  BaselinePolicy,
  CapabilityPriceBand,
} from './contracts/baseline.ts';
export { MAX_BASELINE_ATTEMPTS } from './contracts/baseline.ts';

export type {
  SavingsCategory,
  SavingsEntry,
  SavingsRecord,
  SavingsRollup,
} from './contracts/savings.ts';
export { SAVINGS_CATEGORIES } from './contracts/savings.ts';

export type {
  ActualUsage,
  UsageAttributionRow,
  UsageLedger,
  UsageObservation,
  UsageScope,
} from './contracts/usage.ts';
export {
  USAGE_SCOPES,
  addActualUsage,
  emptyActualUsage,
  emptyUsageLedger,
} from './contracts/usage.ts';

export type { ComplexityClass, ComplexityClassification } from './engine/complexityClassifier.ts';
export { COMPLEXITY_CLASSES, COMPLEXITY_RANK, classifyComplexity } from './engine/complexityClassifier.ts';

export type { AdmissionOutcome } from './engine/zeroLlmAdmission.ts';
export { admitWithoutInference } from './engine/zeroLlmAdmission.ts';

export type { ContextBudget } from './engine/contextValueEngine.ts';
export { selectContext } from './engine/contextValueEngine.ts';

export type { TokenBudgetInput, TokenBudgetPlan } from './engine/tokenBudgetPlanner.ts';
export { planTokenBudget } from './engine/tokenBudgetPlanner.ts';

export type {
  CapabilityEscalation,
  CapabilityOutcome,
  CapabilityRecommendation,
} from './engine/capabilityRecommender.ts';
export {
  isCapabilityEscalation,
  isCapabilityRecommended,
  recommendCapabilityProfile,
} from './engine/capabilityRecommender.ts';

export type { EscalationDecision, EscalationState, QualityEvidence } from './engine/escalationPolicy.ts';
export { decideEscalation } from './engine/escalationPolicy.ts';

export type { MarginalValueDecision, MarginalValueInput } from './engine/marginalValue.ts';
export { admitAdditionalAttempt, mustNotStop } from './engine/marginalValue.ts';

export type { BaselineInput } from './baseline/baselineCostModel.ts';
export {
  BASELINE_POLICY_V1,
  assertBaselinePolicy,
  estimateBaselineCost,
  projectOptimizedCost,
} from './baseline/baselineCostModel.ts';

export type { SavingsInput, SavingsWeight } from './ledger/savingsLedger.ts';
export {
  buildSavingsRecord,
  reconcileSavings,
  rollupSavings,
  settleSavingsRecord,
} from './ledger/savingsLedger.ts';

export type { AttributionResult, UsageRollupQuery } from './accounting/usageAccounting.ts';
export {
  MAX_USAGE_ROWS,
  attributeUsage,
  retryUsage,
  rollupUsage,
  usageScopeIds,
} from './accounting/usageAccounting.ts';

export type { CompressionMetrics, CompressionMetricsInput } from './metrics/compressionMetrics.ts';
export { summarizeCompression } from './metrics/compressionMetrics.ts';

export type { CompressionPlan, CompressionRequest } from './costCompressionEngine.ts';
export { assertPlanNarrowsOnly, compressCost } from './costCompressionEngine.ts';
