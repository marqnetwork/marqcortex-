#!/usr/bin/env node
/**
 * THE BP-004 CUTOVER PREFLIGHT, REHEARSED AGAINST A REAL POSTGRESQL.
 *
 * ── WHAT THIS PROVES THAT A UNIT TEST CANNOT ───────────────────────────────
 *
 * `workflowCutoverReadiness.test.ts` proves the transformation is correct as
 * arithmetic. It cannot prove that the transformed records are ACCEPTABLE to
 * the relational authority — that every tenant-safe foreign key is satisfied in
 * the order a backfill would write them, that the chain constraint accepts a
 * re-chained history, that the record/column agreement CHECKs hold against a
 * rewritten `organizationId`, and that a listing reads back what was written.
 * Those are statements about what a database DOES, and only a database settles
 * them.
 *
 * It also proves the one negative that matters most: THE SOURCE ROWS ARE NOT
 * TOUCHED. The key-value table is digested before the rehearsal and after it,
 * and the two digests are compared.
 *
 * ── LOCAL ONLY, AND IT FAILS CLOSED ───────────────────────────────────────
 *
 * The first thing this script does is classify its own connection target and
 * exit non-zero if it is not local. BP-004 touches no hosted system, and a
 * warning would not be a control. The rule lives in
 * `workflows/persistence/migration/localOnly.ts` so it is unit-tested rather
 * than merely written here.
 *
 * The verdict is only half of it. `psql` is libpq, and libpq reads the
 * environment it is given — so the child is spawned with a SANITIZED copy from
 * which every connection selector the guard refuses to reason about has been
 * removed. A verdict about this process's environment would mean nothing if the
 * child then inherited a `PGHOSTADDR` nobody looked at.
 *
 * And the target is proven after the fact as well as before it: the first thing
 * the rehearsal asks the database is where the connection came from.
 *
 * ── IT CREATES AND DROPS ITS OWN SCRATCH DATABASE ─────────────────────────
 *
 * Nothing is written to the database named in the connection string, and the
 * scratch database is dropped whether the run passes or fails.
 *
 * Usage:
 *   node --experimental-strip-types scripts/workflow-cutover-readiness-scenarios.ts
 *
 * Exit codes: 0 passed, 1 failed or non-local target, 2 no database reachable.
 * Two is distinct from one on purpose — "not run" must never read as "passed".
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WorkflowRunRecord, WorkflowRunState } from '../supabase/functions/server/ai/workflows/contracts/run.ts';
import type { WorkflowCheckpoint } from '../supabase/functions/server/ai/workflows/contracts/checkpoint.ts';
import type { WorkflowApprovalRecord } from '../supabase/functions/server/ai/workflows/contracts/approval.ts';
import {
  computeCheckpointDigest,
  digestOutputs,
  verifyChain,
} from '../supabase/functions/server/ai/workflows/runtime/checkpointChain.ts';
import { canonicalJson } from '../supabase/functions/server/ai/agents/runtime/digest.ts';
import {
  workflowApprovalKeyFor,
  workflowCheckpointKeyFor,
  workflowRunKeyFor,
} from '../supabase/functions/server/ai/workflows/persistence/kvWorkflowStores.ts';
import {
  createSqlWorkflowApprovalStore,
  createSqlWorkflowCheckpointStore,
  createSqlWorkflowRunStore,
  type WorkflowSqlGateway,
} from '../supabase/functions/server/ai/workflows/persistence/sqlWorkflowStores.ts';
import type {
  CanonicalOrganization,
  WorkflowSourceRow,
  WorkflowTenantMappingEntry,
} from '../supabase/functions/server/ai/workflows/persistence/migration/index.ts';
import {
  BP004_SCRATCH_DATABASE,
  SCHEMA_MARKER_FIELD,
  STRIPPED_LOCATION_VARIABLES,
  WORKFLOW_SOURCE_SCHEMA,
  classifyDatabaseTarget,
  classifyScratchDatabaseName,
  inventoryWorkflowSource,
  localDatabaseEnvironment,
  resolveTenantMappings,
  runWorkflowCutoverPreflight,
  transformTenant,
} from '../supabase/functions/server/ai/workflows/persistence/migration/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * FIXED, not configurable.
 *
 * This name is interpolated into `CREATE DATABASE` and `DROP DATABASE ... WITH
 * (FORCE)`. When it came from the environment, a mistyped variable was a
 * dropped database. It is validated anyway — the constant has to be safe, and a
 * check that runs is worth more than a constant that looks right.
 */
const SCRATCH = classifyScratchDatabaseName(BP004_SCRATCH_DATABASE);
if (!SCRATCH.ok) {
  console.error(`✗ REFUSED: ${SCRATCH.problem}`);
  process.exit(1);
}
const SCRATCH_DB = SCRATCH.name;
const SCRATCH_SQL = SCRATCH.quoted;

const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/**
 * The full chain, not a subset.
 *
 * The key-value store and its compare-and-swap are applied because THIS
 * rehearsal reads its source rows out of `kv_store_324f4fbe` — the real table
 * that holds every workflow record the platform actually has — rather than out
 * of an array in this file.
 */
