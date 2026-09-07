/**
 * Submission normalizer — the KV to relational migration's Phase 2 for the
 * `sub:` domain, deferred by S6.2 and S6.3 and taken up here.
 *
 * IT IS NOT A NEW SPRINT NUMBER. The roadmap's Phase 4 already spends S7.1
 * through S7.8, and inventing an S7.9 for work the migration roadmap calls
 * Phase 2 would put one piece of work under two numbering schemes. This is
 * `MCV2-S3-MIGRATION-ROADMAP.md` Part A Phase 2, applied to the second domain.
 *
 * The one place the `sub:{id}` KV blob becomes relational rows, and it is pure:
 * a record in, a decision out, no client and no clock. Every mapping judgement
 * the roadmap flagged for human review lives here and is testable without a
 * database.
 *
 * ── THE THREE DESTINATIONS ─────────────────────────────────────────────────
 *
 * `MCV2-S5-KV-RELATIONAL-MAPPING.md` splits one KV object across three tables:
 *
 *   submissions        identity, contact, industry, status, priority, the
 *                      remainder as `metadata`
 *   diagnostic_answers one row per key of the `answers` object
 *   diagnostic_scores  the three scores, as one row
 *
 * The normalizer produces all three as ONE value, because they are one
 * decision. Producing them separately would let a submission be written whose
 * answers were then rejected, and there is no transaction across three
 * normalizer calls.
 *
 * ── WHAT IS QUARANTINED, AND WHY THE LIST IS SHORT ─────────────────────────
 *
 * A record is quarantined only when writing it would be WRONG, never when it is
 * merely incomplete:
 *
 *   MALFORMED_JSON   the blob does not parse.
 *   INVALID_PAYLOAD  it parses to something that is not an object.
 *   MISSING_EMAIL    `contact_email` is NOT NULL, and an email is the only way
 *                    a submission can later be matched to its lead and contact.
 *   MISSING_COMPANY  `company_name` is NOT NULL. The capture route always
 *                    writes one, so its absence means the record predates the
 *                    current shape or was hand-edited — either way, inventing
 *                    one would put a fabricated company name in front of a
 *                    consultant.
 *
 * Everything else is INFERRED and recorded as inferred. An unknown status
 * becomes `new` rather than a quarantine, because the alternative is refusing
 * to migrate a real submission over a vocabulary difference — and the inference
 * is named in `metadata.backfill_inferred_fields`, so a reconciliation can find
 * every record the backfill had to guess about.
 *
 * ── STATUS AND PRIORITY ARE CANONICALISED, NOT PASSED THROUGH ──────────────
 *
 * The relational check constraints admit a fixed vocabulary, and KV holds the
 * console's. The mapping is the SAME declared table the shadow read uses
 * (`storage/submissionProjection.ts`) — imported rather than restated, because
 * two copies of a vocabulary mapping is how a backfill and the instrument that
 * checks it end up disagreeing about what a converted deal is called.
 */

import { emptyStringToNull, normalizeEmail, parseKvRecord, stableSortKeys } from './parseJson.ts';
import {
  canonicalSubmissionPriority,
  canonicalSubmissionStatus,
} from '../storage/submissionProjection.ts';
import type { ParsedKvRecord } from './types.ts';

/** The KV prefix the submission entity lives under. */
export const SUBMISSION_ENTITY_PREFIX = 'sub:';

/** The email index KV writes beside it. Not an entity. */
export const SUBMISSION_EMAIL_INDEX_PREFIX = 'sub_email:';

export const MIGRATION_NAME_SUBMISSIONS = 'submissions_diagnostic_v1';

/** True for a submission ENTITY key, false for the email index beside it. */
export function isSubmissionEntityKey(key: string): boolean {
  return key.startsWith(SUBMISSION_ENTITY_PREFIX) && !key.startsWith(SUBMISSION_EMAIL_INDEX_PREFIX);
}

export function isSubmissionEmailIndexKey(key: string): boolean {
  return key.startsWith(SUBMISSION_EMAIL_INDEX_PREFIX);
}

