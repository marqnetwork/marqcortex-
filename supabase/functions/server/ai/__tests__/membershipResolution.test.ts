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
 *   1. A migration bootstraps server-provisioned MARQ team users into the
 *      seeded organization. Its properties are proved against a real Postgres
 *      by `scripts/membership-bootstrap-scenarios.mjs`, and its text is checked
 *      by `tests/database/static_membership_bootstrap_migration.test.ts`.
 *
 *   2. The edge membership query admits only live, active memberships in a live
 *      organization, and carries `roles.key` through to
 *      `SubjectMembership.roles`. That transformation is
 *      `ai/adapters/membershipDirectory.ts`, and it is driven behaviourally by
 *      `membershipDirectory.test.ts`.
 *
 * WHAT CHANGED IN THIS FILE, AND WHY
 *
 * It used to assert on the TEXT of `index.tsx`: that a `.eq()` appeared, that a
 * `roles(key)` embed appeared, and — the claim the review caught — that
 * `organization_memberships` had "exactly one reader", counted as occurrences of
 * `.from('organization_memberships')` inside that one file.
 *
 * That claim was false twice over. `repositories/tenancyRepository.ts` reads the
 * table in three places, and the RLS helpers in the tenancy migration read it in
 * SQL. Counting matches in a single file cannot see either, so the test passed
 * by looking in one place and asserted something about all of them.
 *
 * The invariant that is actually true, and actually load-bearing, is narrower:
 * exactly ONE module is on the AI runtime's tenant-resolution path, and the edge
 * entry point delegates to it rather than carrying a query of its own. That is
 * what is asserted below, over the whole server tree rather than one file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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

/** Every server source, so a claim about "one place" can look everywhere. */
function serverSources(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...serverSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push({ path: full, text: readFileSync(full, 'utf8') });
  }
  return out;
}

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Code only. A file that documents the table names it, and prose is not a query. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const sources = serverSources(SERVER_ROOT).filter(
  (file) => !file.path.includes('__tests__') && !file.path.endsWith('.test.ts'),
);

/** The `listMemberships` block of the edge entry point, isolated. */
function membershipBlock(): string {
  const start = edgeSource.indexOf('listMemberships: async');
  assert.notEqual(start, -1, 'index.tsx must define listMemberships');
  const end = edgeSource.indexOf('kvWrite:', start);
  assert.ok(end > start, 'listMemberships must be followed by the rest of the bootstrap deps');
  return edgeSource.slice(start, end);
}

const ORG = 'b1f0c4d2-0000-4000-8000-000000000001';
const OTHER_ORG = 'b1f0c4d2-0000-4000-8000-000000000002';

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

