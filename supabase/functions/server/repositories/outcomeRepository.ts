/**
 * Outcome repository — MCV2-S5-IMPLEMENT-002 (not wired to routes)
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';
import type {
  OutcomeListFilter,
  OutcomeRecord,
} from '../../../../src/types/diagnostic.database.types.ts';
import type { OutcomeRepository } from './diagnosticTypes.ts';
import { createServiceClient, mapRow, throwOnError } from './repositoryClient.ts';

export function createOutcomeRepository(client?: SupabaseClient): OutcomeRepository {
  const db = client ?? createServiceClient();

  return {
    async createOutcome(input) {
      const { data, error } = await db
        .from('outcomes')
        .insert({
          organization_id: input.organization_id,
          submission_id: input.submission_id,
          legacy_kv_key: input.legacy_kv_key ?? null,
          outcome_type: input.outcome_type ?? 'engagement',
          status: input.status ?? 'open',
          value: input.value ?? {},
          recorded_at: input.recorded_at ?? new Date().toISOString(),
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        })
        .select('*')
        .single();
      throwOnError(error, 'createOutcome');
      return data as OutcomeRecord;
    },

    async getOutcomeById(id, organizationId) {
      const { data, error } = await db
        .from('outcomes')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getOutcomeById');
      return mapRow<OutcomeRecord>(data as Record<string, unknown> | null);
    },

    async getOutcomeBySubmission(submissionId, organizationId) {
      const { data, error } = await db
        .from('outcomes')
        .select('*')
        .eq('submission_id', submissionId)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getOutcomeBySubmission');
      return mapRow<OutcomeRecord>(data as Record<string, unknown> | null);
    },

    async getOutcomeByLegacyKey(legacyKvKey) {
      const { data, error } = await db
        .from('outcomes')
        .select('*')
        .eq('legacy_kv_key', legacyKvKey)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getOutcomeByLegacyKey');
      return mapRow<OutcomeRecord>(data as Record<string, unknown> | null);
    },

    async updateOutcome(id, organizationId, patch) {
      const { data, error } = await db
        .from('outcomes')
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .select('*')
        .single();
      throwOnError(error, 'updateOutcome');
      return data as OutcomeRecord;
    },

    async listOutcomes(filter) {
      let q = db
        .from('outcomes')
        .select('*')
        .eq('organization_id', filter.organizationId)
        .is('deleted_at', null)
        .order('recorded_at', { ascending: false });
      if (filter.submissionId) q = q.eq('submission_id', filter.submissionId);
      if (filter.status) q = q.eq('status', filter.status);
      const limit = Math.min(filter.limit ?? 50, 200);
      const offset = filter.offset ?? 0;
      const { data, error } = await q.range(offset, offset + limit - 1);
      throwOnError(error, 'listOutcomes');
      return (data ?? []) as OutcomeRecord[];
    },
  };
}
