/**
 * Node retries (AI-01 Batch 3B, Part 5).
 *
 * Parts 2 to 4 carried `maxAttempts` on every agent node, planned it, persisted
 * it and never spent it — every node got exactly one attempt and every step
 * record said `attempt: 1`. Carrying the ceiling without acting on it was
 * deliberate: the plan is the reviewed artefact, and dropping a field from it
 * because a part did not use it would have meant re-planning when retries
 * arrived. This is that arrival, and it spends the field that was already there
 * rather than introducing a second one.
 *
 * ── WHAT A RETRY IS, AND WHAT IT IS NOT ────────────────────────────────────
 *
 * A retry is A NEW CHILD AGENT RUN FOR THE SAME NODE. It is not a second drive
 * of a child that already reached a terminal state, and it is not a step-level
 * retry inside an agent — the agent runtime has its own, decided by its own
 * limits, and this one neither replaces nor softens it. By the time a failure
 * is visible here the child is finished, so the only thing a retry can mean is
 * "start that node again, from the durable state it started from last time".
 *
 * ── RETRIES ARE NODE-SCOPED AND BRANCH-LOCAL ───────────────────────────────
 *
 * An attempt record is keyed by node AND branch. Two branches that both run a
 * node called `draft` keep separate counts, a failure in one leaves the other's
 * budget untouched, and the run's own main line is a third key with `branchId`
 * absent. That is the same isolation `contracts/parallel.ts` gives branch
 * outputs, for the same reason: a fan-out where one branch's bad luck spent a
 * sibling's attempts would make the sibling's ceiling unreadable.
 *
 * ── THE COUNT IS DURABLE, AND IT IS NOT IN THE CHAIN ───────────────────────
 *
 * Attempt records live on the run record, which is versioned and written
 * through the same compare-and-swap as everything else — so a recycled isolate
 * reads the attempt state rather than starting the node's budget again.
 *
 * They are deliberately NOT inside the checkpoint digest, and the reason is the
 * one already stated for `pendingNode` in `contracts/checkpoint.ts`: an attempt
 * count legitimately differs between a crashed attempt and its retry, and a
 * digest that moved with it would turn `writeCheckpoint`'s idempotent re-write
 * into a permanent conflict. Durability comes from the record's own
 * compare-and-swap; the chain proves what a run DID, and a failed attempt is
 * not a point anything resumes from.
 *
 * ── DETERMINISTIC METADATA, NO SCHEDULER ───────────────────────────────────
 *
 * This part computes and persists WHEN a retry becomes eligible. It does not
 * wake anything up at that moment, and there is no background worker, no timer
 * and no queue anywhere in this batch. A caller — an operator, a console, a
 * future driver — advances the run after the delay has elapsed and the engine
 * proceeds; advancing before it elapses makes no attempt and changes nothing.
 *
 * That is a real limitation and it is stated rather than hidden. The alternative
 * would be a scheduler nobody reviewed, holding the only copy of "this run needs
 * attention in ninety seconds" in a process that can be recycled.
 */

import type { WorkflowFailureCode } from './failures.ts';

// ── Backoff ─────────────────────────────────────────────────────────────────

/**
 * Three shapes, all deterministic functions of the attempt number.
 *
 * There is no `jitter`, and its absence is the point: jitter exists to spread a
 * thundering herd across a scheduler, and there is no scheduler here. A random
 * component would also make `nextAttemptAt` unreproducible, which would put a
 * value nobody can recompute inside a durable record — the same objection that
 * keeps `createdAt` out of the checkpoint digest.
 *
 *   immediate      eligible as soon as the failure is recorded.
 *   fixed_delay    `delayMs` before every attempt after the first.
 *   exponential    `delayMs` doubled per prior retry, capped by `maxDelayMs`.
 */
export const WORKFLOW_RETRY_BACKOFFS = ['immediate', 'fixed_delay', 'exponential'] as const;

export type WorkflowRetryBackoff = (typeof WORKFLOW_RETRY_BACKOFFS)[number];

export interface WorkflowRetryPolicy {
  readonly backoff: WorkflowRetryBackoff;
  /**
   * Base delay. Required by `fixed_delay` and `exponential`, refused on
   * `immediate` — a delay on a policy that does not wait reads, in a review, as
   * though something waits.
   */
  readonly delayMs?: number;
  /** Ceiling on a computed delay. `exponential` only. */
  readonly maxDelayMs?: number;
}

/** What a node with no declared policy gets. One attempt, or immediate retries. */
export const DEFAULT_WORKFLOW_RETRY_POLICY: WorkflowRetryPolicy = { backoff: 'immediate' };

// ── Failure classification ──────────────────────────────────────────────────

