/**
 * Actor resolution.
 *
 * Turns a bearer token into a fully-resolved `AIActor`: identity, roles and the
 * capability grants those roles imply. Authentication itself is a port
 * (`AIAuthenticator`) implemented at the edge against Supabase Auth — the
 * control plane core stays free of any auth vendor.
 *
 * Capabilities, not roles, are what the policy engine enforces. Roles are an
 * organizational convenience that changes over time; capabilities are the
 * stable contract a feature is written against.
 */

import type { AIActor, AIActorType } from '../contracts/request.ts';
import type { AICapability } from '../contracts/policy.ts';
import { AIError } from '../contracts/errors.ts';

/** One organization the subject belongs to, as the identity provider sees it. */
export interface SubjectMembership {
  readonly organizationId: string;
  readonly slug?: string;
  readonly tier?: 'internal' | 'standard' | 'enterprise';
  readonly roles: readonly string[];
}

export interface AuthenticatedSubject {
  readonly subjectId: string;
  readonly email?: string;
  readonly actorType: AIActorType;
  /** Roles that are not organization-scoped (platform admin, service). */
  readonly globalRoles: readonly string[];
  readonly memberships: readonly SubjectMembership[];
  /**
   * These memberships came from a cache and may be stale.
   *
   * Set by `createSupabaseAuthenticator` when it answers an ordinary request
   * from its snapshot. ABSENT MEANS AUTHORITATIVE, which is the honest default:
   * a subject assembled anywhere without a cache in front of it — a test, the
   * admin surface, a direct lookup — is exactly as fresh as its source.
   *
   * `resolveActor` withholds every `PRIVILEGED_CAPABILITIES` member from a
   * subject marked this way. That is belt to the guard's braces: the guard
   * already asks for an authoritative resolution whenever the feature it is
   * admitting needs one, and this makes the failure mode of forgetting to a
   * DENIAL rather than a stale grant.
   */
  readonly membershipsFromCache?: boolean;
}

/**
 * What the caller is about to do with the subject it is asking for.
 *
 * Only one thing is carried, and it is not a permission: `privileged` says
 * whether the answer is about to decide a capability an ordinary member does
 * not hold. An implementation that caches may serve an ordinary read from a
 * snapshot; it may not serve a privileged decision from one. See
 * `PRIVILEGED_CAPABILITIES` and `createSupabaseAuthenticator`.
 *
 * It is a HINT ABOUT FRESHNESS, never an assertion of authority: the worst a
 * caller can do by lying in either direction is ask for a slower answer or a
 * staler one, and the staler one is refused where it matters because the guard
 * derives this from the feature descriptor, not from the request.
 */
export interface AuthenticationContext {
  /** The capability this request will be authorized against, when known. */
  readonly requiredCapability?: AICapability;
  /**
   * Resolve authority from the source of truth rather than from any cached
   * snapshot. Derived from `requiredCapability` when the caller does not set it.
   */
  readonly privileged?: boolean;
}

/**
 * Capabilities no team member holds by default.
 *
 * Everything here requires an explicit role grant, which means everything here
 * is a decision a revocation must be able to take back AT ONCE — across edge
 * isolates, not only in the one that performed the revocation. A request for
 * one of these resolves memberships authoritatively; the two baseline
 * capabilities every authenticated team member already holds do not, because
 * making an ordinary chat turn pay for a database round trip buys no security
 * (there is nothing to revoke) and costs latency on every request.
 */
export const PRIVILEGED_CAPABILITIES: ReadonlySet<AICapability> = new Set<AICapability>([
  'ai.analysis.run',
  'ai.block.assist',
  'ai.copilot.plan',
  'ai.section.copilot',
  'ai.agent.execute',
]);

/** Does resolving this capability require an authoritative membership read? */
export function isPrivilegedCapability(capability: AICapability | undefined): boolean {
  return capability !== undefined && PRIVILEGED_CAPABILITIES.has(capability);
}

/** Should this authentication resolve authority from the source of truth? */
export function requiresAuthoritativeResolution(context?: AuthenticationContext): boolean {
  if (context?.privileged !== undefined) return context.privileged;
  return isPrivilegedCapability(context?.requiredCapability);
}

