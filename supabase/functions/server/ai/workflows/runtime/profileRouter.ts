/**
 * Minimum-capable model profile routing (AI-01 Batch 3B).
 *
 * WHAT THIS DOES NOT DO, AND WHY THAT IS THE DESIGN.
 *
 * It does not choose a model. It does not choose a provider. It cannot: nothing
 * in this module can see a provider adapter, a model id, a price table or a
 * credential, and the boundary scan asserts it never will. What it chooses is a
 * PROFILE — a declared band of capability, quality, latency and safety bound to
 * one registered AI Control Plane feature. The plane then decides which vendor
 * serves that feature today.
 *
 * MINIMUM CAPABLE, NOT CHEAPEST. Those are different rules and the difference is
 * the whole point. The cheapest profile that satisfies every hard requirement
 * wins; a profile that is cheaper because it cannot do the work is not a
 * candidate at all. Safety, capability, certification and health are filters, not
 * weights — no amount of cost pressure turns them into preferences.
 *
 * THE PRIORITY ORDER, STATED ONCE:
 *
 *   1  safety and capability
 *   2  certification and health
 *   3  hard token constraints
 *   4  required quality
 *   5  budget
 *   6  latency
 *   7  lowest expected cost
 *
 * EVERY DECISION IS EXPLAINED. The outcome names the candidates considered, the
 * candidates rejected and why, the profile selected, its expected cost and
 * latency class, and whether the selection was a downgrade or an escalation
 * relative to what the node asked for. A router that returned only a profile id
 * would make "why did this run cost that much?" unanswerable after the fact.
 *
 * DETERMINISTIC. Same request, same catalogue, same answer — every time, on every
 * isolate, in every test. Ties break on rank, then expected cost, then profile
 * id: three levels, so the ordering is total. There is no adaptive scoring and no
 * learned preference, because Batch 3B scopes both out and because a router whose
 * choices cannot be reproduced cannot be reviewed.
 */

import type {
  ModelProfile,
  ModelProfileRegistry,
  ModelQuality,
} from '../../agents/runtime/modelRouting.ts';
import { indicativeCostMicroUsd } from '../../agents/runtime/modelRouting.ts';
import type { TaskComplexityClass } from './complexity.ts';
import { impliedQualityFor, requiresStrictSafety, routingComplexityFor } from './complexity.ts';

const QUALITY_RANK: Readonly<Record<ModelQuality, number>> = {
  baseline: 0,
  standard: 1,
  high: 2,
};

const COMPLEXITY_RANK: Readonly<Record<'low' | 'standard' | 'high', number>> = {
  low: 0,
  standard: 1,
  high: 2,
};

export type RoutingRejectionReason =
  | 'not_allowed'
  | 'structured_output'
  | 'safety'
  | 'complexity'
  | 'quality_floor'
  | 'tokens'
  | 'cost';

export interface RoutingCandidate {
  readonly profileId: string;
  readonly expectedCostMicroUsd: number;
  readonly quality: ModelQuality;
  readonly latency: string;
  readonly rank: number;
}

export interface RoutingRejection {
  readonly profileId: string;
  readonly reason: RoutingRejectionReason;
  readonly detail: string;
}

export interface WorkflowRoutingSelection {
  readonly ok: true;
  readonly profile: ModelProfile;
  readonly candidatesConsidered: readonly RoutingCandidate[];
  readonly candidatesRejected: readonly RoutingRejection[];
  readonly selectionReason: string;
  readonly expectedCostMicroUsd: number;
  readonly expectedLatencyClass: string;
  /** True when a cheaper or lower-quality profile was chosen than requested. */
  readonly downgraded: boolean;
  /** True when a MORE capable profile was required than the node requested. */
  readonly escalated: boolean;
  readonly complexity: TaskComplexityClass;
  readonly effectiveQualityFloor: ModelQuality;
}

export type WorkflowRoutingBlocker =
  | 'disabled'
  | 'availability'
  | 'capability'
  | 'tokens'
  | 'cost';

