/**
 * Health snapshot for the AI Control Plane.
 *
 * Answers one question honestly: can this platform serve AI requests right now,
 * and if not, why not. It is deliberately opinionated about status —
 *
 *   healthy   at least one production-ready provider is eligible.
 *   degraded  the plane can serve requests, but with reduced redundancy or on a
 *             non-production provider. Serving traffic on the mock provider is
 *             degraded, never healthy: a green light while every completion is
 *             synthetic is the most dangerous state a health endpoint can report.
 *   unhealthy no provider can serve a request.
 *
 * The snapshot carries no tenant data, so it is safe to expose to operators and
 * to an uptime probe.
 */

import type { AIProviderHealth } from '../contracts/provider.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ProviderSelector } from '../providers/selector.ts';
import type { FeatureCatalog } from '../policy/featureCatalog.ts';
import type { PromptRegistry } from '../prompts/registry.ts';
import type { Clock } from '../runtime/clock.ts';

export type PlaneStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ControlPlaneHealth {
  readonly status: PlaneStatus;
  readonly platformVersion: string;
  readonly contractVersion: string;
  /**
   * The administrative configuration in force. An operator correlating an
   * incident with a change needs this on the same snapshot as the symptom.
   */
  readonly configurationVersion: number;
  /** False when an administrator has stopped AI, by switch or emergency stop. */
  readonly aiEnabled: boolean;
  readonly emergencyStopEngaged: boolean;
  readonly checkedAt: string;
  readonly providers: readonly AIProviderHealth[];
  /** Per-provider eligibility for a representative request. */
  readonly selection: Readonly<Record<string, string>>;
  readonly features: {
    readonly registered: number;
    readonly enabled: number;
  };
  readonly prompts: {
    readonly registered: number;
    readonly references: readonly string[];
  };
  /** Configuration problems. Empty means the plane is correctly configured. */
  readonly issues: readonly string[];
}

export interface HealthDependencies {
  readonly registry: ProviderRegistry;
  readonly selector: ProviderSelector;
  readonly catalog: FeatureCatalog;
  readonly prompts: PromptRegistry;
  readonly clock: Clock;
  readonly platformVersion: string;
  readonly contractVersion: string;
  /** The administrative posture (AI-01 Batch 2). Defaults to "AI permitted". */
  readonly administrative?: {
    readonly configurationVersion: number;
    readonly aiEnabled: boolean;
    readonly emergencyStopEngaged: boolean;
  };
}

export function buildHealthSnapshot(deps: HealthDependencies): ControlPlaneHealth {
  const providers = deps.registry.healthAll();
  const issues = [...deps.registry.validate()];

  // Probe with the most demanding shape any feature declares, so the report
  // reflects the hardest request the plane actually has to serve rather than
  // the easiest one.
  const descriptors = deps.catalog.list();
  const minOutputTokens = descriptors.reduce(
    (max, descriptor) => Math.max(max, descriptor.limits.maxOutputTokens),
    1,
  );
  const selection = deps.selector.explain({
    structuredOutput: true,
    chatCompletions: true,
    minOutputTokens,
  });

  const eligible = Object.entries(selection)
    .filter(([, reason]) => reason === 'eligible')
    .map(([providerId]) => providerId);

  const productionEligible = eligible.filter(
    (providerId) => deps.registry.find(providerId)?.descriptor.productionReady === true,
  );

  const administrative = deps.administrative ?? {
    configurationVersion: 1,
    aiEnabled: true,
    emergencyStopEngaged: false,
  };

  let status: PlaneStatus;
  if (!administrative.aiEnabled) {
    // An administrator stopping AI is not a fault, but this endpoint answers
    // "can this platform serve AI requests right now" — and it cannot. Reporting
    // healthy while every request is refused would make the endpoint useless
    // during exactly the incident it exists for. The issue text distinguishes
    // the deliberate stop from a failure, so an operator is not sent hunting.
    status = 'unhealthy';
    issues.push(
      administrative.emergencyStopEngaged
        ? 'AI is stopped: the emergency kill switch is engaged'
        : 'AI is disabled by administrative setting',
    );
  } else if (eligible.length === 0) {
    status = 'unhealthy';
    issues.push('no provider is eligible to serve AI requests');
  } else if (productionEligible.length === 0) {
    status = 'degraded';
    issues.push('only non-production providers are eligible — completions would be synthetic');
  } else if (providers.some((provider) => provider.circuit !== 'closed')) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  const registeredPrompts = deps.prompts.list();
  const missingPrompts = descriptors
    .filter((descriptor) => !registeredPrompts.some((p) => p.promptId === descriptor.promptId))
    .map((descriptor) => `${descriptor.featureId} references unregistered prompt ${descriptor.promptId}`);
  issues.push(...missingPrompts);

  return {
    status,
    platformVersion: deps.platformVersion,
    contractVersion: deps.contractVersion,
    configurationVersion: administrative.configurationVersion,
    aiEnabled: administrative.aiEnabled,
    emergencyStopEngaged: administrative.emergencyStopEngaged,
    checkedAt: deps.clock.isoNow(),
    providers,
    selection,
    features: {
      registered: descriptors.length,
      enabled: descriptors.filter((descriptor) => descriptor.enabled).length,
    },
    prompts: {
      registered: registeredPrompts.length,
      references: registeredPrompts.map((prompt) => `${prompt.reference} ${prompt.fingerprint}`),
    },
    issues,
  };
}
