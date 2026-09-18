/**
 * Projecting `REQUIRE_APPROVAL` into the approval machinery that already exists.
 *
 * THERE IS NO SECOND APPROVAL ENGINE, and BP-001 §2 and §7 both say so. The one
 * that exists — `agents/approvals/approvalGate.ts` — already has the four
 * properties an approval needs and that are genuinely hard to get right: it
 * survives a restart, it cannot be spent twice, it resolves the approver's
 * authority server-side, and nothing in it can approve without a person. None
 * of that is re-created here.
 *
 * What this module does is smaller and entirely mechanical: it turns the
 * evaluator's `approvalRequirement` into the human-facing fields that gate
 * already asks for — a one-sentence impact summary and a list of what is
 * affected. The caller passes them to `approvals.request(...)` exactly as it
 * does today.
 *
 * WHY IT LIVES HERE RATHER THAN IN THE AGENT RUNTIME. Because the next caller
 * will not be the agent runtime. When an outreach action or a payment needs the
 * same projection, the phrasing an approver reads should not depend on which
 * subsystem happened to ask — an operator triaging a queue is comparing
 * requests, and requests that describe themselves in four different registers
 * are requests that get misjudged.
 */

import type { AuthorityDecision } from './contracts.ts';

const MAX_SUMMARY = 500;
const MAX_AFFECTED = 12;

/**
 * The human-facing part of an approval request.
 *
 * Field names match `CreateApprovalInput` in the existing gate so the caller
 * spreads this in rather than transcribing it — a transcription is a place for
 * a field to be dropped.
 */
export interface AuthorityApprovalProjection {
  /** What the pending action would do, in one sentence. */
  readonly impactSummary: string;
  /** What it touches, as short stable tokens rather than prose. */
  readonly dataAffected: readonly string[];
}

/**
 * Describe a decision to the person who will decide it.
 *
 * Returns undefined for anything that is not `REQUIRE_APPROVAL`. An allow needs
 * no approver and a deny is already final, so producing a projection for either
 * would only create the opportunity to request approval for something that was
 * refused.
 */
export function authorityApprovalProjection(
  decision: AuthorityDecision,
): AuthorityApprovalProjection | undefined {
  if (decision.decision !== 'REQUIRE_APPROVAL') return undefined;
  const requirement = decision.approvalRequirement;
  if (!requirement) return undefined;

  const evidence = decision.evidence;
  const subject = evidence.requestedTool ?? evidence.actionType;
  const impactSummary = (
    `${requirement.summary} ` +
    `Action ${evidence.actionType} on ${evidence.resourceType} ` +
    `(${evidence.requestedEffect}, ${requirement.consequenceLevel} consequence) ` +
    `requested by a ${evidence.actorType} actor via ${subject}.`
  ).slice(0, MAX_SUMMARY);

  // SHORT STABLE TOKENS, NOT PROSE. The gate stores these and an operator
  // filters on them; a sentence would make the list unfilterable and would be
  // the obvious place for a tenant's own data to end up.
  const affected: string[] = [
    `action:${evidence.actionType}`,
    `resource:${evidence.resourceType}`,
    `effect:${evidence.requestedEffect}`,
    `data:${evidence.dataClassification}`,
    `consequence:${requirement.consequenceLevel}`,
  ];
  if (evidence.requestedTool !== undefined) affected.push(`tool:${evidence.requestedTool}`);
  if (evidence.estimatedCostMicroUsd !== undefined) {
    affected.push(`cost_micro_usd:${evidence.estimatedCostMicroUsd}`);
  }

  return {
    impactSummary,
    dataAffected: affected.slice(0, MAX_AFFECTED),
  };
}
