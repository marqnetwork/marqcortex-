#!/usr/bin/env node
/**
 * Cortex and outcome RECONCILIATION, against a real PostgreSQL.
 *
 * ── WHAT THIS ADDS THAT THE EXISTING SUITES DO NOT ─────────────────────────
 *
 * `tests/migration/*.test.ts` drive the reconcilers over `fakeSupabase.ts`,
 * which proves their ARITHMETIC: given these records and those rows, this many
 * are missing. `scripts/submission-backfill-scenarios.mjs` proves the BACKFILL
 * survives the schema. Neither proves that the reconciler's own QUERIES are
 * right — that `NOT legacy_kv_key IS NULL` excludes what the author meant, that
 * `.is('deleted_at', null)` really does drop a soft-deleted row, that a
 * `numeric` column comes back in a form the comparator accepts, or that the
 * organization filter genuinely isolates. Those are properties of PostgreSQL,
 * and a fake will agree with whatever the author believed.
 *
 * So the REAL reconcilers run here, unmodified. Only the transport is
 * substituted: `harness/postgrestOverPsql.mjs` turns the builder chain into SQL
 * and executes it. A reconciler that reached for an operator that adapter does
 * not implement fails by name rather than quietly returning wrong rows.
 *
 * ── RECONCILIATION MUST NOT WRITE ──────────────────────────────────────────
 *
 * Every run here passes NO `runId`, which is what suppresses
 * `persistReconciliationLog`. The scenarios then assert, from the database
 * itself, that the row counts are unchanged afterwards — a reconciliation that
 * repaired what it measured would report a healthy estate it had just created.
 *
 * Usage:  node scripts/reconciliation-scenarios.mjs
 *
 * Connection: `DATABASE_URL`, or the standard PG* variables. The script creates
 * and drops its own scratch database and never writes to the one named in the
 * connection string.
 *
 * Exit codes: 0 passed, 1 a scenario failed, 2 no database was reachable
 * (reported as BLOCKED, never as a pass).
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { createPsqlClient } from '../tests/database/harness/postgrestOverPsql.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const SCRATCH_DB = process.env.RECONCILIATION_SCENARIO_DB ?? 'cortex_reconciliation_scenarios';

const MIGRATION_STEPS = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  ['kv store foundation', join(MIGRATIONS, '20260713000000_kv_store_foundation.sql')],
  ['migration infrastructure', join(MIGRATIONS, '20260713184931_migration_infrastructure.sql')],
  ['diagnostic foundation', join(MIGRATIONS, '20260714050000_cortex_diagnostic_foundation.sql')],
];

// ── plumbing ────────────────────────────────────────────────────────────────

function baseArgs(database) {
  if (process.env.DATABASE_URL) {
    const parsed = new URL(process.env.DATABASE_URL);
    if (database) parsed.pathname = `/${database}`;
    return ['-d', parsed.toString()];
  }
  return database ? ['-d', database] : [];
}

function psql(args, database) {
  return spawnSync('psql', [...baseArgs(database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

function scratchUrl() {
  if (process.env.DATABASE_URL) {
    const parsed = new URL(process.env.DATABASE_URL);
    parsed.pathname = `/${SCRATCH_DB}`;
    return parsed.toString();
  }
  return SCRATCH_DB;
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const probe = psql(['-c', 'SELECT 1']);
if (probe.error?.code === 'ENOENT') {
  console.error(
    'BLOCKED: psql is not on PATH. Cortex/outcome reconciliation verification needs a real ' +
      'PostgreSQL 15+. NOT RUN is not a pass.',
  );
  process.exit(2);
}
if (probe.status !== 0) {
  console.error(
    'BLOCKED: no reachable PostgreSQL. Set DATABASE_URL or the PG* variables. ' +
      'NOT RUN is not a pass.',
  );
  console.error((probe.stderr ?? '').trim());
  process.exit(2);
}

psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
const created = psql(['-c', `CREATE DATABASE ${SCRATCH_DB}`]);
if (created.status !== 0) fail(`could not create ${SCRATCH_DB}:\n${created.stderr}`);

console.log(`\nReconciliation scenarios — scratch database "${SCRATCH_DB}"`);
for (const [label, file] of MIGRATION_STEPS) {
  const run = psql(['-f', file], SCRATCH_DB);
  if (run.status !== 0) {
    psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
    fail(`${label}\n${(run.stderr ?? '').trim()}`);
  }
}
console.log(`  ✓ schema applied (${MIGRATION_STEPS.length} steps)`);

const client = createPsqlClient(scratchUrl());
const sql = (text) => {
  const run = psql(['-c', text], SCRATCH_DB);
  if (run.status !== 0) fail(`SQL failed:\n${text}\n${(run.stderr ?? '').trim()}`);
  return run.stdout;
};
const scalar = (text) => {
  const run = spawnSync(
    'psql',
    [...baseArgs(SCRATCH_DB), '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-t', '-c', text],
    { encoding: 'utf8', env: process.env },
  );
  if (run.status !== 0) fail(`SQL failed:\n${text}\n${(run.stderr ?? '').trim()}`);
  return run.stdout.trim();
};

const lit = (value) =>
  value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;
const json = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

// ── the two organizations every scenario runs against ───────────────────────

sql(`INSERT INTO public.organizations (slug, name) VALUES ('recon-a', 'Recon A'), ('recon-b', 'Recon B')`);
const ORG_A = scalar(`SELECT id FROM public.organizations WHERE slug = 'recon-a'`);
const ORG_B = scalar(`SELECT id FROM public.organizations WHERE slug = 'recon-b'`);

function reset() {
  sql(`TRUNCATE public.domain_scores, public.outcomes, public.submissions, public.kv_store_324f4fbe CASCADE`);
}

function putKv(key, value) {
  sql(`INSERT INTO public.kv_store_324f4fbe (key, value) VALUES (${lit(key)}, ${json(value)})`);
}

function putSubmission(orgId, legacyKey, { deleted = false } = {}) {
  sql(
    `INSERT INTO public.submissions (organization_id, legacy_kv_key, company_name, contact_email, deleted_at)
     VALUES (${lit(orgId)}, ${lit(legacyKey)}, 'Recon Co', 'recon@example.test', ${deleted ? 'now()' : 'NULL'})`,
  );
  return scalar(`SELECT id FROM public.submissions WHERE legacy_kv_key = ${lit(legacyKey)} AND organization_id = ${lit(orgId)}`);
}

function putOutcome(orgId, legacyKey, { converted = true, conversionValue = 1000, lostReason = null, recordedAt = '2026-01-01T00:00:00.000Z', deleted = false } = {}) {
  const submissionId = scalar(
    `SELECT id FROM public.submissions WHERE legacy_kv_key = ${lit(`sub:${legacyKey.replace(/^outcome:/, '')}`)} AND organization_id = ${lit(orgId)}`,
  );
  sql(
    `INSERT INTO public.outcomes (organization_id, submission_id, legacy_kv_key, outcome_type, status, value, recorded_at, deleted_at)
     VALUES (${lit(orgId)}, ${lit(submissionId)}, ${lit(legacyKey)}, ${lit(converted ? 'won' : 'lost')}, 'closed',
             ${json({ conversionValue, lostReason })}, ${lit(recordedAt)}, ${deleted ? 'now()' : 'NULL'})`,
  );
}

function putDomainScores(orgId, submissionId, scores) {
  for (const [domainKey, score] of Object.entries(scores)) {
    sql(
      `INSERT INTO public.domain_scores (organization_id, submission_id, domain_key, score)
       VALUES (${lit(orgId)}, ${lit(submissionId)}, ${lit(domainKey)}, ${Number(score)})`,
    );
  }
}

const outcomeKv = (submissionId, overrides = {}) => ({
  submissionId,
  didConvert: true,
  conversionValue: 1000,
  loggedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** 0–5 heatmap, which the normalizer scales to the column's 0–100. */
