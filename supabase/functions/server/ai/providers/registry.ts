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
  /** When this provider last failed. Operational fact, not a metric. */
  lastFailureAtMs?: number;
  /** When it last succeeded after a failure — its most recent recovery. */
  lastRecoveryAtMs?: number;
  /**
   * Certification held before an administrator disabled the provider, so
   * re-enabling restores what was established rather than silently demoting a
   * certified adapter to unverified.
   */
  certificationBeforeDisable?: AICertificationStatus;
}

/**
 * Administrative narrowing of which models a provider may serve.
 *
 * A port rather than registry state, because the authority for it is the
 * operational settings overlay: the registry asks the current answer at
 * selection time, so an administrator's change takes effect on the next request
 * without the registry holding a second copy of the setting.
 *
 * Narrowing only. An allow list can remove a model the adapter declares; it can
 * never add one, because a model the adapter does not implement is not a
 * configuration question.
 */
export interface ModelPolicy {
  /** Permitted model ids for a provider. Empty means every declared model. */
  allowList(providerId: string): readonly string[];
  /** Preferred model id, used when it is registered and meets requirements. */
  preferred(providerId: string): string | undefined;
}

/** The policy in force when no administrative narrowing is configured. */
export const OPEN_MODEL_POLICY: ModelPolicy = {
  allowList: () => [],
  preferred: () => undefined,
};

function isoOrUndefined(atMs: number | undefined): string | undefined {
  return atMs === undefined ? undefined : new Date(atMs).toISOString();
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
  /**
   * Every model this provider declares, with the administrative allow list
   * applied. This is what an administration console lists — the models that
   * could actually be selected, not the adapter's full catalogue.
   */
  models(providerId: string): readonly AIModelDescriptor[];
  health(providerId: string): AIProviderHealth;
  healthAll(): readonly AIProviderHealth[];
  /** Configuration problems found across the registry. Empty means healthy. */
  validate(): readonly string[];
  clear(): void;
}

export function createProviderRegistry(
  clock: Clock,
  circuit: CircuitBreaker,
  modelPolicy: ModelPolicy = OPEN_MODEL_POLICY,
): ProviderRegistry {
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

  /**
   * The models this provider may serve after the administrative allow list.
   *
   * FAILS CLOSED. An allow list that matches nothing the adapter declares
   * narrows to nothing, and the provider serves no traffic.
   *
   * The original behaviour here was to ignore such a list and serve the whole
   * catalogue, on the reasoning that a typo should not take a provider out of
   * rotation. That reasoning is backwards for a security control: an operator
   * who restricts a provider to one model and gets the full catalogue has been
   * given the opposite of what they asked for, and the console showed every
   * model as permitted while it happened. A narrowing that cannot be applied
   * must not silently become no narrowing — so the write is now rejected at the
   * administration boundary (`updateProvider`), and this function is the
   * backstop for a list that reached storage some other way.
   */
  function permittedModels(provider: RegisteredProvider): readonly AIModelDescriptor[] {
    const allowed = modelPolicy.allowList(provider.descriptor.providerId);
    if (allowed.length === 0) return provider.descriptor.models;
    return provider.descriptor.models.filter((model) => allowed.includes(model.modelId));
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
      if (provider.enabled === enabled) return;
      if (!enabled) {
        // Remember what was established, so turning the provider back on does
        // not quietly demote a certified adapter. Without this, an operator who
        // disabled a provider during an incident and re-enabled it afterwards
        // would find it refused by `requireCertifiedProviders` — the recovery
        // action would leave the platform in a worse state than the outage.
        if (provider.certification !== 'disabled') {
          provider.certificationBeforeDisable = provider.certification;
        }
        provider.certification = 'disabled';
      } else if (provider.certification === 'disabled') {
        provider.certification = provider.certificationBeforeDisable ?? 'unverified';
        provider.certificationBeforeDisable = undefined;
      }
      provider.enabled = enabled;
    },

    setCertification(providerId, status) {
      require(providerId).certification = status;
    },

    recordSuccess(providerId, latencyMs) {
      const provider = require(providerId);
      // A success that follows a failure IS the recovery. Recording it only on
      // a circuit transition would miss the common case: a provider that failed
      // a few times without ever crossing the breaker threshold still recovered,
      // and an operator reading the console needs to see when.
      if (provider.lastError !== undefined) provider.lastRecoveryAtMs = clock.now();
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
      provider.lastFailureAtMs = clock.now();
      provider.lastCheckedAtMs = clock.now();
    },

    models(providerId) {
      const provider = providers.get(providerId);
      if (!provider) return [];
      return permittedModels(provider);
    },

    selectModel(providerId, requirements) {
      const provider = providers.get(providerId);
      if (!provider) return undefined;
      const candidates = permittedModels(provider).filter((model) => {
        const { capabilities } = model;
        if (requirements.structuredOutput && !capabilities.structuredOutput) return false;
        if (requirements.chatCompletions && !capabilities.chatCompletions) return false;
        if (capabilities.maxOutputTokens < requirements.minOutputTokens) return false;
        return capabilities.textGeneration;
      });
      if (candidates.length === 0) return undefined;

      // An administrator's pinned model wins — but only when it is one of the
      // candidates, which means it is both permitted and capable. A pin can
      // steer selection; it can never override a capability requirement, or a
      // console setting would produce a paid call whose response the feature
      // cannot parse.
      const preferred = modelPolicy.preferred(providerId);
      if (preferred !== undefined) {
        const pinned = candidates.find((model) => model.modelId === preferred);
        if (pinned) return pinned;
      }

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
        lastFailureAt: isoOrUndefined(provider.lastFailureAtMs),
        lastRecoveryAt: isoOrUndefined(provider.lastRecoveryAtMs),
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
        const allowed = modelPolicy.allowList(provider.descriptor.providerId);
        const unknown = allowed.filter((modelId) => !ids.includes(modelId));
        if (allowed.length > 0 && unknown.length === allowed.length) {
          issues.push(
            `${provider.descriptor.providerId} model allow list matches no declared model ` +
              `(${unknown.join(', ')}) — the list is being ignored`,
          );
        } else if (unknown.length > 0) {
          issues.push(
            `${provider.descriptor.providerId} model allow list names unknown models: ${unknown.join(', ')}`,
          );
        }
        const preferred = modelPolicy.preferred(provider.descriptor.providerId);
        if (preferred !== undefined && !ids.includes(preferred)) {
          issues.push(
            `${provider.descriptor.providerId} does not serve the pinned default model ${preferred}`,
          );
        }
      }
      return issues;
    },

    clear() {
      providers.clear();
    },
  };
}
