/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — Canonical Session Type Contract
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The single source of truth for client session shapes.
 *
 * This module is TYPES ONLY. It contains no runtime code, no React, no browser
 * APIs, no storage access, no timers, and no authentication logic — importing
 * it can have no side effects and emits nothing into the bundle.
 *
 * WHY THIS FILE EXISTS
 *   `src/app/lib/api.ts` has always imported `ClientAuthContext` from this
 *   path, but the module did not exist. The import is `import type`, so esbuild
 *   erased it and the build kept passing — the contract was simply undeclared.
 *   Four portal components import the same type through `dataService`. This
 *   file declares it once so every consumer resolves to the same shape.
 *
 * SCOPE
 *   Session *expiry* is deliberately NOT modelled here. Client sessions carry
 *   no expiry field today and no expiry is enforced at runtime; adding one is a
 *   separate, behaviour-changing task. Nothing in this file implies otherwise.
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
