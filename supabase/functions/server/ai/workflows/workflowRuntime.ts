/**
 * Workflow runtime assembly (AI-01 Batch 3B).
 *
 * The `createAgentRuntime` of the workflow world: one function that builds the
 * whole dependency graph by explicit injection, so a test can assemble the REAL
 * registry, planner, state machine, orchestrator, approval gate, stores and
 * service with a fake clock, sequential ids and in-memory stores — and exercise
 * production code end to end with no network, no globals and no shared state
 * between cases.
 *
 * THE ONE DEPENDENCY THAT IS NOT OPTIONAL IS THE CERTIFIED AGENT RUNTIME. The
 * workflow runtime takes it and derives everything execution-related from it:
 *
 *   the agent port      every agent node runs through the certified agent
 *                       orchestrator, which runs through the control plane
 *   the tool gateway    every tool node runs through the certified gateway,
 *                       under the permission of the agent the node names
 *   the approval store  workflow gates live in the same durable store, decided
 *                       through the same certified gate
 *   the runtime state   the kill switch, the master switch, the agent
 *                       certification requirement and the configuration version
 *
 * There is no mode in which a workflow executes without an agent runtime, no
 * flag that bypasses it, and no second path. That is the batch's central
 * architectural claim at this layer, and it is enforced here by construction
 * rather than by convention — this module cannot even name a provider, and the
 * boundary scan asserts that nothing under `ai/workflows/` imports the control
 * plane.
 */

import type { AIAuthenticator } from '../security/actor.ts';
import type { OrganizationResolutionOptions } from '../security/tenancy.ts';
import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type { Metrics } from '../observability/metrics.ts';
import type { AgentRuntime } from '../agents/agentRuntime.ts';
import type { AgentApprovalStore } from '../agents/persistence/ports.ts';

