/**
 * Persistence ports for the workflow engine (AI-01 Batch 3B).
 *
 * THE RULE: isolate memory is never the authority. A run's state, its branch
 * table, its join table, its ledgers, its approvals and its checkpoints are read
 * from and written to a store before anything acts on them, and a write that
 * loses a version race is refused rather than merged. An edge isolate can vanish
 * between two nodes of a workflow, and every guarantee in this batch has to
 * survive that.
 *
 * THREE PORTS, THREE DIFFERENT CONTRACTS, AND THE DIFFERENCES MATTER.
 *
 *   Runs        Read-modify-write under optimistic concurrency. `save` carries
 *               the version it read; a mismatch is a typed conflict the caller
 *               resolves by re-reading, never by overwriting. Two isolates
 *               advancing the same fan-out cannot both take "the next node".
 *
 *   Checkpoints Append-only and immutable. `write` refuses a version that
 *               already exists — not "last write wins", because a checkpoint
 *               that can be rewritten is not a point you can resume from with
 *               any confidence about what it contained.
 *
 *   Approvals   Read-modify-write like runs, plus a listing for the operator
 *               queue. The decision path additionally refuses to move an
 *               approval out of `pending` twice, so a double-click cannot spend
 *               one approval on two node executions.
 *
 * The in-memory implementations here are correct for tests and for a single
 * instance. `kvWorkflowStores.ts` provides the durable ones. Both satisfy the
 * same contract, and the durability suite runs the SAME assertions against both —
 * which is the only way to know the two agree.
 */

import type {
  WorkflowApprovalRequest,
  WorkflowCheckpoint,
  WorkflowRunRecord,
  WorkflowRunState,
} from '../contracts/runtime.ts';
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
  /** The run, or undefined. Never another tenant's run. */
  load(organizationId: string, workflowRunId: string): Promise<WorkflowRunRecord | undefined>;
  /**
   * Create a run that does not exist. Refuses if the id is taken — a run id
   * collision must never silently overwrite an existing run.
   */
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
  /** Append a checkpoint. Throws `checkpoint_conflict` if the version exists. */
  write(checkpoint: WorkflowCheckpoint): Promise<void>;
  /** The highest-versioned checkpoint for a run, or undefined. */
  latest(organizationId: string, workflowRunId: string): Promise<WorkflowCheckpoint | undefined>;
  read(
    organizationId: string,
    workflowRunId: string,
    version: number,
  ): Promise<WorkflowCheckpoint | undefined>;
  /** Every checkpoint for a run, oldest first. Bounded by the run's steps. */
  history(organizationId: string, workflowRunId: string): Promise<readonly WorkflowCheckpoint[]>;
}

export interface WorkflowApprovalQuery {
  readonly organizationId: string;
  readonly workflowRunId?: string;
  readonly pendingOnly?: boolean;
  readonly limit?: number;
}

export interface WorkflowApprovalStore {
  load(
    organizationId: string,
    workflowApprovalId: string,
  ): Promise<WorkflowApprovalRequest | undefined>;
  create(request: WorkflowApprovalRequest): Promise<void>;
  save(request: WorkflowApprovalRequest, expectedVersion: number): Promise<void>;
  list(query: WorkflowApprovalQuery): Promise<readonly WorkflowApprovalRequest[]>;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function boundedLimit(limit: number | undefined): number {
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

export function matchesWorkflowApprovalQuery(
  request: WorkflowApprovalRequest,
  query: WorkflowApprovalQuery,
): boolean {
  if (request.organizationId !== query.organizationId) return false;
  if (query.workflowRunId && request.workflowRunId !== query.workflowRunId) return false;
  if (query.pendingOnly && request.state !== 'pending') return false;
  return true;
}

/** Newest first. Stable: ties break on id so paging is reproducible. */
function byNewestRun(a: WorkflowRunRecord, b: WorkflowRunRecord): number {
  return (
    b.createdAt.localeCompare(a.createdAt) ||
    b.context.workflowRunId.localeCompare(a.context.workflowRunId)
  );
}

export function byNewestApproval(
  a: WorkflowApprovalRequest,
  b: WorkflowApprovalRequest,
): number {
  return (
    b.createdAt.localeCompare(a.createdAt) ||
    b.workflowApprovalId.localeCompare(a.workflowApprovalId)
  );
}

// ── In-memory implementations ───────────────────────────────────────────────

/**
 * Bounded in-memory run store.
 *
 * `maxRuns` is not decoration: an isolate that accumulated one record per run
 * forever would be a memory leak with an SLA. The oldest record is evicted first,
 * and eviction is safe precisely because this store is not the authority in a
 * deployment that has a durable one.
 */
export function createMemoryWorkflowRunStore(
  options: { readonly maxRuns?: number } = {},
): WorkflowRunStore & { clear(): void; size(): number } {
  const maxRuns = options.maxRuns ?? 500;
  const records = new Map<string, WorkflowRunRecord>();
  const keyOf = (organizationId: string, workflowRunId: string) =>
    `${organizationId}:${workflowRunId}`;

  return {
    load(organizationId, workflowRunId) {
      return Promise.resolve(records.get(keyOf(organizationId, workflowRunId)));
    },

    create(record) {
      const key = keyOf(record.context.organizationId, record.context.workflowRunId);
      if (records.has(key)) {
        return Promise.reject(
          workflowFailure('persistence_failed', 'That workflow run already exists.', {
            workflowRunId: record.context.workflowRunId,
            diagnostics: `duplicate workflow run id ${record.context.workflowRunId}`,
          }),
        );
      }
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
          workflowFailure('stale_workflow_version', 'This run has changed since it was read.', {
            workflowRunId: record.context.workflowRunId,
            diagnostics: `expected ${expectedVersion}, stored ${stored.runVersion}`,
          }),
        );
      }
      records.set(key, record);
      return Promise.resolve();
    },

    list(query) {
      const limit = boundedLimit(query.limit);
      return Promise.resolve(
        [...records.values()]
          .filter((record) => matchesWorkflowRunQuery(record, query))
          .sort(byNewestRun)
          .slice(0, limit),
      );
    },

    clear: () => records.clear(),
    size: () => records.size,
  };
}

