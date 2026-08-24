/**
 * AI-01 Batch 4A remediation — static validation of the membership lifecycle
 * migration and its rollback. No database required.
 *
 * Same division of labour as the bootstrap's static suite: a source scan proves
 * ABSENCE well and behaviour badly, so what is pinned here is what these
 * functions must never contain — a read of `user_metadata`, a `platform_admin`
 * arm, an organization taken from a parameter, a grant to `anon` or
 * `authenticated`, a roster path that mutates before it validates.
 *
 * Everything positive — that a demotion moves `role_id`, that an invite creates
 * exactly one membership, that an empty roster is refused, that a rerun changes
 * nothing — is proved against a real PostgreSQL by
 * `scripts/membership-bootstrap-scenarios.mjs`
 * (`tests/database/harness/70_assert_lifecycle.sql`, `75_assert_roster_stamping.sql`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEAM_ROLES,
  TEAM_ROLE_TO_ORGANIZATION_ROLE,
} from '../../supabase/functions/server/teamAuthorization.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = '20260818130000_marq_membership_lifecycle.sql';
const ROLLBACK = '20260818130000_rollback_membership_lifecycle.sql';

const sql = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollbackSql = readFileSync(
  join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK),
  'utf8',
);

/** The file with SQL comments stripped — a rule is code, not prose. */
const strip = (text: string) => text.replace(/^\s*--.*$/gm, ' ');
const code = strip(sql);
const rollback = strip(rollbackSql);

