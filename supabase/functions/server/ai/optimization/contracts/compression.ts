/**
 * Cost compression contracts (AI-01 Batch 3B, Part 6A).
 *
 * ── THE ONE IDEA THIS WHOLE TREE EXISTS FOR ────────────────────────────────
 *
 * Most systems optimise a model call after deciding to make it. Cortex decides
 * FIRST WHETHER THE CALL SHOULD EXIST, and only then how small it can be made.
 * Everything in `optimization/` is downstream of that inversion: an admission
 * decision comes back from `costCompressionEngine.ts` before any caller is
 * permitted to ask the AI Control Plane for anything.
 *
 * ── WHAT THIS TREE IS NOT ──────────────────────────────────────────────────
 *
 * It is not an execution path. Nothing here can call a provider, hold a
 * credential, select a model, widen an allow list, touch the spend ledger, spend
 * an approval or reach the Tool Gateway. It RECOMMENDS; the certified AI Control
 * Plane remains the only thing that executes, and the agent runtime's own
 * `modelRouting.ts` remains the only thing that picks a profile. A boundary
 * scan asserts all of that on the source, because a behavioural test can prove
 * the governed path is governed and cannot prove a second one is absent.
 *
 * Every recommendation this tree produces is therefore NARROWING-ONLY. There is
 * no field on any type below through which a ceiling can rise, a profile can be
 * upgraded past what the caller already permitted, or a required item can be
 * dropped. That property is enforced by the types first and by the tests second.
 *
 * ── NINE DECISIONS, AND WHY NOT FEWER ──────────────────────────────────────
 *
 * A boolean "should we call the model" collapses six genuinely different
 * outcomes into one, and each of them wants a different thing from the caller:
 * `avoid` means answer it another way, `deterministic` means the answer is
 * already computable, `reuse` means it has already been computed, `compress`
 * means run it smaller, `downgrade` means run it cheaper, `defer` means run it
 * later, `deny` means do not run it at all, and `escalate` means the cheap
 * attempt was not good enough. Reporting those identically is how a savings
 * number stops being explicable.
 */

import type { AIErrorCode } from '../../contracts/errors.ts';
import { AIError } from '../../contracts/errors.ts';

// ── The admission decision ──────────────────────────────────────────────────

export const COMPRESSION_DECISIONS = [
  /** The task needs no inference at all and no substitute is required. */
  'avoid',
  /** An already-authorised deterministic path produces the answer. */
  'deterministic',
  /** A validated prior artefact answers it. Part 6B owns the reuse SOURCES. */
  'reuse',
  /** Inference is required, with a reduced context. */
  'compress',
  /** Inference is required, at a lower capability profile than requested. */
  'downgrade',
  /** Inference is required, as requested. */
  'execute',
  /** A cheaper attempt did not satisfy the quality contract. Go up one step. */
  'escalate',
  /** Not now: no headroom, but the work is not refused. */
  'defer',
  /** Refused. */
  'deny',
] as const;

export type CompressionDecision = (typeof COMPRESSION_DECISIONS)[number];

/** Decisions after which NO provider call happens. */
export const NON_EXECUTING_DECISIONS: readonly CompressionDecision[] = [
  'avoid',
  'deterministic',
  'reuse',
  'defer',
  'deny',
];

export function avoidsInference(decision: CompressionDecision): boolean {
  return NON_EXECUTING_DECISIONS.includes(decision);
}

/**
 * Why the engine decided what it decided.
 *
 * A closed vocabulary rather than free text, for the same reason the workflow
 * engine's failures are: a savings figure attributed to "other" is a savings
 * figure nobody can audit, and a reason string assembled at the call site is a
 * reason string that differs between two call sites doing the same thing.
 */
export const COMPRESSION_REASONS = [
  // Avoidance
  'deterministic_state_available',
  'deterministic_transform_available',
  'calculation_available',
  'structured_result_available',
  'validated_prior_output',
  'reusable_artifact',
  'no_inference_required',
  // Execution
  'inference_required',
  'capability_floor_reached',
  'minimum_profile_sufficient',
  'profile_downgraded',
  'context_reduced',
  'context_within_budget',
  // Escalation
  'quality_evidence_uncertain',
  'quality_evidence_failed',
  'escalation_ceiling_reached',
  'escalation_oscillation_blocked',
  // Stop control
  'no_improvement_signal',
  'attempt_ceiling_reached',
  'insufficient_remaining_budget',
  'marginal_value_below_floor',
  'mandatory_step_protected',
  'safety_work_protected',
  // Refusals
  'quality_contract_unsatisfiable',
  'required_context_exceeds_ceiling',
  'ai_disabled',
  'tenant_mismatch',
] as const;

export type CompressionReason = (typeof COMPRESSION_REASONS)[number];

// ── Quality ─────────────────────────────────────────────────────────────────

/**
 * The floor an optimisation may not go under.
 *
 * COST OPTIMISATION IS SUBORDINATE TO THIS. Every decision the engine makes
 * carries one of these, and an optimisation the engine cannot show still
 * satisfies it is refused rather than applied — see `qualityFloorSatisfied`.
 * "Cheapest" is never an outcome this platform reports as success; the objective
 * is the cheapest PERMITTED execution that still satisfies the required quality
 * contract, which is a different sentence and a different system.
 */
export const QUALITY_PROFILES = ['best_effort', 'standard', 'high', 'critical'] as const;

