/**
 * MARQ Cortex AI Control Plane.
 *
 * THE single governed AI execution path. Every AI capability in the platform —
 * today's five features and everything Batch 2 and beyond add — executes through
 * `controlPlane.execute()`. There is no second path, no bypass flag and no
 * direct provider access anywhere outside `ai/providers/`.
 *
 * The plane is assembled by explicit dependency injection rather than module
 * singletons. That is what makes the whole thing testable: a test builds a plane
 * with a fake clock, a fake authenticator, a deterministic id factory and a mock
 * provider, and exercises real production code end to end with no network, no
 * globals and no shared state between test cases. Production assembles the same
 * graph in `bootstrap.ts` with real adapters.
 */

import type {
  AIExecutionResult,
  AIRequestEnvelope,
  AIRequestTransport,
} from './contracts/request.ts';
import type { AIEventBus } from './contracts/events.ts';
import type { AIFeatureDefinition, FeatureCatalog } from './policy/featureCatalog.ts';
import type { AIAuditRecord, AuditStore } from './observability/audit.ts';
import type { AIAuthenticator } from './security/actor.ts';
import type { AIControlPlaneConfig } from './runtime/config.ts';
import type { AIProviderAdapter, AICertificationStatus } from './contracts/provider.ts';
import type { Clock } from './runtime/clock.ts';
import type { IdFactory } from './contracts/ids.ts';
import type { Logger, LogSink } from './observability/logger.ts';
import type { Metrics, MetricsSnapshot } from './observability/metrics.ts';
import type { ControlPlaneHealth } from './observability/health.ts';
import type { PromptRegistry } from './prompts/registry.ts';
import type { ProviderRegistry } from './providers/registry.ts';
import type { SleepFn, RandomSource } from './providers/retry.ts';
import type { SpendLedger, SpendRecord, SpendStore } from './policy/spendLedger.ts';

import { CONTRACT_VERSION, PLATFORM_VERSION } from './contracts/versions.ts';
import { systemIdFactory } from './contracts/ids.ts';
import { systemClock } from './runtime/clock.ts';
import { createLogger } from './observability/logger.ts';
import { createMetrics, METRIC } from './observability/metrics.ts';
import { createEventBus } from './observability/events.ts';
import {
  createAuditWriter,
  createCompositeAuditStore,
  createMemoryAuditStore,
} from './observability/audit.ts';
import { createFeatureCatalog } from './policy/featureCatalog.ts';
import { createPromptRegistry } from './prompts/registry.ts';
import { registerCortexPrompts } from './prompts/catalog.ts';
import { createCircuitBreaker } from './providers/circuitBreaker.ts';
import { createProviderRegistry } from './providers/registry.ts';
import { createProviderSelector } from './providers/selector.ts';
import { createRetryScheduler } from './providers/retry.ts';
import { createSlidingWindowRateLimiter } from './security/rateLimiter.ts';
import { createAIGuard } from './security/guard.ts';
import { createPolicyEngine } from './policy/policyEngine.ts';
import { budgetPolicyFrom, createBudgetEngine, createInMemoryBudgetLedger } from './policy/budget.ts';
import { createSpendGuard } from './policy/spendGuard.ts';
import {
  SPEND_SCOPE,
  createMemorySpendStore,
  createSpendLedger,
} from './policy/spendLedger.ts';
import { createExecutionPipeline } from './pipeline/executionPipeline.ts';
import { createRequestOrchestrator } from './orchestrator.ts';
import { buildHealthSnapshot } from './observability/health.ts';
import { registerCortexFeatures } from './features/index.ts';

export interface ControlPlaneOptions {
  readonly config: AIControlPlaneConfig;
  readonly authenticator: AIAuthenticator;
  /** Providers to register, in any order. Selection order comes from config. */
  readonly providers: readonly {
    adapter: AIProviderAdapter;
    enabled?: boolean;
    certification?: AICertificationStatus;
  }[];
  /** Durable audit stores written alongside the in-memory buffer. */
  readonly auditStores?: readonly AuditStore[];
  /**
   * Durable backing for the MARQ spend ceiling. Omitted, the ledger is
   * isolate-local — correct for tests, NOT correct for a deployment where the
   * cap has to hold across isolate recycling.
   */
  readonly spendStore?: SpendStore;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  readonly logSink?: LogSink;
  /** Injected for deterministic backoff in tests. */
  readonly sleep?: SleepFn;
  readonly random?: RandomSource;
}

export interface AIControlPlane {
  execute<TOutput>(
    envelope: AIRequestEnvelope<unknown>,
    transport: AIRequestTransport,
  ): Promise<AIExecutionResult<TOutput>>;
  readonly catalog: FeatureCatalog;
  readonly prompts: PromptRegistry;
  readonly providers: ProviderRegistry;
  readonly events: AIEventBus;
  readonly logger: Logger;
  readonly config: AIControlPlaneConfig;
  health(): ControlPlaneHealth;
  metrics(): MetricsSnapshot;
  recentAudit(limit?: number): readonly AIAuditRecord[];
  /** Current MARQ lifetime spend against the ceiling. */
  spendStatus(): Promise<SpendRecord>;
  /**
   * The spend ledger, for the authorised-reset operation. Exposed rather than
   * wrapped so a reset call site must supply the authorising actor and reason
   * the ledger demands — there is no convenience method that omits them.
   */
  readonly spendLedger: SpendLedger;
  /** Drop expired rate-limit and budget windows. Safe on any cadence. */
  sweep(): void;
}

