/**
 * Persistence ports for the workflow engine (AI-01 Batch 3B, Part 2).
 *
 * THE RULE, unchanged from Batch 3A: isolate memory is never the authority. A
 * run's state, its cursor, its pending child and its step history are read from
 * and written to a store before anything acts on them, and a write that loses a
 * version race is refused rather than merged.
 *
 * THREE PORTS, THREE DIFFERENT CONTRACTS, AND THE DIFFERENCES ARE THE POINT.
 *
 *   Runs         Read-modify-write under optimistic concurrency. `save` carries
 *                the version it read; a mismatch is a typed conflict the caller
 *                resolves by re-reading, never by overwriting.
 *
 *   Checkpoints  Append-only and immutable. `write` refuses a version that
 *                already exists — not "last write wins", because a checkpoint
 *                that can be rewritten is not a point you can resume from with
 *                any confidence about what it contained.
 *
 *   Approvals    Read-modify-write, like runs, and separate from them because
 *                the readers are different (AI-01 Batch 3B, Part 5). A decision
 *                is made by somebody who is not driving the run, it is listed
 *                in an operator queue that must not have to read every run
 *                record to build itself, and it is written by a request that
 *                touches nothing else. `create` is insert-if-absent so a
 *                recomputed deterministic id is refused rather than
 *                overwriting a pending decision.
 *
 * Part 2 shipped only the first, and argued correctly that its recoverable
 * state was small enough to live in the record. Part 3 changed the facts: node
 * outputs are now durable state that conditions branch on and mappings read,
 * and that state is large, accumulated and exactly the thing an auditor needs
 * to know was not edited. See `contracts/checkpoint.ts` for the full reasoning.
 *
 * The in-memory implementations here are correct for tests and for a single
 * instance. `kvWorkflowStores.ts` provides the durable ones. Both satisfy these
 * same contracts, and the durability tests run the SAME assertions against both.
 */

import type { WorkflowRunRecord, WorkflowRunState } from '../contracts/run.ts';
import type { WorkflowCheckpoint } from '../contracts/checkpoint.ts';
import type { WorkflowApprovalRecord } from '../contracts/approval.ts';
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
  /**
   * Append a checkpoint. Throws `workflow_checkpoint_conflict` when that
   * version already exists.
   *
   * There is no `save` and no `delete`, and their absence is the contract: a
   * checkpoint is written once and read forever. Everything the digest chain
   * proves rests on this method being the only writer.
   */
  write(checkpoint: WorkflowCheckpoint): Promise<void>;
  /** The highest-versioned checkpoint for a run, or undefined. */
  latest(organizationId: string, workflowRunId: string): Promise<WorkflowCheckpoint | undefined>;
  /** One version, or undefined. */
  read(
    organizationId: string,
    workflowRunId: string,
    version: number,
  ): Promise<WorkflowCheckpoint | undefined>;
  /** Every checkpoint for a run, oldest first. Bounded by the run's nodes. */
  history(organizationId: string, workflowRunId: string): Promise<readonly WorkflowCheckpoint[]>;
}

/** Filter for an approval listing. Every field narrows; none widens. */
export interface WorkflowApprovalQuery {
  /** Required. There is no cross-tenant approval listing, by design. */
  readonly organizationId: string;
  readonly workflowRunId?: string;
  /** The operator queue: requests that can still be decided. */
  readonly pendingOnly?: boolean;
  readonly limit?: number;
}

