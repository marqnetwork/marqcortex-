/**
 * Financial Intelligence (AI-01 Batch 3B, Part 6C).
 *
 * The correctness suite: the canonical event, settlement, target progress,
 * attribution, savings reconciliation, waste, outcomes, the score, burn rate,
 * budgets and the read models. The frauds live in `financialAdversarial.test.ts`,
 * because "does this compute the right number" and "can this be made to publish
 * a false one" want to be read separately.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  abandonSettlement,
  deriveFinancialEvent,
  settleFinancialEvent,
} from '../financial/ledger/financialEventLedger.ts';
import { foldTotals, settlementCoverage } from '../financial/engine/settlement.ts';
import { assessTargetProgress } from '../financial/engine/targetProgress.ts';
import {
  aggregateBy,
  reconcileAttribution,
  assertSavingsBreakdownBalances,
  savingsByCategory,
} from '../financial/engine/attributionEngine.ts';
import { analyzeWaste, retryWasteMicroUsd } from '../financial/engine/wasteAnalysis.ts';
import { analyzeOutcomes, runEconomics } from '../financial/engine/outcomeEconomics.ts';
import { scoreOptimization, CAP_ON_VIOLATION } from '../financial/engine/optimizationScore.ts';
import { projectBurn } from '../financial/engine/burnRate.ts';
import { reportBudgetUtilization } from '../financial/engine/budgetUtilization.ts';
import { createInMemoryFinancialEventStore } from '../financial/persistence/ports.ts';
import {
  costByDimension,
  financialSummary,
  outcomeEconomics,
  platformFinancialSummary,
  reuseEconomics,
  targetProgress,
} from '../financial/service/financialReadModels.ts';
import { isFinancialError } from '../financial/contracts/failures.ts';
import { ATTRIBUTION_DIMENSIONS, UNATTRIBUTED } from '../financial/contracts/attribution.ts';
import type { FinancialEvent } from '../financial/contracts/event.ts';

import {
  ACTOR,
  CONTEXT,
  DAY,
  NOW,
  ORG,
  OTHER_ORG,
  WINDOW,
  context,
  envelope,
  event,
  pendingEvent,
  plan,
  reusePlan,
  scenario,
  syntheticEvent,
  task,
} from './financialFixtures.ts';

async function storeWith(...events: readonly FinancialEvent[]) {
  const store = createInMemoryFinancialEventStore();
  for (const entry of events) await store.append(entry);
  return store;
}

// ── The canonical event ─────────────────────────────────────────────────────

describe('Part 6C — the canonical financial event', () => {
  it('derives every figure from the Part 6A plan rather than from a caller', () => {
    const compression = plan();
    const derived = event({}, compression);

    assert.equal(derived.baselineCostMicroUsd, compression.savings.baselineCostMicroUsd);
    assert.equal(derived.estimatedSavingsMicroUsd, compression.savings.estimatedSavingsMicroUsd);
    assert.equal(derived.baselinePolicyVersion, compression.baseline.baselinePolicyVersion);
    assert.deepEqual(derived.savingsEntries, compression.savings.entries);
    assert.equal(derived.baselineTokens, compression.baseline.baselineEstimatedTotalTokens);
  });

  it('derives the same id from the same identity, so re-derivation adds nothing', async () => {
    const first = event();
    const second = event();
    assert.equal(first.eventId, second.eventId);

    const store = createInMemoryFinancialEventStore();
    assert.equal((await store.append(first)).stored, true);
    assert.equal((await store.append(second)).stored, false);

    const page = await store.list({ organizationId: ORG, window: WINDOW });
    assert.equal(page.events.length, 1);
  });

  it('gives a different identity to a different attempt, node, branch or run', () => {
    const base = event().eventId;
    const variants = [
      event({ retryAttempt: 2 }),
      event({ nodeId: 'node_other' }),
      event({ branchId: 'branch_b' }),
      event({ workflowRunId: 'wfr_002' }),
      event({ agentRunId: 'ar_002' }),
    ];
    for (const variant of variants) {
      assert.notEqual(variant.eventId, base, 'a distinct piece of spend needs a distinct id');
    }
  });

  it('classifies an avoided call as settled by measured absence', () => {
    const avoided = deriveFinancialEvent(reusePlan(), context());
    assert.equal(avoided.eventType, 'avoided_call');
    assert.equal(avoided.settlementState, 'settled');
    assert.equal(avoided.settlementBasis, 'measured_absence');
    assert.equal(avoided.actualCostMicroUsd, 0);
    assert.equal(avoided.realizedSavingsMicroUsd, avoided.baselineCostMicroUsd);
  });

  it('claims nothing at all for a refusal', () => {
    const refused = deriveFinancialEvent(
      plan({ envelope: envelope({ aiEnabled: false }) }),
      context(),
    );
    assert.equal(refused.eventType, 'refused');
    assert.equal(refused.settlementState, 'not_applicable');
    assert.equal(refused.baselineCostMicroUsd, 0);
    assert.equal(refused.estimatedSavingsMicroUsd, 0);
    assert.deepEqual(refused.savingsEntries, []);
  });

  it('carries no prompt, completion, credential or tool payload', () => {
    const serialized = JSON.stringify(event());
    for (const forbidden of [
      'apiKey',
      'authorization',
      'messages',
      'completion',
      'promptText',
      'rawResponse',
    ]) {
      assert.equal(serialized.includes(forbidden), false, `an event must not carry ${forbidden}`);
    }
  });
});

// ── Financial truth: estimated, realised, unsettled ─────────────────────────

describe('Part 6C — estimated and realised never mix', () => {
  it('leaves a pending event out of both the realised numerator and its denominator', () => {
    const settled = event();
    const pending = pendingEvent({ workflowRunId: 'wfr_pending', agentRunId: 'ar_pending' });
    const totals = foldTotals([settled, pending]);

    assert.equal(pending.actualCostMicroUsd, undefined, 'unsettled cost must be absent, not zero');
    assert.equal(totals.actualSettledCostMicroUsd, settled.actualCostMicroUsd);
    assert.equal(totals.realizedBaselineCostMicroUsd, settled.baselineCostMicroUsd);
    // The pending event's baseline IS in the window baseline — the work was real.
    assert.equal(
      totals.baselineCostMicroUsd,
      settled.baselineCostMicroUsd + pending.baselineCostMicroUsd,
    );
  });

  it('reports a terminal unsettled event as permanently unknown cost', () => {
    const abandoned = abandonSettlement(
      pendingEvent({ workflowRunId: 'wfr_abandoned', agentRunId: 'ar_abandoned' }),
    );
    assert.equal(abandoned.settlementState, 'unsettled_terminal');

    const totals = foldTotals([abandoned]);
    assert.equal(totals.unknownCostBaselineMicroUsd, abandoned.baselineCostMicroUsd);
    assert.equal(totals.actualSettledCostMicroUsd, 0);
    assert.equal(totals.realizedSavingsMicroUsd, 0);
    assert.equal(totals.realizedBaselineCostMicroUsd, 0);
  });

  it('computes coverage over what was expected to settle, excluding refusals', () => {
    const refused = deriveFinancialEvent(
      plan({ envelope: envelope({ aiEnabled: false }) }),
      context({ workflowRunId: 'wfr_refused', agentRunId: 'ar_refused' }),
    );
    const coverage = settlementCoverage([
      event(),
      pendingEvent({ workflowRunId: 'wfr_p1', agentRunId: 'ar_p1' }),
      refused,
    ]);

    assert.equal(coverage.expectedToSettle, 2);
    assert.equal(coverage.settled, 1);
    assert.equal(coverage.pending, 1);
    assert.equal(coverage.notApplicable, 1);
    assert.equal(coverage.coveragePercent, 50);
    assert.equal(coverage.coverageWarning, true);
  });

  it('does not call an empty window fully covered', () => {
    const coverage = settlementCoverage([]);
    assert.equal(coverage.coveragePercent, 0);
    assert.equal(coverage.coverageWarning, true);
  });

  it('settles exactly once and refuses a second report', () => {
    const pending = pendingEvent({ workflowRunId: 'wfr_s', agentRunId: 'ar_s' });
    const settled = settleFinancialEvent(pending, { actualCostMicroUsd: 3_000, actualTokens: 700 });

    assert.equal(settled.settlementState, 'settled');
    assert.equal(settled.settlementBasis, 'provider_reported');
    assert.equal(settled.realizedSavingsMicroUsd, settled.baselineCostMicroUsd - 3_000);
    // The baseline and the savings story are unchanged. What arrived is a
    // measurement, not a new explanation of why the saving happened.
    assert.equal(settled.baselineCostMicroUsd, pending.baselineCostMicroUsd);
    assert.deepEqual(settled.savingsEntries, pending.savingsEntries);

    assert.throws(
      () => settleFinancialEvent(settled, { actualCostMicroUsd: 3_000, actualTokens: 700 }),
      (error: unknown) => isFinancialError(error) && error.failure === 'financial_event_conflict',
    );
  });
});

// ── The 90% target ──────────────────────────────────────────────────────────

describe('Part 6C — 90% target progress', () => {
  it('reports exactly 90% and marks it achieved', () => {
    const progress = assessTargetProgress(
      scenario({ prefix: 'b', count: 30, settledCount: 30, baselineMicroUsd: 100_000, actualMicroUsd: 10_000 }),
    );
    assert.equal(progress.realizedReductionPercent, 90);
    assert.equal(progress.achieved, true);
    assert.equal(progress.assessment, 'target_met_on_settled_data');
    assert.equal(progress.coverageWarning, false);
  });

  it('does NOT round 89.9% into an achieved target', () => {
    const progress = assessTargetProgress(
      scenario({ prefix: 'c', count: 30, settledCount: 30, baselineMicroUsd: 100_000, actualMicroUsd: 10_100 }),
    );
    assert.equal(progress.realizedReductionPercent, 89.9);
    assert.equal(progress.achieved, false);
    assert.equal(progress.assessment, 'below_target_on_settled_data');
  });

  it('does not let a value that DISPLAYS as 90.0 become achieved', () => {
    // 89.95% — rounds to 90.0 for display, and must not clear the target.
    const progress = assessTargetProgress(
      scenario({ prefix: 'edge', count: 20, settledCount: 20, baselineMicroUsd: 200_000, actualMicroUsd: 20_100 }),
    );
    assert.equal(progress.realizedReductionPercent, 90);
    assert.equal(
      progress.achieved,
      false,
      'achievement must be decided on integers, before rounding',
    );
  });

  it('reports the realised figure when the estimate is far more flattering', () => {
    // Estimated 90%, realised 45%: the optimiser projected a large saving and the
    // provider reported otherwise. The headline is the measurement.
    const events = Array.from({ length: 20 }, (_, index) =>
      syntheticEvent({
        eventId: `d_${index}`,
        baselineMicroUsd: 100_000,
        actualMicroUsd: 55_000,
        occurredAt: NOW - 10 * DAY,
        workflowRunId: `wfr_d_${index}`,
      }),
    ).map((base) => ({
      ...base,
      // The plan projected 10,000; the invoice said 55,000.
      optimizedEstimatedCostMicroUsd: 10_000,
      estimatedSavingsMicroUsd: 90_000,
      savingsEntries: [{ category: 'context_reduction' as const, microUsd: 90_000, tokens: 0 }],
    }));

    const progress = assessTargetProgress(events);
    assert.equal(progress.estimatedReductionPercent, 90);
    assert.equal(progress.realizedReductionPercent, 45);
    assert.equal(progress.achieved, false);
  });

  it('refuses to call the target met on thin settlement coverage', () => {
    // The settled fifth realises 90%. That is a fact about the fifth.
    const progress = assessTargetProgress(
      scenario({ prefix: 'e', count: 25, settledCount: 5, baselineMicroUsd: 100_000, actualMicroUsd: 10_000 }),
    );
    assert.equal(progress.realizedReductionPercent, 90);
    assert.equal(progress.coverage.coveragePercent, 20);
    assert.equal(progress.coverageWarning, true);
    assert.equal(progress.achieved, false);
    assert.equal(progress.assessment, 'insufficient_settlement_coverage');
  });

  it('reports no settled data rather than a zero reduction', () => {
    const progress = assessTargetProgress(
      scenario({ prefix: 'none', count: 5, settledCount: 0, baselineMicroUsd: 100_000, actualMicroUsd: 0 }),
    );
    assert.equal(progress.assessment, 'no_settled_data');
    assert.equal(progress.achieved, false);
    assert.equal(progress.realizedBaselineCostMicroUsd, 0);
  });

  it('separates realised saving that came from absence from saving on an invoice', () => {
    const avoided = deriveFinancialEvent(reusePlan(), context());
    const paid = event({ workflowRunId: 'wfr_paid', agentRunId: 'ar_paid' });
    const progress = assessTargetProgress([avoided, paid]);

    assert.ok(progress.realizedFromAbsencePercent > 0);
    assert.ok(progress.realizedFromAbsencePercent <= 100);
  });
});

// ── Attribution ─────────────────────────────────────────────────────────────

describe('Part 6C — attribution', () => {
  const events = [
    event({ workflowId: 'wf_a', workflowRunId: 'wfr_1', nodeId: 'n1', agentId: 'agent_x', agentRunId: 'ar_1' }),
    event({ workflowId: 'wf_a', workflowRunId: 'wfr_1', nodeId: 'n2', agentId: 'agent_y', agentRunId: 'ar_2' }),
    event({ workflowId: 'wf_b', workflowRunId: 'wfr_2', nodeId: 'n1', agentId: 'agent_x', agentRunId: 'ar_3', branchId: 'branch_a' }),
    event({ workflowId: 'wf_b', workflowRunId: 'wfr_2', nodeId: 'n1', agentId: 'agent_x', agentRunId: 'ar_4', retryAttempt: 2 }),
  ];

  it('partitions every dimension so its buckets sum to the window total', () => {
    const expected = foldTotals(events);
    for (const dimension of ATTRIBUTION_DIMENSIONS) {
      const aggregate = aggregateBy(events, dimension);
      reconcileAttribution(aggregate);
      assert.deepEqual(
        aggregate.totals,
        expected,
        `${dimension} must report the same window total as every other dimension`,
      );
      const summed = aggregate.buckets.reduce(
        (total, bucket) => total + bucket.totals.actualSettledCostMicroUsd,
        0,
      );
      assert.equal(summed, expected.actualSettledCostMicroUsd, `${dimension} buckets must sum`);
    }
  });

  it('attributes by workflow, node, branch, agent, provider, model and retry', () => {
    const byWorkflow = aggregateBy(events, 'workflow');
    assert.deepEqual(byWorkflow.buckets.map((bucket) => bucket.key).sort(), ['wf_a', 'wf_b']);

    const byNode = aggregateBy(events, 'node');
    // Node keys are scoped by workflow: `n1` in two workflows is two nodes.
    assert.deepEqual(byNode.buckets.map((bucket) => bucket.key).sort(), [
      'wf_a/n1',
      'wf_a/n2',
      'wf_b/n1',
    ]);

    const byBranch = aggregateBy(events, 'branch');
    assert.ok(byBranch.buckets.some((bucket) => bucket.key === 'branch_a'));
    assert.ok(byBranch.buckets.some((bucket) => bucket.key === UNATTRIBUTED));

    assert.deepEqual(aggregateBy(events, 'agent').buckets.map((b) => b.key).sort(), [
      'agent_x',
      'agent_y',
    ]);
    assert.deepEqual(aggregateBy(events, 'provider').buckets.map((b) => b.key), ['provider_a']);
    assert.deepEqual(aggregateBy(events, 'model').buckets.map((b) => b.key), [
      'provider_a/model_small',
    ]);
    assert.deepEqual(aggregateBy(events, 'retry_attempt').buckets.map((b) => b.key).sort(), [
      '1',
      '2',
    ]);
  });

  it('keeps events a dimension does not apply to in a visible bucket', () => {
    const byBranch = aggregateBy(events, 'branch');
    const unattributed = byBranch.buckets.find((bucket) => bucket.key === UNATTRIBUTED);
    assert.ok(unattributed, 'events without a branch must be visible, not dropped');
    assert.equal(unattributed.totals.events, 3);
  });
});

// ── Savings reconciliation ──────────────────────────────────────────────────

describe('Part 6C — savings reconciliation', () => {
  it('reads Part 6A categories and refuses a breakdown that does not balance', () => {
    const events = [event(), event({ workflowRunId: 'wfr_2', agentRunId: 'ar_2' })];
    assertSavingsBreakdownBalances(events);

    const byCategory = savingsByCategory(events);
    const attributed = Object.values(byCategory).reduce((sum, entry) => sum + entry.microUsd, 0);
    assert.equal(attributed, foldTotals(events).estimatedSavingsMicroUsd);
  });

  it('records reuse savings under the reuse category', () => {
    const avoided = deriveFinancialEvent(reusePlan(), context());
    const byCategory = savingsByCategory([avoided]);
    assert.ok((byCategory.reuse?.microUsd ?? 0) > 0);
    assertSavingsBreakdownBalances([avoided]);
  });

  it('records deterministic avoidance under its own category', () => {
    const deterministic = deriveFinancialEvent(
      plan({
        task: task({
          taskId: 'task_det',
          deterministicCapabilities: [
            {
              capabilityId: 'cap_lookup',
              satisfies: ['summarization'],
              complete: true,
              maximumQuality: 'high',
            },
          ],
        }),
      }),
      context(),
    );
    assert.equal(deterministic.eventType, 'avoided_call');
    const byCategory = savingsByCategory([deterministic]);
    assert.ok((byCategory.deterministic_avoidance?.microUsd ?? 0) > 0);
  });

  it('records compression and routing savings when inference happened', () => {
    const compressed = event();
    const categories = Object.keys(savingsByCategory([compressed]));
    assert.ok(
      categories.some((category) =>
        ['context_reduction', 'capability_downgrade', 'output_budget_reduction'].includes(category),
      ),
      'an optimised inference must name where its saving came from',
    );
  });
});

// ── Waste ───────────────────────────────────────────────────────────────────

describe('Part 6C — waste analysis', () => {
  it('separates a retry that rescued a run from one that did not', () => {
    const report = analyzeWaste([
      event({ workflowRunId: 'wfr_ok', agentRunId: 'ar_ok', retryAttempt: 2, outcome: 'succeeded' }),
      event({ workflowRunId: 'wfr_bad', agentRunId: 'ar_bad', retryAttempt: 2, outcome: 'failed' }),
    ]);
    const categories = report.entries.map((entry) => entry.category).sort();
    assert.deepEqual(categories, ['failed_retry', 'recovered_retry']);
    assert.ok(retryWasteMicroUsd(report) > 0);
  });

  it('never labels required safety or approval work as waste', () => {
    const report = analyzeWaste([
      event({
        workflowRunId: 'wfr_safety',
        agentRunId: 'ar_safety',
        retryAttempt: 3,
        outcome: 'failed',
        protectedWork: true,
      }),
    ]);
    assert.deepEqual(report.entries, []);
    assert.equal(report.protectedEventsExcluded, 1);
    assert.ok(report.protectedSettledCostMicroUsd > 0);
  });

  it('classifies discarded branches, unimproved escalations, cancellation and invalidation', () => {
    const events = [
      event({ workflowRunId: 'wfr_1', agentRunId: 'ar_branch', branchId: 'branch_lost' }),
      event({ workflowRunId: 'wfr_2', agentRunId: 'ar_esc' }),
      event({ workflowRunId: 'wfr_3', agentRunId: 'ar_cancel', outcome: 'cancelled' }),
    ];
    const report = analyzeWaste(events, {
      discardedBranchIds: ['branch_lost'],
      unimprovedEscalationAgentRunIds: ['ar_esc'],
    });
    const categories = report.entries.map((entry) => entry.category).sort();
    assert.deepEqual(categories, ['discarded_branch', 'pre_cancellation', 'unimproved_escalation']);
  });

  it('keeps its categories disjoint, so total waste cannot exceed the spend', () => {
    const events = [
      event({ workflowRunId: 'wfr_1', agentRunId: 'ar_1', retryAttempt: 2, outcome: 'cancelled', branchId: 'b1' }),
    ];
    const report = analyzeWaste(events, { discardedBranchIds: ['b1'] });
    assert.equal(report.entries.length, 1, 'one event must land in exactly one category');
    assert.ok(report.totalWasteSettledMicroUsd <= foldTotals(events).actualSettledCostMicroUsd);
  });

  it('reports unsettled waste as a baseline rather than guessing at it', () => {
    const report = analyzeWaste([
      pendingEvent({ workflowRunId: 'wfr_p', agentRunId: 'ar_p', retryAttempt: 2 }),
    ]);
    const entry = report.entries[0];
    assert.ok(entry);
    assert.equal(entry.actualSettledCostMicroUsd, 0);
    assert.ok(entry.unsettledBaselineMicroUsd > 0);
  });
});

// ── Outcomes ────────────────────────────────────────────────────────────────

describe('Part 6C — cost per outcome', () => {
  const events = [
    syntheticEvent({ eventId: 'o1', baselineMicroUsd: 100_000, actualMicroUsd: 10_000, workflowRunId: 'r1', outcome: 'succeeded' }),
    syntheticEvent({ eventId: 'o2', baselineMicroUsd: 100_000, actualMicroUsd: 20_000, workflowRunId: 'r2', outcome: 'succeeded' }),
    syntheticEvent({ eventId: 'o3', baselineMicroUsd: 100_000, actualMicroUsd: 30_000, workflowRunId: 'r3', outcome: 'failed' }),
    syntheticEvent({ eventId: 'o4', baselineMicroUsd: 100_000, actualMicroUsd: 6_000, workflowRunId: 'r3', outcome: 'failed', retryAttempt: 2 }),
  ];

  it('divides successful spend by successful runs, and failed by failed', () => {
    const economics = analyzeOutcomes(events);
    assert.equal(economics.runs, 3);
    assert.equal(economics.successfulRuns, 2);
    assert.equal(economics.failedRuns, 1);
    assert.equal(economics.costPerSuccessfulRunMicroUsd, 15_000);
    assert.equal(economics.costPerFailedRunMicroUsd, 36_000);
  });

  it('charges failed spend against the successes, so failure cannot look cheap', () => {
    const economics = analyzeOutcomes(events);
    // All terminal spend (66,000) over 2 successes.
    assert.equal(economics.costPerCompletedOutcomeMicroUsd, 33_000);
    assert.ok(
      economics.costPerCompletedOutcomeMicroUsd > economics.costPerSuccessfulRunMicroUsd,
      'the cost of failure has to land somewhere',
    );
  });

  it('reports retry cost per success and the success rate', () => {
    const economics = analyzeOutcomes(events);
    assert.equal(economics.retryCostPerSuccessMicroUsd, 3_000);
    assert.equal(economics.successRatePercent, 66.7);
  });

  it('groups a run’s spend by the run, not by each event’s own outcome', () => {
    const runs = runEconomics(events);
    // r3's two events — the first attempt and the retry — are ONE failed run
    // carrying both costs. Classifying each event separately would split one
    // run's spend across buckets and charge part of it to the wrong outcome.
    const failedRun = runs.find((run) => run.workflowRunId === 'r3');
    assert.ok(failedRun);
    assert.equal(failedRun.outcome, 'failed');
    assert.equal(failedRun.actualSettledCostMicroUsd, 36_000);
    assert.equal(failedRun.retrySettledCostMicroUsd, 6_000);
    assert.equal(runs.length, 3, 'four events over three runs');
  });

  it('detects high-cost outliers by a declared multiple of the median', () => {
    const many = [
      ...Array.from({ length: 6 }, (_, index) =>
        syntheticEvent({
          eventId: `n${index}`,
          baselineMicroUsd: 20_000,
          actualMicroUsd: 2_000,
          workflowRunId: `run_${index}`,
        }),
      ),
      syntheticEvent({ eventId: 'whale', baselineMicroUsd: 900_000, actualMicroUsd: 400_000, workflowRunId: 'run_whale' }),
    ];
    const economics = analyzeOutcomes(many);
    assert.equal(economics.outlierDetectionApplied, true);
    assert.deepEqual(economics.highCostRuns.map((run) => run.workflowRunId), ['run_whale']);
  });

  it('does not detect outliers from too few runs to have a median', () => {
    const economics = analyzeOutcomes(events);
    assert.equal(economics.outlierDetectionApplied, false);
    assert.deepEqual(economics.highCostRuns, []);
  });

  it('flags runs whose spend only partly settled', () => {
    const economics = analyzeOutcomes([
      event({ workflowRunId: 'wfr_mix', agentRunId: 'ar_a' }),
      pendingEvent({ workflowRunId: 'wfr_mix', agentRunId: 'ar_b' }),
    ]);
    assert.equal(economics.partiallySettledRuns, 1);
  });
});

// ── The optimisation score ──────────────────────────────────────────────────

describe('Part 6C — the optimisation score', () => {
  const efficient = scenario({
    prefix: 'score_good',
    count: 30,
    settledCount: 30,
    baselineMicroUsd: 100_000,
    actualMicroUsd: 12_000,
  });

  it('is deterministic and versioned', () => {
    const first = scoreOptimization({ events: efficient });
    const second = scoreOptimization({ events: efficient });
    assert.equal(first.score, second.score);
    assert.deepEqual(first.components, second.components);
    assert.equal(first.scoreVersion, 'ai.financial.score.v1');
  });

  it('returns a component breakdown that accounts for the score', () => {
    const scored = scoreOptimization({ events: efficient });
    const summed = scored.components.reduce((total, component) => total + component.points, 0);
    assert.equal(scored.uncappedScore, Math.min(100, summed));
    assert.equal(scored.components.length, 8);
  });

  it('scores a successful, efficient, fully settled window well', () => {
    const scored = scoreOptimization({ events: efficient });
    assert.ok(scored.score >= 60, `expected a strong score, got ${scored.score}`);
    assert.equal(scored.capped, false);
    assert.equal(scored.confidence, 'measured');
  });

  it('caps the score when the quality contract failed, however cheap the run', () => {
    const scored = scoreOptimization({
      events: efficient,
      quality: { qualityContractFailed: true },
    });
    assert.ok(scored.score <= CAP_ON_VIOLATION);
    assert.equal(scored.capped, true);
    assert.ok(scored.reasons.includes('quality_contract_failed'));
  });

  it('caps the score for removed required context or weakened safety', () => {
    for (const violation of [
      { requiredContextRemoved: true },
      { safetyPolicyWeakened: true },
      { workflowFailedAfterOptimization: true },
    ]) {
      const scored = scoreOptimization({ events: efficient, quality: violation });
      assert.ok(scored.score <= CAP_ON_VIOLATION, JSON.stringify(violation));
    }
  });

  it('does not reward a cheap window whose runs failed', () => {
    const cheapFailures = scenario({
      prefix: 'score_fail',
      count: 30,
      settledCount: 30,
      baselineMicroUsd: 100_000,
      actualMicroUsd: 1_000,
      outcome: 'failed',
    });
    const failed = scoreOptimization({ events: cheapFailures });
    const succeeded = scoreOptimization({ events: efficient });
    assert.ok(
      failed.score < succeeded.score,
      'saving 99% by failing must not beat saving 88% by succeeding',
    );
  });

  it('caps a window with nothing settled', () => {
    const unsettled = scenario({
      prefix: 'score_unsettled',
      count: 10,
      settledCount: 0,
      baselineMicroUsd: 100_000,
      actualMicroUsd: 0,
    });
    const scored = scoreOptimization({ events: unsettled });
    assert.ok(scored.score <= CAP_ON_VIOLATION);
    assert.ok(scored.reasons.includes('no_settled_data'));
    assert.equal(scored.confidence, 'insufficient');
  });
});

// ── Burn rate ───────────────────────────────────────────────────────────────

describe('Part 6C — burn rate projection', () => {
  const events = scenario({
    prefix: 'burn',
    count: 30,
    settledCount: 30,
    baselineMicroUsd: 100_000,
    actualMicroUsd: 10_000,
  });

  it('projects daily, weekly and monthly from the measured rate', () => {
    const projection = projectBurn(events, WINDOW);
    assert.equal(projection.isEstimate, true);
    assert.equal(projection.settledCostMicroUsd, 300_000);
    assert.equal(projection.weeklyBurnMicroUsd, projection.dailyBurnMicroUsd * 7);
    assert.equal(projection.monthlyBurnMicroUsd, projection.dailyBurnMicroUsd * 30);
    assert.ok(projection.projectedMonthlyBaselineMicroUsd > projection.monthlyBurnMicroUsd);
  });

  it('marks the sample sufficient only on a long enough window with enough events', () => {
    assert.equal(projectBurn(events, WINDOW).sufficientSample, true);

    const shortWindow = { fromMs: NOW - 2 * DAY, toMs: NOW };
    const small = scenario({
      prefix: 'small',
      count: 3,
      settledCount: 3,
      baselineMicroUsd: 100_000,
      actualMicroUsd: 10_000,
    });
    const projection = projectBurn(small, shortWindow);
    assert.equal(projection.sufficientSample, false);
    assert.equal(projection.sampleSize, 3);
    // The arithmetic is still returned. The confidence is what is withheld.
    assert.ok(projection.monthlyBurnMicroUsd > 0);
  });

  it('surfaces coverage beside the projection', () => {
    const partial = scenario({
      prefix: 'burn_partial',
      count: 30,
      settledCount: 6,
      baselineMicroUsd: 100_000,
      actualMicroUsd: 10_000,
    });
    const projection = projectBurn(partial, WINDOW);
    assert.equal(projection.coverage.coveragePercent, 20);
    assert.equal(projection.coverage.coverageWarning, true);
  });
});

// ── Budgets ─────────────────────────────────────────────────────────────────

describe('Part 6C — budget utilisation is read-only', () => {
  it('computes utilisation, headroom and overshoot from snapshots', () => {
    const report = reportBudgetUtilization({
      organizationId: ORG,
      organization: {
        scope: 'budget:org:org_acme',
        spentMicroUsd: 750_000,
        limitMicroUsd: 1_000_000,
        windowResetsAt: NOW + DAY,
      },
      actors: [
        { scope: 'budget:actor:org_acme:user_analyst', spentMicroUsd: 110_000, limitMicroUsd: 100_000, windowResetsAt: NOW + DAY },
      ],
      platform: {
        capMicroUsd: 10_000_000,
        spentMicroUsd: 4_000_000,
        reservedMicroUsd: 1_000_000,
        lifetimeSpentMicroUsd: 22_000_000,
        enforced: true,
      },
      budgetDeniedCalls: 3,
      budgetExhaustedWorkflows: 1,
    });

    assert.equal(report.organization?.utilizationPercent, 75);
    assert.equal(report.organization?.remainingMicroUsd, 250_000);
    // A bounded overshoot is expected of a check-then-charge engine, and is
    // reported rather than hidden inside a clamped percentage.
    assert.equal(report.actors[0].utilizationPercent, 100);
    assert.equal(report.actors[0].overshootMicroUsd, 10_000);
    // Reservations count towards utilisation: money held cannot fund anything else.
    assert.equal(report.platform?.utilizationPercent, 50);
    assert.equal(report.platform?.remainingMicroUsd, 5_000_000);
    assert.equal(report.budgetDeniedCalls, 3);
    assert.equal(report.budgetExhaustedWorkflows, 1);
  });

  it('refuses a budget report with no organization', () => {
    assert.throws(
      () => reportBudgetUtilization({ organizationId: '' }),
      (error: unknown) => isFinancialError(error) && error.failure === 'financial_tenant_mismatch',
    );
  });
});

// ── Read models ─────────────────────────────────────────────────────────────

describe('Part 6C — read models', () => {
  it('summarises a tenant’s window with its coverage and savings breakdown', async () => {
    const store = await storeWith(
      event(),
      event({ workflowRunId: 'wfr_2', agentRunId: 'ar_2' }),
      pendingEvent({ workflowRunId: 'wfr_3', agentRunId: 'ar_3' }),
    );
    const summary = await financialSummary(store, { organizationId: ORG, window: WINDOW });

    assert.equal(summary.organizationId, ORG);
    assert.equal(summary.totals.events, 3);
    assert.equal(summary.coverage.expectedToSettle, 3);
    assert.equal(summary.coverage.settled, 2);
    assert.equal(summary.truncated, false);
    assert.ok(Object.keys(summary.savingsByCategoryMicroUsd).length > 0);
  });

  it('returns target progress, cost by dimension, outcomes and reuse economics', async () => {
    const store = await storeWith(
      deriveFinancialEvent(reusePlan('task_r1'), context({ agentRunId: 'ar_r1', workflowRunId: 'wfr_r1' })),
      event({ workflowRunId: 'wfr_p1', agentRunId: 'ar_p1' }),
    );
    const scope = { organizationId: ORG, window: WINDOW };

    assert.ok((await targetProgress(store, scope)).realizedReductionPercent >= 0);
    assert.equal((await costByDimension(store, scope, 'workflow')).dimension, 'workflow');
    assert.equal((await outcomeEconomics(store, scope)).runs, 2);

    const reuse = await reuseEconomics(store, scope);
    assert.equal(reuse.avoidedCalls, 1);
    assert.equal(reuse.eligibleOperations, 2);
    assert.equal(reuse.avoidanceRatePercent, 50);
    assert.ok(reuse.realizedSavingsFromReuseMicroUsd > 0);
  });

  it('never returns another tenant’s events', async () => {
    const mine = event();
    const theirs = syntheticEvent({
      eventId: 'theirs',
      baselineMicroUsd: 500_000,
      actualMicroUsd: 400_000,
      organizationId: OTHER_ORG,
    });
    const store = await storeWith(mine, theirs);

    const summary = await financialSummary(store, { organizationId: ORG, window: WINDOW });
    assert.equal(summary.totals.events, 1);
    assert.equal(summary.totals.actualSettledCostMicroUsd, mine.actualCostMicroUsd);
    assert.equal(await store.getById(ORG, 'theirs'), undefined);
  });

  it('requires platform authority for a platform-wide aggregate', async () => {
    const store = await storeWith(
      event(),
      syntheticEvent({ eventId: 'x', baselineMicroUsd: 100_000, actualMicroUsd: 10_000, organizationId: OTHER_ORG }),
    );

    await assert.rejects(
      async () =>
        await platformFinancialSummary(
          store,
          { granted: false, authorizationEvidenceId: '' },
          [ORG, OTHER_ORG],
          WINDOW,
        ),
      (error: unknown) => isFinancialError(error) && error.failure === 'financial_authority_required',
    );

    const granted = await platformFinancialSummary(
      store,
      { granted: true, authorizationEvidenceId: 'rbac_platform_1' },
      [ORG, OTHER_ORG],
      WINDOW,
    );
    assert.equal(granted.organizations, 2);
    assert.equal(granted.totals.events, 2);
  });

  it('refuses an unusable window rather than defaulting one', async () => {
    const store = await storeWith(event());
    await assert.rejects(
      async () =>
        await financialSummary(store, {
          organizationId: ORG,
          window: { fromMs: NOW, toMs: NOW - DAY },
        }),
      (error: unknown) => isFinancialError(error) && error.failure === 'financial_input_invalid',
    );
  });

  it('reports truncation, so a total over a capped scan is never silent', async () => {
    const store = createInMemoryFinancialEventStore();
    for (let index = 0; index < 5; index += 1) {
      await store.append(
        syntheticEvent({
          eventId: `t${index}`,
          baselineMicroUsd: 10_000,
          actualMicroUsd: 1_000,
          workflowRunId: `wfr_t${index}`,
        }),
      );
    }
    const page = await store.list({ organizationId: ORG, window: WINDOW, limit: 2 });
    assert.equal(page.events.length, 2);
    assert.equal(page.truncated, true);
  });

  it('settles through the store exactly once', async () => {
    const pending = pendingEvent({ workflowRunId: 'wfr_store', agentRunId: 'ar_store' });
    const store = await storeWith(pending);
    const settled = settleFinancialEvent(pending, { actualCostMicroUsd: 2_500, actualTokens: 500 });

    assert.equal(await store.settle(settled), true);
    assert.equal(await store.settle(settled), false, 'a duplicate report must not settle twice');

    const summary = await financialSummary(store, { organizationId: ORG, window: WINDOW });
    assert.equal(summary.totals.actualSettledCostMicroUsd, 2_500);
    assert.equal(summary.coverage.coveragePercent, 100);
  });
});
