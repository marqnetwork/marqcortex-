/**
 * Routing contracts — AI-01 Batch 4F.
 *
 * ── WHAT ROUTING IS, AND THE ONE THING IT MAY NEVER BE ──────────────────────
 *
 * Routing ORDERS candidates. It does not admit them.
 *
 * Eligibility — is this provider enabled, certified, credentialed, permitted to
 * spend money, circuit-closed, and does it serve a model that meets the
 * feature's declared requirements — belongs to the provider registry and the
 * selector, and Batches 4C and 4E spent two remediations establishing that
 * there is exactly ONE place it is decided. Routing is handed the answer and
 * arranges it. A routing policy that could add a candidate would be a second
 * eligibility path with none of the gates, which is precisely the shape of
 * defect the self-hosted batch was remediated for.
 *
 * The property is stated here, asserted in `routingPolicy.ts` at the point of
 * ordering, and tested adversarially: the output of a routing decision is
 * always a subset of its input, and the only reason an input is dropped is the
 * governed failover breadth.
 *
 * ── WHY A DECISION IS A VALUE RATHER THAN A SIDE EFFECT ─────────────────────
 *
 * A routing decision carries the economics that justified it: what the chosen
 * candidate is projected to cost, what the cheapest eligible alternative would
 * have cost, and the difference between them. That difference is the platform's
 * routing premium, and it is the number an operator needs in order to ask
 * whether a latency or resilience preference is worth what it is being paid
 * for. A decision that only produced an ordering would leave that question
 * unanswerable after the fact.
 */

import type { CircuitState } from '../../providers/circuitBreaker.ts';

/**
 * How the platform ranks eligible providers.
 *
 *   preference   The order the selector produced: the administrator's
 *                preference list, the pinned default first, the fallback last.
 *                THE DEFAULT, and it returns the selector's order UNCHANGED —
 *                a deployment that adopts Batch 4F and configures nothing
 *                routes exactly as it did before it.
 *
 *   cost         Cheapest projected cost first, among providers that charge.
 *
 *   latency      Fastest observed provider first. An unobserved provider is
 *                unproven rather than fast, and ranks after the observed ones.
 *
 *   resilience   Healthiest first: circuit state, consecutive failures and the
 *                observed failure ratio, in that order of weight.
 */
export type RoutingStrategy = 'preference' | 'cost' | 'latency' | 'resilience';

export const ROUTING_STRATEGIES: readonly RoutingStrategy[] = [
  'preference',
  'cost',
  'latency',
  'resilience',
];

export function isRoutingStrategy(value: unknown): value is RoutingStrategy {
  return typeof value === 'string' && (ROUTING_STRATEGIES as readonly string[]).includes(value);
}

/**
 * The workload a decision is made for.
 *
 * Token counts are the feature's DECLARED CEILINGS, not a guess at the actual
 * request — the same inputs `spendGuard.estimateFor` and `policy/exposure.ts`
 * reserve against. Routing on a projection built from a different basis than
 * the money that was held for it would produce a premium figure that could not
 * be reconciled against the ledger.
 */
export interface RoutingWorkload {
  readonly featureId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** The feature's per-request attempt allowance. */
  readonly maxAttempts: number;
}

/**
 * One eligible candidate, with the operational facts routing is allowed to see.
 *
 * Deliberately a flat value rather than a registry handle. The routing policy is
 * a pure function of these fields, so a decision can be reproduced in a test —
 * and, more importantly, replayed from an audit record when somebody asks why
 * traffic went where it went.
 */
export interface RoutingSignal {
  readonly providerId: string;
  readonly modelId: string;
  readonly promptMicroUsdPer1k: number;
  readonly completionMicroUsdPer1k: number;
  /** True when reaching this provider spends money with an external vendor. */
  readonly billable: boolean;
  /**
   * True when this provider is the configured LAST RESORT.
   *
   * Carried into routing because "the fallback is tried last" is a Batch 1
   * selection guarantee, and a strategy that could promote the fallback on cost
   * or latency grounds would quietly repeal it. See `routingPolicy.ts`.
   */
  readonly isFallback: boolean;
  /** Position in the order the selector produced. Lower is more preferred. */
  readonly preferenceIndex: number;
  readonly circuit: CircuitState;
  readonly consecutiveFailures: number;
  readonly successCount: number;
  readonly failureCount: number;
  /** Last observed provider latency, in milliseconds. Absent when unproven. */
  readonly observedLatencyMs?: number;
}

