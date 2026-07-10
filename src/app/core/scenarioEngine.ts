/**
 * CORTEX CORE — SCENARIO MODELING ENGINE (finance_v4_scenarios)
 *
 * Scenario Modeling Spec — scenario-modeling-spec.md
 *
 * §1 Purpose: one-click toggle between Conservative / Expected / Aggressive
 *    Each scenario changes ONLY: realization factors, ramp curve speed,
 *    confidence multiplier clamp (conservative only).
 *    Everything else (baselines, assumptions, investment) stays the same.
 *
 * §3 Application Order:
 *   Dependency Validation → Cost Model → Cash Flow Timeline →
 *   Apply Scenario Knobs → ROI math → DCF → IRR → Monte Carlo
 *
 * Key insight: the existing roi_range.low_case / mid_case / high_case on each
 * RecommendationROI ALREADY contains the conservative / expected / aggressive
 * gains — they use the exact same realization factors as the scenario presets.
 * Scenario engine reads these tiers directly. No re-computation needed.
 *
 * Governance (§5):
 *   - Scenario must NEVER change baselines or assumptions.
 *   - Scenario must NEVER increase confidence scores.
 *   - Scenario selection stored in version history.
 *   - Version bump triggered on scenario change.
 *
 * Math decides scenario outputs. Not storytelling.
 */

import type {
  ScenarioKey,
  ScenarioPreset,
  ScenarioOutput,
  ScenarioModel,
  RecommendationROI,
  PortfolioCashflow,
  MonthlyProjection,
} from './types';

// ════════════════════════════════════════════════════════════════════════════════
// §2 — LOCKED SCENARIO PRESETS
// These are immutable — governed by §5. No runtime override allowed.
//
// Conservative maps to REALIZATION.*.low  (existing roi_range.low_case.gain)
// Expected    maps to REALIZATION.*.mid   (existing roi_range.mid_case.gain)
// Aggressive  maps to REALIZATION.*.high  (existing roi_range.high_case.gain)
// ════════════════════════════════════════════════════════════════════════════════

export const SCENARIO_PRESETS: Record<ScenarioKey, ScenarioPreset> = {
  conservative: {
    realization_factors: { efficiency: 0.35, cost: 0.50, revenue: 0.20, risk: 0.15 },
    ramp_shift_months:   1,      // §2A: slower (+1 month delay)
    confidence_clamp_max: 80,   // §2A: optional safety clamp
  },
  expected: {
    realization_factors: { efficiency: 0.55, cost: 0.70, revenue: 0.35, risk: 0.25 },
    ramp_shift_months:   0,      // §2B: standard ramp
    confidence_clamp_max: null,  // §2B: no clamp
  },
  aggressive: {
    realization_factors: { efficiency: 0.75, cost: 0.85, revenue: 0.50, risk: 0.40 },
    ramp_shift_months:   -1,     // §2C: faster (-1 month shift)
    confidence_clamp_max: null,  // §2C: never inflate confidence
  },
};

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: GAIN TIER MAPPING
// ════════════════════════════════════════════════════════════════════════════════

