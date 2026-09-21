#!/usr/bin/env node
/**
 * THE BP-003 WORKFLOW PERSISTENCE, AGAINST A REAL POSTGRESQL.
 *
 * ── WHY THIS EXISTS RATHER THAN A STATIC TEST ───────────────────────────────
 *
 * `tests/database/static_workflow_persistence_migration.test.ts` reads the
 * migrations as text. It can prove `workflow_run_save` DECLARES
 * `run_version = p_expected_version`; it cannot prove the save REFUSES. And no
 * regex can prove that two isolates passing the same expected version produce
 * one winner — that is a statement about what a database DOES under
 * concurrency, and only two live sessions settle it.
 *
 * ── AND WHY IT ALSO RUNS THE CONTRACT SUITE ────────────────────────────────
 *
 * The parity gate is the point of this packet. `workflowPersistenceParity.test.ts`
 * drives the in-memory reference and the key-value store — the current
 * production authority — through `WORKFLOW_PERSISTENCE_CASES`. This file
 * drives the SQL stores through THE SAME LIST, against a real database, so
 * "the SQL store behaves like production" is one set of assertions run three
 * times rather than three sets of assertions read side by side.
 *
 * The gateway underneath is `psql`. The repository ships no Postgres driver
 * and this packet does not add one: a dependency introduced to test a thing is
 * a dependency the deployment then carries. `psql` is already how every other
 * live database suite here reaches a database.
 *
 * It runs the REAL migration files, never a copy.
 *
 * Usage:
 *   node --experimental-strip-types scripts/workflow-persistence-scenarios.ts
 *
 * Connection: `DATABASE_URL`, or the standard PG* variables. The script creates
 * and drops its own scratch databases, so it never writes to the database named
 * in the connection string.
 *
 * Exit codes: 0 passed, 1 failed, 2 no database reachable. Two is distinct from
 * one on purpose — "not run" must never be reported as "passed".
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSqlWorkflowApprovalStore,
  createSqlWorkflowCheckpointStore,
  createSqlWorkflowRunStore,
  createSqlWorkflowStores,
  type WorkflowSqlGateway,
} from '../supabase/functions/server/ai/workflows/persistence/sqlWorkflowStores.ts';
import { createWorkflowApprovalAuthorityPort } from '../supabase/functions/server/ai/business/diagnostic/persistence/authorityPort.ts';
import {
  ALPHA,
  BETA,
  WORKFLOW_PERSISTENCE_CASES,
  makeApproval,
  makeRun,
  type WorkflowPersistenceHarness,
} from '../supabase/functions/server/ai/__tests__/workflowPersistenceContract.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DB = process.env.WORKFLOW_SCENARIO_DB ?? 'cortex_workflow_persistence';

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const ROLLBACKS = join(MIGRATIONS, 'rollbacks');

const CHAIN: readonly (readonly [string, string])[] = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  // The KV store and its field-keyed compare-and-swap are applied not because
  // the SQL workflow stores use them — they deliberately do not — but so the
  // rollback assertion can prove they are still there afterwards. They hold
  // every workflow record the platform actually has, and a rollback that took
  // them with it would be the worst possible outcome of this packet.
  ['kv store foundation', join(MIGRATIONS, '20260713000000_kv_store_foundation.sql')],
  ['kv compare and swap', join(MIGRATIONS, '20260803120000_kv_compare_and_swap.sql')],
  ['kv compare and swap (guarded)', join(MIGRATIONS, '20260803130000_kv_compare_and_swap_guarded_version.sql')],
  ['kv compare and swap (field)', join(MIGRATIONS, '20260804120000_kv_compare_and_swap_field.sql')],
  // BP-002, for the same reason: A1 is accepted and this packet must not
  // disturb it.
  ['durable runtime tables', join(MIGRATIONS, '20260919120000_cortex_durable_runtime.sql')],
  ['durable runtime RLS', join(MIGRATIONS, '20260919120001_cortex_durable_runtime_rls.sql')],
  ['durable runtime functions', join(MIGRATIONS, '20260919120002_cortex_durable_runtime_functions.sql')],
  ['workflow persistence tables', join(MIGRATIONS, '20260921120000_cortex_workflow_persistence.sql')],
  ['workflow persistence RLS', join(MIGRATIONS, '20260921120001_cortex_workflow_persistence_rls.sql')],
  ['workflow persistence functions', join(MIGRATIONS, '20260921120002_cortex_workflow_persistence_functions.sql')],
  ['platform grants', join(HARNESS, '06_platform_public_grants.sql')],
];

const ASSERTIONS: readonly (readonly [string, string])[] = [
  ['fixture: two tenants with workflow state', join(HARNESS, '400_workflow_persistence_fixture.sql')],
  ['SCHEMA CONSTRAINTS', join(HARNESS, '401_assert_workflow_schema.sql')],
  ['RLS AND PRIVILEGE', join(HARNESS, '402_assert_workflow_rls.sql')],
];

/**
 * The chain applied twice, then rolled back and applied again.
 *
 * A migration that cannot be re-run is a migration that fails halfway through
 * a deployment and cannot be retried.
 */
