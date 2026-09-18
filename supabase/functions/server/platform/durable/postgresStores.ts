/**
 * The durable stores, over Postgres (BP-002 §7).
 *
 * THE AUTHORITATIVE IMPLEMENTATION. `createMemoryDurableStores` in `ports.ts`
 * is a reference implementation for tests; this is the one the runtime gets,
 * and every guarantee it makes is made by the SQL functions in migration
 * `20260919120002` rather than by the code here. Read that file for the
 * reasoning; this one is a translation layer and is deliberately thin enough
 * that it cannot acquire an opinion of its own.
 *
 * ── WHY THERE IS NO SUPABASE CLIENT IN THIS FOLDER ────────────────────────
 *
 * The same shape `kvWorkflowStores.ts` takes: it declares FUNCTION PORTS —
 * `KvWorkflowReader`, `KvWorkflowConditionalWriter` — and the composition hands
 * it the real ones. A client here would mean this folder holds `Deno.env`, a
 * network call and a set of credentials, and the boundary scan's claim that the
 * durable runtime imports nothing but BP-001 would stop being true.
 *
 * So `DurableSqlGateway` is four verbs that map one-to-one onto what
 * `supabase-js` already does. It is a PORT, not a query builder: there is no
 * expression language here, no joins and no way to express a query that is not
 * one of the shapes below — which is what keeps a cross-tenant read
 * unexpressible rather than merely unwritten.
 *
 * ── WHY THE MAPPERS ARE EXPORTED SEPARATELY ───────────────────────────────
 *
 * `toDurableJob`, `toSchedule`, `toEventRecord` and the argument builders are
 * pure functions over plain objects, so the contract between this file and the
 * migration — that every column the runtime reads exists, and every argument
 * the SQL functions take is supplied — is testable WITHOUT A DATABASE. That is
 * the only part of this file that can be proven in an environment with no
 * Postgres, so it is the part that carries the proof.
 */

import {
  DURABLE_FAILURE,
  DurableRuntimeError,
  type DeadLetterRecord,
  type DomainEventDraft,
  type DomainEventRecord,
  type DurableJob,
  type DurableSchedule,
  type InboxRecord,
  type JobActorContext,
  type JobLease,
  type JobState,
} from './contracts.ts';
import {
  assertEventDraft,
  assertJobActor,
  normalizeLeaseTtlMs,
  normalizeMaxAttempts,
  normalizeRetryPolicy,
} from './guards.ts';
import { boundedLimit, type DurableStores, type JobSettlement } from './ports.ts';
import { occurrenceIdempotencyKey } from './recurrence.ts';

// ── The port ────────────────────────────────────────────────────────────────

export interface SelectCriteria {
  readonly match?: Readonly<Record<string, unknown>>;
  readonly inList?: { readonly column: string; readonly values: readonly unknown[] };
  readonly order?: { readonly column: string; readonly ascending: boolean };
  readonly limit?: number;
}

/**
 * Four verbs, and no fifth.
 *
 * `rpc` is how every ATOMIC operation is reached — claim, heartbeat, settle,
 * recovery, materialization — because each of those is one SQL statement whose
 * atomicity is the guarantee. The other three are for reads and for the two
 * writes that need no arbitration (an inbox claim, whose uniqueness constraint
 * is the arbitration, and an inbox settle on a row this consumer already owns).
 */
