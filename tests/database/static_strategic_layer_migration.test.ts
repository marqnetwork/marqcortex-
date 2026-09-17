/**
 * CP-4 — the strategic layer migration, read as text.
 *
 * The same division of labour the spine's static test describes: this proves
 * the migration DECLARES what CP-4 promised, and
 * `scripts/organizational-spine-scenarios.mjs` proves fourteen of those things
 * actually hold against a real PostgreSQL. This file is the cheap check that
 * runs everywhere; that one is the proof.
 *
 * It exists to catch a constraint DELETED, not to claim a constraint is right.
 *
 * It also guards the two DELIBERATE ABSENCES, which no runtime test can: that
 * `Opportunity` was not invented while the ontology has no chapter for it, and
 * that `Objective` was not implied while Cortex has no such entity. An absence
 * is exactly the kind of decision a later sprint reverses by accident.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const STRATEGY = read('supabase/migrations/20260918120000_cortex_strategic_layer.sql');
const RLS = read('supabase/migrations/20260918120001_cortex_strategic_layer_rls.sql');
const ROLLBACK = read('supabase/migrations/rollbacks/20260918120000_rollback_strategic_layer.sql');

const TABLES = ['goals', 'decisions', 'risks'];

/** SQL comments explain at length what a migration must NOT do. */
const body = (sql: string) => sql.replace(/^\s*--.*$/gm, '');

