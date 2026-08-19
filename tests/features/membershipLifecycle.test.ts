/**
 * The membership lifecycle, end to end through the REAL resolution path.
 *
 * WHY THIS FILE IS NOT A UNIT TEST
 *
 * Every blocker it covers lived in the seam between two components that each
 * behaved correctly on their own. `PATCH /team/members/:id` wrote
 * `app_metadata` faithfully. `listVerifiedMemberships` read
 * `organization_memberships` faithfully. `resolveActor` unioned the roles it was
 * given faithfully. A demoted admin still held `ai.agent.execute`, because
 * nobody had written the membership row.
 *
 * So the assertions here run a request the whole way: an auth record and a set
 * of membership rows go in, and what comes out is an `AIActor` produced by the
 * real `createSupabaseAuthenticator`, the real `listVerifiedMemberships`, the
 * real `resolveOrganization` and the real `resolveActor`. Nothing between the
 * store and the capability list is a stand-in.
 *
 * WHAT IS SIMULATED, AND WHAT THAT COSTS
 *
 * Two things: GoTrue's admin API, and the `marq_sync_team_membership` database
 * function. Both are stores. `FakeAuthDirectory` holds auth records the way
 * GoTrue does — two metadata bags, one of which the account holder can write —
 * and `FakeMembershipDatabase` applies the SAME rules the SQL function applies:
 * the organization is resolved by slug internally, the role is mapped by
 * `TEAM_ROLE_TO_ORGANIZATION_ROLE`, an existing row is re-roled rather than
 * duplicated, and a revocation is a soft delete.
 *
 * That the SQL function really behaves that way is proven separately, against a
 * real PostgreSQL, by `tests/database/harness/70_assert_lifecycle.sql` under
 * `npm run test:database:scenarios`. Neither proof would be enough alone: this
 * file cannot execute PL/pgSQL, and psql cannot execute `resolveActor`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEAM_ROLE_TO_ORGANIZATION_ROLE,
  TEAM_ROLES,
  isProvisionedTeamAccount,
  resolveTeamAuthority,
  resolveTeamRoleFromAuthRecord,
  teamAppMetadata,
  authorizeTeamAdmin,
  authorizeRoleAssignment,
  authorizeMemberRemoval,
  requireTeamAccountTarget,
  type TeamRole,
} from '../../supabase/functions/server/teamAuthorization.ts';
import {
  applyTeamRoleChange,
  completeTeamProvisioning,
  revokeTeamAccount,
  type MembershipLifecyclePort,
  type MembershipRevokeResult,
  type MembershipSyncResult,
  type TeamAccountPort,
  type TeamLifecycleDeps,
} from '../../supabase/functions/server/membershipLifecycle.ts';
import {
  listVerifiedMemberships,
  type MembershipQueryClient,
} from '../../supabase/functions/server/ai/adapters/membershipDirectory.ts';
import {
  createMembershipInvalidationSignal,
  createSupabaseAuthenticator,
} from '../../supabase/functions/server/ai/adapters/supabaseAuthenticator.ts';
import { resolveActor } from '../../supabase/functions/server/ai/security/actor.ts';
import { resolveOrganization } from '../../supabase/functions/server/ai/security/tenancy.ts';
import { AIError } from '../../supabase/functions/server/ai/contracts/errors.ts';

// ---------------------------------------------------------------------------
// The two stores
// ---------------------------------------------------------------------------

const MARQ_ORG = 'org-marq';
const OTHER_ORG = 'org-acme';

interface AuthRecord {
  id: string;
  email?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
}

/** GoTrue, reduced to what matters: two bags, and who may write which. */
class FakeAuthDirectory {
  private readonly users = new Map<string, AuthRecord>();

  create(record: AuthRecord): AuthRecord {
    this.users.set(record.id, structuredClone(record));
    return this.get(record.id)!;
  }

  get(id: string): AuthRecord | undefined {
    const found = this.users.get(id);
    return found ? structuredClone(found) : undefined;
  }

  has(id: string): boolean {
    return this.users.has(id);
  }

  /** The service role writing `app_metadata`. */
  writeAppMetadata(id: string, patch: Record<string, unknown>): void {
    const user = this.users.get(id);
    if (!user) throw new Error(`no such user: ${id}`);
    user.app_metadata = { ...user.app_metadata, ...patch };
  }

