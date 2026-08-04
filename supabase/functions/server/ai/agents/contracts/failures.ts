/**
 * Typed agent runtime failures (AI-01 Batch 3A).
 *
 * ONE ERROR TYPE FOR THE PLATFORM, TWO VOCABULARIES.
 *
 * `AIError` already carries the platform's caller-safe message, HTTP status and
 * retryability, and every HTTP surface, log line and audit record is built
 * against it. Introducing a second error class with its own status mapping
 * would mean two things to keep in step and one of them eventually drifting.
 *
 * So `AgentRuntimeError` EXTENDS `AIError`. It adds a runtime-specific failure
 * code — the vocabulary an operator reads ("handoff_denied", "loop_detected") —
 * and maps it, in one table, onto the transport-level code that already exists.
 * A route that knows nothing about agents still returns the right status; a
 * console that does know about agents gets the precise reason.
 *
 * RETRYABILITY IS DECLARED, NOT INFERRED. The table states for every failure
 * whether retrying could conceivably help. Authorization, policy, budget,
 * validation, invalid transitions and approval rejections are all `false`, and
 * that is not a default — it is the rule that stops a runtime from grinding
 * against a decision that has already been made.
 */

import type { AIErrorCode } from '../../contracts/errors.ts';
import { AIError } from '../../contracts/errors.ts';
import type { AgentRunState } from './runtime.ts';

export type AgentFailureCode =
  // ── Registry ──────────────────────────────────────────────────────────────
  | 'agent_not_found'
  | 'agent_disabled'
  | 'agent_uncertified'
  // ── State ─────────────────────────────────────────────────────────────────
  | 'invalid_transition'
  | 'stale_run_version'
  | 'checkpoint_conflict'
  | 'run_not_found'
  // ── Permission ────────────────────────────────────────────────────────────
  | 'capability_denied'
  | 'tool_denied'
  | 'handoff_denied'
  | 'tenant_isolation_violation'
  | 'unauthorized'
  // ── Approval ──────────────────────────────────────────────────────────────
  | 'approval_required'
  | 'approval_expired'
  | 'approval_rejected'
  // ── Budget ────────────────────────────────────────────────────────────────
  | 'token_budget_exhausted'
  | 'cost_budget_exhausted'
  // ── Limits ────────────────────────────────────────────────────────────────
  | 'step_limit_exceeded'
  | 'handoff_limit_exceeded'
  | 'retry_limit_exceeded'
  | 'loop_detected'
  | 'no_progress'
  | 'run_expired'
  // ── Execution ─────────────────────────────────────────────────────────────
  | 'provider_unavailable'
  | 'tool_failed'
  | 'model_failed'
  | 'persistence_failed'
  | 'invalid_action'
  | 'runtime_disabled';

interface FailureTrait {
  /** Transport-level code. Supplies the HTTP status and the caller-safe shape. */
  readonly transport: AIErrorCode;
  /** Could the identical operation succeed on a later attempt? */
  readonly retryable: boolean;
  /**
   * The terminal state a RUN moves to when this failure ends it. `undefined`
   * means the failure is about a request, not a run — nothing to terminate.
   */
  readonly terminal?: AgentRunState;
}

