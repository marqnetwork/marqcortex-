/**
 * CORTEX CORE — CASHFLOW ENGINE (cashflow_model_v1)
 *
 * Cash Flow Timeline Modeling — cashflow-timeline-model.md
 *
 * Converts annual ROI into time-based financial reality:
 *   §1  — Core Principle: No instant full-year benefit. No "2 month ROI" inflation.
 *   §2  — Timeline Structure: 12-month projection per recommendation
 *   §3  — Investment Timing: Phase-based, front-loaded (40/35/25 for 3-month projects)
 *          Tooling recurring cost spread evenly across active months.
 *   §4  — Gain Ramp: Month 1→0%, M2→25%, M3→50%, M4→70%, M5→85%, M6+→100%
 *          Multiply ramp factor by annual_gain / 12.
 *   §5  — Net Monthly Cash Flow = Gain(month) - Investment(month)
 *   §6  — Cumulative Cash Flow = Cumulative(n-1) + Net(n)
 *   §7  — True Payback: first month where Cumulative >= 0 (replaces simplified estimate)
 *   §8  — Portfolio Timeline: sum all rec monthly gains + investments, deps applied first
 *   §9  — Output Structure: monthly_projection[] with true_payback_month
 *   §10 — Safety Rules:
 *          • No gain before deployment milestone (ramp enforces M1 = 0)
 *          • If dependency fails → child gain = 0 (checked via is_roi_eligible)
 *          • Revenue gains: zeroed when enablement parent is inactive (handled by depEngine)
 *          • Efficiency gains: zeroed when automation phase not completed (same)
 *
 * Math decides payback. Not storytelling.
 */

import type {
  RecommendationROI,
  RecommendationCashflow,
  PortfolioCashflow,
  MonthlyProjection,
} from './types';

// ════════════════════════════════════════════════════════════════════════════════
// §4 — GAIN RAMP FACTORS (1-indexed: ramp[0] = Month 1)
// ════════════════════════════════════════════════════════════════════════════════

const GAIN_RAMP_FACTORS: readonly number[] = [0, 0.25, 0.50, 0.70, 0.85, 1.0];

/**
 * Returns the ramp factor for a given project month (1-based).
 * Month 1 → 0% (no immediate benefit).
 * Month 6+ → 100% (full realization).
 */
function getRampFactor(month: number): number {
  if (month <= 0) return 0;
  const idx = month - 1;
  if (idx >= GAIN_RAMP_FACTORS.length) return 1.0;
  return GAIN_RAMP_FACTORS[idx];
}

// ════════════════════════════════════════════════════════════════════════════════
// §3 — FRONT-LOADED INVESTMENT WEIGHT DISTRIBUTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Builds a front-loaded weight array for N active months.
 * Spec-exact for 3-month projects: [0.40, 0.35, 0.25].
 * Generalizes for other durations.
 */
function buildFrontLoadedWeights(months: number): number[] {
  if (months <= 0) return [];
  if (months === 1) return [1.0];
  if (months === 2) return [0.55, 0.45];
  if (months === 3) return [0.40, 0.35, 0.25]; // Spec-exact §3

  // For N > 3: lead with 30/25/20, spread remainder evenly across rest
  const lead = [0.30, 0.25, 0.20];
  const leadSum = lead.reduce((a, b) => a + b, 0); // 0.75
  const remaining = 1.0 - leadSum;
  const restMonths = months - 3;
  const perRest = restMonths > 0 ? remaining / restMonths : 0;

  return [...lead, ...Array(restMonths).fill(parseFloat(perRest.toFixed(6)))];
}

// ════════════════════════════════════════════════════════════════════════════════
// §3 — INVESTMENT SCHEDULE BUILDER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Distributes total investment across `timelineMonths` months.
 *
 * Logic:
 *   1. Separate tooling cost (recurring) from one-time costs.
 *   2. Apply front-loaded weights to non-tooling cost across active months.
 *   3. Add tooling/month evenly across active months.
 *   4. Months beyond `activeMonths` receive 0 investment (capital deployed).
 *
 * @param totalInvestment  Mid-case investment cost
 * @param durationMonths   Project duration (may be fractional)
 * @param toolingCost      Recurring tooling portion (spread evenly, §3)
 * @param timelineMonths   Total projection length (default 12)
 */
