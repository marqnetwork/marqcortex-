/**
 * The agent run state machine (AI-01 Batch 3A).
 *
 * ONE TABLE. Every legal move a run can make is an entry in `TRANSITIONS`, and
 * every state change in the runtime goes through `assertTransition`. There is
 * no code path anywhere that assigns a state directly — the orchestrator asks
 * this module, and the store refuses a write whose version is stale.
 *
 * WHY A TABLE RATHER THAN GUARDS AT THE CALL SITES.
 *
 * A run has sixteen states and ten operations. Expressed as `if` statements at
 * the places that change state, that is a hundred-odd implicit decisions spread
 * across the runtime, and the ones nobody wrote are the interesting ones: can a
 * cancelled run be approved? can a completed run be paused? A table answers all
 * of them at once, and the answer is reviewable in one screen.
 *
 * TERMINAL MEANS TERMINAL. The six terminal states have no outgoing edges, so
 * "retry a failed run" cannot be a transition — it FORKS a new run carrying
 * `parentRunId`. That is deliberate and it is the whole reason terminal
 * immutability survives contact with a retry button: a completed run's record
 * is evidence, and evidence that can be reopened and rewritten is not evidence.
 */

import type { AgentRunOperation, AgentRunState } from '../contracts/runtime.ts';
import { isTerminalState } from '../contracts/runtime.ts';
import { agentFailure } from '../contracts/failures.ts';

/**
 * from → the states it may move to.
 *
 * Read it as: "a run that is X may next be one of Y". A state missing from a
 * list is not an oversight — it is a refusal.
 */
export const TRANSITIONS: Readonly<Record<AgentRunState, readonly AgentRunState[]>> = {
  // A created run has done nothing yet, so the only forward move is validation.
  // It can still be cancelled (a caller changed their mind) or denied (the
  // agent is disabled between creation and the first step).
  created: ['validating', 'cancelled', 'policy_denied', 'failed', 'expired'],

  // Validation resolves the agent, its certification and the input contract.
  validating: ['planned', 'policy_denied', 'failed', 'cancelled', 'expired'],

  // Planned means the entry step is authorised in principle. Budget preflight
  // is next; a run that cannot afford its first step never reaches `running`.
  planned: [
    'waiting_for_budget',
    'running',
    'policy_denied',
    'budget_exhausted',
    'failed',
    'cancelled',
    'expired',
  ],

  waiting_for_budget: [
    'running',
    'budget_exhausted',
    'paused',
    'failed',
    'cancelled',
    'expired',
    'policy_denied',
  ],

  running: [
    'waiting_for_tool',
    'waiting_for_agent',
    'waiting_for_approval',
    'waiting_for_budget',
    'paused',
    'retrying',
    'completed',
    'failed',
    'cancelled',
    'expired',
    'budget_exhausted',
    'policy_denied',
  ],

  waiting_for_tool: [
    'running',
    'retrying',
    'paused',
    'failed',
    'cancelled',
    'expired',
    'policy_denied',
  ],

  waiting_for_agent: ['running', 'paused', 'failed', 'cancelled', 'expired', 'policy_denied'],

  // An approval decision resumes (`running`) or ends the run. NOTHING ELSE
  // moves a run out of here except cancelling it or its deadline.
  //
  // `paused` was removed after an independent review demonstrated the defect it
  // caused. `pause` and `resume` are ordinary control operations available to
  // any operator, and either one moved a run out of `waiting_for_approval`
  // while leaving the approval undecided. The run then settled in `running`
  // holding an action nobody could authorise: the approval could no longer be
  // decided (that path requires `waiting_for_approval`) and `resume` could no
  // longer be applied (`running → running` is not an edge). The run was
  // stranded until somebody cancelled it, and the operator console reported it
  // as active the whole time.
  //
  // The state is now a genuine gate: an approval decision, a cancellation or
  // the deadline. See `OPERATION_SOURCES` for the other half of the fix.
  waiting_for_approval: ['running', 'failed', 'cancelled', 'expired', 'policy_denied'],

  paused: ['running', 'cancelled', 'expired', 'failed'],

  retrying: [
    'running',
    'failed',
    'cancelled',
    'expired',
    'budget_exhausted',
    'policy_denied',
  ],

  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
  budget_exhausted: [],
  policy_denied: [],
};

/**
 * Which operation may drive which transition.
 *
 * The table above says a move is structurally legal; this says who may ask for
 * it. Without the second table `cancel` could be used to complete a run, since
 * `running → completed` is a legal edge — the operation is what distinguishes
 * "the agent finished" from "an operator stopped it", and both end up as edges
 * out of `running`.
 */
export const OPERATION_TARGETS: Readonly<Record<AgentRunOperation, readonly AgentRunState[]>> = {
  start: ['validating', 'planned', 'running', 'waiting_for_budget'],
  pause: ['paused'],
  resume: ['running'],
  cancel: ['cancelled'],
  // A run-level retry never transitions an existing run; it forks a new one.
  // The entry exists so the operation is enumerable, and it is empty so no
  // transition can claim it.
  retry: [],
  approve: ['running'],
  reject: ['failed', 'cancelled'],
  expire: ['expired'],
  complete: ['completed'],
  fail: ['failed', 'policy_denied', 'budget_exhausted'],
};