import type { WorkflowDefinition } from './contracts/workflow.ts';
import type { WorkflowRegistry } from './registry/workflowRegistry.ts';
import { createWorkflowRegistry } from './registry/workflowRegistry.ts';
import type {
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from './persistence/workflowPorts.ts';
import {
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from './persistence/workflowPorts.ts';
import type {
  WorkflowAuditStore,
  WorkflowAuditWriter,
} from './observability/workflowAudit.ts';
import {
  createCompositeWorkflowAuditStore,
  createMemoryWorkflowAuditStore,
  createWorkflowAuditWriter,
} from './observability/workflowAudit.ts';
import type { WorkflowApprovalGate } from './approvals/workflowApprovalGate.ts';
import { createWorkflowApprovalGate } from './approvals/workflowApprovalGate.ts';
import type { AgentExecutionPort } from './orchestrator/agentRuntimePort.ts';
import { createAgentExecutionPort } from './orchestrator/agentRuntimePort.ts';
import type {
  WorkflowOrchestrator,
  WorkflowRuntimeState,
} from './orchestrator/workflowOrchestrator.ts';
import { createWorkflowOrchestrator } from './orchestrator/workflowOrchestrator.ts';
import type { WorkflowService } from './service/workflowService.ts';
import { createWorkflowService } from './service/workflowService.ts';

export interface WorkflowRuntimeOptions {
  /** The certified agent runtime. Required — there is no alternative. */
  readonly agentRuntime: AgentRuntime;
  /** The same authenticator the guard and the agent runtime use. */
  readonly authenticator: AIAuthenticator;
  readonly organizationOptions: OrganizationResolutionOptions;
  /** Workflows to register. Batch 3B ships none; callers supply their own. */
  readonly workflows?: readonly WorkflowDefinition[];
  /** Durable stores. Omitted, the runtime is isolate-local — tests only. */
  readonly runStore?: WorkflowRunStore;
  readonly checkpointStore?: WorkflowCheckpointStore;
  /**
   * The durable approval store. The SAME one the agent runtime uses in
   * production: workflow gates and agent gates are one queue, one record shape
   * and one single-use guarantee.
   */
  readonly approvalStore: AgentApprovalStore;
  /** Durable audit stores written alongside the in-memory ring. */
  readonly auditStores?: readonly WorkflowAuditStore[];
  readonly auditBufferSize?: number;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly metrics: Metrics;
}

export interface WorkflowRuntime {
  readonly registry: WorkflowRegistry;
  readonly orchestrator: WorkflowOrchestrator;
  readonly service: WorkflowService;
  readonly approvals: WorkflowApprovalGate;
  readonly agentPort: AgentExecutionPort;
  readonly runs: WorkflowRunStore;
  readonly checkpoints: WorkflowCheckpointStore;
  readonly audit: WorkflowAuditWriter;
  /** The administrative and health facts the orchestrator reads per wave. */
  state(): WorkflowRuntimeState;
}

export function createWorkflowRuntime(options: WorkflowRuntimeOptions): WorkflowRuntime {
  const { agentRuntime, clock, ids, logger, metrics } = options;

  /**
   * The live administrative and health view.
   *
   * Read through a function on every wave rather than captured once — the same
   * decision `createAgentRuntime` makes, for the same reason: an operator who
   * engages the emergency stop must stop the NEXT wave of a plan already in
   * flight, and a value copied at assembly would wait for an isolate to recycle.
   *
   * It is DERIVED from the agent runtime's own state rather than read
   * independently. Two components reading the same settings through two paths
   * is two things that can disagree about whether the kill switch is engaged.
   */
  const state = (): WorkflowRuntimeState => {
    const agentState = agentRuntime.state();
    return {
      aiEnabled: agentState.aiEnabled,
      executionAvailable: agentState.executionAvailable,
      // A workflow composes agents and nothing else, so the agent certification
      // switch is the workflow certification switch. See the note on
      // `WorkflowRuntimeState`.
      requireCertifiedWorkflows: agentState.requireCertifiedAgents,
      configurationVersion: agentState.configurationVersion,
    };
  };

  const registry = createWorkflowRegistry({
    requireCertification: () => state().requireCertifiedWorkflows,
    // Validated against the REAL agent and tool registries. A workflow that
    // names something that does not exist is refused when it is registered
    // rather than when it is halfway through its first run.
    agentExists: (agentId) => agentRuntime.registry.find(agentId) !== undefined,
    toolExists: (toolId) => agentRuntime.gateway.describe(toolId) !== undefined,
    agentMayUseTool: (agentId, toolId) =>
      agentRuntime.registry.find(agentId)?.allowedTools.includes(toolId) === true,
  });
  if (options.workflows?.length) registry.registerAll(options.workflows);

  const runs = options.runStore ?? createMemoryWorkflowRunStore();
  const checkpoints = options.checkpointStore ?? createMemoryWorkflowCheckpointStore();

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
    newAuditId: () => ids.next('wfa'),
  });

  const approvals = createWorkflowApprovalGate({
    store: options.approvalStore,
    // The CERTIFIED gate decides, consumes and expires. This runtime only
    // creates requests; every property that actually enforces something has
    // exactly one implementation, and it is Batch 3A's.
    gate: agentRuntime.approvals,
    clock,
    newApprovalId: () => ids.next('wap'),
  });

  const agentPort = createAgentExecutionPort({
    orchestrator: agentRuntime.orchestrator,
    checkpoints: agentRuntime.checkpoints,
  });

  const orchestrator = createWorkflowOrchestrator({
    registry,
    runs,
    checkpoints,
    approvals,
    agents: agentPort,
    tools: agentRuntime.gateway,
    agentDefinition: (agentId) => agentRuntime.registry.find(agentId),
    audit,
    clock,
    ids,
    logger,
    metrics,
    runtimeState: state,
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
    agentRuns: agentRuntime.runs,
    ...(agentRuntime.promptCache === undefined
      ? {}
      : {
          cacheStats: () => {
            const stats = agentRuntime.promptCache?.stats();
            return {
              size: stats?.size ?? 0,
              lookups: stats?.lookups ?? 0,
              hits: stats?.hits ?? 0,
              misses: stats?.misses ?? 0,
              stores: stats?.stores ?? 0,
              evictions: stats?.evictions ?? 0,
            };
          },
        }),
  });

  for (const issue of registry.validate()) {
    logger.warn('ai.workflow.registry.issue', { issue });
  }

  return {
    registry,
    orchestrator,
    service,
    approvals,
    agentPort,
    runs,
    checkpoints,
    audit,
    state,
  };
}
