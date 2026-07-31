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
}

function toOrganization(
  organizationId: string,
  membership: SubjectMembership | undefined,
): AIOrganization {
  const tier: AIOrganizationTier = membership?.tier ?? 'standard';
  return {
    organizationId,
    slug: membership?.slug,
    tier,
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
 *   2. The subject's first membership.
 *   3. The configured default, for single-tenant console deployments.
 *
 * A hint the subject does NOT hold is a hard failure, never a silent downgrade:
 * treating it as "use your own org instead" would hide a real access attempt.
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
    return enforceAllowList(toOrganization(normalizedHint, membership), options);
  }

  const primary = subject?.memberships[0];
  if (primary) {
    return enforceAllowList(toOrganization(primary.organizationId, primary), options);
  }

  if (!ORGANIZATION_ID.test(options.defaultOrganizationId)) {
    throw new AIError('ORGANIZATION_REQUIRED', 'No organization could be resolved for this request.', {
      diagnostics: `configured default is not a valid identifier: ${options.defaultOrganizationId}`,
    });
  }
  return enforceAllowList(toOrganization(options.defaultOrganizationId, undefined), options);
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
 */
export function tenantScopedKey(
  organization: AIOrganization,
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
