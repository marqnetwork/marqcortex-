/**
 * Retry eligibility and attempt bookkeeping (AI-01 Batch 3B, Part 5).
 *
 * Pure, total functions. No clock is read here — a timestamp arrives as an
 * argument — no store is touched and no agent is driven, so every rule this
 * file enforces is a rule a test can hit directly without standing up a run.
 * The same shape `engine/branchScheduler.ts` took, for the same reason.
 *
 * ── THE JUDGEMENT THIS FILE OWNS ───────────────────────────────────────────
 *
 * Is it worth starting a NEW child agent run for a node whose last one failed?
 *
 * That is not the same question `contracts/failures.ts` answers with its
 * `retryable` column, which asks whether an identical REQUEST could succeed if
 * re-sent, and the two have different answers for the same code. A provider
 * that was unavailable is not worth re-requesting this instant — the provider
 * layer already retried and failed over — and IS worth re-running in ninety
 * seconds with a fresh child. Reading one column for both questions would make
 * it mean whichever thing the reader assumed.
 *
 * ── THE CLASSIFICATION IS AN ALLOW-LIST, AND IT FAILS CLOSED ───────────────
 *
 * `RETRYABLE_CHILD_FAILURES` is the whole of what may be tried again. Every
 * other recognised child failure is named in `FAILURE_CLASSES` so it lands in
 * an explicit class rather than in whichever branch the code fell through to,
 * and anything unrecognised — including a child that failed with no code at
 * all, which is what an agent's own `fail` action produces — is `unclassified`
 * and NOT retryable.
 *
 * Failing closed is the only defensible default when the question is "should
 * the platform spend another agent run on this". An allow-list also means a
 * seventeenth agent failure code added by a later batch is refused a retry
 * until somebody decides it deserves one, rather than silently acquiring one.
 *
 * The six decision classes are the ones the brief names and the ones that
 * matter: AUTHORIZATION, POLICY, BUDGET, INVALID DEFINITION, INVALID TRANSITION
 * and APPROVAL REJECTION. Every one of them is a judgement somebody or
 * something already made, and re-running a judgement reaches the same
 * conclusion while spending another agent run to get there.
 */

import type {
  WorkflowFailureClass,
  WorkflowFailureClassification,
  WorkflowNodeAttempt,
  WorkflowRetryPolicy,
} from '../contracts/retry.ts';
import {
  DEFAULT_WORKFLOW_RETRY_POLICY,
  WORKFLOW_RETRY_BOUNDS,
  workflowAttemptKeyFor,
} from '../contracts/retry.ts';
import type { WorkflowFailureCode } from '../contracts/failures.ts';
import { workflowFailure } from '../contracts/failures.ts';

// ── Classification ──────────────────────────────────────────────────────────

/**
 * The ONLY child failures a workflow node retry is for.
 *
 * Each one is a statement about the world at a moment rather than about the
 * work: a provider that was down, a model call that errored, a tool that
 * failed, a write that lost, a runtime that was administratively off. Run the
 * node again in a minute and it may well succeed.
 */
const RETRYABLE_CHILD_FAILURES: readonly string[] = [
  'provider_unavailable',
  'model_failed',
  'tool_failed',
  'persistence_failed',
  'runtime_disabled',
];

/**
 * Every other child failure this platform can produce, and what kind of
 * decision it was.
 *
 * Written out rather than defaulted, so a reader can see that "budget" and
 * "policy" were distinguished on purpose and so a failure that should be
 * retryable cannot become so by being forgotten.
 */
