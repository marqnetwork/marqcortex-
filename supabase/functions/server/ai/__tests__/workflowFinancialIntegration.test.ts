/**
 * Live financial event emission (AI-01 Batch 3B, Integration Pass).
 *
 * ── WHAT THIS SUITE IS FOR ─────────────────────────────────────────────────
 *
 * Parts 6A, 6B and 6C were proved against fixtures. This proves the same
 * guarantees against REAL WORKFLOW RUNS: real registry, real planner, real
 * engine, real agent runtime, real control plane, real compression engine, real
 * eligibility gate, real event ledger and real store. What is substituted is the
 * clock, the ids, the storage backing and the spend a child agent reports.
 *
 * Every claim is asserted in the direction that can FAIL. Not "an event exists"
 * but "exactly one event exists for that call, with that identity, in that
 * settlement state, carrying that baseline" — because an emission path that
 * writes two rows for one call, or converts an unknown to a zero, passes every
 * test of the first kind.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { FinancialEvent } from '../financial/contracts/event.ts';
import { settlementCoverage } from '../financial/engine/settlement.ts';
import { aggregateBy } from '../financial/engine/attributionEngine.ts';
import { createInMemoryFinancialEventStore } from '../financial/persistence/ports.ts';
import { createWorkflowFinancialRecorder } from '../workflows/financial/workflowFinancialRecorder.ts';
import type { WorkflowNodeFinancialFacts } from '../workflows/financial/contracts/emission.ts';
import { createMetrics } from '../observability/metrics.ts';
import { AGENT_TOKEN } from './agentFixtures.ts';
import {
  emptyFlakyLog,
  meteredAgentPort,
  meteredFlakyAgentPort,
  EXECUTABLE,
  WF5_AGENT,
  WF_AGENT,
} from './workflowFixtures.ts';
import { createMemoryWorkflowRunStore } from '../workflows/persistence/ports.ts';
import {
  FIN_BASELINE_MICRO_USD,
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

/** A silent logger, so a degraded-path case does not print to the suite output. */
const quietLogger = () => {
  const noop = () => {};
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return logger;
};

/** The facts a recorder unit test hands over. Identity only, as in production. */
function facts(overrides: Partial<WorkflowNodeFinancialFacts> = {}): WorkflowNodeFinancialFacts {
  return {
    organizationId: 'acme',
    actorId: 'user-consultant',
    workflowId: 'workflow.fin.single',
    workflowVersion: '1.0.0',
    workflowRunId: 'wfr_unit',
    configurationVersion: 1,
    nodeId: 'only',
    agentId: 'agent.wf.alpha',
    attempt: 1,
    maxAttempts: 1,
    protectedWork: false,
    occurredAt: NOW,
    ...overrides,
  };
}

const LIMITS = {
  maxPromptTokens: 10_000,
  maxCompletionTokens: 4_000,
  maxTotalTokens: 14_000,
  maxActualCostMicroUsd: 100_000,
};

// ── The canonical event, from a real run ────────────────────────────────────

