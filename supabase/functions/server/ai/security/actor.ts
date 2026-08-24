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
  /**
   * The TEAM role this membership row was last written at, recorded by the
   * membership write itself (`public.marq_sync_team_membership`, migration
   * 20260820120000) on the row it wrote.
   *
   * This is the "stronger trusted provenance" of HIGH-1. The organization role
   * KEY is ambiguous — `team_member` is what `reviewer`, `analyst` and
   * `consultant` all map to — so the key alone can only ever be read at its
   * WEAKEST meaning without letting a half-applied promotion widen authority.
   * This field says which of the three the row was actually written for, and it
   * moves only when the membership write succeeds. A promotion whose membership
   * write failed leaves it at the OLD role, which is exactly why reading it is
   * safe where reading the key's ceiling was not.
   *
   * Absent means absent, never "assume the top": `membershipAuthorityRank`
   * falls back to the key's weakest meaning, and provenance is clamped to the
   * key's ceiling so a row whose two halves disagree can never read higher than
   * the key alone could.
   */
  readonly teamRole?: string;
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
 * The LOWEST team role each organization role key can stand for.
 *
 * The mirror of `MEMBERSHIP_AUTHORITY_CEILING`, and it answers two questions.
 *
 * The first is the one it was written for: given an effective authority, may a
 * membership row carrying this key still mean anything? An `org_admin` row means
 * "admin or owner", so an account whose effective authority is `analyst` cannot
 * be standing behind one — the row is stale, and reading a tier off it would be
 * reading the stale half.
 *
 * The second is HIGH-1, and it is what this table now primarily decides: with no
 * trusted provenance saying otherwise, THIS is what a membership row is worth.
 * See `membershipAuthorityRank`.
 */
const MEMBERSHIP_AUTHORITY_FLOOR: Readonly<Record<string, AuthorityRole>> = {
  org_admin: 'admin',
  team_member: 'reviewer',
  team_viewer: 'viewer',
};

// ---------------------------------------------------------------------------
// HIGH-2 — A MEMBERSHIP ROW IS A STATEMENT ABOUT ONE TENANT, AND NOTHING MORE
// ---------------------------------------------------------------------------

/**
 * Role names that carry PLATFORM authority, in every vocabulary that reaches
 * this platform: the AI administration surface's `super_admin`, and the
 * `platform_admin` that `resolveTrustedGlobalRoles` emits for
 * `app_metadata.platform_role = 'admin'`.
 *
 * THESE ARE HONOURED FROM `globalRoles` AND FROM NOWHERE ELSE.
 *
 * `platform_admin` is a SEEDED ROW in `public.roles`
 * (`20260711050001_cortex_tenancy_rls_and_seed.sql`), so an
 * `organization_memberships` row can point its `role_id` at it and the
 * membership directory will faithfully report `roles: ['platform_admin']`. Until
 * this cut existed that row reached `AGENT_ROLE_CAPABILITIES` and
 * `WORKFLOW_ROLE_CAPABILITIES` by name and granted `agent.run.read.platform`,
 * `workflow.run.read.platform`, platform approvals and platform controls — to a
 * subject whose `globalRoles` were empty.
 *
 * Organization membership can never create platform authority. Not by naming a
 * platform role, and not by naming anything else the platform does not
 * recognise — see `MEMBERSHIP_ROLE_VOCABULARY`.
 */
export const PLATFORM_AUTHORITY_ROLES: ReadonlySet<string> = new Set([
  'platform_admin',
  'super_admin',
]);

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

function normalizeRoles(roles: readonly string[]): string[] {
  return roles.map(normalizeRole).filter((role) => role !== '');
}

/**
 * Does this subject hold explicit, trusted platform authority?
 *
 * Reads `globalRoles` only, which `index.tsx` fills from
 * `resolveTrustedGlobalRoles` — `app_metadata.platform_role`, the same field
 * `cortex.is_platform_admin()` governs the database with, writable by the
 * service role and by no console route. Memberships are not consulted, and that
 * is the whole point.
 */
export function hasPlatformAuthority(
  subject: Pick<AuthenticatedSubject, 'globalRoles'>,
): boolean {
  return normalizeRoles(subject.globalRoles).some((role) => PLATFORM_AUTHORITY_ROLES.has(role));
}

/**
 * The ONLY role names the platform will interpret when they arrive on a
 * membership row.
 *
 * Two vocabularies, because both legitimately reach `SubjectMembership.roles`:
 * the seeded organization role keys, and the team-ladder names a deployment may
 * carry on the row directly. Everything else — `platform_admin`, `super_admin`,
 * `service`, `organization_admin`, and any key an operator adds to
 * `public.roles` tomorrow — is DROPPED, not passed through.
 *
 * Dropping rather than clamping is deliberate. Every capability table on this
 * platform is keyed by role NAME, so a name that survives is a name that can be
 * granted against; the safe thing to do with a name whose authority the platform
 * cannot bound is to refuse to carry it at all. A membership row that names
 * nothing recognisable is a membership with no role, which
 * `membershipAuthorityRank` already scores as `viewer`.
 */
