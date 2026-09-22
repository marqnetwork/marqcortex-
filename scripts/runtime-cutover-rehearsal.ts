#!/usr/bin/env node
/**
 * A2-P06-C05 / A2-P08-C04 — THE LOCAL CUTOVER REHEARSAL. LOCAL ONLY.
 *
 * The selected strategy, end to end, against a real PostgreSQL 16 and the real
 * engines, with nothing stubbed on the persistence path:
 *
 *   KV authority → freeze → final zero-estate recheck → approved migrations →
 *   sql_frozen → post-cutover verification → sql → live verification
 *
 * THE KEY-VALUE SIDE IS THE REAL ONE. `public.kv_store_324f4fbe` and
 * `kv_compare_and_swap_field`, written exactly as `index.tsx` writes them
 * (`p_value` is the JSON text, so the stored jsonb is a string, read back
 * through `kv_json`) — which is what lets `scripts/a2-zero-estate-recheck.sql`
 * count, in the database, the rows the runtime actually wrote.
 *
 * THE MIGRATIONS ARRIVE MID-REHEARSAL, the way they will in Gate W: the scratch
 * database starts at the hosted migration head's equivalent for these tables
 * (no workflow or agent SQL persistence), and they are applied only after the
 * freeze and the recheck.
 *
 * Scenarios:
 *   A  a non-empty KV estate ABORTS the zero-backfill strategy, and nothing is
 *      dropped, copied or changed
 *   B  the empty-estate cutover of BOTH domains (workflow first, then agent),
 *      with every adversarial case the packet lists that applies to it
 *   C  rollback while the window is open; refused once it has closed
 *   D  A2-P08-C04: the COMPLETE dependency-safe corridor, state by state —
 *      workflow freezes first, agent authority moves first, agent unfreezes
 *      first — ending in real workflow→agent execution on SQL
 *   E  a standalone agent run that lands between the workflow freeze and the
 *      agent freeze is caught by the FINAL recheck (the first freeze snapshot
 *      is not the final estate)
 *   F  the exact reverse corridor as a rollback, and the partial window once
 *      the agent domain holds SQL rows
 *
 * Exit codes: 0 passed, 1 failed, 2 no local database.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyDatabaseTarget,
  localDatabaseEnvironment,
} from '../supabase/functions/server/ai/workflows/persistence/migration/localOnly.ts';
import {
  composeRuntimePersistence,
  type RuntimeKvPorts,
  type RuntimeSqlGateway,
} from '../supabase/functions/server/ai/persistence/runtimePersistenceComposition.ts';
import {
  planTransition,
  type RuntimePersistenceDomain,
  type RuntimePersistenceMode,
} from '../supabase/functions/server/ai/persistence/runtimePersistenceAuthority.ts';
import {
  observationFromRecheck,
  verifyCutover,
  type LivenessStep,
} from '../supabase/functions/server/ai/persistence/runtimeCutoverVerifier.ts';
import { recordEnv } from '../supabase/functions/server/ai/runtime/env.ts';
import { createSupabaseRuntimePersistenceGateway } from '../supabase/functions/server/runtimePersistenceSqlGateway.ts';
import { AGENT_ID, AGENT_TOKEN, buildTestAgentRuntime } from '../supabase/functions/server/ai/__tests__/agentFixtures.ts';
import {
  COMBINED_CUTOVER_SEQUENCE,
  COMBINED_ROLLBACK_SEQUENCE,
  runtimePersistencePairProblem,
} from '../supabase/functions/server/ai/persistence/runtimeCutoverPlan.ts';
import { PART5, buildPart5Runtime } from '../supabase/functions/server/ai/__tests__/workflowFixtures.ts';

// ── Local only, before anything else ────────────────────────────────────────

const target = classifyDatabaseTarget(process.env);
if (!target.ok) {
  console.error(`✗ REFUSED: ${target.problem}`);
  console.error('  The cutover rehearsal runs against a local PostgreSQL and nothing else.');
  process.exit(1);
}
const PSQL_ENV = localDatabaseEnvironment(process.env);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const RECHECK = readFileSync(join(ROOT, 'scripts', 'a2-zero-estate-recheck.sql'), 'utf8');
const SCRATCH = 'cortex_a2_cutover_rehearsal';
const ORG = '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const TENANT = { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: false };

/** The hosted head's equivalent for these tables: no runtime SQL persistence yet. */
const BASE_CHAIN = [
  join(HARNESS, '00_platform_stub.sql'),
  join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql'),
  join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql'),
  join(MIGRATIONS, '20260713000000_kv_store_foundation.sql'),
  join(MIGRATIONS, '20260803120000_kv_compare_and_swap.sql'),
  join(MIGRATIONS, '20260803130000_kv_compare_and_swap_guarded_version.sql'),
  join(MIGRATIONS, '20260804120000_kv_compare_and_swap_field.sql'),
];
/** What Gate W applies for these two domains, in order. */
const RUNTIME_MIGRATIONS = [
  '20260921120000_cortex_workflow_persistence.sql',
  '20260921120001_cortex_workflow_persistence_rls.sql',
  '20260921120002_cortex_workflow_persistence_functions.sql',
  '20260922120000_cortex_agent_persistence.sql',
  '20260922120001_cortex_agent_persistence_rls.sql',
  '20260922120002_cortex_agent_persistence_functions.sql',
].map((file) => join(MIGRATIONS, file));
const ROLLBACKS = [
  join(MIGRATIONS, 'rollbacks', '20260922120000_rollback_agent_persistence.sql'),
  join(MIGRATIONS, 'rollbacks', '20260921120000_rollback_workflow_persistence.sql'),
];

// ── psql ────────────────────────────────────────────────────────────────────

function connection(database?: string): string[] {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    if (database) url.pathname = `/${database}`;
    return ['-d', url.toString()];
  }
  return database ? ['-d', database] : [];
}

