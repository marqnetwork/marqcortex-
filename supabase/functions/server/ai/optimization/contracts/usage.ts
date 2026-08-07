/**
 * Actual usage accounting contracts (AI-01 Batch 3B, Part 6A).
 *
 * ── ONE PORT, AND WHY IT IS ONE PORT ───────────────────────────────────────
 *
 * Parts 4 and 5 wrote zeroes into `tokensPlaceholder` and
 * `costMicroUsdPlaceholder` and said plainly that they were placeholders,
 * because branch-level accounting needs the child agent runs' own spend and
 * inventing a number would have been worse than reporting none. This is where
 * the real numbers arrive.
 *
 * They arrive through exactly one seam. The alternative — every consumer reading
 * `AgentRunRecord.tokens` for itself, or worse, reaching into a provider adapter
 * for the vendor's usage block — would mean several independent opinions about
 * what a run cost, differing by whether each remembered retries, cached tokens
 * or a repair call. The port is the reason "what did this workflow spend" has
 * one answer.
 *
 * ── ATTRIBUTION IS KEYED, AND THAT IS THE IDEMPOTENCY ──────────────────────
 *
 * A workflow polls a child agent run many times. The child's ledger is
 * CUMULATIVE, so folding it in on every poll would multiply a run's cost by the
 * number of times an operator refreshed a console. Every `UsageObservation`
 * therefore carries the child run's id and its CUMULATIVE totals, and the fold
 * stores the last figure attributed to that key and applies only the delta.
 *
 * That one decision buys three of this batch's requirements at once:
 *
 *   RESTART IDEMPOTENCY   A recovered isolate re-drives the same child, observes
 *                         the same cumulative totals, computes a zero delta and
 *                         changes nothing. Attribution survives a crash without
 *                         a dedupe table or a distributed lock.
 *
 *   RETRIES ARE REAL SPEND  A retry is a NEW child agent run with a NEW id, so
 *                         it is a new key and its cost adds. Money spent on an
 *                         attempt that failed is money spent, and a ledger that
 *                         quietly kept only the successful attempt would report
 *                         savings the invoice does not agree with.
 *
 *   APPROVALS COST NOTHING  An approval that ran no inference produces no
 *                         observation at all, so it contributes zero — by having
 *                         nothing to contribute rather than by a rule saying so.
 *
 * ── TENANT ISOLATION IS CHECKED HERE, NOT ASSUMED UPSTREAM ─────────────────
 *
 * Every observation names its organization and every ledger names the one it
 * belongs to. A mismatch is a typed refusal, not a log line. Cost data is
 * commercially sensitive and an accounting layer that accepted a stray
 * observation would be a cross-tenant leak that looked like a rounding error.
 */

import type { CompressionError } from './compression.ts';
import { compressionFailure } from './compression.ts';

/** The scopes a usage figure rolls up through. Ordered narrow to wide. */
export const USAGE_SCOPES = [
  'child_agent_run',
  'workflow_node',
  'workflow_branch',
  'parallel_group',
  'workflow_run',
] as const;

export type UsageScope = (typeof USAGE_SCOPES)[number];

/** Measured usage. Never an estimate — the fields are named so it cannot drift. */
export interface ActualUsage {
  readonly actualInputTokens: number;
  readonly actualOutputTokens: number;
  readonly actualTotalTokens: number;
  readonly actualCostMicroUsd: number;
}

export function emptyActualUsage(): ActualUsage {
  return {
    actualInputTokens: 0,
    actualOutputTokens: 0,
    actualTotalTokens: 0,
    actualCostMicroUsd: 0,
  };
}

export function addActualUsage(left: ActualUsage, right: ActualUsage): ActualUsage {
  return {
    actualInputTokens: left.actualInputTokens + right.actualInputTokens,
    actualOutputTokens: left.actualOutputTokens + right.actualOutputTokens,
    actualTotalTokens: left.actualTotalTokens + right.actualTotalTokens,
    actualCostMicroUsd: left.actualCostMicroUsd + right.actualCostMicroUsd,
  };
}

/**
 * One observation of a child agent run's CUMULATIVE spend.
 *
 * Cumulative, not incremental, and that is load-bearing: an incremental report
 * would require the reporter to remember what it had already reported, which is
 * exactly the state an isolate loses when it is recycled.
 */
export interface UsageObservation {
  readonly organizationId: string;
  /** The child agent run. The idempotency key of the whole mechanism. */
  readonly agentRunId: string;
  /** The workflow node the child served. */
  readonly nodeId: string;
  /** Set when the child ran inside a parallel branch. */
  readonly branchId?: string;
  /** Set when the child ran inside a parallel group. */
  readonly groupId?: string;
  /** Which attempt of the node this child was. Starts at 1. */
  readonly attempt: number;
  /** The child's totals SO FAR, from the agent runtime's own ledgers. */
  readonly cumulative: ActualUsage;
}

/**
 * One attributed row: what a single child agent run has cost so far.
 *
 * `attributed` is what the ledger has already folded in for this key, which is
 * what makes the next fold a delta rather than a duplicate.
 */
export interface UsageAttributionRow {
  readonly agentRunId: string;
  readonly nodeId: string;
  readonly branchId?: string;
  readonly groupId?: string;
  readonly attempt: number;
  readonly attributed: ActualUsage;
}

/**
 * The durable usage ledger for one workflow run.
 *
 * Bounded by construction: a run cannot exceed `WORKFLOW_RUN_BOUNDS.maxNodeExecutions`
 * node executions and each one creates at most one child agent run, so the row
 * count is bounded by the same ceiling that already bounds the step history.
 */
export interface UsageLedger {
  readonly organizationId: string;
  readonly totals: ActualUsage;
  readonly rows: readonly UsageAttributionRow[];
}

export function emptyUsageLedger(organizationId: string): UsageLedger {
  return { organizationId, totals: emptyActualUsage(), rows: [] };
}

/** Refuse an observation that belongs to another tenant. */
export function assertSameTenant(
  ledger: UsageLedger,
  observation: UsageObservation,
): CompressionError | undefined {
  if (ledger.organizationId === observation.organizationId) return undefined;
  return compressionFailure(
    'usage_tenant_mismatch',
    'That usage record belongs to a different organization.',
    {
      diagnostics:
        `ledger organization ${ledger.organizationId} received an observation for ` +
        `${observation.organizationId} (agent run ${observation.agentRunId})`,
    },
  );
}
