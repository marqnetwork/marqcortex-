/**
 * Optimisation suite (AI-01 Batch 3B).
 *
 * Two halves, and the split is deliberate.
 *
 *   THE UNITS are pure functions over numbers and data — classification, profile
 *   selection, context reduction, the cache, the ledger and the attribution
 *   projection. They are asserted directly, because a saving that cannot be
 *   computed by hand is a saving nobody can check.
 *
 *   THE INTEGRATION is the real agent runtime with the switches on and off. The
 *   claim being tested there is not "the optimisation works" but the stronger
 *   one this batch actually needs: WITH THE SWITCHES OFF THE RUNTIME BEHAVES
 *   EXACTLY AS BATCH 3A CERTIFIED IT. An optimisation whose effect cannot be
 *   isolated is an optimisation that cannot be rolled back during an incident.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_ID,
  AGENT_TOKEN,
  buildTestAgentRuntime,
  runBody,
} from './agentFixtures.ts';
import { AGENT_MODEL_PROFILE, DEFAULT_MODEL_PROFILES } from '../agents/runtime/defaultProfiles.ts';
import { createModelProfileRegistry } from '../agents/runtime/modelRouting.ts';
import { classifyComplexity, complexitySignalsFor } from '../optimization/complexity.ts';
import { selectMinimumCapableProfile } from '../optimization/profileSelection.ts';
import { normalizeContent, optimizeContext } from '../optimization/contextOptimizer.ts';
import {
  cacheKeyFor,
  createPromptCache,
  isCacheEligible,
} from '../optimization/promptCache.ts';
import {
  cacheHitRate,
  coerceOptimizationLedger,
  emptyOptimizationLedger,
  optimizationScore,
  recordAvoidedCall,
  recordCacheMiss,
  recordContextSaving,
  recordProfileDowngrade,
  recordSpend,
} from '../optimization/optimizationLedger.ts';
import { attributeFinancials } from '../optimization/financialAttribution.ts';
import { createTestClock } from '../runtime/clock.ts';

const SMALL = complexitySignalsFor({
  contextChars: 200,
  includedSections: 2,
  untrustedSections: 1,
  requiredOutputFields: 1,
  requiresStructuredOutput: true,
  stepCount: 0,
  handoffCount: 0,
  lastObservationFailed: false,
  objectiveChars: 40,
});

const LARGE = complexitySignalsFor({
  contextChars: 60_000,
  includedSections: 20,
  untrustedSections: 12,
  requiredOutputFields: 8,
  requiresStructuredOutput: true,
  stepCount: 12,
  handoffCount: 4,
  lastObservationFailed: true,
  objectiveChars: 2_000,
});

// ── Classification ──────────────────────────────────────────────────────────

describe('complexity classification — deterministic and bounded', () => {
  it('gives the same answer for the same signals, every time', () => {
    assert.deepEqual(classifyComplexity(SMALL), classifyComplexity(SMALL));
  });

  it('classifies a small step low and a large one high', () => {
    assert.equal(classifyComplexity(SMALL).complexity, 'low');
    assert.equal(classifyComplexity(LARGE).complexity, 'high');
  });

  it('only ever lowers the quality floor, never raises it', () => {
    assert.equal(classifyComplexity(SMALL).minimumQuality, 'baseline');
    assert.equal(classifyComplexity(LARGE).minimumQuality, 'standard');
    // `standard` is what Batch 3A hard-coded. Nothing classifies above it.
    assert.equal(
      classifyComplexity({ ...LARGE, contextChars: 10_000 }).minimumQuality,
      'standard',
    );
  });

  it('is total against nonsense input', () => {
    const nonsense = classifyComplexity({
      contextChars: Number.NaN,
      contextSections: -5,
      untrustedSections: Number.POSITIVE_INFINITY,
      requiredOutputFields: -1,
      requiresStructuredOutput: false,
      priorSteps: Number.NaN,
      handoffDepth: -3,
      recoveringFromFailure: false,
      objectiveChars: -1,
    });
    assert.equal(nonsense.score, 0);
    assert.equal(nonsense.complexity, 'low');
  });

  it('names the signals that drove the score', () => {
    const drivers = classifyComplexity(LARGE).drivers;
    assert.ok(drivers.length > 0);
    assert.ok(drivers.every((driver) => /^[a-z_]+:\d+$/.test(driver)));
  });
});

// ── Minimum-capable routing ─────────────────────────────────────────────────

describe('minimum-capable profile routing', () => {
  const registry = createModelProfileRegistry();
  registry.registerAll(DEFAULT_MODEL_PROFILES);

  const request = {
    allowedProfileIds: [AGENT_MODEL_PROFILE.standard, AGENT_MODEL_PROFILE.compact],
    requiresStructuredOutput: true,
    safety: 'strict' as const,
    estimatedPromptTokens: 500,
    maxCompletionTokens: 4_000,
  };

  it('offers a cheaper profile when the step is small', () => {
    const selection = selectMinimumCapableProfile(registry, {
      ...request,
      requestedProfileId: AGENT_MODEL_PROFILE.standard,
      classification: classifyComplexity(SMALL),
    });
    assert.equal(selection.profileId, AGENT_MODEL_PROFILE.compact);
    assert.equal(selection.downgradedFrom, AGENT_MODEL_PROFILE.standard);
    assert.ok(selection.projectedSavingMicroUsd > 0);
  });

  it('never upgrades a request', () => {
    const selection = selectMinimumCapableProfile(registry, {
      ...request,
      requestedProfileId: AGENT_MODEL_PROFILE.compact,
      classification: classifyComplexity(SMALL),
    });
    assert.equal(selection.profileId, AGENT_MODEL_PROFILE.compact);
    assert.equal(selection.downgradedFrom, undefined);
    assert.equal(selection.projectedSavingMicroUsd, 0);
  });

  it('keeps the requested profile when the quality floor rules the cheap one out', () => {
    const selection = selectMinimumCapableProfile(registry, {
      ...request,
      requestedProfileId: AGENT_MODEL_PROFILE.standard,
      classification: classifyComplexity(LARGE),
    });
    // The compact profile is `baseline` quality, and a high-complexity step
    // keeps the `standard` floor — so there is nothing cheaper that is capable.
    assert.equal(selection.profileId, AGENT_MODEL_PROFILE.standard);
    assert.equal(selection.downgradedFrom, undefined);
  });

  it('cannot reach outside the agent’s allow list', () => {
    const selection = selectMinimumCapableProfile(registry, {
      ...request,
      allowedProfileIds: [AGENT_MODEL_PROFILE.standard],
      requestedProfileId: AGENT_MODEL_PROFILE.standard,
      classification: classifyComplexity(SMALL),
    });
    assert.equal(selection.profileId, AGENT_MODEL_PROFILE.standard);
    assert.equal(selection.consideredProfiles, 1);
  });

  it('will not weaken a strict safety requirement', () => {
    const relaxed = createModelProfileRegistry();
    relaxed.registerAll([
      ...DEFAULT_MODEL_PROFILES,
      {
        ...DEFAULT_MODEL_PROFILES[1],
        profileId: 'profile.agent.loose',
        safety: 'standard',
        indicativePromptMicroUsdPer1k: 1,
        indicativeCompletionMicroUsdPer1k: 1,
        rank: 3,
      },
    ]);
    const selection = selectMinimumCapableProfile(relaxed, {
      ...request,
      allowedProfileIds: [...request.allowedProfileIds, 'profile.agent.loose'],
      requestedProfileId: AGENT_MODEL_PROFILE.standard,
      classification: classifyComplexity(SMALL),
    });
    assert.notEqual(selection.profileId, 'profile.agent.loose');
  });
});

// ── Context reduction ───────────────────────────────────────────────────────

describe('deterministic context reduction', () => {
  const classification = classifyComplexity(SMALL);

  it('normalises whitespace without touching content', () => {
    assert.equal(normalizeContent('a   b\n\n\n\nc  \n'), 'a b\n\nc');
  });

  it('removes a cross-kind duplicate and keeps the higher authority copy', () => {
    const reduced = optimizeContext(
      [
        {
          sectionId: 'evidence',
          kind: 'retrieved_evidence',
          label: 'Evidence',
          content: 'the same fact',
          trusted: false,
          priority: 5,
        },
        {
          sectionId: 'tool',
          kind: 'tool_result',
          label: 'Tool result',
          content: 'the same fact',
          trusted: false,
          priority: 5,
        },
      ],
      classification,
    );
    assert.equal(reduced.inputs.length, 1);
    assert.equal(reduced.inputs[0].kind, 'tool_result', 'tool_result outranks retrieved_evidence');
    assert.equal(reduced.removed[0].reason, 'cross_kind_duplicate');
    assert.ok(reduced.tokensSaved > 0);
  });

  it('drops a fragment contained in a higher-authority section', () => {
    const reduced = optimizeContext(
      [
        {
          sectionId: 'big',
          kind: 'tool_result',
          label: 'Tool result',
          content: 'alpha beta gamma delta',
          trusted: false,
          priority: 9,
        },
        {
          sectionId: 'small',
          kind: 'retrieved_evidence',
          label: 'Evidence',
          content: 'beta gamma',
          trusted: false,
          priority: 1,
        },
      ],
      classification,
    );
    assert.equal(reduced.inputs.length, 1);
    assert.equal(reduced.removed[0].reason, 'contained_in_higher_authority');
  });

  it('never removes instructions, the objective or a handoff payload', () => {
    const protectedInputs = [
      { sectionId: 's', kind: 'system_instructions' as const, label: 'Rules', content: 'x', trusted: true, priority: 1 },
      { sectionId: 'o', kind: 'objective' as const, label: 'Objective', content: 'x', trusted: false, priority: 1 },
      { sectionId: 'h', kind: 'handoff_context' as const, label: 'Handoff', content: 'x', trusted: false, priority: 1 },
    ];
    const reduced = optimizeContext(protectedInputs, classification);
    assert.equal(reduced.inputs.length, 3, 'identical content, all three retained');
  });

  it('trims history only when the step classifies low', () => {
    const history = [1, 2, 3].map((index) => ({
      sectionId: `h${index}`,
      kind: 'recent_history' as const,
      label: 'History',
      content: `entry ${index}`,
      trusted: false,
      priority: index,
    }));
    assert.equal(optimizeContext(history, classifyComplexity(SMALL)).inputs.length, 1);
    assert.equal(optimizeContext(history, classifyComplexity(LARGE)).inputs.length, 3);
  });

  it('returns the same digest for the same inputs', () => {
    const inputs = [
      { sectionId: 'a', kind: 'tool_result' as const, label: 'A', content: 'one', trusted: false, priority: 1 },
    ];
    assert.equal(
      optimizeContext(inputs, classification).digest,
      optimizeContext(inputs, classification).digest,
    );
  });
});

// ── The safe cache ──────────────────────────────────────────────────────────

describe('the safe cache foundation', () => {
  const key = {
    organizationId: 'acme',
    featureId: 'cortex.agent_step',
    modelProfileId: AGENT_MODEL_PROFILE.standard,
    promptDigest: 'digest-1',
    outputFields: ['finding'],
    configurationVersion: 1,
    agentId: AGENT_ID.primary,
  };

  it('separates tenants by the key itself', () => {
    assert.notEqual(cacheKeyFor(key), cacheKeyFor({ ...key, organizationId: 'globex' }));
  });

  it('invalidates on a configuration change', () => {
    assert.notEqual(cacheKeyFor(key), cacheKeyFor({ ...key, configurationVersion: 2 }));
  });

  it('is insensitive to output field ordering and nothing else', () => {
    assert.equal(
      cacheKeyFor({ ...key, outputFields: ['finding', 'summary'] }),
      cacheKeyFor({ ...key, outputFields: ['summary', 'finding'] }),
    );
    assert.notEqual(cacheKeyFor(key), cacheKeyFor({ ...key, promptDigest: 'digest-2' }));
  });

  it('refuses to cache an external-effect agent or an in-flight approval', () => {
    assert.equal(
      isCacheEligible({
        enabled: true,
        safetyClass: 'external_effect',
        requiresStructuredOutput: true,
        approvalInFlight: false,
      }).refusedBecause,
      'external_effect',
    );
    assert.equal(
      isCacheEligible({
        enabled: true,
        safetyClass: 'tenant_readonly',
        requiresStructuredOutput: true,
        approvalInFlight: true,
      }).refusedBecause,
      'approval_in_flight',
    );
    assert.equal(
      isCacheEligible({
        enabled: true,
        safetyClass: 'tenant_readonly',
        requiresStructuredOutput: true,
        approvalInFlight: false,
      }).eligible,
      true,
    );
  });

  it('serves a hit, refuses another tenant, and expires', () => {
    const clock = createTestClock();
    const cache = createPromptCache({
      now: () => clock.now(),
      isoNow: () => clock.isoNow(),
      ttlMs: 60_000,
    });
    const entryKey = cacheKeyFor(key);
    cache.put({
      key: entryKey,
      organizationId: 'acme',
      output: { finding: 'x' },
      outputDigest: 'd',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      costMicroUsd: 900,
      providerId: 'primary',
      modelId: 'mock-standard',
      sourceRequestId: 'req-1',
    });

    assert.ok(cache.get('acme', entryKey), 'the tenant that stored it reads it back');
    assert.equal(cache.get('globex', entryKey), undefined, 'another tenant never does');

    clock.advance(61_000);
    assert.equal(cache.get('acme', entryKey), undefined, 'an expired entry is a miss');
    assert.equal(cache.stats().expirations, 1);
  });

  it('is bounded and evicts the least recently used entry', () => {
    const clock = createTestClock();
    const cache = createPromptCache({
      now: () => clock.now(),
      isoNow: () => clock.isoNow(),
      maxEntries: 2,
    });
    const put = (id: string) =>
      cache.put({
        key: id,
        organizationId: 'acme',
        output: {},
        outputDigest: id,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        costMicroUsd: 1,
        providerId: 'primary',
        modelId: 'm',
        sourceRequestId: id,
      });
    put('a');
    put('b');
    cache.get('acme', 'a');
    put('c');
    assert.equal(cache.size(), 2);
    assert.equal(cache.get('acme', 'b'), undefined, 'b was the least recently used');
    assert.ok(cache.get('acme', 'a'));
  });
});

// ── Accounting ──────────────────────────────────────────────────────────────

describe('avoided-call accounting and the optimisation score', () => {
  it('credits an avoided call with what the replaced call actually cost', () => {
    const ledger = recordAvoidedCall(emptyOptimizationLedger(), {
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      costMicroUsd: 900,
    });
    assert.equal(ledger.avoidedCalls, 1);
    assert.equal(ledger.avoidedMicroUsd, 900);
    assert.equal(ledger.avoidedTotalTokens, 150);
    assert.equal(ledger.cacheHits, 1);
    assert.equal(ledger.cacheLookups, 1);
  });

  it('never adds projected savings to avoided spend', () => {
    let ledger = recordProfileDowngrade(emptyOptimizationLedger(), 5_000);
    ledger = recordContextSaving(ledger, { tokensSaved: 400, sectionsRemoved: 2 });
    assert.equal(ledger.projectedDowngradeMicroUsd, 5_000);
    assert.equal(ledger.avoidedMicroUsd, 0, 'a projection is not money');
    assert.equal(optimizationScore(ledger), 0, 'and it does not move the score');
  });

  it('scores avoided over notional, and scores an idle run zero', () => {
    assert.equal(optimizationScore(emptyOptimizationLedger()), 0);
    let ledger = recordAvoidedCall(emptyOptimizationLedger(), {
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      costMicroUsd: 300,
    });
    ledger = recordSpend(ledger, 700);
    assert.equal(optimizationScore(ledger), 30);
  });

  it('reports a hit rate against every lookup', () => {
    let ledger = recordAvoidedCall(emptyOptimizationLedger(), {
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      costMicroUsd: 1,
    });
    ledger = recordCacheMiss(ledger);
    ledger = recordCacheMiss(ledger);
    ledger = recordCacheMiss(ledger);
    assert.equal(cacheHitRate(ledger), 25);
  });

  it('reads a stored ledger back as a total value', () => {
    assert.deepEqual(coerceOptimizationLedger(undefined), emptyOptimizationLedger());
    assert.deepEqual(coerceOptimizationLedger('nonsense'), emptyOptimizationLedger());
    assert.equal(coerceOptimizationLedger({ avoidedCalls: 4 }).avoidedCalls, 4);
    assert.equal(
      coerceOptimizationLedger({ avoidedMicroUsd: -9 }).avoidedMicroUsd,
      0,
      'a negative saving is not a saving',
    );
  });
});

// ── Financial attribution ───────────────────────────────────────────────────

describe('financial attribution — a projection, not a second counter', () => {
  const row = {
    agentId: AGENT_ID.primary,
    providerId: 'primary',
    modelId: 'mock-standard',
    feature: 'cortex.agent_step',
    promptTokens: 100,
    completionTokens: 50,
    cachedTokens: 0,
    totalTokens: 150,
    costMicroUsd: 1_000,
    calls: 1,
  };

  it('merges rows by their full key and totals them', () => {
    const report = attributeFinancials({
      scope: 'organization',
      organizationId: 'acme',
      sources: [
        { organizationId: 'acme', attribution: [row] },
        { organizationId: 'acme', attribution: [row] },
        { organizationId: 'acme', attribution: [{ ...row, modelId: 'mock-compact' }] },
      ],
      generatedAt: '2026-08-05T00:00:00.000Z',
    });
    assert.equal(report.rows.length, 2);
    assert.equal(report.totals.costMicroUsd, 3_000);
    assert.equal(report.rows[0].costMicroUsd, 2_000, 'rows sort by cost, descending');
  });

  it('keeps a workflow’s rows attributable to the workflow', () => {
    const report = attributeFinancials({
      scope: 'organization',
      organizationId: 'acme',
      sources: [
        { organizationId: 'acme', workflowId: 'workflow.test.sequential', attribution: [row] },
        { organizationId: 'acme', attribution: [row] },
      ],
      generatedAt: '2026-08-05T00:00:00.000Z',
    });
    assert.equal(report.rows.length, 2, 'the same agent inside and outside a plan is two rows');
    assert.ok(report.rows.some((entry) => entry.workflowId === 'workflow.test.sequential'));
  });

  it('reports avoided spend beside spend, never inside it', () => {
    const optimization = recordSpend(
      recordAvoidedCall(emptyOptimizationLedger(), {
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        costMicroUsd: 400,
      }),
      1_000,
    );
    const report = attributeFinancials({
      scope: 'organization',
      organizationId: 'acme',
      sources: [{ organizationId: 'acme', attribution: [row], optimization }],
      generatedAt: '2026-08-05T00:00:00.000Z',
    });
    assert.equal(report.totals.costMicroUsd, 1_000, 'settled spend only');
    assert.equal(report.totals.avoidedMicroUsd, 400);
    assert.equal(report.optimizationScore, 29);
  });
});

// ── Integration with the certified runtime ──────────────────────────────────

describe('optimisation inside the agent runtime', () => {
  async function runOnce(
    optimization?: Parameters<typeof buildTestAgentRuntime>[0]['optimization'],
  ) {
    const harness = buildTestAgentRuntime(
      optimization === undefined ? {} : { optimization },
    );
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);
    const run = await harness.runtime.service.createRun(actor, runBody(), meta);
    const steps = await harness.runtime.service.getRunSteps(actor, run.runId);
    return { harness, actor, meta, run, steps };
  }

  it('routes a small step down and records why', async () => {
    const { run, steps } = await runOnce();
    const modelStep = steps.find((step) => step.actionType === 'model_call');
    assert.ok(modelStep);
    assert.equal(modelStep.modelProfileId, AGENT_MODEL_PROFILE.compact);
    assert.equal(modelStep.downgradedFromProfileId, AGENT_MODEL_PROFILE.standard);
    assert.equal(modelStep.complexityClass, 'low');
    assert.ok(run.optimization.profileDowngrades > 0);
  });

  it('behaves exactly as Batch 3A certified it when the switches are off', async () => {
    const { run, steps } = await runOnce({
      contextReduction: false,
      minimumCapableRouting: false,
    });
    const modelStep = steps.find((step) => step.actionType === 'model_call');
    assert.ok(modelStep);
    assert.equal(modelStep.modelProfileId, AGENT_MODEL_PROFILE.standard);
    assert.equal(modelStep.downgradedFromProfileId, undefined);
    assert.equal(run.optimization.profileDowngrades, 0);
    assert.equal(run.optimization.contextTokensSaved, 0);
  });

  it('records spend and leaves the avoided total at zero without a cache', async () => {
    const { run } = await runOnce();
    assert.ok(run.optimization.spentMicroUsd >= 0);
    assert.equal(run.optimization.avoidedCalls, 0);
    assert.equal(run.optimizationScore, 0, 'nothing avoided is a score of zero');
  });

  it('serves an identical second run from cache and charges nothing for it', async () => {
    const harness = buildTestAgentRuntime({
      optimization: { cacheEnabled: true, cacheTtlMs: 600_000 },
    });
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);

    const first = await harness.runtime.service.createRun(actor, runBody(), meta);
    const second = await harness.runtime.service.createRun(actor, runBody(), meta);

    assert.equal(first.state, 'completed');
    assert.equal(second.state, 'completed');
    assert.equal(first.optimization.avoidedCalls, 0, 'the first run pays');
    assert.equal(second.optimization.avoidedCalls, 1, 'the second does not');
    assert.equal(second.cost.actualMicroUsd, 0, 'a cache hit costs nothing');
    assert.equal(second.tokens.actualTotalTokens, 0, 'and consumes nothing');
    assert.ok(second.optimization.avoidedMicroUsd >= 0);

    const steps = await harness.runtime.service.getRunSteps(actor, second.runId);
    const cached = steps.find((step) => step.cacheHit === true);
    assert.ok(cached, 'the step records that it was served from cache');
    assert.equal(cached.actualCostMicroUsd, 0);
  });

  it('never serves one tenant’s answer to another', async () => {
    const harness = buildTestAgentRuntime({
      optimization: { cacheEnabled: true, cacheTtlMs: 600_000 },
    });
    const acmeMeta = harness.meta(AGENT_TOKEN.consultant);
    const acme = await harness.runtime.service.authorize(acmeMeta);
    await harness.runtime.service.createRun(acme, runBody(), acmeMeta);

    const globexMeta = harness.meta(AGENT_TOKEN.otherTenant);
    const globex = await harness.runtime.service.authorize(globexMeta);
    const foreign = await harness.runtime.service.createRun(globex, runBody(), globexMeta);

    assert.equal(foreign.optimization.avoidedCalls, 0, 'a different tenant is a different key');
    assert.ok(foreign.cost.actualMicroUsd >= 0);
  });

  it('invalidates the whole cache when operational settings change', async () => {
    const harness = buildTestAgentRuntime({
      optimization: { cacheEnabled: true, cacheTtlMs: 600_000 },
    });
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);
    await harness.runtime.service.createRun(actor, runBody(), meta);

    const settings = harness.plane.settings.current();
    harness.plane.settings.adopt({
      ...settings,
      configurationVersion: settings.configurationVersion + 1,
    });

    const after = await harness.runtime.service.createRun(actor, runBody(), meta);
    assert.equal(
      after.optimization.avoidedCalls,
      0,
      'an answer produced under different settings is not interchangeable',
    );
  });
});
