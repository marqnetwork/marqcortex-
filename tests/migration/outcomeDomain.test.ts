/**
 * The outcome domain — Phase 2 for the `outcome:` namespace.
 *
 * The record this domain migrates is a verdict a consultant reached about a
 * deal. Most of what follows is about refusing to guess one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKvReader } from '../../supabase/functions/server/migration/kvReader.ts';
import {
  canonicalOutcomeHash,
  normalizeConversionValue,
  normalizeOutcomeRecord,
  parseOutcomeKvRecord,
  submissionIdFromOutcomeKey,
  type OutcomeNormalizationResult,
} from '../../supabase/functions/server/migration/outcomeNormalizer.ts';
import {
  buildOutcomeSimulationReport,
  createOutcomeDomainContext,
  processOutcomeBatch,
} from '../../supabase/functions/server/migration/domains/outcomes.ts';
import { projectSqlOutcome } from '../../supabase/functions/server/storage/index.ts';
import { createFakeSupabase } from './fakeSupabase.ts';

const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';
const RUN = 'run-1';
const KEY = 'outcome:sub-1';

function outcome(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: 'sub-1',
    loggedAt: '2026-09-01T10:15:30.412Z',
    loggedBy: 'user-1',
    didConvert: true,
    conversionValue: 1500,
    lostReason: null,
    recommendationWorked: true,
    whatWeLearned: 'the diagnostic landed',
    improvementAreas: ['discovery'],
    industry: 'Manufacturing',
    company: 'Acme Ltd',
    aiScore: 71,
    recommendedService: 'operations-audit',
    submittedAt: '2026-08-20T09:00:00.000Z',
    ...overrides,
  };
}

function normalize(overrides: Record<string, unknown> = {}, key = KEY) {
  return normalizeOutcomeRecord(parseOutcomeKvRecord(key, outcome(overrides)), ORG, key);
}

function migrated(overrides: Record<string, unknown> = {}, key = KEY) {
  const result = normalize(overrides, key);
  assert.ok(result.ok, `expected a migrated record, got ${JSON.stringify(result)}`);
  return result.record;
}

function quarantined(result: OutcomeNormalizationResult, message: string) {
  assert.equal(result.ok, false, message);
  return result as Extract<OutcomeNormalizationResult, { ok: false }>;
}

describe('outcome domain — the verdict is the record', () => {
  it('maps didConvert onto the relational vocabulary', () => {
    assert.equal(migrated().outcomeType, 'won');
    assert.equal(migrated({ didConvert: false }).outcomeType, 'lost');
  });

  it('writes what the shadow read expects to find', () => {
    // The normalizer's mapping is the inverse of the shadow read's reading. If
    // they disagreed, every migrated outcome would report as drift the moment
    // the instrument was switched on.
    const record = migrated();
    const projected = projectSqlOutcome({
      legacy_kv_key: record.legacyKvKey,
      outcome_type: record.outcomeType,
      value: record.value,
      recorded_at: record.recordedAt,
    });
    assert.equal(projected.converted, true);
    assert.equal(projected.submissionId, 'sub-1');
    assert.equal(projected.conversionValue, 1500);
  });

  it('quarantines a record with no conversion verdict rather than guessing one', () => {
    // A guessed "lost" is a deal a consultant will be told they lost.
    for (const missing of [undefined, null, 'yes', 1]) {
      const result = normalize({ didConvert: missing });
      assert.equal(
        quarantined(result, `didConvert=${String(missing)} must not normalize`).reasonCode,
        'MISSING_VERDICT',
      );
    }
  });

  it('quarantines a blob that does not parse and a key it cannot address', () => {
    assert.equal(
      quarantined(
        normalizeOutcomeRecord(parseOutcomeKvRecord(KEY, '{not json'), ORG, KEY),
        'malformed',
      ).reasonCode,
      'MALFORMED_JSON',
    );
    assert.equal(
      quarantined(
        normalizeOutcomeRecord(parseOutcomeKvRecord('outcome:', outcome()), ORG, 'outcome:'),
        'unaddressable',
      ).reasonCode,
      'UNADDRESSABLE_KEY',
    );
  });

  it('records a logged outcome as closed, not open', () => {
    // The column defaults to `open`, which is right for a row created by
    // something still in progress and wrong for a verdict already reached.
    assert.equal(migrated().status, 'closed');
  });

  it('derives the submission from the key', () => {
    assert.equal(submissionIdFromOutcomeKey('outcome:sub-1'), 'sub-1');
    assert.equal(submissionIdFromOutcomeKey('sub:sub-1'), undefined);
  });
});

describe('outcome domain — what travels into `value`, and what does not', () => {
  it('carries what only the outcome knows', () => {
    const value = migrated().value;
    assert.equal(value.conversionValue, 1500);
    assert.equal(value.whatWeLearned, 'the diagnostic landed');
    assert.deepEqual(value.improvementAreas, ['discovery']);
    assert.equal(value.recommendedService, 'operations-audit');
  });

  it('does not copy the submission snapshot', () => {
    // Those fields are live on the submission this row already points at.
    // Copying them would create a second, staler answer to a question the
    // schema already answers — and the shadow read excludes them for the same
    // reason.
    const serialized = JSON.stringify(migrated().value);
    for (const snapshot of ['Manufacturing', 'Acme Ltd', '71', '2026-08-20']) {
      assert.ok(!serialized.includes(snapshot), `the outcome value copied ${snapshot}`);
    }
  });

  it('reads a conversion value however the route happened to write it', () => {
    assert.equal(normalizeConversionValue(1500), 1500);
    assert.equal(normalizeConversionValue('1500.50'), 1500.5);
    assert.equal(normalizeConversionValue(null), null);
    assert.equal(normalizeConversionValue(''), null);
    assert.equal(normalizeConversionValue(-5), null);
    assert.equal(normalizeConversionValue('not money'), null);
  });

  it('names an unreadable conversion value on a converted deal', () => {
    const record = migrated({ conversionValue: 'not money' });
    assert.equal(record.value.conversionValue, null);
    assert.ok(record.inferredFields.includes('conversion_value_unreadable'));
  });

  it('uses the epoch for an unusable timestamp rather than inventing today', () => {
    const record = migrated({ loggedAt: 'not a date' });
    assert.equal(record.recordedAt, new Date(0).toISOString());
    assert.ok(record.inferredFields.includes('recorded_at_default'));
  });

  it('hashes by the verdict and the money, not the prose', () => {
    const base = canonicalOutcomeHash(migrated());
    assert.equal(canonicalOutcomeHash(migrated({ whatWeLearned: 'different words' })), base);
    assert.notEqual(canonicalOutcomeHash(migrated({ didConvert: false })), base);
    assert.notEqual(canonicalOutcomeHash(migrated({ conversionValue: 9 })), base);
  });
});

describe('outcome domain — the batch', () => {
  async function run(store: Record<string, unknown>, write: boolean, client = createFakeSupabase()) {
    const reader = createInMemoryKvReader(store);
    const page = await reader.scanPrefix('outcome:', null, 100);
    const ctx = createOutcomeDomainContext(ORG, RUN, write);
    await processOutcomeBatch(client as never, reader, ctx, page.records);
    return { ctx, client, discovered: page.records.length };
  }

  it('predicts the split without a client', async () => {
    const { ctx, discovered } = await run(
      { 'outcome:a': outcome(), 'outcome:b': outcome({ didConvert: false }) },
      false,
    );
    const details = buildOutcomeSimulationReport(ctx, discovered, RUN, []).details as Record<
      string,
      number
    >;
    assert.equal(details.predictedOutcomes, 2);
    assert.equal(details.predictedWon, 1);
    assert.equal(details.predictedLost, 1);
  });

  it('keys the upsert on the submission, not on the KV key', async () => {
    // `outcomes.submission_id` is UNIQUE. Looking up by `legacy_kv_key` would
    // miss a row written for the same submission under a different key, and the
    // insert would then fail on a constraint the writer could have honoured.
    const client = createFakeSupabase();
    client.queue('submissions', 'select', { data: { id: 'submission-1' }, error: null });
    await run({ 'outcome:a': outcome() }, true, client);
    const lookup = client.opsFor('outcomes').find((op) => op.verb === 'select');
    assert.ok(lookup?.filters.some((filter) => filter.column === 'submission_id'));
    assert.ok(!lookup?.filters.some((filter) => filter.column === 'legacy_kv_key'));
  });

  it('writes the outcome once its submission exists', async () => {
    const client = createFakeSupabase();
    client.queue('submissions', 'select', { data: { id: 'submission-1' }, error: null });
    const { ctx } = await run({ 'outcome:a': outcome() }, true, client);
    const insert = client.opsFor('outcomes').find((op) => op.verb === 'insert');
    assert.equal(insert?.payload?.outcome_type, 'won');
    assert.equal(insert?.payload?.status, 'closed');
    assert.equal(ctx.inserted, 1);
  });

  it('quarantines an outcome whose submission has not been migrated', async () => {
    const { ctx, client } = await run({ 'outcome:a': outcome() }, true);
    assert.equal(ctx.awaitingSubmission, 1);
    assert.equal(ctx.classifications.migrated, 0);
    const quarantine = client.opsFor('migration_quarantine').find((op) => op.verb === 'insert');
    assert.equal(quarantine?.payload?.reason_code, 'SUBMISSION_NOT_MIGRATED');
    assert.equal(quarantine?.payload?.target_table, 'outcomes');
    assert.equal(client.opsFor('outcomes').some((op) => op.verb === 'insert'), false);
  });

  it('updates rather than inserting on a re-run', async () => {
    const client = createFakeSupabase();
    client.queue('submissions', 'select', { data: { id: 'submission-1' }, error: null });
    client.queue('outcomes', 'select', { data: { id: 'outcome-1' }, error: null });
    const { ctx } = await run({ 'outcome:a': outcome() }, true, client);
    assert.equal(ctx.updated, 1);
    assert.equal(ctx.inserted, 0);
  });
});
