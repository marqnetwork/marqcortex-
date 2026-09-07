/**
 * Outcome normalizer — Phase 2 for the `outcome:` domain.
 *
 * `MCV2-S5-KV-RELATIONAL-MAPPING.md`: `outcome:{submissionId}` → `outcomes`,
 * "1:1 upsert on `submission_id`". The relational column is UNIQUE, which is the
 * same one-per-submission rule the KV key shape already expresses.
 *
 * ── `didConvert` IS THE RECORD ─────────────────────────────────────────────
 *
 * A deal outcome without a conversion verdict is not an outcome — the POST
 * route that writes these records refuses a body without a boolean
 * `didConvert`, so a KV record missing one predates the current shape or was
 * hand-edited. It is quarantined rather than defaulted: `outcome_type` would
 * otherwise be guessed, and a guessed "lost" is a deal a consultant will be
 * told they lost.
 *
 * ── THE DENORMALISED SNAPSHOT IS NOT MIGRATED ──────────────────────────────
 *
 * The KV record carries `industry`, `company`, `aiScore` and `submittedAt` as
 * they were WHEN THE OUTCOME WAS LOGGED. The relational model carries them live
 * on the submission this row already points at, so copying them would create a
 * second, staler answer to a question the schema already answers — and the
 * runtime shadow read excludes them from its comparison for exactly the same
 * reason (`storage/outcomeProjection.ts`).
 *
 * What IS carried into `value` is what only the outcome knows: the money, the
 * reason, and what the team learned.
 */

import { emptyStringToNull, parseKvRecord } from './parseJson.ts';
import { OUTCOME_KV_PREFIX } from '../storage/outcomeProjection.ts';
import type { ParsedKvRecord } from './types.ts';

export const OUTCOME_ENTITY_PREFIX = OUTCOME_KV_PREFIX;

export const MIGRATION_NAME_OUTCOMES = 'outcomes_v1';

export function isOutcomeEntityKey(key: string): boolean {
  return key.startsWith(OUTCOME_ENTITY_PREFIX);
}

export function submissionIdFromOutcomeKey(key: string): string | undefined {
  if (!isOutcomeEntityKey(key)) return undefined;
  const id = key.slice(OUTCOME_ENTITY_PREFIX.length).trim();
  return id === '' ? undefined : id;
}

export interface NormalizedOutcome {
  legacyKvKey: string;
  submissionLegacyKvKey: string;
  organizationId: string;
  /** `won` or `lost`. Never guessed — see the module comment. */
  outcomeType: 'won' | 'lost';
  status: 'closed';
  recordedAt: string;
  /** What only the outcome knows. No copy of the submission. */
  value: Record<string, unknown>;
  inferredFields: readonly string[];
}

export type OutcomeNormalizationResult =
  | { ok: true; record: NormalizedOutcome; classification: 'migrated' }
  | { ok: false; reasonCode: string; reasonDetail: string; classification: 'quarantined' };

export function isOutcomeQuarantined(
  result: OutcomeNormalizationResult,
): result is Extract<OutcomeNormalizationResult, { ok: false }> {
  return !result.ok;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The conversion value, in whatever the record holds.
 *
 * Kept as a number or dropped. The KV route writes `parseFloat(...) || null`,
 * so a record can carry a string, a null, or a number — and a string that
 * happens to parse is the same money as the number.
 */
export function normalizeConversionValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function parseOutcomeKvRecord(
  key: string,
  rawValue: unknown,
): ParsedKvRecord<Record<string, unknown>> {
  return parseKvRecord<Record<string, unknown>>(key, rawValue);
}

export function normalizeOutcomeRecord(
  parsed: ParsedKvRecord<Record<string, unknown>>,
  organizationId: string,
  sourceKey: string,
): OutcomeNormalizationResult {
  if (parsed.parseError) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_JSON',
      reasonDetail: parsed.parseError,
      classification: 'quarantined',
    };
  }

  const payload = asRecord(parsed.parsed);
  if (!payload) {
    return {
      ok: false,
      reasonCode: 'INVALID_PAYLOAD',
      reasonDetail: 'Outcome payload is not an object',
      classification: 'quarantined',
    };
  }

  const submissionId = submissionIdFromOutcomeKey(sourceKey);
  if (!submissionId) {
    return {
      ok: false,
      reasonCode: 'UNADDRESSABLE_KEY',
      reasonDetail: `Cannot derive a submission id from ${sourceKey}`,
      classification: 'quarantined',
    };
  }

  if (typeof payload.didConvert !== 'boolean') {
    return {
      ok: false,
      reasonCode: 'MISSING_VERDICT',
      reasonDetail: 'didConvert is absent or not a boolean, so outcome_type would have to be guessed',
      classification: 'quarantined',
    };
  }

  const inferredFields: string[] = [];

  let recordedAt = emptyStringToNull(typeof payload.loggedAt === 'string' ? payload.loggedAt : null);
  if (recordedAt === null || Number.isNaN(Date.parse(recordedAt))) {
    recordedAt = new Date(0).toISOString();
    inferredFields.push('recorded_at_default');
  }

  const conversionValue = normalizeConversionValue(payload.conversionValue);
  if (payload.didConvert && conversionValue === null && payload.conversionValue != null) {
    inferredFields.push('conversion_value_unreadable');
  }

  const improvementAreas = Array.isArray(payload.improvementAreas)
    ? payload.improvementAreas.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    ok: true,
    classification: 'migrated',
    record: {
      legacyKvKey: sourceKey,
      submissionLegacyKvKey: `sub:${submissionId}`,
      organizationId,
      // The inverse of `storage/outcomeProjection.ts`'s reading, so the backfill
      // writes what the shadow read expects to find.
      outcomeType: payload.didConvert ? 'won' : 'lost',
      // A logged outcome is a recorded conclusion, not an open question. The
      // column's default is `open`, which is right for a row created by
      // something still in progress and wrong for one migrated from a verdict a
      // consultant already reached.
      status: 'closed',
      recordedAt,
      value: {
        conversionValue,
        lostReason: emptyStringToNull(
          typeof payload.lostReason === 'string' ? payload.lostReason : null,
        ),
        recommendationWorked:
          typeof payload.recommendationWorked === 'boolean' ? payload.recommendationWorked : null,
        whatWeLearned: emptyStringToNull(
          typeof payload.whatWeLearned === 'string' ? payload.whatWeLearned : null,
        ),
        improvementAreas,
        recommendedService: emptyStringToNull(
          typeof payload.recommendedService === 'string' ? payload.recommendedService : null,
        ),
        loggedBy: emptyStringToNull(typeof payload.loggedBy === 'string' ? payload.loggedBy : null),
        kv_double_encoded: parsed.doubleEncoded,
        ...(inferredFields.length > 0 ? { backfill_inferred_fields: inferredFields } : {}),
      },
      inferredFields,
    },
  };
}

export function canonicalOutcomeHash(record: NormalizedOutcome): string {
  return JSON.stringify({
    legacy_kv_key: record.legacyKvKey,
    submission: record.submissionLegacyKvKey,
    outcome_type: record.outcomeType,
    recorded_at: record.recordedAt,
    conversion_value: record.value.conversionValue ?? null,
  });
}
