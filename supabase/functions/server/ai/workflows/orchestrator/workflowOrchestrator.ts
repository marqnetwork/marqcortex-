/**
 * The Workflow Orchestrator (AI-01 Batch 3B).
 *
 * THE SOLE AUTHORITY OVER A PLAN'S EXECUTION, and the layer the batch's locked
 * rule names in the middle:
 *
 *   WORKFLOWS PLAN. AGENTS PROPOSE. THE ORCHESTRATOR DECIDES.
 *   THE AI CONTROL PLANE EXECUTES.
 *
 * A definition says what MAY happen and in what order. This module decides what
 * DOES: which nodes are admitted, which are skipped and why, when a wave may
 * start, whether the run can still afford it, when a human has to decide first,
 * and what the whole thing ends as. Nothing else in the workflow runtime changes
 * a run record, and the record is the only authority — a wave that has not been
 * persisted has not happened.
 *
 * IT EXECUTES NOTHING ITSELF. An agent node goes through `agentRuntimePort.ts`
 * to the CERTIFIED agent orchestrator; a tool node goes through the CERTIFIED
 * tool gateway, under the permission of the agent the node names; a model call
 * happens only where it always has, inside the control plane. There is no fourth
 * execution path here, and there is nothing in this module's imports that could
 * become one.
 *
 * BOUNDED PARALLELISM IS A PROPERTY OF THE PLAN, NOT OF A SCHEDULER. The planner
 * already split every layer to the definition's `maxParallel`, so a wave IS the
 * concurrency bound. This module runs a wave's admitted nodes with `Promise.all`
 * and nothing else — there is no queue, no semaphore and no in-flight set,
 * because all three would be state that a recycled isolate takes with it.
 *
 * DURABILITY IS PER WAVE, NOT PER RUN. A checkpoint is written and the record is
 * persisted under compare-and-swap after every wave. Two isolates that both try
 * to advance the same run therefore race exactly once, at the wave boundary: one
 * writes, the other gets a typed conflict and re-reads. That is the same
 * guarantee the agent runtime has at its step boundary, at the granularity a
 * plan actually moves in.
 *
 * WHAT IS DELIBERATELY ABSENT: any way to create, edit or author a workflow at
 * runtime. Definitions are registry-time decisions reviewed as code. A customer
 * workflow builder is explicitly out of this batch's scope, and an API that could
 * assemble one would be that scope arriving through the back door.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Logger } from '../../observability/logger.ts';
import type { Metrics } from '../../observability/metrics.ts';
import type { AgentRunActor } from '../../agents/orchestrator/agentOrchestrator.ts';
import type { AgentDefinition } from '../../agents/contracts/agent.ts';
import type { ToolGateway } from '../../agents/tools/toolRegistry.ts';
import type { AgentTokenLedger } from '../../agents/contracts/runtime.ts';
import type { OptimizationLedger } from '../../optimization/optimizationLedger.ts';
import {
  emptyOptimizationLedger,
  mergeOptimizationLedgers,
} from '../../optimization/optimizationLedger.ts';
import { emptyTokenLedger } from '../../agents/runtime/tokenIntelligence.ts';
import { emptyCostLedger } from '../../agents/runtime/costPolicy.ts';
import { digestValue } from '../../agents/runtime/digest.ts';

import type {
  WorkflowAgentNode,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowToolNode,
} from '../contracts/workflow.ts';
import { WORKFLOW_BOUNDS } from '../contracts/workflow.ts';
import type {
  WorkflowCheckpoint,
  WorkflowFactMap,
  WorkflowFactValue,
  WorkflowNodeRecord,
  WorkflowNodeState,
  WorkflowRunContext,
  WorkflowRunOperation,
  WorkflowRunRecord,
  WorkflowRunState,
} from '../contracts/runtime.ts';
import { MAX_WORKFLOW_TRANSITIONS, isTerminalWorkflowState } from '../contracts/runtime.ts';
import type { WorkflowFailureCode } from '../contracts/failures.ts';
import { terminalWorkflowStateFor, workflowFailure } from '../contracts/failures.ts';
import type { WorkflowRegistry } from '../registry/workflowRegistry.ts';
import { planWorkflow } from '../planner/workflowPlanner.ts';
import { assertWorkflowTransition } from '../runtime/workflowStateMachine.ts';
import { admitNode, allNodesSettled, nodeStatesOf } from '../runtime/conditions.ts';
import type {
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from '../persistence/workflowPorts.ts';
import type { WorkflowApprovalGate } from '../approvals/workflowApprovalGate.ts';
import type { AgentExecutionPort, AgentNodeExecutionOutcome } from './agentRuntimePort.ts';
import type { WorkflowAuditWriter } from '../observability/workflowAudit.ts';
import { WORKFLOW_AUDIT_EVENT } from '../observability/workflowAudit.ts';

/** Administrative and health facts the runtime re-reads before every wave. */
export interface WorkflowRuntimeState {
  readonly aiEnabled: boolean;
  readonly executionAvailable: boolean;
  /**
   * Certification requirement for workflows.
   *
   * Deliberately the SAME switch that governs agents. A workflow composes
   * agents and nothing else, so a deployment that demands certified agents has
   * already stated its posture — a separate workflow switch would let the two
   * disagree, and the combination "certified agents, uncertified plans" is not a
   * posture anybody would choose on purpose.
   */
  readonly requireCertifiedWorkflows: boolean;
  readonly configurationVersion: number;
}

export interface WorkflowOrchestratorDependencies {
  readonly registry: WorkflowRegistry;
  readonly runs: WorkflowRunStore;
  readonly checkpoints: WorkflowCheckpointStore;
  readonly approvals: WorkflowApprovalGate;
  readonly agents: AgentExecutionPort;
  readonly tools: ToolGateway;
  /** Resolve an agent definition for a tool node's permission check. */
  readonly agentDefinition: (agentId: string) => AgentDefinition | undefined;
  readonly audit: WorkflowAuditWriter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly metrics: Metrics;
  /** Settings and health, read live so an operator change lands immediately. */
  readonly runtimeState: () => WorkflowRuntimeState;
}

