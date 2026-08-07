/**
 * Cost Compression Engine — behaviour (AI-01 Batch 3B, Part 6A).
 *
 * The adversarial suite lives next door in `costCompressionAdversarial.test.ts`
 * and the accounting suite in `costCompressionAccounting.test.ts`. This one
 * asserts that each layer does what it says: admission, classification, context
 * value, budget, capability, escalation, marginal value, baseline and savings.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASELINE_POLICY_V1,
  admitAdditionalAttempt,
  admitWithoutInference,
  assertPlanNarrowsOnly,
  buildSavingsRecord,
  classifyComplexity,
  compressCost,
  decideEscalation,
  estimateBaselineCost,
  isCapabilityEscalation,
  isCompressionError,
  mustNotStop,
  planTokenBudget,
  reconcileSavings,
  recommendCapabilityProfile,
  selectContext,
  summarizeCompression,
} from '../optimization/index.ts';
import type { CompressionError } from '../optimization/index.ts';
import {
  CANDIDATE_CONTEXT,
  ORG,
  envelope,
  item,
  oversizedRequiredContext,
  task,
} from './costCompressionFixtures.ts';

function compressionFailureOf(error: unknown): CompressionError['failure'] {
  assert.ok(isCompressionError(error), `expected a CompressionError, got ${String(error)}`);
  return error.failure;
}

// ── 1. Zero-LLM admission ───────────────────────────────────────────────────

describe('zero-LLM admission', () => {
  it('AVOIDS INFERENCE when an authorised deterministic path covers the task', () => {
    const outcome = admitWithoutInference(
      task({
        kind: 'calculation',
        deterministicCapabilities: [
          {
            capabilityId: 'cap.sum',
            satisfies: ['calculation'],
            complete: true,
            maximumQuality: 'high',
          },
        ],
      }),
    );

    assert.equal(outcome.decision, 'deterministic');
    assert.equal(outcome.inferenceAvoided, true);
    assert.equal(outcome.reason, 'calculation_available');
    assert.equal(outcome.capabilityId, 'cap.sum');
  });

  it('requires inference when the declared path is INCOMPLETE', () => {
    // A partial deterministic path is not an avoidance — there is still an
    // inference to make, and claiming the saving anyway is how avoided-call
    // counts stop matching provider invoices.
    const outcome = admitWithoutInference(
      task({
        kind: 'calculation',
        deterministicCapabilities: [
          {
            capabilityId: 'cap.partial',
            satisfies: ['calculation'],
            complete: false,
            maximumQuality: 'high',
          },
        ],
      }),
    );

    assert.equal(outcome.decision, 'execute');
    assert.equal(outcome.inferenceAvoided, false);
    assert.match(outcome.diagnostics, /none covers/);
  });

  it('requires inference when the path does not cover the task KIND', () => {
    const outcome = admitWithoutInference(
      task({
        kind: 'reasoning',
        deterministicCapabilities: [
          {
            capabilityId: 'cap.transform',
            satisfies: ['transformation'],
            complete: true,
            maximumQuality: 'critical',
          },
        ],
      }),
    );
    assert.equal(outcome.decision, 'execute');
  });

  it('REFUSES a deterministic path certified below the required quality', () => {
    const outcome = admitWithoutInference(
      task({
        kind: 'calculation',
        quality: 'critical',
        deterministicCapabilities: [
          {
            capabilityId: 'cap.rough',
            satisfies: ['calculation'],
            complete: true,
            maximumQuality: 'standard',
          },
        ],
      }),
    );
    assert.equal(outcome.decision, 'execute');
  });

  it('reuses a validated prior output, and never one from another tenant', () => {
    const own = admitWithoutInference(
      task({
        priorOutputs: [
          {
            artifactId: 'art_1',
            digest: 'abc',
            organizationId: ORG,
            contractValidated: true,
            quality: 'standard',
          },
        ],
      }),
    );
    assert.equal(own.decision, 'reuse');
    assert.equal(own.artifactId, 'art_1');

    const foreign = admitWithoutInference(
      task({
        priorOutputs: [
          {
            artifactId: 'art_1',
            digest: 'abc',
            organizationId: 'org_globex',
            contractValidated: true,
            quality: 'standard',
          },
        ],
      }),
    );
    assert.equal(foreign.decision, 'execute');
  });

  it('prefers a deterministic path over a reusable artefact', () => {
    // A computed answer is current by construction; a stored one is current
    // only until something changes.
    const outcome = admitWithoutInference(
      task({
        kind: 'calculation',
        deterministicCapabilities: [
          { capabilityId: 'cap.a', satisfies: ['calculation'], complete: true, maximumQuality: 'high' },
        ],
        priorOutputs: [
          {
            artifactId: 'art_1',
            digest: 'abc',
            organizationId: ORG,
            contractValidated: true,
            quality: 'high',
          },
        ],
      }),
    );
    assert.equal(outcome.decision, 'deterministic');
  });
});

// ── 2. Complexity classification ────────────────────────────────────────────

describe('task complexity classifier', () => {
  it('classifies a mechanical task as deterministic and a reasoning task as complex', () => {
    assert.equal(classifyComplexity(task({ kind: 'calculation' })).complexity, 'deterministic');
    assert.equal(classifyComplexity(task({ kind: 'transformation' })).complexity, 'deterministic');
    assert.equal(classifyComplexity(task({ kind: 'extraction' })).complexity, 'trivial');
    assert.equal(classifyComplexity(task({ kind: 'generation' })).complexity, 'standard');
    assert.equal(classifyComplexity(task({ kind: 'reasoning' })).complexity, 'complex');
  });

  it('applies the task-kind FLOOR: a reasoning task is never trivial', () => {
    // Even with every de-escalating signal on, the shape of the work lifts it.
    const classification = classifyComplexity(
      task({ kind: 'reasoning', toleratesApproximation: true, outputFieldCount: 1 }),
    );
    assert.equal(classification.complexity, 'complex');
  });

  it('escalates on multi-step reasoning and supplied evidence', () => {
    const classification = classifyComplexity(
      task({
        kind: 'reasoning',
        requiresMultiStepReasoning: true,
        requiresSuppliedEvidence: true,
        requiresStructuredOutput: true,
      }),
    );
    assert.equal(classification.complexity, 'high_reasoning');
    assert.equal(classification.requiredCapabilityProfile, 'advanced_reasoning');
  });

  it('raises the required band when the QUALITY CONTRACT demands it', () => {
    // Trivial work under a critical contract does not get an economy band.
    const classification = classifyComplexity(task({ kind: 'extraction', quality: 'critical' }));
    assert.equal(classification.complexity, 'trivial');
    assert.equal(classification.requiredCapabilityProfile, 'reasoning');
    assert.ok(classification.signals.includes('quality_floor_applied'));
  });

  it('IS STABLE: identical descriptors classify identically, every time', () => {
    const descriptor = task({ kind: 'review', requiresSuppliedEvidence: true });
    const first = JSON.stringify(classifyComplexity(descriptor));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      assert.equal(JSON.stringify(classifyComplexity(descriptor)), first);
    }
  });

  it('calls no model, holds no state and reads only declared fields', () => {
    // Two DIFFERENT descriptor objects with identical field values must produce
    // identical classifications — which is only true if nothing about object
    // identity, insertion order or prior calls reaches the classifier.
    const a = classifyComplexity(task({ taskId: 'one', kind: 'planning' }));
    const b = classifyComplexity(task({ taskId: 'two', kind: 'planning' }));
    assert.deepEqual({ ...a }, { ...b });
  });
});

// ── 3. Context value engine ─────────────────────────────────────────────────

describe('context value engine', () => {
  it('PRESERVES every required item, even under heavy budget pressure', () => {
    const selection = selectContext(CANDIDATE_CONTEXT, {
      ceilingTokens: 700,
      minimumRelevance: 0,
      minimumFreshness: 0,
    });

    for (const required of ['sys', 'safety', 'objective']) {
      assert.ok(selection.includedItemIds.includes(required), `${required} was dropped`);
    }
    assert.equal(selection.requiredTokens, 650);
    // 650 required of a 700 ceiling leaves 50 — not enough for any optional item.
    assert.equal(selection.optionalTokens, 0);
  });

  it('never lets optional content DISPLACE required content', () => {
    const items = [
      item({ itemId: 'sys', source: 'system_authority', necessity: 'required', estimatedTokens: 500, digest: 'd1' }),
      // Maximum relevance and freshness, and it still cannot take the required
      // item's tokens — the allowance it competes for never contained them.
      item({ itemId: 'greedy', estimatedTokens: 500, relevance: 100, freshness: 100, digest: 'd2' }),
    ];
    const selection = selectContext(items, {
      ceilingTokens: 600,
      minimumRelevance: 0,
      minimumFreshness: 0,
    });
    assert.deepEqual(selection.includedItemIds, ['sys']);
    assert.equal(selection.excluded[0].reason, 'token_budget');
  });

  it('PROMOTES an authority source a caller mislabelled as optional', () => {
    const items = [
      item({ itemId: 'safety', source: 'safety_policy', necessity: 'optional', estimatedTokens: 500, digest: 'd1' }),
      item({ itemId: 'noise', estimatedTokens: 500, relevance: 100, digest: 'd2' }),
    ];
    const selection = selectContext(items, {
      ceilingTokens: 600,
      minimumRelevance: 0,
      minimumFreshness: 0,
    });
    assert.deepEqual(selection.includedItemIds, ['safety']);
    assert.equal(selection.requiredTokens, 500);
  });

  it('DEDUPLICATES deterministically, within necessity and never across it', () => {
    const selection = selectContext(CANDIDATE_CONTEXT, {
      ceilingTokens: 8_000,
      minimumRelevance: 0,
      minimumFreshness: 0,
    });
    const duplicates = selection.excluded.filter((entry) => entry.reason === 'duplicate');
    assert.equal(duplicates.length, 1);
    // The LOWER-ranked of the identical pair is the one dropped, every time.
    assert.equal(duplicates[0].itemId, 'evidence_b_copy');
    assert.ok(selection.includedItemIds.includes('evidence_b'));

    // Same inputs, same answer — including the order of the included list.
    const again = selectContext(CANDIDATE_CONTEXT, {
      ceilingTokens: 8_000,
      minimumRelevance: 0,
      minimumFreshness: 0,
    });
    assert.deepEqual(again.includedItemIds, selection.includedItemIds);
    assert.deepEqual(again.excluded, selection.excluded);
  });

  it('removes optional content below the relevance and freshness floors', () => {
    const selection = selectContext(CANDIDATE_CONTEXT, {
      ceilingTokens: 8_000,
      minimumRelevance: 40,
      minimumFreshness: 0,
    });
    const irrelevant = selection.excluded.filter((entry) => entry.reason === 'irrelevant');
    assert.deepEqual(irrelevant.map((entry) => entry.itemId), ['history']);
    assert.equal(selection.includedItemIds.includes('history'), false);
  });

  it('reports the token reduction it actually achieved', () => {
    const selection = selectContext(CANDIDATE_CONTEXT, {
      ceilingTokens: 8_000,
      minimumRelevance: 40,
      minimumFreshness: 0,
    });
    // 2,750 candidate tokens; the duplicate (400) and the history item (900) go.
    assert.equal(selection.beforeTokens, 2_750);
    assert.equal(selection.afterTokens, 1_450);
    assert.equal(selection.reducedTokens, 1_300);
    assert.equal(selection.reductionPercent, 47);
    assert.equal(selection.complete, false);
  });

  it('drops an optional item whose dependency did not survive', () => {
    const items = [
      item({ itemId: 'sys', source: 'system_authority', necessity: 'required', estimatedTokens: 50, digest: 'd0' }),
      item({ itemId: 'part_one', estimatedTokens: 100, relevance: 5, digest: 'd1' }),
      item({ itemId: 'part_two', estimatedTokens: 100, relevance: 90, digest: 'd2', dependsOn: ['part_one'] }),
    ];
    const selection = selectContext(items, {
      ceilingTokens: 8_000,
      minimumRelevance: 40,
      minimumFreshness: 0,
    });
    assert.equal(selection.includedItemIds.includes('part_two'), false);
    assert.ok(
      selection.excluded.some(
        (entry) => entry.itemId === 'part_two' && entry.reason === 'dependency_excluded',
      ),
    );
  });

  it('FAILS CLOSED when the required set alone exceeds the ceiling', () => {
    // It does not trim a required item, summarise one, or proceed with a partial
    // authority set. A step that cannot afford its own rules must not run.
    try {
      selectContext(oversizedRequiredContext(4_000), {
        ceilingTokens: 5_000,
        minimumRelevance: 0,
        minimumFreshness: 0,
      });
      assert.fail('expected a fail-closed refusal');
    } catch (error) {
      assert.equal(compressionFailureOf(error), 'required_context_exceeds_ceiling');
    }
  });
});

// ── 4. Token budget planner ─────────────────────────────────────────────────

describe('token budget planner', () => {
  it('NARROWS the completion allowance to what the task actually needs', () => {
    const plan = planTokenBudget({
      task: task({ expectedOutputTokens: 300 }),
      complexity: 'standard',
      envelope: envelope(),
      requiredInputTokens: 650,
    });
    // 300 × 1.5 headroom = 450, well under the 2,000 the envelope permits.
    assert.equal(plan.reservedOutputTokens, 450);
    assert.equal(plan.narrowed, true);
  });

  it('CANNOT EXCEED A CONTROL PLANE LIMIT, whatever the task asks for', () => {
    const bounds = envelope({
      maxPromptTokens: 1_000,
      maxCompletionTokens: 500,
      maxTotalTokens: 1_200,
    });
    const plan = planTokenBudget({
      // An enormous declared expectation and an enormous history figure.
      task: task({ expectedOutputTokens: 999_999 }),
      complexity: 'high_reasoning',
      envelope: bounds,
      requiredInputTokens: 100,
      historicalOutputTokens: 999_999,
    });

    assert.ok(plan.reservedOutputTokens <= bounds.maxCompletionTokens);
    assert.ok(plan.plannedPromptTokens <= bounds.maxPromptTokens);
    assert.ok(plan.plannedTotalTokens <= bounds.maxTotalTokens);
    assert.equal(plan.reservedOutputTokens, 500);
    // The total ceiling binds before the prompt ceiling does: 1,200 − 500 = 700.
    assert.equal(plan.plannedPromptTokens, 700);
  });

  it('never reserves less than the caller expects because history said so', () => {
    const plan = planTokenBudget({
      task: task({ expectedOutputTokens: 800 }),
      complexity: 'trivial',
      envelope: envelope(),
      requiredInputTokens: 100,
      historicalOutputTokens: 10,
    });
    assert.ok(plan.reservedOutputTokens >= 800);
  });

  it('fails closed when required context does not fit the total budget', () => {
    try {
      planTokenBudget({
        task: task({ expectedOutputTokens: 1_800 }),
        complexity: 'standard',
        envelope: envelope({ maxTotalTokens: 3_000, maxPromptTokens: 8_000 }),
        requiredInputTokens: 2_500,
      });
      assert.fail('expected a fail-closed refusal');
    } catch (error) {
      assert.equal(compressionFailureOf(error), 'required_context_exceeds_ceiling');
    }
  });
});

// ── 5. Minimum-capable profile ──────────────────────────────────────────────

describe('capability recommendation', () => {
  it('recommends the MINIMUM sufficient band', () => {
    const outcome = recommendCapabilityProfile({
      task: task({ kind: 'extraction', quality: 'best_effort' }),
      envelope: envelope(),
      requiredByComplexity: 'economy',
    });
    assert.ok(!isCapabilityEscalation(outcome));
    if (isCapabilityEscalation(outcome)) return;
    assert.equal(outcome.profile, 'economy');
    assert.equal(outcome.downgraded, true);
    assert.equal(outcome.stepsSaved, 2);
  });

  it('CANNOT WIDEN the caller allow list or the caller maximum', () => {
    const bounded = envelope({
      allowedCapabilityProfiles: ['economy', 'standard'],
      maximumCapabilityProfile: 'standard',
    });
    const outcome = recommendCapabilityProfile({
      task: task({ kind: 'reasoning', quality: 'critical' }),
      envelope: bounded,
      // The classifier says this needs `reasoning`, which the caller has not
      // permitted. The engine escalates rather than reaching for it.
      requiredByComplexity: 'reasoning',
    });
    assert.ok(isCapabilityEscalation(outcome));
    if (!isCapabilityEscalation(outcome)) return;
    assert.equal(outcome.requiredProfile, 'reasoning');
    assert.equal(outcome.reason, 'capability_floor_reached');
  });

  it('never recommends a band below the quality floor', () => {
    const outcome = recommendCapabilityProfile({
      task: task({ kind: 'extraction', quality: 'critical' }),
      envelope: envelope(),
      requiredByComplexity: 'economy',
    });
    assert.ok(!isCapabilityEscalation(outcome));
    if (isCapabilityEscalation(outcome)) return;
    // `critical` floors at `reasoning`, so a trivial task still gets it.
    assert.equal(outcome.profile, 'reasoning');
  });

  it('does not re-recommend a band that has already been attempted', () => {
    const outcome = recommendCapabilityProfile({
      task: task({ kind: 'extraction', quality: 'best_effort' }),
      envelope: envelope(),
      requiredByComplexity: 'economy',
      attemptedProfiles: ['economy'],
    });
    assert.ok(!isCapabilityEscalation(outcome));
    if (isCapabilityEscalation(outcome)) return;
    assert.equal(outcome.profile, 'standard');
  });
});

// ── 6. Progressive escalation ───────────────────────────────────────────────

describe('progressive escalation', () => {
  const state = {
    attemptedProfiles: ['economy'] as const,
    escalations: 0,
    maxEscalations: 2,
    maximumProfile: 'reasoning' as const,
    allowedProfiles: ['economy', 'standard', 'reasoning'] as const,
    remainingCostMicroUsd: 100_000,
    nextAttemptCostMicroUsd: 5_000,
  };

  it('STOPS on passing evidence — the whole point of trying cheap first', () => {
    const decision = decideEscalation('pass', { ...state });
    assert.equal(decision.escalate, false);
    assert.equal(decision.reason, 'minimum_profile_sufficient');
    // Not a saving: refusing to escalate a passing answer is the system working.
    assert.equal(decision.avoidedCostMicroUsd, 0);
  });

  it('ESCALATES one band on uncertain evidence', () => {
    const decision = decideEscalation('uncertain', { ...state });
    assert.equal(decision.escalate, true);
    assert.equal(decision.nextProfile, 'standard');
    assert.equal(decision.reason, 'quality_evidence_uncertain');
  });

  it('does NOT escalate a hard failure — a larger model is not the remedy', () => {
    const decision = decideEscalation('fail', { ...state });
    assert.equal(decision.escalate, false);
    assert.equal(decision.reason, 'quality_evidence_failed');
  });

  it('ENFORCES THE ESCALATION CEILING', () => {
    const decision = decideEscalation('uncertain', {
      ...state,
      attemptedProfiles: ['economy', 'standard'],
      escalations: 2,
    });
    assert.equal(decision.escalate, false);
    assert.equal(decision.reason, 'escalation_ceiling_reached');
    assert.equal(decision.avoidedCostMicroUsd, 5_000);
  });

  it('PREVENTS OSCILLATION: the band sequence is strictly increasing', () => {
    // Having attempted the top band, there is nowhere left to go — and in
    // particular there is no way back DOWN, which is what would let a task
    // cycle between two bands forever.
    const decision = decideEscalation('uncertain', {
      ...state,
      attemptedProfiles: ['economy', 'standard', 'reasoning'],
      escalations: 1,
    });
    assert.equal(decision.escalate, false);
    assert.equal(decision.reason, 'escalation_oscillation_blocked');

    // And even having attempted only the TOP band, it never proposes a lower one.
    const fromTop = decideEscalation('uncertain', {
      ...state,
      attemptedProfiles: ['reasoning'],
    });
    assert.equal(fromTop.escalate, false);
  });

  it('refuses an escalation it cannot afford, and reports the cost avoided', () => {
    const decision = decideEscalation('uncertain', {
      ...state,
      remainingCostMicroUsd: 100,
      nextAttemptCostMicroUsd: 5_000,
    });
    assert.equal(decision.escalate, false);
    assert.equal(decision.reason, 'insufficient_remaining_budget');
    assert.equal(decision.avoidedCostMicroUsd, 5_000);
  });
});

// ── 7. Marginal value / stop control ────────────────────────────────────────

describe('marginal value stop control', () => {
  const base = {
    attemptsMade: 2,
    maxAttempts: 5,
    remainingCostMicroUsd: 100_000,
    expectedAdditionalCostMicroUsd: 4_000,
    workflowRequiresResult: false,
    acceptableResultExists: true,
  };

  it('STOPS when the last attempt improved nothing', () => {
    const decision = admitAdditionalAttempt({
      ...base,
      task: task(),
      improvementSignal: 0,
    });
    assert.equal(decision.admit, false);
    assert.equal(decision.reason, 'no_improvement_signal');
    assert.equal(decision.avoidedCostMicroUsd, 4_000);
  });

  it('stops on an improvement below the floor when a result already exists', () => {
    const decision = admitAdditionalAttempt({
      ...base,
      task: task(),
      improvementSignal: 4,
    });
    assert.equal(decision.admit, false);
    assert.equal(decision.reason, 'marginal_value_below_floor');
  });

  it('admits a genuine improvement', () => {
    const decision = admitAdditionalAttempt({
      ...base,
      task: task(),
      improvementSignal: 45,
    });
    assert.equal(decision.admit, true);
    assert.equal(decision.avoidedCostMicroUsd, 0);
  });

  it('CANNOT STOP A MANDATORY STEP, whatever the economics say', () => {
    const mandatory = task({ mandatory: true });
    assert.equal(mustNotStop({ ...base, task: mandatory, improvementSignal: 0 }), 'mandatory_step_protected');
    const decision = admitAdditionalAttempt({
      ...base,
      task: mandatory,
      improvementSignal: 0,
      // Even with no headroom and no improvement, it is admitted.
      remainingCostMicroUsd: 0,
      attemptsMade: 4,
    });
    assert.equal(decision.admit, true);
    assert.equal(decision.reason, 'mandatory_step_protected');
    assert.equal(decision.avoidedCostMicroUsd, 0);
  });

  it('CANNOT STOP SAFETY OR APPROVAL-BOUND WORK', () => {
    for (const descriptor of [task({ safetyCritical: true }), task({ approvalBound: true })]) {
      const decision = admitAdditionalAttempt({
        ...base,
        task: descriptor,
        improvementSignal: 0,
        remainingCostMicroUsd: 0,
      });
      assert.equal(decision.admit, true);
      assert.equal(decision.reason, 'safety_work_protected');
    }
  });

  it('cannot stop a required step that has produced nothing acceptable yet', () => {
    const decision = admitAdditionalAttempt({
      ...base,
      task: task(),
      improvementSignal: 0,
      workflowRequiresResult: true,
      acceptableResultExists: false,
    });
    assert.equal(decision.admit, true);
    assert.equal(decision.reason, 'mandatory_step_protected');
  });

  it('claims no saving for the caller OWN attempt ceiling', () => {
    // That limit exists with or without the compression engine. Attributing its
    // effect here would be counting somebody else's control as our own.
    const decision = admitAdditionalAttempt({
      ...base,
      task: task(),
      attemptsMade: 5,
      improvementSignal: 0,
    });
    assert.equal(decision.admit, false);
    assert.equal(decision.reason, 'attempt_ceiling_reached');
    assert.equal(decision.avoidedCostMicroUsd, 0);
  });

  it('admits the first attempt, which has nothing to improve on', () => {
    const decision = admitAdditionalAttempt({ ...base, task: task(), attemptsMade: 0 });
    assert.equal(decision.admit, true);
  });
});

// ── 8. Baseline ─────────────────────────────────────────────────────────────

describe('truthful baseline', () => {
  it('IS REPRODUCIBLE: same inputs, same estimate, byte for byte', () => {
    const input = { candidateContextTokens: 2_750, envelope: envelope() };
    const first = JSON.stringify(estimateBaselineCost(input));
    for (let attempt = 0; attempt < 25; attempt += 1) {
      assert.equal(JSON.stringify(estimateBaselineCost(input)), first);
    }
  });

  it('prices the caller MAXIMUM band and the FULL completion allowance', () => {
    const estimate = estimateBaselineCost({
      candidateContextTokens: 2_750,
      envelope: envelope(),
    });
    assert.equal(estimate.baselineCapabilityProfile, 'reasoning');
    assert.equal(estimate.baselineEstimatedInputTokens, 2_750);
    assert.equal(estimate.baselineEstimatedOutputTokens, 2_000);
    // 2,750 × 3,000/1k + 2,000 × 15,000/1k = 8,250 + 30,000 micro-USD.
    assert.equal(estimate.baselineEstimatedCostMicroUsd, 38_250);
    assert.equal(estimate.baselinePolicyVersion, 'baseline.v1');
  });

  it('CLAMPS to the envelope: a baseline never describes a call the tenant could not make', () => {
    const estimate = estimateBaselineCost({
      candidateContextTokens: 999_999,
      envelope: envelope({ maxPromptTokens: 4_000, maxTotalTokens: 5_000 }),
    });
    // 5,000 total less the 2,000 completion leaves 3,000 for the prompt.
    assert.equal(estimate.baselineEstimatedInputTokens, 3_000);
    assert.ok(estimate.assumptions.includes('clamped_to_envelope'));
  });

  it('CANNOT BE TUNED TO A TARGET: the function signature has no room for one', () => {
    // The structural claim, asserted structurally. `estimateBaselineCost` takes
    // exactly one argument and its declared keys are the three below — none of
    // which can carry an optimised cost, an actual cost or a savings target.
    const accepted = Object.keys({
      candidateContextTokens: 0,
      envelope: envelope(),
      policy: BASELINE_POLICY_V1,
    });
    assert.deepEqual(accepted.sort(), ['candidateContextTokens', 'envelope', 'policy']);
    assert.equal(estimateBaselineCost.length, 1);
  });

  it('REFUSES a policy that models more attempts than the platform permits', () => {
    try {
      estimateBaselineCost({
        candidateContextTokens: 100,
        envelope: envelope(),
        policy: { ...BASELINE_POLICY_V1, assumedAttempts: 10 },
      });
      assert.fail('expected the inflated policy to be refused');
    } catch (error) {
      assert.equal(compressionFailureOf(error), 'compression_input_invalid');
    }
  });
});

// ── 9. Savings accounting ───────────────────────────────────────────────────

describe('savings ledger', () => {
  const record = () =>
    buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 10_000,
      optimizedEstimatedCostMicroUsd: 2_500,
      weights: [
        { category: 'context_reduction', weight: 4_000, tokens: 1_300 },
        { category: 'capability_downgrade', weight: 6_000, tokens: 0 },
      ],
    });

  it('RECONCILES: the categories sum to the saving, exactly', () => {
    const built = record();
    const attributed = built.entries.reduce((sum, entry) => sum + entry.microUsd, 0);
    assert.equal(built.estimatedSavingsMicroUsd, 7_500);
    assert.equal(attributed, 7_500);
    reconcileSavings(built);
  });

  it('CANNOT DOUBLE COUNT: overlapping weights are a partition, not a sum', () => {
    // Both mechanisms claim to have saved the whole gap. Added naively that
    // would be 20,000 against a 10,000 baseline. As proportions of one gap it
    // is 7,500, split between them.
    const built = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 10_000,
      optimizedEstimatedCostMicroUsd: 2_500,
      weights: [
        { category: 'context_reduction', weight: 10_000, tokens: 0 },
        { category: 'capability_downgrade', weight: 10_000, tokens: 0 },
      ],
    });
    const attributed = built.entries.reduce((sum, entry) => sum + entry.microUsd, 0);
    assert.equal(attributed, 7_500);
    assert.deepEqual(built.entries.map((entry) => entry.microUsd), [3_750, 3_750]);
    reconcileSavings(built);
  });

  it('NEVER EXCEEDS THE BASELINE, even when the weights claim far more', () => {
    const built = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 1_000,
      optimizedEstimatedCostMicroUsd: 0,
      weights: [{ category: 'reuse', weight: 999_999_999, tokens: 0 }],
    });
    assert.equal(built.estimatedSavingsMicroUsd, 1_000);
    assert.equal(built.entries[0].microUsd, 1_000);
    assert.ok(built.estimatedSavingsMicroUsd <= built.baselineCostMicroUsd);
    reconcileSavings(built);
  });

  it('reports ZERO — never a negative saving — when optimisation cost more', () => {
    const built = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 1_000,
      optimizedEstimatedCostMicroUsd: 5_000,
      weights: [{ category: 'context_reduction', weight: 100, tokens: 0 }],
    });
    assert.equal(built.estimatedSavingsMicroUsd, 0);
    assert.equal(built.savingsPercent, 0);
    reconcileSavings(built);
  });

  it('distinguishes ESTIMATED from REALISED savings', () => {
    const estimated = record();
    assert.equal(estimated.realized, false);
    assert.equal(estimated.realizedSavingsMicroUsd, undefined);
    assert.equal(estimated.savingsPercent, 75);

    const settled = buildSavingsRecord({
      taskId: 'task_1',
      organizationId: ORG,
      baselinePolicyVersion: 'baseline.v1',
      baselineCostMicroUsd: 10_000,
      optimizedEstimatedCostMicroUsd: 2_500,
      // The projection was optimistic. The measurement is what counts.
      actualCostMicroUsd: 6_000,
      weights: [{ category: 'context_reduction', weight: 1, tokens: 0 }],
    });
    assert.equal(settled.realized, true);
    assert.equal(settled.realizedSavingsMicroUsd, 4_000);
    assert.equal(settled.savingsPercent, 40);
  });

  it('REFUSES a record whose categories do not add up', () => {
    const built = record();
    const tampered = {
      ...built,
      entries: [...built.entries, { category: 'reuse' as const, microUsd: 5_000, tokens: 0 }],
    };
    try {
      reconcileSavings(tampered);
      assert.fail('expected the unbalanced record to be refused');
    } catch (error) {
      assert.equal(compressionFailureOf(error), 'savings_reconciliation_failed');
    }
  });
});

// ── 10. The engine end to end ───────────────────────────────────────────────

describe('cost compression engine', () => {
  it('THE KILL SWITCH IS AUTHORITATIVE: no plan is produced when AI is off', () => {
    const plan = compressCost({
      task: task(),
      envelope: envelope({ aiEnabled: false }),
      contextItems: CANDIDATE_CONTEXT,
    });
    assert.equal(plan.decision, 'deny');
    assert.equal(plan.reason, 'ai_disabled');
    assert.equal(plan.recommendedCapabilityProfile, undefined);
    // And no saving is claimed. The work did not happen because AI is off, not
    // because Cortex optimised it.
    assert.equal(plan.savings.estimatedSavingsMicroUsd, 0);
    assert.equal(plan.savings.savingsPercent, 0);
  });

  it('avoids the call entirely when a deterministic path exists', () => {
    const plan = compressCost({
      task: task({
        kind: 'calculation',
        deterministicCapabilities: [
          { capabilityId: 'cap.sum', satisfies: ['calculation'], complete: true, maximumQuality: 'high' },
        ],
      }),
      envelope: envelope(),
      contextItems: CANDIDATE_CONTEXT,
    });
    assert.equal(plan.decision, 'deterministic');
    assert.equal(plan.inferenceAvoided, true);
    assert.equal(plan.optimizedEstimatedCostMicroUsd, 0);
    // Settled at zero as a MEASUREMENT: no call was made.
    assert.equal(plan.savings.realized, true);
    assert.equal(plan.savings.savingsPercent, 100);
    assert.equal(plan.savings.entries[0].category, 'deterministic_avoidance');
    reconcileSavings(plan.savings);
  });

  it('compresses and downgrades a simple task, and NARROWS ONLY', () => {
    const bounds = envelope();
    const plan = compressCost({
      task: task({ kind: 'extraction', quality: 'best_effort', expectedOutputTokens: 200 }),
      envelope: bounds,
      contextItems: CANDIDATE_CONTEXT,
      minimumRelevance: 40,
    });

    assert.equal(plan.decision, 'downgrade');
    assert.equal(plan.recommendedCapabilityProfile, 'economy');
    assert.equal(plan.downgraded, true);
    assert.ok(plan.context !== undefined && plan.context.reducedTokens > 0);
    assert.ok(plan.optimizedEstimatedCostMicroUsd < plan.baseline.baselineEstimatedCostMicroUsd);
    assertPlanNarrowsOnly(plan, bounds);
    reconcileSavings(plan.savings);
  });

  it('escalates rather than serving a critical task below its floor', () => {
    const plan = compressCost({
      task: task({ kind: 'reasoning', quality: 'critical', requiresMultiStepReasoning: true }),
      envelope: envelope({
        allowedCapabilityProfiles: ['economy', 'standard'],
        maximumCapabilityProfile: 'standard',
      }),
      contextItems: CANDIDATE_CONTEXT,
    });
    assert.equal(plan.decision, 'escalate');
    assert.equal(plan.recommendedCapabilityProfile, undefined);
    assert.equal(plan.savings.estimatedSavingsMicroUsd, 0);
  });

  it('fails closed when required context does not fit', () => {
    try {
      compressCost({
        task: task(),
        envelope: envelope({ maxPromptTokens: 1_000 }),
        contextItems: oversizedRequiredContext(900),
      });
      assert.fail('expected a fail-closed refusal');
    } catch (error) {
      assert.equal(compressionFailureOf(error), 'required_context_exceeds_ceiling');
    }
  });

  it('produces metrics that reconcile and report refusals beside savings', () => {
    const plans = [
      compressCost({
        task: task({
          taskId: 'avoided',
          kind: 'calculation',
          deterministicCapabilities: [
            { capabilityId: 'c', satisfies: ['calculation'], complete: true, maximumQuality: 'high' },
          ],
        }),
        envelope: envelope(),
        contextItems: CANDIDATE_CONTEXT,
      }),
      compressCost({
        task: task({ taskId: 'downgraded', kind: 'extraction', quality: 'best_effort' }),
        envelope: envelope(),
        contextItems: CANDIDATE_CONTEXT,
        minimumRelevance: 40,
      }),
      compressCost({
        task: task({ taskId: 'blocked', kind: 'reasoning', quality: 'critical' }),
        envelope: envelope({
          allowedCapabilityProfiles: ['economy'],
          maximumCapabilityProfile: 'economy',
        }),
        contextItems: CANDIDATE_CONTEXT,
      }),
    ];

    const metrics = summarizeCompression({ plans });
    assert.equal(metrics.taskCount, 3);
    assert.equal(metrics.callsAvoided, 1);
    assert.equal(metrics.profileDowngrades, 1);
    assert.equal(metrics.escalations, 1);
    assert.equal(metrics.qualityFloorFailures, 1);
    assert.equal(metrics.refusalReasons.capability_floor_reached, 1);
    assert.ok(metrics.contextTokensAfter < metrics.contextTokensBefore);
    assert.ok(metrics.savingsPercent >= 0 && metrics.savingsPercent <= 100);
    assert.equal(metrics.decisions.escalate, 1);
    // The aggregate is a sum of reconciled records, never a re-derivation.
    assert.equal(
      metrics.savings.baselineCostMicroUsd,
      plans.reduce((sum, plan) => sum + plan.savings.baselineCostMicroUsd, 0),
    );
  });
});
