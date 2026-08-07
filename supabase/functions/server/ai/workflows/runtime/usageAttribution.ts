/**
 * Workflow usage attribution (AI-01 Batch 3B, Part 6A).
 *
 * ── WHAT THIS MODULE IS, IN ONE SENTENCE ───────────────────────────────────
 *
 * It is the workflow engine's adapter onto the platform's single trusted
 * accounting port, and it contains no accounting of its own.
 *
 * Every arithmetic decision — how a cumulative observation becomes a delta, why
 * a repeat contributes nothing, why a retry contributes fully, how a branch
 * total is derived rather than stored — lives in
 * `optimization/accounting/usageAccounting.ts` and is documented there. What
 * lives HERE is the translation from an `AgentNodeHandle` to a
 * `UsageObservation`, and nothing else.
 *
 * That split is the point. Two components fold usage into two ledgers — the
 * agent runtime into its own run record, the workflow engine into this one — and
 * if each carried its own fold, the two would eventually disagree about whether
 * a cached token counts or whether a repair call was a separate call. One
 * implementation, two callers, one answer.
 *
 * ── PURE, LIKE THE RETRY POLICY NEXT DOOR ──────────────────────────────────
 *
 * No store, no clock, no agent orchestrator. It takes a record and a handle and
 * returns a record. The engine persists the result in the SAME compare-and-swap
 * as the state change it accompanies, which is what stops the usage figure and
 * the state it describes from being written separately and disagreeing after a
 * crash between the two.
 */

import type { ActualUsage, UsageLedger } from '../../optimization/contracts/usage.ts';
import { emptyActualUsage } from '../../optimization/contracts/usage.ts';
import { attributeUsage, rollupUsage } from '../../optimization/accounting/usageAccounting.ts';
import type { AgentNodeUsage } from '../engine/agentNodePort.ts';
import type { WorkflowRunRecord } from '../contracts/run.ts';

export interface UsageAttributionInput {
  /** The child agent run this observation is about. The idempotency key. */
  readonly agentRunId: string;
  readonly nodeId: string;
  readonly branchId?: string;
  readonly groupId?: string;
  /** Which attempt of the node this child was. Starts at 1. */
  readonly attempt: number;
  /** The child's cumulative spend, or absent when it reported none. */
  readonly usage?: AgentNodeUsage;
}

/**
 * Fold a child agent run's cumulative spend into the run's ledger.
 *
 * Returns the record UNCHANGED when the child reported no usage. That is not a
 * defensive convenience — it is how approvals stay free: an approval node runs
 * no inference, so its handle carries no usage, so it contributes nothing by
 * having nothing to contribute rather than by a rule that could be forgotten.
 *
 * Throws `usage_tenant_mismatch` if the observation is not the run's own
 * organization. The check lives in the port; this passes the record's
 * organization through so the port can make it.
 */
export function absorbChildUsage(
  record: WorkflowRunRecord,
  input: UsageAttributionInput,
): WorkflowRunRecord {
  if (input.usage === undefined) return record;

  const result = attributeUsage(record.usage, {
    organizationId: record.context.organizationId,
    agentRunId: input.agentRunId,
    nodeId: input.nodeId,
    ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
    ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
    attempt: input.attempt,
    cumulative: {
      actualInputTokens: input.usage.inputTokens,
      actualOutputTokens: input.usage.outputTokens,
      actualTotalTokens: input.usage.totalTokens,
      actualCostMicroUsd: input.usage.costMicroUsd,
    },
  });

  // A no-op fold returns the SAME record object, so a re-drive of an unchanged
  // child cannot burn a run version through this path. The engine already
  // declines to write for a merely-blocked child; this keeps that property true
  // for a completed child observed twice, which is what a restart produces.
  return result.idempotent && result.applied.actualTotalTokens === 0
    ? record
    : { ...record, usage: result.ledger };
}

/** Spend attributable to one branch. Derived from the ledger, never stored. */
export function branchUsage(ledger: UsageLedger, branchId: string): ActualUsage {
  return rollupUsage(ledger, { scope: 'workflow_branch', id: branchId });
}

/** Spend attributable to one parallel group. Derived, never stored. */
export function groupUsage(ledger: UsageLedger, groupId: string): ActualUsage {
  return rollupUsage(ledger, { scope: 'parallel_group', id: groupId });
}

/** Spend attributable to one node, across every attempt and every visit. */
export function nodeUsage(ledger: UsageLedger, nodeId: string): ActualUsage {
  return rollupUsage(ledger, { scope: 'workflow_node', id: nodeId });
}

/** The run's own total. The sum of every applied delta. */
export function runUsage(ledger: UsageLedger | undefined): ActualUsage {
  // Records written before Part 6A have no ledger. A reader must treat that as
  // "not measured", never as "measured zero" — the two are different claims and
  // only one of them is true of a run that predates the accounting.
  return ledger === undefined ? emptyActualUsage() : ledger.totals;
}