const CHAIN: readonly (readonly [string, string])[] = [
  ['platform stub', join(HARNESS, '00_platform_stub.sql')],
  ['tenancy foundation', join(MIGRATIONS, '20260711050000_cortex_tenancy_foundation.sql')],
  ['tenancy RLS and seed', join(MIGRATIONS, '20260711050001_cortex_tenancy_rls_and_seed.sql')],
  ['kv store foundation', join(MIGRATIONS, '20260713000000_kv_store_foundation.sql')],
  ['kv compare and swap', join(MIGRATIONS, '20260803120000_kv_compare_and_swap.sql')],
  ['kv compare and swap (guarded)', join(MIGRATIONS, '20260803130000_kv_compare_and_swap_guarded_version.sql')],
  ['kv compare and swap (field)', join(MIGRATIONS, '20260804120000_kv_compare_and_swap_field.sql')],
  ['durable runtime tables', join(MIGRATIONS, '20260919120000_cortex_durable_runtime.sql')],
  ['durable runtime RLS', join(MIGRATIONS, '20260919120001_cortex_durable_runtime_rls.sql')],
  ['durable runtime functions', join(MIGRATIONS, '20260919120002_cortex_durable_runtime_functions.sql')],
  ['workflow persistence tables', join(MIGRATIONS, '20260921120000_cortex_workflow_persistence.sql')],
  ['workflow persistence RLS', join(MIGRATIONS, '20260921120001_cortex_workflow_persistence_rls.sql')],
  ['workflow persistence functions', join(MIGRATIONS, '20260921120002_cortex_workflow_persistence_functions.sql')],
  ['platform grants', join(HARNESS, '06_platform_public_grants.sql')],
];

// ── Local-only guard, before anything else ─────────────────────────────────

const target = classifyDatabaseTarget(process.env);
if (!target.ok) {
  console.error(`✗ REFUSED: ${target.problem}`);
  console.error('  BP-004 is readiness only. It runs against a local PostgreSQL and nothing else.');
  process.exit(1);
}

/**
 * What every `psql` child gets, and the only thing it gets.
 *
 * Built once, here, so there is no route by which a child is spawned with the
 * raw environment — the raw one is not in scope below this line by convention,
 * and `psql()` is the single place a child is created.
 */
const PSQL_ENV = localDatabaseEnvironment(process.env);
const stripped = STRIPPED_LOCATION_VARIABLES.filter(
  (name) => process.env[name] !== undefined && process.env[name] !== '',
);

console.log(`BP-004 cutover readiness — target: ${target.host} (${target.reason})`);
console.log(
  `  child environment sanitized: ${stripped.length === 0 ? 'nothing to strip' : `removed ${stripped.join(', ')}`}`,
);

// ── psql plumbing ───────────────────────────────────────────────────────────

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Read from the SANITIZED environment, not the raw one.
 *
 * Below the guard there is exactly one source of connection facts. Reaching
 * past it to `process.env` here would reintroduce the whole problem one line at
 * a time.
 */
function connectionArgs(database?: string): readonly string[] {
  const url = PSQL_ENV.DATABASE_URL;
  if (url) return ['-d', database ? withDatabase(url, database) : url];
  return database ? ['-d', database] : [];
}

