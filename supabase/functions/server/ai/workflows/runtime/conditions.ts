/**
 * Conditions and joins (AI-01 Batch 3B).
 *
 * The two questions asked of every node before it runs:
 *
 *   HAS ITS JOIN BEEN SATISFIED? — a policy over the settled states of the
 *   nodes it depends on.
 *   DO ITS CONDITIONS HOLD? — a conjunction of comparisons against the fact map.
 *
 * BOTH ARE TOTAL FUNCTIONS OVER DATA. There is no expression parser, no
 * arithmetic, no traversal and no evaluation of anything a node produced. A
 * condition names one fact key and one operator; a join names one policy and one
 * number. That is the entire language, and its smallness is the security
 * property: a workflow definition cannot express a computation, so a workflow
 * definition cannot express an injection.
 *
 * THE THREE-VALUED ANSWER MATTERS. A node is `ready`, `blocked` or `skipped`,
 * and collapsing the last two would break the plan. `blocked` means the
 * dependencies have not settled yet and the answer may change; `skipped` means
 * they have settled in a way that means this node will never run. A wave loop
 * that could not tell them apart would either spin forever on a node that will
 * never be ready, or abandon one that simply had not started.
 */

import type {
  WorkflowCondition,
  WorkflowGuard,
  WorkflowJoin,
  WorkflowNode,
} from '../contracts/workflow.ts';
import type {
  WorkflowFactMap,
  WorkflowFactValue,
  WorkflowNodeRecord,
  WorkflowNodeState,
} from '../contracts/runtime.ts';
import { isSettledNodeState } from '../contracts/runtime.ts';

export type NodeAdmission = 'ready' | 'blocked' | 'skipped';

export interface AdmissionDecision {
  readonly admission: NodeAdmission;
  /** Caller-safe explanation. Recorded on the node and in the audit trail. */
  readonly reason: string;
}

/**
 * Evaluate one condition.
 *
 * A fact that is absent makes every operator false except `absent` — including
 * the negative ones. `not_equals` against a missing fact returning true would
 * mean a guard passing because the thing it guards on never happened, which is
 * the failure mode this whole module exists to avoid.
 */
export function evaluateCondition(condition: WorkflowCondition, facts: WorkflowFactMap): boolean {
  const present = Object.prototype.hasOwnProperty.call(facts, condition.fact);
  const value: WorkflowFactValue | undefined = present ? facts[condition.fact] : undefined;

  switch (condition.operator) {
    case 'exists':
      return present;
    case 'absent':
      return !present;
    case 'equals':
      return present && value === condition.value;
    case 'not_equals':
      return present && value !== condition.value;
    case 'is_true':
      return present && value === true;
    case 'is_false':
      return present && value === false;
    case 'gte':
      return (
        present &&
        typeof value === 'number' &&
        typeof condition.value === 'number' &&
        value >= condition.value
      );
    case 'lte':
      return (
        present &&
        typeof value === 'number' &&
        typeof condition.value === 'number' &&
        value <= condition.value
      );
    default:
      // Unreachable while the operator union is exhaustive. Present so an
      // operator added to the union without a case here fails the guard rather
      // than passing it.
      return false;
  }
}

/** Every condition must hold. The first failure is the reported one. */
export function evaluateGuard(
  guard: WorkflowGuard | undefined,
  facts: WorkflowFactMap,
): { readonly passed: boolean; readonly failedOn?: string } {
  for (const condition of guard ?? []) {
    if (!evaluateCondition(condition, facts)) {
      return { passed: false, failedOn: `${condition.fact} ${condition.operator}` };
    }
  }
  return { passed: true };
}

interface JoinTally {
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly unsettled: number;
  readonly total: number;
}

function tally(
  dependsOn: readonly string[],
  states: Readonly<Record<string, WorkflowNodeState>>,
): JoinTally {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let unsettled = 0;
  for (const dependency of dependsOn) {
    const state = states[dependency];
    if (state === 'succeeded') succeeded += 1;
    else if (state === 'failed') failed += 1;
    else if (state === 'skipped') skipped += 1;
    else unsettled += 1;
  }
  return { succeeded, failed, skipped, unsettled, total: dependsOn.length };
}

/** How many successes this join needs. `all` needs every dependency. */
export function requiredSuccesses(join: WorkflowJoin, dependencyCount: number): number {
  switch (join.policy) {
    case 'any':
      return dependencyCount === 0 ? 0 : 1;
    case 'quorum':
      return Math.max(1, Math.min(dependencyCount, Math.floor(join.quorum ?? dependencyCount)));
    default:
      return dependencyCount;
  }
}

/**
 * May this node run, not yet, or never?
 *
 * The order of the checks is the policy:
 *
 *   1. A join that CAN still be satisfied and is not yet — blocked.
 *   2. A join that can NEVER be satisfied — skipped. Decided as soon as enough
 *      dependencies have failed or been skipped, rather than after waiting for
 *      the rest, because a node whose fate is already sealed should not hold a
 *      wave open.
 *   3. Conditions, evaluated only once the join is satisfied. A guard read
 *      against a half-populated fact map would be answering a different
 *      question from the one the definition asked.
 */
export function admitNode(
  node: WorkflowNode,
  states: Readonly<Record<string, WorkflowNodeState>>,
  facts: WorkflowFactMap,
): AdmissionDecision {
  const dependsOn = node.dependsOn ?? [];
  const join = node.join ?? { policy: 'all' };
  const counts = tally(dependsOn, states);
  const needed = requiredSuccesses(join, counts.total);

  if (counts.succeeded < needed) {
    // Can the remaining unsettled dependencies still get there?
    if (counts.succeeded + counts.unsettled < needed) {
      return {
        admission: 'skipped',
        reason:
          `join ${join.policy} needs ${needed} of ${counts.total}; ` +
          `${counts.succeeded} succeeded, ${counts.failed} failed, ${counts.skipped} skipped`,
      };
    }
    return {
      admission: 'blocked',
      reason: `waiting for ${needed - counts.succeeded} more of ${counts.total} dependencies`,
    };
  }

  const guard = evaluateGuard(node.when, facts);
  if (!guard.passed) {
    return {
      admission: 'skipped',
      reason: `condition not met: ${guard.failedOn ?? 'unknown'}`,
    };
  }

  return { admission: 'ready', reason: 'join satisfied and conditions hold' };
}

/** Node states as a flat map, which is what admission reads. */
export function nodeStatesOf(
  nodes: Readonly<Record<string, WorkflowNodeRecord>>,
): Readonly<Record<string, WorkflowNodeState>> {
  const states: Record<string, WorkflowNodeState> = {};
  for (const [nodeId, record] of Object.entries(nodes)) states[nodeId] = record.state;
  return states;
}

/** True when every node in the record has reached a settled state. */
export function allNodesSettled(
  nodes: Readonly<Record<string, WorkflowNodeRecord>>,
): boolean {
  return Object.values(nodes).every((node) => isSettledNodeState(node.state));
}