/**
 * Authentication port. Returns `null` for an absent or invalid credential —
 * it never throws for a bad token, because "unauthenticated" is an expected
 * outcome, not an exception.
 *
 * `context` is optional so every existing implementation still satisfies the
 * port. An implementation that ignores it is correct only if it never serves a
 * stale answer.
 */
export interface AIAuthenticator {
  authenticate(
    authorization: string | null,
    context?: AuthenticationContext,
  ): Promise<AuthenticatedSubject | null>;
}

/**
 * Role → capability grants. Declarative: granting a new role access to a
 * feature is an edit to this table, not to the execution path.
 */
export const ROLE_CAPABILITIES: Readonly<Record<string, readonly AICapability[]>> = {
  owner: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.block.assist',
    'ai.copilot.plan',
    'ai.section.copilot',
    'ai.agent.execute',
  ],
  admin: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.block.assist',
    'ai.copilot.plan',
    'ai.section.copilot',
    'ai.agent.execute',
  ],
  consultant: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.block.assist',
    'ai.copilot.plan',
    'ai.section.copilot',
    'ai.agent.execute',
  ],
  // Deliberately NOT granted `ai.agent.execute`. A reviewer reads and decides;
  // an agent run spends platform money and can call tools, and a role whose
  // job is to approve other people's work should not be able to start work
  // that then asks itself for approval.
  reviewer: ['ai.narrative.generate', 'ai.chat.converse'],
  analyst: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.agent.execute',
  ],
  /** Machine actors invoked by platform jobs (batch analysis, backfills). */
  service: ['ai.analysis.run', 'ai.narrative.generate', 'ai.agent.execute'],

  // ---------------------------------------------------------------------
  // ORGANIZATION ROLE KEYS
  //
  // The keys above are the console's team vocabulary, carried on the auth
  // record. The three below are the seeded system catalog in
  // `public.roles`, and they arrive on `SubjectMembership.roles`.
  //
  // Both vocabularies had to be here, because a role key that is not in this
  // table grants nothing. Until they were added, joining `roles(key)` into the
  // membership query changed what the query RETURNED and nothing about what
  // any actor could DO — an `org_admin` and a `team_viewer` still resolved to
  // the same capability set. The commit that added the join claimed otherwise;
  // this is the half that makes the claim true.
  //
  // The grants are set at the level the mapped team role already had, never
  // above it (`TEAM_ROLE_TO_ORGANIZATION_ROLE` in `teamAuthorization.ts`):
  //
  //   org_admin   <- admin, owner        => the admin grant, unchanged.
  //   team_member <- reviewer, analyst, consultant => the LEAST of the three,
  //                  which is `reviewer`. A membership row must not hand an
  //                  analyst capability to somebody the console calls a
  //                  reviewer, and the three collapse to one key here.
  //   team_viewer <- viewer              => nothing. `viewer` grants nothing
  //                  above, and read-only is the entire meaning of the role.
  //
  // Roles are additive: an actor holds their team role AND their membership
  // role, so a consultant keeps `ai.analysis.run` from `consultant` whatever
  // their membership key is. Nothing here can take a capability away, and
  // nothing here gives one the mapped team role did not already have.
  org_admin: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.block.assist',
    'ai.copilot.plan',
    'ai.section.copilot',
    'ai.agent.execute',
  ],
  team_member: ['ai.narrative.generate', 'ai.chat.converse'],
  team_viewer: [],
};

/**
 * Every authenticated team member gets this floor, so a member whose role row
 * is missing or misspelled is still able to use the console rather than
 * silently losing AI access. Escalation still requires an explicit role.
 */
const BASELINE_TEAM_CAPABILITIES: readonly AICapability[] = [
  'ai.narrative.generate',
  'ai.chat.converse',
];

export function capabilitiesForRoles(roles: readonly string[]): readonly AICapability[] {
  const granted = new Set<AICapability>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role.toLowerCase()] ?? []) {
      granted.add(capability);
    }
  }
  return [...granted].sort();
}

// ---------------------------------------------------------------------------
// THE AUTHORITY FLOOR — WHEN THE TWO SOURCES DISAGREE, THE LOWER ONE WINS
// ---------------------------------------------------------------------------

