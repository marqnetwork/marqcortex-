#!/usr/bin/env node
/**
 * EXECUTABLE verification of the AI-01 Batch 4C provider administration
 * migration, against a real PostgreSQL.
 *
 * WHY THIS EXISTS.
 *
 * Batch 4C shipped with `tests/database/static_ai_provider_administration_migration.test.ts`
 * and nothing else. That test reads the migration as TEXT. It reported the
 * migration healthy while the file contained two CHECK constraints with one
 * name — which PostgreSQL rejects outright, so the migration could not be
 * applied anywhere — and while the file granted `service_role` nothing at all,
 * so every runtime operation would have failed with `permission denied`.
 *
 * A text scan proves ABSENCE well and BEHAVIOUR not at all. Both defects were
 * behaviour. This runner asks the database instead, and it runs the REAL files
 * under `supabase/migrations/…` — never a copy, because a harness that re-typed
 * the migration would be testing the harness.
 *
 * It follows the pattern `scripts/membership-bootstrap-scenarios.mjs`
 * established: scratch databases this script creates and drops, the real
 * migration files as steps, SQL assertion files under `tests/database/harness/`,
 * and exit code 2 reserved for "no database was reachable" so that NOT RUN can
 * never be read as PASSED.
 *
 * ── THE THREE PHASES ──────────────────────────────────────────────────────
 *
 *  1. APPLY    the real 4C migration onto the real tenancy foundation, then
 *              prove the schema, the runtime lifecycle under `service_role`,
 *              activation atomicity, and the privilege matrix.
 *
 *  2. ROLLBACK the real rollback file, then prove 4C is gone and nothing else
 *              went with it. Then RE-APPLY, because a migration that cannot be
 *              applied twice around its own rollback is a migration nobody can
 *              safely reverse in staging.
 *
 *  3. FAILURE  a fresh database where an obstacle is planted so the migration
 *              fails at its LAST statement, then prove no partial 4C schema
 *              state survives.
 *
 * ── ONE DELIBERATE CHOICE ABOUT ROLES ─────────────────────────────────────
 *
 * The migrations are applied as `cortex_migration_owner` — NOSUPERUSER, with
 * BYPASSRLS — rather than as the cluster superuser. `ai_provider_credential_activate`
 * is SECURITY DEFINER and writes through `FORCE ROW LEVEL SECURITY`, so a
 * superuser owner would sail through a check a deployment's owner has to pass.
 * See `tests/database/harness/05_4c_migration_owner.sql`.
 *
 * Usage:
 *   node scripts/ai-provider-administration-scenarios.mjs
 *
 * Connection: `DATABASE_URL`, or the standard PG* environment variables. The
 * script creates and drops its own scratch databases, so it never writes to the
 * database named in the connection string.
 *
 * Exit codes: 0 all scenarios passed, 1 a scenario failed, 2 no database was
 * reachable (reported as BLOCKED, never as a pass).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DB = process.env.PROVIDER_ADMIN_SCENARIO_DB ?? 'cortex_4c_provider_admin';

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** The real files. Named once, used everywhere below. */
const PLATFORM_STUB = join(HARNESS, '00_platform_stub.sql');
const MIGRATION_OWNER = join(HARNESS, '05_4c_migration_owner.sql');
const TENANCY = join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql');
const TENANCY_RLS = join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql');
const PROVIDER_ADMIN = join(MIGRATIONS, '20260828120000_ai_provider_administration.sql');
const PROVIDER_ADMIN_ROLLBACK = join(
  MIGRATIONS, 'rollbacks', '20260828120000_rollback_ai_provider_administration.sql',
);

/**
 * A step is [label, file, role].
 *
 * `role` is the role the file is executed as. `owner` means the NOSUPERUSER
 * migration role; `session` means the connection's own role, which the
 * assertion files need so they can `SET ROLE` into anon, authenticated and
 * service_role in turn.
 */
const APPLY_STEPS = [
  ['platform stub', PLATFORM_STUB, 'session'],
  ['migration owner role', MIGRATION_OWNER, 'session'],
  ['tenancy foundation', TENANCY, 'owner'],
  ['tenancy RLS and seed', TENANCY_RLS, 'owner'],
  ['THE 4C MIGRATION', PROVIDER_ADMIN, 'owner'],
  ['assert 4C schema', join(HARNESS, '93_assert_4c_schema.sql'), 'session'],
  ['assert 4C runtime lifecycle (service_role)',
   join(HARNESS, '94_assert_4c_runtime_lifecycle.sql'), 'session'],
  ['assert 4C activation atomicity',
   join(HARNESS, '94b_assert_4c_activation_atomicity.sql'), 'session'],
  ['assert 4C privileges', join(HARNESS, '95_assert_4c_privileges.sql'), 'session'],
];

const ROLLBACK_STEPS = [
  ['THE 4C ROLLBACK', PROVIDER_ADMIN_ROLLBACK, 'owner'],
  ['assert 4C rollback', join(HARNESS, '96_assert_4c_rollback.sql'), 'session'],
  // A migration that cannot be re-applied around its own rollback is a
  // migration nobody can safely reverse in staging.
  ['THE 4C MIGRATION (re-apply after rollback)', PROVIDER_ADMIN, 'owner'],
  ['assert 4C schema again', join(HARNESS, '93_assert_4c_schema.sql'), 'session'],
  ['assert 4C privileges again', join(HARNESS, '95_assert_4c_privileges.sql'), 'session'],
];

