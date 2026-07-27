/**
 * Outcome KV↔SQL comparison — diagnostic domain
 * (MCV2-S7.4-IMPLEMENT-009 · MCV2-S7.4-REMEDIATION · G3)
 *
 * Pure, deterministic comparison producing a structured OutcomeComparison.
 * No Deno/Supabase imports. Never stores raw values — only field paths.
 *
 * Canonical, mutually-exclusive statuses (G3):
 *   match        both present and every comparable field agrees
 *   mismatch     a comparable field is populated on BOTH sides but conflicts
 *   partial      SQL row exists but a field KV populated is null/absent in SQL
 *   missing_sql  KV present, SQL row absent
 *   missing_kv   SQL present, KV record absent
 *   error        SQL read failed / timed out (built by `outcomeErrorComparison`)
 *   (skipped is produced by the gateway when the shadow is ineligible)
 *
 * Precedence when both rows are present (most severe first):
 *   authorization conflict > value conflict (mismatch) > partial > match.
 * A tenant/authorization defect is therefore NEVER masked as a value mismatch
 * or downgraded to `partial`/`match`, and an incomplete SQL row is NEVER
 * classified as `match`.
 */

import {
  ComparisonStatus,
  type MismatchSeverity,
  type OutcomeComparison,
  type OutcomeDTO,
} from './contracts.ts';
import {
  normalizeKvOutcome,
  projectOutcomeRecord,
  sqlOwnerOrg,
  normEmpty,
} from './outcomeNormalize.ts';

/** Business-critical comparable fields (submissionId is a relationship axis). */
const BUSINESS_FIELDS: (keyof OutcomeDTO)[] = [
  'didConvert',
  'conversionValue',
  'lostReason',
  'recommendationWorked',
  'whatWeLearned',
  'improvementAreas',
  'status',
];

function severityFor(status: ComparisonStatus, authorization: boolean): MismatchSeverity {
  switch (status) {
    case ComparisonStatus.MISMATCH:
      return authorization ? 'critical' : 'high';
    case ComparisonStatus.MISSING_KV:
      return 'high';
    case ComparisonStatus.ERROR:
      return 'high';
    case ComparisonStatus.PARTIAL:
      return 'low';
    case ComparisonStatus.MISSING_SQL:
      return 'low';
    default:
      return 'info';
  }
}

/** A value counts as "populated" when it is neither null nor an empty array. */
function isPopulated(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function fieldEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

export interface CompareMeta {
  requestId: string;
  organizationId: string | null;
  effectiveOrg: string;
  entityRefHash: string;
  kvMs?: number;
  sqlMs?: number;
}

function build(
  meta: CompareMeta,
  status: ComparisonStatus,
  mismatchFields: string[],
  opts?: { authorization?: boolean; sqlErrorClass?: string },
): OutcomeComparison {
  return {
    status,
    requestId: meta.requestId,
    organizationId: meta.organizationId,
    entityType: 'outcome',
    entityRefHash: meta.entityRefHash,
    kvMs: meta.kvMs,
    sqlMs: meta.sqlMs,
    mismatchCount: mismatchFields.length,
    mismatchFields,
    severity: severityFor(status, opts?.authorization ?? false),
    comparisonTimestamp: new Date().toISOString(),
    sqlErrorClass: opts?.sqlErrorClass,
  };
}

/** Build an error comparison (SQL read failed/timed out). */
export function outcomeErrorComparison(meta: CompareMeta, sqlErrorClass: string): OutcomeComparison {
  return build(meta, ComparisonStatus.ERROR, [], { sqlErrorClass });
}

/** Build a skipped comparison (shadow ineligible / not executed). */
export function outcomeSkippedComparison(meta: CompareMeta, reason: string): OutcomeComparison {
  return build(meta, ComparisonStatus.SKIPPED, [], { sqlErrorClass: reason });
}

/**
 * Compare a raw KV outcome payload against a raw SQL OutcomeRecord.
 * `kvRaw` is the parsed KV object (or null); `sqlRecord` is the repo row (or null).
 */
export function compareOutcome(kvRaw: unknown, sqlRecord: unknown, meta: CompareMeta): OutcomeComparison {
  const kvDto = normalizeKvOutcome(kvRaw);
  const sqlDto = projectOutcomeRecord(sqlRecord);

  // Missing cases first.
  if (!kvDto && !sqlDto) return build(meta, ComparisonStatus.MATCH, []);
  if (!kvDto && sqlDto) return build(meta, ComparisonStatus.MISSING_KV, ['*']);
  if (kvDto && !sqlDto) return build(meta, ComparisonStatus.MISSING_SQL, ['*']);

  const kv = kvDto as OutcomeDTO;
  const sql = sqlDto as OutcomeDTO;

  // Authorization takes precedence over everything else when both rows exist:
  // an SQL row scoped to a different tenant is a critical mismatch, never a
  // value diff or a partial.
  const owner = sqlOwnerOrg(sqlRecord);
  if (owner !== null && owner !== meta.effectiveOrg) {
    return build(meta, ComparisonStatus.MISMATCH, ['organization_id'], { authorization: true });
  }

  // Field-level classification.
  const conflictFields: string[] = [];
  const partialFields: string[] = [];
  for (const f of BUSINESS_FIELDS) {
    const kvVal = kv[f];
    const sqlVal = sql[f];
    if (fieldEqual(kvVal, sqlVal)) continue;
    if (isPopulated(kvVal) && !isPopulated(sqlVal)) {
      // KV has a value the SQL row has not (yet) captured → incomplete SQL row.
      partialFields.push(f as string);
    } else {
      // Both populated and differing, or SQL populated where KV is empty → conflict.
      conflictFields.push(f as string);
    }
  }

  // Precedence: any true conflict → mismatch; else any partial → partial; else match.
  if (conflictFields.length > 0) {
    return build(meta, ComparisonStatus.MISMATCH, conflictFields);
  }
  if (partialFields.length > 0) {
    return build(meta, ComparisonStatus.PARTIAL, partialFields);
  }
  return build(meta, ComparisonStatus.MATCH, []);
}

/** Non-reversible, non-sensitive reference hash of a submission id. */
export function hashEntityRef(submissionId: string): string {
  // FNV-1a 32-bit — deterministic, non-cryptographic, leaks nothing.
  let h = 0x811c9dc5;
  for (let i = 0; i < submissionId.length; i++) {
    h ^= submissionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `oc_${(h >>> 0).toString(16)}`;
}

// re-export for callers that only need the empty normalizer
export { normEmpty };
