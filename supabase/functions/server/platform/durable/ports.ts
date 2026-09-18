/**
 * Persistence ports for the durable runtime, and one reference implementation.
 *
 * THE RULE, INHERITED FROM THE WORKFLOW ENGINE AND RESTATED BECAUSE IT MATTERS
 * MORE HERE: isolate memory is never the authority. BP-002 is explicit —
 * "in-memory state is never authoritative for jobs, schedules, outbox, inbox or
 * dead-letter state" — and the whole point of the packet is that work survives
 * the isolate.
 *
 * ── SO WHY IS THERE AN IN-MEMORY STORE IN THIS FILE ───────────────────────
 *
 * The same reason `ai/workflows/persistence/ports.ts` ships one, and the
 * distinction is worth being exact about, because "we have an in-memory store"
 * and "we use memory as the authority" are one careless sentence apart.
 *
 * The in-memory store here is a REFERENCE IMPLEMENTATION OF THE CONTRACT. It
 * exists so that the lease rules, the claim ordering, the idempotency
 * guarantees and the outbox atomicity can be driven by a test in milliseconds
 * without a database — and so that the SAME assertions can be run against the
 * Postgres store when one is available. It is wired into no production
 * composition. `postgresStores.ts` is the one the runtime gets, and the SQL
 * functions behind it are where the guarantees actually live.
 *
 * Two things follow, and both are enforced rather than hoped for:
 *
 *   THE MEMORY STORE REFUSES EXACTLY WHAT THE DATABASE REFUSES. Every CHECK,
 *   every unique key and every lease predicate in `20260919120000` and
 *   `20260919120002` has a counterpart here. A test that passes against memory
 *   and would fail against Postgres is worse than no test, because it certifies
 *   the opposite of what it checks.
 *
 *   `completeWithEvents` IS ONE OPERATION IN BOTH. In Postgres it is one
 *   transaction inside `durable_job_settle`. Here it is written so that a
 *   failure anywhere in it leaves NOTHING changed. An implementation that
 *   wrote the job and then the events would pass every test and would not be
 *   the transactional outbox pattern.
 */

import {
  DURABLE_FAILURE,
  DurableRuntimeError,
  TERMINAL_JOB_STATES,
  type ConsumeResult,
  type DeadLetterRecord,
  type DomainEventDraft,
  type DomainEventRecord,
  type DurableJob,
  type DurableSchedule,
  type EnqueueJobInput,
  type EnqueueResult,
  type InboxRecord,
  type InboxStatus,
  type JobLease,
  type JobState,
  type ScheduleOccurrence,
  type UpsertScheduleInput,
} from './contracts.ts';
import {
  assertEventDraft,
  assertJobActor,
  instantMs,
  isIsoInstant,
  isSafeIdentifier,
  normalizeLeaseTtlMs,
  normalizeMaxAttempts,
  normalizeRetryPolicy,
} from './guards.ts';
import { compareClaimOrder, holdsLiveLease, isClaimable, isLeaseExpired, leaseFor } from './lease.ts';
import { nextOccurrenceAt, occurrenceIdempotencyKey } from './recurrence.ts';

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Every query is tenant-scoped, and `organizationId` is REQUIRED on all of them.
 *
 * Not "should be passed" — required by the type. The same call
 * `WorkflowRunQuery` makes: there is no cross-tenant listing at this layer, and
 * the way to guarantee that is to make a cross-tenant query unexpressible
 * rather than to check for one at every call site.
 *
 * The two platform sweeps that legitimately cross tenants — lease recovery and
 * the outbox backlog measure — are separate methods with separate names, so
 * "this reads every tenant" is a decision somebody made rather than a filter
 * somebody forgot.
 */
export interface JobQuery {
  readonly organizationId: string;
  readonly states?: readonly JobState[];
  readonly jobType?: string;
  readonly correlationId?: string;
  readonly limit?: number;
}

export interface EventQuery {
  readonly organizationId: string;
  readonly eventType?: string;
  readonly correlationId?: string;
  readonly limit?: number;
}

export interface DeadLetterQuery {
  readonly organizationId: string;
  readonly originKind?: DeadLetterRecord['originKind'];
  readonly unrecoveredOnly?: boolean;
  readonly limit?: number;
}

/** How a settle ended. Mirrors `durable_job_settle`'s `p_disposition`. */
export type JobSettlement =
  | {
      readonly disposition: 'succeeded';
      readonly result?: Readonly<Record<string, unknown>>;
      readonly events?: readonly DomainEventDraft[];
    }
  | {
      readonly disposition: 'retry';
      readonly failureCode: string;
      readonly failureDetail?: string;
      readonly availableAt: string;
    }
  | {
      readonly disposition: 'dead_letter';
      readonly failureCode: string;
      readonly failureDetail?: string;
      readonly events?: readonly DomainEventDraft[];
    };

