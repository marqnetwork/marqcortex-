#!/usr/bin/env node
/**
 * The Phase 5 cutover, rehearsed end to end against a real PostgreSQL.
 *
 * The per-stage suites each prove one thing. This proves the SEQUENCE — that
 * the stages compose, in the order a deployment has to run them, on one
 * database, with the same rows carried through:
 *
 *   legacy (KV only)
 *     → backfill
 *       → reconciliation
 *         → shadow / equivalence
 *           → relational authority
 *             → rollback
 *               → relational authority again
 *
 * A rehearsal is not a slower version of the unit suites. It is the only place
 * that can catch a stage which passes alone and breaks what follows it — a
 * backfill whose rows the reconciler then calls missing, a cutover that serves
 * a document the equivalence check disagrees with, a rollback that leaves the
 * estate unable to cut over a second time.
 *
 * ROW INTEGRITY AND TENANT ISOLATION ARE CHECKED AT EVERY STAGE, not only at
 * the end: a count that drifts between two stages is the kind of thing an
 * end-state assertion cannot attribute.
 *
 * Two tenants throughout. Nothing here touches production.
 *
 * Usage:  deno run --allow-all --config supabase/functions/deno.json \
 *           --node-modules-dir=none scripts/cutover-rehearsal.mjs
 * Exit:   0 passed, 1 a stage failed, 2 no database (BLOCKED, not a pass).
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { createPsqlClient } from '../tests/database/harness/postgrestOverPsql.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const DB = process.env.CUTOVER_REHEARSAL_DB ?? 'cortex_cutover_rehearsal';

const STEPS = [
  join(HARNESS, '00_platform_stub.sql'),
  join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql'),
  join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql'),
  join(MIGRATIONS, '20260713000000_kv_store_foundation.sql'),
  join(MIGRATIONS, '20260713184931_migration_infrastructure.sql'),
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
  spawnSync('psql', [...baseArgs(database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', env: process.env });
const fail = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

if (psql(['-c', 'SELECT 1']).status !== 0) {
  console.error('BLOCKED: no reachable PostgreSQL. NOT RUN is not a pass.');
  process.exit(2);
}
psql(['-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
if (psql(['-c', `CREATE DATABASE ${DB}`]).status !== 0) fail('could not create scratch db');
console.log(`\nCutover rehearsal — "${DB}"`);
for (const file of STEPS) {
  const r = psql(['-f', file], DB);
  if (r.status !== 0) { psql(['-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]); fail(`applying ${file}\n${r.stderr}`); }
}

const run = (t) => { const r = psql(['-c', t], DB); if (r.status !== 0) fail(`SQL failed:\n${t}\n${r.stderr}`); };
const scalar = (t) => {
  const r = spawnSync('psql', [...baseArgs(DB), '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-t', '-c', t],
    { encoding: 'utf8', env: process.env });
  if (r.status !== 0) fail(`SQL failed:\n${t}\n${r.stderr}`);
  return r.stdout.trim();
};
const scratchUrl = () => {
  if (!process.env.DATABASE_URL) return DB;
  const u = new URL(process.env.DATABASE_URL); u.pathname = `/${DB}`; return u.toString();
};
const client = createPsqlClient(scratchUrl());

const { createReadAuthority } = await import('../supabase/functions/server/storage/readAuthority.ts');
const { createSubmissionRepository } = await import('../supabase/functions/server/repositories/submissionRepository.ts');
const { OUTCOME_RECONCILER } = await import('../supabase/functions/server/migration/reconcilers.ts');
const { reconcileByLegacyKey } = await import('../supabase/functions/server/migration/domainReconciliation.ts');
const { createKvReader } = await import('../supabase/functions/server/migration/kvReader.ts');
const { submissionRowToKvShape, reconstructionIsLossy } =
  await import('../supabase/functions/server/storage/submissionReadAuthority.ts');
const { SUBMISSION_FIELDS, projectKvSubmission, projectSqlSubmission, submissionKvKey } =
  await import('../supabase/functions/server/storage/submissionProjection.ts');
const { normalizeSubmissionRecord, parseSubmissionKvRecord, isQuarantined } =
  await import('../supabase/functions/server/migration/submissionNormalizer.ts');
const { normalizeOutcomeRecord, parseOutcomeKvRecord, isOutcomeQuarantined } =
  await import('../supabase/functions/server/migration/outcomeNormalizer.ts');

const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

run(`INSERT INTO public.organizations (slug, name) VALUES ('reh-a','Rehearsal A'), ('reh-b','Rehearsal B')`);
const ORG = { A: scalar(`SELECT id FROM public.organizations WHERE slug='reh-a'`),
              B: scalar(`SELECT id FROM public.organizations WHERE slug='reh-b'`) };

const stages = [];
function stage(name, body) {
  try { return body(); } catch (c) { fail(`${name}\n${c instanceof Error ? (c.stack ?? c.message) : String(c)}`); }
  finally { /* recorded by caller */ }
}
async function step(name, body) {
  try { await body(); } catch (c) { fail(`${name}\n${c instanceof Error ? (c.stack ?? c.message) : String(c)}`); }
  stages.push(name);
  console.log(`  ✓ ${name}`);
}

