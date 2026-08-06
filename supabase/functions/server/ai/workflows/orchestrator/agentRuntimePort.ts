/**
 * The one way a workflow reaches an agent (AI-01 Batch 3B).
 *
 * The exact counterpart of `agents/orchestrator/controlPlaneBridge.ts`, one
 * layer up. That module is the only place in the agent runtime that may hold an
 * `AIControlPlane` and call `execute` on it; this is the only place in the
 * workflow runtime that may hold an `AgentOrchestrator` and drive a run with it.
 * The boundary scan asserts both, and the two assertions together are the whole
 * of the layering claim:
 *
 *   WORKFLOWS PLAN. AGENTS PROPOSE. THE ORCHESTRATOR DECIDES.
 *   THE AI CONTROL PLANE EXECUTES.
 *
 * WHAT A WORKFLOW CANNOT DO THROUGH THIS PORT. It cannot name a model, a
 * provider or a model profile. It cannot raise an agent's limits, widen its
 * allow lists, skip its approval policy or bypass its certification. It cannot
 * reach `controlPlane.execute` — it has no import for it, and this module does
 * not offer one. Everything it asks for goes through `createRun` and `advance`,
 * which are the same two calls the HTTP surface makes, subject to the same
 * checks in the same order.
 *
 * THE OUTCOME IS A PROJECTION, NOT THE RUN. What comes back is what the plan
 * needs to decide what happens next: whether the run finished, what it cost, what
 * it avoided, and — only when the run completed — the accepted output, read from
 * the checkpoint that accepted it. The workflow record never stores that output;
 * it stores a digest and whichever scalars the node declared it publishes.
 */

import type { AgentOrchestrator, AgentRunActor } from '../../agents/orchestrator/agentOrchestrator.ts';
import type { AgentCheckpointStore } from '../../agents/persistence/ports.ts';
import type { AgentRunRecord, AgentRunState } from '../../agents/contracts/runtime.ts';
import type { AgentFailureCode } from '../../agents/contracts/failures.ts';
import type { OptimizationLedger } from '../../optimization/optimizationLedger.ts';
import { coerceOptimizationLedger } from '../../optimization/optimizationLedger.ts';
import { isTerminalState } from '../../agents/contracts/runtime.ts';

export interface AgentNodeExecutionRequest {
  readonly agentId: string;
  readonly organizationId: string;
  readonly actor: AgentRunActor;
  readonly objective: string;
  readonly input: unknown;
  readonly requestId: string;
  readonly correlationId: string;
  /** The workflow run this agent run belongs to. Stamped on the run context. */
  readonly workflowId: string;
  /** The driving caller's credential, for the control plane. Never stored. */
  readonly authorization: string | null;
  readonly clientIp?: string;
  readonly feature: string;
}

export interface AgentNodeExecutionOutcome {
  readonly agentRunId: string;
  readonly state: AgentRunState;
  /** True when the agent run reached a state nothing further happens from. */
  readonly terminal: boolean;
  readonly succeeded: boolean;
  readonly failure?: AgentFailureCode;
  readonly failureMessage?: string;
  /** Set when the run is parked on a human decision inside the agent runtime. */
  readonly pendingApprovalId?: string;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly attribution: AgentRunRecord['tokens']['attribution'];
  readonly optimization: OptimizationLedger;
  /** The accepted output, present only when the run completed. */
  readonly output?: unknown;
  readonly outputDigest?: string;
}

export interface AgentExecutionPort {
  execute(request: AgentNodeExecutionRequest): Promise<AgentNodeExecutionOutcome>;
  /**
   * Drive an agent run this workflow already started.
   *
   * A workflow wave does not block on an agent run that has parked — on its own
   * approval, or simply on not having finished inside one request. The node
   * keeps the run id, the workflow moves to `waiting_for_agent`, and the next
   * `advance` comes back through here. That is what makes a workflow durable
   * rather than merely long: nothing about the in-flight work lives in the
   * isolate that started it.
   */
  resume(request: {
    readonly agentRunId: string;
    readonly organizationId: string;
    readonly actor: AgentRunActor;
    readonly authorization: string | null;
    readonly requestId: string;
    readonly correlationId: string;
    readonly clientIp?: string;
  }): Promise<AgentNodeExecutionOutcome>;
}

/**
 * Build the port over a real agent orchestrator and its checkpoint store.
 *
 * The checkpoint store is needed because the accepted output lives on the
 * checkpoint that accepted it, not on the run record — the run record carries
 * only its digest, which is the Batch 3A decision that keeps client business
 * data out of the durable run history. Reading it here rather than widening the
 * run record keeps that decision intact.
 */
export function createAgentExecutionPort(deps: {
  readonly orchestrator: AgentOrchestrator;
  readonly checkpoints: AgentCheckpointStore;
}): AgentExecutionPort {
  return {
    async execute(request) {
      const created = await deps.orchestrator.createRun({
        agentId: request.agentId,
        organizationId: request.organizationId,
        actor: request.actor,
        objective: request.objective,
        input: request.input,
        requestId: request.requestId,
        correlationId: request.correlationId,
        origin: { surface: 'system', feature: request.feature.slice(0, 60) },
        workflowId: request.workflowId,
      });

      // Created and driven in one call, exactly as the agent HTTP service does.
      // A run that is created and left un-driven looks identical to a stuck one,
      // and a workflow wave has no way to tell the difference either.
      const advanced = await deps.orchestrator.advance({
        organizationId: request.organizationId,
        runId: created.context.runId,
        actor: request.actor,
        authorization: request.authorization,
        requestId: request.requestId,
        correlationId: request.correlationId,
        ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
      });

      return projectOutcome(advanced, await outputFor(deps, advanced));
    },

    async resume(request) {
      const advanced = await deps.orchestrator.advance({
        organizationId: request.organizationId,
        runId: request.agentRunId,
        actor: request.actor,
        authorization: request.authorization,
        requestId: request.requestId,
        correlationId: request.correlationId,
        ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
      });
      return projectOutcome(advanced, await outputFor(deps, advanced));
    },
  };
}

async function outputFor(
  deps: { readonly checkpoints: AgentCheckpointStore },
  record: AgentRunRecord,
): Promise<unknown> {
  if (record.state !== 'completed') return undefined;
  const checkpoint = await deps.checkpoints.latest(
    record.context.organizationId,
    record.context.runId,
  );
  return checkpoint?.output;
}

/** Project a run record into what the plan is allowed to see. */
export function projectOutcome(
  record: AgentRunRecord,
  output: unknown,
): AgentNodeExecutionOutcome {
  return {
    agentRunId: record.context.runId,
    state: record.state,
    terminal: isTerminalState(record.state),
    succeeded: record.state === 'completed',
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    ...(record.failureMessage === undefined ? {} : { failureMessage: record.failureMessage }),
    ...(record.pendingApprovalId === undefined
      ? {}
      : { pendingApprovalId: record.pendingApprovalId }),
    totalTokens: record.tokens.actualTotalTokens,
    costMicroUsd: record.cost.actualMicroUsd,
    attribution: record.tokens.attribution,
    optimization: coerceOptimizationLedger(record.optimization),
    ...(output === undefined ? {} : { output }),
    ...(record.resultDigest === undefined ? {} : { outputDigest: record.resultDigest }),
  };
}
