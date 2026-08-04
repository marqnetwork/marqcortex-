/**
 * Persistence ports for the agent runtime (AI-01 Batch 3A).
 *
 * THE RULE: isolate memory is never the authority. A run's state, its ledgers,
 * its approvals and its checkpoints are read from and written to a store before
 * anything acts on them, and a write that loses a version race is refused
 * rather than merged. An edge isolate can vanish between two steps of a run,
 * and every guarantee in this batch has to survive that.
 *
 * THREE PORTS, THREE DIFFERENT CONTRACTS, AND THE DIFFERENCES MATTER.
 *
 *   Runs        Read-modify-write under optimistic concurrency. `save` carries
 *               the version it read; a mismatch is a typed conflict the caller
 *               resolves by re-reading, never by overwriting.
 *
 *   Checkpoints Append-only and immutable. `write` refuses a version that
 *               already exists — not "last write wins", because a checkpoint
 *               that can be rewritten is not a point you can resume from with
 *               any confidence about what it contained.
 *
 *   Approvals   Read-modify-write like runs, plus a listing for the operator
 *               queue. The decision path additionally refuses to move an
 *               approval out of `pending` twice, so a double-click cannot spend
 *               one approval on two actions.
 *
 * The in-memory implementations here are correct for tests and for a single
 * instance. `kvAgentStores.ts` provides the durable ones. Both satisfy the same
 * contract, and the durability tests run the SAME assertions against both.
 */

import type {
  AgentApprovalRequest,
  AgentCheckpoint,
  AgentRunRecord,
  AgentRunState,
} from '../contracts/runtime.ts';
import { agentFailure } from '../contracts/failures.ts';

/** Filter for a run listing. Every field narrows; none widens. */
export interface AgentRunQuery {
  /** Required. There is no cross-tenant listing at this layer, by design. */
  readonly organizationId: string;
  readonly states?: readonly AgentRunState[];
  readonly agentId?: string;
  readonly actorId?: string;
  readonly limit?: number;
}

export interface AgentRunStore {
  /** The run, or undefined. Never another tenant's run. */
  load(organizationId: string, runId: string): Promise<AgentRunRecord | undefined>;
  /**
   * Create a run that does not exist. Refuses if the id is taken — a run id
   * collision must never silently overwrite an existing run.
   */
  create(record: AgentRunRecord): Promise<void>;
  /**
   * Persist a mutation. `expectedVersion` is the version the caller read; the
   * record must carry `expectedVersion + 1`. Throws `stale_run_version` when
   * the stored version has moved on.
   */
  save(record: AgentRunRecord, expectedVersion: number): Promise<void>;
  list(query: AgentRunQuery): Promise<readonly AgentRunRecord[]>;
}

export interface AgentCheckpointStore {
  /** Append a checkpoint. Throws `checkpoint_conflict` if the version exists. */
  write(checkpoint: AgentCheckpoint): Promise<void>;
  /** The highest-versioned checkpoint for a run, or undefined. */
  latest(organizationId: string, runId: string): Promise<AgentCheckpoint | undefined>;
  /** One version, or undefined. */
  read(
    organizationId: string,
    runId: string,
    version: number,
  ): Promise<AgentCheckpoint | undefined>;
  /** Every checkpoint for a run, oldest first. Bounded by the run's steps. */
  history(organizationId: string, runId: string): Promise<readonly AgentCheckpoint[]>;
}

export interface AgentApprovalQuery {
  readonly organizationId: string;
  readonly runId?: string;
  readonly pendingOnly?: boolean;
  readonly limit?: number;
}

