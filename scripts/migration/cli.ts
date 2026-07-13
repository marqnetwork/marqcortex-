#!/usr/bin/env node
/**
 * Migration CLI — MCV2-S6.2-IMPLEMENT-004
 * Usage: node --experimental-strip-types scripts/migration/cli.ts --mode=inventory
 */
import { runMigrationCli, runFullPipeline } from '../../supabase/functions/server/migration/orchestrator.ts';
import { runRollbackCli } from '../../supabase/functions/server/migration/rollback.ts';
import type { CliFlags, MigrationMode } from '../../supabase/functions/server/migration/types.ts';

function parseArgs(argv: string[]): CliFlags & { pipeline?: boolean; help?: boolean } {
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    }
  }

  const mode = (flags.mode as string) ?? 'inventory';
  return {
    mode: mode as MigrationMode,
    dryRun: flags['dry-run'] === true || flags.dryRun === 'true',
    resume: flags.resume === true,
    runId: flags.runId as string | undefined,
    confirm: flags.confirm === true,
    writeControlRecords: flags['write-control-records'] !== 'false',
    batchSize: flags.batchSize ? Number(flags.batchSize) : undefined,
    reportsDir: (flags.reportsDir as string) ?? 'architecture/database/reports/s6.2',
    keyPrefixFilter: flags.keyPrefixFilter as string | undefined,
    maxBatches: flags.maxBatches ? Number(flags.maxBatches) : undefined,
    pipeline: flags.pipeline === true,
    help: flags.help === true,
  };
}

function printHelp(): void {
  console.log(`
MARQ Cortex Migration CLI (S6.2)

Commands:
  --mode=inventory          Read-only KV inventory
  --mode=simulation         Parse/normalize/predict without business writes
  --mode=backfill           Live lead/contact backfill (requires service role)
  --mode=reconcile          KV vs SQL reconciliation
  --mode=rollback --runId=  Rollback rows tagged with migration run
  --pipeline                Run inventory → simulation → backfill → reconcile

Options:
  --dry-run                 No business row writes (simulation default for backfill preview)
  --resume                  Resume from checkpoint
  --runId=<uuid>            Target run for reconcile/rollback
  --confirm                 Required for live rollback
  --batchSize=50            Batch size
  --reportsDir=<path>       Report output directory

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  MIGRATION_ROLLBACK_ENABLED=true  (required for live rollback)
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.mode === 'rollback') {
    if (!args.runId) {
      console.error('rollback requires --runId');
      process.exit(1);
    }
    const result = await runRollbackCli(args.runId, !!args.dryRun, !!args.confirm);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if ((args as { pipeline?: boolean }).pipeline) {
    const code = await runFullPipeline(args);
    process.exit(code);
  }

  const result = await runMigrationCli(args);
  console.log(JSON.stringify({ exitCode: result.exitCode, runId: result.run?.id }, null, 2));
  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
