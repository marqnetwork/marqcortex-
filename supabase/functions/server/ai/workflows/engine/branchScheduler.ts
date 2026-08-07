/**
 * Branch bookkeeping (AI-01 Batch 3B, Part 4).
 *
 * Pure, total functions that build and mutate a `WorkflowParallelGroup`. No
 * clock is read here, no store is touched and no agent is driven — a timestamp
 * arrives as an argument, so every function in this file is a value in and a
 * value out, and every rule it enforces is a rule a test can hit directly
 * without standing up a run.
 *
 * ── THE THREE REFUSALS ─────────────────────────────────────────────────────
 *
 *   BOUNDED FAN-OUT      `openParallelGroup` refuses a branch count above the
 *                        ceiling and refuses to open a second group for a
 *                        parallel node that already has one. The first is why a
 *                        definition cannot spend an unbounded number of agent
 *                        runs; the second is why a retried advance cannot start
 *                        a branch set twice.
 *
 *   STALE BRANCH WRITES  Every branch mutation names the version it read. The
 *                        branch inside the record is versioned SEPARATELY from
 *                        the record itself, because two sweeps that touched
 *                        different branches would both hold a valid `runVersion`
 *                        and would still be about to overwrite one another's
 *                        branch. One version per independently-mutated thing.
 *
 *   TERMINAL IS FINAL    A settled branch takes no further progress and no
 *                        second outcome. Progress against a settled branch is a
 *                        defect and throws; a DUPLICATE OUTCOME is an ordinary
 *                        race — two isolates both saw the child finish — and is
 *                        ignored deterministically, returning the group as it
 *                        already was.
 *
 * The distinction in that last pair is the whole reason `applyBranchProgress`
 * and `applyBranchOutcome` are two functions rather than one with a flag.
 */

import type {
  WorkflowBranchRecord,
  WorkflowBranchState,
  WorkflowParallelGroup,
} from '../contracts/parallel.ts';
import type { WorkflowFailureCode } from '../contracts/failures.ts';
import type { WorkflowParallelPlanStep } from '../contracts/plan.ts';
import {
  WORKFLOW_PARALLEL_BOUNDS,
  isTerminalBranchState,
  workflowBranchIdFor,
  workflowParallelGroupIdFor,
} from '../contracts/parallel.ts';
import { workflowFailure } from '../contracts/failures.ts';

/** The group a run is currently executing, or none. At most one is ever open. */
export function openGroupOf(
  groups: readonly WorkflowParallelGroup[] | undefined,
): WorkflowParallelGroup | undefined {
  return (groups ?? []).find((group) => group.state === 'open');
}

export function findGroup(
  groups: readonly WorkflowParallelGroup[] | undefined,
  groupId: string,
): WorkflowParallelGroup | undefined {
  return (groups ?? []).find((group) => group.groupId === groupId);
}

export function findBranch(
  group: WorkflowParallelGroup,
  branchId: string,
): WorkflowBranchRecord | undefined {
  return group.branches.find((branch) => branch.branchId === branchId);
}

/**
 * Open a group, or refuse.
 *
 * Every branch is created up front, durably, in `pending`. None of them has
 * started — creating them all before any of them runs is what makes the group a
 * complete, recoverable statement of the work rather than a set that grows as
 * the engine gets round to it. A restarted isolate reads the whole fan-out from
 * one record.
 */
