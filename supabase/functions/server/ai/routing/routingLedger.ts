/**
 * The Routing Ledger — AI-01 Batch 4F.
 *
 * A bounded, in-memory record of routing decisions and their reconciled
 * outcomes, and the aggregates an operator reads off them.
 *
 * ── WHY IT IS IN MEMORY, AND WHY THAT IS THE RIGHT ANSWER HERE ──────────────
 *
 * Money is already durable. Every micro-USD this ledger talks about was
 * reserved and settled through `policy/spendLedger.ts`, audited through
 * `observability/audit.ts` and attributed through the financial event ledger.
 * Nothing here is the authority for anything; it is the OPERATIONAL view that
 * answers "where is traffic going, and what is the strategy costing?" for the
 * isolate serving the console. Making it durable would add a write to the
 * request path for a number that is already written down twice.
 *
 * The bound is the same discipline the audit buffer applies: a long-lived edge
 * instance must not grow without limit, so the ring drops the oldest record
 * rather than the newest — an operator asking what just happened is the common
 * case, and the durable trails hold the history.
 *
 * ── WHAT IT MAY NOT HOLD ────────────────────────────────────────────────────
 *
 * No prompt, no completion, no message content, no actor identity, no
 * credential and no fingerprint. Provider ids, model ids, feature ids, an
 * organization id and integers. A routing view is read by platform operators
 * across every tenant, and the tenant-scoping the administration layer applies
 * to it is only as good as the absence of anything sensitive in the record.
 */

import type { RoutingDecision, RoutingOutcome, RoutingStrategy } from './contracts/routing.ts';

export interface RoutingProviderSummary {
  readonly providerId: string;
  /** Decisions in which this provider was ranked first. */
  readonly chosen: number;
  /** Executions this provider actually answered. */
  readonly served: number;
  /** Executions in which this provider was tried and failed. */
  readonly failed: number;
  readonly realizedMicroUsd: number;
  readonly premiumMicroUsd: number;
}

export interface RoutingSummary {
  readonly strategy: RoutingStrategy;
  readonly decisions: number;
  readonly executions: number;
  readonly failovers: number;
  readonly budgetExhaustions: number;
  readonly projectedMicroUsd: number;
  readonly realizedMicroUsd: number;
  /** Signed. Negative means the platform reserved more than it spent. */
  readonly varianceMicroUsd: number;
  /** Total per-attempt premium the strategy accepted across these decisions. */
  readonly premiumMicroUsd: number;
  readonly providers: readonly RoutingProviderSummary[];
}

export interface RoutingLedger {
  recordDecision(decision: RoutingDecision, organizationId: string): void;
  recordOutcome(outcome: RoutingOutcome): void;
  /** Most recent outcomes, newest first. */
  recent(limit?: number): readonly RoutingOutcome[];
  summary(): RoutingSummary;
  reset(): void;
}

export interface RoutingLedgerOptions {
  /** Outcomes retained. Older records are dropped as newer ones arrive. */
  readonly capacity?: number;
  readonly strategy?: () => RoutingStrategy;
}

const DEFAULT_CAPACITY = 200;

export function createRoutingLedger(options: RoutingLedgerOptions = {}): RoutingLedger {
  const capacity = Math.max(1, Math.trunc(options.capacity ?? DEFAULT_CAPACITY));
  const outcomes: RoutingOutcome[] = [];

  let decisions = 0;
  const chosenByProvider = new Map<string, number>();

  function bump(map: Map<string, number>, key: string, by = 1): void {
    map.set(key, (map.get(key) ?? 0) + by);
  }

  return {
    recordDecision(decision, _organizationId) {
      decisions += 1;
      const chosen = decision.order[0];
      if (chosen) bump(chosenByProvider, chosen.providerId);
    },

    recordOutcome(outcome) {
      outcomes.push(outcome);
      // Drop from the front, so the ring keeps the most recent window rather
      // than refusing to record anything once it is full.
      while (outcomes.length > capacity) outcomes.shift();
    },

    recent(limit = 50) {
      const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), capacity);
      return [...outcomes].reverse().slice(0, bounded);
    },

    summary() {
      const served = new Map<string, number>();
      const failed = new Map<string, number>();
      const realizedByProvider = new Map<string, number>();
      const premiumByProvider = new Map<string, number>();

      let failovers = 0;
      let budgetExhaustions = 0;
      let projectedMicroUsd = 0;
      let realizedMicroUsd = 0;
      let premiumMicroUsd = 0;

      for (const outcome of outcomes) {
        projectedMicroUsd += outcome.projectedMicroUsd;
        realizedMicroUsd += outcome.realizedMicroUsd;
        premiumMicroUsd += outcome.premiumMicroUsd;
        if (outcome.budgetExhausted) budgetExhaustions += 1;
        // A failover is a request that was NOT answered by the provider routing
        // ranked first — counted from the served provider rather than from the
        // failure list, because a request can fail a provider and still be
        // answered by it on a retry, and that is a retry, not a failover.
        if (
          outcome.servedProviderId !== undefined &&
          outcome.servedProviderId !== outcome.chosenProviderId
        ) {
          failovers += 1;
        }
        if (outcome.servedProviderId !== undefined) {
          bump(served, outcome.servedProviderId);
          bump(realizedByProvider, outcome.servedProviderId, outcome.realizedMicroUsd);
          bump(premiumByProvider, outcome.servedProviderId, outcome.premiumMicroUsd);
        }
        for (const providerId of outcome.failedProviders) bump(failed, providerId);
      }

      const providerIds = new Set<string>([
        ...chosenByProvider.keys(),
        ...served.keys(),
        ...failed.keys(),
      ]);

      return {
        strategy: options.strategy?.() ?? 'preference',
        decisions,
        executions: outcomes.length,
        failovers,
        budgetExhaustions,
        projectedMicroUsd,
        realizedMicroUsd,
        varianceMicroUsd: realizedMicroUsd - projectedMicroUsd,
        premiumMicroUsd,
        providers: [...providerIds].sort().map((providerId) => ({
          providerId,
          chosen: chosenByProvider.get(providerId) ?? 0,
          served: served.get(providerId) ?? 0,
          failed: failed.get(providerId) ?? 0,
          realizedMicroUsd: realizedByProvider.get(providerId) ?? 0,
          premiumMicroUsd: premiumByProvider.get(providerId) ?? 0,
        })),
      };
    },

    reset() {
      outcomes.length = 0;
      decisions = 0;
      chosenByProvider.clear();
    },
  };
}