export const MEMBERSHIP_ROLE_VOCABULARY: ReadonlySet<string> = new Set<string>([
  'org_admin',
  'team_member',
  'team_viewer',
  ...AUTHORITY_LADDER,
]);

/** The membership's role names, minus anything the platform cannot bound. */
export function safeMembershipRoleNames(
  membership: SubjectMembership | undefined,
): readonly string[] {
  if (!membership) return [];
  return [
    ...new Set(
      normalizeRoles(membership.roles).filter((role) => MEMBERSHIP_ROLE_VOCABULARY.has(role)),
    ),
  ];
}

// ---------------------------------------------------------------------------
// HIGH-1 — AN AMBIGUOUS KEY IS WORTH ITS WEAKEST MEANING
// ---------------------------------------------------------------------------

/**
 * The highest rank the membership can stand for, read SAFELY.
 *
 * This used to take the CEILING of an ambiguous key — `team_member` was read as
 * `consultant`, the most privileged of the three team roles that map to it. That
 * is finding HIGH-1, and it is a widening:
 *
 *   A `reviewer` is promoted to `consultant`. `applyTeamRoleChange` writes the
 *   trusted `app_metadata` FIRST (it must; see `membershipLifecycle.ts`), then
 *   the membership. The membership write fails, and so does the compensating
 *   revert. The account is left with `app_metadata.team_role = 'consultant'` and
 *   a membership row that never moved — still `team_member`, because `reviewer`
 *   maps there too.
 *
 *   Read at the ceiling, both halves score `consultant` and the floor agrees at
 *   `consultant`. THE FAILED PROMOTION HANDED OUT `ai.analysis.run`,
 *   `ai.block.assist`, `ai.copilot.plan`, `ai.section.copilot` and
 *   `ai.agent.execute` — five capabilities the account did not hold before an
 *   operation that FAILED.
 *
 * So an ambiguous key is now worth its WEAKEST valid meaning, and the ceiling
 * survives only as a bound on trusted provenance:
 *
 *   `membership.teamRole` present  the team role the membership write recorded
 *                                  ON THE ROW, clamped to the key's ceiling. It
 *                                  moves only when a membership write succeeds,
 *                                  so a half-applied promotion leaves it at the
 *                                  OLD role — which is precisely why reading it
 *                                  is safe where reading the ceiling was not.
 *
 *   absent                         `MEMBERSHIP_AUTHORITY_FLOOR` — the weakest
 *                                  team role the key can stand for. A row with
 *                                  no provenance is not assumed to be the best
 *                                  case.
 *
 * Provenance is clamped, never trusted outright: `Math.min` against the key's
 * ceiling means a row whose two halves were written inconsistently can never
 * read higher than the key alone would have, and a provenance BELOW the key's
 * floor is taken at its lower word. Both directions fail low.
 *
 * A role the platform cannot read at all contributes nothing (see
 * `MEMBERSHIP_ROLE_VOCABULARY`), and a membership naming only such roles scores
 * `viewer`. The alternative would make an unreadable role key the widest one.
 */
export function membershipAuthorityRank(membership: SubjectMembership): number {
  const provenance = teamRank(membership.teamRole ?? '');
  let highest = 0;
  for (const key of safeMembershipRoleNames(membership)) {
    const ceiling = MEMBERSHIP_AUTHORITY_CEILING[key];
    let rank: number;
    if (ceiling !== undefined) {
      const ceilingRank = LADDER_RANK.get(ceiling) as number;
      const floorRank = LADDER_RANK.get(MEMBERSHIP_AUTHORITY_FLOOR[key]) as number;
      rank = provenance === undefined ? floorRank : Math.min(provenance, ceilingRank);
    } else {
      rank = LADDER_RANK.get(key) as number;
    }
    if (rank > highest) highest = rank;
  }
  return highest;
}

/** Rank meaning "no team authority at all", below every ladder entry. */
export const NO_AUTHORITY = -1;

