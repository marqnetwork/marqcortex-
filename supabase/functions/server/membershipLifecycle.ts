/**
 * THE MEMBERSHIP LIFECYCLE.
 *
 * A MARQ team account is two facts held in two systems: the trusted
 * `app_metadata` on the GoTrue auth record, and the row in
 * `public.organization_memberships` that puts the account in the MARQ
 * organization at a mapped role. Before this module existed the console wrote
 * the first and never the second, and the consequences were the two blockers
 * this file closes:
 *
 *   HIGH-1  `PATCH /team/members/:id` demoted an admin to viewer by rewriting
 *           `app_metadata` alone. The membership row kept its `org_admin`
 *           `role_id`, `ROLE_CAPABILITIES.org_admin` kept granting
 *           `ai.agent.execute`, and the demotion revoked nothing that mattered.
 *
 *   MED-1   `POST /team/invite` created an account with trusted `app_metadata`
 *           and no membership at all. Every new hire authenticated
 *           successfully and then failed `ORGANIZATION_REQUIRED` at
 *           `resolveOrganization` — the bootstrap migration was the only thing
 *           that ever created a membership, and re-running a migration is not a
 *           hiring process.
 *
 * WHAT "AUTHORITATIVE" MEANS HERE
 *
 * The membership write is a single server-side database function
 * (`public.marq_sync_team_membership`, migration 20260818130000). It takes a
 * user id and a TEAM role, and resolves everything else itself: the MARQ
 * organization by slug, the system role by key from the seeded catalog, the
 * existing row by `(organization, user)`. No `organization_id` and no `role_id`
 * crosses the wire, so nothing a browser can send can steer which tenant a
 * membership lands in or which role it carries. The function is one statement
 * from the caller's point of view, so a role change cannot half-happen inside
 * the database.
 *
 * ORDERING, AND WHY IT IS NOT ARBITRARY
 *
 * Two systems cannot be written atomically, so the order is chosen to make the
 * only reachable partial state the safe one:
 *
 *   DEMOTION (the new role ranks lower) — membership FIRST. If the second write
 *   fails, the account has already lost the organization capability and still
 *   holds the old team role, which is strictly less than it had. Revocation
 *   that half-completes must still revoke.
 *
 *   PROMOTION or a lateral move — `app_metadata` first. Either order grants
 *   something before the other lands, and this is a grant an administrator has
 *   already authorised; the ordering rule that matters is the demotion one.
 *
 * In both directions a failed second write triggers a compensating revert of
 * the first, and a failed compensation is reported as an inconsistency rather
 * than swallowed. The route returns a failure in every one of those cases: a
 * role change that did not fully apply must not answer `200`.
 *
 * NO SECOND ROLE MAPPING
 *
 * `TEAM_ROLE_TO_ORGANIZATION_ROLE` in `teamAuthorization.ts` is the mapping.
 * This module imports it; it does not restate it. The SQL side reads the same
 * table through `cortex.organization_role_for_team_role`, and
 * `tests/features/membershipRoleMapping.test.ts` fails if the two disagree.
 */

import {
  normalizeTeamRole,
  organizationRoleForTeamRole,
  roleRank,
  type OrganizationRoleKey,
  type TeamRole,
} from './teamAuthorization.ts';

// ---------------------------------------------------------------------------
// Results and ports
// ---------------------------------------------------------------------------

export type MembershipAction = 'created' | 'role_changed' | 'unchanged' | 'reactivated';

export interface MembershipSyncResult {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly roleKey: OrganizationRoleKey;
  readonly action: MembershipAction;
}

export interface MembershipRevokeResult {
  readonly organizationId: string | null;
  readonly revoked: number;
}

/**
 * The membership half of the lifecycle. Two operations, both authoritative,
 * neither taking an organization or a role id from its caller.
 */
export interface MembershipLifecyclePort {
  /** Create or re-role this user's MARQ membership at the mapped role. */
  sync(userId: string, teamRole: TeamRole): Promise<MembershipSyncResult>;
  /** Soft-delete this user's active MARQ membership. Safe when there is none. */
  revoke(userId: string): Promise<MembershipRevokeResult>;
}

/**
 * The auth-record half. `writeTeamRole` writes the trusted `app_metadata`
 * patch; `removeAccount` is the compensating action for an invite whose
 * membership could not be created — an account with trusted team metadata and
 * no membership is precisely the MED-1 state, so it is not left behind.
 */
