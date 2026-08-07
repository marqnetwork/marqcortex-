/**
 * Zero-LLM admission (AI-01 Batch 3B, Part 6A).
 *
 * ── THE CHEAPEST INFERENCE IS THE ONE THAT NEVER HAPPENS ───────────────────
 *
 * Everything else in this tree makes a call smaller. This asks whether the call
 * needs to exist, and it runs FIRST, because a 40% context reduction on a call
 * that should never have been made is a 40% reduction of pure waste.
 *
 * ── WHAT IT WILL AND WILL NOT DO ───────────────────────────────────────────
 *
 * It RECOGNISES an already-authorised non-inference path and reports that
 * inference is unnecessary. It does not invent business logic, does not execute
 * deterministic code, and does not decide that a path exists — the caller
 * declares its own capabilities and its own validated prior outputs, because the
 * caller is the component that has actually been certified to run them. An
 * optimiser that could execute arbitrary logic would be a second execution path,
 * and this batch forbids exactly that.
 *
 * ── THE THREE THINGS A CANDIDATE PATH HAS TO CLEAR ─────────────────────────
 *
 *   COVERAGE   It must satisfy the task's KIND. A transformer that handles
 *              `transformation` does not get to answer a `reasoning` task
 *              because both were declared by the same caller.
 *
 *   COMPLETENESS  It must produce the WHOLE answer. `complete: false` is not an
 *              avoidance; a partial deterministic path leaves an inference to
 *              make, and claiming the saving anyway is how avoided-call counts
 *              stop matching provider invoices.
 *
 *   QUALITY    Its certified quality must meet the task's contract. This is the
 *              same subordination rule the whole batch runs on: cheaper never
 *              wins against the declared quality floor, and "we answered it
 *              deterministically" is not an exemption from that.
 *
 * A validated prior output clears one more: it must belong to the SAME tenant.
 * Reuse across an organization boundary is a data leak that arrives disguised as
 * a cost saving, so the check is here rather than assumed of the caller.
 */

import type {
  AiTaskDescriptor,
  DeterministicCapability,
  ValidatedPriorOutput,
} from '../contracts/task.ts';
import type { CompressionDecision, CompressionReason } from '../contracts/compression.ts';
import { QUALITY_RANK } from '../contracts/compression.ts';
import type { AiTaskKind } from '../contracts/task.ts';

/** The reason an avoidance was possible, per task kind. */
const KIND_REASON: Readonly<Record<AiTaskKind, CompressionReason>> = {
  retrieval: 'structured_result_available',
  transformation: 'deterministic_transform_available',
  calculation: 'calculation_available',
  extraction: 'deterministic_transform_available',
  classification: 'deterministic_state_available',
  summarization: 'deterministic_transform_available',
  generation: 'deterministic_transform_available',
  reasoning: 'deterministic_state_available',
  planning: 'deterministic_state_available',
  review: 'deterministic_state_available',
};

export interface AdmissionOutcome {
  /** One of `avoid`, `deterministic`, `reuse` or `execute`. Never a refusal. */
  readonly decision: CompressionDecision;
  readonly reason: CompressionReason;
  /** True when no provider call is needed. */
  readonly inferenceAvoided: boolean;
  /** The authorised path that answers it, when one does. */
  readonly capabilityId?: string;
  /** The prior artefact that answers it, when one does. */
  readonly artifactId?: string;
  /** Caller-safe explanation. Goes onto the audit record verbatim. */
  readonly explanation: string;
  readonly diagnostics: string;
}

function capabilityCovers(
  capability: DeterministicCapability,
  task: AiTaskDescriptor,
): boolean {
  return (
    capability.satisfies.includes(task.kind) &&
    capability.complete &&
    QUALITY_RANK[capability.maximumQuality] >= QUALITY_RANK[task.quality]
  );
}

function priorCovers(prior: ValidatedPriorOutput, task: AiTaskDescriptor): boolean {
  return (
    prior.organizationId === task.organizationId &&
    prior.contractValidated &&
    QUALITY_RANK[prior.quality] >= QUALITY_RANK[task.quality]
  );
}

/**
 * Decide whether this task needs a model at all.
 *
 * Order is the policy: a deterministic path beats a reused artefact, because a
 * computed answer is current by construction and a stored one is current only
 * until something changes. Reuse beats execution for the obvious reason.
 *
 * Ties within a category break on `capabilityId` / `artifactId` so that a caller
 * offering two equivalent paths gets the same one chosen every time — a
 * non-deterministic tie-break would make the whole admission irreproducible for
 * the sake of nothing.
 */
export function admitWithoutInference(task: AiTaskDescriptor): AdmissionOutcome {
  const deterministic = [...task.deterministicCapabilities]
    .filter((capability) => capabilityCovers(capability, task))
    .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))[0];

  if (deterministic) {
    return {
      decision: 'deterministic',
      reason: KIND_REASON[task.kind],
      inferenceAvoided: true,
      capabilityId: deterministic.capabilityId,
      explanation: 'This task was answered without an AI model call.',
      diagnostics:
        `capability=${deterministic.capabilityId} kind=${task.kind} quality=${task.quality}`,
    };
  }

  const prior = [...task.priorOutputs]
    .filter((candidate) => priorCovers(candidate, task))
    .sort((a, b) => a.artifactId.localeCompare(b.artifactId))[0];

  if (prior) {
    return {
      decision: 'reuse',
      reason: 'validated_prior_output',
      inferenceAvoided: true,
      artifactId: prior.artifactId,
      explanation: 'This task was answered from a validated earlier result.',
      diagnostics: `artifact=${prior.artifactId} digest=${prior.digest} quality=${prior.quality}`,
    };
  }

  // Nothing covered it. Report WHY inference remains necessary rather than
  // simply that it does — "there was a candidate and it was incomplete" and
  // "there was no candidate" are different operational facts, and the first one
  // is the one worth acting on.
  const offered = task.deterministicCapabilities.length + task.priorOutputs.length;
  return {
    decision: 'execute',
    reason: 'inference_required',
    inferenceAvoided: false,
    explanation: 'This task requires an AI model call.',
    diagnostics:
      offered === 0
        ? `no non-inference path declared for kind=${task.kind}`
        : `${offered} non-inference candidates declared, none covers ` +
          `kind=${task.kind} at quality=${task.quality}`,
  };
}