const IDEMPOTENCY: readonly (readonly [string, string])[] = [
  ...CHAIN,
  ['tables again (idempotency)', join(MIGRATIONS, '20260921120000_cortex_workflow_persistence.sql')],
  ['RLS again (idempotency)', join(MIGRATIONS, '20260921120001_cortex_workflow_persistence_rls.sql')],
  ['functions again (idempotency)', join(MIGRATIONS, '20260921120002_cortex_workflow_persistence_functions.sql')],
  ['fixture: two tenants with workflow state', join(HARNESS, '400_workflow_persistence_fixture.sql')],
  ['SCHEMA CONSTRAINTS, after a re-run', join(HARNESS, '401_assert_workflow_schema.sql')],
  ['rollback', join(ROLLBACKS, '20260921120000_rollback_workflow_persistence.sql')],
  ['assert rollback', join(HARNESS, '403_assert_workflow_rollback.sql')],
  ['rollback again (idempotency)', join(ROLLBACKS, '20260921120000_rollback_workflow_persistence.sql')],
  ['assert rollback again', join(HARNESS, '403_assert_workflow_rollback.sql')],
  ['re-apply tables', join(MIGRATIONS, '20260921120000_cortex_workflow_persistence.sql')],
  ['re-apply RLS', join(MIGRATIONS, '20260921120001_cortex_workflow_persistence_rls.sql')],
  ['re-apply functions', join(MIGRATIONS, '20260921120002_cortex_workflow_persistence_functions.sql')],
  ['fixture after re-apply', join(HARNESS, '400_workflow_persistence_fixture.sql')],
  ['SCHEMA CONSTRAINTS, after a rollback and re-apply', join(HARNESS, '401_assert_workflow_schema.sql')],
];

// ── psql plumbing ───────────────────────────────────────────────────────────

