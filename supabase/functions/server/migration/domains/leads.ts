/**
 * Lead/contact domain migration — MCV2-S6.2-IMPLEMENT-004
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIGRATION_METADATA_KEY } from '../config.ts';
import { insertQuarantine } from '../quarantineStore.ts';
import {
  canonicalLeadHash,
  isLeadEntityKey,
  normalizeLeadRecord,
  parseLeadKvRecord,
} from '../normalizer.ts';
import { normalizeEmail } from '../parseJson.ts';
import type {
  KvReader,
  NormalizedLeadContact,
  RecordClassification,
  SimulationReport,
} from '../types.ts';
import { throwOnError } from '../client.ts';

export interface LeadDomainContext {
  organizationId: string;
  runId: string;
  writeBusinessRows: boolean;
  emailToLegacyKey: Map<string, string>;
  seenLegacyKeys: Set<string>;
  classifications: Record<RecordClassification, number>;
  predicted: NormalizedLeadContact[];
  quarantineCount: number;
  inserted: number;
  updated: number;
  leadSourceIds: Map<string, string>;
}

export function createLeadDomainContext(
  organizationId: string,
  runId: string,
  writeBusinessRows: boolean,
): LeadDomainContext {
  return {
    organizationId,
    runId,
    writeBusinessRows,
    emailToLegacyKey: new Map(),
    seenLegacyKeys: new Set(),
    classifications: {
      migrated: 0,
      duplicate: 0,
      index_only: 0,
      quarantined: 0,
      skipped: 0,
    },
    predicted: [],
    quarantineCount: 0,
    inserted: 0,
    updated: 0,
    leadSourceIds: new Map(),
  };
}

export async function loadLeadSourceIds(
  client: SupabaseClient,
  organizationId: string,
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from('lead_sources')
    .select('id, key')
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  throwOnError(error, 'loadLeadSourceIds');
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.key as string, row.id as string);
  }
  return map;
}

export async function processLeadBatch(
  client: SupabaseClient,
  reader: KvReader,
  ctx: LeadDomainContext,
  records: Array<{ key: string; rawValue: unknown }>,
): Promise<void> {
  if (ctx.leadSourceIds.size === 0) {
    if (ctx.writeBusinessRows) {
      ctx.leadSourceIds = await loadLeadSourceIds(client, ctx.organizationId);
    } else {
      ctx.leadSourceIds = new Map([
        ['lead_magnet', 'sim-lead-magnet'],
        ['exit_intent', 'sim-exit-intent'],
      ]);
    }
  }

  for (const record of records) {
    if (!isLeadEntityKey(record.key)) {
      ctx.classifications.index_only += 1;
      continue;
    }

    const parsed = parseLeadKvRecord(record.key, record.rawValue);
    const result = normalizeLeadRecord(parsed, ctx.organizationId, record.key);

    if (!result.ok) {
      ctx.classifications.quarantined += 1;
      ctx.quarantineCount += 1;
      if (ctx.writeBusinessRows) {
        await insertQuarantine(client, {
          run_id: ctx.runId,
          organization_id: ctx.organizationId,
          source_namespace: 'lead:',
          source_key: record.key,
          source_payload: record.rawValue,
          reason_code: result.reasonCode,
          reason_detail: result.reasonDetail,
          target_table: 'leads',
        });
      }
      continue;
    }

    const normalized = result.record;
    const priorEmailKey = ctx.emailToLegacyKey.get(normalized.email);
    if (priorEmailKey && priorEmailKey !== normalized.legacyKvKey) {
      ctx.classifications.duplicate += 1;
      ctx.classifications.skipped += 1;
      if (ctx.writeBusinessRows) {
        await insertQuarantine(client, {
          run_id: ctx.runId,
          organization_id: ctx.organizationId,
          source_namespace: 'lead:',
          source_key: record.key,
          source_payload: record.rawValue,
          reason_code: 'DUPLICATE_EMAIL',
          reason_detail: `Email ${normalized.email} already mapped to ${priorEmailKey}`,
          target_table: 'leads',
        });
      }
      continue;
    }

    if (ctx.seenLegacyKeys.has(normalized.legacyKvKey)) {
      ctx.classifications.duplicate += 1;
      continue;
    }

    ctx.seenLegacyKeys.add(normalized.legacyKvKey);
    ctx.emailToLegacyKey.set(normalized.email, normalized.legacyKvKey);
    ctx.predicted.push(normalized);
    ctx.classifications.migrated += 1;

    if (ctx.writeBusinessRows) {
      await upsertLeadGraph(client, ctx, normalized);
    }
  }
}

async function upsertLeadGraph(
  client: SupabaseClient,
  ctx: LeadDomainContext,
  record: NormalizedLeadContact,
): Promise<void> {
  const migrationMeta = { [MIGRATION_METADATA_KEY]: ctx.runId };

  let contactId: string | null = null;
  const { data: existingContact } = await client
    .from('contacts')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('primary_email', record.email)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingContact?.id) {
    contactId = existingContact.id as string;
  } else {
    const { data: contact, error: contactError } = await client
      .from('contacts')
      .insert({
        organization_id: ctx.organizationId,
        legacy_kv_key: record.contactLegacyKvKey,
        full_name: record.fullName,
        company_name: record.companyName,
        primary_email: record.email,
        metadata: { ...record.metadata, ...migrationMeta },
      })
      .select('id')
      .single();
    throwOnError(contactError, 'upsertLeadGraph.contact');
    contactId = contact!.id as string;
    ctx.inserted += 1;

    const methods: Array<{ method_type: string; value: string; is_primary: boolean }> = [
      { method_type: 'email', value: record.email, is_primary: true },
    ];
    if (record.phone) methods.push({ method_type: 'phone', value: record.phone, is_primary: true });
    if (record.website) methods.push({ method_type: 'website', value: record.website, is_primary: true });

    for (const method of methods) {
      const { data: existingMethod } = await client
        .from('contact_methods')
        .select('id')
        .eq('contact_id', contactId)
        .eq('method_type', method.method_type)
        .eq('value', method.value)
        .is('deleted_at', null)
        .maybeSingle();
      if (!existingMethod) {
        const { error: methodError } = await client.from('contact_methods').insert({
          organization_id: ctx.organizationId,
          contact_id: contactId,
          method_type: method.method_type,
          value: method.value,
          is_primary: method.is_primary,
        });
        throwOnError(methodError, 'upsertLeadGraph.contact_method');
      }
    }
  }

  const leadSourceId = ctx.leadSourceIds.get(record.leadSourceKey) ?? null;
  const { data: existingLead } = await client
    .from('leads')
    .select('id')
    .eq('legacy_kv_key', record.legacyKvKey)
    .is('deleted_at', null)
    .maybeSingle();

  const leadPayload = {
    organization_id: ctx.organizationId,
    lead_source_id: leadSourceId,
    contact_id: contactId,
    legacy_kv_key: record.legacyKvKey,
    legacy_id: record.legacyId,
    email: record.email,
    full_name: record.fullName,
    company_name: record.companyName,
    phone: record.phone,
    status: record.status,
    metadata: { ...record.metadata, ...migrationMeta },
    captured_at: record.capturedAt,
  };

  if (existingLead?.id) {
    const { error } = await client
      .from('leads')
      .update({ ...leadPayload, updated_at: new Date().toISOString() })
      .eq('id', existingLead.id);
    throwOnError(error, 'upsertLeadGraph.lead.update');
    ctx.updated += 1;
  } else {
    const { error } = await client.from('leads').insert(leadPayload);
    throwOnError(error, 'upsertLeadGraph.lead.insert');
    ctx.inserted += 1;
  }
}

export function buildSimulationReport(
  ctx: LeadDomainContext,
  discoveredRecords: number,
  runId: string | null,
  unresolvedMappings: string[],
): SimulationReport {
  const sourceHashes = ctx.predicted
    .map((r) => canonicalLeadHash(r))
    .sort()
    .join('|');
  const checksumSource = createHash('sha256').update(sourceHashes).digest('hex');
  const checksumTarget = createHash('sha256')
    .update(
      ctx.predicted
        .map((r) =>
          JSON.stringify({
            email: r.email,
            legacy_kv_key: r.legacyKvKey,
            status: r.status,
          }),
        )
        .sort()
        .join('|'),
    )
    .digest('hex');

  const normalizationRequired = ctx.predicted.filter((r) => r.inferredFields.length > 0).length;
  const thresholdsPassed =
    ctx.classifications.quarantined === 0 || discoveredRecords === 0
      ? true
      : ctx.classifications.migrated + ctx.classifications.duplicate + ctx.classifications.quarantined <=
        discoveredRecords;

  return {
    generatedAt: new Date().toISOString(),
    runId,
    discoveredRecords,
    validRecords: ctx.classifications.migrated,
    normalizationRequired,
    duplicates: ctx.classifications.duplicate,
    quarantined: ctx.classifications.quarantined,
    predictedLeads: ctx.predicted.length,
    predictedContacts: new Set(ctx.predicted.map((r) => r.email)).size,
    predictedContactMethods: ctx.predicted.reduce((n, r) => {
      let c = 1;
      if (r.phone) c += 1;
      if (r.website) c += 1;
      return n + c;
    }, 0),
    unresolvedMappings,
    checksumSource,
    checksumTarget,
    thresholdsPassed,
    details: {
      classifications: ctx.classifications,
    },
  };
}

export function simulationReportToMarkdown(report: SimulationReport): string {
  return [
    '# Simulation Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Run ID: ${report.runId ?? 'n/a'}`,
    '',
    `- Discovered: ${report.discoveredRecords}`,
    `- Valid: ${report.validRecords}`,
    `- Normalization required: ${report.normalizationRequired}`,
    `- Duplicates: ${report.duplicates}`,
    `- Quarantined: ${report.quarantined}`,
    `- Predicted leads: ${report.predictedLeads}`,
    `- Predicted contacts: ${report.predictedContacts}`,
    `- Predicted contact methods: ${report.predictedContactMethods}`,
    `- Thresholds passed: ${report.thresholdsPassed}`,
    '',
    `Checksum (source): ${report.checksumSource}`,
    `Checksum (target): ${report.checksumTarget}`,
  ].join('\n');
}
