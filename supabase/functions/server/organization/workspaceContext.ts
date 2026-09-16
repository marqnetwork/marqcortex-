/**
 * WHICH ORGANIZATION THIS WORKSPACE REPRESENTS.
 *
 * CP-3 asks Cortex to know six things, and this module answers the sixth:
 * which organization the current workspace IS. Everything else in the
 * organizational spine — people, departments, teams, reporting lines — is
 * owned by a tenant, so a console that cannot name its own tenant cannot
 * honestly show any of it.
 *
 * ONE SOURCE, AND IT IS THE MEMBERSHIP RELATIONSHIP
 *
 * The workspace is derived from `public.organization_memberships` through
 * `listVerifiedMemberships` and through nothing else. That function is the
 * canonical membership resolver — it already decides what an admitted
 * membership is (undeleted, active, in a live organization, carrying its role
 * key) and it is already proven behaviourally. Re-deriving any of that here
 * would be the second organizational architecture CP-3 forbids, and the two
 * copies would eventually disagree about who belongs where.
 *
 * NO CALLER-SUPPLIED ORGANIZATION REACHES THIS FUNCTION. The only input is an
 * authenticated user id. There is no parameter for a header, a body field or a
 * query string, so "act as organization X" is not a request this module can be
 * asked to honour — which is the CP-3 tenancy property the database proves at
 * its own layer, stated again at the layer above it.
 *
 * WHY AN ABSENT WORKSPACE HAS A REASON AND NOT JUST A NULL
 *
 * `listVerifiedMemberships` returns `[]` for five different situations: the
 * account has no membership, its membership is suspended or invited, its
 * membership was removed, its organization was erased, or the lookup itself
 * failed. Reporting all five as "no organization" would be the same class of
 * lie CP-1 removed from the data surfaces — an error answered with a plausible
 * empty state. So when there is no workspace, a SECOND read runs whose only
 * job is to say which of the five it was. That read grants nothing: it returns
 * a reason string, never a tenant.
 *
 * That second read is `listMembershipPresence`, and it lives in the canonical
 * membership module rather than here: exactly one module on the runtime path
 * may name `public.organization_memberships`, so that "which tenant is this
 * person in" can never grow a second implementation. This file writes no
 * query at all.
 *
 * The diagnostic read is also the reachability probe. It is the reason a
 * failed lookup can be told apart from a genuinely empty one at all —
 * `listVerifiedMemberships` swallows its own errors and returns `[]`, so
 * without a second read that answers, "the database is down" and "you belong
 * to nobody" would be indistinguishable.
 */

import {
  listMembershipPresence,
  listVerifiedMemberships,
  type MembershipQueryClient,
} from '../ai/adapters/membershipDirectory.ts';
import type { SubjectMembership } from '../ai/security/actor.ts';

/**
 * Why a session has no workspace.
 *
 * Each value names a DIFFERENT situation with a different remedy, and the
 * console says a different thing for each. Collapsing any two of them would
 * tell an operator to go and ask for an invitation when what actually happened
 * is that the database was unreachable.
 */
export type WorkspaceUnavailableReason =
  /** The account is a member of nothing. It needs an invitation. */
  | 'no-membership'
  /** A membership row exists, but it is `invited`, `suspended` or removed. */
  | 'membership-inactive'
  /** An active membership, in an organization the platform has soft-deleted. */
  | 'organization-removed'
  /** The organization exists but carries neither a name nor a slug to show. */
  | 'organization-unnamed'
  /** The read was refused. A misconfigured role, not an empty organization. */
  | 'permission-denied'
  /** The read failed. The answer is unknown, and unknown is not "none". */
  | 'lookup-failed';

/** The organization a session is acting inside. */
export interface Workspace {
  readonly organizationId: string;
  /** What to call it on screen. Never empty — see `workspaceFromMemberships`. */
  readonly organizationName: string;
  /** `organizations.slug`, or `''` when the verified row carried none. */
  readonly organizationSlug: string;
}

export interface WorkspaceResolution {
  readonly workspace: Workspace | null;
  /** Always set when `workspace` is null, and always null when it is not. */
  readonly reason: WorkspaceUnavailableReason | null;
  /**
   * How many OTHER live organizations this account is actively a member of.
   *
   * CP-3 gives a session ONE workspace, and the one it gets is the first by
   * organization id — deterministic, so two identical logins cannot land in
   * different tenants. This count is what stops that choice being silent: a
   * non-zero value means a real choice was made on the operator's behalf, and
   * it is recorded rather than discarded so the surface that eventually offers
   * a switcher has something true to build on.
   */
  readonly otherOrganizations: number;
}

