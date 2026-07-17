/**
 * Outcome shadow-read tests — MCV2-S7.4-IMPLEMENT-009
 *
 * Proves: shadow disabled by default; kill switch; eligibility/allowlist;
 * KV always returned; comparison categories; timeout/error isolation;
 * telemetry safety; no duplicate KV/SQL reads; no fallback; Outcome-only scope.
 * Fully offline (fake KV port + fake SQL port). SQL never returned to caller.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  StorageSource,
  ComparisonOutcome,
  DiagnosticEntity,
  createKvDiagnosticAdapter,
  createDiagnosticStorageGateway,
  createInMemoryTelemetrySink,
  buildReadContext,
  readStorageConfig,
  readOutcomeShadowConfig,
  resolveOutcomeShadowEligibility,
  compareOutcome,
  normalizeKvOutcome,
  normalizeSqlOutcome,
} from '../../supabase/functions/server/storage/index.ts';

// --- fakes -----------------------------------------------------------------

function kvPort(store: Record<string, unknown>) {
  const counts = { get: 0, getByPrefix: 0 };
  return {
    counts,
    get: async (k: string) => { counts.get += 1; return store[k]; },
    getByPrefix: async (p: string) => { counts.getByPrefix += 1; return Object.keys(store).filter((x) => x.startsWith(p)).map((x) => store[x]); },
  };
}

function sqlPort(record: unknown, opts: { delayMs?: number; throwErr?: Error } = {}) {
  const calls: Array<{ submissionId: string; organizationId: string }> = [];
  return {
    calls,
    getOutcomeBySubmission: async (submissionId: string, organizationId: string) => {
      calls.push({ submissionId, organizationId });
      if (opts.throwErr) throw opts.throwErr;
      if (opts.delayMs) {
        // unref so a dangling delay (e.g. the timeout scenario) never keeps the
        // test process alive or leaks async activity across tests.
        await new Promise((r) => {
          const t = setTimeout(r, opts.delayMs);
          (t as { unref?: () => void }).unref?.();
        });
      }
      return record;
    },
  };
}

const KV_OUTCOME = {
  submissionId: 'SUB-1', didConvert: true, conversionValue: 1000, lostReason: null,
  recommendationWorked: true, whatWeLearned: 'good', improvementAreas: ['a', 'b'],
  industry: 'Tech', company: 'Acme', aiScore: 70, loggedAt: '2026-01-01T00:00:00Z',
};
const kvStore = () => ({ 'outcome:SUB-1': JSON.stringify(KV_OUTCOME) });

function sqlRecord(valueOverride: Record<string, unknown> = {}, rec: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1', organization_id: 'org-1', submission_id: 'SUB-1', legacy_kv_key: 'outcome:SUB-1',
    outcome_type: 'engagement', status: 'converted', recorded_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', deleted_at: null,
    value: { didConvert: true, conversionValue: 1000, lostReason: null, recommendationWorked: true, whatWeLearned: 'good', improvementAreas: ['a', 'b'], ...valueOverride },
    ...rec,
  };
}

const shadowEnabled = (extra: Record<string, string> = {}) =>
  readOutcomeShadowConfig({ STORAGE_SHADOW_OUTCOME_ENABLED: 'true', STORAGE_SHADOW_DEFAULT_ORG_ID: 'org-1', ...extra });

const ctx = () => buildReadContext({ route: 'GET /submissions/:id/outcome', entity: DiagnosticEntity.OUTCOME, actor: { kind: 'team', id: 'u1' } });

function gateway(kv: any, sql: any, outcomeShadow: any, telemetry?: any) {
  return createDiagnosticStorageGateway({
    kvAdapter: createKvDiagnosticAdapter(kv),
    config: readStorageConfig({}),
    telemetry,
    sqlOutcomePort: sql,
    outcomeShadow,
  });
}

// ===========================================================================
// Configuration & eligibility
// ===========================================================================

describe('S7.4 shadow config & eligibility', () => {
  it('disabled by default', () => {
    const cfg = readOutcomeShadowConfig({});
    assert.equal(cfg.enabled, false);
    assert.equal(resolveOutcomeShadowEligibility(cfg, { organizationId: 'org-1', hasSqlPort: true }).eligible, false);
  });

  it('kill switch forces KV-only even when enabled', () => {
    const cfg = readOutcomeShadowConfig({ STORAGE_SHADOW_OUTCOME_ENABLED: 'true', STORAGE_FORCE_KV_ONLY: 'true' });
    assert.equal(cfg.enabled, false);
    assert.equal(resolveOutcomeShadowEligibility(cfg, { organizationId: 'org-1', hasSqlPort: true }).reason, 'kill_switch');
  });

  it('invalid config resolves to disabled', () => {
    const cfg = readOutcomeShadowConfig({ STORAGE_SHADOW_OUTCOME_ENABLED: 'yes-please' });
    assert.equal(cfg.enabled, false);
  });

  it('ineligible when org not in allowlist', () => {
    const cfg = shadowEnabled({ STORAGE_SHADOW_OUTCOME_ORG_ALLOWLIST: 'org-A,org-B' });
    const e = resolveOutcomeShadowEligibility(cfg, { organizationId: 'org-Z', hasSqlPort: true });
    assert.equal(e.eligible, false);
    assert.equal(e.reason, 'org_not_allowlisted');
  });

  it('ineligible when no org scope resolvable (fail closed)', () => {
    const cfg = readOutcomeShadowConfig({ STORAGE_SHADOW_OUTCOME_ENABLED: 'true' }); // no default org
    assert.equal(resolveOutcomeShadowEligibility(cfg, { organizationId: null, hasSqlPort: true }).reason, 'no_org_scope');
  });

  it('ineligible when no SQL port wired', () => {
    assert.equal(resolveOutcomeShadowEligibility(shadowEnabled(), { organizationId: 'org-1', hasSqlPort: false }).reason, 'no_sql_port');
  });

  it('eligible with default org + enabled + port', () => {
    const e = resolveOutcomeShadowEligibility(shadowEnabled(), { organizationId: null, hasSqlPort: true });
    assert.equal(e.eligible, true);
    assert.equal(e.effectiveOrg, 'org-1');
  });
});

// ===========================================================================
// Gateway behavior — disabled path
// ===========================================================================

describe('S7.4 gateway: shadow disabled', () => {
  it('no shadow attached, no SQL call, KV returned, one base telemetry event', async () => {
    const kv = kvPort(kvStore());
    const sql = sqlPort(sqlRecord());
    const sink = createInMemoryTelemetrySink();
    const res = await gateway(kv, sql, readOutcomeShadowConfig({}), sink).getOutcome('SUB-1', ctx());
    assert.equal(res.shadow, undefined);
    assert.equal(sql.calls.length, 0);
    assert.equal(res.returnedSource, StorageSource.KV);
    assert.deepEqual(res.data, KV_OUTCOME);
    assert.equal(sink.events.length, 1);
    assert.equal(sink.events[0].shadowAttempted, undefined);
    assert.equal(kv.counts.get, 1);
  });
});

// ===========================================================================
// Gateway behavior — enabled path
// ===========================================================================

describe('S7.4 gateway: shadow enabled', () => {
  it('performs exactly one SQL shadow read and still returns KV', async () => {
    const kv = kvPort(kvStore());
    const sql = sqlPort(sqlRecord());
    const res = await gateway(kv, sql, shadowEnabled()).getOutcome('SUB-1', ctx());
    assert.equal(res.returnedSource, StorageSource.KV);
    assert.deepEqual(res.data, KV_OUTCOME); // KV, never SQL
    assert.ok(res.shadow, 'shadow promise attached');
    const cmp = await res.shadow!;
    assert.equal(sql.calls.length, 1);
    assert.equal(sql.calls[0].organizationId, 'org-1'); // tenant-scoped
    assert.equal(kv.counts.get, 1); // no duplicate KV read
    assert.equal(cmp.outcome, ComparisonOutcome.MATCH);
  });

  it('emits exactly one shadow telemetry event with returnedSource=KV', async () => {
    const sink = createInMemoryTelemetrySink();
    const res = await gateway(kvPort(kvStore()), sqlPort(sqlRecord()), shadowEnabled(), sink).getOutcome('SUB-1', ctx());
    await res.shadow!;
    assert.equal(sink.events.length, 1);
    const ev = sink.events[0];
    assert.equal(ev.shadowAttempted, true);
    assert.equal(ev.returnedSource, StorageSource.KV);
    assert.equal(ev.comparisonOutcome, ComparisonOutcome.MATCH);
    // no raw payload leaked
    assert.equal(JSON.stringify(ev).includes('Acme'), false);
    assert.equal(JSON.stringify(ev).includes('good'), false);
  });

  it('normalization-only match ("" vs null)', async () => {
    const kv = kvPort({ 'outcome:SUB-1': JSON.stringify({ ...KV_OUTCOME, whatWeLearned: '' }) });
    const res = await gateway(kv, sqlPort(sqlRecord({ whatWeLearned: null })), shadowEnabled()).getOutcome('SUB-1', ctx());
    assert.equal((await res.shadow!).outcome, ComparisonOutcome.NORMALIZATION_ONLY_MATCH);
  });

  it('value mismatch reports the field only', async () => {
    const res = await gateway(kvPort(kvStore()), sqlPort(sqlRecord({ conversionValue: 2000 })), shadowEnabled()).getOutcome('SUB-1', ctx());
    const cmp = await res.shadow!;
    assert.equal(cmp.outcome, ComparisonOutcome.VALUE_MISMATCH);
    assert.deepEqual(cmp.mismatchFields, ['conversionValue']);
    assert.equal(cmp.severity, 'high');
  });

  it('relationship mismatch (submission linkage)', async () => {
    const res = await gateway(kvPort(kvStore()), sqlPort(sqlRecord({}, { submission_id: 'SUB-2', legacy_kv_key: 'outcome:SUB-2' })), shadowEnabled()).getOutcome('SUB-1', ctx());
    assert.equal((await res.shadow!).outcome, ComparisonOutcome.RELATIONSHIP_MISMATCH);
  });

  it('authorization mismatch is critical, not masked as value mismatch', async () => {
    const res = await gateway(kvPort(kvStore()), sqlPort(sqlRecord({ conversionValue: 999 }, { organization_id: 'org-EVIL' })), shadowEnabled()).getOutcome('SUB-1', ctx());
    const cmp = await res.shadow!;
    assert.equal(cmp.outcome, ComparisonOutcome.AUTHORIZATION_MISMATCH);
    assert.equal(cmp.severity, 'critical');
  });

  it('SQL target missing', async () => {
    const res = await gateway(kvPort(kvStore()), sqlPort(null), shadowEnabled()).getOutcome('SUB-1', ctx());
    assert.equal((await res.shadow!).outcome, ComparisonOutcome.TARGET_MISSING);
  });

  it('KV source missing (SQL present)', async () => {
    const res = await gateway(kvPort({}), sqlPort(sqlRecord()), shadowEnabled()).getOutcome('SUB-1', ctx());
    assert.equal(res.found, false);
    assert.equal(res.data, null); // KV still returned (null)
    assert.equal((await res.shadow!).outcome, ComparisonOutcome.SOURCE_MISSING);
  });

  it('SQL timeout -> error comparison, KV unaffected', async () => {
    const res = await gateway(kvPort(kvStore()), sqlPort(sqlRecord(), { delayMs: 100 }), shadowEnabled({ STORAGE_SHADOW_SQL_TIMEOUT_MS: '15' })).getOutcome('SUB-1', ctx());
    assert.deepEqual(res.data, KV_OUTCOME);
    const cmp = await res.shadow!;
    assert.equal(cmp.outcome, ComparisonOutcome.ERROR);
    assert.ok(cmp.sqlErrorClass);
  });

  it('SQL repository error -> error comparison, KV unaffected', async () => {
    const res = await gateway(kvPort(kvStore()), sqlPort(null, { throwErr: new Error('db down') }), shadowEnabled()).getOutcome('SUB-1', ctx());
    assert.deepEqual(res.data, KV_OUTCOME);
    assert.equal((await res.shadow!).outcome, ComparisonOutcome.ERROR);
  });

  it('telemetry sink failure does not affect read or shadow resolution', async () => {
    const explode = { enabled: true, emit() { throw new Error('sink down'); } };
    const res = await gateway(kvPort(kvStore()), sqlPort(sqlRecord()), shadowEnabled(), explode).getOutcome('SUB-1', ctx());
    assert.deepEqual(res.data, KV_OUTCOME);
    await res.shadow!; // resolves despite sink throwing
  });

  it('no duplicate SQL read', async () => {
    const sql = sqlPort(sqlRecord());
    const res = await gateway(kvPort(kvStore()), sql, shadowEnabled()).getOutcome('SUB-1', ctx());
    await res.shadow!;
    assert.equal(sql.calls.length, 1);
  });
});

// ===========================================================================
// Outcome-only scope
// ===========================================================================

describe('S7.4 outcome-only scope', () => {
  it('getSubmission never shadows / never calls SQL port', async () => {
    const sql = sqlPort(sqlRecord());
    const g = gateway(kvPort({ 'sub:SUB-1': JSON.stringify({ id: 'SUB-1' }) }), sql, shadowEnabled());
    const res = await g.getSubmission('SUB-1', buildReadContext({ route: 'GET /submissions/:id', entity: DiagnosticEntity.SUBMISSION, actor: { kind: 'team' } }));
    assert.equal(res.shadow, undefined);
    assert.equal(sql.calls.length, 0);
  });

  it('listSubmissions never shadows / never calls SQL port', async () => {
    const sql = sqlPort(sqlRecord());
    const g = gateway(kvPort({ 'sub:A': JSON.stringify({ id: 'A' }) }), sql, shadowEnabled());
    const res = await g.listSubmissions(buildReadContext({ route: 'GET /submissions', entity: DiagnosticEntity.SUBMISSION_LIST, actor: { kind: 'team' } }));
    assert.equal(res.shadow, undefined);
    assert.equal(sql.calls.length, 0);
  });
});

// ===========================================================================
// Pure comparator direct checks
// ===========================================================================

describe('S7.4 comparator direct', () => {
  const meta = { requestId: 'r', organizationId: 'org-1', effectiveOrg: 'org-1', entityRefHash: 'h' };
  it('exact match', () => {
    assert.equal(compareOutcome(KV_OUTCOME, sqlRecord(), meta).outcome, ComparisonOutcome.MATCH);
  });
  it('both missing -> match', () => {
    assert.equal(compareOutcome(null, null, meta).outcome, ComparisonOutcome.MATCH);
  });
  it('normalize maps empty and array order', () => {
    const a = normalizeKvOutcome({ ...KV_OUTCOME, improvementAreas: ['b', 'a'], whatWeLearned: '' });
    const b = normalizeSqlOutcome(sqlRecord({ improvementAreas: ['a', 'b'], whatWeLearned: null }));
    assert.deepEqual(a!.improvementAreas, b!.improvementAreas);
    assert.equal(a!.whatWeLearned, null);
  });
});
