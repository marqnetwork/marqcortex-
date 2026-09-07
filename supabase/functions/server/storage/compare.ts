/**
 * The shadow-read comparator — MCV2-S7.4.
 *
 * Pure. Two projections in, a list of field verdicts out. No clock, no client,
 * no storage and no logging, so every comparison rule in the migration is
 * testable without a database and reproducible from a record.
 *
 * ── THE COMPARATOR'S ONE JOB IS TO BE BORING ───────────────────────────────
 *
 * The failure mode of a dual-read comparator is not that it misses drift. It is
 * that it reports drift that is really an encoding difference — a timestamptz
 * that lost a millisecond, a `numeric` that arrived as a string, a NULL column
 * where KV wrote an empty string — and buries the three real divergences under
 * ten thousand false ones. A comparator nobody trusts gets switched off, and
 * then the migration proceeds with no instrument at all.
 *
 * So every field declares its rule, the rules are few, and each one exists
 * because the two stores genuinely encode that fact differently. There is no
 * "close enough" rule and no tolerance: two numbers either are equal or they
 * are not.
 */

import type { DivergenceKind, FieldDivergence, FieldSpec } from './contracts.ts';

/** A comparable projection of one record. Values only, no nesting. */
export type Projection = Readonly<Record<string, unknown>>;

/**
 * Absence, canonically.
 *
 * `null`, `undefined` and the empty string are ONE state, because the two
 * stores spell it three ways: KV writes `''` for an unset text field and `null`
 * for an unset number, and the relational column is NULL for both. Treating
 * those as different values would report drift on every record that simply has
 * nothing in the field.
 */
function absent(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

/** Seconds since the epoch, or `null` when the value is not a timestamp. */
function toEpochSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value / 1000);
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

/** A finite number, or `null`. Accepts the string form PostgreSQL sends. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Compare one field under its declared rule.
 *
 * Returns the divergence kind, or `null` when the two sides agree. A rule that
 * cannot interpret one side returns `type_mismatch` rather than
 * `value_mismatch`: those are different bugs — the first is a mapping defect in
 * this repository, the second is real drift between the stores — and an
 * operator sent to the wrong one wastes the time the instrument was meant to
 * save.
 */
export function compareField(
  rule: FieldSpec['rule'],
  kvValue: unknown,
  sqlValue: unknown,
): DivergenceKind | null {
  const kvAbsent = absent(kvValue);
  const sqlAbsent = absent(sqlValue);

  // Neither store carries it. Neither store is wrong about it.
  if (kvAbsent && sqlAbsent) return null;
  if (kvAbsent) return 'missing_in_kv';
  if (sqlAbsent) return 'missing_in_sql';

  switch (rule) {
    case 'timestamp': {
      const left = toEpochSeconds(kvValue);
      const right = toEpochSeconds(sqlValue);
      if (left === null || right === null) return 'type_mismatch';
      // SECOND precision. A timestamptz round-trip does not preserve the
      // millisecond an ISO string carried, and calling that a mismatch would
      // report total drift on correctly migrated data.
      return left === right ? null : 'value_mismatch';
    }
    case 'numeric': {
      const left = toNumber(kvValue);
      const right = toNumber(sqlValue);
      if (left === null || right === null) return 'type_mismatch';
      return left === right ? null : 'value_mismatch';
    }
    case 'text': {
      if (typeof kvValue !== 'string' || typeof sqlValue !== 'string') return 'type_mismatch';
      return kvValue.trim() === sqlValue.trim() ? null : 'value_mismatch';
    }
    case 'exact': {
      if (typeof kvValue !== typeof sqlValue) return 'type_mismatch';
      return kvValue === sqlValue ? null : 'value_mismatch';
    }
  }
}

/**
 * Compare two projections across a declared field set.
 *
 * The FIELD SET is the contract, not the union of whatever keys the two objects
 * happen to have. A comparator that walked the keys it found would silently
 * stop checking a field the day a mapping dropped it, and report perfect
 * agreement for the rest of the migration.
 */
export function compareProjections(
  fields: readonly FieldSpec[],
  kv: Projection,
  sql: Projection,
): readonly FieldDivergence[] {
  const divergences: FieldDivergence[] = [];
  for (const spec of fields) {
    const kind = compareField(spec.rule, kv[spec.field], sql[spec.field]);
    if (kind !== null) divergences.push({ field: spec.field, kind });
  }
  return divergences;
}
