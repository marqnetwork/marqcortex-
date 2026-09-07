/**
 * KV ↔ SQL reconciliation for the cortex analysis domain.
 *
 * ── WHY THIS DOMAIN DOES NOT USE THE SHARED RECONCILER ─────────────────────
 *
 * `domainReconciliation.ts` reconciles a domain whose relational row carries
 * `legacy_kv_key`: it asks whether a row is present and whether its fields
 * agree. `domain_scores` has no such column — it is addressed through its
 * submission, and one analysis becomes up to FOUR rows. "Is this analysis
 * migrated?" is therefore a question about a set of child rows, not about one
 * row's presence, and pretending otherwise would either miss a partially
 * written analysis or report every one of them as four separate records.
 *
 * What it DOES share is the comparator. The four pillars are a fixed, declared
 * set, so the per-analysis comparison is a flat projection of four numeric
 * fields — exactly what `storage/compare.ts` compares — and a divergence here
 * means what a divergence means everywhere else.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchesKeyFilter, RECONCILIATION_SAMPLE_SIZE } from './config.ts';
import { throwOnError } from './client.ts';
import { createKvReader } from './kvReader.ts';
import { persistReconciliationLog } from './reconciliation.ts';
import { deterministicSample, loadQuarantinedKeys } from './domainReconciliation.ts';
import { compareProjections } from '../storage/compare.ts';
import type { FieldSpec } from '../storage/contracts.ts';
import type { Projection } from '../storage/compare.ts';
import {
  CORTEX_ENTITY_PREFIX,
  canonicalCortexHash,
  isCortexEntityKey,
  isCortexQuarantined,
  normalizeCortexRecord,
  parseCortexKvRecord,
  type NormalizedCortexAnalysis,
} from './cortexNormalizer.ts';
import type { KvReader, RecordClassification, ReconciliationResult } from './types.ts';

/**
 * The pillars, as comparable fields.
 *
 * Declared rather than derived from whatever keys a record happens to carry,
 * for the reason `compareProjections` exists: a comparison that walked the keys
 * it found would silently stop checking a pillar the day a mapping dropped it.
 */
export const CORTEX_PILLAR_FIELDS: readonly FieldSpec[] = [
  { field: 'operations_execution', rule: 'numeric' },
  { field: 'revenue_growth', rule: 'numeric' },
  { field: 'systems_automation', rule: 'numeric' },
  { field: 'ai_readiness_governance', rule: 'numeric' },
];

function projectAnalysis(record: NormalizedCortexAnalysis): Projection {
  const projection: Record<string, unknown> = {};
  for (const score of record.domainScores) projection[score.domainKey] = score.score;
  return projection;
}

function projectRows(rows: readonly { domain_key: string; score: number }[]): Projection {
  const projection: Record<string, unknown> = {};
  for (const row of rows) projection[row.domain_key] = row.score;
  return projection;
}