export function getScenarioGainTier(
  scenario: ScenarioKey,
): 'low_case' | 'mid_case' | 'high_case' {
  return scenario === 'conservative' ? 'low_case'
       : scenario === 'aggressive'   ? 'high_case'
       : 'mid_case';
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: RAMP SHIFT APPLICATION
// Shifts the gain schedule forward or backward in time.
//   shift > 0: delay onset (conservative — gains start later)
//   shift < 0: accelerate onset (aggressive — gains start sooner)
//   shift = 0: no change (expected — standard ramp)
// ════════════════════════════════════════════════════════════════════════════════

export function applyRampShift(gains: number[], shift: number): number[] {
  if (shift === 0) return [...gains];
  const n = gains.length;
  const shifted = new Array<number>(n).fill(0);

  if (shift > 0) {
    // Delay: month t pulls from t−shift (0 for months before the new onset)
    for (let t = 0; t < n; t++) {
      const srcIdx = t - shift;
      shifted[t] = srcIdx >= 0 ? gains[srcIdx] : 0;
    }
  } else {
    // Accelerate: month t pulls from t+|shift| (clamped at last value)
    for (let t = 0; t < n; t++) {
      const srcIdx = t - shift; // shift < 0, so t + |shift|
      shifted[t] = srcIdx < n ? gains[srcIdx] : gains[n - 1];
    }
  }

  return shifted;
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTED: applyScenarioToCashflow
// Produces a perturbed PortfolioCashflow for a given scenario.
// Called by roiEngine when activeScenario ≠ 'expected'.
// ════════════════════════════════════════════════════════════════════════════════

export function applyScenarioToCashflow(
  baseCashflow: PortfolioCashflow,
  gainScale: number,
  rampShiftMonths: number,
): PortfolioCashflow {
  const base = baseCashflow.monthly_projection;
  const baseGains = base.map(m => m.gain);
  const baseInvs  = base.map(m => m.investment);

  // Scale then shift
  const scaledGains  = baseGains.map(g => g * gainScale);
  const shiftedGains = applyRampShift(scaledGains, rampShiftMonths);

  // Rebuild monthly projection
  const monthly_projection: MonthlyProjection[] = [];
  let cumulative = 0;
  let truePayback: number | null = null;

  for (let t = 0; t < shiftedGains.length; t++) {
    const gain       = shiftedGains[t];
    const investment = baseInvs[t]; // investment is scenario-independent (§5)
    const net        = gain - investment;
    cumulative      += net;
    if (truePayback === null && cumulative >= 0) {
      truePayback = t + 1;
    }
    monthly_projection.push({
      month: t + 1,
      investment,
      gain,
      net,
      cumulative,
    });
  }

  return {
    monthly_projection,
    true_payback_month: truePayback,
    cashflow_positive_after_month: truePayback,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: PER-SCENARIO OUTPUT CALCULATOR
// Uses existing roi_range tiers — no re-computation needed (§3 design).
// ════════════════════════════════════════════════════════════════════════════════

function computeScenarioOutput(
  eligibleROIs: RecommendationROI[],
  baseCashflow: PortfolioCashflow,
  totalInvestment: number,
  baseMidGain:     number,
  discountRate:    number,
  scenario:        ScenarioKey,
): ScenarioOutput {
  const preset = SCENARIO_PRESETS[scenario];
  const tier   = getScenarioGainTier(scenario);

  // Sum gain from the appropriate realization tier
  const scenarioGain = eligibleROIs.reduce(
    (s, r) => s + (r.roi_range[tier].gain ?? 0),
    0,
  );

  if (totalInvestment <= 0 || scenarioGain <= 0 || baseMidGain <= 0) {
    return { roi_percent: 0, npv: 0, payback_month: null };
  }

  const gainScale = scenarioGain / baseMidGain;

  // Build perturbed cashflow
  const perturbed = applyScenarioToCashflow(baseCashflow, gainScale, preset.ramp_shift_months);

  // NPV from perturbed cashflow
  const rMonthly = discountRate / 100 / 12;
  const npv = perturbed.monthly_projection.reduce(
    (sum, m, idx) => sum + m.net / Math.pow(1 + rMonthly, idx + 1),
    0,
  );

  const totalScenarioGain = perturbed.monthly_projection.reduce((s, m) => s + m.gain, 0);
  const roi_percent = totalInvestment > 0
    ? Math.min(Math.round((totalScenarioGain - totalInvestment) / totalInvestment * 100), 500)
    : 0;

  return {
    roi_percent:   Math.max(0, roi_percent),
    npv:           Math.round(npv),
    payback_month: perturbed.true_payback_month,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: buildScenarioModel
// Computes outputs for all 3 scenarios and returns §4 payload.
// Called at the end of buildPortfolioROI (after DCF/IRR, before Monte Carlo).
// ════════════════════════════════════════════════════════════════════════════════

export function buildScenarioModel(
  eligibleROIs:    RecommendationROI[],
  portfolioCashflow: PortfolioCashflow,
  totalInvestment: number,
  discountRate:    number,
  activeScenario:  ScenarioKey = 'expected',
): ScenarioModel {
  const baseMidGain = eligibleROIs.reduce(
    (s, r) => s + (r.roi_range.mid_case.gain ?? 0),
    0,
  );

  const SCENARIOS: ScenarioKey[] = ['conservative', 'expected', 'aggressive'];
  const scenario_outputs = {} as Record<ScenarioKey, ScenarioOutput>;

  for (const s of SCENARIOS) {
    scenario_outputs[s] = computeScenarioOutput(
      eligibleROIs,
      portfolioCashflow,
      totalInvestment,
      baseMidGain,
      discountRate,
      s,
    );
  }

  const active = scenario_outputs[activeScenario];
  const expected = scenario_outputs.expected;
  const conservative = scenario_outputs.conservative;
  const aggressive = scenario_outputs.aggressive;

  return {
    finance_model_version: 'finance_v4_scenarios',
    active_scenario: activeScenario,
    scenario_presets: SCENARIO_PRESETS,
    scenario_outputs,
    notes: [
      'Scenario modifies realization and ramp only — §5 governance',
      'Confidence score is not inflated by scenario — §5 governance',
      'Investment cost is scenario-independent — baselines unchanged',
      `Conservative: ROI=${conservative.roi_percent}%, NPV=${conservative.npv >= 0 ? '+' : ''}$${Math.round(conservative.npv / 1000)}K, Payback=Month ${conservative.payback_month ?? '>12'}`,
      `Expected:     ROI=${expected.roi_percent}%, NPV=${expected.npv >= 0 ? '+' : ''}$${Math.round(expected.npv / 1000)}K, Payback=Month ${expected.payback_month ?? '>12'}`,
      `Aggressive:   ROI=${aggressive.roi_percent}%, NPV=${aggressive.npv >= 0 ? '+' : ''}$${Math.round(aggressive.npv / 1000)}K, Payback=Month ${aggressive.payback_month ?? '>12'}`,
      `Active scenario: ${activeScenario} — ROI ${active.roi_percent}%, payback Month ${active.payback_month ?? '>12'}`,
      'Gain tiers: conservative→roi_range.low_case, expected→mid_case, aggressive→high_case',
      'Ramp shifts: conservative +1 month delay, expected 0, aggressive -1 month accelerate',
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY: TYPE GUARD
// ════════════════════════════════════════════════════════════════════════════════

export function isScenarioModel(m: unknown): m is ScenarioModel {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as ScenarioModel).finance_model_version === 'finance_v4_scenarios'
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY: getActiveScenarioCashflow
// Returns the perturbed cashflow for the active scenario.
// Used by roiEngine to feed scenario-adjusted cashflow to DCF/IRR/MonteCarlo.
// ════════════════════════════════════════════════════════════════════════════════

export function getActiveScenarioCashflow(
  eligibleROIs:      RecommendationROI[],
  baseCashflow:      PortfolioCashflow,
  activeScenario:    ScenarioKey,
): PortfolioCashflow {
  if (activeScenario === 'expected') return baseCashflow; // no perturbation needed

  const tier = getScenarioGainTier(activeScenario);
  const baseMidGain = eligibleROIs.reduce((s, r) => s + (r.roi_range.mid_case.gain ?? 0), 0);
  const scenarioGain = eligibleROIs.reduce((s, r) => s + (r.roi_range[tier].gain ?? 0), 0);

  if (baseMidGain <= 0) return baseCashflow;

  const gainScale = scenarioGain / baseMidGain;
  const rampShift = SCENARIO_PRESETS[activeScenario].ramp_shift_months;

  return applyScenarioToCashflow(baseCashflow, gainScale, rampShift);
}
