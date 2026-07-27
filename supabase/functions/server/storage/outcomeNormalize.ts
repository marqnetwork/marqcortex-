/**
 * Outcome normalization — diagnostic domain (MCV2-S7.4-IMPLEMENT-009)
 *
 * Deterministic mapping of KV and SQL Outcome records into the canonical
 * `OutcomeDTO` so shadow comparison is shape-independent. Pure functions only
 * (no Deno/Supabase imports) — Node-testable.
 *
 * MCV2-S7.4-REMEDIATION (G6): the SQL projection is exported as
 * `projectOutcomeRecord` and covered by focused unit tests.
 *
 * MCV2-S7.4-REMEDIATION-2 (D2/D3): the two sides carry DIFFERENT status
 * vocabularies and must never be diffed directly:
 *   - SQL `outcomes.status`  = LIFECYCLE ('open'/'closed'/'archived'), NOT NULL
 *     DEFAULT 'open'. No KV equivalent ⇒ IGNORED.
 *   - SQL `outcomes.outcome_type` = categorisation whose 'won'/'lost' values DO
 *     carry the conversion signal ⇒ used as the conversion input.
 * Both sides therefore project a single canonical `conversionStatus`
 * ('converted'/'lost'/null), so a row with no conversion signal reads as
 * unpopulated (→ `partial`) instead of conflicting (→ false `mismatch`).
 *
 * IGNORED fields (explicitly not compared — not business-critical to the
 * outcome's own authoritative data):
 *   - SQL generated id (uuid)
 *   - audit metadata: created_at, updated_at, created_by, updated_by
 *   - soft-delete: deleted_at
 *   - migration metadata: legacy_kv_key (used only as the join axis)
 *   - SQL lifecycle status: status ('open'/'closed'/'archived')
 *   - log timestamps: recorded_at / loggedAt (when-logged, not the outcome)
 *   - KV denormalized snapshots copied from other entities:
 *     industry, company, aiScore, recommendedService, submittedAt, loggedBy
 *
 * BUSINESS-CRITICAL fields (compared): didConvert, conversionValue, lostReason,
 * recommendationWorked, whatWeLearned, improvementAreas, conversionStatus.
 * (`submissionId` is a relationship axis, not a compared value: KV holds
 * `SUB-<ts>-<rand>` while SQL holds a generated UUID.)
 */

import type { OutcomeDTO } from './contracts.ts';

export const OUTCOME_IGNORED_FIELDS: readonly string[] = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_at',
  'legacy_kv_key',
  // SQL LIFECYCLE status ('open'/'closed'/'archived') — no KV equivalent, so it
  // is never compared (MCV2-S7.4-REMEDIATION-2 · D2).
  'status',
  'recorded_at',
  'loggedAt',
  'loggedBy',
  'industry',
  'company',
  'aiScore',
  'recommendedService',
  'submittedAt',
];

/** null / undefined / '' collapse to null. */
export function normEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function normBool(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

function normNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).sort(); // ordering-independent
}

/**
 * SQL `outcomes.status` vocabulary — a LIFECYCLE axis, NOT a conversion signal.
 * `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived'))`.
 * There is no KV equivalent, so these values are never compared (D2).
 */
export const SQL_LIFECYCLE_STATUSES: readonly string[] = ['open', 'closed', 'archived'];

/**
 * SQL `outcome_type` values that carry a CONVERSION signal, mapped to the
 * canonical conversion vocabulary. The remaining values in the column's CHECK
 * ('engagement', 'nurture', 'other') are lifecycle/categorisation only and
 * carry NO conversion signal, so they resolve to `null` (unpopulated) and let
 * the `value.didConvert` fallback decide.
 */
const OUTCOME_TYPE_CONVERSION: Record<string, string> = {
  won: 'converted',
  lost: 'lost',
};

/** Canonical conversion status from a boolean didConvert. */
function conversionStatusFromBool(didConvert: boolean | null): string | null {
  if (didConvert === true) return 'converted';
  if (didConvert === false) return 'lost';
  return null;
}

/**
 * SQL-side conversion status (MCV2-S7.4-REMEDIATION-2 · D2).
 *
 * Prefers the `outcome_type` conversion signal ('won'/'lost'); falls back to
 * `value.didConvert` from the backfill blob. Returns `null` when SQL carries no
 * conversion signal at all — which lets an incomplete/un-backfilled row be
 * classified `partial` rather than a false `mismatch` (D3).
 */
function sqlConversionStatus(outcomeType: unknown, didConvert: boolean | null): string | null {
  const t = normEmpty(outcomeType)?.toLowerCase();
  // `Object.hasOwn` guard: a raw value like 'constructor' or '__proto__' must not
  // resolve through the prototype chain to a non-string.
  if (t && Object.hasOwn(OUTCOME_TYPE_CONVERSION, t)) return OUTCOME_TYPE_CONVERSION[t];
  return conversionStatusFromBool(didConvert);
}

/** Normalize a KV outcome object (parsed `outcome:{submissionId}` payload). */
export function normalizeKvOutcome(raw: unknown): OutcomeDTO | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const didConvert = normBool(o.didConvert);
  return {
    submissionId: normEmpty(o.submissionId),
    didConvert,
    conversionValue: normNumber(o.conversionValue),
    lostReason: normEmpty(o.lostReason),
    recommendationWorked: normBool(o.recommendationWorked),
    whatWeLearned: normEmpty(o.whatWeLearned),
    improvementAreas: normStringArray(o.improvementAreas),
    conversionStatus: conversionStatusFromBool(didConvert),
  };
}

/**
 * Project a SQL OutcomeRecord onto the canonical comparable `OutcomeDTO`
 * (MCV2-S7.4-REMEDIATION · G6). Business fields are read from the `value`
 * JSONB blob (the backfill target), with column fallbacks. Returns `null` for
 * a missing SQL row.
 *
 * This is the single, directly-tested SQL→DTO mapping used by the comparison.
 */
export function projectOutcomeRecord(record: unknown): OutcomeDTO | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  const value = (r.value && typeof r.value === 'object' ? r.value : {}) as Record<string, unknown>;
  const didConvert = normBool(value.didConvert);
  return {
    submissionId: normEmpty(r.submission_id ?? value.submissionId),
    didConvert,
    conversionValue: normNumber(value.conversionValue),
    lostReason: normEmpty(value.lostReason),
    recommendationWorked: normBool(value.recommendationWorked),
    whatWeLearned: normEmpty(value.whatWeLearned),
    improvementAreas: normStringArray(value.improvementAreas),
    conversionStatus: sqlConversionStatus(r.outcome_type, didConvert),
  };
}

/** Back-compat alias retained for readability at call sites. */
export const normalizeSqlOutcome = projectOutcomeRecord;

/** SQL organization ownership, for the authorization check (raw, un-normalized). */
export function sqlOwnerOrg(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  return normEmpty((record as Record<string, unknown>).organization_id);
}

/** SQL legacy_kv_key + submission_id, for the relationship check. */
export function sqlRelationship(record: unknown): { legacyKvKey: string | null; submissionId: string | null } {
  const r = (record && typeof record === 'object' ? record : {}) as Record<string, unknown>;
  return { legacyKvKey: normEmpty(r.legacy_kv_key), submissionId: normEmpty(r.submission_id) };
}
