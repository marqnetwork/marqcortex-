/**
 * Production optimization wiring — integration
 * (AI-01 Batch 3B, Production Optimization Wiring).
 *
 * ── WHAT THIS SUITE IS FOR ─────────────────────────────────────────────────
 *
 * Parts 6A, 6B and 6C are proved by their own suites, and the Integration Pass
 * proved that a workflow run produces canonical events. What none of them could
 * prove is that the PRODUCTION assembly reaches those components at all — a
 * platform whose cost registry is never consulted, whose reuse resolver is never
 * built and whose financial store is quietly isolate-local passes every one of
 * those suites and measures nothing.
 *
 * So every case here runs a real workflow through the real assembly and asserts
 * on what the assembly ACTUALLY WIRED. Nothing constructs a candidate, a plan, a
 * profile or an event by hand.
 *
 * The adversarial companion is `workflowProductionAdversarial.test.ts`, which
 * attacks the savings figure directly. This suite establishes that the wiring
 * works; that one establishes that it cannot be made to lie.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AGENT_TOKEN } from './agentFixtures.ts';
import {
  FIN_AGENT,
  FIN_ORG,
  FIN_TOPIC,
  FIN_WORKFLOW,
  eventsFor,
} from './workflowFinancialFixtures.ts';
import {
  PROD_REUSE_FINDING,
  buildProductionRuntime,
  createFakeKv,
  durableFinancialStore,
  productionReusableRecord,
  reusableWithStoredQualityBelow,
  storeWith,
} from './workflowProductionFixtures.ts';
import { WF_AGENT, meteredAgentPort } from './workflowFixtures.ts';
import { createInMemoryReusableResultStore } from '../reuse/persistence/ports.ts';
import { NODE_COST_REGISTRY_VERSION } from '../workflows/financial/nodeCostRegistry.ts';

/** Cumulative micro-USD every metered child reports. */
const SPEND = { inputTokens: 1_000, outputTokens: 400, costMicroUsd: 1_500 } as const;

// ── Durable financial storage ───────────────────────────────────────────────

describe('production wiring — durable financial evidence', () => {
  it('writes a run\'s events through the REAL Part 6C key-value store', async () => {
    const kv = createFakeKv();
    const harness = buildProductionRuntime({
      financialEventStore: durableFinancialStore(kv),
      wrapAgentPort: meteredAgentPort(SPEND),
    });

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });
    assert.equal(detail.state, 'completed');

    // The rows are in the KEY-VALUE STORE, not in a closure. A store that had
    // quietly fallen back to memory would leave this empty while every other
    // assertion in the suite still passed.
    const rows = kv.keys().filter((key) => key.includes(':ai:financial_event:'));
    assert.ok(rows.length > 0, 'a durable financial event key must exist');
  });

  it('SURVIVES AN ISOLATE RESTART: a second runtime reads the first one\'s events', async () => {
    const kv = createFakeKv();
    const first = buildProductionRuntime({
      financialEventStore: durableFinancialStore(kv),
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    const detail = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    // A NEW RUNTIME OVER THE SAME STORAGE. No shared object, no shared closure —
    // the second isolate knows only what the key-value store holds.
    const second = buildProductionRuntime({
      financialEventStore: durableFinancialStore(kv),
      idSeed: 'b',
    });
    const events = await eventsFor(second.workflows.financialEvents, detail.organizationId);
    assert.ok(events.length > 0, 'the recovered isolate must see the events');
    // And the SETTLEMENT survived too, which is the half a naive durability test
    // misses: an event that survived pending is spend the platform still cannot
    // account for.
    assert.ok(
      events.every((event) => event.settlementState !== 'pending'),
      'a completed run leaves no pending event behind a restart',
    );
    assert.ok(events.some((event) => event.actualCostMicroUsd === SPEND.costMicroUsd));
  });

  it('reports a DEGRADED store rather than claiming isolate-local durability', () => {
    // The deployment asked for durability and no store was injected. Execution
    // is unaffected; the claim is not.
    const harness = buildProductionRuntime({ financialDurableConfigured: true });
    const health = harness.workflows.optimizationHealth();

    assert.equal(health.durableFinancialStore.configured, true);
    assert.equal(health.durableFinancialStore.available, false);
    assert.equal(health.degraded, true);
  });

  it('does not claim durability a deployment never asked for', () => {
    const harness = buildProductionRuntime({ financialDurableConfigured: false });
    const health = harness.workflows.optimizationHealth();
    assert.equal(health.durableFinancialStore.configured, false);
    assert.equal(health.durableFinancialStore.available, false);
    // Not degraded: nothing was asked for and nothing was lost. A flag that
    // fired here would be a flag nobody could act on.
    assert.equal(health.degraded, false);
  });
});