function psql(args: readonly string[], database?: string, input?: string) {
  return spawnSync('psql', [...connection(database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    encoding: 'utf8',
    input,
    env: PSQL_ENV,
  });
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`]);
  process.exit(1);
}

function scalar(database: string, sql: string): string {
  const run = psql(['-A', '-t'], database, sql);
  if (run.status !== 0) throw new Error((run.stderr ?? '').trim());
  return (run.stdout ?? '').trim();
}

function applyFiles(database: string, files: readonly string[]) {
  for (const file of files) {
    const run = psql(['-f', file], database);
    if (run.status !== 0) fail(`applying ${file}:\n${run.stderr}`);
  }
}

function freshDatabase() {
  psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`]);
  if (psql(['-c', `CREATE DATABASE ${SCRATCH}`]).status !== 0) fail('could not create the scratch database');
  applyFiles(SCRATCH, BASE_CHAIN);
  scalar(SCRATCH, `INSERT INTO public.organizations (id, name, slug) VALUES
    ('${ORG}', 'MARQ rehearsal', 'marq-rehearsal'), ('${OTHER_ORG}', 'Other', 'other') ON CONFLICT (id) DO NOTHING`);
}

function dq(value: string): string {
  let tag = 'rh';
  while (value.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${value}$${tag}$`;
}

// ── The real key-value store, as `index.tsx` drives it ──────────────────────

function kvPorts(database: string): RuntimeKvPorts {
  const parse = (out: string) => (out === '' ? undefined : JSON.parse(out));
  return {
    read: async (key) => parse(scalar(database, `SELECT value::text FROM public.kv_store_324f4fbe WHERE key = ${dq(key)}`)),
    readByPrefix: async (prefix) => {
      const out = scalar(database, `SELECT coalesce(json_agg(value ORDER BY key), '[]')::text FROM public.kv_store_324f4fbe WHERE starts_with(key, ${dq(prefix)})`);
      return JSON.parse(out) as unknown[];
    },
    compareAndSwap: async (key, field, expected, value) =>
      scalar(database, `SELECT public.kv_compare_and_swap_field(${dq(key)}, ${dq(field)}, ${expected}, to_jsonb(${dq(JSON.stringify(value))}::text))`) === 't',
  };
}

// ── The runtime SQL gateway, over psql, behind the SERVER's allowlist ───────

const SIGNATURES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {};
function signatureOf(database: string, fn: string): readonly (readonly [string, string])[] {
  if (SIGNATURES[fn]) return SIGNATURES[fn];
  const out = scalar(database, `SELECT coalesce(json_agg(json_build_array(n, t) ORDER BY o), '[]')::text FROM (
     SELECT unnest(p.proargnames) AS n, format_type(unnest(p.proargtypes::oid[]), NULL) AS t,
            generate_subscripts(p.proargnames, 1) AS o
       FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname = ${dq(fn)}) s`);
  const parsed = JSON.parse(out) as [string, string][];
  if (parsed.length === 0) throw new Error(`function ${fn} does not exist`);
  (SIGNATURES as Record<string, readonly (readonly [string, string])[]>)[fn] = parsed;
  return parsed;
}

function literal(value: unknown, type: string): string {
  if (value === null || value === undefined) return `NULL::${type}`;
  if (type === 'text[]') {
    const items = (value as unknown[]).map((item) => dq(String(item)));
    return items.length === 0 ? `'{}'::text[]` : `ARRAY[${items.join(', ')}]::text[]`;
  }
  if (type === 'jsonb') return `${dq(JSON.stringify(value))}::jsonb`;
  if (type === 'integer') return `${Number(value)}::integer`;
  if (type === 'boolean') return `${value === true}::boolean`;
  return `${dq(String(value))}::${type === 'timestamp with time zone' ? 'timestamptz' : type}`;
}

/**
 * `supabase.rpc`'s shape, over psql — then wrapped in the SERVER'S gateway, so
 * the rehearsal passes through the same allowlist production will.
 */
function sqlGateway(database: string, options: { down?: () => boolean } = {}): RuntimeSqlGateway {
  return createSupabaseRuntimePersistenceGateway({
    rpc: async (fn, args) => {
      if (options.down?.()) return { data: null, error: { message: 'connection refused (simulated outage)' } };
      try {
        const signature = signatureOf(database, fn);
        const call = `public.${fn}(${signature.map(([name, type]) => `${name} := ${literal(args[name], type)}`).join(', ')})`;
        const setReturning = /_(load|list|read|latest|history)$/.test(fn);
        const out = scalar(database, setReturning
          ? `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)::text FROM ${call} t`
          : `SELECT to_json(${call})::text`);
        return { data: out === '' ? null : JSON.parse(out), error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
      }
    },
  });
}

// ── Composition and observation helpers ─────────────────────────────────────

function compose(database: string, modes: Partial<Record<RuntimePersistenceDomain, RuntimePersistenceMode>>, gateway = sqlGateway(database)) {
  const kv = kvPorts(database);
  return composeRuntimePersistence({
    env: recordEnv({
      ...(modes.workflow ? { AI_WORKFLOW_PERSISTENCE: modes.workflow } : {}),
      ...(modes.agent ? { AI_AGENT_PERSISTENCE: modes.agent } : {}),
    }),
    kv: { workflow: kv, agent: kv },
    sqlGateway: gateway,
    tenant: TENANT,
  });
}

function runtimeOver(composed: ReturnType<typeof compose>, idSeed: string) {
  const wf = composed.workflow.stores!;
  const ag = composed.agent.stores!;
  return buildPart5Runtime({
    tenantId: ORG,
    idSeed,
    runStore: wf.runStore,
    checkpointStore: wf.checkpointStore,
    approvalStore: wf.approvalStore,
    agentRunStore: ag.runStore,
    agentCheckpointStore: ag.checkpointStore,
    agentApprovalStore: ag.approvalStore,
  });
}

function recheck(database: string) {
  return JSON.parse(scalar(database, RECHECK).split('\n').filter((line) => line.startsWith('{')).pop() ?? '{}');
}

function observe(database: string, domain: RuntimePersistenceDomain) {
  return observationFromRecheck(recheck(database), domain);
}

function kvSnapshot(database: string): string {
  return scalar(database, `SELECT md5(coalesce(string_agg(key || '=' || value::text, '|' ORDER BY key), '')) FROM public.kv_store_324f4fbe`);
}

function ok(line: string, detail?: string) {
  console.log(`  ✓ ${line}`);
  if (detail) console.log(`      ok  ${detail}`);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

async function refuses(promise: () => Promise<unknown>, code: string, what: string) {
  try {
    await promise();
  } catch (error) {
    const failure = (error as { failure?: string }).failure;
    expect(failure === code, `${what}: refused with ${failure}, expected ${code}`);
    return;
  }
  fail(`${what}: was accepted`);
}

const TOPIC = { topic: 'Cutover rehearsal' };

// ── Scenario A — a non-empty estate aborts ──────────────────────────────────

async function scenarioAbort() {
  console.log('\nA — a non-empty KV estate ABORTS the zero-backfill strategy');
  freshDatabase();
  const live = runtimeOver(compose(SCRATCH, {}), 'a');
  const parked = await live.workflows.service.startRun({ ...live.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC });
  expect(parked.state === 'waiting_for_approval', `the KV run did not park: ${parked.state}`);
  ok('a real workflow run is parked on an approval in the KV authority');

  expect(planTransition('workflow', 'kv', 'kv_frozen').allowed, 'freezing was refused');
  const before = kvSnapshot(SCRATCH);
  applyFiles(SCRATCH, RUNTIME_MIGRATIONS);
  const pre = { domain: 'workflow' as const, stage: 'pre' as const, mode: 'kv_frozen' as const, tenantConfiguration: TENANT, ...observe(SCRATCH, 'workflow') };
  const verdict = verifyCutover(pre);
  expect(verdict.verdict === 'NO_GO' && verdict.checks.some((c) => c.name === 'kv_estate_zero' && !c.ok), 'the verifier did not refuse a non-empty estate');
  const plan = planTransition('workflow', 'kv_frozen', 'sql_frozen', { kvEstate: pre.kvEstate, sqlEstate: pre.sqlEstate, sqlSchemaPresent: true, tenantConfiguration: TENANT });
  expect(!plan.allowed && plan.code === 'ABORT_ZERO_BACKFILL_STRATEGY', `the controller did not abort: ${JSON.stringify(plan)}`);
  expect(recheck(SCRATCH).verdict === 'ABORT_ZERO_BACKFILL_STRATEGY', 'the hosted recheck script did not say ABORT');
  expect(kvSnapshot(SCRATCH) === before, 'the abort changed the KV estate');
  expect(scalar(SCRATCH, 'SELECT count(*) FROM public.workflow_runs') === '0', 'the abort copied rows to SQL');
  ok('recheck SQL, verifier and controller all ABORT; the KV rows are untouched and nothing reached SQL',
    `KV ${pre.kvEstate?.runs} run(s)/${pre.kvEstate?.checkpoints} checkpoint(s)/${pre.kvEstate?.approvals} approval(s); strategy selection must be re-entered`);
}

// ── Scenario B — the empty-estate cutover of both domains ───────────────────

async function scenarioCutover() {
  console.log('\nB — the empty-estate cutover: workflow first, then agent');
  freshDatabase();

  // 1. KV authority, nothing written.
  expect(recheck(SCRATCH).verdict === 'ZERO_ESTATE', 'the starting estate is not zero');

  // 2. Freeze both domains. A mutation during the freeze is refused and writes nothing.
  for (const domain of ['workflow', 'agent'] as const) expect(planTransition(domain, 'kv', 'kv_frozen').allowed, `${domain} freeze refused`);
  const frozenKv = runtimeOver(compose(SCRATCH, { workflow: 'kv_frozen', agent: 'kv_frozen' }), 'b0');
  await refuses(() => frozenKv.workflows.service.startRun({ ...frozenKv.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC }), 'workflow_persistence_failed', 'a workflow start during the freeze');
  expect(recheck(SCRATCH).verdict === 'ZERO_ESTATE', 'the freeze let a write through');
  ok('both domains frozen on KV; a start during the freeze is refused and writes nothing');

  // 3. Final zero-estate recheck BEFORE the migrations: schema not ready → NO_GO.
  const early = verifyCutover({ domain: 'workflow', stage: 'pre', mode: 'kv_frozen', tenantConfiguration: TENANT, ...observe(SCRATCH, 'workflow') });
  expect(early.verdict === 'NO_GO' && early.checks.filter((c) => !c.ok).every((c) => c.name === 'tables_rls_forced' || c.name === 'functions_present'), 'a missing schema was not the only refusal');
  ok('before the migrations the verifier says NO_GO for exactly the missing schema');

  // 4. The approved migrations.
  applyFiles(SCRATCH, RUNTIME_MIGRATIONS);
  applyFiles(SCRATCH, RUNTIME_MIGRATIONS); // Gate W may have to re-run a step; they are idempotent.

  for (const domain of ['workflow', 'agent'] as const) {
    const pre = verifyCutover({ domain, stage: 'pre', mode: 'kv_frozen', tenantConfiguration: TENANT, ...observe(SCRATCH, domain) });
    expect(pre.verdict === 'GO', `${domain} PRE is ${pre.verdict}: ${JSON.stringify(pre.checks.filter((c) => !c.ok))}`);
    const o = observe(SCRATCH, domain);
    const plan = planTransition(domain, 'kv_frozen', 'sql_frozen', { kvEstate: o.kvEstate, sqlEstate: o.sqlEstate, sqlSchemaPresent: true, tenantConfiguration: TENANT });
    expect(plan.allowed, `${domain} kv_frozen -> sql_frozen refused`);
    // A controller that crashed and re-ran the step must get the same answer.
    const again = planTransition(domain, 'kv_frozen', 'sql_frozen', { kvEstate: o.kvEstate, sqlEstate: o.sqlEstate, sqlSchemaPresent: true, tenantConfiguration: TENANT });
    expect(JSON.stringify(again) === JSON.stringify(plan), 'the transition decision is not deterministic');
  }
  ok('migrations applied twice (idempotent); PRE is GO for both domains; the switch is permitted and repeatable');

  // 5. sql_frozen: reads reach SQL, writes are refused, nothing is written anywhere.
  const sqlFrozen = compose(SCRATCH, { workflow: 'sql_frozen', agent: 'sql_frozen' });
  const reads = await Promise.allSettled([
    sqlFrozen.workflow.stores!.runStore.list({ organizationId: ORG }),
    sqlFrozen.agent.stores!.runStore.list({ organizationId: ORG }),
  ]);
  const frozenSql = runtimeOver(sqlFrozen, 'b1');
  await refuses(() => frozenSql.workflows.service.startRun({ ...frozenSql.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC }), 'workflow_persistence_failed', 'a start while SQL is frozen');
  for (const [index, domain] of (['workflow', 'agent'] as const).entries()) {
    const post = verifyCutover({ domain, stage: 'post', mode: 'sql_frozen', sqlReadSucceeded: reads[index].status === 'fulfilled', ...observe(SCRATCH, domain) });
    expect(post.verdict === 'GO', `${domain} POST is ${post.verdict}: ${JSON.stringify(post.checks.filter((c) => !c.ok))}`);
    expect(planTransition(domain, 'sql_frozen', 'sql', { postCutoverVerified: true }).allowed, `${domain} unfreeze refused`);
  }
  ok('sql_frozen: reads reach SQL through the server gateway, writes refused; POST is GO for both domains');

  // 6. SQL authority, live — the real engines, workflow driving child agents.
  const liveness: LivenessStep[] = [];
  const step = async (name: string, run: () => Promise<boolean>) => {
    try {
      liveness.push({ step: name, ok: await run() });
    } catch (error) {
      liveness.push({ step: name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const composedSql = compose(SCRATCH, { workflow: 'sql', agent: 'sql' });
  const first = runtimeOver(composedSql, 'b2');
  const consultant = first.meta(AGENT_TOKEN.consultant);
  let parked = await first.workflows.service.startRun({ ...consultant, workflowId: PART5.approval.workflowId, input: TOPIC });
  await step('workflow run created and parked on an approval, in SQL', async () =>
    parked.state === 'waiting_for_approval' && scalar(SCRATCH, `SELECT count(*) FROM public.workflow_runs WHERE organization_id = '${ORG}'`) === '1');
  await step('the approval request is a pending SQL row', async () =>
    scalar(SCRATCH, `SELECT approval_state FROM public.workflow_approvals WHERE workflow_run_id = ${dq(parked.workflowRunId)}`) === 'pending');

  // Restart: a new runtime, new composition, nothing in memory carried over.
  const restarted = runtimeOver(compose(SCRATCH, { workflow: 'sql', agent: 'sql' }), 'b3');
  parked = await restarted.workflows.service.getRun({ ...restarted.meta(AGENT_TOKEN.consultant), workflowRunId: parked.workflowRunId });
  await step('a restarted runtime reads the parked run from SQL', async () => parked.state === 'waiting_for_approval');

  const approvalId = parked.pendingApproval!.workflowApprovalId;
  const decisions = await Promise.allSettled([
    restarted.workflows.service.decideApproval({ ...restarted.meta(AGENT_TOKEN.reviewer), workflowApprovalId: approvalId, decision: 'approve', reason: 'First reviewer approves.' }),
    first.workflows.service.decideApproval({ ...first.meta(AGENT_TOKEN.owner), workflowApprovalId: approvalId, decision: 'approve', reason: 'Second reviewer approves.' }),
  ]);
  await step('a second decision from another runtime is refused; exactly one lands (true two-session races: P07/BP-003 live suites)', async () =>
    decisions.filter((d) => d.status === 'fulfilled').length === 1 &&
    scalar(SCRATCH, `SELECT approval_version FROM public.workflow_approvals WHERE workflow_approval_id = ${dq(approvalId)}`) === '2');

  // Checkpoint appended, run save lost: the crash window, under SQL authority.
  let dropped = false;
  const crashing = compose(SCRATCH, { workflow: 'sql', agent: 'sql' });
  const wfStores = crashing.workflow.stores!;
  const crashRuntime = buildPart5Runtime({
    tenantId: ORG, idSeed: 'b4',
    runStore: { ...wfStores.runStore, save: async (record, expected) => {
      if (!dropped && record.checkpointVersion > 0) { dropped = true; throw new Error('isolate died after the checkpoint and before the run save'); }
      return wfStores.runStore.save(record, expected);
    } },
    checkpointStore: wfStores.checkpointStore, approvalStore: wfStores.approvalStore,
    agentRunStore: crashing.agent.stores!.runStore, agentCheckpointStore: crashing.agent.stores!.checkpointStore, agentApprovalStore: crashing.agent.stores!.approvalStore,
  });
  const crashed = await Promise.allSettled([crashRuntime.workflows.service.advanceRun({ ...crashRuntime.meta(AGENT_TOKEN.consultant), workflowRunId: parked.workflowRunId })]);
  const tipAfterCrash = Number(scalar(SCRATCH, `SELECT coalesce(max(version), 0) FROM public.workflow_checkpoints WHERE workflow_run_id = ${dq(parked.workflowRunId)}`));
  const pointerAfterCrash = Number(scalar(SCRATCH, `SELECT checkpoint_version FROM public.workflow_runs WHERE workflow_run_id = ${dq(parked.workflowRunId)}`));
  await step('a crash between checkpoint append and run save leaves the tip one ahead of the pointer', async () =>
    dropped && crashed[0].status === 'rejected' && tipAfterCrash === pointerAfterCrash + 1);

  const recovery = runtimeOver(compose(SCRATCH, { workflow: 'sql', agent: 'sql' }), 'b5');
  let finished = await recovery.workflows.service.advanceRun({ ...recovery.meta(AGENT_TOKEN.consultant), workflowRunId: parked.workflowRunId });
  for (let i = 0; i < 6 && !['completed', 'failed', 'cancelled', 'expired', 'policy_denied'].includes(finished.state); i += 1) {
    finished = await recovery.workflows.service.advanceRun({ ...recovery.meta(AGENT_TOKEN.consultant), workflowRunId: finished.workflowRunId });
  }
  await step('a fresh runtime recovers from the crash window and completes the run', async () => finished.state === 'completed');
  await step('the approval was spent exactly once', async () =>
    scalar(SCRATCH, `SELECT approval_state || ':' || approval_version FROM public.workflow_approvals WHERE workflow_approval_id = ${dq(approvalId)}`) === 'consumed:3');
  await step('the workflow drove its child agents through the SQL agent authority', async () =>
    finished.childAgentRunIds.length > 0 &&
    Number(scalar(SCRATCH, `SELECT count(*) FROM public.agent_runs WHERE organization_id = '${ORG}'`)) === finished.childAgentRunIds.length &&
    Number(scalar(SCRATCH, `SELECT count(*) FROM public.agent_checkpoints WHERE organization_id = '${ORG}'`)) > 0);
  await step('the checkpoint pointer names the chain tip after recovery', async () =>
    scalar(SCRATCH, `SELECT (r.checkpoint_version = (SELECT max(version) FROM public.workflow_checkpoints c WHERE c.workflow_run_id = r.workflow_run_id))::text FROM public.workflow_runs r WHERE r.workflow_run_id = ${dq(parked.workflowRunId)}`) === 'true');
  await step('a stale save of the finished run is refused by the database', async () => {
    try {
      // The REAL stored record, replayed from an older version: exactly what a
      // stalled isolate holding a stale read would send.
      const stored = await composedSql.workflow.stores!.runStore.load(ORG, parked.workflowRunId);
      if (!stored || stored.runVersion < 2) return false;
      await composedSql.workflow.stores!.runStore.save({ ...stored, runVersion: stored.runVersion }, stored.runVersion - 1);
      return false;
    } catch (error) {
      return (error as { failure?: string }).failure === 'stale_workflow_version';
    }
  });
  await step('another tenant sees nothing of it', async () =>
    (await composedSql.workflow.stores!.runStore.list({ organizationId: OTHER_ORG })).length === 0 &&
    (await composedSql.agent.stores!.runStore.list({ organizationId: OTHER_ORG })).length === 0);
  await step('nothing was written to the KV runtime namespaces after the switch', async () => {
    const r = recheck(SCRATCH).kv;
    return [r.workflow, r.agent].every((d: Record<string, number>) => d.runs + d.checkpoints + d.approvals === 0);
  });

  for (const domain of ['workflow', 'agent'] as const) {
    const live = verifyCutover({ domain, stage: 'live', mode: 'sql', liveness });
    if (live.verdict !== 'GO') fail(`${domain} LIVE is NO_GO:\n${JSON.stringify(liveness.filter((s) => !s.ok), null, 2)}`);
  }
  ok(`LIVE is GO for both domains — ${liveness.length} steps against the real engines`, liveness.map((s) => s.step).join('\n          '));

  // 7. A SQL outage under SQL authority: typed failures, and never a KV write.
  let down = true;
  const outage = compose(SCRATCH, { workflow: 'sql', agent: 'sql' }, sqlGateway(SCRATCH, { down: () => down }));
  const kvBefore = kvSnapshot(SCRATCH);
  const outageRuntime = runtimeOver(outage, 'b6');
  await refuses(() => outageRuntime.workflows.service.startRun({ ...outageRuntime.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC }), 'workflow_persistence_failed', 'a start during a SQL outage');
  await refuses(() => outage.agent.stores!.runStore.list({ organizationId: ORG }), 'persistence_failed', 'an agent read during a SQL outage');
  expect(kvSnapshot(SCRATCH) === kvBefore, 'the outage fell back to KV');
  down = false;
  const back = await outage.workflow.stores!.runStore.list({ organizationId: ORG });
  expect(back.length === 1, 'the store did not recover after the outage');
  ok('a SQL outage is a typed failure in both domains; KV is untouched; service resumes when SQL returns');

  // 8. An unsafe tenant configuration cannot select SQL.
  const unsafe = composeRuntimePersistence({ env: recordEnv({ AI_WORKFLOW_PERSISTENCE: 'sql' }), kv: {}, sqlGateway: sqlGateway(SCRATCH), tenant: { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: true } });
  expect(unsafe.workflow.refusing, 'an enabled slug default organization was allowed to select SQL');
  ok('an enabled slug default organization refuses SQL authority at composition');

  // 9. The window has closed: SQL holds rows, so rollback is refused.
  const sqlEstate = observe(SCRATCH, 'workflow').sqlEstate;
  const rollback = planTransition('workflow', 'sql_frozen', 'kv_frozen', { sqlEstate });
  expect(!rollback.allowed && rollback.code === 'ROLLBACK_WINDOW_CLOSED', 'a rollback was allowed after SQL took writes');
  ok('once SQL holds a row, rollback to KV is refused: ROLLBACK_WINDOW_CLOSED');
}

// ── Scenario C — rollback while the window is open ──────────────────────────

async function scenarioRollback() {
  console.log('\nC — rollback while the window is open, and a schema rollback');
  freshDatabase();
  applyFiles(SCRATCH, RUNTIME_MIGRATIONS);
  // Switched to sql_frozen, verification FAILS (simulated), so the operator rolls back.
  const o = observe(SCRATCH, 'workflow');
  expect(planTransition('workflow', 'kv_frozen', 'sql_frozen', { kvEstate: o.kvEstate, sqlEstate: o.sqlEstate, sqlSchemaPresent: true, tenantConfiguration: TENANT }).allowed, 'switch refused');
  expect(!planTransition('workflow', 'sql_frozen', 'sql', { postCutoverVerified: false }).allowed, 'unfreezing without verification was allowed');
  const back = planTransition('workflow', 'sql_frozen', 'kv_frozen', { sqlEstate: observe(SCRATCH, 'workflow').sqlEstate });
  expect(back.allowed, `rollback refused while SQL is empty: ${JSON.stringify(back)}`);
  expect(planTransition('workflow', 'kv_frozen', 'kv').allowed, 'unfreezing KV refused');

  // Back on KV, writing, as before the cutover.
  const restored = runtimeOver(compose(SCRATCH, {}), 'c1');
  const run = await restored.workflows.service.startRun({ ...restored.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC });
  expect(run.state === 'waiting_for_approval', 'the KV authority did not work after the rollback');
  expect(scalar(SCRATCH, 'SELECT count(*) FROM public.workflow_runs') === '0', 'the rolled-back runtime wrote to SQL');
  ok('sql_frozen → kv_frozen → kv while SQL is empty; the KV authority works again and SQL stays empty');

  // And the schema itself rolls back, leaving KV and the tenancy spine intact.
  const kvBefore = kvSnapshot(SCRATCH);
  applyFiles(SCRATCH, ROLLBACKS);
  expect(scalar(SCRATCH, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND (tablename LIKE 'workflow\\_%' OR tablename LIKE 'agent\\_%')`) === '0', 'the schema rollback left runtime tables');
  expect(kvSnapshot(SCRATCH) === kvBefore, 'the schema rollback touched KV');
  const again = verifyCutover({ domain: 'workflow', stage: 'pre', mode: 'kv_frozen', tenantConfiguration: TENANT, ...observe(SCRATCH, 'workflow') });
  expect(again.verdict === 'NO_GO', 'the verifier said GO with no schema');
  ok('schema rollback (agent, then workflow) removes the runtime tables only; KV byte-identical; PRE is NO_GO again');
}

