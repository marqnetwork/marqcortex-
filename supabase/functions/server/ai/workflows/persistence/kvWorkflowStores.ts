/**
 * Durable workflow storage, over the platform key-value store (AI-01 Batch 3B).
 *
 * KEYS ARE TENANT-SCOPED BY CONSTRUCTION. Every key is built by
 * `tenantScopedKey`, the same builder the rest of the AI platform uses, so a key
 * cannot be formed without its organization prefix and a listing cannot
 * accidentally span tenants — a prefix scan for one organization is literally
 * unable to return another's rows.
 *
 *   org:{org}:ai:workflow_run:{workflowRunId}
 *   org:{org}:ai:workflow_checkpoint:{workflowRunId}:{version padded to 6}
 *   org:{org}:ai:workflow_approval:{workflowApprovalId}
 *
 * Checkpoint versions are zero-padded so a lexicographic prefix scan returns them
 * in numeric order. Without the padding, version 10 sorts before version 2 and
 * "the latest checkpoint" becomes a full re-scan and a comparison — exactly the
 * kind of thing that works in a test with three checkpoints.
 *
 * CONCURRENCY. Every mutation is an atomic compare-and-swap on the record's own
 * version field, through `kv_compare_and_swap_field` (migration 20260804120000 —
 * the same function Batch 3A introduced, reused rather than duplicated). The
 * comparison and the write are one SQL statement, so two isolates advancing the
 * same workflow cannot both succeed: one writes, the other gets a typed
 * `stale_workflow_version` and re-reads. A read-then-write pair would leave a
 * time-of-check-to-time-of-use window, and for a fan-out that window means two
 * isolates each opening the same branch.
 *
 * Creation uses expected version 0, which the SQL function implements as an
 * insert-if-absent. That is how a duplicate run id is refused rather than
 * silently overwriting a live run.
 *
 * A CORRUPT ROW IS NOT AN OUTAGE. Every parse failure resolves to `undefined` and
 * calls `onCorrupt` loudly, so one unreadable record cannot make an unrelated
 * workflow unreadable.
 */

import type {
  WorkflowApprovalRequest,
  WorkflowCheckpoint,
  WorkflowRunRecord,
} from '../contracts/runtime.ts';
import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from './ports.ts';
import {
  boundedLimit,
  byNewestApproval,
  matchesWorkflowApprovalQuery,
  matchesWorkflowRunQuery,
} from './ports.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { isolationKeyFor, tenantScopedKey } from '../../security/tenancy.ts';

export type KvWorkflowReader = (key: string) => Promise<unknown>;
export type KvWorkflowPrefixReader = (prefix: string) => Promise<readonly unknown[]>;

