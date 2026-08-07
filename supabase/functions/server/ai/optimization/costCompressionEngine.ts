/**
 * The Cortex Cost Compression Engine (AI-01 Batch 3B, Part 6A).
 *
 * ── THE ENGINEERING TARGET, STATED HONESTLY ────────────────────────────────
 *
 * Cortex is designed to PURSUE up to 90% system-level AI inference cost
 * reduction against a truthful, versioned unoptimised baseline, while preserving
 * required quality, safety, correctness, tenant isolation, governance and
 * auditability.
 *
 * That is a design target, not a per-request guarantee and not a production
 * claim. A task with no avoidable context, no reusable prior, a `critical`
 * quality contract and a genuine reasoning requirement will save close to
 * nothing, and this engine will report close to nothing. The mechanisms below
 * are how the target is pursued; the savings ledger is how the result is
 * measured; and the two are separated so that neither can flatter the other.
 *
 * ── THE PIPELINE, IN ORDER, AND WHY THAT ORDER ─────────────────────────────
 *
 *   0. KILL SWITCH        AI off means no plan. Checked before anything else,
 *                         because a plan produced while AI is disabled is a plan
 *                         somebody might act on.
 *
 *   1. ZERO-LLM ADMISSION Does this call need to exist? Running this first is
 *                         the batch's central inversion — everything after it is
 *                         a refinement of a call that has earned its existence.
 *
 *   2. CLASSIFY           How hard is the work, from declared metadata only. No
 *                         model is called to decide which model to call.
 *
 *   3. QUALITY FLOOR      What is the lowest band that still satisfies the
 *                         contract? Computed BEFORE any budget arithmetic, so
 *                         cost pressure never participates in setting it.
 *
 *   4. CONTEXT VALUE      What is worth paying to send? Required content is
 *                         reserved first and fails closed if it does not fit.
 *
 *   5. TOKEN BUDGET       Narrow the limits. Never widen one.
 *
 *   6. CAPABILITY         Recommend the minimum sufficient band, clamped by the
 *                         caller's own allow list and maximum.
 *
 *   7. BASELINE           Cost the unoptimised reference, blind to the result of
 *                         steps 1–6's economics.
 *
 *   8. SAVINGS            Partition the one real gap across named categories.
 *
 * ── WHAT THIS FUNCTION CANNOT DO ───────────────────────────────────────────
 *
 * It returns a PLAN. It does not execute one. Nothing reachable from here can
 * call a provider, hold a credential, name a model, widen an allow list, touch
 * the spend ledger, spend an approval, reach the Tool Gateway or change a
 * permission. The certified AI Control Plane remains the only execution
 * authority and the agent runtime's router remains the only thing that resolves
 * a concrete model; this narrows what they are asked for, and narrowing is the
 * only verb it has.
 */

import type {
  CapabilityProfile,
  CompressionDecision,
  CompressionReason,
  QualityProfile,
} from './contracts/compression.ts';
import { CAPABILITY_RANK, avoidsInference, qualityFloorSatisfied } from './contracts/compression.ts';
import { compressionFailure } from './contracts/compression.ts';
import type { AiTaskDescriptor, ControlPlaneEnvelope } from './contracts/task.ts';
import type { ContextItem, ContextSelection } from './contracts/context.ts';
import type { BaselineEstimate, BaselinePolicy } from './contracts/baseline.ts';
import type { SavingsRecord } from './contracts/savings.ts';
import type { SavingsWeight } from './ledger/savingsLedger.ts';
import { buildSavingsRecord, reconcileSavings } from './ledger/savingsLedger.ts';
import { estimateBaselineCost, projectOptimizedCost } from './baseline/baselineCostModel.ts';
import type { ComplexityClassification } from './engine/complexityClassifier.ts';
import { classifyComplexity } from './engine/complexityClassifier.ts';
import type { AdmissionOutcome } from './engine/zeroLlmAdmission.ts';
import { admitWithoutInference } from './engine/zeroLlmAdmission.ts';
import { selectContext } from './engine/contextValueEngine.ts';
import type { TokenBudgetPlan } from './engine/tokenBudgetPlanner.ts';
import { planTokenBudget } from './engine/tokenBudgetPlanner.ts';
import { isCapabilityEscalation, recommendCapabilityProfile } from './engine/capabilityRecommender.ts';

