/**
 * Deriving financial events (AI-01 Batch 3B, Part 6C).
 *
 * ── THE ENGINE IS NOT TOLD WHAT SOMETHING COST ─────────────────────────────
 *
 * Every figure on a `FinancialEvent` is READ from an artefact an earlier part
 * already produced under its own controls:
 *
 *   baseline, optimised, savings partition   Part 6A `CompressionPlan`, whose
 *                                            baseline model cannot see the
 *                                            result it is the denominator of
 *                                            and whose ledger refuses an
 *                                            unbalanced partition.
 *
 *   measured spend                           Part 6A `UsageAttributionRow`,
 *                                            folded by the one accounting port
 *                                            that applies deltas rather than
 *                                            cumulative totals.
 *
 *   avoided calls                            Part 6B `AvoidedCallEntry`, which
 *                                            already refuses a second entry for
 *                                            one task.
 *
 * There is no parameter through which a caller can state a cost or a saving.
 * That is what makes Part 6C a VIEW of the platform's accounting rather than a
 * second opinion about it — and it is why the boundary scan asserts this tree
 * never builds a savings record of its own.
 *
 * ── THE EVENT ID IS DERIVED, SO REPORTING CANNOT INFLATE ANYTHING ──────────
 *
 * `eventId` is a digest of the identity that makes the event unique: tenant,
 * run, node, branch, attempt, category and type. Re-deriving from the same
 * artefacts produces the same id, and the store's insert-if-absent refuses the
 * duplicate. A workflow advance that runs twice after a restart, an operator who
 * refreshes a console, a report regenerated nightly — none of them can add a
 * second row for one piece of spend.
 *
 * This is the same technique Part 6B used for reusable results, and it is used
 * here for the same reason: an identity that is computed cannot be minted twice.
 *
 * ── SETTLEMENT IS DECIDED HERE, ONCE ───────────────────────────────────────
 *
 * An inference with a measured row is `settled` / `provider_reported`. An
 * avoided call is `settled` / `measured_absence` — nothing was spent, and that
 * is a measurement rather than an assumption. An inference with no measured row
 * is `pending` while its run is live and `unsettled_terminal` once the run has
 * finished without one, because those are different facts and only the second
 * one is permanent.
 *
 * A refusal is `not_applicable` and claims NOTHING: zero baseline, zero saving.
 * Work the platform declined to do is not work the platform saved money on.
 */

import { canonicalJson, digestText } from '../../agents/runtime/digest.ts';
import type { CompressionPlan } from '../../optimization/costCompressionEngine.ts';
import type { UsageAttributionRow } from '../../optimization/contracts/usage.ts';
import type { AvoidedCallEntry } from '../../reuse/accounting/avoidedCallLedger.ts';
import type {
  CostCategory,
  FinancialEvent,
  FinancialOutcome,
  ProviderIdentity,
  SettlementBasis,
  SettlementState,
} from '../contracts/event.ts';
import { FINANCIAL_EVENT_SCHEMA, isWholeFinancialEvent } from '../contracts/event.ts';
import { financialFailure } from '../contracts/failures.ts';

/** The identity that makes one financial event unique. */
export interface FinancialEventIdentity {
  readonly organizationId: string;
  readonly eventType: FinancialEvent['eventType'];
  readonly costCategory: CostCategory;
  readonly workflowRunId?: string;
  readonly nodeId?: string;
  readonly branchId?: string;
  readonly agentRunId?: string;
  readonly retryAttempt: number;
  /** For work outside a workflow run, the task the plan was produced for. */
  readonly taskId?: string;
}

/**
 * The derived event id.
 *
 * A digest rather than a concatenation, so the id has a fixed shape whatever the
 * identifiers look like, and so it cannot be parsed back into tenant data by
 * anything that happens to receive it.
 */
