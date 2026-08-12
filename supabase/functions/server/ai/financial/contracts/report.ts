/**
 * Reporting contracts (AI-01 Batch 3B, Part 6C).
 *
 * ── EVERY REALISED FIGURE TRAVELS WITH ITS COVERAGE ────────────────────────
 *
 * The types below make it impossible to publish a realised saving without also
 * publishing how much of the workload it was measured over. Not by convention —
 * `SettlementCoverage` is a required field on `FinancialSummary`,
 * `TargetProgress` and `BurnProjection`, so a report that omitted it would not
 * compile.
 *
 * That is the whole defence against the most flattering financial mistake a
 * platform can make: measuring the 12% of spend that settled quickly, finding a
 * wonderful reduction, and reporting it as the reduction. The number is not
 * wrong; the sentence around it is. Coverage is the sentence.
 *
 * ── A WINDOW IS AN INPUT, NOT A DEFAULT ────────────────────────────────────
 *
 * Every query names its window explicitly and the engine reads no clock. A
 * report is therefore reproducible: the same events and the same window produce
 * the same figures forever, which is what an auditor needs when the question is
 * "where did 74.2% come from".
 */

import { financialFailure } from './failures.ts';

/** A half-open interval `[fromMs, toMs)`. Supplied, never defaulted. */
export interface FinancialWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

export function assertWindow(window: FinancialWindow): void {
  if (
    !Number.isFinite(window.fromMs) ||
    !Number.isFinite(window.toMs) ||
    window.fromMs < 0 ||
    window.toMs <= window.fromMs
  ) {
    throw financialFailure('financial_input_invalid', 'That reporting window is not usable.', {
      diagnostics: `from=${String(window.fromMs)} to=${String(window.toMs)}`,
    });
  }
}

export function windowDays(window: FinancialWindow): number {
  return (window.toMs - window.fromMs) / 86_400_000;
}

export function inWindow(occurredAt: number, window: FinancialWindow): boolean {
  return occurredAt >= window.fromMs && occurredAt < window.toMs;
}

/**
 * How much of the workload the realised figures actually cover.
 *
 * `expectedToSettle` counts events that either have settled or should — an
 * inference or an avoided call. Refusals are excluded because there is nothing
 * to settle, and including them would let a platform improve its coverage by
 * declining work.
 */
export interface SettlementCoverage {
  readonly expectedToSettle: number;
  readonly settled: number;
  readonly pending: number;
  readonly unsettledTerminal: number;
  readonly notApplicable: number;
  /** settled / expectedToSettle. 0–100, one decimal. */
  readonly coveragePercent: number;
  /**
   * Baseline cost carried by events that have not settled.
   *
   * The size of the blind spot in money rather than in row counts. Ten unsettled
   * cheap calls and one unsettled expensive one are the same coverage percentage
   * and very different levels of ignorance.
   */
  readonly unsettledBaselineMicroUsd: number;
  /**
   * True when coverage is below the declared floor for a trustworthy figure.
   *
   * Set by `engine/settlement.ts` from a versioned threshold, not by a caller.
   */
  readonly coverageWarning: boolean;
  readonly coverageFloorPercent: number;
}

/** Money, kept in the three separate figures that must never be blended. */
export interface FinancialTotals {
  readonly events: number;
  readonly baselineCostMicroUsd: number;
  readonly optimizedEstimatedCostMicroUsd: number;
  /** Measured spend. Sums ONLY settled events. */
  readonly actualSettledCostMicroUsd: number;
  readonly estimatedSavingsMicroUsd: number;
  /** Sums ONLY settled events. Never falls back to the estimate. */
  readonly realizedSavingsMicroUsd: number;
  /**
   * Baseline of the events that contributed to `realizedSavingsMicroUsd`.
   *
   * The correct denominator for a realised reduction. Using the WHOLE window's
   * baseline instead would divide a settled numerator by an unsettled
   * denominator and understate; using the whole window's baseline while keeping
   * only settled savings is the mirror error. Both are avoided by carrying the
   * matched denominator explicitly.
   */
  readonly realizedBaselineCostMicroUsd: number;
  /**
   * Realised saving that came from measured ABSENCE rather than from an invoice.
   *
   * Exposed separately because a reduction built entirely out of calls that
   * never happened is a different claim from one visible on a provider bill, and
   * a reviewer is entitled to know which this is.
   */
  readonly realizedFromAbsenceMicroUsd: number;
  readonly baselineTokens: number;
  readonly actualSettledTokens: number;
  readonly tokensAvoided: number;
  /** Baseline cost of events that will never settle. Permanently unknown spend. */
  readonly unknownCostBaselineMicroUsd: number;
}

export function emptyTotals(): FinancialTotals {
  return {
    events: 0,
    baselineCostMicroUsd: 0,
    optimizedEstimatedCostMicroUsd: 0,
    actualSettledCostMicroUsd: 0,
    estimatedSavingsMicroUsd: 0,
    realizedSavingsMicroUsd: 0,
    realizedBaselineCostMicroUsd: 0,
    realizedFromAbsenceMicroUsd: 0,
    baselineTokens: 0,
    actualSettledTokens: 0,
    tokensAvoided: 0,
    unknownCostBaselineMicroUsd: 0,
  };
}

/**
 * Percent to one decimal, from integer micro-USD.
 *
 * DISPLAY ONLY. Never used to decide whether a target was met — see
 * `engine/targetProgress.ts` for why a rounded 89.95 must not become a 90.
 */
export function percentOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}
