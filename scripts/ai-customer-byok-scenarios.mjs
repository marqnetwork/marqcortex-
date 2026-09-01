#!/usr/bin/env node
/**
 * EXECUTABLE verification of the AI-01 Batch 4D customer BYOK migration,
 * against a real PostgreSQL.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT OPTIONAL.
 *
 * Batch 4C shipped with a text-scanning migration test and nothing else. That
 * test reported the migration healthy while the file contained two CHECK
 * constraints with one name — which PostgreSQL rejects outright, so the
 * migration could not be applied anywhere — and while it granted `service_role`
 * nothing at all, so every runtime operation would have failed with `permission
 * denied`. Both defects were behaviour; a text scan proves ABSENCE well and
 * BEHAVIOUR not at all.
 *
 * Batch 4D's central claim is TENANT ISOLATION, which is behaviour of the most
 * silent kind. A cross-tenant read does not raise; it returns rows. A re-pointed
 * configuration does not warn; it commits. So this runner asks the database.
 *
 * It runs the REAL migration and rollback files under `supabase/migrations/…` —
 * never a copy, because a harness that re-typed the migration would be testing
 * the harness.
 *
 * ── THE THREE PHASES ──────────────────────────────────────────────────────
 *
 *  1. APPLY     the real tenancy foundation, the real 4C migration and the real
 *               4D migration, then prove the 4D schema, the tenant isolation
 *               invariants under `service_role`, and the privilege matrix.
 *
 *  2. ROLLBACK  the real 4D rollback, then prove 4D is gone, Batch 4C is
 *               untouched and the customer rows survived. Then RE-APPLY,
 *               because a migration that cannot be applied twice around its own
 *               rollback is a migration nobody can safely reverse in staging.
 *
 *  3. FAILURE   a fresh database where 4D is applied WITHOUT 4C beneath it.
 *               The migration must fail — it alters a table that does not
 *               exist — and must leave nothing behind. This is the shape of a
 *               real deployment mistake: migrations applied out of order.
 *
 * ── ONE DELIBERATE CHOICE ABOUT ROLES ─────────────────────────────────────
 *
 * The migrations are applied as `cortex_migration_owner` — NOSUPERUSER, with
 * BYPASSRLS — rather than as the cluster superuser, for the reason the 4C
 * runner gives: `ai_provider_credential_activate` is SECURITY DEFINER and
 * writes through FORCE ROW LEVEL SECURITY, so a superuser owner would sail
 * through a check a deployment's owner has to pass. Batch 4D adds a trigger
 * that must bind `service_role` itself, which is asked under the same role.
 *
 * Usage:
 *   node scripts/ai-customer-byok-scenarios.mjs
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
const SCRATCH_DB = process.env.BYOK_SCENARIO_DB ?? 'cortex_4d_customer_byok';

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** The real files. Named once, used everywhere below. */
const PLATFORM_STUB = join(HARNESS, '00_platform_stub.sql');
const MIGRATION_OWNER = join(HARNESS, '05_4c_migration_owner.sql');
const TENANCY = join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql');
const TENANCY_RLS = join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql');
const PROVIDER_ADMIN = join(MIGRATIONS, '20260828120000_ai_provider_administration.sql');
const BYOK = join(MIGRATIONS, '20260901120000_ai_customer_byok.sql');
const BYOK_ROLLBACK = join(
  MIGRATIONS, 'rollbacks', '20260901120000_rollback_ai_customer_byok.sql',
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
  ['the 4C migration (Batch 4D depends on it)', PROVIDER_ADMIN, 'owner'],
  ['THE 4D MIGRATION', BYOK, 'owner'],
  ['two customer organizations', join(HARNESS, '100_4d_tenant_fixture.sql'), 'session'],
  ['assert 4D schema', join(HARNESS, '101_assert_4d_schema.sql'), 'session'],
  ['assert 4D tenant isolation (service_role)',
   join(HARNESS, '102_assert_4d_tenant_isolation.sql'), 'session'],
  ['assert 4D privileges', join(HARNESS, '103_assert_4d_privileges.sql'), 'session'],
  // The Batch 4C assertions, RE-RUN AFTER 4D. This is the regression question:
  // does admitting customer rows into these tables disturb anything the
  // certified platform batch depends on? It is asked of the real 4C harness
  // files rather than of a 4D-shaped paraphrase of them.
  ['assert 4C schema still holds under 4D',
   join(HARNESS, '93_assert_4c_schema.sql'), 'session'],
  ['assert 4C privileges still hold under 4D',
   join(HARNESS, '95_assert_4c_privileges.sql'), 'session'],
];