function psql(args: readonly string[], options: { database?: string; input?: string } = {}) {
  return spawnSync(
    'psql',
    [...connectionArgs(options.database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', input: options.input, env: PSQL_ENV },
  );
}

function dropScratch(): void {
  psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH_SQL} WITH (FORCE)`]);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  dropScratch();
  process.exit(1);
}

/** Dollar-quoting with a tag the payload cannot contain. */
function dollarQuote(value: string): string {
  let tag = 'wf';
  while (value.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${value}$${tag}$`;
}

function scalar(database: string, sql: string): string {
  const run = psql(['-A', '-t', '-c', sql], { database });
  if (run.status !== 0) fail(`query failed:\n${(run.stderr ?? '').trim()}\n${sql.slice(0, 300)}`);
  return (run.stdout ?? '').trim();
}

// ── The SQL gateway, over psql ─────────────────────────────────────────────

/**
 * Spelled out rather than inferred: a NULL with no type is a NULL PostgreSQL
 * cannot resolve an overload against. The same table `workflow-persistence-
 * scenarios.ts` carries, restated here rather than exported from a script that
 * an accepted packet owns.
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

const SET_RETURNING = new Set([
  'workflow_run_load', 'workflow_run_list', 'workflow_checkpoint_read',
  'workflow_checkpoint_latest', 'workflow_checkpoint_history',
  'workflow_approval_load', 'workflow_approval_list',
]);

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

// ── The canonical catalog and the fixtures ─────────────────────────────────

const ALPHA = '11111111-1111-4111-8111-111111111111';
const SUSPENDED = '33333333-3333-4333-8333-333333333333';
const DELETED = '44444444-4444-4444-8444-444444444444';
const ABSENT = '55555555-5555-4555-8555-555555555555';
const OMEGA = '66666666-6666-4666-8666-666666666666';

/** Organizations this rehearsal adds beside the ones the tenancy seed creates. */
const SEEDED: readonly CanonicalOrganization[] = [
  { id: ALPHA, slug: 'alpha-workflows', status: 'active', deleted: false },
  { id: OMEGA, slug: 'omega-workflows', status: 'active', deleted: false },
  { id: SUSPENDED, slug: 'suspended-workflows', status: 'suspended', deleted: false },
  { id: DELETED, slug: 'deleted-workflows', status: 'active', deleted: true },
];

/**
 * THE CATALOG IS READ, NOT INVENTED.
 *
 * `20260711050001` seeds an active organization with slug `marq` and a
 * generated id, and that row is the one the manifest below targets. So the
 * mapping in this rehearsal points at a real `organizations.id` that this
 * script did not choose — which is the shape a real manifest has, and it is
 * also why the target is looked up rather than hard-coded.
 */
let CATALOG: readonly CanonicalOrganization[] = [];
let MARQ = '';
let MAPPING: readonly WorkflowTenantMappingEntry[] = [];

function makeChain(organizationId: string, workflowRunId: string, length: number): WorkflowCheckpoint[] {
  const chain: WorkflowCheckpoint[] = [];
  let previousDigest: string | undefined;
  for (let version = 1; version <= length; version += 1) {
    const outputs: Record<string, unknown> = {};
    for (let node = 1; node <= version; node += 1) outputs[`node_${node}`] = { produced: node };
    const body: Omit<WorkflowCheckpoint, 'digest'> = {
      workflowRunId,
      organizationId,
      version,
      createdAt: `2026-09-21T10:0${version}:00.000Z`,
      state: 'running',
      nodeId: `node_${version}`,
      stepCount: version,
      cursorNodeId: `node_${version + 1}`,
      outputs,
      outputsDigest: digestOutputs(outputs),
      loopIterations: {},
      nodeVisits: { [`node_${version}`]: 1 },
      parallel: [],
      ...(previousDigest === undefined ? {} : { previousDigest }),
    };
    const digest = computeCheckpointDigest(body);
    chain.push({ ...body, digest });
    previousDigest = digest;
  }
  return chain;
}

function makeRun(
  organizationId: string,
  workflowRunId: string,
  chain: readonly WorkflowCheckpoint[],
  state: WorkflowRunState = 'running',
): WorkflowRunRecord {
  const tip = chain[chain.length - 1];
  return {
    context: {
      workflowRunId,
      correlationId: 'cor_bp004',
      requestId: 'req_bp004',
      organizationId,
      actorId: 'user_operator',
      actorRoles: ['workflow_operator'],
      origin: { surface: 'team_console', feature: 'cutover-readiness' },
      workflowId: 'wf.review',
      workflowVersion: '1.0.0',
      planDigest: 'plan_digest_bp004',
    },
    runVersion: chain.length + 1,
    state,
    currentNodeId: `node_${chain.length + 1}`,
    stepCount: chain.length,
    parallelGroups: [],
    retries: [],
    usage: { rows: [] } as unknown as WorkflowRunRecord['usage'],
    childAgentRunIds: [],
    steps: [],
    transitions: [],
    transitionsTruncated: 0,
    checkpointVersion: chain.length,
    ...(tip === undefined ? {} : { checkpointDigest: tip.digest }),
    input: { topic: 'quarterly-revenue-review' },
    inputDigest: 'input_digest_bp004',
    configurationVersion: 1,
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:05:00.000Z',
    deadlineAt: '2026-09-21T11:00:00.000Z',
    elapsedRuntimeMs: 300_000,
  };
}

function makeApproval(
  organizationId: string,
  workflowRunId: string,
  overrides: Partial<WorkflowApprovalRecord> = {},
): WorkflowApprovalRecord {
  return {
    workflowApprovalId: `wfa:${workflowRunId}:gate:main:2`,
    workflowRunId,
    organizationId,
    workflowId: 'wf.review',
    nodeId: 'gate',
    requestedBy: 'user_operator',
    reason: 'A human must confirm the finding before it is committed.',
    impactSummary: 'Proceeding writes the reviewed outcome to the submission.',
    estimatedAdditionalTokens: 0,
    estimatedAdditionalCostMicroUsd: 0,
    authorizedRoles: ['workflow_approver'],
    checkpointVersion: 2,
    workflowRunVersion: 3,
    createdAt: '2026-09-21T10:02:30.000Z',
    expiresAt: '2026-09-21T11:02:30.000Z',
    singleUse: true,
    approvalState: 'pending',
    onRejection: 'fail',
    approvalVersion: 1,
    ...overrides,
  };
}

function envelope(kind: 'run' | 'checkpoint' | 'approval', record: unknown): unknown {
  return { ...(record as Record<string, unknown>), [SCHEMA_MARKER_FIELD]: WORKFLOW_SOURCE_SCHEMA[kind] };
}

/** `[key, value, storedAsJsonString]`. */
type SeedRow = readonly [string, unknown, boolean];

function seedRowsFor(): SeedRow[] {
  const rows: SeedRow[] = [];

  // A. A UUID-backed tenant, nothing to remap. Two runs, one of them live.
  for (const [runId, state, links] of [
    ['wfr_alpha_done', 'completed', 3],
    ['wfr_alpha_live', 'waiting_for_approval', 2],
  ] as const) {
    const chain = makeChain(ALPHA, runId, links);
    rows.push([workflowRunKeyFor(ALPHA, runId), envelope('run', makeRun(ALPHA, runId, chain, state)), false]);
    chain.forEach((checkpoint, index) => {
      rows.push([
        workflowCheckpointKeyFor(ALPHA, runId, checkpoint.version),
        envelope('checkpoint', checkpoint),
        // L. Mixed spellings: one link is stored as a JSON string, exactly as
        // the key-value layer sometimes wrote them.
        index === 1,
      ]);
    });
    const approval = makeApproval(ALPHA, runId, runId.endsWith('live') ? {} : {
      approvalState: 'consumed',
      approvalVersion: 3,
      decidedAt: '2026-09-21T10:30:00.000Z',
      decidedBy: 'user_approver',
      decision: 'approve',
      decisionReason: 'reviewed',
      consumedAt: '2026-09-21T10:31:00.000Z',
    });
    rows.push([workflowApprovalKeyFor(ALPHA, approval.workflowApprovalId), envelope('approval', approval), false]);
  }

  // B. A slug-shaped tenant with an explicit mapping. Full re-chain required.
  const legacyChain = makeChain('marq-cortex', 'wfr_legacy', 4);
  rows.push([
    workflowRunKeyFor('marq-cortex', 'wfr_legacy'),
    envelope('run', makeRun('marq-cortex', 'wfr_legacy', legacyChain, 'paused')),
    false,
  ]);
  legacyChain.forEach((checkpoint, index) => {
    rows.push([
      workflowCheckpointKeyFor('marq-cortex', 'wfr_legacy', checkpoint.version),
      envelope('checkpoint', checkpoint),
      index === 2,
    ]);
  });
  const legacyApproval = makeApproval('marq-cortex', 'wfr_legacy', {
    approvalState: 'rejected',
    approvalVersion: 2,
    decidedAt: '2026-09-21T10:20:00.000Z',
    decidedBy: 'user_approver',
    decision: 'reject',
    decisionReason: 'not this quarter',
  });
  rows.push([
    workflowApprovalKeyFor('marq-cortex', legacyApproval.workflowApprovalId),
    envelope('approval', legacyApproval),
    false,
  ]);

  // M. Rows belonging to other parts of the platform. Ignored, never touched.
  rows.push([`org:${ALPHA}:ai:agent_run:run_unrelated`, { anything: true }, false]);
  rows.push(['cortex:submission:sub_9', { email: 'someone@example.com' }, false]);

  return rows;
}

// ── Preflight ───────────────────────────────────────────────────────────────

const probe = psql(['-c', 'SELECT 1']);
if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
  console.error('✗ psql is not on PATH. These scenarios need a real local PostgreSQL 16.');
  process.exit(2);
}
if (probe.status !== 0) {
  console.error('✗ no reachable local PostgreSQL. Start one, or set PGHOST/DATABASE_URL to a local target.');
  console.error((probe.stderr ?? '').trim());
  process.exit(2);
}
for (const [, file] of CHAIN) if (!existsSync(file)) fail(`missing SQL file: ${file}`);

