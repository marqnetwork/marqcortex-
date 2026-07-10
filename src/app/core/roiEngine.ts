/**
 * CORTEX CORE — ROI ENGINE (roi_engine_v1_conservative)
 *
 * DEV MATHEMATICAL DOCUMENTATION — roi-engine-math-doc.md
 *
 * Global Rules:
 *   - All gains must be annualized.
 *   - All gains must be confidence-weighted.
 *   - Revenue must be calculated at gross margin, not top-line.
 *   - Efficiency gains must use realization factors.
 *   - ROI display must respect hard cap.
 *   - No double counting across dependent recommendations.
 *   - If baseline missing → return "not_calculable".
 *
 * Core Formulas:
 *   ROI = (Annual Gain - Investment) / Investment
 *   Payback Months = Investment / (Annual Gain / 12)
 *
 * Impact-Type Realization Factors:
 *   A) Efficiency:       Low=0.35, Mid=0.55, High=0.75
 *   B) Cost Reduction:   Low=0.50, Mid=0.70, High=0.85
 *   C) Revenue Growth:   Low=0.20, Mid=0.35, High=0.50
 *   D) Risk Reduction:   Low=0.15, Mid=0.25, High=0.40
 *
 * Pipeline:
 *   Raw Annual Value → Apply Realization Factor → Apply Confidence → Final Gain
 *
 * Math decides ROI. Not storytelling.
 */

import type {
  RecommendationV2,
  BusinessTransformationPortfolio,
  CrossDependency,
  DepartmentKey,
  RecommendationROI,
  PortfolioROIModel,
  PortfolioAssumptions,
} from './types';
import { validateDependencies } from './dependencyEngine';
import { computeCostModel, validatePortfolioGovernance } from './costEngine';
import { computeRecommendationCashflow, buildPortfolioCashflow, resolvePaybackMonths } from './cashflowEngine';
import { computeDCF, getEffectiveDiscountRate } from './dcfEngine';
import { computeIRR } from './irrEngine';
import { runMonteCarloSimulation } from './monteCarloEngine';
import { buildScenarioModel, getActiveScenarioCashflow, getScenarioGainTier, SCENARIO_PRESETS } from './scenarioEngine';
import type { ScenarioKey } from './types';

// ════════════════════════════════════════════════════════════════════════════════
// REALIZATION FACTORS — roi-engine-math-doc.md §3
// ════════════════════════════════════════════════════════════════════════════════

interface RealizationFactors {
  low: number;
  mid: number;
  high: number;
}

const REALIZATION: Record<string, RealizationFactors> = {
  efficiency:        { low: 0.35, mid: 0.55, high: 0.75 },
  cost_reduction:    { low: 0.50, mid: 0.70, high: 0.85 },
  revenue_growth:    { low: 0.20, mid: 0.35, high: 0.50 },
  revenue_protection:{ low: 0.20, mid: 0.35, high: 0.50 }, // alias
  risk_reduction:    { low: 0.15, mid: 0.25, high: 0.40 },
};

// Default assumptions used when PortfolioAssumptions not passed
const DEFAULT_LABOR_COST = 75;  // $/hr
const DEFAULT_GROSS_MARGIN = 0.42; // 42%

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: buildPortfolioROI
// ════════════════════════════════════════════════════════════════════════════════

