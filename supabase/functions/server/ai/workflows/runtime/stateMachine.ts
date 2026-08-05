/**
 * The workflow run state machine (AI-01 Batch 3B).
 *
 * ONE TABLE. Every legal move a run can make is an entry in `TRANSITIONS`, and
 * every state change in the engine goes through `assertWorkflowTransition`.
 * There is no code path anywhere that assigns a state directly — the
 * orchestrator asks this module, and the store refuses a write whose version is
 * stale.
 *
 * WHY A TABLE RATHER THAN GUARDS AT THE CALL SITES.
 *
 * A workflow run has nineteen states and ten operations. Expressed as `if`
 * statements at the places that change state, that is nearly two hundred
 * implicit decisions spread across the engine, and the ones nobody wrote are
 * the interesting ones: can a cancelled run be approved? can a run waiting on a
 * join be paused? A table answers all of them at once and is reviewable in one
 * screen.
 *
 * THREE TABLES, NOT ONE, and the third is the one whose absence produced a real
 * defect in Batch 3A. `TRANSITIONS` says an edge exists. `OPERATION_TARGETS`
 * says which operation may produce a given outcome. `OPERATION_SOURCES` says
 * where an operation may START — without it, `resume` could drive
 * `waiting_for_approval → running`, an edge that exists, to a target `resume`
 * may produce, from a state `resume` has no business touching. That combination
 * stranded agent runs holding an approval nobody could then decide, and the
 * same shape is available here. It is closed the same way.
 *
 * TERMINAL MEANS TERMINAL. The six terminal states have no outgoing edges, so
 * "retry a failed run" cannot be a transition — it FORKS a new run carrying
 * `parentWorkflowRunId`. A completed run's record is evidence, and evidence
 * that can be reopened and rewritten is not evidence.
 */

