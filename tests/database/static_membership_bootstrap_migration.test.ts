/**
 * AI-01 Batch 4A — static validation of the MARQ membership bootstrap migration.
 * No database required.
 *
 * WHAT THIS SUITE IS FOR, AND WHAT IT IS NOT FOR
 *
 * A source scan is a weak proof of behaviour and a strong proof of ABSENCE. The
 * properties worth pinning here are the negative ones — what the migration must
 * never do — because a migration that quietly invents a user id, revives a
 * deleted membership or mints a platform admin would pass any "did it insert
 * something" check.
 *
 * Everything positive is proved against a real PostgreSQL by
 * `scripts/membership-bootstrap-scenarios.mjs`: that eligible users are admitted
 * and ineligible ones are not, that a re-run inserts nothing, that the rollback
 * spares memberships it did not create, and that concurrent runs neither
 * duplicate nor raise. The review's M4 finding was that this file was carrying a
 * claim only that runner can make. It no longer tries to.
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
const rollbackSql = readFileSync(
  join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK),
  'utf8',
);

/** The file with SQL comments stripped — a rule is code, not prose. */
const strip = (text: string) => text.replace(/^\s*--.*$/gm, ' ');
const code = strip(sql);
const rollback = strip(rollbackSql);

describe('membership bootstrap migration (static)', () => {
  it('runs in a single transaction', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
  });

  it('writes to the membership table and its own provenance ledger, and nothing else', () => {
    const inserts = code.match(/INSERT\s+INTO\s+([a-z_.]+)/gi) ?? [];
    assert.deepEqual(
      [...new Set(inserts.map((s) => s.replace(/INSERT\s+INTO\s+/i, '').toLowerCase()))].sort(),
      ['cortex.membership_bootstrap_log', 'public.organization_memberships'],
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
    assert.doesNotMatch(sql, /AI_ALLOW_DEFAULT_ORGANIZATION\s*=\s*true/i);
  });

  it('creates no table in the product schema', () => {
    // The provenance ledger is internal and lives in `cortex`. A permanent
    // table in `public` would be a new product surface, and the tenancy model
    // gains no column for a rollback's convenience.
    const tables = code.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_.]+)/gi) ?? [];
    for (const statement of tables) {
      assert.match(
        statement,
        /cortex\./i,
        `the migration creates ${statement} outside the internal schema`,
      );
    }
  });

  it('keeps the provenance ledger unreachable through the API', () => {
    // `cortex` is exposed to PostgREST (supabase/config.toml). A ledger of who
    // was bootstrapped into which role is not something to serve to a browser.
    assert.match(code, /ALTER\s+TABLE\s+cortex\.membership_bootstrap_log\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    assert.match(code, /REVOKE\s+ALL\s+ON\s+cortex\.membership_bootstrap_log\s+FROM\s+PUBLIC/i);
    assert.doesNotMatch(code, /GRANT[^;]*cortex\.membership_bootstrap_log[^;]*TO\s+(anon|authenticated)/i);
    assert.doesNotMatch(code, /CREATE\s+POLICY[^;]*membership_bootstrap_log/i);
  });

  it('targets only the seeded MARQ organization', () => {
    assert.match(code, /slug\s*=\s*'marq'/);
    assert.match(code, /deleted_at\s+IS\s+NULL/i);
  });

  it('is a no-op when the MARQ organization is absent', () => {
    assert.match(code, /IF\s+v_org_id\s+IS\s+NULL\s+THEN[\s\S]*?RETURN;/i);
  });

  // -------------------------------------------------------------------------
  // M2 — eligibility comes from the metadata bag a user cannot write.
  // -------------------------------------------------------------------------
  it('reads eligibility from app metadata', () => {
    assert.match(code, /raw_app_meta_data\s*->>\s*'marq_team'\s*\)?\s*=\s*'true'/i);
  });

  it('never reads user metadata, for eligibility or for privilege', () => {
    // GoTrue serves PUT /auth/v1/user, so `raw_user_meta_data` is writable by
    // the account holder. A single read of it here is a self-service membership.
    assert.doesNotMatch(code, /raw_user_meta_data/i);
  });

  it('takes the role from app metadata too', () => {
    assert.match(code, /raw_app_meta_data\s*->>\s*'team_role'/i);
  });

  it('excludes deleted and banned auth users', () => {
    assert.match(code, /deleted_at'\)\s+IS\s+NULL/i);
    assert.match(code, /banned_until/i);
  });

  it('never assigns platform_admin', () => {
    assert.doesNotMatch(code, /THEN\s+'platform_admin'/i);
    assert.doesNotMatch(code, /r\.key\s*=\s*'platform_admin'/i);
  });

  // -------------------------------------------------------------------------
  // L1 — the role join can match at most one row.
  // -------------------------------------------------------------------------
  it('resolves roles from one scope of the seeded system catalog', () => {
    // `roles_scope_key_system_uidx` is unique on (scope, key) among rows with
    // organization_id IS NULL — so `key` alone is not unique, and a future
    // system role at scope 'organization' under the same key would multiply the
    // INSERT.
    assert.match(code, /r\.scope\s*=\s*'platform'/i);
    assert.match(code, /r\.is_system\s*=\s*true/i);
    assert.match(code, /r\.organization_id\s+IS\s+NULL/i);
  });

  it('creates memberships as active', () => {
    assert.match(code, /'active'/);
  });

  // -------------------------------------------------------------------------
  // H2 — any membership history blocks re-admission.
  // -------------------------------------------------------------------------
  it('is guarded on ANY existing membership row, not only an undeleted one', () => {
    const guard = code.match(/WHERE\s+NOT\s+EXISTS\s*\([\s\S]*?\)\s*\n/i)?.[0] ?? '';
    assert.match(guard, /m\.organization_id\s*=\s*v_org_id/i);
    assert.match(guard, /m\.user_id\s*=\s*c\.user_id/i);
    // The clause the review asked to be removed: with it, a soft-deleted member
    // is re-admitted alongside their tombstone.
    assert.doesNotMatch(guard, /m\.deleted_at\s+IS\s+NULL/i);
  });

  it('never updates, deletes or revives an existing membership', () => {
    // A membership somebody suspended, re-roled or removed is theirs, not the
    // migration's to reverse.
    assert.doesNotMatch(code, /UPDATE\s+public\.organization_memberships/i);
    assert.doesNotMatch(code, /DELETE\s+FROM\s+public\.organization_memberships/i);
    assert.doesNotMatch(code, /ON\s+CONFLICT[\s\S]{0,80}DO\s+UPDATE/i);
  });

  // -------------------------------------------------------------------------
  // L6 — concurrency.
  // -------------------------------------------------------------------------
  it('serialises concurrent runs before it creates anything', () => {
    const lockAt = code.search(/pg_advisory_xact_lock/i);
    const createAt = code.search(/CREATE\s+TABLE/i);
    assert.notEqual(lockAt, -1, 'the migration must take an advisory lock');
    assert.notEqual(createAt, -1, 'the migration must create the ledger');
    assert.ok(
      lockAt < createAt,
      'the lock must be taken before CREATE TABLE IF NOT EXISTS, which is not atomic against a concurrent creator',
    );
  });

  it('absorbs a lost race rather than raising', () => {
    assert.match(code, /ON\s+CONFLICT\s*\(\s*organization_id\s*,\s*user_id\s*\)\s*WHERE\s+deleted_at\s+IS\s+NULL\s+DO\s+NOTHING/i);
  });

  it('asserts the no-duplicate post-condition rather than assuming it', () => {
    assert.match(code, /HAVING\s+COUNT\(\*\)\s*>\s*1/i);
    assert.match(code, /RAISE\s+EXCEPTION[^\n]*duplicate/i);
  });

  // -------------------------------------------------------------------------
  // H1 — provenance is recorded, not inferred.
  // -------------------------------------------------------------------------
  it('records every row it creates, with the state it created it in', () => {
    assert.match(code, /RETURNING\s+id\s*,\s*organization_id\s*,\s*user_id\s*,\s*role_id\s*,\s*status\s*,\s*updated_at/i);
    assert.match(code, /INSERT\s+INTO\s+cortex\.membership_bootstrap_log/i);
  });
});

