/**
 * agent.diagnostic.readiness_manager — the platform's FIRST business agent
 * (AI-01 Batch 3B, Part 7B, Phase 4).
 *
 *   Hierarchy   Manager
 *   Domain      D07 Diagnostic Assessment & Advisory
 *   Version     1.0.0
 *   State       certification: certified, enabled: true
 *
 * ── IT IS CERTIFIED, AND A PERSON DID THAT ─────────────────────────────────
 *
 * Passing a certification suite is evidence for a certification decision, not
 * the decision. A first business agent that certified itself the moment its
 * tests went green would make every later agent's certification mean the same
 * thing — which is nothing. So the definition shipped `enabled: false,
 * certification: 'uncertified'` through Parts 7A–7D, and both flags are flipped
 * here by a person, in a reviewed change, after reading the evidence:
 *
 *   the Part 7D technical gate reported READY_TO_CERTIFY with F1, F2 and F3
 *   passing and no blockers, and a named human authorised certification of
 *   THIS agent and the capability chain it declares — nothing wider.
 *
 * WHAT CERTIFICATION IS NOT. It is not activation. A certified, enabled agent
 * still runs only where a deployment assembles the capability and turns it on
 * (`AI_DIAGNOSTIC_REVIEW_ENABLED`, off by default), only over durable storage,
 * and only behind the same authority, approval, tenant and spend controls every
 * other agent answers to. Certification removes the registry's refusal; it
 * grants no authority the definition below does not already declare.
 *
 * ── WHAT THE AGENT DOES, IN ONE SENTENCE PER STEP ──────────────────────────
 *
 * REVIEW STAGE
 *   0  read its submission dossier
 *   1  ask the deterministic engines for the authoritative readiness result
 *   2  reason about it against the client's own words, through the control
 *      plane, with the untrusted half fenced
 *   3  hand the model's proposal to the draft tool, which fact-locks it against
 *      a freshly recomputed authority and seals it
 *   4  decide proceed or escalate, from the deterministic facts the draft
 *      returned and its own evidence assessment
 *   5  finish, saying which
 *
 * COMMIT STAGE
 *   0  commit the approved review through the guarded tool
 *   1  finish
 *
 * ── WHAT IT CANNOT DO, AND WHY THAT IS STRUCTURAL ──────────────────────────
 *
 * Part 7A's prohibition list is not a list of things this code declines to do.
 * Each one is absent from what the agent can reach:
 *
 *   compute or alter a score, rank, qualification or dependency
 *       No tool returns a mutable authority and no tool accepts one. The draft
 *       tool recomputes it and fact-locks over whatever was proposed.
 *   calculate ROI
 *       Nothing in this capability computes money. The ROI engines are not
 *       ported, imported or reachable.
 *   alter a submission, an answer or a submission status
 *       The dossier port has no writer.
 *   publish a report or email a client
 *       No tool has `sideEffect: external_write`, and the registry refuses one
 *       that does without an approval this agent cannot request.
 *   grant a permission
 *       Capabilities come from this definition; nothing at runtime edits it.
 *   request its own approval
 *       `agent.approval.request` is not in `capabilities`, so the orchestrator
 *       refuses the action before it is sealed.
 *   invoke an undeclared tool
 *       `allowedTools` is the gateway's allow list.
 *   perform a handoff
 *       Neither handoff capability is held and `allowedHandoffTargets` is empty.
 *   choose a provider or a model
 *       It declares ONE model profile. There is no second option to choose
 *       between, and a profile is not a model in any case — the control plane
 *       resolves that.
 */

import type { AgentDefinition, AgentProposalInput } from '../../../agents/contracts/agent.ts';
import type { AgentActionProposal } from '../../../agents/contracts/actions.ts';
import { AGENT_MODEL_PROFILE } from '../../../agents/runtime/defaultProfiles.ts';
import {
  arrayOf,
  bool,
  int,
  literal,
  num,
  object,
  optional,
  str,
} from '../../../security/validation.ts';
import type { DiagnosticSubmissionDossier } from '../contracts/dossier.ts';
import { SUBMISSION_ID_PATTERN } from '../contracts/dossier.ts';
import type { ReadinessAuthority } from '../contracts/readiness.ts';
import { ESCALATION_REASONS } from '../contracts/review.ts';
import { DIAGNOSTIC_TOOL_IDS } from '../tools/diagnosticTools.ts';
import { buildReviewContext, reviewObjective } from './context.ts';

