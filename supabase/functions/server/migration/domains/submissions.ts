/**
 * Submission domain migration — Phase 2 for the `sub:` namespace.
 *
 * The same shape as `leads.ts`: a context, a batch processor that classifies
 * every record, and a writer that runs only when the mode is `backfill` and the
 * run is not a dry run. Simulation drives the identical classification path
 * with `writeBusinessRows` false, so what a simulation predicts is what a
 * backfill writes — the two cannot drift, because they are one function.
 *
 * ── THE WRITER IS IDEMPOTENT, INCLUDING WHEN A SUBMISSION SHRINKS ──────────
 *
 * Re-running a backfill must converge on the KV record rather than accumulate
 * from it. Upserting the submission and its scores gets that for free; the
 * ANSWERS do not, because an answer key removed in KV would otherwise survive
 * forever as a relational row nobody could explain. So after upserting the
 * current answers, the writer soft-deletes the rows whose `question_key` is no
 * longer present.
 *
 * Soft-deletes rather than hard: `diagnostic_answers` carries `deleted_at` and
 * the read paths filter on it, and a migration that permanently removes a row
 * it did not create is a migration that cannot be reasoned about after the
 * fact.
 *
 * ── LEAD AND CONTACT LINKS ARE BEST-EFFORT, AND THAT IS DELIBERATE ─────────
 *
 * `submissions.lead_id` and `submissions.contact_id` are both nullable and both
 * reference rows the LEAD backfill creates. Resolving them here is an
 * enrichment, not a precondition: a deployment that migrates submissions before
 * leads gets submissions with null links rather than a refused batch, and a
 * later lead backfill plus a re-run fills them in. Blocking on them would make
 * the order of two independent backfills load-bearing.
 *
 * Both lookups are ORGANIZATION-SCOPED. A join on email alone would attach one
 * tenant's submission to another tenant's contact, which is the one mistake in
 * this file that could not be undone by re-running it.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIGRATION_METADATA_KEY } from '../config.ts';
import { insertQuarantine } from '../quarantineStore.ts';
import {
  SUBMISSION_ENTITY_PREFIX,
  canonicalSubmissionHash,
  isQuarantined,
  isSubmissionEntityKey,
  normalizeSubmissionRecord,
  parseSubmissionKvRecord,
  type NormalizedSubmission,
} from '../submissionNormalizer.ts';
import type { KvReader, RecordClassification, SimulationReport } from '../types.ts';
import { throwOnError } from '../client.ts';

export interface SubmissionDomainContext {
  organizationId: string;
  runId: string;
  writeBusinessRows: boolean;
  seenLegacyKeys: Set<string>;
  classifications: Record<RecordClassification, number>;
  predicted: NormalizedSubmission[];
  quarantineCount: number;
  inserted: number;
  updated: number;
  /** Answer rows written, so a simulation can predict the child-table volume. */
  answersWritten: number;
  /** Answer rows soft-deleted because KV no longer carries the key. */
  answersRetired: number;
  /** Submissions whose lead or contact could not be resolved. Not an error. */
  unlinked: number;
}

export function createSubmissionDomainContext(
  organizationId: string,
  runId: string,
  writeBusinessRows: boolean,
): SubmissionDomainContext {
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
    answersWritten: 0,
    answersRetired: 0,
    unlinked: 0,
  };
}

export async function processSubmissionBatch(
  client: SupabaseClient,
  _reader: KvReader,
  ctx: SubmissionDomainContext,
  records: Array<{ key: string; rawValue: unknown }>,
): Promise<void> {
  for (const record of records) {
    // `sub_email:` keys share the prefix and are an index, not an entity. They
    // are counted so the discovered total reconciles, and never normalized.
    if (!isSubmissionEntityKey(record.key)) {
      ctx.classifications.index_only += 1;
      continue;
    }

    const parsed = parseSubmissionKvRecord(record.key, record.rawValue);
    const result = normalizeSubmissionRecord(parsed, ctx.organizationId, record.key);

    if (isQuarantined(result)) {
      ctx.classifications.quarantined += 1;
      ctx.quarantineCount += 1;
      if (ctx.writeBusinessRows) {
        await insertQuarantine(client, {
          run_id: ctx.runId,
          organization_id: ctx.organizationId,
          source_namespace: SUBMISSION_ENTITY_PREFIX,
          source_key: record.key,
          source_payload: record.rawValue,
          reason_code: result.reasonCode,
          reason_detail: result.reasonDetail,
          target_table: 'submissions',
        });
      }
      continue;
    }

    const normalized = result.record;

    // Two KV keys cannot produce one submission: `legacy_kv_key` is uniquely
    // indexed. Within a run the second is a duplicate rather than an update, so
    // it is counted and skipped instead of overwriting the first.
    if (ctx.seenLegacyKeys.has(normalized.legacyKvKey)) {
      ctx.classifications.duplicate += 1;
      continue;
    }

    ctx.seenLegacyKeys.add(normalized.legacyKvKey);
    ctx.predicted.push(normalized);
    ctx.classifications.migrated += 1;

    if (ctx.writeBusinessRows) {
      await upsertSubmissionGraph(client, ctx, normalized);
    } else {
      // A simulation predicts the child volume without a client, so the report
      // states what a backfill would write rather than only what it read.
      ctx.answersWritten += normalized.answers.length;
    }
  }
}