export interface CompressionRequest {
  readonly task: AiTaskDescriptor;
  readonly envelope: ControlPlaneEnvelope;
  /** Every candidate context item, as metadata. Never the content. */
  readonly contextItems: readonly ContextItem[];
  /** Relevance floor for optional context, 0–100. Defaults to 0. */
  readonly minimumRelevance?: number;
  /** Freshness floor for optional context, 0–100. Zero disables it. */
  readonly minimumFreshness?: number;
  /** Historical mean output tokens for this task shape, when trusted. */
  readonly historicalOutputTokens?: number;
  /** Attempts the caller's own policy permits. Used for the optimised cost. */
  readonly plannedAttempts?: number;
  /** Override the reference policy. Version-pinned onto every estimate. */
  readonly baselinePolicy?: BaselinePolicy;
}

/**
 * The plan. Advice the caller applies, never an instruction it must obey.
 *
 * A caller that ignores `recommendedCapabilityProfile` and executes at its own
 * maximum is not violating anything — it has simply not taken the saving, and
 * the ledger will say so because the ledger measures what happened.
 */
export interface CompressionPlan {
  readonly taskId: string;
  readonly organizationId: string;
  readonly decision: CompressionDecision;
  readonly reason: CompressionReason;
  /** Caller-safe explanation. Goes onto the audit record verbatim. */
  readonly explanation: string;
  readonly diagnostics: string;

  /** True when no provider call is required at all. */
  readonly inferenceAvoided: boolean;
  readonly admission: AdmissionOutcome;
  readonly complexity: ComplexityClassification;
  /** The quality contract this plan is answerable to. Never relaxed. */
  readonly quality: QualityProfile;

  /** Absent when inference is avoided — there is no context to select. */
  readonly context?: ContextSelection;
  readonly budget?: TokenBudgetPlan;
  readonly recommendedCapabilityProfile?: CapabilityProfile;
  /** True when the recommendation is below the caller's own maximum. */
  readonly downgraded: boolean;

  readonly baseline: BaselineEstimate;
  readonly optimizedEstimatedCostMicroUsd: number;
  readonly savings: SavingsRecord;
}

/** A plan that saves everything, because nothing will be spent. */
function avoidedPlan(input: {
  readonly request: CompressionRequest;
  readonly admission: AdmissionOutcome;
  readonly complexity: ComplexityClassification;
  readonly baseline: BaselineEstimate;
}): CompressionPlan {
  const { request, admission, baseline } = input;
  const category =
    admission.decision === 'reuse' ? 'reuse' : 'deterministic_avoidance';

  const savings = buildSavingsRecord({
    taskId: request.task.taskId,
    organizationId: request.task.organizationId,
    baselinePolicyVersion: baseline.baselinePolicyVersion,
    baselineCostMicroUsd: baseline.baselineEstimatedCostMicroUsd,
    optimizedEstimatedCostMicroUsd: 0,
    // Settled immediately, and at zero because that is a MEASUREMENT: no call
    // was made, so no provider reported usage. This is the entry an adversarial
    // reviewer should check first, which is why it carries its own category.
    actualCostMicroUsd: 0,
    weights: [
      {
        category,
        weight: baseline.baselineEstimatedCostMicroUsd,
        tokens: baseline.baselineEstimatedTotalTokens,
      },
    ],
  });
  reconcileSavings(savings);

  return {
    taskId: request.task.taskId,
    organizationId: request.task.organizationId,
    decision: admission.decision,
    reason: admission.reason,
    explanation: admission.explanation,
    diagnostics: admission.diagnostics,
    inferenceAvoided: true,
    admission,
    complexity: input.complexity,
    quality: request.task.quality,
    downgraded: false,
    baseline,
    optimizedEstimatedCostMicroUsd: 0,
    savings,
  };
}

