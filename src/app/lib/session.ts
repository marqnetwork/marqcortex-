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
 *
 * STORAGE KEYS
 *   Every session storage key name is declared here once. Declaring a name is
 *   not using it: this module still performs no browser storage access of any
 *   kind. `AppContext` is the only module that reads or writes session
 *   storage, and it imports these names rather than restating the literals, so
 *   a key can never drift again.
 */

// ── Storage keys ──────────────────────────────────────────────────────────────

/** Canonical team session record — see `TeamSession`. */
export const TEAM_SESSION_KEY = 'marq_cortex_team_session';

/** Epoch-millisecond deadline for the canonical team session. */
export const TEAM_SESSION_EXPIRY_KEY = 'marq_cortex_team_session_expiry';

/** Canonical client portal session record — see `ClientSession`. */
export const CLIENT_SESSION_KEY = 'marq_cortex_client_session';

/**
 * Storage keys an earlier build wrote team auth and team identity to.
 *
 * These are CLEANUP-ONLY. Nothing may read them for authentication or
 * identity, and nothing may write them. They exist here solely so `logout`
 * can delete them deterministically: a stale value left behind by an older
 * bundle must not survive as trusted state, and its origin and expiry cannot
 * be established after the fact, so it is erased rather than migrated.
 */
export const LEGACY_TEAM_SESSION_KEYS = ['team_access_token', 'team_user'] as const;

// ── Team session ──────────────────────────────────────────────────────────────

/**
 * The authenticated team member, exactly as `/auth/team/login` returns them.
 *
 * Identity travels inside the canonical team session record — there is no
 * separate identity key. Optional because a session restored from a bundle
 * that predates identity has a token but no user.
 */
export interface TeamUser {
  id: string;
  email: string;
  name: string;
}

/**
 * A logged-in team member's session.
 *
 * Persisted by `AppContext` under `TEAM_SESSION_KEY`. The expiry deadline
 * lives beside it under `TEAM_SESSION_EXPIRY_KEY`, unchanged from before.
 */
export interface TeamSession {
  /** Server-issued access token for authenticated team API calls. */
  accessToken: string;

  /** Who is signed in, when the login response supplied it. */
  user: TeamUser | null;
}

/** Serialise a team session for storage. */
export function serializeTeamSession(session: TeamSession): string {
  return JSON.stringify(session);
}

/**
 * Parse a stored team session record.
 *
 * Accepts two shapes:
 *   1. The current record — `{"accessToken": "...", "user": {...} | null}`.
 *   2. A bare token string, which is what earlier builds stored under this
 *      same canonical key. Those sessions are still valid authentication, so
 *      they restore with `user: null` rather than being thrown away.
 *
 * Returns `null` for anything that cannot yield a usable access token, so a
 * corrupt record fails closed into "not signed in" instead of a broken
 * half-session.
 */
export function parseTeamSession(raw: string | null | undefined): TeamSession | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — the earlier bare-token format.
    return { accessToken: raw, user: null };
  }

  // JSON.parse('"abc"') yields a string: also a bare token, just quoted.
  if (typeof parsed === 'string') {
    return parsed ? { accessToken: parsed, user: null } : null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const { accessToken, user } = parsed as { accessToken?: unknown; user?: unknown };
  if (typeof accessToken !== 'string' || !accessToken) return null;

  return { accessToken, user: normaliseTeamUser(user) };
}

/** Keep only a fully-formed user; a partial record is treated as absent. */
function normaliseTeamUser(user: unknown): TeamUser | null {
  if (!user || typeof user !== 'object') return null;
  const { id, email, name } = user as { id?: unknown; email?: unknown; name?: unknown };
  if (typeof id !== 'string' || typeof email !== 'string' || typeof name !== 'string') return null;
  return { id, email, name };
}

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