  /**
   * THE ACCOUNT HOLDER writing their own `user_metadata`, exactly as GoTrue's
   * `PUT /auth/v1/user` permits with nothing but an access token and the public
   * anon key. This is the attack in HIGH-2, expressed as a method so no test
   * can pretend the write is privileged.
   */
  selfWriteUserMetadata(id: string, patch: Record<string, unknown>): void {
    const user = this.users.get(id);
    if (!user) throw new Error(`no such user: ${id}`);
    user.user_metadata = { ...user.user_metadata, ...patch };
  }

  delete(id: string): void {
    if (!this.users.delete(id)) throw new Error(`no such user: ${id}`);
  }
}

interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role_key: string;
  status: 'active' | 'invited' | 'suspended';
  deleted_at: string | null;
}

interface OrganizationRow {
  id: string;
  slug: string;
  deleted_at: string | null;
}

/**
 * `public.organization_memberships`, plus the two functions that write it.
 *
 * The write path mirrors `marq_sync_team_membership`: the organization is found
 * by slug HERE, the role is mapped HERE, and neither is a parameter. A test
 * that wanted to grant a membership in `OTHER_ORG` could not express it through
 * this port at all, which is the property under test.
 */
class FakeMembershipDatabase {
  readonly rows: MembershipRow[] = [];
  private readonly organizations: OrganizationRow[] = [
    { id: MARQ_ORG, slug: 'marq', deleted_at: null },
    { id: OTHER_ORG, slug: 'acme', deleted_at: null },
  ];
  private nextId = 1;
  /** Set to make the next write fail, for the compensation tests. */
  failNextSync: string | null = null;
  failNextRevoke: string | null = null;

  private readonly auth: FakeAuthDirectory;

  constructor(auth: FakeAuthDirectory) {
    this.auth = auth;
  }

  private marqOrganizationId(): string {
    const org = this.organizations.find((o) => o.slug === 'marq' && o.deleted_at === null);
    if (!org) throw new Error('the MARQ organization does not exist');
    return org.id;
  }

  seedMembership(userId: string, roleKey: string, organizationId = MARQ_ORG): MembershipRow {
    const row: MembershipRow = {
      id: `m${this.nextId++}`,
      organization_id: organizationId,
      user_id: userId,
      role_key: roleKey,
      status: 'active',
      deleted_at: null,
    };
    this.rows.push(row);
    return row;
  }

  liveMarqRows(userId: string): MembershipRow[] {
    return this.rows.filter(
      (r) => r.organization_id === this.marqOrganizationId() && r.user_id === userId && r.deleted_at === null,
    );
  }

  readonly port: MembershipLifecyclePort = {
    sync: async (userId: string, teamRole: TeamRole): Promise<MembershipSyncResult> => {
      if (this.failNextSync === userId) {
        this.failNextSync = null;
        throw new Error('simulated membership write failure');
      }
      if (!this.auth.has(userId)) throw new Error(`${userId} is not a live auth user`);

      const organizationId = this.marqOrganizationId();
      // THE ONE MAPPING, imported rather than restated.
      const roleKey = TEAM_ROLE_TO_ORGANIZATION_ROLE[teamRole];
      const existing = this.rows.find(
        (r) => r.organization_id === organizationId && r.user_id === userId && r.deleted_at === null,
      );

      if (!existing) {
        const row = this.seedMembership(userId, roleKey, organizationId);
        return { organizationId, membershipId: row.id, roleKey, action: 'created' };
      }
      if (existing.role_key === roleKey) {
        return { organizationId, membershipId: existing.id, roleKey, action: 'unchanged' };
      }
      existing.role_key = roleKey;   // re-roled in place; never a second row
      return { organizationId, membershipId: existing.id, roleKey, action: 'role_changed' };
    },

    revoke: async (userId: string): Promise<MembershipRevokeResult> => {
      if (this.failNextRevoke === userId) {
        this.failNextRevoke = null;
        throw new Error('simulated revocation failure');
      }
      const organizationId = this.marqOrganizationId();
      const live = this.liveMarqRows(userId);
      for (const row of live) row.deleted_at = new Date().toISOString();
      return { organizationId, revoked: live.length };
    },
  };

