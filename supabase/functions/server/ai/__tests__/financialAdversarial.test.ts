/**
 * Adversarial financial accounting (AI-01 Batch 3B, Part 6C).
 *
 * ── THE QUESTION THIS SUITE ASKS ───────────────────────────────────────────
 *
 * `financialIntelligence.test.ts` asks whether the engine computes the right
 * numbers. This asks whether it can be made to publish a false one.
 *
 * Part 6C is the layer that finally SAYS how much Cortex saved. Everything
 * before it produced facts under its own controls; this is where those facts
 * become a percentage somebody quotes in a board pack. That makes it the layer
 * with the most to gain from a flattering error and the least external check on
 * one — an avoided call has no invoice, an unsettled call has no invoice yet,
 * and a 90% claim is not something a provider bill contradicts.
 *
 * Eight specific frauds are attempted below. Each produces a plausible,
 * defensible-looking number, and each is refused:
 *
 *   1. Drop the actual cost and let the estimate stand in for it.
 *   2. Exclude retries from the spend while keeping their savings.
 *   3. Count reuse savings twice — once from Part 6A's category and once from
 *      the avoided events' baselines.
 *   4. Mix estimated and realised values in one ratio.
 *   5. Exclude failed runs from the baseline while keeping their savings.
 *   6. Treat unsettled spend as zero.
 *   7. Round 89.95% into a target achieved.
 *   8. Sum two attribution dimensions and report the result as total spend.
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
import { analyzeWaste } from '../financial/engine/wasteAnalysis.ts';
import { analyzeOutcomes } from '../financial/engine/outcomeEconomics.ts';
import { scoreOptimization } from '../financial/engine/optimizationScore.ts';
import { createInMemoryFinancialEventStore } from '../financial/persistence/ports.ts';
import { financialSummary } from '../financial/service/financialReadModels.ts';
import { isFinancialError } from '../financial/contracts/failures.ts';
import type { FinancialEvent } from '../financial/contracts/event.ts';
import type { AttributionAggregate } from '../financial/engine/attributionEngine.ts';

import {
  DAY,
  NOW,
  ORG,
  OTHER_ORG,
  WINDOW,
  context,
  event,
  pendingEvent,
  reusePlan,
  scenario,
  syntheticEvent,
} from './financialFixtures.ts';

// ── The eight frauds ────────────────────────────────────────────────────────

describe('Part 6C adversarial — savings cannot be inflated', () => {
  /**
   * FRAUD 1: drop the actual cost and let the estimate stand in for it.
   *
   * The most natural version of this is not malicious — it is a `?? estimated`
   * written by somebody tidying up an optional field. The defence is that a
   * settled event is REQUIRED to carry a measurement and an unsettled one is
   * required not to, so an event with the estimate in the actual slot is either
   * settled (and honest) or refused by its own structural check.
   */
  it('cannot substitute the estimate for a missing measurement', async () => {
    const pending = pendingEvent({ workflowRunId: 'wfr_f1', agentRunId: 'ar_f1' });
    assert.equal(pending.actualCostMicroUsd, undefined);

    // The store refuses a hand-built event claiming settlement without a figure.
    const forged: FinancialEvent = { ...pending, settlementState: 'settled' };
    const store = createInMemoryFinancialEventStore();
    await assert.rejects(
      async () => await store.append(forged),
      (error: unknown) => isFinancialError(error) && error.failure === 'financial_input_invalid',
    );

    // And the fold never reaches for the estimate.
    const totals = foldTotals([pending]);
    assert.equal(totals.actualSettledCostMicroUsd, 0);
    assert.equal(totals.realizedSavingsMicroUsd, 0);
    assert.ok(totals.optimizedEstimatedCostMicroUsd > 0, 'the estimate exists and is not used');
  });

  /**
   * FRAUD 2: exclude retries from the spend while keeping their savings.
   *
   * Retries are the most awkward line in any optimisation report — money spent
   * trying again — so they are the first thing an inflated ledger leaves out.
   */
  it('cannot exclude retry spend while keeping the savings it bought', () => {
    const first = syntheticEvent({ eventId: 'f2a', baselineMicroUsd: 100_000, actualMicroUsd: 10_000, workflowRunId: 'r' });
    const retry = syntheticEvent({ eventId: 'f2b', baselineMicroUsd: 100_000, actualMicroUsd: 40_000, workflowRunId: 'r', retryAttempt: 2 });

    const withRetry = foldTotals([first, retry]);
    const withoutRetry = foldTotals([first]);

    // Dropping the retry would drop its BASELINE too, so the ratio moves rather
    // than improving for free: the saving and the spend travel together on one
    // event and cannot be separated by a filter.
    assert.equal(withRetry.actualSettledCostMicroUsd, 50_000);
    assert.equal(withRetry.realizedBaselineCostMicroUsd, 200_000);
    assert.equal(withoutRetry.realizedBaselineCostMicroUsd, 100_000);

    const progress = assessTargetProgress([first, retry]);
    assert.equal(progress.realizedReductionPercent, 75);

    // And the retry is visible as its own line in the waste report and in the
    // retry-attempt attribution, so its absence from a report would be obvious.
    const waste = analyzeWaste([first, retry]);
    assert.ok(waste.entries.some((entry) => entry.category === 'recovered_retry'));
    const byAttempt = aggregateBy([first, retry], 'retry_attempt');
    assert.deepEqual(byAttempt.buckets.map((bucket) => bucket.key).sort(), ['1', '2']);
  });

  /**
   * FRAUD 3: count reuse savings twice.
   *
   * Once from Part 6A's `reuse` category and once again from the avoided events'
   * own baselines. Both figures are real; adding them is the lie.
   */
  it('cannot count reuse savings twice', () => {
    const avoided = [
      deriveFinancialEvent(reusePlan('t1'), context({ workflowRunId: 'w1', agentRunId: 'a1' })),
      deriveFinancialEvent(reusePlan('t2'), context({ workflowRunId: 'w2', agentRunId: 'a2' })),
    ];

    const totals = foldTotals(avoided);
    const byCategory = savingsByCategory(avoided);
    const fromCategory = byCategory.reuse?.microUsd ?? 0;

    // The category IS the saving. It equals the estimated saving exactly, so
    // there is no second amount left over to add to it.
    assert.equal(fromCategory, totals.estimatedSavingsMicroUsd);
    assert.equal(fromCategory, totals.realizedSavingsMicroUsd);
    assertSavingsBreakdownBalances(avoided);

    // A ledger that ALSO added the baselines would exceed the baseline itself,
    // which the reconciliation refuses.
    const doubled = fromCategory + totals.realizedSavingsMicroUsd;
    assert.ok(doubled > totals.baselineCostMicroUsd, 'the double count would exceed the baseline');
  });

  /** FRAUD 4: mix an estimated numerator with a realised denominator. */
  it('cannot mix estimated and realised values in one ratio', () => {
    const events = [
      ...scenario({ prefix: 'f4s', count: 10, settledCount: 10, baselineMicroUsd: 100_000, actualMicroUsd: 50_000 }),
      ...scenario({ prefix: 'f4p', count: 10, settledCount: 0, baselineMicroUsd: 100_000, actualMicroUsd: 0 }),
    ];
    const progress = assessTargetProgress(events);

    // Realised: 500,000 saved over a 1,000,000 settled baseline = 50%.
    assert.equal(progress.realizedReductionPercent, 50);
    assert.equal(progress.realizedBaselineCostMicroUsd, 1_000_000);
    // Estimated: over the WHOLE window's baseline, which is twice as large.
    assert.equal(progress.baselineCostMicroUsd, 2_000_000);
    assert.notEqual(progress.realizedBaselineCostMicroUsd, progress.baselineCostMicroUsd);
    // The two denominators are different numbers with different names, so a
    // ratio built from one of each is a ratio somebody had to write on purpose.
    assert.notEqual(progress.estimatedReductionPercent, progress.realizedReductionPercent);
  });

  /** FRAUD 5: drop failed runs from the baseline but keep their savings. */
  it('cannot exclude failed runs from the baseline while keeping their savings', () => {
    const succeeded = syntheticEvent({ eventId: 'f5a', baselineMicroUsd: 100_000, actualMicroUsd: 10_000, workflowRunId: 'ok', outcome: 'succeeded' });
    const failed = syntheticEvent({ eventId: 'f5b', baselineMicroUsd: 100_000, actualMicroUsd: 90_000, workflowRunId: 'bad', outcome: 'failed' });

    const all = assessTargetProgress([succeeded, failed]);
    assert.equal(all.realizedReductionPercent, 50);

    // Filtering to successes takes the failure's baseline AND its saving with
    // it. Reduction rises, and the outcome economics immediately show why: the
    // failed spend has not gone anywhere, it has just stopped being counted.
    const successesOnly = assessTargetProgress([succeeded]);
    assert.equal(successesOnly.realizedReductionPercent, 90);

    const economics = analyzeOutcomes([succeeded, failed]);
    assert.equal(economics.failedRuns, 1);
    assert.equal(economics.costPerFailedRunMicroUsd, 90_000);
    // Cost per completed outcome charges the failure to the success, which is
    // the figure a successes-only reduction cannot hide behind.
    assert.equal(economics.costPerCompletedOutcomeMicroUsd, 100_000);
    assert.ok(
      economics.costPerCompletedOutcomeMicroUsd > economics.costPerSuccessfulRunMicroUsd,
    );
  });

  /** FRAUD 6: treat unsettled spend as zero. */
  it('cannot treat unsettled spend as zero cost', () => {
    const settled = syntheticEvent({ eventId: 'f6a', baselineMicroUsd: 100_000, actualMicroUsd: 10_000 });
    const abandoned = abandonSettlement(
      syntheticEvent({ eventId: 'f6b', baselineMicroUsd: 900_000, workflowRunId: 'wfr_f6b' }),
    );

    const totals = foldTotals([settled, abandoned]);
    // If the unsettled event were read as zero, realised savings would be
    // 90,000 + 900,000 over a 1,000,000 baseline: 99%.
    assert.equal(totals.realizedSavingsMicroUsd, 90_000);
    assert.equal(totals.realizedBaselineCostMicroUsd, 100_000);
    assert.equal(totals.unknownCostBaselineMicroUsd, 900_000);

    const progress = assessTargetProgress([settled, abandoned]);
    assert.equal(progress.realizedReductionPercent, 90);
    // 90% over half the events. Coverage is what stops that reading as a result.
    assert.equal(progress.coverage.coveragePercent, 50);
    assert.equal(progress.achieved, false);
    assert.equal(progress.assessment, 'insufficient_settlement_coverage');
  });

  /** FRAUD 7: round 89.95% into a target achieved. */
  it('cannot round a near miss into an achieved target', () => {
    const cases = [
      { prefix: 'f7a', actual: 10_050, expectedDisplay: 90, achieved: false },
      { prefix: 'f7b', actual: 10_001, expectedDisplay: 90, achieved: false },
      { prefix: 'f7c', actual: 10_000, expectedDisplay: 90, achieved: true },
      { prefix: 'f7d', actual: 9_999, expectedDisplay: 90, achieved: true },
    ];
    for (const testCase of cases) {
      const progress = assessTargetProgress(
        scenario({
          prefix: testCase.prefix,
          count: 25,
          settledCount: 25,
          baselineMicroUsd: 100_000,
          actualMicroUsd: testCase.actual,
        }),
      );
      assert.equal(progress.realizedReductionPercent, testCase.expectedDisplay);
      assert.equal(
        progress.achieved,
        testCase.achieved,
        `actual=${testCase.actual} displays as 90.0 and must be achieved=${testCase.achieved}`,
      );
    }
  });

  /** FRAUD 8: sum two attribution dimensions and call it total spend. */
  it('cannot sum two dimensions into a larger total', () => {
    const events = [
      event({ workflowId: 'wf_a', workflowRunId: 'r1', agentId: 'agent_x', agentRunId: 'a1' }),
      event({ workflowId: 'wf_b', workflowRunId: 'r2', agentId: 'agent_y', agentRunId: 'a2' }),
    ];
    const byWorkflow = aggregateBy(events, 'workflow');
    const byAgent = aggregateBy(events, 'agent');

    // Both describe the SAME money and both report the same window total, which
    // is the shape that makes adding them visibly wrong rather than plausible.
    assert.deepEqual(byWorkflow.totals, byAgent.totals);
    const summedAcross =
      byWorkflow.totals.actualSettledCostMicroUsd + byAgent.totals.actualSettledCostMicroUsd;
    assert.equal(summedAcross, byWorkflow.totals.actualSettledCostMicroUsd * 2);

    // And a hand-merged aggregate is refused by the reconciliation, because its
    // buckets no longer sum to the total they claim to partition.
    const merged: AttributionAggregate = {
      dimension: 'workflow',
      totals: byWorkflow.totals,
      buckets: [...byWorkflow.buckets, ...byAgent.buckets],
    };
    assert.throws(
      () => reconcileAttribution(merged),
      (error: unknown) =>
        isFinancialError(error) && error.failure === 'financial_reconciliation_failed',
    );
  });
});

