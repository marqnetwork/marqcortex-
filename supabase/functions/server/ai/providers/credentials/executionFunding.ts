/**
 * Execution funding — AI-01 Batch 4D remediation (certified BLOCKER B-1/B-2,
 * then re-certified BLOCKER-1).
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
 * ── AND THE DEFECT THE SECOND CERTIFICATION FOUND (BLOCKER-1) ─────────────
 *
 * The first remediation answered the question with TWO values and degraded an
 * unreadable policy to `platform_allowed`. That made the guarantee depend on a
 * read succeeding. The certification reproduced the residual three ways and it
 * is not narrow: an organization declaring `tenant_only` on OpenAI has NO
 * Anthropic row — the ordinary state, and the original defect's own premise —
 * so a single failed estate read plus an open OpenAI circuit is enough for the
 * pipeline to reach Anthropic first, find nothing to tighten the latch with,
 * and execute that customer on MARQ's credential and MARQ's ledger.
 *
 * ONE FAILED READ MUST NOT REOPEN MARQ-FUNDED EXECUTION. So the answer now has
 * THREE values, and the third one is the fix:
 *
 *   `platform_allowed`  We READ the organization's estate and it permits MARQ's
 *                       credential. Also what a deployment with no BYOK storage
 *                       and every non-tenant caller gets — the Batch 4C
 *                       behaviour, unchanged, including failover.
 *
 *   `tenant_only`       We READ the estate and this organization declared that
 *                       its AI traffic uses its own provider credentials only.
 *
 *   `unresolved`        WE DO NOT KNOW. The estate could not be read. This is
 *                       not `platform_allowed` and must never be represented as
 *                       one: an unknowable funding policy fails CLOSED with
 *                       respect to MARQ-funded credentials.
 *
 * `unresolved` is deliberately NOT "refuse the request". A customer whose own
 * credential can still be proven theirs — an organization-scoped configuration
 * row, an organization-scoped credential, a ciphertext whose AAD binds their
 * organization id — may still execute on it. What may not happen is MARQ's
 * platform or deployment-environment credential serving traffic whose funding
 * intent nobody could read, and MARQ's ledger being charged for it.
 *
 * ── STRICTNESS IS ORDERED, AND THE LATCH ONLY EVER MOVES UP IT ────────────
 *
 *     platform_allowed  <  unresolved  <  tenant_only
 *
 * The mode is carried on the invocation as a LATCH rather than a constant, and
 * every operation on it takes the STRICTER of what it holds and what it is
 * told. There is no operation that returns an execution to a weaker state, so
 * no ordering of providers, retries, model fallbacks or cross-provider
 * failovers can loosen a constraint once it has been established.
 *
 * THE STRICT STATE IS ESTABLISHED BEFORE THE PROVIDER LOOP, WHICH IS WHY IT
 * SURVIVES EVERYTHING. The certified residual existed because containment was
 * DISCOVERED mid-flight, by a per-provider read, and therefore depended on
 * reaching a provider that had something to discover. It no longer is: a failed
 * pre-read yields `unresolved` at the top of the request, so an open circuit, a
 * skipped provider, an unconfigured provider, a provider whose own read fails,
 * a retry, a model fallback and a cross-provider failover all inherit the
 * constraint rather than being the thing that was supposed to find it.
 *
 * The per-provider tightening is kept as well, for the case the pre-read cannot
 * cover: a policy row written between the estate read and the provider read.
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
 *
 *   `unresolved`        The organization's funding policy could not be read.
 *                       MARQ-funded credentials are refused exactly as under
 *                       `tenant_only`; the organization's own credential may
 *                       still execute where its ownership is provable. This is
 *                       a CONTAINMENT state, not a declaration, and the two are
 *                       kept apart so an operator triaging a customer's outage
 *                       can tell "they asked for this" from "we could not read
 *                       whether they asked for this".
 */
export type AIExecutionFundingMode = 'platform_allowed' | 'unresolved' | 'tenant_only';

/**
 * Strictness order. Higher is stricter, and the latch only ever moves up it.
 *
 * Numbers rather than a comparison chain so adding a state is one line here
 * and a compile error everywhere a decision must account for it.
 */
const FUNDING_STRICTNESS: Readonly<Record<AIExecutionFundingMode, number>> = {
  platform_allowed: 0,
  unresolved: 1,
  tenant_only: 2,
};

/** The stricter of two modes. Never returns something weaker than either. */
export function strictestFundingMode(
  left: AIExecutionFundingMode,
  right: AIExecutionFundingMode,
): AIExecutionFundingMode {
  return FUNDING_STRICTNESS[right] > FUNDING_STRICTNESS[left] ? right : left;
}

/**
 * May a MARQ-funded credential — platform-managed or deployment-environment —
 * serve this execution?
 *
 * ONE PREDICATE, ASKED BY BOTH DECISIONS. The credential resolver asks it to
 * decide what a provider may open, and the spend guard asks it to decide which
 * ledger the hold is taken against. Two copies of this rule would eventually
 * disagree, and the shape of that disagreement is a customer's traffic billed
 * to MARQ while their console reports otherwise.
 *
 * `platform_allowed` is the ONLY mode that answers yes. `unresolved` answering
 * no is the whole of the BLOCKER-1 remediation.
 */
export function marqFundingPermitted(mode: AIExecutionFundingMode): boolean {
  return mode === 'platform_allowed';
}

/**
 * Is this execution contained to the tenant's own funding?
 *
 * The exact complement of `marqFundingPermitted`, named separately because the
 * two read as opposite questions at their call sites and a reader should not
 * have to negate one to recognise the other.
 */
