#!/usr/bin/env node
/**
 * The organizational spine AND the strategic layer, against a real Postgres.
 *
 * CP-3 built the spine and proved ten properties here. CP-4 added goals,
 * decisions and risks — three more tenant-owned tables, each an opportunity to
 * forget a composite key — and EXTENDED this harness rather than starting a
 * second one. The ten properties were the template; a separate script would
 * have been a second place for them to be nearly right.
 *
 * ── WHY THIS EXISTS RATHER THAN A STATIC TEST ───────────────────────────────
 *
 * `tests/database/static_organizational_spine_migration.test.ts` reads the
 * migration as text. It can prove the file DECLARES a composite foreign key and
 * an RLS policy; it cannot prove that a Beta administrator naming Alpha's
 * organization id gets zero rows, that a suspended membership buys nothing, or
 * that a viewer who calls the API directly is refused.
 *
 * Those are statements about what a database DOES, and only a database can
 * settle them. Every assertion below runs as the `authenticated` role with a
 * real `request.jwt.claim.sub`, so the policies are what decide — never a route
 * handler, because a route handler is not what protects these rows.
 *
 * It runs the REAL migration files, never a copy.
 *
 * Usage:
 *   node scripts/organizational-spine-scenarios.mjs
 *
 * Connection: `DATABASE_URL`, or the standard PG* variables. The script creates
 * and drops its own scratch database, so it never writes to the database named
 * in the connection string.
 *
 * Exit codes: 0 passed, 1 failed, 2 no database reachable. Two is distinct from
 * one on purpose — "not run" must never be reported as "passed".
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DB = process.env.SPINE_SCENARIO_DB ?? 'cortex_spine_scenarios';

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const STEPS = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  ['organizational spine', join(MIGRATIONS, '20260917120000_cortex_organizational_spine.sql')],
  ['organizational spine RLS', join(MIGRATIONS, '20260917120001_cortex_organizational_spine_rls.sql')],
  // A Supabase project grants service_role its table privileges as part of the
  // platform, not as part of any migration here. Without this the fixture is
  // refused for a role that has permission in every real deployment, and the
  // failure reads as a defect in the migration.
  ['platform grants', join(HARNESS, '06_platform_public_grants.sql')],
  ['fixture: two organizations', join(HARNESS, '200_spine_fixture.sql')],
  ['TENANCY AND RBAC', join(HARNESS, '201_assert_spine_tenancy.sql')],
  // CP-4. The strategic tables reference `people` through composite keys, so
  // they are applied after the spine and proven over the same two tenants.
  ['strategic layer', join(MIGRATIONS, '20260918120000_cortex_strategic_layer.sql')],
  ['strategic layer RLS', join(MIGRATIONS, '20260918120001_cortex_strategic_layer_rls.sql')],
  ['fixture: strategy in both tenants', join(HARNESS, '210_strategic_fixture.sql')],
  ['STRATEGIC TENANCY AND RBAC', join(HARNESS, '211_assert_strategic_tenancy.sql')],
];

/**
 * The migration applied twice, then rolled back and applied again.
 *
 * A migration that cannot be re-run is a migration that fails halfway through a
 * deployment and cannot be retried.
 */
const IDEMPOTENCY_STEPS = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  ['organizational spine', join(MIGRATIONS, '20260917120000_cortex_organizational_spine.sql')],
  ['organizational spine RLS', join(MIGRATIONS, '20260917120001_cortex_organizational_spine_rls.sql')],
  ['spine again (idempotency)', join(MIGRATIONS, '20260917120000_cortex_organizational_spine.sql')],
  ['spine RLS again (idempotency)', join(MIGRATIONS, '20260917120001_cortex_organizational_spine_rls.sql')],
  ['platform grants', join(HARNESS, '06_platform_public_grants.sql')],
  ['fixture: two organizations', join(HARNESS, '200_spine_fixture.sql')],
  ['TENANCY AND RBAC, after a re-run', join(HARNESS, '201_assert_spine_tenancy.sql')],
  ['strategic layer', join(MIGRATIONS, '20260918120000_cortex_strategic_layer.sql')],
  ['strategic layer RLS', join(MIGRATIONS, '20260918120001_cortex_strategic_layer_rls.sql')],
  ['strategic again (idempotency)', join(MIGRATIONS, '20260918120000_cortex_strategic_layer.sql')],
  ['strategic RLS again (idempotency)', join(MIGRATIONS, '20260918120001_cortex_strategic_layer_rls.sql')],
  ['fixture: strategy in both tenants', join(HARNESS, '210_strategic_fixture.sql')],
  ['STRATEGIC TENANCY, after a re-run', join(HARNESS, '211_assert_strategic_tenancy.sql')],

  // The strategic rollback runs FIRST, and its assertion checks that the spine
  // survived it. Rolling the spine back first would drop `people` out from
  // under `goals.owner_person_id`, which is not the order a real recovery
  // takes and would hide whether the strategic rollback is self-contained.
  ['strategic rollback', join(MIGRATIONS, 'rollbacks', '20260918120000_rollback_strategic_layer.sql')],
  ['assert strategic rollback', join(HARNESS, '212_assert_strategic_rollback.sql')],
  ['strategic rollback again (idempotency)', join(MIGRATIONS, 'rollbacks', '20260918120000_rollback_strategic_layer.sql')],
  ['assert strategic rollback again', join(HARNESS, '212_assert_strategic_rollback.sql')],

  ['rollback', join(MIGRATIONS, 'rollbacks', '20260917120000_rollback_organizational_spine.sql')],
  ['assert rollback', join(HARNESS, '202_assert_spine_rollback.sql')],
  ['rollback again (idempotency)', join(MIGRATIONS, 'rollbacks', '20260917120000_rollback_organizational_spine.sql')],
  ['assert rollback again', join(HARNESS, '202_assert_spine_rollback.sql')],
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

// ── Preflight ───────────────────────────────────────────────────────────────
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

for (const [, file] of [...STEPS, ...IDEMPOTENCY_STEPS]) {
  if (!existsSync(file)) fail(`missing SQL file: ${file}`);
}

function runPhase(label, database, steps) {
  console.log(`\n${label} — scratch database "${database}"`);
  psql(['-c', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
  const create = psql(['-c', `CREATE DATABASE ${database}`]);
  if (create.status !== 0) fail(`could not create ${database}:\n${create.stderr}`);

  let failure = null;
  for (const [step, file] of steps) {
    const run = psql(['-f', file], { database });
    // The assertions announce themselves through RAISE NOTICE, which psql puts
    // on stderr. Echoing them is what makes a passing run readable evidence
    // rather than a row of ticks.
    const notices = (run.stderr ?? '')
      .split('\n')
      .filter(line => /\bok\b/.test(line))
      .map(line => `      ${line.replace(/^NOTICE:\s*/, '').trim()}`)
      .join('\n');

    if (run.status !== 0) {
      console.log(`  ✗ ${step}`);
      failure = `${step}\n${(run.stderr ?? '').trim()}`;
      break;
    }
    console.log(`  ✓ ${step}`);
    if (notices) console.log(notices);
  }

  psql(['-c', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
  if (failure) fail(failure);
}

runPhase('organizational spine: tenancy and RBAC', SCRATCH_DB, STEPS);
runPhase('organizational spine: idempotency and rollback', `${SCRATCH_DB}_idem`, IDEMPOTENCY_STEPS);

console.log('\n✓ all organizational spine tenancy, RBAC, idempotency and rollback scenarios passed');
