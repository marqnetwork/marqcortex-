/**
 * Loop and runaway protection (AI-01 Batch 3A).
 *
 * The failure mode this module exists for is not a bug — it is the normal
 * behaviour of an agent that has been given a task it cannot finish. It will
 * try, observe that it did not work, and try again, forever, spending money
 * every time. Every control here is therefore a HARD stop with a terminal
 * outcome, never a warning: "never silently continue after a limit is reached"
 * is the requirement, and a limit that logs and proceeds is a limit that has
 * been reached and ignored.
 *
 * SIX INDEPENDENT DETECTORS, because a single one is always escapable:
 *
 *   Counters        steps, per-agent steps, handoffs, retries. Cheapest, and
 *                   catches the case where every action genuinely differs.
 *   Fingerprints    the same intention proposed again. Catches "retry the same
 *                   tool call with the same input".
 *   Handoff edges   the same A→B handoff repeated. Catches two agents passing
 *                   a task back and forth while each does something slightly
 *                   different.
 *   Cycles          an agent re-entering the path more times than permitted.
 *                   Catches A→B→C→A rings that no single edge count sees.
 *   No progress     consecutive identical results. Catches an agent that varies
 *                   its input and gets the same answer every time.
 *   Deadline        wall clock. Catches everything else, including a detector
 *                   that has itself been outsmarted.
 *
 * All state lives on the run record and is therefore durable. A runaway that
 * survives an isolate restart is exactly the one worth stopping, and a detector
 * whose counters live in isolate memory resets itself precisely then.
 */

import type { AgentLimits, AgentRemainingBudget } from '../contracts/agent.ts';
import type { AgentLoopState, AgentRunRecord } from '../contracts/runtime.ts';
import type { AgentFailureCode } from '../contracts/failures.ts';
import { agentFailure } from '../contracts/failures.ts';
import { canonicalJson, digestValue } from './digest.ts';

/** The empty loop state a new run starts from. */
export function initialLoopState(entryAgentId: string): AgentLoopState {
  return {
    actionCounts: {},
    handoffEdgeCounts: {},
    agentPath: [entryAgentId],
    noProgressStreak: 0,
  };
}

/**
 * Stable identity of an intention.
 *
 * The action TYPE, the agent, the target and the canonical input — and nothing
 * else. Deliberately excludes the reason string and the estimates: an agent
 * that retries the same call with a freshly-worded justification is precisely
 * the case this is meant to catch, and including the reason would let a
 * re-phrasing defeat it.
 */
export function fingerprintAction(input: {
  readonly agentId: string;
  readonly actionType: string;
  readonly target?: string;
  readonly payload: unknown;
}): string {
  const payload = canonicalJson(input.payload) ?? 'null';
  return digestValue(`${input.agentId}|${input.actionType}|${input.target ?? '-'}|${payload}`);
}

export interface LimitCheckInput {
  readonly record: AgentRunRecord;
  readonly limits: AgentLimits;
  readonly nowMs: number;
  readonly deadlineMs: number;
}

export interface LimitViolation {
  readonly failure: AgentFailureCode;
  /** Caller-safe explanation. Names the limit, never internal state. */
  readonly message: string;
  readonly diagnostics: string;
}

/**
 * Everything that can be judged BEFORE the agent is asked for a proposal.
 *
 * Checked in cost order and, where two apply, in the order that produces the
 * most truthful terminal state: an expired run is expired even if it was also
 * out of steps, because the deadline is the thing that actually stopped it.
 */
export function checkPreStepLimits(input: LimitCheckInput): LimitViolation | undefined {
  const { record, limits, nowMs, deadlineMs } = input;

  if (nowMs >= deadlineMs) {
    return {
      failure: 'run_expired',
      message: 'This run reached its time limit.',
      diagnostics: `deadline exceeded by ${nowMs - deadlineMs}ms`,
    };
  }

  if (record.stepCount >= limits.maxTotalSteps) {
    return {
      failure: 'step_limit_exceeded',
      message: 'This run reached its step limit.',
      diagnostics: `steps=${record.stepCount} limit=${limits.maxTotalSteps}`,
    };
  }

  const byAgent = record.stepsByAgent[record.currentAgentId] ?? 0;
  if (byAgent >= limits.maxStepsPerAgent) {
    return {
      failure: 'step_limit_exceeded',
      message: 'An agent in this run reached its step limit.',
      diagnostics: `agent=${record.currentAgentId} steps=${byAgent} limit=${limits.maxStepsPerAgent}`,
    };
  }

  if (record.retryCount > limits.maxRetries) {
    return {
      failure: 'retry_limit_exceeded',
      message: 'This run reached its retry limit.',
      diagnostics: `retries=${record.retryCount} limit=${limits.maxRetries}`,
    };
  }

  if (record.loop.noProgressStreak >= limits.maxRepeatedActions) {
    return {
      failure: 'no_progress',
      message: 'This run stopped making progress and was ended.',
      diagnostics: `identical results in ${record.loop.noProgressStreak} consecutive steps`,
    };
  }

  return undefined;
}

