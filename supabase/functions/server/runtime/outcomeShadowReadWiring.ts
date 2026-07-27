/**
 * Production wiring for the outcome shadow read — MCV2-S7.4.
 *
 * This is the only runtime module that touches the SQL repository (and therefore
 * the `jsr:` Supabase import), so the core `outcomeShadowRead.ts` stays runnable
 * under the Node test runner. Imported by the Edge function (`index.tsx`) only.
 */
import type { OutcomeRecord } from '../../../../src/types/diagnostic.database.types.ts';
import { createOutcomeRepository } from '../repositories/outcomeRepository.ts';
import type { SqlOutcomeProjection } from './contracts.ts';
import { shadowReadOutcome } from './outcomeShadowRead.ts';

/** Maps a SQL `outcomes` row into the neutral projection the comparison uses. */
export function projectOutcomeRecord(record: OutcomeRecord): SqlOutcomeProjection {
  const value = record.value ?? {};
  return {
    submissionId: record.submission_id,
    legacyKvKey: record.legacy_kv_key,
    didConvert: typeof value.didConvert === 'boolean' ? value.didConvert : null,
    conversionValue:
      typeof value.conversionValue === 'number' ? value.conversionValue : null,
    status: record.status,
  };
}

/**
 * Runs the outcome shadow read against live SQL. Fully guarded downstream by
 * `shadowReadOutcome` — a missing Supabase credential or query failure is
 * recorded as telemetry, never surfaced to the route. No-ops (returns quickly)
 * when the `RUNTIME_SHADOW_READ_OUTCOME` flag is off.
 */
export async function runOutcomeShadowRead(
  submissionId: string,
  kvOutcome: Record<string, unknown> | null | undefined,
): Promise<void> {
  await shadowReadOutcome({
    submissionId,
    kvOutcome,
    reader: async (legacyKvKey) => {
      const repo = createOutcomeRepository();
      const record = await repo.getOutcomeByLegacyKey(legacyKvKey);
      return record ? projectOutcomeRecord(record) : null;
    },
  });
}
