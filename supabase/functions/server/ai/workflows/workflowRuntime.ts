/**
 * Workflow engine assembly (AI-01 Batch 3B).
 *
 * The `createAgentRuntime` of the workflow world: one function that builds the
 * whole dependency graph by explicit injection, so a test can assemble the REAL
 * registry, planner, orchestrator, state machine, optimizer, router, cost engine,
 * cache, approval gate and service with a fake clock, sequential ids and in-memory
 * stores — and exercise production code end to end with no network, no globals and
 * no shared state between cases.
 *
 * TWO DEPENDENCIES THAT ARE NOT OPTIONAL, and both for the same reason.
 *
 *   THE AI CONTROL PLANE. Every model node executes through `plane.execute`. The
 *   runtime derives three things from the plane: the model port, the operational
 *   state (kill switch, master switch, certification requirements, configuration
 *   version) and the spend headroom read from the Batch 1 lifetime ledger — so the
 *   engine refuses a node the platform cannot afford BEFORE the control plane
 *   would have to.
 *
 *   THE CERTIFIED AGENT RUNTIME. Every agent node executes through the Batch 3A
 *   orchestrator, and every tool node through the Batch 3A gateway. The engine
 *   takes the runtime, not its parts: it cannot reach the agent run store, the
 *   loop state or the ledgers, because they are not on the interface it is given.
 *
 * There is no mode in which the engine executes without either, no flag that
 * bypasses them, and no second path. That is this batch's central architectural
 * claim, and it is enforced here by construction rather than by convention.
 *
 * NO WORKFLOWS ARE REGISTERED BY DEFAULT. Batch 3B ships no business workflow; the
 * production registry starts empty and a deployment registers definitions
 * explicitly, in code, reviewed as code.
 */

import type { AIControlPlane } from '../controlPlane.ts';
import type { AIAuthenticator } from '../security/actor.ts';
import type { OrganizationResolutionOptions } from '../security/tenancy.ts';
import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type { Metrics } from '../observability/metrics.ts';
import type { AgentRuntime } from '../agents/agentRuntime.ts';
import type { ModelProfile } from '../agents/runtime/modelRouting.ts';
import type { ModelExecutionPort } from '../agents/orchestrator/controlPlaneBridge.ts';

import type { WorkflowDefinition } from './contracts/workflow.ts';
import type { WorkflowRegistry } from './registry/workflowRegistry.ts';
import type { WorkflowOrchestrator } from './orchestrator/workflowOrchestrator.ts';
import type { WorkflowService } from './service/workflowService.ts';
import type { WorkflowApprovalGate } from './approvals/workflowApprovalGate.ts';
import type { WorkflowAuditStore, WorkflowAuditWriter } from './observability/workflowAudit.ts';
import type { PredicateRegistry } from './runtime/predicates.ts';
import type { TransformRegistry } from './runtime/transforms.ts';
import type { WorkflowCachePort } from './runtime/cache.ts';
import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from './persistence/ports.ts';
import type { WorkflowRuntimeState } from './orchestrator/workflowOrchestrator.ts';

import { systemClock } from '../runtime/clock.ts';
import { systemIdFactory } from '../contracts/ids.ts';
import { createMetrics } from '../observability/metrics.ts';
import { aiExecutionPermitted } from '../runtime/operationalSettings.ts';
import { SPEND_SCOPE, remainingMicroUsd } from '../policy/spendLedger.ts';
import { createModelProfileRegistry } from '../agents/runtime/modelRouting.ts';
import { DEFAULT_MODEL_PROFILES } from '../agents/runtime/defaultProfiles.ts';
import { createControlPlaneModelPort } from '../agents/orchestrator/controlPlaneBridge.ts';

