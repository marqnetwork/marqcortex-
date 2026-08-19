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
 * The remediation added a fifth — `cortex.organization_role_for_team_role`,
 * which is what the console's own invite and role-change writes now go through.
 * A fifth copy is a fifth chance to disagree, so it is read here too, and so is
 * `cortex.team_roles()`: the SQL vocabulary and the TypeScript one have to be
 * the same list or the roster validator would accept a role the console cannot
 * issue.
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
import {
  AUTHORITY_LADDER,
  MEMBERSHIP_AUTHORITY_CEILING,
  PRIVILEGED_CAPABILITIES,
  ROLE_CAPABILITIES,
  capabilitiesForRoles,
} from '../../supabase/functions/server/ai/security/actor.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  join(root, 'supabase', 'migrations', '20260818120000_marq_team_membership_bootstrap.sql'),
  'utf8',
);
const lifecycleMigration = readFileSync(
  join(root, 'supabase', 'migrations', '20260818130000_marq_membership_lifecycle.sql'),
  'utf8',
);
const doc = readFileSync(join(root, 'architecture', 'database', 'MEMBERSHIP_BOOTSTRAP.md'), 'utf8');

/** The migration with SQL comments stripped — a mapping is code, not prose. */
const migrationCode = migration.replace(/^\s*--.*$/gm, ' ');
const lifecycleCode = lifecycleMigration.replace(/^\s*--.*$/gm, ' ');

/** The body of `cortex.organization_role_for_team_role` — the FIFTH copy, and
 *  the one the console's own writes now go through. */
const sqlMappingBody = lifecycleCode.slice(
  lifecycleCode.indexOf('FUNCTION cortex.organization_role_for_team_role'),
  lifecycleCode.indexOf('COMMENT ON FUNCTION cortex.organization_role_for_team_role'),
);

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

