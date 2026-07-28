/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — Canonical Session Type Contract
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The single source of truth for client session shapes.
 *
 * This module holds the session shapes plus the single canonical expiry
 * predicate. It contains no React, no browser storage, no timers, and no
 * authentication logic — every export is pure, so importing it can have no
 * side effects.
 *
 * WHY THIS FILE EXISTS
 *   `src/app/lib/api.ts` has always imported `ClientAuthContext` from this
 *   path, but the module did not exist. The import is `import type`, so esbuild
 *   erased it and the build kept passing — the contract was simply undeclared.
 *   Four portal components import the same type through `dataService`. This
 *   file declares it once so every consumer resolves to the same shape.
 *
 * EXPIRY
 *   `isClientSessionExpired` is the ONE canonical expiry check. Nothing else
 *   in the codebase may re-derive it. It is a pure function of a session and a
 *   timestamp, so it is deterministic and directly unit-testable; callers that
 *   need "now" injected pass it explicitly.
 */

// ── Client session ────────────────────────────────────────────────────────────

/**
 * A logged-in client's portal session.
 *
 * Persisted by `AppContext` under the `marq_cortex_client_session` key and
 * restored on mount. `sessionToken` is issued by the server on successful
 * client verification; it is `null` when the app is running against demo data.
 */
export interface ClientSession {
  /** The diagnostic submission this client is authorised to view. */
  submissionId: string;

  /** The email the client authenticated with. */
  email: string;

  /** Display name for the client's company. */
  companyName: string;

  /** Server-issued token — required for protected client API calls in live mode. */
  sessionToken: string | null;

  /**
   * Epoch milliseconds at which this session stops being valid.
   *
   * Set once at login from `CLIENT_SESSION_TTL_MS` and persisted with the
   * session, so a page refresh cannot extend it.
   */
  expiresAt: number;
}

/**
 * The subset of a client session that the API layer needs in order to
 * authenticate a request.
 *
 * Derived from `ClientSession` rather than restated, so the two can never
 * drift apart. `api.ts` reads exactly these two fields: `sessionToken` for the
 * Authorization header, and `email` for the fallback query parameter used when
 * no server token is present.
 */
export type ClientAuthContext =
  Pick<ClientSession, 'sessionToken'> & Partial<Pick<ClientSession, 'email'>>;

// ── Expiry ────────────────────────────────────────────────────────────────────

/**
 * How long a client portal session stays valid — 8 hours.
 *
 * Matches the team session lifetime already used by `AppContext`, so both
 * session kinds expire on the same policy.
 */
export const CLIENT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * The single canonical client-session expiry check.
 *
 * Pure and deterministic: pass `now` to control the comparison instant.
 *
 * Fails closed. A session whose `expiresAt` is missing, non-numeric, or NaN is
 * treated as EXPIRED rather than valid — this covers sessions persisted before
 * expiry existed, which are exactly the never-expiring sessions this check is
 * here to eliminate. Such a session is rejected and the client re-authenticates.
 *
 * Returns `false` for a null/undefined session: absence of a session is not
 * expiry, and callers already guard that case separately.
 */
export function isClientSessionExpired(
  session: ClientSession | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!session) return false;
  if (typeof session.expiresAt !== 'number' || !Number.isFinite(session.expiresAt)) return true;
  return now >= session.expiresAt;
}
