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
 *   H-A     The first fix for HIGH-1 wrote the membership first and left the
 *           old `app_metadata` team role standing when the second write failed.
 *           `admin` grants `ai.agent.execute` on its own, so a partial demotion
 *           still revoked nothing. See ORDERING below, and `authorityFloor` in
 *           `ai/security/actor.ts`.
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
 *   DEMOTION (the new role ranks lower) — the trusted `app_metadata` team role
 *   FIRST, then the authority caches, then the membership. `app_metadata` is
 *   the account's HIGHEST authority: it is what the console's own admin routes
 *   read, and it is re-read from the auth service on every single request, in
 *   every isolate, with no cache in front of it. Lowering it first therefore
 *   takes effect everywhere at once. If the membership write then fails, the
 *   account is left with the LOWER team role and a stale membership row, and
 *   `authorityFloor` in `ai/security/actor.ts` grants no more than the lower of
 *   the two — so the stale row grants nothing.
 *
 *   PROMOTION or a lateral move — `app_metadata` first as well, and for the
 *   mirror-image reason: the floor means the higher role does not take effect
 *   until BOTH systems carry it, so a half-finished promotion grants nothing
 *   either. The compensating revert still runs, because leaving a promotion
 *   half-applied is a mess even when it is a safe one.
 *
 * THE ORDER WAS THE OTHER WAY ROUND, AND THAT WAS FINDING H-A. Membership was
 * written first on a demotion, on the reasoning that the account would "still
 * hold the old team role, which is strictly less than it had". It was not less:
 * the old team role was `admin`, `ROLE_CAPABILITIES.admin` grants
 * `ai.agent.execute` on its own, and the union of the two role sources meant a
 * failed second write left every capability the demotion was meant to remove.
 * The test over it asserted only that the `org_admin` LABEL was gone.
 *
 * Ordering alone would not have closed it either — reversed, the stale
 * `org_admin` membership row would have granted the same capability from the
 * other side. The floor is what makes a partial demotion revoke; the order is
 * what makes it revoke IMMEDIATELY, in every isolate, without waiting for a
 * membership read.
 *
 * A failed second write is reported as an inconsistency rather than swallowed,
 * and on a demotion the first write is NEVER compensated: putting the higher
 * team role back would restore precisely the authority an administrator just
 * revoked. The route returns a failure in every one of those cases: a role
 * change that did not fully apply must not answer `200`.
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

/**
 * What the membership write actually did.
 *
 * Every value here is something `marq_sync_team_membership` can DISTINGUISH,
 * which is the correction finding L4 asked for. The union used to carry
 * `reactivated`, which the function has never been able to return: a
 * soft-deleted membership is a tombstone this lifecycle does not revive, so a
 * user with one and no live row gets a NEW row — `created`, not `reactivated`.
 * A value no code path can produce is not a report, it is a claim.
 *
 *   created      no live row existed and this call inserted one.
 *   role_changed a live row existed carrying a different role, and now carries
 *                the mapped one.
 *   unchanged    a live row already carried the mapped role. Nothing written.
 *   reconciled   no live row existed when this call looked, another writer
 *                created one first, and this call set it to the mapped role.
 *                Reported distinctly rather than folded into `created` or
 *                `role_changed`, because the prior role is genuinely unknown to
 *                this session and guessing it would be the same defect in a
 *                narrower place.
 */
export type MembershipAction = 'created' | 'role_changed' | 'unchanged' | 'reconciled';

