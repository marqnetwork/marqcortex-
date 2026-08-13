/**
 * The five diagnostic tools (Part 7B, Phases 2 and 3).
 *
 * Every one of them goes through the Batch 3A Tool Gateway — there is no second
 * path, and the gateway checks the agent's allow list, the agent's
 * capabilities, the ACTOR's capability, the tenant, the declared input schema,
 * idempotency, a timeout it cannot extend and the declared output schema before
 * and after anything here runs.
 *
 * ── TENANT AUTHORITY ───────────────────────────────────────────────────────
 *
 * `invocation.organizationId` and nothing else. It is resolved by the runtime
 * from the run, and no input schema in this file declares an `organizationId`
 * field — `object()` DROPS undeclared keys, so a payload carrying one never
 * reaches an executor at all. Every store call keys by the invocation's
 * organization, and every output states which organization answered.
 *
 * ── THE CLASSIFICATION TABLE, AND WHY IT IS WHAT IT IS ─────────────────────
 *
 *   read_submission_dossier   read_only / none / idempotent
 *       A read. Repeating it changes nothing, and it writes nothing.
 *
 *   compute_readiness         read_only / none / idempotent
 *       A pure function of the dossier. The AUTHORITY is produced here, which
 *       is why the agent never computes one: it asks for one.
 *
 *   draft_review_record       low / internal_write / idempotent
 *       Seal-once. Re-sealing identical content returns the same record;
 *       re-sealing different content is a refusal. Both make repetition safe,
 *       which is what `idempotent` claims.
 *
 *   record_escalation         low / internal_write / idempotent
 *       Append-once under a deterministic id, for the same reason.
 *
 *   commit_review_outcome     moderate / internal_write / non_idempotent
 *       The one call that turns a draft into a decision. Non-idempotent because
 *       committing twice is not committing once, and the gateway refuses a
 *       repeated key rather than replaying a result.
 *
 * NOTHING HERE IS `external_write` AND NOTHING IS `platform` SCOPED. The
 * capability sends no mail, publishes no report and reads no other tenant. Both
 * absences are asserted by the certification suite rather than left as a
 * property of the current code.
 *
 * ── WHY THE COMMIT DOES NOT SET `requiresApproval` ─────────────────────────
 *
 * `requiresApproval` makes the GATEWAY demand that the caller name an approval
 * — an AGENT-run approval, answered by whoever is watching the agent console.
 * The approval that governs a review is the WORKFLOW's, decided by a declared
 * role at a barrier a reviewer can see in the plan, and this tool refuses
 * without one. Setting the flag as well would add a second, weaker gate and
 * would park the agent run waiting for it; what it would not do is make the
 * real precondition any stronger. The precondition is below, in code, and the
 * adversarial suite drives every way around it that exists.
 */

import type { ToolDefinition, ToolInvocation } from '../../../agents/contracts/tools.ts';
import {
  arrayOf,
  bool,
  int,
  isFailure,
  jsonObject,
  literal,
  num,
  object,
  optional,
  str,
} from '../../../security/validation.ts';
import { digestValue } from '../../../agents/runtime/digest.ts';
import type { WorkflowApprovalRecord } from '../../../workflows/contracts/approval.ts';
import type { DiagnosticSubmissionDossier } from '../contracts/dossier.ts';
import { SUBMISSION_ID_PATTERN, diagnosticDossierSchema } from '../contracts/dossier.ts';
import type { ReadinessAuthority } from '../contracts/readiness.ts';
import { readinessAuthoritySchema } from '../contracts/readiness.ts';
import type {
  CommittedReviewRecord,
  EscalationReason,
  ReviewDraftRecord,
  ReviewRecordContent,
} from '../contracts/review.ts';
import {
  ADVISORY_NOTICE,
  ESCALATION_REASONS,
  REVIEW_BOUNDS,
  diagnosticFailure,
  reviewContentSchema,
  reviewNarrativeSchema,
} from '../contracts/review.ts';
import { computeReadinessAuthority } from '../deterministic/readinessAuthority.ts';
import { enforceReadinessFactLock } from '../agent/factLock.ts';
import type {
  CommittedReviewStore,
  DiagnosticDossierStore,
  ReviewDraftStore,
  ReviewEscalationStore,
} from '../persistence/ports.ts';
import type { ReviewApprovalAuthorityPort } from '../persistence/authorityPort.ts';

const OWNER = 'MARQ Diagnostic Assessment & Advisory (D07)';
const TOOL_VERSION = '1.0.0';

