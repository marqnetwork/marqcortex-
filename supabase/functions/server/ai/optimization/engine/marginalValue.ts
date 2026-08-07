/**
 * Marginal value and stop control (AI-01 Batch 3B, Part 6A).
 *
 * ── THE FAILURE THIS EXISTS FOR IS NOT A BUG ───────────────────────────────
 *
 * It is the normal behaviour of a system given a task it cannot finish: try,
 * observe that it did not work, try again, spend money every time. The agent
 * runtime's `limits.ts` already stops the runaway case with hard ceilings. This
 * asks a narrower and more expensive question one step earlier: given that
 * another attempt is PERMITTED, is it WORTH ANYTHING?
 *
 * Three attempts that each produce a different wrong answer are within every
 * limit and are pure waste. A stop control that only fires at the ceiling has
 * paid for all three.
 *
 * ── THE PROTECTIONS COME FIRST, AND THEY ARE ABSOLUTE ──────────────────────
 *
 * Before any economics are considered, four kinds of work are exempt: safety
 * work, approval-bound work, mandatory workflow steps, and explicitly required
 * correctness checks. `mustNotStop` returns before a single cost is compared,
 * so there is no ordering of inputs and no budget pressure under which the
 * economics can reach them.
 *
 * This is the invariant that keeps a cost optimiser from becoming a safety
 * incident. A saving obtained by skipping a mandatory compliance step is not a
 * saving — it is a control failure that happens to reduce a bill, and the
 * adversarial suite treats it as such.
 *
 * ── WHAT "IMPROVEMENT" MEANS HERE ──────────────────────────────────────────
 *
 * `improvementSignal` is 0–100, supplied by the caller from evidence it already
 * has: how much closer the last attempt got than the one before it. It is not a
 * model's self-assessment and it is not a similarity score against a reference
 * answer nobody has. Two identical outputs in a row score zero, which is exactly
 * the case worth stopping — the same "no progress" judgement the agent runtime
 * already makes on output digests, applied to money instead of to steps.
 */

import type { AiTaskDescriptor } from '../contracts/task.ts';
import type { CompressionReason } from '../contracts/compression.ts';

export interface MarginalValueInput {
  readonly task: AiTaskDescriptor;
  /** Attempts already made for this task. Zero before the first. */
  readonly attemptsMade: number;
  /** Attempts the caller's own policy permits. Never widened here. */
  readonly maxAttempts: number;
  /**
   * 0–100. How much the last attempt improved on its predecessor.
   *
   * Absent before the second attempt, when there is nothing to compare against
   * — and absence is treated as "no evidence either way", never as zero.
   */
  readonly improvementSignal?: number;
  readonly remainingCostMicroUsd: number;
  readonly expectedAdditionalCostMicroUsd: number;
  /**
   * True when the workflow REQUIRES a result from this task and has no
   * alternative path. A required step that has not yet produced anything is
   * protected in the same way a mandatory one is.
   */
  readonly workflowRequiresResult: boolean;
  /** True when a result has already been produced and accepted. */
  readonly acceptableResultExists: boolean;
}

export interface MarginalValueDecision {
  readonly admit: boolean;
  readonly reason: CompressionReason;
  readonly diagnostics: string;
  /**
   * Micro-USD not spent because the attempt was refused.
   *
   * Zero when the attempt is admitted, and zero when it was refused by the
   * caller's OWN ceiling rather than by this policy — a saving the platform did
   * not cause is not the platform's to claim, and counting a limit that would
   * have fired anyway is one of the ways an inflated ledger is built.
   */
  readonly avoidedCostMicroUsd: number;
}

/**
 * Below this, an improvement is treated as noise rather than progress.
 *
 * A fixed constant so the decision is reproducible. Ten points on a hundred-
 * point scale is the smallest movement that is plausibly a real difference
 * rather than a re-wording.
 */
const IMPROVEMENT_FLOOR = 10;

/**
 * Work no cost policy may stop.
 *
 * Exported so a test can assert on the predicate directly. If this ever returns
 * false for a mandatory step, several tests fail, and that is the intent — the
 * protection should be provable in isolation from the arithmetic it guards.
 */
