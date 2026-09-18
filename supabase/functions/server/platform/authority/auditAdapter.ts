/**
 * Projecting an authority decision into the audit trails that already exist.
 *
 * THIS IS NOT AN AUDIT SYSTEM, and the distinction is the entire point of the
 * file. BP-001 §5 step 10 requires a decision to leave structured evidence, and
 * BP-001 §2 forbids building a second trail to hold it. The platform already
 * has three — `observability/audit.ts` for what the platform did,
 * `admin/adminAudit.ts` for what an administrator changed, and
 * `agents/observability/agentAudit.ts` for what an agent proposed and what the
 * orchestrator decided. An authority decision belongs in whichever of those
 * describes the action it was about, not in a fourth.
 *
 * So this module writes nothing and stores nothing. It turns an
 * `AuthorityDecision` into a flat bag of bounded scalars, which is exactly the
 * shape those trails already accept — `boundDetail` in the agent trail takes
 * this and re-bounds it on the way in. The caller appends it to the record it
 * was already writing.
 *
 * SCALARS ONLY, and bounded here as well as there. An evidence projection that
 * could carry an arbitrary payload becomes an uncontrolled copy of tenant
 * business data the first time somebody finds it convenient — the same
 * judgement `observability/audit.ts` documents when it stores digests of
 * prompts and completions rather than the text.
 */

import type { AuthorityDecision } from './contracts.ts';

/** What every trail in this repository accepts as `detail`. */
export type AuthorityAuditDetail = Readonly<Record<string, string | number | boolean>>;

const MAX_LIST_CHARS = 200;
const MAX_TEXT_CHARS = 300;

function joinBounded(values: readonly string[]): string {
  return values.join(',').slice(0, MAX_LIST_CHARS);
}

/**
 * The decision, as audit detail.
 *
 * Every key is prefixed `authority.` so that a record carrying one of these
 * alongside a subsystem's own fields stays unambiguous — and so that a search
 * for every authority decision in a trail is one prefix query rather than a
 * list of field names somebody has to keep current.
 *
 * WHAT IS DELIBERATELY ABSENT: the resource id, the actor's roles, and the
 * request attributes. The first two are already on every record these trails
 * write, and repeating an identifier in two fields is how the two eventually
 * disagree. The third is caller-supplied and unbounded in cardinality.
 */
export function authorityAuditDetail(decision: AuthorityDecision): AuthorityAuditDetail {
  const detail: Record<string, string | number | boolean> = {
    'authority.decision': decision.decision,
    'authority.reasonCodes': joinBounded(decision.reasonCodes),
    'authority.reason': decision.reason.slice(0, MAX_TEXT_CHARS),
    'authority.consequenceLevel': decision.consequenceLevel,
    'authority.actionType': decision.evidence.actionType,
    'authority.resourceType': decision.evidence.resourceType,
    'authority.requestedEffect': decision.evidence.requestedEffect,
    'authority.dataClassification': decision.evidence.dataClassification,
    'authority.actorType': decision.evidence.actorType,
    'authority.membershipVerified': decision.evidence.membershipVerified,
    'authority.evaluatedSteps': joinBounded(decision.evidence.evaluatedSteps),
    'authority.actionId': decision.actionId,
    'authority.correlationId': decision.correlationId,
  };

  // Optional fields are OMITTED rather than written as a placeholder. A record
  // that says `envelopeId: 'none'` cannot be told apart from one where an
  // envelope really was called `none`, and a reader counting decisions by
  // envelope would silently include refusals that never reached one.
  if (decision.matchedEnvelopeId !== undefined) {
    detail['authority.envelopeId'] = decision.matchedEnvelopeId;
  }
  if (decision.evidence.envelopeVersion !== undefined) {
    detail['authority.envelopeVersion'] = decision.evidence.envelopeVersion;
  }
  if (decision.evidence.envelopeConsequenceCeiling !== undefined) {
    detail['authority.envelopeCeiling'] = decision.evidence.envelopeConsequenceCeiling;
  }
  if (decision.evidence.envelopeApprovalThreshold !== undefined) {
    detail['authority.approvalThreshold'] = decision.evidence.envelopeApprovalThreshold;
  }
  if (decision.matchedPermissions.length > 0) {
    detail['authority.permissions'] = joinBounded(decision.matchedPermissions);
  }
  if (decision.matchedPolicies.length > 0) {
    detail['authority.policies'] = joinBounded(decision.matchedPolicies);
  }
  if (decision.evidence.requestedTool !== undefined) {
    detail['authority.tool'] = decision.evidence.requestedTool;
  }
  if (decision.evidence.estimatedCostMicroUsd !== undefined) {
    detail['authority.estimatedCostMicroUsd'] = decision.evidence.estimatedCostMicroUsd;
  }
  if (decision.traceId !== undefined) {
    detail['authority.traceId'] = decision.traceId;
  }
  if (decision.approvalRequirement !== undefined) {
    detail['authority.approvalReason'] = decision.approvalRequirement.reasonCode;
    detail['authority.withinEnvelopeCeiling'] =
      decision.approvalRequirement.withinEnvelopeCeiling;
  }

  return detail;
}

/**
 * The outcome word the existing agent trail uses.
 *
 * `allowed` / `denied` are two of that trail's five outcomes, and a decision
 * that asks for a human is recorded as `recorded` rather than as a third thing:
 * at the moment the evaluator returns, nothing has been allowed or refused, an
 * approval has merely been asked for. Which way it went is the approval's own
 * record to make, and it makes it.
 */
export function authorityAuditOutcome(
  decision: AuthorityDecision,
): 'allowed' | 'denied' | 'recorded' {
  if (decision.decision === 'ALLOW') return 'allowed';
  if (decision.decision === 'DENY') return 'denied';
  return 'recorded';
}
