/**
 * Durable diagnostic review storage, over the platform key-value store
 * (AI-01 Batch 3B, Part 7D — F2).
 *
 * ── THE DEFECT THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * The committed review is the BUSINESS RECORD OF RECORD for a decision a person
 * made, and it is also the thing the commit tool reads to answer "has this
 * approval already been spent on a commit". Those two roles are the same row,
 * deliberately — a second ledger would be a second answer — which means an
 * eviction does not merely lose a record: it REOPENS THE REPLAY WINDOW on an
 * approval that was already used. An isolate-local store with an eviction
 * policy is therefore not an acceptable default for a production-capable
 * assembly, and after Part 7D it is not an available one either.
 *
 * ── NO NEW DATABASE TECHNOLOGY, AND NO NEW MIGRATION ───────────────────────
 *
 * This module is the same `kv_compare_and_swap_field` contract (migration
 * 20260804120000) that the agent stores, the workflow stores and the financial
 * ledger already use — reached through the same injected port shape, with the
 * same tenant-scoped key builder. Nothing here is a new storage system, a new
 * table or a new SQL function; a second implementation of one guarantee is how
 * two implementations of it begin.
 *
 *   org:{org}:ai:diagnostic_draft:{reviewScopeId}
 *   org:{org}:ai:diagnostic_escalation:{escalationId}
 *   org:{org}:ai:diagnostic_review:{workflowApprovalId}
 *
 * KEYS ARE TENANT-SCOPED BY CONSTRUCTION. `tenantScopedKey` cannot build a key
 * without its organization prefix, so a prefix scan for one organization is
 * literally unable to return another's rows — and every parsed record is
 * checked against the organization it was read for anyway, because "the key was
 * right" and "this record belongs to this tenant" are different claims.
 *
 * ── EVERY WRITE IN THIS FILE IS INSERT-IF-ABSENT ───────────────────────────
 *
 * All three stores call the CAS with expected version 0, which the SQL function
 * implements as insert-if-absent, and NO call in this module passes a non-zero
 * expected version. That single fact is the write-once guarantee: there is no
 * code path here that can overwrite a sealed draft, an escalation or a
 * committed review, because there is no call that could.
 *
 * The consequences are the three properties Part 7B claimed and Part 7D makes
 * durable:
 *
 *   DRAFT       Seal-once per review scope. A second seal of the same content
 *               returns the stored record; a second seal of DIFFERENT content
 *               also returns the stored record, and the caller — which compares
 *               digests — turns that into `diagnostic_draft_sealed`.
 *
 *   ESCALATION  Append-once under a deterministic id.
 *
 *   COMMIT      Exactly one per approval. Two isolates racing to commit one
 *               approval both attempt the insert; the storage layer lets one
 *               win, and the loser is refused with `diagnostic_commit_conflict`
 *               rather than silently overwriting the decision that won.
 *
 * `recordVersion` exists on the stored envelope only so the CAS has a field to
 * name. It is written as 1 and never moves — these records have no lifecycle to
 * concurrency-control, which is exactly why insert-if-absent is the whole of
 * their storage contract.
 *
 * ── A ROW THAT CANNOT BE READ IS NOT A ROW THAT IS ABSENT ──────────────────
 *
 * `parse` reports corruption through `onCorrupt` and returns undefined, so one
 * unreadable row cannot make an unrelated review unreadable. Where "absent"
 * would be a SAFETY answer rather than a data answer — the replay check on a
 * commit — the caller's ordering makes that safe: an unreadable committed
 * review still occupies its key, so the insert that follows loses the CAS and
 * the commit is refused.
 */

import type {
  CommittedReviewRecord,
  ReviewDraftRecord,
  ReviewEscalationRecord,
} from '../contracts/review.ts';
import { diagnosticFailure } from '../contracts/review.ts';
import type {
  CommittedReviewStore,
  ReviewDraftStore,
  ReviewEscalationStore,
} from './ports.ts';
import { isolationKeyFor, tenantScopedKey } from '../../../security/tenancy.ts';

/** The same three port shapes the workflow and financial stores are built on. */
export type KvDiagnosticReader = (key: string) => Promise<unknown>;
export type KvDiagnosticPrefixReader = (prefix: string) => Promise<readonly unknown[]>;

/**
 * Atomic compare-and-swap keyed by a named version field.
 *
 * Contract: write `value` at `key` if and only if the stored record's
 * `versionField` equals `expectedVersion` — or, when `expectedVersion` is 0, if
 * and only if no record exists. The comparison and the write MUST be one
 * storage operation. Every call in this module passes 0.
 */
export type KvDiagnosticConditionalWriter = (
  key: string,
  versionField: string,
  expectedVersion: number,
  value: unknown,
) => Promise<boolean>;

