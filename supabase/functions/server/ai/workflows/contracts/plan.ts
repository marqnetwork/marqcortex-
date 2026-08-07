/**
 * Workflow execution plan contracts (AI-01 Batch 3B, Parts 1 and 3).
 *
 * A plan is the planner's answer to "if this workflow ran, what would it be
 * able to do?" — computed once, from the definition alone, before anything runs.
 *
 * WHY A PLAN IS A VALUE AND NOT A TRAVERSAL.
 *
 * The alternative is an executor that walks the edges as it goes. That works
 * until someone asks a question no walking executor can answer: is this
 * workflow finite? does it reach every node? does every loop have a way out? is
 * what is about to run the same thing that was reviewed? A plan is a value, so
 * it can be digested, stored, compared, shown to a reviewer and asserted on in
 * a test — and the run the engine executes can be required to match the plan
 * that was approved.
 *
 * ── WHAT PART 3 CHANGED ────────────────────────────────────────────────────
 *
 * Part 1's plan was a chain and its `steps` were an execution order: node 0,
 * then node 1, then node 2. With conditions and loops there IS no static
 * execution order — which node runs third depends on data that does not exist
 * at planning time.
 *
 * So `steps` is now an ENUMERATION, not an itinerary: every node the plan
 * contains, in a deterministic breadth-first order from the start node, each
 * carrying its own successors. The engine navigates by asking a step for its
 * next node; it never advances by incrementing an index. `index` and `depth`
 * remain meaningful — they are stable identities and shortest-distance facts —
 * but neither is a promise about when a node runs, and nothing reads them as one.
 *
 * ── WHAT PART 4 CHANGED ────────────────────────────────────────────────────
 *
 * A step may now have SEVERAL successors that are all taken. `parallel` carries
 * its branches — each with a name, an ordinal and the body of nodes a branch
 * cursor walks — and `join` carries the policy and the merge contract. Both are
 * resolved at planning, so the engine never re-derives a branch body, a merge
 * order or a fan-out ceiling from the graph while a run is in flight.
 *
 * ── WHAT PART 5 CHANGED ────────────────────────────────────────────────────
 *
 * A step may now be an APPROVAL — a barrier resolved at planning, carrying the
 * roles that may answer it, the deadline and what a refusal does. And an agent
 * step carries a resolved `retryPolicy` beside the `maxAttempts` it has always
 * carried, so the engine reads what a reviewer approved rather than deriving a
 * backoff from a definition mid-run.
 *
 * `metadata.maxAgentInvocations` becomes a real forecast at the same moment:
 * it has always multiplied each node's attempt ceiling through its loops, and
 * until Part 5 that ceiling was never spent. It is now.
 *
 * A PLAN CONTAINS NO RUN. No run id, no organization, no timestamp, no input,
 * no state and no cursor. A plan is a function of the definition and nothing
 * else, which is precisely what makes `digest` stable: the same definition
 * plans to the same digest on every instance, in every region, on every deploy.
 */

import type { WorkflowExpression } from './expression.ts';
import type { WorkflowMapping } from './mapping.ts';
import type { WorkflowJoinPolicy, WorkflowParallelFailurePolicy } from './parallel.ts';
import type { WorkflowRejectionPolicy } from './approval.ts';
import type { WorkflowRetryPolicy } from './retry.ts';
import type { Validator } from '../../security/validation.ts';

interface WorkflowPlanStepBase {
  /** Stable position in the plan enumeration, starting at zero. */
  readonly index: number;
  readonly nodeId: string;
  readonly displayName: string;
  /** Shortest distance in edges from the start node. Not an execution order. */
  readonly depth: number;
  /** True when this node has no successors and a run reaching it is finished. */
  readonly terminal: boolean;
  /**
   * Set when a declared loop edge returns to this node. Carrying the ceiling on
   * the loop HEADER rather than only on the edge means the engine can answer
   * "how many more times may this node be entered" without re-deriving the
   * graph on every iteration.
   */
  readonly loop?: WorkflowPlanLoop;
}

export interface WorkflowPlanLoop {
  readonly maxIterations: number;
  /** The node the back edge leaves from. Names the loop for an operator. */
  readonly fromNodeId: string;
  /** Nodes inside the loop body, sorted. Every one is re-entered per pass. */
  readonly bodyNodeIds: readonly string[];
}

export interface WorkflowAgentPlanStep extends WorkflowPlanStepBase {
  readonly kind: 'agent';
  readonly agentId: string;
  readonly maxAttempts: number;
  /**
   * Resolved at planning, never re-derived mid-run (AI-01 Batch 3B, Part 5).
   *
   * A node that declared no policy gets `DEFAULT_WORKFLOW_RETRY_POLICY` here,
   * so the engine reads one shape rather than branching on absence at every
   * failure — and so the digest records which policy a reviewer approved.
   */
  readonly retryPolicy: WorkflowRetryPolicy;
  readonly inputMapping?: WorkflowMapping;
  readonly inputContract?: Validator<unknown>;
  readonly outputMapping?: WorkflowMapping;
  readonly outputContract?: Validator<unknown>;
  /** The single successor. Absent on a terminal node. */
  readonly nextNodeId?: string;
}

export interface WorkflowConditionPlanStep extends WorkflowPlanStepBase {
  readonly kind: 'condition';
  readonly expression: WorkflowExpression;
  /** Where a true evaluation goes. Always present — validation guarantees it. */
  readonly trueNodeId: string;
  readonly falseNodeId: string;
}

