/**
 * The workflow run state machine (AI-01 Batch 3B, Part 2).
 *
 * ONE TABLE PER QUESTION, THREE QUESTIONS. Every legal move a workflow run can
 * make is an entry in `TRANSITIONS`, every state change in the engine goes
 * through `assertTransition`, and there is no code path anywhere that assigns a
 * state directly — the engine asks this module, and the store refuses a write
 * whose version is stale.
 *
 * This is the same three-table shape `agents/runtime/stateMachine.ts` arrived
 * at, and it is copied deliberately rather than simplified. Batch 3A shipped
 * with two tables and an independent review found the defect the third one
 * prevents: an edge that legitimately exists, to a target an operation is
 * allowed to produce, reached FROM a state that operation has no business
 * touching. Two tables cannot express "where may this operation start", and a
 * workflow engine that omitted the third would be re-learning that at its own
 * cost.
 *
 *   TRANSITIONS        does this edge exist at all?
 *   OPERATION_TARGETS  may this operation produce that outcome?
 *   OPERATION_SOURCES  may this operation be applied from that state?
 *
 * TERMINAL MEANS TERMINAL. The five terminal states have no outgoing edges, so
 * "restart a failed workflow" cannot be a transition — it is a NEW run against
 * the same plan. A completed run's record is evidence, and evidence that can be
 * reopened and rewritten is not evidence.
 *
 * WHY `ready` EXISTS SEPARATELY FROM `running`. Validation resolves the
 * workflow, re-checks its certification and confirms the plan digest still
 * matches the registry. `ready` is the state in which all of that has passed
 * and no node has yet been touched — the last point at which a run can be
 * stopped having done nothing at all. Collapsing it into `running` would make
 * "admitted" and "has started executing agents" the same observation, and they
 * are the two an operator most needs to tell apart.
 */

import type { WorkflowRunOperation, WorkflowRunState } from '../contracts/run.ts';
import { isTerminalWorkflowState } from '../contracts/run.ts';
import { workflowFailure } from '../contracts/failures.ts';

/**
 * from → the states it may move to.
 *
 * Read it as: "a run that is X may next be one of Y". A state missing from a
 * list is not an oversight — it is a refusal.
 */