  /** A PostgREST-shaped read, so the REAL `listVerifiedMemberships` runs over it. */
  queryClient(): MembershipQueryClient {
    const db = this;
    return {
      from() {
        return {
          select() {
            const filters: [string, unknown][] = [];
            const builder: any = {
              eq(column: string, value: unknown) {
                filters.push([column, value]);
                return builder;
              },
              is(column: string, value: null) {
                filters.push([column, value]);
                return builder;
              },
              then(resolve: (r: { data: unknown; error: unknown }) => unknown) {
                const userId = filters.find(([c]) => c === 'user_id')?.[1];
                const data = db.rows
                  .filter((r) => r.user_id === userId)
                  .filter((r) => r.status === 'active' && r.deleted_at === null)
                  .map((r) => {
                    const org = db.organizations.find((o) => o.id === r.organization_id);
                    return {
                      organization_id: r.organization_id,
                      status: r.status,
                      deleted_at: r.deleted_at,
                      // `!inner` on a live organization, as the real query asks.
                      organizations: org && org.deleted_at === null
                        ? { slug: org.slug, deleted_at: org.deleted_at }
                        : undefined,
                      roles: { key: r.role_key },
                    };
                  })
                  .filter((row) => row.organizations !== undefined);
                return resolve({ data, error: null });
              },
            };
            return builder;
          },
        };
      },
    } as unknown as MembershipQueryClient;
  }
}

// ---------------------------------------------------------------------------
// The real resolution path, assembled the way `index.tsx` assembles it
// ---------------------------------------------------------------------------

interface World {
  auth: FakeAuthDirectory;
  db: FakeMembershipDatabase;
  deps: TeamLifecycleDeps;
  /** Bearer token -> resolved actor, through every real component. */
  resolve(userId: string, organizationHint?: string): {
    roles: readonly string[];
    capabilities: readonly string[];
    organizationId: string;
    membershipVerified: boolean;
  };
  resolveAsync(userId: string, organizationHint?: string): Promise<{
    roles: readonly string[];
    capabilities: readonly string[];
    organizationId: string;
    membershipVerified: boolean;
  }>;
  clockMs: { value: number };
}

function createWorld(): World {
  const auth = new FakeAuthDirectory();
  const db = new FakeMembershipDatabase(auth);
  const invalidation = createMembershipInvalidationSignal();
  const clockMs = { value: 1_000 };

  const account: TeamAccountPort = {
    async writeTeamRole(userId, role) {
      auth.writeAppMetadata(userId, teamAppMetadata(role));
    },
    async removeAccount(userId) {
      auth.delete(userId);
    },
  };

  const deps: TeamLifecycleDeps = {
    membership: db.port,
    account,
    invalidate: (userId) => invalidation.invalidate(userId),
  };

  // The authenticator the edge entry point builds, with the same two ports.
  const authenticator = createSupabaseAuthenticator({
    getUser: async (token: string) => {
      const record = auth.get(token);   // the token IS the user id here
      if (!record) return null;
      const teamRole = resolveTeamRoleFromAuthRecord(record);
      return { id: record.id, email: record.email, roles: teamRole ? [teamRole] : [] };
    },
    listMemberships: async (userId: string) => listVerifiedMemberships(db.queryClient(), userId),
    invalidation,
    clock: { now: () => clockMs.value },
  });

  const resolveAsync = async (userId: string, organizationHint?: string) => {
    const subject = await authenticator.authenticate(`Bearer ${userId}`);
    const organization = resolveOrganization(subject, organizationHint, {
      defaultOrganizationId: 'default-org',
      allowList: [],
      // I. The default organization stays disabled. Every assertion below about
      // a subject with no membership is an assertion about failing CLOSED.
      allowDefaultOrganization: false,
    });
    const actor = resolveActor(subject, organization.organizationId, { allowAnonymous: false });
    return {
      roles: actor.roles,
      capabilities: actor.capabilities,
      organizationId: organization.organizationId,
      membershipVerified: organization.membershipVerified,
    };
  };

  return {
    auth,
    db,
    deps,
    clockMs,
    resolveAsync,
    resolve: () => {
      throw new Error('use resolveAsync');
    },
  };
}

/** Provision an account the way `POST /team/invite` does: create, then finish. */
async function invite(world: World, userId: string, role: TeamRole) {
  world.auth.create({
    id: userId,
    email: `${userId}@marq.test`,
    app_metadata: teamAppMetadata(role),
    user_metadata: { role: 'team', teamRole: role },
  });
  return completeTeamProvisioning(world.deps, { userId, role });
}

// ===========================================================================
// HIGH-1 — a demotion revokes
// ===========================================================================

