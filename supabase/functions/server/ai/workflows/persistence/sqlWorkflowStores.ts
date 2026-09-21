/**
 * Durable workflow run storage, over PostgreSQL (BP-003 / A2).
 *
 * THE SAME THREE PORTS, A DIFFERENT AUTHORITY UNDERNEATH — AND NOT YET THE
 * PRODUCTION ONE. `kvWorkflowStores.ts` is what `ai/bootstrap.ts` constructs
 * and it stays that way through this packet. What is here is a replacement
 * CANDIDATE, proven equivalent against a live local PostgreSQL before anything
 * is asked to move. A later, separately reviewed packet owns shadowing,
 * backfill and cutover.
 *
 * ── WHY THERE IS NO SUPABASE CLIENT IN THIS FOLDER ────────────────────────
 *
 * The same shape `kvWorkflowStores.ts` takes and the same shape
 * `platform/durable/postgresStores.ts` takes: this module declares a FUNCTION
 * PORT and the composition hands it the real one. A client here would mean the
 * workflow tree holds `Deno.env`, a network call and a set of credentials, and
 * the boundary scan's claim about what this tree may import would stop being
 * true.
 *
 * ── ONE VERB, AND WHY THAT IS THE WHOLE SECURITY ARGUMENT ─────────────────
 *
 * `WorkflowSqlGateway` has `rpc` and nothing else. No select, no filter object,
 * no column list, no query builder. Every operation these stores perform is one
 * of the twelve functions in migration `20260921120002`, and every one of those
 * takes `p_organization_id` and scopes every predicate by it.
 *
 * The durable runtime's gateway has four verbs because it has reads that are
 * not arbitration. This one has one, because it has none: a workflow record is
 * never read except by identity or through a tenant-scoped listing, so a
 * generic `select` here would be a capability with no caller and a way to
 * express a cross-tenant read. A port that cannot express a question is a
 * stronger statement than a rule saying nobody asks it.
 *
 * ── THE STORES ARE THIN, DELIBERATELY ─────────────────────────────────────
 *
 * Every guarantee is made by the SQL. `create` is an insert-if-absent,
 * `save` is a compare-and-swap, a checkpoint collision is a primary-key
 * collision — one statement each, so there is no read-then-write window for
 * two isolates to race inside. Read `20260921120002` for the reasoning; this
 * file translates, and is deliberately thin enough that it cannot acquire an
 * opinion of its own.
 *
 * ── THE ORDERING IS THE PORTS', NOT POSTGRES'S ────────────────────────────
 *
 * `sortWorkflowRuns` and `sortWorkflowApprovals` break ties on an identifier
 * using JavaScript's `localeCompare`, and PostgreSQL cannot reproduce that
 * ordering — for `node_b` and `node-b` it disagrees under the default
 * collation and under `"C"` alike. So these stores call the SAME shared sort
 * the key-value store calls, over a candidate set the SQL function returned
 * with `FETCH FIRST n ROWS WITH TIES` so no row sharing the boundary instant
 * was cut before the domain got to decide. One sorter, one meaning, two
 * storage layers that cannot disagree about order because only one of them is
 * ordering.
 *
 * ── WHERE THIS IS STRICTER THAN THE KEY-VALUE STORE, AND WHY IT IS SAID ───
 *
 * `organization_id` is a UUID with a foreign key to `organizations`. The
 * key-value store accepts any identifier matching `ORGANIZATION_ID` in
 * `security/tenancy.ts`, which includes the slug-shaped default
 * `AI_DEFAULT_ORGANIZATION_ID` ships with. A tenant the relational authority
 * cannot name is therefore a tenant these stores cannot WRITE, and that is
 * reported as a typed persistence failure rather than as a silent success.
 *
 * READS are not treated the same way, and the asymmetry is not a compromise:
 * an organization with no row has no records either, so "nothing found" is the
 * true answer to a read and "this cannot be written" is the true answer to a
 * write. Neither is an approximation of the other.
 *
 * This is a CUTOVER PRECONDITION and it is named here because a precondition
 * recorded only in a report is a precondition nobody reads: before any packet
 * moves authority here, every organization identifier the workflow runtime
 * resolves has to be a real `organizations.id`.
 *
 * So the parity this packet proves is bounded, and the bound is stated rather
 * than glossed: EQUIVALENT DOMAIN BEHAVIOUR FOR UUID-BACKED TENANTS. Not
 * parity across every identifier the tenancy grammar admits — there is none,
 * and there cannot be one until that prerequisite is met. Production is still
 * the key-value store, so nothing in service today depends on the difference.
 * `workflowSqlComposition.test.ts` pins the fail-closed behaviour so a later
 * cutover cannot pass over the prerequisite quietly.
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

// ── The port ────────────────────────────────────────────────────────────────

/**
 * One verb. See the header for why there is no second.
 *
 * Contract: invoke the named SQL function with the named arguments and resolve
 * its result — an array of rows for a set-returning function, a boolean or a
 * string for the others. Reject when the database refuses; the stores map that
 * onto the workflow failure vocabulary rather than letting a Postgres message
 * reach the engine.
 */