export const MEMBERSHIP_ACTIONS: ReadonlySet<string> = new Set<MembershipAction>([
  'created',
  'role_changed',
  'unchanged',
  'reconciled',
]);

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
   * Drop this user from the authenticator's membership cache IN THIS ISOLATE.
   *
   * An optimisation, not the revocation mechanism. A signal cannot reach
   * another isolate, so correctness across isolates comes from two properties
   * that hold without it: `app_metadata` is re-read from the auth service on
   * every request, and any privileged capability resolves memberships from the
   * database rather than from a snapshot (`PRIVILEGED_CAPABILITIES`). This just
   * saves the isolate that performed the write from serving an answer it
   * already knows is stale.
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
    // 1. The highest authority falls first. `app_metadata` is uncached and
    //    re-read on every request, so this lands everywhere at once.
    try {
      await writeAccount();
    } catch (error) {
      // Nothing was written. The member keeps the role they had, in both
      // systems, and the administrator retries.
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

    // 2. Drop the authority snapshots this isolate holds. Other isolates do not
    //    need telling: they re-read `app_metadata` on the next request, and
    //    they resolve memberships authoritatively for any privileged capability.
    deps.invalidate?.(input.userId);

    // 3. The membership follows.
    let membership: MembershipSyncResult;
    try {
      membership = await writeMembership();
    } catch (error) {
      // The team role is already DOWN and the membership row is stale HIGH.
      // The floor grants the lower of the two, so the stale row confers
      // nothing — the account already holds no more than its new role.
      //
      // Restoring the old team role as compensation would undo the revocation
      // the administrator asked for, so it deliberately does not run. The
      // inconsistency is named instead, and the route reports a failure.
      deps.log?.(
        `[membership] partial demotion for ${input.userId}: app_metadata is ${nextRole}, ` +
        `the membership row is still the ${previousRole} mapping (${detail(error)}). ` +
        'Authority is already reduced to the lower of the two; re-run the change to reconcile the row.',
      );
      return {
        ok: false,
        failure: {
          status: 500,
          code: 'MEMBERSHIP_INCONSISTENT',
          message:
            'The team role was lowered and takes effect now, but the organization membership row ' +
            'still carries the old role. No elevated access remains. Retry the change to reconcile it.',
          diagnostics:
            `user=${input.userId} ${previousRole}->${nextRole} stage=membership ` +
            `app_metadata=${nextRole} membership=${organizationRoleForTeamRole(previousRole)} ` +
            `effective=${nextRole} cause=${detail(error)}`,
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
 * THE ACCOUNT GOES FIRST, and it goes first for the reason a demotion lowers
 * `app_metadata` first: removal is the maximal demotion, and the highest
 * authority has to fall first.
 *
 * This order was the other way round, and the reasoning was the same one that
 * produced H-A — "revoke the membership first, so a failed second write has
 * already revoked". It had the same flaw. Revoking the membership takes the
 * organization capability away and leaves `app_metadata.marq_team` and
 * `team_role: 'admin'` standing, and those are what `verifyTeamToken` and
 * `authorizeTeamAdmin` read. A removal that got half-way through left somebody
 * who had just been removed still able to invite, re-role and delete their
 * former colleagues through the console.
 *
 * Deleting the account first cannot leave authority behind in either system,
 * because both of them require the caller to authenticate and a deleted account
 * cannot. If the revocation then fails, what is left is a membership row for an
 * account that no longer exists — a tidiness problem with no authority attached,
 * reported as an inconsistency and listed by
 * `cortex.orphaned_team_accounts()`'s companion in the L2 runbook.
 *
 * (A hard `auth.users` delete cascades `organization_memberships.user_id`
 * anyway, so the row is usually gone before the revocation runs. The revocation
 * is kept because nothing here should depend on whether the auth provider
 * performed a hard delete or a soft one.)
 *
 * Revocation is idempotent. A member who never had a row revokes zero rows and
 * that is a success, not a failure — the route must still be able to remove
 * them.
 */
export async function revokeTeamAccount(
  deps: TeamLifecycleDeps,
  input: { readonly userId: string },
): Promise<LifecycleResult<MembershipRevokeResult>> {
  try {
    await deps.account.removeAccount(input.userId);
  } catch (error) {
    // Nothing was written. The member keeps everything, in both systems, and
    // the operator retries — which is the honest outcome and the safe one.
    return {
      ok: false,
      failure: {
        status: 500,
        code: 'MEMBERSHIP_REVOCATION_FAILED',
        message: 'The member was not removed: their account could not be deleted.',
        diagnostics: `user=${input.userId} stage=account cause=${detail(error)}`,
      },
    };
  }
  deps.invalidate?.(input.userId);

  let revocation: MembershipRevokeResult;
  try {
    revocation = await deps.membership.revoke(input.userId);
  } catch (error) {
    deps.log?.(
      `[membership] ${input.userId} was deleted but its MARQ membership row could not be revoked ` +
      `(${detail(error)}). No authority remains — the account cannot authenticate — but the row ` +
      'is orphaned. Revoke it with public.marq_revoke_team_membership.',
    );
    return {
      ok: false,
      failure: {
        status: 500,
        code: 'MEMBERSHIP_INCONSISTENT',
        message:
          'The account was deleted and can no longer sign in, but its organization membership row ' +
          'could not be revoked. No access remains. It requires operator attention.',
        diagnostics: `user=${input.userId} stage=membership cause=${detail(error)}`,
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
      // L4. The action is what the database says it did, and it is checked
      // rather than cast. `String(x ?? 'unchanged')` reported `unchanged` for a
      // missing field and passed any other string through as if it were one of
      // ours — so a console reading a database it does not understand would
      // have printed the misunderstanding as fact.
      const action = record.action;
      if (typeof action !== 'string' || !MEMBERSHIP_ACTIONS.has(action)) {
        throw new Error(
          `${SYNC_MEMBERSHIP_FUNCTION} reported the unknown action ${JSON.stringify(action)}`,
        );
      }

      return {
        organizationId: requireString(record, 'organization_id', SYNC_MEMBERSHIP_FUNCTION),
        membershipId: requireString(record, 'membership_id', SYNC_MEMBERSHIP_FUNCTION),
        roleKey: roleKey as OrganizationRoleKey,
        action: action as MembershipAction,
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