/** Everything that can only be judged once the proposal is known. */
export function checkProposalLimits(input: {
  readonly record: AgentRunRecord;
  readonly limits: AgentLimits;
  readonly fingerprint: string;
  readonly handoffTarget?: string;
}): LimitViolation | undefined {
  const { record, limits, fingerprint, handoffTarget } = input;

  const repeats = (record.loop.actionCounts[fingerprint] ?? 0) + 1;
  if (repeats > limits.maxRepeatedActions) {
    return {
      failure: 'loop_detected',
      message: 'This run repeated the same action too many times and was stopped.',
      diagnostics: `fingerprint repeated ${repeats} times, limit ${limits.maxRepeatedActions}`,
    };
  }

  if (handoffTarget !== undefined) {
    if (record.handoffCount >= limits.maxHandoffs) {
      return {
        failure: 'handoff_limit_exceeded',
        message: 'This run reached its handoff limit.',
        diagnostics: `handoffs=${record.handoffCount} limit=${limits.maxHandoffs}`,
      };
    }

    const edge = `${record.currentAgentId}>${handoffTarget}`;
    const edgeCount = (record.loop.handoffEdgeCounts[edge] ?? 0) + 1;
    if (edgeCount > limits.maxRepeatedHandoffs) {
      return {
        failure: 'loop_detected',
        message: 'This run passed work between the same agents too many times.',
        diagnostics: `handoff edge ${edge} repeated ${edgeCount} times, limit ${limits.maxRepeatedHandoffs}`,
      };
    }

    // Cycle detection over the whole path, not just the edge. A→B→C→A leaves
    // every individual edge at one occurrence, so an edge counter alone never
    // sees it.
    const visits = record.loop.agentPath.filter((agentId) => agentId === handoffTarget).length + 1;
    if (visits > limits.maxRepeatedHandoffs) {
      return {
        failure: 'loop_detected',
        message: 'This run cycled between agents and was stopped.',
        diagnostics: `agent ${handoffTarget} entered ${visits} times, limit ${limits.maxRepeatedHandoffs}`,
      };
    }
  }

  return undefined;
}

/** Fold an executed step into the loop state. Pure; the caller persists it. */
export function recordLoopStep(
  loop: AgentLoopState,
  input: {
    readonly fingerprint: string;
    readonly outputDigest?: string;
    readonly handoffTarget?: string;
    readonly fromAgentId?: string;
  },
): AgentLoopState {
  const actionCounts = { ...loop.actionCounts };
  actionCounts[input.fingerprint] = (actionCounts[input.fingerprint] ?? 0) + 1;

  const handoffEdgeCounts = { ...loop.handoffEdgeCounts };
  let agentPath = loop.agentPath;
  if (input.handoffTarget !== undefined && input.fromAgentId !== undefined) {
    const edge = `${input.fromAgentId}>${input.handoffTarget}`;
    handoffEdgeCounts[edge] = (handoffEdgeCounts[edge] ?? 0) + 1;
    agentPath = [...loop.agentPath, input.handoffTarget];
  }

  // A step with no output (a checkpoint, a pause) is neither progress nor its
  // absence, so it leaves the streak alone rather than resetting it — otherwise
  // an agent could hold a no-progress streak open indefinitely by interleaving
  // checkpoints.
  let noProgressStreak = loop.noProgressStreak;
  let lastOutputDigest = loop.lastOutputDigest;
  if (input.outputDigest !== undefined) {
    noProgressStreak = input.outputDigest === loop.lastOutputDigest ? loop.noProgressStreak + 1 : 0;
    lastOutputDigest = input.outputDigest;
  }

  return {
    actionCounts,
    handoffEdgeCounts,
    agentPath,
    noProgressStreak,
    ...(lastOutputDigest === undefined ? {} : { lastOutputDigest }),
  };
}

/** What the agent is told is left. Never negative. */
export function remainingBudget(
  record: AgentRunRecord,
  limits: AgentLimits,
  nowMs: number,
  deadlineMs: number,
): AgentRemainingBudget {
  const floor = (value: number) => Math.max(0, value);
  return {
    steps: floor(limits.maxTotalSteps - record.stepCount),
    handoffs: floor(limits.maxHandoffs - record.handoffCount),
    promptTokens: floor(limits.maxPromptTokens - record.tokens.actualPromptTokens),
    completionTokens: floor(limits.maxCompletionTokens - record.tokens.actualCompletionTokens),
    totalTokens: floor(limits.maxTotalTokens - record.tokens.actualTotalTokens),
    estimatedCostMicroUsd: floor(limits.maxEstimatedCostMicroUsd - record.cost.estimatedMicroUsd),
    actualCostMicroUsd: floor(limits.maxActualCostMicroUsd - record.cost.actualMicroUsd),
    runtimeMs: floor(deadlineMs - nowMs),
  };
}

/** Raise a limit violation as the typed failure it is. */
export function raiseViolation(violation: LimitViolation, runId: string, agentId: string): never {
  throw agentFailure(violation.failure, violation.message, {
    runId,
    agentId,
    diagnostics: violation.diagnostics,
  });
}