/**
 * The lead and contact a submission belongs to, if the lead backfill has run.
 *
 * Organization-scoped on both lookups. Returns nulls rather than throwing: an
 * unresolved link is an enrichment that did not happen, not a failed migration.
 */
async function resolveLinks(
  client: SupabaseClient,
  organizationId: string,
  email: string,
): Promise<{ leadId: string | null; contactId: string | null }> {
  const { data: contact } = await client
    .from('contacts')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('primary_email', email)
    .is('deleted_at', null)
    .maybeSingle();

  const { data: lead } = await client
    .from('leads')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('email', email)
    .is('deleted_at', null)
    .maybeSingle();

  return {
    leadId: (lead?.id as string | undefined) ?? null,
    contactId: (contact?.id as string | undefined) ?? null,
  };
}

async function upsertSubmissionGraph(
  client: SupabaseClient,
  ctx: SubmissionDomainContext,
  record: NormalizedSubmission,
): Promise<void> {
  const migrationMeta = { [MIGRATION_METADATA_KEY]: ctx.runId };
  const links = await resolveLinks(client, ctx.organizationId, record.contactEmail);
  if (links.leadId === null && links.contactId === null) ctx.unlinked += 1;

  const payload = {
    organization_id: ctx.organizationId,
    lead_id: links.leadId,
    contact_id: links.contactId,
    legacy_kv_key: record.legacyKvKey,
    legacy_id: record.legacyId,
    company_name: record.companyName,
    contact_name: record.contactName,
    contact_email: record.contactEmail,
    phone: record.phone,
    website: record.website,
    industry: record.industry,
    industry_id: record.industryId,
    status: record.status,
    priority: record.priority,
    completion_score: record.scores.completionScore,
    quality_score: record.scores.qualityScore,
    ai_score: record.scores.aiScore,
    submitted_at: record.submittedAt,
    metadata: { ...record.metadata, ...migrationMeta },
  };

  const { data: existing } = await client
    .from('submissions')
    .select('id')
    .eq('legacy_kv_key', record.legacyKvKey)
    .is('deleted_at', null)
    .maybeSingle();

  let submissionId: string;
  if (existing?.id) {
    submissionId = existing.id as string;
    const { error } = await client
      .from('submissions')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', submissionId);
    throwOnError(error, 'upsertSubmissionGraph.submission.update');
    ctx.updated += 1;
  } else {
    const { data: inserted, error } = await client
      .from('submissions')
      .insert(payload)
      .select('id')
      .single();
    throwOnError(error, 'upsertSubmissionGraph.submission.insert');
    submissionId = inserted!.id as string;
    ctx.inserted += 1;
  }

  await upsertScores(client, ctx, submissionId, record, migrationMeta);
  await upsertAnswers(client, ctx, submissionId, record);
}

/**
 * The score row.
 *
 * `diagnostic_scores.submission_id` is UNIQUE, so there is exactly one row per
 * submission and the write is an update-or-insert on that key. The row is
 * written even when all three scores are null: its absence and a row of nulls
 * mean different things — "this submission was never scored" versus "the
 * migration has not reached it" — and only the second is a reason to look.
 */
async function upsertScores(
  client: SupabaseClient,
  ctx: SubmissionDomainContext,
  submissionId: string,
  record: NormalizedSubmission,
  migrationMeta: Record<string, unknown>,
): Promise<void> {
  const payload = {
    organization_id: ctx.organizationId,
    submission_id: submissionId,
    completion_score: record.scores.completionScore,
    quality_score: record.scores.qualityScore,
    ai_score: record.scores.aiScore,
    scored_at: record.submittedAt,
    metadata: migrationMeta,
  };

  const { data: existing } = await client
    .from('diagnostic_scores')
    .select('id')
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await client
      .from('diagnostic_scores')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    throwOnError(error, 'upsertSubmissionGraph.scores.update');
    return;
  }

  const { error } = await client.from('diagnostic_scores').insert(payload);
  throwOnError(error, 'upsertSubmissionGraph.scores.insert');
}

