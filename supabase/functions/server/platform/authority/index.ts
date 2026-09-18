/**
 * The platform authority surface (BP-001).
 *
 * THE ONLY WAY IN. Callers import from here, never from a file beside it — the
 * same rule `ai/index.ts` holds for the control plane, for the same reason:
 * a caller that reaches past the surface into `evaluator.ts` is a caller that
 * can be given a different evaluator later without anybody noticing, and the
 * boundary scan in `tests/system/ai_boundary.test.ts` asserts the absence of
 * exactly that shape elsewhere in this repository.
 *
 * WHAT IS NOT EXPORTED is as deliberate as what is. There is no way from here
 * to construct a decision by hand, to widen an envelope, or to write an audit
 * record. `evaluateAuthority` is a pure function over facts the caller gathered,
 * and the projections turn its answer into shapes the EXISTING approval and
 * audit machinery already accepts. Nothing here executes, stores or approves.
 */

export {
  ACTOR_TYPES,
  AUTHORITY_REASON,
  HUMAN_ACTOR_TYPES,
  consequenceRank,
  exceedsConsequence,
  exceedsDataCeiling,
  maxConsequence,
  type ActionRequest,
  type ActorContext,
  type ActorType,
  type ApprovalRequirement,
  type AuthorityDecision,
  type AuthorityDecisionOutcome,
  type AuthorityEnvelope,
  type AuthorityEnvelopeSource,
  type AuthorityEvaluationInput,
  type AuthorityEvidence,
  type AuthorityPolicySource,
  type AuthorityReasonCode,
  type ConsequenceLevel,
  type ConsequenceSource,
  type DataClassification,
  type EnvelopeStatus,
  type ExplicitDenyRule,
  type PolicyConstraint,
  type RequestedEffect,
} from './contracts.ts';

export { classifyConsequence, platformConsequenceFloor } from './consequence.ts';

export { evaluateAuthority } from './evaluator.ts';

export {
  authorityAuditDetail,
  authorityAuditOutcome,
  type AuthorityAuditDetail,
} from './auditAdapter.ts';

export {
  authorityApprovalProjection,
  type AuthorityApprovalProjection,
} from './approvalAdapter.ts';
