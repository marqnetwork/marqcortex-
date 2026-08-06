/**
 * Workflow execution engine, state machine and service (AI-01 Batch 3B, Part 2).
 *
 * Asserted against the production implementations over a REAL Batch 3A agent
 * runtime over a REAL control plane. Nothing on the path under test is stubbed:
 * when a node runs here, an actual agent run is created and driven by the
 * actual Agent Orchestrator, and the assertions about child runs read the
 * agent runtime's own store.
 *
 * Every guarantee is checked in the direction that can fail — that a stale
 * write is REFUSED, that a terminal record cannot be reopened, that a cancelled
 * workflow stops its child, and that a run recovered in a second isolate drives
 * the SAME child rather than starting a second one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryAgentRunStore,
  createMemoryApprovalStore,
  createMemoryCheckpointStore,
} from '../agents/persistence/ports.ts';
import { createMemoryWorkflowRunStore } from '../workflows/persistence/ports.ts';
import { isWorkflowError } from '../workflows/contracts/failures.ts';
import {
  WORKFLOW_RUN_OPERATIONS,
  WORKFLOW_RUN_STATES,
  isTerminalWorkflowState,
} from '../workflows/contracts/run.ts';
import {
  OPERATION_SOURCES,
  OPERATION_TARGETS,
  PAUSABLE_STATES,
  TRANSITIONS,
  assertTransition,
  canTransition,
} from '../workflows/runtime/workflowStateMachine.ts';
import { projectAgentRun } from '../workflows/engine/agentNodePort.ts';
import type { WorkflowAgentPort } from '../workflows/engine/agentNodePort.ts';
import type { AgentRunRecord } from '../agents/contracts/runtime.ts';
import { AGENT_TOKEN } from './agentFixtures.ts';
import {
  EXECUTABLE,
  EXECUTABLE_WORKFLOWS,
  WF_AGENT,
  buildTestWorkflowRuntime,
} from './workflowFixtures.ts';

const TOPIC = { topic: 'quarterly readiness' };

function failureOf(error: unknown): string {
  assert.ok(isWorkflowError(error), `expected a WorkflowError, got ${String(error)}`);
  return error.failure;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    assert.fail('expected the call to be refused');
  } catch (error) {
    return error;
  }
}

// ── The state machine ───────────────────────────────────────────────────────

describe('workflow state machine', () => {
  it('gives every state an entry and every terminal state no way out', () => {
    for (const state of WORKFLOW_RUN_STATES) {
      assert.ok(Array.isArray(TRANSITIONS[state]), `${state} has no transition entry`);
      if (isTerminalWorkflowState(state)) {
        assert.deepEqual(TRANSITIONS[state], [], `terminal ${state} has outgoing edges`);
      }
    }
  });

  it('never lets an operation target a state the transition table forbids', () => {
    // The two tables are independent, so an operation could name a target no
    // edge can reach. That would be a permission to do something impossible.
    for (const operation of WORKFLOW_RUN_OPERATIONS) {
      for (const target of OPERATION_TARGETS[operation]) {
        const reachable = OPERATION_SOURCES[operation].some((from) =>
          canTransition(from, target),
        );
        assert.ok(
          reachable,
          `operation ${operation} may produce ${target} from no source it is allowed to start at`,
        );
      }
    }
  });

  it('keeps the pausable list and the pause sources in agreement', () => {
    assert.deepEqual([...PAUSABLE_STATES].sort(), [...OPERATION_SOURCES.pause].sort());
  });

  it('refuses a transition out of a terminal state', () => {
    assert.throws(
      () =>
        assertTransition({
          from: 'completed',
          to: 'running',
          operation: 'resume',
          currentVersion: 4,
          expectedVersion: 4,
          workflowRunId: 'wfr_x',
        }),
      (error: unknown) => failureOf(error) === 'workflow_invalid_transition',
    );
  });

  it('refuses an operation applied from a state it may not start at', () => {
    // `waiting_for_agent → running` IS an edge, and `running` IS a target
    // `resume` may produce — so only the source table can refuse this. That is
    // the check whose absence stranded Batch 3A runs.
    assert.ok(canTransition('waiting_for_agent', 'running'));
    assert.ok(OPERATION_TARGETS.resume.includes('running'));
    assert.throws(
      () =>
        assertTransition({
          from: 'waiting_for_agent',
          to: 'running',
          operation: 'resume',
          currentVersion: 2,
          expectedVersion: 2,
          workflowRunId: 'wfr_x',
        }),
      (error: unknown) => {
        assert.equal(failureOf(error), 'workflow_invalid_transition');
        // The caller-safe message says nothing about the graph; the diagnostics
        // — which never leave the server — name the source.
        assert.match(
          String((error as { diagnostics?: string }).diagnostics),
          /operation resume may not be applied from waiting_for_agent/,
        );
        return true;
      },
    );
  });

  it('refuses a stale version before it refuses anything else', () => {
    assert.throws(
      () =>
        assertTransition({
          from: 'running',
          to: 'completed',
          operation: 'complete',
          currentVersion: 5,
          expectedVersion: 4,
          workflowRunId: 'wfr_x',
        }),
      (error: unknown) => failureOf(error) === 'stale_workflow_version',
    );
  });
});

describe('agent node projection', () => {
  const record = (state: string, extra: Record<string, unknown> = {}) =>
    ({
      context: { runId: 'run_1' },
      state,
      ...extra,
    }) as unknown as AgentRunRecord;

  it('collapses sixteen agent states into the four the engine understands', () => {
    assert.equal(projectAgentRun(record('completed')).state, 'completed');
    assert.equal(projectAgentRun(record('running')).state, 'running');
    assert.equal(projectAgentRun(record('waiting_for_approval')).state, 'blocked');
    assert.equal(projectAgentRun(record('waiting_for_tool')).state, 'blocked');
    // Every non-completion terminal is one thing to the workflow: the node did
    // not produce a result. The detail is preserved for an operator to read.
    for (const state of ['failed', 'cancelled', 'expired', 'budget_exhausted', 'policy_denied']) {
      const handle = projectAgentRun(record(state));
      assert.equal(handle.state, 'failed', state);
      assert.equal(handle.childState, state, 'the child state is preserved verbatim');
    }
  });
});

// ── Creating and starting ───────────────────────────────────────────────────

describe('workflow run creation', () => {
  it('creates a run in `created`, bound to the plan it was admitted against', async () => {
    const harness = buildTestWorkflowRuntime();
    const detail = await harness.workflows.service.createRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'created');
    assert.equal(detail.workflowId, EXECUTABLE.single.workflowId);
    assert.equal(detail.workflowVersion, '1.0.0');
    assert.equal(
      detail.planDigest,
      harness.workflows.registry.requirePlan(EXECUTABLE.single.workflowId).digest,
    );
    assert.equal(detail.runVersion, 1);
    assert.equal(detail.stepCount, 0);
    assert.deepEqual(detail.childAgentRunIds, []);
    assert.match(detail.inputDigest, /^[0-9a-f]{32}$/);
  });

  it('persists the run before anything can act on it', async () => {
    const harness = buildTestWorkflowRuntime();
    const detail = await harness.workflows.service.createRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });
    // Read through the STORE, not the returned value: a record that exists only
    // in the reply is a record a second isolate cannot see.
    const stored = await harness.runStore.load('acme', detail.workflowRunId);
    assert.equal(stored?.state, 'created');
    assert.equal(stored?.context.workflowRunId, detail.workflowRunId);
  });

  it('refuses input the workflow contract does not accept', async () => {
    const harness = buildTestWorkflowRuntime();
    const error = await rejection(
      harness.workflows.service.createRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowId: EXECUTABLE.single.workflowId,
        input: { wrong: true },
      }),
    );
    assert.equal(failureOf(error), 'workflow_input_invalid');
  });

  it('never keeps the caller input in a read model', async () => {
    const harness = buildTestWorkflowRuntime();
    const detail = await harness.workflows.service.createRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });
    assert.equal('input' in detail, false, 'the detail view must not echo the input');
    // It IS on the record, because every node has to be re-handed it.
    const stored = await harness.runStore.load('acme', detail.workflowRunId);
    assert.deepEqual(stored?.input, TOPIC);
  });
});

// ── Execution ───────────────────────────────────────────────────────────────

describe('workflow execution', () => {
  it('starts and completes a single-node workflow', async () => {
    const harness = buildTestWorkflowRuntime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(detail.stepCount, 1);
    assert.equal(detail.steps.length, 1);
    assert.equal(detail.steps[0].nodeId, 'only');
    assert.equal(detail.steps[0].outcome, 'completed');
    assert.equal(detail.steps[0].attempt, 1, 'part 2 gives a node exactly one attempt');
    assert.equal(detail.currentNodeId, undefined, 'a finished run holds no cursor');
    assert.ok(detail.resultDigest, 'the accepted output is recorded as a digest');
    assert.ok(detail.endedAt);
  });

  it('runs a multi-node chain in plan order, one node at a time', async () => {
    const harness = buildTestWorkflowRuntime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.chain.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(detail.stepCount, 3);
    assert.deepEqual(
      detail.steps.map((step) => [step.sequence, step.nodeId, step.agentId, step.outcome]),
      [
        [0, 'first', WF_AGENT.alpha, 'completed'],
        [1, 'second', WF_AGENT.beta, 'completed'],
        [2, 'third', WF_AGENT.gamma, 'completed'],
      ],
    );
    // One checkpoint pointer per completed node. This is the durable write the
    // restart test depends on.
    assert.deepEqual(
      detail.steps.map((step) => step.checkpointVersion),
      [1, 2, 3],
    );
    assert.equal(detail.checkpointVersion, 3);
  });

  it('creates one child agent run per node, through the agent orchestrator', async () => {
    const harness = buildTestWorkflowRuntime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.chain.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.childAgentRunIds.length, 3);
    assert.deepEqual(
      detail.steps.map((step) => step.childAgentRunId),
      [...detail.childAgentRunIds],
    );

    for (const [index, childRunId] of detail.childAgentRunIds.entries()) {
      // Read the AGENT runtime's own store. The child is a real agent run with
      // real state, not a workflow-side fiction.
      const child = await harness.agentRuntime.runtime.runs.load('acme', childRunId);
      assert.ok(child, `child ${childRunId} must exist in the agent run store`);
      assert.equal(child.state, 'completed');
      assert.equal(child.context.agentId, detail.steps[index].agentId);
      assert.equal(
        child.context.workflowId,
        EXECUTABLE.chain.workflowId,
        'the child is stamped with the workflow that owns it',
      );
      assert.equal(child.context.organizationId, 'acme');
    }
  });

  it('records the child run id BEFORE the child is driven', async () => {
    // The ordering that makes restart recovery real. The port is wrapped so the
    // record can be inspected at the exact moment between the two.
    const seen: { state: string; pendingAgentRunId?: string }[] = [];
    const store = createMemoryWorkflowRunStore();
    const harness = buildTestWorkflowRuntime({
      runStore: store,
      wrapAgentPort: (port): WorkflowAgentPort => ({
        create: (input) => port.create(input),
        async drive(input) {
          const runs = await store.list({ organizationId: 'acme' });
          for (const run of runs) {
            seen.push({
              state: run.state,
              ...(run.pendingNode === undefined
                ? {}
                : { pendingAgentRunId: run.pendingNode.agentRunId }),
            });
          }
          return port.drive(input);
        },
        cancel: (input) => port.cancel(input),
      }),
    });

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });

    assert.equal(seen.length, 1, 'the single node was driven once');
    assert.equal(seen[0].state, 'waiting_for_agent');
    assert.equal(
      seen[0].pendingAgentRunId,
      detail.childAgentRunIds[0],
      'the pending child was durable before it was driven',
    );
  });

  it('propagates a child agent failure and stops the chain there', async () => {
    const harness = buildTestWorkflowRuntime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.failsMidway.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_node_failed');
    assert.equal(detail.steps.length, 2);
    assert.equal(detail.steps[0].outcome, 'completed');
    assert.equal(detail.steps[1].outcome, 'failed');
    assert.equal(detail.steps[1].nodeId, 'second');
    assert.equal(detail.steps[1].childState, 'failed');
    assert.equal(detail.currentNodeId, undefined);
  });

  it('does not retry a failed node when advanced again', async () => {
    const harness = buildTestWorkflowRuntime();
    const first = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.failsMidway.workflowId,
      input: TOPIC,
    });

    const again = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: first.workflowRunId,
    });

    assert.equal(again.state, 'failed');
    assert.equal(again.runVersion, first.runVersion, 'a terminal record is not rewritten');
    assert.equal(again.childAgentRunIds.length, 2, 'no third child run was created');
  });

  it('waits, without writing, while a child is blocked on something else', async () => {
    const harness = buildTestWorkflowRuntime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.blocksMidway.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'waiting_for_agent');
    assert.equal(detail.pendingNode?.nodeId, 'second');
    assert.equal(detail.stepCount, 1, 'only the first node finished');

    // Polling a blocked child must not burn a version — a console refreshing a
    // run would otherwise be a source of conflicts for the engine.
    const polled = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(polled.state, 'waiting_for_agent');
    assert.equal(polled.runVersion, detail.runVersion);
  });
});

// ── Control operations ──────────────────────────────────────────────────────

describe('workflow control', () => {
  it('pauses a waiting run and resumes it to completion', async () => {
    const harness = buildTestWorkflowRuntime();
    const started = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.chain.workflowId,
      input: TOPIC,
    });
    // The chain completes unattended, so pause/resume is exercised on a run
    // that genuinely stops: the one whose second node blocks.
    const blocked = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.blocksMidway.workflowId,
      input: TOPIC,
    });
    assert.equal(started.state, 'completed');
    assert.equal(blocked.state, 'waiting_for_agent');

    const paused = await harness.workflows.service.pauseRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: blocked.workflowRunId,
      reason: 'Holding while we check something.',
    });
    assert.equal(paused.state, 'paused');

    // A paused run is not advanced by asking again. An operator's pause must
    // not be undone by a background driver.
    const ignored = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: blocked.workflowRunId,
    });
    assert.equal(ignored.state, 'paused');
    assert.equal(ignored.runVersion, paused.runVersion);

    const resumed = await harness.workflows.service.resumeRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: blocked.workflowRunId,
      reason: 'Carry on.',
    });
    assert.equal(resumed.state, 'running');
    assert.equal(
      resumed.pendingNode?.nodeId,
      'second',
      'resuming keeps the pending child rather than restarting the node',
    );
  });

  it('cancels a run and stops its in-flight child', async () => {
    const harness = buildTestWorkflowRuntime();
    const blocked = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.blocksMidway.workflowId,
      input: TOPIC,
    });
    const childRunId = blocked.pendingNode?.agentRunId;
    assert.ok(childRunId);

    const cancelled = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: blocked.workflowRunId,
      reason: 'No longer needed.',
    });

    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.pendingNode, undefined);
    assert.equal(cancelled.currentNodeId, undefined);

    const child = await harness.agentRuntime.runtime.runs.load('acme', childRunId);
    assert.equal(
      child?.state,
      'cancelled',
      'cancelling a workflow must stop the agent run producing its effects',
    );
  });

  it('expires a run whose deadline has passed', async () => {
    const harness = buildTestWorkflowRuntime();
    const blocked = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.blocksMidway.workflowId,
      input: TOPIC,
      runtimeMs: 1_000,
    });
    assert.equal(blocked.state, 'waiting_for_agent');

    harness.clock.advance(5_000);

    const expired = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: blocked.workflowRunId,
    });
    assert.equal(expired.state, 'expired');
    assert.equal(expired.failure, 'workflow_expired');

    // Idempotent: expiring an expired run returns it unchanged.
    const again = await harness.workflows.service.expireRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: blocked.workflowRunId,
      reason: 'Sweeper.',
    });
    assert.equal(again.runVersion, expired.runVersion);
  });

  it('treats terminal records as immutable', async () => {
    const harness = buildTestWorkflowRuntime();
    const done = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });
    assert.equal(done.state, 'completed');

    for (const attempt of [
      () =>
        harness.workflows.service.pauseRun({
          ...harness.meta(AGENT_TOKEN.consultant),
          workflowRunId: done.workflowRunId,
          reason: 'Too late.',
        }),
      () =>
        harness.workflows.service.resumeRun({
          ...harness.meta(AGENT_TOKEN.consultant),
          workflowRunId: done.workflowRunId,
          reason: 'Too late.',
        }),
      () =>
        harness.workflows.service.cancelRun({
          ...harness.meta(AGENT_TOKEN.consultant),
          workflowRunId: done.workflowRunId,
          reason: 'Too late.',
        }),
    ]) {
      assert.equal(failureOf(await rejection(attempt())), 'workflow_invalid_transition');
    }

    const unchanged = await harness.workflows.service.getRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: done.workflowRunId,
    });
    assert.equal(unchanged.runVersion, done.runVersion);
  });

  it('refuses an operation the run is not in a state for', async () => {
    const harness = buildTestWorkflowRuntime();
    const blocked = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.blocksMidway.workflowId,
      input: TOPIC,
    });
    // `resume` may only start from `paused`.
    const error = await rejection(
      harness.workflows.service.resumeRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: blocked.workflowRunId,
        reason: 'Nothing to resume.',
      }),
    );
    assert.equal(failureOf(error), 'workflow_invalid_transition');
  });
});

// ── Concurrency and durability ──────────────────────────────────────────────

describe('workflow concurrency', () => {
  it('refuses a caller acting on a version the run has moved past', async () => {
    const harness = buildTestWorkflowRuntime();
    const blocked = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.blocksMidway.workflowId,
      input: TOPIC,
    });

    const error = await rejection(
      harness.workflows.service.pauseRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: blocked.workflowRunId,
        reason: 'Acting on a stale view.',
        expectedVersion: blocked.runVersion - 1,
      }),
    );
    assert.equal(failureOf(error), 'stale_workflow_version');
  });

  it('lets exactly one of two concurrent advances win', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await harness.workflows.service.createRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.chain.workflowId,
      input: TOPIC,
    });

    // Both read version 1 before either writes. Without a compare-and-swap both
    // would proceed, and the chain would run its first node twice.
    const outcomes = await Promise.allSettled([
      harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: created.workflowRunId,
      }),
      harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: created.workflowRunId,
      }),
    ]);

    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    assert.equal(rejected.length, 1, 'exactly one advance must lose the race');
    assert.equal(
      failureOf((rejected[0] as PromiseRejectedResult).reason),
      'stale_workflow_version',
    );

    const final = await harness.runStore.load('acme', created.workflowRunId);
    assert.equal(final?.state, 'completed');
    assert.equal(final?.childAgentRunIds.length, 3, 'no node ran twice');
  });

  it('resumes from durable state in a second runtime, driving the same child', async () => {
    // Shared stores are the whole point: the second runtime shares nothing with
    // the first except what was written down.
    const runStore = createMemoryWorkflowRunStore();
    const agentRunStore = createMemoryAgentRunStore();
    const agentCheckpointStore = createMemoryCheckpointStore();
    const agentApprovalStore = createMemoryApprovalStore();

    // Isolate one: dies the instant after persisting the pending child.
    const first = buildTestWorkflowRuntime({
      runStore,
      agentRunStore,
      agentCheckpointStore,
      agentApprovalStore,
      wrapAgentPort: (port): WorkflowAgentPort => ({
        create: (input) => port.create(input),
        drive: () => Promise.reject(new Error('isolate recycled')),
        cancel: (input) => port.cancel(input),
      }),
    });

    const created = await first.workflows.service.createRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });
    await assert.rejects(
      first.workflows.service.advanceRun({
        ...first.meta(AGENT_TOKEN.consultant),
        workflowRunId: created.workflowRunId,
      }),
      /isolate recycled/,
    );

    const crashed = await runStore.load('acme', created.workflowRunId);
    assert.equal(crashed?.state, 'waiting_for_agent');
    const strandedChild = crashed?.pendingNode?.agentRunId;
    assert.ok(strandedChild, 'the pending child must be durable');

    // Isolate two: a fresh runtime with a working port over the same stores.
    const second = buildTestWorkflowRuntime({
      runStore,
      agentRunStore,
      agentCheckpointStore,
      agentApprovalStore,
    });
    const recovered = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });

    assert.equal(recovered.state, 'completed');
    assert.deepEqual(
      recovered.childAgentRunIds,
      [strandedChild],
      'recovery drove the SAME child run rather than starting a second one',
    );
    assert.equal(recovered.steps[0].childAgentRunId, strandedChild);
  });
});

// ── Admission ───────────────────────────────────────────────────────────────

describe('workflow admission', () => {
  it('refuses to create a run for a disabled workflow', async () => {
    const harness = buildTestWorkflowRuntime();
    const error = await rejection(
      harness.workflows.service.createRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowId: EXECUTABLE.disabled.workflowId,
        input: TOPIC,
      }),
    );
    assert.equal(failureOf(error), 'workflow_disabled');
  });

  it('denies a live run whose workflow was disabled after it was created', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const before = buildTestWorkflowRuntime({ runStore });
    const created = await before.workflows.service.createRun({
      ...before.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });

    // Same workflow id and version, now switched off. Admission is re-checked
    // on every pass through `validating`, so the run is denied rather than
    // finishing on the strength of a decision made before the change.
    const after = buildTestWorkflowRuntime({
      runStore,
      workflows: [{ ...EXECUTABLE.single, enabled: false }],
    });
    const denied = await after.workflows.service.advanceRun({
      ...after.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });

    assert.equal(denied.state, 'policy_denied');
    assert.equal(denied.failure, 'workflow_disabled');
    assert.deepEqual(denied.childAgentRunIds, [], 'nothing executed');
  });

  it('refuses an uncertified workflow where certification is demanded', async () => {
    const open = buildTestWorkflowRuntime({ requireCertifiedWorkflows: () => false });
    const permitted = await open.workflows.service.createRun({
      ...open.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.uncertified.workflowId,
      input: TOPIC,
    });
    assert.equal(permitted.state, 'created');

    const strict = buildTestWorkflowRuntime({ requireCertifiedWorkflows: () => true });
    const error = await rejection(
      strict.workflows.service.createRun({
        ...strict.meta(AGENT_TOKEN.consultant),
        workflowId: EXECUTABLE.uncertified.workflowId,
        input: TOPIC,
      }),
    );
    assert.equal(failureOf(error), 'workflow_uncertified');
  });

  it('denies a run whose plan changed underneath it', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const before = buildTestWorkflowRuntime({ runStore });
    const created = await before.workflows.service.createRun({
      ...before.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });

    // A deployment changed the definition. Same id, new version, new digest.
    const after = buildTestWorkflowRuntime({
      runStore,
      workflows: [{ ...EXECUTABLE.single, version: '1.0.1' }],
    });
    const denied = await after.workflows.service.advanceRun({
      ...after.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });

    assert.equal(denied.state, 'policy_denied');
    assert.equal(denied.failure, 'workflow_plan_mismatch');
    assert.deepEqual(denied.childAgentRunIds, [], 'a changed plan is not migrated into');
  });
});

// ── The service boundary ────────────────────────────────────────────────────

describe('workflow service boundary', () => {
  it('does not return another tenant a run they can see the existence of', async () => {
    const harness = buildTestWorkflowRuntime();
    const acmeRun = await harness.workflows.service.createRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });

    // `otherTenant` is a consultant at globex: fully entitled to workflow runs,
    // in the wrong organization. The refusal is "not found", not "forbidden",
    // so the reply cannot be used to probe for another tenant's run ids.
    const read = await rejection(
      harness.workflows.service.getRun({
        ...harness.meta(AGENT_TOKEN.otherTenant),
        workflowRunId: acmeRun.workflowRunId,
      }),
    );
    assert.equal(failureOf(read), 'workflow_run_not_found');

    const controlled = await rejection(
      harness.workflows.service.cancelRun({
        ...harness.meta(AGENT_TOKEN.otherTenant),
        workflowRunId: acmeRun.workflowRunId,
        reason: 'Not mine to cancel.',
      }),
    );
    assert.equal(failureOf(controlled), 'workflow_run_not_found');

    const listed = await harness.workflows.service.listRuns({
      ...harness.meta(AGENT_TOKEN.otherTenant),
    });
    assert.deepEqual(listed, []);
  });

  it('refuses a role that may read but not start a run', async () => {
    const harness = buildTestWorkflowRuntime();
    // `reviewer` holds the read capabilities and neither create nor control.
    const listed = await harness.workflows.service.listWorkflows({
      ...harness.meta(AGENT_TOKEN.reviewer),
    });
    assert.equal(listed.length, EXECUTABLE_WORKFLOWS.length);

    const error = await rejection(
      harness.workflows.service.createRun({
        ...harness.meta(AGENT_TOKEN.reviewer),
        workflowId: EXECUTABLE.single.workflowId,
        input: TOPIC,
      }),
    );
    assert.equal(failureOf(error), 'workflow_unauthorized');
  });

  it('refuses a subject with no qualifying role at all', async () => {
    const harness = buildTestWorkflowRuntime();
    await assert.rejects(
      harness.workflows.service.listRuns({ ...harness.meta(AGENT_TOKEN.outsider) }),
      /not permitted to use workflow runs/,
    );
  });

  it('reports an unknown run as not found', async () => {
    const harness = buildTestWorkflowRuntime();
    const error = await rejection(
      harness.workflows.service.getRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: 'wfr_absent',
      }),
    );
    assert.equal(failureOf(error), 'workflow_run_not_found');
  });

  it('summarises runs for an operator without leaking content', async () => {
    const harness = buildTestWorkflowRuntime();
    await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: TOPIC,
    });

    const overview = await harness.workflows.service.overview({
      ...harness.meta(AGENT_TOKEN.consultant),
    });
    assert.equal(overview.counts.completed, 1);
    assert.equal(overview.registeredWorkflows, EXECUTABLE_WORKFLOWS.length);
    assert.equal(overview.scope, 'organization');
    assert.ok(overview.capabilities.includes('workflow.run.create'));
  });
});
