/**
 * Migration checkpoint store — MCV2-S6.2-IMPLEMENT-004
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { throwOnError } from './client.ts';
import type { CheckpointStatus, MigrationCheckpointRecord } from './types.ts';

export async function getCheckpoint(
  client: SupabaseClient,
  runId: string,
  namespace: string,
): Promise<MigrationCheckpointRecord | null> {
  const { data, error } = await client
    .from('migration_checkpoints')
    .select('*')
    .eq('run_id', runId)
    .eq('namespace', namespace)
    .maybeSingle();
  throwOnError(error, 'getCheckpoint');
  return (data as MigrationCheckpointRecord | null) ?? null;
}

export async function upsertCheckpoint(
  client: SupabaseClient,
  input: {
    run_id: string;
    namespace: string;
    last_key: string | null;
    batch_number: number;
    processed_count: number;
    checksum?: string | null;
    status?: CheckpointStatus;
  },
): Promise<MigrationCheckpointRecord> {
  const { data, error } = await client
    .from('migration_checkpoints')
    .upsert(
      {
        run_id: input.run_id,
        namespace: input.namespace,
        last_key: input.last_key,
        batch_number: input.batch_number,
        processed_count: input.processed_count,
        checksum: input.checksum ?? null,
        status: input.status ?? 'running',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'run_id,namespace' },
    )
    .select('*')
    .single();
  throwOnError(error, 'upsertCheckpoint');
  return data as MigrationCheckpointRecord;
}

export async function completeCheckpoint(
  client: SupabaseClient,
  runId: string,
  namespace: string,
): Promise<void> {
  const { error } = await client
    .from('migration_checkpoints')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('run_id', runId)
    .eq('namespace', namespace);
  throwOnError(error, 'completeCheckpoint');
}
