/**
 * The shadow reader — MCV2-S7.4.
 *
 * The runtime half: it races a relational read against a deadline, compares the
 * result with the KV answer that has ALREADY been decided, and records what it
 * found. It returns nothing a caller can serve, and that is deliberate — see
 * `contracts.ts` for the four invariants this module exists to hold.
 *
 * ── WHY `observe` TAKES THE KV RECORD RATHER THAN FETCHING IT ──────────────
 *
 * Because the route has already fetched it, and because a reader that fetched
 * its own copy could observe a different one. The point of a shadow read is to
 * compare the answer the caller was actually given against what the other store
 * holds; a second KV read would compare two answers, neither of which anybody
 * received.
 *
 * ── WHY IT IS AWAITED RATHER THAN FIRED AND FORGOTTEN ──────────────────────
 *
 * An edge isolate may be torn down the moment a response is returned, so
 * detached work is work that silently does not happen — and an instrument that
 * silently does not run is worse than no instrument, because the empty report
 * reads as agreement. So the read is awaited, and the cost of awaiting it is
 * bounded by a deadline the deployment sets. Off by default, 250 ms by default
 * when it is on.
 */

import type {
  DivergenceKind,
  DomainShadowSummary,
  FieldSpec,
  ShadowDomain,
  ShadowFailureKind,
  ShadowReadRecord,
  ShadowReadReport,
} from './contracts.ts';
import type { Projection } from './compare.ts';
import { compareProjections } from './compare.ts';

const DIVERGENCE_KINDS: readonly DivergenceKind[] = [
  'missing_in_sql',
  'missing_in_kv',
  'value_mismatch',
  'type_mismatch',
];

export interface ShadowReaderOptions {
  /**
   * Whether shadow reads run at all.
   *
   * A GETTER, not a value: the deployment switch is read at the point of use so
   * an operator turning it off stops the next read rather than the next deploy.
   */
  readonly enabled: () => boolean;
  /** Milliseconds the relational read may take before it is abandoned. */
  readonly deadlineMs: () => number;
  readonly now: () => number;
  readonly isoNow: () => string;
  /** Records retained. Older ones are dropped as newer ones arrive. */
  readonly capacity?: number;
  /**
   * Where a divergence is announced.
   *
   * Optional, and it receives field names and counts — never a value from
   * either store. See invariant 4.
   */
  readonly onDivergence?: (record: ShadowReadRecord) => void;
}

export interface ShadowObservation {
  readonly domain: ShadowDomain;
  readonly key: string;
  readonly fields: readonly FieldSpec[];
  /** The projection of the record the caller was actually served. */
  readonly kv: Projection;
  /**
   * The relational read. Called only when shadow reads are enabled, raced
   * against the deadline, and every rejection is absorbed.
   *
   * Returns `null` when the relational store holds no row for this key, which
   * is a first-class result rather than a failure — before a backfill it is the
   * expected one.
   */
  readonly loadSql: () => Promise<unknown>;
  /** How a relational row becomes a comparable projection. Pure. */
  readonly project: (row: unknown) => Projection;
}

export interface ShadowReader {
  /**
   * Take one shadow read.
   *
   * NEVER THROWS AND NEVER RETURNS ANYTHING TO SERVE. Resolves once the
   * comparison is recorded or abandoned. A disabled reader resolves immediately
   * without touching the relational store.
   */
  observe(observation: ShadowObservation): Promise<void>;
  report(recentLimit?: number): ShadowReadReport;
  reset(): void;
}

const DEFAULT_CAPACITY = 200;

