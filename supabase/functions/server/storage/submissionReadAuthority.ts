/**
 * Submission read authority — MCV2-S8.1, the aggregate half.
 *
 * The outcome cutover is a PROJECTION: one relational row becomes one response
 * body. This one is not. The submission route serves the KV document whole, and
 * its relational form is spread across `submissions` and `diagnostic_answers` —
 * so serving it from SQL means an AGGREGATE READ and a reconstruction, not a
 * field rename.
 *
 * ── THE SWITCH ─────────────────────────────────────────────────────────────
 *
 *   MCV2_SQL_AUTHORITY_SUBMISSIONS   off by default. On, a submission read is
 *                                    ANSWERED BY the relational model where a
 *                                    row exists, falling back to KV where it
 *                                    does not. Read at the point of use, so
 *                                    turning it off is the rollback and takes
 *                                    effect on the next read.
 *
 * ── THREE THINGS THE RECONSTRUCTION HAD TO GET RIGHT ───────────────────────
 *
 * 1. THE STATUS VOCABULARY IS NOT SYMMETRIC. KV writes the console's spelling
 *    (`in-review`, `completed`); the relational CHECK requires underscores
 *    (`under_review`, `won`). The forward map is MANY-TO-ONE — `approved`,
 *    `won` and `completed` all become `won` — so it cannot be inverted by
 *    reversing it. The inverse below is therefore a DECLARED table that emits
 *    the one spelling the console actually reads.
 *
 *    This is not a free choice. `SubmissionsListPage` filters on `'new'`,
 *    `'in-review'` and `'completed'` and renders `status.replace('-', ' ')`;
 *    `StatusBadge` types the vocabulary as `new | in-review | completed |
 *    approved`. Emitting `under_review` would leave the "In Review" counter
 *    reading zero while the submissions were still there — a silent, plausible
 *    wrong answer, which is the worst kind.
 *
 * 2. PLACEHOLDERS STAY NULL (decision D3). KV wrote `'Not specified'` and `''`
 *    where it had no value; the normalizer discards both as non-values, and the
 *    relational model is authoritative for semantic absence. So `phone` comes
 *    back `null`, not `'Not specified'`. Presentation may render whatever empty
 *    state it likes — it must not write placeholder text back as domain data,
 *    and this module does not put it back.
 *
 * 3. THE UNMODELLED FIELDS ARE NOT LOST. `metadata.kv_remainder` holds
 *    everything the columns do not carry — `employees`, `revenue`, `isRead`,
 *    `submittedDate` — exactly as the backfill stored it. It is spread FIRST so
 *    a modelled column always wins: the remainder is a record of what KV held,
 *    not a second opinion about a field the schema now owns.
 *
 * ── WHEN IT REFUSES TO ANSWER ──────────────────────────────────────────────
 *
 * A backfill that DROPPED answer keys records them in
 * `metadata.backfill_dropped_answer_keys`. Reconstructing from such a row would
 * serve a submission with answers missing and no sign that anything was gone,
 * so it is treated as a fallback instead. KV still has them.
 */

import { createSubmissionRepository } from '../repositories/submissionRepository.ts';
import { createServiceClient } from '../repositories/repositoryClient.ts';
import { createReadAuthority, type AuthorityDomain, type ReadAuthority } from './readAuthority.ts';
import {
  SUBMISSION_FIELDS,
  projectKvSubmission,
  projectSqlSubmission,
  submissionKvKey,
} from './submissionProjection.ts';

const DEADLINE_DEFAULT_MS = 250;
const DEADLINE_MIN_MS = 10;
const DEADLINE_MAX_MS = 2_000;

function readBool(key: string): boolean {
  const raw = Deno.env.get(key);
  return raw === 'true' || raw === '1';
}

function readDeadlineMs(): number {
  const raw = Deno.env.get('MCV2_SHADOW_READ_DEADLINE_MS');
  if (raw === undefined || raw.trim() === '') return DEADLINE_DEFAULT_MS;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return DEADLINE_DEFAULT_MS;
  return Math.min(DEADLINE_MAX_MS, Math.max(DEADLINE_MIN_MS, parsed));
}

function authoritative(domain: AuthorityDomain): boolean {
  return domain === 'submission' && readBool('MCV2_SQL_AUTHORITY_SUBMISSIONS');
}

export const submissionReadAuthority: ReadAuthority = createReadAuthority({
  authoritative,
  deadlineMs: readDeadlineMs,
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
  onNotice: (record) => {
    console.log(
      `⚠️ read-authority [${record.domain}] ${record.key}: ${record.source}` +
        (record.divergentFields ? ` diverged=${record.divergentFields.join(',')}` : ''),
    );
  },
});

let client: ReturnType<typeof createServiceClient> | undefined;
function serviceClient(): ReturnType<typeof createServiceClient> {
  if (!client) client = createServiceClient();
  return client;
}

