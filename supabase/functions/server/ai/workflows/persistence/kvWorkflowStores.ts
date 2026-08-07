/**
 * Durable workflow run storage, over the platform key-value store.
 *
 * KEYS ARE TENANT-SCOPED BY CONSTRUCTION. Every key is built by
 * `tenantScopedKey`, the same builder the rest of the AI platform uses, so a
 * key cannot be formed without its organization prefix and a prefix scan for
 * one organization is literally unable to return another's rows.
 *
 *   org:{org}:ai:workflow_run:{workflowRunId}
 *   org:{org}:ai:workflow_checkpoint:{workflowRunId}:{version padded to 6}
 *   org:{org}:ai:workflow_approval:{workflowApprovalId}
 *
 * The approval key is scoped by ORGANIZATION and not by run, and that is what
 * makes an operator queue a single prefix scan rather than a walk of every run
 * a tenant has. The run id is inside the approval id and on the record, so
 * "this run's approvals" is still answerable — it is simply not the access
 * pattern the key is shaped for, because it is not the one an approver uses.
 *
 * Checkpoint versions are zero-padded so a lexicographic prefix scan returns
 * them in numeric order. Without the padding, version 10 sorts before version 2
 * and "the latest checkpoint" becomes a full re-scan and a comparison — which
 * is exactly the kind of thing that works in a test with three checkpoints.
 *
 * CONCURRENCY. Every mutation is an atomic compare-and-swap on the record's own
 * `runVersion` field, through the same `kv_compare_and_swap_field` contract
 * Batch 3A's agent stores use (migration 20260804120000). The comparison and
 * the write are one storage operation, so two isolates advancing the same
 * workflow cannot both succeed: one writes, the other gets a typed
 * `stale_workflow_version` and re-reads. A read-then-write pair would leave a
 * time-of-check-to-time-of-use window, and for a workflow record that window
 * means two isolates each starting "the next node" — two child agent runs for
 * one node, with two sets of effects.
 *
 * Creation uses expected version 0, which the SQL function implements as an
 * insert-if-absent. That is how a duplicate run id is refused rather than
 * silently overwriting a live run.
 *
 * NO NEW MIGRATION. This store reuses the existing field-named CAS function
 * rather than adding one, because the contract it needs is exactly the contract
 * that already exists — a second SQL function differing only in the table it
 * was written for is how two implementations of one guarantee begin.
 */

import type { WorkflowRunRecord } from '../contracts/run.ts';
import type { WorkflowCheckpoint } from '../contracts/checkpoint.ts';
import type { WorkflowApprovalRecord } from '../contracts/approval.ts';
import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from './ports.ts';
import {
  boundedLimit,
  matchesWorkflowApprovalQuery,
  matchesWorkflowRunQuery,
  sortWorkflowApprovals,
  sortWorkflowRuns,
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

export function workflowApprovalKeyFor(
  organizationId: string,
  workflowApprovalId: string,
): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.approval, workflowApprovalId);
}

export function workflowApprovalPrefixFor(organizationId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.approval, 'x').slice(0, -1);
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
 * how the key-value layer wrote it. Both are handled here so every consumer
 * sees one shape, and an unreadable blob becomes `undefined` rather than an
 * exception — a corrupt row must not make an unrelated run unreadable.
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
      // Belt and braces: the key already scopes the read, and the record is
      // checked against the caller's organization anyway. A record that
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
        throw workflowFailure('workflow_persistence_failed', 'That run already exists.', {
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
      return sortWorkflowRuns(records).slice(0, boundedLimit(query.limit));
    },
  };
}

// ── Checkpoints ─────────────────────────────────────────────────────────────

