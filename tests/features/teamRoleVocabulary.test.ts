/**
 * UI SPRINT 7 — the team role vocabulary, and the boundary that used to eat it.
 *
 * THE DEFECT
 *   `POST /auth/team/login` has always returned `user.teamRole`, resolved by
 *   `resolveTeamAuthority` from `app_metadata.team_role`. The console threw it
 *   away twice: `api.ts` declared the response user as `{id,email,name}`, and
 *   `session.ts`'s `normaliseTeamUser` rebuilt the object from exactly those
 *   three fields. The role therefore reached no component, and the console had
 *   no way to offer a role-appropriate experience.
 *
 *   Separately, `TeamMemberRecord.teamRole` declared THREE roles where the
 *   server issues SIX. An `analyst`, `consultant` or `owner` fell through
 *   `ROLE_CONFIG[role] || ROLE_CONFIG.viewer` and was displayed to their own
 *   team as a read-only "Viewer".
 *
 * WHAT IS GUARDED HERE
 *   1. The frontend vocabulary is the server's, verbatim and in the same order
 *      — the order IS the privilege rank, so a reordering is a privilege change.
 *   2. Normalisation fails closed to `viewer` for every unusable input.
 *   3. `assignableRoles` never yields a role at or above the holder's own rank,
 *      and yields nothing at all to a role that may not administer the team.
 *   4. `normaliseTeamUser` carries the role through, and still treats identity
 *      as all-or-nothing.
 *
 * WHAT IS NOT CLAIMED
 *   None of this is authorization. The server enforces every rule against
 *   `app_metadata`, which a signed-in caller cannot write. These assertions
 *   prove the console does not OFFER what the server would refuse; they prove
 *   nothing about what the server allows.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  TEAM_ROLES,
  DEFAULT_TEAM_ROLE,
  isTeamRole,
  teamRoleRank,
  normalizeTeamRole,
  canAdministerTeam,
  assignableRoles,
  TEAM_ROLE_LABELS,
  TEAM_ROLE_DESCRIPTIONS,
  type TeamRole,
} from '../../src/app/lib/teamRole.ts';

import { normaliseTeamUser, parseTeamSession, serializeTeamSession } from '../../src/app/lib/session.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** The server's declared role list, read from the authority itself. */
function serverTeamRoles(): string[] {
  const source = readSource('supabase/functions/server/teamAuthorization.ts');
  const match = source.match(/export const TEAM_ROLES = \[([^\]]+)\] as const;/);
  assert.ok(match, 'server TEAM_ROLES declaration not found — the authority moved');
  return match[1]
    .split(',')
    .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** The server's ADMIN_ROLES set, read the same way. */
function serverAdminRoles(): string[] {
  const source = readSource('supabase/functions/server/teamAuthorization.ts');
  const match = source.match(/const ADMIN_ROLES: readonly TeamRole\[\] = \[([^\]]+)\];/);
  assert.ok(match, 'server ADMIN_ROLES declaration not found — the authority moved');
  return match[1]
    .split(',')
    .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

describe('team role vocabulary mirrors the server exactly', () => {
  it('declares the same roles in the same order', () => {
    // Order is rank. A mirror that reorders silently changes who may assign whom.
    assert.deepEqual([...TEAM_ROLES], serverTeamRoles());
  });

  it('agrees with the server on which roles administer the team', () => {
    const server = serverAdminRoles();
    const mirror = TEAM_ROLES.filter(canAdministerTeam);
    assert.deepEqual([...mirror].sort(), [...server].sort());
  });

  it('names and describes every role it declares', () => {
    for (const role of TEAM_ROLES) {
      assert.equal(typeof TEAM_ROLE_LABELS[role], 'string');
      assert.ok(TEAM_ROLE_LABELS[role].length > 0, `${role} has no label`);
      assert.ok(TEAM_ROLE_DESCRIPTIONS[role].length > 0, `${role} has no description`);
    }
    // No orphan entries either — a label for a role that no longer exists is
    // a label nothing can ever render.
    assert.deepEqual(Object.keys(TEAM_ROLE_LABELS).sort(), [...TEAM_ROLES].sort());
    assert.deepEqual(Object.keys(TEAM_ROLE_DESCRIPTIONS).sort(), [...TEAM_ROLES].sort());
  });

  it('defaults to the least privileged role', () => {
    assert.equal(DEFAULT_TEAM_ROLE, TEAM_ROLES[0]);
    assert.equal(teamRoleRank(DEFAULT_TEAM_ROLE), 0);
  });
});

describe('normalizeTeamRole fails closed', () => {
  it('accepts every declared role unchanged', () => {
    for (const role of TEAM_ROLES) assert.equal(normalizeTeamRole(role), role);
  });

  it('tolerates surrounding whitespace and casing', () => {
    assert.equal(normalizeTeamRole('  Admin '), 'admin');
    assert.equal(normalizeTeamRole('OWNER'), 'owner');
  });

  it('resolves anything unusable to viewer, never to a privileged role', () => {
    const unusable: unknown[] = [
      undefined, null, '', '   ', 42, true, {}, [], () => {},
      'superadmin', 'manager', 'root', 'admin;', 'ADMIN ROLE',
      // The five-role vocabulary in `core/roleEngine.ts` is a DIFFERENT axis
      // (block editing). None of its names may leak in as a team role.
      'strategist', 'finance', 'sales',
    ];
    for (const value of unusable) {
      assert.equal(normalizeTeamRole(value), 'viewer', `${String(value)} did not fail closed`);
    }
  });

  it('never resolves an unknown value to an administering role', () => {
    assert.equal(canAdministerTeam(normalizeTeamRole('definitely-not-a-role')), false);
  });

  it('recognises exactly the declared roles', () => {
    for (const role of TEAM_ROLES) assert.equal(isTeamRole(role), true);
    assert.equal(isTeamRole('owner '), false);
    assert.equal(isTeamRole('Owner'), false);
  });
});

