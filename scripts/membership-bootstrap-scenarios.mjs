#!/usr/bin/env node
/**
 * Empirical membership bootstrap + rollback scenarios, against a real Postgres.
 *
 * This runner exists because the static suite cannot answer the questions that
 * matter. `tests/database/static_membership_bootstrap_migration.test.ts` reads
 * the migration as text and proves what it does not contain; it cannot prove
 * that a soft-deleted member stays out, that a rollback spares a membership an
 * administrator created afterwards, or that a second run inserts nothing. Those
 * are statements about rows, and only a database can settle them.
 *
 * It runs the REAL files — `supabase/migrations/…` and
 * `supabase/migrations/rollbacks/…` — never a copy. A harness that re-typed the
 * migration would be testing the harness.
 *
 * Sequence:
 *
 *   1. platform stub (auth schema, roles, auth.uid/jwt)
 *   2. tenancy foundation + RLS/seed migrations
 *   3. fixture: eligible, ineligible, and already-decided users
 *   4. THE BOOTSTRAP           -> assertions, and a demonstration that the
 *                                 rollback heuristic H1 replaced would have
 *                                 revoked memberships it never created
 *   5. THE BOOTSTRAP AGAIN     -> idempotency assertions
 *   6. mutate: a late joiner, and an administrator re-roling a bootstrap row
 *   7. THE ROLLBACK, twice     -> H1's five properties, and idempotency
 *   8. THE BOOTSTRAP a third time -> no silent re-admission
 *
 * Then a second, independent scratch database for the concurrency phase, where
 * several copies of the bootstrap run against the same clean fixture at the
 * same time.
 *
 * Usage:
 *   node scripts/membership-bootstrap-scenarios.mjs
 *
 * Connection: `DATABASE_URL`, or the standard PG* environment variables. The
 * script creates and drops its own scratch database (`MEMBERSHIP_SCENARIO_DB`,
 * default `cortex_membership_scenarios`), so it never writes to the database
 * named in the connection string.
 *
 * Exit codes: 0 all scenarios passed, 1 a scenario failed, 2 no database was
 * reachable. Two is distinct from one on purpose — "not run" must never be
 * reported as "passed".
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DB = process.env.MEMBERSHIP_SCENARIO_DB ?? 'cortex_membership_scenarios';

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** The bootstrap and its rollback, by their real paths. */
const BOOTSTRAP = join(MIGRATIONS, '20260818120000_marq_team_membership_bootstrap.sql');
const ROLLBACK = join(MIGRATIONS, 'rollbacks', '20260818120000_rollback_membership_bootstrap.sql');

const STEPS = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  ['fixture', join(HARNESS, '10_membership_fixture.sql')],
  ['bootstrap (run 1)', BOOTSTRAP],
  ['assert bootstrap', join(HARNESS, '20_assert_bootstrap.sql')],
  ['assert the old heuristic was unsafe', join(HARNESS, '25_assert_heuristic_was_unsafe.sql')],
  ['bootstrap (run 2, idempotency)', BOOTSTRAP],
  ['assert re-run', join(HARNESS, '21_assert_rerun.sql')],
  ['mutate before rollback', join(HARNESS, '30_mutate_before_rollback.sql')],
  ['rollback', ROLLBACK],
  ['assert rollback', join(HARNESS, '40_assert_rollback.sql')],
  ['rollback (run 2, idempotency)', ROLLBACK],
  ['assert rollback re-run', join(HARNESS, '41_assert_rollback_idempotent.sql')],
  ['bootstrap (run 3, after rollback)', BOOTSTRAP],
  ['assert no re-admission', join(HARNESS, '50_assert_no_readmission.sql')],
];

function psql(args, { database, input } = {}) {
  const base = process.env.DATABASE_URL
    ? ['-d', database ? withDatabase(process.env.DATABASE_URL, database) : process.env.DATABASE_URL]
    : database
      ? ['-d', database]
      : [];
  return spawnSync('psql', [...base, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    encoding: 'utf8',
    input,
    env: process.env,
  });
}

function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Preflight: is there a database at all?
// ---------------------------------------------------------------------------
const probe = psql(['-c', 'SELECT 1']);
if (probe.error?.code === 'ENOENT') {
  console.error('SKIPPED: psql is not on PATH. These scenarios need a real PostgreSQL 15+.');
  process.exit(2);
}
if (probe.status !== 0) {
  console.error('SKIPPED: no reachable PostgreSQL. Set DATABASE_URL or the PG* variables.');
  console.error((probe.stderr ?? '').trim());
  process.exit(2);
}

