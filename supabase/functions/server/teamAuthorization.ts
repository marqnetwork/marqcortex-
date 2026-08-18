/**
 * Team role authorization for the console's administrative routes.
 *
 * The defect this closes: `POST /team/invite`, `PATCH /team/members/:id` and
 * `DELETE /team/members/:id` verified that the caller held *a* valid team token
 * and then acted on a `teamRole` taken straight from the request body. Any
 * authenticated team member — including a `viewer` — could create an admin, or
 * promote themselves to one, or delete anybody. Authentication was being used
 * where authorization was required.
 *
 * Three rules, and each one closes a distinct path to the same outcome:
 *
 *   1. Only an admin or owner may create, re-role or remove a team member.
 *   2. A role may only be assigned if it exists in the declared role table. A
 *      caller cannot invent `superadmin` and have it stored verbatim.
 *   3. A caller may never grant a role above their own, and may never change
 *      their own role at all — self-promotion is the escalation this is for,
 *      and "admin editing themselves" is indistinguishable from it.
 *
 * WHERE THE ROLE COMES FROM, AND WHY THAT CHANGED
 *
 * This file used to say that `user_metadata` is "writable only through the
 * service-role admin API". That is false, and the correction matters more than
 * the sentence did. GoTrue exposes `PUT /auth/v1/user`, and a signed-in caller
 * holding nothing but their own access token and the public anon key may write
 * their own `raw_user_meta_data`. A `viewer` could therefore set
 * `teamRole: 'owner'` on themselves. Every rule above is enforced on the way IN
 * to the admin routes; none of them is enforced on that endpoint, because it is
 * not ours.
 *
 * `app_metadata` (`auth.users.raw_app_meta_data`) is the field GoTrue refuses to
 * write for a user-scoped call — only the service role can set it. It is already
 * the platform's authority elsewhere: `cortex.is_platform_admin()` reads
 * `auth.jwt() -> 'app_metadata' ->> 'platform_role'`.
 *
 * So `app_metadata.team_role` is now the authority, written by the provisioning
 * routes in `index.tsx` and read by `resolveTeamRoleFromAuthRecord` below.
 * `user_metadata.teamRole` remains readable as a fallback for accounts
 * provisioned before this change — it grants no more than it did yesterday — but
 * it is never sufficient on its own to establish organization membership. That
 * decision reads `app_metadata` and nothing else (see
 * `20260818120000_marq_team_membership_bootstrap.sql`).
 */

/**
 * Team roles, ordered by privilege. The index IS the rank: a caller may assign
 * a role whose rank is strictly below their own, never at or above it.
 */
export const TEAM_ROLES = ['viewer', 'reviewer', 'analyst', 'consultant', 'admin', 'owner'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Roles permitted to administer team membership. */
const ADMIN_ROLES: readonly TeamRole[] = ['admin', 'owner'];

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && (TEAM_ROLES as readonly string[]).includes(value);
}

export function roleRank(role: TeamRole): number {
  return TEAM_ROLES.indexOf(role);
}

/**
 * Normalise a stored role.
 *
 * An unrecognised or missing value resolves to `viewer`, the LEAST privileged
 * role. The previous code defaulted a missing `teamRole` to `admin` in several
 * places, which turns a data gap into a privilege grant.
 */
export function normalizeTeamRole(value: unknown): TeamRole {
  if (typeof value !== 'string') return 'viewer';
  const normalized = value.trim().toLowerCase();
  return isTeamRole(normalized) ? normalized : 'viewer';
}

