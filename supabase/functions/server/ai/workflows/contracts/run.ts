/**
 * Workflow run contracts (AI-01 Batch 3B, Part 2): what a workflow run IS,
 * durably.
 *
 * The same property that made `agents/contracts/runtime.ts` the centre of Batch
 * 3A is the centre of this file: NONE OF IT LIVES IN ISOLATE MEMORY. An edge
 * isolate is recycled without warning, and a workflow engine whose authority is
 * a module-level `Map` would rediscover an empty world mid-run — which for a
 * three-node workflow means re-running node one after node two already had its
 * effect.
 *
 * So the run record below is the whole of the run: identity, plan binding,
 * state, cursor, child runs, step history, failure, result and deadline,
 * written as one value under one key with one version. A node that has not been
 * persisted has not happened.
 *
 * ── THE PLAN BINDING IS PART OF THE IDENTITY ───────────────────────────────
 *
 * `workflowVersion` and `planDigest` are on the context, not derived at each
 * step, because a deployment can change a definition between two nodes of a
 * live run. A run that started against a three-node chain must not silently
 * finish against a two-node one, so the digest it was admitted with is carried
 * and re-checked. That is the whole reason Part 1 made the digest stable.
 *
 * ── ONE PIECE OF CONTENT, AND WHY IT IS THE ONLY ONE ───────────────────────
 *
 * Outputs, agent observations, prompts, completions and tool payloads never
 * enter a run record. Digests do. Same decision as Batch 1's audit trail and
 * Batch 3A's run record, for the same reason: durable storage that accumulates
 * client business data is a liability that grows on its own.
 *
 * The run's own INPUT is the exception, and it is a required one. Every node is
 * handed the input the run was created with, so a node started after an isolate
 * restart must be able to receive it — and the only alternatives are reading it
 * back out of the first child agent run (reaching into agent internals, which
 * this batch forbids) or requiring every caller to re-send it on every advance
 * (which would make a background driver impossible). Batch 3A made the same
 * call for the same reason: an agent run's input lives on its checkpoint.
 *
 * It is bounded (`WORKFLOW_RUN_BOUNDS.maxInputBytes`) and it is validated
 * against the workflow's own `inputContract` before it is written, so what is
 * stored is a shape the workflow declared rather than whatever a caller sent.
 *
 * ── WHAT PART 5 ADDS, AND WHY IT IS ON THIS RECORD ─────────────────────────
 *
 * `pendingApproval` and `retries`. Both are here rather than in a store of
 * their own for the reason the header opens with: they are read before the
 * engine acts, written in the same compare-and-swap as the state change they
 * accompany, and a second store would be a second thing to keep consistent
 * with the run's version.
 *
 * The approval RECORD does live in its own store — it is decided by people who
 * are not driving the run, it outlives any single advance, and it is queried by
 * an operator queue that must not have to read every run. What is here is the
 * POINTER, exactly as `checkpointVersion` is the pointer to the chain.
 *
 * `WorkflowPlanStep.maxAttempts` — planned, persisted and reported by Parts
 * 1–4 and never spent — is spent from Part 5 onwards. `attempt` on a step
 * record is therefore no longer always 1, and the field that was carried for
 * four parts did not have to change shape to start meaning something.
 */

import type { WorkflowFailureCode } from './failures.ts';
import type { WorkflowParallelGroup } from './parallel.ts';
import type { WorkflowPendingApproval } from './approval.ts';
import type { WorkflowApprovalDecision } from './approval.ts';
import type { WorkflowNodeAttempt } from './retry.ts';

// ── States ──────────────────────────────────────────────────────────────────

/**
 * Thirteen states, and the one that still does not exist is as deliberate as
 * the ones that do: THERE IS NO `retrying`.
 *
 * A node awaiting its next attempt is `running` with its cursor still on that
 * node and a durable attempt record saying when the attempt becomes eligible.
 * A separate state would claim the run is doing something it is not — nothing
 * is in flight, no child exists, and the only thing distinguishing it from any
 * other run sitting between nodes is a timestamp that is already on the record.
 *
 * Part 4 adds `waiting_for_branches`, and it is a state rather than a flag on
 * `waiting_for_agent` because the two are operationally different: one run is
 * waiting on ONE child it can name in `pendingNode`, the other is waiting on
 * several, each with its own cursor and its own child. Collapsing them would
 * make "which child is this run waiting on" a question with no single answer
 * while the field that is supposed to answer it stays empty.
 *
 * Part 5 adds `waiting_for_approval`, and it is a state for a sharper reason
 * than either of those: it is the only state in which the thing a run is
 * waiting for is A PERSON. Every other wait resolves by driving something —
 * poll the child, sweep the branches — and this one resolves only when somebody
 * with the right role decides. An operator scanning a state count has to be
 * able to tell "stuck on infrastructure" from "stuck on us", and a run parked
 * on a human inside `waiting_for_agent` would be indistinguishable from one
 * waiting on a slow model.
 *
 * It is also the state a run may NOT be paused out of — see
 * `runtime/workflowStateMachine.ts` for why, which is the same reason Batch 3A
 * gave for its own approval gate.
 */