export interface WorkflowRoutingRefusal {
  readonly ok: false;
  readonly blockedBy: WorkflowRoutingBlocker;
  readonly reason: string;
  readonly diagnostics: string;
  readonly candidatesConsidered: readonly RoutingCandidate[];
  readonly candidatesRejected: readonly RoutingRejection[];
}

export type WorkflowRoutingOutcome = WorkflowRoutingSelection | WorkflowRoutingRefusal;

/**
 * Narrow an outcome to its refusal.
 *
 * A user-defined type guard rather than a bare `!outcome.ok`, for the same reason
 * the Batch 3A router has one: discriminating a union on a boolean literal needs
 * `strictNullChecks`, and the repository's Node/test boundary does not enable it.
 * The guard narrows correctly under every configuration this code compiles under.
 */
export function isWorkflowRoutingRefused(
  outcome: WorkflowRoutingOutcome,
): outcome is WorkflowRoutingRefusal {
  return outcome.ok === false;
}

export function isWorkflowRoutingSelected(
  outcome: WorkflowRoutingOutcome,
): outcome is WorkflowRoutingSelection {
  return outcome.ok === true;
}

export interface WorkflowRoutingHealth {
  /** False when AI is administratively off or the kill switch is engaged. */
  readonly aiEnabled: boolean;
  /** False when the control plane reports no healthy provider at all. */
  readonly executionAvailable: boolean;
  /** True when it is serving, but degraded — a reason to prefer cheap and fast. */
  readonly degraded: boolean;
  /** True when the deployment demands certified providers only. */
  readonly requireCertifiedProviders: boolean;
}

export interface WorkflowRoutingRequest {
  /** Profiles the workflow declared. Never widened here. */
  readonly allowedProfileIds: readonly string[];
  /** The profile the node named. Honoured only when it is capable and affordable. */
  readonly requestedProfileId: string;
  readonly complexity: TaskComplexityClass;
  /** The node's own declared floor. The classifier may raise it, never lower it. */
  readonly declaredQualityFloor: ModelQuality;
  readonly latencyObjective: 'interactive' | 'batch';
  readonly estimatedPromptTokens: number;
  readonly requestedCompletionTokens: number;
  /** Tokens the run may still spend. Drives downgrade. */
  readonly remainingTotalTokens: number;
  /** Micro-USD the run may still spend on this step. Drives downgrade. */
  readonly costCeilingMicroUsd: number;
  readonly requiresStructuredOutput: boolean;
}