export interface LeaseRecoveryResult {
  readonly recovered: number;
  readonly deadLettered: number;
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * Durable job state.
 *
 * Deliberately ONE port rather than four. Jobs, their leases, their settlement
 * and their dead-letter rows are written together and must not be able to
 * disagree — `settle` writes a job row, an outbox row and a dead-letter row in
 * one transaction, and a design that put those behind three ports would have to
 * invent a distributed transaction to reunite them.
 */
export interface DurableJobStore {
  /** Insert, or return the job that already holds this idempotency key. */
  enqueue(input: EnqueueJobInput, nowIso: string): Promise<EnqueueResult>;

  /** One job, tenant-scoped. Never another tenant's. */
  load(organizationId: string, jobId: string): Promise<DurableJob | undefined>;

  list(query: JobQuery): Promise<readonly DurableJob[]>;

  /**
   * Atomically lease at most one due job.
   *
   * `jobTypes` absent means any type. Resolves undefined when nothing is
   * claimable — which is the ordinary case for a scheduler tick, not an error.
   */
  claim(
    organizationId: string,
    jobTypes: readonly string[] | undefined,
    worker: string,
    leaseTtlMs: number,
    nowIso: string,
  ): Promise<{ readonly job: DurableJob; readonly lease: JobLease } | undefined>;

  /** Extend a live lease. False when it is no longer the live one. */
  heartbeat(lease: JobLease, leaseTtlMs: number, nowIso: string): Promise<JobLease | undefined>;

  /**
   * Settle a leased job AND write its events in one atomic operation.
   *
   * False when the presented lease is not the live one — and then NOTHING is
   * written, events included. See the file header.
   */
  settle(lease: JobLease, settlement: JobSettlement, nowIso: string): Promise<boolean>;

  /** Pause, resume or cancel. Refuses a terminal job. */
  transition(
    organizationId: string,
    jobId: string,
    to: Extract<JobState, 'paused' | 'queued' | 'cancelled'>,
    nowIso: string,
  ): Promise<DurableJob | undefined>;

  /**
   * Return abandoned jobs to the queue, or dead-letter the exhausted.
   *
   * CROSS-TENANT BY DESIGN, and named so nobody has to wonder. A worker dying
   * is a platform event, not a tenant's, and a recovery sweep that had to be
   * run once per organization would leave every tenant nobody remembered to
   * sweep holding jobs forever.
   */
  recoverExpiredLeases(nowIso: string, limit: number): Promise<LeaseRecoveryResult>;