const FAILURE_STEPS = [
  ['platform stub', PLATFORM_STUB, 'session'],
  ['migration owner role', MIGRATION_OWNER, 'session'],
  ['tenancy foundation', TENANCY, 'owner'],
  ['tenancy RLS and seed', TENANCY_RLS, 'owner'],
  ['plant an obstacle at the migration\'s last statement',
   join(HARNESS, '97_4c_activation_collision_fixture.sql'), 'owner'],
];

/** The obstacle the migration must fail on, and the reason it must give. */
const EXPECTED_FAILURE = /cannot change return type of existing function/i;

// ---------------------------------------------------------------------------
// psql plumbing — the same shape membership-bootstrap-scenarios.mjs uses.
// ---------------------------------------------------------------------------

function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function psql(args, { database } = {}) {
  const base = process.env.DATABASE_URL
    ? ['-d', database ? withDatabase(process.env.DATABASE_URL, database) : process.env.DATABASE_URL]
    : database
      ? ['-d', database]
      : [];
  return spawnSync('psql', [...base, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

/**
 * Run one SQL file against `database`, as `role`.
 *
 * psql executes `-c` and `-f` options in the order they are given, in ONE
 * session, so the `SET ROLE` really does apply to the file that follows it.
 * `DBNAME` is passed because `05_4c_migration_owner.sql` grants CREATE on the
 * scratch database by name.
 */
function runStep(file, database, role) {
  const args = ['-v', `DBNAME=${database}`];
  if (role === 'owner') args.push('-c', 'SET ROLE cortex_migration_owner');
  args.push('-f', file);
  return psql(args, { database });
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function notices(result) {
  return (result.stderr ?? '')
    .split('\n')
    .filter((line) => /PASSED/i.test(line))
    .map((line) => `      ${line.trim()}`)
    .join('\n');
}

function createScratch(database) {
  const dropped = psql(['-c', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
  if (dropped.status !== 0) fail(`could not drop ${database}:\n${dropped.stderr}`);
  const created = psql(['-c', `CREATE DATABASE ${database}`]);
  if (created.status !== 0) fail(`could not create ${database}:\n${created.stderr}`);
}

function dropScratch(database) {
  psql(['-c', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
}

function runPhase(label, database, steps) {
  console.log(`\n${label} — scratch database "${database}"`);
  for (const [stepLabel, file, role] of steps) {
    const run = runStep(file, database, role);
    if (run.status !== 0) {
      dropScratch(database);
      fail(`${label} / ${stepLabel}\n${(run.stderr ?? '').trim()}`);
    }
    console.log(`  ✓ ${stepLabel}`);
    const passed = notices(run);
    if (passed) console.log(passed);
  }
}

// ---------------------------------------------------------------------------
// Preflight.
// ---------------------------------------------------------------------------
const probe = psql(['-c', 'SELECT 1']);
if (probe.error?.code === 'ENOENT') {
  console.error(
    'BLOCKED: psql is not on PATH. The Batch 4C migration verification needs a real ' +
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

for (const [, file] of [...APPLY_STEPS, ...ROLLBACK_STEPS, ...FAILURE_STEPS]) {
  if (!existsSync(file)) fail(`missing SQL file: ${file}`);
}

const version = psql(['-tAc', 'SHOW server_version']);
console.log(
  `AI-01 Batch 4C — executable migration verification (PostgreSQL ${(version.stdout ?? '').trim()})`,
);

// ---------------------------------------------------------------------------
// PHASE 1 + 2 — apply, verify, roll back, verify, re-apply.
// ---------------------------------------------------------------------------
createScratch(SCRATCH_DB);
runPhase('apply and verify', SCRATCH_DB, APPLY_STEPS);
runPhase('roll back and re-apply', SCRATCH_DB, ROLLBACK_STEPS);
dropScratch(SCRATCH_DB);

// ---------------------------------------------------------------------------
// PHASE 3 — the migration must FAIL, and must leave nothing behind.
//
// Its own scratch database, because the property is what the migration does to
// a database with a broken precondition, and state left by phase 1 could
// satisfy the assertion for the wrong reason.
// ---------------------------------------------------------------------------
const FAILURE_DB = `${SCRATCH_DB}_partial`;
createScratch(FAILURE_DB);
runPhase('a failed migration leaves no partial state', FAILURE_DB, FAILURE_STEPS);

const attempt = runStep(PROVIDER_ADMIN, FAILURE_DB, 'owner');
if (attempt.status === 0) {
  dropScratch(FAILURE_DB);
  fail(
    'the 4C migration SUCCEEDED against a planted obstacle. Either the obstacle no longer ' +
      'collides with the migration, in which case this phase proves nothing, or the migration ' +
      'silently overwrote it.',
  );
}
if (!EXPECTED_FAILURE.test(attempt.stderr ?? '')) {
  dropScratch(FAILURE_DB);
  fail(
    'the 4C migration failed for the WRONG reason, so the no-partial-state assertion would ' +
      `be about a different failure.\nexpected /${EXPECTED_FAILURE.source}/\ngot:\n` +
      `${(attempt.stderr ?? '').trim()}`,
  );
}
console.log('  ✓ the migration refused, at its last statement, and named the reason');

const noPartial = runStep(join(HARNESS, '98_assert_4c_no_partial_state.sql'), FAILURE_DB, 'session');
if (noPartial.status !== 0) {
  dropScratch(FAILURE_DB);
  fail(`assert no partial 4C state\n${(noPartial.stderr ?? '').trim()}`);
}
console.log('  ✓ assert no partial 4C state');
const partialNotices = notices(noPartial);
if (partialNotices) console.log(partialNotices);
dropScratch(FAILURE_DB);

console.log('\n✓ all Batch 4C migration scenarios passed, against a real PostgreSQL');
