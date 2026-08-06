/**
 * Checkpoint digests and chain verification (AI-01 Batch 3B, Part 3).
 *
 * One definition of what a checkpoint's digest covers, used by the writer and
 * by the verifier. Two definitions would mean a chain that verifies against a
 * rule nobody wrote it under.
 *
 * ── WHAT IS INSIDE THE DIGEST ──────────────────────────────────────────────
 *
 *   the run it belongs to, its organization, its version, the node that
 *   produced it, the cursor, the step count, the outputs digest, the loop and
 *   visit counters, the PARALLEL SUMMARY (Part 4), and the PREVIOUS
 *   checkpoint's digest.
 *
 * The parallel summary is inside because a branch outcome and a fired join are
 * durable decisions of exactly the kind the chain exists to protect: a branch
 * recorded as completed must not be re-writable as pending, and a join that
 * fired must not be made to look as though it never did. What the summary
 * EXCLUDES — timestamps, child run ids, the in-flight pending node — is
 * excluded because those legitimately differ between a crashed attempt and its
 * retry, and a digest that moved with them would turn the idempotent re-write
 * in the engine's `writeCheckpoint` into a permanent conflict.
 *
 * The run id and organization are inside deliberately: without them a
 * checkpoint lifted from one run would verify inside another's chain, and
 * "resume from the latest valid checkpoint" would accept a valid checkpoint
 * belonging to somebody else.
 *
 * `createdAt` is deliberately OUTSIDE. A digest that moved with the clock could
 * not be recomputed from stored content, and recomputation is the entire
 * verification strategy — the chain proves the content was not edited, and a
 * timestamp is not content anyone branches on.
 */

import type {
  WorkflowCheckpoint,
  WorkflowParallelCheckpointSummary,
} from '../contracts/checkpoint.ts';
import type { WorkflowParallelGroup } from '../contracts/parallel.ts';
import { canonicalJson, digestText, digestValue } from '../../agents/runtime/digest.ts';

/** Digest of the outputs map alone. Stored so a reader can compare cheaply. */
export function digestOutputs(outputs: Readonly<Record<string, unknown>>): string {
  return digestValue(outputs);
}

/**
 * Reduce the run's parallel groups to what the chain will prove (Part 4).
 *
 * One definition, used by the writer and by the verifier. Branch-local outputs
 * become a digest here rather than travelling into the checkpoint: the outputs
 * themselves are on the run record, and copying them would make a checkpoint
 * grow with every branch of every group while proving nothing the digest does
 * not already prove.
 */
export function summarizeParallelGroups(
  groups: readonly WorkflowParallelGroup[],
): readonly WorkflowParallelCheckpointSummary[] {
  return [...groups]
    // Sorted by id so the summary is a function of the SET of groups, never of
    // the order they happen to sit in on the record.
    .sort((a, b) => a.groupId.localeCompare(b.groupId))
    .map((group) => ({
      groupId: group.groupId,
      parallelNodeId: group.parallelNodeId,
      joinNodeId: group.joinNodeId,
      state: group.state,
      joined: group.joinedAt !== undefined,
      ...(group.joinDigest === undefined ? {} : { joinDigest: group.joinDigest }),
      branches: [...group.branches]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((branch) => ({
          branchId: branch.branchId,
          branchName: branch.branchName,
          ordinal: branch.ordinal,
          state: branch.state,
          ...(branch.cursorNodeId === undefined ? {} : { cursorNodeId: branch.cursorNodeId }),
          stepCount: branch.stepCount,
          outputsDigest: digestOutputs(branch.outputs),
          ...(branch.contributionNodeId === undefined
            ? {}
            : { contributionNodeId: branch.contributionNodeId }),
        })),
    }));
}

