/**
 * Typed workflow failures (AI-01 Batch 3B, Part 1).
 *
 * Same decision the agent runtime made in `agents/contracts/failures.ts`, for
 * the same reason: `AIError` already owns the platform's caller-safe message,
 * HTTP status and retryability, and every route, log line and audit record is
 * built against it. A second error class with its own status mapping would be
 * two things to keep in step and one of them eventually drifting.
 *
 * So `WorkflowError` EXTENDS `AIError` and adds the vocabulary an operator
 * reads. The table below maps each failure onto the transport code that already
 * exists, so a route that knows nothing about workflows still returns the right
 * status.
 *
 * RETRYABILITY IS DECLARED, NOT INFERRED. Every definition-level failure is a
 * judgement — it is invalid, it is off, it was never certified, its graph
 * cannot produce a plan — and re-running a judgement does not change it. The
 * execution failures added in Part 2 are marked `true` only where the identical
 * call could genuinely succeed on a later attempt: a lost version race, which
 * the caller resolves by re-reading, and a storage error. A child agent run
 * that failed is NOT retryable here, because the agent runtime has already
 * finished deciding that.
 *
 * ── PART 2 ADDS CODES; IT DOES NOT ADD A SECOND VOCABULARY ─────────────────
 *
 * The execution codes below live in this same table rather than in a new
 * `executionFailures.ts`. Two failure enums for one subsystem is two mappings
 * onto HTTP status, two retryability policies and one of them eventually
 * drifting — which is the exact reasoning that put `WorkflowError` under
 * `AIError` in the first place.
 *
 * ── PART 5 AND THE TWO MEANINGS OF "RETRYABLE" ─────────────────────────────
 *
 * `retryable` in this table has always meant one narrow thing: could the
 * IDENTICAL REQUEST succeed if the caller sent it again. Part 5 introduces node
 * retries, which ask a different question — is it worth starting a new child
 * agent run for a node whose last one failed — and the answer is deliberately
 * NOT read from this column. It lives in `contracts/retry.ts` and
 * `runtime/retryPolicy.ts`, as a classification of the CHILD's failure, because
 * the two questions have different answers for the same code: a provider that
 * was unavailable is not worth re-requesting this instant and is worth
 * re-running in ninety seconds.
 *
 * Conflating them would have made one column mean two things, and whichever
 * meaning a later reader assumed would have been the wrong one half the time.
 */

import type { AIErrorCode } from '../../contracts/errors.ts';
import { AIError } from '../../contracts/errors.ts';
import type { WorkflowRunState } from './run.ts';

export type WorkflowFailureCode =
  // ── Registry ──────────────────────────────────────────────────────────────
  | 'workflow_not_found'
  | 'workflow_disabled'
  | 'workflow_uncertified'
  // ── Definition ────────────────────────────────────────────────────────────
  | 'workflow_invalid_definition'
  // ── Planning ──────────────────────────────────────────────────────────────
  | 'workflow_plan_failed'
  // ── Run lifecycle (Part 2) ────────────────────────────────────────────────
  | 'workflow_run_not_found'
  | 'workflow_invalid_transition'
  | 'stale_workflow_version'
  | 'workflow_plan_mismatch'
  | 'workflow_expired'
  // ── Execution (Part 2) ────────────────────────────────────────────────────
  | 'workflow_input_invalid'
  | 'workflow_node_failed'
  | 'workflow_persistence_failed'
  | 'workflow_runtime_disabled'
  // ── Data flow and checkpoints (Part 3) ────────────────────────────────────
  | 'workflow_mapping_failed'
  | 'workflow_output_rejected'
  | 'workflow_loop_exhausted'
  | 'workflow_checkpoint_conflict'
  | 'workflow_checkpoint_corrupt'
  // ── Parallel branches and joins (Part 4) ──────────────────────────────────
  | 'workflow_branch_limit_exceeded'
  | 'workflow_branch_failed'
  | 'workflow_branch_conflict'
  | 'stale_workflow_branch'
  | 'workflow_merge_rejected'
  | 'workflow_join_unsatisfied'
  // ── Approvals (Part 5) ────────────────────────────────────────────────────
  | 'workflow_approval_not_found'
  | 'workflow_approval_unauthorized'
  | 'workflow_approval_rejected'
  | 'workflow_approval_expired'
  | 'workflow_approval_conflict'
  | 'stale_workflow_approval'
  // ── Retries (Part 5) ──────────────────────────────────────────────────────
  | 'workflow_retry_exhausted'
  | 'stale_workflow_retry'
  // ── Permission (Part 2) ───────────────────────────────────────────────────
  | 'workflow_unauthorized'
  | 'workflow_tenant_isolation_violation';

