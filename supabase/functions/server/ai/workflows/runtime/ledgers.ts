/**
 * Workflow token ledger and avoided-call accounting (AI-01 Batch 3B).
 *
 * Three jobs, in the order a node performs them:
 *
 *   ESTIMATE, BEFORE. What will this node cost in tokens? The answer decides
 *   whether the node runs at all — a run projected to cross its ceiling is
 *   refused BEFORE the control plane is called, so the ceiling holds without a
 *   vendor request having been made. A limit enforced after the call is an
 *   accounting entry, not a control.
 *
 *   RECONCILE, AFTER. The provider reports what it actually used. The variance
 *   between estimate and actual is kept rather than discarded, because a
 *   systematically low estimator is a control that will eventually fail open and
 *   the only way to know is to keep the difference.
 *
 *   ATTRIBUTE. Every measured token lands on one row keyed by node, node type,
 *   agent, provider, model, profile and feature. Those are exactly the dimensions
 *   an invoice reconciliation and a per-workflow cost report need, and deriving
 *   them later from logs is the thing nobody ever gets to do.
 *
 * AVOIDED CALLS ARE A LEDGER, NOT A COUNTER.
 *
 * Every avoided call records what it was avoided INSTEAD OF: the profile, the
 * token counts, and the version of the estimate used to price them. So a saving
 * is always a subtraction between two numbers a reviewer can recompute. The one
 * failure mode this module is built to prevent is a "savings" figure nobody can
 * check, because that number only ever grows.
 *
 * PROVIDER-NEUTRAL BY CONSTRUCTION. Nothing here knows a vendor's usage field
 * names. It consumes `AITokenUsage`, the platform's own Batch 1 contract, and the
 * provider adapters are what translate a vendor's shape into it.
 */

import type { AITokenUsage } from '../../contracts/request.ts';
import type {
  AvoidedCallReason,
  WorkflowAvoidedCallRecord,
  WorkflowTokenLedger,
  WorkflowUsageAttribution,
} from '../contracts/runtime.ts';
import { WORKFLOW_HISTORY_BOUNDS } from '../contracts/runtime.ts';
import type { WorkflowNodeType } from '../contracts/workflow.ts';
import type { ModelProfile } from '../../agents/runtime/modelRouting.ts';
import { indicativeCostMicroUsd } from '../../agents/runtime/modelRouting.ts';

/** Version of the avoided-call pricing basis. Recorded on every record. */
export const AVOIDED_ESTIMATE_VERSION = 'indicative.profile.v1';

export function emptyWorkflowTokenLedger(): WorkflowTokenLedger {
  return {
    estimatedPromptTokens: 0,
    estimatedCompletionTokens: 0,
    estimatedTotalTokens: 0,
    actualPromptTokens: 0,
    actualCompletionTokens: 0,
    cachedTokens: 0,
    actualTotalTokens: 0,
    avoidedTokens: 0,
    reconciliationVarianceTokens: 0,
    attribution: [],
  };
}

