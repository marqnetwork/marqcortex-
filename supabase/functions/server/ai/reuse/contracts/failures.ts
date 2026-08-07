/**
 * Typed failures for the intelligent reuse engine (AI-01 Batch 3B, Part 6B).
 *
 * ── A MISS IS NOT A FAILURE, AND THAT DISTINCTION IS THE WHOLE MODULE ──────
 *
 * Almost everything that can go wrong during reuse resolution is a MISS: the
 * record expired, a dependency moved, the quality floor rose, the store was
 * unreachable. None of those throw. They return a miss with a reason code, the
 * caller proceeds to Part 6A and the Control Plane, and the platform pays for
 * an inference it would rather have avoided. That is the correct outcome —
 * degrading to a paid call is safe, and a reuse layer that could take the AI
 * platform down when its cache was cold would be a worse liability than the
 * cost it saves.
 *
 * The failures below are the narrow set where returning a miss would be WRONG
 * because the caller has asked for something that must not be quietly tolerated:
 * sealing a reusable output containing a credential, attributing a second
 * avoided call to a task that already has one, or handing the engine a record
 * from another tenant. Those are defects in the caller, not weather, and a
 * subsystem that answered them with `undefined` would be teaching every call
 * site to ignore them.
 */

import type { AIErrorCode } from '../../contracts/errors.ts';
import { AIError } from '../../contracts/errors.ts';

export type ReuseFailureCode =
  /** A malformed identity, request or record the engine cannot reason about. */
  | 'reuse_input_invalid'
  /** A reusable output carried something a consumer must never be handed. */
  | 'reusable_output_rejected'
  /** An organization boundary was crossed. Never tolerated, never a miss. */
  | 'reuse_tenant_mismatch'
  /** A second avoided call was attributed to one task, or a hit double-booked. */
  | 'reuse_attribution_conflict'
  /** Something tried to rewrite a sealed record or revive an invalidated one. */
  | 'reuse_record_immutable';

const TRAITS: Record<ReuseFailureCode, { transport: AIErrorCode; retryable: boolean }> = {
  reuse_input_invalid: { transport: 'VALIDATION_FAILED', retryable: false },
  // Not retryable on purpose. The same output will be rejected next time; the
  // resolution is for the producer to seal a bounded envelope, which is a change
  // somebody makes rather than an attempt somebody repeats.
  reusable_output_rejected: { transport: 'VALIDATION_FAILED', retryable: false },
  reuse_tenant_mismatch: { transport: 'TENANT_ISOLATION_VIOLATION', retryable: false },
  // An accounting defect. Surfacing it as retryable would invite a caller to
  // re-post the duplicate attribution it was just refused.
  reuse_attribution_conflict: { transport: 'INTERNAL_ERROR', retryable: false },
  reuse_record_immutable: { transport: 'CONFLICT', retryable: false },
};

export interface ReuseErrorOptions {
  /** Server-side detail. Logged and audited, never returned to a caller. */
  readonly diagnostics?: string;
  readonly cause?: unknown;
}

/**
 * Extends `AIError` for the same reason `CompressionError` and `WorkflowError`
 * do: the platform already owns one caller-safe message, status and retryability
 * mapping, and a second one would be two things to keep in step with one of them
 * drifting.
 */
export class ReuseError extends AIError {
  readonly failure: ReuseFailureCode;

  constructor(failure: ReuseFailureCode, message: string, options: ReuseErrorOptions = {}) {
    const trait = TRAITS[failure];
    super(trait.transport, message, {
      diagnostics: options.diagnostics,
      retryable: trait.retryable,
      cause: options.cause,
    });
    this.name = 'ReuseError';
    this.failure = failure;
  }
}

export function isReuseError(value: unknown): value is ReuseError {
  return value instanceof ReuseError;
}

export function reuseFailure(
  failure: ReuseFailureCode,
  message: string,
  options: ReuseErrorOptions = {},
): ReuseError {
  return new ReuseError(failure, message, options);
}