interface FailureTrait {
  /** Transport-level code. Supplies the HTTP status and the caller-safe shape. */
  readonly transport: AIErrorCode;
  readonly retryable: boolean;
  /**
   * The terminal state a RUN moves to when this failure ends it. `undefined`
   * means the failure is about a request, not a run — nothing to terminate.
   */
  readonly terminal?: WorkflowRunState;
}

const TRAITS: Record<WorkflowFailureCode, FailureTrait> = {
  workflow_not_found: { transport: 'FEATURE_NOT_FOUND', retryable: false },
  workflow_disabled: { transport: 'FEATURE_DISABLED', retryable: false, terminal: 'policy_denied' },
  workflow_uncertified: { transport: 'POLICY_DENIED', retryable: false, terminal: 'policy_denied' },
  workflow_invalid_definition: { transport: 'VALIDATION_FAILED', retryable: false },
  workflow_plan_failed: { transport: 'VALIDATION_FAILED', retryable: false },

  workflow_run_not_found: { transport: 'FEATURE_NOT_FOUND', retryable: false },
  workflow_invalid_transition: { transport: 'CONFLICT', retryable: false },
  // Retryable in the specific sense the platform already uses for CONFLICT: the
  // caller re-reads, re-applies and tries again. The engine does exactly that
  // internally before surfacing it.
  stale_workflow_version: { transport: 'CONFLICT', retryable: true },
  // A definition changed underneath a live run. Not retryable: the next attempt
  // reads the same changed definition and reaches the same conclusion.
  workflow_plan_mismatch: { transport: 'CONFLICT', retryable: false, terminal: 'policy_denied' },
  workflow_expired: { transport: 'POLICY_DENIED', retryable: false, terminal: 'expired' },

  workflow_input_invalid: { transport: 'VALIDATION_FAILED', retryable: false },
  // The child agent run reached a terminal failure. The agent runtime's own
  // retry, approval and budget logic has already run by the time this surfaces,
  // so a further attempt here would be re-deciding somebody else's decision.
  workflow_node_failed: { transport: 'INTERNAL_ERROR', retryable: false, terminal: 'failed' },
  workflow_persistence_failed: { transport: 'INTERNAL_ERROR', retryable: true, terminal: 'failed' },
  workflow_runtime_disabled: { transport: 'AI_DISABLED', retryable: true },

  // A mapping that could not be built is a definition meeting data it does not
  // fit. Not retryable: the same data maps the same way next time.
  workflow_mapping_failed: { transport: 'VALIDATION_FAILED', retryable: false, terminal: 'failed' },
  // A node produced something its declared output contract refuses. The run
  // stops rather than storing an output later nodes would branch on.
  workflow_output_rejected: {
    transport: 'VALIDATION_FAILED',
    retryable: false,
    terminal: 'failed',
  },
  // A bounded loop reached its declared ceiling. This is the loop's designed
  // terminal outcome, not a defect — and it is a failure rather than a
  // completion because the exit condition never held.
  workflow_loop_exhausted: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  // Two isolates wrote the same checkpoint version. Retryable in the CONFLICT
  // sense: re-read and re-apply. The engine resolves it internally when the
  // existing checkpoint is byte-identical to the one it meant to write.
  workflow_checkpoint_conflict: { transport: 'CONFLICT', retryable: true },
  // A stored checkpoint failed its digest or its chain link. Terminal, and
  // deliberately not retryable: recovery must never fall back to guessing.
  workflow_checkpoint_corrupt: {
    transport: 'INTERNAL_ERROR',
    retryable: false,
    terminal: 'failed',
  },

  // A definition or a run asked for more fan-out than the platform allows. A
  // judgement about a ceiling, so re-running reaches the same conclusion.
  workflow_branch_limit_exceeded: {
    transport: 'POLICY_DENIED',
    retryable: false,
    terminal: 'failed',
  },
  // A branch's child agent run reached a terminal failure and the group's
  // failure policy turned that into the run's outcome. Not retryable, for the
  // same reason `workflow_node_failed` is not: the agent runtime already decided.
  workflow_branch_failed: { transport: 'INTERNAL_ERROR', retryable: false, terminal: 'failed' },
  // A branch or a join was acted on twice: a group opened for a node that
  // already has one, progress written to a settled branch, a join closed after
  // it had already fired. A refusal about THIS request, not about the run —
  // the run is untouched and whatever already happened still stands.
  workflow_branch_conflict: { transport: 'CONFLICT', retryable: false },
  // A branch write carried a version the branch has moved past. Retryable in
  // the CONFLICT sense the platform already uses: re-read and re-apply.
  stale_workflow_branch: { transport: 'CONFLICT', retryable: true },
  // The merged branch outputs did not satisfy the join's declared merge
  // contract. The run stops rather than promoting an unvalidated merge into a
  // node output later steps would branch on.
  workflow_merge_rejected: { transport: 'VALIDATION_FAILED', retryable: false, terminal: 'failed' },
  // Every branch settled and the join policy was not met, or enough branches
  // failed that it never could be. The group's designed terminal outcome when
  // the work did not add up — a failure rather than a completion, because the
  // join is the workflow's own statement of what "enough" meant.
  workflow_join_unsatisfied: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },

  // A run parked on an approval whose record the store no longer has. Terminal:
  // the run cannot continue without a decision, and there is nothing left to
  // decide. Not retryable — a second read finds the same absence.
  workflow_approval_not_found: {
    transport: 'FEATURE_NOT_FOUND',
    retryable: false,
    terminal: 'failed',
  },
  // The decider's roles do not include one the approval node authorised. A
  // refusal about the REQUEST, not the run: the approval is still pending and
  // somebody who does hold the role can still decide it.
  workflow_approval_unauthorized: { transport: 'FORBIDDEN', retryable: false },
  // A human said no. The run's outcome under `onRejection: 'fail'`, and never
  // retryable — re-running a decision is the one thing a retry cannot fix.
  workflow_approval_rejected: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  // The decision window closed with nobody deciding. Terminal, and `failed`
  // rather than `expired`: the RUN's own deadline is what `expired` means, and
  // an approval that timed out is a workflow that did not get an answer it
  // required. EXPIRY IS NEVER APPROVAL — there is no trait, transport or state
  // here through which it could become one.
  workflow_approval_expired: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  // An approval was acted on twice: decided after it was decided, or spent
  // after it was spent. A refusal about THIS request — the run is untouched,
  // whatever already happened still stands, and `cancel` remains the escape.
  workflow_approval_conflict: { transport: 'CONFLICT', retryable: false },
  // A decision that no longer matches the position it was granted for: the run
  // moved past the checkpoint, or the branch moved past the version. NOT
  // retryable, deliberately — re-reading finds the same mismatch, and the
  // correct resolution is a new approval for the new position.
  stale_workflow_approval: { transport: 'CONFLICT', retryable: false },

  // A node used every attempt its definition allowed. The reachable, typed end
  // of the retry path: a run that simply reported `workflow_node_failed` here
  // would leave an operator unable to tell "it failed" from "it failed three
  // times". Not retryable — the ceiling is the answer.
  workflow_retry_exhausted: { transport: 'INTERNAL_ERROR', retryable: false, terminal: 'failed' },
  // An attempt write carried a version the attempt record has moved past.
  // Retryable in the CONFLICT sense the platform already uses: re-read and
  // re-apply.
  stale_workflow_retry: { transport: 'CONFLICT', retryable: true },

  workflow_unauthorized: { transport: 'FORBIDDEN', retryable: false },
  workflow_tenant_isolation_violation: {
    transport: 'TENANT_ISOLATION_VIOLATION',
    retryable: false,
    terminal: 'policy_denied',
  },
};

