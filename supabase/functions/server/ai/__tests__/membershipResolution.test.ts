/**
 * AI-01 Batch 4A — tenant membership resolution.
 *
 * The production defect this suite exists for: `public.organization_memberships`
 * held zero active rows, so every authenticated operator resolved NO verified
 * organization and the guard failed every AI request closed at
 * `resolveOrganization`. The guard was right. The table was empty, and the query
 * that read it discarded the only thing that would have made a row useful — it
 * returned `roles: []` unconditionally, so an `org_admin` and a `team_viewer`
 * were indistinguishable to the policy engine.
 *
 * The fix has two halves and this suite pins both:
 *
 *   1. A migration bootstraps existing MARQ team users into the seeded
 *      organization (covered structurally in
 *      `tests/database/static_membership_bootstrap_migration.test.ts`).
 *
 *   2. The edge membership query admits only live, active memberships and
 *      carries `roles.key` through to `SubjectMembership.roles`.
 *
 * Half 2 is asserted two ways, because neither alone is sufficient:
 *
 *   - STRUCTURALLY, against `index.tsx`, because the query lives in the Supabase
 *     edge entry point and cannot be imported under Node — the module evaluates
 *     Deno-only imports at load. A source assertion is a weak proof of behaviour
 *     and a strong one about which filters are present, which is the claim here.
 *
 *   - BEHAVIOURALLY, against the real `createSupabaseAuthenticator`,
 *     `resolveActor` and `resolveOrganization`, over the row shapes that query
 *     can produce. This is what proves a role key actually reaches an
 *     authorization decision, and that an empty result still fails closed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createSupabaseAuthenticator } from '../adapters/supabaseAuthenticator.ts';
import { resolveActor, type AuthenticatedSubject, type SubjectMembership } from '../security/actor.ts';
import { resolveOrganization } from '../security/tenancy.ts';
import { createTestClock } from '../runtime/clock.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { AIError } from '../contracts/errors.ts';

const EDGE_ENTRY = fileURLToPath(new URL('../../index.tsx', import.meta.url));
const edgeSource = readFileSync(EDGE_ENTRY, 'utf8');

/** The `listMemberships` block of the edge entry point, isolated. */
function membershipBlock(): string {
  const start = edgeSource.indexOf('listMemberships: async');
  assert.notEqual(start, -1, 'index.tsx must define listMemberships');
  const end = edgeSource.indexOf('kvWrite:', start);
  assert.ok(end > start, 'listMemberships must be followed by the rest of the bootstrap deps');
  return edgeSource.slice(start, end);
}

const ORG = 'b1f0c4d2-0000-4000-8000-000000000001';

const TENANCY = {
  defaultOrganizationId: 'marq-cortex',
  allowList: [] as string[],
  allowDefaultOrganization: false,
};

function authenticatorFor(memberships: readonly SubjectMembership[]) {
  return createSupabaseAuthenticator({
    getUser: () => Promise.resolve({ id: 'user-1', email: 'operator@marq.test', roles: ['admin'] }),
    listMemberships: () => Promise.resolve(memberships),
    clock: createTestClock(),
  });
}

async function subjectFor(memberships: readonly SubjectMembership[]): Promise<AuthenticatedSubject> {
  const subject = await authenticatorFor(memberships).authenticate('Bearer token');
  assert.ok(subject, 'a valid credential must resolve a subject');
  return subject;
}

