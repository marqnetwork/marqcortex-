#!/usr/bin/env node
/**
 * The submission cutover (MCV2-S8.1, aggregate half), against a real PostgreSQL.
 *
 * The outcome cutover was a projection of one row. This one reconstructs a
 * document from `submissions` plus `diagnostic_answers`, so the things that can
 * go wrong are different and mostly invisible to a unit test: a status spelling
 * the console does not read, an answer key that changed case in the round trip,
 * a remainder field that overwrote a modelled column, a tenant's answers
 * attached to another tenant's submission.
 *
 * Each is exercised here against real rows through the real repository.
 *
 * Usage:  deno run --allow-all --config supabase/functions/deno.json \
 *           --node-modules-dir=none scripts/submission-cutover-scenarios.mjs
 * Exit:   0 passed, 1 a scenario failed, 2 no database (BLOCKED, not a pass).
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { createPsqlClient } from '../tests/database/harness/postgrestOverPsql.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const SCRATCH_DB = process.env.SUBMISSION_CUTOVER_DB ?? 'cortex_submission_cutover';

const STEPS = [
  join(HARNESS, '00_platform_stub.sql'),
  join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql'),
  join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql'),
  join(MIGRATIONS, '20260713000000_kv_store_foundation.sql'),
  join(MIGRATIONS, '20260714050000_cortex_diagnostic_foundation.sql'),
  join(MIGRATIONS, '20260910120000_cortex_tenancy_composite_keys.sql'),
];

function baseArgs(database) {
  if (process.env.DATABASE_URL) {
    const parsed = new URL(process.env.DATABASE_URL);
    if (database) parsed.pathname = `/${database}`;
    return ['-d', parsed.toString()];
  }
  return database ? ['-d', database] : [];
}
const psql = (args, database) =>
  spawnSync('psql', [...baseArgs(database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    encoding: 'utf8', env: process.env,
  });
const fail = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

if (psql(['-c', 'SELECT 1']).status !== 0) {
  console.error('BLOCKED: no reachable PostgreSQL. NOT RUN is not a pass.');
  process.exit(2);
}
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
if (psql(['-c', `CREATE DATABASE ${SCRATCH_DB}`]).status !== 0) fail('could not create scratch db');
console.log(`\nSubmission cutover scenarios — "${SCRATCH_DB}"`);
for (const file of STEPS) {
  const run = psql(['-f', file], SCRATCH_DB);
  if (run.status !== 0) {
    psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
    fail(`applying ${file}\n${(run.stderr ?? '').trim()}`);
  }
}
console.log(`  ✓ schema applied (${STEPS.length} steps)`);

const scratchUrl = () => {
  if (!process.env.DATABASE_URL) return SCRATCH_DB;
  const parsed = new URL(process.env.DATABASE_URL);
  parsed.pathname = `/${SCRATCH_DB}`;
  return parsed.toString();
};
const run = (text) => {
  const r = psql(['-c', text], SCRATCH_DB);
  if (r.status !== 0) fail(`setup SQL failed:\n${text}\n${(r.stderr ?? '').trim()}`);
};
const scalar = (text) => {
  const r = spawnSync('psql',
    [...baseArgs(SCRATCH_DB), '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-t', '-c', text],
    { encoding: 'utf8', env: process.env });
  if (r.status !== 0) fail(`SQL failed:\n${text}\n${(r.stderr ?? '').trim()}`);
  return r.stdout.trim();
};

const client = createPsqlClient(scratchUrl());

const { createReadAuthority } = await import('../supabase/functions/server/storage/readAuthority.ts');
const { createSubmissionRepository } = await import('../supabase/functions/server/repositories/submissionRepository.ts');
const { submissionRowToKvShape, reconstructionIsLossy } =
  await import('../supabase/functions/server/storage/submissionReadAuthority.ts');
const { SUBMISSION_FIELDS, projectKvSubmission, projectSqlSubmission, submissionKvKey } =
  await import('../supabase/functions/server/storage/submissionProjection.ts');

run(`INSERT INTO public.organizations (slug, name) VALUES ('cut-a','A'), ('cut-b','B')`);
const ORG_A = scalar(`SELECT id FROM public.organizations WHERE slug='cut-a'`);
const ORG_B = scalar(`SELECT id FROM public.organizations WHERE slug='cut-b'`);

/** What KV holds — the document the route serves today. */
const KV = {
  id: 'c1', company: 'Cutover Co', contact: 'Ann', email: 'ann@t.test',
  phone: 'Not specified', website: '', industry: 'Retail',
  employees: 'Not specified', revenue: 'Not specified',
  isRead: false, submittedDate: '1 Jan 2026',
  status: 'in-review', priority: 'high',
  completionScore: 80, qualityScore: 75, aiScore: 62,
  submittedAt: '2026-01-01T00:00:00.000Z',
  answers: { 'founder-dependency': 4, 'manual-operations': 2 },
};