/**
 * The relational status vocabulary, in the spelling the console reads.
 *
 * Declared, not derived. See note 1 above: the forward map is many-to-one, so
 * there is no reversing it — this table states which single spelling each
 * relational value is served as, and the console's own filters are what decided
 * each entry.
 */
const STATUS_TO_CONSOLE: Readonly<Record<string, string>> = {
  new: 'new',
  under_review: 'in-review',
  report_ready: 'report-ready',
  proposal_sent: 'proposal-sent',
  won: 'completed',
  lost: 'lost',
  archived: 'archived',
};

interface AnswerRow {
  question_key: string;
  answer_text: string | null;
  answer_json: unknown;
}

/** The answers map, rebuilt from rows. */
function answersFromRows(rows: readonly AnswerRow[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const row of rows) {
    // `answer_json` is the value as the form produced it — a number stays a
    // number. `answer_text` is its string rendering and is the fallback, not
    // the preference: serving "4" where the form wrote 4 would change the type
    // a consumer sees.
    answers[row.question_key] = row.answer_json ?? row.answer_text;
  }
  return answers;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A relational submission plus its answers, in the KV document's shape. */
export function submissionRowToKvShape(
  row: unknown,
  answerRows: readonly AnswerRow[],
): Record<string, unknown> {
  const record = asRecord(row);
  const metadata = asRecord(record.metadata);
  const remainder = asRecord(metadata.kv_remainder);
  const status = typeof record.status === 'string' ? record.status : '';

  return {
    // The remainder FIRST: a modelled column below always wins. It is what KV
    // held for fields the schema does not own, not a competing answer for one
    // it does.
    ...remainder,
    id: record.legacy_id ?? String(record.legacy_kv_key ?? '').replace(/^sub:/, ''),
    company: record.company_name ?? null,
    contact: record.contact_name ?? null,
    email: record.contact_email ?? null,
    // D3: absence is null. The placeholder KV wrote is not restored.
    phone: record.phone ?? null,
    website: record.website ?? null,
    industry: record.industry ?? null,
    industryId: record.industry_id ?? null,
    status: STATUS_TO_CONSOLE[status] ?? status,
    priority: record.priority ?? null,
    completionScore: record.completion_score ?? null,
    qualityScore: record.quality_score ?? null,
    aiScore: record.ai_score ?? null,
    submittedAt: record.submitted_at ?? null,
    answers: answersFromRows(answerRows),
  };
}

/**
 * A backfill that dropped answer keys cannot be reconstructed from faithfully.
 *
 * Exported so a test can exercise THIS function rather than re-implement it.
 * The first version of the live suite carried its own copy of this check, so
 * deleting the real one left every scenario green — a mutation that should have
 * been caught and was not.
 */
export function reconstructionIsLossy(row: unknown): boolean {
  const metadata = asRecord(asRecord(row).metadata);
  const dropped = metadata.backfill_dropped_answer_keys;
  return Array.isArray(dropped) && dropped.length > 0;
}

/**
 * Which store answers this submission read.
 *
 * `kvRecord` is what KV holds. The return value is what the caller should be
 * served — the same object when the switch is off.
 */
export async function resolveSubmissionRead(
  submissionId: string,
  kvRecord: unknown,
): Promise<{ record: unknown; source: string }> {
  const key = submissionKvKey(submissionId);
  const resolution = await submissionReadAuthority.resolve<unknown>({
    domain: 'submission',
    key,
    kv: kvRecord,
    fields: SUBMISSION_FIELDS,
    loadSql: async () => {
      const repository = createSubmissionRepository(serviceClient());
      const row = await repository.getSubmissionByLegacyKey(key);
      if (!row) return null;
      // Lossy rows are declined here rather than served with a gap. Returning
      // `null` routes them through the authority's own missing-row fallback,
      // which is counted — silence would not be.
      if (reconstructionIsLossy(row)) return null;
      // The answers are read IN THE ROW'S OWN ORGANIZATION. Not a caller's, and
      // not a default: the submission is the tenant, so its answers are the
      // only ones that can belong to this document.
      const answers = await repository.listAnswers(
        row.id as string,
        row.organization_id as string,
      );
      return { row, answers };
    },
    toRecord: (loaded) => {
      const { row, answers } = loaded as { row: unknown; answers: readonly AnswerRow[] };
      return submissionRowToKvShape(row, answers);
    },
    projectKv: (record) => projectKvSubmission(record),
    projectSql: (loaded) => projectSqlSubmission((loaded as { row: unknown }).row),
  });
  return { record: resolution.record, source: resolution.source };
}

/** Whether the submission domain is currently served by SQL. */
export function submissionSqlAuthorityEnabled(): boolean {
  return authoritative('submission');
}
