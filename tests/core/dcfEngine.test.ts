/**
 * F-010 / RC-005 — DCF engine unit tests (finance_v1_dcf).
 * Covers: normal operation, edge cases, invalid inputs, boundary conditions, regression.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDCF,
  isDCFModel,
  getEffectiveDiscountRate,
  extendNetCashFlows,
} from '../../src/app/core/dcfEngine.ts';
import { makePortfolioCashflow, STANDARD_CASHFLOW } from './_fixtures.ts';

describe('dcfEngine.computeDCF — normal operation', () => {
  it('computes NPV, monthly rate and discounted payback for a standard project', () => {
    const result = computeDCF(STANDARD_CASHFLOW, 12);
    assert.ok(isDCFModel(result));
    if (!isDCFModel(result)) return;
    // 12% annual → 1%/month
    assert.equal(result.r_monthly, 0.01);
    assert.equal(result.discount_rate_percent, 12);
    // Regression anchor: locked formula on the standard fixture.
    assert.equal(result.npv, 32615);
    assert.equal(result.discounted_payback_month, 8);
    assert.equal(result.finance_model_version, 'finance_v1_dcf');
    assert.equal(result.discounted_cashflow_projection.length, 12);
  });

  it('cumulative discounted equals the running sum of discounted flows', () => {
    const result = computeDCF(STANDARD_CASHFLOW, 12);
    assert.ok(isDCFModel(result));
    if (!isDCFModel(result)) return;
    let running = 0;
    for (const entry of result.discounted_cashflow_projection) {
      running += entry.discounted_cashflow;
      // rounding is per-entry so allow a small drift
      assert.ok(Math.abs(entry.cumulative_discounted - running) <= 2);
    }
  });

  it('is deterministic — same input yields identical output', () => {
    const a = computeDCF(STANDARD_CASHFLOW, 15);
    const b = computeDCF(STANDARD_CASHFLOW, 15);
    assert.deepEqual(a, b);
  });
});

describe('dcfEngine.computeDCF — boundary conditions', () => {
  it('accepts the minimum rate (0%) — no discounting, NPV equals plain sum', () => {
    const result = computeDCF(STANDARD_CASHFLOW, 0);
    assert.ok(isDCFModel(result));
    if (!isDCFModel(result)) return;
    assert.equal(result.r_monthly, 0);
    assert.equal(result.npv, -50000 + 8000 * 11); // 38000
  });

  it('accepts the maximum rate (40%)', () => {
    const result = computeDCF(STANDARD_CASHFLOW, 40);
    assert.ok(isDCFModel(result));
  });

  it('defaults to 12% when the rate is undefined', () => {
    const result = computeDCF(STANDARD_CASHFLOW, undefined);
    assert.ok(isDCFModel(result));
    if (!isDCFModel(result)) return;
    assert.equal(result.discount_rate_percent, 12);
  });

  it('extends a sub-12-month timeline to the 12-month minimum', () => {
    const short = makePortfolioCashflow([-10000, 3000, 3000, 3000]); // 4 months
    const result = computeDCF(short, 12);
    assert.ok(isDCFModel(result));
    if (!isDCFModel(result)) return;
    assert.equal(result.discounted_cashflow_projection.length, 12);
  });

  it('produces a negative NPV when the project destroys value', () => {
    const badProject = makePortfolioCashflow([-50000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
    const result = computeDCF(badProject, 40);
    assert.ok(isDCFModel(result));
    if (!isDCFModel(result)) return;
    assert.ok(result.npv < 0);
    assert.equal(result.discounted_payback_month, null); // never recovers
  });
});

describe('dcfEngine.computeDCF — invalid inputs (fail closed)', () => {
  it('returns finance_not_calculable for a missing cash flow', () => {
    const result = computeDCF(null, 12);
    assert.ok(!isDCFModel(result));
    assert.equal((result as any).status, 'finance_not_calculable');
  });

  it('returns finance_not_calculable for an empty projection', () => {
    const result = computeDCF({ monthly_projection: [], true_payback_month: null, cashflow_positive_after_month: null }, 12);
    assert.equal((result as any).status, 'finance_not_calculable');
  });

  it('rejects an out-of-range discount rate (> 40)', () => {
    assert.equal((computeDCF(STANDARD_CASHFLOW, 41) as any).status, 'finance_not_calculable');
  });

  it('rejects a negative discount rate', () => {
    assert.equal((computeDCF(STANDARD_CASHFLOW, -1) as any).status, 'finance_not_calculable');
  });
});

describe('dcfEngine.getEffectiveDiscountRate — clamping', () => {
  it('returns the default (12) for undefined/null', () => {
    assert.equal(getEffectiveDiscountRate(undefined), 12);
    assert.equal(getEffectiveDiscountRate(null as any), 12);
  });
  it('falls back to default for negative values', () => {
    assert.equal(getEffectiveDiscountRate(-5), 12);
  });
  it('clamps values above the ceiling to 40', () => {
    assert.equal(getEffectiveDiscountRate(99), 40);
  });
  it('passes through in-range values unchanged', () => {
    assert.equal(getEffectiveDiscountRate(20), 20);
    assert.equal(getEffectiveDiscountRate(0), 0);
    assert.equal(getEffectiveDiscountRate(40), 40);
  });
});

describe('dcfEngine.extendNetCashFlows', () => {
  it('does not extend when the timeline already meets the target', () => {
    const { netCashFlows, extended } = extendNetCashFlows(STANDARD_CASHFLOW, 12);
    assert.equal(extended, false);
    assert.equal(netCashFlows.length, 12);
  });
  it('pads with the last month gain when shorter than target', () => {
    const short = makePortfolioCashflow([-1000, 500, 700], [0, 500, 700]);
    const { netCashFlows, extended, stableGainUsed } = extendNetCashFlows(short, 12);
    assert.equal(extended, true);
    assert.equal(netCashFlows.length, 12);
    assert.equal(stableGainUsed, 700);
    assert.equal(netCashFlows[11], 700);
  });
});
