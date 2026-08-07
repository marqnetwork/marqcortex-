/**
 * The reusable result storage port (AI-01 Batch 3B, Part 6B).
 *
 * ── NARROW ON PURPOSE ──────────────────────────────────────────────────────
 *
 * Six methods, and every one of them takes an organization. There is no
 * unscoped read, no "list all", no delete and no update-in-place — the only
 * mutation after creation is `invalidate`, which stamps a record it does not
 * rewrite.
 *
 * The absence of a general `save` is the immutability guarantee, in the same
 * shape the workflow checkpoint store uses: a record that can be overwritten is
 * a record whose digest proves nothing, and the digest is the only reason a
 * consumer can trust what comes back.
 *
 * ── INSERT-IF-ABSENT IS THE CONCURRENCY MODEL ──────────────────────────────
 *
 * `put` is insert-if-absent on the derived record id, which is a pure function
 * of the exact reuse key. Two isolates that finish the same inference at the
 * same moment compute the same id and race on one storage key: one stores, the
 * other is told `duplicate` and handed the winner's record. There is no merge
 * step, so there is no blended record; there is no read-then-write, so there is
 * no window in which a reader sees half of one.
 *
 * That is deliberately NOT a distributed lock and deliberately NOT a job
 * scheduler. Both isolates already paid for their inference by the time they
 * reach `put` — the duplicate work happened upstream and this layer cannot undo
 * it. What it can guarantee is that duplicate work does not become duplicate
 * TRUTH, which is the part that would corrupt the accounting.
 *
 * ── FAILURE DEGRADES, IT DOES NOT ESCALATE ─────────────────────────────────
 *
 * A store that is unavailable must produce a MISS, not an outage. The pipeline
 * catches everything these methods can throw and converts it to
 * `store_unavailable`, because the fallback — Part 6A and the Control Plane —
 * is a completely working system that merely costs money.
 */

import type { ReuseDependency } from '../contracts/dependency.ts';
import { dependencyId } from '../contracts/dependency.ts';
import type {
  ReusableResultRecord,
  ReuseInvalidationReason,
} from '../contracts/reusableResult.ts';
import { isWholeReusableRecord } from '../contracts/reusableResult.ts';
import { reusableResultIdFor } from '../identity/reuseIdentity.ts';
import { reuseFailure } from '../contracts/failures.ts';

/**
 * What happened to a `put`.
 *
 * `duplicate` is not an error. It is the expected outcome of the stampede case
 * and the caller's cue to use `existing` rather than its own copy — so that two
 * isolates that raced converge on ONE record with ONE id, which is what keeps
 * later avoided-call attribution single-valued.
 */
export interface ReusablePutOutcome {
  readonly stored: boolean;
  readonly reusableResultId: string;
  /** The record now in storage. The winner's, when `stored` is false. */
  readonly record: ReusableResultRecord;
}

/** Candidate discovery filter. Organization is required; there is no global scan. */
export interface ReuseCandidateQuery {
  readonly organizationId: string;
  /** Restrict to one coarse task fingerprint. */
  readonly taskFingerprint?: string;
  /** Restrict to one declared semantic class. */
  readonly semanticClass?: string;
  /** Restrict to one declared task identity. */
  readonly taskIdentity?: string;
  readonly limit?: number;
}

export interface ReusableResultStore {
  /** Insert if absent. Never overwrites, never merges. */
  put(record: ReusableResultRecord): Promise<ReusablePutOutcome>;
  /** One record by id, scoped to a tenant. Never another tenant's. */
  getById(
    organizationId: string,
    reusableResultId: string,
  ): Promise<ReusableResultRecord | undefined>;
  /** The exact-identity lookup. One key, one record. */
  findExact(
    organizationId: string,
    exactReuseKey: string,
  ): Promise<ReusableResultRecord | undefined>;
  /** Candidates for semantic discovery. Bounded, tenant-scoped, never global. */
  findCandidates(query: ReuseCandidateQuery): Promise<readonly ReusableResultRecord[]>;
  /**
   * Stamp a record invalidated. Idempotent: an already-invalidated record is
   * left exactly as it was, with its original reason and time.
   *
   * Resolves true when this call performed the stamp, false when it did not —
   * either because the record was already invalidated or because it lost a
   * concurrent write. There is no method that CLEARS an invalidation, and that
   * absence is what makes "an invalidated result can never become valid again"
   * a property of the contract rather than a convention.
   */
  invalidate(
    organizationId: string,
    reusableResultId: string,
    at: number,
    reason: ReuseInvalidationReason,
  ): Promise<boolean>;
  /** Records declaring a dependency on `kind:key`. Tenant-scoped and bounded. */
  listByDependency(
    organizationId: string,
    dependency: Pick<ReuseDependency, 'kind' | 'key'>,
    limit?: number,
  ): Promise<readonly ReusableResultRecord[]>;
}

export const DEFAULT_CANDIDATE_LIMIT = 25;
export const MAX_CANDIDATE_LIMIT = 100;
/**
 * The ceiling on rows any single scan will consider.
 *
 * Candidate discovery and dependency invalidation both walk a tenant's records.
 * A cap is not an optimisation here, it is a refusal to let one tenant's cache
 * size determine another request's latency — and it is an honest limitation:
 * a deployment whose caches outgrow this wants a secondary index, which is a
 * storage change rather than a change to any of the logic above.
 */
export const MAX_SCAN_ROWS = 1_000;

