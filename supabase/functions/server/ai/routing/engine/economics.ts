/**
 * Routing economics — AI-01 Batch 4F.
 *
 * Integer micro-USD arithmetic over facts the platform already holds. There is
 * no pricing table here, no vendor knowledge and no model list: every rate
 * comes from the model descriptor the provider adapter declared, which is the
 * same source the spend guard reserves against and the budget engine settles
 * against. A second price table is how a budget engine starts lying, and Batch
 * 4C's registry documentation says so in as many words.
 *
 * ── PROJECTION AND RESERVATION ARE THE SAME ARITHMETIC ──────────────────────
 *
 * `projectAttemptCostMicroUsd` is the per-attempt worst case at a model's
 * rates, computed from the feature's DECLARED ceilings. Multiply it by the
 * feature's attempt allowance and it is exactly the number
 * `spendGuard.estimateFor` reserves for the dearest eligible model, and exactly
 * what `policy/exposure.ts` reports. The three agree by construction and are
 * pinned to each other by test — `routingEconomics.test.ts` asserts the
 * identity for the certified catalogue, so a change to one that is not made to
 * the others fails immediately.
 *
 * ── WHAT A PREMIUM IS, AND WHAT IT IS NOT ───────────────────────────────────
 *
 * The premium is what the platform pays PER ATTEMPT for routing to something
 * other than the cheapest paid option. It is a measurement, not a control: no
 * request is refused because of it, no candidate is excluded by it, and it
 * never moves a ceiling. Batch 4C's exposure module is the control, and it is
 * deliberately separate — a number that both steers traffic and gates
 * configuration is a number nobody can reason about during an incident.
 */

import type { RoutingDecision, RoutingOutcome, RoutingSignal, RoutingWorkload } from '../contracts/routing.ts';

/**
 * Worst-case cost of ONE attempt against one model, in whole micro-USD.
 *
 * Rounded UP. A projection that rounds down under-states what a request may
 * cost, and every consumer of this number is deciding whether money is
 * available — the direction of the rounding error has to favour the ledger.
 */
export function projectAttemptCostMicroUsd(
  rates: Pick<RoutingSignal, 'promptMicroUsdPer1k' | 'completionMicroUsdPer1k' | 'billable'>,
  workload: Pick<RoutingWorkload, 'promptTokens' | 'completionTokens'>,
): number {
  // A provider that does not charge costs nothing, and saying so explicitly
  // keeps a non-zero rate on a non-billable descriptor from inventing spend
  // that no invoice will ever show.
  if (!rates.billable) return 0;
  const prompt = (workload.promptTokens * rates.promptMicroUsdPer1k) / 1000;
  const completion = (workload.completionTokens * rates.completionMicroUsdPer1k) / 1000;
  return Math.ceil(prompt + completion);
}

/**
 * Worst-case cost of the whole REQUEST under a decision: one attempt against
 * the chosen candidate, times the billable attempt budget.
 *
 * This is the figure that must not exceed what the spend guard held, and the
 * reason the budget is per request rather than per provider. See
 * `RoutingDecision.billableAttemptBudget`.
 */
export function projectRequestCostMicroUsd(decision: RoutingDecision): number {
  return decision.chosenProjectedMicroUsd * decision.billableAttemptBudget;
}

/**
 * The worst case across the WHOLE PLAN rather than its first entry.
 *
 * Reported so an operator can see what a request could cost if it failed over
 * to the dearest provider in the plan and spent its whole budget there. It is
 * an upper bound on a bound: the billable attempt budget already means those
 * attempts come out of one allowance rather than one allowance per provider.
 */
export function planCeilingMicroUsd(decision: RoutingDecision): number {
  const dearest = decision.order.reduce(
    (worst, candidate) => Math.max(worst, candidate.projectedMicroUsd),
    0,
  );
  return dearest * decision.billableAttemptBudget;
}

export interface RealizedExecution {
  readonly organizationId: string;
  readonly servedProviderId?: string;
  readonly servedModelId?: string;
  readonly failedProviders: readonly string[];
  readonly attempts: number;
  readonly billableAttempts: number;
  readonly realizedMicroUsd: number;
  readonly outcome: 'success' | 'failure';
  readonly budgetExhausted: boolean;
  readonly occurredAt: string;
}

/**
 * Reconcile what a request actually did against what was projected for it.
 *
 * The variance is signed on purpose. A persistently NEGATIVE variance means the
 * platform is holding more than it spends, which is safe but wasteful of
 * headroom; a persistently POSITIVE one means the projection is under-stating
 * real spend, which is the condition a ceiling exists to prevent. An absolute
 * value would hide the difference between the two.
 */
export function reconcileRouting(
  decision: RoutingDecision,
  realized: RealizedExecution,
): RoutingOutcome {
  const projected = projectRequestCostMicroUsd(decision);
  return {
    featureId: decision.workload.featureId,
    organizationId: realized.organizationId,
    strategy: decision.strategy,
    chosenProviderId: decision.order[0]?.providerId ?? '(none)',
    chosenModelId: decision.order[0]?.modelId ?? '(none)',
    servedProviderId: realized.servedProviderId,
    servedModelId: realized.servedModelId,
    failedProviders: realized.failedProviders,
    attempts: realized.attempts,
    billableAttempts: realized.billableAttempts,
    projectedMicroUsd: projected,
    realizedMicroUsd: realized.realizedMicroUsd,
    varianceMicroUsd: realized.realizedMicroUsd - projected,
    premiumMicroUsd: decision.premiumMicroUsd,
    outcome: realized.outcome,
    budgetExhausted: realized.budgetExhausted,
    occurredAt: realized.occurredAt,
  };
}
