/**
 * Customer BYOK authorization — AI-01 Batch 4D.
 *
 * WHY THIS IS A SEPARATE VOCABULARY FROM `admin/rbac.ts`, AND WHY THAT IS THE
 * SECURITY DECISION RATHER THAN A TIDINESS ONE.
 *
 * `admin/rbac.ts` governs MARQ'S OWN provider estate: the keys the platform
 * executes with, the kill switch, the ceilings, the certification decisions.
 * Every capability in it is platform-wide, which is exactly why Batch 4C moved
 * all five provider-administration grants to the platform operator and left the
 * organization tier with reads.
 *
 * This governs A CUSTOMER'S OWN ROWS. It is a different estate, a different
 * blast radius and a different population of administrators, and the two must
 * not be reachable through one capability set — because the moment they are,
 * widening a grant for a customer surface silently widens it over MARQ's.
 *
 *   admin/rbac.ts   MARQ's estate   platform operator      `ai.providers.*`
 *   THIS FILE       one tenant's    that tenant's admins   `ai.byok.*`
 *
 * There is no capability in either set that appears in the other, and no code
 * path translates between them. A customer organization administrator holds
 * `ai.byok.manage` and does not hold `ai.providers.credentials.manage`; the
 * platform operator holds the second and does not hold the first. Neither can
 * reach the other's credentials, and that is asserted rather than asserted
 * about.
 *
 * ── WHY THE PLATFORM OPERATOR DELIBERATELY HOLDS NOTHING HERE ─────────────
 *
 * `resolveAdminActor` gives a super admin an EMPTY organization scope on
 * purpose — the platform operator's view must not narrow to whichever tenants
 * they happen to hold a membership row for. The mirror of that is this: a
 * platform operator has no tenant identity, so there is no organization whose
 * BYOK they are the administrator of, and this surface refuses them.
 *
 * That refusal is deliberate and it is a REDUCTION in reachable authority, not
 * an oversight. MARQ storing, rotating or revoking a customer's own vendor key
 * on their behalf is a support operation with a customer-consent question
 * attached, and shipping it as a side effect of "the platform operator can do
 * everything" would answer that question by accident. It is named in the batch
 * report as deferred.
 *
 * ── WHERE THE ORGANIZATION COMES FROM ─────────────────────────────────────
 *
 * From `resolveOrganization`, and from nowhere else. That is the ONE tenant
 * resolver on this platform: it honours a caller's organization hint only when
 * the authenticated subject actually holds a membership in it, it refuses to
 * guess when a subject holds several, and it marks the single-tenant default
 * fallback `membershipVerified: false` so a weaker guarantee cannot be mistaken
 * for the strong one.
 *
 * This surface then REFUSES `membershipVerified: false` outright. A subject
 * with no membership row anywhere, placed in the deployment's default
 * organization by `AI_ALLOW_DEFAULT_ORGANIZATION`, must not be able to store,
 * rotate or revoke that organization's vendor credential.
 *
 * ── FLOORED, NOT UNIONED ──────────────────────────────────────────────────
 *
 * The trusted team role on the auth record and the organization role on the
 * membership row can disagree while a role change is half-applied. Reading a
 * tier off the union reads it off whichever half is still stale, and here that
 * is the difference between being able to replace a customer's vendor key and
 * not. `flooredRolesFor` grants no more than the lower of the two, and is a
 * no-op whenever they agree — the same rule the agent and workflow runtimes
 * apply, asked of the same function so the three cannot drift.
 */

import type { AuthenticatedSubject } from '../security/actor.ts';
import type { AIOrganization } from '../contracts/request.ts';
import type { OrganizationResolutionOptions } from '../security/tenancy.ts';
import { flooredRolesFor } from '../security/actor.ts';
import { resolveOrganization } from '../security/tenancy.ts';
import { AIError } from '../contracts/errors.ts';

/**
 * What a customer administrator may do with their own organization's provider
 * credentials.
 *
 * TWO, NOT ONE, and the split is the same one Batch 4C made between
 * `ai.providers.view` and `ai.providers.credentials.manage`: reading which
 * providers a tenant has configured and REPLACING the key that tenant's traffic
 * executes on are different acts with different blast radii, and they must be
 * separately grantable so a future read-only customer role attaches to the
 * first without acquiring the second.
 */