describe('assignableRoles mirrors the server rank rule', () => {
  it('offers nothing to a role that may not administer the team', () => {
    for (const role of TEAM_ROLES) {
      if (canAdministerTeam(role)) continue;
      assert.deepEqual(assignableRoles(role), [], `${role} was offered roles to assign`);
    }
  });

  it('never offers a role at or above the holder rank', () => {
    for (const role of TEAM_ROLES) {
      for (const candidate of assignableRoles(role)) {
        assert.ok(
          teamRoleRank(candidate) < teamRoleRank(role),
          `${role} was offered ${candidate}, which is not strictly below it`,
        );
      }
    }
  });

  it('lets an admin assign below admin, and an owner assign admin', () => {
    assert.deepEqual(assignableRoles('admin'), ['viewer', 'reviewer', 'analyst', 'consultant']);
    assert.ok(assignableRoles('owner').includes('admin'));
    assert.ok(!assignableRoles('admin').includes('admin'));
    assert.ok(!assignableRoles('admin').includes('owner'));
  });

  it('always includes viewer for anybody who may assign at all', () => {
    // The invite form defaults to `viewer`; that default must never be a role
    // the holder cannot grant.
    for (const role of TEAM_ROLES) {
      const assignable = assignableRoles(role);
      if (assignable.length === 0) continue;
      assert.ok(assignable.includes('viewer'), `${role} cannot assign the default role`);
    }
  });
});

describe('the session boundary carries the role instead of dropping it', () => {
  it('keeps the role that arrived with the identity', () => {
    const user = normaliseTeamUser({
      id: 'u1', email: 'a@b.co', name: 'A B', teamRole: 'consultant',
    });
    assert.deepEqual(user, { id: 'u1', email: 'a@b.co', name: 'A B', teamRole: 'consultant' });
  });

  it('resolves a session stored before roles existed to viewer', () => {
    const user = normaliseTeamUser({ id: 'u1', email: 'a@b.co', name: 'A B' });
    assert.equal(user?.teamRole, 'viewer');
  });

  it('resolves an unrecognised stored role to viewer rather than trusting it', () => {
    // A role a newer or forged record might carry. Storage is writable by the
    // person sitting at the browser, so a stored role is untrusted input; it
    // decides nothing the server enforces, but it must still fail closed.
    const user = normaliseTeamUser({ id: 'u1', email: 'a@b.co', name: 'A B', teamRole: 'superadmin' });
    assert.equal(user?.teamRole, 'viewer');
  });

  it('trims and lowercases a role the way the server does', () => {
    // `normalizeTeamRole` on the server trims and lowercases before matching,
    // so the mirror does too — same input, same answer, on both sides.
    const user = normaliseTeamUser({ id: 'u1', email: 'a@b.co', name: 'A B', teamRole: ' Owner ' });
    assert.equal(user?.teamRole, 'owner');
  });

  it('still treats identity as all-or-nothing', () => {
    assert.equal(normaliseTeamUser({ id: 'u1', email: 'a@b.co', teamRole: 'admin' }), null);
    assert.equal(normaliseTeamUser({ teamRole: 'admin' }), null);
    assert.equal(normaliseTeamUser(null), null);
    assert.equal(normaliseTeamUser('admin'), null);
  });

  it('survives a storage round trip', () => {
    const stored = serializeTeamSession({
      accessToken: 'tok',
      user: { id: 'u1', email: 'a@b.co', name: 'A B', teamRole: 'analyst' },
    });
    const restored = parseTeamSession(stored);
    assert.equal(restored?.user?.teamRole, 'analyst');
  });

  it('restores a bare-token session with no user at all', () => {
    const restored = parseTeamSession('legacy-bare-token');
    assert.deepEqual(restored, { accessToken: 'legacy-bare-token', user: null });
  });
});

describe('the console no longer declares its own narrower role list', () => {
  it('types the member record against the canonical vocabulary', () => {
    const source = readSource('src/app/lib/api.ts');
    assert.ok(
      /teamRole: TeamRole;/.test(source),
      'TeamMemberRecord.teamRole must use the canonical TeamRole type',
    );
    assert.ok(
      !/teamRole: 'admin' \| 'reviewer' \| 'viewer'/.test(source),
      'the three-role member type is back',
    );
  });

  it('declares teamRole on the login response', () => {
    const source = readSource('src/app/lib/api.ts');
    assert.ok(
      /accessToken: string;\s*\n\s*user: \{ id: string; email: string; name: string; teamRole\?: string \};/.test(source),
      'the login response type must carry teamRole',
    );
  });

  it('routes both login modes through one service call', () => {
    // The component used to re-implement the demo branch inline and call
    // `onLogin(token)` with no user, so a demo session had no identity at all.
    const source = readSource('src/app/components/TeamLogin.tsx');
    assert.ok(
      !/onLogin\('demo_access_token_12345'\)/.test(source),
      'TeamLogin is signing in a demo session with no identity again',
    );
    assert.equal((source.match(/await teamLogin\(/g) ?? []).length, 1);
  });
});
