/**
 * Workflow runtime contracts (AI-01 Batch 3B): what a workflow run IS, durably.
 *
 * THE SAME NON-NEGOTIABLE PROPERTY THE AGENT RUN RECORD HAS. None of this lives
 * in isolate memory. A workflow may span minutes, several agent runs and at
 * least one human decision; an edge isolate is recycled without warning, and a
 * plan whose authority is a module-level `Map` restarts from nothing every time
 * that happens. The record below is the whole of the run — its plan, its wave
 * pointer, its per-node state, its fact map, its ledgers and its checkpoint
 * pointer — written as one value under one key with one version.
 *
 * IT DELEGATES ITS LEDGERS. `AgentTokenLedger`, `AgentCostLedger` and
 * `OptimizationLedger` are reused verbatim rather than re-declared. A workflow's
 * spend IS the sum of the agent runs it started, and a second ledger shape for
 * the same money would be a second thing that can disagree with the invoice.
 *
 * NO RAW CONTENT, AND THE FACT MAP IS WHERE THAT RULE IS EASIEST TO BREAK. A
 * workflow needs values to flow from one node to the next, and the obvious
 * implementation — carry each node's output forward — would turn the run record
 * into a durable copy of every client's business data. So what flows is a
 * bounded map of SCALARS a node explicitly declared it publishes, each capped in
 * length. Everything else is a digest.
 */

import type {
  AgentCostLedger,
  AgentTokenLedger,
} from '../../agents/contracts/runtime.ts';
import type { OptimizationLedger } from '../../optimization/optimizationLedger.ts';
import type { WorkflowFailureCode } from './failures.ts';

// ── States ──────────────────────────────────────────────────────────────────

export const WORKFLOW_RUN_STATES = [
  'created',
  'planning',
  'planned',
  'running',
  'waiting_for_agent',
  'waiting_for_approval',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'expired',
  'budget_exhausted',
  'policy_denied',
] as const;

export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[number];

/** States from which nothing further happens, ever. */
export const TERMINAL_WORKFLOW_STATES: readonly WorkflowRunState[] = [
  'completed',
  'failed',
  'cancelled',
  'expired',
  'budget_exhausted',
  'policy_denied',
];

export function isTerminalWorkflowState(state: WorkflowRunState): boolean {
  return TERMINAL_WORKFLOW_STATES.includes(state);
}

/** Operations a caller — human or orchestrator — can request of a workflow run. */
export const WORKFLOW_RUN_OPERATIONS = [
  'start',
  'pause',
  'resume',
  'cancel',
  'approve',
  'reject',
  'expire',
  'complete',
  'fail',
] as const;

export type WorkflowRunOperation = (typeof WORKFLOW_RUN_OPERATIONS)[number];

// ── Node state ──────────────────────────────────────────────────────────────

/**
 * Where one node stands.
 *
 * `skipped` and `failed` are deliberately different terminal answers. A node
 * whose guard did not hold did not fail — the plan decided it was not needed,
 * and a downstream `any` join must be able to tell the two apart.
 */
export const WORKFLOW_NODE_STATES = [
  'pending',
  'blocked',
  'ready',
  'running',
  'waiting_for_approval',
  'succeeded',
  'failed',
  'skipped',
] as const;

export type WorkflowNodeState = (typeof WORKFLOW_NODE_STATES)[number];

export function isSettledNodeState(state: WorkflowNodeState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'skipped';
}

export interface WorkflowNodeRecord {
  readonly nodeId: string;
  readonly state: WorkflowNodeState;
  /** Wave the planner placed this node in. Fixed at planning time. */
  readonly wave: number;
  /** Times this node has been executed. Bounded by the run's execution ceiling. */
  readonly attempts: number;
  readonly startedAt?: string;
  readonly settledAt?: string;
  readonly latencyMs: number;
  /** The agent run this node drove, when the node is an agent node. */
  readonly agentRunId?: string;
  /** The approval this node is or was blocked on. */
  readonly approvalId?: string;
  /** Digest of the node's result. Never the result itself. */
  readonly outputDigest?: string;
  readonly failure?: WorkflowFailureCode;
  /** Caller-safe explanation. Never a provider or storage message. */
  readonly failureMessage?: string;
  /** Why the node was skipped, when it was. A condition or a join. */
  readonly skipReason?: string;
  readonly tokensUsed: number;
  readonly costMicroUsd: number;
  /** Micro-USD this node's work avoided. Reported apart from cost. */
  readonly avoidedMicroUsd: number;
}

// ── Facts ───────────────────────────────────────────────────────────────────

