/**
 * AI-01 Batch 4C — static validation of the provider administration migration
 * and its rollback. No database required.
 *
 * Same division of labour as every migration test before it: a source scan
 * proves ABSENCE well and behaviour badly. What is pinned here is what these
 * files must never contain — a plaintext credential column, a browser-role
 * grant, a policy on the credential table, a seeded provider, a copy of an
 * environment secret — together with the shape of the constraints the domain
 * model depends on.
 *
 * The claims a scan CANNOT settle are named where they arise: whether the
 * partial unique index really refuses a second active credential, and whether
 * RLS-with-no-policy really denies `authenticated`, are facts about PostgreSQL
 * that only PostgreSQL can confirm.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = '20260828120000_ai_provider_administration.sql';
const ROLLBACK = '20260828120000_rollback_ai_provider_administration.sql';

const sql = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollbackSql = readFileSync(
  join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK),
  'utf8',
);

/**
 * The file with SQL comments stripped and runs of whitespace collapsed.
 *
 * Collapsing matters: this migration aligns its `ALTER TABLE ... ENABLE ROW
 * LEVEL SECURITY` block into columns for readability, and a scan that asserted
 * on single spaces would fail on formatting rather than on a missing control —
 * teaching the reader to distrust the test instead of the code.
 */
const strip = (text: string) =>
  text.replace(/^\s*--.*$/gm, ' ').replace(/[ \t]+/g, ' ');
const code = strip(sql);
const rollback = strip(rollbackSql);

