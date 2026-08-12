/**
 * Workflow runtime assembly (AI-01 Batch 3B, Part 2).
 *
 * One function that builds the whole dependency graph by explicit injection, so
 * a test can assemble the REAL registry, planner, state machine, engine and
 * service with a fake clock, sequential ids and an in-memory store — and
 * exercise production code end to end with no network, no globals and no shared
 * state between cases. The same shape `createAgentRuntime` uses, for the same
 * reason.
 *
 * ── THE ONE DEPENDENCY THAT IS NOT OPTIONAL ────────────────────────────────
 *
 * The certified Batch 3A Agent Runtime. The workflow runtime takes it and
 * derives three things:
 *
 *   the agent port      every node executes through `orchestrator.createRun`
 *                       and `orchestrator.advance` — see `engine/agentNodePort.ts`
 *   agent existence     the registry refuses to register a workflow naming an
 *                       agent that is not registered, at ASSEMBLY, not at run
 *   the actor bridge    a person's agent-runtime capabilities, resolved by the
 *                       agent runtime's own RBAC rather than a copy of it
 *
 * There is no mode in which a workflow executes without an agent runtime, no
 * flag that bypasses it, and no second path to an agent. That is this part's
 * central architectural claim and it is enforced here by construction.
 *
 * ── CERTIFICATION ──────────────────────────────────────────────────────────
 *
 * `requireCertifiedWorkflows` defaults to the agent runtime's
 * `requireCertifiedAgents` and is overridable. It is NOT a new operator switch:
 * adding one means a new field on the Batch 2 settings record, a new
 * environment variable and a new administration surface, which is Part 3's
 * work. Defaulting to the agents switch is the conservative direction — a
 * deployment that demands certified agents gets certified workflows too — and
 * the coupling is stated here rather than left for an operator to discover, the
 * way Batch 3A's single flag once was.
 */

import type { Clock } from '../runtime/clock.ts';
import type { IdFactory } from '../contracts/ids.ts';
import type { Logger } from '../observability/logger.ts';
import type { Metrics } from '../observability/metrics.ts';
import type { AIAuthenticator, AuthenticatedSubject } from '../security/actor.ts';
import type { OrganizationResolutionOptions } from '../security/tenancy.ts';
import type { AgentRuntime } from '../agents/agentRuntime.ts';
import type { WorkflowDefinition } from './contracts/workflow.ts';
import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from './persistence/ports.ts';
import type { WorkflowRegistry } from './registry/workflowRegistry.ts';
import type { WorkflowApprovalGate } from './approvals/workflowApprovalGate.ts';
import type {
  WorkflowAgentPort,
} from './engine/agentNodePort.ts';
import type {
  WorkflowOrchestrator,
  WorkflowRuntimeState,
} from './engine/workflowOrchestrator.ts';
import type { WorkflowRuntimeService } from './service/workflowRuntimeService.ts';
import type { FinancialEventStore } from '../financial/persistence/ports.ts';
import type { WorkflowFinancialPort } from './financial/contracts/emission.ts';
import type {
  WorkflowNodeCostProfile,
  WorkflowNodeLimits,
} from './financial/nodeCostProfile.ts';
import type { WorkflowReuseResolver } from './financial/workflowFinancialRecorder.ts';
import { createInMemoryFinancialEventStore } from '../financial/persistence/ports.ts';
import { createWorkflowFinancialRecorder } from './financial/workflowFinancialRecorder.ts';

