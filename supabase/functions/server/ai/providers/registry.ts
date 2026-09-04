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
  /**
   * Swap the adapter and descriptor of a provider that is ALREADY registered
   * (AI-01 Batch 4E remediation, M-4).
   *
   * Exists because a self-hosted provider's definition lives in storage and can
   * be administered. Without it the only way to apply an edited endpoint was an
   * isolate restart, so the console reported one target while the runtime
   * dialled another until something recycled.
   *
   * IT IS NOT `register` WITH THE DUPLICATE CHECK REMOVED. It refuses a
   * provider that is not already present — so it can never bring one into
   * existence — and it resets the health counters, because success and failure
   * counts describe the endpoint that produced them and carrying them across a
   * change of target would report a new endpoint as proven.
   */
  replace(
    adapter: AIProviderAdapter,
    options?: { enabled?: boolean; certification?: AICertificationStatus },
  ): void;
  get(providerId: string): RegisteredProvider;
  find(providerId: string): RegisteredProvider | undefined;
  list(): readonly RegisteredProvider[];
  /**
   * The AUTHORITATIVE operational state of a registered provider
   * (AI-01 Batch 4E remediation, N-1).
   *
   * ONE ANSWER, so the health read and the eligibility decision cannot
   * disagree. `health()` already returns this value, inside a snapshot that
   * also takes a circuit reading and a credential description; the selector
   * asks per provider per request and must not pay for those to learn one
   * word, so the state is published on its own.
   *
   * It exists because the selector used to re-derive eligibility from
   * `enabled` and `certification` directly. That duplicated the registry's own
   * rule and then drifted from it: a self-hosted provider whose certification
   * had been withdrawn to `testing` while its enable switch was still open was
   * reported `disabled` by `health()` and served traffic anyway.
   */
  state(providerId: string): AIProviderState;
  /**
   * Whether `setEnabled(providerId, true)` would be HONOURED
   * (AI-01 Batch 4E remediation, N-1/N-2).
   *
   * Published so the administration surface can refuse an enable for the same
   * reason the registry would clamp it, without restating the rule. Two copies
   * of a governance decision is one copy too many, and the one that drifts is
   * the one nobody tests.
   *
   * It answers for the certification a re-enable would RESTORE, not for the
   * `disabled` placeholder a disable wrote — see `certificationOnEnable`.
   */
  mayEnable(providerId: string): boolean;
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

  /**
   * True when this provider's certification gate is CLOSED — it declares that
   * enablement requires certification, and it is not certified
   * (AI-01 Batch 4E remediation, M-1).
   *
   * Consulted in TWO places on purpose. `setEnabled` refuses to open the
   * switch, which is what makes the gate durable against the settings overlay;
   * `stateOf` reports the provider disabled regardless, which is the backstop
   * for an `enabled` flag that reached the record some other way. A control
   * applied at one of the two would be a control the other path walks around.
   */
  function certificationGateClosed(provider: RegisteredProvider): boolean {
    return gateClosedFor(provider, provider.certification);
  }

  /** The gate, judged against a NAMED certification rather than the live one. */
  function gateClosedFor(
    provider: RegisteredProvider,
    certification: AICertificationStatus,
  ): boolean {
    return provider.descriptor.certificationGatesEnablement === true && certification !== 'certified';
  }

  /**
   * The certification an ENABLE would put back in force
   * (AI-01 Batch 4E remediation, N-2).
   *
   * Disabling parks the established decision in `certificationBeforeDisable`
   * and writes `disabled` over `certification` as a placeholder. The gate must
   * therefore be judged against what an enable would RESTORE, not against that
   * placeholder — judging it against the placeholder made the restore branch in
   * `setEnabled` unreachable, so a certified self-hosted provider that an
   * operator disabled for containment could never be turned back on. A gate
   * that prevents recovery is a gate that discourages containment.
   *
   * `unverified` is the fallback for a provider disabled before anything was
   * established, which correctly keeps the gate shut.
   */
  function certificationOnEnable(provider: RegisteredProvider): AICertificationStatus {
    if (provider.certification !== 'disabled') return provider.certification;
    return provider.certificationBeforeDisable ?? 'unverified';
  }

  /** Whether an enable would be honoured. The ONE rule, read by two callers. */
  function enablementPermitted(provider: RegisteredProvider): boolean {
    return !gateClosedFor(provider, certificationOnEnable(provider));
  }

  function stateOf(provider: RegisteredProvider): AIProviderState {
    if (certificationGateClosed(provider)) return 'disabled';
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

    replace(adapter, options = {}) {
      const { providerId } = adapter.descriptor;
      const existing = providers.get(providerId);
      if (!existing) {
        throw new AIError('PROVIDER_NOT_FOUND', 'The configured AI provider is not available.', {
          diagnostics: `replace called for an unregistered provider: ${providerId}`,
        });
      }
      if (adapter.descriptor.models.length === 0) {
        throw new AIError('INTERNAL_ERROR', 'AI provider declares no models.', {
          diagnostics: `provider ${providerId} replaced with an empty model list`,
        });
      }
      providers.set(providerId, {
        adapter,
        descriptor: adapter.descriptor,
        enabled: options.enabled ?? false,
        certification: options.certification ?? 'unverified',
        successCount: 0,
        failureCount: 0,
        lastCheckedAtMs: clock.now(),
      });
    },

    get: require,
    find: (providerId) => providers.get(providerId),
    state: (providerId) => stateOf(require(providerId)),
    mayEnable: (providerId) => enablementPermitted(require(providerId)),

    list() {
      return [...providers.values()].sort(
        (a, b) => a.descriptor.priority - b.descriptor.priority,
      );
    },

    setEnabled(providerId, enabled) {
      const provider = require(providerId);
      // ── THE DURABLE CERTIFICATION GATE (4E remediation, M-1) ──────────────
      //
      // CLAMPS RATHER THAN THROWS. `applySettings()` walks every registered
      // provider on each settings adoption; a throw here would abort that loop
      // and leave the rest of the estate holding stale enablement — turning a
      // governance refusal into an outage for providers that had nothing to do
      // with it. The stored intent is simply not honoured, and `stateOf`
      // reports the provider disabled either way.
      //
      // Disabling is never gated. A gate that could stop an operator turning
      // something OFF would be a gate that prevents containment.
      //
      // JUDGED ON THE CERTIFICATION AN ENABLE WOULD RESTORE (N-2), not on the
      // live one. While a provider is disabled its `certification` reads
      // `disabled` — a placeholder this method itself wrote — so testing the
      // live value shut the gate on every previously-certified provider and
      // made the restore branch below unreachable.
      if (enabled && !enablementPermitted(provider)) return;
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
      // Asked of the adapter rather than derived here, because only the adapter
      // holds the credential resolver. An adapter that does not implement the
      // optional method — every test double — reports `none`, which is the
      // pre-Batch-4C answer and is never mistaken for "managed".
      const credential = provider.adapter.credentialStatus?.() ?? { source: 'none' as const };
      return {
        providerId,
        state: stateOf(provider),
        certification: provider.certification,
        credentialsConfigured: provider.adapter.hasCredentials(),
        credentialSource: credential.source,
        credentialFingerprint: credential.fingerprint,
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
        if (certificationGateClosed(provider)) {
          // Said out loud rather than left implicit. An operator who enabled a
          // provider and finds it serving nothing needs the reason on the
          // health read, not in a code comment.
          issues.push(
            `${provider.descriptor.providerId} is not certified and its definition requires ` +
              'certification before it may be enabled — it will not serve traffic',
          );
        }
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
