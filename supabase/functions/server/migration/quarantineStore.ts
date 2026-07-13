/**
 * Migration quarantine store — MCV2-S6.2-IMPLEMENT-004
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { throwOnError } from './client.ts';
import type { QuarantineInput } from './types.ts';

export async function insertQuarantine(
  client: SupabaseClient,
  input: QuarantineInput,
): Promise<void> {
  const { error } = await client.from('migration_quarantine').insert({
    run_id: input.run_id,
    organization_id: input.organization_id,
    source_namespace: input.source_namespace,
    source_key: input.source_key,
    source_payload: input.source_payload ?? null,
    reason_code: input.reason_code,
    reason_detail: input.reason_detail ?? null,
    target_table: input.target_table ?? null,
  });
  throwOnError(error, 'insertQuarantine');
}

export async function countQuarantineForRun(
  client: SupabaseClient,
  runId: string,
): Promise<number> {
  const { count, error } = await client
    .from('migration_quarantine')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId);
  throwOnError(error, 'countQuarantineForRun');
  return count ?? 0;
}

export async function listQuarantineByRun(
  client: SupabaseClient,
  runId: string,
  limit = 100,
): Promise<Array<{ source_key: string; reason_code: string }>> {
  const { data, error } = await client
    .from('migration_quarantine')
    .select('source_key, reason_code')
    .eq('run_id', runId)
    .limit(limit);
  throwOnError(error, 'listQuarantineByRun');
  return (data ?? []) as Array<{ source_key: string; reason_code: string }>;
}
