/**
 * The agent execution port, and its one implementation over the certified
 * Batch 3A Agent Runtime (AI-01 Batch 3B).
 *
 * THE WORKFLOW ENGINE MAY DRIVE AN AGENT RUN. IT MAY NOT REPLACE THE AGENT
 * ORCHESTRATOR.
 *
 * That distinction is the whole of this file. An `agent` node creates a run
 * through `orchestrator.createRun` and advances it through `orchestrator.advance`
 * — the same two calls the agent HTTP surface makes. Every limit, every loop
 * detector, every approval gate, every tool claim and every model step inside
 * that run is enforced by the Batch 3A orchestrator exactly as it would be for a
 * run a person started. The workflow contributes an objective, an input and a
 * budget; it does not contribute execution authority.
 *
 * WHAT THIS PORT DELIBERATELY CANNOT DO:
 *
 *   reach agent internals   it holds an `AgentOrchestrator` interface, not the
 *                           run store, the loop state or the ledgers
 *   mutate agent state      there is no method here that writes a run record;
 *                           the boundary scan asserts no such method exists
 *   bypass an approval      an agent run that parks on an approval comes back
 *                           `waiting_for_approval`, and the workflow node waits
 *                           with it rather than continuing
 *   bypass the Control Plane every model step inside the child run goes through
 *                           `controlPlane.execute`, unchanged
 *
 * THE ALLOW LIST IS CHECKED TWICE, AND THE SECOND CHECK IS NOT REDUNDANT. The
 * registry refuses a definition naming an undeclared agent, and this port refuses
 * an execution naming one — because a definition registered before an agent was
 * revoked would otherwise still reach it.
 *
 * CREDENTIALS ARE CARRIED, NEVER STORED. The driving caller's authorization
 * travels as an argument and is discarded when the call returns, exactly as the
 * Batch 3A control plane bridge does it. A workflow advances only while an
 * authenticated caller is driving it.
 */

import type {
  AgentOrchestrator,
  AgentRunActor,
} from '../../agents/orchestrator/agentOrchestrator.ts';
import type { AgentRegistry } from '../../agents/registry/agentRegistry.ts';
import type { AgentRunRecord, AgentRunState } from '../../agents/contracts/runtime.ts';
import { isTerminalState } from '../../agents/contracts/runtime.ts';
import { isAgentRuntimeError } from '../../agents/contracts/failures.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { digestValue } from '../../agents/runtime/digest.ts';

export interface AgentStepRequest {
  readonly agentId: string;
  readonly organizationId: string;
  readonly actor: AgentRunActor;
  readonly objective: string;
  readonly input: unknown;
  readonly requestId: string;
  readonly correlationId: string;
  /** The driving caller's credential, for the control plane. Never persisted. */
  readonly authorization: string | null;
  readonly clientIp?: string;
  /** The workflow run this agent run belongs to. Recorded on the child run. */
  readonly workflowRunId: string;
  readonly origin: { readonly surface: 'team_console' | 'client_portal' | 'system'; readonly feature: string };
}

export interface AgentStepResult {
  readonly childAgentRunId: string;
  readonly state: AgentRunState;
  /** True when the child run reached `completed`. */
  readonly completed: boolean;
  /** True when the child run is parked and can still be resumed. */
  readonly waiting: boolean;
  /** The child run's accepted output, when it completed. */
  readonly output?: unknown;
  readonly outputDigest?: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly stepCount: number;
  readonly handoffCount: number;
  readonly pendingApprovalId?: string;
  readonly failure?: string;
  readonly failureMessage?: string;
  /** Per-provider/model attribution the child run measured. Never re-derived. */
  readonly attribution: AgentRunRecord['tokens']['attribution'];
}

export interface AgentExecutionPort {
  execute(request: AgentStepRequest): Promise<AgentStepResult>;
  /** Resume a parked child run after its approval was decided. */
  resume(request: {
    readonly organizationId: string;
    readonly childAgentRunId: string;
    readonly actor: AgentRunActor;
    readonly authorization: string | null;
    readonly requestId: string;
    readonly correlationId: string;
    readonly clientIp?: string;
  }): Promise<AgentStepResult>;
  /** Agent ids that are registered, for registry validation. */
  knownAgentIds(): readonly string[];
}

