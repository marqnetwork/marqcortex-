/**
 * Financial Intelligence fixtures (AI-01 Batch 3B, Part 6C).
 *
 * ── EVENTS ARE DERIVED, NOT HAND-WRITTEN ───────────────────────────────────
 *
 * `event()` runs a real Part 6A `compressCost` and derives a real financial
 * event from the resulting plan. Hand-writing an event object would let a test
 * assert on figures the production path could never produce — the classic way a
 * suite proves a system works on inputs it will never see.
 *
 * The one exception is `syntheticEvent()`, which builds an event at an EXACT
 * baseline and actual cost. The 90%-target scenarios need arithmetic that lands
 * precisely on 90.0% and precisely on 89.9%, and no plausible task descriptor
 * produces those to the micro-USD. It is used only where the test is about the
 * target arithmetic rather than about the derivation.
 */

import { compressCost } from '../optimization/costCompressionEngine.ts';
import type { CompressionPlan, CompressionRequest } from '../optimization/costCompressionEngine.ts';
import type { AiTaskDescriptor, ControlPlaneEnvelope } from '../optimization/contracts/task.ts';
import type { ContextItem } from '../optimization/contracts/context.ts';
import type { FinancialEvent, FinancialOutcome } from '../financial/contracts/event.ts';
import { FINANCIAL_EVENT_SCHEMA } from '../financial/contracts/event.ts';
import type { FinancialEventContext } from '../financial/ledger/financialEventLedger.ts';
import {
  deriveFinancialEvent,
  financialEventIdFor,
} from '../financial/ledger/financialEventLedger.ts';
import type { FinancialWindow } from '../financial/contracts/report.ts';

export const ORG = 'org_acme';
export const OTHER_ORG = 'org_globex';
export const ACTOR = 'user_analyst';

/** A fixed clock. Every fixture time is relative to it. */
export const NOW = 1_800_000_000_000;
export const DAY = 86_400_000;

export const POLICY_VERSION = 'ai.policy.v7';
export const OPTIMIZATION_POLICY_VERSION = 'ai.optimization.v2';

/** A 30-day window ending at NOW. Long enough for a burn projection to qualify. */
export const WINDOW: FinancialWindow = { fromMs: NOW - 30 * DAY, toMs: NOW + DAY };

export function task(overrides: Partial<AiTaskDescriptor> = {}): AiTaskDescriptor {
  return {
    taskId: 'task_fin_001',
    organizationId: ORG,
    kind: 'summarization',
    quality: 'standard',
    requiresStructuredOutput: false,
    requiresMultiStepReasoning: false,
    requiresSuppliedEvidence: true,
    toleratesApproximation: false,
    outputFieldCount: 3,
    expectedOutputTokens: 400,
    mandatory: false,
    safetyCritical: false,
    approvalBound: false,
    deterministicCapabilities: [],
    priorOutputs: [],
    ...overrides,
  };
}

export function envelope(overrides: Partial<ControlPlaneEnvelope> = {}): ControlPlaneEnvelope {
  return {
    maxPromptTokens: 8_000,
    maxCompletionTokens: 2_000,
    maxTotalTokens: 10_000,
    remainingCostMicroUsd: 1_000_000,
    allowedCapabilityProfiles: ['economy', 'standard', 'reasoning'],
    maximumCapabilityProfile: 'reasoning',
    aiEnabled: true,
    ...overrides,
  };
}

export const CONTEXT: readonly ContextItem[] = [
  {
    itemId: 'sys',
    source: 'system_authority',
    necessity: 'required',
    digest: 'd_sys',
    estimatedTokens: 400,
    relevance: 100,
    freshness: 100,
    sensitivity: 'internal',
    provenance: 'fixture',
    dependsOn: [],
  },
  {
    itemId: 'history',
    source: 'conversation_history',
    necessity: 'optional',
    digest: 'd_hist',
    estimatedTokens: 1_200,
    relevance: 10,
    freshness: 5,
    sensitivity: 'internal',
    provenance: 'fixture',
    dependsOn: [],
  },
];

export function plan(overrides: Partial<CompressionRequest> = {}): CompressionPlan {
  return compressCost({
    task: task(),
    envelope: envelope(),
    contextItems: CONTEXT,
    ...overrides,
  });
}

/** A plan that avoided inference through a validated prior output. */
export function reusePlan(taskId = 'task_reuse_001'): CompressionPlan {
  return compressCost({
    task: task({
      taskId,
      priorOutputs: [
        {
          artifactId: 'rr_fixture',
          digest: 'sha256:out',
          organizationId: ORG,
          contractValidated: true,
          quality: 'standard',
        },
      ],
    }),
    envelope: envelope(),
    contextItems: CONTEXT,
  });
}

export function context(
  overrides: Partial<FinancialEventContext> = {},
): FinancialEventContext {
  return {
    actorId: ACTOR,
    workflowId: 'wf_quote_review',
    workflowVersion: '4',
    workflowRunId: 'wfr_001',
    nodeId: 'node_summarize',
    agentRunId: 'ar_001',
    agentId: 'agent_reviewer',
    agentVersion: '11',
    featureId: 'feature_summary',
    provider: { providerName: 'provider_a', modelName: 'model_small' },
    outcome: 'succeeded',
    policyVersion: POLICY_VERSION,
    optimizationPolicyVersion: OPTIMIZATION_POLICY_VERSION,
    occurredAt: NOW - DAY,
    ...overrides,
  };
}

