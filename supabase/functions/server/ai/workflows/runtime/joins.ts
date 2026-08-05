/**
 * The Join Engine (AI-01 Batch 3B).
 *
 * A join answers one question deterministically: given the branches the PLAN says
 * should arrive, and the branches that actually have, is this join satisfied,
 * still waiting, or impossible?
 *
 * THE EXPECTED SET COMES FROM THE PLAN, NOT FROM ARRIVALS.
 *
 * That ordering is the whole design. A join that inferred its expected set from
 * what turned up could never distinguish "two of three have arrived" from "two of
 * two have arrived", so it could not detect a duplicate, could not fire an `all`
 * policy correctly, and could never conclude that it will NEVER be satisfied — it
 * would simply wait until the run's deadline and report a timeout for a design
 * error.
 *
 * A JOIN FIRES ONCE. `satisfied` is durable and checked before anything else. Two
 * isolates racing the last branch contend on one compare-and-swap: exactly one
 * writes the satisfied join, and the loser is told the join already fired rather
 * than firing it again with a different merged output.
 *
 * DUPLICATE AND STALE ARRIVALS ARE REFUSED, NOT MERGED. A branch that reports
 * twice is a bug somewhere upstream, and accepting the second report would
 * double-count its tokens and its cost. A branch that is not in the expected set
 * is refused for the same reason.
 *
 * MERGE ORDER IS THE EXPECTED SET'S ORDER, which the planner sorted. Merging in
 * arrival order would make the joined output depend on timing, and a workflow
 * whose result changes with scheduling is not a workflow anybody can test.
 */

import type { WorkflowBranchRecord, WorkflowJoinRecord } from '../contracts/runtime.ts';
import type { PlannedJoin } from '../planner/workflowPlanner.ts';
import { workflowFailure } from '../contracts/failures.ts';

export type JoinStatus =
  /** Not enough branches have arrived yet, and enough still can. */
  | 'waiting'
  /** The policy is met. The join fires exactly now. */
  | 'satisfied'
  /** The policy can no longer be met, whatever arrives next. */
  | 'unsatisfiable';

export interface JoinEvaluation {
  readonly status: JoinStatus;
  readonly reason: string;
  readonly diagnostics: string;
  readonly arrived: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly expected: number;
  /** Branches still able to arrive. Zero means nothing more is coming. */
  readonly outstanding: number;
}

export function initialJoinRecord(plan: PlannedJoin): WorkflowJoinRecord {
  return {
    joinNodeId: plan.joinNodeId,
    expectedBranchIds: plan.expectedBranchIds,
    arrivedBranchIds: [],
    succeededBranchIds: [],
    failedBranchIds: [],
    cancelledBranchIds: [],
    satisfied: false,
  };
}

/**
 * Record a branch's arrival at its join.
 *
 * Refuses a branch the plan does not expect, a branch that has already arrived,
 * and any arrival at a join that has already fired. Each of those is a typed
 * `join_conflict` rather than a silent no-op, because a silent no-op here means a
 * join that waits forever for a branch it already saw.
 */
