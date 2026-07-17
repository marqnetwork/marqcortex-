/**
 * Storage read telemetry — diagnostic domain (MCV2-S7.2-IMPLEMENT-007)
 *
 * Phase 1 policy:
 *   - Disabled by default (no-op sink).
 *   - NO live telemetry table is created this phase (not approved for Phase 1).
 *   - Only approved identifiers are carried (see StorageReadTelemetryEvent) —
 *     no raw payloads, no secrets, no PII beyond org/actor/request identifiers.
 *   - Telemetry must NEVER affect the user response: `safeEmit` swallows all
 *     sink errors.
 */

import type { StorageReadTelemetryEvent, StorageTelemetrySink } from './contracts.ts';

/** Default sink: does nothing. Used in the runtime this phase. */
export function createNoopTelemetrySink(): StorageTelemetrySink {
  return {
    enabled: false,
    emit(_event: StorageReadTelemetryEvent): void {
      // intentional no-op
    },
  };
}

/**
 * In-memory sink for tests: records events. Enabled, but purely local — never
 * writes to a database. Still guarded by `safeEmit` at the call site.
 */
export function createInMemoryTelemetrySink(): StorageTelemetrySink & { events: StorageReadTelemetryEvent[] } {
  const events: StorageReadTelemetryEvent[] = [];
  return {
    enabled: true,
    events,
    emit(event: StorageReadTelemetryEvent): void {
      events.push(event);
    },
  };
}

/**
 * Emit an event without ever throwing to the caller. Returns true if the event
 * was handed to the sink, false if telemetry was disabled or the sink threw.
 */
export function safeEmit(sink: StorageTelemetrySink, event: StorageReadTelemetryEvent): boolean {
  if (!sink || !sink.enabled) return false;
  try {
    sink.emit(event);
    return true;
  } catch (err) {
    // Telemetry failure must not affect reads.
    try {
      console.log('⚠️ storage telemetry emit failed (ignored):', (err as Error)?.message ?? err);
    } catch {
      // ignore logging failure too
    }
    return false;
  }
}