describe('the SQL lifecycle mapping agrees with it too', () => {
  it('has one arm per team role, mapping to the same key', () => {
    const arms = [...sqlMappingBody.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'([a-z_]+)'/gi)];
    assert.equal(
      arms.length,
      TEAM_ROLES.length,
      `cortex.organization_role_for_team_role has ${arms.length} arms for ${TEAM_ROLES.length} team roles`,
    );
    for (const [, role, key] of arms) {
      assert.ok(
        (TEAM_ROLES as readonly string[]).includes(role),
        `the SQL mapping names '${role}', which the console cannot issue`,
      );
      assert.equal(
        key,
        TEAM_ROLE_TO_ORGANIZATION_ROLE[role as TeamRole],
        `SQL maps ${role} -> ${key}; the definition maps it -> ${TEAM_ROLE_TO_ORGANIZATION_ROLE[role as TeamRole]}`,
      );
    }
  });

  it('sends everything unrecognised to the least privileged key', () => {
    assert.match(sqlMappingBody, /ELSE\s+'team_viewer'/i);
    assert.equal(organizationRoleForTeamRole('manager'), 'team_viewer');
  });

  it('declares the same team-role vocabulary as TEAM_ROLES', () => {
    const declared = lifecycleCode
      .slice(
        lifecycleCode.indexOf('FUNCTION cortex.team_roles'),
        lifecycleCode.indexOf('COMMENT ON FUNCTION cortex.team_roles'),
      )
      .match(/ARRAY\[([^\]]+)\]/i);
    assert.ok(declared, 'cortex.team_roles() must declare its array literally');
    assert.deepEqual(
      declared![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
      [...TEAM_ROLES],
    );
  });

  it('cannot emit a key outside ORGANIZATION_ROLE_KEYS', () => {
    const emitted = [...sqlMappingBody.matchAll(/THEN\s+'([a-z_]+)'|ELSE\s+'([a-z_]+)'/gi)]
      .map((m) => m[1] ?? m[2]);
    assert.ok(emitted.length > 0);
    for (const key of emitted) {
      assert.ok(
        (ORGANIZATION_ROLE_KEYS as readonly string[]).includes(key),
        `the SQL mapping can emit '${key}', which is not a declared organization role key`,
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

  it('reads the role from app metadata, ignoring what user metadata claims', () => {
    assert.equal(
      resolveTeamRoleFromAuthRecord({
        app_metadata: { marq_team: true, team_role: 'viewer' },
        user_metadata: { teamRole: 'owner' },
      }),
      'viewer',
    );
  });

  it('gives a stamped account with no role the LEAST privilege, never a fallback', () => {
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

  // HIGH-2. The `user_metadata` fallback is GONE, not narrowed. What it used to
  // reach was console team ADMINISTRATION, and "no more than it granted
  // yesterday" was therefore not a bound worth keeping.
  it('grants nothing at all to an account that is not stamped', () => {
    for (const record of [
      { app_metadata: {}, user_metadata: { teamRole: 'analyst' } },
      { app_metadata: {}, user_metadata: { teamRole: 'owner', role: 'team' } },
      { app_metadata: { team_role: 'owner' }, user_metadata: {} },   // role without the stamp
      { user_metadata: { marq_team: true, team_role: 'owner' } },
      {},
      undefined,
    ]) {
      assert.equal(
        resolveTeamRoleFromAuthRecord(record),
        null,
        `an unstamped record resolved a role: ${JSON.stringify(record)}`,
      );
    }
  });

  it('normalises the app-metadata role, so it cannot produce anything outside TEAM_ROLES', () => {
    for (const record of [
      { app_metadata: { marq_team: true, team_role: 'superadmin' } },
      { app_metadata: { marq_team: true, team_role: 42 } },
      { app_metadata: { marq_team: true, team_role: '  ADMIN  ' } },
      { app_metadata: { marq_team: true } },
    ]) {
      const role = resolveTeamRoleFromAuthRecord(record);
      assert.ok(role !== null && (TEAM_ROLES as readonly string[]).includes(role), `resolved '${role}'`);
    }
  });

  it('stamps the flag and the role together', () => {
    assert.deepEqual(teamAppMetadata('consultant'), { marq_team: true, team_role: 'consultant' });
  });
});

// ---------------------------------------------------------------------------
// The AI control plane's copy of the ladder (H-A)
//
// `AUTHORITY_LADDER` in `ai/security/actor.ts` is a deliberate copy of
// `TEAM_ROLES`: the AI control plane takes no import from the console's server
// modules, which is what keeps `ai/` runnable and testable on its own. A
// deliberate copy still needs a test that fails when it drifts, and the whole
// authority floor is decided by that ordering — a ladder one entry out of step
// would floor a demotion to the wrong role.
// ---------------------------------------------------------------------------

describe('the AI authority ladder agrees with the console vocabulary', () => {
  it('is the same roles in the same order', () => {
    assert.deepEqual(
      [...AUTHORITY_LADDER],
      [...TEAM_ROLES],
      'AUTHORITY_LADDER in ai/security/actor.ts must mirror TEAM_ROLES exactly, order included',
    );
  });

  it('gives every organization role key a ceiling on that ladder', () => {
    assert.deepEqual(
      Object.keys(MEMBERSHIP_AUTHORITY_CEILING).sort(),
      [...ORGANIZATION_ROLE_KEYS].sort(),
      'every seeded organization role key needs a ceiling, or a membership carrying it floors to viewer',
    );
  });

  it("each ceiling is the highest team role that maps to that key", () => {
    // Derived from the definition rather than restated, so the two cannot be
    // wrong together.
    const highestFor = new Map<string, TeamRole>();
    for (const role of TEAM_ROLES) {
      const key = TEAM_ROLE_TO_ORGANIZATION_ROLE[role];
      const current = highestFor.get(key);
      if (current === undefined || TEAM_ROLES.indexOf(role) > TEAM_ROLES.indexOf(current)) {
        highestFor.set(key, role);
      }
    }
    for (const key of ORGANIZATION_ROLE_KEYS) {
      assert.equal(
        MEMBERSHIP_AUTHORITY_CEILING[key],
        highestFor.get(key),
        `${key}'s ceiling must be the most privileged team role that maps to it`,
      );
    }
  });

  it('a membership never grants above the team role that produced it', () => {
    // The property the floor depends on being a no-op in a CONSISTENT state:
    // if this ever stopped holding, flooring would start removing capabilities
    // from working accounts instead of only from disagreeing ones.
    for (const role of TEAM_ROLES) {
      const fromTeamRole = new Set(capabilitiesForRoles([role]));
      for (const capability of capabilitiesForRoles([TEAM_ROLE_TO_ORGANIZATION_ROLE[role]])) {
        assert.ok(
          fromTeamRole.has(capability),
          `the ${TEAM_ROLE_TO_ORGANIZATION_ROLE[role]} membership grants ${capability}, which '${role}' does not`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// M-B — no arm of the role machinery can produce platform authority
// ---------------------------------------------------------------------------

describe('nothing in the role machinery mints platform administration', () => {
  it('the reviewed roster template names only roles the console can issue', () => {
    const template = JSON.parse(
      readFileSync(join(root, 'supabase', 'operations', 'roster', 'team-roster.example.json'), 'utf8'),
    ) as { roster: readonly { team_role: string }[] };
    for (const entry of template.roster) {
      assert.ok(
        (TEAM_ROLES as readonly string[]).includes(entry.team_role),
        `the example roster names '${entry.team_role}', which is not a team role`,
      );
    }
  });

  it('the roster template offers no platform role as an assignable value', () => {
    // The check is on the VALUES, not on the file text. The template also
    // carries a note saying in so many words that `owner` is not AI platform
    // administration — a disclaimer is worth more here than silence, and a
    // regex over the raw file would have forbidden writing one down.
    const template = JSON.parse(
      readFileSync(join(root, 'supabase', 'operations', 'roster', 'team-roster.example.json'), 'utf8'),
    ) as { roster: readonly Record<string, unknown>[] };

    for (const entry of template.roster) {
      for (const [key, value] of Object.entries(entry)) {
        if (key === 'note') continue;
        assert.equal(
          /platform_role|platform_admin|super_?admin/i.test(String(value)),
          false,
          `the template offers '${String(value)}' under '${key}'`,
        );
      }
      assert.equal(
        Object.prototype.hasOwnProperty.call(entry, 'platform_role'),
        false,
        'a roster entry must not carry a platform_role field',
      );
    }
  });

  it('the roster template says outright that owner is not platform administration', () => {
    const raw = readFileSync(
      join(root, 'supabase', 'operations', 'roster', 'team-roster.example.json'),
      'utf8',
    );
    assert.match(raw, /owner/);
    assert.match(
      raw,
      /grants no AI platform administration/i,
      'the template must state the M-B separation rather than leave it to be inferred',
    );
  });

  it('the stamping function writes exactly two keys, neither of them a platform role', () => {
    // The stamp is a MERGE of `jsonb_build_object('marq_team', true,
    // 'team_role', …)`. Any third key here would be a key a roster could set.
    const stamp = lifecycleMigration.match(
      /jsonb_build_object\('marq_team', true, 'team_role', b\.team_role\)/,
    );
    assert.ok(stamp, 'the stamp must write marq_team and team_role and nothing else');
    assert.equal(
      /raw_app_meta_data\s*=\s*jsonb_build_object/.test(lifecycleMigration),
      false,
      'the stamp must MERGE into the existing bag, never replace it — replacing would drop platform_role',
    );
  });

  it('the provisioning shape the console sends carries no platform key', () => {
    for (const role of TEAM_ROLES) {
      assert.deepEqual(Object.keys(teamAppMetadata(role)).sort(), ['marq_team', 'team_role']);
    }
  });
});

// ---------------------------------------------------------------------------
// The privileged/baseline partition (M-A)
//
// `PRIVILEGED_CAPABILITIES` decides which requests resolve memberships from the
// database rather than from a snapshot. A capability that is in neither that set
// nor the baseline would be servable from a stale snapshot AND revocable — the
// one combination the design must not have.
// ---------------------------------------------------------------------------

describe('every AI capability is either baseline or privileged', () => {
  it('partitions the capability vocabulary with no gap and no overlap', () => {
    // The whole vocabulary, taken from the grant table rather than restated.
    const every = new Set<string>();
    for (const grants of Object.values(ROLE_CAPABILITIES)) {
      for (const capability of grants) every.add(capability);
    }

    const baseline = new Set<string>(capabilitiesForRoles(['reviewer']));
    const privileged = new Set<string>(PRIVILEGED_CAPABILITIES);

    for (const capability of every) {
      const inBaseline = baseline.has(capability);
      const inPrivileged = privileged.has(capability);
      assert.ok(
        inBaseline !== inPrivileged,
        `${capability} is ${inBaseline && inPrivileged ? 'in both' : 'in neither'} ` +
        'the baseline and PRIVILEGED_CAPABILITIES; it must be in exactly one',
      );
    }

    for (const capability of privileged) {
      assert.ok(every.has(capability), `${capability} is privileged but no role grants it`);
    }
  });

  it('the bottom of the ladder holds nothing privileged', () => {
    // The floor bottoms out at `viewer`, and an actor floored to the bottom
    // still receives the baseline. If any privileged capability were in it,
    // the floor would grant one to a demoted admin.
    const privileged = new Set<string>(PRIVILEGED_CAPABILITIES);
    for (const capability of capabilitiesForRoles(['viewer'])) {
      assert.equal(privileged.has(capability), false);
    }
    for (const capability of capabilitiesForRoles([TEAM_ROLE_TO_ORGANIZATION_ROLE.viewer])) {
      assert.equal(privileged.has(capability), false);
    }
  });
});