// ── Scenario D — the complete dependency-safe corridor (A2-P08-C04) ─────────

type Pair = { readonly workflow: RuntimePersistenceMode; readonly agent: RuntimePersistenceMode };

function composePair(pair: Pair) {
  if (runtimePersistencePairProblem(pair.workflow, pair.agent) !== undefined) fail(`rehearsal asked for an off-corridor pair ${pair.workflow}/${pair.agent}`);
  const composed = compose(SCRATCH, pair);
  for (const domain of ['workflow', 'agent'] as const) {
    expect(!composed[domain].refusing && composed[domain].pairUnsafe !== true, `${domain} did not compose cleanly at ${pair.workflow}/${pair.agent}: ${composed[domain].problems.join('; ')}`);
    expect(composed[domain].mode === pair[domain], `${domain} mode was changed at ${pair.workflow}/${pair.agent}`);
  }
  return composed;
}

/** A standalone agent run through the REAL agent runtime over a composed pair. */
async function standaloneAgentRun(composed: ReturnType<typeof compose>, seed: string) {
  const harness = buildTestAgentRuntime({ tenantId: ORG, idSeed: seed, ...composed.agent.stores! });
  const meta = harness.meta(AGENT_TOKEN.consultant);
  return harness.runtime.service.createRun(await harness.runtime.service.authorize(meta),
    { agentId: AGENT_ID.primary, objective: 'A standalone agent run.', input: { topic: 'Standalone', script: 'model_then_complete' } }, meta);
}