const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

function insertSubmission(org, key, {
  status = 'under_review', phone = null, website = null,
  remainder = { employees: 'Not specified', isRead: false, revenue: 'Not specified', submittedDate: '1 Jan 2026' },
  dropped = null,
} = {}) {
  const metadata = { kv_double_encoded: false, kv_remainder: remainder,
    ...(dropped ? { backfill_dropped_answer_keys: dropped } : {}) };
  run(`INSERT INTO public.submissions
        (organization_id, legacy_kv_key, legacy_id, company_name, contact_name, contact_email,
         phone, website, industry, status, priority, completion_score, quality_score, ai_score,
         submitted_at, metadata)
       VALUES (${lit(org)}, ${lit(key)}, 'c1', 'Cutover Co', 'Ann', 'ann@t.test',
               ${lit(phone)}, ${lit(website)}, 'Retail', ${lit(status)}, 'high', 80, 75, 62,
               '2026-01-01T00:00:00.000Z', ${json(metadata)})`);
  return scalar(`SELECT id FROM public.submissions WHERE legacy_kv_key = ${lit(key)}`);
}

function insertAnswers(org, submissionId, answers) {
  for (const [key, value] of Object.entries(answers)) {
    run(`INSERT INTO public.diagnostic_answers (organization_id, submission_id, question_key, answer_text, answer_json)
         VALUES (${lit(org)}, ${lit(submissionId)}, ${lit(key)}, ${lit(String(value))}, ${json(value)})`);
  }
}
const clearAll = () => run(`TRUNCATE public.diagnostic_answers, public.submissions CASCADE`);

function authorityFor(on, { deadlineMs = 5000 } = {}) {
  const notices = [];
  const authority = createReadAuthority({
    authoritative: () => on,
    deadlineMs: () => deadlineMs,
    now: () => Date.now(),
    isoNow: () => new Date().toISOString(),
    onNotice: (r) => notices.push(r),
  });
  const resolve = (loadSql) => authority.resolve({
    domain: 'submission',
    key: submissionKvKey('c1'),
    kv: KV,
    fields: SUBMISSION_FIELDS,
    loadSql: loadSql ?? (async () => {
      const repo = createSubmissionRepository(client);
      const row = await repo.getSubmissionByLegacyKey(submissionKvKey('c1'));
      if (!row) return null;
      // THE MODULE'S OWN refusal, not a copy of it. A copy here would keep
      // every scenario green while the real one was deleted.
      if (reconstructionIsLossy(row)) return null;
      const answers = await repo.listAnswers(row.id, row.organization_id);
      return { row, answers };
    }),
    toRecord: (loaded) => submissionRowToKvShape(loaded.row, loaded.answers),
    projectKv: projectKvSubmission,
    projectSql: (loaded) => projectSqlSubmission(loaded.row),
  });
  return { authority, resolve, notices };
}

const results = [];
async function scenario(name, body) {
  clearAll();
  try { await body(); } catch (cause) {
    fail(`${name}\n${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`);
  }
  results.push(name);
  console.log(`  ✓ ${name}`);
}

console.log('\nReconstruction');

await scenario('modeled fields reconstruct from the relational row', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, KV.answers);
  const { resolve } = authorityFor(true);
  const { record, source } = await resolve();
  assert.equal(source, 'sql');
  assert.equal(record.id, 'c1');
  assert.equal(record.company, 'Cutover Co');
  assert.equal(record.contact, 'Ann');
  assert.equal(record.email, 'ann@t.test');
  assert.equal(record.industry, 'Retail');
  assert.equal(record.priority, 'high');
  assert.equal(record.completionScore, 80);
  assert.equal(record.qualityScore, 75);
  assert.equal(record.aiScore, 62);
});

await scenario('answers reconstruct with their keys and their TYPES intact', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, KV.answers);
  const { resolve } = authorityFor(true);
  const { record } = await resolve();
  assert.deepEqual(Object.keys(record.answers).sort(), ['founder-dependency', 'manual-operations']);
  // A number must come back a number. `answer_text` holds "4"; serving that
  // would change the type every consumer sees.
  assert.strictEqual(record.answers['founder-dependency'], 4);
  assert.strictEqual(record.answers['manual-operations'], 2);
});