const TRAITS: Record<AgentFailureCode, FailureTrait> = {
  agent_not_found: { transport: 'FEATURE_NOT_FOUND', retryable: false, terminal: 'failed' },
  agent_disabled: { transport: 'FEATURE_DISABLED', retryable: false, terminal: 'policy_denied' },
  agent_uncertified: { transport: 'POLICY_DENIED', retryable: false, terminal: 'policy_denied' },

  invalid_transition: { transport: 'CONFLICT', retryable: false },
  // Retryable in the specific sense the platform already uses for CONFLICT: the
  // caller re-reads, re-applies and tries again. The runtime does exactly that
  // internally before surfacing it.
  stale_run_version: { transport: 'CONFLICT', retryable: true },
  checkpoint_conflict: { transport: 'CONFLICT', retryable: true },
  run_not_found: { transport: 'FEATURE_NOT_FOUND', retryable: false },

  capability_denied: { transport: 'CAPABILITY_DENIED', retryable: false, terminal: 'policy_denied' },
  tool_denied: { transport: 'CAPABILITY_DENIED', retryable: false, terminal: 'policy_denied' },
  handoff_denied: { transport: 'CAPABILITY_DENIED', retryable: false, terminal: 'policy_denied' },
  tenant_isolation_violation: {
    transport: 'TENANT_ISOLATION_VIOLATION',
    retryable: false,
    terminal: 'policy_denied',
  },
  unauthorized: { transport: 'FORBIDDEN', retryable: false },

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

  step_limit_exceeded: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  handoff_limit_exceeded: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  retry_limit_exceeded: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  loop_detected: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  no_progress: { transport: 'POLICY_DENIED', retryable: false, terminal: 'failed' },
  run_expired: { transport: 'POLICY_DENIED', retryable: false, terminal: 'expired' },

  // The provider layer's own retry, failover and circuit have already run by
  // the time this surfaces, so a further retry inside the agent runtime would
  // be a fourth attempt at something that failed three times.
  provider_unavailable: { transport: 'PROVIDER_UNAVAILABLE', retryable: false, terminal: 'failed' },
  tool_failed: { transport: 'INTERNAL_ERROR', retryable: true },
  model_failed: { transport: 'INTERNAL_ERROR', retryable: true },
  persistence_failed: { transport: 'INTERNAL_ERROR', retryable: true, terminal: 'failed' },
  invalid_action: { transport: 'VALIDATION_FAILED', retryable: false, terminal: 'failed' },
  runtime_disabled: { transport: 'AI_DISABLED', retryable: true },
};

export interface AgentRuntimeErrorOptions {
  /** Server-side detail. Logged and audited, never returned to a caller. */
  readonly diagnostics?: string;
  readonly runId?: string;
  readonly agentId?: string;
  readonly actionId?: string;
  readonly cause?: unknown;
}

export class AgentRuntimeError extends AIError {
  readonly failure: AgentFailureCode;
  readonly runId?: string;
  readonly agentId?: string;
  readonly actionId?: string;

  constructor(
    failure: AgentFailureCode,
    message: string,
    options: AgentRuntimeErrorOptions = {},
  ) {
    const trait = TRAITS[failure];
    super(trait.transport, message, {
      diagnostics: options.diagnostics,
      retryable: trait.retryable,
      cause: options.cause,
    });
    this.name = 'AgentRuntimeError';
    this.failure = failure;
    this.runId = options.runId;
    this.agentId = options.agentId;
    this.actionId = options.actionId;
  }
}

export function isAgentRuntimeError(value: unknown): value is AgentRuntimeError {
  return value instanceof AgentRuntimeError;
}

/** The terminal run state this failure implies, if it ends a run. */
export function terminalStateFor(failure: AgentFailureCode): AgentRunState | undefined {
  return TRAITS[failure].terminal;
}

export function isRetryableFailure(failure: AgentFailureCode): boolean {
  return TRAITS[failure].retryable;
}

export function transportCodeFor(failure: AgentFailureCode): AIErrorCode {
  return TRAITS[failure].transport;
}

/**
 * Failures a step-level retry may be attempted for.
 *
 * Everything else is a decision — an authorization, a policy, a budget, a
 * malformed contract, an approval rejection — and re-running a decision does
 * not change it. This predicate is the single place that judgement lives.
 */
export function isStepRetryable(failure: AgentFailureCode): boolean {
  return failure === 'tool_failed' || failure === 'model_failed';
}

/** Shorthand for the common construction. */
export function agentFailure(
  failure: AgentFailureCode,
  message: string,
  options: AgentRuntimeErrorOptions = {},
): AgentRuntimeError {
  return new AgentRuntimeError(failure, message, options);
}
