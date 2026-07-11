/**
 * Tenancy repository — server-side data access for organizations and memberships.
 * MCV2-S4-IMPLEMENT-001: Foundation only. Not wired to Hono routes this sprint.
 *
 * Uses service role client for server operations. Future user-scoped reads should
 * pass the caller JWT so RLS applies when runtime cutover begins.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';
import type {
  OrganizationMembershipRecord,
  OrganizationRecord,
  OrganizationSettingsRecord,
  MembershipWithPermissions,
  RoleRecord,
} from '../../../../src/types/database.types.ts';
import { TenancyRepositoryError, type TenancyRepository } from './types.ts';

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new TenancyRepositoryError(
      'Supabase service credentials are not configured',
      'DATABASE_ERROR',
    );
  }
  return createClient(url, key);
}

function mapOrganization(row: Record<string, unknown>): OrganizationRecord {
  return row as unknown as OrganizationRecord;
}

function mapMembership(row: Record<string, unknown>): OrganizationMembershipRecord {
  const role = row.roles as Record<string, unknown> | null | undefined;
  const base = row as unknown as OrganizationMembershipRecord;
  if (role && typeof role === 'object') {
    base.role = role as unknown as RoleRecord;
  }
  return base;
}

export function createTenancyRepository(client?: SupabaseClient): TenancyRepository {
  const db = client ?? serviceClient();

  return {
    async getOrganizationById(id: string): Promise<OrganizationRecord | null> {
      const { data, error } = await db
        .from('organizations')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) {
        throw new TenancyRepositoryError(error.message, 'DATABASE_ERROR');
      }
      return data ? mapOrganization(data) : null;
    },

    async getOrganizationBySlug(slug: string): Promise<OrganizationRecord | null> {
      const normalized = slug.toLowerCase().trim();
      const { data, error } = await db
        .from('organizations')
        .select('*')
        .eq('slug', normalized)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) {
        throw new TenancyRepositoryError(error.message, 'DATABASE_ERROR');
      }
      return data ? mapOrganization(data) : null;
    },

    async listUserMemberships(userId: string): Promise<OrganizationMembershipRecord[]> {
      const { data, error } = await db
        .from('organization_memberships')
        .select('*, roles(*)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .is('deleted_at', null);

      if (error) {
        throw new TenancyRepositoryError(error.message, 'DATABASE_ERROR');
      }
      return (data ?? []).map((row) => mapMembership(row as Record<string, unknown>));
    },

    async isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
      const { data, error } = await db
        .from('organization_memberships')
        .select('id')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .maybeSingle();

      if (error) {
        throw new TenancyRepositoryError(error.message, 'DATABASE_ERROR');
      }
      return Boolean(data);
    },

    async resolveMembershipWithPermissions(
      userId: string,
      organizationId: string,
    ): Promise<MembershipWithPermissions | null> {
      const { data, error } = await db
        .from('organization_memberships')
        .select(`
          *,
          roles (
            *,
            role_permissions (
              permissions ( key )
            )
          )
        `)
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .maybeSingle();

      if (error) {
        throw new TenancyRepositoryError(error.message, 'DATABASE_ERROR');
      }
      if (!data) return null;

      const membership = mapMembership(data as Record<string, unknown>);
      const role = (data as Record<string, unknown>).roles as Record<string, unknown> | null;
      const permissions: string[] = [];

      if (role && Array.isArray(role.role_permissions)) {
        for (const rp of role.role_permissions as Record<string, unknown>[]) {
          const perm = rp.permissions as Record<string, unknown> | null;
          if (perm && typeof perm.key === 'string') {
            permissions.push(perm.key);
          }
        }
      }

      return { ...membership, permissions };
    },

    async getOrganizationSettings(
      organizationId: string,
    ): Promise<OrganizationSettingsRecord | null> {
      const { data, error } = await db
        .from('organization_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (error) {
        throw new TenancyRepositoryError(error.message, 'DATABASE_ERROR');
      }
      return data ? (data as OrganizationSettingsRecord) : null;
    },

    async updateOrganizationSettings(
      organizationId: string,
      settings: Record<string, unknown>,
      updatedBy: string,
    ): Promise<OrganizationSettingsRecord> {
      const existing = await this.getOrganizationSettings(organizationId);
      const version = (existing?.version ?? 0) + 1;

      const { data, error } = await db
        .from('organization_settings')
        .upsert({
          organization_id: organizationId,
          settings,
          version,
          updated_by: updatedBy,
        }, { onConflict: 'organization_id' })
        .select('*')
        .single();

      if (error) {
        throw new TenancyRepositoryError(error.message, 'DATABASE_ERROR');
      }
      if (!data) {
        throw new TenancyRepositoryError(
          'Settings update returned no row',
          'DATABASE_ERROR',
        );
      }
      return data as OrganizationSettingsRecord;
    },
  };
}

/** Singleton for edge handlers (future sprints) */
let _defaultRepo: TenancyRepository | null = null;

export function getTenancyRepository(): TenancyRepository {
  if (!_defaultRepo) {
    _defaultRepo = createTenancyRepository();
  }
  return _defaultRepo;
}