describe('the three canonical entities, and only those', () => {
  it('declares the tables ONT 13.4, 14.8 and 17.6 name', () => {
    for (const table of TABLES) {
      assert.match(
        STRATEGY,
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(`),
        `public.${table} is missing`,
      );
    }
  });

  it('invents no Opportunity, because the ontology has no chapter for one', () => {
    // It IS a first-class peer of Risk in the Product Experience canon and it
    // appears in the Master Blueprint's engagement chain — with three open
    // readings (the inverse of Risk, a commercial pipeline entity, or two
    // concepts sharing one word). Choosing one here would settle a canon
    // question with a migration. See MARQ_CORTEX_CP4_PREPARATION.md §1.
    assert.ok(!/CREATE TABLE[^;]*opportunit/i.test(body(STRATEGY)));
    assert.ok(!/CREATE TABLE[^;]*\bvalue\b/i.test(body(STRATEGY)));
  });

  it('implies no Objective, because Cortex has no such entity', () => {
    // ONT 13.4 defines a Goal in terms of an Objective, and Cortex has neither
    // Objective (13.3) nor Initiative (13.1). A nullable `objective_id` would
    // suggest a parent that is not there; adding one later is additive.
    assert.ok(!/objective_id/i.test(body(STRATEGY)));
    assert.ok(!/initiative_id/i.test(body(STRATEGY)));
  });

  it('cites the chapter each table comes from', () => {
    assert.match(STRATEGY, /ONT 13\.4/);
    assert.match(STRATEGY, /ONT 14\.8/);
    assert.match(STRATEGY, /ONT 17\.6/);
  });
});

describe('a cross-tenant reference is unrepresentable', () => {
  it('gives every table a composite uniqueness key to be referenced by', () => {
    for (const table of TABLES) {
      if (table === 'goals') {
        assert.match(STRATEGY, /CONSTRAINT goals_id_org_uk UNIQUE \(id, organization_id\)/);
      } else {
        assert.match(
          STRATEGY,
          new RegExp(`CONSTRAINT ${table}_id_org_uk UNIQUE \\(id, organization_id\\)`),
        );
      }
    }
  });

  it('carries organization_id in EVERY cross-table foreign key', () => {
    // The property the whole tenancy model rests on: a cross-tenant reference
    // is not rejected at runtime, it cannot be written down.
    const expected = [
      ['goals_owner_same_org', 'owner_person_id', 'people'],
      ['decisions_decider_same_org', 'decided_by_person_id', 'people'],
      ['decisions_goal_same_org', 'goal_id', 'goals'],
      ['risks_owner_same_org', 'owner_person_id', 'people'],
      ['risks_goal_same_org', 'goal_id', 'goals'],
    ] as const;

    for (const [name, column, target] of expected) {
      assert.match(
        STRATEGY,
        new RegExp(
          `CONSTRAINT ${name}\\s*\\n?\\s*FOREIGN KEY \\(${column}, organization_id\\)\\s*\\n?\\s*REFERENCES public\\.${target} \\(id, organization_id\\)`,
        ),
        `${name} must be a composite key into ${target}`,
      );
    }
  });

  it('declares no single-column foreign key into people or goals', () => {
    // The mutation this guards: weakening one composite key to a single column
    // makes assertion 3 of the scenario suite fail with a TENANT BREACH, which
    // is how the guard was shown to be real.
    const sql = body(STRATEGY);
    assert.ok(
      !/FOREIGN KEY \((?:owner_person_id|decided_by_person_id|goal_id)\)\s*\n?\s*REFERENCES/.test(sql),
      'a single-column reference into people or goals would let a tenant boundary be crossed',
    );
  });
});

describe('what the canon requires, as constraints', () => {
  it('requires a decided decision to name its decider and date', () => {
    // ONT 14.8 lists "traceable" among a Decision's characteristics. Without
    // this, `decided` is a status anybody can set on a record with nobody
    // behind it — traceability claimed in the schema and optional in practice.
    assert.match(STRATEGY, /CONSTRAINT decisions_decided_is_attributed CHECK \(/);
    assert.match(STRATEGY, /status <> 'decided'/);
    assert.match(STRATEGY, /decided_by_person_id IS NOT NULL AND decided_on IS NOT NULL/);
  });

  it('requires an accepted risk to have had its tolerance decided', () => {
    // ONT 17.6: a Risk is evaluated by likelihood, impact and tolerance.
    assert.match(STRATEGY, /CONSTRAINT risks_accepted_is_assessed CHECK \(/);
    assert.match(STRATEGY, /status <> 'accepted' OR tolerance <> 'unset'/);
  });

  it('uses ONT 13.13 execution states rather than inventing a vocabulary', () => {
    for (const state of ['planned', 'in_progress', 'on_hold', 'under_review', 'completed', 'cancelled']) {
      assert.ok(STRATEGY.includes(`'${state}'`), `goal status ${state} is missing`);
    }
  });

  it('records likelihood, impact and tolerance as the canon names them', () => {
    assert.match(STRATEGY, /likelihood\s+TEXT NOT NULL/);
    assert.match(STRATEGY, /impact\s+TEXT NOT NULL/);
    assert.match(STRATEGY, /tolerance\s+TEXT NOT NULL/);
    // TEXT with a CHECK, not an enum type: the ontology defines no scale, and
    // an enum is a schema change to extend.
    assert.ok(!/CREATE TYPE/.test(STRATEGY));
  });

  it('keeps a goal measurable without forcing a numeric unit', () => {
    // The canon's own examples are "500 customers", "under two minutes" and
    // "95%" — three units, one inverted. A numeric column would push every
    // goal that did not fit into the statement instead.
    assert.match(STRATEGY, /measure\s+TEXT/);
    assert.match(STRATEGY, /target_value\s+TEXT/);
    assert.ok(!/target_value\s+(NUMERIC|INTEGER|BIGINT|DECIMAL)/i.test(STRATEGY));
  });

  it('leaves due_on nullable, because ONT 13.4 says "where applicable"', () => {
    assert.match(STRATEGY, /due_on\s+DATE,/);
    assert.ok(!/due_on\s+DATE NOT NULL/.test(STRATEGY));
  });
});

describe('ownership runs to a person, not to an auth account', () => {
  it('owns goals and risks by person, never by user_id', () => {
    // ONT 12.3: not every Identity is an active User. A goal can be owned by
    // somebody with no console login, and the scenario suite proves it.
    assert.match(STRATEGY, /owner_person_id\s+UUID/);
    assert.ok(!/user_id/.test(body(STRATEGY)), 'the strategic layer must not reference auth.users');
    assert.ok(!/auth\.users/.test(body(STRATEGY)));
  });

  it('clears the reference rather than deleting the record when a person goes', () => {
    // ON DELETE SET NULL, everywhere. A goal whose owner left is an unowned
    // goal, which the summary counts — not a goal that vanished.
    const matches = STRATEGY.match(/ON DELETE SET NULL/g) ?? [];
    assert.ok(matches.length >= 5, `expected 5 SET NULL references, found ${matches.length}`);
    assert.ok(!/ON DELETE CASCADE[\s\S]{0,80}people/.test(STRATEGY));
  });
});

describe('RLS, and the permissions behind it', () => {
  it('enables and FORCES row level security on all three tables', () => {
    for (const table of TABLES) {
      assert.match(RLS, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
      assert.match(RLS, new RegExp(`ALTER TABLE public\\.${table}\\s+FORCE ROW LEVEL SECURITY`));
    }
  });

  it('checks BOTH USING and WITH CHECK on update', () => {
    // USING alone lets an authorised writer move a row INTO another tenant: the
    // old value passes the check and the new one is never examined.
    const update = RLS.slice(RLS.indexOf('_update_strategy'));
    assert.match(update, /USING \(/);
    assert.match(update, /WITH CHECK \(/);
  });

  it('grants no DELETE to anybody', () => {
    assert.ok(!/GRANT[^;]*DELETE[^;]*TO authenticated/.test(RLS));
    for (const table of TABLES) {
      assert.match(RLS, new RegExp(`GRANT SELECT, INSERT, UPDATE ON public\\.${table}\\s+TO authenticated`));
    }
  });

  it('revokes everything from anon', () => {
    for (const table of TABLES) {
      assert.match(RLS, new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM anon`));
    }
  });

  it('reuses the existing helpers rather than defining new ones', () => {
    assert.match(RLS, /cortex\.is_organization_member\(organization_id\)/);
    assert.match(RLS, /cortex\.has_permission\(organization_id, 'strategy\.(read|manage)'\)/);
    assert.ok(!/CREATE OR REPLACE FUNCTION/.test(RLS), 'no second permission system');
  });

  it('adds two keys to the existing catalogue and no parallel one', () => {
    assert.match(RLS, /'strategy\.read'/);
    assert.match(RLS, /'strategy\.manage'/);
    assert.match(RLS, /INSERT INTO public\.permissions \(key, name, description\)/);
    assert.match(RLS, /INSERT INTO public\.role_permissions \(role_id, permission_id\)/);
  });

  it('follows the structure keys rather than granting to a hard-coded role', () => {
    // A migration that named `org_admin` directly would silently stop granting
    // the moment an organization defined a custom role.
    assert.match(RLS, /'organization\.structure\.read',\s*'strategy\.read'/);
    assert.match(RLS, /'organization\.structure\.manage',\s*'strategy\.manage'/);
  });
});

