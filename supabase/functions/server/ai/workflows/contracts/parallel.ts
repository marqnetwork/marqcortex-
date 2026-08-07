/**
 * Parallel branches and joins (AI-01 Batch 3B, Part 4).
 *
 * Parts 1–3 refused fan-out, and the refusal was honest rather than lazy: a node
 * with two successors both taken is a shape that cannot finish without a join,
 * and a join is not a graph detail — it is a durable, versioned, once-only
 * decision about what several independent lines of work add up to. This file is
 * that decision written down.
 *
 * ── WHAT A BRANCH IS ───────────────────────────────────────────────────────
 *
 * A branch is a named, ordered, tenant-scoped sub-execution with its OWN cursor,
 * its OWN trusted outputs and its OWN version. It is not a thread and it is not
 * a promise: it is a record, on the run record, that survives an isolate. Two
 * isolates advancing the same branch cannot both win, because every branch
 * mutation carries the version it read and the store refuses the loser.
 *
 * THE FOUR PROPERTIES THAT MAKE THAT TRUE, AND WHY EACH IS HERE.
 *
 *   DETERMINISTIC IDENTITY   `workflowBranchIdFor` is a pure function of the run,
 *                            the parallel node and the branch name. A recovered
 *                            isolate recomputes the identical id rather than
 *                            minting a new one, so "have I already started this
 *                            branch?" is answerable from durable state alone.
 *
 *   BRANCH-LOCAL STATE       A branch's outputs are keyed inside the branch and
 *                            are invisible to its siblings until the merge. Two
 *                            branches that both run a node called `draft` do not
 *                            overwrite one another, and a sibling cannot read a
 *                            value the join has not yet accepted.
 *
 *   OWN VERSION              `branchVersion` is incremented by every branch
 *                            mutation and asserted before it is applied. The run
 *                            record's own `runVersion` guards the whole record;
 *                            this guards the branch inside it, which is what
 *                            stops two concurrent sweeps merging their views of
 *                            different branches into one write.
 *
 *   TERMINAL MEANS TERMINAL  A branch that has completed, failed or been
 *                            cancelled accepts no further outcome. A second
 *                            completion is IGNORED deterministically rather than
 *                            applied, because "the last writer wins" on a branch
 *                            outcome means the join merges whichever duplicate
 *                            arrived second.
 *
 * ── TOKENS AND COST ARE PLACEHOLDERS, AND SAY SO ───────────────────────────
 *
 * `tokensPlaceholder` and `costMicroUsdPlaceholder` are always zero, in Part 4
 * and still in Part 5. Branch-level accounting needs the child agent runs' own
 * spend records rolled up through the port — token and cost intelligence, which
 * is out of scope for this batch — and a field that quietly reported a wrong
 * number would be worse than one that reports none. They exist so the shape of
 * the record does not change when the numbers arrive, and the approval record
 * carries the same two placeholders on the same terms.
 */

import type { WorkflowFailureCode } from './failures.ts';
import type { WorkflowPendingNode } from './run.ts';
import type { WorkflowPendingApproval } from './approval.ts';

// ── Join policy ─────────────────────────────────────────────────────────────

/**
 * When the join may fire.
 *
 * A discriminated union rather than a string plus optional fields, so
 * `minimum_successes` without a minimum and `named_required_branches` without a
 * list are not representable — the two mistakes an operator would only discover
 * from a run that hung.
 */
export type WorkflowJoinPolicy =
  /** Every branch must complete. One failure means the join never fires. */
  | { readonly kind: 'all' }
  /** The first completion is enough. Remaining branches are cancelled. */
  | { readonly kind: 'any' }
  /** At least `minimum` branches must complete. */
  | { readonly kind: 'minimum_successes'; readonly minimum: number }
  /**
   * These specific branches must complete; others may fail.
   *
   * The one policy where WHICH branch succeeded matters rather than how many —
   * "the compliance check must pass, the enrichment is best-effort" is a real
   * shape and `minimum_successes: 1` cannot express it.
   */
  | { readonly kind: 'named_required_branches'; readonly required: readonly string[] };

export const WORKFLOW_JOIN_POLICY_KINDS = [
  'all',
  'any',
  'minimum_successes',
  'named_required_branches',
] as const;

export type WorkflowJoinPolicyKind = (typeof WORKFLOW_JOIN_POLICY_KINDS)[number];

// ── Failure policy ──────────────────────────────────────────────────────────

/**
 * What a branch failure does to its siblings.
 *
 * Orthogonal to the join policy, and the pair is what a reviewer actually reads:
 * the join policy says when success is enough, this says when failure is too
 * much and whether the group is allowed to stop early at all.
 *
 *   fail_fast          the FIRST branch failure ends the group. Siblings are
 *                      cancelled, their children stopped, the run fails.
 *
 *   wait_all           no early exit in either direction. Every branch runs to a
 *                      terminal outcome, and only then does the join policy
 *                      decide. The choice for branches whose effects should
 *                      complete even when a sibling has already failed.
 *
 *   minimum_successes  the group ends early only when the join policy has become
 *                      UNSATISFIABLE — enough branches have failed that no
 *                      remaining outcome can rescue it. Otherwise it keeps going,
 *                      and fires as soon as the policy is satisfied.
 */
