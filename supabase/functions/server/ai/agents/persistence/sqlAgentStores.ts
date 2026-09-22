/**
 * Durable agent run storage, over PostgreSQL (A2-P07).
 *
 * THE SAME THREE PORTS, A DIFFERENT AUTHORITY UNDERNEATH — AND NOT YET THE
 * PRODUCTION ONE. `kvAgentStores.ts` is what `ai/bootstrap.ts` constructs and
 * it stays that way through this phase. What is here is a replacement
 * CANDIDATE, proven equivalent against a live local PostgreSQL before anything
 * is asked to move. Transition, backfill and cutover belong to later, gated
 * phases.
 *
 * The shape is `workflows/persistence/sqlWorkflowStores.ts`'s, deliberately,
 * and the arguments made there hold here unchanged:
 *
 *   ONE VERB. `AgentSqlGateway` has `rpc` and nothing else, and every operation
 *   is one of the twelve functions in migration `20260922120002`, each scoped
 *   by `p_organization_id`. A port that cannot express a cross-tenant question
 *   is stronger than a rule that nobody asks one. No Supabase client lives in
 *   this folder; the composition hands the port in.
 *
 *   THE STORES ARE THIN. Every guarantee — insert-if-absent, the version
 *   compare-and-swap, append-only checkpoints, tenant-safe references, the
 *   approval lifecycle — is made by the SQL. This file translates.
 *
 *   THE ORDERING IS THE PORTS'. The functions return a tie-inclusive candidate
 *   set and the SAME comparators the memory and key-value stores use decide
 *   the order and the cut.
 *
 * ── PARITY WITH THE CURRENT AUTHORITY, INCLUDING WHERE IT IS WORSE ─────────
 *
 * `save` against a record that is not stored: the SQL function can say
 * `missing`, and this store still raises `stale_run_version`, because that is
 * what `kv_compare_and_swap_field` makes the production store raise. A store
 * whose callers behave differently after a cutover is exactly what a parity
 * gate exists to prevent. The richer word is kept in the function for a later,
 * deliberate adoption.
 *
 * ── WHERE THIS IS STRICTER, AND WHY IT IS SAID ────────────────────────────
 *
 * `organization_id` is a UUID with a foreign key. The key-value store accepts
 * any identifier the tenancy grammar admits, including the slug-shaped
 * default. A tenant the relational authority cannot name is a tenant these
 * stores cannot WRITE — a typed `persistence_failed`, never a silent success —
 * and a READ for it returns nothing, which is the true answer: an organization
 * with no row has no records. That is a CUTOVER PRECONDITION, the same one
 * BP-003 named for workflows, and it is repeated here because a precondition
 * recorded only in a report is one nobody reads.
 *
 * Referential integrity is also stricter: a checkpoint or approval for a run
 * that was never created is refused here and accepted by the key-value store.
 * The agent runtime never produces one — `runs.create` precedes the entry
 * checkpoint, and an approval is requested from inside a running step — so
 * the difference is declared by the contract harness (`seedRun`) rather than
 * papered over.
 *
 * ── WHAT A LOADED RECORD LOOKS LIKE ───────────────────────────────────────
 *
 * The key-value store writes `_schema` onto every value and hands it back on
 * read. A table needs no such marker, so a record loaded from here does not
 * carry one. No domain code reads `_schema`; the contract suite asserts the
 * fields the domain does read.
 */

import type {
  AgentApprovalRequest,
  AgentCheckpoint,
  AgentRunRecord,
} from '../contracts/runtime.ts';
import type { AgentApprovalStore, AgentCheckpointStore, AgentRunStore } from './ports.ts';
import {
  boundedLimit,
  byNewest,
  byNewestRun,
  matchesApprovalQuery,
  matchesRunQuery,
} from './ports.ts';
import { agentFailure } from '../contracts/failures.ts';

// ── The port ────────────────────────────────────────────────────────────────

/**
 * One verb. Invoke the named SQL function with the named arguments and resolve
 * its result — rows for a set-returning function, a boolean or a string for
 * the others. Reject when the database refuses.
 */
