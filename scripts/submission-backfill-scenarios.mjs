#!/usr/bin/env node
/**
 * The submission backfill, against a real PostgreSQL.
 *
 * ── WHAT A UNIT TEST CANNOT ASK ────────────────────────────────────────────
 *
 * The normalizer suite argues about the mapping and the domain suite proves the
 * shape of the writes against a recording fake. Neither can prove that the rows
 * SURVIVE CONTACT WITH THE SCHEMA — that the console's status vocabulary is
 * actually refused, that the unique index really does make a re-run an update,
 * that the retirement sweep soft-deletes exactly what KV dropped, and that an
 * outcome genuinely cannot exist before its submission.
 *
 * Those are the failures that happen at three in the morning against production
 * data, and a text scan reports them as healthy. Batch 4C learned that the
 * expensive way; this harness is the same lesson applied to the migration
 * engine.
 *
 * ── THE MIGRATIONS ARE APPLIED AS THE MIGRATION OWNER ──────────────────────
 *
 * `cortex_migration_owner` — NOSUPERUSER with BYPASSRLS — for the reason the
 * Batch 4C and 4D runners give: a superuser owner sails through checks a
 * deployment's owner has to pass, so a harness that used one would prove the
 * migration works for somebody who will never run it.
 *
 * The ASSERTIONS run as `service_role`, because that is the role the migration
 * engine's client actually holds.
 *
 * Usage:
 *   node scripts/submission-backfill-scenarios.mjs
 *
 * Connection: `DATABASE_URL`, or the standard PG* environment variables. The
 * script creates and drops its own scratch database, so it never writes to the
 * database named in the connection string.
 *
 * Exit codes: 0 passed, 1 a scenario failed, 2 no database was reachable
 * (reported as BLOCKED, never as a pass).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DB = process.env.SUBMISSION_BACKFILL_SCENARIO_DB ?? 'cortex_submission_backfill';

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const STEPS = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql'), 'session'],
  ['migration owner role', join(HARNESS, '05_4c_migration_owner.sql'), 'session'],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql'), 'owner'],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql'), 'owner'],
  ['diagnostic foundation', join(MIGRATIONS, '20260714050000_cortex_diagnostic_foundation.sql'), 'owner'],
  ['diagnostic RLS', join(MIGRATIONS, '20260714050001_cortex_diagnostic_rls.sql'), 'owner'],
  [
    'diagnostic anon policy hardening',
    join(MIGRATIONS, '20260714060000_cortex_diagnostic_anon_policy_hardening.sql'),
    'owner',
  ],
  // A Supabase project grants the API roles on `public` as part of the
  // platform rather than in any migration here, so the harness has to supply
  // what a bare PostgreSQL does not.
  ['platform grants on public', join(HARNESS, '06_platform_public_grants.sql'), 'session'],
  ['backfill fixture', join(HARNESS, '110_submission_backfill_fixture.sql'), 'session'],
  ['ASSERT the submission backfill', join(HARNESS, '111_assert_submission_backfill.sql'), 'session'],
  // The cortex domain hangs off the submission the previous file left behind,
  // which is the dependency it exists to demonstrate.
  ['ASSERT the cortex analysis backfill', join(HARNESS, '112_assert_cortex_backfill.sql'), 'session'],
];

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
 * One SQL file, against `database`, as `role`.
 *
 * psql executes `-c` and `-f` in the order given, in ONE session, so the
 * `SET ROLE` really does apply to the file that follows it.
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

function dropScratch(database) {
  psql(['-c', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
}

const probe = psql(['-c', 'SELECT 1']);
if (probe.error?.code === 'ENOENT') {
  console.error(
    'BLOCKED: psql is not on PATH. The submission backfill verification needs a real ' +
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

for (const [, file] of STEPS) {
  if (!existsSync(file)) fail(`missing SQL file: ${file}`);
}

dropScratch(SCRATCH_DB);
const created = psql(['-c', `CREATE DATABASE ${SCRATCH_DB}`]);
if (created.status !== 0) fail(`could not create ${SCRATCH_DB}:\n${created.stderr}`);

console.log(`\nSubmission backfill — scratch database "${SCRATCH_DB}"`);
for (const [label, file, role] of STEPS) {
  const run = runStep(file, SCRATCH_DB, role);
  if (run.status !== 0) {
    dropScratch(SCRATCH_DB);
    fail(`${label}\n${(run.stderr ?? '').trim()}`);
  }
  console.log(`  ✓ ${label}`);
  const passed = notices(run);
  if (passed) console.log(passed);
}

dropScratch(SCRATCH_DB);
console.log('\n✓ the submission and cortex backfills hold against a real PostgreSQL');