export const TRANSITIONS: Readonly<Record<WorkflowRunState, readonly WorkflowRunState[]>> = {
  // A created run has done nothing yet, so the only forward move is validation.
  // It can still be cancelled (a caller changed their mind) or denied (the
  // workflow was disabled between creation and the first advance).
  created: ['validating', 'cancelled', 'policy_denied', 'failed', 'expired'],

  // Validation re-resolves the workflow, its certification and its plan digest.
  validating: ['ready', 'policy_denied', 'failed', 'cancelled', 'expired'],

  // Admitted, cursor placed on the start node, nothing executed. `paused` is
  // reachable so an operator can hold a run before it spends anything.
  ready: ['running', 'paused', 'cancelled', 'failed', 'expired', 'policy_denied'],

  running: [
    // A SELF EDGE, and only the engine's internal `step` can take it. A
    // condition node evaluates, moves the cursor to one of its two branches and
    // writes a checkpoint — the run's STATE did not change, but its durable
    // position did, and every durable position change goes through one
    // versioned write. No caller operation can drive this: `resume` starts only
    // from `paused` and `start` only from the pre-execution states, so the
    // source table refuses all of them.
    'running',
    'waiting_for_agent',
    'waiting_for_branches',
    'waiting_for_approval',
    'paused',
    'completed',
    'failed',
    'cancelled',
    'expired',
    'policy_denied',
  ],

  // A child agent run is in flight. `running` is how a finished node returns.
  waiting_for_agent: ['running', 'paused', 'failed', 'cancelled', 'expired', 'policy_denied'],

  // A person has been asked and has not answered (AI-01 Batch 3B, Part 5).
  //
  // NOTE WHAT IS ABSENT: `paused`. Batch 3A refused to let its own approval gate
  // be paused, and the reasoning holds here unchanged — an approval gate that is
  // paused strands a decision nobody can then act on. The `paused` row below
  // explains why the same argument does NOT apply to `waiting_for_agent`, and
  // the two rows disagreeing is the whole point: one wait resolves by driving
  // something, the other resolves only when a human decides.
  //
  // Absent for a second reason too. The approval is BOUND to the run version the
  // park produced — see `contracts/approval.ts` — so a pause would bump that
  // version and make the pending decision unspendable the moment it was granted.
  // Refusing the transition is honest; permitting it and then failing the
  // approval would be a bypass that looked like a bug.
  //
  // `running` is how a spent approval returns. `cancelled` is always available,
  // and it is the explicit escape path for a decision nobody is going to make.
  waiting_for_approval: ['running', 'failed', 'cancelled', 'expired', 'policy_denied'],

  // One or more branches of a parallel step are in flight (Part 4).
  //
  // A SELF EDGE, like `running`'s and for the same reason: one branch making
  // progress changes the run's durable state — a branch cursor moved, a branch
  // output was stored, a checkpoint was written — while the run as a whole is
  // still waiting on the rest. Every one of those changes is a versioned write,
  // and the state it writes is the one the run is already in.
  //
  // `running` is how a FIRED JOIN returns: the merge is the point at which the
  // several lines of execution become one again.
  //
  // There is no edge to `waiting_for_approval` here, and its absence is a
  // deliberate consequence of where a branch approval lives: when a node inside
  // a branch parks on a human, the BRANCH takes the waiting state and the run
  // stays `waiting_for_branches`, because its other branches are still moving.
  // See `contracts/parallel.ts`.
  waiting_for_branches: [
    'waiting_for_branches',
    'running',
    'paused',
    'failed',
    'cancelled',
    'expired',
    'policy_denied',
  ],

  // Pausing from `waiting_for_agent` is SAFE in a way it is not from
  // `waiting_for_approval`, and the difference is worth stating.
  // An approval gate that is paused strands a decision nobody can then act on. A
  // paused workflow strands nothing: the child agent run is a durable record
  // with its own state, `pendingNode` still points at it, and resuming re-polls
  // it. Nothing is lost by stopping, so nothing has to be forbidden.
  //
  // `waiting_for_branches` is reachable from here so a paused fan-out resumes
  // into the state it was actually in. Resuming a group of in-flight branches
  // into plain `running` would put the cursor back on the parallel node, and
  // the parallel node's job is to OPEN a group — which would be refused as a
  // duplicate, correctly, and would strand the run.
  paused: ['running', 'waiting_for_branches', 'cancelled', 'expired', 'failed'],

  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
  policy_denied: [],
};

/**
 * Which operation may drive which transition.
 *
 * Without this table `cancel` could be used to complete a run, since
 * `running → completed` is a legal edge. The operation is what distinguishes
 * "the last node finished" from "an operator stopped it", and both are edges
 * out of `running`.
 */
export const OPERATION_TARGETS: Readonly<
  Record<WorkflowRunOperation, readonly WorkflowRunState[]>
> = {
  start: ['validating', 'ready', 'running'],
  pause: ['paused'],
  // Two targets, because a resumed run returns to the state it was paused in.
  // See the `paused` row of TRANSITIONS for why a fan-out must not resume into
  // plain `running`.
  resume: ['running', 'waiting_for_branches'],
  cancel: ['cancelled'],
  expire: ['expired'],
  complete: ['completed'],
  fail: ['failed', 'policy_denied'],
};

/**
 * Which states each operation may be applied FROM.
 *
 * `step` is absent by design: it is the engine's own internal driver, it never
 * originates with a caller, and it is already constrained by `TRANSITIONS`.
 */
export const OPERATION_SOURCES: Readonly<
  Record<WorkflowRunOperation, readonly WorkflowRunState[]>