export const READINESS_MANAGER_AGENT_ID = 'agent.diagnostic.readiness_manager';
export const READINESS_MANAGER_VERSION = '1.0.0';

/**
 * Which half of the workflow this run is.
 *
 * A literal on the node's declared input mapping, not something the agent
 * infers. One agent serving two nodes is deliberate — Part 7B ships ONE business
 * agent — and a stage it could choose for itself would be a decision nobody
 * reviewed.
 */
export const REVIEW_STAGES = ['review', 'commit'] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

export const readinessManagerInput = object({
  submissionId: str({ minLength: 1, maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
  stage: literal(REVIEW_STAGES),
  /** Present on the commit stage only: the digest the approval was about. */
  contentDigest: optional(str({ minLength: 8, maxLength: 64, pattern: /^[a-f0-9]+$/ })),
});

export const readinessManagerOutput = object({
  stage: literal(REVIEW_STAGES),
  submissionId: str({ maxLength: 64 }),
  outcome: literal(['drafted', 'escalated', 'committed'] as const),
  /** The condition node's input. True only when a draft is ready to approve. */
  reviewable: bool(),
  contentDigest: optional(str({ maxLength: 64 })),
  reviewId: optional(str({ maxLength: 96 })),
  escalationReason: optional(literal(ESCALATION_REASONS)),
  factLockRestored: arrayOf(str({ maxLength: 120 }), { maxItems: 64 }),
  factLockRemoved: arrayOf(str({ maxLength: 120 }), { maxItems: 64 }),
  authorityDigest: optional(str({ maxLength: 64 })),
  recommendationCount: optional(int({ min: 0, max: 7 })),
  confidence: optional(num({ min: 0, max: 1 })),
});

/**
 * Below this, a readiness result is not something to put in front of an
 * approver without a person having looked first.
 *
 * The canonical decision engine clamps confidence to [0.30, 0.98] and derives
 * it from completeness, answer quality, score separation and signal density.
 * 0.5 is the midpoint of that range and is declared here rather than inline so
 * the escalation rule is one readable constant.
 */
export const MINIMUM_REVIEW_CONFIDENCE = 0.5;

interface ComputeObservation {
  readonly authority: ReadinessAuthority;
  readonly evidence: {
    readonly company: string;
    readonly industry: string;
    readonly answeredQuestions: number;
    readonly answers: readonly {
      readonly questionId: number;
      readonly category: string;
      readonly questionText: string;
      readonly answer: string;
    }[];
  };
}

interface DraftObservation {
  readonly contentDigest: string;
  readonly factLockRestored: readonly string[];
  readonly factLockRemoved: readonly string[];
  readonly consistencyValid: boolean;
  readonly recommendationCount: number;
  readonly confidence: number;
  readonly dataCompleteness: number;
  readonly authorityDigest: string;
}

/** A record-shaped read that never throws on a hostile or absent value. */
function field<T>(source: unknown, key: string, guard: (value: unknown) => value is T): T | undefined {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return guard(value) ? value : undefined;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/**
 * The narrative the draft carries.
 *
 * Built from the model's result where it produced one and from a deterministic
 * fallback where it did not. A missing narrative is a thin review, not a failed
 * one: the numbers are the authority and they are already computed, so refusing
 * to draft because prose was absent would trade a certainty for an outage.
 *
 * Every field is bounded here, before it reaches a schema, because the source is
 * model output.
 */
function narrativeFrom(modelOutput: unknown, submissionId: string) {
  const summary =
    field(modelOutput, 'executiveSummary', isString) ??
    field(modelOutput, 'finding', isString) ??
    `Deterministic readiness result for ${submissionId}. No model narrative was produced.`;
  const evidence =
    field(modelOutput, 'evidenceAssessment', isString) ??
    'No model assessment of evidence sufficiency was produced; the deterministic consistency ' +
      'result stands on its own.';

  const commentaryRaw = field(modelOutput, 'recommendationCommentary', isArray) ?? [];
  const commentary = commentaryRaw
    .map((entry) => ({
      recommendationId: field(entry, 'recommendationId', isString) ?? '',
      commentary: (field(entry, 'commentary', isString) ?? '').slice(0, 1_000),
    }))
    .filter((entry) => entry.recommendationId !== '' && entry.commentary !== '')
    .slice(0, 7);

  return {
    executiveSummary: summary.slice(0, 2_000),
    evidenceAssessment: evidence.slice(0, 2_000),
    recommendationCommentary: commentary,
  };
}

/**
 * Contradictions the agent detected, bounded.
 *
 * The model may name them; the agent keeps them as ADVISORY OBSERVATIONS and
 * they change no number. What they do change is whether the review escalates,
 * which is a decision about whether a person should look — not about what the
 * result is.
 */
function contradictionsFrom(modelOutput: unknown): readonly string[] {
  const raw = field(modelOutput, 'contradictions', isArray) ?? [];
  return raw
    .filter(isString)
    .map((entry) => entry.slice(0, 400))
    .slice(0, 12);
}

function evidenceSufficientFrom(modelOutput: unknown): boolean {
  const claimed = field(modelOutput, 'evidenceSufficient', (value): value is boolean =>
    typeof value === 'boolean',
  );
  // ABSENT MEANS SUFFICIENT-UNLESS-THE-ENGINES-SAY-OTHERWISE. The deterministic
  // consistency result and the completeness figure are checked separately and
  // can escalate on their own; defaulting to `false` here would escalate every
  // review whose model said nothing, which is every review with a terse model.
  return claimed ?? true;
}

/**
 * The agent's behaviour: state in, intention out.
 *
 * Pure. It holds no store, no clock, no provider and no gateway — everything it
 * could act with is absent from `AgentProposalInput`, which is a stronger
 * guarantee than a rule saying it must not act.
 */
export function proposeReadinessReview(input: AgentProposalInput): AgentActionProposal {
  const run = input.input as {
    submissionId: string;
    stage: ReviewStage;
    contentDigest?: string;
  };
  const step = input.stepsTakenByThisAgent;
  const observation = input.lastObservation;

  // ── COMMIT STAGE ──
  if (run.stage === 'commit') {
    if (step === 0) {
      return {
        actionType: 'tool_call',
        reason: 'Committing the review the approver granted.',
        idempotencyKey: `commit:${input.runId}`,
        toolId: DIAGNOSTIC_TOOL_IDS.commitReview,
        // The digest the workflow carried from the review node. The tool
        // refuses it unless it is the digest the sealed draft holds, so a wrong
        // one is a refusal rather than a different commit.
        input: { contentDigest: run.contentDigest ?? '' },
      };
    }

    const reviewId = field(observation?.output, 'reviewId', isString);
    if (observation?.ok !== true || reviewId === undefined) {
      return {
        actionType: 'fail',
        reason: 'The review could not be committed.',
        idempotencyKey: `commit_failed:${input.runId}`,
        failureReason: 'commit_refused',
      };
    }
    return {
      actionType: 'complete',
      reason: 'The approved review is committed.',
      idempotencyKey: `complete:${input.runId}`,
      output: {
        stage: 'commit',
        submissionId: run.submissionId,
        outcome: 'committed',
        reviewable: true,
        reviewId,
        contentDigest: field(observation.output, 'contentDigest', isString),
        factLockRestored: [],
        factLockRemoved: [],
      },
    };
  }

  // ── REVIEW STAGE ──
  switch (step) {
    case 0:
      return {
        actionType: 'tool_call',
        reason: 'Reading the submission this review is about.',
        idempotencyKey: `dossier:${input.runId}`,
        toolId: DIAGNOSTIC_TOOL_IDS.readDossier,
        input: { submissionId: run.submissionId },
      };

    case 1: {
      const dossier = field(
        observation?.output,
        'dossier',
        (value): value is DiagnosticSubmissionDossier =>
          typeof value === 'object' && value !== null,
      );
      const answers = dossier?.answers ?? [];
      if (observation?.ok !== true || answers.length === 0) {
        // NOTHING TO REVIEW. Escalated rather than scored: an engine will
        // happily produce a readiness result for an empty submission, and
        // putting one in front of an approver would be the review saying
        // something it has no evidence for.
        return {
          actionType: 'tool_call',
          reason: 'The submission carries no answers to review.',
          idempotencyKey: `escalate_empty:${input.runId}`,
          toolId: DIAGNOSTIC_TOOL_IDS.recordEscalation,
          input: {
            submissionId: run.submissionId,
            reason: 'insufficient_evidence',
            detail: 'The submission carries no answered diagnostic questions.',
          },
        };
      }
      return {
        actionType: 'tool_call',
        reason: 'Asking the deterministic engines for the authoritative readiness result.',
        idempotencyKey: `readiness:${input.runId}`,
        toolId: DIAGNOSTIC_TOOL_IDS.computeReadiness,
        input: { submissionId: run.submissionId },
      };
    }

    case 2: {
      // The escalation branch from step 1 lands here with an escalation result
      // rather than an authority. Finishing is the only correct move: the run
      // has recorded why a person is needed.
      const escalationId = field(observation?.output, 'escalationId', isString);
      if (escalationId !== undefined) {
        return {
          actionType: 'complete',
          reason: 'The submission was escalated rather than reviewed.',
          idempotencyKey: `complete:${input.runId}`,
          output: {
            stage: 'review',
            submissionId: run.submissionId,
            outcome: 'escalated',
            reviewable: false,
            escalationReason: 'insufficient_evidence',
            factLockRestored: [],
            factLockRemoved: [],
          },
        };
      }

      const computed = observation?.output as ComputeObservation | undefined;
      if (observation?.ok !== true || computed?.authority === undefined) {
        return {
          actionType: 'fail',
          reason: 'The deterministic readiness result could not be obtained.',
          idempotencyKey: `readiness_failed:${input.runId}`,
          failureReason: 'authority_unavailable',
        };
      }

      const dossierForContext: DiagnosticSubmissionDossier = {
        submissionId: run.submissionId,
        organizationId: input.organizationId,
        company: computed.evidence.company,
        industry: computed.evidence.industry,
        employeeEstimate: 0,
        totalQuestions: computed.authority.readiness.totalQuestions,
        answers: computed.evidence.answers,
        submittedAt: '',
        status: 'submitted',
      };

      return {
        actionType: 'model_call',
        reason: 'Explaining the deterministic result and assessing the evidence behind it.',
        idempotencyKey: `narrative:${input.runId}`,
        // ONE PROFILE. The agent declares exactly one, so there is no model
        // decision here to get wrong — and a profile is not a model in any
        // case; the control plane resolves that.
        modelProfileId: AGENT_MODEL_PROFILE.standard,
        objective: reviewObjective(dossierForContext),
        context: buildReviewContext({
          dossier: dossierForContext,
          authority: computed.authority,
        }),
        // No required fields: the narrative is ADVISORY, and a run that failed
        // because prose was missing would be trading a computed certainty for
        // an outage. What the narrative must not do is decide anything, and
        // that is enforced by the fact lock rather than by a required field.
        expectedOutput: { requiredFields: [], maxBytes: 32 * 1024 },
      };
    }

    case 3: {
      const modelOutput = observation?.ok === true ? observation.output : undefined;
      return {
        actionType: 'tool_call',
        reason: 'Fact-locking the proposed review against the deterministic authority.',
        idempotencyKey: `draft:${input.runId}`,
        toolId: DIAGNOSTIC_TOOL_IDS.draftReview,
        input: {
          submissionId: run.submissionId,
          narrative: narrativeFrom(modelOutput, run.submissionId),
          evidenceSufficient: evidenceSufficientFrom(modelOutput),
          contradictions: contradictionsFrom(modelOutput),
          // PASSED THROUGH UNCHANGED, including whatever the model decided to
          // claim about the authoritative fields. Sanitising it here would hide
          // exactly the drift the lock exists to report.
          ...(field(modelOutput, 'readiness', (value): value is Record<string, unknown> =>
            typeof value === 'object' && value !== null && !Array.isArray(value),
          ) === undefined
            ? {}
            : {
                proposedReadiness: field(
                  modelOutput,
                  'readiness',
                  (value): value is Record<string, unknown> =>
                    typeof value === 'object' && value !== null && !Array.isArray(value),
                ),
              }),
          ...(field(modelOutput, 'recommendations', isArray) === undefined
            ? {}
            : { proposedRecommendations: field(modelOutput, 'recommendations', isArray) }),
        },
      };
    }

    case 4: {
      const draft = observation?.output as DraftObservation | undefined;
      if (observation?.ok !== true || draft?.contentDigest === undefined) {
        return {
          actionType: 'fail',
          reason: 'The review draft could not be sealed.',
          idempotencyKey: `draft_failed:${input.runId}`,
          failureReason: 'draft_refused',
        };
      }

      // ── PROCEED OR ESCALATE ──
      //
      // Deterministic facts first, because they are the ones that cannot be
      // argued with; the agent's own reading of the evidence second. Any one of
      // them is enough to send this to a person instead of to an approver.
      const reason = escalationReasonFor(draft);
      if (reason !== undefined) {
        return {
          actionType: 'tool_call',
          reason: 'This review needs a person before it can go to an approver.',
          idempotencyKey: `escalate:${input.runId}`,
          toolId: DIAGNOSTIC_TOOL_IDS.recordEscalation,
          input: {
            submissionId: run.submissionId,
            reason,
            detail: escalationDetailFor(reason, draft),
          },
        };
      }

      return {
        actionType: 'complete',
        reason: 'The review is drafted and ready for approval.',
        idempotencyKey: `complete:${input.runId}`,
        output: {
          stage: 'review',
          submissionId: run.submissionId,
          outcome: 'drafted',
          reviewable: true,
          contentDigest: draft.contentDigest,
          factLockRestored: [...draft.factLockRestored],
          factLockRemoved: [...draft.factLockRemoved],
          authorityDigest: draft.authorityDigest,
          recommendationCount: draft.recommendationCount,
          confidence: draft.confidence,
        },
      };
    }

    default: {
      const escalationReason = field(observation?.output, 'reason', isString);
      return {
        actionType: 'complete',
        reason: 'The review was escalated rather than sent for approval.',
        idempotencyKey: `complete:${input.runId}`,
        output: {
          stage: 'review',
          submissionId: run.submissionId,
          outcome: 'escalated',
          reviewable: false,
          ...(escalationReason !== undefined &&
          (ESCALATION_REASONS as readonly string[]).includes(escalationReason)
            ? { escalationReason }
            : {}),
          factLockRestored: [],
          factLockRemoved: [],
        },
      };
    }
  }
}

/** The declared escalation conditions, in the order they are checked. */
export function escalationReasonFor(
  draft: Pick<
    DraftObservation,
    'consistencyValid' | 'recommendationCount' | 'confidence'
  >,
): (typeof ESCALATION_REASONS)[number] | undefined {
  if (!draft.consistencyValid) return 'consistency_failed';
  if (draft.recommendationCount === 0) return 'empty_portfolio';
  if (draft.confidence < MINIMUM_REVIEW_CONFIDENCE) return 'low_confidence';
  return undefined;
}

function escalationDetailFor(
  reason: (typeof ESCALATION_REASONS)[number],
  draft: DraftObservation,
): string {
  switch (reason) {
    case 'consistency_failed':
      return 'The deterministic consistency validator refused this readiness result.';
    case 'empty_portfolio':
      return 'No department met both qualification thresholds, so there is nothing to recommend.';
    case 'low_confidence':
      return (
        `Decision confidence is ${draft.confidence}, below the ${MINIMUM_REVIEW_CONFIDENCE} ` +
        `threshold, over ${Math.round(draft.dataCompleteness * 100)}% data completeness.`
      );
    default:
      return 'This review needs a person.';
  }
}

/**
 * The definition.
 *
 * `enabled: true` and `certification: 'certified'` under the human
 * certification decision recorded in the header. Every other field is the one
 * the certification review read — the capability list, the tool allow list, the
 * single model profile, the limits and the approval posture are unchanged.
 */
export const readinessManagerAgent: AgentDefinition = {
  agentId: READINESS_MANAGER_AGENT_ID,
  displayName: 'Diagnostic Readiness Manager',
  purpose:
    'Review one diagnostic submission against the deterministic readiness engines and draft an advisory review.',
  description:
    'Hierarchy: Manager. Domain: D07 Diagnostic Assessment & Advisory. Reads a submission ' +
    'dossier, invokes the deterministic readiness computation, assesses evidence ' +
    'sufficiency, explains the result, drafts an advisory review, and either escalates or ' +
    'commits through a human-approved, guarded tool. It never decides a score, a rank, a ' +
    'qualification or a dependency.',
  owner: 'MARQ Diagnostic Assessment & Advisory (D07)',
  version: READINESS_MANAGER_VERSION,
  // CERTIFIED BY A HUMAN DECISION, not by a passing suite. See the header.
  enabled: true,
  certification: 'certified',
  // It writes tenant data — a sealed draft, an escalation, a committed review —
  // and causes no effect outside the platform. `external_effect` would be a
  // claim no tool here could make good on, and `tenant_readonly` would be a
  // claim contradicted by three internal writes.
  safetyClass: 'tenant_write',
  capabilities: ['agent.model.invoke', 'agent.tool.invoke', 'agent.checkpoint.write'],
  allowedTools: [
    DIAGNOSTIC_TOOL_IDS.readDossier,
    DIAGNOSTIC_TOOL_IDS.computeReadiness,
    DIAGNOSTIC_TOOL_IDS.draftReview,
    DIAGNOSTIC_TOOL_IDS.recordEscalation,
    DIAGNOSTIC_TOOL_IDS.commitReview,
  ],
  allowedModelProfiles: [AGENT_MODEL_PROFILE.standard],
  allowedHandoffTargets: [],
  inputContract: readinessManagerInput,
  outputContract: readinessManagerOutput,
  limits: {
    // Six steps is the review stage's whole path plus one. A ceiling that left
    // room for a second pass would be room for a loop nobody designed.
    maxTotalSteps: 8,
    maxStepsPerAgent: 8,
    maxHandoffs: 0,
    maxRetries: 1,
    maxRepeatedActions: 2,
    maxRepeatedHandoffs: 1,
    maxRuntimeMs: 300_000,
    maxPromptTokens: 60_000,
    maxCompletionTokens: 8_000,
    maxTotalTokens: 68_000,
    maxEstimatedCostMicroUsd: 400_000,
    maxActualCostMicroUsd: 400_000,
  },
  approvals: {
    // INERT FOR THIS AGENT, AND DECLARED ANYWAY. It requests no approval, hands
    // off to nobody, and calls no high-risk tool — so no path through the
    // orchestrator reads these. The approval that governs a review is the
    // WORKFLOW's, at a barrier an operator can see in the plan, and it is
    // enforced inside the commit tool. The roles here match that node's so a
    // reader comparing the two is not left wondering which is authoritative.
    requireForToolRisk: ['high'],
    requireForHandoff: false,
    requireForCompletion: false,
    approverRoles: ['owner', 'reviewer'],
    expiresAfterMs: 3_600_000,
  },
  completion: {
    requiredOutputFields: ['stage', 'submissionId', 'outcome', 'reviewable'],
    terminalAfterHandoff: true,
  },
  propose: proposeReadinessReview,
};
