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
 * The role is read from Supabase `user_metadata`, which is writable only through
 * the service-role admin API. That makes it a server-side fact rather than a
 * caller assertion — but only as long as the routes that write it are the ones
 * guarded here, which is why rule 1 and rule 3 are not optional.
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
