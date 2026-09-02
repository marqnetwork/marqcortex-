/**
 * AI administration RBAC.
 *
 * Three administrative roles, resolved SERVER-SIDE from the same authenticated
 * subject the AI Guard uses. Nothing a caller can put in a header or a body
 * influences the outcome — the roles come from Supabase `user_metadata` and the
 * organization membership tables, both of which only the service-role admin API
 * can write.
 *
 *   super_admin           The platform operator. MARQ itself. Sees every
 *                         organization, may spend MARQ's money, may reset the
 *                         lifetime ceiling, may raise the cap.
 *
 *                         GRANTED ONLY BY `app_metadata.platform_role = 'admin'`
 *                         — the same trusted field `cortex.is_platform_admin()`
 *                         has always read, written by the service role and by
 *                         nothing the console exposes. No team role reaches it;
 *                         see `SUPER_ADMIN_ROLES` and finding M-B.
 *
 *   organization_admin    Full operational visibility across their
 *                         organizations. NO platform mutations — see the note
 *                         on the grant table below. Every switch on this
 *                         surface is currently platform-wide, and a tenant
 *                         administrator changing the execution path for other
 *                         tenants is not a scoped action.
 *
 *   team_admin            Operates a team inside an organization. Full
 *                         operational VISIBILITY — health, usage, cost, audit —
 *                         and no platform mutations.
 *
 * WHY ONLY THE PLATFORM OPERATOR WRITES, AND WHY THAT IS THE FEATURE.
 *
 * Every switch on this surface is platform-wide: the kill switch, the provider
 * order, the model pin, the retry curve, the daily ceilings. There is no "our
 * team's provider preference" and no "our organization's kill switch" — one
 * administrator turning off a provider changes every other tenant's execution
 * path. A role that can only be exercised safely by taking an action that
 * affects people outside its scope is not a safe role, so the writes stop at
 * super_admin and everyone else gets the thing they actually need: a truthful,
 * live, tenant-scoped view of what AI is doing and what it is costing.
 *
 * CAPABILITIES, NOT ROLE CHECKS, ARE WHAT THE SERVICE ENFORCES. Roles change as
 * an organization grows; the capability a given operation demands does not. The
 * grant table below is the only place the two are connected.
 */

import type { AuthenticatedSubject } from '../security/actor.ts';
import { flooredRoleNames, hasPlatformAuthority, PLATFORM_AUTHORITY_ROLES } from '../security/actor.ts';
import { AIError } from '../contracts/errors.ts';

export type AIAdminRole = 'super_admin' | 'organization_admin' | 'team_admin';

export type AIAdminCapability =
  /** Read settings, providers, health, usage and cost. */
  | 'ai.admin.view'
  /** Read the AI execution audit trail and the administrative change trail. */
  | 'ai.admin.audit.read'
  /** Change operational settings: retry, timeout, defaults, failover. */
  | 'ai.admin.settings.write'
  /** Enable, disable, certify or restrict a provider; pin a model. */
  | 'ai.admin.provider.write'
  /** Move the rolling daily allowances and the alert threshold. */
  | 'ai.admin.budget.write'
  /** Clear settled lifetime spend, or raise the MARQ-funded ceiling. */
  | 'ai.admin.budget.reset'
  /**
   * Read, clear or raise ONE ORGANIZATION'S own lifetime spend ledger
   * (AI-01 Batch 4D remediation, HIGH-1).
   *
   * SEPARATE FROM `ai.admin.budget.reset`, WHICH IS ITS WHOLE POINT. That
   * capability governs MARQ's own chequebook: the ceiling on money MARQ is
   * invoiced for. This one governs a ledger recording money a CUSTOMER is
   * invoiced for, on a key they supplied — a different estate, a different
   * blast radius, and a grant that must be movable without moving the other.
   *
   * Two directions, both closed by the split:
   *
   *   A future customer-facing budget role must be grantable WITHOUT handing
   *   out MARQ's platform budget administration. One capability for both would
   *   make that impossible to express.
   *
   *   A platform operator administering a tenant's ceiling is a governed act
   *   named in the trail as its own action, not something acquired implicitly
   *   by being able to administer MARQ's.
   */
  | 'ai.admin.budget.organization'
  /** Engage or release the master switch and the emergency kill switch. */
  | 'ai.admin.killswitch'
  // ── Provider administration (AI-01 Batch 4C) ──────────────────────────────
  //
  // FIVE capabilities, not one, and not folded into `ai.admin.provider.write`.
  //
  // `ai.admin.provider.write` already existed and governs the OPERATIONAL
  // switches on a registered adapter: enabled, model allow list, model pin.
  // Storing a vendor API key is a different act with a different blast radius —
  // it is the act that lets the platform spend money at a vendor under MARQ's
  // account — and it must be grantable and auditable on its own. Naming them
  // apart is what allows a future role to read provider state without being
  // able to replace the key the platform executes with.
  /** Read provider configuration, credential METADATA, models and health. */
  | 'ai.providers.view'
  /** Create a provider configuration; enable or disable a provider. */
  | 'ai.providers.manage'
  /** Set, rotate or revoke provider credentials. The strongest of the five. */
  | 'ai.providers.credentials.manage'
  /** Enable or disable a certified model on a provider. */
  | 'ai.providers.models.manage'
  /** Read the provider administration change trail. */
  | 'ai.providers.audit.read';

