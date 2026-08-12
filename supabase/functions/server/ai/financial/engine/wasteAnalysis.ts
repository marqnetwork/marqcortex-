/**
 * Waste analysis (AI-01 Batch 3B, Part 6C).
 *
 * ── PROTECTED WORK IS NEVER WASTE, AND THAT RULE COMES FIRST ──────────────
 *
 * Before any category is evaluated, every event marked `protectedWork` is
 * removed — mandatory workflow steps, safety and compliance work, and anything
 * bound to an approval a person gave. A compliance step the platform was obliged
 * to run is not money it should have avoided.
 *
 * This is not a courtesy to the safety team. A waste report is read by people
 * with budget authority, and a report that listed a mandatory governance check
 * among its top waste items would put cost pressure on precisely the work that
 * must never feel any. The filter runs first so that no category can reach
 * protected work even by accident.
 *
 * ── DETERMINISTIC CATEGORIES, DECLARED EVIDENCE ────────────────────────────
 *
 * Every category below is a filter over facts already on the event or supplied
 * as declared evidence. Nothing here infers intent, scores likelihood or asks a
 * model whether something looks wasteful. "This node was retried three times and
 * the run failed" is a fact; "this run seems inefficient" is an opinion, and an
 * opinion in a financial report is a liability.
 *
 * ── WASTE IS REPORTED, NEVER NETTED OFF ────────────────────────────────────
 *
 * Waste is not subtracted from savings anywhere. It sits beside them, because a
 * platform that saved 60% while burning 15% on failed retries has done two
 * things and a single netted number would describe neither. Netting also creates
 * the incentive to classify awkward spend as something other than waste.
 */

import type { FinancialEvent } from '../contracts/event.ts';
import { percentOf } from '../contracts/report.ts';

export const WASTE_CATEGORIES = [
  /** Attempts after the first, on a run that still failed. Money for nothing. */
  'failed_retry',
  /** Attempts after the first on a run that eventually succeeded. */
  'recovered_retry',
  /** A repair call to fix an unusable output. */
  'repair',
  /** An escalation to a higher band that did not change the outcome. */
  'unimproved_escalation',
  /** Branch work discarded by the join rather than merged. */
  'discarded_branch',
  /** Spend whose result a later policy change invalidated. */
  'invalidated_by_policy',
  /** Spend on a run a human or the platform cancelled. */
  'pre_cancellation',
  /** A second population of one reusable identity, where detectable. */
  'duplicate_population',
] as const;

export type WasteCategory = (typeof WASTE_CATEGORIES)[number];

/**
 * Facts the events cannot carry, supplied by the caller from its own records.
 *
 * Declared rather than inferred. Whether a branch was discarded is known to the
 * join policy, not to an accountant looking at spend, and guessing it from the
 * absence of a downstream event would misclassify every branch whose output was
 * merged but produced no further work.
 */
export interface WasteEvidence {
  /** Branch ids the join discarded rather than merged. */
  readonly discardedBranchIds?: readonly string[];
  /** Agent run ids whose escalation did not improve the outcome. */
  readonly unimprovedEscalationAgentRunIds?: readonly string[];
  /** Reusable result ids a later policy change invalidated. */
  readonly policyInvalidatedResultIds?: readonly string[];
  /** Event ids known to be a duplicate population of one identity. */
  readonly duplicatePopulationEventIds?: readonly string[];
}

export interface WasteEntry {
  readonly category: WasteCategory;
  readonly events: number;
  /** Settled spend in this category. Unsettled spend is not guessed at. */
  readonly actualSettledCostMicroUsd: number;
  /** Baseline of category events that never settled. The unknown part. */
  readonly unsettledBaselineMicroUsd: number;
}

export interface WasteReport {
  readonly entries: readonly WasteEntry[];
  readonly totalWasteSettledMicroUsd: number;
  /** Waste as a share of the window's settled spend. 0–100. */
  readonly wastePercentOfSettledSpend: number;
  /** Events excluded because the work was required. Reported, not hidden. */
  readonly protectedEventsExcluded: number;
  readonly protectedSettledCostMicroUsd: number;
}