/**
 * The rank the two authority sources AGREE on, or `undefined` when no floor
 * applies.
 *
 *   `undefined`      no floor — nothing to disagree with. A `service` actor, or
 *                    a subject with no membership resolved for this request.
 *   `NO_AUTHORITY`   a membership exists and the account carries no trusted
 *                    team role at all. `app_metadata` is the authority, so a
 *                    membership row standing alone is not one.
 *   0..5             the lower of the trusted team role and what the membership
 *                    row SAFELY stands for (`membershipAuthorityRank`).
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
    const agreed = Math.min(trusted, membershipAuthorityRank(candidate));
    if (agreed > highest) highest = agreed;
  }
  return highest;
}

/** The team role a rank names, or `undefined` for `NO_AUTHORITY`. */
export function authorityRoleForRank(rank: number): AuthorityRole | undefined {
  return rank < 0 ? undefined : AUTHORITY_LADDER[Math.min(rank, AUTHORITY_LADDER.length - 1)];
}

// ---------------------------------------------------------------------------
// THE CANONICAL EFFECTIVE-AUTHORITY MODEL
// ---------------------------------------------------------------------------

/**
 * What a subject may do, resolved ONCE, for every surface on this platform.
 *
 * Before this existed there were three entry points into overlapping logic —
 * `authorityFloor` for the AI control plane's capabilities, `flooredRoleNames`
 * for the administration tiers, `flooredRolesFor` for the agent and workflow
 * runtimes — and only the first of them applied a CAPABILITY clamp. The other
 * two handed a list of role NAMES to a capability table keyed by name, and a
 * name the floor did not recognise passed through untouched. That is how a
 * membership row carrying the seeded `platform_admin` role key reached
 * `AGENT_ROLE_CAPABILITIES.platform_admin` and granted
 * `agent.run.read.platform` (HIGH-2).
 *
 * So there is now one model, and the three surfaces are three readings of it:
 *
 *   `roles`         the canonical effective role names. Trusted global roles,
 *                   plus membership roles filtered to
 *                   `MEMBERSHIP_ROLE_VOCABULARY`, all clamped by the floor.
 *                   This is the ONLY list any capability table may be keyed by.
 *   `platform`      explicit, trusted platform authority. `globalRoles` only.
 *   `rank`/`teamRole`  the agreed position on the team ladder.
 *   `capabilities`  the AI capability ceiling the floor permits, or `undefined`
 *                   when no floor applies.
 *
 * TWO INVARIANTS HOLD BY CONSTRUCTION, and `tests/features/authorityModel.test.ts`
 * asserts them over the whole matrix:
 *
 *   effectiveCapabilities ⊆ trustedTeamCapabilities
 *   effectiveCapabilities ⊆ safeMembershipCapabilities
 *
 * from which the thing HIGH-1 asked for follows: a promotion whose membership
 * write did not land cannot add a capability, because the safe membership side
 * did not move.
 */
export interface EffectiveAuthority {
  /** The agreed ladder rank, `NO_AUTHORITY`, or `undefined` for no floor. */
  readonly rank: number | undefined;
  /** The team role that rank names. */
  readonly teamRole: AuthorityRole | undefined;
  /** Explicit, trusted platform authority. Never implied by a membership. */
  readonly platform: boolean;
  /** The canonical effective role names. The only list a grant table may read. */
  readonly roles: readonly string[];
  /** The AI capability ceiling, or `undefined` when no floor applies. */
  readonly capabilities: ReadonlySet<AICapability> | undefined;
}

/**
 * Resolve the canonical effective authority.
 *
 * `membership` names the organization a request already resolved into; omitting
 * it asks about the subject as a whole, across every membership they hold.
 */
export function resolveEffectiveAuthority(
  subject: AuthenticatedSubject,
  membership?: SubjectMembership,
): EffectiveAuthority {
  const considered = membership ? [membership] : subject.memberships;
  const rank = effectiveAuthorityRank(subject, membership);

  // Global roles pass through the floor as before: `service`, `platform_admin`
  // and anything else a deployment writes into trusted `app_metadata` is not
  // part of the two-system disagreement, and clamping it against a ladder it is
  // not on would revoke the platform's own actors.
  //
  // MEMBERSHIP roles do not get that pass. They are filtered to the vocabulary
  // FIRST, so a name the floor cannot bound never reaches the floor's
  // `return true` arm. This is the HIGH-2 cut, made once, for every surface.
  const names = [
    ...normalizeRoles(subject.globalRoles),
    ...considered.flatMap((candidate) => safeMembershipRoleNames(candidate)),
  ];

  return {
    rank,
    teamRole: rank === undefined ? undefined : authorityRoleForRank(rank),
    platform: hasPlatformAuthority(subject),
    roles: applyFloor(rank, names),
    capabilities: authorityCeiling(subject, membership),
  };
}

/**
 * The role names that survive the floor — the same decision `resolveActor`
 * makes about capabilities, expressed as names for the callers that reason
 * about tiers rather than capabilities (`admin/rbac.ts`).
 */
