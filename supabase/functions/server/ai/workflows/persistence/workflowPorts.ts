/**
 * Persistence ports for the workflow runtime (AI-01 Batch 3B).
 *
 * THE SAME RULE, AT A LONGER TIMESCALE. Isolate memory is never the authority.
 * An agent run can plausibly complete inside one request; a workflow run spans
 * several agent runs and at least one human decision, so the window in which an
 * isolate disappears mid-run is not an edge case — it is the normal case.
 *
 * TWO PORTS, TWO DIFFERENT CONTRACTS.
 *
 *   Runs        Read-modify-write under optimistic concurrency. `save` carries
 *               the version it read; a mismatch is a typed conflict the caller
 *               resolves by re-reading, never by overwriting. This is what stops
 *               two isolates from each advancing the same wave.
 *
 *   Checkpoints Append-only and immutable. `write` refuses a version that
 *               already exists. A checkpoint that can be rewritten is not a
 *               point you can resume from with any confidence about its contents.
 *
 * THERE IS NO WORKFLOW APPROVAL PORT, deliberately. Workflow approvals are
 * stored through the CERTIFIED `AgentApprovalStore` from Batch 3A — the same
 * record shape, the same compare-and-swap single-use guarantee, the same
 * operator queue. A second approval store would be a second implementation of
 * "an approval cannot be spent twice", and two implementations of a guarantee
 * are zero guarantees.
 *
 * The in-memory implementations here are correct for tests and for a single
 * instance; `kvWorkflowStores.ts` provides the durable ones, and the durability
 * suite runs the SAME assertions against both.
 */

import type { WorkflowCheckpoint, WorkflowRunRecord, WorkflowRunState } from '../contracts/runtime.ts';
import { workflowFailure } from '../contracts/failures.ts';

/** Filter for a run listing. Every field narrows; none widens. */
export interface WorkflowRunQuery {
  /** Required. There is no cross-tenant listing at this layer, by design. */
  readonly organizationId: string;
  readonly states?: readonly WorkflowRunState[];
  readonly workflowId?: string;
  readonly actorId?: string;
  readonly limit?: number;
}

export interface WorkflowRunStore {
  load(organizationId: string, workflowRunId: string): Promise<WorkflowRunRecord | undefined>;
  /** Create a run that does not exist. Refuses if the id is taken. */
  create(record: WorkflowRunRecord): Promise<void>;
  /**
   * Persist a mutation. `expectedVersion` is the version the caller read; the
   * record must carry `expectedVersion + 1`. Throws `stale_workflow_version`
   * when the stored version has moved on.
   */
  save(record: WorkflowRunRecord, expectedVersion: number): Promise<void>;
  list(query: WorkflowRunQuery): Promise<readonly WorkflowRunRecord[]>;
}

