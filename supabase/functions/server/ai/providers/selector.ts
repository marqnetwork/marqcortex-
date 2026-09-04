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
import type {
  RoutingDecision,
  RoutingSignal,
  RoutingStrategy,
  RoutingWorkload,
} from '../routing/contracts/routing.ts';
import { routeCandidates } from '../routing/engine/routingPolicy.ts';
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
  /**
   * How eligible candidates are ORDERED, and how far one request may fail over
   * (AI-01 Batch 4F).
   *
   * Optional, and its absence is the pre-4F behaviour exactly: the preference
   * order the block comment above describes, with no breadth bound. Every
   * consumer that does not care about routing — the health endpoint, the
   * administration surface, the existing suites — keeps working unchanged, and
   * a routing policy cannot become load-bearing by accident.
   */
  readonly routing?: {
    readonly strategy: RoutingStrategy;
    readonly maxProviders: number;
  };
}

export interface ProviderSelector {
  /** Ordered candidates. Throws NO_PROVIDER_AVAILABLE when none qualify. */
  select(requirements: ModelRequirements, workload?: RoutingWorkload): readonly ProviderCandidate[];
  /**
   * The same candidates, with the routing decision that produced them
   * (AI-01 Batch 4F).
   *
   * ELIGIBILITY IS DECIDED FIRST AND SEPARATELY, by exactly the code `select`
   * has always used. The decision this returns is an ORDERING of that answer
   * plus the economics that justified it — it cannot contain a provider
   * `reject()` refused, and `routeCandidates` asserts as much.
   */
  route(
    requirements: ModelRequirements,
    workload: RoutingWorkload,
  ): { readonly decision: RoutingDecision; readonly candidates: readonly ProviderCandidate[] };
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

  /**
   * THE ELIGIBILITY PASS. Unchanged by Batch 4F and deliberately kept whole:
   * this is the code that applies the kill switch, the certification gate, the
   * credential check, the circuit and the capability match, and routing is
   * layered on top of its answer rather than mixed into it.
   *
   * `failoverEnabled` still stops the walk at the first eligible provider, so a
   * deployment with failover off never even builds a second candidate.
   */
  function eligible(requirements: ModelRequirements): readonly ProviderCandidate[] {
    const candidates: ProviderCandidate[] = [];
    for (const providerId of orderedProviderIds()) {
      if (reject(providerId, requirements) !== null) continue;
      const model = registry.selectModel(providerId, requirements);
      if (!model) continue;
      candidates.push({ providerId, model });
      if (!options.failoverEnabled) break;
    }
    return candidates;
  }

  function unavailable(requirements: ModelRequirements): AIError {
    const reasons = Object.entries(explanation(requirements))
      .map(([providerId, reason]) => `${providerId}: ${reason}`)
      .join('; ');
    return new AIError(
      'NO_PROVIDER_AVAILABLE',
      'No AI provider is currently able to serve this request.',
      { diagnostics: reasons || 'no providers registered' },
    );
  }

  function explanation(requirements: ModelRequirements): Readonly<Record<string, string>> {
    const explained: Record<string, string> = {};
    for (const provider of registry.list()) {
      const providerId = provider.descriptor.providerId;
      explained[providerId] = reject(providerId, requirements) ?? 'eligible';
    }
    return explained;
  }

  /**
   * The operational facts routing is allowed to see, for one eligible candidate.
   *
   * Read from the registry record and the breaker rather than from
   * `registry.health()`, which additionally asks the adapter for a credential
   * description — a per-provider, per-request cost for a snapshot routing has
   * no use for. Nothing here is a secret, a credential or a fingerprint.
   */
  function signalFor(
    candidate: ProviderCandidate,
    index: number,
  ): RoutingSignal {
    const provider = registry.get(candidate.providerId);
    return {
      providerId: candidate.providerId,
      modelId: candidate.model.modelId,
      promptMicroUsdPer1k: candidate.model.promptMicroUsdPer1k,
      completionMicroUsdPer1k: candidate.model.completionMicroUsdPer1k,
      billable: provider.descriptor.billable,
      isFallback: options.fallbackProviderId === candidate.providerId,
      preferenceIndex: index,
      circuit: circuit.stateOf(candidate.providerId),
      consecutiveFailures: circuit.snapshot(candidate.providerId).consecutiveFailures,
      successCount: provider.successCount,
      failureCount: provider.failureCount,
      observedLatencyMs: provider.lastLatencyMs,
    };
  }

  /**
   * The workload a bare `select()` routes against.
   *
   * Callers that do not supply one are not asking an economic question — the
   * health endpoint and the administration surface want the order, not the
   * price — so the projection is built from what `ModelRequirements` actually
   * carries. It never reaches a ledger.
   */
  function impliedWorkload(requirements: ModelRequirements): RoutingWorkload {
    return {
      featureId: '(unspecified)',
      promptTokens: 0,
      completionTokens: requirements.minOutputTokens,
      maxAttempts: 1,
    };
  }

  function decide(
    requirements: ModelRequirements,
    workload: RoutingWorkload,
  ): { decision: RoutingDecision; candidates: readonly ProviderCandidate[] } {
    const candidates = eligible(requirements);
    if (candidates.length === 0) throw unavailable(requirements);

    const decision = routeCandidates(
      candidates.map((candidate, index) => signalFor(candidate, index)),
      workload,
      {
        strategy: options.routing?.strategy ?? 'preference',
        // Absent routing configuration means the pre-4F walk: every eligible
        // candidate, in preference order.
        maxProviders: options.routing?.maxProviders ?? candidates.length,
        failoverEnabled: options.failoverEnabled,
      },
    );

    const byProvider = new Map(candidates.map((candidate) => [candidate.providerId, candidate]));
    const routed: ProviderCandidate[] = [];
    for (const entry of decision.order) {
      const candidate = byProvider.get(entry.providerId);
      // Unreachable while `routeCandidates` holds its subset assertion. Kept
      // because the cost of the assumption being wrong is a paid call to a
      // provider the eligibility pass refused.
      if (candidate) routed.push(candidate);
    }
    return { decision, candidates: routed };
  }

  return {
    select(requirements, workload) {
      return decide(requirements, workload ?? impliedWorkload(requirements)).candidates;
    },

    route(requirements, workload) {
      return decide(requirements, workload);
    },

    explain(requirements) {
      return explanation(requirements);
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