export async function reconcileCortexDomain(
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

  /** Analyses that carry at least one pillar, by their submission's KV key. */
  const bySubmissionKey = new Map<string, NormalizedCortexAnalysis>();
  const sourceHashes: string[] = [];
  let sourceCount = 0;
  let cursor: string | null = null;

  for (;;) {
    const page = await reader.scanPrefix(CORTEX_ENTITY_PREFIX, cursor, batchSize);
    for (const record of page.records) {
      if (keyPrefixFilter && !matchesKeyFilter(record.key, keyPrefixFilter)) continue;
      if (!isCortexEntityKey(record.key)) {
        classifications.index_only += 1;
        continue;
      }
      sourceCount += 1;

      const result = normalizeCortexRecord(
        parseCortexKvRecord(record.key, record.rawValue),
        organizationId,
        record.key,
      );
      if (isCortexQuarantined(result)) {
        classifications.quarantined += 1;
        continue;
      }
      // An analysis with no pillar writes nothing, so it is not missing when
      // nothing is there. Counting it as migrated would make the report claim
      // work that never happened.
      if (result.record.domainScores.length === 0) {
        classifications.skipped += 1;
        continue;
      }
      if (bySubmissionKey.has(result.record.submissionLegacyKvKey)) {
        classifications.duplicate += 1;
        continue;
      }
      bySubmissionKey.set(result.record.submissionLegacyKvKey, result.record);
      classifications.migrated += 1;
      sourceHashes.push(canonicalCortexHash(result.record));
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  const quarantinedKeys = runId ? await loadQuarantinedKeys(client, runId) : new Set<string>();

  // ── The submissions these analyses belong to ─────────────────────────────
  const { data: submissionRows, error: submissionError } = await client
    .from('submissions')
    .select('id, legacy_kv_key')
    .eq('organization_id', organizationId)
    .not('legacy_kv_key', 'is', null)
    .is('deleted_at', null);
  throwOnError(submissionError, 'reconcileCortexDomain.submissions');

  const submissionIdByKey = new Map<string, string>();
  const submissionKeyById = new Map<string, string>();
  for (const row of (submissionRows ?? []) as unknown as Array<Record<string, unknown>>) {
    submissionIdByKey.set(row.legacy_kv_key as string, row.id as string);
    submissionKeyById.set(row.id as string, row.legacy_kv_key as string);
  }

  const { data: scoreRows, error: scoreError } = await client
    .from('domain_scores')
    .select('submission_id, domain_key, score')
    .eq('organization_id', organizationId);
  throwOnError(scoreError, 'reconcileCortexDomain.domainScores');

  const rowsBySubmissionKey = new Map<string, Array<{ domain_key: string; score: number }>>();
  for (const row of (scoreRows ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = submissionKeyById.get(row.submission_id as string);
    // A domain score whose submission is not in this organization's set is not
    // this reconciliation's business. It cannot be attributed to a KV analysis,
    // so counting it either way would be a guess.
    if (!key) continue;
    const bucket = rowsBySubmissionKey.get(key) ?? [];
    bucket.push({ domain_key: row.domain_key as string, score: row.score as number });
    rowsBySubmissionKey.set(key, bucket);
  }

  let missingCount = 0;
  let awaitingSubmission = 0;
  for (const [submissionKey, record] of bySubmissionKey) {
    if (quarantinedKeys.has(record.legacyKvKey)) continue;
    if (!submissionIdByKey.has(submissionKey)) {
      // The dependency, counted separately: this analysis is not missing
      // because the backfill failed, it is waiting for a domain that has not
      // run. An operator reading `missing` needs to know which of those it is.
      awaitingSubmission += 1;
      missingCount += 1;
      continue;
    }
    if (!rowsBySubmissionKey.has(submissionKey)) missingCount += 1;
  }

  let orphanCount = 0;
  for (const submissionKey of rowsBySubmissionKey.keys()) {
    if (!bySubmissionKey.has(submissionKey)) orphanCount += 1;
  }

  // ── The field-level check, over the declared pillars ─────────────────────
  const comparable = [...bySubmissionKey.keys()].filter((key) => rowsBySubmissionKey.has(key));
  const sample = deterministicSample(comparable, RECONCILIATION_SAMPLE_SIZE);
  let sampleMismatchCount = 0;
  const mismatchedFields: Record<string, number> = {};
  for (const submissionKey of sample) {
    const divergences = compareProjections(
      CORTEX_PILLAR_FIELDS,
      projectAnalysis(bySubmissionKey.get(submissionKey)!),
      projectRows(rowsBySubmissionKey.get(submissionKey)!),
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
      [...rowsBySubmissionKey.entries()]
        .map(([key, rows]) =>
          `${key}:${rows.map((row) => `${row.domain_key}=${row.score}`).sort().join(',')}`,
        )
        .sort()
        .join('|'),
    )
    .digest('hex');

  const classified =
    classifications.migrated +
    classifications.duplicate +
    classifications.quarantined +
    classifications.skipped;
  const unclassifiedCount = Math.max(0, sourceCount - classified);

  return {
    domain: 'cortex_analysis',
    sourceCount,
    targetCount: rowsBySubmissionKey.size,
    missingCount,
    duplicateCount: 0,
    orphanCount,
    mismatchCount: sampleMismatchCount,
    sampleSize: sample.length,
    sampleMismatchCount,
    checksumSource,
    checksumTarget,
    thresholdPassed: missingCount === 0 && sampleMismatchCount === 0 && unclassifiedCount === 0,
    classifications,
    unclassifiedCount,
    details: {
      quarantinedKeys: quarantinedKeys.size,
      awaitingSubmission,
      sampleStrategy: 'deterministic-even-spacing',
      mismatchedFields,
      domainScoreRows: (scoreRows ?? []).length,
    },
  };
}

export async function reconcileCortex(
  client: SupabaseClient,
  organizationId: string,
  batchSize: number,
  runId?: string,
  keyPrefixFilter?: string,
): Promise<ReconciliationResult> {
  const result = await reconcileCortexDomain(
    client,
    createKvReader(client, { keyPrefixFilter }),
    organizationId,
    batchSize,
    runId,
    keyPrefixFilter,
  );
  if (runId) await persistReconciliationLog(client, runId, result);
  return result;
}
