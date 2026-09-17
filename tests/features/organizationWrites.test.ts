/**
 * CHANGING THE ORGANIZATION — what a write may do, and what it may never do.
 *
 * CP-3 shipped a spine nothing could write to, so against a live project it was
 * permanently empty. CP-4 opened the write path, and opening a write path is
 * where tenancy models usually get broken: the read side had one question to
 * answer ("which rows are this tenant's") and the write side has three —
 * whose rows, whose authority, and whose fields.
 *
 * The third is the one this file is mostly about. A body arrives from a
 * browser, and the difference between a field map that ALLOWS and one that
 * DENIES is the difference between a new column being safe by default and
 * writable by default.
 *
 * ── WHAT IS PROVEN WHERE ────────────────────────────────────────────────────
 *
 *   here                        the shape of the write: which fields survive,
 *                               which are dropped, which failure each driver
 *                               error becomes, and that the tenant is the
 *                               server's on every statement
 *
 *   organizational-spine-       that PostgreSQL actually refuses the writes
 *   scenarios.mjs               this file assumes it refuses — a viewer's
 *                               INSERT, a cross-tenant reference, a suspended
 *                               membership
 *
 * Neither is sufficient alone. A perfect field map in front of missing RLS is
 * a service-key write surface with a nice API.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  addTeamMember,
  archiveSpineRow,
  buildSpineRow,
  classifyWriteError,
  createSpineRow,
  OrganizationWriteError,
  removeTeamMember,
  SPINE_ENTITIES,
  updateSpineRow,
  WRITE_STATUS,
  type WriteQueryBuilder,
  type WriteQueryClient,
} from '../../supabase/functions/server/organization/organizationWrites.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

interface RecordedWrite {
  table: string;
  verb: 'insert' | 'update';
  values: Record<string, unknown>;
  filters: { column: string; value: unknown }[];
  selected: string | undefined;
}

/** A PostgREST-shaped fake that records the statement and answers what it is told. */
function fakeClient(answer: { data: unknown; error: unknown } = { data: [{ id: 'new-1' }], error: null }) {
  const writes: RecordedWrite[] = [];

  const builderFor = (record: RecordedWrite): WriteQueryBuilder => {
    const builder: WriteQueryBuilder = {
      eq(column, value) { record.filters.push({ column, value }); return builder; },
      is(column, value) { record.filters.push({ column, value }); return builder; },
      select(columns) { record.selected = columns; return builder; },
      maybeSingle() { return Promise.resolve(answer); },
      then(onFulfilled, onRejected) {
        return Promise.resolve(answer).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const client: WriteQueryClient = {
    from(table) {
      return {
        insert(values) {
          const record: RecordedWrite = { table, verb: 'insert', values, filters: [], selected: undefined };
          writes.push(record);
          return builderFor(record);
        },
        update(values) {
          const record: RecordedWrite = { table, verb: 'update', values, filters: [], selected: undefined };
          writes.push(record);
          return builderFor(record);
        },
      };
    },
  };

  return { client, writes };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('the field map allows rather than denies', () => {
  it('drops a field no entity declares', () => {
    const row = buildSpineRow('person', { fullName: 'Ada', nickname: 'A', salary: 100 }, 'create');
    assert.deepEqual(Object.keys(row).sort(), ['full_name']);
  });

  it('refuses a caller-supplied organization id by never reading it', () => {
    // THE PROPERTY. Not "rejects" — there is nowhere for it to go. A deny-list
    // would have to be updated every time a column is added; this cannot be
    // out of date.
    const row = buildSpineRow(
      'person',
      { fullName: 'Ada', organization_id: ORG_B, organizationId: ORG_B },
      'create',
    );
    assert.ok(!('organization_id' in row));
    assert.ok(!JSON.stringify(row).includes(ORG_B));
  });

  it('refuses a caller-supplied id, deleted_at or created_at', () => {
    const row = buildSpineRow(
      'department',
      { name: 'Ops', id: 'chosen-by-me', deleted_at: null, created_at: '1999-01-01' },
      'create',
    );
    assert.deepEqual(Object.keys(row).sort(), ['key', 'name']);
  });

  it('refuses to link a person to an auth account', () => {
    // `user_id` is absent from the person spec on purpose: linking a person to
    // a login is granting console access, which is a different permission on a
    // different surface. `organization.structure.manage` is authority over the
    // SHAPE of the organization and not over who may sign in.
    const row = buildSpineRow('person', { fullName: 'Ada', user_id: 'u-1', userId: 'u-1' }, 'create');
    assert.ok(!('user_id' in row));
    assert.ok(!('hasConsoleAccess' in row));
  });

  it('declares no user_id field on any entity', () => {
    for (const [name, spec] of Object.entries(SPINE_ENTITIES)) {
      for (const field of Object.values(spec.fields)) {
        assert.notEqual(field.column, 'user_id', `${name} must not accept user_id`);
        assert.notEqual(field.column, 'organization_id', `${name} must not accept organization_id`);
        assert.notEqual(field.column, 'deleted_at', `${name} must not accept deleted_at`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('what a create requires, and what it derives', () => {
  it('requires a name', () => {
    assert.throws(() => buildSpineRow('department', {}, 'create'), /name is required/);
    assert.throws(() => buildSpineRow('department', { name: '   ' }, 'create'), /name is required/);
  });

  it('requires a full name for a person, by that name', () => {
    assert.throws(() => buildSpineRow('person', {}, 'create'), /fullName is required/);
  });

  it('derives the key from the name rather than demanding one', () => {
    // Every keyed table has a `*_key_normalized` CHECK and a per-tenant
    // uniqueness index. An operator naming a department "Client Services"
    // should not also have to invent `client-services`.
    assert.equal(buildSpineRow('department', { name: 'Client Services' }, 'create').key, 'client-services');
    assert.equal(buildSpineRow('team', { name: '  R&D  Pod ' }, 'create').key, 'r-d-pod');
  });

  it('normalises a supplied key to what the CHECK will accept', () => {
    assert.equal(buildSpineRow('team', { name: 'Pod', key: 'My TEAM!' }, 'create').key, 'my-team');
  });

  it('refuses a name with nothing a key can be made from', () => {
    assert.throws(
      () => buildSpineRow('team', { name: '!!!' }, 'create'),
      /must contain a letter or a number/,
    );
  });

  it('lower-cases an email rather than rejecting it', () => {
    // `people_email_normalized` requires lower case. A 400 for a capital letter
    // would be the schema's convention leaking out as a product defect.
    assert.equal(
      buildSpineRow('person', { fullName: 'Ada', email: '  Ada@Example.COM ' }, 'create').email,
      'ada@example.com',
    );
  });

  it('refuses a status outside the enum, by name', () => {
    assert.throws(
      () => buildSpineRow('person', { fullName: 'Ada', status: 'retired' }, 'create'),
      /active, invited, inactive/,
    );
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, undefined, 'person', 7, ['a']]) {
      assert.throws(() => buildSpineRow('person', body, 'create'), OrganizationWriteError);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('an update is partial, and null means clear', () => {
  it('writes only what was supplied', () => {
    const row = buildSpineRow('person', { positionTitle: 'Lead' }, 'update');
    assert.deepEqual(row, { position_title: 'Lead' });
  });

  it('writes null for a reference the operator cleared', () => {
    // THE DIFFERENCE THAT MATTERS. `undefined` is "not supplied" and is
    // skipped; `null` is "clear this" and is written. Collapsing them would
    // make a reporting line impossible to remove.
    assert.deepEqual(
      buildSpineRow('person', { reportsToPersonId: null }, 'update'),
      { reports_to_person_id: null },
    );
    assert.deepEqual(buildSpineRow('person', { positionTitle: '' }, 'update'), { position_title: null });
  });

  it('refuses an update that changes nothing', () => {
    assert.throws(() => buildSpineRow('person', { nickname: 'A' }, 'update'), /No changeable field/);
  });

  it('does not derive a key on update', () => {
    // Deriving here would silently rename the key whenever a name is edited,
    // breaking whatever referenced it.
    assert.deepEqual(buildSpineRow('team', { name: 'Renamed' }, 'update'), { name: 'Renamed' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('every statement carries the server’s tenant', () => {
  it('stamps the resolved organization on a create', async () => {
    const fake = fakeClient();
    await createSpineRow(fake.client, 'person', ORG_A, { fullName: 'Ada' });
    assert.equal(fake.writes[0].table, 'people');
    assert.equal(fake.writes[0].values.organization_id, ORG_A);
  });

  it('applies the tenant AFTER the body, so a body field cannot win', async () => {
    const fake = fakeClient();
    await createSpineRow(fake.client, 'person', ORG_A, { fullName: 'Ada', organization_id: ORG_B });
    assert.equal(fake.writes[0].values.organization_id, ORG_A);
  });

  it('matches both the id and the tenant on an update', async () => {
    const fake = fakeClient();
    await updateSpineRow(fake.client, 'department', ORG_A, 'd-1', { name: 'Ops' });
    const filters = fake.writes[0].filters;
    assert.ok(filters.some(f => f.column === 'id' && f.value === 'd-1'));
    assert.ok(filters.some(f => f.column === 'organization_id' && f.value === ORG_A));
  });

  it('refuses to edit an already-archived row', async () => {
    // Editing one would resurrect it, making archiving reversible by accident
    // rather than on purpose.
    const fake = fakeClient();
    await updateSpineRow(fake.client, 'team', ORG_A, 't-1', { name: 'Pod' });
    assert.ok(fake.writes[0].filters.some(f => f.column === 'deleted_at' && f.value === null));
  });

  it('archives with an UPDATE and never a DELETE', async () => {
    // The RLS policies refuse DELETE to everybody, and a hard delete would take
    // reporting lines and team memberships with it through the composite keys.
    const fake = fakeClient();
    await archiveSpineRow(fake.client, 'person', ORG_A, 'p-1', '2026-01-01T00:00:00Z');
    assert.equal(fake.writes[0].verb, 'update');
    assert.equal(fake.writes[0].values.deleted_at, '2026-01-01T00:00:00Z');
    assert.ok(fake.writes[0].filters.some(f => f.column === 'organization_id' && f.value === ORG_A));
  });

  it('stamps the tenant on a team membership too', async () => {
    const fake = fakeClient();
    await addTeamMember(fake.client, ORG_A, { teamId: 't-1', personId: 'p-1', isLead: true });
    assert.equal(fake.writes[0].values.organization_id, ORG_A);
    assert.equal(fake.writes[0].values.is_lead, true);
  });

  it('defaults is_lead to false rather than to whatever was sent', async () => {
    const fake = fakeClient();
    await addTeamMember(fake.client, ORG_A, { teamId: 't-1', personId: 'p-1', isLead: 'yes' });
    assert.equal(fake.writes[0].values.is_lead, false);
  });

  it('removes a team member by soft-deleting, scoped to the tenant', async () => {
    const fake = fakeClient();
    await removeTeamMember(fake.client, ORG_A, 't-1', 'p-1', '2026-01-01T00:00:00Z');
    assert.equal(fake.writes[0].verb, 'update');
    const columns = fake.writes[0].filters.map(f => f.column);
    assert.ok(columns.includes('organization_id'));
    assert.ok(columns.includes('team_id'));
    assert.ok(columns.includes('person_id'));
  });

  it('refuses a membership with a missing id before touching the database', async () => {
    const fake = fakeClient();
    await assert.rejects(
      () => addTeamMember(fake.client, ORG_A, { teamId: 't-1' }),
      /teamId and personId are required/,
    );
    assert.equal(fake.writes.length, 0);
  });

  it('names self-reporting rather than letting the CHECK say "not allowed"', async () => {
    const fake = fakeClient();
    await assert.rejects(
      () => updateSpineRow(fake.client, 'person', ORG_A, 'p-1', { reportsToPersonId: 'p-1' }),
      /cannot report to themselves/,
    );
    assert.equal(fake.writes.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a refusal, a duplicate and a breakage are different answers', () => {
  const failureOf = (error: unknown) => classifyWriteError(error).failure;

  it('reads an RLS refusal as forbidden', () => {
    assert.equal(failureOf({ code: '42501' }), 'forbidden');
    assert.equal(failureOf({ message: 'new row violates row-level security policy' }), 'forbidden');
  });

  it('reads a unique violation as a conflict', () => {
    assert.equal(failureOf({ code: '23505' }), 'conflict');
  });

  it('reads a foreign-key violation as a conflict, not a crash', () => {
    // This is what a cross-tenant reference looks like from PostgREST: the
    // composite key makes the row unrepresentable, and the caller asked for
    // something the organization's own shape forbids.
    assert.equal(failureOf({ code: '23503' }), 'conflict');
  });

  it('reads a CHECK violation as an invalid field', () => {
    assert.equal(failureOf({ code: '23514' }), 'invalid');
  });

  it('reads anything else as a failure', () => {
    assert.equal(failureOf({ code: '57014' }), 'failed');
    assert.equal(failureOf(new Error('socket hang up')), 'failed');
    assert.equal(failureOf(null), 'failed');
  });

  it('never repeats the driver’s message to the caller', () => {
    // A PostgREST error body names columns, constraints and failing values. An
    // operator typing a colleague's address should not be shown a constraint
    // definition.
    const driver = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "people_org_email_uidx"',
      details: 'Key (organization_id, email)=(aaa, ada@example.com) already exists.',
    };
    const classified = classifyWriteError(driver);
    assert.ok(!classified.detail.includes('people_org_email_uidx'));
    assert.ok(!classified.detail.includes('ada@example.com'));
    assert.match(classified.detail, /already exists/);
  });

  it('maps each failure to its own status', () => {
    assert.deepEqual(WRITE_STATUS, {
      invalid: 400, forbidden: 403, 'not-found': 404, conflict: 409, failed: 500,
    });
  });

  it('reports a row that matched nothing as not-found, without saying why', async () => {
    // Under RLS "does not exist" and "is not yours" are deliberately the same
    // answer: telling them apart would confirm whether an id exists in some
    // other organization for anyone willing to guess.
    const fake = fakeClient({ data: [], error: null });
    await assert.rejects(
      () => updateSpineRow(fake.client, 'person', ORG_A, 'p-9', { positionTitle: 'X' }),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationWriteError);
        assert.equal((err as OrganizationWriteError).failure, 'not-found');
        assert.ok(!/permission|belongs|another/i.test((err as OrganizationWriteError).detail));
        return true;
      },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the routes do not authorize the write themselves', () => {
  const server = stripComments(read('supabase/functions/server/index.tsx'));

  it('runs spine writes under the caller’s own JWT, not the service key', () => {
    // THE DESIGN DECISION OF THIS SPRINT. Evaluating
    // `organization.structure.manage` in TypeScript would be a second copy of
    // an authority model the database already implements and already has ten
    // proven properties about — and the copy that drifts.
    assert.match(server, /function callerScopedClient\(/);
    assert.match(server, /SUPABASE_ANON_KEY/);
    const helper = server.slice(server.indexOf('function callerScopedClient('));
    assert.match(helper.slice(0, 500), /Authorization: authHeader/);
    assert.ok(
      !/callerScopedClient[\s\S]{0,300}SERVICE_ROLE/.test(helper.slice(0, 500)),
      'the caller-scoped client must never hold the service key',
    );
  });

  it('builds every write context through one helper', () => {
    // Nine routes each re-deciding what an unauthenticated caller gets, and
    // which organization to write into, is where the ninth takes the tenant
    // from a parameter.
    assert.match(server, /async function spineWriteContext\(/);
    const context = server.slice(
      server.indexOf('async function spineWriteContext('),
      server.indexOf('function writeFailureResponse('),
    );
    assert.match(context, /verifyTeamToken/);
    assert.match(context, /resolveWorkspaceForUser/);
    assert.match(context, /callerScopedClient/);
    // The tenant comes from the resolved workspace and from nowhere else.
    assert.ok(!/c\.req\.query\(|c\.req\.param\('organization/.test(context));
  });

  it('routes a record type through a map, never a path parameter to a table', () => {
    // `:entity` reaching a table name is how a route grows an arbitrary-table
    // write.
    assert.match(server, /const SPINE_ROUTE_ENTITIES: Record<string, SpineEntityName>/);
    const map = server.slice(server.indexOf('const SPINE_ROUTE_ENTITIES'));
    assert.match(map.slice(0, 300), /'business-units': 'businessUnit'/);
    assert.match(server, /if \(!entity\) return c\.json\(\{ error: "Unknown organization record type" \}, 404\)/);
  });

  it('reports manage authority for display, and says so', () => {
    assert.match(server, /membershipHoldsPermission\(/);
    assert.match(server, /canManageStructure/);
    assert.match(server, /'organization\.structure\.manage'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the display-only permission probe fails closed', () => {
  const directory = read('supabase/functions/server/ai/adapters/membershipDirectory.ts');

  it('says in its own text that it is not the authorization', () => {
    assert.match(directory, /FOR DISPLAY, AND ONLY FOR DISPLAY/);
    assert.match(directory, /THIS IS NOT THE AUTHORIZATION/);
  });

  it('returns false on any error rather than throwing or assuming', () => {
    const body = directory.slice(directory.indexOf('export async function membershipHoldsPermission('));
    const fn = body.slice(0, body.indexOf('\nfunction firstValue'));
    // Every error path answers false. A lookup that did not work is not
    // evidence that somebody may reshape the organization.
    const returns = fn.match(/return (?:true|false);/g) ?? [];
    assert.ok(returns.filter(r => r.includes('false')).length >= 5);
    assert.match(fn, /catch \{\s*\n?\s*return false;/);
  });

  it('reads flat rather than through a four-level embed', () => {
    const body = directory.slice(directory.indexOf('export async function membershipHoldsPermission('));
    const fn = body.slice(0, body.indexOf('\nfunction firstValue'));
    // An embedded filter on a non-inner relation restricts nothing — the
    // silent drop this module documents at length.
    assert.ok(!/select\('[^']*\([^']*\(/.test(fn), 'no nested embed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the write path never falls back to demo data', () => {
  const service = stripComments(read('src/app/services/dataService.ts'));

  it('requires a real backend for every organization write', () => {
    for (const fn of [
      'createOrganizationRecord', 'updateOrganizationRecord', 'archiveOrganizationRecord',
      'addOrganizationTeamMember', 'removeOrganizationTeamMember',
    ]) {
      const start = service.indexOf(`export async function ${fn}(`);
      assert.notEqual(start, -1, `${fn} must exist`);
      const body = service.slice(start, start + 600);
      assert.match(body, /requireProductBackend\(\)/, `${fn} must require a real backend`);
      // A WRITE answered by a fixture would report a change no system made —
      // worse than CP-1's read-side defect, not a milder version of it.
      assert.ok(
        !/isDemoExperience\(\)/.test(body.slice(0, body.indexOf('requireProductBackend'))),
        `${fn} must not branch to the demo backend`,
      );
    }
  });
});
