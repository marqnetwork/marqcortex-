/**
 * The A1 pilot: workflow approvals that expire on time (BP-002 §14).
 *
 * ── THE GAP THIS CLOSES IS NAMED IN THE CODE IT FIXES ─────────────────────
 *
 * `approvals/workflowApprovalGate.ts` documents `expireIfDue` like this:
 *
 *   "Called when a parked run is advanced or read. Expiry is derived from the
 *    stamp rather than driven by a timer: A SWEEPER THAT HAS TO BE SCHEDULED IS
 *    A SWEEPER THAT IS NOT RUNNING IN THE DEPLOYMENT WHERE IT MATTERS."
 *
 * That was the right call when there was nowhere for a scheduled sweeper to
 * live. Everything it says remains true — expiry is still derived from the
 * stamp, `expireIfDue` is still the only thing that writes an expiry, and a
 * lazy read still expires an approval exactly as it did before. What A1 changes
 * is that there is now a place a sweeper can run that is not a browser, not a
 * session and not one isolate: the durable job foundation this packet builds.
 *
 * Until now, an approval nobody ever looked at again sat `pending` past its
 * deadline forever. The operator queue — `pendingOnly` — showed requests that
 * were already dead, and a run parked on one never reached a terminal answer
 * unless somebody happened to poke it.
 *
 * ── WHY THIS IS THE PILOT AND NOT SOMETHING MORE IMPRESSIVE ───────────────
 *
 * BP-002 §14 asks for the LOWEST-RISK existing internal operation that is
 * meaningful enough to prove durable execution, and forbids inventing a product
 * feature to demonstrate the runtime. This one:
 *
 *   ALREADY EXISTS. `expireIfDue` is called; this calls it on a schedule. No
 *   new capability, no new state, no new vocabulary. If this file were deleted,
 *   the platform would behave exactly as it did before A1.
 *
 *   IS DETERMINISTIC. Expiry is a timestamp comparison. No model, no provider,
 *   no network, no judgement.
 *
 *   HAS NO EXTERNAL EFFECT. No email, no social, no telephony, no payment,
 *   nothing a customer sees. The most that happens is that an operator's queue
 *   stops showing a dead request.
 *
 *   IS IDEMPOTENT TWICE OVER. `expireIfDue` on an already-expired record
 *   returns it unchanged, and the job itself carries an occurrence idempotency
 *   key, so a duplicate tick does the same nothing.
 *
 *   IS CONSEQUENTIAL ENOUGH TO GOVERN. It closes a human decision window. That
 *   is a write to a governance record, which is exactly the class of thing
 *   BP-001 exists to decide about — so the pilot exercises the authority path
 *   for real rather than declaring itself harmless to skip it.
 *
 * ── WHAT IT DOES NOT CHANGE ───────────────────────────────────────────────
 *
 * EXPIRY IS NEVER APPROVAL. The gate's own invariant, untouched: this calls
 * `expireIfDue` and nothing else, and `expireIfDue` can only ever return an
 * `expired` record. There is no path from this file to `decide`.
 *
 * THE OUTCOME IS THE SAME ONE THAT ALREADY HAPPENS. A person deciding an
 * overdue approval today gets `workflow_approval_expired` — the gate expires it
 * first and then refuses. This sweep reaches that same terminal state sooner
 * and without requiring somebody to ask. No run fails that would not have
 * failed, and none fails differently.
 *
 * ── DIRECTION OF DEPENDENCY ───────────────────────────────────────────────
 *
 * This file lives in the AI tree and imports the platform. The platform imports
 * nothing from here and cannot: `platform/durable` may not reach into `ai/**`.
 * That is the relationship BP-002 requires — the existing workflow runtime sits
 * ABOVE the durable foundation and adapts onto it — and it is asserted by the
 * boundary scan rather than left to review.
 */

import {
  DURABLE_FAILURE,
  type DomainEventDraft,
  type JobExecutionContext,
  type JobHandlerDeclaration,
  type JobOutcome,
  type UpsertScheduleInput,
} from '../../../platform/durable/index.ts';
import type { WorkflowApprovalGate } from '../approvals/workflowApprovalGate.ts';
import type { WorkflowApprovalRecord } from '../contracts/approval.ts';

