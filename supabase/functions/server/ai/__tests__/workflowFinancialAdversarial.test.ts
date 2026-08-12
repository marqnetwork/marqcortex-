/**
 * Adversarial accounting against the LIVE emission path
 * (AI-01 Batch 3B, Integration Pass).
 *
 * ── THE QUESTION THIS SUITE ASKS ───────────────────────────────────────────
 *
 * Parts 6A, 6B and 6C each have an adversarial suite, and each one asks whether
 * that component could be made to overstate a saving. Every one of them was
 * answered against artefacts a fixture supplied. This asks the question that
 * only exists once the components are wired together:
 *
 *   CAN THE INTEGRATION INFLATE A SAVING THAT NONE OF THE PARTS COULD?
 *
 * The interesting attacks are not on the arithmetic — that was proved — but on
 * the SEAMS. Two events for one call. One usage settled twice. A retry counted
 * as spend in one dimension and omitted from another. Failed-run spend dropped.
 * A rejected reuse candidate counted as an avoidance. A branch total added to a
 * run total as though they were independent money. A missing measurement quietly
 * becoming a zero. Each of those is a wiring defect, invisible to a component
 * test, and each of them makes the platform look cheaper than it is.
 *
 * Every case here drives a REAL workflow run and then attacks what it produced.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateBy, savingsByCategory } from '../financial/engine/attributionEngine.ts';
import { foldTotals, settlementCoverage } from '../financial/engine/settlement.ts';
import { analyzeWaste, retryWasteMicroUsd } from '../financial/engine/wasteAnalysis.ts';
import { createInMemoryFinancialEventStore } from '../financial/persistence/ports.ts';
import { createMemoryWorkflowRunStore } from '../workflows/persistence/ports.ts';
import { AGENT_TOKEN } from './agentFixtures.ts';
import {
  emptyFlakyLog,
  meteredAgentPort,
  meteredFlakyAgentPort,
  WF5_AGENT,
  WF_AGENT,
} from './workflowFixtures.ts';
import {
  FIN_BASELINE_MICRO_USD,
  FIN_REUSE,
  FIN_TOPIC,
  FIN_WORKFLOW,
  buildFinancialRuntime,
  eventsFor,
  liveReuseResolver,
  reusableRecord,
  reusableStoreWith,
  sumSettled,
} from './workflowFinancialFixtures.ts';

const NOW = 1_800_000_000_000;
const SPEND = { inputTokens: 1_000, outputTokens: 400, costMicroUsd: 1_500 } as const;

describe('adversarial: the live path cannot emit two events for one call', () => {
  it('DRIVING THE SAME RUN REPEATEDLY writes one event per call, forever', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.chain.workflowId,
      input: FIN_TOPIC,
    });

    // An operator refreshing a console, a background driver, a retried request —
    // all of them arrive as another advance over the same run.
    for (let pass = 0; pass < 10; pass += 1) {
      await harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: detail.workflowRunId,
      });
    }

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 3);
    assert.equal(
      sumSettled(events, (event) => event.actualCostMicroUsd),
      detail.actualCostMicroUsd,
    );
  });

  it('A BLOCKED CHILD OBSERVED MANY TIMES produces one pending event, not many', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const created = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });

    for (let pass = 0; pass < 6; pass += 1) {
      await harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: created.workflowRunId,
      });
    }

    const events = await eventsFor(harness.workflows.financialEvents, created.organizationId);
    assert.equal(events.length, 2, 'polling a blocked child minted extra events');
    assert.equal(events.filter((event) => event.settlementState === 'pending').length, 1);
  });
});

describe('adversarial: the same usage cannot be settled twice', () => {
  it('a re-observed terminal child does not pay for its call a second time', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const financialEventStore = createInMemoryFinancialEventStore();
    const harness = buildFinancialRuntime({
      runStore,
      financialEventStore,
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const [before] = await eventsFor(financialEventStore, detail.organizationId);
    assert.equal(before.actualCostMicroUsd, SPEND.costMicroUsd);

    // A second isolate over the same stores re-reads the same terminal child.
    const second = buildFinancialRuntime({
      runStore,
      financialEventStore,
      idSeed: 'b',
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    for (let pass = 0; pass < 4; pass += 1) {
      await second.workflows.service.advanceRun({
        ...second.meta(AGENT_TOKEN.consultant),
        workflowRunId: detail.workflowRunId,
      });
    }

    const after = await eventsFor(financialEventStore, detail.organizationId);
    assert.equal(after.length, 1);
    // NOT 3,000. A second settlement of one call is refused by the store, and
    // the figure is the one the provider reported once.
    assert.equal(after[0].actualCostMicroUsd, SPEND.costMicroUsd);
    assert.deepEqual(after, [before]);
  });
});

describe('adversarial: retry spend cannot be counted in one dimension only', () => {
  it('the retry appears in the run total, the node total AND the retry category', async () => {
    const log = emptyFlakyLog();
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredFlakyAgentPort({
        agentId: WF5_AGENT.flaky,
        failures: 1,
        log,
        perChild: { inputTokens: 500, outputTokens: 100, costMicroUsd: 700 },
      }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.retry.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    const totals = foldTotals(events);

    // ONE node, TWO attempts, BOTH counted — and the same 1,400 in every view.
    assert.equal(totals.actualSettledCostMicroUsd, 1_400);
    const byNode = aggregateBy(events, 'node');
    assert.equal(byNode.buckets.length, 1);
    assert.equal(byNode.buckets[0].totals.actualSettledCostMicroUsd, 1_400);

    // The retry is visible AS a retry, so waste analysis can read it. A ledger
    // that folded the retry into the primary attempt would report 1,400 here and
    // zero retry waste, which is the shape that hides a retry storm.
    assert.equal(retryWasteMicroUsd(analyzeWaste(events)), 700);
  });

  it('never counts an attempt that was considered and never executed', async () => {
    // `retryOnce` declares one attempt. The failure is retryable and the retry
    // is NOT taken, so there is one child and one event.
    const log = emptyFlakyLog();
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredFlakyAgentPort({
        agentId: WF5_AGENT.flaky,
        failures: 1,
        log,
        perChild: { inputTokens: 500, outputTokens: 100, costMicroUsd: 700 },
      }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.retryOnce.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 1);
    assert.equal(retryWasteMicroUsd(analyzeWaste(events)), 0);
    assert.equal(foldTotals(events).actualSettledCostMicroUsd, 700);
  });
});

describe('adversarial: failed-run spend cannot be dropped', () => {
  it('a failed run reports the money it spent, not the money it produced', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.failsMidway.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'failed');
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    const totals = foldTotals(events);

    // Both children spent. A ledger that kept only the successful node would
    // report half the bill and a saving twice as large as the real one.
    assert.equal(totals.actualSettledCostMicroUsd, 2 * SPEND.costMicroUsd);
    assert.equal(totals.events, 2);
    assert.ok(events.some((event) => event.outcome === 'failed'));
    // And the failed spend is NOT netted off the realised saving.
    assert.equal(
      totals.realizedSavingsMicroUsd,
      2 * (FIN_BASELINE_MICRO_USD - SPEND.costMicroUsd),
    );
  });
});

describe('adversarial: a rejected reuse candidate cannot become an avoided cost', () => {
  it('an expired stored result produces an inference event and zero avoidance', async () => {
    const store = await reusableStoreWith(
      reusableRecord({
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: NOW,
        match: 'exact',
        // A one-minute TTL on a record created a minute ago. Expired.
        ttlMs: 1,
      }),
    );
    const log = { consulted: 0, hits: 0 };
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      reuseResolver: liveReuseResolver({ store, nodeId: 'only', nowMs: NOW, log }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(log.consulted, 1);
    assert.equal(log.hits, 0);
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    const totals = foldTotals(events);
    assert.equal(events[0].eventType, 'inference');
    assert.equal(totals.tokensAvoided, 0);
    assert.equal(totals.estimatedSavingsMicroUsd, 0);
    assert.equal(totals.realizedFromAbsenceMicroUsd, 0);
  });

  it('the SOURCE result’s original cost is never summed into a saving', async () => {
    const store = await reusableStoreWith(
      reusableRecord({
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: NOW,
        match: 'exact',
      }),
    );
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      reuseResolver: liveReuseResolver({ store, nodeId: 'only', nowMs: NOW }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    const totals = foldTotals(events);

    // The source generation cost 90,000. Money spent once, on a call that DID
    // happen, is not avoided by being remembered — so the avoided figure is the
    // baseline of the call that did not happen, and nothing else.
    assert.equal(totals.realizedSavingsMicroUsd, FIN_BASELINE_MICRO_USD);
    assert.notEqual(totals.realizedSavingsMicroUsd, FIN_REUSE.sourceOriginalCostMicroUsd);
    assert.ok(totals.realizedSavingsMicroUsd < FIN_REUSE.sourceOriginalCostMicroUsd);
  });
});

describe('adversarial: one avoided call cannot be counted under two names', () => {
  it('a reuse hit is attributed to `reuse` ALONE, never also to deterministic avoidance', async () => {
    const store = await reusableStoreWith(
      reusableRecord({
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: NOW,
        match: 'exact',
      }),
    );
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      reuseResolver: liveReuseResolver({ store, nodeId: 'only', nowMs: NOW }),
      // BOTH avoidance paths available at once. Part 6A's admission is ordered —
      // a deterministic path beats a stored one — so exactly one wins, and the
      // saving is attributed exactly once.
      nodeCostProfileFor: () => ({
        kind: 'calculation',
        deterministicCapabilities: [
          {
            capabilityId: 'cap.rollup',
            satisfies: ['calculation'],
            complete: true,
            maximumQuality: 'critical',
          },
        ],
      }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 1, 'one avoided call produced more than one event');

    const categories = savingsByCategory(events);
    const named = Object.entries(categories)
      .filter(([, totals]) => totals.microUsd > 0)
      .map(([category]) => category);
    assert.equal(named.length, 1, `one avoided call was attributed to ${named.join(' and ')}`);
    // The whole saving, once — and equal to the baseline of the one call.
    assert.equal(foldTotals(events).estimatedSavingsMicroUsd, FIN_BASELINE_MICRO_USD);
  });

  it('an avoided call carries at most ONE reuse type', async () => {
    const store = await reusableStoreWith(
      reusableRecord({
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: NOW,
        match: 'exact',
      }),
    );
    // Semantic discovery enabled AND an exact match present. Exact answers it,
    // and the event says `exact` — not both, and not one of each.
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      reuseResolver: liveReuseResolver({ store, nodeId: 'only', nowMs: NOW, semantic: true }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 1);
    assert.equal(events[0].reuseType, 'exact');
  });
});

describe('adversarial: a missing measurement never becomes zero', () => {
  it('an unmeasured terminal call reports UNKNOWN cost, not free work', async () => {
    // No metering, so nothing anywhere ever measured this call.
    const harness = buildFinancialRuntime();
    const created = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });
    const cancelled = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
      reason: 'stopped',
    });

    const events = await eventsFor(harness.workflows.financialEvents, cancelled.organizationId);
    const unsettled = events.filter((event) => event.settlementState === 'unsettled_terminal');
    assert.ok(unsettled.length > 0);

    const totals = foldTotals(events);
    // The unsettled call contributes to NEITHER the realised numerator nor its
    // denominator, and its baseline is reported as unknown spend. A zero here
    // would make the call look free, which would make the saving look complete.
    for (const event of unsettled) {
      assert.equal(event.actualCostMicroUsd, undefined);
      assert.equal(event.realizedSavingsMicroUsd, undefined);
    }
    assert.ok(totals.unknownCostBaselineMicroUsd > 0);
    assert.equal(
      totals.realizedBaselineCostMicroUsd + totals.unknownCostBaselineMicroUsd <=
        totals.baselineCostMicroUsd,
      true,
    );
  });

  it('EXCLUDING an unsettled terminal event from coverage is not possible', async () => {
    const harness = buildFinancialRuntime();
    const created = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });
    const cancelled = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
      reason: 'stopped',
    });

    const events = await eventsFor(harness.workflows.financialEvents, cancelled.organizationId);
    const coverage = settlementCoverage(events);

    // The denominator counts every event that SHOULD have settled, including the
    // ones that never will. Counting only the settled ones would report perfect
    // coverage over the subset that happened to work.
    assert.equal(coverage.expectedToSettle, events.length);
    assert.equal(coverage.settled + coverage.unsettledTerminal + coverage.pending, events.length);
    assert.ok(coverage.unsettledTerminal > 0);
    assert.ok(coverage.coveragePercent < 100);
    assert.equal(coverage.coverageWarning, true);
  });
});

describe('adversarial: branch and run totals are not independent money', () => {
  it('summing every branch and then adding the run total is not a thing the data allows', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.parallel.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    const runTotal = foldTotals(events).actualSettledCostMicroUsd;
    const branchTotal = aggregateBy(events, 'branch').buckets.reduce(
      (sum, bucket) => sum + bucket.totals.actualSettledCostMicroUsd,
      0,
    );

    // THE SAME ROWS, PARTITIONED. There is no branch accumulator to add to a run
    // accumulator, because there is only one set of rows and every view is a
    // filter over it. Equality here is the proof that a double count is not
    // available rather than merely avoided.
    assert.equal(branchTotal, runTotal);
    assert.equal(runTotal, detail.actualCostMicroUsd);
    assert.notEqual(branchTotal + runTotal, detail.actualCostMicroUsd);
  });

  it('a join fires without emitting an event, because it makes no model call', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.parallel.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.filter((event) => event.nodeId === 'gate').length, 0);
    assert.equal(events.filter((event) => event.nodeId === 'fan').length, 0);
  });
});

describe('adversarial: the baseline cannot be inflated by the integration', () => {
  it('prices the baseline at the agent’s OWN declared ceilings, never higher', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    // The fixture agent allows 4,000 completion tokens. A baseline describing a
    // larger call would be one the tenant was never permitted to make.
    assert.equal(event.baselineTokens, 4_000);
    assert.equal(event.baselineCostMicroUsd, FIN_BASELINE_MICRO_USD);
  });

  it('claims NO capability-downgrade saving for a node that declared no bands', async () => {
    // The single largest fabricated number available to an integration: hand the
    // recommender the full band ladder, price every baseline at the top of it,
    // and "save" the difference on every node in the platform.
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.chain.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    for (const event of events) {
      assert.equal(event.capabilityProfile, 'standard');
      assert.equal(event.decision, 'execute');
    }
    assert.equal(foldTotals(events).estimatedSavingsMicroUsd, 0);
    assert.deepEqual(
      Object.entries(savingsByCategory(events)).filter(([, totals]) => totals.microUsd > 0),
      [],
    );
  });
});
