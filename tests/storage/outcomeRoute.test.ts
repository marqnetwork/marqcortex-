/**
 * Outcome GET route + runtime wiring tests — MCV2-S7.4-REMEDIATION (G6)
 *
 * Exercises the real `handleGetOutcome` handler over a composed gateway
 * (fake KV port + fake SQL port + in-memory telemetry + recording scheduler),
 * covering every audit scenario:
 *   flag disabled · match · partial · mismatch · missing SQL row · SQL error ·
 *   unchanged authoritative KV response · non-blocking scheduling.
 *
 * KV is always the returned source; SQL is never surfaced.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ComparisonStatus,
  createKvDiagnosticAdapter,
  createDiagnosticStorageGateway,
  createInMemoryTelemetrySink,
  handleGetOutcome,
  type BackgroundScheduler,
  type KvDiagnosticPort,
  type OutcomeSqlPort,
  type OutcomeShadowConfig,
  type StorageConfig,
  DiagnosticEntity,
  ReadMode,
} from '../../supabase/functions/server/storage/index.ts';

const ORG = 'org-1';

// --- fakes -----------------------------------------------------------------

function kvPort(store: Record<string, unknown>): KvDiagnosticPort {
  return {
    async get(key: string) {
      return store[key];
    },
    async getByPrefix(prefix: string) {
      return Object.entries(store)
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v);
    },
  };
}

function sqlPort(fn: (submissionId: string, org: string) => Promise<unknown>): OutcomeSqlPort {
  return { getOutcomeBySubmission: (id, org) => fn(id, org) };
}

/** A scheduler that captures tasks so tests can run them AFTER the response. */
function recordingScheduler(): BackgroundScheduler & { run(): Promise<void>; count(): number } {
  const tasks: Array<() => Promise<unknown>> = [];
  return {
    strategy: 'edge_wait_until',
    schedule(task) {
      tasks.push(task);
    },
    async run() {
      for (const t of tasks.splice(0)) {
        try {
          await t();
        } catch {
          /* swallowed like the real scheduler */
        }
      }
    },
    count() {
      return tasks.length;
    },
  };
}

const baseConfig: StorageConfig = {
  dualReadEnabled: false,
  telemetryEnabled: false,
  modeByEntity: {
    [DiagnosticEntity.SUBMISSION]: ReadMode.KV_ONLY,
    [DiagnosticEntity.SUBMISSION_LIST]: ReadMode.KV_ONLY,
    [DiagnosticEntity.OUTCOME]: ReadMode.KV_ONLY,
    [DiagnosticEntity.REPORT]: ReadMode.KV_ONLY,
    [DiagnosticEntity.LEAD]: ReadMode.KV_ONLY,
  },
};

function shadowConfig(enabled: boolean): OutcomeShadowConfig {
  return {
    enabled,
    forceKvOnly: false,
    orgAllowlist: [],
    defaultOrgId: ORG,
    sqlTimeoutMs: 250,
    environment: 'test',
  };
}

const KV_OUTCOME = {
  submissionId: 'sub-1',
  didConvert: true,
  conversionValue: 5000,
  recommendationWorked: true,
  whatWeLearned: 'pricing clarity',
  improvementAreas: ['discovery'],
};

function sqlRow(value: Record<string, unknown>) {
  return {
    id: 'uuid-1',
    organization_id: ORG,
    submission_id: 'sub-1',
    legacy_kv_key: 'outcome:sub-1',
    status: 'converted',
    value,
  };
}

function compose(opts: {
  kv?: Record<string, unknown>;
  sql?: (id: string, org: string) => Promise<unknown>;
  enabled: boolean;
}) {
  const telemetry = createInMemoryTelemetrySink();
  const scheduler = recordingScheduler();
  const store = opts.kv ?? { 'outcome:sub-1': JSON.stringify(KV_OUTCOME) };
  const gateway = createDiagnosticStorageGateway({
    kvAdapter: createKvDiagnosticAdapter(kvPort(store)),
    config: baseConfig,
    telemetry,
    scheduler,
    sqlOutcomePort: opts.sql ? sqlPort(opts.sql) : undefined,
    outcomeShadow: shadowConfig(opts.enabled),
  });
  return { gateway, telemetry, scheduler };
}

const teamActor = { kind: 'team' as const, id: 'user-1' };