/** Row counts that must be explainable at every stage. */
const census = () => ({
  kv: Number(scalar(`SELECT count(*) FROM public.kv_store_324f4fbe`)),
  submissions: Number(scalar(`SELECT count(*) FROM public.submissions WHERE deleted_at IS NULL`)),
  answers: Number(scalar(`SELECT count(*) FROM public.diagnostic_answers`)),
  outcomes: Number(scalar(`SELECT count(*) FROM public.outcomes WHERE deleted_at IS NULL`)),
  orgA: Number(scalar(`SELECT count(*) FROM public.submissions WHERE organization_id='${ORG.A}' AND deleted_at IS NULL`)),
  orgB: Number(scalar(`SELECT count(*) FROM public.submissions WHERE organization_id='${ORG.B}' AND deleted_at IS NULL`)),
});

/** No child may ever sit in a different organization from its parent. */
function assertTenantIsolation(where) {
  const leaked = scalar(`
    SELECT coalesce(sum(n), 0) FROM (
      SELECT count(*) AS n FROM public.diagnostic_answers c JOIN public.submissions p ON p.id = c.submission_id
        WHERE c.organization_id IS DISTINCT FROM p.organization_id
      UNION ALL
      SELECT count(*) FROM public.outcomes c JOIN public.submissions p ON p.id = c.submission_id
        WHERE c.organization_id IS DISTINCT FROM p.organization_id
    ) t`);
  assert.equal(leaked, '0', `tenant isolation broke at: ${where}`);
}

// ── STAGE 1: LEGACY ─────────────────────────────────────────────────────────

const KV_DOCS = {
  A: { id: 'a1', company: 'Alpha Ltd', contact: 'Ann', email: 'ann@a.test', phone: 'Not specified',
       website: '', industry: 'Retail', employees: 'Not specified', isRead: false,
       submittedDate: '1 Jan 2026', status: 'in-review', priority: 'high',
       completionScore: 80, qualityScore: 75, aiScore: 62,
       submittedAt: '2026-01-01T00:00:00.000Z',
       answers: { 'founder-dependency': 4, 'manual-operations': 2 } },
  B: { id: 'b1', company: 'Beta GmbH', contact: 'Bo', email: 'bo@b.test', phone: '+49 30 1',
       website: 'https://b.test', industry: 'Logistics', isRead: true,
       submittedDate: '2 Jan 2026', status: 'completed', priority: 'medium',
       completionScore: 95, qualityScore: 90, aiScore: 88,
       submittedAt: '2026-01-02T00:00:00.000Z',
       answers: { 'data-fragmentation': 5 } },
};
const KV_OUTCOME_A = { submissionId: 'a1', didConvert: true, conversionValue: 5000,
                       loggedAt: '2026-02-01T00:00:00.000Z' };

await step('1. LEGACY — KV holds the estate and the relational plane is empty', async () => {
  run(`INSERT INTO public.kv_store_324f4fbe (key, value) VALUES
        ('sub:a1', ${json(KV_DOCS.A)}), ('sub:b1', ${json(KV_DOCS.B)}),
        ('outcome:a1', ${json(KV_OUTCOME_A)})`);
  const c = census();
  assert.equal(c.kv, 3);
  assert.equal(c.submissions, 0, 'the relational plane must start empty');
  assert.equal(c.outcomes, 0);
});

// ── STAGE 2: BACKFILL ───────────────────────────────────────────────────────

