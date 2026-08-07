/**
 * The truthful baseline (AI-01 Batch 3B, Part 6A).
 *
 * ── THIS IS THE FILE THAT MAKES THE SAVINGS NUMBER HONEST OR WORTHLESS ─────
 *
 * A savings percentage is a ratio, and a ratio has two halves. Optimised cost is
 * measured — it comes back from the control plane as reported usage. The
 * baseline is not measured, because the unoptimised call never happened, so it
 * has to be MODELLED. And a modelled denominator is precisely where a cost
 * optimiser becomes a marketing instrument: inflate it and every ratio improves
 * without a single token being saved.
 *
 * Three properties defend against that, and all three are enforced by tests:
 *
 *   THE BASELINE IS A DOCUMENTED POLICY, VERSIONED. `BaselinePolicy` below is a
 *   value, not a procedure. It states what an unoptimised Cortex would have
 *   done — send the full candidate context, ask for the full completion
 *   allowance, at the highest capability band the caller was permitted, with the
 *   retry allowance it would have spent. Every number in a baseline estimate is
 *   derived from those declared rules and the task's own declared sizes.
 *
 *   IT CANNOT SEE THE OPTIMISED RESULT. `estimateBaselineCost` takes a task, an
 *   envelope and a policy. It does not take the optimised cost, the actual cost,
 *   a target percentage or anything derived from them. `optimised / (1 - target)`
 *   is not merely discouraged here — the value needed to compute it is not in
 *   scope of the function that would compute it.
 *
 *   IT IS REPRODUCIBLE. Same task, same envelope, same policy version, same
 *   numbers, on every isolate and in every test. A baseline that drifted would
 *   make two runs of the same work report different savings, and the first
 *   person to notice would be right to distrust all of it.
 *
 * ── WHY THE POLICY IS PINNED PER ESTIMATE ──────────────────────────────────
 *
 * `baselinePolicyVersion` is persisted with every estimate. When the policy
 * changes — because the platform's idea of "unoptimised" changes — old estimates
 * keep the version they were computed under instead of being silently restated.
 * A savings history that rewrites itself when a constant changes is a savings
 * history nobody can reconcile against an invoice.
 */

import type { CapabilityProfile } from './compression.ts';

/**
 * The declared price band of one capability profile, in micro-USD per 1k tokens.
 *
 * PLANNING FIGURES, NOT BILLING FIGURES — exactly as
 * `agents/runtime/defaultProfiles.ts` says of its own rates, and for the same
 * reason. Billing is what the provider reported. These exist so a call that
 * never happened can be costed at all, and the whole point of the baseline is
 * costing a call that never happened.
 *
 * They are declared per BAND rather than per model so that the baseline stays
 * provider-neutral: a vendor price change moves the actual cost and leaves the
 * baseline where the policy version put it, which is the correct behaviour for
 * a reference point.
 */
export interface CapabilityPriceBand {
  readonly promptMicroUsdPer1k: number;
  readonly completionMicroUsdPer1k: number;
}

/**
 * The versioned, documented definition of "what this would have cost
 * unoptimised".
 *
 * Every field is a rule an auditor can read and disagree with, which is the
 * property a baseline needs. None of them can be set from a savings target.
 */
export interface BaselinePolicy {
  /** Pinned onto every estimate. Bump on ANY change to the rules below. */
  readonly policyVersion: string;
  /** Human-readable statement of the reference behaviour. */
  readonly description: string;
  /**
   * The band an unoptimised call would have used.
   *
   * `caller_maximum` — the highest band the caller was ALREADY permitted to
   * request. Not the highest band that exists: charging the baseline for a band
   * the tenant could never have used is the "inflate the baseline model profile"
   * attack, and this is the rule that forecloses it.
   */
  readonly profileRule: 'caller_maximum';
  /**
   * How an unoptimised call would have sized its prompt.
   *
   * `all_candidate_context` — every candidate item, required and optional,
   * with no deduplication and no relevance filtering. That is what a system
   * without a context value engine actually does.
   */
  readonly promptRule: 'all_candidate_context';
  /**
   * How an unoptimised call would have sized its completion.
   *
   * `full_allowance` — the caller's whole completion ceiling, because a system
   * with no budget planner asks for its maximum. Bounded by the envelope, so it
   * can never exceed what the caller could actually have requested.
   */
  readonly completionRule: 'full_allowance';
  /**
   * Attempts an unoptimised system would have spent before giving up.
   *
   * Modelled explicitly rather than assumed to be one, because a system with no
   * marginal-value control retries until its ceiling — and a baseline that
   * costed only the happy path would UNDER-state the reference, which is the
   * one direction of error that would make savings look worse than they are.
   * Bounded hard by `MAX_BASELINE_ATTEMPTS` so the rule cannot be tuned upward
   * into an inflated denominator.
   */
  readonly assumedAttempts: number;
  readonly prices: Readonly<Record<CapabilityProfile, CapabilityPriceBand>>;
}

/**
 * The hard ceiling on `assumedAttempts`.
 *
 * The single most effective way to fake a 90% result is to declare that the
 * unoptimised system would have tried ten times. Two is what the platform's own
 * retry policies actually permit for an unattended step, and a policy declaring
 * more is refused at construction rather than believed.
 */
export const MAX_BASELINE_ATTEMPTS = 2;

/** Why a baseline estimate came out the way it did. */
export const BASELINE_ASSUMPTIONS = [
  'profile_caller_maximum',
  'prompt_all_candidate_context',
  'completion_full_allowance',
  'attempts_modelled',
  'clamped_to_envelope',
] as const;

export type BaselineAssumption = (typeof BASELINE_ASSUMPTIONS)[number];

/**
 * What the same task would have cost under the reference policy.
 *
 * Persisted alongside the optimised execution, in full, so a reviewer can
 * recompute it from the policy version and the declared sizes without trusting
 * the number in front of them.
 */
export interface BaselineEstimate {
  readonly baselinePolicyVersion: string;
  readonly baselineCapabilityProfile: CapabilityProfile;
  readonly baselineEstimatedInputTokens: number;
  readonly baselineEstimatedOutputTokens: number;
  readonly baselineEstimatedTotalTokens: number;
  readonly baselineEstimatedCostMicroUsd: number;
  /** Attempts the reference policy assumed. Already folded into the cost. */
  readonly baselineAssumedAttempts: number;
  readonly assumptions: readonly BaselineAssumption[];
}