async function scenarioCorridor() {
  console.log('\nD — the complete dependency-safe corridor, state by state (A2-P08-C04)');
  freshDatabase();
  const states = COMBINED_CUTOVER_SEQUENCE;
  const at = (index: number) => ({ workflow: states[index].workflow, agent: states[index].agent });
  const workflowStart = (composed: ReturnType<typeof compose>, seed: string) => {
    const r = runtimeOver(composed, seed);
    return r.workflows.service.startRun({ ...r.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC });
  };

  // 0 kv/kv — production today, nothing written.
  composePair(at(0));
  expect(recheck(SCRATCH).verdict === 'ZERO_ESTATE', 'the corridor did not start from a zero estate');

  // 1 kv_frozen/kv — the workflow freezes FIRST. Workflow mutation refused;
  //   the agent domain is still writable (asserted by composition, not by a
  //   write, so the estate stays zero for the main path — E proves the write).
  expect(planTransition('workflow', 'kv', 'kv_frozen').allowed, 'workflow freeze refused');
  const s1 = composePair(at(1));
  await refuses(() => workflowStart(s1, 'd1'), 'workflow_persistence_failed', 'a workflow start after the workflow freeze');
  expect(!s1.agent.frozen && s1.agent.authority === 'kv', 'the agent domain was frozen early');
  ok('kv_frozen/kv: workflow frozen first; agent still writable on KV; nothing written');

  // 2 kv_frozen/kv_frozen — the agent freezes. FINAL recheck only now.
  expect(planTransition('agent', 'kv', 'kv_frozen').allowed, 'agent freeze refused');
  const s2 = composePair(at(2));
  await refuses(() => standaloneAgentRun(s2, 'd2'), 'persistence_failed', 'a standalone agent run after both freezes');
  const finalRecheck = recheck(SCRATCH);
  expect(finalRecheck.verdict === 'ZERO_ESTATE', `the FINAL recheck is ${finalRecheck.verdict}`);
  applyFiles(SCRATCH, RUNTIME_MIGRATIONS);
  for (const domain of ['agent', 'workflow'] as const) {
    const pre = verifyCutover({ domain, stage: 'pre', mode: 'kv_frozen', tenantConfiguration: TENANT, ...observe(SCRATCH, domain) });
    expect(pre.verdict === 'GO', `${domain} PRE is ${pre.verdict}`);
  }
  ok('kv_frozen/kv_frozen: both frozen; FINAL recheck ZERO_ESTATE only now; migrations applied; PRE GO both');

  // 3 kv_frozen/sql_frozen — the AGENT authority moves first.
  const o3 = observe(SCRATCH, 'agent');
  expect(planTransition('agent', 'kv_frozen', 'sql_frozen', { kvEstate: o3.kvEstate, sqlEstate: o3.sqlEstate, sqlSchemaPresent: true, tenantConfiguration: TENANT }).allowed, 'agent switch refused');
  const s3 = composePair(at(3));
  const agentRead = await Promise.allSettled([s3.agent.stores!.runStore.list({ organizationId: ORG })]);
  expect(s3.workflow.authority === 'kv' && s3.agent.authority === 'sql', 'authorities are wrong at kv_frozen/sql_frozen');
  await refuses(() => standaloneAgentRun(s3, 'd3'), 'persistence_failed', 'an agent run while the agent is sql_frozen');
  ok('kv_frozen/sql_frozen: agent authority moved to SQL while frozen; workflow still KV-frozen');

  // 4 sql_frozen/sql_frozen — the workflow authority moves.
  const o4 = observe(SCRATCH, 'workflow');
  expect(planTransition('workflow', 'kv_frozen', 'sql_frozen', { kvEstate: o4.kvEstate, sqlEstate: o4.sqlEstate, sqlSchemaPresent: true, tenantConfiguration: TENANT }).allowed, 'workflow switch refused');
  const s4 = composePair(at(4));
  const workflowRead = await Promise.allSettled([s4.workflow.stores!.runStore.list({ organizationId: ORG })]);
  for (const [domain, read] of [['agent', agentRead[0]], ['workflow', workflowRead[0]]] as const) {
    const post = verifyCutover({ domain, stage: 'post', mode: 'sql_frozen', sqlReadSucceeded: read.status === 'fulfilled', ...observe(SCRATCH, domain) });
    expect(post.verdict === 'GO', `${domain} POST is ${post.verdict}: ${JSON.stringify(post.checks.filter((c) => !c.ok))}`);
  }
  await refuses(() => workflowStart(s4, 'd4'), 'workflow_persistence_failed', 'a workflow start at sql_frozen/sql_frozen');
  ok('sql_frozen/sql_frozen: workflow authority moved; POST GO for both domains');

  // 5 sql_frozen/sql — the AGENT goes live first. A standalone agent run lands
  //   in SQL; the workflow is still frozen, so no workflow can drive an agent
  //   across authorities.
  expect(planTransition('agent', 'sql_frozen', 'sql', { postCutoverVerified: true }).allowed, 'agent unfreeze refused');
  const s5 = composePair(at(5));
  const standalone = await standaloneAgentRun(s5, 'd5');
  expect(standalone.state === 'completed', `the standalone agent run on SQL ended ${standalone.state}`);
  expect(scalar(SCRATCH, `SELECT count(*) FROM public.agent_runs WHERE agent_run_id = ${dq(standalone.runId)}`) === '1', 'the standalone agent run is not in SQL');
  await refuses(() => workflowStart(s5, 'd5w'), 'workflow_persistence_failed', 'a workflow start while only the agent is live');
  ok('sql_frozen/sql: agent live on SQL first (a standalone run completed in SQL); workflow still frozen');

  // 6 sql/sql — the workflow goes live LAST: real workflow→agent execution.
  expect(planTransition('workflow', 'sql_frozen', 'sql', { postCutoverVerified: true }).allowed, 'workflow unfreeze refused');
  const s6 = composePair(at(6));
  const liveness: LivenessStep[] = [];
  const first = runtimeOver(s6, 'd6');
  let run = await first.workflows.service.startRun({ ...first.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC });
  liveness.push({ step: 'workflow parked on an approval in SQL', ok: run.state === 'waiting_for_approval' });
  const restarted = runtimeOver(compose(SCRATCH, at(6)), 'd7');
  await restarted.workflows.service.decideApproval({ ...restarted.meta(AGENT_TOKEN.reviewer), workflowApprovalId: run.pendingApproval!.workflowApprovalId, decision: 'approve', reason: 'Approved on the corridor.' });
  for (let i = 0; i < 8 && !['completed', 'failed', 'cancelled', 'expired', 'policy_denied'].includes(run.state); i += 1) {
    run = await restarted.workflows.service.advanceRun({ ...restarted.meta(AGENT_TOKEN.consultant), workflowRunId: run.workflowRunId });
  }
  liveness.push({ step: 'a restarted runtime decided and drove the workflow to completion', ok: run.state === 'completed' });
  const childRows = Number(scalar(SCRATCH, `SELECT count(*) FROM public.agent_runs WHERE agent_run_id IN (${run.childAgentRunIds.map(dq).join(', ') || "''"})`));
  liveness.push({ step: 'every child agent run the workflow drove is in the SQL agent authority', ok: run.childAgentRunIds.length > 0 && childRows === run.childAgentRunIds.length });
  const childCompleted = await Promise.all(run.childAgentRunIds.map(async (id) => (await s6.agent.stores!.runStore.load(ORG, id))?.state));
  liveness.push({ step: 'every child agent run completed', ok: childCompleted.every((state) => state === 'completed') });
  liveness.push({ step: 'no runtime row was written to KV anywhere on the corridor', ok: (() => { const kv = recheck(SCRATCH).kv; return [kv.workflow, kv.agent].every((d: Record<string, number>) => d.runs + d.checkpoints + d.approvals === 0); })() });
  for (const domain of ['workflow', 'agent'] as const) {
    const live = verifyCutover({ domain, stage: 'live', mode: 'sql', liveness });
    expect(live.verdict === 'GO', `${domain} LIVE is NO_GO: ${JSON.stringify(liveness.filter((l) => !l.ok))}`);
  }
  ok(`sql/sql: workflow live LAST; real workflow→agent execution on SQL; LIVE GO both (${run.childAgentRunIds.length} child agent runs)`,
    liveness.map((l) => l.step).join('\n          '));
}