await scenario('question keys survive the round trip unchanged', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, { 'founder-dependency': 1, 'data-fragmentation': 5, '3': 'numeric key' });
  const { resolve } = authorityFor(true);
  const { record } = await resolve();
  assert.deepEqual(Object.keys(record.answers).sort(), ['3', 'data-fragmentation', 'founder-dependency']);
});

console.log('\nStatus vocabulary');

await scenario('every relational status is served in the spelling the console reads', async () => {
  const expected = {
    new: 'new', under_review: 'in-review', report_ready: 'report-ready',
    proposal_sent: 'proposal-sent', won: 'completed', lost: 'lost', archived: 'archived',
  };
  for (const [relational, console_] of Object.entries(expected)) {
    clearAll();
    insertSubmission(ORG_A, 'sub:c1', { status: relational });
    const { resolve } = authorityFor(true);
    const { record } = await resolve();
    assert.equal(record.status, console_, `${relational} was served as ${record.status}`);
  }
});

await scenario('the console filters would still find what they look for', async () => {
  // SubmissionsListPage filters on exactly these three. Emitting the relational
  // spelling would leave each counter reading zero with the rows still there.
  for (const [relational, filtered] of [['new', 'new'], ['under_review', 'in-review'], ['won', 'completed']]) {
    clearAll();
    insertSubmission(ORG_A, 'sub:c1', { status: relational });
    const { resolve } = authorityFor(true);
    const { record } = await resolve();
    assert.equal(record.status, filtered);
  }
});

console.log('\nD3 — absence is null, and the remainder survives');

await scenario('placeholder columns come back NULL, not as fake domain data', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1', { phone: null, website: null });
  insertAnswers(ORG_A, id, KV.answers);
  const { resolve } = authorityFor(true);
  const { record } = await resolve();
  assert.strictEqual(record.phone, null, 'the placeholder was written back as domain data');
  assert.strictEqual(record.website, null);
});

await scenario('metadata.kv_remainder fields survive', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, KV.answers);
  const { resolve } = authorityFor(true);
  const { record } = await resolve();
  assert.equal(record.employees, 'Not specified');
  assert.equal(record.revenue, 'Not specified');
  assert.equal(record.isRead, false);
  assert.equal(record.submittedDate, '1 Jan 2026');
});

await scenario('a remainder field cannot overwrite a modelled column', async () => {
  // The remainder is a record of what KV held for fields the schema does not
  // own — never a second opinion about one it does.
  const id = insertSubmission(ORG_A, 'sub:c1', {
    remainder: { company: 'WRONG', phone: 'Not specified', status: 'archived', answers: { forged: 1 } },
  });
  insertAnswers(ORG_A, id, KV.answers);
  const { resolve } = authorityFor(true);
  const { record } = await resolve();
  assert.equal(record.company, 'Cutover Co', 'a remainder key overwrote a modelled column');
  assert.strictEqual(record.phone, null, 'a remainder key reinstated a placeholder');
  assert.equal(record.status, 'in-review', 'a remainder key overwrote the status');
  assert.deepEqual(Object.keys(record.answers).sort(), ['founder-dependency', 'manual-operations']);
});

console.log('\nTenancy and soft deletes');

await scenario('answers are read in the submission\'s own organization only', async () => {
  const a = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, a, { 'founder-dependency': 4 });
  // Another tenant's submission, with its own answers, under a different key.
  const b = insertSubmission(ORG_B, 'sub:c2');
  insertAnswers(ORG_B, b, { 'manual-operations': 9, 'data-fragmentation': 9 });

  const { resolve } = authorityFor(true);
  const { record } = await resolve();
  assert.deepEqual(Object.keys(record.answers), ['founder-dependency']);
  assert.ok(!('manual-operations' in record.answers), 'another tenant\'s answer was reconstructed');
});

await scenario('the database refuses an answer whose organization differs from its submission', async () => {
  const a = insertSubmission(ORG_A, 'sub:c1');
  const attempt = psql(['-c',
    `BEGIN; INSERT INTO public.diagnostic_answers (organization_id, submission_id, question_key)
     VALUES ('${ORG_B}','${a}','forged'); ROLLBACK`], SCRATCH_DB);
  assert.notEqual(attempt.status, 0, 'a cross-tenant answer was accepted');
  assert.match(attempt.stderr ?? '', /foreign key|violates/i);
});