await step('2. BACKFILL — the normalizers write the relational rows', async () => {
  for (const [tenant, doc] of Object.entries(KV_DOCS)) {
    const key = submissionKvKey(doc.id);
    const raw = scalar(`SELECT value::text FROM public.kv_store_324f4fbe WHERE key = ${lit(key)}`);
    const result = normalizeSubmissionRecord(parseSubmissionKvRecord(key, JSON.parse(raw)), ORG[tenant], key);
    assert.ok(!isQuarantined(result), `${key} quarantined: ${result.reasonDetail ?? ''}`);
    const r = result.record;
    run(`INSERT INTO public.submissions
          (organization_id, legacy_kv_key, legacy_id, company_name, contact_name, contact_email,
           phone, website, industry, status, priority, completion_score, quality_score, ai_score,
           submitted_at, metadata)
         VALUES (${lit(r.organizationId)}, ${lit(r.legacyKvKey)}, ${lit(r.legacyId)},
                 ${lit(r.companyName)}, ${lit(r.contactName)}, ${lit(r.contactEmail)},
                 ${lit(r.phone)}, ${lit(r.website)}, ${lit(r.industry)}, ${lit(r.status)},
                 ${lit(r.priority)}, ${r.scores.completionScore ?? 'NULL'},
                 ${r.scores.qualityScore ?? 'NULL'}, ${r.scores.aiScore ?? 'NULL'},
                 ${lit(r.submittedAt)}, ${json(r.metadata)})`);
    const id = scalar(`SELECT id FROM public.submissions WHERE legacy_kv_key = ${lit(key)}`);
    for (const a of r.answers) {
      run(`INSERT INTO public.diagnostic_answers (organization_id, submission_id, question_key, answer_text, answer_json)
           VALUES (${lit(r.organizationId)}, ${lit(id)}, ${lit(a.questionKey)},
                   ${lit(a.answerText)}, ${json(a.answerJson)})`);
    }
  }

  const key = 'outcome:a1';
  const rawOutcome = scalar(`SELECT value::text FROM public.kv_store_324f4fbe WHERE key = ${lit(key)}`);
  const oc = normalizeOutcomeRecord(parseOutcomeKvRecord(key, JSON.parse(rawOutcome)), ORG.A, key);
  assert.ok(!isOutcomeQuarantined(oc), 'the outcome quarantined');
  const subId = scalar(`SELECT id FROM public.submissions WHERE legacy_kv_key = 'sub:a1'`);
  run(`INSERT INTO public.outcomes (organization_id, submission_id, legacy_kv_key, outcome_type, status, value, recorded_at)
       VALUES (${lit(ORG.A)}, ${lit(subId)}, ${lit(key)}, ${lit(oc.record.outcomeType)},
               ${lit(oc.record.status)}, ${json(oc.record.value)}, ${lit(oc.record.recordedAt)})`);

  const c = census();
  assert.equal(c.submissions, 2, 'the backfill did not write one row per KV document');
  assert.equal(c.answers, 3, 'answers did not migrate to rows');
  assert.equal(c.outcomes, 1);
  assert.equal(c.orgA, 1);
  assert.equal(c.orgB, 1, 'the two tenants did not stay separate through the backfill');
  assert.equal(c.kv, 3, 'the backfill mutated KV — it must only read');
  assertTenantIsolation('after backfill');
});

// ── STAGE 3: RECONCILIATION ─────────────────────────────────────────────────

await step('3. RECONCILIATION — the stores agree, per tenant', async () => {
  const before = census();
  const a = await reconcileByLegacyKey(client, createKvReader(client, {}), OUTCOME_RECONCILER, ORG.A, 500);
  assert.equal(a.missingCount, 0, 'the backfill left an outcome missing');
  assert.equal(a.orphanCount, 0);
  assert.equal(a.sampleMismatchCount, 0, `fields diverged: ${JSON.stringify(a.details.mismatchedFields)}`);
  assert.equal(a.thresholdPassed, true, 'reconciliation did not pass its own threshold');

  // Tenant B owns no outcome, and must not be credited with A's.
  const b = await reconcileByLegacyKey(client, createKvReader(client, {}), OUTCOME_RECONCILER, ORG.B, 500);
  assert.equal(b.targetCount, 0, 'tenant B was credited with another tenant\'s row');
  assert.equal(b.missingCount, 1, 'the KV record is unmigrated FOR B, and should say so');

  assert.deepEqual(census(), before, 'reconciliation mutated data');
  assertTenantIsolation('after reconciliation');
});

// ── STAGE 4: SHADOW / EQUIVALENCE ───────────────────────────────────────────