export interface WorkflowApprovalStore {
  /** One approval, or undefined. Never another tenant's. */
  load(
    organizationId: string,
    workflowApprovalId: string,
  ): Promise<WorkflowApprovalRecord | undefined>;
  /**
   * Create an approval that does not exist. Refuses if the id is taken.
   *
   * The engine derives approval ids deterministically, so a duplicate is not a
   * collision — it is a retried advance recomputing the id of a request it
   * already made. Refusing rather than overwriting is what lets the gate tell
   * those apart: it reads the existing record and adopts it if, and only if, it
   * is still pending.
   */
  create(record: WorkflowApprovalRecord): Promise<void>;
  /**
   * Persist a decision. `expectedVersion` is the version the caller read.
   * Throws `stale_workflow_approval` when the stored version has moved on —
   * which is what makes two people deciding at once resolve to one decision
   * rather than to a merge of two.
   */
  save(record: WorkflowApprovalRecord, expectedVersion: number): Promise<void>;
  list(query: WorkflowApprovalQuery): Promise<readonly WorkflowApprovalRecord[]>;
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
  record: WorkflowApprovalRecord,
  query: WorkflowApprovalQuery,
): boolean {
  if (record.organizationId !== query.organizationId) return false;
  if (query.workflowRunId && record.workflowRunId !== query.workflowRunId) return false;
  if (query.pendingOnly && record.approvalState !== 'pending') return false;
  return true;
}

/**
 * OLDEST first, and this is the one listing in the batch that is not newest
 * first.
 *
 * An approval queue is work, not history: the request that has been waiting
 * longest is the one closest to expiring and the one holding a run up. Sorting
 * it like an audit trail would put the newest question at the top and let the
 * oldest quietly time out at the bottom of page four.
 */
export function sortWorkflowApprovals(
  records: readonly WorkflowApprovalRecord[],
): readonly WorkflowApprovalRecord[] {
  return [...records].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.workflowApprovalId.localeCompare(b.workflowApprovalId),
  );
}

/** Newest first. Stable: ties break on run id so paging is reproducible. */
export function sortWorkflowRuns(
  records: readonly WorkflowRunRecord[],
): readonly WorkflowRunRecord[] {
  return [...records].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) ||
      b.context.workflowRunId.localeCompare(a.context.workflowRunId),
  );
}

// ── In-memory implementation ────────────────────────────────────────────────

/**
 * Bounded in-memory workflow run store.
 *
 * `maxRuns` is not decoration: an isolate that accumulated one record per run
 * forever would be a memory leak with an SLA. Eviction is safe precisely
 * because this store is not the authority in a deployment that has a durable
 * one.
 */
export function createMemoryWorkflowRunStore(
  options: { maxRuns?: number } = {},
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
          workflowFailure('workflow_persistence_failed', 'That run already exists.', {
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
          workflowFailure('workflow_run_not_found', 'That run no longer exists.', {
            workflowRunId: record.context.workflowRunId,
          }),
        );
      }
      if (stored.runVersion !== expectedVersion) {
        return Promise.reject(
          workflowFailure('stale_workflow_version', 'This run has changed since it was read.', {
            workflowRunId: record.context.workflowRunId,
            diagnostics: `expected version ${expectedVersion}, stored ${stored.runVersion}`,
          }),
        );
      }
      records.set(key, record);
      return Promise.resolve();
    },

    list(query) {
      const matched = [...records.values()].filter((record) =>
        matchesWorkflowRunQuery(record, query),
      );
      return Promise.resolve(sortWorkflowRuns(matched).slice(0, boundedLimit(query.limit)));
    },

    clear: () => records.clear(),
    size: () => records.size,
  };
}

/**
 * In-memory checkpoint store with the production's append-only semantics.
 *
 * `poke` exists so the corruption tests can do the one thing the contract
 * forbids — rewrite a written checkpoint — and prove that recovery notices.
 * A durability guarantee nobody tried to break is a guarantee nobody checked.
 */
