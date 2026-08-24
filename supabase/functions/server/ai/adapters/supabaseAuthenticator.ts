/**
 * Supabase-backed authenticator.
 *
 * Implements the control plane's `AIAuthenticator` port without the core taking
 * a dependency on Supabase: the two lookups it needs are injected as functions,
 * so the adapter is unit-testable and the auth vendor stays swappable.
 *
 * Membership lookup is cached with a short TTL. Without it every AI request
 * costs an extra database round trip on the hot path — measurable latency for
 * data that changes when someone is added to a team, not per request.
 *
 * THE CACHE IS NEVER THE AUTHORITY FOR A PRIVILEGED DECISION (M-A).
 *
 * A TTL is a promise about eventual consistency, and a revocation needs one
 * about immediacy. The signal below is isolate-local: `invalidate()` reaches
 * the isolate that performed the write and no other, so an edge deployment
 * running N isolates had N-1 of them serving a cached `org_admin` for up to the
 * TTL after a demotion. That is a stale privileged authorization window, and no
 * length of it is acceptable.
 *
 * So the cache is now scoped by what the answer is FOR:
 *
 *   ordinary request   — a capability every authenticated team member already
 *                        holds. Served from the snapshot; there is nothing here
 *                        for a revocation to take away, so a round trip would
 *                        buy latency and no security.
 *
 *   privileged request — a capability that required an explicit role grant
 *                        (`PRIVILEGED_CAPABILITIES` in `security/actor.ts`).
 *                        Resolved from the database, every time, in every
 *                        isolate. The snapshot is refreshed as a side effect,
 *                        never consulted.
 *
 * There is still ONE membership resolver — `listMemberships`, the port this
 * adapter is constructed with. A privileged request does not take a different
 * path to a different answer; it takes the same path and declines to skip it.
 *
 * `MembershipInvalidationSignal` is kept, demoted to what it always actually
 * was: an optimisation that lets the writing isolate drop a snapshot it knows
 * is stale. Nothing depends on it for correctness any more.
 *
 * A failed membership lookup degrades to "no memberships" rather than throwing.
 * That is not the same as admitting the caller: `resolveOrganization` then fails
 * the request closed with `ORGANIZATION_REQUIRED`, because
 * `AI_ALLOW_DEFAULT_ORGANIZATION` is false by default. Only a deployment that
 * has explicitly opted into the single-tenant fallback resolves anything here,
 * and what it resolves is marked `membershipVerified: false`.
 *
 * (An earlier version of this comment said the lookup "falls back to the
 * configured default". It did not, and must not: a database outage that widened
 * access would be the outage granting it.)
 */

import type {
  AIAuthenticator,
  AuthenticatedSubject,
  AuthenticationContext,
  SubjectMembership,
} from '../security/actor.ts';
import type { Clock } from '../runtime/clock.ts';
import { requiresAuthoritativeResolution } from '../security/actor.ts';

export interface AuthUser {
  readonly id: string;
  readonly email?: string;
  /** Roles carried on the auth record itself (app_metadata, custom claims). */
  readonly roles?: readonly string[];
}

export type UserLookup = (accessToken: string) => Promise<AuthUser | null>;
export type MembershipLookup = (userId: string) => Promise<readonly SubjectMembership[]>;

/**
 * A one-way announcement that a user's memberships have changed.
 *
 * Deliberately not a reference to the cache: the lifecycle must be able to say
 * "this changed" without knowing whether anything is listening, and the
 * authenticator must be able to listen without the lifecycle importing it. Both
 * halves stay testable on their own.
 */
export interface MembershipInvalidationSignal {
  invalidate(userId: string): void;
  subscribe(handler: (userId: string) => void): void;
}

export function createMembershipInvalidationSignal(): MembershipInvalidationSignal {
  const handlers: ((userId: string) => void)[] = [];
  return {
    invalidate(userId: string) {
      for (const handler of handlers) {
        try {
          handler(userId);
        } catch {
          // A listener that throws must not fail the membership write that
          // triggered it. The write is the authority; the cache is an
          // optimisation, and the TTL still expires it.
        }
      }
    },
    subscribe(handler: (userId: string) => void) {
      handlers.push(handler);
    },
  };
}