/**
 * Atomic compare-and-swap keyed by a named version field.
 *
 * Contract: write `value` at `key` if and only if the stored record's
 * `versionField` equals `expectedVersion` — or, when `expectedVersion` is 0, if
 * and only if no record exists. Resolve true when the write happened and false
 * when the precondition did not hold. The comparison and the write MUST be one
 * storage operation.
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
  approval: 'workflow_approval',
} as const;

const SCHEMA = {
  run: 'ai.workflow.run.v1',
  checkpoint: 'ai.workflow.checkpoint.v1',
  approval: 'ai.workflow.approval.v1',
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

export function workflowApprovalKeyFor(
  organizationId: string,
  workflowApprovalId: string,
): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.approval, workflowApprovalId);
}

export function workflowApprovalPrefixFor(organizationId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.approval, 'x').slice(0, -1);
}

/**
 * A stored value may come back as an object or as a JSON string, depending on how
 * the key-value layer wrote it. Both are handled here so every consumer below
 * sees one shape, and an unreadable blob becomes `undefined` rather than an
 * exception.
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
    // version cannot be safely written back, and guessing the missing parts would
    // produce a run whose optimistic concurrency is meaningless.
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
      // Belt and braces: the key already scopes the read, and the record is
      // checked against the caller's organization anyway. A record that disagrees
      // with its own key is corrupt, not a cross-tenant read.
      if (record && record.context.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored workflow run does not match the key it was read from');
        return undefined;
      }
      return record;
    },

    async create(record) {
      const key = workflowRunKeyFor(record.context.organizationId, record.context.workflowRunId);
      const won = await options.compareAndSwap(key, 'runVersion', 0, {
        ...record,
        _schema: SCHEMA.run,
      });
      if (!won) {
        throw workflowFailure('persistence_failed', 'That workflow run already exists.', {
          workflowRunId: record.context.workflowRunId,
          diagnostics: `workflow run id ${record.context.workflowRunId} is already taken`,
        });
      }
    },

    async save(record, expectedVersion) {
      const key = workflowRunKeyFor(record.context.organizationId, record.context.workflowRunId);
      const won = await options.compareAndSwap(key, 'runVersion', expectedVersion, {
        ...record,
        _schema: SCHEMA.run,
      });
      if (!won) {
        throw workflowFailure('stale_workflow_version', 'This run has changed since it was read.', {
          workflowRunId: record.context.workflowRunId,
          diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
        });
      }
    },

    async list(query) {
      const prefix = workflowRunPrefixFor(query.organizationId);
      const rows = await options.readByPrefix(prefix);
      const records: WorkflowRunRecord[] = [];
      for (const row of rows) {
        const record = parse(row, prefix);
        if (record && matchesWorkflowRunQuery(record, query)) records.push(record);
      }
      return records
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) ||
            b.context.workflowRunId.localeCompare(a.context.workflowRunId),
        )
        .slice(0, boundedLimit(query.limit));
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
        throw workflowFailure('checkpoint_conflict', 'That checkpoint has already been written.', {
          workflowRunId: checkpoint.workflowRunId,
          diagnostics: `checkpoint version ${checkpoint.version} already exists`,
        });
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

// ── Approvals ───────────────────────────────────────────────────────────────

export function createKvWorkflowApprovalStore(
  options: KvWorkflowStoreOptions,
): WorkflowApprovalStore {
  function parse(raw: unknown, key: string): WorkflowApprovalRequest | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored workflow approval is not a readable object');
      return undefined;
    }
    if (
      typeof record.approvalVersion !== 'number' ||
      typeof record.workflowApprovalId !== 'string' ||
      typeof record.organizationId !== 'string' ||
      typeof record.state !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored workflow approval is missing its identity, state or version');
      return undefined;
    }
    return record as unknown as WorkflowApprovalRequest;
  }

  return {
    async load(organizationId, workflowApprovalId) {
      const key = workflowApprovalKeyFor(organizationId, workflowApprovalId);
      const request = parse(await options.read(key), key);
      if (request && request.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored workflow approval does not match the key it was read from');
        return undefined;
      }
      return request;
    },

    async create(request) {
      const key = workflowApprovalKeyFor(request.organizationId, request.workflowApprovalId);
      const won = await options.compareAndSwap(key, 'approvalVersion', 0, {
        ...request,
        _schema: SCHEMA.approval,
      });
      if (!won) {
        throw workflowFailure('persistence_failed', 'That approval already exists.', {
          workflowRunId: request.workflowRunId,
          diagnostics: `approval id ${request.workflowApprovalId} is already taken`,
        });
      }
    },

    async save(request, expectedVersion) {
      const key = workflowApprovalKeyFor(request.organizationId, request.workflowApprovalId);
      const won = await options.compareAndSwap(key, 'approvalVersion', expectedVersion, {
        ...request,
        _schema: SCHEMA.approval,
      });
      if (!won) {
        throw workflowFailure(
          'stale_workflow_version',
          'This approval has changed since it was read.',
          {
            workflowRunId: request.workflowRunId,
            diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
          },
        );
      }
    },

    async list(query) {
      const prefix = workflowApprovalPrefixFor(query.organizationId);
      const rows = await options.readByPrefix(prefix);
      const requests: WorkflowApprovalRequest[] = [];
      for (const row of rows) {
        const request = parse(row, prefix);
        if (request && matchesWorkflowApprovalQuery(request, query)) requests.push(request);
      }
      return requests.sort(byNewestApproval).slice(0, boundedLimit(query.limit));
    },
  };
}
