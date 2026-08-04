/**
 * Durable agent runtime storage, over the platform key-value store.
 *
 * KEYS ARE TENANT-SCOPED BY CONSTRUCTION. Every key is built by
 * `tenantScopedKey`, the same builder the rest of the AI platform uses, so a
 * key cannot be formed without its organization prefix and a listing cannot
 * accidentally span tenants — a prefix scan for one organization is literally
 * unable to return another's rows.
 *
 *   org:{org}:ai:agent_run:{runId}
 *   org:{org}:ai:agent_checkpoint:{runId}:{version padded to 6}
 *   org:{org}:ai:agent_approval:{approvalId}
 *
 * Checkpoint versions are zero-padded so a lexicographic prefix scan returns
 * them in numeric order. Without the padding, version 10 sorts before version 2
 * and "the latest checkpoint" becomes a full re-scan and a comparison — which
 * is exactly the kind of thing that works in a test with three checkpoints.
 *
 * CONCURRENCY. Every mutation is an atomic compare-and-swap on the record's own
 * version field, through `kv_compare_and_swap_field` (migration
 * 20260804120000). The comparison and the write are one SQL statement, so two
 * isolates advancing the same run cannot both succeed: one writes, the other
 * gets a typed `stale_run_version` and re-reads. A read-then-write pair would
 * leave a time-of-check-to-time-of-use window, and for a run record that window
 * means two isolates each taking "the next step".
 *
 * Creation uses expected version 0, which the SQL function implements as an
 * insert-if-absent. That is how a duplicate run id is refused rather than
 * silently overwriting a live run.
 *
 * WHY A NEW SQL FUNCTION RATHER THAN REUSING `kv_compare_and_swap`. That one
 * compares a field named `configurationVersion`, because it was built for the
 * single AI settings record. Naming a run's version `configurationVersion` to
 * borrow it would put a misleading field on every run record forever, and
 * calling the same function for two different meanings is how the next change
 * to one breaks the other. The new function takes the field name as an
 * argument; the old one is untouched.
 */

import type {
  AgentApprovalRequest,
  AgentCheckpoint,
  AgentRunRecord,
} from '../contracts/runtime.ts';
import type {
  AgentApprovalQuery,
  AgentApprovalStore,
  AgentCheckpointStore,
  AgentRunQuery,
  AgentRunStore,
} from './ports.ts';
import {
  boundedLimit,
  byNewest,
  matchesApprovalQuery,
  matchesRunQuery,
} from './ports.ts';
import { agentFailure } from '../contracts/failures.ts';
import { isolationKeyFor, tenantScopedKey } from '../../security/tenancy.ts';

export type KvAgentReader = (key: string) => Promise<unknown>;
export type KvAgentPrefixReader = (prefix: string) => Promise<readonly unknown[]>;
/**
 * Atomic compare-and-swap keyed by a named version field.
 *
 * Contract: write `value` at `key` if and only if the stored record's
 * `versionField` equals `expectedVersion` — or, when `expectedVersion` is 0, if
 * and only if no record exists. Resolve true when the write happened and false
 * when the precondition did not hold. The comparison and the write MUST be one
 * storage operation.
 */
export type KvAgentConditionalWriter = (
  key: string,
  versionField: string,
  expectedVersion: number,
  value: unknown,
) => Promise<boolean>;

const NAMESPACE = {
  run: 'agent_run',
  checkpoint: 'agent_checkpoint',
  approval: 'agent_approval',
} as const;

const SCHEMA = {
  run: 'ai.agent.run.v1',
  checkpoint: 'ai.agent.checkpoint.v1',
  approval: 'ai.agent.approval.v1',
} as const;

const CHECKPOINT_VERSION_WIDTH = 6;

function scope(organizationId: string): { readonly isolationKey: string } {
  return { isolationKey: isolationKeyFor(organizationId) };
}

export function runKeyFor(organizationId: string, runId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.run, runId);
}

export function runPrefixFor(organizationId: string): string {
  return `${tenantScopedKey(scope(organizationId), NAMESPACE.run, 'x').slice(0, -1)}`;
}

