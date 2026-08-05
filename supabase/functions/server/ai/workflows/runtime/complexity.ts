/**
 * Task complexity classification (AI-01 Batch 3B).
 *
 * Answers one question, deterministically: how hard is this node's work? The
 * router then uses the answer to pick the smallest profile that can do it.
 *
 * CLASSIFIED FROM DECLARED CHARACTERISTICS, NEVER FROM MODEL JUDGEMENT.
 *
 * The tempting design is to ask a model "is this task complex?" and route on the
 * reply. That inverts the control: the thing being governed would decide how
 * much governance it gets, the answer would vary run to run, and no incident
 * review could reconstruct why a premium profile was chosen. So the classifier
 * reads only facts the definition and the run already carry — schema shape,
 * required capabilities, context size, output structure, risk class, evidence
 * count, approval requirement, whether a deterministic transform could have done
 * the job — and computes a score.
 *
 * THE SCORE IS A SUM OF NAMED CONTRIBUTIONS, and every one is returned. A
 * classifier that emitted only a label would be as opaque as the model call it
 * replaced; a reviewer asking "why was this reasoning_heavy?" gets the four
 * signals that made it so.
 *
 * MONOTONIC BY CONSTRUCTION. Every signal contributes a non-negative weight, so
 * adding evidence, adding output fields or raising the risk class can never
 * LOWER the class. A classifier where more work meant a cheaper model would be
 * worse than no classifier.
 */

import type { WorkflowModelNode, WorkflowSafetyClass } from '../contracts/workflow.ts';

export const TASK_COMPLEXITY_CLASSES = [
  'trivial',
  'simple',
  'standard',
  'complex',
  'reasoning_heavy',
  'multimodal',
  'high_risk',
] as const;

export type TaskComplexityClass = (typeof TASK_COMPLEXITY_CLASSES)[number];

/** Version of the formula. Bumped whenever a weight or threshold changes. */
export const COMPLEXITY_FORMULA_VERSION = '1.0.0';

export interface ComplexitySignal {
  readonly signal: string;
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
}

export interface ComplexityClassification {
  readonly classification: TaskComplexityClass;
  readonly score: number;
  readonly signals: readonly ComplexitySignal[];
  readonly formulaVersion: string;
  /** One sentence naming what drove the class. Goes into the routing record. */
  readonly explanation: string;
  /** The quality floor this class implies, before the node's own floor. */
  readonly impliedQuality: 'baseline' | 'standard' | 'high';
  /** True when a deterministic path exists and the model call is avoidable. */
  readonly deterministicAlternativeAvailable: boolean;
}

export interface ComplexityInput {
  readonly node: WorkflowModelNode;
  readonly safetyClass: WorkflowSafetyClass;
  /** Prompt tokens the optimizer produced for this step. */
  readonly contextTokens: number;
  /** Context sections that survived optimization. */
  readonly includedSections: number;
  /** Sections classified as evidence rather than instruction. */
  readonly evidenceSections: number;
  /** True when a registered transform could produce this node's output. */
  readonly deterministicAlternativeAvailable: boolean;
  /** True when the node's mapped input carries non-text content. */
  readonly multimodalInput: boolean;
}

/**
 * Weights.
 *
 * Chosen so that the two categorical overrides — multimodal and high risk —
 * cannot be reached by accumulating ordinary signals, and so that a plain
 * single-field extraction over a small context lands in `trivial` rather than
 * one step above it. The thresholds below are the only place a class boundary
 * lives.
 */
const WEIGHTS = {
  outputField: 1.0,
  contextTokensPer1k: 1.5,
  evidenceSection: 0.8,
  includedSection: 0.3,
  approvalRequired: 2.0,
  tenantWrite: 1.5,
  qualityFloorHigh: 2.5,
  structuredOutput: 0.5,
} as const;

const THRESHOLDS = {
  simple: 2.0,
  standard: 4.5,
  complex: 8.0,
  reasoningHeavy: 12.0,
} as const;