describe('membership lifecycle migration (static)', () => {
  it('runs in a single transaction', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
  });

  it('contains no literal UUID', () => {
    // A user id in a migration is an invented user, and a roster in source
    // control is the thing HIGH-3 says must not exist.
    const literalUuids =
      code.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    assert.deepEqual(literalUuids, [], `Literal UUIDs: ${literalUuids.join(', ')}`);
  });

  it('never reads user metadata, anywhere, for anything', () => {
    assert.ok(
      !/raw_user_meta_data/i.test(code),
      'the lifecycle must not read a field the account holder can write',
    );
  });

  it('never emits platform_admin from the role mapping', () => {
    const mapping = code.slice(
      code.indexOf('FUNCTION cortex.organization_role_for_team_role'),
      code.indexOf('COMMENT ON FUNCTION cortex.organization_role_for_team_role'),
    );
    assert.ok(mapping.length > 0, 'the mapping function must be present');
    assert.ok(!/platform_admin/i.test(mapping), 'no arm of the mapping may name platform_admin');
    // And the guard that says so out loud, in the write path.
    assert.match(code, /RAISE EXCEPTION[^;]*refusing to assign the organization role/i);
  });

  it('maps every team role exactly as the TypeScript table does', () => {
    const mapping = code.slice(
      code.indexOf('FUNCTION cortex.organization_role_for_team_role'),
      code.indexOf('COMMENT ON FUNCTION cortex.organization_role_for_team_role'),
    );
    for (const role of TEAM_ROLES) {
      const arm = new RegExp(`WHEN\\s+'${role}'\\s+THEN\\s+'([a-z_]+)'`, 'i');
      const match = mapping.match(arm);
      assert.ok(match, `the SQL mapping has no arm for '${role}'`);
      assert.equal(
        match![1],
        TEAM_ROLE_TO_ORGANIZATION_ROLE[role],
        `SQL maps ${role} -> ${match![1]}, TypeScript maps it -> ${TEAM_ROLE_TO_ORGANIZATION_ROLE[role]}`,
      );
    }
    // The ELSE arm is the least privileged key, matching `normalizeTeamRole`.
    assert.match(mapping, /ELSE\s+'team_viewer'/i);
  });

  it('declares the team roles once, in the same order as TEAM_ROLES', () => {
    const declared = code
      .slice(code.indexOf('FUNCTION cortex.team_roles'), code.indexOf('COMMENT ON FUNCTION cortex.team_roles'))
      .match(/ARRAY\[([^\]]+)\]/i);
    assert.ok(declared, 'cortex.team_roles() must declare the array literally');
    const roles = declared![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    assert.deepEqual(roles, [...TEAM_ROLES]);
  });

  it('resolves the organization internally and never takes one as a parameter', () => {
    const signatures = code.match(/FUNCTION\s+public\.marq_\w+\s*\(([^)]*)\)/gi) ?? [];
    assert.ok(signatures.length >= 2, 'both membership functions must be present');
    for (const signature of signatures) {
      assert.ok(
        !/organization/i.test(signature),
        `a membership function takes an organization: ${signature}`,
      );
      assert.ok(!/role_id/i.test(signature), `a membership function takes a role id: ${signature}`);
    }
    assert.match(code, /cortex\.marq_organization_id_strict\(\)/);
  });

  it('never creates an organization', () => {
    assert.ok(
      !/INSERT\s+INTO\s+public\.organizations/i.test(code),
      'a lifecycle that creates its own tenant is a default tenant',
    );
  });

  it('resolves system roles from one scope of the seeded catalog', () => {
    const resolver = code.slice(
      code.indexOf('FUNCTION cortex.system_role_id'),
      code.indexOf('FUNCTION cortex.marq_organization_id_strict'),
    );
    assert.match(resolver, /r\.scope\s*=\s*'platform'/i);
    assert.match(resolver, /r\.is_system\s*=\s*true/i);
    assert.match(resolver, /r\.organization_id\s+IS\s+NULL/i);
  });

  it('never rewrites the status of an existing membership', () => {
    // A suspension is a decision; a role change is not a reason to undo it.
    const updates = code.match(/UPDATE\s+public\.organization_memberships[\s\S]*?(?=;)/gi) ?? [];
    assert.ok(updates.length > 0);
    for (const update of updates) {
      assert.ok(
        !/SET[\s\S]*\bstatus\s*=/i.test(update),
        `a membership UPDATE writes status: ${update.slice(0, 160)}`,
      );
    }
  });

  it('revokes by soft delete, never by DELETE', () => {
    assert.ok(!/DELETE\s+FROM\s+public\.organization_memberships/i.test(code));
    assert.match(code, /SET\s+deleted_at\s*=\s*now\(\)/i);
  });

  it('serialises against the bootstrap on the same advisory lock', () => {
    const locks = code.match(/pg_advisory_xact_lock\(hashtext\('([^']+)'\)/g) ?? [];
    assert.ok(locks.length >= 2, 'both membership writes must take the lock');
    for (const lock of locks) {
      assert.match(lock, /cortex\.membership_bootstrap/);
    }
  });

  it('grants the membership functions to service_role and nobody else', () => {
    for (const fn of ['marq_sync_team_membership', 'marq_revoke_team_membership']) {
      assert.match(code, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^;]*FROM PUBLIC`, 'i'));
      const grants = code.match(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^;]*;`, 'gi')) ?? [];
      assert.equal(grants.length, 1, `${fn} must have exactly one grant`);
      assert.match(grants[0], /TO service_role;\s*$/i);
      assert.ok(!/anon|authenticated/i.test(grants[0]), `${fn} is reachable by a browser role`);
    }
  });

  it('grants the roster functions to nobody at all', () => {
    for (const fn of ['stamp_team_roster', 'unstamp_team_roster']) {
      assert.match(code, new RegExp(`REVOKE ALL ON FUNCTION cortex\\.${fn}[^;]*FROM PUBLIC`, 'i'));
      assert.ok(
        !new RegExp(`GRANT EXECUTE ON FUNCTION cortex\\.${fn}`, 'i').test(code),
        `${fn} mutates auth.users; no role may be granted it`,
      );
    }
  });

  it('keeps the roster functions SECURITY INVOKER', () => {
    // Definer rights on a function that writes `auth.users` would be a
    // privilege the operator did not have before running it.
    for (const fn of ['stamp_team_roster', 'unstamp_team_roster']) {
      const start = code.indexOf(`FUNCTION cortex.${fn}`);
      const body = code.slice(start, code.indexOf('AS $$', start));
      assert.ok(!/SECURITY\s+DEFINER/i.test(body), `cortex.${fn} must not be SECURITY DEFINER`);
    }
  });

  it('pins the search path on every function it defines', () => {
    const definitions = code.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$\$/g) ?? [];
    assert.ok(definitions.length >= 8);
    for (const definition of definitions) {
      assert.match(definition, /SET search_path = ''/, `unpinned search_path: ${definition.slice(0, 90)}`);
    }
  });

  it('keeps both provenance ledgers unreachable through the API', () => {
    for (const table of ['cortex.membership_lifecycle_log', 'cortex.team_roster_stamp_log']) {
      assert.match(code, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'));
      assert.match(code, new RegExp(`REVOKE ALL ON ${table} FROM PUBLIC`, 'i'));
      assert.ok(
        !new RegExp(`GRANT[^;]*ON ${table}`, 'i').test(code),
        `${table} is granted to somebody`,
      );
    }
  });

  it('records the provenance HIGH-3 asks for', () => {
    const ledger = code.slice(
      code.indexOf('CREATE TABLE IF NOT EXISTS cortex.team_roster_stamp_log'),
      code.indexOf('COMMENT ON TABLE cortex.team_roster_stamp_log'),
    );
    for (const column of [
      'artifact',
      'user_id',
      'team_role',
      'previous_app_metadata',
      'stamped_app_metadata',
      'stamped_at',
      'stamped_by',
      'reverted_at',
    ]) {
      assert.match(ledger, new RegExp(`\\b${column}\\b`), `the ledger has no ${column}`);
    }
  });

  it('validates the roster in full before it writes anything', () => {
    const stamp = code.slice(
      code.indexOf('FUNCTION cortex.stamp_team_roster'),
      code.indexOf('FUNCTION cortex.unstamp_team_roster'),
    );
    const firstWrite = stamp.search(/UPDATE\s+auth\.users/i);
    assert.ok(firstWrite > 0, 'the stamp must write auth.users');

    // Every refusal HIGH-3 names, and all of them ahead of the first mutation.
    for (const refusal of [
      /the roster is empty/i,
      /above the reviewed maximum/i,
      /expected % entries/i,
      /malformed roster entr/i,
      /role\(s\) the console cannot issue/i,
      /duplicate roster entr/i,
      /match no live auth user/i,
      /another organization/i,
    ]) {
      const at = stamp.search(refusal);
      assert.ok(at > 0, `missing refusal: ${refusal}`);
      assert.ok(at < firstWrite, `refusal runs after the first write: ${refusal}`);
    }
  });

  it('defaults the roster functions to a dry run', () => {
    assert.match(code, /p_dry_run\s+BOOLEAN\s+DEFAULT\s+TRUE/gi);
    const defaults = code.match(/p_dry_run\s+BOOLEAN\s+DEFAULT\s+(TRUE|FALSE)/gi) ?? [];
    assert.equal(defaults.length, 2);
    for (const value of defaults) assert.match(value, /TRUE/i);
  });

  it('merges app metadata rather than replacing it', () => {
    // A replace would destroy `platform_role`, which this lifecycle has no
    // business touching in either direction.
    assert.match(code, /raw_app_meta_data\s*=\s*COALESCE\(u\.raw_app_meta_data, '\{\}'::JSONB\)\s*\|\|/i);
    assert.ok(
      !/raw_app_meta_data\s*=\s*jsonb_build_object/i.test(code),
      'the stamp must never replace the whole metadata bag',
    );
  });

  it('never writes platform_role', () => {
    assert.ok(
      !/jsonb_build_object\([^)]*platform_role/i.test(code),
      'this lifecycle must not be able to mint platform administration',
    );
  });

  it('asserts the roster applied whole', () => {
    assert.match(code, /recorded % of % roster entries/i);
  });

  it('fails loudly when the role catalog is incomplete (MED-2)', () => {
    assert.match(code, /the seeded system role catalog is missing/i);
    // Derived from the mapping rather than restated, so a new team role cannot
    // leave the check behind.
    assert.match(code, /unnest\(cortex\.team_roles\(\)\)/i);
  });
});

