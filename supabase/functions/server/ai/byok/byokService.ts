/**
 * The customer BYOK service — authorization plus administration, in that order.
 *
 * ONE ENTRY POINT for the whole surface, and the ordering is the design:
 * `authorize` resolves an authenticated customer administrator scoped to ONE
 * organization, and every administration method takes that actor. There is no
 * administration method reachable without one, because there is no
 * administration method that takes an organization id.
 *
 * WHY THE AUTHORIZER LIVES HERE AND NOT IN THE HTTP ADAPTER. The same reason
 * `AIAdministration.authorize` does: a route file that resolved its own actor
 * is a route file that can forget to, and a second transport binding — a
 * scheduled job, a support tool, a different framework — would have to
 * re-implement the resolution and could re-implement it differently. The
 * transport contributes a bearer token and an organization hint; everything
 * that decides who that is happens here.
 *
 * A REFUSED ACCESS ATTEMPT IS RECORDED. `authorize` writes an
 * `ai.byok.access.denied` record to the SAME append-only administrative trail
 * whether or not the caller ever had a role — the one place that trail records
 * an actor it could not resolve. An attempt by one customer's account to reach
 * another customer's credentials is exactly the event a security review looks
 * for, and it must survive the request that produced it.
 */

import type { AIAuthenticator } from '../security/actor.ts';
import type { OrganizationResolutionOptions } from '../security/tenancy.ts';
import type { AdminAuditWriter } from '../admin/adminAudit.ts';
import type { ByokAdministration, ByokRequestMeta } from './byokAdministration.ts';
import type { ByokActor } from './byokRbac.ts';

import type { AIRateLimitRule } from '../contracts/policy.ts';
import type { RateLimiter } from '../security/rateLimiter.ts';

import { AIError } from '../contracts/errors.ts';
import { ADMIN_ACTION } from '../admin/adminAudit.ts';
import { resolveByokActor } from './byokRbac.ts';

/**
 * Abuse control for the customer credential surface (finding M-3).
 *
 * WHY THIS SURFACE NEEDS ONE WHEN THE PLATFORM CONSOLE DOES NOT.
 *
 * `/ai/admin/…` is reachable by a handful of MARQ operators. `/ai/organization/…`
 * is reachable by every customer organization administrator on the platform —
 * orders of magnitude more callers, none of them MARQ staff. An authenticated
 * administrator could otherwise submit credentials or flip a funding policy in
 * an unbounded loop, each iteration performing an AES-256-GCM seal and writing
 * an append-only audit record; the trail is the resource that suffers first,
 * and a trail an attacker can flood is a trail nobody can read afterwards.
 *
 * PER ORGANIZATION, NOT PER ACTOR. The resource being protected — the
 * credential rows, the rotation history, the audit trail — is the
 * organization's, so an organization with three administrators gets one
 * allowance between them rather than three. Keyed by the RESOLVED organization,
 * which means the key cannot be steered by anything a caller supplies.
 *
 * MUTATIONS ONLY. Reads are cheap, idempotent, and are what an administrator
 * refreshes while an incident is in progress; rate-limiting them would take the
 * console away at the moment it is most needed, to bound a cost that is not
 * there.
 */
export interface ByokRateLimit {
  readonly limiter: RateLimiter;
  readonly rule: AIRateLimitRule;
}

/**
 * The default allowance: twenty credential mutations per organization per
 * minute.
 *
 * Comfortably above anything a human doing real work produces — configuring a
 * provider, rotating a key, revoking one, changing a policy are each a single
 * deliberate click behind a typed reason — and far below what a loop produces.
 */
export const DEFAULT_BYOK_MUTATION_RATE: AIRateLimitRule = { limit: 20, windowMs: 60_000 };

export interface ByokServiceDependencies {
  readonly authenticator: AIAuthenticator;
  /** The SAME tenant resolution options the AI Guard uses. */
  readonly organizationOptions: OrganizationResolutionOptions;
  readonly administration: ByokAdministration;
  /** The SAME append-only administrative trail. */
  readonly trail: AdminAuditWriter;
  /**
   * Abuse control for the mutating operations (finding M-3).
   *
   * Omitted, mutations are unlimited — the Batch 4D behaviour, which every
   * existing test and every caller that predates this argument continues to
   * get. A deployment gets the limiter by injecting one.
   */
  readonly rateLimit?: ByokRateLimit;
}

