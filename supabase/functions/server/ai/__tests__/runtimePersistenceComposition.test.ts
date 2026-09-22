/**
 * A2-P06-C03 — the composition, the freeze and the refusals, behaviourally.
 *
 * Driven through the REAL workflow and agent runtimes wherever a claim is about
 * what the runtime can do, and through the stores directly where it is about
 * the seam. Every "nothing was written" claim is checked against the backing
 * store, not against a return value.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { composeRuntimePersistence, type RuntimeKvPorts } from '../persistence/runtimePersistenceComposition.ts';
import { recordEnv } from '../runtime/env.ts';
import { AGENT_ID, AGENT_TOKEN, buildTestAgentRuntime, createFakeKv } from './agentFixtures.ts';
import { PART5, buildPart5Runtime } from './workflowFixtures.ts';
import { isAgentRuntimeError } from '../agents/contracts/failures.ts';
import { AGENT_RPC } from '../agents/persistence/sqlAgentStores.ts';
import { WORKFLOW_RPC } from '../workflows/persistence/sqlWorkflowStores.ts';
import {
  RUNTIME_PERSISTENCE_FUNCTIONS,
  createSupabaseRuntimePersistenceGateway,
} from '../../runtimePersistenceSqlGateway.ts';

const HOSTED_TENANT = { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: false };
const TOPIC = { topic: 'Persistence cutover' };

function kvPorts(kv = createFakeKv()): { kv: ReturnType<typeof createFakeKv>; ports: RuntimeKvPorts } {
  return { kv, ports: { read: kv.read, readByPrefix: kv.readByPrefix, compareAndSwap: kv.compareAndSwap } };
}

function recordingGateway() {
  const calls: string[] = [];
  return {
    calls,
    rpc(fn: string) {
      calls.push(fn);
      return Promise.resolve(fn.endsWith('_list') || fn.endsWith('_load') || fn.endsWith('_history') || fn.endsWith('_latest') || fn.endsWith('_read') ? [] : true);
    },
  };
}

function compose(env: Record<string, string | undefined>, kv: RuntimeKvPorts | undefined, gateway?: ReturnType<typeof recordingGateway>, tenant = HOSTED_TENANT) {
  return composeRuntimePersistence({
    env: recordEnv(env),
    ...(kv === undefined ? {} : { kv: { workflow: kv, agent: kv } }),
    ...(gateway === undefined ? {} : { sqlGateway: gateway }),
    tenant,
  });
}

/** Every provider attempt the control plane has recorded, success or failure. */
function providerCalls(harness: ReturnType<typeof buildTestAgentRuntime>): number {
  const health = harness.plane.health();
  return health.providers.reduce((sum, provider) => sum + provider.successCount + provider.failureCount, 0);
}

const failedWith = (code: string) => (error: unknown) => {
  assert.equal((error as { failure?: string }).failure, code);
  return true;
};

describe('A2-P06-C03 — the default is today\'s production: KV, writing', () => {
  it('an unset environment builds the key-value stores for both domains, and never touches SQL', async () => {
    const { kv, ports } = kvPorts();
    const gateway = recordingGateway();
    const composed = compose({}, ports, gateway);
    for (const domain of ['workflow', 'agent'] as const) {
      assert.equal(composed[domain].mode, 'kv');
      assert.equal(composed[domain].authority, 'kv');
      assert.equal(composed[domain].frozen, false);
      assert.equal(composed[domain].refusing, false);
    }
    const harness = buildPart5Runtime({
      runStore: composed.workflow.stores!.runStore,
      checkpointStore: composed.workflow.stores!.checkpointStore,
      approvalStore: composed.workflow.stores!.approvalStore,
      agentRunStore: composed.agent.stores!.runStore,
      agentCheckpointStore: composed.agent.stores!.checkpointStore,
      agentApprovalStore: composed.agent.stores!.approvalStore,
    });
    const detail = await harness.workflows.service.startRun({ ...harness.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC });
    assert.equal(detail.state, 'waiting_for_approval');
    assert.ok(kv.keys().some((key) => key.includes(':ai:workflow_run:')), 'the run was written to KV');
    assert.deepEqual(gateway.calls, [], 'the default mode never reached SQL');
  });

  it('kv with no key-value ports keeps today\'s behaviour (the runtimes\' own stores)', () => {
    const composed = compose({}, undefined);
    assert.equal(composed.workflow.stores, undefined);
    assert.equal(composed.agent.stores, undefined);
    assert.equal(composed.workflow.refusing, false);
  });
});