describe('live financial emission — the canonical event', () => {
  it('a simple workflow emits ONE canonical event per node, and no more', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.chain.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'completed');
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);

    // THREE NODES, THREE EVENTS. Not four, and not one per advance turn.
    assert.equal(events.length, 3);
    assert.deepEqual(
      [...new Set(events.map((event) => event.eventId))].length,
      3,
      'two events share an id, so one call was counted twice',
    );
    for (const event of events) {
      assert.equal(event.schema, 'ai.financial.event.v1');
      assert.equal(event.eventType, 'inference');
      assert.equal(event.baselinePolicyVersion, 'baseline.v1');
      assert.equal(event.baselineCostMicroUsd, FIN_BASELINE_MICRO_USD);
      assert.equal(event.optimizationPolicyVersion, 'ai.workflow.optimization.v1');
      assert.equal(event.policyVersion, 'ai.settings.v1');
    }
  });

  it('SETTLES from the child usage the certified accounting port measured', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(event.settlementState, 'settled');
    assert.equal(event.settlementBasis, 'provider_reported');
    assert.equal(event.outcome, 'succeeded');
    // The figure on the event is the figure the ledger holds, not a second one.
    assert.equal(event.actualCostMicroUsd, detail.actualCostMicroUsd);
    assert.equal(event.actualTokens, detail.actualTotalTokens);
    assert.equal(event.realizedSavingsMicroUsd, FIN_BASELINE_MICRO_USD - SPEND.costMicroUsd);
  });

  it('PROPAGATES provider and model identity from the trusted usage record', async () => {
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort({
        ...SPEND,
        providerName: 'mock-provider',
        modelName: 'mock-model-1',
        cachedTokens: 120,
      }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(event.provider.providerName, 'mock-provider');
    assert.equal(event.provider.modelName, 'mock-model-1');
    assert.equal(event.agentId, WF_AGENT.alpha);
    assert.equal(event.agentVersion, '1.0.0');
  });

  it('leaves provider identity ABSENT when the usage record establishes none', async () => {
    // "Not recorded" and "recorded as nothing" are different claims, and only one
    // of them is true of a child whose provider the platform cannot name.
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.deepEqual(event.provider, {});
    assert.equal(event.settlementState, 'settled', 'absence of identity must not block settlement');
  });

  it('carries workflow, run, node and agent attribution on every event', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.chain.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.deepEqual(
      events.map((event) => event.nodeId).sort(),
      ['first', 'second', 'third'],
    );
    for (const event of events) {
      assert.equal(event.workflowId, FIN_WORKFLOW.chain.workflowId);
      assert.equal(event.workflowRunId, detail.workflowRunId);
      assert.equal(event.workflowVersion, '1.0.0');
      assert.equal(event.actorId, 'user-consultant');
      assert.ok(event.agentRunId, 'an inference event names the child run that incurred it');
      assert.ok(detail.childAgentRunIds.includes(event.agentRunId));
    }

    // The read model partitions the same rows rather than holding its own.
    const byNode = aggregateBy(events, 'node');
    assert.equal(byNode.buckets.length, 3);
    assert.equal(
      byNode.buckets.reduce((sum, bucket) => sum + bucket.totals.actualSettledCostMicroUsd, 0),
      detail.actualCostMicroUsd,
    );
  });
});

// ── Branches ────────────────────────────────────────────────────────────────

describe('live financial emission — parallel branches', () => {
  it('attributes each branch separately and rolls up WITHOUT double counting', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.parallel.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'completed');
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);

    // Two branch nodes ran. The join fired and executed no inference, so it
    // produced no event — a merge is bookkeeping, not a model call.
    assert.equal(events.length, 2);
    const branchIds = events.map((event) => event.branchId);
    assert.equal(new Set(branchIds).size, 2, 'both branches must be separately attributed');
    for (const event of events) {
      assert.ok(event.branchId);
      assert.ok(event.groupId);
      assert.equal(event.costCategory, 'branch');
    }

    // BRANCH → GROUP → RUN, derived by filtering ONE event set. The run total is
    // the sum of the branch totals because it is the same rows partitioned, not
    // a second accumulator that happens to agree today.
    const runTotal = sumSettled(events, (event) => event.actualCostMicroUsd);
    assert.equal(runTotal, detail.actualCostMicroUsd);
    const group = detail.parallelGroups[0];
    assert.equal(runTotal, group.actualCostMicroUsd);
    assert.equal(
      runTotal,
      group.branches.reduce((sum, branch) => sum + branch.actualCostMicroUsd, 0),
    );
  });
});

// ── Retries ─────────────────────────────────────────────────────────────────

describe('live financial emission — retries', () => {
  it('counts a retry ONCE, and keeps the failed attempt distinguishable', async () => {
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

    assert.equal(detail.state, 'completed');
    assert.equal(log.failures, 1);
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);

    // TWO children, TWO events. Not one (which would drop the failed attempt),
    // and not three (which would count an attempt that never ran).
    assert.equal(events.length, 2);
    const attempts = events.map((event) => event.retryAttempt).sort();
    assert.deepEqual(attempts, [1, 2]);

    // The retry is CATEGORISED, so retry waste analysis can read it — and the
    // first attempt is not re-labelled as one.
    const retry = events.find((event) => event.retryAttempt === 2);
    assert.ok(retry);
    assert.equal(retry.costCategory, 'retry');
    assert.notEqual(events.find((event) => event.retryAttempt === 1)?.costCategory, 'retry');

    // Both lots of spend are present exactly once.
    assert.equal(sumSettled(events, (event) => event.actualCostMicroUsd), 1_400);
    assert.equal(sumSettled(events, (event) => event.actualCostMicroUsd), detail.actualCostMicroUsd);
  });

  it('KEEPS A FAILED ATTEMPT AS SPEND: the failing child is settled, not dropped', async () => {
    const log = emptyFlakyLog();
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredFlakyAgentPort({
        agentId: WF5_AGENT.flaky,
        failures: 1,
        log,
        perChild: { inputTokens: 500, outputTokens: 100, costMicroUsd: 700 },
      }),
    });

    // One attempt permitted, so the transient failure ends the run.
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.retryOnce.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'failed');
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 1);
    assert.equal(events[0].settlementState, 'settled');
    assert.equal(events[0].outcome, 'failed');
    assert.equal(events[0].actualCostMicroUsd, 700);
  });
});

