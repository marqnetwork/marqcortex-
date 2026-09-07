/**
 * KV ↔ SQL reconciliation, for any domain whose relational row carries
 * `legacy_kv_key`.
 *
 * ── WHY THIS IS GENERIC AND THE CORTEX ONE IS NOT ──────────────────────────
 *
 * Submissions and outcomes reconcile identically: scan the KV prefix, normalize
 * what is there, load the relational rows by `legacy_kv_key`, and ask three
 * questions — what is missing, what is orphaned, and do the fields of a sample
 * agree. Only the projections and the field set differ, so the questions are
 * asked once and the domain supplies the answers' vocabulary.
 *
 * The cortex domain does NOT fit: `domain_scores` has no `legacy_kv_key` — it is
 * addressed through its submission, and "is this analysis migrated?" is a
 * question about a set of child rows rather than about one row's presence. It
 * has its own reconciler for that reason, not because copying was easier.
 *
 * The COMPARATOR is `storage/compare.ts` in every case, so a divergence means
 * the same thing in every domain and at runtime.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchesKeyFilter, RECONCILIATION_SAMPLE_SIZE } from './config.ts';
import { throwOnError } from './client.ts';
import { compareProjections } from '../storage/compare.ts';
import type { FieldSpec } from '../storage/contracts.ts';
import type { Projection } from '../storage/compare.ts';
import type { KvReader, RecordClassification, ReconciliationResult } from './types.ts';

/**
 * Up to `size` keys, evenly spaced across the sorted list.
 *
 * Deterministic rather than random, and the difference matters: a
 * reconciliation is run, a fix is made, and it is run again to see whether the
 * fix worked. With a random sample the second run inspects different records,
 * so an unchanged mismatch count means nothing and a changed one means less.
 *
 * A sample that degenerated to "the first n" would report the oldest records as
 * representative of the estate, so the walk is spaced across the whole range.
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

export interface ReconcilableDomain<TRecord> {
  /** The domain name that appears on the report and in the log table. */
  readonly domain: string;
  readonly entityPrefix: string;
  /** False for a key that shares the prefix but is an index, not an entity. */
  isEntityKey(key: string): boolean;
  /** `null` when the record could not be normalized — a quarantine, not a loss. */
  normalize(key: string, rawValue: unknown, organizationId: string): TRecord | null;
  /** The relational table whose rows carry `legacy_kv_key`. */
  readonly table: string;
  /** The columns the projection needs, as a PostgREST select list. */
  readonly selectColumns: string;
  readonly fields: readonly FieldSpec[];
  projectKv(record: TRecord): Projection;
  projectSql(row: unknown): Projection;
  /** A stable hash of the normalized record, for the source checksum. */
  hash(record: TRecord): string;
  /** One line of the target checksum. */
  targetFingerprint(row: Record<string, unknown>): string;
}

export async function reconcileByLegacyKey<TRecord>(
  client: SupabaseClient,
  reader: KvReader,
  domain: ReconcilableDomain<TRecord>,
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

  const normalized = new Map<string, TRecord>();
  const sourceKeys = new Set<string>();
  const sourceHashes: string[] = [];
  let sourceCount = 0;
  let cursor: string | null = null;

  for (;;) {
    const page = await reader.scanPrefix(domain.entityPrefix, cursor, batchSize);
    for (const record of page.records) {
      if (keyPrefixFilter && !matchesKeyFilter(record.key, keyPrefixFilter)) continue;
      if (!domain.isEntityKey(record.key)) {
        classifications.index_only += 1;
        continue;
      }
      sourceCount += 1;
      sourceKeys.add(record.key);

      const result = domain.normalize(record.key, record.rawValue, organizationId);
      if (result === null) {
        classifications.quarantined += 1;
        continue;
      }
      if (normalized.has(record.key)) {
        classifications.duplicate += 1;
        continue;
      }
      normalized.set(record.key, result);
      classifications.migrated += 1;
      sourceHashes.push(domain.hash(result));
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  const quarantinedKeys = runId ? await loadQuarantinedKeys(client, runId) : new Set<string>();

  const { data: rows, error } = await client
    .from(domain.table)
    .select(domain.selectColumns)
    .eq('organization_id', organizationId)
    .not('legacy_kv_key', 'is', null)
    .is('deleted_at', null);
  throwOnError(error, `reconcile.${domain.domain}.targetRows`);

  const byKey = new Map<string, Record<string, unknown>>();
  // Through `unknown` because the client's generated row type for a
  // hand-written column list is not one this repository declares. The shape is
  // stated by `selectColumns`, which is the only place it is stated.
  for (const row of (rows ?? []) as unknown as Array<Record<string, unknown>>) {
    byKey.set(row.legacy_kv_key as string, row);
  }

  // MISSING is asked only of records that SHOULD be there: a quarantined record
  // was deliberately not written, and counting it as missing would make every
  // reconciliation of a real estate fail for doing the right thing.
  let missingCount = 0;
  for (const key of normalized.keys()) {
    if (quarantinedKeys.has(key)) continue;
    if (!byKey.has(key)) missingCount += 1;
  }

  // ORPHAN is the mirror: a relational row whose KV record is gone. Not a
  // backfill failure — KV may legitimately have moved on — but the number that
  // says a cutover would serve a record the authoritative store no longer has.
  let orphanCount = 0;
  for (const key of byKey.keys()) {
    if (!sourceKeys.has(key)) orphanCount += 1;
  }

  const sample = deterministicSample(
    [...normalized.keys()].filter((key) => byKey.has(key)),
    RECONCILIATION_SAMPLE_SIZE,
  );
  let sampleMismatchCount = 0;
  const mismatchedFields: Record<string, number> = {};
  for (const key of sample) {
    const divergences = compareProjections(
      domain.fields,
      domain.projectKv(normalized.get(key)!),
      domain.projectSql(byKey.get(key)!),
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
      [...byKey.values()]
        .map((row) => domain.targetFingerprint(row))
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
    domain: domain.domain,
    sourceCount,
    targetCount: byKey.size,
    missingCount,
    // The relational `legacy_kv_key` unique index makes a duplicate target row
    // impossible, so this is zero by construction rather than by measurement.
    duplicateCount: 0,
    orphanCount,
    mismatchCount: sampleMismatchCount,
    sampleSize: sample.length,
    sampleMismatchCount,
    checksumSource,
    checksumTarget,
    // A FIELD mismatch fails the threshold. That is the difference between this
    // and a count-only reconciliation: a backfill that wrote a row for every
    // record and got a field wrong on all of them passes a count check.
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

export async function loadQuarantinedKeys(
  client: SupabaseClient,
  runId: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('migration_quarantine')
    .select('source_key')
    .eq('run_id', runId);
  throwOnError(error, 'reconcile.quarantinedKeys');
  return new Set((data ?? []).map((row) => row.source_key as string));
}