for (const [, file] of STEPS) {
  if (!existsSync(file)) fail(`missing SQL file: ${file}`);
}

// ---------------------------------------------------------------------------
// Scratch database, created and dropped by this script.
// ---------------------------------------------------------------------------
console.log(`membership bootstrap scenarios — scratch database "${SCRATCH_DB}"`);

const drop = psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
if (drop.status !== 0) fail(`could not drop the scratch database:\n${drop.stderr}`);

const create = psql(['-c', `CREATE DATABASE ${SCRATCH_DB}`]);
if (create.status !== 0) fail(`could not create the scratch database:\n${create.stderr}`);

const CONCURRENCY_STEPS = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  ['concurrency fixture', join(HARNESS, '11_concurrency_fixture.sql')],
];

/** How many copies of the bootstrap race each other. */
const RACERS = 4;

let failed = null;
for (const [label, file] of STEPS) {
  const run = psql(['-f', file], { database: SCRATCH_DB });
  const notices = (run.stderr ?? '')
    .split('\n')
    .filter((line) => /PASSED|membership bootstrap/i.test(line))
    .map((line) => `      ${line.trim()}`)
    .join('\n');

  if (run.status !== 0) {
    console.log(`  ✗ ${label}`);
    failed = `${label}\n${(run.stderr ?? '').trim()}`;
    break;
  }
  console.log(`  ✓ ${label}`);
  if (notices) console.log(notices);
}

psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
if (failed) fail(failed);

// ---------------------------------------------------------------------------
// Concurrency phase — L6.
//
// A separate scratch database, so the state above cannot mask a race, and real
// concurrent processes rather than a simulation: the interleaving under test is
// between the bootstrap's NOT EXISTS guard and its INSERT, and nothing running
// in one session can produce it.
// ---------------------------------------------------------------------------
const RACE_DB = `${SCRATCH_DB}_race`;
console.log(`\nconcurrency — scratch database "${RACE_DB}", ${RACERS} simultaneous bootstraps`);

psql(['-c', `DROP DATABASE IF EXISTS ${RACE_DB} WITH (FORCE)`]);
const createRace = psql(['-c', `CREATE DATABASE ${RACE_DB}`]);
if (createRace.status !== 0) fail(`could not create the concurrency database:\n${createRace.stderr}`);

for (const [label, file] of CONCURRENCY_STEPS) {
  const run = psql(['-f', file], { database: RACE_DB });
  if (run.status !== 0) {
    psql(['-c', `DROP DATABASE IF EXISTS ${RACE_DB} WITH (FORCE)`]);
    fail(`${label}\n${(run.stderr ?? '').trim()}`);
  }
  console.log(`  ✓ ${label}`);
}

const racers = await Promise.all(
  Array.from({ length: RACERS }, () => runPsqlAsync(['-f', BOOTSTRAP], RACE_DB)),
);
const losers = racers.filter((r) => r.status !== 0);
if (losers.length > 0) {
  psql(['-c', `DROP DATABASE IF EXISTS ${RACE_DB} WITH (FORCE)`]);
  fail(`${losers.length} of ${RACERS} concurrent bootstraps failed:\n${losers[0].stderr.trim()}`);
}
console.log(`  ✓ ${RACERS} concurrent bootstraps, all exited 0`);

const raceAssert = psql(['-f', join(HARNESS, '60_assert_concurrency.sql')], { database: RACE_DB });
psql(['-c', `DROP DATABASE IF EXISTS ${RACE_DB} WITH (FORCE)`]);
if (raceAssert.status !== 0) fail(`assert concurrency\n${(raceAssert.stderr ?? '').trim()}`);
console.log('  ✓ assert concurrency');

console.log('\n✓ all membership bootstrap + rollback scenarios passed');

function runPsqlAsync(args, database) {
  const base = process.env.DATABASE_URL
    ? ['-d', withDatabase(process.env.DATABASE_URL, database)]
    : ['-d', database];
  return new Promise((resolve) => {
    const child = spawn('psql', [...base, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
      env: process.env,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.resume();
    child.on('close', (status) => resolve({ status, stderr }));
  });
}
