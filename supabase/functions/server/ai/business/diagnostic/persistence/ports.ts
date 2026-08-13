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
 */

import type { DiagnosticSubmissionDossier } from '../contracts/dossier.ts';
import type {
  CommittedReviewRecord,
  ReviewDraftRecord,
  ReviewEscalationRecord,
} from '../contracts/review.ts';
import { diagnosticFailure } from '../contracts/review.ts';

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

// ── In-memory implementations ───────────────────────────────────────────────

/**
 * Bounded in-memory stores.
 *
 * Correct for one isolate and for tests, and NOT the authority in a deployment
 * that has a durable store — the same call every other store in this batch
 * makes. Eviction is oldest-first and safe for exactly that reason.
 */
export function createMemoryDossierStore(
  seed: readonly DiagnosticSubmissionDossier[] = [],
): DiagnosticDossierStore & { put(record: DiagnosticSubmissionDossier): void; size(): number } {
  const rows = new Map<string, DiagnosticSubmissionDossier>();
  const keyOf = (organizationId: string, submissionId: string) =>
    `${organizationId}:${submissionId}`;
  for (const record of seed) rows.set(keyOf(record.organizationId, record.submissionId), record);

  return {
    load: (organizationId, submissionId) =>
      Promise.resolve(rows.get(keyOf(organizationId, submissionId))),
    put: (record) => {
      rows.set(keyOf(record.organizationId, record.submissionId), record);
    },
    size: () => rows.size,
  };
}

export function createMemoryReviewDraftStore(
  options: { maxDrafts?: number } = {},
): ReviewDraftStore & { size(): number } {
  const maxDrafts = options.maxDrafts ?? 500;
  const rows = new Map<string, ReviewDraftRecord>();
  const keyOf = (organizationId: string, reviewScopeId: string) =>
    `${organizationId}:${reviewScopeId}`;

  return {
    load: (organizationId, reviewScopeId) =>
      Promise.resolve(rows.get(keyOf(organizationId, reviewScopeId))),

    seal(record) {
      const key = keyOf(record.organizationId, record.reviewScopeId);
      const existing = rows.get(key);
      if (existing) return Promise.resolve(existing);
      if (rows.size >= maxDrafts) {
        const oldest = rows.keys().next().value;
        if (oldest !== undefined) rows.delete(oldest);
      }
      rows.set(key, record);
      return Promise.resolve(record);
    },

    size: () => rows.size,
  };
}

export function createMemoryEscalationStore(
  options: { maxRecords?: number } = {},
): ReviewEscalationStore & { size(): number } {
  const maxRecords = options.maxRecords ?? 500;
  const rows = new Map<string, ReviewEscalationRecord>();
  const keyOf = (organizationId: string, escalationId: string) =>
    `${organizationId}:${escalationId}`;

  return {
    load: (organizationId, escalationId) =>
      Promise.resolve(rows.get(keyOf(organizationId, escalationId))),

    append(record) {
      const key = keyOf(record.organizationId, record.escalationId);
      const existing = rows.get(key);
      if (existing) return Promise.resolve(existing);
      if (rows.size >= maxRecords) {
        const oldest = rows.keys().next().value;
        if (oldest !== undefined) rows.delete(oldest);
      }
      rows.set(key, record);
      return Promise.resolve(record);
    },

    list: (organizationId, reviewScopeId) =>
      Promise.resolve(
        [...rows.values()]
          .filter(
            (record) =>
              record.organizationId === organizationId &&
              record.reviewScopeId === reviewScopeId,
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      ),

    size: () => rows.size,
  };
}

export function createMemoryCommittedReviewStore(
  options: { maxRecords?: number } = {},
): CommittedReviewStore & { size(): number } {
  const maxRecords = options.maxRecords ?? 500;
  const rows = new Map<string, CommittedReviewRecord>();
  const keyOf = (organizationId: string, workflowApprovalId: string) =>
    `${organizationId}:${workflowApprovalId}`;

  return {
    loadByApproval: (organizationId, workflowApprovalId) =>
      Promise.resolve(rows.get(keyOf(organizationId, workflowApprovalId))),

    listByRun: (organizationId, workflowRunId) =>
      Promise.resolve(
        [...rows.values()].filter(
          (record) =>
            record.organizationId === organizationId && record.workflowRunId === workflowRunId,
        ),
      ),

    create(record) {
      const key = keyOf(record.organizationId, record.workflowApprovalId);
      if (rows.has(key)) {
        return Promise.reject(
          diagnosticFailure(
            'diagnostic_commit_conflict',
            'That review has already been committed.',
            `approval ${record.workflowApprovalId} already carries a committed review`,
          ),
        );
      }
      if (rows.size >= maxRecords) {
        const oldest = rows.keys().next().value;
        if (oldest !== undefined) rows.delete(oldest);
      }
      rows.set(key, record);
      return Promise.resolve();
    },

    size: () => rows.size,
  };
}