export interface AgentSqlGateway {
  rpc(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface SqlAgentStoreOptions {
  readonly gateway: AgentSqlGateway;
  /** Called when a stored record cannot be read. Loud, never silent. */
  readonly onCorrupt?: (location: string, detail: string) => void;
}

export const AGENT_RPC = {
  runCreate: 'agent_run_create',
  runSave: 'agent_run_save',
  runLoad: 'agent_run_load',
  runList: 'agent_run_list',
  checkpointAppend: 'agent_checkpoint_append',
  checkpointRead: 'agent_checkpoint_read',
  checkpointLatest: 'agent_checkpoint_latest',
  checkpointHistory: 'agent_checkpoint_history',
  approvalCreate: 'agent_approval_create',
  approvalSave: 'agent_approval_save',
  approvalLoad: 'agent_approval_load',
  approvalList: 'agent_approval_list',
} as const;

export type SqlSaveOutcome = 'saved' | 'stale' | 'missing';

const ORGANIZATION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tenant the relational authority can name. See the header. */
export function isRelationalOrganizationId(organizationId: string): boolean {
  return ORGANIZATION_UUID.test(organizationId);
}

// ── Row and payload handling ────────────────────────────────────────────────

/** Object or JSON string — the same tolerance `kvAgentStores.ts` applies. */
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

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];
  return result.filter(
    (row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null && !Array.isArray(row),
  );
}

/** The record column. Everything else on the row is a CHECKed projection of it. */
function payloadOf(row: Record<string, unknown>): Record<string, unknown> | undefined {
  return coerce(row.record);
}

function saveOutcome(result: unknown): SqlSaveOutcome {
  return result === 'saved' || result === 'stale' || result === 'missing' ? result : 'stale';
}

function created(result: unknown): boolean {
  return result === true;
}

/**
 * A database refusal, turned into the agent failure vocabulary.
 *
 * NO RAW POSTGRES ERROR REACHES THE ORCHESTRATOR. Its failure handling is a
 * state machine over `AgentFailureCode`; a constraint name or SQLSTATE is a
 * sentence about storage, kept bounded in `diagnostics` (server-side only) and
 * never in the caller-facing message. `persistence_failed` is the code the
 * key-value store's callers already handle, and it is retryable.
 *
 * A failure this module raised on purpose passes straight through, so a typed
 * stale-version conflict is not re-wrapped as a generic persistence failure.
 */
const MAX_DIAGNOSTIC = 300;

function isAgentFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { failure?: unknown }).failure === 'string'
  );
}

async function mapped<T>(
  call: () => Promise<T>,
  context: { readonly runId?: string; readonly what: string },
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isAgentFailure(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw agentFailure('persistence_failed', 'That agent state is unavailable.', {
      ...(context.runId ? { runId: context.runId } : {}),
      diagnostics: `${context.what}: ${detail.slice(0, MAX_DIAGNOSTIC)}`,
    });
  }
}

function unnameableTenant(organizationId: string, runId: string, what: string): never {
  throw agentFailure('persistence_failed', `That ${what} could not be stored.`, {
    runId,
    diagnostics:
      `organization ${organizationId} is not a relational organization id; ` +
      'the SQL agent stores require a UUID that exists in public.organizations',
  });
}

// ── Runs ────────────────────────────────────────────────────────────────────

