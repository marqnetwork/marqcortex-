/**
 * CORTEX CORE — DCF ENGINE (finance_v1_dcf)
 *
 * Discounted Cash Flow Integration — dcf-integration-spec.md
 *
 * Governance Rule (§7):
 *   DCF is purely a valuation adjustment layer.
 *   It operates ONLY on validated net monthly cash flow from cashflowEngine.
 *   It must NOT:
 *     - Re-run ROI math
 *     - Modify gain assumptions
 *     - Affect confidence scores
 *
 * Pipeline position (§3):
 *   Dependency validation → Confidence weighting → Gain ramping → DCF
 *   Never discount raw gains.
 *
 * Formulas (locked):
 *   §2  r_annual  = discount_rate_percent / 100
 *       r_monthly = r_annual / 12
 *   §3  DCF(month_n) = Net_CF(n) / (1 + r_monthly)^n
 *   §4  NPV = SUM(all monthly DCF values)
 *   §5A Nominal Payback  = first month where cumulative net_CF >= 0 (from cashflowEngine)
 *   §5B Discounted Payback = first month where cumulative DCF >= 0
 *
 * Math decides present value. Not storytelling.
 */

import type {
  DCFModel,
  DCFFailure,
  DCFProjectionEntry,
  PortfolioCashflow,
} from './types';

// ════════════════════════════════════════════════════════════════════════════════
// §1 — DISCOUNT RATE VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

const DCF_RATE_DEFAULT = 12;     // §1: Default 12% if not provided
const DCF_RATE_MIN = 0;          // §1: Cannot be negative
const DCF_RATE_MAX = 40;         // §1: Max 40%
const DCF_MIN_TIMELINE = 12;     // §4: Minimum projection window

/**
 * Validates and clamps the discount_rate_percent.
 * Returns null if value is unambiguously invalid (negative).
 */
function validateDiscountRate(raw: number | undefined): number | null {
  const rate = raw ?? DCF_RATE_DEFAULT;
  if (rate < DCF_RATE_MIN || rate > DCF_RATE_MAX) return null;
  return rate;
}

// ════════════════════════════════════════════════════════════════════════════════
// §4 — TIMELINE EXTENSION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * §4: If the cashflow timeline < 12 months, extend it with stable gains at
 * 100% ramp and no additional investment beyond the execution period.
 *
 * The "stable gain" is derived from the last month's gain value — which by
 * definition should already be at 100% ramp in the cashflowEngine output.
 *
 * @exported — used by irrEngine to guarantee identical cash flow preparation
 */
export function extendNetCashFlows(
  portfolioCashflow: PortfolioCashflow,
  targetMonths: number,
): { netCashFlows: number[]; extended: boolean; stableGainUsed: number } {
  const projection = portfolioCashflow.monthly_projection;
  const netCashFlows = projection.map(m => m.net);

  if (netCashFlows.length >= targetMonths) {
    return { netCashFlows, extended: false, stableGainUsed: 0 };
  }

  // §4: Extend with stable gains (last month's gain) and 0 investment
  const lastMonth = projection[projection.length - 1];
  const stableGain = lastMonth?.gain ?? 0; // 100% ramp already applied by cashflowEngine

  const extended = [...netCashFlows];
  while (extended.length < targetMonths) {
    extended.push(stableGain); // 0 investment + stable gain = stableGain net
  }

  return { netCashFlows: extended, extended: true, stableGainUsed: stableGain };
}

// ════════════════════════════════════════════════════════════════════════════════
// §3 — MONTHLY DISCOUNT FORMULA
// ════════════════════════════════════════════════════════════════════════════════

/**
 * §3: Discounts a single month's net cash flow.
 * DCF(n) = Net_CF(n) / (1 + r_monthly)^n
 * n is 1-based month index.
 */
function discountMonthlyFlow(netCF: number, rMonthly: number, n: number): number {
  return netCF / Math.pow(1 + rMonthly, n);
}

// ════════════════════════════════════════════════════════════════════════════════
// §5B — DISCOUNTED PAYBACK FINDER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Returns the first month (1-based) where the cumulative discounted cash flow >= 0.
 * Returns null if never reached within the projection window.
 */