export function openParallelGroup(options: {
  readonly workflowRunId: string;
  readonly step: WorkflowParallelPlanStep;
  readonly existingGroups: readonly WorkflowParallelGroup[];
  readonly at: string;
}): WorkflowParallelGroup {
  const { workflowRunId, step, existingGroups, at } = options;
  const groupId = workflowParallelGroupIdFor(workflowRunId, step.nodeId);

  // DUPLICATE BRANCH EXECUTION, REFUSED. A retried advance, a second isolate or
  // a re-entered node all land here, and all three must be told no rather than
  // handed a fresh set of branches while the first set is still running.
  if (findGroup(existingGroups, groupId) !== undefined) {
    throw workflowFailure(
      'workflow_branch_conflict',
      'That parallel step has already started.',
      {
        workflowRunId,
        nodeId: step.nodeId,
        diagnostics: `parallel group ${groupId} already exists on this run`,
      },
    );
  }

  if (existingGroups.length >= WORKFLOW_PARALLEL_BOUNDS.maxGroupsPerRun) {
    throw workflowFailure(
      'workflow_branch_limit_exceeded',
      'This workflow has run more parallel steps than it is allowed to.',
      {
        workflowRunId,
        nodeId: step.nodeId,
        diagnostics:
          `run already holds ${existingGroups.length} parallel groups, ` +
          `at the ceiling of ${WORKFLOW_PARALLEL_BOUNDS.maxGroupsPerRun}`,
      },
    );
  }

  // BOUNDED FAN-OUT, at the runtime as well as at validation. A plan that
  // reached here declaring more branches than the ceiling would be a plan the
  // registry admitted under a different ceiling, and the engine must not spend
  // agent runs on the strength of that.
  const ceiling = Math.min(
    step.maximumParallelBranches,
    WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches,
  );
  if (step.branches.length > ceiling) {
    throw workflowFailure(
      'workflow_branch_limit_exceeded',
      'This workflow asked for more parallel branches than it is allowed.',
      {
        workflowRunId,
        nodeId: step.nodeId,
        diagnostics:
          `node ${step.nodeId} declares ${step.branches.length} branches, ` +
          `above the ceiling of ${ceiling}`,
      },
    );
  }
  if (step.branches.length < WORKFLOW_PARALLEL_BOUNDS.minParallelBranches) {
    throw workflowFailure(
      'workflow_branch_limit_exceeded',
      'This workflow asked for fewer parallel branches than it is allowed.',
      {
        workflowRunId,
        nodeId: step.nodeId,
        diagnostics:
          `node ${step.nodeId} declares ${step.branches.length} branches, ` +
          `below the floor of ${WORKFLOW_PARALLEL_BOUNDS.minParallelBranches}`,
      },
    );
  }

  const branches: WorkflowBranchRecord[] = step.branches.map((declaration) => ({
    branchId: workflowBranchIdFor(workflowRunId, step.nodeId, declaration.branchName),
    branchName: declaration.branchName,
    parallelNodeId: step.nodeId,
    ordinal: declaration.ordinal,
    state: 'pending',
    cursorNodeId: declaration.startNodeId,
    outputs: {},
    nodeVisits: {},
    childAgentRunIds: [],
    stepCount: 0,
    branchVersion: 1,
    startedAt: at,
  }));

  return {
    groupId,
    parallelNodeId: step.nodeId,
    joinNodeId: step.joinNodeId,
    joinPolicy: step.joinPolicy,
    failurePolicy: step.failurePolicy,
    branches,
    state: 'open',
    startedAt: at,
    groupVersion: 1,
  };
}

// ── Branch mutation ─────────────────────────────────────────────────────────

function replaceBranch(
  group: WorkflowParallelGroup,
  updated: WorkflowBranchRecord,
): WorkflowParallelGroup {
  return {
    ...group,
    branches: group.branches
      .map((branch) => (branch.branchId === updated.branchId ? updated : branch))
      // Re-sorted on every write so ordinal order is a property of the stored
      // record rather than of the order updates happened to arrive in.
      .sort((a, b) => a.ordinal - b.ordinal),
    groupVersion: group.groupVersion + 1,
  };
}

function requireBranch(
  group: WorkflowParallelGroup,
  branchId: string,
): WorkflowBranchRecord {
  const stored = findBranch(group, branchId);
  if (!stored) {
    throw workflowFailure('workflow_branch_conflict', 'That branch is not part of this run.', {
      nodeId: group.parallelNodeId,
      diagnostics: `branch ${branchId} is not in group ${group.groupId}`,
    });
  }
  return stored;
}

function assertBranchVersion(
  stored: WorkflowBranchRecord,
  updated: WorkflowBranchRecord,
  expectedBranchVersion: number,
): void {
  if (stored.branchVersion !== expectedBranchVersion) {
    throw workflowFailure(
      'stale_workflow_branch',
      'This branch has changed since it was read.',
      {
        nodeId: stored.parallelNodeId,
        diagnostics:
          `branch ${stored.branchId} expected version ${expectedBranchVersion}, ` +
          `stored ${stored.branchVersion}`,
      },
    );
  }
  if (updated.branchVersion !== expectedBranchVersion + 1) {
    throw workflowFailure(
      'stale_workflow_branch',
      'This branch has changed since it was read.',
      {
        nodeId: stored.parallelNodeId,
        diagnostics:
          `branch ${stored.branchId} update carries version ${updated.branchVersion}, ` +
          `expected ${expectedBranchVersion + 1}`,
      },
    );
  }
}

/**
 * Apply NON-TERMINAL progress to a branch: a cursor move, a pending child, a
 * stored output.
 *
 * Throws on a settled branch. That is not a race the engine can be in — a
 * settled branch is never selected for work — so reaching it means an invariant
 * above this function is broken, and continuing would write progress into a
 * record the join may already have merged.
 */
