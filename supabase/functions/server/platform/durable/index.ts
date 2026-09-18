/**
 * The durable runtime surface (BP-002 / A1).
 *
 * THE ONLY WAY IN. Callers import from here, never from a file beside it — the
 * same rule `ai/index.ts` holds for the control plane and `platform/authority/
 * index.ts` holds for the evaluator, for the same reason: a caller that reaches
 * past the surface into `worker.ts` is a caller that can be handed a different
 * worker later without anybody noticing, and the boundary scan in
 * `tests/system/ai_boundary.test.ts` asserts the absence of exactly that shape.
 *
 * ── WHAT IS NOT EXPORTED IS AS DELIBERATE AS WHAT IS ──────────────────────
 *
 * There is no way from here to:
 *
 *   SET A JOB'S STATE BY HAND. `transition` exists for pause, resume and
 *   cancel, and those are the only three a caller may ask for. `succeeded` and
 *   `dead_letter` are outcomes of running work, and a function that could
 *   assert them would make the audit trail a claim rather than a record.
 *
 *   WIDEN AN ENVELOPE. A job's authority comes from its handler declaration,
 *   which is code. There is no runtime path that grants a job more than its
 *   declaration states, and adding one would move the answer to "what may this
 *   job do" out of the reviewed artefact and into the request that asked.
 *
 *   MINT AN EVENT OUTSIDE A SETTLE. An event exists because a handler returned
 *   it alongside an outcome, which is what makes the outbox transactional. An
 *   `emit(event)` here would be a path to publishing a fact without the state
 *   change it describes — the exact failure the outbox pattern exists to
 *   prevent.
 *
 *   BYPASS THE INBOX. `createIdempotentConsumer` is the only consumer
 *   constructor, and it claims before it handles.
 *
 * ── WHAT THIS FOLDER IMPORTS, AND WHAT IT NEVER WILL ──────────────────────
 *
 * It imports `../authority/index.ts` and nothing else outside itself. Not
 * `ai/**`, not the repositories, not the storage layer, not a Supabase client
 * at this level. The dependency points one way — runtimes adapt ONTO this
 * foundation — and a single import of the agent orchestrator would reverse it
 * and make "the platform provides durability for the AI subsystem" and "the AI
 * subsystem contains the durability" the same statement.
 */

export {
  DEFAULT_JOB_RETRY_POLICY,
  DURABLE_FAILURE,
  DurableRuntimeError,
  EVENT_BOUNDS,
  EVENT_DISPATCH_STATES,
  JOB_ACTOR_TYPES,
  JOB_RETRY_BOUNDS,
  JOB_STATES,
  SCHEDULE_STATUSES,
  TERMINAL_JOB_STATES,
  type BackoffKind,
  type ConsumeOutcome,
  type ConsumeResult,
  type DeadLetterOrigin,
  type DeadLetterRecord,
  type DeadLetterRecovery,
  type DomainEventDraft,
  type DomainEventRecord,
  type DurableFailureCode,
  type DurableJob,
  type DurableSchedule,
  type EnqueueJobInput,
  type EnqueueResult,
  type EventDispatchState,
  type InboxRecord,
  type InboxStatus,
  type JobActorContext,
  type JobExecutionContext,
  type JobHandler,
  type JobHandlerDeclaration,
  type JobLease,
  type JobOutcome,
  type JobOutcomeKind,
  type JobRetryPolicy,
  type JobState,
  type RegisteredJobHandler,
  type ScheduleOccurrence,
  type ScheduleStatus,
  type UpsertScheduleInput,
} from './contracts.ts';

export {
  assertEventDraft,
  assertHandlerDeclaration,
  assertJobActor,
  instantMs,
  isIsoInstant,
  isJobState,
  isSafeIdentifier,
  normalizeLeaseTtlMs,
  normalizeMaxAttempts,
  normalizeRetryPolicy,
} from './guards.ts';

export { attemptsExhausted, computeBackoffMs, nextAvailableAt } from './retry.ts';

export {
  compareClaimOrder,
  holdsLiveLease,
  isClaimable,
  isLeaseExpired,
  isStaleLease,
  leaseFor,
} from './lease.ts';

export {
  MAX_RECURRENCE_MS,
  MIN_RECURRENCE_MS,
  RECURRENCE_BOUNDS,
  nextOccurrenceAt,
  nextOccurrenceMs,
  occurrenceIdempotencyKey,
} from './recurrence.ts';

export {
  boundedLimit,
  createMemoryDurableStores,
  eventRecordFrom,
  type DeadLetterQuery,
  type DurableJobStore,
  type DurableStores,
  type EventQuery,
  type InboxStore,
  type JobQuery,
  type JobSettlement,
  type LeaseRecoveryResult,
  type OutboxStore,
  type ScheduleStore,
} from './ports.ts';

export { createJobHandlerRegistry, type JobHandlerRegistry } from './registry.ts';

export {
  evaluateJobAuthority,
  jobActionRequest,
  jobActorContext,
  jobAuthorityEnvelope,
  jobAuthorityInput,
  jobConsequence,
} from './authority.ts';

export {
  createJobWorker,
  type DurableAuditEntry,
  type DurableAuditSink,
  type DurablePolicySource,
  type JobPassResult,
  type JobWorker,
  type JobWorkerDependencies,
} from './worker.ts';

export {
  createScheduler,
  type Scheduler,
  type SchedulerDependencies,
  type SchedulerTickResult,
} from './scheduler.ts';

export {
  createEventDispatcher,
  type DispatchPassResult,
  type EventDispatcher,
  type EventDispatcherDependencies,
  type EventSubscriber,
} from './dispatcher.ts';

export {
  createIdempotentConsumer,
  type EventHandler,
  type IdempotentConsumer,
  type IdempotentConsumerDependencies,
} from './consumer.ts';

export {
  durableRuntimeSnapshot,
  type DurableRuntimeSnapshot,
} from './observability.ts';

export {
  DURABLE_RPC,
  DURABLE_TABLE,
  createPostgresDurableStores,
  settleArguments,
  settleEventsArgument,
  toDeadLetterRecord,
  toDurableJob,
  toEventRecord,
  toInboxRecord,
  toSchedule,
  type DurableSqlGateway,
  type SelectCriteria,
} from './postgresStores.ts';