/**
 * A team account's authority is written in two systems that cannot be written
 * atomically: the trusted `app_metadata.team_role` on the GoTrue auth record,
 * and the row in `public.organization_memberships`. A role change therefore has
 * a window in which they disagree, and until this floor existed the union of
 * the two decided what the account could do — so the window granted the HIGHER
 * of the two roles.
 *
 * That is the whole of finding H-A, and reordering the two writes does not fix
 * it. Whichever is written first, the other one is briefly stale, and a union
 * hands the account whatever the stale half still says:
 *
 *   membership first  -> `app_metadata` still says `admin`  -> `ROLE_CAPABILITIES.admin`
 *                        keeps granting `ai.agent.execute`.
 *   metadata first    -> the membership row still says `org_admin` ->
 *                        `ROLE_CAPABILITIES.org_admin` keeps granting it.
 *
 * So the union is replaced by a FLOOR: an actor holds no more than the LOWER of
 * the two authorities. A revocation that lands in either system revokes, and a
 * grant takes effect only when both systems agree — which is the safe way round
 * for both directions.
 *
 * THIS CHANGES NOTHING IN A CONSISTENT STATE, BY CONSTRUCTION. Every team role
 * maps to an organization role whose grant is a subset of its own
 * (`TEAM_ROLE_TO_ORGANIZATION_ROLE`), so in agreement the floor is the team
 * role and the union was already the team role. The floor only ever bites while
 * the two disagree, which is exactly the window it exists for.
 */

/**
 * Team roles ordered by authority, least first. The index IS the rank.
 *
 * This is a copy of `TEAM_ROLES` in `teamAuthorization.ts`, and it is a copy
 * deliberately: the AI control plane takes no import from the console's server
 * modules, which is what keeps `ai/` runnable and testable on its own.
 * `tests/features/membershipRoleMapping.test.ts` reads both and fails if they
 * ever differ, so the copy cannot drift in silence.
 */
export const AUTHORITY_LADDER = [
  'viewer',
  'reviewer',
  'analyst',
  'consultant',
  'admin',
  'owner',
] as const;
export type AuthorityRole = (typeof AUTHORITY_LADDER)[number];

/**
 * Organization role key -> the most privileged team role that maps to it.
 *
 * The CEILING, not the equivalent, because the mapping is many-to-one: an
 * `org_admin` row could have come from an `admin` or an `owner`, and a
 * `team_member` row from a `reviewer`, an `analyst` or a `consultant`. Taking
 * the ceiling means the membership half of the floor never removes a capability
 * the two systems agree on — a consultant keeps `ai.analysis.run` — while still
 * capping what a stale membership row can grant on its own.
 */
export const MEMBERSHIP_AUTHORITY_CEILING: Readonly<Record<string, AuthorityRole>> = {
  org_admin: 'owner',
  team_member: 'consultant',
  team_viewer: 'viewer',
};

const LADDER_RANK: ReadonlyMap<string, number> = new Map(
  AUTHORITY_LADDER.map((role, index) => [role, index]),
);

/** Rank of a team role on the ladder, or `undefined` for anything not on it. */
function teamRank(role: string): number | undefined {
  return LADDER_RANK.get(role.trim().toLowerCase());
}

/**
 * The highest team-ladder rank the trusted global roles carry.
 *
 * `undefined` means the subject carries NO team role at all — an account that
 * is not a provisioned team account, or one whose trusted stamp has been
 * removed. That is not rank zero by accident: the caller below treats it as no
 * team authority whatsoever, which is what makes "unstamp the account" a real
 * revocation rather than a demotion to viewer.
 */
function trustedTeamRank(globalRoles: readonly string[]): number | undefined {
  let highest: number | undefined;
  for (const role of globalRoles) {
    const rank = teamRank(role);
    if (rank !== undefined && (highest === undefined || rank > highest)) highest = rank;
  }
  return highest;
}

/**
 * The highest rank the membership's roles can stand for.
 *
 * Both vocabularies are read, because both reach `SubjectMembership.roles`: the
 * seeded organization role keys (`org_admin`, `team_member`, `team_viewer`) and
 * the team names a deployment may carry on the row directly. An organization
 * key resolves to its CEILING — the most privileged team role that maps to it —
 * and a team name stands for itself.
 *
 * A role the platform cannot read at all resolves to rank 0, `viewer`, which
 * grants nothing. The alternative would make an unreadable role key the widest
 * one.
 */