export function financialEventIdFor(identity: FinancialEventIdentity): string {
  const canonical = canonicalJson({
    v: 1,
    organizationId: identity.organizationId,
    eventType: identity.eventType,
    costCategory: identity.costCategory,
    workflowRunId: identity.workflowRunId ?? null,
    nodeId: identity.nodeId ?? null,
    branchId: identity.branchId ?? null,
    agentRunId: identity.agentRunId ?? null,
    retryAttempt: identity.retryAttempt,
    taskId: identity.taskId ?? null,
  });
  return `fe_${digestText(canonical ?? 'null').slice(0, 32)}`;
}

/** Measured spend for one event, when it has arrived. */
export interface SettlementInput {
  readonly actualCostMicroUsd: number;
  readonly actualTokens: number;
}

/** Everything the derivation needs that the plan does not carry. */
export interface FinancialEventContext {
  readonly actorId: string;
  readonly workflowId?: string;
  readonly workflowVersion?: string;
  readonly workflowRunId?: string;
  readonly nodeId?: string;
  readonly branchId?: string;
  readonly groupId?: string;
  readonly agentRunId?: string;
  readonly agentId?: string;
  readonly agentVersion?: string;
  readonly featureId?: string;
  readonly provider?: ProviderIdentity;
  readonly retryAttempt?: number;
  readonly costCategory?: CostCategory;
  readonly outcome: FinancialOutcome;
  /** Mandatory, safety-critical or approval-bound. Never labelled waste. */
  readonly protectedWork?: boolean;
  readonly policyVersion: string;
  readonly optimizationPolicyVersion: string;
  /** Supplied by the caller's clock. This module reads none. */
  readonly occurredAt: number;
  /** Present once the provider has reported. Absent means NOT ZERO. */
  readonly settlement?: SettlementInput;
  /** Present on an avoided call answered by the Part 6B reuse engine. */
  readonly avoidedCall?: AvoidedCallEntry;
}

function nonNegative(value: number): number {
  return Math.max(0, Math.floor(value));
}

function classifyCategory(
  context: FinancialEventContext,
  plan: CompressionPlan,
): CostCategory {
  if (context.costCategory !== undefined) return context.costCategory;
  const attempt = context.retryAttempt ?? 1;
  if (plan.decision === 'escalate') return 'escalation';
  if (attempt > 1) return 'retry';
  if (context.branchId !== undefined) return 'branch';
  if (context.agentRunId !== undefined) return 'child_agent';
  return 'primary_inference';
}

/**
 * Derive one financial event from a Part 6A plan and its context.
 *
 * The plan decides the event type: a decision that avoided inference and is not
 * a refusal is an `avoided_call`; `deny` and `defer` are `refused`; everything
 * else is an `inference`.
 */