export function classifyTaskComplexity(input: ComplexityInput): ComplexityClassification {
  const { node } = input;
  const signals: ComplexitySignal[] = [];

  const push = (signal: string, value: number, weight: number): void => {
    signals.push({ signal, value, weight, contribution: Math.round(value * weight * 100) / 100 });
  };

  push('output_fields', node.requiredOutputFields.length, WEIGHTS.outputField);
  push('context_tokens_per_1k', input.contextTokens / 1000, WEIGHTS.contextTokensPer1k);
  push('evidence_sections', input.evidenceSections, WEIGHTS.evidenceSection);
  push('included_sections', input.includedSections, WEIGHTS.includedSection);
  push('approval_required', node.approval === undefined ? 0 : 1, WEIGHTS.approvalRequired);
  push(
    'tenant_write',
    input.safetyClass === 'tenant_write' || input.safetyClass === 'external_effect' ? 1 : 0,
    WEIGHTS.tenantWrite,
  );
  push('quality_floor_high', node.minimumQuality === 'high' ? 1 : 0, WEIGHTS.qualityFloorHigh);
  // Every model step in this platform requests structured output, so this is a
  // constant today. It is a named signal rather than a hidden constant because
  // the day a node does not need structure, the score should fall.
  push('structured_output', 1, WEIGHTS.structuredOutput);

  const score = Math.round(signals.reduce((sum, entry) => sum + entry.contribution, 0) * 100) / 100;

  // ── Categorical overrides ─────────────────────────────────────────────────
  //
  // Risk and modality are not "more of the same work" — they change what the
  // model has to be capable of, so they set the class outright rather than
  // adding to a score that could be diluted by a small context.
  let classification: TaskComplexityClass;
  let explanation: string;
  if (input.safetyClass === 'external_effect' || node.approval !== undefined) {
    classification = 'high_risk';
    explanation =
      node.approval === undefined
        ? 'the workflow can cause an external effect'
        : 'the node is approval-gated';
  } else if (input.multimodalInput) {
    classification = 'multimodal';
    explanation = 'the node carries non-text input';
  } else if (score >= THRESHOLDS.reasoningHeavy) {
    classification = 'reasoning_heavy';
    explanation = `score ${score} is at or above the reasoning-heavy threshold`;
  } else if (score >= THRESHOLDS.complex) {
    classification = 'complex';
    explanation = `score ${score} is at or above the complex threshold`;
  } else if (score >= THRESHOLDS.standard) {
    classification = 'standard';
    explanation = `score ${score} is at or above the standard threshold`;
  } else if (score >= THRESHOLDS.simple) {
    classification = 'simple';
    explanation = `score ${score} is at or above the simple threshold`;
  } else {
    classification = 'trivial';
    explanation = `score ${score} is below the simple threshold`;
  }

  return {
    classification,
    score,
    signals,
    formulaVersion: COMPLEXITY_FORMULA_VERSION,
    explanation,
    impliedQuality: impliedQualityFor(classification),
    deterministicAlternativeAvailable: input.deterministicAlternativeAvailable,
  };
}

/**
 * The quality floor a class implies.
 *
 * The router takes the HIGHER of this and the node's own declared floor, so a
 * classifier can raise a floor but never lower one an author set deliberately.
 */
export function impliedQualityFor(
  classification: TaskComplexityClass,
): 'baseline' | 'standard' | 'high' {
  switch (classification) {
    case 'trivial':
    case 'simple':
      return 'baseline';
    case 'standard':
      return 'standard';
    case 'complex':
    case 'reasoning_heavy':
    case 'multimodal':
    case 'high_risk':
      return 'high';
  }
}

/** The routing complexity band a class maps to. */
export function routingComplexityFor(
  classification: TaskComplexityClass,
): 'low' | 'standard' | 'high' {
  switch (classification) {
    case 'trivial':
      return 'low';
    case 'simple':
    case 'standard':
      return 'standard';
    case 'complex':
    case 'reasoning_heavy':
    case 'multimodal':
    case 'high_risk':
      return 'high';
  }
}

/** Whether a class demands the strict safety posture. */
export function requiresStrictSafety(classification: TaskComplexityClass): boolean {
  return classification === 'high_risk' || classification === 'multimodal';
}