/** One branch of a parallel plan step, resolved and ordered. */
export interface WorkflowPlanBranch {
  readonly branchName: string;
  readonly startNodeId: string;
  /** Declaration order. THE merge order — see `contracts/parallel.ts`. */
  readonly ordinal: number;
  /**
   * The nodes this branch owns, in the order a cursor walks them from the head.
   *
   * Resolved once, at planning, so the engine never re-derives a branch body at
   * runtime. It is also what makes a branch's work countable before anything
   * runs: `metadata.maxAgentInvocations` accounts for it.
   */
  readonly bodyNodeIds: readonly string[];
}

export interface WorkflowParallelPlanStep extends WorkflowPlanStepBase {
  readonly kind: 'parallel';
  readonly branches: readonly WorkflowPlanBranch[];
  readonly joinNodeId: string;
  /** Resolved from the join node, so the engine reads one step for both halves. */
  readonly joinPolicy: WorkflowJoinPolicy;
  readonly failurePolicy: WorkflowParallelFailurePolicy;
  /**
   * The effective ceiling: the tightest of the platform bound, the workflow's
   * own and the node's own, resolved once at planning so the engine enforces a
   * number it did not have to derive.
   */
  readonly maximumParallelBranches: number;
}

export interface WorkflowJoinPlanStep extends WorkflowPlanStepBase {
  readonly kind: 'join';
  readonly policy: WorkflowJoinPolicy;
  readonly mergeContract: Validator<unknown>;
  /** The parallel node that owns this join. Exactly one, guaranteed by validation. */
  readonly parallelNodeId: string;
  /** Branch names in merge order. A convenience copy of the parallel step's order. */
  readonly branchNames: readonly string[];
  /** The single successor. Absent on a terminal join. */
  readonly nextNodeId?: string;
}

/**
 * An approval barrier, resolved (AI-01 Batch 3B, Part 5).
 *
 * Everything the engine needs to park a run and everything the gate needs to
 * write the approval record, read from ONE step. The alternative — resolving
 * the approver roles or the expiry from the registry when the decision arrives
 * — would mean a definition edited while a request was pending could widen who
 * may answer it or extend how long they have.
 */
export interface WorkflowApprovalPlanStep extends WorkflowPlanStepBase {
  readonly kind: 'approval';
  readonly approverRoles: readonly string[];
  readonly reason: string;
  readonly impactSummary: string;
  readonly expiresAfterMs: number;
  readonly onRejection: WorkflowRejectionPolicy;
  /** Placeholders, forwarded unchanged. See `contracts/approval.ts`. */
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
  /** The single successor. Absent on a terminal approval. */
  readonly nextNodeId?: string;
}

export type WorkflowPlanStep =
  | WorkflowAgentPlanStep
  | WorkflowConditionPlanStep
  | WorkflowParallelPlanStep
  | WorkflowJoinPlanStep
  | WorkflowApprovalPlanStep;

export function isAgentStep(step: WorkflowPlanStep): step is WorkflowAgentPlanStep {
  return step.kind === 'agent';
}

export function isConditionStep(step: WorkflowPlanStep): step is WorkflowConditionPlanStep {
  return step.kind === 'condition';
}

export function isParallelStep(step: WorkflowPlanStep): step is WorkflowParallelPlanStep {
  return step.kind === 'parallel';
}

export function isJoinStep(step: WorkflowPlanStep): step is WorkflowJoinPlanStep {
  return step.kind === 'join';
}

export function isApprovalStep(step: WorkflowPlanStep): step is WorkflowApprovalPlanStep {
  return step.kind === 'approval';
}

/**
 * Facts derived from the plan, computed once so no consumer has to re-derive
 * them — and so a reviewer reads the same numbers the planner used.
 */
export interface WorkflowPlanMetadata {
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** Nodes the plan contains. Equal to `nodeCount` when nothing is orphaned. */
  readonly stepCount: number;
  readonly agentNodeCount: number;
  readonly conditionNodeCount: number;
  readonly parallelNodeCount: number;
  readonly joinNodeCount: number;
  readonly approvalNodeCount: number;
  /** The widest fan-out any parallel step declares. Zero when there is none. */
  readonly maxBranchCount: number;
  /** Edges on the longest shortest-path from the start node. */
  readonly depth: number;
  /** Distinct agents the plan names, sorted. */
  readonly agentIds: readonly string[];
  readonly distinctAgentCount: number;
  readonly startNodeId: string;
  /** Nodes the plan can finish on. */
  readonly terminalNodeIds: readonly string[];
  readonly loopCount: number;
  /**
   * Worst-case agent invocations: every node's attempt ceiling, multiplied
   * through the loops that contain it. The ceiling Part 4's scheduler has to be
   * sized for, known before anything runs.
   */
  readonly maxAgentInvocations: number;
}

export interface WorkflowPlan {
  readonly workflowId: string;
  readonly version: string;
  readonly startNodeId: string;
  readonly steps: readonly WorkflowPlanStep[];
  readonly metadata: WorkflowPlanMetadata;
  /**
   * Stable identity of the plan's execution shape. Full-length SHA-256 hex of
   * a canonical projection — see `planner/planDigest.ts` for what is and is not
   * inside it, and why.
   */
  readonly digest: string;
}

/**
 * The planner's non-throwing result.
 *
 * Failure carries EVERY problem found, not the first: a graph with four
 * mistakes should be fixed once and not four times. The messages are
 * server-side diagnostics — they name node ids and cycle paths — and the
 * throwing entry point is what turns them into a caller-safe failure.
 */
export type WorkflowPlanResult =
  | { readonly ok: true; readonly plan: WorkflowPlan }
  | { readonly ok: false; readonly problems: readonly string[] };
