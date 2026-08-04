/**
 * Model routing foundation (AI-01 Batch 3A).
 *
 * WHAT THIS DOES NOT DO, AND WHY THAT IS THE DESIGN.
 *
 * It does not choose a model. It does not choose a provider. It cannot: nothing
 * in this module can see a provider adapter, a model id, a price table or a
 * credential, and the boundary scan asserts that it never will.
 *
 * What it chooses is a PROFILE — a declared band of capability, quality,
 * latency and safety, bound to one registered AI Control Plane feature. The
 * control plane then does what it has done since Batch 1: match the feature's
 * requirements against model capabilities, apply the administrator's allow list
 * and pinned default, respect provider health and certification, and select.
 *
 * That split is what keeps provider independence real. An agent asks for
 * "structured reasoning, standard quality, interactive latency". A profile says
 * which governed feature serves that. The control plane says which vendor
 * serves that today. Three layers, one direction, and no layer knows the layer
 * two below it.
 *
 * ROUTING IS DETERMINISTIC. Given the same request and the same profile
 * catalogue, the same profile is chosen — every time, on every isolate, in
 * every test. There is no adaptive scoring, no learned preference and no
 * randomness, because AI-01 Batch 3A explicitly scopes those out and because an
 * orchestrator whose routing cannot be reproduced cannot be reasoned about
 * after an incident.
 */

import type { AgentLimits } from '../contracts/agent.ts';
import { agentFailure } from '../contracts/failures.ts';

export type ModelComplexity = 'low' | 'standard' | 'high';
export type ModelQuality = 'baseline' | 'standard' | 'high';
export type ModelLatency = 'interactive' | 'batch';
export type ModelSafety = 'standard' | 'strict';

/**
 * One routable band of model behaviour.
 *
 * `featureId` is the join to the existing control plane: the profile executes
 * by invoking that registered feature, with its prompt, its governance rules,
 * its output contract and its own limits. A profile therefore cannot widen what
 * a feature permits — it can only select between features that already exist.
 */
export interface ModelProfile {
  readonly profileId: string;
  /** The registered AI Control Plane feature this profile executes through. */
  readonly featureId: string;
  readonly displayName: string;
  readonly complexity: ModelComplexity;
  readonly quality: ModelQuality;
  readonly latency: ModelLatency;
  readonly safety: ModelSafety;
  readonly requiresStructuredOutput: boolean;
  /** Completion allowance this profile requests. Bounded by the feature's own. */
  readonly maxCompletionTokens: number;
  /**
   * Indicative price band, in micro-USD per 1k tokens, used for PRE-CALL cost
   * estimation only. The authoritative price is the provider registry's, and
   * the authoritative cost is what the control plane reports after the call —
   * this is an upper-bound planning figure and is documented as such wherever
   * it is consumed.
   */
  readonly indicativePromptMicroUsdPer1k: number;
  readonly indicativeCompletionMicroUsdPer1k: number;
  /** Ordering within a tie. Lower is preferred. */
  readonly rank: number;
}

export interface ModelProfileRegistry {
  register(profile: ModelProfile): void;
  registerAll(profiles: readonly ModelProfile[]): void;
  find(profileId: string): ModelProfile | undefined;
  list(): readonly ModelProfile[];
  size(): number;
}

const PROFILE_ID = /^profile\.[a-z0-9]+(\.[a-z0-9_]+)+$/;

export function createModelProfileRegistry(): ModelProfileRegistry {
  const profiles = new Map<string, ModelProfile>();
  return {
    register(profile) {
      const problems: string[] = [];
      if (!PROFILE_ID.test(profile.profileId ?? '')) {
        problems.push('profileId must look like profile.reasoning.standard');
      }
      if (!profile.featureId?.trim()) problems.push('featureId is empty');
      if (!(profile.maxCompletionTokens > 0)) problems.push('maxCompletionTokens must be positive');
      if (profiles.has(profile.profileId)) problems.push('profile is already registered');
      if (problems.length > 0) {
        throw agentFailure('invalid_action', 'Model profile is invalid.', {
          diagnostics: `${profile.profileId ?? '(no id)'}: ${problems.join('; ')}`,
        });
      }
      profiles.set(profile.profileId, profile);
    },
    registerAll(incoming) {
      for (const profile of incoming) this.register(profile);
    },
    find: (profileId) => profiles.get(profileId),
    list: () => [...profiles.values()].sort((a, b) => a.rank - b.rank),
    size: () => profiles.size,
  };
}

/** What the runtime knows about the execution layer's current condition. */
export interface RoutingHealth {
  /** False when the control plane reports no healthy provider at all. */
  readonly executionAvailable: boolean;
  /** True when it is serving, but degraded — a reason to prefer cheap and fast. */
  readonly degraded: boolean;
  /** False when AI is administratively off or the kill switch is engaged. */
  readonly aiEnabled: boolean;
  /** True when the deployment demands certified providers only. */
  readonly requireCertification: boolean;
}

