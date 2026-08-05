/**
 * Financial Intelligence (AI-01 Batch 3B).
 *
 * Provider-neutral cost attribution over DURABLE workflow run records: what the
 * platform's AI actually cost, broken down by every dimension somebody will ask
 * about, plus what it avoided spending and what that was measured against.
 *
 * DURABLE DATA ONLY, AND THE DISTINCTION IS NOT COSMETIC.
 *
 * Batch 2's usage report is built from process-lifetime metrics: fast, useful for
 * "what is happening right now", and reset every time an isolate recycles. This
 * module reads persisted run records and their ledgers, so a figure it reports is
 * a figure that survives a restart. Every report it returns says which of the two
 * it is, because presenting isolate-local counters as history is how a platform
 * ends up reconciling an invoice against numbers that never existed.
 *
 * A PROJECTION IS LABELLED A PROJECTION. `projectedMonthlyBurnMicroUsd` carries an
 * `isEstimate` flag, the window it extrapolated from, and the number of days in
 * that window. A monthly burn derived from four hours of traffic is a guess, and
 * the report says so rather than letting a reader assume otherwise.
 *
 * SAVINGS ARE NEVER FABRICATED. Every avoided figure comes from an avoided-call
 * record that names the profile and the estimate version it was priced against.
 * This module sums those records; it does not invent one, and it cannot — there is
 * no code path here that produces a saving from anything other than a stored
 * record.
 *
 * TENANT SCOPE IS THE CALLER'S RESPONSIBILITY AND THIS MODULE'S ASSUMPTION. It
 * aggregates whatever records it is handed. The service layer is what decides
 * which records an actor may see, and it keys every store read by the resolved
 * organization — so a cross-tenant total is unreachable from the API even though
 * the arithmetic here would happily compute one.
 */

import type {
  WorkflowRunRecord,
  WorkflowUsageAttribution,
} from '../contracts/runtime.ts';
import { isTerminalWorkflowState } from '../contracts/runtime.ts';
import { summarizeAvoidedCalls } from '../runtime/ledgers.ts';

/** Which of the two data sources a figure came from. */
export type FinancialDataSource = 'durable_run_records' | 'process_lifetime_metrics';

export interface CostTotals {
  readonly estimatedMicroUsd: number;
  readonly actualMicroUsd: number;
  readonly reservedMicroUsd: number;
  readonly avoidedMicroUsd: number;
  readonly optimizationSavingsMicroUsd: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly totalTokens: number;
  readonly avoidedTokens: number;
  readonly calls: number;
}

function emptyTotals(): CostTotals {
  return {
    estimatedMicroUsd: 0,
    actualMicroUsd: 0,
    reservedMicroUsd: 0,
    avoidedMicroUsd: 0,
    optimizationSavingsMicroUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    avoidedTokens: 0,
    calls: 0,
  };
}

export interface AttributionBucket extends CostTotals {
  readonly key: string;
  readonly runs: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
}

/** A dimension a report can be grouped by. */
export type AttributionDimension =
  | 'workflow'
  | 'workflow_run'
  | 'node'
  | 'agent'
  | 'organization'
  | 'actor'
  | 'feature'
  | 'provider'
  | 'model'
  | 'tool'
  | 'outcome';

export interface WorkflowFinancialSummary {
  readonly source: FinancialDataSource;
  readonly generatedAt: string;
  readonly organizationId?: string;
  readonly runs: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly activeRuns: number;
  readonly totals: CostTotals;
  /** Micro-USD per run that reached `completed`. Zero when there are none. */
  readonly costPerSuccessfulRunMicroUsd: number;
  readonly costPerFailedRunMicroUsd: number;
  /**
   * Cost per COMPLETED OUTCOME — a run that both completed and passed its output
   * contract. Distinct from cost per successful run on purpose: a run can finish
   * without having produced the thing it was for.
   */
  readonly costPerCompletedOutcomeMicroUsd: number;
  readonly completedOutcomes: number;
  readonly retryCostMicroUsd: number;
  readonly repairCostMicroUsd: number;
  readonly parallelBranchCostMicroUsd: number;
  readonly cacheSavingsMicroUsd: number;
  readonly routingSavingsMicroUsd: number;
  readonly trimmingSavingsMicroUsd: number;
  /** Share of the workflow cost budget consumed, 0–1. */
  readonly budgetUtilization: number;
  readonly projection: BurnProjection;
  readonly byDimension: Readonly<Record<AttributionDimension, readonly AttributionBucket[]>>;
}

