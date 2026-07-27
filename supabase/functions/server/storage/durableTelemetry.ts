/**
 * Durable shadow-read telemetry — diagnostic domain
 * (MCV2-S7.4-REMEDIATION · G4)
 *
 * The audited S7.4 telemetry sink was in-memory only, so aggregates were lost on
 * every cold start and could not be combined across edge instances. This module
 * adds the SMALLEST repository-consistent durable sink:
 *
 *   - It REUSES the existing repository/storage abstraction (a Supabase table +
 *     an atomic upsert-increment RPC, wired by the Deno-only
 *     `runtimeShadowTelemetry.ts`) — there is NO second telemetry architecture.
 *   - Aggregation is keyed by (domain, status, mismatchFields) and is
 *     restart-safe and cross-instance: the RPC performs an atomic
 *     INSERT … ON CONFLICT DO UPDATE that increments `occurrence_count` and
 *     advances `last_observed_at`, so concurrent writers from any instance fold
 *     into one row.
 *   - The durable write is ALWAYS deferred to the background scheduler, so a
 *     slow or failing telemetry write can never affect the KV response or the
 *     shadow read.
 *   - Structured logs are always emitted first as fallback evidence, even when
 *     the durable write is disabled or fails.
 *
 * Retention & concurrency are documented in
 * `architecture/database/MCV2-S7.4-DURABLE-TELEMETRY.md`.
 *
 * This module is pure/Node-testable: the repository and scheduler are injected.
 */

import type {
  BackgroundScheduler,
  ShadowTelemetryAggregate,
  ShadowTelemetryAggregateKey,
  ShadowTelemetryRepository,
  StorageReadTelemetryEvent,
  StorageTelemetrySink,
} from './contracts.ts';

/** Stable, order-independent key string for an aggregate. */
export function aggregateKeyString(key: ShadowTelemetryAggregateKey): string {
  const fields = [...key.mismatchFields].sort().join(',');
  return `${key.domain}|${key.status}|${fields}`;
}

/** Structured, PII-free log line retained as fallback evidence. */
function logShadowEvent(event: StorageReadTelemetryEvent): void {
  try {
    console.log(
      `[storage.shadow] domain=${event.entity} status=${event.comparisonStatus} ` +
        `mismatchCount=${event.mismatchCount ?? 0} mismatchFields=${(event.mismatchFields ?? []).join('|')} ` +
        `severity=${event.mismatchSeverity ?? 'info'} sqlErrorClass=${event.sqlErrorClass ?? ''} ` +
        `kvMs=${event.kvMs ?? ''} sqlMs=${event.sqlMs ?? ''} env=${event.environment ?? ''} ` +
        `requestId=${event.requestId}`,
    );
  } catch {
    // Never let logging failure affect the caller.
  }
}

export interface DurableTelemetryDeps {
  repository: ShadowTelemetryRepository;
  scheduler: BackgroundScheduler;
  /** When false, only structured logs are retained (no durable writes). */
  durableEnabled?: boolean;
}

/**
 * Create a telemetry sink that logs every shadow event and durably aggregates
 * it via the injected repository (through the background scheduler). Non-shadow
 * read events (no `comparisonStatus`) are ignored by the durable path.
 */
export function createDurableTelemetrySink(deps: DurableTelemetryDeps): StorageTelemetrySink {
  const durableEnabled = deps.durableEnabled ?? true;
  return {
    enabled: true,
    emit(event: StorageReadTelemetryEvent): void {
      // Only shadow comparisons carry a comparisonStatus; ignore plain KV reads.
      if (!event.comparisonStatus) return;

      // 1) Fallback evidence — always, synchronously, cheaply.
      logShadowEvent(event);

      if (!durableEnabled) return;

      // 2) Durable aggregation — deferred; failure is swallowed by the scheduler
      //    and never reaches the response/shadow path.
      const key: ShadowTelemetryAggregateKey = {
        domain: event.entity,
        status: event.comparisonStatus,
        mismatchFields: [...(event.mismatchFields ?? [])].sort(),
      };
      deps.scheduler.schedule(() => deps.repository.record(key));
    },
  };
}

/**
 * In-memory shadow telemetry repository for tests. Mirrors the durable store's
 * aggregation semantics: first write creates the row (count=1, first=last=now),
 * subsequent writes increment `occurrenceCount` and advance `lastObservedAt`.
 */
export function createInMemoryShadowTelemetryRepository(clock?: () => string): ShadowTelemetryRepository & {
  aggregates(): ShadowTelemetryAggregate[];
  get(key: ShadowTelemetryAggregateKey): ShadowTelemetryAggregate | undefined;
} {
  const store = new Map<string, ShadowTelemetryAggregate>();
  const nowIso = clock ?? (() => new Date().toISOString());

  return {
    async record(key: ShadowTelemetryAggregateKey): Promise<void> {
      const k = aggregateKeyString(key);
      const ts = nowIso();
      const existing = store.get(k);
      if (existing) {
        existing.occurrenceCount += 1;
        existing.lastObservedAt = ts;
      } else {
        store.set(k, {
          domain: key.domain,
          status: key.status,
          mismatchFields: [...key.mismatchFields].sort(),
          occurrenceCount: 1,
          firstObservedAt: ts,
          lastObservedAt: ts,
        });
      }
    },
    aggregates(): ShadowTelemetryAggregate[] {
      return [...store.values()];
    },
    get(key: ShadowTelemetryAggregateKey): ShadowTelemetryAggregate | undefined {
      return store.get(aggregateKeyString(key));
    },
  };
}