export const WORKFLOW_RUN_STATES = [
  'created',
  'validating',
  'ready',
  'running',
  'waiting_for_agent',
  'waiting_for_branches',
  'waiting_for_approval',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'expired',
  'policy_denied',
] as const;

export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[number];

/** States from which nothing further happens, ever. */
export const TERMINAL_WORKFLOW_STATES: readonly WorkflowRunState[] = [
  'completed',
  'failed',
  'cancelled',
  'expired',
  'policy_denied',
];

export function isTerminalWorkflowState(state: WorkflowRunState): boolean {
  return TERMINAL_WORKFLOW_STATES.includes(state);
}

/** Operations a caller — human or engine — can request of a workflow run. */
export const WORKFLOW_RUN_OPERATIONS = [
  'start',
  'pause',
  'resume',
  'cancel',
  'expire',
  'complete',
  'fail',
] as const;

export type WorkflowRunOperation = (typeof WORKFLOW_RUN_OPERATIONS)[number];

// ── Identity and context ────────────────────────────────────────────────────

/**
 * Where the run came from. Recorded, never trusted for authority: the surface
 * says how a request arrived, the authenticated subject says who it was.
 */
export interface WorkflowRunOrigin {
  readonly surface: 'team_console' | 'client_portal' | 'system';
  /** Product feature that initiated the run. Bounded label. */
  readonly feature: string;
}

/**
 * The server-created execution context. Every field is resolved server-side;
 * nothing here can be asserted by a caller.
 */
export interface WorkflowRunContext {
  readonly workflowRunId: string;
  readonly correlationId: string;
  /** The API request that created or last advanced the run. */
  readonly requestId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly actorRoles: readonly string[];
  readonly origin: WorkflowRunOrigin;
  readonly workflowId: string;
  /** The definition version the run was admitted against. */
  readonly workflowVersion: string;
  /** The plan digest the run was admitted against. Re-checked at validation. */
  readonly planDigest: string;
}

// ── History ─────────────────────────────────────────────────────────────────

export interface WorkflowTransitionRecord {
  readonly at: string;
  readonly from: WorkflowRunState;
  readonly to: WorkflowRunState;
  readonly operation: WorkflowRunOperation | 'step';
  /** Bounded explanation. */
  readonly reason: string;
  readonly actorId: string;
  /** Run version this transition produced. */
  readonly runVersion: number;
  readonly failure?: WorkflowFailureCode;
}

/**
 * One node, once. Written when the node reaches a terminal outcome, so the
 * history is a record of what HAPPENED rather than of what was attempted.
 */
