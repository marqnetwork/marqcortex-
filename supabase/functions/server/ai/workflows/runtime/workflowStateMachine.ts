/**
 * The workflow run state machine (AI-01 Batch 3B).
 *
 * THE SAME THREE-TABLE SHAPE `agents/runtime/stateMachine.ts` USES, and for the
 * same reasons — including the reason the third table exists at all, which was
 * found by an independent review of Batch 3A rather than designed in.
 *
 *   TRANSITIONS      which states a run may move to.
 *   OPERATION_TARGETS which outcomes an operation may produce.
 *   OPERATION_SOURCES which states an operation may be applied FROM.
 *
 * The first two are not enough. `running → paused` is a legal edge and `pause`
 * may produce `paused`, but that does not mean `pause` should be applicable to a
 * run sitting in `waiting_for_approval`: doing so loses the gate and strands the
 * decision, which is exactly the defect the agent state machine was remediated
 * for. `waiting_for_approval` therefore appears in no operation's source list
 * except `approve`, `reject`, `cancel` and `expire`.
 *
 * TERMINAL MEANS TERMINAL. The six terminal states have no outgoing edges. A
 * finished workflow run is evidence, and there is no operation that reopens one
 * — a re-run is a NEW run, with a new id, against the same definition.
 *
 * `wave` IS THE ORCHESTRATOR'S OWN DRIVER, the workflow equivalent of the agent
 * machine's `step`. It never originates with a caller and is constrained by
 * `TRANSITIONS` alone.
 */

import type { WorkflowRunOperation, WorkflowRunState } from '../contracts/runtime.ts';
import { isTerminalWorkflowState } from '../contracts/runtime.ts';
import { workflowFailure } from '../contracts/failures.ts';

export const WORKFLOW_TRANSITIONS: Readonly<
  Record<WorkflowRunState, readonly WorkflowRunState[]>
> = {
  // A created run has done nothing. The only forward move is planning; it can
  // still be cancelled or denied before the plan is built.
  created: ['planning', 'cancelled', 'policy_denied', 'failed', 'expired'],

  // Planning resolves the definition, its certification and its plan digest.
  planning: ['planned', 'policy_denied', 'failed', 'cancelled', 'expired'],

  planned: [
    'running',
    'policy_denied',
    'budget_exhausted',
    'failed',
    'cancelled',
    'expired',
  ],

  running: [
    'waiting_for_agent',
    'waiting_for_approval',
    'paused',
    'completed',
    'failed',
    'cancelled',
    'expired',
    'budget_exhausted',
    'policy_denied',
  ],

  // A wave whose agent runs have not finished. The orchestrator returns here
  // rather than blocking an HTTP request on work that may take minutes.
  waiting_for_agent: [
    'running',
    'paused',
    'failed',
    'cancelled',
    'expired',
    'budget_exhausted',
    'policy_denied',
  ],

  // An approval decision releases or ends the run. NOTHING else moves it,
  // except a cancellation or its deadline. `paused` is deliberately absent —
  // see the module note.
  waiting_for_approval: ['running', 'failed', 'cancelled', 'expired', 'policy_denied'],

  paused: ['running', 'cancelled', 'expired', 'failed'],

  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
  budget_exhausted: [],
  policy_denied: [],
};

export const WORKFLOW_OPERATION_TARGETS: Readonly<
  Record<WorkflowRunOperation, readonly WorkflowRunState[]>
> = {
  start: ['planning', 'planned', 'running'],
  pause: ['paused'],
  resume: ['running'],
  cancel: ['cancelled'],
  approve: ['running'],
  reject: ['failed', 'cancelled'],
  expire: ['expired'],
  complete: ['completed'],
  fail: ['failed', 'policy_denied', 'budget_exhausted'],
};

export const WORKFLOW_OPERATION_SOURCES: Readonly<
  Record<WorkflowRunOperation, readonly WorkflowRunState[]>