import { systemClock } from '../runtime/clock.ts';
import { systemIdFactory } from '../contracts/ids.ts';
import { createMetrics } from '../observability/metrics.ts';
import { createWorkflowRegistry } from './registry/workflowRegistry.ts';
import {
  createMemoryWorkflowApprovalStore,
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from './persistence/ports.ts';
import { createWorkflowApprovalGate } from './approvals/workflowApprovalGate.ts';
import { createAgentRuntimeNodePort } from './engine/agentNodePort.ts';
import { createWorkflowOrchestrator } from './engine/workflowOrchestrator.ts';
import { createWorkflowRuntimeService } from './service/workflowRuntimeService.ts';
import { resolveAgentActor } from '../agents/service/agentRbac.ts';

export interface WorkflowRuntimeOptions {
  /** The certified Batch 3A agent runtime. Required — there is no alternative. */
  readonly agentRuntime: AgentRuntime;
  /** The same authenticator the guard and the agent runtime use. */
  readonly authenticator: AIAuthenticator;
  readonly organizationOptions: OrganizationResolutionOptions;
  /** Workflows to register. Part 2 ships none; callers supply their own. */
  readonly workflows?: readonly WorkflowDefinition[];
  /** Durable stores. Omitted, the runtime is isolate-local — tests only. */
  readonly runStore?: WorkflowRunStore;
  readonly checkpointStore?: WorkflowCheckpointStore;
  readonly approvalStore?: WorkflowApprovalStore;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  /** See the header. Defaults to the agent runtime's certification switch. */
  readonly requireCertifiedWorkflows?: () => boolean;
  /** Override the agent port. Tests substitute a deterministic one. */
  readonly agentPort?: WorkflowAgentPort;

  // ── Live financial evidence (AI-01 Batch 3B, Integration Pass) ────────────

  /**
   * Durable financial events. Omitted, the recorder is isolate-local.
   *
   * The same call every other store on this assembly makes, and the same
   * consequence: an in-memory store is correct for one isolate and for tests,
   * and a deployment that wants events to outlive an isolate injects the Part 6C
   * KV store.
   */
  readonly financialEventStore?: FinancialEventStore;
  /**
   * What a deployment declares about a node's economics.
   *
   * Absent, every node gets `nodeCostProfile.ts`'s conservative defaults, which
   * claim NO saving — a truthful cost against a single-band envelope. Savings
   * appear when a deployment declares the facts that justify them, and never
   * because an integration defaulted its way into a flattering number.
   */
  readonly nodeCostProfileFor?: (facts: {
    readonly workflowId: string;
    readonly nodeId: string;
    readonly agentId: string;
  }) => WorkflowNodeCostProfile | undefined;
  /**
   * The Part 6B reuse resolver. Absent disables reuse for this deployment.
   *
   * Absent BY DEFAULT, deliberately. Resolving a reuse hit needs a
   * reusable-result store, a task fingerprint, dependency declarations and a
   * freshness policy — the things Part 6B built and the things a deployment must
   * supply. Defaulting one here would mean every deployment silently acquired a
   * cache in front of its model calls.
   */
  readonly reuseResolver?: WorkflowReuseResolver;
  /**
   * Replace the whole financial port. Tests and disabled deployments only.
   *
   * `createNoopWorkflowFinancialPort()` is the explicit way to switch recording
   * off; the engine's behaviour is identical with it, because a port that
   * decides nothing produces the same `undefined` a missing envelope does.
   */
  readonly financialPort?: WorkflowFinancialPort;
}

export interface WorkflowRuntime {
  readonly registry: WorkflowRegistry;
  readonly orchestrator: WorkflowOrchestrator;
  readonly service: WorkflowRuntimeService;
  readonly runs: WorkflowRunStore;
  readonly checkpoints: WorkflowCheckpointStore;
  readonly approvalStore: WorkflowApprovalStore;
  /**
   * The approval gate.
   *
   * Exposed so an operator surface can read the queue and so the service can
   * record a decision. Note what is NOT exposed: the engine's own use of it.
   * There is one gate, both paths go through it, and the single-use guarantee
   * is a property of the store beneath it rather than of who called.
   */
  readonly approvals: WorkflowApprovalGate;
  readonly agents: WorkflowAgentPort;
  /**
   * The one path from execution to canonical financial evidence.
   *
   * Exposed so an operator surface and the Part 6C read models can be pointed at
   * the same events the engine wrote. Note what is exposed: the PORT and the
   * STORE, never a total — every figure is folded from the events on read, so
   * there is nothing here for a second accumulator to disagree with.
   */
  readonly financial: WorkflowFinancialPort;
  readonly financialEvents: FinancialEventStore;
  /** The administrative and health facts the engine reads per advance. */
  state(): WorkflowRuntimeState;
}

export function createWorkflowRuntime(options: WorkflowRuntimeOptions): WorkflowRuntime {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? systemIdFactory;
  const metrics = options.metrics ?? createMetrics();
  const logger = options.logger ?? console_fallback();

  /**
   * The live administrative and health view.
   *
   * Read through a function on every advance rather than captured once. An
   * operator who engages the emergency stop must stop the NEXT node of a run
   * that is already in flight, and a value copied at assembly would wait for an
   * isolate to recycle — which for an emergency stop is the same as not having
   * one.
   */
  const state = (): WorkflowRuntimeState => {
    const agentState = options.agentRuntime.state();
    return {
      aiEnabled: agentState.aiEnabled,
      executionAvailable: agentState.executionAvailable,
      requireCertifiedWorkflows:
        options.requireCertifiedWorkflows?.() ?? agentState.requireCertifiedAgents,
      configurationVersion: agentState.configurationVersion,
    };
  };

  const registry = createWorkflowRegistry({
    requireCertification: () => state().requireCertifiedWorkflows,
    // Registration-time agent resolution. `find` rather than `require`, because
    // "this agent exists" and "this agent may run right now" are different
    // questions: a workflow naming a temporarily disabled agent is still a
    // valid workflow, and the agent runtime refuses the node at execution.
    agentExists: (agentId) => options.agentRuntime.registry.find(agentId) !== undefined,
  });
  if (options.workflows?.length) registry.registerAll(options.workflows);

  const runs = options.runStore ?? createMemoryWorkflowRunStore();
  const checkpoints = options.checkpointStore ?? createMemoryWorkflowCheckpointStore();
  const approvalStore = options.approvalStore ?? createMemoryWorkflowApprovalStore();
  // ONE GATE, shared by the engine and the service. Two would be two writers
  // to one store with two ideas about single use, and the compare-and-swap
  // beneath them would be the only thing keeping them honest.
  const approvals = createWorkflowApprovalGate({ store: approvalStore, clock });
  const agents =
    options.agentPort ?? createAgentRuntimeNodePort(options.agentRuntime.orchestrator);

  const financialEvents = options.financialEventStore ?? createInMemoryFinancialEventStore();

  /**
   * THE ONE PLACE THE AGENT REGISTRY IS READ FOR LIMITS.
   *
   * The workflow tree cannot import the agent registry — the boundary scan
   * asserts that on the source, and this assembly is one of the two exempt
   * modules. So the ceilings a baseline is priced against come from the AGENT'S
   * OWN declared limits, resolved here and handed to the recorder as a function.
   *
   * An agent the registry does not hold yields `undefined`, and the recorder then
   * produces no decision and no event for its nodes. That is the honest outcome:
   * a baseline priced against an envelope nobody declared is a savings
   * denominator nobody could defend, and it is exactly the figure an adversarial
   * reviewer would attack first.
   */
  const limitsFor = (agentId: string): WorkflowNodeLimits | undefined => {
    const definition = options.agentRuntime.registry.find(agentId);
    if (definition === undefined) return undefined;
    const limits = definition.limits;
    return {
      maxPromptTokens: limits.maxPromptTokens,
      maxCompletionTokens: limits.maxCompletionTokens,
      maxTotalTokens: limits.maxTotalTokens,
      // The ACTUAL ceiling, not the estimated one. It is what the tenant may
      // really spend on this agent, which is what an envelope's remaining cost
      // means — and the smaller of the two would understate nothing but the
      // headroom the optimiser is allowed to see.
      maxActualCostMicroUsd: limits.maxActualCostMicroUsd,
    };
  };

  const financial =
    options.financialPort ??
    createWorkflowFinancialRecorder({
      store: financialEvents,
      limitsFor,
      ...(options.nodeCostProfileFor === undefined
        ? {}
        : {
            profileFor: (facts) =>
              options.nodeCostProfileFor?.({
                workflowId: facts.workflowId,
                nodeId: facts.nodeId,
                agentId: facts.agentId,
              }),
          }),
      ...(options.reuseResolver === undefined ? {} : { reuse: options.reuseResolver }),
      // Read LIVE, through the same view the engine reads. An operator engaging
      // the emergency stop must make the next plan a refusal, and a value copied
      // at assembly would wait for an isolate to recycle.
      aiEnabled: () => state().aiEnabled,
      logger,
      metrics,
    });

  const orchestrator = createWorkflowOrchestrator({
    registry,
    runs,
    checkpoints,
    approvals,
    agents,
    financial,
    clock,
    ids,
    logger,
    metrics,
    runtimeState: state,
  });

  const service = createWorkflowRuntimeService({
    orchestrator,
    registry,
    runs,
    approvals,
    authenticator: options.authenticator,
    organizationOptions: options.organizationOptions,
    clock,
    ids,
    // The agent runtime's OWN grant table, called through its own resolver.
    // A copy of it here would be a second answer to "what may this person do
    // with an agent", and the two would drift the first time either changed.
    agentCapabilitiesFor: (subject, organizationId) =>
      agentCapabilitiesFor(subject, organizationId, options.organizationOptions),
  });

  for (const issue of registry.validate()) {
    logger.warn('ai.workflow.registry.issue', { issue });
  }

  return {
    registry,
    orchestrator,
    service,
    runs,
    checkpoints,
    approvalStore,
    approvals,
    agents,
    financial,
    financialEvents,
    state,
  };
}

/**
 * Agent capabilities for a subject, or none.
 *
 * A subject the agent runtime refuses gets an EMPTY capability list rather than
 * an exception, so a person who may read workflows but not run agents can still
 * read them. The refusal then happens where it belongs — at the first node, by
 * the Agent Orchestrator — instead of turning every workflow read into an
 * agent-runtime authorization check.
 */
function agentCapabilitiesFor(
  subject: AuthenticatedSubject | null,
  organizationId: string,
  organizationOptions: OrganizationResolutionOptions,
): readonly string[] {
  try {
    return resolveAgentActor(subject, organizationId, organizationOptions).capabilities;
  } catch {
    return [];
  }
}

/** A logger is always injected in practice; this keeps the option honest. */
function console_fallback(): Logger {
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  };
  return logger;
}