// ── Reuse, through the real Part 6B pipeline ────────────────────────────────

describe('live financial emission — reuse', () => {
  async function reuseHarness(options: {
    readonly semantic: boolean;
    readonly match: 'exact' | 'semantic';
    readonly quality?: 'best_effort' | 'high' | 'critical';
  }) {
    const store = await reusableStoreWith(
      reusableRecord({
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: NOW,
        match: options.match,
        ...(options.quality === undefined ? {} : { quality: options.quality }),
      }),
    );
    const log = { consulted: 0, hits: 0 };
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      reuseResolver: liveReuseResolver({
        store,
        nodeId: 'only',
        nowMs: NOW,
        log,
        ...(options.semantic ? { semantic: true } : {}),
      }),
    });
    return { harness, log };
  }

  it('EXACT reuse emits one avoided call, at a measured zero, with no child run', async () => {
    const { harness, log } = await reuseHarness({ semantic: false, match: 'exact' });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(log.hits, 1);
    // NO AGENT RUN. This is what makes the zero a measurement rather than a
    // claim: nothing executed, so nothing was billed.
    assert.equal(detail.childAgentRunIds.length, 0);
    assert.equal(detail.actualCostMicroUsd, 0);

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.eventType, 'avoided_call');
    assert.equal(event.reuseType, 'exact');
    assert.ok(event.reusableResultId, 'the source record is preserved on the event');
    assert.equal(event.settlementState, 'settled');
    assert.equal(event.settlementBasis, 'measured_absence');
    assert.equal(event.actualCostMicroUsd, 0);
    assert.equal(event.agentRunId, undefined);
    // The baseline is preserved, and the whole of it is attributed to `reuse` by
    // the ONE savings ledger — never re-partitioned here.
    assert.equal(event.baselineCostMicroUsd, FIN_BASELINE_MICRO_USD);
    assert.deepEqual(event.savingsEntries.map((entry) => entry.category), ['reuse']);
    assert.equal(event.savingsEntries[0].microUsd, FIN_BASELINE_MICRO_USD);
  });

  it('SEMANTIC reuse emits one avoided call, tagged semantic and not exact', async () => {
    const { harness, log } = await reuseHarness({ semantic: true, match: 'semantic' });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(log.hits, 1);
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'avoided_call');
    assert.equal(events[0].reuseType, 'semantic');
    // ONE reuse type. Not both — an avoided call recorded as exact AND semantic
    // is the same call counted twice under two names.
    assert.equal(events.filter((event) => event.reuseType === 'exact').length, 0);
  });

  it('A REJECTED CANDIDATE CREATES NO SAVING: the gate refused, so the node ran', async () => {
    // The stored record is `best_effort`; the request demands `standard`. The
    // eligibility gate refuses it, and a refusal is a miss.
    const { harness, log } = await reuseHarness({
      semantic: false,
      match: 'exact',
      quality: 'best_effort',
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(log.consulted, 1);
    assert.equal(log.hits, 0);
    assert.equal(detail.childAgentRunIds.length, 1, 'a rejected candidate must not avoid the call');

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'inference');
    assert.equal(events[0].reuseType, undefined);
    assert.equal(events[0].tokensAvoided, 0);
    assert.deepEqual(events[0].savingsEntries, []);
    assert.equal(events[0].estimatedSavingsMicroUsd, 0);
  });

  it('a reuse resolver that FAILS is a miss, never a hit', async () => {
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      reuseResolver: {
        resolve: () => Promise.reject(new Error('reusable result store unavailable')),
      },
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    // Failing open towards EXECUTION costs money. Failing open towards reuse
    // would serve a stale answer because a store was unreachable.
    assert.equal(detail.state, 'completed');
    assert.equal(detail.childAgentRunIds.length, 1);
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events[0].eventType, 'inference');
  });
});

// ── Compression, routing and deterministic avoidance ────────────────────────

