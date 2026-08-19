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
  resolveTrustedGlobalRoles,
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
import {
  AUTHORITY_LADDER,
  MEMBERSHIP_AUTHORITY_CEILING,
  PRIVILEGED_CAPABILITIES,
  resolveActor,
} from '../../supabase/functions/server/ai/security/actor.ts';
import {
  resolveAdminActor,
  resolveAdminRole,
} from '../../supabase/functions/server/ai/admin/rbac.ts';
import { resolveAgentActor } from '../../supabase/functions/server/ai/agents/service/agentRbac.ts';
import { resolveWorkflowActor } from '../../supabase/functions/server/ai/workflows/service/workflowRbac.ts';
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

interface Resolved {
  roles: readonly string[];
  capabilities: readonly string[];
  organizationId: string;
  membershipVerified: boolean;
}

/** How a request asks for a subject. `privileged` mirrors what the AI Guard
 *  derives from the feature descriptor's declared capability. */
interface ResolveOptions {
  organizationHint?: string;
  privileged?: boolean;
}

/**
 * One edge isolate.
 *
 * The distinction matters because a cache is per-isolate. Two isolates share
 * the auth directory and the database and share NOTHING else — not the
 * membership snapshot, and not the invalidation signal, which cannot cross a
 * process boundary. That is the M-A geometry, and the only honest way to test
 * it is to build two of these.
 */
interface Isolate {
  resolveAsync(userId: string, options?: ResolveOptions): Promise<Resolved>;
}

interface World {
  auth: FakeAuthDirectory;
  db: FakeMembershipDatabase;
  deps: TeamLifecycleDeps;
  /** Bearer token -> resolved actor, through every real component. */
  resolveAsync(userId: string, organizationHint?: string, options?: ResolveOptions): Promise<Resolved>;
  /** A SECOND isolate over the same two stores: its own cache, no signal. */
  otherIsolate(): Isolate;
  clockMs: { value: number };
}

const TENANCY_OPTIONS = {
  defaultOrganizationId: 'default-org',
  allowList: [] as readonly string[],
  // I. The default organization stays disabled. Every assertion below about a
  // subject with no membership is an assertion about failing CLOSED.
  allowDefaultOrganization: false,
};

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

  /**
   * Build an isolate. `signal` is passed only for the isolate that also runs
   * the lifecycle; every other isolate is deliberately deaf, because a real one
   * is.
   */
  function createIsolate(signal?: ReturnType<typeof createMembershipInvalidationSignal>): Isolate {
    // The authenticator the edge entry point builds, with the same two ports.
    const authenticator = createSupabaseAuthenticator({
      getUser: async (token: string) => {
        const record = auth.get(token);   // the token IS the user id here
        if (!record) return null;
        // The same trusted resolution `index.tsx` performs: platform authority
        // and team authority, both from `app_metadata`, neither from the other.
        return { id: record.id, email: record.email, roles: resolveTrustedGlobalRoles(record) };
      },
      listMemberships: async (userId: string) => listVerifiedMemberships(db.queryClient(), userId),
      invalidation: signal,
      clock: { now: () => clockMs.value },
    });

    return {
      async resolveAsync(userId: string, options: ResolveOptions = {}) {
        const subject = await authenticator.authenticate(`Bearer ${userId}`, {
          privileged: options.privileged,
        });
        const organization = resolveOrganization(subject, options.organizationHint, TENANCY_OPTIONS);
        const actor = resolveActor(subject, organization.organizationId, { allowAnonymous: false });
        return {
          roles: actor.roles,
          capabilities: actor.capabilities,
          organizationId: organization.organizationId,
          membershipVerified: organization.membershipVerified,
        };
      },
    };
  }

  const primary = createIsolate(invalidation);

  return {
    auth,
    db,
    deps,
    clockMs,
    resolveAsync: (userId, organizationHint, options = {}) =>
      primary.resolveAsync(userId, { ...options, organizationHint }),
    otherIsolate: () => createIsolate(),
  };
}

