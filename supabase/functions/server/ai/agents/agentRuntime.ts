/**
 * Agent runtime assembly (AI-01 Batch 3A).
 *
 * The `createControlPlane` of the agent world: one function that builds the
 * whole dependency graph by explicit injection, so a test can assemble the
 * REAL registry, orchestrator, state machine, tool gateway, approval gate,
 * limits, ledgers and service with a fake clock, sequential ids and in-memory
 * stores — and exercise production code end to end with no network, no globals
 * and no shared state between cases.
 *
 * THE ONE DEPENDENCY THAT IS NOT OPTIONAL is the AI Control Plane. The runtime
 * takes it and derives three things from it:
 *
 *   the model port      every model step executes through `plane.execute`
 *   the operational     the kill switch, the master switch, certification
 *   state               requirements and the configuration version
 *   the spend headroom  read from the Batch 1 lifetime ledger, so the runtime
 *                       refuses a step the platform cannot afford BEFORE the
 *                       control plane would have to
 *
 * There is no mode in which the runtime executes without a plane, no flag that
 * bypasses it, and no second path. That is the batch's central architectural
 * claim, and it is enforced here by construction rather than by convention.
 */

import type { AIControlPlane } from '../controlPlane.ts';
import type { AIAuthenticator } from '../security/actor.ts';
import type { OrganizationResolutionOptions } from '../security/tenancy.ts';
import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type { Metrics } from '../observability/metrics.ts';
import type { AgentDefinition } from './contracts/agent.ts';
import type { ToolDefinition } from './contracts/tools.ts';
import type { ModelProfile, ModelProfileRegistry } from './runtime/modelRouting.ts';
import type {
  AgentApprovalStore,
  AgentCheckpointStore,
  AgentRunStore,
} from './persistence/ports.ts';
import type { AgentAuditStore, AgentAuditWriter } from './observability/agentAudit.ts';
import type { AgentRegistry } from './registry/agentRegistry.ts';
import type { ToolGateway, ToolRegistry } from './tools/toolRegistry.ts';
import type { AgentOrchestrator, AgentRuntimeState } from './orchestrator/agentOrchestrator.ts';
import type { AgentRuntimeService } from './service/agentRuntimeService.ts';
import type { ApprovalGate } from './approvals/approvalGate.ts';
import type { ModelExecutionPort } from './orchestrator/controlPlaneBridge.ts';

import { systemClock } from '../runtime/clock.ts';
import { systemIdFactory } from '../contracts/ids.ts';
import { createMetrics } from '../observability/metrics.ts';
import { aiExecutionPermitted } from '../runtime/operationalSettings.ts';
import { SPEND_SCOPE, remainingMicroUsd } from '../policy/spendLedger.ts';
import { createAgentRegistry } from './registry/agentRegistry.ts';
import { createModelProfileRegistry } from './runtime/modelRouting.ts';
import { DEFAULT_MODEL_PROFILES } from './runtime/defaultProfiles.ts';
import {
  createMemoryToolIdempotencyStore,
  createToolGateway,
  createToolRegistry,
} from './tools/toolRegistry.ts';
import {
  createMemoryAgentRunStore,
  createMemoryApprovalStore,
  createMemoryCheckpointStore,
} from './persistence/ports.ts';
import {
  createAgentAuditWriter,
  createCompositeAgentAuditStore,
  createMemoryAgentAuditStore,
} from './observability/agentAudit.ts';
import { createApprovalGate } from './approvals/approvalGate.ts';
import { createAgentOrchestrator } from './orchestrator/agentOrchestrator.ts';
import { createControlPlaneModelPort } from './orchestrator/controlPlaneBridge.ts';
import { createAgentRuntimeService } from './service/agentRuntimeService.ts';

export interface AgentRuntimeOptions {
  /** The governed AI execution path. Required — there is no alternative. */
  readonly plane: AIControlPlane;
  /** The same authenticator the guard uses. Never a second credential path. */
  readonly authenticator: AIAuthenticator;
  readonly organizationOptions: OrganizationResolutionOptions;
  /** Agents to register. Batch 3A ships none; callers supply their own. */
  readonly agents?: readonly AgentDefinition[];
  /** Tools to register. Batch 3A ships deterministic ones, off by default. */
  readonly tools?: readonly ToolDefinition[];
  /** Model profiles. Defaults to the two the platform ships. */
  readonly profiles?: readonly ModelProfile[];
  /** Durable stores. Omitted, the runtime is isolate-local — tests only. */
  readonly runStore?: AgentRunStore;
  readonly checkpointStore?: AgentCheckpointStore;
  readonly approvalStore?: AgentApprovalStore;
  /** Durable audit stores written alongside the in-memory ring. */
  readonly auditStores?: readonly AgentAuditStore[];
  readonly auditBufferSize?: number;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  /** Micro-USD above which a model step needs a human decision. */
  readonly costApprovalThresholdMicroUsd?: number;
  /** Override the model port. Tests substitute a deterministic one. */
  readonly modelPort?: ModelExecutionPort;
}

