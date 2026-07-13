/**
 * Submission repository — MCV2-S5-IMPLEMENT-002 (not wired to routes)
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';
import type {
  DiagnosticAnswerRecord,
  DiagnosticScoreRecord,
  DomainScoreRecord,
  SubmissionListFilter,
  SubmissionRecord,
  SubmissionSectionRecord,
} from '../../../../src/types/diagnostic.database.types.ts';
import type { SubmissionRepository } from './diagnosticTypes.ts';
import { createServiceClient, mapRow, throwOnError } from './repositoryClient.ts';

export function createSubmissionRepository(client?: SupabaseClient): SubmissionRepository {
  const db = client ?? createServiceClient();

  return {
    async createSubmission(input) {
      const { data, error } = await db
        .from('submissions')
        .insert({
          organization_id: input.organization_id,
          lead_id: input.lead_id ?? null,
          contact_id: input.contact_id ?? null,
          legacy_kv_key: input.legacy_kv_key ?? null,
          legacy_id: input.legacy_id ?? null,
          company_name: input.company_name,
          contact_name: input.contact_name ?? null,
          contact_email: input.contact_email.toLowerCase().trim(),
          phone: input.phone ?? null,
          website: input.website ?? null,
          industry: input.industry ?? null,
          industry_id: input.industry_id ?? null,
          status: input.status ?? 'new',
          priority: input.priority ?? 'medium',
          completion_score: input.completion_score ?? null,
          quality_score: input.quality_score ?? null,
          ai_score: input.ai_score ?? null,
          roi_potential: input.roi_potential ?? null,
          assigned_to: input.assigned_to ?? null,
          submitted_at: input.submitted_at ?? new Date().toISOString(),
          metadata: input.metadata ?? {},
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        })
        .select('*')
        .single();
      throwOnError(error, 'createSubmission');
      return data as SubmissionRecord;
    },

    async getSubmissionById(id, organizationId) {
      const { data, error } = await db
        .from('submissions')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getSubmissionById');
      return mapRow<SubmissionRecord>(data as Record<string, unknown> | null);
    },

    async getSubmissionByLegacyKey(legacyKvKey) {
      const { data, error } = await db
        .from('submissions')
        .select('*')
        .eq('legacy_kv_key', legacyKvKey)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getSubmissionByLegacyKey');
      return mapRow<SubmissionRecord>(data as Record<string, unknown> | null);
    },

    async lookupSubmissionByEmail(organizationId, email) {
      const { data, error } = await db
        .from('submissions')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('contact_email', email.toLowerCase().trim())
        .is('deleted_at', null)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      throwOnError(error, 'lookupSubmissionByEmail');
      return mapRow<SubmissionRecord>(data as Record<string, unknown> | null);
    },

    async updateSubmission(id, organizationId, patch) {
      const { data, error } = await db
        .from('submissions')
        .update({
          ...patch,
          contact_email: patch.contact_email
            ? patch.contact_email.toLowerCase().trim()
            : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .select('*')
        .single();
      throwOnError(error, 'updateSubmission');
      return data as SubmissionRecord;
    },

    async listSubmissions(filter) {
      let q = db
        .from('submissions')
        .select('*')
        .eq('organization_id', filter.organizationId)
        .is('deleted_at', null)
        .order('submitted_at', { ascending: false });
      if (filter.status) q = q.eq('status', filter.status);
      if (filter.priority) q = q.eq('priority', filter.priority);
      const limit = Math.min(filter.limit ?? 50, 200);
      const offset = filter.offset ?? 0;
      const { data, error } = await q.range(offset, offset + limit - 1);
      throwOnError(error, 'listSubmissions');
      return (data ?? []) as SubmissionRecord[];
    },

    async upsertSection(input) {
      const { data, error } = await db
        .from('submission_sections')
        .upsert({
          organization_id: input.organization_id,
          submission_id: input.submission_id,
          section_key: input.section_key.toLowerCase().trim(),
          title: input.title ?? null,
          sort_order: input.sort_order ?? 0,
          status: input.status ?? 'pending',
          metadata: input.metadata ?? {},
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        }, { onConflict: 'submission_id,section_key' })
        .select('*')
        .single();
      throwOnError(error, 'upsertSection');
      return data as SubmissionSectionRecord;
    },

    async listSections(submissionId, organizationId) {
      const { data, error } = await db
        .from('submission_sections')
        .select('*')
        .eq('submission_id', submissionId)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('sort_order');
      throwOnError(error, 'listSections');
      return (data ?? []) as SubmissionSectionRecord[];
    },

    async upsertAnswer(input) {
      const { data, error } = await db
        .from('diagnostic_answers')
        .upsert({
          organization_id: input.organization_id,
          submission_id: input.submission_id,
          section_id: input.section_id ?? null,
          question_key: input.question_key.toLowerCase().trim(),
          answer_text: input.answer_text ?? null,
          answer_json: input.answer_json ?? null,
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        }, { onConflict: 'submission_id,question_key' })
        .select('*')
        .single();
      throwOnError(error, 'upsertAnswer');
      return data as DiagnosticAnswerRecord;
    },

    async listAnswers(submissionId, organizationId) {
      const { data, error } = await db
        .from('diagnostic_answers')
        .select('*')
        .eq('submission_id', submissionId)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('question_key');
      throwOnError(error, 'listAnswers');
      return (data ?? []) as DiagnosticAnswerRecord[];
    },

    async upsertDiagnosticScore(input) {
      const { data, error } = await db
        .from('diagnostic_scores')
        .upsert({
          organization_id: input.organization_id,
          submission_id: input.submission_id,
          completion_score: input.completion_score ?? null,
          quality_score: input.quality_score ?? null,
          ai_score: input.ai_score ?? null,
          readiness_score: input.readiness_score ?? null,
          scored_at: input.scored_at ?? new Date().toISOString(),
          metadata: input.metadata ?? {},
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        }, { onConflict: 'submission_id' })
        .select('*')
        .single();
      throwOnError(error, 'upsertDiagnosticScore');
      return data as DiagnosticScoreRecord;
    },

    async upsertDomainScore(input) {
      const { data, error } = await db
        .from('domain_scores')
        .upsert({
          organization_id: input.organization_id,
          submission_id: input.submission_id,
          domain_key: input.domain_key.toLowerCase().trim(),
          score: input.score,
          weight: input.weight ?? null,
          metadata: input.metadata ?? {},
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        }, { onConflict: 'submission_id,domain_key' })
        .select('*')
        .single();
      throwOnError(error, 'upsertDomainScore');
      return data as DomainScoreRecord;
    },

    async listDomainScores(submissionId, organizationId) {
      const { data, error } = await db
        .from('domain_scores')
        .select('*')
        .eq('submission_id', submissionId)
        .eq('organization_id', organizationId)
        .order('domain_key');
      throwOnError(error, 'listDomainScores');
      return (data ?? []) as DomainScoreRecord[];
    },
  };
}
