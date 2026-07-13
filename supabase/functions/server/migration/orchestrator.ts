/**
 * Migration orchestrator — MCV2-S6.2-IMPLEMENT-004
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LEAD_ENTITY_PREFIX,
  MIGRATION_NAME_LEADS,
  resolveBatchSize,
  shouldWriteControlRecords,
} from './config.ts';
import { createMigrationClient, resolveMarqOrganizationId } from './client.ts';
import { createKvReader } from './kvReader.ts';
import { upsertCheckpoint, getCheckpoint, completeCheckpoint } from './checkpointStore.ts';
import {
  buildInventoryReport,
  inventoryPassesThresholds,
  inventoryReportToMarkdown,
  checksumInventory,
} from './inventory.ts';
import {
  createLeadDomainContext,
  processLeadBatch,
  buildSimulationReport,
  simulationReportToMarkdown,
} from './domains/leads.ts';
import {
  createMigrationRun,
  updateMigrationRun,
  incrementRunCounters,
  getMigrationRun,
} from './telemetry.ts';
import {
  runReconciliation,
  reconciliationToMarkdown,
} from './reconciliation.ts';
import type { CliFlags, InventoryReport, MigrationRunRecord, SimulationReport } from './types.ts';
import { MigrationEngineError } from './types.ts';

export interface OrchestratorResult {
  run: MigrationRunRecord | null;
  inventory?: InventoryReport;
  simulation?: SimulationReport;
  exitCode: number;
}

function writeReport(dir: string | undefined, name: string, json: unknown, markdown?: string): void {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(json, null, 2), 'utf8');
  if (markdown) {
    writeFileSync(join(dir, `${name}.md`), markdown, 'utf8');
  }
}

export async function runLeadMigration(
  client: SupabaseClient,
  flags: CliFlags,
): Promise<OrchestratorResult> {
  const batchSize = resolveBatchSize(flags.batchSize);
  const organizationId = await resolveMarqOrganizationId(client);
  const reader = createKvReader(client, { keyPrefixFilter: flags.keyPrefixFilter });
  const writeControl = shouldWriteControlRecords(flags.mode, flags.writeControlRecords);
  const writeBusiness = flags.mode === 'backfill' && !flags.dryRun;

  let run: MigrationRunRecord | null = null;

  if (flags.resume && flags.runId) {
    run = await getMigrationRun(client, flags.runId);
    if (!run) {
      throw new MigrationEngineError(`Migration run not found: ${flags.runId}`, 'RUN_NOT_FOUND');
    }
  } else if (writeControl && flags.mode !== 'inventory') {
    run = await createMigrationRun(client, {
      organization_id: organizationId,
      migration_name: MIGRATION_NAME_LEADS,
      mode: flags.mode,
      source_namespace: LEAD_ENTITY_PREFIX,
      batch_size: batchSize,
      requested_by: 'migration-cli',
      metadata: { dry_run: !!flags.dryRun, key_prefix_filter: flags.keyPrefixFilter ?? null },
    });
  }

  if (flags.mode === 'inventory') {
    const inventory = await buildInventoryReport(reader, batchSize, flags.keyPrefixFilter);
    writeReport(flags.reportsDir, 'inventory-report', inventory, inventoryReportToMarkdown(inventory));
    const pass = inventoryPassesThresholds(inventory);
    return { run: null, inventory, exitCode: pass ? 0 : 1 };
  }

  const runId = run?.id ?? 'simulation-local';
  let cursor: string | null = null;
  if (flags.resume && run) {
    const cp = await getCheckpoint(client, run.id, LEAD_ENTITY_PREFIX);
    cursor = cp?.last_key ?? null;
  }

  const ctx = createLeadDomainContext(organizationId, runId, writeBusiness);
  let discovered = 0;
  let batchNumber = 0;

  for (;;) {
    const page = await reader.scanPrefix(LEAD_ENTITY_PREFIX, cursor, batchSize);
    if (page.records.length === 0 && batchNumber === 0) break;

    discovered += page.records.length;
    await processLeadBatch(client, reader, ctx, page.records);
    batchNumber += 1;

    if (writeControl && run) {
      await incrementRunCounters(client, run.id, {
        total_discovered: page.records.length,
        total_processed: page.records.length,
        total_inserted: ctx.inserted,
        total_updated: ctx.updated,
        total_quarantined: ctx.quarantineCount,
      });
      await upsertCheckpoint(client, {
        run_id: run.id,
        namespace: LEAD_ENTITY_PREFIX,
        last_key: page.records.length ? page.records[page.records.length - 1].key : cursor,
        batch_number: batchNumber,
        processed_count: discovered,
        status: page.hasMore && !(flags.maxBatches && batchNumber >= flags.maxBatches) ? 'running' : 'completed',
      });
      await updateMigrationRun(client, run.id, {
        last_cursor: page.records.length ? page.records[page.records.length - 1].key : cursor,
        status:
          flags.maxBatches && batchNumber >= flags.maxBatches && page.hasMore ? 'paused' : undefined,
      });
    }

    if (flags.maxBatches && batchNumber >= flags.maxBatches) {
      break;
    }

    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  if (flags.mode === 'simulation') {
    const simulation = buildSimulationReport(ctx, discovered, run?.id ?? null, []);
    writeReport(
      flags.reportsDir,
      'simulation-report',
      simulation,
      simulationReportToMarkdown(simulation),
    );
    if (run) {
      await updateMigrationRun(client, run.id, {
        status: simulation.thresholdsPassed ? 'completed' : 'failed',
        completed_at: new Date().toISOString(),
        total_discovered: discovered,
        total_processed: discovered,
        total_quarantined: ctx.quarantineCount,
        checksum: simulation.checksumSource,
      });
      await completeCheckpoint(client, run.id, LEAD_ENTITY_PREFIX);
    }
    return { run, simulation, exitCode: simulation.thresholdsPassed ? 0 : 1 };
  }

  if (flags.mode === 'backfill') {
    const pausedEarly = !!(flags.maxBatches && batchNumber >= (flags.maxBatches ?? 0));
    if (run) {
      await updateMigrationRun(client, run.id, {
        status: pausedEarly ? 'paused' : 'completed',
        completed_at: pausedEarly ? undefined : new Date().toISOString(),
        total_inserted: ctx.inserted,
        total_updated: ctx.updated,
        total_quarantined: ctx.quarantineCount,
      });
      if (!pausedEarly) {
        await completeCheckpoint(client, run.id, LEAD_ENTITY_PREFIX);
      }
    }
    writeReport(flags.reportsDir, 'backfill-report', {
      runId: run?.id,
      inserted: ctx.inserted,
      updated: ctx.updated,
      quarantined: ctx.quarantineCount,
      discovered,
      pausedEarly,
    });

    if (pausedEarly) {
      return { run, exitCode: 0 };
    }

    const recon = await runReconciliation(client, organizationId, batchSize, run?.id, flags.keyPrefixFilter);
    writeReport(flags.reportsDir, 'reconciliation-report', recon, reconciliationToMarkdown(recon));
    return { run, exitCode: recon.thresholdPassed ? 0 : 1 };
  }

  if (flags.mode === 'reconcile') {
    const recon = await runReconciliation(
      client,
      organizationId,
      batchSize,
      flags.runId,
      flags.keyPrefixFilter,
    );
    writeReport(flags.reportsDir, 'reconciliation-report', recon, reconciliationToMarkdown(recon));
    return { run: null, exitCode: recon.thresholdPassed ? 0 : 1 };
  }

  throw new MigrationEngineError(`Unsupported mode: ${flags.mode}`, 'INVALID_MODE');
}

export async function runMigrationCli(flags: CliFlags): Promise<OrchestratorResult> {
  const client = createMigrationClient();
  return runLeadMigration(client, flags);
}

export async function runFullPipeline(flags: Omit<CliFlags, 'mode'>): Promise<number> {
  const base = { ...flags, reportsDir: flags.reportsDir ?? 'architecture/database/reports/s6.2' };

  const inventory = await runMigrationCli({ ...base, mode: 'inventory' });
  if (inventory.exitCode !== 0) return inventory.exitCode;

  const simulation = await runMigrationCli({
    ...base,
    mode: 'simulation',
    writeControlRecords: true,
  });
  if (simulation.exitCode !== 0) return simulation.exitCode;

  const backfill = await runMigrationCli({
    ...base,
    mode: 'backfill',
    writeControlRecords: true,
  });
  return backfill.exitCode;
}