// ── The rehearsal ───────────────────────────────────────────────────────────

/**
 * Record equality that survives a round trip through JSONB.
 *
 * `JSON.stringify` compares KEY ORDER, and PostgreSQL's `jsonb` does not
 * preserve it — a record read back is the same record with its keys in the
 * storage engine's order. Comparing the canonical forms asks the question that
 * was meant: is this the same content?
 */
function sameRecord(left: unknown, right: unknown): boolean {
  const a = canonicalJson(left);
  const b = canonicalJson(right);
  return a !== undefined && a === b;
}

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) fail(`${label}${detail ? `\n    ${detail}` : ''}`);
  console.log(`      ok  ${label}`);
}

function applyChain(database: string): void {
  console.log(`\nmigrations — scratch database "${database}"`);
  dropScratch();
  const create = psql(['-c', `CREATE DATABASE ${SCRATCH_SQL}`]);
  if (create.status !== 0) fail(`could not create ${database}:\n${create.stderr}`);
  for (const [step, file] of CHAIN) {
    const run = psql(['-f', file], { database });
    if (run.status !== 0) {
      console.log(`  ✗ ${step}`);
      fail(`${step}\n${(run.stderr ?? '').trim()}`);
    }
    console.log(`  ✓ ${step}`);
  }
}

function seedOrganizations(database: string): void {
  const values = SEEDED.map(
    (organization) =>
      `('${organization.id}', ${dollarQuote(organization.slug)}, ${dollarQuote(organization.slug)}, ` +
      `'${organization.status}', ${organization.deleted ? 'now()' : 'NULL'})`,
  ).join(', ');
  const run = psql(
    [
      '-c',
      `INSERT INTO public.organizations (id, slug, name, status, deleted_at)
         VALUES ${values}
       ON CONFLICT (id) DO NOTHING`,
    ],
    { database },
  );
  if (run.status !== 0) fail(`could not seed the canonical catalog:\n${run.stderr}`);
  console.log(`  ✓ ${SEEDED.length} organizations seeded beside the tenancy seed's own`);
}

/** The canonical catalog, read read-only out of `public.organizations`. */
function loadCatalog(database: string): void {
  const out = scalar(
    database,
    `SELECT coalesce(json_agg(json_build_object(
              'id', id, 'slug', slug, 'status', status, 'deleted', deleted_at IS NOT NULL
            ) ORDER BY slug), '[]'::json)::text
       FROM public.organizations`,
  );
  CATALOG = JSON.parse(out) as CanonicalOrganization[];
  const marq = CATALOG.find(
    (organization) => organization.slug === 'marq' && organization.status === 'active' && !organization.deleted,
  );
  if (!marq) fail('the tenancy seed did not create an active organization with slug marq');
  MARQ = marq.id;
  MAPPING = [
    {
      sourceTenantId: 'marq-cortex',
      targetOrganizationId: MARQ,
      expectedTargetSlug: 'marq',
      // DECLARED, NOT DERIVED. The preflight would refuse this tenant without
      // this line, and nothing in the modules can write it.
      reason: 'declared for this rehearsal by the operator running it',
    },
  ];
  console.log(`  ✓ canonical catalog read: ${CATALOG.length} organizations, target marq = ${MARQ}`);
}