export interface WorkflowSqlGateway {
  rpc(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface SqlWorkflowStoreOptions {
  readonly gateway: WorkflowSqlGateway;
  /** Called when a stored record cannot be read. Loud, never silent. */
  readonly onCorrupt?: (location: string, detail: string) => void;
}

/** The twelve functions, named once so a typo is a compile-time concern. */
export const WORKFLOW_RPC = {
  runCreate: 'workflow_run_create',
  runSave: 'workflow_run_save',
  runLoad: 'workflow_run_load',
  runList: 'workflow_run_list',
  checkpointAppend: 'workflow_checkpoint_append',
  checkpointRead: 'workflow_checkpoint_read',
  checkpointLatest: 'workflow_checkpoint_latest',
  checkpointHistory: 'workflow_checkpoint_history',
  approvalCreate: 'workflow_approval_create',
  approvalSave: 'workflow_approval_save',
  approvalLoad: 'workflow_approval_load',
  approvalList: 'workflow_approval_list',
} as const;

/** What `workflow_run_save` and `workflow_approval_save` answer. */
export type SqlSaveOutcome = 'saved' | 'stale' | 'missing';

/**
 * A tenant the relational authority can name.
 *
 * Checked here rather than left to Postgres, so a misconfigured deployment
 * gets a workflow failure naming the problem instead of a raw
 * `invalid input syntax for type uuid` surfacing three layers up as something
 * else. See the header.
 */
const ORGANIZATION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRelationalOrganizationId(organizationId: string): boolean {
  return ORGANIZATION_UUID.test(organizationId);
}

// ── Row and payload handling ────────────────────────────────────────────────

/**
 * A stored value may come back as an object or as a JSON string, depending on
 * how the transport decoded it. Both are handled here so every consumer sees
 * one shape — the SAME tolerance `kvWorkflowStores.ts` applies, for the same
 * reason and with the same outcome for an unreadable blob.
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

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];
  return result.filter(
    (row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null && !Array.isArray(row),
  );
}

/**
 * The record inside a row.
 *
 * `record` is the column; everything else on the row is a projection OF it,
 * and `workflow_runs_record_agrees` and its siblings make the two unable to
 * disagree about identity, tenant, version or state. So the record is read and
 * the projection is not re-derived from it here — a second derivation would be
 * a second opinion about a fact the database already refuses to hold twice.
 */
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
 * A database refusal, turned into the workflow failure vocabulary.
 *
 * NO RAW POSTGRES ERROR REACHES THE ENGINE. A constraint name, a column list
 * or a `SQLSTATE 23514` is a sentence about the storage layer, and the workflow
 * engine's failure handling is a state machine over `WorkflowFailureCode` — an
 * error it cannot classify becomes an unhandled rejection three layers from
 * where it was raised, and whatever the driver put in `message` ends up
 * wherever that rejection is logged.
 *
 * The detail is kept, bounded, in `diagnostics`, which is the field that
 * already carries storage-level explanation on every other failure in this
 * file. The caller-facing message says nothing about a database.
 *
 * A failure this module raised on purpose passes straight through: it is
 * already in the vocabulary, and re-wrapping it would turn a typed stale-version
 * conflict into a generic persistence failure.
 */
const MAX_DIAGNOSTIC = 300;

function isWorkflowFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { failure?: unknown }).failure === 'string'
  );
}

