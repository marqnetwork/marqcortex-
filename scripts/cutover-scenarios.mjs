#!/usr/bin/env node
/**
 * The Phase 5 cutover (MCV2-S8.1), against a real PostgreSQL.
 *
 * The module suite proves the authority's ARITHMETIC over stubs. This proves
 * the thing that actually decides a rollout: that with the switch on, a REAL
 * relational row loaded through the REAL repository answers a request — and
 * that every way the relational store can be unready still serves KV.
 *
 * The failure this exists to prevent is specific. A cutover is switched on
 * during a backfill, when some rows are there and some are not. If "not there
 * yet" reached a customer as an absence, the rollout would delete records that
 * were never lost. So the missing-row path is exercised against a real empty
 * table rather than a stubbed `null`.
 *
 * Only the transport is substituted — `harness/postgrestOverPsql.mjs` — so the
 * repository's own query runs as SQL.
 *
 * Usage:  node scripts/cutover-scenarios.mjs
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
const SCRATCH_DB = process.env.CUTOVER_SCENARIO_DB ?? 'cortex_cutover_scenarios';

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
    encoding: 'utf8',
    env: process.env,
  });
const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

if (psql(['-c', 'SELECT 1']).status !== 0) {
  console.error('BLOCKED: no reachable PostgreSQL. NOT RUN is not a pass.');
  process.exit(2);
}
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
if (psql(['-c', `CREATE DATABASE ${SCRATCH_DB}`]).status !== 0) fail('could not create scratch db');
console.log(`\nCutover scenarios — "${SCRATCH_DB}"`);
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
  const r = spawnSync(
    'psql',
    [...baseArgs(SCRATCH_DB), '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-t', '-c', text],
    { encoding: 'utf8', env: process.env },
  );
  if (r.status !== 0) fail(`SQL failed:\n${text}\n${(r.stderr ?? '').trim()}`);
  return r.stdout.trim();
};

const client = createPsqlClient(scratchUrl());

const { createReadAuthority } = await import(
  '../supabase/functions/server/storage/readAuthority.ts'
);
const { createOutcomeRepository } = await import(
  '../supabase/functions/server/repositories/outcomeRepository.ts'
);
const { OUTCOME_FIELDS, outcomeKvKey, projectKvOutcome, projectSqlOutcome } = await import(
  '../supabase/functions/server/storage/outcomeProjection.ts'
);

// ── fixture ─────────────────────────────────────────────────────────────────

run(`INSERT INTO public.organizations (slug, name) VALUES ('cutover','Cutover Co')`);
const ORG = scalar(`SELECT id FROM public.organizations WHERE slug='cutover'`);
run(`INSERT INTO public.submissions (organization_id, company_name, contact_email, legacy_kv_key)
     VALUES ('${ORG}','Cutover Co','c@t.test','sub:c1')`);
const SUBMISSION = scalar(`SELECT id FROM public.submissions WHERE legacy_kv_key='sub:c1'`);

const KV_OUTCOME = {
  submissionId: 'c1',
  didConvert: true,
  conversionValue: 1000,
  lostReason: null,
  loggedAt: '2026-01-01T00:00:00.000Z',
};

function insertOutcome({ converted = true, conversionValue = 1000 } = {}) {
  run(`INSERT INTO public.outcomes (organization_id, submission_id, legacy_kv_key, outcome_type, status, value, recorded_at)
       VALUES ('${ORG}','${SUBMISSION}','outcome:c1','${converted ? 'won' : 'lost'}','closed',
               '${JSON.stringify({ conversionValue, lostReason: null })}'::jsonb,
               '2026-01-01T00:00:00.000Z')`);
}
const clearOutcomes = () => run(`DELETE FROM public.outcomes`);

/** The authority, over the REAL repository and the REAL database. */
function authorityFor(on, { deadlineMs = 5000 } = {}) {
  const notices = [];
  const authority = createReadAuthority({
    authoritative: () => on,
    deadlineMs: () => deadlineMs,
    now: () => Date.now(),
    isoNow: () => new Date().toISOString(),
    onNotice: (record) => notices.push(record),
  });
  const resolve = (kv = KV_OUTCOME, loadSql) =>
    authority.resolve({
      domain: 'outcome',
      key: outcomeKvKey('c1'),
      kv,
      fields: OUTCOME_FIELDS,
      loadSql:
        loadSql ??
        (() => createOutcomeRepository(client).getOutcomeByLegacyKey(outcomeKvKey('c1'))),
      toRecord: (row) => row,
      projectKv: projectKvOutcome,
      projectSql: projectSqlOutcome,
    });
  return { authority, resolve, notices };
}

const results = [];
async function scenario(name, body) {
  clearOutcomes();
  try {
    await body();
  } catch (cause) {
    fail(`${name}\n${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`);
  }
  results.push(name);
  console.log(`  ✓ ${name}`);
}

console.log('\nSwitch off — the deployment every customer is on today');

await scenario('off: KV answers, and the database is never touched', async () => {
  insertOutcome();
  let reads = 0;
  const { resolve } = authorityFor(false);
  const result = await resolve(KV_OUTCOME, () => {
    reads += 1;
    return Promise.resolve(null);
  });
  assert.equal(result.source, 'kv');
  assert.equal(result.record, KV_OUTCOME, 'the KV record must come back by identity');
  assert.equal(reads, 0, 'a row exists in SQL and it was still not read');
});