/**
 * The answer rows, converged on what KV currently holds.
 *
 * Upsert what is there, then RETIRE what is not. Without the retirement a
 * backfill accumulates: an answer key removed in KV survives as a relational
 * row that no re-run can explain and no reconciliation can attribute.
 */
async function upsertAnswers(
  client: SupabaseClient,
  ctx: SubmissionDomainContext,
  submissionId: string,
  record: NormalizedSubmission,
): Promise<void> {
  const keptKeys: string[] = [];

  for (const answer of record.answers) {
    keptKeys.push(answer.questionKey);
    const payload = {
      organization_id: ctx.organizationId,
      submission_id: submissionId,
      question_key: answer.questionKey,
      answer_text: answer.answerText,
      answer_json: answer.answerJson,
      deleted_at: null,
    };

    const { data: existing } = await client
      .from('diagnostic_answers')
      .select('id')
      .eq('submission_id', submissionId)
      .eq('question_key', answer.questionKey)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await client
        .from('diagnostic_answers')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      throwOnError(error, 'upsertSubmissionGraph.answers.update');
    } else {
      const { error } = await client.from('diagnostic_answers').insert(payload);
      throwOnError(error, 'upsertSubmissionGraph.answers.insert');
    }
    ctx.answersWritten += 1;
  }

  const { data: retired, error } = await client
    .from('diagnostic_answers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('submission_id', submissionId)
    .is('deleted_at', null)
    // An empty answer set must retire EVERY row rather than none, so the
    // exclusion list is only applied when there is something to exclude — a
    // `not.in.()` with an empty tuple is not a filter PostgREST accepts.
    .not('question_key', 'in', `(${keptKeys.map((key) => `"${key}"`).join(',') || '""'})`)
    .select('id');
  throwOnError(error, 'upsertSubmissionGraph.answers.retire');
  ctx.answersRetired += (retired ?? []).length;
}

export function buildSubmissionSimulationReport(
  ctx: SubmissionDomainContext,
  discoveredRecords: number,
  runId: string | null,
  unresolvedMappings: string[],
): SimulationReport {
  const checksumSource = createHash('sha256')
    .update(ctx.predicted.map(canonicalSubmissionHash).sort().join('|'))
    .digest('hex');
  const checksumTarget = createHash('sha256')
    .update(
      ctx.predicted
        .map((record) =>
          JSON.stringify({
            legacy_kv_key: record.legacyKvKey,
            contact_email: record.contactEmail,
            status: record.status,
          }),
        )
        .sort()
        .join('|'),
    )
    .digest('hex');

  const normalizationRequired = ctx.predicted.filter(
    (record) => record.inferredFields.length > 0,
  ).length;

  // Every discovered key is accounted for by exactly one classification. A
  // total that exceeds what was discovered means a record was counted twice,
  // which is the one arithmetic error that would make the report reassuring
  // and wrong.
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
    normalizationRequired,
    duplicates: ctx.classifications.duplicate,
    quarantined: ctx.classifications.quarantined,
    // The shared report shape is the lead domain's. Rather than distort it,
    // the submission counts live under `details`, and the three lead fields
    // carry the nearest true statement: how many parent rows would be written,
    // and zero for a graph this domain does not build.
    predictedLeads: ctx.predicted.length,
    predictedContacts: 0,
    predictedContactMethods: 0,
    unresolvedMappings,
    checksumSource,
    checksumTarget,
    thresholdsPassed: accountedFor <= discoveredRecords,
    details: {
      domain: 'submissions',
      classifications: ctx.classifications,
      predictedSubmissions: ctx.predicted.length,
      predictedAnswers: ctx.answersWritten,
      predictedScoreRows: ctx.predicted.length,
      accountedFor,
    },
  };
}

export function submissionSimulationReportToMarkdown(report: SimulationReport): string {
  const details = report.details as Record<string, number>;
  return [
    '# Submission Simulation Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Run ID: ${report.runId ?? 'n/a'}`,
    '',
    `- Discovered: ${report.discoveredRecords}`,
    `- Valid: ${report.validRecords}`,
    `- Normalization required: ${report.normalizationRequired}`,
    `- Duplicates: ${report.duplicates}`,
    `- Quarantined: ${report.quarantined}`,
    `- Predicted submissions: ${details.predictedSubmissions ?? 0}`,
    `- Predicted answer rows: ${details.predictedAnswers ?? 0}`,
    `- Predicted score rows: ${details.predictedScoreRows ?? 0}`,
    `- Thresholds passed: ${report.thresholdsPassed}`,
    '',
    `Checksum (source): ${report.checksumSource}`,
    `Checksum (target): ${report.checksumTarget}`,
  ].join('\n');
}
