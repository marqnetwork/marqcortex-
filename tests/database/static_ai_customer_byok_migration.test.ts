/**
 * AI-01 Batch 4D — static validation of the customer BYOK migration and its
 * rollback. No database required.
 *
 * THIS FILE IS NOT THE VERIFICATION. IT IS THE CHEAP HALF OF IT.
 *
 * Batch 4C's production gate found two defects its static suite could not have
 * seen, because both were about what PostgreSQL DOES with the file rather than
 * what the file contains: two CHECK constraints sharing a name, so the
 * migration could not be applied anywhere; and a `service_role` with no
 * privilege at all, so every runtime call would have failed. The static suite
 * reported both files healthy.
 *
 * The executable verification is `scripts/ai-customer-byok-scenarios.mjs`
 * (`npm run test:database:4d`), which applies the REAL migration to a real
 * PostgreSQL, drives two customers and MARQ through the statements the runtime
 * issues, attempts the cross-tenant writes an attacker would attempt, and then
 * rolls back and re-applies. Every behavioural claim about Batch 4D lives
 * there, and the assertions here that could be mistaken for behavioural ones
 * say so.
 *
 * WHAT A SCAN IS STILL THE RIGHT TOOL FOR: proving ABSENCE. No new table, no
 * plaintext column, no RLS policy, no browser-role grant, no seeded customer,
 * no copy of an environment secret, no `GRANT ALL`, and — the one specific to
 * this batch — no DELETE of a customer's rows in the rollback. A database can
 * only show you what IS there.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = '20260901120000_ai_customer_byok.sql';
const ROLLBACK = '20260901120000_rollback_ai_customer_byok.sql';

const sql = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollbackSql = readFileSync(
  join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK),
  'utf8',
);

/** The file with SQL comments stripped and runs of whitespace collapsed. */
const strip = (text: string) => text.replace(/^\s*--.*$/gm, ' ').replace(/[ \t]+/g, ' ');
const code = strip(sql);
const rollback = strip(rollbackSql);

