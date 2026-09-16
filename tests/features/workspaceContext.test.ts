/**
 * WHICH ORGANIZATION THIS WORKSPACE REPRESENTS — the standing proof.
 *
 * CP-3 Step 3 asks for workspace context that originates in the authenticated
 * membership relationship and that handles loading, a missing organization, an
 * inactive membership, a permission failure and an unreachable backend
 * HONESTLY. Those are five different sentences on screen, and the only thing
 * that keeps them five is a test that fails when any two collapse into one.
 *
 * Three layers are driven end to end here, each at its own seam:
 *
 *   the server resolver  — what a set of database rows resolves to, and what
 *                          an absent workspace is diagnosed as;
 *   the session contract — what the browser accepts off the wire and what
 *                          survives a storage round trip;
 *   the shell label      — what a person actually reads in the header.
 *
 * All three are pure modules with relative `.ts` specifiers, so this runs under
 * `node --experimental-strip-types` with no browser, no Deno and no database.
 * The DATABASE half of the same properties — that Org A cannot read Org B at
 * all — is proven empirically against real PostgreSQL by
 * `scripts/organizational-spine-scenarios.mjs`; this file proves the layer
 * above it does not undo that work by inventing a tenant in JavaScript.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyLookupFailure,
  diagnoseAbsentWorkspace,
  resolveWorkspaceForUser,
  workspaceFromMemberships,
  workspacePayload,
} from '../../supabase/functions/server/organization/workspaceContext.ts';
import {
  MEMBERSHIP_PRESENCE_SELECT,
  MEMBERSHIP_SELECT,
  MEMBERSHIP_TABLE,
  type MembershipQueryBuilder,
  type MembershipQueryClient,
} from '../../supabase/functions/server/ai/adapters/membershipDirectory.ts';
import {
  normaliseWorkspace,
  normaliseWorkspaceReason,
  parseTeamSession,
  serializeTeamSession,
  type TeamSession,
} from '../../src/app/lib/session.ts';
import { workspaceDisplay } from '../../src/app/core/workspaceLabel.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// A PostgREST-shaped fake that answers the TWO queries this module issues:
// the verified-membership read and, when that comes back empty, the diagnostic
// read. Keyed on the select string so a test can make one succeed and the
// other fail — which is exactly the situation that tells a broken lookup apart
// from an empty one.
// ---------------------------------------------------------------------------
type Answer = { data: unknown; error: unknown };

function fakeClient(answers: { verified?: Answer; diagnosis?: Answer }) {
  const selects: string[] = [];
  const tables: string[] = [];
  const filters: { column: string; value: unknown }[] = [];

  const builderFor = (result: Answer): MembershipQueryBuilder => {
    const builder: MembershipQueryBuilder = {
      eq(column, value) { filters.push({ column, value }); return builder; },
      is(column, value) { filters.push({ column, value }); return builder; },
      then(onFulfilled, onRejected) {
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const client: MembershipQueryClient = {
    from(table) {
      tables.push(table);
      return {
        select(columns) {
          selects.push(columns);
          const which = columns === MEMBERSHIP_PRESENCE_SELECT ? 'diagnosis' : 'verified';
          return builderFor(answers[which] ?? { data: [], error: null });
        },
      };
    },
  };

  return { client, selects, tables, filters };
}

/** A membership row exactly as the verified read returns one. */
function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG_A,
    status: 'active',
    deleted_at: null,
    organizations: { id: ORG_A, slug: 'alpha', name: 'Alpha Industries', deleted_at: null },
    roles: { key: 'org_admin' },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('a verified membership becomes a workspace', () => {
  it('names the organization from the row the tenant id came from', () => {
    const resolved = workspaceFromMemberships([
      { organizationId: ORG_A, slug: 'alpha', name: 'Alpha Industries', roles: ['org_admin'] },
    ]);
    assert.deepEqual(resolved, {
      workspace: {
        organizationId: ORG_A,
        organizationName: 'Alpha Industries',
        organizationSlug: 'alpha',
      },
      reason: null,
      otherOrganizations: 0,
    });
  });

  it('says nothing at all when there are no verified memberships', () => {
    // Not "no organization" — the ABSENCE of an answer. Anything else would let
    // a failed lookup be reported as an empty one.
    assert.equal(workspaceFromMemberships([]), null);
  });

  it('falls back to the slug when the organization carries no name', () => {
    const resolved = workspaceFromMemberships([
      { organizationId: ORG_A, slug: 'alpha', roles: [] },
    ]);
    assert.equal(resolved?.workspace?.organizationName, 'alpha');
  });

  it('refuses rather than inventing a name when neither name nor slug exists', () => {
    const resolved = workspaceFromMemberships([{ organizationId: ORG_A, roles: [] }]);
    assert.equal(resolved?.workspace, null);
    assert.equal(resolved?.reason, 'organization-unnamed');
  });

  it('records that a choice was made when the account belongs to several', () => {
    // The session gets ONE workspace. A silent pick among three would be a
    // tenant chosen on the operator's behalf with nothing on the record.
    const resolved = workspaceFromMemberships([
      { organizationId: ORG_A, slug: 'alpha', name: 'Alpha', roles: [] },
      { organizationId: ORG_B, slug: 'beta', name: 'Beta', roles: [] },
    ]);
    assert.equal(resolved?.workspace?.organizationId, ORG_A);
    assert.equal(resolved?.otherOrganizations, 1);
  });

  it('does not lower-case the display name', () => {
    const resolved = workspaceFromMemberships([
      { organizationId: ORG_A, slug: 'marq', name: 'MARQ Network', roles: [] },
    ]);
    assert.equal(resolved?.workspace?.organizationName, 'MARQ Network');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('an absent workspace is diagnosed, never assumed', () => {
  it('no rows at all means no membership', () => {
    assert.equal(diagnoseAbsentWorkspace([]), 'no-membership');
  });

  it('a suspended row means the membership is inactive, not missing', () => {
    assert.equal(
      diagnoseAbsentWorkspace([{ status: 'suspended', deleted_at: null, organizations: { deleted_at: null } }]),
      'membership-inactive',
    );
  });

  it('an invited row is inactive too — an invitation is not a membership', () => {
    assert.equal(
      diagnoseAbsentWorkspace([{ status: 'invited', deleted_at: null, organizations: { deleted_at: null } }]),
      'membership-inactive',
    );
  });

  it('a soft-deleted row means the membership was removed', () => {
    assert.equal(
      diagnoseAbsentWorkspace([{ status: 'active', deleted_at: '2026-01-01', organizations: { deleted_at: null } }]),
      'membership-inactive',
    );
  });

  it('a live membership in an erased tenant is reported as the erased tenant', () => {
    // The remedy differs: nobody can un-suspend you into an organization that
    // no longer exists, so these two must not read the same on screen.
    assert.equal(
      diagnoseAbsentWorkspace([
        { status: 'active', deleted_at: null, organizations: { deleted_at: '2026-01-01' } },
      ]),
      'organization-removed',
    );
  });

  it('prefers the erased tenant over the suspended row when both are present', () => {
    assert.equal(
      diagnoseAbsentWorkspace([
        { status: 'suspended', deleted_at: null, organizations: { deleted_at: null } },
        { status: 'active', deleted_at: null, organizations: { deleted_at: '2026-01-01' } },
      ]),
      'organization-removed',
    );
  });

  it('reads an embedded organization returned as a one-element array', () => {
    assert.equal(
      diagnoseAbsentWorkspace([
        { status: 'active', deleted_at: null, organizations: [{ deleted_at: '2026-01-01' }] },
      ]),
      'organization-removed',
    );
  });

  it('treats a non-array payload as no membership rather than throwing', () => {
    for (const payload of [null, undefined, {}, 'rows', 7]) {
      assert.equal(diagnoseAbsentWorkspace(payload), 'no-membership');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a refusal and a breakage are different facts', () => {
  it('reads insufficient_privilege as a refusal', () => {
    assert.equal(classifyLookupFailure({ code: '42501', message: 'nope' }), 'permission-denied');
  });

  it('reads a permission-denied message as a refusal even without the code', () => {
    assert.equal(
      classifyLookupFailure({ message: 'permission denied for table organization_memberships' }),
      'permission-denied',
    );
  });

  it('reads everything else as an unknown failure', () => {
    assert.equal(classifyLookupFailure({ code: '57014', message: 'canceling statement' }), 'lookup-failed');
    assert.equal(classifyLookupFailure(new Error('fetch failed')), 'lookup-failed');
    assert.equal(classifyLookupFailure(null), 'lookup-failed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('resolving a workspace for an authenticated user', () => {
  it('reads the tenancy table and no other, through the canonical select', async () => {
    const fake = fakeClient({ verified: { data: [liveRow()], error: null } });
    await resolveWorkspaceForUser(fake.client, 'user-1');
    assert.deepEqual(fake.tables, [MEMBERSHIP_TABLE]);
    assert.deepEqual(fake.selects, [MEMBERSHIP_SELECT]);
  });

  it('resolves the organization the membership points at', async () => {
    const fake = fakeClient({ verified: { data: [liveRow()], error: null } });
    const resolution = await resolveWorkspaceForUser(fake.client, 'user-1');
    assert.deepEqual(resolution.workspace, {
      organizationId: ORG_A,
      organizationName: 'Alpha Industries',
      organizationSlug: 'alpha',
    });
    assert.equal(resolution.reason, null);
  });

  it('does not run the diagnostic read when a workspace resolved', async () => {
    const fake = fakeClient({ verified: { data: [liveRow()], error: null } });
    await resolveWorkspaceForUser(fake.client, 'user-1');
    assert.ok(!fake.selects.includes(MEMBERSHIP_PRESENCE_SELECT));
  });

  it('filters the diagnostic read to the authenticated user and nobody else', async () => {
    const fake = fakeClient({
      verified: { data: [], error: null },
      diagnosis: { data: [], error: null },
    });
    await resolveWorkspaceForUser(fake.client, 'user-1');
    assert.deepEqual(fake.tables, [MEMBERSHIP_TABLE, MEMBERSHIP_TABLE]);
    assert.deepEqual(fake.selects, [MEMBERSHIP_SELECT, MEMBERSHIP_PRESENCE_SELECT]);
    // Every filter this call issued names the one user id it was given. There
    // is no parameter through which a caller could name a tenant, and this is
    // what says so about the query too.
    assert.ok(fake.filters.some(f => f.column === 'user_id' && f.value === 'user-1'));
    for (const filter of fake.filters) {
      assert.notEqual(filter.column, 'organization_id');
    }
  });

  it('reports a failed lookup as a failure, never as an empty organization', async () => {
    // THE DEFECT THIS EXISTS TO PREVENT. `listVerifiedMemberships` swallows its
    // own errors and returns `[]`; without the diagnostic read answering
    // separately, an unreachable database would render as "No organization" and
    // send an operator to ask for an invitation they already have.
    const fake = fakeClient({
      verified: { data: null, error: { message: 'connection reset' } },
      diagnosis: { data: null, error: { message: 'connection reset' } },
    });
    const resolution = await resolveWorkspaceForUser(fake.client, 'user-1');
    assert.equal(resolution.workspace, null);
    assert.equal(resolution.reason, 'lookup-failed');
  });

  it('reports a refused lookup as a refusal', async () => {
    const fake = fakeClient({
      verified: { data: null, error: { code: '42501' } },
      diagnosis: { data: null, error: { code: '42501' } },
    });
    assert.equal((await resolveWorkspaceForUser(fake.client, 'user-1')).reason, 'permission-denied');
  });

  it('reports a genuinely empty account as having no membership', async () => {
    const fake = fakeClient({
      verified: { data: [], error: null },
      diagnosis: { data: [], error: null },
    });
    assert.equal((await resolveWorkspaceForUser(fake.client, 'user-1')).reason, 'no-membership');
  });

  it('reports a suspended account as suspended', async () => {
    const fake = fakeClient({
      verified: { data: [], error: null },
      diagnosis: {
        data: [{ status: 'suspended', deleted_at: null, organizations: { deleted_at: null } }],
        error: null,
      },
    });
    assert.equal((await resolveWorkspaceForUser(fake.client, 'user-1')).reason, 'membership-inactive');
  });

  it('survives a client that throws instead of returning an error', async () => {
    const client: MembershipQueryClient = {
      from() { throw new Error('the client itself is broken'); },
    };
    const resolution = await resolveWorkspaceForUser(client, 'user-1');
    assert.equal(resolution.workspace, null);
    assert.equal(resolution.reason, 'lookup-failed');
  });

  it('never produces a workspace and a reason at the same time', async () => {
    const cases: { verified?: Answer; diagnosis?: Answer }[] = [
      { verified: { data: [liveRow()], error: null } },
      { verified: { data: [], error: null }, diagnosis: { data: [], error: null } },
      { verified: { data: [], error: null }, diagnosis: { data: null, error: { code: '42501' } } },
    ];
    for (const answers of cases) {
      const resolution = await resolveWorkspaceForUser(fakeClient(answers).client, 'u');
      assert.equal(
        resolution.workspace === null,
        resolution.reason !== null,
        'a workspace and a reason are mutually exclusive',
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the wire shape the login response carries', () => {
  it('carries the organization, the reason and the count', () => {
    assert.deepEqual(
      workspacePayload({ workspace: null, reason: 'no-membership', otherOrganizations: 0 }),
      { organization: null, organizationUnavailableReason: 'no-membership', otherOrganizations: 0 },
    );
  });

  it('carries no credential, token or user id', () => {
    const payload = workspacePayload({
      workspace: { organizationId: ORG_A, organizationName: 'Alpha', organizationSlug: 'alpha' },
      reason: null,
      otherOrganizations: 0,
    });
    const serialised = JSON.stringify(payload);
    for (const forbidden of ['token', 'password', 'secret', 'user_id', 'email']) {
      assert.ok(!serialised.toLowerCase().includes(forbidden), `payload must not carry ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the browser narrows the workspace it is handed', () => {
  it('accepts a complete workspace', () => {
    assert.deepEqual(
      normaliseWorkspace({ organizationId: ORG_A, organizationName: 'Alpha', organizationSlug: 'alpha' }),
      { organizationId: ORG_A, organizationName: 'Alpha', organizationSlug: 'alpha' },
    );
  });

  it('refuses a workspace with no id, so a label can never stand in for a tenant', () => {
    assert.equal(normaliseWorkspace({ organizationName: 'Alpha', organizationSlug: 'alpha' }), null);
  });

  it('refuses a workspace with a blank name rather than rendering an empty header', () => {
    assert.equal(normaliseWorkspace({ organizationId: ORG_A, organizationName: '   ' }), null);
  });

  it('accepts a workspace with no slug — a slug identifies, it does not display', () => {
    assert.equal(
      normaliseWorkspace({ organizationId: ORG_A, organizationName: 'Alpha' })?.organizationSlug,
      '',
    );
  });

  it('refuses anything that is not an object', () => {
    for (const value of [null, undefined, 'alpha', 7, []]) {
      assert.equal(normaliseWorkspace(value), null);
    }
  });

  it('reads an absent reason as "nobody told us", not as "you belong to nobody"', () => {
    assert.equal(normaliseWorkspaceReason(undefined), 'not-reported');
    assert.equal(normaliseWorkspaceReason(null), 'not-reported');
  });

  it('reads a reason this build does not know as a failure, not as an empty state', () => {
    assert.equal(normaliseWorkspaceReason('some-future-reason'), 'lookup-failed');
  });

  it('keeps every reason the server can send', () => {
    for (const reason of [
      'no-membership', 'membership-inactive', 'organization-removed',
      'organization-unnamed', 'permission-denied', 'lookup-failed',
    ]) {
      assert.equal(normaliseWorkspaceReason(reason), reason);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the workspace survives a storage round trip', () => {
  it('restores a resolved workspace', () => {
    const session: TeamSession = {
      accessToken: 'tok',
      user: null,
      workspace: { organizationId: ORG_A, organizationName: 'Alpha', organizationSlug: 'alpha' },
      workspaceReason: null,
    };
    assert.deepEqual(parseTeamSession(serializeTeamSession(session)), session);
  });

  it('restores the reason when there was no workspace', () => {
    const session: TeamSession = {
      accessToken: 'tok', user: null, workspace: null, workspaceReason: 'membership-inactive',
    };
    assert.deepEqual(parseTeamSession(serializeTeamSession(session)), session);
  });

  it('restores a bare token from an older bundle as "not reported"', () => {
    // Real authentication, kept. No claim about the organization, because that
    // record is evidence about the bundle that wrote it and nothing else.
    const restored = parseTeamSession('raw-token-from-an-older-build');
    assert.equal(restored?.accessToken, 'raw-token-from-an-older-build');
    assert.equal(restored?.workspace, null);
    assert.equal(restored?.workspaceReason, 'not-reported');
  });

  it('restores a record written before the workspace existed as "not reported"', () => {
    const restored = parseTeamSession(JSON.stringify({ accessToken: 'tok', user: null }));
    assert.equal(restored?.workspaceReason, 'not-reported');
  });

  it('drops a stored workspace that no longer narrows, and says why', () => {
    const restored = parseTeamSession(JSON.stringify({
      accessToken: 'tok',
      user: null,
      workspace: { organizationName: 'Alpha' },
      workspaceReason: null,
    }));
    assert.equal(restored?.workspace, null);
    assert.equal(restored?.workspaceReason, 'not-reported');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('what the shell header actually says', () => {
  it('says it is loading while the session is still being restored', () => {
    const view = workspaceDisplay({ isRestoring: true, organizationName: null, reason: null });
    assert.equal(view.tone, 'loading');
    assert.match(view.label, /loading/i);
  });

  it('does not claim the account has no organization while it is still loading', () => {
    const view = workspaceDisplay({ isRestoring: true, organizationName: null, reason: 'no-membership' });
    assert.equal(view.tone, 'loading');
  });

  it('names the organization when one resolved', () => {
    const view = workspaceDisplay({ isRestoring: false, organizationName: 'Alpha Industries' });
    assert.equal(view.label, 'Alpha Industries');
    assert.equal(view.tone, 'resolved');
  });

  it('never says "Internal Dashboard" in any state', () => {
    // The exact string CP-3 removed: a description of the product, printed
    // where the organization belongs, identical across every tenant.
    const states = [
      { isRestoring: true },
      { isRestoring: false, organizationName: 'Alpha' },
      ...(['no-membership', 'membership-inactive', 'organization-removed',
           'organization-unnamed', 'permission-denied', 'lookup-failed',
           'not-reported'] as const)
        .map(reason => ({ isRestoring: false, reason })),
    ];
    for (const state of states) {
      const view = workspaceDisplay(state);
      assert.ok(!/internal dashboard/i.test(view.label), `"${view.label}" must not be the old placeholder`);
      assert.ok(!/internal dashboard/i.test(view.detail));
    }
  });

  it('gives every reason its own distinct sentence', () => {
    const reasons = ['no-membership', 'membership-inactive', 'organization-removed',
      'organization-unnamed', 'permission-denied', 'lookup-failed', 'not-reported'] as const;
    const labels = reasons.map(reason => workspaceDisplay({ isRestoring: false, reason }).label);
    const details = reasons.map(reason => workspaceDisplay({ isRestoring: false, reason }).detail);
    assert.equal(new Set(labels).size, reasons.length, 'two reasons must never read the same');
    assert.equal(new Set(details).size, reasons.length);
    for (const label of labels) assert.notEqual(label.trim(), '');
  });

  it('marks a failure as a failure and an empty state as empty', () => {
    // The CP-1 rule, restated for the header: a failure is never dressed as a
    // plausible empty state.
    const tone = (reason: Parameters<typeof workspaceDisplay>[0]['reason']) =>
      workspaceDisplay({ isRestoring: false, reason }).tone;
    assert.equal(tone('lookup-failed'), 'error');
    assert.equal(tone('permission-denied'), 'error');
    assert.equal(tone('organization-removed'), 'error');
    assert.equal(tone('organization-unnamed'), 'error');
    assert.equal(tone('no-membership'), 'empty');
    assert.equal(tone('membership-inactive'), 'empty');
    assert.equal(tone('not-reported'), 'empty');
  });

  it('falls back to "not reported" when a session carries neither name nor reason', () => {
    assert.equal(workspaceDisplay({ isRestoring: false }).label, 'Workspace not reported');
  });
});
