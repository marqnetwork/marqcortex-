/**
 * Durable workflow approvals (AI-01 Batch 3B, Part 5).
 *
 * A workflow approval is a HUMAN DECISION ABOUT A RUN, and it is a durable
 * object with a lifecycle of its own rather than a flag on the run record. That
 * is the same call Batch 3A made in `agents/approvals/approvalGate.ts`, and it
 * is made again here for the same four reasons — restated because a workflow
 * approval is a different decision about a different thing, and inheriting a
 * conclusion is not the same as reaching it.
 *
 *   IT SURVIVES A RESTART. The request is written before the run is parked and
 *   the decision is written before the run is released. An isolate that dies
 *   between the two loses nothing: the approval is still pending, the run is
 *   still `waiting_for_approval`, and the operator queue still shows it.
 *
 *   IT CANNOT BE REUSED. `singleUse` is not advisory. An approval moves
 *   pending → approved → consumed, each step an optimistic-concurrency write,
 *   so two advances cannot spend one approval even if they race: the second
 *   compare-and-swap loses and the second advance is refused.
 *
 *   AUTHORITY IS RESOLVED SERVER-SIDE. `authorizedRoles` comes from the
 *   WORKFLOW DEFINITION's approval node, and the decider's roles come from the
 *   authenticated subject. Nothing a caller sends influences either, and there
 *   is no field on this record through which it could try.
 *
 *   THERE IS NO AUTOMATIC APPROVAL. No timeout that approves, no configuration
 *   that bypasses, no "approve when the estimate is small" shortcut. An
 *   approval that expires makes its run fail; it never becomes a yes.
 *
 * ── WHY THE FIELD IS `approvalState` AND NOT `state` ───────────────────────
 *
 * A workflow run has a `state` and so does a branch, and both appear beside an
 * approval in the same engine, the same read model and the same log line.
 * Naming a third thing `state` would make every one of those reads ambiguous —
 * and it would make the boundary scan's "workflow state is assigned in exactly
 * one place" assertion unable to tell an approval decision from a run
 * transition. One name, one meaning.
 *
 * ── THE BINDING, AND WHY IT DIFFERS FOR A BRANCH ───────────────────────────
 *
 * An approval authorises ONE line of execution to move past ONE node from ONE
 * durable position. It therefore records the position it was requested from and
 * refuses to be spent from any other:
 *
 *   MAIN LINE   `checkpointVersion` AND `workflowRunVersion` must both still
 *               match. While a run is parked on an approval nothing may touch
 *               it — pause is refused from `waiting_for_approval`, and every
 *               other operation is terminal — so both numbers are stable, and
 *               requiring both means a decision cannot be carried across a node.
 *
 *   BRANCH      `branchVersion` must still match. The two run-wide numbers are
 *               RECORDED but not enforced, and the asymmetry is forced by the
 *               facts: a sibling branch completing a node legitimately writes a
 *               checkpoint and bumps the run version while this branch sits
 *               untouched. The branch's own version is the token that moves
 *               when — and only when — this branch does, which makes it the
 *               binding with the meaning the main-line pair has.
 *
 * ── NO PAYLOAD, EVER ───────────────────────────────────────────────────────
 *
 * There is no node input, no node output, no merged value and no agent
 * observation on this record, and there is no field for one. An approval is
 * read by whoever holds the approver role — a wider audience than the run
 * itself — so it carries the definition-authored `reason` and `impactSummary`,
 * the estimates, and identifiers. What the run is actually working on stays on
 * the run record and its checkpoints, behind the run's own read scope.
 */

import type { WorkflowFailureCode } from './failures.ts';

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Six states, and `withdrawn` is the one worth explaining.
 *
 * When a run is cancelled or expires, its pending approval can never be spent —
 * the run is terminal and terminal means terminal. Leaving it `pending` would
 * leave an undecidable request at the top of an operator's queue forever, so it
 * is closed. It is `withdrawn` rather than `rejected` because nobody rejected
 * it, and rather than `expired` because its deadline had not passed: an
 * operator reading the queue is entitled to know which of the three happened.
 *
 * None of the three closing states is ever a yes. That is the invariant the
 * whole file exists to hold.
 */
