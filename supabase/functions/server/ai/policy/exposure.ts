/**
 * Governed budget exposure — AI-01 Batch 4C.
 *
 * THE INVARIANT THIS PROTECTS.
 *
 * Batch 4B proved that one `cortex.chat` request takes a worst-case spend
 * reservation of 105,920 micro-USD against the MARQ ceiling. That figure is not
 * an implementation detail: it is the number the $0.25 production cap was
 * certified against, and it is a pure function of the registered billable
 * catalogue and the feature's declared limits.
 *
 *   (16,384 prompt tokens x 2,500 uUSD/1k + 1,200 completion tokens
 *    x 10,000 uUSD/1k) x 2 attempts = 105,920 uUSD
 *
 * Provider administration can move that number. Registering a provider with a
 * dearer model, or admitting a dearer model on an existing provider, raises the
 * hold every chat request takes — and a hold that grows silently is how a cap
 * that was proved sufficient stops being sufficient without anybody deciding it
 * should.
 *
 * WHAT THIS MODULE IS, AND WHAT IT IS NOT.
 *
 * It is a CALCULATION and a CEILING CHECK. It computes the platform's worst-case
 * single-request exposure across the governed feature catalogue, so the number
 * can be shown to an operator, pinned by a regression test, and refused when a
 * configuration change would push it past what the deployment governs.
 *
 * It is NOT Batch 4F. There is no routing here, no cost optimisation, no model
 * arbitrage and no economics. One number and one comparison.
 *
 * WHY IT MIRRORS `spendGuard.estimateFor` RATHER THAN CALLING IT.
 *
 * `estimateFor` is a method on a constructed guard, which needs a ledger. This
 * has to answer "what WOULD the exposure be under a catalogue that does not
 * exist yet?" — a hypothetical the guard cannot express. The two are pinned to
 * each other by test rather than by a shared call: `exposureMatchesSpendGuard`
 * in the Batch 4C suite asserts that for the live catalogue they agree, so a
 * change to one that is not made to the other fails immediately.
 */

import type { AIFeatureDescriptor } from '../contracts/policy.ts';
import type { AIModelDescriptor } from '../contracts/provider.ts';

/** Bytes of input per prompt token. The same ratio the spend guard sizes with. */
const BYTES_PER_TOKEN = 4;

/** One provider's billable catalogue, as an exposure calculation sees it. */
export interface ExposureCatalogueEntry {
  readonly providerId: string;
  readonly billable: boolean;
  readonly models: readonly AIModelDescriptor[];
}

export interface FeatureExposure {
  readonly featureId: string;
  readonly worstCaseMicroUsd: number;
  /** The model that produces the worst case, so a refusal can name it. */
  readonly worstCaseModelId?: string;
  readonly worstCaseProviderId?: string;
}

export interface ExposureReport {
  /** Highest single-request reservation any governed feature can take. */
  readonly maxReservationMicroUsd: number;
  readonly maxFeatureId?: string;
  readonly maxModelId?: string;
  readonly maxProviderId?: string;
  readonly features: readonly FeatureExposure[];
}

/**
 * Worst-case reservation for one feature over one catalogue.
 *
 * Iterates every model of every BILLABLE provider, enabled or not, because the
 * spend guard does the same: a disabled provider can be enabled between the
 * estimate and the call, and an estimate that assumed otherwise would
 * under-reserve exactly when configuration is in flux.
 */
export function featureExposure(
  descriptor: AIFeatureDescriptor,
  catalogue: readonly ExposureCatalogueEntry[],
): FeatureExposure {
  const promptTokens = Math.ceil(descriptor.limits.maxInputBytes / BYTES_PER_TOKEN);
  const completionTokens = descriptor.limits.maxOutputTokens;

  let worst = 0;
  let worstModelId: string | undefined;
  let worstProviderId: string | undefined;

  for (const provider of catalogue) {
    if (!provider.billable) continue;
    for (const model of provider.models) {
      const cost =
        (promptTokens * model.promptMicroUsdPer1k) / 1000 +
        (completionTokens * model.completionMicroUsdPer1k) / 1000;
      if (cost > worst) {
        worst = cost;
        worstModelId = model.modelId;
        worstProviderId = provider.providerId;
      }
    }
  }

  return {
    featureId: descriptor.featureId,
    // Every attempt the feature permits can be billable, so the reservation
    // covers the full retry allowance rather than a single call.
    worstCaseMicroUsd: Math.ceil(worst * Math.max(1, descriptor.limits.maxAttempts)),
    worstCaseModelId: worstModelId,
    worstCaseProviderId: worstProviderId,
  };
}

/** Exposure across every governed feature. */
export function exposureReport(
  features: readonly AIFeatureDescriptor[],
  catalogue: readonly ExposureCatalogueEntry[],
): ExposureReport {
  const perFeature = features.map((descriptor) => featureExposure(descriptor, catalogue));
  let max: FeatureExposure | undefined;
  for (const entry of perFeature) {
    if (max === undefined || entry.worstCaseMicroUsd > max.worstCaseMicroUsd) max = entry;
  }
  return {
    maxReservationMicroUsd: max?.worstCaseMicroUsd ?? 0,
    maxFeatureId: max?.featureId,
    maxModelId: max?.worstCaseModelId,
    maxProviderId: max?.worstCaseProviderId,
    features: perFeature.sort((a, b) => b.worstCaseMicroUsd - a.worstCaseMicroUsd),
  };
}

export interface ExposureVerdict {
  readonly permitted: boolean;
  readonly beforeMicroUsd: number;
  readonly afterMicroUsd: number;
  readonly ceilingMicroUsd: number;
  readonly reason?: string;
}

/**
 * May a configuration change be applied?
 *
 * REFUSES only a change that BOTH raises exposure AND puts it past the governed
 * ceiling. Two conditions rather than one, deliberately:
 *
 *   A change that lowers exposure is always safe, even from a state that is
 *   already over the ceiling — refusing it would trap an operator in the unsafe
 *   state the check exists to get them out of.
 *
 *   A change that leaves exposure where it is cannot be the change that made it
 *   unsafe, and blaming it would send an operator to the wrong action.
 */
export function judgeExposureChange(
  before: ExposureReport,
  after: ExposureReport,
  ceilingMicroUsd: number,
): ExposureVerdict {
  const raises = after.maxReservationMicroUsd > before.maxReservationMicroUsd;
  const overCeiling = after.maxReservationMicroUsd > ceilingMicroUsd;
  if (!raises || !overCeiling) {
    return {
      permitted: true,
      beforeMicroUsd: before.maxReservationMicroUsd,
      afterMicroUsd: after.maxReservationMicroUsd,
      ceilingMicroUsd,
    };
  }
  return {
    permitted: false,
    beforeMicroUsd: before.maxReservationMicroUsd,
    afterMicroUsd: after.maxReservationMicroUsd,
    ceilingMicroUsd,
    reason:
      `this change raises the worst-case single-request reservation from ` +
      `${before.maxReservationMicroUsd} to ${after.maxReservationMicroUsd} micro-USD, ` +
      `past the governed ceiling of ${ceilingMicroUsd} ` +
      `(${after.maxProviderId ?? 'unknown'}/${after.maxModelId ?? 'unknown'} on ` +
      `${after.maxFeatureId ?? 'unknown'})`,
  };
}