/** The subject an isolate would hand the AI ADMINISTRATION surface. */
async function adminSubjectFor(
  world: World,
  userId: string,
): Promise<Parameters<typeof resolveAdminRole>[0]> {
  const record = world.auth.get(userId);
  assert.ok(record, `${userId} must exist`);
  return {
    subjectId: userId,
    email: record.email,
    actorType: 'team_user',
    globalRoles: resolveTrustedGlobalRoles(record),
    memberships: await listVerifiedMemberships(world.db.queryClient(), userId),
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

describe('removal deletes the account before it revokes', () => {
  it('a removed member holds no live membership and no account', async () => {
    const world = createWorld();
    await invite(world, 'leaver', 'admin');
    assert.equal(world.db.liveMarqRows('leaver').length, 1);

    const result = await revokeTeamAccount(world.deps, { userId: 'leaver' });
    assert.equal(result.ok, true);
    assert.equal(world.db.liveMarqRows('leaver').length, 0);
    assert.equal(world.auth.has('leaver'), false);
  });

  it('changes nothing when the account delete fails', async () => {
    // The account goes first, so its failure is the "nothing applied" case:
    // the member keeps everything, in both systems, and the operator retries.
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
    assert.equal(world.auth.has('stuck'), true);
    assert.equal(world.db.liveMarqRows('stuck').length, 1);
  });

  it('leaves NO authority behind when the membership revoke fails', async () => {
    // The half-completed removal, in the order that makes it safe. The account
    // is gone, so nothing can authenticate as this person — not the AI path and
    // not the console, whose `verifyTeamToken` and `authorizeTeamAdmin` read
    // the `app_metadata` that went with it.
    //
    // The previous order revoked the membership first and left the account
    // standing with `marq_team: true` and `team_role: 'admin'`. That is H-A's
    // shape applied to a removal: somebody just removed could still invite,
    // re-role and delete their former colleagues.
    const world = createWorld();
    await invite(world, 'halfway-out', 'admin');
    world.db.failNextRevoke = 'halfway-out';

    const result = await revokeTeamAccount(world.deps, { userId: 'halfway-out' });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_INCONSISTENT');
    assert.equal(world.auth.has('halfway-out'), false, 'the account is gone');

    // The stale row is genuinely still there — so this is the floor and the
    // deleted account doing the work, not a tidy-up that happened anyway.
    assert.equal(world.db.liveMarqRows('halfway-out').length, 1);

    // And nothing can be resolved from it: there is no auth record to
    // authenticate against.
    const resolved = await world.otherIsolate().resolveAsync('halfway-out', { privileged: true })
      .then(() => 'resolved', () => 'refused');
    assert.equal(resolved, 'refused', 'a deleted account must not resolve an actor');

    assert.match(result.failure.message, /no longer sign in/i);
    assert.match(result.failure.message, /No access remains/i);
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

  it('applies nothing at all when the FIRST write of a demotion fails', async () => {
    // The trusted team role is written first now, so a failure there leaves
    // both systems exactly as they were. The member keeps the role they had —
    // which is the honest outcome, and the one the message promises.
    const world = createWorld();
    await invite(world, 'nothing-applied', 'admin');

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
      { userId: 'nothing-applied', previousRole: 'admin', nextRole: 'viewer' },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_SYNC_FAILED');
    assert.equal(resolveTeamRoleFromAuthRecord(world.auth.get('nothing-applied')), 'admin');
    assert.deepEqual(world.db.liveMarqRows('nothing-applied').map((r) => r.role_key), ['org_admin']);
  });
});

// ===========================================================================
// H-A — A PARTIAL DEMOTION REVOKES
//
// The finding, restated: the previous fix demoted the membership first and left
// the trusted `app_metadata` team role at `admin` when the second write failed.
// `ROLE_CAPABILITIES.admin` grants `ai.agent.execute` without any membership at
// all, so the account kept every capability the demotion was meant to remove —
// and the regression test over it asserted only that the string `org_admin` was
// absent from `actor.roles`, which it was, while `ai.agent.execute` sat in
// `actor.capabilities` untouched.
//
// So every assertion in this block is about an AUTHORIZATION OUTCOME. Role
// labels appear only as supplementary diagnostics, after the outcome has been
// pinned, and never as the thing being proven.
// ===========================================================================

/** Everything a consistent account at `role` actually holds, for comparison. */
async function referenceFor(role: TeamRole): Promise<Resolved> {
  const reference = createWorld();
  await invite(reference, `reference-${role}`, role);
  return reference.resolveAsync(`reference-${role}`);
}

/**
 * Drive `admin`/`owner` down to `nextRole` with the MEMBERSHIP write failing,
 * and return the state that leaves behind.
 */
async function partialDemotion(previousRole: TeamRole, nextRole: TeamRole) {
  const world = createWorld();
  const userId = `partial-${previousRole}-${nextRole}`;
  const invited = await invite(world, userId, previousRole);
  assert.equal(invited.ok, true, 'precondition: the account provisions cleanly');

  const before = await world.resolveAsync(userId, undefined, { privileged: true });
  assert.ok(
    before.capabilities.includes('ai.agent.execute'),
    `precondition: a ${previousRole} can execute agents`,
  );

  world.db.failNextSync = userId;
  const result = await applyTeamRoleChange(world.deps, { userId, previousRole, nextRole });

  return {
    world,
    userId,
    result,
    before,
    after: await world.resolveAsync(userId, undefined, { privileged: true }),
  };
}

describe('H-A: a demotion whose membership write fails still revokes', () => {
  it('admin -> viewer: no console authority, no ai.agent.execute, nothing above a viewer', async () => {
    const { world, userId, result, after } = await partialDemotion('admin', 'viewer');

    // 1. The change reports failure. It does NOT answer success.
    assert.equal(result.ok, false, 'a half-applied change must not report success');
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_INCONSISTENT');

    // 2. THE AUTHORIZATION OUTCOME. This is the assertion the old test was
    //    missing, and it is first because it is the finding.
    assert.equal(
      after.capabilities.includes('ai.agent.execute'),
      false,
      'ai.agent.execute must be absent after a partial demotion',
    );

    // 3. Not one capability above the floor survived — named or not.
    const viewer = await referenceFor('viewer');
    assert.deepEqual(
      [...after.capabilities].sort(),
      [...viewer.capabilities].sort(),
      'a partially demoted admin must hold exactly what a viewer holds',
    );
    for (const capability of PRIVILEGED_CAPABILITIES) {
      assert.equal(
        after.capabilities.includes(capability),
        false,
        `${capability} must not survive a partial demotion`,
      );
    }

    // 4. CONSOLE AUTHORITY. The half of the platform the AI capability list
    //    says nothing about: `authorizeTeamAdmin` is what guards invite,
    //    re-role and remove, and it must now refuse this account.
    const authority = resolveTeamAuthority(world.auth.get(userId));
    const consoleCheck = authorizeTeamAdmin(userId, authority);
    assert.equal(consoleCheck.ok, false, 'console team administration must be refused');
    if (!consoleCheck.ok) assert.equal(consoleCheck.failure.code, 'FORBIDDEN');

    // 5. AI ADMINISTRATION. Neither the platform tier nor anything above the
    //    read-only one.
    const adminSubject = await adminSubjectFor(world, userId);
    const adminRole = resolveAdminRole(adminSubject);
    assert.notEqual(adminRole, 'super_admin');
    assert.notEqual(adminRole, 'organization_admin');

    // 6. The inconsistency is described accurately: what took effect, what did
    //    not, and that no elevated access remains.
    assert.match(result.failure.message, /organization membership row/i);
    assert.match(result.failure.message, /no elevated access remains/i);
    assert.match(result.failure.diagnostics, /stage=membership/);
    assert.match(result.failure.diagnostics, /effective=viewer/);

    // 7. Diagnostics, SUPPLEMENTARY. The stale row really is still there — the
    //    revocation is not an artifact of the row having been cleaned up.
    assert.deepEqual(
      world.db.liveMarqRows(userId).map((r) => r.role_key),
      ['org_admin'],
      'the membership row is genuinely stale; the floor is what revoked',
    );
    assert.equal(resolveTeamRoleFromAuthRecord(world.auth.get(userId)), 'viewer');
    assert.ok(after.roles.includes('org_admin'), 'the stale role is still reported for the audit record');
  });

  it('admin -> analyst: holds an analyst, and nothing an admin held on top', async () => {
    const { world, userId, result, after } = await partialDemotion('admin', 'analyst');

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_INCONSISTENT');

    // An analyst legitimately executes agents, so the outcome under test is
    // not "ai.agent.execute is gone" — it is "nothing an ADMIN held survives".
    const analyst = await referenceFor('analyst');
    assert.deepEqual(
      [...after.capabilities].sort(),
      [...analyst.capabilities].sort(),
      'a partially demoted admin holds exactly what an analyst holds',
    );
    for (const capability of ['ai.block.assist', 'ai.copilot.plan', 'ai.section.copilot'] as const) {
      assert.equal(
        after.capabilities.includes(capability),
        false,
        `${capability} was an admin capability and must not survive`,
      );
    }

    const consoleCheck = authorizeTeamAdmin(userId, resolveTeamAuthority(world.auth.get(userId)));
    assert.equal(consoleCheck.ok, false, 'an analyst may not administer the team');

    assert.notEqual(resolveAdminRole(await adminSubjectFor(world, userId)), 'super_admin');
    assert.match(result.failure.diagnostics, /effective=analyst/);
  });

  it('owner -> viewer: the platform tier and every capability fall together', async () => {
    const { world, userId, result, after } = await partialDemotion('owner', 'viewer');

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_INCONSISTENT');

    assert.equal(after.capabilities.includes('ai.agent.execute'), false);
    const viewer = await referenceFor('viewer');
    assert.deepEqual([...after.capabilities].sort(), [...viewer.capabilities].sort());

    const consoleCheck = authorizeTeamAdmin(userId, resolveTeamAuthority(world.auth.get(userId)));
    assert.equal(consoleCheck.ok, false, 'a demoted owner may not administer the team');

    // M-B's other half: this account was an owner a moment ago, and even THEN
    // it was not the AI platform operator. Now it is not an administrator of
    // anything.
    const adminSubject = await adminSubjectFor(world, userId);
    assert.equal(resolveAdminRole(adminSubject), undefined);
    assert.throws(
      () => resolveAdminActor(adminSubject),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'FORBIDDEN');
        return true;
      },
      'a demoted owner is refused the AI administration surface outright',
    );
  });

  it('the failure never restores the higher role as compensation', async () => {
    // Compensation on a demotion would undo the revocation an administrator
    // just asked for. The trusted role stays DOWN whatever else failed.
    for (const [from, to] of [['admin', 'viewer'], ['owner', 'analyst'], ['admin', 'reviewer']] as const) {
      const { world, userId } = await partialDemotion(from, to);
      assert.equal(
        resolveTeamRoleFromAuthRecord(world.auth.get(userId)),
        to,
        `${from} -> ${to}: the trusted role must not be put back`,
      );
    }
  });
});

// ===========================================================================
// M-A — THE CROSS-ISOLATE REVOCATION WINDOW
//
// The finding: the membership cache is per-isolate and the invalidation signal
// cannot leave the process that fired it. Isolate A caches `org_admin`, isolate
// B performs the demotion, and A keeps serving the cached membership until its
// TTL expires — up to sixty seconds of privileged authorization that has
// already been revoked.
//
// The clock does NOT move in any test below. Every one of them would pass
// trivially if it did, and none of them is about the TTL.
//
// Two properties close it, and both are exercised here:
//
//   1. `app_metadata` is never cached. `getUser` verifies the token against the
//      auth service on every request in every isolate, so the trusted team role
//      is current everywhere the instant it is written — and the authority
//      floor grants no more than that role.
//
//   2. A PRIVILEGED capability resolves memberships from the database rather
//      than from the snapshot, in whichever isolate is asked. One resolver, one
//      query; the privileged path simply declines to skip it.
// ===========================================================================

describe('M-A: a revocation in one isolate binds every other isolate', () => {
  it('isolate A cached org_admin, isolate B demoted: ai.agent.execute is gone at once', async () => {
    const world = createWorld();          // isolate B — it runs the lifecycle
    const isolateA = world.otherIsolate();

    await invite(world, 'two-isolates', 'admin');

    // Isolate A warms its own cache with the org_admin membership.
    const cached = await isolateA.resolveAsync('two-isolates', { privileged: true });
    assert.ok(cached.roles.includes('org_admin'));
    assert.ok(
      cached.capabilities.includes('ai.agent.execute'),
      'precondition: isolate A has org_admin cached and can execute agents',
    );

    // Isolate B demotes. Its signal reaches its own cache and nothing else —
    // isolate A is not subscribed, exactly as two edge isolates are not.
    const change = await applyTeamRoleChange(world.deps, {
      userId: 'two-isolates',
      previousRole: 'admin',
      nextRole: 'viewer',
    });
    assert.equal(change.ok, true);

    // The clock has not moved. Not by a millisecond.
    assert.equal(world.clockMs.value, 1_000);

    const next = await isolateA.resolveAsync('two-isolates', { privileged: true });
    assert.equal(
      next.capabilities.includes('ai.agent.execute'),
      false,
      'the old org_admin capability must not survive in the isolate that cached it',
    );
    const viewer = await referenceFor('viewer');
    assert.deepEqual([...next.capabilities].sort(), [...viewer.capabilities].sort());
  });

  it('holds when only the membership is revoked and app_metadata is untouched', async () => {
    // The harder half. A membership revoked directly in the database — the
    // account removal path, a support script, a manual SQL edit — leaves the
    // trusted team role saying `admin`, so property 1 above does nothing and
    // property 2 has to carry it alone.
    const world = createWorld();
    const isolateA = world.otherIsolate();
    await invite(world, 'db-revoked', 'admin');

    const cached = await isolateA.resolveAsync('db-revoked', { privileged: true });
    assert.ok(cached.capabilities.includes('ai.agent.execute'));

    await world.db.port.revoke('db-revoked');
    assert.equal(world.clockMs.value, 1_000);
    assert.equal(
      resolveTeamRoleFromAuthRecord(world.auth.get('db-revoked')),
      'admin',
      'the trusted role is deliberately left alone: the membership read is what must catch this',
    );

    await assert.rejects(
      () => isolateA.resolveAsync('db-revoked', { privileged: true }),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'ORGANIZATION_REQUIRED');
        return true;
      },
      'a privileged request must fail closed the moment the membership is gone',
    );
  });

  it('re-roling to a LOWER membership binds the other isolate immediately', async () => {
    const world = createWorld();
    const isolateA = world.otherIsolate();
    await invite(world, 'db-reroled', 'admin');

    const cached = await isolateA.resolveAsync('db-reroled', { privileged: true });
    assert.ok(cached.capabilities.includes('ai.agent.execute'));

    // Only the row moves — the mirror of the previous test, one step milder.
    await world.db.port.sync('db-reroled', 'viewer');
    assert.equal(world.clockMs.value, 1_000);

    const next = await isolateA.resolveAsync('db-reroled', { privileged: true });
    assert.equal(
      next.capabilities.includes('ai.agent.execute'),
      false,
      'a stale admin team role must not out-vote a demoted membership row',
    );
    assert.ok(next.roles.includes('admin'), 'the trusted role really is still admin');
    assert.ok(next.roles.includes('team_viewer'));
  });

  it('an ordinary read may still be served from the snapshot, and grants nothing privileged', async () => {
    // The other side of the trade: a capability every team member already holds
    // is not worth a round trip, because there is nothing there to revoke. The
    // snapshot may be stale and the answer is still correct — no member of
    // PRIVILEGED_CAPABILITIES can come out of it.
    const world = createWorld();
    const isolateA = world.otherIsolate();
    await invite(world, 'ordinary', 'admin');

    await isolateA.resolveAsync('ordinary', { privileged: false });
    await world.db.port.sync('ordinary', 'viewer');
    assert.equal(world.clockMs.value, 1_000);

    const ordinary = await isolateA.resolveAsync('ordinary', { privileged: false });
    for (const capability of PRIVILEGED_CAPABILITIES) {
      assert.equal(
        ordinary.capabilities.includes(capability),
        false,
        `${capability} is privileged and must never come out of a stale snapshot`,
      );
    }
  });

  it('the privileged read refreshes the snapshot it declined to use', async () => {
    const world = createWorld();
    const isolateA = world.otherIsolate();
    await invite(world, 'refresher', 'admin');

    await isolateA.resolveAsync('refresher', { privileged: false });   // warm
    await world.db.port.sync('refresher', 'viewer');
    await isolateA.resolveAsync('refresher', { privileged: true });    // read through

    // Now even an ordinary request sees the new membership, without the clock
    // having moved: the privileged read wrote what it found back.
    assert.equal(world.clockMs.value, 1_000);
    const ordinary = await isolateA.resolveAsync('refresher', { privileged: false });
    assert.ok(ordinary.roles.includes('team_viewer'));
    assert.equal(ordinary.roles.includes('org_admin'), false);
  });
});

