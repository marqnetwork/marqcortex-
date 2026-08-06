/**
 * Join policy, failure policy and the merge (AI-01 Batch 3B, Part 4).
 *
 * Pure functions over a group record. No clock, no store, no agent port, no
 * randomness — the same group always produces the same decision, which is what
 * makes a join something a test can assert on exhaustively and an operator can
 * reason about from a stored record alone.
 *
 * ── THE DECISION IS ONE FUNCTION, AND ITS ORDER IS THE DESIGN ──────────────
 *
 *   1. HAS IT ALREADY JOINED?  A group carrying `joinedAt` is finished deciding.
 *      This is checked first and it is checked against DURABLE state, so a
 *      second evaluation — by a retry, a second isolate, or a duplicate branch
 *      completion — does nothing rather than merging twice.
 *
 *   2. DOES THE FAILURE POLICY END IT?  `fail_fast` on the first failure;
 *      `minimum_successes` when the join has become unsatisfiable; `wait_all`
 *      never, by definition.
 *
 *   3. DOES THE JOIN POLICY FIRE?  Under `wait_all` only once every branch has
 *      settled. Otherwise as soon as the policy is satisfied, cancelling the
 *      branches still in flight.
 *
 * Running 2 before 3 is what makes `fail_fast` mean what it says. Reversed, a
 * group whose join was already satisfied would fire while a sibling was failing,
 * and "fail fast" would mean "fail fast, unless we were nearly done".
 *
 * ── WHY UNSATISFIABILITY IS COMPUTED RATHER THAN WAITED FOR ────────────────
 *
 * A group under `minimum_successes` needing three completions, with two branches
 * failed and one left, cannot reach three. Waiting for the last branch would
 * spend an agent run, a budget and an operator's time on an outcome that is
 * already decided. So the group ends when the arithmetic says it must, and the
 * failure names the reason — `workflow_join_unsatisfied` — rather than surfacing
 * as a branch failure that happened to be the last one.
 */

import type {
  WorkflowBranchRecord,
  WorkflowJoinPolicy,
  WorkflowMergedBranchOutputs,
  WorkflowParallelGroup,
} from '../contracts/parallel.ts';
import type { WorkflowFailureCode } from '../contracts/failures.ts';
import { isTerminalBranchState } from '../contracts/parallel.ts';

/** Branch counts a policy decision is made from. */
export interface BranchTally {
  readonly completed: readonly WorkflowBranchRecord[];
  readonly failed: readonly WorkflowBranchRecord[];
  readonly cancelled: readonly WorkflowBranchRecord[];
  /** Branches that have not reached a terminal state. */
  readonly inFlight: readonly WorkflowBranchRecord[];
}

/** Tally a group's branches. Ordinal order is preserved in every list. */
export function tallyBranches(branches: readonly WorkflowBranchRecord[]): BranchTally {
  const ordered = [...branches].sort((a, b) => a.ordinal - b.ordinal);
  return {
    completed: ordered.filter((branch) => branch.state === 'completed'),
    failed: ordered.filter((branch) => branch.state === 'failed'),
    cancelled: ordered.filter((branch) => branch.state === 'cancelled'),
    inFlight: ordered.filter((branch) => !isTerminalBranchState(branch.state)),
  };
}

/**
 * Is the policy satisfied by what has completed so far?
 *
 * Note that `all` requires every branch to be in `completed` — a cancelled
 * branch does not satisfy it. Cancellation is an outcome, not an exemption, and
 * a join that treated "we stopped it" as "it succeeded" would report a workflow
 * that did not do all of its work as one that did.
 */
export function joinSatisfied(
  policy: WorkflowJoinPolicy,
  branches: readonly WorkflowBranchRecord[],
): boolean {
  const tally = tallyBranches(branches);
  switch (policy.kind) {
    case 'all':
      return branches.length > 0 && tally.completed.length === branches.length;
    case 'any':
      return tally.completed.length >= 1;
    case 'minimum_successes':
      return tally.completed.length >= policy.minimum;
    case 'named_required_branches': {
      const done = new Set(tally.completed.map((branch) => branch.branchName));
      return policy.required.every((name) => done.has(name));
    }
  }
}

/**
 * Can the policy no longer be satisfied, whatever the remaining branches do?
 *
 * The optimistic reading — "every branch still in flight will complete" — is the
 * right one: this answers "is it already impossible", not "is it likely".
 */
export function joinUnsatisfiable(
  policy: WorkflowJoinPolicy,
  branches: readonly WorkflowBranchRecord[],
): boolean {
  const tally = tallyBranches(branches);
  switch (policy.kind) {
    case 'all':
      return tally.failed.length > 0 || tally.cancelled.length > 0;
    case 'any':
      return tally.inFlight.length === 0 && tally.completed.length === 0;
    case 'minimum_successes':
      return tally.completed.length + tally.inFlight.length < policy.minimum;
    case 'named_required_branches': {
      const settledWithoutSuccess = new Set(
        [...tally.failed, ...tally.cancelled].map((branch) => branch.branchName),
      );
      return policy.required.some((name) => settledWithoutSuccess.has(name));
    }
  }
}

