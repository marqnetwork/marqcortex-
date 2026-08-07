/**
 * The Cortex Intelligent Reuse & Cache Engine — public surface
 * (AI-01 Batch 3B, Part 6B).
 *
 * ── WHAT PART 6B ADDS TO PART 6A ───────────────────────────────────────────
 *
 * Part 6A made necessary inference cheaper. Part 6B makes ELIGIBLE inference
 * disappear — and the word doing the work in that sentence is "eligible".
 *
 * `resolveReuse` is the one entry point. It returns a resolution: a hit
 * carrying a `ValidatedPriorOutput`, which is the exact input type Part 6A has
 * accepted since it shipped, or a miss carrying a reason. Nothing exported here
 * can call a provider, hold a credential, name a model, widen an allow list,
 * touch the spend ledger, spend an approval, grant an authorization, reach the
 * Tool Gateway or build a savings record. The certified AI Control Plane remains
 * the only execution authority; `optimization/ledger/savingsLedger.ts` remains
 * the only savings ledger. A boundary scan asserts both on the source rather
 * than trusting this paragraph.
 *
 * ── THE ARCHITECTURAL LAW ──────────────────────────────────────────────────
 *
 * A similarity match is not permission to reuse. DISCOVERY suggests, ELIGIBILITY
 * decides, and the gate fails closed. Every path to a hit runs through
 * `evaluateReuseEligibility`, and every dimension it checks must be ESTABLISHED
 * — not merely un-disproved.
 *
 * ── THE SEMANTIC FINDING, RECORDED HERE TOO ────────────────────────────────
 *
 * This repository has no certified embedding or retrieval path. Part 6B
 * therefore ships the semantic discovery CONTRACT, a ranking interface and a
 * deterministic adapter over declared labels, and adds NO production embedding
 * provider — because introducing one to decide whether a model call can be
 * avoided would create a second, ungoverned AI execution path. See
 * `discovery/semanticDiscoveryPort.ts` for the full finding.
 *
 * ── DEFERRED TO PART 6C, DELIBERATELY ──────────────────────────────────────
 *
 * Financial Intelligence, dashboards, optimization scores, admin surfaces and
 * HTTP routes. `metrics/reuseMetrics.ts` produces the figures they will read and
 * produces nothing else.
 */

export type { ReuseFailureCode } from './contracts/failures.ts';
export { ReuseError, isReuseError, reuseFailure } from './contracts/failures.ts';

export type {
  DependencyComparison,
  ReuseDependency,
  ReuseDependencyKind,
} from './contracts/dependency.ts';
export {
  EVIDENCE_DEPENDENCY_KIND,
  MAX_DEPENDENCIES,
  REUSE_DEPENDENCY_KINDS,
  assertDependencySplit,
  compareDependency,
  dependencyId,
  dependencyToken,
  isValidDependency,
  normalizeDependencies,
} from './contracts/dependency.ts';

export type {
  ReuseFreshnessDeclaration,
  ReuseFreshnessPolicy,
  SealedFreshness,
} from './contracts/freshness.ts';
export { MAX_TTL_MS, REUSE_FRESHNESS_POLICIES, isExpired, sealFreshness } from './contracts/freshness.ts';

export type {
  ReusableOutputEnvelope,
  ReusableOutputScalar,
  ReusableOutputValue,
} from './contracts/output.ts';
export {
  MAX_OUTPUT_ARRAY_LENGTH,
  MAX_OUTPUT_FIELDS,
  MAX_OUTPUT_STRING_LENGTH,
  digestReusableOutput,
  isWellFormedOutput,
  sealReusableOutput,
} from './contracts/output.ts';

export type {
  ReuseIdentity,
  ReuseIdentityInput,
  ReuseSemanticMetadata,
} from './contracts/identity.ts';

