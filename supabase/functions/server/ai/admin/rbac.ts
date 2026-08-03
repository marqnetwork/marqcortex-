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
  /** Engage or release the master switch and the emergency kill switch. */
  | 'ai.admin.killswitch';

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
 * Platform-global roles that confer super admin.
 *
 * `owner` is included because the console's own role table (`teamAuthorization.ts`)
 * makes owner the top of the team hierarchy, and a platform whose owner cannot
 * administer its AI has an operational gap that somebody will close with a
 * database edit.
 */
const SUPER_ADMIN_ROLES: ReadonlySet<string> = new Set(['super_admin', 'platform_admin', 'owner']);

/** Roles that confer organization-level administration. */
const ORGANIZATION_ADMIN_ROLES: ReadonlySet<string> = new Set(['organization_admin', 'admin']);

/** Roles that confer read-only AI operations access. */
const TEAM_ADMIN_ROLES: ReadonlySet<string> = new Set(['team_admin', 'consultant']);

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
  const globalRoles = lower(subject.globalRoles);
  if (globalRoles.some((role) => SUPER_ADMIN_ROLES.has(role))) return 'super_admin';

  const membershipRoles = subject.memberships.flatMap((membership) => lower(membership.roles));
  if (membershipRoles.some((role) => SUPER_ADMIN_ROLES.has(role))) {
    // An owner OF ONE ORGANIZATION is not the platform operator. They get the
    // organization tier; conflating the two would hand a tenant the ability to
    // clear MARQ's spend ceiling.
    return 'organization_admin';
  }

  const allRoles = [...globalRoles, ...membershipRoles];
  if (allRoles.some((role) => ORGANIZATION_ADMIN_ROLES.has(role))) return 'organization_admin';
  if (allRoles.some((role) => TEAM_ADMIN_ROLES.has(role))) return 'team_admin';
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