export interface DurableSqlGateway {
  rpc(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
  select(
    table: string,
    criteria: SelectCriteria,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  /** Returns the inserted rows, or an empty array when a conflict was ignored. */
  insert(
    table: string,
    row: Readonly<Record<string, unknown>>,
    options?: { readonly ignoreConflict?: boolean },
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  update(
    table: string,
    patch: Readonly<Record<string, unknown>>,
    match: Readonly<Record<string, unknown>>,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

export const DURABLE_TABLE = {
  jobs: 'durable_jobs',
  schedules: 'durable_schedules',
  outbox: 'durable_outbox',
  inbox: 'durable_inbox',
  deadLetters: 'durable_dead_letters',
} as const;

export const DURABLE_RPC = {
  claim: 'durable_job_claim',
  heartbeat: 'durable_job_heartbeat',
  settle: 'durable_job_settle',
  recover: 'durable_job_recover_leases',
  materialize: 'durable_schedule_materialize_due',
} as const;

// ── Row mapping ─────────────────────────────────────────────────────────────

function text(row: Readonly<Record<string, unknown>>, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    // A column the runtime needs and the row does not have means the schema and
    // this file have diverged. Throwing names the column, which turns a
    // deployment mistake into a one-line diagnosis rather than an undefined
    // that surfaces three layers up as something else.
    throw new DurableRuntimeError(
      DURABLE_FAILURE.jobInvalid,
      'A durable record could not be read.',
      `column ${column} is missing or not text`,
    );
  }
  return value;
}

function optionalText(
  row: Readonly<Record<string, unknown>>,
  column: string,
): string | undefined {
  const value = row[column];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function integer(row: Readonly<Record<string, unknown>>, column: string, fallback: number): number {
  const value = row[column];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    // Postgres returns BIGINT as a string through PostgREST. Parsed rather than
    // refused, because the alternative is a schedule interval that reads as
    // absent and silently turns a recurring schedule into a one-time one.
    return Math.floor(Number(value));
  }
  return fallback;
}

function record(
  row: Readonly<Record<string, unknown>>,
  column: string,
): Readonly<Record<string, unknown>> {
  const value = row[column];
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

/**
 * A text array column, or a refusal.
 *
 * STRICT, AND THE FIRST VERSION WAS NOT. It returned `[]` for anything that was
 * not an array, which fails closed — an actor with no permissions is denied —
 * and is still wrong, because it turns "this column could not be read" into
 * "this actor holds nothing", and those need different responses. The first is
 * a corrupt row an operator must look at; the second is an ordinary, meaningful
 * state. A silent conversion between them means the corrupt row is never found,
 * and the job that should have run is denied every time it is claimed until its
 * attempts are spent.
 *
 * ABSENT is different from MALFORMED and is allowed: a column the row simply
 * does not carry yields the empty list, which is what the column's own
 * `DEFAULT '{}'` means.
 */
function stringList(row: Readonly<Record<string, unknown>>, column: string): readonly string[] {
  const value = row[column];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.jobInvalid,
      'A durable record could not be read.',
      `column ${column} is not a text array`,
    );
  }
  return value as readonly string[];
}

/**
 * The actor, rebuilt from its columns and re-validated.
 *
 * RE-VALIDATED, NOT TRUSTED. The row was written by an enqueue that checked it,
 * and it is checked again on the way out — because a job is written by one
 * isolate and run by another, possibly after a migration, possibly after
 * somebody edited a row. `assertJobActor` is the same function both times, so
 * the two checks cannot drift.
 */
function actorFrom(row: Readonly<Record<string, unknown>>): JobActorContext {
  const organizationId = text(row, 'organization_id');
  const initiatedById = optionalText(row, 'initiated_by_actor_id');
  const initiatedByType = optionalText(row, 'initiated_by_actor_type');
  return assertJobActor(
    {
      actorId: text(row, 'actor_id'),
      actorType: text(row, 'actor_type'),
      organizationId,
      permissions: stringList(row, 'actor_permissions'),
      ...(initiatedById === undefined || initiatedByType === undefined
        ? {}
        : { initiatedBy: { actorId: initiatedById, actorType: initiatedByType } }),
    },
    organizationId,
  );
}

export function toDurableJob(row: Readonly<Record<string, unknown>>): DurableJob {
  const causationId = optionalText(row, 'causation_id');
  const scheduleId = optionalText(row, 'schedule_id');
  const leaseOwner = optionalText(row, 'lease_owner');
  const leaseExpiresAt = optionalText(row, 'lease_expires_at');
  const heartbeatAt = optionalText(row, 'heartbeat_at');
  const startedAt = optionalText(row, 'started_at');
  const completedAt = optionalText(row, 'completed_at');
  const failureCode = optionalText(row, 'failure_code');
  const failureDetail = optionalText(row, 'failure_detail');
  const result = row.result === null || row.result === undefined ? undefined : record(row, 'result');

  return {
    jobId: text(row, 'id'),
    organizationId: text(row, 'organization_id'),
    jobType: text(row, 'job_type'),
    state: text(row, 'state') as JobState,
    priority: integer(row, 'priority', 100),
    availableAt: text(row, 'available_at'),
    attempt: integer(row, 'attempt', 0),
    maxAttempts: normalizeMaxAttempts(integer(row, 'max_attempts', 5)),
    retry: normalizeRetryPolicy({
      kind: text(row, 'backoff_kind') as DurableJob['retry']['kind'],
      baseMs: integer(row, 'backoff_base_ms', 1000),
      maxMs: integer(row, 'backoff_max_ms', 3_600_000),
    }),
    ...(leaseOwner === undefined ? {} : { leaseOwner }),
    leaseGeneration: integer(row, 'lease_generation', 0),
    ...(leaseExpiresAt === undefined ? {} : { leaseExpiresAt }),
    ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
    leaseTtlMs: normalizeLeaseTtlMs(integer(row, 'lease_ttl_ms', 60_000)),
    idempotencyKey: text(row, 'idempotency_key'),
    correlationId: text(row, 'correlation_id'),
    ...(causationId === undefined ? {} : { causationId }),
    ...(scheduleId === undefined ? {} : { scheduleId }),
    actor: actorFrom(row),
    input: record(row, 'input'),
    ...(result === undefined ? {} : { result }),
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(failureDetail === undefined ? {} : { failureDetail }),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

export function toSchedule(row: Readonly<Record<string, unknown>>): DurableSchedule {
  const interval = row.recurrence_interval_ms;
  const lastRunAt = optionalText(row, 'last_run_at');
  const lastOccurrenceAt = optionalText(row, 'last_occurrence_at');
  return {
    scheduleId: text(row, 'id'),
    organizationId: text(row, 'organization_id'),
    scheduleKey: text(row, 'schedule_key'),
    jobType: text(row, 'job_type'),
    status: text(row, 'status') as DurableSchedule['status'],
    nextRunAt: text(row, 'next_run_at'),
    ...(interval === null || interval === undefined
      ? {}
      : { recurrenceIntervalMs: integer(row, 'recurrence_interval_ms', 0) }),
    ...(lastRunAt === undefined ? {} : { lastRunAt }),
    ...(lastOccurrenceAt === undefined ? {} : { lastOccurrenceAt }),
    materializeVersion: integer(row, 'materialize_version', 0),
    actor: actorFrom(row),
    correlationId: text(row, 'correlation_id'),
    input: record(row, 'input'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

export function toEventRecord(row: Readonly<Record<string, unknown>>): DomainEventRecord {
  const causationId = optionalText(row, 'causation_id');
  const entityType = optionalText(row, 'entity_type');
  const entityId = optionalText(row, 'entity_id');
  const leaseOwner = optionalText(row, 'lease_owner');
  const leaseExpiresAt = optionalText(row, 'lease_expires_at');
  const failureCode = optionalText(row, 'failure_code');
  const failureDetail = optionalText(row, 'failure_detail');
  const jobId = optionalText(row, 'job_id');
  const dispatchedAt = optionalText(row, 'dispatched_at');

  return {
    eventId: text(row, 'id'),
    organizationId: text(row, 'organization_id'),
    eventType: text(row, 'event_type'),
    eventVersion: integer(row, 'event_version', 1),
    occurredAt: text(row, 'occurred_at'),
    actorId: text(row, 'actor_id'),
    actorType: text(row, 'actor_type') as DomainEventRecord['actorType'],
    correlationId: text(row, 'correlation_id'),
    ...(causationId === undefined ? {} : { causationId }),
    source: text(row, 'source'),
    ...(entityType === undefined ? {} : { entityType }),
    ...(entityId === undefined ? {} : { entityId }),
    classification: text(row, 'classification') as DomainEventRecord['classification'],
    payload: record(row, 'payload'),
    dispatchState: text(row, 'dispatch_state') as DomainEventRecord['dispatchState'],
    attempt: integer(row, 'attempt', 0),
    maxAttempts: integer(row, 'max_attempts', 5),
    availableAt: text(row, 'available_at'),
    ...(leaseOwner === undefined ? {} : { leaseOwner }),
    leaseGeneration: integer(row, 'lease_generation', 0),
    ...(leaseExpiresAt === undefined ? {} : { leaseExpiresAt }),
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(failureDetail === undefined ? {} : { failureDetail }),
    ...(jobId === undefined ? {} : { jobId }),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    ...(dispatchedAt === undefined ? {} : { dispatchedAt }),
  };
}

export function toInboxRecord(row: Readonly<Record<string, unknown>>): InboxRecord {
  const correlationId = optionalText(row, 'correlation_id');
  const causationId = optionalText(row, 'causation_id');
  const failureCode = optionalText(row, 'failure_code');
  const failureDetail = optionalText(row, 'failure_detail');
  const result = row.result === null || row.result === undefined ? undefined : record(row, 'result');
  return {
    inboxId: text(row, 'id'),
    organizationId: text(row, 'organization_id'),
    consumerKey: text(row, 'consumer_key'),
    eventId: text(row, 'event_id'),
    eventType: text(row, 'event_type'),
    status: text(row, 'status') as InboxRecord['status'],
    processedAt: text(row, 'processed_at'),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(failureDetail === undefined ? {} : { failureDetail }),
    ...(result === undefined ? {} : { result }),
  };
}

export function toDeadLetterRecord(row: Readonly<Record<string, unknown>>): DeadLetterRecord {
  const failureDetail = optionalText(row, 'failure_detail');
  const causationId = optionalText(row, 'causation_id');
  const recoveredAt = optionalText(row, 'recovered_at');
  const recoveredJobId = optionalText(row, 'recovered_job_id');
  return {
    deadLetterId: text(row, 'id'),
    organizationId: text(row, 'organization_id'),
    originKind: text(row, 'origin_kind') as DeadLetterRecord['originKind'],
    originId: text(row, 'origin_id'),
    originType: text(row, 'origin_type'),
    attempts: integer(row, 'attempts', 1),
    failureCode: text(row, 'failure_code'),
    ...(failureDetail === undefined ? {} : { failureDetail }),
    correlationId: text(row, 'correlation_id'),
    ...(causationId === undefined ? {} : { causationId }),
    firstFailedAt: text(row, 'first_failed_at'),
    lastFailedAt: text(row, 'last_failed_at'),
    recoveryState: text(row, 'recovery_state') as DeadLetterRecord['recoveryState'],
    ...(recoveredAt === undefined ? {} : { recoveredAt }),
    ...(recoveredJobId === undefined ? {} : { recoveredJobId }),
    createdAt: text(row, 'created_at'),
  };
}

// ── Argument builders ───────────────────────────────────────────────────────

/**
 * The JSONB array `durable_job_settle` expects for `p_events`.
 *
 * VALIDATED HERE, BEFORE THE CALL. Every draft goes through `assertEventDraft`,
 * so an oversized or malformed payload is refused before the settle is
 * attempted rather than by a CHECK constraint mid-transaction — which would
 * roll back a legitimate job result for a reason the log would report as a
 * database error.
 *
 * The keys are camelCase because that is what the SQL function reads out of the
 * JSON (`v_event ->> 'eventId'`). They are the one place in this file where the
 * two naming conventions meet, and they are asserted against the migration text
 * by the static migration test.
 */
export function settleEventsArgument(
  drafts: readonly DomainEventDraft[] | undefined,
): readonly Readonly<Record<string, unknown>>[] {
  return (drafts ?? []).map((draft) => {
    assertEventDraft(draft);
    return {
      eventId: draft.eventId,
      eventType: draft.eventType,
      ...(draft.eventVersion === undefined ? {} : { eventVersion: draft.eventVersion }),
      ...(draft.occurredAt === undefined ? {} : { occurredAt: draft.occurredAt }),
      ...(draft.actorId === undefined ? {} : { actorId: draft.actorId }),
      ...(draft.actorType === undefined ? {} : { actorType: draft.actorType }),
      ...(draft.correlationId === undefined ? {} : { correlationId: draft.correlationId }),
      ...(draft.causationId === undefined ? {} : { causationId: draft.causationId }),
      ...(draft.source === undefined ? {} : { source: draft.source }),
      ...(draft.entityType === undefined ? {} : { entityType: draft.entityType }),
      ...(draft.entityId === undefined ? {} : { entityId: draft.entityId }),
      ...(draft.classification === undefined ? {} : { classification: draft.classification }),
      payload: draft.payload ?? {},
      ...(draft.maxAttempts === undefined ? {} : { maxAttempts: draft.maxAttempts }),
    };
  });
}

/** The arguments `durable_job_settle` takes, in the names it takes them by. */
export function settleArguments(
  lease: JobLease,
  settlement: JobSettlement,
  nowIso: string,
): Readonly<Record<string, unknown>> {
  return {
    p_job_id: lease.jobId,
    p_organization_id: lease.organizationId,
    p_worker: lease.owner,
    p_generation: lease.generation,
    p_disposition: settlement.disposition,
    p_result: settlement.disposition === 'succeeded' ? (settlement.result ?? null) : null,
    p_failure_code: settlement.disposition === 'succeeded' ? null : settlement.failureCode,
    p_failure_detail:
      settlement.disposition === 'succeeded' ? null : (settlement.failureDetail ?? null),
    p_available_at: settlement.disposition === 'retry' ? settlement.availableAt : null,
    p_events: settleEventsArgument(
      settlement.disposition === 'retry' ? [] : settlement.events,
    ),
    p_now: nowIso,
  };
}

function rows(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Readonly<Record<string, unknown>> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

// ── The stores ──────────────────────────────────────────────────────────────

/**
 * The durable stores, backed by the migration.
 *
 * Every method that must be atomic goes through `rpc` to the function that owns
 * that atomicity. Nothing here reimplements a lease comparison, an idempotency
 * check or a transaction — those are in SQL, which is the only place they can
 * be true under concurrency.
 */
export function createPostgresDurableStores(gateway: DurableSqlGateway): DurableStores {
  const jobs: DurableStores['jobs'] = {
    async enqueue(input, nowIso) {
      const actor = assertJobActor(input.actor, input.organizationId);
      const retry = normalizeRetryPolicy(input.retry);

      const inserted = await gateway.insert(
        DURABLE_TABLE.jobs,
        {
          organization_id: input.organizationId,
          job_type: input.jobType,
          state: 'queued',
          priority: input.priority ?? 100,
          available_at: input.availableAt ?? nowIso,
          max_attempts: normalizeMaxAttempts(input.maxAttempts),
          backoff_kind: retry.kind,
          backoff_base_ms: retry.baseMs,
          backoff_max_ms: retry.maxMs,
          lease_ttl_ms: normalizeLeaseTtlMs(input.leaseTtlMs),
          idempotency_key: input.idempotencyKey,
          correlation_id: input.correlationId,
          causation_id: input.causationId ?? null,
          schedule_id: input.scheduleId ?? null,
          actor_id: actor.actorId,
          actor_type: actor.actorType,
          actor_permissions: actor.permissions,
          initiated_by_actor_id: actor.initiatedBy?.actorId ?? null,
          initiated_by_actor_type: actor.initiatedBy?.actorType ?? null,
          input: input.input ?? {},
        },
        { ignoreConflict: true },
      );

      if (inserted.length > 0) {
        return { job: toDurableJob(inserted[0]), created: true };
      }

      // The unique key held. Return the job that already owns it — which is the
      // whole point of the key, and not an error the caller has to handle.
      const existing = await gateway.select(DURABLE_TABLE.jobs, {
        match: {
          organization_id: input.organizationId,
          job_type: input.jobType,
          idempotency_key: input.idempotencyKey,
        },
        limit: 1,
      });
      if (existing.length === 0) {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This work could not be recorded.',
          `insert conflicted for ${input.jobType}/${input.idempotencyKey} but no row was found`,
        );
      }
      return { job: toDurableJob(existing[0]), created: false };
    },

    async load(organizationId, jobId) {
      const found = await gateway.select(DURABLE_TABLE.jobs, {
        // TENANT IN THE PREDICATE, NOT CHECKED AFTERWARDS. A read filtered in
        // the isolate is a read that returned the row first.
        match: { organization_id: organizationId, id: jobId },
        limit: 1,
      });
      return found.length === 0 ? undefined : toDurableJob(found[0]);
    },

    async list(query) {
      const found = await gateway.select(DURABLE_TABLE.jobs, {
        match: {
          organization_id: query.organizationId,
          ...(query.jobType === undefined ? {} : { job_type: query.jobType }),
          ...(query.correlationId === undefined ? {} : { correlation_id: query.correlationId }),
        },
        ...(query.states === undefined
          ? {}
          : { inList: { column: 'state', values: [...query.states] } }),
        order: { column: 'created_at', ascending: true },
        limit: boundedLimit(query.limit),
      });
      return found.map(toDurableJob);
    },

    async claim(organizationId, jobTypes, worker, leaseTtlMs, nowIso) {
      const claimed = rows(
        await gateway.rpc(DURABLE_RPC.claim, {
          p_organization_id: organizationId,
          p_job_types: jobTypes === undefined ? null : [...jobTypes],
          p_worker: worker,
          p_lease_ttl_ms: normalizeLeaseTtlMs(leaseTtlMs),
          p_now: nowIso,
        }),
      );
      if (claimed.length === 0) return undefined;
      const job = toDurableJob(claimed[0]);
      if (job.leaseOwner === undefined || job.leaseExpiresAt === undefined) return undefined;
      return {
        job,
        lease: {
          jobId: job.jobId,
          organizationId: job.organizationId,
          owner: job.leaseOwner,
          generation: job.leaseGeneration,
          expiresAt: job.leaseExpiresAt,
        },
      };
    },

    async heartbeat(lease, leaseTtlMs, nowIso) {
      const ttl = normalizeLeaseTtlMs(leaseTtlMs);
      const extended = await gateway.rpc(DURABLE_RPC.heartbeat, {
        p_job_id: lease.jobId,
        p_organization_id: lease.organizationId,
        p_worker: lease.owner,
        p_generation: lease.generation,
        p_lease_ttl_ms: ttl,
        p_now: nowIso,
      });
      if (extended !== true) return undefined;
      // The generation does not move on a heartbeat — only a claim bumps it —
      // so the lease the caller holds stays valid with a later expiry.
      return { ...lease, expiresAt: new Date(Date.parse(nowIso) + ttl).toISOString() };
    },

    async settle(lease, settlement, nowIso) {
      const settled = await gateway.rpc(
        DURABLE_RPC.settle,
        settleArguments(lease, settlement, nowIso),
      );
      return settled === true;
    },

    async transition(organizationId, jobId, to, nowIso) {
      // The three operator transitions. Each one names the state it may come
      // FROM, so the update is conditional in the database rather than after a
      // read — which is what stops a pause from landing on a job that was
      // claimed a millisecond earlier.
      const from: readonly JobState[] =
        to === 'paused' ? ['queued'] : to === 'queued' ? ['paused'] : ['queued', 'paused', 'leased'];

      const updated = await gateway.update(
        DURABLE_TABLE.jobs,
        {
          state: to,
          updated_at: nowIso,
          ...(to === 'cancelled'
            ? { lease_owner: null, lease_expires_at: null, completed_at: nowIso }
            : {}),
        },
        {
          organization_id: organizationId,
          id: jobId,
          // Expressed as a match on the single legal source state where there
          // is one. Cancellation's three are handled by the caller re-reading:
          // `update` takes equality only, by design — a port that grew an `in`
          // for writes would be a port that could express an unbounded update.
          ...(from.length === 1 ? { state: from[0] } : {}),
        },
      );
      if (updated.length === 0) return undefined;
      return toDurableJob(updated[0]);
    },

    async recoverExpiredLeases(nowIso, limit) {
      const recovered = rows(
        await gateway.rpc(DURABLE_RPC.recover, {
          p_now: nowIso,
          p_limit: boundedLimit(limit),
        }),
      );
      // The function returns one row of two counts. An empty result means no
      // lease had expired, which is the ordinary case and not a failure.
      const first = recovered[0] ?? {};
      return {
        recovered: typeof first.recovered === 'number' ? first.recovered : 0,
        deadLettered: typeof first.dead_lettered === 'number' ? first.dead_lettered : 0,
      };
    },

    async deadLetters(query) {
      const found = await gateway.select(DURABLE_TABLE.deadLetters, {
        match: {
          organization_id: query.organizationId,
          ...(query.originKind === undefined ? {} : { origin_kind: query.originKind }),
          ...(query.unrecoveredOnly ? { recovery_state: 'unrecovered' } : {}),
        },
        order: { column: 'last_failed_at', ascending: false },
        limit: boundedLimit(query.limit),
      });
      return found.map(toDeadLetterRecord);
    },
  };

  const schedules: DurableStores['schedules'] = {
    async upsert(input, nowIso) {
      const actor = assertJobActor(input.actor, input.organizationId);
      const existing = await gateway.select(DURABLE_TABLE.schedules, {
        match: { organization_id: input.organizationId, schedule_key: input.scheduleKey },
        limit: 1,
      });

      const shape = {
        job_type: input.jobType,
        status: 'active',
        next_run_at: input.nextRunAt,
        recurrence_interval_ms: input.recurrenceIntervalMs ?? null,
        actor_id: actor.actorId,
        actor_type: actor.actorType,
        actor_permissions: actor.permissions,
        initiated_by_actor_id: actor.initiatedBy?.actorId ?? null,
        initiated_by_actor_type: actor.initiatedBy?.actorType ?? null,
        correlation_id: input.correlationId,
        input: input.input ?? {},
        updated_at: nowIso,
      };

      if (existing.length > 0) {
        const updated = await gateway.update(DURABLE_TABLE.schedules, shape, {
          organization_id: input.organizationId,
          schedule_key: input.scheduleKey,
        });
        return toSchedule(updated[0] ?? existing[0]);
      }

      const inserted = await gateway.insert(DURABLE_TABLE.schedules, {
        organization_id: input.organizationId,
        schedule_key: input.scheduleKey,
        ...shape,
      });
      if (inserted.length === 0) {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This schedule could not be recorded.',
          `insert produced no row for ${input.scheduleKey}`,
        );
      }
      return toSchedule(inserted[0]);
    },

    async load(organizationId, scheduleId) {
      const found = await gateway.select(DURABLE_TABLE.schedules, {
        match: { organization_id: organizationId, id: scheduleId },
        limit: 1,
      });
      return found.length === 0 ? undefined : toSchedule(found[0]);
    },

    async byKey(organizationId, scheduleKey) {
      const found = await gateway.select(DURABLE_TABLE.schedules, {
        match: { organization_id: organizationId, schedule_key: scheduleKey },
        limit: 1,
      });
      return found.length === 0 ? undefined : toSchedule(found[0]);
    },

    async list(organizationId, limit) {
      const found = await gateway.select(DURABLE_TABLE.schedules, {
        match: { organization_id: organizationId },
        order: { column: 'next_run_at', ascending: true },
        limit: boundedLimit(limit),
      });
      return found.map(toSchedule);
    },

    async materializeDue(organizationId, nowIso, limit) {
      const produced = rows(
        await gateway.rpc(DURABLE_RPC.materialize, {
          p_organization_id: organizationId,
          p_now: nowIso,
          p_limit: boundedLimit(limit),
        }),
      );
      return produced.map((row) => ({
        scheduleId: text(row, 'schedule_id'),
        jobId: text(row, 'job_id'),
        occurrenceAt: text(row, 'occurrence_at'),
        created: row.created === true,
      }));
    },

    async setStatus(organizationId, scheduleId, status, nowIso) {
      const updated = await gateway.update(
        DURABLE_TABLE.schedules,
        { status, updated_at: nowIso },
        { organization_id: organizationId, id: scheduleId },
      );
      return updated.length === 0 ? undefined : toSchedule(updated[0]);
    },
  };

  const outbox: DurableStores['outbox'] = {
    async load(organizationId, eventId) {
      const found = await gateway.select(DURABLE_TABLE.outbox, {
        match: { organization_id: organizationId, id: eventId },
        limit: 1,
      });
      return found.length === 0 ? undefined : toEventRecord(found[0]);
    },

    async list(query) {
      const found = await gateway.select(DURABLE_TABLE.outbox, {
        match: {
          organization_id: query.organizationId,
          ...(query.eventType === undefined ? {} : { event_type: query.eventType }),
          ...(query.correlationId === undefined ? {} : { correlation_id: query.correlationId }),
        },
        order: { column: 'created_at', ascending: true },
        limit: boundedLimit(query.limit),
      });
      return found.map(toEventRecord);
    },

    async claimPending(organizationId, worker, leaseTtlMs, nowIso, limit) {
      // No dedicated SQL function: an outbox claim needs no cross-row
      // arbitration beyond the conditional update below, because the generation
      // comparison in `markDispatched` is what makes a lost race harmless.
      // A second dispatcher that leases the same event cannot complete it.
      const pending = await gateway.select(DURABLE_TABLE.outbox, {
        match: { organization_id: organizationId, dispatch_state: 'pending' },
        order: { column: 'created_at', ascending: true },
        limit: boundedLimit(limit),
      });

      const ttl = normalizeLeaseTtlMs(leaseTtlMs);
      const claimed: DomainEventRecord[] = [];
      for (const row of pending) {
        const event = toEventRecord(row);
        if (event.attempt >= event.maxAttempts) continue;
        const updated = await gateway.update(
          DURABLE_TABLE.outbox,
          {
            dispatch_state: 'dispatching',
            lease_owner: worker,
            lease_generation: event.leaseGeneration + 1,
            lease_expires_at: new Date(Date.parse(nowIso) + ttl).toISOString(),
            attempt: event.attempt + 1,
            updated_at: nowIso,
          },
          {
            organization_id: organizationId,
            id: event.eventId,
            // The conditional that arbitrates. Two dispatchers reading the same
            // pending row: the first update moves it out of `pending`, the
            // second matches nothing.
            dispatch_state: 'pending',
            lease_generation: event.leaseGeneration,
          },
        );
        if (updated.length > 0) claimed.push(toEventRecord(updated[0]));
      }
      return claimed;
    },

    async markDispatched(organizationId, eventId, worker, generation, nowIso) {
      const updated = await gateway.update(
        DURABLE_TABLE.outbox,
        {
          dispatch_state: 'dispatched',
          lease_owner: null,
          lease_expires_at: null,
          dispatched_at: nowIso,
          updated_at: nowIso,
        },
        {
          organization_id: organizationId,
          id: eventId,
          dispatch_state: 'dispatching',
          lease_owner: worker,
          lease_generation: generation,
        },
      );
      return updated.length > 0;
    },

    async markFailed(
      organizationId,
      eventId,
      worker,
      generation,
      failureCode,
      failureDetail,
      availableAt,
      nowIso,
    ) {
      const current = await gateway.select(DURABLE_TABLE.outbox, {
        match: { organization_id: organizationId, id: eventId },
        limit: 1,
      });
      if (current.length === 0) return undefined;
      const event = toEventRecord(current[0]);
      const exhausted = event.attempt >= event.maxAttempts;

      const updated = await gateway.update(
        DURABLE_TABLE.outbox,
        {
          dispatch_state: exhausted ? 'failed' : 'pending',
          lease_owner: null,
          lease_expires_at: null,
          ...(exhausted ? {} : { available_at: availableAt }),
          failure_code: failureCode,
          failure_detail: failureDetail ?? null,
          updated_at: nowIso,
        },
        {
          organization_id: organizationId,
          id: eventId,
          dispatch_state: 'dispatching',
          lease_owner: worker,
          lease_generation: generation,
        },
      );
      if (updated.length === 0) return undefined;

      if (exhausted) {
        // AN UNDELIVERABLE EVENT IS NOT DROPPED. Same monitored path as an
        // exhausted job, so one query answers "what is the platform losing".
        await gateway.insert(
          DURABLE_TABLE.deadLetters,
          {
            organization_id: organizationId,
            origin_kind: 'event',
            origin_id: eventId,
            origin_type: event.eventType,
            attempts: Math.max(event.attempt, 1),
            failure_code: failureCode,
            failure_detail: failureDetail ?? null,
            correlation_id: event.correlationId,
            causation_id: event.causationId ?? null,
            first_failed_at: event.createdAt,
            last_failed_at: nowIso,
          },
          { ignoreConflict: true },
        );
      }
      return { deadLettered: exhausted };
    },

    async oldestPendingAt() {
      const found = await gateway.select(DURABLE_TABLE.outbox, {
        match: { dispatch_state: 'pending' },
        order: { column: 'created_at', ascending: true },
        limit: 1,
      });
      return found.length === 0 ? undefined : optionalText(found[0], 'created_at');
    },

    async pendingCount(organizationId) {
      const found = await gateway.select(DURABLE_TABLE.outbox, {
        match: {
          dispatch_state: 'pending',
          ...(organizationId === undefined ? {} : { organization_id: organizationId }),
        },
        limit: 500,
      });
      return found.length;
    },
  };

  const inbox: DurableStores['inbox'] = {
    async claim(organizationId, consumerKey, event, nowIso) {
      if (event.organizationId !== organizationId) {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.tenantMismatch,
          'That event belongs to a different organization.',
          `event ${event.eventId} is owned by ${event.organizationId}, not ${organizationId}`,
        );
      }
      // INSERT-FIRST. The unique constraint arbitrates; a conflict means this
      // consumer has already seen this event and must not act again.
      const inserted = await gateway.insert(
        DURABLE_TABLE.inbox,
        {
          organization_id: organizationId,
          consumer_key: consumerKey,
          event_id: event.eventId,
          event_type: event.eventType,
          status: 'processed',
          processed_at: nowIso,
          correlation_id: event.correlationId,
          causation_id: event.causationId ?? null,
        },
        { ignoreConflict: true },
      );
      return inserted.length === 0 ? undefined : toInboxRecord(inserted[0]);
    },

    async settle(organizationId, consumerKey, eventId, status, detail, nowIso) {
      const updated = await gateway.update(
        DURABLE_TABLE.inbox,
        {
          status,
          processed_at: nowIso,
          failure_code: detail.failureCode ?? null,
          failure_detail: detail.failureDetail ?? null,
          result: detail.result ?? null,
          updated_at: nowIso,
        },
        { organization_id: organizationId, consumer_key: consumerKey, event_id: eventId },
      );
      return updated.length === 0 ? undefined : toInboxRecord(updated[0]);
    },

    async find(organizationId, consumerKey, eventId) {
      const found = await gateway.select(DURABLE_TABLE.inbox, {
        match: {
          organization_id: organizationId,
          consumer_key: consumerKey,
          event_id: eventId,
        },
        limit: 1,
      });
      return found.length === 0 ? undefined : toInboxRecord(found[0]);
    },

    async count(organizationId, consumerKey) {
      const found = await gateway.select(DURABLE_TABLE.inbox, {
        match: {
          organization_id: organizationId,
          ...(consumerKey === undefined ? {} : { consumer_key: consumerKey }),
        },
        limit: 500,
      });
      return found.length;
    },
  };

  return { jobs, schedules, outbox, inbox };
}

/** Re-exported so a caller can build an occurrence key without a second import. */
export { occurrenceIdempotencyKey };