const ROLLBACK_STEPS = [
  ['THE 4D ROLLBACK', BYOK_ROLLBACK, 'owner'],
  ['assert 4D rollback', join(HARNESS, '104_assert_4d_rollback.sql'), 'session'],
  // 4C must still work after 4D has been reversed. If reversing the customer
  // batch broke the platform batch, a staging rollback would take MARQ's own
  // provider administration down with it.
  ['assert 4C schema after the 4D rollback',
   join(HARNESS, '93_assert_4c_schema.sql'), 'session'],
  ['assert 4C privileges after the 4D rollback',
   join(HARNESS, '95_assert_4c_privileges.sql'), 'session'],
  ['THE 4D MIGRATION (re-apply after rollback)', BYOK, 'owner'],
  ['assert 4D schema again', join(HARNESS, '101_assert_4d_schema.sql'), 'session'],
  ['assert 4D privileges again', join(HARNESS, '103_assert_4d_privileges.sql'), 'session'],
];

/**
 * PHASE 3. 4D applied with NO 4C beneath it.
 *
 * The obstacle is the ABSENCE of the table 4D alters, which is exactly what a
 * migration applied out of order meets. The expected failure names it.
 */
const FAILURE_STEPS = [
  ['platform stub', PLATFORM_STUB, 'session'],
  ['migration owner role', MIGRATION_OWNER, 'session'],
  ['tenancy foundation', TENANCY, 'owner'],
  ['tenancy RLS and seed', TENANCY_RLS, 'owner'],
];

const EXPECTED_FAILURE = /relation "cortex\.ai_provider_configuration" does not exist/i;

// ---------------------------------------------------------------------------
// psql plumbing — the same shape ai-provider-administration-scenarios.mjs uses.
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
    'BLOCKED: psql is not on PATH. The Batch 4D migration verification needs a real ' +
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
if (!existsSync(BYOK)) fail(`missing SQL file: ${BYOK}`);

const version = psql(['-tAc', 'SHOW server_version']);
console.log(
  `AI-01 Batch 4D — executable migration verification (PostgreSQL ${(version.stdout ?? '').trim()})`,
);

// ---------------------------------------------------------------------------
// PHASE 1 + 2 — apply, verify, roll back, verify, re-apply.
// ---------------------------------------------------------------------------
createScratch(SCRATCH_DB);
runPhase('apply and verify', SCRATCH_DB, APPLY_STEPS);
runPhase('roll back and re-apply', SCRATCH_DB, ROLLBACK_STEPS);
dropScratch(SCRATCH_DB);

// ---------------------------------------------------------------------------
// PHASE 3 — applied out of order, the migration must FAIL and leave nothing.
//
// Its own scratch database, because the property is what the migration does to
// a database with a broken precondition, and state left by phase 1 would
// satisfy the assertion for the wrong reason.
// ---------------------------------------------------------------------------
const FAILURE_DB = `${SCRATCH_DB}_partial`;
createScratch(FAILURE_DB);
runPhase('4D applied without 4C leaves no partial state', FAILURE_DB, FAILURE_STEPS);

const attempt = runStep(BYOK, FAILURE_DB, 'owner');
if (attempt.status === 0) {
  dropScratch(FAILURE_DB);
  fail(
    'the 4D migration SUCCEEDED against a database with no Batch 4C schema. Either it no ' +
      'longer depends on 4C, in which case this phase proves nothing, or it created ' +
      'something nobody reviewed.',
  );
}
if (!EXPECTED_FAILURE.test(attempt.stderr ?? '')) {
  dropScratch(FAILURE_DB);
  fail(
    'the 4D migration failed for the WRONG reason, so the no-partial-state assertion would ' +
      `be about a different failure.\nexpected /${EXPECTED_FAILURE.source}/\ngot:\n` +
      `${(attempt.stderr ?? '').trim()}`,
  );
}
console.log('  ✓ the migration refused, naming the Batch 4C table it depends on');

const leftovers = psql(
  [
    '-tAc',
    `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'cortex'
         AND p.proname = 'ai_provider_configuration_tenancy_is_immutable'`,
  ],
  { database: FAILURE_DB },
);
if ((leftovers.stdout ?? '').trim() !== '0') {
  dropScratch(FAILURE_DB);
  fail(
    'the failed 4D migration left its trigger function behind. The migration uses ' +
      '`CREATE OR REPLACE`, so a half-applied 4D would be silently re-appliable and the ' +
      'second run would produce a schema nobody reviewed.',
  );
}
console.log('  ✓ assert no partial 4D state');
dropScratch(FAILURE_DB);

console.log('\n✓ all Batch 4D migration scenarios passed, against a real PostgreSQL');