export interface SubmissionKvPayload {
  id?: string;
  company?: string;
  contact?: string;
  email?: string;
  phone?: string;
  website?: string;
  industry?: string;
  industryId?: string;
  submittedAt?: string;
  status?: string;
  priority?: string;
  completionScore?: number | string;
  qualityScore?: number | string;
  aiScore?: number | string;
  answers?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NormalizedAnswer {
  questionKey: string;
  answerText: string | null;
  answerJson: unknown;
}

export interface NormalizedSubmissionScores {
  completionScore: number | null;
  qualityScore: number | null;
  aiScore: number | null;
}

export interface NormalizedSubmission {
  legacyKvKey: string;
  legacyId: string;
  organizationId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string;
  phone: string | null;
  website: string | null;
  industry: string | null;
  industryId: string | null;
  status: string;
  priority: string;
  submittedAt: string;
  metadata: Record<string, unknown>;
  answers: readonly NormalizedAnswer[];
  scores: NormalizedSubmissionScores;
  inferredFields: readonly string[];
}

export type SubmissionNormalizationResult =
  | { ok: true; record: NormalizedSubmission; classification: 'migrated' }
  | {
      ok: false;
      reasonCode: string;
      reasonDetail: string;
      classification: 'quarantined';
    };

/**
 * The fields carried as columns, so everything else can go to `metadata`
 * without listing what to exclude twice.
 */
const COLUMN_FIELDS = new Set([
  'id',
  'company',
  'contact',
  'email',
  'phone',
  'website',
  'industry',
  'industryId',
  'submittedAt',
  'status',
  'priority',
  'completionScore',
  'qualityScore',
  'aiScore',
  'answers',
]);

/** Placeholders the capture route writes where it has no value. */
const PLACEHOLDERS = new Set(['Not specified', 'TBD']);

function meaningful(value: unknown): string | null {
  const text = emptyStringToNull(typeof value === 'string' ? value : null);
  if (text === null) return null;
  return PLACEHOLDERS.has(text) ? null : text;
}

/**
 * An integer score within the range a percentage can hold, or `null`.
 *
 * The columns are plain INTEGER with no check constraint, so a nonsense value
 * would be stored rather than rejected — and a score of 4,300 on a consultant's
 * screen is worse than a blank one. Out of range is recorded as inferred rather
 * than quarantined: the rest of the submission is still worth migrating.
 */
export function normalizeScore(value: unknown): { score: number | null; outOfRange: boolean } {
  if (value === null || value === undefined || value === '') return { score: null, outOfRange: false };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return { score: null, outOfRange: true };
  const rounded = Math.round(parsed);
  if (rounded < 0 || rounded > 100) return { score: null, outOfRange: true };
  return { score: rounded, outOfRange: false };
}

/**
 * One `answers` entry as a row.
 *
 * The question key is lower-cased and trimmed because
 * `diagnostic_answers_question_normalized` requires it — a check constraint the
 * backfill must satisfy rather than discover at write time.
 *
 * BOTH columns are written. `answer_text` is the human-readable form a report
 * renders and `answer_json` is the structured original; a scalar answer has the
 * same content in both, and a structured one would be lossy in text alone.
 */
export function normalizeAnswers(answers: unknown): {
  rows: NormalizedAnswer[];
  dropped: string[];
} {
  const rows: NormalizedAnswer[] = [];
  const dropped: string[] = [];
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return { rows, dropped };
  }

  for (const [rawKey, value] of Object.entries(answers as Record<string, unknown>)) {
    const questionKey = rawKey.trim().toLowerCase();
    // An empty key cannot satisfy the constraint and cannot be looked up. It is
    // dropped and NAMED rather than silently skipped, so a reconciliation can
    // see that the answer count will legitimately differ.
    if (questionKey === '') {
      dropped.push(rawKey);
      continue;
    }
    // The unique index is on (submission_id, question_key). Two KV keys that
    // differ only in case collapse to one row, and keeping the LAST is the
    // same rule an object literal follows — the later key wins.
    const existing = rows.findIndex((row) => row.questionKey === questionKey);
    const row: NormalizedAnswer = {
      questionKey,
      answerText:
        typeof value === 'string'
          ? value
          : value === null || value === undefined
            ? null
            : JSON.stringify(value),
      answerJson: value ?? null,
    };
    if (existing >= 0) {
      dropped.push(rawKey);
      rows[existing] = row;
    } else {
      rows.push(row);
    }
  }

  return { rows, dropped };
}

/**
 * Narrow a result to its quarantine branch.
 *
 * A user-defined type guard rather than an `if (!result.ok)`, because the
 * repository's Node type-check boundary runs without `strictNullChecks` and
 * therefore does not narrow a discriminated union by its boolean discriminant.
 * `domains/leads.ts` carries two long-standing errors for exactly that reason;
 * this is the same shape of code with the one line that makes the compiler
 * agree.
 */
export function isQuarantined(
  result: SubmissionNormalizationResult,
): result is Extract<SubmissionNormalizationResult, { ok: false }> {
  return !result.ok;
}

export function parseSubmissionKvRecord(
  key: string,
  rawValue: unknown,
): ParsedKvRecord<SubmissionKvPayload> {
  return parseKvRecord<SubmissionKvPayload>(key, rawValue);
}

