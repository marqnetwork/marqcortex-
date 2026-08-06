/**
 * Workflow runtime suite (AI-01 Batch 3B).
 *
 * Exercises the REAL runtime end to end through the HTTP adapter — registry,
 * planner, state machine, orchestrator, conditions, joins, approvals,
 * checkpoints and durability. Nothing on the path is stubbed; what is replaced
 * is the clock, the id factory and the provider, so every assertion is about the
 * orchestrator's decisions rather than about a model's mood.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_TOKEN,
  WORKFLOW_ID,
  buildTestWorkflowRuntime,
  createFakeKv,
  cyclicWorkflow,
  FIXTURE_WORKFLOWS,
  workflowBody,
} from './workflowFixtures.ts';
import {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowHttpRequest,
} from '../workflows/http/workflowHttpAdapter.ts';
import {
  createKvWorkflowCheckpointStore,
  createKvWorkflowRunStore,
} from '../workflows/persistence/kvWorkflowStores.ts';
import {
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
} from '../agents/persistence/kvAgentStores.ts';
import { createWorkflowRegistry } from '../workflows/registry/workflowRegistry.ts';
import { planWorkflow } from '../workflows/planner/workflowPlanner.ts';
import {
  WORKFLOW_OPERATION_SOURCES,
  WORKFLOW_PAUSABLE_STATES,
  WORKFLOW_TRANSITIONS,
  canTransitionWorkflow,
} from '../workflows/runtime/workflowStateMachine.ts';
import {
  admitNode,
  evaluateCondition,
  requiredSuccesses,
} from '../workflows/runtime/conditions.ts';
import { TERMINAL_WORKFLOW_STATES, WORKFLOW_RUN_STATES } from '../workflows/contracts/runtime.ts';
import { isWorkflowRuntimeError } from '../workflows/contracts/failures.ts';
import { bearer } from './agentFixtures.ts';

type Harness = ReturnType<typeof buildTestWorkflowRuntime>;

function caller(harness: Harness, token: string) {
  return (request: Partial<WorkflowHttpRequest> & { operation: WorkflowHttpRequest['operation'] }) =>
    executeWorkflowHttpRequest(harness.runtime.service, {
      authorization: bearer(token),
      ...request,
    });
}

interface RunView {
  workflowRunId: string;
  workflowId: string;
  state: string;
  currentWave: number;
  totalWaves: number;
  nodeExecutions: number;
  agentRunIds: string[];
  factKeys: string[];
  pendingApprovalId?: string;
  failure?: string;
  nodes: { nodeId: string; state: string; wave: number; skipReason?: string; agentRunId?: string }[];
  plan: string[][];
  maxParallel: number;
  planDigest: string;
  checkpointVersion: number;
  costMicroUsd: number;
  totalTokens: number;
  avoidedMicroUsd: number;
  optimizationScore: number;
  terminalNodeId?: string;
}

function runOf(body: Record<string, unknown>): RunView {
  return body.run as unknown as RunView;
}

/**
 * Match a registration failure by its DIAGNOSTICS rather than its message.
 *
 * The caller-safe message is deliberately the same for every invalid
 * definition; the specific problem is server-side detail, which is exactly the
 * split every other surface in this platform makes.
 */
function diagnosticsMatching(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown) => {
    const diagnostics = (error as { diagnostics?: string }).diagnostics ?? '';
    return pattern.test(diagnostics);
  };
}

function nodeOf(run: RunView, nodeId: string) {
  const node = run.nodes.find((entry) => entry.nodeId === nodeId);
  assert.ok(node, `node ${nodeId} is present on the run`);
  return node;
}

// ── The plan ────────────────────────────────────────────────────────────────