export function buildPortfolioROI(
  portfolio: BusinessTransformationPortfolio,
  employeeEstimate: number,
  assumptions?: PortfolioAssumptions,
  maxROICap?: number,
  activeScenario: ScenarioKey = 'expected',
): PortfolioROIModel {
  const sizeMultiplier = employeeEstimate > 200 ? 3 : employeeEstimate > 50 ? 2 : 1;
  const cap = maxROICap ?? 350;
  const laborCost = assumptions?.labor_cost_per_hour ?? DEFAULT_LABOR_COST;
  const grossMargin = (assumptions?.gross_margin_percent ?? (DEFAULT_GROSS_MARGIN * 100)) / 100;

  // §1-5: Build per-recommendation ROI
  const recROIs = portfolio.recommendations.map(rec =>
    buildRecommendationROI(rec, sizeMultiplier, laborCost, grossMargin, cap, assumptions),
  );

  // §8: Dependency-safe portfolio aggregation
  const depAdjustments = buildDependencyAdjustments(portfolio.cross_dependencies);
  const adjustedROIs = applyDependencyDeduction(recROIs, depAdjustments);

  // dependency_engine_v1: Run full dependency validation (§1-§9)
  // This must run AFTER individual ROIs but BEFORE portfolio aggregation (§6)
  const confidenceFloor = 60; // default; should match constraints.confidence_floor_for_roi
  const depValidation = validateDependencies(
    portfolio.recommendations,
    adjustedROIs,
    portfolio.cross_dependencies,
    confidenceFloor,
  );

  // §7: If circular dependency detected, block all ROIs
  if (depValidation.status === 'invalid_dependency_graph') {
    for (const roi of adjustedROIs) {
      roi.is_roi_eligible = false;
      roi.roi_locked_reason = depValidation.error ?? 'circular_dependency_detected';
      roi.display.adjusted_roi_label = 'Blocked';
      roi.display.assumptions.push(`§7: ${depValidation.error}`);
    }
  }

  // cashflow_model_v1: Compute per-recommendation cash flow timelines
  // Must run AFTER dependency validation so gains are already dep-adjusted
  for (const roi of adjustedROIs) {
    roi.cashflow = computeRecommendationCashflow(roi, 12);
    // §7 (cashflow spec): Override payback_months with true cashflow payback
    // This replaces the simplified Investment / (Annual Gain / 12) estimate
    roi.payback_months = resolvePaybackMonths(roi.cashflow.true_payback_month, roi.payback_months);
    // Update display payback_timeline to reflect true cashflow payback
    const pm = roi.cashflow.true_payback_month;
    if (roi.is_roi_eligible) {
      roi.display.payback_timeline = pm === null
        ? 'Beyond 12mo'
        : pm <= 1
        ? 'Month 1'
        : `Month ${pm}`;
    }
  }

  // §6: Portfolio aggregation — ONLY after dependency cleanup
  const eligibleROIs = adjustedROIs.filter(r => r.is_roi_eligible);

  // Portfolio uses mid-case confidence-adjusted gains (the "final" gain)
  const totalInvestment = eligibleROIs.reduce((s, r) => s + r.inputs.investment_cost, 0);

  // finance_v4_scenarios §3: Select gain tier based on active scenario
  // conservative → low_case.gain, expected → mid_case.gain, aggressive → high_case.gain
  const scenarioGainTier = getScenarioGainTier(activeScenario);
  const totalGainMid  = eligibleROIs.reduce((s, r) => s + r.roi_range.mid_case.gain, 0);
  const totalGainActive = eligibleROIs.reduce((s, r) => s + r.roi_range[scenarioGainTier].gain, 0);

  const totalGain90d  = Math.round(totalGainActive * 0.25);
  const totalGain12mo = Math.round(totalGainActive);

  // Portfolio ROI = (Portfolio Gain - Portfolio Investment) / Portfolio Investment
  const rawPortfolioROI = totalInvestment > 0
    ? Math.round((totalGain12mo - totalInvestment) / totalInvestment * 100)
    : 0;

  // §7: ROI capping
  const totalAdjROI = Math.min(rawPortfolioROI, cap);

  const avgConfidence = eligibleROIs.length > 0
    ? eligibleROIs.reduce((s, r) => s + r.inputs.confidence_score, 0) / eligibleROIs.length
    : 0;
  const riskAdjReturn = Math.round(totalGain12mo * avgConfidence / 100);

  // Portfolio range
  const lowTotal = eligibleROIs.reduce((s, r) => s + r.roi_range.low_case.gain, 0);
  const midTotal = totalGainMid;
  const highTotal = eligibleROIs.reduce((s, r) => s + r.roi_range.high_case.gain, 0);

  const computeRangeROI = (gain: number) =>
    totalInvestment > 0 ? Math.min(Math.round((gain - totalInvestment) / totalInvestment * 100), cap) : 0;

  // Portfolio payback = Investment / (Annual Gain / 12)
  const monthlyGain = totalGain12mo / 12;
  const portfolioPayback = monthlyGain > 0 ? parseFloat((totalInvestment / monthlyGain).toFixed(1)) : 99;

  // Execution impact curve
  const orderedIds = portfolio.execution_sequence_model.recommended_execution_order;
  let cumInv = 0;
  let cumGain = 0;
  const impactCurve = orderedIds.map((id, idx) => {
    const roi = adjustedROIs.find(r => r.recommendation_id === id);
    if (roi && roi.is_roi_eligible) {
      cumInv += roi.inputs.investment_cost;
      cumGain += roi.roi_range.mid_case.gain; // confidence-adjusted mid
    }
    return {
      step: idx + 1,
      recommendation_id: id,
      department: roi?.department || ('operations_supply_chain' as DepartmentKey),
      cumulative_investment: Math.round(cumInv),
      cumulative_gain_12mo: Math.round(cumGain),
      cumulative_roi_percent: cumInv > 0
        ? Math.min(Math.round((cumGain - cumInv) / cumInv * 100), cap)
        : 0,
    };
  });

  // cashflow_model_v1 §8: Build portfolio-level cash flow timeline
  // Must run AFTER per-rec cashflows are computed (deps already applied above)
  const portfolioCashflow = buildPortfolioCashflow(adjustedROIs, 12);

  // finance_v4_scenarios §3: Apply scenario knobs to cashflow BEFORE DCF/IRR/MonteCarlo
  // For non-expected scenarios: scale gains by (scenarioGain / midGain) + ramp shift
  const activeCashflow = getActiveScenarioCashflow(eligibleROIs, portfolioCashflow, activeScenario);

  // §7 (cashflow spec): Override portfolio payback with true cashflow payback
  const truePortfolioPayback = resolvePaybackMonths(activeCashflow.true_payback_month, portfolioPayback);

  // finance_v1_dcf §3-§6: Compute DCF / NPV from scenario-adjusted portfolio net cash flows
  // §3 governance: runs AFTER dependency validation + confidence weighting + gain ramping
  // §7 governance: does NOT re-run ROI math, does NOT modify gains or confidence
  const discountRate = getEffectiveDiscountRate(assumptions?.discount_rate_percent);
  const dcfModel = computeDCF(activeCashflow, discountRate);

  // finance_v2_dcf_irr §3-§6: Compute IRR using scenario-adjusted cash flow projection
  const irrModel = computeIRR(activeCashflow);

  // finance_v4_scenarios §4: Build all 3 scenario outputs for comparison panel
  // Uses existing roi_range.low/mid/high_case.gain — no re-computation needed
  const scenarioModel = buildScenarioModel(
    eligibleROIs,
    portfolioCashflow,   // base cashflow (mid-case) — scenarios derived from this
    Math.round(totalInvestment),
    discountRate,
    activeScenario,
  );

  // finance_v3_montecarlo §5: Run Monte Carlo under the active scenario
  // §1 governance: runs AFTER full pipeline — never touches base payload
  const monteCarloModel = runMonteCarloSimulation(
    portfolio.recommendations,
    adjustedROIs,
    activeCashflow,      // Monte Carlo runs under active scenario cashflow
    Math.round(totalInvestment),
    Math.round(totalGain12mo),
    discountRate,
    assumptions ?? {
      monthly_revenue:          0,
      avg_order_value:          0,
      monthly_orders:           0,
      support_tickets_per_week: 100,
      avg_response_time_hours:  4,
      labor_cost_per_hour:      75,
      refund_rate_percent:      5,
      conversion_rate_percent:  3,
      gross_margin_percent:     42,
    },
  );

  return {
    recommendation_rois: adjustedROIs,
    portfolio_totals: {
      total_investment: Math.round(totalInvestment),
      total_investment_label: `$${Math.round(totalInvestment / 1000)}K`,
      total_adjusted_gain_90d: totalGain90d,
      total_adjusted_gain_12mo: totalGain12mo,
      total_adjusted_roi_percent: totalAdjROI,
      risk_adjusted_return: riskAdjReturn,
    },
    portfolio_range: {
      low_case_total: Math.round(lowTotal),
      mid_case_total: Math.round(midTotal),
      high_case_total: Math.round(highTotal),
      low_case_roi: computeRangeROI(lowTotal),
      mid_case_roi: computeRangeROI(midTotal),
      high_case_roi: computeRangeROI(highTotal),
    },
    portfolio_payback_months: truePortfolioPayback,
    execution_impact_curve: impactCurve,
    dependency_adjustments: depAdjustments,
    dependency_validation: depValidation,
    portfolio_cashflow: activeCashflow,
    dcf_model: dcfModel,
    irr_model: irrModel,
    monte_carlo: monteCarloModel,
    scenario_model: scenarioModel,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PER-RECOMMENDATION ROI
// ════════════════════════════════════════════════════════════════════════════════

function buildRecommendationROI(
  rec: RecommendationV2,
  sizeMultiplier: number,
  laborCost: number,
  grossMargin: number,
  roiCap: number,
  assumptions?: PortfolioAssumptions,
): RecommendationROI {
  const dept = rec.core_problem.problem_id as DepartmentKey;
  const isEligible = rec.roi_eligibility?.is_roi_eligible ?? true;

  // cost_model_v1: Structured cost breakdown (replaces lump-sum)
  const costModel = computeCostModel(rec, sizeMultiplier, laborCost, assumptions);
  const investmentCost = costModel.investment_estimate.mid;

  const confidence = rec.confidence_model.confidence_score;
  const confidenceMultiplier = confidence / 100; // §4
  const feasibility = rec.feasibility?.computed_feasibility ?? 6;
  const timelineDays = rec.execution_plan.total_duration_days;

  const inputs = {
    baseline_metric: rec.impact_profile.baseline_value,
    target_metric_90d: rec.impact_profile.target_value_90d,
    investment_cost: investmentCost,
    confidence_score: confidence,
    feasibility_score: feasibility,
    timeline_days: timelineDays,
  };

  // §9 — Not Calculable condition
  if (!isEligible) {
    const lockedReason = rec.roi_eligibility?.gate_failures?.join('; ') || 'Missing required inputs';
    return buildLockedROI(rec.recommendation_id, dept, inputs, lockedReason);
  }

  // Check required baselines
  const missingBaselines = checkMissingBaselines(rec, laborCost, grossMargin);
  if (missingBaselines) {
    return buildLockedROI(rec.recommendation_id, dept, inputs, missingBaselines);
  }

  // §2-3: Compute impact by type with realization factors
  const impactCalcs = computeImpactCalculations(rec, investmentCost, sizeMultiplier, laborCost, grossMargin);

  // §4: Confidence weighting is applied within the three-case range below
  // raw_roi uses mid-case raw gain (before confidence)
  const rawMidGain = impactCalcs.total_projected_gain;
  const rawROI = investmentCost > 0
    ? Math.round((rawMidGain - investmentCost) / investmentCost * 100)
    : 0;

  // Confidence-adjusted mid gain
  const adjMidGain = Math.round(rawMidGain * confidenceMultiplier);
  const adjustedROI = investmentCost > 0
    ? Math.round((adjMidGain - investmentCost) / investmentCost * 100)
    : 0;

  // §3+4: Three-case range WITH per-type realization + confidence
  // impactCalcs.total_projected_gain is the MID realization
  // We need low and high via the per-impact-type factors
  const rangeGains = computeRangeGains(rec, investmentCost, sizeMultiplier, laborCost, grossMargin, confidenceMultiplier);

  // §7: Cap applied
  const capRoi = (roiPct: number) => Math.min(roiPct, roiCap);
  const roiFromGain = (gain: number) =>
    investmentCost > 0 ? Math.round((gain - investmentCost) / investmentCost * 100) : 0;

  const lowCapApplied = roiFromGain(rangeGains.low) > roiCap;
  const midCapApplied = roiFromGain(rangeGains.mid) > roiCap;
  const highCapApplied = roiFromGain(rangeGains.high) > roiCap;
  const anyCapApplied = lowCapApplied || midCapApplied || highCapApplied;

  const roiRange = {
    low_case: {
      efficiency: 0.6 as const, // display label (actual factor is per-type)
      gain: rangeGains.low,
      roi_percent: capRoi(roiFromGain(rangeGains.low)),
    },
    mid_case: {
      efficiency: 0.8 as const,
      gain: rangeGains.mid,
      roi_percent: capRoi(roiFromGain(rangeGains.mid)),
    },
    high_case: {
      efficiency: 1.0 as const,
      gain: rangeGains.high,
      roi_percent: capRoi(roiFromGain(rangeGains.high)),
    },
  };

  // §5 — Payback = Investment / (Annual Gain / 12)
  const monthlyGain = rangeGains.mid / 12;
  const paybackMonths = monthlyGain > 0 ? parseFloat((investmentCost / monthlyGain).toFixed(1)) : 99;

  // §7 — Display
  const displayROI = capRoi(adjustedROI);
  const display = {
    investment: `$${Math.round(investmentCost / 1000)}K`,
    gain_90d: `$${Math.round(rangeGains.mid * 0.25 / 1000)}K`,
    gain_12mo: `$${Math.round(rangeGains.mid / 1000)}K`,
    payback_timeline: paybackMonths < 1 ? 'Under 1 month' : paybackMonths <= 3 ? `${paybackMonths} months` : `${Math.round(paybackMonths)} months`,
    adjusted_roi_label: anyCapApplied ? `${displayROI}% (capped)` : `${displayROI}%`,
    assumptions: buildAssumptionTrail(rec, rawROI, confidence, displayROI, investmentCost, sizeMultiplier, anyCapApplied, roiCap),
  };

  return {
    recommendation_id: rec.recommendation_id,
    department: dept,
    is_roi_eligible: true,
    cost_model: costModel,
    inputs,
    impact_calculations: impactCalcs,
    raw_roi_percent: rawROI,
    adjusted_roi_percent: displayROI,
    roi_range: roiRange,
    payback_months: paybackMonths,
    display,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §9 — NOT CALCULABLE CHECK
// ════════════════════════════════════════════════════════════════════════════════

function checkMissingBaselines(
  rec: RecommendationV2,
  laborCost: number,
  grossMargin: number,
): string | null {
  const missing: string[] = [];
  const types = rec.impact_profile.impact_type;

  // labor_cost_per_hour required for efficiency
  if (types.includes('efficiency') && (!laborCost || laborCost <= 0)) {
    missing.push('labor_cost_per_hour');
  }

  // gross_margin_percent required for revenue
  if ((types.includes('revenue_growth')) && (!grossMargin || grossMargin <= 0)) {
    missing.push('gross_margin_percent');
  }

  // baseline metric must exist
  if (rec.impact_profile.baseline_value === 0 && rec.impact_profile.target_value_90d === 0) {
    missing.push('baseline metric');
  }

  if (missing.length > 0) {
    return `missing_baseline_or_assumptions: ${missing.join(', ')}`;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════
// §2-3: IMPACT CALCULATIONS (MID realization)
// ════════════════════════════════════════════════════════════════════════════════
// Returns the MID realization-adjusted gains (before confidence).
// total_projected_gain is the sum of all mid-case realized values.

function computeImpactCalculations(
  rec: RecommendationV2,
  investmentCost: number,
  sizeMultiplier: number,
  laborCost: number,
  grossMargin: number,
): RecommendationROI['impact_calculations'] {
  const ip = rec.impact_profile;
  const types = ip.impact_type;
  let totalGain = 0;

  const result: RecommendationROI['impact_calculations'] = {
    total_projected_gain: 0,
  };

  // ── A) Efficiency Gain ──
  // Raw Annual = hours_saved_per_week × labor_cost_per_hour × 52
  // Mid Realized = Raw × 0.55
  if (types.includes('efficiency')) {
    const delta = Math.abs(ip.baseline_value - ip.target_value_90d);
    let rawAnnual: number;

    if (ip.unit === 'hours') {
      // delta is hours/week or hours/month depending on context
      // Assume monthly delta → convert to weekly → annualize
      const weeklyHours = delta / 4.33; // monthly → weekly
      rawAnnual = weeklyHours * laborCost * 52;
    } else {
      rawAnnual = delta * laborCost * sizeMultiplier * 12;
    }

    const midRealized = Math.round(rawAnnual * REALIZATION.efficiency.mid);
    result.cost_reduction = {
      savings: midRealized,
      formula: ip.unit === 'hours'
        ? `${(delta / 4.33).toFixed(1)} hrs/wk × $${laborCost}/hr × 52wk × ${REALIZATION.efficiency.mid} realization`
        : `${delta} ${ip.unit} × $${laborCost} × ${sizeMultiplier}x × 12mo × ${REALIZATION.efficiency.mid} realization`,
    };
    totalGain += midRealized;
  }

  // ── B) Cost Reduction Gain ──
  // Raw Annual = direct_cost_savings (annualized)
  // Mid Realized = Raw × 0.70
  if (types.includes('cost_reduction') && !types.includes('efficiency')) {
    // Avoid double-counting if efficiency already calculated
    const delta = Math.abs(ip.baseline_value - ip.target_value_90d);
    let rawAnnual: number;

    if (ip.unit === 'dollars') {
      rawAnnual = delta * 12; // monthly → annual
    } else {
      rawAnnual = delta * laborCost * sizeMultiplier * 12;
    }

    const midRealized = Math.round(rawAnnual * REALIZATION.cost_reduction.mid);
    result.cost_reduction = {
      savings: midRealized,
      formula: `$${Math.round(rawAnnual / 1000)}K raw annual × ${REALIZATION.cost_reduction.mid} realization`,
    };
    totalGain += midRealized;
  }

  // ── C) Revenue Growth / Protection ──
  // Margin Revenue = incremental_revenue × gross_margin_percent
  // Mid Realized = Margin Revenue × 0.35
  if (types.includes('revenue_growth')) {
    const delta = Math.abs(ip.target_value_90d - ip.baseline_value);
    let incrementalRevenue: number;

    if (ip.unit === 'dollars') {
      incrementalRevenue = delta * 12; // monthly → annual
    } else if (ip.unit === 'percentage') {
      const baseVolume = sizeMultiplier * 100;
      incrementalRevenue = delta * baseVolume * 12;
    } else {
      incrementalRevenue = delta * laborCost * 12;
    }

    // Revenue at gross margin, not top-line (§3C)
    const marginRevenue = incrementalRevenue * grossMargin;
    const midRealized = Math.round(marginRevenue * REALIZATION.revenue_growth.mid);

    result.revenue_impact = {
      projected_gain: midRealized,
      formula: `$${Math.round(incrementalRevenue / 1000)}K incremental × ${(grossMargin * 100).toFixed(0)}% margin × ${REALIZATION.revenue_growth.mid} realization`,
    };
    totalGain += midRealized;
  }

  // ── D) Risk Reduction ──
  // Expected Risk = probability × exposure_value
  // Mid Realized = Expected Risk × 0.25
  if (types.includes('risk_reduction')) {
    const riskProb = rec.risk_profile.some(r => r.probability === 'high') ? 0.4
      : rec.risk_profile.some(r => r.probability === 'medium') ? 0.25 : 0.1;
    const financialExposure = investmentCost * 5; // estimated 5x investment exposure
    const expectedRisk = riskProb * financialExposure;
    const midRealized = Math.round(expectedRisk * REALIZATION.risk_reduction.mid);

    result.risk_reduction = {
      expected_loss_avoided: midRealized,
      formula: `${(riskProb * 100).toFixed(0)}% prob × $${Math.round(financialExposure / 1000)}K exposure × ${REALIZATION.risk_reduction.mid} reduction`,
    };
    totalGain += midRealized;
  }

  // Fallback if no typed impact was calculated
  if (totalGain === 0) {
    const delta = Math.abs(ip.target_value_90d - ip.baseline_value);
    totalGain = Math.round(delta * laborCost * sizeMultiplier * 12 * REALIZATION.efficiency.mid);
  }

  result.total_projected_gain = totalGain;
  return result;
}

// ════════════════════════════════════════════════════════════════════════════════
// §3+4: THREE-CASE RANGE GAINS (Low/Mid/High realization + Confidence)
// ════════════════════════════════════════════════════════════════════════════════
// Returns confidence-adjusted gains for each case.

function computeRangeGains(
  rec: RecommendationV2,
  investmentCost: number,
  sizeMultiplier: number,
  laborCost: number,
  grossMargin: number,
  confidenceMultiplier: number,
): { low: number; mid: number; high: number } {
  const ip = rec.impact_profile;
  const types = ip.impact_type;

  const accum = { low: 0, mid: 0, high: 0 };

  // ── A) Efficiency ──
  if (types.includes('efficiency')) {
    const delta = Math.abs(ip.baseline_value - ip.target_value_90d);
    let rawAnnual: number;
    if (ip.unit === 'hours') {
      const weeklyHours = delta / 4.33;
      rawAnnual = weeklyHours * laborCost * 52;
    } else {
      rawAnnual = delta * laborCost * sizeMultiplier * 12;
    }
    accum.low += rawAnnual * REALIZATION.efficiency.low;
    accum.mid += rawAnnual * REALIZATION.efficiency.mid;
    accum.high += rawAnnual * REALIZATION.efficiency.high;
  }

  // ── B) Cost Reduction ──
  if (types.includes('cost_reduction') && !types.includes('efficiency')) {
    const delta = Math.abs(ip.baseline_value - ip.target_value_90d);
    let rawAnnual: number;
    if (ip.unit === 'dollars') {
      rawAnnual = delta * 12;
    } else {
      rawAnnual = delta * laborCost * sizeMultiplier * 12;
    }
    accum.low += rawAnnual * REALIZATION.cost_reduction.low;
    accum.mid += rawAnnual * REALIZATION.cost_reduction.mid;
    accum.high += rawAnnual * REALIZATION.cost_reduction.high;
  }

  // ── C) Revenue Growth ──
  if (types.includes('revenue_growth')) {
    const delta = Math.abs(ip.target_value_90d - ip.baseline_value);
    let incrementalRevenue: number;
    if (ip.unit === 'dollars') {
      incrementalRevenue = delta * 12;
    } else if (ip.unit === 'percentage') {
      incrementalRevenue = delta * sizeMultiplier * 100 * 12;
    } else {
      incrementalRevenue = delta * laborCost * 12;
    }
    const marginRevenue = incrementalRevenue * grossMargin;
    accum.low += marginRevenue * REALIZATION.revenue_growth.low;
    accum.mid += marginRevenue * REALIZATION.revenue_growth.mid;
    accum.high += marginRevenue * REALIZATION.revenue_growth.high;
  }

  // ── D) Risk Reduction ──
  if (types.includes('risk_reduction')) {
    const riskProb = rec.risk_profile.some(r => r.probability === 'high') ? 0.4
      : rec.risk_profile.some(r => r.probability === 'medium') ? 0.25 : 0.1;
    const financialExposure = investmentCost * 5;
    const expectedRisk = riskProb * financialExposure;
    accum.low += expectedRisk * REALIZATION.risk_reduction.low;
    accum.mid += expectedRisk * REALIZATION.risk_reduction.mid;
    accum.high += expectedRisk * REALIZATION.risk_reduction.high;
  }

  // Fallback
  if (accum.mid === 0) {
    const delta = Math.abs(ip.target_value_90d - ip.baseline_value);
    const base = delta * laborCost * sizeMultiplier * 12;
    accum.low = base * REALIZATION.efficiency.low;
    accum.mid = base * REALIZATION.efficiency.mid;
    accum.high = base * REALIZATION.efficiency.high;
  }

  // §4: Confidence weighting applied AFTER realization
  return {
    low: Math.round(accum.low * confidenceMultiplier),
    mid: Math.round(accum.mid * confidenceMultiplier),
    high: Math.round(accum.high * confidenceMultiplier),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §7 — ASSUMPTION TRAIL
// ════════════════════════════════════════════════════════════════════════════════

function buildAssumptionTrail(
  rec: RecommendationV2,
  rawROI: number,
  confidence: number,
  displayROI: number,
  investmentCost: number,
  sizeMultiplier: number,
  capApplied: boolean,
  roiCap: number,
): string[] {
  const types = rec.impact_profile.impact_type;
  const trail: string[] = [];

  trail.push(`Confidence-adjusted: raw ${rawROI}% × (${confidence}/100) = ${displayROI}%`);
  trail.push(`Investment: $${Math.round(investmentCost / 1000)}K (${sizeMultiplier}x size multiplier)`);
  trail.push(`Baseline: ${rec.impact_profile.baseline_value} ${rec.impact_profile.unit} → Target (90d): ${rec.impact_profile.target_value_90d} ${rec.impact_profile.unit}`);
  trail.push(`Timeline: ${rec.execution_plan.total_duration_days} days`);

  // Realization factors used
  const realizationNotes: string[] = [];
  if (types.includes('efficiency')) realizationNotes.push(`Efficiency: 0.35/0.55/0.75`);
  if (types.includes('cost_reduction')) realizationNotes.push(`Cost: 0.50/0.70/0.85`);
  if (types.includes('revenue_growth')) realizationNotes.push(`Revenue: 0.20/0.35/0.50 (at gross margin)`);
  if (types.includes('risk_reduction')) realizationNotes.push(`Risk: 0.15/0.25/0.40`);
  if (realizationNotes.length > 0) {
    trail.push(`Realization factors: ${realizationNotes.join('; ')}`);
  }

  if (capApplied) {
    trail.push(`ROI capped at ${roiCap}% (raw computed ROI exceeded safety threshold)`);
  }

  return trail;
}

// ════════════════════════════════════════════════════════════════════════════════
// §8 — DEPENDENCY-SAFE PORTFOLIO AGGREGATION
// ════════════════════════════════════════════════════════════════════════════════
// If B depends on A:
//   A may claim efficiency/cost gains
//   B may only claim revenue gains created after A
// Dev must check: if recommendation.depends_on exists → exclude overlapping gain categories

function buildDependencyAdjustments(
  deps: CrossDependency[],
): PortfolioROIModel['dependency_adjustments'] {
  const adjustments: PortfolioROIModel['dependency_adjustments'] = [];

  for (const dep of deps) {
    if (dep.dependency_type === 'required_before' || dep.dependency_type === 'enhances') {
      adjustments.push({
        source_department: dep.source_department,
        target_department: dep.target_department,
        adjustment_type: dep.dependency_type === 'required_before'
          ? 'efficiency_credit_only' : 'revenue_credit_to_target',
        description: dep.dependency_type === 'required_before'
          ? `${dep.source_department.replace(/_/g, ' ')} enables ${dep.target_department.replace(/_/g, ' ')} — source gets efficiency credit only (§8).`
          : `${dep.source_department.replace(/_/g, ' ')} enhances ${dep.target_department.replace(/_/g, ' ')} — revenue credit goes to target (§8).`,
      });
    }
  }

  return adjustments;
}

function applyDependencyDeduction(
  rois: RecommendationROI[],
  adjustments: PortfolioROIModel['dependency_adjustments'],
): RecommendationROI[] {
  // §8: If A enables B, A may only claim efficiency/cost gains.
  // Remove revenue impact from source recommendations entirely.
  const sourceDepts = new Set(
    adjustments
      .filter(a => a.adjustment_type === 'efficiency_credit_only')
      .map(a => a.source_department),
  );

  return rois.map(roi => {
    if (sourceDepts.has(roi.department) && roi.impact_calculations.revenue_impact) {
      const revenueGain = roi.impact_calculations.revenue_impact.projected_gain;
      const newTotal = Math.max(0, roi.impact_calculations.total_projected_gain - revenueGain);

      // Also deduct from range gains proportionally
      const ratio = roi.impact_calculations.total_projected_gain > 0
        ? newTotal / roi.impact_calculations.total_projected_gain
        : 1;

      return {
        ...roi,
        impact_calculations: {
          ...roi.impact_calculations,
          revenue_impact: undefined, // removed — only efficiency/cost credit
          total_projected_gain: newTotal,
        },
        roi_range: {
          low_case: { ...roi.roi_range.low_case, gain: Math.round(roi.roi_range.low_case.gain * ratio) },
          mid_case: { ...roi.roi_range.mid_case, gain: Math.round(roi.roi_range.mid_case.gain * ratio) },
          high_case: { ...roi.roi_range.high_case, gain: Math.round(roi.roi_range.high_case.gain * ratio) },
        },
        display: {
          ...roi.display,
          assumptions: [
            ...roi.display.assumptions,
            `§8 Dependency: revenue credit ($${Math.round(revenueGain / 1000)}K) moved to downstream dept`,
          ],
        },
      };
    }
    return roi;
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// LOCKED ROI (not eligible / not_calculable)
// ════════════════════════════════════════════════════════════════════════════════

function buildLockedROI(
  recId: string,
  dept: DepartmentKey,
  inputs: RecommendationROI['inputs'],
  reason: string,
): RecommendationROI {
  return {
    recommendation_id: recId,
    department: dept,
    is_roi_eligible: false,
    roi_locked_reason: reason,
    inputs,
    impact_calculations: { total_projected_gain: 0 },
    raw_roi_percent: 0,
    adjusted_roi_percent: 0,
    roi_range: {
      low_case: { efficiency: 0.6, gain: 0, roi_percent: 0 },
      mid_case: { efficiency: 0.8, gain: 0, roi_percent: 0 },
      high_case: { efficiency: 1.0, gain: 0, roi_percent: 0 },
    },
    payback_months: 0,
    display: {
      investment: `$${Math.round(inputs.investment_cost / 1000)}K`,
      gain_90d: 'Not Calculable',
      gain_12mo: 'Not Calculable',
      payback_timeline: 'N/A',
      adjusted_roi_label: 'Locked',
      assumptions: [`status: not_calculable — ${reason}`],
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §11 — SENSITIVITY CALCULATION (EXPORTED)
// ════════════════════════════════════════════════════════════════════════════════
// For top 3 sensitive variables:
//   Increase variable by 10%, recalculate portfolio ROI, measure delta %
//   Rank by delta impact.

export interface SensitivityResult {
  variable: string;
  baseline_roi: number;
  adjusted_roi: number;
  delta_percent: number;
}

export function computeSensitivityAnalysis(
  portfolio: BusinessTransformationPortfolio,
  employeeEstimate: number,
  assumptions: PortfolioAssumptions,
  maxROICap?: number,
): SensitivityResult[] {
  // Get baseline portfolio ROI
  const baselineModel = buildPortfolioROI(portfolio, employeeEstimate, assumptions, maxROICap);
  const baselineROI = baselineModel.portfolio_totals.total_adjusted_roi_percent;

  // Variables to test
  const sensitiveVars: (keyof PortfolioAssumptions)[] = [
    'support_tickets_per_week',
    'labor_cost_per_hour',
    'gross_margin_percent',
    'monthly_revenue',
    'avg_order_value',
    'conversion_rate_percent',
    'refund_rate_percent',
    'avg_response_time_hours',
    'monthly_orders',
  ];

  const results: SensitivityResult[] = [];

  for (const variable of sensitiveVars) {
    const currentValue = (assumptions as any)[variable];
    if (typeof currentValue !== 'number' || currentValue === 0) continue;

    // Increase by 10%
    const adjustedAssumptions = { ...assumptions, [variable]: currentValue * 1.10 };
    const adjustedModel = buildPortfolioROI(portfolio, employeeEstimate, adjustedAssumptions, maxROICap);
    const adjustedROI = adjustedModel.portfolio_totals.total_adjusted_roi_percent;

    const deltaPercent = baselineROI !== 0
      ? Math.round(((adjustedROI - baselineROI) / Math.abs(baselineROI)) * 100)
      : adjustedROI;

    results.push({
      variable: variable as string,
      baseline_roi: baselineROI,
      adjusted_roi: adjustedROI,
      delta_percent: deltaPercent,
    });
  }

  // Rank by absolute delta impact (highest first)
  results.sort((a, b) => Math.abs(b.delta_percent) - Math.abs(a.delta_percent));

  return results;
}