/** Recompute a checkpoint's digest from its own content. */
export function computeCheckpointDigest(
  checkpoint: Omit<WorkflowCheckpoint, 'digest'>,
): string {
  const projection = {
    workflowRunId: checkpoint.workflowRunId,
    organizationId: checkpoint.organizationId,
    version: checkpoint.version,
    state: checkpoint.state,
    nodeId: checkpoint.nodeId,
    stepCount: checkpoint.stepCount,
    // `null` rather than omitted: an absent key and a present-but-undefined key
    // serialize identically, so "the plan is finished" has to say so explicitly
    // for it to be part of what is chained.
    cursorNodeId: checkpoint.cursorNodeId ?? null,
    outputsDigest: checkpoint.outputsDigest,
    loopIterations: checkpoint.loopIterations,
    nodeVisits: checkpoint.nodeVisits,
    // `?? []` rather than a required field: a Part 3 checkpoint written before
    // this field existed has no parallel work, and an empty array is exactly
    // what "no parallel work" means. It also keeps the projection total against
    // a stored record read back from a durable store.
    parallel: checkpoint.parallel ?? [],
    previousDigest: checkpoint.previousDigest ?? null,
  };
  const canonical = canonicalJson(projection);
  // Unreachable in practice — the projection is scalars and flat records within
  // the checkpoint bounds — but a digest is not a place to assume. A checkpoint
  // that cannot be serialized must not silently share a digest with one that can.
  if (canonical === undefined) {
    throw new Error('workflow checkpoint could not be canonically serialized');
  }
  return digestText(canonical);
}

export type ChainVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: string };

/**
 * Verify one checkpoint against its own content and its declared predecessor.
 *
 * Two independent checks, and both are needed. Recomputing the digest catches a
 * record whose CONTENT was edited; comparing `previousDigest` catches a record
 * that is internally consistent but was spliced into the wrong place — a
 * checkpoint rewritten wholesale, with a correct self-digest, would pass the
 * first check and fail the second.
 */
export function verifyCheckpoint(
  checkpoint: WorkflowCheckpoint,
  previous: WorkflowCheckpoint | undefined,
): ChainVerdict {
  if (digestOutputs(checkpoint.outputs) !== checkpoint.outputsDigest) {
    return {
      ok: false,
      problem: `checkpoint ${checkpoint.version}: outputs do not match outputsDigest`,
    };
  }

  let recomputed: string;
  try {
    recomputed = computeCheckpointDigest(checkpoint);
  } catch {
    return { ok: false, problem: `checkpoint ${checkpoint.version}: content is not serializable` };
  }
  if (recomputed !== checkpoint.digest) {
    return { ok: false, problem: `checkpoint ${checkpoint.version}: digest does not match content` };
  }

  if (previous === undefined) {
    if (checkpoint.version !== 1 || checkpoint.previousDigest !== undefined) {
      return {
        ok: false,
        problem: `checkpoint ${checkpoint.version}: no predecessor supplied for a chained link`,
      };
    }
    return { ok: true };
  }

  if (previous.version !== checkpoint.version - 1) {
    return {
      ok: false,
      problem: `checkpoint ${checkpoint.version}: predecessor is version ${previous.version}`,
    };
  }
  if (checkpoint.previousDigest !== previous.digest) {
    return {
      ok: false,
      problem: `checkpoint ${checkpoint.version}: chain link does not match its predecessor`,
    };
  }
  return { ok: true };
}

/**
 * Verify a whole history, oldest first.
 *
 * Used on recovery. Walking the entire chain rather than only the tip is the
 * difference between "the last record looks right" and "no record was edited":
 * an attacker or a bug that rewrote checkpoint three and re-chained four
 * onwards produces a tip that verifies against its immediate predecessor.
 */
export function verifyChain(history: readonly WorkflowCheckpoint[]): ChainVerdict {
  let previous: WorkflowCheckpoint | undefined;
  for (const checkpoint of history) {
    const verdict = verifyCheckpoint(checkpoint, previous);
    if (!verdict.ok) return verdict;
    previous = checkpoint;
  }
  return { ok: true };
}