describe('workflow planner — deterministic layering', () => {
  const registryOptions = {
    requireCertification: () => false,
    agentExists: () => true,
    toolExists: () => true,
    agentMayUseTool: () => true,
  };

  it('places a node one wave past its deepest dependency', () => {
    const plan = planWorkflow(
      FIXTURE_WORKFLOWS.find((workflow) => workflow.workflowId === WORKFLOW_ID.parallel)!,
    );
    assert.deepEqual(plan.waves, [['start'], ['left', 'right'], ['done']]);
    assert.equal(plan.maxParallel, 2);
    assert.equal(plan.nodeCount, 4);
  });

  it('splits a layer wider than the concurrency ceiling', () => {
    const wide = {
      ...FIXTURE_WORKFLOWS.find((workflow) => workflow.workflowId === WORKFLOW_ID.quorum)!,
    };
    const plan = planWorkflow(wide);
    // Three independent branches, ceiling of two: the layer becomes two waves,
    // and the split is taken in node-id order so it is reproducible.
    assert.deepEqual(plan.waves, [['start'], ['a', 'b'], ['c'], ['done']]);
  });

  it('produces the same digest for the same definition', () => {
    const definition = FIXTURE_WORKFLOWS.find(
      (workflow) => workflow.workflowId === WORKFLOW_ID.sequential,
    )!;
    assert.equal(planWorkflow(definition).digest, planWorkflow(definition).digest);
  });

  it('refuses a plan it cannot order', () => {
    assert.throws(
      () => planWorkflow(cyclicWorkflow),
      (error: unknown) => isWorkflowRuntimeError(error) && error.failure === 'cycle_detected',
    );
  });

  it('the registry refuses the same cycle at registration', () => {
    const registry = createWorkflowRegistry(registryOptions);
    // The caller-safe message is deliberately vague; the precise problem lives
    // in `diagnostics`, which is logged and never returned to a caller.
    assert.throws(() => registry.register(cyclicWorkflow), diagnosticsMatching(/cycle|reachable/i));
    assert.equal(registry.size(), 0);
  });

  it('refuses a workflow naming an agent that is not registered', () => {
    const registry = createWorkflowRegistry({ ...registryOptions, agentExists: () => false });
    assert.throws(
      () =>
        registry.register(
          FIXTURE_WORKFLOWS.find((workflow) => workflow.workflowId === WORKFLOW_ID.sequential)!,
        ),
      diagnosticsMatching(/not registered/),
    );
  });

  it('refuses a tool node whose agent may not use the tool', () => {
    const registry = createWorkflowRegistry({ ...registryOptions, agentMayUseTool: () => false });
    assert.throws(
      () =>
        registry.register(
          FIXTURE_WORKFLOWS.find((workflow) => workflow.workflowId === WORKFLOW_ID.tool)!,
        ),
      diagnosticsMatching(/allow list/),
    );
  });

  it('refuses a condition on a fact nothing publishes', () => {
    const registry = createWorkflowRegistry(registryOptions);
    const definition = FIXTURE_WORKFLOWS.find(
      (workflow) => workflow.workflowId === WORKFLOW_ID.sequential,
    )!;
    const broken = {
      ...definition,
      workflowId: 'workflow.test.brokenfact',
      nodes: definition.nodes.map((node) =>
        node.nodeId === 'done'
          ? { ...node, when: [{ fact: 'nobody.publishes_this', operator: 'exists' as const }] }
          : node,
      ),
    };
    assert.throws(() => registry.register(broken), diagnosticsMatching(/no node publishes/));
  });
});

// ── The state machine ───────────────────────────────────────────────────────

describe('workflow state machine — one table, three questions', () => {
  it('has no outgoing edge from any terminal state', () => {
    for (const state of TERMINAL_WORKFLOW_STATES) {
      assert.deepEqual(WORKFLOW_TRANSITIONS[state], [], `${state} must be terminal`);
    }
  });

  it('declares a transition list for every state', () => {
    for (const state of WORKFLOW_RUN_STATES) {
      assert.ok(Array.isArray(WORKFLOW_TRANSITIONS[state]), `${state} has a transition list`);
    }
  });

  it('never lets pause reach a run waiting on a human', () => {
    // The defect this pins: pausing an approval-waiting run loses the gate and
    // strands the decision. The agent state machine was remediated for exactly
    // this, and the workflow machine must not reintroduce it.
    assert.equal(WORKFLOW_OPERATION_SOURCES.pause.includes('waiting_for_approval'), false);
    assert.equal(canTransitionWorkflow('waiting_for_approval', 'paused'), false);
  });

  it('keeps the pausable list and the operation sources in agreement', () => {
    assert.deepEqual([...WORKFLOW_PAUSABLE_STATES].sort(), [...WORKFLOW_OPERATION_SOURCES.pause].sort());
  });

  it('lets an operator cancel from every live state', () => {
    const live = WORKFLOW_RUN_STATES.filter((state) => !TERMINAL_WORKFLOW_STATES.includes(state));
    for (const state of live) {
      assert.ok(
        WORKFLOW_OPERATION_SOURCES.cancel.includes(state),
        `cancel must be available from ${state}`,
      );
    }
  });
});

