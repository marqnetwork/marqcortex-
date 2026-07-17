/**
 * Diagnostic storage gateway — diagnostic domain
 * (MCV2-S7.2-IMPLEMENT-007 · Outcome shadow read added MCV2-S7.4-IMPLEMENT-009)
 *
 * ONE gateway for the diagnostic domain. It:
 *   - accepts canonical read requests (id/list + ReadContext)
 *   - resolves the configured read mode (returned source is ALWAYS KV)
 *   - invokes the KV adapter
 *   - returns a canonical ReadResult<T> carrying the unchanged business DTO
 *   - for Outcome ONLY, optionally launches a bounded SQL *shadow* read that
 *     compares against KV and emits telemetry — never affecting the response
 *
 * SQL is never returned to callers. No fallback, no source switching, no
 * writes, no cross-tenant comparison. Shadow is disabled by default.
 */

import {
  DiagnosticEntity,
  ReadMode,
  StorageSource,
  type DiagnosticStorageGateway,
  type KvDiagnosticAdapter,
  type OutcomeComparison,
  type OutcomeSqlPort,
  type ReadContext,
  type ReadResult,
  type StorageConfig,
  type StorageTelemetrySink,
} from './contracts.ts';
import { resolveActiveMode, resolveOutcomeShadowEligibility, type OutcomeShadowConfig } from './config.ts';
import { createNoopTelemetrySink, safeEmit } from './telemetry.ts';
import { createSqlOutcomeAdapter } from './sqlOutcomeAdapter.ts';
import { compareOutcome, outcomeErrorComparison, hashEntityRef } from './outcomeCompare.ts';

export interface GatewayDeps {
  kvAdapter: KvDiagnosticAdapter;
  config: StorageConfig;
  telemetry?: StorageTelemetrySink;
  /** Optional Outcome SQL shadow (MCV2-S7.4). Absent ⇒ KV-only for outcome. */
  sqlOutcomePort?: OutcomeSqlPort;
  outcomeShadow?: OutcomeShadowConfig;
}

function now(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

export function createDiagnosticStorageGateway(deps: GatewayDeps): DiagnosticStorageGateway {
  const telemetry = deps.telemetry ?? createNoopTelemetrySink();

  function record(ctx: ReadContext, mode: ReadMode, kvMs: number, errorClass?: string): void {
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

  /**
   * Launch the Outcome shadow read. Reuses the already-fetched KV value (no
   * second KV read). ALWAYS resolves (never rejects). Emits exactly one
   * telemetry event carrying the comparison. Never returns SQL to the caller.
   */
  function runOutcomeShadow(
    ctx: ReadContext,
    submissionId: string,
    kvData: unknown,
    kvMs: number,
    effectiveOrg: string,
  ): Promise<OutcomeComparison> {
    const meta = {
      requestId: ctx.requestId,
      organizationId: ctx.organizationId ?? null,
      effectiveOrg,
      entityRefHash: hashEntityRef(submissionId),
      kvMs,
      sqlMs: undefined as number | undefined,
    };

    const shadow = deps.outcomeShadow!;
    const adapter = createSqlOutcomeAdapter(deps.sqlOutcomePort!, shadow.sqlTimeoutMs);

    const emit = (cmp: OutcomeComparison): OutcomeComparison => {
      safeEmit(telemetry, {
        requestId: ctx.requestId,
        entity: ctx.entity,
        configuredMode: ReadMode.KV_PRIMARY_SHADOW_SQL,
        returnedSource: StorageSource.KV,
        kvMs,
        sqlMs: cmp.sqlMs,
        route: ctx.route,
        organizationId: ctx.organizationId ?? null,
        shadowAttempted: true,
        comparisonOutcome: cmp.outcome,
        mismatchCount: cmp.mismatchCount,
        mismatchSeverity: cmp.severity,
        sqlErrorClass: cmp.sqlErrorClass,
        environment: shadow.environment ?? undefined,
      });
      return cmp;
    };

    return adapter
      .readOutcome(submissionId, effectiveOrg)
      .then(({ data, ms }) => emit(compareOutcome(kvData, data, { ...meta, sqlMs: ms })))
      .catch((err) => emit(outcomeErrorComparison(meta, (err as Error)?.name ?? 'Error')));
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
      let kvData: unknown;
      let found: boolean;
      try {
        const res = await deps.kvAdapter.getOutcome(submissionId);
        kvData = res.data;
        found = res.found;
      } catch (err) {
        record(ctx, mode, now() - started, (err as Error)?.name ?? 'Error');
        throw err;
      }
      const kvMs = now() - started;

      // Shadow eligibility (Outcome only). Fails closed on any uncertainty.
      const eligibility = deps.outcomeShadow
        ? resolveOutcomeShadowEligibility(deps.outcomeShadow, {
            organizationId: ctx.organizationId ?? null,
            hasSqlPort: !!deps.sqlOutcomePort,
          })
        : { eligible: false, effectiveOrg: null, reason: 'no_config' };

      const result: ReadResult<unknown> = { data: kvData, found, returnedSource: StorageSource.KV, mode, latency: { kvMs } };

      if (eligibility.eligible && eligibility.effectiveOrg) {
        // One combined telemetry event is emitted by the shadow (no base event → no duplicate).
        const shadow = runOutcomeShadow(ctx, submissionId, kvData, kvMs, eligibility.effectiveOrg);
        // Never awaited by the response path; guaranteed non-rejecting.
        result.shadow = shadow;
      } else {
        // KV-only path: single base telemetry event, as in Phase 1.
        record(ctx, mode, kvMs);
      }
      return result;
    },
  };
}
