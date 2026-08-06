/**
 * Workflow execution plan contracts (AI-01 Batch 3B, Part 1).
 *
 * A plan is the planner's answer to "if this workflow ran, in what order would
 * its nodes be reached?" — computed once, from the definition alone, before
 * anything runs.
 *
 * WHY A PLAN IS A VALUE AND NOT A TRAVERSAL.
 *
 * The alternative is an executor that walks the edges as it goes. That works
 * until someone asks a question no walking executor can answer: is this
 * workflow finite? does it reach every node? is what is about to run the same
 * thing that was reviewed? A plan is a value, so it can be digested, stored,
 * compared, shown to a reviewer and asserted on in a test — and the run that
 * Part 2 executes can be required to match the plan that was approved.
 *
 * A PLAN CONTAINS NO RUN.
 *
 * No run id, no organization, no timestamp, no input, no state and no cursor.
 * A plan is a function of the definition and nothing else, which is precisely
 * what makes `digest` stable: the same definition plans to the same digest on
 * every instance, in every region, on every deploy.
 */

import type { WorkflowNodeKind } from './workflow.ts';

export interface WorkflowPlanStep {
  /** Position in the plan, starting at zero. */
  readonly index: number;
  readonly nodeId: string;
  readonly kind: WorkflowNodeKind;
  readonly agentId: string;
  readonly displayName: string;
  readonly maxAttempts: number;
  /** Edges traversed from the start node to reach this one. */
  readonly depth: number;
  /** The node this step hands to. Absent on the terminal step. */
  readonly nextNodeId?: string;
  readonly terminal: boolean;
}

/**
 * Facts derived from the plan, computed once so no consumer has to re-derive
 * them — and so a reviewer reads the same numbers the planner used.
 */
export interface WorkflowPlanMetadata {
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** Steps the plan describes. Equal to `nodeCount` when nothing is orphaned. */
  readonly stepCount: number;
  /** Edges on the longest path from the start node. */
  readonly depth: number;
  /** Distinct agents the plan names, sorted. */
  readonly agentIds: readonly string[];
  readonly distinctAgentCount: number;
  readonly startNodeId: string;
  /** Nodes the plan can finish on. One, in Part 1's single-successor graphs. */
  readonly terminalNodeIds: readonly string[];
  /**
   * Upper bound on agent invocations if every node exhausts its attempts.
   * The ceiling Part 2's executor has to be sized for, known before it runs.
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
