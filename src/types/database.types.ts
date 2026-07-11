/**
 * Cortex database types — tenancy foundation (MCV2-S4-IMPLEMENT-001)
 * Hand-maintained until Supabase type generation is wired in CI.
 * Server-side and shared type reference only; no runtime DB access from frontend.
 */

export type OrganizationStatus = 'active' | 'suspended' | 'archived';
export type OrganizationPlan = 'standard' | 'enterprise' | 'internal';
export type RoleScope = 'platform' | 'organization';
export type MembershipStatus = 'active' | 'invited' | 'suspended';

export interface OrganizationRecord {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  plan: OrganizationPlan;
  timezone: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RoleRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: RoleScope;
  is_system: boolean;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PermissionRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface OrganizationMembershipRecord {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string;
  status: MembershipStatus;
  invited_by: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  role?: RoleRecord;
}

export interface OrganizationSettingsRecord {
  id: string;
  organization_id: string;
  settings: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface MembershipWithPermissions extends OrganizationMembershipRecord {
  permissions: string[];
}

/** Maps legacy Supabase Auth user_metadata.teamRole to system role keys */
export const LEGACY_TEAM_ROLE_MAP: Record<string, string> = {
  admin: 'org_admin',
  manager: 'org_admin',
  reviewer: 'team_member',
  viewer: 'team_viewer',
};

/**
 * Future authority resolution order (documented; not wired to runtime this sprint):
 * 1. organization_memberships + role_permissions
 * 2. Fallback: auth user_metadata.role === 'team' + teamRole via LEGACY_TEAM_ROLE_MAP
 * 3. Deny
 */
export type AuthoritySource = 'membership' | 'legacy_metadata' | 'denied';
