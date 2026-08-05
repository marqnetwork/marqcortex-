/**
 * Deterministic complexity classification (AI-01 Batch 3B).
 *
 * THE QUESTION THIS ANSWERS: how hard is this step, judged from facts the
 * platform can measure before it runs?
 *
 * Batch 3A routed every model step as `complexity: 'standard'` and
 * `minimumQuality: 'standard'`, hard-coded at the call site. That is a correct
 * default and a wasteful one: a two-line objective with one trusted context
 * section and a single required output field is not the same work as a
 * multi-section brief carrying tool output, a handoff payload and six required
 * fields, and paying the same rate for both is the platform's money.
 *
 * WHY A SCORE AND NOT A MODEL. The obvious way to classify difficulty is to ask
 * a model, and that is exactly the wrong answer here: it costs a call to decide
 * whether to make a call, it is not reproducible, and it puts an unbounded input
 * in front of the component that decides how much may be spent. Everything below
 * is arithmetic over integers. The same signals always produce the same class,
 * on every isolate, in every test, which is what lets the routing decision be
 * replayed during an incident review.
 *
 * WHAT THE CLASS IS USED FOR, AND WHAT IT IS NEVER USED FOR. It raises or lowers
 * the FLOOR a profile must clear (`profileSelection.ts`). It never selects a
 * model, never selects a provider, never widens an agent's allow list and never
 * relaxes a safety requirement — a classification that could talk the platform
 * into a weaker posture would be an optimisation with a security consequence.
 * The only direction it can move a step in is toward a cheaper profile that is
 * still capable of the work.
 */

import type { ModelComplexity, ModelQuality } from '../agents/runtime/modelRouting.ts';

/**
 * The measurable properties of a step. Every field is a count or a flag the
 * orchestrator already holds before the call — nothing here requires new
 * instrumentation, and nothing here is content.
 */
export interface ComplexitySignals {
  /** Characters of assembled context. Size is the coarsest honest signal. */
  readonly contextChars: number;
  /** Sections the builder included. Breadth, as distinct from length. */
  readonly contextSections: number;
  /** Included sections the builder had to fence. Untrusted input is harder. */
  readonly untrustedSections: number;
  /** Fields the answer must carry. A wider contract is a harder answer. */
  readonly requiredOutputFields: number;
  /** True when the step must return parseable structure rather than prose. */
  readonly requiresStructuredOutput: boolean;
  /** Steps this run has already taken. Later steps carry more accumulated state. */
  readonly priorSteps: number;
  /** Handoffs so far. A delegated task is reasoning about somebody else's work. */
  readonly handoffDepth: number;
  /** True when the previous observation was a failure being reasoned about. */
  readonly recoveringFromFailure: boolean;
  /** Characters of the objective itself. */
  readonly objectiveChars: number;
}

export interface ComplexityClassification {
  readonly complexity: ModelComplexity;
  /** The quality floor routing must clear. Never above what the caller asked. */
  readonly minimumQuality: ModelQuality;
  /** The integer the thresholds were applied to. Recorded, so it is auditable. */
  readonly score: number;
  /**
   * Which signals contributed, largest first. Bounded labels — they go into the
   * audit trail, so "why was this routed cheaply?" has an answer that does not
   * require re-running the classifier against remembered inputs.
   */
  readonly drivers: readonly string[];
}

/**
 * Score thresholds.
 *
 * Chosen so the DEFAULT is `standard`: a step with an ordinary brief and an
 * ordinary contract classifies exactly where Batch 3A hard-coded it, and the
 * classifier only moves a step when the signals are clearly at one end. An
 * optimisation whose default differs from the certified behaviour is a
 * behaviour change wearing an optimisation's clothes.
 */
export const COMPLEXITY_THRESHOLDS = {
  /** Below this, the work is small enough that the cheapest capable profile wins. */
  low: 20,
  /** At or above this, the step keeps the full quality floor. */
  high: 60,
} as const;

/** Points each signal may contribute. Capped, so no single signal dominates. */
const WEIGHTS = {
  contextChars: { per: 2_000, cap: 24 },
  contextSections: { per: 2, cap: 12 },
  untrustedSections: { per: 1, cap: 12 },
  requiredOutputFields: { per: 1, cap: 15 },
  priorSteps: { per: 1, cap: 12 },
  handoffDepth: { per: 1, cap: 10 },
  objectiveChars: { per: 300, cap: 9 },
} as const;