export function createSqlAgentRunStore(options: SqlAgentStoreOptions): AgentRunStore {
  function parse(raw: unknown, location: string): AgentRunRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(location, 'stored agent run is not a readable object');
      return undefined;
    }
    // The SAME four fields the key-value store checks.
    const context = record.context as Record<string, unknown> | undefined;
    if (
      typeof record.runVersion !== 'number' ||
      typeof record.state !== 'string' ||
      typeof context?.runId !== 'string' ||
      typeof context?.organizationId !== 'string'
    ) {
      options.onCorrupt?.(location, 'stored agent run is missing its identity or version');
      return undefined;
    }
    return record as unknown as AgentRunRecord;
  }

  function projectionOf(record: AgentRunRecord): Record<string, unknown> {
    return {
      p_organization_id: record.context.organizationId,
      p_agent_run_id: record.context.runId,
      p_state: record.state,
      p_run_version: record.runVersion,
      p_checkpoint_version: record.checkpointVersion,
      p_updated_at: record.updatedAt,
      p_record: record,
    };
  }

  return {
    async load(organizationId, runId) {
      if (!isRelationalOrganizationId(organizationId)) return undefined;
      const result = await mapped(
        () =>
          options.gateway.rpc(AGENT_RPC.runLoad, {
            p_organization_id: organizationId,
            p_agent_run_id: runId,
          }),
        { runId, what: 'loading the run' },
      );
      const row = rows(result)[0];
      if (!row) return undefined;
      const location = `${AGENT_RPC.runLoad}:${organizationId}:${runId}`;
      const record = parse(payloadOf(row), location);
      if (record && record.context.organizationId !== organizationId) {
        options.onCorrupt?.(location, 'stored agent run does not match the tenant it was read for');
        return undefined;
      }
      return record;
    },

    async create(record) {
      if (!isRelationalOrganizationId(record.context.organizationId)) {
        unnameableTenant(record.context.organizationId, record.context.runId, 'run');
      }
      const won = created(
        await mapped(
          () =>
            options.gateway.rpc(AGENT_RPC.runCreate, {
              ...projectionOf(record),
              p_agent_id: record.context.agentId,
              p_actor_id: record.context.actorId,
              p_created_at: record.createdAt,
            }),
          { runId: record.context.runId, what: 'creating the run' },
        ),
      );
      if (!won) {
        // The same failure, message and diagnostic shape the key-value store
        // raises: a caller must not be able to tell which store refused it.
        throw agentFailure('persistence_failed', 'That run already exists.', {
          runId: record.context.runId,
          diagnostics: `run id ${record.context.runId} is already taken`,
        });
      }
    },

    async save(record, expectedVersion) {
      if (!isRelationalOrganizationId(record.context.organizationId)) {
        unnameableTenant(record.context.organizationId, record.context.runId, 'run');
      }
      const outcome = saveOutcome(
        await mapped(
          () =>
            options.gateway.rpc(AGENT_RPC.runSave, {
              ...projectionOf(record),
              p_expected_version: expectedVersion,
            }),
          { runId: record.context.runId, what: 'saving the run' },
        ),
      );
      if (outcome === 'saved') return;
      // `missing` collapses into the stale failure, as the production store
      // reports it. See the header.
      throw agentFailure('stale_run_version', 'This run has changed since it was read.', {
        runId: record.context.runId,
        diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
      });
    },

    async list(query) {
      if (!isRelationalOrganizationId(query.organizationId)) return [];
      const result = await mapped(
        () =>
          options.gateway.rpc(AGENT_RPC.runList, {
            p_organization_id: query.organizationId,
            p_states: query.states && query.states.length > 0 ? [...query.states] : null,
            p_agent_id: query.agentId ?? null,
            p_actor_id: query.actorId ?? null,
            p_limit: boundedLimit(query.limit),
          }),
        { what: 'listing runs' },
      );
      const location = `${AGENT_RPC.runList}:${query.organizationId}`;
      const records: AgentRunRecord[] = [];
      for (const row of rows(result)) {
        const record = parse(payloadOf(row), location);
        // The domain's own predicate decides what the query MEANS; the SQL only
        // bounded and indexed the scan.
        if (record && matchesRunQuery(record, query)) records.push(record);
      }
      return records.sort(byNewestRun).slice(0, boundedLimit(query.limit));
    },
  };
}

// ── Checkpoints ─────────────────────────────────────────────────────────────

