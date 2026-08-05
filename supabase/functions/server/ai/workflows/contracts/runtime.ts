/**
 * Workflow runtime contracts (AI-01 Batch 3B): what a workflow run IS, durably.
 *
 * The single most important property in this file is that none of it lives in
 * isolate memory. An edge isolate is recycled without warning, and a runtime
 * whose authority is a module-level `Map` rediscovers an empty world every time
 * that happens — which for a join means "no branch ever finished" and for a
 * cost ledger means "we have spent nothing".
 *
 * So the run record below is the whole of the run: identity, state, current
 * node, branch table, join table, node history, child agent runs, ledgers,
 * optimization decisions and checkpoint pointer, written as one value under one
 * key with one version. A node that has not been persisted has not happened.
 *
 * BOUNDED BY CONSTRUCTION. Every array has a cap, and the caps are not
 * decorative — `WORKFLOW_LIMIT_BOUNDS` bounds the limits themselves, so a
 * registered workflow cannot ask for a history the record cannot hold. The two
 * places that can still grow with operator action (state transitions, from
 * repeated pause/resume) carry an explicit ring and a truncation counter, so
 * the record states plainly that it is not the complete history rather than
 * quietly pretending it is.
 *
 * NO RAW CONTENT. Prompts, completions, tool payloads and model outputs never
 * enter a run record. Digests do, plus the bounded, validated values a node's
 * output mapping produced — which are the workflow's own typed scratch space,
 * not a copy of a provider response. That is the same decision Batches 1 and 3A
 * made, for the same reason.
 */

import type { WorkflowFailureCode } from './failures.ts';
import type { WorkflowNodeType } from './workflow.ts';

// ── States ──────────────────────────────────────────────────────────────────