export interface RoutingRequest {
  /** Profiles the agent is permitted to request. Never widened here. */
  readonly allowedProfileIds: readonly string[];
  /** The profile the agent asked for, if it named one. */
  readonly requestedProfileId?: string;
  readonly requiresStructuredOutput: boolean;
  readonly complexity: ModelComplexity;
  readonly minimumQuality: ModelQuality;
  readonly latency: ModelLatency;
  readonly safety: ModelSafety;
  /** Tokens the step may still spend. Drives downgrade. */
  readonly remainingTotalTokens: number;
  /** Micro-USD the run may still spend. Drives downgrade. */
  readonly remainingCostMicroUsd: number;
  readonly estimatedPromptTokens: number;
  readonly limits: AgentLimits;
}

/**
 * Why routing could not produce a profile.
 *
 * The distinction is not cosmetic: it decides which terminal state the run
 * ends in and whether a retry could ever help. "No provider is up" and "this
 * run cannot afford another token" are both refusals, and reporting them
 * identically would put a temporary outage and an exhausted budget in the same
 * bucket on the operator console.
 */
export type RoutingBlocker =
  | 'disabled'
  | 'availability'
  | 'capability'
  | 'tokens'
  | 'cost';

export interface RoutingSelection {
  readonly ok: true;
  readonly profile: ModelProfile;
  /** True when a cheaper profile was chosen than the one requested. */
  readonly downgraded: boolean;
  readonly reason: string;
}

export interface RoutingRefusal {
  readonly ok: false;
  readonly blockedBy: RoutingBlocker;
  readonly reason: string;
  readonly diagnostics: string;
}

export type RoutingOutcome = RoutingSelection | RoutingRefusal;

/**
 * Narrow an outcome to its refusal.
 *
 * A user-defined type guard rather than a bare `!outcome.ok`, for the same
 * reason `policy/spendLedger.ts` has `isSpendDenied`: discriminating a union on
 * a boolean literal needs `strictNullChecks`, and the repository's Node/test
 * boundary (`tsconfig.node.json`) does not enable it. The guard narrows
 * correctly under every configuration this code is compiled by, which is
 * preferable to a suppression comment or to the same logic being type-safe in
 * one toolchain and unchecked in another.
 */
export function isRoutingRefused(outcome: RoutingOutcome): outcome is RoutingRefusal {
  return outcome.ok === false;
}

/** Narrow an outcome to its selection. See `isRoutingRefused` for why. */
export function isRoutingSelected(outcome: RoutingOutcome): outcome is RoutingSelection {
  return outcome.ok === true;
}

const QUALITY_RANK: Readonly<Record<ModelQuality, number>> = {
  baseline: 0,
  standard: 1,
  high: 2,
};

const COMPLEXITY_RANK: Readonly<Record<ModelComplexity, number>> = {
  low: 0,
  standard: 1,
  high: 2,
};

/** Indicative worst-case micro-USD for one call on this profile. */
export function indicativeCostMicroUsd(
  profile: ModelProfile,
  promptTokens: number,
  completionTokens: number,
): number {
  return Math.ceil(
    (promptTokens * profile.indicativePromptMicroUsdPer1k) / 1000 +
      (completionTokens * profile.indicativeCompletionMicroUsdPer1k) / 1000,
  );
}

/**
 * Choose a profile.
 *
 * The order of the filters is the policy, stated once:
 *
 *   1. Administrative state. AI off is not a routing problem to work around.
 *   2. Execution availability. No healthy provider means no profile is routable.
 *   3. The agent's allow list. A profile it may not request is not a candidate,
 *      whatever its properties.
 *   4. Hard requirements: structured output, safety, complexity headroom.
 *   5. Quality floor — relaxed ONLY under budget pressure, and reported as a
 *      downgrade rather than applied silently.
 *   6. Affordability. A profile whose indicative cost exceeds what is left is
 *      not a candidate; that is what makes the downgrade path real rather than
 *      decorative.
 *
 * Ties break on rank, then on indicative cost, then on profile id — three
 * levels, so the result is total and reproducible.
 */
