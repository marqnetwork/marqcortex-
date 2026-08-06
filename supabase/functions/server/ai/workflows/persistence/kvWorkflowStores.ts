/**
 * Durable workflow storage, over the platform key-value store (AI-01 Batch 3B).
 *
 * The same construction `agents/persistence/kvAgentStores.ts` uses, on the same
 * primitives, for the same reasons — and reusing them rather than inventing a
 * second storage idiom is the point.
 *
 * KEYS ARE TENANT-SCOPED BY CONSTRUCTION. Every key is built by
 * `tenantScopedKey`, so a key cannot be formed without its organization prefix
 * and a prefix scan for one organization is literally unable to return another's
 * rows.
 *
 *   org:{org}:ai:workflow_run:{workflowRunId}
 *   org:{org}:ai:workflow_checkpoint:{workflowRunId}:{version padded to 6}
 *
 * Checkpoint versions are zero-padded so a lexicographic prefix scan returns
 * them in numeric order.
 *
 * CONCURRENCY. Every mutation is an atomic compare-and-swap on the record's own
 * version field, through the SAME `kv_compare_and_swap_field` helper Batch 3A
 * introduced (migration 20260804120000) — the comparison and the write are one
 * SQL statement. A workflow needs this more than an agent run does, not less:
 * two isolates advancing the same WAVE would start the same agent runs twice,
 * and an agent run is not free.
 *
 * Creation uses expected version 0, which the helper implements as
 * insert-if-absent, so a duplicate run id is refused rather than silently
 * overwriting a live run.
 *
 * NO NEW MIGRATION. The existing function takes the version field name as an
 * argument, which is exactly why it takes one.
 */

import type { WorkflowCheckpoint, WorkflowRunRecord } from '../contracts/runtime.ts';
import type {
  WorkflowCheckpointStore,
  WorkflowRunQuery,
  WorkflowRunStore,
} from './workflowPorts.ts';
import {
  boundedWorkflowLimit,
  byNewestWorkflowRun,
  matchesWorkflowRunQuery,
} from './workflowPorts.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { isolationKeyFor, tenantScopedKey } from '../../security/tenancy.ts';

export type KvWorkflowReader = (key: string) => Promise<unknown>;
export type KvWorkflowPrefixReader = (prefix: string) => Promise<readonly unknown[]>;

/**
 * Atomic compare-and-swap keyed by a named version field.
 *
 * Structurally identical to the agent runtime's writer, and a deployment passes
 * the same function to both. Declared separately so the workflow module does not
 * import the agent persistence layer for a type alone.
 */
export type KvWorkflowConditionalWriter = (
  key: string,
  versionField: string,
  expectedVersion: number,
  value: unknown,
) => Promise<boolean>;

const NAMESPACE = {
  run: 'workflow_run',
  checkpoint: 'workflow_checkpoint',
} as const;

const SCHEMA = {
  run: 'ai.workflow.run.v1',
  checkpoint: 'ai.workflow.checkpoint.v1',
} as const;

const CHECKPOINT_VERSION_WIDTH = 6;

function scope(organizationId: string): { readonly isolationKey: string } {
  return { isolationKey: isolationKeyFor(organizationId) };
}

export function workflowRunKeyFor(organizationId: string, workflowRunId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.run, workflowRunId);
}

export function workflowRunPrefixFor(organizationId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.run, 'x').slice(0, -1);
}

export function workflowCheckpointKeyFor(
  organizationId: string,
  workflowRunId: string,
  version: number,
): string {
  return tenantScopedKey(
    scope(organizationId),
    NAMESPACE.checkpoint,
    workflowRunId,
    String(Math.max(0, Math.floor(version))).padStart(CHECKPOINT_VERSION_WIDTH, '0'),
  );
}

export function workflowCheckpointPrefixFor(
  organizationId: string,
  workflowRunId: string,
): string {
  return tenantScopedKey(
    scope(organizationId),
    NAMESPACE.checkpoint,
    workflowRunId,
    'x',
  ).slice(0, -1);
}

/**
 * A stored value may come back as an object or as a JSON string, depending on
 * how the key-value layer wrote it. Both are handled here, and an unreadable
 * blob becomes `undefined` rather than an exception — one corrupt row must not
 * make an unrelated workflow run unreadable.
 */
function coerce(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return undefined;
}

export interface KvWorkflowStoreOptions {
  readonly read: KvWorkflowReader;
  readonly readByPrefix: KvWorkflowPrefixReader;
  readonly compareAndSwap: KvWorkflowConditionalWriter;
  /** Called when a stored record cannot be read. Loud, never silent. */
  readonly onCorrupt?: (key: string, detail: string) => void;
}

// ── Runs ────────────────────────────────────────────────────────────────────

