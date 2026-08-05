/**
 * Typed workflow failures (AI-01 Batch 3B).
 *
 * ONE ERROR TYPE FOR THE PLATFORM, NOW THREE VOCABULARIES.
 *
 * `AIError` carries the platform's caller-safe message, HTTP status and
 * retryability. `AgentRuntimeError` extends it with the agent runtime's failure
 * codes. This adds the third layer the same way and for the same reason: a
 * route that knows nothing about workflows still returns the right status, and
 * a console that does know about them gets the precise reason.
 *
 * RETRYABILITY IS DECLARED, NOT INFERRED. The table states for every failure
 * whether retrying could conceivably help. Authorization, tenancy, policy,
 * budget, validation, invalid transitions, invalid definitions and approval
 * rejections are all `false` — not as a default, but as the rule that stops a
 * runtime from grinding against a decision that has already been made.
 *
 * TERMINAL STATE IS DECLARED TOO. A failure that ends a run says WHICH ending
 * it produces, so the orchestrator never has to guess whether an exhausted
 * token budget is a `failed` run or a `budget_exhausted` one. An operator
 * console that cannot tell those apart shows two different problems as one.
 */

import type { AIErrorCode } from '../../contracts/errors.ts';
import { AIError } from '../../contracts/errors.ts';
import type { WorkflowRunState } from './runtime.ts';

export type WorkflowFailureCode =
  // ── Registry and definition ───────────────────────────────────────────────
  | 'workflow_not_found'
  | 'workflow_disabled'
  | 'workflow_uncertified'
  | 'invalid_workflow_definition'
  | 'invalid_node'
  | 'invalid_edge'
  // ── State ─────────────────────────────────────────────────────────────────
  | 'invalid_transition'
  | 'stale_workflow_version'
  | 'checkpoint_conflict'
  | 'workflow_run_not_found'
  // ── Graph execution ───────────────────────────────────────────────────────
  | 'condition_failed'
  | 'branch_limit_exceeded'
  | 'join_conflict'
  | 'join_unsatisfied'
  | 'node_timeout'
  | 'node_retry_exhausted'
  // ── Approval ──────────────────────────────────────────────────────────────
  | 'approval_required'
  | 'approval_expired'
  | 'approval_rejected'
  // ── Budget ────────────────────────────────────────────────────────────────
  | 'token_budget_exhausted'
  | 'cost_budget_exhausted'
  | 'workflow_budget_exhausted'
  // ── Optimization and routing ──────────────────────────────────────────────
  | 'cache_policy_denied'
  | 'routing_unavailable'
  // ── Contracts ─────────────────────────────────────────────────────────────
  | 'output_validation_failed'
  // ── Lifecycle ─────────────────────────────────────────────────────────────
  | 'workflow_expired'
  | 'policy_denied'
  | 'persistence_failed'
  // ── Permission ────────────────────────────────────────────────────────────
  | 'unauthorized'
  | 'tenant_isolation_violation'
  | 'capability_denied'
  // ── Delegation ────────────────────────────────────────────────────────────
  | 'agent_step_failed'
  | 'tool_step_failed'
  | 'model_step_failed'
  | 'workflow_disabled_runtime';

interface FailureTrait {
  /** Transport-level code. Supplies the HTTP status and the caller-safe shape. */
  readonly transport: AIErrorCode;
  /** Could the identical operation succeed on a later attempt? */
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
  invalid_workflow_definition: {
    transport: 'VALIDATION_FAILED',
    retryable: false,
    terminal: 'failed',
  },
  invalid_node: { transport: 'VALIDATION_FAILED', retryable: false, terminal: 'failed' },
  invalid_edge: { transport: 'VALIDATION_FAILED', retryable: false, terminal: 'failed' },

  invalid_transition: { transport: 'CONFLICT', retryable: false },
  // Retryable in the specific sense the platform already uses for CONFLICT: the
  // caller re-reads, re-applies and tries again. The engine does exactly that
  // internally before surfacing it.
  stale_workflow_version: { transport: 'CONFLICT', retryable: true },
  checkpoint_conflict: { transport: 'CONFLICT', retryable: true },
  workflow_run_not_found: { transport: 'FEATURE_NOT_FOUND', retryable: false },

  condition_failed: { transport: 'VALIDATION_FAILED', retryable: false, terminal: 'failed' },
  branch_limit_exceeded: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  join_conflict: { transport: 'CONFLICT', retryable: false, terminal: 'failed' },
  join_unsatisfied: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  node_timeout: { transport: 'PROVIDER_TIMEOUT', retryable: true },
  node_retry_exhausted: { transport: 'INTERNAL_ERROR', retryable: false, terminal: 'failed' },