// ── Conditions and joins ────────────────────────────────────────────────────

describe('workflow conditions — total, data-only evaluation', () => {
  const facts = { 'a.value': 3, 'a.label': 'yes', 'a.flag': true };

  it('an absent fact makes every operator false except absent', () => {
    assert.equal(evaluateCondition({ fact: 'missing', operator: 'exists' }, facts), false);
    assert.equal(evaluateCondition({ fact: 'missing', operator: 'absent' }, facts), true);
    // The important one: a negative comparison must not pass because the thing
    // it guards on never happened.
    assert.equal(
      evaluateCondition({ fact: 'missing', operator: 'not_equals', value: 'x' }, facts),
      false,
    );
  });

  it('compares numbers and scalars without coercion', () => {
    assert.equal(evaluateCondition({ fact: 'a.value', operator: 'gte', value: 3 }, facts), true);
    assert.equal(evaluateCondition({ fact: 'a.value', operator: 'lte', value: 2 }, facts), false);
    assert.equal(
      evaluateCondition({ fact: 'a.label', operator: 'gte', value: 1 }, facts),
      false,
      'a string is never compared as a number',
    );
    assert.equal(evaluateCondition({ fact: 'a.flag', operator: 'is_true' }, facts), true);
  });

  it('quorum needs the count it declares, any needs one, all needs every one', () => {
    assert.equal(requiredSuccesses({ policy: 'all' }, 3), 3);
    assert.equal(requiredSuccesses({ policy: 'any' }, 3), 1);
    assert.equal(requiredSuccesses({ policy: 'quorum', quorum: 2 }, 3), 2);
  });

  it('distinguishes blocked from skipped', () => {
    const node = {
      nodeId: 'x',
      kind: 'terminal' as const,
      displayName: 'x',
      purpose: 'x',
      dependsOn: ['a', 'b'],
      outcome: 'succeeded' as const,
    };
    assert.equal(
      admitNode(node, { a: 'succeeded', b: 'running' }, {}).admission,
      'blocked',
      'an unsettled dependency may still succeed',
    );
    assert.equal(
      admitNode(node, { a: 'succeeded', b: 'failed' }, {}).admission,
      'skipped',
      'an `all` join with a failed dependency can never be satisfied',
    );
    assert.equal(admitNode(node, { a: 'succeeded', b: 'succeeded' }, {}).admission, 'ready');
  });
});

// ── Execution ───────────────────────────────────────────────────────────────

