/**
 * Cortex analysis domain migration — Phase 2 for the `cortex:` namespace.
 *
 * ── IT DEPENDS ON THE SUBMISSION DOMAIN, AND SAYS SO PER RECORD ────────────
 *
 * `domain_scores.submission_id` and `diagnostic_scores.submission_id` are both
 * NOT NULL and reference `submissions`, so an analysis cannot be written before
 * its submission has been migrated. That is a fact about the schema —
 * `test:database:diagnostic` SB-7 proves the same shape for outcomes — and it
 * is the whole reason the domains have an order.
 *
 * A record whose submission is not there is therefore QUARANTINED with
 * `SUBMISSION_NOT_MIGRATED` rather than failing the batch. The distinction
 * matters: a failed batch tells an operator that the migration is broken, and a
 * quarantine record tells them exactly which analyses are waiting on which
 * submissions and lets the rest of the run finish. Re-running after the
 * submission backfill picks them up, because the writer is idempotent.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIGRATION_METADATA_KEY } from '../config.ts';
import { insertQuarantine } from '../quarantineStore.ts';
import {
  CORTEX_ENTITY_PREFIX,
  HEATMAP_MAX,
  canonicalCortexHash,
  isCortexEntityKey,
  isCortexQuarantined,
  normalizeCortexRecord,
  parseCortexKvRecord,
  type NormalizedCortexAnalysis,
} from '../cortexNormalizer.ts';
import type { KvReader, RecordClassification, SimulationReport } from '../types.ts';
import { throwOnError } from '../client.ts';

export interface CortexDomainContext {
  organizationId: string;
  runId: string;
  writeBusinessRows: boolean;
  seenLegacyKeys: Set<string>;
  classifications: Record<RecordClassification, number>;
  predicted: NormalizedCortexAnalysis[];
  quarantineCount: number;
  inserted: number;
  updated: number;
  /** Domain score rows written. */
  domainScoresWritten: number;
  /** Analyses waiting on a submission that has not been migrated yet. */
  awaitingSubmission: number;
}

export function createCortexDomainContext(
  organizationId: string,
  runId: string,
  writeBusinessRows: boolean,
): CortexDomainContext {
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
    domainScoresWritten: 0,
    awaitingSubmission: 0,
  };
}

