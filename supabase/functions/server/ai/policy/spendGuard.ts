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
 *   3. Settle the reservation to the measured cost of every billable attempt —
 *      including the attempts of a request that ultimately failed. A retry that
 *      burned tokens and then errored is money spent, and a ledger that only
 *      charges successes under-counts precisely when spend is running away.
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
import { SPEND_SCOPE, remainingMicroUsd } from './spendLedger.ts';

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

export interface SpendGuard {
  /**
   * Reserve headroom for one request. Throws `BUDGET_EXCEEDED` when the cap is
   * reached or when the projected cost would cross it.
   */
  reserve(descriptor: AIFeatureDescriptor, reservationId: string): Promise<SpendReservationHandle>;
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
  const { ledger, registry, realRequestsEnabled, enforce } = options;

  /**
   * Could a billable provider serve this request at all? Credentials and the
   * enabled flag are checked, but not the circuit — a momentarily open circuit
   * does not mean the request is free, because failover may still land on a
   * paid provider.
   */
  function billableCandidateExists(descriptor: AIFeatureDescriptor): boolean {
    if (!realRequestsEnabled) return false;
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

    async reserve(descriptor, reservationId) {
      if (!billableCandidateExists(descriptor)) return FREE_HANDLE;

      const estimate = estimateFor(descriptor);
      const decision = await ledger.reserve(SPEND_SCOPE.platform, estimate, reservationId);

      if (!decision.granted) {
        if (!enforce) return FREE_HANDLE;
        const remaining = remainingMicroUsd(decision.record);
        throw new AIError(
          'BUDGET_EXCEEDED',
          decision.reason === 'cap_reached'
            ? 'The platform AI spending cap has been reached. AI features are paused until it is raised.'
            : 'This AI request would exceed the remaining platform AI spending allowance.',
          {
            diagnostics:
              `scope=${SPEND_SCOPE.platform} reason=${decision.reason} ` +
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
