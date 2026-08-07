/**
 * What the compression engine is allowed to know about a proposed inference
 * (AI-01 Batch 3B, Part 6A).
 *
 * ── EVERY FIELD IS DECLARED, NONE IS INFERRED BY A MODEL ───────────────────
 *
 * The batch is explicit that Cortex must not call an LLM merely to decide which
 * LLM to call, and this type is how that rule is enforced rather than merely
 * stated: there is nowhere in `AiTaskDescriptor` for a model's opinion to enter.
 * Everything here comes from the workflow definition, the agent definition, the
 * node metadata or the caller's declared requirement — all of which are data a
 * human authored and a validator accepted.
 *
 * That is also what makes classification REPRODUCIBLE. Identical descriptors
 * classify identically on every isolate and in every test, because the
 * classifier is a pure function of these fields and nothing else.
 *
 * ── THE TASK CARRIES ITS OWN PROTECTIONS ───────────────────────────────────
 *
 * `mandatory`, `safetyCritical` and `approvalBound` are on the descriptor rather
 * than resolved somewhere in the engine, because they are facts about the work
 * and not judgements about the budget. The stop control reads them and refuses
 * to stop; no amount of budget pressure reaches past them. A saving that came
 * from skipping a mandatory compliance step is not a saving, it is an incident.
 */

import type { CapabilityProfile, QualityProfile } from './compression.ts';

/**
 * The shapes of work Cortex admits.
 *
 * A closed list because the classifier's reason codes have to mean something
 * across releases: "this was classified `simple` because it is an extraction"
 * is a sentence only a fixed vocabulary can support.
 */
export const AI_TASK_KINDS = [
  /** Pure lookup or state read. Almost always avoidable. */
  'retrieval',
  /** Deterministic reshaping of a known input. */
  'transformation',
  /** Arithmetic or aggregation over known values. */
  'calculation',
  /** Pull declared fields out of supplied text. */
  'extraction',
  /** Assign one of a declared set of labels. */
  'classification',
  /** Condense supplied text. */
  'summarization',
  /** Produce prose from a brief. */
  'generation',
  /** Multi-step inference over supplied evidence. */
  'reasoning',
  /** Plan a sequence of actions. */
  'planning',
  /** Judge something against declared criteria. */
  'review',
] as const;

export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

/**
 * A non-inference path the CALLER has already declared and authorised.
 *
 * The engine never invents one of these and never executes one. It recognises
 * that the caller says it has one, checks that it covers the task, and reports
 * that inference is unnecessary. Executing arbitrary deterministic code from
 * inside a cost optimiser would be a second execution path wearing an
 * accountant's coat, which is the specific thing this batch forbids.
 */
export interface DeterministicCapability {
  readonly capabilityId: string;
  /** Task kinds this path can satisfy in full. */
  readonly satisfies: readonly AiTaskKind[];
  /**
   * True when the caller has verified the path produces the COMPLETE answer.
   *
   * A partial deterministic path is not an avoidance — it is a smaller prompt at
   * best — so the engine treats `false` as "no avoidance available" rather than
   * as "avoid and hope".
   */
  readonly complete: boolean;
  /** Highest quality contract this path is certified against. */
  readonly maximumQuality: QualityProfile;
}

/**
 * A prior result the caller says is still valid for this exact task.
 *
 * Part 6A takes this as an INPUT and never produces one. Cache lookup, semantic
 * similarity, freshness windows, provenance and invalidation are Part 6B, and
 * they are separated deliberately: every one of those is a tenant-isolation
 * question, and a reuse engine that shipped alongside the accounting it feeds
 * would have had both reviewed as one thing.
 */
export interface ValidatedPriorOutput {
  readonly artifactId: string;
  /** Digest of the value. The engine compares, it never reads the value. */
  readonly digest: string;
  /** The organization the artefact belongs to. Checked, never assumed. */
  readonly organizationId: string;
  /** True when the caller has re-validated it against the task's contract. */
  readonly contractValidated: boolean;
  /** Quality contract this artefact was produced under. */
  readonly quality: QualityProfile;
}

/**
 * The declared shape of one proposed inference.
 *
 * Sizes are in TOKENS and are estimates supplied by the caller's own estimator
 * (`agents/runtime/tokenIntelligence.ts` in practice). The engine does not
 * re-estimate from text, because it never sees text — it sees metadata about
 * text, which is what keeps a tenant's business data out of the optimiser.
 */
export interface AiTaskDescriptor {
  readonly taskId: string;
  readonly organizationId: string;
  readonly kind: AiTaskKind;
  /** The quality contract this task must still satisfy after optimisation. */
  readonly quality: QualityProfile;

  // ── Declared characteristics the classifier reads ─────────────────────────
  readonly requiresStructuredOutput: boolean;
  /** Several dependent inference steps, not one. */
  readonly requiresMultiStepReasoning: boolean;
  /** The answer depends on evidence supplied in context. */
  readonly requiresSuppliedEvidence: boolean;
  /** An approximate answer is acceptable to the caller. */
  readonly toleratesApproximation: boolean;
  /** Distinct declared output fields. A crude but declared complexity signal. */
  readonly outputFieldCount: number;
  /** Caller's estimate of the completion size it needs. */
  readonly expectedOutputTokens: number;

  // ── Protections. Read by the stop control, never by the budget ────────────
  /** A workflow step the definition marks as required. Never stopped to save. */
  readonly mandatory: boolean;
  /** Safety, governance or compliance work. Never stopped to save. */
  readonly safetyCritical: boolean;
  /** Bound to an approval a person gave. Never re-scoped to save. */
  readonly approvalBound: boolean;

  // ── Non-inference options the caller has already authorised ───────────────
  readonly deterministicCapabilities: readonly DeterministicCapability[];
  readonly priorOutputs: readonly ValidatedPriorOutput[];

  // ── Optional workflow provenance, for metrics and audit only ──────────────
  readonly workflowId?: string;
  readonly workflowRunId?: string;
  readonly nodeId?: string;
  readonly agentId?: string;
}

/**
 * What the CALLER already permits, and therefore the outer bound on everything
 * the engine may recommend.
 *
 * THIS IS THE WIDENING GUARD, expressed as a type. The engine takes these as
 * hard ceilings and every recommendation is clamped to them; there is no code
 * path in `optimization/` that returns a number above one of these fields or a
 * profile above `maximumCapabilityProfile`. A caller that wants more headroom
 * changes its own policy — the optimiser cannot grant it.
 */
export interface ControlPlaneEnvelope {
  /** Prompt tokens the caller's own limits already permit. */
  readonly maxPromptTokens: number;
  /** Completion tokens the caller's own limits already permit. */
  readonly maxCompletionTokens: number;
  /** Total tokens the caller's own limits already permit. */
  readonly maxTotalTokens: number;
  /** Micro-USD the caller may still spend on this task. */
  readonly remainingCostMicroUsd: number;
  /**
   * Capability bands the caller is permitted to request, lowest to highest.
   *
   * Supplied by the caller from its OWN allow list. The engine picks from this
   * array and can never add to it, which is why a recommendation cannot reach a
   * band an administrator has not certified.
   */
  readonly allowedCapabilityProfiles: readonly CapabilityProfile[];
  /** The highest band the caller would have used with no optimisation at all. */
  readonly maximumCapabilityProfile: CapabilityProfile;
  /** False when AI is administratively off or the kill switch is engaged. */
  readonly aiEnabled: boolean;
}
