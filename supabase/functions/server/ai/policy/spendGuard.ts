/**
 * Spend Guard — the stage that stands between an authorised request and a paid
 * provider call.
 *
 * The daily budget engine answers "has this tenant used its allowance today?".
 * This answers a blunter question: "is MARQ still permitted to spend money at
 * all?". It is the enforcement point for the MARQ-funded lifetime ceiling and
 * for the real-request kill switch, and it runs BEFORE provider selection
 * reaches the network.
 *
 * Order matters and is the whole design:
 *
 *   1. If no billable provider could serve this request, there is nothing to
 *      guard. Mock-mode traffic never touches the ledger, so a full test suite
 *      cannot consume a single cent of the $9.
 *   2. Otherwise estimate the worst case this feature can cost, reserve it, and
 *      only then let the pipeline run.
 *      The hold is durable and carries its own expiry, so a request whose
 *      isolate dies before settlement does not strand headroom forever — see
 *      `spendLedger.ts` for the reclamation rules.
 *   3. Settle the reservation to the measured cost of every billable attempt —
 *      including the attempts of a request that ultimately failed. A retry that
 *      burned tokens and then errored is money spent, and a ledger that only
 *      charges successes under-counts precisely when spend is running away.
 *
 * AI-01 BATCH 4D REMEDIATION: the ledger SCOPE is now a parameter rather than
 * the constant `SPEND_SCOPE.platform`. An execution constrained to a customer's
 * own credentials is held and settled against that organization's scope, so a
 * BYOK customer can neither consume MARQ's ceiling nor be refused by it. See
 * `SpendFunding` for the rule and why it is decidable before execution.
 *
 * The estimate is deliberately pessimistic: prompt tokens are approximated from
 * the feature's declared input ceiling and completion tokens from its output
 * ceiling, priced at the most expensive eligible model. Over-reserving costs a
 * little headroom for the duration of one request; under-reserving lets the cap
 * be crossed.
 */

import type { AIFeatureDescriptor } from '../contracts/policy.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { SpendLedger, SpendRecord, SpendReservation } from './spendLedger.ts';
import { AIError } from '../contracts/errors.ts';
import { SPEND_SCOPE, isSpendDenied, remainingMicroUsd } from './spendLedger.ts';
import type { AIExecutionFundingMode } from '../providers/credentials/executionFunding.ts';
import { marqFundingPermitted } from '../providers/credentials/executionFunding.ts';
import { isolationKeyFor } from '../security/tenancy.ts';

/**
 * Bytes of input per prompt token. Four is the conventional English-text ratio
 * and is used only to size a reservation, never to bill — billing always uses
 * the provider's reported usage.
 */
const BYTES_PER_TOKEN = 4;

export interface SpendReservationHandle {
  /** Micro-USD held for this request. Zero when nothing billable can run. */
  readonly estimateMicroUsd: number;
  /** True when a reservation was actually taken against the ledger. */
  readonly reserved: boolean;
  /** Charge the measured cost and release the remainder. Idempotent. */
  settle(actualMicroUsd: number): Promise<void>;
  /** Give the whole reservation back. Used when nothing billable ran. */
  release(): Promise<void>;
}

/**
 * The scope one request's spend is held and settled against.
 *
 * ── WHY THIS IS A PARAMETER NOW (4D remediation, BLOCKER B-2) ─────────────
 *
 * It used to be the constant `SPEND_SCOPE.platform`, for every request, taken
 * before any credential was resolved. A certification proved what that costs
 * once customers bring their own keys: an organization running entirely on its
 * own vendor account still drew down MARQ's lifetime ceiling, and could exhaust
 * it — denying AI to every other tenant and to MARQ's own features — over spend
 * MARQ was never billed for. The mirror case was equally wrong: that customer
 * was refused once MARQ's ceiling filled, for money they were paying
 * themselves.
 *
 * ── THE RULE, AND WHY IT IS DECIDABLE BEFORE EXECUTION ────────────────────
 *
 * A reservation must be taken BEFORE a provider is reached, or it guards
 * nothing — so the scope has to be chosen from something knowable in advance.
 * "Which credential will actually answer?" is not knowable then. "Is this
 * execution permitted to reach MARQ's credential at all?" is.
 *
 *   `tenant_only`      Reserved and settled on the ORGANIZATION scope. Safe
 *                      because B-1's fix makes it provable: no candidate
 *                      provider can resolve a platform or environment
 *                      credential for such an execution, on any attempt, so
 *                      every micro-USD it spends is the customer's own.
 *
 *   `unresolved`       ALSO the organization scope, and for the same reason
 *                      (BLOCKER-1). An execution whose funding policy could not
 *                      be read is refused MARQ's credential on every candidate,
 *                      so MARQ cannot be billed for it and MARQ's ceiling must
 *                      neither bound it nor be consumed by it. SPEND SCOPE AND
 *                      CREDENTIAL ELIGIBILITY ARE DERIVED FROM ONE PREDICATE —
 *                      `marqFundingPermitted` — precisely so the two cannot
 *                      disagree; holding an unresolved execution on MARQ's
 *                      ledger while barring MARQ's credential from serving it
 *                      would be a transient storage fault silently billing MARQ,
 *                      which is the rule this remediation exists to enforce.
 *
 *   `platform_allowed` Reserved and settled on the PLATFORM scope, exactly as
 *                      before. MARQ's credential MAY serve this request, and
 *                      MARQ's ceiling is what bounds MARQ's exposure.
 *
 * The residual is deliberate and conservative: an organization that holds its
 * own credential but leaves the default `platform` policy in place still
 * reserves against MARQ's ceiling, because MARQ's credential genuinely might
 * serve it. That over-protects MARQ's ceiling and never under-protects it, and
 * the customer's remedy is one console action — declare `tenant_only`.
 *
 * RESERVATION AND SETTLEMENT CANNOT DIVERGE. The scope is resolved once, here,
 * and the `SpendReservation` the ledger returns carries it; `settle` and
 * `release` take that reservation rather than a scope, so there is no call
 * shape in which a request settles somewhere it did not reserve.
 */
