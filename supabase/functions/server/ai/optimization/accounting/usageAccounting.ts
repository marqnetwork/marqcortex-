/**
 * The one trusted accounting port (AI-01 Batch 3B, Part 6A).
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * `tokensPlaceholder: 0` and `costMicroUsdPlaceholder: 0`, written by Parts 4
 * and 5 with a comment saying plainly that a number invented there would be a
 * number somebody eventually believed. This module is where the real numbers
 * come from, and `contracts/usage.ts` explains why there is exactly one of it.
 *
 * ── THE FOLD IS A DELTA, AND EVERYTHING FOLLOWS FROM THAT ──────────────────
 *
 * A child agent run reports its ledger CUMULATIVELY. The workflow engine polls
 * that child repeatedly — once per advance, once per operator refresh, once more
 * after a restart. Folding the cumulative figure in each time would multiply a
 * run's cost by the number of times somebody looked at it.
 *
 * So `attributeUsage` stores what it has already credited to each child run id
 * and applies only the difference. Four of this batch's requirements fall out of
 * that single decision:
 *
 *   RESTART IDEMPOTENCY   Re-observing the same child yields a zero delta.
 *   RETRIES ARE SPEND     A retry is a new child run id, so it is a new row.
 *   APPROVALS ARE FREE    An approval that ran no inference makes no
 *                         observation, so it contributes nothing — by absence,
 *                         not by a rule that could be forgotten.
 *   OUT-OF-ORDER IS SAFE  A stale observation carrying LOWER totals than one
 *                         already credited is ignored rather than applied as a
 *                         negative delta. Money does not un-spend.
 *
 * ── ROLLUP IS DERIVED, NEVER STORED TWICE ──────────────────────────────────
 *
 * Node, branch, group and run totals are all computed from the same rows by
 * filtering. There is no second place where a branch total is accumulated, so
 * there is no second place for it to disagree with the run total. A stored
 * per-branch counter maintained alongside the ledger would be exactly that
 * second place.
 */

import type {
  ActualUsage,
  UsageAttributionRow,
  UsageLedger,
  UsageObservation,
  UsageScope,
} from '../contracts/usage.ts';
import { addActualUsage, assertSameTenant, emptyActualUsage } from '../contracts/usage.ts';

/**
 * Rows one ledger keeps.
 *
 * Matched to `WORKFLOW_RUN_BOUNDS.maxNodeExecutions`: a run cannot execute more
 * nodes than that and each execution creates at most one child agent run, so the
 * ceiling is the same ceiling that already bounds the step history rather than a
 * new one invented here.
 */
export const MAX_USAGE_ROWS = 256;

function nonNegative(usage: ActualUsage): ActualUsage {
  return {
    actualInputTokens: Math.max(0, Math.floor(usage.actualInputTokens)),
    actualOutputTokens: Math.max(0, Math.floor(usage.actualOutputTokens)),
    actualTotalTokens: Math.max(0, Math.floor(usage.actualTotalTokens)),
    actualCostMicroUsd: Math.max(0, Math.floor(usage.actualCostMicroUsd)),
  };
}

/** The increase from `previous` to `current`, floored at zero per field. */
function delta(previous: ActualUsage, current: ActualUsage): ActualUsage {
  return {
    actualInputTokens: Math.max(0, current.actualInputTokens - previous.actualInputTokens),
    actualOutputTokens: Math.max(0, current.actualOutputTokens - previous.actualOutputTokens),
    actualTotalTokens: Math.max(0, current.actualTotalTokens - previous.actualTotalTokens),
    actualCostMicroUsd: Math.max(0, current.actualCostMicroUsd - previous.actualCostMicroUsd),
  };
}

export interface AttributionResult {
  readonly ledger: UsageLedger;
  /** What this observation actually added. Zero on a repeat. */
  readonly applied: ActualUsage;
  /** True when the observation changed nothing — a repeat or a stale read. */
  readonly idempotent: boolean;
}

/**
 * Fold one child agent run's cumulative usage into the ledger.
 *
 * PURE: takes a ledger, returns a ledger. The caller persists it in the same
 * versioned write as whatever else the advance changed, which is what keeps the
 * usage figure and the state it describes from being written separately and
 * disagreeing after a crash between the two.
 *
 * Throws `usage_tenant_mismatch` when the observation belongs to a different
 * organization. Cost data is commercially sensitive, and an accounting layer
 * that accepted a stray observation would be a cross-tenant leak that looked
 * like a rounding error.
 */
