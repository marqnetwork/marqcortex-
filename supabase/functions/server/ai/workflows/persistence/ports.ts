/**
 * Persistence ports for the workflow engine (AI-01 Batch 3B, Part 2).
 *
 * THE RULE, unchanged from Batch 3A: isolate memory is never the authority. A
 * run's state, its cursor, its pending child and its step history are read from
 * and written to a store before anything acts on them, and a write that loses a
 * version race is refused rather than merged.
 *
 * ONE PORT, NOT THREE. The agent runtime needed separate stores for runs,
 * checkpoints and approvals because those three have genuinely different
 * contracts — read-modify-write, append-only-immutable, and a decision queue. A
 * workflow run in Part 2 has none of that: no approvals in this part, and its
 * recoverable state is small enough to live in the record. See the note on
 * `checkpointVersion` in `contracts/run.ts` for why a second store would add a
 * consistency problem rather than a guarantee.
 *
 * The in-memory implementation here is correct for tests and for a single
 * instance. `kvWorkflowStores.ts` provides the durable one. Both satisfy this
 * same contract, and the durability tests run the SAME assertions against both.
 */

import type { WorkflowRunRecord, WorkflowRunState } from '../contracts/run.ts';
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