export type AIByokCapability =
  /** Read this organization's provider/credential STATUS. Never a secret. */
  | 'ai.byok.view'
  /** Configure, rotate or revoke this organization's provider credential. */
  | 'ai.byok.manage'
  /**
   * Read THIS organization's own AI spend ledger (4D remediation, HIGH-1).
   *
   * A THIRD capability rather than part of `ai.byok.view`, by the same argument
   * that split `view` from `manage`: "which vendors have we configured" and
   * "what has our AI cost" are different questions, asked by different people —
   * an engineer and a budget holder — and a platform that cannot grant the
   * second without the first will end up granting both to everybody.
   *
   * READ ONLY, AND DELIBERATELY SO. There is no `ai.byok.spend.manage` in this
   * union, and there is no operation on the customer surface that raises or
   * clears a ceiling. A ledger a customer can raise for themselves is not a
   * governed ceiling, it is a form field; and clearing settled spend is
   * destroying MARQ's record of what a tenant consumed. Both belong to the
   * platform operator under `ai.admin.budget.organization`, which is a
   * different capability set in a different module that nothing here imports.
   */
  | 'ai.byok.spend.view';

/**
 * Role → capability grants. The only place the two are connected.
 *
 * The seeded organization role key `org_admin` and the team-ladder names it can
 * be written from. NOTHING BELOW `admin` ON THE AUTHORITY LADDER IS HERE:
 * `consultant`, `analyst`, `reviewer` and `viewer` are members of a customer
 * organization, not administrators of its vendor accounts, and an ordinary
 * member of an organization holds no BYOK capability at all — not even the
 * read, because "which vendors does this customer hold accounts with" is the
 * customer's business rather than every seat's.
 *
 * `platform_admin` and `super_admin` ARE ABSENT, and their absence is
 * structural rather than a listing decision: the roles this table is consulted
 * with come from `flooredRolesFor`, which reads membership and team roles, and
 * a platform authority name arrives only on `globalRoles`. There is no key that
 * could be added here to make a platform role grant a tenant capability without
 * also changing where the roles come from.
 */
const BYOK_ADMIN_CAPABILITIES: readonly AIByokCapability[] = [
  'ai.byok.view',
  'ai.byok.manage',
  // The spend READ, granted to the same tier that administers the credentials.
  // An organization administrator who may replace the key their traffic
  // executes on is plainly entitled to see what that traffic has cost them, and
  // withholding it would leave a customer unable to explain their own invoice.
  // The MUTATIONS are absent — see `AIByokCapability`.
  'ai.byok.spend.view',
];

export const BYOK_ROLE_CAPABILITIES: Readonly<Record<string, readonly AIByokCapability[]>> = {
  org_admin: BYOK_ADMIN_CAPABILITIES,
  organization_admin: BYOK_ADMIN_CAPABILITIES,
  admin: BYOK_ADMIN_CAPABILITIES,
  owner: BYOK_ADMIN_CAPABILITIES,
};

/**
 * The authenticated customer administrator, scoped to ONE organization.
 *
 * `organization` is the AUTHORITY for every read and write this actor makes.
 * The service derives its storage lookups from this field and from no request
 * input, which is what makes "customer A cannot reach customer B's credential"
 * a property of the type rather than of a check somebody remembered.
 */
export interface ByokActor {
  readonly actorId: string;
  readonly email?: string;
  /** Lower-cased, floored, de-duplicated roles. For the audit record. */
  readonly roles: readonly string[];
  readonly capabilities: readonly AIByokCapability[];
  /** The organization this request is scoped to. Resolved, never asserted. */
  readonly organization: AIOrganization;
}

function lower(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter((value) => value !== '');
}

/**
 * Resolve the BYOK actor, or throw.
 *
 * `organizationHint` is the organization the caller SAYS this request is for.
 * It is not trusted: `resolveOrganization` admits it only when the subject
 * holds a verified membership in it, refuses an unknown one with
 * `ORGANIZATION_NOT_RESOLVED`, and refuses to choose when a subject holds
 * several and named none. So the hint can narrow a caller's own authority and
 * can never widen it — which is the only property a client-supplied tenant
 * identifier is allowed to have.
 */
