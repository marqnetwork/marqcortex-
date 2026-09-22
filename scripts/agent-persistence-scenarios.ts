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
 *   4. THE REAL AGENT RUNTIME over the SQL stores: a run to completion, a
 *      process restart, an approval parked in one runtime and decided in
 *      another, and a second tenant that sees none of it
 *   5. A2-P08-C02: an estate the runtime wrote into KV, translated from a slug
 *      tenant under an explicit mapping, loaded through the SQL stores, read
 *      back fingerprint-identical and readable by the runtime — LOCAL ONLY
 *   6. idempotency, rollback, rollback again, re-apply (harness 413)
 *
 * LOCAL ONLY, ENFORCED. BP-004's `classifyDatabaseTarget` runs before anything
 * else and every child `psql` gets `localDatabaseEnvironment`, because this
 * script now loads translated agent state into whatever it connects to.
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
  createSqlAgentStores,
  type AgentSqlGateway,
} from '../supabase/functions/server/ai/agents/persistence/sqlAgentStores.ts';
import {
  AGENT_ID,
  AGENT_TOKEN,
  buildTestAgentRuntime,
  createFakeKv,
} from '../supabase/functions/server/ai/__tests__/agentFixtures.ts';
import {
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
} from '../supabase/functions/server/ai/agents/persistence/kvAgentStores.ts';
import { runAgentMigrationPreflight } from '../supabase/functions/server/ai/agents/persistence/migration/readiness.ts';
import {
  transformAgentTenant,
  type TransformedAgentBundle,
} from '../supabase/functions/server/ai/agents/persistence/migration/transform.ts';
import { compareAgentFingerprints } from '../supabase/functions/server/ai/agents/persistence/migration/fingerprint.ts';
import type { CanonicalOrganization } from '../supabase/functions/server/ai/workflows/persistence/migration/contracts.ts';
import {
  classifyDatabaseTarget,
  localDatabaseEnvironment,
} from '../supabase/functions/server/ai/workflows/persistence/migration/localOnly.ts';
import {
  AGENT_ALPHA,
  AGENT_BETA,
  AGENT_PERSISTENCE_CASES,
  type AgentPersistenceHarness,
} from '../supabase/functions/server/ai/__tests__/agentPersistenceContract.ts';

const target = classifyDatabaseTarget(process.env);
if (!target.ok) {
  console.error(`✗ REFUSED: ${target.problem}`);
  console.error('  The agent persistence scenarios run against a local PostgreSQL and nothing else.');
  process.exit(1);
}
const PSQL_ENV = localDatabaseEnvironment(process.env);

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
    { encoding: 'utf8', input: options.input, env: PSQL_ENV },
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
    { env: PSQL_ENV, stdio: ['pipe', 'pipe', 'pipe'] },
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
      { env: PSQL_ENV },
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


// ── The real agent runtime, over the SQL stores ─────────────────────────────

/**
 * The contract suite proves the stores; this proves the RUNTIME works on them.
 *
 * Every runtime below is built fresh over a fresh gateway — nothing in memory
 * carries from one to the next, which is what an isolate restart is. The
 * approval is requested by one runtime and decided by another, so the only
 * thing connecting the two halves of that decision is PostgreSQL.
 */
