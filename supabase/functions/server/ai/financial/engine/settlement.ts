/**
 * Settlement coverage and window totals (AI-01 Batch 3B, Part 6C).
 *
 * ── THE ONE FOLD EVERY OTHER VIEW IS BUILT ON ──────────────────────────────
 *
 * `foldTotals` walks the events once and produces the three separate money
 * figures. Everything downstream — target progress, attribution, burn rate, the
 * optimisation score — reads its output rather than walking the events again
 * with its own rules. A second fold would be a second opinion about what
 * "realised" means, and the looser one would be the one a report used.
 *
 * ── AN UNSETTLED EVENT IS NOT A FREE EVENT ─────────────────────────────────
 *
 * The rule enforced here, and the reason the whole tree exists in this shape:
 *
 *   settled              contributes to actual, to realised savings, AND to the
 *                        realised denominator
 *   pending              contributes to NONE of them, and to coverage
 *   unsettled_terminal   contributes to NONE of them, to coverage, and to
 *                        `unknownCostBaselineMicroUsd`
 *   not_applicable       contributes to nothing at all
 *
 * Note what `realizedBaselineCostMicroUsd` is: the baseline of the SETTLED
 * events only. A realised reduction computed against the whole window's baseline
 * would divide a settled numerator by an unsettled denominator and understate;
 * computing it against a whole-window baseline while keeping only settled
 * savings is the same error mirrored. Carrying the matched denominator
 * explicitly is what stops either from being written by accident.
 *
 * ── COVERAGE IS NOT A COURTESY FIELD ───────────────────────────────────────
 *
 * The most flattering financial mistake available to this platform is to measure
 * the fraction of spend that settled quickly, find an excellent reduction, and
 * publish it as THE reduction. The number would be correct and the sentence
 * around it false. Coverage is that sentence, which is why it is a required
 * field on every report type rather than an optional extra.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import type { FinancialTotals, FinancialWindow, SettlementCoverage } from '../contracts/report.ts';
import { assertWindow, emptyTotals, inWindow, percentOf } from '../contracts/report.ts';

/**
 * The coverage below which a realised figure is not trustworthy on its own.
 *
 * Versioned and declared rather than tuned per report. 80% is a judgement — it
 * is not derived from anything — and stating it as a constant with a version is
 * what lets somebody disagree with it in one place instead of everywhere.
 */
export const COVERAGE_POLICY_VERSION = 'ai.financial.coverage.v1';
export const COVERAGE_FLOOR_PERCENT = 80;

/** Events inside a window, sorted so every report over them is reproducible. */
export function eventsInWindow(
  events: readonly FinancialEvent[],
  window: FinancialWindow,
): readonly FinancialEvent[] {
  assertWindow(window);
  return [...events]
    .filter((event) => inWindow(event.occurredAt, window))
    .sort(
      (a, b) =>
        a.occurredAt - b.occurredAt ||
        (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
    );
}

export function foldTotals(events: readonly FinancialEvent[]): FinancialTotals {
  let baseline = 0;
  let optimized = 0;
  let actualSettled = 0;
  let estimated = 0;
  let realized = 0;
  let realizedBaseline = 0;
  let realizedFromAbsence = 0;
  let baselineTokens = 0;
  let actualSettledTokens = 0;
  let tokensAvoided = 0;
  let unknownBaseline = 0;

  for (const event of events) {
    baseline += event.baselineCostMicroUsd;
    optimized += event.optimizedEstimatedCostMicroUsd;
    estimated += event.estimatedSavingsMicroUsd;
    baselineTokens += event.baselineTokens;
    tokensAvoided += event.tokensAvoided;

    if (event.settlementState === 'settled') {
      // `?? 0` is safe ONLY here: `isWholeFinancialEvent` refuses a settled event
      // without a measurement, so a settled event always carries one.
      actualSettled += event.actualCostMicroUsd ?? 0;
      actualSettledTokens += event.actualTokens ?? 0;
      const realizedHere = event.realizedSavingsMicroUsd ?? 0;
      realized += realizedHere;
      realizedBaseline += event.baselineCostMicroUsd;
      if (event.settlementBasis === 'measured_absence') realizedFromAbsence += realizedHere;
      continue;
    }

    if (event.settlementState === 'unsettled_terminal') {
      // Spend that really was incurred and can never be quantified. It belongs
      // in the report as its own figure rather than silently as a zero.
      unknownBaseline += event.baselineCostMicroUsd;
    }
  }

  return {
    ...emptyTotals(),
    events: events.length,
    baselineCostMicroUsd: baseline,
    optimizedEstimatedCostMicroUsd: optimized,
    actualSettledCostMicroUsd: actualSettled,
    estimatedSavingsMicroUsd: estimated,
    realizedSavingsMicroUsd: realized,
    realizedBaselineCostMicroUsd: realizedBaseline,
    realizedFromAbsenceMicroUsd: realizedFromAbsence,
    baselineTokens,
    actualSettledTokens,
    tokensAvoided,
    unknownCostBaselineMicroUsd: unknownBaseline,
  };
}

/**
 * Coverage over a set of events.
 *
 * `expectedToSettle` excludes refusals, because there is nothing to settle — and
 * including them would let a platform improve its coverage by declining work,
 * which is precisely the wrong incentive to build into a measurement.
 */
export function settlementCoverage(events: readonly FinancialEvent[]): SettlementCoverage {
  let settled = 0;
  let pending = 0;
  let unsettledTerminal = 0;
  let notApplicable = 0;
  let unsettledBaseline = 0;

  for (const event of events) {
    switch (event.settlementState) {
      case 'settled':
        settled += 1;
        break;
      case 'pending':
        pending += 1;
        unsettledBaseline += event.baselineCostMicroUsd;
        break;
      case 'unsettled_terminal':
        unsettledTerminal += 1;
        unsettledBaseline += event.baselineCostMicroUsd;
        break;
      case 'not_applicable':
        notApplicable += 1;
        break;
    }
  }

  const expectedToSettle = settled + pending + unsettledTerminal;
  const coveragePercent = percentOf(settled, expectedToSettle);

  return {
    expectedToSettle,
    settled,
    pending,
    unsettledTerminal,
    notApplicable,
    coveragePercent,
    unsettledBaselineMicroUsd: unsettledBaseline,
    // A window with nothing to settle is not "fully covered" — it is a window
    // with no evidence, and calling that 100% would let an empty report claim
    // the strongest possible confidence.
    coverageWarning: expectedToSettle === 0 || coveragePercent < COVERAGE_FLOOR_PERCENT,
    coverageFloorPercent: COVERAGE_FLOOR_PERCENT,
  };
}
