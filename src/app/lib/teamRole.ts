/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — Team Role Vocabulary (frontend mirror)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE SERVER IS THE AUTHORITY. `supabase/functions/server/teamAuthorization.ts`
 * declares `TEAM_ROLES` and every rule that acts on it. This module is a mirror
 * kept for the console's own display and affordance decisions, and
 * `tests/features/teamRoleVocabulary.test.ts` fails if the two ever disagree.
 *
 * WHY THIS FILE EXISTS
 *   `POST /auth/team/login` has always returned `user.teamRole`. The console
 *   threw it away twice over: `api.ts` declared the login response's user as
 *   `{id, email, name}`, and `session.ts`'s `normaliseTeamUser` rebuilt the
 *   object from exactly those three fields. So the signed-in member's role
 *   never reached a single component, and the console could not offer a
 *   role-appropriate experience even though the server had already resolved
 *   one. Separately, `TeamMemberRecord.teamRole` declared three roles where the
 *   server issues six, so an `analyst`, `consultant` or `owner` rendered in the
 *   team console as a "Viewer" with viewer permissions text beside their name.
 *
 * WHAT THIS IS NOT
 *   THIS IS NOT AUTHORIZATION. Nothing in the browser is. Every rule that
 *   matters — who may invite, re-role or remove a member, who may read which
 *   route — is enforced on the server against `app_metadata.team_role`, which
 *   a signed-in caller cannot write. A role carried here decides only what the
 *   console SHOWS: which navigation entries are worth surfacing, and which
 *   controls are worth offering. Hiding a control the server would refuse is a
 *   courtesy; showing one it would refuse is a bug, not a breach.
 *
 * FAIL-CLOSED
 *   `normalizeTeamRole` resolves anything unrecognised — a missing field, a
 *   role from a newer server, a corrupted stored session — to `viewer`, the
 *   LEAST privileged role, exactly as the server's function of the same name
 *   does. A data gap must never widen what the console offers.
 */

/**
 * Team roles, ordered by privilege. The index IS the rank, and the order is
 * the server's order verbatim — a test enforces that.
 */
export const TEAM_ROLES = ['viewer', 'reviewer', 'analyst', 'consultant', 'admin', 'owner'] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

/** The role a session resolves to when nothing usable was supplied. */
export const DEFAULT_TEAM_ROLE: TeamRole = 'viewer';

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && (TEAM_ROLES as readonly string[]).includes(value);
}

/** Privilege rank — higher is more privileged. Mirrors the server's `roleRank`. */
export function teamRoleRank(role: TeamRole): number {
  return TEAM_ROLES.indexOf(role);
}

/**
 * Normalise a role from any untrusted source (a login response, a stored
 * session, a member record). Fails closed to `viewer`.
 */
export function normalizeTeamRole(value: unknown): TeamRole {
  if (typeof value !== 'string') return DEFAULT_TEAM_ROLE;
  const normalized = value.trim().toLowerCase();
  return isTeamRole(normalized) ? normalized : DEFAULT_TEAM_ROLE;
}

/** How a role is named to the person holding it. */
export const TEAM_ROLE_LABELS: Readonly<Record<TeamRole, string>> = {
  viewer: 'Viewer',
  reviewer: 'Reviewer',
  analyst: 'Analyst',
  consultant: 'Consultant',
  admin: 'Admin',
  owner: 'Owner',
};

/**
 * What a role may do, in the words the console uses. These describe the
 * server's behaviour; they do not create it.
 */
export const TEAM_ROLE_DESCRIPTIONS: Readonly<Record<TeamRole, string>> = {
  viewer: 'Read-only across the workspace',
  reviewer: 'Reviews and signs off on work others produce',
  analyst: 'Works the pipeline and the analysis behind it',
  consultant: 'Owns engagements end to end, from diagnostic to delivery',
  admin: 'Everything a consultant can do, plus people and configuration',
  owner: 'Full authority over the workspace, including other admins',
};

/**
 * Roles the server permits to administer team membership
 * (`ADMIN_ROLES` in `teamAuthorization.ts`).
 *
 * Used to decide whether the console OFFERS the invite and re-role controls.
 * The server refuses them regardless of what the console shows.
 */
export const TEAM_ADMIN_ROLES: readonly TeamRole[] = ['admin', 'owner'];

export function canAdministerTeam(role: TeamRole): boolean {
  return TEAM_ADMIN_ROLES.includes(role);
}

/**
 * The roles a holder may assign to somebody else.
 *
 * Mirrors the server's rule that a caller may grant a role whose rank is
 * strictly BELOW their own, never at or above it. A non-administering role
 * gets an empty list — it may assign nothing at all.
 */
export function assignableRoles(role: TeamRole): readonly TeamRole[] {
  if (!canAdministerTeam(role)) return [];
  return TEAM_ROLES.filter(candidate => teamRoleRank(candidate) < teamRoleRank(role));
}