// ── The production node cost-profile registry ───────────────────────────────

describe('production wiring — truthful node cost profiles', () => {
  it('derives the band list from the agent\'s OWN approved model profiles', () => {
    const harness = buildProductionRuntime();
    const profile = harness.workflows.nodeCostRegistry.profileFor({
      organizationId: FIN_ORG,
      actorId: 'user_x',
      workflowId: FIN_WORKFLOW.routed.workflowId,
      workflowVersion: '1.0.0',
      workflowRunId: 'wfr_x',
      configurationVersion: 1,
      nodeId: 'only',
      agentId: FIN_AGENT.routed,
      attempt: 1,
      maxAttempts: 1,
      protectedWork: false,
      occurredAt: 0,
    });

    // `routed` declares a `standard`-quality and a `baseline`-quality profile.
    // Two declared bands, and the maximum is the higher of the two — NOT the top
    // of the ladder.
    assert.deepEqual(profile?.allowedCapabilityProfiles, ['economy', 'standard']);
    assert.equal(profile?.maximumCapabilityProfile, 'standard');
    assert.notEqual(profile?.maximumCapabilityProfile, 'advanced_reasoning');
  });

  it('claims NO routing saving for an agent that declares ONE profile', () => {
    const harness = buildProductionRuntime();
    const profile = harness.workflows.nodeCostRegistry.profileFor({
      organizationId: FIN_ORG,
      actorId: 'user_x',
      workflowId: FIN_WORKFLOW.pinned.workflowId,
      workflowVersion: '1.0.0',
      workflowRunId: 'wfr_x',
      configurationVersion: 1,
      nodeId: 'only',
      agentId: FIN_AGENT.pinned,
      attempt: 1,
      maxAttempts: 1,
      protectedWork: false,
      occurredAt: 0,
    });
    // A single band makes `downgraded` unreachable. That is the whole control.
    assert.deepEqual(profile?.allowedCapabilityProfiles, ['standard']);
    assert.equal(profile?.maximumCapabilityProfile, 'standard');
  });

  it('COLLAPSES the band list when a declared profile cannot be resolved', () => {
    const harness = buildProductionRuntime();
    const profile = harness.workflows.nodeCostRegistry.profileFor({
      organizationId: FIN_ORG,
      actorId: 'user_x',
      workflowId: FIN_WORKFLOW.unknownProfile.workflowId,
      workflowVersion: '1.0.0',
      workflowRunId: 'wfr_x',
      configurationVersion: 1,
      nodeId: 'only',
      agentId: FIN_AGENT.unknownProfile,
      attempt: 1,
      maxAttempts: 1,
      protectedWork: false,
      occurredAt: 0,
    });
    // One resolvable profile and one that is not. Assuming the unresolvable one
    // was cheap would be a saving derived from a fact nobody could produce, so
    // the list collapses to the maximum and no routing saving is reachable.
    assert.deepEqual(profile?.allowedCapabilityProfiles, ['standard']);
  });

  it('NARROWS the completion allowance to what the approved profiles can emit', () => {
    const harness = buildProductionRuntime();
    // `routed` allows 4,000 completion tokens; its widest approved profile emits
    // 1,200. The baseline is priced on the SMALLER figure, which lowers the
    // denominator rather than raising it.
    const limits = harness.workflows.nodeCostRegistry.limitsFor(FIN_AGENT.routed);
    assert.equal(limits?.maxCompletionTokens, 1_200);
    // An agent with no approved profiles keeps its own ceiling untouched.
    const undeclared = harness.workflows.nodeCostRegistry.limitsFor(WF_AGENT.alpha);
    assert.equal(undeclared?.maxCompletionTokens, 4_000);
  });

  it('records NOTHING for an agent the registry does not hold', async () => {
    const harness = buildProductionRuntime();
    assert.equal(harness.workflows.nodeCostRegistry.limitsFor('agent.nobody'), undefined);
    assert.equal(
      harness.workflows.nodeCostRegistry.profileFor({
        organizationId: FIN_ORG,
        actorId: 'user_x',
        workflowId: 'w',
        workflowVersion: '1',
        workflowRunId: 'r',
        configurationVersion: 1,
        nodeId: 'n',
        agentId: 'agent.nobody',
        attempt: 1,
        maxAttempts: 1,
        protectedWork: false,
        occurredAt: 0,
      }),
      undefined,
    );
    await Promise.resolve();
  });

  it('prices a REAL run against the narrowed envelope, and claims a real downgrade', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.routed.workflowId,
      input: FIN_TOPIC,
    });

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    // 1,200 completion tokens at the `standard` band's 3,000 micro-USD per 1k.
    assert.equal(event.baselineTokens, 1_200);
    assert.equal(event.baselineCostMicroUsd, 3_600);
    assert.equal(event.optimizationPolicyVersion, 'ai.workflow.optimization.v1');
    // Every saving it does claim is partitioned and sums to the gap.
    assert.equal(
      event.savingsEntries.reduce((sum, entry) => sum + entry.microUsd, 0),
      event.estimatedSavingsMicroUsd,
    );
    assert.ok(event.estimatedSavingsMicroUsd <= event.baselineCostMicroUsd);
  });
});

