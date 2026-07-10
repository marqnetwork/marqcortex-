/**
 * CORTEX CORE — MONTE CARLO SIMULATION ENGINE (finance_v3_montecarlo)
 *
 * Monte Carlo Simulation Spec — monte-carlo-spec.md
 *
 * Pipeline position (§1):
 *   Dependencies validated → Cost model → Cash flow timeline →
 *   Confidence weighting → (optional DCF/IRR) → Monte Carlo
 *
 *   Monte Carlo NEVER touches the base payload.
 *   It produces an extra risk distribution payload.
 *
 * Simulation approach (§5 — "Scaled Perturbation"):
 *   Rather than re-running the full buildPortfolioROI pipeline 1,000 times
 *   (which would re-trigger dependency validation, cost model, etc.), we use
 *   the BASE monthly cash flow projection as the anchor and scale each month's
 *   gain and investment values by the sampled perturbation multipliers.
 *   This is mathematically equivalent for sensitivity analysis purposes and
 *   avoids re-running the full 11-module engine per simulation.
 *
 * Randomized variables (§2):
 *   1. support_tickets_per_week     ±15%   Triangular multiplier
 *   2. gross_margin_percent          ±5pp  Triangular delta
 *   3. labor_cost_per_hour          ±10%   Triangular multiplier
 *   4. efficiency realization factor ±10%   Triangular multiplier
 *   5. revenue  realization factor   ±15%   Triangular multiplier
 *   6. ramp_curve.shift_months      -1/0/+1 Discrete weighted
 *
 * Distributions (§3): Triangular for continuous, Discrete for categorical.
 *
 * Math decides the simulation. Not storytelling.
 */

import type {
  MonteCarloModel,
  MonteCarloFailure,
  MonteCarloRandomizedInput,
  MonteCarloROIStat,
  MonteCarloPaybackStat,
  MonteCarloNPVStat,
  PortfolioCashflow,
  RecommendationROI,
  RecommendationV2,
  PortfolioAssumptions,
} from './types';

// ════════════════════════════════════════════════════════════════════════════════
// §3 — DISTRIBUTION CONSTANTS
// ════════════════════════════════════════════════════════════════════════════════

// Spec-exact default bands (§2):
const BANDS = {
  tickets:              { min: 0.85, mode: 1.0, max: 1.15 },  // ±15%
  labor:                { min: 0.90, mode: 1.0, max: 1.10 },  // ±10%
  efficiency_real:      { min: 0.90, mode: 1.0, max: 1.10 },  // ±10%
  revenue_real:         { min: 0.85, mode: 1.0, max: 1.15 },  // ±15%
  margin_delta:         { min: -5,   mode: 0,   max: 5    },  // ±5pp absolute
};

const RAMP_DISCRETE = {
  values:  [-1, 0, 1],
  weights: [0.25, 0.50, 0.25],
};

// Fraction of investment that scales with labor cost (§2)
const LABOR_INVESTMENT_FRACTION = 0.60;

// Internal ROI cap for simulation runs (no display cap)
const SIM_ROI_CAP = 1000;

// ════════════════════════════════════════════════════════════════════════════════
// §3 — TRIANGULAR DISTRIBUTION SAMPLER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Samples from a triangular distribution using the inverse CDF method.
 *   min: left edge (a)
 *   mode: peak/mode (c)
 *   max: right edge (b)
 */
function sampleTriangular(min: number, mode: number, max: number): number {
  if (min === mode && mode === max) return min;
  const u = Math.random();
  const fc = (mode - min) / (max - min);

  if (u < fc) {
    return min + Math.sqrt(u * (max - min) * (mode - min));
  } else {
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }
}

/**
 * Samples from a discrete weighted distribution.
 * Weights must sum to 1 (not enforced here for perf — caller ensures this).
 */
function sampleDiscrete(values: number[], weights: number[]): number {
  const u = Math.random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (u <= cumulative) return values[i];
  }
  return values[values.length - 1]; // fallback
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: GAIN TYPE BREAKDOWN
// Identifies which portion of total gains is efficiency vs revenue vs other.
// Uses portfolio.recommendations for impact_type classification.
// ════════════════════════════════════════════════════════════════════════════════

interface GainBreakdown {
  efficiencyGain:  number;  // gains from efficiency-type recs
  revenueGain:     number;  // gains from revenue_growth-type recs
  otherGain:       number;  // cost_reduction + risk_reduction
  totalGain:       number;
}