describe('HIGH-1: a console demotion revokes the organization capability', () => {
  it('admin -> viewer removes org_admin and ai.agent.execute, end to end', async () => {
    const world = createWorld();
    const result = await invite(world, 'user-admin', 'admin');
    assert.equal(result.ok, true);

    const before = await world.resolveAsync('user-admin');
    assert.ok(before.roles.includes('admin'), 'precondition: the team role is admin');
    assert.ok(before.roles.includes('org_admin'), 'precondition: the membership role is org_admin');
    assert.ok(
      before.capabilities.includes('ai.agent.execute'),
      'precondition: an admin can execute agents',
    );

    const change = await applyTeamRoleChange(world.deps, {
      userId: 'user-admin',
      previousRole: 'admin',
      nextRole: 'viewer',
    });
    assert.equal(change.ok, true);

    const after = await world.resolveAsync('user-admin');

    // The four things the finding asked for, in the order it asked for them.
    assert.equal(
      resolveTeamRoleFromAuthRecord(world.auth.get('user-admin')),
      'viewer',
      'app_metadata must resolve viewer',
    );
    assert.deepEqual(
      world.db.liveMarqRows('user-admin').map((r) => r.role_key),
      ['team_viewer'],
      'the membership must resolve team_viewer',
    );
    assert.ok(!after.roles.includes('org_admin'), 'the actor must not retain org_admin');
    assert.ok(!after.roles.includes('admin'), 'the actor must not retain the admin team role');
    assert.ok(
      !after.capabilities.includes('ai.agent.execute'),
      'ai.agent.execute must be gone',
    );

    // And nothing above a viewer survived, named or not.
    const viewerWorld = createWorld();
    await invite(viewerWorld, 'reference-viewer', 'viewer');
    const viewerReference = await viewerWorld.resolveAsync('reference-viewer');
    assert.deepEqual(
      [...after.capabilities].sort(),
      [...viewerReference.capabilities].sort(),
      'a demoted admin must hold exactly what a viewer holds, no more',
    );
  });

  it('takes effect on the NEXT request, not after the membership cache expires', async () => {
    const world = createWorld();
    await invite(world, 'user-cached', 'admin');

    // Authenticate once so the membership lands in the authenticator's cache.
    const before = await world.resolveAsync('user-cached');
    assert.ok(before.capabilities.includes('ai.agent.execute'));

    await applyTeamRoleChange(world.deps, {
      userId: 'user-cached',
      previousRole: 'admin',
      nextRole: 'viewer',
    });

    // The clock has not moved: without invalidation the cached org_admin
    // membership would still be served, and the demotion would take up to the
    // full TTL to bite.
    const after = await world.resolveAsync('user-cached');
    assert.ok(
      !after.capabilities.includes('ai.agent.execute'),
      'the demotion must not wait for the membership cache to expire',
    );
  });

  it('moves both systems for every direction of change, leaving no stale role', async () => {
    const transitions: [TeamRole, TeamRole][] = [
      ['viewer', 'admin'],
      ['admin', 'analyst'],
      ['analyst', 'viewer'],
      ['owner', 'reviewer'],
      ['consultant', 'owner'],
    ];

    for (const [from, to] of transitions) {
      const world = createWorld();
      await invite(world, 'subject', from);

      const change = await applyTeamRoleChange(world.deps, {
        userId: 'subject',
        previousRole: from,
        nextRole: to,
      });
      assert.equal(change.ok, true, `${from} -> ${to} must apply`);

      const record = world.auth.get('subject');
      assert.equal(resolveTeamRoleFromAuthRecord(record), to, `${from} -> ${to}: app_metadata`);
      assert.deepEqual(
        world.db.liveMarqRows('subject').map((r) => r.role_key),
        [TEAM_ROLE_TO_ORGANIZATION_ROLE[to]],
        `${from} -> ${to}: exactly one membership, at the mapped role`,
      );

      const actor = await world.resolveAsync('subject');
      assert.ok(actor.roles.includes(to), `${from} -> ${to}: the new team role is in force`);
      assert.ok(!actor.roles.includes(from), `${from} -> ${to}: the OLD team role is gone`);
      assert.ok(
        !actor.roles.includes(TEAM_ROLE_TO_ORGANIZATION_ROLE[from]) ||
          TEAM_ROLE_TO_ORGANIZATION_ROLE[from] === TEAM_ROLE_TO_ORGANIZATION_ROLE[to],
        `${from} -> ${to}: the old membership role is gone`,
      );

      // F. Never more than the canonical mapping allows.
      const reference = createWorld();
      await invite(reference, 'reference', to);
      const expected = await reference.resolveAsync('reference');
      assert.deepEqual(
        [...actor.capabilities].sort(),
        [...expected.capabilities].sort(),
        `${from} -> ${to}: capabilities must equal those of a fresh ${to}`,
      );
    }
  });
});

