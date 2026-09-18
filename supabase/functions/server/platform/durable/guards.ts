/**
 * Bounded, total validation for the durable runtime (BP-002).
 *
 * THE SAME SHAPE AS `platform/authority/guards.ts` AND FOR THE SAME REASON: a
 * fact that cannot be READ cannot be HONOURED. Every function here answers with
 * a boolean or throws a typed refusal; none of them repairs, defaults or
 * guesses. A job whose actor context is unreadable is not run with an empty
 * actor — it is refused, because "we could not tell who this acts as" and "this
 * acts as nobody" are different statements and only one of them is safe.
 *
 * WHY VALIDATION IS AT ENQUEUE AND AGAIN AT EXECUTE. It looks redundant and it
 * is not. A job is written by one isolate and run by another, possibly months
 * later, possibly after a migration, possibly after somebody edited a row.
 * Checking only at enqueue trusts the row; checking only at execute lets a
 * malformed job sit in the queue until it fails in the least convenient place.
 */

import { ACTOR_TYPES, type ActorType } from '../authority/index.ts';
import {
  DURABLE_FAILURE,
  DurableRuntimeError,
  EVENT_BOUNDS,
  JOB_ACTOR_TYPES,
  JOB_RETRY_BOUNDS,
  JOB_STATES,
  type BackoffKind,
  type DomainEventDraft,
  type JobActorContext,
  type JobHandlerDeclaration,
  type JobRetryPolicy,
  type JobState,
} from './contracts.ts';

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Identifiers must be safe to embed in a key, a log line and a SQL argument. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

/**
 * True for an ISO-8601 instant that both matches the shape AND parses.
 *
 * Both halves are needed. `Date.parse` accepts a great deal that is not
 * ISO-8601 and silently reinterprets some of it; the pattern alone accepts
 * `2026-02-31T00:00:00Z`, which parses to a March date. Requiring both means a
 * stamp that reaches a comparison is a stamp that means what it says.
 */
export function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

/** Milliseconds for an instant, or undefined when it cannot be read. */
export function instantMs(value: unknown): number | undefined {
  if (!isIsoInstant(value)) return undefined;
  return Date.parse(value);
}

export function isJobState(value: unknown): value is JobState {
  return typeof value === 'string' && (JOB_STATES as readonly string[]).includes(value);
}

export function isBackoffKind(value: unknown): value is BackoffKind {
  return value === 'immediate' || value === 'fixed' || value === 'exponential';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * A retry policy the runtime can actually honour.
 *
 * CLAMPED RATHER THAN REFUSED, and that is the one place this file repairs
 * instead of refusing. The reason: an out-of-range delay is not ambiguous about
 * intent — somebody wanted to wait a long time — and clamping it to the ceiling
 * does what they meant within what the platform allows. An unreadable ACTOR is
 * ambiguous about intent, which is why that one throws.
 */
export function normalizeRetryPolicy(policy: JobRetryPolicy | undefined): JobRetryPolicy {
  if (!policy || !isBackoffKind(policy.kind)) {
    return {
      kind: 'exponential',
      baseMs: JOB_RETRY_BOUNDS.baseMs.default,
      maxMs: JOB_RETRY_BOUNDS.maxMs.default,
    };
  }
  const baseMs = clamp(policy.baseMs, JOB_RETRY_BOUNDS.baseMs.min, JOB_RETRY_BOUNDS.baseMs.max);
  const maxMs = clamp(policy.maxMs, JOB_RETRY_BOUNDS.maxMs.min, JOB_RETRY_BOUNDS.maxMs.max);
  // A ceiling below the base is not a ceiling. Raising it to the base is the
  // only reading under which both numbers keep meaning something.
  return { kind: policy.kind, baseMs, maxMs: Math.max(baseMs, maxMs) };
}

export function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return JOB_RETRY_BOUNDS.maxAttempts.default;
  return clamp(value, JOB_RETRY_BOUNDS.maxAttempts.min, JOB_RETRY_BOUNDS.maxAttempts.max);
}