export const WORKFLOW_APPROVAL_STATES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'withdrawn',
  'consumed',
] as const;

export type WorkflowApprovalState = (typeof WORKFLOW_APPROVAL_STATES)[number];

/** States from which no further decision is possible. */
export const TERMINAL_WORKFLOW_APPROVAL_STATES: readonly WorkflowApprovalState[] = [
  'rejected',
  'expired',
  'withdrawn',
  'consumed',
];

export function isDecidableApprovalState(state: WorkflowApprovalState): boolean {
  return state === 'pending';
}

/** What a decider may say. Two values, and neither of them is "later". */
export const WORKFLOW_APPROVAL_DECISIONS = ['approve', 'reject'] as const;

export type WorkflowApprovalDecision = (typeof WORKFLOW_APPROVAL_DECISIONS)[number];

/**
 * What a rejection DOES to the line of execution that asked.
 *
 * Declared on the approval node, carried onto the plan and onto the record, so
 * "what happens if this is refused" is answered by the definition a reviewer
 * read rather than by a convention the engine chose. There is deliberately no
 * `continue`: an approval whose refusal changes nothing is a question that did
 * not need asking, and offering it would make every other approval look
 * optional by comparison.
 *
 *   fail    the run fails with `workflow_approval_rejected`, or — inside a
 *           branch — the branch fails and the group's failure policy decides
 *           what that means for its siblings.
 *   cancel  the run is cancelled, or the branch is cancelled. The distinction
 *           from `fail` is what an operator sees afterwards: a rejected step
 *           that was expected to be refused sometimes is not an incident.
 */
export const WORKFLOW_REJECTION_POLICIES = ['fail', 'cancel'] as const;

export type WorkflowRejectionPolicy = (typeof WORKFLOW_REJECTION_POLICIES)[number];

// ── The record ──────────────────────────────────────────────────────────────

export interface WorkflowApprovalRecord {
  /** Deterministic. See `workflowApprovalIdFor`. */
  readonly workflowApprovalId: string;
  readonly workflowRunId: string;
  readonly organizationId: string;
  /** The workflow the run is executing. Carried so a queue can group by it. */
  readonly workflowId: string;
  /** The approval node that parked. */
  readonly nodeId: string;
  /** Set when the approval belongs to a parallel branch. See the header. */
  readonly branchId?: string;
  readonly branchName?: string;
  /**
   * Who the run belongs to — the actor that started it.
   *
   * NOT who may decide it. A requester approving their own request is exactly
   * what an approval gate exists to prevent being invisible, so the two fields
   * are separate and the decider is recorded in `decidedBy`.
   */
  readonly requestedBy: string;
  /** Why this workflow asks. Definition-authored, never caller-supplied. */
  readonly reason: string;
  /** What proceeding would do. Definition-authored. */
  readonly impactSummary: string;
  /**
   * PLACEHOLDER. Always the number the definition declared, or zero.
   *
   * Rolling the child agent runs' real spend up into a forecast is token and
   * cost intelligence, which this part does not implement — and a field that
   * quietly reported a wrong number would be worse than one that reports the
   * declared estimate. The shape is here so it does not change when the numbers
   * arrive.
   */
  readonly estimatedAdditionalTokens: number;
  /** PLACEHOLDER, on the same terms. */
  readonly estimatedAdditionalCostMicroUsd: number;
  /**
   * Roles that may decide this, lower-cased.
   *
   * Resolved from the approval NODE at request time and frozen onto the record.
   * Reading it live from the registry at decision time would mean a definition
   * change could widen who may decide a request that is already pending.
   */
  readonly authorizedRoles: readonly string[];
  /** The run's checkpoint version when the approval was requested. */
  readonly checkpointVersion: number;
  /** The run version the park produced. See the header for how it is enforced. */
  readonly workflowRunVersion: number;
  /** The branch version the park produced. Present for branch approvals only. */
  readonly branchVersion?: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decision?: WorkflowApprovalDecision;
  readonly decisionReason?: string;
  /** Set exactly once, when the run spends it. Never cleared. */
  readonly consumedAt?: string;
  /** Always true. Present so the guarantee is readable on the record itself. */
  readonly singleUse: true;
  readonly approvalState: WorkflowApprovalState;
  /** What a rejection does. Frozen from the node, for the same reason as roles. */
  readonly onRejection: WorkflowRejectionPolicy;
  /** Optimistic concurrency for this approval alone. Starts at 1. */
  readonly approvalVersion: number;
  /** Why a non-decision closed it. Set on expiry and withdrawal. */
  readonly closureReason?: string;
  /** The typed failure a closure implies, when it implies one. */
  readonly failure?: WorkflowFailureCode;
}