  // Not a failure of the run — it is the run correctly stopping to ask. It
  // carries no terminal state for exactly that reason.
  approval_required: { transport: 'POLICY_DENIED', retryable: false },
  approval_expired: { transport: 'POLICY_DENIED', retryable: false, terminal: 'expired' },
  approval_rejected: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },

  token_budget_exhausted: {
    transport: 'BUDGET_EXCEEDED',
    retryable: false,
    terminal: 'budget_exhausted',
  },
  cost_budget_exhausted: {
    transport: 'BUDGET_EXCEEDED',
    retryable: false,
    terminal: 'budget_exhausted',
  },
  workflow_budget_exhausted: {
    transport: 'BUDGET_EXCEEDED',
    retryable: false,
    terminal: 'budget_exhausted',
  },

  cache_policy_denied: { transport: 'POLICY_DENIED', retryable: false },
  routing_unavailable: { transport: 'NO_PROVIDER_AVAILABLE', retryable: false, terminal: 'failed' },

  output_validation_failed: { transport: 'VALIDATION_FAILED', retryable: true },

  workflow_expired: { transport: 'POLICY_DENIED', retryable: false, terminal: 'expired' },
  policy_denied: { transport: 'POLICY_DENIED', retryable: false, terminal: 'policy_denied' },
  persistence_failed: { transport: 'INTERNAL_ERROR', retryable: true, terminal: 'failed' },

  unauthorized: { transport: 'FORBIDDEN', retryable: false },
  tenant_isolation_violation: {
    transport: 'TENANT_ISOLATION_VIOLATION',
    retryable: false,
    terminal: 'policy_denied',
  },
  capability_denied: {
    transport: 'CAPABILITY_DENIED',
    retryable: false,
    terminal: 'policy_denied',
  },

  // A child agent run, a tool call or a model call that failed inside its own
  // governed path. Retryable within the node's declared allowance; the failure
  // that reached here has already exhausted the layer below's own retries.
  agent_step_failed: { transport: 'INTERNAL_ERROR', retryable: true },
  tool_step_failed: { transport: 'INTERNAL_ERROR', retryable: true },
  model_step_failed: { transport: 'INTERNAL_ERROR', retryable: true },
  workflow_disabled_runtime: { transport: 'AI_DISABLED', retryable: true },
};

export interface WorkflowErrorOptions {
  /** Server-side detail. Logged and audited, never returned to a caller. */
  readonly diagnostics?: string;
  readonly workflowRunId?: string;
  readonly workflowId?: string;
  readonly nodeId?: string;
  readonly branchId?: string;
  readonly cause?: unknown;
}

export class WorkflowError extends AIError {
  readonly failure: WorkflowFailureCode;
  readonly workflowRunId?: string;
  readonly workflowId?: string;
  readonly nodeId?: string;
  readonly branchId?: string;

  constructor(failure: WorkflowFailureCode, message: string, options: WorkflowErrorOptions = {}) {
    const trait = TRAITS[failure];
    super(trait.transport, message, {
      diagnostics: options.diagnostics,
      retryable: trait.retryable,
      cause: options.cause,
    });
    this.name = 'WorkflowError';
    this.failure = failure;
    this.workflowRunId = options.workflowRunId;
    this.workflowId = options.workflowId;
    this.nodeId = options.nodeId;
    this.branchId = options.branchId;
  }
}

export function isWorkflowError(value: unknown): value is WorkflowError {
  return value instanceof WorkflowError;
}

/** The terminal run state this failure implies, if it ends a run. */
export function terminalStateFor(failure: WorkflowFailureCode): WorkflowRunState | undefined {
  return TRAITS[failure].terminal;
}

export function isRetryableFailure(failure: WorkflowFailureCode): boolean {
  return TRAITS[failure].retryable;
}

export function transportCodeFor(failure: WorkflowFailureCode): AIErrorCode {
  return TRAITS[failure].transport;
}

/**
 * Failures a NODE-level retry may be attempted for.
 *
 * Everything else is a decision — an authorization, a tenancy check, a policy,
 * a budget, an invalid definition, an invalid transition, an approval rejection
 * — and re-running a decision does not change it. `output_validation_failed` is
 * included because the node's declared retry allowance is exactly the bounded
 * repair rule the batch permits; nothing here retries a schema failure forever,
 * because `maxAttempts` bounds it.
 */
export function isNodeRetryable(failure: WorkflowFailureCode): boolean {
  return (
    failure === 'agent_step_failed' ||
    failure === 'tool_step_failed' ||
    failure === 'model_step_failed' ||
    failure === 'node_timeout' ||
    failure === 'output_validation_failed'
  );
}

/** Shorthand for the common construction. */
export function workflowFailure(
  failure: WorkflowFailureCode,
  message: string,
  options: WorkflowErrorOptions = {},
): WorkflowError {
  return new WorkflowError(failure, message, options);
}