export interface WorkflowTokenEstimate {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** Fold a node's ESTIMATE into the ledger. Called before the node runs. */
export function recordWorkflowEstimate(
  ledger: WorkflowTokenLedger,
  estimate: WorkflowTokenEstimate,
): WorkflowTokenLedger {
  return {
    ...ledger,
    estimatedPromptTokens: ledger.estimatedPromptTokens + estimate.promptTokens,
    estimatedCompletionTokens: ledger.estimatedCompletionTokens + estimate.completionTokens,
    estimatedTotalTokens: ledger.estimatedTotalTokens + estimate.totalTokens,
  };
}

export interface WorkflowAttributionKey {
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  readonly agentId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelProfileId: string;
  readonly feature: string;
}

/**
 * Fold measured usage into the ledger and reconcile it against the estimate.
 *
 * The attribution row is merged by its FULL key, so repeated calls on the same
 * (node, agent, provider, model, profile, feature) accumulate rather than
 * multiplying rows. Past the row bound the totals still accumulate on the ledger
 * itself and further rows are dropped: a bounded record that under-reports its
 * own breakdown is better than an unbounded one that cannot be written at all,
 * and a run cannot legitimately reach 48 distinct keys inside its step ceiling
 * without something already having gone wrong.
 */
export function reconcileWorkflowUsage(
  ledger: WorkflowTokenLedger,
  input: {
    readonly estimate: WorkflowTokenEstimate;
    readonly usage: AITokenUsage;
    readonly cachedTokens?: number;
    readonly costMicroUsd: number;
    readonly key: WorkflowAttributionKey;
  },
): WorkflowTokenLedger {
  const cached = Math.max(0, Math.floor(input.cachedTokens ?? 0));
  const variance = input.usage.totalTokens - input.estimate.totalTokens;

  const sameRow = (row: WorkflowUsageAttribution): boolean =>
    row.nodeId === input.key.nodeId &&
    row.nodeType === input.key.nodeType &&
    row.agentId === input.key.agentId &&
    row.providerId === input.key.providerId &&
    row.modelId === input.key.modelId &&
    row.modelProfileId === input.key.modelProfileId &&
    row.feature === input.key.feature;

  const existing = ledger.attribution.find(sameRow);

  let attribution: readonly WorkflowUsageAttribution[];
  if (existing) {
    attribution = ledger.attribution.map((row) =>
      row === existing
        ? {
            ...row,
            promptTokens: row.promptTokens + input.usage.promptTokens,
            completionTokens: row.completionTokens + input.usage.completionTokens,
            cachedTokens: row.cachedTokens + cached,
            totalTokens: row.totalTokens + input.usage.totalTokens,
            costMicroUsd: row.costMicroUsd + input.costMicroUsd,
            calls: row.calls + 1,
          }
        : row,
    );
  } else if (ledger.attribution.length < WORKFLOW_HISTORY_BOUNDS.attributionRows) {
    attribution = [
      ...ledger.attribution,
      {
        ...input.key,
        promptTokens: input.usage.promptTokens,
        completionTokens: input.usage.completionTokens,
        cachedTokens: cached,
        totalTokens: input.usage.totalTokens,
        costMicroUsd: input.costMicroUsd,
        calls: 1,
      },
    ];
  } else {
    attribution = ledger.attribution;
  }

  return {
    ...ledger,
    actualPromptTokens: ledger.actualPromptTokens + input.usage.promptTokens,
    actualCompletionTokens: ledger.actualCompletionTokens + input.usage.completionTokens,
    cachedTokens: ledger.cachedTokens + cached,
    actualTotalTokens: ledger.actualTotalTokens + input.usage.totalTokens,
    reconciliationVarianceTokens: ledger.reconciliationVarianceTokens + variance,
    attribution,
  };
}

/** Credit tokens a call never spent. Never charged, only recorded. */
export function recordAvoidedTokens(
  ledger: WorkflowTokenLedger,
  tokens: number,
): WorkflowTokenLedger {
  return { ...ledger, avoidedTokens: ledger.avoidedTokens + Math.max(0, Math.floor(tokens)) };
}

export interface AvoidedCallInput {
  readonly nodeId: string;
  readonly branchId?: string;
  readonly at: string;
  readonly reason: AvoidedCallReason;
  readonly avoidedCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /**
   * The profile the avoided call would have used. Required: a saving that cannot
   * name what it was measured against is a number somebody made up, and the
   * registry already refuses a transform that claims one without naming a
   * profile.
   */
  readonly profile: ModelProfile;
}

/**
 * Build one avoided-call record, priced against the profile's declared rate.
 *
 * The rate is the profile's INDICATIVE, upper-bound planning figure — the same
 * one the cost projection uses before a call. Using the same basis for the saving
 * and the projection is what makes "we avoided what we would have spent" true
 * rather than approximately true in an unspecified direction.
 */
export function buildAvoidedCallRecord(input: AvoidedCallInput): WorkflowAvoidedCallRecord {
  const promptTokens = Math.max(0, Math.floor(input.promptTokens));
  const completionTokens = Math.max(0, Math.floor(input.completionTokens));
  return {
    nodeId: input.nodeId,
    ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
    at: input.at,
    reason: input.reason,
    avoidedCalls: Math.max(0, Math.floor(input.avoidedCalls)),
    avoidedPromptTokens: promptTokens,
    avoidedCompletionTokens: completionTokens,
    avoidedMicroUsd: indicativeCostMicroUsd(input.profile, promptTokens, completionTokens),
    comparedAgainstProfileId: input.profile.profileId,
    estimateVersion: AVOIDED_ESTIMATE_VERSION,
  };
}

export interface AvoidedCallTotals {
  readonly avoidedCalls: number;
  readonly avoidedTokens: number;
  readonly avoidedMicroUsd: number;
  /** Per-reason breakdown, sorted by reason so the output is deterministic. */
  readonly byReason: readonly {
    readonly reason: AvoidedCallReason;
    readonly avoidedCalls: number;
    readonly avoidedTokens: number;
    readonly avoidedMicroUsd: number;
  }[];
}

export function summarizeAvoidedCalls(
  records: readonly WorkflowAvoidedCallRecord[],
): AvoidedCallTotals {
  const byReason = new Map<
    AvoidedCallReason,
    { avoidedCalls: number; avoidedTokens: number; avoidedMicroUsd: number }
  >();

  let avoidedCalls = 0;
  let avoidedTokens = 0;
  let avoidedMicroUsd = 0;

  for (const record of records) {
    const tokens = record.avoidedPromptTokens + record.avoidedCompletionTokens;
    avoidedCalls += record.avoidedCalls;
    avoidedTokens += tokens;
    avoidedMicroUsd += record.avoidedMicroUsd;
    const bucket = byReason.get(record.reason) ?? {
      avoidedCalls: 0,
      avoidedTokens: 0,
      avoidedMicroUsd: 0,
    };
    bucket.avoidedCalls += record.avoidedCalls;
    bucket.avoidedTokens += tokens;
    bucket.avoidedMicroUsd += record.avoidedMicroUsd;
    byReason.set(record.reason, bucket);
  }

  return {
    avoidedCalls,
    avoidedTokens,
    avoidedMicroUsd,
    byReason: [...byReason.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, totals]) => ({ reason, ...totals })),
  };
}

/** Append to a bounded ring, dropping the oldest when it is full. */
export function appendBounded<T>(existing: readonly T[], entry: T, bound: number): readonly T[] {
  const next = [...existing, entry];
  return next.length > bound ? next.slice(next.length - bound) : next;
}