describe('live financial emission — optimisation attribution', () => {
  it('records a ROUTING DOWNGRADE against the band the caller declared', async () => {
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      nodeCostProfileFor: () => ({
        // A deployment that declares its nodes may run at three bands and would
        // otherwise have used the top one. THIS is what makes a downgrade
        // saving defensible: the baseline band was declared, not assumed.
        allowedCapabilityProfiles: ['economy', 'standard', 'reasoning'],
        maximumCapabilityProfile: 'reasoning',
        kind: 'classification',
        quality: 'standard',
      }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(event.decision, 'downgrade');
    assert.equal(event.decisionReason, 'profile_downgraded');
    assert.equal(event.capabilityProfile, 'economy');
    assert.ok(event.estimatedSavingsMicroUsd > 0);
    assert.ok(
      event.savingsEntries.some((entry) => entry.category === 'capability_downgrade'),
      'a downgrade must be attributed to the downgrade category',
    );
    // The partition sums to the estimated gap. Part 6A's ledger guarantees it;
    // this asserts the guarantee survived the trip through the emission path.
    assert.equal(
      event.savingsEntries.reduce((sum, entry) => sum + entry.microUsd, 0),
      event.estimatedSavingsMicroUsd,
    );
  });

  it('records a COMPRESSION decision with its reason code, claiming nothing extra', async () => {
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      nodeCostProfileFor: () => ({ expectedOutputTokens: 500 }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    // A declared output expectation below the allowance is a real narrowing, and
    // it is attributed to the output-budget category and to no other.
    assert.ok(event.optimizedEstimatedCostMicroUsd < event.baselineCostMicroUsd);
    assert.ok(
      event.savingsEntries.some((entry) => entry.category === 'output_budget_reduction'),
    );
    assert.equal(
      event.savingsEntries.reduce((sum, entry) => sum + entry.microUsd, 0),
      event.estimatedSavingsMicroUsd,
    );
  });

  it('records DETERMINISTIC AVOIDANCE, with no child run and no reuse claim', async () => {
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      nodeCostProfileFor: () => ({
        kind: 'calculation',
        quality: 'standard',
        deterministicCapabilities: [
          {
            capabilityId: 'cap.readiness.rollup',
            satisfies: ['calculation'],
            complete: true,
            maximumQuality: 'critical',
          },
        ],
      }),
    });

    // A node with NO output contract, because a deterministic capability
    // declares that a path exists and not what it returns.
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.single.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(detail.childAgentRunIds.length, 0);
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.eventType, 'avoided_call');
    assert.equal(event.decision, 'deterministic');
    assert.equal(event.settlementBasis, 'measured_absence');
    assert.equal(event.actualCostMicroUsd, 0);
    // DETERMINISTIC, NOT REUSE. The saving is attributed once, under one name.
    assert.equal(event.reuseType, undefined);
    assert.deepEqual(
      event.savingsEntries.map((entry) => entry.category),
      ['deterministic_avoidance'],
    );
  });

  it('claims NOTHING for an undeclared node — a truthful cost and a zero saving', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(event.decision, 'execute');
    assert.equal(event.estimatedSavingsMicroUsd, 0);
    assert.deepEqual(event.savingsEntries, []);
    assert.equal(event.baselineCostMicroUsd, event.optimizedEstimatedCostMicroUsd);
  });
});

// ── Terminal finalization ───────────────────────────────────────────────────

