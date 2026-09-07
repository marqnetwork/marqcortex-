/**
 * The reconcilable domains.
 *
 * Each is a vocabulary — what to scan, how to normalize, which table and which
 * fields — handed to the one reconciler in `domainReconciliation.ts`. The
 * questions it asks (what is missing, what is orphaned, do the fields of a
 * sample agree) are asked identically for every domain, which is the point.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createKvReader } from './kvReader.ts';
import { persistReconciliationLog } from './reconciliation.ts';
import { reconcileByLegacyKey, type ReconcilableDomain } from './domainReconciliation.ts';
import {
  SUBMISSION_ENTITY_PREFIX,
  canonicalSubmissionHash,
  isQuarantined,
  isSubmissionEntityKey,
  normalizeSubmissionRecord,
  parseSubmissionKvRecord,
  type NormalizedSubmission,
} from './submissionNormalizer.ts';
import {
  OUTCOME_ENTITY_PREFIX,
  canonicalOutcomeHash,
  isOutcomeEntityKey,
  isOutcomeQuarantined,
  normalizeOutcomeRecord,
  parseOutcomeKvRecord,
  type NormalizedOutcome,
} from './outcomeNormalizer.ts';
import { SUBMISSION_FIELDS, projectSqlSubmission } from '../storage/submissionProjection.ts';
import { OUTCOME_FIELDS, projectSqlOutcome } from '../storage/outcomeProjection.ts';
import type { Projection } from '../storage/compare.ts';
import type { ReconciliationResult } from './types.ts';

// ── Submissions ─────────────────────────────────────────────────────────────

function projectNormalizedSubmission(record: NormalizedSubmission): Projection {
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

export const SUBMISSION_RECONCILER: ReconcilableDomain<NormalizedSubmission> = {
  domain: 'submissions',
  entityPrefix: SUBMISSION_ENTITY_PREFIX,
  isEntityKey: isSubmissionEntityKey,
  normalize: (key, rawValue, organizationId) => {
    const result = normalizeSubmissionRecord(
      parseSubmissionKvRecord(key, rawValue),
      organizationId,
      key,
    );
    return isQuarantined(result) ? null : result.record;
  },
  table: 'submissions',
  selectColumns:
    'legacy_kv_key, legacy_id, company_name, contact_name, contact_email, phone, website, ' +
    'industry, status, priority, completion_score, quality_score, ai_score, submitted_at',
  fields: SUBMISSION_FIELDS,
  projectKv: projectNormalizedSubmission,
  projectSql: projectSqlSubmission,
  hash: canonicalSubmissionHash,
  targetFingerprint: (row) => `${row.legacy_kv_key}:${row.contact_email}:${row.status}`,
};

// ── Outcomes ────────────────────────────────────────────────────────────────

/**
 * The KV side of an outcome, in the shadow read's vocabulary.
 *
 * `projectKvOutcome` reads the RAW KV record; the reconciliation has the
 * NORMALIZED one, which is the same facts after the normalizer's decisions. So
 * it is projected here rather than by re-reading the raw record — comparing a
 * raw record against a row the normalizer produced would test the KV shape
 * rather than the migration.
 */
function projectNormalizedOutcome(record: NormalizedOutcome): Projection {
  return {
    submissionId: record.submissionLegacyKvKey.replace(/^sub:/, ''),
    converted: record.outcomeType === 'won',
    conversionValue: record.value.conversionValue,
    lostReason: record.value.lostReason,
    recordedAt: record.recordedAt,
  };
}

export const OUTCOME_RECONCILER: ReconcilableDomain<NormalizedOutcome> = {
  domain: 'outcomes',
  entityPrefix: OUTCOME_ENTITY_PREFIX,
  isEntityKey: isOutcomeEntityKey,
  normalize: (key, rawValue, organizationId) => {
    const result = normalizeOutcomeRecord(parseOutcomeKvRecord(key, rawValue), organizationId, key);
    return isOutcomeQuarantined(result) ? null : result.record;
  },
  table: 'outcomes',
  selectColumns: 'legacy_kv_key, outcome_type, status, value, recorded_at',
  fields: OUTCOME_FIELDS,
  projectKv: projectNormalizedOutcome,
  projectSql: projectSqlOutcome,
  hash: canonicalOutcomeHash,
  targetFingerprint: (row) => `${row.legacy_kv_key}:${row.outcome_type}`,
};

// ── The orchestrator's entry points ─────────────────────────────────────────

function runner<TRecord>(domain: ReconcilableDomain<TRecord>) {
  return async (
    client: SupabaseClient,
    organizationId: string,
    batchSize: number,
    runId?: string,
    keyPrefixFilter?: string,
  ): Promise<ReconciliationResult> => {
    const result = await reconcileByLegacyKey(
      client,
      createKvReader(client, { keyPrefixFilter }),
      domain,
      organizationId,
      batchSize,
      runId,
      keyPrefixFilter,
    );
    if (runId) await persistReconciliationLog(client, runId, result);
    return result;
  };
}

export const reconcileSubmissions = runner(SUBMISSION_RECONCILER);
export const reconcileOutcomes = runner(OUTCOME_RECONCILER);
