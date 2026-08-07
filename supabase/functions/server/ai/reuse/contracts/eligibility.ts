/**
 * The eligibility contract (AI-01 Batch 3B, Part 6B).
 *
 * ── ARCHITECTURAL LAW: A SIMILARITY MATCH IS NOT PERMISSION TO REUSE ──────
 *
 * Reuse is TWO decisions, taken by two different components, and the entire
 * safety of this subsystem rests on their separation:
 *
 *   DISCOVERY    "Is there a potentially reusable result?" Answered by an exact
 *                key lookup or by a candidate-ranking port. It may be
 *                approximate, it may be wrong, and it may in principle be
 *                hostile — a scoring function is not a security control.
 *
 *   ELIGIBILITY  "Is this result still legally, operationally and semantically
 *                valid for THIS execution?" Answered here, from declared
 *                evidence, deterministically.
 *
 * Discovery may SUGGEST. Eligibility DECIDES. Nothing in the pipeline can reach
 * a reuse outcome without an eligible verdict, and no verdict can be eligible
 * with an unsatisfied dimension, so a defect in discovery costs hit rate and
 * cannot cost correctness.
 *
 * ── THE GATE FAILS CLOSED, AND "UNKNOWN" IS A FAILURE ─────────────────────
 *
 * Every dimension below is answered from evidence the CALLER supplies — an
 * authorization verdict it already obtained, the posture the Control Plane
 * reports, the policy versions in force, the dependency versions it can see. The
 * gate never computes authority and never asks a store whether something is
 * permitted. It checks what it was told.
 *
 * The consequence is deliberate: a caller that cannot supply a dimension gets a
 * MISS. Not a warning, not a default, not "probably fine". The cost of a
 * fail-closed gate is a paid inference; the cost of a fail-open one is serving a
 * tenant an answer computed under authority nobody re-established.
 *
 * ── A CACHE HIT IS NOT AN AUTHORIZATION ────────────────────────────────────
 *
 * The most subtle failure this contract prevents: "no provider call happens, so
 * the usual checks do not apply". They apply MORE. A caller who is not permitted
 * to run this task is not permitted to receive its answer either, and a stored
 * answer is a faster way to hand it over. That is why AUTHORITY and POSTURE are
 * dimensions of eligibility rather than preconditions somebody else was assumed
 * to have checked — and why the kill switch appears here at all.
 */

import type { CapabilityProfile, QualityProfile } from '../../optimization/contracts/compression.ts';
import type { ReuseDependency } from './dependency.ts';
import type { ReuseIdentity } from './identity.ts';

/**
 * The dimensions. Every one must be SATISFIED for a verdict to be eligible.
 *
 * Named and enumerated rather than collapsed into a boolean because "this was
 * refused" and "this was refused because the evidence fingerprint moved" are
 * different operational facts, and only the second one tells an operator what to
 * change.
 */
export const REUSE_ELIGIBILITY_DIMENSIONS = [
  'tenancy',
  'integrity',
  'authority',
  'posture',
  'policy',
  'quality',
  'version',
  'freshness',
  'dependencies',
] as const;

export type ReuseEligibilityDimension = (typeof REUSE_ELIGIBILITY_DIMENSIONS)[number];

/**
 * Why reuse did not happen. Closed vocabulary; every miss names exactly one.
 *
 * These are the codes the Part 6C economics will group on, so they are chosen to
 * be actionable: `expired` tells an operator to revisit a TTL, `dependency_changed`
 * tells them the cache is working as designed, and `quality_below_requirement`
 * tells them a quality contract was raised after the entry was written.
 */
export const REUSE_MISS_REASONS = [
  // Discovery
  'no_candidate',
  'discovery_unavailable',
  'store_unavailable',
  // Tenancy
  'tenant_mismatch',
  // Integrity
  'record_malformed',
  'record_incomplete',
  'output_digest_mismatch',
  'invalidated',
  // Authority
  'caller_not_authorized',
  'workflow_not_permitted',
  'agent_not_permitted',
  'approval_required',
  'certification_invalid',
  // Posture
  'ai_disabled',
  'reuse_disabled',
  // Policy
  'policy_version_incompatible',
  'optimization_policy_incompatible',
  'baseline_policy_incompatible',
  // Quality
  'quality_below_requirement',
  'capability_below_requirement',
  // Version
  'workflow_version_incompatible',
  'agent_version_incompatible',
  'plan_digest_incompatible',
  'task_identity_mismatch',
  // Freshness
  'expired',
  'freshness_policy_unsatisfied',
  // Dependencies
  'dependency_changed',
  'dependency_missing',
  // Fail-closed catch-all for a dimension whose evidence was not supplied
  'evidence_unavailable',
] as const;

export type ReuseMissReason = (typeof REUSE_MISS_REASONS)[number];

/**
 * Authorization the caller ALREADY established, presented as evidence.
 *
 * Every field is a verdict from the component that owns it — RBAC, the approval
 * gate, the certification registry — and the reuse engine's only relationship
 * with them is to refuse when one is false. It cannot grant any of them, and it
 * holds none of the modules that could, which the boundary scan asserts on the
 * source.
 */
export interface ReuseAuthorityEvidence {
  /** The RBAC verdict for this caller on this operation. */
  readonly callerAuthorized: boolean;
  /** The identity of that verdict, recorded on the eligibility evidence. */
  readonly authorizationEvidenceId: string;
  /** The workflow is still permitted to run this task. */
  readonly workflowPermitted: boolean;
  /** The agent is still permitted to perform it. */
  readonly agentPermitted: boolean;
  /**
   * No approval requirement is outstanding.
   *
   * False when the operation is approval-bound and the approval has not been
   * granted. Reuse must never be the reason an approval was not needed: an
   * answer delivered without the approval its operation requires has bypassed
   * the approval, whether or not a model was called to produce it.
   */
  readonly approvalSatisfied: boolean;
  /** The producing agent's certification is still valid. */
  readonly certificationValid: boolean;
}