export interface WorkflowStepRecord {
  readonly stepId: string;
  /**
   * Execution ordinal within the run, starting at zero.
   *
   * NOT the plan index. Part 3 introduced loops, so one plan node can execute
   * several times and a position in the plan no longer identifies an execution.
   * `planIndex` carries the plan position; this carries the order things
   * actually happened in, which is what a reader following an incident needs.
   */
  readonly sequence: number;
  /** Position in the plan enumeration. Stable across executions of a node. */
  readonly planIndex: number;
  readonly nodeId: string;
  readonly kind: 'agent' | 'condition' | 'parallel' | 'join' | 'approval';
  /** Which visit of this node this was, starting at 1. */
  readonly iteration: number;
  /** Agent nodes only. */
  readonly agentId?: string;
  /** The child agent run this node drove. The join key into Batch 3A. */
  readonly childAgentRunId?: string;
  /** Terminal state of the child run, verbatim from the agent runtime. */
  readonly childState?: string;
  /** Condition nodes only: which branch the expression selected. */
  readonly branchTaken?: boolean;
  /** Condition nodes only: the node the branch led to. */
  readonly branchNodeId?: string;
  /**
   * Set when this step ran INSIDE a parallel branch (AI-01 Batch 3B, Part 4).
   *
   * A run's step history is one list, in the order things actually happened, so
   * branch work and main-line work interleave in it. Without these two fields a
   * reader could not tell which line of execution a step belonged to — and with
   * them the same list answers both "what happened, in order" and "what did the
   * `enrichment` branch do", which are the two questions an incident asks.
   */
  readonly branchId?: string;
  readonly branchName?: string;
  /** Join nodes only: how many branches contributed to the merge. */
  readonly mergedBranchCount?: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
  readonly outcome: 'completed' | 'failed' | 'cancelled';
  /**
   * Which attempt of this node produced this step, starting at 1.
   *
   * Parts 2–4 wrote 1 here always, because no node got a second attempt. From
   * Part 5 a retried node writes ONE STEP PER ATTEMPT — the failed ones with
   * `outcome: 'failed'` and the successful one with `outcome: 'completed'` —
   * so the history says what actually happened rather than reporting only the
   * attempt that worked. `iteration` still counts VISITS to the node (a loop
   * coming back round); `attempt` counts tries within one visit.
   */
  readonly attempt: number;
  /**
   * Why a failed attempt failed, in retry vocabulary (Part 5).
   *
   * Recorded on the step rather than only on the attempt record, because the
   * attempt record is overwritten by the next try and the step history is not:
   * "this node failed twice on the provider and once on a budget" is a
   * question only the history can answer.
   */
  readonly failureClass?: string;
  /** Whether a retry was scheduled after this attempt. */
  readonly retryScheduled?: boolean;
  /** Approval nodes only: the decision record this step spent. */
  readonly workflowApprovalId?: string;
  /** Approval nodes only: what the approver said. */
  readonly approvalDecision?: WorkflowApprovalDecision;
  /**
   * Digest of the TRUSTED output this step stored, or of the child's accepted
   * output when the node declared no output contract.
   *
   * A digest, never the value. This is the data-flow audit metadata: a reader
   * can prove which value a later condition branched on without the run record
   * ever holding it.
   */
  readonly resultDigest?: string;
  readonly failure?: WorkflowFailureCode;
  /** Checkpoint version this step produced. */
  readonly checkpointVersion: number;
}

/**
 * The node currently in flight, and the durable half of restart recovery.
 *
 * Written BEFORE the child run is advanced, so an isolate that dies mid-node
 * comes back knowing which agent run to poll rather than starting the node
 * again. Cleared the moment the node reaches a terminal outcome.
 */
export interface WorkflowPendingNode {
  readonly nodeId: string;
  readonly agentId: string;
  readonly agentRunId: string;
  readonly startedAt: string;
  /** Plan index, so recovery can verify the cursor without re-planning. */
  readonly sequence: number;
  /**
   * Which attempt this child belongs to, starting at 1 (Part 5).
   *
   * On the POINTER rather than derived from the attempt record, so a recovered
   * isolate that drives this child knows which attempt it is completing without
   * having to reconcile two sources. It is written in the same versioned write
   * that creates the pointer, which is what makes the number a fact about this
   * child rather than about whatever the counter says later.
   */
  readonly attempt: number;
}

// ── The run record ──────────────────────────────────────────────────────────