export async function processCortexBatch(
  client: SupabaseClient,
  _reader: KvReader,
  ctx: CortexDomainContext,
  records: Array<{ key: string; rawValue: unknown }>,
): Promise<void> {
  for (const record of records) {
    if (!isCortexEntityKey(record.key)) {
      ctx.classifications.index_only += 1;
      continue;
    }

    const result = normalizeCortexRecord(
      parseCortexKvRecord(record.key, record.rawValue),
      ctx.organizationId,
      record.key,
    );

    if (isCortexQuarantined(result)) {
      ctx.classifications.quarantined += 1;
      ctx.quarantineCount += 1;
      if (ctx.writeBusinessRows) {
        await insertQuarantine(client, {
          run_id: ctx.runId,
          organization_id: ctx.organizationId,
          source_namespace: CORTEX_ENTITY_PREFIX,
          source_key: record.key,
          source_payload: record.rawValue,
          reason_code: result.reasonCode,
          reason_detail: result.reasonDetail,
          target_table: 'domain_scores',
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

    // An analysis that produced no pillar carries nothing this domain writes.
    // Skipped rather than migrated, so the counts do not claim work that did
    // not happen.
    if (normalized.domainScores.length === 0) {
      ctx.classifications.skipped += 1;
      continue;
    }

    ctx.predicted.push(normalized);
    ctx.classifications.migrated += 1;

    if (ctx.writeBusinessRows) {
      await writeAnalysis(client, ctx, normalized, record.rawValue);
    } else {
      ctx.domainScoresWritten += normalized.domainScores.length;
    }
  }
}

async function writeAnalysis(
  client: SupabaseClient,
  ctx: CortexDomainContext,
  record: NormalizedCortexAnalysis,
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
    // The domain-ordering dependency, made visible per record rather than as a
    // failed batch. Re-running after the submission backfill picks it up.
    ctx.awaitingSubmission += 1;
    ctx.classifications.migrated -= 1;
    ctx.classifications.quarantined += 1;
    ctx.quarantineCount += 1;
    await insertQuarantine(client, {
      run_id: ctx.runId,
      organization_id: ctx.organizationId,
      source_namespace: CORTEX_ENTITY_PREFIX,
      source_key: record.legacyKvKey,
      source_payload: rawValue,
      reason_code: 'SUBMISSION_NOT_MIGRATED',
      reason_detail: `${record.submissionLegacyKvKey} has no relational row yet`,
      target_table: 'domain_scores',
    });
    return;
  }

  const migrationMeta = { [MIGRATION_METADATA_KEY]: ctx.runId };

  for (const score of record.domainScores) {
    const payload = {
      organization_id: ctx.organizationId,
      submission_id: submissionId,
      domain_key: score.domainKey,
      score: score.score,
      metadata: {
        ...migrationMeta,
        // The transformation, recorded so it is auditable rather than assumed.
        source_scale: `0-${HEATMAP_MAX}`,
        source_value: score.sourceValue,
      },
    };

    const { data: existing } = await client
      .from('domain_scores')
      .select('id')
      .eq('submission_id', submissionId)
      .eq('domain_key', score.domainKey)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await client
        .from('domain_scores')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      throwOnError(error, 'writeAnalysis.domain_scores.update');
      ctx.updated += 1;
    } else {
      const { error } = await client.from('domain_scores').insert(payload);
      throwOnError(error, 'writeAnalysis.domain_scores.insert');
      ctx.inserted += 1;
    }
    ctx.domainScoresWritten += 1;
  }

  await mergeScoreMetadata(client, ctx, submissionId, record);
}

/**
 * Merge the analysis's bands and provenance into `diagnostic_scores.metadata`.
 *
 * MERGES rather than replaces, and touches NO score column. The submission
 * backfill owns those numbers; this domain owns what only it has. A write that
 * replaced the row would make the result depend on which domain ran last.
 *
 * The row may not exist: `diagnostic_scores` is written by the submission
 * backfill, and a deployment may have run this domain against submissions
 * migrated by an older revision. Inserting a metadata-only row is correct —
 * the score columns are nullable and "we know the bands and not the numbers"
 * is a true statement about such a submission.
 */
async function mergeScoreMetadata(
  client: SupabaseClient,
  ctx: CortexDomainContext,
  submissionId: string,
  record: NormalizedCortexAnalysis,
): Promise<void> {
  const { data: existing } = await client
    .from('diagnostic_scores')
    .select('id, metadata')
    .eq('submission_id', submissionId)
    .maybeSingle();

  const merged = {
    ...((existing?.metadata as Record<string, unknown> | undefined) ?? {}),
    ...record.scoreMetadata,
    [MIGRATION_METADATA_KEY]: ctx.runId,
  };

  if (existing?.id) {
    const { error } = await client
      .from('diagnostic_scores')
      .update({ metadata: merged, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    throwOnError(error, 'writeAnalysis.diagnostic_scores.update');
    return;
  }

  const { error } = await client.from('diagnostic_scores').insert({
    organization_id: ctx.organizationId,
    submission_id: submissionId,
    metadata: merged,
  });
  throwOnError(error, 'writeAnalysis.diagnostic_scores.insert');
}

export function buildCortexSimulationReport(
  ctx: CortexDomainContext,
  discoveredRecords: number,
  runId: string | null,
  unresolvedMappings: string[],
): SimulationReport {
  const checksumSource = createHash('sha256')
    .update(ctx.predicted.map(canonicalCortexHash).sort().join('|'))
    .digest('hex');
  const checksumTarget = createHash('sha256')
    .update(
      ctx.predicted
        .flatMap((record) =>
          record.domainScores.map(
            (score) => `${record.submissionLegacyKvKey}:${score.domainKey}:${score.score}`,
          ),
        )
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
      domain: 'cortex_analysis',
      classifications: ctx.classifications,
      predictedAnalyses: ctx.predicted.length,
      predictedDomainScores: ctx.domainScoresWritten,
      awaitingSubmission: ctx.awaitingSubmission,
      accountedFor,
    },
  };
}

export function cortexSimulationReportToMarkdown(report: SimulationReport): string {
  const details = report.details as Record<string, number>;
  return [
    '# Cortex Analysis Simulation Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Run ID: ${report.runId ?? 'n/a'}`,
    '',
    `- Discovered: ${report.discoveredRecords}`,
    `- Valid: ${report.validRecords}`,
    `- Skipped (no pillar heatmap): ${(details.classifications as unknown as Record<string, number>)?.skipped ?? 0}`,
    `- Quarantined: ${report.quarantined}`,
    `- Predicted analyses: ${details.predictedAnalyses ?? 0}`,
    `- Predicted domain score rows: ${details.predictedDomainScores ?? 0}`,
    `- Awaiting a submission row: ${details.awaitingSubmission ?? 0}`,
    `- Thresholds passed: ${report.thresholdsPassed}`,
    '',
    `Checksum (source): ${report.checksumSource}`,
    `Checksum (target): ${report.checksumTarget}`,
  ].join('\n');
}