export function checkpointKeyFor(
  organizationId: string,
  runId: string,
  version: number,
): string {
  return tenantScopedKey(
    scope(organizationId),
    NAMESPACE.checkpoint,
    runId,
    String(Math.max(0, Math.floor(version))).padStart(CHECKPOINT_VERSION_WIDTH, '0'),
  );
}

export function checkpointPrefixFor(organizationId: string, runId: string): string {
  return `${tenantScopedKey(scope(organizationId), NAMESPACE.checkpoint, runId, 'x').slice(0, -1)}`;
}

export function approvalKeyFor(organizationId: string, approvalId: string): string {
  return tenantScopedKey(scope(organizationId), NAMESPACE.approval, approvalId);
}

export function approvalPrefixFor(organizationId: string): string {
  return `${tenantScopedKey(scope(organizationId), NAMESPACE.approval, 'x').slice(0, -1)}`;
}

/**
 * A stored value may come back as an object or as a JSON string, depending on
 * how the key-value layer wrote it. Both are handled here so every consumer
 * below sees one shape, and an unreadable blob becomes `undefined` rather than
 * an exception — a corrupt row must not make an unrelated run unreadable.
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

export interface KvAgentStoreOptions {
  readonly read: KvAgentReader;
  readonly readByPrefix: KvAgentPrefixReader;
  readonly compareAndSwap: KvAgentConditionalWriter;
  /** Called when a stored record cannot be read. Loud, never silent. */
  readonly onCorrupt?: (key: string, detail: string) => void;
}

// ── Runs ────────────────────────────────────────────────────────────────────

export function createKvAgentRunStore(options: KvAgentStoreOptions): AgentRunStore {
  function parse(raw: unknown, key: string): AgentRunRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored agent run is not a readable object');
      return undefined;
    }
    // Structural sanity only. A record that does not carry its identity and its
    // version cannot be safely written back, and guessing the missing parts
    // would produce a run whose optimistic concurrency is meaningless.
    const context = record.context as Record<string, unknown> | undefined;
    if (
      typeof record.runVersion !== 'number' ||
      typeof record.state !== 'string' ||
      typeof context?.runId !== 'string' ||
      typeof context?.organizationId !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored agent run is missing its identity or version');
      return undefined;
    }
    return record as unknown as AgentRunRecord;
  }

  return {
    async load(organizationId, runId) {
      const key = runKeyFor(organizationId, runId);
      const record = parse(await options.read(key), key);
      // Belt and braces: the key already scopes the read, and the record is
      // checked against the caller's organization anyway. A record that
      // disagrees with its own key is corrupt, not a cross-tenant read.
      if (record && record.context.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored agent run does not match the key it was read from');
        return undefined;
      }
      return record;
    },

    async create(record) {
      const key = runKeyFor(record.context.organizationId, record.context.runId);
      const won = await options.compareAndSwap(key, 'runVersion', 0, {
        ...record,
        _schema: SCHEMA.run,
      });
      if (!won) {
        throw agentFailure('persistence_failed', 'That run already exists.', {
          runId: record.context.runId,
          diagnostics: `run id ${record.context.runId} is already taken`,
        });
      }
    },

    async save(record, expectedVersion) {
      const key = runKeyFor(record.context.organizationId, record.context.runId);
      const won = await options.compareAndSwap(key, 'runVersion', expectedVersion, {
        ...record,
        _schema: SCHEMA.run,
      });
      if (!won) {
        throw agentFailure('stale_run_version', 'This run has changed since it was read.', {
          runId: record.context.runId,
          diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
        });
      }
    },

    async list(query) {
      const prefix = runPrefixFor(query.organizationId);
      const rows = await options.readByPrefix(prefix);
      const records: AgentRunRecord[] = [];
      for (const row of rows) {
        const record = parse(row, prefix);
        if (record && matchesRunQuery(record, query)) records.push(record);
      }
      return records
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) ||
            b.context.runId.localeCompare(a.context.runId),
        )
        .slice(0, boundedLimit(query.limit));
    },
  };
}

// ── Checkpoints ─────────────────────────────────────────────────────────────

