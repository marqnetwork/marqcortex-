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
import { isAgentStep } from '../contracts/plan.ts';
import { canonicalJson, digestText } from '../../agents/runtime/digest.ts';

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
      ...(isAgentStep(step)
        ? {
            agentId: step.agentId,
            maxAttempts: step.maxAttempts,
            nextNodeId: step.nextNodeId ?? null,
            inputMapping: step.inputMapping ?? null,
            outputMapping: step.outputMapping ?? null,
            // Presence only — see the header for why a validator's body is not
            // hashable and what that costs.
            hasInputContract: step.inputContract !== undefined,
            hasOutputContract: step.outputContract !== undefined,
          }
        : {
            expression: step.expression,
            trueNodeId: step.trueNodeId,
            falseNodeId: step.falseNodeId,
          }),
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