/**
 * Durable, append-only checkpoint storage.
 *
 * `write` uses expected version 0, which the CAS function implements as
 * insert-if-absent. That single call IS the immutability guarantee: there is no
 * code path in this module that can overwrite a written checkpoint, because
 * there is no call that passes a non-zero expected version. A checkpoint's own
 * `version` field is its identity, not its concurrency token — it never moves,
 * so there is nothing to compare against.
 */
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
      typeof record.digest !== 'string' ||
      typeof record.workflowRunId !== 'string' ||
      typeof record.organizationId !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored workflow checkpoint is missing its identity or digest');
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

    async latest(organizationId, workflowRunId) {
      const all = await this.history(organizationId, workflowRunId);
      return all[all.length - 1];
    },

    async read(organizationId, workflowRunId, version) {
      const key = workflowCheckpointKeyFor(organizationId, workflowRunId, version);
      const checkpoint = parse(await options.read(key), key);
      if (checkpoint && checkpoint.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored checkpoint does not match the key it was read from');
        return undefined;
      }
      return checkpoint;
    },

    async history(organizationId, workflowRunId) {
      const prefix = workflowCheckpointPrefixFor(organizationId, workflowRunId);
      const rows = await options.readByPrefix(prefix);
      const checkpoints: WorkflowCheckpoint[] = [];
      for (const row of rows) {
        const checkpoint = parse(row, prefix);
        if (checkpoint && checkpoint.organizationId === organizationId) {
          checkpoints.push(checkpoint);
        }
      }
      // Sorted numerically rather than trusting the scan. The padded keys make
      // the two orders agree, and relying on that agreement without asserting it
      // would make "the latest checkpoint" depend on a key-format detail.
      return checkpoints.sort((a, b) => a.version - b.version);
    },
  };
}

// ── Approvals ───────────────────────────────────────────────────────────────

/**
 * Durable approval storage (AI-01 Batch 3B, Part 5).
 *
 * Read-modify-write under the same field-named compare-and-swap the run store
 * uses, on the approval's OWN `approvalVersion`. That single choice is what
 * makes "single use" a guarantee rather than an intention: two advances racing
 * to spend one approved request both read version N and both try to write N+1,
 * and the storage layer lets exactly one of them win. The loser is told the
 * approval moved, re-reads, and finds it consumed.
 *
 * `create` uses expected version 0 — insert-if-absent — so a recomputed
 * deterministic id never silently overwrites a decision somebody has already
 * made or is about to.
 *
 * NO NEW MIGRATION, for the reason stated at the top of this file: the contract
 * this needs is exactly the contract that already exists.
 */
export function createKvWorkflowApprovalStore(
  options: KvWorkflowStoreOptions,
): WorkflowApprovalStore {
  function parse(raw: unknown, key: string): WorkflowApprovalRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored workflow approval is not a readable object');
      return undefined;
    }
    // Structural sanity only. A record that does not carry its identity, its
    // tenant and its version cannot be safely written back, and guessing the
    // missing parts would produce an approval whose single-use guarantee is
    // meaningless.
    if (
      typeof record.approvalVersion !== 'number' ||
      typeof record.approvalState !== 'string' ||
      typeof record.workflowApprovalId !== 'string' ||
      typeof record.workflowRunId !== 'string' ||
      typeof record.organizationId !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored workflow approval is missing its identity or version');
      return undefined;
    }
    return record as unknown as WorkflowApprovalRecord;
  }

  return {
    async load(organizationId, workflowApprovalId) {
      const key = workflowApprovalKeyFor(organizationId, workflowApprovalId);
      const record = parse(await options.read(key), key);
      // Belt and braces: the key already scopes the read, and the record is
      // checked against the caller's organization anyway. "The key was right"
      // and "this belongs to this tenant" are different claims.
      if (record && record.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored workflow approval does not match the key it came from');
        return undefined;
      }
      return record;
    },

    async create(record) {
      const key = workflowApprovalKeyFor(record.organizationId, record.workflowApprovalId);
      const won = await options.compareAndSwap(key, 'approvalVersion', 0, {
        ...record,
        _schema: SCHEMA.approval,
      });
      if (!won) {
        throw workflowFailure(
          'workflow_approval_conflict',
          'That approval has already been requested.',
          {
            workflowRunId: record.workflowRunId,
            nodeId: record.nodeId,
            diagnostics: `approval id ${record.workflowApprovalId} is already taken`,
          },
        );
      }
    },

    async save(record, expectedVersion) {
      const key = workflowApprovalKeyFor(record.organizationId, record.workflowApprovalId);
      const won = await options.compareAndSwap(key, 'approvalVersion', expectedVersion, {
        ...record,
        _schema: SCHEMA.approval,
      });
      if (!won) {
        throw workflowFailure(
          'stale_workflow_approval',
          'This approval has changed since it was read.',
          {
            workflowRunId: record.workflowRunId,
            diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
          },
        );
      }
    },

    async list(query) {
      const prefix = workflowApprovalPrefixFor(query.organizationId);
      const rows = await options.readByPrefix(prefix);
      const records: WorkflowApprovalRecord[] = [];
      for (const row of rows) {
        const record = parse(row, prefix);
        if (record && matchesWorkflowApprovalQuery(record, query)) records.push(record);
      }
      return sortWorkflowApprovals(records).slice(0, boundedLimit(query.limit));
    },
  };
}
