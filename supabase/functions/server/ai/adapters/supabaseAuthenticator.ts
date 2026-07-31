/**
 * Supabase-backed authenticator.
 *
 * Implements the control plane's `AIAuthenticator` port without the core taking
 * a dependency on Supabase: the two lookups it needs are injected as functions,
 * so the adapter is unit-testable and the auth vendor stays swappable.
 *
 * Membership lookup is cached with a short TTL. Without it every AI request
 * costs an extra database round trip on the hot path — measurable latency for
 * data that changes when someone is added to a team, not per request. The TTL is
 * deliberately short (60s) so a revoked membership stops granting access within
 * a minute rather than for the lifetime of an edge isolate.
 *
 * A failed membership lookup degrades to "no memberships" rather than failing
 * the request. Organization resolution then falls back to the configured
 * default, which is the correct behaviour for the current single-tenant console
 * deployment and is bounded by the organization allow list when one is set.
 */

import type { AIAuthenticator, AuthenticatedSubject, SubjectMembership } from '../security/actor.ts';
import type { Clock } from '../runtime/clock.ts';

export interface AuthUser {
  readonly id: string;
  readonly email?: string;
  /** Roles carried on the auth record itself (app_metadata, custom claims). */
  readonly roles?: readonly string[];
}

export type UserLookup = (accessToken: string) => Promise<AuthUser | null>;
export type MembershipLookup = (userId: string) => Promise<readonly SubjectMembership[]>;

export interface SupabaseAuthenticatorOptions {
  readonly getUser: UserLookup;
  readonly listMemberships?: MembershipLookup;
  readonly clock: Clock;
  /** Membership cache lifetime. Defaults to 60 seconds. */
  readonly membershipTtlMs?: number;
  readonly onError?: (stage: 'user' | 'memberships', error: unknown) => void;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_CACHED_SUBJECTS = 5_000;

export function createSupabaseAuthenticator(
  options: SupabaseAuthenticatorOptions,
): AIAuthenticator {
  const ttlMs = options.membershipTtlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, { memberships: readonly SubjectMembership[]; expiresAtMs: number }>();

  async function membershipsFor(userId: string): Promise<readonly SubjectMembership[]> {
    if (!options.listMemberships) return [];

    const cached = cache.get(userId);
    if (cached && cached.expiresAtMs > options.clock.now()) return cached.memberships;

    let memberships: readonly SubjectMembership[] = [];
    try {
      memberships = await options.listMemberships(userId);
    } catch (error) {
      options.onError?.('memberships', error);
      // Degrade to no memberships. Organization resolution falls back to the
      // configured default, which the allow list still bounds.
      memberships = [];
    }

    if (cache.size >= MAX_CACHED_SUBJECTS) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(userId, { memberships, expiresAtMs: options.clock.now() + ttlMs });
    return memberships;
  }

  return {
    async authenticate(authorization: string | null): Promise<AuthenticatedSubject | null> {
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

      return {
        subjectId: user.id,
        email: user.email,
        actorType: 'team_user',
        globalRoles: user.roles ?? [],
        memberships: await membershipsFor(user.id),
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
