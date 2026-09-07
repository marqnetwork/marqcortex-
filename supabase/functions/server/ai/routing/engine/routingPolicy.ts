/**
 * The Routing Policy — AI-01 Batch 4F.
 *
 * A pure, deterministic function from a set of ALREADY-ELIGIBLE candidates to
 * an ordered execution plan. Same signals in, same order out, on every isolate,
 * forever. There is no randomness here and there must never be: a platform that
 * cannot reproduce why a request went to a particular vendor cannot explain a
 * bill, and "explain the bill" is most of what economics means.
 *
 * ── THE FOUR INVARIANTS ─────────────────────────────────────────────────────
 *
 * Every strategy is subject to all four. They are applied as sort keys ahead of
 * whatever the strategy optimises for, so a strategy cannot express a
 * preference that would breach one.
 *
 *   1. ROUTING NEVER ADMITS.  The output is a subset of the input. The only
 *      reason a candidate is dropped is the governed failover breadth, and the
 *      ones dropped are named. Asserted below, not merely intended.
 *
 *   2. THE FALLBACK STAYS LAST.  `AI_FALLBACK_PROVIDER` names the provider a
 *      deployment wants tried when nothing else can serve. Batch 1 made that a
 *      selection guarantee. A cost strategy that promoted a cheap fallback to
 *      first place would repeal it silently — so the fallback is pinned to the
 *      tail regardless of strategy.
 *
 *   3. A PROVIDER THAT CHARGES NOTHING IS NOT THEREFORE THE BEST VALUE.  The
 *      mock adapter costs zero, which under a naive cost ranking makes it the
 *      cheapest thing on the platform and every request a synthetic completion.
 *      `runtime/config.ts` already warns about exactly this failure — a
 *      deployment that authorised real spending, looks healthy, costs nothing,
 *      and is wrong about every answer it gives. Non-billable providers are
 *      therefore never promoted ABOVE a billable one by an economic or
 *      operational strategy. When real requests are off, the billable providers
 *      are not eligible in the first place and the tier is empty, so the mock
 *      still serves — as it should.
 *
 *   4. AN UNPROVEN CIRCUIT IS NOT A HEALTHY ONE.  A `half_open` provider admits
 *      one probe at a time and may well re-open on it. Ranking one ahead of a
 *      closed circuit spends a user's request on a health check.
 *
 * ── WHY `preference` RETURNS THE INPUT ORDER UNTOUCHED ──────────────────────
 *
 * It is the default strategy, and a batch that changed how every existing
 * deployment routes on the day it shipped would be a batch nobody could deploy
 * incrementally. Under `preference` the four invariants are already satisfied
 * by the selector's own ordering — it puts the fallback last and follows the
 * administrator's list — so re-sorting could only introduce a difference. The
 * breadth truncation still applies, because that is a spend bound rather than
 * an ordering.
 */

import type {
  RoutedCandidate,
  RoutingDecision,
  RoutingSignal,
  RoutingStrategy,
  RoutingWorkload,
} from '../contracts/routing.ts';
import { projectAttemptCostMicroUsd } from './economics.ts';

export interface RoutingPolicyOptions {
  readonly strategy: RoutingStrategy;
  /**
   * How many providers one request may be routed across, at most.
   *
   * Bounds failover breadth, which was unbounded before this batch: a request
   * walked every eligible candidate. Bounding it bounds the worst-case latency
   * of a request that is going to fail anyway, and — with the billable attempt
   * budget — bounds what a single request can spend.
   */
  readonly maxProviders: number;
  /** When false, the plan holds exactly one provider. */
  readonly failoverEnabled: boolean;
}

/** Absolute bounds on the failover breadth, applied wherever it is read. */
export const ROUTING_BOUNDS = {
  maxProviders: { min: 1, max: 6 },
} as const;

export function clampMaxProviders(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(
    ROUTING_BOUNDS.maxProviders.max,
    Math.max(ROUTING_BOUNDS.maxProviders.min, Math.round(value)),
  );
}

/**
 * A provider's operational health as one integer, 0–100. Higher is healthier.
 *
 * Deterministic and bounded, built only from facts the registry and the breaker
 * already publish. It is a RANKING aid and nothing else: it cannot admit a
 * provider, cannot exclude one, and is never compared against a threshold that
 * would make it a gate in disguise.
 */