describe('A2-P06-C03 — the freeze is at the store seam, so it covers every mutation', () => {
  it('refuses all six mutation methods per domain and serves every read', async () => {
    const { kv, ports } = kvPorts();
    const composed = compose({ AI_WORKFLOW_PERSISTENCE: 'kv_frozen', AI_AGENT_PERSISTENCE: 'kv_frozen' }, ports);
    const wf = composed.workflow.stores!;
    const ag = composed.agent.stores!;
    const writesBefore = kv.writes;
    const any = {} as never;
    for (const attempt of [
      () => wf.runStore.create(any), () => wf.runStore.save(any, 1), () => wf.checkpointStore.write(any),
      () => wf.approvalStore.create(any), () => wf.approvalStore.save(any, 1),
    ]) await assert.rejects(attempt, failedWith('workflow_persistence_failed'));
    for (const attempt of [
      () => ag.runStore.create(any), () => ag.runStore.save(any, 1), () => ag.checkpointStore.write(any),
      () => ag.approvalStore.create(any), () => ag.approvalStore.save(any, 1),
    ]) await assert.rejects(attempt, failedWith('persistence_failed'));
    assert.equal(kv.writes, writesBefore, 'nothing reached the store');
    assert.deepEqual(await wf.runStore.list({ organizationId: 'acme' }), []);
    assert.deepEqual(await ag.approvalStore.list({ organizationId: 'acme' }), []);
    assert.equal(await ag.checkpointStore.latest('acme', 'run_x'), undefined);
  });

  it('a frozen agent runtime refuses a new run BEFORE any model call, and writes nothing', async () => {
    const { kv, ports } = kvPorts();
    const composed = compose({ AI_AGENT_PERSISTENCE: 'kv_frozen' }, ports);
    const harness = buildTestAgentRuntime(composed.agent.stores!);
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);
    await assert.rejects(
      () => harness.runtime.service.createRun(actor, { agentId: AGENT_ID.primary, objective: 'Frozen.', input: { topic: 'Frozen', script: 'model_then_complete' } }, meta),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'persistence_failed',
    );
    assert.equal(kv.keys().length, 0);
    assert.equal(providerCalls(harness), 0, 'no provider call was made for a run that could not be recorded');

    // POSITIVE CONTROL, so the measure above cannot pass for the wrong reason:
    // the same run, unfrozen, does reach a provider.
    const live = buildTestAgentRuntime(compose({}, kvPorts().ports).agent.stores!);
    const liveMeta = live.meta(AGENT_TOKEN.consultant);
    await live.runtime.service.createRun(await live.runtime.service.authorize(liveMeta), { agentId: AGENT_ID.primary, objective: 'Live.', input: { topic: 'Live', script: 'model_then_complete' } }, liveMeta);
    assert.ok(providerCalls(live) > 0, 'the control run made a provider call');
  });

  it('a decision that arrives during the freeze is refused and the approval is unchanged', async () => {
    const { kv, ports } = kvPorts();
    // Park a workflow on an approval while writing is allowed …
    const live = compose({}, ports).workflow.stores!;
    const agentLive = compose({}, ports).agent.stores!;
    const before = buildPart5Runtime({ ...live, agentRunStore: agentLive.runStore, agentCheckpointStore: agentLive.checkpointStore, agentApprovalStore: agentLive.approvalStore });
    const parked = await before.workflows.service.startRun({ ...before.meta(AGENT_TOKEN.consultant), workflowId: PART5.approval.workflowId, input: TOPIC });
    const approvalId = parked.pendingApproval!.workflowApprovalId;
    // … then freeze, restart, and try to decide it.
    const frozen = compose({ AI_WORKFLOW_PERSISTENCE: 'kv_frozen', AI_AGENT_PERSISTENCE: 'kv_frozen' }, ports);
    const after = buildPart5Runtime({ ...frozen.workflow.stores!, agentRunStore: frozen.agent.stores!.runStore, agentCheckpointStore: frozen.agent.stores!.checkpointStore, agentApprovalStore: frozen.agent.stores!.approvalStore, idSeed: 'frozen' });
    const values = async () => JSON.stringify(await Promise.all(kv.keys().map(async (key) => [key, await kv.read(key)])));
    const snapshot = await values();
    await assert.rejects(
      () => after.workflows.service.decideApproval({ ...after.meta(AGENT_TOKEN.reviewer), workflowApprovalId: approvalId, decision: 'approve', reason: 'During the freeze.' }),
      failedWith('workflow_persistence_failed'),
    );
    await assert.rejects(
      () => after.workflows.service.cancelRun({ ...after.meta(AGENT_TOKEN.consultant), workflowRunId: parked.workflowRunId, reason: 'During the freeze.' }),
      failedWith('workflow_persistence_failed'),
    );
    assert.equal(await values(), snapshot, 'no key and no value changed during the freeze');
    const stored = await frozen.workflow.stores!.approvalStore.load('acme', approvalId);
    assert.equal(stored?.approvalState, 'pending');
    assert.equal(stored?.approvalVersion, 1);
    // Reads still serve the operator.
    const read = await after.workflows.service.getRun({ ...after.meta(AGENT_TOKEN.consultant), workflowRunId: parked.workflowRunId });
    assert.equal(read.state, 'waiting_for_approval');
  });
});