function settled(event: FinancialEvent): number {
  return event.settlementState === 'settled' ? (event.actualCostMicroUsd ?? 0) : 0;
}

function unsettledBaseline(event: FinancialEvent): number {
  return event.settlementState === 'pending' || event.settlementState === 'unsettled_terminal'
    ? event.baselineCostMicroUsd
    : 0;
}

function entryFor(category: WasteCategory, events: readonly FinancialEvent[]): WasteEntry {
  return {
    category,
    events: events.length,
    actualSettledCostMicroUsd: events.reduce((total, event) => total + settled(event), 0),
    unsettledBaselineMicroUsd: events.reduce((total, event) => total + unsettledBaseline(event), 0),
  };
}

/**
 * Classify waste across a window.
 *
 * The categories are DISJOINT: an event lands in at most one, checked in a fixed
 * order, so the total is a sum rather than a union. Overlapping categories would
 * make "total waste" larger than the spend it describes, which is the same
 * double-count failure Part 6A's savings partition exists to prevent.
 */
export function analyzeWaste(
  events: readonly FinancialEvent[],
  evidence: WasteEvidence = {},
): WasteReport {
  const protectedEvents = events.filter((event) => event.protectedWork);
  const candidates = events.filter((event) => !event.protectedWork);

  const discarded = new Set(evidence.discardedBranchIds ?? []);
  const unimproved = new Set(evidence.unimprovedEscalationAgentRunIds ?? []);
  const invalidated = new Set(evidence.policyInvalidatedResultIds ?? []);
  const duplicates = new Set(evidence.duplicatePopulationEventIds ?? []);

  const buckets = new Map<WasteCategory, FinancialEvent[]>();
  const push = (category: WasteCategory, event: FinancialEvent): void => {
    const bucket = buckets.get(category);
    if (bucket === undefined) buckets.set(category, [event]);
    else bucket.push(event);
  };

  for (const event of candidates) {
    // Fixed order, first match wins. Disjoint by construction rather than by a
    // convention every future category would have to remember.
    if (duplicates.has(event.eventId)) {
      push('duplicate_population', event);
    } else if (
      event.reusableResultId !== undefined &&
      invalidated.has(event.reusableResultId)
    ) {
      push('invalidated_by_policy', event);
    } else if (event.outcome === 'cancelled') {
      push('pre_cancellation', event);
    } else if (event.branchId !== undefined && discarded.has(event.branchId)) {
      push('discarded_branch', event);
    } else if (event.agentRunId !== undefined && unimproved.has(event.agentRunId)) {
      push('unimproved_escalation', event);
    } else if (event.costCategory === 'repair') {
      push('repair', event);
    } else if (event.retryAttempt > 1) {
      // A retry that rescued a run is not the same as one that did not. Both are
      // real spend and both are reported; only one of them bought anything.
      push(event.outcome === 'succeeded' ? 'recovered_retry' : 'failed_retry', event);
    }
  }

  const entries = WASTE_CATEGORIES.filter((category) => buckets.has(category)).map((category) =>
    entryFor(category, buckets.get(category) ?? []),
  );

  const totalWasteSettled = entries.reduce(
    (total, entry) => total + entry.actualSettledCostMicroUsd,
    0,
  );
  const windowSettled = events.reduce((total, event) => total + settled(event), 0);

  return {
    entries,
    totalWasteSettledMicroUsd: totalWasteSettled,
    wastePercentOfSettledSpend: percentOf(totalWasteSettled, windowSettled),
    protectedEventsExcluded: protectedEvents.length,
    protectedSettledCostMicroUsd: protectedEvents.reduce(
      (total, event) => total + settled(event),
      0,
    ),
  };
}

/** Retry spend, isolated. Settled only — unmeasured retries are not guessed at. */
export function retryWasteMicroUsd(report: WasteReport): number {
  return report.entries
    .filter((entry) => entry.category === 'failed_retry' || entry.category === 'recovered_retry')
    .reduce((total, entry) => total + entry.actualSettledCostMicroUsd, 0);
}