describe('AI customer BYOK migration (static)', () => {
  it('runs in a single transaction, and so does its rollback', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
    assert.match(rollback, /^\s*BEGIN;/m);
    assert.match(rollback, /^\s*COMMIT;\s*$/m);
  });

  it('creates no table — it extends the Batch 4C schema rather than copying it', () => {
    // The central architectural claim of this batch. A second set of tables for
    // customer credentials would mean a second RLS posture to keep aligned, a
    // second privilege matrix to enumerate, a second activation function to
    // make atomic, and a second place for a plaintext column to be added by
    // somebody who had not read the first.
    assert.ok(
      !/CREATE TABLE/i.test(code),
      'Batch 4D must not create a table; the 4C schema already carries scope and tenancy',
    );
  });

  it('touches only the Batch 4C provider tables', () => {
    const altered = [...code.matchAll(/ALTER TABLE (\S+)/gi)].map((match) => match[1]);
    assert.ok(altered.length > 0, 'the migration alters something');
    for (const table of altered) {
      assert.match(
        table,
        /^cortex\.ai_provider_/,
        `Batch 4D altered ${table}, which is outside the AI provider tables`,
      );
    }
  });

  it('drops nothing a forward migration has no business dropping', () => {
    // `DROP TRIGGER IF EXISTS` immediately before `CREATE TRIGGER` is the
    // idempotent re-create, which is legitimate and is the only DROP allowed.
    const drops = [...code.matchAll(/DROP\s+(\w+)/gi)].map((match) => match[1].toUpperCase());
    assert.deepEqual(
      [...new Set(drops)].sort(),
      ['TRIGGER'],
      'a forward migration drops nothing but its own trigger, for idempotent re-creation',
    );
  });

  // ── The secret rules ──────────────────────────────────────────────────────

  it('adds no column that could hold a credential', () => {
    const added = [...code.matchAll(/ADD COLUMN(?: IF NOT EXISTS)? (\w+)/gi)].map((m) => m[1]);
    assert.deepEqual(
      added,
      ['credential_fallback'],
      'Batch 4D adds exactly one column, and it is a policy enum',
    );
    // And it is constrained to two literal values, so it cannot hold anything.
    assert.match(code, /CHECK \(credential_fallback IN \('platform', 'tenant_only'\)\)/);
  });

  it('copies no environment secret into the database', () => {
    // The deployment's own variables are deployment secrets. A migration that
    // referenced one by name would be a migration that could copy it.
    assert.ok(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|AI_CREDENTIAL_ENCRYPTION_KEY/.test(code));
    assert.ok(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|AI_CREDENTIAL_ENCRYPTION_KEY/.test(rollback));
  });

  it('seeds no organization, no configuration and no credential', () => {
    // Applying this migration must change nothing about how any tenant
    // executes. Until a customer administrator deliberately stores a
    // credential, every tenant resolves exactly where it did before.
    assert.ok(
      !/INSERT INTO/i.test(code),
      'the migration inserts no row; BYOK is opt-in, per customer, through the governed API',
    );
  });

  // ── Access control ────────────────────────────────────────────────────────

  it('creates no row level security policy on any provider table', () => {
    // THE CONTROL MOST UNDER PRESSURE IN THIS BATCH. "A customer needs to read
    // their own credential status" is the sentence that ends with a policy
    // admitting `authenticated` to a table holding credential ciphertext. The
    // customer reads their rows through the governed BYOK API instead.
    assert.ok(
      !/CREATE POLICY/i.test(code),
      'service role only is the access control; a policy puts ciphertext within reach of a ' +
        'browser session token',
    );
    assert.ok(!/CREATE POLICY/i.test(rollback));
  });

  it('re-asserts RLS as enabled AND forced on all three tables', () => {
    for (const table of [
      'ai_provider_configuration',
      'ai_provider_credential',
      'ai_provider_model',
    ]) {
      assert.match(
        code,
        new RegExp(`ALTER TABLE cortex\\.${table} ENABLE ROW LEVEL SECURITY`),
        `${table} must have RLS enabled`,
      );
      assert.match(
        code,
        new RegExp(`ALTER TABLE cortex\\.${table} FORCE ROW LEVEL SECURITY`),
        `${table} must have RLS forced`,
      );
    }
  });

  it('grants nothing to a browser-facing role, and revokes from both', () => {
    const grants = [...code.matchAll(/GRANT[^;]*?TO ([^;]+);/gi)].map((match) => match[1]);
    for (const grantee of grants) {
      assert.ok(
        !/\b(anon|authenticated|public)\b/i.test(grantee),
        `Batch 4D grants to ${grantee.trim()}, which is browser-facing`,
      );
    }
    assert.match(code, /REVOKE ALL ON cortex\.ai_provider_credential\s+FROM PUBLIC, anon, authenticated/);
  });

  it('grants no privilege the runtime does not use, and never GRANT ALL', () => {
    assert.ok(!/GRANT ALL/i.test(code), 'an enumeration is a decision; GRANT ALL is its absence');
    // No DELETE and no TRUNCATE anywhere. Nothing in the runtime deletes a
    // provider row: configuration is disabled, credentials are revoked.
    assert.ok(!/GRANT[^;]*\bDELETE\b/i.test(code));
    assert.ok(!/GRANT[^;]*\bTRUNCATE\b/i.test(code));
    // And still no direct INSERT on the credential table: the only insert is
    // inside the SECURITY DEFINER activation function, so a customer's rotation
    // cannot be issued as two statements.
    assert.ok(
      !/GRANT[^;]*INSERT[^;]*ON cortex\.ai_provider_credential/i.test(code),
      'a direct INSERT would be a second, non-atomic way to activate a credential',
    );
  });

  // ── The tenancy guard ─────────────────────────────────────────────────────

  it('installs a BEFORE UPDATE row trigger over the configuration table', () => {
    // Behaviour — that it actually refuses a re-point — is proved in
    // `102_assert_4d_tenant_isolation.sql` against a real database. What is
    // pinned here is that the trigger is declared with the timing the guarantee
    // needs: an AFTER trigger would fire once the row was already written, and
    // a STATEMENT trigger has no OLD/NEW to compare at all.
    assert.match(code, /CREATE TRIGGER ai_provider_configuration_tenancy_immutable/);
    assert.match(code, /BEFORE UPDATE ON cortex\.ai_provider_configuration/);
    assert.match(code, /FOR EACH ROW/);
  });

  it('compares tenancy with IS DISTINCT FROM rather than an equality operator', () => {
    // `organization_id` is NULL on every platform row, and `NULL <> NULL` is
    // NULL — not TRUE — so `<>` would silently pass for exactly the conversions
    // the guard most needs to refuse: a platform row being handed a tenant, or
    // a tenant row being stripped of one.
    assert.match(code, /NEW\.scope IS DISTINCT FROM OLD\.scope/);
    assert.match(code, /NEW\.organization_id IS DISTINCT FROM OLD\.organization_id/);
    assert.ok(
      !/NEW\.organization_id\s*<>\s*OLD\.organization_id/.test(code),
      'an equality comparison would not catch a NULL transition',
    );
  });

  it('never interpolates two tenants into the trigger message', () => {
    // A trigger message reaches logs and, through PostgREST, error bodies.
    // Naming both organizations in it would make a refused cross-tenant write
    // into a way to confirm that another organization's id exists.
    const raise = code.match(
      /ai_provider_configuration\.organization_id is immutable[^;]*/,
    );
    assert.ok(raise, 'the organization refusal exists');
    assert.ok(
      !/OLD\.organization_id|NEW\.organization_id/.test(raise[0]),
      'the refusal must not name either tenant',
    );
  });

  it('leaves the trigger function as SECURITY INVOKER', () => {
    // It reads OLD and NEW and raises. It needs no privilege of its own, and
    // SECURITY DEFINER would hand it the owner's rights for no operation it
    // performs.
    const fn = code.match(
      /CREATE OR REPLACE FUNCTION cortex\.ai_provider_configuration_tenancy_is_immutable[\s\S]*?\$\$;/,
    );
    assert.ok(fn, 'the trigger function exists');
    assert.ok(
      !/SECURITY DEFINER/i.test(fn[0]),
      'the tenancy trigger needs no elevated rights',
    );
    assert.match(fn[0], /SET search_path = cortex, public/);
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('adds each constraint under a guard, so a re-run does not collide', () => {
    // PostgreSQL identifies constraints by (table, name) and rejects a
    // duplicate. `ADD COLUMN IF NOT EXISTS` skips the column on a re-run and
    // would then attempt the constraint again — which is why the constraints
    // are added separately, each behind an existence check.
    for (const name of [
      'ai_provider_configuration_credential_fallback',
      'ai_provider_configuration_platform_fallback',
    ]) {
      assert.match(code, new RegExp(`conname = '${name}'`), `${name} is added under a guard`);
      assert.equal(
        (code.match(new RegExp(`ADD CONSTRAINT ${name}\\b`, 'g')) ?? []).length,
        1,
        `${name} is added exactly once`,
      );
    }
  });

  it('names its two constraints distinctly', () => {
    // The B-1 regression, asked of this file. Two constraints sharing a name
    // makes a migration unapplicable anywhere, and the static suite is the
    // cheapest place to catch it.
    const names = [...code.matchAll(/ADD CONSTRAINT (\w+)/g)].map((match) => match[1]);
    assert.equal(new Set(names).size, names.length, `duplicate constraint names: ${names}`);
  });

  it('uses IF NOT EXISTS on the index it adds', () => {
    assert.match(code, /CREATE INDEX IF NOT EXISTS ai_provider_configuration_organization_idx/);
  });
});

describe('AI customer BYOK rollback (static)', () => {
  it('removes every object the migration adds', () => {
    assert.match(rollback, /DROP TRIGGER IF EXISTS ai_provider_configuration_tenancy_immutable/);
    assert.match(
      rollback,
      /DROP FUNCTION IF EXISTS cortex\.ai_provider_configuration_tenancy_is_immutable/,
    );
    assert.match(rollback, /DROP INDEX IF EXISTS cortex\.ai_provider_configuration_organization_idx/);
    assert.match(rollback, /DROP CONSTRAINT IF EXISTS ai_provider_configuration_platform_fallback/);
    assert.match(
      rollback,
      /DROP CONSTRAINT IF EXISTS ai_provider_configuration_credential_fallback/,
    );
    assert.match(rollback, /DROP COLUMN IF EXISTS credential_fallback/);
  });

  it('does not delete a single customer row', () => {
    // THE ASSERTION THIS BATCH MOST NEEDS FROM ITS ROLLBACK.
    //
    // Batch 4D created no table, so the obvious rollback — drop the
    // organization-scoped configurations and the credentials under them — would
    // be deleting rows the 4C schema is perfectly capable of holding, and
    // destroying secret material that is NOT RECOVERABLE. Every affected
    // customer would have to re-enter their key from their vendor's console.
    //
    // With 4D's code rolled back those rows are inert: the resolver reads only
    // platform-scoped rows, so a customer row is never read and never executed
    // on. `104_assert_4d_rollback.sql` proves the rows really do survive.
    assert.ok(!/\bDELETE\s+FROM\b/i.test(rollback), 'the rollback deletes no row');
    assert.ok(!/\bTRUNCATE\b/i.test(rollback));
  });

  it('does not reverse Batch 4C', () => {
    // Reversing the customer batch must not take MARQ's own provider
    // administration down with it.
    assert.ok(!/DROP TABLE/i.test(rollback), 'the 4D rollback drops no table');
    assert.ok(
      !/DROP FUNCTION IF EXISTS cortex\.ai_provider_credential_activate/i.test(rollback),
      'the activation function belongs to Batch 4C',
    );
  });

  it('restores the Batch 4C table comments', () => {
    // Leaving the 4D text behind after a 4D rollback would make the schema's own
    // documentation describe a batch that is no longer applied — exactly the
    // drift a reviewer trusts a comment not to have.
    assert.match(rollback, /COMMENT ON TABLE cortex\.ai_provider_configuration IS/);
    assert.match(rollback, /COMMENT ON TABLE cortex\.ai_provider_credential IS/);
    assert.ok(!/4C\/4D/.test(rollback), 'the restored comments describe Batch 4C alone');
  });

  it('grants nothing and creates no policy', () => {
    assert.ok(!/CREATE POLICY/i.test(rollback));
    assert.ok(!/GRANT/i.test(rollback));
  });
});
