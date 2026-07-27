/**
 * SQL Outcome adapter — diagnostic domain (MCV2-S7.4-IMPLEMENT-009)
 *
 * The smallest read-only adapter to fetch ONE Outcome record for the shadow
 * comparison. It depends on an injected `OutcomeSqlPort` (never the concrete
 * Supabase repository), so this file stays free of `jsr:`/Supabase imports and
 * is Node-testable. Tenant scope (`organizationId`) is mandatory.
 *
 * SERVICE-ROLE NOTE: the runtime OutcomeSqlPort is backed by a service-role
 * repository (RLS bypassed). Shadow execution is therefore internal-only and
 * MUST remain protected by route authorization + the mandatory organization
 * scoping applied here. No writes. No SQL data is returned to users.
 */

import { StorageReadError, type OutcomeSqlPort } from './contracts.ts';

export interface SqlOutcomeAdapter {
  /** Read one outcome by submission id within a tenant, with a hard timeout. */
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
      const data = await withTimeout(port.getOutcomeBySubmission(submissionId, organizationId), timeoutMs);
      return { data, ms: now() - started };
    },
  };
}