export function createSqlAgentCheckpointStore(
  options: SqlAgentStoreOptions,
): AgentCheckpointStore {
  function parse(raw: unknown, location: string): AgentCheckpoint | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(location, 'stored checkpoint is not a readable object');
      return undefined;
    }
    // The key-value store's three structural fields.
    if (
      typeof record.version !== 'number' ||
      typeof record.runId !== 'string' ||
      typeof record.organizationId !== 'string'
    ) {
      options.onCorrupt?.(location, 'stored checkpoint is missing its identity or version');
      return undefined;
    }
    return record as unknown as AgentCheckpoint;
  }

  function collect(result: unknown, organizationId: string, runId: string, location: string) {
    const checkpoints: AgentCheckpoint[] = [];
    for (const row of rows(result)) {
      const checkpoint = parse(payloadOf(row), location);
      if (checkpoint && checkpoint.organizationId === organizationId && checkpoint.runId === runId) {
        checkpoints.push(checkpoint);
      }
    }
    return checkpoints;
  }

  return {
    async write(checkpoint) {
      if (!isRelationalOrganizationId(checkpoint.organizationId)) {
        unnameableTenant(checkpoint.organizationId, checkpoint.runId, 'checkpoint');
      }
      const won = created(
        await mapped(
          () =>
            options.gateway.rpc(AGENT_RPC.checkpointAppend, {
              p_organization_id: checkpoint.organizationId,
              p_agent_run_id: checkpoint.runId,
              p_version: checkpoint.version,
              p_progress_digest: checkpoint.progressDigest,
              p_previous_digest: checkpoint.previousDigest ?? null,
              p_agent_id: checkpoint.agentId,
              p_state: checkpoint.state,
              p_step_count: checkpoint.stepCount,
              p_created_at: checkpoint.createdAt,
              p_record: checkpoint,
            }),
          { runId: checkpoint.runId, what: 'appending the checkpoint' },
        ),
      );
      if (!won) {
        throw agentFailure('checkpoint_conflict', 'That checkpoint has already been written.', {
          runId: checkpoint.runId,
          diagnostics: `checkpoint version ${checkpoint.version} already exists`,
        });
      }
    },

    async read(organizationId, runId, version) {
      if (!isRelationalOrganizationId(organizationId)) return undefined;
      const result = await mapped(
        () =>
          options.gateway.rpc(AGENT_RPC.checkpointRead, {
            p_organization_id: organizationId,
            p_agent_run_id: runId,
            p_version: version,
          }),
        { runId, what: `reading checkpoint ${version}` },
      );
      return collect(
        result,
        organizationId,
        runId,
        `${AGENT_RPC.checkpointRead}:${organizationId}:${runId}:${version}`,
      )[0];
    },

    async latest(organizationId, runId) {
      if (!isRelationalOrganizationId(organizationId)) return undefined;
      const result = await mapped(
        () =>
          options.gateway.rpc(AGENT_RPC.checkpointLatest, {
            p_organization_id: organizationId,
            p_agent_run_id: runId,
          }),
        { runId, what: 'reading the latest checkpoint' },
      );
      return collect(
        result,
        organizationId,
        runId,
        `${AGENT_RPC.checkpointLatest}:${organizationId}:${runId}`,
      )[0];
    },

    async history(organizationId, runId) {
      if (!isRelationalOrganizationId(organizationId)) return [];
      const result = await mapped(
        () =>
          options.gateway.rpc(AGENT_RPC.checkpointHistory, {
            p_organization_id: organizationId,
            p_agent_run_id: runId,
          }),
        { runId, what: 'reading the checkpoint history' },
      );
      // Sorted numerically rather than trusting the query, as the key-value
      // store sorts rather than trusting its padded keys.
      return collect(
        result,
        organizationId,
        runId,
        `${AGENT_RPC.checkpointHistory}:${organizationId}:${runId}`,
      ).sort((a, b) => a.version - b.version);
    },
  };
}

// ── Approvals ───────────────────────────────────────────────────────────────