// ===========================================================================
// The floor reaches every surface that unions the two sources
//
// `resolveActor` is not the only place the trusted team role and the membership
// row were added together. The agent runtime and the workflow runtime keep
// their own capability tables, keyed by team role, and both built their actor
// from `[...globalRoles, ...membership.roles]`. A demoted membership left the
// stale team role granting `agent.approval.decide` and `workflow.run.create`
// through those tables, which `resolveActor`'s floor never sees.
// ===========================================================================

describe('the authority floor covers the agent and workflow runtimes', () => {
  async function subjectFor(world: World, userId: string) {
    const record = world.auth.get(userId);
    assert.ok(record);
    return {
      subjectId: userId,
      email: record.email,
      actorType: 'team_user' as const,
      globalRoles: resolveTrustedGlobalRoles(record),
      memberships: await listVerifiedMemberships(world.db.queryClient(), userId),
    };
  }

  it('a demoted membership row revokes agent and workflow authority too', async () => {
    const world = createWorld();
    await invite(world, 'runtime-user', 'admin');

    const before = await subjectFor(world, 'runtime-user');
    const agentBefore = resolveAgentActor(before, undefined, TENANCY_OPTIONS);
    const workflowBefore = resolveWorkflowActor(before, undefined, TENANCY_OPTIONS, agentBefore.capabilities);
    assert.ok(agentBefore.capabilities.includes('agent.run.create'));
    assert.ok(agentBefore.capabilities.includes('agent.approval.decide'));
    assert.ok(workflowBefore.capabilities.includes('workflow.run.create'));

    // Only the ROW moves — the trusted role is deliberately left saying `admin`,
    // which is the direction `resolveActor`'s floor and this one both have to
    // catch from the membership side.
    await world.db.port.sync('runtime-user', 'viewer');
    assert.equal(resolveTeamRoleFromAuthRecord(world.auth.get('runtime-user')), 'admin');

    const after = await subjectFor(world, 'runtime-user');
    assert.throws(
      () => resolveAgentActor(after, undefined, TENANCY_OPTIONS),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'FORBIDDEN');
        return true;
      },
      'a viewer-floored actor holds no agent capability at all',
    );
    assert.throws(
      () => resolveWorkflowActor(after, undefined, TENANCY_OPTIONS, []),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'FORBIDDEN');
        return true;
      },
    );
  });

  it('a stale org_admin row grants no agent or workflow authority either', async () => {
    // The other direction: `app_metadata` already lowered, row still high.
    const world = createWorld();
    await invite(world, 'runtime-demoted', 'admin');
    world.db.failNextSync = 'runtime-demoted';
    await applyTeamRoleChange(world.deps, {
      userId: 'runtime-demoted',
      previousRole: 'admin',
      nextRole: 'viewer',
    });

    const subject = await subjectFor(world, 'runtime-demoted');
    assert.deepEqual(subject.memberships[0]?.roles, ['org_admin'], 'the row is genuinely stale');

    assert.throws(() => resolveAgentActor(subject, undefined, TENANCY_OPTIONS));
    assert.throws(() => resolveWorkflowActor(subject, undefined, TENANCY_OPTIONS, []));
  });

  it('leaves a consistent account exactly as it was', async () => {
    // The floor must be a no-op in agreement, on these tables as on the others.
    for (const role of TEAM_ROLES) {
      const world = createWorld();
      await invite(world, `consistent-${role}`, role);
      const subject = await subjectFor(world, `consistent-${role}`);

      const unfloored = [
        ...new Set([...subject.globalRoles, ...(subject.memberships[0]?.roles ?? [])]),
      ].sort();

      let floored: readonly string[] = [];
      try {
        floored = resolveAgentActor(subject, undefined, TENANCY_OPTIONS).roles;
      } catch {
        // `viewer` holds no agent capability and is refused outright, before
        // and after. Its role list is not observable, and that is the same
        // answer either way.
        assert.equal(role, 'viewer');
        continue;
      }
      assert.deepEqual(
        [...floored].sort(),
        unfloored,
        `${role}: the floor changed a consistent account's roles`,
      );
    }
  });
});

