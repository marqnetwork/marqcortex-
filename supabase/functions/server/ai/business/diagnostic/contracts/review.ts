/**
 * Review records and the refusals that protect them (Part 7B, Phases 2–5).
 *
 * Three durable objects, and the difference between them is the difference
 * between an opinion, an escalation and a decision:
 *
 *   DRAFT       What the agent produced. Advisory, sealed, and the thing an
 *               approver is answering about. Written once per review scope and
 *               never edited — see `ReviewDraftRecord` for why a re-draft is a
 *               refusal rather than an update.
 *
 *   ESCALATION  The agent declining to proceed. It carries a reason code and no
 *               authority: an escalation decides nothing except that a person
 *               should look.
 *
 *   COMMITTED   The reviewed outcome. Written by exactly one tool, behind a
 *               real workflow approval, once per approval, and containing the
 *               SEALED DRAFT'S CONTENT rather than anything supplied at commit
 *               time.
 *
 * ── WHY THE COMMIT COPIES THE DRAFT ────────────────────────────────────────
 *
 * The commit tool takes a content DIGEST, not content. It refuses unless the
 * digest matches the sealed draft, and it then persists the draft's own
 * content. So there is no arrangement of inputs — hostile agent, replayed call,
 * edited payload — in which the bytes a person approved and the bytes that were
 * committed can differ. The digest check and the copy are two halves of one
 * guarantee, and neither is sufficient alone: the check without the copy would
 * still let a caller pass different content carrying a stale digest field, and
 * the copy without the check would commit whatever draft happened to be there.
 */

import type { Validator } from '../../../security/validation.ts';
import { AIError } from '../../../contracts/errors.ts';
import type { AIErrorCode } from '../../../contracts/errors.ts';
import { arrayOf, bool, literal, object, str } from '../../../security/validation.ts';
import type { ReadinessAuthority } from './readiness.ts';
import { readinessAuthoritySchema } from './readiness.ts';

// ── Failures ────────────────────────────────────────────────────────────────

/**
 * What a diagnostic tool refuses for.
 *
 * A closed vocabulary rather than free text, because these are the codes a
 * certification suite asserts on and an operator reads. Every one of them is a
 * REFUSAL: there is no code here that means "proceeded with a warning".
 */
export type DiagnosticFailureCode =
  | 'diagnostic_submission_not_found'
  | 'diagnostic_tenant_mismatch'
  | 'diagnostic_draft_missing'
  | 'diagnostic_draft_sealed'
  | 'diagnostic_authority_mismatch'
  | 'diagnostic_content_digest_mismatch'
  /** The assembled record did not satisfy its own schema. Nothing was sealed. */
  | 'diagnostic_record_invalid'
  /** The approval does not carry the evidence that names this sealed draft. */
  | 'diagnostic_approval_evidence_mismatch'
  | 'diagnostic_not_in_workflow'
  | 'diagnostic_approval_missing'
  | 'diagnostic_approval_not_granted'
  | 'diagnostic_approval_expired'
  | 'diagnostic_approval_rejected'
  | 'diagnostic_approval_wrong_node'
  | 'diagnostic_approval_unauthorized_role'
  | 'diagnostic_approval_self_approved'
  | 'diagnostic_approval_already_spent'
  | 'diagnostic_commit_conflict'
  | 'diagnostic_consistency_failed';

/**
 * Failure code → the transport code that already exists for it.
 *
 * The same call `agents/contracts/failures.ts` makes and for the same reason:
 * `AIError` already owns the status mapping every HTTP surface, log line and
 * audit record is built against, so a second mapping would be a second thing to
 * keep in step. Note that every approval refusal is `FORBIDDEN` rather than
 * `NOT_FOUND` — a caller who reached a commit without an approval is being told
 * they may not, not that nothing is there.
 */
const TRANSPORT_CODE: Readonly<Record<DiagnosticFailureCode, AIErrorCode>> = {
  diagnostic_submission_not_found: 'VALIDATION_FAILED',
  diagnostic_tenant_mismatch: 'TENANT_ISOLATION_VIOLATION',
  diagnostic_draft_missing: 'VALIDATION_FAILED',
  diagnostic_draft_sealed: 'CONFLICT',
  diagnostic_authority_mismatch: 'VALIDATION_FAILED',
  diagnostic_content_digest_mismatch: 'VALIDATION_FAILED',
  diagnostic_record_invalid: 'VALIDATION_FAILED',
  diagnostic_approval_evidence_mismatch: 'FORBIDDEN',
  diagnostic_not_in_workflow: 'FORBIDDEN',
  diagnostic_approval_missing: 'FORBIDDEN',
  diagnostic_approval_not_granted: 'FORBIDDEN',
  diagnostic_approval_expired: 'FORBIDDEN',
  diagnostic_approval_rejected: 'FORBIDDEN',
  diagnostic_approval_wrong_node: 'FORBIDDEN',
  diagnostic_approval_unauthorized_role: 'FORBIDDEN',
  diagnostic_approval_self_approved: 'FORBIDDEN',
  diagnostic_approval_already_spent: 'CONFLICT',
  diagnostic_commit_conflict: 'CONFLICT',
  diagnostic_consistency_failed: 'VALIDATION_FAILED',
};

