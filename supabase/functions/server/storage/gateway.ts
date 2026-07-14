/**
 * Diagnostic storage gateway — diagnostic domain (MCV2-S7.2-IMPLEMENT-007)
 *
 * ONE gateway for the diagnostic domain. It:
 *   - accepts canonical read requests (id/list + ReadContext)
 *   - resolves the configured read mode (Phase 1: always clamped to KV_ONLY)
 *   - invokes the KV adapter
 *   - returns a canonical ReadResult<T> carrying the unchanged business DTO
 *   - attaches source + latency metadata internally
 *   - emits telemetry only when enabled, never affecting the response
 *
 * It deliberately does NOT: contain route/business/scoring logic, know the
 * frontend, query PostgreSQL, compare sources, or perform fallback.
 */

import {
  DiagnosticEntity,
  ReadMode,
  StorageSource,
  type DiagnosticStorageGateway,
  type KvDiagnosticAdapter,
  type ReadContext,
  type ReadResult,
  type StorageConfig,
  type StorageTelemetrySink,
} from './contracts.ts';
import { resolveActiveMode } from './config.ts';
import { createNoopTelemetrySink, safeEmit } from './telemetry.ts';

export interface GatewayDeps {
  kvAdapter: KvDiagnosticAdapter;
  config: StorageConfig;
  telemetry?: StorageTelemetrySink;
}

function now(): number {
  // performance.now() exists in Deno and Node; fall back to Date.now().
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

export function createDiagnosticStorageGateway(deps: GatewayDeps): DiagnosticStorageGateway {
  const telemetry = deps.telemetry ?? createNoopTelemetrySink();

  function record(
    ctx: ReadContext,
    mode: ReadMode,
    kvMs: number,
    errorClass?: string,
  ): void {
    safeEmit(telemetry, {
      requestId: ctx.requestId,
      entity: ctx.entity,
      configuredMode: mode,
      returnedSource: StorageSource.KV,
      kvMs,
      route: ctx.route,
      organizationId: ctx.organizationId ?? null,
      errorClass,
    });
  }

  return {
    async getSubmission(id: string, ctx: ReadContext): Promise<ReadResult<unknown>> {
      const mode = resolveActiveMode(deps.config, DiagnosticEntity.SUBMISSION);
      const started = now();
      try {
        const { data, found } = await deps.kvAdapter.getSubmission(id);
        const kvMs = now() - started;
        record(ctx, mode, kvMs);
        return { data, found, returnedSource: StorageSource.KV, mode, latency: { kvMs } };
      } catch (err) {
        record(ctx, mode, now() - started, (err as Error)?.name ?? 'Error');
        throw err;
      }
    },

    async listSubmissions(ctx: ReadContext): Promise<ReadResult<unknown[]>> {
      const mode = resolveActiveMode(deps.config, DiagnosticEntity.SUBMISSION_LIST);
      const started = now();
      try {
        const { data, found } = await deps.kvAdapter.listSubmissions();
        const kvMs = now() - started;
        record(ctx, mode, kvMs);
        return { data, found, returnedSource: StorageSource.KV, mode, latency: { kvMs } };
      } catch (err) {
        record(ctx, mode, now() - started, (err as Error)?.name ?? 'Error');
        throw err;
      }
    },

    async getOutcome(submissionId: string, ctx: ReadContext): Promise<ReadResult<unknown>> {
      const mode = resolveActiveMode(deps.config, DiagnosticEntity.OUTCOME);
      const started = now();
      try {
        const { data, found } = await deps.kvAdapter.getOutcome(submissionId);
        const kvMs = now() - started;
        record(ctx, mode, kvMs);
        return { data, found, returnedSource: StorageSource.KV, mode, latency: { kvMs } };
      } catch (err) {
        record(ctx, mode, now() - started, (err as Error)?.name ?? 'Error');
        throw err;
      }
    },
  };
}
