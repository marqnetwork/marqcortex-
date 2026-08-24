/**
 * AI-01 Batch 4A remediation, round 3 — static validation of the authority
 * provenance migration and its rollback. No database required.
 *
 * The same division of labour as the three migrations before it: a source scan
 * proves ABSENCE well and behaviour badly. What is pinned here is what these
 * files must never contain — a write of `platform_role`, a backfill that reads
 * `raw_app_meta_data`, a literal user id, a grant to an API role, a rollback
 * that revokes memberships — and every positive claim is settled against a real
 * PostgreSQL by `scripts/membership-bootstrap-scenarios.mjs`
 * (`tests/database/harness/89_provenance_drift_fixture.sql`,
 * `90_assert_authority_provenance.sql` and `91_assert_provenance_rollback.sql`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ORGANIZATION_ROLE_KEYS,
  TEAM_ROLES,
} from '../../supabase/functions/server/teamAuthorization.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = '20260820120000_marq_authority_provenance.sql';
const ROLLBACK = '20260820120000_rollback_authority_provenance.sql';

const sql = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollbackSql = readFileSync(
  join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK),
  'utf8',
);

/** The file with SQL comments stripped — a rule is code, not prose. */
const strip = (text: string) => text.replace(/^\s*--.*$/gm, ' ');
const code = strip(sql);
const rollback = strip(rollbackSql);

