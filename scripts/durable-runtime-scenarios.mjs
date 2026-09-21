#!/usr/bin/env node
/**
 * The BP-002 durable runtime, against a real PostgreSQL.
 *
 * ── WHY THIS EXISTS RATHER THAN A STATIC TEST ───────────────────────────────
 *
 * `tests/database/static_durable_runtime_migration.test.ts` reads the
 * migrations as text. It can prove the settle DECLARES `lease_expires_at >
 * p_now`; it cannot prove the settle REFUSES. That gap is not hypothetical —
 * it is exactly where the defect this file was written for lived: the
 * predicate was absent from the settle, every in-memory test passed, and an
 * expired worker could still complete a job and emit its events.
 *
 * Nor can a regex prove that `FOR UPDATE SKIP LOCKED` actually makes two
 * concurrent claimers take different rows. That is a statement about what a
 * database DOES under concurrency, and only two live sessions can settle it.
 *
 * ── THE TWO-SESSION PROBES ─────────────────────────────────────────────────
 *
 * `psql` is synchronous, so the concurrency probes hold ONE session open on a
 * pipe while a second session runs to completion against the row it has locked.
 * That is deterministic rather than timing-dependent: `SKIP LOCKED` makes the
 * second session SKIP the locked row and return nothing, so there is no sleep
 * to tune and no flake to chase.
 *
 * It runs the REAL migration files, never a copy.
 *
 * Usage:
 *   node scripts/durable-runtime-scenarios.mjs
 *
 * Connection: `DATABASE_URL`, or the standard PG* variables. The script creates
 * and drops its own scratch database, so it never writes to the database named
 * in the connection string.
 *
 * Exit codes: 0 passed, 1 failed, 2 no database reachable. Two is distinct from
 * one on purpose — "not run" must never be reported as "passed".
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DB = process.env.DURABLE_SCENARIO_DB ?? 'cortex_durable_scenarios';

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const CHAIN = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  // The KV store is applied not because the durable runtime uses it — it
  // deliberately does not — but so the rollback assertion can prove it is still
  // there afterwards. A rollback that took the existing runtime's storage with
  // it would be the worst possible outcome of this packet.
  ['kv store foundation', join(MIGRATIONS, '20260713000000_kv_store_foundation.sql')],
  ['durable runtime tables', join(MIGRATIONS, '20260919120000_cortex_durable_runtime.sql')],
  ['durable runtime RLS', join(MIGRATIONS, '20260919120001_cortex_durable_runtime_rls.sql')],
  ['durable runtime functions', join(MIGRATIONS, '20260919120002_cortex_durable_runtime_functions.sql')],
  ['platform grants', join(HARNESS, '06_platform_public_grants.sql')],
];

const ASSERTIONS = [
  ['fixture: two tenants with durable work', join(HARNESS, '300_durable_fixture.sql')],
  ['SCHEMA CONSTRAINTS', join(HARNESS, '301_assert_durable_schema.sql')],
  ['LEASE, SETTLE AND TRANSITION', join(HARNESS, '302_assert_durable_lease.sql')],
  ['OUTBOX AND INBOX DURABILITY', join(HARNESS, '303_assert_durable_events.sql')],
  ['RLS AND PRIVILEGE', join(HARNESS, '304_assert_durable_rls.sql')],
];

/**
 * The chain applied twice, then rolled back and applied again.
 *
 * A migration that cannot be re-run is a migration that fails halfway through a
 * deployment and cannot be retried.
 */