// ===========================================================================
// MED-1 — an invite creates the membership
// ===========================================================================

describe('MED-1: provisioning creates the MARQ membership', () => {
  it('an invited team user resolves an organization immediately', async () => {
    const world = createWorld();
    const provisioning = await invite(world, 'new-hire', 'consultant');
    assert.equal(provisioning.ok, true);
    if (!provisioning.ok) return;

    // Trusted app metadata exists.
    const record = world.auth.get('new-hire');
    assert.equal(isProvisionedTeamAccount(record), true);
    assert.equal(resolveTeamRoleFromAuthRecord(record), 'consultant');

    // Exactly one active MARQ membership, at the mapped role.
    const rows = world.db.liveMarqRows('new-hire');
    assert.equal(rows.length, 1, 'exactly one active MARQ membership');
    assert.equal(rows[0].role_key, 'team_member');
    assert.equal(rows[0].organization_id, MARQ_ORG);
    assert.equal(provisioning.value.action, 'created');

    // resolveOrganization succeeds, and says the membership was verified.
    const resolved = await world.resolveAsync('new-hire');
    assert.equal(resolved.organizationId, MARQ_ORG);
    assert.equal(resolved.membershipVerified, true);
  });

  it('is idempotent: provisioning the same account twice creates one membership', async () => {
    const world = createWorld();
    await invite(world, 'twice', 'analyst');
    const second = await completeTeamProvisioning(world.deps, { userId: 'twice', role: 'analyst' });

    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.value.action, 'unchanged');
    assert.equal(world.db.liveMarqRows('twice').length, 1);
  });

  it('does not leave a half-provisioned account behind when the membership fails', async () => {
    const world = createWorld();
    world.db.failNextSync = 'doomed';

    const result = await invite(world, 'doomed', 'admin');

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_PROVISIONING_FAILED');
    // The MED-1 state — trusted app metadata, no membership — must not exist.
    assert.equal(world.auth.has('doomed'), false, 'the account was rolled back');
    assert.equal(world.db.liveMarqRows('doomed').length, 0);
  });

  it('reports an orphan loudly when the account cannot be rolled back either', async () => {
    const world = createWorld();
    world.db.failNextSync = 'orphan';
    world.auth.create({
      id: 'orphan',
      app_metadata: teamAppMetadata('admin'),
      user_metadata: {},
    });

    const result = await completeTeamProvisioning(
      {
        ...world.deps,
        account: {
          writeTeamRole: world.deps.account.writeTeamRole,
          removeAccount: async () => {
            throw new Error('simulated delete failure');
          },
        },
      },
      { userId: 'orphan', role: 'admin' },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_INCONSISTENT');
    assert.match(result.failure.diagnostics, /orphan/);
  });
});

// ===========================================================================
// HIGH-2 — user_metadata is not authority
// ===========================================================================