  /** Dead-letter rows, tenant-scoped. */
  deadLetters(query: DeadLetterQuery): Promise<readonly DeadLetterRecord[]>;
}

export interface ScheduleStore {
  /** Create or update by `(organizationId, scheduleKey)`. */
  upsert(input: UpsertScheduleInput, nowIso: string): Promise<DurableSchedule>;
  load(organizationId: string, scheduleId: string): Promise<DurableSchedule | undefined>;
  byKey(organizationId: string, scheduleKey: string): Promise<DurableSchedule | undefined>;
  list(organizationId: string, limit?: number): Promise<readonly DurableSchedule[]>;
  /**
   * Advance due schedules and enqueue one job per occurrence.
   *
   * Repeated ticks and racing ticks both produce exactly one job per
   * occurrence. An occurrence that another tick already materialized comes back
   * with `created: false` and the job id the winner made.
   */
  materializeDue(
    organizationId: string,
    nowIso: string,
    limit: number,
  ): Promise<readonly ScheduleOccurrence[]>;
  setStatus(
    organizationId: string,
    scheduleId: string,
    status: DurableSchedule['status'],
    nowIso: string,
  ): Promise<DurableSchedule | undefined>;
}

export interface OutboxStore {
  load(organizationId: string, eventId: string): Promise<DomainEventRecord | undefined>;
  list(query: EventQuery): Promise<readonly DomainEventRecord[]>;
  /** Lease pending events for dispatch. Same generation discipline as jobs. */
  claimPending(
    organizationId: string,
    worker: string,
    leaseTtlMs: number,
    nowIso: string,
    limit: number,
  ): Promise<readonly DomainEventRecord[]>;
  markDispatched(
    organizationId: string,
    eventId: string,
    worker: string,
    generation: number,
    nowIso: string,
  ): Promise<boolean>;
  /** Record a failed dispatch. Dead-letters the event once attempts are spent. */
  markFailed(
    organizationId: string,
    eventId: string,
    worker: string,
    generation: number,
    failureCode: string,
    failureDetail: string | undefined,
    availableAt: string,
    nowIso: string,
  ): Promise<{ readonly deadLettered: boolean } | undefined>;
  /** Oldest pending event across every tenant, for the backlog-age measure. */
  oldestPendingAt(): Promise<string | undefined>;
  pendingCount(organizationId?: string): Promise<number>;
}

export interface InboxStore {
  /**
   * Claim the right to process this event, once.
   *
   * INSERT-FIRST, NOT READ-THEN-WRITE. Resolves undefined when this consumer
   * has already seen this event. Two isolates racing on the same delivery: one
   * gets a record, the other gets undefined, and only one effect happens.
   * A read-then-write pair would let both read "not seen" before either wrote.
   */
  claim(
    organizationId: string,
    consumerKey: string,
    event: DomainEventRecord,
    nowIso: string,
  ): Promise<InboxRecord | undefined>;
  /** Record how processing went, on a record this consumer already claimed. */
  settle(
    organizationId: string,
    consumerKey: string,
    eventId: string,
    status: InboxStatus,
    detail: {
      readonly failureCode?: string;
      readonly failureDetail?: string;
      readonly result?: Readonly<Record<string, unknown>>;
    },
    nowIso: string,
  ): Promise<InboxRecord | undefined>;
  find(
    organizationId: string,
    consumerKey: string,
    eventId: string,
  ): Promise<InboxRecord | undefined>;
  count(organizationId: string, consumerKey?: string): Promise<number>;
}

/** The four ports a runtime needs, gathered. */
export interface DurableStores {
  readonly jobs: DurableJobStore;
  readonly schedules: ScheduleStore;
  readonly outbox: OutboxStore;
  readonly inbox: InboxStore;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * The event a draft becomes.
 *
 * ONE PROJECTION, used by the memory store and by the Postgres store's argument
 * builder. The defaults live here rather than in two dialects, because a
 * `causationId` that defaults to the job id in SQL and to undefined in
 * TypeScript would make a trace that is complete in production and broken in
 * every test.
 */
export function eventRecordFrom(
  draft: DomainEventDraft,
  job: DurableJob,
  nowIso: string,
): DomainEventRecord {
  assertEventDraft(draft);
  return {
    eventId: draft.eventId,
    organizationId: job.organizationId,
    eventType: draft.eventType,
    eventVersion: draft.eventVersion ?? 1,
    occurredAt: draft.occurredAt ?? nowIso,
    actorId: draft.actorId ?? job.actor.actorId,
    actorType: draft.actorType ?? job.actor.actorType,
    correlationId: draft.correlationId ?? job.correlationId,
    // CAUSATION DEFAULTS TO THE JOB. An event whose cause is unstated is an
    // event nobody can trace back, and the job that emitted it is the true
    // answer rather than a convenient one.
    causationId: draft.causationId ?? job.jobId,
    source: draft.source ?? 'durable.job',
    ...(draft.entityType === undefined ? {} : { entityType: draft.entityType }),
    ...(draft.entityId === undefined ? {} : { entityId: draft.entityId }),
    classification: draft.classification ?? 'internal',
    payload: draft.payload ?? {},
    dispatchState: 'pending',
    attempt: 0,
    maxAttempts: draft.maxAttempts ?? 5,
    availableAt: nowIso,
    leaseGeneration: 0,
    jobId: job.jobId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function matchesJobQuery(job: DurableJob, query: JobQuery): boolean {
  if (job.organizationId !== query.organizationId) return false;
  if (query.states && !query.states.includes(job.state)) return false;
  if (query.jobType !== undefined && job.jobType !== query.jobType) return false;
  if (query.correlationId !== undefined && job.correlationId !== query.correlationId) return false;
  return true;
}

// ── The reference implementation ────────────────────────────────────────────

interface MemoryState {
  readonly jobs: Map<string, DurableJob>;
  readonly jobsByIdempotency: Map<string, string>;
  readonly schedules: Map<string, DurableSchedule>;
  readonly schedulesByKey: Map<string, string>;
  readonly events: Map<string, DomainEventRecord>;
  readonly inbox: Map<string, InboxRecord>;
  readonly deadLetters: Map<string, DeadLetterRecord>;
  sequence: number;
}

function newState(): MemoryState {
  return {
    jobs: new Map(),
    jobsByIdempotency: new Map(),
    schedules: new Map(),
    schedulesByKey: new Map(),
    events: new Map(),
    inbox: new Map(),
    deadLetters: new Map(),
    sequence: 0,
  };
}

/**
 * Deterministic ids.
 *
 * NOT `crypto.randomUUID()`, and that is deliberate rather than lazy: a test
 * that fails on the fourteenth run because two generated ids happened to sort
 * differently is a test nobody trusts. A counter makes every run identical, and
 * the production store uses `gen_random_uuid()` in the database where the id
 * actually needs to be globally unique.
 */
function nextId(state: MemoryState, prefix: string): string {
  state.sequence += 1;
  return `${prefix}-${String(state.sequence).padStart(8, '0')}`;
}

function idempotencyIndexKey(organizationId: string, jobType: string, key: string): string {
  return `${organizationId}\u0000${jobType}\u0000${key}`;
}

function inboxIndexKey(organizationId: string, consumerKey: string, eventId: string): string {
  return `${organizationId}\u0000${consumerKey}\u0000${eventId}`;
}

function deadLetterIndexKey(organizationId: string, kind: string, originId: string): string {
  return `${organizationId}\u0000${kind}\u0000${originId}`;
}

function requireInstant(value: string, field: string): number {
  const ms = instantMs(value);
  if (ms === undefined) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.jobInvalid,
      'This work carries a time nobody can read.',
      `${field} is not a readable instant: ${value}`,
    );
  }
  return ms;
}

/**
 * The in-memory reference stores.
 *
 * One `MemoryState` shared by all four, because they reference each other —
 * an inbox row points at an outbox row, an outbox row at a job — and four
 * independent stores could hold a consumer record for an event that does not
 * exist. Postgres enforces that with foreign keys; here it is enforced by there
 * being one place for the facts to live.
 */
export function createMemoryDurableStores(): DurableStores & { reset(): void } {
  let state = newState();

  const jobs: DurableJobStore = {
    async enqueue(input, nowIso) {
      if (!isSafeIdentifier(input.organizationId)) {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This work names no organization.',
          'organization id is absent or malformed',
        );
      }
      if (!isSafeIdentifier(input.jobType)) {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This work has no kind.',
          'job type is absent or malformed',
        );
      }
      if (input.idempotencyKey.trim() === '' || input.correlationId.trim() === '') {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This work cannot be identified.',
          'idempotency key and correlation id are both required',
        );
      }
      // Throws on a human actor, a cross-tenant actor, or an unreadable one.
      const actor = assertJobActor(input.actor, input.organizationId);