export function normalizeLeaseTtlMs(value: number | undefined): number {
  if (value === undefined) return JOB_RETRY_BOUNDS.leaseTtlMs.default;
  return clamp(value, JOB_RETRY_BOUNDS.leaseTtlMs.min, JOB_RETRY_BOUNDS.leaseTtlMs.max);
}

/**
 * The actor a job acts as — or a refusal.
 *
 * THIS IS WHERE `human` DIES. BP-001 §11 and BP-002 §11 both say a background
 * job never inherits the authority of the person who started it, and this is
 * the second of the three places that rule is enforced (the contract's type is
 * the first, the CHECK constraint on `durable_jobs` is the third). Three,
 * because a rule enforced once is a rule that holds until somebody finds the
 * one path that skips it.
 *
 * MISSING CONTEXT THROWS. BP-002 §11: "fail closed if actor/tenant/authority
 * context is unavailable." There is no default actor and there is deliberately
 * no way to ask for one.
 */
export function assertJobActor(actor: unknown, organizationId: string): JobActorContext {
  if (!isRecord(actor)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.authorityContextMissing,
      'This work has no actor and cannot be performed.',
      'actor context is absent or unreadable',
    );
  }
  const { actorId, actorType, permissions } = actor as Record<string, unknown>;

  if (!isSafeIdentifier(actorId)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.authorityContextMissing,
      'This work has no actor and cannot be performed.',
      'actor id is absent or malformed',
    );
  }
  if (typeof actorType !== 'string' || !(JOB_ACTOR_TYPES as readonly string[]).includes(actorType)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.authorityContextMissing,
      'This work has no actor it may perform the work as.',
      // Named explicitly, because `human` reaching here is not a typo — it is
      // somebody trying to give a job a person's authority, and the log should
      // say so rather than say "invalid".
      `actor type ${String(actorType)} may not act as a background job`,
    );
  }
  if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== 'string')) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.authorityContextMissing,
      'This work has no permissions and cannot be performed.',
      'actor permissions are absent or malformed',
    );
  }

  const declaredOrg = (actor as Record<string, unknown>).organizationId;
  if (!isSafeIdentifier(declaredOrg) || declaredOrg !== organizationId) {
    // A cross-tenant actor is refused at the boundary rather than deep in a
    // query. BP-002 §11: cross-tenant claiming and execution are prohibited.
    throw new DurableRuntimeError(
      DURABLE_FAILURE.tenantMismatch,
      'This work belongs to a different organization.',
      `actor organization ${String(declaredOrg)} does not match job organization ${organizationId}`,
    );
  }

  // PROVENANCE IS OPTIONAL AND UNREADABLE PROVENANCE IS DROPPED RATHER THAN
  // REFUSED. It is the one field here that grants nothing: a job materialized
  // by a recurring schedule was set in motion by nobody, and a malformed
  // `initiatedBy` makes the audit trail poorer without making the execution
  // less safe. Every OTHER field in this function throws, because every other
  // field bounds what the job may do.
  const initiatedBy = (actor as Record<string, unknown>).initiatedBy;
  const provenance: JobActorContext['initiatedBy'] =
    isRecord(initiatedBy) &&
    isSafeIdentifier(initiatedBy.actorId) &&
    typeof initiatedBy.actorType === 'string' &&
    (ACTOR_TYPES as readonly string[]).includes(initiatedBy.actorType)
      ? {
          actorId: initiatedBy.actorId,
          actorType: initiatedBy.actorType as ActorType,
        }
      : undefined;

  return {
    actorId,
    actorType: actorType as JobActorContext['actorType'],
    organizationId,
    permissions: permissions as readonly string[],
    ...(provenance === undefined ? {} : { initiatedBy: provenance }),
  };
}

/**
 * A handler declaration that says something coherent — or a refusal.
 *
 * THE ONE RULE WORTH SPELLING OUT: a declaration whose `requestedEffect`
 * changes the world may not declare `consequential: false`. Without this check,
 * the cheapest way to make an authority denial go away would be to edit one
 * boolean in the handler that is being denied — and it would look like
 * configuration rather than like the bypass it is.
 */
