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
 *   9. THE LIFECYCLE MIGRATION -> the real sync/revoke functions, driven over
 *                                 the bootstrap's own rows (HIGH-1, MED-1), and
 *                                 the roster stamping artifact (HIGH-3)
 *
 * Then three more independent scratch databases:
 *
 *   - concurrency: several copies of the bootstrap racing on a clean fixture
 *   - MED-2 (a):   the seeded role catalog missing `org_admin`. The bootstrap
 *                  must FAIL and leave nothing behind
 *   - MED-2 (b):   a write that silently drops one candidate. Same requirement,
 *                  reached through the post-write accounting assertion
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
const LIFECYCLE = join(MIGRATIONS, '20260818130000_marq_membership_lifecycle.sql');
const RECOVERY = join(MIGRATIONS, '20260819120000_marq_authority_recovery.sql');
const RECOVERY_ROLLBACK = join(
  MIGRATIONS, 'rollbacks', '20260819120000_rollback_authority_recovery.sql',
);

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

/** The migrations every scratch database starts from. */
const BASE_STEPS = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
];

const CONCURRENCY_STEPS = [
  ...BASE_STEPS,
  ['concurrency fixture', join(HARNESS, '11_concurrency_fixture.sql')],
];

/**
 * The lifecycle phase, on its own database.
 *
 * It starts from a freshly bootstrapped deployment rather than from the tail of
 * the rollback sequence above: the questions are "what does a demotion do to a
 * membership the bootstrap created" and "what does an invite create", and both
 * need that membership to still be live. Running them after the rollback would
 * have answered a different question with the same assertions.
 */
const LIFECYCLE_STEPS = [
  ...BASE_STEPS,
  ['fixture', join(HARNESS, '10_membership_fixture.sql')],
  ['bootstrap', BOOTSTRAP],
  ['membership lifecycle migration', LIFECYCLE],
  ['assert lifecycle (HIGH-1, MED-1)', join(HARNESS, '70_assert_lifecycle.sql')],
  ['assert roster stamping (HIGH-3)', join(HARNESS, '75_assert_roster_stamping.sql')],
  ['authority recovery migration', RECOVERY],
  ['assert authority recovery (L1, L2, L3, L4)', join(HARNESS, '85_assert_authority_recovery.sql')],
  ['authority recovery rollback', RECOVERY_ROLLBACK],
  ['assert recovery rollback', join(HARNESS, '86_assert_recovery_rollback.sql')],
];

/**
 * MED-2. Each phase applies its fixture and then expects the REAL bootstrap to
 * exit NON-ZERO — a silent short admission is the defect, so "it ran fine" is
 * the failure this asserts against.
 */
