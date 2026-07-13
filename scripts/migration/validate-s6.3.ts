#!/usr/bin/env node
/**
 * MCV2-S6.3-VALIDATE-005 — Live fixture validation orchestrator
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMigrationClient, resolveMarqOrganizationId } from '../../supabase/functions/server/migration/client.ts';
import {
  countFixtureKeys,
  deleteS6ValidateFixtures,
  insertS6ValidateFixtures,
} from '../../supabase/functions/server/migration/fixtures/fixtureStore.ts';
import {
  expectedDuplicateCount,
  expectedMigratedCount,
  expectedQuarantinedCount,
  S6VALIDATE_FIXTURES,
} from '../../supabase/functions/server/migration/fixtures/s6validate.ts';
import { runLeadMigration } from '../../supabase/functions/server/migration/orchestrator.ts';
import { previewRollback, executeRollback } from '../../supabase/functions/server/migration/rollback.ts';
import { S6VALIDATE_KV_PREFIX } from '../../supabase/functions/server/migration/config.ts';

const REPORTS = 'architecture/database/reports/s6.3';

function write(name: string, data: unknown): void {
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(join(REPORTS, `${name}.json`), JSON.stringify(data, null, 2), 'utf8');
}

async function countFixtureLeads(client: ReturnType<typeof createMigrationClient>): Promise<number> {
  const { count } = await client
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .like('legacy_kv_key', `${S6VALIDATE_KV_PREFIX}%`)
    .is('deleted_at', null);
  return count ?? 0;
}

async function main(): Promise<void> {
  const client = createMigrationClient();
  const orgId = await resolveMarqOrganizationId(client);
  const base = {
    keyPrefixFilter: 's6validate',
    reportsDir: REPORTS,
    writeControlRecords: true,
  };

  write('fixture-manifest', {
    generatedAt: new Date().toISOString(),
    fixtures: S6VALIDATE_FIXTURES,
    expected: {
      migrated: expectedMigratedCount(),
      quarantined: expectedQuarantinedCount(),
      duplicate: expectedDuplicateCount(),
    },
  });

  if ((await countFixtureKeys(client)) > 0) {
    await deleteS6ValidateFixtures(client);
  }

  const insertedKeys = await insertS6ValidateFixtures(client);
  write('fixture-insert', { inserted: insertedKeys.length, keys: insertedKeys });

  const inventory = await runLeadMigration(client, { ...base, mode: 'inventory', batchSize: 50 });
  write('inventory-validation', inventory);
  if (inventory.exitCode !== 0) throw new Error('Inventory validation failed');

  const simulation = await runLeadMigration(client, { ...base, mode: 'simulation', batchSize: 50 });
  write('simulation-validation', simulation);
  if (simulation.exitCode !== 0) throw new Error('Simulation validation failed');

  const partial = await runLeadMigration(client, {
    ...base,
    mode: 'backfill',
    batchSize: 2,
    maxBatches: 1,
  });
  const checkRunId = partial.run?.id;
  if (!checkRunId) throw new Error('Checkpoint run missing id');
  write('checkpoint-partial', partial);

  const resumed = await runLeadMigration(client, {
    ...base,
    mode: 'backfill',
    batchSize: 50,
    resume: true,
    runId: checkRunId,
  });
  write('resume-validation', resumed);
  if (resumed.exitCode !== 0) throw new Error('Resume validation failed');

  process.env.MIGRATION_ROLLBACK_ENABLED = 'true';
  await executeRollback(client, checkRunId, { dryRun: false, confirm: true, requestedBy: 's6.3-checkpoint' });

  const backfill1 = await runLeadMigration(client, { ...base, mode: 'backfill', batchSize: 50 });
  const mainRunId = backfill1.run?.id;
  if (!mainRunId) throw new Error('Main backfill run missing id');
  write('backfill-validation', backfill1);
  if (backfill1.exitCode !== 0) throw new Error('Backfill validation failed');

  const leadsAfterFirst = await countFixtureLeads(client);
  const backfill2 = await runLeadMigration(client, { ...base, mode: 'backfill', batchSize: 50 });
  const leadsAfterSecond = await countFixtureLeads(client);
  write('idempotency-validation', {
    leadsAfterFirst,
    leadsAfterSecond,
    idempotent: leadsAfterFirst === leadsAfterSecond,
    secondExitCode: backfill2.exitCode,
  });
  if (leadsAfterFirst !== leadsAfterSecond) throw new Error('Idempotency failed');

  const reconcile = await runLeadMigration(client, {
    ...base,
    mode: 'reconcile',
    batchSize: 50,
    runId: mainRunId,
  });
  write('reconciliation-validation', reconcile);
  if (reconcile.exitCode !== 0) throw new Error('Reconciliation validation failed');

  const preview = await previewRollback(client, mainRunId);
  write('rollback-preview', preview);

  const rollback = await executeRollback(client, mainRunId, {
    dryRun: false,
    confirm: true,
    requestedBy: 's6.3-validate',
  });
  write('rollback-validation', rollback);

  const previewAgain = await previewRollback(client, mainRunId);
  write('rollback-idempotency', previewAgain);

  const deleted = await deleteS6ValidateFixtures(client);
  const remaining = await countFixtureKeys(client);
  write('cleanup-report', { deleted, remainingFixtureKeys: remaining, organizationId: orgId });
  if (remaining !== 0) throw new Error(`Cleanup incomplete: ${remaining} keys remain`);

  console.log(JSON.stringify({ status: 'completed', mainRunId, deleted, reportsDir: REPORTS }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
