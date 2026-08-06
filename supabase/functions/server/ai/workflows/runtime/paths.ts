/**
 * Constrained value paths (AI-01 Batch 3B, Part 3).
 *
 * The addressing scheme for everything data flow touches: which field a
 * condition reads, which field a mapping copies, which field it writes to.
 *
 * ── WHY NOT JSONPATH ───────────────────────────────────────────────────────
 *
 * JSONPath is a query language. It has wildcards, recursive descent, slices,
 * unions and — in most implementations — filter expressions containing a
 * general-purpose predicate language, which several libraries evaluate with
 * `eval` or `new Function`. Every one of those features is a way for a
 * definition to read something it did not name, and the filter syntax is a way
 * to execute code that arrived as data.
 *
 * A path here is a fixed list of literal segments. There is no wildcard, no
 * descent, no slice, no union, no filter and no syntax that could grow into
 * one. `a.b.0.c` reads exactly one location or nothing at all. That is less
 * expressive than JSONPath on purpose: a workflow author who cannot express
 * "every element matching X" also cannot express "every secret in the record".
 *
 * ── THE PROTOTYPE SEGMENTS ─────────────────────────────────────────────────
 *
 * `__proto__`, `prototype` and `constructor` are refused as segments in both
 * directions. Reading them leaks engine internals into a condition; writing
 * them is prototype pollution — a mapping that writes `__proto__.isAdmin` on a
 * plain object mutates `Object.prototype` for the whole isolate. Destination
 * objects are additionally built with `Object.create(null)` ancestry via
 * explicit own-key assignment, so a poisoned prototype elsewhere cannot supply
 * a value this module then reads back as if a mapping had produced it.
 */

/** Segments are literal keys or array indices. Nothing else parses. */
const SEGMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]{1,6})$/;

const FORBIDDEN_SEGMENTS: readonly string[] = ['__proto__', 'prototype', 'constructor'];

export const PATH_BOUNDS = {
  maxSegments: 8,
  maxLength: 120,
} as const;

export type ParsedPath =
  | { readonly ok: true; readonly segments: readonly string[] }
  | { readonly ok: false; readonly problem: string };

/**
 * Parse a dotted path, or say precisely why it is not one.
 *
 * Total: every input produces an answer, and no input produces an exception.
 * Callers at registration turn the problem into a refusal; callers at runtime
 * never see one, because a definition that reached the engine has already been
 * parsed successfully at registration.
 */
export function parsePath(path: unknown): ParsedPath {
  if (typeof path !== 'string') return { ok: false, problem: 'path must be a string' };
  if (path.length === 0) return { ok: false, problem: 'path is empty' };
  if (path.length > PATH_BOUNDS.maxLength) {
    return { ok: false, problem: `path is longer than ${PATH_BOUNDS.maxLength} characters` };
  }

  const segments = path.split('.');
  if (segments.length > PATH_BOUNDS.maxSegments) {
    return { ok: false, problem: `path has more than ${PATH_BOUNDS.maxSegments} segments` };
  }
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      return {
        ok: false,
        problem: `path segment "${segment}" is not a plain key or index — ` +
          'wildcards, filters and descent are not part of this language',
      };
    }
    if (FORBIDDEN_SEGMENTS.includes(segment)) {
      return { ok: false, problem: `path segment "${segment}" is not addressable` };
    }
  }
  return { ok: true, segments };
}

/**
 * The result of reading a path.
 *
 * `found: false` and `found: true, value: undefined` are DIFFERENT answers, and
 * keeping them apart is what makes `exists` mean something. A field explicitly
 * set to `undefined` and a field that was never there are the same to `?.`, and
 * a condition language that could not tell them apart would have an `exists`
 * operator that lies.
 */
export interface PathRead {
  readonly found: boolean;
  readonly value: unknown;
}

const ABSENT: PathRead = { found: false, value: undefined };

/** Read one location, or report that it is not there. Never throws. */
export function readPath(root: unknown, segments: readonly string[]): PathRead {
  let current: unknown = root;

  for (const segment of segments) {
    if (current === null || current === undefined) return ABSENT;

    if (Array.isArray(current)) {
      if (!/^[0-9]+$/.test(segment)) return ABSENT;
      const index = Number(segment);
      if (index >= current.length) return ABSENT;
      current = current[index];
      continue;
    }

    if (typeof current !== 'object') return ABSENT;
    // Own properties only. An inherited value is not something the source
    // document contained, and treating one as data is how a polluted prototype
    // becomes a mapping result.
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return ABSENT;
    current = (current as Record<string, unknown>)[segment];
  }

  return { found: true, value: current };
}

/**
 * Write one location into a plain-object tree, creating intermediates.
 *
 * Destinations are OBJECTS ONLY — a numeric segment in a destination path is
 * refused at registration. Writing into arrays needs an append-or-replace
 * decision, an index-out-of-order decision and a sparse-array decision, and
 * every one of them is a semantics nobody specified. A mapping that needs an
 * array writes it as a whole value.
 *
 * Returns a NEW tree. Nothing the caller passed in is mutated, so a mapping
 * cannot alter the checkpoint outputs it read from.
 */
export function writePath(
  root: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = segments;
  const next: Record<string, unknown> = { ...root };

  if (rest.length === 0) {
    next[head] = value;
    return next;
  }

  const existing = Object.prototype.hasOwnProperty.call(root, head) ? root[head] : undefined;
  const child =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  next[head] = writePath(child, rest, value);
  return next;
}

/** True when the path may be used as a mapping destination. */
export function isWritablePath(segments: readonly string[]): boolean {
  return segments.every((segment) => !/^[0-9]+$/.test(segment));
}
