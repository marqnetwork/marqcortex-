/**
 * Cost compression metrics (AI-01 Batch 3B, Part 6A).
 *
 * ── INTERNAL FIGURES, NOT A DASHBOARD ──────────────────────────────────────
 *
 * This produces the numbers a later Financial Intelligence surface will read. It
 * deliberately produces NOTHING ELSE: no HTTP route, no read model, no
 * projection to a console, no chart. Those are later work, and shipping them
 * alongside the accounting they display would mean one review for two things
 * that fail differently.
 *
 * ── EVERY RECORD IS RECONCILED BEFORE IT COUNTS ────────────────────────────
 *
 * `summarizeCompression` reconciles each savings record — through the same
 * `reconcileSavings` the ledger uses — before it contributes to any total. An
 * aggregate is the worst place to discover an accounting defect, because by then
 * it has been averaged into something that looks plausible and the record that
 * caused it is no longer identifiable.
 *
 * ── THE REFUSALS ARE COUNTED TOO, AND THAT IS THE POINT ────────────────────
 *
 * `qualityFloorFailures` and `refusalReasons` sit next to the savings figures
 * rather than in a separate error report. A platform that reported what it saved
 * without reporting what it refused to save would be reporting half a control:
 * an optimiser that never refuses anything is not disciplined, it is
 * unconstrained, and the ratio between the two columns is how a reviewer tells
 * which one this is.
 */

import type { CompressionPlan } from '../costCompressionEngine.ts';
import type { SavingsRecord, SavingsRollup } from '../contracts/savings.ts';
import type { CompressionDecision, CompressionReason } from '../contracts/compression.ts';
import type { ActualUsage, UsageLedger } from '../contracts/usage.ts';
import { rollupSavings } from '../ledger/savingsLedger.ts';
import { retryUsage } from '../accounting/usageAccounting.ts';

export interface CompressionMetrics {
  // ── Money ──────────────────────────────────────────────────────────────────
  readonly baselineCostMicroUsd: number;
  readonly optimizedEstimatedCostMicroUsd: number;
  readonly actualCostMicroUsd: number;
  readonly estimatedSavingsMicroUsd: number;
  readonly realizedSavingsMicroUsd: number;
  /** Realised savings over baseline. 0–100, one decimal. */
  readonly savingsPercent: number;
  /** True when every contributing record carried measured spend. */
  readonly fullyMeasured: boolean;

  // ── Volume ─────────────────────────────────────────────────────────────────
  readonly taskCount: number;
  readonly callsAvoided: number;
  readonly tokensAvoided: number;
  readonly costAvoidedMicroUsd: number;
  readonly profileDowngrades: number;
  readonly escalations: number;

  // ── Context ────────────────────────────────────────────────────────────────
  readonly contextTokensBefore: number;
  readonly contextTokensAfter: number;
  /** 0–100, rounded. Zero when nothing was removed. */
  readonly contextReductionPercent: number;

  // ── Spend the savings figure must be read next to ─────────────────────────
  readonly retryCostMicroUsd: number;
  readonly retryTokens: number;

  // ── Discipline ─────────────────────────────────────────────────────────────
  readonly qualityFloorFailures: number;
  /** Reason code → count, for every non-executing decision. */
  readonly refusalReasons: Readonly<Record<string, number>>;
  readonly decisions: Readonly<Record<CompressionDecision, number>>;

  readonly savings: SavingsRollup;
}

function emptyDecisionCounts(): Record<CompressionDecision, number> {
  return {
    avoid: 0,
    deterministic: 0,
    reuse: 0,
    compress: 0,
    downgrade: 0,
    execute: 0,
    escalate: 0,
    defer: 0,
    deny: 0,
  };
}

export interface CompressionMetricsInput {
  readonly plans: readonly CompressionPlan[];
  /**
   * Settled savings records, where measured spend has arrived.
   *
   * Supplied separately from the plans because settlement happens LATER — the
   * provider reports usage after the call, often after the plan's own request
   * has returned. A metrics function that read only the plans would report
   * estimates forever and call them results.
   */
  readonly settled?: readonly SavingsRecord[];
  /** Usage ledgers, so retry spend can be reported beside the savings. */
  readonly ledgers?: readonly UsageLedger[];
}

