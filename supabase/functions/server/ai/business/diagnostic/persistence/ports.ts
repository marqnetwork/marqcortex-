/**
 * Persistence ports for the diagnostic review capability (Part 7B, Phase 2).
 *
 * Four ports, and each one's CONTRACT is where a guarantee lives rather than a
 * convention about how it is called:
 *
 *   Dossiers      READ ONLY. There is no writer on this interface, so no tool
 *                 in this capability can alter a submission, an answer or a
 *                 status — which is Part 7A's prohibition made structural.
 *
 *   Drafts        SEAL-ONCE. `seal` is insert-if-absent and returns what is
 *                 stored. A second seal of the same content is the same record;
 *                 a second seal of DIFFERENT content is a refusal. That is what
 *                 pins the digest an approval is answering about.
 *
 *   Escalations   APPEND-ONLY, keyed by a deterministic id, so a retried agent
 *                 step raises one escalation rather than a queue of identical
 *                 ones.
 *
 *   Commits       WRITE-ONCE PER APPROVAL. `commit` is insert-if-absent keyed by
 *                 the approval that authorised it, and it is the single-use
 *                 guarantee for the commit itself — the workflow engine has
 *                 already spent the approval on releasing the barrier by the
 *                 time a commit runs, so "has this approval been committed"
 *                 cannot be answered by the approval's own state and needs a
 *                 record of its own.
 *
 * Every method takes `organizationId` first and keys by it. There is no listing
 * across tenants at this layer and no method that could be called without one.
 *
 * ── INTERFACES ONLY (Part 7D, F2) ──────────────────────────────────────────
 *
 * This file used to carry in-memory implementations of all four ports beside
 * the interfaces, and `createDiagnosticCapability` defaulted to them. That made
 * an EVICTING, isolate-local store the fallback for the committed review — the
 * business record of record, and the same row the commit tool reads to refuse a
 * replay. An eviction there does not merely lose a record; it reopens the
 * replay window on an approval that was already spent.
 *
 * The three record-of-record stores are now durable and live in
 * `kvDiagnosticStores.ts`; the read-only dossier fixture store lives in
 * `memoryStores.ts`, which is test and tooling only and which no module in the
 * production assembly imports. The boundary scan asserts that separation rather
 * than trusting it.
 */

import type { DiagnosticSubmissionDossier } from '../contracts/dossier.ts';
import type {
  CommittedReviewRecord,
  ReviewDraftRecord,
  ReviewEscalationRecord,
} from '../contracts/review.ts';

export interface DiagnosticDossierStore {
  /** The submission, or undefined. Never another tenant's. */
  load(
    organizationId: string,
    submissionId: string,
  ): Promise<DiagnosticSubmissionDossier | undefined>;
}

export interface ReviewDraftStore {
  load(organizationId: string, reviewScopeId: string): Promise<ReviewDraftRecord | undefined>;
  /**
   * Seal a draft if none exists, and return what is stored either way.
   *
   * Never overwrites. The caller compares the returned record's digest against
   * the one it tried to seal, and a difference is `diagnostic_draft_sealed`.
   */
  seal(record: ReviewDraftRecord): Promise<ReviewDraftRecord>;
}

export interface ReviewEscalationStore {
  load(
    organizationId: string,
    escalationId: string,
  ): Promise<ReviewEscalationRecord | undefined>;
  append(record: ReviewEscalationRecord): Promise<ReviewEscalationRecord>;
  list(
    organizationId: string,
    reviewScopeId: string,
  ): Promise<readonly ReviewEscalationRecord[]>;
}

export interface CommittedReviewStore {
  /** The commit made against one approval, or undefined. */
  loadByApproval(
    organizationId: string,
    workflowApprovalId: string,
  ): Promise<CommittedReviewRecord | undefined>;
  /** Every commit for one workflow run. Used to refuse a second review. */
  listByRun(
    organizationId: string,
    workflowRunId: string,
  ): Promise<readonly CommittedReviewRecord[]>;
  /**
   * Write a commit that does not exist.
   *
   * Refuses with `diagnostic_commit_conflict` when the approval already carries
   * one. The refusal — rather than an overwrite or a silent no-op — is what
   * makes a replayed commit visible instead of invisible.
   */
  create(record: CommittedReviewRecord): Promise<void>;
}
