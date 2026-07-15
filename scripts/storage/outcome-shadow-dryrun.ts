/**
 * Outcome shadow-read reconciliation DRY-RUN harness — MCV2-S7.5-VALIDATE-010
 *
 * Offline, deterministic exercise of the full Outcome shadow pipeline:
 *   gateway.getOutcome → KV read → SQL shadow (fixture port) → normalize →
 *   compare → telemetry (in-memory sink) → reconciliation summary.
 *
 * This proves the shadow/compare/telemetry pipeline end-to-end WITHOUT a live
 * Supabase. It is the exact template for the live reconciliation run: swap the
 * fixture SQL port for `createRuntimeOutcomeSqlPort()` and the fixture KV store
 * for the live `kv` helper, iterate real submission ids, and read the same
 * summary. KV is always the returned source; SQL is never returned.
 *
 * Run: `npm run storage:shadow-dryrun`
 */

import {
  ComparisonOutcome,
  DiagnosticEntity,
  StorageSource,
  createKvDiagnosticAdapter,
  createDiagnosticStorageGateway,
  createInMemoryTelemetrySink,
  buildReadContext,
  readStorageConfig,
  readOutcomeShadowConfig,
} from '../../supabase/functions/server/storage/index.ts';

type SqlBehavior = { record?: unknown; throwErr?: boolean };

interface Scenario {
  submissionId: string;
  kv?: unknown; // parsed KV outcome (absent => KV missing)
  sql: SqlBehavior;
  expect: string; // expected ComparisonOutcome
}

const ORG = 'org-dryrun';

function kvOutcome(over: Record<string, unknown> = {}) {
  return {
    submissionId: 'S', didConvert: true, conversionValue: 1000, lostReason: null,
    recommendationWorked: true, whatWeLearned: 'good', improvementAreas: ['a', 'b'], ...over,
  };
}
function sqlRow(valueOver: Record<string, unknown> = {}, rowOver: Record<string, unknown> = {}) {
  return {
    id: 'uuid', organization_id: ORG, submission_id: 'S', legacy_kv_key: 'outcome:S',
    outcome_type: 'engagement', status: 'converted', recorded_at: '2026-01-01T00:00:00Z',
    value: { didConvert: true, conversionValue: 1000, lostReason: null, recommendationWorked: true, whatWeLearned: 'good', improvementAreas: ['a', 'b'], ...valueOver },
    ...rowOver,
  };
}

/** Representative scenarios covering every comparison category. */
export function dryRunScenarios(): Scenario[] {
  return [
    { submissionId: 'S', kv: kvOutcome(), sql: { record: sqlRow() }, expect: ComparisonOutcome.MATCH },
    { submissionId: 'S', kv: kvOutcome({ whatWeLearned: '' }), sql: { record: sqlRow({ whatWeLearned: null }) }, expect: ComparisonOutcome.NORMALIZATION_ONLY_MATCH },
    { submissionId: 'S', kv: kvOutcome(), sql: { record: null }, expect: ComparisonOutcome.TARGET_MISSING },
    { submissionId: 'S', kv: undefined, sql: { record: sqlRow() }, expect: ComparisonOutcome.SOURCE_MISSING },
    { submissionId: 'S', kv: kvOutcome(), sql: { record: sqlRow({ conversionValue: 2000 }) }, expect: ComparisonOutcome.VALUE_MISMATCH },
    { submissionId: 'S', kv: kvOutcome(), sql: { record: sqlRow({}, { submission_id: 'S2', legacy_kv_key: 'outcome:S2' }) }, expect: ComparisonOutcome.RELATIONSHIP_MISMATCH },
    { submissionId: 'S', kv: kvOutcome(), sql: { record: sqlRow({}, { organization_id: 'org-OTHER' }) }, expect: ComparisonOutcome.AUTHORIZATION_MISMATCH },
    { submissionId: 'S', kv: kvOutcome(), sql: { record: sqlRow({}, { value: 'not-an-object' }) }, expect: ComparisonOutcome.SCHEMA_MISMATCH },
    { submissionId: 'S', kv: kvOutcome(), sql: { throwErr: true }, expect: ComparisonOutcome.ERROR },
  ];
}

export interface DryRunSummary {
  total: number;
  byOutcome: Record<string, number>;
  expectedMatches: number;
  kvAlwaysReturned: boolean;
  sqlEverReturned: boolean;
  maxSeverity: string;
  rows: Array<{ scenario: string; got: string; expected: string; ok: boolean; severity: string }>;
}