export interface CreateWorkflowRunInput {
  readonly workflowId: string;
  readonly organizationId: string;
  readonly actor: AgentRunActor;
  /** Seed facts the caller supplies. Validated as bounded scalars. */
  readonly facts?: Readonly<Record<string, unknown>>;
  readonly requestId: string;
  readonly correlationId: string;
  readonly origin: WorkflowRunContext['origin'];
}

export interface AdvanceWorkflowInput {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly actor: AgentRunActor;
  /** The driving caller's credential, for the control plane. Never stored. */
  readonly authorization: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly clientIp?: string;
}

export interface WorkflowControlInput {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly actor: AgentRunActor;
  readonly reason: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface WorkflowApprovalDecisionRequest extends WorkflowControlInput {
  readonly approvalId: string;
  readonly decision: 'approve' | 'reject';
}

export interface WorkflowOrchestrator {
  createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord>;
  /** Drive the plan until it blocks, completes or fails. */
  advance(input: AdvanceWorkflowInput): Promise<WorkflowRunRecord>;
  pause(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  resume(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  cancel(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  decideApproval(input: WorkflowApprovalDecisionRequest): Promise<WorkflowRunRecord>;
  /** Expire a run whose deadline has passed. Idempotent. */
  expireIfDue(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  latestCheckpoint(
    organizationId: string,
    workflowRunId: string,
  ): Promise<WorkflowCheckpoint | undefined>;
}

/** Waves one `advance` call may drive before it returns. */
const MAX_WAVES_PER_ADVANCE = 32;

export function createWorkflowOrchestrator(
  deps: WorkflowOrchestratorDependencies,
): WorkflowOrchestrator {
  const { registry, runs, checkpoints, approvals, agents, tools, audit, clock, ids } = deps;

  // ── Small helpers ─────────────────────────────────────────────────────────

  function writeAudit(
    record: WorkflowRunRecord,
    facts: {
      event: (typeof WORKFLOW_AUDIT_EVENT)[keyof typeof WORKFLOW_AUDIT_EVENT];
      outcome: 'allowed' | 'denied' | 'executed' | 'failed' | 'recorded' | 'skipped';
      requestId: string;
      correlationId: string;
      actorId: string;
      nodeId?: string;
      wave?: number;
      agentRunId?: string;
      approvalId?: string;
      nodeState?: WorkflowNodeState;
      failure?: WorkflowFailureCode;
      reason?: string;
      detail?: Readonly<Record<string, unknown>>;
    },
  ): void {
    audit.record({
      event: facts.event,
      outcome: facts.outcome,
      requestId: facts.requestId,
      correlationId: facts.correlationId,
      workflowRunId: record.context.workflowRunId,
      workflowId: record.context.workflowId,
      workflowVersion: record.context.workflowVersion,
      organizationId: record.context.organizationId,
      actorId: facts.actorId,
      state: record.state,
      ...(facts.nodeId === undefined ? {} : { nodeId: facts.nodeId }),
      ...(facts.wave === undefined ? {} : { wave: facts.wave }),
      ...(facts.agentRunId === undefined ? {} : { agentRunId: facts.agentRunId }),
      ...(facts.approvalId === undefined ? {} : { approvalId: facts.approvalId }),
      ...(facts.nodeState === undefined ? {} : { nodeState: facts.nodeState }),
      ...(facts.failure === undefined ? {} : { failure: facts.failure }),
      ...(facts.reason === undefined ? {} : { reason: facts.reason }),
      ...(facts.detail === undefined ? {} : { detail: facts.detail }),
    });
  }

  /** Persist a mutation under optimistic concurrency. */
  async function persist(
    record: WorkflowRunRecord,
    expectedVersion: number,
  ): Promise<WorkflowRunRecord> {
    await runs.save(record, expectedVersion);
    return record;
  }

  async function load(organizationId: string, workflowRunId: string): Promise<WorkflowRunRecord> {
    const record = await runs.load(organizationId, workflowRunId);
    if (!record) {
      throw workflowFailure('workflow_run_not_found', 'That workflow run could not be found.', {
        workflowRunId,
        diagnostics: `workflow run ${workflowRunId} not visible in ${organizationId}`,
      });
    }
    return record;
  }

  /**
   * Move a run to a new state.
   *
   * Every state change in this module goes through here, so the transition table
   * is consulted exactly once per change and the ring buffer cannot be bypassed.
   */
  function transition(
    record: WorkflowRunRecord,
    to: WorkflowRunState,
    operation: WorkflowRunOperation | 'wave',
    options: { reason: string; actorId: string; failure?: WorkflowFailureCode },
  ): WorkflowRunRecord {
    assertWorkflowTransition({
      from: record.state,
      to,
      operation,
      currentVersion: record.runVersion,
      expectedVersion: record.runVersion,
      workflowRunId: record.context.workflowRunId,
    });

    const nowIso = clock.isoNow();
    const runVersion = record.runVersion + 1;
    const transitions = [
      ...record.transitions,
      {
        at: nowIso,
        from: record.state,
        to,
        operation,
        reason: options.reason.slice(0, 300),
        actorId: options.actorId,
        runVersion,
        ...(options.failure === undefined ? {} : { failure: options.failure }),
      },
    ];
    const overflow = Math.max(0, transitions.length - MAX_WORKFLOW_TRANSITIONS);

    return {
      ...record,
      state: to,
      runVersion,
      updatedAt: nowIso,
      transitions: transitions.slice(overflow),
      transitionsTruncated: record.transitionsTruncated + overflow,
      elapsedRuntimeMs: Math.max(0, clock.now() - Date.parse(record.createdAt)),
      ...(options.failure === undefined ? {} : { failure: options.failure }),
      ...(isTerminalWorkflowState(to) ? { endedAt: nowIso } : {}),
      ...(to === 'running' && record.startedAt === undefined ? { startedAt: nowIso } : {}),
    };
  }

  /** End a run, persist it and write the terminal audit record. */
  async function terminate(
    record: WorkflowRunRecord,
    state: WorkflowRunState,
    options: {
      failure?: WorkflowFailureCode;
      failureMessage?: string;
      reason: string;
      actorId: string;
      requestId: string;
      correlationId: string;
      terminalNodeId?: string;
    },
  ): Promise<WorkflowRunRecord> {
    const moved = transition(record, state, 'wave', {
      reason: options.reason,
      actorId: options.actorId,
      ...(options.failure === undefined ? {} : { failure: options.failure }),
    });
    const finished: WorkflowRunRecord = {
      ...moved,
      ...(options.failureMessage === undefined
        ? {}
        : { failureMessage: options.failureMessage.slice(0, 300) }),
      ...(options.terminalNodeId === undefined ? {} : { terminalNodeId: options.terminalNodeId }),
      pendingApprovalId: undefined,
      pendingApprovalNodeId: undefined,
    };
    const saved = await persist(finished, record.runVersion);
    writeAudit(saved, {
      event: WORKFLOW_AUDIT_EVENT.runTerminated,
      outcome: state === 'completed' ? 'executed' : 'failed',
      requestId: options.requestId,
      correlationId: options.correlationId,
      actorId: options.actorId,
      reason: options.reason,
      ...(options.failure === undefined ? {} : { failure: options.failure }),
      detail: {
        state,
        wave: saved.currentWave,
        nodeExecutions: saved.nodeExecutions,
        costMicroUsd: saved.cost.actualMicroUsd,
        totalTokens: saved.tokens.actualTotalTokens,
        avoidedMicroUsd: saved.optimization.avoidedMicroUsd,
      },
    });
    return saved;
  }

  // ── Facts ─────────────────────────────────────────────────────────────────

  /**
   * Coerce a value into a fact, or refuse it.
   *
   * Scalars only, and strings are capped. A fact map that could hold an object
   * would be a durable copy of whatever a node returned, which is exactly the
   * liability the run record is built to avoid.
   */
  function toFact(value: unknown): WorkflowFactValue | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') return value.slice(0, WORKFLOW_BOUNDS.maxFactValueChars);
    return undefined;
  }

  /** Facts a node publishes from its result. Missing or non-scalar publishes nothing. */
  function publishedFacts(node: WorkflowNode, result: unknown): WorkflowFactMap {
    const declarations = node.publishes ?? [];
    if (declarations.length === 0) return {};
    const source =
      typeof result === 'object' && result !== null && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : {};
    const published: Record<string, WorkflowFactValue> = {};
    for (const declaration of declarations) {
      const fact = toFact(source[declaration.from]);
      if (fact !== undefined) published[`${node.nodeId}.${declaration.name}`] = fact;
    }
    return published;
  }

  /** Node input: constants first, mapped facts on top. Bounded and flat. */
  function inputFor(
    node: WorkflowAgentNode | WorkflowToolNode,
    facts: WorkflowFactMap,
  ): Record<string, WorkflowFactValue> {
    const input: Record<string, WorkflowFactValue> = { ...(node.input ?? {}) };
    for (const [field, factKey] of Object.entries(node.inputFromFacts ?? {})) {
      const value = facts[factKey];
      if (value !== undefined) input[field] = value;
    }
    return input;
  }

  // ── Node execution ────────────────────────────────────────────────────────

  interface NodeResult {
    readonly nodeId: string;
    readonly state: WorkflowNodeState;
    readonly facts: WorkflowFactMap;
    readonly agentRunId?: string;
    readonly approvalId?: string;
    readonly outputDigest?: string;
    readonly failure?: WorkflowFailureCode;
    readonly failureMessage?: string;
    readonly tokensUsed: number;
    readonly costMicroUsd: number;
    readonly attribution: AgentTokenLedger['attribution'];
    readonly optimization: OptimizationLedger;
    readonly latencyMs: number;
    /** Set when the node reached a terminal node of the plan. */
    readonly terminalOutcome?: 'succeeded' | 'failed';
  }

  function failedResult(
    nodeId: string,
    failure: WorkflowFailureCode,
    message: string,
    latencyMs: number,
  ): NodeResult {
    return {
      nodeId,
      state: 'failed',
      facts: {},
      failure,
      failureMessage: message.slice(0, 300),
      tokensUsed: 0,
      costMicroUsd: 0,
      attribution: [],
      optimization: emptyOptimizationLedger(),
      latencyMs,
    };
  }

  function fromAgentOutcome(
    node: WorkflowNode,
    outcome: AgentNodeExecutionOutcome,
    latencyMs: number,
  ): NodeResult {
    const base = {
      nodeId: node.nodeId,
      agentRunId: outcome.agentRunId,
      tokensUsed: outcome.totalTokens,
      costMicroUsd: outcome.costMicroUsd,
      attribution: outcome.attribution,
      optimization: outcome.optimization,
      latencyMs,
    };

    if (outcome.succeeded) {
      return {
        ...base,
        state: 'succeeded',
        facts: publishedFacts(node, outcome.output),
        ...(outcome.outputDigest === undefined ? {} : { outputDigest: outcome.outputDigest }),
      };
    }
    if (!outcome.terminal) {
      // The agent run is still alive — parked on its own approval, or simply not
      // finished. The node keeps its run id and the workflow waits; nothing
      // about the in-flight work is held in this isolate.
      return {
        ...base,
        state: outcome.pendingApprovalId === undefined ? 'running' : 'waiting_for_approval',
        facts: {},
        ...(outcome.pendingApprovalId === undefined
          ? {}
          : { approvalId: outcome.pendingApprovalId }),
      };
    }
    return {
      ...base,
      state: 'failed',
      facts: {},
      failure: 'node_failed',
      failureMessage: (outcome.failureMessage ?? `the agent run ended ${outcome.state}`).slice(0, 300),
    };
  }

  async function executeNode(
    record: WorkflowRunRecord,
    node: WorkflowNode,
    input: AdvanceWorkflowInput,
  ): Promise<NodeResult> {
    const startedMs = clock.now();
    const existing = record.nodes[node.nodeId];

    try {
      switch (node.kind) {
        case 'terminal':
          return {
            nodeId: node.nodeId,
            state: 'succeeded',
            facts: {},
            tokensUsed: 0,
            costMicroUsd: 0,
            attribution: [],
            optimization: emptyOptimizationLedger(),
            latencyMs: Math.max(0, clock.now() - startedMs),
            terminalOutcome: node.outcome,
          };

        case 'approval': {
          // Already open and still pending: nothing to do but keep waiting.
          if (existing?.approvalId !== undefined && existing.state === 'waiting_for_approval') {
            return {
              nodeId: node.nodeId,
              state: 'waiting_for_approval',
              facts: {},
              approvalId: existing.approvalId,
              tokensUsed: 0,
              costMicroUsd: 0,
              attribution: [],
              optimization: emptyOptimizationLedger(),
              latencyMs: Math.max(0, clock.now() - startedMs),
            };
          }
          const request = await approvals.request({
            workflowRunId: record.context.workflowRunId,
            workflowId: record.context.workflowId,
            organizationId: record.context.organizationId,
            node,
            nodeExecutionId: `${record.context.workflowRunId}:${node.nodeId}`,
            estimatedAdditionalTokens: 0,
            estimatedAdditionalCostMicroUsd: 0,
          });
          return {
            nodeId: node.nodeId,
            state: 'waiting_for_approval',
            facts: {},
            approvalId: request.approvalId,
            tokensUsed: 0,
            costMicroUsd: 0,
            attribution: [],
            optimization: emptyOptimizationLedger(),
            latencyMs: Math.max(0, clock.now() - startedMs),
          };
        }

        case 'agent': {
          // Resume rather than restart when the node already owns a run. A wave
          // re-entered after a pause must not start a second agent run for the
          // same node — that is money spent twice for one step of the plan.
          const outcome =
            existing?.agentRunId === undefined
              ? await agents.execute({
                  agentId: node.agentId,
                  organizationId: record.context.organizationId,
                  actor: input.actor,
                  objective: node.objective,
                  input: inputFor(node, record.facts),
                  requestId: input.requestId,
                  correlationId: input.correlationId,
                  workflowId: record.context.workflowRunId,
                  authorization: input.authorization,
                  feature: `workflow:${record.context.workflowId}`,
                  ...(input.clientIp === undefined ? {} : { clientIp: input.clientIp }),
                })
              : await agents.resume({
                  agentRunId: existing.agentRunId,
                  organizationId: record.context.organizationId,
                  actor: input.actor,
                  authorization: input.authorization,
                  requestId: input.requestId,
                  correlationId: input.correlationId,
                  ...(input.clientIp === undefined ? {} : { clientIp: input.clientIp }),
                });
          return fromAgentOutcome(node, outcome, Math.max(0, clock.now() - startedMs));
        }

        case 'tool': {
          const agent = deps.agentDefinition(node.onBehalfOfAgentId);
          if (!agent) {
            return failedResult(
              node.nodeId,
              'invalid_workflow_action',
              'The agent this tool runs on behalf of is not available.',
              Math.max(0, clock.now() - startedMs),
            );
          }
          const result = await tools.execute({
            toolId: node.toolId,
            agent,
            runId: record.context.workflowRunId,
            organizationId: record.context.organizationId,
            actorId: input.actor.actorId,
            actorCapabilities: input.actor.capabilities,
            correlationId: input.correlationId,
            // Stable per node per run, so a wave replayed after a lost race
            // cannot execute a side-effecting tool twice.
            idempotencyKey: `wf:${record.context.workflowRunId}:${node.nodeId}`,
            input: inputFor(node, record.facts),
            timeoutMs: 30_000,
          });
          return {
            nodeId: node.nodeId,
            state: 'succeeded',
            facts: publishedFacts(node, result.output),
            outputDigest: result.outputDigest,
            tokensUsed: 0,
            costMicroUsd: 0,
            attribution: [],
            optimization: emptyOptimizationLedger(),
            latencyMs: result.latencyMs,
          };
        }

        default:
          // Unreachable while the node union is exhaustive. Present so a kind
          // added without a case here fails the node rather than the run.
          return failedResult(
            (node as WorkflowNode).nodeId,
            'invalid_workflow_action',
            'That node kind cannot be executed.',
            Math.max(0, clock.now() - startedMs),
          );
      }
    } catch (error) {
      // A node's failure is not automatically the workflow's. It is recorded
      // here; whether the plan continues is decided by `optional` and by the
      // downstream join policy, which is where that question belongs.
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.warn('ai.workflow.node.failed', {
        diagnostics: `${record.context.workflowRunId}/${node.nodeId}: ${message}`,
      });
      return failedResult(
        node.nodeId,
        'node_failed',
        message,
        Math.max(0, clock.now() - startedMs),
      );
    }
  }

  // ── Wave driving ──────────────────────────────────────────────────────────

  function applyResult(
    record: WorkflowRunRecord,
    node: WorkflowNode,
    result: NodeResult,
  ): WorkflowRunRecord {
    const previous = record.nodes[node.nodeId];
    const nowIso = clock.isoNow();

    const nodeRecord: WorkflowNodeRecord = {
      ...previous,
      nodeId: node.nodeId,
      state: result.state,
      attempts: previous.attempts + 1,
      startedAt: previous.startedAt ?? nowIso,
      latencyMs: previous.latencyMs + result.latencyMs,
      tokensUsed: previous.tokensUsed + result.tokensUsed,
      costMicroUsd: previous.costMicroUsd + result.costMicroUsd,
      avoidedMicroUsd: previous.avoidedMicroUsd + result.optimization.avoidedMicroUsd,
      ...(result.agentRunId === undefined ? {} : { agentRunId: result.agentRunId }),
      ...(result.approvalId === undefined ? {} : { approvalId: result.approvalId }),
      ...(result.outputDigest === undefined ? {} : { outputDigest: result.outputDigest }),
      ...(result.failure === undefined ? {} : { failure: result.failure }),
      ...(result.failureMessage === undefined ? {} : { failureMessage: result.failureMessage }),
      ...(result.state === 'succeeded' || result.state === 'failed'
        ? { settledAt: nowIso }
        : {}),
    };

    // The fact map is bounded. Past the ceiling further facts are dropped and
    // the plan continues on what it has — a run that cannot be persisted is a
    // worse outcome than one whose later branches see fewer facts, and the
    // registry already refuses a definition that could legitimately reach it.
    const facts: Record<string, WorkflowFactValue> = { ...record.facts };
    for (const [key, value] of Object.entries(result.facts)) {
      if (Object.keys(facts).length >= WORKFLOW_BOUNDS.maxFactsTotal && !(key in facts)) continue;
      facts[key] = value;
    }

    const attribution = mergeAttribution(record.tokens.attribution, result.attribution);

    return {
      ...record,
      nodes: { ...record.nodes, [node.nodeId]: nodeRecord },
      facts,
      nodeExecutions: record.nodeExecutions + 1,
      agentRunIds:
        result.agentRunId === undefined || record.agentRunIds.includes(result.agentRunId)
          ? record.agentRunIds
          : [...record.agentRunIds, result.agentRunId],
      tokens: {
        ...record.tokens,
        actualTotalTokens: record.tokens.actualTotalTokens + result.tokensUsed,
        attribution,
      },
      cost: {
        ...record.cost,
        actualMicroUsd: record.cost.actualMicroUsd + result.costMicroUsd,
      },
      optimization: mergeOptimizationLedgers(record.optimization, result.optimization),
      ...(result.approvalId !== undefined && result.state === 'waiting_for_approval'
        ? { pendingApprovalId: result.approvalId, pendingApprovalNodeId: node.nodeId }
        : {}),
      ...(node.kind === 'approval' && result.state === 'waiting_for_approval'
        ? { approvalsOpened: record.approvalsOpened + 1 }
        : {}),
    };
  }

  /** Merge attribution rows by their full key, bounded like the agent ledger. */
  function mergeAttribution(
    existing: AgentTokenLedger['attribution'],
    incoming: AgentTokenLedger['attribution'],
  ): AgentTokenLedger['attribution'] {
    const merged = [...existing];
    for (const row of incoming) {
      const index = merged.findIndex(
        (candidate) =>
          candidate.agentId === row.agentId &&
          candidate.providerId === row.providerId &&
          candidate.modelId === row.modelId &&
          candidate.feature === row.feature,
      );
      if (index >= 0) {
        const current = merged[index];
        merged[index] = {
          ...current,
          promptTokens: current.promptTokens + row.promptTokens,
          completionTokens: current.completionTokens + row.completionTokens,
          cachedTokens: current.cachedTokens + row.cachedTokens,
          totalTokens: current.totalTokens + row.totalTokens,
          costMicroUsd: current.costMicroUsd + row.costMicroUsd,
          calls: current.calls + row.calls,
        };
        continue;
      }
      if (merged.length >= 32) continue;
      merged.push(row);
    }
    return merged;
  }

  async function writeCheckpoint(record: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    const version = record.checkpointVersion + 1;
    const previous = await checkpoints.latest(
      record.context.organizationId,
      record.context.workflowRunId,
    );
    const checkpoint: WorkflowCheckpoint = {
      workflowRunId: record.context.workflowRunId,
      organizationId: record.context.organizationId,
      version,
      createdAt: clock.isoNow(),
      state: record.state,
      wave: record.currentWave,
      nodes: nodeStatesOf(record.nodes),
      facts: record.facts,
      factsDigest: digestValue(record.facts),
      ...(previous === undefined
        ? {}
        : { previousDigest: digestValue({ version: previous.version, facts: previous.facts }) }),
    };
    await checkpoints.write(checkpoint);
    return { ...record, checkpointVersion: version };
  }

  /** Would this run cross a ceiling by taking another wave? */
  function budgetFailure(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
  ): WorkflowFailureCode | undefined {
    if (record.tokens.actualTotalTokens > definition.limits.maxTotalTokens) {
      return 'workflow_token_budget_exhausted';
    }
    if (record.cost.actualMicroUsd > definition.limits.maxActualCostMicroUsd) {
      return 'workflow_cost_budget_exhausted';
    }
    if (record.nodeExecutions >= definition.limits.maxNodeExecutions) {
      return 'node_limit_exceeded';
    }
    return undefined;
  }

  // ── Public operations ─────────────────────────────────────────────────────

  return {
    async createRun(input) {
      const state = deps.runtimeState();
      if (!state.aiEnabled) {
        throw workflowFailure('workflow_runtime_disabled', 'AI execution is currently disabled.', {
          workflowId: input.workflowId,
          diagnostics: 'operational settings report AI disabled or the emergency stop engaged',
        });
      }

      const definition = registry.require(input.workflowId);
      const plan = planWorkflow(definition);

      const nowMs = clock.now();
      const nowIso = clock.isoNow();
      const workflowRunId = ids.next('wfr');

      const context: WorkflowRunContext = {
        workflowRunId,
        workflowId: definition.workflowId,
        workflowVersion: definition.version,
        correlationId: input.correlationId,
        requestId: input.requestId,
        organizationId: input.organizationId,
        actorId: input.actor.actorId,
        actorRoles: input.actor.roles,
        origin: input.origin,
      };

      const nodes: Record<string, WorkflowNodeRecord> = {};
      for (const node of definition.nodes) {
        nodes[node.nodeId] = {
          nodeId: node.nodeId,
          state: 'pending',
          wave: plan.waves.findIndex((wave) => wave.includes(node.nodeId)),
          attempts: 0,
          latencyMs: 0,
          tokensUsed: 0,
          costMicroUsd: 0,
          avoidedMicroUsd: 0,
        };
      }

      // Seed facts are caller-supplied, so they are coerced through the same
      // bounded scalar rule everything else in the map is. A seed that is not a
      // scalar is simply not a fact.
      const seeded: Record<string, WorkflowFactValue> = {};
      for (const [key, value] of Object.entries(input.facts ?? {})) {
        const fact = toFact(value);
        if (fact !== undefined && Object.keys(seeded).length < WORKFLOW_BOUNDS.maxFactsTotal) {
          seeded[`seed.${key}`] = fact;
        }
      }

      const record: WorkflowRunRecord = {
        context,
        runVersion: 1,
        state: 'created',
        plan,
        planDigest: plan.digest,
        currentWave: 0,
        nodeExecutions: 0,
        nodes,
        facts: seeded,
        agentRunIds: [],
        tokens: emptyTokenLedger(),
        cost: emptyCostLedger(),
        optimization: emptyOptimizationLedger(),
        approvalsOpened: 0,
        checkpointVersion: 0,
        configurationVersion: state.configurationVersion,
        createdAt: nowIso,
        updatedAt: nowIso,
        deadlineAt: new Date(nowMs + definition.limits.maxRuntimeMs).toISOString(),
        elapsedRuntimeMs: 0,
        transitions: [],
        transitionsTruncated: 0,
      };

      await runs.create(record);
      writeAudit(record, {
        event: WORKFLOW_AUDIT_EVENT.runCreated,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: `Workflow ${definition.workflowId} started.`,
        detail: {
          waves: plan.waves.length,
          nodes: plan.nodeCount,
          maxParallel: plan.maxParallel,
          planDigest: plan.digest,
        },
      });

      // Planning is a state, not a phase: the plan exists, and the record says
      // so before anything runs. A run that reported `created` while holding a
      // plan would be lying about where it is.
      const planning = transition(record, 'planning', 'start', {
        reason: 'Building the execution plan.',
        actorId: input.actor.actorId,
      });
      const planned = transition(planning, 'planned', 'start', {
        reason: `Plan accepted: ${plan.waves.length} waves over ${plan.nodeCount} nodes.`,
        actorId: input.actor.actorId,
      });
      const saved = await persist(planned, record.runVersion);
      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.runPlanned,
        outcome: 'allowed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: 'The plan is fixed for the life of this run.',
        detail: { planDigest: plan.digest, waves: plan.waves.length },
      });
      return saved;
    },

    async advance(input) {
      let record = await load(input.organizationId, input.workflowRunId);
      if (isTerminalWorkflowState(record.state)) return record;

      const definition = registry.require(record.context.workflowId);

      // The plan is frozen. A definition edited between two waves would mean the
      // second half of a run executed a different workflow from the first, and
      // this is the check that makes that impossible rather than unlikely.
      const replanned = planWorkflow(definition);
      if (replanned.digest !== record.planDigest) {
        return terminate(record, 'failed', {
          failure: 'workflow_invalid',
          failureMessage: 'The workflow definition changed after this run started.',
          reason: 'plan digest mismatch',
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      if (Date.parse(record.deadlineAt) <= clock.now()) {
        return terminate(record, 'expired', {
          failure: 'workflow_expired',
          failureMessage: 'This workflow run reached its deadline.',
          reason: 'deadline passed',
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      const state = deps.runtimeState();
      if (!state.aiEnabled || !state.executionAvailable) {
        // Not a failure: the run keeps its position and its record, and the next
        // advance after the operator releases the stop picks it up where it was.
        // Ending a run because a switch was flipped would destroy work that is
        // still perfectly valid.
        writeAudit(record, {
          event: WORKFLOW_AUDIT_EVENT.limitReached,
          outcome: 'denied',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          failure: 'workflow_runtime_disabled',
          reason: 'AI execution is unavailable; the run keeps its position.',
          detail: { aiEnabled: state.aiEnabled, executionAvailable: state.executionAvailable },
        });
        return record;
      }

      if (record.state === 'paused' || record.state === 'waiting_for_approval') return record;

      if (record.state === 'planned') {
        record = await persist(
          transition(record, 'running', 'start', {
            reason: 'Starting the first wave.',
            actorId: input.actor.actorId,
          }),
          record.runVersion,
        );
      } else if (record.state === 'waiting_for_agent') {
        // Coming back to an agent run that had not finished. The wave loop below
        // re-enters the same wave and resumes the run the node already owns; the
        // record has to be `running` again first, because `waiting_for_agent` is
        // a resting state and not one a wave may be driven from.
        record = await persist(
          transition(record, 'running', 'wave', {
            reason: 'Resuming the agent runs this wave is waiting on.',
            actorId: input.actor.actorId,
          }),
          record.runVersion,
        );
      }

      const nodesById = new Map(definition.nodes.map((node) => [node.nodeId, node]));

      for (let driven = 0; driven < MAX_WAVES_PER_ADVANCE; driven += 1) {
        const budget = budgetFailure(record, definition);
        if (budget !== undefined) {
          return terminate(record, terminalWorkflowStateFor(budget) ?? 'failed', {
            failure: budget,
            failureMessage: 'This workflow run reached one of its ceilings.',
            reason: budget,
            actorId: input.actor.actorId,
            requestId: input.requestId,
            correlationId: input.correlationId,
          });
        }

        if (record.currentWave >= record.plan.waves.length) {
          // Every wave has been visited. The plan is finished if it reached a
          // terminal node, and exhausted if it did not.
          return finishPlan(record, input);
        }

        const wave = record.plan.waves[record.currentWave];
        writeAudit(record, {
          event: WORKFLOW_AUDIT_EVENT.waveStarted,
          outcome: 'allowed',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          wave: record.currentWave,
          detail: { nodes: wave.join(','), width: wave.length },
        });

        // ── Admission ───────────────────────────────────────────────────────
        const admitted: WorkflowNode[] = [];
        for (const nodeId of wave) {
          const node = nodesById.get(nodeId);
          if (!node) continue;
          const current = record.nodes[nodeId];
          // A node that has already settled is not reconsidered. Re-admitting a
          // succeeded node would run it twice; re-admitting a failed one would
          // be a retry the definition never asked for.
          if (
            current.state === 'succeeded' ||
            current.state === 'skipped' ||
            current.state === 'failed'
          ) {
            continue;
          }

          const decision = admitNode(node, nodeStatesOf(record.nodes), record.facts);
          if (decision.admission === 'skipped') {
            record = {
              ...record,
              nodes: {
                ...record.nodes,
                [nodeId]: {
                  ...current,
                  state: 'skipped',
                  skipReason: decision.reason,
                  settledAt: clock.isoNow(),
                },
              },
            };
            writeAudit(record, {
              event: WORKFLOW_AUDIT_EVENT.nodeSkipped,
              outcome: 'skipped',
              requestId: input.requestId,
              correlationId: input.correlationId,
              actorId: input.actor.actorId,
              nodeId,
              wave: record.currentWave,
              nodeState: 'skipped',
              reason: decision.reason,
            });
            continue;
          }
          if (decision.admission === 'blocked') {
            // A blocked node in the CURRENT wave cannot become ready without
            // something in a later wave running first, which the layering makes
            // impossible. Treating it as skipped keeps the run moving and
            // records why; the alternative is a plan that stalls silently.
            record = {
              ...record,
              nodes: {
                ...record.nodes,
                [nodeId]: {
                  ...current,
                  state: 'skipped',
                  skipReason: decision.reason,
                  settledAt: clock.isoNow(),
                },
              },
            };
            writeAudit(record, {
              event: WORKFLOW_AUDIT_EVENT.nodeSkipped,
              outcome: 'skipped',
              requestId: input.requestId,
              correlationId: input.correlationId,
              actorId: input.actor.actorId,
              nodeId,
              wave: record.currentWave,
              nodeState: 'skipped',
              reason: decision.reason,
            });
            continue;
          }
          admitted.push(node);
          writeAudit(record, {
            event: WORKFLOW_AUDIT_EVENT.nodeAdmitted,
            outcome: 'allowed',
            requestId: input.requestId,
            correlationId: input.correlationId,
            actorId: input.actor.actorId,
            nodeId,
            wave: record.currentWave,
            reason: decision.reason,
          });
        }

        // ── Bounded parallel execution ──────────────────────────────────────
        //
        // The wave IS the bound: the planner already split any layer wider than
        // the definition's `maxParallel`. Results are applied in node-id order
        // rather than completion order, so the record a run produces does not
        // depend on which agent happened to answer first.
        const results = await Promise.all(
          admitted.map((node) => executeNode(record, node, input)),
        );
        const ordered = [...admitted]
          .map((node, index) => ({ node, result: results[index] }))
          .sort((a, b) => a.node.nodeId.localeCompare(b.node.nodeId));

        let terminalNode: { nodeId: string; outcome: 'succeeded' | 'failed' } | undefined;
        for (const { node, result } of ordered) {
          record = applyResult(record, node, result);
          if (result.terminalOutcome !== undefined) {
            terminalNode = { nodeId: node.nodeId, outcome: result.terminalOutcome };
          }
          writeAudit(record, {
            event:
              result.state === 'succeeded'
                ? WORKFLOW_AUDIT_EVENT.nodeSucceeded
                : result.state === 'failed'
                  ? WORKFLOW_AUDIT_EVENT.nodeFailed
                  : WORKFLOW_AUDIT_EVENT.nodeStarted,
            outcome:
              result.state === 'succeeded'
                ? 'executed'
                : result.state === 'failed'
                  ? 'failed'
                  : 'recorded',
            requestId: input.requestId,
            correlationId: input.correlationId,
            actorId: input.actor.actorId,
            nodeId: node.nodeId,
            wave: record.currentWave,
            nodeState: result.state,
            ...(result.agentRunId === undefined ? {} : { agentRunId: result.agentRunId }),
            ...(result.approvalId === undefined ? {} : { approvalId: result.approvalId }),
            ...(result.failure === undefined ? {} : { failure: result.failure }),
            detail: {
              kind: node.kind,
              tokensUsed: result.tokensUsed,
              costMicroUsd: result.costMicroUsd,
              avoidedMicroUsd: result.optimization.avoidedMicroUsd,
              publishedFacts: Object.keys(result.facts).join(','),
            },
          });
        }

        // ── Settle the wave ─────────────────────────────────────────────────
        const parked = ordered.find(
          ({ result }) => result.state === 'waiting_for_approval',
        );
        const stillRunning = ordered.find(({ result }) => result.state === 'running');

        const mandatoryFailure = ordered.find(
          ({ node, result }) => result.state === 'failed' && node.optional !== true,
        );

        record = await writeCheckpoint(record);

        if (parked !== undefined) {
          const waiting = transition(record, 'waiting_for_approval', 'wave', {
            reason: `Node ${parked.node.nodeId} is waiting for a human decision.`,
            actorId: input.actor.actorId,
          });
          const saved = await persist(waiting, record.runVersion);
          writeAudit(saved, {
            event: WORKFLOW_AUDIT_EVENT.approvalRequested,
            outcome: 'recorded',
            requestId: input.requestId,
            correlationId: input.correlationId,
            actorId: input.actor.actorId,
            nodeId: parked.node.nodeId,
            wave: saved.currentWave,
            ...(parked.result.approvalId === undefined
              ? {}
              : { approvalId: parked.result.approvalId }),
            reason: 'The plan is parked until somebody decides.',
          });
          return saved;
        }

        if (stillRunning !== undefined) {
          const waiting = transition(record, 'waiting_for_agent', 'wave', {
            reason: `Node ${stillRunning.node.nodeId} has an agent run still in flight.`,
            actorId: input.actor.actorId,
          });
          return persist(waiting, record.runVersion);
        }

        if (mandatoryFailure !== undefined) {
          return terminate(record, 'failed', {
            failure: 'node_failed',
            failureMessage:
              mandatoryFailure.result.failureMessage ??
              `Node ${mandatoryFailure.node.nodeId} failed.`,
            reason: `node ${mandatoryFailure.node.nodeId} failed and is not optional`,
            actorId: input.actor.actorId,
            requestId: input.requestId,
            correlationId: input.correlationId,
          });
        }

        if (terminalNode !== undefined) {
          return terminate(
            record,
            terminalNode.outcome === 'succeeded' ? 'completed' : 'failed',
            {
              ...(terminalNode.outcome === 'succeeded' ? {} : { failure: 'node_failed' }),
              reason: `The plan reached terminal node ${terminalNode.nodeId}.`,
              actorId: input.actor.actorId,
              requestId: input.requestId,
              correlationId: input.correlationId,
              terminalNodeId: terminalNode.nodeId,
            },
          );
        }

        // Advance the wave pointer and persist. This write is the whole of the
        // concurrency story: two isolates driving one run race here, once, and
        // exactly one wins.
        const advanced: WorkflowRunRecord = {
          ...record,
          currentWave: record.currentWave + 1,
          runVersion: record.runVersion + 1,
          updatedAt: clock.isoNow(),
          elapsedRuntimeMs: Math.max(0, clock.now() - Date.parse(record.createdAt)),
        };
        record = await persist(advanced, record.runVersion);
        writeAudit(record, {
          event: WORKFLOW_AUDIT_EVENT.waveCompleted,
          outcome: 'executed',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          wave: record.currentWave - 1,
          detail: {
            checkpointVersion: record.checkpointVersion,
            nodeExecutions: record.nodeExecutions,
            costMicroUsd: record.cost.actualMicroUsd,
          },
        });
      }

      return record;
    },

    async pause(input) {
      const record = await load(input.organizationId, input.workflowRunId);
      const paused = transition(record, 'paused', 'pause', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      const saved = await persist(paused, record.runVersion);
      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.runStateChanged,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: input.reason,
      });
      return saved;
    },

    async resume(input) {
      const record = await load(input.organizationId, input.workflowRunId);
      const resumed = transition(record, 'running', 'resume', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      const saved = await persist(resumed, record.runVersion);
      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.runStateChanged,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: input.reason,
      });
      return saved;
    },

    async cancel(input) {
      const record = await load(input.organizationId, input.workflowRunId);
      return terminate(record, 'cancelled', {
        reason: input.reason,
        actorId: input.actor.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
        failureMessage: 'An operator cancelled this workflow run.',
      });
    },

    async decideApproval(input) {
      const record = await load(input.organizationId, input.workflowRunId);
      if (record.pendingApprovalId !== input.approvalId) {
        throw workflowFailure(
          'invalid_workflow_action',
          'That approval does not belong to this workflow run.',
          {
            workflowRunId: input.workflowRunId,
            diagnostics: `pending=${record.pendingApprovalId ?? 'none'} supplied=${input.approvalId}`,
          },
        );
      }

      // The DECISION goes through the certified gate: authority, expiry and the
      // single-use compare-and-swap all have exactly one implementation, and it
      // is not this one.
      const decided = await approvals.gate.decide({
        organizationId: input.organizationId,
        approvalId: input.approvalId,
        decision: input.decision,
        reason: input.reason,
        deciderId: input.actor.actorId,
        deciderRoles: input.actor.roles,
      });

      const nodeId = record.pendingApprovalNodeId ?? '';
      const current = record.nodes[nodeId];

      if (decided.state === 'rejected') {
        const rejected: WorkflowRunRecord = {
          ...record,
          ...(current === undefined
            ? {}
            : {
                nodes: {
                  ...record.nodes,
                  [nodeId]: {
                    ...current,
                    state: 'failed',
                    failure: 'workflow_approval_rejected',
                    failureMessage: 'A reviewer rejected this step.',
                    settledAt: clock.isoNow(),
                  },
                },
              }),
        };
        const ended = transition(rejected, 'failed', 'reject', {
          reason: input.reason,
          actorId: input.actor.actorId,
          failure: 'workflow_approval_rejected',
        });
        const saved = await persist(
          {
            ...ended,
            failureMessage: 'A reviewer rejected a step of this workflow.',
            pendingApprovalId: undefined,
            pendingApprovalNodeId: undefined,
          },
          record.runVersion,
        );
        writeAudit(saved, {
          event: WORKFLOW_AUDIT_EVENT.approvalDecided,
          outcome: 'denied',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          nodeId,
          approvalId: input.approvalId,
          failure: 'workflow_approval_rejected',
          reason: input.reason,
        });
        return saved;
      }

      // Approved. Spend it on the node it authorised, so it cannot be spent
      // again, then release the plan.
      await approvals.gate.consume(
        input.organizationId,
        input.approvalId,
        `${record.context.workflowRunId}:${nodeId}`,
      );

      const released: WorkflowRunRecord = {
        ...record,
        ...(current === undefined
          ? {}
          : {
              nodes: {
                ...record.nodes,
                [nodeId]: { ...current, state: 'succeeded', settledAt: clock.isoNow() },
              },
            }),
        pendingApprovalId: undefined,
        pendingApprovalNodeId: undefined,
      };
      const running = transition(released, 'running', 'approve', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      const saved = await persist(running, record.runVersion);
      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.approvalDecided,
        outcome: 'allowed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId,
        approvalId: input.approvalId,
        reason: input.reason,
      });
      return saved;
    },

    async expireIfDue(input) {
      const record = await load(input.organizationId, input.workflowRunId);
      if (isTerminalWorkflowState(record.state)) return record;
      if (Date.parse(record.deadlineAt) > clock.now()) return record;
      return terminate(record, 'expired', {
        failure: 'workflow_expired',
        failureMessage: 'This workflow run reached its deadline.',
        reason: input.reason,
        actorId: input.actor.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
    },

    latestCheckpoint: (organizationId, workflowRunId) =>
      checkpoints.latest(organizationId, workflowRunId),
  };

  /**
   * Every wave has been visited. Did the plan finish, or run out?
   *
   * A plan that visited every wave without reaching a terminal node has not
   * quietly succeeded — it has failed to reach an end its author declared, and
   * `plan_exhausted` says exactly that.
   */
  async function finishPlan(
    record: WorkflowRunRecord,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    if (record.terminalNodeId !== undefined) return record;
    if (!allNodesSettled(record.nodes)) {
      return terminate(record, 'failed', {
        failure: 'plan_exhausted',
        failureMessage: 'The plan finished with work still unsettled.',
        reason: 'unsettled nodes after the final wave',
        actorId: input.actor.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
    }
    return terminate(record, 'failed', {
      failure: 'plan_exhausted',
      failureMessage: 'The plan finished without reaching a terminal node.',
      reason: 'no terminal node was reached',
      actorId: input.actor.actorId,
      requestId: input.requestId,
      correlationId: input.correlationId,
    });
  }
}
