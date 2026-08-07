/**
 * Progressive escalation (AI-01 Batch 3B, Part 6A).
 *
 *      cheap capable execution
 *              ↓
 *        quality evidence
 *         PASS / UNCERTAIN
 *          ↓          ↓
 *        STOP      ESCALATE
 *
 * ── THERE IS NO JUDGE MODEL HERE, AND THAT IS DELIBERATE ───────────────────
 *
 * An LLM-as-judge is explicitly out of scope for this part, and the reason is
 * arithmetic before it is architectural: a judge call costs roughly what the
 * call it judges costs, so a system that judges every cheap execution has
 * doubled the price of the cheap path to protect a saving it just spent. Judging
 * belongs where it is worth its price, and deciding that is not Part 6A's job.
 *
 * What escalation reads instead is DETERMINISTIC or ALREADY-TRUSTED evidence
 * the platform produces anyway: did the output satisfy its declared contract,
 * did the structured parse succeed, did the required fields arrive, did the
 * agent runtime report a failure. Every one of those is a fact somebody else
 * already established, which is why consuming them costs nothing.
 *
 * ── FOUR PROPERTIES, EACH ANSWERING A SPECIFIC FAILURE ─────────────────────
 *
 *   BOUNDED     `maxEscalations` is a hard count, and it is checked before the
 *               cost is. A ladder with no top is a ladder that climbs to the
 *               most expensive band on every ambiguous answer.
 *
 *   MONOTONIC   Escalation only ever goes UP, and a band that has been attempted
 *               is never attempted again. That is the whole anti-oscillation
 *               mechanism: with no way to descend and no way to repeat, a
 *               sequence of bands is strictly increasing and therefore finite.
 *
 *   COST-AWARE  An escalation that does not fit the remaining budget is refused
 *               as a budget decision rather than attempted and denied later by
 *               the spend guard. Refusing early is what makes the refusal a
 *               saving rather than an error.
 *
 *   JUSTIFIED   Every outcome carries a reason code. "It escalated" is not an
 *               explanation, and an escalation nobody can explain is an
 *               escalation nobody can defend on an invoice.
 */

import type { CapabilityProfile, CompressionReason } from '../contracts/compression.ts';
import { CAPABILITY_RANK } from '../contracts/compression.ts';

/**
 * What the platform already knows about the cheap attempt's output.
 *
 * `pass` — it satisfied its declared contract. Stop; this is the saving.
 * `uncertain` — it parsed but something declared is missing or the run reported
 *   a soft failure. The only state that may escalate.
 * `fail` — a hard, non-recoverable failure. Escalation is not the remedy for a
 *   task that is malformed, and spending a bigger model on it would turn a cheap
 *   failure into an expensive one.
 */
export type QualityEvidence = 'pass' | 'uncertain' | 'fail';

export interface EscalationState {
  /** Bands already attempted, in order. Never re-attempted. */
  readonly attemptedProfiles: readonly CapabilityProfile[];
  /** Escalations already spent on this task. */
  readonly escalations: number;
  /** Hard ceiling on escalations, from the caller's policy. */
  readonly maxEscalations: number;
  /** Highest band the caller is permitted to reach. */
  readonly maximumProfile: CapabilityProfile;
  /** Bands the caller may request, from its own allow list. */
  readonly allowedProfiles: readonly CapabilityProfile[];
  /** Micro-USD still available for this task. */
  readonly remainingCostMicroUsd: number;
  /** Projected micro-USD of one attempt at the next band up. */
  readonly nextAttemptCostMicroUsd: number;
}

export interface EscalationDecision {
  readonly escalate: boolean;
  /** The band to try next. Present only when `escalate` is true. */
  readonly nextProfile?: CapabilityProfile;
  readonly reason: CompressionReason;
  readonly diagnostics: string;
  /**
   * Micro-USD NOT spent because escalation was refused.
   *
   * Zero whenever escalation proceeds, and zero when it was never a candidate —
   * refusing to escalate a task that PASSED is not a saving, it is the system
   * working. Only a refused, genuinely available escalation is attributable, and
   * conflating the two is how avoided-escalation counts become fiction.
   */
  readonly avoidedCostMicroUsd: number;
}

/**
 * Decide whether to climb one step.
 *
 * The order of the checks is the policy: evidence first (a passing answer ends
 * the ladder whatever the budget), then the ceiling (a bound is a bound), then
 * availability (a band that is not permitted is not a step), then affordability.
 */
export function decideEscalation(
  evidence: QualityEvidence,
  state: EscalationState,
): EscalationDecision {
  if (evidence === 'pass') {
    return {
      escalate: false,
      reason: 'minimum_profile_sufficient',
      diagnostics: `quality evidence passed at attempt ${state.attemptedProfiles.length}`,
      avoidedCostMicroUsd: 0,
    };
  }

  if (evidence === 'fail') {
    return {
      escalate: false,
      reason: 'quality_evidence_failed',
      diagnostics: 'the attempt failed hard; a larger model is not the remedy',
      avoidedCostMicroUsd: 0,
    };
  }

  if (state.escalations >= state.maxEscalations) {
    return {
      escalate: false,
      reason: 'escalation_ceiling_reached',
      diagnostics: `escalations=${state.escalations} ceiling=${state.maxEscalations}`,
      avoidedCostMicroUsd: Math.max(0, state.nextAttemptCostMicroUsd),
    };
  }

  const highestAttempted = state.attemptedProfiles.reduce<number>(
    (highest, profile) => Math.max(highest, CAPABILITY_RANK[profile]),
    -1,
  );

  // STRICTLY UPWARD, NEVER REPEATED. Together these make the band sequence
  // monotonic increasing, which is what makes oscillation impossible rather
  // than merely unlikely.
  const next = state.allowedProfiles
    .filter((profile) => CAPABILITY_RANK[profile] > highestAttempted)
    .filter((profile) => CAPABILITY_RANK[profile] <= CAPABILITY_RANK[state.maximumProfile])
    .filter((profile) => !state.attemptedProfiles.includes(profile))
    .sort((a, b) => CAPABILITY_RANK[a] - CAPABILITY_RANK[b])[0];

  if (next === undefined) {
    return {
      escalate: false,
      reason: 'escalation_oscillation_blocked',
      diagnostics:
        `no higher permitted profile: attempted=[${state.attemptedProfiles.join(',')}] ` +
        `maximum=${state.maximumProfile}`,
      avoidedCostMicroUsd: 0,
    };
  }

  if (state.nextAttemptCostMicroUsd > state.remainingCostMicroUsd) {
    return {
      escalate: false,
      reason: 'insufficient_remaining_budget',
      diagnostics:
        `next=${next} cost=${state.nextAttemptCostMicroUsd} ` +
        `remaining=${state.remainingCostMicroUsd}`,
      avoidedCostMicroUsd: Math.max(0, state.nextAttemptCostMicroUsd),
    };
  }

  return {
    escalate: true,
    nextProfile: next,
    reason: 'quality_evidence_uncertain',
    diagnostics:
      `escalating to ${next}: escalations=${state.escalations + 1}/${state.maxEscalations}`,
    avoidedCostMicroUsd: 0,
  };
}
