/**
 * Stable plan digests (AI-01 Batch 3B, Part 1).
 *
 * The digest answers one question: is the thing about to run the same thing
 * that was reviewed? For that answer to be worth anything it has to be stable
 * across instances, regions and deploys, and it has to change when — and only
 * when — the plan's execution shape changes.
 *
 * WHAT IS INSIDE THE DIGEST.
 *
 *   workflowId, version, the start node, and for each step in plan order: its
 *   index, node id, kind, successors, and everything that decides what the node
 *   DOES — an agent node's agent id, attempt ceiling and mappings; a condition
 *   node's whole expression tree; and any loop ceiling attached to the node.
 *
 * Part 3 widened this considerably, and the principle did not change: whatever
 * can alter where a run goes or what it hands an agent is inside. A condition
 * whose operator flipped from `greater_than` to `greater_than_or_equal` is a
 * different workflow, and a reviewer who approved the first must not find the
 * second running under the same digest. The same is true of a mapping — moving
 * one field from `required: false` to `required: true` changes which runs fail.
 *
 * WHAT IS DELIBERATELY OUTSIDE IT.
 *
 *   Display names and edge labels. A workflow renamed from "Draft" to "Draft
 *   proposal" runs identically, and a digest that changed would force a review
 *   of a copy edit while telling a reviewer nothing.
 *
 *   Contract VALIDATORS. They are functions, and a function has no stable
 *   serialization — two structurally identical contracts written on different
 *   days are different objects, and a digest built over them would be unstable
 *   for no gain. What a contract accepts is enforced at runtime and reviewed as
 *   code; the digest records only whether a node declares one, so ADDING or
 *   REMOVING a contract moves the digest even though editing its body does not.
 *   That limit is stated rather than papered over.
 *
 *   Derived metadata — depth, counts, terminal nodes. Every one of them is a
 *   function of the steps that are already inside. Hashing a derivation adds no
 *   discrimination and adds a second place for the digest to drift.
 *
 *   Everything about a run. There is no run here to include, which is what
 *   makes the digest a property of the definition rather than of an execution.
 *
 * The version IS included, on purpose. A version bump is an author's explicit
 * statement that this is a different workflow, and it should invalidate a prior
 * approval even when the graph happens to be unchanged.
 *
 * Full-length SHA-256, not truncated. Batch 3A's convention is truncation where
 * values are compared and full length where a value is proved; a plan digest is
 * the second kind — it is quoted in an approval and matched against later.
 */

import type { WorkflowPlanStep } from '../contracts/plan.ts';
import { isAgentStep, isApprovalStep, isJoinStep, isParallelStep } from '../contracts/plan.ts';
import { canonicalJson, digestText } from '../../agents/runtime/digest.ts';

/**
 * The per-kind half of the projection (AI-01 Batch 3B, Part 4).
 *
 * Split out when parallel and join steps arrived, and vindicated when Part 5
 * added a fifth: several kinds inside one object literal is where a digest
 * starts quietly omitting a field of the kind added last, and a digest with a
 * hole in it is worse than no digest — it reports "unchanged" for a change.
 *
 * For a parallel step everything that decides what the fan-out DOES is inside:
 * the branch names, their order, their heads, their bodies, the join it
 * converges on, both policies and the effective ceiling. Reordering the branch
 * list changes the merge order, so it changes the digest.
 */
function stepProjection(step: WorkflowPlanStep): Record<string, unknown> {
  if (isAgentStep(step)) {
    return {
      agentId: step.agentId,
      maxAttempts: step.maxAttempts,
      // The whole policy, not its presence. Moving a node from `immediate` to
      // a ninety-second exponential backoff changes how long a run holds a
      // cursor and how much it may spend, and a reviewer who approved the first
      // must not find the second running under the same digest.
      retryPolicy: {
        backoff: step.retryPolicy.backoff,
        delayMs: step.retryPolicy.delayMs ?? null,
        maxDelayMs: step.retryPolicy.maxDelayMs ?? null,
      },
      nextNodeId: step.nextNodeId ?? null,
      inputMapping: step.inputMapping ?? null,
      outputMapping: step.outputMapping ?? null,
      // Presence only — see the header for why a validator's body is not
      // hashable and what that costs.
      hasInputContract: step.inputContract !== undefined,
      hasOutputContract: step.outputContract !== undefined,
    };
  }

  if (isParallelStep(step)) {
    return {
      joinNodeId: step.joinNodeId,
      joinPolicy: step.joinPolicy,
      failurePolicy: step.failurePolicy,
      maximumParallelBranches: step.maximumParallelBranches,
      branches: step.branches.map((branch) => ({
        branchName: branch.branchName,
        startNodeId: branch.startNodeId,
        ordinal: branch.ordinal,
        bodyNodeIds: branch.bodyNodeIds,
      })),
    };
  }

  if (isApprovalStep(step)) {
    // EVERYTHING, INCLUDING THE PROSE. `reason` and `impactSummary` are the two
    // fields a human actually reads before deciding, so changing either changes
    // what was approved — this is the one place in the digest where display
    // text is inside rather than out, and the difference from `displayName` is
    // that nobody makes a decision on the strength of a display name.
    return {
      approverRoles: [...step.approverRoles].sort(),
      reason: step.reason,
      impactSummary: step.impactSummary,
      expiresAfterMs: step.expiresAfterMs,
      onRejection: step.onRejection,
      estimatedAdditionalTokens: step.estimatedAdditionalTokens,
      estimatedAdditionalCostMicroUsd: step.estimatedAdditionalCostMicroUsd,
      nextNodeId: step.nextNodeId ?? null,
    };
  }

  if (isJoinStep(step)) {
    return {
      policy: step.policy,
      parallelNodeId: step.parallelNodeId,
      branchNames: step.branchNames,
      nextNodeId: step.nextNodeId ?? null,
      hasMergeContract: step.mergeContract !== undefined,
    };
  }

  return {
    expression: step.expression,
    trueNodeId: step.trueNodeId,
    falseNodeId: step.falseNodeId,
  };
}

/**
 * `canonicalJson` is reused rather than re-derived. It already sorts object
 * keys at every depth and refuses unbounded or cyclic input, and a second
 * canonical serializer in the same codebase is a second thing that has to
 * agree with the first forever.
 */
export function computePlanDigest(input: {
  readonly workflowId: string;
  readonly version: string;
  readonly startNodeId: string;
  readonly steps: readonly WorkflowPlanStep[];
}): string {
  const projection = {
    workflowId: input.workflowId,
    version: input.version,
    startNodeId: input.startNodeId,
    steps: input.steps.map((step) => ({
      index: step.index,
      nodeId: step.nodeId,
      kind: step.kind,
      // `null` rather than omitted throughout: an absent key and a
      // present-but-undefined key serialize identically, so "no successor",
      // "no mapping" and "no loop" each have to say so explicitly for the
      // absence to be part of what is hashed.
      loop: step.loop === undefined ? null : { maxIterations: step.loop.maxIterations },
      ...stepProjection(step),
    })),
  };

  const canonical = canonicalJson(projection);
  // Unreachable in practice — the projection is scalars and arrays within the
  // node ceiling — but a digest is not a place to assume. A plan that cannot be
  // serialized must not silently share a digest with one that can.
  if (canonical === undefined) {
    throw new Error('workflow plan could not be canonically serialized');
  }
  return digestText(canonical);
}