export interface KvDiagnosticStoreOptions {
  readonly read: KvDiagnosticReader;
  readonly readByPrefix: KvDiagnosticPrefixReader;
  readonly compareAndSwap: KvDiagnosticConditionalWriter;
  /** Called when a stored record cannot be read. Loud, never silent. */
  readonly onCorrupt?: (key: string, detail: string) => void;
}

const NAMESPACE = {
  draft: 'diagnostic_draft',
  escalation: 'diagnostic_escalation',
  review: 'diagnostic_review',
} as const;

const SCHEMA = {
  draft: 'ai.diagnostic.review_draft.v1',
  escalation: 'ai.diagnostic.review_escalation.v1',
  review: 'ai.diagnostic.committed_review.v1',
} as const;

/** The field the CAS names. Written as 1, never moved. See the header. */
const VERSION_FIELD = 'recordVersion';
const RECORD_VERSION = 1;

function scope(organizationId: string): { readonly isolationKey: string } {
  return { isolationKey: isolationKeyFor(organizationId) };
}

export function diagnosticDraftKeyFor(
  organizationId: string,
  reviewScopeId: string,
): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.draft, reviewScopeId);
}

export function diagnosticEscalationKeyFor(
  organizationId: string,
  escalationId: string,
): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.escalation, escalationId);
}

export function diagnosticEscalationPrefixFor(organizationId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.escalation, 'x').slice(0, -1);
}

export function committedReviewKeyFor(
  organizationId: string,
  workflowApprovalId: string,
): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.review, workflowApprovalId);
}

export function committedReviewPrefixFor(organizationId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.review, 'x').slice(0, -1);
}

/**
 * A stored value may come back as an object or as a JSON string, depending on
 * how the key-value layer wrote it. Both are handled here so every consumer
 * sees one shape — the same coercion `kvWorkflowStores.ts` performs, and for
 * the same reason.
 */
function coerce(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return undefined;
}

function envelope(record: object, schema: string): Record<string, unknown> {
  return { ...record, [VERSION_FIELD]: RECORD_VERSION, _schema: schema };
}

// ── Drafts ──────────────────────────────────────────────────────────────────

export function createKvReviewDraftStore(options: KvDiagnosticStoreOptions): ReviewDraftStore {
  function parse(raw: unknown, key: string): ReviewDraftRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored review draft is not a readable object');
      return undefined;
    }
    // Structural sanity only. A draft that does not carry its identity, its
    // digest and its content is not one an approval could be answered about.
    if (
      typeof record.organizationId !== 'string' ||
      typeof record.reviewScopeId !== 'string' ||
      typeof record.submissionId !== 'string' ||
      typeof record.contentDigest !== 'string' ||
      typeof record.content !== 'object' ||
      record.content === null
    ) {
      options.onCorrupt?.(key, 'stored review draft is missing its identity or its content');
      return undefined;
    }
    return record as unknown as ReviewDraftRecord;
  }

  async function read(
    organizationId: string,
    reviewScopeId: string,
  ): Promise<ReviewDraftRecord | undefined> {
    const key = diagnosticDraftKeyFor(organizationId, reviewScopeId);
    const record = parse(await options.read(key), key);
    if (record && record.organizationId !== organizationId) {
      options.onCorrupt?.(key, 'stored review draft does not match the key it was read from');
      return undefined;
    }
    return record;
  }

  return {
    load: (organizationId, reviewScopeId) => read(organizationId, reviewScopeId),

    async seal(record) {
      const key = diagnosticDraftKeyFor(record.organizationId, record.reviewScopeId);
      const won = await options.compareAndSwap(
        key,
        VERSION_FIELD,
        0,
        envelope(record, SCHEMA.draft),
      );
      if (won) return record;

      // LOST THE INSERT. Something is already sealed in this scope. Return what
      // is stored — never an overwrite — and let the caller compare digests: a
      // matching one is the same draft sealed twice, and a different one is
      // `diagnostic_draft_sealed`.
      const existing = await read(record.organizationId, record.reviewScopeId);
      if (existing) return existing;
      // The insert lost and nothing readable is there. Failing closed is the
      // only safe answer: returning the candidate would report a draft as
      // sealed that this call did not seal.
      throw diagnosticFailure(
        'diagnostic_draft_sealed',
        'A review is already being drafted for this run.',
        `draft scope ${record.reviewScopeId} is occupied by a record that could not be read`,
      );
    },
  };
}

// ── Escalations ─────────────────────────────────────────────────────────────

