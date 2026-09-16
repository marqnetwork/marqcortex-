/**
 * PRODUCT DATA CONTRACT — what an authenticated surface is allowed to show.
 *
 * Product Reality §9 recorded the defect this module exists to close: with
 * `VITE_BACKEND_INTEGRATION` false, every number a signed-in operator saw was
 * fabricated — named companies, a $3.12M pipeline, a 91/100 health score —
 * and nothing on screen said so. Worse than the fabrication was the substitution
 * ON FAILURE: several surfaces caught a real backend error and rendered demo
 * rows in its place, so a broken backend and a healthy one looked identical.
 *
 * The rule this module enforces:
 *
 *   An authenticated MARQ Cortex surface shows real data, or it says why it
 *   cannot. It never shows invented business data in place of either.
 *
 * Five states, and only these five:
 *
 *   LOADING            — the request is in flight.
 *   REAL DATA          — the backend answered, and there is something to show.
 *   EMPTY              — the backend answered, and the answer is "nothing yet".
 *   ERROR              — the backend did not answer, or answered badly.
 *   PERMISSION DENIED  — the backend answered, and the answer is "not you".
 *
 * EMPTY is a real answer and must never be dressed up as data. ERROR is a real
 * answer and must never be dressed up as EMPTY — "no submissions" and "we could
 * not reach the server" are different sentences and an operator acts on them
 * differently.
 */

import { FEATURES } from '@/config/features';
import { ApiError } from '@/app/lib/api';

/** Why an authenticated surface has no real data to show. */
export type ProductDataReason =
  /** No backend is configured in this build — nothing was even attempted. */
  | 'backend-not-configured'
  /** A request was made and the network never got there. */
  | 'unreachable'
  /** The caller has no valid session. */
  | 'unauthenticated'
  /** The caller has a session, and it does not carry this authority. */
  | 'permission-denied'
  /** The backend is certain the thing does not exist. */
  | 'not-found'
  /** The backend answered, and the answer was a failure. */
  | 'server-error';

/**
 * The error every authenticated data path raises instead of returning fiction.
 *
 * It carries a REASON rather than only a message, because the five states above
 * are what a surface renders and a string is not something a surface can branch
 * on without guessing.
 */
export class ProductDataUnavailableError extends Error {
  readonly reason: ProductDataReason;
  readonly status?: number;

  constructor(reason: ProductDataReason, message: string, status?: number) {
    super(message);
    this.name = 'ProductDataUnavailableError';
    this.reason = reason;
    this.status = status;
  }
}

/** True when this build has a backend to call at all. */
export function hasProductBackend(): boolean {
  return FEATURES.BACKEND_INTEGRATION;
}

/**
 * Refuse to proceed when there is no backend configured.
 *
 * Called at the top of every authenticated data function in `dataService`, on
 * the path that used to return a fixture. The difference matters: returning a
 * fixture told the caller "here is your data"; this tells the caller "there is
 * no data, and here is why", which is the only honest thing a disconnected
 * product can say.
 */
export function requireProductBackend(): void {
  if (!FEATURES.BACKEND_INTEGRATION) {
    throw new ProductDataUnavailableError(
      'backend-not-configured',
      'MARQ Cortex is not connected to a backend in this build.',
    );
  }
}

/** Human-readable sentence for each reason, for surfaces that render one. */
export const REASON_HEADLINE: Record<ProductDataReason, string> = {
  'backend-not-configured': 'Not connected',
  unreachable: 'Cannot reach the server',
  unauthenticated: 'Your session has expired',
  'permission-denied': 'You do not have access to this',
  'not-found': 'Not found',
  'server-error': 'The server could not answer',
};

export const REASON_DETAIL: Record<ProductDataReason, string> = {
  'backend-not-configured':
    'This build has no backend configured, so there is no real data to show. Nothing here is invented to fill the gap.',
  unreachable:
    'The request did not reach the server. This is usually a network or configuration problem rather than a problem with your data.',
  unauthenticated: 'Sign in again to continue.',
  'permission-denied':
    'Your account does not carry the authority this surface needs. Ask an administrator if you think that is wrong.',
  'not-found': 'The record this surface asked for does not exist.',
  'server-error':
    'The server answered with a failure. Your data has not been changed.',
};

/**
 * Turn whatever a data path threw into one of the five states.
 *
 * `api.ts` throws `ApiError` carrying the HTTP status, so 401/403/404 can be
 * told apart from a 500 and from a network failure. Anything unrecognised is
 * reported as a server error rather than being guessed into a friendlier
 * category — a surface that under-reports a failure is the thing this file is
 * here to prevent.
 */
export function classifyProductDataError(error: unknown): ProductDataUnavailableError {
  if (error instanceof ProductDataUnavailableError) return error;

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return new ProductDataUnavailableError('unauthenticated', error.message, 401);
    }
    if (error.status === 403) {
      return new ProductDataUnavailableError('permission-denied', error.message, 403);
    }
    if (error.status === 404) {
      return new ProductDataUnavailableError('not-found', error.message, 404);
    }
    return new ProductDataUnavailableError('server-error', error.message, error.status);
  }

  const message = error instanceof Error ? error.message : String(error);

  // `fetch` rejects with a TypeError carrying no status when the request never
  // left the machine — a DNS failure, a refused connection, a blocked origin.
  if (/failed to fetch|network request failed|networkerror|load failed/i.test(message)) {
    return new ProductDataUnavailableError('unreachable', message);
  }

  return new ProductDataUnavailableError('server-error', message);
}

/** True when the value is a real, non-empty answer rather than an absent one. */
export function isEmptyAnswer(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}
