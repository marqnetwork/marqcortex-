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

describe('G2 tenancy composite keys (static)', () => {
  const composite = readMigration('20260910120000_cortex_tenancy_composite_keys.sql');
  const foundation = readMigration('20260714050000_cortex_diagnostic_foundation.sql');

  /**
   * Every parent→child relationship in the diagnostic domain, read from the
   * FOUNDATION migration rather than restated here.
   *
   * The point of deriving it: a child table added later with an
   * `organization_id` and a parent reference, and no composite key, becomes a
   * failing test rather than a silent tenancy hole. That is exactly how the
   * original gap survived — fourteen relationships, one guard, and nothing that
   * counted them.
   */
  function relationships(): { child: string; column: string; parent: string }[] {
    const found: { child: string; column: string; parent: string }[] = [];
    for (const [, child, body] of foundation.matchAll(
      /CREATE TABLE IF NOT EXISTS public\.(\w+) \(([\s\S]*?)\n\);/g,
    ) as unknown as Iterable<RegExpMatchArray>) {
      if (!/organization_id\s+UUID NOT NULL/.test(body)) continue;
      for (const line of body.split('\n')) {
        const fk = /^\s*(\w+)\s+UUID[^,]*?REFERENCES public\.(\w+)\(id\)/.exec(line);
        if (!fk || fk[1] === 'organization_id') continue;
        found.push({ child, column: fk[1], parent: fk[2] });
      }
    }
    return found;
  }

  it('finds the parent-child relationships it is meant to protect', () => {
    assert.ok(
      relationships().length >= 14,
      `expected at least the fourteen known relationships, found ${relationships().length}`,
    );
  });

  it('declares a composite foreign key for every one of them', () => {
    // The FOUR-column form only. The migration also lists every relationship in
    // its pre-flight data check, in a three-column form, and matching the whole
    // file would let a relationship that is merely VALIDATED pass for one that
    // is CONSTRAINED — which is the difference this test exists to catch.
    const block = /ADD CONSTRAINT[\s\S]*$/.exec(composite)?.[0] ?? '';
    const declared = /FOR v_fk IN\s*SELECT \* FROM \(VALUES([\s\S]*?)\) AS t\(child, column_name, parent, on_delete\)/
      .exec(composite)?.[1];
    assert.ok(declared, 'the foreign-key VALUES block was not found');
    assert.ok(block.length > 0, 'no ADD CONSTRAINT section');

    for (const { child, column, parent } of relationships()) {
      assert.match(
        declared,
        new RegExp(`'${child}',\\s*'${column}',\\s*'${parent}',\\s*'(CASCADE|SET NULL)'`),
        `${child}.${column} -> ${parent} has no composite key — a child could name another tenant's parent`,
      );
    }
  });

  it('constrains exactly the relationships it validates, and no fewer', () => {
    const countIn = (pattern: RegExp) => (composite.match(pattern) ?? []).length;
    const validated = /FOR v_pair IN\s*SELECT \* FROM \(VALUES([\s\S]*?)\) AS t\(child, column_name, parent\)/
      .exec(composite)?.[1];
    const constrained = /FOR v_fk IN\s*SELECT \* FROM \(VALUES([\s\S]*?)\) AS t\(child, column_name, parent, on_delete\)/
      .exec(composite)?.[1];
    assert.ok(validated && constrained);
    const rows = (block: string) => (block.match(/\('\w+',/g) ?? []).length;
    assert.equal(
      rows(constrained),
      rows(validated),
      'a relationship is checked for bad data but never given a constraint, or vice versa',
    );
    void countIn;
  });

  it('gives every referenced parent the two-column unique key', () => {
    const parents = new Set(relationships().map((r) => r.parent));
    for (const parent of parents) {
      assert.match(composite, new RegExp(`'${parent}'`), `${parent} needs UNIQUE (id, organization_id)`);
    }
  });

  it('restricts SET NULL to the parent column, never the tenant', () => {
    // Without the column list a two-column SET NULL nulls `organization_id`
    // too, which is NOT NULL — so deleting a parent fails outright.
    assert.match(composite, /SET NULL \(%I\)/);
  });

  it('refuses to run against data that already crosses a tenant boundary', () => {
    assert.match(composite, /RAISE EXCEPTION[\s\S]*?already cross a tenant boundary/);
    assert.match(composite, /IS DISTINCT FROM p\.organization_id/);
  });

  it('adds no column and writes no row', () => {
    assert.doesNotMatch(composite, /\bADD COLUMN\b/i);
    assert.doesNotMatch(composite, /\b(INSERT INTO|DELETE FROM)\b/i);
    assert.doesNotMatch(composite, /\bUPDATE public\./i);
  });
});

describe('MCV2-S5 diagnostic repositories (static)', () => {
  const repoDir = join(root, 'supabase', 'functions', 'server', 'repositories');
  const readRepo = (file: string) => readFileSync(join(repoDir, file), 'utf8');

  /**
   * Source with comments and blank lines removed.
   *
   * Two repositories that differ only in their header comment are the same
   * repository. Comparing raw text would let a renamed banner pass for a
   * rewrite, which is exactly how `reportRepository.ts` shipped as a
   * byte-identical copy of `outcomeRepository.ts`.
   */
  function code(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }

  /**
   * The factory each repository file is REQUIRED to export, and the tables it
   * is required to read.
   *
   * The previous version of this suite asserted only `/export function create/`
   * against each file. `reportRepository.ts` satisfied that while exporting
   * `createOutcomeRepository` and querying the `outcomes` table — the whole
   * defect passed the test that existed to catch it. Naming the factory and
   * the tables is what closes that gap.
   */
  const repos = [
    { file: 'leadRepository.ts', factory: 'createLeadRepository', tables: ['leads'] },
    { file: 'contactRepository.ts', factory: 'createContactRepository', tables: ['contacts'] },
    { file: 'submissionRepository.ts', factory: 'createSubmissionRepository', tables: ['submissions'] },
    { file: 'reportRepository.ts', factory: 'createReportRepository', tables: ['reports', 'report_versions'] },
    { file: 'outcomeRepository.ts', factory: 'createOutcomeRepository', tables: ['outcomes'] },
  ];

  for (const { file, factory, tables } of repos) {
    it(`${file} exports ${factory}`, () => {
      const src = readRepo(file);
      assert.match(
        src,
        new RegExp(`export\\s+function\\s+${factory}\\s*\\(`),
        `${file} must export ${factory}, not merely something shaped like a factory`,
      );
      assert.doesNotMatch(src, /index\.tsx/);
    });

    it(`${file} queries its own tables`, () => {
      const src = code(readRepo(file));
      for (const table of tables) {
        assert.match(src, new RegExp(`from\\(['"\`]${table}['"\`]\\)`), `${file} must read ${table}`);
      }
      const foreign = repos
        .filter((other) => other.file !== file)
        .flatMap((other) => other.tables)
        .filter((table) => !tables.includes(table));
      for (const table of foreign) {
        assert.doesNotMatch(
          src,
          new RegExp(`from\\(['"\`]${table}['"\`]\\)`),
          `${file} must not read ${table} — that belongs to another repository`,
        );
      }
    });
  }

  it('no two repositories are the same implementation', () => {
    const seen = new Map<string, string>();
    for (const { file } of repos) {
      const body = code(readRepo(file));
      const twin = seen.get(body);
      assert.equal(
        twin,
        undefined,
        `${file} is a duplicate of ${twin} — a copied repository is not an implementation`,
      );
      seen.set(body, file);
    }
  });

  it('every repository factory is exported from the barrel', () => {
    const barrel = readRepo('index.ts');
    for (const { file, factory } of repos) {
      assert.match(
        barrel,
        new RegExp(`export\\s*\\{[^}]*\\b${factory}\\b[^}]*\\}\\s*from\\s*['"\\.\\/]*${file.replace('.ts', '')}\\.ts['"]`),
        `the barrel must export ${factory} from ${file}`,
      );
    }
  });

  it('the barrel names no export its source file does not have', () => {
    // A named re-export of a missing member fails at ESM LINK time, so the
    // first module to import the barrel fails to load at all. That is how
    // `createReportRepository` sat here for a release: nothing imported it.
    const barrel = readRepo('index.ts');
    const reExports = [...barrel.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/([\w.]+)'/g)];
    assert.ok(reExports.length > 0, 'the barrel should re-export something');
    for (const [, names, source] of reExports) {
      const src = readRepo(source);
      for (const raw of names.split(',')) {
        const name = raw.replace(/\btype\b/, '').trim();
        if (!name) continue;
        assert.match(
          src,
          new RegExp(`export\\s+(function|const|class|interface|type)\\s+${name}\\b`),
          `${source} does not export ${name} — the barrel would fail at link time`,
        );
      }
    }
  });

  it('reportRepository implements every canonical ReportRepository method', () => {
    // The method list is DERIVED from the interface rather than restated here,
    // so a method added to canon becomes a failing test instead of a silent gap.
    const types = readRepo('diagnosticTypes.ts');
    const block = /export interface ReportRepository \{([\s\S]*?)\n\}/.exec(types);
    assert.ok(block, 'ReportRepository interface not found in diagnosticTypes.ts');
    const methods = [...block[1].matchAll(/^\s{2}(\w+)\s*\(/gm)].map((m) => m[1]);
    assert.ok(methods.length >= 8, `expected the full report surface, found ${methods.length}`);

    const src = readRepo('reportRepository.ts');
    for (const method of methods) {
      assert.match(
        src,
        new RegExp(`\\basync\\s+${method}\\s*\\(`),
        `reportRepository.ts does not implement ${method}`,
      );
    }
  });

  it('report_versions is never filtered on a column it does not have', () => {
    // `reports` is soft-deleted; `report_versions` is append-only and has no
    // `deleted_at`. A `.is('deleted_at', null)` on the versions table compiles,
    // passes every type-check, and fails against a real database.
    const foundation = readMigration('20260714050000_cortex_diagnostic_foundation.sql');
    const versionsTable = /CREATE TABLE IF NOT EXISTS public\.report_versions \(([\s\S]*?)\n\);/.exec(foundation);
    assert.ok(versionsTable, 'report_versions table not found');
    assert.doesNotMatch(versionsTable[1], /deleted_at/, 'schema changed — revisit this contract');

    const src = code(readRepo('reportRepository.ts'));
    for (const [, chain] of src.matchAll(/from\(['"`]report_versions['"`]\)([\s\S]*?)(?=\n\s*(?:const|return|\}|throwOnError))/g)) {
      assert.doesNotMatch(chain, /deleted_at/, 'report_versions has no deleted_at column');
    }
  });
});