describe('HIGH-2: an ordinary account cannot promote itself with user_metadata', () => {
  /** A real, authenticated, entirely ordinary Supabase account. */
  function stranger(world: World, id = 'stranger') {
    world.auth.create({ id, email: `${id}@example.test`, app_metadata: {}, user_metadata: {} });
    // The attack, written the way the attacker performs it.
    world.auth.selfWriteUserMetadata(id, { role: 'team', teamRole: 'owner' });
    return world.auth.get(id)!;
  }

  it('A. resolves no team authority at all', () => {
    const world = createWorld();
    const record = stranger(world);

    assert.equal(record.user_metadata.teamRole, 'owner', 'the claim really is on the record');
    assert.equal(isProvisionedTeamAccount(record), false);
    assert.deepEqual(resolveTeamAuthority(record), { provisioned: false, role: null });
    assert.equal(resolveTeamRoleFromAuthRecord(record), null);
  });

  it('A. cannot invite, cannot promote another user, cannot delete a member', () => {
    const world = createWorld();
    const record = stranger(world);
    const authority = resolveTeamAuthority(record);

    const gate = authorizeTeamAdmin(record.id, authority);
    assert.equal(gate.ok, false, 'the admin gate must refuse');
    if (gate.ok) return;
    assert.equal(gate.failure.code, 'NOT_A_TEAM_ACCOUNT');
    assert.equal(gate.failure.status, 403);

    // Every privileged team action runs behind that same gate, so all three of
    // the named routes — and the rest of the console with them — are closed.
    // Asserted through the authorizers rather than asserted about them: a
    // caller who cannot pass the gate never reaches these at all.
    assert.equal(
      authorizeRoleAssignment({
        callerId: record.id,
        // Even if the gate were somehow bypassed, the rank rules still hold
        // against the role the account ACTUALLY has, which is none.
        callerRole: 'viewer',
        targetId: 'someone-else',
        requestedRole: 'owner',
      }).ok,
      false,
      'a viewer-equivalent cannot mint an owner',
    );
    assert.equal(
      authorizeMemberRemoval({
        callerId: record.id,
        callerRole: 'viewer',
        targetId: 'someone-else',
        targetCurrentRole: 'admin',
      }).ok,
      false,
      'a viewer-equivalent cannot remove an admin',
    );
  });

  it('B. obtains no organization membership, and fails closed', async () => {
    const world = createWorld();
    const record = stranger(world);

    assert.equal(world.db.liveMarqRows(record.id).length, 0);

    await assert.rejects(
      () => world.resolveAsync(record.id),
      (error: unknown) => {
        assert.ok(error instanceof AIError);
        assert.equal(error.code, 'ORGANIZATION_REQUIRED');
        return true;
      },
      'a subject with no verified membership must fail closed',
    );
  });

  it('C. obtains no privileged AI capability', async () => {
    const world = createWorld();
    const record = stranger(world);

    // Resolve the actor directly, since organization resolution refuses first.
    // Even granted that step, the capability set carries nothing privileged.
    const subject = {
      subjectId: record.id,
      actorType: 'team_user' as const,
      globalRoles: resolveTeamRoleFromAuthRecord(record) ? ['owner'] : [],
      memberships: [],
    };
    const actor = resolveActor(subject, null, { allowAnonymous: false });

    for (const capability of [
      'ai.agent.execute',
      'ai.analysis.run',
      'ai.block.assist',
      'ai.copilot.plan',
      'ai.section.copilot',
    ]) {
      assert.ok(
        !actor.capabilities.includes(capability as never),
        `an unprovisioned account must not hold ${capability}`,
      );
    }
  });

  it('cannot reach a team role by writing marq_team into user_metadata either', () => {
    const world = createWorld();
    world.auth.create({ id: 'clever', app_metadata: {}, user_metadata: {} });
    world.auth.selfWriteUserMetadata('clever', { marq_team: true, team_role: 'owner', teamRole: 'owner' });

    const record = world.auth.get('clever')!;
    assert.equal(isProvisionedTeamAccount(record), false, 'the stamp is only ever read from app_metadata');
    assert.equal(resolveTeamRoleFromAuthRecord(record), null);
  });

  it('keeps refusing after the account holder rewrites user_metadata on a real member', async () => {
    // The stronger case: a genuine, provisioned VIEWER who then edits their own
    // user metadata to claim `owner`. `app_metadata` is what answers.
    const world = createWorld();
    await invite(world, 'real-viewer', 'viewer');
    world.auth.selfWriteUserMetadata('real-viewer', { teamRole: 'owner' });

    const record = world.auth.get('real-viewer')!;
    assert.equal(resolveTeamRoleFromAuthRecord(record), 'viewer');

    const gate = authorizeTeamAdmin('real-viewer', resolveTeamAuthority(record));
    assert.equal(gate.ok, false);
    if (gate.ok) return;
    assert.equal(gate.failure.code, 'FORBIDDEN');

    const actor = await world.resolveAsync('real-viewer');
    assert.ok(!actor.roles.includes('owner'));
    assert.ok(!actor.capabilities.includes('ai.agent.execute'));
  });
});

