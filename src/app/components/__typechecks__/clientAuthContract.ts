/**
 * PHASE 1B TASK 16 — compile-time Client Portal auth-context contract
 *
 * Type-level companion to tests/features/clientPortalAuthContract.test.ts.
 * This file has NO runtime: it is never imported by the application, emits
 * nothing (the frontend boundary is `noEmit`), and exists only so
 * `typecheck:web` proves the corrected contract at the type level.
 *
 * THE DEFECT
 *   `ClientAuthContext` is threaded through the client portal in three layers:
 *
 *     ClientPortal.tsx    builds it  — useMemo<ClientAuthContext | undefined>
 *     dataService.ts      forwards it — demo gate, then delegates to api
 *     api.ts              sends it    — Authorization: Bearer auth.sessionToken
 *                                       plus the ?email= fallback query
 *
 *   `api.getClientSubmission` has always declared its second parameter as
 *   `auth?: ClientAuthContext`. The dataService wrapper in front of it declared
 *   that same positional slot as `email?: string` — an annotation that matched
 *   neither the value its only caller passes (ClientPortal passes `clientAuth`)
 *   nor the value it hands on to `api`. One stale annotation, two diagnostics:
 *
 *     ClientPortal.tsx(182,62)  TS2345  ClientAuthContext -> string
 *     dataService.ts(251,48)    TS2345  string -> ClientAuthContext
 *
 *   The two errors are the same mismatch seen from each side of the wrapper.
 *   The runtime value was correct throughout: because the stale parameter
 *   occupied the very slot `api` expects, the ClientAuthContext object was
 *   already being forwarded positionally and the live request already carried
 *   the client's credentials. Only the type lied. The fix repoints the
 *   annotation at the canonical `ClientAuthContext` — no cast, no widening, no
 *   change to `ClientAuthContext`, `ClientSession`, or the api signature.
 *
 * SCOPE NOTE (deliberately excluded — see the test file)
 *   The remaining client-portal wrappers (`getClientReport`, `trackEngagement`,
 *   `getClientMessages`, `postClientMessage`, `getClientProposal`,
 *   `getEngagementLog`) are stale in the same declaration-level way, but they
 *   have no positional slot for the auth argument, so they DISCARD it at
 *   runtime rather than forwarding it. Repairing those changes what the browser
 *   sends over the wire; it is an authentication and telemetry change, not a
 *   type-only one, and it is escalated rather than folded in here.
 *
 * If the annotation ever regresses to `string`, the assertions below stop
 * compiling and this boundary fails.
 */
import type { ClientAuthContext, ClientSession } from '@/app/lib/session';
import * as api from '@/app/lib/api';
import * as dataService from '@/app/services/dataService';

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

/** The declared type of the Nth parameter of a function type. */
type Param<F extends (...a: never[]) => unknown, N extends number> = Parameters<F>[N];

// ── 1. ClientAuthContext is still derived from ClientSession, unchanged ───────
// Task 16 corrected a wrapper annotation; it did not touch the shared canonical
// model. `ClientAuthContext` must remain exactly the two-field projection of
// `ClientSession` that api.ts reads: `sessionToken` (required, nullable) and
// `email` (optional).
type _AuthIsSessionProjection = Assert<
  Extends<ClientAuthContext, Pick<ClientSession, 'sessionToken'> & Partial<Pick<ClientSession, 'email'>>>
>;
type _SessionProjectionIsAuth = Assert<
  Extends<Pick<ClientSession, 'sessionToken'> & Partial<Pick<ClientSession, 'email'>>, ClientAuthContext>
>;

// `sessionToken` is required and nullable — a token-less demo session is valid.
declare const demoModeAuth: ClientAuthContext;
type _TokenIsNullable = Assert<Extends<null, ClientAuthContext['sessionToken']>>;
const _sessionTokenIsRequired: string | null = demoModeAuth.sessionToken;

// `email` stays optional — it is only the fallback when no token was issued.
const _emailIsOptional: string | undefined = demoModeAuth.email;

// ── 2. The wrapper and its delegate now agree ────────────────────────────────
// This is the correction. The dataService wrapper's second parameter must be
// the SAME type api.getClientSubmission declares — that identity is what the
// stale `email?: string` broke, in both directions at once.
type ApiAuthParam = Param<typeof api.getClientSubmission, 1>;
type ServiceAuthParam = Param<typeof dataService.getClientSubmission, 1>;

type _ServiceParamMatchesApi = Assert<Extends<ServiceAuthParam, ApiAuthParam>>;
type _ApiParamMatchesService = Assert<Extends<ApiAuthParam, ServiceAuthParam>>;

// Both sides are the canonical contract, not merely each other.
type _ApiParamIsAuthContext = Assert<Extends<ApiAuthParam, ClientAuthContext | undefined>>;
type _ServiceParamIsAuthContext = Assert<Extends<ServiceAuthParam, ClientAuthContext | undefined>>;

// ── 3. The real value ClientPortal builds is accepted ────────────────────────
// ClientPortal.tsx:
//   useMemo<ClientAuthContext | undefined>(() => {
//     if (!submissionId && !clientEmail && !sessionToken) return undefined;
//     return { sessionToken: sessionToken ?? null, email: clientEmail };
//   }, [...])
// Both branches must satisfy the corrected parameter — including `undefined`,
// which is what an unauthenticated portal mount passes.
declare const portalSessionToken: string | null | undefined;
declare const portalClientEmail: string | undefined;

const _builtAuth: ClientAuthContext = {
  sessionToken: portalSessionToken ?? null,
  email: portalClientEmail,
};
const _builtAuthAccepted: ServiceAuthParam = _builtAuth;
const _undefinedAccepted: ServiceAuthParam = undefined;

// The exact TS2345 the fix removed, at the real ClientPortal.tsx:182 call site.
declare const clientAuth: ClientAuthContext | undefined;
const _callSite = dataService.getClientSubmission('demo-sub-001', clientAuth);
type _CallSiteReturnsSubmission = Assert<
  Extends<Awaited<typeof _callSite>, { success: boolean }>
>;

// ── 4. The stale annotation cannot come back ─────────────────────────────────
// `string` was the old declaration. It must NOT satisfy the corrected parameter
// — this is the negative assertion that pins the defect shut. If someone
// re-widens the parameter to `string` (or to `any`/`unknown`), `Extends` flips
// to `true` here and the `Assert<false>` stops compiling.
type _StringIsNotAuthContext = Assert<Extends<string, ClientAuthContext> extends true ? false : true>;
type _StringIsNotServiceParam = Assert<Extends<string, ServiceAuthParam> extends true ? false : true>;

// The mismatch was symmetric — an auth context was never a string either.
type _AuthContextIsNotString = Assert<Extends<ClientAuthContext, string> extends true ? false : true>;

// ── 5. The parameter was not simply loosened to absorb the error ─────────────
// A parameter widened to `any` would make every assertion above vacuously pass,
// so prove the contract still REJECTS values that are not an auth context.
type _NumberRejected = Assert<Extends<number, ServiceAuthParam> extends true ? false : true>;
type _EmptyObjectRejected = Assert<
  // `{}` lacks the required `sessionToken`, so it must not satisfy the contract.
  Extends<Record<string, never>, ClientAuthContext> extends true ? false : true
>;
