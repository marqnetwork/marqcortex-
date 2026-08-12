/**
 * Cost per outcome (AI-01 Batch 3B, Part 6C).
 *
 * ── COST PER SUCCESS IS THE ONLY COST FIGURE THAT MEANS ANYTHING ──────────
 *
 * A platform can halve its spend by failing twice as often. Every figure in this
 * module exists because "we spent less" is not a result on its own: the question
 * is what the spend BOUGHT, and the honest denominator is successful outcomes
 * rather than calls made.
 *
 * So failed runs keep their spend in the numerator of the platform's totals and
 * contribute nothing to the success denominator. That is deliberately unkind to
 * a platform that fails a lot, which is the point — a cost-per-success that
 * ignored failures would reward exactly the behaviour it should expose.
 *
 * ── SPEND IS GROUPED BY RUN, NOT BY EVENT ──────────────────────────────────
 *
 * An outcome belongs to a workflow RUN, and a run has many events at many
 * attempts. So costs are folded per run first and the run's terminal outcome
 * decides which bucket the whole run lands in. Classifying each event by its own
 * outcome field would split one run's spend across buckets whenever a retry
 * changed the picture, and the resulting cost-per-success would count part of a
 * successful run as the cost of a failure.
 *
 * ── OUTLIERS ARE A THRESHOLD, NOT A JUDGEMENT ─────────────────────────────
 *
 * High-cost runs are identified by a declared multiple of the median. No model,
 * no anomaly score, no learned baseline — a versioned constant a human can
 * disagree with, and a list of run ids they can go and read. An opaque
 * "anomaly score: 0.87" on a financial report is a number nobody can act on.
 */

import type { FinancialEvent, FinancialOutcome } from '../contracts/event.ts';
import { percentOf } from '../contracts/report.ts';

export const OUTLIER_POLICY_VERSION = 'ai.financial.outlier.v1';

/** A run costing more than this multiple of the median is flagged. */
export const OUTLIER_MEDIAN_MULTIPLE = 4;

/** Runs below this count make a median meaningless. */
export const MIN_RUNS_FOR_OUTLIERS = 5;

export interface RunEconomics {
  readonly workflowRunId: string;
  readonly outcome: FinancialOutcome;
  readonly actualSettledCostMicroUsd: number;
  readonly baselineCostMicroUsd: number;
  readonly realizedSavingsMicroUsd: number;
  readonly retrySettledCostMicroUsd: number;
  /** True when any of the run's events never settled. */
  readonly partiallySettled: boolean;
}

export interface OutcomeEconomics {
  readonly outlierPolicyVersion: string;

  readonly runs: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly cancelledRuns: number;
  readonly inProgressRuns: number;

  /** Settled spend on runs that succeeded, over the count of those runs. */
  readonly costPerSuccessfulRunMicroUsd: number;
  /** Settled spend on runs that failed, over the count of those runs. */
  readonly costPerFailedRunMicroUsd: number;
  /** Settled spend on ALL terminal runs, over the count that succeeded. */
  readonly costPerCompletedOutcomeMicroUsd: number;
  readonly savingsPerSuccessfulRunMicroUsd: number;
  /** Retry spend across every run, over the count that succeeded. */
  readonly retryCostPerSuccessMicroUsd: number;

  readonly averageActualCostPerRunMicroUsd: number;
  readonly medianActualCostPerRunMicroUsd: number;

  readonly successRatePercent: number;
  /** Runs whose settled cost exceeds the declared multiple of the median. */
  readonly highCostRuns: readonly RunEconomics[];
  readonly outlierThresholdMicroUsd: number;
  /** False when there were too few runs for a median to mean anything. */
  readonly outlierDetectionApplied: boolean;
  /** Runs where some spend never settled. Their figures are floors, not totals. */
  readonly partiallySettledRuns: number;
}

function settledCost(event: FinancialEvent): number {
  return event.settlementState === 'settled' ? (event.actualCostMicroUsd ?? 0) : 0;
}

/**
 * The median of a sorted integer list.
 *
 * Even-length lists take the lower of the two middles rather than their mean, so
 * the result is always a value that some run actually cost. A synthetic midpoint
 * is a fine statistic and a poor thing to put in a column headed "median run
 * cost", where a reader reasonably expects to be able to go and find that run.
 */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Fold events into per-run economics. Runs are the unit an outcome belongs to. */