export interface WorkflowCheckpointStore {
  /** Append. Throws `workflow_checkpoint_conflict` if the version exists. */
  write(checkpoint: WorkflowCheckpoint): Promise<void>;
  latest(organizationId: string, workflowRunId: string): Promise<WorkflowCheckpoint | undefined>;
  read(
    organizationId: string,
    workflowRunId: string,
    version: number,
  ): Promise<WorkflowCheckpoint | undefined>;
  history(
    organizationId: string,
    workflowRunId: string,
  ): Promise<readonly WorkflowCheckpoint[]>;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function boundedWorkflowLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Does a run match a query? Shared by both store implementations so a filter
 * cannot mean one thing in memory and another in storage.
 */
export function matchesWorkflowRunQuery(
  record: WorkflowRunRecord,
  query: WorkflowRunQuery,
): boolean {
  if (record.context.organizationId !== query.organizationId) return false;
  if (query.states && !query.states.includes(record.state)) return false;
  if (query.workflowId && record.context.workflowId !== query.workflowId) return false;
  if (query.actorId && record.context.actorId !== query.actorId) return false;
  return true;
}

/** Newest first. Stable: ties break on run id, so paging is reproducible. */
export function byNewestWorkflowRun(a: WorkflowRunRecord, b: WorkflowRunRecord): number {
  return (
    b.createdAt.localeCompare(a.createdAt) ||
    b.context.workflowRunId.localeCompare(a.context.workflowRunId)
  );
}

// ── In-memory implementations ───────────────────────────────────────────────

export function createMemoryWorkflowRunStore(
  options: { maxRuns?: number } = {},
): WorkflowRunStore & { clear(): void; size(): number } {
  const maxRuns = options.maxRuns ?? 500;
  const records = new Map<string, WorkflowRunRecord>();
  const keyOf = (organizationId: string, runId: string) => `${organizationId}:${runId}`;

  return {
    load(organizationId, workflowRunId) {
      return Promise.resolve(records.get(keyOf(organizationId, workflowRunId)));
    },

    create(record) {
      const key = keyOf(record.context.organizationId, record.context.workflowRunId);
      if (records.has(key)) {
        return Promise.reject(
          workflowFailure('workflow_persistence_failed', 'That workflow run already exists.', {
            workflowRunId: record.context.workflowRunId,
            diagnostics: `duplicate workflow run id ${record.context.workflowRunId}`,
          }),
        );
      }
      // Bounded on purpose: an isolate accumulating one record per run forever
      // is a memory leak with an SLA. Eviction is safe precisely because this
      // store is not the authority where a durable one exists.
      if (records.size >= maxRuns) {
        const oldest = records.keys().next().value;
        if (oldest !== undefined) records.delete(oldest);
      }
      records.set(key, record);
      return Promise.resolve();
    },

    save(record, expectedVersion) {
      const key = keyOf(record.context.organizationId, record.context.workflowRunId);
      const stored = records.get(key);
      if (!stored) {
        return Promise.reject(
          workflowFailure('workflow_run_not_found', 'That workflow run no longer exists.', {
            workflowRunId: record.context.workflowRunId,
          }),
        );
      }
      if (stored.runVersion !== expectedVersion) {
        return Promise.reject(
          workflowFailure(
            'stale_workflow_version',
            'This workflow run has changed since it was read.',
            {
              workflowRunId: record.context.workflowRunId,
              diagnostics: `expected ${expectedVersion}, stored ${stored.runVersion}`,
            },
          ),
        );
      }
      records.set(key, record);
      return Promise.resolve();
    },

    list(query) {
      return Promise.resolve(
        [...records.values()]
          .filter((record) => matchesWorkflowRunQuery(record, query))
          .sort(byNewestWorkflowRun)
          .slice(0, boundedWorkflowLimit(query.limit)),
      );
    },

    clear: () => records.clear(),
    size: () => records.size,
  };
}

export function createMemoryWorkflowCheckpointStore(
  options: { maxCheckpoints?: number } = {},
): WorkflowCheckpointStore & { clear(): void; size(): number } {
  const maxCheckpoints = options.maxCheckpoints ?? 5_000;
  const checkpoints = new Map<string, WorkflowCheckpoint>();
  const keyOf = (organizationId: string, runId: string, version: number) =>
    `${organizationId}:${runId}:${String(version).padStart(6, '0')}`;

  return {
    write(checkpoint) {
      const key = keyOf(checkpoint.organizationId, checkpoint.workflowRunId, checkpoint.version);
      if (checkpoints.has(key)) {
        return Promise.reject(
          workflowFailure(
            'workflow_checkpoint_conflict',
            'That checkpoint has already been written.',
            {
              workflowRunId: checkpoint.workflowRunId,
              diagnostics: `checkpoint version ${checkpoint.version} already exists`,
            },
          ),
        );
      }
      if (checkpoints.size >= maxCheckpoints) {
        const oldest = checkpoints.keys().next().value;
        if (oldest !== undefined) checkpoints.delete(oldest);
      }
      checkpoints.set(key, checkpoint);
      return Promise.resolve();
    },

    read(organizationId, workflowRunId, version) {
      return Promise.resolve(checkpoints.get(keyOf(organizationId, workflowRunId, version)));
    },

    latest(organizationId, workflowRunId) {
      const forRun = [...checkpoints.values()].filter(
        (checkpoint) =>
          checkpoint.organizationId === organizationId &&
          checkpoint.workflowRunId === workflowRunId,
      );
      if (forRun.length === 0) return Promise.resolve(undefined);
      return Promise.resolve(
        forRun.reduce((best, candidate) => (candidate.version > best.version ? candidate : best)),
      );
    },

    history(organizationId, workflowRunId) {
      return Promise.resolve(
        [...checkpoints.values()]
          .filter(
            (checkpoint) =>
              checkpoint.organizationId === organizationId &&
              checkpoint.workflowRunId === workflowRunId,
          )
          .sort((a, b) => a.version - b.version),
      );
    },

    clear: () => checkpoints.clear(),
    size: () => checkpoints.size,
  };
}
