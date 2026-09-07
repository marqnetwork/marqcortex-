/**
 * The outcome domain, projected for comparison — MCV2-S7.4.
 *
 * The KV record and the relational row describe the same deal outcome in two
 * different shapes. This module is the ONE place that says how, and it is pure:
 * two functions from a record to a flat projection, and one declared field set
 * the comparator walks.
 *
 * ── WHERE THE TWO SHAPES DIVERGE BY DESIGN ─────────────────────────────────
 *
 * KV writes one denormalised object under `outcome:<submissionId>`, carrying
 * both the outcome and a copy of the submission's industry, company and score
 * at the moment it was logged. The relational row carries the outcome, a
 * foreign key to the submission, and a `value` JSONB for everything the columns
 * do not model.
 *
 * The projection therefore compares WHAT BOTH STORES CLAIM TO KNOW and nothing
 * else. The denormalised copies of submission fields are deliberately NOT
 * compared: they are a snapshot in KV and live data in SQL, so a company that
 * renamed itself would report as drift forever, and the correct answer to that
 * divergence is "the relational model is right and the snapshot is stale" —
 * which is not a migration defect and must not consume an operator's attention
 * as though it were.
 *
 * ── `didConvert` AND `outcome_type` ARE THE SAME FACT ──────────────────────
 *
 * KV stores a boolean. The relational schema stores a constrained enum whose
 * `won` and `lost` members mean exactly that boolean, and whose other members
 * (`engagement`, `nurture`, `other`) mean the question was not answered. Both
 * sides project to `converted: boolean | null`, so the comparison is made on
 * the fact rather than on either store's spelling of it.
 */

import type { FieldSpec } from './contracts.ts';
import type { Projection } from './compare.ts';

/** The KV prefix this domain lives under. */
export const OUTCOME_KV_PREFIX = 'outcome:';

/** The KV key for one submission's outcome. */
export function outcomeKvKey(submissionId: string): string {
  return `${OUTCOME_KV_PREFIX}${submissionId}`;
}

/**
 * The fields compared for this domain, and the rule each is compared under.
 *
 * Adding a field here is the whole of "start checking this too". Removing one
 * is a deliberate decision that the platform no longer cares whether the stores
 * agree about it — which is why the set is declared rather than derived.
 */
export const OUTCOME_FIELDS: readonly FieldSpec[] = [
  { field: 'submissionId', rule: 'text' },
  { field: 'converted', rule: 'exact' },
  { field: 'conversionValue', rule: 'numeric' },
  { field: 'lostReason', rule: 'text' },
  { field: 'recordedAt', rule: 'timestamp' },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Project the KV record.
 *
 * Total: a malformed record projects to an empty object rather than throwing.
 * A shadow read must never be the thing that fails a request, and the KV store
 * genuinely holds double-encoded and partial records — the migration inventory
 * documented both.
 */
export function projectKvOutcome(raw: unknown): Projection {
  const record = asRecord(raw);
  if (!record) return {};
  return {
    submissionId: typeof record.submissionId === 'string' ? record.submissionId : undefined,
    converted: typeof record.didConvert === 'boolean' ? record.didConvert : undefined,
    conversionValue: record.conversionValue,
    lostReason: record.lostReason,
    recordedAt: record.loggedAt,
  };
}

/**
 * Project the relational row.
 *
 * `outcome_type` carries the conversion when it says so and carries no opinion
 * otherwise — `engagement` is the column default and means the deal outcome was
 * never recorded relationally, which projects to absent rather than to `false`.
 * Projecting it as `false` would report every un-migrated row as a lost deal.
 */
export function projectSqlOutcome(row: unknown): Projection {
  const record = asRecord(row);
  if (!record) return {};
  const value = asRecord(record.value) ?? {};

  const converted =
    record.outcome_type === 'won' ? true : record.outcome_type === 'lost' ? false : undefined;

  return {
    // The submission id is the KV identity. The relational row keys on its own
    // UUID and carries the KV identity in `legacy_kv_key`, so the projection
    // reads it from there — comparing a UUID against a KV id would report a
    // mismatch on every correctly migrated record.
    submissionId: submissionIdFromLegacyKey(record.legacy_kv_key),
    converted,
    conversionValue: value.conversionValue,
    lostReason: value.lostReason,
    recordedAt: record.recorded_at,
  };
}

/** `outcome:<submissionId>` → `<submissionId>`. Anything else is absent. */
export function submissionIdFromLegacyKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith(OUTCOME_KV_PREFIX)) return undefined;
  const id = value.slice(OUTCOME_KV_PREFIX.length).trim();
  return id === '' ? undefined : id;
}
