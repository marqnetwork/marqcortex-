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
import type { ModelPolicy, ProviderRegistry } from './providers/registry.ts';
import type { SleepFn, RandomSource } from './providers/retry.ts';
import type { SpendLedger, SpendRecord, SpendStore } from './policy/spendLedger.ts';
import type { AIBudgetPolicy, AIBudgetState } from './contracts/policy.ts';
import type {
  AIOperationalSettings,
  OperationalSettingsStore,
  SettingsSource,
} from './runtime/operationalSettings.ts';

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
import type { ExecutionFundingResolver } from './providers/credentials/executionFunding.ts';
import { createSpendGuard } from './policy/spendGuard.ts';
import {
  SPEND_SCOPE,
  createMemorySpendStore,
  createSpendLedger,
  organizationOfSpendScope,
} from './policy/spendLedger.ts';
import { isolationKeyFor } from './security/tenancy.ts';
import { createExecutionPipeline } from './pipeline/executionPipeline.ts';
import { createRequestOrchestrator } from './orchestrator.ts';
import { buildHealthSnapshot } from './observability/health.ts';
import { registerCortexFeatures } from './features/index.ts';
import {
  aiExecutionPermitted,
  baselineSettings,
  createOperationalSettingsStore,
  effectivePreference,
  effectiveRealRequestsEnabled,
  SETTINGS_BOUNDS,
} from './runtime/operationalSettings.ts';
import { envelopeFrom } from './runtime/envelope.ts';

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
   * Whose credentials a request may reach (AI-01 Batch 4D remediation).
   *
   * Built where the credential store lives — `bootstrap.ts` — and injected
   * here, because the plane has no store of its own and acquiring one to answer
   * this would give the execution path a second route to credential rows.
   *
   * Omitted, every request is platform-funded, which is the Batch 4C behaviour
   * and what a deployment with no BYOK storage continues to get.
   */
  readonly funding?: ExecutionFundingResolver;
  /**
   * Durable backing for the MARQ spend ceiling. Omitted, the ledger is
   * isolate-local — correct for tests, NOT correct for a deployment where the
   * cap has to hold across isolate recycling.
   */
  readonly spendStore?: SpendStore;
  /**
   * Operational settings to start from. Omitted, the plane starts at the
   * deployment baseline and the administration layer hydrates stored settings
   * over it once durable storage answers.
   */
  readonly settings?: AIOperationalSettings;
  /**
   * Where to re-read operational settings from, so a change made through
   * another isolate reaches this one.
   *
   * Omitted, the plane is isolate-local — correct for a unit test that never
   * has a second plane, and NOT correct for a deployment, where the kill switch
   * would stop only the isolate that happened to serve the console request.
   */
  readonly settingsSource?: SettingsSource;
  /** How long a cached settings copy may be served. Defaults to the config. */
  readonly settingsRefreshMs?: number;
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
  /** The deployment's environment configuration. Immutable at runtime. */
  readonly config: AIControlPlaneConfig;
  /**
   * The live administrative overlay (AI-01 Batch 2).
   *
   * Reading it is safe from anywhere. WRITING it is not an operation this
   * interface offers, deliberately: a change has to be authorised, validated,
   * persisted and audited, and all four live in `ai/admin/`. The store is
   * exposed so that layer can drive it — and so nothing else has to guess at
   * what is currently in force.
   */
  readonly settings: OperationalSettingsStore;
  /**
   * Re-derive everything the overlay drives that is not read through a getter —
   * today, the provider registry's enabled flags. Called by the administration
   * layer after a settings change and after hydration; idempotent.
   */
  applySettings(): void;
  /**
   * Re-read operational settings from durable storage if the cached copy has
   * aged past the refresh interval, adopting anything newer.
   *
   * Called automatically at the top of `execute`, so an administrator's change
   * reaches every isolate by its next AI request without anything having to
   * push to it. Exposed because health probes and the administration console
   * want the same freshness, and because a deployment may want to drive it on
   * a timer.
   */
  refreshSettings(): Promise<AIOperationalSettings>;
  /** Rolling daily budget state for one organization and actor. */
  budgetState(organizationId: string, actorId: string): {
    organization: AIBudgetState;
    actor: AIBudgetState;
  };
  /** The daily budget policy currently in force. */
  budgetPolicy(): AIBudgetPolicy;
  health(): ControlPlaneHealth;
  metrics(): MetricsSnapshot;
  recentAudit(limit?: number): readonly AIAuditRecord[];
  /** Current MARQ lifetime spend against the ceiling. */
  spendStatus(): Promise<SpendRecord>;
  /**
   * Current lifetime spend for ONE organization's own ledger (HIGH-1).
   *
   * A separate method rather than a scope parameter on `spendStatus`, so a
   * caller cannot reach the platform record by passing a string, and so the
   * authorization question — may this actor see this tenant? — is asked at a
   * call site that names a tenant. The id is validated as a storage key segment
   * before it becomes one.
   */
  organizationSpendStatus(organizationId: string): Promise<SpendRecord>;
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

  // ── Administrative overlay ────────────────────────────────────────────────
  //
  // Created before anything that reads it, and seeded from the environment
  // configuration, so a plane with no stored settings behaves exactly as
  // Batch 1 did. Every consumer below reads it through a getter or a function,
  // never by copying a value at assembly time — a snapshot taken here would
  // make an administrator's change wait for an isolate to recycle, which for an
  // emergency stop is the same as not having one.
  const settings = createOperationalSettingsStore(
    options.settings ?? baselineSettings(config, clock.isoNow()),
    {
      source: options.settingsSource,
      ttlMs: options.settingsRefreshMs ?? config.settingsRefreshMs,
      now: () => clock.now(),
      // Every path into the overlay is narrowed to what the deployment
      // authorised — a local write, a hydrate, and a refresh from an isolate
      // that might be running an older revision.
      envelope: envelopeFrom(config),
      onError: (error) =>
        logger.error('ai.settings.refresh_failed', {
          diagnostics: error instanceof Error ? error.message : String(error),
        }),
      // A refreshed configuration can enable or disable providers, which is
      // registry state rather than something read through a getter.
      onAdopted: (adopted) => {
        applySettings();
        logger.info('ai.settings.refreshed', {
          configurationVersion: adopted.configurationVersion,
          aiEnabled: adopted.aiEnabled,
          emergencyStop: adopted.emergencyStop.engaged,
        });
      },
    },
  );
  /** The settings in force right now. Called at the point of use, never cached. */
  const live = () => settings.current();

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

  // Model selection narrowing, read live from the overlay. The registry asks
  // rather than holds, so an administrator pinning a model or restricting a
  // provider's catalogue takes effect on the next selection with no second copy
  // of the setting anywhere.
  const modelPolicy: ModelPolicy = {
    allowList: (providerId) => live().providers[providerId]?.modelAllowList ?? [],
    preferred: () => live().defaultModelId,
  };

  const providerRegistry = createProviderRegistry(clock, circuit, modelPolicy);
  for (const entry of options.providers) {
    providerRegistry.register(entry.adapter, {
      enabled: entry.enabled,
      certification: entry.certification,
    });
  }

  // Getters, not values. `SelectorOptions` declares readonly properties, and a
  // property is readonly to its *reader* — supplying it as a getter is how the
  // selector reads the current answer without knowing the overlay exists.
  const selector = createProviderSelector(providerRegistry, circuit, {
    get preference() {
      return effectivePreference(live());
    },
    get fallbackProviderId() {
      return live().fallbackProviderId;
    },
    get failoverEnabled() {
      return live().failoverEnabled;
    },
    get realRequestsEnabled() {
      return effectiveRealRequestsEnabled(live(), config.allowRealRequests);
    },
    get requireCertification() {
      return live().requireCertifiedProviders;
    },
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
  //
  // The budget ENGINE is unchanged from Batch 1 — the ceilings it enforces are
  // now administrable, the enforcement is not. `budgetPolicyFrom` is called per
  // read rather than once, so a limit an administrator raises applies to the
  // next authorization instead of the next deploy.
  const budgetPolicy: AIBudgetPolicy = {
    get organizationDaily() {
      return budgetPolicyFrom(live().budget).organizationDaily;
    },
    get actorDaily() {
      return budgetPolicyFrom(live().budget).actorDaily;
    },
  };
  const budgetLedger = createInMemoryBudgetLedger(clock);
  const budget = createBudgetEngine(budgetLedger, {
    get alertThresholdPercent() {
      return live().budget.alertThresholdPercent;
    },
    get enforce() {
      return live().budget.enforce;
    },
  });
  const policy = createPolicyEngine(budget, budgetPolicy, () => {
    const current = live();
    if (aiExecutionPermitted(current)) return { enabled: true };
    return {
      enabled: false,
      haltReason: current.emergencyStop.engaged
        ? `emergency stop engaged by ${current.emergencyStop.engagedBy ?? 'an administrator'}` +
          `${current.emergencyStop.reason ? `: ${current.emergencyStop.reason}` : ''}`
        : 'AI is disabled by administrative setting',
    };
  });

  // The MARQ lifetime ceiling. Its store is a port: the in-memory default is
  // correct for tests and a single instance, and bootstrap swaps in the durable
  // key-value store so a recycled isolate does not rediscover a $0 balance.
  const spendLedger = createSpendLedger({
    store: options.spendStore ?? createMemorySpendStore(),
    // TWO CEILINGS, CHOSEN BY SCOPE (4D remediation, HIGH-1).
    //
    // `AI_MAX_SPEND_USD` bounds MARQ's own exposure at model vendors. It must
    // not bound a customer's spend on their OWN vendor key, and until this
    // split it did: BLOCKER B-2's fix began reserving tenant-funded executions
    // on an organization scope, and that scope inherited MARQ's $9 lifetime
    // ceiling — so declaring `tenant_only` capped a customer at $9 for life,
    // invisibly, over money MARQ was never billed for.
    //
    // Every scope that is not an organization's keeps the platform ceiling,
    // including any future one: the organization branch is entered only for a
    // name `SPEND_SCOPE.organization` could have produced, so nothing can be
    // mistaken for a tenant ledger by having a similar-looking key.
    capMicroUsd: (scope) =>
      organizationOfSpendScope(scope) === undefined
        ? config.spend.maxPlatformMicroUsd
        : config.spend.maxOrganizationMicroUsd,
    now: () => clock.isoNow(),
    // A hold must never expire while the request that owns it can still be
    // running, or two requests could spend the same headroom. The workflow
    // deadline bounds a request's life, so the TTL is floored at twice it.
    //
    // Batch 2 makes that deadline administrable, so the floor is taken against
    // the LARGEST deadline an administrator may set rather than the one in
    // force at assembly. Deriving it from the current value would let a
    // deadline raised after a hold was taken outlive the hold protecting it —
    // and reclaiming headroom from a request that is still running is the one
    // failure this ledger must never have.
    reservationTtlMs: Math.max(
      config.spend.reservationTtlMs,
      SETTINGS_BOUNDS.workflowDeadlineMs.max * 2,
    ),
  });
  const spend = createSpendGuard({
    ledger: spendLedger,
    registry: providerRegistry,
    get realRequestsEnabled() {
      return effectiveRealRequestsEnabled(live(), config.allowRealRequests);
    },
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
  //
  // The pipeline reads the retry curve and the workflow deadline from its
  // config on every request, so it is handed a view whose administrable fields
  // come from the overlay and whose everything-else is the deployment's own
  // configuration. Composing it this way — rather than teaching the pipeline
  // about settings — keeps the execution path unaware that an administration
  // layer exists.
  const effectiveConfig: AIControlPlaneConfig = {
    ...config,
    get workflowDeadlineMs() {
      return live().timeout.workflowDeadlineMs;
    },
    get retry() {
      return live().retry;
    },
  };

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
    config: effectiveConfig,
  });

  const orchestrator = createRequestOrchestrator({
    guard,
    policy,
    pipeline,
    budget,
    budgetPolicy,
    spend,
    funding: options.funding,
    audit,
    logger,
    metrics,
    events,
    clock,
    ids,
  });

  /**
   * Push overlay state that the registry holds rather than reads.
   *
   * Provider enablement is registry state because the circuit breaker, the
   * health report and the selector all consult it, and threading a getter
   * through those would spread the overlay across the provider layer. Pushing
   * it here keeps one direction of flow: settings are the authority, the
   * registry is the projection.
   *
   * A provider named in the settings but absent from the registry is ignored,
   * not an error — a deployment that has not registered every provider the
   * settings mention is a normal state during a rollout.
   */
  function applySettings(): void {
    const current = live();
    for (const provider of providerRegistry.list()) {
      const setting = current.providers[provider.descriptor.providerId];
      if (setting === undefined) continue;
      providerRegistry.setEnabled(provider.descriptor.providerId, setting.enabled);
    }
  }

  applySettings();

  // Surface configuration problems once, at assembly, rather than per request.
  for (const issue of providerRegistry.validate()) {
    logger.warn('ai.provider_registry.issue', { issue });
  }

  return {
    // Settings are refreshed BEFORE the guard runs, so the very first thing a
    // request does is find out whether an administrator has stopped AI. Placing
    // it here rather than inside the orchestrator keeps the execution path
    // itself unaware that settings can be re-read at all.
    execute: async (envelope, transport) => {
      await settings.refresh();
      return orchestrator.execute(envelope, transport);
    },
    catalog,
    prompts,
    providers: providerRegistry,
    events,
    logger,
    config,
    settings,
    applySettings,
    refreshSettings: () => settings.refresh(),
    budgetState: (organizationId, actorId) => budget.inspect(organizationId, actorId, budgetPolicy),
    budgetPolicy: () => budgetPolicyFrom(live().budget),
    health: () =>
      buildHealthSnapshot({
        registry: providerRegistry,
        selector,
        catalog,
        prompts,
        clock,
        platformVersion: PLATFORM_VERSION,
        contractVersion: CONTRACT_VERSION,
        administrative: {
          configurationVersion: live().configurationVersion,
          aiEnabled: aiExecutionPermitted(live()),
          emergencyStopEngaged: live().emergencyStop.engaged,
        },
      }),
    metrics: () => {
      metrics.gauge(METRIC.rateLimitScopes, rateLimiter.size());
      return metrics.snapshot();
    },
    recentAudit: (limit = 50) => audit.recent(limit),
    spendStatus: () => spendLedger.read(SPEND_SCOPE.platform),
    organizationSpendStatus: (organizationId) => {
      // THROUGH THE ONE VALIDATOR, BEFORE IT BECOMES A KEY — the same call the
      // spend guard makes for the same reason. An id carrying the `:` this key
      // format joins on could address another scope's ledger entirely, and
      // `isolationKeyFor` throwing is the correct direction: a read that cannot
      // be safely addressed must fail, not silently answer about somewhere else.
      isolationKeyFor(organizationId);
      return spendLedger.read(SPEND_SCOPE.organization(organizationId));
    },
    spendLedger,
    sweep: () => {
      rateLimiter.sweep();
      budgetLedger.sweep();
    },
  };
}

/** Re-exported so callers register features without importing the catalog. */
export type { AIFeatureDefinition };