export interface BurnProjection {
  /** Always true. A projection is never presented as a measurement. */
  readonly isEstimate: true;
  readonly projectedMonthlyBurnMicroUsd: number;
  /** Days of data the extrapolation used. Fewer is less trustworthy. */
  readonly windowDays: number;
  readonly observedMicroUsd: number;
  /** Plain-language caveat, rendered verbatim by the console. */
  readonly caveat: string;
}

/**
 * Extrapolate a monthly figure from an observed window.
 *
 * Deliberately linear and deliberately blunt: a smarter model of AI spend growth
 * would be a model, and a model presented next to measured costs invites a reader
 * to treat both the same way. Linear extrapolation is obviously an extrapolation.
 */
export function projectMonthlyBurn(input: {
  readonly observedMicroUsd: number;
  readonly windowMs: number;
}): BurnProjection {
  const dayMs = 86_400_000;
  const windowDays = input.windowMs > 0 ? input.windowMs / dayMs : 0;
  const projected =
    windowDays > 0 ? Math.round((input.observedMicroUsd / windowDays) * 30) : 0;
  return {
    isEstimate: true,
    projectedMonthlyBurnMicroUsd: projected,
    windowDays: Math.round(windowDays * 100) / 100,
    observedMicroUsd: input.observedMicroUsd,
    caveat:
      windowDays < 1
        ? 'Estimate extrapolated from less than one day of durable data. Treat as indicative only.'
        : `Estimate extrapolated linearly from ${Math.round(windowDays)} day(s) of durable run records.`,
  };
}

function addAttribution(totals: CostTotals, row: WorkflowUsageAttribution): CostTotals {
  return {
    ...totals,
    actualMicroUsd: totals.actualMicroUsd + row.costMicroUsd,
    promptTokens: totals.promptTokens + row.promptTokens,
    completionTokens: totals.completionTokens + row.completionTokens,
    cachedTokens: totals.cachedTokens + row.cachedTokens,
    totalTokens: totals.totalTokens + row.totalTokens,
    calls: totals.calls + row.calls,
  };
}

/**
 * Group attribution rows by one dimension.
 *
 * Buckets are keyed by the dimension's value and sorted by actual cost descending
 * — the order somebody investigating a bill reads in — with the key as a stable
 * tie-break so the output is deterministic.
 */
