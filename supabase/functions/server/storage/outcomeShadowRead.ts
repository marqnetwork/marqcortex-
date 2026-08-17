/**
 * MCV2-S7.4 — Outcome shadow read.
 *
 * WHAT THIS IS.
 *
 * KV is the runtime storage authority. This module reads the SQL `outcomes`
 * row that *should* correspond to a KV outcome record and writes down whether
 * it does. It observes; it decides nothing. The production read returns the KV
 * value it always returned, before this module has finished — or at all.
 *
 * THE CANONICAL JOIN AXIS.
 *
 * There is exactly one: `outcomes.legacy_kv_key = 'outcome:{submissionId}'`.
 *
 * `submissionId` is the legacy KV identifier (`SUB-…`). It is NOT the SQL
 * `outcomes.submission_id`, which is a UUID foreign key to `submissions.id`
 * minted by the relational schema and unrelated in shape and in value to the
 * KV id. Correlating on `submission_id` with a `SUB-…` string does not find a
 * different row — it finds no row, or raises, and either way it reports "SQL is
 * missing everything" for a database that is fully backfilled. `legacy_kv_key`
 * is the only column that carries the KV identity across, and it is uniquely
 * indexed for live rows, so the correlation is one-to-one.
 *
 * THE COMPARISON AXIS.
 *
 * The KV record carries `didConvert` — did this deal convert. SQL carries two
 * different things: `outcome_type` (`won`/`lost`/…), which is the same
 * conversion axis, and `status` (`open`/`closed`/`archived`), which is a
 * lifecycle axis — whether the outcome record is still being worked, settled,
 * or filed away. A closed outcome is not a converted one and an open outcome is
 * not an unconverted one; comparing `didConvert` against `status` compares two
 * unrelated business facts and reports disagreement for records that agree.
 *
 * So the lifecycle status is observed and recorded — including when it is
 * absent, null or not a schema value at all — and is never compared, never
 * classifies and never contributes severity.
 *
 * INCOMPLETE IS NOT WRONG.
 *
 * A SQL row can exist before it carries a conversion signal: the backfill
 * creates the row and fills the business fields in a later pass, so
 * `outcome_type` sits at its `'engagement'` default with an empty `value`. That
 * row does not disagree with KV — it has not yet said anything to disagree
 * with. It classifies PARTIAL. Only two determinate and opposite conversion
 * signals are a MISMATCH.
 */

import type { OutcomeRecord } from '../../../../src/types/diagnostic.database.types.ts';

/** The KV namespace the production outcome read uses. */
export const OUTCOME_LEGACY_KV_PREFIX = 'outcome:';

/** The one correlation key between a KV outcome and its SQL row. */
export function outcomeLegacyKvKey(submissionId: string): string {
  return `${OUTCOME_LEGACY_KV_PREFIX}${submissionId}`;
}

/** SQL lifecycle statuses the schema permits (`outcomes_status_check`). */
export const SQL_LIFECYCLE_STATUSES = ['open', 'closed', 'archived'] as const;

/**
 * The conversion axis, the only axis the two stores are compared on.
 * `unknown` means the store has not stated a conversion fact — not that it
 * stated a negative one.
 */
export type ConversionSignal = 'converted' | 'not_converted' | 'unknown';

export type ShadowReadClassification =
  /** Both sides state a conversion fact and the facts agree. */
  | 'match'
  /** Both rows exist; at least one side has not stated a conversion fact yet. */
  | 'partial'
  /** Both sides state a conversion fact and the facts are opposite. */
  | 'mismatch'
  /** KV has the record; SQL has no row for the legacy key in this tenant. */
  | 'sql_missing'
  /** SQL has a row; KV — the authority — has nothing. */
  | 'kv_missing'
  /** Neither store has the record. */
  | 'both_missing'
  /** The observation itself failed. Says nothing about the data. */
  | 'error';

export type ShadowReadSeverity = 'info' | 'low' | 'high';

