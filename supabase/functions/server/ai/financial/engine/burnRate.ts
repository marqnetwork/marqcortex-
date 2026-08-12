/**
 * Burn rate and projection (AI-01 Batch 3B, Part 6C).
 *
 * ── A PROJECTION IS ARITHMETIC, AND IT SAYS SO ─────────────────────────────
 *
 * Settled spend divided by window days, multiplied out. That is the whole model.
 * No trend fitting, no seasonality, no regression, no ML — because a forecast
 * nobody can recompute is a forecast nobody can challenge, and a financial
 * projection that cannot be challenged is a liability rather than an asset.
 *
 * Every field is labelled an estimate and the flag is on the type, so a consumer
 * cannot receive one of these without also receiving the fact that it is a
 * projection.
 *
 * ── THREE DAYS IS NOT A MONTH ──────────────────────────────────────────────
 *
 * The failure mode this module exists to prevent: taking two days of a pilot,
 * multiplying by fifteen, and putting the result in front of somebody who will
 * budget against it. So the projection carries `sampleSize`, `windowDays` and
 * `sufficientSample`, and a window under the declared minimum reports
 * `sufficientSample: false` while still returning the arithmetic. The numbers
 * are not withheld — the confidence is.
 *
 * ── PROJECTING FROM UNSETTLED SPEND WOULD UNDERSTATE, ALWAYS ───────────────
 *
 * Burn is computed from SETTLED spend only, so an unsettled window projects a
 * burn lower than reality. That is why coverage travels with the projection: an
 * 8% coverage burn rate is not a burn rate, it is a floor, and the honest way to
 * say so is to publish the coverage next to it rather than to scale the number
 * up by a guess.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import type { FinancialWindow, SettlementCoverage } from '../contracts/report.ts';
import { assertWindow, windowDays } from '../contracts/report.ts';
import { foldTotals, settlementCoverage } from './settlement.ts';

export const BURN_POLICY_VERSION = 'ai.financial.burn.v1';

/** Below this many days, a daily rate is an artefact of the window. */
export const MIN_WINDOW_DAYS = 7;

/** Below this many settled events, the mean is dominated by individual runs. */
export const MIN_SAMPLE_EVENTS = 20;

const DAYS_PER_WEEK = 7;
/** A declared month length, so the projection is reproducible across calendars. */
export const PROJECTION_MONTH_DAYS = 30;

export interface BurnProjection {
  readonly burnPolicyVersion: string;
  /** Always true. On the type so a consumer cannot receive the figures without it. */
  readonly isEstimate: true;

  readonly window: FinancialWindow;
  readonly windowDays: number;
  /** Settled events the projection was computed from. */
  readonly sampleSize: number;
  readonly sufficientSample: boolean;
  readonly minimumWindowDays: number;
  readonly minimumSampleEvents: number;

  // ── Measured, in the window ────────────────────────────────────────────────
  readonly settledCostMicroUsd: number;
  readonly settledBaselineCostMicroUsd: number;
  readonly realizedSavingsMicroUsd: number;

  // ── Projected. Arithmetic on the measured rate, nothing more ──────────────
  readonly dailyBurnMicroUsd: number;
  readonly weeklyBurnMicroUsd: number;
  readonly monthlyBurnMicroUsd: number;
  readonly projectedMonthlyBaselineMicroUsd: number;
  readonly projectedMonthlySavingsMicroUsd: number;

  readonly coverage: SettlementCoverage;
}

/**
 * Project burn from a window of events.
 *
 * `events` must already be filtered to the window — `engine/settlement.ts`
 * provides `eventsInWindow` — so this function does not re-filter and cannot
 * disagree with the caller about which events were in scope.
 */
export function projectBurn(
  events: readonly FinancialEvent[],
  window: FinancialWindow,
): BurnProjection {
  assertWindow(window);
  const days = windowDays(window);
  const totals = foldTotals(events);
  const coverage = settlementCoverage(events);

  const perDay = (value: number): number => (days <= 0 ? 0 : Math.round(value / days));

  const dailyBurn = perDay(totals.actualSettledCostMicroUsd);
  const dailyBaseline = perDay(totals.realizedBaselineCostMicroUsd);
  const dailySavings = perDay(totals.realizedSavingsMicroUsd);

  return {
    burnPolicyVersion: BURN_POLICY_VERSION,
    isEstimate: true,

    window,
    windowDays: Math.round(days * 100) / 100,
    sampleSize: coverage.settled,
    // BOTH conditions. A long window with three events projects as badly as a
    // short window with three hundred, and for different reasons.
    sufficientSample: days >= MIN_WINDOW_DAYS && coverage.settled >= MIN_SAMPLE_EVENTS,
    minimumWindowDays: MIN_WINDOW_DAYS,
    minimumSampleEvents: MIN_SAMPLE_EVENTS,

    settledCostMicroUsd: totals.actualSettledCostMicroUsd,
    settledBaselineCostMicroUsd: totals.realizedBaselineCostMicroUsd,
    realizedSavingsMicroUsd: totals.realizedSavingsMicroUsd,

    dailyBurnMicroUsd: dailyBurn,
    weeklyBurnMicroUsd: dailyBurn * DAYS_PER_WEEK,
    monthlyBurnMicroUsd: dailyBurn * PROJECTION_MONTH_DAYS,
    projectedMonthlyBaselineMicroUsd: dailyBaseline * PROJECTION_MONTH_DAYS,
    projectedMonthlySavingsMicroUsd: dailySavings * PROJECTION_MONTH_DAYS,

    coverage,
  };
}
