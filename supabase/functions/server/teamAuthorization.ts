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
 * THE `user_metadata` FALLBACK IS GONE (HIGH-2)
 *
 * An earlier revision kept reading `user_metadata.teamRole` when an account
 * carried no `app_metadata.team_role`, on the reasoning that it "grants no more
 * than it did yesterday". What it granted yesterday was console team
 * ADMINISTRATION: an arbitrary authenticated Supabase account that wrote
 * `{"teamRole":"owner"}` into its own user metadata resolved as an `owner` and
 * passed `authorizeTeamAdmin`. Public signup being disabled was the only thing
 * standing in the way, and a signup setting is a product configuration, not an
 * authorization control.
 *
 * So there is now exactly one source of team authority, and it is
 * `app_metadata`:
 *
 *   `app_metadata.marq_team === true`  — this is a server-provisioned MARQ team
 *   account. Nothing else makes an account one.
 *
 *   `app_metadata.team_role`           — what that account may do.
 *
 * `user_metadata` is not read by any function in this file. It is a display
 * mirror the console writes for convenience and reads for nothing that matters.
 * Accounts provisioned before app metadata existed are NOT team accounts until
 * an operator stamps them through the reviewed roster artifact
 * (`architecture/database/MEMBERSHIP_BOOTSTRAP.md`, `cortex.stamp_team_roster`).
 * That is a deliberate fail-closed cut-over: an unstamped account is refused,
 * not quietly trusted.
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
 * What a request may claim about its caller, resolved from server-written
 * fields alone.
 *
 * Two facts, deliberately separate. `provisioned` answers "is this a MARQ team
 * account at all", which is the question the privileged routes must ask FIRST
 * — a stranger with a valid Supabase token is authenticated, and that is not
 * the same as being staff. `role` answers "what may they do", and is only ever
 * populated for a provisioned account.
 */
export interface TeamAuthority {
  /** `app_metadata.marq_team === true`. Server-written; the account holder
   *  cannot set it. */
  readonly provisioned: boolean;
  /** The team role, or `null` when the account is not a provisioned team
   *  account. Never inferred from `user_metadata`. */
  readonly role: TeamRole | null;
}

/** The authority of a caller who is not a team account at all. */
export const NO_TEAM_AUTHORITY: TeamAuthority = { provisioned: false, role: null };

/**
 * Resolve the trusted team authority carried by an auth record.
 *
 * Reads `app_metadata` and nothing else:
 *
 *   1. Not stamped (`app_metadata.marq_team !== true`) -> not a team account.
 *      No role, at all. This is the branch that closes HIGH-2: the record may
 *      carry `user_metadata.teamRole = 'owner'` and it changes nothing here.
 *   2. Stamped with a role -> that role, normalised. `normalizeTeamRole` cannot
 *      return a value outside `TEAM_ROLES`, so a corrupted or invented string
 *      lands on `viewer`.
 *   3. Stamped with no role -> `viewer`. A stamped account has been through a
 *      server-side provisioning path; a missing role there is a data gap, and a
 *      data gap must resolve to the least privilege, never to the most.
 */
export function resolveTeamAuthority(
  record: AuthRecordMetadata | null | undefined,
): TeamAuthority {
  if (!isProvisionedTeamAccount(record)) return NO_TEAM_AUTHORITY;
  const asserted = record?.app_metadata?.team_role;
  if (typeof asserted === 'string' && asserted.trim() !== '') {
    return { provisioned: true, role: normalizeTeamRole(asserted) };
  }
  return { provisioned: true, role: 'viewer' };
}

/**
 * The team role of an auth record, or `null` when it is not a provisioned team
 * account.
 *
 * The `null` return is the contract, not an inconvenience: every caller has to
 * decide what an unprovisioned account means to it, and none of them may decide
 * it means `viewer`-with-console-access. `resolveTeamAuthority` is the fuller
 * answer; this is the shorthand for the call sites that only need the role.
 */
export function resolveTeamRoleFromAuthRecord(
  record: AuthRecordMetadata | null | undefined,
): TeamRole | null {
  return resolveTeamAuthority(record).role;
}

/**
 * The `app_metadata` patch every server-side provisioning call must send.
 * Held here so the three call sites cannot drift into three shapes.
 */
export function teamAppMetadata(role: TeamRole): { marq_team: true; team_role: TeamRole } {
  return { marq_team: true, team_role: role };
}

export interface TeamAuthorizationFailure {
  readonly status: 401 | 403 | 400 | 404;
  readonly code: string;
  readonly message: string;
}

export type TeamAuthorizationResult =
  | { readonly ok: true; readonly callerRole: TeamRole }
  | { readonly ok: false; readonly failure: TeamAuthorizationFailure };

/**
 * May this caller administer team membership at all?
 *
 * THREE gates now, and the first one is the HIGH-2 fix:
 *
 *   1. Authenticated. No caller id, no authority.
 *   2. A PROVISIONED TEAM ACCOUNT. An authenticated stranger — a client-portal
 *      account, a self-service signup, anyone holding a valid Supabase token
 *      for this project — is refused here, before their role is even consulted.
 *      Previously this gate did not exist: the caller's role was resolved from
 *      metadata they could write, and a plausible-looking role was the whole
 *      credential.
 *   3. An administrative role.
 *
 * Gate 2 is reported separately from gate 3 (`NOT_A_TEAM_ACCOUNT` rather than
 * `FORBIDDEN`) because they are different facts and an operator reading a log
 * needs to tell "a colleague lacks the rank" from "a stranger tried".
 */
export function authorizeTeamAdmin(
  callerId: string | null,
  authority: TeamAuthority | null,
): TeamAuthorizationResult {
  if (!callerId) {
    return {
      ok: false,
      failure: { status: 401, code: 'UNAUTHORIZED', message: 'Authentication is required.' },
    };
  }
  if (!authority?.provisioned) {
    return {
      ok: false,
      failure: {
        status: 403,
        code: 'NOT_A_TEAM_ACCOUNT',
        message: 'This account is not a provisioned MARQ team account.',
      },
    };
  }
  const callerRole = authority.role;
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

/**
 * May this account be the TARGET of a team-management action?
 *
 * The mirror of `authorizeTeamAdmin`, and it closes a gap that gate cannot see.
 * `PATCH` and `DELETE` take a user id from the URL, and an administrator who
 * names an id that is not a team account would otherwise re-role or DELETE an
 * arbitrary `auth.users` row — a customer's, for instance. The rank guards do
 * not catch it: an account with no team role has no rank to compare against.
 *
 * `404` rather than `403`: the resource this route addresses is a team member,
 * and that id is not one. It also declines to tell a caller whether an
 * arbitrary account exists in the project at all.
 */
export function requireTeamAccountTarget(
  record: AuthRecordMetadata | null | undefined,
): { readonly ok: true; readonly role: TeamRole } | { readonly ok: false; readonly failure: TeamAuthorizationFailure } {
  const authority = resolveTeamAuthority(record);
  if (!authority.provisioned || !authority.role) {
    return {
      ok: false,
      failure: {
        status: 404,
        code: 'NOT_A_TEAM_ACCOUNT',
        message: 'That account is not a provisioned MARQ team account.',
      },
    };
  }
  return { ok: true, role: authority.role };
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
