/**
 * The optimisation score (AI-01 Batch 3B, Part 6C).
 *
 * ── A SCORE IS A CLAIM, SO IT HAS A VERSION AND A BREAKDOWN ───────────────
 *
 * `OPTIMIZATION_SCORE_V1` is a pure function of declared inputs with published
 * weights. Same inputs, same score, forever — and the components come back with
 * it, so "why is this 62" has an answer that does not require reading this file.
 *
 * There is no model here, no learned weighting and no LLM judgement. A financial
 * score somebody cannot recompute is a score somebody will eventually be asked
 * to defend and cannot.
 *
 * ── CHEAP IS NOT GOOD: THE CAPS ────────────────────────────────────────────
 *
 * The weights reward saving money. Four conditions make that reward
 * inappropriate no matter how much was saved:
 *
 *   quality failed                     the answer was not good enough
 *   run failed through over-optimisation  the saving CAUSED the failure
 *   required context was removed       a rule that must not bend, bent
 *   safety or policy was weakened      the worst possible way to save money
 *
 * These are CAPS, not penalties, and the difference matters. A penalty of thirty
 * points can be outrun by a large enough saving; a cap cannot. A run that
 * weakened safety cannot score above `CAP_ON_VIOLATION` however cheap it was,
 * which is the only encoding of "cost optimisation is subordinate to quality"
 * that survives a sufficiently impressive savings number.
 *
 * ── AND FAILURE IS NOT REWARDED EITHER ─────────────────────────────────────
 *
 * `outcomeSuccess` is zero for a window whose runs failed, so a platform that
 * saved 99% by failing everything scores badly on the component AND is capped by
 * the over-optimisation condition when it applies. Both are needed: the first
 * handles ordinary failure, the second handles failure the optimiser caused.
 *
 * ── AN UNMEASURED SCORE IS A GUESS, AND SAYS SO ────────────────────────────
 *
 * `settlementCompleteness` is a scored component rather than a footnote, so a
 * window that has barely settled cannot reach the top of the range. The score
 * also carries the coverage figure and a confidence band, because a 90 computed
 * over 12% of spend and a 90 computed over 96% are not the same claim.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import type { SettlementCoverage } from '../contracts/report.ts';
import { percentOf } from '../contracts/report.ts';
import { foldTotals, settlementCoverage } from './settlement.ts';
import { analyzeOutcomes } from './outcomeEconomics.ts';
import { analyzeWaste, retryWasteMicroUsd } from './wasteAnalysis.ts';
import type { WasteEvidence } from './wasteAnalysis.ts';

export const OPTIMIZATION_SCORE_VERSION = 'ai.financial.score.v1';

/** Weights. Published, summing to 100, and changed only with the version. */
export const SCORE_WEIGHTS = {
  realizedSavings: 30,
  qualityPreserved: 20,
  outcomeSuccess: 20,
  retryDiscipline: 10,
  reuseEffectiveness: 5,
  contextEfficiency: 5,
  estimateAccuracy: 5,
  settlementCompleteness: 5,
} as const;

/** The ceiling a window that violated a protection cannot rise above. */
export const CAP_ON_VIOLATION = 25;

export const SCORE_REASONS = [
  'quality_contract_failed',
  'workflow_failed_after_optimization',
  'required_context_removed',
  'safety_policy_weakened',
  'no_settled_data',
  'low_settlement_coverage',
  'high_retry_waste',
  'estimates_materially_optimistic',
  'strong_realized_savings',
  'strong_reuse_effectiveness',
  'healthy_outcome_rate',
] as const;

export type ScoreReason = (typeof SCORE_REASONS)[number];

/**
 * Declared quality evidence. Facts the caller's own components established.
 *
 * The score never infers these. Whether a quality contract failed is known to
 * the escalation policy; whether required context was removed is known to the
 * context value engine, which fails closed rather than trimming. Inferring
 * either from spend would be guessing about the one thing that must not be
 * guessed at.
 */
