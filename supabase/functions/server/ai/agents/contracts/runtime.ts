/**
 * Runtime contracts (AI-01 Batch 3A): what a run IS, durably.
 *
 * The single most important property in this file is that none of it lives in
 * isolate memory. An edge isolate is recycled without warning, and a runtime
 * whose authority is a module-level `Map` rediscovers an empty world every time
 * that happens — which for an approval gate means "nobody ever approved
 * anything" and for a spend ledger means "we have spent nothing".
 *
 * So the run record below is the whole of the run: its identity, its state, its
 * counters, its ledgers, its history and its checkpoint pointer, written as one
 * value under one key with one version. A step that has not been persisted has
 * not happened.
 *
 * BOUNDED BY CONSTRUCTION. Every array here has a cap, and the caps are not
 * decorative — `AGENT_LIMIT_BOUNDS` in `agent.ts` bounds the limits themselves,
 * so a registered agent cannot ask for a history the record cannot hold. The
 * two places that can still grow with operator action (state transitions, from
 * repeated pause/resume) carry an explicit ring and a truncation counter, so
 * the record states plainly that it is not the complete history rather than
 * quietly pretending it is.
 *
 * NO RAW CONTENT. Prompts, completions and tool payloads never enter a run
 * record. Digests do. That is the same decision `observability/audit.ts` made
 * in Batch 1, for the same reason: durable storage that accumulates client
 * business data is a liability that grows on its own.
 */

import type { AgentFailureCode } from './failures.ts';
import type { AgentAction, AgentActionType } from './actions.ts';
import type { OptimizationLedger } from '../../optimization/optimizationLedger.ts';

// ── States ──────────────────────────────────────────────────────────────────

