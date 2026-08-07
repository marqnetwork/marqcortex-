/**
 * The versioned baseline cost model (AI-01 Batch 3B, Part 6A).
 *
 * ── READ `contracts/baseline.ts` FIRST ─────────────────────────────────────
 *
 * That file states why the baseline is the half of the savings ratio that can be
 * faked, and what the three defences are. This file is the implementation, and
 * its most important property is a NEGATIVE one:
 *
 *   `estimateBaselineCost` cannot see the optimised cost, the actual cost, a
 *   target percentage, or anything derived from any of them. They are not
 *   parameters, they are not reachable from the parameters, and there is no
 *   module-level state through which they could arrive. `optimised / (1 - 0.9)`
 *   is not forbidden by a rule — the value it needs is out of scope.
 *
 * ── WHAT THE REFERENCE POLICY SAYS AN UNOPTIMISED CORTEX WOULD DO ──────────
 *
 * Send every candidate context item, required and optional, deduplicated by
 * nothing. Ask for the caller's entire completion allowance. Do it at the
 * highest band the caller was ALREADY permitted to use. Spend the attempts a
 * system with no marginal-value control would spend.
 *
 * That is not a strawman — it is what this platform's own agent runtime did
 * before Part 6A, and each clause corresponds to a mechanism Part 6A added. A
 * baseline that assumed a WORSE system than the one that actually preceded the
 * optimisation would be inflation by another name.
 *
 * ── EVERY FIGURE IS CLAMPED TO WHAT THE CALLER COULD ACTUALLY HAVE DONE ────
 *
 * The prompt is capped at the caller's prompt ceiling, the completion at its
 * completion ceiling, the total at its total ceiling, and the band at the
 * caller's own maximum. A baseline may not describe a call the tenant was never
 * permitted to make. This is the clamp that forecloses "inflate the baseline
 * tokens" and "inflate the baseline model profile" in one place, and the
 * adversarial suite attacks both.
 */

import type {
  BaselineAssumption,
  BaselineEstimate,
  BaselinePolicy,
} from '../contracts/baseline.ts';
import { MAX_BASELINE_ATTEMPTS } from '../contracts/baseline.ts';
import type { CapabilityProfile } from '../contracts/compression.ts';
import { CAPABILITY_RANK } from '../contracts/compression.ts';
import type { ControlPlaneEnvelope } from '../contracts/task.ts';
import { compressionFailure } from '../contracts/compression.ts';

/**
 * The reference policy this platform ships with.
 *
 * `v1` describes pre-Part-6A Cortex. Bump the version on ANY change to a rule or
 * a rate — estimates carry the version they were computed under, so old records
 * keep meaning what they meant rather than being silently restated when a
 * constant moves.
 *
 * THE RATES ARE PLANNING FIGURES, per band, deliberately NOT per model. They
 * mirror the upper-bound rates `agents/runtime/defaultProfiles.ts` already uses
 * for pre-call projection, so the baseline and the platform's own cost
 * projection speak the same units and a reader comparing them is comparing like
 * with like.
 */
export const BASELINE_POLICY_V1: BaselinePolicy = {
  policyVersion: 'baseline.v1',
  description:
    'Unoptimised reference: every candidate context item sent undeduplicated, ' +
    'the full completion allowance requested, at the highest capability band the ' +
    'caller was already permitted, with the attempts a system without marginal-value ' +
    'control would spend.',
  profileRule: 'caller_maximum',
  promptRule: 'all_candidate_context',
  completionRule: 'full_allowance',
  assumedAttempts: 1,
  prices: {
    economy: { promptMicroUsdPer1k: 200, completionMicroUsdPer1k: 800 },
    standard: { promptMicroUsdPer1k: 800, completionMicroUsdPer1k: 3_000 },
    reasoning: { promptMicroUsdPer1k: 3_000, completionMicroUsdPer1k: 15_000 },
    advanced_reasoning: { promptMicroUsdPer1k: 5_000, completionMicroUsdPer1k: 25_000 },
  },
};

/**
 * Refuse a policy that could inflate a denominator.
 *
 * Called by `estimateBaselineCost` on every estimate rather than once at
 * construction, because a policy is a plain value and a caller can build one.
 * Validating at the point of use is what makes "the baseline cannot be tuned to
 * hit a target" true of every call site rather than of the well-behaved ones.
 */
export function assertBaselinePolicy(policy: BaselinePolicy): void {
  const problems: string[] = [];
  if (!policy.policyVersion?.trim()) problems.push('policyVersion is empty');
  if (policy.profileRule !== 'caller_maximum') problems.push('profileRule must be caller_maximum');
  if (policy.promptRule !== 'all_candidate_context') {
    problems.push('promptRule must be all_candidate_context');
  }
  if (policy.completionRule !== 'full_allowance') {
    problems.push('completionRule must be full_allowance');
  }
  if (!Number.isInteger(policy.assumedAttempts) || policy.assumedAttempts < 1) {
    problems.push('assumedAttempts must be a positive integer');
  }
  if (policy.assumedAttempts > MAX_BASELINE_ATTEMPTS) {
    problems.push(`assumedAttempts must not exceed ${MAX_BASELINE_ATTEMPTS}`);
  }
  for (const [profile, band] of Object.entries(policy.prices)) {
    if (!(band.promptMicroUsdPer1k >= 0) || !(band.completionMicroUsdPer1k >= 0)) {
      problems.push(`${profile} has a negative rate`);
    }
  }
  if (problems.length > 0) {
    throw compressionFailure(
      'compression_input_invalid',
      'The baseline cost policy is not usable.',
      { diagnostics: problems.join('; ') },
    );
  }
}

