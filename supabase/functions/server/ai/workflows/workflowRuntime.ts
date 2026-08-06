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
import type { WorkflowRunStore } from './persistence/ports.ts';
import type { WorkflowRegistry } from './registry/workflowRegistry.ts';
import type {
  WorkflowAgentPort,
} from './engine/agentNodePort.ts';
import type {
  WorkflowOrchestrator,
  WorkflowRuntimeState,
} from './engine/workflowOrchestrator.ts';
import type { WorkflowRuntimeService } from './service/workflowRuntimeService.ts';

import { systemClock } from '../runtime/clock.ts';
import { systemIdFactory } from '../contracts/ids.ts';
import { createMetrics } from '../observability/metrics.ts';
import { createWorkflowRegistry } from './registry/workflowRegistry.ts';
import { createMemoryWorkflowRunStore } from './persistence/ports.ts';
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
  /** Durable store. Omitted, the runtime is isolate-local — tests only. */
  readonly runStore?: WorkflowRunStore;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  /** See the header. Defaults to the agent runtime's certification switch. */
  readonly requireCertifiedWorkflows?: () => boolean;
  /** Override the agent port. Tests substitute a deterministic one. */
  readonly agentPort?: WorkflowAgentPort;
}

export interface WorkflowRuntime {
  readonly registry: WorkflowRegistry;
  readonly orchestrator: WorkflowOrchestrator;
  readonly service: WorkflowRuntimeService;
  readonly runs: WorkflowRunStore;
  readonly agents: WorkflowAgentPort;
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
  const agents =
    options.agentPort ?? createAgentRuntimeNodePort(options.agentRuntime.orchestrator);

  const orchestrator = createWorkflowOrchestrator({
    registry,
    runs,
    agents,
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

  return { registry, orchestrator, service, runs, agents, state };
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
