/**
 * F-010 / RC-005 — Scoring engine unit tests (Module 2).
 * Core rule under test: "Same input → same scores. No randomness."
 * Covers: normal operation, edge cases, boundary/clamping, invalid/empty input, regression.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDomains, applyIndustryAdjustment } from '../../src/app/core/scoringEngine.ts';
import type { DomainKey, DomainScores } from '../../src/app/core/types.ts';
import { makeAnswer, makeDiagnostics, EMPTY_DIAGNOSTICS } from './_fixtures.ts';

const ALL_DOMAINS: DomainKey[] = ['operations', 'revenue', 'systems', 'governance', 'customer_experience', 'data'];

function expectedSeverity(score: number): string {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

function assertWellFormed(scores: DomainScores) {
  for (const d of ALL_DOMAINS) {
    const s = scores[d];
    assert.ok(s, `missing domain ${d}`);
    assert.equal(s.key, d);
    assert.ok(s.label.length > 0);
    assert.ok(s.rawScore >= 0 && s.rawScore <= 100, `${d} rawScore out of range: ${s.rawScore}`);
    assert.equal(s.severity, expectedSeverity(s.rawScore), `${d} severity mismatch at ${s.rawScore}`);
  }
}

describe('scoringEngine.scoreDomains — normal operation', () => {
  const heavyRevenue = makeDiagnostics(
    [
      makeAnswer(1, 'sales', [{ category: 'revenue_leakage', weight: 5 }], 1),
      makeAnswer(2, 'marketing', [{ category: 'revenue_leakage', weight: 5 }], 1),
      makeAnswer(3, 'ops', [{ category: 'revenue_leakage', weight: 5 }], 1),
    ],
    { revenue: 20 },
  );

  it('produces all six domains, well-formed', () => {
    assertWellFormed(scoreDomains(heavyRevenue));
  });

  it('escalates a maxed-out domain to Critical and reflects pain count', () => {
    const scores = scoreDomains(heavyRevenue);
    assert.equal(scores.revenue.rawScore, 100);
    assert.equal(scores.revenue.severity, 'Critical');
    assert.equal(scores.revenue.painSignalCount, 20);
    assert.ok(scores.revenue.topCausalCategories.includes('revenue_leakage'));
  });

  it('is deterministic — identical output for identical input', () => {
    assert.deepEqual(scoreDomains(heavyRevenue), scoreDomains(heavyRevenue));
  });
});

describe('scoringEngine.scoreDomains — edge/boundary', () => {
  it('handles empty diagnostics: all domains Low but structurally complete', () => {
    const scores = scoreDomains(EMPTY_DIAGNOSTICS);
    assertWellFormed(scores);
    for (const d of ALL_DOMAINS) {
      assert.equal(scores[d].severity, 'Low');
      assert.equal(scores[d].painSignalCount, 0);
    }
    // Regression anchor for the neutral-maturity default path.
    assert.equal(scores.operations.rawScore, 10);
    assert.equal(scores.revenue.rawScore, 11);
    assert.equal(scores.data.rawScore, 9);
  });

  it('never exceeds the 0–100 clamp even with saturating signals', () => {
    const saturated = makeDiagnostics(
      [
        makeAnswer(1, 'a', [{ category: 'revenue_leakage', weight: 50 }], 1),
        makeAnswer(2, 'b', [{ category: 'revenue_leakage', weight: 50 }], 1),
        makeAnswer(3, 'c', [{ category: 'revenue_leakage', weight: 50 }], 1),
      ],
      { revenue: 999 },
    );
    assert.equal(scoreDomains(saturated).revenue.rawScore, 100);
  });
});

describe('scoringEngine.applyIndustryAdjustment', () => {
  const base = scoreDomains(
    makeDiagnostics(
      [
        makeAnswer(1, 'a', [{ category: 'tool_fragmentation', weight: 3 }], 2),
        makeAnswer(2, 'b', [{ category: 'data_integrity', weight: 3 }], 2),
      ],
      { systems: 10, data: 10 },
    ),
  );

  it('SaaS amplifies systems and data', () => {
    const adj = applyIndustryAdjustment(base, 'SaaS Software');
    assert.ok(adj.systems.rawScore >= base.systems.rawScore);
    assert.ok(adj.data.rawScore >= base.data.rawScore);
  });

  it('does not mutate the input scores object', () => {
    const before = base.systems.rawScore;
    applyIndustryAdjustment(base, 'SaaS');
    assert.equal(base.systems.rawScore, before);
  });

  it('is case-insensitive', () => {
    assert.deepEqual(applyIndustryAdjustment(base, 'saas'), applyIndustryAdjustment(base, 'SAAS'));
  });

  it('leaves scores unchanged for an unknown industry', () => {
    assert.deepEqual(applyIndustryAdjustment(base, 'Nonprofit Widgets'), base);
  });

  it('clamps a bumped score at 100 and keeps severity consistent', () => {
    const high = scoreDomains(
      makeDiagnostics(
        [
          makeAnswer(1, 'a', [{ category: 'tool_fragmentation', weight: 50 }], 1),
          makeAnswer(2, 'b', [{ category: 'tool_fragmentation', weight: 50 }], 1),
          makeAnswer(3, 'c', [{ category: 'tool_fragmentation', weight: 50 }], 1),
        ],
        { systems: 999 },
      ),
    );
    const adj = applyIndustryAdjustment(high, 'saas');
    assert.ok(adj.systems.rawScore <= 100);
    assert.equal(adj.systems.severity, expectedSeverity(adj.systems.rawScore));
  });

  it('applies manufacturing, agency, and healthcare rules', () => {
    assert.ok(applyIndustryAdjustment(base, 'Manufacturing').operations.rawScore >= base.operations.rawScore);
    assert.ok(applyIndustryAdjustment(base, 'Creative Agency').governance.rawScore >= base.governance.rawScore);
    assert.ok(applyIndustryAdjustment(base, 'Healthcare').data.rawScore >= base.data.rawScore);
  });
});
