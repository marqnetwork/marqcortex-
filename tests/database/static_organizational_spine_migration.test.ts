/**
 * CP-3 — the organizational spine migration, read as text.
 *
 * ── WHAT THIS CAN AND CANNOT DO ─────────────────────────────────────────────
 *
 * It proves the migration DECLARES the things CP-3 promised: the canonical
 * entities, the cross-tenant composite foreign keys, RLS on every table, soft
 * deletion, and a nullable `people.user_id`.
 *
 * It cannot prove any of them WORK. "Does a Beta administrator naming Alpha's
 * organization id get zero rows" is a statement about what a database does, and
 * `scripts/organizational-spine-scenarios.mjs` settles it against a real
 * PostgreSQL — ten properties, plus idempotency and rollback. This file is the
 * cheap check that runs everywhere; that one is the proof.
 *
 * The division matters because a static test is exactly the kind that passes
 * while the thing it names is broken. It is here to catch a constraint DELETED,
 * not to claim the constraint is correct.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const SPINE = read('supabase/migrations/20260917120000_cortex_organizational_spine.sql');
const RLS = read('supabase/migrations/20260917120001_cortex_organizational_spine_rls.sql');
const ROLLBACK = read('supabase/migrations/rollbacks/20260917120000_rollback_organizational_spine.sql');

const TABLES = ['business_units', 'departments', 'people', 'teams', 'team_memberships'];

describe('the canonical entities, and only the canonical ones', () => {
  it('declares the five tables ONT Ch11/Ch12 name', () => {
    for (const table of TABLES) {
      assert.match(
        SPINE,
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(`),
        `public.${table} is missing`,
      );
    }
  });

  it('invents no "function" entity, because the canon does not define one', () => {
    // ONT 11.2 Business Unit and 11.3 Department are the canonical divisions.
    // The CP-3 brief used "Department / Function"; the ontology defines
    // Department and says nothing about Function as an entity, and the brief
    // said explicitly not to invent a distinction the canon does not make.
    assert.ok(
      !/CREATE TABLE IF NOT EXISTS public\.functions/.test(SPINE),
      'a "functions" table was invented — ONT Ch11 defines Business Unit and Department',
    );
  });

  it('models no Workspace table, because 11.5 says a workspace does not alter the hierarchy', () => {
    assert.ok(
      !/CREATE TABLE IF NOT EXISTS public\.workspaces/.test(SPINE),
      'a workspaces table was added; CP-3 treats workspace as the operator\'s current organization',
    );
  });
});

describe('a person is not an authentication account (ONT 12.3)', () => {
  it('people.user_id is nullable', () => {
    // "Not every Identity is necessarily an active User." A NOT NULL here would
    // make a contractor, a new joiner or a colleague whose access was revoked
    // unrepresentable — and would have modelled the auth system instead of the
    // organization.
    const column = /user_id\s+UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL/;
    assert.match(SPINE, column, 'people.user_id is missing or has changed shape');
    assert.ok(
      !/user_id\s+UUID NOT NULL REFERENCES auth\.users/.test(SPINE),
      'people.user_id became NOT NULL — a person without a login is now unrepresentable',
    );
  });

  it('a person carries their own profile rather than borrowing the auth record', () => {
    for (const field of ['full_name', 'email', 'position_title']) {
      assert.ok(SPINE.includes(field), `people.${field} is missing (ONT 12.4 Profile)`);
    }
  });

  it('does not duplicate organization_memberships', () => {
    // The Identity↔Organization membership already exists and is keyed on
    // auth.users because it grants console access. CP-3 adds the Identity↔Team
    // half and touches neither the table nor its policies.
    assert.ok(
      !/CREATE TABLE IF NOT EXISTS public\.organization_memberships/.test(SPINE),
      'the spine redeclares organization_memberships',
    );
    assert.match(SPINE, /CREATE TABLE IF NOT EXISTS public\.team_memberships \(/);
  });
});

describe('a relationship cannot cross a tenant boundary', () => {
  /**
   * The constraint that does the work, and the reason a plain foreign key is
   * not enough: `REFERENCES people(id)` constrains WHICH ROW, not WHICH TENANT.
   * Each half of a cross-tenant structure is individually visible to its own
   * tenant, so no SELECT policy would ever reveal it.
   */
  const COMPOSITE: [string, RegExp][] = [
    ['departments.business_unit_id',
      /FOREIGN KEY \(business_unit_id, organization_id\)\s*REFERENCES public\.business_units \(id, organization_id\)/],
    ['departments.lead_person_id',
      /FOREIGN KEY \(lead_person_id, organization_id\)\s*REFERENCES public\.people \(id, organization_id\)/],
    ['people.department_id',
      /FOREIGN KEY \(department_id, organization_id\)\s*REFERENCES public\.departments \(id, organization_id\)/],
    ['people.reports_to_person_id',
      /FOREIGN KEY \(reports_to_person_id, organization_id\)\s*REFERENCES public\.people \(id, organization_id\)/],
    ['teams.department_id',
      /FOREIGN KEY \(department_id, organization_id\)\s*REFERENCES public\.departments \(id, organization_id\)/],
    ['teams.lead_person_id',
      /FOREIGN KEY \(lead_person_id, organization_id\)\s*REFERENCES public\.people \(id, organization_id\)/],
    ['team_memberships.team_id',
      /FOREIGN KEY \(team_id, organization_id\)\s*REFERENCES public\.teams \(id, organization_id\)/],
    ['team_memberships.person_id',
      /FOREIGN KEY \(person_id, organization_id\)\s*REFERENCES public\.people \(id, organization_id\)/],
  ];

  for (const [what, pattern] of COMPOSITE) {
    it(`${what} is pinned to the same organization`, () => {
      assert.match(SPINE, pattern, `${what} lost its composite foreign key`);
    });
  }

  it('nobody reports to themselves', () => {
    assert.match(SPINE, /people_no_self_report CHECK \(reports_to_person_id IS DISTINCT FROM id\)/);
  });
});

