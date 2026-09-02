/**
 * Execution funding — AI-01 Batch 4D remediation (certified BLOCKER B-1/B-2).
 *
 * WHOSE CHEQUEBOOK MAY THIS ONE REQUEST REACH? Asked once, at the start of the
 * request, and answered for the whole of it.
 *
 * ── THE DEFECT THIS MODULE EXISTS TO CLOSE ────────────────────────────────
 *
 * Batch 4D shipped its fallback policy as a column on a provider CONFIGURATION,
 * which made it a per-(organization, provider) fact. An independent
 * certification proved that is the wrong granularity twice over:
 *
 *   B-1  An organization with `tenant_only` on OpenAI, whose OpenAI credential
 *        failed, failed over to Anthropic — where it had no configuration, so
 *        the absent policy read as `platform` and MARQ's Anthropic credential
 *        executed that customer's traffic.
 *
 *   B-2  Every request reserved against `SPEND_SCOPE.platform` before any
 *        credential was resolved, so a customer running entirely on their own
 *        vendor account still drew down MARQ's lifetime ceiling — and could
 *        exhaust it for every other tenant.
 *
 * Both have the same root: funding was treated as a property of a provider row
 * when it is a property of an EXECUTION. This module makes it one.
 *
 * ── TWO MECHANISMS, AND THE SECOND IS NOT REDUNDANT ───────────────────────
 *
 *   THE PRE-READ.  `ExecutionFundingResolver` reads the organization's whole
 *   estate once per request, before the spend reservation and before the
 *   provider loop, and reduces it to one mode. This is the primary mechanism
 *   and it is what the spend scope is chosen from — a scope has to be picked
 *   before execution, because a reservation that is taken after the money is
 *   spent guards nothing.
 *
 *   THE LATCH.  The pre-read can be unavailable: storage may be unreachable, or
 *   a caller may not supply a resolver at all. So the mode is carried as a
 *   LATCH rather than a constant, and the credential resolver flips it the
 *   moment it observes a `tenant_only` configuration on any provider. A request
 *   whose pre-read failed still refuses MARQ's credential on every candidate
 *   AFTER the one that revealed the policy — which is exactly the B-1 sequence,
 *   closed without depending on the read that failed.
 *
 * The latch only ever tightens. There is no operation on it that returns an
 * execution to `platform_allowed`, so no ordering of providers, retries or
 * failovers can loosen a constraint once it has been established.
 *
 * ── WHAT THIS MODULE IS NOT ───────────────────────────────────────────────
 *
 * It holds no secret, opens nothing, and reads only the non-secret
 * configuration rows. It cannot authorise an execution — it can only narrow
 * which credentials one is allowed to reach.
 *
 * ── AND IT DOES NOT CACHE ─────────────────────────────────────────────────
 *
 * One indexed read per request, served by the partial index Batch 4D created
 * for exactly this lookup. A cache would be cheaper and would be wrong: the
 * value it holds is a SECURITY control, and a stale `platform_allowed` served
 * from a cache after a customer switched to `tenant_only` is the certified
 * defect returning through a different door. The credential resolver already
 * refuses to cache plaintext for the same reason — a revoked credential must
 * stop working on the next request, not at the end of a TTL — and this is the
 * same rule applied to the policy above it.
 */

import { describeForOperator } from '../../contracts/errors.ts';
import type { ProviderAdministrationStore } from './credentialStore.ts';
import { strictestFundingPolicy } from './tenantPrecedence.ts';

/**
 * What this execution is permitted to be funded by.
 *
 *   `platform_allowed`  MARQ's own credential may serve it. The Batch 4C
 *                       behaviour, and what every organization that never opts
 *                       into BYOK gets on every request, forever.
 *
 *   `tenant_only`       This organization's own credential or nothing. No
 *                       candidate provider may resolve a platform-managed or
 *                       deployment-environment credential for it, on any
 *                       attempt, after any failover.
 */
export type AIExecutionFundingMode = 'platform_allowed' | 'tenant_only';

/**
 * The funding decision for one request.
 *
 * `organizationId` is present only for a VERIFIED tenant. The
 * `AI_ALLOW_DEFAULT_ORGANIZATION` fallback — an account with no membership row
 * placed in the deployment's default organization — is not a statement that the
 * caller belongs to that customer, so it buys neither their credential nor
 * their spend scope.
 */