function findDiscountedPayback(projection: DCFProjectionEntry[]): number | null {
  const idx = projection.findIndex(e => e.cumulative_discounted >= 0);
  return idx >= 0 ? idx + 1 : null; // 0-based index → 1-based month
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: computeDCF
// ════════════════════════════════════════════════════════════════════════════════

/**
 * §3-§6: Computes the full DCF model for a portfolio's cash flow projection.
 *
 * Input requirements (§8 failure conditions):
 *   - portfolioCashflow.monthly_projection must be non-empty
 *   - discountRatePercent must be in [0, 40]
 *
 * Ordering guarantee (§7 governance):
 *   Must be called AFTER cashflowEngine.buildPortfolioCashflow() which itself
 *   runs after dependency validation + confidence weighting + gain ramping.
 *   DCF only touches net_cash_flow values. It never modifies gains, investments,
 *   or confidence scores.
 *
 * @param portfolioCashflow  Output of buildPortfolioCashflow() — validated, ramp-applied
 * @param discountRatePercent §1: Annual discount rate (0–40, default 12)
 */
export function computeDCF(
  portfolioCashflow: PortfolioCashflow | undefined | null,
  discountRatePercent: number | undefined,
): DCFModel | DCFFailure {

  // §8 — Failure condition: missing cash flow projection
  if (!portfolioCashflow?.monthly_projection?.length) {
    return {
      status: 'finance_not_calculable',
      reason: 'missing_cashflow_or_discount_rate',
    };
  }

  // §1 + §8 — Validate discount rate
  const validatedRate = validateDiscountRate(discountRatePercent);
  if (validatedRate === null) {
    return {
      status: 'finance_not_calculable',
      reason: 'missing_cashflow_or_discount_rate',
    };
  }

  // §2 — Discount rate conversion (annual → monthly)
  const rAnnual = validatedRate / 100;
  const rMonthly = rAnnual / 12;

  // §4 — Extend timeline to minimum 12 months if needed
  const { netCashFlows, extended, stableGainUsed } = extendNetCashFlows(
    portfolioCashflow,
    DCF_MIN_TIMELINE,
  );

  // §3 + §6 — Build discounted projection month-by-month
  const discountedProjection: DCFProjectionEntry[] = [];
  let npvAccumulator = 0;
  let cumulativeDiscounted = 0;

  for (let n = 1; n <= netCashFlows.length; n++) {
    const netCF = netCashFlows[n - 1];

    // §3: DCF(n) = Net_CF(n) / (1 + r_monthly)^n
    const discountedCF = discountMonthlyFlow(netCF, rMonthly, n);
    cumulativeDiscounted += discountedCF;
    npvAccumulator += discountedCF;

    discountedProjection.push({
      month: n,
      net_cashflow: Math.round(netCF),
      discounted_cashflow: Math.round(discountedCF),
      cumulative_discounted: Math.round(cumulativeDiscounted),
    });
  }

  // §4 — NPV = SUM(all discounted monthly cash flows)
  const npv = Math.round(npvAccumulator);

  // §5B — Discounted payback: first month where cumulative_discounted >= 0
  const discountedPaybackMonth = findDiscountedPayback(discountedProjection);

  // §6 — Method notes (transparency)
  const methodNotes: string[] = [
    `Discount rate applied monthly (r_monthly = ${(rMonthly * 100).toFixed(4)}%, from ${validatedRate}% annual)`,
    'DCF applied after confidence weighting, dependency validation, and gain ramping (§3)',
    'Investment and gains discounted in the same model — net_cashflow is the base (§7)',
    `NPV computed over ${netCashFlows.length}-month horizon`,
    ...(extended
      ? [`Timeline extended to ${netCashFlows.length} months: stable gain of $${Math.round(stableGainUsed).toLocaleString()}/mo at 100% ramp, $0 additional investment (§4)`]
      : []),
    npv >= 0
      ? `NPV is positive ($${npv.toLocaleString()}) — project adds economic value at ${validatedRate}% discount rate`
      : `NPV is negative ($${npv.toLocaleString()}) — project destroys economic value at ${validatedRate}% discount rate`,
  ];

  return {
    finance_model_version: 'finance_v1_dcf',
    discount_rate_percent: validatedRate,
    r_monthly: parseFloat(rMonthly.toFixed(8)),
    npv,
    discounted_payback_month: discountedPaybackMonth,
    discounted_cashflow_projection: discountedProjection,
    method_notes: methodNotes,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY EXPORT: isDCFModel (type guard)
// ════════════════════════════════════════════════════════════════════════════════

/** Type guard — distinguishes a successful DCFModel from a DCFFailure */
export function isDCFModel(result: DCFModel | DCFFailure): result is DCFModel {
  return 'finance_model_version' in result;
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY EXPORT: getEffectiveDiscountRate
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Returns the effective discount rate to use, applying §1 defaults and clamping.
 * Safe to call even if assumptions.discount_rate_percent is undefined.
 */
export function getEffectiveDiscountRate(raw: number | undefined): number {
  if (raw === undefined || raw === null) return DCF_RATE_DEFAULT;
  if (raw < DCF_RATE_MIN) return DCF_RATE_DEFAULT; // invalid → fall back to default
  if (raw > DCF_RATE_MAX) return DCF_RATE_MAX;     // clamp at ceiling
  return raw;
}