/**
 * Target progress (AI-01 Batch 3B, Part 6C).
 *
 * ── THE HEADLINE NUMBER, AND THE THREE WAYS IT COULD LIE ──────────────────
 *
 * Cortex is designed to PURSUE up to 90% system-level AI cost reduction. This
 * module reports how close it actually is, and it is written around the three
 * ways that report could flatter the platform:
 *
 *   1. USE ESTIMATES. The optimiser's own projection of what it saved is
 *      systematically optimistic — that is what an estimate is. So the headline
 *      reads ONLY settled data, and the estimated figure is reported beside it
 *      under a different name rather than substituted for it.
 *
 *   2. TREAT UNSETTLED AS FREE. Unmeasured spend counted as zero makes every
 *      unfinished call look free. So unsettled events contribute to neither the
 *      numerator nor the denominator, and coverage travels with the figure.
 *
 *   3. ROUND UP. 89.95% displays as 90.0% under any sane rounding rule. If the
 *      "achieved" flag were computed from the displayed number, a platform
 *      0.05 points short would announce success. So ACHIEVEMENT IS DECIDED ON
 *      INTEGER MICRO-USD, before any rounding happens, and the displayed
 *      percentage is a separate value that no decision reads.
 *
 * ── AND ONE MORE: MEASURING A SLIVER ───────────────────────────────────────
 *
 * A realised 90% over 20% settlement coverage is not a 90% platform. It is a
 * platform that knows about a fifth of its spend. So `achieved` requires BOTH
 * the ratio and the coverage floor, and a run that clears the ratio on thin
 * coverage reports `achieved: false` with `coverageWarning: true` and the ratio
 * still visible. The number is not hidden — the claim is.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import type { FinancialTotals, SettlementCoverage } from '../contracts/report.ts';
import { percentOf } from '../contracts/report.ts';
import { foldTotals, settlementCoverage } from './settlement.ts';

export const TARGET_POLICY_VERSION = 'ai.financial.target.v1';

/** The system-level design target. A target, never a guarantee. */
export const TARGET_REDUCTION_PERCENT = 90;

export interface TargetProgress {
  readonly targetPolicyVersion: string;
  readonly targetReductionPercent: number;

  /**
   * THE HEADLINE. Realised savings over the baseline of the SETTLED events.
   *
   * 0–100, one decimal, for display. Nothing decides anything from this value.
   */
  readonly realizedReductionPercent: number;
  readonly realizedSavingsMicroUsd: number;
  readonly realizedBaselineCostMicroUsd: number;

  /**
   * The optimiser's own projection, over the whole window.
   *
   * Reported beside the headline and never as it. An estimate that is
   * systematically optimistic is exactly the defect a single blended figure
   * would hide.
   */
  readonly estimatedReductionPercent: number;
  readonly estimatedSavingsMicroUsd: number;
  readonly baselineCostMicroUsd: number;

  readonly coverage: SettlementCoverage;
  /** Settled events over all events that could carry a baseline. 0–100. */
  readonly eligibleWorkloadCoveragePercent: number;

  /**
   * True only when the ratio clears the target on integer micro-USD AND the
   * coverage floor is met. Never computed from a rounded percentage.
   */
  readonly achieved: boolean;
  readonly coverageWarning: boolean;
  /** Why `achieved` is what it is. Closed vocabulary. */
  readonly assessment: TargetAssessment;
  /**
   * How much of the realised saving came from calls that never happened rather
   * than from a smaller invoice. Not a criticism — but a reviewer is entitled to
   * know which kind of reduction this is.
   */
  readonly realizedFromAbsencePercent: number;
}

export const TARGET_ASSESSMENTS = [
  'target_met_on_settled_data',
  'below_target_on_settled_data',
  'insufficient_settlement_coverage',
  'no_settled_data',
] as const;

export type TargetAssessment = (typeof TARGET_ASSESSMENTS)[number];

/**
 * Does the ratio clear the target, on integers?
 *
 * `realized / baseline >= 0.90` rearranged to `realized * 100 >= baseline * 90`,
 * which is exact in integer micro-USD. The float form is not merely less tidy —
 * it is how 89.999...% becomes 90% on a machine, and then becomes a claim.
 */
function clearsTarget(realizedSavings: number, realizedBaseline: number): boolean {
  if (realizedBaseline <= 0) return false;
  return realizedSavings * 100 >= realizedBaseline * TARGET_REDUCTION_PERCENT;
}

export function assessTargetProgress(events: readonly FinancialEvent[]): TargetProgress {
  const totals: FinancialTotals = foldTotals(events);
  const coverage = settlementCoverage(events);

  const realizedReductionPercent = percentOf(
    totals.realizedSavingsMicroUsd,
    totals.realizedBaselineCostMicroUsd,
  );
  const estimatedReductionPercent = percentOf(
    totals.estimatedSavingsMicroUsd,
    totals.baselineCostMicroUsd,
  );

  // Events that COULD carry a baseline — i.e. everything but a refusal. A
  // refusal has no baseline and no saving, so counting it here would let a
  // platform improve its apparent coverage by declining work.
  const eligible = events.filter((event) => event.eventType !== 'refused').length;
  const eligibleWorkloadCoveragePercent = percentOf(coverage.settled, eligible);

  const ratioClears = clearsTarget(
    totals.realizedSavingsMicroUsd,
    totals.realizedBaselineCostMicroUsd,
  );

  const assessment: TargetAssessment =
    totals.realizedBaselineCostMicroUsd <= 0
      ? 'no_settled_data'
      : coverage.coverageWarning
        ? 'insufficient_settlement_coverage'
        : ratioClears
          ? 'target_met_on_settled_data'
          : 'below_target_on_settled_data';

  return {
    targetPolicyVersion: TARGET_POLICY_VERSION,
    targetReductionPercent: TARGET_REDUCTION_PERCENT,

    realizedReductionPercent,
    realizedSavingsMicroUsd: totals.realizedSavingsMicroUsd,
    realizedBaselineCostMicroUsd: totals.realizedBaselineCostMicroUsd,

    estimatedReductionPercent,
    estimatedSavingsMicroUsd: totals.estimatedSavingsMicroUsd,
    baselineCostMicroUsd: totals.baselineCostMicroUsd,

    coverage,
    eligibleWorkloadCoveragePercent,

    // BOTH conditions. A ratio that clears the target on a fifth of the spend is
    // a fact about that fifth, not about the platform.
    achieved: assessment === 'target_met_on_settled_data',
    coverageWarning: coverage.coverageWarning,
    assessment,
    realizedFromAbsencePercent: percentOf(
      totals.realizedFromAbsenceMicroUsd,
      totals.realizedSavingsMicroUsd,
    ),
  };
}
