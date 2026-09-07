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
  buildSubmissionSimulationReport,
  createSubmissionDomainContext,
  processSubmissionBatch,
  submissionSimulationReportToMarkdown,
} from './domains/submissions.ts';
import {
  MIGRATION_NAME_SUBMISSIONS,
  SUBMISSION_ENTITY_PREFIX,
} from './submissionNormalizer.ts';
import {
  buildCortexSimulationReport,
  createCortexDomainContext,
  cortexSimulationReportToMarkdown,
  processCortexBatch,
} from './domains/cortexAnalysis.ts';
import { CORTEX_ENTITY_PREFIX, MIGRATION_NAME_CORTEX } from './cortexNormalizer.ts';
import {
  buildOutcomeSimulationReport,
  createOutcomeDomainContext,
  outcomeSimulationReportToMarkdown,
  processOutcomeBatch,
} from './domains/outcomes.ts';
import { MIGRATION_NAME_OUTCOMES, OUTCOME_ENTITY_PREFIX } from './outcomeNormalizer.ts';
import {
  createMigrationRun,
  updateMigrationRun,
  incrementRunCounters,
  getMigrationRun,
} from './telemetry.ts';
import {
  runReconciliation,
  persistReconciliationLog,
  reconciliationToMarkdown,
} from './reconciliation.ts';
import { reconcileSubmissionsDomain } from './submissionReconciliation.ts';
import type {
  CliFlags,
  InventoryReport,
  KvReader,
  MigrationRunRecord,
  ReconciliationResult,
  SimulationReport,
} from './types.ts';
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

/**
 * A migratable domain, as the orchestrator needs it.
 *
 * ── WHY THIS EXISTS RATHER THAN A SECOND `runSubmissionMigration` ──────────
 *
 * The loop below is the part of a migration that must not vary: paging by key
 * order, checkpointing after every batch, incrementing the run counters,
 * pausing at `--maxBatches`, and completing the checkpoint only when the scan
 * genuinely finished. A second copy of it for the second domain would be a
 * second place for resume semantics to drift, and resume semantics are what a
 * half-finished production backfill depends on.
 *
 * So the loop is written once and the DOMAIN is a parameter: what to scan, how
 * to classify a batch, what its counters are, and how to report a simulation.
 * The lead path is byte-for-byte the behaviour S6.2 certified — `runLeadMigration`
 * is now a call into this with the lead descriptor, and the lead suite passes
 * unmodified.
 */
export interface MigrationDomainDescriptor<Ctx> {
  /** `migration_runs.migration_name`. */
  readonly migrationName: string;
  /** The KV prefix scanned, and the checkpoint namespace. */
  readonly entityPrefix: string;
  createContext(organizationId: string, runId: string, writeBusinessRows: boolean): Ctx;
  processBatch(
    client: SupabaseClient,
    reader: KvReader,
    ctx: Ctx,
    records: Array<{ key: string; rawValue: unknown }>,
  ): Promise<void>;
  counters(ctx: Ctx): { inserted: number; updated: number; quarantined: number };
  buildSimulation(ctx: Ctx, discovered: number, runId: string | null): SimulationReport;
  simulationToMarkdown(report: SimulationReport): string;
  /**
   * KV vs SQL reconciliation for this domain, or `undefined` when it has none.
   *
   * `undefined` is a real answer rather than a gap to paper over: a backfill
   * that reported a reconciliation it never ran would be worse than one that
   * says plainly that it did not, so the orchestrator completes and says so.
   */
  readonly reconcile?: (
    client: SupabaseClient,
    organizationId: string,
    batchSize: number,
    runId?: string,
    keyPrefixFilter?: string,
  ) => Promise<ReconciliationResult>;
}

export const LEAD_DOMAIN: MigrationDomainDescriptor<ReturnType<typeof createLeadDomainContext>> = {
  migrationName: MIGRATION_NAME_LEADS,
  entityPrefix: LEAD_ENTITY_PREFIX,
  createContext: createLeadDomainContext,
  processBatch: processLeadBatch,
  counters: (ctx) => ({
    inserted: ctx.inserted,
    updated: ctx.updated,
    quarantined: ctx.quarantineCount,
  }),
  buildSimulation: (ctx, discovered, runId) => buildSimulationReport(ctx, discovered, runId, []),
  simulationToMarkdown: simulationReportToMarkdown,
  reconcile: runReconciliation,
};