export function attributeBy(
  records: readonly WorkflowRunRecord[],
  dimension: AttributionDimension,
): readonly AttributionBucket[] {
  const buckets = new Map<string, { totals: CostTotals; runs: Set<string>; ok: Set<string>; bad: Set<string> }>();

  const bucketFor = (key: string) => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created = { totals: emptyTotals(), runs: new Set<string>(), ok: new Set<string>(), bad: new Set<string>() };
    buckets.set(key, created);
    return created;
  };

  for (const record of records) {
    const runId = record.context.workflowRunId;
    const succeeded = record.state === 'completed';
    const failed = isTerminalWorkflowState(record.state) && !succeeded;

    // Run-level dimensions take the run's own ledger; per-call dimensions take
    // the attribution rows. Mixing the two would double-count, because the rows
    // already sum to the ledger's actual figure.
    const runLevel = (key: string): void => {
      const bucket = bucketFor(key);
      bucket.totals = {
        ...bucket.totals,
        estimatedMicroUsd: bucket.totals.estimatedMicroUsd + record.cost.estimatedMicroUsd,
        actualMicroUsd: bucket.totals.actualMicroUsd + record.cost.actualMicroUsd,
        reservedMicroUsd: bucket.totals.reservedMicroUsd + record.cost.reservedMicroUsd,
        avoidedMicroUsd: bucket.totals.avoidedMicroUsd + record.cost.avoidedMicroUsd,
        optimizationSavingsMicroUsd:
          bucket.totals.optimizationSavingsMicroUsd + record.cost.avoidedMicroUsd,
        promptTokens: bucket.totals.promptTokens + record.tokens.actualPromptTokens,
        completionTokens: bucket.totals.completionTokens + record.tokens.actualCompletionTokens,
        cachedTokens: bucket.totals.cachedTokens + record.tokens.cachedTokens,
        totalTokens: bucket.totals.totalTokens + record.tokens.actualTotalTokens,
        avoidedTokens: bucket.totals.avoidedTokens + record.tokens.avoidedTokens,
        calls: bucket.totals.calls + record.tokens.attribution.reduce((sum, row) => sum + row.calls, 0),
      };
      bucket.runs.add(runId);
      if (succeeded) bucket.ok.add(runId);
      if (failed) bucket.bad.add(runId);
    };

    const perCall = (key: string, row: WorkflowUsageAttribution): void => {
      const bucket = bucketFor(key);
      bucket.totals = addAttribution(bucket.totals, row);
      bucket.runs.add(runId);
      if (succeeded) bucket.ok.add(runId);
      if (failed) bucket.bad.add(runId);
    };

    switch (dimension) {
      case 'workflow':
        runLevel(record.context.workflowId);
        break;
      case 'workflow_run':
        runLevel(runId);
        break;
      case 'organization':
        runLevel(record.context.organizationId);
        break;
      case 'actor':
        runLevel(record.context.actorId);
        break;
      case 'feature':
        runLevel(record.context.origin.feature);
        break;
      case 'outcome':
        runLevel(record.state);
        break;
      case 'node':
        for (const row of record.tokens.attribution) perCall(row.nodeId, row);
        break;
      case 'agent':
        for (const row of record.tokens.attribution) {
          if (row.agentId !== '') perCall(row.agentId, row);
        }
        break;
      case 'provider':
        for (const row of record.tokens.attribution) perCall(row.providerId, row);
        break;
      case 'model':
        for (const row of record.tokens.attribution) perCall(row.modelId, row);
        break;
      case 'tool':
        // Tool nodes are not billable through a provider, so they carry no
        // attribution row. Their cost dimension is the NODE record, and counting
        // executions is the honest figure rather than a fabricated money value.
        for (const node of record.nodeHistory) {
          if (node.nodeType !== 'tool' || node.toolId === undefined) continue;
          const bucket = bucketFor(node.toolId);
          bucket.totals = {
            ...bucket.totals,
            actualMicroUsd: bucket.totals.actualMicroUsd + (node.actualCostMicroUsd ?? 0),
            calls: bucket.totals.calls + 1,
          };
          bucket.runs.add(runId);
          if (succeeded) bucket.ok.add(runId);
          if (failed) bucket.bad.add(runId);
        }
        break;
    }
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      ...bucket.totals,
      runs: bucket.runs.size,
      successfulRuns: bucket.ok.size,
      failedRuns: bucket.bad.size,
    }))
    .sort((a, b) => b.actualMicroUsd - a.actualMicroUsd || a.key.localeCompare(b.key));
}

export interface FinancialSummaryOptions {
  readonly organizationId?: string;
  readonly nowIso: string;
  readonly nowMs: number;
  /** Workflow cost ceiling to measure utilization against, when known. */
  readonly budgetCeilingMicroUsd?: number;
}

/**
 * Build the whole summary from durable run records.
 *
 * Cost per outcome is computed three ways because the three answer different
 * questions: per successful run (what does a win cost?), per failed run (what is
 * failure costing us?), and per completed outcome (what does the thing we wanted
 * cost?). Reporting only the first hides the money spent on runs that finished
 * without producing anything.
 */