describe('live financial emission — terminal finalization', () => {
  it('a COMPLETED run leaves every event settled, and stamps the outcome', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.chain.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(events.length, 3);
    for (const event of events) {
      assert.equal(event.settlementState, 'settled');
      assert.equal(event.outcome, 'succeeded');
    }
    assert.equal(settlementCoverage(events).coveragePercent, 100);
  });

  it('a FAILED run keeps the spend it incurred before it failed', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.failsMidway.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'failed');
    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    // Both nodes ran. The failed one is spend, not an absence.
    assert.equal(events.length, 2);
    assert.equal(sumSettled(events, (event) => event.actualCostMicroUsd), detail.actualCostMicroUsd);
    assert.ok(detail.actualCostMicroUsd > 0);
    assert.equal(events.filter((event) => event.outcome === 'failed').length, 1);
    assert.equal(events.filter((event) => event.outcome === 'succeeded').length, 1);
  });

  it('CANCELLATION preserves spend already incurred, measured rather than unknown', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const created = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });
    assert.equal(created.state, 'waiting_for_agent');

    const cancelled = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
      reason: 'An operator stopped this run.',
    });
    assert.equal(cancelled.state, 'cancelled');

    const events = await eventsFor(harness.workflows.financialEvents, cancelled.organizationId);
    assert.equal(events.length, 2);
    // Node one completed and settled during the run. Node two's child was still
    // blocked, so its event was pending — and finalization settled it from the
    // run's OWN ledger rather than reporting measured money as unknown.
    assert.equal(events.filter((event) => event.settlementState === 'settled').length, 2);
    assert.equal(
      sumSettled(events, (event) => event.actualCostMicroUsd),
      cancelled.actualCostMicroUsd,
    );
    assert.ok(events.some((event) => event.outcome === 'cancelled'));
  });

  it('EXPIRY preserves spend already incurred', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const created = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });

    harness.clock.advance(48 * 60 * 60_000);
    const expired = await harness.workflows.service.expireRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
      reason: 'The deadline passed.',
    });
    assert.equal(expired.state, 'expired');

    const events = await eventsFor(harness.workflows.financialEvents, expired.organizationId);
    assert.equal(
      sumSettled(events, (event) => event.actualCostMicroUsd),
      expired.actualCostMicroUsd,
    );
    assert.ok(expired.actualCostMicroUsd > 0, 'the run really did spend before expiring');
  });

  it('marks an event UNSETTLED_TERMINAL when no measurement was ever established', async () => {
    // No metering at all, so the children report nothing. The event is created
    // pending and there is nothing anywhere to settle it from.
    const harness = buildFinancialRuntime();
    const created = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });
    const cancelled = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
      reason: 'An operator stopped this run.',
    });

    const events = await eventsFor(harness.workflows.financialEvents, cancelled.organizationId);
    const unsettled = events.filter((event) => event.settlementState === 'unsettled_terminal');
    assert.ok(unsettled.length > 0, 'a call with no measurement must be reported as unknown');
    for (const event of unsettled) {
      // NEVER ZERO. The measurement is absent, and the baseline is retained so
      // the spend shows up as unknown rather than as free.
      assert.equal(event.actualCostMicroUsd, undefined);
      assert.equal(event.realizedSavingsMicroUsd, undefined);
      assert.equal(event.settlementBasis, 'none');
      assert.equal(event.baselineCostMicroUsd, FIN_BASELINE_MICRO_USD);
      assert.equal(event.outcome, 'cancelled');
    }
  });

  it('moves SETTLEMENT COVERAGE, and counts unsettled terminal events in it', async () => {
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
    // The unsettled event is in the DENOMINATOR. Excluding it would report
    // perfect coverage over the events that happened to settle, which is the
    // most flattering possible reading of an incomplete ledger.
    assert.equal(coverage.expectedToSettle, events.length);
    assert.ok(coverage.unsettledTerminal > 0);
    assert.ok(coverage.coveragePercent < 100);
    assert.ok(coverage.unsettledBaselineMicroUsd > 0);
  });

  it('is IDEMPOTENT: finalizing a terminal run again changes nothing', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.chain.workflowId,
      input: FIN_TOPIC,
    });

    const before = await eventsFor(harness.workflows.financialEvents, detail.organizationId);

    // Advancing a terminal run re-runs finalization. Five times over.
    for (let pass = 0; pass < 5; pass += 1) {
      await harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: detail.workflowRunId,
      });
    }

    const after = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(after.length, before.length);
    assert.deepEqual(after, before, 'a repeated finalization rewrote an event');
  });

  it('CONVERGES under concurrent finalization', async () => {
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

    const settled = await eventsFor(harness.workflows.financialEvents, cancelled.organizationId);

    // Eight finalizations in flight at once over one terminal run.
    await Promise.all(
      Array.from({ length: 8 }, () =>
        harness.workflows.service.advanceRun({
          ...harness.meta(AGENT_TOKEN.consultant),
          workflowRunId: created.workflowRunId,
        }),
      ),
    );

    const after = await eventsFor(harness.workflows.financialEvents, cancelled.organizationId);
    assert.equal(after.length, settled.length);
    assert.deepEqual(after, settled);
  });
});

// ── Restart ─────────────────────────────────────────────────────────────────