export const SUBMISSION_DOMAIN: MigrationDomainDescriptor<
  ReturnType<typeof createSubmissionDomainContext>
> = {
  migrationName: MIGRATION_NAME_SUBMISSIONS,
  entityPrefix: SUBMISSION_ENTITY_PREFIX,
  createContext: createSubmissionDomainContext,
  processBatch: processSubmissionBatch,
  counters: (ctx) => ({
    inserted: ctx.inserted,
    updated: ctx.updated,
    quarantined: ctx.quarantineCount,
  }),
  buildSimulation: (ctx, discovered, runId) =>
    buildSubmissionSimulationReport(ctx, discovered, runId, []),
  simulationToMarkdown: submissionSimulationReportToMarkdown,
  // Its own reconciliation, and one that actually compares FIELDS rather than
  // only counting rows — see `submissionReconciliation.ts` for why the sample
  // is deterministic and why it borrows the shadow read's comparator.
  reconcile: async (client, organizationId, batchSize, runId, keyPrefixFilter) => {
    const result = await reconcileSubmissionsDomain(
      client,
      createKvReader(client, { keyPrefixFilter }),
      organizationId,
      batchSize,
      runId,
      keyPrefixFilter,
    );
    if (runId) await persistReconciliationLog(client, runId, result);
    return result;
  },
};

/**
 * A domain, ready to run, with its context type erased.
 *
 * The erasure is done by a closure rather than a cast: `runnable` is generic in
 * `Ctx` and returns a function that no longer mentions it, so a map of domains
 * with different context types is expressible without any of them being
 * asserted into another. A cast here would be the kind that stays correct until
 * somebody adds a third domain.
 */
export type RunnableMigrationDomain = (
  client: SupabaseClient,
  flags: CliFlags,
) => Promise<OrchestratorResult>;

function runnable<Ctx>(domain: MigrationDomainDescriptor<Ctx>): RunnableMigrationDomain {
  return (client, flags) => runDomainMigration(client, domain, flags);
}

export const CORTEX_DOMAIN: MigrationDomainDescriptor<
  ReturnType<typeof createCortexDomainContext>
> = {
  migrationName: MIGRATION_NAME_CORTEX,
  entityPrefix: CORTEX_ENTITY_PREFIX,
  createContext: createCortexDomainContext,
  processBatch: processCortexBatch,
  counters: (ctx) => ({
    inserted: ctx.inserted,
    updated: ctx.updated,
    quarantined: ctx.quarantineCount,
  }),
  buildSimulation: (ctx, discovered, runId) =>
    buildCortexSimulationReport(ctx, discovered, runId, []),
  simulationToMarkdown: cortexSimulationReportToMarkdown,
  // No reconciler yet. The orchestrator therefore completes a cortex backfill
  // and says so, rather than borrowing another domain's counts.
};

export const OUTCOME_DOMAIN: MigrationDomainDescriptor<
  ReturnType<typeof createOutcomeDomainContext>
> = {
  migrationName: MIGRATION_NAME_OUTCOMES,
  entityPrefix: OUTCOME_ENTITY_PREFIX,
  createContext: createOutcomeDomainContext,
  processBatch: processOutcomeBatch,
  counters: (ctx) => ({
    inserted: ctx.inserted,
    updated: ctx.updated,
    quarantined: ctx.quarantineCount,
  }),
  buildSimulation: (ctx, discovered, runId) =>
    buildOutcomeSimulationReport(ctx, discovered, runId, []),
  simulationToMarkdown: outcomeSimulationReportToMarkdown,
  // No reconciler yet; the orchestrator completes and says so.
};

/** The domains this CLI can run, by `--domain=`. */
export const MIGRATION_DOMAINS: Readonly<Record<string, RunnableMigrationDomain>> = {
  leads: runnable(LEAD_DOMAIN),
  submissions: runnable(SUBMISSION_DOMAIN),
  cortex: runnable(CORTEX_DOMAIN),
  outcomes: runnable(OUTCOME_DOMAIN),
};

export function isMigrationDomainName(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MIGRATION_DOMAINS, value);
}

export async function runLeadMigration(
  client: SupabaseClient,
  flags: CliFlags,
): Promise<OrchestratorResult> {
  return runDomainMigration(client, LEAD_DOMAIN, flags);
}