/** A candidate after ranking, with the arithmetic that placed it. */
export interface RoutedCandidate {
  readonly providerId: string;
  readonly modelId: string;
  /** 0-based position in the routed order. */
  readonly rank: number;
  /** Projected worst-case cost of ONE attempt, in micro-USD. Integer. */
  readonly projectedMicroUsd: number;
  /** 0–100. Higher is healthier. See `healthScore` in `routingPolicy.ts`. */
  readonly healthScore: number;
  readonly billable: boolean;
  readonly observedLatencyMs?: number;
  /** Why this candidate sits where it does. Presentation, never a decision. */
  readonly reason: string;
}

/**
 * The complete, replayable outcome of one routing decision.
 */
export interface RoutingDecision {
  readonly strategy: RoutingStrategy;
  readonly workload: RoutingWorkload;
  /** The routed order. A subset of the input, never a superset. */
  readonly order: readonly RoutedCandidate[];
  /** How many eligible candidates the policy was given. */
  readonly considered: number;
  /** Providers the governed failover breadth removed from the tail. */
  readonly droppedForBreadth: readonly string[];
  /** Projected cost of one attempt against the chosen candidate. */
  readonly chosenProjectedMicroUsd: number;
  /**
   * Projected cost of one attempt against the cheapest BILLABLE candidate the
   * policy was offered. Zero when nothing billable was eligible.
   */
  readonly cheapestBillableMicroUsd: number;
  /**
   * `chosenProjectedMicroUsd - cheapestBillableMicroUsd`, floored at zero.
   *
   * What the platform is paying, per attempt, for whatever the strategy
   * optimised for instead of price. Zero under the cost strategy by
   * construction, and that is the point of measuring it.
   */
  readonly premiumMicroUsd: number;
  /**
   * BILLABLE attempts this request may make, in total, across every provider.
   *
   * ── THE NUMBER THAT MAKES THE RESERVATION TRUE ────────────────────────────
   *
   * The spend guard reserves `worst-case model x maxAttempts` for a request.
   * Before this batch the execution pipeline granted a FRESH allowance of
   * `maxAttempts` to every failover candidate, so a request with a 2-attempt
   * allowance and three eligible providers could make six paid attempts against
   * a hold that covered two. The ceiling was not crossed by anybody deciding it
   * should be; it was crossed by an allowance being counted per provider and
   * reserved per request.
   *
   * So the budget is per REQUEST and it is spent by BILLABLE attempts only.
   * A non-billable provider — the mock — costs nothing, is bounded by the
   * failover breadth and the workflow deadline, and remains available as the
   * last resort it was designed to be.
   */
  readonly billableAttemptBudget: number;
}

/** What a request actually did, reconciled against what was projected. */
export interface RoutingOutcome {
  readonly featureId: string;
  readonly organizationId: string;
  readonly strategy: RoutingStrategy;
  readonly chosenProviderId: string;
  readonly chosenModelId: string;
  /** The provider that ANSWERED, which is not always the one ranked first. */
  readonly servedProviderId?: string;
  readonly servedModelId?: string;
  readonly failedProviders: readonly string[];
  readonly attempts: number;
  readonly billableAttempts: number;
  readonly projectedMicroUsd: number;
  readonly realizedMicroUsd: number;
  /** `realized - projected`. Negative means the projection over-stated. */
  readonly varianceMicroUsd: number;
  readonly premiumMicroUsd: number;
  readonly outcome: 'success' | 'failure';
  readonly budgetExhausted: boolean;
  readonly occurredAt: string;
}