const VIEWER_CAPABILITIES: readonly AIAdminCapability[] = ['ai.admin.view', 'ai.admin.audit.read'];

/**
 * Every mutation on this surface is platform-wide, so every mutation is the
 * platform operator's.
 *
 * The original grant table gave an organization admin `settings.write`,
 * `provider.write`, `budget.write` and `killswitch`. Each of those changes ONE
 * settings record shared by every tenant, so an administrator of one
 * organization could halt AI, disable a provider, pin a model or move the daily
 * ceilings for all of them. An independent review demonstrated exactly that.
 *
 * The argument this module already made for team admins is the argument: "a
 * role that can only be exercised safely by taking an action that affects
 * people outside its scope is not a safe role". It was applied one tier too low.
 *
 * The organization tier therefore holds the viewer capabilities until there is
 * a genuinely organization-scoped layer for it to write — per-tenant feature
 * enablement and per-tenant ceilings, which is the natural next batch. The role
 * is kept distinct rather than collapsed into `team_admin` because it still
 * differs in scope: an organization admin's reads cover every team in their
 * organization, and the grant table is where a per-tenant write capability will
 * be added when the surface exists to write to.
 */
const ORGANIZATION_ADMIN_CAPABILITIES: readonly AIAdminCapability[] = [...VIEWER_CAPABILITIES];

/** Platform-wide mutations. Only the platform operator holds these. */
const PLATFORM_OPERATOR_CAPABILITIES: readonly AIAdminCapability[] = [
  'ai.admin.settings.write',
  'ai.admin.provider.write',
  'ai.admin.budget.write',
  'ai.admin.killswitch',
  'ai.admin.budget.reset',
  // Organization ledger administration (HIGH-1). HELD BY THE PLATFORM OPERATOR
  // AND BY NOBODY ELSE, and it is here for the reason this table already gives
  // rather than a new one: the operation names a tenant OTHER than the actor's
  // own, so it is not a scoped action and cannot belong to a scoped tier. A
  // customer administering their OWN organization's budget is a different
  // question, asked on the customer surface in `byok/byokRbac.ts` under
  // `ai.byok.*` — a separate vocabulary, deliberately, so widening one estate's
  // grants can never widen the other's.
  'ai.admin.budget.organization',
  // ── Provider administration, INCLUDING ITS READ (AI-01 Batch 4C) ──────────
  //
  // All five, platform operator only — and `ai.providers.view` being here
  // rather than in `VIEWER_CAPABILITIES` was a deliberate reversal during
  // implementation.
  //
  // The writes belong here by the argument this table already makes: MARQ's
  // provider estate is one estate, and a tenant administrator replacing the key
  // every other tenant executes through is not a scoped action.
  //
  // The READ belongs here for a narrower reason. The two lower tiers already
  // see provider state, certification, health and model lists through
  // `ai.admin.view` and `/ai/admin/providers`; nothing they had is taken away.
  // What `ai.providers.view` adds on top is the credential surface — which
  // credential is in force, its keyed fingerprint, its last four characters,
  // when it was rotated, which root key sealed it — together with the
  // platform's governed spending exposure. That is a strictly platform-level
  // picture of MARQ's own vendor accounts, and it does not become one tenant's
  // business by being adjacent to something that is.
  //
  // Granting it to the existing viewer tiers would also have silently widened
  // every current organization and team administrator's authority the day this
  // batch deployed, which the batch explicitly forbids. Batch 4D adds
  // ORGANIZATION-scoped provider configuration; the organization tier gains
  // capabilities over THAT surface — over its own rows — not over these.
  'ai.providers.view',
  'ai.providers.audit.read',
  'ai.providers.manage',
  'ai.providers.credentials.manage',
  'ai.providers.models.manage',
];