function seedKvRows(database: string): void {
  const statements = seedRowsFor()
    .map(([key, value, asString]) => {
      const payload = asString ? JSON.stringify(JSON.stringify(value)) : JSON.stringify(value);
      return `INSERT INTO public.kv_store_324f4fbe (key, value) VALUES (${dollarQuote(key)}, ${dollarQuote(payload)}::jsonb);`;
    })
    .join('\n');
  const run = psql(['-f', '-'], { database, input: statements });
  if (run.status !== 0) fail(`could not seed the key-value fixture:\n${run.stderr}`);
  console.log(`  ✓ workflow key-value fixture seeded`);
}

/** Every row in the key-value table, read the way a preflight would read it. */
function readKvRows(database: string): WorkflowSourceRow[] {
  const out = scalar(
    database,
    `SELECT coalesce(json_agg(json_build_object('key', key, 'value', value) ORDER BY key), '[]'::json)::text
       FROM public.kv_store_324f4fbe`,
  );
  return JSON.parse(out) as WorkflowSourceRow[];
}

/** A digest of the whole source table, so "unchanged" is a measurement. */
function kvDigest(database: string): string {
  return scalar(
    database,
    `SELECT coalesce(md5(string_agg(key || '=' || value::text, '|' ORDER BY key)), 'empty')
       FROM public.kv_store_324f4fbe`,
  );
}

