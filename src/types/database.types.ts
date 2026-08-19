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

/**
 * Team role -> system role key. The browser-side copy of
 * `TEAM_ROLE_TO_ORGANIZATION_ROLE` in
 * `supabase/functions/server/teamAuthorization.ts`, which is the definition;
 * this file cannot import across the Vite/Deno boundary, so
 * `tests/features/membershipRoleMapping.test.ts` imports both and fails if they
 * ever diverge.
 *
 * Two corrections from the previous version of this table, both deliberate:
 *
 *   `manager` is GONE. It is not a member of `TEAM_ROLES`, so
 *   `normalizeTeamRole('manager')` resolves to `viewer` — and this map used to
 *   send it to `org_admin`. One table said read-only, the other said
 *   organization administrator. Unrecognised values now resolve through
 *   `normalizeTeamRole` to `viewer` -> `team_viewer`, and this map no longer
 *   answers for keys the console cannot issue.
 *
 *   `owner`, `consultant` and `analyst` are present. They were missing, which
 *   made every lookup for them undefined rather than least-privileged.
 */
export const LEGACY_TEAM_ROLE_MAP: Record<string, string> = {
  viewer: 'team_viewer',
  reviewer: 'team_member',
  analyst: 'team_member',
  consultant: 'team_member',
  admin: 'org_admin',
  owner: 'org_admin',
};

/**
 * Authority resolution order.
 *
 * 1. `organization_memberships` + `role_permissions` — the only source that can
 *    establish organization membership. `listMemberships` in the edge entry
 *    point reads it, and it admits only an undeleted, `active` row in an
 *    undeleted organization.
 * 2. Team role only: `app_metadata.team_role`, on an account the server has
 *    STAMPED (`app_metadata.marq_team`). This decides what a team member may
 *    do, never which tenant they are in.
 * 3. Deny.
 *
 * `user_metadata` is writable by the account holder through GoTrue's
 * `PUT /auth/v1/user`, so it is never sufficient for (1) — and, since the
 * Batch 4A remediation of HIGH-2, it is not read for (2) either. The
 * `legacy_metadata` arm below is retained as a VOCABULARY entry for records
 * that predate the change; nothing resolves to it any more, because
 * `resolveTeamRoleFromAuthRecord` returns `null` for an unstamped account
 * rather than a role. An account that carried its role only in `user_metadata`
 * is now `denied` until an operator stamps it through the reviewed roster
 * artifact (`cortex.stamp_team_roster`).
 */
export type AuthoritySource = 'membership' | 'legacy_metadata' | 'denied';
