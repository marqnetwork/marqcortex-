/**
 * The submission domain, projected for comparison — MCV2-S7.7.
 *
 * The same discipline as the outcome projection, applied to the platform's core
 * entity. Two pure functions and one declared field set; the comparator does the
 * rest.
 *
 * ── WHAT IS COMPARED, AND WHY THE LIST IS SHORT ────────────────────────────
 *
 * The KV submission is a wide denormalised object: identity, contact, industry,
 * three scores, a status, a priority, the full answer map and presentation
 * fields the frontend happens to want (`submittedDate`, `isRead`). The
 * relational row models the durable facts as columns and leaves the rest to
 * `metadata`.
 *
 * The projection compares the facts BOTH STORES ARE AUTHORITATIVE ABOUT and
 * deliberately leaves out three groups:
 *
 *   PRESENTATION. `submittedDate` is `submittedAt` formatted for a browser, and
 *   `isRead` is a console flag. Neither is a fact about the business; comparing
 *   a formatted date against a timestamptz would report drift on every record.
 *
 *   THE ANSWER MAP. `answers` migrates to `diagnostic_answers` as ROWS, not to
 *   a column. Comparing a JSON object against a table is a different kind of
 *   check — a count and a per-key comparison — and belongs in its own domain
 *   rather than being smuggled into a field rule. A shadow read that reported
 *   "answers=value_mismatch" would tell an operator nothing they could act on.
 *
 *   PLACEHOLDERS. `employees` and `revenue` are written as the literal string
 *   'Not specified' by the capture route and have no relational column at all.
 *
 * ── STATUS IS THE ONE FIELD WHERE THE TWO STORES SPEAK DIFFERENTLY ─────────
 *
 * KV writes the console's vocabulary (`under-review`, `report-ready`) and the
 * relational check constraint requires underscores (`under_review`,
 * `report_ready`). They are the same fact in two spellings, so the projection
 * canonicalises both sides to the relational vocabulary — which is the one the
 * schema will still be using after the cutover. Canonicalising to KV's spelling
 * would encode a form the target model has already rejected.
 */

import type { FieldSpec } from './contracts.ts';
import type { Projection } from './compare.ts';

/** The KV prefix this domain lives under. */
export const SUBMISSION_KV_PREFIX = 'sub:';

/** The KV key for one submission. */
export function submissionKvKey(submissionId: string): string {
  return `${SUBMISSION_KV_PREFIX}${submissionId}`;
}

/**
 * The fields compared for this domain.
 *
 * Scores are `numeric` rather than `exact` because the relational columns are
 * INTEGER and a KV record may carry the same number as a string — the capture
 * route computes them, but records written by earlier revisions did not always.
 */
export const SUBMISSION_FIELDS: readonly FieldSpec[] = [
  { field: 'legacyId', rule: 'text' },
  { field: 'companyName', rule: 'text' },
  { field: 'contactName', rule: 'text' },
  { field: 'contactEmail', rule: 'text' },
  { field: 'phone', rule: 'text' },
  { field: 'website', rule: 'text' },
  { field: 'industry', rule: 'text' },
  { field: 'status', rule: 'exact' },
  { field: 'priority', rule: 'exact' },
  { field: 'completionScore', rule: 'numeric' },
  { field: 'qualityScore', rule: 'numeric' },
  { field: 'aiScore', rule: 'numeric' },
  { field: 'submittedAt', rule: 'timestamp' },
];

/**
 * The relational status vocabulary, and how KV spells each member.
 *
 * Declared as a table rather than derived by replacing hyphens, because the two
 * vocabularies are not mechanically related: `approved` is the console's word
 * for `won`, and a blanket hyphen-to-underscore rule would map it to
 * `approved`, which the check constraint rejects — so the migration would
 * quarantine every converted deal and nobody would learn why from the
 * comparator.
 */
const STATUS_TO_RELATIONAL: Readonly<Record<string, string>> = {
  new: 'new',
  'under-review': 'under_review',
  under_review: 'under_review',
  'in-review': 'under_review',
  reviewing: 'under_review',
  'report-ready': 'report_ready',
  report_ready: 'report_ready',
  'proposal-sent': 'proposal_sent',
  proposal_sent: 'proposal_sent',
  sent: 'proposal_sent',
  approved: 'won',
  won: 'won',
  completed: 'won',
  lost: 'lost',
  archived: 'archived',
};

/**
 * A status in the relational vocabulary, or `undefined`.
 *
 * An unrecognised status projects to ABSENT rather than to itself. Passing it
 * through would report `value_mismatch` — "these two stores hold different
 * statuses" — when the truth is that this repository does not know what the
 * status means, which is a mapping defect and is what `missing_in_*` says.
 */
export function canonicalSubmissionStatus(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return STATUS_TO_RELATIONAL[value.trim().toLowerCase()];
}

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

/** A priority the relational check constraint admits, or `undefined`. */
export function canonicalSubmissionPriority(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return PRIORITIES.has(normalized) ? normalized : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A text value, or `undefined` for absence in any of the four ways the two
 * stores spell it: `null`, missing, the empty string, and the literal
 * placeholders the capture route writes where it has no value.
 *
 * The comparator already treats the first three as one absence; normalising
 * here as well means a projection is one shape rather than three, which is what
 * makes a projection worth reading in a failing test.
 */
function meaningful(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'Not specified' || trimmed === 'TBD') return undefined;
  return trimmed;
}

/** Project the KV record. Total: a malformed record projects to `{}`. */
export function projectKvSubmission(raw: unknown): Projection {
  const record = asRecord(raw);
  if (!record) return {};
  return {
    legacyId: typeof record.id === 'string' ? record.id : undefined,
    companyName: meaningful(record.company),
    contactName: meaningful(record.contact),
    contactEmail: typeof record.email === 'string' ? record.email.toLowerCase().trim() : undefined,
    phone: meaningful(record.phone),
    website: meaningful(record.website),
    industry: meaningful(record.industry),
    status: canonicalSubmissionStatus(record.status),
    priority: canonicalSubmissionPriority(record.priority),
    completionScore: record.completionScore,
    qualityScore: record.qualityScore,
    aiScore: record.aiScore,
    submittedAt: record.submittedAt,
  };
}

/** Project the relational row. Total: a malformed row projects to `{}`. */
export function projectSqlSubmission(row: unknown): Projection {
  const record = asRecord(row);
  if (!record) return {};
  return {
    legacyId: typeof record.legacy_id === 'string' ? record.legacy_id : undefined,
    companyName: meaningful(record.company_name),
    contactName: meaningful(record.contact_name),
    contactEmail:
      typeof record.contact_email === 'string'
        ? record.contact_email.toLowerCase().trim()
        : undefined,
    phone: meaningful(record.phone),
    website: meaningful(record.website),
    industry: meaningful(record.industry),
    // Canonicalised on BOTH sides. The relational column is already
    // constrained to this vocabulary, so this is a no-op for a valid row — and
    // it is exactly what makes a row that somehow holds an invalid status read
    // as a mapping problem rather than as drift.
    status: canonicalSubmissionStatus(record.status),
    priority: canonicalSubmissionPriority(record.priority),
    completionScore: record.completion_score,
    qualityScore: record.quality_score,
    aiScore: record.ai_score,
    submittedAt: record.submitted_at,
  };
}
