/**
 * Typed workflow failures (AI-01 Batch 3B).
 *
 * THE SAME DECISION `agents/contracts/failures.ts` MADE, FOR THE SAME REASON.
 * `AIError` already carries the platform's caller-safe message, HTTP status and
 * retryability, and every HTTP surface, log line and audit record is built
 * against it. A third error class with its own status mapping would be a third
 * thing to keep in step, and the one that drifts is always the one nobody is
 * looking at.
 *
 * So `WorkflowRuntimeError` EXTENDS `AIError` and adds a workflow-specific
 * vocabulary — the words an operator reads on a stuck plan ("join_unsatisfied",
 * "condition_unmet", "cycle_detected") — mapped in one table onto the transport
 * code that already exists.
 *
 * WHY NOT REUSE `AgentFailureCode`. A workflow and an agent run fail in
 * different ways about different things. `loop_detected` is a statement about an
 * agent proposing the same action; `cycle_detected` is a statement about a plan
 * that cannot be topologically ordered, and it is found at REGISTRATION rather
 * than at runtime. Folding both into one vocabulary would produce a failure code
 * whose meaning depends on which layer emitted it, which is the property that
 * makes an error code useless during an incident.
 *
 * A NODE'S OWN FAILURE IS NOT ALWAYS THE WORKFLOW'S. `node_failed` carries no
 * terminal state, because whether a failed node ends the plan is a question the
 * definition answers (`optional`, and the downstream join policy) rather than
 * one the error class can.
 */

import type { AIErrorCode } from '../../contracts/errors.ts';
import { AIError } from '../../contracts/errors.ts';
import type { WorkflowRunState } from './runtime.ts';

export type WorkflowFailureCode =
  // ── Registry ──────────────────────────────────────────────────────────────
  | 'workflow_not_found'
  | 'workflow_disabled'
  | 'workflow_uncertified'
  | 'workflow_invalid'
  | 'cycle_detected'
  // ── State ─────────────────────────────────────────────────────────────────
  | 'invalid_workflow_transition'
  | 'stale_workflow_version'
  | 'workflow_checkpoint_conflict'
  | 'workflow_run_not_found'
  // ── Permission ────────────────────────────────────────────────────────────
  | 'workflow_unauthorized'
  | 'workflow_tenant_violation'
  // ── Planning and progression ──────────────────────────────────────────────
  | 'plan_exhausted'
  | 'join_unsatisfied'
  | 'condition_unmet'
  | 'node_failed'
  | 'node_limit_exceeded'
  | 'wave_limit_exceeded'
  // ── Approval ──────────────────────────────────────────────────────────────
  | 'workflow_approval_required'
  | 'workflow_approval_expired'
  | 'workflow_approval_rejected'
  // ── Budget and time ───────────────────────────────────────────────────────
  | 'workflow_token_budget_exhausted'
  | 'workflow_cost_budget_exhausted'
  | 'workflow_expired'
  // ── Execution ─────────────────────────────────────────────────────────────
  | 'workflow_persistence_failed'
  | 'workflow_runtime_disabled'
  | 'invalid_workflow_action';

interface FailureTrait {
  readonly transport: AIErrorCode;
  readonly retryable: boolean;
  /** The terminal state a RUN moves to when this failure ends it. */
  readonly terminal?: WorkflowRunState;
}