// ── Structural refusals ─────────────────────────────────────────────────────

describe('Part 6C adversarial — the reconciliations refuse rather than warn', () => {
  it('refuses a savings breakdown that does not sum to its estimated saving', () => {
    const base = event();
    // An event whose partition claims more than the gap it partitions. Part 6A
    // could not produce this; storage corruption or a hand-built row could.
    const tampered: FinancialEvent = {
      ...base,
      savingsEntries: [
        ...base.savingsEntries,
        { category: 'reuse', microUsd: 999_999, tokens: 0 },
      ],
    };
    assert.throws(
      () => assertSavingsBreakdownBalances([tampered]),
      (error: unknown) =>
        isFinancialError(error) && error.failure === 'financial_reconciliation_failed',
    );
  });

  it('refuses an aggregate whose buckets lost a row', () => {
    const events = [event(), event({ workflowRunId: 'wfr_2', agentRunId: 'ar_2' })];
    const aggregate = aggregateBy(events, 'workflow_run');
    const missing: AttributionAggregate = {
      ...aggregate,
      buckets: aggregate.buckets.slice(0, 1),
    };
    assert.throws(
      () => reconcileAttribution(missing),
      (error: unknown) =>
        isFinancialError(error) && error.failure === 'financial_reconciliation_failed',
    );
  });

  it('refuses a duplicated bucket', () => {
    const aggregate = aggregateBy([event()], 'workflow');
    const duplicated: AttributionAggregate = {
      ...aggregate,
      buckets: [...aggregate.buckets, ...aggregate.buckets],
    };
    assert.throws(
      () => reconcileAttribution(duplicated),
      (error: unknown) =>
        isFinancialError(error) && error.failure === 'financial_reconciliation_failed',
    );
  });

  it('cannot inflate a total by re-deriving the same events', async () => {
    const store = createInMemoryFinancialEventStore();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await store.append(event());
      await store.append(event({ workflowRunId: 'wfr_2', agentRunId: 'ar_2' }));
    }
    const summary = await financialSummary(store, { organizationId: ORG, window: WINDOW });
    assert.equal(summary.totals.events, 2, 'ten appends of two events are two events');
  });

  it('cannot pay for one call twice through a duplicate provider report', async () => {
    const pending = pendingEvent({ workflowRunId: 'wfr_dup', agentRunId: 'ar_dup' });
    const store = createInMemoryFinancialEventStore();
    await store.append(pending);

    const settled = settleFinancialEvent(pending, { actualCostMicroUsd: 7_000, actualTokens: 900 });
    assert.equal(await store.settle(settled), true);
    for (let repeat = 0; repeat < 4; repeat += 1) {
      assert.equal(await store.settle(settled), false);
    }

    const summary = await financialSummary(store, { organizationId: ORG, window: WINDOW });
    assert.equal(summary.totals.actualSettledCostMicroUsd, 7_000);
  });
});