function buildInvestmentSchedule(
  totalInvestment: number,
  durationMonths: number,
  toolingCost: number,
  timelineMonths: number,
): number[] {
  const schedule = new Array<number>(timelineMonths).fill(0);

  // Active months = ceil of duration, capped at timeline
  const activeMonths = Math.max(1, Math.min(Math.ceil(durationMonths), timelineMonths));

  // §3: Tooling recurring — spread evenly across active months
  const toolingPerMonth = activeMonths > 0 ? toolingCost / activeMonths : 0;

  // Non-tooling cost distributed via front-loaded weights
  const nonTooling = Math.max(0, totalInvestment - toolingCost);
  const weights = buildFrontLoadedWeights(activeMonths);

  for (let i = 0; i < activeMonths; i++) {
    const baseInv = nonTooling * (weights[i] ?? 0);
    schedule[i] = Math.round(baseInv + toolingPerMonth);
  }

  return schedule;
}

// ════════════════════════════════════════════════════════════════════════════════
// §4 — GAIN SCHEDULE BUILDER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Applies the gain ramp model to produce monthly gains.
 *
 * Formula per month: annual_gain / 12 × ramp_factor(month)
 *
 * §10 Safety Rule: if `gainBlocked` (dependency failure or not eligible),
 * all months return 0.
 *
 * @param annualGain    Confidence-adjusted, dependency-adjusted annual gain (mid-case)
 * @param timelineMonths  Number of months to project
 * @param gainBlocked   Safety override — zeroes all gains
 */
function buildGainSchedule(
  annualGain: number,
  timelineMonths: number,
  gainBlocked: boolean,
): number[] {
  if (gainBlocked || annualGain <= 0) {
    return new Array<number>(timelineMonths).fill(0);
  }

  const monthlyBase = annualGain / 12;
  const schedule: number[] = [];

  for (let m = 1; m <= timelineMonths; m++) {
    const ramp = getRampFactor(m);
    schedule.push(Math.round(monthlyBase * ramp));
  }

  return schedule;
}

// ════════════════════════════════════════════════════════════════════════════════
// §7 — TRUE PAYBACK FINDER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Returns the first month (1-based) where cumulative cash flow >= 0.
 * Returns null if never reached within the projection window.
 */
