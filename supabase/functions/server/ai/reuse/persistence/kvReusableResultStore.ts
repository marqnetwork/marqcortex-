/**
 * Durable reusable-result storage, over the platform key-value store.
 *
 * ── NO SECOND DATABASE ARCHITECTURE ────────────────────────────────────────
 *
 * The batch is explicit that caching must not grow its own storage stack, and
 * this obeys it literally: the same `tenantScopedKey` builder, the same
 * `kv_compare_and_swap_field` contract (migration 20260804120000), the same
 * prefix-scan reader, and the same corrupt-row handling the agent and workflow
 * stores already use. NO NEW MIGRATION — the contract needed is exactly the
 * contract that already exists, and a second SQL function differing only in the
 * table it was written for is how two implementations of one guarantee begin.
 *
 *   org:{org}:ai:reuse_result:{reusableResultId}
 *
 * ONE KEY PER IDENTITY, and that is the whole concurrency design. The record id
 * is a pure function of the exact reuse key (`identity/reuseIdentity.ts`), so
 * two isolates that computed the same identity write to the same key and the
 * compare-and-swap at expected version 0 — insert-if-absent — decides between
 * them in one storage operation. The loser reads the winner's record. There is
 * no pointer key to keep in step, no two-phase write, and therefore no window in
 * which a reader can observe half a population.
 *
 * ── INVALIDATION IS A COMPARE-AND-SWAP, NOT A DELETE ───────────────────────
 *
 * Stamping an invalidation swaps version 1 for version 2 on the same key. Two
 * operators invalidating at once resolve to ONE stamp with one reason, and the
 * loser is told it did not perform the stamp — which is what makes the
 * invalidation report's counts true rather than optimistic. There is no delete
 * method at all: the evidence behind any avoided-call accounting that cited the
 * record has to outlive the record's usefulness.
 *
 * ── SCANS ARE BOUNDED AND TENANT-SCOPED BY CONSTRUCTION ────────────────────
 *
 * Candidate discovery and dependency invalidation walk a prefix that cannot be
 * formed without its organization, so a scan for one tenant is literally unable
 * to return another's rows. The row cap is documented as a real limitation in
 * `ports.ts`: a deployment whose caches outgrow it wants a secondary index, not
 * a wider scan.
 */

import type { ReuseDependency } from '../contracts/dependency.ts';
import type {
  ReusableResultRecord,
  ReuseInvalidationReason,
} from '../contracts/reusableResult.ts';
import { isWholeReusableRecord } from '../contracts/reusableResult.ts';
import type {
  ReusableResultStore,
  ReusablePutOutcome,
  ReuseCandidateQuery,
} from './ports.ts';
import {
  MAX_SCAN_ROWS,
  boundedCandidateLimit,
  declaresDependency,
  invalidatedRecord,
  matchesCandidateQuery,
  sortCandidates,
} from './ports.ts';
import { reuseFailure } from '../contracts/failures.ts';
import { reusableResultIdFor } from '../identity/reuseIdentity.ts';
import { isolationKeyFor, tenantScopedKey } from '../../security/tenancy.ts';

export type KvReuseReader = (key: string) => Promise<unknown>;
export type KvReusePrefixReader = (prefix: string) => Promise<readonly unknown[]>;

/**
 * Atomic compare-and-swap keyed by a named version field.
 *
 * Contract: write `value` at `key` if and only if the stored record's
 * `versionField` equals `expectedVersion` — or, when `expectedVersion` is 0, if
 * and only if no record exists. Resolve true when the write happened and false
 * when the precondition did not hold. The comparison and the write MUST be one
 * storage operation.
 */
export type KvReuseConditionalWriter = (
  key: string,
  versionField: string,
  expectedVersion: number,
  value: unknown,
) => Promise<boolean>;

const NAMESPACE = 'reuse_result';
const VERSION_FIELD = 'recordVersion';

function scope(organizationId: string): { readonly isolationKey: string } {
  return { isolationKey: isolationKeyFor(organizationId) };
}

export function reusableResultKeyFor(
  organizationId: string,
  reusableResultId: string,
): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE, reusableResultId);
}

export function reusableResultPrefixFor(organizationId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE, 'x').slice(0, -1);
}

/**
 * A stored value may come back as an object or as a JSON string. Both are
 * handled so every consumer sees one shape, and an unreadable blob becomes
 * `undefined` rather than an exception — a corrupt row must not make an
 * unrelated tenant's cache unreadable.
 */
function coerce(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return undefined;
}

export interface KvReuseStoreOptions {
  readonly read: KvReuseReader;
  readonly readByPrefix: KvReusePrefixReader;
  readonly compareAndSwap: KvReuseConditionalWriter;
  /** Called when a stored record cannot be read. Loud, never silent. */
  readonly onCorrupt?: (key: string, detail: string) => void;
}