const FAILURE_PHASES = [
  {
    label: 'MED-2 (a): a role missing from the seeded catalog',
    database: 'med2_missing_role',
    fixture: join(HARNESS, '80_med2_missing_role_fixture.sql'),
    assertion: join(HARNESS, '81_assert_med2_no_partial_state.sql'),
    expect: /system role catalog is missing/i,
  },
  {
    label: 'MED-2 (b): a write that silently drops a candidate',
    database: 'med2_silent_drop',
    fixture: join(HARNESS, '82_med2_silent_drop_fixture.sql'),
    assertion: join(HARNESS, '83_assert_med2_silent_drop.sql'),
    expect: /neither admitted nor already decided/i,
  },
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

for (const [, file] of [...STEPS, ...CONCURRENCY_STEPS, ...LIFECYCLE_STEPS]) {
  if (!existsSync(file)) fail(`missing SQL file: ${file}`);
}
for (const phase of FAILURE_PHASES) {
  for (const file of [phase.fixture, phase.assertion]) {
    if (!existsSync(file)) fail(`missing SQL file: ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Scratch database, created and dropped by this script.
// ---------------------------------------------------------------------------
console.log(`membership bootstrap scenarios — scratch database "${SCRATCH_DB}"`);

const drop = psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
if (drop.status !== 0) fail(`could not drop the scratch database:\n${drop.stderr}`);

const create = psql(['-c', `CREATE DATABASE ${SCRATCH_DB}`]);
if (create.status !== 0) fail(`could not create the scratch database:\n${create.stderr}`);

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

// ---------------------------------------------------------------------------
// LIFECYCLE — HIGH-1, MED-1 and HIGH-3, against the real functions.
// ---------------------------------------------------------------------------
const LIFECYCLE_DB = `${SCRATCH_DB}_lifecycle`;
console.log(`\nmembership lifecycle — scratch database "${LIFECYCLE_DB}"`);

psql(['-c', `DROP DATABASE IF EXISTS ${LIFECYCLE_DB} WITH (FORCE)`]);
const createLifecycle = psql(['-c', `CREATE DATABASE ${LIFECYCLE_DB}`]);
if (createLifecycle.status !== 0) fail(`could not create the lifecycle database:\n${createLifecycle.stderr}`);

for (const [label, file] of LIFECYCLE_STEPS) {
  const run = psql(['-f', file], { database: LIFECYCLE_DB });
  const notices = (run.stderr ?? '')
    .split('\n')
    .filter((line) => /PASSED/i.test(line))
    .map((line) => `      ${line.trim()}`)
    .join('\n');
  if (run.status !== 0) {
    psql(['-c', `DROP DATABASE IF EXISTS ${LIFECYCLE_DB} WITH (FORCE)`]);
    fail(`${label}\n${(run.stderr ?? '').trim()}`);
  }
  console.log(`  ✓ ${label}`);
  if (notices) console.log(notices);
}
psql(['-c', `DROP DATABASE IF EXISTS ${LIFECYCLE_DB} WITH (FORCE)`]);

// ---------------------------------------------------------------------------
// MED-2 — the bootstrap must FAIL rather than admit fewer people than it should.
//
// Each phase gets its own scratch database, because the property under test is
// what the migration does to a clean database with a broken precondition, and
// state left by an earlier phase could satisfy the assertion for the wrong
// reason.
// ---------------------------------------------------------------------------
for (const phase of FAILURE_PHASES) {
  const db = `${SCRATCH_DB}_${phase.database}`;
  console.log(`\n${phase.label} — scratch database "${db}"`);

  psql(['-c', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
  const created = psql(['-c', `CREATE DATABASE ${db}`]);
  if (created.status !== 0) fail(`could not create ${db}:\n${created.stderr}`);

  const teardown = () => psql(['-c', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);

  for (const [label, file] of [...BASE_STEPS, ['fixture', phase.fixture]]) {
    const run = psql(['-f', file], { database: db });
    if (run.status !== 0) {
      teardown();
      fail(`${phase.label} / ${label}\n${(run.stderr ?? '').trim()}`);
    }
    console.log(`  ✓ ${label}`);
  }

  const attempt = psql(['-f', BOOTSTRAP], { database: db });
  if (attempt.status === 0) {
    teardown();
    fail(`${phase.label}: the bootstrap SUCCEEDED. A short admission must fail loudly.`);
  }
  if (!phase.expect.test(attempt.stderr ?? '')) {
    teardown();
    fail(
      `${phase.label}: the bootstrap failed for the wrong reason.\n` +
        `expected /${phase.expect.source}/\ngot:\n${(attempt.stderr ?? '').trim()}`,
    );
  }
  console.log('  ✓ the bootstrap refused, and named the reason');

  const assertion = psql(['-f', phase.assertion], { database: db });
  teardown();
  if (assertion.status !== 0) fail(`${phase.label} / assertion\n${(assertion.stderr ?? '').trim()}`);
  console.log('  ✓ nothing was left behind');
}

console.log('\n✓ all membership bootstrap + lifecycle + rollback scenarios passed');

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