export function createKvWorkflowRunStore(options: KvWorkflowStoreOptions): WorkflowRunStore {
  function parse(raw: unknown, key: string): WorkflowRunRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored workflow run is not a readable object');
      return undefined;
    }
    // Structural sanity only. A record that does not carry its identity and its
    // version cannot be safely written back, and guessing the missing parts
    // would produce a run whose optimistic concurrency is meaningless.
    const context = record.context as Record<string, unknown> | undefined;
    if (
      typeof record.runVersion !== 'number' ||
      typeof record.state !== 'string' ||
      typeof context?.workflowRunId !== 'string' ||
      typeof context?.organizationId !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored workflow run is missing its identity or version');
      return undefined;
    }
    return record as unknown as WorkflowRunRecord;
  }

  return {
    async load(organizationId, workflowRunId) {
      const key = workflowRunKeyFor(organizationId, workflowRunId);
      const record = parse(await options.read(key), key);
      // Belt and braces: the key already scopes the read. A record that
      // disagrees with its own key is corrupt, not a cross-tenant read.
      if (record && record.context.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored workflow run does not match the key it was read from');
        return undefined;
      }
      return record;
    },

    async create(record) {
      const key = workflowRunKeyFor(
        record.context.organizationId,
        record.context.workflowRunId,
      );
      const won = await options.compareAndSwap(key, 'runVersion', 0, {
        ...record,
        _schema: SCHEMA.run,
      });
      if (!won) {
        throw workflowFailure('workflow_persistence_failed', 'That workflow run already exists.', {
          workflowRunId: record.context.workflowRunId,
          diagnostics: `workflow run id ${record.context.workflowRunId} is already taken`,
        });
      }
    },

    async save(record, expectedVersion) {
      const key = workflowRunKeyFor(
        record.context.organizationId,
        record.context.workflowRunId,
      );
      const won = await options.compareAndSwap(key, 'runVersion', expectedVersion, {
        ...record,
        _schema: SCHEMA.run,
      });
      if (!won) {
        throw workflowFailure(
          'stale_workflow_version',
          'This workflow run has changed since it was read.',
          {
            workflowRunId: record.context.workflowRunId,
            diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
          },
        );
      }
    },

    async list(query: WorkflowRunQuery) {
      const prefix = workflowRunPrefixFor(query.organizationId);
      const rows = await options.readByPrefix(prefix);
      const records: WorkflowRunRecord[] = [];
      for (const row of rows) {
        const record = parse(row, prefix);
        if (record && matchesWorkflowRunQuery(record, query)) records.push(record);
      }
      return records.sort(byNewestWorkflowRun).slice(0, boundedWorkflowLimit(query.limit));
    },
  };
}

// ── Checkpoints ─────────────────────────────────────────────────────────────

export function createKvWorkflowCheckpointStore(
  options: KvWorkflowStoreOptions,
): WorkflowCheckpointStore {
  function parse(raw: unknown, key: string): WorkflowCheckpoint | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored workflow checkpoint is not a readable object');
      return undefined;
    }
    if (
      typeof record.version !== 'number' ||
      typeof record.workflowRunId !== 'string' ||
      typeof record.organizationId !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored workflow checkpoint is missing its identity or version');
      return undefined;
    }
    return record as unknown as WorkflowCheckpoint;
  }

  return {
    async write(checkpoint) {
      const key = workflowCheckpointKeyFor(
        checkpoint.organizationId,
        checkpoint.workflowRunId,
        checkpoint.version,
      );
      // Expected version 0 means insert-if-absent. A checkpoint is immutable, so
      // "the key already exists" is the whole check — there is no version to
      // compare against, because a written checkpoint is never rewritten.
      const won = await options.compareAndSwap(key, 'version', 0, {
        ...checkpoint,
        _schema: SCHEMA.checkpoint,
      });
      if (!won) {
        throw workflowFailure(
          'workflow_checkpoint_conflict',
          'That checkpoint has already been written.',
          {
            workflowRunId: checkpoint.workflowRunId,
            diagnostics: `checkpoint version ${checkpoint.version} already exists`,
          },
        );
      }
    },

    async read(organizationId, workflowRunId, version) {
      const key = workflowCheckpointKeyFor(organizationId, workflowRunId, version);
      return parse(await options.read(key), key);
    },

    async latest(organizationId, workflowRunId) {
      const history = await this.history(organizationId, workflowRunId);
      return history.at(-1);
    },

    async history(organizationId, workflowRunId) {
      const prefix = workflowCheckpointPrefixFor(organizationId, workflowRunId);
      const rows = await options.readByPrefix(prefix);
      const checkpoints: WorkflowCheckpoint[] = [];
      for (const row of rows) {
        const checkpoint = parse(row, prefix);
        if (
          checkpoint &&
          checkpoint.workflowRunId === workflowRunId &&
          checkpoint.organizationId === organizationId
        ) {
          checkpoints.push(checkpoint);
        }
      }
      return checkpoints.sort((a, b) => a.version - b.version);
    },
  };
}
