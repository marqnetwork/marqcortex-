/**
 * Token budget planner (AI-01 Batch 3B, Part 6A).
 *
 * ── IT NARROWS. IT CANNOT WIDEN. ───────────────────────────────────────────
 *
 * Every number this module returns is the MINIMUM of something it computed and
 * something the caller already permitted. That is not a policy the code follows;
 * it is the only arithmetic the code performs on a ceiling. There is no branch
 * in this file where a planned limit can exceed the envelope it was given, which
 * is why "the optimiser widened a Control Plane limit" is a claim a reader can
 * settle by reading forty lines rather than by running a test.
 *
 * ── WHY THE COMPLETION ALLOWANCE IS PLANNED AT ALL ─────────────────────────
 *
 * A system with no planner asks for its maximum completion on every call,
 * because the maximum is the safe default when nobody has thought about it. That
 * is a real and large cost: completion tokens are the expensive half of most
 * price tables, and a classification task that reserves four thousand of them
 * has pre-paid for an essay it will never receive.
 *
 * So the reservation is sized from the task's own declared expectation plus a
 * headroom multiplier — generous enough that a truncated completion is a
 * pathology rather than a Tuesday — and then clamped to the envelope. The
 * headroom exists because under-reserving costs a retry, and a retry costs more
 * than the tokens the tight reservation saved.
 *
 * ── THE CEILING IS CHECKED, NOT ASSUMED ────────────────────────────────────
 *
 * `plannedTotalTokens` is bounded by the envelope's own total, which can be
 * lower than prompt + completion individually allow. A planner that returned the
 * two component limits and left their sum unchecked would produce a plan the
 * control plane refuses — a control that fails at the wrong layer, which is how
 * a limit becomes an error message instead of a budget.
 */

import type { AiTaskDescriptor, ControlPlaneEnvelope } from '../contracts/task.ts';
import type { ComplexityClass } from './complexityClassifier.ts';
import { compressionFailure } from '../contracts/compression.ts';

/**
 * Completion headroom over the caller's own expectation, per complexity class.
 *
 * Higher for harder work because a reasoning task's output length is genuinely
 * less predictable than an extraction's, and the cost of guessing low is a whole
 * second call.
 */
const OUTPUT_HEADROOM: Readonly<Record<ComplexityClass, number>> = {
  deterministic: 1,
  trivial: 1.25,
  simple: 1.25,
  standard: 1.5,
  complex: 1.75,
  high_reasoning: 2,
};

/** Never reserve less than this, whatever the caller expects. */
const MINIMUM_OUTPUT_TOKENS = 64;

export interface TokenBudgetPlan {
  /** Required context tokens, unreducible. */
  readonly requiredInputTokens: number;
  /** Tokens optional context may occupy. Zero when the ceiling is tight. */
  readonly optionalInputAllowanceTokens: number;
  /** The prompt ceiling this task will be executed under. */
  readonly plannedPromptTokens: number;
  /** The completion allowance this task will request. */
  readonly reservedOutputTokens: number;
  /** Prompt plus completion. Bounded by the envelope's own total. */
  readonly plannedTotalTokens: number;
  /** The envelope's total, carried so a reviewer can see the clamp. */
  readonly envelopeTotalTokens: number;
  /** True when any planned figure was clamped down to the envelope. */
  readonly narrowed: boolean;
}

export interface TokenBudgetInput {
  readonly task: AiTaskDescriptor;
  readonly complexity: ComplexityClass;
  readonly envelope: ControlPlaneEnvelope;
  /** Required context tokens, from the context value engine. */
  readonly requiredInputTokens: number;
  /**
   * Historical mean output tokens for this task shape, when the caller has
   * trusted data for it.
   *
   * Used only to RAISE the expectation toward reality, never to lower a
   * reservation below what the caller asked for: a history that under-reports
   * would otherwise become a mechanism for systematically truncating output, and
   * a truncated answer costs a retry plus the original call.
   */
  readonly historicalOutputTokens?: number;
}

/**
 * Compute the budget.
 *
 * Throws `required_context_exceeds_ceiling` when the required context does not
 * fit the caller's own prompt ceiling — the same fail-closed rule the context
 * engine applies, applied again here because this function can be called with a
 * required figure the context engine never saw.
 */
export function planTokenBudget(input: TokenBudgetInput): TokenBudgetPlan {
  const { envelope } = input;
  const requiredInputTokens = Math.max(0, Math.floor(input.requiredInputTokens));

  if (requiredInputTokens > envelope.maxPromptTokens) {
    throw compressionFailure(
      'required_context_exceeds_ceiling',
      'This task needs more required context than it is allowed to send.',
      {
        diagnostics:
          `required=${requiredInputTokens} promptCeiling=${envelope.maxPromptTokens}`,
      },
    );
  }

  const expected = Math.max(
    MINIMUM_OUTPUT_TOKENS,
    Math.floor(input.task.expectedOutputTokens),
    Math.floor(input.historicalOutputTokens ?? 0),
  );
  const desiredOutput = Math.ceil(expected * OUTPUT_HEADROOM[input.complexity]);

  // Narrowing, expressed as the only operation performed on a ceiling.
  const reservedOutputTokens = Math.min(desiredOutput, envelope.maxCompletionTokens);

  // Whatever the total ceiling leaves after the completion reservation, capped
  // by the prompt ceiling. Checked in this order because the completion is the
  // part that cannot be trimmed at execution time — a prompt can lose an
  // optional item, an answer cannot lose its second half.
  const promptRoomFromTotal = Math.max(0, envelope.maxTotalTokens - reservedOutputTokens);
  const plannedPromptTokens = Math.min(envelope.maxPromptTokens, promptRoomFromTotal);

  if (requiredInputTokens > plannedPromptTokens) {
    throw compressionFailure(
      'required_context_exceeds_ceiling',
      'This task needs more required context than its total token budget allows.',
      {
        diagnostics:
          `required=${requiredInputTokens} plannedPrompt=${plannedPromptTokens} ` +
          `total=${envelope.maxTotalTokens} reservedOutput=${reservedOutputTokens}`,
      },
    );
  }

  const plannedTotalTokens = Math.min(
    plannedPromptTokens + reservedOutputTokens,
    envelope.maxTotalTokens,
  );

  return {
    requiredInputTokens,
    optionalInputAllowanceTokens: Math.max(0, plannedPromptTokens - requiredInputTokens),
    plannedPromptTokens,
    reservedOutputTokens,
    plannedTotalTokens,
    envelopeTotalTokens: envelope.maxTotalTokens,
    narrowed:
      plannedPromptTokens < envelope.maxPromptTokens ||
      reservedOutputTokens < envelope.maxCompletionTokens ||
      plannedTotalTokens < envelope.maxTotalTokens,
  };
}
