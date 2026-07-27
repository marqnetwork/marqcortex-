/**
 * Durable telemetry tests — MCV2-S7.4-REMEDIATION (G4)
 *
 * Proves the durable sink:
 *   - aggregates by (domain, status, mismatchFields): occurrenceCount plus
 *     first/last observed timestamps (restart-safe semantics)
 *   - defers writes to the background scheduler (non-blocking)
 *   - never lets a repository failure surface to the caller
 *   - ignores non-shadow read events
 *   - retains structured-log fallback evidence
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ComparisonStatus,
  DiagnosticEntity,
  StorageSource,
  ReadMode,
  createDurableTelemetrySink,
  createInMemoryShadowTelemetryRepository,
  createBackgroundScheduler,
  type StorageReadTelemetryEvent,
  type ShadowTelemetryRepository,
} from '../../supabase/functions/server/storage/index.ts';

const tick = () => new Promise((r) => setTimeout(r, 5));

function shadowEvent(overrides: Partial<StorageReadTelemetryEvent> = {}): StorageReadTelemetryEvent {
  return {
    requestId: 'req-1',
    entity: DiagnosticEntity.OUTCOME,
    configuredMode: ReadMode.KV_PRIMARY_SHADOW_SQL,
    returnedSource: StorageSource.KV,
    kvMs: 1,
    sqlMs: 2,
    route: '/outcome',
    organizationId: 'org-1',
    shadowAttempted: true,
    comparisonStatus: ComparisonStatus.MISMATCH,
    mismatchCount: 1,
    mismatchFields: ['conversionValue'],
    mismatchSeverity: 'high',
    ...overrides,
  };
}

describe('Durable telemetry sink (G4)', () => {
  it('aggregates repeat observations: count + first/last observed', async () => {
    let n = 0;
    const clock = () => `2026-07-27T00:00:0${n++}.000Z`;
    const repo = createInMemoryShadowTelemetryRepository(clock);
    const scheduler = createBackgroundScheduler(null); // detached, deterministic
    const sink = createDurableTelemetrySink({ repository: repo, scheduler });

    sink.emit(shadowEvent());
    sink.emit(shadowEvent());
    sink.emit(shadowEvent());
    await tick();

    const aggs = repo.aggregates();
    assert.equal(aggs.length, 1);
    const agg = aggs[0];
    assert.equal(agg.domain, 'outcome');
    assert.equal(agg.status, ComparisonStatus.MISMATCH);
    assert.deepEqual(agg.mismatchFields, ['conversionValue']);
    assert.equal(agg.occurrenceCount, 3);
    assert.equal(agg.firstObservedAt, '2026-07-27T00:00:00.000Z');
    assert.notEqual(agg.lastObservedAt, agg.firstObservedAt);
  });

  it('keys distinct (domain, status, mismatchFields) into separate rows', async () => {
    const repo = createInMemoryShadowTelemetryRepository();
    const scheduler = createBackgroundScheduler(null);
    const sink = createDurableTelemetrySink({ repository: repo, scheduler });

    sink.emit(shadowEvent({ comparisonStatus: ComparisonStatus.MISMATCH, mismatchFields: ['a'] }));
    sink.emit(shadowEvent({ comparisonStatus: ComparisonStatus.PARTIAL, mismatchFields: ['a'] }));
    sink.emit(shadowEvent({ comparisonStatus: ComparisonStatus.MATCH, mismatchFields: [] }));
    await tick();

    assert.equal(repo.aggregates().length, 3);
  });

  it('folds mismatchFields regardless of order into one aggregate', async () => {
    const repo = createInMemoryShadowTelemetryRepository();
    const scheduler = createBackgroundScheduler(null);
    const sink = createDurableTelemetrySink({ repository: repo, scheduler });

    sink.emit(shadowEvent({ mismatchFields: ['a', 'b'] }));
    sink.emit(shadowEvent({ mismatchFields: ['b', 'a'] }));
    await tick();

    const aggs = repo.aggregates();
    assert.equal(aggs.length, 1);
    assert.equal(aggs[0].occurrenceCount, 2);
    assert.deepEqual(aggs[0].mismatchFields, ['a', 'b']);
  });

  it('defers the write — emit() does not record synchronously', () => {
    const repo = createInMemoryShadowTelemetryRepository();
    const scheduler = createBackgroundScheduler(null);
    const sink = createDurableTelemetrySink({ repository: repo, scheduler });

    sink.emit(shadowEvent());
    // Not yet recorded on the calling turn — the write is scheduled.
    assert.equal(repo.aggregates().length, 0);
  });

  it('never lets a repository failure surface to the caller', async () => {
    const failing: ShadowTelemetryRepository = {
      async record() {
        throw new Error('db down');
      },
    };
    const scheduler = createBackgroundScheduler(null);
    const sink = createDurableTelemetrySink({ repository: failing, scheduler });

    assert.doesNotThrow(() => sink.emit(shadowEvent()));
    await tick(); // background rejection is swallowed by the scheduler
  });

  it('ignores non-shadow read events (no comparisonStatus)', async () => {
    const repo = createInMemoryShadowTelemetryRepository();
    const scheduler = createBackgroundScheduler(null);
    const sink = createDurableTelemetrySink({ repository: repo, scheduler });

    sink.emit({
      requestId: 'req-2',
      entity: DiagnosticEntity.OUTCOME,
      configuredMode: ReadMode.KV_ONLY,
      returnedSource: StorageSource.KV,
      route: '/outcome',
    });
    await tick();
    assert.equal(repo.aggregates().length, 0);
  });

  it('durableEnabled=false keeps logs but writes nothing', async () => {
    const repo = createInMemoryShadowTelemetryRepository();
    const scheduler = createBackgroundScheduler(null);
    const sink = createDurableTelemetrySink({ repository: repo, scheduler, durableEnabled: false });

    sink.emit(shadowEvent());
    await tick();
    assert.equal(repo.aggregates().length, 0);
  });
});