export function deriveFinancialEvent(
  plan: CompressionPlan,
  context: FinancialEventContext,
): FinancialEvent {
  if (typeof context.actorId !== 'string' || context.actorId === '') {
    throw financialFailure('financial_input_invalid', 'A financial event must name its actor.');
  }
  if (!Number.isFinite(context.occurredAt) || context.occurredAt <= 0) {
    throw financialFailure('financial_input_invalid', 'A financial event needs a valid time.', {
      diagnostics: `occurredAt=${String(context.occurredAt)}`,
    });
  }

  const refused = plan.decision === 'deny' || plan.decision === 'defer';
  const avoided = !refused && plan.inferenceAvoided;
  const eventType = refused ? 'refused' : avoided ? 'avoided_call' : 'inference';
  const retryAttempt = Math.max(1, Math.floor(context.retryAttempt ?? 1));
  const costCategory = classifyCategory(context, plan);

  // ── Settlement, decided once ──────────────────────────────────────────────
  let settlementState: SettlementState;
  let settlementBasis: SettlementBasis;
  let actualCostMicroUsd: number | undefined;
  let actualTokens: number | undefined;

  if (refused) {
    // Nothing happened and nothing is claimed. A saving attributed to work the
    // platform declined to do would be the purest possible manufactured number.
    settlementState = 'not_applicable';
    settlementBasis = 'none';
  } else if (avoided) {
    // Settled at zero, and that is a MEASUREMENT: no call was made, so no
    // provider reported usage. Flagged as absence so a reviewer can see how much
    // of the realised saving rests on it.
    settlementState = 'settled';
    settlementBasis = 'measured_absence';
    actualCostMicroUsd = 0;
    actualTokens = 0;
  } else if (context.settlement !== undefined) {
    settlementState = 'settled';
    settlementBasis = 'provider_reported';
    actualCostMicroUsd = nonNegative(context.settlement.actualCostMicroUsd);
    actualTokens = nonNegative(context.settlement.actualTokens);
  } else {
    // NOT ZERO. A terminal run will never produce the measurement, so the two
    // cases are named differently: one is late, the other is permanently unknown.
    settlementState = context.outcome === 'in_progress' ? 'pending' : 'unsettled_terminal';
    settlementBasis = 'none';
  }

  const baselineCostMicroUsd = refused ? 0 : nonNegative(plan.savings.baselineCostMicroUsd);
  const estimatedSavingsMicroUsd = refused ? 0 : nonNegative(plan.savings.estimatedSavingsMicroUsd);
  const realizedSavingsMicroUsd =
    actualCostMicroUsd === undefined
      ? undefined
      : Math.max(0, baselineCostMicroUsd - actualCostMicroUsd);

  const identity: FinancialEventIdentity = {
    organizationId: plan.organizationId,
    eventType,
    costCategory,
    ...(context.workflowRunId === undefined ? {} : { workflowRunId: context.workflowRunId }),
    ...(context.nodeId === undefined ? {} : { nodeId: context.nodeId }),
    ...(context.branchId === undefined ? {} : { branchId: context.branchId }),
    ...(context.agentRunId === undefined ? {} : { agentRunId: context.agentRunId }),
    retryAttempt,
    taskId: plan.taskId,
  };

  const provenanceDigest = digestText(
    canonicalJson({
      v: 1,
      taskId: plan.taskId,
      decision: plan.decision,
      baselinePolicyVersion: plan.baseline.baselinePolicyVersion,
      baselineCostMicroUsd,
      optimized: plan.optimizedEstimatedCostMicroUsd,
      estimatedSavingsMicroUsd,
      actualCostMicroUsd: actualCostMicroUsd ?? null,
      entries: plan.savings.entries.map((entry) => `${entry.category}:${entry.microUsd}`),
    }) ?? 'null',
  );

  const event: FinancialEvent = {
    schema: FINANCIAL_EVENT_SCHEMA,
    eventId: financialEventIdFor(identity),
    organizationId: plan.organizationId,
    eventType,
    costCategory,

    actorId: context.actorId,
    ...(context.workflowId === undefined ? {} : { workflowId: context.workflowId }),
    ...(context.workflowVersion === undefined ? {} : { workflowVersion: context.workflowVersion }),
    ...(context.workflowRunId === undefined ? {} : { workflowRunId: context.workflowRunId }),
    ...(context.nodeId === undefined ? {} : { nodeId: context.nodeId }),
    ...(context.branchId === undefined ? {} : { branchId: context.branchId }),
    ...(context.groupId === undefined ? {} : { groupId: context.groupId }),
    ...(context.agentRunId === undefined ? {} : { agentRunId: context.agentRunId }),
    ...(context.agentId === undefined ? {} : { agentId: context.agentId }),
    ...(context.agentVersion === undefined ? {} : { agentVersion: context.agentVersion }),
    ...(context.featureId === undefined ? {} : { featureId: context.featureId }),
    provider: context.provider ?? {},
    ...(plan.recommendedCapabilityProfile === undefined
      ? {}
      : { capabilityProfile: plan.recommendedCapabilityProfile }),
    retryAttempt,

    decision: plan.decision,
    decisionReason: plan.reason,
    quality: plan.quality,
    ...(context.avoidedCall === undefined
      ? {}
      : {
          reuseType: context.avoidedCall.reuseType,
          reusableResultId: context.avoidedCall.sourceReusableResultId,
        }),

    baselinePolicyVersion: plan.baseline.baselinePolicyVersion,
    baselineCostMicroUsd,
    optimizedEstimatedCostMicroUsd: nonNegative(plan.optimizedEstimatedCostMicroUsd),
    ...(actualCostMicroUsd === undefined ? {} : { actualCostMicroUsd }),
    estimatedSavingsMicroUsd,
    ...(realizedSavingsMicroUsd === undefined ? {} : { realizedSavingsMicroUsd }),
    // Read from Part 6A, never re-derived. A second partition of one gap is a
    // second opinion about it, and the two would eventually both be counted.
    savingsEntries: refused ? [] : plan.savings.entries,

    baselineTokens: refused ? 0 : nonNegative(plan.baseline.baselineEstimatedTotalTokens),
    ...(actualTokens === undefined ? {} : { actualTokens }),
    tokensAvoided: avoided ? nonNegative(plan.baseline.baselineEstimatedTotalTokens) : 0,

    settlementState,
    settlementBasis,
    outcome: context.outcome,
    protectedWork: context.protectedWork === true,

    policyVersion: context.policyVersion,
    optimizationPolicyVersion: context.optimizationPolicyVersion,
    provenanceDigest,
    occurredAt: Math.floor(context.occurredAt),
  };

  if (!isWholeFinancialEvent(event)) {
    throw financialFailure(
      'financial_input_invalid',
      'That financial event could not be derived completely.',
      { diagnostics: `${plan.taskId}: derived event failed its own structural check` },
    );
  }
  return event;
}

