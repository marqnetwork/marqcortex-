/**
 * Outcome shadow read — MCV2-S7.4.
 *
 * KV (`outcome:{submissionId}`) is the runtime authority. When the
 * `RUNTIME_SHADOW_READ_OUTCOME` flag is enabled, the outcome read route also
 * reads the SQL `outcomes` shadow (by `legacy_kv_key`), compares a normalized
 * projection, and records telemetry. The comparison is:
 *   - side-effect free (never writes),
 *   - non-authoritative (never alters the route response),
 *   - fully guarded (a SQL failure is recorded as `error`, never thrown).
 *
 * The SQL reader is injected so this module has no `jsr:`/Supabase import and can
 * run under the Node `--experimental-strip-types` test runner.
 */
import type {
  KvOutcomeProjection,
  OutcomeSqlReader,
  ShadowReadResult,
  ShadowReadStatus,
  SqlOutcomeProjection,
} from './contracts.ts';
import { isOutcomeShadowReadEnabled } from './config.ts';
import { recordShadowRead } from './shadowTelemetry.ts';

const KV_PREFIX = 'outcome:';

/** Builds the legacy KV key that the SQL `outcomes.legacy_kv_key` column mirrors. */
export function outcomeLegacyKey(submissionId: string): string {
  return `${KV_PREFIX}${submissionId}`;
}

/** Narrows a raw KV outcome blob into the fields the shadow read compares. */
export function projectKvOutcome(
  submissionId: string,
  raw: Record<string, unknown> | null | undefined,
): KvOutcomeProjection | null {
  if (!raw) return null;
  return {
    submissionId,
    didConvert: typeof raw.didConvert === 'boolean' ? raw.didConvert : null,
    conversionValue:
      typeof raw.conversionValue === 'number' ? raw.conversionValue : null,
  };
}

/**
 * Pure comparison. Business fields (`didConvert`, `conversionValue`) are compared
 * only when BOTH sides carry a non-null value, so partially backfilled SQL rows
 * surface as `missing_sql`/absence rather than false `mismatch` noise. Identity
 * (`submissionId`) is always compared when both records exist.
 */
export function compareOutcome(
  kv: KvOutcomeProjection | null,
  sql: SqlOutcomeProjection | null,
): { status: ShadowReadStatus; mismatchFields: string[] } {
  if (!kv && !sql) return { status: 'skipped', mismatchFields: [] };
  if (kv && !sql) return { status: 'missing_sql', mismatchFields: [] };
  if (!kv && sql) return { status: 'missing_kv', mismatchFields: [] };

  const mismatchFields: string[] = [];
  // Non-null assertions are safe: both kv and sql are present past the guards above.
  const k = kv as KvOutcomeProjection;
  const s = sql as SqlOutcomeProjection;

  if (k.submissionId !== s.submissionId) mismatchFields.push('submissionId');
  if (
    k.didConvert !== null &&
    s.didConvert !== null &&
    k.didConvert !== s.didConvert
  ) {
    mismatchFields.push('didConvert');
  }
  if (
    k.conversionValue !== null &&
    s.conversionValue !== null &&
    k.conversionValue !== s.conversionValue
  ) {
    mismatchFields.push('conversionValue');
  }

  return {
    status: mismatchFields.length === 0 ? 'match' : 'mismatch',
    mismatchFields,
  };
}

export interface ShadowReadOutcomeInput {
  submissionId: string;
  /** Authoritative KV outcome blob (already parsed), or null when KV has none. */
  kvOutcome: Record<string, unknown> | null | undefined;
  /** Injected SQL reader. */
  reader: OutcomeSqlReader;
  /** Test/override hook for the clock. */
  now?: () => number;
}

/**
 * Executes one guarded, non-authoritative outcome shadow read and records
 * telemetry. Returns the result for tests/diagnostics; route callers ignore it.
 * Never throws.
 */
export async function shadowReadOutcome(
  input: ShadowReadOutcomeInput,
): Promise<ShadowReadResult> {
  const { submissionId, kvOutcome, reader } = input;
  const clock = input.now ?? (() => Date.now());
  const key = outcomeLegacyKey(submissionId);

  if (!isOutcomeShadowReadEnabled()) {
    return { domain: 'outcome', key, status: 'skipped', mismatchFields: [], latencyMs: 0 };
  }

  const start = clock();
  const kvProjection = projectKvOutcome(submissionId, kvOutcome);

  let result: ShadowReadResult;
  try {
    const sqlProjection = await reader(key);
    const { status, mismatchFields } = compareOutcome(kvProjection, sqlProjection);
    result = {
      domain: 'outcome',
      key,
      status,
      mismatchFields,
      latencyMs: clock() - start,
    };
  } catch (err) {
    console.log(`[runtime-shadow] outcome shadow read error for ${key}:`, err);
    result = {
      domain: 'outcome',
      key,
      status: 'error',
      mismatchFields: [],
      latencyMs: clock() - start,
    };
  }

  // `skipped` (both sides absent) carries no validation signal — don't buffer noise.
  if (result.status !== 'skipped') {
    recordShadowRead(result);
  }
  return result;
}