describe('one runtime path to a verified membership', () => {
  it('has server sources to scan', () => {
    // A scan over zero files passes vacuously — which is how the previous
    // version of this suite managed to assert something false.
    assert.ok(sources.length > 20, `expected server sources, found ${sources.length}`);
  });

  it('issues the membership query in exactly one module', () => {
    // The real invariant. Two modules issuing this query would be two answers
    // to "which tenant is this person in", and only one of them would carry the
    // liveness, status and role filters.
    //
    // The scan is for the TABLE NAME in code, not for `.from('…')`: the
    // canonical module names the table once, in a constant its tests import, so
    // a scan for the call shape would have missed the very module it exists to
    // find. Comments are stripped first — this suite explains at length which
    // table it is about, and the explanation must not be the match.
    const readers = sources
      .filter((file) => /['"`]organization_memberships['"`]/.test(stripComments(file.text)))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(
      readers.filter((path) => !path.includes('tenancyRepository')),
      [join('ai', 'adapters', 'membershipDirectory.ts')],
      `membership readers on the runtime path: ${readers.join(', ')}`,
    );
  });

  it('names the unwired repository as the only other reader, deliberately', () => {
    // `tenancyRepository.ts` is scaffolding for the repository cutover and is
    // not reachable from any route. It is excluded above by name rather than
    // silently, so wiring it up is a decision somebody has to make here first.
    const repository = sources.find((file) => file.path.endsWith('tenancyRepository.ts'));
    assert.ok(repository, 'tenancyRepository.ts must exist');
    assert.match(repository.text, /NOT THE RUNTIME TENANT RESOLVER/);
    // And it carries the same organization-liveness restriction, so wiring it
    // up cannot reintroduce a membership in an erased tenant.
    assert.match(repository.text, /organizations!inner/);
  });

  it('leaves the edge entry point with no membership filtering of its own', () => {
    const block = membershipBlock();
    assert.match(block, /listVerifiedMemberships\(/);
    assert.doesNotMatch(block, /\.from\(/);
    assert.doesNotMatch(block, /\.select\(/);
    assert.doesNotMatch(block, /roles:\s*\[\]/);
  });

  it('derives the membership from the user id alone, never from the request', () => {
    // Organization authority must not be assertable by the caller. The lookup
    // takes a verified user id; it reads no header, no body and no query
    // parameter.
    const block = membershipBlock();
    assert.doesNotMatch(block, /c\.req/);
    assert.doesNotMatch(block, /headers?\.get/i);
    assert.match(block, /listVerifiedMemberships\(\s*\n?\s*supabaseAdmin[\s\S]*?,\s*\n?\s*userId,?\s*\n?\s*\)/);
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

describe('more than one membership is a question, not a guess', () => {
  // L5. `resolveOrganization` used to take `memberships[0]` — the first row the
  // database happened to return, from a query with no ORDER BY. With two
  // memberships that is a tenant chosen by the query planner.

  it('resolves a sole membership without asking', async () => {
    const subject = await subjectFor([{ organizationId: ORG, slug: 'marq', roles: ['org_admin'] }]);
    const organization = resolveOrganization(subject, undefined, TENANCY);
    assert.equal(organization.organizationId, ORG);
    assert.equal(organization.membershipVerified, true);
  });

  it('refuses to pick between two memberships', async () => {
    const subject = await subjectFor([
      { organizationId: ORG, roles: ['org_admin'] },
      { organizationId: OTHER_ORG, roles: ['team_viewer'] },
    ]);
    assert.throws(
      () => resolveOrganization(subject, undefined, TENANCY),
      (error: AIError) => error.code === 'ORGANIZATION_REQUIRED',
    );
  });

  it('refuses identically whichever order the rows arrive in', async () => {
    // The property the old code lacked: the same subject, the same request, the
    // same answer. Not "the same organization every time" — the same REFUSAL,
    // with the same diagnostic, so an operator sees one behaviour and not a
    // coin flip between two tenants.
    const forwards = await subjectFor([
      { organizationId: ORG, roles: ['org_admin'] },
      { organizationId: OTHER_ORG, roles: ['team_viewer'] },
    ]);
    const backwards = await subjectFor([
      { organizationId: OTHER_ORG, roles: ['team_viewer'] },
      { organizationId: ORG, roles: ['org_admin'] },
    ]);

    const capture = (subject: AuthenticatedSubject): string => {
      try {
        resolveOrganization(subject, undefined, TENANCY);
        return 'resolved';
      } catch (error) {
        const failure = error as AIError;
        return `${failure.code}|${failure.diagnostics ?? ''}`;
      }
    };

    assert.equal(capture(forwards), capture(backwards));
    assert.match(capture(forwards), /^ORGANIZATION_REQUIRED\|/);
  });

  it('resolves either membership when the caller names it', async () => {
    // The refusal is not a wall. Naming an organization the subject holds is
    // exactly how a multi-tenant caller proceeds, and it is honoured for both.
    const subject = await subjectFor([
      { organizationId: ORG, slug: 'marq', roles: ['org_admin'] },
      { organizationId: OTHER_ORG, slug: 'acme', roles: ['team_viewer'] },
    ]);
    assert.equal(resolveOrganization(subject, ORG, TENANCY).organizationId, ORG);
    assert.equal(resolveOrganization(subject, OTHER_ORG, TENANCY).organizationId, OTHER_ORG);
  });

  it('does not fall back to the default when a subject holds several', async () => {
    // The refusal must not be downgraded by the single-tenant switch either: a
    // subject with two verified memberships is not a subject with none, and
    // bucketing them into the configured default would be the default tenant
    // arriving by the back door.
    const subject = await subjectFor([
      { organizationId: ORG, roles: ['org_admin'] },
      { organizationId: OTHER_ORG, roles: ['team_viewer'] },
    ]);
    assert.throws(
      () => resolveOrganization(subject, undefined, { ...TENANCY, allowDefaultOrganization: true }),
      (error: AIError) => error.code === 'ORGANIZATION_REQUIRED',
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