async function mapped<T>(
  call: () => Promise<T>,
  context: { readonly workflowRunId?: string; readonly nodeId?: string; readonly what: string },
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isWorkflowFailure(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw workflowFailure('workflow_persistence_failed', 'That workflow state is unavailable.', {
      // ABSENT RATHER THAN EMPTY. A listing failed for a tenant, not for a run,
      // and `workflowRunId` travels into the log line and the audit record —
      // an empty string there reads as a run whose id nobody captured.
      ...(context.workflowRunId ? { workflowRunId: context.workflowRunId } : {}),
      ...(context.nodeId === undefined ? {} : { nodeId: context.nodeId }),
      diagnostics: `${context.what}: ${detail.slice(0, MAX_DIAGNOSTIC)}`,
    });
  }
}

// ── Runs ────────────────────────────────────────────────────────────────────

export function createSqlWorkflowRunStore(options: SqlWorkflowStoreOptions): WorkflowRunStore {
  function parse(raw: unknown, location: string): WorkflowRunRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(location, 'stored workflow run is not a readable object');
      return undefined;
    }
    // Structural sanity only, and the SAME four fields the key-value store
    // checks. A record that does not carry its identity and its version cannot
    // be safely written back, and guessing the missing parts would produce a
    // run whose optimistic concurrency is meaningless.
    const context = record.context as Record<string, unknown> | undefined;
    if (
      typeof record.runVersion !== 'number' ||
      typeof record.state !== 'string' ||
      typeof context?.workflowRunId !== 'string' ||
      typeof context?.organizationId !== 'string'
    ) {
      options.onCorrupt?.(location, 'stored workflow run is missing its identity or version');
      return undefined;
    }
    return record as unknown as WorkflowRunRecord;
  }

  /**
   * The projection the relational columns hold, from the record itself.
   *
   * Every field here is also inside `p_record`, and the table's CHECK refuses
   * a row where the two disagree — so this is not a denormalization that can
   * drift, it is the same fact written where an index can reach it.
   */
  function projectionOf(record: WorkflowRunRecord): Record<string, unknown> {
    return {
      p_organization_id: record.context.organizationId,
      p_workflow_run_id: record.context.workflowRunId,
      p_workflow_id: record.context.workflowId,
      p_actor_id: record.context.actorId,
      p_state: record.state,
      p_run_version: record.runVersion,
      p_checkpoint_version: record.checkpointVersion,
      p_updated_at: record.updatedAt,
      p_record: record,
    };
  }

  function refuseUnnameableTenant(record: WorkflowRunRecord): void {
    if (isRelationalOrganizationId(record.context.organizationId)) return;
    throw workflowFailure('workflow_persistence_failed', 'That run could not be stored.', {
      workflowRunId: record.context.workflowRunId,
      diagnostics:
        `organization ${record.context.organizationId} is not a relational organization id; ` +
        'the SQL workflow stores require a UUID that exists in public.organizations',
    });
  }

  return {
    async load(organizationId, workflowRunId) {
      // An organization the relational authority cannot name holds no rows, so
      // "nothing" is the true answer rather than an approximation of one.
      if (!isRelationalOrganizationId(organizationId)) return undefined;

      const result = await mapped(
        () =>
          options.gateway.rpc(WORKFLOW_RPC.runLoad, {
            p_organization_id: organizationId,
            p_workflow_run_id: workflowRunId,
          }),
        { workflowRunId, what: 'loading the run' },
      );
      const row = rows(result)[0];
      if (!row) return undefined;

      const location = `${WORKFLOW_RPC.runLoad}:${organizationId}:${workflowRunId}`;
      const record = parse(payloadOf(row), location);
      // Belt and braces: the function already scoped the read, the CHECK
      // already refuses a row that disagrees with its own payload, and the
      // record is compared against the caller's organization anyway. "The
      // query was scoped" and "this belongs to this tenant" are different
      // claims; only one of them is about isolation.
      if (record && record.context.organizationId !== organizationId) {
        options.onCorrupt?.(location, 'stored workflow run does not match the tenant it was read for');
        return undefined;
      }
      return record;
    },

    async create(record) {
      refuseUnnameableTenant(record);
      const projection = projectionOf(record);
      const won = created(
        await mapped(
          () =>
            options.gateway.rpc(WORKFLOW_RPC.runCreate, {
              ...projection,
              p_created_at: record.createdAt,
            }),
          { workflowRunId: record.context.workflowRunId, what: 'creating the run' },
        ),
      );
      if (!won) {
        // The same failure, the same message and the same diagnostic shape the
        // key-value store raises. A caller must not be able to tell which
        // store refused it.
        throw workflowFailure('workflow_persistence_failed', 'That run already exists.', {
          workflowRunId: record.context.workflowRunId,
          diagnostics: `workflow run id ${record.context.workflowRunId} is already taken`,
        });
      }
    },

    async save(record, expectedVersion) {
      refuseUnnameableTenant(record);
      const outcome = saveOutcome(
        await mapped(
          () =>
            options.gateway.rpc(WORKFLOW_RPC.runSave, {
              ...projectionOf(record),
              p_expected_version: expectedVersion,
            }),
          { workflowRunId: record.context.workflowRunId, what: 'saving the run' },
        ),
      );
      if (outcome === 'saved') return;

      // `missing` IS DISTINGUISHABLE HERE AND IS DELIBERATELY NOT REPORTED.
      //
      // The SQL function can tell "this run moved on" from "this run was never
      // here"; `kv_compare_and_swap_field` cannot, and the production authority
      // reports both as a lost swap. This packet's acceptance gate is parity
      // with what production does today, and a store that raised a more precise
      // failure would be a store whose callers behave differently after a
      // cutover — which is the exact thing a parity gate exists to prevent.
      // The richer signal is returned by the function so a later packet can
      // adopt it deliberately rather than rediscover it.
      throw workflowFailure('stale_workflow_version', 'This run has changed since it was read.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
      });
    },

    async list(query) {
      if (!isRelationalOrganizationId(query.organizationId)) return [];

      const result = await mapped(
        () =>
          options.gateway.rpc(WORKFLOW_RPC.runList, {
            p_organization_id: query.organizationId,
            p_states: query.states && query.states.length > 0 ? [...query.states] : null,
            p_workflow_id: query.workflowId ?? null,
            p_actor_id: query.actorId ?? null,
            p_limit: boundedLimit(query.limit),
          }),
        { what: 'listing runs' },
      );

      const location = `${WORKFLOW_RPC.runList}:${query.organizationId}`;
      const records: WorkflowRunRecord[] = [];
      for (const row of rows(result)) {
        const record = parse(payloadOf(row), location);
        // Filtered again in the domain, over the domain's own predicate. The
        // SQL narrowed so the scan is bounded and indexed; this decides what
        // the query MEANS, and it is the same function the key-value store and
        // the in-memory store call.
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
 * `write` is one `INSERT ... ON CONFLICT DO NOTHING` against a primary key of
 * `(organization_id, workflow_run_id, version)`. That single call IS the
 * immutability guarantee at this layer: there is no code path in this module
 * that can overwrite a written checkpoint, because there is no statement that
 * updates one. A checkpoint's `version` is its identity, not its concurrency
 * token — it never moves, so there is nothing to compare against.
 *
 * And unlike the key-value store, the guarantee does not rest only on this
 * module: `workflow_checkpoints_append_only` in migration `20260921120000` is
 * a trigger that refuses an UPDATE from anything, including a psql session.
 * The digest chain is a claim about what was not edited, and it should not
 * depend on every future writer having read this comment.
 */
export function createSqlWorkflowCheckpointStore(
  options: SqlWorkflowStoreOptions,
): WorkflowCheckpointStore {
  function parse(raw: unknown, location: string): WorkflowCheckpoint | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(location, 'stored workflow checkpoint is not a readable object');
      return undefined;
    }
    if (
      typeof record.version !== 'number' ||
      typeof record.digest !== 'string' ||
      typeof record.workflowRunId !== 'string' ||
      typeof record.organizationId !== 'string'
    ) {
      options.onCorrupt?.(location, 'stored workflow checkpoint is missing its identity or digest');
      return undefined;
    }
    return record as unknown as WorkflowCheckpoint;
  }

  function collect(
    result: unknown,
    organizationId: string,
    location: string,
  ): WorkflowCheckpoint[] {
    const checkpoints: WorkflowCheckpoint[] = [];
    for (const row of rows(result)) {
      const checkpoint = parse(payloadOf(row), location);
      if (checkpoint && checkpoint.organizationId === organizationId) checkpoints.push(checkpoint);
    }
    return checkpoints;
  }

  return {
    async write(checkpoint) {
      if (!isRelationalOrganizationId(checkpoint.organizationId)) {
        throw workflowFailure(
          'workflow_persistence_failed',
          'That checkpoint could not be stored.',
          {
            workflowRunId: checkpoint.workflowRunId,
            diagnostics:
              `organization ${checkpoint.organizationId} is not a relational organization id; ` +
              'the SQL workflow stores require a UUID that exists in public.organizations',
          },
        );
      }

      const won = created(
        await mapped(
          () =>
            options.gateway.rpc(WORKFLOW_RPC.checkpointAppend, {
              p_organization_id: checkpoint.organizationId,
              p_workflow_run_id: checkpoint.workflowRunId,
              p_version: checkpoint.version,
              p_digest: checkpoint.digest,
              p_previous_digest: checkpoint.previousDigest ?? null,
              p_node_id: checkpoint.nodeId,
              p_state: checkpoint.state,
              p_created_at: checkpoint.createdAt,
              p_record: checkpoint,
            }),
          {
            workflowRunId: checkpoint.workflowRunId,
            nodeId: checkpoint.nodeId,
            what: 'appending the checkpoint',
          },
        ),
      );
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
      if (!isRelationalOrganizationId(organizationId)) return undefined;
      const result = await mapped(
        () =>
          options.gateway.rpc(WORKFLOW_RPC.checkpointLatest, {
            p_organization_id: organizationId,
            p_workflow_run_id: workflowRunId,
          }),
        { workflowRunId, what: 'reading the latest checkpoint' },
      );
      // Highest version first from the function; the tenant comparison below is
      // the same belt-and-braces check every read in this file performs.
      return collect(
        result,
        organizationId,
        `${WORKFLOW_RPC.checkpointLatest}:${organizationId}:${workflowRunId}`,
      )[0];
    },

    async read(organizationId, workflowRunId, version) {
      if (!isRelationalOrganizationId(organizationId)) return undefined;
      const location = `${WORKFLOW_RPC.checkpointRead}:${organizationId}:${workflowRunId}:${version}`;
      const result = await mapped(
        () =>
          options.gateway.rpc(WORKFLOW_RPC.checkpointRead, {
            p_organization_id: organizationId,
            p_workflow_run_id: workflowRunId,
            p_version: version,
          }),
        { workflowRunId, what: `reading checkpoint ${version}` },
      );
      const row = rows(result)[0];
      if (!row) return undefined;
      const checkpoint = parse(payloadOf(row), location);
      if (checkpoint && checkpoint.organizationId !== organizationId) {
        options.onCorrupt?.(location, 'stored checkpoint does not match the tenant it was read for');
        return undefined;
      }
      return checkpoint;
    },

    async history(organizationId, workflowRunId) {
      if (!isRelationalOrganizationId(organizationId)) return [];
      const result = await mapped(
        () =>
          options.gateway.rpc(WORKFLOW_RPC.checkpointHistory, {
            p_organization_id: organizationId,
            p_workflow_run_id: workflowRunId,
          }),
        { workflowRunId, what: 'reading the checkpoint chain' },
      );
      const checkpoints = collect(
        result,
        organizationId,
        `${WORKFLOW_RPC.checkpointHistory}:${organizationId}:${workflowRunId}`,
      );
      // Sorted numerically rather than trusting the query, exactly as the
      // key-value store sorts rather than trusting its padded keys. The two
      // orders agree; relying on that agreement without asserting it would make
      // "the checkpoint chain" depend on a plan detail.
      return checkpoints.sort((a, b) => a.version - b.version);
    },
  };
}

