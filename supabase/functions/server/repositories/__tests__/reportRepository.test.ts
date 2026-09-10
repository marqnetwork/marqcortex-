/**
 * The report repository (MQC-SVC-015), against a PostgREST fake.
 *
 * These run the REAL `createReportRepository` over a query builder that records
 * every table, filter, payload and ordering it is given, because what matters
 * about a repository is not what it returns — the fake decides that — but the
 * query it asks for. Tenant scoping, the soft-delete filter, and the columns a
 * patch is allowed to touch are all properties of the query, and all invisible
 * to a test that only checks the returned row.
 *
 * The fake models the two things the schema actually differs on:
 *
 *   `reports`          soft-deleted, so every read must filter `deleted_at`.
 *   `report_versions`  append-only — no `deleted_at` column at all, so a read
 *                      that filtered it would fail against a real database.
 *
 * No PostgreSQL runs here. What these pin is the SHAPE of the request; the live
 * SQL suite is what pins the database's own behaviour.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';

import { createReportRepository } from '../reportRepository.ts';
import { DiagnosticRepositoryError } from '../diagnosticTypes.ts';

interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  eq: [string, unknown][];
  is: [string, unknown][];
  order: { column: string; ascending: boolean }[];
  limit?: number;
  range?: [number, number];
  terminal?: 'single' | 'maybeSingle';
}

/** A PostgREST-shaped builder that records rather than queries. */
function makeDb(respond: (call: RecordedCall) => unknown) {
  const calls: RecordedCall[] = [];

  function builder(call: RecordedCall) {
    const chain = {
      select(_columns: string) { return chain; },
      eq(column: string, value: unknown) { call.eq.push([column, value]); return chain; },
      is(column: string, value: unknown) { call.is.push([column, value]); return chain; },
      order(column: string, opts?: { ascending?: boolean }) {
        call.order.push({ column, ascending: opts?.ascending !== false });
        return chain;
      },
      limit(n: number) { call.limit = n; return chain; },
      range(from: number, to: number) { call.range = [from, to]; return chain; },
      single() { call.terminal = 'single'; return chain; },
      maybeSingle() { call.terminal = 'maybeSingle'; return chain; },
      then(
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        try {
          return Promise.resolve({ data: respond(call), error: null }).then(resolve, reject);
        } catch (cause) {
          return Promise.reject(cause).then(resolve, reject);
        }
      },
    };
    return chain;
  }

  const db = {
    from(table: string) {
      return {
        select(_columns: string) {
          const call: RecordedCall = { table, op: 'select', eq: [], is: [], order: [] };
          calls.push(call);
          return builder(call);
        },
        insert(payload: Record<string, unknown>) {
          const call: RecordedCall = { table, op: 'insert', payload, eq: [], is: [], order: [] };
          calls.push(call);
          return builder(call);
        },
        update(payload: Record<string, unknown>) {
          const call: RecordedCall = { table, op: 'update', payload, eq: [], is: [], order: [] };
          calls.push(call);
          return builder(call);
        },
      };
    },
  };

  // The fake implements the three builder entry points the repository uses and
  // nothing else, so it cannot structurally satisfy `SupabaseClient`. The cast
  // is the substitution itself, stated once here rather than at each call.
  return { db: db as unknown as SupabaseClient, calls };
}

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const reportRow = { id: 'rep-1', organization_id: ORG, submission_id: 'sub-1' };
const versionRow = { id: 'ver-1', organization_id: ORG, report_id: 'rep-1', version_number: 1 };

/** Every filter a call applied, as `column` names, for order-free assertions. */
function columns(pairs: [string, unknown][]): string[] {
  return pairs.map(([column]) => column);
}

describe('report repository — reads are organization-scoped', () => {
  it('getReportById filters by id, organization and soft delete', async () => {
    const { db, calls } = makeDb(() => reportRow);
    await createReportRepository(db).getReportById('rep-1', ORG);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, 'reports');
    assert.deepEqual(calls[0].eq, [['id', 'rep-1'], ['organization_id', ORG]]);
    assert.deepEqual(calls[0].is, [['deleted_at', null]]);
    assert.equal(calls[0].terminal, 'maybeSingle');
  });

  it('getReportBySubmission resolves ONE report deterministically', async () => {
    const { db, calls } = makeDb(() => reportRow);
    await createReportRepository(db).getReportBySubmission('sub-1', ORG);

    assert.deepEqual(calls[0].eq, [['submission_id', 'sub-1'], ['organization_id', ORG]]);
    assert.deepEqual(calls[0].is, [['deleted_at', null]]);
    // Newest first, with a tie-break: two reports written in the same tick must
    // still resolve to one answer rather than to whichever the planner returns.
    assert.deepEqual(calls[0].order, [
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]);
    assert.equal(calls[0].limit, 1);
  });

  it('listReports scopes to the organization and clamps the page size', async () => {
    const { db, calls } = makeDb(() => [reportRow]);
    await createReportRepository(db).listReports({ organizationId: ORG, limit: 5000 });

    assert.deepEqual(calls[0].eq, [['organization_id', ORG]]);
    assert.deepEqual(calls[0].is, [['deleted_at', null]]);
    assert.deepEqual(calls[0].range, [0, 199], 'a caller cannot ask for an unbounded page');
  });

  it('listReports applies submission and status filters when given', async () => {
    const { db, calls } = makeDb(() => []);
    await createReportRepository(db).listReports({
      organizationId: ORG,
      submissionId: 'sub-1',
      status: 'published',
    });

    assert.deepEqual(columns(calls[0].eq), ['organization_id', 'submission_id', 'status']);
  });

  it('every report read filters deleted_at', async () => {
    const { db, calls } = makeDb(() => reportRow);
    const repo = createReportRepository(db);
    await repo.getReportById('rep-1', ORG);
    await repo.getReportBySubmission('sub-1', ORG);
    await repo.listReports({ organizationId: ORG });

    for (const call of calls) {
      assert.deepEqual(call.is, [['deleted_at', null]], `${call.table} read must exclude deleted rows`);
    }
  });
});