/**
 * The Control Plane's current posture. Read, never decided, never cached.
 *
 * `aiEnabled` is the kill switch. The rule this platform adopts, explicitly:
 * IF THE KILL SWITCH PROHIBITS THE OPERATION, CACHED OUTPUT MUST NOT BE USED TO
 * SATISFY IT. "No provider call occurs" is not permission to ignore an emergency
 * stop — an emergency stop is a statement about the operation, not about the
 * billing.
 */
export interface ReusePostureEvidence {
  readonly aiEnabled: boolean;
  /** Reuse specifically permitted. A narrower switch than the kill switch. */
  readonly reuseEnabled: boolean;
  /** Identity of the posture, recorded on the eligibility evidence. */
  readonly controlPlanePostureVersion: string;
}

/**
 * Policy compatibility, expressed as an ALLOW LIST rather than an ordering.
 *
 * A cached result satisfies the current policy if its policy version is the
 * current one, or if the caller has explicitly declared it compatible. There is
 * no "newer is better" rule and no "more expensive is safer" rule, because
 * neither is true: a hardened policy revision typically forbids things its
 * predecessor allowed, so an older result is not automatically acceptable — and
 * a result produced under a policy that has since been WITHDRAWN is not
 * acceptable either, however recent.
 */
export interface ReusePolicyRequirement {
  readonly policyVersion: string;
  readonly compatiblePolicyVersions: readonly string[];
  readonly optimizationPolicyVersion: string;
  readonly compatibleOptimizationPolicyVersions: readonly string[];
  readonly baselinePolicyVersion: string;
  readonly compatibleBaselinePolicyVersions: readonly string[];
}

/** Version compatibility. Same allow-list model, for the same reason. */
export interface ReuseVersionRequirement {
  /**
   * The normalised task identity and kind this request is for.
   *
   * Checked against the record even though the exact key already binds them,
   * because a SEMANTIC candidate is loaded by id and has therefore been matched
   * on nothing. Requiring the same declared task identity is what keeps semantic
   * reuse to "the same work, expressed differently" rather than "any stored
   * answer that scored well" — which is the difference the architectural law is
   * about.
   */
  readonly taskIdentity: string;
  readonly taskKind: string;
  readonly workflowId?: string;
  readonly workflowVersion?: string;
  readonly compatibleWorkflowVersions?: readonly string[];
  readonly workflowPlanDigest?: string;
  /** When true, a record whose plan digest differs is refused. */
  readonly planDigestRequired: boolean;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly compatibleAgentVersions?: readonly string[];
  readonly agentCertificationId?: string;
}

/**
 * The quality floor the cached result must CLEAR, not merely resemble.
 *
 * A result produced under a weaker requirement may not satisfy a stronger
 * current one — a `best_effort` answer does not become adequate for a `critical`
 * request by being available, and an `economy` band result does not satisfy an
 * `advanced_reasoning` floor by being cheap.
 */
export interface ReuseQualityRequirement {
  readonly quality: QualityProfile;
  readonly minimumCapabilityProfile: CapabilityProfile;
}

export interface ReuseFreshnessRequirement {
  /** Supplied by the caller's clock. The gate reads no clock of its own. */
  readonly nowMs: number;
  /** The caller may demand fresher than the record's own window. */
  readonly maximumAgeMs?: number;
  /** The caller may demand a result nothing can invalidate by time. */
  readonly requireImmutable?: boolean;
}

/** Everything the gate is allowed to know. */
export interface ReuseEligibilityRequest {
  readonly organizationId: string;
  readonly taskId: string;
  readonly identity: ReuseIdentity;
  readonly authority: ReuseAuthorityEvidence;
  readonly posture: ReusePostureEvidence;
  readonly policy: ReusePolicyRequirement;
  readonly version: ReuseVersionRequirement;
  readonly quality: ReuseQualityRequirement;
  readonly freshness: ReuseFreshnessRequirement;
  /**
   * The dependency versions the caller can currently see.
   *
   * A declared dependency absent from this set is `unknown` and therefore a
   * miss. The caller has not established that it is unchanged; it has merely not
   * mentioned it, and those are the same thing only to a fail-open gate.
   */
  readonly currentDependencies: readonly ReuseDependency[];
}

export interface ReuseEligibilityCheck {
  readonly dimension: ReuseEligibilityDimension;
  readonly satisfied: boolean;
  readonly missReason?: ReuseMissReason;
  /** Server-side detail for the audit record. Never tenant content. */
  readonly detail: string;
}

export interface ReuseEligibilityVerdict {
  readonly reusableResultId: string;
  readonly organizationId: string;
  readonly eligible: boolean;
  /** The FIRST unsatisfied dimension's reason, in dimension order. */
  readonly missReason?: ReuseMissReason;
  /** Every dimension, satisfied or not. The evidence, not just the verdict. */
  readonly checks: readonly ReuseEligibilityCheck[];
  /**
   * Digest of the decisive inputs to this verdict.
   *
   * Recorded on the avoided-call entry so an auditor asking "on what basis was
   * this reused" gets an answer that can be recomputed rather than a timestamp.
   */
  readonly evidenceDigest: string;
}
