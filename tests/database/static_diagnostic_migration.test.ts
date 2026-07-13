/**
 * Static migration validation — MCV2-S5-IMPLEMENT-002
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

describe('MCV2-S5 diagnostic migrations (static)', () => {
  const foundation = readMigration('20260714050000_cortex_diagnostic_foundation.sql');
  const rls = readMigration('20260714050001_cortex_diagnostic_rls.sql');

  const tables = [
    'lead_sources', 'leads', 'lead_tags', 'contacts', 'contact_methods',
    'submissions', 'submission_sections', 'diagnostic_answers',
    'diagnostic_scores', 'domain_scores', 'reports', 'report_versions', 'outcomes',
  ];

  it('creates all 13 diagnostic tables', () => {
    for (const table of tables) {
      assert.match(foundation, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    }
  });

  it('does not modify kv_store table', () => {
    assert.doesNotMatch(foundation, /ALTER TABLE.*kv_store/i);
    assert.doesNotMatch(foundation, /DROP TABLE.*kv_store/i);
    assert.doesNotMatch(rls, /kv_store/i);
  });

  it('includes organization_id on submissions', () => {
    assert.match(foundation, /organization_id\s+UUID NOT NULL REFERENCES public\.organizations/);
  });

  it('includes legacy_kv_key columns for migration mapping', () => {
    assert.match(foundation, /legacy_kv_key/);
  });

  it('defines diagnostic RLS helpers', () => {
    for (const fn of [
      'cortex.marq_organization_id',
      'cortex.can_read_diagnostic',
      'cortex.can_write_diagnostic',
      'cortex.can_manage_diagnostic',
    ]) {
      assert.match(rls, new RegExp(`FUNCTION ${fn.replace('.', '\\.')}`));
    }
  });

  it('enables RLS on diagnostic tables', () => {
    assert.match(rls, /ENABLE ROW LEVEL SECURITY/);
    assert.match(rls, /submissions_insert_anon/);
  });

  it('seeds diagnostic permissions', () => {
    assert.match(rls, /diagnostic\.read/);
    assert.match(rls, /diagnostic\.write/);
    assert.match(rls, /diagnostic\.manage/);
  });
});

describe('MCV2-S5 diagnostic repositories (static)', () => {
  const repos = [
    'leadRepository.ts',
    'contactRepository.ts',
    'submissionRepository.ts',
    'reportRepository.ts',
    'outcomeRepository.ts',
  ];

  for (const file of repos) {
    it(`${file} exports create*Repository`, () => {
      const src = readFileSync(
        join(root, 'supabase', 'functions', 'server', 'repositories', file),
        'utf8',
      );
      assert.match(src, /export function create/);
      assert.doesNotMatch(src, /index\.tsx/);
    });
  }
});
