/**
 * Provider-neutral contracts for the runtime storage gateway shadow-read path.
 *
 * MCV2-S7.4 — Outcome Shadow Read. KV remains the runtime authority; SQL is read
 * only for non-authoritative comparison. No type here is exposed to the frontend
 * and no shape here changes an existing route response.
 */

/** Result of comparing an authoritative KV record against its SQL shadow. */
export type ShadowReadStatus =
  | 'skipped' // feature flag off, or nothing to compare (both sides absent)
  | 'match' // KV and SQL agree on every compared field
  | 'mismatch' // KV and SQL both present but at least one compared field differs
  | 'missing_sql' // KV present, SQL absent (SQL not yet backfilled)
  | 'missing_kv' // SQL present, KV absent (unexpected divergence)
  | 'error'; // SQL read threw — recorded, never propagated to the caller

/** Normalized projection of the authoritative KV outcome payload. */
export interface KvOutcomeProjection {
  submissionId: string;
  didConvert: boolean | null;
  conversionValue: number | null;
}

/** Normalized projection of the SQL `outcomes` row, extracted by the wiring layer. */
export interface SqlOutcomeProjection {
  submissionId: string;
  legacyKvKey: string | null;
  didConvert: boolean | null;
  conversionValue: number | null;
  status: string;
}

/** Reads the SQL shadow for a given legacy KV key. Injected for testability. */
export type OutcomeSqlReader = (
  legacyKvKey: string,
) => Promise<SqlOutcomeProjection | null>;

/** Outcome of a single shadow-read comparison. */
export interface ShadowReadResult {
  domain: 'outcome';
  key: string;
  status: ShadowReadStatus;
  mismatchFields: string[];
  latencyMs: number;
}

/** Telemetry record buffered per shadow-read invocation. */
export interface ShadowReadRecord extends ShadowReadResult {
  timestamp: string;
}
