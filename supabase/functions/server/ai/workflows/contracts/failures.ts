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
 * NOTHING HERE IS RETRYABLE, AND THAT IS NOT A DEFAULT. Every failure in Part 1
 * is a judgement about a definition — it is invalid, it is off, it was never
 * certified, its graph cannot produce a plan. Re-running a judgement does not
 * change it. Failures that a later attempt could genuinely resolve belong to
 * execution, which is Part 2, and they will arrive with their own traits.
 */

import type { AIErrorCode } from '../../contracts/errors.ts';
import { AIError } from '../../contracts/errors.ts';

export type WorkflowFailureCode =
  // ── Registry ──────────────────────────────────────────────────────────────
  | 'workflow_not_found'
  | 'workflow_disabled'
  | 'workflow_uncertified'
  // ── Definition ────────────────────────────────────────────────────────────
  | 'workflow_invalid_definition'
  // ── Planning ──────────────────────────────────────────────────────────────
  | 'workflow_plan_failed';

interface FailureTrait {
  /** Transport-level code. Supplies the HTTP status and the caller-safe shape. */
  readonly transport: AIErrorCode;
  readonly retryable: boolean;
}

const TRAITS: Record<WorkflowFailureCode, FailureTrait> = {
  workflow_not_found: { transport: 'FEATURE_NOT_FOUND', retryable: false },
  workflow_disabled: { transport: 'FEATURE_DISABLED', retryable: false },
  workflow_uncertified: { transport: 'POLICY_DENIED', retryable: false },
  workflow_invalid_definition: { transport: 'VALIDATION_FAILED', retryable: false },
  workflow_plan_failed: { transport: 'VALIDATION_FAILED', retryable: false },
};

export interface WorkflowErrorOptions {
  /** Server-side detail. Logged and audited, never returned to a caller. */
  readonly diagnostics?: string;
  readonly workflowId?: string;
  readonly nodeId?: string;
  readonly cause?: unknown;
}

export class WorkflowError extends AIError {
  readonly failure: WorkflowFailureCode;
  readonly workflowId?: string;
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
    this.nodeId = options.nodeId;
  }
}

export function isWorkflowError(value: unknown): value is WorkflowError {
  return value instanceof WorkflowError;
}

export function transportCodeFor(failure: WorkflowFailureCode): AIErrorCode {
  return TRAITS[failure].transport;
}

/** Shorthand for the common construction. */
export function workflowFailure(
  failure: WorkflowFailureCode,
  message: string,
  options: WorkflowErrorOptions = {},
): WorkflowError {
  return new WorkflowError(failure, message, options);
}