const IDEMPOTENCY = [
  ...CHAIN,
  ['tables again (idempotency)', join(MIGRATIONS, '20260919120000_cortex_durable_runtime.sql')],
  ['RLS again (idempotency)', join(MIGRATIONS, '20260919120001_cortex_durable_runtime_rls.sql')],
  ['functions again (idempotency)', join(MIGRATIONS, '20260919120002_cortex_durable_runtime_functions.sql')],
  ['fixture: two tenants with durable work', join(HARNESS, '300_durable_fixture.sql')],
  ['SCHEMA CONSTRAINTS, after a re-run', join(HARNESS, '301_assert_durable_schema.sql')],
  ['rollback', join(MIGRATIONS, 'rollbacks', '20260919120000_rollback_durable_runtime.sql')],
  ['assert rollback', join(HARNESS, '305_assert_durable_rollback.sql')],
  ['rollback again (idempotency)', join(MIGRATIONS, 'rollbacks', '20260919120000_rollback_durable_runtime.sql')],
  ['assert rollback again', join(HARNESS, '305_assert_durable_rollback.sql')],
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
  psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
  psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB}_idem WITH (FORCE)`]);
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

for (const [, file] of [...CHAIN, ...ASSERTIONS, ...IDEMPOTENCY]) {
  if (!existsSync(file)) fail(`missing SQL file: ${file}`);
}

function runSteps(label, database, steps) {
  console.log(`\n${label} — scratch database "${database}"`);
  psql(['-c', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`]);
  const create = psql(['-c', `CREATE DATABASE ${database}`]);
  if (create.status !== 0) fail(`could not create ${database}:\n${create.stderr}`);

  for (const [step, file] of steps) {
    const run = psql(['-f', file], { database });
    // The assertions announce themselves through RAISE NOTICE, which psql puts
    // on stderr. Echoing them is what makes a passing run readable evidence
    // rather than a row of ticks.
    const notices = (run.stderr ?? '')
      .split('\n')
      .filter((line) => /\bok\b/.test(line))
      .map((line) => `      ${line.replace(/^.*NOTICE:\s*/, '').trim()}`)
      .join('\n');

    if (run.status !== 0) {
      console.log(`  ✗ ${step}`);
      fail(`${step}\n${(run.stderr ?? '').trim()}`);
    }
    console.log(`  ✓ ${step}`);
    if (notices) console.log(notices);
  }
}

/**
 * A psql session held open on a pipe, so a second session can run against rows
 * it has locked inside an uncommitted transaction.
 */
