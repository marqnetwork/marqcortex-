/**
 * Read authority — the Phase 5 cutover mechanism (MCV2-S8.1).
 *
 * The shadow read (S7.4) answers "do the two stores agree?" and deliberately
 * returns nothing, because KV is authoritative and an instrument must not be
 * able to change what is served. THIS module is the other half: the one place
 * that may decide a relational row answers a request instead.
 *
 * It is the whole of the cutover. There is no other path by which a relational
 * record can reach a response body, which is what makes the rollout reviewable
 * and the rollback a single switch rather than a deploy.
 *
 * ── THE FOUR INVARIANTS ────────────────────────────────────────────────────
 *
 *   1. OFF IS UNCHANGED. With the switch off the KV record is returned by
 *      identity — not re-derived, not re-projected, not round-tripped. A
 *      deployment that has not opted in behaves byte-for-byte as it did before
 *      this module existed.
 *
 *   2. IT NEVER FAILS A REQUEST. Every relational failure — no credentials, a
 *      timeout, a thrown driver error, a row that is not there — resolves to
 *      the KV record and a recorded reason. A cutover that could 500 is not a
 *      cutover; it is an outage with a feature flag.
 *
 *   3. IT NEVER RUNS UNBOUNDED. The relational read is raced against the same
 *      deadline the shadow read uses. Past it the KV record wins and the
 *      attempt is recorded as `timeout`.
 *
 *   4. IT RECORDS WHICH STORE ANSWERED, AND NEVER THE VALUE. An operator
 *      rolling this out needs to know how often SQL actually served and how
 *      often it fell back, per domain. Customer values stay out of the record
 *      for the same reason they stay out of the shadow read's.
 *
 * ── WHY FALLBACK IS THE DEFAULT AND NOT AN OPTION ──────────────────────────
 *
 * During a rollout the relational store is behind by construction: the backfill
 * runs, traffic continues, and some rows are not there yet. Serving `null`
 * because SQL had not caught up would present a deleted record to a customer
 * whose data is intact in KV. So a missing relational row is a FALLBACK, not an
 * answer — and it is counted, because "SQL served 60% and fell back 40%" is the
 * number that decides whether the cutover is ready.
 *
 * A deployment that wants the stricter behaviour — serve what SQL says, absence
 * included — is asking for S8.3 (KV retirement), which is a different decision
 * with a different switch, and is deliberately not expressible here.
 */

import type { FieldSpec } from './contracts.ts';
import type { Projection } from './compare.ts';
import { compareProjections } from './compare.ts';

/** The domains a cutover can be switched on for, independently. */
export type AuthorityDomain = 'outcome' | 'submission';

/** Which store actually answered, and why. */
export type AuthoritySource =
  | 'kv'
  /** The relational row answered. */
  | 'sql'
  /** SQL was authoritative but had no row; KV answered. */
  | 'fallback_missing'
  /** SQL was authoritative but did not answer in time; KV answered. */
  | 'fallback_timeout'
  /** SQL was authoritative but the read failed; KV answered. */
  | 'fallback_error';

export interface AuthorityRecord {
  readonly domain: AuthorityDomain;
  /** The record's key. An identifier, never a value from either store. */
  readonly key: string;
  readonly source: AuthoritySource;
  readonly durationMs: number;
  readonly observedAt: string;
  /**
   * Whether the row SQL served also agreed with KV on every declared field.
   * Only meaningful when `source` is `sql`; `undefined` otherwise.
   *
   * This is the cutover's own safety net. The reconciliation and the shadow
   * read both sample; this sees every request that SQL answered, and a
   * divergence here means the store now answering customers disagrees with the
   * one that used to.
   */
  readonly agreedWithKv?: boolean;
  /** Field names only, when it did not agree. Never a value. */
  readonly divergentFields?: readonly string[];
}

export interface AuthorityDomainSummary {
  readonly domain: AuthorityDomain;
  readonly total: number;
  readonly servedBySql: number;
  readonly servedByKv: number;
  readonly fallbackMissing: number;
  readonly fallbackTimeout: number;
  readonly fallbackError: number;
  /** Of the reads SQL served, how many also agreed with KV. */
  readonly sqlAgreed: number;
  readonly sqlDiverged: number;
}

export interface AuthorityReport {
  readonly domains: readonly AuthorityDomainSummary[];
  readonly recent: readonly AuthorityRecord[];
}

export interface ReadAuthorityOptions {
  /** Read at the point of use, so a switch takes effect on the next read. */
  authoritative: (domain: AuthorityDomain) => boolean;
  deadlineMs: () => number;
  now: () => number;
  isoNow: () => string;
  capacity?: number;
  /** Called for every fallback and every divergence. Never for a plain KV read. */
  onNotice?: (record: AuthorityRecord) => void;
}