export const WORKFLOW_RUN_STATES = [
  'created',
  'validating',
  'planned',
  'ready',
  'running',
  'waiting_for_agent',
  'waiting_for_tool',
  'waiting_for_model',
  'waiting_for_parallel',
  'waiting_for_join',
  'waiting_for_approval',
  'paused',
  'retrying',
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

/** Operations a caller — human or engine — can request of a workflow run. */
export const WORKFLOW_RUN_OPERATIONS = [
  'start',
  'pause',
  'resume',
  'cancel',
  'retry',
  'approve',
  'reject',
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
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly correlationId: string;
  /** The API request that created or last advanced the run. */
  readonly requestId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly actorRoles: readonly string[];
  readonly origin: WorkflowRunOrigin;
  /** Set when this run was created by another workflow run. */
  readonly parentWorkflowRunId?: string;
}

// ── Branches ────────────────────────────────────────────────────────────────

export type WorkflowBranchState =
  | 'pending'
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * One arm of a fan-out.
 *
 * Branch-local counters and ledgers are not bookkeeping decoration: a join with
 * a `minimum_successes` policy has to know which arms succeeded and what each
 * one cost, and a shared counter cannot answer either question. The shared
 * WORKFLOW budget is still the ceiling — a branch's allowance is a share of it,
 * never an addition to it.
 */
export interface WorkflowBranchRecord {
  readonly branchId: string;
  /** The `parallel` node that opened this branch. */
  readonly parallelNodeId: string;
  /** The `join` node this branch converges on. */
  readonly joinNodeId: string;
  /** Set when this branch was opened inside another branch. */
  readonly parentBranchId?: string;
  readonly depth: number;
  readonly state: WorkflowBranchState;
  /** Node the branch is at. Undefined once the branch has finished. */
  readonly currentNodeId?: string;
  readonly stepCount: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costMicroUsd: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly failure?: WorkflowFailureCode;
}

/**
 * A join's durable state.
 *
 * The expected branch set comes from the PLAN, not from what has arrived. That
 * ordering is what makes "this join can never be satisfied" a detectable
 * condition rather than a run that waits forever, and it is what lets a
 * duplicate arrival be recognised as duplicate.
 */
export interface WorkflowJoinRecord {
  readonly joinNodeId: string;
  readonly expectedBranchIds: readonly string[];
  readonly arrivedBranchIds: readonly string[];
  readonly succeededBranchIds: readonly string[];
  readonly failedBranchIds: readonly string[];
  readonly cancelledBranchIds: readonly string[];
  /** True once the join has fired. A join never fires twice. */
  readonly satisfied: boolean;
  readonly satisfiedAt?: string;
}

// ── History ─────────────────────────────────────────────────────────────────

export interface WorkflowTransitionRecord {
  readonly at: string;
  readonly from: WorkflowRunState;
  readonly to: WorkflowRunState;
  readonly operation: WorkflowRunOperation | 'step';
  /** Bounded explanation. Written into the audit trail verbatim. */
  readonly reason: string;
  readonly actorId: string;
  /** Run version this transition produced. */
  readonly runVersion: number;
  readonly failure?: WorkflowFailureCode;
}

export type WorkflowNodeOutcome =
  | 'executed'
  | 'skipped'
  | 'cached'
  | 'denied'
  | 'failed'
  | 'awaiting_approval'
  | 'waiting';

export interface WorkflowNodeRecord {
  readonly nodeExecutionId: string;
  readonly sequence: number;
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  /** Undefined on the main path; set for a node executed inside a branch. */
  readonly branchId?: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
  readonly outcome: WorkflowNodeOutcome;
  readonly failure?: WorkflowFailureCode;
  /** Digest of the node's resolved input. Never the input itself. */
  readonly inputDigest: string;
  /** Digest of the node's output. Never the output itself. */
  readonly outputDigest?: string;
  readonly estimatedPromptTokens: number;
  readonly estimatedCompletionTokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly actualPromptTokens?: number;
  readonly actualCompletionTokens?: number;
  readonly cachedTokens?: number;
  readonly actualCostMicroUsd?: number;
  /** Control plane request id for a model node. The audit join key. */
  readonly executionRequestId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly modelProfileId?: string;
  readonly toolId?: string;
  readonly agentId?: string;
  readonly childAgentRunId?: string;
  readonly workflowApprovalId?: string;
  /** Which edge the node took out. Absent for a terminal node. */
  readonly nextNodeId?: string;
  readonly checkpointVersion: number;
}

// ── Ledgers ─────────────────────────────────────────────────────────────────

/**
 * One attribution row. The dimensions are exactly the ones an invoice
 * reconciliation and a per-workflow cost report ask for, and they are bounded:
 * a run cannot produce more rows than it takes steps.
 */
export interface WorkflowUsageAttribution {
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  readonly agentId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelProfileId: string;
  readonly feature: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly calls: number;
}

export interface WorkflowTokenLedger {
  readonly estimatedPromptTokens: number;
  readonly estimatedCompletionTokens: number;
  readonly estimatedTotalTokens: number;
  readonly actualPromptTokens: number;
  readonly actualCompletionTokens: number;
  readonly cachedTokens: number;
  readonly actualTotalTokens: number;
  /** Tokens a call never spent because it was optimized away. */
  readonly avoidedTokens: number;
  /** actual − estimate, summed over reconciled nodes. Signed. */
  readonly reconciliationVarianceTokens: number;
  readonly attribution: readonly WorkflowUsageAttribution[];
}

export interface WorkflowCostLedger {
  readonly estimatedMicroUsd: number;
  readonly actualMicroUsd: number;
  /** Estimate held for the node currently in flight. Zero between nodes. */
  readonly reservedMicroUsd: number;
  /** Micro-USD a call never spent because it was optimized away. */
  readonly avoidedMicroUsd: number;
  readonly reconciliationVarianceMicroUsd: number;
}

// ── Optimization, routing and cache decisions ───────────────────────────────

/**
 * What the token optimizer did to one node's context, recorded per node.
 *
 * Every field is a difference between two measured estimates, never an
 * assertion. "We saved 400 tokens" is only meaningful next to "the unoptimized
 * context was 1,900 tokens", and both numbers are here.
 */
export interface WorkflowOptimizationRecord {
  readonly nodeId: string;
  readonly branchId?: string;
  readonly at: string;
  readonly originalContextTokens: number;
  readonly finalContextTokens: number;
  readonly duplicateTokensRemoved: number;
  readonly historyTokensRemoved: number;
  readonly retrievalTokensAvoided: number;
  readonly memoryTokensAvoided: number;
  readonly completionTokensReduced: number;
  readonly cachedTokensUsed: number;
  readonly totalTokensSaved: number;
  /** Digest of the manifest the model actually saw. */
  readonly contextManifestDigest: string;
  readonly decision: string;
}

export interface WorkflowRoutingRecord {
  readonly nodeId: string;
  readonly branchId?: string;
  readonly at: string;
  readonly requestedProfileId: string;
  readonly selectedProfileId: string;
  readonly candidatesConsidered: readonly string[];
  readonly candidatesRejected: readonly string[];
  readonly selectionReason: string;
  readonly expectedCostMicroUsd: number;
  readonly expectedLatencyClass: string;
  readonly downgraded: boolean;
  readonly escalated: boolean;
  readonly complexity: string;
}

export interface WorkflowCacheRecord {
  readonly nodeId: string;
  readonly branchId?: string;
  readonly at: string;
  readonly outcome: 'hit' | 'miss' | 'stored' | 'denied';
  readonly keyDigest: string;
  readonly savedTokens: number;
  readonly savedMicroUsd: number;
  readonly reason: string;
}

export type AvoidedCallReason =
  | 'deterministic_transform'
  | 'cache_hit'
  | 'duplicate_step_suppressed'
  | 'optional_node_skipped'
  | 'condition_excluded_branch'
  | 'low_value_retry_stopped'
  | 'sufficient_confidence'
  | 'cheaper_path_selected';

export interface WorkflowAvoidedCallRecord {
  readonly nodeId: string;
  readonly branchId?: string;
  readonly at: string;
  readonly reason: AvoidedCallReason;
  readonly avoidedCalls: number;
  readonly avoidedPromptTokens: number;
  readonly avoidedCompletionTokens: number;
  readonly avoidedMicroUsd: number;
  /**
   * The profile the avoided call would have used. A saving that cannot name
   * what it was measured against is a number somebody made up.
   */
  readonly comparedAgainstProfileId: string;
  /** Version of the estimate the comparison used. */
  readonly estimateVersion: string;
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
  /** Node the main path is at. Undefined while a fan-out owns execution. */
  readonly currentNodeId?: string;
  readonly stepCount: number;
  readonly retryCount: number;
  /** Node execution attempts, keyed by `nodeId` or `nodeId@branchId`. */
  readonly nodeAttempts: Readonly<Record<string, number>>;
  readonly handoffCount: number;
  readonly branchDepth: number;
  readonly activeBranchIds: readonly string[];
  /**
   * Concurrent branch slots this run may use, when the cost optimizer narrowed
   * them.
   *
   * Persisted rather than recomputed: the decision to serialize a fan-out is made
   * once, when the `parallel` node opens, and an isolate that recomputed it on
   * resume could widen a fan-out an earlier budget decision deliberately narrowed.
   * Absent means "use the definition's limit".
   */
  readonly parallelWidthOverride?: number;
  readonly completedBranchIds: readonly string[];
  readonly failedBranchIds: readonly string[];
  readonly branches: readonly WorkflowBranchRecord[];
  readonly joins: readonly WorkflowJoinRecord[];
  /** Agent runs this workflow created, in order. */
  readonly childAgentRunIds: readonly string[];
  readonly tokens: WorkflowTokenLedger;
  readonly cost: WorkflowCostLedger;
  /** The workflow's typed scratch space: validated node outputs, by key. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Approval the run is currently blocked on, if any. */
  readonly pendingApprovalId?: string;
  /** The node an approval is being sought for. */
  readonly pendingApprovalNodeId?: string;
  readonly pendingApprovalBranchId?: string;
  /** Latest checkpoint version written. The resume point. */
  readonly checkpointVersion: number;
  /** Digest of the compiled plan, so a resumed run proves it is the same plan. */
  readonly planDigest: string;
  readonly planManifestDigest: string;
  /** Operational settings version in force when the run was created. */
  readonly configurationVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Wall-clock deadline. Enforced before every node. */
  readonly deadlineAt: string;
  /** Set by a `wait` node. The run does not advance before this instant. */
  readonly waitUntil?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly elapsedRuntimeMs: number;
  readonly transitions: readonly WorkflowTransitionRecord[];
  /** Transitions dropped from the ring. Non-zero means history is partial. */
  readonly transitionsTruncated: number;
  readonly nodeHistory: readonly WorkflowNodeRecord[];
  readonly optimizations: readonly WorkflowOptimizationRecord[];
  readonly routing: readonly WorkflowRoutingRecord[];
  readonly cacheDecisions: readonly WorkflowCacheRecord[];
  readonly avoidedCalls: readonly WorkflowAvoidedCallRecord[];
  readonly failure?: WorkflowFailureCode;
  /** Caller-safe failure message. Never a provider or storage message. */
  readonly failureMessage?: string;
  /** Digest of the accepted output. The output itself lives on the checkpoint. */
  readonly resultDigest?: string;
}

/** Ring sizes. Beyond these the record drops the oldest and says so. */
export const WORKFLOW_HISTORY_BOUNDS = {
  transitions: 192,
  nodeHistory: 256,
  optimizations: 128,
  routing: 128,
  cacheDecisions: 128,
  avoidedCalls: 128,
  attributionRows: 48,
  branches: 64,
  joins: 32,
  childAgentRuns: 64,
  values: 64,
} as const;

// ── Checkpoints ─────────────────────────────────────────────────────────────

/**
 * An immutable point a run can be resumed from.
 *
 * Versions are monotonic per run and never rewritten: `write` refuses a version
 * that already exists. That is what makes "resume from the last valid
 * checkpoint" a real operation rather than a hope — the history cannot have
 * been edited between the write and the read.
 */
export interface WorkflowCheckpoint {
  readonly workflowRunId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly state: WorkflowRunState;
  readonly nodeId?: string;
  readonly branches: readonly WorkflowBranchRecord[];
  readonly joins: readonly WorkflowJoinRecord[];
  /** Bounded, validated workflow values. Validated before it is stored. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Digest per value key, so a reviewer can prove what a node produced. */
  readonly outputDigests: Readonly<Record<string, string>>;
  readonly tokens: WorkflowTokenLedger;
  readonly cost: WorkflowCostLedger;
  readonly optimizationSummary: {
    readonly totalTokensSaved: number;
    readonly avoidedCalls: number;
    readonly avoidedMicroUsd: number;
    readonly cacheHits: number;
  };
  readonly approvalState: 'none' | 'pending' | 'approved' | 'rejected' | 'expired';
  readonly childAgentRunIds: readonly string[];
  /** Digest of the previous checkpoint, so the chain is verifiable. */
  readonly previousDigest?: string;
  readonly digest: string;
  /** Present only on the checkpoint that accepted a completion. */
  readonly output?: unknown;
}

export const WORKFLOW_CHECKPOINT_BOUNDS = {
  maxValuesBytes: 64 * 1024,
  maxOutputBytes: 128 * 1024,
} as const;

// ── Approvals ───────────────────────────────────────────────────────────────

export type WorkflowApprovalState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'consumed';

export interface WorkflowApprovalRequest {
  readonly workflowApprovalId: string;
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly branchId?: string;
  readonly organizationId: string;
  readonly requestedBy: string;
  /** What the approved action would do, in one bounded sentence. */
  readonly proposedAction: string;
  readonly impactSummary: string;
  readonly dataAffected: readonly string[];
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
  /** Why the workflow believes the action is warranted. */
  readonly approvalReason: string;
  /** Roles permitted to decide, resolved from the node's approval rule. */
  readonly authorizedRoles: readonly string[];
  readonly expiresAt: string;
  /** Always true: one approval authorises exactly one node execution. */
  readonly singleUse: boolean;
  /** Checkpoint the approval was requested against. Stale ones are refused. */
  readonly checkpointVersion: number;
  readonly createdAt: string;
  readonly state: WorkflowApprovalState;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decisionReason?: string;
  readonly consumedAt?: string;
  /** Optimistic concurrency version, same contract as the run record. */
  readonly approvalVersion: number;
}

export const WORKFLOW_APPROVAL_BOUNDS = {
  decisionReason: { min: 3, max: 300 },
  impactSummary: { min: 3, max: 500 },
  maxDataAffected: 12,
} as const;