/**
 * Why a node failed, in the vocabulary that decides whether trying again could
 * possibly help.
 *
 * The first six are DECISIONS — somebody or something judged this run and said
 * no — and re-running a decision reaches the same conclusion while spending
 * another agent run to get there. `transient` is the only class a retry is for.
 * `unclassified` exists so an unrecognised child failure lands somewhere
 * explicit rather than in whichever branch the code happened to fall through
 * to, and it is NOT retryable: failing closed is the only safe default when the
 * question is "should the platform spend money doing this again".
 */
export const WORKFLOW_FAILURE_CLASSES = [
  'authorization',
  'policy',
  'budget',
  'invalid_definition',
  'invalid_transition',
  'approval_rejected',
  'transient',
  'unclassified',
] as const;

export type WorkflowFailureClass = (typeof WORKFLOW_FAILURE_CLASSES)[number];

/** Exactly one class is retryable. Stated as data so nothing has to infer it. */
export const RETRYABLE_WORKFLOW_FAILURE_CLASSES: readonly WorkflowFailureClass[] = ['transient'];

export interface WorkflowFailureClassification {
  readonly classification: WorkflowFailureClass;
  readonly retryable: boolean;
  /** The child agent run's own failure code, verbatim. May be absent. */
  readonly childFailure?: string;
  /** Server-side detail. Logged and recorded, never returned to a caller. */
  readonly detail: string;
}

// ── The durable attempt record ──────────────────────────────────────────────

/**
 * One node's attempt state, on one line of execution.
 *
 * `attempt` is the attempt that is in flight or about to be — it starts at 1
 * and is incremented when a retry is scheduled, so "attempt 3 of 3" is
 * readable directly rather than derived by adding one to a retry count. A node
 * that has never failed has no record at all, and `currentAttempt` reads that
 * absence as 1; storing a row per node up front would put a hundred and
 * twenty-eight empty records on every run that never retried anything.
 */
export interface WorkflowNodeAttempt {
  readonly nodeId: string;
  /** Absent on the main line. Present, and part of the key, inside a branch. */
  readonly branchId?: string;
  readonly branchName?: string;
  /** 1-based. The attempt in flight, or the next one to start. */
  readonly attempt: number;
  /** The node's ceiling, copied from the plan so a reader needs one record. */
  readonly maxAttempts: number;
  readonly backoff: WorkflowRetryBackoff;
  /** The delay this record's `nextAttemptAt` was computed from. */
  readonly delayMs: number;
  /**
   * When the next attempt becomes eligible. Absent for `immediate`.
   *
   * PERSISTED METADATA, NOT A SCHEDULE. Nothing wakes up at this instant — see
   * the header. It is here so a caller, a console or a later driver can answer
   * "when is it worth advancing this run again" from the record alone.
   */
  readonly nextAttemptAt?: string;
  readonly lastFailedAt?: string;
  /** The workflow-level failure the last attempt was recorded under. */
  readonly lastFailure?: WorkflowFailureCode;
  /** The child agent run's own failure code, verbatim. */
  readonly lastChildFailure?: string;
  readonly lastClassification?: WorkflowFailureClass;
  /** The child run of the last attempt. The join key into the agent runtime. */
  readonly lastChildAgentRunId?: string;
  /**
   * Optimistic concurrency for this attempt record alone. Starts at 1.
   *
   * The run record's `runVersion` guards the whole record and the branch's
   * `branchVersion` guards a branch inside it; this guards an attempt inside
   * either. One version per independently-mutated thing — the same rule
   * `contracts/parallel.ts` arrived at, applied to the thing Part 5 added.
   */
  readonly attemptVersion: number;
}

export const WORKFLOW_RETRY_BOUNDS = {
  /** A single declared delay. Five minutes is already longer than most runs. */
  delayMs: { min: 0, max: 300_000 },
  /** The ceiling an exponential policy may declare, and the one it gets by default. */
  maxDelayMs: { min: 0, max: 900_000, default: 300_000 },
  /**
   * Attempt records one run may hold.
   *
   * Equal to half the node-execution ceiling: every record is a node that
   * failed at least once, and a run that accumulated more distinct failing
   * nodes than that has a problem no retry ceiling is going to solve.
   */
  maxAttemptRecords: 128,
} as const;

/**
 * The key an attempt record is found by.
 *
 * The separator is `:` for the reason `contracts/parallel.ts` gives: no node id
 * or branch id grammar admits it, so `a_b` + `c` and `a` + `b_c` cannot
 * collide the way they would under `_`.
 */
export function workflowAttemptKeyFor(nodeId: string, branchId?: string): string {
  return [nodeId, branchId ?? 'main'].join(':');
}
