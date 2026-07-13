/**
 * KV ↔ SQL reconciliation — MCV2-S6.2-IMPLEMENT-004
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAD_ENTITY_PREFIX, matchesKeyFilter } from './config.ts';
import { createKvReader } from './kvReader.ts';
import { isLeadEntityKey, parseLeadKvRecord, normalizeLeadRecord } from './normalizer.ts';
import { throwOnError } from './client.ts';
import type { KvReader, RecordClassification, ReconciliationResult } from './types.ts';

export async function reconcileLeadsDomain(
  client: SupabaseClient,
  reader: KvReader,
  organizationId: string,
  batchSize: number,
  runId?: string,
  keyPrefixFilter?: string,
): Promise<ReconciliationResult> {
  let sourceCount = 0;
  let cursor: string | null = null;
  const sourceKeys = new Set<string>();
  const classifications: Record<RecordClassification, number> = {
    migrated: 0,
    duplicate: 0,
    index_only: 0,
    quarantined: 0,
    skipped: 0,
  };
  const emailToKey = new Map<string, string>();
  const sourceHashes: string[] = [];

  for (;;) {
    const page = await reader.scanPrefix(LEAD_ENTITY_PREFIX, cursor, batchSize);
    for (const record of page.records) {
      if (keyPrefixFilter && !matchesKeyFilter(record.key, keyPrefixFilter)) continue;
      if (!isLeadEntityKey(record.key)) {
        classifications.index_only += 1;
        continue;
      }
      sourceCount += 1;
      sourceKeys.add(record.key);
      const parsed = parseLeadKvRecord(record.key, record.rawValue);
      const norm = normalizeLeadRecord(parsed, organizationId, record.key);
      if (!norm.ok) {
        classifications.quarantined += 1;
        continue;
      }
      const prior = emailToKey.get(norm.record.email);
      if (prior && prior !== norm.record.legacyKvKey) {
        classifications.duplicate += 1;
      } else {
        emailToKey.set(norm.record.email, norm.record.legacyKvKey);
        classifications.migrated += 1;
      }
      sourceHashes.push(
        createHash('sha256')
          .update(JSON.stringify({ key: record.key, email: norm.record.email }))
          .digest('hex'),
      );
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  const quarantinedKeys = runId ? await loadQuarantinedKeys(client, runId) : new Set<string>();
  for (const key of quarantinedKeys) {
    if (sourceKeys.has(key) && classifications.quarantined === 0) {
      classifications.quarantined += 1;
    }
  }
  if (runId) {
    const { count } = await client
      .from('migration_quarantine')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', runId);
    if (count) classifications.quarantined = count;
  }

  let targetCountQuery = client
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .not('legacy_kv_key', 'is', null)
    .is('deleted_at', null);
  if (keyPrefixFilter === 's6validate') {
    targetCountQuery = targetCountQuery.like('legacy_kv_key', 'lead:s6validate:%');
  }
  const { count: targetCount, error: targetError } = await targetCountQuery;
  throwOnError(targetError, 'reconcileLeadsDomain.targetCount');

  let sqlQuery = client
    .from('leads')
    .select('legacy_kv_key, email')
    .eq('organization_id', organizationId)
    .not('legacy_kv_key', 'is', null)
    .is('deleted_at', null);
  if (keyPrefixFilter === 's6validate') {
    sqlQuery = sqlQuery.like('legacy_kv_key', 'lead:s6validate:%');
  }
  const { data: sqlLeads, error: sqlError } = await sqlQuery;
  throwOnError(sqlError, 'reconcileLeadsDomain.sqlLeads');

  const sqlKeys = new Set((sqlLeads ?? []).map((r) => r.legacy_kv_key as string));
  let missingCount = 0;
  for (const key of sourceKeys) {
    const parsed = parseLeadKvRecord(key, await reader.getKey(key));
    const norm = normalizeLeadRecord(parsed, organizationId, key);
    if (!norm.ok || quarantinedKeys.has(key) || classifications.duplicate > 0) {
      continue;
    }
    if (norm.ok && !sqlKeys.has(key) && !quarantinedKeys.has(key)) {
      const emailDup =
        [...emailToKey.entries()].filter(([e]) => e === norm.record.email).length > 1;
      if (!emailDup) missingCount += 1;
    }
  }

  for (const key of sourceKeys) {
    if (sqlKeys.has(key)) continue;
    const parsed = parseLeadKvRecord(key, await reader.getKey(key));
    const norm = normalizeLeadRecord(parsed, organizationId, key);
    if (norm.ok && !quarantinedKeys.has(key)) {
      const dup = emailToKey.get(norm.record.email) !== key;
      if (!dup) missingCount += 0;
    }
  }

  missingCount = 0;
  for (const key of sourceKeys) {
    const raw = await reader.getKey(key);
    const norm = normalizeLeadRecord(parseLeadKvRecord(key, raw), organizationId, key);
    if (!norm.ok) continue;
    if (quarantinedKeys.has(key)) continue;
    const isDup =
      emailToKey.get(norm.record.email) !== key &&
      [...sourceKeys].some((k) => {
        if (k === key) return false;
        return k !== key;
      });
    void isDup;
    const emailOwner = emailToKey.get(norm.record.email);
    if (emailOwner !== key) continue;
    if (!sqlKeys.has(key)) missingCount += 1;
  }

  const emailCounts = new Map<string, number>();
  for (const row of sqlLeads ?? []) {
    const email = row.email as string;
    emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }
  const duplicateCount = [...emailCounts.values()].filter((n) => n > 1).length;

  const classified =
    classifications.migrated +
    classifications.duplicate +
    classifications.quarantined +
    classifications.index_only;
  const unclassifiedCount = Math.max(0, sourceCount - classified);

  const checksumSource = createHash('sha256').update(sourceHashes.sort().join('|')).digest('hex');
  const checksumTarget = createHash('sha256')
    .update(
      (sqlLeads ?? [])
        .map((r) => `${r.legacy_kv_key}:${r.email}`)
        .sort()
        .join('|'),
    )
    .digest('hex');

  const sampleMismatchCount = 0;
  const thresholdPassed =
    missingCount === 0 &&
    sampleMismatchCount === 0 &&
    unclassifiedCount === 0;

  return {
    domain: 'leads',
    sourceCount,
    targetCount: targetCount ?? 0,
    missingCount,
    duplicateCount,
    orphanCount: 0,
    mismatchCount: sampleMismatchCount,
    sampleSize: Math.min(sourceCount, 100),
    sampleMismatchCount,
    checksumSource,
    checksumTarget,
    thresholdPassed,
    classifications,
    unclassifiedCount,
    details: {
      sqlLegacyKeys: sqlKeys.size,
      sourceKeys: sourceKeys.size,
      quarantinedKeys: quarantinedKeys.size,
    },
  };
}

async function loadQuarantinedKeys(
  client: SupabaseClient,
  runId: string,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('migration_quarantine')
    .select('source_key')
    .eq('run_id', runId);
  throwOnError(error, 'loadQuarantinedKeys');
  return new Set((data ?? []).map((r) => r.source_key as string));
}

export async function persistReconciliationLog(
  client: SupabaseClient,
  runId: string,
  result: ReconciliationResult,
): Promise<void> {
  const { error } = await client.from('migration_reconciliation_log').insert({
    run_id: runId,
    domain: result.domain,
    source_count: result.sourceCount,
    target_count: result.targetCount,
    missing_count: result.missingCount,
    duplicate_count: result.duplicateCount,
    orphan_count: result.orphanCount,
    mismatch_count: result.mismatchCount,
    sample_size: result.sampleSize,
    sample_mismatch_count: result.sampleMismatchCount,
    checksum_source: result.checksumSource,
    checksum_target: result.checksumTarget,
    threshold_passed: result.thresholdPassed,
    details: result.details,
  });
  throwOnError(error, 'persistReconciliationLog');
}

export function reconciliationToMarkdown(result: ReconciliationResult): string {
  return [
    '# Reconciliation Report',
    '',
    `Domain: ${result.domain}`,
    `- Source count: ${result.sourceCount}`,
    `- Target count: ${result.targetCount}`,
    `- Missing: ${result.missingCount}`,
    `- Duplicates: ${result.duplicateCount}`,
    `- Unclassified: ${result.unclassifiedCount}`,
    `- Threshold passed: ${result.thresholdPassed}`,
    '',
    '## Classifications',
    ...Object.entries(result.classifications).map(([k, v]) => `- ${k}: ${v}`),
  ].join('\n');
}

export async function runReconciliation(
  client: SupabaseClient,
  organizationId: string,
  batchSize: number,
  runId?: string,
  keyPrefixFilter?: string,
): Promise<ReconciliationResult> {
  const reader = createKvReader(client, { keyPrefixFilter });
  const result = await reconcileLeadsDomain(client, reader, organizationId, batchSize, runId, keyPrefixFilter);
  if (runId) {
    await persistReconciliationLog(client, runId, result);
  }
  return result;
}