/**
 * Summarise a set of plans.
 *
 * Pure. No clock, no store, no I/O — so a metrics figure is reproducible from
 * the plans that produced it, which is the property an auditor needs when the
 * question is "where did 62% come from".
 */
export function summarizeCompression(input: CompressionMetricsInput): CompressionMetrics {
  const settledById = new Map<string, SavingsRecord>();
  for (const record of input.settled ?? []) settledById.set(record.taskId, record);

  // A settled record REPLACES its plan's estimate rather than being added to it.
  // Counting both would be the plainest possible double count, and it is the
  // shape a naive "sum everything you have" implementation takes.
  const records = input.plans.map(
    (plan) => settledById.get(plan.taskId) ?? plan.savings,
  );
  const savings = rollupSavings(records);

  let callsAvoided = 0;
  let tokensAvoided = 0;
  let costAvoided = 0;
  let downgrades = 0;
  let escalations = 0;
  let contextBefore = 0;
  let contextAfter = 0;
  let qualityFloorFailures = 0;
  const refusalReasons: Record<string, number> = {};
  const decisions = emptyDecisionCounts();

  for (const plan of input.plans) {
    decisions[plan.decision] += 1;

    if (plan.inferenceAvoided && plan.decision !== 'deny') {
      callsAvoided += 1;
      tokensAvoided += plan.baseline.baselineEstimatedTotalTokens;
      costAvoided += plan.baseline.baselineEstimatedCostMicroUsd;
    }
    if (plan.downgraded) downgrades += 1;
    if (plan.decision === 'escalate') {
      escalations += 1;
      qualityFloorFailures += 1;
    }
    if (plan.context !== undefined) {
      contextBefore += plan.context.beforeTokens;
      contextAfter += plan.context.afterTokens;
    }
    if (plan.decision === 'deny' || plan.decision === 'defer' || plan.decision === 'escalate') {
      const reason: CompressionReason = plan.reason;
      refusalReasons[reason] = (refusalReasons[reason] ?? 0) + 1;
    }
  }

  const retry = (input.ledgers ?? []).reduce<ActualUsage>(
    (total, ledger) => {
      const spent = retryUsage(ledger);
      return {
        actualInputTokens: total.actualInputTokens + spent.actualInputTokens,
        actualOutputTokens: total.actualOutputTokens + spent.actualOutputTokens,
        actualTotalTokens: total.actualTotalTokens + spent.actualTotalTokens,
        actualCostMicroUsd: total.actualCostMicroUsd + spent.actualCostMicroUsd,
      };
    },
    { actualInputTokens: 0, actualOutputTokens: 0, actualTotalTokens: 0, actualCostMicroUsd: 0 },
  );

  const contextReduced = Math.max(0, contextBefore - contextAfter);

  return {
    baselineCostMicroUsd: savings.baselineCostMicroUsd,
    optimizedEstimatedCostMicroUsd: savings.optimizedEstimatedCostMicroUsd,
    actualCostMicroUsd: savings.actualCostMicroUsd,
    estimatedSavingsMicroUsd: savings.estimatedSavingsMicroUsd,
    realizedSavingsMicroUsd: savings.realizedSavingsMicroUsd,
    savingsPercent: savings.savingsPercent,
    fullyMeasured: records.length > 0 && records.every((record) => record.realized),
    taskCount: records.length,
    callsAvoided,
    tokensAvoided,
    costAvoidedMicroUsd: costAvoided,
    profileDowngrades: downgrades,
    escalations,
    contextTokensBefore: contextBefore,
    contextTokensAfter: contextAfter,
    contextReductionPercent:
      contextBefore === 0 ? 0 : Math.round((contextReduced / contextBefore) * 100),
    retryCostMicroUsd: retry.actualCostMicroUsd,
    retryTokens: retry.actualTotalTokens,
    qualityFloorFailures,
    refusalReasons,
    decisions,
    savings,
  };
}
