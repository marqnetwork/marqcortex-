/**
 * CORTEX CORE — IRR ENGINE (finance_v2_dcf_irr)
 *
 * IRR Integration Spec — irr-integration-spec.md
 *
 * Definition:
 *   IRR = the annual discount rate r where NPV = 0
 *   SUM( CashFlow_month[n] / (1 + r/12)^n ) = 0  for n = 1..N
 *
 * Solver: Binary Search (§3 — deterministic, stable for irregular cash flows)
 *   low_rate  = 0      (0% annual)
 *   high_rate = 5.0    (500% annual — spec §4 Step 1)
 *   tolerance = 0.0001 (§4 Step 3)
 *   max_iter  = 100    (§4 Step 3)
 *
 * Governance (§7):
 *   - Uses SAME net cash flows as DCF — via extendNetCashFlows() from dcfEngine
 *   - Never re-runs ROI math, never modifies gains or confidence scores
 *   - finance_recalc_required = true whenever timeline, investment, or gain changes
 *
 * Edge Cases (§5):
 *   A. All positive cash flows → irr_status = "invalid_no_negative_cashflow"
 *   B. Multiple sign changes   → irr_status = "multiple_possible_irr"
 *   C. Non-convergence         → irr_status = "irr_not_converged"
 *
 * Math decides IRR. Not storytelling.
 */

import type { IRRModel, IRRFailure, PortfolioCashflow } from './types';
import { extendNetCashFlows } from './dcfEngine';

// ════════════════════════════════════════════════════════════════════════════════
// §4 — SOLVER CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

const IRR_LOW_BOUND    = 0;       // §4 Step 1: 0% annual
const IRR_HIGH_BOUND   = 5.0;     // §4 Step 1: 500% annual max bound
const IRR_TOLERANCE    = 0.0001;  // §4 Step 3: NPV < tolerance → converged
const IRR_MAX_ITER     = 100;     // §4 Step 3: max iterations
const IRR_MIN_TIMELINE = 12;      // §7: match DCF minimum — same projection window

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: NPV COMPUTATION AT A GIVEN ANNUAL RATE
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Computes NPV for a cash flow array at the given annual rate.
 * §4 Step 2: r_monthly_test = r_annual_test / 12
 * NPV(r) = SUM( CF[n] / (1 + r/12)^(n) ) for n = 1..N  (1-based months)
 */
