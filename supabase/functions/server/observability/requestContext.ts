/**
 * Request / correlation identifier helpers (Workstream 8 — Observability).
 *
 * The edge server had no request identifier, so an error surfaced to a
 * client could not be tied back to a server log line. These helpers add the
 * smallest safe mechanism:
 *
 *   - Accept a caller-supplied id (X-Request-Id / X-Correlation-Id) ONLY when
 *     it matches a strict, non-sensitive charset — otherwise it is ignored and
 *     a fresh UUID is generated. This prevents log-injection and stops a client
 *     from smuggling arbitrary content into server logs.
 *   - The id is safe to echo back in error responses for support tracing; it
 *     is either a random UUID or a validated opaque token and never contains a
 *     secret the server did not already hand out.
 *
 * Pure functions only — no framework coupling, so they are unit-testable under
 * the Node test runner without a live Deno/edge environment.
 */

/** Max length accepted for a caller-supplied correlation id. */
export const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Safe charset for a caller-supplied id: alphanumerics plus a small set of
 * separators commonly used by tracing systems (dot, dash, underscore).
 * Deliberately excludes whitespace, control chars, and anything that could
 * break a log line or be interpreted downstream.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value);
}

/**
 * Resolve the request id for a request: reuse a valid caller-supplied id,
 * otherwise mint a fresh UUID. Never throws.
 */
export function resolveRequestId(clientValue: unknown): string {
  if (isValidClientRequestId(clientValue)) return clientValue;
  return generateRequestId();
}

function generateRequestId(): string {
  try {
    // Available in Deno edge runtime and Node 22+.
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  // Deterministic-enough fallback; still collision-resistant for tracing.
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