export function createControlPlane(options: ControlPlaneOptions): AIControlPlane {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? systemIdFactory;
  const { config } = options;

  const logger = createLogger({
    level: config.observability.logLevel,
    structured: config.observability.structuredLogs,
    sink: options.logSink,
    base: { component: 'ai-control-plane', platformVersion: PLATFORM_VERSION },
  });

  const metrics: Metrics = createMetrics();

  const events = createEventBus({
    onError: (event, error) =>
      logger.error('ai.event.subscriber_failed', {
        event: event.name,
        requestId: event.identity.requestId,
        diagnostics: error instanceof Error ? error.message : String(error),
      }),
  });

  // ── Prompts and features ──────────────────────────────────────────────────
  const prompts = createPromptRegistry();
  registerCortexPrompts(prompts);

  const catalog = createFeatureCatalog();
  registerCortexFeatures(catalog);

  // ── Provider layer ────────────────────────────────────────────────────────
  const circuit = createCircuitBreaker(clock, config.circuit);
  const providerRegistry = createProviderRegistry(clock, circuit);
  for (const entry of options.providers) {
    providerRegistry.register(entry.adapter, {
      enabled: entry.enabled,
      certification: entry.certification,
    });
  }

  const selector = createProviderSelector(providerRegistry, circuit, {
    preference: config.providerPreference,
    fallbackProviderId: config.fallbackProviderId,
    failoverEnabled: config.failoverEnabled,
    realRequestsEnabled: config.allowRealRequests,
    requireCertification: config.requireCertifiedProviders,
  });

  const retry = createRetryScheduler(options.sleep, options.random);

  // ── Security ──────────────────────────────────────────────────────────────
  const rateLimiter = createSlidingWindowRateLimiter(clock);
  const guard = createAIGuard({
    catalog,
    authenticator: options.authenticator,
    rateLimiter,
    clock,
    ids,
    organizationOptions: {
      defaultOrganizationId: config.defaultOrganizationId,
      allowList: config.organizationAllowList,
      allowDefaultOrganization: config.allowDefaultOrganization,
    },
  });

  // ── Policy and budget ─────────────────────────────────────────────────────
  const budgetPolicy = budgetPolicyFrom({
    organizationDailyMicroUsd: config.budget.organizationDailyMicroUsd,
    actorDailyMicroUsd: config.budget.actorDailyMicroUsd,
  });
  const budgetLedger = createInMemoryBudgetLedger(clock);
  const budget = createBudgetEngine(budgetLedger, {
    alertThresholdPercent: config.budget.alertThresholdPercent,
    enforce: config.budget.enforce,
  });
  const policy = createPolicyEngine(budget, budgetPolicy);

  // The MARQ lifetime ceiling. Its store is a port: the in-memory default is
  // correct for tests and a single instance, and bootstrap swaps in the durable
  // key-value store so a recycled isolate does not rediscover a $0 balance.
  const spendLedger = createSpendLedger({
    store: options.spendStore ?? createMemorySpendStore(),
    capMicroUsd: config.spend.maxPlatformMicroUsd,
    now: () => clock.isoNow(),
  });
  const spend = createSpendGuard({
    ledger: spendLedger,
    registry: providerRegistry,
    realRequestsEnabled: config.allowRealRequests,
    enforce: config.spend.enforce,
  });

  // ── Observability ─────────────────────────────────────────────────────────
  const memoryAudit = createMemoryAuditStore(config.audit.bufferSize);
  const auditStore =
    options.auditStores && options.auditStores.length > 0
      ? createCompositeAuditStore(memoryAudit, options.auditStores, (error) =>
          logger.error('ai.audit.durable_write_failed', {
            diagnostics: error instanceof Error ? error.message : String(error),
          }),
        )
      : memoryAudit;
  const audit = createAuditWriter({ store: auditStore, clock, newAuditId: () => ids.next('aud') });

  // ── Pipeline and orchestrator ─────────────────────────────────────────────
  const pipeline = createExecutionPipeline({
    prompts,
    providers: providerRegistry,
    selector,
    circuit,
    retry,
    clock,
    logger,
    metrics,
    events,
    ids,
    config,
  });

  const orchestrator = createRequestOrchestrator({
    guard,
    policy,
    pipeline,
    budget,
    budgetPolicy,
    spend,
    audit,
    logger,
    metrics,
    events,
    clock,
    ids,
  });

  // Surface configuration problems once, at assembly, rather than per request.
  for (const issue of providerRegistry.validate()) {
    logger.warn('ai.provider_registry.issue', { issue });
  }

  return {
    execute: (envelope, transport) => orchestrator.execute(envelope, transport),
    catalog,
    prompts,
    providers: providerRegistry,
    events,
    logger,
    config,
    health: () =>
      buildHealthSnapshot({
        registry: providerRegistry,
        selector,
        catalog,
        prompts,
        clock,
        platformVersion: PLATFORM_VERSION,
        contractVersion: CONTRACT_VERSION,
      }),
    metrics: () => {
      metrics.gauge(METRIC.rateLimitScopes, rateLimiter.size());
      return metrics.snapshot();
    },
    recentAudit: (limit = 50) => audit.recent(limit),
    spendStatus: () => spendLedger.read(SPEND_SCOPE.platform),
    spendLedger,
    sweep: () => {
      rateLimiter.sweep();
      budgetLedger.sweep();
    },
  };
}

/** Re-exported so callers register features without importing the catalog. */
export type { AIFeatureDefinition };