export function createSqlAgentApprovalStore(options: SqlAgentStoreOptions): AgentApprovalStore {
  function parse(raw: unknown, location: string): AgentApprovalRequest | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(location, 'stored approval is not a readable object');
      return undefined;
    }
    // The key-value store's four structural fields.
    if (
      typeof record.approvalVersion !== 'number' ||
      typeof record.approvalId !== 'string' ||
      typeof record.organizationId !== 'string' ||
      typeof record.state !== 'string'
    ) {
      options.onCorrupt?.(location, 'stored approval is missing its identity, state or version');
      return undefined;
    }
    return record as unknown as AgentApprovalRequest;
  }

  function projectionOf(request: AgentApprovalRequest): Record<string, unknown> {
    return {
      p_organization_id: request.organizationId,
      p_agent_approval_id: request.approvalId,
      p_approval_state: request.state,
      p_approval_version: request.approvalVersion,
      p_decided_at: request.decidedAt ?? null,
      p_consumed_at: request.consumedAt ?? null,
      // The request declares no `updatedAt`; the row's is the latest domain
      // stamp it carries. Operational only — never read back, never ordered on.
      p_updated_at: request.consumedAt ?? request.decidedAt ?? request.createdAt,
      p_record: request,
    };
  }

  return {
    async load(organizationId, approvalId) {
      if (!isRelationalOrganizationId(organizationId)) return undefined;
      const location = `${AGENT_RPC.approvalLoad}:${organizationId}:${approvalId}`;
      const result = await mapped(
        () =>
          options.gateway.rpc(AGENT_RPC.approvalLoad, {
            p_organization_id: organizationId,
            p_agent_approval_id: approvalId,
          }),
        { what: 'loading the approval' },
      );
      const row = rows(result)[0];
      if (!row) return undefined;
      const request = parse(payloadOf(row), location);
      if (request && request.organizationId !== organizationId) {
        options.onCorrupt?.(location, 'stored approval does not match the tenant it was read for');
        return undefined;
      }
      return request;
    },

    async create(request) {
      if (!isRelationalOrganizationId(request.organizationId)) {
        unnameableTenant(request.organizationId, request.runId, 'approval');
      }
      const won = created(
        await mapped(
          () =>
            options.gateway.rpc(AGENT_RPC.approvalCreate, {
              ...projectionOf(request),
              p_agent_run_id: request.runId,
              p_action_id: request.actionId,
              p_requesting_agent_id: request.requestingAgentId,
              p_created_at: request.createdAt,
              p_expires_at: request.expiresAt,
            }),
          { runId: request.runId, what: 'creating the approval' },
        ),
      );
      if (!won) {
        throw agentFailure('persistence_failed', 'That approval already exists.', {
          runId: request.runId,
          diagnostics: `approval id ${request.approvalId} is already taken`,
        });
      }
    },

    async save(request, expectedVersion) {
      if (!isRelationalOrganizationId(request.organizationId)) {
        unnameableTenant(request.organizationId, request.runId, 'approval');
      }
      const outcome = saveOutcome(
        await mapped(
          () =>
            options.gateway.rpc(AGENT_RPC.approvalSave, {
              ...projectionOf(request),
              p_expected_version: expectedVersion,
            }),
          { runId: request.runId, what: 'saving the approval' },
        ),
      );
      if (outcome === 'saved') return;
      throw agentFailure('stale_run_version', 'This approval has changed since it was read.', {
        runId: request.runId,
        diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
      });
    },

    async list(query) {
      if (!isRelationalOrganizationId(query.organizationId)) return [];
      const result = await mapped(
        () =>
          options.gateway.rpc(AGENT_RPC.approvalList, {
            p_organization_id: query.organizationId,
            p_agent_run_id: query.runId ?? null,
            p_pending_only: query.pendingOnly === true,
            p_limit: boundedLimit(query.limit),
          }),
        { what: 'listing approvals' },
      );
      const location = `${AGENT_RPC.approvalList}:${query.organizationId}`;
      const requests: AgentApprovalRequest[] = [];
      for (const row of rows(result)) {
        const request = parse(payloadOf(row), location);
        if (request && matchesApprovalQuery(request, query)) requests.push(request);
      }
      return requests.sort(byNewest).slice(0, boundedLimit(query.limit));
    },
  };
}

/**
 * The trio, assembled once, for a future composition. A caller that built the
 * three separately over different gateways would give the runtime three
 * authorities that could disagree about which rows exist.
 */
export function createSqlAgentStores(options: SqlAgentStoreOptions): {
  readonly runStore: AgentRunStore;
  readonly checkpointStore: AgentCheckpointStore;
  readonly approvalStore: AgentApprovalStore;
} {
  return {
    runStore: createSqlAgentRunStore(options),
    checkpointStore: createSqlAgentCheckpointStore(options),
    approvalStore: createSqlAgentApprovalStore(options),
  };
}
