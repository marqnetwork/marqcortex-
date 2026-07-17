/**
 * Outcome normalization — diagnostic domain (MCV2-S7.4-IMPLEMENT-009)
 *
 * Deterministic mapping of KV and SQL Outcome records into the canonical
 * `OutcomeDTO` so shadow comparison is shape-independent. Pure functions only
 * (no Deno/Supabase imports) — Node-testable.
 *
 * IGNORED fields (explicitly not compared — not business-critical to the
 * outcome's own authoritative data):
 *   - SQL generated id (uuid)
 *   - audit metadata: created_at, updated_at, created_by, updated_by
 *   - soft-delete: deleted_at
 *   - migration metadata: legacy_kv_key (used only as the join axis)
 *   - SQL-only categorization: outcome_type
 *   - log timestamps: recorded_at / loggedAt (when-logged, not the outcome)
 *   - KV denormalized snapshots copied from other entities:
 *     industry, company, aiScore, recommendedService, submittedAt, loggedBy
 *
 * BUSINESS-CRITICAL fields (compared): submissionId, didConvert,
 * conversionValue, lostReason, recommendationWorked, whatWeLearned,
 * improvementAreas, status.
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
  'outcome_type',
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

/** Canonical status derived from didConvert when no explicit status present. */
function deriveStatus(explicit: unknown, didConvert: boolean | null): string | null {
  const s = normEmpty(explicit);
  if (s) {
    const l = s.toLowerCase();
    if (l === 'converted' || l === 'won') return 'converted';
    if (l === 'lost') return 'lost';
    if (l === 'open') return didConvert === null ? 'open' : (didConvert ? 'converted' : 'lost');
    return l;
  }
  if (didConvert === true) return 'converted';
  if (didConvert === false) return 'lost';
  return null;
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
    status: deriveStatus(undefined, didConvert),
  };
}

/**
 * Normalize a SQL OutcomeRecord. Business fields are read from the `value`
 * JSONB blob (where backfill stores them), with column fallbacks.
 */
export function normalizeSqlOutcome(record: unknown): OutcomeDTO | null {
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
    status: deriveStatus(r.status, didConvert),
  };
}

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
