/**
 * Durable spend store backed by the platform key-value store.
 *
 * The MARQ spend ceiling is worthless if it lives in module memory: a Supabase
 * edge isolate is recycled routinely, and an in-memory ledger rediscovers a $0
 * balance every time one is. This store is what makes "the platform has spent
 * $7.40 of $9" a fact that survives a restart.
 *
 * A read failure is NOT treated as "$0 spent". A ledger that fails open on a
 * storage outage is a ledger that spends without limit exactly when the
 * platform has lost the ability to observe itself, so `load` propagates the
 * failure and the caller fails the request closed. A write failure propagates
 * for the same reason: a reservation that was not persisted has not happened,
 * and pretending otherwise would let the same headroom be granted twice.
 *
 * This is the opposite of the audit store's policy, deliberately. Audit is
 * fail-open — losing a record must not fail a customer's request. Spend is
 * fail-closed — losing a record must not spend MARQ's money.
 */

import type { SpendRecord, SpendStore } from '../policy/spendLedger.ts';

export type KvSpendReader = (key: string) => Promise<unknown>;
export type KvSpendWriter = (key: string, value: unknown) => Promise<void>;

export interface KvSpendStoreOptions {
  readonly read: KvSpendReader;
  readonly write: KvSpendWriter;
  /** Reported when a stored record cannot be parsed. */
  readonly onCorrupt?: (scope: string, detail: string) => void;
}

const SCHEMA = 'ai.spend.v1';

/** `ai:spend:{scope}` — a flat namespace; the scope already carries its tenant. */
export function spendKeyFor(scope: string): string {
  return `ai:spend:${scope}`;
}

/**
 * Coerce a stored value into a record, rejecting anything that is not
 * recognisably one. A half-written or hand-edited row must not silently become
 * a zero balance, so an unusable value is reported and treated as an error
 * rather than as "no spend yet".
 */
function parseRecord(scope: string, raw: unknown): SpendRecord | undefined | 'corrupt' {
  if (raw === null || raw === undefined) return undefined;

  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return undefined;
    try {
      value = JSON.parse(raw);
    } catch {
      return 'corrupt';
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'corrupt';
  const candidate = value as Record<string, unknown>;

  const spent = candidate.spentMicroUsd;
  const reserved = candidate.reservedMicroUsd;
  const cap = candidate.capMicroUsd;
  if (
    typeof spent !== 'number' ||
    typeof reserved !== 'number' ||
    typeof cap !== 'number' ||
    !Number.isFinite(spent) ||
    !Number.isFinite(reserved) ||
    !Number.isFinite(cap)
  ) {
    return 'corrupt';
  }

  return {
    scope,
    spentMicroUsd: Math.max(0, Math.round(spent)),
    reservedMicroUsd: Math.max(0, Math.round(reserved)),
    capMicroUsd: Math.max(0, Math.round(cap)),
    attemptCount:
      typeof candidate.attemptCount === 'number' && Number.isFinite(candidate.attemptCount)
        ? Math.max(0, Math.round(candidate.attemptCount))
        : 0,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
    resets: Array.isArray(candidate.resets)
      ? (candidate.resets.filter(
          (entry) => typeof entry === 'object' && entry !== null,
        ) as SpendRecord['resets'])
      : [],
  };
}

export function createKvSpendStore(options: KvSpendStoreOptions): SpendStore {
  return {
    async load(scope) {
      const raw = await options.read(spendKeyFor(scope));
      const parsed = parseRecord(scope, raw);
      if (parsed === 'corrupt') {
        options.onCorrupt?.(scope, 'stored spend record is not readable');
        // Fail closed: an unreadable ledger is not an empty ledger.
        throw new Error(`AI spend ledger for ${scope} is unreadable; refusing to assume zero spend.`);
      }
      return parsed;
    },

    async save(record) {
      await options.write(spendKeyFor(record.scope), { ...record, _schema: SCHEMA });
    },
  };
}