export function healthScore(signal: RoutingSignal): number {
  let score = 100;

  // The circuit is the strongest signal available, because it is the only one
  // that reflects a decision the platform has already taken about this provider.
  if (signal.circuit === 'half_open') score -= 40;

  // Consecutive failures are recent and specific: three in a row says something
  // a 2% lifetime failure rate does not.
  score -= Math.min(45, signal.consecutiveFailures * 15);

  // The observed failure ratio, which is slower-moving and therefore weighted
  // less. A provider with no observations at all is neither rewarded nor
  // punished for it here — see the latency strategy for how unproven is treated.
  const observations = signal.successCount + signal.failureCount;
  if (observations > 0) {
    score -= Math.round((signal.failureCount / observations) * 25);
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * The tier a candidate sorts into before any strategy is consulted.
 *
 * Lower is earlier. Invariants 2 and 3 live here, which is why they cannot be
 * expressed away by a strategy: a strategy only ever breaks a tie WITHIN a tier.
 */
function tierOf(signal: RoutingSignal): number {
  if (signal.isFallback) return 2;
  return signal.billable ? 0 : 1;
}

/** Invariant 4, as a sort key. Lower is earlier. */
function circuitTierOf(signal: RoutingSignal): number {
  return signal.circuit === 'half_open' ? 1 : 0;
}

interface Ranked {
  readonly signal: RoutingSignal;
  readonly projectedMicroUsd: number;
  readonly score: number;
}

/** The strategy's own key. Lower sorts earlier, in every strategy. */
function strategyKey(strategy: RoutingStrategy, ranked: Ranked): number {
  switch (strategy) {
    case 'cost':
      return ranked.projectedMicroUsd;
    case 'latency':
      // An unproven provider is not a fast one. `Number.MAX_SAFE_INTEGER` puts
      // it behind every provider that has actually answered, and the
      // preference index still orders the unproven ones among themselves.
      return ranked.signal.observedLatencyMs ?? Number.MAX_SAFE_INTEGER;
    case 'resilience':
      // Higher score is better, so it is negated into a "lower sorts earlier"
      // key like the others rather than needing its own comparison direction.
      return -ranked.score;
    case 'preference':
      return ranked.signal.preferenceIndex;
  }
}

function reasonFor(strategy: RoutingStrategy, ranked: Ranked): string {
  if (ranked.signal.isFallback) return 'configured last-resort provider';
  if (!ranked.signal.billable) return 'non-billable provider, ranked after paid capacity';
  if (ranked.signal.circuit === 'half_open') return 'circuit half-open, ranked after proven capacity';
  switch (strategy) {
    case 'cost':
      return `projected ${ranked.projectedMicroUsd} micro-USD per attempt`;
    case 'latency':
      return ranked.signal.observedLatencyMs === undefined
        ? 'no observed latency yet'
        : `last observed ${ranked.signal.observedLatencyMs} ms`;
    case 'resilience':
      return `health score ${ranked.score}`;
    case 'preference':
      return `preference position ${ranked.signal.preferenceIndex}`;
  }
}

/**
 * Rank eligible candidates into an execution plan.
 *
 * `signals` MUST already be eligible. This function has no way to check that
 * and deliberately makes no attempt to: a second, weaker eligibility check here
 * would be a second answer to a question that has exactly one owner.
 */
export function routeCandidates(
  signals: readonly RoutingSignal[],
  workload: RoutingWorkload,
  options: RoutingPolicyOptions,
): RoutingDecision {
  const ranked: Ranked[] = signals.map((signal) => ({
    signal,
    projectedMicroUsd: projectAttemptCostMicroUsd(signal, workload),
    score: healthScore(signal),
  }));

  const ordered =
    options.strategy === 'preference'
      ? // Invariants 2–4 are already held by the selector's order, so the
        // default strategy is the identity and cannot introduce a difference.
        [...ranked].sort((a, b) => a.signal.preferenceIndex - b.signal.preferenceIndex)
      : [...ranked].sort((a, b) => {
          const tier = tierOf(a.signal) - tierOf(b.signal);
          if (tier !== 0) return tier;
          const circuit = circuitTierOf(a.signal) - circuitTierOf(b.signal);
          if (circuit !== 0) return circuit;
          const key = strategyKey(options.strategy, a) - strategyKey(options.strategy, b);
          if (key !== 0) return key;
          const preference = a.signal.preferenceIndex - b.signal.preferenceIndex;
          if (preference !== 0) return preference;
          // The last tiebreaker is total and stable, so two candidates that are
          // identical on every operational fact still produce one fixed order.
          return a.signal.providerId.localeCompare(b.signal.providerId);
        });

  const breadth = options.failoverEnabled
    ? Math.max(ROUTING_BOUNDS.maxProviders.min, Math.trunc(options.maxProviders))
    : 1;
  const kept = ordered.slice(0, breadth);
  const droppedForBreadth = ordered.slice(breadth).map((entry) => entry.signal.providerId);

  const order: readonly RoutedCandidate[] = kept.map((entry, index) => ({
    providerId: entry.signal.providerId,
    modelId: entry.signal.modelId,
    rank: index,
    projectedMicroUsd: entry.projectedMicroUsd,
    healthScore: entry.score,
    billable: entry.signal.billable,
    observedLatencyMs: entry.signal.observedLatencyMs,
    reason: reasonFor(options.strategy, entry),
  }));

  // INVARIANT 1, ASSERTED. A routed order that is not a subset of the input is
  // a defect that must never reach a provider, so it is caught here rather than
  // discovered from a vendor invoice.
  const offered = new Set(signals.map((signal) => `${signal.providerId}/${signal.modelId}`));
  for (const candidate of order) {
    if (!offered.has(`${candidate.providerId}/${candidate.modelId}`)) {
      throw new Error(
        `routing admitted a candidate it was not offered: ${candidate.providerId}/${candidate.modelId}`,
      );
    }
  }

  const billableProjections = ranked
    .filter((entry) => entry.signal.billable)
    .map((entry) => entry.projectedMicroUsd);
  const cheapestBillableMicroUsd =
    billableProjections.length === 0 ? 0 : Math.min(...billableProjections);
  const chosenProjectedMicroUsd = order[0]?.projectedMicroUsd ?? 0;
  const chosenIsBillable = order[0]?.billable ?? false;

  return {
    strategy: options.strategy,
    workload,
    order,
    considered: signals.length,
    droppedForBreadth,
    chosenProjectedMicroUsd,
    cheapestBillableMicroUsd,
    // A premium is what one PAID choice costs over another. A request served by
    // a provider that charges nothing has not saved the difference — it has
    // produced a different kind of answer — so the premium is reported as zero
    // rather than as a negative saving.
    premiumMicroUsd: chosenIsBillable
      ? Math.max(0, chosenProjectedMicroUsd - cheapestBillableMicroUsd)
      : 0,
    billableAttemptBudget: Math.max(1, Math.trunc(workload.maxAttempts)),
  };
}