export function attributeUsage(
  ledger: UsageLedger,
  observation: UsageObservation,
): AttributionResult {
  const mismatch = assertSameTenant(ledger, observation);
  if (mismatch !== undefined) throw mismatch;

  const cumulative = nonNegative(observation.cumulative);
  const existing = ledger.rows.find((row) => row.agentRunId === observation.agentRunId);

  if (existing === undefined && ledger.rows.length >= MAX_USAGE_ROWS) {
    // The totals still accumulate; only the per-child breakdown is dropped. A
    // bounded record that under-reports its own breakdown is better than one
    // that cannot be written — the same call `tokenIntelligence.ts` makes about
    // its attribution rows, and for the same reason.
    return {
      ledger: { ...ledger, totals: addActualUsage(ledger.totals, cumulative) },
      applied: cumulative,
      idempotent: false,
    };
  }

  const previous = existing?.attributed ?? emptyActualUsage();
  const applied = delta(previous, cumulative);
  const idempotent =
    applied.actualTotalTokens === 0 &&
    applied.actualCostMicroUsd === 0 &&
    applied.actualInputTokens === 0 &&
    applied.actualOutputTokens === 0;

  const row: UsageAttributionRow = {
    agentRunId: observation.agentRunId,
    nodeId: observation.nodeId,
    ...(observation.branchId === undefined ? {} : { branchId: observation.branchId }),
    ...(observation.groupId === undefined ? {} : { groupId: observation.groupId }),
    attempt: observation.attempt,
    // The stored figure is the HIGH-WATER MARK, so a stale observation carrying
    // lower totals cannot walk a row backwards and then re-credit the same spend
    // when the fresh one arrives.
    attributed: existing === undefined ? cumulative : addActualUsage(previous, applied),
  };

  return {
    ledger: {
      organizationId: ledger.organizationId,
      totals: addActualUsage(ledger.totals, applied),
      rows:
        existing === undefined
          ? [...ledger.rows, row]
          : ledger.rows.map((current) =>
              current.agentRunId === observation.agentRunId ? row : current,
            ),
    },
    applied,
    idempotent,
  };
}

export interface UsageRollupQuery {
  readonly scope: UsageScope;
  /** The scope's identifier: a node id, branch id, group id or agent run id. */
  readonly id?: string;
}

/**
 * Total usage within a scope.
 *
 * Derived by filtering the rows, never by reading a stored counter — see the
 * header for why a second accumulator would be a second thing to disagree with
 * the first. `workflow_run` ignores `id` and returns the ledger's own totals,
 * which are the sum of every applied delta including any that fell past
 * `MAX_USAGE_ROWS`.
 */
export function rollupUsage(ledger: UsageLedger, query: UsageRollupQuery): ActualUsage {
  if (query.scope === 'workflow_run') return ledger.totals;

  const matches = (row: UsageAttributionRow): boolean => {
    switch (query.scope) {
      case 'child_agent_run':
        return row.agentRunId === query.id;
      case 'workflow_node':
        return row.nodeId === query.id;
      case 'workflow_branch':
        return row.branchId === query.id;
      case 'parallel_group':
        return row.groupId === query.id;
      default:
        return false;
    }
  };

  return ledger.rows
    .filter(matches)
    .reduce<ActualUsage>((total, row) => addActualUsage(total, row.attributed), emptyActualUsage());
}

/**
 * Every scope identifier present in the ledger, for a given scope kind.
 *
 * Sorted, so a report over a ledger is reproducible rather than dependent on the
 * order children happened to finish in.
 */
export function usageScopeIds(ledger: UsageLedger, scope: UsageScope): readonly string[] {
  const ids = new Set<string>();
  for (const row of ledger.rows) {
    const id =
      scope === 'child_agent_run'
        ? row.agentRunId
        : scope === 'workflow_node'
          ? row.nodeId
          : scope === 'workflow_branch'
            ? row.branchId
            : scope === 'parallel_group'
              ? row.groupId
              : undefined;
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * Usage spent on attempts after the first — retry spend, isolated.
 *
 * Not subtracted from anything and not netted off. It is reported so that a
 * savings figure can be read next to the money the platform spent trying again,
 * which is the number an inflated ledger most wants to leave out.
 */
export function retryUsage(ledger: UsageLedger): ActualUsage {
  return ledger.rows
    .filter((row) => row.attempt > 1)
    .reduce<ActualUsage>((total, row) => addActualUsage(total, row.attributed), emptyActualUsage());
}