export function applyBranchProgress(
  group: WorkflowParallelGroup,
  updated: WorkflowBranchRecord,
  expectedBranchVersion: number,
): WorkflowParallelGroup {
  const stored = requireBranch(group, updated.branchId);
  assertBranchVersion(stored, updated, expectedBranchVersion);

  if (isTerminalBranchState(stored.state)) {
    throw workflowFailure(
      'workflow_branch_conflict',
      'That branch has already finished.',
      {
        nodeId: stored.parallelNodeId,
        diagnostics: `branch ${stored.branchId} is ${stored.state} and cannot take progress`,
      },
    );
  }
  if (isTerminalBranchState(updated.state)) {
    throw workflowFailure(
      'workflow_branch_conflict',
      'That branch cannot be finished this way.',
      {
        nodeId: stored.parallelNodeId,
        diagnostics:
          `branch ${stored.branchId} progress carries terminal state ${updated.state} — ` +
          'an outcome must go through applyBranchOutcome',
      },
    );
  }

  return replaceBranch(group, updated);
}

export interface BranchOutcome {
  readonly state: Extract<WorkflowBranchState, 'completed' | 'failed' | 'cancelled'>;
  readonly at: string;
  readonly contributionNodeId?: string;
  readonly resultDigest?: string;
  readonly failure?: WorkflowFailureCode;
}

export interface BranchOutcomeResult {
  readonly group: WorkflowParallelGroup;
  /**
   * False when the branch had already settled and this outcome was discarded.
   *
   * The engine reports it, counts it and does not treat it as an error: two
   * isolates both observing one child agent run reach a terminal state is an
   * ordinary race, and the correct response to the second observation is to do
   * nothing at all.
   */
  readonly applied: boolean;
}

/**
 * Settle a branch — once.
 *
 * A DUPLICATE OUTCOME IS IGNORED, deterministically and without an error: the
 * group comes back byte-identical and `applied` is false. Applying the second
 * one would mean the join merges whichever duplicate arrived last, and for a
 * branch that completed and was then also observed as cancelled, that is a
 * different merged value for the same execution.
 */
export function applyBranchOutcome(
  group: WorkflowParallelGroup,
  branchId: string,
  outcome: BranchOutcome,
  expectedBranchVersion: number,
): BranchOutcomeResult {
  const stored = requireBranch(group, branchId);

  if (isTerminalBranchState(stored.state)) return { group, applied: false };

  assertBranchVersion(
    stored,
    { ...stored, branchVersion: expectedBranchVersion + 1 },
    expectedBranchVersion,
  );

  const settled: WorkflowBranchRecord = {
    ...stored,
    state: outcome.state,
    branchVersion: expectedBranchVersion + 1,
    cursorNodeId: undefined,
    pendingNode: undefined,
    endedAt: outcome.at,
    ...(outcome.contributionNodeId === undefined
      ? {}
      : { contributionNodeId: outcome.contributionNodeId }),
    ...(outcome.resultDigest === undefined ? {} : { resultDigest: outcome.resultDigest }),
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
  };

  return { group: replaceBranch(group, settled), applied: true };
}

/** Replace a group in the run's list, or append it when it is new. */
export function upsertGroup(
  groups: readonly WorkflowParallelGroup[] | undefined,
  next: WorkflowParallelGroup,
): readonly WorkflowParallelGroup[] {
  const existing = groups ?? [];
  return findGroup(existing, next.groupId) === undefined
    ? [...existing, next]
    : existing.map((group) => (group.groupId === next.groupId ? next : group));
}

/**
 * Close a group, once.
 *
 * `joinedAt` is set here and nowhere else, and a group that already carries one
 * is refused rather than re-closed — the durable half of "the join fires once".
 * `decideJoin` also refuses, and two refusals against one durable field is the
 * difference between "we noticed" and "we prevented".
 */
export function closeGroup(
  group: WorkflowParallelGroup,
  closure: {
    readonly state: Exclude<WorkflowParallelGroup['state'], 'open'>;
    readonly at: string;
    readonly joinDigest?: string;
    readonly failure?: WorkflowFailureCode;
  },
): WorkflowParallelGroup {
  if (group.state !== 'open' || group.joinedAt !== undefined) {
    throw workflowFailure(
      'workflow_branch_conflict',
      'That parallel step has already finished.',
      {
        nodeId: group.parallelNodeId,
        diagnostics: `group ${group.groupId} is ${group.state} and cannot be closed again`,
      },
    );
  }

  return {
    ...group,
    state: closure.state,
    groupVersion: group.groupVersion + 1,
    endedAt: closure.at,
    ...(closure.state === 'joined' ? { joinedAt: closure.at } : {}),
    ...(closure.joinDigest === undefined ? {} : { joinDigest: closure.joinDigest }),
    ...(closure.failure === undefined ? {} : { failure: closure.failure }),
  };
}
