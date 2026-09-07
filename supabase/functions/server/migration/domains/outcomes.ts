/**
 * Outcome domain migration — Phase 2 for the `outcome:` namespace.
 *
 * The same shape as the cortex domain, and the same dependency: an outcome
 * cannot exist before its submission, because `outcomes.submission_id` is NOT
 * NULL and references `submissions`. `test:database:diagnostic` SB-7 proves
 * that foreign key rather than asserting it in prose.
 *
 * So an outcome whose submission has not been migrated is QUARANTINED with
 * `SUBMISSION_NOT_MIGRATED` and the run finishes. A failed batch tells an
 * operator the migration is broken; a quarantine record tells them exactly
 * which outcomes are waiting on which submissions, and a re-run picks them up.
 *
 * `outcomes.submission_id` is also UNIQUE, so one submission has at most one
 * outcome — the same rule the KV key shape already expresses, which is what
 * makes the writer an update-or-insert on that column rather than on
 * `legacy_kv_key`.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIGRATION_METADATA_KEY } from '../config.ts';
import { insertQuarantine } from '../quarantineStore.ts';
import {
  OUTCOME_ENTITY_PREFIX,
  canonicalOutcomeHash,
  isOutcomeEntityKey,
  isOutcomeQuarantined,
  normalizeOutcomeRecord,
  parseOutcomeKvRecord,
  type NormalizedOutcome,
} from '../outcomeNormalizer.ts';
import type { KvReader, RecordClassification, SimulationReport } from '../types.ts';
import { throwOnError } from '../client.ts';

export interface OutcomeDomainContext {
  organizationId: string;
  runId: string;
  writeBusinessRows: boolean;
  seenLegacyKeys: Set<string>;
  classifications: Record<RecordClassification, number>;
  predicted: NormalizedOutcome[];
  quarantineCount: number;
  inserted: number;
  updated: number;
  awaitingSubmission: number;
}

export function createOutcomeDomainContext(
  organizationId: string,
  runId: string,
  writeBusinessRows: boolean,
): OutcomeDomainContext {
  return {
    organizationId,
    runId,
    writeBusinessRows,
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
    awaitingSubmission: 0,
  };
}

export async function processOutcomeBatch(
  client: SupabaseClient,
  _reader: KvReader,
  ctx: OutcomeDomainContext,
  records: Array<{ key: string; rawValue: unknown }>,
): Promise<void> {
  for (const record of records) {
    if (!isOutcomeEntityKey(record.key)) {
      ctx.classifications.index_only += 1;
      continue;
    }

    const result = normalizeOutcomeRecord(
      parseOutcomeKvRecord(record.key, record.rawValue),
      ctx.organizationId,
      record.key,
    );

    if (isOutcomeQuarantined(result)) {
      ctx.classifications.quarantined += 1;
      ctx.quarantineCount += 1;
      if (ctx.writeBusinessRows) {
        await insertQuarantine(client, {
          run_id: ctx.runId,
          organization_id: ctx.organizationId,
          source_namespace: OUTCOME_ENTITY_PREFIX,
          source_key: record.key,
          source_payload: record.rawValue,
          reason_code: result.reasonCode,
          reason_detail: result.reasonDetail,
          target_table: 'outcomes',
        });
      }
      continue;
    }

    const normalized = result.record;
    if (ctx.seenLegacyKeys.has(normalized.legacyKvKey)) {
      ctx.classifications.duplicate += 1;
      continue;
    }
    ctx.seenLegacyKeys.add(normalized.legacyKvKey);
    ctx.predicted.push(normalized);
    ctx.classifications.migrated += 1;

    if (ctx.writeBusinessRows) {
      await writeOutcome(client, ctx, normalized, record.rawValue);
    }
  }
}

async function writeOutcome(
  client: SupabaseClient,
  ctx: OutcomeDomainContext,
  record: NormalizedOutcome,
  rawValue: unknown,
): Promise<void> {
  const { data: submission } = await client
    .from('submissions')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('legacy_kv_key', record.submissionLegacyKvKey)
    .is('deleted_at', null)
    .maybeSingle();

  const submissionId = submission?.id as string | undefined;
  if (!submissionId) {
    ctx.awaitingSubmission += 1;
    ctx.classifications.migrated -= 1;
    ctx.classifications.quarantined += 1;
    ctx.quarantineCount += 1;
    await insertQuarantine(client, {
      run_id: ctx.runId,
      organization_id: ctx.organizationId,
      source_namespace: OUTCOME_ENTITY_PREFIX,
      source_key: record.legacyKvKey,
      source_payload: rawValue,
      reason_code: 'SUBMISSION_NOT_MIGRATED',
      reason_detail: `${record.submissionLegacyKvKey} has no relational row yet`,
      target_table: 'outcomes',
    });
    return;
  }

  const payload = {
    organization_id: ctx.organizationId,
    submission_id: submissionId,
    legacy_kv_key: record.legacyKvKey,
    outcome_type: record.outcomeType,
    status: record.status,
    value: { ...record.value, [MIGRATION_METADATA_KEY]: ctx.runId },
    recorded_at: record.recordedAt,
  };

  // Keyed on `submission_id`, not on `legacy_kv_key`. The UNIQUE constraint is
  // on the submission, so looking up by the KV key would miss a row written for
  // the same submission under a different key and the insert would then fail on
  // a constraint the writer could have honoured.
  const { data: existing } = await client
    .from('outcomes')
    .select('id')
    .eq('submission_id', submissionId)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await client
      .from('outcomes')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    throwOnError(error, 'writeOutcome.update');
    ctx.updated += 1;
    return;
  }

  const { error } = await client.from('outcomes').insert(payload);
  throwOnError(error, 'writeOutcome.insert');
  ctx.inserted += 1;
}

export function buildOutcomeSimulationReport(
  ctx: OutcomeDomainContext,
  discoveredRecords: number,
  runId: string | null,
  unresolvedMappings: string[],
): SimulationReport {
  const checksumSource = createHash('sha256')
    .update(ctx.predicted.map(canonicalOutcomeHash).sort().join('|'))
    .digest('hex');
  const checksumTarget = createHash('sha256')
    .update(
      ctx.predicted
        .map((record) => `${record.submissionLegacyKvKey}:${record.outcomeType}`)
        .sort()
        .join('|'),
    )
    .digest('hex');

  const accountedFor =
    ctx.classifications.migrated +
    ctx.classifications.duplicate +
    ctx.classifications.quarantined +
    ctx.classifications.index_only +
    ctx.classifications.skipped;

  const converted = ctx.predicted.filter((record) => record.outcomeType === 'won').length;

  return {
    generatedAt: new Date().toISOString(),
    runId,
    discoveredRecords,
    validRecords: ctx.classifications.migrated,
    normalizationRequired: ctx.predicted.filter((record) => record.inferredFields.length > 0).length,
    duplicates: ctx.classifications.duplicate,
    quarantined: ctx.classifications.quarantined,
    predictedLeads: ctx.predicted.length,
    predictedContacts: 0,
    predictedContactMethods: 0,
    unresolvedMappings,
    checksumSource,
    checksumTarget,
    thresholdsPassed: accountedFor <= discoveredRecords,
    details: {
      domain: 'outcomes',
      classifications: ctx.classifications,
      predictedOutcomes: ctx.predicted.length,
      predictedWon: converted,
      predictedLost: ctx.predicted.length - converted,
      awaitingSubmission: ctx.awaitingSubmission,
      accountedFor,
    },
  };
}

export function outcomeSimulationReportToMarkdown(report: SimulationReport): string {
  const details = report.details as Record<string, number>;
  return [
    '# Outcome Simulation Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Run ID: ${report.runId ?? 'n/a'}`,
    '',
    `- Discovered: ${report.discoveredRecords}`,
    `- Valid: ${report.validRecords}`,
    `- Quarantined: ${report.quarantined}`,
    `- Predicted outcomes: ${details.predictedOutcomes ?? 0}`,
    `- ... converted: ${details.predictedWon ?? 0}`,
    `- ... lost: ${details.predictedLost ?? 0}`,
    `- Awaiting a submission row: ${details.awaitingSubmission ?? 0}`,
    `- Thresholds passed: ${report.thresholdsPassed}`,
    '',
    `Checksum (source): ${report.checksumSource}`,
    `Checksum (target): ${report.checksumTarget}`,
  ].join('\n');
}
