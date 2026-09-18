/**
 * BP-002 §17.16–§17.19 — scheduling.
 *
 * Four required properties: a one-time schedule materializes once, delayed work
 * waits, a recurring schedule computes its next occurrence, and duplicate or
 * racing ticks do not duplicate an occurrence.
 *
 * The arithmetic is tested directly against `recurrence.ts` as well as through
 * the store, because the phase-preserving and catch-up behaviours are the two
 * that would be easy to get subtly wrong and impossible to notice: a schedule
 * that drifts a little every hour looks fine in a test that runs for one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIN_RECURRENCE_MS,
  createEventDispatcher,
  createMemoryDurableStores,
  createScheduler,
  nextOccurrenceMs,
  occurrenceIdempotencyKey,
} from '../index.ts';
import { ORG, OTHER_ORG, READ_ONLY_DECLARATION, createHarness, createTestClock, serviceActor } from './fixtures.ts';

function scheduleInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    scheduleKey: 'sweep',
    jobType: 'test.read',
    nextRunAt: new Date(Date.UTC(2026, 8, 18, 12, 0, 0)).toISOString(),
    actor: serviceActor(),
    correlationId: 'corr-sched',
    ...overrides,
  } as Parameters<ReturnType<typeof createMemoryDurableStores>['schedules']['upsert']>[0];
}

describe('§17.16 — a one-time schedule materializes exactly once', () => {
  it('produces one job and then completes', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.schedules.upsert(scheduleInput(), clock.nowIso());

    const first = await stores.schedules.materializeDue(ORG, clock.nowIso(), 10);
    assert.equal(first.length, 1);
    assert.equal(first[0].created, true);

    // A later tick finds nothing, because the schedule is no longer active.
    clock.advance(3_600_000);
    assert.equal((await stores.schedules.materializeDue(ORG, clock.nowIso(), 10)).length, 0);
    assert.equal((await stores.jobs.list({ organizationId: ORG })).length, 1);

    const schedule = await stores.schedules.byKey(ORG, 'sweep');
    assert.equal(schedule?.status, 'completed');
    assert.equal(schedule?.lastOccurrenceAt, scheduleInput().nextRunAt);
  });
});

describe('§17.17 — delayed work waits until it is due', () => {
  it('materializes nothing before the scheduled instant', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.schedules.upsert(
      scheduleInput({ nextRunAt: new Date(clock.nowMs() + 600_000).toISOString() }),
      clock.nowIso(),
    );

    assert.equal((await stores.schedules.materializeDue(ORG, clock.nowIso(), 10)).length, 0);
    clock.advance(600_000);
    assert.equal((await stores.schedules.materializeDue(ORG, clock.nowIso(), 10)).length, 1);
  });

  it('enqueues the job at the OCCURRENCE time, not at the tick time', async () => {
    // So a tick that runs late does not make the work look as though it was
    // always meant to run late.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const due = new Date(clock.nowMs() - 120_000).toISOString();
    await stores.schedules.upsert(scheduleInput({ nextRunAt: due }), clock.nowIso());

    await stores.schedules.materializeDue(ORG, clock.nowIso(), 10);
    const job = (await stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(job.availableAt, due);
  });
});

describe('§17.18 — a recurring schedule computes its next occurrence', () => {
  it('advances by the interval and keeps its phase', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const start = clock.nowMs();
    await stores.schedules.upsert(
      scheduleInput({ recurrenceIntervalMs: 300_000 }),
      clock.nowIso(),
    );

    await stores.schedules.materializeDue(ORG, clock.nowIso(), 10);
    let schedule = await stores.schedules.byKey(ORG, 'sweep');
    assert.equal(schedule?.status, 'active');
    assert.equal(Date.parse(schedule?.nextRunAt ?? ''), start + 300_000);

    // A tick that runs LATE must not push the phase.
    clock.set(start + 300_000 + 47_000);
    await stores.schedules.materializeDue(ORG, clock.nowIso(), 10);
    schedule = await stores.schedules.byKey(ORG, 'sweep');
    assert.equal(
      Date.parse(schedule?.nextRunAt ?? ''),
      start + 600_000,
      'a late tick must not move every future occurrence by how late it was',
    );
  });

  it('produces ONE catch-up occurrence after a long outage, not a day of them', () => {
    const start = Date.UTC(2026, 8, 18, 0, 0, 0);
    const hourly = 3_600_000;
    // Twenty-four hours later. The naive loop would emit twenty-four
    // occurrences; the platform returns and is immediately buried.
    const next = nextOccurrenceMs(start, hourly, start + 24 * hourly + 1);
    assert.equal(next, start + 25 * hourly);
  });

  it('refuses an interval below the floor rather than defaulting to one', () => {
    // A schedule that silently acquired an interval nobody asked for would fire
    // work nobody scheduled.
    assert.equal(nextOccurrenceMs(0, MIN_RECURRENCE_MS - 1, 0), undefined);
    assert.equal(nextOccurrenceMs(0, Number.NaN, 0), undefined);
    assert.equal(nextOccurrenceMs(0, undefined, 0), undefined, 'no interval means one-time');
  });
});

describe('§17.19 — duplicate and racing ticks do not duplicate an occurrence', () => {
  it('produces one job when the same tick runs twice', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.schedules.upsert(
      scheduleInput({ recurrenceIntervalMs: 300_000 }),
      clock.nowIso(),
    );

    const a = await stores.schedules.materializeDue(ORG, clock.nowIso(), 10);
    const b = await stores.schedules.materializeDue(ORG, clock.nowIso(), 10);

    assert.equal(a.length, 1);
    assert.equal(b.length, 0, 'the schedule has already advanced past this occurrence');
    assert.equal((await stores.jobs.list({ organizationId: ORG })).length, 1);
  });

  it('produces one job when two ticks race', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.schedules.upsert(
      scheduleInput({ recurrenceIntervalMs: 300_000 }),
      clock.nowIso(),
    );

    const [a, b] = await Promise.all([
      stores.schedules.materializeDue(ORG, clock.nowIso(), 10),
      stores.schedules.materializeDue(ORG, clock.nowIso(), 10),
    ]);

    const created = [...a, ...b].filter((occurrence) => occurrence.created);
    assert.equal(created.length, 1, 'exactly one tick may own an occurrence');
    assert.equal((await stores.jobs.list({ organizationId: ORG })).length, 1);
  });

  it('would still be safe if the compare-and-swap were lost, because the key is unique', async () => {
    // Belt and braces, asserted rather than assumed: enqueueing the occurrence
    // key directly a second time returns the existing job.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const schedule = await stores.schedules.upsert(
      scheduleInput({ recurrenceIntervalMs: 300_000 }),
      clock.nowIso(),
    );
    const [occurrence] = await stores.schedules.materializeDue(ORG, clock.nowIso(), 10);

    const again = await stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.read',
        idempotencyKey: occurrenceIdempotencyKey(schedule.scheduleId, occurrence.occurrenceAt),
        correlationId: 'corr-sched',
        actor: serviceActor(),
      },
      clock.nowIso(),
    );
    assert.equal(again.created, false);
    assert.equal(again.job.jobId, occurrence.jobId);
  });
});

describe('the scheduler tick', () => {
  it('recovers, materializes, drains and dispatches, in that order', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    const ran: string[] = [];
    harness.register(READ_ONLY_DECLARATION, async (context) => {
      ran.push(context.job.jobId);
      return { kind: 'succeeded', result: { ok: true } };
    });

    await harness.stores.schedules.upsert(
      scheduleInput({ recurrenceIntervalMs: 300_000 }),
      clock.nowIso(),
    );

    const scheduler = createScheduler({
      stores: harness.stores,
      worker: harness.worker('worker-a'),
      nowIso: () => clock.nowIso(),
      dispatcher: createEventDispatcher({
        outbox: harness.stores.outbox,
        subscribers: [],
        nowIso: () => clock.nowIso(),
        workerId: 'dispatch-a',
      }),
    });

    const tick = await scheduler.tick(ORG);
    assert.equal(tick.occurrences.length, 1);
    assert.equal(tick.jobs.length, 1);
    assert.equal(tick.jobs[0].outcome, 'succeeded');
    assert.equal(ran.length, 1, 'the occurrence materialized and ran in the SAME tick');
  });

  it('is safe to run twice, and does nothing the second time', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    harness.register(READ_ONLY_DECLARATION, async () => ({ kind: 'succeeded' }));
    await harness.stores.schedules.upsert(
      scheduleInput({ recurrenceIntervalMs: 300_000 }),
      clock.nowIso(),
    );

    const scheduler = createScheduler({
      stores: harness.stores,
      worker: harness.worker('worker-a'),
      nowIso: () => clock.nowIso(),
    });

    await scheduler.tick(ORG);
    const second = await scheduler.tick(ORG);
    assert.equal(second.occurrences.length, 0);
    assert.equal(second.jobs.length, 0);
  });

  it('materializes nothing for a tenant that has no schedules', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.schedules.upsert(scheduleInput(), clock.nowIso());
    assert.equal((await stores.schedules.materializeDue(OTHER_ORG, clock.nowIso(), 10)).length, 0);
  });
});

describe('a schedule carries its actor onto every occurrence', () => {
  it('gives the job the schedule’s service actor, not a human', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.schedules.upsert(
      scheduleInput({ recurrenceIntervalMs: 300_000 }),
      clock.nowIso(),
    );
    await stores.schedules.materializeDue(ORG, clock.nowIso(), 10);

    const job = (await stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(job.actor.actorType, 'service');
    assert.equal(job.actor.initiatedBy, undefined, 'a recurring sweep was set in motion by nobody');
    assert.equal(job.correlationId, 'corr-sched', 'correlation follows the schedule into the job');
    assert.equal(job.scheduleId !== undefined, true);
  });
});