export interface WorkflowErrorOptions {
  /** Server-side detail. Logged and audited, never returned to a caller. */
  readonly diagnostics?: string;
  readonly workflowId?: string;
  readonly workflowRunId?: string;
  readonly nodeId?: string;
  readonly cause?: unknown;
}

export class WorkflowError extends AIError {
  readonly failure: WorkflowFailureCode;
  readonly workflowId?: string;
  readonly workflowRunId?: string;
  readonly nodeId?: string;

  constructor(failure: WorkflowFailureCode, message: string, options: WorkflowErrorOptions = {}) {
    const trait = TRAITS[failure];
    super(trait.transport, message, {
      diagnostics: options.diagnostics,
      retryable: trait.retryable,
      cause: options.cause,
    });
    this.name = 'WorkflowError';
    this.failure = failure;
    this.workflowId = options.workflowId;
    this.workflowRunId = options.workflowRunId;
    this.nodeId = options.nodeId;
  }
}

export function isWorkflowError(value: unknown): value is WorkflowError {
  return value instanceof WorkflowError;
}

export function transportCodeFor(failure: WorkflowFailureCode): AIErrorCode {
  return TRAITS[failure].transport;
}

export function isRetryableWorkflowFailure(failure: WorkflowFailureCode): boolean {
  return TRAITS[failure].retryable;
}

/** The terminal run state this failure implies, if it ends a run. */
export function terminalStateFor(failure: WorkflowFailureCode): WorkflowRunState | undefined {
  return TRAITS[failure].terminal;
}

/** Shorthand for the common construction. */
export function workflowFailure(
  failure: WorkflowFailureCode,
  message: string,
  options: WorkflowErrorOptions = {},
): WorkflowError {
  return new WorkflowError(failure, message, options);
}
