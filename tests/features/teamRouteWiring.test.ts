/**
 * WIRING, NOT BEHAVIOUR. Read this before trusting anything below.
 *
 * The decisions these routes make are proved behaviourally elsewhere:
 * `membershipLifecycle.test.ts` drives an auth record and a set of membership
 * rows through the real authenticator, the real `resolveOrganization` and the
 * real `resolveActor`, and `tests/database/harness/70_assert_lifecycle.sql`
 * drives the real SQL functions against a real PostgreSQL.
 *
 * What NEITHER of those can prove is that `supabase/functions/server/index.tsx`
 * actually calls them. That file imports Deno-only modules at load time, so no
 * Node test can execute a route handler in it, and an entry point that resolved
 * authority correctly in a helper and then ignored the helper at the call site
 * would pass every behavioural test in this repository.
 *
 * So this file reads the entry point as source and pins the WIRING: which guard
 * each privileged route goes through, and which field it must never read. A
 * source scan proves presence and absence, and that is exactly what is being
 * claimed here — nothing about what the code computes.
 *
 * It is deliberately narrow. Every assertion names a specific defect:
 *
 *   HIGH-2  `verifyTeamToken` answered "the token is valid" and every console
 *           route treated it as "the caller is staff".
 *   HIGH-1  `PATCH /team/members/:id` wrote `app_metadata` and no membership.
 *   MED-1   `POST /team/invite` created an account and no membership.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'supabase', 'functions', 'server', 'index.tsx'), 'utf8');

/** The file with line comments stripped — a guard is code, not prose. */
const code = source.replace(/^\s*\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The body of one route handler, from its `app.<verb>(` to the matching tail. */
function routeBody(verb: string, path: string): string {
  const marker = `app.${verb}("/make-server-324f4fbe${path}"`;
  const start = code.indexOf(marker);
  assert.ok(start > 0, `route not found: ${verb.toUpperCase()} ${path}`);
  const next = code.slice(start + marker.length).search(/\napp\.(get|post|patch|delete|put)\(/);
  return code.slice(start, next === -1 ? undefined : start + marker.length + next);
}

describe('the token gate requires a provisioned team account (HIGH-2)', () => {
  it('resolveTeamCaller checks the server-written stamp', () => {
    const gate = code.slice(
      code.indexOf('async function resolveTeamCaller'),
      code.indexOf('async function verifyTeamToken'),
    );
    assert.ok(gate.length > 0, 'resolveTeamCaller must exist');
    assert.match(gate, /if\s*\(!isProvisionedTeamAccount\(user\)\)/);
    assert.match(gate, /return null;/);
  });

  it('verifyTeamToken is that gate, so every route inherits it', () => {
    const verify = code.slice(
      code.indexOf('async function verifyTeamToken'),
      code.indexOf('async function readAuthRecord'),
    );
    assert.match(verify, /resolveTeamCaller\(authHeader\)/);
    // No second path to a user id: a route cannot opt out by calling something
    // else that also returns one.
    assert.ok(
      !/supabaseAdmin\.auth\.getUser\(/.test(verify),
      'verifyTeamToken must not re-verify the token itself',
    );
  });

  it('the team console login refuses an account that is not staff', () => {
    const login = routeBody('post', '/auth/team/login');
    assert.match(login, /resolveTeamAuthority\(data\.user\)/);
    assert.match(login, /if\s*\(!authority\.provisioned\)/);
    assert.match(login, /401/);
  });

  it('no route resolves a team role from user metadata', () => {
    // The whole file, not only the team routes: the fallback used to be inside
    // a shared helper, which is how it reached everything at once.
    assert.ok(
      !/user_metadata[^\n]*\bteamRole\b[^\n]*(===|==|\?\?|\|\|)/.test(code),
      'a comparison or fallback reads user_metadata.teamRole',
    );
    assert.ok(
      !/normalizeTeamRole\([^)]*user_metadata/.test(code),
      'a role is normalised out of user_metadata',
    );
    assert.ok(
      !/user_metadata\?\.\s*role\s*===\s*'team'/.test(code),
      "a filter or guard still reads user_metadata.role === 'team'",
    );
  });
});

describe('every privileged team route runs the same three checks', () => {
  const privileged: [string, string][] = [
    ['post', '/team/invite'],
    ['patch', '/team/members/:id'],
    ['delete', '/team/members/:id'],
  ];

  for (const [verb, path] of privileged) {
    it(`${verb.toUpperCase()} ${path} gates on the trusted authority`, () => {
      const body = routeBody(verb, path);
      // 1. the caller is a verified team caller, and
      // 2. their authority — not a role read from anywhere else — is what the
      //    admin gate is given.
      assert.match(body, /resolveTeamCaller\(c\.req\.header\('Authorization'\)\)/);
      assert.match(body, /authorizeTeamAdmin\(callerId,\s*caller\?\.authority\s*\?\?\s*null\)/);
      assert.match(body, /if\s*\(!adminCheck\.ok\)/);
    });
  }

  for (const [verb, path] of [privileged[1], privileged[2]]) {
    it(`${verb.toUpperCase()} ${path} refuses a target that is not a team account`, () => {
      const body = routeBody(verb, path);
      assert.match(body, /requireTeamAccountTarget\(await readAuthRecord\(memberId\)\)/);
      assert.match(body, /if\s*\(!target\.ok\)/);
    });
  }
});

describe('the membership lifecycle is on every write path', () => {
  it('MED-1: the invite finishes provisioning, and fails the request if it cannot', () => {
    const body = routeBody('post', '/team/invite');
    assert.match(body, /completeTeamProvisioning\(teamLifecycle,/);
    assert.match(body, /if\s*\(!provisioning\.ok\)/);
    // The membership call must come AFTER the account exists and BEFORE the
    // route answers success.
    const created = body.indexOf('auth.admin.createUser');
    const provisioned = body.indexOf('completeTeamProvisioning');
    const answered = body.lastIndexOf('return c.json({ success: true');
    assert.ok(created > 0 && provisioned > created, 'provisioning must follow account creation');
    assert.ok(answered > provisioned, 'the route must not answer success before provisioning');
  });

  it('HIGH-1: the role change goes through the lifecycle, not a metadata write', () => {
    const body = routeBody('patch', '/team/members/:id');
    assert.match(body, /applyTeamRoleChange\(teamLifecycle,/);
    assert.match(body, /if\s*\(!change\.ok\)/);
    // No direct `app_metadata` write in the route: the ordering, the
    // compensations and the failures belong to the lifecycle, and a second
    // writer here is how the two systems drift apart again.
    assert.ok(
      !/app_metadata:\s*teamAppMetadata/.test(body),
      'the route writes app_metadata itself, bypassing the lifecycle',
    );
  });

  it('the removal goes through the lifecycle, which owns the ordering', () => {
    const body = routeBody('delete', '/team/members/:id');
    assert.match(body, /revokeTeamAccount\(teamLifecycle,\s*\{\s*userId:\s*memberId\s*\}\)/);
    assert.ok(
      !/auth\.admin\.deleteUser/.test(body),
      'the route deletes the account itself, outside the lifecycle ordering',
    );
  });

  it('the lifecycle writes both bags and publishes the invalidation', () => {
    const deps = code.slice(
      code.indexOf('const teamLifecycle'),
      code.indexOf('app.get("/make-server-324f4fbe/team/members"'),
    );
    assert.match(deps, /membership:\s*marqMembershipPort/);
    assert.match(deps, /app_metadata:\s*teamAppMetadata\(role\)/);
    assert.match(deps, /invalidate:.*membershipInvalidation\.invalidate\(userId\)/);
  });

  it('the control plane is given the same invalidation channel', () => {
    assert.match(code, /initializeControlPlane\(\{\s*\n?\s*membershipInvalidation,/);
  });

  it('the startup seed gives its admin a membership too', () => {
    const seed = code.slice(
      code.indexOf('async function seedAdminUser'),
      code.indexOf('async function testDatabaseConnection'),
    );
    assert.match(seed, /marqMembershipPort\.sync\(data\.user\.id,\s*'admin'\)/);
  });

  it('the membership port takes no organization from anywhere', () => {
    // The RPC port's arguments are fixed in `membershipLifecycle.ts`; what is
    // pinned here is that the entry point builds it from the admin client and
    // does not hand it a tenant.
    assert.match(code, /createRpcMembershipPort\(supabaseAdmin as unknown as RpcClient\)/);
    assert.ok(
      !/marq_sync_team_membership[^)]*p_organization/.test(code),
      'an organization is being passed to the membership write',
    );
  });
});

describe('the console list cannot be joined by writing your own metadata', () => {
  it('lists provisioned accounts only', () => {
    const body = routeBody('get', '/team/members');
    assert.match(body, /users\s*\|\|\s*\[\]\)\.filter\(u\s*=>\s*isProvisionedTeamAccount\(u\)\)/);
    assert.ok(
      !/user_metadata\?\.role\s*===\s*'team'/.test(body),
      'the roster is still filtered on a self-writable field',
    );
  });

  it('reports the role from the trusted field', () => {
    const body = routeBody('get', '/team/members');
    assert.match(body, /resolveTeamAuthority\(u\)/);
    assert.match(body, /teamRole:\s*authority\.role/);
  });
});

// ---------------------------------------------------------------------------
// M-B — the trusted roles the AI plane is handed
//
// The AI administration surface resolves the platform operator tier from
// `subject.globalRoles`, and that array is built in exactly one place: the
// `getUser` port this entry point passes to the control plane. If it ever put
// a team role where a platform role belongs — or resolved either from
// `user_metadata` — the separation M-B asks for would be undone at the wiring,
// with every unit test still green.
// ---------------------------------------------------------------------------

describe('the AI subject carries platform authority separately from team role (M-B)', () => {
  const getUserPort = (() => {
    const start = code.indexOf('getUser: async (accessToken: string)');
    assert.ok(start > 0, 'the getUser port must exist');
    const end = code.indexOf('listMemberships:', start);
    assert.ok(end > start, 'the getUser port must be followed by listMemberships');
    return code.slice(start, end);
  })();

  it('builds the trusted global roles through the one resolver', () => {
    assert.match(getUserPort, /roles:\s*resolveTrustedGlobalRoles\(data\.user\)/);
  });

  it('does not hand the AI plane a hand-assembled role array', () => {
    // `roles: teamRole ? [teamRole] : []` was the previous shape. It carried
    // the team role and nothing else, so `platform_role` never reached the AI
    // administration surface — which is why `owner` had been pressed into
    // service as the platform role instead.
    assert.equal(/roles:\s*teamRole\s*\?/.test(getUserPort), false);
    assert.equal(/roles:\s*\[/.test(getUserPort), false);
  });

  it('reads no user metadata when building the subject', () => {
    assert.equal(/user_metadata/.test(getUserPort), false);
  });

  it('no route writes platform_role', () => {
    // Console provisioning sends `teamAppMetadata(role)` and nothing else. A
    // literal `platform_role` written anywhere in this entry point would be a
    // console route minting platform operators.
    assert.equal(/platform_role/.test(code), false);
  });

  it('every app_metadata write goes through the one shape', () => {
    const writes = [...code.matchAll(/app_metadata:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    assert.ok(writes.length > 0, 'the entry point must write app_metadata somewhere');
    for (const write of writes) {
      assert.match(
        write,
        /^teamAppMetadata\(/,
        `app_metadata is written as \`${write}\`; every write must go through teamAppMetadata`,
      );
    }
  });
});