export function tenantFundedExecution(mode: AIExecutionFundingMode): boolean {
  return !marqFundingPermitted(mode);
}

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
 * The containment state for an organization whose funding policy could not be
 * read.
 *
 * Built with the organization id because the spend scope is derived from the
 * same answer: an execution whose MARQ funding is refused must be held on that
 * organization's own ledger, or the two halves of the decision disagree — MARQ
 * would be barred from serving the request and charged for it anyway.
 */
export function unresolvedFunding(organizationId: string): ExecutionFunding {
  return {
    mode: 'unresolved',
    organizationId,
    reason:
      'this organization’s AI funding policy could not be read, so the platform ' +
      'credential is withheld until it can be',
  };
}

/**
 * The mode in force for one execution, and the one-way door that tightens it.
 *
 * Carried on the invocation rather than recomputed per attempt, so retries,
 * same-provider retries, cross-provider failover, model fallback and provider
 * selection all read the same object. There is deliberately no setter that
 * widens it, and `observe` takes the stricter of the two rather than the newer.
 */
export interface ExecutionFundingLatch {
  readonly mode: AIExecutionFundingMode;
  readonly organizationId?: string;
  /**
   * Record something learned about this execution's funding.
   *
   * Applies the STRICTER of the mode held and the mode observed, so it is safe
   * to call in any order, any number of times, from any attempt. It is
   * irreversible for the remainder of the execution: there is no argument that
   * loosens the latch, because `strictestFundingMode` cannot return a weaker
   * value than the one already held.
   */
  observe(mode: AIExecutionFundingMode): void;
  /**
   * Record that a `tenant_only` configuration was observed for this tenant.
   *
   * The strictest observation there is, kept as a named method because it is
   * the one the credential resolver makes and naming it keeps that call site
   * readable. Equivalent to `observe('tenant_only')`.
   */
  observeTenantOnly(): void;
}

export function createExecutionFundingLatch(funding: ExecutionFunding): ExecutionFundingLatch {
  let mode = funding.mode;
  const observe = (next: AIExecutionFundingMode): void => {
    mode = strictestFundingMode(mode, next);
  };
  return {
    get mode() {
      return mode;
    },
    organizationId: funding.organizationId,
    observe,
    observeTenantOnly: () => observe('tenant_only'),
  };
}

export interface ExecutionFundingResolver {
  /**
   * The funding mode for one request, from the organization's whole estate.
   *
   * Never throws. A storage failure resolves to `unresolved` — NOT to
   * `platform_allowed` — and is reported; see `createExecutionFundingResolver`.
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
 * ── WHY A STORAGE FAILURE IS `unresolved` AND NOT `platform_allowed` ──────
 *
 * The first remediation degraded here, and argued that refusing would take AI
 * down for every tenant including the majority who never opted into BYOK. That
 * argument was answered by an independent certification and the answer is that
 * the degradation is not a smaller failure than the outage — it is a DIFFERENT
 * failure, and a worse one:
 *
 *   The outage is visible, bounded, and ends when storage returns. It spends
 *   nobody's money and moves nobody's traffic.
 *
 *   The degradation is silent. It moves a paying customer's traffic onto MARQ's
 *   vendor account and MARQ's lifetime ceiling while their console goes on
 *   reporting `customer_byok` from a row that still says `active`. Nothing in
 *   the request tells either party it happened, and the invoice arrives later.
 *
 * "A transient storage failure must not silently bill MARQ" is the rule, and
 * `unresolved` is what enforces it.
 *
 * ── WHAT IT COSTS, STATED PLAINLY ─────────────────────────────────────────
 *
 * While this read is failing in a deployment that HAS customer BYOK storage,
 * every verified tenant's request is contained: their own credential still
 * executes, and a tenant with no credential of their own gets no AI rather than
 * MARQ's. That is a real availability cost and it is the accepted one — it is
 * recoverable the moment storage returns, and it is the direction the
 * certification directed the platform to prefer.
 *
 * TWO POPULATIONS DO NOT PAY IT, AND THAT IS DELIBERATE:
 *
 *   A deployment with NO provider administration store injects no resolver at
 *   all, so nothing here runs and every request is `platform_allowed`. That is
 *   every deployment that predates BYOK, unchanged.
 *
 *   A caller with no VERIFIED membership is answered without a read. The
 *   `AI_ALLOW_DEFAULT_ORGANIZATION` fallback places an account with no
 *   membership row in the deployment's default organization; that is not a
 *   statement that they belong to that customer, so no customer's funding
 *   policy applies to them, there is nothing to be unable to read, and their
 *   requests keep MARQ's credential and MARQ's ledger exactly as before.
 *
 * ── AND `platform_allowed` STILL MEANS PLATFORM_ALLOWED ───────────────────
 *
 * A request whose policy was READ and permits MARQ's credential keeps every bit
 * of its resilience: failover, model fallback, the environment credential, all
 * of it. Containment is applied to executions whose funding is tenant-owned or
 * unknown, and to no others.
 */
export function createExecutionFundingResolver(
  options: ExecutionFundingResolverOptions,
): ExecutionFundingResolver {
  return {
    async resolve(organization) {
      // An unverified membership is not a tenant. It gets neither the
      // organization's credential nor its spend scope, so there is nothing to
      // read and nothing to narrow — and, crucially, nothing that could fail to
      // be read. This branch is answered BEFORE any storage call, so a storage
      // outage cannot turn a non-tenant caller into an `unresolved` one.
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
          `the organization's credential funding policy could not be read; MARQ-funded ` +
            `execution is withheld for this request and the organization's own ` +
            `credentials still apply: ${describeForOperator(error)}`,
        );
        return unresolvedFunding(organization.organizationId);
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