describe('membership bootstrap rollback (static)', () => {
  it('soft-deletes rather than deleting', () => {
    assert.match(rollback, /SET\s+deleted_at\s*=\s*now\(\)/i);
    assert.doesNotMatch(rollback, /DELETE\s+FROM/i);
  });

  it('identifies its rows from the ledger, never from a timestamp heuristic', () => {
    // H1. `updated_at = created_at` is true of every membership nobody has
    // edited yet, whoever created it — so the old predicate would have revoked
    // access an administrator granted minutes earlier.
    assert.match(rollback, /cortex\.membership_bootstrap_log/i);
    assert.match(rollback, /m\.id\s*=\s*l\.membership_id/i);
    assert.doesNotMatch(rollback, /m\.updated_at\s*=\s*m\.created_at/i);
    assert.doesNotMatch(rollback, /updated_at\s*=\s*created_at/i);
  });

  it('reverts only a row still in the state the bootstrap left it in', () => {
    assert.match(rollback, /m\.role_id\s*=\s*l\.role_id/i);
    assert.match(rollback, /m\.status\s*=\s*l\.status/i);
    assert.match(rollback, /m\.updated_at\s*=\s*l\.row_updated_at/i);
  });

  it('never overwrites a membership somebody modified', () => {
    // Skipping is the whole design. Writing `role_id` or `status` back to what
    // the bootstrap once put there would destroy an administrator's change
    // under the banner of undoing a migration.
    //
    // Read the assignment list only — everything between `SET` and the clause
    // that ends it. The WHERE clauses below legitimately mention `role_id` and
    // `status` (that is how a modified row is recognised), so a scan over the
    // whole statement would be a scan over the comparison it depends on.
    const assignments = [...rollback.matchAll(/\bSET\b([\s\S]*?)(?=\n\s*(?:FROM|WHERE)\b)/gi)]
      .map((match) => match[1]);
    assert.ok(assignments.length > 0, 'the rollback must contain an UPDATE');
    for (const assignment of assignments) {
      assert.doesNotMatch(assignment, /\brole_id\s*=/i, `rollback assigns role_id: ${assignment.trim()}`);
      assert.doesNotMatch(assignment, /\bstatus\s*=/i, `rollback assigns status: ${assignment.trim()}`);
    }
  });

  it('cannot revoke platform administration', () => {
    assert.match(rollback, /r\.key\s*<>\s*'platform_admin'/i);
  });

  it('is a no-op where the bootstrap never ran', () => {
    assert.match(rollback, /to_regclass\('cortex\.membership_bootstrap_log'\)\s+IS\s+NULL/i);
  });

  it('marks what it reverted, so a second run is a no-op', () => {
    assert.match(rollback, /rolled_back_at\s*=\s*now\(\)/i);
    assert.match(rollback, /l\.rolled_back_at\s+IS\s+NULL/i);
  });
});