export interface OptimizationQualityEvidence {
  readonly qualityContractFailed?: boolean;
  readonly workflowFailedAfterOptimization?: boolean;
  readonly requiredContextRemoved?: boolean;
  readonly safetyPolicyWeakened?: boolean;
}

export interface ScoreComponent {
  readonly name: keyof typeof SCORE_WEIGHTS;
  readonly weight: number;
  /** 0–100, how well this component did. */
  readonly achievedPercent: number;
  /** weight × achieved / 100, rounded. What it contributed to the score. */
  readonly points: number;
  readonly detail: string;
}

export interface OptimizationScore {
  readonly scoreVersion: string;
  /** 0–100, integer. */
  readonly score: number;
  /** The score before any cap was applied. Shown so a cap is visible. */
  readonly uncappedScore: number;
  readonly capped: boolean;
  readonly components: readonly ScoreComponent[];
  readonly reasons: readonly ScoreReason[];
  readonly coverage: SettlementCoverage;
  /** `measured`, `partial` or `insufficient`, from coverage alone. */
  readonly confidence: 'measured' | 'partial' | 'insufficient';
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function component(
  name: keyof typeof SCORE_WEIGHTS,
  achievedPercent: number,
  detail: string,
): ScoreComponent {
  const achieved = clampPercent(achievedPercent);
  const weight = SCORE_WEIGHTS[name];
  return {
    name,
    weight,
    achievedPercent: Math.round(achieved * 10) / 10,
    points: Math.round((weight * achieved) / 100),
    detail,
  };
}

export interface OptimizationScoreInput {
  readonly events: readonly FinancialEvent[];
  readonly quality?: OptimizationQualityEvidence;
  readonly waste?: WasteEvidence;
}

/**
 * Score a window.
 *
 * Pure: no clock, no store, no randomness. The same events and the same declared
 * evidence produce the same integer every time, which is what makes a score
 * comparable between two windows rather than merely suggestive.
 */
export function scoreOptimization(input: OptimizationScoreInput): OptimizationScore {
  const { events } = input;
  const quality = input.quality ?? {};
  const totals = foldTotals(events);
  const coverage = settlementCoverage(events);
  const outcomes = analyzeOutcomes(events);
  const waste = analyzeWaste(events, input.waste ?? {});
  const reasons: ScoreReason[] = [];

  // ── Realised savings, against the target rather than against zero ─────────
  // Scaled so that hitting the 90% design target scores the component at 100.
  // Scoring against 100% reduction would make a perfect result unreachable and
  // the component useless for telling good from excellent.
  const realizedReduction = percentOf(
    totals.realizedSavingsMicroUsd,
    totals.realizedBaselineCostMicroUsd,
  );
  const savingsComponent = component(
    'realizedSavings',
    (realizedReduction / 90) * 100,
    `realised ${realizedReduction}% against a 90% target on settled data`,
  );
  if (realizedReduction >= 60) reasons.push('strong_realized_savings');

  // ── Quality preserved ─────────────────────────────────────────────────────
  const qualityIntact =
    quality.qualityContractFailed !== true &&
    quality.requiredContextRemoved !== true &&
    quality.safetyPolicyWeakened !== true;
  const qualityComponent = component(
    'qualityPreserved',
    qualityIntact ? 100 : 0,
    qualityIntact ? 'no declared quality or safety violation' : 'a declared protection was violated',
  );

  // ── Outcome success ───────────────────────────────────────────────────────
  const outcomeComponent = component(
    'outcomeSuccess',
    outcomes.successRatePercent,
    `${outcomes.successfulRuns} of ${outcomes.successfulRuns + outcomes.failedRuns + outcomes.cancelledRuns} terminal runs succeeded`,
  );
  if (outcomes.successRatePercent >= 90) reasons.push('healthy_outcome_rate');

  // ── Retry discipline: the inverse of retry spend as a share of settled ────
  const retryCost = retryWasteMicroUsd(waste);
  const retryShare = percentOf(retryCost, totals.actualSettledCostMicroUsd);
  const retryComponent = component(
    'retryDiscipline',
    100 - retryShare,
    `${retryShare}% of settled spend went on attempts after the first`,
  );
  if (retryShare > 25) reasons.push('high_retry_waste');

  // ── Reuse effectiveness: avoided calls as a share of eligible work ────────
  const eligible = events.filter((event) => event.eventType !== 'refused');
  const avoided = events.filter((event) => event.eventType === 'avoided_call');
  const reuseRate = percentOf(avoided.length, eligible.length);
  const reuseComponent = component(
    'reuseEffectiveness',
    reuseRate,
    `${avoided.length} of ${eligible.length} eligible operations avoided inference`,
  );
  if (reuseRate >= 40) reasons.push('strong_reuse_effectiveness');

  // ── Context efficiency: tokens avoided as a share of baseline tokens ──────
  const contextComponent = component(
    'contextEfficiency',
    percentOf(totals.tokensAvoided, totals.baselineTokens),
    `${totals.tokensAvoided} of ${totals.baselineTokens} baseline tokens avoided`,
  );

  // ── Estimate accuracy: how close the projection came to the measurement ───
  // An estimate that is systematically optimistic is a defect worth scoring, and
  // it is invisible unless the two figures are compared explicitly.
  const estimateGap = Math.abs(
    totals.optimizedEstimatedCostMicroUsd - totals.actualSettledCostMicroUsd,
  );
  const estimateError = percentOf(estimateGap, Math.max(1, totals.actualSettledCostMicroUsd));
  const estimateComponent = component(
    'estimateAccuracy',
    100 - estimateError,
    `projected cost differs from measured by ${estimateError}%`,
  );
  if (
    estimateError > 25 &&
    totals.optimizedEstimatedCostMicroUsd < totals.actualSettledCostMicroUsd
  ) {
    reasons.push('estimates_materially_optimistic');
  }

  // ── Settlement completeness ───────────────────────────────────────────────
  const settlementComponent = component(
    'settlementCompleteness',
    coverage.coveragePercent,
    `${coverage.settled} of ${coverage.expectedToSettle} events settled`,
  );

  const components = [
    savingsComponent,
    qualityComponent,
    outcomeComponent,
    retryComponent,
    reuseComponent,
    contextComponent,
    estimateComponent,
    settlementComponent,
  ];

  const uncappedScore = Math.max(
    0,
    Math.min(
      100,
      components.reduce((total, entry) => total + entry.points, 0),
    ),
  );

  // ── The caps ──────────────────────────────────────────────────────────────
  // Applied AFTER the weights, and they are ceilings rather than deductions: a
  // large enough saving can outrun a penalty, and must not be able to.
  let capped = false;
  let score = uncappedScore;

  if (quality.qualityContractFailed === true) {
    reasons.push('quality_contract_failed');
    capped = true;
  }
  if (quality.workflowFailedAfterOptimization === true) {
    reasons.push('workflow_failed_after_optimization');
    capped = true;
  }
  if (quality.requiredContextRemoved === true) {
    reasons.push('required_context_removed');
    capped = true;
  }
  if (quality.safetyPolicyWeakened === true) {
    reasons.push('safety_policy_weakened');
    capped = true;
  }
  if (capped) score = Math.min(score, CAP_ON_VIOLATION);

  // A window with nothing settled has not demonstrated a saving. Reporting a
  // high score from estimates alone is the same error as reporting estimated
  // savings as realised ones, one layer up.
  if (totals.realizedBaselineCostMicroUsd <= 0) {
    reasons.push('no_settled_data');
    score = Math.min(score, CAP_ON_VIOLATION);
    capped = true;
  } else if (coverage.coverageWarning) {
    reasons.push('low_settlement_coverage');
  }

  return {
    scoreVersion: OPTIMIZATION_SCORE_VERSION,
    score,
    uncappedScore,
    capped,
    components,
    reasons: [...new Set(reasons)].sort(),
    coverage,
    confidence:
      coverage.expectedToSettle === 0
        ? 'insufficient'
        : coverage.coveragePercent >= coverage.coverageFloorPercent
          ? 'measured'
          : coverage.coveragePercent >= 40
            ? 'partial'
            : 'insufficient',
  };
}