export function createShadowReader(options: ShadowReaderOptions): ShadowReader {
  const capacity = Math.max(1, Math.trunc(options.capacity ?? DEFAULT_CAPACITY));
  const records: ShadowReadRecord[] = [];

  function push(record: ShadowReadRecord): void {
    records.push(record);
    while (records.length > capacity) records.shift();
    if (record.divergences.length > 0) options.onDivergence?.(record);
  }

  /**
   * The relational read, bounded.
   *
   * The losing promise is not cancellable — a Supabase query cannot be
   * withdrawn once issued — so the deadline bounds what the CALLER waits for
   * and not what the database does. That is the correct bound: the cost this
   * module must never impose is latency on a user's request. A late result is
   * discarded, and its rejection is absorbed here rather than surfacing as an
   * unhandled rejection after the request has gone.
   */
  async function loadWithinDeadline(
    load: () => Promise<unknown>,
    deadlineMs: number,
  ): Promise<{ row: unknown } | { failure: ShadowFailureKind }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<{ failure: ShadowFailureKind }>((resolve) => {
      timer = setTimeout(() => resolve({ failure: 'timeout' }), Math.max(1, deadlineMs));
    });

    const attempt = load().then(
      (row) => ({ row }),
      () => ({ failure: 'error' as const }),
    );

    try {
      return await Promise.race([attempt, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    async observe(observation) {
      if (!options.enabled()) return;

      const startedAtMs = options.now();
      let outcome: { row: unknown } | { failure: ShadowFailureKind };
      try {
        outcome = await loadWithinDeadline(observation.loadSql, options.deadlineMs());
      } catch {
        // `loadWithinDeadline` absorbs the load's own rejection, so reaching
        // here means the reader itself misbehaved. It is still not permitted to
        // reach the route.
        outcome = { failure: 'error' };
      }

      const durationMs = Math.max(0, options.now() - startedAtMs);

      if ('failure' in outcome) {
        push({
          domain: observation.domain,
          key: observation.key,
          observedAt: options.isoNow(),
          durationMs,
          failure: outcome.failure,
          divergences: [],
          fieldsCompared: 0,
        });
        return;
      }

      if (outcome.row === null || outcome.row === undefined) {
        push({
          domain: observation.domain,
          key: observation.key,
          observedAt: options.isoNow(),
          durationMs,
          failure: 'row_absent',
          divergences: [],
          fieldsCompared: 0,
        });
        return;
      }

      // The comparison itself is pure and cannot throw, but it is wrapped
      // anyway: this module's contract is that a route calling it cannot fail
      // because of it, and a contract that depends on another module staying
      // total is a contract with a dependency nobody re-checks.
      let divergences: readonly { field: string; kind: DivergenceKind }[] = [];
      try {
        divergences = compareProjections(
          observation.fields,
          observation.kv,
          observation.project(outcome.row),
        );
      } catch {
        push({
          domain: observation.domain,
          key: observation.key,
          observedAt: options.isoNow(),
          durationMs,
          failure: 'error',
          divergences: [],
          fieldsCompared: 0,
        });
        return;
      }

      push({
        domain: observation.domain,
        key: observation.key,
        observedAt: options.isoNow(),
        durationMs,
        divergences,
        fieldsCompared: observation.fields.length,
      });
    },

    report(recentLimit = 50) {
      const bounded = Math.min(Math.max(Math.trunc(recentLimit) || 50, 1), capacity);
      const domains = new Map<ShadowDomain, ShadowReadRecord[]>();
      for (const record of records) {
        const bucket = domains.get(record.domain) ?? [];
        bucket.push(record);
        domains.set(record.domain, bucket);
      }

      return {
        enabled: options.enabled(),
        deadlineMs: options.deadlineMs(),
        generatedAt: options.isoNow(),
        domains: [...domains.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([domain, bucket]) => summarize(domain, bucket)),
        recent: [...records].reverse().slice(0, bounded),
      };
    },

    reset() {
      records.length = 0;
    },
  };
}

function summarize(domain: ShadowDomain, records: readonly ShadowReadRecord[]): DomainShadowSummary {
  const byField: Record<string, number> = {};
  const byKind = Object.fromEntries(DIVERGENCE_KINDS.map((kind) => [kind, 0])) as Record<
    DivergenceKind,
    number
  >;

  let agreed = 0;
  let diverged = 0;
  let rowAbsent = 0;
  let timeouts = 0;
  let errors = 0;

  for (const record of records) {
    if (record.failure === 'row_absent') {
      rowAbsent += 1;
      continue;
    }
    if (record.failure === 'timeout') {
      timeouts += 1;
      continue;
    }
    if (record.failure === 'error') {
      errors += 1;
      continue;
    }
    if (record.divergences.length === 0) {
      agreed += 1;
      continue;
    }
    diverged += 1;
    for (const divergence of record.divergences) {
      byField[divergence.field] = (byField[divergence.field] ?? 0) + 1;
      byKind[divergence.kind] += 1;
    }
  }

  // The denominator is reads where a comparison was POSSIBLE. Counting a
  // timeout or an absent row as agreement would report a migration as healthy
  // precisely when the instrument had stopped working.
  const comparable = agreed + diverged;

  return {
    domain,
    reads: records.length,
    agreed,
    diverged,
    rowAbsent,
    timeouts,
    errors,
    byField,
    byKind,
    mismatchRatePercent:
      comparable === 0 ? null : Math.round((diverged / comparable) * 1000) / 10,
  };
}