export interface ExecutionFunding {
  readonly mode: AIExecutionFundingMode;
  readonly organizationId?: string;
  /** Non-secret, non-specific. Safe in a log line and an audit record. */
  readonly reason: string;
}

/** The default, and the value that changes nothing for a non-BYOK tenant. */
export const PLATFORM_FUNDING: ExecutionFunding = {
  mode: 'platform_allowed',
  reason: 'no organization-scoped credential policy applies to this request',
};

/**
 * The mode in force for one execution, and the one-way door that tightens it.
 *
 * Carried on the invocation rather than recomputed per attempt, so retries,
 * same-provider retries, cross-provider failover, model fallback and provider
 * selection all read the same object. There is deliberately no setter that
 * widens it.
 */
export interface ExecutionFundingLatch {
  readonly mode: AIExecutionFundingMode;
  readonly organizationId?: string;
  /**
   * Record that a `tenant_only` configuration was observed for this tenant.
   * Irreversible for the remainder of the execution.
   */
  observeTenantOnly(): void;
}

export function createExecutionFundingLatch(funding: ExecutionFunding): ExecutionFundingLatch {
  let mode = funding.mode;
  return {
    get mode() {
      return mode;
    },
    organizationId: funding.organizationId,
    observeTenantOnly() {
      mode = 'tenant_only';
    },
  };
}

export interface ExecutionFundingResolver {
  /**
   * The funding mode for one request, from the organization's whole estate.
   *
   * Never throws. A storage failure degrades to `platform_allowed` and is
   * reported — see `createExecutionFundingResolver`.
   */
  resolve(organization: {
    readonly organizationId: string;
    readonly membershipVerified: boolean;
  }): Promise<ExecutionFunding>;
}

export interface ExecutionFundingResolverOptions {
  readonly store: ProviderAdministrationStore;
  /** Server-side operator channel. Never reaches a response body. */
  readonly onError?: (detail: string) => void;
}

/**
 * Build the pre-read resolver.
 *
 * ── WHY A STORAGE FAILURE DEGRADES TO `platform_allowed` ──────────────────
 *
 * Because the alternative is a platform-wide outage for a fault that tells us
 * nothing. If this read fails we have not learned that an organization is
 * `tenant_only`; we have learned that the table is unreadable — and it is the
 * same table, read the same way, that the Batch 4C platform resolution already
 * treats as "we learned nothing, let the pre-existing resolution stand".
 * Refusing here would take AI down for every tenant on the platform, including
 * the overwhelming majority who never opted into BYOK and for whom refusing
 * buys precisely nothing.
 *
 * THE LATCH IS WHY THAT IS SAFE RATHER THAN MERELY PRAGMATIC. Degrading here
 * does not concede the guarantee: the credential resolver performs its own
 * per-provider read, and the first one that succeeds and reveals `tenant_only`
 * flips the latch for every candidate after it. The residual — this read fails
 * AND the first provider's own read fails AND a later provider then resolves a
 * platform credential — is a state in which the policy was genuinely
 * unknowable from storage, and it is strictly narrower than the certified
 * defect it replaces.
 */
export function createExecutionFundingResolver(
  options: ExecutionFundingResolverOptions,
): ExecutionFundingResolver {
  return {
    async resolve(organization) {
      // An unverified membership is not a tenant. It gets neither the
      // organization's credential nor its spend scope, so there is nothing to
      // read and nothing to narrow.
      if (!organization.membershipVerified) return PLATFORM_FUNDING;

      let configurations: Awaited<
        ReturnType<ProviderAdministrationStore['listOrganizationConfigurations']>
      >;
      try {
        // KEYED BY THE TENANT. There is no call in this module that can return
        // a row belonging to another organization.
        configurations = await options.store.listOrganizationConfigurations(
          organization.organizationId,
        );
      } catch (error) {
        options.onError?.(
          `the organization's credential funding policy could not be read; the platform ` +
            `resolution stands and the per-provider policy still applies: ` +
            `${describeForOperator(error)}`,
        );
        return PLATFORM_FUNDING;
      }

      const policy = strictestFundingPolicy(configurations, organization.organizationId);
      if (policy === 'tenant_only') {
        return {
          mode: 'tenant_only',
          organizationId: organization.organizationId,
          reason:
            'this organization has declared that its AI traffic uses its own provider ' +
            'credentials only',
        };
      }
      return {
        mode: 'platform_allowed',
        organizationId: organization.organizationId,
        reason: 'this organization permits the platform credential behind its own',
      };
    },
  };
}
