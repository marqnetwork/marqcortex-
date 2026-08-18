/**
 * Organization resolution and tenant isolation.
 *
 * Two separate guarantees, deliberately not conflated:
 *
 *   Resolution — decide which organization a request belongs to. A caller may
 *   *hint* at an organization; the hint is only honoured when the authenticated
 *   subject actually holds a membership in it. An unauthenticated caller can
 *   never steer the resolution.
 *
 *   Isolation — every tenant-scoped read or write derives its key from the
 *   resolved organization, and `assertSameTenant` fails closed on any mismatch.
 *   This is the check that turns "we scope by org" from a convention into an
 *   invariant a test can pin.
 */

import type { AIOrganization, AIOrganizationTier } from '../contracts/request.ts';
import type { AuthenticatedSubject, SubjectMembership } from './actor.ts';
import { AIError } from '../contracts/errors.ts';

/** Organization identifiers must be safe to embed in storage keys and logs. */
const ORGANIZATION_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** One segment of a tenant-scoped storage key. `:` is the joiner, so excluded. */
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface OrganizationResolutionOptions {
  /** Organization used when an authenticated subject holds no membership. */
  readonly defaultOrganizationId: string;
  /** When non-empty, only these organizations may execute AI requests. */
  readonly allowList: readonly string[];
  /**
   * Whether a subject with no verified membership may fall back to the default
   * organization.
   *
   * FALSE BY DEFAULT, and that default is the point. A silent fallback means
   * every caller lands in one bucket, every budget and audit key collapses into
   * one scope, and the platform can report "tenant isolation" while having
   * exactly one tenant. When it is enabled — which a single-tenant console
   * deployment legitimately needs — the resulting organization is marked
   * `membershipVerified: false` so the weaker guarantee travels with the request
   * into the audit record instead of being indistinguishable from the strong one.
   */
  readonly allowDefaultOrganization: boolean;
}

/**
 * The isolation prefix for an organization id.
 *
 * Held in one place so a storage adapter that never sees a resolved
 * `AIOrganization` still derives the same prefix the execution path does. A
 * malformed id is refused rather than embedded in a key.
 */
export function isolationKeyFor(organizationId: string): string {
  if (!ORGANIZATION_ID.test(organizationId)) {
    throw new AIError('VALIDATION_FAILED', 'Organization identifier has an unsupported format.', {
      fields: ['organizationId'],
    });
  }
  return `org:${organizationId}`;
}

function toOrganization(
  organizationId: string,
  membership: SubjectMembership | undefined,
  membershipVerified: boolean,
): AIOrganization {
  const tier: AIOrganizationTier = membership?.tier ?? 'standard';
  return {
    organizationId,
    slug: membership?.slug,
    tier,
    membershipVerified,
    // Held separately from the id so a future partition strategy (region,
    // shard, customer-managed key) changes here and nowhere else.
    isolationKey: `org:${organizationId}`,
  };
}

/**
 * Resolve the organization for a request.
 *
 * Order of precedence:
 *   1. A caller hint the subject is actually a member of.
 *   2. The subject's SOLE membership, when they hold exactly one.
 *   3. The configured default, for single-tenant console deployments.
 *
 * A hint the subject does NOT hold is a hard failure, never a silent downgrade:
 * treating it as "use your own org instead" would hide a real access attempt.
 *
 * STEP 2 USED TO BE `memberships[0]`, AND THAT WAS A BUG WAITING FOR A SECOND
 * TENANT. The array's order is whatever the membership query returned — no
 * ORDER BY, so PostgREST's row order, which Postgres does not promise to keep
 * stable across plans, vacuums or a changed index. A consultant who belongs to
 * two client organizations would have had their tenant chosen by the planner:
 * the same request could resolve into a different tenant on the next call, and
 * every budget, audit record and isolation key would follow it there. Nothing
 * would fail; the work would just land in the wrong customer's scope.
 *
 * "Pick the first deterministically" (lowest id, oldest membership) fixes the
 * flapping and keeps the real defect: the platform would still be GUESSING
 * which customer this request is for, and would be right only by luck. There is
 * no policy that makes one of two equally valid memberships correct.
 *
 * So a subject holding more than one membership must SAY which one. That is
 * `ORGANIZATION_REQUIRED` with a diagnostic naming the choices — a hard, honest
 * failure a caller fixes by passing the organization it meant. It is not a
 * default tenant: nothing is selected on the subject's behalf, and a subject
 * with exactly one membership is unaffected, which is every operator in the
 * single-organization deployment this ships into.
 */