const cortexKv = (overrides = {}) => ({
  pillarHeatmap: {
    operationsExecution: 4,
    revenueGrowth: 3,
    systemsAutomation: 5,
    aiReadinessGovernance: 2,
    ...(overrides.pillarHeatmap ?? {}),
  },
});
const SCALED = { operations_execution: 80, revenue_growth: 60, systems_automation: 100, ai_readiness_governance: 40 };

// ── the reconcilers, exactly as production calls them ───────────────────────

const { OUTCOME_RECONCILER } = await import('../supabase/functions/server/migration/reconcilers.ts');
const { reconcileByLegacyKey } = await import('../supabase/functions/server/migration/domainReconciliation.ts');
const { reconcileCortexDomain } = await import('../supabase/functions/server/migration/cortexReconciliation.ts');
const { createKvReader } = await import('../supabase/functions/server/migration/kvReader.ts');

/**
 * Every reconcile call, with the no-mutation check wrapped around IT rather
 * than around the scenario — the seeding is supposed to write, the
 * reconciliation is not. No `runId` is passed, which is what suppresses
 * `persistReconciliationLog`; this asserts that suppression actually holds.
 */
function snapshot() {
  return scalar(
    `SELECT (SELECT count(*) FROM public.outcomes) || '/' ||
            (SELECT count(*) FROM public.domain_scores) || '/' ||
            (SELECT count(*) FROM public.submissions) || '/' ||
            (SELECT count(*) FROM public.kv_store_324f4fbe) || '/' ||
            (SELECT count(*) FROM public.migration_reconciliation_log)`,
  );
}