export class DiagnosticToolError extends AIError {
  readonly failure: DiagnosticFailureCode;

  constructor(failure: DiagnosticFailureCode, message: string, diagnostics?: string) {
    super(TRANSPORT_CODE[failure], message, {
      ...(diagnostics === undefined ? {} : { diagnostics }),
    });
    this.failure = failure;
    this.name = `DiagnosticToolError(${failure})`;
  }
}

export function diagnosticFailure(
  failure: DiagnosticFailureCode,
  message: string,
  diagnostics?: string,
): DiagnosticToolError {
  return new DiagnosticToolError(failure, message, diagnostics);
}

/** Reads a failure code off anything, without assuming what was thrown. */
export function diagnosticFailureOf(error: unknown): DiagnosticFailureCode | undefined {
  return error instanceof DiagnosticToolError ? error.failure : undefined;
}

// ── The advisory half ───────────────────────────────────────────────────────

/**
 * The narrative. ADVISORY, and labelled as such on the record itself.
 *
 * Everything here is model-authored prose. None of it decides anything: the
 * scores, the ranking, the qualification and the dependencies are all on the
 * authority beside it, and the fact lock puts them back after generation
 * whatever the narrative says about them.
 */
export interface ReviewNarrative {
  readonly executiveSummary: string;
  readonly evidenceAssessment: string;
  readonly recommendationCommentary: readonly {
    readonly recommendationId: string;
    readonly commentary: string;
  }[];
}

export const ADVISORY_NOTICE =
  'This narrative is advisory. Scores, ranking, qualification and dependencies are ' +
  'produced by the deterministic readiness engines and are not decided by this text.';

export const ESCALATION_REASONS = [
  'insufficient_evidence',
  'contradictory_evidence',
  'consistency_failed',
  'low_confidence',
  'empty_portfolio',
] as const;

export type EscalationReason = (typeof ESCALATION_REASONS)[number];

// ── The content a review carries ────────────────────────────────────────────

export interface ReviewRecordContent {
  readonly submissionId: string;
  /** The authority this review is about, verbatim. Never edited. */
  readonly authority: ReadinessAuthority;
  readonly narrative: ReviewNarrative;
  /** Always `ADVISORY_NOTICE`. Present so a reader of the record sees it. */
  readonly advisoryNotice: string;
  /** Authoritative paths the fact lock had to put back. */
  readonly factLockRestored: readonly string[];
  /** Authoritative paths the model invented and the fact lock removed. */
  readonly factLockRemoved: readonly string[];
  readonly evidenceSufficient: boolean;
  /** Contradictions the agent detected. Advisory observations, bounded. */
  readonly contradictions: readonly string[];
}

export interface ReviewDraftRecord {
  readonly organizationId: string;
  /**
   * What this draft belongs to.
   *
   * The workflow run id when the agent run is a workflow node — which is the
   * only case a commit is possible in — and `agentrun:<id>` otherwise. A direct
   * agent run may therefore draft, and what it drafts is simply not something
   * any commit can ever reach.
   */
  readonly reviewScopeId: string;
  readonly submissionId: string;
  /** Digest of `content`. The value an approval is effectively frozen against. */
  readonly contentDigest: string;
  readonly content: ReviewRecordContent;
  readonly draftedByAgentRunId: string;
  readonly createdAt: string;
  /** Always true. A draft is written once and never edited. */
  readonly sealed: true;
}

export interface ReviewEscalationRecord {
  readonly escalationId: string;
  readonly organizationId: string;
  readonly reviewScopeId: string;
  readonly submissionId: string;
  readonly reason: EscalationReason;
  readonly detail: string;
  readonly raisedByAgentRunId: string;
  readonly createdAt: string;
}

