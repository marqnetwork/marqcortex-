/**
 * Data-flow state and its recovery (AI-01 Batch 3B, Part 3).
 *
 * The engine's in-memory view of everything a condition or a mapping may read:
 * trusted node outputs, loop iterations and node visits. It is DERIVED, never
 * authoritative — seeded from the durable checkpoint chain at the start of an
 * advance, updated as nodes complete, and written back as the next checkpoint.
 *
 * ── RECOVERY VERIFIES, IT DOES NOT TRUST ───────────────────────────────────
 *
 * `recoverDataState` does not simply read "the latest checkpoint". It walks the
 * whole chain from version one, recomputes every digest, checks every link, and
 * then checks that the tip is the exact checkpoint the RUN RECORD says it
 * wrote. Four things have to agree before a run resumes.
 *
 * Walking the whole chain rather than the tip is the difference between "the
 * last record looks right" and "no record was edited": a rewrite of checkpoint
 * three followed by re-chaining four onwards leaves a tip that verifies
 * perfectly against its immediate predecessor.
 *
 * The cost is one prefix scan and up to `maxCheckpoints` digest computations per
 * advance. That is bounded, cheap, and the price of the guarantee — a recovery
 * path that skipped verification to save it would be a recovery path that
 * resumes from whatever the store happens to return.
 *
 * ── AND IT FAILS CLOSED ────────────────────────────────────────────────────
 *
 * Any disagreement is `workflow_checkpoint_corrupt`, which is terminal and not
 * retryable. There is deliberately no fallback to an earlier valid checkpoint:
 * "resume from the last checkpoint that still verifies" sounds helpful and
 * means silently re-running nodes whose effects already happened.
 */

import type { WorkflowCheckpoint } from '../contracts/checkpoint.ts';
import type { WorkflowRunRecord } from '../contracts/run.ts';
import type { WorkflowCheckpointStore } from '../persistence/ports.ts';
import { WORKFLOW_RUN_BOUNDS } from '../contracts/run.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { verifyChain } from '../runtime/checkpointChain.ts';

/**
 * Mutable during one advance, and only through the engine's node-completion
 * path. Every field mirrors a field of the checkpoint that will record it.
 */
export interface DataState {
  outputs: Record<string, unknown>;
  loopIterations: Record<string, number>;
  nodeVisits: Record<string, number>;
}

export function emptyDataState(): DataState {
  return { outputs: {}, loopIterations: {}, nodeVisits: {} };
}

/**
 * Rebuild the data state a run left behind, or refuse to continue.
 *
 * A run that has written no checkpoint starts empty — that is the ordinary
 * first-advance case, not a recovery. Everything else is verified.
 */
export async function recoverDataState(
  record: WorkflowRunRecord,
  checkpoints: WorkflowCheckpointStore,
): Promise<DataState> {
  if (record.checkpointVersion === 0) return emptyDataState();

  const history = await checkpoints.history(
    record.context.organizationId,
    record.context.workflowRunId,
  );

  if (history.length === 0) {
    // The run says it wrote checkpoints and the store has none. The pointer and
    // the chain disagree, and guessing which is right would mean re-running
    // nodes that may already have had their effects.
    throw corrupt(record, 'run points at a checkpoint chain the store does not have');
  }
  if (history.length > WORKFLOW_RUN_BOUNDS.maxCheckpoints) {
    throw corrupt(
      record,
      `checkpoint chain has ${history.length} links, above the ceiling of ${WORKFLOW_RUN_BOUNDS.maxCheckpoints}`,
    );
  }

  const verdict = verifyChain(history);
  if (!verdict.ok) throw corrupt(record, verdict.problem);

  const tip = history[history.length - 1];
  if (tip.version !== record.checkpointVersion) {
    throw corrupt(
      record,
      `run points at checkpoint ${record.checkpointVersion}, chain ends at ${tip.version}`,
    );
  }
  if (record.checkpointDigest !== undefined && tip.digest !== record.checkpointDigest) {
    throw corrupt(record, 'the latest checkpoint is not the one this run recorded writing');
  }
  if (tip.workflowRunId !== record.context.workflowRunId) {
    // Unreachable through a tenant-scoped store, and asserted anyway: the run
    // id is inside the digest precisely so a checkpoint cannot be transplanted.
    throw corrupt(record, 'the latest checkpoint belongs to a different run');
  }

  return {
    outputs: { ...tip.outputs },
    loopIterations: { ...tip.loopIterations },
    nodeVisits: { ...tip.nodeVisits },
  };
}

function corrupt(record: WorkflowRunRecord, detail: string) {
  return workflowFailure(
    'workflow_checkpoint_corrupt',
    'This run cannot be safely resumed.',
    {
      workflowRunId: record.context.workflowRunId,
      workflowId: record.context.workflowId,
      diagnostics: detail,
    },
  );
}

/** The checkpoint the tip must be, for a chain link. */
export function previousDigestOf(latest: WorkflowCheckpoint | undefined): string | undefined {
  return latest?.digest;
}