// ── Tenancy ─────────────────────────────────────────────────────────────────

describe('Part 6C adversarial — tenancy', () => {
  it('cannot read another tenant’s money through any read model', async () => {
    const store = createInMemoryFinancialEventStore();
    await store.append(event());
    await store.append(
      syntheticEvent({
        eventId: 'theirs',
        baselineMicroUsd: 5_000_000,
        actualMicroUsd: 4_000_000,
        organizationId: OTHER_ORG,
      }),
    );

    const mine = await financialSummary(store, { organizationId: ORG, window: WINDOW });
    assert.equal(mine.totals.events, 1);
    assert.ok(mine.totals.actualSettledCostMicroUsd < 4_000_000);

    const page = await store.list({ organizationId: ORG, window: WINDOW });
    assert.equal(page.events.every((entry) => entry.organizationId === ORG), true);
  });

  it('refuses a stored event that disagrees with the tenant it was read for', async () => {
    // A corrupt row, not a permitted cross-tenant read. Summing it would put
    // another tenant's money in this tenant's report.
    const store = {
      list: () =>
        Promise.resolve({
          events: [syntheticEvent({ eventId: 'stray', baselineMicroUsd: 1, actualMicroUsd: 1, organizationId: OTHER_ORG })],
          truncated: false,
        }),
      append: () => Promise.reject(new Error('unused')),
      getById: () => Promise.resolve(undefined),
      settle: () => Promise.resolve(false),
    };
    await assert.rejects(
      async () => await financialSummary(store, { organizationId: ORG, window: WINDOW }),
      (error: unknown) => isFinancialError(error) && error.failure === 'financial_tenant_mismatch',
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SYNTHETIC TARGET SCENARIOS — NOT PRODUCTION CLAIMS
// ══════════════════════════════════════════════════════════════════════════
//
// Seven deterministic scenarios, computed from constructed events with no
// production data behind any of them. They exist to prove the reporting behaves
// correctly at each point on the range — including the points where it must
// REFUSE to report success — and to demonstrate that the headline is not a
// number the engine can be talked into.

describe('Part 6C — SYNTHETIC target scenarios (NOT PRODUCTION CLAIMS)', () => {
  it('A. 95% realised on high coverage reports achieved', () => {
    const progress = assessTargetProgress(
      scenario({ prefix: 'A', count: 40, settledCount: 40, baselineMicroUsd: 100_000, actualMicroUsd: 5_000 }),
    );
    assert.equal(progress.realizedReductionPercent, 95);
    assert.equal(progress.coverage.coveragePercent, 100);
    assert.equal(progress.achieved, true);
    assert.equal(progress.assessment, 'target_met_on_settled_data');
  });

  it('B. exactly 90% realised reports achieved', () => {
    const progress = assessTargetProgress(
      scenario({ prefix: 'B', count: 40, settledCount: 40, baselineMicroUsd: 100_000, actualMicroUsd: 10_000 }),
    );
    assert.equal(progress.realizedReductionPercent, 90);
    assert.equal(progress.achieved, true);
  });

  it('C. 89.9% realised reports NOT achieved', () => {
    const progress = assessTargetProgress(
      scenario({ prefix: 'C', count: 40, settledCount: 40, baselineMicroUsd: 100_000, actualMicroUsd: 10_100 }),
    );
    assert.equal(progress.realizedReductionPercent, 89.9);
    assert.equal(progress.achieved, false);
    assert.equal(progress.assessment, 'below_target_on_settled_data');
  });

  it('D. 90% estimated with 45% realised reports the realised figure', () => {
    const events = scenario({
      prefix: 'D',
      count: 40,
      settledCount: 40,
      baselineMicroUsd: 100_000,
      actualMicroUsd: 55_000,
    }).map((entry) => ({
      ...entry,
      optimizedEstimatedCostMicroUsd: 10_000,
      estimatedSavingsMicroUsd: 90_000,
      savingsEntries: [{ category: 'context_reduction' as const, microUsd: 90_000, tokens: 0 }],
    }));

    const progress = assessTargetProgress(events);
    assert.equal(progress.estimatedReductionPercent, 90);
    assert.equal(progress.realizedReductionPercent, 45);
    assert.equal(progress.achieved, false);
    // The estimate is still published — under its own name, next to the
    // measurement that contradicts it, which is how a systematically optimistic
    // optimiser becomes visible instead of invisible.
    assert.ok(progress.estimatedSavingsMicroUsd > progress.realizedSavingsMicroUsd);
  });

  it('E. 90% realised on 20% coverage reports NOT achieved, with the figure visible', () => {
    const progress = assessTargetProgress(
      scenario({ prefix: 'E', count: 50, settledCount: 10, baselineMicroUsd: 100_000, actualMicroUsd: 10_000 }),
    );
    assert.equal(progress.realizedReductionPercent, 90);
    assert.equal(progress.coverage.coveragePercent, 20);
    assert.equal(progress.coverageWarning, true);
    assert.equal(progress.achieved, false);
    assert.equal(progress.assessment, 'insufficient_settlement_coverage');
    // The blind spot is reported in money, not only in row counts.
    assert.equal(progress.coverage.unsettledBaselineMicroUsd, 4_000_000);
  });

  it('F. a high-reuse workload realises most of its saving from measured absence', () => {
    const avoided = Array.from({ length: 12 }, (_, index) =>
      deriveFinancialEvent(
        reusePlan(`task_F_${index}`),
        context({
          workflowRunId: `wfr_F_${index}`,
          agentRunId: `ar_F_${index}`,
          occurredAt: NOW - 10 * DAY + index * 60_000,
        }),
      ),
    );
    const paid = scenario({
      prefix: 'F_paid',
      count: 4,
      settledCount: 4,
      baselineMicroUsd: 100_000,
      actualMicroUsd: 40_000,
    });

    const progress = assessTargetProgress([...avoided, ...paid]);
    const byCategory = savingsByCategory([...avoided, ...paid]);

    assert.ok(progress.realizedFromAbsencePercent > 50, 'most of the saving came from absence');
    assert.ok((byCategory.reuse?.microUsd ?? 0) > 0);
    assert.equal(progress.coverage.coveragePercent, 100);
    // Honest and unremarkable: a platform can legitimately reduce cost mostly by
    // not making calls. The report says so rather than blending it away.
    assert.ok(progress.realizedReductionPercent > 0);
  });

  it('G. a heavy reasoning workload reports a small, truthful saving', () => {
    const progress = assessTargetProgress(
      scenario({ prefix: 'G', count: 30, settledCount: 30, baselineMicroUsd: 100_000, actualMicroUsd: 88_000 }),
    );
    assert.equal(progress.realizedReductionPercent, 12);
    assert.equal(progress.achieved, false);
    assert.equal(progress.assessment, 'below_target_on_settled_data');

    // And the score does not rescue it. A window that genuinely could not save
    // much scores modestly, which is the correct answer rather than a kind one.
    const scored = scoreOptimization({
      events: scenario({ prefix: 'G', count: 30, settledCount: 30, baselineMicroUsd: 100_000, actualMicroUsd: 88_000 }),
    });
    assert.ok(scored.score < 70, `expected a modest score, got ${scored.score}`);
    assert.equal(scored.confidence, 'measured');
  });

  it('reports coverage on every scenario, so no headline travels alone', () => {
    for (const settledCount of [0, 5, 20, 40]) {
      const events = scenario({
        prefix: `cov_${settledCount}`,
        count: 40,
        settledCount,
        baselineMicroUsd: 100_000,
        actualMicroUsd: 10_000,
      });
      const progress = assessTargetProgress(events);
      const coverage = settlementCoverage(events);
      assert.equal(progress.coverage.coveragePercent, coverage.coveragePercent);
      assert.equal(
        progress.achieved,
        settledCount === 40,
        'only full coverage at 90% may be reported as achieved here',
      );
    }
  });
});