describe('authority provenance migration (static)', () => {
  it('runs in a single transaction, and so does its rollback', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
    assert.match(rollback, /^\s*BEGIN;/m);
    assert.match(rollback, /^\s*COMMIT;\s*$/m);
  });

  it('contains no literal UUID', () => {
    // A user id in a migration is an invented user. Every subject these
    // functions act on arrives as a parameter at run time.
    for (const [label, text] of [['migration', code], ['rollback', rollback]] as const) {
      assert.equal(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text),
        false,
        `${label} names a literal user id`,
      );
    }
  });

  it('never writes platform_role, anywhere', () => {
    // The whole finding, at the SQL layer: nothing here may mint a platform
    // operator, and `stamp_team_roster` merges rather than replaces so an
    // existing one survives a stamp.
    for (const [label, text] of [['migration', code], ['rollback', rollback]] as const) {
      assert.equal(
        /(SET|,|\|\|)[^;]*'platform_role'/i.test(text.replace(/->>?\s*'platform_role'/g, '')),
        false,
        `${label} appears to write platform_role`,
      );
      assert.equal(
        /jsonb_build_object\([^)]*'platform_role'/i.test(text),
        false,
        `${label} builds a metadata object naming platform_role`,
      );
    }
  });

  it('refuses to assign the platform_admin organization role', () => {
    assert.match(code, /refusing to assign the organization role/i);
    assert.match(code, /v_role_key\s*=\s*'platform_admin'/);
  });

  // -----------------------------------------------------------------------
  // THE BACKFILL
  // -----------------------------------------------------------------------

  it('backfills from executed decisions and never from app_metadata', () => {
    const backfill = code.slice(
      code.indexOf('backfilled team_role') > 0
        ? code.lastIndexOf('DO $$', code.indexOf('backfilled team_role'))
        : 0,
      code.indexOf('backfilled team_role'),
    );
    assert.ok(backfill.length > 0, 'the backfill block was not found');

    assert.match(backfill, /cortex\.membership_lifecycle_log/);
    assert.match(backfill, /cortex\.team_roster_stamp_log/);
    assert.equal(
      /raw_app_meta_data/.test(backfill),
      false,
      'the backfill reads the mutable metadata bag — a half-applied promotion ' +
        'standing at migration time would become permanent provenance',
    );
  });

  it('clamps every backfilled value to the band its own key allows', () => {
    assert.match(code, /band_floor/);
    assert.match(code, /band_ceiling/);
    assert.match(code, /WHEN\s+k\.observed_rank\s*>\s*k\.ceiling_rank\s+THEN\s+k\.band_ceiling/);
    assert.match(code, /WHEN\s+k\.observed_rank\s*<\s*k\.floor_rank\s+THEN\s+k\.band_floor/);
  });

  it('touches only the three organization role keys the team ladder maps to', () => {
    for (const key of ORGANIZATION_ROLE_KEYS) {
      assert.ok(code.includes(`'${key}'`), `the migration never mentions ${key}`);
    }
    assert.match(code, /r\.key IN \('org_admin', 'team_member', 'team_viewer'\)/);
  });

  // -----------------------------------------------------------------------
  // THE NORMALIZER AND THE CONSTRAINT
  // -----------------------------------------------------------------------

  it('names exactly the console team roles in the normalizer and the CHECK', () => {
    const ladder = TEAM_ROLES.map((role) => `'${role}'`).join(', ');
    assert.ok(
      code.includes(`ARRAY[${ladder}]`),
      'the normalizer does not name exactly TEAM_ROLES, in order',
    );
    assert.ok(
      code.includes(`team_role IN (${ladder})`),
      'the CHECK constraint does not name exactly TEAM_ROLES, in order',
    );
  });

  it('resolves an unrecognised role DOWN to viewer, never up', () => {
    assert.match(code, /ELSE 'viewer'/);
    // The self-check the migration runs at apply time.
    assert.match(code, /normalize_team_role\('platform_admin'\)\s*<>\s*'viewer'/);
    assert.match(code, /normalize_team_role\('super_admin'\)\s*<>\s*'viewer'/);
  });

  it('leaves the provenance column nullable', () => {
    // Every row written before this migration has none, and "none" is a meaning
    // the server understands — it reads the key at its weakest.
    assert.equal(
      /ADD COLUMN IF NOT EXISTS team_role TEXT[^;]*NOT NULL/i.test(code),
      false,
      'the column was made NOT NULL, which would fail on an existing deployment',
    );
    assert.match(code, /team_role IS NULL\s*\n?\s*OR team_role IN/);
  });

  // -----------------------------------------------------------------------
  // THE ROSTER STAMP
  // -----------------------------------------------------------------------

  it('moves both halves of a stamp through the one authoritative write', () => {
    assert.match(code, /public\.marq_sync_team_membership\(v_entry\.user_id, v_entry\.team_role/);
    // And it accounts for every entry rather than applying part of a roster.
    assert.match(code, /rolling back rather than leaving the two authority systems disagreeing/);
  });

  it('keeps every refusal the reviewed stamp already made', () => {
    for (const refusal of [
      'an artifact identifier is required',
      'the roster is empty',
      'above the reviewed maximum',
      'The list that was reviewed is the list that is applied',
      'malformed roster entr',
      'role(s) the console cannot issue',
      'duplicate roster entr',
      'match no live auth user',
      'hold an active membership in another organization',
      'rolling back rather than applying part of a reviewed roster',
    ]) {
      assert.ok(sql.includes(refusal), `the stamp lost the refusal: ${refusal}`);
    }
  });

  it('still defaults to a dry run', () => {
    assert.match(code, /p_dry_run\s+BOOLEAN DEFAULT TRUE/);
    assert.match(code, /IF p_dry_run THEN/);
  });

  it('the dry run writes nothing — the membership sync is after the dry-run return', () => {
    const body = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION cortex.stamp_team_roster'));
    assert.ok(
      body.indexOf('IF p_dry_run THEN') < body.indexOf('public.marq_sync_team_membership'),
      'the membership sync runs before the dry-run return',
    );
  });

  // -----------------------------------------------------------------------
  // GRANTS AND THE DRIFT REPORT
  // -----------------------------------------------------------------------

  it('grants execute to service_role only, never to an API role', () => {
    for (const role of ['anon', 'authenticated', 'PUBLIC']) {
      assert.equal(
        new RegExp(`GRANT EXECUTE[^;]*TO\\s+${role}\\b`, 'i').test(code),
        false,
        `execute was granted to ${role}`,
      );
    }
    assert.match(code, /GRANT EXECUTE ON FUNCTION cortex\.normalize_team_role\(TEXT\) TO service_role/);
    assert.match(code, /GRANT EXECUTE ON FUNCTION cortex\.team_authority_drift\(\) TO service_role/);
  });

  it('the drift report is read-only', () => {
    const report = code.slice(
      code.indexOf('CREATE OR REPLACE FUNCTION cortex.team_authority_drift'),
      code.indexOf('COMMENT ON FUNCTION cortex.team_authority_drift'),
    );
    assert.ok(report.length > 0);
    assert.match(report, /\bSTABLE\b/);
    for (const write of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      assert.equal(new RegExp(`\\b${write}\\b`).test(report), false, `the report performs a ${write}`);
    }
  });

  it('every SECURITY DEFINER function pins an empty search_path', () => {
    const definers = code.split('SECURITY DEFINER').slice(1);
    assert.ok(definers.length > 0, 'no SECURITY DEFINER function was found');
    for (const body of definers) {
      assert.match(body.slice(0, 200), /SET search_path = ''/);
    }
  });

  // -----------------------------------------------------------------------
  // THE ROLLBACK
  // -----------------------------------------------------------------------

  it('the rollback removes what the migration added', () => {
    assert.match(rollback, /DROP COLUMN IF EXISTS team_role/);
    assert.match(rollback, /DROP FUNCTION IF EXISTS cortex\.team_authority_drift\(\)/);
    assert.match(rollback, /DROP FUNCTION IF EXISTS cortex\.normalize_team_role\(TEXT\)/);
    assert.match(rollback, /DROP CONSTRAINT IF EXISTS organization_memberships_team_role_check/);
  });

  it('the rollback never revokes a membership or edits app_metadata authority', () => {
    assert.equal(
      /DELETE\s+FROM\s+public\.organization_memberships/i.test(rollback),
      false,
      'the rollback deletes memberships',
    );
    assert.equal(
      /UPDATE\s+public\.organization_memberships[^;]*deleted_at/i.test(rollback),
      false,
      'the rollback soft-deletes memberships',
    );
    assert.equal(
      /UPDATE\s+auth\.users[^;]*raw_app_meta_data/i.test(
        // The restored `stamp_team_roster` body legitimately stamps; that is the
        // function being restored, not the rollback acting.
        rollback.slice(rollback.indexOf('3. Remove what the migration added') >= 0
          ? rollback.indexOf('DROP FUNCTION IF EXISTS cortex.team_authority_drift')
          : rollback.length),
      ),
      false,
      'the rollback rewrites app_metadata',
    );
  });

  it('the rollback restores the previous membership write verbatim in contract', () => {
    assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.marq_sync_team_membership/);
    assert.match(rollback, /CREATE OR REPLACE FUNCTION cortex\.stamp_team_roster/);
    // And the restored write still refuses to mint platform administration.
    assert.match(rollback, /refusing to assign the organization role/i);
  });

  it('asserts its own post-conditions rather than hoping', () => {
    assert.match(code, /organization_memberships\.team_role was not created/);
    assert.match(code, /carry a team_role that does not map to their own role key/);
    assert.match(rollback, /organization_memberships\.team_role still exists/);
  });
});