export function boundedCandidateLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_CANDIDATE_LIMIT;
  return Math.min(MAX_CANDIDATE_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Does a record match a candidate query?
 *
 * Shared by both implementations so a filter cannot mean one thing in memory and
 * another in storage — the same reason the workflow stores share theirs.
 *
 * Invalidated and expired records are NOT filtered here. Discovery finds them
 * and the gate refuses them, which is what makes `stale_miss` and
 * `invalidated_miss` observable in the economics rather than silently absent.
 */
export function matchesCandidateQuery(
  record: ReusableResultRecord,
  query: ReuseCandidateQuery,
): boolean {
  if (record.organizationId !== query.organizationId) return false;
  if (query.taskFingerprint !== undefined && record.taskFingerprint !== query.taskFingerprint) {
    return false;
  }
  if (query.taskIdentity !== undefined && record.taskIdentity !== query.taskIdentity) return false;
  if (query.semanticClass !== undefined) {
    if (record.semantic === undefined) return false;
    if (record.semantic.semanticClass !== query.semanticClass) return false;
  }
  return true;
}

/**
 * The deterministic candidate ordering.
 *
 * Newest validated first, ties broken on id. Both implementations sort this way
 * so "which candidates did discovery see" does not depend on which store is
 * wired up — a suite that passed in memory and failed in storage because the
 * order differed would be testing the wrong thing.
 */
export function sortCandidates(
  records: readonly ReusableResultRecord[],
): readonly ReusableResultRecord[] {
  return [...records].sort(
    (a, b) =>
      b.validatedAt - a.validatedAt ||
      (a.reusableResultId < b.reusableResultId
        ? -1
        : a.reusableResultId > b.reusableResultId
          ? 1
          : 0),
  );
}

export function declaresDependency(
  record: ReusableResultRecord,
  dependency: Pick<ReuseDependency, 'kind' | 'key'>,
): boolean {
  const id = `${dependency.kind}:${dependency.key}`;
  return [...record.evidenceDependencies, ...record.dataDependencies].some(
    (declared) => dependencyId(declared) === id,
  );
}

/** The invalidated form of a record. Stamped, never rewritten. */
export function invalidatedRecord(
  record: ReusableResultRecord,
  at: number,
  reason: ReuseInvalidationReason,
): ReusableResultRecord {
  return {
    ...record,
    invalidatedAt: Math.floor(at),
    invalidationReason: reason,
    recordVersion: record.recordVersion + 1,
  };
}

// ── In-memory implementation ────────────────────────────────────────────────

/**
 * An in-process store, correct for tests and for a single isolate.
 *
 * It satisfies the SAME contract as the durable one and the durability suite
 * runs the same assertions against both, so a behaviour that holds here is a
 * behaviour the platform can rely on — rather than a behaviour that held until
 * the first deployment with two isolates.
 */
export function createInMemoryReusableResultStore(): ReusableResultStore {
  const records = new Map<string, ReusableResultRecord>();

  const keyFor = (organizationId: string, reusableResultId: string): string =>
    `${organizationId} ${reusableResultId}`;

  const scan = (organizationId: string): ReusableResultRecord[] => {
    const out: ReusableResultRecord[] = [];
    for (const record of records.values()) {
      if (record.organizationId !== organizationId) continue;
      out.push(record);
      if (out.length >= MAX_SCAN_ROWS) break;
    }
    return out;
  };

  return {
    put(record) {
      if (!isWholeReusableRecord(record)) {
        throw reuseFailure('reuse_input_invalid', 'That reusable result is not a whole record.', {
          diagnostics: `reusableResultId=${String(record.reusableResultId)}`,
        });
      }
      const key = keyFor(record.organizationId, record.reusableResultId);
      const existing = records.get(key);
      if (existing !== undefined) {
        return Promise.resolve({
          stored: false,
          reusableResultId: existing.reusableResultId,
          record: existing,
        });
      }
      records.set(key, record);
      return Promise.resolve({
        stored: true,
        reusableResultId: record.reusableResultId,
        record,
      });
    },

    getById(organizationId, reusableResultId) {
      const record = records.get(keyFor(organizationId, reusableResultId));
      // Belt and braces: the key already scopes the read. A record disagreeing
      // with its own key is corrupt, not a cross-tenant read.
      if (record !== undefined && record.organizationId !== organizationId) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(record);
    },

    findExact(organizationId, exactReuseKey) {
      // A point read on the DERIVED id, matching the durable store exactly. Both
      // implementations resolve the same identity the same way, so a suite that
      // passes in memory is a suite about the contract rather than about the map.
      const record = records.get(keyFor(organizationId, reusableResultIdFor(exactReuseKey)));
      if (record === undefined) return Promise.resolve(undefined);
      if (record.organizationId !== organizationId) return Promise.resolve(undefined);
      if (record.exactReuseKey !== exactReuseKey) return Promise.resolve(undefined);
      return Promise.resolve(record);
    },

    findCandidates(query) {
      const matching = scan(query.organizationId).filter((record) =>
        matchesCandidateQuery(record, query),
      );
      return Promise.resolve(
        sortCandidates(matching).slice(0, boundedCandidateLimit(query.limit)),
      );
    },

    invalidate(organizationId, reusableResultId, at, reason) {
      const key = keyFor(organizationId, reusableResultId);
      const record = records.get(key);
      if (record === undefined) return Promise.resolve(false);
      if (record.organizationId !== organizationId) return Promise.resolve(false);
      // Idempotent. The first invalidation's reason and time are the record of
      // what happened; a second call must not restate it as something else.
      if (record.invalidatedAt !== undefined) return Promise.resolve(false);
      records.set(key, invalidatedRecord(record, at, reason));
      return Promise.resolve(true);
    },

    listByDependency(organizationId, dependency, limit) {
      const matching = scan(organizationId).filter((record) =>
        declaresDependency(record, dependency),
      );
      return Promise.resolve(sortCandidates(matching).slice(0, boundedCandidateLimit(limit)));
    },
  };
}