/** The registry key, the schedule key and the event type. Stated once. */
export const APPROVAL_EXPIRY_JOB_TYPE = 'workflow.approval.expiry_sweep';
export const APPROVAL_EXPIRY_SCHEDULE_KEY = 'workflow.approval.expiry_sweep';
export const APPROVAL_EXPIRED_EVENT = 'workflow.approval.expired';

/**
 * The service identity this sweep acts as.
 *
 * A SERVICE, NOT THE PERSON WHOSE APPROVAL IS EXPIRING, and not the person who
 * configured the schedule. BP-001 §11 and BP-002 §11: a background job never
 * inherits a human's authority. The person who requested the approval appears
 * nowhere in this job's actor — they are on the approval record, which is where
 * provenance belongs.
 */
export const APPROVAL_EXPIRY_ACTOR_ID = 'service:workflow.approval.expiry';

/**
 * The permission this sweep must hold.
 *
 * `workflow.approval.expire` rather than `workflow.approval.decide`, and the
 * distinction is the whole safety argument: a job holding the DECIDE permission
 * could approve, and this one must never be able to. The key is narrow by
 * construction, held by nothing else, and granted to this actor alone.
 */
export const APPROVAL_EXPIRY_PERMISSION = 'workflow.approval.expire';

/**
 * What this handler may do, once, in code.
 *
 * THIS IS THE ENVELOPE. See `platform/durable/authority.ts` for why a
 * declaration is the right place for one and a table is not.
 *
 * `reversible: false` is the conservative and correct reading. An expired
 * approval cannot be un-expired — the gate offers no such transition, and
 * `TERMINAL_WORKFLOW_APPROVAL_STATES` includes `expired` — so the platform
 * cannot undo this, which is precisely what `reversible` asks.
 *
 * `consequenceCeiling: 'high'` follows from that. An irreversible write is
 * classified at least `high` by the platform floor, and a ceiling BELOW the
 * level the platform computes is a denial — see `toolAllowListCeiling` in the
 * agent adapter for what happened the one time a ceiling was derived
 * independently and came out too low.
 */
export const APPROVAL_EXPIRY_DECLARATION: JobHandlerDeclaration = {
  jobType: APPROVAL_EXPIRY_JOB_TYPE,
  actionType: 'workflow.approval.expire',
  resourceType: 'workflow.approval',
  requiredPermission: APPROVAL_EXPIRY_PERMISSION,
  requestedEffect: 'write',
  // The record names a run, a node and a reason the definition authored. It
  // carries no business payload — see `contracts/approval.ts`, "NO PAYLOAD,
  // EVER" — so `internal` is the honest classification rather than a convenient
  // one.
  dataClassification: 'internal',
  reversible: false,
  consequenceCeiling: 'high',
  consequential: true,
  maxAttempts: 3,
  retry: { kind: 'exponential', baseMs: 30_000, maxMs: 600_000 },
  leaseTtlMs: 60_000,
};

export interface ApprovalExpirySweepDependencies {
  readonly gate: WorkflowApprovalGate;
  /** Mints the event id. Injected so a test gets deterministic ids. */
  readonly newEventId: () => string;
  /** How many pending approvals one sweep considers. Bounded on purpose. */
  readonly batchSize?: number;
}

export interface ApprovalExpirySweepResult extends Record<string, unknown> {
  readonly examined: number;
  readonly expired: number;
  readonly stillPending: number;
}

/**
 * One sweep.
 *
 * READS THE QUEUE, CALLS `expireIfDue`, COUNTS WHAT CHANGED. The gate decides
 * what is overdue; this decides nothing. A record that comes back still
 * `pending` was not due, and a record that comes back `expired` was — there is
 * no third answer and no place here to produce one.
 */