function findTruePaybackMonth(cumulativeCashFlow: number[]): number | null {
  const idx = cumulativeCashFlow.findIndex(c => c >= 0);
  return idx >= 0 ? idx + 1 : null; // convert 0-based index → 1-based month
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: computeRecommendationCashflow
// ════════════════════════════════════════════════════════════════════════════════

/**
 * §2-§7: Computes the full cash flow timeline for a single recommendation.
 *
 * Uses:
 *   - `roi.roi_range.mid_case.gain` as the confidence-adjusted annual gain
 *   - `roi.inputs.investment_cost` as total investment (mid-case from cost_model)
 *   - `roi.cost_model.duration_months` for investment schedule timing
 *   - `roi.cost_model.cost_breakdown.tooling` for recurring tooling spread
 *   - `roi.is_roi_eligible` for §10 safety rule (dep-blocked → gain = 0)
 *
 * @param roi             Per-recommendation ROI (post dependency-engine pass)
 * @param timelineMonths  Projection window, default 12 (§2)
 */
export function computeRecommendationCashflow(
  roi: RecommendationROI,
  timelineMonths = 12,
): RecommendationCashflow {
  // Annual gain = confidence-adjusted, dependency-adjusted mid-case
  const annualGain = roi.roi_range.mid_case.gain ?? 0;
  const totalInvestment = roi.inputs.investment_cost ?? 0;
  const durationMonths = roi.cost_model?.duration_months ?? Math.max(1, (roi.inputs.timeline_days ?? 90) / 30);
  const toolingCost = roi.cost_model?.cost_breakdown.tooling ?? 0;

  // §10 — Safety Rule: dependency failure or ineligibility blocks all gains
  const gainBlocked = !roi.is_roi_eligible;

  // §3 — Investment schedule (phase-based, front-loaded, tooling spread evenly)
  const investmentSchedule = buildInvestmentSchedule(
    totalInvestment,
    durationMonths,
    toolingCost,
    timelineMonths,
  );

  // §4 — Gain schedule (ramp model, blocked if dep failed)
  const gainSchedule = buildGainSchedule(annualGain, timelineMonths, gainBlocked);

  // §5 — Net monthly cash flow
  const netCashFlow = investmentSchedule.map((inv, i) => (gainSchedule[i] ?? 0) - inv);

  // §6 — Cumulative cash flow
  const cumulativeCashFlow: number[] = [];
  let running = 0;
  for (const net of netCashFlow) {
    running += net;
    cumulativeCashFlow.push(Math.round(running));
  }

  // §7 — True payback month
  const truePaybackMonth = findTruePaybackMonth(cumulativeCashFlow);

  return {
    timeline_months: timelineMonths,
    investment_schedule: investmentSchedule,
    gain_schedule: gainSchedule,
    net_cash_flow: netCashFlow,
    cumulative_cash_flow: cumulativeCashFlow,
    true_payback_month: truePaybackMonth,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: buildPortfolioCashflow
// ════════════════════════════════════════════════════════════════════════════════

/**
 * §8-§9: Builds the portfolio-level cash flow timeline.
 *
 * Algorithm:
 *   1. For each recommendation ROI, sum monthly investment and gain arrays.
 *   2. Compute net (gain - investment) per month.
 *   3. Accumulate cumulative cash flow.
 *   4. Find portfolio true payback month (first month cumulative >= 0).
 *
 * §8 Rule: Dependencies must apply before timeline generation.
 * This function receives ROIs already processed by dependencyEngine — so
 * dep-blocked recs contribute 0 gain (enforced in computeRecommendationCashflow).
 *
 * @param rois            All recommendation ROIs (post dep-engine pass)
 * @param timelineMonths  Projection window, default 12
 */
export function buildPortfolioCashflow(
  rois: RecommendationROI[],
  timelineMonths = 12,
): PortfolioCashflow {
  // Collect per-recommendation cashflow schedules
  const cashflows = rois.map(roi => computeRecommendationCashflow(roi, timelineMonths));

  // §8 — Sum monthly gains + investments across all recommendations
  const monthlyProjection: MonthlyProjection[] = [];
  let cumulative = 0;

  for (let m = 0; m < timelineMonths; m++) {
    const totalInvestment = cashflows.reduce((s, cf) => s + (cf.investment_schedule[m] ?? 0), 0);
    const totalGain = cashflows.reduce((s, cf) => s + (cf.gain_schedule[m] ?? 0), 0);
    const net = totalGain - totalInvestment;
    cumulative += net;

    monthlyProjection.push({
      month: m + 1,
      investment: Math.round(totalInvestment),
      gain: Math.round(totalGain),
      net: Math.round(net),
      cumulative: Math.round(cumulative),
    });
  }

  // §7 — Portfolio true payback month
  const paybackIdx = monthlyProjection.findIndex(mp => mp.cumulative >= 0);
  const truePaybackMonth = paybackIdx >= 0 ? monthlyProjection[paybackIdx].month : null;

  return {
    monthly_projection: monthlyProjection,
    true_payback_month: truePaybackMonth,
    cashflow_positive_after_month: truePaybackMonth, // alias per spec §9
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY EXPORT: convertPaybackToMonths
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Converts a true_payback_month (nullable) to a display-safe float.
 * Returns 99 if payback is never reached within the projection window.
 */
export function resolvePaybackMonths(truePaybackMonth: number | null, fallback: number): number {
  if (truePaybackMonth === null) return 99;
  return truePaybackMonth;
}