export function mustNotStop(input: MarginalValueInput): CompressionReason | undefined {
  if (input.task.safetyCritical) return 'safety_work_protected';
  if (input.task.approvalBound) return 'safety_work_protected';
  if (input.task.mandatory) return 'mandatory_step_protected';
  // A required step that has produced nothing acceptable yet is still doing its
  // first job. Stopping it to save money would not defer a cost, it would fail
  // the workflow — which is not a cheaper outcome, only a worse one.
  if (input.workflowRequiresResult && !input.acceptableResultExists) {
    return 'mandatory_step_protected';
  }
  return undefined;
}

/**
 * Decide whether one more inference attempt is permitted.
 *
 * The order is the policy: protections, then the caller's own ceiling, then
 * affordability, then value.
 */
export function admitAdditionalAttempt(input: MarginalValueInput): MarginalValueDecision {
  const protectedReason = mustNotStop(input);
  if (protectedReason !== undefined) {
    return {
      admit: true,
      reason: protectedReason,
      diagnostics:
        `protected work admitted regardless of marginal value: ` +
        `mandatory=${input.task.mandatory} safety=${input.task.safetyCritical} ` +
        `approvalBound=${input.task.approvalBound}`,
      avoidedCostMicroUsd: 0,
    };
  }

  // The caller's own ceiling. Reported as a refusal but NOT as a saving: this
  // limit exists with or without the compression engine, so attributing its
  // effect here would be counting somebody else's control as our own.
  if (input.attemptsMade >= input.maxAttempts) {
    return {
      admit: false,
      reason: 'attempt_ceiling_reached',
      diagnostics: `attempts=${input.attemptsMade} ceiling=${input.maxAttempts}`,
      avoidedCostMicroUsd: 0,
    };
  }

  if (input.expectedAdditionalCostMicroUsd > input.remainingCostMicroUsd) {
    return {
      admit: false,
      reason: 'insufficient_remaining_budget',
      diagnostics:
        `expected=${input.expectedAdditionalCostMicroUsd} ` +
        `remaining=${input.remainingCostMicroUsd}`,
      avoidedCostMicroUsd: Math.max(0, input.expectedAdditionalCostMicroUsd),
    };
  }

  // The first attempt has nothing to improve on, so there is no value judgement
  // to make. Admitting it is not a concession — it is the only way any evidence
  // is ever produced.
  if (input.attemptsMade === 0) {
    return {
      admit: true,
      reason: 'inference_required',
      diagnostics: 'first attempt; no prior result to improve on',
      avoidedCostMicroUsd: 0,
    };
  }

  const signal = input.improvementSignal;
  if (signal === undefined) {
    // No evidence either way. Admitting is the conservative choice for
    // CORRECTNESS, which outranks the conservative choice for cost.
    return {
      admit: true,
      reason: 'inference_required',
      diagnostics: 'no improvement signal supplied; admitted rather than assumed worthless',
      avoidedCostMicroUsd: 0,
    };
  }

  if (signal <= 0) {
    return {
      admit: false,
      reason: 'no_improvement_signal',
      diagnostics: `improvement=${signal} after ${input.attemptsMade} attempts`,
      avoidedCostMicroUsd: Math.max(0, input.expectedAdditionalCostMicroUsd),
    };
  }

  if (signal < IMPROVEMENT_FLOOR && input.acceptableResultExists) {
    return {
      admit: false,
      reason: 'marginal_value_below_floor',
      diagnostics:
        `improvement=${signal} floor=${IMPROVEMENT_FLOOR} and an acceptable result exists`,
      avoidedCostMicroUsd: Math.max(0, input.expectedAdditionalCostMicroUsd),
    };
  }

  return {
    admit: true,
    reason: 'inference_required',
    diagnostics: `improvement=${signal} attempts=${input.attemptsMade}/${input.maxAttempts}`,
    avoidedCostMicroUsd: 0,
  };
}