/**
 * Role → capability grants. Adding an operation is an edit to this table plus
 * one `requireCapability` call — never a role comparison at a call site, which
 * is how a check gets forgotten on the seventh endpoint.
 */
export const ADMIN_ROLE_CAPABILITIES: Readonly<Record<AIAdminRole, readonly AIAdminCapability[]>> = {
  super_admin: [...VIEWER_CAPABILITIES, ...PLATFORM_OPERATOR_CAPABILITIES],
  organization_admin: ORGANIZATION_ADMIN_CAPABILITIES,
  team_admin: VIEWER_CAPABILITIES,
};

/** Ordered by privilege, most privileged first. Used for reporting only. */
export const ADMIN_ROLE_RANK: readonly AIAdminRole[] = [
  'super_admin',
  'organization_admin',
  'team_admin',
];

/**
 * Roles that confer AI PLATFORM administration.
 *
 * FINDING M-B: `owner` used to be in this set. `owner` is a MARQ **team** role,
 * carried in `app_metadata.team_role`, assignable by any existing owner through
 * `PATCH /team/members/:id` and stampable by any reviewed roster. Being in this
 * set meant that becoming the top of one console's team hierarchy also handed
 * out the platform operator's capabilities: the emergency kill switch, the
 * provider configuration every tenant executes through, the global daily
 * ceilings, and the reset of MARQ's lifetime funded spend.
 *
 * Two vocabularies had been conflated. "Top of the team" and "operates the
 * platform" are different jobs, held by different people, granted through
 * different mechanisms — and the second one already had a mechanism.
 * `cortex.is_platform_admin()` has read `app_metadata ->> 'platform_role'`
 * since the tenancy migration; it is the authority every RLS policy in the
 * database already trusts. It is service-role-only, it is not written by any
 * console route, and `cortex.stamp_team_roster` merges rather than replaces the
 * metadata bag precisely so it cannot mint one.
 *
 * So this set now contains only names that arrive from THAT field, and no team
 * role can reach it: `resolvePlatformAuthority` in `teamAuthorization.ts` emits
 * `platform_admin` for `platform_role = 'admin'`, and `normalizeTeamRole`
 * cannot return any string outside `TEAM_ROLES` — of which none is here.
 *
 * A MARQ team owner keeps everything an owner is for. What they no longer get,
 * by accident, is the ability to turn off AI for every tenant on the platform.
 */
export const SUPER_ADMIN_ROLES: ReadonlySet<string> = PLATFORM_AUTHORITY_ROLES;

/**
 * Roles that confer organization-level administration.
 *
 * `owner` and `org_admin` land here, which is where the team hierarchy's top
 * belongs: full operational visibility across their organizations, and no
 * platform-wide mutation. `org_admin` is the seeded organization role key that
 * `admin` and `owner` map to, so a subject resolves to the same tier whether
 * the role reached them on the auth record or on the membership row.
 */
const ORGANIZATION_ADMIN_ROLES: ReadonlySet<string> = new Set([
  'organization_admin',
  'admin',
  'owner',
  'org_admin',
]);

/** Roles that confer read-only AI operations access. */
const TEAM_ADMIN_ROLES: ReadonlySet<string> = new Set([
  'team_admin',
  'consultant',
  'team_member',
]);

export interface AIAdminActor {
  readonly actorId: string;
  readonly email?: string;
  readonly role: AIAdminRole;
  readonly capabilities: readonly AIAdminCapability[];
  /**
   * Organizations whose data this actor may read. Empty means EVERY
   * organization, which only a super admin ever gets — see `scopeAllows`.
   */
  readonly organizationScope: readonly string[];
  /** Raw roles the identity provider reported, for the audit record. */
  readonly sourceRoles: readonly string[];
}

function lower(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter((value) => value !== '');
}

/**
 * Resolve the administrative role for an authenticated subject.
 *
 * Global roles are considered first and membership roles second, and the
 * HIGHEST role found wins. A subject with no qualifying role resolves to
 * `undefined` — there is no default administrative role, because a default here
 * would grant access on the strength of a missing row.
 */