export function createAgentRuntimeBridge(deps: {
  readonly orchestrator: AgentOrchestrator;
  readonly registry: AgentRegistry;
  /** Reads the child run's final record so its ledgers can be folded in. */
  readonly loadRun: (
    organizationId: string,
    runId: string,
  ) => Promise<AgentRunRecord | undefined>;
  /** The latest checkpoint, which carries a completed run's accepted output. */
  readonly latestCheckpointOutput: (
    organizationId: string,
    runId: string,
  ) => Promise<unknown>;
}): AgentExecutionPort {
  /** Project a child run record into the bounded result a workflow may see. */
  async function project(record: AgentRunRecord): Promise<AgentStepResult> {
    const completed = record.state === 'completed';
    // Only a COMPLETED run's output is read. A failed or parked run's checkpoint
    // may hold partial progress, and handing that to an output mapping would let
    // a workflow treat an unfinished agent's guess as an answer.
    const output = completed
      ? await deps.latestCheckpointOutput(record.context.organizationId, record.context.runId)
      : undefined;

    return {
      childAgentRunId: record.context.runId,
      state: record.state,
      completed,
      waiting: !isTerminalState(record.state),
      ...(output === undefined ? {} : { output, outputDigest: digestValue(output) }),
      promptTokens: record.tokens.actualPromptTokens,
      completionTokens: record.tokens.actualCompletionTokens,
      cachedTokens: record.tokens.cachedTokens,
      totalTokens: record.tokens.actualTotalTokens,
      costMicroUsd: record.cost.actualMicroUsd,
      stepCount: record.stepCount,
      handoffCount: record.handoffCount,
      ...(record.pendingApprovalId === undefined
        ? {}
        : { pendingApprovalId: record.pendingApprovalId }),
      ...(record.failure === undefined ? {} : { failure: record.failure }),
      ...(record.failureMessage === undefined
        ? {}
        : { failureMessage: record.failureMessage }),
      attribution: record.tokens.attribution,
    };
  }

  /**
   * Translate an agent failure into a workflow one.
   *
   * Budget, policy and tenancy refusals keep their meaning rather than collapsing
   * into "the agent step failed": a workflow that retried a budget denial would
   * grind against a decision that has already been made, and the failure taxonomy
   * is what stops it.
   */
  function translate(error: unknown, request: { agentId: string; workflowRunId: string }): never {
    if (!isAgentRuntimeError(error)) {
      throw workflowFailure('agent_step_failed', 'That agent step could not be completed.', {
        workflowRunId: request.workflowRunId,
        diagnostics: `agent ${request.agentId}: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      });
    }
    const diagnostics = `agent ${request.agentId} failed ${error.failure}: ${error.diagnostics ?? error.message}`;
    const options = { workflowRunId: request.workflowRunId, diagnostics, cause: error };

    switch (error.failure) {
      case 'token_budget_exhausted':
        throw workflowFailure('token_budget_exhausted', error.message, options);
      case 'cost_budget_exhausted':
        throw workflowFailure('cost_budget_exhausted', error.message, options);
      case 'agent_not_found':
      case 'agent_disabled':
      case 'agent_uncertified':
      case 'capability_denied':
      case 'tool_denied':
      case 'handoff_denied':
        throw workflowFailure('capability_denied', error.message, options);
      case 'tenant_isolation_violation':
        throw workflowFailure('tenant_isolation_violation', error.message, options);
      case 'unauthorized':
        throw workflowFailure('unauthorized', error.message, options);
      case 'runtime_disabled':
        throw workflowFailure('workflow_disabled_runtime', error.message, options);
      case 'approval_expired':
        throw workflowFailure('approval_expired', error.message, options);
      case 'approval_rejected':
        throw workflowFailure('approval_rejected', error.message, options);
      case 'run_expired':
        throw workflowFailure('node_timeout', error.message, options);
      default:
        throw workflowFailure('agent_step_failed', error.message, options);
    }
  }

  return {
    async execute(request) {
      // The second allow-list check. See the module header for why it is not
      // redundant with the registry's.
      const agent = deps.registry.find(request.agentId);
      if (!agent) {
        throw workflowFailure('capability_denied', 'That agent is not available.', {
          workflowRunId: request.workflowRunId,
          diagnostics: `agent ${request.agentId} is not registered`,
        });
      }

      let created: AgentRunRecord;
      try {
        created = await deps.orchestrator.createRun({
          agentId: request.agentId,
          organizationId: request.organizationId,
          actor: request.actor,
          objective: request.objective,
          input: request.input,
          requestId: request.requestId,
          correlationId: request.correlationId,
          origin: request.origin,
          // The child run records the workflow it belongs to, so the agent
          // console and the agent audit trail can both answer "which workflow
          // started this?" without a join through this module.
          workflowId: request.workflowRunId,
        });
      } catch (error) {
        translate(error, request);
      }

      try {
        const advanced = await deps.orchestrator.advance({
          organizationId: request.organizationId,
          runId: created.context.runId,
          actor: request.actor,
          authorization: request.authorization,
          requestId: request.requestId,
          correlationId: request.correlationId,
          ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
        });
        return await project(advanced);
      } catch (error) {
        // The child run exists and has recorded whatever it managed to do. Reading
        // it back rather than discarding it means the workflow's ledgers still pick
        // up tokens and money the child actually spent before it failed — a failed
        // step that reported zero cost would understate the bill.
        const record = await deps.loadRun(request.organizationId, created.context.runId);
        if (record) {
          const projected = await project(record);
          if (isAgentRuntimeError(error)) {
            return {
              ...projected,
              failure: error.failure,
              failureMessage: error.message,
            };
          }
          return projected;
        }
        translate(error, request);
      }
    },

    async resume(request) {
      try {
        const advanced = await deps.orchestrator.advance({
          organizationId: request.organizationId,
          runId: request.childAgentRunId,
          actor: request.actor,
          authorization: request.authorization,
          requestId: request.requestId,
          correlationId: request.correlationId,
          ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
        });
        return await project(advanced);
      } catch (error) {
        translate(error, {
          agentId: request.childAgentRunId,
          workflowRunId: request.childAgentRunId,
        });
      }
    },

    knownAgentIds: () => deps.registry.list().map((agent) => agent.agentId),
  };
}