export interface ResolveRequest<TRecord> {
  readonly domain: AuthorityDomain;
  readonly key: string;
  /** The record KV holds — what would have been served before the cutover. */
  readonly kv: TRecord;
  readonly fields: readonly FieldSpec[];
  /** The relational row, or `null` when there is none. */
  loadSql: () => Promise<unknown>;
  /** The relational row, in the shape a response body uses. */
  toRecord: (row: unknown) => TRecord;
  projectKv: (record: TRecord) => Projection;
  projectSql: (row: unknown) => Projection;
}

export interface Resolution<TRecord> {
  readonly record: TRecord;
  readonly source: AuthoritySource;
}

export interface ReadAuthority {
  resolve<TRecord>(request: ResolveRequest<TRecord>): Promise<Resolution<TRecord>>;
  authoritative(domain: AuthorityDomain): boolean;
  report(recentLimit?: number): AuthorityReport;
  reset(): void;
}

const DEFAULT_CAPACITY = 200;
const TIMED_OUT = Symbol('timed-out');

export function createReadAuthority(options: ReadAuthorityOptions): ReadAuthority {
  const capacity = Math.max(1, Math.trunc(options.capacity ?? DEFAULT_CAPACITY));
  const records: AuthorityRecord[] = [];

  function push(record: AuthorityRecord): void {
    records.push(record);
    while (records.length > capacity) records.shift();
    if (record.source !== 'kv' && record.source !== 'sql') options.onNotice?.(record);
    else if (record.source === 'sql' && record.agreedWithKv === false) options.onNotice?.(record);
  }

  async function withDeadline(load: () => Promise<unknown>, ms: number): Promise<unknown> {
    let timer: number | undefined;
    try {
      return await Promise.race([
        load(),
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), ms) as unknown as number;
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    authoritative: (domain) => options.authoritative(domain),

    async resolve<TRecord>(request: ResolveRequest<TRecord>): Promise<Resolution<TRecord>> {
      // Invariant 1. Not merely an optimisation: returning `request.kv` by
      // identity is what makes "off" indistinguishable from "absent".
      if (!options.authoritative(request.domain)) {
        return { record: request.kv, source: 'kv' };
      }

      const started = options.now();
      let source: AuthoritySource;
      let record: TRecord = request.kv;
      let agreedWithKv: boolean | undefined;
      let divergentFields: readonly string[] | undefined;

      try {
        const row = await withDeadline(request.loadSql, options.deadlineMs());
        if (row === TIMED_OUT) {
          source = 'fallback_timeout';
        } else if (row === null || row === undefined) {
          source = 'fallback_missing';
        } else {
          record = request.toRecord(row);
          source = 'sql';
          // Invariant 4's other half: SQL is answering customers now, so every
          // one of those answers is checked against what KV would have said.
          const divergences = compareProjections(
            request.fields,
            request.projectKv(request.kv),
            request.projectSql(row),
          );
          agreedWithKv = divergences.length === 0;
          if (!agreedWithKv) divergentFields = divergences.map((entry) => entry.field);
        }
      } catch {
        // Invariant 2. The error is deliberately not carried into the record:
        // a driver message can quote a value, and this record is written on
        // every request.
        source = 'fallback_error';
      }

      push({
        domain: request.domain,
        key: request.key,
        source,
        durationMs: Math.max(0, options.now() - started),
        observedAt: options.isoNow(),
        ...(agreedWithKv === undefined ? {} : { agreedWithKv }),
        ...(divergentFields === undefined ? {} : { divergentFields }),
      });

      return { record, source };
    },

    report(recentLimit = 50) {
      const bounded = Math.min(Math.max(Math.trunc(recentLimit) || 50, 1), capacity);
      const byDomain = new Map<AuthorityDomain, AuthorityRecord[]>();
      for (const entry of records) {
        const bucket = byDomain.get(entry.domain) ?? [];
        bucket.push(entry);
        byDomain.set(entry.domain, bucket);
      }

      const domains: AuthorityDomainSummary[] = [];
      for (const [domain, entries] of byDomain) {
        const count = (source: AuthoritySource) =>
          entries.filter((entry) => entry.source === source).length;
        const sql = entries.filter((entry) => entry.source === 'sql');
        domains.push({
          domain,
          total: entries.length,
          servedBySql: sql.length,
          servedByKv: entries.length - sql.length,
          fallbackMissing: count('fallback_missing'),
          fallbackTimeout: count('fallback_timeout'),
          fallbackError: count('fallback_error'),
          sqlAgreed: sql.filter((entry) => entry.agreedWithKv === true).length,
          sqlDiverged: sql.filter((entry) => entry.agreedWithKv === false).length,
        });
      }
      domains.sort((left, right) => left.domain.localeCompare(right.domain));

      return { domains, recent: records.slice(-bounded) };
    },

    reset() {
      records.length = 0;
    },
  };
}
