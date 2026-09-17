/**
 * GOALS, DECISIONS AND RISKS — the shape of the layer above the organization.
 *
 * Three things are proven here, and a fourth deliberately is not.
 *
 *   THE TENANT FILTER on every read, over the recorded query chain rather than
 *   the source text. These reads run under the service key, so RLS is bypassed
 *   and this filter IS the boundary for anything they return.
 *
 *   THE ALLOW-LIST on every write, the same rule the spine's writes follow:
 *   a body key the spec does not name never reaches the database.
 *
 *   THE CANON'S OWN STANDARDS, turned into refusals a person can read.
 *   ONT 14.8 says a Decision is "traceable"; ONT 17.6 says a Risk is
 *   "evaluated". Both are CHECK constraints in the migration, and both would
 *   reach a caller as "that value is not allowed" if left to PostgreSQL — true
 *   and useless. The repository names them first.
 *
 * What is NOT proven here is that PostgreSQL actually refuses any of it. That
 * is `scripts/organizational-spine-scenarios.mjs`, fourteen properties against
 * a real database. A perfect field map in front of missing RLS is a service-key
 * write surface with a nice API.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  archiveStrategyRow,
  buildStrategyRow,
  createStrategyRow,
  readStrategy,
  STRATEGY_ENTITIES,
  STRATEGY_TABLES,
  summariseStrategy,
  updateStrategyRow,
  type StrategyQueryBuilder,
  type StrategyQueryClient,
} from '../../supabase/functions/server/organization/strategyRepository.ts';
import {
  OrganizationWriteError,
  type WriteQueryBuilder,
  type WriteQueryClient,
} from '../../supabase/functions/server/organization/organizationWrites.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

// ── Read fake ───────────────────────────────────────────────────────────────
interface RecordedRead {
  table: string; columns: string;
  filters: { method: string; column: string; value: unknown }[];
}

function fakeReadClient(rows: Partial<Record<string, Record<string, unknown>[]>> = {}, failOn?: string) {
  const reads: RecordedRead[] = [];
  const client: StrategyQueryClient = {
    from(table) {
      return {
        select(columns) {
          const record: RecordedRead = { table, columns, filters: [] };
          reads.push(record);
          const builder: StrategyQueryBuilder = {
            eq(c, v) { record.filters.push({ method: 'eq', column: c, value: v }); return builder; },
            is(c, v) { record.filters.push({ method: 'is', column: c, value: v }); return builder; },
            order(c) { record.filters.push({ method: 'order', column: c, value: null }); return builder; },
            then(onFulfilled, onRejected) {
              const answer = table === failOn
                ? { data: null, error: { message: `boom on ${table}` } }
                : { data: rows[table] ?? [], error: null };
              return Promise.resolve(answer).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, reads };
}

// ── Write fake ──────────────────────────────────────────────────────────────
interface RecordedWrite {
  table: string; verb: 'insert' | 'update';
  values: Record<string, unknown>;
  filters: { column: string; value: unknown }[];
}

function fakeWriteClient(answer: { data: unknown; error: unknown } = { data: [{ id: 'new-1' }], error: null }) {
  const writes: RecordedWrite[] = [];
  const builderFor = (record: RecordedWrite): WriteQueryBuilder => {
    const builder: WriteQueryBuilder = {
      eq(c, v) { record.filters.push({ column: c, value: v }); return builder; },
      is(c, v) { record.filters.push({ column: c, value: v }); return builder; },
      select() { return builder; },
      maybeSingle() { return Promise.resolve(answer); },
      then(onFulfilled, onRejected) { return Promise.resolve(answer).then(onFulfilled, onRejected); },
    };
    return builder;
  };
  const client: WriteQueryClient = {
    from(table) {
      return {
        insert(values) {
          const r: RecordedWrite = { table, verb: 'insert', values, filters: [] };
          writes.push(r); return builderFor(r);
        },
        update(values) {
          const r: RecordedWrite = { table, verb: 'update', values, filters: [] };
          writes.push(r); return builderFor(r);
        },
      };
    },
  };
  return { client, writes };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('every strategic read is scoped to one tenant', () => {
  it('reads the three tables and nothing else', async () => {
    const fake = fakeReadClient();
    await readStrategy(fake.client, ORG_A);
    assert.deepEqual(
      fake.reads.map(r => r.table).sort(),
      ['decisions', 'goals', 'risks'],
    );
  });

  it('filters EVERY read on the organization it was given', async () => {
    // The service key bypasses RLS, so a read that forgot this would return
    // another tenant's goals with nothing below it to object.
    const fake = fakeReadClient();
    await readStrategy(fake.client, ORG_A);
    for (const r of fake.reads) {
      assert.ok(
        r.filters.some(f => f.method === 'eq' && f.column === 'organization_id' && f.value === ORG_A),
        `${r.table} was read without an organization filter`,
      );
    }
  });

  it('filters EVERY read on undeleted rows', async () => {
    const fake = fakeReadClient();
    await readStrategy(fake.client, ORG_A);
    for (const r of fake.reads) {
      assert.ok(r.filters.some(f => f.method === 'is' && f.column === 'deleted_at' && f.value === null));
    }
  });

  it('never references a second organization', async () => {
    const fake = fakeReadClient();
    await readStrategy(fake.client, ORG_A);
    assert.ok(!fake.reads.flatMap(r => r.filters.map(f => f.value)).includes(ORG_B));
  });

  it('turns a failed read into a named error rather than an empty strategy', async () => {
    // An organization with no goals and an unreadable one are different
    // answers. Swallowing this would render a perfectly plausible lie.
    const fake = fakeReadClient({}, STRATEGY_TABLES.risk);
    await assert.rejects(() => readStrategy(fake.client, ORG_A), /risks/);
  });

  it('maps a row into the shape the surface renders', async () => {
    const fake = fakeReadClient({
      goals: [{
        id: 'g-1', statement: 'Ship it', measure: 'Milestones', target_value: '8',
        current_value: null, due_on: '2026-12-31', status: 'in_progress',
        owner_person_id: 'p-1',
      }],
    });
    const { goals } = await readStrategy(fake.client, ORG_A);
    assert.deepEqual(goals[0], {
      id: 'g-1', statement: 'Ship it', measure: 'Milestones', targetValue: '8',
      currentValue: null, dueOn: '2026-12-31', status: 'in_progress', ownerPersonId: 'p-1',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the summary says what the canon would notice', () => {
  const records = {
    goals: [
      { id: 'g1', statement: 'A', measure: null, targetValue: null, currentValue: null,
        dueOn: null, status: 'in_progress', ownerPersonId: 'p1' },
      { id: 'g2', statement: 'B', measure: null, targetValue: null, currentValue: null,
        dueOn: null, status: 'planned', ownerPersonId: null },
    ],
    decisions: [
      { id: 'd1', statement: 'X', alternatives: 'a;b', rationale: 'because', goalId: 'g1',
        decidedByPersonId: 'p1', decidedOn: '2026-01-01', reviewOn: null, status: 'decided' },
      { id: 'd2', statement: 'Y', alternatives: null, rationale: null, goalId: null,
        decidedByPersonId: null, decidedOn: null, reviewOn: null, status: 'proposed' },
    ],
    risks: [
      { id: 'r1', statement: 'P', likelihood: 'high', impact: 'high', tolerance: 'outside',
        mitigation: null, goalId: 'g1', ownerPersonId: 'p1', status: 'mitigating' },
      { id: 'r2', statement: 'Q', likelihood: 'low', impact: 'low', tolerance: 'unset',
        mitigation: null, goalId: null, ownerPersonId: null, status: 'open' },
    ],
  };

  it('counts the decisions with no rationale', () => {
    // ONT 14.8 lists "justified" among a Decision's defining characteristics,
    // so a decision with no rationale is an incomplete record of one. Counting
    // it is how the surface can say so without anybody reading every row.
    assert.equal(summariseStrategy(records).decisionsWithoutRationale, 1);
  });

  it('counts the risks nobody has assessed', () => {
    // ONT 17.6: a Risk is EVALUATED by likelihood, impact and tolerance.
    assert.equal(summariseStrategy(records).risksUnassessed, 1);
    assert.equal(summariseStrategy(records).risksOutsideTolerance, 1);
  });

  it('counts the goals nobody owns', () => {
    // A goal nobody owns is a goal nobody is working on.
    assert.equal(summariseStrategy(records).goalsWithoutOwner, 1);
  });

  it('agrees with the lists it summarises', () => {
    const summary = summariseStrategy(records);
    assert.equal(summary.goals, records.goals.length);
    assert.equal(summary.decisions, records.decisions.length);
    assert.equal(summary.risks, records.risks.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the write allow-list', () => {
  it('drops a field no entity declares', () => {
    const row = buildStrategyRow('goal', { statement: 'Ship', priority: 'urgent' }, 'create');
    assert.deepEqual(Object.keys(row).sort(), ['statement']);
  });

  it('refuses a caller-supplied organization id by never reading it', () => {
    const row = buildStrategyRow(
      'goal', { statement: 'Ship', organization_id: ORG_B, organizationId: ORG_B }, 'create',
    );
    assert.ok(!JSON.stringify(row).includes(ORG_B));
  });

  it('declares no organization_id, id or deleted_at field on any entity', () => {
    for (const [name, spec] of Object.entries(STRATEGY_ENTITIES)) {
      for (const field of Object.values(spec.fields)) {
        for (const forbidden of ['organization_id', 'id', 'deleted_at', 'created_at']) {
          assert.notEqual(field.column, forbidden, `${name} must not accept ${forbidden}`);
        }
      }
    }
  });

  it('requires a statement on create', () => {
    for (const entity of ['goal', 'decision', 'risk'] as const) {
      assert.throws(() => buildStrategyRow(entity, {}, 'create'), /statement is required/);
    }
  });

  it('writes null for a link the operator cleared', () => {
    // `undefined` is "not supplied" and skipped; `null` is "clear this" and
    // written. Collapsing them would make a goal link impossible to remove.
    assert.deepEqual(buildStrategyRow('risk', { goalId: null }, 'update'), { goal_id: null });
  });

  it('refuses an update that changes nothing', () => {
    assert.throws(() => buildStrategyRow('goal', { nonsense: 1 }, 'update'), /No changeable field/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the vocabularies are the migration’s, and refusals name the field', () => {
  it('refuses a status outside ONT 13.13’s states', () => {
    assert.throws(
      () => buildStrategyRow('goal', { statement: 'S', status: 'shipped' }, 'create'),
      /status must be one of: planned, in_progress/,
    );
  });

  it('refuses a likelihood outside the scale', () => {
    assert.throws(
      () => buildStrategyRow('risk', { statement: 'S', likelihood: 'certain' }, 'create'),
      /likelihood must be one of: low, medium, high/,
    );
  });

  it('refuses a tolerance outside the scale', () => {
    assert.throws(
      () => buildStrategyRow('risk', { statement: 'S', tolerance: 'fine' }, 'create'),
      /tolerance must be one of/,
    );
  });

  it('refuses a malformed date before it reaches the database', () => {
    assert.throws(
      () => buildStrategyRow('goal', { statement: 'S', dueOn: '31/12/2026' }, 'create'),
      /YYYY-MM-DD/,
    );
  });

  it('accepts a cleared date', () => {
    assert.deepEqual(buildStrategyRow('goal', { dueOn: null }, 'update'), { due_on: null });
    assert.deepEqual(buildStrategyRow('goal', { dueOn: '' }, 'update'), { due_on: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the canon’s standards are refused in the caller’s words', () => {
  it('will not mark a decision decided with nobody behind it', () => {
    // ONT 14.8's "traceable". The CHECK would say "that value is not allowed",
    // which is true and useless.
    assert.throws(
      () => buildStrategyRow('decision', { statement: 'S', status: 'decided' }, 'create'),
      /needs a decider and a date/,
    );
    assert.throws(
      () => buildStrategyRow(
        'decision', { statement: 'S', status: 'decided', decidedByPersonId: 'p-1' }, 'create',
      ),
      /needs a decider and a date/,
    );
  });

  it('accepts a decided decision that names both', () => {
    const row = buildStrategyRow('decision', {
      statement: 'S', status: 'decided', decidedByPersonId: 'p-1', decidedOn: '2026-01-01',
    }, 'create');
    assert.equal(row.status, 'decided');
  });

  it('reads an EXISTING decider when only the status is being changed', () => {
    // The likeliest edit: a proposed decision becomes decided. The decider was
    // already recorded, and demanding it again would make the obvious action
    // fail.
    const row = buildStrategyRow(
      'decision', { status: 'decided' }, 'update',
      { decidedByPersonId: 'p-1', decidedOn: '2026-01-01' },
    );
    assert.equal(row.status, 'decided');
  });

  it('still refuses when neither the body nor the record supplies one', () => {
    assert.throws(
      () => buildStrategyRow('decision', { status: 'decided' }, 'update', {}),
      /needs a decider and a date/,
    );
  });

  it('will not accept a risk whose tolerance nobody decided', () => {
    // ONT 17.6: evaluated by likelihood, impact and tolerance.
    assert.throws(
      () => buildStrategyRow('risk', { statement: 'S', status: 'accepted' }, 'create'),
      /tolerance has been decided/,
    );
    assert.throws(
      () => buildStrategyRow('risk', { status: 'accepted' }, 'update', { tolerance: 'unset' }),
      /tolerance has been decided/,
    );
  });

  it('accepts a risk whose tolerance was already recorded', () => {
    const row = buildStrategyRow('risk', { status: 'accepted' }, 'update', { tolerance: 'within' });
    assert.equal(row.status, 'accepted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('every strategic statement carries the server’s tenant', () => {
  it('stamps the resolved organization on a create', async () => {
    const fake = fakeWriteClient();
    await createStrategyRow(fake.client, 'goal', ORG_A, { statement: 'Ship' });
    assert.equal(fake.writes[0].table, 'goals');
    assert.equal(fake.writes[0].values.organization_id, ORG_A);
  });

  it('applies the tenant AFTER the body, so a body field cannot win', async () => {
    const fake = fakeWriteClient();
    await createStrategyRow(fake.client, 'risk', ORG_A, { statement: 'S', organization_id: ORG_B });
    assert.equal(fake.writes[0].values.organization_id, ORG_A);
  });

  it('matches id, tenant and undeleted on an update', async () => {
    const fake = fakeWriteClient();
    await updateStrategyRow(fake.client, 'decision', ORG_A, 'd-1', { rationale: 'because' });
    const columns = fake.writes[0].filters;
    assert.ok(columns.some(f => f.column === 'id' && f.value === 'd-1'));
    assert.ok(columns.some(f => f.column === 'organization_id' && f.value === ORG_A));
    assert.ok(columns.some(f => f.column === 'deleted_at' && f.value === null));
  });

  it('archives with an UPDATE and never a DELETE', async () => {
    const fake = fakeWriteClient();
    await archiveStrategyRow(fake.client, 'goal', ORG_A, 'g-1', '2026-01-01T00:00:00Z');
    assert.equal(fake.writes[0].verb, 'update');
    assert.equal(fake.writes[0].values.deleted_at, '2026-01-01T00:00:00Z');
  });

  it('reports a row that matched nothing as not-found, without saying why', async () => {
    // Under RLS "does not exist" and "is not yours" are deliberately the same
    // answer.
    const fake = fakeWriteClient({ data: [], error: null });
    await assert.rejects(
      () => updateStrategyRow(fake.client, 'goal', ORG_A, 'g-9', { statement: 'X' }),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationWriteError);
        assert.equal((err as OrganizationWriteError).failure, 'not-found');
        return true;
      },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the routes take no organization from the caller', () => {
  const server = stripComments(read('supabase/functions/server/index.tsx'));

  it('resolves the tenant from the session on the strategy read', () => {
    const start = server.indexOf('app.get("/make-server-324f4fbe/strategy"');
    assert.notEqual(start, -1);
    const body = server.slice(start, server.indexOf('\nconst STRATEGY_ROUTE_ENTITIES'));
    assert.match(body, /verifyTeamToken/);
    assert.match(body, /resolveWorkspaceForUser/);
    assert.match(body, /workspace\.workspace\.organizationId/);
    assert.ok(!/c\.req\.query\(/.test(body), 'no query parameter names a tenant');
  });

  it('routes a record type through a map, never a path parameter to a table', () => {
    assert.match(server, /const STRATEGY_ROUTE_ENTITIES: Record<string, StrategyEntityName>/);
    assert.match(server, /if \(!entity\) return c\.json\(\{ error: "Unknown strategy record type" \}, 404\)/);
  });

  it('runs strategy writes through the same caller-scoped context as the spine', () => {
    // The authorization is `strategy.manage`, evaluated by PostgreSQL against
    // the caller's own JWT — not re-implemented here.
    const post = server.slice(server.indexOf('app.post("/make-server-324f4fbe/strategy/:entity"'));
    assert.match(post.slice(0, 900), /spineWriteContext\(c\)/);
  });

  it('reports strategy manage authority for display', () => {
    assert.match(server, /'strategy\.manage'/);
    assert.match(server, /canManageStrategy/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the surface shows what the canon would notice', () => {
  const surface = stripComments(read('src/app/components/StrategySurface.tsx'));

  it('flags a decision with no rationale', () => {
    assert.match(surface, /decision-unjustified/);
    assert.match(surface, /No rationale recorded/);
  });

  it('flags a risk nobody has assessed', () => {
    assert.match(surface, /Not yet assessed/);
  });

  it('renders through the five honest states', () => {
    assert.match(surface, /ProductDataState/);
    assert.match(surface, /useProductData/);
  });

  it('offers its write controls only to an account the server says may write', () => {
    assert.match(surface, /canManageStrategy === true/);
    assert.ok(
      !/canManageStrategy\s*!==\s*false/.test(surface),
      'an absent flag must not be treated as permission',
    );
  });

  it('withholds the write controls rather than disabling them', () => {
    assert.ok(!/disabled=\{!\s*canManage/.test(surface));
  });

  it('names a person rather than showing an id', () => {
    assert.match(surface, /personName\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the strategic layer never falls back to demo data', () => {
  const service = stripComments(read('src/app/services/dataService.ts'));

  it('requires a real backend for the read as well as the writes', () => {
    // Unlike the spine, even the READ has no demo branch: inventing a set of
    // goals would be fabricating the organization's intent, which is the one
    // kind of demo content that could be mistaken for a record of a real
    // conversation.
    for (const fn of [
      'getStrategy', 'createStrategyRecord', 'updateStrategyRecord', 'archiveStrategyRecord',
    ]) {
      const start = service.indexOf(`export async function ${fn}(`);
      assert.notEqual(start, -1, `${fn} must exist`);
      const body = service.slice(start, start + 500);
      assert.match(body, /requireProductBackend\(\)/);
      assert.ok(!/isDemoExperience\(\)/.test(body.slice(0, body.indexOf('requireProductBackend'))));
    }
  });
});