console.log('\nSwitch on — a real row, through the real repository');

await scenario('on: a real relational row answers the request', async () => {
  insertOutcome();
  const { resolve, authority } = authorityFor(true);
  const result = await resolve();
  assert.equal(result.source, 'sql', 'the relational row did not answer');
  assert.equal(result.record.legacy_kv_key, 'outcome:c1');
  assert.equal(result.record.outcome_type, 'won');
  const [record] = authority.report().recent;
  assert.equal(record.agreedWithKv, true, 'the served row disagreed with KV');
});

await scenario('on: a real DIVERGENCE between the stores is caught on the served answer', async () => {
  insertOutcome({ conversionValue: 2500 });
  const { resolve, authority, notices } = authorityFor(true);
  const result = await resolve();
  assert.equal(result.source, 'sql');
  const [record] = authority.report().recent;
  assert.equal(record.agreedWithKv, false);
  assert.deepEqual(record.divergentFields, ['conversionValue']);
  assert.equal(notices.length, 1, 'a divergence on a served answer must raise a notice');
});

await scenario('on: the verdict itself is compared, not just the presence of a row', async () => {
  insertOutcome({ converted: false });
  const { resolve, authority } = authorityFor(true);
  await resolve();
  const [record] = authority.report().recent;
  assert.equal(record.agreedWithKv, false);
  assert.deepEqual(record.divergentFields, ['converted']);
});

console.log('\nSwitch on, relational store not ready — the rollout states');

await scenario('on: an empty relational table falls back to KV, it does not serve an absence', async () => {
  // No insertOutcome(). This is the state during a backfill, and the one that
  // would silently delete records if fallback were optional.
  const { resolve, authority } = authorityFor(true);
  const result = await resolve();
  assert.equal(result.source, 'fallback_missing');
  assert.equal(result.record, KV_OUTCOME, 'a live record was presented as deleted');
  assert.equal(authority.report().domains[0].fallbackMissing, 1);
});

await scenario('on: a soft-deleted relational row is a fallback, not an answer', async () => {
  insertOutcome();
  run(`UPDATE public.outcomes SET deleted_at = now() WHERE legacy_kv_key = 'outcome:c1'`);
  const { resolve } = authorityFor(true);
  const result = await resolve();
  assert.equal(result.source, 'fallback_missing');
  assert.equal(result.record, KV_OUTCOME);
});

await scenario('on: a broken database connection falls back rather than failing the request', async () => {
  insertOutcome();
  const broken = createPsqlClient('postgresql://nobody@127.0.0.1:1/does_not_exist');
  const { resolve } = authorityFor(true);
  const result = await resolve(KV_OUTCOME, () =>
    createOutcomeRepository(broken).getOutcomeByLegacyKey(outcomeKvKey('c1')),
  );
  assert.equal(result.source, 'fallback_error');
  assert.equal(result.record, KV_OUTCOME, 'the request must still be answered');
});

await scenario('on: a slow relational read falls back at the deadline', async () => {
  insertOutcome();
  const { resolve } = authorityFor(true, { deadlineMs: 10 });
  const result = await resolve(
    KV_OUTCOME,
    () => new Promise((settle) => setTimeout(() => settle({ slow: true }), 300)),
  );
  assert.equal(result.source, 'fallback_timeout');
  assert.equal(result.record, KV_OUTCOME);
});

console.log('\nRollback');

await scenario('the rollback is the switch, and it takes effect on the next read', async () => {
  insertOutcome();
  let on = true;
  const notices = [];
  const authority = createReadAuthority({
    authoritative: () => on,
    deadlineMs: () => 5000,
    now: () => Date.now(),
    isoNow: () => new Date().toISOString(),
    onNotice: (record) => notices.push(record),
  });
  const once = () =>
    authority.resolve({
      domain: 'outcome',
      key: outcomeKvKey('c1'),
      kv: KV_OUTCOME,
      fields: OUTCOME_FIELDS,
      loadSql: () => createOutcomeRepository(client).getOutcomeByLegacyKey(outcomeKvKey('c1')),
      toRecord: (row) => row,
      projectKv: projectKvOutcome,
      projectSql: projectSqlOutcome,
    });

  assert.equal((await once()).source, 'sql');
  on = false;
  const after = await once();
  assert.equal(after.source, 'kv', 'the rollback did not take effect on the next read');
  assert.equal(after.record, KV_OUTCOME);
  // No deploy happened between those two reads, and no row moved.
  assert.equal(scalar(`SELECT count(*) FROM public.outcomes`), '1');
});

await scenario('the rollout report is what an operator reads to decide', async () => {
  const { resolve, authority } = authorityFor(true);
  await resolve();                       // fallback_missing — table is empty
  insertOutcome();
  await resolve();                       // sql, agreed
  clearOutcomes();
  insertOutcome({ conversionValue: 7 });
  await resolve();                       // sql, diverged

  const [summary] = authority.report().domains;
  assert.equal(summary.total, 3);
  assert.equal(summary.servedBySql, 2);
  assert.equal(summary.fallbackMissing, 1);
  assert.equal(summary.sqlAgreed, 1);
  assert.equal(summary.sqlDiverged, 1);
  const serialized = JSON.stringify(authority.report());
  assert.doesNotMatch(serialized, /\b7\b(?!\d)|2500/, 'a customer value reached the report');
});

psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
console.log(`\n✓ ${results.length} cutover scenarios hold against a real PostgreSQL`);