async function readOnly(label, run) {
  const before = snapshot();
  const result = await run();
  const after = snapshot();
  if (before !== after) fail(`${label}: reconciliation MUTATED data (${before} → ${after})`);
  return result;
}

const runOutcomes = (orgId) =>
  readOnly('outcomes', () =>
    reconcileByLegacyKey(client, createKvReader(client, {}), OUTCOME_RECONCILER, orgId, 500));
const runCortex = (orgId) =>
  readOnly('cortex', () => reconcileCortexDomain(client, createKvReader(client, {}), orgId, 500));

// ── scenarios ───────────────────────────────────────────────────────────────

const results = [];
async function scenario(name, body) {
  reset();
  try {
    await body();
  } catch (cause) {
    fail(`${name}\n${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`);
  }
  results.push(name);
  console.log(`  ✓ ${name}`);
}

console.log('\nOutcome domain');

await scenario('outcome — exact match reconciles clean', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putKv('outcome:s1', outcomeKv('s1'));
  putOutcome(ORG_A, 'outcome:s1');
  const r = await runOutcomes(ORG_A);
  assert.equal(r.sourceCount, 1);
  assert.equal(r.targetCount, 1);
  assert.equal(r.missingCount, 0);
  assert.equal(r.orphanCount, 0);
  assert.equal(r.sampleMismatchCount, 0);
  assert.equal(r.thresholdPassed, true);
});

await scenario('outcome — a missing relational row is counted and fails the threshold', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putKv('outcome:s1', outcomeKv('s1'));
  const r = await runOutcomes(ORG_A);
  assert.equal(r.sourceCount, 1);
  assert.equal(r.targetCount, 0);
  assert.equal(r.missingCount, 1);
  assert.equal(r.thresholdPassed, false);
});

await scenario('outcome — a relational row whose KV record is gone is an orphan', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putOutcome(ORG_A, 'outcome:s1');
  const r = await runOutcomes(ORG_A);
  assert.equal(r.sourceCount, 0);
  assert.equal(r.targetCount, 1);
  assert.equal(r.orphanCount, 1);
  assert.equal(r.missingCount, 0, 'an orphan is not also a miss');
});

await scenario('outcome — a field mismatch is detected and named', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putKv('outcome:s1', outcomeKv('s1', { conversionValue: 1000 }));
  putOutcome(ORG_A, 'outcome:s1', { conversionValue: 2500 });
  const r = await runOutcomes(ORG_A);
  assert.equal(r.missingCount, 0, 'the row is present — this is a FIELD failure');
  assert.equal(r.sampleMismatchCount, 1);
  assert.equal(r.details.mismatchedFields.conversionValue, 1);
  assert.equal(r.thresholdPassed, false, 'a count-only check would have passed this');
});

await scenario('outcome — the verdict itself is compared, not just the presence of a row', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putKv('outcome:s1', outcomeKv('s1', { didConvert: true }));
  putOutcome(ORG_A, 'outcome:s1', { converted: false });
  const r = await runOutcomes(ORG_A);
  assert.equal(r.sampleMismatchCount, 1);
  assert.equal(r.details.mismatchedFields.converted, 1);
});

await scenario('outcome — legacy_kv_key is GLOBALLY unique, so a key belongs to one tenant', () => {
  // Not a per-organization index. Two tenants cannot hold the same KV key at
  // all, which is a stronger isolation property than the reconciler assumes —
  // and the reason the cross-tenant scenario below is shaped the way it is.
  putSubmission(ORG_A, 'sub:s1');
  const collision = psql(
    ['-c', `INSERT INTO public.submissions (organization_id, legacy_kv_key, company_name, contact_email)
            VALUES ('${ORG_B}', 'sub:s1', 'Other Co', 'other@example.test')`],
    SCRATCH_DB,
  );
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr ?? '', /duplicate key|unique/i);
});