function membershipRank(membership: SubjectMembership): number {
  let highest = 0;
  for (const role of membership.roles) {
    const key = role.trim().toLowerCase();
    const ceiling = MEMBERSHIP_AUTHORITY_CEILING[key];
    const rank = ceiling !== undefined
      ? (LADDER_RANK.get(ceiling) as number)
      : (LADDER_RANK.get(key) ?? 0);
    if (rank > highest) highest = rank;
  }
  return highest;
}

/**
 * The LOWEST team role each organization role key can stand for.
 *
 * The mirror of `MEMBERSHIP_AUTHORITY_CEILING`, and it answers the other
 * question: given an effective authority, may a membership row carrying this
 * key still mean anything? An `org_admin` row means "admin or owner", so an
 * account whose effective authority is `analyst` cannot be standing behind one
 * — the row is stale, and reading a tier off it would be reading the stale half.
 */
const MEMBERSHIP_AUTHORITY_FLOOR: Readonly<Record<string, AuthorityRole>> = {
  org_admin: 'admin',
  team_member: 'reviewer',
  team_viewer: 'viewer',
};

/** Rank meaning "no team authority at all", below every ladder entry. */
export const NO_AUTHORITY = -1;

/**
 * The rank the two authority sources AGREE on, or `undefined` when no floor
 * applies.
 *
 *   `undefined`      no floor — nothing to disagree with. A `service` actor, or
 *                    a subject with no membership resolved for this request.
 *   `NO_AUTHORITY`   a membership exists and the account carries no trusted
 *                    team role at all. `app_metadata` is the authority (HIGH-2),
 *                    so a membership row standing alone is not one.
 *   0..5             the lower of the trusted team role and what the membership
 *                    row can stand for.
 *
 * With `membership` named, the floor is against that one row — which is what a
 * request resolved into one organization needs. Without it, the floor is the
 * HIGHEST agreement across every membership the subject holds, which is what a
 * question about the subject as a whole ("may they administer anything?") needs.
 */
export function effectiveAuthorityRank(
  subject: AuthenticatedSubject,
  membership?: SubjectMembership,
): number | undefined {
  if (subject.actorType !== 'team_user') return undefined;

  const considered = membership ? [membership] : subject.memberships;
  if (considered.length === 0) return undefined;

  const trusted = trustedTeamRank(subject.globalRoles);
  if (trusted === undefined) return NO_AUTHORITY;

  let highest = NO_AUTHORITY;
  for (const candidate of considered) {
    const agreed = Math.min(trusted, membershipRank(candidate));
    if (agreed > highest) highest = agreed;
  }
  return highest;
}

/** The team role a rank names, or `undefined` for `NO_AUTHORITY`. */
export function authorityRoleForRank(rank: number): AuthorityRole | undefined {
  return rank < 0 ? undefined : AUTHORITY_LADDER[Math.min(rank, AUTHORITY_LADDER.length - 1)];
}

/**
 * The role names that survive the floor — the same decision `resolveActor`
 * makes about capabilities, expressed as names for the callers that reason
 * about tiers rather than capabilities (`admin/rbac.ts`).
 *
 * A ladder role survives when the agreed authority reaches it. A membership
 * role key survives when the agreed authority reaches the weakest team role
 * that key can stand for. Anything on neither vocabulary — `service`,
 * `platform_admin`, and any role a deployment writes into trusted
 * `app_metadata` directly — passes through untouched: those are not part of the
 * two-system disagreement, and clamping them against a ladder they are not on
 * would revoke the platform's own actors.
 */
export function flooredRoleNames(subject: AuthenticatedSubject): readonly string[] {
  return applyFloor(
    effectiveAuthorityRank(subject),
    [...subject.globalRoles, ...subject.memberships.flatMap((m) => m.roles)],
  );
}