const FAILURE_CLASSES: Readonly<Record<string, WorkflowFailureClass>> = {
  unauthorized: 'authorization',
  capability_denied: 'authorization',
  tool_denied: 'authorization',
  handoff_denied: 'authorization',
  tenant_isolation_violation: 'authorization',

  agent_disabled: 'policy',
  agent_uncertified: 'policy',
  step_limit_exceeded: 'policy',
  handoff_limit_exceeded: 'policy',
  retry_limit_exceeded: 'policy',
  loop_detected: 'policy',
  no_progress: 'policy',
  run_expired: 'policy',

  token_budget_exhausted: 'budget',
  cost_budget_exhausted: 'budget',

  agent_not_found: 'invalid_definition',
  invalid_action: 'invalid_definition',

  invalid_transition: 'invalid_transition',
  stale_run_version: 'invalid_transition',
  checkpoint_conflict: 'invalid_transition',
  run_not_found: 'invalid_transition',

  approval_rejected: 'approval_rejected',
  approval_expired: 'approval_rejected',
  approval_required: 'approval_rejected',
};

/**
 * Classify a child agent run's terminal failure.
 *
 * `childFailure` is the code the agent runtime put on its own record, arriving
 * through `AgentNodeHandle.failure` as an opaque string. It is deliberately not
 * typed as `AgentFailureCode` here: the port's whole purpose is that the
 * workflow engine learns four states and a label, and a signature that demanded
 * the agent runtime's enum would be the engine acquiring an opinion about agent
 * states one import at a time.
 */
export function classifyChildFailure(
  childFailure: string | undefined,
): WorkflowFailureClassification {
  if (childFailure === undefined || childFailure.trim() === '') {
    // An agent that declared it cannot continue — the `fail` action — leaves no
    // failure code, because no limit was crossed and no rule was broken. That
    // is the agent's own judgement about its work, and re-running it would be
    // re-deciding somebody else's decision.
    return {
      classification: 'unclassified',
      retryable: false,
      detail: 'the child agent run failed without a runtime failure code',
    };
  }

  if (RETRYABLE_CHILD_FAILURES.includes(childFailure)) {
    return {
      classification: 'transient',
      retryable: true,
      childFailure,
      detail: `child failure ${childFailure} is transient`,
    };
  }

  const known = FAILURE_CLASSES[childFailure];
  if (known !== undefined) {
    return {
      classification: known,
      retryable: false,
      childFailure,
      detail: `child failure ${childFailure} is a ${known} decision and is never retried`,
    };
  }

  return {
    classification: 'unclassified',
    retryable: false,
    childFailure,
    detail: `child failure ${childFailure} is not a classified transient failure`,
  };
}

// ── Policy resolution and backoff ───────────────────────────────────────────

/** A node with no declared policy retries immediately. Never undefined. */
export function resolveRetryPolicy(
  policy: WorkflowRetryPolicy | undefined,
): WorkflowRetryPolicy {
  return policy ?? DEFAULT_WORKFLOW_RETRY_POLICY;
}

/**
 * How long before `attempt` becomes eligible, in milliseconds.
 *
 * `attempt` is the attempt being scheduled and is always at least 2 — the first
 * attempt is not a retry and never waits. Deterministic: the same policy and
 * the same attempt number produce the same delay on every instance, which is
 * what lets `nextAttemptAt` be a value a reader can recompute rather than one
 * they have to trust.
 */