export function resolveByokActor(
  subject: AuthenticatedSubject | null,
  organizationHint: string | undefined,
  options: OrganizationResolutionOptions,
): ByokActor {
  if (!subject) {
    throw new AIError('AUTH_REQUIRED', 'Authentication is required to manage AI credentials.');
  }

  // A membership resolved from a CACHE is refused outright. Every caller of
  // this surface asks the authenticator for an authoritative resolution, so
  // this never fires in practice — which is exactly why it is cheap to make the
  // failure mode of a future caller forgetting a refusal rather than a
  // credential write authorised off a stale membership snapshot.
  if (subject.membershipsFromCache === true) {
    throw new AIError('FORBIDDEN', 'Your account is not permitted to manage AI credentials.', {
      diagnostics: `subject=${subject.subjectId} memberships resolved from cache`,
    });
  }

  const organization = resolveOrganization(subject, organizationHint, options);

  // THE DEFAULT-ORGANIZATION FALLBACK BUYS NOTHING HERE.
  //
  // `membershipVerified: false` means this subject holds no membership row at
  // all and was placed in the deployment's default organization by
  // `AI_ALLOW_DEFAULT_ORGANIZATION`. That is a legitimate single-tenant console
  // convenience for ordinary reads. It is not a statement that this account
  // belongs to that customer, and it must not authorise storing, rotating or
  // revoking that customer's vendor credential.
  if (!organization.membershipVerified) {
    throw new AIError('FORBIDDEN', 'Your account is not permitted to manage AI credentials.', {
      diagnostics:
        `subject=${subject.subjectId} holds no verified membership in ` +
        `${organization.organizationId}`,
      securityContext: {
        subjectId: subject.subjectId,
        actorType: subject.actorType,
        roles: lower(subject.globalRoles).sort(),
        organizationId: organization.organizationId,
      },
    });
  }

  const membership = subject.memberships.find(
    (entry) => entry.organizationId === organization.organizationId,
  );
  const roles = [...new Set(lower([...flooredRolesFor(subject, membership)]))].sort();

  const granted = new Set<AIByokCapability>();
  for (const role of roles) {
    for (const capability of BYOK_ROLE_CAPABILITIES[role] ?? []) granted.add(capability);
  }

  // PLATFORM AUTHORITY IS NOT TENANT AUTHORITY, IN EITHER DIRECTION, AND
  // THERE IS DELIBERATELY NO CODE HERE THAT MAKES IT SO.
  //
  // A platform operator's global role grants nothing on this surface because
  // `roles` above comes from `flooredRolesFor` — membership and team roles —
  // and `platform_admin` arrives only on `globalRoles`, which this function
  // never consults for a grant. There is no capability to strip afterwards,
  // which is a stronger position than stripping one: an added grant cannot be
  // reached by forgetting to remove it.
  //
  // A platform operator who is ALSO a genuine administrator of this
  // organization keeps exactly what their MEMBERSHIP row gives them, and
  // nothing their platform role does. The converse rule — that a membership row
  // cannot make somebody the operator of the platform — is enforced separately,
  // in `admin/rbac.ts` by `hasPlatformAuthority`.
  //
  // THIS MODULE DELIBERATELY IMPORTS NOTHING FROM THAT ONE. An independent
  // certification gate found this comment claiming the opposite, and the claim
  // was worth correcting rather than making true: the two surfaces do not need
  // to agree about a subject, because neither consults the other's authority.
  // Platform authority arrives only on `globalRoles`, which nothing here reads
  // for a grant; tenant authority arrives only on a membership row, which
  // nothing there reads for one. An import between them would be the first
  // thread by which widening one could widen the other.
  if (granted.size === 0) {
    throw new AIError(
      'FORBIDDEN',
      'Your account is not permitted to manage AI credentials for this organization.',
      {
        diagnostics:
          `subject=${subject.subjectId} organization=${organization.organizationId} ` +
          `roles=${roles.join(',') || 'none'}`,
        securityContext: {
          subjectId: subject.subjectId,
          actorType: subject.actorType,
          roles,
          organizationId: organization.organizationId,
        },
      },
    );
  }

  return {
    actorId: subject.subjectId,
    email: subject.email,
    roles,
    capabilities: [...granted].sort(),
    organization,
  };
}

export function hasByokCapability(actor: ByokActor, capability: AIByokCapability): boolean {
  return actor.capabilities.includes(capability);
}

/**
 * Enforce a capability. Throws `FORBIDDEN`, naming nothing the caller can use.
 *
 * The service calls this on EVERY operation, including the reads. A capability
 * check at one door and a role comparison at the next is how the seventh
 * endpoint gets neither.
 */
export function requireByokCapability(actor: ByokActor, capability: AIByokCapability): void {
  if (hasByokCapability(actor, capability)) return;
  throw new AIError('FORBIDDEN', 'Your role does not permit this action.', {
    diagnostics:
      `actor=${actor.actorId} organization=${actor.organization.organizationId} ` +
      `required=${capability}`,
  });
}