await scenario('a soft-deleted submission falls back to KV', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, KV.answers);
  run(`UPDATE public.submissions SET deleted_at = now() WHERE id = '${id}'`);
  const { resolve } = authorityFor(true);
  const { record, source } = await resolve();
  assert.equal(source, 'fallback_missing');
  assert.equal(record, KV, 'a deleted row must not be served, and must not delete the KV answer');
});

console.log('\nFallback, refusal and rollback');

await scenario('an empty relational table falls back rather than serving an absence', async () => {
  const { resolve } = authorityFor(true);
  const { record, source } = await resolve();
  assert.equal(source, 'fallback_missing');
  assert.equal(record, KV);
});

await scenario('a backfill that DROPPED answer keys is refused, not served with a gap', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1', { dropped: ['some-key'] });
  insertAnswers(ORG_A, id, { 'founder-dependency': 4 });
  const { resolve, authority } = authorityFor(true);
  const { record, source } = await resolve();
  assert.equal(source, 'fallback_missing', 'a lossy reconstruction was served');
  assert.equal(record, KV);
  assert.equal(authority.report().domains[0].fallbackMissing, 1, 'the refusal must be counted');
});

await scenario('a broken connection falls back rather than failing the request', async () => {
  insertSubmission(ORG_A, 'sub:c1');
  const broken = createPsqlClient('postgresql://nobody@127.0.0.1:1/nope');
  const { resolve } = authorityFor(true);
  const { source, record } = await resolve(async () => {
    const repo = createSubmissionRepository(broken);
    const row = await repo.getSubmissionByLegacyKey(submissionKvKey('c1'));
    if (!row) return null;
    return { row, answers: await repo.listAnswers(row.id, row.organization_id) };
  });
  assert.equal(source, 'fallback_error');
  assert.equal(record, KV);
});

await scenario('off: KV answers and the relational store is never read', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, KV.answers);
  let reads = 0;
  const { resolve } = authorityFor(false);
  const { record, source } = await resolve(async () => { reads += 1; return null; });
  assert.equal(source, 'kv');
  assert.equal(record, KV);
  assert.equal(reads, 0);
});

await scenario('the rollback is the switch, and the rows are untouched by it', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, KV.answers);
  let on = true;
  const authority = createReadAuthority({
    authoritative: () => on, deadlineMs: () => 5000,
    now: () => Date.now(), isoNow: () => new Date().toISOString(),
  });
  const once = () => authority.resolve({
    domain: 'submission', key: submissionKvKey('c1'), kv: KV, fields: SUBMISSION_FIELDS,
    loadSql: async () => {
      const repo = createSubmissionRepository(client);
      const row = await repo.getSubmissionByLegacyKey(submissionKvKey('c1'));
      if (!row) return null;
      return { row, answers: await repo.listAnswers(row.id, row.organization_id) };
    },
    toRecord: (l) => submissionRowToKvShape(l.row, l.answers),
    projectKv: projectKvSubmission, projectSql: (l) => projectSqlSubmission(l.row),
  });
  assert.equal((await once()).source, 'sql');
  on = false;
  const after = await once();
  assert.equal(after.source, 'kv');
  assert.equal(after.record, KV);
  assert.equal(scalar(`SELECT count(*) FROM public.submissions`), '1');
  assert.equal(scalar(`SELECT count(*) FROM public.diagnostic_answers`), '2');
});

console.log('\nEquivalence with what KV would have said');

await scenario('a faithful row agrees with KV on every declared field', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, KV.answers);
  const { resolve, authority } = authorityFor(true);
  await resolve();
  const [rec] = authority.report().recent;
  assert.equal(rec.source, 'sql');
  assert.equal(rec.agreedWithKv, true, `diverged on ${rec.divergentFields?.join(',')}`);
});

await scenario('a real divergence is caught on the answer that was served', async () => {
  const id = insertSubmission(ORG_A, 'sub:c1');
  insertAnswers(ORG_A, id, KV.answers);
  run(`UPDATE public.submissions SET company_name = 'Renamed Ltd' WHERE id = '${id}'`);
  const { resolve, authority, notices } = authorityFor(true);
  await resolve();
  const [rec] = authority.report().recent;
  assert.equal(rec.agreedWithKv, false);
  assert.deepEqual(rec.divergentFields, ['companyName']);
  assert.equal(notices.length, 1);
});

psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
console.log(`\n✓ ${results.length} submission cutover scenarios hold against a real PostgreSQL`);
