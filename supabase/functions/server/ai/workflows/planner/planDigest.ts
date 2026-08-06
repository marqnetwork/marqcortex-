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
 *   index, node id, kind, agent id, attempt ceiling and successor.
 *
 * WHAT IS DELIBERATELY OUTSIDE IT.
 *
 *   Display names and edge labels. A workflow renamed from "Draft" to "Draft
 *   proposal" runs identically, and a digest that changed would force a review
 *   of a copy edit while telling a reviewer nothing.
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
      agentId: step.agentId,
      maxAttempts: step.maxAttempts,
      // `null` rather than omitted: an absent key and a present-but-undefined
      // key serialize identically, so a terminal step has to say so explicitly
      // for "ends here" to be part of what is hashed.
      nextNodeId: step.nextNodeId ?? null,
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