const STRUCTURED_OUTPUT_POINTS = 6;
const RECOVERY_POINTS = 10;

function bounded(value: number, per: number, cap: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(cap, Math.floor(value / per));
}

/**
 * Classify a step.
 *
 * Total by construction: every input is clamped, so a negative, fractional or
 * non-finite signal contributes zero rather than producing a class nobody can
 * explain. A classifier that can throw is a classifier that can stop a run, and
 * a step that cannot be classified should be run at the default, not refused.
 */
export function classifyComplexity(signals: ComplexitySignals): ComplexityClassification {
  const parts: { label: string; points: number }[] = [
    {
      label: 'context_size',
      points: bounded(signals.contextChars, WEIGHTS.contextChars.per, WEIGHTS.contextChars.cap),
    },
    {
      label: 'context_breadth',
      points: bounded(
        signals.contextSections,
        WEIGHTS.contextSections.per,
        WEIGHTS.contextSections.cap,
      ),
    },
    {
      label: 'untrusted_input',
      points: bounded(
        signals.untrustedSections,
        WEIGHTS.untrustedSections.per,
        WEIGHTS.untrustedSections.cap,
      ),
    },
    {
      label: 'output_contract',
      points: bounded(
        signals.requiredOutputFields,
        WEIGHTS.requiredOutputFields.per,
        WEIGHTS.requiredOutputFields.cap,
      ),
    },
    {
      label: 'accumulated_state',
      points: bounded(signals.priorSteps, WEIGHTS.priorSteps.per, WEIGHTS.priorSteps.cap),
    },
    {
      label: 'handoff_depth',
      points: bounded(signals.handoffDepth, WEIGHTS.handoffDepth.per, WEIGHTS.handoffDepth.cap),
    },
    {
      label: 'objective_size',
      points: bounded(
        signals.objectiveChars,
        WEIGHTS.objectiveChars.per,
        WEIGHTS.objectiveChars.cap,
      ),
    },
    {
      label: 'structured_output',
      points: signals.requiresStructuredOutput ? STRUCTURED_OUTPUT_POINTS : 0,
    },
    { label: 'failure_recovery', points: signals.recoveringFromFailure ? RECOVERY_POINTS : 0 },
  ];

  const score = parts.reduce((total, part) => total + part.points, 0);

  const complexity: ModelComplexity =
    score >= COMPLEXITY_THRESHOLDS.high
      ? 'high'
      : score < COMPLEXITY_THRESHOLDS.low
        ? 'low'
        : 'standard';

  /**
   * The quality floor moves only DOWNWARD, and only for the smallest class.
   *
   * `high` and `standard` both keep the `standard` floor that Batch 3A applied.
   * Raising the floor above it would let the classifier make a step MORE
   * expensive than the agent asked for, which is not an optimisation and is not
   * a decision this module is entitled to make.
   */
  const minimumQuality: ModelQuality = complexity === 'low' ? 'baseline' : 'standard';

  const drivers = parts
    .filter((part) => part.points > 0)
    .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label))
    .slice(0, 4)
    .map((part) => `${part.label}:${part.points}`);

  return { complexity, minimumQuality, score, drivers };
}

/**
 * Build signals from what the orchestrator holds at a model step.
 *
 * Separated from the scoring so the scorer stays a pure function of numbers and
 * the mapping from runtime shapes lives in one place. Callers pass counts, not
 * content: nothing in this file ever sees a prompt.
 */
export function complexitySignalsFor(input: {
  readonly contextChars: number;
  readonly includedSections: number;
  readonly untrustedSections: number;
  readonly requiredOutputFields: number;
  readonly requiresStructuredOutput: boolean;
  readonly stepCount: number;
  readonly handoffCount: number;
  readonly lastObservationFailed: boolean;
  readonly objectiveChars: number;
}): ComplexitySignals {
  return {
    contextChars: input.contextChars,
    contextSections: input.includedSections,
    untrustedSections: input.untrustedSections,
    requiredOutputFields: input.requiredOutputFields,
    requiresStructuredOutput: input.requiresStructuredOutput,
    priorSteps: input.stepCount,
    handoffDepth: input.handoffCount,
    recoveringFromFailure: input.lastObservationFailed,
    objectiveChars: input.objectiveChars,
  };
}
