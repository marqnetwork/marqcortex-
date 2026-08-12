/**
 * Typed failures for the Financial Intelligence engine (AI-01 Batch 3B, Part 6C).
 *
 * ── AN ACCOUNTING CONTROL THAT LOGS AND PROCEEDS HAS NOT CONTROLLED ANYTHING ─
 *
 * Every failure below is a REFUSAL, and every one of them describes a way the
 * platform could report a number that is not true. There is no code in this tree
 * that notices an unbalanced aggregate and returns it with a warning attached,
 * because a warning on a financial report is read by nobody and a thrown error
 * is read by everybody.
 *
 * That is the same call `savingsLedger.ts` made in Part 6A and
 * `avoidedCallLedger.ts` made in Part 6B. Part 6C is the layer that finally
 * publishes those numbers, so it is the layer with the most to lose from a
 * tolerant reconciliation.
 */

import type { AIErrorCode } from '../../contracts/errors.ts';
import { AIError } from '../../contracts/errors.ts';

export type FinancialFailureCode =
  /** A malformed event, window or query the engine cannot reason about. */
  | 'financial_input_invalid'
  /** Two events claim the same identity with different figures. */
  | 'financial_event_conflict'
  /** Category totals do not sum to the figure they partition. */
  | 'financial_reconciliation_failed'
  /** A read crossed an organization boundary. */
  | 'financial_tenant_mismatch'
  /** A platform-wide read was attempted without platform authority. */
  | 'financial_authority_required';

const TRAITS: Record<FinancialFailureCode, { transport: AIErrorCode; retryable: boolean }> = {
  financial_input_invalid: { transport: 'VALIDATION_FAILED', retryable: false },
  financial_event_conflict: { transport: 'CONFLICT', retryable: false },
  // An accounting defect, not a transient one. Surfacing it as retryable would
  // invite a caller to re-post the same unbalanced figures.
  financial_reconciliation_failed: { transport: 'INTERNAL_ERROR', retryable: false },
  financial_tenant_mismatch: { transport: 'TENANT_ISOLATION_VIOLATION', retryable: false },
  financial_authority_required: { transport: 'FORBIDDEN', retryable: false },
};

export interface FinancialErrorOptions {
  /** Server-side detail. Logged and audited, never returned to a caller. */
  readonly diagnostics?: string;
  readonly cause?: unknown;
}

export class FinancialError extends AIError {
  readonly failure: FinancialFailureCode;

  constructor(
    failure: FinancialFailureCode,
    message: string,
    options: FinancialErrorOptions = {},
  ) {
    const trait = TRAITS[failure];
    super(trait.transport, message, {
      diagnostics: options.diagnostics,
      retryable: trait.retryable,
      cause: options.cause,
    });
    this.name = 'FinancialError';
    this.failure = failure;
  }
}

export function isFinancialError(value: unknown): value is FinancialError {
  return value instanceof FinancialError;
}

export function financialFailure(
  failure: FinancialFailureCode,
  message: string,
  options: FinancialErrorOptions = {},
): FinancialError {
  return new FinancialError(failure, message, options);
}