describe('workflow runtime — sequential and parallel execution', () => {
  it('runs a sequential plan to completion', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const run = runOf((await call({ operation: WORKFLOW_OPERATION.createRun, body: workflowBody() })).body);

    assert.equal(run.state, 'completed');
    assert.equal(run.terminalNodeId, 'done');
    assert.equal(nodeOf(run, 'intake').state, 'succeeded');
    assert.equal(run.agentRunIds.length, 1);
    assert.deepEqual(run.factKeys, ['intake.finding']);
  });

  it('runs an independent layer as one bounded wave', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const run = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.parallel }),
        })
      ).body,
    );

    assert.equal(run.state, 'completed');
    assert.deepEqual(run.plan, [['start'], ['left', 'right'], ['done']]);
    assert.equal(run.maxParallel, 2);
    assert.equal(nodeOf(run, 'left').state, 'succeeded');
    assert.equal(nodeOf(run, 'right').state, 'succeeded');
    assert.equal(run.agentRunIds.length, 3, 'one agent run per agent node');
  });

  it('never exceeds the declared concurrency, because the plan cannot express it', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const run = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.quorum }),
        })
      ).body,
    );
    for (const wave of run.plan) {
      assert.ok(wave.length <= run.maxParallel, `wave ${wave.join(',')} is within the ceiling`);
    }
  });

  it('takes the branch a condition selects and skips the other', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const run = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.conditional }),
        })
      ).body,
    );

    assert.equal(run.state, 'completed');
    assert.equal(nodeOf(run, 'approved').state, 'succeeded');
    assert.equal(nodeOf(run, 'rejected').state, 'skipped');
    assert.match(nodeOf(run, 'rejected').skipReason ?? '', /condition not met/);
  });

  it('satisfies a quorum join over an optional failure', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const run = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.quorum }),
        })
      ).body,
    );

    assert.equal(nodeOf(run, 'c').state, 'failed', 'the optional branch really did fail');
    assert.equal(run.state, 'completed', 'two of three is the declared quorum');
    assert.equal(run.terminalNodeId, 'done');
  });

  it('runs a tool node through the certified gateway under an agent’s permission', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const run = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.tool }),
        })
      ).body,
    );

    assert.equal(run.state, 'completed');
    assert.equal(nodeOf(run, 'lookup').state, 'succeeded');
    // The tool published its scalars; the fact map holds keys, and the values
    // stay inside the record.
    assert.deepEqual(run.factKeys, ['lookup.found', 'lookup.value']);
    assert.equal(run.agentRunIds.length, 0, 'a tool node starts no agent run');
  });

  it('carries a seed fact into the plan without letting it become a structure', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const run = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ facts: { topic: 'seeded', nested: { no: 'thanks' }, count: 3 } }),
        })
      ).body,
    );
    assert.ok(run.factKeys.includes('seed.topic'));
    assert.ok(run.factKeys.includes('seed.count'));
    assert.equal(run.factKeys.includes('seed.nested'), false, 'a structure is not a fact');
  });
});

// ── Approvals ───────────────────────────────────────────────────────────────

