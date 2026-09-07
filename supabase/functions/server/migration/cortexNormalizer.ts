/**
 * Cortex analysis normalizer — Phase 2 for the `cortex:` domain.
 *
 * `MCV2-S5-KV-RELATIONAL-MAPPING.md` maps `cortex:{submissionId}` to
 * `diagnostic_scores` + `domain_scores`. The KV record is the stored output of
 * the `cortex.analysis` feature, with the provenance of the run that produced
 * it.
 *
 * ── THIS DOMAIN ENRICHES. IT NEVER OVERWRITES ──────────────────────────────
 *
 * `sub:{id}` and `cortex:{id}` both carry an `aiScore` and a `qualityScore`,
 * and they are not always the same number: the submission's are what the
 * console shows and what the capture route computed, the analysis's are what
 * the model returned on the run that produced this record.
 *
 * KV IS AUTHORITATIVE, AND `sub:` IS WHAT THE CONSOLE READS. So the submission
 * backfill's values stand, and this domain writes only what ONLY IT has: the
 * pillar heatmap as domain scores, the readiness band, and the provenance. A
 * cortex backfill that also wrote the scores would make the result depend on
 * which domain ran last, which is the worst property a migration can have.
 *
 * ── TWO DECISIONS THE MAPPING DOCUMENT DOES NOT MAKE ───────────────────────
 *
 * THE HEATMAP IS 0–5 AND `domain_scores.score` IS 0–100. Storing 4 in a column
 * constrained to a percentage would read as "4%" to every consumer that assumes
 * the column means what it says. So the value is SCALED to the column's own
 * scale, and the original is recorded in the row's `metadata` — the
 * transformation is then auditable and nothing is lost. Storing the raw value
 * and hoping readers know better is how a dashboard ends up showing a
 * four-percent operations score.
 *
 * THE READINESS SCORE IS A BAND, NOT A NUMBER. `readinessScore` is `Low`,
 * `Medium` or `High`; `diagnostic_scores.readiness_score` is an INTEGER. This
 * normalizer DOES NOT invent one. Mapping Low/Medium/High onto 25/50/75 would
 * put three numbers in a database that no model ever produced, and every
 * consumer downstream would treat them as measured. The band is recorded in
 * `diagnostic_scores.metadata` where it is what it is, and the integer column
 * is left alone until something actually measures it.
 */

import { emptyStringToNull, parseKvRecord } from './parseJson.ts';
import type { ParsedKvRecord } from './types.ts';

export const CORTEX_ENTITY_PREFIX = 'cortex:';

export const MIGRATION_NAME_CORTEX = 'cortex_analysis_v1';

export function isCortexEntityKey(key: string): boolean {
  return key.startsWith(CORTEX_ENTITY_PREFIX);
}

/** `cortex:<submissionId>` → `<submissionId>`. */
export function submissionIdFromCortexKey(key: string): string | undefined {
  if (!isCortexEntityKey(key)) return undefined;
  const id = key.slice(CORTEX_ENTITY_PREFIX.length).trim();
  return id === '' ? undefined : id;
}

/** The scale the pillar heatmap is authored on. */
export const HEATMAP_MAX = 5;
/** The scale `domain_scores.score` is constrained to. */
export const DOMAIN_SCORE_MAX = 100;

/**
 * The pillars, and the `domain_key` each becomes.
 *
 * A declared table rather than a camel-case-to-snake-case rule, because
 * `domain_key` is a stable identifier other things will join on and deriving it
 * from a field name would let a rename in the feature contract silently
 * re-key every historical row.
 */
const PILLAR_KEYS: Readonly<Record<string, string>> = {
  operationsExecution: 'operations_execution',
  revenueGrowth: 'revenue_growth',
  systemsAutomation: 'systems_automation',
  aiReadinessGovernance: 'ai_readiness_governance',
};

export interface NormalizedDomainScore {
  domainKey: string;
  /** On the column's 0–100 scale. */
  score: number;
  /** The value as the analysis authored it, on its own 0–5 scale. */
  sourceValue: number;
}

export interface NormalizedCortexAnalysis {
  legacyKvKey: string;
  submissionLegacyKvKey: string;
  organizationId: string;
  domainScores: readonly NormalizedDomainScore[];
  /**
   * What is merged into `diagnostic_scores.metadata`. Bands and provenance —
   * never a number the analysis did not produce.
   */
  scoreMetadata: Record<string, unknown>;
  inferredFields: readonly string[];
}

export type CortexNormalizationResult =
  | { ok: true; record: NormalizedCortexAnalysis; classification: 'migrated' }
  | { ok: false; reasonCode: string; reasonDetail: string; classification: 'quarantined' };