/**
 * THE ONE ROLE MAPPING.
 *
 * A team role (this file) becomes exactly one organization role key (the seeded
 * system catalog in `20260711050001_cortex_tenancy_rls_and_seed.sql`). Before
 * this existed there were four partial mappings — this file's `TEAM_ROLES`, the
 * SQL `CASE` in the bootstrap migration, `LEGACY_TEAM_ROLE_MAP` in
 * `src/types/database.types.ts` and a table in `MEMBERSHIP_BOOTSTRAP.md` — and
 * they disagreed. The disagreement was not cosmetic: `manager` was mapped to
 * `org_admin` by two of them while `normalizeTeamRole` resolves it to `viewer`,
 * so a bootstrap could have granted organization-admin authority to an account
 * the console itself treats as read-only.
 *
 * The map is keyed by `TeamRole`, so it cannot contain a role the console
 * cannot issue, and every `TeamRole` must appear. Anything unrecognised —
 * `manager` included — goes through `normalizeTeamRole` first and therefore
 * lands on `viewer`, the least privileged entry. A data gap never widens access.
 */
export const ORGANIZATION_ROLE_KEYS = ['org_admin', 'team_member', 'team_viewer'] as const;
export type OrganizationRoleKey = (typeof ORGANIZATION_ROLE_KEYS)[number];

export const TEAM_ROLE_TO_ORGANIZATION_ROLE: Readonly<Record<TeamRole, OrganizationRoleKey>> = {
  viewer: 'team_viewer',
  reviewer: 'team_member',
  analyst: 'team_member',
  consultant: 'team_member',
  admin: 'org_admin',
  owner: 'org_admin',
};

/** Normalise any stored role value and map it to its organization role key. */
export function organizationRoleForTeamRole(value: unknown): OrganizationRoleKey {
  return TEAM_ROLE_TO_ORGANIZATION_ROLE[normalizeTeamRole(value)];
}

/** The shape of the two metadata bags on a Supabase auth record. */
export interface AuthRecordMetadata {
  readonly app_metadata?: Record<string, unknown> | null;
  readonly user_metadata?: Record<string, unknown> | null;
}

/**
 * Is this auth record a server-provisioned MARQ team account?
 *
 * Reads `app_metadata` only. `user_metadata` is writable by the account holder
 * (see the header), so a `marq_team` flag there would be a self-service
 * membership claim.
 */
export function isProvisionedTeamAccount(record: AuthRecordMetadata | null | undefined): boolean {
  return record?.app_metadata?.marq_team === true;
}

/**
 * Resolve the team role from an auth record, strongest authority first.
 *
 * 1. `app_metadata.team_role` — only the service role can write it, so it wins
 *    whenever it is present.
 * 2. If the account is STAMPED (`app_metadata.marq_team`) but carries no role,
 *    `viewer`. A stamped account has been through a server-side provisioning
 *    path; a missing role there is a data gap, and reaching into
 *    `user_metadata` to fill it would hand the account holder the one field
 *    they can write.
 * 3. `user_metadata.teamRole` — the fallback for accounts provisioned before app
 *    metadata was written. It is not a server-only field; it grants what it
 *    granted yesterday and nothing more, and it never establishes organization
 *    membership. Stamping an account closes this branch for it permanently,
 *    which is what makes the fallback shrink over time rather than persist.
 *
 * Every branch runs through `normalizeTeamRole`, so none can produce a role
 * outside `TEAM_ROLES`, and every failure lands on `viewer`.
 */
export function resolveTeamRoleFromAuthRecord(
  record: AuthRecordMetadata | null | undefined,
): TeamRole {
  const asserted = record?.app_metadata?.team_role;
  if (typeof asserted === 'string' && asserted.trim() !== '') {
    return normalizeTeamRole(asserted);
  }
  if (isProvisionedTeamAccount(record)) return 'viewer';
  return normalizeTeamRole(record?.user_metadata?.teamRole);
}

/**
 * The `app_metadata` patch every server-side provisioning call must send.
 * Held here so the three call sites cannot drift into three shapes.
 */
export function teamAppMetadata(role: TeamRole): { marq_team: true; team_role: TeamRole } {
  return { marq_team: true, team_role: role };
}

export interface TeamAuthorizationFailure {
  readonly status: 401 | 403 | 400;
  readonly code: string;
  readonly message: string;
}

