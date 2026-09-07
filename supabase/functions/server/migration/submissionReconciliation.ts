/**
 * KV ↔ SQL reconciliation for the submission domain.
 *
 * ── THE FIELD-LEVEL CHECK IS THE POINT, AND IT REUSES THE SHADOW READ ──────
 *
 * `MCV2-S5-KV-RELATIONAL-MAPPING.md` asks for a "field-level hash on 100 random
 * subs" for this domain. Counting rows proves that a backfill wrote SOMETHING
 * for every KV record; only a field comparison proves it wrote the RIGHT thing,
 * and the difference between those two is every mapping bug that has ever
 * survived a green migration report.
 *
 * So the comparison is made with `storage/compare.ts` and
 * `storage/submissionProjection.ts` — the SAME comparator and the SAME
 * projection the runtime shadow read uses. That is deliberate and is the whole
 * design:
 *
 *   A reconciliation that agreed and a shadow read that disagreed would send an
 *   operator hunting for a difference between two stores when the real
 *   difference was between two comparators. One comparator cannot disagree with
 *   itself, so a divergence reported here and a divergence reported at runtime
 *   are the same claim about the same fields under the same rules.
 *
 * ── THE SAMPLE IS DETERMINISTIC, NOT RANDOM ────────────────────────────────
 *
 * The mapping document says "random". Deterministic is better and the
 * difference matters: a reconciliation is run, a fix is made, and it is run
 * again to see whether the fix worked. With a random sample the second run
 * inspects different records, so an unchanged mismatch count means nothing and
 * a changed one means less. The sample here is an evenly spaced walk over the
 * sorted key list, so it covers the whole range, is reproducible across runs,
 * and moves only when the data does.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchesKeyFilter, RECONCILIATION_SAMPLE_SIZE } from './config.ts';
import { throwOnError } from './client.ts';
import {
  SUBMISSION_ENTITY_PREFIX,
  canonicalSubmissionHash,
  isQuarantined,
  isSubmissionEntityKey,
  normalizeSubmissionRecord,
  parseSubmissionKvRecord,
  type NormalizedSubmission,
} from './submissionNormalizer.ts';
import { compareProjections } from '../storage/compare.ts';
import {
  SUBMISSION_FIELDS,
  projectSqlSubmission,
} from '../storage/submissionProjection.ts';
import type { KvReader, RecordClassification, ReconciliationResult } from './types.ts';

/** The KV side of a normalized submission, as the shared comparator wants it. */
function projectNormalized(record: NormalizedSubmission): Record<string, unknown> {
  return {
    legacyId: record.legacyId,
    companyName: record.companyName,
    contactName: record.contactName,
    contactEmail: record.contactEmail,
    phone: record.phone,
    website: record.website,
    industry: record.industry,
    status: record.status,
    priority: record.priority,
    completionScore: record.scores.completionScore,
    qualityScore: record.scores.qualityScore,
    aiScore: record.scores.aiScore,
    submittedAt: record.submittedAt,
  };
}

/**
 * Up to `size` keys, evenly spaced across the sorted list.
 *
 * Exported because the sampling rule is a claim the suite has to be able to
 * check: a sample that silently degenerated to "the first hundred" would report
 * the oldest records as representative of the estate.
 */
export function deterministicSample(keys: readonly string[], size: number): readonly string[] {
  const sorted = [...keys].sort();
  if (sorted.length <= size) return sorted;
  const step = sorted.length / size;
  const picked: string[] = [];
  for (let index = 0; index < size; index += 1) {
    picked.push(sorted[Math.floor(index * step)]);
  }
  return picked;
}