// ===========================================================================
// Promotion is the mirror image, and must also fail closed
// ===========================================================================

describe('a half-applied promotion grants nothing', () => {
  it('viewer -> admin with the membership write failing stays a viewer', async () => {
    const world = createWorld();
    await invite(world, 'half-promoted', 'viewer');
    world.db.failNextSync = 'half-promoted';

    const result = await applyTeamRoleChange(world.deps, {
      userId: 'half-promoted',
      previousRole: 'viewer',
      nextRole: 'admin',
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_SYNC_FAILED');

    // The compensating revert ran: the trusted role is back at `viewer`.
    assert.equal(resolveTeamRoleFromAuthRecord(world.auth.get('half-promoted')), 'viewer');
    const actor = await world.resolveAsync('half-promoted', undefined, { privileged: true });
    assert.equal(actor.capabilities.includes('ai.agent.execute'), false);
  });

  it('grants nothing even when the compensating revert ALSO fails', async () => {
    // The state the revert exists to prevent, reached anyway: `app_metadata`
    // says `admin`, the membership row still says `team_viewer`. The floor is
    // what makes this safe rather than the revert — the promotion does not take
    // effect until BOTH systems carry it.
    const world = createWorld();
    await invite(world, 'stuck-promotion', 'viewer');

    let writes = 0;
    const result = await applyTeamRoleChange(
      {
        ...world.deps,
        membership: {
          sync: async () => {
            throw new Error('simulated membership failure');
          },
          revoke: world.deps.membership.revoke,
        },
        account: {
          async writeTeamRole(userId, role) {
            writes += 1;
            if (writes > 1) throw new Error('simulated revert failure');
            await world.deps.account.writeTeamRole(userId, role);
          },
          removeAccount: world.deps.account.removeAccount,
        },
      },
      { userId: 'stuck-promotion', previousRole: 'viewer', nextRole: 'admin' },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'MEMBERSHIP_INCONSISTENT');
    assert.equal(
      resolveTeamRoleFromAuthRecord(world.auth.get('stuck-promotion')),
      'admin',
      'precondition: the revert really did fail and left the higher role standing',
    );
    assert.deepEqual(world.db.liveMarqRows('stuck-promotion').map((r) => r.role_key), ['team_viewer']);

    const actor = await world.resolveAsync('stuck-promotion', undefined, { privileged: true });
    assert.equal(
      actor.capabilities.includes('ai.agent.execute'),
      false,
      'a promotion that did not reach the membership grants nothing',
    );
    const viewer = await referenceFor('viewer');
    assert.deepEqual([...actor.capabilities].sort(), [...viewer.capabilities].sort());
  });
});

// ===========================================================================
// M-B — A MARQ TEAM OWNER IS NOT THE AI PLATFORM OPERATOR
//
// The finding: `team_role = 'owner'` was routed through the AI admin RBAC's
// `SUPER_ADMIN_ROLES` into the platform operator tier — the emergency kill
// switch, the provider configuration every tenant executes through, the global
// daily ceilings and the reset of MARQ's lifetime funded spend. Owning a
// console team is an organization fact. Operating the platform is not.
//
// The separation uses the authority that already existed:
// `app_metadata.platform_role = 'admin'`, which `cortex.is_platform_admin()`
// has governed the database's RLS with since the tenancy migration. No new RBAC
// system, and nothing a console route can write.
// ===========================================================================

const PLATFORM_CAPABILITIES = [
  'ai.admin.provider.write',
  'ai.admin.settings.write',
  'ai.admin.budget.write',
  'ai.admin.budget.reset',
  'ai.admin.killswitch',
] as const;

describe('M-B: platform administration is explicit', () => {
  it('a team owner keeps organization authority and gets no platform capability', async () => {
    const world = createWorld();
    await invite(world, 'team-owner', 'owner');

    // Still the top of the team: full console administration.
    const consoleCheck = authorizeTeamAdmin('team-owner', resolveTeamAuthority(world.auth.get('team-owner')));
    assert.equal(consoleCheck.ok, true, 'an owner still administers the team');

    // Still every AI execution capability an owner is for.
    const actor = await world.resolveAsync('team-owner', undefined, { privileged: true });
    assert.ok(actor.capabilities.includes('ai.agent.execute'));
    assert.ok(actor.roles.includes('org_admin'), 'still an organization administrator');

    // And NOT the platform operator.
    const admin = resolveAdminActor(await adminSubjectFor(world, 'team-owner'));
    assert.equal(admin.role, 'organization_admin', 'an owner administers their organization, not the platform');
    for (const capability of PLATFORM_CAPABILITIES) {
      assert.equal(
        admin.capabilities.includes(capability),
        false,
        `a team owner must not hold ${capability}`,
      );
    }
    assert.deepEqual(
      [...admin.capabilities].sort(),
      ['ai.admin.audit.read', 'ai.admin.view'],
      'the organization tier is read-only',
    );
  });

  it('an explicit trusted platform admin receives the platform capabilities', async () => {
    const world = createWorld();
    await invite(world, 'platform-op', 'viewer');
    // The service role writing the field `cortex.is_platform_admin()` reads.
    // Note the team role is the LEAST privileged one: platform authority does
    // not ride on the team ladder in either direction.
    world.auth.writeAppMetadata('platform-op', { platform_role: 'admin' });

    const admin = resolveAdminActor(await adminSubjectFor(world, 'platform-op'));
    assert.equal(admin.role, 'super_admin');
    for (const capability of PLATFORM_CAPABILITIES) {
      assert.ok(admin.capabilities.includes(capability), `the platform operator holds ${capability}`);
    }
    assert.deepEqual(admin.organizationScope, [], 'the platform operator sees every organization');
  });

  it('a forged user_metadata platform_role receives neither', async () => {
    const world = createWorld();
    await invite(world, 'forger', 'viewer');
    // Everything a signed-in account can write for itself through GoTrue's
    // `PUT /auth/v1/user`, thrown at both surfaces at once.
    world.auth.selfWriteUserMetadata('forger', {
      platform_role: 'admin',
      role: 'team',
      teamRole: 'owner',
      marq_team: true,
      team_role: 'owner',
    });

    const subject = await adminSubjectFor(world, 'forger');
    assert.deepEqual(subject.globalRoles, ['viewer'], 'user_metadata reaches no trusted role');
    assert.equal(resolveAdminRole(subject), undefined);
    assert.throws(() => resolveAdminActor(subject), (error: unknown) => {
      assert.equal((error as AIError).code, 'FORBIDDEN');
      return true;
    });

    const consoleCheck = authorizeTeamAdmin('forger', resolveTeamAuthority(world.auth.get('forger')));
    assert.equal(consoleCheck.ok, false, 'and no console authority either');

    const actor = await world.resolveAsync('forger', undefined, { privileged: true });
    assert.equal(actor.capabilities.includes('ai.agent.execute'), false);
  });

  it('no team role reaches the platform tier, at any rank', async () => {
    // The finding named `owner`. This asserts the property for the whole
    // vocabulary, so a future addition to TEAM_ROLES cannot reintroduce it.
    for (const role of TEAM_ROLES) {
      const world = createWorld();
      await invite(world, `rank-${role}`, role);
      const resolved = resolveAdminRole(await adminSubjectFor(world, `rank-${role}`));
      assert.notEqual(resolved, 'super_admin', `team role ${role} must not confer platform administration`);
    }
  });

  it('a membership row cannot confer platform administration either', async () => {
    // Belt to the braces: even a hand-written membership row naming a
    // platform-sounding key is a statement about ONE tenant, and the platform
    // tier is resolved from global roles alone.
    const world = createWorld();
    await invite(world, 'row-claim', 'viewer');
    world.db.seedMembership('row-claim', 'platform_admin');
    world.db.seedMembership('row-claim', 'super_admin');

    const subject = await adminSubjectFor(world, 'row-claim');
    assert.notEqual(resolveAdminRole(subject), 'super_admin');
  });

  it('the console provisioning shape carries no platform key', async () => {
    // `teamAppMetadata` is what every server-side provisioning path sends. If
    // it ever carried `platform_role`, an `admin` re-roling a colleague would
    // be minting platform operators through a console route.
    for (const role of TEAM_ROLES) {
      assert.deepEqual(Object.keys(teamAppMetadata(role)).sort(), ['marq_team', 'team_role']);
    }
  });

  it('a role change never disturbs an existing platform_role', async () => {
    const world = createWorld();
    await invite(world, 'both-hats', 'admin');
    world.auth.writeAppMetadata('both-hats', { platform_role: 'admin' });

    const change = await applyTeamRoleChange(world.deps, {
      userId: 'both-hats',
      previousRole: 'admin',
      nextRole: 'viewer',
    });
    assert.equal(change.ok, true);

    // The team demotion took effect; the separately-granted platform authority
    // is not the console's to revoke and is still there.
    assert.equal(resolveTeamRoleFromAuthRecord(world.auth.get('both-hats')), 'viewer');
    assert.equal(
      resolveAdminRole(await adminSubjectFor(world, 'both-hats')),
      'super_admin',
      'platform authority is granted and revoked through platform_role, not through a team role',
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