export type TeamAuthorizationResult =
  | { readonly ok: true; readonly callerRole: TeamRole }
  | { readonly ok: false; readonly failure: TeamAuthorizationFailure };

/** May this caller administer team membership at all? */
export function authorizeTeamAdmin(
  callerId: string | null,
  callerRole: TeamRole | null,
): TeamAuthorizationResult {
  if (!callerId) {
    return {
      ok: false,
      failure: { status: 401, code: 'UNAUTHORIZED', message: 'Authentication is required.' },
    };
  }
  if (!callerRole || !ADMIN_ROLES.includes(callerRole)) {
    return {
      ok: false,
      failure: {
        status: 403,
        code: 'FORBIDDEN',
        message: 'Only a team administrator may manage team members.',
      },
    };
  }
  return { ok: true, callerRole };
}

export interface RoleAssignmentRequest {
  readonly callerId: string;
  readonly callerRole: TeamRole;
  /** The member being created or modified. Absent when inviting a new user. */
  readonly targetId?: string;
  /** The role the caller is trying to assign. */
  readonly requestedRole: unknown;
  /** The target's current role, when they already exist. */
  readonly targetCurrentRole?: TeamRole;
}

export type RoleAssignmentResult =
  | { readonly ok: true; readonly role: TeamRole }
  | { readonly ok: false; readonly failure: TeamAuthorizationFailure };

/**
 * Validate a role assignment against the caller's own privilege.
 *
 * The rank comparison is strict on purpose. An admin who may mint another admin
 * can hand out their own level of access without an owner ever being involved,
 * which makes the privilege boundary decorative — one admin becomes every admin.
 */
export function authorizeRoleAssignment(request: RoleAssignmentRequest): RoleAssignmentResult {
  const { callerId, callerRole, targetId, requestedRole, targetCurrentRole } = request;

  if (!isTeamRole(requestedRole)) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: 'INVALID_ROLE',
        message: `teamRole must be one of: ${TEAM_ROLES.join(', ')}.`,
      },
    };
  }

  if (targetId !== undefined && targetId === callerId) {
    return {
      ok: false,
      failure: {
        status: 403,
        code: 'SELF_ROLE_CHANGE',
        message: 'You cannot change your own team role. Ask another administrator.',
      },
    };
  }

  if (roleRank(requestedRole) >= roleRank(callerRole)) {
    return {
      ok: false,
      failure: {
        status: 403,
        code: 'ROLE_ESCALATION',
        message: 'You cannot assign a role at or above your own.',
      },
    };
  }

  // Demoting or re-roling somebody who already outranks the caller is the same
  // escalation seen from the other end: it would let an admin remove an owner's
  // authority and then act unopposed.
  if (targetCurrentRole !== undefined && roleRank(targetCurrentRole) >= roleRank(callerRole)) {
    return {
      ok: false,
      failure: {
        status: 403,
        code: 'ROLE_ESCALATION',
        message: 'You cannot modify a member whose role is at or above your own.',
      },
    };
  }

  return { ok: true, role: requestedRole };
}

/** May this caller remove that member? */
export function authorizeMemberRemoval(request: {
  readonly callerId: string;
  readonly callerRole: TeamRole;
  readonly targetId: string;
  readonly targetCurrentRole?: TeamRole;
}): TeamAuthorizationResult {
  if (request.targetId === request.callerId) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: 'SELF_REMOVAL',
        message: 'You cannot remove yourself from the team.',
      },
    };
  }
  if (
    request.targetCurrentRole !== undefined &&
    roleRank(request.targetCurrentRole) >= roleRank(request.callerRole)
  ) {
    return {
      ok: false,
      failure: {
        status: 403,
        code: 'ROLE_ESCALATION',
        message: 'You cannot remove a member whose role is at or above your own.',
      },
    };
  }
  return { ok: true, callerRole: request.callerRole };
}
