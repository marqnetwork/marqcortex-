/**
 * Live Outcome shadow reconciliation CLI — MCV2-S7.6 (Deno-only)
 *
 * Runs the batch KV↔SQL Outcome reconciliation against LIVE sources and prints
 * the Gate-C report (`MCV2-S7.5-GO-NO-GO-GATES.md`). READ-ONLY: it serves
 * nothing to users and writes nothing; KV stays authoritative, SQL is read only
 * for comparison.
 *
 * CAPABILITY-GATED + FAIL-SAFE: if service-role creds or the target org are
 * absent (e.g. offline), it prints "capability unavailable — deferred" and
 * exits 0 WITHOUT fabricating any result. It never enables the runtime shadow.
 *
 * Run (in a service-role env):
 *   STORAGE_SHADOW_DEFAULT_ORG_ID=<org-uuid> \
 *   deno run --allow-env --allow-net scripts/storage/outcome-shadow-reconcile.ts
 * (or via the equivalent node task once wired)
 */

import { reconcileOutcomes } from './outcomeReconcile.ts';
import { createRuntimeOutcomeSqlPort } from '../../supabase/functions/server/storage/runtimeSqlOutcome.ts';
import { safeJsonParse } from '../../supabase/functions/server/storage/kvParse.ts';
import * as kv from '../../supabase/functions/server/kv_store.tsx';

function env(key: string): string | undefined {
  return (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(key);
}
function exit(code: number): void {
  (globalThis as { Deno?: { exit?: (n: number) => void } }).Deno?.exit?.(code);
}

async function main(): Promise<void> {
  const orgId = env('STORAGE_SHADOW_DEFAULT_ORG_ID');
  const hasCreds = !!env('SUPABASE_URL') && !!env('SUPABASE_SERVICE_ROLE_KEY');

  if (!orgId || !hasCreds) {
    console.log('⏸  Outcome shadow reconciliation DEFERRED — capability unavailable.');
    console.log(`   org set: ${!!orgId} · service-role creds: ${hasCreds}`);
    console.log('   Set STORAGE_SHADOW_DEFAULT_ORG_ID + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run.');
    console.log('   (No live enablement, no data changed, no fabricated result.)');
    exit(0);
    return;
  }

  const report = await reconcileOutcomes({
    // KV outcomes are stored as JSON strings; parse defensively.
    listKvOutcomes: async () => (await kv.getByPrefix('outcome:')).map((v: unknown) => safeJsonParse(v)),
    sqlPort: createRuntimeOutcomeSqlPort(),
    organizationId: orgId,
    timeoutMs: Number(env('STORAGE_SHADOW_SQL_TIMEOUT_MS') ?? '500'),
  });

  console.log('\n=== Outcome Shadow Reconciliation (LIVE, read-only) ===');
  console.log(JSON.stringify(report, null, 2));
  console.log(report.gateCReady
    ? '\n✅ Gate-C data criteria MET (unexplained=0, authorization=0, error<0.5%). Human sign-off still required.'
    : '\n⚠️ Gate-C NOT met — see byOutcome/samples. KV remains authoritative; nothing changed.');
  exit(0);
}

main().catch((e) => { console.error('reconcile error:', e); exit(1); });
