/**
 * SQL Outcome adapter — diagnostic domain (MCV2-S7.4-IMPLEMENT-009)
 *
 * The smallest read-only adapter to fetch ONE Outcome record for the shadow
 * comparison. It depends on an injected `OutcomeSqlPort` (never the concrete
 * Supabase repository), so this file stays free of `jsr:`/Supabase imports and
 * is Node-testable. Tenant scope (`organizationId`) is mandatory.
 *
 * JOIN AXIS (MCV2-S7.4-REMEDIATION-2 · D1): the SQL row is located by
 * `legacy_kv_key = 'outcome:{submissionId}'`, the only key shared by KV and SQL.
 * The raw KV submission id is never used as a SQL lookup value.
 *
 * SERVICE-ROLE NOTE: the runtime OutcomeSqlPort is backed by a service-role
 * repository (RLS bypassed) and the legacy-key lookup is not tenant-scoped at
 * the query level. Shadow execution is therefore internal-only and MUST remain
 * protected by route authorization, the mandatory organization scope asserted
 * here, and the fail-closed `organization_id` validation in `compareOutcome`.
 * No writes. No SQL data is returned to users.
 */

import { StorageReadError, outcomeLegacyKvKey, type OutcomeSqlPort } from './contracts.ts';

export interface SqlOutcomeAdapter {
  /**
   * Read one outcome for a submission via its legacy KV key, with a hard
   * timeout. `organizationId` is required and is carried through to the
   * downstream fail-closed tenancy check.
   */
  readOutcome(submissionId: string, organizationId: string): Promise<{ data: unknown; ms: number }>;
}

function now(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StorageReadError('SQL shadow read timed out', 'ADAPTER_ERROR')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function createSqlOutcomeAdapter(port: OutcomeSqlPort, timeoutMs = 250): SqlOutcomeAdapter {
  return {
    async readOutcome(submissionId: string, organizationId: string): Promise<{ data: unknown; ms: number }> {
      if (!organizationId) {
        // Fail closed: never query SQL without a tenant scope.
        throw new StorageReadError('missing organization scope for SQL outcome read', 'ADAPTER_ERROR');
      }
      const started = now();
      // Join on the shared legacy KV key — never the raw KV submission id (D1).
      const data = await withTimeout(port.getOutcomeByLegacyKey(outcomeLegacyKvKey(submissionId)), timeoutMs);
      return { data, ms: now() - started };
    },
  };
}
