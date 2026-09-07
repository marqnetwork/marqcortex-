/**
 * AI-01 Batch 4F — the Routing Authority, as a pure function.
 *
 * These tests hold the four invariants stated in `routing/engine/routingPolicy.ts`
 * against every strategy, including the ones a strategy would "want" to break:
 * a cheap fallback, a free mock, and an unproven half-open circuit that happens
 * to be the fastest thing on the platform.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { RoutingSignal, RoutingWorkload } from '../routing/contracts/routing.ts';
import {
  ROUTING_BOUNDS,
  ROUTING_STRATEGIES,
  clampMaxProviders,
  createRoutingLedger,
  healthScore,
  isRoutingStrategy,
  planCeilingMicroUsd,
  projectAttemptCostMicroUsd,
  projectRequestCostMicroUsd,
  reconcileRouting,
  routeCandidates,
} from '../routing/index.ts';

const WORKLOAD: RoutingWorkload = {
  featureId: 'cortex.chat',
  promptTokens: 16_384,
  completionTokens: 1_200,
  maxAttempts: 2,
};

function signal(overrides: Partial<RoutingSignal> & Pick<RoutingSignal, 'providerId'>): RoutingSignal {
  return {
    modelId: `${overrides.providerId}-model`,
    promptMicroUsdPer1k: 1_000,
    completionMicroUsdPer1k: 2_000,
    billable: true,
    isFallback: false,
    preferenceIndex: 0,
    circuit: 'closed',
    consecutiveFailures: 0,
    successCount: 10,
    failureCount: 0,
    ...overrides,
  };
}

const OPTIONS = { strategy: 'preference' as const, maxProviders: 3, failoverEnabled: true };

describe('Batch 4F — routing never admits what it was not offered', () => {
  it('produces a subset of the offered candidates under every strategy', () => {
    const offered = [
      signal({ providerId: 'openai', preferenceIndex: 0 }),
      signal({ providerId: 'anthropic', preferenceIndex: 1, promptMicroUsdPer1k: 300 }),
      signal({ providerId: 'mock', preferenceIndex: 2, billable: false }),
    ];
    const offeredKeys = new Set(offered.map((entry) => `${entry.providerId}/${entry.modelId}`));

    for (const strategy of ROUTING_STRATEGIES) {
      const decision = routeCandidates(offered, WORKLOAD, { ...OPTIONS, strategy });
      assert.equal(decision.considered, 3);
      for (const candidate of decision.order) {
        assert.ok(
          offeredKeys.has(`${candidate.providerId}/${candidate.modelId}`),
          `${strategy} routed a candidate that was never eligible`,
        );
      }
      assert.ok(decision.order.length <= offered.length);
    }
  });

  it('routes nothing when nothing is eligible', () => {
    const decision = routeCandidates([], WORKLOAD, OPTIONS);
    assert.equal(decision.order.length, 0);
    assert.equal(decision.chosenProjectedMicroUsd, 0);
    assert.equal(decision.premiumMicroUsd, 0);
  });
});

describe('Batch 4F — the invariants a strategy may not express away', () => {
  it('keeps the configured fallback last even when it is the cheapest', () => {
    const decision = routeCandidates(
      [
        signal({ providerId: 'openai', preferenceIndex: 0, promptMicroUsdPer1k: 2_500 }),
        signal({
          providerId: 'budget-vendor',
          preferenceIndex: 1,
          isFallback: true,
          promptMicroUsdPer1k: 1,
          completionMicroUsdPer1k: 1,
        }),
      ],
      WORKLOAD,
      { ...OPTIONS, strategy: 'cost' },
    );
    assert.equal(decision.order[0].providerId, 'openai');
    assert.equal(decision.order[1].providerId, 'budget-vendor');
  });

  it('never promotes a non-billable provider above paid capacity on cost', () => {
    // The failure this prevents: the mock costs zero, so a naive cost ranking
    // makes every request on a deployment that authorised real spending a
    // synthetic completion — healthy-looking, free, and wrong about every answer.
    const decision = routeCandidates(
      [
        signal({ providerId: 'openai', preferenceIndex: 0, promptMicroUsdPer1k: 2_500 }),
        signal({ providerId: 'mock', preferenceIndex: 1, billable: false }),
      ],
      WORKLOAD,
      { ...OPTIONS, strategy: 'cost' },
    );
    assert.equal(decision.order[0].providerId, 'openai');
    assert.equal(decision.order[0].billable, true);
    assert.equal(decision.order[1].providerId, 'mock');
  });

  it('ranks a half-open circuit after proven capacity even when it is fastest', () => {
    const decision = routeCandidates(
      [
        signal({ providerId: 'slow-but-proven', preferenceIndex: 0, observedLatencyMs: 4_000 }),
        signal({
          providerId: 'fast-but-unproven',
          preferenceIndex: 1,
          observedLatencyMs: 10,
          circuit: 'half_open',
        }),
      ],
      WORKLOAD,
      { ...OPTIONS, strategy: 'latency' },
    );
    assert.equal(decision.order[0].providerId, 'slow-but-proven');
    assert.equal(decision.order[1].providerId, 'fast-but-unproven');
  });

  it('leaves the selector order untouched under the default strategy', () => {
    // The default must be the identity, or every existing deployment routes
    // differently on the day it adopts this batch.
    const offered = [
      signal({ providerId: 'c', preferenceIndex: 0, promptMicroUsdPer1k: 9_000 }),
      signal({ providerId: 'a', preferenceIndex: 1, promptMicroUsdPer1k: 1 }),
      signal({ providerId: 'b', preferenceIndex: 2, observedLatencyMs: 1 }),
    ];
    const decision = routeCandidates(offered, WORKLOAD, { ...OPTIONS, strategy: 'preference' });
    assert.deepEqual(
      decision.order.map((candidate) => candidate.providerId),
      ['c', 'a', 'b'],
    );
  });
});

describe('Batch 4F — strategies rank on what they claim to rank on', () => {
  it('cost puts the cheapest paid provider first', () => {
    const decision = routeCandidates(
      [
        signal({ providerId: 'dear', preferenceIndex: 0, promptMicroUsdPer1k: 2_500 }),
        signal({ providerId: 'cheap', preferenceIndex: 1, promptMicroUsdPer1k: 150 }),
      ],
      WORKLOAD,
      { ...OPTIONS, strategy: 'cost' },
    );
    assert.equal(decision.order[0].providerId, 'cheap');
    assert.equal(decision.premiumMicroUsd, 0, 'the cost strategy pays no premium by construction');
  });

  it('latency puts the fastest observed provider first and the unobserved last', () => {
    const decision = routeCandidates(
      [
        signal({ providerId: 'never-called', preferenceIndex: 0 }),
        signal({ providerId: 'slow', preferenceIndex: 1, observedLatencyMs: 5_000 }),
        signal({ providerId: 'quick', preferenceIndex: 2, observedLatencyMs: 400 }),
      ],
      WORKLOAD,
      { ...OPTIONS, strategy: 'latency' },
    );
    assert.deepEqual(
      decision.order.map((candidate) => candidate.providerId),
      ['quick', 'slow', 'never-called'],
    );
  });

  it('resilience puts the healthiest provider first', () => {
    const decision = routeCandidates(
      [
        signal({ providerId: 'flaky', preferenceIndex: 0, consecutiveFailures: 2, failureCount: 8, successCount: 2 }),
        signal({ providerId: 'steady', preferenceIndex: 1, successCount: 100, failureCount: 1 }),
      ],
      WORKLOAD,
      { ...OPTIONS, strategy: 'resilience' },
    );
    assert.equal(decision.order[0].providerId, 'steady');
  });

  it('is deterministic — identical signals produce one fixed order', () => {
    const offered = [
      signal({ providerId: 'zeta', preferenceIndex: 0 }),
      signal({ providerId: 'alpha', preferenceIndex: 0 }),
    ];
    const first = routeCandidates(offered, WORKLOAD, { ...OPTIONS, strategy: 'cost' });
    const second = routeCandidates([...offered].reverse(), WORKLOAD, { ...OPTIONS, strategy: 'cost' });
    assert.deepEqual(
      first.order.map((candidate) => candidate.providerId),
      second.order.map((candidate) => candidate.providerId),
    );
    assert.equal(first.order[0].providerId, 'alpha');
  });

  it('scores health between zero and one hundred, never outside it', () => {
    assert.equal(healthScore(signal({ providerId: 'perfect' })), 100);
    const worst = healthScore(
      signal({
        providerId: 'worst',
        circuit: 'half_open',
        consecutiveFailures: 99,
        successCount: 0,
        failureCount: 50,
      }),
    );
    assert.ok(worst >= 0 && worst <= 100, `health score out of range: ${worst}`);
  });
});

describe('Batch 4F — the governed failover breadth', () => {
  it('truncates the plan to the breadth and names what it dropped', () => {
    const decision = routeCandidates(
      [
        signal({ providerId: 'a', preferenceIndex: 0 }),
        signal({ providerId: 'b', preferenceIndex: 1 }),
        signal({ providerId: 'c', preferenceIndex: 2 }),
      ],
      WORKLOAD,
      { ...OPTIONS, maxProviders: 2 },
    );
    assert.deepEqual(decision.order.map((entry) => entry.providerId), ['a', 'b']);
    assert.deepEqual(decision.droppedForBreadth, ['c']);
  });

  it('plans exactly one provider when failover is off', () => {
    const decision = routeCandidates(
      [signal({ providerId: 'a', preferenceIndex: 0 }), signal({ providerId: 'b', preferenceIndex: 1 })],
      WORKLOAD,
      { ...OPTIONS, failoverEnabled: false },
    );
    assert.equal(decision.order.length, 1);
    assert.deepEqual(decision.droppedForBreadth, ['b']);
  });

  it('clamps a breadth an administrator could otherwise set to anything', () => {
    assert.equal(clampMaxProviders(0, 2), ROUTING_BOUNDS.maxProviders.min);
    assert.equal(clampMaxProviders(9_999, 2), ROUTING_BOUNDS.maxProviders.max);
    assert.equal(clampMaxProviders('two' as unknown, 2), 2);
    assert.equal(clampMaxProviders(Number.NaN, 2), 2);
  });

  it('accepts only the declared strategies', () => {
    assert.equal(isRoutingStrategy('cost'), true);
    assert.equal(isRoutingStrategy('cheapest'), false);
    assert.equal(isRoutingStrategy(undefined), false);
  });
});

describe('Batch 4F — economics', () => {
  it('projects one attempt at the model rates, rounded up', () => {
    // (16,384 x 2,500/1000 + 1,200 x 10,000/1000) = 52,960 uUSD per attempt —
    // half of the certified 105,920 two-attempt hold.
    const projected = projectAttemptCostMicroUsd(
      { promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000, billable: true },
      WORKLOAD,
    );
    assert.equal(projected, 52_960);
  });

  it('reproduces the certified cortex.chat hold over the attempt allowance', () => {
    const decision = routeCandidates(
      [signal({ providerId: 'openai', promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 })],
      WORKLOAD,
      OPTIONS,
    );
    assert.equal(
      projectRequestCostMicroUsd(decision),
      105_920,
      'the routing projection and the certified Batch 4B hold must be one number',
    );
  });

  it('charges a non-billable provider nothing whatever its declared rates', () => {
    assert.equal(
      projectAttemptCostMicroUsd(
        { promptMicroUsdPer1k: 9_999, completionMicroUsdPer1k: 9_999, billable: false },
        WORKLOAD,
      ),
      0,
    );
  });

  it('reports the premium a non-cost strategy accepts', () => {
    const decision = routeCandidates(
      [
        signal({ providerId: 'dear', preferenceIndex: 0, promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 }),
        signal({ providerId: 'cheap', preferenceIndex: 1, promptMicroUsdPer1k: 150, completionMicroUsdPer1k: 600 }),
      ],
      WORKLOAD,
      OPTIONS,
    );
    const cheap = 16_384 * 0.15 + 1_200 * 0.6;
    assert.equal(decision.cheapestBillableMicroUsd, Math.ceil(cheap));
    assert.equal(decision.premiumMicroUsd, 52_960 - Math.ceil(cheap));
  });

  it('reports no premium when the request was not paid for at all', () => {
    const decision = routeCandidates(
      [signal({ providerId: 'mock', billable: false })],
      WORKLOAD,
      OPTIONS,
    );
    assert.equal(decision.premiumMicroUsd, 0);
  });

  it('bounds the whole plan by the dearest candidate in it', () => {
    const decision = routeCandidates(
      [
        signal({ providerId: 'cheap', preferenceIndex: 0, promptMicroUsdPer1k: 150, completionMicroUsdPer1k: 600 }),
        signal({ providerId: 'dear', preferenceIndex: 1, promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 }),
      ],
      WORKLOAD,
      OPTIONS,
    );
    assert.equal(planCeilingMicroUsd(decision), 105_920);
  });

  it('signs the variance so an under-projection is distinguishable', () => {
    const decision = routeCandidates(
      [signal({ providerId: 'openai', promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 })],
      WORKLOAD,
      OPTIONS,
    );
    const under = reconcileRouting(decision, {
      organizationId: 'org-1',
      servedProviderId: 'openai',
      servedModelId: 'openai-model',
      failedProviders: [],
      attempts: 1,
      billableAttempts: 1,
      realizedMicroUsd: 1_000,
      outcome: 'success',
      budgetExhausted: false,
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(under.varianceMicroUsd, 1_000 - 105_920);
    assert.ok(under.varianceMicroUsd < 0, 'reserving more than was spent reads as negative');
  });
});

describe('Batch 4F — the routing ledger', () => {
  function outcome(overrides: Record<string, unknown> = {}) {
    return {
      featureId: 'cortex.chat',
      organizationId: 'org-1',
      strategy: 'preference' as const,
      chosenProviderId: 'openai',
      chosenModelId: 'gpt-4o',
      servedProviderId: 'openai',
      servedModelId: 'gpt-4o',
      failedProviders: [] as readonly string[],
      attempts: 1,
      billableAttempts: 1,
      projectedMicroUsd: 100,
      realizedMicroUsd: 40,
      varianceMicroUsd: -60,
      premiumMicroUsd: 10,
      outcome: 'success' as const,
      budgetExhausted: false,
      occurredAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('counts a failover only when another provider answered', () => {
    const ledger = createRoutingLedger();
    // Tried openai, failed, retried openai, succeeded. A retry, not a failover.
    ledger.recordOutcome(outcome({ failedProviders: ['openai'], attempts: 2 }));
    ledger.recordOutcome(outcome({ servedProviderId: 'anthropic', failedProviders: ['openai'] }));
    assert.equal(ledger.summary().failovers, 1);
  });

  it('aggregates spend, premium and variance across recorded executions', () => {
    const ledger = createRoutingLedger();
    ledger.recordOutcome(outcome());
    ledger.recordOutcome(outcome({ realizedMicroUsd: 60, varianceMicroUsd: -40 }));
    const summary = ledger.summary();
    assert.equal(summary.executions, 2);
    assert.equal(summary.realizedMicroUsd, 100);
    assert.equal(summary.projectedMicroUsd, 200);
    assert.equal(summary.varianceMicroUsd, -100);
    assert.equal(summary.premiumMicroUsd, 20);
    assert.equal(summary.providers.find((entry) => entry.providerId === 'openai')?.served, 2);
  });

  it('drops the oldest record rather than refusing the newest', () => {
    const ledger = createRoutingLedger({ capacity: 2 });
    ledger.recordOutcome(outcome({ occurredAt: 'first' }));
    ledger.recordOutcome(outcome({ occurredAt: 'second' }));
    ledger.recordOutcome(outcome({ occurredAt: 'third' }));
    const recent = ledger.recent(10);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].occurredAt, 'third');
    assert.equal(recent[1].occurredAt, 'second');
  });

  it('counts a decision even when the execution never reported back', () => {
    const ledger = createRoutingLedger();
    const decision = routeCandidates([signal({ providerId: 'openai' })], WORKLOAD, OPTIONS);
    ledger.recordDecision(decision, 'org-1');
    const summary = ledger.summary();
    assert.equal(summary.decisions, 1);
    assert.equal(summary.executions, 0);
    assert.equal(summary.providers.find((entry) => entry.providerId === 'openai')?.chosen, 1);
  });
});
