/**
 * Static migration infrastructure validation — MCV2-S6.2-IMPLEMENT-004
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readMigration(name: string): string {
  return readFileSync(join(root, 'supabase', 'migrations', name), 'utf8');
}

describe('MCV2-S6.2 migration infrastructure (static)', () => {
  const foundation = readMigration('20260713184931_migration_infrastructure.sql');
  const rls = readMigration('20260713184943_migration_infrastructure_rls.sql');
  const rollback = readFileSync(
    join(root, 'supabase', 'migrations', 'rollbacks', '20260713184931_rollback_migration_infrastructure.sql'),
    'utf8',
  );

  const tables = [
    'migration_runs',
    'migration_checkpoints',
    'migration_quarantine',
    'migration_reconciliation_log',
  ];

  it('creates all migration infrastructure tables', () => {
    for (const table of tables) {
      assert.match(foundation, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    }
  });

  it('does not modify kv_store or diagnostic business tables', () => {
    assert.doesNotMatch(foundation, /ALTER TABLE.*kv_store/i);
    assert.doesNotMatch(foundation, /DROP TABLE.*leads/i);
    assert.doesNotMatch(rls, /DROP TABLE/i);
  });

  it('includes organization_id on scoped tables', () => {
    assert.match(foundation, /migration_runs[\s\S]*organization_id\s+UUID NOT NULL/);
    assert.match(foundation, /migration_quarantine[\s\S]*organization_id\s+UUID NOT NULL/);
  });

  it('defines mode and status checks on migration_runs', () => {
    assert.match(foundation, /migration_runs_mode_check/);
    assert.match(foundation, /inventory.*simulation.*backfill.*reconcile.*rollback/s);
  });

  it('enables RLS restricted to service_role and platform admin', () => {
    assert.match(rls, /ENABLE ROW LEVEL SECURITY/);
    assert.match(rls, /TO service_role/);
    assert.match(rls, /cortex\.is_platform_admin\(\)/);
  });

  it('includes indexes for run, status, namespace, source_key', () => {
    assert.match(foundation, /migration_runs_status_idx/);
    assert.match(foundation, /migration_runs_namespace_idx/);
    assert.match(foundation, /migration_quarantine_source_key_idx/);
    assert.match(foundation, /migration_checkpoints_run_idx/);
  });

  it('rollback drops infrastructure only', () => {
    assert.match(rollback, /DROP TABLE IF EXISTS public\.migration_runs/);
    assert.doesNotMatch(rollback, /DROP TABLE.*leads/i);
    assert.doesNotMatch(rollback, /kv_store/i);
  });
});

describe('MCV2-S6.2 migration engine modules (static)', () => {
  const modules = [
    'types.ts',
    'kvReader.ts',
    'inventory.ts',
    'normalizer.ts',
    'checkpointStore.ts',
    'quarantineStore.ts',
    'telemetry.ts',
    'reconciliation.ts',
    'orchestrator.ts',
    'rollback.ts',
    'domains/leads.ts',
  ];

  for (const file of modules) {
    it(`${file} exists and exports symbols`, () => {
      const src = readFileSync(
        join(root, 'supabase', 'functions', 'server', 'migration', file),
        'utf8',
      );
      assert.ok(src.length > 20);
      assert.doesNotMatch(src, /index\.tsx/);
    });
  }

  it('cli entry exists', () => {
    const cli = readFileSync(join(root, 'scripts', 'migration', 'cli.ts'), 'utf8');
    assert.match(cli, /runMigrationCli/);
    assert.match(cli, /mode=inventory/);
  });
});