// ── Production reuse ────────────────────────────────────────────────────────

describe('production wiring — exact reuse', () => {
  const runOnce = async (
    harness: ReturnType<typeof buildProductionRuntime>,
    workflowId: string,
  ) =>
    harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId,
      input: FIN_TOPIC,
    });

  it('an EXACT HIT answers the node and creates no child agent run', async () => {
    const reuse = createInMemoryReusableResultStore();
    const harness = buildProductionRuntime({ reuse, wrapAgentPort: meteredAgentPort(SPEND) });
    await storeWith(
      reuse,
      productionReusableRecord({
        harness,
        organizationId: FIN_ORG,
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: harness.clock.now(),
        input: FIN_TOPIC,
      }),
    );

    const detail = await runOnce(harness, FIN_WORKFLOW.single.workflowId);
    assert.equal(detail.state, 'completed');

    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.deepEqual(record?.childAgentRunIds, [], 'a reused node creates NO child run');

    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.equal(event.decision, 'reuse');
    assert.equal(event.reuseType, 'exact');
    // Zero because nothing ran — a MEASUREMENT, not an assumption.
    assert.equal(event.actualCostMicroUsd, 0);
    assert.equal(event.settlementState, 'settled');
    assert.equal(event.settlementBasis, 'measured_absence');
  });

  it('a MISS creates the child and pays, exactly as it did before reuse existed', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await runOnce(harness, FIN_WORKFLOW.single.workflowId);

    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1);
    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.notEqual(event.decision, 'reuse');
    assert.equal(event.actualCostMicroUsd, SPEND.costMicroUsd);
  });

  it('a STALE record falls through — an expired answer is not an answer', async () => {
    const reuse = createInMemoryReusableResultStore();
    const harness = buildProductionRuntime({ reuse, wrapAgentPort: meteredAgentPort(SPEND) });
    await storeWith(
      reuse,
      productionReusableRecord({
        harness,
        organizationId: FIN_ORG,
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: harness.clock.now(),
        input: FIN_TOPIC,
        // Written two hours ago, valid for one.
        createdAt: harness.clock.now() - 7_200_000,
        ttlMs: 3_600_000,
      }),
    );

    const detail = await runOnce(harness, FIN_WORKFLOW.single.workflowId);
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1, 'an expired record must not answer the node');
    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);
    assert.notEqual(event.decision, 'reuse');
  });

  it('a record whose STORED QUALITY is below the contract falls through', async () => {
    const reuse = createInMemoryReusableResultStore();
    const harness = buildProductionRuntime({ reuse, wrapAgentPort: meteredAgentPort(SPEND) });
    await storeWith(
      reuse,
      reusableWithStoredQualityBelow({
        harness,
        organizationId: FIN_ORG,
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: harness.clock.now(),
        input: FIN_TOPIC,
      }),
    );

    const detail = await runOnce(harness, FIN_WORKFLOW.single.workflowId);
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1);
  });

  it('ANOTHER TENANT\'S record is never found, however perfect it otherwise is', async () => {
    const reuse = createInMemoryReusableResultStore();
    const harness = buildProductionRuntime({ reuse, wrapAgentPort: meteredAgentPort(SPEND) });
    await storeWith(
      reuse,
      productionReusableRecord({
        harness,
        organizationId: FIN_ORG,
        sealForOrganizationId: 'globex',
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: harness.clock.now(),
        input: FIN_TOPIC,
      }),
    );

    const detail = await runOnce(harness, FIN_WORKFLOW.single.workflowId);
    assert.equal(detail.organizationId, FIN_ORG);
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1, 'a cross-tenant record must not be reused');
  });

  it('a DIFFERENT INPUT does not share the answer', async () => {
    const reuse = createInMemoryReusableResultStore();
    const harness = buildProductionRuntime({ reuse, wrapAgentPort: meteredAgentPort(SPEND) });
    await storeWith(
      reuse,
      productionReusableRecord({
        harness,
        organizationId: FIN_ORG,
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: harness.clock.now(),
        // Sealed for a different question entirely.
        input: { topic: 'something else' },
      }),
    );

    const detail = await runOnce(harness, FIN_WORKFLOW.single.workflowId);
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1, 'the exact key must bind the input');
  });

  it('a record sealed under a DIFFERENT PLAN DIGEST falls through', async () => {
    const reuse = createInMemoryReusableResultStore();
    const harness = buildProductionRuntime({ reuse, wrapAgentPort: meteredAgentPort(SPEND) });
    await storeWith(
      reuse,
      productionReusableRecord({
        harness,
        organizationId: FIN_ORG,
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: harness.clock.now(),
        input: FIN_TOPIC,
        planDigest: 'plan_from_a_workflow_that_changed',
      }),
    );

    const detail = await runOnce(harness, FIN_WORKFLOW.single.workflowId);
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1);
  });

  it('REUSE SWITCHED OFF is honoured even with a perfect record present', async () => {
    const reuse = createInMemoryReusableResultStore();
    const harness = buildProductionRuntime({
      reuse,
      reuseEnabled: () => false,
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    await storeWith(
      reuse,
      productionReusableRecord({
        harness,
        organizationId: FIN_ORG,
        workflowId: FIN_WORKFLOW.single.workflowId,
        nodeId: 'only',
        agentId: WF_AGENT.alpha,
        nowMs: harness.clock.now(),
        input: FIN_TOPIC,
      }),
    );

    const detail = await runOnce(harness, FIN_WORKFLOW.single.workflowId);
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1);
  });
});