/** How a lifecycle status was observed, without judging it against KV. */
export interface LifecycleObservation {
  /** Exactly what SQL held, as text; null when absent or not textual. */
  readonly raw: string | null;
  /** Whether `raw` is one of the schema's three statuses. */
  readonly schemaValid: boolean;
}

export interface ShadowReadTelemetryRecord {
  readonly organization_id: string;
  readonly entity: 'outcome';
  readonly legacy_kv_key: string;
  readonly classification: ShadowReadClassification;
  readonly severity: ShadowReadSeverity;
  readonly kv_present: boolean;
  readonly sql_present: boolean;
  readonly kv_conversion: ConversionSignal;
  readonly sql_conversion: ConversionSignal;
  /** Observed, never compared. */
  readonly sql_lifecycle_status: string | null;
  readonly sql_lifecycle_status_valid: boolean;
  readonly sql_outcome_type: string | null;
  /** Reason codes and booleans only — no business content, no free text. */
  readonly detail: Record<string, unknown>;
  readonly observed_at: string;
}

/**
 * Everything this module needs from the outside, and nothing more.
 *
 * There is no write port for KV and no write port for `outcomes`. The shape of
 * this interface is what makes "no dual write, no KV mutation" a property of
 * the code rather than a claim about it.
 */
export interface OutcomeShadowReadPorts {
  /** `false` means: perform no SQL work of any kind. */
  isEnabled(): boolean;
  /** The tenant that owns KV submissions; `undefined` when unresolvable. */
  resolveOrganizationId(): Promise<string | undefined>;
  /** Tenant-scoped read on the canonical join axis. */
  getOutcomeByLegacyKey(
    legacyKvKey: string,
    organizationId: string,
  ): Promise<OutcomeRecord | null>;
  recordTelemetry(record: ShadowReadTelemetryRecord): Promise<void>;
  /** Keeps the task alive past the response without blocking it. */
  schedule(task: () => Promise<void>): void;
  now(): string;
  logError(message: string): void;
}

export interface OutcomeShadowReadInput {
  /** The legacy KV submission id (`SUB-…`). */
  readonly submissionId: string;
  /** The parsed KV record the production read is returning, or null. */
  readonly kvOutcome: unknown;
}

/**
 * The flag. Strict opt-in: anything other than the exact string `'true'` — a
 * missing variable, an empty one, `'TRUE'`, `'1'` — leaves shadow reads off.
 *
 * One flag governs the whole feature. The SQL read and the telemetry write are
 * the same observation: enabling one without the other would either read
 * without recording (pointless) or record without reading (impossible), so
 * there is nothing for a second flag to mean.
 */
export function isShadowReadEnabled(rawFlag: string | undefined | null): boolean {
  return rawFlag === 'true';
}

/** Reads `didConvert` off the KV record without trusting its shape. */
export function kvConversionSignal(kvOutcome: unknown): ConversionSignal {
  if (kvOutcome === null || typeof kvOutcome !== 'object') return 'unknown';
  const value = (kvOutcome as Record<string, unknown>).didConvert;
  if (value === true) return 'converted';
  if (value === false) return 'not_converted';
  return 'unknown';
}

/**
 * Reads the conversion fact off the SQL row, if it has stated one.
 *
 * `outcome_type` is authoritative for the axis when it is `won` or `lost`. Its
 * other members — including the `'engagement'` default an unbackfilled row
 * carries — state no conversion fact, so `value.didConvert` is consulted next,
 * and absent that the row is `unknown`: incomplete, not contradictory.
 */
export function sqlConversionSignal(row: OutcomeRecord): ConversionSignal {
  if (row.outcome_type === 'won') return 'converted';
  if (row.outcome_type === 'lost') return 'not_converted';
  const value = row.value as Record<string, unknown> | null | undefined;
  if (value && typeof value === 'object') {
    if (value.didConvert === true) return 'converted';
    if (value.didConvert === false) return 'not_converted';
  }
  return 'unknown';
}

/**
 * Records the lifecycle status as found. Absent, null and malformed are three
 * observations, not three errors — the shadow read is here to find out which
 * of them production data actually contains.
 */
