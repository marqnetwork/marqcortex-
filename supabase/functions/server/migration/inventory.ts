/**
 * KV inventory mode — MCV2-S6.2-IMPLEMENT-004 (read-only)
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LEAD_EMAIL_INDEX_PREFIX, LEAD_ENTITY_PREFIX, LEAD_NAMESPACES, matchesKeyFilter } from './config.ts';
import { createKvReader } from './kvReader.ts';
import { isLeadEntityKey, isLeadEmailIndexKey, parseLeadKvRecord, extractEmailFromIndexKey } from './normalizer.ts';
import { normalizeEmail, safeJsonParse } from './parseJson.ts';
import type { InventoryReport, KvReader, NamespaceInventory } from './types.ts';

export async function scanNamespaceInventory(
  reader: KvReader,
  prefix: string,
  batchSize: number,
): Promise<NamespaceInventory> {
  let cursor: string | null = null;
  let totalCount = 0;
  let malformedCount = 0;
  let doubleEncodedCount = 0;
  let missingRequiredCount = 0;
  const sampleKeys: string[] = [];

  for (;;) {
    const page = await reader.scanPrefix(prefix, cursor, batchSize);
    for (const record of page.records) {
      totalCount += 1;
      if (sampleKeys.length < 5) sampleKeys.push(record.key);

      if (prefix === LEAD_ENTITY_PREFIX) {
        const parsed = parseLeadKvRecord(record.key, record.rawValue);
        if (parsed.parseError) malformedCount += 1;
        if (parsed.doubleEncoded) doubleEncodedCount += 1;
        if (!normalizeEmail(parsed.parsed?.email)) missingRequiredCount += 1;
      } else if (prefix === LEAD_EMAIL_INDEX_PREFIX) {
        const { error } = safeJsonParse(record.rawValue);
        if (typeof record.rawValue === 'object' && record.rawValue !== null) {
          malformedCount += 1;
        } else if (error && typeof record.rawValue !== 'string') {
          malformedCount += 1;
        }
      } else {
        const { error, doubleEncoded } = safeJsonParse(record.rawValue);
        if (error) malformedCount += 1;
        if (doubleEncoded) doubleEncodedCount += 1;
      }
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  return {
    prefix,
    totalCount,
    malformedCount,
    doubleEncodedCount,
    missingRequiredCount,
    sampleKeys,
  };
}

export async function buildInventoryReport(
  reader: KvReader,
  batchSize: number,
  keyPrefixFilter?: string,
): Promise<InventoryReport> {
  const namespaces: Record<string, NamespaceInventory> = {};
  for (const prefix of LEAD_NAMESPACES) {
    namespaces[prefix] = await scanNamespaceInventory(reader, prefix, batchSize);
  }

  const duplicateEmails: string[] = [];
  const orphanedLeadEmailMappings: string[] = [];
  const indexOnlyRecords: string[] = [];
  const emailToLeadIds = new Map<string, Set<string>>();

  let cursor: string | null = null;
  for (;;) {
    const page = await reader.scanPrefix(LEAD_ENTITY_PREFIX, cursor, batchSize);
    for (const record of page.records) {
      if (keyPrefixFilter && !matchesKeyFilter(record.key, keyPrefixFilter)) continue;
      if (!isLeadEntityKey(record.key)) continue;
      const parsed = parseLeadKvRecord(record.key, record.rawValue);
      const email = normalizeEmail(parsed.parsed?.email);
      if (!email) continue;
      const set = emailToLeadIds.get(email) ?? new Set<string>();
      set.add(record.key);
      emailToLeadIds.set(email, set);
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  for (const [email, keys] of emailToLeadIds) {
    if (keys.size > 1) duplicateEmails.push(email);
  }

  cursor = null;
  for (;;) {
    const page = await reader.scanPrefix(LEAD_EMAIL_INDEX_PREFIX, cursor, batchSize);
    for (const record of page.records) {
      if (keyPrefixFilter && !matchesKeyFilter(record.key, keyPrefixFilter)) continue;
      if (!isLeadEmailIndexKey(record.key)) continue;
      indexOnlyRecords.push(record.key);
      const email = extractEmailFromIndexKey(record.key);
      const leadId =
        typeof record.rawValue === 'string'
          ? record.rawValue
          : safeJsonParse(record.rawValue).parsed;
      const targetKey = typeof leadId === 'string' ? `lead:${leadId.replace(/^lead:/, '')}` : null;
      if (targetKey) {
        const leadExists = await reader.getKey(targetKey);
        if (leadExists === null) orphanedLeadEmailMappings.push(record.key);
      } else {
        orphanedLeadEmailMappings.push(record.key);
      }
      if (email && emailToLeadIds.has(email) && (emailToLeadIds.get(email)?.size ?? 0) > 1) {
        if (!duplicateEmails.includes(email)) duplicateEmails.push(email);
      }
    }
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  const summary = {
    totalRecords: Object.values(namespaces).reduce((n, ns) => n + ns.totalCount, 0),
    malformedCount: Object.values(namespaces).reduce((n, ns) => n + ns.malformedCount, 0),
    doubleEncodedCount: Object.values(namespaces).reduce((n, ns) => n + ns.doubleEncodedCount, 0),
    missingRequiredCount: Object.values(namespaces).reduce((n, ns) => n + ns.missingRequiredCount, 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    namespaces,
    duplicateEmails,
    orphanedLeadEmailMappings,
    indexOnlyRecords,
    summary,
  };
}

export function inventoryReportToMarkdown(report: InventoryReport): string {
  const lines = [
    '# KV Inventory Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Total records: ${report.summary.totalRecords}`,
    `- Malformed: ${report.summary.malformedCount}`,
    `- Double-encoded: ${report.summary.doubleEncodedCount}`,
    `- Missing required fields: ${report.summary.missingRequiredCount}`,
    `- Duplicate emails: ${report.duplicateEmails.length}`,
    `- Orphaned lead_email mappings: ${report.orphanedLeadEmailMappings.length}`,
    '',
    '## Namespaces',
    '',
  ];
  for (const ns of Object.values(report.namespaces)) {
    lines.push(`### ${ns.prefix}`);
    lines.push(`- Count: ${ns.totalCount}`);
    lines.push(`- Malformed: ${ns.malformedCount}`);
    lines.push(`- Double-encoded: ${ns.doubleEncodedCount}`);
    lines.push(`- Missing required: ${ns.missingRequiredCount}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function checksumInventory(report: InventoryReport): string {
  return createHash('sha256').update(JSON.stringify(report.summary)).digest('hex');
}

export async function runInventoryMode(
  client: SupabaseClient,
  batchSize: number,
): Promise<InventoryReport> {
  const reader = createKvReader(client);
  return buildInventoryReport(reader, batchSize);
}

export function inventoryPassesThresholds(report: InventoryReport): boolean {
  if (report.summary.totalRecords === 0) return true;
  const malformedPct =
    report.summary.malformedCount / Math.max(report.summary.totalRecords, 1);
  return malformedPct <= 0.01 || report.summary.malformedCount === 0;
}
