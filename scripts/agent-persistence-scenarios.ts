#!/usr/bin/env node
/**
 * THE A2-P07 AGENT PERSISTENCE, AGAINST A REAL POSTGRESQL.
 *
 * The agent counterpart of `workflow-persistence-scenarios.ts`, and built the
 * same way for the same reasons: a static read can prove `agent_run_save`
 * DECLARES its compare-and-swap predicate, and only two live sessions can
 * prove it REFUSES. It runs the REAL migration files, never a copy, over
 * `psql` — no driver is added to test a thing the deployment would then carry.
 *
 *   1. schema, constraints, RLS and privilege   (harness 410–412)
 *   2. two live sessions per arbitration point  (create, save, checkpoint,
 *                                                approval decide, approval spend,
 *                                                a held row lock)
 *   3. THE AGENT CONTRACT SUITE against the SQL stores — the same cases the
 *      memory and key-value stores run in `agentPersistenceParity.test.ts`
 *   4. idempotency, rollback, rollback again, re-apply (harness 413)
 *
 * Usage:
 *   node --experimental-strip-types scripts/agent-persistence-scenarios.ts
 *
 * Connection: `DATABASE_URL`, or the standard PG* variables. Scratch databases
 * are created and dropped; the database named in the connection is never
 * written.
 *
 * Exit codes: 0 passed, 1 failed, 2 no database reachable — "not run" is never
 * reported as "passed".
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSqlAgentApprovalStore,
  createSqlAgentCheckpointStore,
  createSqlAgentRunStore,
  type AgentSqlGateway,
} from '../supabase/functions/server/ai/agents/persistence/sqlAgentStores.ts';
import {
  AGENT_ALPHA,
  AGENT_BETA,
  AGENT_PERSISTENCE_CASES,
  type AgentPersistenceHarness,
} from '../supabase/functions/server/ai/__tests__/agentPersistenceContract.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_DB = process.env.AGENT_SCENARIO_DB ?? 'cortex_agent_persistence';

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const ROLLBACKS = join(MIGRATIONS, 'rollbacks');

const AGENT_TABLES = join(MIGRATIONS, '20260922120000_cortex_agent_persistence.sql');
const AGENT_RLS = join(MIGRATIONS, '20260922120001_cortex_agent_persistence_rls.sql');
const AGENT_FUNCTIONS = join(MIGRATIONS, '20260922120002_cortex_agent_persistence_functions.sql');
const AGENT_ROLLBACK = join(ROLLBACKS, '20260922120000_rollback_agent_persistence.sql');

const CHAIN: readonly (readonly [string, string])[] = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  // The key-value store and its compare-and-swap hold every agent record the
  // platform has. They are applied so the rollback can prove they survive.
  ['kv store foundation', join(MIGRATIONS, '20260713000000_kv_store_foundation.sql')],
  ['kv compare and swap', join(MIGRATIONS, '20260803120000_kv_compare_and_swap.sql')],
  ['kv compare and swap (guarded)', join(MIGRATIONS, '20260803130000_kv_compare_and_swap_guarded_version.sql')],
  ['kv compare and swap (field)', join(MIGRATIONS, '20260804120000_kv_compare_and_swap_field.sql')],
  ['durable runtime tables', join(MIGRATIONS, '20260919120000_cortex_durable_runtime.sql')],
  ['durable runtime RLS', join(MIGRATIONS, '20260919120001_cortex_durable_runtime_rls.sql')],
  ['durable runtime functions', join(MIGRATIONS, '20260919120002_cortex_durable_runtime_functions.sql')],
  // BP-003, because the agent rollback must prove it leaves the workflow
  // tables and THEIR checkpoint trigger function alone.
  ['workflow persistence tables', join(MIGRATIONS, '20260921120000_cortex_workflow_persistence.sql')],
  ['workflow persistence RLS', join(MIGRATIONS, '20260921120001_cortex_workflow_persistence_rls.sql')],
  ['workflow persistence functions', join(MIGRATIONS, '20260921120002_cortex_workflow_persistence_functions.sql')],
  ['agent persistence tables', AGENT_TABLES],
  ['agent persistence RLS', AGENT_RLS],
  ['agent persistence functions', AGENT_FUNCTIONS],
  ['platform grants', join(HARNESS, '06_platform_public_grants.sql')],
];

const ASSERTIONS: readonly (readonly [string, string])[] = [
  ['fixture: two tenants with agent state', join(HARNESS, '410_agent_persistence_fixture.sql')],
  ['SCHEMA CONSTRAINTS', join(HARNESS, '411_assert_agent_schema.sql')],
  ['RLS AND PRIVILEGE', join(HARNESS, '412_assert_agent_rls.sql')],
];

const IDEMPOTENCY: readonly (readonly [string, string])[] = [
  ...CHAIN,
  ['tables again (idempotency)', AGENT_TABLES],
  ['RLS again (idempotency)', AGENT_RLS],
  ['functions again (idempotency)', AGENT_FUNCTIONS],
  ['fixture', join(HARNESS, '410_agent_persistence_fixture.sql')],
  ['SCHEMA CONSTRAINTS, after a re-run', join(HARNESS, '411_assert_agent_schema.sql')],
  ['rollback', AGENT_ROLLBACK],
  ['assert rollback', join(HARNESS, '413_assert_agent_rollback.sql')],
  ['rollback again (idempotency)', AGENT_ROLLBACK],
  ['assert rollback again', join(HARNESS, '413_assert_agent_rollback.sql')],
  ['re-apply tables', AGENT_TABLES],
  ['re-apply RLS', AGENT_RLS],
  ['re-apply functions', AGENT_FUNCTIONS],
  ['fixture after re-apply', join(HARNESS, '410_agent_persistence_fixture.sql')],
  ['SCHEMA CONSTRAINTS, after a rollback and re-apply', join(HARNESS, '411_assert_agent_schema.sql')],
  ['RLS AND PRIVILEGE, after a rollback and re-apply', join(HARNESS, '412_assert_agent_rls.sql')],
];

// ── psql plumbing ───────────────────────────────────────────────────────────

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function connectionArgs(database?: string): readonly string[] {
  if (process.env.DATABASE_URL) {
    return ['-d', database ? withDatabase(process.env.DATABASE_URL, database) : process.env.DATABASE_URL];
  }
  return database ? ['-d', database] : [];
}

function psql(args: readonly string[], options: { database?: string; input?: string } = {}) {
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

/** PostgreSQL argument types per function, so a typed NULL resolves. */
const SIGNATURES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  agent_run_create: [
    ['p_organization_id', 'uuid'], ['p_agent_run_id', 'text'], ['p_agent_id', 'text'],
    ['p_actor_id', 'text'], ['p_state', 'text'], ['p_run_version', 'integer'],
    ['p_checkpoint_version', 'integer'], ['p_created_at', 'timestamptz'],
    ['p_updated_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  agent_run_save: [
    ['p_organization_id', 'uuid'], ['p_agent_run_id', 'text'], ['p_expected_version', 'integer'],
    ['p_state', 'text'], ['p_run_version', 'integer'], ['p_checkpoint_version', 'integer'],
    ['p_updated_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  agent_run_load: [['p_organization_id', 'uuid'], ['p_agent_run_id', 'text']],
  agent_run_list: [
    ['p_organization_id', 'uuid'], ['p_states', 'text[]'], ['p_agent_id', 'text'],
    ['p_actor_id', 'text'], ['p_limit', 'integer'],
  ],
  agent_checkpoint_append: [
    ['p_organization_id', 'uuid'], ['p_agent_run_id', 'text'], ['p_version', 'integer'],
    ['p_progress_digest', 'text'], ['p_previous_digest', 'text'], ['p_agent_id', 'text'],
    ['p_state', 'text'], ['p_step_count', 'integer'], ['p_created_at', 'timestamptz'],
    ['p_record', 'jsonb'],
  ],
  agent_checkpoint_read: [
    ['p_organization_id', 'uuid'], ['p_agent_run_id', 'text'], ['p_version', 'integer'],
  ],
  agent_checkpoint_latest: [['p_organization_id', 'uuid'], ['p_agent_run_id', 'text']],
  agent_checkpoint_history: [['p_organization_id', 'uuid'], ['p_agent_run_id', 'text']],
  agent_approval_create: [
    ['p_organization_id', 'uuid'], ['p_agent_approval_id', 'text'], ['p_agent_run_id', 'text'],
    ['p_action_id', 'text'], ['p_requesting_agent_id', 'text'], ['p_approval_state', 'text'],
    ['p_approval_version', 'integer'], ['p_created_at', 'timestamptz'],
    ['p_expires_at', 'timestamptz'], ['p_decided_at', 'timestamptz'],
    ['p_consumed_at', 'timestamptz'], ['p_updated_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  agent_approval_save: [
    ['p_organization_id', 'uuid'], ['p_agent_approval_id', 'text'], ['p_expected_version', 'integer'],
    ['p_approval_state', 'text'], ['p_approval_version', 'integer'], ['p_decided_at', 'timestamptz'],
    ['p_consumed_at', 'timestamptz'], ['p_updated_at', 'timestamptz'], ['p_record', 'jsonb'],
  ],
  agent_approval_load: [['p_organization_id', 'uuid'], ['p_agent_approval_id', 'text']],
  agent_approval_list: [
    ['p_organization_id', 'uuid'], ['p_agent_run_id', 'text'], ['p_pending_only', 'boolean'],
    ['p_limit', 'integer'],
  ],
};

const SET_RETURNING = new Set([
  'agent_run_load', 'agent_run_list', 'agent_checkpoint_read', 'agent_checkpoint_latest',
  'agent_checkpoint_history', 'agent_approval_load', 'agent_approval_list',
]);

/** Dollar-quoting with a tag the payload cannot contain: no escape processing at all. */
function dollarQuote(value: string): string {
  let tag = 'ag';
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

/** One verb, exactly as `AgentSqlGateway` declares. */
function psqlGateway(database: string): AgentSqlGateway {
  return {
    rpc(fn, args) {
      const signature = SIGNATURES[fn];
      if (!signature) return Promise.reject(new Error(`unknown agent function ${fn}`));
      const call = `public.${fn}(${signature
        .map(([name, type]) => `${name} := ${literal(args[name], type)}`)
        .join(', ')})`;
      const sql = SET_RETURNING.has(fn)
        ? `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)::text FROM ${call} t;`
        : `SELECT to_json(${call})::text;`;
      const run = psql(['-A', '-t'], { database, input: sql });
      if (run.status !== 0) {
        return Promise.reject(new Error(`${fn} failed:\n${(run.stderr ?? '').trim()}`));
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

function sqlHarness(database: string): AgentPersistenceHarness {
  const options = { gateway: psqlGateway(database) };
  const runs = createSqlAgentRunStore(options);
  return {
    name: 'sql',
    runs,
    checkpoints: createSqlAgentCheckpointStore(options),
    approvals: createSqlAgentApprovalStore(options),
    // THE DECLARED ANSWER IS THE KEY-VALUE STORE'S, deliberately. See
    // `sqlAgentStores.ts`.
    missingSaveFailure: 'stale_run_version',
    missingApprovalSaveFailure: 'stale_run_version',
    seedRun: (record) => runs.create(record),
    async reset() {
      const truncate = psql(
        ['-c', 'TRUNCATE public.agent_approvals, public.agent_checkpoints, public.agent_runs CASCADE'],
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

function seedTenants(database: string) {
  const seed = psql(
    [
      '-c',
      `INSERT INTO public.organizations (id, name, slug) VALUES
         ('${AGENT_ALPHA}', 'Alpha', 'alpha'), ('${AGENT_BETA}', 'Beta', 'beta')
       ON CONFLICT (id) DO NOTHING`,
    ],
    { database },
  );
  if (seed.status !== 0) fail(`could not seed tenants:\n${seed.stderr}`);
}

// ── Two live sessions ───────────────────────────────────────────────────────

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

function scalar(database: string, sql: string): string {
  return (psql(['-A', '-t', '-c', sql], { database }).stdout ?? '').trim();
}

const RUN = (version: number, state: string, checkpointVersion = 0) =>
  dollarQuote(
    JSON.stringify({
      context: { runId: 'run_race', organizationId: AGENT_ALPHA, agentId: 'agent.race', actorId: 'user_race' },
      state,
      runVersion: version,
      checkpointVersion,
    }),
  );

async function concurrencyProbes(database: string) {
  console.log(`\nagent persistence: TWO LIVE SESSIONS — scratch database "${database}"`);
  seedTenants(database);

  // ── Two isolates, one run id ──────────────────────────────────────────────
  const createCall = (state: string) =>
    `SELECT 'R=' || public.agent_run_create('${AGENT_ALPHA}'::uuid, 'run_race'::text, 'agent.race'::text,
       'user_race'::text, '${state}'::text, 1::integer, 0::integer,
       '2026-09-22T10:00:00.000Z'::timestamptz, '2026-09-22T10:00:00.000Z'::timestamptz,
       ${RUN(1, state)}::jsonb);`;
  const [c1, c2] = await Promise.all([race(database, createCall('created')), race(database, createCall('cancelled'))]);
  const created = [c1, c2].filter((r) => /R=t/.test(r)).length;
  const refused = [c1, c2].filter((r) => /R=f/.test(r)).length;
  const rows = scalar(database, `SELECT 'N=' || count(*) FROM public.agent_runs WHERE agent_run_id = 'run_race'`);
  if (created !== 1 || refused !== 1 || rows !== 'N=1') {
    fail(`two concurrent creates produced created=${created}, refused=${refused}, ${rows}`);
  }
  console.log('  ✓ two concurrent creates, one agent run id');
  console.log('      ok  one row, one refusal; the loser never overwrote the winner');

  // ── Two isolates, one expected version ────────────────────────────────────
  const saveCall = (state: string) =>
    `SELECT 'S=' || public.agent_run_save('${AGENT_ALPHA}'::uuid, 'run_race'::text, 1::integer,
       '${state}'::text, 2::integer, 1::integer, '2026-09-22T10:05:00.000Z'::timestamptz,
       ${RUN(2, state, 1)}::jsonb);`;
  const [s1, s2] = await Promise.all([race(database, saveCall('planned')), race(database, saveCall('failed'))]);
  const saved = [s1, s2].filter((r) => /S=saved/.test(r)).length;
  const stale = [s1, s2].filter((r) => /S=stale/.test(r)).length;
  if (saved !== 1 || stale !== 1) fail(`two concurrent saves produced saved=${saved}, stale=${stale} (${s1} / ${s2})`);
  const after = scalar(database, `SELECT 'V=' || run_version || ':' || state FROM public.agent_runs WHERE agent_run_id = 'run_race'`);
  if (!/^V=2:(planned|failed)$/.test(after)) fail(`the losing save merged into the winner: ${after}`);
  console.log('  ✓ two concurrent saves, one expected version');
  console.log('      ok  exactly one winner at one version — never a merge of two writes');

  const late = await race(database, saveCall('cancelled'));
  if (!/S=stale/.test(late)) fail(`a stale save was accepted after the winner committed: ${late}`);
  if (scalar(database, `SELECT 'V=' || run_version || ':' || state FROM public.agent_runs WHERE agent_run_id = 'run_race'`) !== after) {
    fail('a stale save changed the record');
  }
  console.log('  ✓ a stalled isolate returning with an old version');
  console.log('      ok  refused, and the winner\'s record is unchanged');

  // ── Two isolates, one checkpoint version ─────────────────────────────────
  const cpCall = (digest: string) =>
    `SELECT 'C=' || public.agent_checkpoint_append('${AGENT_ALPHA}'::uuid, 'run_race'::text, 1::integer,
       '${digest}'::text, NULL::text, 'agent.race'::text, 'created'::text, 0::integer,
       '2026-09-22T10:00:30.000Z'::timestamptz,
       ${dollarQuote(JSON.stringify({ runId: 'run_race', organizationId: AGENT_ALPHA, version: 1, progressDigest: digest, agentId: 'agent.race', state: 'created', stepCount: 0 }))}::jsonb);`;
  const [k1, k2] = await Promise.all([race(database, cpCall('pd_a')), race(database, cpCall('pd_b'))]);
  const wrote = [k1, k2].filter((r) => /C=t/.test(r)).length;
  const cpRows = scalar(database, `SELECT 'N=' || count(*) FROM public.agent_checkpoints WHERE agent_run_id = 'run_race'`);
  if (wrote !== 1 || cpRows !== 'N=1') fail(`two concurrent checkpoint writes produced wrote=${wrote}, ${cpRows}`);
  console.log('  ✓ two concurrent writes, one checkpoint version');
  console.log('      ok  one checkpoint, one conflict');

  const tamper = psql(['-c', `UPDATE public.agent_checkpoints SET progress_digest = 'tampered' WHERE agent_run_id = 'run_race'`], { database });
  if (tamper.status === 0) fail('a written agent checkpoint was rewritten by a direct UPDATE');
  console.log('      ok  and the checkpoint that landed refuses to be rewritten');

  // ── Two deciders, one pending request; two spenders, one approved request ─
  const apRecord = (state: string, version: number, extra: Record<string, string> = {}) =>
    dollarQuote(JSON.stringify({
      approvalId: 'apr_race', runId: 'run_race', actionId: 'act_race', organizationId: AGENT_ALPHA,
      requestingAgentId: 'agent.race', state, approvalVersion: version, singleUse: true,
      expiresAt: '2026-09-22T11:00:00.000Z', ...extra,
    }));
  const created2 = scalar(
    database,
    `SELECT public.agent_approval_create('${AGENT_ALPHA}'::uuid, 'apr_race', 'run_race', 'act_race', 'agent.race',
       'pending', 1, '2026-09-22T10:01:00.000Z', '2026-09-22T11:00:00.000Z', NULL, NULL,
       '2026-09-22T10:01:00.000Z', ${apRecord('pending', 1)}::jsonb)`,
  );
  if (created2 !== 't') fail(`could not create the race approval: ${created2}`);

  // Two DIFFERENT people approving at once. Both say yes so the spend race
  // below always has an approved request to spend; what is asserted is that
  // exactly one of them is recorded as the decider.
  const decide = (decider: string) =>
    `SELECT 'D=' || public.agent_approval_save('${AGENT_ALPHA}'::uuid, 'apr_race'::text, 1::integer,
       'approved'::text, 2::integer, '2026-09-22T10:05:00.000Z'::timestamptz, NULL::timestamptz,
       '2026-09-22T10:05:00.000Z'::timestamptz,
       ${apRecord('approved', 2, { decidedAt: '2026-09-22T10:05:00.000Z', decidedBy: decider })}::jsonb);`;
  const [d1, d2] = await Promise.all([race(database, decide('user_one')), race(database, decide('user_two'))]);
  const decided = [d1, d2].filter((r) => /D=saved/.test(r)).length;
  const finalState = scalar(database, `SELECT approval_state || ':' || approval_version || ':' || (record ->> 'decidedBy') FROM public.agent_approvals WHERE agent_approval_id = 'apr_race'`);
  if (decided !== 1 || !/^approved:2:user_(one|two)$/.test(finalState)) {
    fail(`two concurrent decisions produced decided=${decided}, final=${finalState}`);
  }
  console.log('  ✓ two concurrent decisions, one pending agent approval');
  console.log('      ok  one decider recorded at one version — not a merge of two answers');
  const spend = () =>
    `SELECT 'X=' || public.agent_approval_save('${AGENT_ALPHA}'::uuid, 'apr_race'::text, 2::integer,
       'consumed'::text, 3::integer, '2026-09-22T10:05:00.000Z'::timestamptz,
       '2026-09-22T10:06:00.000Z'::timestamptz, '2026-09-22T10:06:00.000Z'::timestamptz,
       ${apRecord('consumed', 3, { decidedAt: '2026-09-22T10:05:00.000Z', consumedAt: '2026-09-22T10:06:00.000Z' })}::jsonb);`;
  const [x1, x2] = await Promise.all([race(database, spend()), race(database, spend())]);
  const spent = [x1, x2].filter((r) => /X=saved/.test(r)).length;
  if (spent !== 1) fail(`one agent approval was spent ${spent} times (${x1} / ${x2})`);
  console.log('  ✓ two consumers racing to spend one approved agent request');
  console.log('      ok  spent exactly once; singleUse is a guarantee, not an intention');

  // ── A held lock: the mechanism, not only the outcome ─────────────────────
  const held = openSession(database);
  held.send('BEGIN;');
  held.send(
    `SELECT 'HELD=' || public.agent_run_save('${AGENT_ALPHA}'::uuid, 'run_race'::text, 2::integer,
       'paused'::text, 3::integer, 1::integer, '2026-09-22T10:10:00.000Z'::timestamptz,
       ${RUN(3, 'paused', 1)}::jsonb);`,
  );
  await held.until('HELD=');
  if (!/HELD=saved/.test(held.output())) {
    await held.close();
    fail('the held session could not take the row it was supposed to lock');
  }
  const blocked = race(
    database,
    `SELECT 'BLOCKED=' || public.agent_run_save('${AGENT_ALPHA}'::uuid, 'run_race'::text, 2::integer,
       'cancelled'::text, 3::integer, 1::integer, '2026-09-22T10:10:01.000Z'::timestamptz,
       ${RUN(3, 'cancelled', 1)}::jsonb);`,
  );
  held.send('COMMIT;');
  await held.close();
  const blockedResult = await blocked;
  if (!/BLOCKED=stale/.test(blockedResult)) {
    fail(`a second save passed a lock held by an uncommitted one: ${blockedResult}`);
  }
  console.log('  ✓ a save against a row an uncommitted save holds');
  console.log('      ok  it waited, re-read, and found the version had moved — never slipped past');
}

// ── The contract suite, against PostgreSQL ──────────────────────────────────

async function contractSuite(database: string) {
  console.log('\nagent persistence: THE CONTRACT SUITE, against PostgreSQL');
  if (AGENT_PERSISTENCE_CASES.length < 25) {
    fail(`the agent contract suite has only ${AGENT_PERSISTENCE_CASES.length} cases`);
  }
  let passed = 0;
  for (const testCase of AGENT_PERSISTENCE_CASES) {
    const harness = sqlHarness(database);
    await harness.reset();
    seedTenants(database);
    try {
      await testCase.run(harness);
    } catch (error) {
      console.log(`  ✗ ${testCase.name}`);
      fail(`${testCase.name}\n${error instanceof Error ? error.stack : String(error)}`);
    }
    passed += 1;
  }
  console.log(`  ✓ all ${passed} agent persistence contract cases pass against live PostgreSQL`);
  console.log('      ok  the same assertions the memory and key-value suites run, on the same records');
}

// ── Run ─────────────────────────────────────────────────────────────────────

runSteps('agent persistence: schema, constraints, RLS', SCRATCH_DB, [...CHAIN, ...ASSERTIONS]);
await concurrencyProbes(SCRATCH_DB);
await contractSuite(SCRATCH_DB);
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);

runSteps('agent persistence: idempotency, rollback and re-apply', `${SCRATCH_DB}_idem`, IDEMPOTENCY);
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB}_idem WITH (FORCE)`]);

console.log('\n✓ all agent persistence schema, RLS, concurrency, parity, idempotency and rollback scenarios passed');
