/**
 * Minimum-capable profile routing (AI-01 Batch 3B).
 *
 * ONE RULE: never pay for capability the step does not need, and never take
 * capability the step does need.
 *
 * Batch 3A's `routeModelProfile` already decides which profile a step runs on.
 * It honours an explicitly requested profile whenever that profile is capable
 * and affordable, which is correct — an agent that names a profile has a reason
 * — but it means the agent's request is effectively the answer, and an agent
 * naming its most capable profile for every step is the common case.
 *
 * This module reinterprets that request as a CEILING rather than an
 * instruction. Given the step's classified complexity, it finds the cheapest
 * registered profile that still satisfies every hard requirement, and offers it
 * as the request instead — but only when it is genuinely no more capable than
 * what the agent asked for. The result is handed to the certified router, which
 * still applies the allow list, the hard requirements, provider health and
 * affordability. There is no second routing implementation here and no way for
 * this module to admit a profile the router would refuse.
 *
 * THREE THINGS IT CANNOT DO, BY CONSTRUCTION:
 *
 *   IT CANNOT UPGRADE. The candidate set is filtered to profiles whose
 *   indicative cost is at or below the requested profile's. A "smarter" model is
 *   never substituted for the one an agent chose.
 *
 *   IT CANNOT WEAKEN SAFETY. `safety`, `requiresStructuredOutput` and the
 *   complexity floor are hard filters applied here exactly as the router applies
 *   them, so a candidate that fails one is not a candidate.
 *
 *   IT CANNOT REACH OUTSIDE THE ALLOW LIST. Candidates come from the agent's own
 *   `allowedModelProfiles` and nowhere else.
 *
 * The saving it reports is an INDICATIVE PLANNING FIGURE, computed from the same
 * upper-bound rates `modelRouting.ts` uses for projection. It is what the
 * platform expected to avoid, not money settled — the settled figure is what the
 * control plane reports after the call, and the two are carried separately for
 * the same reason `admin/usage.ts` carries estimated and actual cost apart.
 */

import type {
  ModelProfile,
  ModelProfileRegistry,
  ModelSafety,
} from '../agents/runtime/modelRouting.ts';
import { indicativeCostMicroUsd } from '../agents/runtime/modelRouting.ts';
import type { ComplexityClassification } from './complexity.ts';

export interface ProfileSelectionRequest {
  /** The agent's own allow list. Never widened. */
  readonly allowedProfileIds: readonly string[];
  /** What the agent asked for. Treated as a ceiling, not an instruction. */
  readonly requestedProfileId?: string;
  readonly classification: ComplexityClassification;
  readonly requiresStructuredOutput: boolean;
  readonly safety: ModelSafety;
  /** Prompt tokens the step is expected to send. Prices the comparison. */
  readonly estimatedPromptTokens: number;
  /** The run's completion ceiling. Bounds each candidate's allowance. */
  readonly maxCompletionTokens: number;
}

export interface ProfileSelection {
  /** The profile id to hand the certified router as the request. */
  readonly profileId: string;
  /** Present when this is cheaper than what the agent asked for. */
  readonly downgradedFrom?: string;
  /** Indicative micro-USD the substitution is expected to avoid. Never negative. */
  readonly projectedSavingMicroUsd: number;
  /** Caller-safe explanation. Goes into the step record and the audit trail. */
  readonly reason: string;
  /** Candidates considered. Bounded by the agent's allow list. */
  readonly consideredProfiles: number;
}

const COMPLEXITY_RANK: Readonly<Record<ComplexityClassification['complexity'], number>> = {
  low: 0,
  standard: 1,
  high: 2,
};

const QUALITY_RANK: Readonly<Record<ComplexityClassification['minimumQuality'], number>> = {
  baseline: 0,
  standard: 1,
  high: 2,
};

/**
 * Choose the cheapest capable profile at or below the requested one.
 *
 * Returns the requested profile unchanged whenever there is nothing cheaper that
 * is still capable — including when the request names a profile this module
 * cannot see, which is deliberately not an error: routing is the router's job,
 * and an unknown profile is refused there with a precise reason rather than
 * here with a vaguer one.
 */
export function selectMinimumCapableProfile(
  registry: ModelProfileRegistry,
  request: ProfileSelectionRequest,
): ProfileSelection {
  const allowed = registry
    .list()
    .filter((profile) => request.allowedProfileIds.includes(profile.profileId));

  const requested =
    request.requestedProfileId === undefined
      ? undefined
      : allowed.find((profile) => profile.profileId === request.requestedProfileId);

  const capable = allowed.filter((profile) => isCapable(profile, request));

  if (capable.length === 0) {
    return {
      profileId: request.requestedProfileId ?? '',
      projectedSavingMicroUsd: 0,
      reason: 'No cheaper capable profile exists; routing the requested profile.',
      consideredProfiles: allowed.length,
    };
  }

  const priceOf = (profile: ModelProfile): number =>
    indicativeCostMicroUsd(
      profile,
      Math.max(0, Math.floor(request.estimatedPromptTokens)),
      Math.min(profile.maxCompletionTokens, Math.max(1, request.maxCompletionTokens)),
    );

  // Cheapest first, then rank, then id — total and reproducible, the same three
  // levels the certified router breaks its own ties on.
  const cheapestFirst = [...capable].sort(
    (a, b) => priceOf(a) - priceOf(b) || a.rank - b.rank || a.profileId.localeCompare(b.profileId),
  );
  const cheapest = cheapestFirst[0];

  if (!requested) {
    // Nothing named, so there is no ceiling to respect and no downgrade to
    // report — the cheapest capable profile simply IS the minimum-capable one.
    return {
      profileId: cheapest.profileId,
      projectedSavingMicroUsd: 0,
      reason: 'Routed to the minimum-capable profile for this step.',
      consideredProfiles: allowed.length,
    };
  }

  const requestedPrice = priceOf(requested);
  const cheapestPrice = priceOf(cheapest);

  if (cheapest.profileId === requested.profileId || cheapestPrice >= requestedPrice) {
    return {
      profileId: requested.profileId,
      projectedSavingMicroUsd: 0,
      reason: 'The requested profile is already the minimum capable one.',
      consideredProfiles: allowed.length,
    };
  }

  return {
    profileId: cheapest.profileId,
    downgradedFrom: requested.profileId,
    projectedSavingMicroUsd: Math.max(0, requestedPrice - cheapestPrice),
    reason: `Step classified ${request.classification.complexity}; routed to the minimum-capable profile.`,
    consideredProfiles: allowed.length,
  };
}

/**
 * The hard requirements, applied exactly as `routeModelProfile` applies them.
 *
 * Deliberately a copy of the router's predicate rather than a looser one: a
 * candidate this module admits that the router then refuses would turn an
 * optimisation into a routing failure, and the failure would name the profile
 * this module chose rather than the reason it was unsuitable.
 */
function isCapable(profile: ModelProfile, request: ProfileSelectionRequest): boolean {
  if (request.requiresStructuredOutput && !profile.requiresStructuredOutput) return false;
  if (request.safety === 'strict' && profile.safety !== 'strict') return false;
  if (COMPLEXITY_RANK[profile.complexity] < COMPLEXITY_RANK[request.classification.complexity]) {
    return false;
  }
  if (QUALITY_RANK[profile.quality] < QUALITY_RANK[request.classification.minimumQuality]) {
    return false;
  }
  return true;
}