describe('workflow runtime — human approval gates', () => {
  it('parks the plan and resumes it on sign-off', async () => {
    const harness = buildTestWorkflowRuntime();
    const consultant = caller(harness, AGENT_TOKEN.consultant);
    const owner = caller(harness, AGENT_TOKEN.owner);

    const parked = runOf(
      (
        await consultant({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );
    assert.equal(parked.state, 'waiting_for_approval');
    assert.ok(parked.pendingApprovalId);
    assert.equal(nodeOf(parked, 'sign_off').state, 'waiting_for_approval');

    const approved = runOf(
      (
        await owner({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: parked.workflowRunId,
          approvalId: parked.pendingApprovalId,
          body: { decision: 'approve', reason: 'signed off by the owner' },
        })
      ).body,
    );
    assert.equal(approved.state, 'completed');
    assert.equal(nodeOf(approved, 'sign_off').state, 'succeeded');
  });

  it('refuses an approver whose role may not decide', async () => {
    const harness = buildTestWorkflowRuntime();
    const consultant = caller(harness, AGENT_TOKEN.consultant);
    const parked = runOf(
      (
        await consultant({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );

    const refused = await consultant({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: parked.workflowRunId,
      approvalId: parked.pendingApprovalId,
      body: { decision: 'approve', reason: 'approving my own request' },
    });
    assert.equal(refused.status, 403);
  });

  it('ends the plan when a reviewer rejects', async () => {
    const harness = buildTestWorkflowRuntime();
    const consultant = caller(harness, AGENT_TOKEN.consultant);
    const owner = caller(harness, AGENT_TOKEN.owner);
    const parked = runOf(
      (
        await consultant({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );

    const rejected = runOf(
      (
        await owner({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: parked.workflowRunId,
          approvalId: parked.pendingApprovalId,
          body: { decision: 'reject', reason: 'the finding is not acceptable' },
        })
      ).body,
    );
    assert.equal(rejected.state, 'failed');
    assert.equal(rejected.failure, 'workflow_approval_rejected');
  });

  it('cannot spend one approval twice', async () => {
    const harness = buildTestWorkflowRuntime();
    const consultant = caller(harness, AGENT_TOKEN.consultant);
    const owner = caller(harness, AGENT_TOKEN.owner);
    const parked = runOf(
      (
        await consultant({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );
    await owner({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: parked.workflowRunId,
      approvalId: parked.pendingApprovalId,
      body: { decision: 'approve', reason: 'signed off by the owner' },
    });
    const reused = await owner({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: parked.workflowRunId,
      approvalId: parked.pendingApprovalId,
      body: { decision: 'approve', reason: 'trying to reuse the approval' },
    });
    assert.ok(reused.status >= 400, 'a consumed approval cannot authorise a second thing');
  });

  it('refuses to pause or resume a plan waiting on a human', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const parked = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );

    const paused = await call({
      operation: WORKFLOW_OPERATION.pauseRun,
      workflowRunId: parked.workflowRunId,
      body: { reason: 'operator pauses the parked run' },
    });
    const resumed = await call({
      operation: WORKFLOW_OPERATION.resumeRun,
      workflowRunId: parked.workflowRunId,
      body: { reason: 'operator resumes without deciding' },
    });
    const after = runOf(
      (await call({ operation: WORKFLOW_OPERATION.getRun, workflowRunId: parked.workflowRunId })).body,
    );

    assert.ok(paused.status >= 400);
    assert.ok(resumed.status >= 400);
    assert.equal(after.state, 'waiting_for_approval');
  });
});

// ── Durability ──────────────────────────────────────────────────────────────

describe('workflow runtime — durability and concurrency', () => {
  function kvStores() {
    const kv = createFakeKv();
    const options = {
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
    };
    return {
      kv,
      stores: () => ({
        runStore: createKvWorkflowRunStore(options),
        checkpointStore: createKvWorkflowCheckpointStore(options),
        agentRunStore: createKvAgentRunStore(options),
        agentCheckpointStore: createKvAgentCheckpointStore(options),
      }),
      options,
    };
  }

  it('a parked plan survives a simulated isolate restart', async () => {
    const { stores, options } = kvStores();
    const first = buildTestWorkflowRuntime(stores());
    const parked = runOf(
      (
        await caller(first, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );
    assert.equal(parked.state, 'waiting_for_approval');

    // A brand new runtime — nothing in memory carries over. The approval store
    // is shared because in production it is the same durable store.
    const second = buildTestWorkflowRuntime({
      ...stores(),
      approvalStore: first.approvalStore,
    });
    const approved = runOf(
      (
        await caller(second, AGENT_TOKEN.owner)({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: parked.workflowRunId,
          approvalId: parked.pendingApprovalId,
          body: { decision: 'approve', reason: 'decided by a fresh isolate' },
        })
      ).body,
    );
    assert.equal(approved.state, 'completed');

    const stored = await createKvWorkflowRunStore(options).load('acme', parked.workflowRunId);
    assert.equal(stored?.state, 'completed');
  });

  it('writes an immutable checkpoint per wave', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const run = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.parallel }),
        })
      ).body,
    );
    const history = await harness.runtime.checkpoints.history('acme', run.workflowRunId);
    assert.ok(history.length >= 2, `expected several checkpoints, saw ${history.length}`);
    assert.deepEqual(
      history.map((checkpoint) => checkpoint.version),
      history.map((_, index) => index + 1),
      'versions are monotonic with no gaps',
    );
    await assert.rejects(
      () => harness.runtime.checkpoints.write(history[0]),
      (error: unknown) =>
        isWorkflowRuntimeError(error) && error.failure === 'workflow_checkpoint_conflict',
    );
  });

  it('two isolates cannot both advance the same plan', async () => {
    const { stores } = kvStores();
    const a = buildTestWorkflowRuntime(stores());
    const b = buildTestWorkflowRuntime(stores());

    const created = runOf(
      (
        await caller(a, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );
    assert.equal(created.state, 'waiting_for_approval');

    const both = await Promise.all([
      caller(a, AGENT_TOKEN.owner)({
        operation: WORKFLOW_OPERATION.submitApproval,
        workflowRunId: created.workflowRunId,
        approvalId: created.pendingApprovalId,
        body: { decision: 'approve', reason: 'isolate A decides' },
      }),
      caller(b, AGENT_TOKEN.owner)({
        operation: WORKFLOW_OPERATION.submitApproval,
        workflowRunId: created.workflowRunId,
        approvalId: created.pendingApprovalId,
        body: { decision: 'approve', reason: 'isolate B decides' },
      }),
    ]);
    assert.equal(
      both.filter((response) => response.status === 200).length,
      1,
      'exactly one decision wins',
    );
  });

  it('refuses to continue a run whose definition changed underneath it', async () => {
    const { stores } = kvStores();
    const first = buildTestWorkflowRuntime(stores());
    const parked = runOf(
      (
        await caller(first, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );

    // Same id, still a valid definition, different EXECUTION ORDER: the
    // concurrency ceiling changed, so the planner produces different waves and
    // the frozen digest no longer matches. The run must stop rather than execute
    // half of one plan and half of another.
    const definition = FIXTURE_WORKFLOWS.find(
      (workflow) => workflow.workflowId === WORKFLOW_ID.approval,
    )!;
    const edited = {
      ...definition,
      limits: { ...definition.limits, maxParallel: 1 },
      nodes: [
        ...definition.nodes,
        {
          nodeId: 'extra',
          kind: 'agent' as const,
          displayName: 'An added step',
          purpose: 'Change the plan after the run started.',
          dependsOn: ['draft'],
          agentId: definition.nodes[0].kind === 'agent' ? definition.nodes[0].agentId : '',
          objective: 'Establish a deterministic finding for the added step.',
          input: { topic: 'extra', script: 'complete_immediately' },
          publishes: [{ name: 'finding', from: 'finding' }],
        },
      ],
    };
    const second = buildTestWorkflowRuntime({
      ...stores(),
      approvalStore: first.approvalStore,
      workflows: [edited],
    });

    const decided = await caller(second, AGENT_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: parked.workflowRunId,
      approvalId: parked.pendingApprovalId,
      body: { decision: 'approve', reason: 'decided against an edited definition' },
    });
    const after = runOf(decided.body);
    assert.equal(after.state, 'failed');
    assert.equal(after.failure, 'workflow_invalid');
  });
});

// ── Governance ──────────────────────────────────────────────────────────────

describe('workflow runtime — governance and tenancy', () => {
  it('refuses an unauthenticated caller', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await executeWorkflowHttpRequest(harness.runtime.service, {
      operation: WORKFLOW_OPERATION.overview,
      authorization: null,
    });
    assert.equal(response.status, 401);
  });

  it('refuses a caller whose roles grant nothing', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, AGENT_TOKEN.outsider)({
      operation: WORKFLOW_OPERATION.overview,
    });
    assert.equal(response.status, 403);
  });

  it('refuses a reviewer the right to start a plan', async () => {
    // A reviewer may decide approvals and may not create work that then asks
    // itself for approval. The derivation from the agent capability table is
    // what makes that true here without a second table.
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, AGENT_TOKEN.reviewer)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowBody(),
    });
    assert.equal(response.status, 403);
  });

  it('hides another tenant’s run and shows it to a platform reader', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody(),
        })
      ).body,
    );

    const foreign = await caller(harness, AGENT_TOKEN.otherTenant)({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: run.workflowRunId,
    });
    const platform = await caller(harness, AGENT_TOKEN.platform)({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: run.workflowRunId,
      organizationId: 'acme',
    });
    assert.equal(foreign.status, 404, 'another tenant gets "not found", never "forbidden"');
    assert.equal(platform.status, 200);
  });

  it('refuses a disabled workflow', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, AGENT_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowBody({ workflowId: WORKFLOW_ID.disabled }),
    });
    assert.ok(response.status >= 400);
    assert.equal(response.body.failure, 'workflow_disabled');
  });

  it('refuses to start a plan while the kill switch is engaged', async () => {
    const harness = buildTestWorkflowRuntime();
    const settings = harness.plane.settings.current();
    harness.plane.settings.adopt({
      ...settings,
      configurationVersion: settings.configurationVersion + 1,
      emergencyStop: {
        engaged: true,
        reason: 'workflow suite',
        engagedBy: 'ops',
        engagedAt: harness.clock.isoNow(),
      },
    });

    const response = await caller(harness, AGENT_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowBody(),
    });
    assert.ok(response.status >= 400);
    assert.equal(response.body.failure, 'workflow_runtime_disabled');
  });

  it('expires a plan that passed its deadline', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    const parked = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );
    harness.clock.advance(600_000 + 1_000);

    const expired = runOf(
      (
        await caller(harness, AGENT_TOKEN.owner)({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: parked.workflowRunId,
          approvalId: parked.pendingApprovalId,
          body: { decision: 'approve', reason: 'far too late to matter' },
        })
      ).body,
    );
    assert.notEqual(expired.state, 'completed');
  });

  it('records the plan’s decisions in its own audit trail', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    await call({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowBody({ workflowId: WORKFLOW_ID.conditional }),
    });

    const records = (await call({ operation: WORKFLOW_OPERATION.audit, limit: 200 })).body
      .records as { event: string; nodeId?: string; reason?: string }[];
    const events = new Set(records.map((entry) => entry.event));
    assert.ok(events.has('ai.workflow.run.created'));
    assert.ok(events.has('ai.workflow.wave.started'));
    assert.ok(events.has('ai.workflow.node.skipped'), 'a skipped branch is recorded, with a reason');
    assert.ok(events.has('ai.workflow.run.terminated'));

    // No fact VALUE reaches the trail. Keys are the plan's own vocabulary;
    // values are the tenant's data.
    const serialized = JSON.stringify(records);
    assert.equal(serialized.includes('Finding for gate'), false);
  });

  it('never lets an operation be chosen by the request body', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody(),
        })
      ).body,
    );
    // A cancel asked for at the read endpoint is simply a read.
    const response = await caller(harness, AGENT_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: run.workflowRunId,
      body: { operation: 'workflow.run.cancel', reason: 'trying to cancel from a read' },
    });
    assert.equal(response.status, 200);
    assert.equal(runOf(response.body).state, 'completed');
  });
});