async function runtimeOverSql(database: string) {
  console.log('\nagent persistence: THE REAL AGENT RUNTIME, over the SQL stores');
  await sqlHarness(database).reset();
  seedTenants(database);

  const build = (idSeed: string) => {
    const stores = createSqlAgentStores({ gateway: psqlGateway(database) });
    return buildTestAgentRuntime({
      tenantId: AGENT_ALPHA,
      runStore: stores.runStore,
      checkpointStore: stores.checkpointStore,
      approvalStore: stores.approvalStore,
      idSeed,
    });
  };

  // ── A run to completion, then a restart that finds it ────────────────────
  const first = build('a');
  const meta = first.meta(AGENT_TOKEN.consultant);
  const actor = await first.runtime.service.authorize(meta);
  const done = await first.runtime.service.createRun(
    actor,
    {
      agentId: AGENT_ID.primary,
      objective: 'Run entirely over the SQL agent stores.',
      input: { topic: 'Durability', script: 'model_then_complete' },
    },
    meta,
  );
  if (done.state !== 'completed') fail(`a run over SQL ended ${done.state}, not completed`);

  const restarted = build('b');
  const reader = await restarted.runtime.service.authorize(restarted.meta(AGENT_TOKEN.consultant));
  const recovered = await restarted.runtime.service.getRun(reader, done.runId);
  if (recovered.state !== 'completed' || recovered.stepCount !== 2) {
    fail(`after a restart the run read ${recovered.state}/${recovered.stepCount}`);
  }
  const steps = await restarted.runtime.service.getRunSteps(reader, done.runId);
  if (steps.length !== 2) fail(`after a restart the run had ${steps.length} steps`);
  const history = await restarted.runtime.checkpoints.history(AGENT_ALPHA, done.runId);
  const pointer = scalar(
    database,
    `SELECT checkpoint_version || ':' || (SELECT max(version) FROM public.agent_checkpoints c
       WHERE c.organization_id = r.organization_id AND c.agent_run_id = r.agent_run_id)
     FROM public.agent_runs r WHERE r.agent_run_id = '${done.runId}'`,
  );
  if (history.length < 3 || pointer !== `${history.length}:${history.length}`) {
    fail(`checkpoint history ${history.length}, pointer:tip ${pointer} — the run pointer must name the chain tip`);
  }
  console.log('  ✓ a run completes over SQL and a restarted runtime reads it back');
  console.log(`      ok  ${steps.length} steps, ${history.length} checkpoints, run pointer = chain tip`);

  // ── An approval parked in one runtime and decided in another ─────────────
  const parker = build('c');
  const parkMeta = parker.meta(AGENT_TOKEN.consultant);
  const parkActor = await parker.runtime.service.authorize(parkMeta);
  const parked = await parker.runtime.service.createRun(
    parkActor,
    {
      agentId: AGENT_ID.primary,
      objective: 'Park on an approval over SQL.',
      input: { topic: 'Approvals', script: 'approved_tool_then_complete' },
    },
    parkMeta,
  );
  if (parked.state !== 'waiting_for_approval' || !parked.pendingApprovalId) {
    fail(`the run did not park on an approval: ${parked.state}`);
  }
  const pendingRow = scalar(
    database,
    `SELECT approval_state || ':' || approval_version FROM public.agent_approvals
      WHERE agent_approval_id = '${parked.pendingApprovalId}'`,
  );
  if (pendingRow !== 'pending:1') fail(`the parked approval row reads ${pendingRow}`);

  const decider = build('d');
  const ownerMeta = decider.meta(AGENT_TOKEN.owner);
  const owner = await decider.runtime.service.authorize(ownerMeta);
  const queue = await decider.runtime.service.listPendingApprovals(owner);
  if (!queue.some((entry) => entry.approvalId === parked.pendingApprovalId)) {
    fail('a restarted runtime could not see the pending approval in its queue');
  }
  const released = await decider.runtime.service.submitApproval(
    owner,
    { runId: parked.runId, approvalId: parked.pendingApprovalId, decision: 'approve', reason: 'approved over SQL' },
    ownerMeta,
  );
  if (released.state !== 'completed') fail(`the approved run ended ${released.state}`);
  const spentRow = scalar(
    database,
    `SELECT approval_state || ':' || approval_version || ':' || (consumed_at IS NOT NULL)
       FROM public.agent_approvals WHERE agent_approval_id = '${parked.pendingApprovalId}'`,
  );
  if (spentRow !== 'consumed:3:true') fail(`the approval row after release reads ${spentRow}`);
  console.log('  ✓ an approval requested by one runtime is decided and spent by another');
  console.log('      ok  pending:1 -> consumed:3, the run completed, only PostgreSQL connected the two');

  // ── And a second tenant sees none of it ──────────────────────────────────
  const outsider = build('e');
  const otherMeta = outsider.meta(AGENT_TOKEN.otherTenant);
  const other = await outsider.runtime.service.authorize(otherMeta);
  let leaked = false;
  try {
    await outsider.runtime.service.getRun(other, done.runId);
    leaked = true;
  } catch {
    // Refused: the run does not exist for that tenant.
  }
  if (leaked) fail('TENANT BREACH: another tenant read an agent run over SQL');
  // Asserted at the rows rather than through the other tenant's queue: a
  // consultant may not read a queue at all, and a refusal counted as "empty"
  // would be a pass for the wrong reason.
  const foreignApprovals = scalar(
    database,
    `SELECT count(*) FROM public.agent_approvals WHERE organization_id <> '${AGENT_ALPHA}'`,
  );
  if (foreignApprovals !== '0') fail(`agent approvals were written outside the acting tenant: ${foreignApprovals}`);
  const foreignRows = scalar(
    database,
    `SELECT count(*) FROM public.agent_runs WHERE organization_id <> '${AGENT_ALPHA}'`,
  );
  if (foreignRows !== '0') fail(`agent rows were written outside the acting tenant: ${foreignRows}`);
  console.log('  ✓ another tenant reads no run and no approval through the runtime');
}

