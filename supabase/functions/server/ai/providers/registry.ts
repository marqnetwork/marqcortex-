/**
 * Provider Registry and Provider Capability Registry.
 *
 * One registry holds two related things:
 *
 *   Providers   — the adapters, their operational state and their certification
 *                 status. A provider that is disabled, uncertified or missing
 *                 credentials is never selected.
 *
 *   Capabilities — the models each provider serves, what each model can do, and
 *                 what each model costs. This is what makes provider
 *                 independence real rather than aspirational: the selector
 *                 matches a *feature's requirements* against *model
 *                 capabilities*, so business logic never names a model.
 *
 * Model pricing lives here too, because cost is a selection input and a budget
 * input, and having two copies of a price table is how a budget engine starts
 * lying.
 */

import type {
  AICertificationStatus,
  AIModelDescriptor,
  AIProviderAdapter,
  AIProviderDescriptor,
  AIProviderHealth,
  AIProviderState,
} from '../contracts/provider.ts';
import type { Clock } from '../runtime/clock.ts';
import type { CircuitBreaker } from './circuitBreaker.ts';
import { AIError } from '../contracts/errors.ts';

export interface ModelRequirements {
  readonly structuredOutput: boolean;
  readonly chatCompletions: boolean;
  readonly minOutputTokens: number;
}

export interface RegisteredProvider {
  readonly adapter: AIProviderAdapter;
  readonly descriptor: AIProviderDescriptor;
  enabled: boolean;
  certification: AICertificationStatus;
  successCount: number;
  failureCount: number;
  lastLatencyMs?: number;
  lastError?: string;
  lastCheckedAtMs: number;
}

export interface ProviderRegistry {
  register(
    adapter: AIProviderAdapter,
    options?: { enabled?: boolean; certification?: AICertificationStatus },
  ): void;
  get(providerId: string): RegisteredProvider;
  find(providerId: string): RegisteredProvider | undefined;
  list(): readonly RegisteredProvider[];
  setEnabled(providerId: string, enabled: boolean): void;
  setCertification(providerId: string, status: AICertificationStatus): void;
  recordSuccess(providerId: string, latencyMs: number): void;
  recordFailure(providerId: string, reason: string): void;
  /** Best model this provider offers for the requirements, or undefined. */
  selectModel(providerId: string, requirements: ModelRequirements): AIModelDescriptor | undefined;
  health(providerId: string): AIProviderHealth;
  healthAll(): readonly AIProviderHealth[];
  /** Configuration problems found across the registry. Empty means healthy. */
  validate(): readonly string[];
  clear(): void;
}

