/**
 * Runtime storage shadow read — contracts. MCV2-S7.4.
 *
 * ── WHAT A SHADOW READ IS, AND THE FOUR THINGS IT MAY NEVER DO ─────────────
 *
 * The migration roadmap's Phase 3 is dual-read: serve from one store, read the
 * other alongside it, and measure whether they agree. A SHADOW read is the
 * strictly weaker half of that, and it is the half that is safe to run against
 * production while KV is still authoritative:
 *
 *   1. IT NEVER CHANGES WHAT IS SERVED. The KV answer is computed, returned,
 *      and only then compared. There is no branch in which a SQL row reaches a
 *      response body, and no exported function returns one to a route.
 *
 *   2. IT NEVER FAILS A REQUEST. Every error — a missing table, a revoked
 *      grant, a malformed row, a network fault — is caught and RECORDED. A
 *      measurement that can take a route down is not a measurement.
 *
 *   3. IT NEVER RUNS UNBOUNDED. The SQL read is raced against a deadline. A
 *      slow relational read must cost the caller a bounded number of
 *      milliseconds and then be abandoned, recorded as a timeout.
 *
 *   4. IT NEVER RECORDS A CUSTOMER VALUE. A divergence record carries the
 *      FIELD NAME and the KIND of divergence and nothing else. The report is
 *      read by platform operators across every tenant, and the tenant-scoping
 *      around it is only as good as the absence of anything worth scoping.
 *
 * ── WHY `missing_in_sql` IS A FIRST-CLASS RESULT AND NOT AN ERROR ──────────
 *
 * The outcome backfill has not been written — S6.2 delivered the lead and
 * contact slice and deferred the rest. So on the day this ships, a shadow read
 * of a real deployment reports `missing_in_sql` for essentially every record,
 * and that is the CORRECT answer rather than a fault. It is also the number the
 * backfill will be judged by: S7.5 validates this instrument's output, and an
 * instrument that reported "error" for the expected state would be useless for
 * exactly the sprint it exists to serve.
 */

/** Domains a shadow read can be taken for. One per KV prefix under migration. */
export type ShadowDomain = 'outcome';

/**
 * How two sides of one field disagree.
 *
 * `absent_both` is deliberately NOT a divergence: a field neither store carries
 * is a field neither store is wrong about.
 */
export type DivergenceKind =
  /** Present in KV, absent in SQL. Before a backfill this is expected. */
  | 'missing_in_sql'
  /** Present in SQL, absent in KV. After a backfill this is a real defect. */
  | 'missing_in_kv'
  /** Both present, different values. */
  | 'value_mismatch'
  /** Both present, values of different shapes — a mapping defect, not drift. */
  | 'type_mismatch';

/** One field's verdict. Carries no value from either store. */
export interface FieldDivergence {
  readonly field: string;
  readonly kind: DivergenceKind;
}

/** Why a comparison could not be made at all. */
export type ShadowFailureKind =
  /** The relational read exceeded its deadline and was abandoned. */
  | 'timeout'
  /** The relational read threw. */
  | 'error'
  /** The relational store holds no row for this key at all. */
  | 'row_absent';

/**
 * One shadow read, as recorded.
 *
 * `key` is the KV key — `outcome:<submissionId>` — which is an internal
 * identifier and not customer content. It is what makes a divergence
 * investigable at all: a report of "three conversionValue mismatches" that
 * cannot say WHICH records is a report nobody can act on.
 */
export interface ShadowReadRecord {
  readonly domain: ShadowDomain;
  readonly key: string;
  readonly observedAt: string;
  /** Milliseconds the relational read took, bounded by the deadline. */
  readonly durationMs: number;
  /** Absent when the comparison was made. */
  readonly failure?: ShadowFailureKind;
  /** Empty when both stores agreed on every compared field. */
  readonly divergences: readonly FieldDivergence[];
  /** Fields compared, so a rate has a denominator. */
  readonly fieldsCompared: number;
}

export interface DomainShadowSummary {
  readonly domain: ShadowDomain;
  readonly reads: number;
  /** Reads where a comparison was made and every field agreed. */
  readonly agreed: number;
  /** Reads where a comparison was made and at least one field diverged. */
  readonly diverged: number;
  readonly rowAbsent: number;
  readonly timeouts: number;
  readonly errors: number;
  /**
   * Divergences per field, so the report says WHICH field is drifting.
   * Field names are schema, never data.
   */
  readonly byField: Readonly<Record<string, number>>;
  readonly byKind: Readonly<Record<DivergenceKind, number>>;
  /**
   * Diverged reads as a percentage of reads where a comparison was possible,
   * to one decimal place. `null` when nothing was comparable — which is
   * honest, and is the state before a backfill.
   */
  readonly mismatchRatePercent: number | null;
}

export interface ShadowReadReport {
  readonly enabled: boolean;
  readonly deadlineMs: number;
  readonly generatedAt: string;
  readonly domains: readonly DomainShadowSummary[];
  /** Most recent records, newest first. Bounded. */
  readonly recent: readonly ShadowReadRecord[];
}

/**
 * A field's comparison rule.
 *
 * Declared per field rather than inferred, because the two stores encode the
 * same fact differently and guessing at that is how a comparator reports drift
 * that is really a formatting difference:
 *
 *   `exact`      strict equality after both sides are normalised to a
 *                primitive. Booleans and identifiers.
 *   `numeric`    compared as numbers, so PostgreSQL `numeric` arriving as the
 *                string "1500.00" agrees with the JSON number 1500.
 *   `timestamp`  compared at SECOND precision. A timestamptz round-trip does
 *                not preserve the millisecond an ISO string carried, and a
 *                comparator that called that a mismatch would report 100%
 *                drift on correctly migrated data.
 *   `text`       trimmed; empty string and null are the same absence, because
 *                KV writes `''` where the relational column is NULL.
 */
export type FieldRule = 'exact' | 'numeric' | 'timestamp' | 'text';

export interface FieldSpec {
  readonly field: string;
  readonly rule: FieldRule;
}