export function recordBranchArrival(
  record: WorkflowJoinRecord,
  input: {
    readonly branchId: string;
    readonly outcome: 'completed' | 'failed' | 'cancelled';
    readonly workflowRunId: string;
  },
): WorkflowJoinRecord {
  if (record.satisfied) {
    throw workflowFailure('join_conflict', 'That join has already completed.', {
      workflowRunId: input.workflowRunId,
      nodeId: record.joinNodeId,
      branchId: input.branchId,
      diagnostics: `join ${record.joinNodeId} already fired; branch ${input.branchId} arrived after`,
    });
  }
  if (!record.expectedBranchIds.includes(input.branchId)) {
    throw workflowFailure('join_conflict', 'That branch does not belong to this join.', {
      workflowRunId: input.workflowRunId,
      nodeId: record.joinNodeId,
      branchId: input.branchId,
      diagnostics:
        `branch ${input.branchId} is not in the planned expected set ` +
        `(${record.expectedBranchIds.join(', ')})`,
    });
  }
  if (record.arrivedBranchIds.includes(input.branchId)) {
    throw workflowFailure('join_conflict', 'That branch has already reported to this join.', {
      workflowRunId: input.workflowRunId,
      nodeId: record.joinNodeId,
      branchId: input.branchId,
      diagnostics: `duplicate arrival of branch ${input.branchId} at join ${record.joinNodeId}`,
    });
  }

  // Sorted, so the record — and therefore the checkpoint digest — is a function
  // of WHICH branches arrived and not of the order they happened to arrive in.
  const sorted = (values: readonly string[]): readonly string[] => [...values].sort();

  return {
    ...record,
    arrivedBranchIds: sorted([...record.arrivedBranchIds, input.branchId]),
    succeededBranchIds:
      input.outcome === 'completed'
        ? sorted([...record.succeededBranchIds, input.branchId])
        : record.succeededBranchIds,
    failedBranchIds:
      input.outcome === 'failed'
        ? sorted([...record.failedBranchIds, input.branchId])
        : record.failedBranchIds,
    cancelledBranchIds:
      input.outcome === 'cancelled'
        ? sorted([...record.cancelledBranchIds, input.branchId])
        : record.cancelledBranchIds,
  };
}

/**
 * Evaluate a join against its policy.
 *
 * `fail_fast` is checked before the success policy: a fan-out whose failure policy
 * is fail-fast must stop on the first failed branch even if the remaining
 * branches could still satisfy the join. That is what the author asked for, and
 * silently continuing because success was still possible would be the engine
 * overriding a declared policy.
 */
export function evaluateJoin(
  record: WorkflowJoinRecord,
  plan: PlannedJoin,
): JoinEvaluation {
  const expected = record.expectedBranchIds.length;
  const arrived = record.arrivedBranchIds.length;
  const succeeded = record.succeededBranchIds.length;
  const failed = record.failedBranchIds.length;
  const cancelled = record.cancelledBranchIds.length;
  const outstanding = expected - arrived;

  const base = { arrived, succeeded, failed, cancelled, expected, outstanding };
  const counts =
    `expected=${expected} arrived=${arrived} succeeded=${succeeded} failed=${failed} ` +
    `cancelled=${cancelled}`;

  if (plan.failurePolicy === 'fail_fast' && failed > 0) {
    return {
      ...base,
      status: 'unsatisfiable',
      reason: 'A branch failed and this fan-out is declared fail-fast.',
      diagnostics: `${counts} policy=fail_fast failedBranches=${record.failedBranchIds.join(',')}`,
    };
  }

  switch (plan.policy) {
    case 'all': {
      if (failed > 0 || cancelled > 0) {
        return {
          ...base,
          status: 'unsatisfiable',
          reason: 'This join needs every branch to succeed and one did not.',
          diagnostics: `${counts} policy=all`,
        };
      }
      if (succeeded === expected) {
        return {
          ...base,
          status: 'satisfied',
          reason: 'Every branch succeeded.',
          diagnostics: `${counts} policy=all`,
        };
      }
      return {
        ...base,
        status: 'waiting',
        reason: 'Waiting for the remaining branches.',
        diagnostics: `${counts} policy=all`,
      };
    }

    case 'any': {
      if (succeeded >= 1) {
        return {
          ...base,
          status: 'satisfied',
          reason: 'At least one branch succeeded.',
          diagnostics: `${counts} policy=any`,
        };
      }
      if (outstanding === 0) {
        return {
          ...base,
          status: 'unsatisfiable',
          reason: 'Every branch finished and none succeeded.',
          diagnostics: `${counts} policy=any`,
        };
      }
      return {
        ...base,
        status: 'waiting',
        reason: 'Waiting for a branch to succeed.',
        diagnostics: `${counts} policy=any`,
      };
    }

    case 'minimum_successes': {
      const minimum = plan.minimumSuccesses;
      if (succeeded >= minimum) {
        return {
          ...base,
          status: 'satisfied',
          reason: `At least ${minimum} branches succeeded.`,
          diagnostics: `${counts} policy=minimum_successes minimum=${minimum}`,
        };
      }
      // The decisive comparison: could the outstanding branches still get there?
      // Asking that rather than waiting for every arrival is what turns an
      // impossible join into an immediate, explainable failure.
      if (succeeded + outstanding < minimum) {
        return {
          ...base,
          status: 'unsatisfiable',
          reason: `This join needs ${minimum} successes and can no longer reach it.`,
          diagnostics: `${counts} policy=minimum_successes minimum=${minimum}`,
        };
      }
      return {
        ...base,
        status: 'waiting',
        reason: `Waiting for ${minimum - succeeded} more successful branches.`,
        diagnostics: `${counts} policy=minimum_successes minimum=${minimum}`,
      };
    }

    case 'named_required_branches': {
      const required = plan.requiredBranchIds;
      const missing = required.filter((branchId) => !record.succeededBranchIds.includes(branchId));
      const impossible = missing.filter(
        (branchId) =>
          record.failedBranchIds.includes(branchId) ||
          record.cancelledBranchIds.includes(branchId),
      );
      if (impossible.length > 0) {
        return {
          ...base,
          status: 'unsatisfiable',
          reason: 'A branch this join requires did not succeed.',
          diagnostics: `${counts} policy=named required=${required.join(',')} impossible=${impossible.join(',')}`,
        };
      }
      if (missing.length === 0) {
        return {
          ...base,
          status: 'satisfied',
          reason: 'Every required branch succeeded.',
          diagnostics: `${counts} policy=named required=${required.join(',')}`,
        };
      }
      return {
        ...base,
        status: 'waiting',
        reason: 'Waiting for the required branches.',
        diagnostics: `${counts} policy=named missing=${missing.join(',')}`,
      };
    }
  }
}