export interface CommittedReviewRecord {
  readonly reviewId: string;
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly workflowApprovalId: string;
  readonly submissionId: string;
  readonly contentDigest: string;
  /** The SEALED DRAFT's content. Never anything supplied at commit time. */
  readonly content: ReviewRecordContent;
  readonly committedAt: string;
  readonly committedByAgentRunId: string;
  /** Who approved it, and when they did. Copied from the approval record. */
  readonly approvedBy: string;
  readonly approvalDecidedAt: string;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

export const REVIEW_BOUNDS = {
  executiveSummary: { minLength: 1, maxLength: 2_000 },
  evidenceAssessment: { minLength: 1, maxLength: 2_000 },
  commentary: { minLength: 1, maxLength: 1_000 },
  commentaryEntries: 7,
  contradictions: { max: 12, text: 400 },
  factLockPaths: { max: 64, text: 120 },
  escalationDetail: { minLength: 3, maxLength: 500 },
} as const;

/**
 * How the fact lock's REPORT is held inside the bounds the record declares
 * (Part 7D, F1).
 *
 * ── THE DEFECT THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * `factLockRestored` and `factLockRemoved` are the one part of a review record
 * whose LENGTH a model can drive. Every invented recommendation entry the lock
 * removes reports four paths — one per authoritative recommendation field — so
 * seventeen invented entries produce sixty-eight paths against a ceiling of
 * sixty-four. A model that wanted its output not to be scrutinised could
 * therefore make the record that reports on it unrepresentable, and a record
 * that cannot be validated is a run that fails after the draft is sealed.
 *
 * ── WHY BOUNDING THE REPORT IS NOT WEAKENING THE LOCK ──────────────────────
 *
 * The lock's CORRECTION is unchanged and unconditional: every authoritative
 * value is still rebuilt from the authority and every invented recommendation
 * is still removed whole, however many there are. What is bounded is the list
 * of PATH NAMES describing what was done — and the count of what did not fit is
 * carried in a final `+N more …` entry, so the record still states that more
 * happened and how much more. Evidence is summarised, never dropped silently.
 *
 * Raising the ceiling instead would move the same defect to a larger number.
 */
export const FACT_LOCK_REPORT = {
  /**
   * Paths reported verbatim before the overflow entry.
   *
   * One below the schema's ceiling, so the overflow entry always fits and a
   * fully-summarised list is exactly at the bound rather than one past it.
   */
  maxPaths: REVIEW_BOUNDS.factLockPaths.max - 1,
  maxPathLength: REVIEW_BOUNDS.factLockPaths.text,
  /**
   * Characters of a recommendation id that reach a path.
   *
   * The id is the only unbounded segment — it comes from model output — and
   * truncating it where the path is BUILT keeps every reported path inside the
   * text bound without a second, lossy pass over an assembled string.
   */
  maxIdLength: 64,
} as const;

/**
 * Hold a list of reported paths inside the record's declared bounds.
 *
 * Deterministic in both halves: the same input always produces the same output,
 * the kept entries are the first ones in the order the lock produced them, and
 * the overflow entry states the exact count that did not fit. No sorting, no
 * sampling and no clock.
 */
export function boundFactLockPaths(paths: readonly string[]): readonly string[] {
  const trimmed = paths.map((path) =>
    path.length > FACT_LOCK_REPORT.maxPathLength
      ? path.slice(0, FACT_LOCK_REPORT.maxPathLength)
      : path,
  );
  if (trimmed.length <= REVIEW_BOUNDS.factLockPaths.max) return trimmed;
  const kept = trimmed.slice(0, FACT_LOCK_REPORT.maxPaths);
  return [...kept, `+${trimmed.length - FACT_LOCK_REPORT.maxPaths} more fact-lock paths`];
}

export const reviewNarrativeSchema = object({
  executiveSummary: str(REVIEW_BOUNDS.executiveSummary),
  evidenceAssessment: str(REVIEW_BOUNDS.evidenceAssessment),
  recommendationCommentary: arrayOf(
    object({
      recommendationId: str({ maxLength: 80 }),
      commentary: str(REVIEW_BOUNDS.commentary),
    }),
    { maxItems: REVIEW_BOUNDS.commentaryEntries },
  ),
});

export const reviewContentSchema: Validator<ReviewRecordContent> = object({
  submissionId: str({ maxLength: 64 }),
  authority: readinessAuthoritySchema,
  narrative: reviewNarrativeSchema,
  advisoryNotice: literal([ADVISORY_NOTICE] as const),
  factLockRestored: arrayOf(str({ maxLength: REVIEW_BOUNDS.factLockPaths.text }), {
    maxItems: REVIEW_BOUNDS.factLockPaths.max,
  }),
  factLockRemoved: arrayOf(str({ maxLength: REVIEW_BOUNDS.factLockPaths.text }), {
    maxItems: REVIEW_BOUNDS.factLockPaths.max,
  }),
  evidenceSufficient: bool(),
  contradictions: arrayOf(str({ maxLength: REVIEW_BOUNDS.contradictions.text }), {
    maxItems: REVIEW_BOUNDS.contradictions.max,
  }),
}) as unknown as Validator<ReviewRecordContent>;
