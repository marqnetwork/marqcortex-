/**
 * The two list queries do not read every tenant's rows.
 *
 * `listOutcomes` and `listReports` are the only repository queries that filter
 * on `organization_id` alone. Every other query on these tables reaches them
 * through an indexed parent key, so the tenancy filter there runs over a handful
 * of rows; these two ran over the whole table.
 *
 * Their shape is `WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY
 * <ts> DESC LIMIT n`. Without a matching index PostgreSQL reads every row,
 * discards the other tenants', sorts what remains, and returns fifty. One tenant
 * opening a list pays for every other tenant's data — the ordinary way a
 * multi-tenant product becomes slow, and invisible at demo scale.
 *
 * ── WHY THIS ASSERTS A QUERY PLAN, AND WHY IT POPULATES FIRST ──────────────
 *
 * An index that exists is not an index that is USED. A partial index whose
 * predicate does not match the query's, or whose sort direction is wrong, is
 * dead weight the planner walks past — so the assertion is on the plan.
 *
 * And the plan has to be taken on a populated table. On an empty one the planner
 * correctly prefers a sequential scan whatever indexes exist, so a proof taken
 * there says nothing; forcing it with `enable_seqscan = off` only proves the
 * index is USABLE, not that it is CHOSEN. This seeds enough rows across enough
 * tenants that choosing it is the planner's own decision.
 *
 * RUNNING IT. Set `DATABASE_URL` to a PostgreSQL the test may create tables in —
 * a local instance or a disposable test database, never production. Without it
 * every case skips, loudly, so a run that proves nothing cannot be mistaken for
 * a run that passed.
 *
 * SAFETY. It works in its own schema, `idx_probe_<run-id>`, dropped afterwards.
 * It reads and writes nothing else.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const ENABLED = DATABASE_URL !== '';
const SCHEMA = `idx_probe_${Date.now().toString(36)}`;

function psql(sql: string): string {
  return execFileSync(
    'psql',
    [DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

/**
 * The two index definitions, READ FROM THE MIGRATION.
 *
 * Restating them here would test a copy: the migration could be edited to create
 * something else entirely and this file would still prove that its own private
 * SQL produces a good plan. The table shapes below are the minimum the planner
 * needs and are deliberately not the full schema.
 */
function indexStatements(): string[] {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260911120000_cortex_tenant_list_indexes.sql', import.meta.url),
    'utf8',
  );
  // SQL comments go first. The migration EXPLAINS why it does not use
  // `CREATE INDEX CONCURRENTLY`, and an extractor that cannot tell prose from
  // code pulled that sentence out as a statement and tried to run it.
  const code = migration.replace(/^\s*--.*$/gm, '');
  const statements = [...code.matchAll(/CREATE INDEX[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(statements.length, 2, 'the migration no longer creates exactly two indexes');
  return statements.map((s) => s.replace(/public\./g, `${SCHEMA}.`));
}

describe('tenant list indexes (real PostgreSQL)', () => {
  if (!ENABLED) {
    it('SKIPPED — set DATABASE_URL to run these against a real database', { skip: true }, () => {});
    return;
  }

  after(() => {
    try {
      psql(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`);
    } catch {
      // The schema is disposable; a failure to drop it must not fail the run.
    }
  });

  function seed(): void {
    psql(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA};`);
    for (const [table, stamp] of [['outcomes', 'recorded_at'], ['reports', 'created_at']] as const) {
      psql(`
        CREATE TABLE ${SCHEMA}.${table} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id uuid NOT NULL,
          submission_id uuid,
          status text,
          ${stamp} timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz
        );`);
      // Forty tenants, five hundred rows each. Enough that a sequential scan is
      // genuinely more expensive than an index walk, so the planner's choice is
      // its own rather than a hint's.
      psql(`
        INSERT INTO ${SCHEMA}.${table} (organization_id, ${stamp}, deleted_at)
        SELECT
          ('00000000-0000-0000-0000-' || lpad((n % 40)::text, 12, '0'))::uuid,
          now() - (n || ' minutes')::interval,
          CASE WHEN n % 17 = 0 THEN now() ELSE NULL END
        FROM generate_series(1, 20000) AS n;`);
    }
    psql(`ANALYZE ${SCHEMA}.outcomes;`);
    psql(`ANALYZE ${SCHEMA}.reports;`);
  }

  const ORG = "'00000000-0000-0000-0000-000000000007'::uuid";

  function plan(table: string, stamp: string): string {
    return psql(`
      EXPLAIN (COSTS OFF)
      SELECT * FROM ${SCHEMA}.${table}
      WHERE organization_id = ${ORG} AND deleted_at IS NULL
      ORDER BY ${stamp} DESC
      LIMIT 50;`);
  }

  it('without the indexes, both list queries scan the whole table', () => {
    seed();
    for (const [table, stamp] of [['outcomes', 'recorded_at'], ['reports', 'created_at']] as const) {
      const before = plan(table, stamp);
      assert.match(
        before,
        /Seq Scan/,
        `${table} did not start from a sequential scan — the premise of this test is gone:\n${before}`,
      );
      assert.match(before, /Sort/, `${table} was expected to need a sort before the limit:\n${before}`);
    }
  });

  it('with them, the planner chooses an index walk and drops the sort', () => {
    for (const statement of indexStatements()) psql(statement);
    psql(`ANALYZE ${SCHEMA}.outcomes;`);
    psql(`ANALYZE ${SCHEMA}.reports;`);

    for (const [table, stamp] of [['outcomes', 'recorded_at'], ['reports', 'created_at']] as const) {
      const after = plan(table, stamp);
      assert.match(
        after,
        new RegExp(`Index Scan using ${table}_organization_`),
        `${table} still does not use its index — an index that exists is not an index that is used:\n${after}`,
      );
      assert.ok(
        !/Seq Scan/.test(after),
        `${table} still scans every tenant's rows:\n${after}`,
      );
      // The ORDER BY is satisfied by the index's own order. A plan that still
      // sorts is reading the whole match set before it can return fifty.
      //
      // Not asserted, deliberately: that `organization_id` leads. Reversing the
      // columns to `(recorded_at DESC, organization_id)` still yields an Index
      // Scan with an Index Cond and no sort — PostgreSQL evaluates a non-leading
      // equality during the walk — and at forty evenly-sized tenants it performs
      // comparably. The column order matters when tenants are SKEWED: to return
      // fifty rows for a small tenant, a timestamp-leading index walks past
      // every larger tenant's newer rows first. That is a cost difference, not a
      // plan-shape difference, so pinning it here would mean asserting on
      // buffer counts — brittle, and a worse description of the reason than
      // this comment.
      assert.ok(
        !/\bSort\b/.test(after),
        `${table} still sorts — the index's column order or direction is wrong:\n${after}`,
      );
    }
  });

  it('the partial predicate matches, so soft-deleted rows are not in the index', () => {
    // If the index were not partial, or its predicate did not match the query's,
    // the planner could not use it for this query at all — and a query WITHOUT
    // the predicate must not be served by it.
    const unfiltered = psql(`
      EXPLAIN (COSTS OFF)
      SELECT * FROM ${SCHEMA}.outcomes
      WHERE organization_id = ${ORG}
      ORDER BY recorded_at DESC
      LIMIT 50;`);
    assert.ok(
      !/Index Scan using outcomes_organization_/.test(unfiltered),
      `a partial index served a query that does not carry its predicate:\n${unfiltered}`,
    );
  });
});