export const WORKFLOW_PARALLEL_FAILURE_POLICIES = [
  'fail_fast',
  'wait_all',
  'minimum_successes',
] as const;

export type WorkflowParallelFailurePolicy =
  (typeof WORKFLOW_PARALLEL_FAILURE_POLICIES)[number];

// ── Branch state ────────────────────────────────────────────────────────────

/**
 * `waiting_for_approval` (AI-01 Batch 3B, Part 5) is a BRANCH state rather than
 * a run state when the barrier is inside a branch, and that asymmetry with the
 * main line is the point: a run whose `enrichment` branch is waiting on a human
 * is still driving its `compliance` branch, so the RUN is `waiting_for_branches`
 * and only the one branch is parked. Promoting it to the run's own state would
 * report the whole fan-out as blocked on a person while three quarters of it
 * was making progress.
 */
export const WORKFLOW_BRANCH_STATES = [
  /** Created, durable, and not yet started. Nothing external has happened. */
  'pending',
  'running',
  'waiting_for_agent',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
] as const;

export type WorkflowBranchState = (typeof WORKFLOW_BRANCH_STATES)[number];

export const TERMINAL_BRANCH_STATES: readonly WorkflowBranchState[] = [
  'completed',
  'failed',
  'cancelled',
];

export function isTerminalBranchState(state: WorkflowBranchState): boolean {
  return TERMINAL_BRANCH_STATES.includes(state);
}

/**
 * One branch, durably.
 *
 * Everything the engine needs to resume this branch after an isolate restart,
 * and nothing that would let a sibling see inside it before the merge.
 */
export interface WorkflowBranchRecord {
  /** Deterministic. See `workflowBranchIdFor`. */
  readonly branchId: string;
  readonly branchName: string;
  readonly parallelNodeId: string;
  /**
   * Position in the parallel node's DECLARED branch list.
   *
   * The merge order, and it is declaration order rather than completion order on
   * purpose: a merge that depended on which branch finished first would produce
   * a different value on every run of the same workflow over the same data.
   */
  readonly ordinal: number;
  readonly state: WorkflowBranchState;
  /**
   * The branch-local cursor. Absent before the branch starts and after it ends.
   *
   * Separate from the run's `currentNodeId`, which stays on the parallel node
   * for as long as the group is open. One cursor per line of execution is the
   * whole reason a branch can be resumed independently.
   */
  readonly cursorNodeId?: string;
  /** The child agent run this branch is waiting on. The recovery pointer. */
  readonly pendingNode?: WorkflowPendingNode;
  /**
   * The decision this branch is parked on, or none (AI-01 Batch 3B, Part 5).
   *
   * Branch-local, exactly as `pendingNode` is. Two branches may sit on two
   * different approvals at once, each decided by a different person, and
   * neither blocks the other — which is only representable because the pointer
   * is on the branch rather than on the run.
   */
  readonly pendingApproval?: WorkflowPendingApproval;
  /**
   * Trusted node outputs produced INSIDE this branch, keyed by node id.
   *
   * Branch-local: a sibling's expression cannot reach them, and they do not
   * enter the run's own output map. Only the merge promotes anything out of
   * here, and only after the join's merge contract has accepted it.
   */
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly nodeVisits: Readonly<Record<string, number>>;
  /**
   * The node whose trusted output this branch contributes to the merge.
   *
   * Set when the branch completes, and it names the last node the branch
   * executed before its cursor reached the join. Naming the node rather than
   * copying the value keeps one copy of it — `outputs` already holds it, and a
   * second copy is a second thing that can disagree with the first.
   */
  readonly contributionNodeId?: string;
  readonly childAgentRunIds: readonly string[];
  readonly stepCount: number;
  /** Optimistic concurrency for this branch alone. Starts at 1. */
  readonly branchVersion: number;
  /** Always 0 in Part 4. See the header. */
  readonly tokensPlaceholder: number;
  /** Always 0 in Part 4. See the header. */
  readonly costMicroUsdPlaceholder: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly failure?: WorkflowFailureCode;
  /** Digest of the branch's contributed output. Never the value. */
  readonly resultDigest?: string;
}

// ── The group ───────────────────────────────────────────────────────────────

export const WORKFLOW_PARALLEL_GROUP_STATES = ['open', 'joined', 'failed', 'cancelled'] as const;

export type WorkflowParallelGroupState = (typeof WORKFLOW_PARALLEL_GROUP_STATES)[number];