// ── Branch-safe avoidance ───────────────────────────────────────────────────

describe('production wiring — branch-safe avoidance', () => {
  /** Seed a hit for ONE branch node of the fan-out fixture. */
  const seedBranch = async (
    harness: ReturnType<typeof buildProductionRuntime>,
    nodeId: 'left_step' | 'right_step',
    agentId: string,
    overrides: Partial<Parameters<typeof productionReusableRecord>[0]> = {},
  ) =>
    storeWith(
      harness.reusableResultStore,
      productionReusableRecord({
        harness,
        organizationId: FIN_ORG,
        workflowId: FIN_WORKFLOW.parallelReuse.workflowId,
        nodeId,
        agentId,
        nowMs: harness.clock.now(),
        input: FIN_TOPIC,
        ...overrides,
      }),
    );

  it('a BRANCH exact hit creates no child, and the join still receives its output', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    await seedBranch(harness, 'left_step', WF_AGENT.alpha);

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.parallelReuse.workflowId,
      input: FIN_TOPIC,
    });
    assert.equal(detail.state, 'completed');

    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    // ONE child, for the branch that was NOT reused. The avoided branch created
    // none at all — which is what makes its zero a measurement.
    assert.equal(record?.childAgentRunIds.length, 1);

    // THE JOIN RECEIVED THE AVOIDED OUTPUT, in the same declared shape ordinary
    // execution would have produced.
    const group = record?.parallelGroups?.[0];
    const left = group?.branches.find((branch) => branch.branchName === 'left');
    assert.equal(left?.state, 'completed');
    assert.equal(left?.contributionNodeId, 'left_step');
    assert.equal(
      (left?.outputs.left_step as { finding?: string } | undefined)?.finding,
      PROD_REUSE_FINDING,
    );
  });

  it('attributes the branch saving ONCE, on one event carrying its branch id', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    await seedBranch(harness, 'left_step', WF_AGENT.alpha);

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.parallelReuse.workflowId,
      input: FIN_TOPIC,
    });

    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    const avoided = events.filter((event) => event.eventType === 'avoided_call');
    assert.equal(avoided.length, 1, 'exactly one avoided-call event');
    assert.equal(avoided[0].reuseType, 'exact');
    assert.ok(avoided[0].branchId !== undefined, 'the saving is attributed to its branch');
    assert.equal(avoided[0].actualCostMicroUsd, 0);
    // And the executed sibling kept its real spend.
    const executed = events.filter((event) => event.eventType !== 'avoided_call');
    assert.equal(executed.length, 1);
    assert.equal(executed[0].actualCostMicroUsd, SPEND.costMicroUsd);
  });

  it('an avoided output the branch CONTRACT REFUSES falls through to normal execution', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    await storeWith(
      harness.reusableResultStore,
      // Sealed with a field the node's declared output contract does not accept.
      // The record is otherwise perfect: the gate agrees, and the CONTRACT is
      // what refuses.
      {
        ...productionReusableRecord({
          harness,
          organizationId: FIN_ORG,
          workflowId: FIN_WORKFLOW.parallelReuse.workflowId,
          nodeId: 'left_step',
          agentId: WF_AGENT.alpha,
          nowMs: harness.clock.now(),
          input: FIN_TOPIC,
        }),
        output: {
          schema: 'node.finding',
          schemaVersion: '1',
          fields: { unexpected: 'not a finding' },
          redactions: [],
        },
      },
    );

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.parallelReuse.workflowId,
      input: FIN_TOPIC,
    });
    // The run completed NORMALLY. Both branches executed.
    assert.equal(detail.state, 'completed');
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 2);

    // AND NO AVOIDED-CALL EVENT WAS LEFT BEHIND. This is the defect the ordering
    // exists to prevent: an avoidance recorded for a call that then happened.
    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    assert.deepEqual(
      events.filter((event) => event.eventType === 'avoided_call'),
      [],
    );
  });

  it('a RESTART over the same stores creates no child and no second saving', async () => {
    const kv = createFakeKv();
    const reuse = createInMemoryReusableResultStore();
    const first = buildProductionRuntime({
      reuse,
      financialEventStore: durableFinancialStore(kv),
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    await seedBranch(first, 'left_step', WF_AGENT.alpha);

    const detail = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.parallelReuse.workflowId,
      input: FIN_TOPIC,
    });

    // A SECOND ISOLATE advances the same terminal run. Finalization repeats,
    // and repeating it must converge rather than accumulate.
    const second = buildProductionRuntime({
      reuse,
      runStore: first.runStore,
      checkpointStore: first.checkpointStore,
      approvalStore: first.approvalStore,
      financialEventStore: durableFinancialStore(kv),
      idSeed: 'b',
    });
    const replayed = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    // Terminal means terminal. The recovered isolate re-finalizes and returns
    // the run exactly as it found it.
    assert.equal(replayed.state, detail.state);

    const events = await eventsFor(
      second.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    assert.equal(
      events.filter((event) => event.eventType === 'avoided_call').length,
      1,
      'a restart must not produce a second avoided-call event',
    );
    const record = await second.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1, 'a restart must not create a child');
  });
});