export function buildFinancialSummary(
  records: readonly WorkflowRunRecord[],
  options: FinancialSummaryOptions,
): WorkflowFinancialSummary {
  let totals = emptyTotals();
  let successfulRuns = 0;
  let failedRuns = 0;
  let activeRuns = 0;
  let completedOutcomes = 0;
  let successCost = 0;
  let failureCost = 0;
  let outcomeCost = 0;
  let retryCost = 0;
  let repairCost = 0;
  let parallelBranchCost = 0;
  let cacheSavings = 0;
  let routingSavings = 0;
  let trimmingSavings = 0;
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = 0;

  for (const record of records) {
    const succeeded = record.state === 'completed';
    const terminal = isTerminalWorkflowState(record.state);
    if (succeeded) successfulRuns += 1;
    else if (terminal) failedRuns += 1;
    else activeRuns += 1;

    totals = {
      ...totals,
      estimatedMicroUsd: totals.estimatedMicroUsd + record.cost.estimatedMicroUsd,
      actualMicroUsd: totals.actualMicroUsd + record.cost.actualMicroUsd,
      reservedMicroUsd: totals.reservedMicroUsd + record.cost.reservedMicroUsd,
      avoidedMicroUsd: totals.avoidedMicroUsd + record.cost.avoidedMicroUsd,
      optimizationSavingsMicroUsd:
        totals.optimizationSavingsMicroUsd + record.cost.avoidedMicroUsd,
      promptTokens: totals.promptTokens + record.tokens.actualPromptTokens,
      completionTokens: totals.completionTokens + record.tokens.actualCompletionTokens,
      cachedTokens: totals.cachedTokens + record.tokens.cachedTokens,
      totalTokens: totals.totalTokens + record.tokens.actualTotalTokens,
      avoidedTokens: totals.avoidedTokens + record.tokens.avoidedTokens,
      calls: totals.calls + record.tokens.attribution.reduce((sum, row) => sum + row.calls, 0),
    };

    if (succeeded) successCost += record.cost.actualMicroUsd;
    if (terminal && !succeeded) failureCost += record.cost.actualMicroUsd;
    // A completed outcome is a completion that also carries a result digest —
    // the run both finished and had its output accepted against the contract.
    if (succeeded && record.resultDigest !== undefined) {
      completedOutcomes += 1;
      outcomeCost += record.cost.actualMicroUsd;
    }

    // Retry and branch cost are read off the node history rather than estimated:
    // a node record whose attempt is above 1 IS a retry, and its measured cost is
    // what the retry cost. Nothing here is apportioned or guessed.
    for (const node of record.nodeHistory) {
      const cost = node.actualCostMicroUsd ?? 0;
      if (node.attempt > 1) {
        retryCost += cost;
        if (node.failure === 'output_validation_failed') repairCost += cost;
      }
      if (node.branchId !== undefined) parallelBranchCost += cost;
    }

    for (const decision of record.cacheDecisions) {
      if (decision.outcome === 'hit') cacheSavings += decision.savedMicroUsd;
    }
    const avoided = summarizeAvoidedCalls(record.avoidedCalls);
    for (const bucket of avoided.byReason) {
      if (bucket.reason === 'cheaper_path_selected') routingSavings += bucket.avoidedMicroUsd;
    }
    for (const optimization of record.optimizations) {
      // Trimming savings are token savings priced at the run's own realised
      // rate, so a run that never called a provider contributes nothing rather
      // than a rate pulled from a profile it did not use.
      const realisedRatePerToken =
        record.tokens.actualTotalTokens > 0
          ? record.cost.actualMicroUsd / record.tokens.actualTotalTokens
          : 0;
      trimmingSavings += Math.round(
        (optimization.duplicateTokensRemoved + optimization.historyTokensRemoved) *
          realisedRatePerToken,
      );
    }

    const createdMs = Date.parse(record.createdAt);
    if (Number.isFinite(createdMs)) {
      earliestMs = Math.min(earliestMs, createdMs);
      latestMs = Math.max(latestMs, createdMs);
    }
  }

  const windowMs =
    Number.isFinite(earliestMs) && latestMs > 0
      ? Math.max(options.nowMs - earliestMs, latestMs - earliestMs)
      : 0;

  const dimensions: AttributionDimension[] = [
    'workflow',
    'workflow_run',
    'node',
    'agent',
    'organization',
    'actor',
    'feature',
    'provider',
    'model',
    'tool',
    'outcome',
  ];
  const byDimension = Object.fromEntries(
    dimensions.map((dimension) => [dimension, attributeBy(records, dimension)]),
  ) as Record<AttributionDimension, readonly AttributionBucket[]>;

  return {
    source: 'durable_run_records',
    generatedAt: options.nowIso,
    ...(options.organizationId === undefined ? {} : { organizationId: options.organizationId }),
    runs: records.length,
    successfulRuns,
    failedRuns,
    activeRuns,
    totals,
    costPerSuccessfulRunMicroUsd: successfulRuns > 0 ? Math.round(successCost / successfulRuns) : 0,
    costPerFailedRunMicroUsd: failedRuns > 0 ? Math.round(failureCost / failedRuns) : 0,
    costPerCompletedOutcomeMicroUsd:
      completedOutcomes > 0 ? Math.round(outcomeCost / completedOutcomes) : 0,
    completedOutcomes,
    retryCostMicroUsd: retryCost,
    repairCostMicroUsd: repairCost,
    parallelBranchCostMicroUsd: parallelBranchCost,
    cacheSavingsMicroUsd: cacheSavings,
    routingSavingsMicroUsd: routingSavings,
    trimmingSavingsMicroUsd: trimmingSavings,
    budgetUtilization:
      options.budgetCeilingMicroUsd !== undefined && options.budgetCeilingMicroUsd > 0
        ? Math.min(1, totals.actualMicroUsd / options.budgetCeilingMicroUsd)
        : 0,
    projection: projectMonthlyBurn({ observedMicroUsd: totals.actualMicroUsd, windowMs }),
    byDimension,
  };
}