export async function reconcileSubmissionsDomain(
  client: SupabaseClient,
  reader: KvReader,
  organizationId: string,
  batchSize: number,
  runId?: string,
  keyPrefixFilter?: string,
): Promise<ReconciliationResult> {
  const classifications: Record<RecordClassification, number> = {
    migrated: 0,
    duplicate: 0,
    index_only: 0,
    quarantined: 0,
    skipped: 0,
  };

  /** Every KV entity key that normalized, with the record it produced. */
  const normalized = new Map<string, NormalizedSubmission>();
  const sourceKeys = new Set<string>();
  const sourceHashes: string[] = [];
  let sourceCount = 0;
  let cursor: string | null = null;

  for (;;) {
    const page = await reader.scanPrefix(SUBMISSION_ENTITY_PREFIX, cursor, batchSize);
    for (const record of page.records) {
      if (keyPrefixFilter && !matchesKeyFilter(record.key, keyPrefixFilter)) continue;
      if (!isSubmissionEntityKey(record.key)) {
        classifications.index_only += 1;
        continue;
      }
      sourceCount += 1;
      sourceKeys.add(record.key);

      const result = normalizeSubmissionRecord(
        parseSubmissionKvRecord(record.key, record.rawValue),
        organizationId,
        record.key,
      );
      if (isQuarantined(result)) {
        classifications.quarantined += 1;
        continue;
      }
      // A KV key that appears twice in one scan is impossible — keys are
      // unique — so `duplicate` here would mean the reader returned a page
      // twice, which is a reader bug rather than a data one.
      if (normalized.has(record.key)) {
        classifications.duplicate += 1;
        continue;
      }
      normalized.set(record.key, result.record);
      classifications.migrated += 1;
      sourceHashes.push(canonicalSubmissionHash(result.record));
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  const quarantinedKeys = runId ? await loadQuarantinedKeys(client, runId) : new Set<string>();

  // ── The relational side ───────────────────────────────────────────────────
  const { data: rows, error } = await client
    .from('submissions')
    .select(
      'legacy_kv_key, legacy_id, company_name, contact_name, contact_email, phone, ' +
        'website, industry, status, priority, completion_score, quality_score, ai_score, submitted_at',
    )
    .eq('organization_id', organizationId)
    .not('legacy_kv_key', 'is', null)
    .is('deleted_at', null);
  throwOnError(error, 'reconcileSubmissionsDomain.targetRows');

  const byKey = new Map<string, Record<string, unknown>>();
  // Through `unknown` because the client's generated row type for a
  // hand-written column list is not one this repository declares. The shape is
  // asserted by the column list two statements above, which is the only place
  // it is stated.
  for (const row of (rows ?? []) as unknown as Array<Record<string, unknown>>) {
    byKey.set(row.legacy_kv_key as string, row);
  }

  // MISSING is asked only of records that SHOULD be there: a quarantined
  // record was deliberately not written, and counting it as missing would make
  // every reconciliation of a real estate fail for doing the right thing.
  let missingCount = 0;
  for (const key of normalized.keys()) {
    if (quarantinedKeys.has(key)) continue;
    if (!byKey.has(key)) missingCount += 1;
  }

  // ORPHAN is the mirror: a relational row whose KV record is gone. It is not a
  // backfill failure — KV may legitimately have moved on — but it is the number
  // that says a cutover would serve a record the authoritative store no longer
  // has.
  let orphanCount = 0;
  for (const key of byKey.keys()) {
    if (!sourceKeys.has(key)) orphanCount += 1;
  }

  // ── The field-level check ────────────────────────────────────────────────
  const sample = deterministicSample(
    [...normalized.keys()].filter((key) => byKey.has(key)),
    RECONCILIATION_SAMPLE_SIZE,
  );
  let sampleMismatchCount = 0;
  const mismatchedFields: Record<string, number> = {};
  for (const key of sample) {
    const divergences = compareProjections(
      SUBMISSION_FIELDS,
      projectNormalized(normalized.get(key)!),
      projectSqlSubmission(byKey.get(key)!),
    );
    if (divergences.length === 0) continue;
    sampleMismatchCount += 1;
    for (const divergence of divergences) {
      mismatchedFields[divergence.field] = (mismatchedFields[divergence.field] ?? 0) + 1;
    }
  }

  const checksumSource = createHash('sha256').update(sourceHashes.sort().join('|')).digest('hex');
  const checksumTarget = createHash('sha256')
    .update(
      [...byKey.entries()]
        .map(([key, row]) => `${key}:${row.contact_email}:${row.status}`)
        .sort()
        .join('|'),
    )
    .digest('hex');

  const classified =
    classifications.migrated +
    classifications.duplicate +
    classifications.quarantined +
    classifications.index_only +
    classifications.skipped;
  const unclassifiedCount = Math.max(0, sourceCount - classified + classifications.index_only);

  return {
    domain: 'submissions',
    sourceCount,
    targetCount: byKey.size,
    missingCount,
    // The relational `legacy_kv_key` unique index makes a duplicate target row
    // impossible, so this is zero by construction rather than by measurement —
    // and `test:database:diagnostic` SB-2 is what proves the index is there.
    duplicateCount: 0,
    orphanCount,
    mismatchCount: sampleMismatchCount,
    sampleSize: sample.length,
    sampleMismatchCount,
    checksumSource,
    checksumTarget,
    // A field mismatch fails the threshold. That is the difference between this
    // reconciliation and a count-only one: a backfill that wrote a row for every
    // record and got the status wrong on all of them passes a count check.
    thresholdPassed: missingCount === 0 && sampleMismatchCount === 0 && unclassifiedCount === 0,
    classifications,
    unclassifiedCount,
    details: {
      sourceKeys: sourceKeys.size,
      quarantinedKeys: quarantinedKeys.size,
      sampleStrategy: 'deterministic-even-spacing',
      mismatchedFields,
    },
  };
}

async function loadQuarantinedKeys(client: SupabaseClient, runId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from('migration_quarantine')
    .select('source_key')
    .eq('run_id', runId);
  throwOnError(error, 'reconcileSubmissionsDomain.quarantinedKeys');
  return new Set((data ?? []).map((row) => row.source_key as string));
}
