/**
 * MCV2-S7.4 — `shadow_read_telemetry` migration and RPC contract (static).
 *
 * No database required, and that is the point: these are the properties a
 * shadow read's storage has to have *before* it is deployed anywhere near
 * production traffic. Whether the observation table can be written by anyone
 * but the service role, whether the forward migration touches the stores it is
 * supposed to be observing, and whether the observed columns can record the
 * malformed data they exist to find — each is decided by the text of the
 * migration, so each is checkable from the text of the migration.
 *
 * The live-database counterpart is `tests/database/kv_compare_and_swap.test.ts`'s
 * idiom, and it belongs to S7.5 validation rather than to this sprint.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIGRATION = '20260817120000_shadow_read_telemetry.sql';
const ROLLBACK = '20260817120000_rollback_shadow_read_telemetry.sql';

const forward = readFileSync(join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
const rollback = readFileSync(join(root, 'supabase', 'migrations', 'rollbacks', ROLLBACK), 'utf8');

const RPC_SIGNATURE =
  'UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TIMESTAMPTZ';

describe('shadow_read_telemetry table', () => {
  it('is created, tenant-owned and transactional', () => {
    assert.match(forward, /CREATE TABLE IF NOT EXISTS public\.shadow_read_telemetry/);
    assert.match(forward, /organization_id\s+UUID NOT NULL REFERENCES public\.organizations\(id\)/);
    assert.match(forward, /^BEGIN;/m);
    assert.match(forward, /^COMMIT;/m);
  });

  it('carries every column the shadow read records', () => {
    for (const column of [
      'organization_id',
      'entity',
      'legacy_kv_key',
      'classification',
      'severity',
      'kv_present',
      'sql_present',
      'kv_conversion',
      'sql_conversion',
      'sql_lifecycle_status',
      'sql_lifecycle_status_valid',
      'sql_outcome_type',
      'detail',
      'observed_at',
    ]) {
      assert.match(forward, new RegExp(`\\n\\s+${column}\\s+`), `column ${column}`);
    }
  });

  it('constrains the classifications this codebase produces', () => {
    for (const classification of [
      'match',
      'partial',
      'mismatch',
      'sql_missing',
      'kv_missing',
      'both_missing',
      'error',
    ]) {
      assert.match(forward, new RegExp(`'${classification}'`), `classification ${classification}`);
    }
    assert.match(forward, /CHECK \(severity IN \('info', 'low', 'high'\)\)/);
    assert.match(forward, /CHECK \(kv_conversion IN \('converted', 'not_converted', 'unknown'\)\)/);
    assert.match(forward, /CHECK \(sql_conversion IN \('converted', 'not_converted', 'unknown'\)\)/);
  });

  it('leaves the OBSERVED columns unconstrained so a malformed value can be recorded', () => {
    // A CHECK here would reject the rows worth knowing about — an absent, null
    // or non-schema lifecycle status is a finding, not an invalid input.
    assert.doesNotMatch(forward, /CHECK \([^)]*sql_lifecycle_status/);
    assert.doesNotMatch(forward, /CHECK \([^)]*sql_outcome_type/);
    // Both are nullable: no NOT NULL on either observed column.
    assert.match(forward, /sql_lifecycle_status\s+TEXT,/);
    assert.match(forward, /sql_outcome_type\s+TEXT,/);
  });

  it('enables RLS and grants tenants read-only visibility', () => {
    assert.match(forward, /ALTER TABLE public\.shadow_read_telemetry ENABLE ROW LEVEL SECURITY/);
    assert.match(forward, /CREATE POLICY shadow_read_telemetry_select[\s\S]*?FOR SELECT/);
    assert.match(forward, /cortex\.is_organization_member\(organization_id\)/);
  });

  it('defines no INSERT, UPDATE or DELETE policy', () => {
    // The only write path is the SECURITY DEFINER function, executed by the
    // service role.
    assert.doesNotMatch(forward, /FOR INSERT/);
    assert.doesNotMatch(forward, /FOR UPDATE/);
    assert.doesNotMatch(forward, /FOR DELETE/);
    assert.doesNotMatch(forward, /FOR ALL/);
  });

  it('indexes the reads S7.5 validation will make', () => {
    assert.match(forward, /shadow_read_telemetry_org_observed_idx/);
    assert.match(forward, /shadow_read_telemetry_classification_idx/);
    assert.match(forward, /shadow_read_telemetry_legacy_key_idx/);
  });
});

describe('record_shadow_read_telemetry RPC', () => {
  it('exists with the parameter list the server calls', () => {
    assert.match(forward, /CREATE OR REPLACE FUNCTION public\.record_shadow_read_telemetry\(/);
    for (const param of [
      'p_organization_id            UUID',
      'p_entity                     TEXT',
      'p_legacy_kv_key              TEXT',
      'p_classification             TEXT',
      'p_severity                   TEXT',
      'p_kv_present                 BOOLEAN',
      'p_sql_present                BOOLEAN',
      'p_kv_conversion              TEXT',
      'p_sql_conversion             TEXT',
      'p_sql_lifecycle_status       TEXT',
      'p_sql_lifecycle_status_valid BOOLEAN',
      'p_sql_outcome_type           TEXT',
      'p_detail                     JSONB',
      'p_observed_at                TIMESTAMPTZ',
    ]) {
      assert.ok(forward.includes(param), `parameter ${param}`);
    }
  });

  it('runs SECURITY DEFINER with a pinned search path', () => {
    assert.match(forward, /SECURITY DEFINER\s+SET search_path = public/);
  });

  it('is insert-only and names exactly one table', () => {
    const start = forward.indexOf('CREATE OR REPLACE FUNCTION public.record_shadow_read_telemetry');
    const body = forward.slice(start, forward.indexOf('COMMENT ON FUNCTION', start));

    assert.match(body, /INSERT INTO public\.shadow_read_telemetry/);
    assert.doesNotMatch(body, /UPDATE\s+public\./);
    assert.doesNotMatch(body, /DELETE\s+FROM/);
    const tables = [...body.matchAll(/public\.(\w+)/g)]
      .map((m) => m[1])
      .filter((t) => t !== 'record_shadow_read_telemetry');
    assert.deepEqual([...new Set(tables)], ['shadow_read_telemetry']);
  });

  it('is revoked from PUBLIC and granted only to service_role', () => {
    assert.ok(
      forward.includes(`REVOKE ALL ON FUNCTION public.record_shadow_read_telemetry(\n  ${RPC_SIGNATURE}\n) FROM PUBLIC;`),
      'REVOKE ALL … FROM PUBLIC on the full signature',
    );
    assert.ok(
      forward.includes(`GRANT EXECUTE ON FUNCTION public.record_shadow_read_telemetry(\n  ${RPC_SIGNATURE}\n) TO service_role;`),
      'GRANT EXECUTE … TO service_role on the full signature',
    );
    assert.doesNotMatch(forward, /TO (authenticated|anon)/);
  });
});

describe('the shadow read observes without touching what it observes', () => {
  it('the migration does not modify the key-value store', () => {
    assert.doesNotMatch(forward, /kv_store/i);
    assert.doesNotMatch(rollback, /kv_store/i);
  });

  it('the migration does not modify the outcomes table', () => {
    assert.doesNotMatch(forward, /ALTER TABLE public\.outcomes/);
    assert.doesNotMatch(forward, /INSERT INTO public\.outcomes/);
    assert.doesNotMatch(forward, /UPDATE public\.outcomes/);
    assert.doesNotMatch(forward, /DROP TABLE.*outcomes/);
  });

  it('the migration does not touch the auth schema', () => {
    assert.doesNotMatch(forward, /ALTER TABLE auth\./);
    assert.doesNotMatch(rollback, /ALTER TABLE auth\./);
  });

  it('the rollback drops only what the forward migration created', () => {
    assert.match(rollback, /DROP FUNCTION IF EXISTS public\.record_shadow_read_telemetry/);
    assert.match(rollback, /DROP TABLE IF EXISTS public\.shadow_read_telemetry/);
    const drops = [...rollback.matchAll(/DROP TABLE IF EXISTS public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(drops, ['shadow_read_telemetry']);
  });
});

describe('the server call site matches the RPC', () => {
  const server = readFileSync(join(root, 'supabase', 'functions', 'server', 'index.tsx'), 'utf8');

  it('calls the function by name', () => {
    assert.match(server, /rpc\('record_shadow_read_telemetry'/);
  });

  it('passes every parameter the function declares, and no other', () => {
    const start = server.indexOf("rpc('record_shadow_read_telemetry'");
    const call = server.slice(start, server.indexOf('});', start));
    const passed = [...call.matchAll(/\b(p_\w+):/g)].map((m) => m[1]).sort();
    const declared = [...forward.matchAll(/\n  (p_\w+)\s+(?:UUID|TEXT|BOOLEAN|JSONB|TIMESTAMPTZ)/g)]
      .map((m) => m[1])
      .sort();

    assert.deepEqual(passed, declared);
  });
});