/** A derived, settled financial event. The default shape every case varies. */
export function event(
  contextOverrides: Partial<FinancialEventContext> = {},
  compression: CompressionPlan = plan(),
): FinancialEvent {
  return deriveFinancialEvent(
    compression,
    context({
      settlement: { actualCostMicroUsd: 4_000, actualTokens: 900 },
      ...contextOverrides,
    }),
  );
}

/** A derived event that has NOT settled. Its cost is unknown, never zero. */
export function pendingEvent(
  contextOverrides: Partial<FinancialEventContext> = {},
  compression: CompressionPlan = plan(),
): FinancialEvent {
  const { settlement: _ignored, ...rest } = context(contextOverrides);
  return deriveFinancialEvent(compression, { ...rest, outcome: 'in_progress' });
}

/**
 * An event at an EXACT baseline and actual cost.
 *
 * Used only by the target-progress scenarios, where the arithmetic has to land
 * on 90.0% and 89.9% to the micro-USD. Everything else derives from a real plan.
 */
export function syntheticEvent(input: {
  readonly eventId: string;
  readonly baselineMicroUsd: number;
  readonly actualMicroUsd?: number;
  readonly organizationId?: string;
  readonly outcome?: FinancialOutcome;
  readonly occurredAt?: number;
  readonly settled?: boolean;
  readonly workflowRunId?: string;
  readonly retryAttempt?: number;
  readonly protectedWork?: boolean;
}): FinancialEvent {
  const organizationId = input.organizationId ?? ORG;
  const settled = input.settled ?? input.actualMicroUsd !== undefined;
  const actual = input.actualMicroUsd ?? 0;
  const baseline = input.baselineMicroUsd;
  const estimatedSavings = Math.max(0, baseline - actual);

  return {
    schema: FINANCIAL_EVENT_SCHEMA,
    eventId: input.eventId,
    organizationId,
    eventType: 'inference',
    costCategory: (input.retryAttempt ?? 1) > 1 ? 'retry' : 'primary_inference',
    actorId: ACTOR,
    workflowId: 'wf_synthetic',
    workflowVersion: '1',
    workflowRunId: input.workflowRunId ?? `wfr_${input.eventId}`,
    nodeId: 'node_a',
    agentRunId: `ar_${input.eventId}`,
    agentId: 'agent_synthetic',
    agentVersion: '1',
    provider: { providerName: 'provider_a', modelName: 'model_small' },
    capabilityProfile: 'standard',
    retryAttempt: input.retryAttempt ?? 1,
    decision: 'compress',
    decisionReason: 'context_reduced',
    quality: 'standard',
    baselinePolicyVersion: 'ai.baseline.v1',
    baselineCostMicroUsd: baseline,
    optimizedEstimatedCostMicroUsd: actual,
    ...(settled ? { actualCostMicroUsd: actual } : {}),
    estimatedSavingsMicroUsd: estimatedSavings,
    ...(settled ? { realizedSavingsMicroUsd: Math.max(0, baseline - actual) } : {}),
    savingsEntries:
      estimatedSavings > 0
        ? [{ category: 'context_reduction' as const, microUsd: estimatedSavings, tokens: 0 }]
        : [],
    baselineTokens: 1_000,
    ...(settled ? { actualTokens: 200 } : {}),
    tokensAvoided: 0,
    settlementState: settled ? 'settled' : 'pending',
    settlementBasis: settled ? 'provider_reported' : 'none',
    outcome: input.outcome ?? 'succeeded',
    protectedWork: input.protectedWork === true,
    policyVersion: POLICY_VERSION,
    optimizationPolicyVersion: OPTIMIZATION_POLICY_VERSION,
    provenanceDigest: `digest_${input.eventId}`,
    occurredAt: input.occurredAt ?? NOW - DAY,
  };
}

/**
 * A set of synthetic events realising an exact reduction percentage.
 *
 * `settledCount` of `count` events settle; the rest stay pending, which is how
 * the coverage scenarios are built without touching the ratio the settled events
 * produce.
 */
export function scenario(input: {
  readonly prefix: string;
  readonly count: number;
  readonly settledCount: number;
  readonly baselineMicroUsd: number;
  readonly actualMicroUsd: number;
  readonly outcome?: FinancialOutcome;
}): readonly FinancialEvent[] {
  const events: FinancialEvent[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const settled = index < input.settledCount;
    events.push(
      syntheticEvent({
        eventId: `${input.prefix}_${index}`,
        baselineMicroUsd: input.baselineMicroUsd,
        ...(settled ? { actualMicroUsd: input.actualMicroUsd } : {}),
        settled,
        ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
        occurredAt: NOW - 20 * DAY + index * 60_000,
        workflowRunId: `wfr_${input.prefix}_${index}`,
      }),
    );
  }
  return events;
}

export { financialEventIdFor };
