/**
 * Durable workflow checkpoints (AI-01 Batch 3B, Part 3).
 *
 * An immutable, versioned, digest-chained point a run can be resumed from.
 *
 * ── WHY PART 3 NEEDS WHAT PART 2 CORRECTLY DID WITHOUT ─────────────────────
 *
 * Part 2 argued against a separate checkpoint store, and the argument was right
 * for Part 2: a workflow's recoverable state was three small fields already
 * written atomically with the run record, and a second store would have been a
 * second thing to keep consistent for no added guarantee.
 *
 * Part 3 changes the facts. Node OUTPUTS are now durable state — conditions
 * branch on them, mappings read them, and a run resumed after a restart must
 * see exactly the outputs the run had produced, not a re-derivation. That state
 * is (a) large, (b) accumulated across nodes, and (c) the thing an auditor most
 * needs to know was not edited after the fact. Those are precisely the
 * properties that made Batch 3A give agent runs an append-only chained store,
 * and the same reasoning now applies here.
 *
 * The run record keeps the POINTER (`checkpointVersion`, `checkpointDigest`);
 * the checkpoint keeps the STATE. One is mutable and versioned, the other is
 * append-only and immutable, and the pointer is what binds a run to a specific
 * link in the chain.
 *
 * ── THE CHAIN ──────────────────────────────────────────────────────────────
 *
 * Each checkpoint carries the digest of the one before it and a digest of
 * itself over that link. Rewriting any checkpoint breaks every digest after it,
 * and the run record's pointer names the digest it expects — so a run cannot be
 * resumed from a history that has been edited, and it cannot be resumed from a
 * DIFFERENT run's history either, because the run id is inside the digest.
 *
 * That is what "safe for restart recovery" means concretely: recovery does not
 * trust the store, it verifies it.
 *
 * ── NO RAW CONTENT BEYOND THE DECLARED SHAPE ───────────────────────────────
 *
 * `outputs` holds only values that passed a node's declared output contract, so
 * what is stored is a projection the workflow author named — not a model
 * completion, not a tool payload, not whatever the agent happened to return.
 * The read models never expose it; an operator sees `outputsDigest`.
 */

import type { WorkflowRunState } from './run.ts';

export interface WorkflowCheckpoint {
  readonly workflowRunId: string;
  readonly organizationId: string;
  /** Monotonic per run, starting at 1. Never reused, never rewritten. */
  readonly version: number;
  readonly createdAt: string;
  /** Run state at the moment the checkpoint was taken. */
  readonly state: WorkflowRunState;
  /** The node whose completion produced this checkpoint. */
  readonly nodeId: string;
  readonly stepCount: number;
  /** Where the run resumes. Absent when the plan is finished. */
  readonly cursorNodeId?: string;
  /**
   * Trusted node outputs so far, keyed by node id.
   *
   * A re-executed node (inside a loop) REPLACES its entry rather than appending
   * one: a reference to `node X.field` must mean "what X produced most
   * recently", because that is the only reading under which a loop body can
   * condition on its own last result. The superseded value is not lost — it is
   * in the earlier checkpoint, which is immutable.
   */
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly outputsDigest: string;
  /** Loop edge iterations so far, keyed by the node the loop returns to. */
  readonly loopIterations: Readonly<Record<string, number>>;
  /** Times each node has been executed. Drives the `node_visits` counter. */
  readonly nodeVisits: Readonly<Record<string, number>>;
  /** Digest of the previous checkpoint. Absent on version 1. */
  readonly previousDigest?: string;
  /** Digest of this checkpoint's own content, including `previousDigest`. */
  readonly digest: string;
}

export const WORKFLOW_CHECKPOINT_BOUNDS = {
  /** Ceiling on the canonical size of the whole `outputs` map. */
  maxOutputsBytes: 128 * 1024,
  /** Ceiling on one node's stored output. */
  maxNodeOutputBytes: 32 * 1024,
} as const;
