/**
 * The agent node port (AI-01 Batch 3B, Part 2).
 *
 * THE ONE MODULE IN `workflows/` THAT MAY HOLD AN AGENT ORCHESTRATOR.
 *
 * This is the workflow engine's `controlPlaneBridge.ts`, and it exists for the
 * identical reason. Batch 3A's central claim is that every model call goes
 * through the AI Control Plane; Batch 3B's is that every agent invocation goes
 * through the Agent Orchestrator. Both claims are only as strong as the number
 * of places that can reach past them, so both are enforced by construction —
 * one module holds the reference, everything else takes this port, and the
 * boundary scan asserts the rest of the tree does not import the orchestrator.
 *
 * WHAT THE ENGINE THEREFORE CANNOT DO. It cannot call a provider, a model, a
 * tool, a prompt, an approval gate or an agent's `propose` function. None of
 * them are reachable from `AgentNodeHandle`, which is a stronger guarantee than
 * a rule saying it must not. What comes back is four fields: an id, a coarse
 * lifecycle state, a digest and a failure code — enough to advance a cursor,
 * and not enough to make a decision that belongs to the orchestrator.
 *
 * THE ORCHESTRATOR REMAINS THE EXECUTION AUTHORITY. Limits, loop protection,
 * budgets, approvals, tool permissions, certification and the child's own state
 * machine are all decided there, on the child run, exactly as they would be for
 * a run a person started. The workflow does not soften any of them and cannot:
 * it hands over an objective and an input and is told what happened.
 *
 * ── THE FOUR-STATE PROJECTION ──────────────────────────────────────────────
 *
 * A child agent run has sixteen states. The workflow needs four answers:
 *
 *   completed  the node's work is done and its output was accepted
 *   failed     the child reached a terminal state that is not completion
 *   blocked    the child is alive but cannot progress unattended — waiting on
 *              an approval, a budget window or a tool. The workflow waits too.
 *   running    the child is alive and mid-flight
 *
 * Collapsing sixteen into four is the point. A workflow that branched on
 * `budget_exhausted` versus `policy_denied` would be re-implementing the
 * agent runtime's judgement one state at a time, and the moment Batch 3A added
 * a seventeenth state the workflow would silently not handle it. The terminal
 * detail is preserved verbatim on the step record for an operator to read; it
 * is simply not something the engine branches on.
 */

import type { AgentRunRecord } from '../../agents/contracts/runtime.ts';
import type {
  AgentOrchestrator,
  AgentRunActor,
} from '../../agents/orchestrator/agentOrchestrator.ts';
import type { WorkflowRunOrigin } from '../contracts/run.ts';
import { isTerminalState } from '../../agents/contracts/runtime.ts';

/**
 * The actor as the Agent Orchestrator sees them.
 *
 * Re-exported through this module so the engine never imports an agent module
 * of its own — the port is the single seam, for types as well as for calls.
 */
export type WorkflowAgentActor = AgentRunActor;

export type AgentNodeState = 'running' | 'blocked' | 'completed' | 'failed';

/** Everything the engine is allowed to learn about a child agent run. */
export interface AgentNodeHandle {
  readonly agentRunId: string;
  readonly state: AgentNodeState;
  /** The child's own state, verbatim. Recorded for operators, never branched on. */
  readonly childState: string;
  /** Digest of the child's accepted output. Never the output. */
  readonly resultDigest?: string;
  readonly failure?: string;
  /** Caller-safe message from the child. Never a provider or storage message. */
  readonly failureMessage?: string;
}

export interface StartAgentNodeInput {
  readonly agentId: string;
  readonly organizationId: string;
  readonly actor: AgentRunActor;
  readonly objective: string;
  readonly input: unknown;
  readonly requestId: string;
  readonly correlationId: string;
  readonly origin: WorkflowRunOrigin;
  /** The workflow run this node belongs to. Stamped on the child's context. */
  readonly workflowId: string;
}

export interface DriveAgentNodeInput {
  readonly organizationId: string;
  readonly agentRunId: string;
  readonly actor: AgentRunActor;
  /** The driving caller's credential, for the control plane. Never stored. */
  readonly authorization: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly clientIp?: string;
}

export interface CancelAgentNodeInput {
  readonly organizationId: string;
  readonly agentRunId: string;
  readonly actor: AgentRunActor;
  readonly reason: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface WorkflowAgentPort {
  /**
   * Create the child run WITHOUT executing it.
   *
   * Split from `drive` deliberately: the engine persists the returned id before
   * anything runs, so a crashed isolate comes back knowing which child to poll.
   * A combined create-and-execute call would make that ordering impossible.
   */
  create(input: StartAgentNodeInput): Promise<AgentNodeHandle>;
  /** Drive the child until it blocks, completes or fails. */
  drive(input: DriveAgentNodeInput): Promise<AgentNodeHandle>;
  /** Stop a child whose workflow was cancelled. */
  cancel(input: CancelAgentNodeInput): Promise<AgentNodeHandle>;
}

/**
 * Project a child run record onto the four states the engine understands.
 *
 * Exported so the projection is testable on its own and so there is exactly one
 * definition of "the node succeeded" — a second one inside the engine would be
 * the beginning of the engine having an opinion about agent states.
 */
export function projectAgentRun(record: AgentRunRecord): AgentNodeHandle {
  const terminal = isTerminalState(record.state);
  const state: AgentNodeState = terminal
    ? record.state === 'completed'
      ? 'completed'
      : 'failed'
    : record.state === 'running'
      ? 'running'
      : 'blocked';

  return {
    agentRunId: record.context.runId,
    state,
    childState: record.state,
    ...(record.resultDigest === undefined ? {} : { resultDigest: record.resultDigest }),
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    ...(record.failureMessage === undefined ? {} : { failureMessage: record.failureMessage }),
  };
}

/** The production port: the certified Batch 3A orchestrator, and nothing else. */
export function createAgentRuntimeNodePort(
  orchestrator: AgentOrchestrator,
): WorkflowAgentPort {
  return {
    async create(input) {
      const record = await orchestrator.createRun({
        agentId: input.agentId,
        organizationId: input.organizationId,
        actor: input.actor,
        objective: input.objective,
        input: input.input,
        requestId: input.requestId,
        correlationId: input.correlationId,
        origin: input.origin,
        // Stamped so a child run is traceable back to the workflow that owns
        // it, in the agent runtime's own audit trail and read models.
        workflowId: input.workflowId,
      });
      return projectAgentRun(record);
    },

    async drive(input) {
      const record = await orchestrator.advance({
        organizationId: input.organizationId,
        runId: input.agentRunId,
        actor: input.actor,
        authorization: input.authorization,
        requestId: input.requestId,
        correlationId: input.correlationId,
        ...(input.clientIp === undefined ? {} : { clientIp: input.clientIp }),
      });
      return projectAgentRun(record);
    },

    async cancel(input) {
      const record = await orchestrator.cancel({
        organizationId: input.organizationId,
        runId: input.agentRunId,
        actor: input.actor,
        reason: input.reason,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
      return projectAgentRun(record);
    },
  };
}
