import type { TelemetryRecord, ProviderErrorCode } from './contracts.ts';

const MAX_RECORDS = 200;
const telemetryBuffer: TelemetryRecord[] = [];
const recordedRequestAttempts = new Set<string>();

export function recordTelemetry(record: TelemetryRecord): void {
  const dedupeKey = `${record.requestId}:${record.attempt}:${record.outcome}`;
  if (record.outcome === 'success' && recordedRequestAttempts.has(`${record.requestId}:success`)) {
    return;
  }
  recordedRequestAttempts.add(dedupeKey);
  if (record.outcome === 'success') {
    recordedRequestAttempts.add(`${record.requestId}:success`);
  }
  telemetryBuffer.push(record);
  if (telemetryBuffer.length > MAX_RECORDS) {
    telemetryBuffer.shift();
  }
  console.log(
    `[intelligence] ${record.outcome} feature=${record.feature} provider=${record.provider} model=${record.model} requestId=${record.requestId} attempt=${record.attempt} latencyMs=${record.latencyMs}`,
  );
}

export function getRecentTelemetry(limit = 50): TelemetryRecord[] {
  return telemetryBuffer.slice(-limit);
}

export function resetTelemetryForTests(): void {
  telemetryBuffer.length = 0;
  recordedRequestAttempts.clear();
}

export function buildTelemetryRecord(input: {
  requestId: string;
  feature: TelemetryRecord['feature'];
  provider: string;
  model: string;
  attempt: number;
  latencyMs: number;
  outcome: 'success' | 'error';
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  errorCode?: ProviderErrorCode;
}): TelemetryRecord {
  return {
    ...input,
    timestamp: new Date().toISOString(),
  };
}
