/**
 * Provider Selector.
 *
 * Turns a feature's declared requirements into an ordered list of concrete
 * (provider, model) candidates. This is the component that makes Constitution
 * Article 2 hold: business logic states what it needs — structured output, a
 * token ceiling — and never which vendor serves it.
 *
 * Selection order:
 *   1. Configured preference order (`AI_PROVIDER_PREFERENCE`), then descriptor
 *      priority for anything unlisted. Operators steer traffic by configuration.
 *   2. Skip providers that are disabled, uncertified, billable while the
 *      real-request kill switch is off, missing credentials, or whose circuit
 *      is open.
 *   3. Skip providers with no model meeting the requirements.
 *   4. Append the configured fallback last if it is not already present, so a
 *      deliberate last-resort provider is always tried before giving up.
 *
 * Returning a *list* rather than one choice is what makes failover work: the
 * pipeline walks the candidates, and a failoverable error moves to the next.
 */

import type { AIModelDescriptor } from '../contracts/provider.ts';
import type { ModelRequirements, ProviderRegistry } from './registry.ts';
import type { CircuitBreaker } from './circuitBreaker.ts';
import { AIError } from '../contracts/errors.ts';

export interface ProviderCandidate {
  readonly providerId: string;
  readonly model: AIModelDescriptor;
}

export interface SelectorOptions {
  readonly preference: readonly string[];
  readonly fallbackProviderId?: string;
  readonly failoverEnabled: boolean;
  /**
   * The real-request kill switch. While false, every provider that spends money
   * with an external vendor is removed from selection here — at the structural
   * boundary, where the refusal is visible in `explain()` and on the health
   * endpoint, rather than as a check some future call site could forget.
   */
  readonly realRequestsEnabled: boolean;
  /**
   * Refuse providers whose certification has not been established. An
   * `unverified` adapter has never been shown to work against this platform's
   * contract, and production traffic is not the place to find out.
   */
  readonly requireCertification: boolean;
}

export interface ProviderSelector {
  /** Ordered candidates. Throws NO_PROVIDER_AVAILABLE when none qualify. */
  select(requirements: ModelRequirements): readonly ProviderCandidate[];
  /** Why each provider was skipped. Powers the operational health endpoint. */
  explain(requirements: ModelRequirements): Readonly<Record<string, string>>;
}

export function createProviderSelector(
  registry: ProviderRegistry,
  circuit: CircuitBreaker,
  options: SelectorOptions,
): ProviderSelector {
  /** Ranked provider ids: configured preference first, then descriptor order. */
  function orderedProviderIds(): readonly string[] {
    const registered = registry.list().map((provider) => provider.descriptor.providerId);
    const preferred = options.preference.filter((id) => registered.includes(id));
    const rest = registered.filter((id) => !preferred.includes(id));
    const ordered = [...preferred, ...rest];

    const fallback = options.fallbackProviderId;
    if (fallback && registered.includes(fallback)) {
      // Fallback is last resort by definition — move it to the end even if the
      // preference list happens to mention it earlier.
      const withoutFallback = ordered.filter((id) => id !== fallback);
      return [...withoutFallback, fallback];
    }
    return ordered;
  }

  function reject(providerId: string, requirements: ModelRequirements): string | null {
    const provider = registry.find(providerId);
    if (!provider) return 'not registered';
    // ── ELIGIBILITY ASKS THE REGISTRY, IT DOES NOT RE-DERIVE IT ─────────────
    //
    // (AI-01 Batch 4E remediation, N-1.) `registry.state()` is the ONE place a
    // provider's operational state is decided, and it is where the
    // certification gate lives. This used to read `provider.enabled` and
    // `provider.certification` directly, which duplicated that rule and then
    // drifted from it: a self-hosted provider whose certification had been
    // withdrawn to `testing` or `degraded` while its enable switch was still
    // open was reported `disabled` by `health()` and selected anyway. A
    // control plane that says one thing on the health read and does another on
    // the execution path is worse than no control at all.
    //
    // The DECISION below is the registry's. The reason is presentation only —
    // it names which input an operator has to act on, and no edit to it can
    // change whether a provider is eligible.
    if (registry.state(providerId) === 'disabled') {
      if (!provider.enabled) return 'disabled';
      if (provider.certification === 'disabled') return 'certification disabled';
      return 'certification required before this provider may serve';
    }
    // The kill switch, applied before credentials: a deployment with real keys
    // configured but real requests turned off must report the switch as the
    // reason, not imply the keys are the problem.
    if (!options.realRequestsEnabled && provider.descriptor.billable) {
      return 'real provider requests are disabled (AI_ALLOW_REAL_REQUESTS=false)';
    }
    if (options.requireCertification && provider.certification === 'unverified') {
      return 'certification not established';
    }
    if (!provider.adapter.hasCredentials()) return 'credentials not configured';
    if (circuit.stateOf(providerId) === 'open') return 'circuit open';
    if (!registry.selectModel(providerId, requirements)) return 'no model meets the requirements';
    return null;
  }

  return {
    select(requirements) {
      const candidates: ProviderCandidate[] = [];
      for (const providerId of orderedProviderIds()) {
        if (reject(providerId, requirements) !== null) continue;
        const model = registry.selectModel(providerId, requirements);
        if (!model) continue;
        candidates.push({ providerId, model });
        if (!options.failoverEnabled) break;
      }

      if (candidates.length === 0) {
        const reasons = Object.entries(this.explain(requirements))
          .map(([providerId, reason]) => `${providerId}: ${reason}`)
          .join('; ');
        throw new AIError('NO_PROVIDER_AVAILABLE', 'No AI provider is currently able to serve this request.', {
          diagnostics: reasons || 'no providers registered',
        });
      }
      return candidates;
    },

    explain(requirements) {
      const explanation: Record<string, string> = {};
      for (const provider of registry.list()) {
        const providerId = provider.descriptor.providerId;
        explanation[providerId] = reject(providerId, requirements) ?? 'eligible';
      }
      return explanation;
    },
  };
}

/** Micro-USD cost of a completion at a model's rates. Integer arithmetic. */
export function estimateCostMicroUsd(
  model: AIModelDescriptor,
  usage: { promptTokens: number; completionTokens: number },
): number {
  const prompt = (usage.promptTokens * model.promptMicroUsdPer1k) / 1000;
  const completion = (usage.completionTokens * model.completionMicroUsdPer1k) / 1000;
  return Math.round(prompt + completion);
}