describe('report repository — writes', () => {
  it('createReport defaults status, version and metadata without inventing data', async () => {
    const { db, calls } = makeDb(() => reportRow);
    await createReportRepository(db).createReport({
      organization_id: ORG,
      submission_id: 'sub-1',
    });

    assert.deepEqual(calls[0].payload, {
      organization_id: ORG,
      submission_id: 'sub-1',
      status: 'draft',
      title: null,
      current_version: 1,
      metadata: {},
      created_by: null,
      updated_by: null,
    });
  });

  it('createReport honours supplied values over the defaults', async () => {
    const { db, calls } = makeDb(() => reportRow);
    await createReportRepository(db).createReport({
      organization_id: ORG,
      submission_id: 'sub-1',
      status: 'ready',
      title: 'Q1 diagnostic',
      current_version: 3,
      metadata: { source: 'backfill' },
    });

    const payload = calls[0].payload as Record<string, unknown>;
    assert.equal(payload.status, 'ready');
    assert.equal(payload.title, 'Q1 diagnostic');
    assert.equal(payload.current_version, 3);
    assert.deepEqual(payload.metadata, { source: 'backfill' });
  });

  it('updateReport stamps updated_at and stays organization-scoped', async () => {
    const { db, calls } = makeDb(() => reportRow);
    await createReportRepository(db).updateReport('rep-1', ORG, { status: 'published' });

    const payload = calls[0].payload as Record<string, unknown>;
    assert.equal(payload.status, 'published');
    assert.equal(typeof payload.updated_at, 'string');
    assert.deepEqual(calls[0].eq, [['id', 'rep-1'], ['organization_id', ORG]]);
    assert.deepEqual(calls[0].is, [['deleted_at', null]]);
  });

  it('updateReport refuses to move a report between organizations', async () => {
    const { db, calls } = makeDb(() => reportRow);
    await createReportRepository(db).updateReport('rep-1', ORG, {
      organization_id: OTHER_ORG,
      submission_id: 'sub-99',
      id: 'rep-99',
      status: 'archived',
    } as never);

    const payload = calls[0].payload as Record<string, unknown>;
    assert.equal(payload.status, 'archived', 'the legitimate part of the patch still applies');
    assert.ok(!('organization_id' in payload), 'tenancy is not patchable');
    assert.ok(!('id' in payload), 'identity is not patchable');
    assert.ok(!('submission_id' in payload), 'the parent submission is not patchable');
    // The row is still FOUND by the caller's organization, so the strip is what
    // stands between an edit and a cross-tenant write.
    assert.deepEqual(calls[0].eq, [['id', 'rep-1'], ['organization_id', ORG]]);
  });

  it('updateReport refuses to rewrite provenance or resurrect a deleted report', async () => {
    const { db, calls } = makeDb(() => reportRow);
    await createReportRepository(db).updateReport('rep-1', ORG, {
      created_at: '2020-01-01T00:00:00.000Z',
      created_by: 'someone-else',
      deleted_at: null,
      title: 'renamed',
    } as never);

    const payload = calls[0].payload as Record<string, unknown>;
    assert.equal(payload.title, 'renamed');
    assert.ok(!('created_at' in payload));
    assert.ok(!('created_by' in payload));
    assert.ok(!('deleted_at' in payload));
  });
});

