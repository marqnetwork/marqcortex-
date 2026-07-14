/**
 * Storage gateway VALIDATION suite — MCV2-S7.3-VALIDATE-008
 *
 * Hardening/parity validation for the Phase 1 KV-only gateway. Proves:
 *   - response parity with the pre-gateway inline route behavior
 *   - config fail-safe (missing/invalid/kill switch) and determinism
 *   - telemetry disabled by default, failure-isolated, single emission
 *   - SQL adapter can never be invoked (source scan + runtime assertion)
 *   - tenant/org context propagation is route-controlled, not caller-injected
 *   - bounded failure behavior and exactly-one KV read per call
 *
 * No SQL. No shadow reads. Offline-testable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ReadMode,
  StorageSource,
  DiagnosticEntity,
  StorageReadError,
  createKvDiagnosticAdapter,
  createDiagnosticStorageGateway,
  createInMemoryTelemetrySink,
  buildReadContext,
  readStorageConfig,
  resolveActiveMode,
  parseReadMode,
  STORAGE_ENV_KEYS,
} from '../../supabase/functions/server/storage/index.ts';
import { safeJsonParse } from '../../supabase/functions/server/storage/kvParse.ts';

const storageDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'functions', 'server', 'storage');

// --- instrumented KV port (counts calls per key) --------------------------

function makeCountingKvPort(store: Record<string, unknown>) {
  const counts = { get: 0, getByPrefix: 0 };
  const perKey: Record<string, number> = {};
  return {
    counts,
    perKey,
    get: async (key: string) => {
      counts.get += 1;
      perKey[key] = (perKey[key] ?? 0) + 1;
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : undefined;
    },
    getByPrefix: async (prefix: string) => {
      counts.getByPrefix += 1;
      return Object.keys(store).filter((k) => k.startsWith(prefix)).map((k) => store[k]);
    },
  };
}

const kvOnly = () => readStorageConfig({});
const ctx = (entity: DiagnosticEntity, organizationId: string | null = null) =>
  buildReadContext({ route: 'test', entity, actor: { kind: 'team', id: 'u1' }, organizationId });

const gw = (kv: any, cfg = kvOnly(), telemetry?: any) =>
  createDiagnosticStorageGateway({ kvAdapter: createKvDiagnosticAdapter(kv), config: cfg, telemetry });

// ===========================================================================
// STAGE 2 — RESPONSE PARITY
// ===========================================================================

describe('S7.3 parity: submission single (legacy: safeJsonParse, 404 when !raw)', () => {
  it('JSON-string record -> parsed object, found=true', async () => {
    const obj = { id: 'SUB-1', company: 'Acme', answers: { q1: 'a' } };
    const kv = makeCountingKvPort({ 'sub:SUB-1': JSON.stringify(obj) });
    const res = await gw(kv).getSubmission('SUB-1', ctx(DiagnosticEntity.SUBMISSION));
    // legacy route returned safeJsonParse(raw); gateway must match exactly
    assert.deepEqual(res.data, safeJsonParse(JSON.stringify(obj)));
    assert.deepEqual(res.data, obj);
    assert.equal(res.found, true);
  });

  it('already-object JSONB value -> returned as-is (safeJsonParse object branch)', async () => {
    const obj = { id: 'SUB-2' };
    const kv = makeCountingKvPort({ 'sub:SUB-2': obj });
    const res = await gw(kv).getSubmission('SUB-2', ctx(DiagnosticEntity.SUBMISSION));
    assert.deepEqual(res.data, obj);
    assert.equal(res.found, true);
  });

  it('absent record -> found=false, data=null (legacy 404 branch)', async () => {
    const kv = makeCountingKvPort({});
    const res = await gw(kv).getSubmission('nope', ctx(DiagnosticEntity.SUBMISSION));
    assert.equal(res.found, false);
    assert.equal(res.data, null);
  });
});

describe('S7.3 parity: submission list (legacy: parseSubmissions + newest-first sort)', () => {
  it('filters non-submissions, sorts desc by submittedAt', async () => {
    const kv = makeCountingKvPort({
      'sub:A': JSON.stringify({ id: 'A', submittedAt: '2026-01-01T00:00:00Z' }),
      'sub:C': JSON.stringify({ id: 'C', submittedAt: '2026-03-01T00:00:00Z' }),
      'sub:B': JSON.stringify({ id: 'B', submittedAt: '2026-02-01T00:00:00Z' }),
      'sub:noise': 'sub_email-style-string',
      'sub:bad': '{not valid json',
    });
    const res = await gw(kv).listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST));
    assert.deepEqual((res.data as any[]).map((s) => s.id), ['C', 'B', 'A']);
  });

  it('non-array KV response -> [] (identical to empty; matches legacy short-circuit)', async () => {
    const kv = { get: async () => undefined, getByPrefix: async () => 42 as unknown as unknown[] };
    const res = await gw(kv).listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST));
    assert.deepEqual(res.data, []);
  });

  it('invalid submittedAt values do not throw and are ordered last-stable', async () => {
    const kv = makeCountingKvPort({
      'sub:X': JSON.stringify({ id: 'X', submittedAt: 'not-a-date' }),
      'sub:Y': JSON.stringify({ id: 'Y', submittedAt: '2026-05-01T00:00:00Z' }),
    });
    const res = await gw(kv).listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST));
    assert.equal((res.data as any[])[0].id, 'Y');
  });
});

describe('S7.3 parity: outcome (legacy: raw ? JSON.parse(raw) : null)', () => {
  it('JSON-string outcome -> parsed', async () => {
    const outcome = { didConvert: true, conversionValue: 500 };
    const kv = makeCountingKvPort({ 'outcome:SUB-1': JSON.stringify(outcome) });
    const res = await gw(kv).getOutcome('SUB-1', ctx(DiagnosticEntity.OUTCOME));
    assert.deepEqual(res.data, outcome);
  });

  it('absent outcome -> null', async () => {
    const kv = makeCountingKvPort({});
    const res = await gw(kv).getOutcome('none', ctx(DiagnosticEntity.OUTCOME));
    assert.equal(res.data, null);
  });

  it('malformed outcome raw -> throws SyntaxError (parity with legacy JSON.parse)', async () => {
    const kv = makeCountingKvPort({ 'outcome:bad': '{broken' });
    await assert.rejects(
      () => gw(kv).getOutcome('bad', ctx(DiagnosticEntity.OUTCOME)),
      (err: unknown) => err instanceof SyntaxError,
    );
  });
});

// ===========================================================================
// STAGE 3 — CONFIGURATION SAFETY
// ===========================================================================

describe('S7.3 config safety', () => {
  it('missing config -> kv_only everywhere, telemetry off', () => {
    const cfg = readStorageConfig({});
    assert.equal(cfg.telemetryEnabled, false);
    for (const e of Object.values(DiagnosticEntity)) {
      assert.equal(resolveActiveMode(cfg, e as DiagnosticEntity), ReadMode.KV_ONLY);
    }
  });

  it('invalid mode -> kv_only', () => {
    assert.equal(parseReadMode('SELECT * FROM x'), ReadMode.KV_ONLY);
    const cfg = readStorageConfig({ [STORAGE_ENV_KEYS.DUAL_READ_ENABLED]: 'true', [STORAGE_ENV_KEYS.MODE_SUBMISSION]: '???' });
    assert.equal(resolveActiveMode(cfg, DiagnosticEntity.SUBMISSION), ReadMode.KV_ONLY);
  });

  it('kill switch (master off) forces kv_only even with sql modes set', () => {
    const cfg = readStorageConfig({
      [STORAGE_ENV_KEYS.DUAL_READ_ENABLED]: 'false',
      [STORAGE_ENV_KEYS.MODE_SUBMISSION]: 'sql_only',
      [STORAGE_ENV_KEYS.MODE_OUTCOME]: 'sql_primary_kv_fallback',
    });
    assert.equal(resolveActiveMode(cfg, DiagnosticEntity.SUBMISSION), ReadMode.KV_ONLY);
    assert.equal(resolveActiveMode(cfg, DiagnosticEntity.OUTCOME), ReadMode.KV_ONLY);
  });

  it('no env value can activate SQL this phase (every known mode clamps to kv_only)', () => {
    for (const mode of ['kv_only', 'kv_primary_shadow_sql', 'sql_primary_kv_fallback', 'sql_only', 'disabled']) {
      const cfg = readStorageConfig({ [STORAGE_ENV_KEYS.DUAL_READ_ENABLED]: 'true', [STORAGE_ENV_KEYS.MODE_SUBMISSION]: mode });
      assert.equal(resolveActiveMode(cfg, DiagnosticEntity.SUBMISSION), ReadMode.KV_ONLY, `mode ${mode} must clamp`);
    }
  });

  it('precedence is deterministic (same env -> same result, repeated)', () => {
    const env = { [STORAGE_ENV_KEYS.DUAL_READ_ENABLED]: 'true', [STORAGE_ENV_KEYS.MODE_OUTCOME]: 'kv_only' };
    const a = resolveActiveMode(readStorageConfig(env), DiagnosticEntity.OUTCOME);
    const b = resolveActiveMode(readStorageConfig(env), DiagnosticEntity.OUTCOME);
    assert.equal(a, b);
    assert.equal(a, ReadMode.KV_ONLY);
  });

  it('malformed startup config (weird types/casing) does not throw and stays safe', () => {
    const cfg = readStorageConfig({ [STORAGE_ENV_KEYS.DUAL_READ_ENABLED]: 'TRUE', [STORAGE_ENV_KEYS.MODE_SUBMISSION]: '  SQL_ONLY  ' });
    // 'TRUE' is not exactly 'true' -> master gate false -> kv_only; and clamp anyway
    assert.equal(resolveActiveMode(cfg, DiagnosticEntity.SUBMISSION), ReadMode.KV_ONLY);
  });
});

// ===========================================================================
// STAGE 4 — TELEMETRY SAFETY
// ===========================================================================

describe('S7.3 telemetry safety', () => {
  it('exactly one emission per read (no duplicates)', async () => {
    const sink = createInMemoryTelemetrySink();
    const kv = makeCountingKvPort({ 'sub:SUB-1': JSON.stringify({ id: 'SUB-1' }) });
    await gw(kv, kvOnly(), sink).getSubmission('SUB-1', ctx(DiagnosticEntity.SUBMISSION));
    assert.equal(sink.events.length, 1);
  });

  it('event carries only approved identifiers — no raw payload/PII', async () => {
    const sink = createInMemoryTelemetrySink();
    const kv = makeCountingKvPort({ 'sub:SUB-1': JSON.stringify({ id: 'SUB-1', email: 'x@y.z', answers: { q: 'secret' } }) });
    await gw(kv, kvOnly(), sink).getSubmission('SUB-1', ctx(DiagnosticEntity.SUBMISSION, 'org-9'));
    const ev = sink.events[0];
    // Only approved identifier fields; errorClass is an approved field (undefined on success).
    const allowed = ['configuredMode', 'entity', 'errorClass', 'kvMs', 'organizationId', 'requestId', 'returnedSource', 'route', 'sqlMs'];
    for (const k of Object.keys(ev)) {
      assert.ok(allowed.includes(k), `unexpected telemetry field: ${k}`);
    }
    // No raw payload / PII leaks (undefined fields are dropped by JSON.stringify).
    assert.equal(JSON.stringify(ev).includes('secret'), false);
    assert.equal(JSON.stringify(ev).includes('x@y.z'), false);
    assert.equal(ev.organizationId, 'org-9');
  });

  it('failing telemetry sink does not affect the read result', async () => {
    const explode = { enabled: true, emit() { throw new Error('sink down'); } };
    const kv = makeCountingKvPort({ 'sub:SUB-1': JSON.stringify({ id: 'SUB-1', company: 'Acme' }) });
    const res = await gw(kv, kvOnly(), explode).getSubmission('SUB-1', ctx(DiagnosticEntity.SUBMISSION));
    assert.deepEqual(res.data, { id: 'SUB-1', company: 'Acme' });
  });

  it('slow/throwing sink on the error path also does not mask the KV error', async () => {
    const explode = { enabled: true, emit() { throw new Error('sink down'); } };
    const kv = { get: async () => { throw new Error('kv down'); }, getByPrefix: async () => { throw new Error('kv down'); } };
    await assert.rejects(() => gw(kv, kvOnly(), explode).getSubmission('x', ctx(DiagnosticEntity.SUBMISSION)), StorageReadError);
  });
});

// ===========================================================================
// STAGE 5 — SQL ACTIVATION PROTECTION
// ===========================================================================

describe('S7.3 SQL activation protection', () => {
  it('no storage source module references SQL/repositories/Supabase/Deno', () => {
    for (const file of readdirSync(storageDir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(storageDir, file), 'utf8');
      assert.equal(/repositor/i.test(src), false, `${file} references repositories`);
      assert.equal(/@supabase|createClient\(/.test(src), false, `${file} references Supabase client`);
      assert.equal(/\bjsr:/.test(src), false, `${file} has a jsr import`);
      assert.equal(/from ['"]\.\.\//.test(src), false, `${file} imports outside storage/`);
    }
  });

  it('barrel exports expose no SQL adapter symbol', async () => {
    const mod: Record<string, unknown> = await import('../../supabase/functions/server/storage/index.ts');
    const sqlish = Object.keys(mod).filter((k) => /sql|repository|postgres/i.test(k));
    assert.deepEqual(sqlish, []);
  });

  it('every read returns returnedSource=kv and mode=kv_only', async () => {
    const kv = makeCountingKvPort({ 'sub:S': JSON.stringify({ id: 'S' }), 'outcome:S': JSON.stringify({ ok: true }) });
    const g = gw(kv);
    for (const res of [
      await g.getSubmission('S', ctx(DiagnosticEntity.SUBMISSION)),
      await g.listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST)),
      await g.getOutcome('S', ctx(DiagnosticEntity.OUTCOME)),
    ]) {
      assert.equal(res.returnedSource, StorageSource.KV);
      assert.equal(res.mode, ReadMode.KV_ONLY);
      assert.equal(res.latency.sqlMs, undefined);
    }
  });
});

// ===========================================================================
// STAGE 6 — TENANT CONTEXT
// ===========================================================================

describe('S7.3 tenant/org context', () => {
  it('org context flows from ReadContext into telemetry (route-controlled)', async () => {
    const sink = createInMemoryTelemetrySink();
    const kv = makeCountingKvPort({ 'sub:S': JSON.stringify({ id: 'S' }) });
    await gw(kv, kvOnly(), sink).getSubmission('S', ctx(DiagnosticEntity.SUBMISSION, 'org-A'));
    assert.equal(sink.events[0].organizationId, 'org-A');
  });

  it('missing org context is preserved as null (no fabrication, no widening)', async () => {
    const sink = createInMemoryTelemetrySink();
    const kv = makeCountingKvPort({ 'sub:S': JSON.stringify({ id: 'S' }) });
    await gw(kv, kvOnly(), sink).getSubmission('S', ctx(DiagnosticEntity.SUBMISSION, null));
    assert.equal(sink.events[0].organizationId, null);
  });

  it('KV key is derived only from the id argument (no org-scoped key injection)', async () => {
    const kv = makeCountingKvPort({ 'sub:S': JSON.stringify({ id: 'S' }) });
    await gw(kv).getSubmission('S', ctx(DiagnosticEntity.SUBMISSION, 'org-EVIL'));
    assert.deepEqual(Object.keys(kv.perKey), ['sub:S']);
  });
});

// ===========================================================================
// STAGE 7 — FAILURE BEHAVIOR + STAGE 9 — NO DUPLICATE READS
// ===========================================================================

describe('S7.3 failure behavior', () => {
  it('KV read failure -> StorageReadError(KV_READ_ERROR) with original cause, no fabricated data', async () => {
    const kv = { get: async () => { throw new Error('kv boom'); }, getByPrefix: async () => { throw new Error('kv boom'); } };
    await assert.rejects(
      () => gw(kv).getSubmission('x', ctx(DiagnosticEntity.SUBMISSION)),
      (err: unknown) => {
        assert.ok(err instanceof StorageReadError);
        assert.equal((err as StorageReadError).code, 'KV_READ_ERROR');
        assert.equal(((err as StorageReadError).cause as Error).message, 'kv boom');
        return true;
      },
    );
  });

  it('list KV failure preserves route "Database error" envelope via .cause unwrap', async () => {
    const kv = { get: async () => undefined, getByPrefix: async () => { throw new Error('conn refused'); } };
    try {
      await gw(kv).listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST));
      assert.fail('expected throw');
    } catch (kvError) {
      const cause = kvError instanceof StorageReadError ? kvError.cause : kvError;
      const envelope = { error: `Database error: ${(cause as any)?.message}`, details: 'Failed to connect to database. Please check Supabase connection.' };
      assert.equal(envelope.error, 'Database error: conn refused');
    }
  });
});

describe('S7.3 no duplicate KV reads (performance guard)', () => {
  it('getSubmission issues exactly one kv.get and no prefix scan', async () => {
    const kv = makeCountingKvPort({ 'sub:S': JSON.stringify({ id: 'S' }) });
    await gw(kv).getSubmission('S', ctx(DiagnosticEntity.SUBMISSION));
    assert.equal(kv.counts.get, 1);
    assert.equal(kv.counts.getByPrefix, 0);
  });

  it('listSubmissions issues exactly one getByPrefix and no per-key get', async () => {
    const kv = makeCountingKvPort({ 'sub:A': JSON.stringify({ id: 'A' }), 'sub:B': JSON.stringify({ id: 'B' }) });
    await gw(kv).listSubmissions(ctx(DiagnosticEntity.SUBMISSION_LIST));
    assert.equal(kv.counts.getByPrefix, 1);
    assert.equal(kv.counts.get, 0);
  });

  it('getOutcome issues exactly one kv.get', async () => {
    const kv = makeCountingKvPort({ 'outcome:S': JSON.stringify({ ok: true }) });
    await gw(kv).getOutcome('S', ctx(DiagnosticEntity.OUTCOME));
    assert.equal(kv.counts.get, 1);
  });
});