export function routeModelProfile(
  registry: ModelProfileRegistry,
  request: RoutingRequest,
  health: RoutingHealth,
): RoutingOutcome {
  if (!health.aiEnabled) {
    return {
      ok: false,
      blockedBy: 'disabled',
      reason: 'AI execution is administratively disabled.',
      diagnostics: 'operational settings report AI disabled or the emergency stop engaged',
    };
  }
  if (!health.executionAvailable) {
    return {
      ok: false,
      blockedBy: 'availability',
      reason: 'No AI provider is currently able to serve this run.',
      diagnostics: 'control plane health reports no available provider',
    };
  }

  const allowed = registry
    .list()
    .filter((profile) => request.allowedProfileIds.includes(profile.profileId));
  if (allowed.length === 0) {
    return {
      ok: false,
      blockedBy: 'capability',
      reason: 'This agent has no usable model profile.',
      diagnostics: `agent profiles: ${request.allowedProfileIds.join(', ') || 'none'}`,
    };
  }

  /**
   * Tokens and cost are checked separately, not folded into one predicate.
   * A run that is out of tokens and a run that is out of money are different
   * terminal outcomes, and a single `affordable()` boolean cannot say which.
   */
  const completionFor = (profile: ModelProfile): number =>
    Math.min(profile.maxCompletionTokens, request.limits.maxCompletionTokens);

  const fitsTokens = (profile: ModelProfile): boolean =>
    request.estimatedPromptTokens + completionFor(profile) <= request.remainingTotalTokens;

  const fitsCost = (profile: ModelProfile): boolean =>
    indicativeCostMicroUsd(profile, request.estimatedPromptTokens, completionFor(profile)) <=
    request.remainingCostMicroUsd;

  const affordable = (profile: ModelProfile): boolean => fitsTokens(profile) && fitsCost(profile);

  /** Which ceiling stopped the cheapest capable candidate. */
  const blockerFor = (candidates: readonly ModelProfile[]): 'tokens' | 'cost' =>
    candidates.some(fitsTokens) ? 'cost' : 'tokens';

  const meetsHardRequirements = (profile: ModelProfile): boolean => {
    if (request.requiresStructuredOutput && !profile.requiresStructuredOutput) return false;
    if (request.safety === 'strict' && profile.safety !== 'strict') return false;
    if (COMPLEXITY_RANK[profile.complexity] < COMPLEXITY_RANK[request.complexity]) return false;
    return true;
  };

  const order = (a: ModelProfile, b: ModelProfile): number =>
    a.rank - b.rank ||
    indicativeCostMicroUsd(a, request.estimatedPromptTokens, a.maxCompletionTokens) -
      indicativeCostMicroUsd(b, request.estimatedPromptTokens, b.maxCompletionTokens) ||
    a.profileId.localeCompare(b.profileId);

  const capable = allowed.filter(meetsHardRequirements);
  if (capable.length === 0) {
    return {
      ok: false,
      blockedBy: 'capability',
      reason: 'No model profile matches what this step requires.',
      diagnostics:
        `structured=${request.requiresStructuredOutput} safety=${request.safety} ` +
        `complexity=${request.complexity} candidates=${allowed.length}`,
    };
  }

  // An explicitly requested profile is honoured when it is capable and
  // affordable. It never overrides a hard requirement — a request that names an
  // unsuitable profile is a routing failure, not a licence to run it anyway.
  if (request.requestedProfileId !== undefined) {
    const requested = capable.find((profile) => profile.profileId === request.requestedProfileId);
    if (requested && affordable(requested)) {
      return { ok: true, profile: requested, downgraded: false, reason: 'requested profile' };
    }
    if (requested && !affordable(requested)) {
      const cheaper = capable
        .filter(affordable)
        .sort(order)
        .find(() => true);
      if (cheaper) {
        return {
          ok: true,
          profile: cheaper,
          downgraded: true,
          reason: 'requested profile exceeds the remaining budget; routed to an affordable profile',
        };
      }
      return {
        ok: false,
        blockedBy: blockerFor(capable),
        reason: 'This run cannot afford another model step.',
        diagnostics:
          `no affordable profile: remainingTokens=${request.remainingTotalTokens} ` +
          `remainingCost=${request.remainingCostMicroUsd}`,
      };
    }
    return {
      ok: false,
      blockedBy: 'capability',
      reason: 'The requested model profile is not usable for this step.',
      diagnostics: `requested=${request.requestedProfileId}`,
    };
  }

  const atQuality = capable
    .filter((profile) => QUALITY_RANK[profile.quality] >= QUALITY_RANK[request.minimumQuality])
    .filter(affordable)
    .sort(order);
  if (atQuality.length > 0) {
    // Degraded execution prefers the cheapest capable profile: a struggling
    // provider layer is the wrong moment to ask for the most expensive call.
    const chosen = health.degraded ? atQuality[atQuality.length - 1] : atQuality[0];
    return { ok: true, profile: chosen, downgraded: false, reason: 'meets the quality floor' };
  }

  const belowQuality = capable.filter(affordable).sort(order);
  if (belowQuality.length > 0) {
    return {
      ok: true,
      profile: belowQuality[0],
      downgraded: true,
      reason: 'budget does not permit the requested quality; routed to a lower profile',
    };
  }

  return {
    ok: false,
    blockedBy: blockerFor(capable),
    reason: 'This run cannot afford another model step.',
    diagnostics:
      `no affordable profile among ${capable.length} capable: ` +
      `remainingTokens=${request.remainingTotalTokens} remainingCost=${request.remainingCostMicroUsd}`,
  };
}