export function observeLifecycleStatus(status: unknown): LifecycleObservation {
  if (typeof status !== 'string') return { raw: null, schemaValid: false };
  return {
    raw: status,
    schemaValid: (SQL_LIFECYCLE_STATUSES as readonly string[]).includes(status),
  };
}

export interface ShadowReadClassificationResult {
  readonly classification: ShadowReadClassification;
  readonly severity: ShadowReadSeverity;
  readonly reason: string;
}

/**
 * The whole comparison, in one place, over the conversion axis only.
 *
 * Note what is not a parameter: the lifecycle status. It cannot influence a
 * classification it is not given.
 */
export function classifyOutcomeShadowRead(input: {
  readonly kvPresent: boolean;
  readonly sqlPresent: boolean;
  readonly kvConversion: ConversionSignal;
  readonly sqlConversion: ConversionSignal;
}): ShadowReadClassificationResult {
  const { kvPresent, sqlPresent, kvConversion, sqlConversion } = input;

  if (!kvPresent && !sqlPresent) {
    return { classification: 'both_missing', severity: 'info', reason: 'neither_store_has_record' };
  }
  if (kvPresent && !sqlPresent) {
    // Expected while the backfill is incomplete: KV is the authority and SQL
    // is catching up. Worth counting, not worth paging anyone.
    return { classification: 'sql_missing', severity: 'low', reason: 'sql_row_absent' };
  }
  if (!kvPresent && sqlPresent) {
    // A SQL row with no authority behind it. SQL is derived from KV, so this
    // is an integrity anomaly rather than migration lag.
    return { classification: 'kv_missing', severity: 'high', reason: 'sql_row_without_kv_record' };
  }
  if (sqlConversion === 'unknown') {
    // D3: present but not yet backfilled on the compared axis.
    return { classification: 'partial', severity: 'low', reason: 'sql_conversion_not_stated' };
  }
  if (kvConversion === 'unknown') {
    return { classification: 'partial', severity: 'low', reason: 'kv_conversion_not_stated' };
  }
  if (kvConversion === sqlConversion) {
    return { classification: 'match', severity: 'info', reason: 'conversion_agrees' };
  }
  return { classification: 'mismatch', severity: 'high', reason: 'conversion_disagrees' };
}

/**
 * Schedules the observation and returns. Nothing is awaited here, so the
 * production read's latency is unchanged and its result is untouched.
 *
 * With the flag off this returns before touching a single port that could
 * reach SQL.
 */
export function scheduleOutcomeShadowRead(
  ports: OutcomeShadowReadPorts,
  input: OutcomeShadowReadInput,
): void {
  let enabled = false;
  try {
    enabled = ports.isEnabled();
  } catch {
    return;
  }
  if (!enabled) return;

  try {
    ports.schedule(() => runOutcomeShadowRead(ports, input));
  } catch (err) {
    // A scheduler that refuses the task is the end of the observation, not of
    // the request that triggered it.
    safeLog(ports, `scheduling failed: ${describe(err)}`);
  }
}

/**
 * The observation itself: read, classify, record — in that order, in one
 * promise.
 *
 * The telemetry write is awaited *inside* this function, which is the function
 * the scheduler was handed. That is deliberate: on an edge runtime the task is
 * kept alive only for as long as the promise passed to it is pending, so a
 * telemetry write started after this resolves would be a write the platform is
 * free to kill mid-flight. Everything durable happens within the one scheduled
 * lifetime.
 *
 * It never rejects. A shadow read that could reject would eventually be a
 * shadow read that failed a production response.
 */