/**
 * Settle an existing event against measured spend.
 *
 * Returns a NEW event carrying the same identity, so it replaces its pending
 * predecessor at the same id rather than adding a row beside it. The baseline,
 * the estimated saving and the savings partition are unchanged — what arrives is
 * a measurement, not a new story about why the saving happened.
 *
 * Refuses to re-settle an event that already carries a measurement. A second
 * settlement is either a duplicate report or a correction, and silently applying
 * either would let one call be paid for twice in the ledger.
 */
export function settleFinancialEvent(
  event: FinancialEvent,
  settlement: SettlementInput,
): FinancialEvent {
  if (event.settlementState === 'settled') {
    throw financialFailure(
      'financial_event_conflict',
      'That financial event has already settled.',
      {
        diagnostics:
          `${event.eventId}: already settled at ${String(event.actualCostMicroUsd)} ` +
          `(${event.settlementBasis})`,
      },
    );
  }
  if (event.eventType === 'refused') {
    throw financialFailure(
      'financial_event_conflict',
      'A refused operation has nothing to settle.',
      { diagnostics: event.eventId },
    );
  }

  const actualCostMicroUsd = nonNegative(settlement.actualCostMicroUsd);
  return {
    ...event,
    actualCostMicroUsd,
    actualTokens: nonNegative(settlement.actualTokens),
    realizedSavingsMicroUsd: Math.max(0, event.baselineCostMicroUsd - actualCostMicroUsd),
    settlementState: 'settled',
    settlementBasis: 'provider_reported',
  };
}

/**
 * Mark a pending event as permanently unsettled.
 *
 * Called when a run reaches a terminal state without its measurement arriving.
 * The event keeps its baseline — that spend really was incurred, the platform
 * simply cannot say how much — and contributes to neither the realised numerator
 * nor its denominator. `unknownCostBaselineMicroUsd` is where it shows up, which
 * is the honest place for money nobody can account for.
 */
export function abandonSettlement(event: FinancialEvent): FinancialEvent {
  if (event.settlementState !== 'pending') return event;
  return { ...event, settlementState: 'unsettled_terminal', settlementBasis: 'none' };
}

/**
 * Derive the retry and child-agent events a workflow run's usage ledger implies.
 *
 * `attributeUsage` already folded these rows idempotently and already keyed them
 * by child agent run id, so the derived event ids inherit that idempotency: the
 * same ledger produces the same events however many times it is read.
 */
export function deriveSettlementsFromUsage(
  rows: readonly UsageAttributionRow[],
): ReadonlyMap<string, SettlementInput> {
  const byAgentRun = new Map<string, SettlementInput>();
  for (const row of rows) {
    byAgentRun.set(row.agentRunId, {
      actualCostMicroUsd: row.attributed.actualCostMicroUsd,
      actualTokens: row.attributed.actualTotalTokens,
    });
  }
  return byAgentRun;
}
