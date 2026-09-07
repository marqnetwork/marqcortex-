/**
 * KV ↔ SQL reconciliation for the lead domain.
 *
 * The lead backfill is the one that has actually run, so its reconciliation is
 * the one that matters today — and until now it reported a field-level pass it
 * had never made: `sampleMismatchCount` was the literal `0`, so the threshold
 * asked a question that could only be answered yes.
 *
 * These cases hold the fix, and the counting rules that were already correct
 * and had no coverage.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKvReader } from '../../supabase/functions/server/migration/kvReader.ts';
import { reconcileLeadsDomain } from '../../supabase/functions/server/migration/reconciliation.ts';
import { createFakeSupabase } from './fakeSupabase.ts';

const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';

function kvLead(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Dana Reed',
    email: `${id}@example.test`,
    phone: '+44 20 7000 0000',
    website: 'acme.test',
    source: 'lead_magnet',
    capturedAt: '2026-08-20T09:00:00.000Z',
    ...overrides,
  };
}

function sqlLead(id: string, overrides: Record<string, unknown> = {}) {
  return {
    legacy_kv_key: `lead:${id}`,
    legacy_id: id,
    email: `${id}@example.test`,
    full_name: 'Dana Reed',
    company_name: 'acme.test',
    phone: '+44 20 7000 0000',
    status: 'captured',
    captured_at: '2026-08-20T09:00:00+00:00',
    ...overrides,
  };
}

async function reconcile(
  store: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
) {
  const client = createFakeSupabase();
  // The count query, then the row query — in the order the function issues them.
  client.queue('leads', 'select', { count: rows.length, error: null });
  client.queue('leads', 'select', { data: rows, error: null });
  const reader = createInMemoryKvReader(store);
  return reconcileLeadsDomain(client as never, reader, ORG, 50);
}

describe('lead reconciliation — the field-level check now runs', () => {
  it('agrees on a correctly migrated lead', async () => {
    const result = await reconcile({ 'lead:a': kvLead('a') }, [sqlLead('a')]);
    assert.equal(result.sampleSize, 1, 'the sample is the records present on both sides');
    assert.equal(result.sampleMismatchCount, 0);
    assert.equal(result.thresholdPassed, true);
  });

  it('catches a lead whose row exists and whose contents are wrong', async () => {
    // The exact failure the previous revision reported as healthy: the count
    // matched, so nothing else was asked.
    const result = await reconcile({ 'lead:a': kvLead('a') }, [
      sqlLead('a', { full_name: 'Somebody Else', status: 'exit_intent' }),
    ]);
    assert.equal(result.missingCount, 0, 'the row exists');
    assert.equal(result.sampleMismatchCount, 1, 'and its contents are wrong');
    assert.equal(result.thresholdPassed, false);
    const fields = result.details.mismatchedFields as Record<string, number>;
    assert.equal(fields.fullName, 1);
    assert.equal(fields.status, 1);
  });

  it('does not report a timestamptz that lost its milliseconds', async () => {
    const result = await reconcile(
      { 'lead:a': kvLead('a', { capturedAt: '2026-08-20T09:00:00.412Z' }) },
      [sqlLead('a')],
    );
    assert.equal(result.sampleMismatchCount, 0);
  });

  it('declares its sample strategy', async () => {
    const result = await reconcile({ 'lead:a': kvLead('a') }, [sqlLead('a')]);
    assert.equal(result.details.sampleStrategy, 'deterministic-even-spacing');
  });
});

describe('lead reconciliation — counting, which was already right', () => {
  it('reports a KV lead the backfill never wrote', async () => {
    const result = await reconcile(
      { 'lead:a': kvLead('a'), 'lead:b': kvLead('b') },
      [sqlLead('a')],
    );
    assert.equal(result.missingCount, 1);
    assert.equal(result.thresholdPassed, false);
  });

  it('does not count a deliberately skipped duplicate email as missing', async () => {
    // Two KV leads share an email; the backfill writes the first and skips the
    // second. The second is a duplicate, not a loss.
    const result = await reconcile(
      { 'lead:a': kvLead('a'), 'lead:b': kvLead('b', { email: 'a@example.test' }) },
      [sqlLead('a')],
    );
    assert.equal(result.classifications.duplicate, 1);
    assert.equal(result.missingCount, 0);
  });

  it('counts a malformed record as quarantined and not as missing', async () => {
    const result = await reconcile({ 'lead:a': kvLead('a'), 'lead:bad': '{not json' }, [
      sqlLead('a'),
    ]);
    assert.equal(result.classifications.quarantined, 1);
    assert.equal(result.missingCount, 0);
  });

  it('never reaches the email index in the first place', async () => {
    // `lead_email:` does not start with `lead:`, so the entity scan does not
    // return it at all. The `isLeadEntityKey` guard inside the loop is the
    // backstop for a wider `--keyPrefixFilter`, not the thing that excludes it
    // here — and a test that claimed otherwise would be asserting the wrong
    // mechanism.
    const result = await reconcile(
      { 'lead:a': kvLead('a'), 'lead_email:a@example.test': 'a' },
      [sqlLead('a')],
    );
    assert.equal(result.classifications.index_only, 0);
    assert.equal(result.sourceCount, 1);
    assert.equal(result.thresholdPassed, true);
  });
});