// ── The decision ────────────────────────────────────────────────────────────

export type WorkflowJoinDecision =
  /** Nothing to do: branches are still in flight and no policy has tripped. */
  | { readonly kind: 'wait' }
  /** The group has already joined. A duplicate evaluation, deterministically ignored. */
  | { readonly kind: 'already_joined' }
  /** Fire the join, then cancel whatever is still running. */
  | {
      readonly kind: 'join';
      readonly cancelBranchIds: readonly string[];
      readonly reason: string;
    }
  /** End the group without joining. */
  | {
      readonly kind: 'fail';
      readonly failure: WorkflowFailureCode;
      readonly reason: string;
      readonly cancelBranchIds: readonly string[];
    };

/**
 * The one place a group's fate is decided.
 *
 * Called after every branch settles and never anywhere else, so there is exactly
 * one reading of "what should happen now" and it is derived from durable state
 * rather than from what the caller happened to observe.
 */
export function decideJoin(group: WorkflowParallelGroup): WorkflowJoinDecision {
  if (group.joinedAt !== undefined || group.state !== 'open') {
    return { kind: 'already_joined' };
  }

  const tally = tallyBranches(group.branches);
  const inFlightIds = tally.inFlight.map((branch) => branch.branchId);

  // Step 2. The failure policy, before the join policy — see the header.
  if (group.failurePolicy === 'fail_fast' && tally.failed.length > 0) {
    return {
      kind: 'fail',
      failure: 'workflow_branch_failed',
      reason: `Branch ${tally.failed[0].branchName} failed under fail_fast.`,
      cancelBranchIds: inFlightIds,
    };
  }

  if (
    group.failurePolicy === 'minimum_successes' &&
    joinUnsatisfiable(group.joinPolicy, group.branches)
  ) {
    return {
      kind: 'fail',
      failure: 'workflow_join_unsatisfied',
      reason: `The ${group.joinPolicy.kind} join can no longer be satisfied.`,
      cancelBranchIds: inFlightIds,
    };
  }

  // Step 3. The join policy.
  const satisfied = joinSatisfied(group.joinPolicy, group.branches);

  if (group.failurePolicy === 'wait_all') {
    // No early exit in either direction. The point of the policy is that every
    // branch's work reaches a terminal outcome before anything is concluded.
    if (tally.inFlight.length > 0) return { kind: 'wait' };
    return satisfied
      ? { kind: 'join', cancelBranchIds: [], reason: 'Every branch settled and the join is satisfied.' }
      : {
          kind: 'fail',
          failure: 'workflow_join_unsatisfied',
          reason: `Every branch settled and the ${group.joinPolicy.kind} join was not satisfied.`,
          cancelBranchIds: [],
        };
  }

  if (satisfied) {
    return {
      kind: 'join',
      cancelBranchIds: inFlightIds,
      reason: `The ${group.joinPolicy.kind} join is satisfied.`,
    };
  }

  if (tally.inFlight.length === 0) {
    return {
      kind: 'fail',
      failure: 'workflow_join_unsatisfied',
      reason: `Every branch settled and the ${group.joinPolicy.kind} join was not satisfied.`,
      cancelBranchIds: [],
    };
  }

  return { kind: 'wait' };
}

// ── The merge ───────────────────────────────────────────────────────────────

/**
 * Build the value the merge contract will judge.
 *
 * DETERMINISTIC ORDER, TWICE OVER. The branch array is sorted by ordinal — the
 * order the DEFINITION declared, not the order the branches finished — and the
 * name arrays carry that order onward through any validator that rebuilds the
 * map. Two runs of the same workflow over the same data merge identically, on
 * every instance, whatever the scheduling looked like.
 *
 * Only completed branches contribute a value. A branch that failed or was
 * cancelled appears in its name list and nowhere else: naming it lets a merge
 * contract require or forbid it, while contributing nothing for it keeps the
 * merged value free of half-finished work.
 */
export function mergeBranchOutputs(
  group: WorkflowParallelGroup,
): WorkflowMergedBranchOutputs {
  const tally = tallyBranches(group.branches);
  const branches: Record<string, unknown> = {};

  for (const branch of tally.completed) {
    if (branch.contributionNodeId === undefined) continue;
    const value = branch.outputs[branch.contributionNodeId];
    // A node with no declared output contract stored nothing trusted, so the
    // branch contributes nothing. The merge contract decides whether a branch
    // that produced no trusted output is acceptable — that judgement belongs to
    // the workflow author, not to this function.
    if (value === undefined) continue;
    branches[branch.branchName] = value;
  }

  return {
    branches,
    completedBranches: tally.completed.map((branch) => branch.branchName),
    failedBranches: tally.failed.map((branch) => branch.branchName),
    cancelledBranches: tally.cancelled.map((branch) => branch.branchName),
  };
}