> = {
  start: ['created', 'planning', 'planned'],
  // Deliberately NOT `waiting_for_approval`: pausing a run that is waiting on a
  // human loses the gate and strands the decision.
  pause: ['running', 'waiting_for_agent'],
  resume: ['paused'],
  // Cancellation is always available while a run is alive. An operator must be
  // able to stop anything, including a plan waiting on an approval nobody will
  // give — it is the one escape that is always correct.
  cancel: [
    'created',
    'planning',
    'planned',
    'running',
    'waiting_for_agent',
    'waiting_for_approval',
    'paused',
  ],
  approve: ['waiting_for_approval'],
  reject: ['waiting_for_approval'],
  expire: [
    'created',
    'planning',
    'planned',
    'running',
    'waiting_for_agent',
    'waiting_for_approval',
    'paused',
  ],
  complete: ['running'],
  fail: [
    'created',
    'planning',
    'planned',
    'running',
    'waiting_for_agent',
    'waiting_for_approval',
    'paused',
  ],
};

export function canTransitionWorkflow(
  from: WorkflowRunState,
  to: WorkflowRunState,
): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}

/** May this operation be applied to a run in this state at all? */
export function canOperateWorkflowFrom(
  operation: WorkflowRunOperation,
  from: WorkflowRunState,
): boolean {
  return WORKFLOW_OPERATION_SOURCES[operation].includes(from);
}

/**
 * Enforce a transition, or throw a typed failure.
 *
 * `expectedVersion` is checked here as well as in the store. Two checks against
 * the same version is not redundancy: it is the difference between noticing a
 * lost race after computing a new record from stale state, and refusing before.
 */
export function assertWorkflowTransition(options: {
  readonly from: WorkflowRunState;
  readonly to: WorkflowRunState;
  readonly operation: WorkflowRunOperation | 'wave';
  readonly currentVersion: number;
  readonly expectedVersion: number;
  readonly workflowRunId: string;
}): void {
  const { from, to, operation, currentVersion, expectedVersion, workflowRunId } = options;

  if (currentVersion !== expectedVersion) {
    throw workflowFailure('stale_workflow_version', 'This workflow run has changed since it was read.', {
      workflowRunId,
      diagnostics: `expected version ${expectedVersion}, current ${currentVersion}`,
    });
  }

  if (isTerminalWorkflowState(from)) {
    throw workflowFailure('invalid_workflow_transition', 'This workflow run has already finished.', {
      workflowRunId,
      diagnostics: `terminal state ${from} cannot move to ${to}`,
    });
  }

  if (!canTransitionWorkflow(from, to)) {
    throw workflowFailure('invalid_workflow_transition', 'That is not a valid change for this run.', {
      workflowRunId,
      diagnostics: `no transition ${from} → ${to}`,
    });
  }

  if (operation !== 'wave') {
    if (!canOperateWorkflowFrom(operation, from)) {
      throw workflowFailure(
        'invalid_workflow_transition',
        'That operation cannot be applied to this run now.',
        { workflowRunId, diagnostics: `operation ${operation} may not be applied from ${from}` },
      );
    }
    if (!WORKFLOW_OPERATION_TARGETS[operation].includes(to)) {
      throw workflowFailure(
        'invalid_workflow_transition',
        'That operation cannot produce this outcome.',
        { workflowRunId, diagnostics: `operation ${operation} may not drive ${from} → ${to}` },
      );
    }
  }
}

/**
 * States an operator-initiated pause is meaningful from.
 *
 * Must agree with `WORKFLOW_OPERATION_SOURCES.pause`, and the state machine
 * suite asserts that it does — two lists that must agree and are not checked are
 * two lists that will eventually disagree.
 */
export const WORKFLOW_PAUSABLE_STATES: readonly WorkflowRunState[] = [
  'running',
  'waiting_for_agent',
];

/** States a workflow run is considered "in flight" for operational reporting. */
export const WORKFLOW_ACTIVE_STATES: readonly WorkflowRunState[] = [
  'created',
  'planning',
  'planned',
  'running',
  'waiting_for_agent',
];
