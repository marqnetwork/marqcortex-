/**
 * THE ORGANIZATIONAL SPINE, ABOVE THE DATABASE.
 *
 * The database refuses every cross-tenant crossing on its own — RLS on all five
 * spine tables, composite foreign keys that make a cross-tenant reference
 * unrepresentable — and `scripts/organizational-spine-scenarios.mjs` proves it
 * empirically against real PostgreSQL. What that proof cannot cover is the edge
 * function, which holds the service key and therefore bypasses RLS entirely.
 *
 * For anything this repository returns, its own `organization_id` filter IS the
 * boundary. So this suite drives the repository over a recorded query chain and
 * asserts the filter on every single read — not by reading the source for the
 * word `eq`, but by watching what the client was actually asked for.
 *
 * It also holds the line ONT 12.3 draws and CP-3 Step 6 restates: an
 * organizational person is not an authentication user. A person with no login
 * is an ordinary member, the auth user id never leaves the server, and the
 * surface is required to say which list is which.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  OrganizationReadError,
  readOrganizationStructure,
  summariseStructure,
  SPINE_TABLES,
  type SpineQueryBuilder,
  type SpineQueryClient,
} from '../../supabase/functions/server/organization/organizationRepository.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

/**
 * Comments explain at length what a file must NOT do, and the explanation must
 * never be the match. Stripped before any scan for a forbidden string.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

interface RecordedRead {
  table: string;
  columns: string;
  filters: { method: 'eq' | 'is' | 'order'; column: string; value: unknown }[];
}

/**
 * A PostgREST-shaped fake that records every read.
 *
 * `rows` is keyed by table, so a test can give one table rows and leave the
 * others empty; `failOn` makes one table error, which is how the failure path
 * is driven without breaking the others.
 */
