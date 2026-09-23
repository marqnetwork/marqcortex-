#!/usr/bin/env node
/**
 * A2 Gate W — THE W6 HOSTED LIVE-SMOKE, REHEARSED LOCALLY. LOCAL ONLY.
 *
 * W6 must prove REAL SQL runtime writes on the hosted deployment, and the only
 * capability registered there is the certified diagnostic readiness review,
 * whose switch defaults OFF. This script runs the EXACT proposed smoke against
 * a local PostgreSQL through the REAL bootstrap (`initializeControlPlane`,
 * the function the edge entry point calls), with dependencies shaped exactly as
 * `index.tsx` supplies them, and MEASURES every row the smoke writes — so the
 * "expected writes" in the Gate W dossier are observed, not predicted.
 *
 * The smoke:
 *   1. AI_DIAGNOSTIC_REVIEW_ENABLED=true, both persistence modes `sql`, real
 *      model requests OFF (the deterministic mock provider answers);
 *   2. one operator (owner role, canonical organization) starts a readiness
 *      review of ONE operator-owned test submission;
 *   3. the run reviews (a draft is sealed) and parks at the approval gate;
 *   4. the operator REJECTS — so the commit stage never runs and no committed
 *      review (the business record of record) is written;
 *   5. the switch is turned back OFF and the capability is shown to be gone,
 *      while the smoke's runtime rows remain readable.
 *
 * Exit codes: 0 passed, 1 failed, 2 no local database.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyDatabaseTarget,
  localDatabaseEnvironment,
} from '../supabase/functions/server/ai/workflows/persistence/migration/localOnly.ts';
import {
  getWorkflowRuntime,
  initializeControlPlane,
  resetControlPlaneForTests,
  type BootstrapDependencies,
} from '../supabase/functions/server/ai/bootstrap.ts';
import { recordEnv } from '../supabase/functions/server/ai/runtime/env.ts';
import { createSupabaseRuntimePersistenceGateway } from '../supabase/functions/server/runtimePersistenceSqlGateway.ts';
import { createKvSubmissionDossierSource } from '../supabase/functions/server/diagnostic/submissionDossierSource.ts';
import { DIAGNOSTIC_QUESTION_CATALOGUE } from '../supabase/functions/server/diagnostic/questionCatalogue.ts';
import { READINESS_REVIEW_WORKFLOW_ID } from '../supabase/functions/server/ai/business/diagnostic/index.ts';
import { DIAGNOSTIC_DOSSIERS, SUBMISSION } from '../supabase/functions/server/ai/__tests__/diagnosticFixtures.ts';
import type { WorkflowRunDetail } from '../supabase/functions/server/ai/workflows/service/workflowRuntimeService.ts';

const target = classifyDatabaseTarget(process.env);
if (!target.ok) {
  console.error(`✗ REFUSED: ${target.problem}`);
  process.exit(1);
}
const PSQL_ENV = localDatabaseEnvironment(process.env);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const HARNESS = join(ROOT, 'tests', 'database', 'harness');
const SCRATCH = 'cortex_a2_smoke_rehearsal';
const SMOKE_SUBMISSION = 'a2-gatew-smoke-0001';
const OPERATOR = { id: '99999999-0000-4000-8000-00000000a201', email: 'operator@marq.test' };

const CHAIN = [
  join(HARNESS, '00_platform_stub.sql'),
  ...[
    '20260711050000_cortex_tenancy_foundation.sql', '20260711050001_cortex_tenancy_rls_and_seed.sql',
    '20260713000000_kv_store_foundation.sql', '20260803120000_kv_compare_and_swap.sql',
    '20260803130000_kv_compare_and_swap_guarded_version.sql', '20260804120000_kv_compare_and_swap_field.sql',
    '20260921120000_cortex_workflow_persistence.sql', '20260921120001_cortex_workflow_persistence_rls.sql',
    '20260921120002_cortex_workflow_persistence_functions.sql', '20260922120000_cortex_agent_persistence.sql',
    '20260922120001_cortex_agent_persistence_rls.sql', '20260922120002_cortex_agent_persistence_functions.sql',
  ].map((file) => join(MIGRATIONS, file)),
];

function connection(database?: string): string[] {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    if (database) url.pathname = `/${database}`;
    return ['-d', url.toString()];
  }
  return database ? ['-d', database] : [];
}
function psql(args: readonly string[], database?: string, input?: string) {
  return spawnSync('psql', [...connection(database), '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], { encoding: 'utf8', input, env: PSQL_ENV });
}
function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`]);
  process.exit(1);
}
function scalar(sql: string): string {
  const run = psql(['-A', '-t'], SCRATCH, sql);
  if (run.status !== 0) throw new Error((run.stderr ?? '').trim());
  return (run.stdout ?? '').trim();
}
function dq(value: string): string {
  let tag = 'sm';
  while (value.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${value}$${tag}$`;
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

// ── Setup: the hosted shape after W2 ────────────────────────────────────────

if (psql(['-c', 'SELECT 1']).status !== 0) {
  console.error('SKIPPED: no reachable local PostgreSQL.');
  process.exit(2);
}
psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`]);
if (psql(['-c', `CREATE DATABASE ${SCRATCH}`]).status !== 0) fail('could not create the scratch database');
for (const file of CHAIN) {
  const run = psql(['-f', file], SCRATCH);
  if (run.status !== 0) fail(`applying ${file}: ${run.stderr}`);
}
// The canonical organization is the one the tenancy seed creates as `marq`,
// exactly as `resolveSubmissionOwnerOrganizationId` resolves it in production.
const MARQ = scalar(`SELECT id FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL`);
expect(/^[0-9a-f-]{36}$/.test(MARQ), 'the seeded marq organization was not found');

// ── The key-value store, as `kv_store.tsx` and `index.tsx` drive it ─────────

const kv = {
  get: async (key: string) => {
    const out = scalar(`SELECT value::text FROM public.kv_store_324f4fbe WHERE key = ${dq(key)}`);
    return out === '' ? undefined : JSON.parse(out);
  },
  set: async (key: string, value: string) => {
    scalar(`INSERT INTO public.kv_store_324f4fbe (key, value) VALUES (${dq(key)}, to_jsonb(${dq(value)}::text))
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  },
  getByPrefix: async (prefix: string) =>
    JSON.parse(scalar(`SELECT coalesce(json_agg(value ORDER BY key), '[]')::text FROM public.kv_store_324f4fbe WHERE starts_with(key, ${dq(prefix)})`)) as unknown[],
};

// ONE operator-owned test submission, stored the way a real diagnostic intake
// stores one, clearly named as the Gate W smoke subject.
const dossier = DIAGNOSTIC_DOSSIERS.find((d) => d.submissionId === SUBMISSION.reviewable)!;
const catalogue = DIAGNOSTIC_QUESTION_CATALOGUE.manufacturing;
await kv.set(`sub:${SMOKE_SUBMISSION}`, JSON.stringify({
  id: SMOKE_SUBMISSION,
  company: 'MARQ Gate W smoke test (operator-owned, not a customer)',
  industryId: 'manufacturing',
  employees: '11-50',
  submittedAt: '2026-09-23T00:00:00.000Z',
  status: dossier.status,
  answers: Object.fromEntries(catalogue.map((q, i) => [String(q.id), dossier.answers[i % dossier.answers.length].answer])),
}));

// ── The real bootstrap, with index.tsx-shaped dependencies ─────────────────

const gateway = createSupabaseRuntimePersistenceGateway({
  rpc: async (fn, args) => {
    try {
      const sig = JSON.parse(scalar(`SELECT coalesce(json_agg(json_build_array(n, t) ORDER BY o), '[]')::text FROM (
        SELECT unnest(p.proargnames) n, format_type(unnest(p.proargtypes::oid[]), NULL) t, generate_subscripts(p.proargnames, 1) o
          FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = ${dq(fn)}) x`)) as [string, string][];
      const lit = (v: unknown, t: string) => v === null || v === undefined ? `NULL::${t === 'timestamp with time zone' ? 'timestamptz' : t}`
        : t === 'text[]' ? ((v as unknown[]).length ? `ARRAY[${(v as unknown[]).map((x) => dq(String(x))).join(',')}]::text[]` : `'{}'::text[]`)
        : t === 'jsonb' ? `${dq(JSON.stringify(v))}::jsonb` : t === 'integer' ? `${Number(v)}` : t === 'boolean' ? `${v === true}`
        : `${dq(String(v))}::${t === 'timestamp with time zone' ? 'timestamptz' : t}`;
      const call = `public.${fn}(${sig.map(([n, t]) => `${n} := ${lit(args[n], t)}`).join(', ')})`;
      const out = scalar(/_(load|list|read|latest|history)$/.test(fn)
        ? `SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)::text FROM ${call} r` : `SELECT to_json(${call})::text`);
      return { data: out === '' ? null : JSON.parse(out), error: null };
    } catch (error) {
      return { data: null, error: { message: String(error) } };
    }
  },
});

function boot(env: Record<string, string>) {
  resetControlPlaneForTests();
  const deps: BootstrapDependencies = {
    env: recordEnv({ AI_DEFAULT_ORGANIZATION_ID: 'marq-cortex', ...env }),
    getUser: (token: string) => Promise.resolve(token === 'token-operator' ? { id: OPERATOR.id, email: OPERATOR.email, roles: ['owner'] } : null),
    listMemberships: (userId: string) => Promise.resolve(userId === OPERATOR.id ? [{ organizationId: MARQ, tier: 'enterprise', roles: ['owner'] }] : []),
    kvWrite: async (key: string, value: unknown) => { await kv.set(key, JSON.stringify(value)); },
    kvRead: async (key: string) => kv.get(key),
    kvReadByPrefix: async (prefix: string) => kv.getByPrefix(prefix),
    kvCompareAndSwapField: async (key: string, field: string, expected: number, value: unknown) =>
      scalar(`SELECT public.kv_compare_and_swap_field(${dq(key)}, ${dq(field)}, ${expected}, to_jsonb(${dq(JSON.stringify(value))}::text))`) === 't',
    runtimePersistenceGateway: gateway,
    diagnosticDossiers: createKvSubmissionDossierSource({ read: (key: string) => kv.get(key), ownerOrganizationId: async () => MARQ }),
  };
  initializeControlPlane(deps);
  const workflows = getWorkflowRuntime();
  expect(workflows, 'bootstrap built no workflow runtime');
  return workflows;
}

const meta = { authorization: 'Bearer token-operator', correlationId: 'cor_a2_gatew_smoke' };
const TERMINAL = ['completed', 'failed', 'cancelled', 'expired', 'policy_denied'];
const SQL_TABLES = ['workflow_runs', 'workflow_checkpoints', 'workflow_approvals', 'agent_runs', 'agent_checkpoints', 'agent_approvals'];
const counts = () => Object.fromEntries(SQL_TABLES.map((t) => [t, Number(scalar(`SELECT count(*) FROM public.${t}`))]));
const kvKeys = () => scalar(`SELECT coalesce(string_agg(key, E'\\n' ORDER BY key), '') FROM public.kv_store_324f4fbe`).split('\n').filter(Boolean);
const namespaceOf = (key: string) => (/^org:[^:]+:ai:([a-z_]+):/.exec(key)?.[1] ?? /^org:[^:]+:ai:([a-z_]+)$/.exec(key)?.[1] ?? key.split(':')[0]);

// ── The smoke ───────────────────────────────────────────────────────────────

console.log(`A2 Gate W — W6 smoke rehearsal (local: ${target.host}); canonical organization ${MARQ}`);
const sqlBefore = counts();
const kvBefore = new Set(kvKeys());
expect(Object.values(sqlBefore).every((n) => n === 0), 'the SQL runtime tables were not empty before the smoke');

const workflows = boot({ AI_DIAGNOSTIC_REVIEW_ENABLED: 'true', AI_WORKFLOW_PERSISTENCE: 'sql', AI_AGENT_PERSISTENCE: 'sql' });
let run: WorkflowRunDetail = await workflows.service.startRun({ ...meta, workflowId: READINESS_REVIEW_WORKFLOW_ID, input: { submissionId: SMOKE_SUBMISSION } });
for (let i = 0; i < 8 && run.state !== 'waiting_for_approval' && !TERMINAL.includes(run.state); i += 1) {
  run = await workflows.service.advanceRun({ ...meta, workflowRunId: run.workflowRunId });
}
expect(run.state === 'waiting_for_approval' && run.pendingApproval, `the smoke run did not park at the approval gate: ${run.state}`);
console.log('  ✓ review ran on the mock provider and parked at the approval gate — rows in SQL');

const decided = await workflows.service.decideApproval({ ...meta, workflowApprovalId: run.pendingApproval!.workflowApprovalId, decision: 'reject', reason: 'A2 Gate W smoke: rejected by design; no commit.' });
expect(decided.approvalState === 'rejected', `the decision was ${decided.approvalState}`);
for (let i = 0; i < 8 && !TERMINAL.includes(run.state); i += 1) {
  run = await workflows.service.advanceRun({ ...meta, workflowRunId: run.workflowRunId });
}
expect(TERMINAL.includes(run.state), `the rejected run did not end: ${run.state}`);
console.log(`  ✓ the operator rejected; the run ended ${run.state}; the commit stage never ran`);

const sqlAfter = counts();
const added = kvKeys().filter((k) => !kvBefore.has(k));
const addedByNamespace = added.reduce<Record<string, number>>((acc, k) => ({ ...acc, [namespaceOf(k)]: (acc[namespaceOf(k)] ?? 0) + 1 }), {});
const foreignRows = SQL_TABLES.reduce((n, t) => n + Number(scalar(`SELECT count(*) FROM public.${t} WHERE organization_id <> '${MARQ}'`)), 0);
expect(sqlAfter.workflow_runs === 1 && sqlAfter.workflow_approvals === 1 && sqlAfter.agent_runs >= 1 && sqlAfter.workflow_checkpoints >= 1 && sqlAfter.agent_checkpoints >= 1, `unexpected SQL writes: ${JSON.stringify(sqlAfter)}`);
expect(scalar(`SELECT approval_state FROM public.workflow_approvals`) === 'rejected', 'the SQL approval row is not rejected');
expect(foreignRows === 0, 'a smoke row landed outside the canonical organization');
expect(!added.some((k) => /:ai:(workflow|agent)_(run|checkpoint|approval):/.test(k)), 'the smoke wrote a runtime row to KV');
expect(!added.some((k) => k.includes(':ai:diagnostic_review:')), 'a committed review (business record) was written');
console.log('  ✓ SQL runtime rows, all in the canonical organization:', JSON.stringify(sqlAfter));
console.log('  ✓ KV rows added (non-runtime namespaces only, NO committed review):', JSON.stringify(addedByNamespace));
// Key SHAPES only (identifiers masked) — the exact list the Gate W dossier states.
const shapeOf = (key: string) =>
  key.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, '<date>').replace(/(_|-)[0-9a-z]{8,}/g, '$1<id>');
const shapes = added.map(shapeOf).reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});
for (const [shape, n] of Object.entries(shapes).sort()) console.log(`      ${n} × ${shape}`);

// ── Disable afterward ───────────────────────────────────────────────────────

const off = boot({ AI_WORKFLOW_PERSISTENCE: 'sql', AI_AGENT_PERSISTENCE: 'sql' });
let refused = false;
try {
  await off.service.startRun({ ...meta, workflowId: READINESS_REVIEW_WORKFLOW_ID, input: { submissionId: SMOKE_SUBMISSION } });
} catch {
  refused = true;
}
expect(refused, 'the capability was still registered after the switch was turned off');
const readBack = await off.service.getRun({ ...meta, workflowRunId: run.workflowRunId });
expect(readBack.state === run.state, 'the smoke run is not readable after disabling the capability');
expect(JSON.stringify(counts()) === JSON.stringify(sqlAfter), 'disabling the capability wrote something');
console.log('  ✓ switch OFF: the capability is gone (start refused), the smoke run remains readable, nothing further written');

psql(['-c', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`]);
console.log('\n✓ W6 smoke rehearsal passed');
