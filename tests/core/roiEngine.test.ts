/**
 * F-010 / RC-005 — ROI engine unit tests.
 * Exercised against the ExampleCo gold-standard portfolio.
 * Covers: normal operation, aggregation correctness, boundary (cap / size),
 * determinism, sensitivity analysis, and the empty-portfolio edge case.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolioROI, computeSensitivityAnalysis } from '../../src/app/core/roiEngine.ts';
import { loadGoldPortfolio } from './_fixtures.ts';

const { portfolio, assumptions, employeeEstimate } = loadGoldPortfolio();

describe('roiEngine.buildPortfolioROI — normal operation', () => {
  it('produces a per-recommendation ROI for every recommendation', () => {
    const model = buildPortfolioROI(portfolio, employeeEstimate, assumptions);
    assert.equal(model.recommendation_rois.length, 3);
    assert.ok(model.recommendation_rois.every((r) => r.is_roi_eligible));
  });

  it('portfolio total investment equals the sum of eligible recommendation costs', () => {
    const model = buildPortfolioROI(portfolio, employeeEstimate, assumptions);
    const sum = model.recommendation_rois
      .filter((r) => r.is_roi_eligible)
      .reduce((acc, r) => acc + r.inputs.investment_cost, 0);
    assert.ok(model.portfolio_totals.total_investment > 0);
    assert.equal(model.portfolio_totals.total_investment, sum);
  });

  it('the adjusted ROI percentage is a finite number', () => {
    const model = buildPortfolioROI(portfolio, employeeEstimate, assumptions);
    assert.ok(Number.isFinite(model.portfolio_totals.total_adjusted_roi_percent));
  });

  it('is deterministic — identical totals for identical input', () => {
    const a = buildPortfolioROI(portfolio, employeeEstimate, assumptions);
    const b = buildPortfolioROI(portfolio, employeeEstimate, assumptions);
    assert.deepEqual(a.portfolio_totals, b.portfolio_totals);
  });
});

describe('roiEngine.buildPortfolioROI — boundary conditions', () => {
  it('caps every per-recommendation ROI at the supplied maxROICap', () => {
    const capped = buildPortfolioROI(portfolio, employeeEstimate, assumptions, 50);
    assert.ok(capped.recommendation_rois.every((r) => r.roi_range.mid_case.roi_percent <= 50));
  });

  it('applies the employee-size multiplier (larger org shifts the result)', () => {
    const small = buildPortfolioROI(portfolio, 24, assumptions);
    const large = buildPortfolioROI(portfolio, 300, assumptions);
    assert.notEqual(
      small.portfolio_totals.total_adjusted_roi_percent,
      large.portfolio_totals.total_adjusted_roi_percent,
    );
  });

  it('handles an empty portfolio without throwing (zero totals)', () => {
    const empty = buildPortfolioROI(
      { recommendations: [], cross_dependencies: [], execution_sequence_model: { recommended_execution_order: [] } } as any,
      employeeEstimate,
      assumptions,
    );
    assert.equal(empty.recommendation_rois.length, 0);
    assert.equal(empty.portfolio_totals.total_investment, 0);
  });
});

describe('roiEngine.computeSensitivityAnalysis', () => {
  it('returns one row per non-zero assumption, ranked by absolute impact', () => {
    const rows = computeSensitivityAnalysis(portfolio, employeeEstimate, assumptions);
    assert.ok(rows.length > 0);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(Math.abs(rows[i - 1].delta_percent) >= Math.abs(rows[i].delta_percent));
    }
  });

  it('every row shares the same baseline ROI, equal to the standalone baseline', () => {
    const baseline = buildPortfolioROI(portfolio, employeeEstimate, assumptions).portfolio_totals.total_adjusted_roi_percent;
    const rows = computeSensitivityAnalysis(portfolio, employeeEstimate, assumptions);
    for (const row of rows) {
      assert.equal(row.baseline_roi, baseline);
      assert.ok(Number.isFinite(row.adjusted_roi));
      assert.ok(typeof row.variable === 'string' && row.variable.length > 0);
    }
  });

  it('is deterministic', () => {
    assert.deepEqual(
      computeSensitivityAnalysis(portfolio, employeeEstimate, assumptions),
      computeSensitivityAnalysis(portfolio, employeeEstimate, assumptions),
    );
  });
});