export interface BaselineInput {
  /**
   * Tokens EVERY candidate context item would have occupied, deduplicated by
   * nothing.
   *
   * This is `ContextSelection.beforeTokens` — the same measurement the context
   * value engine produced, not a second one taken here. One measurement with one
   * owner is what stops the baseline and the savings ledger disagreeing about
   * what the unoptimised prompt would have been.
   */
  readonly candidateContextTokens: number;
  readonly envelope: ControlPlaneEnvelope;
  readonly policy?: BaselinePolicy;
}

function costMicroUsd(
  policy: BaselinePolicy,
  profile: CapabilityProfile,
  promptTokens: number,
  completionTokens: number,
): number {
  const band = policy.prices[profile];
  return Math.ceil(
    (promptTokens * band.promptMicroUsdPer1k) / 1000 +
      (completionTokens * band.completionMicroUsdPer1k) / 1000,
  );
}

/**
 * What this task would have cost unoptimised.
 *
 * Pure and total: same inputs, same output, no clock, no store, no randomness.
 * That is what `baseline reproducibility` asserts, and it is what lets a
 * reviewer recompute a persisted estimate from the policy version and the
 * declared sizes rather than trusting the number in front of them.
 */
export function estimateBaselineCost(input: BaselineInput): BaselineEstimate {
  const policy = input.policy ?? BASELINE_POLICY_V1;
  assertBaselinePolicy(policy);

  const { envelope } = input;
  const assumptions: BaselineAssumption[] = [
    'profile_caller_maximum',
    'prompt_all_candidate_context',
    'completion_full_allowance',
  ];

  // THE BAND. The caller's own maximum, and never higher — and if the caller's
  // declared maximum is somehow not in its own allow list, the highest band that
  // IS. A baseline priced at a band the tenant could not have requested is the
  // inflated-profile attack.
  const permitted = envelope.allowedCapabilityProfiles.filter(
    (profile) => CAPABILITY_RANK[profile] <= CAPABILITY_RANK[envelope.maximumCapabilityProfile],
  );
  const baselineCapabilityProfile: CapabilityProfile =
    permitted.length === 0
      ? envelope.maximumCapabilityProfile
      : permitted.sort((a, b) => CAPABILITY_RANK[b] - CAPABILITY_RANK[a])[0];

  // THE COMPLETION. The whole allowance, because that is what a system with no
  // budget planner asks for — clamped to the allowance itself, which is a
  // tautology stated explicitly so a later edit cannot quietly break it.
  const perAttemptOutput = Math.max(0, Math.floor(envelope.maxCompletionTokens));

  // THE PROMPT. Every candidate item, clamped to what the caller could actually
  // have sent. Both clamps matter: the prompt ceiling on its own, and the total
  // ceiling less the completion the reference policy just reserved.
  const uncapped = Math.max(0, Math.floor(input.candidateContextTokens));
  const promptRoom = Math.max(0, envelope.maxTotalTokens - perAttemptOutput);
  const perAttemptInput = Math.min(uncapped, envelope.maxPromptTokens, promptRoom);
  if (perAttemptInput < uncapped) assumptions.push('clamped_to_envelope');

  const attempts = policy.assumedAttempts;
  if (attempts > 1) assumptions.push('attempts_modelled');

  const baselineEstimatedInputTokens = perAttemptInput * attempts;
  const baselineEstimatedOutputTokens = perAttemptOutput * attempts;

  return {
    baselinePolicyVersion: policy.policyVersion,
    baselineCapabilityProfile,
    baselineEstimatedInputTokens,
    baselineEstimatedOutputTokens,
    baselineEstimatedTotalTokens: baselineEstimatedInputTokens + baselineEstimatedOutputTokens,
    baselineEstimatedCostMicroUsd: costMicroUsd(
      policy,
      baselineCapabilityProfile,
      baselineEstimatedInputTokens,
      baselineEstimatedOutputTokens,
    ),
    baselineAssumedAttempts: attempts,
    assumptions,
  };
}

/**
 * Cost a PLANNED (optimised) execution under the same price table.
 *
 * Same rates, same arithmetic, different sizes — which is the only way a
 * baseline and an optimised projection can be subtracted from one another and
 * produce a meaningful difference. Costing the two under different tables would
 * make the gap an artefact of the tables.
 */
export function projectOptimizedCost(input: {
  readonly profile: CapabilityProfile;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly attempts: number;
  readonly policy?: BaselinePolicy;
}): number {
  const policy = input.policy ?? BASELINE_POLICY_V1;
  const attempts = Math.max(1, Math.floor(input.attempts));
  return costMicroUsd(
    policy,
    input.profile,
    Math.max(0, Math.floor(input.promptTokens)) * attempts,
    Math.max(0, Math.floor(input.completionTokens)) * attempts,
  );
}