describe('live financial emission — restart', () => {
  it('a SECOND ISOTATE over the same stores writes no second event', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const financialEventStore = createInMemoryFinancialEventStore();

    const first = buildFinancialRuntime({
      runStore,
      financialEventStore,
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    const detail = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.chain.workflowId,
      input: FIN_TOPIC,
    });
    const before = await eventsFor(financialEventStore, detail.organizationId);
    assert.equal(before.length, 3);

    // A NEW runtime over the SAME stores. Fresh isolate, empty memory, same
    // durable facts — which is exactly the situation the derived event id is for.
    const second = buildFinancialRuntime({
      runStore,
      financialEventStore,
      idSeed: 'b',
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });

    const after = await eventsFor(financialEventStore, detail.organizationId);
    assert.equal(after.length, 3, 'a restart duplicated a financial event');
    assert.deepEqual(after, before);
  });

  /**
   * THE FIVE CRASH WINDOWS, AND WHAT EACH ONE GUARANTEES.
   *
   * Stated here rather than claimed in prose, because "exactly once" is the
   * easiest property in this area to assert and the hardest to hold:
   *
   *   1. INFERENCE HAPPENED, THE EVENT WAS NOT WRITTEN. Recovered. `settleAttempt`
   *      appends before it settles, so the settled row is inserted in one step.
   *   2. EVENT PENDING, SETTLEMENT LOST. Recovered at terminal finalization,
   *      which settles from the run's own usage ledger.
   *   3. SETTLEMENT WRITTEN, TERMINALIZATION LOST. The settled event is
   *      preserved exactly as it was; finalization never revisits a measurement.
   *   4. TERMINALIZED, FINALIZATION LOST. The next advance over the terminal run
   *      finalizes it. Nothing else is required to happen for that to occur.
   *   5. FINALIZATION REPEATED. Converges. Idempotent by the derived id and by
   *      the store's refusal to settle twice.
   *
   * NOT EXACTLY-ONCE DELIVERY. What is proved is exactly-once ACCOUNTING: the
   * derived event id means a duplicate write is refused rather than prevented,
   * and a lost write is recoverable rather than impossible. An event may be
   * attempted many times; it is stored and settled once.
   */
  it('WINDOW 1: inference happened and the pending write was lost — recovered, once', async () => {
    // CRASH WINDOW 1: the child was created and the pointer persisted, but the
    // isolate died before the pending event was written. The financial store is
    // introduced only for the SECOND isolate, so the first wrote nothing.
    const runStore = createMemoryWorkflowRunStore();
    const financialEventStore = createInMemoryFinancialEventStore();

    const first = buildFinancialRuntime({
      runStore,
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    const created = await first.workflows.service.createRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const second = buildFinancialRuntime({
      runStore,
      financialEventStore,
      idSeed: 'b',
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    const finished = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });

    assert.equal(finished.state, 'completed');
    const events = await eventsFor(financialEventStore, finished.organizationId);
    assert.equal(events.length, 1, 'the recovered settlement wrote more than one row');
    assert.equal(events[0].settlementState, 'settled');
    assert.equal(events[0].actualCostMicroUsd, SPEND.costMicroUsd);
  });

  it('WINDOW 2: the event was pending and the settlement was lost — settled at finalization', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const financialEventStore = createInMemoryFinancialEventStore();

    // An isolate that wrote the pending event and then died before settling it.
    const first = buildFinancialRuntime({
      runStore,
      financialEventStore,
      wrapAgentPort: meteredAgentPort(SPEND),
      wrapFinancialPort: (port) => ({ ...port, settleAttempt: () => Promise.resolve() }),
    });
    const detail = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    assert.equal(detail.state, 'completed');
    const lost = await eventsFor(financialEventStore, detail.organizationId);
    assert.equal(lost.length, 1);
    // The run terminalized through the SAME isolate, so its finalization ran and
    // settled the event from the ledger. The measurement was never lost, because
    // the usage fold and the run's state were written together.
    assert.equal(lost[0].settlementState, 'settled');
    assert.equal(lost[0].actualCostMicroUsd, SPEND.costMicroUsd);
    // NEVER ZERO, whichever path settled it.
    assert.notEqual(lost[0].actualCostMicroUsd, 0);
  });

  it('WINDOW 3: the settlement was written and terminalization was lost — preserved', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const financialEventStore = createInMemoryFinancialEventStore();

    // Node one settles. Node two blocks, so the run does not terminalize here.
    const first = buildFinancialRuntime({
      runStore,
      financialEventStore,
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    const created = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });
    const settledBefore = (await eventsFor(financialEventStore, created.organizationId)).find(
      (event) => event.nodeId === 'first',
    );
    assert.ok(settledBefore);
    assert.equal(settledBefore.settlementState, 'settled');

    // A second isolate terminalizes the run.
    const second = buildFinancialRuntime({
      runStore,
      financialEventStore,
      idSeed: 'b',
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    await second.workflows.service.cancelRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
      reason: 'stopped',
    });

    const after = (await eventsFor(financialEventStore, created.organizationId)).find(
      (event) => event.nodeId === 'first',
    );
    // BYTE-IDENTICAL. A measurement that arrived is not revisited by a run
    // ending, and its outcome is not restated to the run's.
    assert.deepEqual(after, settledBefore);
  });

  it('WINDOW 4: the run terminalized and finalization was lost — the next advance finalizes it', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const financialEventStore = createInMemoryFinancialEventStore();

    // An isolate whose finalization never ran.
    const first = buildFinancialRuntime({
      runStore,
      financialEventStore,
      wrapFinancialPort: (port) => ({
        ...port,
        finalizeRun: () =>
          Promise.resolve({
            examined: 0,
            preserved: 0,
            settled: 0,
            abandoned: 0,
            degraded: false,
          }),
      }),
    });
    const created = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });
    const cancelled = await first.workflows.service.cancelRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
      reason: 'stopped',
    });
    assert.equal(cancelled.state, 'cancelled');

    const stranded = await eventsFor(financialEventStore, cancelled.organizationId);
    assert.ok(
      stranded.some((event) => event.settlementState === 'pending'),
      'the window did not actually leave a pending event',
    );

    // A recovered isolate advances the terminal run. Advancing a terminal run
    // does nothing to the run and everything to its unfinished accounting.
    const second = buildFinancialRuntime({
      runStore,
      financialEventStore,
      idSeed: 'b',
    });
    const reread = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });

    assert.equal(reread.state, 'cancelled', 'finalization must not mutate the execution outcome');
    const after = await eventsFor(financialEventStore, cancelled.organizationId);
    assert.equal(after.length, stranded.length, 'recovery wrote a second row');
    assert.equal(
      after.filter((event) => event.settlementState === 'pending').length,
      0,
      'a terminal run was left with a pending financial event',
    );
  });

  it('WINDOW 5: finalization repeated after restart converges on the same rows', async () => {
    const runStore = createMemoryWorkflowRunStore();
    const financialEventStore = createInMemoryFinancialEventStore();

    const first = buildFinancialRuntime({ runStore, financialEventStore });
    const created = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });
    const cancelled = await first.workflows.service.cancelRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
      reason: 'stopped',
    });
    const converged = await eventsFor(financialEventStore, cancelled.organizationId);

    for (const seed of ['b', 'c', 'd']) {
      const isolate = buildFinancialRuntime({ runStore, financialEventStore, idSeed: seed });
      await isolate.workflows.service.advanceRun({
        ...isolate.meta(AGENT_TOKEN.consultant),
        workflowRunId: created.workflowRunId,
      });
      assert.deepEqual(
        await eventsFor(financialEventStore, cancelled.organizationId),
        converged,
        `isolate ${seed} changed the ledger`,
      );
    }
  });
});