export async function runDomainMigration<Ctx>(
  client: SupabaseClient,
  domain: MigrationDomainDescriptor<Ctx>,
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
      migration_name: domain.migrationName,
      mode: flags.mode,
      source_namespace: domain.entityPrefix,
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
    const cp = await getCheckpoint(client, run.id, domain.entityPrefix);
    cursor = cp?.last_key ?? null;
  }

  const ctx = domain.createContext(organizationId, runId, writeBusiness);
  let discovered = 0;
  let batchNumber = 0;

  for (;;) {
    const page = await reader.scanPrefix(domain.entityPrefix, cursor, batchSize);
    if (page.records.length === 0 && batchNumber === 0) break;

    discovered += page.records.length;
    await domain.processBatch(client, reader, ctx, page.records);
    batchNumber += 1;

    if (writeControl && run) {
      const counters = domain.counters(ctx);
      await incrementRunCounters(client, run.id, {
        total_discovered: page.records.length,
        total_processed: page.records.length,
        total_inserted: counters.inserted,
        total_updated: counters.updated,
        total_quarantined: counters.quarantined,
      });
      await upsertCheckpoint(client, {
        run_id: run.id,
        namespace: domain.entityPrefix,
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
    const simulation = domain.buildSimulation(ctx, discovered, run?.id ?? null);
    writeReport(
      flags.reportsDir,
      'simulation-report',
      simulation,
      domain.simulationToMarkdown(simulation),
    );
    if (run) {
      await updateMigrationRun(client, run.id, {
        status: simulation.thresholdsPassed ? 'completed' : 'failed',
        completed_at: new Date().toISOString(),
        total_discovered: discovered,
        total_processed: discovered,
        total_quarantined: domain.counters(ctx).quarantined,
        checksum: simulation.checksumSource,
      });
      await completeCheckpoint(client, run.id, domain.entityPrefix);
    }
    return { run, simulation, exitCode: simulation.thresholdsPassed ? 0 : 1 };
  }

  if (flags.mode === 'backfill') {
    const pausedEarly = !!(flags.maxBatches && batchNumber >= (flags.maxBatches ?? 0));
    const counters = domain.counters(ctx);
    if (run) {
      await updateMigrationRun(client, run.id, {
        status: pausedEarly ? 'paused' : 'completed',
        completed_at: pausedEarly ? undefined : new Date().toISOString(),
        total_inserted: counters.inserted,
        total_updated: counters.updated,
        total_quarantined: counters.quarantined,
      });
      if (!pausedEarly) {
        await completeCheckpoint(client, run.id, domain.entityPrefix);
      }
    }
    writeReport(flags.reportsDir, 'backfill-report', {
      runId: run?.id,
      domain: domain.migrationName,
      inserted: counters.inserted,
      updated: counters.updated,
      quarantined: counters.quarantined,
      discovered,
      pausedEarly,
      reconciled: domain.reconcile !== undefined,
    });

    if (pausedEarly) {
      return { run, exitCode: 0 };
    }

    // A backfill that reported a reconciliation it never ran would be worse
    // than one that says plainly that it did not, so a domain with no
    // reconciler completes and says so rather than borrowing another domain's
    // counts.
    if (!domain.reconcile) {
      return { run, exitCode: 0 };
    }

    const recon = await domain.reconcile(
      client,
      organizationId,
      batchSize,
      run?.id,
      flags.keyPrefixFilter,
    );
    writeReport(flags.reportsDir, 'reconciliation-report', recon, reconciliationToMarkdown(recon));
    return { run, exitCode: recon.thresholdPassed ? 0 : 1 };
  }

  if (flags.mode === 'reconcile') {
    if (!domain.reconcile) {
      throw new MigrationEngineError(
        `The ${domain.migrationName} domain has no reconciliation implementation`,
        'INVALID_MODE',
      );
    }
    const recon = await domain.reconcile(
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
  // Defaults to leads, which is what every existing invocation means.
  const name = flags.domain ?? 'leads';
  if (!isMigrationDomainName(name)) {
    throw new MigrationEngineError(
      `Unknown migration domain: ${name}. Known: ${Object.keys(MIGRATION_DOMAINS).join(', ')}`,
      'INVALID_MODE',
    );
  }
  return MIGRATION_DOMAINS[name](client, flags);
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
