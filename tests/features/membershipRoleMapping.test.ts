/**
 * AI-01 Batch 4A remediation — L2/L3: one intentional role mapping.
 *
 * Before this suite there were four descriptions of how a team role becomes an
 * organization role key, and they disagreed:
 *
 *   `TEAM_ROLES` / `normalizeTeamRole`   (supabase/functions/server/teamAuthorization.ts)
 *   the SQL CASE                         (the bootstrap migration)
 *   `LEGACY_TEAM_ROLE_MAP`               (src/types/database.types.ts)
 *   a table in prose                     (architecture/database/MEMBERSHIP_BOOTSTRAP.md)
 *
 * The disagreement was not cosmetic. `manager` is not a member of `TEAM_ROLES`,
 * so `normalizeTeamRole` resolves it to `viewer` — while two of the four sent it
 * to `org_admin`. A bootstrap that trusted them would have granted organization
 * administration to an account the console treats as read-only.
 *
 * `TEAM_ROLE_TO_ORGANIZATION_ROLE` is now the definition. This file is what
 * makes that true rather than aspirational: it reads the other three and fails
 * if any of them says something else.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ORGANIZATION_ROLE_KEYS,
  TEAM_ROLES,
  TEAM_ROLE_TO_ORGANIZATION_ROLE,
  isProvisionedTeamAccount,
  normalizeTeamRole,
  organizationRoleForTeamRole,
  resolveTeamRoleFromAuthRecord,
  teamAppMetadata,
  type TeamRole,
} from '../../supabase/functions/server/teamAuthorization.ts';
import { LEGACY_TEAM_ROLE_MAP } from '../../src/types/database.types.ts';
import { ROLE_CAPABILITIES, capabilitiesForRoles } from '../../supabase/functions/server/ai/security/actor.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  join(root, 'supabase', 'migrations', '20260818120000_marq_team_membership_bootstrap.sql'),
  'utf8',
);
const doc = readFileSync(join(root, 'architecture', 'database', 'MEMBERSHIP_BOOTSTRAP.md'), 'utf8');

/** The migration with SQL comments stripped — a mapping is code, not prose. */
const migrationCode = migration.replace(/^\s*--.*$/gm, ' ');

describe('the definition is total and closed', () => {
  it('maps every team role the console can issue', () => {
    for (const role of TEAM_ROLES) {
      assert.ok(
        TEAM_ROLE_TO_ORGANIZATION_ROLE[role],
        `TEAM_ROLE_TO_ORGANIZATION_ROLE has no entry for '${role}'`,
      );
    }
  });

  it('maps to nothing outside the seeded system catalog', () => {
    for (const [role, key] of Object.entries(TEAM_ROLE_TO_ORGANIZATION_ROLE)) {
      assert.ok(
        (ORGANIZATION_ROLE_KEYS as readonly string[]).includes(key),
        `'${role}' maps to '${key}', which is not a seeded organization role`,
      );
    }
  });

  it('never maps anything to platform_admin', () => {
    // That role is granted by a person, through the admin API, with ops
    // approval. No mapping may produce it, so no backfill can.
    assert.equal(Object.values(TEAM_ROLE_TO_ORGANIZATION_ROLE).includes('platform_admin' as never), false);
  });

  it('resolves an unrecognised role to the least privileged key', () => {
    for (const value of ['manager', 'superadmin', '', '   ', undefined, null, 42, {}]) {
      assert.equal(
        organizationRoleForTeamRole(value),
        'team_viewer',
        `${JSON.stringify(value)} must resolve to team_viewer`,
      );
    }
  });

  it('resolves through normalizeTeamRole, so casing and padding cannot escape it', () => {
    assert.equal(organizationRoleForTeamRole('  OWNER '), 'org_admin');
    assert.equal(normalizeTeamRole('  OWNER '), 'owner');
  });
});

describe('every other copy of the mapping agrees with it', () => {
  it('the browser-side LEGACY_TEAM_ROLE_MAP matches, key for key', () => {
    assert.deepEqual(
      LEGACY_TEAM_ROLE_MAP,
      Object.fromEntries(TEAM_ROLES.map((role) => [role, TEAM_ROLE_TO_ORGANIZATION_ROLE[role]])),
    );
  });

  it('the legacy map no longer answers for `manager`', () => {
    // The specific escalation: read-only in one table, organization admin in
    // the other.
    assert.equal(LEGACY_TEAM_ROLE_MAP.manager, undefined);
  });

  it("the migration's CASE matches, arm for arm", () => {
    for (const role of TEAM_ROLES) {
      assert.match(
        migrationCode,
        new RegExp(`WHEN\\s+'${role}'\\s+THEN\\s+'${TEAM_ROLE_TO_ORGANIZATION_ROLE[role]}'`, 'i'),
        `the migration must map '${role}' to '${TEAM_ROLE_TO_ORGANIZATION_ROLE[role]}'`,
      );
    }
    assert.match(migrationCode, /ELSE\s+'team_viewer'/i);
  });

  it('the migration has no CASE arm the definition does not have', () => {
    const arms = [...migrationCode.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'([a-z_]+)'/gi)];
    assert.ok(arms.length > 0, 'the migration must contain the mapping');
    for (const [, role, key] of arms) {
      assert.equal(
        TEAM_ROLE_TO_ORGANIZATION_ROLE[role as TeamRole],
        key,
        `the migration maps '${role}' to '${key}', which the definition does not`,
      );
    }
  });

  it('the documented table no longer carries `manager`', () => {
    assert.doesNotMatch(
      doc,
      /^\|\s*manager\b/m,
      'MEMBERSHIP_BOOTSTRAP.md still documents a mapping for a role TEAM_ROLES does not contain',
    );
  });

  it('the documented table matches, row for row', () => {
    for (const role of TEAM_ROLES) {
      assert.match(
        doc,
        new RegExp(`\\|\\s*${role}\\s*\\|\\s*\`${TEAM_ROLE_TO_ORGANIZATION_ROLE[role]}\``),
        `MEMBERSHIP_BOOTSTRAP.md must document '${role}' -> '${TEAM_ROLE_TO_ORGANIZATION_ROLE[role]}'`,
      );
    }
  });
});

