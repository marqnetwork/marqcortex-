/**
 * Outcome KV↔SQL batch reconciliation — MCV2-S7.6 (live reconciliation runner)
 *
 * Pure, dependency-injected batch reconciliation used by the live CLI
 * (`outcome-shadow-reconcile.ts`). It scans KV outcomes, reads the matching SQL
 * row per submission (tenant-scoped), compares via the shared comparator, and
 * aggregates a Gate-C report. No Deno/Supabase imports here — Node-testable
 * with fakes; the CLI injects the live KV lister + SQL port.
 *
 * READ-ONLY reconciliation. It serves nothing to users and changes nothing;
 * KV remains authoritative. SQL is read only for comparison.
 */

import {
  compareOutcome,
  hashEntityRef,
  type OutcomeSqlPort,
} from '../../supabase/functions/server/storage/index.ts';

export interface ReconcileDeps {
  /** Parsed KV outcome objects (e.g. from kv.getByPrefix('outcome:')). */
  listKvOutcomes(): Promise<unknown[]>;
  /** Tenant-scoped SQL read port. */
  sqlPort: OutcomeSqlPort;
  /** Organization scope for the SQL reads. */
  organizationId: string;
  /** Hard per-read timeout (ms). */
  timeoutMs?: number;
}

export interface ReconcileReport {
  organizationId: string;
  total: number;
  skippedNoSubmissionId: number;
  byOutcome: Record<string, number>;
  unexplainedMismatchCount: number; // value/relationship/schema/source_missing
  normalizationOnlyCount: number;
  targetMissingCount: number;
  authorizationMismatchCount: number;
  errorCount: number;
  maxSeverity: string;
  gateCReady: boolean; // unexplained=0 AND authorization=0 AND error rate acceptable
  // Redacted samples only (hashed ref + outcome + field paths). No raw payloads.
  samples: Array<{ refHash: string; outcome: string; severity: string; fields: string[] }>;
}

const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, high: 2, critical: 3 };
const UNEXPLAINED = new Set(['value_mismatch', 'relationship_mismatch', 'schema_mismatch', 'source_missing']);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('reconcile SQL read timed out')), ms);
    (t as { unref?: () => void }).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function reconcileOutcomes(deps: ReconcileDeps): Promise<ReconcileReport> {
  const timeoutMs = deps.timeoutMs ?? 500;
  const kvOutcomes = await deps.listKvOutcomes();
  const byOutcome: Record<string, number> = {};
  const samples: ReconcileReport['samples'] = [];
  let skipped = 0;
  let maxSeverity = 'info';

  for (const kv of kvOutcomes) {
    const submissionId = (kv && typeof kv === 'object' ? (kv as Record<string, unknown>).submissionId : undefined);
    if (typeof submissionId !== 'string' || submissionId.length === 0) {
      skipped += 1;
      continue;
    }
    const refHash = hashEntityRef(submissionId);
    const meta = { requestId: 'reconcile', organizationId: deps.organizationId, effectiveOrg: deps.organizationId, entityRefHash: refHash };

    let cmp;
    try {
      const sqlRecord = await withTimeout(deps.sqlPort.getOutcomeBySubmission(submissionId, deps.organizationId), timeoutMs);
      cmp = compareOutcome(kv, sqlRecord, meta);
    } catch (err) {
      cmp = { outcome: 'error', severity: 'high', mismatchFields: [], sqlErrorClass: (err as Error)?.name ?? 'Error' } as ReturnType<typeof compareOutcome>;
    }

    byOutcome[cmp.outcome] = (byOutcome[cmp.outcome] ?? 0) + 1;
    if (SEVERITY_RANK[cmp.severity] > SEVERITY_RANK[maxSeverity]) maxSeverity = cmp.severity;
    if (cmp.outcome !== 'match' && samples.length < 50) {
      samples.push({ refHash, outcome: cmp.outcome, severity: cmp.severity, fields: cmp.mismatchFields });
    }
  }

  const unexplained = Object.entries(byOutcome).reduce((n, [k, v]) => (UNEXPLAINED.has(k) ? n + v : n), 0);
  const authz = byOutcome['authorization_mismatch'] ?? 0;
  const errors = byOutcome['error'] ?? 0;
  const total = kvOutcomes.length - skipped;
  const errorRate = total > 0 ? errors / total : 0;

  return {
    organizationId: deps.organizationId,
    total,
    skippedNoSubmissionId: skipped,
    byOutcome,
    unexplainedMismatchCount: unexplained,
    normalizationOnlyCount: byOutcome['normalization_only_match'] ?? 0,
    targetMissingCount: byOutcome['target_missing'] ?? 0,
    authorizationMismatchCount: authz,
    errorCount: errors,
    maxSeverity,
    gateCReady: unexplained === 0 && authz === 0 && errorRate < 0.005,
    samples,
  };
}