export function resolveOrganization(
  subject: AuthenticatedSubject | null,
  hint: string | undefined,
  options: OrganizationResolutionOptions,
): AIOrganization {
  const normalizedHint = hint?.trim();

  if (normalizedHint !== undefined && normalizedHint !== '') {
    if (!ORGANIZATION_ID.test(normalizedHint)) {
      throw new AIError('VALIDATION_FAILED', 'Organization identifier has an unsupported format.', {
        fields: ['organizationId'],
      });
    }
    const membership = subject?.memberships.find((m) => m.organizationId === normalizedHint);
    if (!membership) {
      throw new AIError(
        'ORGANIZATION_NOT_RESOLVED',
        'The requested organization is not available to this account.',
        { diagnostics: `hint=${normalizedHint} subject=${subject?.subjectId ?? 'anonymous'}` },
      );
    }
    return enforceAllowList(toOrganization(normalizedHint, membership, true), options);
  }

  const memberships = subject?.memberships ?? [];
  if (memberships.length === 1) {
    const sole = memberships[0];
    return enforceAllowList(toOrganization(sole.organizationId, sole, true), options);
  }
  if (memberships.length > 1) {
    // Deterministic, and deterministically a refusal. The ids are sorted only
    // so the diagnostic reads the same every time, never to pick one of them.
    const held = [...memberships]
      .map((m) => m.organizationId)
      .sort()
      .join(',');
    throw new AIError(
      'ORGANIZATION_REQUIRED',
      'This account belongs to more than one organization. Specify which one this request is for.',
      {
        diagnostics:
          `subject=${subject?.subjectId ?? 'anonymous'} holds ${memberships.length} verified ` +
          `memberships (${held}) and supplied no organization`,
      },
    );
  }

  // No verified membership. Failing closed here is what stops the default
  // organization from quietly becoming "everyone", which is the state in which
  // a platform reports tenant isolation it does not have.
  if (!options.allowDefaultOrganization) {
    throw new AIError('ORGANIZATION_REQUIRED', 'No organization could be resolved for this request.', {
      diagnostics:
        `subject=${subject?.subjectId ?? 'anonymous'} holds no verified organization membership ` +
        'and AI_ALLOW_DEFAULT_ORGANIZATION is false',
    });
  }

  if (!ORGANIZATION_ID.test(options.defaultOrganizationId)) {
    throw new AIError('ORGANIZATION_REQUIRED', 'No organization could be resolved for this request.', {
      diagnostics: `configured default is not a valid identifier: ${options.defaultOrganizationId}`,
    });
  }
  return enforceAllowList(
    toOrganization(options.defaultOrganizationId, undefined, false),
    options,
  );
}

function enforceAllowList(
  organization: AIOrganization,
  options: OrganizationResolutionOptions,
): AIOrganization {
  if (options.allowList.length === 0) return organization;
  if (options.allowList.includes(organization.organizationId)) return organization;
  throw new AIError('ORGANIZATION_NOT_RESOLVED', 'AI features are not enabled for this organization.', {
    diagnostics: `organization=${organization.organizationId} not in allow list`,
  });
}

/**
 * Fail closed when a resource does not belong to the request's organization.
 * Call this before every tenant-scoped read or write in an AI code path.
 */
export function assertSameTenant(
  organization: AIOrganization,
  resourceOrganizationId: string | null | undefined,
  resourceLabel: string,
): void {
  if (!resourceOrganizationId) {
    throw new AIError('TENANT_ISOLATION_VIOLATION', 'Requested resource is not tenant-scoped.', {
      diagnostics: `${resourceLabel} carries no organization id`,
    });
  }
  if (resourceOrganizationId !== organization.organizationId) {
    throw new AIError('TENANT_ISOLATION_VIOLATION', 'Requested resource belongs to another organization.', {
      diagnostics: `${resourceLabel} org=${resourceOrganizationId} request org=${organization.organizationId}`,
    });
  }
}

/**
 * Build a storage key that cannot be constructed without the tenant prefix.
 * Every AI-owned KV namespace goes through here, so a missing scope is a
 * compile-time impossibility rather than a review-time catch.
 *
 * The parameter is the ISOLATION KEY, not the whole organization. A resolved
 * `AIOrganization` satisfies it structurally, so every existing call site is
 * unchanged — but a storage adapter that holds only an organization id can now
 * use the same builder (via `isolationKeyFor`) instead of growing a second,
 * near-identical key function with its own copy of the segment check. One
 * implementation of "what is a safe key segment" is the point.
 */
export function tenantScopedKey(
  organization: { readonly isolationKey: string },
  namespace: string,
  ...segments: readonly string[]
): string {
  const parts = [organization.isolationKey, `ai:${namespace}`, ...segments];
  for (const part of parts) {
    // Allow-list rather than deny-list: a key segment may only contain
    // characters that are safe in a storage key, a log line and a URL path.
    // A deny-list would have to anticipate every separator, whitespace and
    // control character an input could carry.
    if (!SAFE_KEY_SEGMENT.test(part)) {
      throw new AIError('VALIDATION_FAILED', 'Storage key segment contains an illegal character.', {
        diagnostics: `rejected segment of length ${part.length}`,
      });
    }
  }
  return parts.join(':');
}