describe('HIGH-2: a team-management action cannot reach a non-team account', () => {
  it('refuses an id that is not a provisioned team account', () => {
    for (const record of [
      // A customer, with the self-writable claim on it.
      { app_metadata: {}, user_metadata: { role: 'team', teamRole: 'admin' } },
      { app_metadata: { team_role: 'admin' }, user_metadata: {} },   // role, no stamp
      {},
      null,
      undefined,
    ]) {
      const result = requireTeamAccountTarget(record);
      assert.equal(result.ok, false, `accepted target: ${JSON.stringify(record)}`);
      if (result.ok) return;
      // 404, not 403: the resource this route addresses is a team member, and
      // that id is not one. It also declines to confirm the account exists.
      assert.equal(result.failure.status, 404);
      assert.equal(result.failure.code, 'NOT_A_TEAM_ACCOUNT');
    }
  });

  it('admits a provisioned target and reports the role in force', () => {
    for (const role of TEAM_ROLES) {
      const result = requireTeamAccountTarget({
        app_metadata: teamAppMetadata(role),
        user_metadata: { teamRole: 'owner' },   // the claim is ignored
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.role, role);
    }
  });

  it('gives a stamped target with no role the least privilege', () => {
    const result = requireTeamAccountTarget({ app_metadata: { marq_team: true } });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.role, 'viewer');
  });
});

// ===========================================================================
// DELETE / DEACTIVATE
// ===========================================================================