function embedded(value: unknown): Record<string, unknown> | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as Record<string, unknown>)
    : undefined;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * What the verified memberships alone say about the workspace.
 *
 * Pure, and `null` when they say nothing at all — an empty list is not an
 * answer, it is the absence of one, and the caller has to go and find out why.
 *
 * The display name falls back to the slug when `organizations.name` is empty.
 * A slug is a real, human-readable identifier of the same organization, so
 * showing `marq` is true; showing a placeholder, or the words "Internal
 * Dashboard", would not be. When BOTH are empty there is nothing truthful left
 * to render and the resolution refuses rather than inventing a name.
 */
export function workspaceFromMemberships(
  memberships: readonly SubjectMembership[],
): WorkspaceResolution | null {
  if (memberships.length === 0) return null;

  // `listVerifiedMemberships` sorts by organization id, so "the first" is a
  // stable choice and not whatever the database happened to return first.
  const [chosen] = memberships;
  const otherOrganizations = memberships.length - 1;

  const name = typeof chosen.name === 'string' ? chosen.name.trim() : '';
  const slug = typeof chosen.slug === 'string' ? chosen.slug.trim() : '';
  const display = name !== '' ? name : slug;

  if (display === '') {
    return { workspace: null, reason: 'organization-unnamed', otherOrganizations };
  }

  return {
    workspace: {
      organizationId: chosen.organizationId,
      organizationName: display,
      organizationSlug: slug,
    },
    reason: null,
    otherOrganizations,
  };
}

/**
 * Given that no membership was verified, say which of the three data
 * situations produced that — never which grant to make.
 *
 * Precedence matters. An active, undeleted row that the verified read dropped
 * can only have been dropped because its organization is gone, so that case is
 * recognised first; otherwise a suspended row and an erased tenant would both
 * report as "inactive" and an operator would go and ask to be un-suspended for
 * an organization that no longer exists.
 */
export function diagnoseAbsentWorkspace(
  rows: unknown,
): 'no-membership' | 'membership-inactive' | 'organization-removed' {
  if (!Array.isArray(rows) || rows.length === 0) return 'no-membership';

  for (const row of rows as readonly Record<string, unknown>[]) {
    if (typeof row !== 'object' || row === null) continue;
    if (!isNullish(row.deleted_at)) continue;
    const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : '';
    if (status !== 'active') continue;

    const organization = embedded(row.organizations);
    // No embed, or a soft-deleted one: the tenant this live membership points
    // at is not there.
    if (!organization || !isNullish(organization.deleted_at)) return 'organization-removed';
  }

  return 'membership-inactive';
}

/**
 * A refusal and a breakage are not the same fact.
 *
 * `42501` is PostgreSQL's `insufficient_privilege`, which is what a missing
 * grant or a closed RLS policy produces. Everything else — a timeout, a broken
 * connection, a schema-cache miss — is an unknown, and unknown is reported as
 * unknown.
 */
export function classifyLookupFailure(error: unknown): 'permission-denied' | 'lookup-failed' {
  if (!error || typeof error !== 'object') return 'lookup-failed';
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === '42501') return 'permission-denied';
  if (typeof message === 'string' && /permission denied|not authorized|insufficient/i.test(message)) {
    return 'permission-denied';
  }
  return 'lookup-failed';
}

/**
 * Resolve the workspace for one authenticated user.
 *
 * The user id is the only input, for the reason stated at the top of this file:
 * there must be no parameter through which a caller could name a tenant.
 */
export async function resolveWorkspaceForUser(
  client: MembershipQueryClient,
  userId: string,
): Promise<WorkspaceResolution> {
  let verified: readonly SubjectMembership[] = [];
  try {
    verified = await listVerifiedMemberships(client, userId);
  } catch {
    // `listVerifiedMemberships` already returns `[]` on a query error; a throw
    // here means the client itself broke. Either way the diagnostic read below
    // is what decides whether this is "none" or "unknown".
    verified = [];
  }

  const resolved = workspaceFromMemberships(verified);
  if (resolved) return resolved;

  // This module writes no query of its own — see `listMembershipPresence` for
  // why every read of the membership table lives in one place.
  try {
    const { rows, error } = await listMembershipPresence(client, userId);
    if (error) {
      return { workspace: null, reason: classifyLookupFailure(error), otherOrganizations: 0 };
    }
    return { workspace: null, reason: diagnoseAbsentWorkspace(rows), otherOrganizations: 0 };
  } catch (err) {
    return { workspace: null, reason: classifyLookupFailure(err), otherOrganizations: 0 };
  }
}

/**
 * The wire shape the login response carries.
 *
 * A separate function so the route holds no shaping logic: what the server
 * sends and what `src/app/lib/session.ts` parses are described in one place
 * each, and a change to one is visible against the other.
 */
export function workspacePayload(resolution: WorkspaceResolution): {
  organization: Workspace | null;
  organizationUnavailableReason: WorkspaceUnavailableReason | null;
  otherOrganizations: number;
} {
  return {
    organization: resolution.workspace,
    organizationUnavailableReason: resolution.reason,
    otherOrganizations: resolution.otherOrganizations,
  };
}