describe('the rollback is safe to run, and safe to run twice', () => {
  it('drops in reverse dependency order, with no CASCADE', () => {
    const risks = ROLLBACK.indexOf('DROP TABLE IF EXISTS public.risks');
    const decisions = ROLLBACK.indexOf('DROP TABLE IF EXISTS public.decisions');
    const goals = ROLLBACK.indexOf('DROP TABLE IF EXISTS public.goals');
    assert.ok(risks !== -1 && decisions !== -1 && goals !== -1);
    // Both reference `goals`, so `goals` goes last.
    assert.ok(risks < goals && decisions < goals, 'goals must be dropped last');
    // Comments first: this file explains at length why there is no CASCADE,
    // and the explanation must not be the match.
    assert.ok(!/CASCADE/.test(body(ROLLBACK)), 'CASCADE would hide a table this script forgot');
  });

  it('removes the permission keys and their grants', () => {
    assert.match(ROLLBACK, /DELETE FROM public\.role_permissions/);
    assert.match(ROLLBACK, /DELETE FROM public\.permissions/);
    assert.match(ROLLBACK, /'strategy\.read', 'strategy\.manage'/);
  });

  it('touches nothing in the organizational spine', () => {
    // `goals.owner_person_id` references `people`; dropping `goals` must remove
    // the reference and not a single person. `212_assert_strategic_rollback.sql`
    // checks it actually holds.
    for (const table of ['people', 'teams', 'departments', 'business_units', 'organizations']) {
      assert.ok(
        !new RegExp(`DROP TABLE[^;]*${table}`).test(ROLLBACK),
        `the rollback must not drop ${table}`,
      );
    }
    assert.ok(!/organization\.structure/.test(body(ROLLBACK)));
  });

  it('is idempotent at every step', () => {
    const drops = ROLLBACK.match(/DROP TABLE IF EXISTS/g) ?? [];
    assert.equal(drops.length, 3);
  });
});

describe('the migration is safe to re-run', () => {
  it('creates every table and index conditionally', () => {
    const creates = STRATEGY.match(/CREATE TABLE(?! IF NOT EXISTS)/g) ?? [];
    assert.equal(creates.length, 0, 'every CREATE TABLE must be IF NOT EXISTS');
    const indexes = STRATEGY.match(/CREATE INDEX(?! IF NOT EXISTS)/g) ?? [];
    assert.equal(indexes.length, 0, 'every CREATE INDEX must be IF NOT EXISTS');
  });

  it('drops a trigger before creating it', () => {
    for (const table of TABLES) {
      assert.match(STRATEGY, new RegExp(`DROP TRIGGER IF EXISTS ${table}_set_updated_at`));
    }
  });

  it('drops a policy before creating it', () => {
    assert.match(RLS, /DROP POLICY IF EXISTS %I_select_strategy/);
    assert.match(RLS, /DROP POLICY IF EXISTS %I_insert_strategy/);
    assert.match(RLS, /DROP POLICY IF EXISTS %I_update_strategy/);
  });

  it('wraps both migrations in a transaction', () => {
    for (const sql of [STRATEGY, RLS, ROLLBACK]) {
      assert.match(sql, /^BEGIN;/m);
      assert.match(sql, /^COMMIT;/m);
    }
  });
});