export function createKvEscalationStore(
  options: KvDiagnosticStoreOptions,
): ReviewEscalationStore {
  function parse(raw: unknown, key: string): ReviewEscalationRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored escalation is not a readable object');
      return undefined;
    }
    if (
      typeof record.escalationId !== 'string' ||
      typeof record.organizationId !== 'string' ||
      typeof record.reviewScopeId !== 'string' ||
      typeof record.reason !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored escalation is missing its identity or its reason');
      return undefined;
    }
    return record as unknown as ReviewEscalationRecord;
  }

  async function read(
    organizationId: string,
    escalationId: string,
  ): Promise<ReviewEscalationRecord | undefined> {
    const key = diagnosticEscalationKeyFor(organizationId, escalationId);
    const record = parse(await options.read(key), key);
    if (record && record.organizationId !== organizationId) {
      options.onCorrupt?.(key, 'stored escalation does not match the key it was read from');
      return undefined;
    }
    return record;
  }

  return {
    load: (organizationId, escalationId) => read(organizationId, escalationId),

    async append(record) {
      const key = diagnosticEscalationKeyFor(record.organizationId, record.escalationId);
      const won = await options.compareAndSwap(
        key,
        VERSION_FIELD,
        0,
        envelope(record, SCHEMA.escalation),
      );
      if (won) return record;
      // The id is deterministic, so an existing row is this same escalation
      // raised again by a retried step. Adopt it rather than raising a second.
      const existing = await read(record.organizationId, record.escalationId);
      return existing ?? record;
    },

    async list(organizationId, reviewScopeId) {
      const prefix = diagnosticEscalationPrefixFor(organizationId);
      const rows = await options.readByPrefix(prefix);
      const records: ReviewEscalationRecord[] = [];
      for (const row of rows) {
        const record = parse(row, prefix);
        if (
          record &&
          record.organizationId === organizationId &&
          record.reviewScopeId === reviewScopeId
        ) {
          records.push(record);
        }
      }
      return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  };
}

// ── Committed reviews ───────────────────────────────────────────────────────

export function createKvCommittedReviewStore(
  options: KvDiagnosticStoreOptions,
): CommittedReviewStore {
  function parse(raw: unknown, key: string): CommittedReviewRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored committed review is not a readable object');
      return undefined;
    }
    if (
      typeof record.reviewId !== 'string' ||
      typeof record.organizationId !== 'string' ||
      typeof record.workflowRunId !== 'string' ||
      typeof record.workflowApprovalId !== 'string' ||
      typeof record.contentDigest !== 'string' ||
      typeof record.content !== 'object' ||
      record.content === null
    ) {
      options.onCorrupt?.(key, 'stored committed review is missing its identity or its content');
      return undefined;
    }
    return record as unknown as CommittedReviewRecord;
  }

  return {
    async loadByApproval(organizationId, workflowApprovalId) {
      const key = committedReviewKeyFor(organizationId, workflowApprovalId);
      const record = parse(await options.read(key), key);
      if (record && record.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored committed review does not match the key it was read from');
        return undefined;
      }
      return record;
    },

    async listByRun(organizationId, workflowRunId) {
      // Keyed by APPROVAL and scanned by tenant prefix, the same shape the
      // workflow approval store uses: the access pattern the key is built for
      // is "the commit made against this approval", and "this run's commits" is
      // still answerable because the run id is on the record.
      const prefix = committedReviewPrefixFor(organizationId);
      const rows = await options.readByPrefix(prefix);
      const records: CommittedReviewRecord[] = [];
      for (const row of rows) {
        const record = parse(row, prefix);
        if (
          record &&
          record.organizationId === organizationId &&
          record.workflowRunId === workflowRunId
        ) {
          records.push(record);
        }
      }
      return records.sort((a, b) => a.committedAt.localeCompare(b.committedAt));
    },

    async create(record) {
      const key = committedReviewKeyFor(record.organizationId, record.workflowApprovalId);
      const won = await options.compareAndSwap(
        key,
        VERSION_FIELD,
        0,
        envelope(record, SCHEMA.review),
      );
      if (!won) {
        // THE EXACTLY-ONCE GUARANTEE, and it is this line. Two isolates racing
        // to commit one approval both attempt the insert; one wins, and the
        // other is REFUSED rather than allowed to overwrite the decision that
        // won. A replayed commit is visible instead of invisible.
        throw diagnosticFailure(
          'diagnostic_commit_conflict',
          'That review has already been committed.',
          `approval ${record.workflowApprovalId} already carries a committed review`,
        );
      }
    },
  };
}

// ── The set ─────────────────────────────────────────────────────────────────

export interface DurableDiagnosticStores {
  readonly drafts: ReviewDraftStore;
  readonly escalations: ReviewEscalationStore;
  readonly commits: CommittedReviewStore;
}

/**
 * The three record-of-record stores, durable, over one injected key-value port.
 *
 * Built together because they are assembled together: a capability whose
 * commits survived a restart but whose sealed drafts did not would still lose
 * the content an approval was answered about.
 */
export function createKvDiagnosticStores(
  options: KvDiagnosticStoreOptions,
): DurableDiagnosticStores {
  return {
    drafts: createKvReviewDraftStore(options),
    escalations: createKvEscalationStore(options),
    commits: createKvCommittedReviewStore(options),
  };
}