describe('AI provider administration migration (static)', () => {
  it('runs in a single transaction, and so does its rollback', () => {
    assert.match(code, /^\s*BEGIN;/m);
    assert.match(code, /^\s*COMMIT;\s*$/m);
    assert.match(rollback, /^\s*BEGIN;/m);
    assert.match(rollback, /^\s*COMMIT;\s*$/m);
  });

  it('is append-only — it modifies no previously applied migration', () => {
    // The whole file creates; it alters nothing that existed before it except
    // to enable RLS on its own new tables.
    assert.ok(!/ALTER TABLE (?!cortex\.ai_provider_)/i.test(code));
    assert.ok(!/DROP TABLE/i.test(code), 'a forward migration drops nothing');
  });

  it('contains no literal UUID', () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assert.equal(uuid.test(code), false);
    assert.equal(uuid.test(rollback), false);
  });

  it('creates the three tables the domain model separates', () => {
    // Configuration, credential and model are three concepts and three
    // records. Collapsing them is the defect this batch exists to avoid.
    for (const table of [
      'cortex.ai_provider_configuration',
      'cortex.ai_provider_credential',
      'cortex.ai_provider_model',
    ]) {
      assert.ok(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace('.', '\\.')}`).test(code),
        `${table} must be created`,
      );
    }
  });
});

describe('the credential table can hold no plaintext', () => {
  const credentialTable = code.slice(
    code.indexOf('CREATE TABLE IF NOT EXISTS cortex.ai_provider_credential'),
    code.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_credential_one_active'),
  );

  it('declares no column a secret could occupy', () => {
    assert.ok(credentialTable.length > 0, 'the credential table must exist');
    for (const forbidden of [
      'secret_value',
      'plaintext',
      'api_key',
      'raw_secret',
      'credential_value',
    ]) {
      assert.ok(
        !credentialTable.includes(forbidden),
        `the credential table must not declare "${forbidden}"`,
      );
    }
  });

  it('constrains the sealed record to a real AEAD envelope', () => {
    // A row written by anything other than the sealing code is rejected by the
    // database rather than failing to decrypt hours later — and, decisively, a
    // base64 blob masquerading as encryption cannot satisfy this shape.
    assert.match(credentialTable, /encrypted_secret\s+JSONB NOT NULL/);
    assert.match(credentialTable, /encrypted_secret ->> 'alg' = 'AES-256-GCM'/);
    for (const field of ['v', 'alg', 'kid', 'iv', 'ct']) {
      assert.ok(
        credentialTable.includes(`encrypted_secret ? '${field}'`),
        `the sealed record must carry "${field}"`,
      );
    }
  });

  it('bounds the safe-to-display remnant to four characters', () => {
    assert.match(credentialTable, /char_length\(last_four\) BETWEEN 1 AND 4/);
  });

  it('requires a keyed fingerprint rather than a bare digest', () => {
    assert.match(credentialTable, /fingerprint\s+TEXT NOT NULL/);
    assert.match(credentialTable, /fingerprint ~ '\^fp_\[0-9a-f\]\{8,64\}\$'/);
  });

  it('records the root key each credential was sealed under', () => {
    // So a root key rotation is diagnosable without decrypting anything.
    assert.match(credentialTable, /key_id\s+TEXT NOT NULL/);
  });

  it('will not admit a revoked credential with no record of who revoked it', () => {
    assert.match(credentialTable, /ai_provider_credential_revocation_complete/);
    assert.match(credentialTable, /revoked_at IS NOT NULL AND revoked_by IS NOT NULL/);
  });
});

describe('the domain invariants are enforced by the database, not only the service', () => {
  it('permits exactly one active credential per configuration', () => {
    // Deterministic active-credential semantics were a Batch 4C requirement,
    // and a requirement enforced only in application code is a requirement that
    // holds until the second writer.
    //
    // NOT SETTLED HERE: that PostgreSQL actually refuses the second insert.
    // That is a fact about partial unique indexes, and this scan only pins that
    // the index is declared with the right predicate.
    assert.match(
      code,
      /CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_credential_one_active\s+ON cortex\.ai_provider_credential \(configuration_id\)\s+WHERE status = 'active'/,
    );
  });

  it('still allows many credential rows per configuration', () => {
    // The rotation history. A one-provider-one-key schema is precisely what
    // Batch 4F must not have to replace.
    assert.ok(
      !/UNIQUE \(configuration_id\)(?!\s*,)/.test(code),
      'there must be no unconditional uniqueness on configuration_id',
    );
  });

  it('permits one platform configuration per provider, per scope', () => {
    assert.match(
      code,
      /CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configuration_platform_key[\s\S]*?WHERE scope = 'platform'/,
    );
    assert.match(
      code,
      /CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configuration_organization_key[\s\S]*?WHERE scope = 'organization'/,
    );
  });

  it('makes scope and tenancy agree structurally', () => {
    // A platform row cannot name a tenant and an organization row cannot omit
    // one, so no query has to guess which kind of row it is holding — the
    // structural half of the tenant isolation Batch 4D will rely on.
    assert.match(code, /ai_provider_configuration_scope_tenancy/);
    assert.match(code, /scope = 'platform' AND organization_id IS NULL/);
    assert.match(code, /scope = 'organization' AND organization_id IS NOT NULL/);
  });

  it('carries the organization scope Batch 4D will need', () => {
    assert.match(code, /scope IN \('platform', 'organization'\)/);
    assert.match(code, /organization_id\s+UUID REFERENCES public\.organizations\(id\)/);
  });

  it('constrains every lifecycle column to a declared vocabulary', () => {
    assert.match(code, /status IN \('active', 'superseded', 'revoked'\)/);
    assert.match(
      code,
      /certification IN\s*\n?\s*\('unverified', 'testing', 'certified', 'degraded', 'disabled'\)/,
    );
  });

  it('activates a credential in ONE transaction, through a function', () => {
    // Supersede-then-insert as two PostgREST calls is two transactions, and a
    // failure between them leaves a configuration with ZERO active credentials
    // — after which the runtime silently resolves the deployment environment
    // variable while the console reports a successful rotation. A plpgsql
    // function body is one transaction.
    assert.match(
      code,
      /CREATE OR REPLACE FUNCTION cortex\.ai_provider_credential_activate/,
    );
    const body = code.slice(
      code.indexOf('CREATE OR REPLACE FUNCTION cortex.ai_provider_credential_activate'),
      code.indexOf('REVOKE ALL ON FUNCTION'),
    );
    assert.match(body, /UPDATE cortex\.ai_provider_credential/);
    assert.match(body, /INSERT INTO cortex\.ai_provider_credential/);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = cortex, public/);
  });

  it('denies the browser roles the SECURITY DEFINER activation function', () => {
    // It runs with the owner's rights, so the default PUBLIC EXECUTE would hand
    // any authenticated session a way to write a credential row that RLS
    // otherwise denies them entirely.
    assert.match(code, /REVOKE ALL ON FUNCTION cortex\.ai_provider_credential_activate/);
    assert.match(code, /FROM PUBLIC, anon, authenticated/);
  });

  it('declares identifiers the platform can actually mint', () => {
    // The service mints prefixed ids (`pvc_`, `pvk_`, `pvm_`), not UUIDs.
    // Declaring these columns UUID rejected every write the service made — the
    // defect an independent review of this batch found. The behavioural
    // cross-check lives in tests/features/providerAdministrationStorage.test.ts.
    assert.ok(!/id UUID PRIMARY KEY/.test(code), 'no id column may be UUID');
    for (const [constraint, prefix] of [
      ['ai_provider_configuration_id_format', 'pvc'],
      ['ai_provider_credential_id_format', 'pvk'],
      ['ai_provider_model_id_format', 'pvm'],
    ]) {
      assert.match(
        code,
        new RegExp(`CONSTRAINT ${constraint}\\s+CHECK \\(id ~ '\\^${prefix}_`),
        `${constraint} must bound the ${prefix}_ identifier grammar`,
      );
    }
  });

  it('indexes the lookups the runtime actually performs', () => {
    for (const index of [
      'ai_provider_configuration_scope_idx',
      'ai_provider_credential_configuration_idx',
      'ai_provider_credential_key_id_idx',
      'ai_provider_model_configuration_idx',
    ]) {
      assert.ok(code.includes(index), `${index} must exist`);
    }
  });

  it('timestamps and attributes every record', () => {
    assert.equal((code.match(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/g) ?? []).length, 3);
    assert.equal((code.match(/updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/g) ?? []).length, 3);
  });
});