export function runEconomics(events: readonly FinancialEvent[]): readonly RunEconomics[] {
  const byRun = new Map<string, FinancialEvent[]>();
  for (const event of events) {
    if (event.workflowRunId === undefined) continue;
    const bucket = byRun.get(event.workflowRunId);
    if (bucket === undefined) byRun.set(event.workflowRunId, [event]);
    else bucket.push(event);
  }

  return [...byRun.entries()]
    .map(([workflowRunId, runEvents]) => {
      // The run's outcome is the terminal one if any event reports one. A run
      // whose events disagree is mid-transition; the terminal verdict wins,
      // because that is the one that is final.
      const terminal = runEvents.find((event) => event.outcome !== 'in_progress');
      return {
        workflowRunId,
        outcome: terminal?.outcome ?? 'in_progress',
        actualSettledCostMicroUsd: runEvents.reduce(
          (total, event) => total + settledCost(event),
          0,
        ),
        baselineCostMicroUsd: runEvents.reduce(
          (total, event) => total + event.baselineCostMicroUsd,
          0,
        ),
        realizedSavingsMicroUsd: runEvents.reduce(
          (total, event) =>
            total + (event.settlementState === 'settled' ? (event.realizedSavingsMicroUsd ?? 0) : 0),
          0,
        ),
        retrySettledCostMicroUsd: runEvents
          .filter((event) => event.retryAttempt > 1)
          .reduce((total, event) => total + settledCost(event), 0),
        partiallySettled: runEvents.some(
          (event) =>
            event.settlementState === 'pending' || event.settlementState === 'unsettled_terminal',
        ),
      };
    })
    .sort((a, b) => (a.workflowRunId < b.workflowRunId ? -1 : 1));
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Math.round(numerator / denominator);
}

export function analyzeOutcomes(events: readonly FinancialEvent[]): OutcomeEconomics {
  const runs = runEconomics(events);

  const successful = runs.filter((run) => run.outcome === 'succeeded');
  const failed = runs.filter((run) => run.outcome === 'failed');
  const cancelled = runs.filter(
    (run) => run.outcome === 'cancelled' || run.outcome === 'expired' || run.outcome === 'policy_denied',
  );
  const inProgress = runs.filter((run) => run.outcome === 'in_progress');
  const terminal = runs.filter((run) => run.outcome !== 'in_progress');

  const successCost = successful.reduce((total, run) => total + run.actualSettledCostMicroUsd, 0);
  const failedCost = failed.reduce((total, run) => total + run.actualSettledCostMicroUsd, 0);
  const terminalCost = terminal.reduce((total, run) => total + run.actualSettledCostMicroUsd, 0);
  const retryCost = runs.reduce((total, run) => total + run.retrySettledCostMicroUsd, 0);
  const successSavings = successful.reduce(
    (total, run) => total + run.realizedSavingsMicroUsd,
    0,
  );

  const costs = runs.map((run) => run.actualSettledCostMicroUsd);
  const median = medianOf(costs);
  const outlierDetectionApplied = runs.length >= MIN_RUNS_FOR_OUTLIERS && median > 0;
  const threshold = median * OUTLIER_MEDIAN_MULTIPLE;

  return {
    outlierPolicyVersion: OUTLIER_POLICY_VERSION,

    runs: runs.length,
    successfulRuns: successful.length,
    failedRuns: failed.length,
    cancelledRuns: cancelled.length,
    inProgressRuns: inProgress.length,

    costPerSuccessfulRunMicroUsd: ratio(successCost, successful.length),
    costPerFailedRunMicroUsd: ratio(failedCost, failed.length),
    // ALL terminal spend over successes. The figure that refuses to let failure
    // look cheap: a run that failed still consumed money, and dividing only the
    // successful runs' cost by the successful runs would hide that entirely.
    costPerCompletedOutcomeMicroUsd: ratio(terminalCost, successful.length),
    savingsPerSuccessfulRunMicroUsd: ratio(successSavings, successful.length),
    retryCostPerSuccessMicroUsd: ratio(retryCost, successful.length),

    averageActualCostPerRunMicroUsd: ratio(
      runs.reduce((total, run) => total + run.actualSettledCostMicroUsd, 0),
      runs.length,
    ),
    medianActualCostPerRunMicroUsd: median,

    successRatePercent: percentOf(successful.length, terminal.length),
    highCostRuns: outlierDetectionApplied
      ? runs
          .filter((run) => run.actualSettledCostMicroUsd > threshold)
          .sort((a, b) => b.actualSettledCostMicroUsd - a.actualSettledCostMicroUsd)
      : [],
    outlierThresholdMicroUsd: outlierDetectionApplied ? threshold : 0,
    outlierDetectionApplied,
    partiallySettledRuns: runs.filter((run) => run.partiallySettled).length,
  };
}
