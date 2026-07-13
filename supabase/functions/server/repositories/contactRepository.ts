/**
 * Contact repository — MCV2-S5-IMPLEMENT-002 (not wired to routes)
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';
import type {
  ContactListFilter,
  ContactMethodRecord,
  ContactRecord,
} from '../../../../src/types/diagnostic.database.types.ts';
import type { ContactRepository } from './diagnosticTypes.ts';
import { createServiceClient, mapRow, throwOnError } from './repositoryClient.ts';

export function createContactRepository(client?: SupabaseClient): ContactRepository {
  const db = client ?? createServiceClient();

  return {
    async createContact(input) {
      const { data, error } = await db
        .from('contacts')
        .insert({
          organization_id: input.organization_id,
          legacy_kv_key: input.legacy_kv_key ?? null,
          full_name: input.full_name ?? null,
          company_name: input.company_name ?? null,
          primary_email: input.primary_email?.toLowerCase().trim() ?? null,
          metadata: input.metadata ?? {},
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        })
        .select('*')
        .single();
      throwOnError(error, 'createContact');
      return data as ContactRecord;
    },

    async getContactById(id, organizationId) {
      const { data, error } = await db
        .from('contacts')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'getContactById');
      return mapRow<ContactRecord>(data as Record<string, unknown> | null);
    },

    async lookupContactByEmail(organizationId, email) {
      const { data, error } = await db
        .from('contacts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('primary_email', email.toLowerCase().trim())
        .is('deleted_at', null)
        .maybeSingle();
      throwOnError(error, 'lookupContactByEmail');
      return mapRow<ContactRecord>(data as Record<string, unknown> | null);
    },

    async updateContact(id, organizationId, patch) {
      const { data, error } = await db
        .from('contacts')
        .update({
          ...patch,
          primary_email: patch.primary_email
            ? patch.primary_email.toLowerCase().trim()
            : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .select('*')
        .single();
      throwOnError(error, 'updateContact');
      return data as ContactRecord;
    },

    async listContacts(filter) {
      let q = db
        .from('contacts')
        .select('*')
        .eq('organization_id', filter.organizationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (filter.primaryEmail) {
        q = q.eq('primary_email', filter.primaryEmail.toLowerCase().trim());
      }
      const limit = Math.min(filter.limit ?? 50, 200);
      const offset = filter.offset ?? 0;
      const { data, error } = await q.range(offset, offset + limit - 1);
      throwOnError(error, 'listContacts');
      return (data ?? []) as ContactRecord[];
    },

    async addContactMethod(input) {
      const { data, error } = await db
        .from('contact_methods')
        .insert({
          organization_id: input.organization_id,
          contact_id: input.contact_id,
          method_type: input.method_type,
          value: input.value,
          is_primary: input.is_primary ?? false,
          created_by: input.created_by ?? null,
          updated_by: input.updated_by ?? null,
        })
        .select('*')
        .single();
      throwOnError(error, 'addContactMethod');
      return data as ContactMethodRecord;
    },

    async listContactMethods(contactId, organizationId) {
      const { data, error } = await db
        .from('contact_methods')
        .select('*')
        .eq('contact_id', contactId)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .order('is_primary', { ascending: false });
      throwOnError(error, 'listContactMethods');
      return (data ?? []) as ContactMethodRecord[];
    },
  };
}