export function normalizeSubmissionRecord(
  parsed: ParsedKvRecord<SubmissionKvPayload>,
  organizationId: string,
  sourceKey: string,
): SubmissionNormalizationResult {
  if (parsed.parseError) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_JSON',
      reasonDetail: parsed.parseError,
      classification: 'quarantined',
    };
  }

  const payload = parsed.parsed;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      reasonCode: 'INVALID_PAYLOAD',
      reasonDetail: 'Submission payload is not an object',
      classification: 'quarantined',
    };
  }

  const contactEmail = normalizeEmail(payload.email);
  if (!contactEmail) {
    return {
      ok: false,
      reasonCode: 'MISSING_EMAIL',
      reasonDetail: 'submissions.contact_email is NOT NULL and no email is present',
      classification: 'quarantined',
    };
  }

  const companyName = meaningful(payload.company);
  if (!companyName) {
    return {
      ok: false,
      reasonCode: 'MISSING_COMPANY',
      reasonDetail: 'submissions.company_name is NOT NULL and no company is present',
      classification: 'quarantined',
    };
  }

  const inferredFields: string[] = [];
  const legacyId =
    emptyStringToNull(payload.id ?? null) ?? sourceKey.slice(SUBMISSION_ENTITY_PREFIX.length);
  const legacyKvKey = isSubmissionEntityKey(sourceKey)
    ? sourceKey
    : `${SUBMISSION_ENTITY_PREFIX}${legacyId}`;

  let status = canonicalSubmissionStatus(payload.status);
  if (status === undefined) {
    // Refusing to migrate a real submission over a vocabulary difference would
    // be worse than recording the default and naming the guess.
    status = 'new';
    if (emptyStringToNull(typeof payload.status === 'string' ? payload.status : null) !== null) {
      inferredFields.push('status_unrecognised');
    } else {
      inferredFields.push('status_default');
    }
  }

  let priority = canonicalSubmissionPriority(payload.priority);
  if (priority === undefined) {
    priority = 'medium';
    inferredFields.push('priority_default');
  }

  let submittedAt = emptyStringToNull(payload.submittedAt ?? null);
  if (submittedAt === null || Number.isNaN(Date.parse(submittedAt))) {
    // The epoch, exactly as the lead normalizer does for the same reason: an
    // invented "now" would tell a consultant this submission arrived today.
    submittedAt = new Date(0).toISOString();
    inferredFields.push('submitted_at_default');
  }

  const completion = normalizeScore(payload.completionScore);
  const quality = normalizeScore(payload.qualityScore);
  const ai = normalizeScore(payload.aiScore);
  for (const [name, result] of [
    ['completion_score', completion],
    ['quality_score', quality],
    ['ai_score', ai],
  ] as const) {
    if (result.outOfRange) inferredFields.push(`${name}_out_of_range`);
  }

  const { rows: answers, dropped } = normalizeAnswers(payload.answers);
  if (dropped.length > 0) inferredFields.push('answers_collapsed');

  // Everything the columns do not carry, in a stable key order so a checksum
  // over the metadata is reproducible.
  const remainder: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!COLUMN_FIELDS.has(key)) remainder[key] = value;
  }

  return {
    ok: true,
    classification: 'migrated',
    record: {
      legacyKvKey,
      legacyId,
      organizationId,
      companyName,
      contactName: meaningful(payload.contact),
      contactEmail,
      phone: meaningful(payload.phone),
      website: meaningful(payload.website),
      industry: meaningful(payload.industry),
      industryId: meaningful(payload.industryId),
      status,
      priority,
      submittedAt,
      metadata: {
        kv_double_encoded: parsed.doubleEncoded,
        kv_remainder: stableSortKeys(remainder) as Record<string, unknown>,
        ...(dropped.length > 0 ? { backfill_dropped_answer_keys: dropped } : {}),
        ...(inferredFields.length > 0 ? { backfill_inferred_fields: inferredFields } : {}),
      },
      answers,
      scores: {
        completionScore: completion.score,
        qualityScore: quality.score,
        aiScore: ai.score,
      },
      inferredFields,
    },
  };
}

/**
 * The canonical hash of a normalized submission, for reconciliation.
 *
 * Answers are included as a COUNT and a sorted key list rather than as content:
 * the hash exists to detect that a record changed shape between a simulation
 * and a backfill, and a hash over every answer body would change whenever a
 * consultant edited a single word — which is drift the migration does not care
 * about and cannot act on.
 */
export function canonicalSubmissionHash(record: NormalizedSubmission): string {
  return JSON.stringify({
    legacy_kv_key: record.legacyKvKey,
    legacy_id: record.legacyId,
    company_name: record.companyName,
    contact_email: record.contactEmail,
    status: record.status,
    priority: record.priority,
    submitted_at: record.submittedAt,
    scores: record.scores,
    answer_count: record.answers.length,
    answer_keys: [...record.answers.map((answer) => answer.questionKey)].sort(),
  });
}
