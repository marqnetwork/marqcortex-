/**
 * Durable runtime contracts (BP-002 / A1).
 *
 * THE VOCABULARY FOR WORK THAT OUTLIVES THE THING THAT ASKED FOR IT. A browser
 * closes, a session ends, an HTTP request returns, an Edge isolate is evicted,
 * a model call fails. None of those may be the reason a piece of committed work
 * stops existing — and today every one of them is, because the only places
 * running work can live are an isolate's memory and a workflow record that
 * something has to come along and advance.
 *
 * ── THIS IS NOT A SECOND WORKFLOW ENGINE ──────────────────────────────────
 *
 * The distinction is the whole design and it is worth stating precisely. A
 * workflow decides WHAT HAPPENS NEXT: it holds a plan, branches on data,
 * schedules parallel lines, asks for approval at a node. That engine exists, it
 * is `ai/workflows/**`, and nothing here reimplements any of it.
 *
 * A durable job decides NOTHING. It is one opaque unit of work with an owner, a
 * deadline, an attempt budget and a place to wait. `JobHandler` takes a context
 * and returns an outcome; it has no notion of a step, a node, a branch or a
 * plan, and the registry that holds handlers is a map rather than an
 * interpreter. If a handler wants a workflow, it calls the workflow engine —
 * which is the direction the target architecture requires:
 *
 *     Workflow / agent runtime  →  durable job foundation  →  Postgres
 *
 * The moment something in this folder learns what a node is, the packet has
 * built the thing it was told not to.
 *
 * ── WHY THIS FOLDER MAY IMPORT BP-001 AND NOTHING ELSE ────────────────────
 *
 * `platform/authority` imports nothing at all, because its architectural claim
 * is that it is decided FOR the AI subsystem rather than by it, and an import
 * would make that unprovable. This folder's claim is different: it is the layer
 * BETWEEN the runtimes above it and Postgres below it, and BP-002 §11 requires
 * that consequential background work is decided by BP-001 rather than by
 * something new. So it imports `../authority/index.ts` — the published surface,
 * never a file beside it — and imports nothing from `ai/**`. The dependency
 * points one way: the AI subsystem adapts ONTO this foundation, and this
 * foundation never reaches back into it.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 *
 * NO STORE, NO CLIENT, NO CLOCK. Every value in this file is a plain record and
 * every function over them (in `retry.ts`, `lease.ts`, `recurrence.ts`) is
 * total and takes its instant as an argument. The same property the workflow
 * engine's pure modules already have, for the same reason: a rule that needs a
 * database stood up to test is a rule that gets tested once.
 *
 * NO PRIORITY AGEING, TENANT QUOTA OR DEPENDENCY GRAPH. Each is in the target
 * architecture and none is an A1 invariant. They are additive to these shapes.
 */

import type {
  ActorType,
  ConsequenceLevel,
  DataClassification,
  RequestedEffect,
} from '../authority/index.ts';

// ── Job state ───────────────────────────────────────────────────────────────

/**
 * SIX STATES, and the absence of a seventh is the interesting part.
 *
 * There is no `scheduled`, no `delayed` and no `retrying`. All three are
 * `queued` with a future `availableAt`, because all three are the same fact —
 * durable, owned by nobody, not claimable yet — and three names for one fact is
 * three places for a claim predicate to disagree with itself. The reason a job
 * is waiting is in `attempt` and `failureCode`, where a reader can see it,
 * rather than in a state the scheduler has to special-case.
 *
 * `paused` and `cancelled` are genuinely different: paused work is not
 * claimable and will be again; cancelled work is terminal and never will be.
 */
