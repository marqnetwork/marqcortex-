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

/**
 * `adm` is the administrative change trail (AI-01 Batch 2). It is a distinct
 * kind from `aud` on purpose: the two trails answer different questions, and an
 * identifier that tells a reviewer which trail a record came from is one fewer
 * join when reconstructing an incident.
 */
/**
 * The `run`, `act`, `stp`, `apr`, `cpt` and `hof` kinds belong to the agent
 * runtime (AI-01 Batch 3A): a run, an action, a step, an approval, a checkpoint
 * and a handoff. They share this factory rather than introducing a second one,
 * so a test that pins identifiers pins ALL of them from one deterministic
 * source — an agent runtime with its own id generator would be the one part of
 * the platform whose ids a test could not control.
 */
/**
 * The `wfr`, `wfn`, `wfa` and `wfd` kinds belong to the workflow engine (AI-01
 * Batch 3B): a workflow run, a node execution, a workflow approval and a
 * workflow audit record. They share this factory for exactly the reason the
 * agent runtime's kinds do — a test that pins identifiers pins ALL of them from
 * one deterministic source, and a workflow engine with its own id generator
 * would be the one part of the platform whose ids a test could not control.
 */
export type IdKind =
  | 'req'
  | 'cor'
  | 'evt'
  | 'aud'
  | 'adm'
  | 'run'
  | 'act'
  | 'stp'
  | 'apr'
  | 'cpt'
  | 'hof'
  | 'wfr'
  | 'wfn'
  | 'wfa'
  | 'wfd';

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