/**
 * The same answer for a request already resolved into ONE organization.
 *
 * The per-request form, used by the agent and workflow runtimes: their actor is
 * scoped to the organization the request resolved into, so the floor must be
 * against that membership and not against the best of all of them. Passing
 * `undefined` for a subject that holds no membership in the resolved
 * organization leaves the global roles alone, which is where
 * `resolveOrganization` has already failed the request closed for a team user.
 */
export function flooredRolesFor(
  subject: AuthenticatedSubject,
  membership: SubjectMembership | undefined,
): readonly string[] {
  return applyFloor(
    membership ? effectiveAuthorityRank(subject, membership) : undefined,
    [...subject.globalRoles, ...(membership?.roles ?? [])],
  );
}

function applyFloor(rank: number | undefined, roles: readonly string[]): readonly string[] {
  const all = roles.map((role) => role.trim().toLowerCase()).filter((role) => role !== '');
  if (rank === undefined) return [...new Set(all)];

  return [
    ...new Set(
      all.filter((role) => {
        const floor = MEMBERSHIP_AUTHORITY_FLOOR[role];
        if (floor !== undefined) return rank >= (LADDER_RANK.get(floor) as number);
        const ladder = LADDER_RANK.get(role);
        if (ladder !== undefined) return rank >= ladder;
        return true;
      }),
    ),
  ];
}

/**
 * The capabilities the floor permits, or `undefined` when no floor applies.
 *
 * A floor applies only to a team user resolved against a membership — the two
 * systems that can disagree. A `service` actor holds no membership and no team
 * role, and clamping it against a ladder it is not on would revoke the
 * platform's own batch jobs.
 */
function authorityFloor(
  subject: AuthenticatedSubject,
  membership: SubjectMembership | undefined,
): ReadonlySet<AICapability> | undefined {
  if (!membership) return undefined;
  const rank = effectiveAuthorityRank(subject, membership);
  if (rank === undefined) return undefined;
  const role = authorityRoleForRank(rank);
  return role === undefined
    ? new Set<AICapability>()
    : new Set(capabilitiesForRoles([role]));
}

/**
 * Resolve the actor for a request. Throws `AUTH_REQUIRED` when the feature
 * needs an authenticated caller and none was supplied — anonymous execution is
 * only ever produced when the caller explicitly permits it.
 */
export function resolveActor(
  subject: AuthenticatedSubject | null,
  organizationId: string | null,
  options: { allowAnonymous: boolean },
): AIActor {
  if (!subject) {
    if (!options.allowAnonymous) {
      throw new AIError('AUTH_REQUIRED', 'Authentication is required for this AI feature.');
    }
    return {
      actorId: 'anonymous',
      actorType: 'anonymous',
      roles: [],
      capabilities: [],
    };
  }

  const membership = organizationId
    ? subject.memberships.find((m) => m.organizationId === organizationId)
    : undefined;

  const roles = [...subject.globalRoles, ...(membership?.roles ?? [])];

  // The union of both vocabularies, then the floor. The floor can only remove,
  // and it removes exactly what the two disagreeing systems do not both support
  // — see `authorityFloor`.
  const floor = authorityFloor(subject, membership);
  const granted = new Set<AICapability>(
    floor === undefined
      ? capabilitiesForRoles(roles)
      : capabilitiesForRoles(roles).filter((capability) => floor.has(capability)),
  );

  // A snapshot may be stale, so it may not be the reason anybody holds a
  // capability a revocation could have taken away. Applied after the floor and
  // before the baseline, because it only ever removes.
  if (subject.membershipsFromCache) {
    for (const capability of PRIVILEGED_CAPABILITIES) granted.delete(capability);
  }

  // The baseline is applied AFTER the floor, and that is not a hole in it:
  // `viewer` — the bottom of the ladder — holds exactly the baseline, so an
  // actor floored to the bottom lands on precisely what a viewer holds. Nothing
  // in the baseline is a `PRIVILEGED_CAPABILITIES` member.
  if (subject.actorType === 'team_user') {
    for (const capability of BASELINE_TEAM_CAPABILITIES) granted.add(capability);
  }

  return {
    actorId: subject.subjectId,
    actorType: subject.actorType,
    subjectId: subject.subjectId,
    email: subject.email,
    roles: [...new Set(roles.map((r) => r.toLowerCase()))].sort(),
    capabilities: [...granted].sort(),
  };
}