// ── Approvals ───────────────────────────────────────────────────────────────

/**
 * Durable approval storage.
 *
 * Read-modify-write under a compare-and-swap on the approval's OWN
 * `approvalVersion`, which is what makes "single use" a guarantee rather than
 * an intention: two advances racing to spend one approved request both read
 * version N and both try to write N+1, and `workflow_approval_save` lets
 * exactly one of them past. The loser is told the approval moved, re-reads,
 * and finds it consumed.
 *
 * `create` is insert-if-absent, so a recomputed deterministic id never
 * silently overwrites a decision somebody has already made or is about to.
 */
export function createSqlWorkflowApprovalStore(
  options: SqlWorkflowStoreOptions,
): WorkflowApprovalStore {
  function parse(raw: unknown, location: string): WorkflowApprovalRecord | undefined {
    const record = coerce(raw);
    if (!record) {
      options.onCorrupt?.(location, 'stored workflow approval is not a readable object');
      return undefined;
    }
    if (
      typeof record.approvalVersion !== 'number' ||
      typeof record.approvalState !== 'string' ||
      typeof record.workflowApprovalId !== 'string' ||
      typeof record.workflowRunId !== 'string' ||
      typeof record.organizationId !== 'string'
    ) {
      options.onCorrupt?.(location, 'stored workflow approval is missing its identity or version');
      return undefined;
    }
    return record as unknown as WorkflowApprovalRecord;
  }

  function refuseUnnameableTenant(record: WorkflowApprovalRecord): void {
    if (isRelationalOrganizationId(record.organizationId)) return;
    throw workflowFailure('workflow_persistence_failed', 'That approval could not be stored.', {
      workflowRunId: record.workflowRunId,
      nodeId: record.nodeId,
      diagnostics:
        `organization ${record.organizationId} is not a relational organization id; ` +
        'the SQL workflow stores require a UUID that exists in public.organizations',
    });
  }

  /** Every relational column an approval carries, from the record itself. */
  function projectionOf(record: WorkflowApprovalRecord): Record<string, unknown> {
    return {
      p_organization_id: record.organizationId,
      p_workflow_approval_id: record.workflowApprovalId,
      p_approval_state: record.approvalState,
      p_approval_version: record.approvalVersion,
      p_decided_at: record.decidedAt ?? null,
      p_consumed_at: record.consumedAt ?? null,
      // An approval record carries no `updatedAt` of its own — the contract
      // does not declare one — so the row's is taken from the most recent
      // domain stamp it does carry. It is operational, never read back into a
      // record, and never used for ordering.
      p_updated_at: record.consumedAt ?? record.decidedAt ?? record.createdAt,
      p_record: record,
    };
  }

  return {
    async load(organizationId, workflowApprovalId) {
      if (!isRelationalOrganizationId(organizationId)) return undefined;
      const location = `${WORKFLOW_RPC.approvalLoad}:${organizationId}:${workflowApprovalId}`;
      const result = await mapped(
        () =>
          options.gateway.rpc(WORKFLOW_RPC.approvalLoad, {
            p_organization_id: organizationId,
            p_workflow_approval_id: workflowApprovalId,
          }),
        { what: 'loading the approval' },
      );
      const row = rows(result)[0];
      if (!row) return undefined;
      const record = parse(payloadOf(row), location);
      if (record && record.organizationId !== organizationId) {
        options.onCorrupt?.(location, 'stored workflow approval does not match the tenant it was read for');
        return undefined;
      }
      return record;
    },

    async create(record) {
      refuseUnnameableTenant(record);
      const won = created(
        await mapped(
          () =>
            options.gateway.rpc(WORKFLOW_RPC.approvalCreate, {
              ...projectionOf(record),
              p_workflow_run_id: record.workflowRunId,
              p_workflow_id: record.workflowId,
              p_node_id: record.nodeId,
              p_branch_id: record.branchId ?? null,
              p_created_at: record.createdAt,
              p_expires_at: record.expiresAt,
            }),
          {
            workflowRunId: record.workflowRunId,
            nodeId: record.nodeId,
            what: 'creating the approval',
          },
        ),
      );
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
      refuseUnnameableTenant(record);
      const outcome = saveOutcome(
        await mapped(
          () =>
            options.gateway.rpc(WORKFLOW_RPC.approvalSave, {
              ...projectionOf(record),
              p_expected_version: expectedVersion,
            }),
          {
            workflowRunId: record.workflowRunId,
            nodeId: record.nodeId,
            what: 'saving the approval decision',
          },
        ),
      );
      if (outcome === 'saved') return;
      // `missing` collapsed into the stale failure, for the reason the run
      // store's `save` states at length.
      throw workflowFailure(
        'stale_workflow_approval',
        'This approval has changed since it was read.',
        {
          workflowRunId: record.workflowRunId,
          diagnostics: `compare-and-swap lost at version ${expectedVersion}`,
        },
      );
    },

    async list(query) {
      if (!isRelationalOrganizationId(query.organizationId)) return [];
      const result = await mapped(
        () =>
          options.gateway.rpc(WORKFLOW_RPC.approvalList, {
            p_organization_id: query.organizationId,
            p_workflow_run_id: query.workflowRunId ?? null,
            p_pending_only: query.pendingOnly === true,
            p_limit: boundedLimit(query.limit),
          }),
        { ...(query.workflowRunId === undefined ? {} : { workflowRunId: query.workflowRunId }),
          what: 'listing approvals' },
      );

      const location = `${WORKFLOW_RPC.approvalList}:${query.organizationId}`;
      const records: WorkflowApprovalRecord[] = [];
      for (const row of rows(result)) {
        const record = parse(payloadOf(row), location);
        if (record && matchesWorkflowApprovalQuery(record, query)) records.push(record);
      }
      // OLDEST first. The queue ordering is the ports' own, for the reason
      // `sortWorkflowApprovals` gives: an approval queue is work, not history.
      return sortWorkflowApprovals(records).slice(0, boundedLimit(query.limit));
    },
  };
}