export type {
  ReusableResultRecord,
  ReuseInvalidationReason,
  ReuseProvenance,
} from './contracts/reusableResult.ts';
export {
  REUSABLE_RESULT_SCHEMA,
  REUSE_INVALIDATION_REASONS,
  isWholeReusableRecord,
} from './contracts/reusableResult.ts';

export type {
  ReuseAuthorityEvidence,
  ReuseEligibilityCheck,
  ReuseEligibilityDimension,
  ReuseEligibilityRequest,
  ReuseEligibilityVerdict,
  ReuseFreshnessRequirement,
  ReuseMissReason,
  ReusePolicyRequirement,
  ReusePostureEvidence,
  ReuseQualityRequirement,
  ReuseVersionRequirement,
} from './contracts/eligibility.ts';
export {
  REUSE_ELIGIBILITY_DIMENSIONS,
  REUSE_MISS_REASONS,
} from './contracts/eligibility.ts';

export {
  allDependencies,
  buildReuseIdentity,
  reusableResultIdFor,
  sealSemanticMetadata,
} from './identity/reuseIdentity.ts';

export type { SealReusableResultInput } from './identity/sealReusableResult.ts';
export { sealReusableResult } from './identity/sealReusableResult.ts';

export type {
  ReusableResultStore,
  ReusablePutOutcome,
  ReuseCandidateQuery,
} from './persistence/ports.ts';
export {
  DEFAULT_CANDIDATE_LIMIT,
  MAX_CANDIDATE_LIMIT,
  MAX_SCAN_ROWS,
  boundedCandidateLimit,
  createInMemoryReusableResultStore,
  declaresDependency,
  invalidatedRecord,
  matchesCandidateQuery,
  sortCandidates,
} from './persistence/ports.ts';

export type {
  KvReuseConditionalWriter,
  KvReusePrefixReader,
  KvReuseReader,
  KvReuseStoreOptions,
} from './persistence/kvReusableResultStore.ts';
export {
  createKvReusableResultStore,
  reusableResultKeyFor,
  reusableResultPrefixFor,
} from './persistence/kvReusableResultStore.ts';

export type {
  SemanticCandidate,
  SemanticDiscoveryMethod,
  SemanticDiscoveryQuery,
  SemanticReuseDiscoveryPort,
} from './discovery/semanticDiscoveryPort.ts';
export {
  SEMANTIC_DISCOVERY_METHODS,
  declaredFeatureSimilarity,
  rankCandidates,
  scoreRecord,
} from './discovery/semanticDiscoveryPort.ts';

export type { DeclaredFeatureDiscoveryOptions } from './discovery/declaredFeatureDiscovery.ts';
export { createDeclaredFeatureDiscovery } from './discovery/declaredFeatureDiscovery.ts';

export { evaluateReuseEligibility } from './engine/eligibilityGate.ts';

export type {
  ReuseInvalidationCommand,
  ReuseInvalidationReport,
  ReuseInvalidationScope,
} from './engine/invalidationEngine.ts';
export { invalidateReusableResults } from './engine/invalidationEngine.ts';

export type {
  ReuseAttemptCounters,
  ReuseCandidateEvaluation,
  ReuseOutcome,
  ReuseResolution,
  ReuseResolutionInput,
  ReuseSemanticRequest,
} from './engine/reuseDecisionPipeline.ts';
export { resolveReuse } from './engine/reuseDecisionPipeline.ts';

export type {
  AvoidedCallEntry,
  AvoidedCallLedger,
  AvoidedCallTotals,
  RecordAvoidedCallInput,
  ReuseType,
} from './accounting/avoidedCallLedger.ts';
export {
  REUSE_TYPES,
  emptyAvoidedCallLedger,
  recordAvoidedCall,
  reconcileAvoidedCalls,
  totalAvoidedCalls,
} from './accounting/avoidedCallLedger.ts';

export type { ReuseMetrics, ReuseMetricsInput, ReuseMissFamily } from './metrics/reuseMetrics.ts';
export { MISS_FAMILIES, missFamilyFor, summarizeReuse } from './metrics/reuseMetrics.ts';
