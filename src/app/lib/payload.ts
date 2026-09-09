/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — Narrowing a response before it becomes state
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT CLASS THIS CLOSES
 *   Every read in `src/app/lib/api.ts` ends the same way:
 *
 *       return data as { success: boolean; notifications: AppNotification[] };
 *
 *   That is an ASSERTION, not a check. It tells the compiler what the field
 *   will be and verifies nothing at runtime. A 200 response whose body lacks
 *   the field — a partially rolled-out deploy, a proxy or gateway answering
 *   with its own payload, an error object returned with the wrong status, a
 *   route renamed on the server — therefore yields `undefined`, the component
 *   writes `undefined` into a state variable it has typed as an array, and the
 *   very next render reads `.length` or `.map` on it and throws.
 *
 *   This is not hypothetical. It was reproduced in the browser against a stubbed
 *   backend on the NOTIFICATION CENTRE, which the shell renders in its header on
 *   every page: one malformed response replaced the entire console with the
 *   route error boundary. Six other components had the identical shape.
 *
 * WHY A SHARED HELPER RATHER THAN SEVEN GUARDS
 *   Because the eighth call site is the one that gets forgotten. `asArray` is
 *   the one place the decision is made, so every read is narrowed the same way
 *   and a new read has an obvious thing to reach for.
 *
 * WHAT THIS IS NOT
 *   It is not validation, and it does not check the SHAPE OF THE ELEMENTS. An
 *   array of the wrong objects still gets through, and catching that needs a
 *   schema, which is a larger decision than this. What it guarantees is
 *   narrower and worth stating exactly: a component that asks for a list gets a
 *   list, so rendering it cannot throw.
 *
 *   It is also not error handling. A response that arrives without its payload
 *   is usually a failure, and where the caller can tell the difference it
 *   should say so — see the home dashboard, which distinguishes a failed load
 *   from an empty workspace. `asArray` is the floor beneath that, for the case
 *   where the caller cannot tell.
 *
 * PURE. No React, no storage, no fetching — so it is directly unit-testable and
 * importing it can have no side effects.
 */

/**
 * The value if it is an array, otherwise an empty one.
 *
 * `readonly T[]` is accepted and returned as `T[]` because that is what state
 * setters take; nothing here mutates the input.
 */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * The value if it is a usable finite number, otherwise the fallback.
 *
 * `NaN` and `Infinity` are rejected: both are `typeof 'number'`, and both
 * render as garbage in a badge or a count.
 */
export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The value if it is a non-empty string, otherwise the fallback. */
export function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * The value if it is a plain object, otherwise `null`.
 *
 * `null` rather than `{}`: a caller that asked for an object usually needs to
 * distinguish "absent" from "present but empty", and an empty object silently
 * satisfies both.
 */
export function asObject<T extends object>(value: unknown): T | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as T)
    : null;
}