export function createKvReusableResultStore(
  options: KvReuseStoreOptions,
): ReusableResultStore {
  function parse(raw: unknown, key: string): ReusableResultRecord | undefined {
    const candidate = coerce(raw);
    if (candidate === undefined) {
      options.onCorrupt?.(key, 'stored reusable result is not a readable object');
      return undefined;
    }
    // A partially written or truncated record is dropped HERE rather than being
    // handed to the gate. The gate would refuse it too — `record_incomplete` —
    // but a store that returns rubbish makes every consumer responsible for
    // recognising rubbish.
    if (!isWholeReusableRecord(candidate)) {
      options.onCorrupt?.(key, 'stored reusable result is missing required fields');
      return undefined;
    }
    return candidate as unknown as ReusableResultRecord;
  }

  async function scan(organizationId: string): Promise<ReusableResultRecord[]> {
    const prefix = reusableResultPrefixFor(organizationId);
    const rows = await options.readByPrefix(prefix);
    const out: ReusableResultRecord[] = [];
    for (const row of rows) {
      const record = parse(row, prefix);
      if (record === undefined) continue;
      if (record.organizationId !== organizationId) {
        options.onCorrupt?.(prefix, 'stored reusable result does not match the prefix it was read from');
        continue;
      }
      out.push(record);
      if (out.length >= MAX_SCAN_ROWS) break;
    }
    return out;
  }

  return {
    async put(record): Promise<ReusablePutOutcome> {
      if (!isWholeReusableRecord(record)) {
        throw reuseFailure('reuse_input_invalid', 'That reusable result is not a whole record.', {
          diagnostics: `reusableResultId=${String(record.reusableResultId)}`,
        });
      }
      const key = reusableResultKeyFor(record.organizationId, record.reusableResultId);
      // Expected version 0 is insert-if-absent. This single call is what makes a
      // stampede resolve to one record: the write and the existence check are one
      // storage operation, so the loser cannot also have written.
      const won = await options.compareAndSwap(key, VERSION_FIELD, 0, record);
      if (won) {
        return { stored: true, reusableResultId: record.reusableResultId, record };
      }
      const existing = parse(await options.read(key), key);
      if (existing === undefined) {
        // The insert lost and yet nothing readable is there. That is a storage
        // fault rather than a race, and it must not be reported as a duplicate —
        // a duplicate outcome would hand the caller a record it did not get.
        throw reuseFailure(
          'reuse_record_immutable',
          'That reusable result could not be stored or read back.',
          { diagnostics: `insert-if-absent lost at ${key} but no record is readable` },
        );
      }
      return { stored: false, reusableResultId: existing.reusableResultId, record: existing };
    },

    async getById(organizationId, reusableResultId) {
      const key = reusableResultKeyFor(organizationId, reusableResultId);
      const record = parse(await options.read(key), key);
      if (record !== undefined && record.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored reusable result does not match the key it was read from');
        return undefined;
      }
      return record;
    },

    async findExact(organizationId, exactReuseKey) {
      // The record id is DERIVED from the exact key, so this is a point read
      // rather than a scan — the payoff for deriving the id instead of minting
      // one. The id is recomputed here rather than accepted from a caller, so a
      // caller cannot ask for one identity's record under another identity's key.
      const key = reusableResultKeyFor(organizationId, reusableResultIdFor(exactReuseKey));
      const record = parse(await options.read(key), key);
      if (record === undefined) return undefined;
      if (record.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored reusable result does not match the key it was read from');
        return undefined;
      }
      // The derived id got us here; the stored key must agree. A record whose
      // own `exactReuseKey` differs is a digest collision or an edited row, and
      // either way it is not the record this identity asked for.
      if (record.exactReuseKey !== exactReuseKey) {
        options.onCorrupt?.(key, 'stored reusable result carries a different exact reuse key');
        return undefined;
      }
      return record;
    },

    async findCandidates(query: ReuseCandidateQuery) {
      const matching = (await scan(query.organizationId)).filter((record) =>
        matchesCandidateQuery(record, query),
      );
      return sortCandidates(matching).slice(0, boundedCandidateLimit(query.limit));
    },

    async invalidate(
      organizationId: string,
      reusableResultId: string,
      at: number,
      reason: ReuseInvalidationReason,
    ) {
      const key = reusableResultKeyFor(organizationId, reusableResultId);
      const record = parse(await options.read(key), key);
      if (record === undefined) return false;
      if (record.organizationId !== organizationId) return false;
      if (record.invalidatedAt !== undefined) return false;
      // Compare-and-swap on the version the read observed. Two operators
      // invalidating at once resolve to ONE stamp; the loser is told it did not
      // perform it, which keeps the report's counts true rather than optimistic.
      return await options.compareAndSwap(
        key,
        VERSION_FIELD,
        record.recordVersion,
        invalidatedRecord(record, at, reason),
      );
    },

    async listByDependency(
      organizationId: string,
      dependency: Pick<ReuseDependency, 'kind' | 'key'>,
      limit?: number,
    ) {
      const matching = (await scan(organizationId)).filter((record) =>
        declaresDependency(record, dependency),
      );
      return sortCandidates(matching).slice(0, boundedCandidateLimit(limit));
    },
  };
}
