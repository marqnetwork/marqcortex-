/**
 * Turning a workflow node into a Part 6A task descriptor
 * (AI-01 Batch 3B, Integration Pass).
 *
 * ── THE PROBLEM THIS FILE IS THE ANSWER TO ─────────────────────────────────
 *
 * `compressCost` takes an `AiTaskDescriptor` and a `ControlPlaneEnvelope`. Every
 * field on both is DECLARED — Part 6A is explicit that nothing there may be a
 * model's opinion, and the classifier's reproducibility depends on it. A
 * workflow agent node declares an agent id, a display name, an attempt ceiling
 * and two optional contracts. It does not declare a task kind, a quality
 * contract, an expected completion size or a capability band.
 *
 * So this file has exactly one job, and one rule: DERIVE WHAT IS DECLARED, AND
 * DEFAULT THE REST IN THE DIRECTION THAT CLAIMS NOTHING.
 *
 * ── THE DEFAULTS, AND WHY EACH ONE IS THE CONSERVATIVE DIRECTION ───────────
 *
 *   NO CONTEXT ITEMS. The workflow engine holds no context metadata — it hands a
 *   node an input and the agent runtime assembles the prompt. The reference
 *   policy prices "every candidate context item"; with no declared candidates
 *   the honest figure is zero, which UNDERSTATES the baseline. Understating the
 *   denominator understates the saving, which is the safe direction to be wrong
 *   in. A baseline invented from the prompt ceiling would be the inflated-
 *   baseline attack with a plausible cover story.
 *
 *   ONE CAPABILITY BAND. `standard`, allowed and maximum both, unless a
 *   deployment declares otherwise. A single-band envelope makes `downgraded`
 *   unreachable, so the platform claims NO routing saving for work nobody
 *   declared a band for. Handing the recommender the full four-band ladder would
 *   price the baseline at `advanced_reasoning` and then "save" the difference on
 *   every node in the platform — the single largest fabricated number available
 *   here, and it would have looked like an integration detail.
 *
 *   COMPLETION ALLOWANCE AS THE EXPECTED OUTPUT. The reference policy asks for
 *   the full allowance; declaring the expectation equal to it means no
 *   output-budget saving is claimed for a size nobody estimated.
 *
 *   `generation`, `standard` QUALITY. The kind floor for `generation` is the
 *   `standard` band, which matches the single declared band, so the recommender
 *   neither downgrades nor escalates. A deployment that knows its nodes are
 *   extractions declares that and gets a real, defensible saving.
 *
 * A deployment supplies `WorkflowNodeCostProfile` per node and every one of
 * these defaults gives way to a declared fact. That is the intended production
 * path; the defaults are what an undeclared node gets, and what it gets is a
 * truthful cost with no saving attached.
 *
 * ── THE ATTEMPT CEILING IS THE ONE REAL NARROWING A NODE ALREADY DECLARES ──
 *
 * `maxAttempts` has been on `WorkflowAgentNode` since Part 1. It is passed as
 * `plannedAttempts`, and because the reference policy's `assumedAttempts` is 1,
 * a node declaring more attempts than the baseline assumes projects a HIGHER
 * optimised cost rather than a saving. The engine does not get to claim credit
 * for a retry budget it has not spent.
 *
 * ── EVERYTHING HERE IS PURE ────────────────────────────────────────────────
 *
 * No clock, no store, no randomness. Two calls with the same facts produce the
 * same descriptor, therefore the same plan, therefore the same derived event id
 * — which is what makes a repeated finalization after a restart converge on the
 * event that is already there instead of writing a second one.
 */

import type {
  AiTaskDescriptor,
  AiTaskKind,
  ControlPlaneEnvelope,
  DeterministicCapability,
  ValidatedPriorOutput,
} from '../../optimization/contracts/task.ts';
import type {
  CapabilityProfile,
  QualityProfile,
} from '../../optimization/contracts/compression.ts';
import type { WorkflowNodeFinancialFacts } from './contracts/emission.ts';