/**
 * The position an approval authorises movement from.
 *
 * A value rather than four arguments, because every caller has to supply all
 * four together and a function that took them separately would eventually be
 * called with three.
 */
export interface WorkflowApprovalBinding {
  readonly nodeId: string;
  readonly branchId?: string;
  readonly checkpointVersion: number;
  readonly workflowRunVersion: number;
  readonly branchVersion?: number;
}

/** The durable pointer a parked run carries to the decision it is waiting on. */
export interface WorkflowPendingApproval {
  readonly workflowApprovalId: string;
  readonly nodeId: string;
  readonly branchId?: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
}

// ── Deterministic identity ──────────────────────────────────────────────────

/** The same separator, and the same reasoning, as `contracts/parallel.ts`. */
const ID_SEPARATOR = ':';

/**
 * An approval's id, from durable facts alone.
 *
 * No clock, no counter, no random source — so an isolate that died between
 * writing the approval and parking the run recomputes the IDENTICAL id on its
 * next pass and adopts the request that already exists, rather than minting a
 * second one and leaving an orphan at the top of somebody's queue.
 *
 * `checkpointVersion` is inside it because it is what makes one visit to an
 * approval node distinguishable from the next. A run that loops back to the
 * same approval node has written at least one checkpoint in between — every
 * completed node does — so the second visit asks a NEW question rather than
 * finding the first one already consumed. Without it, "approve once, loop
 * forever" would be a shape this file permitted.
 */
export function workflowApprovalIdFor(
  workflowRunId: string,
  nodeId: string,
  branchId: string | undefined,
  checkpointVersion: number,
): string {
  return [
    'wfa',
    workflowRunId,
    nodeId,
    branchId ?? 'main',
    String(Math.max(0, Math.floor(checkpointVersion))),
  ].join(ID_SEPARATOR);
}

// ── Bounds ──────────────────────────────────────────────────────────────────

/**
 * Ceilings on an approval.
 *
 * `expiresAfterMs.max` is one day rather than a week: an approval holds a
 * workflow run, its cursor, its checkpoint chain and an operator's attention
 * for as long as it is pending, and the run's own `deadlineAt` is at most an
 * hour anyway — a longer approval window would be a window the run cannot
 * survive, which reads as an option and is not one.
 */
export const WORKFLOW_APPROVAL_BOUNDS = {
  expiresAfterMs: { min: 60_000, max: 86_400_000, default: 3_600_000 },
  reason: { min: 3, max: 300 },
  impactSummary: { min: 3, max: 500 },
  decisionReason: { min: 3, max: 300 },
  approverRoles: { min: 1, max: 8 },
  /** Approvals one run may request, across every node and every branch. */
  maxPerRun: 32,
  estimate: { min: 0, max: 100_000_000 },
} as const;

/** Approver roles share the platform's role grammar: lower-case identifiers. */
export const WORKFLOW_APPROVER_ROLE_PATTERN = /^[a-z][a-z0-9_]*$/;
