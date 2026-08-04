/**
 * Agent runtime HTTP surface and administrative visibility (AI-01 Batch 3A).
 *
 * The adapter is a pure function, so these cases exercise the whole
 * request/response mapping — authorization, validation, status codes, error
 * shapes and the read models — without a server. What they are really asserting
 * is the property the adapter exists for: there is no operation reachable
 * without an authorised actor, because dispatch happens inside the function
 * that resolves one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_ID,
  AGENT_TOKEN,
  bearer,
  buildTestAgentRuntime,
} from './agentFixtures.ts';
import {
  AGENT_OPERATION,
  executeAgentHttpRequest,
  type AgentHttpRequest,
} from '../agents/http/agentHttpAdapter.ts';

function harnessWith() {
  const harness = buildTestAgentRuntime();
  const call = (request: Partial<AgentHttpRequest> & { operation: AgentHttpRequest['operation'] }) =>
    executeAgentHttpRequest(harness.runtime.service, {
      authorization: bearer(AGENT_TOKEN.consultant),
      ...request,
    });
  return { harness, call };
}

const CREATE_BODY = {
  agentId: AGENT_ID.primary,
  objective: 'Establish a deterministic finding for the supplied topic.',
  input: { topic: 'Intake handoffs', script: 'model_then_complete' },
};

describe('agent HTTP adapter — authorization', () => {
  it('refuses every operation without a credential', async () => {
    const { call } = harnessWith();
    for (const operation of Object.values(AGENT_OPERATION)) {
      const response = await call({ operation, authorization: null, runId: 'run_x', approvalId: 'apr_x' });
      assert.equal(response.status, 401, `${operation} must require authentication`);
      assert.equal(response.body.success, false);
    }
  });

  it('refuses every operation for an authenticated caller with no runtime role', async () => {
    const { call } = harnessWith();
    for (const operation of Object.values(AGENT_OPERATION)) {
      const response = await call({
        operation,
        authorization: bearer(AGENT_TOKEN.outsider),
        runId: 'run_x',
        approvalId: 'apr_x',
      });
      assert.equal(response.status, 403, `${operation} must require a role`);
    }
  });

  it('refuses a create from a reader-only role with a typed failure', async () => {
    const { call } = harnessWith();
    const response = await call({
      operation: AGENT_OPERATION.createRun,
      authorization: bearer(AGENT_TOKEN.reviewer),
      body: CREATE_BODY,
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.failure, 'unauthorized');
  });
});

describe('agent HTTP adapter — validation', () => {
  it('refuses a malformed agent id before anything is created', async () => {
    const { call } = harnessWith();
    const response = await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, agentId: 'not a valid id!' },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['agentId']);
  });

  it('refuses a run id that is not a safe identifier', async () => {
    const { call } = harnessWith();
    const response = await call({ operation: AGENT_OPERATION.getRun, runId: '../../etc/passwd' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['runId']);
  });

  it('refuses an approval decision that is neither approve nor reject', async () => {
    const { call } = harnessWith();
    const response = await call({
      operation: AGENT_OPERATION.submitApproval,
      runId: 'run_x',
      approvalId: 'apr_x',
      body: { decision: 'maybe', reason: 'undecided for now' },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['decision']);
  });

  it('ignores undeclared body fields rather than passing them through', async () => {
    const { call } = harnessWith();
    const response = await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, organizationId: 'globex', actorId: 'somebody-else', state: 'completed' },
    });
    assert.equal(response.status, 200);
    const run = response.body.run as { organizationId: string; actorId: string; state: string };
    assert.equal(run.organizationId, 'acme', 'the organization is resolved, never asserted');
    assert.equal(run.actorId, 'user-consultant');
    assert.equal(run.state, 'completed', 'the state comes from the run, not from the body');
  });
});

describe('agent HTTP adapter — operations', () => {
  it('creates, reads, lists and reports a run', async () => {
    const { call } = harnessWith();

    const created = await call({ operation: AGENT_OPERATION.createRun, body: CREATE_BODY });
    assert.equal(created.status, 200);
    const runId = (created.body.run as { runId: string }).runId;

    const read = await call({ operation: AGENT_OPERATION.getRun, runId });
    assert.equal((read.body.run as { runId: string }).runId, runId);

    const listed = await call({ operation: AGENT_OPERATION.listRuns });
    assert.equal((listed.body.runs as unknown[]).length, 1);

    const steps = await call({ operation: AGENT_OPERATION.runSteps, runId });
    assert.equal((steps.body.steps as unknown[]).length, 2);

    const usage = await call({ operation: AGENT_OPERATION.runUsage, runId });
    assert.ok((usage.body.usage as { stepCount: number }).stepCount > 0);
  });

  it('pauses, resumes and cancels through the adapter', async () => {
    const { call } = harnessWith();
    const created = await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, input: { topic: 'x', script: 'pause_then_complete' } },
    });
    const runId = (created.body.run as { runId: string; state: string }).runId;
    assert.equal((created.body.run as { state: string }).state, 'paused');

    const resumed = await call({
      operation: AGENT_OPERATION.resumeRun,
      runId,
      body: { reason: 'operator resumed the run' },
    });
    assert.equal((resumed.body.run as { state: string }).state, 'completed');

    const second = await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, input: { topic: 'x', script: 'pause_then_complete' } },
    });
    const secondId = (second.body.run as { runId: string }).runId;
    const cancelled = await call({
      operation: AGENT_OPERATION.cancelRun,
      runId: secondId,
      body: { reason: 'no longer needed' },
    });
    assert.equal((cancelled.body.run as { state: string }).state, 'cancelled');
  });

  it('refuses a control operation with no reason and says so safely', async () => {
    const { call } = harnessWith();
    const created = await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, input: { topic: 'x', script: 'pause_then_complete' } },
    });
    const runId = (created.body.run as { runId: string }).runId;

    const response = await call({ operation: AGENT_OPERATION.cancelRun, runId, body: {} });
    assert.equal(response.status, 400);
    assert.equal(response.body.failure, 'invalid_action');
    assert.equal('diagnostics' in response.body, false, 'server detail never reaches a caller');
  });

  it('decides an approval and drives the run onward', async () => {
    const { call } = harnessWith();
    const created = await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, input: { topic: 'x', script: 'approved_tool_then_complete' } },
    });
    const run = created.body.run as { runId: string; state: string; pendingApprovalId?: string };
    assert.equal(run.state, 'waiting_for_approval');

    const queue = await call({
      operation: AGENT_OPERATION.listApprovals,
      authorization: bearer(AGENT_TOKEN.owner),
    });
    assert.equal((queue.body.approvals as unknown[]).length, 1);

    const decided = await call({
      operation: AGENT_OPERATION.submitApproval,
      authorization: bearer(AGENT_TOKEN.owner),
      runId: run.runId,
      approvalId: run.pendingApprovalId,
      body: { decision: 'approve', reason: 'authorised by the owner' },
    });
    assert.equal((decided.body.run as { state: string }).state, 'completed');
  });

  it('lists the registry and the tool catalogue without exposing behaviour', async () => {
    const { call } = harnessWith();

    const agents = await call({ operation: AGENT_OPERATION.listAgents });
    const listed = agents.body.agents as Record<string, unknown>[];
    assert.ok(listed.length > 0);
    for (const descriptor of listed) {
      assert.equal('propose' in descriptor, false);
      assert.equal('inputContract' in descriptor, false);
      assert.ok('limits' in descriptor);
      assert.ok('allowedTools' in descriptor);
    }

    const tools = await call({ operation: AGENT_OPERATION.listTools });
    const toolList = tools.body.tools as Record<string, unknown>[];
    assert.ok(toolList.length > 0);
    for (const descriptor of toolList) {
      assert.equal('execute' in descriptor, false, 'a descriptor carries no executor');
      assert.ok('risk' in descriptor);
      assert.ok('requiresApproval' in descriptor);
    }
  });

  it('rejects an operation the union does not declare', async () => {
    const { call } = harnessWith();
    const response = await call({ operation: 'run.destroy' as never });
    assert.equal(response.status, 404);
  });
});

describe('agent runtime — administrative visibility', () => {
  it('summarises runs, approvals and limits for the operator', async () => {
    const { harness, call } = harnessWith();

    await call({ operation: AGENT_OPERATION.createRun, body: CREATE_BODY });
    harness.clock.advance(1_000);
    await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, input: { topic: 'x', script: 'pause_then_complete' } },
    });
    harness.clock.advance(1_000);
    await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, input: { topic: 'x', script: 'approved_tool_then_complete' } },
    });
    harness.clock.advance(1_000);
    await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, input: { topic: 'x', script: 'loop_same_action' } },
    });

    const response = await call({ operation: AGENT_OPERATION.overview });
    const overview = response.body.overview as {
      counts: Record<string, number>;
      awaitingApproval: unknown[];
      recentFailures: unknown[];
      pendingApprovals: unknown[];
      registeredAgents: number;
      registeredTools: number;
      capabilities: string[];
      organizationId: string;
    };

    assert.equal(overview.organizationId, 'acme');
    assert.equal(overview.counts.completed, 1);
    assert.equal(overview.counts.paused, 1);
    assert.equal(overview.counts.waiting_for_approval, 1);
    assert.equal(overview.counts.failed, 1);
    assert.equal(overview.awaitingApproval.length, 1);
    assert.equal(overview.recentFailures.length, 1);
    assert.equal(overview.pendingApprovals.length, 1);
    assert.ok(overview.registeredAgents > 0);
    assert.ok(overview.registeredTools > 0);
    assert.ok(overview.capabilities.includes('agent.run.read'));
  });

  it('reports the limits a failed run reached', async () => {
    const { call } = harnessWith();
    const created = await call({
      operation: AGENT_OPERATION.createRun,
      body: { ...CREATE_BODY, input: { topic: 'x', script: 'loop_same_action' } },
    });
    const run = created.body.run as { state: string; failure: string; limitsReached: string[] };
    assert.equal(run.state, 'failed');
    assert.equal(run.failure, 'loop_detected');
    assert.ok(run.limitsReached.includes('loop_detected'));
    assert.ok(run.limitsReached.some((entry) => entry.startsWith('repeated_action:')));
  });

  it('exposes the audit trail with no prompt or completion content', async () => {
    const { call } = harnessWith();
    await call({ operation: AGENT_OPERATION.createRun, body: CREATE_BODY });

    const response = await call({ operation: AGENT_OPERATION.audit, limit: 100 });
    const records = response.body.records as Record<string, unknown>[];
    assert.ok(records.length > 0);

    const serialized = JSON.stringify(records);
    assert.equal(serialized.includes('Deterministic mock result'), false);
    assert.equal(serialized.includes('Intake handoffs'), false, 'the topic is caller data');
    for (const record of records) {
      assert.equal(record.organizationId, 'acme');
      assert.ok(typeof record.runId === 'string');
    }
  });

  it('gives a tenant operator no cross-organization reads', async () => {
    const { call } = harnessWith();
    const created = await call({ operation: AGENT_OPERATION.createRun, body: CREATE_BODY });
    const runId = (created.body.run as { runId: string }).runId;

    const foreign = await call({
      operation: AGENT_OPERATION.getRun,
      authorization: bearer(AGENT_TOKEN.otherTenant),
      runId,
    });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.failure, 'run_not_found');

    const platform = await call({
      operation: AGENT_OPERATION.getRun,
      authorization: bearer(AGENT_TOKEN.platform),
      runId,
      organizationId: 'acme',
    });
    assert.equal(platform.status, 200);
  });

  it('offers no mutation of a run’s history at any operation', () => {
    // Everything the surface can do is enumerable, and none of it edits a step,
    // a transition, a checkpoint or an audit record.
    const mutations = Object.values(AGENT_OPERATION).filter((operation) =>
      /delete|edit|patch|purge|rewrite/i.test(operation),
    );
    assert.deepEqual(mutations, []);
  });
});