      const index = idempotencyIndexKey(input.organizationId, input.jobType, input.idempotencyKey);
      const existingId = state.jobsByIdempotency.get(index);
      if (existingId !== undefined) {
        const existing = state.jobs.get(existingId);
        if (existing) return { job: existing, created: false };
      }

      const availableAt = input.availableAt ?? nowIso;
      if (!isIsoInstant(availableAt)) {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This work carries a time nobody can read.',
          `availableAt is not a readable instant: ${availableAt}`,
        );
      }

      const job: DurableJob = {
        jobId: nextId(state, 'job'),
        organizationId: input.organizationId,
        jobType: input.jobType,
        state: 'queued',
        priority: Number.isFinite(input.priority) ? Math.floor(input.priority as number) : 100,
        availableAt,
        attempt: 0,
        maxAttempts: normalizeMaxAttempts(input.maxAttempts),
        retry: normalizeRetryPolicy(input.retry),
        leaseGeneration: 0,
        leaseTtlMs: normalizeLeaseTtlMs(input.leaseTtlMs),
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        ...(input.scheduleId === undefined ? {} : { scheduleId: input.scheduleId }),
        actor,
        input: input.input ?? {},
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      state.jobs.set(job.jobId, job);
      state.jobsByIdempotency.set(index, job.jobId);
      return { job, created: true };
    },

    async load(organizationId, jobId) {
      const job = state.jobs.get(jobId);
      // A job belonging to another tenant is ABSENT rather than forbidden. The
      // same call the workflow store makes: "not found" leaks nothing about
      // whether the id exists somewhere else.
      if (!job || job.organizationId !== organizationId) return undefined;
      return job;
    },

    async list(query) {
      const limit = boundedLimit(query.limit);
      return [...state.jobs.values()]
        .filter((job) => matchesJobQuery(job, query))
        .sort(compareClaimOrder)
        .slice(0, limit);
    },

    async claim(organizationId, jobTypes, worker, leaseTtlMs, nowIso) {
      if (worker.trim() === '') {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'A worker must identify itself to take work.',
          'worker identity is empty',
        );
      }
      const nowMs = requireInstant(nowIso, 'now');
      const ttl = normalizeLeaseTtlMs(leaseTtlMs);

      const candidate = [...state.jobs.values()]
        .filter((job) => isClaimable(job, organizationId, nowMs))
        .filter((job) => jobTypes === undefined || jobTypes.includes(job.jobType))
        .sort(compareClaimOrder)[0];

      if (!candidate) return undefined;

      const claimed: DurableJob = {
        ...candidate,
        state: 'leased',
        leaseOwner: worker,
        // BUMPED ON EVERY CLAIM, NEVER REUSED. The whole reason a stale settle
        // by the same worker is refusable. See `lease.ts`.
        leaseGeneration: candidate.leaseGeneration + 1,
        leaseExpiresAt: new Date(nowMs + ttl).toISOString(),
        heartbeatAt: nowIso,
        leaseTtlMs: ttl,
        attempt: candidate.attempt + 1,
        startedAt: candidate.startedAt ?? nowIso,
        updatedAt: nowIso,
      };
      state.jobs.set(claimed.jobId, claimed);

