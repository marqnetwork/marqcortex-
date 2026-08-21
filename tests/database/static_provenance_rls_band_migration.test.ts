/**
 * AI-01 Batch 4A, LOW-A — static validation of the provenance RLS band
 * migration and its rollback. No database required.
 *
 * Same division of labour as the migrations before it: a source scan proves
 * ABSENCE well and behaviour badly. What is pinned here is what these files
 * must never contain — a widened table grant, a disabled RLS, a literal user
 * id, a policy that drops one of the certified conjuncts — and every positive
 * claim is settled against a real PostgreSQL by
 * `scripts/membership-bootstrap-scenarios.mjs`
 * (`tests/database/harness/92_assert_provenance_rls_band.sql`), which applies
 * the migration, forges provenance as `authenticated` through RLS, and asserts
 * the refusal.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TEAM_ROLES } from '../../supabase/functions/server/teamAuthorization.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = '20260821120000_marq_provenance_rls_band.sql';
const ROLLBACK = '20260821120000_rollback_provenance_rls_band.sql';

const sql = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollbackSql = readFileSync(
  join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK),
  'utf8',
);

/** The file with SQL comments stripped — a rule is code, not prose. */
const strip = (text: string) => text.replace(/^\s*--.*$/gm, ' ');
const code = strip(sql);
const rollback = strip(rollbackSql);

describe('provenance RLS band migration (static)', () => {
  it('runs in a single transaction, and so does its rollback', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
    assert.match(rollback, /^\s*BEGIN;/m);
    assert.match(rollback, /^\s*COMMIT;\s*$/m);
  });

  it('contains no literal UUID', () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assert.equal(uuid.test(code), false);
    assert.equal(uuid.test(rollback), false);
  });

  it('pins search_path on the function it defines', () => {
    assert.match(code, /CREATE OR REPLACE FUNCTION cortex\.team_role_matches_role/);
    assert.match(code, /SET search_path = ''/);
  });

  it('never widens a table grant to a browser role', () => {
    // The finding is about a policy, and closing it must not require handing
    // `authenticated` a write it does not have today. The harness grants one
    // for the length of one file, then revokes it; the MIGRATION never does.
    for (const text of [code, rollback]) {
      assert.equal(
        /GRANT[^;]*\bON\s+(?:TABLE\s+)?public\.organization_memberships[^;]*\bTO\b/i.test(text),
        false,
        'the migration grants table access on organization_memberships',
      );
      assert.equal(
        /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*\bTO\s+[^;]*\b(?:anon|authenticated)\b/i.test(
          text.replace(/GRANT\s+EXECUTE[^;]*;/gi, ' '),
        ),
        false,
        'the migration grants a table privilege to a browser role',
      );
    }
  });

  it('never disables or unforces row level security', () => {
    for (const text of [code, rollback]) {
      assert.equal(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(text), false);
      assert.equal(/NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(text), false);
    }
  });

  it('constrains team_role in BOTH membership policies', () => {
    for (const policy of ['memberships_insert_admin', 'memberships_update_admin']) {
      const body = code.slice(code.indexOf(`CREATE POLICY ${policy}`));
      const clause = body.slice(0, body.indexOf(';'));
      assert.match(
        clause,
        /cortex\.team_role_matches_role\(\s*team_role\s*,\s*role_id\s*\)/,
        `${policy} does not constrain team_role`,
      );
    }
  });

  it('preserves every certified conjunct of the policies it replaces', () => {
    // A policy is replaced whole, so the risk is not what was added but what
    // was silently dropped. These three are the HIGH-2 and self-elevation
    // guards from 20260711050001, and they must survive verbatim.
    const update = code.slice(code.indexOf('CREATE POLICY memberships_update_admin'));
    const clause = update.slice(0, update.indexOf(';'));
    assert.match(clause, /cortex\.is_organization_admin\(organization_id\)/);
    assert.match(clause, /r\.key = 'platform_admin'/);
    assert.match(clause, /user_id <> auth\.uid\(\)/);
    assert.match(clause, /r\.key IN \('team_member', 'team_viewer'\)/);
  });

  it('asserts its own post-conditions', () => {
    assert.match(code, /RAISE EXCEPTION[^;]*does not constrain team_role/);
    assert.match(code, /relrowsecurity/);
    assert.match(code, /relforcerowsecurity/);
  });

  it('refuses to run against a table that already violates the band', () => {
    // Adding a lock over rows that already break it is how a deployment ends up
    // with a constraint nobody can satisfy.
    assert.match(code, /RAISE EXCEPTION[^;]*already carry provenance that does not map/);
  });

  it('names the whole team vocabulary in the CHECK, and nothing else', () => {
    // The ADD, not the DROP that precedes it — the DROP names the constraint
    // and says nothing about its body.
    const check = code.slice(code.indexOf('ADD CONSTRAINT organization_memberships_team_role_check'));
    const clause = check.slice(0, check.indexOf(';'));
    for (const role of TEAM_ROLES) {
      assert.ok(clause.includes(`'${role}'`), `the CHECK omits ${role}`);
    }
    for (const forbidden of ['platform_admin', 'super_admin', 'org_admin', 'service']) {
      assert.equal(
        clause.includes(`'${forbidden}'`),
        false,
        `the CHECK admits ${forbidden} as provenance`,
      );
    }
  });

  it('the rollback restores both policies and drops the predicate after them', () => {
    assert.match(rollback, /CREATE POLICY memberships_insert_admin/);
    assert.match(rollback, /CREATE POLICY memberships_update_admin/);
    assert.match(rollback, /DROP FUNCTION IF EXISTS cortex\.team_role_matches_role/);
    assert.ok(
      rollback.indexOf('CREATE POLICY memberships_update_admin') <
        rollback.indexOf('DROP FUNCTION IF EXISTS cortex.team_role_matches_role'),
      'the rollback drops the predicate while a policy still references it',
    );
  });

  it('the rollback touches no membership row', () => {
    assert.equal(/UPDATE\s+public\.organization_memberships/i.test(rollback), false);
    assert.equal(/DELETE\s+FROM\s+public\.organization_memberships/i.test(rollback), false);
    assert.equal(/INSERT\s+INTO\s+public\.organization_memberships/i.test(rollback), false);
  });

  it('the rollback does not drop the column the previous migration owns', () => {
    // 20260821120000 did not create `team_role`; rolling it back must not take
    // it away, or the runtime loses provenance it is still reading.
    assert.equal(/DROP\s+COLUMN[^;]*team_role/i.test(rollback), false);
  });
});