interface PsqlOptions {
  readonly database?: string;
  readonly input?: string;
  readonly role?: string;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function connectionArgs(database?: string): readonly string[] {
  if (process.env.DATABASE_URL) {
    return [
      '-d',
      database ? withDatabase(process.env.DATABASE_URL, database) : process.env.DATABASE_URL,
    ];
  }
  return database ? ['-d', database] : [];
}

function psql(args: readonly string[], options: PsqlOptions = {}) {
  return spawnSync(
    'psql',
    [...connectionArgs(options.database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', input: options.input, env: process.env },
  );
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);
  psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB}_idem WITH (FORCE)`]);
  process.exit(1);
}

// ── The SQL gateway, over psql ──────────────────────────────────────────────

/**
 * PostgreSQL argument types, per function, in declaration order.
 *
 * Spelled out rather than inferred because a NULL with no type is a NULL
 * PostgreSQL cannot resolve an overload against, and `p_states := NULL` for a
 * `text[]` parameter is exactly the call the contract's unfiltered listing
 * makes.
 */
const SIGNATURES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  workflow_run_create: [
    ['p_organization_id', 'uuid'], ['p_workflow_run_id', 'text'], ['p_workflow_id', 'text'],
    ['p_actor_id', 'text'], ['p_state', 'text'], ['p_run_version', 'integer'],
    ['p_checkpoint_version', 'integer'], ['p_created_at', 'timestamptz'],
    ['p_updated_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  workflow_run_save: [
    ['p_organization_id', 'uuid'], ['p_workflow_run_id', 'text'], ['p_expected_version', 'integer'],
    ['p_state', 'text'], ['p_run_version', 'integer'], ['p_checkpoint_version', 'integer'],
    ['p_updated_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  workflow_run_load: [['p_organization_id', 'uuid'], ['p_workflow_run_id', 'text']],
  workflow_run_list: [
    ['p_organization_id', 'uuid'], ['p_states', 'text[]'], ['p_workflow_id', 'text'],
    ['p_actor_id', 'text'], ['p_limit', 'integer'],
  ],
  workflow_checkpoint_append: [
    ['p_organization_id', 'uuid'], ['p_workflow_run_id', 'text'], ['p_version', 'integer'],
    ['p_digest', 'text'], ['p_previous_digest', 'text'], ['p_node_id', 'text'],
    ['p_state', 'text'], ['p_created_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  workflow_checkpoint_read: [
    ['p_organization_id', 'uuid'], ['p_workflow_run_id', 'text'], ['p_version', 'integer'],
  ],
  workflow_checkpoint_latest: [['p_organization_id', 'uuid'], ['p_workflow_run_id', 'text']],
  workflow_checkpoint_history: [['p_organization_id', 'uuid'], ['p_workflow_run_id', 'text']],
  workflow_approval_create: [
    ['p_organization_id', 'uuid'], ['p_workflow_approval_id', 'text'], ['p_workflow_run_id', 'text'],
    ['p_workflow_id', 'text'], ['p_node_id', 'text'], ['p_branch_id', 'text'],
    ['p_approval_state', 'text'], ['p_approval_version', 'integer'], ['p_created_at', 'timestamptz'],
    ['p_expires_at', 'timestamptz'], ['p_decided_at', 'timestamptz'],
    ['p_consumed_at', 'timestamptz'], ['p_updated_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  workflow_approval_save: [
    ['p_organization_id', 'uuid'], ['p_workflow_approval_id', 'text'], ['p_expected_version', 'integer'],
    ['p_approval_state', 'text'], ['p_approval_version', 'integer'], ['p_decided_at', 'timestamptz'],
    ['p_consumed_at', 'timestamptz'], ['p_updated_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  workflow_approval_load: [['p_organization_id', 'uuid'], ['p_workflow_approval_id', 'text']],
  workflow_approval_list: [
    ['p_organization_id', 'uuid'], ['p_workflow_run_id', 'text'], ['p_pending_only', 'boolean'],
    ['p_limit', 'integer'],
  ],
};

/** The functions that return rows rather than a scalar. */
const SET_RETURNING = new Set([
  'workflow_run_load',
  'workflow_run_list',
  'workflow_checkpoint_read',
  'workflow_checkpoint_latest',
  'workflow_checkpoint_history',
  'workflow_approval_load',
  'workflow_approval_list',
]);

/**
 * Dollar-quoting with a tag the payload cannot contain.
 *
 * Escaping quotes by doubling them works until a record carries a backslash,
 * at which point the answer depends on `standard_conforming_strings` and the
 * suite starts testing psql instead of the stores. A dollar-quoted literal has
 * no escape processing at all.
 */
function dollarQuote(value: string): string {
  let tag = 'wf';
  while (value.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${value}$${tag}$`;
}

function literal(value: unknown, type: string): string {
  if (value === null || value === undefined) return `NULL::${type}`;
  if (type === 'text[]') {
    const items = (value as readonly unknown[]).map((item) => dollarQuote(String(item)));
    return items.length === 0 ? `'{}'::text[]` : `ARRAY[${items.join(', ')}]::text[]`;
  }
  if (type === 'jsonb') return `${dollarQuote(JSON.stringify(value))}::jsonb`;
  if (type === 'integer') return `${Number(value)}::integer`;
  if (type === 'boolean') return `${value === true ? 'TRUE' : 'FALSE'}::boolean`;
  return `${dollarQuote(String(value))}::${type}`;
}

/**
 * The gateway the SQL stores are handed.
 *
 * One verb, exactly as `WorkflowSqlGateway` declares — so this harness reaches
 * the database by precisely the routes production would, and cannot smuggle in
 * a query the port does not offer.
 */
function psqlGateway(database: string): WorkflowSqlGateway {
  return {
    rpc(fn, args) {
      const signature = SIGNATURES[fn];
      if (!signature) return Promise.reject(new Error(`unknown workflow function ${fn}`));

      const call = `public.${fn}(${signature
        .map(([name, type]) => `${name} := ${literal(args[name], type)}`)
        .join(', ')})`;

      const sql = SET_RETURNING.has(fn)
        ? `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)::text FROM ${call} t;`
        : `SELECT to_json(${call})::text;`;

      const run = psql(['-A', '-t'], { database, input: sql });
      if (run.status !== 0) {
        // The store maps refusals onto the workflow failure vocabulary; a
        // database error that reaches here is a defect in this harness or in
        // the migration, and it names itself rather than becoming an undefined.
        return Promise.reject(
          new Error(`${fn} failed:\n${(run.stderr ?? '').trim()}\n${sql.slice(0, 400)}`),
        );
      }
      const out = (run.stdout ?? '').trim();
      if (out === '') return Promise.resolve(null);
      try {
        return Promise.resolve(JSON.parse(out));
      } catch {
        return Promise.reject(new Error(`${fn} returned unparseable output: ${out.slice(0, 200)}`));
      }
    },
  };
}

// ── The SQL harness the contract suite drives ───────────────────────────────

function sqlHarness(database: string): WorkflowPersistenceHarness {
  const gateway = psqlGateway(database);
  const corrupt: string[] = [];
  const options = {
    gateway,
    onCorrupt: (location: string, detail: string) => corrupt.push(`${location}: ${detail}`),
  };
  const runs = createSqlWorkflowRunStore(options);
  return {
    name: 'sql',
    runs,
    checkpoints: createSqlWorkflowCheckpointStore(options),
    approvals: createSqlWorkflowApprovalStore(options),
    // THE DECLARED ANSWER, AND IT IS THE KEY-VALUE STORE'S. The SQL function
    // returns `missing` and the store deliberately collapses it into the stale
    // failure, because parity with the current production authority is this
    // packet's acceptance gate. See `sqlWorkflowStores.ts`.
    missingSaveFailure: 'stale_workflow_version',
    missingApprovalSaveFailure: 'stale_workflow_approval',
    seedRun: (record) => runs.create(record),
    async reset() {
      // Truncate rather than drop: the migration chain is applied once for the
      // whole suite, and a case that started against a freshly migrated
      // database would be testing the migration thirty-five times.
      const truncate = psql(
        [
          '-c',
          'TRUNCATE public.workflow_approvals, public.workflow_checkpoints, public.workflow_runs CASCADE',
        ],
        { database },
      );
      if (truncate.status !== 0) fail(`could not reset the scratch tables:\n${truncate.stderr}`);
      await Promise.resolve();
    },
  };
}

// ── Preflight ───────────────────────────────────────────────────────────────

const probe = psql(['-c', 'SELECT 1']);
if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
  console.error('SKIPPED: psql is not on PATH. These scenarios need a real PostgreSQL 16.');
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

function runSteps(label: string, database: string, steps: readonly (readonly [string, string])[]) {
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

// ── The parity gate, against a real database ────────────────────────────────

async function contractSuite(database: string) {
  console.log(`\nworkflow persistence: THE CONTRACT SUITE, against PostgreSQL`);
  if (WORKFLOW_PERSISTENCE_CASES.length < 30) {
    fail(
      `the contract suite has only ${WORKFLOW_PERSISTENCE_CASES.length} cases — ` +
        'a parity gate that runs almost nothing reports the strongest result for the weakest reason',
    );
  }

  let passed = 0;
  for (const testCase of WORKFLOW_PERSISTENCE_CASES) {
    const harness = sqlHarness(database);
    await harness.reset();
    // Every case needs its tenants to exist: `organization_id` is a foreign
    // key, which is the whole point of the relational authority.
    const seed = psql(
      [
        '-c',
        `INSERT INTO public.organizations (id, name, slug) VALUES
           ('${ALPHA}', 'Alpha', 'alpha'), ('${BETA}', 'Beta', 'beta')
         ON CONFLICT (id) DO NOTHING`,
      ],
      { database },
    );
    if (seed.status !== 0) fail(`could not seed tenants:\n${seed.stderr}`);

    try {
      await testCase.run(harness);
    } catch (error) {
      console.log(`  ✗ ${testCase.name}`);
      fail(`${testCase.name}\n${error instanceof Error ? error.stack : String(error)}`);
    }
    passed += 1;
  }
  console.log(`  ✓ all ${passed} persistence contract cases pass against live PostgreSQL`);
  console.log(
    '      ok  the same assertions the memory and key-value suites run, on the same records',
  );
}

// ── Two live sessions ───────────────────────────────────────────────────────

/**
 * A psql session held open on a pipe, so a second session can run against rows
 * it has locked inside an uncommitted transaction.
 */
function openSession(database: string) {
  const child = spawn(
    'psql',
    [...connectionArgs(database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t'],
    { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let out = '';
  child.stdout.on('data', (chunk) => {
    out += String(chunk);
  });
  child.stderr.on('data', () => {});
  return {
    send(sql: string) {
      child.stdin.write(`${sql}\n`);
    },
    async until(marker: string, timeoutMs = 15000) {
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

/** One autocommit session, one statement, resolved when the process exits. */
function race(database: string, sql: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(
      'psql',
      [...connectionArgs(database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t', '-c', sql],
      { env: process.env },
    );
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', () => {});
    child.on('close', () => resolve(out.trim()));
  });
}

const RUN_RECORD = (version: number, state: string) =>
  dollarQuote(
    JSON.stringify({
      context: {
        workflowRunId: 'wfr_race',
        organizationId: ALPHA,
        workflowId: 'wf.race',
        actorId: 'user_race',
      },
      state,
      runVersion: version,
    }),
  );

async function concurrencyProbes(database: string) {
  console.log(`\nworkflow persistence: TWO LIVE SESSIONS — scratch database "${database}"`);

  psql(
    [
      '-c',
      `INSERT INTO public.organizations (id, name, slug)
       VALUES ('${ALPHA}', 'Alpha', 'alpha') ON CONFLICT (id) DO NOTHING`,
    ],
    { database },
  );

  // ── Two isolates, one run id ──────────────────────────────────────────────
  //
  // Genuinely parallel autocommit sessions. `INSERT ... ON CONFLICT DO NOTHING`
  // is one statement, so whichever reaches the index first wins and the other
  // is told the id is taken. There is no sleep here and no timing assumption:
  // the assertion is on the OUTCOME, which does not care who won.
  const createCall = (version: number, state: string) =>
    `SELECT 'R=' || public.workflow_run_create('${ALPHA}'::uuid, 'wfr_race'::text, 'wf.race'::text,
       'user_race'::text, '${state}'::text, ${version}::integer, 0::integer,
       '2026-09-21T10:00:00.000Z'::timestamptz, '2026-09-21T10:00:00.000Z'::timestamptz,
       ${RUN_RECORD(version, state)}::jsonb);`;

  const [c1, c2] = await Promise.all([
    race(database, createCall(1, 'running')),
    race(database, createCall(1, 'cancelled')),
  ]);
  const created = [c1, c2].filter((r) => /R=t/.test(r)).length;
  const refused = [c1, c2].filter((r) => /R=f/.test(r)).length;
  const runRows = psql(
    ['-A', '-t', '-c', `SELECT 'N=' || count(*) FROM public.workflow_runs WHERE workflow_run_id = 'wfr_race'`],
    { database },
  ).stdout ?? '';

  if (created !== 1 || refused !== 1 || !/N=1/.test(runRows)) {
    fail(
      `two concurrent creates of one run id produced created=${created}, refused=${refused}, ` +
        `rows=${runRows.trim()} — a run id must be taken exactly once`,
    );
  }
  console.log('  ✓ two concurrent creates, one run id');
  console.log('      ok  one row, one refusal; the loser never overwrote the winner');

  // ── Two isolates, one expected version ────────────────────────────────────
  //
  // Both read version 1 and both try to write 2. The UPDATE's predicate and
  // its write are one statement, so the second session blocks on the row lock,
  // re-reads under READ COMMITTED, finds the version has moved and matches
  // nothing. Deterministic whichever order they arrive in.
  const saveCall = (state: string) =>
    `SELECT 'S=' || public.workflow_run_save('${ALPHA}'::uuid, 'wfr_race'::text, 1::integer,
       '${state}'::text, 2::integer, 1::integer, '2026-09-21T10:05:00.000Z'::timestamptz,
       ${RUN_RECORD(2, state)}::jsonb);`;

  const [s1, s2] = await Promise.all([
    race(database, saveCall('completed')),
    race(database, saveCall('failed')),
  ]);
  const saved = [s1, s2].filter((r) => /S=saved/.test(r)).length;
  const stale = [s1, s2].filter((r) => /S=stale/.test(r)).length;
  if (saved !== 1 || stale !== 1) {
    fail(
      `two concurrent saves at one expected version produced saved=${saved}, stale=${stale} ` +
        `(${s1} / ${s2}) — exactly one must win`,
    );
  }
  console.log('  ✓ two concurrent saves, one expected version');
  console.log('      ok  exactly one winner; the loser was told the run had moved');

  // The winner's state stands, whichever it was, and the run is at version 2 —
  // not 3, and not a merge of both writes.
  const after = (psql(
    ['-A', '-t', '-c', `SELECT 'V=' || run_version || ':' || state FROM public.workflow_runs WHERE workflow_run_id = 'wfr_race'`],
    { database },
  ).stdout ?? '').trim();
  if (!/^V=2:(completed|failed)$/.test(after)) {
    fail(`the losing save merged into the winner: ${after}`);
  }
  console.log('      ok  the record is one writer\'s, at one version — never a merge of two');

  // ── A STALE SAVE CANNOT OVERWRITE THE WINNER, EVEN LATER ─────────────────
  //
  // The loser above discovered the conflict immediately. This is the other
  // shape: an isolate that stalled, came back long after the winner committed,
  // and still holds the version it read.
  const late = await race(database, saveCall('cancelled'));
  if (!/S=stale/.test(late)) {
    fail(`a stale save was accepted after the winner committed: ${late}`);
  }
  const unchanged = (psql(
    ['-A', '-t', '-c', `SELECT 'V=' || run_version || ':' || state FROM public.workflow_runs WHERE workflow_run_id = 'wfr_race'`],
    { database },
  ).stdout ?? '').trim();
  if (unchanged !== after) fail(`a stale save changed the record: ${after} -> ${unchanged}`);
  console.log('  ✓ a stalled isolate returning with an old version');
  console.log('      ok  refused, and the winner\'s record is byte-for-byte unchanged');

  // ── Two isolates, one checkpoint version ─────────────────────────────────
  const cpRecord = (digest: string) =>
    dollarQuote(
      JSON.stringify({
        workflowRunId: 'wfr_race',
        organizationId: ALPHA,
        version: 1,
        digest,
        nodeId: 'node_one',
        state: 'running',
      }),
    );
  const cpCall = (digest: string) =>
    `SELECT 'C=' || public.workflow_checkpoint_append('${ALPHA}'::uuid, 'wfr_race'::text, 1::integer,
       '${digest}'::text, NULL::text, 'node_one'::text, 'running'::text,
       '2026-09-21T10:00:30.000Z'::timestamptz, ${cpRecord(digest)}::jsonb);`;

  const [k1, k2] = await Promise.all([
    race(database, cpCall('digest_from_a')),
    race(database, cpCall('digest_from_b')),
  ]);
  const wrote = [k1, k2].filter((r) => /C=t/.test(r)).length;
  const conflicted = [k1, k2].filter((r) => /C=f/.test(r)).length;
  const cpRows = (psql(
    ['-A', '-t', '-c', `SELECT 'N=' || count(*) || ':' || max(digest) FROM public.workflow_checkpoints WHERE workflow_run_id = 'wfr_race'`],
    { database },
  ).stdout ?? '').trim();
  if (wrote !== 1 || conflicted !== 1 || !/^N=1:/.test(cpRows)) {
    fail(
      `two concurrent writes of one checkpoint version produced wrote=${wrote}, ` +
        `conflicted=${conflicted}, rows=${cpRows} — a checkpoint is written once`,
    );
  }
  console.log('  ✓ two concurrent writes, one checkpoint version');
  console.log('      ok  one checkpoint, one conflict; the chain has one version 1');

  // ── AND THE ONE THAT LANDED CANNOT BE EDITED AFTERWARDS ──────────────────
  const tamper = psql(
    ['-c', `UPDATE public.workflow_checkpoints SET digest = 'tampered' WHERE workflow_run_id = 'wfr_race'`],
    { database },
  );
  if (tamper.status === 0) fail('a written checkpoint was rewritten by a direct UPDATE');
  console.log('      ok  and the checkpoint that landed refuses to be rewritten');

  // ── Two isolates, one approval id ────────────────────────────────────────
  const apRecord = (state: string, version: number) =>
    dollarQuote(
      JSON.stringify({
        workflowApprovalId: 'wfa:race',
        workflowRunId: 'wfr_race',
        organizationId: ALPHA,
        workflowId: 'wf.race',
        nodeId: 'gate',
        approvalState: state,
        approvalVersion: version,
        singleUse: true,
      }),
    );
  const apCreate = () =>
    `SELECT 'A=' || public.workflow_approval_create('${ALPHA}'::uuid, 'wfa:race'::text,
       'wfr_race'::text, 'wf.race'::text, 'gate'::text, NULL::text, 'pending'::text, 1::integer,
       '2026-09-21T10:00:50.000Z'::timestamptz, '2026-09-21T11:00:50.000Z'::timestamptz,
       NULL::timestamptz, NULL::timestamptz, '2026-09-21T10:00:50.000Z'::timestamptz,
       ${apRecord('pending', 1)}::jsonb);`;

  const [a1, a2] = await Promise.all([race(database, apCreate()), race(database, apCreate())]);
  const madeIt = [a1, a2].filter((r) => /A=t/.test(r)).length;
  const apRows = (psql(
    ['-A', '-t', '-c', `SELECT 'N=' || count(*) FROM public.workflow_approvals WHERE workflow_approval_id = 'wfa:race'`],
    { database },
  ).stdout ?? '').trim();
  if (madeIt !== 1 || apRows !== 'N=1') {
    fail(
      `two concurrent creates of one deterministic approval id produced created=${madeIt}, ` +
        `rows=${apRows} — a retried advance must adopt the request, not mint a second`,
    );
  }
  console.log('  ✓ two concurrent creates, one deterministic approval id');
  console.log('      ok  one request; the retried advance found it rather than replacing it');

  // ── TWO DECIDERS, ONE PENDING REQUEST ────────────────────────────────────
  //
  // The single-use guarantee, and the one probe in this file where the thing
  // being arbitrated is a person's decision rather than an isolate's write.
  const apDecide = (state: string) =>
    `SELECT 'D=' || public.workflow_approval_save('${ALPHA}'::uuid, 'wfa:race'::text, 1::integer,
       '${state}'::text, 2::integer, '2026-09-21T10:05:00.000Z'::timestamptz, NULL::timestamptz,
       '2026-09-21T10:05:00.000Z'::timestamptz, ${apRecord(state, 2)}::jsonb);`;

  const [d1, d2] = await Promise.all([
    race(database, apDecide('approved')),
    race(database, apDecide('rejected')),
  ]);
  const decided = [d1, d2].filter((r) => /D=saved/.test(r)).length;
  const lost = [d1, d2].filter((r) => /D=stale/.test(r)).length;
  const finalState = (psql(
    ['-A', '-t', '-c', `SELECT 'S=' || approval_state || ':' || approval_version FROM public.workflow_approvals WHERE workflow_approval_id = 'wfa:race'`],
    { database },
  ).stdout ?? '').trim();
  if (decided !== 1 || lost !== 1 || !/^S=(approved|rejected):2$/.test(finalState)) {
    fail(
      `two concurrent decisions produced decided=${decided}, stale=${lost}, final=${finalState} ` +
        '— one request must resolve to one decision',
    );
  }
  console.log('  ✓ two concurrent decisions, one pending approval');
  console.log('      ok  one decision at one version — not a merge of two people\'s answers');

  // ── AND ONE APPROVED REQUEST IS SPENT ONCE ───────────────────────────────
  const apConsume = () =>
    `SELECT 'X=' || public.workflow_approval_save('${ALPHA}'::uuid, 'wfa:race'::text, 2::integer,
       'consumed'::text, 3::integer, '2026-09-21T10:05:00.000Z'::timestamptz,
       '2026-09-21T10:06:00.000Z'::timestamptz, '2026-09-21T10:06:00.000Z'::timestamptz,
       ${apRecord('consumed', 3)}::jsonb);`;

  const [x1, x2] = await Promise.all([race(database, apConsume()), race(database, apConsume())]);
  const spent = [x1, x2].filter((r) => /X=saved/.test(r)).length;
  if (spent !== 1) {
    fail(`one approval was spent ${spent} times (${x1} / ${x2}) — singleUse is not a guarantee`);
  }
  console.log('  ✓ two advances racing to spend one approved request');
  console.log('      ok  spent exactly once; the second advance was refused');

  // ── A HELD LOCK, SO THE ARBITRATION IS VISIBLE AND NOT INFERRED ──────────
  //
  // The races above assert the outcome. This asserts the MECHANISM: session A
  // holds an uncommitted save on the row, session B's save reaches the same row
  // and must not be able to slip past it. B blocks; when A commits, B re-reads
  // and finds the version gone.
  const held = openSession(database);
  held.send('BEGIN;');
  held.send(
    `SELECT 'HELD=' || public.workflow_run_save('${ALPHA}'::uuid, 'wfr_race'::text, 2::integer,
       'paused'::text, 3::integer, 1::integer, '2026-09-21T10:10:00.000Z'::timestamptz,
       ${RUN_RECORD(3, 'paused')}::jsonb);`,
  );
  await held.until('HELD=');
  if (!/HELD=saved/.test(held.output())) {
    await held.close();
    fail('the held session could not take the row it was supposed to lock');
  }
  const blocked = race(
    database,
    `SELECT 'BLOCKED=' || public.workflow_run_save('${ALPHA}'::uuid, 'wfr_race'::text, 2::integer,
       'cancelled'::text, 3::integer, 1::integer, '2026-09-21T10:10:01.000Z'::timestamptz,
       ${RUN_RECORD(3, 'cancelled')}::jsonb);`,
  );
  held.send('COMMIT;');
  await held.close();
  const blockedResult = await blocked;
  if (!/BLOCKED=stale/.test(blockedResult)) {
    fail(
      `a second save passed a lock held by an uncommitted one: ${blockedResult} — ` +
        'the compare-and-swap is not arbitrating',
    );
  }
  console.log('  ✓ a save against a row an uncommitted save holds');
  console.log('      ok  it waited, re-read, and found the version had moved — never slipped past');
}

// ── The diagnostic shared-store invariant, against a real database ─────────

/**
 * ONE ASSEMBLED TRIO; THE ENGINE WRITES IT AND THE AUTHORITY PORT READS IT.
 *
 * `workflowSqlComposition.test.ts` asserts the references are identical. That
 * is necessary and it is not sufficient: two stores sharing one object graph
 * could still be reading different rows if the SQL underneath scoped them
 * differently. This is the behavioural half — the engine's store writes a run
 * and an approval, and the READ-ONLY authority port, holding nothing but the
 * same two stores, finds them.
 *
 * It is what a commit's authorization actually depends on: the answer to
 * "which workflow run owns this agent run" comes from `childAgentRunIds`,
 * which the engine writes and nothing on the agent side can reach.
 */
async function sharedStoreInvariant(database: string) {
  console.log('\nworkflow persistence: THE DIAGNOSTIC SHARED-STORE INVARIANT');

  const harness = sqlHarness(database);
  await harness.reset();
  psql(
    [
      '-c',
      `INSERT INTO public.organizations (id, name, slug) VALUES
         ('${ALPHA}', 'Alpha', 'alpha'), ('${BETA}', 'Beta', 'beta')
       ON CONFLICT (id) DO NOTHING`,
    ],
    { database },
  );

  // ONE trio, exactly as a future composition would assemble it.
  const stores = createSqlWorkflowStores({ gateway: psqlGateway(database) });
  const authority = createWorkflowApprovalAuthorityPort({
    runs: stores.runStore,
    approvals: stores.approvalStore,
  });

  // The engine's half: a run that has created a child agent run, and a pending
  // approval on it.
  const run = makeRun({ workflowRunId: 'wfr_shared', state: 'waiting_for_approval' });
  await stores.runStore.create({
    ...run,
    childAgentRunIds: ['run_child_1'],
  } as typeof run);
  await stores.approvalStore.create(
    makeApproval({ workflowRunId: 'wfr_shared', workflowApprovalId: 'wfa:shared' }),
  );

  // The capability's half: two reads, no writes.
  const owning = await authority.owningWorkflowRun(ALPHA, 'run_child_1');
  if (!owning || owning.workflowRunId !== 'wfr_shared') {
    fail(
      'the approval-authority port could not find the run the engine wrote — ' +
        'the engine and the capability are reading different rows',
    );
  }
  console.log('  ✓ the authority port finds the run the engine\'s store wrote');

  const approvals = await authority.approvalsForRun(ALPHA, 'wfr_shared');
  if (approvals.length !== 1 || approvals[0].workflowApprovalId !== 'wfa:shared') {
    fail(`the authority port saw ${approvals.length} approvals for a run that has one`);
  }
  console.log('  ✓ the authority port finds the approval the engine\'s store wrote');

  // A DIRECT AGENT RUN — one nothing added to any run's child list — belongs to
  // no workflow run, and that is what refuses its commit.
  const orphan = await authority.owningWorkflowRun(ALPHA, 'run_never_created_by_a_workflow');
  if (orphan !== undefined) {
    fail('an agent run no workflow created was reported as owned by one');
  }
  console.log('  ✓ an agent run no workflow created is owned by no run');

  // And the invariant is tenant-scoped: Beta cannot reach Alpha's binding.
  const crossTenant = await authority.owningWorkflowRun(BETA, 'run_child_1');
  if (crossTenant !== undefined) {
    fail('TENANT BREACH: Beta resolved Alpha\'s workflow run through the authority port');
  }
  const crossApprovals = await authority.approvalsForRun(BETA, 'wfr_shared');
  if (crossApprovals.length !== 0) {
    fail('TENANT BREACH: Beta read Alpha\'s approvals through the authority port');
  }
  console.log('  ✓ one tenant cannot resolve another\'s run or approvals through the port');
  console.log(
    '      ok  one assembled trio; the engine writes it and the read-only authority reads it',
  );
}

// ── Run ─────────────────────────────────────────────────────────────────────

runSteps('workflow persistence: schema, constraints, RLS', SCRATCH_DB, [...CHAIN, ...ASSERTIONS]);
await concurrencyProbes(SCRATCH_DB);
await contractSuite(SCRATCH_DB);
await sharedStoreInvariant(SCRATCH_DB);
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);

runSteps('workflow persistence: idempotency, rollback and re-apply', `${SCRATCH_DB}_idem`, IDEMPOTENCY);
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB}_idem WITH (FORCE)`]);

console.log(
  '\n✓ all workflow persistence schema, RLS, concurrency, parity, idempotency and rollback scenarios passed',
);
