/**
 * Fact Lock — the structural guarantee behind Constitution Article 6.
 *
 * "Math decides priority. LLM only explains decisions." Prompt instructions
 * asking a model not to change a number are advisory; a model that ignores them
 * produces a proposal with a price the consultancy never quoted. The fact lock
 * makes the guarantee structural instead: after generation, every locked field
 * is reconciled against its authoritative value, unconditionally.
 *
 * There are THREE cases, and getting the third one wrong is what makes a fact
 * lock look like it works while leaving it open:
 *
 *   Present in both      The authoritative value overwrites whatever the model
 *                        produced. Reported as `restored` when it differed.
 *
 *   Present in authority,
 *   absent from output   Restored. A model cannot delete a commercial term by
 *                        omitting it.
 *
 *   Absent from authority,
 *   present in output    REMOVED, and reported. This is the case an earlier
 *                        implementation skipped, and skipping it inverts the
 *                        guarantee: a section with no authoritative price would
 *                        accept whatever price the model chose to invent, which
 *                        is worse than changing one — there is nothing to
 *                        compare it against, so nothing looks wrong.
 *
 * Locked fields may be nested (`offer.price`). A guarantee that only holds at
 * the top level is one restructured prompt away from not holding at all.
 *
 * Two properties matter and are tested directly:
 *
 *   Unconditional  The reconciliation runs whether or not the model appears to
 *                  have complied. There is no "looks unchanged, skip it" path —
 *                  that would be a comparison the model could influence.
 *
 *   Reported       Every field that had to be put back or taken out is named in
 *                  the result and in the audit record, so a model drifting
 *                  toward overwriting commercial terms is visible in telemetry
 *                  rather than silently corrected forever.
 */

export interface FactLockResult<T> {
  readonly content: T;
  /** Fields whose value the model changed and the platform restored. */
  readonly restored: readonly string[];
  /** Protected fields the model invented with no authority behind them. */
  readonly removed: readonly string[];
}

/** Every field the lock touched, for a single audit line. */
export function factLockTouched(result: FactLockResult<unknown>): readonly string[] {
  return [...result.restored, ...result.removed.map((field) => `-${field}`)];
}

/**
 * Reconcile locked fields on a generated object against the authoritative
 * source.
 *
 * `lockedFields` entries may be dotted paths. A path whose parent is missing
 * from the output is created only when the authority has a value for it —
 * restoring `offer.price` must not conjure an `offer` object that the feature's
 * contract never had.
 */
export function enforceFactLock<T extends Record<string, unknown>>(
  proposed: T,
  authoritative: Readonly<Record<string, unknown>>,
  lockedFields: readonly string[],
): FactLockResult<T> {
  if (lockedFields.length === 0 || proposed === null || typeof proposed !== 'object') {
    return { content: proposed, restored: [], removed: [] };
  }

  // Structural clone so a nested write cannot mutate the caller's object. The
  // input is a parsed model response, so it is plain JSON by construction.
  const content = cloneJson(proposed) as Record<string, unknown>;
  const restored: string[] = [];
  const removed: string[] = [];

  for (const field of lockedFields) {
    const path = field.split('.').filter((segment) => segment !== '');
    if (path.length === 0) continue;

    const authority = readPath(authoritative, path);
    const produced = readPath(content, path);

    if (authority.found) {
      if (!produced.found || !deepEqual(produced.value, authority.value)) restored.push(field);
      writePath(content, path, authority.value);
      continue;
    }

    // No authoritative value. Anything the model produced here is invention.
    if (produced.found) {
      removed.push(field);
      deletePath(content, path);
    }
  }

  return { content: content as T, restored, removed };
}

interface PathRead {
  readonly found: boolean;
  readonly value: unknown;
}

function readPath(source: Readonly<Record<string, unknown>>, path: readonly string[]): PathRead {
  let cursor: unknown = source;
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) {
      return { found: false, value: undefined };
    }
    const record = cursor as Record<string, unknown>;
    if (!(segment in record)) return { found: false, value: undefined };
    cursor = record[segment];
  }
  return { found: true, value: cursor };
}

function writePath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i];
    const next = cursor[segment];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      // The parent exists in the authority (we only reach here for a found
      // authoritative value), so materialising it restores the shape the
      // authority describes rather than inventing one.
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

function deletePath(target: Record<string, unknown>, path: readonly string[]): void {
  let cursor: unknown = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return;
    cursor = (cursor as Record<string, unknown>)[path[i]];
  }
  if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return;
  delete (cursor as Record<string, unknown>)[path[path.length - 1]];
}

/** JSON-shaped deep clone. The input is always a parsed model response. */
function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cloneJson(entry);
    }
    return out;
  }
  return value;
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