describe('the mapping does not increase privilege', () => {
  // An organization role key must grant no capability the team role it is
  // mapped FROM does not already grant. Membership roles are additive, so a key
  // that granted more would be a promotion nobody asked for.
  for (const role of TEAM_ROLES) {
    it(`'${role}' gains nothing from its '${TEAM_ROLE_TO_ORGANIZATION_ROLE[role]}' membership`, () => {
      const fromTeamRole = new Set(capabilitiesForRoles([role]));
      const fromMembership = capabilitiesForRoles([TEAM_ROLE_TO_ORGANIZATION_ROLE[role]]);
      const gained = fromMembership.filter((capability) => !fromTeamRole.has(capability));
      assert.deepEqual(
        gained,
        [],
        `'${TEAM_ROLE_TO_ORGANIZATION_ROLE[role]}' grants ${gained.join(', ')} that '${role}' does not`,
      );
    });
  }

  it('every organization role key is present in the capability table', () => {
    // A key that is absent grants nothing, which is how joining the role
    // catalog could change what the query returned and nothing about what an
    // actor could do.
    for (const key of ORGANIZATION_ROLE_KEYS) {
      assert.ok(ROLE_CAPABILITIES[key], `ROLE_CAPABILITIES has no entry for '${key}'`);
    }
  });

  it('team_viewer grants nothing', () => {
    assert.deepEqual(capabilitiesForRoles(['team_viewer']), []);
  });

  it('org_admin and team_viewer are distinguishable', () => {
    assert.notDeepEqual(capabilitiesForRoles(['org_admin']), capabilitiesForRoles(['team_viewer']));
  });
});

describe('the eligibility authority is app metadata', () => {
  it('recognises a server-provisioned team account', () => {
    assert.equal(isProvisionedTeamAccount({ app_metadata: teamAppMetadata('admin') }), true);
  });

  it('refuses a team claim made in user metadata', () => {
    // The self-promotion path: GoTrue's PUT /auth/v1/user lets an account holder
    // write their own user_metadata, and nothing else.
    assert.equal(
      isProvisionedTeamAccount({
        app_metadata: {},
        user_metadata: { marq_team: true, role: 'team', teamRole: 'owner' },
      }),
      false,
    );
    assert.equal(isProvisionedTeamAccount({ user_metadata: { marq_team: true } }), false);
    assert.equal(isProvisionedTeamAccount(null), false);
  });

  it('prefers the app-metadata role over the user-metadata one', () => {
    assert.equal(
      resolveTeamRoleFromAuthRecord({
        app_metadata: { team_role: 'viewer' },
        user_metadata: { teamRole: 'owner' },
      }),
      'viewer',
    );
  });

  it('does not fall back for a stamped account with no role', () => {
    // A stamped account has been through a server-side provisioning path. A
    // missing role there is a data gap, and filling it from the one field the
    // account holder can write would be the escalation this change closes.
    assert.equal(
      resolveTeamRoleFromAuthRecord({
        app_metadata: { marq_team: true },
        user_metadata: { teamRole: 'owner' },
      }),
      'viewer',
    );
  });

  it('falls back to user metadata only when app metadata carries no role', () => {
    // Bounded, and it grants no more than it granted yesterday: the fallback
    // reaches the team-role capability set, never organization membership.
    assert.equal(
      resolveTeamRoleFromAuthRecord({ app_metadata: {}, user_metadata: { teamRole: 'analyst' } }),
      'analyst',
    );
  });

  it('normalises both paths, so neither can produce a role outside TEAM_ROLES', () => {
    for (const record of [
      { app_metadata: { team_role: 'superadmin' } },
      { user_metadata: { teamRole: 'superadmin' } },
      { app_metadata: { team_role: 42 } },
      {},
    ]) {
      const role = resolveTeamRoleFromAuthRecord(record);
      assert.ok((TEAM_ROLES as readonly string[]).includes(role), `resolved '${role}'`);
    }
  });

  it('resolves a missing record to the least privileged role', () => {
    assert.equal(resolveTeamRoleFromAuthRecord(undefined), 'viewer');
  });

  it('stamps the flag and the role together', () => {
    assert.deepEqual(teamAppMetadata('consultant'), { marq_team: true, team_role: 'consultant' });
  });
});