export interface AgentApprovalStore {
  load(organizationId: string, approvalId: string): Promise<AgentApprovalRequest | undefined>;
  create(request: AgentApprovalRequest): Promise<void>;
  save(request: AgentApprovalRequest, expectedVersion: number): Promise<void>;
  list(query: AgentApprovalQuery): Promise<readonly AgentApprovalRequest[]>;
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
export function matchesRunQuery(record: AgentRunRecord, query: AgentRunQuery): boolean {
  if (record.context.organizationId !== query.organizationId) return false;
  if (query.states && !query.states.includes(record.state)) return false;
  if (query.agentId && record.context.agentId !== query.agentId) return false;
  if (query.actorId && record.context.actorId !== query.actorId) return false;
  return true;
}

export function matchesApprovalQuery(
  request: AgentApprovalRequest,
  query: AgentApprovalQuery,
): boolean {
  if (request.organizationId !== query.organizationId) return false;
  if (query.runId && request.runId !== query.runId) return false;
  if (query.pendingOnly && request.state !== 'pending') return false;
  return true;
}

/** Newest first. Stable: ties break on run id so paging is reproducible. */
export function byNewest<T extends { createdAt: string }>(a: T, b: T): number {
  return b.createdAt.localeCompare(a.createdAt);
}

// ── In-memory implementations ───────────────────────────────────────────────

/**
 * Bounded in-memory run store.
 *
 * `maxRuns` is not decoration: an isolate that accumulated one record per run
 * forever would be a memory leak with an SLA. The oldest record is evicted
 * first, and eviction is safe precisely because this store is not the authority
 * in a deployment that has a durable one.
 */
export function createMemoryAgentRunStore(
  options: { maxRuns?: number } = {},
): AgentRunStore & { clear(): void; size(): number } {
  const maxRuns = options.maxRuns ?? 500;
  const records = new Map<string, AgentRunRecord>();
  const keyOf = (organizationId: string, runId: string) => `${organizationId}:${runId}`;

  return {
    load(organizationId, runId) {
      return Promise.resolve(records.get(keyOf(organizationId, runId)));
    },

    create(record) {
      const key = keyOf(record.context.organizationId, record.context.runId);
      if (records.has(key)) {
        return Promise.reject(
          agentFailure('persistence_failed', 'That run already exists.', {
            runId: record.context.runId,
            diagnostics: `duplicate run id ${record.context.runId}`,
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
      const key = keyOf(record.context.organizationId, record.context.runId);
      const stored = records.get(key);
      if (!stored) {
        return Promise.reject(
          agentFailure('run_not_found', 'That run no longer exists.', {
            runId: record.context.runId,
          }),
        );
      }
      if (stored.runVersion !== expectedVersion) {
        return Promise.reject(
          agentFailure('stale_run_version', 'This run has changed since it was read.', {
            runId: record.context.runId,
            diagnostics: `expected ${expectedVersion}, stored ${stored.runVersion}`,
          }),
        );
      }
      records.set(key, record);
      return Promise.resolve();
    },

    list(query) {
      const limit = boundedLimit(query.limit);
      const matched = [...records.values()]
        .filter((record) => matchesRunQuery(record, query))
        .sort(byNewest2)
        .slice(0, limit);
      return Promise.resolve(matched);
    },

    clear: () => records.clear(),
    size: () => records.size,
  };
}

/** Runs sort on their creation stamp, which lives on the record, not the context. */
function byNewest2(a: AgentRunRecord, b: AgentRunRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.context.runId.localeCompare(a.context.runId);
}

export function createMemoryCheckpointStore(
  options: { maxCheckpoints?: number } = {},
): AgentCheckpointStore & { clear(): void; size(): number } {
  const maxCheckpoints = options.maxCheckpoints ?? 5_000;
  const checkpoints = new Map<string, AgentCheckpoint>();
  const keyOf = (organizationId: string, runId: string, version: number) =>
    `${organizationId}:${runId}:${String(version).padStart(6, '0')}`;

  return {
    write(checkpoint) {
      const key = keyOf(checkpoint.organizationId, checkpoint.runId, checkpoint.version);
      if (checkpoints.has(key)) {
        return Promise.reject(
          agentFailure('checkpoint_conflict', 'That checkpoint has already been written.', {
            runId: checkpoint.runId,
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

    read(organizationId, runId, version) {
      return Promise.resolve(checkpoints.get(keyOf(organizationId, runId, version)));
    },

    latest(organizationId, runId) {
      const forRun = [...checkpoints.values()].filter(
        (checkpoint) =>
          checkpoint.organizationId === organizationId && checkpoint.runId === runId,
      );
      if (forRun.length === 0) return Promise.resolve(undefined);
      return Promise.resolve(
        forRun.reduce((best, candidate) => (candidate.version > best.version ? candidate : best)),
      );
    },

    history(organizationId, runId) {
      return Promise.resolve(
        [...checkpoints.values()]
          .filter(
            (checkpoint) =>
              checkpoint.organizationId === organizationId && checkpoint.runId === runId,
          )
          .sort((a, b) => a.version - b.version),
      );
    },

    clear: () => checkpoints.clear(),
    size: () => checkpoints.size,
  };
}

export function createMemoryApprovalStore(
  options: { maxApprovals?: number } = {},
): AgentApprovalStore & { clear(): void; size(): number } {
  const maxApprovals = options.maxApprovals ?? 1_000;
  const approvals = new Map<string, AgentApprovalRequest>();
  const keyOf = (organizationId: string, approvalId: string) => `${organizationId}:${approvalId}`;

  return {
    load(organizationId, approvalId) {
      return Promise.resolve(approvals.get(keyOf(organizationId, approvalId)));
    },

    create(request) {
      const key = keyOf(request.organizationId, request.approvalId);
      if (approvals.has(key)) {
        return Promise.reject(
          agentFailure('persistence_failed', 'That approval already exists.', {
            runId: request.runId,
            diagnostics: `duplicate approval id ${request.approvalId}`,
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
      const key = keyOf(request.organizationId, request.approvalId);
      const stored = approvals.get(key);
      if (!stored) {
        return Promise.reject(
          agentFailure('run_not_found', 'That approval no longer exists.', {
            runId: request.runId,
          }),
        );
      }
      if (stored.approvalVersion !== expectedVersion) {
        return Promise.reject(
          agentFailure('stale_run_version', 'This approval has changed since it was read.', {
            runId: request.runId,
            diagnostics: `expected ${expectedVersion}, stored ${stored.approvalVersion}`,
          }),
        );
      }
      approvals.set(key, request);
      return Promise.resolve();
    },

    list(query) {
      const limit = boundedLimit(query.limit);
      return Promise.resolve(
        [...approvals.values()]
          .filter((request) => matchesApprovalQuery(request, query))
          .sort(byNewest)
          .slice(0, limit),
      );
    },

    clear: () => approvals.clear(),
    size: () => approvals.size,
  };
}