describe('Outcome GET route + wiring (G6)', () => {
  it('flag disabled: returns KV response, schedules NO shadow', async () => {
    const { gateway, telemetry, scheduler } = compose({ enabled: false, sql: async () => sqlRow({}) });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });

    assert.deepEqual(res.body, { success: true, outcome: KV_OUTCOME });
    assert.equal(res.shadowStatus, 'skipped');
    assert.equal(scheduler.count(), 0);
    await scheduler.run();
    // No shadow telemetry was produced.
    assert.equal(telemetry.events.some((e) => e.shadowAttempted), false);
  });

  it('non-blocking scheduling: response resolves before the shadow runs', async () => {
    const { gateway, telemetry, scheduler } = compose({ enabled: true, sql: async () => sqlRow(KV_OUTCOME) });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });

    assert.equal(res.shadowStatus, 'scheduled');
    assert.equal(scheduler.count(), 1);
    // The shadow has NOT run yet — no shadow telemetry until we drain the scheduler.
    assert.equal(telemetry.events.some((e) => e.shadowAttempted), false);

    await scheduler.run();
    assert.equal(telemetry.events.some((e) => e.shadowAttempted), true);
  });

  it('match: KV response unchanged, shadow status = match', async () => {
    const { gateway, telemetry, scheduler } = compose({ enabled: true, sql: async () => sqlRow(KV_OUTCOME) });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });
    assert.deepEqual(res.body, { success: true, outcome: KV_OUTCOME });
    await scheduler.run();
    const ev = telemetry.events.find((e) => e.shadowAttempted);
    assert.equal(ev?.comparisonStatus, ComparisonStatus.MATCH);
  });

  it('partial: KV response unchanged, shadow status = partial', async () => {
    const partial = { didConvert: true, recommendationWorked: true }; // missing conversionValue etc.
    const { gateway, telemetry, scheduler } = compose({ enabled: true, sql: async () => sqlRow(partial) });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });
    assert.deepEqual(res.body, { success: true, outcome: KV_OUTCOME });
    await scheduler.run();
    const ev = telemetry.events.find((e) => e.shadowAttempted);
    assert.equal(ev?.comparisonStatus, ComparisonStatus.PARTIAL);
  });

  it('mismatch: KV response unchanged, shadow status = mismatch', async () => {
    const conflicting = { ...KV_OUTCOME, conversionValue: 9999 };
    const { gateway, telemetry, scheduler } = compose({ enabled: true, sql: async () => sqlRow(conflicting) });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });
    assert.deepEqual(res.body, { success: true, outcome: KV_OUTCOME });
    await scheduler.run();
    const ev = telemetry.events.find((e) => e.shadowAttempted);
    assert.equal(ev?.comparisonStatus, ComparisonStatus.MISMATCH);
  });

  it('missing SQL row: KV response unchanged, shadow status = missing_sql', async () => {
    const { gateway, telemetry, scheduler } = compose({ enabled: true, sql: async () => null });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });
    assert.deepEqual(res.body, { success: true, outcome: KV_OUTCOME });
    await scheduler.run();
    const ev = telemetry.events.find((e) => e.shadowAttempted);
    assert.equal(ev?.comparisonStatus, ComparisonStatus.MISSING_SQL);
  });

  it('SQL error: KV response unchanged, shadow status = error', async () => {
    const { gateway, telemetry, scheduler } = compose({
      enabled: true,
      sql: async () => {
        throw new Error('db exploded');
      },
    });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });
    // The authoritative KV response is unaffected by the SQL failure.
    assert.deepEqual(res.body, { success: true, outcome: KV_OUTCOME });
    await scheduler.run();
    const ev = telemetry.events.find((e) => e.shadowAttempted);
    assert.equal(ev?.comparisonStatus, ComparisonStatus.ERROR);
  });

  it('unchanged authoritative KV response: null outcome when KV empty', async () => {
    const { gateway } = compose({ enabled: true, kv: {}, sql: async () => sqlRow(KV_OUTCOME) });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });
    assert.deepEqual(res.body, { success: true, outcome: null });
  });

  it('SQL is never surfaced to the caller even when it differs from KV', async () => {
    const sqlOnly = { ...KV_OUTCOME, conversionValue: 1, whatWeLearned: 'sql-only-secret' };
    const { gateway, scheduler } = compose({ enabled: true, sql: async () => sqlRow(sqlOnly) });
    const res = await handleGetOutcome({ gateway }, { submissionId: 'sub-1', actor: teamActor });
    assert.deepEqual(res.body, { success: true, outcome: KV_OUTCOME });
    assert.ok(!JSON.stringify(res.body).includes('sql-only-secret'));
    await scheduler.run();
  });
});