// ── Terminal financial finalization ─────────────────────────────────────────

describe('production wiring — terminal finalization', () => {
  const terminalCases = [
    { name: 'completed', workflowId: FIN_WORKFLOW.single.workflowId },
    { name: 'failed', workflowId: FIN_WORKFLOW.failsMidway.workflowId },
  ] as const;

  for (const scenario of terminalCases) {
    it(`a ${scenario.name} run leaves NO pending event behind`, async () => {
      const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
      const detail = await harness.workflows.service.startRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowId: scenario.workflowId,
        input: FIN_TOPIC,
      });

      const events = await eventsFor(
        harness.workflows.financialEvents,
        detail.organizationId,
        detail.workflowRunId,
      );
      assert.ok(events.length > 0);
      assert.ok(
        events.every((event) => event.settlementState !== 'pending'),
        'every terminal outcome converges financially',
      );
    });
  }

  it('a CANCELLED run keeps measured spend and marks the rest unknown, not zero', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.blocks.workflowId,
      input: FIN_TOPIC,
    });

    const cancelled = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
      reason: 'operator ended the run',
    });
    assert.equal(cancelled.state, 'cancelled');

    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    assert.ok(events.every((event) => event.settlementState !== 'pending'));
    for (const event of events) {
      if (event.settlementState !== 'unsettled_terminal') continue;
      // UNKNOWN IS NOT ZERO. The measurement is ABSENT, not present-and-zero,
      // which is what keeps Part 6C reporting it as unknown spend.
      assert.equal(event.actualCostMicroUsd, undefined);
    }
  });

  it('REPEATED finalization converges: a second advance changes nothing', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: FIN_WORKFLOW.single.workflowId,
      input: FIN_TOPIC,
    });

    const before = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    // FINALIZATION IS REPEATED, through the path a recovered isolate takes:
    // `advance` over a terminal run finalizes again and returns the record
    // untouched. Repeating it must converge rather than accumulate.
    const again = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(again.state, 'completed');
    const after = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    assert.deepEqual(
      after.map((event) => `${event.eventId}:${event.settlementState}:${String(event.actualCostMicroUsd)}`),
      before.map((event) => `${event.eventId}:${event.settlementState}:${String(event.actualCostMicroUsd)}`),
    );
  });
});