/**
 * Produce a compression plan.
 *
 * Throws only `CompressionError`, and only for the two conditions that must fail
 * closed: required context that does not fit, and a quality contract the engine
 * cannot show remains satisfiable. Every other outcome is a plan — including
 * `deny`, which is a plan whose content is "do not do this".
 */
export function compressCost(request: CompressionRequest): CompressionPlan {
  const { task, envelope } = request;

  // ── 0. The kill switch. Authoritative, and checked first ──────────────────
  const baselineForRefusal = estimateBaselineCost({
    candidateContextTokens: request.contextItems.reduce(
      (sum, item) => sum + Math.max(0, item.estimatedTokens),
      0,
    ),
    envelope,
    ...(request.baselinePolicy === undefined ? {} : { policy: request.baselinePolicy }),
  });
  const complexity = classifyComplexity(task);

  if (!envelope.aiEnabled) {
    // A refusal saves nothing that the platform can claim: the work did not
    // happen because AI is off, not because Cortex optimised it. Baseline and
    // optimised are both reported as zero so no saving is attributed.
    const savings = buildSavingsRecord({
      taskId: task.taskId,
      organizationId: task.organizationId,
      baselinePolicyVersion: baselineForRefusal.baselinePolicyVersion,
      baselineCostMicroUsd: 0,
      optimizedEstimatedCostMicroUsd: 0,
      actualCostMicroUsd: 0,
      weights: [],
    });
    return {
      taskId: task.taskId,
      organizationId: task.organizationId,
      decision: 'deny',
      reason: 'ai_disabled',
      explanation: 'AI execution is administratively disabled.',
      diagnostics: 'operational settings report AI disabled or the emergency stop engaged',
      inferenceAvoided: true,
      admission: {
        decision: 'deny',
        reason: 'ai_disabled',
        inferenceAvoided: true,
        explanation: 'AI execution is administratively disabled.',
        diagnostics: 'kill switch',
      },
      complexity,
      quality: task.quality,
      downgraded: false,
      baseline: { ...baselineForRefusal, baselineEstimatedCostMicroUsd: 0 },
      optimizedEstimatedCostMicroUsd: 0,
      savings,
    };
  }

  // ── 1. Does this call need to exist? ──────────────────────────────────────
  const admission = admitWithoutInference(task);
  if (avoidsInference(admission.decision)) {
    return avoidedPlan({ request, admission, complexity, baseline: baselineForRefusal });
  }

  // ── 3. The quality floor, set before any budget arithmetic ────────────────
  // Computed here and passed down rather than re-derived inside the recommender,
  // so there is exactly one moment at which the floor is decided and it happens
  // before a single cost is compared.
  if (!qualityFloorSatisfied(complexity.requiredCapabilityProfile, task.quality)) {
    throw compressionFailure(
      'quality_contract_unsatisfiable',
      'This task cannot be optimised without dropping below its required quality.',
      {
        diagnostics:
          `required=${complexity.requiredCapabilityProfile} quality=${task.quality} ` +
          `complexity=${complexity.complexity}`,
      },
    );
  }

  // ── 4. What is worth paying to send ───────────────────────────────────────
  const context = selectContext(request.contextItems, {
    ceilingTokens: envelope.maxPromptTokens,
    minimumRelevance: request.minimumRelevance ?? 0,
    minimumFreshness: request.minimumFreshness ?? 0,
  });

  // ── 5. Narrow the limits ──────────────────────────────────────────────────
  const budget = planTokenBudget({
    task,
    complexity: complexity.complexity,
    envelope,
    requiredInputTokens: context.requiredTokens,
    ...(request.historicalOutputTokens === undefined
      ? {}
      : { historicalOutputTokens: request.historicalOutputTokens }),
  });

  // ── 6. The minimum sufficient band ────────────────────────────────────────
  const capability = recommendCapabilityProfile({
    task,
    envelope,
    requiredByComplexity: complexity.requiredCapabilityProfile,
  });

  if (isCapabilityEscalation(capability)) {
    // The minimum sufficient band is not available here. Recommending
    // escalation is the honest answer; serving the task from a band below its
    // floor would be a governance failure dressed as an optimisation.
    const savings = buildSavingsRecord({
      taskId: task.taskId,
      organizationId: task.organizationId,
      baselinePolicyVersion: baselineForRefusal.baselinePolicyVersion,
      baselineCostMicroUsd: baselineForRefusal.baselineEstimatedCostMicroUsd,
      optimizedEstimatedCostMicroUsd: baselineForRefusal.baselineEstimatedCostMicroUsd,
      weights: [],
    });
    return {
      taskId: task.taskId,
      organizationId: task.organizationId,
      decision: 'escalate',
      reason: capability.reason,
      explanation: 'This task needs a higher model capability than is available to it.',
      diagnostics: capability.diagnostics,
      inferenceAvoided: false,
      admission,
      complexity,
      quality: task.quality,
      context,
      budget,
      downgraded: false,
      baseline: baselineForRefusal,
      optimizedEstimatedCostMicroUsd: baselineForRefusal.baselineEstimatedCostMicroUsd,
      savings,
    };
  }

  // ── 7 & 8. Cost the reference, then partition the gap ─────────────────────
  const attempts = Math.max(1, Math.floor(request.plannedAttempts ?? 1));
  const optimizedCost = projectOptimizedCost({
    profile: capability.profile,
    promptTokens: context.afterTokens,
    completionTokens: budget.reservedOutputTokens,
    attempts,
    ...(request.baselinePolicy === undefined ? {} : { policy: request.baselinePolicy }),
  });

  const baseline = baselineForRefusal;

  /**
   * WEIGHTS, NOT AMOUNTS.
   *
   * Each weight is what that mechanism WOULD have saved on its own, holding
   * everything else at the baseline. They deliberately overlap — a downgrade and
   * a context reduction both claim the same tokens — and that overlap is exactly
   * why they are handed to the ledger as proportions of one real gap rather than
   * added together. See `ledger/savingsLedger.ts`: with this shape, double
   * counting is not caught, it is unrepresentable.
   */
  const weights: SavingsWeight[] = [];

  const contextOnly = projectOptimizedCost({
    profile: baseline.baselineCapabilityProfile,
    promptTokens: context.afterTokens,
    completionTokens: envelope.maxCompletionTokens,
    attempts: baseline.baselineAssumedAttempts,
    ...(request.baselinePolicy === undefined ? {} : { policy: request.baselinePolicy }),
  });
  if (baseline.baselineEstimatedCostMicroUsd > contextOnly) {
    weights.push({
      category: 'context_reduction',
      weight: baseline.baselineEstimatedCostMicroUsd - contextOnly,
      tokens: context.reducedTokens,
    });
  }

  const outputOnly = projectOptimizedCost({
    profile: baseline.baselineCapabilityProfile,
    promptTokens: context.beforeTokens,
    completionTokens: budget.reservedOutputTokens,
    attempts: baseline.baselineAssumedAttempts,
    ...(request.baselinePolicy === undefined ? {} : { policy: request.baselinePolicy }),
  });
  if (baseline.baselineEstimatedCostMicroUsd > outputOnly) {
    weights.push({
      category: 'output_budget_reduction',
      weight: baseline.baselineEstimatedCostMicroUsd - outputOnly,
      tokens: Math.max(0, envelope.maxCompletionTokens - budget.reservedOutputTokens),
    });
  }

  const downgradeOnly = projectOptimizedCost({
    profile: capability.profile,
    promptTokens: context.beforeTokens,
    completionTokens: envelope.maxCompletionTokens,
    attempts: baseline.baselineAssumedAttempts,
    ...(request.baselinePolicy === undefined ? {} : { policy: request.baselinePolicy }),
  });
  if (baseline.baselineEstimatedCostMicroUsd > downgradeOnly) {
    weights.push({
      category: 'capability_downgrade',
      weight: baseline.baselineEstimatedCostMicroUsd - downgradeOnly,
      tokens: 0,
    });
  }

  const attemptsOnly = projectOptimizedCost({
    profile: baseline.baselineCapabilityProfile,
    promptTokens: context.beforeTokens,
    completionTokens: envelope.maxCompletionTokens,
    attempts,
    ...(request.baselinePolicy === undefined ? {} : { policy: request.baselinePolicy }),
  });
  if (baseline.baselineEstimatedCostMicroUsd > attemptsOnly) {
    weights.push({
      category: 'avoided_retry',
      weight: baseline.baselineEstimatedCostMicroUsd - attemptsOnly,
      tokens: 0,
    });
  }

  const savings = buildSavingsRecord({
    taskId: task.taskId,
    organizationId: task.organizationId,
    baselinePolicyVersion: baseline.baselinePolicyVersion,
    baselineCostMicroUsd: baseline.baselineEstimatedCostMicroUsd,
    optimizedEstimatedCostMicroUsd: optimizedCost,
    weights,
  });
  reconcileSavings(savings);

  const decision: CompressionDecision = capability.downgraded
    ? 'downgrade'
    : context.reducedTokens > 0
      ? 'compress'
      : 'execute';

  const reason: CompressionReason = capability.downgraded
    ? 'profile_downgraded'
    : context.reducedTokens > 0
      ? 'context_reduced'
      : 'context_within_budget';

  return {
    taskId: task.taskId,
    organizationId: task.organizationId,
    decision,
    reason,
    explanation:
      decision === 'downgrade'
        ? 'This task runs at the smallest model capability that still meets its quality contract.'
        : decision === 'compress'
          ? 'This task runs with a reduced context that still carries everything it requires.'
          : 'This task runs as requested.',
    diagnostics:
      `complexity=${complexity.complexity} profile=${capability.profile} ` +
      `context=${context.beforeTokens}->${context.afterTokens} ` +
      `output=${budget.reservedOutputTokens} baseline=${baseline.baselineEstimatedCostMicroUsd} ` +
      `optimized=${optimizedCost}`,
    inferenceAvoided: false,
    admission,
    complexity,
    quality: task.quality,
    context,
    budget,
    recommendedCapabilityProfile: capability.profile,
    downgraded: capability.downgraded,
    baseline,
    optimizedEstimatedCostMicroUsd: optimizedCost,
    savings,
  };
}

