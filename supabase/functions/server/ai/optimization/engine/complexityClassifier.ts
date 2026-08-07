/**
 * Task complexity classifier (AI-01 Batch 3B, Part 6A).
 *
 * ── IT DOES NOT CALL A MODEL TO DECIDE WHICH MODEL TO CALL ─────────────────
 *
 * That sentence is the whole design constraint, and it is not a stylistic
 * preference. A classifier that asked an LLM which LLM to use would spend a call
 * to save a call, be non-reproducible, and put the cheapest decision in the
 * system behind the most expensive component in the system. So this is a pure
 * function over declared metadata: same descriptor in, same class out, on every
 * isolate and in every test, forever.
 *
 * ── HOW IT DECIDES ─────────────────────────────────────────────────────────
 *
 * A small additive score over declared characteristics, then fixed thresholds.
 * Additive rather than a decision tree because the reason codes have to explain
 * the answer: with a score, "why was this `complex`" is answered by listing the
 * signals that fired, and each signal is one readable line. A tree would give
 * the same answer and no account of it.
 *
 * Two rules sit OUTSIDE the score, deliberately:
 *
 *   THE TASK KIND FLOOR. A `reasoning` task is never `trivial` however small its
 *   payload, because the shape of the work — not its size — is what makes a
 *   small model wrong at it. The floor lifts the class; it never lowers it.
 *
 *   THE DETERMINISTIC CLASS. Only a task whose kind is inherently mechanical
 *   (retrieval, transformation, calculation) can be classified `deterministic`,
 *   and only when it also carries no reasoning requirement. Whether an
 *   authorised path actually EXISTS is a separate question answered by
 *   `zeroLlmAdmission.ts` — this says the task is the kind of thing such a path
 *   could serve, which is a claim about the task rather than about the platform.
 */

import type { AiTaskDescriptor, AiTaskKind } from '../contracts/task.ts';
import type { CapabilityProfile } from '../contracts/compression.ts';
import { QUALITY_CAPABILITY_FLOOR } from '../contracts/compression.ts';

export const COMPLEXITY_CLASSES = [
  'deterministic',
  'trivial',
  'simple',
  'standard',
  'complex',
  'high_reasoning',
] as const;

export type ComplexityClass = (typeof COMPLEXITY_CLASSES)[number];

export const COMPLEXITY_RANK: Readonly<Record<ComplexityClass, number>> = {
  deterministic: 0,
  trivial: 1,
  simple: 2,
  standard: 3,
  complex: 4,
  high_reasoning: 5,
};

/** Signals the classifier fired. The explanation of the class, in one list. */
export const COMPLEXITY_SIGNALS = [
  'kind_mechanical',
  'kind_extractive',
  'kind_generative',
  'kind_reasoning',
  'multi_step_reasoning',
  'supplied_evidence',
  'structured_output',
  'wide_output_shape',
  'large_output',
  'approximation_tolerated',
  'quality_floor_applied',
  'task_kind_floor_applied',
] as const;

export type ComplexitySignal = (typeof COMPLEXITY_SIGNALS)[number];

/**
 * The lowest class each task kind may be classified as.
 *
 * `deterministic` for the three mechanical kinds means "may be classified that
 * low", not "is". Everything else states the floor below which the kind's
 * inherent shape makes a classification wrong regardless of payload size.
 */
const KIND_FLOOR: Readonly<Record<AiTaskKind, ComplexityClass>> = {
  retrieval: 'deterministic',
  transformation: 'deterministic',
  calculation: 'deterministic',
  extraction: 'trivial',
  classification: 'trivial',
  summarization: 'simple',
  generation: 'standard',
  reasoning: 'complex',
  planning: 'complex',
  review: 'standard',
};

/** Kinds a deterministic path could serve in principle. */
const MECHANICAL_KINDS: readonly AiTaskKind[] = ['retrieval', 'transformation', 'calculation'];

/** Kinds whose shape is inference over evidence rather than restatement of it. */
const REASONING_KINDS: readonly AiTaskKind[] = ['reasoning', 'planning', 'review'];

const EXTRACTIVE_KINDS: readonly AiTaskKind[] = [
  'extraction',
  'classification',
  'summarization',
];

export interface ComplexityClassification {
  readonly complexity: ComplexityClass;
  /** The lowest band that could serve this class AND this quality contract. */
  readonly requiredCapabilityProfile: CapabilityProfile;
  /** 0–100. How much of the score came from unambiguous signals. */
  readonly confidence: number;
  readonly signals: readonly ComplexitySignal[];
  /** The additive score, kept so a reviewer can recompute the class. */
  readonly score: number;
}