export function createKvAgentCheckpointStore(
  options: KvAgentStoreOptions,
): AgentCheckpointStore {
  function parse(raw: unknown, key: string): AgentCheckpoint | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored checkpoint is not a readable object');
      return undefined;
    }
    if (
      typeof record.version !== 'number' ||
      typeof record.runId !== 'string' ||
      typeof record.organizationId !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored checkpoint is missing its identity or version');
      return undefined;
    }
    return record as unknown as AgentCheckpoint;
  }

  return {
    async write(checkpoint) {
      const key = checkpointKeyFor(
        checkpoint.organizationId,
        checkpoint.runId,
        checkpoint.version,
      );
      // Expected version 0 means insert-if-absent. A checkpoint is immutable,
      // so "the key already exists" is the whole check — there is no version to
      // compare against, because a written checkpoint is never rewritten.
      const won = await options.compareAndSwap(key, 'version', 0, {
        ...checkpoint,
        _schema: SCHEMA.checkpoint,
      });
      if (!won) {
        throw agentFailure('checkpoint_conflict', 'That checkpoint has already been written.', {
          runId: checkpoint.runId,
          diagnostics: `checkpoint version ${checkpoint.version} already exists`,
        });
      }
    },

    async read(organizationId, runId, version) {
      const key = checkpointKeyFor(organizationId, runId, version);
      return parse(await options.read(key), key);
    },

    async latest(organizationId, runId) {
      const history = await this.history(organizationId, runId);
      return history.at(-1);
    },

    async history(organizationId, runId) {
      const prefix = checkpointPrefixFor(organizationId, runId);
      const rows = await options.readByPrefix(prefix);
      const checkpoints: AgentCheckpoint[] = [];
      for (const row of rows) {
        const checkpoint = parse(row, prefix);
        if (
          checkpoint &&
          checkpoint.runId === runId &&
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

export function createKvAgentApprovalStore(options: KvAgentStoreOptions): AgentApprovalStore {
  function parse(raw: unknown, key: string): AgentApprovalRequest | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(key, 'stored approval is not a readable object');
      return undefined;
    }
    if (
      typeof record.approvalVersion !== 'number' ||
      typeof record.approvalId !== 'string' ||
      typeof record.organizationId !== 'string' ||
      typeof record.state !== 'string'
    ) {
      options.onCorrupt?.(key, 'stored approval is missing its identity, state or version');
      return undefined;
    }
    return record as unknown as AgentApprovalRequest;
  }

  return {
    async load(organizationId, approvalId) {
      const key = approvalKeyFor(organizationId, approvalId);
      const request = parse(await options.read(key), key);
      if (request && request.organizationId !== organizationId) {
        options.onCorrupt?.(key, 'stored approval does not match the key it was read from');
        return undefined;
      }
      return request;
    },

    async create(request) {
      const key = approvalKeyFor(request.organizationId, request.approvalId);
      const won = await options.compareAndSwap(key, 'approvalVersion', 0, {
        ...request,
        _schema: SCHEMA.approval,
      });
      if (!won) {
        throw agentFailure('persistence_failed', 'That approval already exists.', {
          runId: request.runId,
          diagnostics: `approval id ${request.approvalId} is already taken`,
        });
      }
    },

    async save(request, expectedVersion) {
      const key = approvalKeyFor(request.organizationId, request.approvalId);
      const won = await options.compareAndSwap(key, 'approvalVersion', expectedVersion, {
        ...request,
        _schema: SCHEMA.approval,
      });
      if (!won) {
        throw agentFailure('stale_run_version', 'This approval has changed since it was read.', {
          runId: request.runId,
          diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
        });
      }
    },

    async list(query) {
      const prefix = approvalPrefixFor(query.organizationId);
      const rows = await options.readByPrefix(prefix);
      const requests: AgentApprovalRequest[] = [];
      for (const row of rows) {
        const request = parse(row, prefix);
        if (request && matchesApprovalQuery(request, query)) requests.push(request);
      }
      return requests.sort(byNewest).slice(0, boundedLimit(query.limit));
    },
  };
}
