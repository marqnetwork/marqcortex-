/**
 * The cortex analysis domain — Phase 2 for the `cortex:` namespace.
 *
 * Two decisions the mapping document does not make are argued here, because
 * they are the ones that decide whether the migrated data means anything:
 * a 0–5 heatmap going into a 0–100 column, and a readiness BAND facing an
 * INTEGER column.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKvReader } from '../../supabase/functions/server/migration/kvReader.ts';
import {
  DOMAIN_SCORE_MAX,
  HEATMAP_MAX,
  canonicalCortexHash,
  normalizeCortexRecord,
  parseCortexKvRecord,
  scalePillar,
  submissionIdFromCortexKey,
} from '../../supabase/functions/server/migration/cortexNormalizer.ts';
import {
  buildCortexSimulationReport,
  createCortexDomainContext,
  processCortexBatch,
} from '../../supabase/functions/server/migration/domains/cortexAnalysis.ts';
import { createFakeSupabase } from './fakeSupabase.ts';

const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';
const RUN = 'run-1';
const KEY = 'cortex:sub-1';

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: 'sub-1',
    status: 'complete',
    aiScore: 71,
    qualityScore: 74,
    readinessScore: 'High',
    confidenceScore: 'Medium',
    pillarHeatmap: {
      operationsExecution: 4,
      revenueGrowth: 3,
      systemsAutomation: 5,
      aiReadinessGovernance: 2,
    },
    analyzedAt: '2026-08-21T10:00:00.000Z',
    model: 'gpt-4o',
    provider: 'openai',
    promptVersion: 'analysis.diagnostic@3',
    requestId: 'req_123',
    ...overrides,
  };
}

function normalize(overrides: Record<string, unknown> = {}, key = KEY) {
  return normalizeCortexRecord(parseCortexKvRecord(key, analysis(overrides)), ORG, key);
}

function migrated(overrides: Record<string, unknown> = {}, key = KEY) {
  const result = normalize(overrides, key);
  assert.ok(result.ok, `expected a migrated record, got ${JSON.stringify(result)}`);
  return result.record;
}

describe('cortex domain — the heatmap meets a percentage column', () => {
  it('scales 0-5 onto the column its own constraint declares', () => {
    // Storing 4 in a column constrained to 0-100 would read as "4%" to every
    // consumer that assumes the column means what it says.
    assert.equal(scalePillar(0), 0);
    assert.equal(scalePillar(5), DOMAIN_SCORE_MAX);
    assert.equal(scalePillar(4), 80);
    assert.equal(scalePillar(2.5), 50);
  });

  it('records the original value, so the transformation is auditable', () => {
    const record = migrated();
    const operations = record.domainScores.find((entry) => entry.domainKey === 'operations_execution');
    assert.equal(operations?.score, 80);
    assert.equal(operations?.sourceValue, 4);
  });

  it('drops a value outside the authored scale rather than clamping it', () => {
    // Clamping would record a measurement that was never made. No row is the
    // truthful answer, and the fact is named on the record.
    assert.equal(scalePillar(7), null);
    assert.equal(scalePillar(-1), null);
    assert.equal(scalePillar('four'), null);

    const record = migrated({ pillarHeatmap: { operationsExecution: 9, revenueGrowth: 3 } });
    assert.deepEqual(
      record.domainScores.map((entry) => entry.domainKey),
      ['revenue_growth'],
    );
    assert.ok(record.inferredFields.includes('operations_execution_out_of_range'));
  });

  it('names a pillar the analysis did not produce', () => {
    const record = migrated({ pillarHeatmap: { operationsExecution: 4 } });
    assert.equal(record.domainScores.length, 1);
    assert.ok(record.inferredFields.includes('revenue_growth_absent'));
  });

  it('keys the domain from a declared table, not from the field name', () => {
    // `domain_key` is a stable identifier other things join on. Deriving it
    // from a field name would let a rename in the feature contract silently
    // re-key every historical row.
    assert.deepEqual(
      migrated().domainScores.map((entry) => entry.domainKey).sort(),
      ['ai_readiness_governance', 'operations_execution', 'revenue_growth', 'systems_automation'],
    );
  });
});

describe('cortex domain — a band is not a number', () => {
  it('records the readiness band without inventing an integer for it', () => {
    // Mapping Low/Medium/High onto 25/50/75 would put three numbers in a
    // database that no model ever produced, and every consumer downstream would
    // treat them as measured.
    const record = migrated();
    assert.equal(record.scoreMetadata.cortex_readiness_band, 'High');
    assert.equal(record.scoreMetadata.cortex_confidence_band, 'Medium');
    assert.equal('readiness_score' in record.scoreMetadata, false);
    assert.equal('readinessScore' in record.scoreMetadata, false);
  });

  it('carries the provenance of the run that produced the analysis', () => {
    const record = migrated();
    assert.equal(record.scoreMetadata.cortex_model, 'gpt-4o');
    assert.equal(record.scoreMetadata.cortex_provider, 'openai');
    assert.equal(record.scoreMetadata.cortex_prompt_version, 'analysis.diagnostic@3');
    assert.equal(record.scoreMetadata.cortex_request_id, 'req_123');
  });

  it('writes no score column at all', () => {
    // `sub:` owns aiScore and qualityScore. A cortex backfill that also wrote
    // them would make the result depend on which domain ran last.
    const serialized = JSON.stringify(migrated().scoreMetadata);
    assert.equal(serialized.includes('"ai_score"'), false);
    assert.equal(serialized.includes('"quality_score"'), false);
  });
});

describe('cortex domain — keys and refusals', () => {
  it('derives the submission from the key', () => {
    assert.equal(submissionIdFromCortexKey('cortex:sub-1'), 'sub-1');
    assert.equal(submissionIdFromCortexKey('sub:sub-1'), undefined);
    assert.equal(submissionIdFromCortexKey('cortex:'), undefined);
  });

  it('quarantines a blob that does not parse', () => {
    const result = normalizeCortexRecord(parseCortexKvRecord(KEY, '{not json'), ORG, KEY);
    assert.equal(result.ok, false);
  });

  it('quarantines a key it cannot address a submission from', () => {
    const result = normalizeCortexRecord(parseCortexKvRecord('cortex:', analysis()), ORG, 'cortex:');
    assert.equal(result.ok, false);
  });

  it('hashes the analysis by its scores and band, not its prose', () => {
    const base = canonicalCortexHash(migrated());
    assert.equal(canonicalCortexHash(migrated({ primaryPainSignal: 'different words' })), base);
    assert.notEqual(canonicalCortexHash(migrated({ readinessScore: 'Low' })), base);
  });
});

describe('cortex domain — the batch', () => {
  async function run(store: Record<string, unknown>, write: boolean, client = createFakeSupabase()) {
    const reader = createInMemoryKvReader(store);
    const page = await reader.scanPrefix('cortex:', null, 100);
    const ctx = createCortexDomainContext(ORG, RUN, write);
    await processCortexBatch(client as never, reader, ctx, page.records);
    return { ctx, client, discovered: page.records.length };
  }

  it('predicts the domain score volume without a client', async () => {
    const { ctx, discovered } = await run({ 'cortex:sub-1': analysis() }, false);
    const report = buildCortexSimulationReport(ctx, discovered, RUN, []);
    const details = report.details as Record<string, number>;
    assert.equal(details.predictedAnalyses, 1);
    assert.equal(details.predictedDomainScores, 4);
    assert.equal(report.thresholdsPassed, true);
  });

  it('skips an analysis with no heatmap rather than counting it migrated', async () => {
    const { ctx } = await run({ 'cortex:sub-1': analysis({ pillarHeatmap: {} }) }, false);
    assert.equal(ctx.classifications.skipped, 1);
    assert.equal(ctx.classifications.migrated, 0);
  });

  it('writes one row per pillar and merges the metadata', async () => {
    const client = createFakeSupabase();
    client.queue('submissions', 'select', { data: { id: 'submission-1' }, error: null });
    const { ctx } = await run({ 'cortex:sub-1': analysis() }, true, client);

    assert.equal(client.opsFor('domain_scores').filter((op) => op.verb === 'insert').length, 4);
    assert.equal(ctx.domainScoresWritten, 4);
    const scores = client.opsFor('diagnostic_scores').find((op) => op.verb === 'insert');
    const metadata = scores?.payload?.metadata as Record<string, unknown>;
    assert.equal(metadata.cortex_readiness_band, 'High');
    assert.equal(metadata.migration_run_id, RUN);
  });

  it('records the source scale on every row it writes', async () => {
    const client = createFakeSupabase();
    client.queue('submissions', 'select', { data: { id: 'submission-1' }, error: null });
    await run({ 'cortex:sub-1': analysis() }, true, client);
    const insert = client.opsFor('domain_scores').find((op) => op.verb === 'insert');
    const metadata = insert?.payload?.metadata as Record<string, unknown>;
    assert.equal(metadata.source_scale, `0-${HEATMAP_MAX}`);
    assert.equal(typeof metadata.source_value, 'number');
  });

  it('quarantines an analysis whose submission has not been migrated', async () => {
    // The domain-ordering dependency, per record rather than as a failed batch:
    // a failure tells an operator the migration is broken, a quarantine tells
    // them which analyses are waiting on which submissions.
    const { ctx, client } = await run({ 'cortex:sub-1': analysis() }, true);
    assert.equal(ctx.awaitingSubmission, 1);
    assert.equal(ctx.classifications.migrated, 0);
    assert.equal(ctx.classifications.quarantined, 1);
    const quarantine = client.opsFor('migration_quarantine').find((op) => op.verb === 'insert');
    assert.equal(quarantine?.payload?.reason_code, 'SUBMISSION_NOT_MIGRATED');
    assert.equal(client.opsFor('domain_scores').some((op) => op.verb === 'insert'), false);
  });

  it('updates rather than inserting when a pillar row already exists', async () => {
    const client = createFakeSupabase();
    client.queue('submissions', 'select', { data: { id: 'submission-1' }, error: null });
    client.queue('domain_scores', 'select', { data: { id: 'domain-1' }, error: null });
    const { ctx } = await run({ 'cortex:sub-1': analysis() }, true, client);
    assert.equal(ctx.updated, 1);
    assert.equal(ctx.inserted, 3, 'the other three pillars are still new');
  });
});
