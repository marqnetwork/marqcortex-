/**
 * F-010 / RC-005 — Monte Carlo engine unit tests (finance_v3_montecarlo).
 *
 * The simulation is stochastic (Math.random), so the tests assert:
 *  - deterministic pre-flight failure paths (exact),
 *  - distribution-independent statistical invariants on a successful run
 *    (percentile ordering, bounds, sample counts, finiteness).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMonteCarloSimulation, isMonteCarloModel } from '../../src/app/core/monteCarloEngine.ts';
import { makePortfolioCashflow, STANDARD_CASHFLOW } from './_fixtures.ts';

const ASSUMPTIONS = { gross_margin_percent: 42 } as any;
// One eligible ROI whose mid-case gain anchors the (otherGain) breakdown; no
// matching recommendation, so the whole gain routes to the "other" bucket.
const ROIS = [{ recommendation_id: 'r1', is_roi_eligible: true, roi_range: { mid_case: { gain: 120000 } } }] as any;
const RECS: any[] = [];

function run(simCount = 400) {
  return runMonteCarloSimulation(RECS, ROIS, STANDARD_CASHFLOW, 50000, 120000, 12, ASSUMPTIONS, simCount);
}

describe('monteCarloEngine — pre-flight failures (deterministic)', () => {
  it('missing cash flow → monte_carlo_not_calculable', () => {
    const r = runMonteCarloSimulation(RECS, ROIS, { monthly_projection: [] } as any, 50000, 120000, 12, ASSUMPTIONS, 100);
    assert.equal((r as any).status, 'monte_carlo_not_calculable');
  });
  it('non-positive investment → monte_carlo_not_calculable', () => {
    const r = runMonteCarloSimulation(RECS, ROIS, STANDARD_CASHFLOW, 0, 120000, 12, ASSUMPTIONS, 100);
    assert.equal((r as any).status, 'monte_carlo_not_calculable');
  });
  it('non-positive base gain → monte_carlo_not_calculable', () => {
    const r = runMonteCarloSimulation(RECS, ROIS, STANDARD_CASHFLOW, 50000, 0, 12, ASSUMPTIONS, 100);
    assert.equal((r as any).status, 'monte_carlo_not_calculable');
  });
});

describe('monteCarloEngine — successful run invariants', () => {
  it('returns a well-formed model with the requested simulation count', () => {
    const r = run(400);
    assert.ok(isMonteCarloModel(r));
    if (!isMonteCarloModel(r)) return;
    assert.equal(r.finance_model_version, 'finance_v3_montecarlo');
    assert.equal(r.simulations, 400);
    assert.ok(r.simulations_successful >= Math.floor(400 * 0.5));
    assert.ok(r.simulations_successful <= 400);
    assert.equal(r.roi_samples.length, r.simulations_successful);
    assert.equal(r.npv_samples.length, r.simulations_successful);
  });

  it('percentiles are ordered p10 <= median <= p90 for ROI and NPV', () => {
    const r = run(400);
    assert.ok(isMonteCarloModel(r));
    if (!isMonteCarloModel(r)) return;
    assert.ok(r.results.roi_percent.p10 <= r.results.roi_percent.median);
    assert.ok(r.results.roi_percent.median <= r.results.roi_percent.p90);
    assert.ok(r.results.npv.p10 <= r.results.npv.median);
    assert.ok(r.results.npv.median <= r.results.npv.p90);
  });

  it('probabilities are within [0, 1] and samples are finite', () => {
    const r = run(400);
    assert.ok(isMonteCarloModel(r));
    if (!isMonteCarloModel(r)) return;
    const p = r.results.roi_percent.probability_positive;
    assert.ok(p >= 0 && p <= 1);
    const npp = r.results.npv.probability_positive;
    assert.ok(npp >= 0 && npp <= 1);
    assert.ok(r.roi_samples.every((x) => Number.isFinite(x)));
    assert.ok(r.npv_samples.every((x) => Number.isFinite(x)));
  });

  it('payback probabilities are ordered (≤6 months implies ≤12 months)', () => {
    const r = run(400);
    assert.ok(isMonteCarloModel(r));
    if (!isMonteCarloModel(r)) return;
    const pb = r.results.payback_months;
    assert.ok(pb.probability_payback_le_6 <= pb.probability_payback_le_12);
    assert.ok(pb.fraction_never_paid_back >= 0 && pb.fraction_never_paid_back <= 1);
  });
});

describe('monteCarloEngine — type guard', () => {
  it('isMonteCarloModel distinguishes success from failure', () => {
    assert.equal(isMonteCarloModel(run(300)), true);
    const fail = runMonteCarloSimulation(RECS, ROIS, STANDARD_CASHFLOW, -1, 120000, 12, ASSUMPTIONS, 100);
    assert.equal(isMonteCarloModel(fail), false);
  });
});