export function createProviderRegistry(clock: Clock, circuit: CircuitBreaker): ProviderRegistry {
  const providers = new Map<string, RegisteredProvider>();

  function require(providerId: string): RegisteredProvider {
    const provider = providers.get(providerId);
    if (!provider) {
      throw new AIError('PROVIDER_NOT_FOUND', 'The configured AI provider is not available.', {
        diagnostics: `providerId=${providerId}`,
      });
    }
    return provider;
  }

  function stateOf(provider: RegisteredProvider): AIProviderState {
    if (!provider.enabled || provider.certification === 'disabled') return 'disabled';
    if (!provider.adapter.hasCredentials()) return 'unavailable';
    const circuitState = circuit.stateOf(provider.descriptor.providerId);
    if (circuitState === 'open') return 'unavailable';
    if (circuitState === 'half_open' || provider.certification === 'degraded') return 'degraded';
    return 'active';
  }

  return {
    register(adapter, options = {}) {
      const { providerId } = adapter.descriptor;
      if (providers.has(providerId)) {
        throw new AIError('INTERNAL_ERROR', 'AI provider is already registered.', {
          diagnostics: `duplicate provider registration: ${providerId}`,
        });
      }
      if (adapter.descriptor.models.length === 0) {
        throw new AIError('INTERNAL_ERROR', 'AI provider declares no models.', {
          diagnostics: `provider ${providerId} registered with an empty model list`,
        });
      }
      providers.set(providerId, {
        adapter,
        descriptor: adapter.descriptor,
        enabled: options.enabled ?? true,
        certification: options.certification ?? 'unverified',
        successCount: 0,
        failureCount: 0,
        lastCheckedAtMs: clock.now(),
      });
    },

    get: require,
    find: (providerId) => providers.get(providerId),

    list() {
      return [...providers.values()].sort(
        (a, b) => a.descriptor.priority - b.descriptor.priority,
      );
    },

    setEnabled(providerId, enabled) {
      const provider = require(providerId);
      provider.enabled = enabled;
      if (!enabled) provider.certification = 'disabled';
    },

    setCertification(providerId, status) {
      require(providerId).certification = status;
    },

    recordSuccess(providerId, latencyMs) {
      const provider = require(providerId);
      provider.successCount += 1;
      provider.lastLatencyMs = latencyMs;
      provider.lastError = undefined;
      provider.lastCheckedAtMs = clock.now();
      // A provider that is answering correctly has demonstrated it works.
      // Promote it out of `unverified` so the health endpoint reflects
      // observed reality rather than a startup-time guess.
      if (provider.certification === 'unverified' || provider.certification === 'degraded') {
        provider.certification = provider.descriptor.productionReady ? 'certified' : 'testing';
      }
    },

    recordFailure(providerId, reason) {
      const provider = require(providerId);
      provider.failureCount += 1;
      provider.lastError = reason.slice(0, 300);
      provider.lastCheckedAtMs = clock.now();
    },

    selectModel(providerId, requirements) {
      const provider = providers.get(providerId);
      if (!provider) return undefined;
      const candidates = provider.descriptor.models.filter((model) => {
        const { capabilities } = model;
        if (requirements.structuredOutput && !capabilities.structuredOutput) return false;
        if (requirements.chatCompletions && !capabilities.chatCompletions) return false;
        if (capabilities.maxOutputTokens < requirements.minOutputTokens) return false;
        return capabilities.textGeneration;
      });
      if (candidates.length === 0) return undefined;
      // Cheapest capable model wins. Capability is already satisfied, so any
      // remaining difference is price — and a consultancy running millions of
      // requests should not pay for headroom the feature declared it needs.
      return [...candidates].sort(
        (a, b) =>
          a.promptMicroUsdPer1k + a.completionMicroUsdPer1k -
          (b.promptMicroUsdPer1k + b.completionMicroUsdPer1k),
      )[0];
    },

    health(providerId) {
      const provider = require(providerId);
      const snapshot = circuit.snapshot(providerId);
      return {
        providerId,
        state: stateOf(provider),
        certification: provider.certification,
        credentialsConfigured: provider.adapter.hasCredentials(),
        circuit: snapshot.state,
        consecutiveFailures: snapshot.consecutiveFailures,
        successCount: provider.successCount,
        failureCount: provider.failureCount,
        lastLatencyMs: provider.lastLatencyMs,
        lastError: provider.lastError,
        checkedAt: new Date(provider.lastCheckedAtMs).toISOString(),
      };
    },

    healthAll() {
      return [...providers.keys()].sort().map((providerId) => this.health(providerId));
    },

    validate() {
      const issues: string[] = [];
      if (providers.size === 0) issues.push('no AI providers are registered');

      const usable = [...providers.values()].filter(
        (provider) => provider.enabled && provider.adapter.hasCredentials(),
      );
      if (usable.length === 0) {
        issues.push('no registered AI provider has credentials configured');
      }
      if (!usable.some((provider) => provider.descriptor.productionReady)) {
        issues.push('no production-ready AI provider is usable — only test providers are available');
      }
      for (const provider of providers.values()) {
        if (provider.certification === 'certified' && !provider.enabled) {
          issues.push(`${provider.descriptor.providerId} is certified but disabled`);
        }
        const ids = provider.descriptor.models.map((model) => model.modelId);
        if (new Set(ids).size !== ids.length) {
          issues.push(`${provider.descriptor.providerId} declares duplicate model ids`);
        }
      }
      return issues;
    },

    clear() {
      providers.clear();
    },
  };
}