const TRAITS: Record<WorkflowFailureCode, FailureTrait> = {
  workflow_not_found: { transport: 'FEATURE_NOT_FOUND', retryable: false, terminal: 'failed' },
  workflow_disabled: { transport: 'FEATURE_DISABLED', retryable: false, terminal: 'policy_denied' },
  workflow_uncertified: { transport: 'POLICY_DENIED', retryable: false, terminal: 'policy_denied' },
  // Found at registration, not at runtime. No run exists to terminate.
  workflow_invalid: { transport: 'INTERNAL_ERROR', retryable: false },
  cycle_detected: { transport: 'INTERNAL_ERROR', retryable: false },

  invalid_workflow_transition: { transport: 'CONFLICT', retryable: false },
  // Retryable in the sense the platform already uses for CONFLICT: re-read,
  // re-apply, try again. The orchestrator does exactly that internally before
  // it surfaces one.
  stale_workflow_version: { transport: 'CONFLICT', retryable: true },
  workflow_checkpoint_conflict: { transport: 'CONFLICT', retryable: true },
  workflow_run_not_found: { transport: 'FEATURE_NOT_FOUND', retryable: false },

  workflow_unauthorized: { transport: 'FORBIDDEN', retryable: false },
  workflow_tenant_violation: {
    transport: 'TENANT_ISOLATION_VIOLATION',
    retryable: false,
    terminal: 'policy_denied',
  },

  // The plan ran out of runnable nodes without reaching a terminal one. That is
  // a definition that cannot finish, not a transient condition.
  plan_exhausted: { transport: 'INTERNAL_ERROR', retryable: false, terminal: 'failed' },
  join_unsatisfied: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  // Not a failure: a guard that did not hold means the node is skipped. It
  // carries no terminal state for exactly that reason.
  condition_unmet: { transport: 'POLICY_DENIED', retryable: false },
  node_failed: { transport: 'INTERNAL_ERROR', retryable: true },
  node_limit_exceeded: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  wave_limit_exceeded: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },

  workflow_approval_required: { transport: 'POLICY_DENIED', retryable: false },
  workflow_approval_expired: { transport: 'POLICY_DENIED', retryable: false, terminal: 'expired' },
  workflow_approval_rejected: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },

  workflow_token_budget_exhausted: {
    transport: 'BUDGET_EXCEEDED',
    retryable: false,
    terminal: 'budget_exhausted',
  },
  workflow_cost_budget_exhausted: {
    transport: 'BUDGET_EXCEEDED',
    retryable: false,
    terminal: 'budget_exhausted',
  },
  workflow_expired: { transport: 'POLICY_DENIED', retryable: false, terminal: 'expired' },

  workflow_persistence_failed: {
    transport: 'INTERNAL_ERROR',
    retryable: true,
    terminal: 'failed',
  },
  workflow_runtime_disabled: { transport: 'AI_DISABLED', retryable: true },
  invalid_workflow_action: {
    transport: 'VALIDATION_FAILED',
    retryable: false,
    terminal: 'failed',
  },
};

export interface WorkflowRuntimeErrorOptions {
  /** Server-side detail. Logged and audited, never returned to a caller. */
  readonly diagnostics?: string;
  readonly workflowRunId?: string;
  readonly workflowId?: string;
  readonly nodeId?: string;
  readonly cause?: unknown;
}

export class WorkflowRuntimeError extends AIError {
  readonly failure: WorkflowFailureCode;
  readonly workflowRunId?: string;
  readonly workflowId?: string;
  readonly nodeId?: string;

  constructor(
    failure: WorkflowFailureCode,
    message: string,
    options: WorkflowRuntimeErrorOptions = {},
  ) {
    const trait = TRAITS[failure];
    super(trait.transport, message, {
      diagnostics: options.diagnostics,
      retryable: trait.retryable,
      cause: options.cause,
    });
    this.name = 'WorkflowRuntimeError';
    this.failure = failure;
    this.workflowRunId = options.workflowRunId;
    this.workflowId = options.workflowId;
    this.nodeId = options.nodeId;
  }
}

export function isWorkflowRuntimeError(value: unknown): value is WorkflowRuntimeError {
  return value instanceof WorkflowRuntimeError;
}

/** The terminal run state this failure implies, if it ends a run. */
export function terminalWorkflowStateFor(
  failure: WorkflowFailureCode,
): WorkflowRunState | undefined {
  return TRAITS[failure].terminal;
}

export function isRetryableWorkflowFailure(failure: WorkflowFailureCode): boolean {
  return TRAITS[failure].retryable;
}

export function workflowTransportCodeFor(failure: WorkflowFailureCode): AIErrorCode {
  return TRAITS[failure].transport;
}

/** Shorthand for the common construction. */
export function workflowFailure(
  failure: WorkflowFailureCode,
  message: string,
  options: WorkflowRuntimeErrorOptions = {},
): WorkflowRuntimeError {
  return new WorkflowRuntimeError(failure, message, options);
}
