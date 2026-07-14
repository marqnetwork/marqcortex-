/**
 * Diagnostic storage gateway tests — MCV2-S7.2-IMPLEMENT-007
 *
 * Proves Phase 1 behaviour: KV-only, KV data unchanged, telemetry off by
 * default and failure-isolated, no SQL/comparison/fallback, and that the
 * gateway reproduces the routes' previous parsing semantics exactly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ReadMode,
  StorageSource,
  DiagnosticEntity,
  StorageReadError,
  createKvDiagnosticAdapter,
  createDiagnosticStorageGateway,
  createRuntimeDiagnosticGateway,
  createInMemoryTelemetrySink,
  createNoopTelemetrySink,
  buildReadContext,
  readStorageConfig,
  resolveActiveMode,
  parseReadMode,
  safeEmit,
  STORAGE_ENV_KEYS,
} from '../../supabase/functions/server/storage/index.ts';
import { safeJsonParse } from '../../supabase/functions/server/storage/kvParse.ts';

// --- test doubles ----------------------------------------------------------

type Store = Record<string, unknown>;

function makeKvPort(store: Store) {
  const calls: string[] = [];
  return {
    calls,
    get: async (key: string) => {
      calls.push(`get:${key}`);
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : undefined;
    },
    getByPrefix: async (prefix: string) => {
      calls.push(`getByPrefix:${prefix}`);
      return Object.keys(store)
        .filter((k) => k.startsWith(prefix))
        .map((k) => store[k]);
    },
  };
}

function throwingKvPort() {
  return {
    get: async () => {
      throw new Error('kv boom');
    },
    getByPrefix: async () => {
      throw new Error('kv boom');
    },
  };
}

const ctx = (entity: DiagnosticEntity) =>
  buildReadContext({ route: 'test', entity, actor: { kind: 'team', id: 'u1' }, organizationId: 'org-1' });

const kvOnlyConfig = () => readStorageConfig({}); // no env -> all KV_ONLY, telemetry off

// --- configuration ---------------------------------------------------------

describe('config: read-mode resolution', () => {
  it('defaults every entity to KV_ONLY with no env', () => {
    const cfg = readStorageConfig({});
    assert.equal(cfg.dualReadEnabled, false);
    assert.equal(cfg.telemetryEnabled, false);
    for (const entity of Object.values(DiagnosticEntity)) {
      assert.equal(resolveActiveMode(cfg, entity as DiagnosticEntity), ReadMode.KV_ONLY);
    }
  });

  it('invalid/unknown mode value falls back to KV_ONLY', () => {
    assert.equal(parseReadMode('totally-bogus'), ReadMode.KV_ONLY);
    assert.equal(parseReadMode(undefined), ReadMode.KV_ONLY);
    const cfg = readStorageConfig({
      [STORAGE_ENV_KEYS.DUAL_READ_ENABLED]: 'true',
      [STORAGE_ENV_KEYS.MODE_SUBMISSION]: 'nonsense',
    });
    assert.equal(resolveActiveMode(cfg, DiagnosticEntity.SUBMISSION), ReadMode.KV_ONLY);
  });

  it('kill switch (master gate off) forces KV_ONLY even when SQL modes are set', () => {
    const cfg = readStorageConfig({
      [STORAGE_ENV_KEYS.DUAL_READ_ENABLED]: 'false',
      [STORAGE_ENV_KEYS.MODE_SUBMISSION]: 'sql_only',
      [STORAGE_ENV_KEYS.MODE_OUTCOME]: 'sql_primary_kv_fallback',
    });
    assert.equal(resolveActiveMode(cfg, DiagnosticEntity.SUBMISSION), ReadMode.KV_ONLY);
    assert.equal(resolveActiveMode(cfg, DiagnosticEntity.OUTCOME), ReadMode.KV_ONLY);
  });

  it('Phase 1 clamps a future SQL mode down to KV_ONLY even when master gate is on', () => {
    const cfg = readStorageConfig({
      [STORAGE_ENV_KEYS.DUAL_READ_ENABLED]: 'true',
      [STORAGE_ENV_KEYS.MODE_SUBMISSION]: 'kv_primary_shadow_sql',
    });
    // config surfaces the raw mode...
    assert.equal(cfg.modeByEntity[DiagnosticEntity.SUBMISSION], ReadMode.KV_PRIMARY_SHADOW_SQL);
    // ...but the executable/active mode is clamped to KV_ONLY this phase.
    assert.equal(resolveActiveMode(cfg, DiagnosticEntity.SUBMISSION), ReadMode.KV_ONLY);
  });
});

// --- gateway reads ---------------------------------------------------------

describe('gateway: submission reads', () => {
  const submission = { id: 'SUB-1', company: 'Acme', submittedAt: '2026-01-02T00:00:00.000Z' };
  const store: Store = { 'sub:SUB-1': JSON.stringify(submission) };

  it('returns KV data unchanged (== safeJsonParse of raw) and reports KV source/KV_ONLY', async () => {
    const kv = makeKvPort(store);
    const gw = createDiagnosticStorageGateway({
      kvAdapter: createKvDiagnosticAdapter(kv),
      config: kvOnlyConfig(),
    });
    const res = await gw.getSubmission('SUB-1', ctx(DiagnosticEntity.SUBMISSION));
    assert.deepEqual(res.data, safeJsonParse(store['sub:SUB-1']));
    assert.deepEqual(res.data, submission);
    assert.equal(res.found, true);
    assert.equal(res.returnedSource, StorageSource.KV);
    assert.equal(res.mode, ReadMode.KV_ONLY);
    // no SQL: only KV port methods were touched
    assert.deepEqual(kv.calls, ['get:sub:SUB-1']);
    // no comparison / no fallback surfaced
    assert.equal('comparison' in res, false);
    assert.equal(res.latency.sqlMs, undefined);
  });

  it('missing record: found=false, data=null (mirrors route 404 branch)', async () => {
    const kv = makeKvPort({});
    const gw = createDiagnosticStorageGateway({ kvAdapter: createKvDiagnosticAdapter(kv), config: kvOnlyConfig() });
    const res = await gw.getSubmission('nope', ctx(DiagnosticEntity.SUBMISSION));
    assert.equal(res.found, false);
    assert.equal(res.data, null);
  });
});

describe('gateway: submission list', () => {
  it('parses, filters non-submissions, and sorts newest-first', async () => {
    const store: Store = {
      'sub:OLD': JSON.stringify({ id: 'OLD', submittedAt: '2026-01-01T00:00:00.000Z' }),
      'sub:NEW': JSON.stringify({ id: 'NEW', submittedAt: '2026-03-01T00:00:00.000Z' }),
      'sub:MID': JSON.stringify({ id: 'MID', submittedAt: '2026-02-01T00:00:00.000Z' }),
      // index/email-style entry that must be filtered out (no id)
      'sub:junk': 'plain-string-not-a-submission',
    };
    const kv = makeKvPort(store);
    const gw = createDiagnosticStorageGateway({ kvAdapter: createKvDiagnosticAdapter(kv), config: kvOnlyConfig() });
    const res = await gw.listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST));
    const ids = (res.data as any[]).map((s) => s.id);
    assert.deepEqual(ids, ['NEW', 'MID', 'OLD']);
    assert.equal(res.returnedSource, StorageSource.KV);
  });

  it('non-array KV response yields empty list (identical to empty case)', async () => {
    const kv = {
      get: async () => undefined,
      getByPrefix: async () => ({ not: 'an array' } as unknown as unknown[]),
    };
    const gw = createDiagnosticStorageGateway({ kvAdapter: createKvDiagnosticAdapter(kv), config: kvOnlyConfig() });
    const res = await gw.listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST));
    assert.deepEqual(res.data, []);
    assert.equal(res.found, false);
  });

  it('KV error surfaces as StorageReadError carrying the original cause', async () => {
    const gw = createDiagnosticStorageGateway({ kvAdapter: createKvDiagnosticAdapter(throwingKvPort()), config: kvOnlyConfig() });
    await assert.rejects(
      () => gw.listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST)),
      (err: unknown) => {
        assert.ok(err instanceof StorageReadError);
        assert.equal((err as StorageReadError).code, 'KV_READ_ERROR');
        assert.equal(((err as StorageReadError).cause as Error).message, 'kv boom');
        return true;
      },
    );
  });
});

describe('gateway: outcome reads', () => {
  it('uses JSON.parse semantics (truthy raw -> parsed, else null)', async () => {
    const outcome = { didConvert: true, conversionValue: 1000 };
    const kv = makeKvPort({ 'outcome:SUB-1': JSON.stringify(outcome) });
    const gw = createDiagnosticStorageGateway({ kvAdapter: createKvDiagnosticAdapter(kv), config: kvOnlyConfig() });
    const res = await gw.getOutcome('SUB-1', ctx(DiagnosticEntity.OUTCOME));
    assert.deepEqual(res.data, outcome);

    const empty = await gw.getOutcome('absent', ctx(DiagnosticEntity.OUTCOME));
    assert.equal(empty.data, null);
    assert.equal(empty.found, false);
  });
});

// --- telemetry -------------------------------------------------------------

describe('telemetry', () => {
  it('is disabled by default (no-op sink emits nothing observable)', () => {
    const sink = createNoopTelemetrySink();
    assert.equal(sink.enabled, false);
    assert.equal(safeEmit(sink, {} as any), false);
  });

  it('emits requestId + organizationId when an enabled sink is provided', async () => {
    const sink = createInMemoryTelemetrySink();
    const kv = makeKvPort({ 'sub:SUB-1': JSON.stringify({ id: 'SUB-1' }) });
    const gw = createDiagnosticStorageGateway({ kvAdapter: createKvDiagnosticAdapter(kv), config: kvOnlyConfig(), telemetry: sink });
    const context = ctx(DiagnosticEntity.SUBMISSION);
    await gw.getSubmission('SUB-1', context);
    assert.equal(sink.events.length, 1);
    const ev = sink.events[0];
    assert.equal(ev.requestId, context.requestId);
    assert.equal(ev.organizationId, 'org-1');
    assert.equal(ev.returnedSource, StorageSource.KV);
    assert.equal(ev.configuredMode, ReadMode.KV_ONLY);
    // approved identifiers only — no raw payload leaked
    assert.equal('data' in ev, false);
    assert.equal('submission' in ev, false);
  });

  it('telemetry sink failure does not affect the read', async () => {
    const explodingSink = {
      enabled: true,
      emit() {
        throw new Error('sink down');
      },
    };
    const kv = makeKvPort({ 'sub:SUB-1': JSON.stringify({ id: 'SUB-1', company: 'Acme' }) });
    const gw = createDiagnosticStorageGateway({ kvAdapter: createKvDiagnosticAdapter(kv), config: kvOnlyConfig(), telemetry: explodingSink });
    const res = await gw.getSubmission('SUB-1', ctx(DiagnosticEntity.SUBMISSION));
    assert.deepEqual(res.data, { id: 'SUB-1', company: 'Acme' });
    assert.equal(res.found, true);
  });
});

// --- runtime factory -------------------------------------------------------

describe('runtime factory: authority stays KV', () => {
  it('createRuntimeDiagnosticGateway resolves KV_ONLY and telemetry off under Node defaults', async () => {
    const kv = makeKvPort({ 'sub:SUB-1': JSON.stringify({ id: 'SUB-1' }) });
    const gw = createRuntimeDiagnosticGateway(kv);
    const res = await gw.getSubmission('SUB-1', ctx(DiagnosticEntity.SUBMISSION));
    assert.equal(res.mode, ReadMode.KV_ONLY);
    assert.equal(res.returnedSource, StorageSource.KV);
  });
});
