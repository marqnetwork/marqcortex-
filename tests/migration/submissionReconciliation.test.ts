/**
 * KV ↔ SQL reconciliation for the submission domain.
 *
 * The claim under test is the one a count-only reconciliation cannot make: that
 * a backfill wrote the RIGHT thing, not merely something. So most of these
 * cases are about the field-level check — that it fires, that it names the
 * field, that it fails the threshold, and that it uses the same comparator the
 * runtime shadow read does, so the two cannot disagree about what a divergence
 * is.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKvReader } from '../../supabase/functions/server/migration/kvReader.ts';
import {
  deterministicSample,
  reconcileSubmissionsDomain,
} from '../../supabase/functions/server/migration/submissionReconciliation.ts';
import { createFakeSupabase } from './fakeSupabase.ts';

const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';

function kv(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    company: `Company ${id}`,
    contact: 'Dana Reed',
    email: `${id}@example.test`,
    submittedAt: '2026-08-20T09:00:00.000Z',
    status: 'under-review',
    priority: 'high',
    completionScore: 88,
    qualityScore: 74,
    aiScore: 71,
    answers: { q1: 'yes' },
    ...overrides,
  };
}

function sqlRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    legacy_kv_key: `sub:${id}`,
    legacy_id: id,
    company_name: `Company ${id}`,
    contact_name: 'Dana Reed',
    contact_email: `${id}@example.test`,
    phone: null,
    website: null,
    industry: null,
    status: 'under_review',
    priority: 'high',
    completion_score: 88,
    quality_score: 74,
    ai_score: 71,
    submitted_at: '2026-08-20T09:00:00+00:00',
    ...overrides,
  };
}

async function reconcile(
  store: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
  options: { runId?: string; quarantined?: string[] } = {},
) {
  const client = createFakeSupabase();
  if (options.runId) {
    client.queue('migration_quarantine', 'select', {
      data: (options.quarantined ?? []).map((key) => ({ source_key: key })),
      error: null,
    });
  }
  client.queue('submissions', 'select', { data: rows, error: null });
  const reader = createInMemoryKvReader(store);
  return reconcileSubmissionsDomain(client as never, reader, ORG, 50, options.runId);
}

describe('submission reconciliation — counting', () => {
  it('agrees when every KV record has its relational row', async () => {
    const result = await reconcile(
      { 'sub:a': kv('a'), 'sub:b': kv('b') },
      [sqlRow('a'), sqlRow('b')],
    );
    assert.equal(result.domain, 'submissions');
    assert.equal(result.sourceCount, 2);
    assert.equal(result.targetCount, 2);
    assert.equal(result.missingCount, 0);
    assert.equal(result.sampleMismatchCount, 0);
    assert.equal(result.thresholdPassed, true);
  });

  it('reports a KV record the backfill never wrote', async () => {
    const result = await reconcile({ 'sub:a': kv('a'), 'sub:b': kv('b') }, [sqlRow('a')]);
    assert.equal(result.missingCount, 1);
    assert.equal(result.thresholdPassed, false);
  });

  it('does not count a quarantined record as missing', async () => {
    // It was deliberately not written. Counting it as missing would make every
    // reconciliation of a real estate fail for doing the right thing.
    const result = await reconcile({ 'sub:a': kv('a') }, [], {
      runId: 'run-1',
      quarantined: ['sub:a'],
    });
    assert.equal(result.missingCount, 0);
    assert.equal(result.details.quarantinedKeys, 1);
  });

  it('quarantines a malformed record rather than counting it migrated', async () => {
    const result = await reconcile({ 'sub:a': kv('a'), 'sub:bad': '{not json' }, [sqlRow('a')]);
    assert.equal(result.classifications.quarantined, 1);
    assert.equal(result.classifications.migrated, 1);
    assert.equal(result.missingCount, 0);
  });

  it('reports a relational row whose KV record is gone', async () => {
    // Not a backfill failure — KV may legitimately have moved on — but it is
    // the number that says a cutover would serve a record the authoritative
    // store no longer has.
    const result = await reconcile({ 'sub:a': kv('a') }, [sqlRow('a'), sqlRow('ghost')]);
    assert.equal(result.orphanCount, 1);
    assert.equal(result.missingCount, 0);
  });

  it('does not treat the email index as an entity', async () => {
    const result = await reconcile({ 'sub:a': kv('a') }, [sqlRow('a')]);
    assert.equal(result.sourceCount, 1);
    assert.equal(result.classifications.index_only, 0);
  });
});

describe('submission reconciliation — the field-level check', () => {
  it('catches a backfill that wrote a row for everything and got a field wrong', async () => {
    // The exact failure a count-only reconciliation reports as healthy.
    const result = await reconcile({ 'sub:a': kv('a') }, [sqlRow('a', { ai_score: 12 })]);
    assert.equal(result.missingCount, 0, 'the row exists');
    assert.equal(result.targetCount, 1);
    assert.equal(result.sampleMismatchCount, 1, 'and its contents are wrong');
    assert.equal(result.thresholdPassed, false);
  });

  it('names the field that diverged', async () => {
    const result = await reconcile(
      { 'sub:a': kv('a') },
      [sqlRow('a', { status: 'won', company_name: 'Someone Else' })],
    );
    const fields = result.details.mismatchedFields as Record<string, number>;
    assert.equal(fields.status, 1);
    assert.equal(fields.companyName, 1);
  });

  it('does not report the console vocabulary as a mismatch', async () => {
    // KV holds `under-review`, the relational row holds `under_review`. One
    // fact, two spellings — and the comparator is the shadow read's, so a
    // reconciliation and a runtime observation cannot disagree about this.
    const result = await reconcile({ 'sub:a': kv('a', { status: 'approved' }) }, [
      sqlRow('a', { status: 'won' }),
    ]);
    assert.equal(result.sampleMismatchCount, 0);
  });

  it('does not report a timestamptz that lost its milliseconds', async () => {
    const result = await reconcile(
      { 'sub:a': kv('a', { submittedAt: '2026-08-20T09:00:00.412Z' }) },
      [sqlRow('a')],
    );
    assert.equal(result.sampleMismatchCount, 0);
  });

  it('counts a mismatched record once however many fields differ', async () => {
    const result = await reconcile(
      { 'sub:a': kv('a') },
      [sqlRow('a', { ai_score: 1, quality_score: 2, company_name: 'X' })],
    );
    assert.equal(result.sampleMismatchCount, 1, 'the sample counts RECORDS');
    const fields = result.details.mismatchedFields as Record<string, number>;
    assert.equal(Object.keys(fields).length, 3, 'and the fields are named separately');
  });

  it('samples only records that exist on both sides', async () => {
    // Comparing a KV record against a row that is not there is the `missing`
    // count, not a field mismatch, and reporting it as both would double-count
    // one problem.
    const result = await reconcile({ 'sub:a': kv('a'), 'sub:b': kv('b') }, [sqlRow('a')]);
    assert.equal(result.sampleSize, 1);
    assert.equal(result.missingCount, 1);
    assert.equal(result.sampleMismatchCount, 0);
  });
});

describe('submission reconciliation — the sample is reproducible', () => {
  it('returns everything when the estate is smaller than the sample', () => {
    assert.deepEqual(deterministicSample(['b', 'a'], 100), ['a', 'b']);
  });

  it('spreads across the whole sorted range rather than taking the first n', () => {
    // A sample that degenerated to "the first hundred" would report the oldest
    // records as representative of the estate.
    const keys = Array.from({ length: 1_000 }, (_, index) => `sub:${String(index).padStart(4, '0')}`);
    const sample = deterministicSample(keys, 10);
    assert.equal(sample.length, 10);
    assert.equal(sample[0], 'sub:0000');
    assert.equal(sample[9], 'sub:0900');
    assert.ok(sample[9] > sample[0]);
  });

  it('picks the same records on a second run over the same data', () => {
    // A reconciliation is run, a fix is made, and it is run again to see whether
    // the fix worked. With a random sample the second run inspects different
    // records, so an unchanged mismatch count would mean nothing.
    const keys = Array.from({ length: 500 }, (_, index) => `sub:${index}`);
    assert.deepEqual(deterministicSample(keys, 25), deterministicSample([...keys].reverse(), 25));
  });

  it('declares its strategy on the report', async () => {
    const result = await reconcile({ 'sub:a': kv('a') }, [sqlRow('a')]);
    assert.equal(result.details.sampleStrategy, 'deterministic-even-spacing');
  });
});
