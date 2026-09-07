/**
 * KV ↔ SQL reconciliation for the cortex analysis domain.
 *
 * This domain has its own reconciler because one analysis becomes up to four
 * rows addressed through a submission, so "is it migrated?" is a question about
 * a SET. The cases below are mostly about the ways a set can be wrong that a
 * row-presence check would miss.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKvReader } from '../../supabase/functions/server/migration/kvReader.ts';
import { reconcileCortexDomain } from '../../supabase/functions/server/migration/cortexReconciliation.ts';
import { createFakeSupabase } from './fakeSupabase.ts';

const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: 'sub-1',
    readinessScore: 'High',
    pillarHeatmap: {
      operationsExecution: 4,
      revenueGrowth: 3,
      systemsAutomation: 5,
      aiReadinessGovernance: 2,
    },
    ...overrides,
  };
}

/** The four pillars, scaled onto the column's 0–100 range. */
const SCALED = {
  operations_execution: 80,
  revenue_growth: 60,
  systems_automation: 100,
  ai_readiness_governance: 40,
};

function scoreRows(submissionId: string, scores: Record<string, number> = SCALED) {
  return Object.entries(scores).map(([domain_key, score]) => ({
    submission_id: submissionId,
    domain_key,
    score,
  }));
}

async function reconcile(
  store: Record<string, unknown>,
  submissions: Array<{ id: string; legacy_kv_key: string }>,
  scores: Array<{ submission_id: string; domain_key: string; score: number }>,
) {
  const client = createFakeSupabase();
  client.queue('submissions', 'select', { data: submissions, error: null });
  client.queue('domain_scores', 'select', { data: scores, error: null });
  return reconcileCortexDomain(client as never, createInMemoryKvReader(store), ORG, 50);
}

const MIGRATED_SUBMISSION = [{ id: 'submission-1', legacy_kv_key: 'sub:sub-1' }];

describe('cortex reconciliation — a set, not a row', () => {
  it('agrees when every pillar arrived at its scaled value', async () => {
    const result = await reconcile(
      { 'cortex:sub-1': analysis() },
      MIGRATED_SUBMISSION,
      scoreRows('submission-1'),
    );
    assert.equal(result.domain, 'cortex_analysis');
    assert.equal(result.sourceCount, 1);
    assert.equal(result.targetCount, 1);
    assert.equal(result.missingCount, 0);
    assert.equal(result.sampleMismatchCount, 0);
    assert.equal(result.thresholdPassed, true);
  });

  it('catches an analysis whose pillars arrived UNSCALED', async () => {
    // The failure the whole scaling decision exists to prevent, and the one a
    // row-presence check reports as healthy: four rows are there, and every one
    // of them says four percent.
    const result = await reconcile({ 'cortex:sub-1': analysis() }, MIGRATED_SUBMISSION, [
      { submission_id: 'submission-1', domain_key: 'operations_execution', score: 4 },
      { submission_id: 'submission-1', domain_key: 'revenue_growth', score: 3 },
      { submission_id: 'submission-1', domain_key: 'systems_automation', score: 5 },
      { submission_id: 'submission-1', domain_key: 'ai_readiness_governance', score: 2 },
    ]);
    assert.equal(result.missingCount, 0, 'the rows are all there');
    assert.equal(result.sampleMismatchCount, 1, 'and every value is wrong');
    assert.equal(result.thresholdPassed, false);
    assert.equal(Object.keys(result.details.mismatchedFields as object).length, 4);
  });

  it('catches a PARTIALLY written analysis', async () => {
    // Three rows of four. A per-row reconciliation would call this three
    // successes; it is one incomplete analysis.
    const { ai_readiness_governance: _dropped, ...partial } = SCALED;
    const result = await reconcile(
      { 'cortex:sub-1': analysis() },
      MIGRATED_SUBMISSION,
      scoreRows('submission-1', partial),
    );
    assert.equal(result.sampleMismatchCount, 1);
    assert.equal(
      (result.details.mismatchedFields as Record<string, number>).ai_readiness_governance,
      1,
    );
  });

  it('separates "waiting for a submission" from "the backfill lost it"', async () => {
    // Both are missing rows. Only one of them is a defect, and an operator
    // reading `missing` needs to know which.
    const result = await reconcile({ 'cortex:sub-1': analysis() }, [], []);
    assert.equal(result.missingCount, 1);
    assert.equal(result.details.awaitingSubmission, 1);

    const lost = await reconcile({ 'cortex:sub-1': analysis() }, MIGRATED_SUBMISSION, []);
    assert.equal(lost.missingCount, 1);
    assert.equal(lost.details.awaitingSubmission, 0);
  });

  it('does not call an analysis with no pillars missing', async () => {
    // It writes nothing, so nothing is missing when nothing is there.
    const result = await reconcile(
      { 'cortex:sub-1': analysis({ pillarHeatmap: {} }) },
      MIGRATED_SUBMISSION,
      [],
    );
    assert.equal(result.classifications.skipped, 1);
    assert.equal(result.classifications.migrated, 0);
    assert.equal(result.missingCount, 0);
  });

  it('quarantines a malformed analysis rather than counting it missing', async () => {
    const result = await reconcile({ 'cortex:bad': '{not json' }, MIGRATED_SUBMISSION, []);
    assert.equal(result.classifications.quarantined, 1);
    assert.equal(result.missingCount, 0);
  });

  it('reports domain scores whose analysis is gone', async () => {
    const result = await reconcile(
      { 'cortex:sub-1': analysis() },
      [...MIGRATED_SUBMISSION, { id: 'submission-2', legacy_kv_key: 'sub:sub-2' }],
      [...scoreRows('submission-1'), ...scoreRows('submission-2')],
    );
    assert.equal(result.orphanCount, 1);
  });

  it('ignores a domain score it cannot attribute to a submission it knows', async () => {
    // Counting it either way would be a guess.
    const result = await reconcile({ 'cortex:sub-1': analysis() }, MIGRATED_SUBMISSION, [
      ...scoreRows('submission-1'),
      { submission_id: 'somebody-elses-submission', domain_key: 'revenue_growth', score: 10 },
    ]);
    assert.equal(result.orphanCount, 0);
    assert.equal(result.targetCount, 1);
    assert.equal(result.thresholdPassed, true);
  });

  it('accounts for every discovered key exactly once', async () => {
    const result = await reconcile(
      {
        'cortex:sub-1': analysis(),
        'cortex:sub-2': analysis({ submissionId: 'sub-2', pillarHeatmap: {} }),
        'cortex:bad': '{not json',
      },
      MIGRATED_SUBMISSION,
      scoreRows('submission-1'),
    );
    assert.equal(result.sourceCount, 3);
    assert.equal(result.unclassifiedCount, 0);
  });
});