export const JOB_STATES = [
  'queued',
  'leased',
  'succeeded',
  'dead_letter',
  'paused',
  'cancelled',
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** States from which no transition leads anywhere. */
export const TERMINAL_JOB_STATES: ReadonlySet<JobState> = new Set<JobState>([
  'succeeded',
  'dead_letter',
  'cancelled',
]);

/**
 * Actor types a job may act as.
 *
 * `human` IS ABSENT AND ITS ABSENCE IS ENFORCED THREE TIMES — here, by
 * `guards.ts`, and by a CHECK constraint on `durable_jobs`. BP-001 §11: a
 * background job never inherits the authority of the person who started it.
 * A rule that lives in one place is a rule that holds until somebody writes a
 * row from a script.
 */
export const JOB_ACTOR_TYPES: readonly ActorType[] = [
  'service',
  'job',
  'workflow',
  'ai_agent',
  'integration',
] as const;

// ── Retry ───────────────────────────────────────────────────────────────────

export type BackoffKind = 'immediate' | 'fixed' | 'exponential';

/**
 * Deterministic, bounded, and configuration rather than judgement.
 *
 * BP-002 §9 is explicit that retry policy is not a model's decision, and the
 * shape mirrors `ai/workflows/contracts/retry.ts` rather than inventing a
 * second vocabulary for the same idea — the workflow engine's policy is about
 * re-running a NODE and this one is about re-running a JOB, but "how long
 * before the next attempt" should not have two answers with two spellings.
 *
 * NO JITTER. It was considered and rejected: a delay that a reader cannot
 * recompute from the record is a delay they have to trust, and `availableAt`
 * being reproducible from `attempt` and this policy is what makes a stuck queue
 * diagnosable. Jitter matters when thousands of clients retry one endpoint in
 * lockstep; these attempts are already spread by when each job first failed.
 */
export interface JobRetryPolicy {
  readonly kind: BackoffKind;
  /** The first retry's delay, and the base the exponential doubles from. */
  readonly baseMs: number;
  /** The ceiling. An exponential that is not capped is an abandoned job. */
  readonly maxMs: number;
}

export const JOB_RETRY_BOUNDS = {
  baseMs: { min: 0, max: 3_600_000, default: 1_000 },
  maxMs: { min: 0, max: 86_400_000, default: 3_600_000 },
  maxAttempts: { min: 1, max: 50, default: 5 },
  leaseTtlMs: { min: 1_000, max: 3_600_000, default: 60_000 },
} as const;

export const DEFAULT_JOB_RETRY_POLICY: JobRetryPolicy = {
  kind: 'exponential',
  baseMs: JOB_RETRY_BOUNDS.baseMs.default,
  maxMs: JOB_RETRY_BOUNDS.maxMs.default,
};

// ── Actor and authority context ─────────────────────────────────────────────

/**
 * Who the job acts as, carried DURABLY on the job record.
 *
 * On the record rather than reconstructed at execution time, and that is a
 * decision with a reason. A job may be claimed minutes, days or months after it
 * was enqueued, by an isolate that holds none of the context the enqueuer had.
 * Re-deriving the actor then would mean re-reading whatever the enqueuer read —
 * memberships, roles, a definition — and getting whatever those say NOW, which
 * is how a job quietly acquires authority its author never had.
 *
 * `permissions` IS THE JOB'S OWN BOUNDED SET, put here from the handler
 * declaration at enqueue time. It is never a copy of the enqueueing person's
 * permissions. `initiatedBy` records that person, and records nothing else
 * about them: BP-001's `ActorContext` carries exactly the same split, for
 * exactly the same reason.
 */
export interface JobActorContext {
  readonly actorId: string;
  readonly actorType: ActorType;
  readonly organizationId: string;
  /** The job's own permissions. Never the initiator's. */
  readonly permissions: readonly string[];
  /** Provenance. Who set this in motion — and explicitly not whose authority. */
  readonly initiatedBy?: {
    readonly actorId: string;
    readonly actorType: ActorType;
  };
}

/**
 * What a handler declares about the work it does, once, at registration.
 *
 * THIS IS THE JOB'S AUTHORITY ENVELOPE, and deriving it from a declaration is
 * the same call `agentAuthorityAdapter.ts` makes when it derives an agent's
 * envelope from its certified definition. BP-001 §6 says to prefer existing
 * representations over new tables, and a registered handler IS a reviewed,
 * code-resident statement of what this kind of work may do. Adding a table to
 * restate it would create a second answer to "what may this job do", which is
 * the precise failure BP-001 exists to prevent.
 *
 * Tenant-authored envelopes — for actors with no declaration to derive one from
 * — are a later packet and land behind `AuthorityEnvelopeSource` without
 * touching anything here.
 */
export interface JobHandlerDeclaration {
  /** The registry key. Matches `DurableJob.jobType`. */
  readonly jobType: string;
  /** The dotted action key the evaluator matches against scopes. */
  readonly actionType: string;
  readonly resourceType: string;
  /** The permission the job actor must hold. */
  readonly requiredPermission: string;
  readonly requestedEffect: RequestedEffect;
  readonly dataClassification: DataClassification;
  /** Whether the platform can undo what this handler does. */
  readonly reversible: boolean;
  /**
   * The most consequential thing this kind of work may do unattended.
   *
   * A CEILING, NOT A CLASSIFICATION. The level an individual run is judged at
   * is the platform's, computed by `classifyConsequence` from the facts of the
   * request; this bounds it. A handler that declares `low` and whose request
   * classifies `high` is DENIED, which is the direction that refuses.
   */
  readonly consequenceCeiling: ConsequenceLevel;
  /**
   * Whether this handler can cause a consequential effect at all.
   *
   * False means the authority evaluation is skipped — and it is not a
   * convenience. A handler that only reads and returns a count has no
   * consequence to weigh, and forcing an evaluation would put a meaningless
   * ALLOW in the audit trail for every tick of every sweep, which is how an
   * audit trail becomes something nobody reads. Everything that WRITES,
   * DELETES, LEAVES THE PLATFORM OR CHANGES AUTHORITY must declare true, and
   * `guards.ts` refuses a declaration whose effect contradicts this.
   */
  readonly consequential: boolean;
  /** Bounded spend for one execution, micro-USD. Absent means unbounded. */
  readonly maxCostMicroUsd?: number;
  readonly retry?: JobRetryPolicy;
  readonly maxAttempts?: number;
  readonly leaseTtlMs?: number;
}

// ── The job ─────────────────────────────────────────────────────────────────

/**
 * One unit of durable work.
 *
 * `leaseGeneration` is the field worth reading the schema comment about: it is
 * bumped on every claim and never reused, which is what makes a stale worker's
 * settle refusable even when that worker's own name is on the live lease too.
 */
export interface DurableJob {
  readonly jobId: string;
  readonly organizationId: string;
  readonly jobType: string;
  readonly state: JobState;
  readonly priority: number;
  /** Not claimable before this instant. Delay and backoff are both this field. */
  readonly availableAt: string;

  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retry: JobRetryPolicy;

  readonly leaseOwner?: string;
  readonly leaseGeneration: number;
  readonly leaseExpiresAt?: string;
  readonly heartbeatAt?: string;
  readonly leaseTtlMs: number;

  /** Unique per (organization, jobType). The duplicate-work guarantee. */
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly scheduleId?: string;

  readonly actor: JobActorContext;

  readonly input: Readonly<Record<string, unknown>>;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly failureCode?: string;
  readonly failureDetail?: string;

  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

/** What a caller must supply to enqueue. Everything else has a default. */
export interface EnqueueJobInput {
  readonly organizationId: string;
  readonly jobType: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly actor: JobActorContext;
  readonly input?: Readonly<Record<string, unknown>>;
  /** ISO-8601. Absent means "as soon as a worker will take it". */
  readonly availableAt?: string;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly retry?: JobRetryPolicy;
  readonly leaseTtlMs?: number;
  readonly scheduleId?: string;
}

/**
 * What an enqueue produced.
 *
 * `created` false means the idempotency key was already taken and `job` is the
 * one that already exists. NOT AN ERROR, and not something every caller has to
 * remember to catch: enqueueing the same logical work twice is the ordinary
 * consequence of a retried request, and answering it with the existing job is
 * what makes "at least once" delivery safe for the caller to use.
 */
export interface EnqueueResult {
  readonly job: DurableJob;
  readonly created: boolean;
}

// ── The lease a worker holds ────────────────────────────────────────────────

/**
 * Proof that this worker owns this job right now.
 *
 * Passed back on every heartbeat and every settle. A worker cannot fabricate
 * one that outranks the live lease, because the generation only ever comes from
 * a claim.
 */
export interface JobLease {
  readonly jobId: string;
  readonly organizationId: string;
  readonly owner: string;
  readonly generation: number;
  readonly expiresAt: string;
}

// ── Handler ─────────────────────────────────────────────────────────────────

/**
 * What a handler is told, and how it says how it went.
 *
 * `heartbeat` is a function rather than something the runtime does on a timer,
 * because a timer inside an Edge isolate is exactly the thing that does not
 * survive the isolate. Long work calls it; short work never needs to.
 */
export interface JobExecutionContext {
  readonly job: DurableJob;
  readonly lease: JobLease;
  readonly nowIso: string;
  /** Extend the lease. False means it is gone and the handler should stop. */
  heartbeat(): Promise<boolean>;
}

export type JobOutcomeKind = 'succeeded' | 'retry' | 'failed';

/**
 * How a handler ended.
 *
 * `retry` vs `failed` IS THE HANDLER'S JUDGEMENT AND NOTHING ELSE'S. The same
 * split `workflows/runtime/retryPolicy.ts` documents: "could an identical
 * attempt succeed later" is a question only the code that made the attempt can
 * answer, and guessing it from an error message is how a permanent
 * authorization failure gets retried five times.
 *
 * `failed` is terminal and goes straight to dead-letter with attempts
 * remaining. `retry` goes to dead-letter only once the budget is spent.
 */
export type JobOutcome =
  | {
      readonly kind: 'succeeded';
      readonly result?: Readonly<Record<string, unknown>>;
      /** Facts to publish atomically with this result. */
      readonly events?: readonly DomainEventDraft[];
    }
  | {
      readonly kind: 'retry';
      readonly failureCode: string;
      readonly failureDetail?: string;
    }
  | {
      readonly kind: 'failed';
      readonly failureCode: string;
      readonly failureDetail?: string;
      /** Facts to publish atomically with this terminal failure. */
      readonly events?: readonly DomainEventDraft[];
    };

export type JobHandler = (context: JobExecutionContext) => Promise<JobOutcome>;

/** A handler and the declaration that bounds it. Registered as one thing. */
export interface RegisteredJobHandler {
  readonly declaration: JobHandlerDeclaration;
  readonly handle: JobHandler;
}

// ── Schedules ───────────────────────────────────────────────────────────────

export const SCHEDULE_STATUSES = ['active', 'paused', 'completed', 'cancelled'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/**
 * When work becomes due.
 *
 * `recurrenceIntervalMs` absent means one-time — and a delayed job is just a
 * one-time schedule with a future `nextRunAt`, which is why there is no third
 * kind. BP-002 §6.2 explicitly says not to build a cron product unless the
 * repository already has one; it does not, and a deterministic interval is what
 * proves recurrence.
 *
 * `materializeVersion` is the compare-and-swap token. Two scheduler ticks that
 * race both read it, and only one writes — so only one materializes the
 * occurrence, and the loser produces nothing rather than a duplicate.
 */
export interface DurableSchedule {
  readonly scheduleId: string;
  readonly organizationId: string;
  /** Stable name, unique per tenant. Makes "ensure this exists" an upsert. */
  readonly scheduleKey: string;
  readonly jobType: string;
  readonly status: ScheduleStatus;
  readonly nextRunAt: string;
  readonly recurrenceIntervalMs?: number;
  readonly lastRunAt?: string;
  readonly lastOccurrenceAt?: string;
  readonly materializeVersion: number;
  readonly actor: JobActorContext;
  readonly correlationId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertScheduleInput {
  readonly organizationId: string;
  readonly scheduleKey: string;
  readonly jobType: string;
  readonly nextRunAt: string;
  readonly recurrenceIntervalMs?: number;
  readonly actor: JobActorContext;
  readonly correlationId: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

/** One materialization. `created` false means another tick got there first. */
export interface ScheduleOccurrence {
  readonly scheduleId: string;
  readonly jobId: string;
  readonly occurrenceAt: string;
  readonly created: boolean;
}

// ── Domain events ───────────────────────────────────────────────────────────

export const EVENT_DISPATCH_STATES = [
  'pending',
  'dispatching',
  'dispatched',
  'failed',
] as const;
export type EventDispatchState = (typeof EVENT_DISPATCH_STATES)[number];

/**
 * A fact, as a handler states it.
 *
 * THE ID IS MINTED BY THE EMITTER, NOT BY THE STORE, and that is what makes
 * BP-002 §17.22 satisfiable. A settle that is retried re-presents the same
 * draft with the same id; the insert conflicts and does nothing. If the store
 * minted the id, the retry would mint a second one, and one thing that happened
 * would be two things on the log.
 */
export interface DomainEventDraft {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion?: number;
  readonly occurredAt?: string;
  readonly actorId?: string;
  readonly actorType?: ActorType;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly source?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly classification?: DataClassification;
  /** Bounded. See `EVENT_BOUNDS`. Identifiers and scalars, never documents. */
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly maxAttempts?: number;
}

/** A fact as it is durably recorded. Immutable except for its dispatch state. */
export interface DomainEventRecord {
  readonly eventId: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly actorType: ActorType;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly source: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly classification: DataClassification;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dispatchState: EventDispatchState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly leaseOwner?: string;
  readonly leaseGeneration: number;
  readonly leaseExpiresAt?: string;
  readonly failureCode?: string;
  readonly failureDetail?: string;
  readonly jobId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dispatchedAt?: string;
}

/**
 * The ceilings an event must stay inside.
 *
 * An event log with no ceiling becomes an uncontrolled second copy of every
 * tenant's business data — replicated to every consumer, retained forever. The
 * same judgement `observability/audit.ts` already makes about prompts and
 * completions, and the same one `platform/authority` makes about evidence.
 *
 * SIZED IN SERIALIZED BYTES because that is what the database CHECK measures.
 * Two ceilings that disagree would mean a payload accepted by the runtime and
 * refused by the row, which fails a job for a reason no log line explains.
 */
export const EVENT_BOUNDS = {
  payloadBytes: 16_384,
  eventTypeLength: 200,
  sourceLength: 120,
  entityIdLength: 200,
  payloadKeys: 64,
  maxAttempts: { min: 1, max: 50, default: 5 },
} as const;

// ── Inbox ───────────────────────────────────────────────────────────────────

export type InboxStatus = 'processed' | 'failed';

/**
 * Proof that one consumer has already seen one event.
 *
 * PER CONSUMER, NOT PER EVENT. Two consumers of the same event must each get
 * their one effect; a single "processed" flag on the event would give the
 * second one nothing. The uniqueness that enforces this is
 * `(organizationId, consumerKey, eventId)`, and it is enforced by the database
 * rather than by a read-then-write in the runtime — so the suppression survives
 * two isolates racing on the same delivery, not merely two sequential ones.
 */
export interface InboxRecord {
  readonly inboxId: string;
  readonly organizationId: string;
  readonly consumerKey: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly status: InboxStatus;
  readonly processedAt: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly failureCode?: string;
  readonly failureDetail?: string;
  readonly result?: Readonly<Record<string, unknown>>;
}

/**
 * What a delivery did.
 *
 * `suppressed` is the one that matters: the event had already been processed by
 * this consumer, so the handler was NOT called and no second effect happened.
 * It is reported rather than hidden because "we suppressed 40,000 duplicates
 * today" and "we processed 40,000 events today" are different operational
 * facts, and a consumer that cannot tell them apart cannot tell a healthy
 * at-least-once producer from a broken one.
 */
export type ConsumeOutcome = 'processed' | 'suppressed' | 'failed';

export interface ConsumeResult {
  readonly outcome: ConsumeOutcome;
  readonly record: InboxRecord;
}

// ── Dead letter ─────────────────────────────────────────────────────────────

export type DeadLetterOrigin = 'job' | 'event';
export type DeadLetterRecovery = 'unrecovered' | 'requeued' | 'abandoned';

/**
 * Work that failed for the last time.
 *
 * RECOVERY IS RECORDED, NOT AUTOMATIC. Requeueing exhausted work without a
 * person deciding to is how a permanent failure becomes an infinite one — the
 * same reason `retryPolicy.ts` classifies an authorization failure as never
 * retryable rather than as slow to give up.
 */
export interface DeadLetterRecord {
  readonly deadLetterId: string;
  readonly organizationId: string;
  readonly originKind: DeadLetterOrigin;
  readonly originId: string;
  readonly originType: string;
  readonly attempts: number;
  readonly failureCode: string;
  readonly failureDetail?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly firstFailedAt: string;
  readonly lastFailedAt: string;
  readonly recoveryState: DeadLetterRecovery;
  readonly recoveredAt?: string;
  readonly recoveredJobId?: string;
  readonly createdAt: string;
}

// ── Failures ────────────────────────────────────────────────────────────────

/**
 * Why the runtime refused, as codes rather than prose.
 *
 * The same judgement `AUTHORITY_REASON` documents: "denied" in a log is a
 * sentence somebody has to interpret; `authority.denied` is something a
 * dashboard counts and an alert fires on.
 */
export const DURABLE_FAILURE = {
  handlerMissing: 'handler.missing',
  handlerThrew: 'handler.threw',
  leaseLost: 'lease.lost',
  leaseExpired: 'lease.expired',
  authorityDenied: 'authority.denied',
  authorityApprovalRequired: 'authority.approval_required',
  authorityContextMissing: 'authority.context_missing',
  tenantMismatch: 'tenant.mismatch',
  jobInvalid: 'job.invalid',
  eventInvalid: 'event.invalid',
  eventPayloadTooLarge: 'event.payload_too_large',
  consumerThrew: 'consumer.threw',
  attemptsExhausted: 'attempts.exhausted',
  leaseAbandoned: 'lease_abandoned',
} as const;

export type DurableFailureCode = (typeof DURABLE_FAILURE)[keyof typeof DURABLE_FAILURE];

/** A typed refusal. Carries a code a caller can branch on and text a person reads. */
export class DurableRuntimeError extends Error {
  readonly code: DurableFailureCode | string;
  readonly detail?: string;

  constructor(code: DurableFailureCode | string, message: string, detail?: string) {
    super(message);
    this.name = 'DurableRuntimeError';
    this.code = code;
    this.detail = detail;
  }
}