export function assertHandlerDeclaration(
  declaration: JobHandlerDeclaration,
): JobHandlerDeclaration {
  if (!isNonEmptyString(declaration.jobType) || !isSafeIdentifier(declaration.jobType)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.jobInvalid,
      'This kind of work is not registered correctly.',
      'job type is absent or malformed',
    );
  }
  if (!isNonEmptyString(declaration.actionType) || !isNonEmptyString(declaration.resourceType)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.jobInvalid,
      'This kind of work is not registered correctly.',
      `handler ${declaration.jobType} declares no action type or resource type`,
    );
  }
  if (!isNonEmptyString(declaration.requiredPermission)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.jobInvalid,
      'This kind of work is not registered correctly.',
      `handler ${declaration.jobType} declares no required permission`,
    );
  }

  const changesTheWorld =
    declaration.requestedEffect === 'write' ||
    declaration.requestedEffect === 'delete' ||
    declaration.requestedEffect === 'external_effect' ||
    declaration.requestedEffect === 'authority_change';

  if (changesTheWorld && declaration.consequential !== true) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.jobInvalid,
      'This kind of work is not registered correctly.',
      `handler ${declaration.jobType} declares effect ${declaration.requestedEffect} ` +
        'but claims to be inconsequential; a handler that changes the world is evaluated',
    );
  }
  return declaration;
}

/**
 * An event draft that stays inside its ceilings — or a refusal.
 *
 * BP-002 §17.24 asks that a malformed or oversized payload FAILS CLOSED, and
 * this is where. It throws rather than truncating: an event whose payload was
 * quietly cut is a fact that is no longer true, published as though it were.
 *
 * SIZE IS MEASURED ON THE SERIALIZED FORM because that is what the database
 * CHECK measures. A ceiling counted in keys or characters would accept payloads
 * the row then refuses, and the job would fail at commit for a reason no log
 * line explains.
 */
export function assertEventDraft(draft: DomainEventDraft): DomainEventDraft {
  if (!isSafeIdentifier(draft.eventId)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.eventInvalid,
      'This event cannot be recorded.',
      'event id is absent or malformed',
    );
  }
  if (
    !isNonEmptyString(draft.eventType) ||
    draft.eventType.length > EVENT_BOUNDS.eventTypeLength
  ) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.eventInvalid,
      'This event cannot be recorded.',
      `event type is absent or longer than ${EVENT_BOUNDS.eventTypeLength} characters`,
    );
  }
  if (draft.eventVersion !== undefined) {
    if (!Number.isInteger(draft.eventVersion) || draft.eventVersion < 1 || draft.eventVersion > 999) {
      throw new DurableRuntimeError(
        DURABLE_FAILURE.eventInvalid,
        'This event cannot be recorded.',
        `event version ${String(draft.eventVersion)} is outside 1..999`,
      );
    }
  }
  if (draft.occurredAt !== undefined && !isIsoInstant(draft.occurredAt)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.eventInvalid,
      'This event cannot be recorded.',
      'occurredAt is not a readable instant',
    );
  }

  const payload = draft.payload ?? {};
  if (!isRecord(payload)) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.eventInvalid,
      'This event cannot be recorded.',
      'payload is not an object',
    );
  }
  if (Object.keys(payload).length > EVENT_BOUNDS.payloadKeys) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.eventPayloadTooLarge,
      'This event carries more detail than the platform records.',
      `payload has more than ${EVENT_BOUNDS.payloadKeys} keys`,
    );
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    // A cycle, a BigInt, a toJSON that throws. All of them mean the same thing
    // for this purpose: the payload cannot be written down.
    throw new DurableRuntimeError(
      DURABLE_FAILURE.eventInvalid,
      'This event cannot be recorded.',
      'payload could not be serialized',
    );
  }
  if (serialized === undefined) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.eventInvalid,
      'This event cannot be recorded.',
      'payload serialized to nothing',
    );
  }
  // Byte length, not character length: the CHECK counts bytes, and one emoji is
  // four of them.
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > EVENT_BOUNDS.payloadBytes) {
    throw new DurableRuntimeError(
      DURABLE_FAILURE.eventPayloadTooLarge,
      'This event carries more detail than the platform records.',
      `payload is ${bytes} bytes, above the ${EVENT_BOUNDS.payloadBytes} byte ceiling`,
    );
  }
  return draft;
}
