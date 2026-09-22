/**
 * A2-P06-C02 — the zero-estate census. What stands in for a backfill.
 *
 * Under the selected strategy there is nothing to copy: the hosted estate held
 * zero workflow and zero agent runtime rows (A2-P05). What has to be PROVEN,
 * immediately before any authority moves, is that this is still true. This
 * module counts; `planTransition` refuses; nothing here reads a payload.
 *
 * ── KEYS ONLY ─────────────────────────────────────────────────────────────
 *
 * The census is taken from KEYS, never values. A key says which tenant, which
 * domain and which record kind a row is; that is everything the zero-estate
 * decision needs, and a census that never opens a value cannot leak one.
 *
 * ── A ROW IS A ROW ────────────────────────────────────────────────────────
 *
 * Every key in a runtime namespace counts, whatever state its record is in,
 * whether it parses, and whether its tenant is canonical — a corrupt row, an
 * orphan checkpoint and a terminal run are all rows the new authority would not
 * have. "Zero" means zero keys, not zero valid records, and that is the
 * difference between an abort rule and a filter.
 *
 * `scripts/a2-zero-estate-recheck.sql` is the hosted-side twin: the same key
 * patterns, run read-only against the database. Pinned equal by a test.
 */

import type { RuntimeEstateCount, RuntimePersistenceDomain } from './runtimePersistenceAuthority.ts';

/** The key namespaces of each domain. Mirrors the two key-value store modules. */
export const RUNTIME_KEY_NAMESPACES: Readonly<
  Record<RuntimePersistenceDomain, Readonly<Record<keyof RuntimeEstateCount, string>>>
> = {
  workflow: { runs: 'workflow_run', checkpoints: 'workflow_checkpoint', approvals: 'workflow_approval' },
  agent: { runs: 'agent_run', checkpoints: 'agent_checkpoint', approvals: 'agent_approval' },
};

/** `org:{tenant}:ai:{namespace}:...` — the tenant segment is any non-colon run. */
const RUNTIME_KEY = /^org:([^:]+):ai:([a-z_]+):/;

export interface RuntimeEstateCensus {
  readonly domains: Readonly<Record<RuntimePersistenceDomain, RuntimeEstateCount>>;
  /** Distinct tenant segments holding any runtime key, per domain. */
  readonly tenants: Readonly<Record<RuntimePersistenceDomain, readonly string[]>>;
  /** Keys inspected in total. */
  readonly inspected: number;
}

export function censusKvRuntimeEstate(keys: Iterable<string>): RuntimeEstateCensus {
  const counts: Record<RuntimePersistenceDomain, { runs: number; checkpoints: number; approvals: number }> = {
    workflow: { runs: 0, checkpoints: 0, approvals: 0 },
    agent: { runs: 0, checkpoints: 0, approvals: 0 },
  };
  const tenants: Record<RuntimePersistenceDomain, Set<string>> = { workflow: new Set(), agent: new Set() };
  let inspected = 0;
  for (const key of keys) {
    inspected += 1;
    const match = RUNTIME_KEY.exec(key);
    if (!match) continue;
    const [, tenant, namespace] = match;
    for (const domain of ['workflow', 'agent'] as const) {
      for (const kind of ['runs', 'checkpoints', 'approvals'] as const) {
        if (RUNTIME_KEY_NAMESPACES[domain][kind] === namespace) {
          counts[domain][kind] += 1;
          tenants[domain].add(tenant);
        }
      }
    }
  }
  return {
    domains: counts,
    tenants: { workflow: [...tenants.workflow].sort(), agent: [...tenants.agent].sort() },
    inspected,
  };
}