export interface OptimizationSavingsSummary {
  readonly source: FinancialDataSource;
  readonly generatedAt: string;
  readonly avoidedCalls: number;
  readonly avoidedTokens: number;
  readonly avoidedMicroUsd: number;
  readonly cacheHits: number;
  readonly cacheSavingsMicroUsd: number;
  readonly duplicateTokensRemoved: number;
  readonly historyTokensRemoved: number;
  readonly retrievalTokensAvoided: number;
  readonly memoryTokensAvoided: number;
  readonly completionTokensReduced: number;
  readonly totalTokensSaved: number;
  readonly byReason: readonly {
    readonly reason: string;
    readonly avoidedCalls: number;
    readonly avoidedTokens: number;
    readonly avoidedMicroUsd: number;
  }[];
  /** Estimate bases seen. More than one means the figures span a version change. */
  readonly estimateVersions: readonly string[];
}

/**
 * Aggregate savings across runs.
 *
 * `estimateVersions` is reported rather than collapsed. When a pricing basis
 * changes, a total that spans both is still arithmetically correct but is no
 * longer comparable to either — and the only way a reader can know is if the
 * report says so.
 */
export function buildOptimizationSavingsSummary(
  records: readonly WorkflowRunRecord[],
  options: { readonly nowIso: string },
): OptimizationSavingsSummary {
  const allAvoided = records.flatMap((record) => record.avoidedCalls);
  const totals = summarizeAvoidedCalls(allAvoided);

  let cacheHits = 0;
  let cacheSavings = 0;
  let duplicateTokensRemoved = 0;
  let historyTokensRemoved = 0;
  let retrievalTokensAvoided = 0;
  let memoryTokensAvoided = 0;
  let completionTokensReduced = 0;
  let totalTokensSaved = 0;

  for (const record of records) {
    for (const decision of record.cacheDecisions) {
      if (decision.outcome !== 'hit') continue;
      cacheHits += 1;
      cacheSavings += decision.savedMicroUsd;
    }
    for (const optimization of record.optimizations) {
      duplicateTokensRemoved += optimization.duplicateTokensRemoved;
      historyTokensRemoved += optimization.historyTokensRemoved;
      retrievalTokensAvoided += optimization.retrievalTokensAvoided;
      memoryTokensAvoided += optimization.memoryTokensAvoided;
      completionTokensReduced += optimization.completionTokensReduced;
      totalTokensSaved += optimization.totalTokensSaved;
    }
  }

  return {
    source: 'durable_run_records',
    generatedAt: options.nowIso,
    avoidedCalls: totals.avoidedCalls,
    avoidedTokens: totals.avoidedTokens,
    avoidedMicroUsd: totals.avoidedMicroUsd,
    cacheHits,
    cacheSavingsMicroUsd: cacheSavings,
    duplicateTokensRemoved,
    historyTokensRemoved,
    retrievalTokensAvoided,
    memoryTokensAvoided,
    completionTokensReduced,
    totalTokensSaved,
    byReason: totals.byReason.map((bucket) => ({ ...bucket, reason: bucket.reason })),
    estimateVersions: [...new Set(allAvoided.map((record) => record.estimateVersion))].sort(),
  };
}