export function createMemoryWorkflowCheckpointStore(
  options: { readonly maxCheckpoints?: number } = {},
): WorkflowCheckpointStore & { clear(): void; size(): number } {
  const maxCheckpoints = options.maxCheckpoints ?? 5_000;
  const checkpoints = new Map<string, WorkflowCheckpoint>();
  const keyOf = (organizationId: string, workflowRunId: string, version: number) =>
    `${organizationId}:${workflowRunId}:${String(version).padStart(6, '0')}`;

  return {
    write(checkpoint) {
      const key = keyOf(checkpoint.organizationId, checkpoint.workflowRunId, checkpoint.version);
      if (checkpoints.has(key)) {
        return Promise.reject(
          workflowFailure('checkpoint_conflict', 'That checkpoint has already been written.', {
            workflowRunId: checkpoint.workflowRunId,
            diagnostics: `checkpoint version ${checkpoint.version} already exists`,
          }),
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

export function createMemoryWorkflowApprovalStore(
  options: { readonly maxApprovals?: number } = {},
): WorkflowApprovalStore & { clear(): void; size(): number } {
  const maxApprovals = options.maxApprovals ?? 1_000;
  const approvals = new Map<string, WorkflowApprovalRequest>();
  const keyOf = (organizationId: string, workflowApprovalId: string) =>
    `${organizationId}:${workflowApprovalId}`;

  return {
    load(organizationId, workflowApprovalId) {
      return Promise.resolve(approvals.get(keyOf(organizationId, workflowApprovalId)));
    },

    create(request) {
      const key = keyOf(request.organizationId, request.workflowApprovalId);
      if (approvals.has(key)) {
        return Promise.reject(
          workflowFailure('persistence_failed', 'That approval already exists.', {
            workflowRunId: request.workflowRunId,
            diagnostics: `duplicate approval id ${request.workflowApprovalId}`,
          }),
        );
      }
      if (approvals.size >= maxApprovals) {
        const oldest = approvals.keys().next().value;
        if (oldest !== undefined) approvals.delete(oldest);
      }
      approvals.set(key, request);
      return Promise.resolve();
    },

    save(request, expectedVersion) {
      const key = keyOf(request.organizationId, request.workflowApprovalId);
      const stored = approvals.get(key);
      if (!stored) {
        return Promise.reject(
          workflowFailure('workflow_run_not_found', 'That approval no longer exists.', {
            workflowRunId: request.workflowRunId,
          }),
        );
      }
      if (stored.approvalVersion !== expectedVersion) {
        return Promise.reject(
          workflowFailure(
            'stale_workflow_version',
            'This approval has changed since it was read.',
            {
              workflowRunId: request.workflowRunId,
              diagnostics: `expected ${expectedVersion}, stored ${stored.approvalVersion}`,
            },
          ),
        );
      }
      approvals.set(key, request);
      return Promise.resolve();
    },

    list(query) {
      const limit = boundedLimit(query.limit);
      return Promise.resolve(
        [...approvals.values()]
          .filter((request) => matchesWorkflowApprovalQuery(request, query))
          .sort(byNewestApproval)
          .slice(0, limit),
      );
    },

    clear: () => approvals.clear(),
    size: () => approvals.size,
  };
}
