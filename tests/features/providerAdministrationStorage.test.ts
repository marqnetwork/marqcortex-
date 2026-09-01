/**
 * The Supabase-backed provider administration store — AI-01 Batch 4C.
 *
 * ── WHY THIS FILE EXISTS, STATED PLAINLY ───────────────────────────────────
 *
 * The Batch 4C suite drives the whole administration surface against
 * `createMemoryProviderAdministrationStore`. That is the right shape for
 * asserting what the SERVICE does — it is fast, deterministic, and the memory
 * store has the same one-active-credential semantics the durable one enforces
 * with a partial unique index.
 *
 * It is also structurally incapable of noticing that the DURABLE store speaks
 * to the database incorrectly. An independent review of this batch found
 * exactly that, and it was fatal: the service mints prefixed identifiers
 * (`pvc_…`, `pvk_…`, `pvm_…`) and the migration declared the `id` columns
 * `UUID`, so every write would have been rejected by Postgres with `invalid
 * input syntax for type uuid`. Provider administration would have been
 * non-functional in every deployment, on every write path, with 45 green tests.
 *
 * So this suite asserts the two things the memory store cannot:
 *
 *   1. **The wire shape.** What columns, values and calls the store actually
 *      issues, against a recording double of the client — including that the
 *      identifiers it sends match the format the migration accepts.
 *   2. **The contract with the schema.** That the columns the store writes
 *      exist in the migration, and that the identifier formats agree. A
 *      behavioural test cannot reach a real database here; a cross-check
 *      between the two files can, and it is the check that was missing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseProviderAdministrationStore } from '../../supabase/functions/server/aiProviderAdministrationStore.ts';
import type { ProviderStoreClient } from '../../supabase/functions/server/aiProviderAdministrationStore.ts';
import { systemIdFactory } from '../../supabase/functions/server/ai/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * THE SCHEMA AS APPLIED, WHICH IS EVERY MIGRATION THAT TOUCHES THESE TABLES.
 *
 * Batch 4C created them; AI-01 Batch 4D added `credential_fallback` to the
 * configuration table. A test that read only the creating migration would say
 * the store writes a column that does not exist — which is exactly what it said
 * the day 4D landed, and it would say the same for every future column.
 *
 * Read in filename order, which is migration order, so "the schema declares
 * this column" means what it says.
 */
const MIGRATIONS = [
  '20260828120000_ai_provider_administration.sql',
  '20260901120000_ai_customer_byok.sql',
];
const migrationSource = MIGRATIONS.map((file) =>
  readFileSync(join(root, 'supabase', 'migrations', file), 'utf8'),
).join('\n');

/**
 * The migrations with SQL comments removed and whitespace collapsed.
 *
 * Comments are stripped because these files document heavily — the `id` column
 * carries a paragraph explaining why it is TEXT — and a window-based scan over
 * the raw text would measure prose rather than declarations.
 */
const migration = migrationSource.replace(/^\s*--.*$/gm, ' ').replace(/\s+/g, ' ');

// ── A recording double of the client surface the store uses ─────────────────

interface Recorded {
  readonly table?: string;
  readonly op: string;
  readonly payload?: Record<string, unknown>;
  readonly columns?: string;
  readonly filters?: [string, unknown][];
}