export interface SupabaseAuthenticatorOptions {
  readonly getUser: UserLookup;
  readonly listMemberships?: MembershipLookup;
  readonly clock: Clock;
  /** Membership cache lifetime. Defaults to 60 seconds. */
  readonly membershipTtlMs?: number;
  /** Announcements that a user's memberships changed. See HIGH-1. */
  readonly invalidation?: MembershipInvalidationSignal;
  readonly onError?: (stage: 'user' | 'memberships', error: unknown) => void;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_CACHED_SUBJECTS = 5_000;

export function createSupabaseAuthenticator(
  options: SupabaseAuthenticatorOptions,
): AIAuthenticator {
  const ttlMs = options.membershipTtlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, { memberships: readonly SubjectMembership[]; expiresAtMs: number }>();

  // A membership that has just been re-roled or revoked is not the membership
  // in this map. Dropping the entry saves the isolate that performed the write
  // a round trip it already knows the answer to. It is an optimisation and not
  // a revocation mechanism — see the header.
  options.invalidation?.subscribe((userId) => cache.delete(userId));

  async function membershipsFor(
    userId: string,
    authoritative: boolean,
  ): Promise<{ memberships: readonly SubjectMembership[]; fromCache: boolean }> {
    if (!options.listMemberships) return { memberships: [], fromCache: false };

    // An authoritative resolution does not read this map. It still WRITES it
    // below, so a privileged request leaves the next ordinary one fresher than
    // it found it.
    const cached = authoritative ? undefined : cache.get(userId);
    if (cached && cached.expiresAtMs > options.clock.now()) {
      return { memberships: cached.memberships, fromCache: true };
    }

    let memberships: readonly SubjectMembership[] = [];
    try {
      memberships = await options.listMemberships(userId);
    } catch (error) {
      options.onError?.('memberships', error);
      // Degrade to no memberships, which is what fails the request closed.
      // Not "fall back to the default": a lookup failure must never be the
      // reason somebody is admitted.
      memberships = [];
    }

    if (cache.size >= MAX_CACHED_SUBJECTS) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(userId, { memberships, expiresAtMs: options.clock.now() + ttlMs });
    return { memberships, fromCache: false };
  }

  return {
    async authenticate(
      authorization: string | null,
      context?: AuthenticationContext,
    ): Promise<AuthenticatedSubject | null> {
      if (!authorization) return null;
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) return null;
      const token = match[1].trim();
      if (token === '') return null;

      let user: AuthUser | null;
      try {
        user = await options.getUser(token);
      } catch (error) {
        // A verification error is not an authenticated caller. Reported so an
        // auth outage is visible, but the request is still rejected.
        options.onError?.('user', error);
        return null;
      }
      if (!user) return null;

      // The trusted roles are never cached: `getUser` verifies the token
      // against the auth service on every request, so `app_metadata` — and the
      // team role the authority floor reads from it — is always current in
      // every isolate. Only the membership half has a snapshot, and only an
      // ordinary request may be answered from it.
      const membership = await membershipsFor(
        user.id,
        requiresAuthoritativeResolution(context),
      );

      return {
        subjectId: user.id,
        email: user.email,
        actorType: 'team_user',
        globalRoles: user.roles ?? [],
        memberships: membership.memberships,
        // Travels with the subject so `resolveActor` can withhold every
        // privileged capability from an answer that might be stale.
        membershipsFromCache: membership.fromCache,
      };
    },
  };
}

/**
 * Authenticator that rejects every credential. Used when auth is unavailable,
 * so the plane fails closed rather than admitting unauthenticated traffic.
 */
export const denyAllAuthenticator: AIAuthenticator = {
  authenticate: () => Promise.resolve(null),
};