/**
 * Versions the DERIVATION above, not the arithmetic beneath it.
 *
 * Stamped onto every event as `optimizationPolicyVersion`, so a reader can tell
 * which set of defaults a node's descriptor was built under. Bump it on any
 * change to a default, a mapping or a clamp in this file — an event derived
 * under different assumptions is not comparable with one derived under these,
 * and a silently restated history is worse than a versioned one.
 */
export const WORKFLOW_OPTIMIZATION_POLICY_VERSION = 'ai.workflow.optimization.v1';

/** The band an undeclared node is priced and recommended at. See the header. */
export const DEFAULT_NODE_CAPABILITY_PROFILE: CapabilityProfile = 'standard';

/** The task kind an undeclared node is classified as. See the header. */
export const DEFAULT_NODE_TASK_KIND: AiTaskKind = 'generation';

/** The quality contract an undeclared node is held to. See the header. */
export const DEFAULT_NODE_QUALITY: QualityProfile = 'standard';

/**
 * What a deployment may declare about one workflow node's economics.
 *
 * Every field is optional and every one of them, when present, REPLACES a
 * default rather than adjusting a number. There is deliberately no field here
 * for a baseline, a saving, a target or a percentage: the profile describes the
 * WORK, and Part 6A prices it.
 */
export interface WorkflowNodeCostProfile {
  readonly kind?: AiTaskKind;
  readonly quality?: QualityProfile;
  readonly requiresStructuredOutput?: boolean;
  readonly requiresMultiStepReasoning?: boolean;
  readonly requiresSuppliedEvidence?: boolean;
  readonly toleratesApproximation?: boolean;
  readonly outputFieldCount?: number;
  readonly expectedOutputTokens?: number;
  /** Mandatory or safety-critical work. Never stopped, never labelled waste. */
  readonly mandatory?: boolean;
  readonly safetyCritical?: boolean;
  /** Non-inference paths the deployment has already authorised for this node. */
  readonly deterministicCapabilities?: readonly DeterministicCapability[];
  /** Bands this node is permitted to run at, lowest to highest. */
  readonly allowedCapabilityProfiles?: readonly CapabilityProfile[];
  /** The band this node would have used with no optimisation at all. */
  readonly maximumCapabilityProfile?: CapabilityProfile;
}

/** What the agent's own declared limits permit. Read, never widened. */
export interface WorkflowNodeLimits {
  readonly maxPromptTokens: number;
  readonly maxCompletionTokens: number;
  readonly maxTotalTokens: number;
  readonly maxActualCostMicroUsd: number;
}

/**
 * The task id one node attempt is known by, across every restart.
 *
 * DERIVED FROM THE MATERIAL EXECUTION IDENTITY and nothing else — no clock, no
 * counter, no random component — because Part 6C derives the financial event id
 * from it and the whole idempotency claim rests on the same attempt producing
 * the same id in a second isolate. `-` stands in for an absent branch so a
 * main-line node and a branch node called the same thing cannot collide.
 */
export function workflowNodeTaskId(facts: WorkflowNodeFinancialFacts): string {
  return [
    'wfnode',
    facts.workflowRunId,
    facts.nodeId,
    facts.branchId ?? '-',
    String(facts.attempt),
  ].join(':');
}

/**
 * The administrative policy version in force for a run.
 *
 * The Batch 2 configuration version, named. It is the version of the settings
 * the run was admitted under, which is precisely what `policyVersion` is for.
 */
export function workflowPolicyVersionFor(configurationVersion: number): string {
  return `ai.settings.v${String(Math.max(0, Math.floor(configurationVersion)))}`;
}

/**
 * The envelope, from the agent's declared limits and the deployment's bands.
 *
 * CLAMPS ONLY. Every number is the agent's own ceiling, and the band list is
 * whatever the deployment declared or the single conservative default. Nothing
 * here can produce a ceiling the agent runtime would not already have enforced,
 * which matters because the baseline is priced against these ceilings: an
 * envelope wider than the agent's own limits would be a baseline describing a
 * call the tenant was never permitted to make.
 */
