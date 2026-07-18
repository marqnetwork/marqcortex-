/**
 * F-010 / RC-005 — IRR engine unit tests (finance_v2_dcf_irr).
 * Covers: normal operation, edge cases (§5), invalid inputs, boundary, regression.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeIRR, isIRRModel, getIRRStatusLabel } from '../../src/app/core/irrEngine.ts';
import { makePortfolioCashflow, STANDARD_CASHFLOW } from './_fixtures.ts';

/** Independent NPV recomputation to validate that IRR truly zeroes NPV. */
function npvAtAnnualRate(nets: number[], rAnnual: number): number {
  const rMonthly = rAnnual / 12;
  return nets.reduce((acc, cf, idx) => acc + cf / Math.pow(1 + rMonthly, idx + 1), 0);
}

describe('irrEngine.computeIRR — normal operation', () => {
  it('solves a converging IRR for a standard project', () => {
    const result = computeIRR(STANDARD_CASHFLOW);
    assert.ok(isIRRModel(result));
    if (!isIRRModel(result)) return;
    assert.equal(result.converged, true);
    assert.equal(result.irr_solver_method, 'binary_search');
    assert.ok(result.irr_percent_annual > 0 && result.irr_percent_annual <= 500);
    assert.ok(result.iterations_used > 0 && result.iterations_used <= 100);
  });

  it('the reported IRR actually zeroes NPV (mathematical invariant)', () => {
    const result = computeIRR(STANDARD_CASHFLOW);
    assert.ok(isIRRModel(result));
    if (!isIRRModel(result)) return;
    const nets = STANDARD_CASHFLOW.monthly_projection.map((m) => m.net);
    const residual = npvAtAnnualRate(nets, result.irr_percent_annual / 100);
    // Solver tolerance is on NPV; residual should be tiny relative to the $50k scale.
    assert.ok(Math.abs(residual) < 1, `residual NPV too large: ${residual}`);
  });

  it('is deterministic — identical output for identical input', () => {
    assert.deepEqual(computeIRR(STANDARD_CASHFLOW), computeIRR(STANDARD_CASHFLOW));
  });

  it('regression: monthly rate equals annual / 12', () => {
    const result = computeIRR(STANDARD_CASHFLOW);
    assert.ok(isIRRModel(result));
    if (!isIRRModel(result)) return;
    assert.ok(Math.abs(result.irr_percent_monthly - result.irr_percent_annual / 12) < 0.01);
  });
});

describe('irrEngine.computeIRR — edge cases (§5)', () => {
  it('A: all non-negative flows → invalid_no_negative_cashflow', () => {
    const allPositive = makePortfolioCashflow([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    assert.equal((computeIRR(allPositive) as any).status, 'invalid_no_negative_cashflow');
  });

  it('B: multiple sign changes → multiple_possible_irr', () => {
    const multi = makePortfolioCashflow([-100, 50, -50, 80, 80, 80, 80, 80, 80, 80, 80, 80]);
    assert.equal((computeIRR(multi) as any).status, 'multiple_possible_irr');
  });

  it('negative NPV even at 0% → irr_not_calculable', () => {
    const neverProfitable = makePortfolioCashflow([-100000, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    assert.equal((computeIRR(neverProfitable) as any).status, 'irr_not_calculable');
  });

  it('IRR above the 500% solver cap → irr_not_converged', () => {
    const explosive = makePortfolioCashflow([-100, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000, 100000]);
    assert.equal((computeIRR(explosive) as any).status, 'irr_not_converged');
  });
});

describe('irrEngine.computeIRR — invalid inputs', () => {
  it('missing cash flow → irr_not_calculable', () => {
    assert.equal((computeIRR(null) as any).status, 'irr_not_calculable');
  });
  it('empty projection → irr_not_calculable', () => {
    assert.equal(
      (computeIRR({ monthly_projection: [], true_payback_month: null, cashflow_positive_after_month: null }) as any).status,
      'irr_not_calculable',
    );
  });
});

describe('irrEngine — type guard & status label', () => {
  it('isIRRModel distinguishes success from failure', () => {
    assert.equal(isIRRModel(computeIRR(STANDARD_CASHFLOW)), true);
    assert.equal(isIRRModel(computeIRR(null)), false);
  });
  it('getIRRStatusLabel renders each state', () => {
    assert.equal(getIRRStatusLabel(null), 'Not computed');
    assert.match(getIRRStatusLabel(computeIRR(STANDARD_CASHFLOW)), /% annual$/);
    const allPositive = makePortfolioCashflow([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    assert.equal(getIRRStatusLabel(computeIRR(allPositive)), 'Undefined (all positive flows)');
  });
});