describe('every table is tenant-owned and follows the foundation', () => {
  for (const table of TABLES) {
    it(`${table} carries organization_id NOT NULL, soft deletion and an updated_at trigger`, () => {
      const block = SPINE.slice(
        SPINE.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`),
        SPINE.indexOf(`COMMENT ON TABLE public.${table}`),
      );
      assert.ok(block.length > 100, `could not read the ${table} block`);
      assert.match(block, /organization_id\s+UUID NOT NULL REFERENCES public\.organizations\(id\) ON DELETE CASCADE/);
      assert.match(block, /deleted_at\s+TIMESTAMPTZ/);
      assert.match(block, /created_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
      assert.match(SPINE, new RegExp(`CREATE TRIGGER ${table}_set_updated_at`));
    });
  }
});

describe('RLS reuses the existing authority, and adds no second system', () => {
  it('enables and FORCES row level security on all five', () => {
    for (const table of TABLES) {
      assert.match(RLS, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
      assert.match(RLS, new RegExp(`ALTER TABLE public\\.${table}\\s+FORCE ROW LEVEL SECURITY`));
    }
  });

  it('reads gate on membership and writes on a permission', () => {
    assert.match(RLS, /USING \(cortex\.is_organization_member\(organization_id\)\)/);
    assert.match(RLS, /cortex\.has_permission\(organization_id, 'organization\.structure\.manage'\)/);
  });

  it('UPDATE checks the NEW row as well as the old one', () => {
    // USING alone would let an authorised writer move a row INTO another
    // tenant: the old value passes, the new one is never examined.
    const update = RLS.slice(RLS.indexOf('_update_manage'));
    assert.match(update, /USING \(/);
    assert.match(update, /WITH CHECK \(/);
  });

  it('grants no DELETE to anybody, because these tables soft-delete', () => {
    assert.match(RLS, /GRANT SELECT, INSERT, UPDATE ON public\.people\s+TO authenticated/);
    assert.ok(
      !/GRANT[^;]*DELETE[^;]*TO authenticated/.test(RLS),
      'DELETE was granted — a hard delete takes reporting lines and team memberships with it via CASCADE',
    );
  });

  it('revokes everything from anon', () => {
    for (const table of TABLES) {
      assert.match(RLS, new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM anon`));
    }
  });

  it('introduces no parallel permission vocabulary', () => {
    // `members.read` / `members.manage` already exist and mean the same thing.
    assert.ok(
      !/'people\.read'|'people\.manage'/.test(RLS),
      'a second vocabulary for an authority the catalog already has',
    );
    assert.match(RLS, /'organization\.structure\.read'/);
    assert.match(RLS, /'organization\.structure\.manage'/);
  });
});

describe('the rollback removes the spine and nothing else', () => {
  it('drops all five tables', () => {
    for (const table of TABLES) {
      assert.match(ROLLBACK, new RegExp(`DROP TABLE IF EXISTS public\\.${table};`));
    }
  });

  it('spares the 2026-07-11 foundation', () => {
    for (const table of [
      'organizations', 'organization_memberships', 'organization_settings',
      'roles', 'permissions', 'role_permissions',
    ]) {
      assert.ok(
        !new RegExp(`DROP TABLE IF EXISTS public\\.${table};`).test(ROLLBACK),
        `the rollback drops public.${table}, which it does not own`,
      );
    }
  });

  it('uses no CASCADE, so it cannot quietly take something with it', () => {
    assert.ok(
      !/DROP TABLE[^;]*CASCADE/i.test(ROLLBACK),
      'a CASCADE drop would remove objects this rollback has not accounted for',
    );
  });

  it('removes the two permission keys it seeded, and their grants', () => {
    assert.match(ROLLBACK, /DELETE FROM public\.role_permissions/);
    assert.match(ROLLBACK, /DELETE FROM public\.permissions\s+WHERE key IN \('organization\.structure\.read', 'organization\.structure\.manage'\)/);
  });
});
