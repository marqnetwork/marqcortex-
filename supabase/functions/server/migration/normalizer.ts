/**
 * Lead/contact normalizer — MCV2-S6.2-IMPLEMENT-004
 */
import { emptyStringToNull, normalizeEmail, parseKvRecord } from './parseJson.ts';
import type {
  LeadKvPayload,
  NormalizationResult,
  NormalizedLeadContact,
  ParsedKvRecord,
} from './types.ts';

const VALID_SOURCES = new Set(['lead_magnet', 'exit_intent']);

export function mapLeadSourceToStatus(source: string | undefined): 'captured' | 'exit_intent' | 'new' {
  if (source === 'exit_intent') return 'exit_intent';
  if (source === 'lead_magnet') return 'captured';
  return 'new';
}

export function normalizeLeadRecord(
  parsed: ParsedKvRecord<LeadKvPayload>,
  organizationId: string,
  sourceKey: string,
): NormalizationResult {
  if (parsed.parseError) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_JSON',
      reasonDetail: parsed.parseError,
      classification: 'quarantined',
    };
  }

  const payload = parsed.parsed;
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      reasonCode: 'INVALID_PAYLOAD',
      reasonDetail: 'Lead payload is not an object',
      classification: 'quarantined',
    };
  }

  const email = normalizeEmail(payload.email);
  if (!email) {
    return {
      ok: false,
      reasonCode: 'MISSING_EMAIL',
      reasonDetail: 'Lead email is required',
      classification: 'quarantined',
    };
  }

  const legacyId = emptyStringToNull(payload.id ?? null) ?? sourceKey.replace(/^lead:/, '');
  const sourceKeyNormalized = sourceKey.startsWith('lead:') ? sourceKey : `lead:${legacyId}`;
  const source = emptyStringToNull(payload.source ?? null) ?? 'lead_magnet';
  const leadSourceKey = VALID_SOURCES.has(source) ? source : 'lead_magnet';
  const inferredFields: string[] = [];

  let capturedAt = emptyStringToNull(payload.capturedAt ?? null);
  if (!capturedAt) {
    capturedAt = new Date(0).toISOString();
    inferredFields.push('captured_at_default');
  }

  const record: NormalizedLeadContact = {
    legacyKvKey: sourceKeyNormalized,
    legacyId,
    organizationId,
    email,
    fullName: emptyStringToNull(payload.name ?? null),
    companyName: emptyStringToNull(payload.website ?? null),
    phone: emptyStringToNull(payload.phone ?? null),
    website: emptyStringToNull(payload.website ?? null),
    status: mapLeadSourceToStatus(source),
    leadSourceKey,
    capturedAt,
    metadata: {
      kv_source: source,
      kv_double_encoded: parsed.doubleEncoded,
      ...(inferredFields.length ? { backfill_inferred_fields: inferredFields } : {}),
      ...(source !== leadSourceKey ? { kv_source_raw: source } : {}),
    },
    contactLegacyKvKey: `contact:${email}`,
    inferredFields,
  };

  return { ok: true, record, classification: 'migrated' };
}

export function parseLeadKvRecord(key: string, rawValue: unknown): ParsedKvRecord<LeadKvPayload> {
  return parseKvRecord<LeadKvPayload>(key, rawValue);
}

export function isLeadEntityKey(key: string): boolean {
  return key.startsWith('lead:') && !key.startsWith('lead_email:');
}

export function isLeadEmailIndexKey(key: string): boolean {
  return key.startsWith('lead_email:');
}

export function extractEmailFromIndexKey(key: string): string | null {
  if (!isLeadEmailIndexKey(key)) return null;
  return normalizeEmail(key.slice('lead_email:'.length));
}

export function canonicalLeadHash(record: NormalizedLeadContact): string {
  return JSON.stringify({
    email: record.email,
    legacy_kv_key: record.legacyKvKey,
    legacy_id: record.legacyId,
    status: record.status,
    full_name: record.fullName,
    phone: record.phone,
    captured_at: record.capturedAt,
  });
}
