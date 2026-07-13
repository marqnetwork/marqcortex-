/**
 * Migration telemetry — MCV2-S6.2-IMPLEMENT-004
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { throwOnError } from './client.ts';
import type { MigrationMode, MigrationRunRecord, MigrationRunStatus } from './types.ts';

export async function createMigrationRun(
  client: SupabaseClient,
  input: {
    organization_id: string;
    migration_name: string;
    mode: MigrationMode;
    source_namespace?: string;
    batch_size: number;
    requested_by?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<MigrationRunRecord> {
  const { data, error } = await client
    .from('migration_runs')
    .insert({
      organization_id: input.organization_id,
      migration_name: input.migration_name,
      mode: input.mode,
      status: 'running',
      source_namespace: input.source_namespace ?? null,
      batch_size: input.batch_size,
      requested_by: input.requested_by ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  throwOnError(error, 'createMigrationRun');
  return data as MigrationRunRecord;
}

export async function updateMigrationRun(
  client: SupabaseClient,
  runId: string,
  patch: Partial<{
    status: MigrationRunStatus;
    completed_at: string;
    last_cursor: string | null;
    total_discovered: number;
    total_processed: number;
    total_inserted: number;
    total_updated: number;
    total_skipped: number;
    total_quarantined: number;
    total_failed: number;
    checksum: string | null;
    metadata: Record<string, unknown>;
    error_summary: unknown[];
  }>,
): Promise<void> {
  const { error } = await client
    .from('migration_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId);
  throwOnError(error, 'updateMigrationRun');
}

export async function incrementRunCounters(
  client: SupabaseClient,
  runId: string,
  deltas: Partial<{
    total_discovered: number;
    total_processed: number;
    total_inserted: number;
    total_updated: number;
    total_skipped: number;
    total_quarantined: number;
    total_failed: number;
  }>,
): Promise<void> {
  const { data, error } = await client
    .from('migration_runs')
    .select(
      'total_discovered, total_processed, total_inserted, total_updated, total_skipped, total_quarantined, total_failed',
    )
    .eq('id', runId)
    .single();
  throwOnError(error, 'incrementRunCounters.read');

  const row = data as Record<string, number>;
  await updateMigrationRun(client, runId, {
    total_discovered: row.total_discovered + (deltas.total_discovered ?? 0),
    total_processed: row.total_processed + (deltas.total_processed ?? 0),
    total_inserted: row.total_inserted + (deltas.total_inserted ?? 0),
    total_updated: row.total_updated + (deltas.total_updated ?? 0),
    total_skipped: row.total_skipped + (deltas.total_skipped ?? 0),
    total_quarantined: row.total_quarantined + (deltas.total_quarantined ?? 0),
    total_failed: row.total_failed + (deltas.total_failed ?? 0),
  });
}

export async function getMigrationRun(
  client: SupabaseClient,
  runId: string,
): Promise<MigrationRunRecord | null> {
  const { data, error } = await client
    .from('migration_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  throwOnError(error, 'getMigrationRun');
  return (data as MigrationRunRecord | null) ?? null;
}

export async function appendErrorSummary(
  client: SupabaseClient,
  runId: string,
  entry: unknown,
  maxEntries = 50,
): Promise<void> {
  const run = await getMigrationRun(client, runId);
  if (!run) return;
  const summary = [...(run.error_summary ?? []), entry].slice(-maxEntries);
  await updateMigrationRun(client, runId, { error_summary: summary });
}