// ── Tenancy ─────────────────────────────────────────────────────────────────

describe('live financial emission — tenancy', () => {
  it('REFUSES a cross-tenant read of another organization’s events', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const own = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(own.length, 1);

    // The SAME event id, asked for under a different tenant. There is no
    // cross-tenant listing by design, and `getById` is tenant-scoped too.
    const foreign = await eventsFor(harness.workflows.financialEvents, 'globex');
    assert.deepEqual(foreign, []);
    assert.equal(
      await harness.workflows.financialEvents.getById('globex', own[0].eventId),
      undefined,
    );
  });
});

// ── The kill switch, and the store being unavailable ───────────────────────

describe('live financial emission — stopped execution and degraded storage', () => {
  const recorderWith = (options: {
    readonly aiEnabled: boolean;
    readonly store?: ReturnType<typeof createInMemoryFinancialEventStore>;
  }) =>
    createWorkflowFinancialRecorder({
      store: options.store ?? createInMemoryFinancialEventStore(),
      limitsFor: () => LIMITS,
      aiEnabled: () => options.aiEnabled,
      logger: quietLogger(),
      metrics: createMetrics(),
    });

  it('THE KILL SWITCH CREATES NO FAKE INFERENCE EVENT, and fabricates no saving', async () => {
    const store = createInMemoryFinancialEventStore();
    const recorder = recorderWith({ aiEnabled: false, store });

    const decision = await recorder.decideNode(facts());
    assert.ok(decision);
    assert.equal(decision.refused, true);
    assert.equal(decision.plan.decision, 'deny');

    await recorder.recordAttempt(facts(), decision);
    const events = await eventsFor(store, 'acme');
    assert.equal(events.length, 1);
    const [event] = events;

    // A refusal is not an inference. Nothing executed, so no event may claim it
    // did — and nothing was optimised, so no event may claim a saving.
    assert.equal(event.eventType, 'refused');
    assert.equal(event.settlementState, 'not_applicable');
    assert.equal(event.baselineCostMicroUsd, 0);
    assert.equal(event.estimatedSavingsMicroUsd, 0);
    assert.equal(event.tokensAvoided, 0);
    assert.deepEqual(event.savingsEntries, []);
    assert.equal(events.filter((candidate) => candidate.eventType === 'inference').length, 0);
    assert.equal(events.filter((candidate) => candidate.eventType === 'avoided_call').length, 0);
  });

  it('AN UNAVAILABLE STORE DEGRADES REPORTING AND NEVER EXECUTION', async () => {
    // Fail-open, with a signal. See `workflowFinancialRecorder.ts` for why a
    // reporting layer that could refuse a terminal transition would be a veto
    // over execution.
    const unavailable = {
      append: () => Promise.reject(new Error('financial event store unavailable')),
      getById: () => Promise.reject(new Error('financial event store unavailable')),
      settle: () => Promise.reject(new Error('financial event store unavailable')),
      list: () => Promise.reject(new Error('financial event store unavailable')),
    };
    const recorder = createWorkflowFinancialRecorder({
      store: unavailable,
      limitsFor: () => LIMITS,
      aiEnabled: () => true,
      logger: quietLogger(),
      metrics: createMetrics(),
    });

    const decision = await recorder.decideNode(facts());
    assert.ok(decision);
    // None of these throw. All of them resolve.
    await recorder.recordAttempt(facts(), decision);
    await recorder.settleAttempt(facts(), decision, {
      actualCostMicroUsd: 900,
      actualTokens: 700,
      outcome: 'succeeded',
    });
    const report = await recorder.finalizeRun({
      organizationId: 'acme',
      workflowId: 'workflow.fin.single',
      workflowRunId: 'wfr_unit',
      outcome: 'succeeded',
      occurredAt: NOW,
      fromMs: NOW - 1_000,
      usageRows: [],
    });

    // The failure is DETECTABLE rather than merely survived.
    assert.equal(report.degraded, true);
    assert.equal(report.examined, 0);
  });

  it('runs a workflow to completion with financial recording switched OFF', async () => {
    const harness = buildFinancialRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      financialPort: {
        openRun: () => Promise.resolve(),
        decideNode: () => Promise.resolve(undefined),
        recordAttempt: () => Promise.resolve(),
        settleAttempt: () => Promise.resolve(),
        finalizeRun: () =>
          Promise.resolve({
            examined: 0,
            preserved: 0,
            settled: 0,
            abandoned: 0,
            degraded: false,
          }),
      },
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.chain.workflowId,
      input: FIN_TOPIC,
    });

    // Identical execution. The engine's branches do not depend on the recorder.
    assert.equal(detail.state, 'completed');
    assert.equal(detail.childAgentRunIds.length, 3);
    assert.equal(detail.actualCostMicroUsd, 3 * SPEND.costMicroUsd);
  });

  it('records nothing at all for an agent whose limits cannot be resolved', async () => {
    const store = createInMemoryFinancialEventStore();
    const recorder = createWorkflowFinancialRecorder({
      store,
      // No envelope. A baseline priced against an invented ceiling is a savings
      // denominator nobody could defend.
      limitsFor: () => undefined,
      aiEnabled: () => true,
      logger: quietLogger(),
      metrics: createMetrics(),
    });

    assert.equal(await recorder.decideNode(facts()), undefined);
    assert.deepEqual(await eventsFor(store, 'acme'), []);
  });
});

// ── Reconciliation ──────────────────────────────────────────────────────────

describe('live financial emission — reconciliation', () => {
  it('the run total equals the node totals equals the branch totals, once', async () => {
    const harness = buildFinancialRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.parallel.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    const total = sumSettled(events, (event: FinancialEvent) => event.actualCostMicroUsd);

    // Every dimension is a PARTITION of the same rows, so each one sums to the
    // same figure. A branch total that could be added to a run total would mean
    // one of them was a second accumulator.
    for (const dimension of ['workflow', 'node', 'branch', 'agent'] as const) {
      const aggregate = aggregateBy(events, dimension);
      assert.equal(
        aggregate.buckets.reduce((sum, bucket) => sum + bucket.totals.actualSettledCostMicroUsd, 0),
        total,
        `the ${dimension} partition does not reconcile with the run total`,
      );
    }
    assert.equal(total, detail.actualCostMicroUsd);
  });
});
