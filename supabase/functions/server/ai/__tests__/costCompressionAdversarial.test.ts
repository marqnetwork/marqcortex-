/**
 * Adversarial cost compression (AI-01 Batch 3B, Part 6A).
 *
 * ── THE THREAT MODEL IS THE PLATFORM ITSELF ────────────────────────────────
 *
 * Every other suite asks whether the engine works. This one asks whether the
 * engine can be made to LIE — specifically, whether a 90% savings result can be
 * manufactured without a single token being saved. The attacker here is not an
 * external caller; it is a future revision of this repository, a well-meaning
 * constant change, or a product pressure to make a number look better.
 *
 * Six attacks, each one a real and cheap way to fake the target:
 *
 *   1. INFLATE BASELINE TOKENS      Claim the unoptimised call would have sent
 *                                   more than the tenant could ever have sent.
 *   2. INFLATE BASELINE PROFILE     Price the reference at a band the tenant was
 *                                   never permitted to use.
 *   3. IGNORE RETRY SPEND           Report the successful attempt and forget
 *                                   what the failed ones cost.
 *   4. DOUBLE COUNT                 Let two mechanisms each claim the same
 *                                   avoided micro-USD.
 *   5. REMOVE REQUIRED CONTEXT      Bank the tokens of the instructions that
 *                                   constrain the model.
 *   6. ROUTE BELOW THE FLOOR        Serve the task from a band its quality
 *                                   contract forbids.
 *
 * Each test performs the attack and asserts it fails. A test that merely
 * asserted the happy path would pass for a system with none of these defences.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASELINE_POLICY_V1,
  MAX_BASELINE_ATTEMPTS,
  assertBaselinePolicy,
  assertPlanNarrowsOnly,
  attributeUsage,
  buildSavingsRecord,
  compressCost,
  emptyUsageLedger,
  estimateBaselineCost,
  isCapabilityEscalation,
  isCompressionError,
  qualityFloorSatisfied,
  reconcileSavings,
  recommendCapabilityProfile,
  retryUsage,
  rollupSavings,
  selectContext,
  summarizeCompression,
} from '../optimization/index.ts';
import type { CapabilityProfile, QualityProfile } from '../optimization/index.ts';
import {
  CANDIDATE_CONTEXT,
  ORG,
  envelope,
  item,
  observation,
  task,
} from './costCompressionFixtures.ts';

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(isCompressionError(error), `expected a CompressionError, got ${String(error)}`);
    if (!isCompressionError(error)) return '';
    return error.failure;
  }
  assert.fail('expected the attack to be refused');
  return '';
}

// ── Attack 1: inflate the baseline's token count ────────────────────────────

describe('adversarial — inflating baseline tokens', () => {
  it('CLAMPS a candidate context larger than the tenant could ever have sent', () => {
    const bounds = envelope({ maxPromptTokens: 4_000, maxTotalTokens: 5_000 });
    const honest = estimateBaselineCost({ candidateContextTokens: 3_000, envelope: bounds });
    const inflated = estimateBaselineCost({
      candidateContextTokens: 100_000_000,
      envelope: bounds,
    });

    // 5,000 total less the 2,000 completion is 3,000 — the honest figure, and
    // the ceiling the inflated one is clamped to. A hundred million tokens buys
    // the attacker nothing.
    assert.equal(inflated.baselineEstimatedInputTokens, 3_000);
    assert.equal(inflated.baselineEstimatedCostMicroUsd, honest.baselineEstimatedCostMicroUsd);
    assert.ok(inflated.assumptions.includes('clamped_to_envelope'));
  });

  it('CAPS the modelled attempt count, so the reference cannot be multiplied', () => {
    // "The unoptimised system would have tried ten times" is the single most
    // effective way to inflate a denominator.
    assert.equal(
      refusal(() =>
        estimateBaselineCost({
          candidateContextTokens: 1_000,
          envelope: envelope(),
          policy: { ...BASELINE_POLICY_V1, assumedAttempts: 10 },
        }),
      ),
      'compression_input_invalid',
    );
    assert.equal(
      refusal(() =>
        assertBaselinePolicy({ ...BASELINE_POLICY_V1, assumedAttempts: MAX_BASELINE_ATTEMPTS + 1 }),
      ),
      'compression_input_invalid',
    );
  });

  it('REFUSES a policy that redefines the reference rules', () => {
    for (const tampered of [
      { ...BASELINE_POLICY_V1, promptRule: 'everything_imaginable' },
      { ...BASELINE_POLICY_V1, completionRule: 'double_allowance' },
      { ...BASELINE_POLICY_V1, profileRule: 'highest_that_exists' },
    ]) {
      assert.equal(
        refusal(() =>
          estimateBaselineCost({
            candidateContextTokens: 1_000,
            envelope: envelope(),
            // The cast is the attack: a caller assembling a policy object the
            // type system would otherwise refuse. The runtime check is what
            // stops it, and asserting that requires performing it.
            policy: tampered as unknown as typeof BASELINE_POLICY_V1,
          }),
        ),
        'compression_input_invalid',
      );
    }
  });
});

// ── Attack 2: inflate the baseline's capability band ────────────────────────

describe('adversarial — inflating the baseline model profile', () => {
  it('prices the reference at the CALLER MAXIMUM, never at the most expensive band', () => {
    const modest = envelope({
      allowedCapabilityProfiles: ['economy', 'standard'],
      maximumCapabilityProfile: 'standard',
    });
    const estimate = estimateBaselineCost({ candidateContextTokens: 2_000, envelope: modest });

    assert.equal(estimate.baselineCapabilityProfile, 'standard');
    // Priced at `advanced_reasoning` the same call would be roughly seven times
    // dearer, and every savings ratio computed against it would improve without
    // a single token being saved.
    const dishonest = estimateBaselineCost({
      candidateContextTokens: 2_000,
      envelope: envelope({
        allowedCapabilityProfiles: ['advanced_reasoning'],
        maximumCapabilityProfile: 'advanced_reasoning',
      }),
    });
    assert.ok(dishonest.baselineEstimatedCostMicroUsd > estimate.baselineEstimatedCostMicroUsd * 5);
    // …and the tenant that may only use `standard` gets the `standard` figure.
    assert.equal(estimate.baselineCapabilityProfile, 'standard');
  });

  it('never prices the reference above the caller maximum, even if the allow list is wider', () => {
    const estimate = estimateBaselineCost({
      candidateContextTokens: 2_000,
      envelope: envelope({
        allowedCapabilityProfiles: ['economy', 'standard', 'reasoning', 'advanced_reasoning'],
        maximumCapabilityProfile: 'economy',
      }),
    });
    assert.equal(estimate.baselineCapabilityProfile, 'economy');
  });

  it('gives an economy-only tenant a MODEST baseline, so its savings stay modest', () => {
    // The end-to-end shape of the attack: an inflated baseline would let a plan
    // that changes almost nothing report a huge percentage.
    const economyOnly = envelope({
      allowedCapabilityProfiles: ['economy'],
      maximumCapabilityProfile: 'economy',
    });
    const plan = compressCost({
      task: task({ kind: 'extraction', quality: 'best_effort' }),
      envelope: economyOnly,
      contextItems: CANDIDATE_CONTEXT,
      minimumRelevance: 40,
    });
    assert.equal(plan.baseline.baselineCapabilityProfile, 'economy');
    assert.equal(plan.recommendedCapabilityProfile, 'economy');
    assert.equal(plan.downgraded, false);
    // No band to drop to, so the only saving is real context and output
    // reduction — and the number reflects that rather than a fabricated band gap.
    assert.ok(plan.savings.savingsPercent < 90, `${plan.savings.savingsPercent}%`);
    reconcileSavings(plan.savings);
  });
});

// ── Attack 3: ignore retry spend ────────────────────────────────────────────

describe('adversarial — ignoring retry spend', () => {
  it('a failed attempt STAYS on the ledger and is never netted off', () => {
    let ledger = emptyUsageLedger(ORG);
    // Attempt one failed after spending; attempt two succeeded.
    ledger = attributeUsage(ledger, observation({ agentRunId: 'run_1', nodeId: 'work', attempt: 1 })).ledger;
    ledger = attributeUsage(ledger, observation({ agentRunId: 'run_2', nodeId: 'work', attempt: 2 })).ledger;

    assert.equal(ledger.totals.actualCostMicroUsd, 4_000);
    assert.equal(retryUsage(ledger).actualCostMicroUsd, 2_000);
    // There is no operation on the ledger that removes a row or reduces a total.
    // The high-water mark fold means even a re-report of the failed child's
    // (lower) figures cannot walk it back.
    const replayed = attributeUsage(
      ledger,
      observation({
        agentRunId: 'run_1',
        nodeId: 'work',
        attempt: 1,
        cumulative: {
          actualInputTokens: 0,
          actualOutputTokens: 0,
          actualTotalTokens: 0,
          actualCostMicroUsd: 0,
        },
      }),
    );
    assert.equal(replayed.ledger.totals.actualCostMicroUsd, 4_000);
  });

  it('REALISED savings shrink when the actual spend includes the retry', () => {
    // The estimate assumed one attempt. Two happened. The percentage must fall.
    const weights = [{ category: 'context_reduction' as const, weight: 1, tokens: 0 }];
    const estimated = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 10_000,
      optimizedEstimatedCostMicroUsd: 1_000,
      weights,
    });
    assert.equal(estimated.savingsPercent, 90);
    assert.equal(estimated.realized, false);

    const settled = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 10_000,
      optimizedEstimatedCostMicroUsd: 1_000,
      // One attempt at 1,000 plus a retry at 1,000, plus a repair.
      actualCostMicroUsd: 3_000,
      weights,
    });
    assert.equal(settled.savingsPercent, 70);
    assert.equal(settled.realized, true);
    reconcileSavings(settled);
  });

  it('a rollup counts NO realised saving for a record that was never measured', () => {
    // Falling back to the estimate here is exactly how an unmeasured platform
    // reports measured results.
    const unmeasured = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 10_000,
      optimizedEstimatedCostMicroUsd: 1_000,
      weights: [{ category: 'context_reduction', weight: 1, tokens: 0 }],
    });
    const rollup = rollupSavings([unmeasured]);
    assert.equal(rollup.estimatedSavingsMicroUsd, 9_000);
    assert.equal(rollup.realizedSavingsMicroUsd, 0);
    assert.equal(rollup.savingsPercent, 0);
  });

  it('metrics report retry spend BESIDE the savings, never inside them', () => {
    let ledger = emptyUsageLedger(ORG);
    ledger = attributeUsage(ledger, observation({ agentRunId: 'r1', attempt: 1 })).ledger;
    ledger = attributeUsage(ledger, observation({ agentRunId: 'r2', attempt: 2 })).ledger;

    const metrics = summarizeCompression({
      plans: [
        compressCost({
          task: task({ kind: 'extraction', quality: 'best_effort' }),
          envelope: envelope(),
          contextItems: CANDIDATE_CONTEXT,
          minimumRelevance: 40,
        }),
      ],
      ledgers: [ledger],
    });
    assert.equal(metrics.retryCostMicroUsd, 2_000);
    assert.equal(metrics.retryTokens, 1_500);
  });
});

// ── Attack 4: count the same saving twice ───────────────────────────────────

describe('adversarial — counting the same saving twice', () => {
  it('cannot attribute more than the gap, however many categories claim it', () => {
    const built = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 10_000,
      optimizedEstimatedCostMicroUsd: 1_000,
      // Every category claims the whole 9,000 gap. Summed naively: 63,000.
      weights: [
        { category: 'deterministic_avoidance', weight: 9_000, tokens: 100 },
        { category: 'reuse', weight: 9_000, tokens: 100 },
        { category: 'context_reduction', weight: 9_000, tokens: 100 },
        { category: 'capability_downgrade', weight: 9_000, tokens: 100 },
        { category: 'avoided_retry', weight: 9_000, tokens: 100 },
        { category: 'avoided_escalation', weight: 9_000, tokens: 100 },
        { category: 'output_budget_reduction', weight: 9_000, tokens: 100 },
      ],
    });

    const attributed = built.entries.reduce((sum, entry) => sum + entry.microUsd, 0);
    assert.equal(attributed, 9_000);
    assert.equal(built.estimatedSavingsMicroUsd, 9_000);
    assert.ok(attributed <= built.baselineCostMicroUsd);
    reconcileSavings(built);
  });

  it('loses no micro-USD to rounding when a gap splits unevenly', () => {
    // Largest-remainder, not naive rounding: `Σ categories` must equal the total
    // exactly, or a reconciliation that tolerated "a few" would tolerate any.
    for (const gap of [1, 7, 101, 1_003, 99_991]) {
      const built = buildSavingsRecord({
        taskId: `task_${gap}`,
        organizationId: ORG,
        baselinePolicyVersion: 'baseline.v1',
        baselineCostMicroUsd: gap,
        optimizedEstimatedCostMicroUsd: 0,
        weights: [
          { category: 'context_reduction', weight: 1, tokens: 0 },
          { category: 'capability_downgrade', weight: 1, tokens: 0 },
          { category: 'avoided_retry', weight: 1, tokens: 0 },
        ],
      });
      assert.equal(
        built.entries.reduce((sum, entry) => sum + entry.microUsd, 0),
        gap,
      );
      reconcileSavings(built);
    }
  });

  it('REFUSES a record whose entries were tampered with after the fact', () => {
    const built = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 10_000,
      optimizedEstimatedCostMicroUsd: 5_000,
      weights: [{ category: 'context_reduction', weight: 1, tokens: 0 }],
    });

    // Duplicate the category and double the number — the shape a hand-assembled
    // ledger takes when somebody wants a better figure.
    assert.equal(
      refusal(() =>
        reconcileSavings({ ...built, entries: [...built.entries, ...built.entries] }),
      ),
      'savings_reconciliation_failed',
    );

    // Or simply overstate the saving against its own baseline.
    assert.equal(
      refusal(() =>
        reconcileSavings({
          ...built,
          estimatedSavingsMicroUsd: 999_999,
          entries: [{ category: 'reuse', microUsd: 999_999, tokens: 0 }],
        }),
      ),
      'savings_reconciliation_failed',
    );
  });

  it('an aggregate refuses to average an unbalanced record into itself', () => {
    const built = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 1_000,
      optimizedEstimatedCostMicroUsd: 500,
      weights: [{ category: 'reuse', weight: 1, tokens: 0 }],
    });
    assert.equal(
      refusal(() =>
        rollupSavings([
          built,
          { ...built, taskId: 'task_2', entries: [{ category: 'reuse', microUsd: 99_999, tokens: 0 }] },
        ]),
      ),
      'savings_reconciliation_failed',
    );
  });

  it('a settled record REPLACES its plan estimate in metrics, never adds to it', () => {
    const plan = compressCost({
      task: task({ taskId: 'task_1', kind: 'extraction', quality: 'best_effort' }),
      envelope: envelope(),
      contextItems: CANDIDATE_CONTEXT,
      minimumRelevance: 40,
    });
    const settled = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: plan.savings.baselinePolicyVersion,
      baselineCostMicroUsd: plan.savings.baselineCostMicroUsd,
      optimizedEstimatedCostMicroUsd: plan.savings.optimizedEstimatedCostMicroUsd,
      actualCostMicroUsd: plan.savings.optimizedEstimatedCostMicroUsd,
      weights: [{ category: 'context_reduction', weight: 1, tokens: 0 }],
    });

    const metrics = summarizeCompression({ plans: [plan], settled: [settled] });
    assert.equal(metrics.taskCount, 1);
    assert.equal(metrics.baselineCostMicroUsd, plan.savings.baselineCostMicroUsd);
    assert.ok(metrics.savingsPercent <= 100);
  });
});

// ── Attack 5: remove required context ───────────────────────────────────────

describe('adversarial — removing required context', () => {
  it('CANNOT drop a required item to make the numbers fit', () => {
    const required = [
      item({ itemId: 'sys', source: 'system_authority', necessity: 'required', estimatedTokens: 900, digest: 'd1' }),
      item({ itemId: 'safety', source: 'safety_policy', necessity: 'required', estimatedTokens: 900, digest: 'd2' }),
    ];
    // A ceiling that cannot hold them. The engine refuses rather than trimming.
    assert.equal(
      refusal(() =>
        selectContext(required, { ceilingTokens: 1_000, minimumRelevance: 0, minimumFreshness: 0 }),
      ),
      'required_context_exceeds_ceiling',
    );
  });

  it('CANNOT be tricked into demoting an authority source', () => {
    // The attack: mark the safety policy optional and give it a relevance below
    // the floor, so an ordinary filter would drop it and bank the tokens.
    const items = [
      item({
        itemId: 'safety',
        source: 'safety_policy',
        necessity: 'optional',
        relevance: 0,
        freshness: 0,
        estimatedTokens: 800,
        digest: 'd1',
      }),
      item({ itemId: 'filler', estimatedTokens: 100, relevance: 100, digest: 'd2' }),
    ];
    const selection = selectContext(items, {
      ceilingTokens: 8_000,
      minimumRelevance: 90,
      minimumFreshness: 90,
    });
    assert.ok(selection.includedItemIds.includes('safety'));
    assert.equal(selection.requiredTokens, 800);
  });

  it('CANNOT deduplicate a required item away against an optional twin', () => {
    // Both carry the same digest. Dropping the REQUIRED copy would move an
    // instruction into a slot that later budget pressure can trim.
    const items = [
      item({ itemId: 'sys', source: 'system_authority', necessity: 'required', estimatedTokens: 300, digest: 'same' }),
      item({ itemId: 'echo', estimatedTokens: 300, relevance: 100, digest: 'same' }),
    ];
    const selection = selectContext(items, {
      ceilingTokens: 8_000,
      minimumRelevance: 0,
      minimumFreshness: 0,
    });
    assert.deepEqual(selection.includedItemIds, ['sys']);
    assert.equal(selection.requiredTokens, 300);
    assert.deepEqual(
      selection.excluded.map((entry) => [entry.itemId, entry.reason]),
      [['echo', 'duplicate']],
    );
  });

  it('the ENGINE fails closed too — there is no path that proceeds without authority', () => {
    assert.equal(
      refusal(() =>
        compressCost({
          task: task(),
          envelope: envelope({ maxPromptTokens: 500 }),
          contextItems: [
            item({
              itemId: 'sys',
              source: 'system_authority',
              necessity: 'required',
              estimatedTokens: 900,
              digest: 'd1',
            }),
          ],
        }),
      ),
      'required_context_exceeds_ceiling',
    );
  });
});

// ── Attack 6: route below the required capability profile ───────────────────

describe('adversarial — routing below the required capability profile', () => {
  const FLOORS: readonly (readonly [QualityProfile, CapabilityProfile])[] = [
    ['best_effort', 'economy'],
    ['standard', 'economy'],
    ['high', 'standard'],
    ['critical', 'reasoning'],
  ];

  it('never recommends a band the quality contract forbids', () => {
    for (const [quality, floor] of FLOORS) {
      const outcome = recommendCapabilityProfile({
        // A trivial task, which is the case most likely to be routed down.
        task: task({ kind: 'extraction', quality }),
        envelope: envelope({
          allowedCapabilityProfiles: ['economy', 'standard', 'reasoning', 'advanced_reasoning'],
          maximumCapabilityProfile: 'advanced_reasoning',
        }),
        requiredByComplexity: 'economy',
      });
      assert.ok(!isCapabilityEscalation(outcome), `${quality} escalated unexpectedly`);
      if (isCapabilityEscalation(outcome)) continue;
      assert.equal(outcome.profile, floor);
      assert.ok(qualityFloorSatisfied(outcome.profile, quality));
    }
  });

  it('ESCALATES rather than serving below the floor when nothing qualifies', () => {
    const outcome = recommendCapabilityProfile({
      task: task({ kind: 'extraction', quality: 'critical' }),
      envelope: envelope({
        allowedCapabilityProfiles: ['economy'],
        maximumCapabilityProfile: 'economy',
      }),
      requiredByComplexity: 'economy',
    });
    assert.ok(isCapabilityEscalation(outcome));
    if (!isCapabilityEscalation(outcome)) return;
    assert.equal(outcome.requiredProfile, 'reasoning');
  });

  it('a plan for a critical task NEVER claims a downgrade saving it did not earn', () => {
    const plan = compressCost({
      task: task({ kind: 'extraction', quality: 'critical' }),
      envelope: envelope(),
      contextItems: CANDIDATE_CONTEXT,
      minimumRelevance: 40,
    });
    assert.equal(plan.recommendedCapabilityProfile, 'reasoning');
    assert.equal(plan.downgraded, false);
    assert.equal(
      plan.savings.entries.some((entry) => entry.category === 'capability_downgrade'),
      false,
    );
    reconcileSavings(plan.savings);
  });

  it('assertPlanNarrowsOnly REFUSES a plan that widened anything', () => {
    const bounds = envelope();
    const plan = compressCost({
      task: task({ kind: 'extraction', quality: 'best_effort' }),
      envelope: bounds,
      contextItems: CANDIDATE_CONTEXT,
      minimumRelevance: 40,
    });
    assertPlanNarrowsOnly(plan, bounds);

    // Now re-check the SAME plan against a narrower envelope than it was built
    // for. Every widening the guard is meant to catch shows up as a violation.
    assert.equal(
      refusal(() =>
        assertPlanNarrowsOnly(plan, {
          ...bounds,
          maxCompletionTokens: 1,
          maxPromptTokens: 1,
          maxTotalTokens: 1,
          allowedCapabilityProfiles: ['reasoning'],
          maximumCapabilityProfile: 'reasoning',
        }),
      ),
      'optimization_would_widen_policy',
    );
  });

  it('the engine never recommends outside the caller allow list, across every task shape', () => {
    const bounds = envelope({
      allowedCapabilityProfiles: ['standard'],
      maximumCapabilityProfile: 'standard',
    });
    for (const kind of ['retrieval', 'extraction', 'summarization', 'generation'] as const) {
      const plan = compressCost({
        task: task({ kind, quality: 'standard' }),
        envelope: bounds,
        contextItems: CANDIDATE_CONTEXT,
      });
      if (plan.recommendedCapabilityProfile === undefined) continue;
      assert.equal(plan.recommendedCapabilityProfile, 'standard');
      assertPlanNarrowsOnly(plan, bounds);
    }
  });
});

// ── The composite claim ─────────────────────────────────────────────────────

describe('adversarial — the 90% target cannot be manufactured', () => {
  it('a plan that changes nothing reports NO saving', () => {
    // The honest floor case: nothing to deduplicate, nothing irrelevant, the
    // top band required, and the full completion needed. A system that reported
    // a saving here would be reporting one it invented.
    const bounds = envelope({
      allowedCapabilityProfiles: ['reasoning'],
      maximumCapabilityProfile: 'reasoning',
      maxCompletionTokens: 1_000,
    });
    const plan = compressCost({
      task: task({
        kind: 'reasoning',
        quality: 'critical',
        requiresMultiStepReasoning: false,
        expectedOutputTokens: 1_000,
      }),
      envelope: bounds,
      contextItems: [
        item({ itemId: 'sys', source: 'system_authority', necessity: 'required', estimatedTokens: 500, digest: 'a' }),
        item({ itemId: 'task', source: 'current_task', necessity: 'required', estimatedTokens: 500, digest: 'b' }),
      ],
    });

    assert.equal(plan.decision, 'execute');
    assert.equal(plan.savings.estimatedSavingsMicroUsd, 0);
    assert.equal(plan.savings.savingsPercent, 0);
    assert.deepEqual(plan.savings.entries, []);
    reconcileSavings(plan.savings);
    assertPlanNarrowsOnly(plan, bounds);
  });

  it('every reported saving survives reconciliation, across many shapes', () => {
    const plans = (['retrieval', 'extraction', 'classification', 'summarization', 'generation', 'reasoning', 'planning', 'review'] as const).flatMap(
      (kind) =>
        (['best_effort', 'standard', 'high', 'critical'] as const).map((quality) =>
          compressCost({
            task: task({ taskId: `${kind}_${quality}`, kind, quality }),
            envelope: envelope({
              allowedCapabilityProfiles: ['economy', 'standard', 'reasoning', 'advanced_reasoning'],
              maximumCapabilityProfile: 'advanced_reasoning',
            }),
            contextItems: CANDIDATE_CONTEXT,
            minimumRelevance: 40,
          }),
        ),
    );

    for (const plan of plans) {
      reconcileSavings(plan.savings);
      assert.ok(plan.savings.estimatedSavingsMicroUsd <= plan.savings.baselineCostMicroUsd);
      assert.ok(plan.savings.savingsPercent >= 0 && plan.savings.savingsPercent <= 100);
      if (plan.recommendedCapabilityProfile !== undefined) {
        assert.ok(qualityFloorSatisfied(plan.recommendedCapabilityProfile, plan.quality));
      }
    }

    const metrics = summarizeCompression({ plans });
    assert.ok(metrics.savingsPercent >= 0 && metrics.savingsPercent <= 100);
    assert.equal(metrics.taskCount, plans.length);
  });
});