describe('edge membership query contract', () => {
  const block = membershipBlock();

  it('reads memberships in exactly one place', () => {
    // "Do not create a second membership resolver" is only meaningful if it is
    // checked. Two readers of this table would be two answers to the same
    // question, and only one of them would carry the filters below.
    const readers = edgeSource.match(/\.from\(['"]organization_memberships['"]\)/g) ?? [];
    assert.equal(readers.length, 1, 'organization_memberships must have a single reader');
  });

  it('admits only undeleted memberships', () => {
    assert.match(block, /\.is\(\s*['"]deleted_at['"]\s*,\s*null\s*\)/);
  });

  it('admits only active memberships', () => {
    // `invited` and `suspended` exist precisely so a row can be present without
    // granting anything. Admitting them makes suspension decorative.
    assert.match(block, /\.eq\(\s*['"]status['"]\s*,\s*['"]active['"]\s*\)/);
  });

  it('joins the role catalog', () => {
    assert.match(block, /roles\(key\)/);
  });

  it('no longer hardcodes an empty role set', () => {
    assert.doesNotMatch(block, /roles:\s*\[\]\s*as\s*string\[\]/);
    assert.doesNotMatch(block, /roles:\s*\[\]\s*,/);
  });

  it('derives the membership from the user id alone, never from the request', () => {
    // Organization authority must not be assertable by the caller. The lookup
    // takes a verified user id and reads the database; it reads no header, no
    // body and no query parameter.
    assert.doesNotMatch(block, /c\.req/);
    assert.doesNotMatch(block, /headers?\.get/i);
    assert.match(block, /\.eq\(\s*['"]user_id['"]\s*,\s*userId\s*\)/);
  });
});

describe('membership role propagation', () => {
  it('carries roles.key into SubjectMembership.roles', async () => {
    const subject = await subjectFor([{ organizationId: ORG, slug: 'marq', roles: ['org_admin'] }]);
    assert.deepEqual(subject.memberships[0].roles, ['org_admin']);
  });

  it('reaches the authorization decision for the resolved organization', async () => {
    const subject = await subjectFor([{ organizationId: ORG, slug: 'marq', roles: ['org_admin'] }]);
    const actor = resolveActor(subject, ORG, { allowAnonymous: false });
    assert.ok(actor.roles.includes('org_admin'), `roles resolved: ${actor.roles.join(', ')}`);
  });

  it('keeps two role keys distinguishable', async () => {
    // The defect restated: with `roles: []` these two subjects were identical.
    const admin = await subjectFor([{ organizationId: ORG, roles: ['org_admin'] }]);
    const viewer = await subjectFor([{ organizationId: ORG, roles: ['team_viewer'] }]);
    assert.notDeepEqual(
      resolveActor(admin, ORG, { allowAnonymous: false }).roles,
      resolveActor(viewer, ORG, { allowAnonymous: false }).roles,
    );
  });

  it('does not attach a role from another organization', async () => {
    const subject = await subjectFor([
      { organizationId: ORG, roles: ['team_viewer'] },
      { organizationId: 'other-org', roles: ['org_admin'] },
    ]);
    const actor = resolveActor(subject, ORG, { allowAnonymous: false });
    assert.equal(actor.roles.includes('org_admin'), false);
  });

  it('resolves the membership as verified', async () => {
    const subject = await subjectFor([{ organizationId: ORG, slug: 'marq', roles: ['org_admin'] }]);
    const organization = resolveOrganization(subject, undefined, TENANCY);
    assert.equal(organization.organizationId, ORG);
    assert.equal(organization.membershipVerified, true);
    assert.equal(organization.slug, 'marq');
  });
});

describe('membership admission remains fail-closed', () => {
  it('a subject the query returns nothing for resolves no organization', async () => {
    // This is the shape a suspended-only, invited-only or soft-deleted-only
    // user presents as: the query excludes those rows, so the subject arrives
    // with no memberships and must not be admitted anywhere.
    const subject = await subjectFor([]);
    assert.deepEqual(subject.memberships, []);
    assert.throws(
      () => resolveOrganization(subject, undefined, TENANCY),
      (error: AIError) => error.code === 'ORGANIZATION_REQUIRED',
    );
  });

  it('a failed membership lookup does not widen access', async () => {
    const authenticator = createSupabaseAuthenticator({
      getUser: () => Promise.resolve({ id: 'user-1', roles: ['admin'] }),
      listMemberships: () => Promise.reject(new Error('database unavailable')),
      clock: createTestClock(),
    });
    const subject = await authenticator.authenticate('Bearer token');
    assert.ok(subject);
    assert.deepEqual(subject.memberships, []);
    assert.throws(
      () => resolveOrganization(subject, undefined, TENANCY),
      (error: AIError) => error.code === 'ORGANIZATION_REQUIRED',
    );
  });

  it('refuses an organization hint the subject does not hold', async () => {
    const subject = await subjectFor([{ organizationId: ORG, roles: ['team_member'] }]);
    assert.throws(
      () => resolveOrganization(subject, 'someone-elses-org', TENANCY),
      (error: AIError) => error.code === 'ORGANIZATION_NOT_RESOLVED',
    );
  });

  it('refuses a malformed organization hint', async () => {
    const subject = await subjectFor([{ organizationId: ORG, roles: ['team_member'] }]);
    assert.throws(
      () => resolveOrganization(subject, '../../etc/passwd', TENANCY),
      (error: AIError) => error.code === 'VALIDATION_FAILED',
    );
  });
});

describe('the default organization stays disabled', () => {
  it('is off unless a deployment explicitly opts in', () => {
    // Batch 4A fixes the membership table. It does not, and must not, reach for
    // the single-tenant fallback to do it.
    assert.equal(loadControlPlaneConfig(recordEnv({})).allowDefaultOrganization, false);
  });

  it('stays off for every value that is not an explicit opt-in', () => {
    // An unrecognised value falls back to the safe default rather than being
    // guessed at. A typo in a deployment variable must not enable a fallback
    // tenant.
    for (const value of ['', 'false', '0', 'off', 'no', 'maybe', 'yes-please']) {
      assert.equal(
        loadControlPlaneConfig(recordEnv({ AI_ALLOW_DEFAULT_ORGANIZATION: value })).allowDefaultOrganization,
        false,
        `AI_ALLOW_DEFAULT_ORGANIZATION=${JSON.stringify(value)}`,
      );
    }
  });

  it('is still marked unverified when a deployment does opt in', async () => {
    const subject = await subjectFor([]);
    const organization = resolveOrganization(subject, undefined, {
      ...TENANCY,
      allowDefaultOrganization: true,
    });
    assert.equal(organization.membershipVerified, false);
  });
});