function recordingClient(rows: Record<string, unknown>[] = []): {
  client: ProviderStoreClient;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];

  const query = (table: string, columns: string) => {
    const filters: [string, unknown][] = [];
    const self = {
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return self;
      },
      is(column: string, value: unknown) {
        filters.push([column, value]);
        return self;
      },
      order() {
        return self;
      },
      limit() {
        return self;
      },
      maybeSingle() {
        calls.push({ table, op: 'select.single', columns, filters });
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then<R>(resolve: (value: { data: Record<string, unknown>[]; error: null }) => R): Promise<R> {
        calls.push({ table, op: 'select', columns, filters });
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    return self;
  };

  const client: ProviderStoreClient = {
    schema() {
      return {
        from(table: string) {
          return {
            select: (columns: string) => query(table, columns),
            insert(payload: Record<string, unknown>) {
              calls.push({ table, op: 'insert', payload });
              return Promise.resolve({ error: null });
            },
            upsert(payload: Record<string, unknown>) {
              calls.push({ table, op: 'upsert', payload });
              return Promise.resolve({ error: null });
            },
            update(payload: Record<string, unknown>) {
              const filters: [string, unknown][] = [];
              const self = {
                eq(column: string, value: unknown) {
                  filters.push([column, value]);
                  return self;
                },
                then<R>(resolve: (value: { error: null }) => R): Promise<R> {
                  calls.push({ table, op: 'update', payload, filters });
                  return Promise.resolve(resolve({ error: null }));
                },
              };
              return self;
            },
          };
        },
        rpc(name: string, params: Record<string, unknown>) {
          calls.push({ op: `rpc:${name}`, payload: params });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { client, calls };
}

const NOW = '2026-08-28T12:00:00.000Z';

function configurationRecord() {
  return {
    configurationId: systemIdFactory.next('pvc'),
    providerKey: 'openai',
    displayName: 'OpenAI',
    scope: 'platform' as const,
    enabled: true,
    certification: 'certified' as const,
    configuration: {},
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'operator',
    updatedBy: 'operator',
  };
}

// ── The identifier contract ─────────────────────────────────────────────────

describe('the identifiers the service mints are the identifiers the schema accepts', () => {
  /** The `CHECK (id ~ '…')` pattern the migration declares for one table. */
  function idPattern(constraint: string): RegExp {
    const at = migration.indexOf(`CONSTRAINT ${constraint} CHECK (id ~ '`);
    assert.ok(at > 0, `${constraint} must exist`);
    const from = migration.indexOf("'", at) + 1;
    return new RegExp(migration.slice(from, migration.indexOf("'", from)));
  }

  it('declares the id columns as TEXT, not UUID', () => {
    // THE DEFECT THIS SUITE WAS WRITTEN FOR. `gen_random_uuid()` on a column the
    // service always supplies is a column the service can never satisfy.
    for (const table of [
      'cortex.ai_provider_configuration',
      'cortex.ai_provider_credential',
      'cortex.ai_provider_model',
    ]) {
      const at = migration.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
      assert.ok(at > 0, `${table} must be created`);
      // The `id` column is the first one every table declares, so the window
      // starts at the opening parenthesis and only has to reach past it.
      const head = migration.slice(at, at + 200);
      assert.ok(!/id UUID PRIMARY KEY/.test(head), `${table}.id must not be UUID`);
      assert.match(head, /id TEXT PRIMARY KEY/, `${table}.id must be TEXT`);
    }
  });

  it('accepts the configuration ids the service actually mints', () => {
    const pattern = idPattern('ai_provider_configuration_id_format');
    for (let i = 0; i < 5; i += 1) {
      assert.match(systemIdFactory.next('pvc'), pattern);
    }
  });

  it('accepts the credential ids the service actually mints', () => {
    const pattern = idPattern('ai_provider_credential_id_format');
    for (let i = 0; i < 5; i += 1) {
      assert.match(systemIdFactory.next('pvk'), pattern);
    }
  });

  it('accepts the model ids the service actually mints', () => {
    const pattern = idPattern('ai_provider_model_id_format');
    for (let i = 0; i < 5; i += 1) {
      assert.match(systemIdFactory.next('pvm'), pattern);
    }
  });

  it('refuses an identifier of the wrong kind', () => {
    // The prefix is not decoration: a credential id and a configuration id sit
    // side by side in one audit record, and the column refuses the wrong one.
    assert.ok(!idPattern('ai_provider_credential_id_format').test(systemIdFactory.next('pvc')));
    assert.ok(!idPattern('ai_provider_configuration_id_format').test(systemIdFactory.next('pvk')));
  });

  it('declares the foreign keys as TEXT so they can reference the primary keys', () => {
    assert.equal(
      (migration.match(/configuration_id TEXT NOT NULL REFERENCES/g) ?? []).length,
      2,
      'both child tables reference the configuration by TEXT id',
    );
  });
});

// ── The wire shape ──────────────────────────────────────────────────────────

describe('the durable store issues the calls the schema expects', () => {
  it('writes a configuration with the columns the table declares', async () => {
    const { client, calls } = recordingClient();
    const store = createSupabaseProviderAdministrationStore({ client });
    const record = configurationRecord();

    await store.saveConfiguration(record);

    const write = calls.find((call) => call.op === 'upsert');
    assert.ok(write, 'a configuration write was issued');
    assert.equal(write.table, 'ai_provider_configuration');
    assert.equal(write.payload?.id, record.configurationId);
    assert.equal(write.payload?.provider_key, 'openai');
    assert.equal(write.payload?.scope, 'platform');
    // NULL, not undefined: a platform row names no tenant, and the scope/tenancy
    // check constraint enforces it.
    assert.equal(write.payload?.organization_id, null);

    // Every column it writes exists in the migration.
    for (const column of Object.keys(write.payload ?? {})) {
      assert.ok(
        migration.includes(column),
        `ai_provider_configuration has no column "${column}"`,
      );
    }
  });

  it('activates a credential through the atomic function, not two writes', async () => {
    const { client, calls } = recordingClient();
    const store = createSupabaseProviderAdministrationStore({ client });
    const credentialId = systemIdFactory.next('pvk');

    await store.putActiveCredential({
      credentialId,
      configurationId: 'pvc_0123456789abcdef0123456789abcdef',
      providerKey: 'openai',
      credentialName: 'primary',
      status: 'active',
      fingerprint: 'fp_0123456789abcdef',
      lastFour: 'wxyz',
      secretVersion: 2,
      keyId: 'k_0123456789ab',
      createdAt: NOW,
      updatedAt: NOW,
      rotatedAt: NOW,
      createdBy: 'operator',
      sealed: { v: 1, alg: 'AES-256-GCM', kid: 'k_0123456789ab', iv: 'aXY=', ct: 'Y3Q=' },
    });

    // ONE call, and it is the transactional function. Two calls — a supersede
    // and an insert — are two transactions, and a failure between them leaves
    // the configuration with no active credential while the console reports a
    // successful rotation.
    assert.equal(calls.length, 1, 'exactly one database call');
    assert.equal(calls[0]!.op, 'rpc:ai_provider_credential_activate');
    assert.ok(
      !calls.some((call) => call.op === 'update' || call.op === 'insert'),
      'no separate supersede or insert may be issued',
    );

    const params = calls[0]!.payload ?? {};
    assert.equal(params.p_credential_id, credentialId);
    assert.equal(params.p_secret_version, 2);
    // The sealed record travels as the parameter it is; nothing unwraps it.
    assert.deepEqual(params.p_encrypted_secret, {
      v: 1,
      alg: 'AES-256-GCM',
      kid: 'k_0123456789ab',
      iv: 'aXY=',
      ct: 'Y3Q=',
    });

    // Every parameter it sends is one the function declares.
    const signature = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION cortex.ai_provider_credential_activate'),
      migration.indexOf('RETURNS VOID'),
    );
    assert.ok(signature.length > 0, 'the activation function must exist');
    for (const parameter of Object.keys(params)) {
      assert.ok(signature.includes(parameter), `the function has no parameter "${parameter}"`);
    }
  });

  it('never selects the sealed column when reading credential metadata', async () => {
    const { client, calls } = recordingClient([{ provider_key: 'openai' }]);
    const store = createSupabaseProviderAdministrationStore({ client });

    await store.listCredentials('pvc_0123456789abcdef0123456789abcdef');

    const read = calls.find(
      (call) => call.table === 'ai_provider_credential' && call.op === 'select',
    );
    assert.ok(read, 'a credential metadata read was issued');
    // A metadata read that said `*` would return `encrypted_secret` too, and the
    // sealed record would then flow wherever the metadata flows.
    assert.ok(!read.columns?.includes('encrypted_secret'));
    assert.ok(!read.columns?.includes('*'));
    assert.ok(read.columns?.includes('fingerprint'));
  });

  it('selects the sealed column from exactly one method', async () => {
    const { client, calls } = recordingClient([{ provider_key: 'openai' }]);
    const store = createSupabaseProviderAdministrationStore({ client });

    await store.activeCredential('pvc_0123456789abcdef0123456789abcdef');

    const read = calls.find(
      (call) => call.table === 'ai_provider_credential' && call.op === 'select.single',
    );
    assert.ok(read?.columns?.includes('encrypted_secret'));
    // Keyed by CONFIGURATION and status, never by credential id — so there is
    // no call shape meaning "show me that particular secret".
    assert.deepEqual(read.filters, [
      ['configuration_id', 'pvc_0123456789abcdef0123456789abcdef'],
      ['status', 'active'],
    ]);
  });

  it('finds a platform configuration with IS NULL, not = NULL', async () => {
    const { client, calls } = recordingClient();
    const store = createSupabaseProviderAdministrationStore({ client });

    await store.findConfiguration('platform', 'openai');

    const read = calls.find((call) => call.op === 'select.single');
    // PostgREST renders `eq` as `= NULL`, which is never true, so a platform
    // row would never be found. The two spellings differ in exactly the case
    // the partial unique index depends on.
    assert.deepEqual(read?.filters, [
      ['scope', 'platform'],
      ['provider_key', 'openai'],
      ['organization_id', null],
    ]);
  });
});