function computeGainBreakdown(
  rois: RecommendationROI[],
  recs: RecommendationV2[],
): GainBreakdown {
  const recMap = new Map(recs.map(r => [r.recommendation_id, r]));
  let efficiencyGain = 0;
  let revenueGain = 0;
  let otherGain = 0;

  for (const roi of rois) {
    if (!roi.is_roi_eligible) continue;
    const gain = roi.roi_range.mid_case.gain ?? 0;
    const rec  = recMap.get(roi.recommendation_id);

    if (!rec) {
      otherGain += gain;
      continue;
    }

    const types = rec.impact_profile.impact_type ?? [];
    if (types.includes('efficiency')) {
      efficiencyGain += gain;
    } else if (types.includes('revenue_growth')) {
      revenueGain += gain;
    } else {
      otherGain += gain; // cost_reduction, risk_reduction
    }
  }

  return {
    efficiencyGain,
    revenueGain,
    otherGain,
    totalGain: efficiencyGain + revenueGain + otherGain,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: PERTURBED CASHFLOW BUILDER
// Applies gain scale, investment scale, and ramp shift to base monthly projection.
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Applies ramp shift to a gain schedule.
 *   shift = +1 → delay onset by 1 month (worse ramp)
 *   shift = -1 → accelerate onset by 1 month (better ramp)
 *   shift =  0 → no change
 */
function applyRampShift(gains: number[], shift: number): number[] {
  if (shift === 0) return gains;
  const n = gains.length;
  const shifted = new Array(n).fill(0);

  if (shift > 0) {
    // Delay: each month t gets gain from t-shift, defaulting to 0 at start
    for (let t = 0; t < n; t++) {
      const srcIdx = t - shift;
      shifted[t] = srcIdx >= 0 ? gains[srcIdx] : 0;
    }
  } else {
    // Accelerate: each month t gets gain from t-shift (earlier in the schedule)
    for (let t = 0; t < n; t++) {
      const srcIdx = t - shift; // shift < 0 so this is t + |shift|
      shifted[t] = srcIdx < n ? gains[srcIdx] : gains[n - 1]; // stable at final value
    }
  }

  return shifted;
}

/**
 * Builds a perturbed monthly net cash flow array for one simulation run.
 *
 * gainScale     = (simGain / baseGain) — scales all monthly gains proportionally
 * investScale   = (simInvestment / baseInvestment) — scales all monthly investments
 * rampShift     = months to shift the gain onset
 */
function buildPerturbedNetCashFlows(
  projection: PortfolioCashflow['monthly_projection'],
  gainScale: number,
  investScale: number,
  rampShift: number,
): { netCFs: number[]; payback: number | null; totalGain: number; totalInvestment: number } {
  const baseGains = projection.map(m => m.gain);
  const baseInvs  = projection.map(m => m.investment);

  const scaledGains = applyRampShift(
    baseGains.map(g => g * gainScale),
    rampShift,
  );
  const scaledInvs = baseInvs.map(inv => inv * investScale);

  const netCFs: number[] = [];
  let cumulative = 0;
  let payback: number | null = null;

  for (let t = 0; t < scaledGains.length; t++) {
    const net = scaledGains[t] - scaledInvs[t];
    netCFs.push(net);
    cumulative += net;
    if (payback === null && cumulative >= 0) {
      payback = t + 1; // 1-based month
    }
  }

  const totalGain       = scaledGains.reduce((a, b) => a + b, 0);
  const totalInvestment = scaledInvs.reduce((a, b)  => a + b, 0);

  return { netCFs, payback, totalGain, totalInvestment };
}

/**
 * Computes NPV of a net cash flow array at a given annual discount rate.
 * NPV = SUM( CF[n] / (1 + r_monthly)^(n+1) )  for n = 0..N-1
 */
function computeSimNPV(netCFs: number[], discountRatePercent: number): number {
  const rMonthly = discountRatePercent / 100 / 12;
  return netCFs.reduce((npv, cf, idx) => {
    return npv + cf / Math.pow(1 + rMonthly, idx + 1);
  }, 0);
}

// ════════════════════════════════════════════════════════════════════════════════
// INTERNAL: STATISTICS
// ════════════════════════════════════════════════════════════════════════════════

function computePercentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function computeMean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((v, x) => v + Math.pow(x - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// ════════════════════════════════════════════════════════════════════════════════
// §6 — AGGREGATE ROI / PAYBACK / NPV STATISTICS
// ════════════════════════════════════════════════════════════════════════════════

function buildROIStat(rois: number[]): MonteCarloROIStat {
  const sorted = [...rois].sort((a, b) => a - b);
  const mean   = computeMean(sorted);
  return {
    mean:                 parseFloat(mean.toFixed(2)),
    median:               parseFloat(computePercentile(sorted, 50).toFixed(2)),
    p10:                  parseFloat(computePercentile(sorted, 10).toFixed(2)),
    p90:                  parseFloat(computePercentile(sorted, 90).toFixed(2)),
    std_dev:              parseFloat(computeStdDev(sorted, mean).toFixed(2)),
    probability_positive: parseFloat((sorted.filter(r => r > 0).length / sorted.length).toFixed(4)),
  };
}

function buildPaybackStat(paybacks: (number | null)[], horizon: number): MonteCarloPaybackStat {
  const withPayback = paybacks.filter(p => p !== null) as number[];
  const sorted      = [...withPayback].sort((a, b) => a - b);
  const total       = paybacks.length;

  const mean: number | null = withPayback.length > 0
    ? parseFloat(computeMean(withPayback).toFixed(1))
    : null;

  return {
    mean,
    median:                 sorted.length ? parseFloat(computePercentile(sorted, 50).toFixed(1)) : null,
    p10:                    sorted.length ? parseFloat(computePercentile(sorted, 10).toFixed(1)) : null,
    p90:                    sorted.length ? parseFloat(computePercentile(sorted, 90).toFixed(1)) : null,
    probability_payback_le_6:  parseFloat((paybacks.filter(p => p !== null && p <= 6).length  / total).toFixed(4)),
    probability_payback_le_12: parseFloat((paybacks.filter(p => p !== null && p <= 12).length / total).toFixed(4)),
    fraction_never_paid_back:  parseFloat((paybacks.filter(p => p === null).length / total).toFixed(4)),
  };
}

function buildNPVStat(npvs: number[]): MonteCarloNPVStat {
  const sorted = [...npvs].sort((a, b) => a - b);
  const mean   = computeMean(sorted);
  return {
    enabled:              true,
    mean:                 Math.round(mean),
    median:               Math.round(computePercentile(sorted, 50)),
    p10:                  Math.round(computePercentile(sorted, 10)),
    p90:                  Math.round(computePercentile(sorted, 90)),
    std_dev:              Math.round(computeStdDev(sorted, mean)),
    probability_positive: parseFloat((sorted.filter(n => n > 0).length / sorted.length).toFixed(4)),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §7 — RANDOMIZED INPUT MANIFEST (spec §7 path schema)
// ════════════════════════════════════════════════════════════════════════════════

function buildRandomizedInputManifest(
  assumptions: PortfolioAssumptions,
): MonteCarloRandomizedInput[] {
  return [
    {
      path:           'inputs.assumptions.support_tickets_per_week',
      label:          'Support Tickets / Week',
      distribution:   'triangular',
      min_multiplier: BANDS.tickets.min,
      mode_multiplier: BANDS.tickets.mode,
      max_multiplier: BANDS.tickets.max,
      base_value:     assumptions.support_tickets_per_week ?? 100,
    },
    {
      path:          'inputs.assumptions.gross_margin_percent',
      label:         'Gross Margin %',
      distribution:  'triangular',
      min_delta:     BANDS.margin_delta.min,
      mode_delta:    BANDS.margin_delta.mode,
      max_delta:     BANDS.margin_delta.max,
      base_value:    assumptions.gross_margin_percent ?? 42,
    },
    {
      path:           'inputs.assumptions.labor_cost_per_hour',
      label:          'Labor Cost / Hour',
      distribution:   'triangular',
      min_multiplier: BANDS.labor.min,
      mode_multiplier: BANDS.labor.mode,
      max_multiplier: BANDS.labor.max,
      base_value:     assumptions.labor_cost_per_hour ?? 75,
    },
    {
      path:           'engine.realization_factors.efficiency',
      label:          'Efficiency Realization Factor',
      distribution:   'triangular',
      min_multiplier: BANDS.efficiency_real.min,
      mode_multiplier: BANDS.efficiency_real.mode,
      max_multiplier: BANDS.efficiency_real.max,
      base_value:     0.55, // mid-case default from roiEngine REALIZATION
    },
    {
      path:           'engine.realization_factors.revenue',
      label:          'Revenue Realization Factor',
      distribution:   'triangular',
      min_multiplier: BANDS.revenue_real.min,
      mode_multiplier: BANDS.revenue_real.mode,
      max_multiplier: BANDS.revenue_real.max,
      base_value:     0.35, // mid-case default from roiEngine REALIZATION
    },
    {
      path:         'engine.ramp_curve.shift_months',
      label:        'Gain Ramp Speed (months)',
      distribution: 'discrete',
      values:       RAMP_DISCRETE.values,
      weights:      RAMP_DISCRETE.weights,
      base_value:   0,
    },
  ];
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: runMonteCarloSimulation
// ════════════════════════════════════════════════════════════════════════════════

/**
 * §5 Simulation Loop: runs N simulations by perturbing the base cash flow model.
 *
 * Parameters:
 *   recommendations  — needed for gain-type breakdown (efficiency vs revenue split)
 *   rois             — base ROI models with roi_range.mid_case.gain per rec
 *   portfolioCashflow — base monthly projection (anchor for all runs)
 *   totalInvestment  — base total investment (anchor)
 *   totalGainMid     — base total 12-mo confidence-weighted gain (anchor)
 *   discountRate     — annual discount rate % (for NPV per run)
 *   assumptions      — base assumptions (for gain-type percentages + manifest)
 *   simCount         — default 1,000 per spec §4; optional 5,000 for higher accuracy
 */
export function runMonteCarloSimulation(
  recommendations: RecommendationV2[],
  rois:            RecommendationROI[],
  portfolioCashflow: PortfolioCashflow,
  totalInvestment:   number,
  totalGainMid:      number,
  discountRate:      number,
  assumptions:       PortfolioAssumptions,
  simCount = 1_000,
): MonteCarloModel | MonteCarloFailure {
  const t0 = Date.now();

  // ── Pre-flight checks ──────────────────────────────────────────────────────
  if (!portfolioCashflow?.monthly_projection?.length) {
    return {
      status: 'monte_carlo_not_calculable',
      reason: 'Missing portfolio cash flow projection — Monte Carlo requires validated monthly cash flows.',
    };
  }
  if (totalInvestment <= 0) {
    return {
      status: 'monte_carlo_not_calculable',
      reason: `Total investment is ${totalInvestment} — Monte Carlo requires positive investment.`,
    };
  }
  if (totalGainMid <= 0) {
    return {
      status: 'monte_carlo_not_calculable',
      reason: `Total gain is ${totalGainMid} — Monte Carlo requires positive base gains.`,
    };
  }

  const projection  = portfolioCashflow.monthly_projection;
  const horizon     = projection.length;

  // ── Gain type breakdown (§2: efficiency vs revenue realization factors) ──────
  const { efficiencyGain, revenueGain, otherGain } = computeGainBreakdown(rois, recommendations);
  const baseMargin = assumptions.gross_margin_percent ?? 42;

  // Fractions of total gain by type (for proportional scaling)
  const effFrac  = totalGainMid > 0 ? efficiencyGain / totalGainMid : 0.5;
  const revFrac  = totalGainMid > 0 ? revenueGain    / totalGainMid : 0.3;
  const othFrac  = totalGainMid > 0 ? otherGain      / totalGainMid : 0.2;

  // ── Simulation loop ────────────────────────────────────────────────────────
  const roiSamples:     number[]          = [];
  const npvSamples:     number[]          = [];
  const paybackSamples: (number | null)[] = [];
  let   successCount = 0;

  for (let i = 0; i < simCount; i++) {
    try {
      // §2 + §3: Sample all 6 randomized variables
      const laborMult      = sampleTriangular(BANDS.labor.min,          BANDS.labor.mode,          BANDS.labor.max);
      const effMult        = sampleTriangular(BANDS.efficiency_real.min, BANDS.efficiency_real.mode, BANDS.efficiency_real.max);
      const revMult        = sampleTriangular(BANDS.revenue_real.min,    BANDS.revenue_real.mode,    BANDS.revenue_real.max);
      const marginDelta    = sampleTriangular(BANDS.margin_delta.min,    BANDS.margin_delta.mode,    BANDS.margin_delta.max);
      const ticketsMult    = sampleTriangular(BANDS.tickets.min,         BANDS.tickets.mode,         BANDS.tickets.max);
      const rampShift      = sampleDiscrete(RAMP_DISCRETE.values, RAMP_DISCRETE.weights);

      // Margin multiplier: perturbed margin / base margin (clamped to [0.5, 2.0])
      const perturbedMargin  = Math.max(1, Math.min(100, baseMargin + marginDelta));
      const marginMult       = Math.max(0.5, Math.min(2.0, perturbedMargin / baseMargin));

      // Composite gain scale per type:
      //   efficiency gains: scale with effMult * laborMult (labor is the cost driver)
      //   revenue   gains:  scale with revMult * marginMult
      //   other     gains:  scale with mean of eff/rev multipliers (best approximation)
      //   tickets component: tickets directly affect efficiency gains (±15% of efficiency portion)
      const avgMult      = (effMult + revMult) / 2;
      const simEffGain   = efficiencyGain * effMult * laborMult * ticketsMult;
      const simRevGain   = revenueGain    * revMult * marginMult;
      const simOtherGain = otherGain      * avgMult;
      const simGain      = simEffGain + simRevGain + simOtherGain;

      // Investment scale: only the labor-sensitive fraction scales with laborMult
      const simInvestment = totalInvestment * (1 + LABOR_INVESTMENT_FRACTION * (laborMult - 1));

      // Protect against degenerate simulation run
      if (simInvestment <= 0 || !isFinite(simGain) || !isFinite(simInvestment)) continue;

      // Gain scale relative to base (for proportional monthly scaling)
      const gainScale   = simGain       / totalGainMid;
      const investScale = simInvestment / totalInvestment;

      // Build perturbed cashflows with ramp shift applied
      const { netCFs, payback, totalGain: runGain, totalInvestment: runInv } = buildPerturbedNetCashFlows(
        projection,
        gainScale,
        investScale,
        rampShift,
      );

      // §5: Compute portfolio ROI %
      const simROI = runInv > 0
        ? Math.min((runGain - runInv) / runInv * 100, SIM_ROI_CAP)
        : 0;

      // §5: Compute NPV
      const simNPV = computeSimNPV(netCFs, discountRate);

      if (!isFinite(simROI) || !isFinite(simNPV)) continue;

      roiSamples.push(parseFloat(simROI.toFixed(2)));
      npvSamples.push(Math.round(simNPV));
      paybackSamples.push(payback);
      successCount++;

    } catch (_) {
      // Defensive: any per-run error is silent — we just exclude that run
      continue;
    }
  }

  // ── Failure if too few successful runs ────────────────────────────────────
  const MIN_SUCCESSFUL = Math.floor(simCount * 0.5);
  if (successCount < MIN_SUCCESSFUL) {
    return {
      status: 'monte_carlo_not_calculable',
      reason: `Only ${successCount} of ${simCount} simulation runs produced valid results — expected at least ${MIN_SUCCESSFUL}. Review cash flow and investment inputs.`,
    };
  }

  // ── §6: Aggregate statistics ───────────────────────────────────────────────
  const results = {
    roi_percent:    buildROIStat(roiSamples),
    payback_months: buildPaybackStat(paybackSamples, horizon),
    npv:            buildNPVStat(npvSamples),
  };

  const runTimeMs = Date.now() - t0;

  // ── §7: Notes / audit trail ────────────────────────────────────────────────
  const notes: string[] = [
    `Monte Carlo runs on confidence-weighted cash flows (same base projection as DCF and IRR)`,
    `Dependency validation applied before simulation — Monte Carlo operates on post-dependency gains`,
    `Triangular distributions used for interpretability (§3)`,
    `Gain type breakdown: efficiency ${(effFrac * 100).toFixed(1)}% / revenue ${(revFrac * 100).toFixed(1)}% / other ${(othFrac * 100).toFixed(1)}%`,
    `Efficiency gains scaled by effMult × laborMult × ticketsMult; revenue gains by revMult × marginMult`,
    `Investment scaled by ${(LABOR_INVESTMENT_FRACTION * 100).toFixed(0)}% labor-sensitive fraction × laborMult`,
    `Ramp shift ±1 month applied: -1→accelerate, 0→unchanged, +1→delay (Discrete: 25/50/25)`,
    `${successCount} / ${simCount} simulation runs converged successfully`,
    `Engine completed in ${runTimeMs}ms`,
    `§8 Governance: recompute when tickets, margin, labor, realization, ramp, or investment change`,
  ];

  if (results.roi_percent.probability_positive >= 0.94) {
    notes.push(`Strong signal: ${(results.roi_percent.probability_positive * 100).toFixed(0)}% probability this portfolio stays ROI-positive — CFO-grade confidence.`);
  }

  return {
    finance_model_version: 'finance_v3_montecarlo',
    simulations:            simCount,
    simulations_successful: successCount,
    randomized_inputs:      buildRandomizedInputManifest(assumptions),
    results,
    roi_samples:     roiSamples,
    npv_samples:     npvSamples,
    payback_samples: paybackSamples,
    run_time_ms:     runTimeMs,
    notes,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

/** Type guard — distinguishes a successful MonteCarloModel from a MonteCarloFailure */
export function isMonteCarloModel(
  result: MonteCarloModel | MonteCarloFailure,
): result is MonteCarloModel {
  return 'finance_model_version' in result &&
    (result as MonteCarloModel).finance_model_version === 'finance_v3_montecarlo';
}
