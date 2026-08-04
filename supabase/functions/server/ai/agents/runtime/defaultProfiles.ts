/**
 * The model profiles the agent runtime ships with (AI-01 Batch 3A).
 *
 * A profile is a band of behaviour bound to a registered AI Control Plane
 * feature. It is NOT a model and NOT a provider: the plane decides which vendor
 * and which model serve a feature, applying the administrator's allow list, the
 * pinned default, provider health and certification. What a profile fixes is
 * the governance the step runs under and the size of the answer it may produce.
 *
 * TWO PROFILES, BECAUSE ONE IS NOT A CHOICE. A cost policy that can only say
 * "yes" or "no" is a budget check, not a routing layer. With a standard and a
 * compact profile the runtime can genuinely downgrade — same prompt, same
 * governance, half the completion allowance — and the projected cost actually
 * falls, which is what makes the downgrade observable in a test and useful in
 * production.
 *
 * THE PRICES HERE ARE PLANNING FIGURES, NOT BILLING FIGURES, and the
 * distinction matters enough to state twice. They are upper-bound rates used to
 * project a step's cost BEFORE it runs, chosen at or above the most expensive
 * model the platform's registered providers currently offer, so a projection
 * over-reserves rather than under-reserves. The authoritative price lives in
 * the provider registry and the authoritative cost is what the control plane
 * reports after the call — which is what the run's ledger actually records.
 */

import type { ModelProfile } from './modelRouting.ts';
import { FEATURE } from '../../features/index.ts';

export const AGENT_MODEL_PROFILE = {
  standard: 'profile.agent.standard',
  compact: 'profile.agent.compact',
} as const;

/**
 * Rates are the highest currently declared by any registered provider
 * (3,000 / 15,000 micro-USD per 1k), so a projection cannot under-estimate
 * whichever vendor the plane selects.
 */
const UPPER_BOUND_PROMPT_MICRO_USD_PER_1K = 3_000;
const UPPER_BOUND_COMPLETION_MICRO_USD_PER_1K = 15_000;

export const DEFAULT_MODEL_PROFILES: readonly ModelProfile[] = [
  {
    profileId: AGENT_MODEL_PROFILE.standard,
    featureId: FEATURE.agentStep,
    displayName: 'Agent step — standard',
    complexity: 'high',
    quality: 'standard',
    latency: 'interactive',
    safety: 'strict',
    requiresStructuredOutput: true,
    maxCompletionTokens: 1_200,
    indicativePromptMicroUsdPer1k: UPPER_BOUND_PROMPT_MICRO_USD_PER_1K,
    indicativeCompletionMicroUsdPer1k: UPPER_BOUND_COMPLETION_MICRO_USD_PER_1K,
    rank: 1,
  },
  {
    profileId: AGENT_MODEL_PROFILE.compact,
    featureId: FEATURE.agentStepCompact,
    displayName: 'Agent step — compact',
    // Still capable of high-complexity work; what it gives up is length, not
    // reasoning. Declaring it `low` would make it unroutable for exactly the
    // steps a budget-constrained run most needs it for.
    complexity: 'high',
    quality: 'baseline',
    latency: 'interactive',
    safety: 'strict',
    requiresStructuredOutput: true,
    maxCompletionTokens: 600,
    indicativePromptMicroUsdPer1k: UPPER_BOUND_PROMPT_MICRO_USD_PER_1K,
    indicativeCompletionMicroUsdPer1k: UPPER_BOUND_COMPLETION_MICRO_USD_PER_1K,
    rank: 2,
  },
];
