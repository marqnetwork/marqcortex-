/**
 * Lead repository — MCV2-S5-IMPLEMENT-002 (not wired to routes)
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';
import type {
  LeadListFilter,
  LeadRecord,
  LeadSourceRecord,
  LeadTagRecord,
} from '../../../../src/types/diagnostic.database.types.ts';
import type { LeadRepository } from './diagnosticTypes.ts';
import { createServiceClient, mapRow, throwOnError } from './repositoryClient.ts';

export function createLeadRepository(client?: SupabaseClient): LeadRepository {
  const db = client ?? createServiceClient();

  return {
    async createLead(input) {
      const { data, error } = await db
        .from('leads')
        .insert({
          organization_id: input.organization_id,
          lead_source_id: input.lead_source_id ?? null,
          contact_id: input.contact_id ?? null,
          legacy_kv_key: input.legacy_kv_key ?? null,
          legacy_id: input.legacy_id ?? null,
          email: input.email.toLowerCase().trim(),
          full_name: input.full_name ?? null,
          company_name: input.company_name ?? null,
          phone: input.phone ?? null,
          status: input.status ?? 'new',
          metadata: input.metadata ?? {},
          captured_at: input.captured_at ?? new Date().toISOString(),
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        })
        .select('*')
        .single();
      throwOnError(error, 'createLead');
      return data as LeadRecord;
    },

    async getLeadById(id, organizationId) {
      const { data, error } = await db
        .from('leads')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getLeadById');
      return mapRow<LeadRecord>(data as Record<string, unknown> | null);
    },

    async getLeadByLegacyKey(legacyKvKey) {
      const { data, error } = await db
        .from('leads')
        .select('*')
        .eq('legacy_kv_key', legacyKvKey)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getLeadByLegacyKey');
      return mapRow<LeadRecord>(data as Record<string, unknown> | null);
    },

    async lookupLeadByEmail(organizationId, email) {
      const { data, error } = await db
        .from('leads')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('email', email.toLowerCase().trim())
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'lookupLeadByEmail');
      return mapRow<LeadRecord>(data as Record<string, unknown> | null);
    },

    async updateLead(id, organizationId, patch) {
      const { data, error } = await db
        .from('leads')
        .update({
          ...patch,
          email: patch.email ? patch.email.toLowerCase().trim() : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .select('*')
        .single();
      throwOnError(error, 'updateLead');
      return data as LeadRecord;
    },

    async listLeads(filter) {
      let q = db
        .from('leads')
        .select('*')
        .eq('organization_id', filter.organizationId)
        .is('deleted_at', null)
        .order('captured_at', { ascending: false });
      if (filter.status) q = q.eq('status', filter.status);
      if (filter.email) q = q.eq('email', filter.email.toLowerCase().trim());
      const limit = Math.min(filter.limit ?? 50, 200);
      const offset = filter.offset ?? 0;
      const { data, error } = await q.range(offset, offset + limit - 1);
      throwOnError(error, 'listLeads');
      return (data ?? []) as LeadRecord[];
    },

    async listLeadSources(organizationId) {
      const { data, error } = await db
        .from('lead_sources')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');
      throwOnError(error, 'listLeadSources');
      return (data ?? []) as LeadSourceRecord[];
    },

    async addLeadTag(leadId, organizationId, tag, createdBy = null) {
      const { data, error } = await db
        .from('lead_tags')
        .insert({
          organization_id: organizationId,
          lead_id: leadId,
          tag: tag.toLowerCase().trim(),
          created_by: createdBy,
        })
        .select('*')
        .single();
      throwOnError(error, 'addLeadTag');
      return data as LeadTagRecord;
    },

    async listLeadTags(leadId, organizationId) {
      const { data, error } = await db
        .from('lead_tags')
        .select('*')
        .eq('lead_id', leadId)
        .eq('organization_id', organizationId)
        .order('tag');
      throwOnError(error, 'listLeadTags');
      return (data ?? []) as LeadTagRecord[];
    },
  };
}