export const AGENT_RUN_STATES = [
  'created',
  'validating',
  'planned',
  'waiting_for_budget',
  'running',
  'waiting_for_tool',
  'waiting_for_agent',
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

export type AgentRunState = (typeof AGENT_RUN_STATES)[number];

/** States from which nothing further happens, ever. */
export const TERMINAL_RUN_STATES: readonly AgentRunState[] = [
  'completed',
  'failed',
  'cancelled',
  'expired',
  'budget_exhausted',
  'policy_denied',
];

export function isTerminalState(state: AgentRunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

/** Operations a caller — human or orchestrator — can request of a run. */
export const AGENT_RUN_OPERATIONS = [
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

export type AgentRunOperation = (typeof AGENT_RUN_OPERATIONS)[number];

// ── Identity and context ────────────────────────────────────────────────────

/**
 * Where the run came from. Recorded, never trusted for authority: the surface
 * says how a request arrived, the authenticated subject says who it was.
 */
export interface AgentRunOrigin {
  readonly surface: 'team_console' | 'client_portal' | 'system';
  /** Product feature that initiated the run. Bounded label. */
  readonly feature: string;
}

/**
 * The server-created execution context. Every field is resolved server-side;
 * nothing here can be asserted by a caller.
 */
export interface AgentRunContext {
  readonly runId: string;
  readonly correlationId: string;
  /** The API request that created or last advanced the run. */
  readonly requestId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly actorRoles: readonly string[];
  readonly origin: AgentRunOrigin;
  /** Entry agent — the agent the run was created for. */
  readonly agentId: string;
  readonly agentVersion: string;
  /** Set when the run belongs to a multi-run workflow. */
  readonly workflowId?: string;
  /** Set when this run was forked from another (a retry of a failed run). */
  readonly parentRunId?: string;
}

// ── History ─────────────────────────────────────────────────────────────────

export interface AgentTransitionRecord {
  readonly at: string;
  readonly from: AgentRunState;
  readonly to: AgentRunState;
  readonly operation: AgentRunOperation | 'step';
  /** Bounded explanation. Written into the audit trail verbatim. */
  readonly reason: string;
  readonly actorId: string;
  /** Run version this transition produced. */
  readonly runVersion: number;
  readonly failure?: AgentFailureCode;
}

export interface AgentStepRecord {
  readonly stepId: string;
  readonly sequence: number;
  readonly agentId: string;
  readonly actionId: string;
  readonly actionType: AgentActionType;
  readonly reason: string;
  /**
   * The action's semantic identity, persisted so at-most-once survives an
   * isolate restart.
   *
   * Absent from records written before this field existed; a reader must treat
   * `undefined` as "unknown", never as "no key".
   */
  readonly idempotencyKey?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
  readonly outcome: 'executed' | 'denied' | 'failed' | 'awaiting_approval';
  readonly failure?: AgentFailureCode;
  readonly attempt: number;
  readonly fingerprint: string;
  /** Digest of the action's input. Never the input itself. */
  readonly inputDigest: string;
  /** Digest of the result. Never the result itself. */
  readonly outputDigest?: string;
  readonly estimatedPromptTokens: number;
  readonly estimatedCompletionTokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly actualPromptTokens?: number;
  readonly actualCompletionTokens?: number;
  readonly cachedTokens?: number;
  readonly actualCostMicroUsd?: number;
  /** Control plane request id for a model step. The audit join key. */
  readonly executionRequestId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly modelProfileId?: string;
  readonly toolId?: string;
  readonly targetAgentId?: string;
  readonly approvalId?: string;
  readonly checkpointVersion: number;

  // ── Optimisation (AI-01 Batch 3B) ─────────────────────────────────────────
  //
  // Recorded on the step rather than only on the run, because "which step was
  // served from cache?" and "which step was routed down?" are the questions a
  // cost review asks, and a run-level total cannot answer either.
  //
  // Every field is optional. Steps written before Batch 3B carry none of them,
  // and a reader must treat `undefined` as "not measured", never as "no".

  /** True when a stored governed answer was served instead of a model call. */
  readonly cacheHit?: boolean;
  /** The complexity score this step was classified at. */
  readonly complexityScore?: number;
  /** Complexity class the routing floor was derived from. */
  readonly complexityClass?: 'low' | 'standard' | 'high';
  /** Micro-USD the replaced call originally cost. Only on a cache hit. */
  readonly avoidedCostMicroUsd?: number;
  /** Prompt tokens the deterministic context reduction removed. */
  readonly contextTokensSaved?: number;
  /** Profile the agent asked for, when the step was routed to a cheaper one. */
  readonly downgradedFromProfileId?: string;
}

export interface AgentHandoffRecord {
  readonly handoffId: string;
  readonly at: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly reason: string;
  readonly payloadDigest: string;
  readonly payloadBytes: number;
  readonly contextBytes: number;
  readonly estimatedCostMicroUsd: number;
  readonly actualCostMicroUsd: number;
  readonly resultingState: AgentRunState;
  readonly approvalId?: string;
}

// ── Ledgers ─────────────────────────────────────────────────────────────────

/**
 * One attribution row. The dimensions are exactly the ones an invoice
 * reconciliation asks for, and they are bounded: a run cannot produce more rows
 * than it takes steps.
 */
export interface AgentUsageAttribution {
  readonly agentId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly feature: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly calls: number;
}

export interface AgentTokenLedger {
  readonly estimatedPromptTokens: number;
  readonly estimatedCompletionTokens: number;
  readonly estimatedTotalTokens: number;
  readonly actualPromptTokens: number;
  readonly actualCompletionTokens: number;
  readonly cachedTokens: number;
  readonly actualTotalTokens: number;
  /** actual − estimate, summed over reconciled steps. Signed. */
  readonly reconciliationVarianceTokens: number;
  readonly attribution: readonly AgentUsageAttribution[];
}

export interface AgentCostLedger {
  readonly estimatedMicroUsd: number;
  readonly actualMicroUsd: number;
  /** Estimate held for the step currently in flight. Zero between steps. */
  readonly reservedMicroUsd: number;
  readonly reconciliationVarianceMicroUsd: number;
}

// ── Loop protection state ───────────────────────────────────────────────────

export interface AgentLoopState {
  /** fingerprint → times proposed. Bounded by the run's step ceiling. */
  readonly actionCounts: Readonly<Record<string, number>>;
  /** `from>to` handoff edge → times taken. Bounded by the handoff ceiling. */
  readonly handoffEdgeCounts: Readonly<Record<string, number>>;
  /** Agents visited in order. Cycle detection reads this. */
  readonly agentPath: readonly string[];
  /** Consecutive steps whose output digest was identical to the previous. */
  readonly noProgressStreak: number;
  readonly lastOutputDigest?: string;
}

// ── The run record ──────────────────────────────────────────────────────────

export interface AgentRunRecord {
  readonly context: AgentRunContext;
  /**
   * Optimistic concurrency version. Every persisted mutation increments it, and
   * a write that does not carry the version it read is refused by the store.
   */
  readonly runVersion: number;
  readonly state: AgentRunState;
  /** Agent currently holding the run. Changes on handoff. */
  readonly currentAgentId: string;
  readonly currentAgentVersion: string;
  readonly currentStep: number;
  readonly stepCount: number;
  /** agentId → steps taken. Bounded by the handoff ceiling plus one. */
  readonly stepsByAgent: Readonly<Record<string, number>>;
  readonly handoffCount: number;
  readonly retryCount: number;
  readonly repeatedActionCount: number;
  readonly tokens: AgentTokenLedger;
  readonly cost: AgentCostLedger;
  /**
   * What optimisation avoided for this run (AI-01 Batch 3B).
   *
   * Optional because records written before Batch 3B do not carry it, and a
   * reader must treat its absence as "nothing measured" rather than as a run
   * that optimised nothing. `coerceOptimizationLedger` turns either into a
   * usable value.
   *
   * Kept apart from `tokens` and `cost`, which record what was SPENT. A ledger
   * that mixed spend with avoided spend would be unable to answer either
   * question, and the answer it did give would be the one nobody could check.
   */
  readonly optimization?: OptimizationLedger;
  readonly loop: AgentLoopState;
  /** Approval the run is currently blocked on, if any. */
  readonly pendingApprovalId?: string;
  /**
   * The action an approval is being sought for.
   *
   * Persisted rather than held in memory, because the approval it waits on may
   * be decided hours later by a different person in a different isolate. It
   * carries the checkpoint version it was authorised against, so an action that
   * was queued against state the run has since moved past is refused as a
   * checkpoint conflict instead of executing against a world that changed.
   */
  readonly pendingAction?: AgentAction;
  /**
   * Idempotency keys CLAIMED by a side-effecting step, persisted BEFORE the
   * step ran.
   *
   * This is the durable half of at-most-once tool execution. The in-memory
   * gateway store catches a repeat inside one drive loop; it is isolate-local,
   * so on its own it guarantees nothing across a restart or a second isolate —
   * an independent review proved exactly that.
   *
   * The claim is written first and kept whether or not the tool then succeeded.
   * That ordering is the whole guarantee, and it is deliberately conservative:
   * a crash between the claim and the call means the tool never ran and its key
   * can never be reused, because a non-idempotent tool that errored may still
   * have had its effect. AT-MOST-ONCE, not exactly-once — the platform does not
   * claim a guarantee it cannot deliver.
   *
   * Bounded by the run's own step ceiling, so it cannot grow without limit.
   */
  readonly claimedToolKeys: readonly string[];
  /** Latest checkpoint version written. The resume point. */
  readonly checkpointVersion: number;
  /** Digest of the entry plan, so a resumed run proves it is the same run. */
  readonly planDigest: string;
  /** Operational settings version in force when the run was created. */
  readonly configurationVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Wall-clock deadline. Enforced before every step. */
  readonly deadlineAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly elapsedRuntimeMs: number;
  readonly transitions: readonly AgentTransitionRecord[];
  /** Transitions dropped from the ring. Non-zero means history is partial. */
  readonly transitionsTruncated: number;
  readonly steps: readonly AgentStepRecord[];
  readonly handoffs: readonly AgentHandoffRecord[];
  readonly failure?: AgentFailureCode;
  /** Caller-safe failure message. Never a provider or storage message. */
  readonly failureMessage?: string;
  /** Digest of the accepted output. The output itself lives on the checkpoint. */
  readonly resultDigest?: string;
}

/** How many transitions a record keeps before it starts dropping the oldest. */
export const MAX_TRANSITION_HISTORY = 128;

// ── Checkpoints ─────────────────────────────────────────────────────────────

/**
 * An immutable point a run can be resumed from.
 *
 * Versions are monotonic per run and never rewritten: `write` refuses a version
 * that already exists. That is what makes "resume from the last valid
 * checkpoint" a real operation rather than a hope — the history cannot have been
 * edited between the write and the read.
 */
export interface AgentCheckpoint {
  readonly runId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly state: AgentRunState;
  readonly agentId: string;
  readonly stepCount: number;
  /** Bounded, serializable agent progress. Validated before it is stored. */
  readonly progress: unknown;
  readonly progressDigest: string;
  /** Present only on the checkpoint that accepted a completion. */
  readonly output?: unknown;
  /** Digest of the previous checkpoint, so the chain is verifiable. */
  readonly previousDigest?: string;
}

export const CHECKPOINT_BOUNDS = {
  maxProgressBytes: 32 * 1024,
  maxOutputBytes: 128 * 1024,
} as const;

// ── Approvals ───────────────────────────────────────────────────────────────

export type AgentApprovalState = 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';

export interface AgentApprovalRequest {
  readonly approvalId: string;
  readonly runId: string;
  readonly actionId: string;
  readonly organizationId: string;
  readonly requestingAgentId: string;
  readonly actionType: AgentActionType;
  /** What the pending action would do, in one sentence. */
  readonly impactSummary: string;
  readonly dataAffected: readonly string[];
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
  /** Why the agent believes the action is warranted. */
  readonly reason: string;
  /** Roles permitted to decide, resolved from the agent definition. */
  readonly authorizedApproverRoles: readonly string[];
  readonly expiresAt: string;
  /** Always true in Batch 3A: one approval authorises exactly one action. */
  readonly singleUse: boolean;
  readonly createdAt: string;
  readonly state: AgentApprovalState;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decisionReason?: string;
  /** Set when an approved request has been spent on its action. */
  readonly consumedAt?: string;
  /** Optimistic concurrency version, same contract as the run record. */
  readonly approvalVersion: number;
}

export const APPROVAL_BOUNDS = {
  decisionReason: { min: 3, max: 300 },
} as const;
