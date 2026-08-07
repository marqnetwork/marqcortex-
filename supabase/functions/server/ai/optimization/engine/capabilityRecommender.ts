/**
 * Minimum-capable profile recommendation (AI-01 Batch 3B, Part 6A).
 *
 * ── THIS IS NOT A SECOND PROVIDER SELECTOR ─────────────────────────────────
 *
 * The platform has exactly one component that resolves a concrete model, and it
 * is the AI Control Plane's provider selector, applying the administrator's
 * allow list, the pinned default, provider health and certification. The agent
 * runtime already sits above it with `modelRouting.ts`, which chooses a
 * `ModelProfile` bound to a registered feature. This sits above THAT and chooses
 * a BAND — economy, standard, reasoning, advanced_reasoning — and hands it back
 * as a recommendation.
 *
 * The distinction is not bureaucratic. Nothing in this file can name a vendor,
 * name a model, read a credential, see a price table for a specific model or
 * reach a provider adapter, and the boundary scan asserts that on the source. A
 * band is a statement about the WORK; a model is a statement about the market.
 *
 * ── THE RECOMMENDATION CANNOT WIDEN ANYTHING ───────────────────────────────
 *
 * Three clamps, and all three narrow:
 *
 *   THE ALLOW LIST   Candidates come from `envelope.allowedCapabilityProfiles`,
 *                    which the caller supplies from its own certified set. The
 *                    engine filters that array; it has no way to add to it.
 *
 *   THE CALLER'S MAXIMUM  Nothing above `envelope.maximumCapabilityProfile` is a
 *                    candidate, so a recommendation can never be an upgrade on
 *                    what the caller would have done unoptimised. An optimiser
 *                    that could route UP is an optimiser that can raise a bill
 *                    while reporting a saving.
 *
 *   THE QUALITY FLOOR  Nothing below `QUALITY_CAPABILITY_FLOOR[quality]` or below
 *                    the classifier's own requirement is a candidate. This is
 *                    the rule the adversarial suite attacks directly, because
 *                    "route below the required capability profile" is the
 *                    single cheapest way to manufacture a savings number.
 *
 * When the floors and the allow list have no overlap, the answer is ESCALATE —
 * a typed statement that the minimum sufficient band is not available here — and
 * never "use the closest thing". Silently serving a `critical` task from an
 * economy band would be a governance failure wearing an optimisation's clothes.
 */

import type { CapabilityProfile, CompressionReason } from '../contracts/compression.ts';
import {
  CAPABILITY_RANK,
  QUALITY_CAPABILITY_FLOOR,
  qualityFloorSatisfied,
} from '../contracts/compression.ts';
import type { AiTaskDescriptor, ControlPlaneEnvelope } from '../contracts/task.ts';

export interface CapabilityRecommendation {
  readonly ok: true;
  /** The lowest band that clears every floor and is permitted. */
  readonly profile: CapabilityProfile;
  /** True when it is below what the caller would have used unoptimised. */
  readonly downgraded: boolean;
  /** Bands skipped between the recommendation and the caller's maximum. */
  readonly stepsSaved: number;
  readonly reason: CompressionReason;
  readonly diagnostics: string;
}

export interface CapabilityEscalation {
  readonly ok: false;
  /** The band the task actually needs, whether or not it is available. */
  readonly requiredProfile: CapabilityProfile;
  readonly reason: CompressionReason;
  readonly diagnostics: string;
}

export type CapabilityOutcome = CapabilityRecommendation | CapabilityEscalation;

/**
 * Narrow an outcome to its escalation.
 *
 * A user-defined type guard rather than `!outcome.ok`, for the reason the agent
 * runtime's `isRoutingRefused` gives: discriminating a union on a boolean
 * literal needs `strictNullChecks`, and the repository's Node/test boundary does
 * not enable it. The guard narrows identically under both toolchains.
 */
export function isCapabilityEscalation(
  outcome: CapabilityOutcome,
): outcome is CapabilityEscalation {
  return outcome.ok === false;
}

export function isCapabilityRecommended(
  outcome: CapabilityOutcome,
): outcome is CapabilityRecommendation {
  return outcome.ok === true;
}

export interface CapabilityRecommendationInput {
  readonly task: AiTaskDescriptor;
  readonly envelope: ControlPlaneEnvelope;
  /** The band the complexity classifier says the work needs. */
  readonly requiredByComplexity: CapabilityProfile;
  /**
   * Bands already attempted in this task, so a recommendation after a failed
   * cheap attempt does not recommend the same band again.
   */
  readonly attemptedProfiles?: readonly CapabilityProfile[];
}

/** Recommend the minimum sufficient band. */
export function recommendCapabilityProfile(
  input: CapabilityRecommendationInput,
): CapabilityOutcome {
  const { envelope, task } = input;
  const attempted = input.attemptedProfiles ?? [];

  // The floor is the HIGHER of the two independent requirements. A trivial task
  // under a `critical` contract does not get an economy band for being trivial,
  // and a complex task under a `best_effort` contract does not get one for being
  // cheap to fail at.
  const floor: CapabilityProfile =
    CAPABILITY_RANK[input.requiredByComplexity] >=
    CAPABILITY_RANK[QUALITY_CAPABILITY_FLOOR[task.quality]]
      ? input.requiredByComplexity
      : QUALITY_CAPABILITY_FLOOR[task.quality];

  const ceiling = envelope.maximumCapabilityProfile;

  const candidates = envelope.allowedCapabilityProfiles
    .filter((profile) => CAPABILITY_RANK[profile] >= CAPABILITY_RANK[floor])
    .filter((profile) => CAPABILITY_RANK[profile] <= CAPABILITY_RANK[ceiling])
    .filter((profile) => qualityFloorSatisfied(profile, task.quality))
    .filter((profile) => !attempted.includes(profile))
    .sort((a, b) => CAPABILITY_RANK[a] - CAPABILITY_RANK[b]);

  if (candidates.length === 0) {
    return {
      ok: false,
      requiredProfile: floor,
      reason: 'capability_floor_reached',
      diagnostics:
        `no permitted profile at or above ${floor} within ceiling ${ceiling}: ` +
        `allowed=[${envelope.allowedCapabilityProfiles.join(',')}] ` +
        `attempted=[${attempted.join(',')}] quality=${task.quality}`,
    };
  }

  const profile = candidates[0];
  const downgraded = CAPABILITY_RANK[profile] < CAPABILITY_RANK[ceiling];

  return {
    ok: true,
    profile,
    downgraded,
    stepsSaved: CAPABILITY_RANK[ceiling] - CAPABILITY_RANK[profile],
    reason: downgraded ? 'profile_downgraded' : 'minimum_profile_sufficient',
    diagnostics:
      `floor=${floor} ceiling=${ceiling} chosen=${profile} quality=${task.quality} ` +
      `complexityFloor=${input.requiredByComplexity}`,
  };
}