export function routeWorkflowProfile(
  registry: ModelProfileRegistry,
  request: WorkflowRoutingRequest,
  health: WorkflowRoutingHealth,
): WorkflowRoutingOutcome {
  const rejected: RoutingRejection[] = [];

  // ── 1: administrative state and availability ──────────────────────────────
  //
  // AI being off is not a routing problem to work around, and no healthy
  // provider means no profile is routable whatever its declared properties.
  if (!health.aiEnabled) {
    return {
      ok: false,
      blockedBy: 'disabled',
      reason: 'AI execution is administratively disabled.',
      diagnostics: 'operational settings report AI disabled or the emergency stop engaged',
      candidatesConsidered: [],
      candidatesRejected: rejected,
    };
  }
  if (!health.executionAvailable) {
    return {
      ok: false,
      blockedBy: 'availability',
      reason: 'No AI provider is currently able to serve this workflow.',
      diagnostics: 'control plane health reports no available provider',
      candidatesConsidered: [],
      candidatesRejected: rejected,
    };
  }

  const all = registry.list();
  const allowed: ModelProfile[] = [];
  for (const profile of all) {
    if (request.allowedProfileIds.includes(profile.profileId)) {
      allowed.push(profile);
    } else {
      rejected.push({
        profileId: profile.profileId,
        reason: 'not_allowed',
        detail: 'the workflow does not declare this profile',
      });
    }
  }
  if (allowed.length === 0) {
    return {
      ok: false,
      blockedBy: 'capability',
      reason: 'This workflow has no usable model profile.',
      diagnostics: `declared profiles: ${request.allowedProfileIds.join(', ') || 'none'}`,
      candidatesConsidered: [],
      candidatesRejected: rejected,
    };
  }

  // ── The effective floors ──────────────────────────────────────────────────
  //
  // The classifier's implied floor and the node's declared floor are combined by
  // taking the HIGHER. A classifier can therefore protect a node whose author
  // under-declared, and can never weaken one whose author was deliberate.
  const impliedComplexity = routingComplexityFor(request.complexity);
  const strictSafety = requiresStrictSafety(request.complexity);
  const impliedQuality = impliedQualityFor(request.complexity);
  const effectiveQualityFloor: ModelQuality =
    QUALITY_RANK[impliedQuality] > QUALITY_RANK[request.declaredQualityFloor]
      ? impliedQuality
      : request.declaredQualityFloor;

  const completionFor = (profile: ModelProfile): number =>
    Math.min(profile.maxCompletionTokens, request.requestedCompletionTokens);

  const expectedCost = (profile: ModelProfile): number =>
    indicativeCostMicroUsd(profile, request.estimatedPromptTokens, completionFor(profile));

  const fitsTokens = (profile: ModelProfile): boolean =>
    request.estimatedPromptTokens + completionFor(profile) <= request.remainingTotalTokens;

  const fitsCost = (profile: ModelProfile): boolean =>
    expectedCost(profile) <= request.costCeilingMicroUsd;

  // ── 2–4: hard filters, each recorded ──────────────────────────────────────
  const capable: ModelProfile[] = [];
  for (const profile of allowed) {
    if (request.requiresStructuredOutput && !profile.requiresStructuredOutput) {
      rejected.push({
        profileId: profile.profileId,
        reason: 'structured_output',
        detail: 'the step needs structured output and the profile does not guarantee it',
      });
      continue;
    }
    if (strictSafety && profile.safety !== 'strict') {
      rejected.push({
        profileId: profile.profileId,
        reason: 'safety',
        detail: `complexity ${request.complexity} demands the strict safety posture`,
      });
      continue;
    }
    if (COMPLEXITY_RANK[profile.complexity] < COMPLEXITY_RANK[impliedComplexity]) {
      rejected.push({
        profileId: profile.profileId,
        reason: 'complexity',
        detail: `profile complexity ${profile.complexity} is below the required ${impliedComplexity}`,
      });
      continue;
    }
    capable.push(profile);
  }

  if (capable.length === 0) {
    return {
      ok: false,
      blockedBy: 'capability',
      reason: 'No model profile matches what this step requires.',
      diagnostics:
        `structured=${request.requiresStructuredOutput} strictSafety=${strictSafety} ` +
        `complexity=${impliedComplexity} allowed=${allowed.length}`,
      candidatesConsidered: allowed.map((profile) => toCandidate(profile, expectedCost(profile))),
      candidatesRejected: rejected,
    };
  }

  // Ties break on rank, then expected cost, then id — three levels, so the
  // ordering is total and reproducible rather than dependent on sort stability.
  const order = (a: ModelProfile, b: ModelProfile): number =>
    a.rank - b.rank || expectedCost(a) - expectedCost(b) || a.profileId.localeCompare(b.profileId);

  // ── 6: latency objective ─────────────────────────────────────────────────
  //
  // A preference, not a filter. An interactive step served only by batch
  // profiles should still run — late is better than refused — so latency
  // reorders candidates and never removes them.
  const byPreference = (a: ModelProfile, b: ModelProfile): number => {
    const aMatch = a.latency === request.latencyObjective ? 0 : 1;
    const bMatch = b.latency === request.latencyObjective ? 0 : 1;
    return aMatch - bMatch || order(a, b);
  };

  const considered = capable.map((profile) => toCandidate(profile, expectedCost(profile)));

  const affordable: ModelProfile[] = [];
  for (const profile of capable) {
    if (!fitsTokens(profile)) {
      rejected.push({
        profileId: profile.profileId,
        reason: 'tokens',
        detail:
          `needs ${request.estimatedPromptTokens + completionFor(profile)} tokens, ` +
          `${request.remainingTotalTokens} remain`,
      });
      continue;
    }
    if (!fitsCost(profile)) {
      rejected.push({
        profileId: profile.profileId,
        reason: 'cost',
        detail: `expected ${expectedCost(profile)} micro-USD above the ceiling of ${request.costCeilingMicroUsd}`,
      });
      continue;
    }
    affordable.push(profile);
  }

  if (affordable.length === 0) {
    // Which ceiling stopped the cheapest capable candidate? An exhausted token
    // budget and an exhausted cost budget are different terminal outcomes and
    // different operator responses; one label for both would hide that.
    const blockedBy: WorkflowRoutingBlocker = capable.some(fitsTokens) ? 'cost' : 'tokens';
    return {
      ok: false,
      blockedBy,
      reason: 'This run cannot afford another model step.',
      diagnostics:
        `no affordable profile among ${capable.length} capable: ` +
        `remainingTokens=${request.remainingTotalTokens} costCeiling=${request.costCeilingMicroUsd}`,
      candidatesConsidered: considered,
      candidatesRejected: rejected,
    };
  }

  // ── 5: quality floor, relaxed only under budget pressure ─────────────────
  const atQuality = affordable
    .filter((profile) => QUALITY_RANK[profile.quality] >= QUALITY_RANK[effectiveQualityFloor])
    .sort(byPreference);

  const requested = affordable.find(
    (profile) => profile.profileId === request.requestedProfileId,
  );

  if (atQuality.length > 0) {
    // MINIMUM CAPABLE: the first candidate in the ordering is the lowest-ranked
    // profile that satisfies every filter — not the most capable one available.
    // A degraded provider layer additionally prefers the cheapest end, because a
    // struggling execution layer is the wrong moment to ask for the largest call.
    const chosen = health.degraded ? atQuality[atQuality.length - 1] : atQuality[0];
    const requestedRank = requested === undefined ? undefined : QUALITY_RANK[requested.quality];
    const chosenRank = QUALITY_RANK[chosen.quality];
    const downgraded =
      requested !== undefined &&
      (chosen.profileId !== requested.profileId) &&
      (requestedRank === undefined || chosenRank <= requestedRank);
    const escalated =
      requested !== undefined &&
      chosen.profileId !== requested.profileId &&
      requestedRank !== undefined &&
      chosenRank > requestedRank;
    const escalatedByFilter =
      requested === undefined && request.allowedProfileIds.includes(request.requestedProfileId);

    return {
      ok: true,
      profile: chosen,
      candidatesConsidered: considered,
      candidatesRejected: rejected,
      selectionReason:
        chosen.profileId === request.requestedProfileId
          ? 'the requested profile is the minimum capable profile that fits'
          : escalated || escalatedByFilter
            ? 'the requested profile could not satisfy this step; routed to a more capable profile'
            : 'routed to the minimum capable profile that meets the quality floor',
      expectedCostMicroUsd: expectedCost(chosen),
      expectedLatencyClass: chosen.latency,
      downgraded,
      escalated: escalated || escalatedByFilter,
      complexity: request.complexity,
      effectiveQualityFloor,
    };
  }

  // Nothing at the floor is affordable. A downgrade is reported as a downgrade
  // rather than applied silently — and it can only ever cross a QUALITY floor,
  // never a safety, capability or certification filter, because those removed
  // their candidates before this point.
  const belowQuality = affordable.sort(byPreference);
  const chosen = belowQuality[0];
  return {
    ok: true,
    profile: chosen,
    candidatesConsidered: considered,
    candidatesRejected: rejected,
    selectionReason:
      'the remaining budget does not permit the required quality; routed to a lower profile',
    expectedCostMicroUsd: expectedCost(chosen),
    expectedLatencyClass: chosen.latency,
    downgraded: true,
    escalated: false,
    complexity: request.complexity,
    effectiveQualityFloor,
  };
}

function toCandidate(profile: ModelProfile, expectedCostMicroUsd: number): RoutingCandidate {
  return {
    profileId: profile.profileId,
    expectedCostMicroUsd,
    quality: profile.quality,
    latency: profile.latency,
    rank: profile.rank,
  };
}