export async function runOutcomeShadowRead(
  ports: OutcomeShadowReadPorts,
  input: OutcomeShadowReadInput,
): Promise<void> {
  try {
    const legacyKvKey = outcomeLegacyKvKey(input.submissionId);
    const organizationId = await ports.resolveOrganizationId();
    if (!organizationId) {
      // No tenant, no tenant-scoped read, and no telemetry row that would have
      // to invent an owner for itself.
      safeLog(ports, `tenant unresolved for ${legacyKvKey}; skipped`);
      return;
    }

    const kvPresent = input.kvOutcome !== null && input.kvOutcome !== undefined;
    const kvConversion = kvConversionSignal(input.kvOutcome);

    let row: OutcomeRecord | null = null;
    try {
      row = await ports.getOutcomeByLegacyKey(legacyKvKey, organizationId);
    } catch (err) {
      await recordSafely(ports, {
        organization_id: organizationId,
        entity: 'outcome',
        legacy_kv_key: legacyKvKey,
        classification: 'error',
        severity: 'low',
        kv_present: kvPresent,
        sql_present: false,
        kv_conversion: kvConversion,
        sql_conversion: 'unknown',
        sql_lifecycle_status: null,
        sql_lifecycle_status_valid: false,
        sql_outcome_type: null,
        detail: { reason: 'sql_read_failed' },
        observed_at: ports.now(),
      });
      safeLog(ports, `SQL read failed for ${legacyKvKey}: ${describe(err)}`);
      return;
    }

    // Tenant guard. The read is already scoped to the organization; this second
    // check means a repository that ever stops scoping it cannot silently turn
    // this into a cross-tenant comparison. A row that trips it is treated as
    // not visible — its contents are never read and never recorded.
    if (row && row.organization_id !== organizationId) {
      await recordSafely(ports, {
        organization_id: organizationId,
        entity: 'outcome',
        legacy_kv_key: legacyKvKey,
        classification: 'sql_missing',
        severity: 'high',
        kv_present: kvPresent,
        sql_present: false,
        kv_conversion: kvConversion,
        sql_conversion: 'unknown',
        sql_lifecycle_status: null,
        sql_lifecycle_status_valid: false,
        sql_outcome_type: null,
        detail: { reason: 'tenant_guard_tripped', tenant_guard_tripped: true },
        observed_at: ports.now(),
      });
      safeLog(ports, `tenant guard tripped for ${legacyKvKey}`);
      return;
    }

    const lifecycle = observeLifecycleStatus(row?.status);
    const sqlConversion = row ? sqlConversionSignal(row) : 'unknown';
    const verdict = classifyOutcomeShadowRead({
      kvPresent,
      sqlPresent: row !== null,
      kvConversion,
      sqlConversion,
    });

    await recordSafely(ports, {
      organization_id: organizationId,
      entity: 'outcome',
      legacy_kv_key: legacyKvKey,
      classification: verdict.classification,
      severity: verdict.severity,
      kv_present: kvPresent,
      sql_present: row !== null,
      kv_conversion: kvConversion,
      sql_conversion: sqlConversion,
      sql_lifecycle_status: lifecycle.raw,
      sql_lifecycle_status_valid: lifecycle.schemaValid,
      sql_outcome_type: row && typeof row.outcome_type === 'string' ? row.outcome_type : null,
      detail: {
        reason: verdict.reason,
        // Whether a figure exists, never what it is: this table is diagnostics,
        // not a second copy of the business record.
        kv_conversion_value_present: hasConversionValue(input.kvOutcome),
        sql_value_present: row ? hasKeys(row.value) : false,
        sql_soft_deleted: false,
      },
      observed_at: ports.now(),
    });
  } catch (err) {
    safeLog(ports, `observation failed: ${describe(err)}`);
  }
}

async function recordSafely(
  ports: OutcomeShadowReadPorts,
  record: ShadowReadTelemetryRecord,
): Promise<void> {
  try {
    await ports.recordTelemetry(record);
  } catch (err) {
    safeLog(ports, `telemetry write failed: ${describe(err)}`);
  }
}

function safeLog(ports: OutcomeShadowReadPorts, message: string): void {
  try {
    ports.logError(message);
  } catch {
    // A logger that throws cannot be reported through the logger.
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hasConversionValue(kvOutcome: unknown): boolean {
  if (kvOutcome === null || typeof kvOutcome !== 'object') return false;
  const value = (kvOutcome as Record<string, unknown>).conversionValue;
  return typeof value === 'number' && Number.isFinite(value);
}

function hasKeys(value: unknown): boolean {
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}