function openSession(database) {
  const base = process.env.DATABASE_URL
    ? ['-d', withDatabase(process.env.DATABASE_URL, database)]
    : ['-d', database];
  const child = spawn('psql', [...base, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t'], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => {
    out += chunk.toString();
  });
  child.stderr.on('data', () => {});
  return {
    send(sql) {
      child.stdin.write(`${sql}\n`);
    },
    /** Resolve once `marker` appears in the session's output. */
    async until(marker, timeoutMs = 15000) {
      const deadline = Date.now() + timeoutMs;
      while (!out.includes(marker)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${marker}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return out;
    },
    output: () => out,
    async close() {
      child.stdin.end();
      await new Promise((resolve) => child.on('close', resolve));
    },
  };
}

async function concurrencyProbes(database) {
  console.log(`\ndurable runtime: TWO LIVE SESSIONS — scratch database "${database}"`);

  // ── Two workers, one due job ─────────────────────────────────────────────
  //
  // Session A claims inside an open transaction and holds the row lock.
  // Session B's claim reaches the same row, finds it locked, and SKIPS it —
  // so B gets nothing rather than blocking or double-claiming. Deterministic:
  // there is no sleep here and no timing assumption.
  psql(
    [
      '-c',
      `INSERT INTO public.durable_jobs (organization_id, job_type, idempotency_key,
         correlation_id, actor_id, actor_type, actor_permissions)
       VALUES ('11111111-1111-4111-8111-111111111111', 'race.job', 'race-1', 'c',
               'service:test', 'service', ARRAY['job.run'])`,
    ],
    { database },
  );

  const a = openSession(database);
  a.send('BEGIN;');
  a.send(
    `SELECT 'A_CLAIMED=' || count(*) FROM public.durable_job_claim(
       '11111111-1111-4111-8111-111111111111', ARRAY['race.job'], 'worker-a', 60000, now());`,
  );
  await a.until('A_CLAIMED=');
  const aClaimed = /A_CLAIMED=(\d+)/.exec(a.output())?.[1];

  const b = psql(
    [
      '-c',
      `SELECT 'B_CLAIMED=' || count(*) FROM public.durable_job_claim(
         '11111111-1111-4111-8111-111111111111', ARRAY['race.job'], 'worker-b', 60000, now());`,
    ],
    { database },
  );
  const bClaimed = /B_CLAIMED=(\d+)/.exec(b.stdout ?? '')?.[1];

  a.send('COMMIT;');
  await a.close();

  if (aClaimed !== '1' || bClaimed !== '0') {
    fail(
      `two concurrent workers claimed the same job: A=${aClaimed}, B=${bClaimed}\n` +
        'FOR UPDATE SKIP LOCKED is not arbitrating the claim',
    );
  }
  console.log('  ✓ two concurrent workers, one due job');
  console.log('      ok  exactly one worker claimed it; the other skipped rather than blocked');

  // ── Two schedulers, one due occurrence ───────────────────────────────────
  psql(
    [
      '-c',
      `INSERT INTO public.durable_schedules (organization_id, schedule_key, job_type,
         next_run_at, recurrence_interval_ms, actor_id, actor_type, actor_permissions,
         correlation_id)
       VALUES ('11111111-1111-4111-8111-111111111111', 'race.sweep', 'race.sweep',
               now() - interval '1 minute', 300000, 'service:test', 'service',
               ARRAY['job.run'], 'c')`,
    ],
    { database },
  );

  // TWO GENUINELY PARALLEL AUTOCOMMIT SESSIONS, and the asymmetry with the
  // probe above is the point.
  //
  // A job claim uses `SKIP LOCKED`, so the loser returns immediately with
  // nothing, and staging it with a held-open transaction works. A schedule
  // advance is a compare-and-swap on ONE row, so the second scheduler BLOCKS on
  // that row lock until the first commits. Blocking is the CORRECT behaviour —
  // and it makes a held-open transaction the wrong tool, because the second
  // session cannot return until a COMMIT this script would have to send, and
  // sequencing that over a pipe is exactly the timing dependency a concurrency
  // test must not have. Written that way, it deadlocked this harness.
  //
  // Two processes in autocommit need no commit from us: each is its own
  // transaction, one wins the compare-and-swap, the other waits, re-reads and
  // materializes nothing. The assertion is on the OUTCOME — one job for one
  // occurrence — which is the property that matters and does not care who won.
  const materialize = () =>
    new Promise((resolve) => {
      const base = process.env.DATABASE_URL
        ? ['-d', withDatabase(process.env.DATABASE_URL, database)]
        : ['-d', database];
      const child = spawn(
        'psql',
        [
          ...base, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t',
          '-c',
          `SELECT 'N=' || count(*) FROM public.durable_schedule_materialize_due(
             '11111111-1111-4111-8111-111111111111', now(), 10);`,
        ],
        { env: process.env },
      );
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk.toString();
      });
      child.stderr.on('data', () => {});
      child.on('close', () => resolve(/N=(\d+)/.exec(out)?.[1] ?? '?'));
    });

  const [s1Count, s2Count] = await Promise.all([materialize(), materialize()]);

  const jobs = psql(
    [
      '-c',
      `SELECT 'OCCURRENCES=' || count(*) FROM public.durable_jobs WHERE job_type = 'race.sweep'`,
    ],
    { database },
  );
  const occurrences = /OCCURRENCES=(\d+)/.exec(jobs.stdout ?? '')?.[1];

  if (occurrences !== '1') {
    fail(
      `two racing schedulers produced ${occurrences} occurrences (S1=${s1Count}, S2=${s2Count})\n` +
        'an occurrence must be materialized exactly once',
    );
  }
  console.log('  ✓ two racing schedulers, one due occurrence');
  console.log('      ok  exactly one job was materialized for the occurrence');

  // ── Two dispatchers, one due event ───────────────────────────────────────
  psql(
    [
      '-c',
      `INSERT INTO public.durable_outbox (organization_id, event_type, actor_id, actor_type,
         correlation_id, source)
       VALUES ('11111111-1111-4111-8111-111111111111', 'race.event', 'service:test',
               'service', 'c', 'test')`,
    ],
    { database },
  );

  const d1 = openSession(database);
  d1.send('BEGIN;');
  d1.send(
    `SELECT 'D1=' || count(*) FROM public.durable_outbox_claim(
       '11111111-1111-4111-8111-111111111111', 'd1', 30000, now(), 10);`,
  );
  await d1.until('D1=');
  const d1Count = /D1=(\d+)/.exec(d1.output())?.[1];

  const d2 = psql(
    [
      '-c',
      `SELECT 'D2=' || count(*) FROM public.durable_outbox_claim(
         '11111111-1111-4111-8111-111111111111', 'd2', 30000, now(), 10);`,
    ],
    { database },
  );
  const d2Count = /D2=(\d+)/.exec(d2.stdout ?? '')?.[1];

  d1.send('COMMIT;');
  await d1.close();

  // D1 claims whatever is due — the assertions above leave several pending
  // events in this database, and how many is not the point. The claim being
  // made is that D2 gets NONE of them while D1 holds them, so no event is ever
  // leased by two dispatchers at once.
  if (Number(d1Count) < 1 || d2Count !== '0') {
    fail(
      `two concurrent dispatchers overlapped: D1=${d1Count}, D2=${d2Count}\n` +
        'D2 must skip every event D1 holds',
    );
  }
  console.log('  ✓ two concurrent dispatchers, one set of due events');
  console.log(
    `      ok  D1 leased ${d1Count}; D2 skipped all of them rather than double-claiming`,
  );

  // ── Two consumers, one delivery ──────────────────────────────────────────
  //
  // The inbox claim takes a row lock too, so the second consumer BLOCKS rather
  // than skipping — and when it proceeds it must find a live claim it does not
  // own, never a second claim of its own.
  // `-A -t` so the id comes back bare. Without them psql prints a header and
  // padding, and the id parsed out of that is whitespace — which the probe then
  // reported as "both consumers saw undefined", a harness defect wearing the
  // costume of a correctness failure.
  const eventId = psql(
    [
      '-A',
      '-t',
      '-c',
      `SELECT id FROM public.durable_outbox WHERE event_type = 'race.event' LIMIT 1`,
    ],
    { database },
  ).stdout?.trim();

  if (!eventId || !/^[0-9a-f-]{36}$/.test(eventId)) {
    fail(`could not read the race event id (got ${JSON.stringify(eventId)})`);
  }

  const c1 = psql(
    [
      '-c',
      `SELECT 'C1=' || lease_owner FROM public.durable_inbox_claim(
         '11111111-1111-4111-8111-111111111111', 'racer', '${eventId}', 'race.event',
         'c', NULL, 'consumer-1', 60000, now());`,
    ],
    { database },
  );
  const c2 = psql(
    [
      '-c',
      `SELECT 'C2=' || lease_owner FROM public.durable_inbox_claim(
         '11111111-1111-4111-8111-111111111111', 'racer', '${eventId}', 'race.event',
         'c', NULL, 'consumer-2', 60000, now());`,
    ],
    { database },
  );

  const owner1 = /C1=(\S+)/.exec(c1.stdout ?? '')?.[1];
  const owner2 = /C2=(\S+)/.exec(c2.stdout ?? '')?.[1];
  if (owner1 !== 'consumer-1' || owner2 !== 'consumer-1') {
    fail(
      `two consumers both took the delivery: first saw ${owner1}, second saw ${owner2}\n` +
        'the second must find the FIRST consumer\'s live claim',
    );
  }

  const rows = psql(
    [
      '-c',
      `SELECT 'INBOX_ROWS=' || count(*) FROM public.durable_inbox WHERE consumer_key = 'racer'`,
    ],
    { database },
  );
  if (!/INBOX_ROWS=1/.test(rows.stdout ?? '')) {
    fail('a second inbox identity was created for one (consumer, event)');
  }
  console.log('  ✓ two consumers, one delivery');
  console.log('      ok  one live claim, one inbox identity, one owner');
}

runSteps('durable runtime: behaviour', SCRATCH_DB, [...CHAIN, ...ASSERTIONS]);
await concurrencyProbes(SCRATCH_DB);
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);

runSteps('durable runtime: idempotency and rollback', `${SCRATCH_DB}_idem`, IDEMPOTENCY);
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB}_idem WITH (FORCE)`]);

console.log('\n✓ all durable runtime behaviour, concurrency, RLS, idempotency and rollback scenarios passed');