export function resolveAdminRole(subject: AuthenticatedSubject): AIAdminRole | undefined {
  // Platform administration is GLOBAL-ONLY and explicit. A membership row is a
  // statement about one tenant, and no statement about one tenant may make
  // somebody the operator of the platform every tenant shares — so this test is
  // deliberately not applied to membership roles below.
  //
  // `hasPlatformAuthority` is THE test, shared with the agent and workflow
  // runtimes (HIGH-2). It reads `globalRoles` and nothing else, and this surface
  // asking the same function as the other two is what stops the three drifting
  // into three answers about the same subject.
  if (hasPlatformAuthority(subject)) return 'super_admin';

  // FLOORED, not unioned. The two authority sources — the trusted team role on
  // the auth record and the organization role on the membership row — can
  // disagree for as long as it takes the second half of a role change to land,
  // or forever if it failed. Reading a tier off the union means reading it off
  // whichever half is still stale, and this surface can read another tenant's
  // usage, cost and audit trail.
  //
  // The same floor `resolveActor` applies to capabilities, applied here to the
  // names: a stale `org_admin` row on an account demoted to `viewer` grants no
  // tier at all, and a stale `admin` team role beside a `team_viewer` row
  // grants none either.
  //
  // A membership resolved from a CACHE is not admitted here at all. Every
  // caller of this surface asks for an authoritative resolution
  // (`privileged: true`), so this never fires in practice — which is exactly
  // why it is cheap to make the failure mode of a future caller forgetting a
  // refusal rather than a tier granted off a stale row.
  const effectiveRoles = subject.membershipsFromCache
    ? lower(subject.globalRoles)
    : flooredRoleNames(subject);
  if (effectiveRoles.some((role) => ORGANIZATION_ADMIN_ROLES.has(role))) return 'organization_admin';
  if (effectiveRoles.some((role) => TEAM_ADMIN_ROLES.has(role))) return 'team_admin';
  return undefined;
}

/**
 * Build the administrative actor, or throw.
 *
 * `FORBIDDEN` rather than a silent empty result: an authenticated user who is
 * not an administrator asking for the administration surface is a decision the
 * platform should state, and record.
 */
export function resolveAdminActor(subject: AuthenticatedSubject | null): AIAdminActor {
  if (!subject) {
    throw new AIError('AUTH_REQUIRED', 'Authentication is required for AI administration.');
  }

  const role = resolveAdminRole(subject);
  if (role === undefined) {
    throw new AIError('FORBIDDEN', 'Your account is not permitted to administer AI.', {
      diagnostics: `subject=${subject.subjectId} roles=${subject.globalRoles.join(',') || 'none'}`,
      securityContext: {
        subjectId: subject.subjectId,
        actorType: subject.actorType,
        roles: lower(subject.globalRoles).sort(),
        organizationId: subject.memberships[0]?.organizationId,
      },
    });
  }

  const memberships = subject.memberships.map((membership) => membership.organizationId);
  return {
    actorId: subject.subjectId,
    email: subject.email,
    role,
    capabilities: ADMIN_ROLE_CAPABILITIES[role],
    // A super admin's scope is deliberately empty rather than "every id we
    // happen to know": the platform operator's view must not silently narrow to
    // whichever organizations they happen to hold a membership row for.
    organizationScope: role === 'super_admin' ? [] : [...new Set(memberships)].sort(),
    sourceRoles: [
      ...new Set([...lower(subject.globalRoles), ...subject.memberships.flatMap((m) => lower(m.roles))]),
    ].sort(),
  };
}

export function hasCapability(actor: AIAdminActor, capability: AIAdminCapability): boolean {
  return actor.capabilities.includes(capability);
}

/** Enforce a capability. Throws `FORBIDDEN`, naming nothing the caller can use. */
export function requireCapability(actor: AIAdminActor, capability: AIAdminCapability): void {
  if (hasCapability(actor, capability)) return;
  throw new AIError('FORBIDDEN', 'Your administrative role does not permit this action.', {
    diagnostics: `actor=${actor.actorId} role=${actor.role} required=${capability}`,
  });
}

/**
 * May this actor see records belonging to `organizationId`?
 *
 * An empty scope means unrestricted, which only a super admin holds. Everyone
 * else sees exactly the organizations they are a member of — the same tenant
 * boundary the execution path enforces, applied to the read side.
 */
export function scopeAllows(actor: AIAdminActor, organizationId: string): boolean {
  if (actor.organizationScope.length === 0) return actor.role === 'super_admin';
  return actor.organizationScope.includes(organizationId);
}

/** Filter records to what this actor may see. Never returns another tenant's row. */
export function scopeRecords<T>(
  actor: AIAdminActor,
  records: readonly T[],
  organizationIdOf: (record: T) => string,
): readonly T[] {
  if (actor.role === 'super_admin' && actor.organizationScope.length === 0) return records;
  return records.filter((record) => scopeAllows(actor, organizationIdOf(record)));
}