      const lease = leaseFor(claimed);
      if (!lease) return undefined;
      return { job: claimed, lease };
    },

    async heartbeat(lease, leaseTtlMs, nowIso) {
      const nowMs = requireInstant(nowIso, 'now');
      const job = state.jobs.get(lease.jobId);
      if (!job || !holdsLiveLease(job, lease, nowMs)) return undefined;

      const ttl = normalizeLeaseTtlMs(leaseTtlMs);
      const extended: DurableJob = {
        ...job,
        leaseExpiresAt: new Date(nowMs + ttl).toISOString(),
        heartbeatAt: nowIso,
        leaseTtlMs: ttl,
        updatedAt: nowIso,
      };
      state.jobs.set(extended.jobId, extended);
      return leaseFor(extended);
    },

    async settle(lease, settlement, nowIso) {
      const nowMs = requireInstant(nowIso, 'now');
      const job = state.jobs.get(lease.jobId);
      if (!job || !holdsLiveLease(job, lease, nowMs)) return false;

      // ── ATOMICITY, HERE, WITHOUT A TRANSACTION ─────────────────────────
      //
      // Every event is projected and VALIDATED BEFORE ANYTHING IS WRITTEN, so
      // an oversized payload on the third event cannot leave the job settled
      // and the first two published. `eventRecordFrom` throws on a malformed
      // draft, and it throws here — before the first `set`.
      const drafts = settlement.disposition === 'retry' ? [] : (settlement.events ?? []);
      const records = drafts.map((draft) => eventRecordFrom(draft, job, nowIso));

      let settled: DurableJob;
      if (settlement.disposition === 'succeeded') {
        settled = {
          ...job,
          state: 'succeeded',
          ...(settlement.result === undefined ? {} : { result: settlement.result }),
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          failureCode: undefined,
          failureDetail: undefined,
          completedAt: nowIso,
          updatedAt: nowIso,
        };
      } else if (settlement.disposition === 'retry') {
        const availableMs = instantMs(settlement.availableAt) ?? nowMs;
        settled = {
          ...job,
          state: 'queued',
          // NOT re-incremented. The claim spent the attempt; a settle that
          // touched it again would make the budget depend on how many times
          // the row was written rather than on how many times the work ran.
          availableAt: new Date(Math.max(availableMs, nowMs)).toISOString(),
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          failureCode: settlement.failureCode,
          ...(settlement.failureDetail === undefined
            ? {}
            : { failureDetail: settlement.failureDetail }),
          updatedAt: nowIso,
        };
      } else {
        settled = {
          ...job,
          state: 'dead_letter',
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          failureCode: settlement.failureCode,
          ...(settlement.failureDetail === undefined
            ? {}
            : { failureDetail: settlement.failureDetail }),
          completedAt: nowIso,
          updatedAt: nowIso,
        };
      }

      state.jobs.set(settled.jobId, settled);

      if (settlement.disposition === 'dead_letter') {
        recordDeadLetter(state, {
          organizationId: job.organizationId,
          originKind: 'job',
          originId: job.jobId,
          originType: job.jobType,
          attempts: Math.max(job.attempt, 1),
          failureCode: settlement.failureCode,
          ...(settlement.failureDetail === undefined
            ? {}
            : { failureDetail: settlement.failureDetail }),
          correlationId: job.correlationId,
          ...(job.causationId === undefined ? {} : { causationId: job.causationId }),
          firstFailedAt: job.startedAt ?? job.createdAt,
          lastFailedAt: nowIso,
        });
      }

      for (const record of records) {
        // Insert-if-absent, mirroring `ON CONFLICT (id) DO NOTHING`. A retried
        // settle re-presenting the same event id writes one event, not two.
        if (!state.events.has(record.eventId)) state.events.set(record.eventId, record);
      }
      return true;
    },

    async transition(organizationId, jobId, to, nowIso) {
      const job = state.jobs.get(jobId);
      if (!job || job.organizationId !== organizationId) return undefined;
      // TERMINAL MEANS TERMINAL. A succeeded job does not become queued, a
      // cancelled one does not resume. Without this, "cancel" would be
      // reversible by anything that could call `transition`.
      if (TERMINAL_JOB_STATES.has(job.state)) return undefined;

      if (to === 'paused' && job.state !== 'queued') return undefined;
      if (to === 'queued' && job.state !== 'paused') return undefined;

      const next: DurableJob = {
        ...job,
        state: to,
        // CANCELLING A LEASED JOB CLEARS ITS LEASE, which is what makes the
        // running worker's settle fail rather than silently complete work the
        // tenant asked to stop. BP-002 §8.9.
        ...(to === 'cancelled'
          ? { leaseOwner: undefined, leaseExpiresAt: undefined, completedAt: nowIso }
          : {}),
        updatedAt: nowIso,
      };
      state.jobs.set(next.jobId, next);
      return next;
    },

    async recoverExpiredLeases(nowIso, limit) {
      const nowMs = requireInstant(nowIso, 'now');
      const expired = [...state.jobs.values()]
        .filter((job) => isLeaseExpired(job, nowMs))
        .sort((a, b) => (instantMs(a.leaseExpiresAt) ?? 0) - (instantMs(b.leaseExpiresAt) ?? 0))
        .slice(0, boundedLimit(limit));

      let recovered = 0;
      let deadLettered = 0;

      for (const job of expired) {
        if (job.attempt >= job.maxAttempts) {
          // Abandoned on its last attempt. Dead-letter rather than requeue, so
          // it reaches the monitored path instead of becoming a row that is
          // permanently `leased` and permanently unclaimable.
          state.jobs.set(job.jobId, {
            ...job,
            state: 'dead_letter',
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            failureCode: DURABLE_FAILURE.leaseAbandoned,
            failureDetail:
              'the worker holding this job stopped reporting and no attempts remain',
            completedAt: nowIso,
            updatedAt: nowIso,
          });
          recordDeadLetter(state, {
            organizationId: job.organizationId,
            originKind: 'job',
            originId: job.jobId,
            originType: job.jobType,
            attempts: Math.max(job.attempt, 1),
            failureCode: DURABLE_FAILURE.leaseAbandoned,
            failureDetail:
              'the worker holding this job stopped reporting and no attempts remain',
            correlationId: job.correlationId,
            ...(job.causationId === undefined ? {} : { causationId: job.causationId }),
            firstFailedAt: job.startedAt ?? job.createdAt,
            lastFailedAt: nowIso,
          });
          deadLettered += 1;
          continue;
        }
        state.jobs.set(job.jobId, {
          ...job,
          state: 'queued',
          availableAt: nowIso,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          // NOT re-incremented — the claim that handed out the lapsed lease
          // already spent the attempt.
          failureCode: 'lease_expired',
          failureDetail: 'the worker holding this job stopped reporting',
          updatedAt: nowIso,
        });
        recovered += 1;
      }
      return { recovered, deadLettered };
    },

    async deadLetters(query) {
      const limit = boundedLimit(query.limit);
      return [...state.deadLetters.values()]
        .filter((record) => record.organizationId === query.organizationId)
        .filter((record) => !query.originKind || record.originKind === query.originKind)
        .filter((record) => !query.unrecoveredOnly || record.recoveryState === 'unrecovered')
        .sort((a, b) => (instantMs(b.lastFailedAt) ?? 0) - (instantMs(a.lastFailedAt) ?? 0))
        .slice(0, limit);
    },
  };

  const schedules: ScheduleStore = {
    async upsert(input, nowIso) {
      const actor = assertJobActor(input.actor, input.organizationId);
      if (!isIsoInstant(input.nextRunAt)) {
        throw new DurableRuntimeError(
          DURABLE_FAILURE.jobInvalid,
          'This schedule carries a time nobody can read.',
          `nextRunAt is not a readable instant: ${input.nextRunAt}`,
        );
      }
      const indexKey = `${input.organizationId}\u0000${input.scheduleKey}`;
      const existingId = state.schedulesByKey.get(indexKey);

      if (existingId !== undefined) {
        const existing = state.schedules.get(existingId);
        if (existing) {
          const updated: DurableSchedule = {
            ...existing,
            jobType: input.jobType,
            nextRunAt: input.nextRunAt,
            ...(input.recurrenceIntervalMs === undefined
              ? {}
              : { recurrenceIntervalMs: input.recurrenceIntervalMs }),
            actor,
            correlationId: input.correlationId,
            input: input.input ?? existing.input,
            // REACTIVATED ON UPSERT. "Make sure this schedule exists and is
            // running" is what every caller of this means, and a completed
            // one-time schedule that stayed completed would silently never fire
            // again.
            status: 'active',
            updatedAt: nowIso,
          };
          state.schedules.set(updated.scheduleId, updated);
          return updated;
        }
      }

      const schedule: DurableSchedule = {
        scheduleId: nextId(state, 'sched'),
        organizationId: input.organizationId,
        scheduleKey: input.scheduleKey,
        jobType: input.jobType,
        status: 'active',
        nextRunAt: input.nextRunAt,
        ...(input.recurrenceIntervalMs === undefined
          ? {}
          : { recurrenceIntervalMs: input.recurrenceIntervalMs }),
        materializeVersion: 0,
        actor,
        correlationId: input.correlationId,
        input: input.input ?? {},
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      state.schedules.set(schedule.scheduleId, schedule);
      state.schedulesByKey.set(indexKey, schedule.scheduleId);
      return schedule;
    },

    async load(organizationId, scheduleId) {
      const schedule = state.schedules.get(scheduleId);
      if (!schedule || schedule.organizationId !== organizationId) return undefined;
      return schedule;
    },

    async byKey(organizationId, scheduleKey) {
      const id = state.schedulesByKey.get(`${organizationId}\u0000${scheduleKey}`);
      if (id === undefined) return undefined;
      return this.load(organizationId, id);
    },

    async list(organizationId, limit) {
      return [...state.schedules.values()]
        .filter((schedule) => schedule.organizationId === organizationId)
        .sort((a, b) => (instantMs(a.nextRunAt) ?? 0) - (instantMs(b.nextRunAt) ?? 0))
        .slice(0, boundedLimit(limit));
    },

    async materializeDue(organizationId, nowIso, limit) {
      const nowMs = requireInstant(nowIso, 'now');
      const due = [...state.schedules.values()]
        .filter((schedule) => schedule.organizationId === organizationId)
        .filter((schedule) => schedule.status === 'active')
        .filter((schedule) => (instantMs(schedule.nextRunAt) ?? Number.MAX_SAFE_INTEGER) <= nowMs)
        .sort((a, b) => (instantMs(a.nextRunAt) ?? 0) - (instantMs(b.nextRunAt) ?? 0))
        .slice(0, boundedLimit(limit));

      const occurrences: ScheduleOccurrence[] = [];

      for (const schedule of due) {
        const occurrenceAt = schedule.nextRunAt;
        const next = nextOccurrenceAt(occurrenceAt, schedule.recurrenceIntervalMs, nowMs);

        // The compare-and-swap. `materializeVersion` is re-read from the store
        // rather than taken from the snapshot above, so a concurrent tick that
        // already advanced this schedule makes this one a no-op.
        const current = state.schedules.get(schedule.scheduleId);
        if (!current || current.materializeVersion !== schedule.materializeVersion) continue;

        state.schedules.set(schedule.scheduleId, {
          ...current,
          ...(next === undefined
            ? { status: 'completed' as const }
            : { nextRunAt: next }),
          lastRunAt: nowIso,
          lastOccurrenceAt: occurrenceAt,
          materializeVersion: current.materializeVersion + 1,
          updatedAt: nowIso,
        });

        const enqueued = await jobs.enqueue(
          {
            organizationId: schedule.organizationId,
            jobType: schedule.jobType,
            idempotencyKey: occurrenceIdempotencyKey(schedule.scheduleId, occurrenceAt),
            correlationId: schedule.correlationId,
            actor: schedule.actor,
            input: schedule.input,
            availableAt: occurrenceAt,
            scheduleId: schedule.scheduleId,
          },
          nowIso,
        );

        occurrences.push({
          scheduleId: schedule.scheduleId,
          jobId: enqueued.job.jobId,
          occurrenceAt,
          created: enqueued.created,
        });
      }
      return occurrences;
    },

    async setStatus(organizationId, scheduleId, status, nowIso) {
      const schedule = state.schedules.get(scheduleId);
      if (!schedule || schedule.organizationId !== organizationId) return undefined;
      const next: DurableSchedule = { ...schedule, status, updatedAt: nowIso };
      state.schedules.set(scheduleId, next);
      return next;
    },
  };

  const outbox: OutboxStore = {
    async load(organizationId, eventId) {
      const event = state.events.get(eventId);
      if (!event || event.organizationId !== organizationId) return undefined;
      return event;
    },

    async list(query) {
      return [...state.events.values()]
        .filter((event) => event.organizationId === query.organizationId)
        .filter((event) => !query.eventType || event.eventType === query.eventType)
        .filter((event) => !query.correlationId || event.correlationId === query.correlationId)
        .sort((a, b) => (instantMs(a.createdAt) ?? 0) - (instantMs(b.createdAt) ?? 0))
        .slice(0, boundedLimit(query.limit));
    },

    async claimPending(organizationId, worker, leaseTtlMs, nowIso, limit) {
      const nowMs = requireInstant(nowIso, 'now');
      const ttl = normalizeLeaseTtlMs(leaseTtlMs);
      const claimed: DomainEventRecord[] = [];

      const candidates = [...state.events.values()]
        .filter((event) => event.organizationId === organizationId)
        .filter((event) => event.dispatchState === 'pending')
        .filter((event) => (instantMs(event.availableAt) ?? Number.MAX_SAFE_INTEGER) <= nowMs)
        .filter((event) => event.attempt < event.maxAttempts)
        .sort((a, b) => (instantMs(a.createdAt) ?? 0) - (instantMs(b.createdAt) ?? 0))
        .slice(0, boundedLimit(limit));

      for (const event of candidates) {
        const leased: DomainEventRecord = {
          ...event,
          dispatchState: 'dispatching',
          leaseOwner: worker,
          leaseGeneration: event.leaseGeneration + 1,
          leaseExpiresAt: new Date(nowMs + ttl).toISOString(),
          attempt: event.attempt + 1,
          updatedAt: nowIso,
        };
        state.events.set(leased.eventId, leased);
        claimed.push(leased);
      }
      return claimed;
    },

    async markDispatched(organizationId, eventId, worker, generation, nowIso) {
      const event = state.events.get(eventId);
      if (!event || event.organizationId !== organizationId) return false;
      if (event.dispatchState !== 'dispatching') return false;
      if (event.leaseOwner !== worker || event.leaseGeneration !== generation) return false;

      state.events.set(eventId, {
        ...event,
        dispatchState: 'dispatched',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        dispatchedAt: nowIso,
        updatedAt: nowIso,
      });
      return true;
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
      const event = state.events.get(eventId);
      if (!event || event.organizationId !== organizationId) return undefined;
      if (event.dispatchState !== 'dispatching') return undefined;
      if (event.leaseOwner !== worker || event.leaseGeneration !== generation) return undefined;

      const exhausted = event.attempt >= event.maxAttempts;
      state.events.set(eventId, {
        ...event,
        dispatchState: exhausted ? 'failed' : 'pending',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        availableAt: exhausted ? event.availableAt : availableAt,
        failureCode,
        ...(failureDetail === undefined ? {} : { failureDetail }),
        updatedAt: nowIso,
      });

      if (exhausted) {
        // AN UNDELIVERABLE EVENT IS NOT DROPPED. BP-002 §12: exhausted
        // dispatch reaches a monitored failure path, the same one exhausted
        // jobs reach, so one query answers "what is the platform losing".
        recordDeadLetter(state, {
          organizationId,
          originKind: 'event',
          originId: eventId,
          originType: event.eventType,
          attempts: Math.max(event.attempt, 1),
          failureCode,
          ...(failureDetail === undefined ? {} : { failureDetail }),
          correlationId: event.correlationId,
          ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
          firstFailedAt: event.createdAt,
          lastFailedAt: nowIso,
        });
      }
      return { deadLettered: exhausted };
    },

    async oldestPendingAt() {
      const pending = [...state.events.values()]
        .filter((e) => e.dispatchState === 'pending' || e.dispatchState === 'dispatching')
        .sort((a, b) => (instantMs(a.createdAt) ?? 0) - (instantMs(b.createdAt) ?? 0));
      return pending[0]?.createdAt;
    },

    async pendingCount(organizationId) {
      return [...state.events.values()].filter(
        (event) =>
          (organizationId === undefined || event.organizationId === organizationId) &&
          (event.dispatchState === 'pending' || event.dispatchState === 'dispatching'),
      ).length;
    },
  };

  const inbox: InboxStore = {
    async claim(organizationId, consumerKey, event, nowIso) {
      if (event.organizationId !== organizationId) {
        // A consumer in one tenant may not record having processed another
        // tenant's event. Refused rather than ignored: this is the shape a
        // cross-tenant read would take if one ever got this far.
        throw new DurableRuntimeError(
          DURABLE_FAILURE.tenantMismatch,
          'That event belongs to a different organization.',
          `event ${event.eventId} is owned by ${event.organizationId}, not ${organizationId}`,
        );
      }
      const key = inboxIndexKey(organizationId, consumerKey, event.eventId);
      // INSERT-IF-ABSENT, mirroring the unique constraint. Two isolates racing
      // on one delivery: the first `set` wins, the second sees the key and
      // gets undefined. A read-then-write would let both read "absent".
      if (state.inbox.has(key)) return undefined;

      const record: InboxRecord = {
        inboxId: nextId(state, 'inbox'),
        organizationId,
        consumerKey,
        eventId: event.eventId,
        eventType: event.eventType,
        status: 'processed',
        processedAt: nowIso,
        correlationId: event.correlationId,
        ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
      };
      state.inbox.set(key, record);
      return record;
    },

    async settle(organizationId, consumerKey, eventId, status, detail, nowIso) {
      const key = inboxIndexKey(organizationId, consumerKey, eventId);
      const existing = state.inbox.get(key);
      if (!existing) return undefined;
      const updated: InboxRecord = {
        ...existing,
        status,
        processedAt: nowIso,
        ...(detail.failureCode === undefined ? {} : { failureCode: detail.failureCode }),
        ...(detail.failureDetail === undefined ? {} : { failureDetail: detail.failureDetail }),
        ...(detail.result === undefined ? {} : { result: detail.result }),
      };
      state.inbox.set(key, updated);
      return updated;
    },

    async find(organizationId, consumerKey, eventId) {
      return state.inbox.get(inboxIndexKey(organizationId, consumerKey, eventId));
    },

    async count(organizationId, consumerKey) {
      return [...state.inbox.values()].filter(
        (record) =>
          record.organizationId === organizationId &&
          (consumerKey === undefined || record.consumerKey === consumerKey),
      ).length;
    },
  };

  return {
    jobs,
    schedules,
    outbox,
    inbox,
    reset() {
      state = newState();
    },
  };
}

/**
 * Write a dead-letter row, or refresh the one that is already there.
 *
 * ONE ROW PER PIECE OF WORK, mirroring the unique key. A second exhaustion of
 * the same job should be impossible — it is already terminal — and a duplicate
 * row would double every count built on this table, which is exactly the
 * measure an operator would be reading to decide whether something is wrong.
 */
function recordDeadLetter(
  state: MemoryState,
  input: Omit<DeadLetterRecord, 'deadLetterId' | 'recoveryState' | 'createdAt'>,
): DeadLetterRecord {
  const key = deadLetterIndexKey(input.organizationId, input.originKind, input.originId);
  const existing = state.deadLetters.get(key);
  const record: DeadLetterRecord = existing
    ? { ...existing, ...input, recoveryState: existing.recoveryState }
    : {
        ...input,
        deadLetterId: nextId(state, 'dlq'),
        recoveryState: 'unrecovered',
        createdAt: input.lastFailedAt,
      };
  state.deadLetters.set(key, record);
  return record;
}