export const DIAGNOSTIC_TOOL_IDS = {
  readDossier: 'tool.diagnostic.read_submission_dossier',
  computeReadiness: 'tool.diagnostic.compute_readiness',
  draftReview: 'tool.diagnostic.draft_review_record',
  recordEscalation: 'tool.diagnostic.record_escalation',
  commitReview: 'tool.diagnostic.commit_review_outcome',
} as const;

export interface DiagnosticToolDependencies {
  readonly dossiers: DiagnosticDossierStore;
  readonly drafts: ReviewDraftStore;
  readonly escalations: ReviewEscalationStore;
  readonly commits: CommittedReviewStore;
  readonly authority: ReviewApprovalAuthorityPort;
  /**
   * The approval node a commit may be authorised by, and the roles that node
   * declares.
   *
   * Supplied at ASSEMBLY, from the registered workflow definition — never from
   * an input and never read live at commit time. Reading it live would mean a
   * definition edited after a decision could change who was allowed to have
   * made it, which is the same defect the approval gate avoids by freezing
   * `authorizedRoles` onto the record.
   */
  readonly commitAuthorization: {
    readonly workflowId: string;
    readonly approvalNodeId: string;
    readonly approverRoles: readonly string[];
  };
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * The scope a draft, an escalation and a commit are keyed by.
 *
 * The workflow run when this agent run is a workflow node, and `agentrun:<id>`
 * otherwise. A direct agent run may therefore draft and escalate — neither
 * decides anything — and what it drafts is in a scope no commit can name.
 */
async function reviewScopeFor(
  deps: DiagnosticToolDependencies,
  invocation: ToolInvocation,
): Promise<{ scopeId: string; workflow?: Awaited<ReturnType<ReviewApprovalAuthorityPort['owningWorkflowRun']>> }> {
  const workflow = await deps.authority.owningWorkflowRun(
    invocation.organizationId,
    invocation.runId,
  );
  return workflow === undefined
    ? { scopeId: `agentrun:${invocation.runId}` }
    : { scopeId: workflow.workflowRunId, workflow };
}

async function requireDossier(
  deps: DiagnosticToolDependencies,
  invocation: ToolInvocation,
  submissionId: string,
): Promise<DiagnosticSubmissionDossier> {
  // KEYED BY THE INVOCATION'S ORGANIZATION. A submission id belonging to
  // another tenant simply does not resolve — the caller learns that the id is
  // not available to them, and never that it exists somewhere else.
  const dossier = await deps.dossiers.load(invocation.organizationId, submissionId);
  if (!dossier) {
    throw diagnosticFailure(
      'diagnostic_submission_not_found',
      'That submission is not available.',
      `submission ${submissionId} not found for ${invocation.organizationId}`,
    );
  }
  if (dossier.organizationId !== invocation.organizationId) {
    // Unreachable through a keyed store, and asserted anyway: a future store
    // that is not keyed must not be able to weaken this silently.
    throw diagnosticFailure(
      'diagnostic_tenant_mismatch',
      'That submission belongs to another organization.',
      'dossier organization mismatch',
    );
  }
  return dossier;
}

// ── 1. Read the dossier ─────────────────────────────────────────────────────

export function createReadDossierTool(deps: DiagnosticToolDependencies): ToolDefinition {
  return {
    toolId: DIAGNOSTIC_TOOL_IDS.readDossier,
    version: TOOL_VERSION,
    owner: OWNER,
    purpose: 'Read one diagnostic submission belonging to the run’s organization.',
    inputSchema: object({
      submissionId: str({ minLength: 1, maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
    }),
    outputSchema: object({ dossier: diagnosticDossierSchema }),
    risk: 'read_only',
    requiredCapabilities: [],
    tenantScope: 'run_organization',
    idempotency: 'idempotent',
    timeoutMs: 3_000,
    sideEffect: 'none',
    requiresApproval: false,
    enabled: true,
    // Uncertified until a human says otherwise — the same posture the agent
    // itself carries, and for the same reason. See `index.ts`.
    certification: 'uncertified',
    execute: async (invocation) => {
      const input = invocation.input as { submissionId: string };
      const dossier = await requireDossier(deps, invocation, input.submissionId);
      return { dossier };
    },
  };
}

// ── 2. Compute the authority ────────────────────────────────────────────────

export function createComputeReadinessTool(deps: DiagnosticToolDependencies): ToolDefinition {
  return {
    toolId: DIAGNOSTIC_TOOL_IDS.computeReadiness,
    version: TOOL_VERSION,
    owner: OWNER,
    purpose:
      'Run the deterministic readiness chain over one submission and return the authoritative result.',
    inputSchema: object({
      submissionId: str({ minLength: 1, maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
    }),
    /**
     * The result AND the evidence it was computed from.
     *
     * An agent sees ONE observation — the previous step's — so a narrative step
     * that must cite the client's own words while explaining the engine's
     * numbers has to receive both together or receive neither. They travel from
     * the one component that has read every answer, which also means the
     * evidence a narrative quotes is provably the evidence the score was
     * computed over rather than a second read that could have drifted.
     *
     * `evidence` is UNTRUSTED business text and is labelled as such wherever it
     * is used — see `agent/context.ts`, which fences it.
     */
    outputSchema: object({
      authority: readinessAuthoritySchema,
      evidence: object({
        company: str({ maxLength: 200 }),
        industry: str({ maxLength: 120 }),
        answeredQuestions: int({ min: 0, max: 64 }),
        answers: arrayOf(
          object({
            questionId: int({ min: 0, max: 10_000 }),
            category: str({ maxLength: 120 }),
            questionText: str({ maxLength: 500 }),
            answer: str({ maxLength: 4_000 }),
          }),
          { maxItems: 64 },
        ),
      }),
    }),
    risk: 'read_only',
    requiredCapabilities: [],
    tenantScope: 'run_organization',
    idempotency: 'idempotent',
    timeoutMs: 5_000,
    sideEffect: 'none',
    requiresApproval: false,
    enabled: true,
    certification: 'uncertified',
    execute: async (invocation) => {
      const input = invocation.input as { submissionId: string };
      const dossier = await requireDossier(deps, invocation, input.submissionId);
      // THE ONLY PLACE AN AUTHORITY IS PRODUCED. A pure function of the
      // dossier: no clock, no store, no model, no caller input beyond the id.
      const authority = computeReadinessAuthority(dossier);
      return {
        authority,
        evidence: {
          company: dossier.company,
          industry: dossier.industry,
          answeredQuestions: authority.readiness.answeredQuestions,
          answers: dossier.answers.map((entry) => ({
            questionId: entry.questionId,
            category: entry.category,
            questionText: entry.questionText,
            answer: entry.answer,
          })),
        },
      };
    },
  };
}

// ── 3. Draft the review ─────────────────────────────────────────────────────

/**
 * THE FACT LOCK RUNS HERE, AND THAT IS THE POINT.
 *
 * Part 7A requires the lock to run after generation, unconditionally. Running it
 * in the AGENT would put it on the side of the boundary the model's output is
 * already on: an agent that skipped it, or ran it against an authority it had
 * been handed, would produce a draft nobody could distinguish from a locked one.
 *
 * So the tool takes the model's proposal as PROPOSED — untyped, untrusted, and
 * explicitly allowed to be wrong — recomputes the authority from the stored
 * dossier, reconciles every locked value against it, and seals a draft that
 * carries the authority verbatim plus the report of what the lock had to do.
 * There is no input through which a caller can skip that, and no branch inside
 * it that can be reached without it.
 */
export function createDraftReviewTool(deps: DiagnosticToolDependencies): ToolDefinition {
  return {
    toolId: DIAGNOSTIC_TOOL_IDS.draftReview,
    version: TOOL_VERSION,
    owner: OWNER,
    purpose:
      'Fact-lock a proposed review against the deterministic authority and seal it, once.',
    inputSchema: object({
      submissionId: str({ minLength: 1, maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
      narrative: reviewNarrativeSchema,
      evidenceSufficient: bool(),
      contradictions: arrayOf(str({ maxLength: REVIEW_BOUNDS.contradictions.text }), {
        maxItems: REVIEW_BOUNDS.contradictions.max,
      }),
      /**
       * What the model claimed about the authoritative fields.
       *
       * Deliberately loose: this is the value the lock exists to reconcile, so a
       * schema that refused a wrong one would refuse the very case the lock is
       * for. Bounded in size, and nothing more.
       */
      proposedReadiness: optional(jsonObject({ maxDepth: 6, maxNodes: 400 })),
      proposedRecommendations: optional(
        arrayOf(jsonObject({ maxDepth: 6, maxNodes: 400 }), { maxItems: 24 }),
      ),
    }),
    outputSchema: object({
      organizationId: str({ maxLength: 64 }),
      reviewScopeId: str({ maxLength: 128 }),
      submissionId: str({ maxLength: 64 }),
      contentDigest: str({ maxLength: 64 }),
      createdAt: str({ maxLength: 40 }),
      sealed: literal(['yes'] as const),
      factLockRestored: arrayOf(str({ maxLength: REVIEW_BOUNDS.factLockPaths.text }), {
        maxItems: REVIEW_BOUNDS.factLockPaths.max,
      }),
      factLockRemoved: arrayOf(str({ maxLength: REVIEW_BOUNDS.factLockPaths.text }), {
        maxItems: REVIEW_BOUNDS.factLockPaths.max,
      }),
      /** Deterministic facts the agent's proceed-or-escalate decision reads. */
      consistencyValid: bool(),
      recommendationCount: int({ min: 0, max: 7 }),
      confidence: num({ min: 0, max: 1 }),
      dataCompleteness: num({ min: 0, max: 1 }),
      authorityDigest: str({ maxLength: 64 }),
    }),
    risk: 'low',
    requiredCapabilities: [],
    tenantScope: 'run_organization',
    idempotency: 'idempotent',
    timeoutMs: 5_000,
    sideEffect: 'internal_write',
    requiresApproval: false,
    enabled: true,
    certification: 'uncertified',
    execute: async (invocation) => {
      const input = invocation.input as {
        submissionId: string;
        narrative: ReviewRecordContent['narrative'];
        evidenceSufficient: boolean;
        contradictions: readonly string[];
        proposedReadiness?: Record<string, unknown>;
        proposedRecommendations?: readonly Record<string, unknown>[];
      };

      // The dossier read re-checks the tenant, so a draft cannot be sealed
      // against a submission this run may not see.
      const dossier = await requireDossier(deps, invocation, input.submissionId);

      // RECOMPUTED, NOT RECEIVED. The authority the draft carries is derived
      // here from stored data, so nothing the agent sends can become one.
      const authority = computeReadinessAuthority(dossier);

      // UNCONDITIONAL. No branch reaches the seal without passing through it,
      // and it runs whether or not the proposal appears to have complied.
      const locked = enforceReadinessFactLock(
        {
          ...(input.proposedReadiness === undefined
            ? {}
            : { readiness: input.proposedReadiness }),
          ...(input.proposedRecommendations === undefined
            ? {}
            : { recommendations: input.proposedRecommendations }),
        },
        authority,
      );

      const content: ReviewRecordContent = {
        submissionId: dossier.submissionId,
        authority,
        narrative: input.narrative,
        advisoryNotice: ADVISORY_NOTICE,
        factLockRestored: locked.restored,
        factLockRemoved: locked.removed,
        evidenceSufficient: input.evidenceSufficient,
        contradictions: input.contradictions,
      };

      // ── VALIDATED BEFORE IT IS SEALED (Part 7D, F1) ──
      //
      // The gateway validates this tool's OUTPUT, which is far too late: by
      // then the draft is durably sealed, the scope is spent, and a re-draft is
      // a `diagnostic_draft_sealed` refusal — so a model that produced a record
      // its own schema cannot represent would have poisoned the run rather than
      // failed a call. Checking the record here means a refusal leaves NOTHING
      // written, and a clean retry seals normally.
      //
      // The lock now bounds its own report, so this gate should be unreachable
      // through the fact-lock path. It is here for the case a gate exists for:
      // some future field whose size nobody re-checked.
      const validated = reviewContentSchema.validate(content, 'review');
      if (isFailure(validated)) {
        throw diagnosticFailure(
          'diagnostic_record_invalid',
          'This review could not be recorded.',
          `assembled review record is not representable: ${validated.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; ')
            .slice(0, 300)}`,
        );
      }

      const { scopeId } = await reviewScopeFor(deps, invocation);
      const contentDigest = digestValue(content);
      const candidate: ReviewDraftRecord = {
        organizationId: invocation.organizationId,
        reviewScopeId: scopeId,
        submissionId: content.submissionId,
        contentDigest,
        content,
        draftedByAgentRunId: invocation.runId,
        createdAt: invocation.nowIso,
        sealed: true,
      };

      const stored = await deps.drafts.seal(candidate);
      if (stored.contentDigest !== contentDigest) {
        // A SECOND, DIFFERENT DRAFT. Refused rather than stored beside the
        // first, because the approval a person is about to answer is answered
        // about the sealed digest — and a scope with two drafts has no such
        // thing.
        throw diagnosticFailure(
          'diagnostic_draft_sealed',
          'A different review has already been drafted for this run.',
          `scope ${scopeId} is sealed at ${stored.contentDigest}`,
        );
      }

      return {
        organizationId: stored.organizationId,
        reviewScopeId: stored.reviewScopeId,
        submissionId: stored.submissionId,
        contentDigest: stored.contentDigest,
        createdAt: stored.createdAt,
        sealed: 'yes',
        // Reported on the sealed record AND to the caller, so a model drifting
        // toward deciding its own numbers is visible in telemetry rather than
        // silently corrected forever.
        factLockRestored: stored.content.factLockRestored,
        factLockRemoved: stored.content.factLockRemoved,
        consistencyValid: stored.content.authority.consistency.valid,
        recommendationCount: stored.content.authority.recommendations.length,
        confidence: stored.content.authority.decision.confidence,
        dataCompleteness: stored.content.authority.readiness.dataCompleteness,
        authorityDigest: stored.content.authority.authorityDigest,
      };
    },
  };
}

// ── 4. Record an escalation ─────────────────────────────────────────────────

export function createRecordEscalationTool(deps: DiagnosticToolDependencies): ToolDefinition {
  return {
    toolId: DIAGNOSTIC_TOOL_IDS.recordEscalation,
    version: TOOL_VERSION,
    owner: OWNER,
    purpose: 'Record that this review needs a person, with a declared reason.',
    inputSchema: object({
      submissionId: str({ minLength: 1, maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
      reason: literal(ESCALATION_REASONS),
      detail: str(REVIEW_BOUNDS.escalationDetail),
    }),
    outputSchema: object({
      escalationId: str({ maxLength: 96 }),
      organizationId: str({ maxLength: 64 }),
      reviewScopeId: str({ maxLength: 128 }),
      submissionId: str({ maxLength: 64 }),
      reason: literal(ESCALATION_REASONS),
      createdAt: str({ maxLength: 40 }),
    }),
    risk: 'low',
    requiredCapabilities: [],
    tenantScope: 'run_organization',
    idempotency: 'idempotent',
    timeoutMs: 3_000,
    sideEffect: 'internal_write',
    requiresApproval: false,
    enabled: true,
    certification: 'uncertified',
    execute: async (invocation) => {
      const input = invocation.input as {
        submissionId: string;
        reason: EscalationReason;
        detail: string;
      };
      await requireDossier(deps, invocation, input.submissionId);
      const { scopeId } = await reviewScopeFor(deps, invocation);

      // Deterministic id, so a retried step raises ONE escalation rather than a
      // queue of identical ones somebody has to read through.
      const escalationId = `esc:${digestValue({
        scopeId,
        submissionId: input.submissionId,
        reason: input.reason,
      })}`;

      const stored = await deps.escalations.append({
        escalationId,
        organizationId: invocation.organizationId,
        reviewScopeId: scopeId,
        submissionId: input.submissionId,
        reason: input.reason,
        detail: input.detail,
        raisedByAgentRunId: invocation.runId,
        createdAt: invocation.nowIso,
      });

      return {
        escalationId: stored.escalationId,
        organizationId: stored.organizationId,
        reviewScopeId: stored.reviewScopeId,
        submissionId: stored.submissionId,
        reason: stored.reason,
        createdAt: stored.createdAt,
      };
    },
  };
}

// ── 5. Commit the review, behind a real approval ────────────────────────────

/**
 * The conditions a commit must satisfy, checked in this order.
 *
 * Ordering is deliberate. Ownership first, because everything after it is a
 * question about a run this call has not yet earned the right to ask about;
 * then the approval's identity, then its grant, then its freshness, then who
 * decided it, then what it froze — the caller's claim and then the APPROVAL'S
 * OWN subject evidence — then whether it has already been spent.
 *
 * Each one is refused with its own code, so the certification suite can prove
 * that the check it thinks it is driving is the check that fired.
 */
async function requireCommitAuthorization(
  deps: DiagnosticToolDependencies,
  invocation: ToolInvocation,
  claimedDigest: string,
): Promise<{
  approval: WorkflowApprovalRecord;
  draft: ReviewDraftRecord;
  workflowRunId: string;
}> {
  // 1. THIS AGENT RUN IS A NODE OF A WORKFLOW RUN.
  const workflow = await deps.authority.owningWorkflowRun(
    invocation.organizationId,
    invocation.runId,
  );
  if (workflow === undefined) {
    throw diagnosticFailure(
      'diagnostic_not_in_workflow',
      'A review can only be committed by the review workflow.',
      `agent run ${invocation.runId} belongs to no workflow run in ${invocation.organizationId}`,
    );
  }
  if (workflow.workflowId !== deps.commitAuthorization.workflowId) {
    throw diagnosticFailure(
      'diagnostic_not_in_workflow',
      'A review can only be committed by the review workflow.',
      `workflow ${workflow.workflowId} is not ${deps.commitAuthorization.workflowId}`,
    );
  }

  // 2. AND IT BELONGS TO THIS TENANT. Checked against the record's own context
  // rather than against the key it was fetched by.
  if (workflow.organizationId !== invocation.organizationId) {
    throw diagnosticFailure(
      'diagnostic_tenant_mismatch',
      'That run belongs to another organization.',
      'workflow run organization mismatch',
    );
  }

  const approvals = await deps.authority.approvalsForRun(
    invocation.organizationId,
    workflow.workflowRunId,
  );

  // 3. AN APPROVAL FOR THE DECLARED COMMIT BARRIER, AND NO OTHER NODE.
  const forNode = approvals.filter(
    (record) =>
      record.nodeId === deps.commitAuthorization.approvalNodeId &&
      record.workflowRunId === workflow.workflowRunId &&
      record.organizationId === invocation.organizationId &&
      record.branchId === undefined,
  );
  if (forNode.length === 0) {
    throw diagnosticFailure(
      approvals.length === 0 ? 'diagnostic_approval_missing' : 'diagnostic_approval_wrong_node',
      'This review has not been approved.',
      `run ${workflow.workflowRunId} carries no approval for node ${deps.commitAuthorization.approvalNodeId}`,
    );
  }

  // 4. GRANTED. `decision` says a person said yes; `approvalState` says the
  // engine either holds that yes or has already released the barrier with it.
  // A rejected, expired, withdrawn or still-pending request is refused, and
  // each is refused as itself so an operator is not sent looking for the wrong
  // thing.
  const granted = forNode.filter(
    (record) =>
      record.decision === 'approve' &&
      (record.approvalState === 'approved' || record.approvalState === 'consumed'),
  );
  if (granted.length === 0) {
    const rejected = forNode.find((record) => record.approvalState === 'rejected');
    if (rejected) {
      throw diagnosticFailure(
        'diagnostic_approval_rejected',
        'This review was refused.',
        `approval ${rejected.workflowApprovalId} was rejected`,
      );
    }
    const expired = forNode.find(
      (record) => record.approvalState === 'expired' || record.approvalState === 'withdrawn',
    );
    if (expired) {
      throw diagnosticFailure(
        'diagnostic_approval_expired',
        'The approval for this review is no longer valid.',
        `approval ${expired.workflowApprovalId} is ${expired.approvalState}`,
      );
    }
    throw diagnosticFailure(
      'diagnostic_approval_not_granted',
      'This review has not been approved.',
      `approval ${forNode[0].workflowApprovalId} is ${forNode[0].approvalState}`,
    );
  }
  const approval = granted[0];

  // 5. UNEXPIRED, MEASURED AT COMMIT TIME.
  //
  // Not the same check as the state above: an approval granted inside its
  // window and committed long after it closed is a decision somebody made about
  // a situation that has moved on. The clock is the invocation's — the runtime's
  // deterministic reading — so a tool cannot introduce a second one.
  const expiresAtMs = Date.parse(approval.expiresAt);
  const nowMs = Date.parse(invocation.nowIso);
  if (Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs) {
    throw diagnosticFailure(
      'diagnostic_approval_expired',
      'The approval for this review has expired.',
      `approval ${approval.workflowApprovalId} expired at ${approval.expiresAt}`,
    );
  }

  // 6. DECIDED BY AN AUTHORISED DECLARED ROLE, AND NOT BY THE REQUESTER.
  //
  // `authorizedRoles` was frozen onto the record from the approval NODE when
  // the request was made, and the gate refused any decider who held none of
  // them. Re-checking it here against the roles the DEFINITION declares catches
  // the case the gate cannot: a record whose frozen role list is not the one
  // the reviewed definition declared.
  //
  // What is deliberately NOT done is re-resolving the decider's roles live. A
  // role granted after the fact would validate a decision that was invalid when
  // it was made, and a role revoked after the fact would invalidate one that was
  // valid — both let a later membership change rewrite the past.
  const declared = new Set(
    deps.commitAuthorization.approverRoles.map((role) => role.trim().toLowerCase()),
  );
  const frozen = approval.authorizedRoles.map((role) => role.trim().toLowerCase());
  if (frozen.length === 0 || !frozen.every((role) => declared.has(role))) {
    throw diagnosticFailure(
      'diagnostic_approval_unauthorized_role',
      'That approval was not gated on the roles this review requires.',
      `approval roles [${frozen.join(',')}] are not within declared [${[...declared].join(',')}]`,
    );
  }
  if (approval.decidedBy === undefined || approval.decidedBy.trim() === '') {
    throw diagnosticFailure(
      'diagnostic_approval_not_granted',
      'This review has not been approved by anyone.',
      `approval ${approval.workflowApprovalId} carries no decider`,
    );
  }
  if (approval.decidedBy === approval.requestedBy) {
    throw diagnosticFailure(
      'diagnostic_approval_self_approved',
      'A review cannot be approved by the person who requested it.',
      `approval ${approval.workflowApprovalId} was decided by its own requester`,
    );
  }
  if (approval.decidedBy === invocation.actorId) {
    throw diagnosticFailure(
      'diagnostic_approval_self_approved',
      'A review cannot be approved by the person running it.',
      `approval ${approval.workflowApprovalId} was decided by the actor driving the commit`,
    );
  }

  // 7. IT FREEZES THE EXACT CONTENT BEING COMMITTED.
  //
  // The draft is sealed once per run and cannot be edited, and it was sealed
  // before the barrier was reached — a node cannot run after a node that has
  // not run. So the digest a person approved is the digest stored here, and the
  // commit refuses anything else. The content that gets written is the DRAFT's,
  // never the caller's, so the two cannot diverge even in principle.
  const draft = await deps.drafts.load(invocation.organizationId, workflow.workflowRunId);
  if (!draft) {
    throw diagnosticFailure(
      'diagnostic_draft_missing',
      'There is no drafted review to commit.',
      `no sealed draft for run ${workflow.workflowRunId}`,
    );
  }
  if (draft.contentDigest !== claimedDigest) {
    throw diagnosticFailure(
      'diagnostic_content_digest_mismatch',
      'That is not the review that was approved.',
      `approved digest ${draft.contentDigest} does not match ${claimedDigest}`,
    );
  }

  // 7b. AND THE APPROVAL ITSELF NAMES THIS DRAFT (Part 7D, F3).
  //
  // Check 7 proves the CALLER named the sealed draft. It does not prove the
  // APPROVER was shown it — before Part 7D nothing on the approval record said
  // what was being approved, so "the person approved these bytes" rested on
  // graph order: the draft is sealed at `n_review`, the barrier is downstream,
  // and a node cannot run before a node that has not run.
  //
  // That argument is sound and it is not evidence. The approval now carries the
  // submission and the sealed digest, resolved server-side from the review
  // node's trusted output before the request was written, and this check
  // compares BOTH against the draft that is about to be committed. Wrong
  // submission, wrong digest, a draft sealed for another run, another tenant's
  // draft: each fails one half or the other, and each is refused here.
  //
  // ABSENT EVIDENCE IS A REFUSAL, not a pass. An approval for this node with no
  // subject on it is either a definition that no longer declares one or a record
  // from before this field existed — and neither is something a person can be
  // said to have decided about specific content.
  const evidence = approval.subjectEvidence;
  if (evidence === undefined) {
    throw diagnosticFailure(
      'diagnostic_approval_evidence_mismatch',
      'That approval does not say which review it is for.',
      `approval ${approval.workflowApprovalId} carries no subject evidence`,
    );
  }
  if (evidence.contentDigest !== draft.contentDigest) {
    throw diagnosticFailure(
      'diagnostic_approval_evidence_mismatch',
      'That is not the review that was approved.',
      `approval ${approval.workflowApprovalId} approved digest ${evidence.contentDigest}, ` +
        `the sealed draft is ${draft.contentDigest}`,
    );
  }
  if (evidence.subjectId !== draft.submissionId) {
    throw diagnosticFailure(
      'diagnostic_approval_evidence_mismatch',
      'That approval is for a different submission.',
      `approval ${approval.workflowApprovalId} approved submission ${evidence.subjectId}, ` +
        `the sealed draft is for ${draft.submissionId}`,
    );
  }

  // 8. AND IT HAS NOT ALREADY BEEN SPENT ON A COMMIT.
  //
  // The engine spends the approval on RELEASING the barrier before this node
  // runs, so the approval's own `consumed` state cannot answer this. The
  // committed-review store can: it is keyed by the approval, insert-if-absent,
  // and it is checked here so a replay is refused with the reason it happened
  // rather than with a store conflict.
  const alreadyCommitted = await deps.commits.loadByApproval(
    invocation.organizationId,
    approval.workflowApprovalId,
  );
  if (alreadyCommitted) {
    throw diagnosticFailure(
      'diagnostic_approval_already_spent',
      'That approval has already been used to commit a review.',
      `approval ${approval.workflowApprovalId} was committed at ${alreadyCommitted.committedAt}`,
    );
  }
  const runCommits = await deps.commits.listByRun(
    invocation.organizationId,
    workflow.workflowRunId,
  );
  if (runCommits.length > 0) {
    throw diagnosticFailure(
      'diagnostic_commit_conflict',
      'This run has already committed a review.',
      `run ${workflow.workflowRunId} already carries ${runCommits.length} committed review(s)`,
    );
  }

  return { approval, draft, workflowRunId: workflow.workflowRunId };
}

export function createCommitReviewTool(deps: DiagnosticToolDependencies): ToolDefinition {
  return {
    toolId: DIAGNOSTIC_TOOL_IDS.commitReview,
    version: TOOL_VERSION,
    owner: OWNER,
    purpose: 'Commit the approved review. Refuses without a real workflow approval.',
    // A DIGEST, NOT CONTENT. The committed bytes come from the sealed draft, so
    // there is no input through which different content could be committed.
    inputSchema: object({
      contentDigest: str({ minLength: 8, maxLength: 64, pattern: /^[a-f0-9]+$/ }),
    }),
    outputSchema: object({
      reviewId: str({ maxLength: 96 }),
      organizationId: str({ maxLength: 64 }),
      workflowRunId: str({ maxLength: 96 }),
      workflowApprovalId: str({ maxLength: 160 }),
      submissionId: str({ maxLength: 64 }),
      contentDigest: str({ maxLength: 64 }),
      committedAt: str({ maxLength: 40 }),
      approvedBy: str({ maxLength: 96 }),
    }),
    risk: 'moderate',
    requiredCapabilities: [],
    tenantScope: 'run_organization',
    idempotency: 'non_idempotent',
    timeoutMs: 6_000,
    sideEffect: 'internal_write',
    requiresApproval: false,
    enabled: true,
    certification: 'uncertified',
    execute: async (invocation) => {
      const input = invocation.input as { contentDigest: string };
      const { approval, draft, workflowRunId } = await requireCommitAuthorization(
        deps,
        invocation,
        input.contentDigest,
      );

      const record: CommittedReviewRecord = {
        reviewId: `rev:${digestValue({
          workflowRunId,
          approvalId: approval.workflowApprovalId,
          contentDigest: draft.contentDigest,
        })}`,
        organizationId: invocation.organizationId,
        workflowRunId,
        workflowApprovalId: approval.workflowApprovalId,
        submissionId: draft.submissionId,
        contentDigest: draft.contentDigest,
        // THE SEALED DRAFT'S CONTENT. Never the caller's.
        content: draft.content,
        committedAt: invocation.nowIso,
        committedByAgentRunId: invocation.runId,
        approvedBy: approval.decidedBy as string,
        approvalDecidedAt: approval.decidedAt ?? approval.createdAt,
      };

      // The store refuses a duplicate rather than overwriting, so two isolates
      // racing to commit one approval resolve to one committed review.
      await deps.commits.create(record);

      return {
        reviewId: record.reviewId,
        organizationId: record.organizationId,
        workflowRunId: record.workflowRunId,
        workflowApprovalId: record.workflowApprovalId,
        submissionId: record.submissionId,
        contentDigest: record.contentDigest,
        committedAt: record.committedAt,
        approvedBy: record.approvedBy,
      };
    },
  };
}

// ── The set ─────────────────────────────────────────────────────────────────

export function createDiagnosticTools(
  deps: DiagnosticToolDependencies,
): readonly ToolDefinition[] {
  return [
    createReadDossierTool(deps),
    createComputeReadinessTool(deps),
    createDraftReviewTool(deps),
    createRecordEscalationTool(deps),
    createCommitReviewTool(deps),
  ];
}

/** Re-exported so a fixture can build an authority without importing the chain. */
export type { ReadinessAuthority };