export interface SpendFunding {
  readonly mode: AIExecutionFundingMode;
  readonly organizationId?: string;
}

/**
 * Resolve the ledger scope for one request's funding.
 *
 * Exported so the audit surface and the tests name the same scope the guard
 * used, rather than reconstructing the rule and eventually disagreeing with it.
 */
export function spendScopeFor(funding: SpendFunding | undefined): string {
  // BOTH halves required. A contained mode with no organization id is a
  // contradiction the resolver does not produce — an unverified membership is
  // answered `platform_allowed` before any read, so it can be neither
  // `tenant_only` nor `unresolved` — but a scope built from `undefined` would
  // read `spend:org:undefined:lifetime` and silently pool every such request
  // into one shared bucket, which is the opposite of the isolation this exists
  // for. A contained execution that somehow lacked an id therefore falls to the
  // platform scope, which over-protects MARQ's ceiling and never under-protects
  // it — and cannot leak one tenant's spend into another's.
  if (funding !== undefined && !marqFundingPermitted(funding.mode) && funding.organizationId) {
    // VALIDATED, THROUGH THE ONE VALIDATOR, BEFORE IT BECOMES A KEY.
    //
    // This scope becomes a KV key (`ai:spend:<scope>`), and this remediation is
    // what makes an organization id reach one for the first time. Two of the
    // three paths in `resolveOrganization` already check the id against
    // `ORGANIZATION_ID`; the sole-membership path does not, because it takes the
    // value straight off a membership row. That row holds a UUID today, so
    // nothing unsafe can arrive — but "nothing unsafe can arrive" is a property
    // of a column type in another schema, and an id carrying the `:` this key
    // format joins on could address another scope's ledger entirely.
    //
    // `isolationKeyFor` is the platform's single answer to "is this id safe to
    // embed in a storage key". Asking it rather than re-implementing the rule
    // here is what stops the two drifting; it THROWS on a bad id, which is the
    // correct direction — quietly falling back to the platform scope would put
    // a customer's spend on MARQ's ledger, which is the exact defect this
    // function exists to prevent.
    isolationKeyFor(funding.organizationId);
    return SPEND_SCOPE.organization(funding.organizationId);
  }
  return SPEND_SCOPE.platform;
}

export interface SpendGuard {
  /**
   * Reserve headroom for one request. Throws `BUDGET_EXCEEDED` when the cap is
   * reached or when the projected cost would cross it.
   *
   * `funding` decides WHICH ledger scope the hold is taken against. Omitted, it
   * is the MARQ platform scope — the Batch 4C behaviour, and what every caller
   * that knows nothing about tenant funding continues to get.
   */
  reserve(
    descriptor: AIFeatureDescriptor,
    reservationId: string,
    funding?: SpendFunding,
  ): Promise<SpendReservationHandle>;
  /** Current ceiling state, for the health endpoint and metrics. */
  status(): Promise<SpendRecord>;
  /** Worst-case micro-USD this feature can cost on the priciest eligible model. */
  estimateFor(descriptor: AIFeatureDescriptor): number;
}

export interface SpendGuardOptions {
  readonly ledger: SpendLedger;
  readonly registry: ProviderRegistry;
  /**
   * False keeps every billable provider out of selection, so no reservation is
   * ever needed and no real vendor call can happen.
   */
  readonly realRequestsEnabled: boolean;
  /** Enforce the ceiling. False records spend without refusing requests. */
  readonly enforce: boolean;
}