export type QualityProfile = (typeof QUALITY_PROFILES)[number];

export const QUALITY_RANK: Readonly<Record<QualityProfile, number>> = {
  best_effort: 0,
  standard: 1,
  high: 2,
  critical: 3,
};

// ── Capability profiles ─────────────────────────────────────────────────────

/**
 * A BAND OF CAPABILITY, never a vendor and never a model.
 *
 * The agent runtime already has `ModelProfile`, which binds a band to a
 * registered control plane feature. This is one level more abstract again: the
 * compression engine recommends a BAND, the caller maps the band onto the
 * profiles it is already allowed to request, and the existing router resolves a
 * concrete model under the administrator's allow list. Three layers, one
 * direction — and the reason there is no vendor name anywhere in this tree.
 */
export const CAPABILITY_PROFILES = [
  'economy',
  'standard',
  'reasoning',
  'advanced_reasoning',
] as const;

export type CapabilityProfile = (typeof CAPABILITY_PROFILES)[number];

export const CAPABILITY_RANK: Readonly<Record<CapabilityProfile, number>> = {
  economy: 0,
  standard: 1,
  reasoning: 2,
  advanced_reasoning: 3,
};

/** The next band up, or `undefined` at the ceiling. */
export function nextCapabilityProfile(
  profile: CapabilityProfile,
): CapabilityProfile | undefined {
  const index = CAPABILITY_RANK[profile];
  return index >= CAPABILITY_PROFILES.length - 1 ? undefined : CAPABILITY_PROFILES[index + 1];
}

/**
 * The lowest band that can be trusted with a given quality contract.
 *
 * THE ONE PLACE THE QUALITY FLOOR BECOMES A NUMBER. An optimisation that routed
 * below this is the "route below the required capability profile" attack the
 * adversarial suite exists to catch, and having exactly one definition is what
 * makes catching it a matter of comparing two ranks rather than re-deriving a
 * policy at each call site.
 */
export const QUALITY_CAPABILITY_FLOOR: Readonly<Record<QualityProfile, CapabilityProfile>> = {
  best_effort: 'economy',
  standard: 'economy',
  high: 'standard',
  critical: 'reasoning',
};

/** Does this band satisfy the declared quality contract? */
export function qualityFloorSatisfied(
  profile: CapabilityProfile,
  quality: QualityProfile,
): boolean {
  return CAPABILITY_RANK[profile] >= CAPABILITY_RANK[QUALITY_CAPABILITY_FLOOR[quality]];
}

// ── Typed failures ──────────────────────────────────────────────────────────

export type CompressionFailureCode =
  /** Required context alone does not fit the safe ceiling. Fails CLOSED. */
  | 'required_context_exceeds_ceiling'
  /** The engine cannot establish that the quality contract stays satisfiable. */
  | 'quality_contract_unsatisfiable'
  /** A caller asked the engine to widen something. Refused, always. */
  | 'optimization_would_widen_policy'
  /** Savings attribution did not reconcile, or exceeded its baseline. */
  | 'savings_reconciliation_failed'
  /** Usage was offered for an organization that does not own the scope. */
  | 'usage_tenant_mismatch'
  /** A malformed descriptor, budget or baseline policy. */
  | 'compression_input_invalid';

const TRAITS: Record<CompressionFailureCode, { transport: AIErrorCode; retryable: boolean }> = {
  // Not retryable: the same required context measures the same next time. The
  // resolution is a smaller required set or a larger ceiling, both of which are
  // decisions somebody makes rather than an attempt somebody repeats.
  required_context_exceeds_ceiling: { transport: 'PAYLOAD_TOO_LARGE', retryable: false },
  quality_contract_unsatisfiable: { transport: 'POLICY_DENIED', retryable: false },
  optimization_would_widen_policy: { transport: 'POLICY_DENIED', retryable: false },
  // An accounting defect, not a transient one. Surfacing it as retryable would
  // invite a caller to re-post the same unbalanced ledger.
  savings_reconciliation_failed: { transport: 'INTERNAL_ERROR', retryable: false },
  usage_tenant_mismatch: { transport: 'TENANT_ISOLATION_VIOLATION', retryable: false },
  compression_input_invalid: { transport: 'VALIDATION_FAILED', retryable: false },
};

export interface CompressionErrorOptions {
  /** Server-side detail. Logged and audited, never returned to a caller. */
  readonly diagnostics?: string;
  readonly cause?: unknown;
}

/**
 * Extends `AIError` for the same reason `WorkflowError` does: the platform
 * already owns one caller-safe message, status and retryability mapping, and a
 * second one would be two things to keep in step with one of them drifting.
 */
export class CompressionError extends AIError {
  readonly failure: CompressionFailureCode;

  constructor(
    failure: CompressionFailureCode,
    message: string,
    options: CompressionErrorOptions = {},
  ) {
    const trait = TRAITS[failure];
    super(trait.transport, message, {
      diagnostics: options.diagnostics,
      retryable: trait.retryable,
      cause: options.cause,
    });
    this.name = 'CompressionError';
    this.failure = failure;
  }
}

export function isCompressionError(value: unknown): value is CompressionError {
  return value instanceof CompressionError;
}

export function compressionFailure(
  failure: CompressionFailureCode,
  message: string,
  options: CompressionErrorOptions = {},
): CompressionError {
  return new CompressionError(failure, message, options);
}