export function createApprovalExpirySweep(deps: ApprovalExpirySweepDependencies) {
  const batchSize = Math.min(Math.max(1, Math.floor(deps.batchSize ?? 50)), 200);

  return async function sweep(context: JobExecutionContext): Promise<JobOutcome> {
    const organizationId = context.job.organizationId;

    // The gate's own tenant-scoped listing. There is no cross-tenant approval
    // query at this layer, by design — see `WorkflowApprovalQuery` — so a job
    // for one organization cannot see another's requests even if it tried.
    const pending = await deps.gate.pending(organizationId, batchSize);

    const expired: WorkflowApprovalRecord[] = [];
    let stillPending = 0;

    for (const record of pending) {
      // A LONG QUEUE IS A LONG JOB. The lease is extended as the sweep walks,
      // so a tenant with two hundred pending approvals does not have its job
      // recovered out from under it halfway through. A lost lease stops the
      // sweep immediately — continuing would mean writing under a lease another
      // worker now holds.
      if (!(await context.heartbeat())) {
        return {
          kind: 'retry',
          failureCode: DURABLE_FAILURE.leaseLost,
          failureDetail: 'the lease lapsed while sweeping; another worker may own this sweep',
        };
      }

      const settled = await deps.gate.expireIfDue(record);
      if (settled.approvalState === 'expired' && record.approvalState !== 'expired') {
        expired.push(settled);
      } else {
        stillPending += 1;
      }
    }

    const result: ApprovalExpirySweepResult = {
      examined: pending.length,
      expired: expired.length,
      stillPending,
    };

    return {
      kind: 'succeeded',
      result,
      // ONE EVENT PER APPROVAL THAT ACTUALLY EXPIRED, and none at all when
      // nothing did. A sweep that published "I ran and changed nothing" on every
      // tick would put a fact on the log for every minute of every day, which is
      // how an event log becomes something nobody can read.
      events: expired.map((record) =>
        approvalExpiredEvent(record, deps.newEventId(), context),
      ),
    };
  };
}

/**
 * One expired approval, as a domain event.
 *
 * THE PAYLOAD IS IDENTIFIERS AND A STAMP. No reason text, no impact summary, no
 * subject digest — the approval record carries all of those behind its own read
 * scope, and copying them onto an event that every subscriber sees would widen
 * that scope silently. The same judgement `contracts/approval.ts` makes about
 * why an approval carries no payload, applied one layer out.
 *
 * `causationId` is the JOB, not the approval: the job is what caused this event
 * to be stated. The approval is the SUBJECT, and it is `entityId`.
 */
export function approvalExpiredEvent(
  record: WorkflowApprovalRecord,
  eventId: string,
  context: JobExecutionContext,
): DomainEventDraft {
  return {
    eventId,
    eventType: APPROVAL_EXPIRED_EVENT,
    eventVersion: 1,
    occurredAt: context.nowIso,
    actorId: context.job.actor.actorId,
    actorType: context.job.actor.actorType,
    correlationId: context.job.correlationId,
    causationId: context.job.jobId,
    source: 'ai.workflows.approvals',
    entityType: 'workflow.approval',
    entityId: record.workflowApprovalId,
    classification: 'internal',
    payload: {
      workflowApprovalId: record.workflowApprovalId,
      workflowRunId: record.workflowRunId,
      workflowId: record.workflowId,
      nodeId: record.nodeId,
      expiresAt: record.expiresAt,
    },
  };
}

/**
 * The schedule this sweep runs on.
 *
 * ONE MINUTE IS THE PLATFORM FLOOR and this uses five, because an approval
 * window is measured in hours or days — `WORKFLOW_APPROVAL_BOUNDS.expiresAfterMs`
 * — and sweeping twelve times an hour is already far more often than the
 * shortest window needs. A faster schedule would spend claims to discover
 * nothing.
 *
 * NOTHING CALLS THIS ON A TIMER. BP-002 §10 forbids configuring production cron
 * in this packet, so the schedule is a value a later, authorized deployment
 * installs. It is here so that "what would this be scheduled as" is a reviewed
 * artefact rather than a decision somebody makes at deploy time.
 */
export function approvalExpiryScheduleInput(params: {
  readonly organizationId: string;
  readonly correlationId: string;
  readonly nextRunAt: string;
}): UpsertScheduleInput {
  return {
    organizationId: params.organizationId,
    scheduleKey: APPROVAL_EXPIRY_SCHEDULE_KEY,
    jobType: APPROVAL_EXPIRY_JOB_TYPE,
    nextRunAt: params.nextRunAt,
    recurrenceIntervalMs: 300_000,
    actor: {
      actorId: APPROVAL_EXPIRY_ACTOR_ID,
      actorType: 'service',
      organizationId: params.organizationId,
      permissions: [APPROVAL_EXPIRY_PERMISSION],
      // NO `initiatedBy`. A recurring platform sweep was set in motion by
      // nobody, and naming whoever installed the schedule would be recording a
      // person as the cause of work they did not ask for on the day it ran.
    },
    correlationId: params.correlationId,
    input: {},
  };
}