async function rehearse(database: string): Promise<void> {
  const gateway = psqlGateway(database);
  const corrupt: string[] = [];
  const options = { gateway, onCorrupt: (where: string, detail: string) => corrupt.push(`${where}: ${detail}`) };
  const runs = createSqlWorkflowRunStore(options);
  const checkpoints = createSqlWorkflowCheckpointStore(options);
  const approvals = createSqlWorkflowApprovalStore(options);

  // WHERE DID THIS CONNECTION ACTUALLY COME FROM? The guard is a statement
  // about the environment; this is a statement about the socket. They are
  // different claims, and only the database can make the second one.
  const origin = scalar(database, `SELECT coalesce(host(inet_client_addr()), 'unix-socket')`);
  console.log('\nconnection origin, as the server sees it');
  check(
    `the server reports the client at ${origin}`,
    origin === 'unix-socket' || origin === '127.0.0.1' || origin === '::1',
    'a BP-004 rehearsal may only reach a local socket or a loopback address',
  );

  console.log('\nsource inventory — read out of the real key-value table');
  const before = kvDigest(database);
  const rows = readKvRows(database);
  const inventory = inventoryWorkflowSource(rows);
  check(`${inventory.sourceRowCount} source rows read, ${inventory.recognizedWorkflowRowCount} of them workflow rows`, inventory.sourceRowCount > 0);
  check('two unrelated key-value rows are ignored, not adopted', inventory.unknownWorkflowRowCount === 2);
  check('two source tenants found', inventory.tenants.length === 2, JSON.stringify(inventory.tenants.map((t) => t.sourceTenantId)));
  check(
    'every recognised row parses',
    inventory.rows.filter((row) => row.kind !== undefined).every((row) => row.classification === 'valid'),
    inventory.rows.filter((row) => row.kind !== undefined && row.classification !== 'valid').map((row) => `${row.key} ${row.classification}`).join('\n    '),
  );
  check('every source chain verifies before anything is computed', inventory.tenants.every((t) => t.invalidChainCount === 0));
  check('every run points at its own chain tip', inventory.tenants.every((t) => t.pointerMismatchCount === 0));

  console.log('\nexplicit tenant mapping');
  const mapping = resolveTenantMappings({
    sourceTenantIds: inventory.tenants.map((tenant) => tenant.sourceTenantId),
    catalog: CATALOG,
    mappings: MAPPING,
  });
  const byTenant = new Map(mapping.resolutions.map((resolution) => [resolution.sourceTenantId, resolution]));
  check('the UUID tenant resolves to itself with no digest rewrite', byTenant.get(ALPHA)?.classification === 'CANONICAL_UUID' && byTenant.get(ALPHA)?.digestRewriteRequired === false);
  check('the slug tenant resolves only through the declared manifest', byTenant.get('marq-cortex')?.classification === 'EXPLICIT_MAPPING_RESOLVED' && byTenant.get('marq-cortex')?.digestRewriteRequired === true);

  console.log('\ntransformation — in memory, nothing written yet');
  const plans: { target: string; source: string; bundles: ReturnType<typeof transformTenant> }[] = [];
  const transformedBundles = new Map<string, ReturnType<typeof transformTenant>>();
  for (const tenant of inventory.tenants) {
    const resolution = byTenant.get(tenant.sourceTenantId);
    if (!resolution?.targetOrganizationId) fail(`tenant ${tenant.sourceTenantId} did not resolve`);
    const verdict = transformTenant(tenant.sourceTenantId, resolution.targetOrganizationId, tenant.bundles);
    if (!verdict.ok) fail(`tenant ${tenant.sourceTenantId} did not transform:\n    ${verdict.problems.join('\n    ')}`);
    transformedBundles.set(tenant.sourceTenantId, verdict);
    plans.push({ target: resolution.targetOrganizationId, source: tenant.sourceTenantId, bundles: verdict });
  }
  const legacy = transformedBundles.get('marq-cortex');
  if (!legacy || !legacy.ok) fail('the remapped tenant produced no plan');
  check(
    'every checkpoint digest in the remapped tenant moved',
    legacy.bundles.every((bundle) => bundle.digestMap.every((entry) => entry.sourceDigest !== entry.transformedDigest)),
  );
  const canonical = transformedBundles.get(ALPHA);
  if (!canonical || !canonical.ok) fail('the canonical tenant produced no plan');
  check(
    'no checkpoint digest in the UUID tenant moved',
    canonical.bundles.every((bundle) => bundle.digestMap.every((entry) => entry.sourceDigest === entry.transformedDigest)),
  );

  console.log('\nbackfill simulation — runs, then checkpoints, then approvals');
  let runCount = 0;
  let checkpointCount = 0;
  let approvalCount = 0;
  for (const plan of plans) {
    if (!plan.bundles.ok) continue;
    // RUNS FIRST. The checkpoint and approval tables carry tenant-safe foreign
    // keys onto `(organization_id, workflow_run_id)`, so any other order is a
    // constraint violation rather than a preference.
    for (const bundle of plan.bundles.bundles) {
      await runs.create(bundle.run);
      runCount += 1;
    }
    for (const bundle of plan.bundles.bundles) {
      for (const checkpoint of bundle.checkpoints) {
        await checkpoints.write(checkpoint);
        checkpointCount += 1;
      }
    }
    for (const bundle of plan.bundles.bundles) {
      for (const approval of bundle.approvals) {
        await approvals.create(approval);
        approvalCount += 1;
      }
    }
  }
  check(`${runCount} runs inserted first`, runCount === 3);
  check(`${checkpointCount} checkpoints satisfied the tenant-safe foreign key`, checkpointCount === 9);
  check(`${approvalCount} approvals satisfied the tenant-safe foreign key`, approvalCount === 3);

  console.log('\nverification — counts, states, chains, pointers, approvals, isolation');
  const sourceRunTotal = inventory.tenants.reduce((total, tenant) => total + tenant.runCount, 0);
  const sourceCheckpointTotal = inventory.tenants.reduce((total, tenant) => total + tenant.checkpointCount, 0);
  const sourceApprovalTotal = inventory.tenants.reduce((total, tenant) => total + tenant.approvalCount, 0);
  check(
    'SQL run count equals the transformed source count',
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_runs')) === sourceRunTotal,
  );
  check(
    'SQL checkpoint count equals the transformed source count',
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_checkpoints')) === sourceCheckpointTotal,
  );
  check(
    'SQL approval count equals the transformed source count',
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_approvals')) === sourceApprovalTotal,
  );

  for (const plan of plans) {
    if (!plan.bundles.ok) continue;
    for (const bundle of plan.bundles.bundles) {
      const runId = bundle.run.context.workflowRunId;
      const stored = await runs.load(plan.target, runId);
      if (!stored) fail(`run ${runId} did not read back`);
      if (stored.state !== bundle.run.state || stored.runVersion !== bundle.run.runVersion) {
        fail(`run ${runId} read back with a different state or version`);
      }
      if (!sameRecord(stored, bundle.run)) {
        fail(`run ${runId} read back as a different record`);
      }
      const history = await checkpoints.history(plan.target, runId);
      if (!sameRecord(history, bundle.checkpoints)) {
        fail(`the chain for ${runId} read back as different records`);
      }
      const verdict = verifyChain(history);
      if (!verdict.ok) fail(`the stored chain for ${runId} does not verify: ${verdict.problem}`);
      const tip = history[history.length - 1];
      if (tip && stored.checkpointDigest !== tip.digest) {
        fail(`the stored run ${runId} does not point at the stored tip`);
      }
      for (const approval of bundle.approvals) {
        const storedApproval = await approvals.load(plan.target, approval.workflowApprovalId);
        if (!storedApproval) fail(`approval ${approval.workflowApprovalId} did not read back`);
        if (!sameRecord(storedApproval, approval)) {
          fail(`approval ${approval.workflowApprovalId} read back as a different record`);
        }
      }
    }
  }
  check('every run, chain and approval reads back as the record that was written', true);
  check('every stored chain verifies with the engine’s own verifier', true);
  check('every stored run points at its stored tip', true);
  check('no stored record was reported corrupt', corrupt.length === 0, corrupt.join('\n    '));

  const alphaList = await runs.list({ organizationId: ALPHA });
  const marqList = await runs.list({ organizationId: MARQ });
  check('the UUID tenant sees only its own runs', alphaList.length === 2 && alphaList.every((r) => r.context.organizationId === ALPHA));
  check('the remapped tenant sees only its own runs', marqList.length === 1 && marqList[0].context.organizationId === MARQ);
  check(
    'no row was written under the source tenant identifier',
    Number(scalar(database, `SELECT count(*) FROM public.workflow_runs WHERE record #>> '{context,organizationId}' = 'marq-cortex'`)) === 0,
  );
  const pending = await approvals.list({ organizationId: ALPHA, pendingOnly: true });
  check('the pending approval queue reads back one request', pending.length === 1);

  console.log('\nreadiness manifest');
  const result = runWorkflowCutoverPreflight({
    rows,
    catalog: CATALOG,
    mappings: MAPPING,
    generatedAt: '2026-09-22T00:00:00.000Z',
    // EARNED, NOT DECLARED. Everything above this line ran.
    localBackfillVerified: true,
  });
  check(`verdict is ${result.manifest.goNoGo}`, result.manifest.goNoGo === 'GO_FOR_LATER_BACKFILL_PACKET', JSON.stringify(result.manifest.reasons));
  check('both tenants are ready and none is blocked', result.manifest.readyTenantCount === 2 && result.manifest.blockedTenantCount === 0);
  for (const tenant of result.manifest.tenants) {
    check(
      `${tenant.sourceTenantId} → ${tenant.targetOrganizationId} (${tenant.sourceFingerprint?.mode}), ` +
        `${tenant.runCount} runs, ${tenant.activeRunCount} active, ${tenant.pendingApprovalCount} pending approvals`,
      tenant.sourceFingerprint?.digest === tenant.transformedFingerprint?.digest,
    );
  }
  check(
    'the manifest reports live runs rather than calling them terminal',
    result.manifest.tenants.reduce((total, tenant) => total + tenant.activeRunCount, 0) === 2,
  );

  console.log('\nthe source is untouched');
  const after = kvDigest(database);
  check('the key-value table digests identically before and after', before === after, `${before} vs ${after}`);
  check(
    'every source row is still present',
    Number(scalar(database, 'SELECT count(*) FROM public.kv_store_324f4fbe')) === rows.length,
  );
}

