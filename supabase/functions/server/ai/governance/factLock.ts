/**
 * Fact Lock — the structural guarantee behind Constitution Article 6.
 *
 * "Math decides priority. LLM only explains decisions." Prompt instructions
 * asking a model not to change a number are advisory; a model that ignores them
 * produces a proposal with a price the consultancy never quoted. The fact lock
 * makes the guarantee structural instead: after generation, every locked field
 * is overwritten with its authoritative value, unconditionally.
 *
 * Two properties matter and are tested directly:
 *
 *   Unconditional  The restore runs whether or not the model appears to have
 *                  complied. There is no "looks unchanged, skip it" path — that
 *                  would be a comparison the model could influence.
 *
 *   Reported       Every field that had to be put back is named in the result
 *                  and in the audit record, so a model drifting toward
 *                  overwriting commercial terms is visible in telemetry rather
 *                  than silently corrected forever.
 */

export interface FactLockResult<T> {
  readonly content: T;
  /** Fields whose value the model changed and the platform restored. */
  readonly restored: readonly string[];
}

/**
 * Restore locked fields on a generated object from the authoritative source.
 *
 * A locked field absent from the authoritative object is skipped: there is
 * nothing authoritative to protect, and inventing `undefined` would delete a
 * field the model legitimately produced.
 */
export function enforceFactLock<T extends Record<string, unknown>>(
  proposed: T,
  authoritative: Readonly<Record<string, unknown>>,
  lockedFields: readonly string[],
): FactLockResult<T> {
  if (lockedFields.length === 0 || proposed === null || typeof proposed !== 'object') {
    return { content: proposed, restored: [] };
  }

  const content: Record<string, unknown> = { ...proposed };
  const restored: string[] = [];

  for (const field of lockedFields) {
    if (!(field in authoritative)) continue;
    const authoritativeValue = authoritative[field];
    if (!deepEqual(content[field], authoritativeValue)) restored.push(field);
    content[field] = authoritativeValue;
  }

  return { content: content as T, restored };
}

/**
 * Structural equality for JSON values.
 *
 * `JSON.stringify` comparison — the previous implementation — reports two
 * equal objects as different when their keys were inserted in a different
 * order, which is exactly what a model regenerating an object does. That
 * produced false "restored" entries and would have buried a real drift signal
 * in noise. This walks the structure instead.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => key in right && deepEqual(left[key], right[key]));
  }
  // NaN is the one primitive where `===` is not the right answer: two NaN
  // values are the same fact even though they are not equal.
  return Number.isNaN(a) && Number.isNaN(b);
}