function submissionAuthority(on) {
  const notices = [];
  const authority = createReadAuthority({
    authoritative: () => on, deadlineMs: () => 5000,
    now: () => Date.now(), isoNow: () => new Date().toISOString(),
    onNotice: (r) => notices.push(r),
  });
  const resolve = (doc) => authority.resolve({
    domain: 'submission', key: submissionKvKey(doc.id), kv: doc, fields: SUBMISSION_FIELDS,
    loadSql: async () => {
      const repo = createSubmissionRepository(client);
      const row = await repo.getSubmissionByLegacyKey(submissionKvKey(doc.id));
      if (!row || reconstructionIsLossy(row)) return null;
      return { row, answers: await repo.listAnswers(row.id, row.organization_id) };
    },
    toRecord: (l) => submissionRowToKvShape(l.row, l.answers),
    projectKv: projectKvSubmission, projectSql: (l) => projectSqlSubmission(l.row),
  });
  return { authority, resolve, notices };
}

await step('4. SHADOW — the relational answer agrees with what KV would have said', async () => {
  const before = census();
  const { authority, resolve } = submissionAuthority(true);
  for (const doc of Object.values(KV_DOCS)) await resolve(doc);

  const records = authority.report().recent;
  assert.equal(records.length, 2);
  for (const r of records) {
    assert.equal(r.source, 'sql');
    assert.equal(r.agreedWithKv, true, `${r.key} diverged on ${r.divergentFields?.join(',')}`);
  }
  assert.deepEqual(census(), before, 'the equivalence pass mutated data');
});

// ── STAGE 5: RELATIONAL AUTHORITY ───────────────────────────────────────────

async function assertServedFromSql(label) {
  const { resolve } = submissionAuthority(true);
  const a = await resolve(KV_DOCS.A);
  assert.equal(a.source, 'sql', `${label}: the relational store did not answer`);
  assert.equal(a.record.company, 'Alpha Ltd');
  assert.equal(a.record.status, 'in-review', `${label}: the console vocabulary was not restored`);
  assert.strictEqual(a.record.phone, null, `${label}: a placeholder was written back as data (D3)`);
  assert.equal(a.record.employees, 'Not specified', `${label}: a remainder field was lost`);
  assert.strictEqual(a.record.answers['founder-dependency'], 4, `${label}: an answer lost its type`);

  const b = await resolve(KV_DOCS.B);
  assert.equal(b.source, 'sql');
  assert.equal(b.record.company, 'Beta GmbH');
  assert.equal(b.record.status, 'completed');
  assert.ok(!('founder-dependency' in b.record.answers), `${label}: tenant A's answer reached tenant B`);
  return { a, b };
}

await step('5. RELATIONAL AUTHORITY — SQL answers, and each tenant gets its own', async () => {
  const before = census();
  await assertServedFromSql('cutover');
  assert.deepEqual(census(), before, 'serving from SQL mutated data');
  assertTenantIsolation('under relational authority');
});

// ── STAGE 6: ROLLBACK ───────────────────────────────────────────────────────

await step('6. ROLLBACK — the switch alone returns the estate to KV', async () => {
  const before = census();
  const { resolve } = submissionAuthority(false);
  const a = await resolve(KV_DOCS.A);
  assert.equal(a.source, 'kv');
  assert.equal(a.record, KV_DOCS.A, 'the KV document must come back by identity');
  assert.equal(a.record.phone, 'Not specified', 'the legacy document is unchanged by the rollback');
  assert.deepEqual(census(), before, 'the rollback moved data — it must move none');
  assertTenantIsolation('after rollback');
});

// ── STAGE 7: FORWARD AGAIN ──────────────────────────────────────────────────

await step('7. RELATIONAL AUTHORITY AGAIN — the estate can cut over a second time', async () => {
  const before = census();
  await assertServedFromSql('second cutover');
  assert.deepEqual(census(), before, 'the second cutover mutated data');
  assertTenantIsolation('after second cutover');
});

await step('8. INTEGRITY — the census is unchanged from the end of the backfill', async () => {
  const c = census();
  assert.deepEqual(c, { kv: 3, submissions: 2, answers: 3, outcomes: 1, orgA: 1, orgB: 1 },
    'the rehearsal ended with a different estate than the backfill produced');
  // Every relational row still traceable to its KV origin.
  assert.equal(scalar(`SELECT count(*) FROM public.submissions WHERE legacy_kv_key IS NULL`), '0');
  assert.equal(scalar(`SELECT count(*) FROM public.outcomes WHERE legacy_kv_key IS NULL`), '0');
});

psql(['-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
void stage;
console.log(`\n✓ the full cutover sequence rehearses cleanly (${stages.length} stages)`);