import { createWorkflowRegistry } from './registry/workflowRegistry.ts';
import { createWorkflowOrchestrator } from './orchestrator/workflowOrchestrator.ts';
import { createWorkflowService } from './service/workflowService.ts';
import { createWorkflowApprovalGate } from './approvals/workflowApprovalGate.ts';
import { createAgentRuntimeBridge } from './orchestrator/agentBridge.ts';
import { createToolGatewayBridge } from './orchestrator/toolBridge.ts';
import {
  createPredicateRegistry,
  registerDefaultPredicates,
} from './runtime/predicates.ts';
import {
  createTransformRegistry,
  registerDefaultTransforms,
} from './runtime/transforms.ts';
import {
  createMemoryWorkflowCache,
  createSafeWorkflowCache,
} from './runtime/cache.ts';
import {
  createMemoryWorkflowApprovalStore,
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from './persistence/ports.ts';
import {
  createCompositeWorkflowAuditStore,
  createMemoryWorkflowAuditStore,
  createWorkflowAuditWriter,
} from './observability/workflowAudit.ts';

export interface WorkflowRuntimeOptions {
  /** The governed AI execution path. Required — there is no alternative. */
  readonly plane: AIControlPlane;
  /** The certified Batch 3A agent runtime. Required for agent and tool nodes. */
  readonly agentRuntime: AgentRuntime;
  /** The same authenticator the guard uses. Never a second credential path. */
  readonly authenticator: AIAuthenticator;
  readonly organizationOptions: OrganizationResolutionOptions;
  /** Workflows to register. Batch 3B ships none; callers supply their own. */
  readonly workflows?: readonly WorkflowDefinition[];
  /** Model profiles. Defaults to the two the platform ships. */
  readonly profiles?: readonly ModelProfile[];
  /** Durable stores. Omitted, the engine is isolate-local — tests only. */
  readonly runStore?: WorkflowRunStore;
  readonly checkpointStore?: WorkflowCheckpointStore;
  readonly approvalStore?: WorkflowApprovalStore;
  /** Durable audit stores written alongside the in-memory ring. */
  readonly auditStores?: readonly WorkflowAuditStore[];
  readonly auditBufferSize?: number;
  /** Cache port. Defaults to a bounded in-memory adapter, wrapped safe. */
  readonly cache?: WorkflowCachePort;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  /** Micro-USD above which a node needs a human decision. */
  readonly costApprovalThresholdMicroUsd?: number;
  /** True when high-risk nodes may be cached. Off unless a deployment opts in. */
  readonly highRiskCachingPermitted?: boolean;
  /** Override the model port. Tests substitute a deterministic one. */
  readonly modelPort?: ModelExecutionPort;
  /** Extra predicates and transforms a deployment registers. */
  readonly predicates?: readonly { readonly id: string; readonly predicate: Parameters<PredicateRegistry['register']>[1] }[];
  readonly transforms?: readonly { readonly id: string; readonly transform: Parameters<TransformRegistry['register']>[1] }[];
}

export interface WorkflowRuntime {
  readonly registry: WorkflowRegistry;
  readonly orchestrator: WorkflowOrchestrator;
  readonly service: WorkflowService;
  readonly approvals: WorkflowApprovalGate;
  readonly predicates: PredicateRegistry;
  readonly transforms: TransformRegistry;
  readonly cache: WorkflowCachePort;
  readonly runs: WorkflowRunStore;
  readonly checkpoints: WorkflowCheckpointStore;
  readonly audit: WorkflowAuditWriter;
  /** The administrative and health facts the orchestrator reads per node. */
  state(): WorkflowRuntimeState;
}

export function createWorkflowRuntime(options: WorkflowRuntimeOptions): WorkflowRuntime {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? systemIdFactory;
  const metrics = options.metrics ?? createMetrics();
  const logger = options.logger ?? options.plane.logger;

  /**
   * The live administrative and health view.
   *
   * Read through a function on every node rather than captured once. An operator
   * who engages the emergency stop must stop the NEXT node of a run that is
   * already in flight, and a value copied at assembly would wait for an isolate to
   * recycle — which for an emergency stop is the same as not having one.
   */
  const state = (): WorkflowRuntimeState => {
    const settings = options.plane.settings.current();
    const health = options.plane.health();
    return {
      aiEnabled: aiExecutionPermitted(settings),
      // `unhealthy` means no provider can serve anything. `degraded` still serves,
      // so a run continues on the cheaper profile rather than stopping.
      executionAvailable: health.status !== 'unhealthy',
      degraded: health.status === 'degraded',
      requireCertifiedProviders: settings.requireCertifiedProviders,
      // Workflow certification follows the AGENT switch rather than introducing a
      // fifth one. A workflow is a plan over agents, tools and profiles, all three
      // of which already have their own switch; a deployment that requires
      // certified agents is making the same judgement about the plans that drive
      // them, and a separate control nobody sets would be a control that is
      // effectively always off.
      requireCertifiedWorkflows: settings.requireCertifiedAgents,
      configurationVersion: settings.configurationVersion,
    };
  };

  const profiles = createModelProfileRegistry();
  profiles.registerAll(options.profiles ?? DEFAULT_MODEL_PROFILES);

  const predicates = createPredicateRegistry();
  registerDefaultPredicates(predicates);
  for (const entry of options.predicates ?? []) predicates.register(entry.id, entry.predicate);

  const transforms = createTransformRegistry();
  registerDefaultTransforms(transforms);
  for (const entry of options.transforms ?? []) transforms.register(entry.id, entry.transform);

  // ── Bridges to the certified Batch 3A runtime ─────────────────────────────
  const agents = createAgentRuntimeBridge({
    orchestrator: options.agentRuntime.orchestrator,
    registry: options.agentRuntime.registry,
    loadRun: (organizationId, runId) => options.agentRuntime.runs.load(organizationId, runId),
    latestCheckpointOutput: async (organizationId, runId) => {
      const checkpoint = await options.agentRuntime.checkpoints.latest(organizationId, runId);
      return checkpoint?.output;
    },
  });
  const tools = createToolGatewayBridge({ gateway: options.agentRuntime.gateway });

  const registry = createWorkflowRegistry({
    requireCertification: () => state().requireCertifiedWorkflows,
    knownAgentIds: () => agents.knownAgentIds(),
    knownToolIds: () => tools.knownToolIds(),
    knownProfileIds: () => profiles.list().map((profile) => profile.profileId),
  });
  if (options.workflows?.length) registry.registerAll(options.workflows);

  const runs = options.runStore ?? createMemoryWorkflowRunStore();
  const checkpoints = options.checkpointStore ?? createMemoryWorkflowCheckpointStore();
  const approvalStore = options.approvalStore ?? createMemoryWorkflowApprovalStore();

  const memoryAudit = createMemoryWorkflowAuditStore(options.auditBufferSize ?? 500);
  const auditStore =
    options.auditStores && options.auditStores.length > 0
      ? createCompositeWorkflowAuditStore(memoryAudit, options.auditStores, (error) =>
          logger.error('ai.workflow.audit.durable_write_failed', {
            diagnostics: error instanceof Error ? error.message : String(error),
          }),
        )
      : memoryAudit;
  const audit = createWorkflowAuditWriter({
    store: auditStore,
    clock,
    newAuditId: () => ids.next('wfd'),
  });

  const approvals = createWorkflowApprovalGate({
    store: approvalStore,
    clock,
    newApprovalId: () => ids.next('wfa'),
  });

  // A cache that can fail a run is worse than no cache, so every port is wrapped.
  const cache = createSafeWorkflowCache(
    options.cache ?? createMemoryWorkflowCache(),
    (operation, error) =>
      logger.warn('ai.workflow.cache.failed', {
        operation,
        diagnostics: error instanceof Error ? error.message : String(error),
      }),
  );

  const models = options.modelPort ?? createControlPlaneModelPort(options.plane);

  const orchestrator = createWorkflowOrchestrator({
    registry,
    profiles,
    predicates,
    transforms,
    agents,
    tools,
    models,
    cache,
    runs,
    checkpoints,
    approvals,
    audit,
    clock,
    ids,
    logger,
    metrics,
    runtimeState: state,
    // The MARQ lifetime ceiling, READ rather than reserved against. The spend guard
    // inside the control plane is what actually holds money for a call; taking a
    // second hold here would double-count the same headroom. See
    // `runtime/costOptimizer.ts` for the full reasoning.
    platformHeadroomMicroUsd: async () => {
      const spendRecord = await options.plane.spendStatus();
      return remainingMicroUsd(spendRecord);
    },
    ...(options.costApprovalThresholdMicroUsd === undefined
      ? {}
      : { costApprovalThresholdMicroUsd: options.costApprovalThresholdMicroUsd }),
    ...(options.highRiskCachingPermitted === undefined
      ? {}
      : { highRiskCachingPermitted: options.highRiskCachingPermitted }),
  });

  const service = createWorkflowService({
    orchestrator,
    registry,
    runs,
    approvals,
    audit,
    authenticator: options.authenticator,
    organizationOptions: options.organizationOptions,
    clock,
    ids,
  });

  for (const issue of registry.validate()) {
    logger.warn('ai.workflow.registry.issue', { issue });
  }

  return {
    registry,
    orchestrator,
    service,
    approvals,
    predicates,
    transforms,
    cache,
    runs,
    checkpoints,
    audit,
    state,
  };
}

/** The spend scope the engine reads headroom from. Re-exported for tests. */
export const WORKFLOW_SPEND_SCOPE = SPEND_SCOPE.platform;