export function workflowNodeEnvelope(input: {
  readonly limits: WorkflowNodeLimits;
  readonly aiEnabled: boolean;
  readonly profile?: WorkflowNodeCostProfile;
}): ControlPlaneEnvelope {
  const { limits, profile } = input;
  const allowed =
    profile?.allowedCapabilityProfiles !== undefined &&
    profile.allowedCapabilityProfiles.length > 0
      ? profile.allowedCapabilityProfiles
      : [DEFAULT_NODE_CAPABILITY_PROFILE];
  const maximum =
    profile?.maximumCapabilityProfile ?? allowed[allowed.length - 1];

  return {
    maxPromptTokens: Math.max(0, Math.floor(limits.maxPromptTokens)),
    maxCompletionTokens: Math.max(0, Math.floor(limits.maxCompletionTokens)),
    maxTotalTokens: Math.max(0, Math.floor(limits.maxTotalTokens)),
    remainingCostMicroUsd: Math.max(0, Math.floor(limits.maxActualCostMicroUsd)),
    allowedCapabilityProfiles: allowed,
    maximumCapabilityProfile: maximum,
    // THE KILL SWITCH, PASSED THROUGH RATHER THAN RE-DECIDED. `compressCost`
    // checks it before anything else and returns a `deny` plan claiming a zero
    // baseline and a zero saving, so a run stopped by an operator cannot leave
    // behind an event that reports a saving for work that was forbidden.
    aiEnabled: input.aiEnabled,
  };
}

/**
 * The descriptor for one node attempt.
 *
 * `approvalBound` is true whenever the node is protected work, because in this
 * engine the only thing that makes a node protected is an approval barrier or a
 * declared safety class — and both of them are reasons the stop control must
 * refuse to stop the work.
 */
export function workflowNodeTask(input: {
  readonly facts: WorkflowNodeFinancialFacts;
  readonly envelope: ControlPlaneEnvelope;
  readonly profile?: WorkflowNodeCostProfile;
  readonly priorOutputs?: readonly ValidatedPriorOutput[];
}): AiTaskDescriptor {
  const { facts, envelope, profile } = input;
  const protectedWork = facts.protectedWork;

  return {
    taskId: workflowNodeTaskId(facts),
    organizationId: facts.organizationId,
    kind: profile?.kind ?? DEFAULT_NODE_TASK_KIND,
    quality: profile?.quality ?? DEFAULT_NODE_QUALITY,

    requiresStructuredOutput: profile?.requiresStructuredOutput ?? false,
    requiresMultiStepReasoning: profile?.requiresMultiStepReasoning ?? false,
    requiresSuppliedEvidence: profile?.requiresSuppliedEvidence ?? false,
    toleratesApproximation: profile?.toleratesApproximation ?? false,
    outputFieldCount: Math.max(0, Math.floor(profile?.outputFieldCount ?? 1)),
    // Equal to the allowance unless declared, so no output-budget saving is
    // claimed for an expectation nobody stated. See the header.
    expectedOutputTokens: Math.max(
      0,
      Math.floor(profile?.expectedOutputTokens ?? envelope.maxCompletionTokens),
    ),

    mandatory: profile?.mandatory ?? protectedWork,
    safetyCritical: profile?.safetyCritical ?? false,
    approvalBound: protectedWork,

    deterministicCapabilities: profile?.deterministicCapabilities ?? [],
    // Minted by the Part 6B pipeline and passed through untouched. Nothing in
    // this file can construct one — a prior output whose `contractValidated` was
    // set anywhere but the eligibility gate is a caller's opinion wearing the
    // gate's clothes.
    priorOutputs: input.priorOutputs ?? [],

    workflowId: facts.workflowId,
    workflowRunId: facts.workflowRunId,
    nodeId: facts.nodeId,
    agentId: facts.agentId,
  };
}