export interface TeamAccountPort {
  writeTeamRole(userId: string, role: TeamRole): Promise<void>;
  removeAccount(userId: string): Promise<void>;
}

export interface TeamLifecycleDeps {
  readonly membership: MembershipLifecyclePort;
  readonly account: TeamAccountPort;
  /**
   * Drop this user from the authenticator's membership cache. Without it a
   * demotion takes up to the cache TTL to reach the AI path, and "immediately"
   * would be a claim the code does not make.
   */
  readonly invalidate?: (userId: string) => void;
  readonly log?: (message: string) => void;
}

export interface LifecycleFailure {
  readonly status: 500 | 409;
  readonly code:
    | 'MEMBERSHIP_PROVISIONING_FAILED'
    | 'MEMBERSHIP_SYNC_FAILED'
    | 'MEMBERSHIP_INCONSISTENT'
    | 'MEMBERSHIP_REVOCATION_FAILED';
  readonly message: string;
  readonly diagnostics: string;
}

export type LifecycleResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: LifecycleFailure };

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The organization role a team role maps to. One import, no local table. */
export function organizationRoleFor(role: unknown): OrganizationRoleKey {
  return organizationRoleForTeamRole(role);
}

// ---------------------------------------------------------------------------
// CREATE / INVITE
// ---------------------------------------------------------------------------

/**
 * Finish provisioning an account that has just been created with trusted
 * `app_metadata`.
 *
 * The membership is not optional and its failure is not cosmetic: an account
 * that exists with `marq_team: true` and no membership row is a person who can
 * log into the console and cannot do anything, and re-running the bootstrap
 * migration is the only thing that would ever have fixed it. So a failed
 * membership write UNDOES the account creation and the invite reports a
 * failure. Half a hire is worse than none — the operator retries and gets a
 * whole one.
 *
 * If the compensating delete also fails, the account is reported as orphaned by
 * id. That is a loud, actionable inconsistency; silently returning success
 * would recreate MED-1 with a passing test suite over it.
 */