const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, high: 2, critical: 3 };

export async function runOutcomeShadowDryRun(): Promise<DryRunSummary> {
  const scenarios = dryRunScenarios();
  const byOutcome: Record<string, number> = {};
  const rows: DryRunSummary['rows'] = [];
  let kvAlwaysReturned = true;
  let sqlEverReturned = false;
  let expectedMatches = 0;
  let maxSeverity = 'info';

  const shadowCfg = readOutcomeShadowConfig({
    STORAGE_SHADOW_OUTCOME_ENABLED: 'true',
    STORAGE_SHADOW_DEFAULT_ORG_ID: ORG,
    STORAGE_ENVIRONMENT: 'dryrun',
  });

  for (const sc of scenarios) {
    const sink = createInMemoryTelemetrySink();
    const store: Record<string, unknown> = {};
    if (sc.kv !== undefined) store[`outcome:${sc.submissionId}`] = JSON.stringify(sc.kv);
    const kv = { get: async (k: string) => store[k], getByPrefix: async () => [] };
    const sqlPort = {
      getOutcomeBySubmission: async () => {
        if (sc.sql.throwErr) throw new Error('fixture repository error');
        return sc.sql.record;
      },
    };
    const gateway = createDiagnosticStorageGateway({
      kvAdapter: createKvDiagnosticAdapter(kv),
      config: readStorageConfig({}),
      telemetry: sink,
      sqlOutcomePort: sqlPort,
      outcomeShadow: shadowCfg,
    });

    const ctx = buildReadContext({ route: 'dryrun', entity: DiagnosticEntity.OUTCOME, actor: { kind: 'team', id: 'dryrun' } });
    const res = await gateway.getOutcome(sc.submissionId, ctx);

    // KV authority invariant.
    if (res.returnedSource !== StorageSource.KV) kvAlwaysReturned = false;
    const expectedData = sc.kv === undefined ? null : sc.kv;
    if (JSON.stringify(res.data) === JSON.stringify(sc.sql.record) && sc.sql.record !== null && JSON.stringify(sc.sql.record) !== JSON.stringify(expectedData)) {
      sqlEverReturned = true;
    }

    const cmp = await res.shadow!;
    byOutcome[cmp.outcome] = (byOutcome[cmp.outcome] ?? 0) + 1;
    if (SEVERITY_RANK[cmp.severity] > SEVERITY_RANK[maxSeverity]) maxSeverity = cmp.severity;
    const ok = cmp.outcome === sc.expect;
    if (ok) expectedMatches += 1;
    rows.push({ scenario: sc.expect, got: cmp.outcome, expected: sc.expect, ok, severity: cmp.severity });

    // Telemetry hygiene: exactly one event, KV source, no raw payload.
    if (sink.events.length !== 1) throw new Error(`expected 1 telemetry event, got ${sink.events.length}`);
    const evStr = JSON.stringify(sink.events[0]);
    if (evStr.includes('good') || evStr.includes('conversionValue')) throw new Error('raw payload leaked into telemetry');
  }

  return { total: scenarios.length, byOutcome, expectedMatches, kvAlwaysReturned, sqlEverReturned, maxSeverity, rows };
}

// CLI entry (Node): print the reconciliation report.
if ((globalThis as { process?: { argv?: string[] } }).process?.argv?.[1]?.includes('outcome-shadow-dryrun')) {
  runOutcomeShadowDryRun()
    .then((s) => {
      console.log('\n=== Outcome Shadow Dry-Run Reconciliation (offline) ===');
      console.table(s.rows);
      console.log('summary:', JSON.stringify({ total: s.total, byOutcome: s.byOutcome, expectedMatches: s.expectedMatches, kvAlwaysReturned: s.kvAlwaysReturned, sqlEverReturned: s.sqlEverReturned, maxSeverity: s.maxSeverity }, null, 2));
      const pass = s.expectedMatches === s.total && s.kvAlwaysReturned && !s.sqlEverReturned;
      console.log(pass ? '\n✅ DRY-RUN PASS — pipeline classifies all categories; KV always returned; SQL never returned.' : '\n❌ DRY-RUN FAIL');
      (globalThis as { process?: { exit?: (n: number) => void } }).process?.exit?.(pass ? 0 : 1);
    })
    .catch((e) => {
      console.error('dry-run error:', e);
      (globalThis as { process?: { exit?: (n: number) => void } }).process?.exit?.(1);
    });
}