import type { WorkflowRunOperation, WorkflowRunState } from '../contracts/runtime.ts';
import { isTerminalWorkflowState } from '../contracts/runtime.ts';
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
  // workflow is disabled between creation and the first node).
  created: ['validating', 'cancelled', 'policy_denied', 'failed', 'expired'],

  // Validation resolves the definition, its certification and the input
  // contract. Planning is next.
  validating: ['planned', 'policy_denied', 'failed', 'cancelled', 'expired'],

  // Planned means the graph compiled and its worst case fits the platform
  // bounds. The token and cost preflight runs on the way to `ready`.
  planned: ['ready', 'policy_denied', 'budget_exhausted', 'failed', 'cancelled', 'expired'],

  ready: ['running', 'budget_exhausted', 'paused', 'policy_denied', 'failed', 'cancelled', 'expired'],

  running: [
    'waiting_for_agent',
    'waiting_for_tool',
    'waiting_for_model',
    'waiting_for_parallel',
    'waiting_for_join',
    'waiting_for_approval',
    'paused',
    'retrying',
    'completed',
    'failed',
    'cancelled',
    'expired',
    'budget_exhausted',
    'policy_denied',
  ],

  waiting_for_agent: [
    'running',
    'retrying',
    'paused',
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
  waiting_for_model: [
    'running',
    'retrying',
    'paused',
    'waiting_for_approval',
    'failed',
    'cancelled',
    'expired',
    'budget_exhausted',
    'policy_denied',
  ],
  waiting_for_parallel: [
    'running',
    'waiting_for_join',
    'waiting_for_approval',
    'waiting_for_model',
    'waiting_for_tool',
    'waiting_for_agent',
    'paused',
    'failed',
    'cancelled',
    'expired',
    'budget_exhausted',
    'policy_denied',
  ],
  waiting_for_join: [
    'running',
    'waiting_for_parallel',
    'paused',
    'failed',
    'cancelled',
    'expired',
    'policy_denied',
  ],

  // An approval decision resumes (`running`) or ends the run. NOTHING ELSE
  // moves a run out of here except cancelling it or its deadline.
  //
  // `paused` is deliberately absent. `pause` and `resume` are ordinary control
  // operations available to any operator, and either one leaving this state
  // with the approval undecided would strand the run holding an action nobody
  // could authorise — the exact defect an independent review found in the agent
  // runtime. See `OPERATION_SOURCES` for the other half.
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
 * Without this table `cancel` could be used to complete a run, since
 * `running → completed` is a legal edge. The operation is what distinguishes
 * "the workflow finished" from "an operator stopped it", and both end up as
 * edges out of `running`.
 */
export const OPERATION_TARGETS: Readonly<Record<WorkflowRunOperation, readonly WorkflowRunState[]>> =
  {
    start: ['validating', 'planned', 'ready', 'running'],
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

/** Which states each operation may be applied FROM. */
export const OPERATION_SOURCES: Readonly<Record<WorkflowRunOperation, readonly WorkflowRunState[]>> =
  {
    start: ['created', 'validating', 'planned', 'ready'],
    // Deliberately NOT `waiting_for_approval`: pausing a run that is waiting on
    // a human loses the gate and strands the decision.
    pause: [
      'ready',
      'running',
      'waiting_for_agent',
      'waiting_for_tool',
      'waiting_for_model',
      'waiting_for_parallel',
      'waiting_for_join',
    ],
    resume: ['paused'],
    // Cancellation is always available while a run is alive. An operator must be
    // able to stop anything, including a run waiting on an approval nobody will
    // give — it is the one escape that is always correct.
    cancel: [
      'created',
      'validating',
      'planned',
      'ready',
      'running',
      'waiting_for_agent',
      'waiting_for_tool',
      'waiting_for_model',
      'waiting_for_parallel',
      'waiting_for_join',
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
      'ready',
      'running',
      'waiting_for_agent',
      'waiting_for_tool',
      'waiting_for_model',
      'waiting_for_parallel',
      'waiting_for_join',
      'waiting_for_approval',
      'paused',
      'retrying',
    ],
    complete: ['running'],
    fail: [
      'created',
      'validating',
      'planned',
      'ready',
      'running',
      'waiting_for_agent',
      'waiting_for_tool',
      'waiting_for_model',
      'waiting_for_parallel',
      'waiting_for_join',
      'waiting_for_approval',
      'paused',
      'retrying',
    ],
  };

export function canTransition(from: WorkflowRunState, to: WorkflowRunState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** May this operation be applied to a run in this state at all? */
export function canOperateFrom(operation: WorkflowRunOperation, from: WorkflowRunState): boolean {
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
export function assertWorkflowTransition(options: {
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
    throw workflowFailure('invalid_transition', 'This run has already finished.', {
      workflowRunId,
      diagnostics: `terminal state ${from} cannot move to ${to}`,
    });
  }

  if (!canTransition(from, to)) {
    throw workflowFailure('invalid_transition', 'That is not a valid change for this run.', {
      workflowRunId,
      diagnostics: `no transition ${from} → ${to}`,
    });
  }

  if (operation !== 'step') {
    // Source first: "you may not do that to a run in this state" is a more
    // useful refusal than "that outcome is not available to you", and it is the
    // check whose absence stranded approval-waiting runs in Batch 3A.
    if (!canOperateFrom(operation, from)) {
      throw workflowFailure(
        'invalid_transition',
        'That operation cannot be applied to this run now.',
        {
          workflowRunId,
          diagnostics: `operation ${operation} may not be applied from ${from}`,
        },
      );
    }
    if (!OPERATION_TARGETS[operation].includes(to)) {
      throw workflowFailure('invalid_transition', 'That operation cannot produce this outcome.', {
        workflowRunId,
        diagnostics: `operation ${operation} may not drive ${from} → ${to}`,
      });
    }
  }
}

/**
 * States an operator-initiated pause is meaningful from.
 *
 * `waiting_for_approval` is deliberately absent — see `OPERATION_SOURCES`. This
 * list and `OPERATION_SOURCES.pause` must agree, and the state machine suite
 * asserts that they do.
 */
export const PAUSABLE_STATES: readonly WorkflowRunState[] = [
  'ready',
  'running',
  'waiting_for_agent',
  'waiting_for_tool',
  'waiting_for_model',
  'waiting_for_parallel',
  'waiting_for_join',
];

/** States a run is considered "in flight" for operational reporting. */
export const ACTIVE_WORKFLOW_STATES: readonly WorkflowRunState[] = [
  'created',
  'validating',
  'planned',
  'ready',
  'running',
  'waiting_for_agent',
  'waiting_for_tool',
  'waiting_for_model',
  'waiting_for_parallel',
  'waiting_for_join',
  'retrying',
];

/** States that ended badly. Grouped so a console can count them in one pass. */
export const FAILED_WORKFLOW_STATES: readonly WorkflowRunState[] = [
  'failed',
  'expired',
  'budget_exhausted',
  'policy_denied',
];