/**
 * Prove a plan never widened anything it was given.
 *
 * Called by the tests directly, and available to a caller that wants the
 * assertion at runtime. It exists because "the optimiser cannot widen a limit"
 * is the kind of claim that should be checkable in one call rather than argued
 * from a reading of six modules.
 */
export function assertPlanNarrowsOnly(
  plan: CompressionPlan,
  envelope: ControlPlaneEnvelope,
): void {
  const problems: string[] = [];
  const budget = plan.budget;
  if (budget !== undefined) {
    if (budget.plannedPromptTokens > envelope.maxPromptTokens) {
      problems.push('planned prompt tokens exceed the envelope');
    }
    if (budget.reservedOutputTokens > envelope.maxCompletionTokens) {
      problems.push('reserved output tokens exceed the envelope');
    }
    if (budget.plannedTotalTokens > envelope.maxTotalTokens) {
      problems.push('planned total tokens exceed the envelope');
    }
  }
  const profile = plan.recommendedCapabilityProfile;
  if (profile !== undefined) {
    if (CAPABILITY_RANK[profile] > CAPABILITY_RANK[envelope.maximumCapabilityProfile]) {
      problems.push('recommended capability exceeds the caller maximum');
    }
    if (!envelope.allowedCapabilityProfiles.includes(profile)) {
      problems.push('recommended capability is outside the caller allow list');
    }
    if (!qualityFloorSatisfied(profile, plan.quality)) {
      problems.push('recommended capability is below the quality floor');
    }
  }
  if (problems.length > 0) {
    throw compressionFailure(
      'optimization_would_widen_policy',
      'This optimisation would widen what the caller already permits.',
      { diagnostics: `${plan.taskId}: ${problems.join('; ')}` },
    );
  }
}
