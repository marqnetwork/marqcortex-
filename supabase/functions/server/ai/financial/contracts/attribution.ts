/**
 * Attribution dimensions (AI-01 Batch 3B, Part 6C).
 *
 * ── DOLLARS ARE PARTITIONED, NEVER COPIED ──────────────────────────────────
 *
 * Every dimension below partitions the SAME event set. Within one dimension, an
 * event lands in exactly one bucket, so the buckets sum to the total exactly —
 * and `engine/attributionEngine.ts` refuses an aggregate that does not.
 *
 * ACROSS dimensions, they do not sum. Cost-by-workflow and cost-by-agent
 * describe the same money twice, and adding them is how a report claims a
 * platform spent double what it spent. That is the single easiest financial
 * mistake to make and the hardest to spot afterwards, because each half looks
 * right. So an aggregate carries its dimension, carries its own total, and
 * provides no operation that combines two of them.
 *
 * ── EVERY EVENT LANDS SOMEWHERE, INCLUDING THE ONES THAT DO NOT FIT ────────
 *
 * An event with no branch id does not participate in a by-branch view. Dropping
 * it would make the by-branch buckets sum to less than the total, and a
 * reconciliation that tolerated the shortfall would tolerate any shortfall. So
 * it lands in the declared `UNATTRIBUTED` bucket instead: visible, counted, and
 * summing correctly. A large unattributed bucket is information — it says the
 * dimension does not apply to most of the workload — rather than a silent gap.
 */

import type { FinancialEvent } from './event.ts';

export const ATTRIBUTION_DIMENSIONS = [
  'organization',
  'actor',
  'workflow',
  'workflow_version',
  'workflow_run',
  'node',
  'branch',
  'agent',
  'agent_version',
  'feature',
  'capability_profile',
  'provider',
  'model',
  'outcome',
  'decision',
  'optimization_reason',
  'reuse_type',
  'retry_attempt',
  'cost_category',
  'settlement_state',
] as const;

export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];

/**
 * The bucket for events to which a dimension does not apply.
 *
 * A declared bucket rather than a dropped row, so the partition still sums.
 */
export const UNATTRIBUTED = '(unattributed)';

/**
 * Which bucket does this event belong to, in this dimension?
 *
 * Total: every event has exactly one bucket in every dimension. A composite
 * dimension such as `workflow_version` uses a joined key rather than the bare
 * version, because version `4` of two different workflows is two different
 * things and a bare key would merge their money.
 */
export function bucketKeyFor(event: FinancialEvent, dimension: AttributionDimension): string {
  switch (dimension) {
    case 'organization':
      return event.organizationId;
    case 'actor':
      return event.actorId;
    case 'workflow':
      return event.workflowId ?? UNATTRIBUTED;
    case 'workflow_version':
      return event.workflowId === undefined || event.workflowVersion === undefined
        ? UNATTRIBUTED
        : `${event.workflowId}@${event.workflowVersion}`;
    case 'workflow_run':
      return event.workflowRunId ?? UNATTRIBUTED;
    case 'node':
      // Scoped by workflow, because node `summarize` in two workflows is two
      // different nodes and a bare id would pool their spend.
      return event.nodeId === undefined
        ? UNATTRIBUTED
        : `${event.workflowId ?? UNATTRIBUTED}/${event.nodeId}`;
    case 'branch':
      return event.branchId ?? UNATTRIBUTED;
    case 'agent':
      return event.agentId ?? UNATTRIBUTED;
    case 'agent_version':
      return event.agentId === undefined || event.agentVersion === undefined
        ? UNATTRIBUTED
        : `${event.agentId}@${event.agentVersion}`;
    case 'feature':
      return event.featureId ?? UNATTRIBUTED;
    case 'capability_profile':
      return event.capabilityProfile ?? UNATTRIBUTED;
    case 'provider':
      return event.provider.providerName ?? UNATTRIBUTED;
    case 'model':
      return event.provider.modelName === undefined
        ? UNATTRIBUTED
        : `${event.provider.providerName ?? UNATTRIBUTED}/${event.provider.modelName}`;
    case 'outcome':
      return event.outcome;
    case 'decision':
      return event.decision;
    case 'optimization_reason':
      return event.decisionReason;
    case 'reuse_type':
      return event.reuseType ?? UNATTRIBUTED;
    case 'retry_attempt':
      return String(event.retryAttempt);
    case 'cost_category':
      return event.costCategory;
    case 'settlement_state':
      return event.settlementState;
  }
}