await scenario('outcome — a row owned by another organization is not counted or compared', async () => {
  // The KV record is the estate's; the relational row landed under ORG_B.
  putSubmission(ORG_B, 'sub:s1');
  putKv('outcome:s1', outcomeKv('s1'));
  putOutcome(ORG_B, 'outcome:s1');
  const a = await runOutcomes(ORG_A);
  assert.equal(a.targetCount, 0, 'org A must not see org B\'s row');
  assert.equal(a.missingCount, 1, 'and must report the record as unmigrated for itself');
  assert.equal(a.thresholdPassed, false);
  const b = await runOutcomes(ORG_B);
  assert.equal(b.targetCount, 1);
  assert.equal(b.missingCount, 0);
  assert.equal(b.thresholdPassed, true);
});

await scenario('outcome — a soft-deleted row is not a target row', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putKv('outcome:s1', outcomeKv('s1'));
  putOutcome(ORG_A, 'outcome:s1', { deleted: true });
  const r = await runOutcomes(ORG_A);
  assert.equal(r.targetCount, 0, '.is(deleted_at, null) must exclude it against real SQL');
  assert.equal(r.missingCount, 1);
});

await scenario('outcome — an empty string and a NULL are the same absence', async () => {
  putSubmission(ORG_A, 'sub:s1');
  // KV writes '', the normalizer maps it to null, the row stores null.
  putKv('outcome:s1', outcomeKv('s1', { didConvert: false, conversionValue: null, lostReason: '' }));
  putOutcome(ORG_A, 'outcome:s1', { converted: false, conversionValue: null, lostReason: null });
  const r = await runOutcomes(ORG_A);
  assert.equal(r.sampleMismatchCount, 0, 'normalization is not divergence');
  assert.equal(r.thresholdPassed, true);
});

await scenario('outcome — a record with no verdict is quarantined, not guessed', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putKv('outcome:s1', { submissionId: 's1', conversionValue: 10 });
  const r = await runOutcomes(ORG_A);
  assert.equal(r.classifications.quarantined, 1);
  assert.equal(r.classifications.migrated, 0);
  assert.equal(r.missingCount, 0, 'a quarantined record was deliberately not written');
});

await scenario('outcome — the database itself refuses a duplicate identity', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putOutcome(ORG_A, 'outcome:s1');
  const duplicate = psql(
    ['-c', `INSERT INTO public.outcomes (organization_id, submission_id, legacy_kv_key, outcome_type, status)
            SELECT organization_id, submission_id, legacy_kv_key, outcome_type, status FROM public.outcomes LIMIT 1`],
    SCRATCH_DB,
  );
  assert.notEqual(duplicate.status, 0, 'a second row for one submission must be refused');
  assert.match(duplicate.stderr ?? '', /duplicate key|unique/i);
  const r = await runOutcomes(ORG_A);
  assert.equal(r.duplicateCount, 0, 'zero by construction — and the construction is real');
});

console.log('\nCortex domain');

await scenario('cortex — a complete analysis reconciles clean', async () => {
  const submissionId = putSubmission(ORG_A, 'sub:s1');
  putKv('cortex:s1', cortexKv());
  putDomainScores(ORG_A, submissionId, SCALED);
  const r = await runCortex(ORG_A);
  assert.equal(r.sourceCount, 1);
  assert.equal(r.targetCount, 1);
  assert.equal(r.missingCount, 0);
  assert.equal(r.sampleMismatchCount, 0);
  assert.equal(r.thresholdPassed, true);
});

await scenario('cortex — a PARTIALLY written analysis fails, it is not three successes', async () => {
  const submissionId = putSubmission(ORG_A, 'sub:s1');
  putKv('cortex:s1', cortexKv());
  const { ai_readiness_governance: _dropped, ...partial } = SCALED;
  putDomainScores(ORG_A, submissionId, partial);
  const r = await runCortex(ORG_A);
  assert.equal(r.missingCount, 0, 'the analysis has rows, so it is not missing');
  assert.equal(r.sampleMismatchCount, 1, 'but the absent pillar is a divergence');
  assert.equal(r.details.mismatchedFields.ai_readiness_governance, 1);
  assert.equal(r.thresholdPassed, false);
});