describe('row level security', () => {
  it('enables and forces RLS on all three tables', () => {
    for (const table of [
      'cortex.ai_provider_configuration',
      'cortex.ai_provider_credential',
      'cortex.ai_provider_model',
    ]) {
      assert.ok(
        code.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
        `${table} must enable RLS`,
      );
      assert.ok(
        code.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
        `${table} must force RLS, so a table owner is not an implicit bypass`,
      );
    }
  });

  it('creates NO policy on the credential table', () => {
    // THE CONTROL IS THE ABSENCE. With RLS enabled and no policy, every role
    // that respects RLS is denied every row; only the service role — which also
    // holds the decryption key, behind the capability check and the audit
    // record — reaches one. A platform-admin read policy would put encrypted
    // key material within reach of a browser session token for no operation the
    // administration API does not already provide.
    assert.ok(
      !/CREATE POLICY[^;]*ON cortex\.ai_provider_credential/i.test(code),
      'the credential table must carry no RLS policy at all',
    );
  });

  it('grants the browser-facing roles nothing on any of the three tables', () => {
    for (const table of [
      'cortex.ai_provider_configuration',
      'cortex.ai_provider_credential',
      'cortex.ai_provider_model',
    ]) {
      assert.ok(
        code.includes(`REVOKE ALL ON ${table} FROM anon, authenticated`),
        `${table} must revoke browser-role privileges`,
      );
    }
    assert.ok(
      !/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]{0,120}TO\s+(anon|authenticated)/i.test(code),
      'no grant to a browser role',
    );
  });

  it('creates NO policy on ANY of the three tables', () => {
    // An earlier revision created platform-admin SELECT policies on the two
    // non-secret tables. They were DEAD — no migration ever granted
    // `authenticated` table privileges in `cortex`, and this file revokes them
    // — and a policy that exists but cannot fire is worse than none: the next
    // person to debug "why can't I read this as a platform admin" reads it and
    // hunts in the wrong place. They were removed rather than made live.
    assert.ok(
      !/CREATE POLICY/i.test(code),
      'these tables are service-role only; no policy may exist on any of them',
    );
  });

  it('never disables RLS anywhere', () => {
    assert.ok(!/DISABLE ROW LEVEL SECURITY/i.test(code));
    assert.ok(!/DISABLE ROW LEVEL SECURITY/i.test(rollback));
  });
});

describe('production data safety', () => {
  it('seeds no provider', () => {
    // A seeded configuration would put the platform in a state nobody
    // authorised, on a surface whose entire point is that state is authorised.
    //
    // The activation FUNCTION contains an INSERT, and that is not a seed: it is
    // parameterised, it runs only when the edge function calls it, and it
    // writes nothing at migration time. So the test excludes the function body
    // and asserts on the migration's own statements.
    const outsideFunctions = code.replace(/AS \$\$[\s\S]*?\$\$;/g, ' ');
    assert.ok(
      !/INSERT INTO/i.test(outsideFunctions),
      'the migration itself must insert no row',
    );
    assert.ok(
      !/VALUES\s*\(\s*'/.test(outsideFunctions),
      'no literal row is written at migration time',
    );
  });

  it('copies no environment secret into the database', () => {
    // Never migrate an existing production secret automatically: it takes a
    // value the deployment owns and puts a copy of it somewhere its owner did
    // not choose.
    assert.ok(!/OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(sql));
    assert.ok(!/current_setting\(/i.test(code), 'nothing reads a runtime setting');
  });

  it('touches no existing table', () => {
    for (const table of [
      'kv_store_324f4fbe',
      'organization_memberships',
      'public.organizations',
    ]) {
      assert.ok(
        !new RegExp(`(ALTER|DROP|UPDATE|DELETE FROM)[^;]*${table.replace('.', '\\.')}`, 'i').test(
          code,
        ),
        `the migration must not modify ${table}`,
      );
    }
  });

  it('has a rollback that removes only what this migration created', () => {
    assert.match(rollback, /DROP FUNCTION IF EXISTS cortex\.ai_provider_credential_activate/);
    assert.match(rollback, /DROP TABLE IF EXISTS cortex\.ai_provider_credential/);
    assert.match(rollback, /DROP TABLE IF EXISTS cortex\.ai_provider_model/);
    assert.match(rollback, /DROP TABLE IF EXISTS cortex\.ai_provider_configuration/);
    // Nothing else. A rollback that reached the KV store or the tenancy tables
    // would be a rollback nobody could safely run.
    assert.ok(!/kv_store_324f4fbe|organization_memberships/.test(rollback));
  });

  it('says out loud that its rollback destroys managed credentials', () => {
    // They are encrypted, so nothing readable leaves with them — and they are
    // also unrecoverable, because a managed credential is write-only material.
    assert.match(rollbackSql, /NOT RECOVERABLE/i);
    assert.match(rollbackSql, /staging\/dev/i);
  });
});
