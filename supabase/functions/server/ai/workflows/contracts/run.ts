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
 * ── WHAT PART 2 CARRIES BUT DOES NOT CONSUME ───────────────────────────────
 *
 * `WorkflowPlanStep.maxAttempts` is planned, persisted and reported, and it is
 * never spent: Part 2 implements NO retries, so every node gets exactly one
 * attempt and every step record says `attempt: 1`. Carrying the ceiling without
 * acting on it is deliberate — the plan is the reviewed artefact, and dropping
 * a field from it because this part does not use it would mean re-planning when
 * retries arrive.
 */

import type { WorkflowFailureCode } from './failures.ts';

// ── States ──────────────────────────────────────────────────────────────────

/**
 * Eleven states, and the two that do not exist are as deliberate as the nine
 * that do: there is no `waiting_for_approval` and no `retrying`, because
 * workflow approvals and retries are not in this part. A state nothing can
 * reach is a state an operator has to ask about.
 */
export const WORKFLOW_RUN_STATES = [
  'created',
  'validating',
  'ready',
  'running',
  'waiting_for_agent',
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
  /** Position in the plan. Matches `WorkflowPlanStep.index`. */
  readonly sequence: number;
  readonly nodeId: string;
  readonly agentId: string;
  /** The child agent run this node drove. The join key into Batch 3A. */
  readonly childAgentRunId: string;
  /** Terminal state of the child run, verbatim from the agent runtime. */
  readonly childState: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
  readonly outcome: 'completed' | 'failed' | 'cancelled';
  /** Always 1 in Part 2 — there are no retries. Persisted for Part 3. */
  readonly attempt: number;
  /** Digest of the child's accepted output. Never the output. */
  readonly resultDigest?: string;
  readonly failure?: WorkflowFailureCode;
  /** Checkpoint pointer this step produced. */
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
  /** Every child agent run this workflow has created, in order. */
  readonly childAgentRunIds: readonly string[];
  readonly steps: readonly WorkflowStepRecord[];
  readonly transitions: readonly WorkflowTransitionRecord[];
  /** Transitions dropped from the ring. Non-zero means history is partial. */
  readonly transitionsTruncated: number;
  /**
   * The recovery pointer: incremented on every durable write that advances the
   * run past a node.
   *
   * There is deliberately NO separate checkpoint store in Part 2. Batch 3A
   * needed one because agent progress is a large, chained, immutable payload
   * that a run resumes INTO. A workflow's recoverable state is three small
   * fields — the cursor, the pending child and the completed steps — and they
   * are already written atomically with the record under one version. A second
   * store would be a second thing to keep consistent with the first, and the
   * only guarantee it could add is one the run record already provides.
   */
  readonly checkpointVersion: number;
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
  /** Steps a record keeps. Equal to Part 1's node ceiling — a node runs once. */
  maxStepHistory: 64,
  /**
   * Ceiling on the canonical size of the stored input. Matches the agent
   * runtime's checkpoint progress bound, because the two hold the same kind of
   * thing for the same reason and a workflow input is handed to an agent run.
   */
  maxInputBytes: 32 * 1024,
} as const;