function computeNPVAtRate(cashflows: number[], rAnnual: number): number {
  const rMonthly = rAnnual / 12;
  return cashflows.reduce((npv, cf, idx) => {
    const n = idx + 1; // 1-based
    return npv + cf / Math.pow(1 + rMonthly, n);
  }, 0);
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: SIGN CHANGE COUNTER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Counts the number of sign changes in the cash flow series.
 * Zero values are skipped (they don't constitute a sign change).
 * Used for §5 edge case detection.
 */
function countSignChanges(cashflows: number[]): number {
  let changes = 0;
  let lastSign = 0;
  for (const cf of cashflows) {
    if (cf === 0) continue;
    const sign = cf > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) changes++;
    lastSign = sign;
  }
  return changes;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: computeIRR
// ════════════════════════════════════════════════════════════════════════════════

/**
 * §3-§6: Computes the Internal Rate of Return using binary search.
 *
 * Input: same PortfolioCashflow used for DCF (§7 governance).
 * Extended to minimum 12 months via extendNetCashFlows() from dcfEngine.
 *
 * Returns IRRModel on success, IRRFailure on any edge case or non-convergence.
 * Never fakes IRR. (§4 Step 4)
 */
export function computeIRR(
  portfolioCashflow: PortfolioCashflow | undefined | null,
): IRRModel | IRRFailure {

  // Failure: missing or empty cash flow projection
  if (!portfolioCashflow?.monthly_projection?.length) {
    return {
      status: 'irr_not_calculable',
      reason: 'Missing or empty portfolio cash flow projection — IRR requires validated monthly net cash flows.',
    };
  }

  // §7: Extend to minimum 12 months — same path as DCF (extendNetCashFlows from dcfEngine)
  const { netCashFlows } = extendNetCashFlows(portfolioCashflow, IRR_MIN_TIMELINE);

  // ── §5 Edge Case A: All positive cash flows (no initial investment in timeline) ──
  const allPositive = netCashFlows.every(cf => cf >= 0);
  if (allPositive) {
    return {
      status: 'invalid_no_negative_cashflow',
      reason: 'All monthly net cash flows are non-negative — no initial investment period detected. IRR is undefined when there is no sign change from negative to positive.',
    };
  }

  // ── §5 Edge Case B: Multiple sign changes (multiple IRRs possible) ──
  const signChanges = countSignChanges(netCashFlows);
  if (signChanges > 1) {
    return {
      status: 'multiple_possible_irr',
      reason: `${signChanges} sign changes detected in cash flow series — multiple IRRs are mathematically possible. Use MIRR for irregular cash flows (future enhancement per spec).`,
    };
  }

  // ── §4 Step 1: Define bounds ──
  let low  = IRR_LOW_BOUND;
  let high = IRR_HIGH_BOUND;

  const npvAtLow  = computeNPVAtRate(netCashFlows, low);
  const npvAtHigh = computeNPVAtRate(netCashFlows, high);

  // §4 Step 1: If NPV at high_rate is still positive → IRR exceeds cap
  if (npvAtHigh > IRR_TOLERANCE) {
    return {
      status: 'irr_not_converged',
      reason: `NPV remains positive ($${Math.round(npvAtHigh).toLocaleString()}) at ${(IRR_HIGH_BOUND * 100).toFixed(0)}% annual rate — IRR exceeds the ${(IRR_HIGH_BOUND * 100).toFixed(0)}% upper bound. This is beyond the solver's range.`,
    };
  }

  // Can't bracket: NPV is negative even at 0% (project never profitable)
  if (npvAtLow < 0) {
    return {
      status: 'irr_not_calculable',
      reason: `Project NPV is negative ($${Math.round(npvAtLow).toLocaleString()}) even at 0% discount rate — no positive IRR exists. Total cash outflows exceed total cash inflows.`,
    };
  }

  // ── §4 Steps 2-3: Binary search ──
  let iterations = 0;
  let mid = low;
  let npvMid = npvAtLow;

  while (iterations < IRR_MAX_ITER) {
    // §4 Step 2: midpoint in annual rate space
    mid = (low + high) / 2;
    // NPV at monthly rate = mid / 12
    npvMid = computeNPVAtRate(netCashFlows, mid);

    // §4 Step 3: convergence check
    if (Math.abs(npvMid) < IRR_TOLERANCE) {
      break;
    }

    // §4 Step 3: narrow the bracket
    if (npvMid > 0) {
      low = mid;  // IRR is higher — NPV still positive, need higher rate
    } else {
      high = mid; // IRR is lower  — NPV went negative, need lower rate
    }

    iterations++;
  }

  // §4 Step 4: If not converging — never fake IRR
  if (Math.abs(npvMid) >= IRR_TOLERANCE && iterations >= IRR_MAX_ITER) {
    return {
      status: 'irr_not_converged',
      reason: `Binary search did not converge after ${IRR_MAX_ITER} iterations. Final residual NPV: $${Math.round(npvMid).toLocaleString()}. Consider reviewing cash flow regularity.`,
    };
  }

  // ── §6: Build output payload ──
  const irrAnnualDecimal  = mid;
  const irrPercentAnnual  = parseFloat((irrAnnualDecimal * 100).toFixed(2));
  const irrPercentMonthly = parseFloat(((irrAnnualDecimal / 12) * 100).toFixed(4));

  const notes: string[] = [
    `IRR solved from validated monthly cash flow (same projection used for DCF — §7 governance)`,
    `Confidence-weighted gains applied before IRR — investment and gains in same timeline`,
    `Binary search: low=${(IRR_LOW_BOUND * 100).toFixed(0)}%, high=${(IRR_HIGH_BOUND * 100).toFixed(0)}%, tolerance=${IRR_TOLERANCE}`,
    `Converged in ${iterations + 1} iteration${iterations !== 0 ? 's' : ''} — residual NPV: $${Math.round(npvMid).toLocaleString()}`,
    `IRR = ${irrPercentAnnual}% annual (${irrPercentMonthly}% monthly equivalent)`,
    `r_monthly at IRR = ${((irrAnnualDecimal / 12) * 100).toFixed(6)}%`,
    ...(netCashFlows.length > portfolioCashflow.monthly_projection.length
      ? [`Timeline extended from ${portfolioCashflow.monthly_projection.length} to ${netCashFlows.length} months — same extension as DCF §4`]
      : []),
  ];

  // §8 Display Logic: high-return warning
  if (irrPercentAnnual > 300) {
    notes.push(
      `⚠ High return — check realism assumptions. IRR above 300% warrants review of gain estimates and timeline.`,
    );
  }

  return {
    finance_model_version: 'finance_v2_dcf_irr',
    irr_percent_annual:  irrPercentAnnual,
    irr_percent_monthly: irrPercentMonthly,
    irr_solver_method:   'binary_search',
    iterations_used:     iterations + 1,
    converged:           true,
    tolerance:           IRR_TOLERANCE,
    notes,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY EXPORT: isIRRModel (type guard)
// ════════════════════════════════════════════════════════════════════════════════

/** Type guard — distinguishes a successful IRRModel from an IRRFailure */
export function isIRRModel(result: IRRModel | IRRFailure): result is IRRModel {
  return 'finance_model_version' in result && (result as IRRModel).finance_model_version === 'finance_v2_dcf_irr';
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY EXPORT: getIRRStatusLabel
// ════════════════════════════════════════════════════════════════════════════════

/** Returns a human-readable display label for any IRR result (success or failure) */
export function getIRRStatusLabel(result: IRRModel | IRRFailure | undefined | null): string {
  if (!result)               return 'Not computed';
  if (isIRRModel(result))    return `${result.irr_percent_annual}% annual`;
  switch (result.status) {
    case 'invalid_no_negative_cashflow': return 'Undefined (all positive flows)';
    case 'multiple_possible_irr':        return 'Multiple IRRs (irregular flows)';
    case 'irr_not_converged':            return 'Not converged (rate out of range)';
    default:                             return 'Not calculable';
  }
}