describe('removal revokes before it deletes', () => {
  it('a removed member holds no live membership and no account', async () => {
    const world = createWorld();
    await invite(world, 'leaver', 'admin');
    assert.equal(world.db.liveMarqRows('leaver').length, 1);

    const result = await revokeTeamAccount(world.deps, { userId: 'leaver' });
    assert.equal(result.ok, true);
    assert.equal(world.db.liveMarqRows('leaver').length, 0);
    assert.equal(world.auth.has('leaver'), false);
  });

  it('leaves the membership revoked when the account delete fails', async () => {
    const world = createWorld();
    await invite(world, 'stuck', 'admin');

    const result = await revokeTeamAccount(
      {
        ...world.deps,
        account: {
          writeTeamRole: world.deps.account.writeTeamRole,
          removeAccount: async () => {
            throw new Error('simulated delete failure');
          },
        },
      },
      { userId: 'stuck' },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_REVOCATION_FAILED');
    // The authority is gone even though the account is not: a half-completed
    // removal must not be a member who kept their access.
    assert.equal(world.db.liveMarqRows('stuck').length, 0, 'the membership stays revoked');
  });

  it('does not delete the account when the membership could not be revoked', async () => {
    const world = createWorld();
    await invite(world, 'protected', 'admin');
    world.db.failNextRevoke = 'protected';

    const result = await revokeTeamAccount(world.deps, { userId: 'protected' });
    assert.equal(result.ok, false);
    assert.equal(world.auth.has('protected'), true, 'the account survives a failed revocation');
    assert.equal(world.db.liveMarqRows('protected').length, 1);
  });

  it('removing somebody who never had a membership still succeeds', async () => {
    const world = createWorld();
    world.auth.create({ id: 'never-provisioned', app_metadata: teamAppMetadata('viewer'), user_metadata: {} });

    const result = await revokeTeamAccount(world.deps, { userId: 'never-provisioned' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.revoked, 0);
    assert.equal(world.auth.has('never-provisioned'), false);
  });

  it('a suspended membership grants nothing while the account still exists', async () => {
    const world = createWorld();
    await invite(world, 'suspended', 'admin');
    world.db.liveMarqRows('suspended')[0].status = 'suspended';

    await assert.rejects(
      () => world.resolveAsync('suspended'),
      (error: unknown) => (error as AIError).code === 'ORGANIZATION_REQUIRED',
      'a suspended membership must not resolve an organization',
    );
  });
});

// ===========================================================================
// Compensations
// ===========================================================================

describe('a role change that cannot complete does not half-apply', () => {
  it('reverts app_metadata when the membership write fails on a promotion', async () => {
    const world = createWorld();
    await invite(world, 'promoted', 'viewer');
    world.db.failNextSync = 'promoted';

    const result = await applyTeamRoleChange(world.deps, {
      userId: 'promoted',
      previousRole: 'viewer',
      nextRole: 'admin',
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_SYNC_FAILED');
    assert.equal(
      resolveTeamRoleFromAuthRecord(world.auth.get('promoted')),
      'viewer',
      'the promotion was reverted, not left standing',
    );
    assert.deepEqual(world.db.liveMarqRows('promoted').map((r) => r.role_key), ['team_viewer']);

    const actor = await world.resolveAsync('promoted');
    assert.ok(!actor.capabilities.includes('ai.agent.execute'));
  });

  it('keeps the revocation when a demotion cannot finish writing app_metadata', async () => {
    const world = createWorld();
    await invite(world, 'halfway', 'admin');

    const result = await applyTeamRoleChange(
      {
        ...world.deps,
        account: {
          writeTeamRole: async () => {
            throw new Error('simulated app_metadata failure');
          },
          removeAccount: world.deps.account.removeAccount,
        },
      },
      { userId: 'halfway', previousRole: 'admin', nextRole: 'viewer' },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_INCONSISTENT');
    // The membership is already down. A half-completed demotion must revoke,
    // never restore — putting `org_admin` back would undo the revocation an
    // administrator just asked for.
    assert.deepEqual(world.db.liveMarqRows('halfway').map((r) => r.role_key), ['team_viewer']);

    const actor = await world.resolveAsync('halfway');
    assert.ok(
      !actor.roles.includes('org_admin'),
      'the organization capability is gone even though the change reported failure',
    );
  });
});

// ===========================================================================
// Tenancy invariants that must survive the lifecycle
// ===========================================================================

describe('tenancy invariants', () => {
  it('G. a browser organization hint cannot reach another tenant', async () => {
    const world = createWorld();
    await invite(world, 'tenant-probe', 'admin');

    await assert.rejects(
      () => world.resolveAsync('tenant-probe', OTHER_ORG),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'ORGANIZATION_NOT_RESOLVED');
        return true;
      },
      'a hint the subject does not hold must be refused, not downgraded',
    );
  });

  it('G. the lifecycle cannot place a membership in another tenant', async () => {
    const world = createWorld();
    await invite(world, 'confined', 'admin');

    // The port takes a user id and a team role. There is no argument through
    // which an organization could be named, which is the point.
    const synced = await world.db.port.sync('confined', 'admin');
    assert.equal(synced.organizationId, MARQ_ORG);
    assert.deepEqual(
      world.db.rows.filter((r) => r.user_id === 'confined').map((r) => r.organization_id),
      [MARQ_ORG],
    );
  });

  it('J. holding two verified memberships still fails closed', async () => {
    const world = createWorld();
    await invite(world, 'two-tenants', 'admin');
    world.db.seedMembership('two-tenants', 'team_member', OTHER_ORG);

    await assert.rejects(
      () => world.resolveAsync('two-tenants'),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'ORGANIZATION_REQUIRED');
        return true;
      },
      'ambiguity must be a refusal, never a guess',
    );
  });

  it('H. no team role maps to platform_admin, and none can be assigned one', () => {
    for (const role of TEAM_ROLES) {
      assert.notEqual(
        TEAM_ROLE_TO_ORGANIZATION_ROLE[role],
        'platform_admin',
        `${role} must not map to platform_admin`,
      );
    }
    assert.deepEqual(
      [...new Set(Object.values(TEAM_ROLE_TO_ORGANIZATION_ROLE))].sort(),
      ['org_admin', 'team_member', 'team_viewer'],
      'the mapping has exactly three targets, and platform_admin is not one',
    );
  });

  it('F. no membership role grants more than its source team role', async () => {
    for (const role of TEAM_ROLES) {
      const world = createWorld();
      await invite(world, 'mapped', role);
      const actor = await world.resolveAsync('mapped');

      // The membership role is exactly the mapped one — the lifecycle cannot
      // produce a membership at a role the team role does not map to.
      assert.deepEqual(
        world.db.liveMarqRows('mapped').map((r) => r.role_key),
        [TEAM_ROLE_TO_ORGANIZATION_ROLE[role]],
      );
      assert.ok(actor.roles.includes(role));
      assert.ok(actor.roles.includes(TEAM_ROLE_TO_ORGANIZATION_ROLE[role]));
    }
  });

  it('K. a soft-deleted membership stops resolving at once', async () => {
    const world = createWorld();
    await invite(world, 'tombstoned', 'admin');
    await world.db.port.revoke('tombstoned');
    // The row is still there — soft delete keeps the history — and grants
    // nothing.
    assert.equal(world.db.rows.filter((r) => r.user_id === 'tombstoned').length, 1);

    await assert.rejects(
      () => world.resolveAsync('tombstoned'),
      (error: unknown) => (error as AIError).code === 'ORGANIZATION_REQUIRED',
    );
  });
});
