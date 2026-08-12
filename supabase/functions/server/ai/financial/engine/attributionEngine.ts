/**
 * Attribution (AI-01 Batch 3B, Part 6C).
 *
 * ── ONE DIMENSION AT A TIME, AND THE BUCKETS MUST SUM ─────────────────────
 *
 * `aggregateBy` partitions one event set along one dimension and REFUSES a
 * result whose buckets do not sum to the same totals the unpartitioned fold
 * produced. Not a warning — a thrown refusal, because a financial breakdown that
 * silently loses rows is worse than no breakdown at all.
 *
 * Refusing is cheap here because the partition is total by construction:
 * `bucketKeyFor` returns a key for every event in every dimension, sending the
 * ones a dimension does not apply to into the declared `(unattributed)` bucket.
 * The reconciliation therefore checks a property that should always hold, which
 * is exactly the kind of invariant worth asserting — the ones that only
 * sometimes hold get quietly relaxed.
 *
 * ── ACROSS DIMENSIONS THEY DO NOT SUM, AND NOTHING HERE LETS YOU TRY ──────
 *
 * Cost-by-workflow and cost-by-agent describe the same money. There is no
 * function in this module that combines two aggregates, no merge, no union, no
 * "total across breakdowns". A caller that wants both gets two independent
 * objects, each carrying the SAME grand total — which is the shape that makes
 * the mistake visible rather than plausible.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import type { AttributionDimension } from '../contracts/attribution.ts';
import { bucketKeyFor } from '../contracts/attribution.ts';
import type { FinancialTotals } from '../contracts/report.ts';
import { percentOf } from '../contracts/report.ts';
import { foldTotals } from './settlement.ts';
import { financialFailure } from '../contracts/failures.ts';

export interface AttributionBucket {
  readonly key: string;
  readonly totals: FinancialTotals;
  /** This bucket's settled spend as a share of the window's. 0–100. */
  readonly shareOfActualPercent: number;
}

export interface AttributionAggregate {
  readonly dimension: AttributionDimension;
  /** The window's totals. IDENTICAL across every dimension of the same events. */
  readonly totals: FinancialTotals;
  /** Sorted by settled spend descending, then key ascending. Reproducible. */
  readonly buckets: readonly AttributionBucket[];
}

/**
 * The fields that must survive a partition intact.
 *
 * Every one is a sum over events, so a partition that dropped, duplicated or
 * mis-bucketed a row shows up as a mismatch in at least one of them.
 */
const SUMMED_FIELDS: readonly (keyof FinancialTotals)[] = [
  'events',
  'baselineCostMicroUsd',
  'optimizedEstimatedCostMicroUsd',
  'actualSettledCostMicroUsd',
  'estimatedSavingsMicroUsd',
  'realizedSavingsMicroUsd',
  'realizedBaselineCostMicroUsd',
  'realizedFromAbsenceMicroUsd',
  'baselineTokens',
  'actualSettledTokens',
  'tokensAvoided',
  'unknownCostBaselineMicroUsd',
];

/**
 * Prove a partition, or refuse it.
 *
 * Exported so a caller can re-assert the property on an aggregate it received,
 * for the same reason `assertPlanNarrowsOnly` is exported in Part 6A: a claim
 * worth making should be checkable in one call rather than argued from a reading
 * of the implementation.
 */
export function reconcileAttribution(aggregate: AttributionAggregate): void {
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const bucket of aggregate.buckets) {
    if (seen.has(bucket.key)) problems.push(`bucket ${bucket.key} appears more than once`);
    seen.add(bucket.key);
  }

  for (const field of SUMMED_FIELDS) {
    const summed = aggregate.buckets.reduce((total, bucket) => total + bucket.totals[field], 0);
    if (summed !== aggregate.totals[field]) {
      problems.push(`${field}: buckets sum to ${summed}, window total is ${aggregate.totals[field]}`);
    }
  }

  if (problems.length > 0) {
    throw financialFailure(
      'financial_reconciliation_failed',
      'That financial breakdown does not reconcile with its own total.',
      { diagnostics: `${aggregate.dimension}: ${problems.join('; ')}` },
    );
  }
}

export function aggregateBy(
  events: readonly FinancialEvent[],
  dimension: AttributionDimension,
): AttributionAggregate {
  const totals = foldTotals(events);
  const grouped = new Map<string, FinancialEvent[]>();

  for (const event of events) {
    const key = bucketKeyFor(event, dimension);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [event]);
    else bucket.push(event);
  }

  const buckets: AttributionBucket[] = [...grouped.entries()]
    .map(([key, bucketEvents]) => {
      const bucketTotals = foldTotals(bucketEvents);
      return {
        key,
        totals: bucketTotals,
        shareOfActualPercent: percentOf(
          bucketTotals.actualSettledCostMicroUsd,
          totals.actualSettledCostMicroUsd,
        ),
      };
    })
    .sort(
      (a, b) =>
        b.totals.actualSettledCostMicroUsd - a.totals.actualSettledCostMicroUsd ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );

  const aggregate: AttributionAggregate = { dimension, totals, buckets };
  // Reconciled BEFORE it is returned, so an unbalanced breakdown never reaches a
  // caller. An aggregate is the worst place to discover an accounting defect: by
  // then it has been averaged into something that looks plausible.
  reconcileAttribution(aggregate);
  return aggregate;
}

/**
 * Savings by the reason Part 6A named, across the window.
 *
 * Reads `SavingsEntry` off each event rather than re-deriving a breakdown. Part
 * 6A already partitioned each task's one real gap across named categories and
 * refuses a partition that does not balance; re-deriving here would produce a
 * second partition of the same gap, and the two would eventually both be
 * counted. That is the exact double count Part 6A's design makes
 * unrepresentable, and it would be reintroduced by a helpful-looking function.
 */
export function savingsByCategory(
  events: readonly FinancialEvent[],
): Readonly<Record<string, { readonly microUsd: number; readonly tokens: number }>> {
  const byCategory: Record<string, { microUsd: number; tokens: number }> = {};
  for (const event of events) {
    for (const entry of event.savingsEntries) {
      const current = byCategory[entry.category] ?? { microUsd: 0, tokens: 0 };
      byCategory[entry.category] = {
        microUsd: current.microUsd + entry.microUsd,
        tokens: current.tokens + entry.tokens,
      };
    }
  }
  return byCategory;
}

/**
 * Prove the savings breakdown against the window's estimated saving.
 *
 * Part 6A guarantees each RECORD's categories sum to that record's estimated
 * saving. Summing across records preserves that, so the window's categories must
 * sum to the window's estimated saving — and if they do not, either an event
 * carried a partition Part 6A never produced or one was double-counted here.
 */
export function assertSavingsBreakdownBalances(events: readonly FinancialEvent[]): void {
  const totals = foldTotals(events);
  const byCategory = savingsByCategory(events);
  const attributed = Object.values(byCategory).reduce((sum, entry) => sum + entry.microUsd, 0);

  if (attributed !== totals.estimatedSavingsMicroUsd) {
    throw financialFailure(
      'financial_reconciliation_failed',
      'Savings categories do not sum to the estimated saving they partition.',
      {
        diagnostics:
          `categories sum to ${attributed}, estimated saving is ` +
          `${totals.estimatedSavingsMicroUsd}`,
      },
    );
  }
  if (attributed > totals.baselineCostMicroUsd) {
    throw financialFailure(
      'financial_reconciliation_failed',
      'Attributed savings exceed the baseline they were saved against.',
      { diagnostics: `attributed ${attributed} exceeds baseline ${totals.baselineCostMicroUsd}` },
    );
  }
}
