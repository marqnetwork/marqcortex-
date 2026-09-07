/**
 * The submission domain processor and writer — Phase 2 for the `sub:` namespace.
 *
 * The normalizer suite argues about the mapping. This one is about the WORK: what
 * a simulation predicts without touching a database, what a backfill writes, and
 * whether running it twice converges on KV rather than accumulating from it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryKvReader } from '../../supabase/functions/server/migration/kvReader.ts';
import {
  buildSubmissionSimulationReport,
  createSubmissionDomainContext,
  processSubmissionBatch,
} from '../../supabase/functions/server/migration/domains/submissions.ts';
import { createFakeSupabase } from './fakeSupabase.ts';

const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';
const RUN = 'run-1';

function submission(id: string, overrides: Record<string, unknown> = {}) {
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
    answers: { q1: 'yes', q2: 'no' },
    ...overrides,
  };
}

function store(): Record<string, unknown> {
  return {
    'sub:sub-1': submission('sub-1'),
    'sub:sub-2': submission('sub-2'),
    'sub:sub-bad': '{not json',
    'sub_email:dana@example.test': 'sub-1',
  };
}

async function scan(prefix = 'sub:') {
  const reader = createInMemoryKvReader(store());
  const page = await reader.scanPrefix(prefix, null, 100);
  return { reader, records: page.records };
}

describe('Phase 2 submissions — simulation writes nothing', () => {
  it('classifies a whole batch without a database client', async () => {
    const { reader, records } = await scan();
    const ctx = createSubmissionDomainContext(ORG, RUN, false);
    const refuses = {
      from() {
        throw new Error('simulation must not write business rows');
      },
    };

    await processSubmissionBatch(refuses as never, reader, ctx, records);

    assert.equal(ctx.classifications.migrated, 2);
    assert.equal(ctx.classifications.quarantined, 1, 'the malformed blob is quarantined');
    assert.equal(
      ctx.classifications.index_only,
      0,
      'the `sub:` scan does not reach `sub_email:` in the first place',
    );
    assert.equal(ctx.inserted, 0);
  });

  it('refuses to normalize the email index even when a scan reaches it', async () => {
    // `sub_email:` does not start with `sub:`, so the entity scan never sees it.
    // The guard exists for a wider `--keyPrefixFilter`, and a guard that is
    // never exercised is a guard nobody knows is broken.
    const { reader, records } = await scan('sub');
    const ctx = createSubmissionDomainContext(ORG, RUN, false);
    await processSubmissionBatch(
      { from() { throw new Error('no writes'); } } as never,
      reader,
      ctx,
      records,
    );
    assert.equal(ctx.classifications.index_only, 1, 'sub_email: is an index, not an entity');
    assert.equal(ctx.classifications.migrated, 2, 'and the entities are still migrated');
  });

  it('predicts the child-table volume a backfill would write', async () => {
    const { reader, records } = await scan();
    const ctx = createSubmissionDomainContext(ORG, RUN, false);
    await processSubmissionBatch({ from() { throw new Error('no writes'); } } as never, reader, ctx, records);

    const report = buildSubmissionSimulationReport(ctx, records.length, RUN, []);
    const details = report.details as Record<string, number>;
    assert.equal(details.predictedSubmissions, 2);
    assert.equal(details.predictedAnswers, 4, 'two answers each');
    assert.equal(details.predictedScoreRows, 2);
    assert.equal(report.quarantined, 1);
    assert.equal(report.thresholdsPassed, true);
  });

  it('accounts for every discovered key exactly once', async () => {
    // A total above what was discovered would mean a record was counted twice,
    // which is the one arithmetic error that makes a report reassuring and wrong.
    const { reader, records } = await scan();
    const ctx = createSubmissionDomainContext(ORG, RUN, false);
    await processSubmissionBatch({ from() { throw new Error('no writes'); } } as never, reader, ctx, records);
    const details = buildSubmissionSimulationReport(ctx, records.length, RUN, []).details as Record<
      string,
      number
    >;
    assert.equal(details.accountedFor, records.length);
  });

  it('counts a repeated legacy key once', async () => {
    const reader = createInMemoryKvReader({ 'sub:dup': submission('dup') });
    const page = await reader.scanPrefix('sub:', null, 100);
    const ctx = createSubmissionDomainContext(ORG, RUN, false);
    const refuses = { from() { throw new Error('no writes'); } } as never;
    await processSubmissionBatch(refuses, reader, ctx, page.records);
    await processSubmissionBatch(refuses, reader, ctx, page.records);
    assert.equal(ctx.classifications.migrated, 1);
    assert.equal(ctx.classifications.duplicate, 1);
  });
});

describe('Phase 2 submissions — the backfill writes three destinations', () => {
  async function backfill(client = createFakeSupabase()) {
    const reader = createInMemoryKvReader({ 'sub:sub-1': submission('sub-1') });
    const page = await reader.scanPrefix('sub:', null, 100);
    const ctx = createSubmissionDomainContext(ORG, RUN, true);
    await processSubmissionBatch(client as never, reader, ctx, page.records);
    return { client, ctx };
  }

  it('inserts the submission, its score row and its answers', async () => {
    const { client, ctx } = await backfill();
    assert.equal(ctx.inserted, 1);
    assert.equal(client.opsFor('submissions').some((op) => op.verb === 'insert'), true);
    assert.equal(client.opsFor('diagnostic_scores').some((op) => op.verb === 'insert'), true);
    assert.equal(
      client.opsFor('diagnostic_answers').filter((op) => op.verb === 'insert').length,
      2,
    );
    assert.equal(ctx.answersWritten, 2);
  });

  it('writes the score row even when every score is null', async () => {
    // Its absence and a row of nulls mean different things: "never scored"
    // versus "the migration has not reached it". Only the second is a reason to
    // look, so the row is always written.
    const client = createFakeSupabase();
    const reader = createInMemoryKvReader({
      'sub:blank': submission('blank', { completionScore: null, qualityScore: null, aiScore: null }),
    });
    const page = await reader.scanPrefix('sub:', null, 100);
    const ctx = createSubmissionDomainContext(ORG, RUN, true);
    await processSubmissionBatch(client as never, reader, ctx, page.records);

    const insert = client.opsFor('diagnostic_scores').find((op) => op.verb === 'insert');
    assert.ok(insert, 'a score row is written regardless');
    assert.equal(insert.payload?.completion_score, null);
  });

  it('scopes the lead and contact lookups to the organization', async () => {
    // A join on email alone would attach one tenant's submission to another
    // tenant's contact, which is the one mistake here that re-running cannot undo.
    const { client } = await backfill();
    for (const table of ['contacts', 'leads']) {
      const lookup = client.opsFor(table)[0];
      assert.ok(lookup, `${table} was never consulted`);
      assert.ok(
        lookup.filters.some(
          (filter) => filter.column === 'organization_id' && filter.value === ORG,
        ),
        `${table} was looked up without an organization scope`,
      );
    }
  });

  it('migrates with null links rather than refusing when the lead backfill has not run', async () => {
    const { client, ctx } = await backfill();
    assert.equal(ctx.unlinked, 1);
    const insert = client.opsFor('submissions').find((op) => op.verb === 'insert');
    assert.equal(insert?.payload?.lead_id, null);
    assert.equal(insert?.payload?.contact_id, null);
    assert.equal(ctx.inserted, 1, 'an unresolved link is an enrichment that did not happen');
  });

  it('links a submission to the lead and contact the lead backfill created', async () => {
    const client = createFakeSupabase();
    client.queue('contacts', 'select', { data: { id: 'contact-7' }, error: null });
    client.queue('leads', 'select', { data: { id: 'lead-7' }, error: null });
    const { ctx } = await backfill(client);
    const insert = client.opsFor('submissions').find((op) => op.verb === 'insert');
    assert.equal(insert?.payload?.contact_id, 'contact-7');
    assert.equal(insert?.payload?.lead_id, 'lead-7');
    assert.equal(ctx.unlinked, 0);
  });

  it('stamps the migration run on the row it wrote', async () => {
    const { client } = await backfill();
    const insert = client.opsFor('submissions').find((op) => op.verb === 'insert');
    const metadata = insert?.payload?.metadata as Record<string, unknown>;
    assert.equal(metadata.migration_run_id, RUN);
  });

  it('records a quarantine against the submissions table', async () => {
    const client = createFakeSupabase();
    const reader = createInMemoryKvReader({ 'sub:bad': '{not json' });
    const page = await reader.scanPrefix('sub:', null, 100);
    const ctx = createSubmissionDomainContext(ORG, RUN, true);
    await processSubmissionBatch(client as never, reader, ctx, page.records);

    const quarantine = client.opsFor('migration_quarantine').find((op) => op.verb === 'insert');
    assert.ok(quarantine, 'nothing was quarantined');
    assert.equal(quarantine.payload?.target_table, 'submissions');
    assert.equal(quarantine.payload?.reason_code, 'MALFORMED_JSON');
    assert.equal(ctx.quarantineCount, 1);
  });
});

describe('Phase 2 submissions — a re-run converges on KV', () => {
  it('updates rather than inserts when the submission already exists', async () => {
    const client = createFakeSupabase();
    client.queue('contacts', 'select', { data: null, error: null });
    client.queue('leads', 'select', { data: null, error: null });
    client.queue('submissions', 'select', { data: { id: 'submission-1' }, error: null });
    client.queue('diagnostic_scores', 'select', { data: { id: 'score-1' }, error: null });

    const reader = createInMemoryKvReader({ 'sub:sub-1': submission('sub-1') });
    const page = await reader.scanPrefix('sub:', null, 100);
    const ctx = createSubmissionDomainContext(ORG, RUN, true);
    await processSubmissionBatch(client as never, reader, ctx, page.records);

    assert.equal(ctx.updated, 1);
    assert.equal(ctx.inserted, 0);
    assert.equal(client.opsFor('submissions').some((op) => op.verb === 'insert'), false);
    assert.equal(client.opsFor('diagnostic_scores').some((op) => op.verb === 'update'), true);
  });

  it('retires an answer KV no longer carries', async () => {
    // Without this a backfill accumulates: a removed answer key survives as a
    // relational row that no re-run can explain.
    const client = createFakeSupabase();
    const reader = createInMemoryKvReader({ 'sub:sub-1': submission('sub-1', { answers: { q1: 'yes' } }) });
    const page = await reader.scanPrefix('sub:', null, 100);
    const ctx = createSubmissionDomainContext(ORG, RUN, true);
    // The retirement sweep reports the row it soft-deleted.
    client.queue('contacts', 'select', { data: null, error: null });
    client.queue('leads', 'select', { data: null, error: null });
    client.queue('submissions', 'select', { data: { id: 'submission-1' }, error: null });
    client.queue('diagnostic_scores', 'select', { data: { id: 'score-1' }, error: null });
    client.queue('diagnostic_answers', 'select', { data: null, error: null });
    client.queue('diagnostic_answers', 'update', { data: [{ id: 'answer-q2' }], error: null });

    await processSubmissionBatch(client as never, reader, ctx, page.records);

    const retire = client
      .opsFor('diagnostic_answers')
      .find((op) => op.verb === 'update' && op.filters.some((filter) => filter.op.startsWith('not.')));
    assert.ok(retire, 'no retirement sweep was issued');
    assert.equal((retire.payload as Record<string, unknown>).deleted_at !== undefined, true);
    assert.equal(ctx.answersRetired, 1);
  });

  it('retires every answer when KV carries none', async () => {
    // The exclusion list is empty here, and an empty `not in ()` is not a filter
    // PostgREST accepts — so the sweep must still be well-formed and must
    // retire everything rather than nothing.
    const client = createFakeSupabase();
    const reader = createInMemoryKvReader({ 'sub:sub-1': submission('sub-1', { answers: {} }) });
    const page = await reader.scanPrefix('sub:', null, 100);
    const ctx = createSubmissionDomainContext(ORG, RUN, true);
    await processSubmissionBatch(client as never, reader, ctx, page.records);

    const retire = client
      .opsFor('diagnostic_answers')
      .find((op) => op.verb === 'update' && op.filters.some((filter) => filter.op.startsWith('not.')));
    assert.ok(retire, 'no retirement sweep was issued for an empty answer set');
    const exclusion = retire.filters.find((filter) => filter.op.startsWith('not.'));
    assert.equal(exclusion?.value, '("")', 'the empty exclusion must still be a valid tuple');
  });
});
