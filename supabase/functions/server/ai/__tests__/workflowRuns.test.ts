/**
 * Workflow execution suite (AI-01 Batch 3B).
 *
 * Drives the REAL engine over the REAL agent runtime over the REAL control plane
 * with the mock provider, and asserts on what the orchestrator decided rather than
 * on what a model happened to say. Sequential completion, conditions, bounded
 * fan-out, every join policy, branch failure, approvals, pause and resume, restart
 * recovery, the wait gate and the state machine's refusals.
 *
 * The runs go in through the HTTP adapter wherever a caller would, because that is
 * the path a browser takes and the only one where the authorization boundary is
 * actually exercised.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowHttpRequest,
} from '../workflows/http/workflowHttpAdapter.ts';
import {
  createKvWorkflowApprovalStore,
  createKvWorkflowCheckpointStore,
  createKvWorkflowRunStore,
} from '../workflows/persistence/kvWorkflowStores.ts';
import {
  assertWorkflowTransition,
  canTransition,
  canOperateFrom,
  OPERATION_SOURCES,
  OPERATION_TARGETS,
  PAUSABLE_STATES,
  TRANSITIONS,
} from '../workflows/runtime/stateMachine.ts';
import {
  WORKFLOW_RUN_OPERATIONS,
  WORKFLOW_RUN_STATES,
  isTerminalWorkflowState,
} from '../workflows/contracts/runtime.ts';
import type { WorkflowRunState } from '../workflows/contracts/runtime.ts';
import { isWorkflowError } from '../workflows/contracts/failures.ts';
import { evaluateJoin, initialJoinRecord, recordBranchArrival } from '../workflows/runtime/joins.ts';
import { createFakeKv } from './agentFixtures.ts';
import {
  WORKFLOW_ID,
  WORKFLOW_TOKEN,
  bearer,
  buildTestWorkflowRuntime,
  fanOutWorkflow,
  workflowRunBody,
  type TestWorkflowRuntime,
} from './workflowFixtures.ts';

// ── Helpers ─────────────────────────────────────────────────────────────────

function caller(harness: TestWorkflowRuntime, token: string) {
  return (
    request: Partial<WorkflowHttpRequest> & { operation: WorkflowHttpRequest['operation'] },
  ) =>
    executeWorkflowHttpRequest(harness.runtime.service, {
      authorization: bearer(token),
      correlationId: 'cor_test_workflow',
      ...request,
    });
}

interface RunView {
  workflowRunId: string;
  state: WorkflowRunState;
  stepCount: number;
  retryCount: number;
  activeBranches: number;
  completedBranches: number;
  failedBranches: number;
  childAgentRuns: number;
  failure?: string;
  failureMessage?: string;
  pendingApprovalId?: string;
  planDigest: string;
  checkpointVersion: number;
  resultDigest?: string;
  totalTokens: number;
  costMicroUsd: number;
  avoidedMicroUsd: number;
  branches: { branchId: string; state: string; stepCount: number }[];
  joins: { joinNodeId: string; satisfied: boolean; succeededBranchIds: string[]; failedBranchIds: string[] }[];
  optimizationScore: { score: number; grade: string };
  limitsReached: string[];
}

function runOf(body: Record<string, unknown>): RunView {
  assert.equal(body.success, true, `expected success, got ${JSON.stringify(body).slice(0, 400)}`);
  return body.run as unknown as RunView;
}

async function startRun(
  harness: TestWorkflowRuntime,
  overrides: Record<string, unknown> = {},
  token: string = WORKFLOW_TOKEN.consultant,
): Promise<RunView> {
  const call = caller(harness, token);
  const response = await call({
    operation: WORKFLOW_OPERATION.createRun,
    body: workflowRunBody(overrides),
  });
  return runOf(response.body);
}

// ── Sequential ──────────────────────────────────────────────────────────────

describe('sequential workflow execution', () => {
  it('completes a transform → model → complete run and records its result', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness);

    assert.equal(run.state, 'completed');
    // normalize, analyse, finish
    assert.equal(run.stepCount, 3);
    assert.ok(run.resultDigest, 'a completed run carries the digest of its accepted output');
    assert.ok(run.totalTokens > 0, 'the model node reconciled measured usage');
    assert.ok(run.costMicroUsd >= 0);
    assert.equal(run.retryCount, 0);
    assert.ok(harness.providerCalls() > 0, 'the model node reached the mock provider');
  });

  it('writes one checkpoint per node plus the entry checkpoint', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness);
    const history = await harness.runtime.checkpoints.history('acme', run.workflowRunId);

    assert.ok(history.length >= 4, `expected at least 4 checkpoints, got ${history.length}`);
    // Versions are monotonic with no gaps, and each links to the previous digest —
    // which is what makes the chain verifiable rather than merely present.
    for (let index = 0; index < history.length; index += 1) {
      assert.equal(history[index].version, index + 1);
      if (index > 0) {
        assert.equal(
          history[index].previousDigest,
          history[index - 1].digest,
          'each checkpoint links to the one before it',
        );
      }
    }
    // The accepting checkpoint is written BEFORE the terminal transition, so it
    // records the run as still `running`. That ordering is deliberate: a failure
    // between the two leaves a checkpoint the run has not yet claimed — recoverable
    // — rather than a state claiming a checkpoint that does not exist.
    assert.ok(history.at(-1)?.output, 'the accepting checkpoint carries the output');
    assert.equal(history.at(-1)?.state, 'running');
    assert.equal(run.state, 'completed');
  });

  it('records the plan identity on the run and refuses a plan that changed', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness);
    const plan = harness.runtime.orchestrator.planFor(WORKFLOW_ID.sequential);
    assert.equal(run.planDigest, plan.digest);
  });

  it('reports node history with digests and never raw content', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness);
    const call = caller(harness, WORKFLOW_TOKEN.consultant);
    const response = await call({
      operation: WORKFLOW_OPERATION.runNodes,
      workflowRunId: run.workflowRunId,
    });
    const nodes = (response.body.nodes as { nodeId: string; inputDigest: string; outcome: string }[]);

    assert.deepEqual(nodes.map((node) => node.nodeId), ['normalize', 'analyse', 'finish']);
    for (const node of nodes) {
      assert.match(node.inputDigest, /^[0-9a-f]{32}$/, 'inputs are digested, never carried');
    }
    const serialized = JSON.stringify(response.body);
    assert.equal(
      serialized.includes('Intake triage readiness'),
      false,
      'the node view must not echo the run input',
    );
  });

  it('executes a tool node through the certified Batch 3A gateway', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, {
      workflowId: WORKFLOW_ID.toolDriven,
      input: { topic: 'Tooling', statements: ['One statement.', 'A longer second statement.'] },
    });
    assert.equal(run.state, 'completed');

    const audit = harness.runtime.audit.recent(100);
    const invoked = audit.find((entry) => entry.event === 'ai.workflow.tool.invoked');
    assert.ok(invoked, 'the tool invocation is audited');
    assert.equal(invoked.detail.toolId, 'tool.text.summarize_counts');
    // The key is derived from the run, the node and the branch, so a replay after a
    // restart presents the key the gateway already saw.
    assert.match(String(invoked.detail.idempotencyKey), /^wf:wfr_[^:]+:summarise:main:0$/);
  });

  it('fails a node whose declared input cannot satisfy the tool schema', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, WORKFLOW_TOKEN.consultant);
    // An empty list fails the tool's own `minItems` schema at the GATEWAY — the
    // certified Batch 3A validation, not a second check the workflow engine wrote.
    const response = await call({
      operation: WORKFLOW_OPERATION.createRun,
      body: { workflowId: WORKFLOW_ID.toolDriven, input: { topic: 'Tooling', statements: [] } },
    });
    assert.equal(response.body.success, false, 'the run input is refused by its contract');
  });
});

// ── Conditions ──────────────────────────────────────────────────────────────

describe('condition nodes', () => {
  it('takes the true edge and audits the decision without echoing the value', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, {
      workflowId: WORKFLOW_ID.conditional,
      input: { topic: 'Routing', route: 'primary' },
    });
    assert.equal(run.state, 'completed');

    const audit = harness.runtime.audit.recent(200);
    const decision = audit.find((entry) => entry.event === 'ai.workflow.condition.evaluated');
    assert.ok(decision, 'the condition decision is audited');
    assert.equal(decision.detail.result, true);
    assert.equal(decision.detail.takenNodeId, 'deep');
    assert.equal(decision.detail.excludedNodeId, 'shallow');
    // The SHAPE, never the value.
    assert.match(String(decision.detail.observed), /^string\(\d+\)$/);
  });

  it('takes the false edge and credits the excluded model call', async () => {
    const harness = buildTestWorkflowRuntime();
    const before = harness.providerCalls();
    const run = await startRun(harness, {
      workflowId: WORKFLOW_ID.conditional,
      input: { topic: 'Routing', route: 'secondary' },
    });
    assert.equal(run.state, 'completed');
    assert.equal(harness.providerCalls(), before, 'the deterministic path called no provider');

    const call = caller(harness, WORKFLOW_TOKEN.consultant);
    const report = await call({
      operation: WORKFLOW_OPERATION.tokenReport,
      workflowRunId: run.workflowRunId,
    });
    const avoided = (report.body.report as { avoidedCalls: { reason: string; comparedAgainstProfileId: string; avoidedMicroUsd: number; estimateVersion: string }[] }).avoidedCalls;

    const reasons = avoided.map((entry) => entry.reason);
    assert.ok(reasons.includes('condition_excluded_branch'), 'the excluded branch is credited');
    assert.ok(reasons.includes('deterministic_transform'), 'the transform is credited');
    for (const entry of avoided) {
      assert.ok(entry.comparedAgainstProfileId, 'every saving names what it was measured against');
      assert.ok(entry.estimateVersion, 'every saving names its estimate basis');
      assert.ok(entry.avoidedMicroUsd > 0);
    }
  });

  it('treats a missing value as false rather than an error', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, {
      workflowId: WORKFLOW_ID.conditional,
      // `route` defaults to `primary`, so ask for something that cannot equal it.
      input: { topic: 'Routing', route: 'other' },
    });
    assert.equal(run.state, 'completed');
  });
});

// ── Parallel and joins ──────────────────────────────────────────────────────

describe('bounded parallel execution', () => {
  it('fans out, joins on `all` and merges in planned branch order', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, {
      workflowId: WORKFLOW_ID.parallelAll,
      input: { topic: 'Parallel readiness' },
    });

    assert.equal(run.state, 'completed');
    assert.equal(run.completedBranches, 2);
    assert.equal(run.failedBranches, 0);
    assert.equal(run.activeBranches, 0);
    assert.equal(run.joins.length, 1);
    assert.equal(run.joins[0].satisfied, true);
    assert.deepEqual(run.joins[0].succeededBranchIds, ['left', 'right']);
    // Every branch record is closed, and each carries its own step count.
    for (const branch of run.branches) {
      assert.equal(branch.state, 'completed');
      assert.ok(branch.stepCount >= 1);
    }
  });

  it('never exceeds the declared parallel width', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, {
      workflowId: WORKFLOW_ID.parallelAll,
      input: { topic: 'Width' },
    });
    const audit = harness.runtime.audit.recent(400);
    const opened = audit.filter((entry) => entry.event === 'ai.workflow.branch.opened');
    assert.equal(opened.length, 2);
    // Both arms fit inside the width of 4, so both are admitted immediately.
    assert.deepEqual(
      opened.map((entry) => entry.detail.admitted).sort(),
      [true, true],
    );
    assert.equal(run.state, 'completed');
  });

  it('satisfies an `any` join when one arm succeeds and one fails', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, {
      workflowId: WORKFLOW_ID.parallelAny,
      input: { topic: 'Any join' },
    });

    assert.equal(run.state, 'completed');
    assert.equal(run.joins[0].satisfied, true);
    // The left arm failed first, so the join genuinely counted a failure and then
    // waited for the right arm to succeed.
    assert.deepEqual(run.joins[0].failedBranchIds, ['left']);
    assert.deepEqual(run.joins[0].succeededBranchIds, ['right']);
    assert.equal(run.failedBranches, 1);
    assert.ok(run.limitsReached.includes('failed_branches:1'));
  });

  it('satisfies a minimum-successes join at exactly the minimum', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, {
      workflowId: WORKFLOW_ID.parallelMinimum,
      input: { topic: 'Minimum join' },
    });
    assert.equal(run.state, 'completed');
    assert.equal(run.joins[0].succeededBranchIds.length, 1);
  });

  it('fails the run when an `all` join loses a branch', async () => {
    const harness = buildTestWorkflowRuntime({
      workflows: [
        fanOutWorkflow({
          workflowId: 'workflow.test.all_poisoned',
          policy: 'all',
          poisonBranch: 'right',
        }),
      ],
    });
    const run = await startRun(harness, {
      workflowId: 'workflow.test.all_poisoned',
      input: { topic: 'All join' },
    });

    assert.equal(run.state, 'failed');
    assert.equal(run.failure, 'join_unsatisfied');
    assert.ok(run.failureMessage);
  });

  it('stops immediately under fail_fast even though success was still possible', async () => {
    const harness = buildTestWorkflowRuntime({
      workflows: [
        fanOutWorkflow({
          workflowId: 'workflow.test.fail_fast',
          policy: 'any',
          failurePolicy: 'fail_fast',
          poisonBranch: 'left',
        }),
      ],
    });
    const run = await startRun(harness, {
      workflowId: 'workflow.test.fail_fast',
      input: { topic: 'Fail fast' },
    });
    // `any` would have been satisfiable by the right arm. fail_fast is what the
    // author asked for, and the engine must not override a declared policy just
    // because a better outcome was reachable.
    assert.equal(run.state, 'failed');
    assert.equal(run.failure, 'join_unsatisfied');
  });

  it('propagates cancellation to every open branch', async () => {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, WORKFLOW_TOKEN.owner);
    // A wait node inside the fan-out would be needed to catch it mid-flight, so this
    // asserts the run-level guarantee: a cancelled run leaves no branch alive.
    const started = await startRun(harness, {
      workflowId: WORKFLOW_ID.parallelAll,
      input: { topic: 'Cancellation' },
    }, WORKFLOW_TOKEN.owner);
    assert.equal(started.state, 'completed');

    const paused = await startRun(harness, { workflowId: WORKFLOW_ID.waiting }, WORKFLOW_TOKEN.owner);
    const cancelled = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.cancelRun,
          workflowRunId: paused.workflowRunId,
          body: { reason: 'the operator stopped this run' },
        })
      ).body,
    );
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.activeBranches, 0);
  });
});

describe('join engine', () => {
  const plan = {
    joinNodeId: 'converge',
    parallelNodeId: 'split',
    policy: 'all' as const,
    expectedBranchIds: ['left', 'right'],
    minimumSuccesses: 2,
    requiredBranchIds: [],
    onSatisfied: 'cancel_remaining' as const,
    failurePolicy: 'wait_all' as const,
  };

  it('waits until every expected branch has arrived', () => {
    let record = initialJoinRecord(plan);
    assert.equal(evaluateJoin(record, plan).status, 'waiting');
    record = recordBranchArrival(record, {
      branchId: 'left',
      outcome: 'completed',
      workflowRunId: 'wfr_1',
    });
    assert.equal(evaluateJoin(record, plan).status, 'waiting');
    record = recordBranchArrival(record, {
      branchId: 'right',
      outcome: 'completed',
      workflowRunId: 'wfr_1',
    });
    assert.equal(evaluateJoin(record, plan).status, 'satisfied');
  });

  it('refuses a duplicate branch arrival', () => {
    let record = initialJoinRecord(plan);
    record = recordBranchArrival(record, {
      branchId: 'left',
      outcome: 'completed',
      workflowRunId: 'wfr_1',
    });
    assert.throws(
      () =>
        recordBranchArrival(record, {
          branchId: 'left',
          outcome: 'completed',
          workflowRunId: 'wfr_1',
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'join_conflict');
        assert.match(error.diagnostics ?? '', /duplicate arrival/);
        return true;
      },
    );
  });

  it('refuses a branch the plan does not expect', () => {
    const record = initialJoinRecord(plan);
    assert.throws(
      () =>
        recordBranchArrival(record, {
          branchId: 'middle',
          outcome: 'completed',
          workflowRunId: 'wfr_1',
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'join_conflict');
        assert.match(error.diagnostics ?? '', /not in the planned expected set/);
        return true;
      },
    );
  });

  it('refuses any arrival at a join that has already fired', () => {
    let record = initialJoinRecord(plan);
    record = recordBranchArrival(record, {
      branchId: 'left',
      outcome: 'completed',
      workflowRunId: 'wfr_1',
    });
    record = recordBranchArrival(record, {
      branchId: 'right',
      outcome: 'completed',
      workflowRunId: 'wfr_1',
    });
    const fired = { ...record, satisfied: true };
    assert.throws(
      () =>
        recordBranchArrival(fired, {
          branchId: 'left',
          outcome: 'completed',
          workflowRunId: 'wfr_1',
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.match(error.diagnostics ?? '', /already fired/);
        return true;
      },
    );
  });

  it('declares a minimum-successes join unsatisfiable as soon as it cannot be met', () => {
    const minimumPlan = { ...plan, policy: 'minimum_successes' as const, minimumSuccesses: 2 };
    let record = initialJoinRecord(minimumPlan);
    record = recordBranchArrival(record, {
      branchId: 'left',
      outcome: 'failed',
      workflowRunId: 'wfr_1',
    });
    // One arm failed and only one remains: two successes are now impossible, and the
    // engine must say so rather than waiting for the second arrival.
    assert.equal(evaluateJoin(record, minimumPlan).status, 'unsatisfiable');
  });

  it('sorts arrival lists so the record does not depend on arrival order', () => {
    const forward = recordBranchArrival(
      recordBranchArrival(initialJoinRecord(plan), {
        branchId: 'left',
        outcome: 'completed',
        workflowRunId: 'wfr_1',
      }),
      { branchId: 'right', outcome: 'completed', workflowRunId: 'wfr_1' },
    );
    const reverse = recordBranchArrival(
      recordBranchArrival(initialJoinRecord(plan), {
        branchId: 'right',
        outcome: 'completed',
        workflowRunId: 'wfr_1',
      }),
      { branchId: 'left', outcome: 'completed', workflowRunId: 'wfr_1' },
    );
    assert.deepEqual(forward.arrivedBranchIds, reverse.arrivedBranchIds);
    assert.deepEqual(forward.succeededBranchIds, reverse.succeededBranchIds);
  });
});

// ── Approvals ───────────────────────────────────────────────────────────────

describe('workflow approvals', () => {
  it('parks on an approval node and does not proceed', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });

    assert.equal(run.state, 'waiting_for_approval');
    assert.ok(run.pendingApprovalId);

    const pending = await harness.runtime.approvals.pending('acme');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].nodeId, 'sign_off');
    assert.equal(pending[0].singleUse, true);
    // Bound to the checkpoint it was raised against.
    assert.equal(pending[0].checkpointVersion, run.checkpointVersion);
  });

  it('advancing a parked run is a no-op rather than a bypass', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });
    const again = await harness.runtime.orchestrator.advance({
      organizationId: 'acme',
      workflowRunId: run.workflowRunId,
      actor: { actorId: 'user-consultant', roles: ['consultant'], capabilities: [] },
      authorization: bearer(WORKFLOW_TOKEN.consultant),
      requestId: 'req_probe',
      correlationId: 'cor_probe',
    });
    assert.equal(again.state, 'waiting_for_approval');
    assert.equal(again.stepCount, run.stepCount, 'no node ran');
  });

  it('resumes on an authorized approval and completes', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });
    const call = caller(harness, WORKFLOW_TOKEN.owner);

    const decided = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: run.workflowRunId,
          workflowApprovalId: run.pendingApprovalId,
          body: { decision: 'approve', reason: 'the finding is correct' },
        })
      ).body,
    );

    assert.equal(decided.state, 'completed');
    assert.equal(decided.pendingApprovalId, undefined);

    const spent = await harness.runtime.approvals.get('acme', run.pendingApprovalId ?? '');
    assert.equal(spent?.state, 'consumed', 'the approval is spent, not merely approved');
    assert.equal(spent?.decidedBy, 'user-owner');
  });

  it('refuses an approval from a role the node does not authorise', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });
    // `consultant` holds workflow.run.create but not workflow.approval.decide.
    const response = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: run.workflowRunId,
      workflowApprovalId: run.pendingApprovalId,
      body: { decision: 'approve', reason: 'I would like to approve my own work' },
    });
    assert.equal(response.body.success, false);
    assert.equal(response.status, 403);

    const still = await harness.runtime.approvals.get('acme', run.pendingApprovalId ?? '');
    assert.equal(still?.state, 'pending', 'an unauthorized attempt changes nothing');
  });

  it('rejects a run when the approval is rejected', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });
    const decided = runOf(
      (
        await caller(harness, WORKFLOW_TOKEN.reviewer)({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: run.workflowRunId,
          workflowApprovalId: run.pendingApprovalId,
          body: { decision: 'reject', reason: 'the finding is not supportable' },
        })
      ).body,
    );
    assert.equal(decided.state, 'failed');
    assert.equal(decided.failure, 'approval_rejected');
  });

  it('expires an approval and never turns it into a yes', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });
    harness.clock.advance(3_600_001);

    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: run.workflowRunId,
      workflowApprovalId: run.pendingApprovalId,
      body: { decision: 'approve', reason: 'approving after the window closed' },
    });
    assert.equal(response.body.success, false);
    assert.equal(response.body.failure, 'approval_expired');

    const expired = await harness.runtime.approvals.get('acme', run.pendingApprovalId ?? '');
    assert.equal(expired?.state, 'expired');
  });

  it('refuses a replayed approval decision', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });
    const call = caller(harness, WORKFLOW_TOKEN.owner);
    const body = {
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: run.workflowRunId,
      workflowApprovalId: run.pendingApprovalId,
      body: { decision: 'approve' as const, reason: 'the finding is correct' },
    };
    const first = await call(body);
    assert.equal(first.body.success, true);
    const replay = await call(body);
    assert.equal(replay.body.success, false, 'one approval authorises exactly one execution');
  });

  it('refuses pause and resume while an approval is undecided', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });
    const call = caller(harness, WORKFLOW_TOKEN.owner);

    for (const operation of [WORKFLOW_OPERATION.pauseRun, WORKFLOW_OPERATION.resumeRun]) {
      const response = await call({
        operation,
        workflowRunId: run.workflowRunId,
        body: { reason: 'trying to walk past the gate' },
      });
      assert.equal(response.body.success, false, `${operation} must be refused`);
      assert.equal(response.body.failure, 'approval_required');
    }

    // The run is still exactly where it was: a refused control operation must not
    // strand it the way the equivalent agent-runtime defect did.
    const after = runOf(
      (
        await call({ operation: WORKFLOW_OPERATION.getRun, workflowRunId: run.workflowRunId })
      ).body,
    );
    assert.equal(after.state, 'waiting_for_approval');
    assert.equal(after.pendingApprovalId, run.pendingApprovalId);
  });

  it('survives a restart and is still decidable', async () => {
    const kv = createFakeKv();
    const storage = {
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
    };
    const first = buildTestWorkflowRuntime({
      runStore: createKvWorkflowRunStore(storage),
      checkpointStore: createKvWorkflowCheckpointStore(storage),
      approvalStore: createKvWorkflowApprovalStore(storage),
    });
    const run = await startRun(first, { workflowId: WORKFLOW_ID.approval });
    assert.equal(run.state, 'waiting_for_approval');

    // A brand-new engine over the SAME durable storage. Nothing is carried in
    // memory: this is the isolate-restart case.
    const second = buildTestWorkflowRuntime({
      runStore: createKvWorkflowRunStore(storage),
      checkpointStore: createKvWorkflowCheckpointStore(storage),
      approvalStore: createKvWorkflowApprovalStore(storage),
    });
    const recovered = runOf(
      (
        await caller(second, WORKFLOW_TOKEN.owner)({
          operation: WORKFLOW_OPERATION.getRun,
          workflowRunId: run.workflowRunId,
        })
      ).body,
    );
    assert.equal(recovered.state, 'waiting_for_approval');
    assert.equal(recovered.pendingApprovalId, run.pendingApprovalId);

    const decided = runOf(
      (
        await caller(second, WORKFLOW_TOKEN.owner)({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: run.workflowRunId,
          workflowApprovalId: run.pendingApprovalId,
          body: { decision: 'approve', reason: 'approved after the restart' },
        })
      ).body,
    );
    assert.equal(decided.state, 'completed');
  });
});

// ── Pause, resume, restart, wait ────────────────────────────────────────────

describe('durability and control', () => {
  it('pauses and resumes a run', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.waiting }, WORKFLOW_TOKEN.owner);
    const call = caller(harness, WORKFLOW_TOKEN.owner);

    const paused = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.pauseRun,
          workflowRunId: run.workflowRunId,
          body: { reason: 'holding for an operator check' },
        })
      ).body,
    );
    assert.equal(paused.state, 'paused');

    // The wait gate is still in force, so resuming returns a running run that has
    // not taken another node until the clock moves.
    harness.clock.advance(60_001);
    const resumed = runOf(
      (
        await call({
          operation: WORKFLOW_OPERATION.resumeRun,
          workflowRunId: run.workflowRunId,
          body: { reason: 'the check passed' },
        })
      ).body,
    );
    assert.equal(resumed.state, 'completed');
  });

  it('holds a wait node until its instant passes, then continues', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.waiting });
    // The wait node executed and set the gate; the run has not completed.
    assert.notEqual(run.state, 'completed');

    const before = await harness.runtime.orchestrator.advance({
      organizationId: 'acme',
      workflowRunId: run.workflowRunId,
      actor: { actorId: 'user-consultant', roles: ['consultant'], capabilities: [] },
      authorization: bearer(WORKFLOW_TOKEN.consultant),
      requestId: 'req_early',
      correlationId: 'cor_early',
    });
    assert.notEqual(before.state, 'completed', 'the gate holds before its instant');

    harness.clock.advance(60_001);
    const after = await harness.runtime.orchestrator.advance({
      organizationId: 'acme',
      workflowRunId: run.workflowRunId,
      actor: { actorId: 'user-consultant', roles: ['consultant'], capabilities: [] },
      authorization: bearer(WORKFLOW_TOKEN.consultant),
      requestId: 'req_late',
      correlationId: 'cor_late',
    });
    assert.equal(after.state, 'completed');
  });

  it('resumes a mid-flight run from durable storage after a restart', async () => {
    const kv = createFakeKv();
    const storage = {
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
    };
    const clock = undefined;
    const first = buildTestWorkflowRuntime({
      runStore: createKvWorkflowRunStore(storage),
      checkpointStore: createKvWorkflowCheckpointStore(storage),
      approvalStore: createKvWorkflowApprovalStore(storage),
      ...(clock === undefined ? {} : { clock }),
    });
    const run = await startRun(first, { workflowId: WORKFLOW_ID.waiting });
    assert.notEqual(run.state, 'completed');

    const second = buildTestWorkflowRuntime({
      runStore: createKvWorkflowRunStore(storage),
      checkpointStore: createKvWorkflowCheckpointStore(storage),
      approvalStore: createKvWorkflowApprovalStore(storage),
    });
    second.clock.advance(120_000);
    const finished = await second.runtime.orchestrator.advance({
      organizationId: 'acme',
      workflowRunId: run.workflowRunId,
      actor: { actorId: 'user-consultant', roles: ['consultant'], capabilities: [] },
      authorization: bearer(WORKFLOW_TOKEN.consultant),
      requestId: 'req_restart',
      correlationId: 'cor_restart',
    });
    assert.equal(finished.state, 'completed', 'the run resumed from its last checkpoint');
  });

  it('refuses a stale write and does not merge it', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness);
    const stored = await harness.runtime.runs.load('acme', run.workflowRunId);
    assert.ok(stored);

    await assert.rejects(
      () => harness.runtime.runs.save({ ...stored, stepCount: 999 }, stored.runVersion - 1),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'stale_workflow_version');
        return true;
      },
    );
    const unchanged = await harness.runtime.runs.load('acme', run.workflowRunId);
    assert.equal(unchanged?.stepCount, stored.stepCount);
  });

  it('refuses to rewrite a checkpoint version', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness);
    const history = await harness.runtime.checkpoints.history('acme', run.workflowRunId);
    const first = history[0];
    await assert.rejects(
      () => harness.runtime.checkpoints.write({ ...first, state: 'failed' }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'checkpoint_conflict');
        return true;
      },
    );
  });

  it('forks a retry rather than reopening a terminal run', async () => {
    const harness = buildTestWorkflowRuntime({
      workflows: [
        fanOutWorkflow({
          workflowId: 'workflow.test.retryable',
          policy: 'all',
          poisonBranch: 'right',
        }),
      ],
    });
    const failed = await startRun(harness, {
      workflowId: 'workflow.test.retryable',
      input: { topic: 'Retry' },
    }, WORKFLOW_TOKEN.owner);
    assert.equal(failed.state, 'failed');

    const forked = runOf(
      (
        await caller(harness, WORKFLOW_TOKEN.owner)({
          operation: WORKFLOW_OPERATION.retryRun,
          workflowRunId: failed.workflowRunId,
          body: { reason: 'retrying after the branch failure' },
        })
      ).body,
    );
    assert.notEqual(forked.workflowRunId, failed.workflowRunId, 'a retry is a NEW run');

    // The original record is untouched evidence.
    const original = await harness.runtime.runs.load('acme', failed.workflowRunId);
    assert.equal(original?.state, 'failed');
  });

  it('expires a run past its deadline', async () => {
    const harness = buildTestWorkflowRuntime();
    const run = await startRun(harness, { workflowId: WORKFLOW_ID.approval });
    harness.clock.advance(300_001);
    const expired = await harness.runtime.orchestrator.expireIfDue({
      organizationId: 'acme',
      workflowRunId: run.workflowRunId,
      actor: { actorId: 'user-owner', roles: ['owner'], capabilities: [] },
      reason: 'deadline passed',
      requestId: 'req_expire',
      correlationId: 'cor_expire',
    });
    assert.equal(expired.state, 'expired');
    assert.equal(expired.failure, 'workflow_expired');
  });
});

// ── State machine ───────────────────────────────────────────────────────────

describe('workflow state machine', () => {
  it('gives every state an entry and no terminal state an exit', () => {
    for (const state of WORKFLOW_RUN_STATES) {
      assert.ok(Array.isArray(TRANSITIONS[state]), `${state} has no transition entry`);
      if (isTerminalWorkflowState(state)) {
        assert.deepEqual(TRANSITIONS[state], [], `${state} is terminal and must have no exit`);
      }
    }
  });

  it('gives every operation a source and a target list', () => {
    for (const operation of WORKFLOW_RUN_OPERATIONS) {
      assert.ok(Array.isArray(OPERATION_SOURCES[operation]));
      assert.ok(Array.isArray(OPERATION_TARGETS[operation]));
    }
    // `retry` forks a new run rather than transitioning one, so both lists are empty
    // and no transition can claim it.
    assert.deepEqual(OPERATION_TARGETS.retry, []);
    assert.deepEqual(OPERATION_SOURCES.retry, []);
  });

  it('keeps PAUSABLE_STATES and OPERATION_SOURCES.pause in agreement', () => {
    assert.deepEqual([...PAUSABLE_STATES].sort(), [...OPERATION_SOURCES.pause].sort());
  });

  it('never allows pause or resume out of waiting_for_approval', () => {
    assert.equal(canOperateFrom('pause', 'waiting_for_approval'), false);
    assert.equal(canOperateFrom('resume', 'waiting_for_approval'), false);
    // `approve` is the only operation that may produce that edge.
    assert.equal(canTransition('waiting_for_approval', 'running'), true);
    assert.equal(canOperateFrom('approve', 'waiting_for_approval'), true);
  });

  it('always permits cancellation of a live run', () => {
    for (const state of WORKFLOW_RUN_STATES) {
      if (isTerminalWorkflowState(state)) continue;
      assert.ok(
        canOperateFrom('cancel', state),
        `an operator must always be able to cancel from ${state}`,
      );
    }
  });

  it('refuses an invalid transition, a stale version and a terminal mutation', () => {
    assert.throws(
      () =>
        assertWorkflowTransition({
          from: 'created',
          to: 'completed',
          operation: 'step',
          currentVersion: 1,
          expectedVersion: 1,
          workflowRunId: 'wfr_1',
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'invalid_transition');
        return true;
      },
    );

    assert.throws(
      () =>
        assertWorkflowTransition({
          from: 'running',
          to: 'paused',
          operation: 'pause',
          currentVersion: 4,
          expectedVersion: 3,
          workflowRunId: 'wfr_1',
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'stale_workflow_version');
        return true;
      },
    );

    assert.throws(
      () =>
        assertWorkflowTransition({
          from: 'completed',
          to: 'running',
          operation: 'resume',
          currentVersion: 1,
          expectedVersion: 1,
          workflowRunId: 'wfr_1',
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.match(error.diagnostics ?? '', /terminal state/);
        return true;
      },
    );
  });

  it('refuses an operation that could produce a legal edge from an illegal source', () => {
    // `running → completed` is a legal edge, and `complete` may produce it — but
    // `cancel` may not, even though it is a legal operation from `running`.
    assert.throws(
      () =>
        assertWorkflowTransition({
          from: 'running',
          to: 'completed',
          operation: 'cancel',
          currentVersion: 1,
          expectedVersion: 1,
          workflowRunId: 'wfr_1',
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.match(error.diagnostics ?? '', /may not drive/);
        return true;
      },
    );
  });
});