export function computeRetryDelayMs(policy: WorkflowRetryPolicy, attempt: number): number {
  const bounds = WORKFLOW_RETRY_BOUNDS;
  if (policy.backoff === 'immediate') return 0;

  const base = clamp(policy.delayMs ?? 0, bounds.delayMs.min, bounds.delayMs.max);
  if (policy.backoff === 'fixed_delay') return base;

  // Exponential. `attempt` 2 is the first retry and waits `base`; each further
  // attempt doubles. The exponent is bounded before it is used, because
  // `2 ** 4000` is Infinity and an Infinity that reached a timestamp would
  // produce an `Invalid Date` on a durable record.
  const prior = Math.min(Math.max(0, Math.floor(attempt) - 2), 16);
  const ceiling = clamp(
    policy.maxDelayMs ?? bounds.maxDelayMs.default,
    bounds.maxDelayMs.min,
    bounds.maxDelayMs.max,
  );
  return Math.min(base * 2 ** prior, ceiling);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

// ── Attempt bookkeeping ─────────────────────────────────────────────────────

export function findAttempt(
  retries: readonly WorkflowNodeAttempt[] | undefined,
  nodeId: string,
  branchId?: string,
): WorkflowNodeAttempt | undefined {
  const key = workflowAttemptKeyFor(nodeId, branchId);
  return (retries ?? []).find(
    (entry) => workflowAttemptKeyFor(entry.nodeId, entry.branchId) === key,
  );
}

/**
 * Which attempt is next for this node on this line of execution.
 *
 * Absence means 1. A node that has never failed carries no record — see
 * `contracts/retry.ts` — and reading that absence here rather than at every
 * call site is what keeps "attempts start at 1" a single fact.
 */
export function currentAttempt(
  retries: readonly WorkflowNodeAttempt[] | undefined,
  nodeId: string,
  branchId?: string,
): number {
  return findAttempt(retries, nodeId, branchId)?.attempt ?? 1;
}

/** True when this attempt was the last one the node's ceiling allows. */
export function retriesExhausted(attempt: number, maxAttempts: number): boolean {
  return attempt >= Math.max(1, maxAttempts);
}

/**
 * Milliseconds still to wait before the recorded next attempt is eligible.
 *
 * Zero when there is no record, no stamp, or the stamp has passed. An
 * UNREADABLE stamp is treated as elapsed rather than as infinitely far away:
 * the conservative direction for a corrupt field is to let the run continue
 * under its own deadline, not to strand it forever — the same call
 * `agents/approvals/approvalGate.ts` makes about an unreadable expiry.
 */
export function retryDelayRemainingMs(
  attempt: WorkflowNodeAttempt | undefined,
  nowMs: number,
): number {
  if (!attempt?.nextAttemptAt) return 0;
  const dueMs = Date.parse(attempt.nextAttemptAt);
  if (!Number.isFinite(dueMs)) return 0;
  return Math.max(0, dueMs - nowMs);
}

export interface ScheduleRetryInput {
  readonly nodeId: string;
  readonly branchId?: string;
  readonly branchName?: string;
  readonly maxAttempts: number;
  readonly policy: WorkflowRetryPolicy;
  /** The attempt that just failed. The next one is this plus one. */
  readonly failedAttempt: number;
  readonly nowMs: number;
  readonly at: string;
  readonly failure: WorkflowFailureCode;
  readonly classification: WorkflowFailureClass;
  readonly childFailure?: string;
  readonly childAgentRunId?: string;
}

/**
 * The attempt record a scheduled retry produces.
 *
 * A value, not a write. The engine folds it into the run record inside the same
 * versioned transition that records the failed step and clears the pending
 * node, so "this attempt failed" and "the next attempt is due at T" become
 * durable together or not at all.
 */
export function nextAttemptRecord(
  existing: WorkflowNodeAttempt | undefined,
  input: ScheduleRetryInput,
): WorkflowNodeAttempt {
  const attempt = input.failedAttempt + 1;
  const delayMs = computeRetryDelayMs(input.policy, attempt);

  return {
    nodeId: input.nodeId,
    ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
    ...(input.branchName === undefined ? {} : { branchName: input.branchName }),
    attempt,
    maxAttempts: input.maxAttempts,
    backoff: input.policy.backoff,
    delayMs,
    // Absent for `immediate`, and absent rather than "now": a stamp equal to the
    // instant it was written would be a value every reader has to compare
    // against the clock to discover it means nothing.
    ...(delayMs > 0
      ? { nextAttemptAt: new Date(input.nowMs + delayMs).toISOString() }
      : {}),
    lastFailedAt: input.at,
    lastFailure: input.failure,
    ...(input.childFailure === undefined ? {} : { lastChildFailure: input.childFailure }),
    lastClassification: input.classification,
    ...(input.childAgentRunId === undefined
      ? {}
      : { lastChildAgentRunId: input.childAgentRunId }),
    attemptVersion: (existing?.attemptVersion ?? 0) + 1,
  };
}

/**
 * Fold an attempt record into the run's list, refusing a stale write.
 *
 * `expectedVersion` is the version the caller read — 0 when there was no record
 * at all, which is how "insert if absent" is expressed without a second
 * function. A mismatch means two isolates both observed this node fail and both
 * computed a next attempt; applying the loser would either double-count the
 * attempt or silently discard the winner's backoff stamp.
 */
export function applyAttempt(
  retries: readonly WorkflowNodeAttempt[] | undefined,
  updated: WorkflowNodeAttempt,
  expectedVersion: number,
): readonly WorkflowNodeAttempt[] {
  const existing = retries ?? [];
  const key = workflowAttemptKeyFor(updated.nodeId, updated.branchId);
  const stored = existing.find(
    (entry) => workflowAttemptKeyFor(entry.nodeId, entry.branchId) === key,
  );

  if ((stored?.attemptVersion ?? 0) !== expectedVersion) {
    throw workflowFailure(
      'stale_workflow_retry',
      'This step has changed since it was read.',
      {
        nodeId: updated.nodeId,
        diagnostics:
          `attempt ${key} expected version ${expectedVersion}, ` +
          `stored ${stored?.attemptVersion ?? 0}`,
      },
    );
  }
  if (updated.attemptVersion !== expectedVersion + 1) {
    throw workflowFailure(
      'stale_workflow_retry',
      'This step has changed since it was read.',
      {
        nodeId: updated.nodeId,
        diagnostics:
          `attempt ${key} update carries version ${updated.attemptVersion}, ` +
          `expected ${expectedVersion + 1}`,
      },
    );
  }

  if (stored === undefined) {
    if (existing.length >= WORKFLOW_RETRY_BOUNDS.maxAttemptRecords) {
      throw workflowFailure(
        'workflow_retry_exhausted',
        'This workflow has retried more steps than it is allowed to.',
        {
          nodeId: updated.nodeId,
          diagnostics:
            `run already holds ${existing.length} attempt records, at the ceiling of ` +
            `${WORKFLOW_RETRY_BOUNDS.maxAttemptRecords}`,
        },
      );
    }
    return [...existing, updated];
  }

  return existing.map((entry) =>
    workflowAttemptKeyFor(entry.nodeId, entry.branchId) === key ? updated : entry,
  );
}

/**
 * Drop a node's attempt record once it has succeeded.
 *
 * A node that completed spent whatever attempts it needed and its budget is no
 * longer a live fact — while a node inside a LOOP that completes on its second
 * pass must start its next visit with a full budget, not with the one attempt
 * its previous visit left. Keeping the record would make a bounded loop's last
 * iteration the only one that could not retry.
 *
 * What actually happened is not lost: every attempt, successful or not, is a
 * step in the run's history, with its attempt number and its failure class.
 */
export function clearAttempt(
  retries: readonly WorkflowNodeAttempt[] | undefined,
  nodeId: string,
  branchId?: string,
): readonly WorkflowNodeAttempt[] {
  const key = workflowAttemptKeyFor(nodeId, branchId);
  return (retries ?? []).filter(
    (entry) => workflowAttemptKeyFor(entry.nodeId, entry.branchId) !== key,
  );
}

/**
 * Every attempt record belonging to one branch.
 *
 * Used when a branch settles: its counts go with it, and its SIBLINGS' do not.
 * That is the structural half of "a parallel branch retry does not reset its
 * siblings" — the key includes the branch id, so there is no filter under which
 * one branch's clean-up could reach another's.
 */
export function clearBranchAttempts(
  retries: readonly WorkflowNodeAttempt[] | undefined,
  branchId: string,
): readonly WorkflowNodeAttempt[] {
  return (retries ?? []).filter((entry) => entry.branchId !== branchId);
}