/**
 * The refusals, each against a fresh set of tables.
 *
 * Every one asserts TWO things: the verdict is NO-GO, and NOTHING came out of
 * the preflight for a later step to pick up. A refusal that still handed over
 * transformed records would be a refusal in name.
 */
async function refusals(database: string): Promise<void> {
  console.log('\nrefusals — each one fails closed and emits no plan');

  const base = readKvRows(database);
  const legacyChain = makeChain('marq-cortex', 'wfr_ref', 3);
  const legacyRun = makeRun('marq-cortex', 'wfr_ref', legacyChain);
  const legacyRows: WorkflowSourceRow[] = [
    { key: workflowRunKeyFor('marq-cortex', 'wfr_ref'), value: envelope('run', legacyRun) },
    ...legacyChain.map((checkpoint) => ({
      key: workflowCheckpointKeyFor('marq-cortex', 'wfr_ref', checkpoint.version),
      value: envelope('checkpoint', checkpoint),
    })),
  ];

  // The source identifier is EXACTLY an active organization's slug. That is the
  // strongest evidence short of a UUID, and it is still not authority.
  const SLUG_TENANT = 'alpha-workflows';
  const slugChain = makeChain(SLUG_TENANT, 'wfr_slug', 2);
  const slugRows: WorkflowSourceRow[] = [
    { key: workflowRunKeyFor(SLUG_TENANT, 'wfr_slug'), value: envelope('run', makeRun(SLUG_TENANT, 'wfr_slug', slugChain)) },
    ...slugChain.map((checkpoint) => ({
      key: workflowCheckpointKeyFor(SLUG_TENANT, 'wfr_slug', checkpoint.version),
      value: envelope('checkpoint', checkpoint),
    })),
  ];

  const tamperedChain = makeChain(ALPHA, 'wfr_tamper', 3);
  const tamperedRows: WorkflowSourceRow[] = [
    { key: workflowRunKeyFor(ALPHA, 'wfr_tamper'), value: envelope('run', makeRun(ALPHA, 'wfr_tamper', tamperedChain)) },
    { key: workflowCheckpointKeyFor(ALPHA, 'wfr_tamper', 1), value: envelope('checkpoint', tamperedChain[0]) },
    { key: workflowCheckpointKeyFor(ALPHA, 'wfr_tamper', 2), value: envelope('checkpoint', { ...tamperedChain[1], stepCount: 99 }) },
    { key: workflowCheckpointKeyFor(ALPHA, 'wfr_tamper', 3), value: envelope('checkpoint', tamperedChain[2]) },
  ];

  const pointerChain = makeChain(ALPHA, 'wfr_point', 3);
  const pointerRows: WorkflowSourceRow[] = [
    {
      key: workflowRunKeyFor(ALPHA, 'wfr_point'),
      value: envelope('run', {
        ...makeRun(ALPHA, 'wfr_point', pointerChain),
        checkpointVersion: 2,
        checkpointDigest: pointerChain[1].digest,
      }),
    },
    ...pointerChain.map((checkpoint) => ({
      key: workflowCheckpointKeyFor(ALPHA, 'wfr_point', checkpoint.version),
      value: envelope('checkpoint', checkpoint),
    })),
  ];

  /** `[label, rows, mappings, [tenant, expected classification]]`. */
  type RefusalCase = readonly [
    string,
    readonly WorkflowSourceRow[],
    readonly WorkflowTenantMappingEntry[],
    readonly [string, string],
  ];

  const cases: readonly RefusalCase[] = [
    ['C. a slug tenant with no mapping at all', legacyRows, [], ['marq-cortex', 'EXPLICIT_MAPPING_REQUIRED']],
    ['D. an exact active-slug candidate with no mapping', slugRows, [], [SLUG_TENANT, 'SLUG_EXACT_CANDIDATE']],
    ['E. a mapping onto an organization that does not exist', legacyRows, [{ sourceTenantId: 'marq-cortex', targetOrganizationId: ABSENT, reason: 'declared' }], ['marq-cortex', 'MAPPING_CONFLICT']],
    ['F1. a mapping onto a suspended organization', legacyRows, [{ sourceTenantId: 'marq-cortex', targetOrganizationId: SUSPENDED, reason: 'declared' }], ['marq-cortex', 'TARGET_INACTIVE_OR_DELETED']],
    ['F2. a mapping onto a deleted organization', legacyRows, [{ sourceTenantId: 'marq-cortex', targetOrganizationId: DELETED, reason: 'declared' }], ['marq-cortex', 'TARGET_INACTIVE_OR_DELETED']],
    [
      'G. two source tenants mapped onto one target',
      [...legacyRows, ...slugRows],
      [
        { sourceTenantId: 'marq-cortex', targetOrganizationId: OMEGA, reason: 'declared' },
        { sourceTenantId: SLUG_TENANT, targetOrganizationId: OMEGA, reason: 'declared' },
      ],
      ['marq-cortex', 'MAPPING_CONFLICT'],
    ],
    ['H. a corrupt source checkpoint chain', tamperedRows, [], [ALPHA, 'CANONICAL_UUID']],
    ['I. an orphan checkpoint', [...base, { key: workflowCheckpointKeyFor(ALPHA, 'wfr_nothing', 1), value: envelope('checkpoint', makeChain(ALPHA, 'wfr_nothing', 1)[0]) }], MAPPING, [ALPHA, 'CANONICAL_UUID']],
    ['J. an orphan approval', [...base, { key: workflowApprovalKeyFor(ALPHA, 'wfa:wfr_nothing:gate:main:2'), value: envelope('approval', makeApproval(ALPHA, 'wfr_nothing')) }], MAPPING, [ALPHA, 'CANONICAL_UUID']],
    ['K. a run pointer that is not the chain tip', pointerRows, [], [ALPHA, 'CANONICAL_UUID']],
    ['corrupt JSON in a workflow row', [...base, { key: workflowRunKeyFor(ALPHA, 'wfr_bad'), value: '{ not json' }], MAPPING, [ALPHA, 'CANONICAL_UUID']],
  ];

  const countsBefore = [
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_runs')),
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_checkpoints')),
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_approvals')),
  ];

  for (const [label, rows, mappings, [tenantId, classification]] of cases) {
    const result = runWorkflowCutoverPreflight({
      rows,
      catalog: CATALOG,
      mappings,
      generatedAt: '2026-09-22T00:00:00.000Z',
      localBackfillVerified: true,
    });
    if (result.manifest.goNoGo !== 'NO_GO') fail(`${label} did not produce NO-GO`);
    if (result.plans.length !== 0) fail(`${label} produced ${result.plans.length} plan(s) despite NO-GO`);
    if (result.manifest.reasons.length === 0) fail(`${label} produced NO-GO with no reason`);
    // The LABEL has to be true, not just the verdict: a case that refused for
    // the wrong reason is a case that is not testing what it says it is.
    const tenant = result.manifest.tenants.find((entry) => entry.sourceTenantId === tenantId);
    if (!tenant) fail(`${label} produced no readiness entry for ${tenantId}`);
    if (tenant.classification !== classification) {
      fail(`${label} classified ${tenantId} as ${tenant.classification}, expected ${classification}`);
    }
    if (tenant.readiness !== 'NO_GO') fail(`${label} left ${tenantId} ready`);
    console.log(`      ok  ${label} → ${classification}, NO_GO, no plan emitted`);
  }

  const countsAfter = [
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_runs')),
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_checkpoints')),
    Number(scalar(database, 'SELECT count(*) FROM public.workflow_approvals')),
  ];
  check(
    'no refusal wrote a single row',
    countsBefore.join(',') === countsAfter.join(','),
    `${countsBefore.join(',')} vs ${countsAfter.join(',')}`,
  );

  await Promise.resolve();
}

// ── Run ─────────────────────────────────────────────────────────────────────

applyChain(SCRATCH_DB);
seedOrganizations(SCRATCH_DB);
loadCatalog(SCRATCH_DB);
seedKvRows(SCRATCH_DB);

try {
  await rehearse(SCRATCH_DB);
  await refusals(SCRATCH_DB);
} catch (error) {
  fail(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
}

// ROLLBACK. The scratch database is dropped on every path out of this script,
// including the failure paths above.
dropScratch();
const remaining = psql(['-A', '-t', '-c', `SELECT count(*) FROM pg_database WHERE datname = '${SCRATCH_DB}'`]);
if ((remaining.stdout ?? '').trim() !== '0') fail('the scratch database survived the rollback');

console.log('\n✓ BP-004 cutover readiness: inventory, mapping, re-chaining, local backfill, refusals and rollback all passed');
console.log('  Production authority is unchanged. The key-value stores remain the workflow authority.');