export async function completeTeamProvisioning(
  deps: TeamLifecycleDeps,
  input: { readonly userId: string; readonly role: TeamRole },
): Promise<LifecycleResult<MembershipSyncResult>> {
  const role = normalizeTeamRole(input.role);
  try {
    const membership = await deps.membership.sync(input.userId, role);
    deps.invalidate?.(input.userId);
    return { ok: true, value: membership };
  } catch (error) {
    const cause = detail(error);
    try {
      await deps.account.removeAccount(input.userId);
      deps.invalidate?.(input.userId);
      deps.log?.(
        `[membership] invite rolled back: ${input.userId} could not be given a MARQ membership (${cause})`,
      );
      return {
        ok: false,
        failure: {
          status: 500,
          code: 'MEMBERSHIP_PROVISIONING_FAILED',
          message:
            'The account could not be given its MARQ organization membership and was not created. No changes were kept.',
          diagnostics: `user=${input.userId} role=${role} cause=${cause}`,
        },
      };
    } catch (removalError) {
      deps.log?.(
        `[membership] ORPHANED ACCOUNT ${input.userId}: membership failed (${cause}) and the account could not be removed (${detail(removalError)})`,
      );
      return {
        ok: false,
        failure: {
          status: 500,
          code: 'MEMBERSHIP_INCONSISTENT',
          message:
            'The account was created but has no organization membership, and could not be removed. It requires operator attention.',
          diagnostics:
            `user=${input.userId} role=${role} cause=${cause} removal=${detail(removalError)}`,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// ROLE CHANGE
// ---------------------------------------------------------------------------

/**
 * Move a team account to a new role in both systems.
 *
 * See the header for why the order depends on the direction. `previousRole` is
 * the role the route already read to make its rank decision; passing it here
 * costs nothing and is what lets the compensating revert put back a real value
 * rather than a guess.
 */
export async function applyTeamRoleChange(
  deps: TeamLifecycleDeps,
  input: {
    readonly userId: string;
    readonly previousRole: TeamRole;
    readonly nextRole: TeamRole;
  },
): Promise<LifecycleResult<MembershipSyncResult>> {
  const previousRole = normalizeTeamRole(input.previousRole);
  const nextRole = normalizeTeamRole(input.nextRole);
  const isDemotion = roleRank(nextRole) < roleRank(previousRole);

  const writeMembership = async () => deps.membership.sync(input.userId, nextRole);
  const writeAccount = async () => deps.account.writeTeamRole(input.userId, nextRole);

  if (isDemotion) {
    // Membership first: the capability is gone before anything else can fail.
    let membership: MembershipSyncResult;
    try {
      membership = await writeMembership();
    } catch (error) {
      return {
        ok: false,
        failure: {
          status: 500,
          code: 'MEMBERSHIP_SYNC_FAILED',
          message: 'The role change was not applied. The member keeps their previous role.',
          diagnostics: `user=${input.userId} ${previousRole}->${nextRole} stage=membership cause=${detail(error)}`,
        },
      };
    }
    deps.invalidate?.(input.userId);

    try {
      await writeAccount();
    } catch (error) {
      // The membership is already at the LOWER role, so the account holds less
      // than it did, not more. Restoring the old membership would re-grant what
      // the administrator just revoked, so this compensation deliberately does
      // not run — the state is reported instead.
      deps.log?.(
        `[membership] partial demotion for ${input.userId}: membership is ${nextRole}, app_metadata is still ${previousRole} (${detail(error)})`,
      );
      return {
        ok: false,
        failure: {
          status: 500,
          code: 'MEMBERSHIP_INCONSISTENT',
          message:
            'The organization capability was revoked but the team role could not be updated. Retry the change.',
          diagnostics:
            `user=${input.userId} ${previousRole}->${nextRole} stage=app_metadata ` +
            `membership=${membership.roleKey} cause=${detail(error)}`,
        },
      };
    }
    deps.invalidate?.(input.userId);
    return { ok: true, value: membership };
  }

  // Promotion or lateral: the account record first.
  try {
    await writeAccount();
  } catch (error) {
    return {
      ok: false,
      failure: {
        status: 500,
        code: 'MEMBERSHIP_SYNC_FAILED',
        message: 'The role change was not applied. The member keeps their previous role.',
        diagnostics: `user=${input.userId} ${previousRole}->${nextRole} stage=app_metadata cause=${detail(error)}`,
      },
    };
  }

  try {
    const membership = await writeMembership();
    deps.invalidate?.(input.userId);
    return { ok: true, value: membership };
  } catch (error) {
    const cause = detail(error);
    try {
      // Put the account record back. The promotion did not complete, so the
      // higher team role must not be left standing on its own.
      await deps.account.writeTeamRole(input.userId, previousRole);
      deps.invalidate?.(input.userId);
      return {
        ok: false,
        failure: {
          status: 500,
          code: 'MEMBERSHIP_SYNC_FAILED',
          message: 'The role change was not applied. The member keeps their previous role.',
          diagnostics: `user=${input.userId} ${previousRole}->${nextRole} stage=membership cause=${cause}`,
        },
      };
    } catch (revertError) {
      deps.log?.(
        `[membership] INCONSISTENT ${input.userId}: app_metadata is ${nextRole}, membership is still the ${previousRole} mapping (${cause}); revert failed (${detail(revertError)})`,
      );
      return {
        ok: false,
        failure: {
          status: 500,
          code: 'MEMBERSHIP_INCONSISTENT',
          message:
            'The team role was changed but the organization membership was not, and the change could not be reverted. It requires operator attention.',
          diagnostics:
            `user=${input.userId} ${previousRole}->${nextRole} cause=${cause} revert=${detail(revertError)}`,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// DELETE / DEACTIVATE
// ---------------------------------------------------------------------------

/**
 * Remove a team account.
 *
 * The membership is revoked FIRST, and that ordering is the whole point: if the
 * account deletion then fails, the person has already lost their organization
 * authority. The reverse order can leave a live membership behind — and while
 * `organization_memberships.user_id` cascades on a hard `auth.users` delete, a
 * soft delete (`deleteUser(id, true)`) does not cascade, and nothing in this
 * code should depend on which of the two the auth provider performed.
 *
 * Revocation is idempotent. A member who never had a row revokes zero rows and
 * that is a success, not a failure — the route must still be able to remove
 * them.
 */
export async function revokeTeamAccount(
  deps: TeamLifecycleDeps,
  input: { readonly userId: string },
): Promise<LifecycleResult<MembershipRevokeResult>> {
  let revocation: MembershipRevokeResult;
  try {
    revocation = await deps.membership.revoke(input.userId);
  } catch (error) {
    return {
      ok: false,
      failure: {
        status: 500,
        code: 'MEMBERSHIP_REVOCATION_FAILED',
        message: 'The member was not removed: their organization membership could not be revoked.',
        diagnostics: `user=${input.userId} cause=${detail(error)}`,
      },
    };
  }
  deps.invalidate?.(input.userId);

  try {
    await deps.account.removeAccount(input.userId);
  } catch (error) {
    deps.log?.(
      `[membership] ${input.userId} lost its MARQ membership but the account could not be deleted (${detail(error)})`,
    );
    return {
      ok: false,
      failure: {
        status: 500,
        code: 'MEMBERSHIP_REVOCATION_FAILED',
        message:
          'The organization membership was revoked but the account could not be deleted. Retry the removal.',
        diagnostics: `user=${input.userId} stage=account cause=${detail(error)}`,
      },
    };
  }
  deps.invalidate?.(input.userId);
  return { ok: true, value: revocation };
}

// ---------------------------------------------------------------------------
// The RPC-backed port
// ---------------------------------------------------------------------------

/**
 * The narrow slice of the Supabase client the lifecycle needs: one `rpc`. Held
 * structurally so this module stays importable under Node, and so the port
 * cannot quietly grow a table write of its own.
 */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export const SYNC_MEMBERSHIP_FUNCTION = 'marq_sync_team_membership';
export const REVOKE_MEMBERSHIP_FUNCTION = 'marq_revoke_team_membership';

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function requireString(record: Record<string, unknown>, key: string, fn: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${fn} returned no ${key}`);
  }
  return value;
}

/**
 * Build the authoritative membership port over the database functions.
 *
 * The arguments are a user id and a TEAM role — never an organization id and
 * never a role id. Both of those are resolved inside the function, against the
 * live MARQ organization and the seeded system role catalog, which is what
 * makes "the browser cannot choose a tenant" a property of the schema rather
 * than of the calling code's discipline.
 */
export function createRpcMembershipPort(client: RpcClient): MembershipLifecyclePort {
  return {
    async sync(userId: string, teamRole: TeamRole): Promise<MembershipSyncResult> {
      const { data, error } = await client.rpc(SYNC_MEMBERSHIP_FUNCTION, {
        p_user_id: userId,
        p_team_role: normalizeTeamRole(teamRole),
      });
      if (error) throw new Error(errorMessage(error));
      if (typeof data !== 'object' || data === null) {
        throw new Error(`${SYNC_MEMBERSHIP_FUNCTION} returned no result`);
      }
      const record = data as Record<string, unknown>;
      const roleKey = requireString(record, 'role_key', SYNC_MEMBERSHIP_FUNCTION);
      // The mapping is asserted on the way back as well as on the way out. If
      // the database ever answered with a key the console's own table does not
      // map to, that is a role-catalog drift and the safe response is to refuse
      // the answer rather than store it.
      if (roleKey !== organizationRoleForTeamRole(teamRole)) {
        throw new Error(
          `${SYNC_MEMBERSHIP_FUNCTION} mapped ${teamRole} to ${roleKey}, expected ${organizationRoleForTeamRole(teamRole)}`,
        );
      }
      return {
        organizationId: requireString(record, 'organization_id', SYNC_MEMBERSHIP_FUNCTION),
        membershipId: requireString(record, 'membership_id', SYNC_MEMBERSHIP_FUNCTION),
        roleKey: roleKey as OrganizationRoleKey,
        action: String(record.action ?? 'unchanged') as MembershipAction,
      };
    },

    async revoke(userId: string): Promise<MembershipRevokeResult> {
      const { data, error } = await client.rpc(REVOKE_MEMBERSHIP_FUNCTION, {
        p_user_id: userId,
      });
      if (error) throw new Error(errorMessage(error));
      if (typeof data !== 'object' || data === null) {
        throw new Error(`${REVOKE_MEMBERSHIP_FUNCTION} returned no result`);
      }
      const record = data as Record<string, unknown>;
      const organizationId = record.organization_id;
      return {
        organizationId: typeof organizationId === 'string' ? organizationId : null,
        revoked: Number(record.revoked ?? 0),
      };
    },
  };
}
