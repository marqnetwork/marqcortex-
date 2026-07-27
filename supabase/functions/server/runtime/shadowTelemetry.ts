/**
 * Shadow-read telemetry — in-memory ring buffer plus structured console log.
 *
 * MCV2-S7.4. Mirrors `intelligence/telemetry.ts`. This is the evidence surface
 * for the shadow-read validation sprint: it records where SQL agrees with,
 * diverges from, or lacks the authoritative KV record.
 */
import type { ShadowReadRecord, ShadowReadResult } from './contracts.ts';

const MAX_RECORDS = 200;
const buffer: ShadowReadRecord[] = [];

export function recordShadowRead(result: ShadowReadResult): ShadowReadRecord {
  const record: ShadowReadRecord = {
    ...result,
    timestamp: new Date().toISOString(),
  };
  buffer.push(record);
  if (buffer.length > MAX_RECORDS) {
    buffer.shift();
  }
  console.log(
    `[runtime-shadow] domain=${record.domain} status=${record.status} key=${record.key} ` +
      `mismatchFields=[${record.mismatchFields.join(',')}] latencyMs=${record.latencyMs}`,
  );
  return record;
}

export function getRecentShadowReads(limit = 50): ShadowReadRecord[] {
  return buffer.slice(-limit);
}

export function resetShadowTelemetryForTests(): void {
  buffer.length = 0;
}
