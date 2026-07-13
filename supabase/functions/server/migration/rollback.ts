/**
 * Bounded rollback for lead/contact backfill — MCV2-S6.2-IMPLEMENT-004
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIGRATION_METADATA_KEY } from './config.ts';
import { throwOnError, createMigrationClient } from './client.ts';
import { createMigrationRun, updateMigrationRun, getMigrationRun } from './telemetry.ts';

export interface RollbackPreview {
  runId: string;
  leads: number;
  contacts: number;
  contactMethods: number;
  dryRun: boolean;
}

export async function previewRollback(
  client: SupabaseClient,
  runId: string,
): Promise<RollbackPreview> {
  const leads = await countByMigrationRun(client, 'leads', runId);
  const contacts = await countByMigrationRun(client, 'contacts', runId);
  const contactMethods = await countContactMethodsForRun(client, runId);
  return { runId, leads, contacts, contactMethods, dryRun: true };
}

async function countByMigrationRun(
  client: SupabaseClient,
  table: string,
  runId: string,
): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select('id', { count: 'exact', head: true })
    .contains('metadata', { [MIGRATION_METADATA_KEY]: runId })
    .is('deleted_at', null);
  throwOnError(error, `countByMigrationRun.${table}`);
  return count ?? 0;
}

async function countContactMethodsForRun(
  client: SupabaseClient,
  runId: string,
): Promise<number> {
  const { data: contacts, error } = await client
    .from('contacts')
    .select('id')
    .contains('metadata', { [MIGRATION_METADATA_KEY]: runId });
  throwOnError(error, 'countContactMethodsForRun.contacts');
  if (!contacts?.length) return 0;
  const ids = contacts.map((c) => c.id);
  const { count, error: cmError } = await client
    .from('contact_methods')
    .select('id', { count: 'exact', head: true })
    .in('contact_id', ids);
  throwOnError(cmError, 'countContactMethodsForRun.methods');
  return count ?? 0;
}

export async function executeRollback(
  client: SupabaseClient,
  runId: string,
  options: { dryRun?: boolean; confirm?: boolean; requestedBy?: string },
): Promise<RollbackPreview> {
  const existing = await getMigrationRun(client, runId);
  if (!existing) {
    throw new Error(`Migration run not found: ${runId}`);
  }

  const preview = await previewRollback(client, runId);
  if (options.dryRun) return preview;

  if (!options.confirm) {
    throw new Error('Rollback requires --confirm flag');
  }

  if (process.env.MIGRATION_ROLLBACK_ENABLED !== 'true') {
    throw new Error('MIGRATION_ROLLBACK_ENABLED=true is required for live rollback');
  }

  const rollbackRun = await createMigrationRun(client, {
    organization_id: existing.organization_id,
    migration_name: existing.migration_name,
    mode: 'rollback',
    batch_size: 50,
    requested_by: options.requestedBy ?? 'migration-cli',
    metadata: { target_run_id: runId },
  });

  const { data: contacts } = await client
    .from('contacts')
    .select('id')
    .contains('metadata', { [MIGRATION_METADATA_KEY]: runId });
  const contactIds = (contacts ?? []).map((c) => c.id as string);

  if (contactIds.length) {
    const { error: cmError } = await client
      .from('contact_methods')
      .delete()
      .in('contact_id', contactIds);
    throwOnError(cmError, 'rollback.contact_methods');
  }

  const { error: leadsError } = await client
    .from('leads')
    .delete()
    .contains('metadata', { [MIGRATION_METADATA_KEY]: runId });
  throwOnError(leadsError, 'rollback.leads');

  const { error: contactsError } = await client
    .from('contacts')
    .delete()
    .contains('metadata', { [MIGRATION_METADATA_KEY]: runId });
  throwOnError(contactsError, 'rollback.contacts');

  await updateMigrationRun(client, rollbackRun.id, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_processed: preview.leads + preview.contacts + preview.contactMethods,
    metadata: {
      target_run_id: runId,
      deleted: preview,
    },
  });

  return { ...preview, dryRun: false };
}

export async function runRollbackCli(
  runId: string,
  dryRun: boolean,
  confirm: boolean,
): Promise<RollbackPreview> {
  const client = createMigrationClient();
  return executeRollback(client, runId, { dryRun, confirm });
}