> = {
  start: ['created', 'validating', 'ready'],
  // `waiting_for_approval` IS ABSENT, and this is the row that enforces it. The
  // target table alone would not: `pause` may only produce `paused`, and
  // `waiting_for_approval → paused` is already refused by TRANSITIONS — but a
  // reader looking for "may an operator pause a run that is waiting on a human"
  // should find the answer in the table named after the question. Two refusals
  // for one rule is the difference between "we noticed" and "we prevented".
  pause: ['ready', 'running', 'waiting_for_agent', 'waiting_for_branches'],
  // `waiting_for_approval` is absent here too, and for the sharper reason: a
  // run in that state is not paused, so there is nothing to resume. `resume`
  // starting from an approval wait would be the bypass this part exists to
  // prevent — an operator releasing a run past a decision by naming a control
  // operation instead of making the decision.
  resume: ['paused'],
  // Cancellation is always available while a run is alive. An operator must be
  // able to stop anything — it is the one escape that is always correct, and it
  // is THE escape from an approval nobody is going to decide.
  cancel: [
    'created',
    'validating',
    'ready',
    'running',
    'waiting_for_agent',
    'waiting_for_branches',
    'waiting_for_approval',
    'paused',
  ],
  expire: [
    'created',
    'validating',
    'ready',
    'running',
    'waiting_for_agent',
    'waiting_for_branches',
    'waiting_for_approval',
    'paused',
  ],
  // Only a run that is between nodes may complete. A run in `waiting_for_agent`,
  // `waiting_for_branches` or `waiting_for_approval` has work or a decision
  // outstanding, and completing it there would abandon that while reporting
  // success.
  complete: ['running'],
  fail: [
    'created',
    'validating',
    'ready',
    'running',
    'waiting_for_agent',
    'waiting_for_branches',
    'waiting_for_approval',
    'paused',
  ],
};

export function canTransition(from: WorkflowRunState, to: WorkflowRunState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** May this operation be applied to a run in this state at all? */
export function canOperateFrom(
  operation: WorkflowRunOperation,
  from: WorkflowRunState,
): boolean {
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
  readonly from: WorkflowRunState;
  readonly to: WorkflowRunState;
  readonly operation: WorkflowRunOperation | 'step';
  readonly currentVersion: number;
  readonly expectedVersion: number;
  readonly workflowRunId: string;
}): void {
  const { from, to, operation, currentVersion, expectedVersion, workflowRunId } = options;

  if (currentVersion !== expectedVersion) {
    throw workflowFailure('stale_workflow_version', 'This run has changed since it was read.', {
      workflowRunId,
      diagnostics: `expected version ${expectedVersion}, current ${currentVersion}`,
    });
  }

  if (isTerminalWorkflowState(from)) {
    throw workflowFailure('workflow_invalid_transition', 'This run has already finished.', {
      workflowRunId,
      diagnostics: `terminal state ${from} cannot move to ${to}`,
    });
  }

  if (!canTransition(from, to)) {
    throw workflowFailure('workflow_invalid_transition', 'That is not a valid change for this run.', {
      workflowRunId,
      diagnostics: `no transition ${from} → ${to}`,
    });
  }

  if (operation !== 'step') {
    // Source first: "you may not do that to a run in this state" is a more
    // useful refusal than "that outcome is not available to you".
    if (!canOperateFrom(operation, from)) {
      throw workflowFailure(
        'workflow_invalid_transition',
        'That operation cannot be applied to this run now.',
        {
          workflowRunId,
          diagnostics: `operation ${operation} may not be applied from ${from}`,
        },
      );
    }
    if (!OPERATION_TARGETS[operation].includes(to)) {
      throw workflowFailure(
        'workflow_invalid_transition',
        'That operation cannot produce this outcome.',
        {
          workflowRunId,
          diagnostics: `operation ${operation} may not drive ${from} → ${to}`,
        },
      );
    }
  }
}

/**
 * States an operator-initiated pause is meaningful from.
 *
 * This list and `OPERATION_SOURCES.pause` must agree, and the state machine
 * suite asserts that they do — two lists of the same fact is one place for them
 * to drift, so the drift is what is tested.
 */
export const PAUSABLE_STATES: readonly WorkflowRunState[] = [
  'ready',
  'running',
  'waiting_for_agent',
  'waiting_for_branches',
];

/** States a run is considered "in flight" for operational reporting. */
export const ACTIVE_WORKFLOW_STATES: readonly WorkflowRunState[] = [
  'created',
  'validating',
  'ready',
  'running',
  'waiting_for_agent',
  'waiting_for_branches',
  'waiting_for_approval',
];

/**
 * States in which the thing a run is waiting for is A PERSON.
 *
 * One member today, and it is a list rather than a comparison so an operator
 * surface can ask "which of my runs are waiting on us" without knowing which
 * states currently mean that.
 */
export const AWAITING_HUMAN_WORKFLOW_STATES: readonly WorkflowRunState[] = [
  'waiting_for_approval',
];