describe('report repository — version history', () => {
  it('checks the parent report in the caller organization before appending', async () => {
    const { db, calls } = makeDb((call) =>
      call.table === 'reports' ? { id: 'rep-1' } : versionRow
    );
    await createReportRepository(db).createReportVersion({
      organization_id: ORG,
      report_id: 'rep-1',
      version_number: 2,
      content: { summary: 'x' },
    });

    assert.equal(calls.length, 2, 'the parent is read before the version is written');
    assert.equal(calls[0].table, 'reports');
    assert.deepEqual(calls[0].eq, [['id', 'rep-1'], ['organization_id', ORG]]);
    assert.deepEqual(calls[0].is, [['deleted_at', null]]);
    assert.equal(calls[1].table, 'report_versions');
    assert.equal(calls[1].op, 'insert');
  });

  it('refuses a version whose parent belongs to another organization', async () => {
    // The parent lookup is organization-scoped, so a foreign report reads as
    // absent — the same answer as one that does not exist.
    const { db, calls } = makeDb(() => null);
    const repo = createReportRepository(db);

    await assert.rejects(
      () => repo.createReportVersion({
        organization_id: OTHER_ORG,
        report_id: 'rep-1',
        version_number: 2,
        content: {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof DiagnosticRepositoryError);
        assert.equal(error.code, 'NOT_FOUND');
        return true;
      },
    );

    assert.equal(calls.length, 1, 'nothing is written when the parent check fails');
    assert.ok(calls.every((c) => c.op !== 'insert'));
  });

  it('createReportVersion defaults the append-only columns and no others', async () => {
    const { db, calls } = makeDb((call) =>
      call.table === 'reports' ? { id: 'rep-1' } : versionRow
    );
    await createReportRepository(db).createReportVersion({
      organization_id: ORG,
      report_id: 'rep-1',
      version_number: 2,
      content: { summary: 'x' },
    });

    const payload = calls[1].payload as Record<string, unknown>;
    assert.equal(payload.version_number, 2);
    assert.deepEqual(payload.content, { summary: 'x' });
    assert.equal(payload.is_published, false);
    assert.equal(payload.generated_by, null);
    assert.equal(payload.created_by, null);
    assert.equal(typeof payload.generated_at, 'string');
    // `report_versions` has no updated_at / updated_by / deleted_at columns.
    for (const absent of ['updated_at', 'updated_by', 'deleted_at']) {
      assert.ok(!(absent in payload), `report_versions has no ${absent} column`);
    }
  });

  it('does not advance reports.current_version as a side effect', async () => {
    const { db, calls } = makeDb((call) =>
      call.table === 'reports' ? { id: 'rep-1' } : versionRow
    );
    await createReportRepository(db).createReportVersion({
      organization_id: ORG,
      report_id: 'rep-1',
      version_number: 7,
      content: {},
    });

    // Which version a report POINTS AT is `updateReport`'s business. Coupling
    // them here would publish every draft the moment it was written.
    assert.ok(calls.every((call) => call.op !== 'update'));
  });

  it('getReportVersion is scoped by report, version and organization', async () => {
    const { db, calls } = makeDb(() => versionRow);
    await createReportRepository(db).getReportVersion('rep-1', 3, ORG);

    assert.equal(calls[0].table, 'report_versions');
    assert.deepEqual(calls[0].eq, [
      ['report_id', 'rep-1'],
      ['version_number', 3],
      ['organization_id', ORG],
    ]);
    assert.deepEqual(calls[0].is, [], 'report_versions has no deleted_at to filter');
  });

  it('listReportVersions reads the history forward, organization-scoped', async () => {
    const { db, calls } = makeDb(() => [versionRow]);
    await createReportRepository(db).listReportVersions('rep-1', ORG);

    assert.deepEqual(calls[0].eq, [['report_id', 'rep-1'], ['organization_id', ORG]]);
    assert.deepEqual(calls[0].order, [{ column: 'version_number', ascending: true }]);
    assert.deepEqual(calls[0].is, []);
  });

  it('never filters deleted_at on report_versions', async () => {
    const { db, calls } = makeDb(() => versionRow);
    const repo = createReportRepository(db);
    await repo.getReportVersion('rep-1', 1, ORG);
    await repo.listReportVersions('rep-1', ORG);

    for (const call of calls.filter((c) => c.table === 'report_versions')) {
      assert.deepEqual(call.is, [], 'the column does not exist; filtering it would fail live');
    }
  });
});

describe('report repository — it is not the outcome repository', () => {
  it('exposes the canonical ReportRepository surface and nothing from outcomes', () => {
    const { db } = makeDb(() => null);
    const repo = createReportRepository(db) as unknown as Record<string, unknown>;

    for (const method of [
      'createReport', 'getReportById', 'getReportBySubmission', 'updateReport',
      'listReports', 'createReportVersion', 'getReportVersion', 'listReportVersions',
    ]) {
      assert.equal(typeof repo[method], 'function', `${method} is missing`);
    }
    for (const foreign of [
      'createOutcome', 'getOutcomeById', 'getOutcomeBySubmission',
      'getOutcomeByLegacyKey', 'updateOutcome', 'listOutcomes',
    ]) {
      assert.ok(!(foreign in repo), `${foreign} belongs to the outcome repository`);
    }
  });

  it('reads the reports tables and never the outcomes table', async () => {
    const { db, calls } = makeDb((call) => (call.table === 'reports' ? { id: 'rep-1' } : []));
    const repo = createReportRepository(db);
    await repo.getReportById('rep-1', ORG);
    await repo.listReports({ organizationId: ORG });
    await repo.listReportVersions('rep-1', ORG);
    await repo.createReportVersion({
      organization_id: ORG, report_id: 'rep-1', version_number: 1, content: {},
    });

    const tables = new Set(calls.map((call) => call.table));
    assert.deepEqual([...tables].sort(), ['report_versions', 'reports']);
  });
});