// ── The operator surface ────────────────────────────────────────────────────

describe('workflow runtime — operator visibility', () => {
  it('reports an overview scoped to the caller’s tenant', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    await call({ operation: WORKFLOW_OPERATION.createRun, body: workflowBody() });

    const overview = (await call({ operation: WORKFLOW_OPERATION.overview })).body.overview as {
      scope: string;
      organizationId: string;
      counts: Record<string, number>;
      registeredWorkflows: number;
      capabilities: string[];
    };
    assert.equal(overview.scope, 'organization');
    assert.equal(overview.organizationId, 'acme');
    assert.equal(overview.counts.completed, 1);
    assert.equal(overview.registeredWorkflows, FIXTURE_WORKFLOWS.length);
    assert.ok(overview.capabilities.includes('workflow.run.create'));
  });

  it('lists the registry without exposing behaviour', async () => {
    const harness = buildTestWorkflowRuntime();
    const workflows = (
      await caller(harness, AGENT_TOKEN.consultant)({ operation: WORKFLOW_OPERATION.listWorkflows })
    ).body.workflows as { workflowId: string; nodes: unknown[] }[];
    assert.equal(workflows.length, FIXTURE_WORKFLOWS.length);
    assert.equal(JSON.stringify(workflows).includes('propose'), false);
  });

  it('projects nodes and fact keys, never fact values', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody(),
        })
      ).body,
    );
    assert.deepEqual(run.factKeys, ['intake.finding']);
    assert.equal(JSON.stringify(run).includes('Finding for Intake handoffs'), false);
  });
});