/** A no-op handle, for requests that cannot reach a paid provider. */
const FREE_HANDLE: SpendReservationHandle = {
  estimateMicroUsd: 0,
  reserved: false,
  settle: () => Promise.resolve(),
  release: () => Promise.resolve(),
};

export function createSpendGuard(options: SpendGuardOptions): SpendGuard {
  const { ledger, registry } = options;
  // `realRequestsEnabled` and `enforce` are read through `options` on every
  // call rather than destructured once. The control plane supplies them as live
  // getters over the administrative overlay (AI-01 Batch 2), and a value copied
  // at construction would make the kill switch wait for an isolate to recycle.
  const enforce = () => options.enforce;

  /**
   * Could a billable provider serve this request at all? Credentials and the
   * enabled flag are checked, but not the circuit — a momentarily open circuit
   * does not mean the request is free, because failover may still land on a
   * paid provider.
   */
  function billableCandidateExists(descriptor: AIFeatureDescriptor): boolean {
    if (!options.realRequestsEnabled) return false;
    return registry.list().some(
      (provider) =>
        provider.descriptor.billable &&
        provider.enabled &&
        provider.certification !== 'disabled' &&
        provider.adapter.hasCredentials() &&
        registry.selectModel(provider.descriptor.providerId, {
          structuredOutput: descriptor.requiredCapabilities.structuredOutput,
          chatCompletions: descriptor.requiredCapabilities.chatCompletions,
          minOutputTokens: descriptor.limits.maxOutputTokens,
        }) !== undefined,
    );
  }

  function estimateFor(descriptor: AIFeatureDescriptor): number {
    const promptTokens = Math.ceil(descriptor.limits.maxInputBytes / BYTES_PER_TOKEN);
    const completionTokens = descriptor.limits.maxOutputTokens;

    let worst = 0;
    for (const provider of registry.list()) {
      if (!provider.descriptor.billable) continue;
      for (const model of provider.descriptor.models) {
        const cost =
          (promptTokens * model.promptMicroUsdPer1k) / 1000 +
          (completionTokens * model.completionMicroUsdPer1k) / 1000;
        worst = Math.max(worst, cost);
      }
    }
    // Every attempt the feature permits can be billable, so the reservation
    // covers the full retry allowance rather than a single call.
    return Math.ceil(worst * Math.max(1, descriptor.limits.maxAttempts));
  }

  return {
    estimateFor,

    status: () => ledger.read(SPEND_SCOPE.platform),

    async reserve(descriptor, reservationId, funding) {
      if (!billableCandidateExists(descriptor)) return FREE_HANDLE;

      // Resolved ONCE, before the hold. Everything downstream — the denial
      // message, the diagnostic, the settlement — reads this one value, and the
      // reservation the ledger hands back carries it, so nothing can settle
      // against a scope it did not reserve against.
      const scope = spendScopeFor(funding);
      const tenantFunded = scope !== SPEND_SCOPE.platform;

      const estimate = estimateFor(descriptor);
      // The feature id rides along as the hold's owner: after an isolate
      // restart the durable record has to say what took the money, not just how
      // much was taken.
      const decision = await ledger.reserve(scope, estimate, reservationId, {
        owner: descriptor.featureId,
      });

      if (isSpendDenied(decision)) {
        if (!enforce()) return FREE_HANDLE;
        const remaining = remainingMicroUsd(decision.record);
        throw new AIError(
          'BUDGET_EXCEEDED',
          // The message names WHOSE allowance was reached, because the remedy
          // differs entirely. A tenant-funded refusal is that organization's own
          // governed ceiling and is raised for that organization alone; it must
          // not read as "MARQ has run out", which would send an administrator to
          // the wrong console and imply an outage that is not happening.
          tenantFunded
            ? decision.reason === 'cap_reached'
              ? 'Your organization’s AI spending allowance has been reached. AI features are paused for your organization until it is raised.'
              : 'This AI request would exceed your organization’s remaining AI spending allowance.'
            : decision.reason === 'cap_reached'
              ? 'The platform AI spending cap has been reached. AI features are paused until it is raised.'
              : 'This AI request would exceed the remaining platform AI spending allowance.',
          {
            diagnostics:
              `scope=${scope} reason=${decision.reason} ` +
              `estimate=${estimate} spent=${decision.record.spentMicroUsd} ` +
              `reserved=${decision.record.reservedMicroUsd} cap=${decision.record.capMicroUsd} ` +
              `remaining=${remaining}`,
          },
        );
      }

      const reservation: SpendReservation = decision.reservation;
      let closed = false;

      return {
        estimateMicroUsd: estimate,
        reserved: true,
        async settle(actualMicroUsd) {
          if (closed) return;
          closed = true;
          await ledger.settle(reservation, actualMicroUsd);
        },
        async release() {
          if (closed) return;
          closed = true;
          await ledger.release(reservation);
        },
      };
    },
  };
}