await scenario('cortex — UNSCALED pillars are caught, not read as healthy', async () => {
  const submissionId = putSubmission(ORG_A, 'sub:s1');
  putKv('cortex:s1', cortexKv());
  // Four rows present, every one of them the raw 0–5 value.
  putDomainScores(ORG_A, submissionId, {
    operations_execution: 4, revenue_growth: 3, systems_automation: 5, ai_readiness_governance: 2,
  });
  const r = await runCortex(ORG_A);
  assert.equal(r.targetCount, 1, 'row presence alone reports this as perfectly migrated');
  assert.equal(r.sampleMismatchCount, 1);
  assert.equal(Object.keys(r.details.mismatchedFields).length, 4, 'all four pillars diverge');
  assert.equal(r.thresholdPassed, false);
});

await scenario('cortex — an analysis with no relational rows is missing', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putKv('cortex:s1', cortexKv());
  const r = await runCortex(ORG_A);
  assert.equal(r.missingCount, 1);
  assert.equal(r.details.awaitingSubmission, 0, 'the submission IS there — this is a real miss');
  assert.equal(r.thresholdPassed, false);
});

await scenario('cortex — waiting for a submission is counted apart from a lost record', async () => {
  putKv('cortex:s1', cortexKv());
  const r = await runCortex(ORG_A);
  assert.equal(r.missingCount, 1);
  assert.equal(r.details.awaitingSubmission, 1, 'an operator must be able to tell these apart');
});

await scenario('cortex — a single pillar mismatch is detected and named', async () => {
  const submissionId = putSubmission(ORG_A, 'sub:s1');
  putKv('cortex:s1', cortexKv());
  putDomainScores(ORG_A, submissionId, { ...SCALED, revenue_growth: 55 });
  const r = await runCortex(ORG_A);
  assert.equal(r.sampleMismatchCount, 1);
  assert.deepEqual(Object.keys(r.details.mismatchedFields), ['revenue_growth']);
});

await scenario('cortex — domain scores with no KV analysis are orphans', async () => {
  const submissionId = putSubmission(ORG_A, 'sub:s1');
  putDomainScores(ORG_A, submissionId, SCALED);
  const r = await runCortex(ORG_A);
  assert.equal(r.sourceCount, 0);
  assert.equal(r.orphanCount, 1);
  assert.equal(r.missingCount, 0);
});

await scenario('cortex — an analysis with no readable pillar is skipped, not claimed', async () => {
  putSubmission(ORG_A, 'sub:s1');
  putKv('cortex:s1', { pillarHeatmap: { operationsExecution: 99 } });
  const r = await runCortex(ORG_A);
  assert.equal(r.classifications.skipped, 1);
  assert.equal(r.classifications.migrated, 0);
  assert.equal(r.missingCount, 0, 'nothing was owed, so nothing is missing');
});

await scenario('cortex — another organization\'s scores are not attributed', async () => {
  // `legacy_kv_key` is globally unique, so the submission this analysis names
  // exists under ORG_B only. ORG_A must not borrow either it or its scores.
  const otherSubmission = putSubmission(ORG_B, 'sub:s1');
  putKv('cortex:s1', cortexKv());
  putDomainScores(ORG_B, otherSubmission, SCALED);
  const a = await runCortex(ORG_A);
  assert.equal(a.targetCount, 0, 'org A must not borrow org B\'s scores');
  assert.equal(a.missingCount, 1);
  assert.equal(a.details.awaitingSubmission, 1, 'from org A the submission is simply not there');
  const b = await runCortex(ORG_B);
  assert.equal(b.targetCount, 1);
  assert.equal(b.missingCount, 0);
  assert.equal(b.thresholdPassed, true);
});

await scenario('cortex — a soft-deleted submission takes its analysis out of scope', async () => {
  const submissionId = putSubmission(ORG_A, 'sub:s1');
  putDomainScores(ORG_A, submissionId, SCALED);
  sql(`UPDATE public.submissions SET deleted_at = now() WHERE id = ${lit(submissionId)}`);
  putKv('cortex:s1', cortexKv());
  const r = await runCortex(ORG_A);
  assert.equal(r.details.awaitingSubmission, 1, 'the submission is no longer visible');
  assert.equal(r.orphanCount, 0, 'and its scores cannot be attributed either way');
});

psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
console.log(`\n✓ ${results.length} cortex and outcome reconciliation scenarios hold against a real PostgreSQL`);
