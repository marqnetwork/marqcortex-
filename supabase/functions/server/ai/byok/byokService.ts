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

import { AIError } from '../contracts/errors.ts';
import { ADMIN_ACTION } from '../admin/adminAudit.ts';
import { resolveByokActor } from './byokRbac.ts';

export interface ByokServiceDependencies {
  readonly authenticator: AIAuthenticator;
  /** The SAME tenant resolution options the AI Guard uses. */
  readonly organizationOptions: OrganizationResolutionOptions;
  readonly administration: ByokAdministration;
  /** The SAME append-only administrative trail. */
  readonly trail: AdminAuditWriter;
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

    status: (actor) => administration.status(actor),
    credentials: (actor, providerId) => administration.credentials(actor, providerId),
    configureCredential: (actor, providerId, input, reason, meta) =>
      administration.configureCredential(actor, providerId, input, reason, meta),
    revokeCredential: (actor, providerId, credentialId, reason, meta) =>
      administration.revokeCredential(actor, providerId, credentialId, reason, meta),
    setFallbackPolicy: (actor, providerId, fallback, reason, meta) =>
      administration.setFallbackPolicy(actor, providerId, fallback, reason, meta),
  };
}