export function flooredRoleNames(subject: AuthenticatedSubject): readonly string[] {
  return resolveEffectiveAuthority(subject).roles;
}

/**
 * The same answer for a request already resolved into ONE organization.
 *
 * The per-request form, used by the agent and workflow runtimes: their actor is
 * scoped to the organization the request resolved into, so the floor must be
 * against that membership and not against the best of all of them. Passing
 * `undefined` for a subject that holds no membership in the resolved
 * organization leaves the trusted global roles alone, which is where
 * `resolveOrganization` has already failed the request closed for a team user.
 */
export function flooredRolesFor(
  subject: AuthenticatedSubject,
  membership: SubjectMembership | undefined,
): readonly string[] {
  if (!membership) return applyFloor(undefined, normalizeRoles(subject.globalRoles));
  return resolveEffectiveAuthority(subject, membership).roles;
}

function applyFloor(rank: number | undefined, roles: readonly string[]): readonly string[] {
  const all = normalizeRoles(roles);
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
 * The capability ceiling the two authority sources agree on, or `undefined`
 * when no floor applies.
 *
 * Written as the literal INTERSECTION the invariant names rather than as the
 * capabilities of the lower rank. Those two happen to coincide today, because
 * `ROLE_CAPABILITIES` is monotonic along `AUTHORITY_LADDER` — but "happens to
 * coincide" is the kind of property a future grant-table edit breaks in silence,
 * and the invariant is what must survive the edit, not the coincidence.
 * `tests/features/authorityModel.test.ts` asserts both halves independently.
 *
 * A floor applies only to a team user resolved against a membership — the two
 * systems that can disagree. A `service` actor holds no membership and no team
 * role, and clamping it against a ladder it is not on would revoke the
 * platform's own batch jobs.
 */
function authorityCeiling(
  subject: AuthenticatedSubject,
  membership: SubjectMembership | undefined,
): ReadonlySet<AICapability> | undefined {
  if (!membership) return undefined;
  if (subject.actorType !== 'team_user') return undefined;

  // The trusted half: what `app_metadata.team_role` alone permits. No trusted
  // team role at all is not rank zero — it is no team authority, and it grants
  // nothing.
  const trusted = trustedTeamRank(subject.globalRoles);
  if (trusted === undefined) return new Set<AICapability>();
  const trustedCapabilities = new Set(
    capabilitiesForRoles([AUTHORITY_LADDER[Math.min(trusted, AUTHORITY_LADDER.length - 1)]]),
  );

  // The membership half: what the row SAFELY stands for (HIGH-1).
  const safeRole = authorityRoleForRank(membershipAuthorityRank(membership));
  const safeCapabilities = new Set(capabilitiesForRoles(safeRole === undefined ? [] : [safeRole]));

  return new Set([...trustedCapabilities].filter((capability) => safeCapabilities.has(capability)));
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

  // ONE model, read here for capabilities and by `admin/rbac.ts`,
  // `agentRbac.ts` and `workflowRbac.ts` for names. `roles` has already had
  // membership-sourced names it cannot bound removed (HIGH-2) and the floor
  // applied; `capabilities` is the ceiling the two authority sources agree on.
  const authority = resolveEffectiveAuthority(subject, membership);
  const roles = authority.roles;

  const floor = authority.capabilities;
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

  // A PRIVILEGED CAPABILITY REQUIRES A VERIFIED MEMBERSHIP, ALWAYS.
  //
  // `AI_ALLOW_DEFAULT_ORGANIZATION` is false, and this does not depend on it
  // staying false. When a deployment turns the single-tenant fallback on,
  // `resolveOrganization` admits a team user who holds NO membership row at all
  // into the configured default organization — and without this, that user's
  // trusted `app_metadata` team role would grant them the full set on its own,
  // with no floor to clamp it because there is no membership to floor against.
  //
  // "Somebody stamped a team role on this account" and "this account is a
  // member of the tenant this request is for" are different facts, and the
  // second is the one that scopes a privileged action. So a team user resolved
  // into an organization they hold no verified membership in keeps the baseline
  // and nothing above it. The switch changes which tenant an unaffiliated
  // account lands in; it may not change what they can spend it on.
  const unverified =
    subject.actorType === 'team_user' && organizationId !== null && membership === undefined;
  if (unverified) {
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
    roles: [...new Set(roles)].sort(),
    // The audit-facing report: what the identity provider actually said, before
    // the floor and before the membership vocabulary filter. Read by nothing
    // that decides anything.
    sourceRoles: [
      ...new Set(
        [...subject.globalRoles, ...(membership?.roles ?? [])]
          .map((role) => role.trim().toLowerCase())
          .filter((role) => role !== ''),
      ),
    ].sort(),
    capabilities: [...granted].sort(),
  };
}
