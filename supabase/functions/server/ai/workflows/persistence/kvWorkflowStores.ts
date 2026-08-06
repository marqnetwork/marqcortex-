/**
 * Durable workflow run storage, over the platform key-value store.
 *
 * KEYS ARE TENANT-SCOPED BY CONSTRUCTION. Every key is built by
 * `tenantScopedKey`, the same builder the rest of the AI platform uses, so a
 * key cannot be formed without its organization prefix and a prefix scan for
 * one organization is literally unable to return another's rows.
 *
 *   org:{org}:ai:workflow_run:{workflowRunId}
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
import type { WorkflowRunStore } from './ports.ts';
import { boundedLimit, matchesWorkflowRunQuery, sortWorkflowRuns } from './ports.ts';
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

const NAMESPACE = 'workflow_run';
const SCHEMA = 'ai.workflow.run.v1';

function scope(organizationId: string): { readonly isolationKey: string } {
  return { isolationKey: isolationKeyFor(organizationId) };
}

export function workflowRunKeyFor(organizationId: string, workflowRunId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE, workflowRunId);
}

export function workflowRunPrefixFor(organizationId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE, 'x').slice(0, -1);
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
        _schema: SCHEMA,
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
        _schema: SCHEMA,
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
