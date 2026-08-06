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
