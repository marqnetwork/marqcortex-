/**
 * Identifier generation and validation for the AI Control Plane.
 *
 * Every AI execution carries three identifiers:
 *
 *   requestId      — unique to one control plane execution. Never reused.
 *   correlationId  — spans everything belonging to one user-visible action.
 *                    Supplied by the caller when it already has one (so a UI
 *                    interaction, its retries and any fan-out share a trace);
 *                    generated when absent.
 *   causationId    — the requestId that directly caused this one. Optional,
 *                    populated for orchestrated / chained execution.
 *
 * Caller-supplied identifiers are untrusted input: they end up in logs, audit
 * records and metric labels, so they are constrained to a safe grammar rather
 * than accepted verbatim.
 */

/** Safe identifier grammar for caller-supplied trace ids. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type IdKind = 'req' | 'cor' | 'evt' | 'aud';

/**
 * Random identifier source. Injectable so tests can pin identifiers without
 * monkey-patching globals.
 */
export interface IdFactory {
  next(kind: IdKind): string;
}

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  // Deterministic-length fallback for runtimes without randomUUID. Still
  // unpredictable: getRandomValues is mandatory on every supported runtime.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Default factory — cryptographically random, prefixed by kind. */
export const systemIdFactory: IdFactory = {
  next(kind: IdKind): string {
    return `${kind}_${randomToken()}`;
  },
};

/**
 * A deterministic factory for tests: ids are `${kind}_${seed}${n}`.
 * Never use in production — collisions are guaranteed across instances.
 */
export function createSequentialIdFactory(seed = 'test'): IdFactory {
  let n = 0;
  return {
    next(kind: IdKind): string {
      n += 1;
      return `${kind}_${seed}${n}`;
    },
  };
}

/** True when a caller-supplied identifier is safe to propagate. */
export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

/**
 * Accept a caller-supplied trace id, or mint a fresh one. An unsafe value is
 * replaced rather than rejected: a malformed trace header must never fail a
 * legitimate AI request, but it must also never reach a log sink unfiltered.
 */
export function adoptOrCreateId(candidate: unknown, kind: IdKind, ids: IdFactory): string {
  return isSafeId(candidate) ? candidate : ids.next(kind);
}
