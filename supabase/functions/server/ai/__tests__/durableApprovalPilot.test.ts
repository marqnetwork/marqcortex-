/**
 * BP-002 §14 — the A1 pilot, end to end.
 *
 * `durable*.test.ts` under `platform/durable/__tests__` proves the SUBSTRATE
 * against a reference store. This file proves the INTEGRATION: a real workflow
 * approval gate, a real approval store, real approval records, running on the
 * durable job foundation through a real scheduler tick — and it lives in the AI
 * test tree because that is where those are in scope.
 *
 * The same division of labour `agentAuthorityPilot.test.ts` describes for
 * BP-001, for the same reason.
 *
 * ── WHAT THIS FILE IS ACTUALLY CLAIMING ───────────────────────────────────
 *
 * Not that expiry works — `workflowApprovalGate.ts` already had tests for that,
 * and they still pass unchanged. What is new is that expiry HAPPENS WITHOUT
 * ANYBODY ASKING: a durable, tenant-scoped, governed, idempotent, recurring
 * piece of work that survives the isolate that scheduled it. Every assertion
 * below is about that, and the last one is about what did NOT change.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createEventDispatcher,
  createIdempotentConsumer,
  createJobHandlerRegistry,
  createJobWorker,
  createMemoryDurableStores,
  createScheduler,
  type DurableAuditEntry,
} from '../../platform/durable/index.ts';
import { createWorkflowApprovalGate } from '../workflows/approvals/workflowApprovalGate.ts';
import { createMemoryWorkflowApprovalStore } from '../workflows/persistence/ports.ts';
import {
  APPROVAL_EXPIRED_EVENT,
  APPROVAL_EXPIRY_ACTOR_ID,
  APPROVAL_EXPIRY_DECLARATION,
  APPROVAL_EXPIRY_JOB_TYPE,
  APPROVAL_EXPIRY_PERMISSION,
  approvalExpiryScheduleInput,
  createApprovalExpirySweep,
} from '../workflows/durable/approvalExpirySweep.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const START = Date.UTC(2026, 8, 18, 12, 0, 0);

function testClock(startMs = START) {
  let current = startMs;
  return {
    now: () => current,
    isoNow: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function approvalRequest(organizationId: string, runId: string, expiresAfterMs = 3_600_000) {
  return {
    workflowRunId: runId,
    organizationId,
    workflowId: 'wf-1',
    nodeId: 'approve',
    requestedBy: 'user-1',
    reason: 'A person must confirm this step.',
    impactSummary: 'The run continues past the approval node.',
    estimatedAdditionalTokens: 0,
    estimatedAdditionalCostMicroUsd: 0,
    approverRoles: ['org_admin'],
    onRejection: 'fail' as const,
    expiresAfterMs,
    checkpointVersion: 1,
    workflowRunVersion: 1,
  };
}

function buildPilot(clock: ReturnType<typeof testClock>) {
  const approvals = createMemoryWorkflowApprovalStore();
  const gate = createWorkflowApprovalGate({ store: approvals, clock });
  const stores = createMemoryDurableStores();
  const registry = createJobHandlerRegistry();
  const audit: DurableAuditEntry[] = [];

  let eventSeq = 0;
  registry.register(
    APPROVAL_EXPIRY_DECLARATION,
    createApprovalExpirySweep({
      gate,
      newEventId: () => {
        eventSeq += 1;
        return `ev-${String(eventSeq).padStart(4, '0')}`;
      },
    }),
  );

  const worker = createJobWorker({
    store: stores.jobs,
    registry,
    nowIso: () => clock.isoNow(),
    workerId: 'worker-a',
    audit: { record: (entry) => audit.push(entry) },
  });

  const notified: string[] = [];
  const consumer = createIdempotentConsumer({
    inbox: stores.inbox,
    consumerKey: 'test.approval.watcher',
    eventTypes: [APPROVAL_EXPIRED_EVENT],
    handle: async (event) => {
      notified.push(String(event.payload.workflowApprovalId));
      return undefined;
    },
    nowIso: () => clock.isoNow(),
  });

  const dispatcher = createEventDispatcher({
    outbox: stores.outbox,
    subscribers: [consumer],
    nowIso: () => clock.isoNow(),
    workerId: 'dispatch-a',
  });

  const scheduler = createScheduler({
    stores,
    worker,
    dispatcher,
    nowIso: () => clock.isoNow(),
  });

  return { approvals, gate, stores, registry, worker, dispatcher, scheduler, audit, notified, consumer };
}

async function installSchedule(
  pilot: ReturnType<typeof buildPilot>,
  clock: ReturnType<typeof testClock>,
  organizationId = ORG,
) {
  return pilot.stores.schedules.upsert(
    approvalExpiryScheduleInput({
      organizationId,
      correlationId: `sweep:${organizationId}`,
      nextRunAt: clock.isoNow(),
    }),
    clock.isoNow(),
  );
}

describe('the pilot expires an overdue approval without anybody asking', () => {
  it('runs on a schedule, expires the request, and leaves the fresh one alone', async () => {
    const clock = testClock();
    const pilot = buildPilot(clock);

    const overdue = await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    const fresh = await pilot.gate.request(approvalRequest(ORG, 'run-2', 86_400_000));
    assert.equal(overdue.approvalState, 'pending');
    assert.equal(fresh.approvalState, 'pending');

    await installSchedule(pilot, clock);

    // Past the first request's window, inside the second's.
    clock.advance(120_000);
    const tick = await pilot.scheduler.tick(ORG);

    assert.equal(tick.occurrences.length, 1, 'the schedule materialized one occurrence');
    assert.equal(tick.jobs.length, 1);
    assert.equal(tick.jobs[0].outcome, 'succeeded');
    assert.deepEqual(tick.jobs[0].job?.jobType, APPROVAL_EXPIRY_JOB_TYPE);

    assert.equal(
      (await pilot.gate.get(ORG, overdue.workflowApprovalId))?.approvalState,
      'expired',
    );
    assert.equal(
      (await pilot.gate.get(ORG, fresh.workflowApprovalId))?.approvalState,
      'pending',
      'an approval inside its window is untouched',
    );

    // The operator queue no longer shows a dead request — which is the whole
    // user-visible point of the pilot.
    const queue = await pilot.gate.pending(ORG);
    assert.deepEqual(
      queue.map((record) => record.workflowApprovalId),
      [fresh.workflowApprovalId],
    );
  });

  it('never approves anything, whatever happens', async () => {
    // The gate's own invariant, which this pilot must not weaken: there is no
    // path from a sweep to a yes.
    const clock = testClock();
    const pilot = buildPilot(clock);
    const overdue = await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(pilot, clock);

    clock.advance(120_000);
    await pilot.scheduler.tick(ORG);

    const settled = await pilot.gate.get(ORG, overdue.workflowApprovalId);
    assert.notEqual(settled?.approvalState, 'approved');
    assert.equal(settled?.approvalState, 'expired');
    assert.equal(settled?.decidedBy, undefined, 'expiry is not a decision anybody made');
  });
});

describe('the pilot publishes one fact per expiry, and one effect per fact', () => {
  it('emits an event in the same settle as the result, and delivers it once', async () => {
    const clock = testClock();
    const pilot = buildPilot(clock);
    const overdue = await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(pilot, clock);

    clock.advance(120_000);
    await pilot.scheduler.tick(ORG);

    const events = await pilot.stores.outbox.list({ organizationId: ORG });
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, APPROVAL_EXPIRED_EVENT);
    assert.equal(events[0].entityId, overdue.workflowApprovalId);
    assert.equal(events[0].actorId, APPROVAL_EXPIRY_ACTOR_ID);
    assert.equal(events[0].organizationId, ORG);

    // CORRELATION AND CAUSATION, ACROSS THE WHOLE CHAIN: the schedule's
    // correlation reaches the job, the job's reaches the event, and the event's
    // cause is the job that stated it.
    const job = (await pilot.stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(job.correlationId, `sweep:${ORG}`);
    assert.equal(events[0].correlationId, `sweep:${ORG}`);
    assert.equal(events[0].causationId, job.jobId);

    assert.deepEqual(pilot.notified, [overdue.workflowApprovalId]);
    assert.equal(await pilot.stores.inbox.count(ORG, 'test.approval.watcher'), 1);
  });

  it('carries identifiers only — no reason text, no impact summary', async () => {
    // An approval record is read by a wider audience than the run, and its
    // reason and impact are behind the approval's own read scope. Copying them
    // onto an event every subscriber sees would widen that scope silently.
    const clock = testClock();
    const pilot = buildPilot(clock);
    await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(pilot, clock);
    clock.advance(120_000);
    await pilot.scheduler.tick(ORG);

    const [event] = await pilot.stores.outbox.list({ organizationId: ORG });
    const serialized = JSON.stringify(event.payload);
    assert.equal(serialized.includes('A person must confirm'), false);
    assert.equal(serialized.includes('The run continues'), false);
    assert.deepEqual(Object.keys(event.payload).sort(), [
      'expiresAt',
      'nodeId',
      'workflowApprovalId',
      'workflowId',
      'workflowRunId',
    ]);
  });

  it('publishes nothing on a tick where nothing expired', async () => {
    // A sweep that announced "I ran and changed nothing" every five minutes
    // would put a fact on the log for every minute of every day.
    const clock = testClock();
    const pilot = buildPilot(clock);
    await pilot.gate.request(approvalRequest(ORG, 'run-1', 86_400_000));
    await installSchedule(pilot, clock);

    await pilot.scheduler.tick(ORG);
    assert.equal((await pilot.stores.outbox.list({ organizationId: ORG })).length, 0);
  });

  it('does not act twice when the same event is delivered twice', async () => {
    const clock = testClock();
    const pilot = buildPilot(clock);
    await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(pilot, clock);
    clock.advance(120_000);
    await pilot.scheduler.tick(ORG);

    const [event] = await pilot.stores.outbox.list({ organizationId: ORG });
    assert.equal((await pilot.consumer.consume(event)).outcome, 'suppressed');
    assert.equal(pilot.notified.length, 1);
  });
});

describe('the pilot is idempotent, recurring and durable', () => {
  it('does nothing the second time the same occurrence is ticked', async () => {
    const clock = testClock();
    const pilot = buildPilot(clock);
    await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(pilot, clock);
    clock.advance(120_000);

    await pilot.scheduler.tick(ORG);
    const second = await pilot.scheduler.tick(ORG);

    assert.equal(second.occurrences.length, 0);
    assert.equal(second.jobs.length, 0);
    assert.equal((await pilot.stores.outbox.list({ organizationId: ORG })).length, 1);
  });

  it('recurs, and an already-expired record is not re-expired or re-announced', async () => {
    const clock = testClock();
    const pilot = buildPilot(clock);
    await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(pilot, clock);

    clock.advance(120_000);
    await pilot.scheduler.tick(ORG);

    // Five minutes on, the next occurrence is due.
    clock.advance(300_000);
    const next = await pilot.scheduler.tick(ORG);
    assert.equal(next.occurrences.length, 1, 'the schedule recurs');
    assert.equal(next.jobs[0].outcome, 'succeeded');
    assert.equal(
      (await pilot.stores.outbox.list({ organizationId: ORG })).length,
      1,
      'an approval that is already expired produces no second fact',
    );
  });

  it('survives an isolate that died mid-sweep', async () => {
    // The property the whole packet is for. The job is claimed and the worker
    // vanishes; nothing is lost, and the work runs when the lease lapses.
    const clock = testClock();
    const pilot = buildPilot(clock);
    const overdue = await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(pilot, clock);
    clock.advance(120_000);

    await pilot.scheduler.materialize(ORG);
    const claim = await pilot.stores.jobs.claim(
      ORG,
      [APPROVAL_EXPIRY_JOB_TYPE],
      'worker-that-dies',
      60_000,
      clock.isoNow(),
    );
    assert.ok(claim, 'the occurrence was queued and claimable');

    // The isolate is gone. Nothing settles.
    clock.advance(61_000);
    const recovery = await pilot.stores.jobs.recoverExpiredLeases(clock.isoNow(), 10);
    assert.equal(recovery.recovered, 1);

    const rerun = await pilot.worker.runOnce(ORG);
    assert.equal(rerun.outcome, 'succeeded');
    assert.equal(
      (await pilot.gate.get(ORG, overdue.workflowApprovalId))?.approvalState,
      'expired',
      'the work still happened',
    );
  });
});

describe('the pilot is governed and tenant-scoped', () => {
  it('is evaluated by BP-001, as a service actor that is nobody’s deputy', async () => {
    const clock = testClock();
    const pilot = buildPilot(clock);
    await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(pilot, clock);
    clock.advance(120_000);
    await pilot.scheduler.tick(ORG);

    const entry = pilot.audit.at(-1);
    assert.equal(entry?.outcome, 'succeeded');
    assert.equal(entry?.authority?.['authority.decision'], 'ALLOW');
    assert.equal(entry?.authority?.['authority.actorType'], 'service');
    assert.equal(entry?.authority?.['authority.actionType'], 'workflow.approval.expire');

    const job = (await pilot.stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(job.actor.actorType, 'service');
    assert.deepEqual(job.actor.permissions, [APPROVAL_EXPIRY_PERMISSION]);
    assert.equal(
      job.actor.initiatedBy,
      undefined,
      'a recurring sweep is nobody’s deputy — it inherits no person’s authority',
    );
  });

  it('holds a permission that cannot approve anything', () => {
    // The safety argument in one assertion: the sweep's permission is
    // `workflow.approval.expire`, never `...decide`, so a job holding it could
    // not approve even if something tried to make it.
    assert.equal(APPROVAL_EXPIRY_PERMISSION, 'workflow.approval.expire');
    assert.equal(APPROVAL_EXPIRY_DECLARATION.requiredPermission, APPROVAL_EXPIRY_PERMISSION);
    assert.equal(APPROVAL_EXPIRY_DECLARATION.consequential, true);
    assert.equal(APPROVAL_EXPIRY_DECLARATION.reversible, false);
  });

  it('is denied when the schedule’s actor lacks the permission', async () => {
    const clock = testClock();
    const pilot = buildPilot(clock);
    const overdue = await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));

    await pilot.stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: APPROVAL_EXPIRY_JOB_TYPE,
        idempotencyKey: 'manual-1',
        correlationId: 'manual',
        actor: {
          actorId: APPROVAL_EXPIRY_ACTOR_ID,
          actorType: 'service',
          organizationId: ORG,
          permissions: [],
        },
      },
      clock.isoNow(),
    );
    clock.advance(120_000);
    const result = await pilot.worker.runOnce(ORG);

    assert.equal(result.outcome, 'denied');
    assert.equal(
      (await pilot.gate.get(ORG, overdue.workflowApprovalId))?.approvalState,
      'pending',
      'a denied sweep must change nothing',
    );
  });

  it('never reaches another tenant’s approvals', async () => {
    const clock = testClock();
    const pilot = buildPilot(clock);
    const mine = await pilot.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    const theirs = await pilot.gate.request(approvalRequest(OTHER_ORG, 'run-2', 60_000));

    await installSchedule(pilot, clock, ORG);
    clock.advance(120_000);
    await pilot.scheduler.tick(ORG);

    assert.equal((await pilot.gate.get(ORG, mine.workflowApprovalId))?.approvalState, 'expired');
    assert.equal(
      (await pilot.gate.get(OTHER_ORG, theirs.workflowApprovalId))?.approvalState,
      'pending',
      'another tenant’s overdue approval is not this sweep’s to touch',
    );
    assert.equal((await pilot.stores.outbox.list({ organizationId: OTHER_ORG })).length, 0);
  });
});

describe('the pilot changes nothing about how expiry already behaved', () => {
  it('reaches the same terminal state a lazy read reaches', async () => {
    // BP-002 §3 does not permit this packet to change existing behaviour. The
    // sweep gets there sooner; it does not get somewhere else.
    const clockLazy = testClock();
    const lazy = buildPilot(clockLazy);
    const lazyRecord = await lazy.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    clockLazy.advance(120_000);
    const lazilyExpired = await lazy.gate.expireIfDue(lazyRecord);

    const clockSwept = testClock();
    const swept = buildPilot(clockSwept);
    const sweptRecord = await swept.gate.request(approvalRequest(ORG, 'run-1', 60_000));
    await installSchedule(swept, clockSwept);
    clockSwept.advance(120_000);
    await swept.scheduler.tick(ORG);
    const sweptExpired = await swept.gate.get(ORG, sweptRecord.workflowApprovalId);

    assert.equal(lazilyExpired.approvalState, sweptExpired?.approvalState);
    assert.equal(lazilyExpired.failure, sweptExpired?.failure);
  });

  it('holds the lease while it walks a long queue', async () => {
    // A tenant with many pending approvals must not have its sweep recovered
    // out from under it halfway through.
    const clock = testClock();
    const pilot = buildPilot(clock);
    for (let index = 0; index < 20; index += 1) {
      await pilot.gate.request(approvalRequest(ORG, `run-${index}`, 60_000));
    }
    await installSchedule(pilot, clock);
    clock.advance(120_000);

    const tick = await pilot.scheduler.tick(ORG);
    assert.equal(tick.jobs[0].outcome, 'succeeded');
    assert.equal((await pilot.gate.pending(ORG)).length, 0);
    assert.equal((await pilot.stores.outbox.list({ organizationId: ORG, limit: 100 })).length, 20);
  });
});