export interface ByokService extends ByokAdministration {
  /**
   * Resolve and authorize the caller for ONE organization.
   *
   * `organizationHint` is what the caller SAID. It is admitted only when the
   * authenticated subject holds a verified membership in it, and it can
   * therefore narrow a caller's authority and never widen it.
   */
  authorize(
    authorization: string | null,
    organizationHint: string | undefined,
    meta?: ByokRequestMeta,
  ): Promise<ByokActor>;
}

export function createByokService(deps: ByokServiceDependencies): ByokService {
  const { administration } = deps;

  /**
   * Spend one unit of this organization's mutation allowance, or refuse.
   *
   * Keyed by the RESOLVED organization — the one `resolveByokActor` derived
   * from an authenticated membership — so the bucket a caller consumes cannot
   * be steered by anything they supply, and one organization can never exhaust
   * another's.
   *
   * The refusal carries `retryAfterSeconds` and names no other tenant, no
   * credential and no count that would let a caller probe another
   * organization's activity.
   */
  function admitMutation(actor: ByokActor, operation: string): void {
    if (!deps.rateLimit) return;
    const decision = deps.rateLimit.limiter.consume(
      `byok:org:${actor.organization.organizationId}`,
      deps.rateLimit.rule,
    );
    if (decision.allowed) return;
    throw new AIError(
      'RATE_LIMITED',
      'Your organization has reached its credential administration limit. Try again shortly.',
      {
        retryAfterSeconds: decision.retryAfterSeconds,
        diagnostics:
          `operation=${operation} organization=${actor.organization.organizationId} ` +
          `limit=${decision.limit} window=${deps.rateLimit.rule.windowMs}ms`,
      },
    );
  }

  return {
    async authorize(authorization, organizationHint, meta) {
      // ALWAYS AUTHORITATIVE. Every decision this surface makes is a privileged
      // one over a customer's own vendor credential, and an administrator whose
      // membership was revoked in another isolate must not be admitted here
      // from a cached snapshot. `resolveByokActor` refuses a cached membership
      // as well, so the guarantee holds even if this argument is dropped.
      const subject = await deps.authenticator.authenticate(authorization, { privileged: true });
      try {
        return resolveByokActor(subject, organizationHint, deps.organizationOptions);
      } catch (error) {
        const aiError = error instanceof AIError ? error : undefined;
        deps.trail.record({
          action: ADMIN_ACTION.byokAccessDenied,
          outcome: 'rejected',
          actorId: subject?.subjectId ?? 'unauthenticated',
          actorEmail: subject?.email,
          actorRole: 'unauthorized',
          // The organization the caller ASKED FOR, bounded, so a review can see
          // which tenant was targeted. It is not an assertion that the caller
          // belongs to it — the refusal above is the record that they do not.
          organizationScope: organizationHint ? [organizationHint.slice(0, 64)] : [],
          reason: 'customer credential administration access refused',
          rejectionCode: aiError?.code ?? 'FORBIDDEN',
          correlationId: meta?.correlationId,
          clientIp: meta?.clientIp,
        });
        throw error;
      }
    },

    // Reads are not limited — see `ByokRateLimit`.
    status: (actor) => administration.status(actor),
    // The organization's own spend ledger (HIGH-1). A read, so unlimited for
    // the same reason: a budget holder watching a ceiling during an incident
    // must not be locked out of watching it.
    spend: (actor) => administration.spend(actor),
    credentials: (actor, providerId) => administration.credentials(actor, providerId),

    // `async`, so a refusal is a REJECTED PROMISE rather than a synchronous
    // throw. These methods are declared as returning a promise, and a caller
    // that reasonably writes `service.configureCredential(...).catch(...)`
    // would never see a synchronously thrown refusal — it would escape as an
    // unhandled exception past the handler written to contain it.
    async configureCredential(actor, providerId, input, reason, meta) {
      admitMutation(actor, 'configure');
      return await administration.configureCredential(actor, providerId, input, reason, meta);
    },
    async revokeCredential(actor, providerId, credentialId, reason, meta) {
      // Revocation is limited like every other mutation, and the allowance is
      // deliberately generous enough that a real containment action — one click,
      // once, per credential — can never be the request that exhausts it.
      admitMutation(actor, 'revoke');
      return await administration.revokeCredential(actor, providerId, credentialId, reason, meta);
    },
    async setFallbackPolicy(actor, providerId, fallback, reason, meta) {
      admitMutation(actor, 'fallback');
      return await administration.setFallbackPolicy(actor, providerId, fallback, reason, meta);
    },
  };
}
