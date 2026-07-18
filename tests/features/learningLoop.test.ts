/**
 * BATCH 6 — Learning Loop deterministic aggregation tests
 *
 * The learning loop is a READ-ONLY insight view over persisted outcomes. It must
 * be fully deterministic (no LLM), never fabricate data (empty → isEmpty), and
 * never self-modify rules. These tests lock the aggregation math and edge cases
 * that GET /cortex/learning-loop and LearningLoopPanel depend on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateLearningLoop,
  type LearningOutcome,
} from '../../supabase/functions/server/learningLoop.ts';

describe('learningLoop — empty / fabrication safety', () => {
  it('returns isEmpty for an empty set and never fabricates data', () => {
    assert.deepEqual(aggregateLearningLoop([]), { isEmpty: true, data: null });
    // @ts-expect-error — defensive: non-array input
    assert.deepEqual(aggregateLearningLoop(null), { isEmpty: true, data: null });
  });
});

describe('learningLoop — deterministic aggregation', () => {
  const outcomes: LearningOutcome[] = [
    { submissionId: 's1', company: 'A', industry: 'Finance', didConvert: true,  conversionValue: 100_000, recommendationWorked: true,  aiScore: 85, submittedAt: '2026-01-01T00:00:00Z', loggedAt: '2026-01-11T00:00:00Z' },
    { submissionId: 's2', company: 'B', industry: 'Finance', didConvert: false, conversionValue: null,    recommendationWorked: false, aiScore: 55, lostReason: 'Budget was too tight', submittedAt: '2026-01-01T00:00:00Z', loggedAt: '2026-01-05T00:00:00Z', improvementAreas: ['pricing'] },
    { submissionId: 's3', company: 'C', industry: 'Retail',  didConvert: true,  conversionValue: 50_000,  recommendationWorked: null,  aiScore: 72, submittedAt: '2026-01-01T00:00:00Z', loggedAt: '2026-01-21T00:00:00Z', improvementAreas: ['pricing', 'speed'] },
  ];

  const { isEmpty, data } = aggregateLearningLoop(outcomes);

  it('computes headline conversion metrics deterministically', () => {
    assert.equal(isEmpty, false);
    assert.equal(data!.totalOutcomes, 3);
    assert.equal(data!.totalConverted, 2);
    assert.equal(data!.totalLost, 1);
    assert.equal(data!.conversionRate, 67);              // 2/3 rounded
    assert.equal(data!.totalRevenue, 150_000);
    assert.equal(data!.avgDealSize, 75_000);
  });

  it('computes recommendation accuracy only over rated outcomes (null excluded)', () => {
    // s1 true, s2 false, s3 null → 1/2 = 50%
    assert.equal(data!.recommendationAccuracy, 50);
  });

  it('bins score↔conversion correlation into 80+/60-79/<60', () => {
    assert.equal(data!.scoreCorrelation.highScore.total, 1); // s1 (85)
    assert.equal(data!.scoreCorrelation.highScore.rate, 100);
    assert.equal(data!.scoreCorrelation.midScore.total, 1);  // s3 (72)
    assert.equal(data!.scoreCorrelation.lowScore.total, 1);  // s2 (55)
    assert.equal(data!.scoreCorrelation.lowScore.rate, 0);   // s2 lost
  });

  it('tallies lost-reason keywords and improvement areas', () => {
    assert.deepEqual(data!.topLostReasons, [{ reason: 'budget', count: 1 }]);
    const areas = Object.fromEntries(data!.improvementAreas.map(a => [a.area, a.count]));
    assert.equal(areas.pricing, 2);
    assert.equal(areas.speed, 1);
  });

  it('breaks down by industry sorted by conversion rate', () => {
    assert.equal(data!.byIndustry[0].industry, 'Retail');   // 100%
    assert.equal(data!.byIndustry[0].conversionRate, 100);
    const finance = data!.byIndustry.find(b => b.industry === 'Finance')!;
    assert.equal(finance.total, 2);
    assert.equal(finance.conversionRate, 50);
  });

  it('computes average days-to-close from submitted→logged', () => {
    // s1=10, s2=4, s3=20 → 34/3 = 11.33 → 11
    assert.equal(data!.avgDaysToClose, 11);
  });

  it('returns at most 10 recent outcomes, newest first', () => {
    assert.equal(data!.recentOutcomes.length, 3);
    assert.equal(data!.recentOutcomes[0].submissionId, 's3'); // latest loggedAt
  });
});

describe('learningLoop — edge cases', () => {
  it('handles all-lost outcomes without divide-by-zero', () => {
    const { data } = aggregateLearningLoop([
      { didConvert: false, aiScore: 40, lostReason: 'competitor won' },
      { didConvert: false, aiScore: 30, lostReason: 'no decision made' },
    ]);
    assert.equal(data!.conversionRate, 0);
    assert.equal(data!.avgDealSize, 0);
    assert.equal(data!.recommendationAccuracy, null); // none rated
    assert.equal(data!.avgDaysToClose, null);         // no timestamps
    assert.equal(data!.scoreCorrelation.lowScore.rate, 0);
  });

  it('classifies an unmatched lost reason as "other"', () => {
    const { data } = aggregateLearningLoop([
      { didConvert: false, lostReason: 'something entirely unmapped' },
    ]);
    assert.deepEqual(data!.topLostReasons, [{ reason: 'other', count: 1 }]);
  });
});