/**
 * Merge branch outputs into the value written by the join.
 *
 * The merge is over the EXPECTED set in its planned (sorted) order, restricted to
 * branches that succeeded. Two consequences, both deliberate: the output is
 * independent of arrival order, and a failed branch contributes nothing rather
 * than contributing a partial value the join would have to interpret.
 *
 * The shape is explicit — `{ branchId: value }` — rather than a deep merge.
 * A deep merge of two branches that both wrote the same key silently loses one of
 * them, and "which branch produced this?" has to stay answerable.
 */
export function mergeBranchOutputs(
  record: WorkflowJoinRecord,
  branchValues: ReadonlyMap<string, unknown>,
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};
  for (const branchId of record.expectedBranchIds) {
    if (!record.succeededBranchIds.includes(branchId)) continue;
    const value = branchValues.get(branchId);
    if (value !== undefined) merged[branchId] = value;
  }
  return merged;
}

/**
 * Branches that must be cancelled now that the join has fired.
 *
 * Only under `cancel_remaining`. Under `wait_all` the join has been satisfied but
 * the fan-out is not finished, and cancelling the remaining arms would discard
 * work the author explicitly asked to complete.
 */
export function branchesToCancel(
  record: WorkflowJoinRecord,
  plan: PlannedJoin,
  branches: readonly WorkflowBranchRecord[],
): readonly string[] {
  if (plan.onSatisfied !== 'cancel_remaining') return [];
  return branches
    .filter(
      (branch) =>
        branch.joinNodeId === record.joinNodeId &&
        !record.arrivedBranchIds.includes(branch.branchId) &&
        (branch.state === 'pending' ||
          branch.state === 'running' ||
          branch.state === 'waiting_for_approval'),
    )
    .map((branch) => branch.branchId)
    .sort();
}
