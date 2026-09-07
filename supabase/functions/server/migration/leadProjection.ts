/**
 * The lead domain, projected for comparison.
 *
 * The submission domain's reconciliation borrows the runtime shadow read's
 * projection, because that domain has a runtime read. The lead domain has none
 * — no route serves a lead — so its projection lives here, beside the only
 * consumer it has.
 *
 * What it shares with the submission one is the COMPARATOR: `storage/compare.ts`
 * and its field rules. A second set of rules for "is a timestamptz that lost its
 * milliseconds a divergence?" would eventually answer differently, and the two
 * domains would report drift on different grounds.
 *
 * ── WHAT IS NOT COMPARED ───────────────────────────────────────────────────
 *
 * `website` is not a `leads` column. The lead backfill writes it to
 * `contact_methods`, so comparing it against a lead row would report every
 * correctly migrated record as missing it.
 *
 * `lead_source_id` and `contact_id` are foreign keys the backfill resolves, not
 * facts KV holds — KV has a source KEY, and the id it maps to is a fact about
 * the relational estate.
 */

import type { FieldSpec } from '../storage/contracts.ts';
import type { Projection } from '../storage/compare.ts';
import type { NormalizedLeadContact } from './types.ts';

export const LEAD_FIELDS: readonly FieldSpec[] = [
  { field: 'legacyId', rule: 'text' },
  { field: 'email', rule: 'text' },
  { field: 'fullName', rule: 'text' },
  { field: 'companyName', rule: 'text' },
  { field: 'phone', rule: 'text' },
  { field: 'status', rule: 'exact' },
  { field: 'capturedAt', rule: 'timestamp' },
];

/** The KV side, from the record the normalizer produced. */
export function projectNormalizedLead(record: NormalizedLeadContact): Projection {
  return {
    legacyId: record.legacyId,
    email: record.email,
    fullName: record.fullName,
    companyName: record.companyName,
    phone: record.phone,
    status: record.status,
    capturedAt: record.capturedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The relational side. Total: a malformed row projects to `{}`. */
export function projectSqlLead(row: unknown): Projection {
  const record = asRecord(row);
  if (!record) return {};
  return {
    legacyId: record.legacy_id,
    email: typeof record.email === 'string' ? record.email.toLowerCase().trim() : undefined,
    fullName: record.full_name,
    companyName: record.company_name,
    phone: record.phone,
    status: record.status,
    capturedAt: record.captured_at,
  };
}