/**
 * One execution of one parallel node: its branches, its policies and its
 * once-only join.
 *
 * `joinedAt` is the whole of the "join fires once" guarantee. It is set in the
 * same versioned write that stores the merged output, so a second evaluation
 * reads a group that has already joined and does nothing. There is no in-memory
 * flag anywhere — a flag would be re-initialised as `false` by the next isolate,
 * which is exactly the case a once-only guarantee has to survive.
 */
export interface WorkflowParallelGroup {
  /** Deterministic. See `workflowParallelGroupIdFor`. */
  readonly groupId: string;
  readonly parallelNodeId: string;
  readonly joinNodeId: string;
  readonly joinPolicy: WorkflowJoinPolicy;
  readonly failurePolicy: WorkflowParallelFailurePolicy;
  /** In declared ordinal order, always. The merge reads this array as it is. */
  readonly branches: readonly WorkflowBranchRecord[];
  readonly state: WorkflowParallelGroupState;
  readonly startedAt: string;
  /** Set exactly once, when the join fires. Never cleared, never rewritten. */
  readonly joinedAt?: string;
  /** Digest of the merged, contract-accepted value. Never the value. */
  readonly joinDigest?: string;
  readonly endedAt?: string;
  readonly failure?: WorkflowFailureCode;
  /** Optimistic concurrency for the group as a whole. Starts at 1. */
  readonly groupVersion: number;
}

// ── Deterministic identity ──────────────────────────────────────────────────

/**
 * The separator is `:` because no workflow identifier grammar admits it —
 * node ids and branch names are lower-case alphanumerics with underscores, so
 * `a_b` + `c` and `a` + `b_c` cannot collide the way they would under `_`.
 */
const ID_SEPARATOR = ':';

/**
 * A branch's id, from durable facts alone.
 *
 * No clock, no counter, no random source. A restarted isolate holding only the
 * run record and the plan recomputes the identical id, which is what lets
 * "start this branch" be refused a second time rather than performed twice.
 */
export function workflowBranchIdFor(
  workflowRunId: string,
  parallelNodeId: string,
  branchName: string,
): string {
  return ['wfb', workflowRunId, parallelNodeId, branchName].join(ID_SEPARATOR);
}

/**
 * A group's id, from durable facts alone.
 *
 * There is exactly one group per parallel node per run, because a parallel node
 * inside a loop body is refused at planning — see `planner/workflowPlanner.ts`.
 * That refusal is what makes this id unique without a visit counter, and it is
 * the reason the refusal exists rather than a consequence of it.
 */
export function workflowParallelGroupIdFor(
  workflowRunId: string,
  parallelNodeId: string,
): string {
  return ['wfg', workflowRunId, parallelNodeId].join(ID_SEPARATOR);
}

// ── Bounds ──────────────────────────────────────────────────────────────────

/**
 * Ceilings on parallel work.
 *
 * `maximumParallelBranches` is the platform's hard ceiling and it is enforced in
 * three places on purpose: validation refuses a definition above it, the planner
 * carries it onto the plan step, and the engine refuses to create a branch past
 * it even if a definition somehow reached the runtime. A definition-level
 * ceiling may lower it and may never raise it.
 *
 * `maxGroupsPerRun` bounds how much parallel work one run may hold in its
 * record. Each group carries its branches' outputs, and a run that opened
 * thirty groups would be a record nobody sized for.
 */
export const WORKFLOW_PARALLEL_BOUNDS = {
  /** THE ceiling. A parallel node may declare between two and this many branches. */
  maximumParallelBranches: 8,
  minParallelBranches: 2,
  maxGroupsPerRun: 4,
  /** Nodes one branch body may contain. Keeps a branch's cursor walk bounded. */
  maxBranchBodyNodes: 16,
  /** Canonical size of one branch's accumulated outputs. */
  maxBranchOutputsBytes: 32 * 1024,
  /** Canonical size of the merged value handed to the merge contract. */
  maxMergedBytes: 64 * 1024,
} as const;

/** Branch names share the node-id grammar: safe in a key, a log line and a label. */
export const WORKFLOW_BRANCH_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

// ── The merged value ────────────────────────────────────────────────────────

/**
 * What the join hands to its merge contract.
 *
 * `branches` holds one entry per COMPLETED branch, inserted in ordinal order.
 * The three name arrays are also in ordinal order, and they are the reliable
 * carrier of merge order: a merge contract built from `object()` re-emits keys
 * in its own shape's declaration order, so an author who needs to prove the
 * order downstream reads `completedBranches` rather than the key order of a map
 * some validator rebuilt.
 *
 * A branch contributes the trusted output of the LAST node it executed. A branch
 * whose final node declared no output contract stored nothing trusted and
 * therefore contributes no entry — the merge contract then decides whether that
 * is acceptable, which is the right place for that judgement.
 */
export interface WorkflowMergedBranchOutputs {
  readonly branches: Readonly<Record<string, unknown>>;
  readonly completedBranches: readonly string[];
  readonly failedBranches: readonly string[];
  readonly cancelledBranches: readonly string[];
}
