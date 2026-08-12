/**
 * Production optimization wiring — adversarial
 * (AI-01 Batch 3B, Production Optimization Wiring).
 *
 * ── THE ONE QUESTION ───────────────────────────────────────────────────────
 *
 * Can the production wiring be made to report a saving the parts underneath it
 * could not justify?
 *
 * The wiring is the newest and most attractive place to attack, because it is
 * the layer that CHOOSES the inputs Parts 6A and 6B reason about. Part 6A's own
 * adversarial suite proves the arithmetic cannot be tuned; Part 6B's proves a
 * similarity match is not permission. Neither of them can prove that the thing
 * choosing their inputs is honest — a registry that priced every node at
 * `advanced_reasoning`, or a resolver that claimed a hit the gate never granted,
 * would satisfy both suites completely and inflate every figure the platform
 * publishes.
 *
 * Ten attacks. Each one is a specific, plausible way an implementation could
 * have manufactured progress toward the 90% target, and each asserts the
 * platform's answer is the truthful one.
 *
 * A note on what "passes" means here. Several of these assert that a node
 * EXECUTED and PAID. That is the point: the honest outcome of a failed
 * optimisation is a bill, and a suite that only checked for the absence of an
 * error would pass just as happily on a platform that quietly served stale
 * answers.
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
  buildProductionRuntime,
  createFakeKv,
  durableFinancialStore,
  productionNodeFacts,
  productionResolverFor,
  productionReusableRecord,
  storeWith,
} from './workflowProductionFixtures.ts';
import { WF_AGENT, meteredAgentPort } from './workflowFixtures.ts';
import { createInMemoryReusableResultStore } from '../reuse/persistence/ports.ts';
import { narrowNodeCostProfile } from '../workflows/financial/nodeCostRegistry.ts';

const SPEND = { inputTokens: 1_000, outputTokens: 400, costMicroUsd: 1_500 } as const;

const startRun = async (
  harness: ReturnType<typeof buildProductionRuntime>,
  workflowId: string,
  input: unknown = FIN_TOPIC,
) =>
  harness.workflows.service.startRun({
    ...harness.meta(AGENT_TOKEN.consultant),
    workflowId,
    input,
  });

// ── 1–3. Inflating the denominator ──────────────────────────────────────────

describe('adversarial — the baseline cannot be inflated by the wiring', () => {
  it('a deployment CANNOT declare a band its agent has no approved profile for', async () => {
    const harness = buildProductionRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      // The attack: price every node at the top of the ladder, then "save" the
      // difference on every node in the platform. It is the single largest
      // fabricated number available in this subsystem.
      nodeCostProfileFor: () => ({
        allowedCapabilityProfiles: ['economy', 'standard', 'reasoning', 'advanced_reasoning'],
        maximumCapabilityProfile: 'advanced_reasoning',
      }),
    });

    const detail = await startRun(harness, FIN_WORKFLOW.pinned.workflowId);
    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);

    // `pinned` declares ONE approved profile, at `standard`. The override is
    // clamped back to it, so the baseline is priced at 1,200 tokens × 3,000
    // micro-USD per 1k = 3,600 — not at the `advanced_reasoning` rate of 25,000,
    // which would have priced the same node at 30,000 and "saved" the gap.
    assert.equal(event.baselineCostMicroUsd, 3_600);
    assert.equal(event.capabilityProfile, 'standard');
    assert.equal(
      event.savingsEntries.some((entry) => entry.category === 'capability_downgrade'),
      false,
      'no downgrade may be claimed for a band the agent has no approved profile for',
    );
  });

  it('a deployment CANNOT lower the quality contract to unlock a downgrade', async () => {
    // Lowering quality lowers the capability floor, which manufactures a
    // downgrade without touching a single band. `narrowNodeCostProfile` clamps
    // it back UP, and reports that it did.
    const narrowed = narrowNodeCostProfile(
      {
        quality: 'high',
        allowedCapabilityProfiles: ['standard', 'reasoning'],
        maximumCapabilityProfile: 'reasoning',
      },
      { quality: 'best_effort' },
    );
    assert.equal(narrowed.profile.quality, 'high');
    assert.ok(narrowed.clamped.some((entry) => entry.includes('quality')));
  });

  it('a deployment MAY narrow, and the narrowing is honoured', () => {
    // The rule is narrow-only, not refuse-everything. A deployment that declares
    // a SMALLER band set gets it, because that is a real statement about what
    // its nodes may do.
    const narrowed = narrowNodeCostProfile(
      {
        quality: 'standard',
        allowedCapabilityProfiles: ['economy', 'standard'],
        maximumCapabilityProfile: 'standard',
      },
      { allowedCapabilityProfiles: ['standard'], maximumCapabilityProfile: 'standard' },
    );
    assert.deepEqual(narrowed.profile.allowedCapabilityProfiles, ['standard']);
    assert.deepEqual(narrowed.clamped, []);
  });

  it('an UNRESOLVABLE model profile does not become a cheap band to save down from', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await startRun(harness, FIN_WORKFLOW.unknownProfile.workflowId);
    const [event] = await eventsFor(harness.workflows.financialEvents, detail.organizationId);

    // A single band means the recommender has nowhere to go, so no routing
    // saving is claimed for an agent whose profile set the platform cannot see.
    assert.equal(
      event.savingsEntries.some((entry) => entry.category === 'capability_downgrade'),
      false,
    );
  });
});

// ── 4–7. Claiming a reuse the gate never granted ────────────────────────────

describe('adversarial — reuse cannot be claimed without eligibility', () => {
  it('a KILL SWITCH cannot be bypassed by serving a cached answer', async () => {
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
    const facts = productionNodeFacts(harness, {
      organizationId: FIN_ORG,
      workflowId: FIN_WORKFLOW.single.workflowId,
      nodeId: 'only',
      agentId: WF_AGENT.alpha,
      input: FIN_TOPIC,
    });

    // The record IS eligible. Establishing that first is what makes the two
    // refusals below refusals rather than a fixture that never matched.
    const live = productionResolverFor(harness, { aiEnabled: true, reuseEnabled: true });
    assert.ok(await live.resolve(facts), 'the record must be genuinely reusable');

    // AI DISENGAGED. "No provider call occurs" is not permission to ignore an
    // emergency stop — the stop is a statement about the OPERATION, not the
    // billing.
    const stopped = productionResolverFor(harness, { aiEnabled: false, reuseEnabled: true });
    assert.equal(await stopped.resolve(facts), undefined);

    // And the narrower switch, on its own.
    const reuseOff = productionResolverFor(harness, { aiEnabled: true, reuseEnabled: false });
    assert.equal(await reuseOff.resolve(facts), undefined);
  });

  it('an UNREGISTERED workflow version refuses reuse rather than defaulting to a hit', async () => {
    const reuse = createInMemoryReusableResultStore();
    const harness = buildProductionRuntime({ reuse, wrapAgentPort: meteredAgentPort(SPEND) });
    const sealed = productionReusableRecord({
      harness,
      organizationId: FIN_ORG,
      workflowId: FIN_WORKFLOW.single.workflowId,
      nodeId: 'only',
      agentId: WF_AGENT.alpha,
      nowMs: harness.clock.now(),
      input: FIN_TOPIC,
    });
    // The attack: a record whose source claims a different agent version. The
    // version is part of the exact key AND a checked dimension, so the claim
    // achieves nothing.
    await storeWith(reuse, { ...sealed, sourceAgentVersion: '9.9.9' });

    const detail = await startRun(harness, FIN_WORKFLOW.single.workflowId);
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1, 'the node must execute and pay');
  });

  it('a CROSS-TENANT record cannot be reached, and produces no saving', async () => {
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

    const detail = await startRun(harness, FIN_WORKFLOW.single.workflowId);
    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    assert.deepEqual(events.filter((event) => event.eventType === 'avoided_call'), []);
    assert.equal(events[0]?.actualCostMicroUsd, SPEND.costMicroUsd);
  });

  it('a STALE record produces spend, not a saving', async () => {
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
        createdAt: harness.clock.now() - 7_200_000,
        ttlMs: 3_600_000,
      }),
    );

    const detail = await startRun(harness, FIN_WORKFLOW.single.workflowId);
    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    assert.deepEqual(events.filter((event) => event.eventType === 'avoided_call'), []);
  });
});

// ── 8–9. Counting a branch avoidance more than once ─────────────────────────

describe('adversarial — a branch avoidance is counted exactly once', () => {
  const seedLeft = async (harness: ReturnType<typeof buildProductionRuntime>) =>
    storeWith(
      harness.reusableResultStore,
      productionReusableRecord({
        harness,
        organizationId: FIN_ORG,
        workflowId: FIN_WORKFLOW.parallelReuse.workflowId,
        nodeId: 'left_step',
        agentId: WF_AGENT.alpha,
        nowMs: harness.clock.now(),
        input: FIN_TOPIC,
      }),
    );

    it('CONCURRENT advances over one run do not double-complete the branch', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    await seedLeft(harness);

    const detail = await startRun(harness, FIN_WORKFLOW.parallelReuse.workflowId);

    // Two drivers race over the same terminal run. The compare-and-swap on the
    // run version, the branch version and the derived event id all have to hold
    // for this to come back with one of everything.
    await Promise.allSettled([
      harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: detail.workflowRunId,
      }),
      harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: detail.workflowRunId,
      }),
    ]);

    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    assert.equal(events.filter((event) => event.eventType === 'avoided_call').length, 1);
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    assert.equal(record?.childAgentRunIds.length, 1);
    // One completed step per node, not two.
    const leftSteps = record?.steps.filter((step) => step.nodeId === 'left_step') ?? [];
    assert.equal(leftSteps.length, 1);
  });

  it('an avoided branch NEVER also carries a child agent run id', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    await seedLeft(harness);
    const detail = await startRun(harness, FIN_WORKFLOW.parallelReuse.workflowId);

    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    for (const event of events) {
      if (event.eventType !== 'avoided_call') continue;
      // The absence is load-bearing: an avoided call has no child run because no
      // call was made, and an event claiming one would claim an execution that
      // never happened.
      assert.equal(event.agentRunId, undefined);
      assert.equal(event.actualCostMicroUsd, 0);
    }
    const record = await harness.runStore.load(detail.organizationId, detail.workflowRunId);
    const avoidedStep = record?.steps.find((step) => step.nodeId === 'left_step');
    assert.equal(avoidedStep?.childAgentRunId, undefined);
  });
});

// ── 10. Reading unknown as zero ─────────────────────────────────────────────

describe('adversarial — unknown spend is never read as zero', () => {
  it('an UNAVAILABLE financial store does not become a run that cost nothing', async () => {
    const harness = buildProductionRuntime({
      wrapAgentPort: meteredAgentPort(SPEND),
      // A store that refuses everything. The run must still complete — a
      // reporting layer with a veto over execution is the larger failure — and
      // it must report NOTHING rather than a free run.
      financialEventStore: {
        append: () => Promise.reject(new Error('financial storage is unavailable')),
        getById: () => Promise.reject(new Error('financial storage is unavailable')),
        settle: () => Promise.reject(new Error('financial storage is unavailable')),
        list: () => Promise.reject(new Error('financial storage is unavailable')),
      },
      financialDurableConfigured: true,
    });

    const detail = await startRun(harness, FIN_WORKFLOW.single.workflowId);
    // EXECUTION IS UNAFFECTED.
    assert.equal(detail.state, 'completed');
    // And there is no row claiming the run was free — there is no row at all,
    // which is what Part 6C's coverage figure reports as a gap.
    await assert.rejects(() =>
      harness.workflows.financialEvents.list({
        organizationId: detail.organizationId,
        window: { fromMs: 0, toMs: Number.MAX_SAFE_INTEGER },
      }),
    );
  });

  it('a run cancelled mid-flight keeps its measured spend and marks the rest UNKNOWN', async () => {
    const kv = createFakeKv();
    const harness = buildProductionRuntime({
      financialEventStore: durableFinancialStore(kv),
      wrapAgentPort: meteredAgentPort(SPEND),
    });
    const detail = await startRun(harness, FIN_WORKFLOW.blocks.workflowId);
    await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
      reason: 'operator ended the run',
    });

    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    assert.ok(events.length > 0);
    for (const event of events) {
      if (event.settlementState === 'unsettled_terminal') {
        // ABSENT, not zero. `undefined` is what keeps Part 6C reporting this as
        // unknown spend rather than folding it into a flattering total.
        assert.equal(event.actualCostMicroUsd, undefined);
        continue;
      }
      assert.equal(event.settlementState, 'settled');
    }
  });

  it('a RETRY keeps its real spend rather than being optimised away', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await startRun(harness, FIN_WORKFLOW.retryOnce.workflowId);

    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );
    // Whatever the run's outcome, the spend it incurred is on the record.
    const measured = events.filter((event) => typeof event.actualCostMicroUsd === 'number');
    assert.ok(measured.length > 0, 'a failed attempt still bought something');
    assert.deepEqual(events.filter((event) => event.eventType === 'avoided_call'), []);
  });

  it('the ROUTED agent\'s real run reconciles: savings never exceed the baseline', async () => {
    const harness = buildProductionRuntime({ wrapAgentPort: meteredAgentPort(SPEND) });
    const detail = await startRun(harness, FIN_WORKFLOW.routed.workflowId);
    const events = await eventsFor(
      harness.workflows.financialEvents,
      detail.organizationId,
      detail.workflowRunId,
    );

    for (const event of events) {
      assert.ok(
        event.estimatedSavingsMicroUsd <= event.baselineCostMicroUsd,
        'a saving may never exceed the baseline it is measured against',
      );
      assert.equal(
        event.savingsEntries.reduce((sum, entry) => sum + entry.microUsd, 0),
        event.estimatedSavingsMicroUsd,
        'the partition must sum to the gap',
      );
      // ESTIMATED AND REALIZED STAY SEPARATE. An estimate is a projection made
      // before the call; a realization is baseline minus what was measured. The
      // event carries both under different names, and the realized figure is
      // absent entirely until a measurement exists — never defaulted to the
      // estimate, which is how a projection quietly becomes a claim.
      if (event.actualCostMicroUsd === undefined) {
        assert.equal(event.realizedSavingsMicroUsd, undefined);
        continue;
      }
      assert.equal(
        event.realizedSavingsMicroUsd,
        event.baselineCostMicroUsd - event.actualCostMicroUsd,
      );
    }
    assert.equal(
      events.some((event) => event.agentId === FIN_AGENT.routed),
      true,
      'the run under test must be the routed agent\'s',
    );
  });
});
