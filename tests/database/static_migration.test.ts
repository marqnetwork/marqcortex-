/**
 * Static migration validation — no database required.
 * MCV2-S4-IMPLEMENT-001
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readMigration(name: string): string {
  return readFileSync(
    join(root, 'supabase', 'migrations', name),
    'utf8',
  );
}

describe('MCV2-S4 tenancy migrations (static)', () => {
  const foundation = readMigration('20260711050000_cortex_tenancy_foundation.sql');
  const rls = readMigration('20260711050001_cortex_tenancy_rls_and_seed.sql');

  it('creates all six foundation tables', () => {
    for (const table of [
      'organizations',
      'roles',
      'permissions',
      'role_permissions',
      'organization_memberships',
      'organization_settings',
    ]) {
      assert.match(foundation, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    }
  });

  it('does not modify kv_store table', () => {
    assert.doesNotMatch(foundation, /ALTER TABLE.*kv_store/i);
    assert.doesNotMatch(foundation, /DROP TABLE.*kv_store/i);
    assert.doesNotMatch(rls, /ALTER TABLE.*kv_store/i);
    assert.doesNotMatch(rls, /DROP TABLE.*kv_store/i);
  });

  it('does not modify auth schema', () => {
    assert.doesNotMatch(foundation, /ALTER TABLE auth\./);
    assert.doesNotMatch(rls, /ALTER TABLE auth\./);
  });

  it('defines RLS helper functions in cortex schema', () => {
    for (const fn of [
      'cortex.current_user_id',
      'cortex.is_platform_admin',
      'cortex.is_organization_member',
      'cortex.is_organization_admin',
      'cortex.has_permission',
    ]) {
      assert.match(rls, new RegExp(`FUNCTION ${fn.replace('.', '\\.')}`));
    }
  });

  it('enables RLS on tenant tables', () => {
    for (const table of [
      'organizations',
      'organization_memberships',
      'organization_settings',
    ]) {
      assert.match(rls, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    }
  });

  it('seeds MARQ organization idempotently', () => {
    assert.match(rls, /slug = 'marq'/);
    assert.match(rls, /WHERE NOT EXISTS/);
  });

  it('blocks platform_admin assignment in membership insert policy', () => {
    assert.match(rls, /r\.key = 'platform_admin'/);
  });
});
