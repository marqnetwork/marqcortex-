/**
 * Outcome KV↔SQL comparison — diagnostic domain (MCV2-S7.4-IMPLEMENT-009)
 *
 * Pure, deterministic comparison producing a structured OutcomeComparison.
 * No Deno/Supabase imports. Never stores raw values — only field paths.
 *
 * Precedence (most severe first): authorization > schema > missing >
 * relationship > value. This ensures a tenant/authorization defect is NEVER
 * masked as a harmless value mismatch.
 */

import {
  ComparisonOutcome,
  type MismatchSeverity,
  type OutcomeComparison,
  type OutcomeDTO,
} from './contracts.ts';
import {
  normalizeKvOutcome,
  normalizeSqlOutcome,
  normEmpty,
  sqlOwnerOrg,
  sqlRelationship,
} from './outcomeNormalize.ts';

const BUSINESS_FIELDS: (keyof OutcomeDTO)[] = [
  'didConvert',
  'conversionValue',
  'lostReason',
  'recommendationWorked',
  'whatWeLearned',
  'improvementAreas',
  'status',
];

function severityFor(outcome: ComparisonOutcome): MismatchSeverity {
  switch (outcome) {
    case ComparisonOutcome.AUTHORIZATION_MISMATCH:
      return 'critical';
    case ComparisonOutcome.SCHEMA_MISMATCH:
    case ComparisonOutcome.RELATIONSHIP_MISMATCH:
    case ComparisonOutcome.SOURCE_MISSING:
      return 'high';
    case ComparisonOutcome.VALUE_MISMATCH:
      return 'high';
    case ComparisonOutcome.TARGET_MISSING:
      return 'low';
    case ComparisonOutcome.ERROR:
      return 'high';
    default:
      return 'info';
  }
}

function fieldEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/** Raw-value equality per field (pre-normalization) for match vs normalization-only. */
function rawFieldEqual(field: keyof OutcomeDTO, kvRaw: Record<string, unknown>, sqlValue: Record<string, unknown>): boolean {
  const kv = kvRaw[field as string];
  const sql = field === 'status' ? undefined : sqlValue[field as string];
  if (Array.isArray(kv) || Array.isArray(sql)) {
    return JSON.stringify(kv) === JSON.stringify(sql);
  }
  return kv === sql;
}

export interface CompareMeta {
  requestId: string;
  organizationId: string | null;
  effectiveOrg: string;
  entityRefHash: string;
  kvMs?: number;
  sqlMs?: number;
}

function base(meta: CompareMeta, outcome: ComparisonOutcome, mismatchFields: string[], sqlErrorClass?: string): OutcomeComparison {
  return {
    outcome,
    requestId: meta.requestId,
    organizationId: meta.organizationId,
    entityType: 'outcome',
    entityRefHash: meta.entityRefHash,
    kvMs: meta.kvMs,
    sqlMs: meta.sqlMs,
    mismatchCount: mismatchFields.length,
    mismatchFields,
    severity: severityFor(outcome),
    comparisonTimestamp: new Date().toISOString(),
    sqlErrorClass,
  };
}

/** Build an error comparison (SQL read failed/timed out). */
export function outcomeErrorComparison(meta: CompareMeta, sqlErrorClass: string): OutcomeComparison {
  return base(meta, ComparisonOutcome.ERROR, [], sqlErrorClass);
}

/**
 * Compare a raw KV outcome payload against a raw SQL OutcomeRecord.
 * `kvRaw` is the parsed KV object (or null); `sqlRecord` is the repo row (or null).
 */
export function compareOutcome(kvRaw: unknown, sqlRecord: unknown, meta: CompareMeta): OutcomeComparison {
  const kvDto = normalizeKvOutcome(kvRaw);
  const sqlDto = normalizeSqlOutcome(sqlRecord);

  // Missing cases.
  if (!kvDto && !sqlDto) return base(meta, ComparisonOutcome.MATCH, []);
  if (!kvDto && sqlDto) return base(meta, ComparisonOutcome.SOURCE_MISSING, ['*']);
  if (kvDto && !sqlDto) return base(meta, ComparisonOutcome.TARGET_MISSING, ['*']);

  // Both present — authorization first (never mask a tenant defect as a value diff).
  const owner = sqlOwnerOrg(sqlRecord);
  if (owner !== null && owner !== meta.effectiveOrg) {
    return base(meta, ComparisonOutcome.AUTHORIZATION_MISMATCH, ['organization_id']);
  }

  // Schema: SQL row must carry an object `value` payload to be comparable.
  const rec = sqlRecord as Record<string, unknown>;
  if (rec.value !== undefined && rec.value !== null && typeof rec.value !== 'object') {
    return base(meta, ComparisonOutcome.SCHEMA_MISMATCH, ['value']);
  }

  // Relationship: submission linkage + legacy key must line up.
  const rel = sqlRelationship(sqlRecord);
  const kvSubmission = (kvDto as OutcomeDTO).submissionId;
  const relFields: string[] = [];
  if (rel.submissionId !== kvSubmission) relFields.push('submission_id');
  const expectedLegacy = kvSubmission ? `outcome:${kvSubmission}` : null;
  if (rel.legacyKvKey !== null && expectedLegacy !== null && rel.legacyKvKey !== expectedLegacy) {
    relFields.push('legacy_kv_key');
  }
  if (relFields.length > 0) return base(meta, ComparisonOutcome.RELATIONSHIP_MISMATCH, relFields);

  // Value comparison on normalized DTOs.
  const mismatchFields: string[] = [];
  for (const f of BUSINESS_FIELDS) {
    if (!fieldEqual((kvDto as OutcomeDTO)[f], (sqlDto as OutcomeDTO)[f])) mismatchFields.push(f as string);
  }

  if (mismatchFields.length === 0) {
    // Normalized-equal. Distinguish exact match vs normalization-only.
    const kvRawObj = (kvRaw && typeof kvRaw === 'object' ? kvRaw : {}) as Record<string, unknown>;
    const sqlValueObj = ((sqlRecord as Record<string, unknown>)?.value && typeof (sqlRecord as Record<string, unknown>).value === 'object'
      ? (sqlRecord as Record<string, unknown>).value
      : {}) as Record<string, unknown>;
    const normalizationApplied = BUSINESS_FIELDS.some((f) => f !== 'status' && !rawFieldEqual(f, kvRawObj, sqlValueObj));
    return base(meta, normalizationApplied ? ComparisonOutcome.NORMALIZATION_ONLY_MATCH : ComparisonOutcome.MATCH, []);
  }

  return base(meta, ComparisonOutcome.VALUE_MISMATCH, mismatchFields);
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