/**
 * Which states each operation may be applied FROM.
 *
 * The third table, and the one whose absence produced a real defect. The first
 * says an edge exists; the second says an operation may produce that target.
 * Neither says where the operation may START, and that gap is how `resume`
 * reached `waiting_for_approval → running` — an edge that exists, to a target
 * `resume` is allowed to produce, from a state `resume` has no business
 * touching. The approval decision produces the same edge legitimately, because
 * `approve` is the only operation listed against that source.
 *
 * `step` is absent by design: it is the orchestrator's own internal driver, it
 * never originates with a caller, and it is already constrained by `TRANSITIONS`.
 */
export const OPERATION_SOURCES: Readonly<Record<AgentRunOperation, readonly AgentRunState[]>> = {
  start: ['created', 'validating', 'planned'],
  // Deliberately NOT `waiting_for_approval`: pausing a run that is waiting on a
  // human loses the gate and strands the decision.
  pause: ['running', 'waiting_for_budget', 'waiting_for_tool', 'waiting_for_agent'],
  resume: ['paused'],
  // Cancellation is always available while a run is alive. An operator must be
  // able to stop anything, including a run waiting on an approval nobody will
  // give — it is the one escape that is always correct.
  cancel: [
    'created',
    'validating',
    'planned',
    'waiting_for_budget',
    'running',
    'waiting_for_tool',
    'waiting_for_agent',
    'waiting_for_approval',
    'paused',
    'retrying',
  ],
  retry: [],
  approve: ['waiting_for_approval'],
  reject: ['waiting_for_approval'],
  expire: [
    'created',
    'validating',
    'planned',
    'waiting_for_budget',
    'running',
    'waiting_for_tool',
    'waiting_for_agent',
    'waiting_for_approval',
    'paused',
    'retrying',
  ],
  complete: ['running'],
  fail: [
    'created',
    'validating',
    'planned',
    'waiting_for_budget',
    'running',
    'waiting_for_tool',
    'waiting_for_agent',
    'waiting_for_approval',
    'paused',
    'retrying',
  ],
};

export function canTransition(from: AgentRunState, to: AgentRunState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** May this operation be applied to a run in this state at all? */
export function canOperateFrom(operation: AgentRunOperation, from: AgentRunState): boolean {
  return OPERATION_SOURCES[operation].includes(from);
}

/**
 * Enforce a transition, or throw a typed failure.
 *
 * `expectedVersion` is checked here rather than only in the store, so a stale
 * caller is refused before it can compute a new record from state it no longer
 * holds. The store checks again on write; two checks against the same version
 * is not redundancy, it is the difference between "we noticed" and "we
 * prevented".
 */
export function assertTransition(options: {
  readonly from: AgentRunState;
  readonly to: AgentRunState;
  readonly operation: AgentRunOperation | 'step';
  readonly currentVersion: number;
  readonly expectedVersion: number;
  readonly runId: string;
}): void {
  const { from, to, operation, currentVersion, expectedVersion, runId } = options;

  if (currentVersion !== expectedVersion) {
    throw agentFailure('stale_run_version', 'This run has changed since it was read.', {
      runId,
      diagnostics: `expected version ${expectedVersion}, current ${currentVersion}`,
    });
  }

  if (isTerminalState(from)) {
    throw agentFailure('invalid_transition', 'This run has already finished.', {
      runId,
      diagnostics: `terminal state ${from} cannot move to ${to}`,
    });
  }

  if (!canTransition(from, to)) {
    throw agentFailure('invalid_transition', 'That is not a valid change for this run.', {
      runId,
      diagnostics: `no transition ${from} → ${to}`,
    });
  }

  if (operation !== 'step') {
    // Source first: "you may not do that to a run in this state" is a more
    // useful refusal than "that outcome is not available to you", and it is the
    // check whose absence stranded approval-waiting runs.
    if (!canOperateFrom(operation, from)) {
      throw agentFailure('invalid_transition', 'That operation cannot be applied to this run now.', {
        runId,
        diagnostics: `operation ${operation} may not be applied from ${from}`,
      });
    }
    const permitted = OPERATION_TARGETS[operation];
    if (!permitted.includes(to)) {
      throw agentFailure('invalid_transition', 'That operation cannot produce this outcome.', {
        runId,
        diagnostics: `operation ${operation} may not drive ${from} → ${to}`,
      });
    }
  }
}

/**
 * States an operator-initiated pause is meaningful from.
 *
 * `waiting_for_approval` is deliberately absent — see `OPERATION_SOURCES`. A
 * run waiting on a human is already stopped; pausing it only loses the gate.
 * This list and `OPERATION_SOURCES.pause` must agree, and the state machine
 * suite asserts that they do.
 */
export const PAUSABLE_STATES: readonly AgentRunState[] = [
  'running',
  'waiting_for_budget',
  'waiting_for_tool',
  'waiting_for_agent',
];

/** States a run is considered "in flight" for operational reporting. */
export const ACTIVE_STATES: readonly AgentRunState[] = [
  'created',
  'validating',
  'planned',
  'waiting_for_budget',
  'running',
  'waiting_for_tool',
  'waiting_for_agent',
  'retrying',
];