export interface WorkflowRunRecord {
  readonly context: WorkflowRunContext;
  /**
   * Optimistic concurrency version. Every persisted mutation increments it, and
   * a write that does not carry the version it read is refused by the store.
   */
  readonly runVersion: number;
  readonly state: WorkflowRunState;
  /** The node the cursor is on. Absent before `ready` and after a terminal. */
  readonly currentNodeId?: string;
  /** Nodes completed. Never decremented, never skipped ahead. */
  readonly stepCount: number;
  readonly pendingNode?: WorkflowPendingNode;
  /**
   * Every parallel step this run has executed, open and closed (Part 4).
   *
   * THE AUTHORITY FOR BRANCH STATE. Not a cache of it, not a projection of it —
   * the branches live here, on the versioned record, written through the same
   * compare-and-swap as everything else. There is no module-level map of
   * in-flight branches anywhere in the engine, which is the property that makes
   * a recycled isolate able to resume a fan-out rather than restart it.
   *
   * At most one group is `open` at a time: nested parallelism is refused at
   * planning, so a run is either between parallel steps or inside exactly one.
   * Closed groups are kept as evidence — what each branch did, which ones the
   * join accepted, and the digest of what they merged to.
   */
  readonly parallelGroups: readonly WorkflowParallelGroup[];
  /**
   * The decision this run is parked on, or none (AI-01 Batch 3B, Part 5).
   *
   * Written in the SAME versioned transition that moves the run to
   * `waiting_for_approval`, and only after the approval record itself is
   * durable — so a run is never parked on a request that does not exist, and a
   * request never exists for a run that is not parked on it for longer than one
   * crashed advance. Cleared when the approval is spent, and left alone by
   * everything else: a paused run cannot reach this state and a terminal one
   * has had its request withdrawn.
   */
  readonly pendingApproval?: WorkflowPendingApproval;
  /**
   * Attempt state per node, per line of execution (AI-01 Batch 3B, Part 5).
   *
   * THE AUTHORITY FOR RETRY COUNTS, on the same terms as `parallelGroups`: a
   * versioned field on a compare-and-swapped record, with no module-level
   * counter anywhere in the engine. A node that has never failed has no entry —
   * see `contracts/retry.ts` for why absence rather than a zero row.
   *
   * Deliberately absent from the checkpoint chain. An attempt count legitimately
   * differs between a crashed attempt and its retry, and a digest that moved
   * with it would turn the engine's idempotent checkpoint re-write into a
   * permanent conflict — the same reasoning that keeps `pendingNode` out.
   */
  readonly retries: readonly WorkflowNodeAttempt[];
  /** Every child agent run this workflow has created, in order. */
  readonly childAgentRunIds: readonly string[];
  readonly steps: readonly WorkflowStepRecord[];
  readonly transitions: readonly WorkflowTransitionRecord[];
  /** Transitions dropped from the ring. Non-zero means history is partial. */
  readonly transitionsTruncated: number;
  /**
   * The recovery pointer: the version of the latest checkpoint this run wrote.
   *
   * Part 2 held no checkpoints and this was a bare counter. Part 3 made node
   * outputs durable state that conditions branch on, so it now NAMES a record
   * in the append-only checkpoint store — see `contracts/checkpoint.ts` for why
   * the facts changed and `persistence/ports.ts` for the two contracts.
   */
  readonly checkpointVersion: number;
  /**
   * The digest of that checkpoint, so the pointer is verifiable.
   *
   * Without it, recovery would trust whatever the store returned for "the
   * latest version". With it, a run can only be resumed from a checkpoint whose
   * content still hashes to what the run recorded when it wrote it — and the
   * chain behind that checkpoint is verified too. Absent before the first node
   * completes.
   */
  readonly checkpointDigest?: string;
  /**
   * The validated run input, as every node receives it.
   *
   * Bounded and contract-checked before it is written — see the header for why
   * this is the one content field a workflow record carries.
   */
  readonly input: unknown;
  /** Digest of `input`, so a reader can compare without walking the value. */
  readonly inputDigest: string;
  /** Digest of the final node's output. Set only on completion. */
  readonly resultDigest?: string;
  readonly failure?: WorkflowFailureCode;
  /** Caller-safe failure message. Never a provider or storage message. */
  readonly failureMessage?: string;
  /** Operational settings version in force when the run was created. */
  readonly configurationVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Wall-clock deadline. Enforced before every node. */
  readonly deadlineAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly elapsedRuntimeMs: number;
}

/** How many transitions a record keeps before it starts dropping the oldest. */
export const MAX_WORKFLOW_TRANSITION_HISTORY = 128;

/**
 * Ceilings on a run.
 *
 * `maxRuntimeMs` bounds the deadline a caller may ask for. A workflow whose
 * deadline is a week away is a workflow that holds a cursor, a pending child
 * and an operator's attention for a week, and the store is not sized for it.
 */
export const WORKFLOW_RUN_BOUNDS = {
  runtimeMs: { min: 1_000, max: 3_600_000, default: 900_000 },
  /**
   * Node executions one run may spend, across every node and every loop pass.
   *
   * THE run-wide ceiling, and the one that makes bounded loops actually
   * bounded. A per-loop ceiling caps one loop; nested loops multiply, and three
   * of thirty-two around one node is thirty-two thousand agent runs while every
   * individual bound is respected. This is checked before each node executes,
   * so the multiplication cannot happen.
   *
   * It also bounds everything sized off it: the step history, the checkpoint
   * chain the recovery path verifies, and the engine's drive loop.
   */
  maxNodeExecutions: 256,
  /** Steps a record keeps. Equal to the execution ceiling — one step each. */
  maxStepHistory: 256,
  /** Checkpoints a run may write. One per node execution. */
  maxCheckpoints: 256,
  /**
   * Ceiling on the canonical size of the stored input. Matches the agent
   * runtime's checkpoint progress bound, because the two hold the same kind of
   * thing for the same reason and a workflow input is handed to an agent run.
   */
  maxInputBytes: 32 * 1024,
} as const;