// ── Scenario E — the first freeze snapshot is not the final estate ──────────

async function scenarioLateAgentWrite() {
  console.log('\nE — an agent run between the two freezes is caught by the FINAL recheck');
  freshDatabase();
  const s1 = composePair({ workflow: 'kv_frozen', agent: 'kv' });
  const early = recheck(SCRATCH);
  expect(early.verdict === 'ZERO_ESTATE', 'the estate was not zero at the workflow freeze');
  const late = await standaloneAgentRun(s1, 'e1');
  expect(late.state === 'completed', `the in-window agent run ended ${late.state}`);
  composePair({ workflow: 'kv_frozen', agent: 'kv_frozen' });
  applyFiles(SCRATCH, RUNTIME_MIGRATIONS);
  const final = recheck(SCRATCH);
  const o = observe(SCRATCH, 'agent');
  const plan = planTransition('agent', 'kv_frozen', 'sql_frozen', { kvEstate: o.kvEstate, sqlEstate: o.sqlEstate, sqlSchemaPresent: true, tenantConfiguration: TENANT });
  expect(final.verdict === 'ABORT_ZERO_BACKFILL_STRATEGY' && !plan.allowed && plan.code === 'ABORT_ZERO_BACKFILL_STRATEGY', 'a late agent write was not caught by the final recheck');
  ok('a standalone agent run completed after the workflow froze; the snapshot then was ZERO, the FINAL recheck ABORTs',
    `agent KV ${o.kvEstate?.runs} run(s), ${o.kvEstate?.checkpoints} checkpoint(s): the strategy re-enters selection; nothing is dropped`);
}

