/**
 * Runtime Storage Gateway — shadow-read primitive (MCV2-S7.4 → S7.8)
 *
 * `shadowRead` is the single reusable read path used by outcome, lead and
 * submission routes. Contract:
 *
 *   1. The authority (KV) result is ALWAYS returned unchanged. Callers see
 *      exactly the same value whether or not shadow reads are enabled.
 *   2. When `enabled` is false the shadow read is never invoked — zero cost,
 *      zero behavior change (backward compatible until Batch 3 cutover).
 *   3. When `enabled` is true the shadow (SQL) read runs best-effort. Any
 *      thrown error is caught and reported as a `shadow_error` drift report;
 *      it never propagates to the caller. Backend reads therefore cannot
 *      introduce a regression.
 *
 * No Deno globals are referenced here so the primitive is unit-testable under
 * `node --experimental-strip-types --test`.
 */
import { diffProjections } from './drift.ts';
import type { DriftReport, DriftTelemetry, ShadowDomain } from './types.ts';

export interface ShadowReadOptions<A, S> {
  domain: ShadowDomain;
  key: string;
  /** Whether the shadow (SQL) read should run. Defaults OFF at call sites. */
  enabled: boolean;
  /** Authority read — its resolved value is what the caller receives. */
  readAuthority: () => Promise<A> | A;
  /** Shadow read — only invoked when `enabled`. */
  readShadow: () => Promise<S> | S;
  /** Normalize the authority value to a comparable projection. */
  projectAuthority: (value: A) => Record<string, unknown> | null;
  /** Normalize the shadow value to a comparable projection. */
  projectShadow: (value: S) => Record<string, unknown> | null;
  /** Drift sink. Defaults to a console reporter. Never allowed to throw. */
  telemetry?: DriftTelemetry;
}

/** Default telemetry — structured console line, safe in the edge runtime. */
export const consoleTelemetry: DriftTelemetry = (report) => {
  if (report.status === 'match' || report.status === 'skipped') return;
  const tag = report.status === 'shadow_error' ? '⚠️ [shadow-read]' : '🔀 [shadow-drift]';
  // eslint-disable-next-line no-console
  console.log(
    `${tag} ${report.domain}:${report.key} status=${report.status}`,
    report.status === 'shadow_error' ? report.error : report.fields,
  );
};

function emit(telemetry: DriftTelemetry | undefined, report: DriftReport): void {
  try {
    (telemetry ?? consoleTelemetry)(report);
  } catch {
    /* telemetry must never break the read path */
  }
}

/**
 * Read from the authority, optionally shadow-read + compare, always return the
 * authority value. Returns the authority result and (for tests/introspection)
 * the drift report produced.
 */
export async function shadowReadWithReport<A, S>(
  opts: ShadowReadOptions<A, S>,
): Promise<{ value: A; report: DriftReport }> {
  const value = await opts.readAuthority();

  if (!opts.enabled) {
    const report: DriftReport = {
      domain: opts.domain,
      key: opts.key,
      status: 'skipped',
      fields: [],
      authorityPresent: opts.projectAuthority(value) !== null,
      shadowPresent: false,
      at: new Date().toISOString(),
    };
    return { value, report };
  }

  let report: DriftReport;
  try {
    const shadowValue = await opts.readShadow();
    report = diffProjections(
      opts.domain,
      opts.key,
      opts.projectAuthority(value),
      opts.projectShadow(shadowValue),
    );
  } catch (err) {
    report = {
      domain: opts.domain,
      key: opts.key,
      status: 'shadow_error',
      fields: [],
      authorityPresent: opts.projectAuthority(value) !== null,
      shadowPresent: false,
      error: err instanceof Error ? err.message : String(err),
      at: new Date().toISOString(),
    };
  }

  emit(opts.telemetry, report);
  return { value, report };
}

/** Convenience wrapper that returns only the authority value. */
export async function shadowRead<A, S>(opts: ShadowReadOptions<A, S>): Promise<A> {
  const { value } = await shadowReadWithReport(opts);
  return value;
}