export function isCortexQuarantined(
  result: CortexNormalizationResult,
): result is Extract<CortexNormalizationResult, { ok: false }> {
  return !result.ok;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * One pillar value, scaled onto the column's range.
 *
 * Rounds to the nearest integer, because the column is INTEGER and a value the
 * database would refuse is worse than one rounded by a rule stated here. A
 * value outside 0–5 is dropped rather than clamped: clamping would record a
 * measurement that was never made, and the pillar simply having no row is the
 * truthful answer.
 */
export function scalePillar(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > HEATMAP_MAX) return null;
  return Math.round((parsed / HEATMAP_MAX) * DOMAIN_SCORE_MAX);
}

export function parseCortexKvRecord(key: string, rawValue: unknown): ParsedKvRecord<Record<string, unknown>> {
  return parseKvRecord<Record<string, unknown>>(key, rawValue);
}

export function normalizeCortexRecord(
  parsed: ParsedKvRecord<Record<string, unknown>>,
  organizationId: string,
  sourceKey: string,
): CortexNormalizationResult {
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
      reasonDetail: 'Cortex analysis payload is not an object',
      classification: 'quarantined',
    };
  }

  const submissionId = submissionIdFromCortexKey(sourceKey);
  if (!submissionId) {
    return {
      ok: false,
      reasonCode: 'UNADDRESSABLE_KEY',
      reasonDetail: `Cannot derive a submission id from ${sourceKey}`,
      classification: 'quarantined',
    };
  }

  const inferredFields: string[] = [];
  const heatmap = asRecord(payload.pillarHeatmap) ?? {};
  const domainScores: NormalizedDomainScore[] = [];

  for (const [field, domainKey] of Object.entries(PILLAR_KEYS)) {
    const raw = heatmap[field];
    if (raw === undefined || raw === null) {
      inferredFields.push(`${domainKey}_absent`);
      continue;
    }
    const score = scalePillar(raw);
    if (score === null) {
      // Out of range, or not a number at all. No row, and the fact is named on
      // the record rather than becoming a clamped measurement.
      inferredFields.push(`${domainKey}_out_of_range`);
      continue;
    }
    domainScores.push({ domainKey, score, sourceValue: Number(raw) });
  }

  // A record that produced no pillar at all carries nothing this domain exists
  // to write. It is not malformed — the analysis may genuinely have failed —
  // so it is SKIPPED rather than quarantined, and the reason is on the record.
  const scoreMetadata: Record<string, unknown> = {
    cortex_readiness_band: emptyStringToNull(
      typeof payload.readinessScore === 'string' ? payload.readinessScore : null,
    ),
    cortex_confidence_band: emptyStringToNull(
      typeof payload.confidenceScore === 'string' ? payload.confidenceScore : null,
    ),
    cortex_analyzed_at: emptyStringToNull(
      typeof payload.analyzedAt === 'string' ? payload.analyzedAt : null,
    ),
    // Provenance, so a stored analysis can be traced to the run that produced
    // it. `aiRoutes.runCortexAnalysis` records these for exactly this reason.
    cortex_model: emptyStringToNull(typeof payload.model === 'string' ? payload.model : null),
    cortex_provider: emptyStringToNull(
      typeof payload.provider === 'string' ? payload.provider : null,
    ),
    cortex_prompt_version: emptyStringToNull(
      typeof payload.promptVersion === 'string' ? payload.promptVersion : null,
    ),
    cortex_request_id: emptyStringToNull(
      typeof payload.requestId === 'string' ? payload.requestId : null,
    ),
    cortex_kv_double_encoded: parsed.doubleEncoded,
    ...(inferredFields.length > 0 ? { backfill_inferred_fields: inferredFields } : {}),
  };

  return {
    ok: true,
    classification: 'migrated',
    record: {
      legacyKvKey: sourceKey,
      submissionLegacyKvKey: `sub:${submissionId}`,
      organizationId,
      domainScores,
      scoreMetadata,
      inferredFields,
    },
  };
}

/** The canonical hash of a normalized analysis, for reconciliation. */
export function canonicalCortexHash(record: NormalizedCortexAnalysis): string {
  return JSON.stringify({
    legacy_kv_key: record.legacyKvKey,
    submission: record.submissionLegacyKvKey,
    domain_scores: [...record.domainScores]
      .map((entry) => `${entry.domainKey}:${entry.score}`)
      .sort(),
    readiness_band: record.scoreMetadata.cortex_readiness_band ?? null,
  });
}
