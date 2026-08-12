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

import type {
  AgentRunRecord,
  AgentUsageAttribution,
} from '../../agents/contracts/runtime.ts';
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

/**
 * What the child agent run has spent SO FAR (AI-01 Batch 3B, Part 6A).
 *
 * CUMULATIVE, NOT INCREMENTAL, and that is load-bearing. An incremental report
 * would require the port to remember what it had already reported, which is
 * exactly the state an edge isolate loses when it is recycled. Cumulative totals
 * plus a delta-applying fold on the other side means a recovered isolate
 * re-observing the same child computes a zero delta and changes nothing.
 *
 * It comes through the PORT rather than being read from the agent run record by
 * whoever wants it, for the same reason `output` does: this is the one seam
 * between the workflow engine and the agent runtime, and a second reader of the
 * child's ledgers would be a second opinion about what a run cost — differing by
 * whether each remembered retries, cached tokens or a repair call.
 *
 * Reported for a child in ANY state. A run that failed after two model steps
 * spent money on both, and a handle that carried usage only on completion would
 * quietly under-report every failure the platform paid for.
 */
export interface AgentNodeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  /**
   * Prompt tokens the provider served from its own cache
   * (AI-01 Batch 3B, Integration Pass).
   *
   * Reported where the provider reports it, and absent where it does not — the
   * agent runtime's token ledger carries the figure it was given and invents
   * none. It is carried as ATTRIBUTION, not as a deduction: cached tokens are
   * already reflected in `costMicroUsd`, and subtracting them again here would
   * be one saving counted twice.
   */
  readonly cachedTokens?: number;
  /**
   * Which provider and model the spend was with, when the trusted usage record
   * establishes exactly one (AI-01 Batch 3B, Integration Pass).
   *
   * ABSENT when the child called several. That is not a limitation being worked
   * around — a run that spent across two models has no single provider identity,
   * and naming one of them would attribute the whole cost to it. The financial
   * event then carries an empty provider identity, which is the honest report.
   *
   * Read from the agent runtime's OWN attribution rows, never from a provider
   * adapter: this tree cannot reach one, and a second reader of provider
   * responses would be a second opinion about what a call was made against.
   */
  readonly providerName?: string;
  readonly modelName?: string;
}

/** Everything the engine is allowed to learn about a child agent run. */
export interface AgentNodeHandle {
  readonly agentRunId: string;
  readonly state: AgentNodeState;
  /** The child's own state, verbatim. Recorded for operators, never branched on. */
  readonly childState: string;
  /** Digest of the child's accepted output. */
  readonly resultDigest?: string;
  /**
   * The child's ACCEPTED output, present only on completion (AI-01 Batch 3B,
   * Part 3).
   *
   * Part 2 returned a digest and nothing else, and for Part 2 that was right:
   * the engine had no use for the value and carrying it would have been an
   * un-needed copy of a tenant's data. Part 3 has a use — conditions branch on
   * node outputs and mappings read them — and there are only two ways to get
   * one: this, or reaching into the agent runtime's checkpoint store. The
   * second is exactly the "agent internals" access this batch forbids.
   *
   * So it comes back through the port, and it comes back ALREADY GOVERNED: the
   * orchestrator accepted it against the agent's own `outputContract` before it
   * would complete the run, so this is a contract-validated projection and
   * never a raw model completion. The workflow then applies its OWN declared
   * output contract before storing it — see `contracts/checkpoint.ts` for why
   * "trusted" requires both.
   */
  readonly output?: unknown;
  /**
   * The child's cumulative spend (AI-01 Batch 3B, Part 6A).
   *
   * Absent when the child has spent nothing measurable — which is the honest
   * report for an approval node or a child that has not yet reached the model,
   * and is why the field is optional rather than a zeroed object. "Not measured"
   * and "measured zero" are different claims.
   */
  readonly usage?: AgentNodeUsage;
  /**
   * The version of the agent that held the child run (AI-01 Batch 3B,
   * Integration Pass).
   *
   * Carried so a financial event can attribute spend to the agent VERSION that
   * incurred it. A cost-by-agent figure that could not tell two versions apart
   * would report a regression introduced by a deployment as though the previous
   * version had always cost that much.
   */
  readonly agentVersion?: string;
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
/**
 * The provider and model a child's spend can be attributed to, or neither.
 *
 * ONE OR NONE, deliberately. The agent runtime records an attribution row per
 * provider and model it actually called, and a child that called two has no
 * single identity — reporting the first, the largest or the last would put the
 * whole of the child's cost against a provider that served part of it. Absence
 * is the truthful answer, and Part 6C's event contract already treats an empty
 * provider identity as a fact rather than as missing data.
 */
function soleProviderIdentity(
  attribution: readonly AgentUsageAttribution[],
): { providerName?: string; modelName?: string } {
  if (attribution.length === 0) return {};
  const first = attribution[0];
  for (const row of attribution) {
    if (row.providerId !== first.providerId || row.modelId !== first.modelId) return {};
  }
  return { providerName: first.providerId, modelName: first.modelId };
}

export function projectAgentRun(record: AgentRunRecord, output?: unknown): AgentNodeHandle {
  const terminal = isTerminalState(record.state);
  const state: AgentNodeState = terminal
    ? record.state === 'completed'
      ? 'completed'
      : 'failed'
    : record.state === 'running'
      ? 'running'
      : 'blocked';

  // The child's OWN ledgers, verbatim. Not re-derived from its step history and
  // not recomputed from a price table here — the agent runtime already
  // reconciled provider-reported usage into these, and a second derivation would
  // be a second answer to a question that has one.
  //
  // A record with no ledgers at all reports NO usage rather than zeroes. That is
  // the honest projection for a record written before the ledgers existed, and
  // it keeps "not measured" distinguishable from "measured zero" — which is the
  // distinction an approval node depends on.
  const tokens = record.tokens;
  const cost = record.cost;
  const identity = tokens === undefined ? {} : soleProviderIdentity(tokens.attribution);
  const measured =
    tokens !== undefined &&
    cost !== undefined &&
    (tokens.actualTotalTokens > 0 || cost.actualMicroUsd > 0)
      ? {
          usage: {
            inputTokens: tokens.actualPromptTokens,
            outputTokens: tokens.actualCompletionTokens,
            totalTokens: tokens.actualTotalTokens,
            costMicroUsd: cost.actualMicroUsd,
            cachedTokens: tokens.cachedTokens,
            ...identity,
          },
        }
      : {};

  return {
    agentRunId: record.context.runId,
    state,
    childState: record.state,
    agentVersion: record.currentAgentVersion,
    ...measured,
    // Carried only when the node succeeded. A failed, cancelled or expired
    // child has no accepted output, and passing whatever it last held would
    // make a partial result look like a governed one.
    ...(state === 'completed' && output !== undefined ? { output } : {}),
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

      if (record.state !== 'completed') return projectAgentRun(record);

      // The accepted output lives on the checkpoint that accepted it.
      // `latestCheckpoint` is part of the orchestrator's PUBLIC contract —
      // documented for exactly this, "a resume or an operator read" — so this
      // stays inside the sanctioned seam rather than reaching into the agent
      // runtime's checkpoint store, which the port exists to make unnecessary.
      const checkpoint = await orchestrator.latestCheckpoint(
        input.organizationId,
        input.agentRunId,
      );
      return projectAgentRun(record, checkpoint?.output);
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