/**
 * The band each complexity class needs on its own, before quality is applied.
 *
 * The FINAL requirement is the higher of this and the quality contract's own
 * floor — see `QUALITY_CAPABILITY_FLOOR`. Two independent floors, and the task
 * has to clear both: a trivial task under a `critical` quality contract does not
 * get an economy model just because it is trivial.
 */
const CLASS_CAPABILITY: Readonly<Record<ComplexityClass, CapabilityProfile>> = {
  deterministic: 'economy',
  trivial: 'economy',
  simple: 'economy',
  standard: 'standard',
  complex: 'reasoning',
  high_reasoning: 'advanced_reasoning',
};

const CAPABILITY_ORDER: readonly CapabilityProfile[] = [
  'economy',
  'standard',
  'reasoning',
  'advanced_reasoning',
];

function higherCapability(
  left: CapabilityProfile,
  right: CapabilityProfile,
): CapabilityProfile {
  return CAPABILITY_ORDER.indexOf(left) >= CAPABILITY_ORDER.indexOf(right) ? left : right;
}

function atLeast(current: ComplexityClass, floor: ComplexityClass): ComplexityClass {
  return COMPLEXITY_RANK[current] >= COMPLEXITY_RANK[floor] ? current : floor;
}

/** Score thresholds. Fixed constants, so the mapping is reproducible. */
const THRESHOLDS: readonly (readonly [number, ComplexityClass])[] = [
  [9, 'high_reasoning'],
  [6, 'complex'],
  [4, 'standard'],
  [2, 'simple'],
  [1, 'trivial'],
];

/**
 * Classify a proposed inference.
 *
 * PURE. No clock, no store, no randomness, no I/O — which is what lets the
 * stability test assert that a hundred classifications of the same descriptor
 * are byte-identical, and what lets an incident review reproduce a routing
 * decision from the descriptor alone.
 */
export function classifyComplexity(task: AiTaskDescriptor): ComplexityClassification {
  const signals: ComplexitySignal[] = [];
  let score = 0;
  /** Signals whose contribution is unambiguous. Drives confidence. */
  let firm = 0;
  let total = 0;

  const add = (points: number, signal: ComplexitySignal, unambiguous: boolean): void => {
    score += points;
    signals.push(signal);
    total += Math.abs(points);
    if (unambiguous) firm += Math.abs(points);
  };

  if (MECHANICAL_KINDS.includes(task.kind)) add(0, 'kind_mechanical', true);
  else if (EXTRACTIVE_KINDS.includes(task.kind)) add(1, 'kind_extractive', true);
  else if (REASONING_KINDS.includes(task.kind)) add(4, 'kind_reasoning', true);
  else add(2, 'kind_generative', true);

  if (task.requiresMultiStepReasoning) add(3, 'multi_step_reasoning', true);
  if (task.requiresSuppliedEvidence) add(2, 'supplied_evidence', true);
  if (task.requiresStructuredOutput) add(1, 'structured_output', true);
  if (task.outputFieldCount > 5) add(1, 'wide_output_shape', false);
  if (task.expectedOutputTokens > 1_000) add(1, 'large_output', false);
  // The one negative signal, and the only ambiguous one: a caller that says an
  // approximation will do has told us something real about the work, but it has
  // told us about its own tolerance rather than about the task's difficulty.
  if (task.toleratesApproximation) add(-1, 'approximation_tolerated', false);

  let complexity: ComplexityClass = 'deterministic';
  for (const [threshold, candidate] of THRESHOLDS) {
    if (score >= threshold) {
      complexity = candidate;
      break;
    }
  }

  // A mechanical kind that still demands reasoning is not deterministic — the
  // kind describes the output shape, and the requirement describes the work.
  if (
    complexity === 'deterministic' &&
    (!MECHANICAL_KINDS.includes(task.kind) || task.requiresMultiStepReasoning)
  ) {
    complexity = 'trivial';
  }

  const floored = atLeast(complexity, KIND_FLOOR[task.kind]);
  if (floored !== complexity) signals.push('task_kind_floor_applied');

  const classFloor = CLASS_CAPABILITY[floored];
  const qualityFloor = QUALITY_CAPABILITY_FLOOR[task.quality];
  const requiredCapabilityProfile = higherCapability(classFloor, qualityFloor);
  if (requiredCapabilityProfile !== classFloor) signals.push('quality_floor_applied');

  return {
    complexity: floored,
    requiredCapabilityProfile,
    // Confidence is the share of the score that came from unambiguous signals.
    // A task whose class rests entirely on declared, non-heuristic facts is
    // reported at 100; one leaning on size heuristics reports lower, and the
    // escalation policy treats low confidence as a reason to be careful.
    confidence: total === 0 ? 100 : Math.round((firm / total) * 100),
    signals,
    score,
  };
}