// ── A2-P08-C02: a translated estate, accepted by the SQL authority ──────────

/**
 * LOCAL ONLY. An estate the real runtime wrote into the key-value agent stores
 * under the slug tenant `acme` is inventoried, translated under an EXPLICIT
 * mapping to a canonical organization, loaded through the SQL agent stores,
 * and read back. The claims:
 *
 *   the relational constraints accept every translated record;
 *   the read-back is EXACTLY the translated set (exact fingerprint);
 *   the read-back is migration-semantically the source (only tenant moved);
 *   a second load changes nothing — create is insert-if-absent, so an older
 *     copy can never overwrite what is already there;
 *   the real runtime, over SQL, reads the translated runs;
 *   the source rows are byte-for-byte unchanged.
 *
 * This is transformation evidence, not a backfill mechanism: there is no
 * catch-up, no shadowing and no authority change anywhere in it.
 */
async function translatedEstateOverSql(database: string) {
  console.log('\nagent persistence: A2-P08-C02 — a translated estate, accepted by SQL (local only)');
  await sqlHarness(database).reset();
  seedTenants(database);

  // The source: the real runtime, the real key-value stores, the slug tenant.
  const kv = createFakeKv();
  const kvOptions = { read: kv.read, readByPrefix: kv.readByPrefix, compareAndSwap: kv.compareAndSwap };
  const source = buildTestAgentRuntime({
    runStore: createKvAgentRunStore(kvOptions),
    checkpointStore: createKvAgentCheckpointStore(kvOptions),
    approvalStore: createKvAgentApprovalStore(kvOptions),
  });
  const meta = source.meta(AGENT_TOKEN.consultant);
  const actor = await source.runtime.service.authorize(meta);
  for (const script of ['model_then_complete', 'approved_tool_then_complete', 'handoff_then_complete']) {
    await source.runtime.service.createRun(
      actor,
      { agentId: AGENT_ID.primary, objective: `Translate ${script}.`, input: { topic: 'Translation', script } },
      meta,
    );
  }
  const rows = await Promise.all(kv.keys().map(async (key) => ({ key, value: await kv.read(key) })));
  const before = JSON.stringify(rows);

  // The catalog, READ from the scratch database rather than invented.
  const catalogRows = scalar(
    database,
    `SELECT coalesce(json_agg(json_build_object('id', id, 'slug', slug, 'status', status,
       'deleted', deleted_at IS NOT NULL)), '[]') FROM public.organizations`,
  );
  const catalog = JSON.parse(catalogRows) as CanonicalOrganization[];
  const preflight = runAgentMigrationPreflight({
    rows,
    catalog,
    mappings: [{ sourceTenantId: 'acme', targetOrganizationId: AGENT_ALPHA, expectedTargetSlug: 'alpha', reason: 'local rehearsal' }],
    generatedAt: '2026-09-22T00:00:00.000Z',
  });
  const [tenantInventory] = preflight.inventory.tenants;
  const [readiness] = preflight.manifest.tenants;
  if (preflight.manifest.verdict !== 'GO_FOR_LATER_BACKFILL_PACKET' || readiness.tenantClassification !== 'EXPLICIT_MAPPING_RESOLVED') {
    fail(`the rehearsal estate was not cleared: ${JSON.stringify(readiness.blockers)}`);
  }
  const translated = transformAgentTenant(tenantInventory, readiness);
  if (!translated.ok) fail(`the translation was refused: ${translated.problems.join('; ')}`);

  // Load through the SQL stores — the constraints are the judge.
  const load = async () => {
    const stores = createSqlAgentStores({ gateway: psqlGateway(database) });
    let refused = 0;
    for (const bundle of translated.bundles) {
      try { await stores.runStore.create(bundle.run); } catch { refused += 1; }
      for (const checkpoint of bundle.checkpoints) {
        try { await stores.checkpointStore.write(checkpoint); } catch { refused += 1; }
      }
      for (const approval of bundle.approvals) {
        try { await stores.approvalStore.create(approval); } catch { refused += 1; }
      }
    }
    return refused;
  };
  const firstRefusals = await load();
  if (firstRefusals !== 0) fail(`the SQL authority refused ${firstRefusals} translated record(s)`);
  const recordCount = translated.bundles.reduce((n, b) => n + 1 + b.checkpoints.length + b.approvals.length, 0);
  console.log(`  ✓ every translated record accepted by the relational constraints (${recordCount} records)`);

  // Read back through the same stores.
  const stores = createSqlAgentStores({ gateway: psqlGateway(database) });
  const readBack: TransformedAgentBundle[] = [];
  for (const bundle of translated.bundles) {
    const runId = bundle.run.context.runId;
    const run = await stores.runStore.load(AGENT_ALPHA, runId);
    if (!run) fail(`translated run ${runId} did not read back`);
    readBack.push({
      run,
      checkpoints: await stores.checkpointStore.history(AGENT_ALPHA, runId),
      approvals: await stores.approvalStore.list({ organizationId: AGENT_ALPHA, runId, limit: 200 }),
    });
  }
  const exact = compareAgentFingerprints(translated.bundles, readBack, false);
  if (!exact.equivalent) fail('the SQL read-back is not exactly the translated set');
  const semantic = compareAgentFingerprints(
    tenantInventory.bundles.map(({ run, checkpoints, approvals }) => ({ run, checkpoints, approvals })),
    readBack,
    true,
  );
  if (!semantic.equivalent) fail('the SQL read-back is not migration-semantically the source');
  console.log('  ✓ the read-back is EXACTLY the translated set and migration-semantically the source');

  // A second load: every create is refused, nothing is overwritten.
  const secondRefusals = await load();
  if (secondRefusals !== recordCount) fail(`a repeated load was accepted for ${recordCount - secondRefusals} record(s)`);
  const again = compareAgentFingerprints(translated.bundles, await Promise.all(translated.bundles.map(async (b) => ({
    run: (await stores.runStore.load(AGENT_ALPHA, b.run.context.runId))!,
    checkpoints: await stores.checkpointStore.history(AGENT_ALPHA, b.run.context.runId),
    approvals: await stores.approvalStore.list({ organizationId: AGENT_ALPHA, runId: b.run.context.runId, limit: 200 }),
  }))), false);
  if (!again.equivalent) fail('a repeated load changed the stored records');
  console.log('  ✓ a repeated load is refused record by record and changes nothing');

  // The real runtime, over SQL, in the canonical tenant, reads what was moved.
  const reader = buildTestAgentRuntime({ tenantId: AGENT_ALPHA, ...(() => {
    const s = createSqlAgentStores({ gateway: psqlGateway(database) });
    return { runStore: s.runStore, checkpointStore: s.checkpointStore, approvalStore: s.approvalStore };
  })(), idSeed: 'translated' });
  const readerActor = await reader.runtime.service.authorize(reader.meta(AGENT_TOKEN.consultant));
  for (const bundle of translated.bundles) {
    const detail = await reader.runtime.service.getRun(readerActor, bundle.run.context.runId);
    if (detail.state !== bundle.run.state) fail(`the runtime read ${detail.state} for a ${bundle.run.state} run`);
  }
  if (JSON.stringify(rows) !== before) fail('the source rows changed during the rehearsal');
  console.log(`  ✓ the runtime over SQL reads all ${translated.bundles.length} translated runs; the source rows are unchanged`);
  console.log(`      ok  integrity values recomputed: 0; residual source-tenant mentions left verbatim: ${translated.residualSourceTenantReferences}`);
}

// ── Run ─────────────────────────────────────────────────────────────────────

runSteps('agent persistence: schema, constraints, RLS', SCRATCH_DB, [...CHAIN, ...ASSERTIONS]);
await concurrencyProbes(SCRATCH_DB);
await contractSuite(SCRATCH_DB);
await runtimeOverSql(SCRATCH_DB);
await translatedEstateOverSql(SCRATCH_DB);
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`]);

runSteps('agent persistence: idempotency, rollback and re-apply', `${SCRATCH_DB}_idem`, IDEMPOTENCY);
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_DB}_idem WITH (FORCE)`]);

console.log('\n✓ all agent persistence schema, RLS, concurrency, parity, idempotency and rollback scenarios passed');
