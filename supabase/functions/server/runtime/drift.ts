/**
 * Runtime Storage Gateway — drift detection (MCV2-S7.4 → S7.8)
 *
 * Pure comparison helpers plus per-domain projectors that normalize a KV
 * value and its SQL counterpart to a common comparable shape. Kept free of
 * Deno globals so it runs under node for validation tests.
 */
import type { DriftField, DriftReport, DriftStatus, ShadowDomain } from './types.ts';

/** Normalize undefined → null so absent and explicit-null compare equal. */
function norm(value: unknown): unknown {
  return value === undefined ? null : value;
}

/** Structural equality sufficient for flat projections (primitives + arrays). */
function valuesEqual(a: unknown, b: unknown): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  if (typeof na !== typeof nb) return false;
  // Arrays / plain objects → stable JSON compare (projections are shallow).
  if (typeof na === 'object') {
    try {
      return JSON.stringify(na) === JSON.stringify(nb);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Compare two projections field-by-field and produce a DriftReport.
 * The authority projection defines the set of fields that matter; extra
 * fields on the shadow side are ignored (the shadow may be richer).
 */
export function diffProjections(
  domain: ShadowDomain,
  key: string,
  authority: Record<string, unknown> | null,
  shadow: Record<string, unknown> | null,
): DriftReport {
  const at = new Date().toISOString();
  const authorityPresent = authority !== null;
  const shadowPresent = shadow !== null;

  // Presence mismatch is its own signal — one side has the record, the other
  // does not. (Both-absent is a match: nothing to reconcile.)
  if (authorityPresent !== shadowPresent) {
    return {
      domain,
      key,
      status: 'missing',
      fields: [],
      authorityPresent,
      shadowPresent,
      at,
    };
  }

  if (!authorityPresent && !shadowPresent) {
    return { domain, key, status: 'match', fields: [], authorityPresent, shadowPresent, at };
  }

  const fields: DriftField[] = [];
  for (const field of Object.keys(authority as Record<string, unknown>)) {
    const a = (authority as Record<string, unknown>)[field];
    const b = (shadow as Record<string, unknown>)[field];
    if (!valuesEqual(a, b)) {
      fields.push({ field, authority: norm(a), shadow: norm(b) });
    }
  }

  const status: DriftStatus = fields.length === 0 ? 'match' : 'drift';
  return { domain, key, status, fields, authorityPresent, shadowPresent, at };
}

// ── Per-domain projectors ────────────────────────────────────────────────────
// Each projector maps one side to a flat, comparable object. The authority
// (KV) projection defines the fields we assert on during shadow validation.

/** Outcome KV value → comparable projection. */
export function projectOutcomeKv(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  return {
    submissionId: raw.submissionId ?? null,
    didConvert: raw.didConvert ?? null,
    conversionValue: raw.conversionValue ?? null,
  };
}

/** Outcome SQL row (OutcomeRecord) → comparable projection. */
export function projectOutcomeSql(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  const value = (raw.value ?? {}) as Record<string, unknown>;
  return {
    submissionId: raw.submission_id ?? null,
    didConvert: value.didConvert ?? null,
    conversionValue: value.conversionValue ?? null,
  };
}

/** Lead existence (KV: lead_email:<email> → leadId | null). */
export function projectLeadExistenceKv(leadId: string | null): Record<string, unknown> {
  return { exists: !!leadId };
}

/** Lead existence (SQL: LeadRecord | null from lookupLeadByEmail). */
export function projectLeadExistenceSql(raw: Record<string, unknown> | null): Record<string, unknown> {
  return { exists: raw !== null };
}

/** Submission KV value → comparable projection. */
export function projectSubmissionKv(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  return {
    id: raw.id ?? null,
    status: raw.status ?? null,
    companyName: raw.company ?? null,
    contactEmail: raw.email ?? null,
    aiScore: raw.aiScore ?? null,
  };
}

/** Submission SQL row (SubmissionRecord) → comparable projection. */
export function projectSubmissionSql(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  return {
    id: raw.legacy_id ?? raw.id ?? null,
    status: raw.status ?? null,
    companyName: raw.company_name ?? null,
    contactEmail: raw.contact_email ?? null,
    aiScore: raw.ai_score ?? null,
  };
}
