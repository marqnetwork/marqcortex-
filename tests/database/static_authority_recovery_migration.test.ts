/**
 * AI-01 Batch 4A remediation, round 2 — static validation of the authority
 * recovery migration and its rollback. No database required.
 *
 * Same division of labour as the two migrations before it: a source scan proves
 * ABSENCE well and behaviour badly. What is pinned here is what these functions
 * must never contain — a write of `platform_role`, a bulk release, a grant to
 * an API role, a rollback that drops the audit columns — and every positive
 * claim is settled against a real PostgreSQL by
 * `scripts/membership-bootstrap-scenarios.mjs`
 * (`tests/database/harness/85_assert_authority_recovery.sql` and
 * `86_assert_recovery_rollback.sql`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MEMBERSHIP_ACTIONS } from '../../supabase/functions/server/membershipLifecycle.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = '20260819120000_marq_authority_recovery.sql';
const ROLLBACK = '20260819120000_rollback_authority_recovery.sql';

const sql = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollbackSql = readFileSync(
  join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK),
  'utf8',
);

/** The file with SQL comments stripped — a rule is code, not prose. */
const strip = (text: string) => text.replace(/^\s*--.*$/gm, ' ');
const code = strip(sql);
const rollback = strip(rollbackSql);

describe('authority recovery migration (static)', () => {
  it('runs in a single transaction', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
  });

  it('contains no literal UUID', () => {
    // A user id in a migration is an invented user. Every subject these
    // functions act on arrives as a parameter at run time.
    assert.equal(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(code),
      false,
    );
  });

  it('adds its columns idempotently', () => {
    assert.match(code, /ADD COLUMN IF NOT EXISTS\s+released_reason/);
    assert.match(code, /ADD COLUMN IF NOT EXISTS\s+released_app_metadata/);
  });

  // ── L4 ──────────────────────────────────────────────────────────────────

  it('distinguishes an insert from a takeover before naming the action', () => {
    assert.match(code, /\(xmax = 0\)/);
    assert.match(code, /CASE WHEN v_inserted THEN 'created' ELSE 'reconciled' END/);
  });

  it('emits only actions the console can understand', () => {
    const emitted = [...code.matchAll(/v_action\s*:=\s*(?:CASE WHEN v_inserted THEN )?'([a-z_]+)'(?: ELSE '([a-z_]+)')?/g)]
      .flatMap((match) => [match[1], match[2]])
      .filter((value): value is string => typeof value === 'string');
    assert.ok(emitted.length >= 4, `expected at least four action assignments, found ${emitted.length}`);
    for (const action of emitted) {
      assert.ok(
        MEMBERSHIP_ACTIONS.has(action),
        `the migration can emit '${action}', which MembershipAction does not carry`,
      );
    }
  });

  it('never emits reactivated, which no arm can produce', () => {
    assert.equal(/'reactivated'/.test(code), false);
    assert.equal(MEMBERSHIP_ACTIONS.has('reactivated'), false);
  });

  it('keeps the membership write refusing to assign platform_admin', () => {
    // Carried forward from 20260818130000. A CREATE OR REPLACE that dropped the
    // assertion would be a silent weakening of the function it replaces.
    assert.match(code, /refusing to assign the organization role/);
    assert.match(code, /v_role_key = 'platform_admin'/);
  });

  it('keeps the advisory lock and the live-user check', () => {
    assert.match(code, /pg_advisory_xact_lock\(hashtext\('cortex\.membership_bootstrap'\)/);
    assert.match(code, /is not a live auth user/);
  });

  // ── L1 ──────────────────────────────────────────────────────────────────

  it('releases one named account at a time, never a set', () => {
    // A bulk release is the hand-written UPDATE this whole mechanism replaced.
    assert.match(code, /cortex\.release_team_stamp\(\s*p_artifact TEXT,\s*p_user_id\s+UUID,/);
    assert.equal(/DELETE FROM auth\.users/.test(code), false);
  });

  it('requires a recorded reason', () => {
    assert.match(code, /length\(trim\(p_reason\)\) < 8/);
    assert.match(code, /released_reason\s+=\s+trim\(p_reason\)/);
  });

  it('defaults to a dry run', () => {
    for (const signature of [
      /cortex\.release_team_stamp\([\s\S]*?p_dry_run\s+BOOLEAN DEFAULT TRUE/,
    ]) {
      assert.match(code, signature);
    }
  });

  it('removes only the two keys the roster artifact owns', () => {
    assert.match(code, /- 'marq_team' - 'team_role'/);
    // It must NOT restore the recorded bag over a later edit: that is what
    // would destroy `platform_role` and anything else added since.
    assert.equal(/raw_app_meta_data\s*=\s*[^;]*previous_app_metadata/.test(code), false);
  });

  it('writes no platform role anywhere', () => {
    assert.equal(/jsonb_build_object\([^)]*platform_role/.test(code), false);
    assert.equal(/'platform_role'\s*,\s*'admin'/.test(code), false);
    assert.equal(/SET raw_app_meta_data[^;]*\|\|[^;]*platform_role/.test(code), false);
  });

  it('refuses an account that has not drifted', () => {
    assert.match(code, /IS NOT DISTINCT FROM v_stamped/);
    assert.match(code, /unstamp_team_roster/);
  });

  // ── L2 / L3 ─────────────────────────────────────────────────────────────

  it('detects orphans without acting on them', () => {
    assert.match(code, /CREATE OR REPLACE FUNCTION cortex\.orphaned_team_accounts\(\)/);
    // Detection is read-only: STABLE, LANGUAGE sql, no write of any kind.
    const body = code.slice(code.indexOf('orphaned_team_accounts'));
    assert.equal(/UPDATE auth\.users|DELETE FROM|INSERT INTO/.test(body), false);
  });

  it('reports a ban rather than acting on one', () => {
    assert.match(code, /banned_until/);
    assert.equal(/SET banned_until/.test(code), false);
    assert.equal(/suspend|unban/i.test(code.replace(/suspended/g, '')), false);
  });

  it('scopes orphan detection to the live MARQ organization', () => {
    assert.match(code, /o\.slug = 'marq'/);
    assert.match(code, /o\.deleted_at IS NULL/);
    assert.match(code, /m\.status = 'active'/);
  });

  // ── privilege ───────────────────────────────────────────────────────────

  it('grants the auth-touching functions to nobody', () => {
    for (const fn of ['release_team_stamp', 'team_stamp_drift', 'orphaned_team_accounts']) {
      assert.match(code, new RegExp(`REVOKE ALL ON FUNCTION cortex\\.${fn}`));
    }
    assert.equal(/GRANT EXECUTE ON FUNCTION cortex\./.test(code), false);
  });

  it('leaves the two membership functions granted to service_role only', () => {
    assert.equal(/GRANT[^;]*TO\s+(anon|authenticated)/.test(code), false);
  });

  it('pins search_path on every function it defines', () => {
    const definitions = code.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
    const pinned = code.match(/SET search_path = ''/g) ?? [];
    assert.equal(pinned.length, definitions.length, 'every function must pin search_path');
  });
});

describe('authority recovery rollback (static)', () => {
  it('runs in a single transaction', () => {
    assert.match(rollback, /^\s*BEGIN;/m);
    assert.match(rollback, /^\s*COMMIT;\s*$/m);
  });

  it('drops exactly the three functions the migration added', () => {
    for (const fn of ['release_team_stamp', 'team_stamp_drift', 'orphaned_team_accounts']) {
      assert.match(rollback, new RegExp(`DROP FUNCTION IF EXISTS cortex\\.${fn}`));
    }
  });

  it('does not drop the release provenance columns', () => {
    // They record why an operator force-removed somebody's team status.
    // Dropping them to undo a DDL change destroys the audit record the
    // migration exists to create.
    assert.equal(/^\s*ALTER TABLE cortex\.team_roster_stamp_log/m.test(rollback), false);
    assert.equal(/^\s*DROP COLUMN/m.test(rollback), false);
  });

  it('restores a working membership write, not a stub', () => {
    assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.marq_sync_team_membership/);
    assert.match(rollback, /pg_advisory_xact_lock/);
    assert.match(rollback, /refusing to assign the organization role/);
    assert.equal(/'reconciled'/.test(rollback), false);
  });

  it('touches no membership row and no auth record WHEN IT RUNS', () => {
    // The function bodies are excluded: the restored
    // `marq_sync_team_membership` naturally contains an UPDATE of
    // `organization_memberships`, and defining a function is not running it.
    // What matters is what the rollback SCRIPT executes.
    const executed = rollback.replace(/AS \$\$[\s\S]*?\$\$;/g, ' ');
    assert.equal(/UPDATE auth\.users/.test(executed), false);
    assert.equal(/DELETE FROM/.test(executed), false);
    assert.equal(/UPDATE public\.organization_memberships/.test(executed), false);
    assert.equal(/INSERT INTO/.test(executed), false);
  });
});