export interface AgentRuntime {
  readonly registry: AgentRegistry;
  /**
   * The certified model profile catalogue.
   *
   * Exposed READ-ONLY so an assembly can resolve what an agent's declared
   * `allowedModelProfiles` actually permit — which is what the production node
   * cost-profile registry derives a truthful capability band from. Nothing
   * outside this runtime may register into it, and nothing outside the
   * orchestrator may route with it.
   */
  readonly profiles: ModelProfileRegistry;
  readonly tools: ToolRegistry;
  readonly gateway: ToolGateway;
  readonly orchestrator: AgentOrchestrator;
  readonly service: AgentRuntimeService;
  readonly approvals: ApprovalGate;
  readonly runs: AgentRunStore;
  readonly checkpoints: AgentCheckpointStore;
  readonly audit: AgentAuditWriter;
  /** The administrative and health facts the orchestrator reads per step. */
  state(): AgentRuntimeState;
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? systemIdFactory;
  const metrics = options.metrics ?? createMetrics();
  const logger = options.logger ?? options.plane.logger;

  /**
   * The live administrative and health view.
   *
   * Read through a function on every step rather than captured once. An
   * operator who engages the emergency stop must stop the NEXT step of a run
   * that is already in flight, and a value copied at assembly would wait for an
   * isolate to recycle — which for an emergency stop is the same as not having
   * one.
   */
  const state = (): AgentRuntimeState => {
    const settings = options.plane.settings.current();
    const health = options.plane.health();
    return {
      aiEnabled: aiExecutionPermitted(settings),
      // `unhealthy` means no provider can serve anything. `degraded` still
      // serves, so a run continues on the cheaper profile rather than stopping.
      executionAvailable: health.status !== 'unhealthy',
      degraded: health.status === 'degraded',
      // THREE POPULATIONS, THREE SWITCHES.
      //
      // These were one flag — `requireCertifiedProviders` — until an
      // independent review pointed out that an operator hardening provider
      // certification was silently also refusing uncertified agents and tools.
      // The direction was safe and the coupling was invisible, which is the
      // combination that makes a control impossible to reason about during an
      // incident. Providers, agents and tools are certified by different people
      // against different contracts, so each now has its own switch, its own
      // environment variable and its own envelope entry.
      requireCertifiedProviders: settings.requireCertifiedProviders,
      requireCertifiedAgents: settings.requireCertifiedAgents,
      requireCertifiedTools: settings.requireCertifiedTools,
      configurationVersion: settings.configurationVersion,
    };
  };

  const registry = createAgentRegistry({
    requireCertification: () => state().requireCertifiedAgents,
  });
  if (options.agents?.length) registry.registerAll(options.agents);

  const toolRegistry = createToolRegistry();
  if (options.tools?.length) toolRegistry.registerAll(options.tools);

  const profiles = createModelProfileRegistry();
  profiles.registerAll(options.profiles ?? DEFAULT_MODEL_PROFILES);

  const gateway = createToolGateway({
    registry: toolRegistry,
    idempotency: createMemoryToolIdempotencyStore(),
    clock,
    requireCertification: () => state().requireCertifiedTools,
  });

  const runs = options.runStore ?? createMemoryAgentRunStore();
  const checkpoints = options.checkpointStore ?? createMemoryCheckpointStore();
  const approvalStore = options.approvalStore ?? createMemoryApprovalStore();

  const memoryAudit = createMemoryAgentAuditStore(options.auditBufferSize ?? 500);
  const auditStore =
    options.auditStores && options.auditStores.length > 0
      ? createCompositeAgentAuditStore(memoryAudit, options.auditStores, (error) =>
          logger.error('ai.agent.audit.durable_write_failed', {
            diagnostics: error instanceof Error ? error.message : String(error),
          }),
        )
      : memoryAudit;
  const audit = createAgentAuditWriter({
    store: auditStore,
    clock,
    newAuditId: () => ids.next('aud'),
  });

  const approvals = createApprovalGate({
    store: approvalStore,
    clock,
    newApprovalId: () => ids.next('apr'),
  });

  const models = options.modelPort ?? createControlPlaneModelPort(options.plane);

  const orchestrator = createAgentOrchestrator({
    registry,
    profiles,
    tools: gateway,
    runs,
    checkpoints,
    approvals,
    models,
    audit,
    clock,
    ids,
    logger,
    metrics,
    runtimeState: state,
    // The MARQ lifetime ceiling, READ rather than reserved against. The spend
    // guard inside the control plane is what actually holds money for a call;
    // taking a second hold here would double-count the same headroom. See
    // `runtime/costPolicy.ts` for the full reasoning.
    platformHeadroomMicroUsd: async () => {
      const record = await options.plane.spendStatus();
      return remainingMicroUsd(record);
    },
    ...(options.costApprovalThresholdMicroUsd === undefined
      ? {}
      : { costApprovalThresholdMicroUsd: options.costApprovalThresholdMicroUsd }),
  });

  const service = createAgentRuntimeService({
    orchestrator,
    registry,
    tools: gateway,
    runs,
    approvals,
    audit,
    authenticator: options.authenticator,
    organizationOptions: options.organizationOptions,
    clock,
    ids,
  });

  for (const issue of registry.validate()) {
    logger.warn('ai.agent.registry.issue', { issue });
  }

  return {
    registry,
    profiles,
    tools: toolRegistry,
    gateway,
    orchestrator,
    service,
    approvals,
    runs,
    checkpoints,
    audit,
    state,
  };
}

/** The spend scope the runtime reads headroom from. Re-exported for tests. */
export const AGENT_SPEND_SCOPE = SPEND_SCOPE.platform;
