/**
 * AI-01 Batch 4A — static validation of the MARQ membership bootstrap migration.
 * No database required.
 *
 * The migration writes rows into the table that decides who gets a tenant, so
 * the properties worth pinning are mostly NEGATIVE ones: what it must never do.
 * A migration that quietly invents a user id, revives a deleted membership or
 * mints a platform admin would pass any "did it insert something" check.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = '20260818120000_marq_team_membership_bootstrap.sql';
const ROLLBACK = '20260818120000_rollback_membership_bootstrap.sql';

const sql = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollback = readFileSync(join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK), 'utf8');

/** The migration with SQL comments stripped — a rule is code, not prose. */
const code = sql.replace(/^\s*--.*$/gm, ' ');

describe('membership bootstrap migration (static)', () => {
  it('runs in a single transaction', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
  });

  it('inserts into organization_memberships and nothing else', () => {
    const inserts = code.match(/INSERT\s+INTO\s+([a-z_.]+)/gi) ?? [];
    assert.deepEqual(
      [...new Set(inserts.map((s) => s.replace(/INSERT\s+INTO\s+/i, '').toLowerCase()))],
      ['public.organization_memberships'],
    );
  });

  it('derives user ids from auth.users rather than inventing them', () => {
    assert.match(code, /FROM\s+auth\.users/i);
    // No literal UUID anywhere: a hardcoded id in a bootstrap is an invented
    // user by definition, whether or not it happens to exist today.
    const literalUuids = code.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    assert.deepEqual(literalUuids, [], `Literal UUIDs in migration: ${literalUuids.join(', ')}`);
    // And no generated one either.
    assert.doesNotMatch(code, /gen_random_uuid\s*\(\s*\)/i);
  });

  it('never writes to the auth schema', () => {
    assert.doesNotMatch(code, /INSERT\s+INTO\s+auth\./i);
    assert.doesNotMatch(code, /UPDATE\s+auth\./i);
    assert.doesNotMatch(code, /DELETE\s+FROM\s+auth\./i);
    assert.doesNotMatch(code, /ALTER\s+TABLE\s+auth\./i);
  });

  it('creates no organization and no fallback tenant', () => {
    assert.doesNotMatch(code, /INSERT\s+INTO\s+public\.organizations/i);
    // A TEMP table scoped to the transaction is fine; a permanent one is not.
    assert.doesNotMatch(code, /CREATE\s+(?:UNLOGGED\s+)?TABLE\s/i);
    assert.doesNotMatch(sql, /AI_ALLOW_DEFAULT_ORGANIZATION\s*=\s*true/i);
  });

  it('targets only the seeded MARQ organization', () => {
    assert.match(code, /slug\s*=\s*'marq'/);
    assert.match(code, /deleted_at\s+IS\s+NULL/i);
  });

  it('is a no-op when the MARQ organization is absent', () => {
    assert.match(code, /IF\s+v_org_id\s+IS\s+NULL\s+THEN[\s\S]*?RETURN;/i);
  });

  it('selects only eligible team users', () => {
    assert.match(code, /raw_user_meta_data\s*->>\s*'role'[^\n]*=\s*'team'/i);
  });

  it('excludes deleted and banned auth users', () => {
    assert.match(code, /deleted_at'\)\s+IS\s+NULL/i);
    assert.match(code, /banned_until/i);
  });

  it('applies the documented teamRole mapping', () => {
    const expected: ReadonlyArray<[string, string]> = [
      ['owner', 'org_admin'],
      ['admin', 'org_admin'],
      ['manager', 'org_admin'],
      ['consultant', 'team_member'],
      ['analyst', 'team_member'],
      ['reviewer', 'team_member'],
      ['viewer', 'team_viewer'],
    ];
    for (const [teamRole, roleKey] of expected) {
      assert.match(
        code,
        new RegExp(`WHEN\\s+'${teamRole}'\\s+THEN\\s+'${roleKey}'`, 'i'),
        `teamRole '${teamRole}' must map to '${roleKey}'`,
      );
    }
    // An unmapped or missing role falls to the least privileged key.
    assert.match(code, /ELSE\s+'team_viewer'/i);
  });

  it('never assigns platform_admin', () => {
    assert.doesNotMatch(code, /THEN\s+'platform_admin'/i);
    assert.doesNotMatch(code, /r\.key\s*=\s*'platform_admin'/i);
  });

  it('resolves roles from the seeded system catalog only', () => {
    assert.match(code, /r\.is_system\s*=\s*true/i);
    assert.match(code, /r\.organization_id\s+IS\s+NULL/i);
  });

  it('creates memberships as active', () => {
    assert.match(code, /'active'/);
  });

  it('is idempotent: guarded by the same predicate as the unique index', () => {
    // organization_memberships_active_uidx is (organization_id, user_id)
    // WHERE deleted_at IS NULL. The guard must match it or a re-run raises.
    const guard = code.match(/WHERE\s+NOT\s+EXISTS\s*\([\s\S]*?\)\s*;/i)?.[0] ?? '';
    assert.match(guard, /m\.organization_id\s*=\s*v_org_id/i);
    assert.match(guard, /m\.user_id\s*=\s*c\.user_id/i);
    assert.match(guard, /m\.deleted_at\s+IS\s+NULL/i);
  });

  it('never updates or deletes an existing membership', () => {
    // A membership somebody suspended, re-roled or removed is theirs, not the
    // migration's to reverse.
    assert.doesNotMatch(code, /UPDATE\s+public\.organization_memberships/i);
    assert.doesNotMatch(code, /DELETE\s+FROM\s+public\.organization_memberships/i);
    assert.doesNotMatch(code, /ON\s+CONFLICT[\s\S]{0,40}DO\s+UPDATE/i);
  });

  it('asserts the no-duplicate post-condition rather than assuming it', () => {
    assert.match(code, /HAVING\s+COUNT\(\*\)\s*>\s*1/i);
    assert.match(code, /RAISE\s+EXCEPTION[^\n]*duplicate/i);
  });
});

describe('membership bootstrap rollback (static)', () => {
  it('soft-deletes rather than deleting', () => {
    assert.match(rollback, /SET\s+deleted_at\s*=\s*now\(\)/i);
    assert.doesNotMatch(rollback, /DELETE\s+FROM/i);
  });

  it('touches only untouched bootstrap rows in the MARQ organization', () => {
    assert.match(rollback, /o\.slug\s*=\s*'marq'/i);
    assert.match(rollback, /m\.status\s*=\s*'active'/i);
    assert.match(rollback, /m\.updated_at\s*=\s*m\.created_at/i);
    assert.match(rollback, /r\.key\s*<>\s*'platform_admin'/i);
  });
});