// ── Degraded-state visibility ───────────────────────────────────────────────

describe('production wiring — health visibility', () => {
  it('reports a HEALTHY configuration with the versions its events carry', () => {
    const kv = createFakeKv();
    const harness = buildProductionRuntime({
      financialEventStore: durableFinancialStore(kv),
      financialDurableConfigured: true,
    });
    const health = harness.workflows.optimizationHealth();

    assert.equal(health.degraded, false);
    assert.equal(health.durableFinancialStore.available, true);
    assert.equal(health.reuseStore.available, true);
    assert.equal(health.exactReuse.available, true);
    assert.equal(health.costProfileRegistryVersion, NODE_COST_REGISTRY_VERSION);
    assert.equal(health.optimizationPolicyVersion, 'ai.workflow.optimization.v1');
    assert.equal(health.financialEventPolicyVersion, 'ai.financial.event.v1');
  });

  it('reports SEMANTIC DISCOVERY UNAVAILABLE when the switch is on and no port exists', () => {
    const kv = createFakeKv();
    const harness = buildProductionRuntime({
      financialEventStore: durableFinancialStore(kv),
      financialDurableConfigured: true,
      semanticReuseConfigured: true,
    });
    const health = harness.workflows.optimizationHealth();

    // A switch is a REQUEST, not a capability. This repository ships no
    // certified retrieval path, and reporting one because a flag is on is the
    // one place this read could have lied.
    assert.equal(health.semanticDiscovery.configured, true);
    assert.equal(health.semanticDiscovery.available, false);
    assert.equal(health.degraded, true);
  });

  it('leaks no credential, prompt, output or tenant', () => {
    const harness = buildProductionRuntime();
    const serialized = JSON.stringify(harness.workflows.optimizationHealth());
    for (const forbidden of ['token', 'Bearer', 'acme', 'globex', FIN_TOPIC.topic]) {
      assert.equal(serialized.includes(forbidden), false, `health leaked ${forbidden}`);
    }
  });
});
