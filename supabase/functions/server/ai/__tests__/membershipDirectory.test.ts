/**
 * AI-01 Batch 4A remediation — the membership row -> SubjectMembership
 * transformation, driven behaviourally.
 *
 * The review's M3 finding: the transformation was covered by regular
 * expressions over `index.tsx`. A source assertion can show that `.eq('status',
 * 'active')` is written down. It cannot show what the function RETURNS for a
 * suspended row, for a row whose organization has been erased, or for the
 * embedded shape a different schema cache produces — and those are the answers
 * that decide whether an operator resolves a tenant.
 *
 * So the transformation lives in `adapters/membershipDirectory.ts` and this
 * suite drives it with rows, then carries the result through the REAL
 * `createSupabaseAuthenticator`, `resolveActor` and `resolveOrganization`. What
 * is asserted here is behaviour end to end: a role key reaching an authorization
 * decision, and a dead tenant reaching nothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEMBERSHIP_SELECT,
  MEMBERSHIP_TABLE,
  listVerifiedMemberships,
  toSubjectMemberships,
  type MembershipQueryBuilder,
  type MembershipQueryClient,
} from '../adapters/membershipDirectory.ts';
import { createSupabaseAuthenticator } from '../adapters/supabaseAuthenticator.ts';
import { resolveActor } from '../security/actor.ts';
import { resolveOrganization } from '../security/tenancy.ts';
import { createTestClock } from '../runtime/clock.ts';
import { AIError } from '../contracts/errors.ts';

const ORG = 'b1f0c4d2-0000-4000-8000-000000000001';
const OTHER_ORG = 'b1f0c4d2-0000-4000-8000-000000000002';

const TENANCY = {
  defaultOrganizationId: 'marq-cortex',
  allowList: [] as string[],
  allowDefaultOrganization: false,
};

/** A row exactly as the query returns one for a healthy, live membership. */
function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    status: 'active',
    deleted_at: null,
    organizations: { slug: 'marq', deleted_at: null },
    roles: { key: 'org_admin' },
    ...overrides,
  };
}