describe('membership lifecycle rollback (static)', () => {
  it('drops functions and touches no row of either table', () => {
    assert.ok(!/UPDATE\s+auth\.users/i.test(rollback));
    assert.ok(!/DELETE\s+FROM/i.test(rollback));
    assert.ok(!/UPDATE\s+public\.organization_memberships/i.test(rollback));
  });

  it('keeps both provenance ledgers', () => {
    assert.ok(!/DROP TABLE[^;]*membership_lifecycle_log/i.test(rollback));
    assert.ok(!/DROP TABLE[^;]*team_roster_stamp_log/i.test(rollback));
  });

  it('refuses to run while a stamping artifact is still live', () => {
    assert.match(rollback, /RAISE EXCEPTION[\s\S]*stamping record\(s\) are still live/i);
    assert.match(rollback, /reverted_at IS NULL/i);
  });

  it('drops every function the migration created', () => {
    const created = [
      ...code.matchAll(/CREATE OR REPLACE FUNCTION\s+((?:public|cortex)\.\w+)/g),
    ].map((m) => m[1]);
    assert.ok(created.length >= 8);
    for (const fn of new Set(created)) {
      assert.match(
        rollback,
        new RegExp(`DROP FUNCTION IF EXISTS ${fn.replace('.', '\\.')}\\s*\\(`, 'i'),
        `the rollback leaves ${fn} behind`,
      );
    }
  });
});