function fakeClient(
  rows: Partial<Record<string, Record<string, unknown>[]>> = {},
  failOn?: string,
) {
  const reads: RecordedRead[] = [];

  const client: SpineQueryClient = {
    from(table) {
      return {
        select(columns) {
          const record: RecordedRead = { table, columns, filters: [] };
          reads.push(record);
          const builder: SpineQueryBuilder = {
            eq(column, value) { record.filters.push({ method: 'eq', column, value }); return builder; },
            is(column, value) { record.filters.push({ method: 'is', column, value }); return builder; },
            order(column) { record.filters.push({ method: 'order', column, value: null }); return builder; },
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

const PERSON_ROW = {
  id: 'p-1', full_name: 'Alpha Admin', email: 'admin@alpha.test',
  position_title: 'Partner', department_id: 'd-1', reports_to_person_id: null,
  status: 'active', user_id: 'auth-user-1',
};

const CONTRACTOR_ROW = {
  id: 'p-2', full_name: 'Alpha Contractor', email: null,
  position_title: 'Contract Engineer', department_id: 'd-1',
  reports_to_person_id: 'p-1', status: 'active', user_id: null,
};

// ═══════════════════════════════════════════════════════════════════════════
describe('every spine read is scoped to one tenant', () => {
  it('reads all five spine tables and nothing else', async () => {
    const fake = fakeClient();
    await readOrganizationStructure(fake.client, ORG_A);
    assert.deepEqual(
      fake.reads.map((r) => r.table).sort(),
      Object.values(SPINE_TABLES).slice().sort(),
    );
  });

  it('filters EVERY read on the organization it was given', async () => {
    // The load-bearing assertion of this file. The service key bypasses RLS, so
    // a read that forgot this filter would return another tenant's rows with
    // nothing below it to object.
    const fake = fakeClient();
    await readOrganizationStructure(fake.client, ORG_A);
    for (const read of fake.reads) {
      assert.ok(
        read.filters.some(
          (f) => f.method === 'eq' && f.column === 'organization_id' && f.value === ORG_A,
        ),
        `${read.table} was read without an organization filter`,
      );
    }
  });

  it('filters EVERY read on undeleted rows', async () => {
    const fake = fakeClient();
    await readOrganizationStructure(fake.client, ORG_A);
    for (const read of fake.reads) {
      assert.ok(
        read.filters.some((f) => f.method === 'is' && f.column === 'deleted_at' && f.value === null),
        `${read.table} was read without a soft-delete filter`,
      );
    }
  });

  it('never names a second organization, whatever else is passed', async () => {
    const fake = fakeClient();
    await readOrganizationStructure(fake.client, ORG_A);
    const values = fake.reads.flatMap((r) => r.filters.map((f) => f.value));
    assert.ok(!values.includes(ORG_B), 'no read may reference another tenant');
  });

  it('turns a failed read into a named error rather than an empty organization', async () => {
    // An empty organization and an unreadable one are different answers. A
    // repository that swallowed this would hand the surface `people: []` and
    // the surface would render a perfectly plausible lie.
    const fake = fakeClient({}, SPINE_TABLES.people);
    await assert.rejects(
      () => readOrganizationStructure(fake.client, ORG_A),
      (err: unknown) => {
        assert.ok(err instanceof OrganizationReadError);
        assert.match((err as Error).message, /people/);
        return true;
      },
    );
  });

  it('returns an empty structure for an organization with no rows', async () => {
    const fake = fakeClient();
    const structure = await readOrganizationStructure(fake.client, ORG_A);
    assert.deepEqual(structure, {
      businessUnits: [], departments: [], people: [], teams: [], teamMemberships: [],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('an organizational person is not an authentication user', () => {
  it('admits a person with no login as an ordinary member', async () => {
    // ONT 12.3: "Not every Identity is necessarily an active User". The schema
    // makes `people.user_id` nullable because of it, and a repository that
    // dropped or flagged such a row would undo that decision one layer up.
    const fake = fakeClient({ [SPINE_TABLES.people]: [PERSON_ROW, CONTRACTOR_ROW] });
    const { people } = await readOrganizationStructure(fake.client, ORG_A);
    assert.equal(people.length, 2);
    const contractor = people.find((p) => p.id === 'p-2');
    assert.equal(contractor?.fullName, 'Alpha Contractor');
    assert.equal(contractor?.hasConsoleAccess, false);
    assert.equal(contractor?.departmentId, 'd-1');
    assert.equal(contractor?.reportsToPersonId, 'p-1');
  });

  it('reduces the auth user id to a boolean and never carries it', async () => {
    const fake = fakeClient({ [SPINE_TABLES.people]: [PERSON_ROW] });
    const { people } = await readOrganizationStructure(fake.client, ORG_A);
    assert.equal(people[0].hasConsoleAccess, true);
    assert.ok(!('userId' in people[0]), 'the auth id must not reach the record');
    assert.ok(!JSON.stringify(people).includes('auth-user-1'), 'the auth id must not reach the wire');
  });

  it('counts the people without a login rather than hiding them', () => {
    const summary = summariseStructure({
      businessUnits: [],
      departments: [],
      teams: [],
      teamMemberships: [],
      people: [
        { id: 'a', fullName: 'A', email: null, positionTitle: null, departmentId: 'd', reportsToPersonId: null, status: 'active', hasConsoleAccess: true },
        { id: 'b', fullName: 'B', email: null, positionTitle: null, departmentId: null, reportsToPersonId: null, status: 'active', hasConsoleAccess: false },
        { id: 'c', fullName: 'C', email: null, positionTitle: null, departmentId: null, reportsToPersonId: null, status: 'active', hasConsoleAccess: false },
      ],
    });
    assert.equal(summary.people, 3);
    assert.equal(summary.peopleWithoutConsoleAccess, 2);
    // People outside the structure are what makes an org chart wrong, and they
    // are invisible everywhere else. Counted here, and shown on the surface.
    assert.equal(summary.unassignedPeople, 2);
  });

  it('keeps an empty email as null rather than as an empty string', async () => {
    const fake = fakeClient({ [SPINE_TABLES.people]: [{ ...CONTRACTOR_ROW, email: '   ' }] });
    const { people } = await readOrganizationStructure(fake.client, ORG_A);
    assert.equal(people[0].email, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the routes take no organization from the caller', () => {
  const server = read('supabase/functions/server/index.tsx');

  /** The body of one route handler, so an assertion cannot match another. */
  function routeBody(path: string): string {
    const marker = `app.get("/make-server-324f4fbe/${path}"`;
    const start = server.indexOf(marker);
    assert.notEqual(start, -1, `${path} route must exist`);
    const end = server.indexOf('\napp.', start + marker.length);
    return server.slice(start, end === -1 ? server.length : end);
  }

  for (const path of ['organization/context', 'organization/structure']) {
    it(`${path} resolves the tenant from the session, not the request`, () => {
      const body = routeBody(path);
      assert.match(body, /resolveWorkspaceForUser\(/);
      // No path parameter, no query parameter, no body field naming a tenant.
      assert.ok(!/c\.req\.param\(/.test(body), 'no path parameter');
      assert.ok(!/c\.req\.query\(/.test(body), 'no query parameter');
      assert.ok(!/c\.req\.json\(/.test(body), 'no request body');
    });

    it(`${path} refuses an unauthenticated caller before reading anything`, () => {
      const body = routeBody(path);
      const guard = body.indexOf('verifyTeamToken');
      const resolve = body.indexOf('resolveWorkspaceForUser');
      assert.ok(guard !== -1 && guard < resolve, 'the token check comes first');
      assert.match(body, /Unauthorized/);
    });
  }

  it('the structure route reads the spine only through the scoped repository', () => {
    const body = routeBody('organization/structure');
    assert.match(body, /readOrganizationStructure\(/);
    // The organization id it passes is the RESOLVED one and no other value.
    assert.match(body, /workspace\.workspace\.organizationId/);
    assert.ok(!/\.from\(/.test(body), 'the route writes no query of its own');
  });

  it('the structure route answers a missing workspace with a reason, not an empty organization', () => {
    const body = routeBody('organization/structure');
    assert.match(body, /if \(!workspace\.workspace\)/);
    assert.match(body, /workspacePayload\(workspace\)/);
    // A refusal is a 403 and an absence is a 404. One status for both would
    // make "your account cannot see this" indistinguishable from "there is
    // nothing here".
    assert.match(body, /'permission-denied' \? 403 : 404/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the surface tells the two lists apart', () => {
  const spine = read('src/app/components/OrganizationSpine.tsx');
  const team = read('src/app/components/TeamManagement.tsx');

  it('renders the spine through the five honest states', () => {
    assert.match(spine, /ProductDataState/);
    assert.match(spine, /useProductData/);
  });

  it('never answers a failure with data of its own', () => {
    // CP-4 added catches — a write that fails has to say so — so "no catch at
    // all" is no longer the invariant. What still holds, and is the thing CP-1
    // actually established, is that a catch here may set an ERROR and may
    // never produce rows: the read path's one catch lives in `useProductData`,
    // and every catch in this file assigns to an error state and nothing else.
    const rendered = stripComments(spine);
    const blocks = rendered.match(/catch\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/g) ?? [];
    assert.ok(blocks.length > 0, 'expected the write path to handle its own failures');
    for (const block of blocks) {
      assert.ok(
        /setActionError|setError/.test(block),
        `a catch in the spine surface must report the failure: ${block.slice(0, 80)}`,
      );
      assert.ok(
        !/setEditor\(|structure\s*=|people\s*=/.test(block),
        'a catch must never produce or alter organization data',
      );
    }
  });

  it('labels whether a person can sign in', () => {
    assert.match(spine, /hasConsoleAccess/);
    assert.match(spine, /No console login/);
  });

  it('offers its write controls only to an account the server says may write', () => {
    // CP-2's rule, at CP-4: a control that cannot do its job must not be
    // offered. The spine is writable now, so the rule becomes a GATE rather
    // than an absence — and the gate has to be the server's answer, not the
    // team role the browser happens to hold.
    const rendered = stripComments(spine);
    assert.match(rendered, /canManageStructure === true/);
    assert.match(rendered, /canManage && /, 'the add controls are gated on it');
    // Absent reads as FALSE. A backend that did not report the flag has not
    // said the operator may write, and `!== false` would offer the buttons on
    // a maybe.
    assert.ok(
      !/canManageStructure\s*!==\s*false/.test(rendered),
      'an absent flag must not be treated as permission',
    );
  });

  it('renders no disabled write control for a viewer', () => {
    // A disabled button is a promise that signing in differently would help.
    // For a viewer that is true and for a suspended membership it is not, so
    // the surface shows nothing rather than something greyed out.
    const rendered = stripComments(spine);
    assert.ok(
      !/disabled=\{!canManage\}|disabled=\{!\s*canManage/.test(rendered),
      'write controls are withheld, not disabled',
    );
  });

  it('puts the organization above the console roster, and renames the roster', () => {
    assert.match(team, /<OrganizationSpine accessToken=\{accessToken\} \/>/);
    assert.match(team, /Console access/);
    const spineAt = team.indexOf('<OrganizationSpine');
    const rosterAt = team.indexOf('>Console access<');
    assert.ok(spineAt !== -1 && rosterAt !== -1 && spineAt < rosterAt,
      'the organization comes before the subset of it that can sign in');
  });

  it('says on the page that the two lists are different', () => {
    assert.match(team, /belong to\s*\n?\s*the organization above without appearing here/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the destination says what it now shows', () => {
  const navigation = read('src/app/core/navigationModel.ts');
  const capability = read('src/app/core/capabilityStatus.ts');

  it('is labelled Organization, and keeps its id', () => {
    assert.match(navigation, /id: 'team',[\s\S]*?label: 'Organization'/);
    // The id is the URL. Renaming it would break every existing link for a
    // wording improvement.
    assert.match(navigation, /id: 'team'/);
  });

  it('is findable by the words a person would actually search for', () => {
    const block = navigation.slice(navigation.indexOf("id: 'team',"));
    for (const word of ['organization', 'department', 'team']) {
      assert.ok(block.slice(0, 900).includes(`'${word}'`), `keywords must include ${word}`);
    }
  });

  it('records that the spine is read-only in CP-3', () => {
    const block = capability.slice(capability.indexOf('  team: {'));
    assert.match(block.slice(0, 900), /read-only in CP-3/);
    assert.match(block.slice(0, 900), /CP-4/);
  });
});