/** A published fact. Scalars only, bounded, and never a structure. */
export type WorkflowFactValue = string | number | boolean;

export type WorkflowFactMap = Readonly<Record<string, WorkflowFactValue>>;

// ── Identity and context ────────────────────────────────────────────────────

export interface WorkflowRunOrigin {
  readonly surface: 'team_console' | 'client_portal' | 'system';
  /** Product feature that initiated the run. Bounded label. */
  readonly feature: string;
}

export interface WorkflowRunContext {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly correlationId: string;
  /** The API request that created or last advanced the run. */
  readonly requestId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly actorRoles: readonly string[];
  readonly origin: WorkflowRunOrigin;
}

// ── History ─────────────────────────────────────────────────────────────────

export interface WorkflowTransitionRecord {
  readonly at: string;
  readonly from: WorkflowRunState;
  readonly to: WorkflowRunState;
  readonly operation: WorkflowRunOperation | 'wave';
  /** Bounded explanation. Written into the audit trail verbatim. */
  readonly reason: string;
  readonly actorId: string;
  readonly runVersion: number;
  readonly failure?: WorkflowFailureCode;
}

/** How many transitions a record keeps before it drops the oldest. */
export const MAX_WORKFLOW_TRANSITIONS = 96;

// ── The plan ────────────────────────────────────────────────────────────────

/**
 * The frozen execution order.
 *
 * Produced once, at planning time, and persisted with a digest. It is never
 * recomputed mid-run: a plan that could change between waves would mean a run
 * whose resumed half executed a different workflow from its first half, and the
 * digest is what makes that claim checkable rather than assumed.
 */
export interface WorkflowPlan {
  /** Node ids grouped into waves. Every node in a wave may run in parallel. */
  readonly waves: readonly (readonly string[])[];
  /** Concurrency ceiling the planner applied when it grouped the waves. */
  readonly maxParallel: number;
  readonly nodeCount: number;
  readonly digest: string;
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
  readonly plan: WorkflowPlan;
  /** Digest of the plan as it was accepted. A resumed run proves it is the same. */
  readonly planDigest: string;
  /** Wave the run is currently working through. Zero-based. */
  readonly currentWave: number;
  /** Node executions performed. Bounded by the definition's ceiling. */
  readonly nodeExecutions: number;
  /** nodeId → its record. One entry per declared node, always. */
  readonly nodes: Readonly<Record<string, WorkflowNodeRecord>>;
  readonly facts: WorkflowFactMap;
  /** Agent runs this workflow started, in order. The join to the agent trail. */
  readonly agentRunIds: readonly string[];
  readonly tokens: AgentTokenLedger;
  readonly cost: AgentCostLedger;
  readonly optimization: OptimizationLedger;
  /** Approval the run is currently blocked on, if any. */
  readonly pendingApprovalId?: string;
  /** Node that opened the pending approval. */
  readonly pendingApprovalNodeId?: string;
  readonly approvalsOpened: number;
  /** Latest checkpoint version written. The resume point. */
  readonly checkpointVersion: number;
  /** Operational settings version in force when the run was created. */
  readonly configurationVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Wall-clock deadline. Enforced before every wave. */
  readonly deadlineAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly elapsedRuntimeMs: number;
  readonly transitions: readonly WorkflowTransitionRecord[];
  /** Transitions dropped from the ring. Non-zero means history is partial. */
  readonly transitionsTruncated: number;
  readonly failure?: WorkflowFailureCode;
  readonly failureMessage?: string;
  /** Terminal node the plan reached, when it reached one. */
  readonly terminalNodeId?: string;
}

// ── Checkpoints ─────────────────────────────────────────────────────────────

/**
 * An immutable point a workflow run can be resumed from.
 *
 * Written after every wave, before the state change is persisted. Versions are
 * monotonic and never rewritten — the store refuses a version that already
 * exists — so "resume from the last valid checkpoint" is a real operation rather
 * than a hope.
 */
export interface WorkflowCheckpoint {
  readonly workflowRunId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly state: WorkflowRunState;
  readonly wave: number;
  /** Node states as of this checkpoint. Bounded by the node count. */
  readonly nodes: Readonly<Record<string, WorkflowNodeState>>;
  readonly facts: WorkflowFactMap;
  readonly factsDigest: string;
  /** Digest of the previous checkpoint, so the chain is verifiable. */
  readonly previousDigest?: string;
}

export const WORKFLOW_CHECKPOINT_BOUNDS = {
  maxFactBytes: 16 * 1024,
} as const;