// ── The composition seam ────────────────────────────────────────────────────

/** The three stores, as one assembled set. */
export interface SqlWorkflowStores {
  readonly runStore: WorkflowRunStore;
  readonly checkpointStore: WorkflowCheckpointStore;
  readonly approvalStore: WorkflowApprovalStore;
}

/**
 * ONE TRIO, BUILT ONCE — the shape `ai/bootstrap.ts` already uses, offered
 * here so a future cutover cannot accidentally lose the property it holds.
 *
 * ── THE INVARIANT THIS FUNCTION EXISTS TO PROTECT ─────────────────────────
 *
 * The workflow engine WRITES these stores and the diagnostic capability's
 * approval-authority port READS them, and it is the SAME PAIR. That shared
 * pair is the entire binding by which `tool.diagnostic.commit_review_outcome`
 * learns which workflow run owns its agent run: the answer comes from
 * `WorkflowRunRecord.childAgentRunIds`, which the engine writes and nothing on
 * the agent side can influence. An agent cannot add itself to a list it cannot
 * reach — which is why a direct agent run, appearing in no such list, cannot
 * commit.
 *
 * Build two independent sets and that guarantee quietly becomes false. The
 * engine writes one set of rows, the authority port reads another, and a
 * commit's "which run owns me" question is asked of rows nobody wrote. Against
 * a shared database the two would eventually agree; against anything with a
 * cache, a transaction or a different connection they would not, and the
 * failure would look like a flaky authorization rather than an assembly
 * mistake.
 *
 * So the seam is a function that returns all three from ONE options object,
 * rather than three exported constructors a composition is trusted to call in
 * the right way. `workflowSqlComposition.test.ts` asserts the references are
 * identical; `scripts/workflow-persistence-scenarios.ts` asserts the engine's
 * store and the authority port see the same rows against a real database.
 *
 * ── THIS IS NOT A CUTOVER ─────────────────────────────────────────────────
 *
 * Nothing calls this in production. `ai/bootstrap.ts` constructs the key-value
 * stores and BP-003 does not change it — there is deliberately no flag, no
 * environment variable and no branch here that could flip authority to SQL,
 * because a switch that exists is a switch that can be set by accident. A
 * later reviewed packet owns shadowing, backfill and cutover, and it will have
 * to add the wiring on purpose.
 */
export function createSqlWorkflowStores(options: SqlWorkflowStoreOptions): SqlWorkflowStores {
  return {
    runStore: createSqlWorkflowRunStore(options),
    checkpointStore: createSqlWorkflowCheckpointStore(options),
    approvalStore: createSqlWorkflowApprovalStore(options),
  };
}