describe('membership row -> SubjectMembership', () => {
  it('carries the organization, the slug and the role key', () => {
    assert.deepEqual(toSubjectMemberships([liveRow()]), [
      { organizationId: ORG, slug: 'marq', roles: ['org_admin'] },
    ]);
  });

  it('normalises the role key rather than trusting its casing', () => {
    const [membership] = toSubjectMemberships([liveRow({ roles: { key: '  ORG_Admin ' } })]);
    assert.deepEqual(membership.roles, ['org_admin']);
  });

  it('reads an embedded relation returned as a one-element array', () => {
    // A client that infers the relationship as to-many returns arrays. Before
    // this was handled, the difference silently emptied the role set — which is
    // indistinguishable from the `roles: []` defect being fixed.
    const [membership] = toSubjectMemberships([
      liveRow({ organizations: [{ slug: 'marq', deleted_at: null }], roles: [{ key: 'team_member' }] }),
    ]);
    assert.equal(membership.slug, 'marq');
    assert.deepEqual(membership.roles, ['team_member']);
  });

  it('admits a membership with no role rather than dropping it', () => {
    // The membership still establishes the tenant. It grants no role, which is
    // what an empty role set means — not "no membership".
    const [membership] = toSubjectMemberships([liveRow({ roles: null })]);
    assert.equal(membership.organizationId, ORG);
    assert.deepEqual(membership.roles, []);
  });

  it('drops a soft-deleted membership', () => {
    assert.deepEqual(toSubjectMemberships([liveRow({ deleted_at: '2026-08-01T00:00:00Z' })]), []);
  });

  for (const status of ['invited', 'suspended', 'ACTIVE ', '']) {
    it(`drops a membership with status ${JSON.stringify(status)}`, () => {
      // `ACTIVE ` is normalised and admitted; the other three are not. Written
      // as one loop so a future status cannot be added without a decision.
      const result = toSubjectMemberships([liveRow({ status })]);
      assert.equal(result.length, status.trim().toLowerCase() === 'active' ? 1 : 0);
    });
  }

  it('drops a membership in a soft-deleted organization', () => {
    // M1. The tenant has been erased. A membership in it is not a weaker
    // membership — there is nothing to be a member of, and the slug it carries
    // may already belong to a different live organization.
    assert.deepEqual(
      toSubjectMemberships([
        liveRow({ organizations: { slug: 'marq', deleted_at: '2026-08-01T00:00:00Z' } }),
      ]),
      [],
    );
  });

  it('drops a membership whose organization did not join', () => {
    // A null embed is what a left join returns for a row the filter should have
    // removed. Admitting it would defeat the liveness check in exactly the case
    // the check exists for.
    assert.deepEqual(toSubjectMemberships([liveRow({ organizations: null })]), []);
  });

  it('drops rows with no usable organization id', () => {
    assert.deepEqual(
      toSubjectMemberships([
        liveRow({ organization_id: null }),
        liveRow({ organization_id: '' }),
        liveRow({ organization_id: 42 }),
        null,
        'not a row',
      ]),
      [],
    );
  });

  it('returns nothing for a non-array payload', () => {
    for (const payload of [null, undefined, {}, 'rows', 0]) {
      assert.deepEqual(toSubjectMemberships(payload), []);
    }
  });

  it('orders the result by organization id, whatever order the database used', () => {
    // `resolveOrganization` must not behave differently between two identical
    // requests because the planner returned rows the other way round.
    const forwards = toSubjectMemberships([
      liveRow({ organization_id: OTHER_ORG }),
      liveRow({ organization_id: ORG }),
    ]);
    const backwards = toSubjectMemberships([
      liveRow({ organization_id: ORG }),
      liveRow({ organization_id: OTHER_ORG }),
    ]);
    assert.deepEqual(
      forwards.map((m) => m.organizationId),
      backwards.map((m) => m.organizationId),
    );
    assert.deepEqual(forwards.map((m) => m.organizationId), [ORG, OTHER_ORG]);
  });

  it('keeps the live memberships out of a mixed result', () => {
    const rows = [
      liveRow({ organization_id: OTHER_ORG, status: 'suspended' }),
      liveRow({ organization_id: ORG, roles: { key: 'team_viewer' } }),
      liveRow({ organization_id: 'c0000000-0000-4000-8000-000000000003', organizations: { slug: 'dead', deleted_at: 'x' } }),
    ];
    assert.deepEqual(toSubjectMemberships(rows), [
      { organizationId: ORG, slug: 'marq', roles: ['team_viewer'] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The query the lookup issues.
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly method: 'eq' | 'is';
  readonly column: string;
  readonly value: unknown;
}

/** A PostgREST-shaped fake that records the chain and resolves what it is told. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const tables: string[] = [];
  const selects: string[] = [];
  const calls: RecordedCall[] = [];

  const builder: MembershipQueryBuilder = {
    eq(column, value) {
      calls.push({ method: 'eq', column, value });
      return builder;
    },
    is(column, value) {
      calls.push({ method: 'is', column, value });
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };

  const client: MembershipQueryClient = {
    from(table) {
      tables.push(table);
      return {
        select(columns) {
          selects.push(columns);
          return builder;
        },
      };
    },
  };

  return { client, tables, selects, calls };
}

describe('the membership lookup', () => {
  it('reads the tenancy table and no other', async () => {
    const fake = fakeClient({ data: [liveRow()], error: null });
    await listVerifiedMemberships(fake.client, 'user-1');
    assert.deepEqual(fake.tables, [MEMBERSHIP_TABLE]);
    assert.deepEqual(fake.selects, [MEMBERSHIP_SELECT]);
  });

  it('restricts to the user, to active, to undeleted, and to a live organization', async () => {
    const fake = fakeClient({ data: [], error: null });
    await listVerifiedMemberships(fake.client, 'user-1');
    assert.deepEqual(fake.calls, [
      { method: 'eq', column: 'user_id', value: 'user-1' },
      { method: 'eq', column: 'status', value: 'active' },
      { method: 'is', column: 'deleted_at', value: null },
      { method: 'is', column: 'organizations.deleted_at', value: null },
    ]);
  });

  it('inner-joins the organization, because a left join makes the filter inert', () => {
    // PostgREST applies a filter on an embedded column to the embed, not to the
    // outer row, unless the relation is an inner join. Without `!inner` the
    // liveness restriction would return the membership with an empty embed.
    assert.match(MEMBERSHIP_SELECT, /organizations!inner\(/);
  });

  it('returns no memberships when the query errors', async () => {
    // A lookup failure must never be the reason somebody is admitted.
    const fake = fakeClient({ data: [liveRow()], error: { message: 'connection reset' } });
    assert.deepEqual(await listVerifiedMemberships(fake.client, 'user-1'), []);
  });

  it('refuses a row the query let through anyway', async () => {
    // The filters are stated in the query AND re-checked on the result. This is
    // the case that separates them: a schema-cache difference that drops the
    // embedded filter server-side still cannot admit a dead tenant.
    const fake = fakeClient({
      data: [liveRow({ organizations: { slug: 'marq', deleted_at: '2026-08-01T00:00:00Z' } })],
      error: null,
    });
    assert.deepEqual(await listVerifiedMemberships(fake.client, 'user-1'), []);
  });
});

// ---------------------------------------------------------------------------
// End to end: rows in, authorization decision out.
// ---------------------------------------------------------------------------

/**
 * Resolve a subject from a set of membership rows and a TRUSTED TEAM ROLE.
 *
 * The team role used to be hard-coded to `viewer` while the rows said
 * `org_admin`, and the assertions below expected the row to win. That is the
 * H-A escalation written down as an expectation: `authorityFloor` now grants no
 * more than the lower of the two, so a test that wants to see what a membership
 * row grants has to pair it with a team role that agrees — which is the only
 * state a working system is ever in.
 */
async function subjectFromRows(rows: unknown, teamRole = 'admin') {
  const fake = fakeClient({ data: rows, error: null });
  const authenticator = createSupabaseAuthenticator({
    getUser: () => Promise.resolve({ id: 'user-1', email: 'operator@marq.test', roles: [teamRole] }),
    listMemberships: (userId) => listVerifiedMemberships(fake.client, userId),
    clock: createTestClock(),
  });
  const subject = await authenticator.authenticate('Bearer token');
  assert.ok(subject, 'a valid credential must resolve a subject');
  return subject;
}

describe('a membership row reaches the authorization decision', () => {
  it('an org_admin row grants the org_admin capabilities', async () => {
    const subject = await subjectFromRows([liveRow()]);
    const organization = resolveOrganization(subject, undefined, TENANCY);
    assert.equal(organization.organizationId, ORG);
    assert.equal(organization.membershipVerified, true);
    assert.equal(organization.slug, 'marq');

    const actor = resolveActor(subject, organization.organizationId, { allowAnonymous: false });
    assert.ok(actor.roles.includes('org_admin'));
    // The point of joining the role catalog: a capability the caller's team
    // role (`viewer`) does not grant.
    assert.ok(actor.capabilities.includes('ai.agent.execute'), actor.capabilities.join(', '));
  });

  it('a team_viewer row grants no capability an org_admin row would', async () => {
    // The defect restated as behaviour rather than as a returned shape: with
    // `roles: []` — and, until the role keys were added to ROLE_CAPABILITIES,
    // with the join in place too — these two resolved identically.
    //
    // Both subjects carry the SAME trusted team role. The only difference is
    // the row, so the difference in the outcome is the row's doing.
    const adminSubject = await subjectFromRows([liveRow()], 'admin');
    const viewerSubject = await subjectFromRows([liveRow({ roles: { key: 'team_viewer' } })], 'admin');

    const admin = resolveActor(adminSubject, ORG, { allowAnonymous: false });
    const viewer = resolveActor(viewerSubject, ORG, { allowAnonymous: false });

    assert.notDeepEqual(admin.capabilities, viewer.capabilities);
    assert.equal(viewer.capabilities.includes('ai.agent.execute'), false);
  });

  it('a stale org_admin row grants nothing to an account demoted to viewer', async () => {
    // H-A, at the resolution layer. The row still says `org_admin` because the
    // second half of a demotion has not landed (or failed); the trusted team
    // role already says `viewer`. The lower of the two is what the actor holds.
    const subject = await subjectFromRows([liveRow()], 'viewer');
    const actor = resolveActor(subject, ORG, { allowAnonymous: false });

    assert.ok(
      actor.sourceRoles?.includes('org_admin'),
      'the row is still reported, for the audit record',
    );
    assert.equal(
      actor.roles.includes('org_admin'),
      false,
      'but the EFFECTIVE roles do not carry a tier the trusted team role no longer supports',
    );
    assert.equal(
      actor.capabilities.includes('ai.agent.execute'),
      false,
      'a stale org_admin row must not grant what the trusted team role no longer does',
    );
    assert.deepEqual(
      [...actor.capabilities].sort(),
      ['ai.chat.converse', 'ai.narrative.generate'],
      'the actor holds exactly the viewer floor',
    );
  });

  it('a suspended row fails the request closed', async () => {
    const subject = await subjectFromRows([liveRow({ status: 'suspended' })]);
    assert.deepEqual(subject.memberships, []);
    assert.throws(
      () => resolveOrganization(subject, undefined, TENANCY),
      (error: AIError) => error.code === 'ORGANIZATION_REQUIRED',
    );
  });

  it('a membership in an erased organization fails the request closed', async () => {
    // M1 end to end. Not "resolves with a weaker guarantee" — resolves nothing.
    const subject = await subjectFromRows([
      liveRow({ organizations: { slug: 'marq', deleted_at: '2026-08-01T00:00:00Z' } }),
    ]);
    assert.deepEqual(subject.memberships, []);
    assert.throws(
      () => resolveOrganization(subject, undefined, TENANCY),
      (error: AIError) => error.code === 'ORGANIZATION_REQUIRED',
    );
  });

  it('an erased organization cannot be reached by naming it either', async () => {
    const subject = await subjectFromRows([
      liveRow({ organizations: { slug: 'marq', deleted_at: '2026-08-01T00:00:00Z' } }),
    ]);
    assert.throws(
      () => resolveOrganization(subject, ORG, TENANCY),
      (error: AIError) => error.code === 'ORGANIZATION_NOT_RESOLVED',
    );
  });

  it('a live membership survives alongside an erased one', async () => {
    // The liveness filter must remove a row, not a subject.
    const subject = await subjectFromRows([
      liveRow({ organization_id: OTHER_ORG, organizations: { slug: 'dead', deleted_at: 'x' } }),
      liveRow(),
    ]);
    assert.equal(subject.memberships.length, 1);
    assert.equal(resolveOrganization(subject, undefined, TENANCY).organizationId, ORG);
  });
});