describe('A2-P06-C03 — refusing, never falling back', () => {
  it('an unrecognised mode refuses every call, reads included', async () => {
    const { ports } = kvPorts();
    const composed = compose({ AI_WORKFLOW_PERSISTENCE: 'sqll' }, ports);
    assert.equal(composed.workflow.refusing, true);
    assert.match(composed.workflow.problems[0], /AI_WORKFLOW_PERSISTENCE/);
    await assert.rejects(() => composed.workflow.stores!.runStore.load('acme', 'x'), failedWith('workflow_persistence_failed'));
    assert.equal(composed.agent.refusing, false, 'one domain\'s bad value does not touch the other');
  });

  it('SQL without the gateway refuses — it never quietly stays on KV', async () => {
    const { kv, ports } = kvPorts();
    const composed = compose({ AI_AGENT_PERSISTENCE: 'sql' }, ports);
    assert.equal(composed.agent.refusing, true);
    await assert.rejects(() => composed.agent.stores!.runStore.list({ organizationId: 'x' }), failedWith('persistence_failed'));
    assert.equal(kv.writes, 0);
  });

  it('SQL with an enabled slug default organization refuses at composition', () => {
    const composed = compose({ AI_WORKFLOW_PERSISTENCE: 'sql' }, undefined, recordingGateway(), { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: true });
    assert.equal(composed.workflow.refusing, true);
    assert.match(composed.workflow.problems[0], /not a canonical organizations\.id UUID/);
  });

  it('a frozen KV mode without KV ports refuses rather than inventing memory stores', () => {
    const composed = compose({ AI_WORKFLOW_PERSISTENCE: 'kv_frozen' }, undefined);
    assert.equal(composed.workflow.refusing, true);
  });

  it('SQL modes use the gateway and only the gateway', async () => {
    const { kv, ports } = kvPorts();
    const gateway = recordingGateway();
    const composed = compose({ AI_WORKFLOW_PERSISTENCE: 'sql', AI_AGENT_PERSISTENCE: 'sql_frozen' }, ports, gateway);
    assert.equal(composed.workflow.authority, 'sql');
    assert.equal(composed.agent.frozen, true);
    await composed.workflow.stores!.runStore.list({ organizationId: '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0' });
    await composed.agent.stores!.runStore.list({ organizationId: '9c96dbbd-b389-4f8b-811f-1815c4f8a9e0' });
    await assert.rejects(() => composed.agent.stores!.runStore.create({} as never), failedWith('persistence_failed'));
    assert.deepEqual(gateway.calls, [WORKFLOW_RPC.runList, AGENT_RPC.runList]);
    assert.equal(kv.writes, 0);
  });
});

describe('A2-P06-C03 — the mode is read from the environment source bootstrap actually uses', () => {
  it('honours AI_WORKFLOW_PERSISTENCE / AI_AGENT_PERSISTENCE from a get()-shaped EnvSource', () => {
    // The regression this exists for: a record-indexed read of a get()-shaped
    // source sees every variable as unset, and `sql` silently stays `kv`.
    const reads: string[] = [];
    const env = { get: (key: string) => { reads.push(key); return ({ AI_WORKFLOW_PERSISTENCE: 'kv_frozen', AI_AGENT_PERSISTENCE: 'sql_frozen' } as Record<string, string>)[key]; } };
    const composed = composeRuntimePersistence({ env, kv: { workflow: kvPorts().ports }, sqlGateway: recordingGateway(), tenant: HOSTED_TENANT });
    assert.equal(composed.workflow.mode, 'kv_frozen');
    assert.equal(composed.agent.mode, 'sql_frozen');
    assert.deepEqual(reads.sort(), ['AI_AGENT_PERSISTENCE', 'AI_WORKFLOW_PERSISTENCE']);
  });
});

describe('A2-P06-C03 — the server gateway', () => {
  it('reaches exactly the twenty-four runtime persistence functions and nothing else', async () => {
    assert.equal(RUNTIME_PERSISTENCE_FUNCTIONS.size, 24);
    const called: string[] = [];
    const gateway = createSupabaseRuntimePersistenceGateway({
      rpc: (fn) => {
        called.push(fn);
        return Promise.resolve({ data: 'saved', error: null });
      },
    });
    assert.equal(await gateway.rpc('agent_run_save', {}), 'saved');
    for (const forbidden of ['kv_compare_and_swap_field', 'durable_job_claim', 'exec_sql', 'agent_run_delete']) {
      await assert.rejects(() => gateway.rpc(forbidden, {}), /is not a runtime persistence function/);
    }
    assert.deepEqual(called, ['agent_run_save']);
  });

  it('throws a PostgREST error rather than resolving it to null', async () => {
    const gateway = createSupabaseRuntimePersistenceGateway({
      rpc: () => Promise.resolve({ data: null, error: { message: 'permission denied for function' } }),
    });
    await assert.rejects(() => gateway.rpc('workflow_run_load', {}), /workflow_run_load: permission denied/);
  });
});