// ── Scenario F — the reverse corridor as a rollback ─────────────────────────

async function scenarioReverseCorridor() {
  console.log('\nF — rollback along the exact reverse corridor');
  freshDatabase();
  applyFiles(SCRATCH, RUNTIME_MIGRATIONS);
  // Walk forward to sql_frozen/sql_frozen with nothing written.
  for (const pair of COMBINED_CUTOVER_SEQUENCE.slice(0, 5)) composePair(pair);
  // Roll back from there: every pair composed, every SQL->KV edge judged by the controller.
  const back = COMBINED_ROLLBACK_SEQUENCE.slice(2); // sql_frozen/sql_frozen … kv/kv
  for (const [index, pair] of back.entries()) {
    composePair(pair);
    if (index === 0) continue;
    const previous = back[index - 1];
    for (const domain of ['workflow', 'agent'] as const) {
      if (previous[domain] === pair[domain]) continue;
      const verdict = planTransition(domain, previous[domain], pair[domain], { sqlEstate: observe(SCRATCH, domain).sqlEstate });
      expect(verdict.allowed, `rollback ${domain} ${previous[domain]} -> ${pair[domain]} refused: ${JSON.stringify(verdict)}`);
    }
  }
  const restored = runtimeOver(compose(SCRATCH, {}), 'f1');
  const run = await restored.workflows.service.startRun({ ...restored.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC });
  expect(run.state === 'waiting_for_approval' && scalar(SCRATCH, 'SELECT count(*) FROM public.workflow_runs') === '0', 'KV authority did not resume cleanly after the rollback');
  ok('sql_frozen/sql_frozen → kv_frozen/sql_frozen → kv_frozen/kv_frozen → kv_frozen/kv → kv/kv, each edge permitted; KV works again');

  // The partial window: once the agent is live and has written, the AGENT can
  // no longer go back — the workflow still can.
  freshDatabase();
  applyFiles(SCRATCH, RUNTIME_MIGRATIONS);
  const live = composePair({ workflow: 'sql_frozen', agent: 'sql' });
  await standaloneAgentRun(live, 'f2');
  const agentBack = planTransition('agent', 'sql_frozen', 'kv_frozen', { sqlEstate: observe(SCRATCH, 'agent').sqlEstate });
  const workflowBack = planTransition('workflow', 'sql_frozen', 'kv_frozen', { sqlEstate: observe(SCRATCH, 'workflow').sqlEstate });
  expect(!agentBack.allowed && agentBack.code === 'ROLLBACK_WINDOW_CLOSED', 'the agent rolled back over its own SQL rows');
  expect(workflowBack.allowed, 'the workflow could not roll back though its SQL estate is zero');
  // …and the PAIR corridor says where that leaves the system. The workflow may
  // only return once the agent is refrozen, which lands on kv_frozen/sql_frozen:
  // BOTH frozen, the agent unable to go further back. kv_frozen/sql (workflow on
  // KV beside a writing SQL agent) is off the corridor. The only exit is forward.
  expect(runtimePersistencePairProblem('kv_frozen', 'sql') !== undefined, 'kv_frozen/sql was allowed');
  expect(runtimePersistencePairProblem('kv', 'sql') !== undefined, 'kv/sql was allowed');
  const parked = composePair({ workflow: 'kv_frozen', agent: 'sql_frozen' });
  expect(parked.workflow.frozen && parked.agent.frozen, 'the post-rollback state is writable');
  ok('after agent SQL writes: agent rollback is ROLLBACK_WINDOW_CLOSED; the workflow can only step back to kv_frozen/sql_frozen (both frozen) — the one exit is forward to SQL');
}

// ── Run ─────────────────────────────────────────────────────────────────────

const probe = psql(['-c', 'SELECT 1']);
if (probe.status !== 0) {
  console.error('SKIPPED: no reachable local PostgreSQL.');
  process.exit(2);
}
console.log(`A2 cutover rehearsal — target: ${target.host} (${target.reason})`);
await scenarioAbort();
await scenarioCutover();
await scenarioRollback();
await scenarioCorridor();
await scenarioLateAgentWrite();
await scenarioReverseCorridor();
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`]);
console.log('\n✓ the A2 local cutover rehearsal passed: abort, freeze, recheck, migrate, switch, verify, live, outage, rollback, corridor, late write, reverse corridor');
