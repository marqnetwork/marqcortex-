/**
 * Parallel branches and joins (AI-01 Batch 3B, Part 4).
 *
 * The same two-layer split Part 3 used, for the same reason.
 *
 *   UNIT, against `joinPolicy.ts` and `branchScheduler.ts` directly. Every join
 *   policy against every branch tally, every failure policy, and every refusal
 *   the scheduler makes — a stale branch version, a duplicate completion, a
 *   second group for one node, a join closed twice. These are decisions, so they
 *   are tested as decisions, with no run in the way and nothing to be flaky.
 *
 *   INTEGRATION, against the real engine over the real Batch 3A agent runtime
 *   over the real control plane. That a fan-out actually creates several child
 *   agent runs, that a join actually fires once, that a cancelled branch's child
 *   is actually stopped, and that a second isolate resumes a fan-out rather than
 *   starting one.
 *
 * The unit half proves the policy; the integration half proves the engine obeys
 * it. Neither on its own would.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyBranchOutcome,
  applyBranchProgress,
  closeGroup,
  openGroupOf,
  openParallelGroup,
  upsertGroup,
} from '../workflows/engine/branchScheduler.ts';
import {
  decideJoin,
  joinSatisfied,
  joinUnsatisfiable,
  mergeBranchOutputs,
  tallyBranches,
} from '../workflows/runtime/joinPolicy.ts';
import {
  WORKFLOW_PARALLEL_BOUNDS,
  workflowBranchIdFor,
  workflowParallelGroupIdFor,
} from '../workflows/contracts/parallel.ts';
import type {
  WorkflowBranchRecord,
  WorkflowBranchState,
  WorkflowJoinPolicy,
  WorkflowParallelFailurePolicy,
  WorkflowParallelGroup,
} from '../workflows/contracts/parallel.ts';
import type { WorkflowParallelPlanStep } from '../workflows/contracts/plan.ts';
import type { WorkflowNode } from '../workflows/contracts/workflow.ts';
import { isJoinStep, isParallelStep } from '../workflows/contracts/plan.ts';
import { verifyChain } from '../workflows/runtime/checkpointChain.ts';
import { planWorkflow } from '../workflows/planner/workflowPlanner.ts';
import { validateWorkflowDefinition } from '../workflows/validation/workflowValidation.ts';
import { isWorkflowError } from '../workflows/contracts/failures.ts';
import type { WorkflowAgentPort } from '../workflows/engine/agentNodePort.ts';
import {
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from '../workflows/persistence/ports.ts';
import {
  createMemoryAgentRunStore,
  createMemoryApprovalStore,
  createMemoryCheckpointStore,
} from '../agents/persistence/ports.ts';
import { AGENT_TOKEN } from './agentFixtures.ts';
import {
  PART4,
  WF_AGENT,
  branchEdge,
  branchNode,
  buildPart4Runtime,
  edge,
  joinNode,
  mergeShape,
  node,
  parallelNode,
  wideParallelWorkflow,
} from './workflowFixtures.ts';

const TOPIC = { topic: 'quarterly readiness' };
const RUN_ID = 'wfr_test1';

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

// ── Group builders for the unit half ────────────────────────────────────────

function branch(
  name: string,
  ordinal: number,
  state: WorkflowBranchState,
  overrides: Partial<WorkflowBranchRecord> = {},
): WorkflowBranchRecord {
  return {
    branchId: workflowBranchIdFor(RUN_ID, 'fan', name),
    branchName: name,
    parallelNodeId: 'fan',
    ordinal,
    state,
    outputs: {},
    nodeVisits: {},
    childAgentRunIds: [],
    stepCount: 0,
    branchVersion: 1,
    tokensPlaceholder: 0,
    costMicroUsdPlaceholder: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function group(
  branches: readonly WorkflowBranchRecord[],
  policy: WorkflowJoinPolicy,
  failurePolicy: WorkflowParallelFailurePolicy = 'wait_all',
  overrides: Partial<WorkflowParallelGroup> = {},
): WorkflowParallelGroup {
  return {
    groupId: workflowParallelGroupIdFor(RUN_ID, 'fan'),
    parallelNodeId: 'fan',
    joinNodeId: 'gate',
    joinPolicy: policy,
    failurePolicy,
    branches,
    state: 'open',
    startedAt: '2026-01-01T00:00:00.000Z',
    groupVersion: 1,
    ...overrides,
  };
}

function planStep(branchNames: readonly string[]): WorkflowParallelPlanStep {
  return {
    index: 0,
    nodeId: 'fan',
    displayName: 'Fan out',
    depth: 0,
    terminal: false,
    kind: 'parallel',
    branches: branchNames.map((branchName, ordinal) => ({
      branchName,
      startNodeId: `${branchName}_step`,
      ordinal,
      bodyNodeIds: [`${branchName}_step`],
    })),
    joinNodeId: 'gate',
    joinPolicy: { kind: 'all' },
    failurePolicy: 'wait_all',
    maximumParallelBranches: WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches,
  };
}

// ── Deterministic identity ──────────────────────────────────────────────────

describe('deterministic branch identity', () => {
  it('derives a branch id from durable facts and nothing else', () => {
    // No clock, no counter, no random source: the SAME three inputs always
    // produce the same id, which is what lets a recovered isolate ask "have I
    // already started this branch?" of durable state alone.
    const first = workflowBranchIdFor(RUN_ID, 'fan', 'left');
    const second = workflowBranchIdFor(RUN_ID, 'fan', 'left');
    assert.equal(first, second);
    assert.equal(first, 'wfb:wfr_test1:fan:left');
  });

  it('cannot collide across nodes or branch names', () => {
    // `_` is legal inside both a node id and a branch name, so a `_` separator
    // would make (a_b, c) and (a, b_c) the same id. `:` is in neither grammar.
    const ids = new Set([
      workflowBranchIdFor(RUN_ID, 'a_b', 'c'),
      workflowBranchIdFor(RUN_ID, 'a', 'b_c'),
      workflowBranchIdFor('wfr_test2', 'a_b', 'c'),
    ]);
    assert.equal(ids.size, 3);
  });

  it('gives a group one id per run and parallel node', () => {
    assert.equal(workflowParallelGroupIdFor(RUN_ID, 'fan'), 'wfg:wfr_test1:fan');
    assert.notEqual(
      workflowParallelGroupIdFor(RUN_ID, 'fan'),
      workflowParallelGroupIdFor(RUN_ID, 'fan2'),
    );
  });
});

// ── Join policy ─────────────────────────────────────────────────────────────

describe('join policy — satisfaction', () => {
  const all: WorkflowJoinPolicy = { kind: 'all' };
  const any: WorkflowJoinPolicy = { kind: 'any' };
  const min2: WorkflowJoinPolicy = { kind: 'minimum_successes', minimum: 2 };
  const named: WorkflowJoinPolicy = {
    kind: 'named_required_branches',
    required: ['left', 'right'],
  };

  const three = (a: WorkflowBranchState, b: WorkflowBranchState, c: WorkflowBranchState) => [
    branch('left', 0, a),
    branch('right', 1, b),
    branch('extra', 2, c),
  ];

  it('all requires every branch to have COMPLETED, not merely settled', () => {
    assert.equal(joinSatisfied(all, three('completed', 'completed', 'completed')), true);
    assert.equal(joinSatisfied(all, three('completed', 'completed', 'running')), false);
    // A cancelled branch is an outcome, not an exemption. A join that read
    // "we stopped it" as "it succeeded" would report a workflow that did not do
    // all of its work as one that did.
    assert.equal(joinSatisfied(all, three('completed', 'completed', 'cancelled')), false);
    assert.equal(joinSatisfied(all, three('completed', 'completed', 'failed')), false);
  });

  it('any needs exactly one completion', () => {
    assert.equal(joinSatisfied(any, three('running', 'running', 'running')), false);
    assert.equal(joinSatisfied(any, three('failed', 'completed', 'running')), true);
  });

  it('minimum_successes counts completions and nothing else', () => {
    assert.equal(joinSatisfied(min2, three('completed', 'failed', 'running')), false);
    assert.equal(joinSatisfied(min2, three('completed', 'completed', 'failed')), true);
    assert.equal(joinSatisfied(min2, three('completed', 'cancelled', 'cancelled')), false);
  });

  it('named_required_branches asks WHICH, not how many', () => {
    // Three completions do not satisfy it if one of the two named is missing —
    // the distinction `minimum_successes` cannot express.
    assert.equal(joinSatisfied(named, three('completed', 'failed', 'completed')), false);
    assert.equal(joinSatisfied(named, three('completed', 'completed', 'failed')), true);
  });

  it('answers unsatisfiability optimistically about branches still in flight', () => {
    assert.equal(joinUnsatisfiable(all, three('completed', 'running', 'running')), false);
    assert.equal(joinUnsatisfiable(all, three('failed', 'running', 'running')), true);

    assert.equal(joinUnsatisfiable(any, three('failed', 'failed', 'running')), false);
    assert.equal(joinUnsatisfiable(any, three('failed', 'failed', 'failed')), true);

    // Two failures leave one branch and a minimum of two: arithmetic, not
    // pessimism. Waiting for the last branch would spend an agent run on an
    // outcome that is already decided.
    assert.equal(joinUnsatisfiable(min2, three('failed', 'running', 'running')), false);
    assert.equal(joinUnsatisfiable(min2, three('failed', 'failed', 'running')), true);

    assert.equal(joinUnsatisfiable(named, three('running', 'running', 'failed')), false);
    assert.equal(joinUnsatisfiable(named, three('failed', 'running', 'running')), true);
  });

  it('tallies branches in ordinal order whatever order they are stored in', () => {
    const scrambled = [
      branch('extra', 2, 'completed'),
      branch('left', 0, 'completed'),
      branch('right', 1, 'completed'),
    ];
    assert.deepEqual(
      tallyBranches(scrambled).completed.map((entry) => entry.branchName),
      ['left', 'right', 'extra'],
    );
  });
});

describe('join policy — the decision', () => {
  it('fail_fast ends the group on the first failure and cancels the rest', () => {
    const decision = decideJoin(
      group(
        [branch('left', 0, 'failed'), branch('right', 1, 'running')],
        { kind: 'all' },
        'fail_fast',
      ),
    );
    assert.equal(decision.kind, 'fail');
    assert.ok(decision.kind === 'fail');
    assert.equal(decision.failure, 'workflow_branch_failed');
    assert.deepEqual(decision.cancelBranchIds, [workflowBranchIdFor(RUN_ID, 'fan', 'right')]);
  });

  it('fail_fast beats an already-satisfied join, which is what "fast" means', () => {
    // `any` is satisfied by `left`. Under fail_fast the failure still wins,
    // because the failure policy is applied BEFORE the join policy — reversed,
    // "fail fast" would mean "fail fast unless we were nearly done".
    const decision = decideJoin(
      group(
        [branch('left', 0, 'completed'), branch('right', 1, 'failed')],
        { kind: 'any' },
        'fail_fast',
      ),
    );
    assert.equal(decision.kind, 'fail');
  });

  it('wait_all refuses to fire early even when the join is satisfied', () => {
    const decision = decideJoin(
      group(
        [branch('left', 0, 'completed'), branch('right', 1, 'running')],
        { kind: 'any' },
        'wait_all',
      ),
    );
    assert.deepEqual(decision, { kind: 'wait' });
  });

  it('wait_all refuses to fail early too, and decides once everything settled', () => {
    const waiting = decideJoin(
      group(
        [branch('left', 0, 'failed'), branch('right', 1, 'running')],
        { kind: 'minimum_successes', minimum: 1 },
        'wait_all',
      ),
    );
    assert.deepEqual(waiting, { kind: 'wait' });

    const settled = decideJoin(
      group(
        [branch('left', 0, 'failed'), branch('right', 1, 'completed')],
        { kind: 'minimum_successes', minimum: 1 },
        'wait_all',
      ),
    );
    assert.equal(settled.kind, 'join');
    assert.ok(settled.kind === 'join');
    assert.deepEqual(settled.cancelBranchIds, [], 'wait_all cancels nothing — everything settled');
  });

  it('wait_all fails when everything settled and the policy was not met', () => {
    const decision = decideJoin(
      group(
        [branch('left', 0, 'failed'), branch('right', 1, 'failed')],
        { kind: 'minimum_successes', minimum: 1 },
        'wait_all',
      ),
    );
    assert.equal(decision.kind, 'fail');
    assert.ok(decision.kind === 'fail');
    assert.equal(decision.failure, 'workflow_join_unsatisfied');
  });

  it('minimum_successes waits while the join is still reachable', () => {
    assert.deepEqual(
      decideJoin(
        group(
          [branch('left', 0, 'failed'), branch('right', 1, 'pending')],
          { kind: 'minimum_successes', minimum: 1 },
          'minimum_successes',
        ),
      ),
      { kind: 'wait' },
    );
  });

  it('minimum_successes gives up the moment the arithmetic says it must', () => {
    const decision = decideJoin(
      group(
        [
          branch('left', 0, 'failed'),
          branch('right', 1, 'failed'),
          branch('extra', 2, 'running'),
        ],
        { kind: 'minimum_successes', minimum: 2 },
        'minimum_successes',
      ),
    );
    assert.equal(decision.kind, 'fail');
    assert.ok(decision.kind === 'fail');
    assert.equal(decision.failure, 'workflow_join_unsatisfied');
    assert.deepEqual(decision.cancelBranchIds, [workflowBranchIdFor(RUN_ID, 'fan', 'extra')]);
  });

  it('fires early and cancels the stragglers when not waiting for all', () => {
    const decision = decideJoin(
      group(
        [branch('left', 0, 'completed'), branch('right', 1, 'running')],
        { kind: 'any' },
        'minimum_successes',
      ),
    );
    assert.equal(decision.kind, 'join');
    assert.ok(decision.kind === 'join');
    assert.deepEqual(decision.cancelBranchIds, [workflowBranchIdFor(RUN_ID, 'fan', 'right')]);
  });

  it('REFUSES TO DECIDE A GROUP THAT HAS ALREADY JOINED', () => {
    // The once-only guarantee, read from durable state. Both the closed state
    // and the timestamp are checked, because either alone would be a field
    // somebody could set without the other.
    const joined = group([branch('left', 0, 'completed')], { kind: 'any' }, 'wait_all', {
      state: 'joined',
      joinedAt: '2026-01-01T00:01:00.000Z',
    });
    assert.deepEqual(decideJoin(joined), { kind: 'already_joined' });

    const closedWithoutStamp = group([branch('left', 0, 'completed')], { kind: 'any' }, 'wait_all', {
      state: 'failed',
    });
    assert.deepEqual(decideJoin(closedWithoutStamp), { kind: 'already_joined' });
  });
});

// ── The merge ───────────────────────────────────────────────────────────────

describe('the merge', () => {
  const completedWith = (name: string, ordinal: number, value: unknown) =>
    branch(name, ordinal, 'completed', {
      contributionNodeId: `${name}_step`,
      outputs: { [`${name}_step`]: value },
    });

  it('MERGES IN DECLARED ORDER, NOT COMPLETION ORDER', () => {
    // The branches are stored scrambled on purpose. A merge that read the array
    // as it found it would produce a different value on two runs of the same
    // workflow over the same data.
    const merged = mergeBranchOutputs(
      group(
        [
          completedWith('gamma', 2, { finding: 'c' }),
          completedWith('alpha', 0, { finding: 'a' }),
          completedWith('beta', 1, { finding: 'b' }),
        ],
        { kind: 'all' },
      ),
    );
    assert.deepEqual(Object.keys(merged.branches), ['alpha', 'beta', 'gamma']);
    assert.deepEqual(merged.completedBranches, ['alpha', 'beta', 'gamma']);
  });

  it('names failed and cancelled branches without contributing a value for them', () => {
    const merged = mergeBranchOutputs(
      group(
        [
          completedWith('alpha', 0, { finding: 'a' }),
          branch('beta', 1, 'failed'),
          branch('gamma', 2, 'cancelled'),
        ],
        { kind: 'any' },
      ),
    );
    assert.deepEqual(Object.keys(merged.branches), ['alpha']);
    assert.deepEqual(merged.failedBranches, ['beta']);
    assert.deepEqual(merged.cancelledBranches, ['gamma']);
  });

  it('contributes nothing for a branch whose last node stored no trusted output', () => {
    // "Trusted" means "passed a declared output contract". A branch whose final
    // node declared none stored nothing trusted, so the merge has nothing to
    // promote — and the merge contract decides whether that is acceptable.
    const merged = mergeBranchOutputs(
      group(
        [completedWith('alpha', 0, { finding: 'a' }), branch('beta', 1, 'completed')],
        { kind: 'all' },
      ),
    );
    assert.deepEqual(Object.keys(merged.branches), ['alpha']);
    assert.deepEqual(merged.completedBranches, ['alpha', 'beta']);
  });
});

// ── Branch bookkeeping ──────────────────────────────────────────────────────

describe('branch scheduler — bounded fan-out', () => {
  it('creates every branch up front, durably, and starts none of them', () => {
    const opened = openParallelGroup({
      workflowRunId: RUN_ID,
      step: planStep(['left', 'right']),
      existingGroups: [],
      at: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(opened.branches.length, 2);
    assert.deepEqual(
      opened.branches.map((entry) => entry.state),
      ['pending', 'pending'],
    );
    assert.deepEqual(
      opened.branches.map((entry) => entry.cursorNodeId),
      ['left_step', 'right_step'],
    );
    assert.deepEqual(
      opened.branches.map((entry) => entry.branchId),
      [workflowBranchIdFor(RUN_ID, 'fan', 'left'), workflowBranchIdFor(RUN_ID, 'fan', 'right')],
    );
  });

  it('carries token and cost placeholders that are always zero in this part', () => {
    const opened = openParallelGroup({
      workflowRunId: RUN_ID,
      step: planStep(['left', 'right']),
      existingGroups: [],
      at: '2026-01-01T00:00:00.000Z',
    });
    for (const entry of opened.branches) {
      assert.equal(entry.tokensPlaceholder, 0);
      assert.equal(entry.costMicroUsdPlaceholder, 0);
    }
  });

  it('REFUSES A FAN-OUT ABOVE THE CEILING, even from a plan that declares one', () => {
    const names = Array.from(
      { length: WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches + 1 },
      (_, index) => `b${index}`,
    );
    assert.throws(
      () =>
        openParallelGroup({
          workflowRunId: RUN_ID,
          step: planStep(names),
          existingGroups: [],
          at: '2026-01-01T00:00:00.000Z',
        }),
      (error: unknown) => failureOf(error) === 'workflow_branch_limit_exceeded',
    );
  });

  it('honours a ceiling the plan step narrowed', () => {
    assert.throws(
      () =>
        openParallelGroup({
          workflowRunId: RUN_ID,
          step: { ...planStep(['a', 'b', 'c']), maximumParallelBranches: 2 },
          existingGroups: [],
          at: '2026-01-01T00:00:00.000Z',
        }),
      (error: unknown) => failureOf(error) === 'workflow_branch_limit_exceeded',
    );
  });

  it('REFUSES A SECOND GROUP FOR A NODE THAT ALREADY HAS ONE', () => {
    // Duplicate branch EXECUTION. A retried advance, a second isolate and a
    // re-entered node all land here, and all three must be told no rather than
    // handed a fresh set of branches while the first set is still running.
    const first = openParallelGroup({
      workflowRunId: RUN_ID,
      step: planStep(['left', 'right']),
      existingGroups: [],
      at: '2026-01-01T00:00:00.000Z',
    });
    assert.throws(
      () =>
        openParallelGroup({
          workflowRunId: RUN_ID,
          step: planStep(['left', 'right']),
          existingGroups: [first],
          at: '2026-01-01T00:00:01.000Z',
        }),
      (error: unknown) => failureOf(error) === 'workflow_branch_conflict',
    );
  });

  it('bounds how many parallel steps one run may hold', () => {
    const existing = Array.from({ length: WORKFLOW_PARALLEL_BOUNDS.maxGroupsPerRun }, (_, index) =>
      openParallelGroup({
        workflowRunId: RUN_ID,
        step: { ...planStep(['left', 'right']), nodeId: `fan${index}` },
        existingGroups: [],
        at: '2026-01-01T00:00:00.000Z',
      }),
    );
    assert.throws(
      () =>
        openParallelGroup({
          workflowRunId: RUN_ID,
          step: { ...planStep(['left', 'right']), nodeId: 'fan_extra' },
          existingGroups: existing,
          at: '2026-01-01T00:00:00.000Z',
        }),
      (error: unknown) => failureOf(error) === 'workflow_branch_limit_exceeded',
    );
  });
});

describe('branch scheduler — concurrency and duplication', () => {
  const twoBranches = () =>
    group([branch('left', 0, 'running'), branch('right', 1, 'pending')], { kind: 'all' });

  it('REFUSES A STALE BRANCH WRITE', () => {
    const open = twoBranches();
    const stored = open.branches[0];
    // A writer that read version 1, was overtaken, and now tries to apply its
    // update against a branch that has moved to version 2.
    const moved = applyBranchProgress(
      open,
      { ...stored, branchVersion: 2, cursorNodeId: 'left_two' },
      1,
    );
    assert.throws(
      () =>
        applyBranchProgress(
          moved,
          { ...stored, branchVersion: 2, cursorNodeId: 'somewhere_else' },
          1,
        ),
      (error: unknown) => failureOf(error) === 'stale_workflow_branch',
    );
  });

  it('refuses an update that does not increment the branch version', () => {
    const open = twoBranches();
    assert.throws(
      () => applyBranchProgress(open, { ...open.branches[0], cursorNodeId: 'x' }, 1),
      (error: unknown) => failureOf(error) === 'stale_workflow_branch',
    );
  });

  it('KEEPS TWO CONCURRENT BRANCH UPDATES INDEPENDENT', () => {
    // Two sweeps advancing DIFFERENT branches both hold a valid view of the
    // group. Each write asserts its own branch's version, so neither is refused
    // and neither overwrites the other's branch.
    const open = twoBranches();
    const afterLeft = applyBranchProgress(
      open,
      { ...open.branches[0], branchVersion: 2, cursorNodeId: 'left_two' },
      1,
    );
    const afterBoth = applyBranchProgress(
      afterLeft,
      { ...afterLeft.branches[1], branchVersion: 2, state: 'running', cursorNodeId: 'right_two' },
      1,
    );
    assert.deepEqual(
      afterBoth.branches.map((entry) => entry.cursorNodeId),
      ['left_two', 'right_two'],
    );
    assert.equal(afterBoth.groupVersion, 3, 'the group version moved once per write');
  });

  it('refuses progress written to a branch that has already settled', () => {
    const settled = applyBranchOutcome(
      twoBranches(),
      workflowBranchIdFor(RUN_ID, 'fan', 'left'),
      { state: 'completed', at: '2026-01-01T00:01:00.000Z' },
      1,
    ).group;
    assert.throws(
      () =>
        applyBranchProgress(
          settled,
          { ...settled.branches[0], state: 'running', branchVersion: 3, cursorNodeId: 'x' },
          2,
        ),
      (error: unknown) => failureOf(error) === 'workflow_branch_conflict',
    );
  });

  it('IGNORES A DUPLICATE BRANCH COMPLETION, byte for byte', () => {
    // Two isolates both observing one child agent run finish is an ordinary
    // race. Applying the second would mean the join merges whichever duplicate
    // arrived last — for a branch observed as completed and then as cancelled,
    // a different merged value for the same execution.
    const first = applyBranchOutcome(
      twoBranches(),
      workflowBranchIdFor(RUN_ID, 'fan', 'left'),
      { state: 'completed', at: '2026-01-01T00:01:00.000Z', contributionNodeId: 'left_step' },
      1,
    );
    assert.equal(first.applied, true);

    const second = applyBranchOutcome(
      first.group,
      workflowBranchIdFor(RUN_ID, 'fan', 'left'),
      { state: 'cancelled', at: '2026-01-01T00:02:00.000Z' },
      2,
    );
    assert.equal(second.applied, false);
    assert.deepEqual(second.group, first.group, 'the group came back unchanged');
  });

  it('refuses an outcome for a branch that is not in the group', () => {
    assert.throws(
      () =>
        applyBranchOutcome(
          twoBranches(),
          'wfb:wfr_test1:fan:nowhere',
          { state: 'completed', at: '2026-01-01T00:01:00.000Z' },
          1,
        ),
      (error: unknown) => failureOf(error) === 'workflow_branch_conflict',
    );
  });

  it('REFUSES TO CLOSE A GROUP TWICE — the join fires once', () => {
    const closed = closeGroup(twoBranches(), {
      state: 'joined',
      at: '2026-01-01T00:01:00.000Z',
      joinDigest: 'abc',
    });
    assert.equal(closed.joinedAt, '2026-01-01T00:01:00.000Z');
    assert.throws(
      () => closeGroup(closed, { state: 'joined', at: '2026-01-01T00:02:00.000Z' }),
      (error: unknown) => failureOf(error) === 'workflow_branch_conflict',
    );
  });

  it('replaces a group in place rather than appending a second copy', () => {
    const open = twoBranches();
    const closed = closeGroup(open, { state: 'cancelled', at: '2026-01-01T00:01:00.000Z' });
    assert.equal(upsertGroup([open], closed).length, 1);
    assert.equal(openGroupOf(upsertGroup([open], closed)), undefined);
  });
});

// ── Validation and planning ─────────────────────────────────────────────────

describe('parallel validation', () => {
  const problems = (definition: Parameters<typeof validateWorkflowDefinition>[0]) =>
    validateWorkflowDefinition(definition);
  const matches = (found: readonly string[], pattern: RegExp) =>
    found.some((problem) => pattern.test(problem));

  it('accepts a fan-out at the ceiling and REFUSES one above it', () => {
    assert.deepEqual(
      problems(wideParallelWorkflow(WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches)),
      [],
    );
    assert.ok(
      matches(
        problems(wideParallelWorkflow(WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches + 1)),
        /above the effective ceiling/,
      ),
    );
  });

  it('lets a workflow narrow the ceiling and never widen it', () => {
    assert.ok(
      matches(
        problems(wideParallelWorkflow(3, { maximumParallelBranches: 2 })),
        /above the effective ceiling of 2/,
      ),
    );
    assert.ok(
      matches(
        problems(wideParallelWorkflow(3, { maximumParallelBranches: 64 })),
        /maximumParallelBranches must be between/,
      ),
    );
  });

  it('refuses a single-branch fan-out, which is a plain edge in disguise', () => {
    assert.ok(matches(problems(wideParallelWorkflow(1)), /a parallel node needs at least 2/));
  });

  it('refuses a join no parallel node names', () => {
    const orphaned = {
      ...PART4.allJoin,
      nodes: [...PART4.allJoin.nodes, joinNode('spare', { kind: 'all' })],
      edges: [...PART4.allJoin.edges, edge('gate', 'spare')],
    };
    assert.ok(
      matches(problems(orphaned), /a join node must be named by exactly one parallel node/),
    );
  });

  it('refuses a node shared between two branches', () => {
    const shared = {
      ...PART4.allJoin,
      nodes: [
        parallelNode('fan', [['left', 'shared'], ['right', 'shared']], 'gate', 'wait_all'),
        branchNode('shared', WF_AGENT.alpha),
        joinNode('gate', { kind: 'all' }),
      ],
      edges: [
        branchEdge('fan', 'shared', 'left'),
        branchEdge('fan', 'shared', 'right'),
        edge('shared', 'gate'),
      ],
    };
    assert.ok(matches(problems(shared), /already owned by branch|duplicate edge/));
  });

  it('refuses a branch body entered from outside the group', () => {
    const leaky = {
      ...PART4.allJoin,
      nodes: [
        node({ nodeId: 'intro', agentId: WF_AGENT.alpha }),
        parallelNode(
          'fan',
          [
            ['left', 'left_step'],
            ['right', 'right_step'],
          ],
          'gate',
          'wait_all',
        ),
        branchNode('left_step', WF_AGENT.alpha),
        branchNode('right_step', WF_AGENT.beta),
        joinNode('gate', { kind: 'all' }),
      ],
      edges: [
        edge('intro', 'left_step'),
        branchEdge('fan', 'left_step', 'left'),
        branchEdge('fan', 'right_step', 'right'),
        edge('left_step', 'gate'),
        edge('right_step', 'gate'),
      ],
      startNodeId: 'intro',
    };
    assert.ok(
      matches(problems(leaky), /is entered from intro, which is outside the branch/),
    );
  });

  it('refuses a branch that can end anywhere but the join', () => {
    const dangling = {
      ...PART4.allJoin,
      edges: PART4.allJoin.edges.filter(
        (candidate) => !(candidate.from === 'right_step' && candidate.to === 'gate'),
      ),
    };
    assert.ok(matches(problems(dangling), /has no successor — every path in a branch must reach/));
  });

  it('REFUSES A JOIN WITH NO MERGE CONTRACT', () => {
    // The cast is the point being made twice: the TYPE already forbids a join
    // with no merge contract, and validation refuses it as well — because a
    // definition can arrive from a JavaScript caller the compiler never saw.
    const unschemad = {
      ...PART4.allJoin,
      nodes: PART4.allJoin.nodes.map((candidate) =>
        candidate.nodeId === 'gate'
          ? ({ ...candidate, mergeContract: undefined } as unknown as WorkflowNode)
          : candidate,
      ),
    };
    assert.ok(matches(problems(unschemad), /mergeContract must be a validator/));
  });

  it('refuses a named_required_branches policy naming a branch nothing declares', () => {
    const renamed = {
      ...PART4.allJoin,
      nodes: PART4.allJoin.nodes.map((candidate) =>
        candidate.nodeId === 'gate'
          ? joinNode('gate', { kind: 'named_required_branches', required: ['middle'] })
          : candidate,
      ),
    };
    assert.ok(matches(problems(renamed), /requires branch middle, which fan does not declare/));
  });

  it('refuses a minimum nothing could ever reach', () => {
    const impossible = {
      ...PART4.allJoin,
      nodes: PART4.allJoin.nodes.map((candidate) =>
        candidate.nodeId === 'gate'
          ? joinNode('gate', { kind: 'minimum_successes', minimum: 5 })
          : candidate,
      ),
    };
    assert.ok(matches(problems(impossible), /declares only 2 branches, so the join can never fire/));
  });

  it('refuses nested parallelism', () => {
    const nested = {
      ...PART4.allJoin,
      nodes: [
        parallelNode(
          'fan',
          [
            ['left', 'inner_fan'],
            ['right', 'right_step'],
          ],
          'gate',
          'wait_all',
        ),
        parallelNode(
          'inner_fan',
          [
            ['a', 'a_step'],
            ['b', 'b_step'],
          ],
          'inner_gate',
          'wait_all',
        ),
        branchNode('a_step', WF_AGENT.alpha),
        branchNode('b_step', WF_AGENT.beta),
        joinNode('inner_gate', { kind: 'all' }),
        branchNode('right_step', WF_AGENT.beta),
        joinNode('gate', { kind: 'all' }),
      ],
      edges: [
        branchEdge('fan', 'inner_fan', 'left'),
        branchEdge('fan', 'right_step', 'right'),
        branchEdge('inner_fan', 'a_step', 'a'),
        branchEdge('inner_fan', 'b_step', 'b'),
        edge('a_step', 'inner_gate'),
        edge('b_step', 'inner_gate'),
        edge('inner_gate', 'gate'),
        edge('right_step', 'gate'),
      ],
    };
    assert.ok(matches(problems(nested), /parallelism does not nest in this batch/));
  });
});

describe('parallel planning', () => {
  it('resolves the join policy, the ceiling and every branch body onto the plan', () => {
    const result = planWorkflow(PART4.multiNode);
    assert.ok(result.ok, JSON.stringify(result));

    const fan = result.plan.steps.find(isParallelStep);
    assert.ok(fan);
    assert.equal(fan.joinNodeId, 'gate');
    assert.equal(fan.failurePolicy, 'wait_all');
    assert.deepEqual(fan.joinPolicy, { kind: 'all' });
    assert.equal(fan.maximumParallelBranches, WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches);
    assert.deepEqual(
      fan.branches.map((entry) => [entry.branchName, entry.ordinal, entry.bodyNodeIds]),
      [
        ['left', 0, ['left_one', 'left_two']],
        ['right', 1, ['right_one']],
      ],
    );

    const gate = result.plan.steps.find(isJoinStep);
    assert.ok(gate);
    assert.equal(gate.parallelNodeId, 'fan');
    assert.deepEqual(gate.branchNames, ['left', 'right']);
    assert.equal(gate.nextNodeId, 'after');
  });

  it('counts parallel work in the metadata', () => {
    const result = planWorkflow(PART4.allJoin);
    assert.ok(result.ok);
    assert.equal(result.plan.metadata.parallelNodeCount, 1);
    assert.equal(result.plan.metadata.joinNodeCount, 1);
    assert.equal(result.plan.metadata.maxBranchCount, 2);
  });

  it('MOVES THE DIGEST WHEN BRANCH ORDER MOVES, because merge order is the plan', () => {
    const forward = planWorkflow(PART4.allJoin);
    const reversed = planWorkflow({
      ...PART4.allJoin,
      nodes: PART4.allJoin.nodes.map((candidate) =>
        candidate.nodeId === 'fan'
          ? parallelNode(
              'fan',
              [
                ['right', 'right_step'],
                ['left', 'left_step'],
              ],
              'gate',
              'wait_all',
            )
          : candidate,
      ),
    });
    assert.ok(forward.ok && reversed.ok);
    assert.notEqual(forward.plan.digest, reversed.plan.digest);
  });

  it('does not move the digest when the EDGE order moves', () => {
    // A plan digest is about the fan-out that was reviewed, and the branch list
    // is what a reviewer read. Reordering the edge array changes nothing about
    // what runs, so it must change nothing about the digest.
    const forward = planWorkflow(PART4.allJoin);
    const shuffled = planWorkflow({
      ...PART4.allJoin,
      edges: [...PART4.allJoin.edges].reverse(),
    });
    assert.ok(forward.ok && shuffled.ok);
    assert.equal(forward.plan.digest, shuffled.plan.digest);
  });

  it('refuses a parallel node inside a loop body', () => {
    const looped = planWorkflow({
      ...PART4.multiNode,
      nodes: [
        ...PART4.multiNode.nodes,
        {
          kind: 'condition' as const,
          nodeId: 'again',
          displayName: 'Again?',
          expression: {
            op: 'greater_than_or_equal' as const,
            left: { source: 'counter' as const, counter: 'node_visits' as const, nodeId: 'after' },
            right: { source: 'literal' as const, value: 2 },
          },
        },
        { ...node({ nodeId: 'done', agentId: WF_AGENT.beta }) },
      ],
      edges: [
        ...PART4.multiNode.edges,
        edge('after', 'again'),
        { from: 'again', to: 'done', when: true },
        { from: 'again', to: 'fan', when: false, loop: { maxIterations: 2 } },
      ],
    });
    assert.ok(!result_ok(looped));
    assert.ok(
      looped.ok === false &&
        looped.problems.some((problem) => /may not be re-entered/.test(problem)),
      JSON.stringify(looped),
    );
  });
});

function result_ok(result: ReturnType<typeof planWorkflow>): boolean {
  return result.ok;
}

// ── Integration: the engine ─────────────────────────────────────────────────

describe('parallel execution — join policies', () => {
  it('ALL: both branches run, both complete, the join merges both', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.allJoin.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(detail.parallelGroups.length, 1);

    const group_ = detail.parallelGroups[0];
    assert.equal(group_.state, 'joined');
    assert.ok(group_.joinedAt, 'a fired join stamps the group');
    assert.deepEqual(
      group_.branches.map((entry) => [entry.branchName, entry.state]),
      [
        ['left', 'completed'],
        ['right', 'completed'],
      ],
    );

    // Two branches means two child agent runs, driven by the real orchestrator.
    assert.equal(detail.childAgentRunIds.length, 2);
    for (const entry of group_.branches) assert.equal(entry.childAgentRunIds.length, 1);

    const join = detail.steps.find((step) => step.kind === 'join');
    assert.ok(join);
    assert.equal(join.nodeId, 'gate');
    assert.equal(join.mergedBranchCount, 2);
    assert.ok(join.resultDigest);
  });

  it('ANY: the first completion fires the join and cancels the rest', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.anyJoin.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    const [left, right] = detail.parallelGroups[0].branches;
    assert.equal(left.state, 'completed');
    assert.equal(right.state, 'cancelled');

    // The cancelled branch HAD a child — the engine creates every branch's
    // child before driving any of them, which is what makes the fan-out
    // overlap — and that child was stopped rather than driven to a result.
    assert.equal(right.childAgentRunIds.length, 1);
    const abandoned = await harness.agentRuntime.runtime.runs.load(
      'acme',
      right.childAgentRunIds[0],
    );
    assert.equal(abandoned?.state, 'cancelled');
    assert.equal(
      detail.steps.some((step) => step.branchName === 'right'),
      false,
      'a cancelled branch records no completed step',
    );
  });

  it('MINIMUM_SUCCESSES: a failed branch does not end a group that can still be met', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.minimumJoin.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    const [left, right] = detail.parallelGroups[0].branches;
    assert.equal(left.state, 'failed');
    assert.equal(left.failure, 'workflow_branch_failed');
    assert.equal(right.state, 'completed');

    const join = detail.steps.find((step) => step.kind === 'join');
    assert.equal(join?.mergedBranchCount, 1);
  });

  it('NAMED_REQUIRED_BRANCHES: the named branch decides, not the count', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.namedJoin.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    const [left, right] = detail.parallelGroups[0].branches;
    assert.equal(left.state, 'failed', 'an unnamed branch is allowed to fail');
    assert.equal(right.state, 'completed');
  });

  it('NAMED_REQUIRED_BRANCHES: a failed required branch fails the run', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.namedJoinMissing.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_join_unsatisfied');
    assert.equal(detail.parallelGroups[0].state, 'failed');
  });
});

describe('parallel execution — failure policies', () => {
  it('FAIL_FAST: the first branch failure ends the run and cancels the siblings', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.failFast.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_branch_failed');

    const [left, right] = detail.parallelGroups[0].branches;
    assert.equal(left.state, 'failed');
    assert.equal(right.state, 'cancelled');

    // The sibling's child was created and then STOPPED. A cancellation that
    // left it driving would be a cancellation in name only.
    const sibling = await harness.agentRuntime.runtime.runs.load(
      'acme',
      right.childAgentRunIds[0],
    );
    assert.equal(sibling?.state, 'cancelled');

    // A terminal record must not read as though branches are still running.
    assert.equal(detail.parallelGroups[0].state, 'failed');
    assert.equal(detail.currentNodeId, undefined);
  });

  it('WAIT_ALL: a failed branch does not stop its sibling finishing', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.waitAll.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    const [left, right] = detail.parallelGroups[0].branches;
    assert.equal(left.state, 'failed');
    assert.equal(right.state, 'completed');
    assert.equal(right.childAgentRunIds.length, 1, 'the sibling ran to completion');
  });

  it('WAIT_ALL: does not fire an already-satisfied join while a branch is in flight', async () => {
    // `left` completes and the `any` join is satisfied — and `wait_all` still
    // waits, because the branch that is blocked on an approval has work whose
    // effects the policy says must reach a terminal outcome.
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.blockedBranch.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'waiting_for_branches');
    const [left, right] = detail.parallelGroups[0].branches;
    assert.equal(left.state, 'completed');
    assert.equal(right.state, 'waiting_for_agent');
    assert.ok(right.pendingAgentRunId, 'the blocked branch names the child it waits on');
    assert.equal(detail.parallelGroups[0].state, 'open');
    assert.equal(detail.parallelGroups[0].joinedAt, undefined, 'the join has not fired');
  });

  it('does not re-poll a branch parked on a blocked child within one advance', async () => {
    let drives = 0;
    const harness = buildPart4Runtime({
      wrapAgentPort: (port): WorkflowAgentPort => ({
        create: (input) => port.create(input),
        drive(input) {
          drives += 1;
          return port.drive(input);
        },
        cancel: (input) => port.cancel(input),
      }),
    });

    await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.blockedBranch.workflowId,
      input: TOPIC,
    });

    // One drive for the branch that completed, one for the branch that blocked.
    // A loop that re-polled the parked branch would spin here rather than fail,
    // which is exactly why this is asserted as a count.
    assert.equal(drives, 2);
  });
});

describe('parallel execution — merge, cursor and cancellation', () => {
  it('MERGES IN DECLARED ORDER through the whole engine', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.allJoin.workflowId,
      input: TOPIC,
    });
    assert.equal(detail.state, 'completed');

    // The stored merge is read back off the durable checkpoint chain rather
    // than from the read model, because the read model deliberately withholds
    // branch outputs — and the value that later nodes would branch on is the
    // stored one.
    const tip = await harness.checkpointStore.latest('acme', detail.workflowRunId);
    assert.ok(tip);
    const merged = tip.outputs.gate as {
      branches: Record<string, unknown>;
      completedBranches: readonly string[];
    };
    assert.deepEqual(Object.keys(merged.branches), ['left', 'right']);
    assert.deepEqual(merged.completedBranches, ['left', 'right']);
  });

  it('REFUSES A MERGE ITS DECLARED SCHEMA DOES NOT ACCEPT', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.badMerge.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_merge_rejected');
    // Both branches completed. The refusal is the SCHEMA's, not the branches'.
    assert.deepEqual(
      detail.parallelGroups[0].branches.map((entry) => entry.state),
      ['completed', 'completed'],
    );
    // Nothing was promoted: a rejected merge must not leave a join output
    // behind for a later node to read.
    assert.equal(
      detail.steps.some((step) => step.kind === 'join'),
      false,
    );
  });

  it('walks a BRANCH-LOCAL CURSOR across a multi-node branch, then continues past the join', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.multiNode.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');

    const leftSteps = detail.steps.filter((step) => step.branchName === 'left');
    assert.deepEqual(
      leftSteps.map((step) => step.nodeId),
      ['left_one', 'left_two'],
      'the branch cursor moved through its own body, in order',
    );
    assert.equal(detail.parallelGroups[0].branches[0].stepCount, 2);
    assert.equal(detail.parallelGroups[0].branches[1].stepCount, 1);

    // Every branch step is labelled with the branch it belongs to, so one
    // interleaved history answers both "what happened" and "what did `left` do".
    for (const step of leftSteps) {
      assert.equal(step.branchId, `wfb:${detail.workflowRunId}:fan:left`);
    }

    // And the run carried on past the join into the main line.
    assert.equal(detail.steps[detail.steps.length - 1].nodeId, 'after');
  });

  it('contributes nothing for a branch that stored no trusted output', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.silentBranch.workflowId,
      input: TOPIC,
    });
    assert.equal(detail.state, 'completed');

    const tip = await harness.checkpointStore.latest('acme', detail.workflowRunId);
    const merged = tip?.outputs.gate as {
      branches: Record<string, unknown>;
      completedBranches: readonly string[];
    };
    assert.deepEqual(Object.keys(merged.branches), ['left']);
    assert.deepEqual(merged.completedBranches, ['left', 'right']);
  });

  it('CANCELS EVERY IN-FLIGHT BRANCH CHILD when the run is cancelled', async () => {
    const cancelled: string[] = [];
    const harness = buildPart4Runtime({
      wrapAgentPort: (port): WorkflowAgentPort => ({
        create: (input) => port.create(input),
        drive: (input) => port.drive(input),
        cancel(input) {
          cancelled.push(input.agentRunId);
          return port.cancel(input);
        },
      }),
    });

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.blockedBranch.workflowId,
      input: TOPIC,
    });
    assert.equal(detail.state, 'waiting_for_branches');
    const blockedChild = detail.parallelGroups[0].branches[1].pendingAgentRunId;
    assert.ok(blockedChild);

    const stopped = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
      reason: 'The operator changed their mind.',
    });

    assert.equal(stopped.state, 'cancelled');
    assert.deepEqual(cancelled, [blockedChild], 'the branch child was stopped, by id');
    assert.equal(stopped.parallelGroups[0].state, 'cancelled');
    assert.deepEqual(
      stopped.parallelGroups[0].branches.map((entry) => entry.state),
      ['completed', 'cancelled'],
    );

    // The child agent run itself is terminal in the AGENT runtime's own store.
    const child = await harness.agentRuntime.runtime.runs.load('acme', blockedChild);
    assert.equal(child?.state, 'cancelled');
  });
});

// ── Durability ──────────────────────────────────────────────────────────────

describe('parallel durability', () => {
  it('CHAINS A CHECKPOINT ACROSS EVERY PIECE OF PARALLEL WORK', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.multiNode.workflowId,
      input: TOPIC,
    });
    assert.equal(detail.state, 'completed');

    const history = await harness.checkpointStore.history('acme', detail.workflowRunId);
    // Three branch nodes, the join, and the node after it.
    assert.deepEqual(
      history.map((checkpoint) => checkpoint.nodeId),
      ['left_one', 'right_one', 'left_two', 'gate', 'after'],
    );
    assert.deepEqual(verifyChain(history), { ok: true });

    // The chain PROVES the branch outcomes, not merely the node outputs: the
    // summary is inside every digest, so a branch recorded as completed cannot
    // be rewritten as pending without breaking every link after it.
    const atJoin = history[3];
    assert.equal(atJoin.parallel.length, 1);
    assert.equal(atJoin.parallel[0].joined, true);
    assert.deepEqual(
      atJoin.parallel[0].branches.map((entry) => [entry.branchName, entry.state]),
      [
        ['left', 'completed'],
        ['right', 'completed'],
      ],
    );

    // And it is genuinely load-bearing: rewriting a branch state breaks the link.
    const tampered = {
      ...atJoin,
      parallel: [
        {
          ...atJoin.parallel[0],
          branches: atJoin.parallel[0].branches.map((entry) => ({ ...entry, state: 'pending' as const })),
        },
      ],
    };
    const broken = verifyChain([...history.slice(0, 3), tampered, ...history.slice(4)]);
    assert.equal(broken.ok, false);
  });

  it('RESUMES A FAN-OUT IN A SECOND ISOLATE rather than starting one', async () => {
    // Isolate one: the branches are created and the first child is driven, then
    // the port dies. Everything durable is on the shared stores.
    const runStore = createMemoryWorkflowRunStore();
    const checkpointStore = createMemoryWorkflowCheckpointStore();
    const agentRunStore = createMemoryAgentRunStore();
    const agentCheckpointStore = createMemoryCheckpointStore();
    const agentApprovalStore = createMemoryApprovalStore();

    let drives = 0;
    const first = buildPart4Runtime({
      runStore,
      checkpointStore,
      agentRunStore,
      agentCheckpointStore,
      agentApprovalStore,
      wrapAgentPort: (port): WorkflowAgentPort => ({
        create: (input) => port.create(input),
        drive(input) {
          drives += 1;
          if (drives > 1) return Promise.reject(new Error('isolate recycled'));
          return port.drive(input);
        },
        cancel: (input) => port.cancel(input),
      }),
    });

    const created = await first.workflows.service.createRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.allJoin.workflowId,
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
    assert.equal(crashed?.state, 'waiting_for_branches');
    const group_ = crashed?.parallelGroups[0];
    assert.ok(group_, 'the fan-out is durable, not in isolate memory');
    assert.equal(group_.branches[0].state, 'completed', 'the branch that finished stayed finished');
    const strandedChild = group_.branches[1].pendingNode?.agentRunId;
    assert.ok(strandedChild, 'the in-flight branch names the child it was waiting on');

    // Isolate two: a fresh runtime with a working port over the same stores.
    const second = buildPart4Runtime({
      runStore,
      checkpointStore,
      agentRunStore,
      agentCheckpointStore,
      agentApprovalStore,
    });
    const resumed = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });

    assert.equal(resumed.state, 'completed');
    // THE SAME CHILD, not a second one. Two agent runs total for two branches.
    assert.equal(resumed.childAgentRunIds.length, 2);
    assert.ok(resumed.childAgentRunIds.includes(strandedChild));
    assert.deepEqual(
      resumed.parallelGroups[0].branches.map((entry) => entry.childAgentRunIds.length),
      [1, 1],
    );
    assert.equal(resumed.parallelGroups[0].state, 'joined');
  });

  it('REFUSES A SECOND ADVANCE THAT LOST THE VERSION RACE', async () => {
    // Two isolates each read the run, each compute a branch update, each write.
    // One wins on the record's compare-and-swap; the other is refused rather
    // than merged — which for a fan-out would mean two children for one branch.
    const harness = buildPart4Runtime();
    const created = await harness.workflows.service.createRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.blockedBranch.workflowId,
      input: TOPIC,
    });
    const parked = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });
    assert.equal(parked.state, 'waiting_for_branches');

    const error = await rejection(
      harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: created.workflowRunId,
        expectedVersion: parked.runVersion - 1,
      }),
    );
    assert.equal(failureOf(error), 'stale_workflow_version');
  });

  it('resumes a paused fan-out INTO the fan-out, not back onto the parallel node', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.blockedBranch.workflowId,
      input: TOPIC,
    });
    assert.equal(detail.state, 'waiting_for_branches');

    const paused = await harness.workflows.service.pauseRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
      reason: 'Holding while we look at the approval.',
    });
    assert.equal(paused.state, 'paused');

    const resumed = await harness.workflows.service.resumeRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
      reason: 'Carry on.',
    });
    // Returning it to `running` would put the cursor back on `fan`, whose job
    // is to OPEN a group — and opening one that exists is refused, correctly,
    // which would strand the run.
    assert.equal(resumed.state, 'waiting_for_branches');
    assert.equal(resumed.parallelGroups[0].state, 'open');
  });
});

// ── Tenancy and the boundary ────────────────────────────────────────────────

describe('parallel tenancy', () => {
  it('creates every branch child in the RUN\'s organization', async () => {
    const seen: string[] = [];
    const harness = buildPart4Runtime({
      wrapAgentPort: (port): WorkflowAgentPort => ({
        create(input) {
          seen.push(input.organizationId);
          return port.create(input);
        },
        drive: (input) => port.drive(input),
        cancel: (input) => port.cancel(input),
      }),
    });

    await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.allJoin.workflowId,
      input: TOPIC,
    });
    assert.deepEqual(seen, ['acme', 'acme']);
  });

  it('does not expose a fan-out to another tenant', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.allJoin.workflowId,
      input: TOPIC,
    });

    // `otherTenant` is a consultant at globex: fully entitled to workflow runs,
    // and entitled to none of acme's. The refusal is NOT FOUND rather than
    // FORBIDDEN, so the reply cannot be used to probe for another tenant's runs.
    const error = await rejection(
      harness.workflows.service.getRun({
        ...harness.meta(AGENT_TOKEN.otherTenant),
        workflowRunId: detail.workflowRunId,
      }),
    );
    assert.equal(failureOf(error), 'workflow_run_not_found');

    const error2 = await rejection(
      harness.workflows.service.cancelRun({
        ...harness.meta(AGENT_TOKEN.otherTenant),
        workflowRunId: detail.workflowRunId,
        reason: 'Not mine to stop.',
      }),
    );
    assert.equal(failureOf(error2), 'workflow_run_not_found');
  });

  it('withholds branch outputs from every read model', async () => {
    const harness = buildPart4Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.allJoin.workflowId,
      input: TOPIC,
    });

    // A console that echoed branch outputs would be a copy of the tenant's
    // business data, exactly as `input` would be. Digests travel; values do not.
    const serialized = JSON.stringify(detail.parallelGroups);
    assert.equal(serialized.includes('finding'), false, serialized);
    assert.equal(serialized.includes(TOPIC.topic), false);
    for (const entry of detail.parallelGroups[0].branches) {
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'outputs'), false);
    }
  });
});

describe('the parallel engine reaches nothing it may not', () => {
  const sources = [
    'supabase/functions/server/ai/workflows/contracts/parallel.ts',
    'supabase/functions/server/ai/workflows/runtime/joinPolicy.ts',
    'supabase/functions/server/ai/workflows/engine/branchScheduler.ts',
    'supabase/functions/server/ai/workflows/validation/parallelValidation.ts',
  ].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  it('holds no provider, plane, tool or agent orchestrator', () => {
    // The structural claim, asserted on the Part 4 modules specifically. The
    // whole-tree scan in `tests/system/ai_boundary.test.ts` says the same thing
    // about the tree; this says it about the files this part added, so a
    // failure names them.
    const FORBIDDEN =
      /controlPlane\.ts|providers\/|toolRegistry|toolGateway|agentOrchestrator|OPENAI_API_KEY|ANTHROPIC_API_KEY/;
    for (const source of sources) {
      assert.equal(FORBIDDEN.test(source.text), false, source.path);
    }
  });

  it('executes nothing a definition supplied as data', () => {
    const CODE_EXECUTION = /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(\s*['"`]/;
    for (const source of sources) {
      assert.equal(CODE_EXECUTION.test(source.text), false, source.path);
    }
  });

  it('drives an agent only through the port the engine already had', async () => {
    // Behavioural half: every child a fan-out creates arrives through
    // `WorkflowAgentPort.create` and is driven through `drive`. A branch that
    // reached an agent any other way would not appear here.
    const calls: string[] = [];
    const harness = buildPart4Runtime({
      wrapAgentPort: (port): WorkflowAgentPort => ({
        create(input) {
          calls.push(`create:${input.agentId}`);
          return port.create(input);
        },
        drive(input) {
          calls.push('drive');
          return port.drive(input);
        },
        cancel(input) {
          calls.push('cancel');
          return port.cancel(input);
        },
      }),
    });

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART4.allJoin.workflowId,
      input: TOPIC,
    });
    assert.equal(detail.state, 'completed');
    // Both children are created before either is driven — the round-robin
    // sweep is what makes two agent runs genuinely in flight at once.
    assert.deepEqual(calls, [
      `create:${WF_AGENT.alpha}`,
      `create:${WF_AGENT.beta}`,
      'drive',
      'drive',
    ]);
  });

  it('keeps the merge contract the only way a branch output becomes trusted', () => {
    const engine = readFileSync(
      'supabase/functions/server/ai/workflows/engine/workflowOrchestrator.ts',
      'utf8',
    );
    // Exactly one place assigns the join node's output, and it is downstream of
    // `mergeContract.validate`. A second assignment would be a merge that
    // skipped its schema.
    const assignments = engine.match(/data\.outputs\[group\.joinNodeId\]\s*=/g) ?? [];
    assert.equal(assignments.length, 1);
    assert.match(engine, /joinStep\.mergeContract\.validate\(merged, 'merge'\)/);
  });
});

// ── The mergeShape fixture is a real contract, not a rubber stamp ───────────

describe('the merge contract is enforced, not decorative', () => {
  it('rejects a merged value missing a declared field', () => {
    const result = mergeShape.validate({ branches: {} }, 'merge');
    assert.equal(result.ok, false);
  });

  it('accepts the shape the engine actually produces', () => {
    const merged = mergeBranchOutputs(
      group(
        [
          branch('left', 0, 'completed', {
            contributionNodeId: 'left_step',
            outputs: { left_step: { finding: 'a' } },
          }),
          branch('right', 1, 'failed'),
        ],
        { kind: 'any' },
      ),
    );
    assert.equal(mergeShape.validate(merged, 'merge').ok, true);
  });
});