export function createMemoryWorkflowCheckpointStore(): WorkflowCheckpointStore & {
  poke(organizationId: string, workflowRunId: string, checkpoint: WorkflowCheckpoint): void;
  size(): number;
} {
  const records = new Map<string, WorkflowCheckpoint>();
  const keyOf = (organizationId: string, workflowRunId: string, version: number) =>
    `${organizationId}:${workflowRunId}:${String(version).padStart(6, '0')}`;

  function forRun(organizationId: string, workflowRunId: string): WorkflowCheckpoint[] {
    const prefix = `${organizationId}:${workflowRunId}:`;
    return [...records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, checkpoint]) => checkpoint);
  }

  return {
    write(checkpoint) {
      const key = keyOf(checkpoint.organizationId, checkpoint.workflowRunId, checkpoint.version);
      if (records.has(key)) {
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
      records.set(key, checkpoint);
      return Promise.resolve();
    },

    latest(organizationId, workflowRunId) {
      const all = forRun(organizationId, workflowRunId);
      return Promise.resolve(all[all.length - 1]);
    },

    read(organizationId, workflowRunId, version) {
      return Promise.resolve(records.get(keyOf(organizationId, workflowRunId, version)));
    },

    history: (organizationId, workflowRunId) =>
      Promise.resolve(forRun(organizationId, workflowRunId)),

    poke(organizationId, workflowRunId, checkpoint) {
      records.set(keyOf(organizationId, workflowRunId, checkpoint.version), checkpoint);
    },

    size: () => records.size,
  };
}

/**
 * Bounded in-memory approval store (AI-01 Batch 3B, Part 5).
 *
 * Same shape and same bounding argument as the run store: an isolate that
 * accumulated one record per approval forever would be a memory leak with an
 * SLA, and eviction is safe precisely because this store is not the authority
 * in a deployment that has a durable one.
 */
export function createMemoryWorkflowApprovalStore(
  options: { maxApprovals?: number } = {},
): WorkflowApprovalStore & { clear(): void; size(): number } {
  const maxApprovals = options.maxApprovals ?? 1_000;
  const records = new Map<string, WorkflowApprovalRecord>();
  const keyOf = (organizationId: string, workflowApprovalId: string) =>
    `${organizationId}:${workflowApprovalId}`;

  return {
    load(organizationId, workflowApprovalId) {
      return Promise.resolve(records.get(keyOf(organizationId, workflowApprovalId)));
    },

    create(record) {
      const key = keyOf(record.organizationId, record.workflowApprovalId);
      if (records.has(key)) {
        return Promise.reject(
          workflowFailure(
            'workflow_approval_conflict',
            'That approval has already been requested.',
            {
              workflowRunId: record.workflowRunId,
              nodeId: record.nodeId,
              diagnostics: `duplicate approval id ${record.workflowApprovalId}`,
            },
          ),
        );
      }
      if (records.size >= maxApprovals) {
        const oldest = records.keys().next().value;
        if (oldest !== undefined) records.delete(oldest);
      }
      records.set(key, record);
      return Promise.resolve();
    },

    save(record, expectedVersion) {
      const key = keyOf(record.organizationId, record.workflowApprovalId);
      const stored = records.get(key);
      if (!stored) {
        return Promise.reject(
          workflowFailure('workflow_approval_not_found', 'That approval is not available.', {
            workflowRunId: record.workflowRunId,
            diagnostics: `approval ${record.workflowApprovalId} no longer exists`,
          }),
        );
      }
      if (stored.approvalVersion !== expectedVersion) {
        return Promise.reject(
          workflowFailure(
            'stale_workflow_approval',
            'This approval has changed since it was read.',
            {
              workflowRunId: record.workflowRunId,
              diagnostics:
                `expected version ${expectedVersion}, stored ${stored.approvalVersion}`,
            },
          ),
        );
      }
      records.set(key, record);
      return Promise.resolve();
    },

    list(query) {
      const matched = [...records.values()].filter((record) =>
        matchesWorkflowApprovalQuery(record, query),
      );
      return Promise.resolve(sortWorkflowApprovals(matched).slice(0, boundedLimit(query.limit)));
    },

    clear: () => records.clear(),
    size: () => records.size,
  };
}
