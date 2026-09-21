/**
 * BP-002 §17.20–§17.25 — the domain event envelope, the outbox and the inbox.
 *
 * Six required properties. The one that carries the packet's whole claim is
 * §17.23: the same event delivered twice produces ONE logical effect. It is
 * asserted three ways here — sequentially, concurrently, and across a
 * dispatcher retry where one of two subscribers failed — because a
 * once-only guarantee that only holds for sequential delivery is not one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DURABLE_FAILURE,
  DurableRuntimeError,
  EVENT_BOUNDS,
  assertEventDraft,
  createEventDispatcher,
  createIdempotentConsumer,
  createMemoryDurableStores,
  createScheduler,
  type DomainEventRecord,
} from '../index.ts';
import { ORG, OTHER_ORG, READ_ONLY_DECLARATION, createHarness, createTestClock, serviceActor } from './fixtures.ts';

async function succeedWithEvents(
  harness: ReturnType<typeof createHarness>,
  events: readonly Parameters<typeof assertEventDraft>[0][],
) {
  harness.register(READ_ONLY_DECLARATION, async () => ({
    kind: 'succeeded',
    result: { ok: true },
    events,
  }));
  await harness.stores.jobs.enqueue(
    {
      organizationId: ORG,
      jobType: 'test.read',
      idempotencyKey: 'k1',
      correlationId: 'corr-1',
      causationId: 'cause-1',
      actor: serviceActor(),
    },
    harness.clock.nowIso(),
  );
  return harness.worker('worker-a').runOnce(ORG);
}

/**
 * A consumer that records which events it actually ran on.
 *
 * At module scope rather than inside one `describe`, because the same counter
 * is what several suites below use to prove an effect happened exactly once —
 * and two copies of it would be two definitions of "an effect".
 */
function countingConsumer(
  clock: ReturnType<typeof createTestClock>,
  inbox: ReturnType<typeof createMemoryDurableStores>['inbox'],
) {
  const effects: string[] = [];
  const consumer = createIdempotentConsumer({
    inbox,
    consumerKey: 'counter',
    eventTypes: ['test.happened'],
    handle: async (event) => {
      effects.push(event.eventId);
      return { counted: true };
    },
    nowIso: () => clock.nowIso(),
  });
  return { consumer, effects };
}

describe('§17.20 — the envelope preserves organization, actor, correlation and causation', () => {
  it('carries all four onto the durable event', async () => {
    const harness = createHarness();
    await succeedWithEvents(harness, [
      { eventId: 'ev-1', eventType: 'test.happened', payload: { n: 1 } },
    ]);

    const event = await harness.stores.outbox.load(ORG, 'ev-1');
    assert.ok(event);
    assert.equal(event.organizationId, ORG);
    assert.equal(event.actorId, 'service:test');
    assert.equal(event.actorType, 'service');
    assert.equal(event.correlationId, 'corr-1', 'correlation follows the work');
    const job = (await harness.stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(
      event.causationId,
      job.jobId,
      'an event with no stated cause defaults to the job that emitted it, not to nothing',
    );
    assert.equal(event.eventVersion, 1);
    assert.equal(event.classification, 'internal');
  });

  it('lets an emitter state its own causation when it knows better', async () => {
    const harness = createHarness();
    await succeedWithEvents(harness, [
      { eventId: 'ev-2', eventType: 'test.happened', causationId: 'upstream-event' },
    ]);
    assert.equal((await harness.stores.outbox.load(ORG, 'ev-2'))?.causationId, 'upstream-event');
  });
});

describe('§17.21 — the outbox record is durable with the authoritative transition', () => {
  it('writes the result and the event together', async () => {
    const harness = createHarness();
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);

    const job = (await harness.stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(job.state, 'succeeded');
    assert.deepEqual(job.result, { ok: true });
    assert.ok(await harness.stores.outbox.load(ORG, 'ev-1'));
  });

  it('writes NEITHER when one of the events is malformed', async () => {
    // THE ATOMICITY CLAIM, TESTED. An oversized payload on the second event
    // must not leave the job settled and the first event published.
    const harness = createHarness();
    const huge = { blob: 'x'.repeat(EVENT_BOUNDS.payloadBytes + 100) };
    harness.register(READ_ONLY_DECLARATION, async () => ({
      kind: 'succeeded',
      result: { ok: true },
      events: [
        { eventId: 'ev-good', eventType: 'test.happened' },
        { eventId: 'ev-huge', eventType: 'test.happened', payload: huge },
      ],
    }));
    await harness.stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.read',
        idempotencyKey: 'k1',
        correlationId: 'corr-1',
        actor: serviceActor(),
      },
      harness.clock.nowIso(),
    );

    const result = await harness.worker('worker-a').runOnce(ORG);

    assert.equal(
      await harness.stores.outbox.load(ORG, 'ev-good'),
      undefined,
      'the first event must not survive a settle the second one made impossible',
    );
    const job = (await harness.stores.jobs.list({ organizationId: ORG }))[0];
    assert.notEqual(job.state, 'succeeded', 'the result must not survive either');
    assert.equal(result.outcome, 'retry');
  });
});

describe('§17.22 — a dispatch retry does not mint a new event id', () => {
  it('retries the same id, and dead-letters it under that id', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);

    const broken = {
      consumerKey: 'broken',
      eventTypes: ['test.happened'],
      deliver: async () => {
        throw new Error('downstream is unavailable');
      },
    };
    const dispatcher = createEventDispatcher({
      outbox: harness.stores.outbox,
      subscribers: [broken],
      nowIso: () => clock.nowIso(),
      workerId: 'dispatch-a',
    });

    const seen = new Set<string>();
    for (let round = 0; round < 6; round += 1) {
      const results = await dispatcher.drain(ORG, 10);
      for (const result of results) seen.add(result.eventId);
      clock.advance(3_600_000);
    }

    assert.deepEqual([...seen], ['ev-1'], 'every attempt is the same event');
    assert.equal(
      (await harness.stores.outbox.list({ organizationId: ORG })).length,
      1,
      'no attempt minted a second event',
    );

    // §17.25 — exhausted dispatch reaches the monitored failure path.
    assert.equal((await harness.stores.outbox.load(ORG, 'ev-1'))?.dispatchState, 'failed');
    const letters = await harness.stores.jobs.deadLetters({
      organizationId: ORG,
      originKind: 'event',
    });
    assert.equal(letters.length, 1);
    assert.equal(letters[0].originId, 'ev-1');
    assert.equal(letters[0].failureCode, DURABLE_FAILURE.consumerThrew);
  });
});

describe('§17.23 — the same event delivered twice produces one logical effect', () => {
  it('suppresses a sequential duplicate', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);
    const event = await harness.stores.outbox.load(ORG, 'ev-1');
    assert.ok(event);

    const { consumer, effects } = countingConsumer(clock, harness.stores.inbox);

    assert.equal((await consumer.consume(event)).outcome, 'processed');
    assert.equal((await consumer.consume(event)).outcome, 'suppressed');
    assert.equal((await consumer.consume(event)).outcome, 'suppressed');

    assert.deepEqual(effects, ['ev-1'], 'one effect, three deliveries');
    assert.equal(await harness.stores.inbox.count(ORG, 'counter'), 1, 'one inbox identity');
  });

  it('lets exactly one CONCURRENT delivery own the effect, and tells the others so', async () => {
    // THE CASE A READ-THEN-WRITE LOSES, and the case the previous contract
    // mis-reported. Three deliveries at once: one claims and runs, the other
    // two find a LIVE claim they do not own.
    //
    // They are `in_flight`, not `suppressed`, and the distinction is the whole
    // repair. `suppressed` means "already done, you may report success";
    // `in_flight` means "somebody else is doing it, you accomplished nothing".
    // Folding the second into the first is what let an event be marked
    // dispatched while the consumer holding it was still running.
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);
    const event = await harness.stores.outbox.load(ORG, 'ev-1');
    assert.ok(event);

    const { consumer, effects } = countingConsumer(clock, harness.stores.inbox);
    const outcomes = await Promise.all([
      consumer.consume(event),
      consumer.consume(event),
      consumer.consume(event),
    ]);

    assert.equal(outcomes.filter((o) => o.outcome === 'processed').length, 1);
    assert.equal(outcomes.filter((o) => o.outcome === 'in_flight').length, 2);
    assert.deepEqual(effects, ['ev-1'], 'one effect, three concurrent deliveries');
    assert.equal(await harness.stores.inbox.count(ORG, 'counter'), 1);

    // And once it is settled, a later delivery is genuinely suppressed.
    assert.equal((await consumer.consume(event)).outcome, 'suppressed');
    assert.deepEqual(effects, ['ev-1']);
  });

  it('gives each of two consumers its own one effect', async () => {
    // Idempotency is per consumer. A single `processed` flag on the event would
    // give the second consumer nothing.
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);
    const event = await harness.stores.outbox.load(ORG, 'ev-1');
    assert.ok(event);

    const a = countingConsumer(clock, harness.stores.inbox);
    const b = createIdempotentConsumer({
      inbox: harness.stores.inbox,
      consumerKey: 'other',
      eventTypes: ['*'],
      handle: async () => undefined,
      nowIso: () => clock.nowIso(),
    });

    assert.equal((await a.consumer.consume(event)).outcome, 'processed');
    assert.equal((await b.consume(event)).outcome, 'processed');
    assert.equal(await harness.stores.inbox.count(ORG), 2);
  });

  it('re-runs ONLY the failed subscriber on a dispatcher retry', async () => {
    // THE DEFECT THIS TEST EXISTS FOR, stated plainly: a consumer whose
    // handler threw used to be permanently excluded from every retry. Its
    // `failed` inbox row still conflicted on the unique key, so the next
    // delivery was reported as "already done" — and `deliver()` read that as
    // success, so the dispatcher marked the event delivered while one of its
    // subscribers had never succeeded at all.
    //
    // The previous version of this test asserted only that the HEALTHY
    // consumer did not run twice, which the broken implementation also
    // satisfied. `flakyCalls === 2` is the assertion that fails against it.
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);

    const good = countingConsumer(clock, harness.stores.inbox);
    let flakyCalls = 0;
    let failNext = true;
    const flaky = createIdempotentConsumer({
      inbox: harness.stores.inbox,
      consumerKey: 'flaky',
      eventTypes: ['test.happened'],
      handle: async () => {
        flakyCalls += 1;
        if (failNext) throw new Error('not yet');
        return undefined;
      },
      nowIso: () => clock.nowIso(),
    });

    const dispatcher = createEventDispatcher({
      outbox: harness.stores.outbox,
      subscribers: [good.consumer, flaky],
      nowIso: () => clock.nowIso(),
      workerId: 'dispatch-a',
    });

    const first = await dispatcher.drain(ORG, 10);
    assert.equal(first[0].outcome, 'retry', 'a failed subscriber holds the whole event back');
    assert.deepEqual(good.effects, ['ev-1']);
    assert.equal(flakyCalls, 1);
    assert.equal(
      (await harness.stores.inbox.find(ORG, 'flaky', 'ev-1'))?.status,
      'failed',
      'a thrown handler leaves a RE-CLAIMABLE row, not a terminal one',
    );

    // NO OPERATOR INTERVENTION. The previous test cleared the failed row by
    // hand, which hid the defect: the whole point is that the retry reaches
    // the failed consumer on its own.
    failNext = false;
    clock.advance(3_600_000);
    const second = await dispatcher.drain(ORG, 10);

    assert.equal(second[0].outcome, 'dispatched');
    assert.equal(flakyCalls, 2, 'the failed subscriber MUST be invoked again');
    assert.deepEqual(
      good.effects,
      ['ev-1'],
      'the healthy subscriber must NOT run a second time on the retried event',
    );
    assert.equal((await harness.stores.inbox.find(ORG, 'flaky', 'ev-1'))?.status, 'processed');
    assert.equal((await harness.stores.inbox.find(ORG, 'counter', 'ev-1'))?.status, 'processed');
  });

  it('does not mark an event dispatched while a consumer still holds a live claim', async () => {
    // `in_flight` must reach the dispatcher as a failure to complete. If it
    // were reported as success the event would be marked dispatched while the
    // owner was mid-handler, and a crash there would lose the effect with the
    // event already gone from the backlog.
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);
    const event = await harness.stores.outbox.load(ORG, 'ev-1');
    assert.ok(event);

    // A different owner takes a live claim first and never settles it.
    const taken = await harness.stores.inbox.claim(
      ORG,
      'counter',
      event,
      'another-isolate',
      60_000,
      clock.nowIso(),
    );
    assert.equal(taken.kind, 'claimed');

    const { consumer, effects } = countingConsumer(clock, harness.stores.inbox);
    const dispatcher = createEventDispatcher({
      outbox: harness.stores.outbox,
      subscribers: [consumer],
      nowIso: () => clock.nowIso(),
      workerId: 'dispatch-a',
    });

    const result = await dispatcher.drain(ORG, 10);
    assert.equal(result[0].outcome, 'retry');
    assert.deepEqual(effects, [], 'the handler must not run against somebody else\'s claim');
    assert.notEqual((await harness.stores.outbox.load(ORG, 'ev-1'))?.dispatchState, 'dispatched');
  });

  it('recovers a consumer that died mid-effect, rather than suppressing it forever', async () => {
    // THE OTHER LOST EFFECT. The old table wrote `processed` BEFORE the
    // handler ran, so a process that died in between left a permanent
    // suppression for work that never happened — undetectably, because the
    // ledger said it was fine.
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);
    const event = await harness.stores.outbox.load(ORG, 'ev-1');
    assert.ok(event);

    // A consumer claims and is never heard from again.
    const claimed = await harness.stores.inbox.claim(
      ORG,
      'counter',
      event,
      'isolate-that-dies',
      60_000,
      clock.nowIso(),
    );
    assert.equal(claimed.kind, 'claimed');
    assert.equal((await harness.stores.inbox.find(ORG, 'counter', 'ev-1'))?.status, 'processing');

    clock.advance(61_000);
    assert.equal(await harness.stores.inbox.recoverExpiredClaims(clock.nowIso(), 10), 1);

    const released = await harness.stores.inbox.find(ORG, 'counter', 'ev-1');
    assert.equal(released?.status, 'failed', 'released to failed — NEVER to processed');
    assert.equal(released?.failureCode, DURABLE_FAILURE.consumerAbandoned);

    // And the next delivery actually runs.
    const { consumer, effects } = countingConsumer(clock, harness.stores.inbox);
    assert.equal((await consumer.consume(event)).outcome, 'processed');
    assert.deepEqual(effects, ['ev-1']);
  });

  it('refuses a settle presented under a lapsed claim', async () => {
    // A consumer that stalled past its lease must not be able to mark
    // `processed` — which is terminal — an effect a newer owner is running.
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);
    const event = await harness.stores.outbox.load(ORG, 'ev-1');
    assert.ok(event);

    const first = await harness.stores.inbox.claim(ORG, 'c', event, 'w1', 60_000, clock.nowIso());
    assert.equal(first.kind, 'claimed');
    const staleLease = first.kind === 'claimed' ? first.lease : undefined;
    assert.ok(staleLease);

    clock.advance(61_000);
    await harness.stores.inbox.recoverExpiredClaims(clock.nowIso(), 10);
    const second = await harness.stores.inbox.claim(ORG, 'c', event, 'w2', 60_000, clock.nowIso());
    assert.equal(second.kind, 'claimed');

    assert.equal(
      await harness.stores.inbox.settle(staleLease, 'processed', {}, clock.nowIso()),
      undefined,
      'the lapsed claim settles nothing',
    );
    assert.equal((await harness.stores.inbox.find(ORG, 'c', 'ev-1'))?.status, 'processing');
  });
});

describe('§17.24 — a malformed or oversized payload fails closed', () => {
  it('refuses rather than truncating', () => {
    // Truncation would publish a fact that is no longer true, as though it were.
    assert.throws(
      () =>
        assertEventDraft({
          eventId: 'ev-1',
          eventType: 'test.happened',
          payload: { blob: 'x'.repeat(EVENT_BOUNDS.payloadBytes + 1) },
        }),
      (error: unknown) =>
        error instanceof DurableRuntimeError &&
        error.code === DURABLE_FAILURE.eventPayloadTooLarge,
    );
  });

  it('refuses a payload with too many keys', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i <= EVENT_BOUNDS.payloadKeys; i += 1) wide[`k${i}`] = i;
    assert.throws(
      () => assertEventDraft({ eventId: 'ev', eventType: 't', payload: wide }),
      (error: unknown) => error instanceof DurableRuntimeError,
    );
  });

  it('refuses a payload that cannot be serialized at all', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(
      () => assertEventDraft({ eventId: 'ev', eventType: 't', payload: cyclic }),
      (error: unknown) =>
        error instanceof DurableRuntimeError && error.code === DURABLE_FAILURE.eventInvalid,
    );
  });

  it('refuses a missing id, a missing type and an unreadable stamp', () => {
    const cases = [
      { eventId: '', eventType: 't' },
      { eventId: 'ev', eventType: '' },
      { eventId: 'ev', eventType: 't', occurredAt: 'yesterday' },
      { eventId: 'ev', eventType: 't', eventVersion: 0 },
    ];
    for (const draft of cases) {
      assert.throws(
        () => assertEventDraft(draft as Parameters<typeof assertEventDraft>[0]),
        (error: unknown) => error instanceof DurableRuntimeError,
        `expected ${JSON.stringify(draft)} to be refused`,
      );
    }
  });

  it('measures the ceiling in BYTES, matching the database CHECK', () => {
    // One emoji is four bytes. A ceiling counted in characters would accept a
    // payload the row then refuses, failing the job at commit for a reason no
    // log line explains.
    const emoji = '🙂'.repeat(EVENT_BOUNDS.payloadBytes / 4);
    assert.throws(
      () => assertEventDraft({ eventId: 'ev', eventType: 't', payload: { emoji } }),
      (error: unknown) => error instanceof DurableRuntimeError,
    );
  });
});

describe('a consumer cannot record having processed another tenant’s event', () => {
  it('refuses the cross-tenant claim', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);
    const event = (await harness.stores.outbox.load(ORG, 'ev-1')) as DomainEventRecord;

    await assert.rejects(
      () =>
        harness.stores.inbox.claim(OTHER_ORG, 'counter', event, 'c1', 60_000, clock.nowIso()),
      (error: unknown) =>
        error instanceof DurableRuntimeError && error.code === DURABLE_FAILURE.tenantMismatch,
    );
  });
});

describe('dispatch is leased, so two dispatchers do not both deliver', () => {
  it('lets only the live lease mark an event dispatched', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);

    const claimed = await harness.stores.outbox.claimPending(ORG, 'd1', 30_000, clock.nowIso(), 10);
    assert.equal(claimed.length, 1);

    // A second dispatcher finds nothing pending.
    assert.equal(
      (await harness.stores.outbox.claimPending(ORG, 'd2', 30_000, clock.nowIso(), 10)).length,
      0,
    );
    // And cannot complete the one it does not hold.
    assert.equal(
      await harness.stores.outbox.markDispatched(ORG, 'ev-1', 'd2', 1, clock.nowIso()),
      false,
    );
    assert.equal(
      await harness.stores.outbox.markDispatched(ORG, 'ev-1', 'd1', 1, clock.nowIso()),
      true,
    );
  });
});

describe('the outbox lease is durable: backoff, ownership and recovery', () => {
  async function oneEvent(clock: ReturnType<typeof createTestClock>) {
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [{ eventId: 'ev-1', eventType: 'test.happened' }]);
    return harness;
  }

  it('does not claim an event whose backoff has not elapsed', async () => {
    // THE DEFECT: the adapter selected every `pending` row and never compared
    // `available_at`, so a failed event was immediately re-claimable and the
    // backoff written onto the row was a number nobody honoured — a tight
    // retry loop wearing the word "backoff".
    const clock = createTestClock();
    const harness = await oneEvent(clock);

    const claimed = await harness.stores.outbox.claimPending(ORG, 'd1', 30_000, clock.nowIso(), 10);
    assert.equal(claimed.length, 1);

    const future = new Date(clock.nowMs() + 600_000).toISOString();
    await harness.stores.outbox.markFailed(
      ORG,
      'ev-1',
      'd1',
      claimed[0].leaseGeneration,
      'downstream_unavailable',
      undefined,
      future,
      clock.nowIso(),
    );

    assert.equal(
      (await harness.stores.outbox.claimPending(ORG, 'd1', 30_000, clock.nowIso(), 10)).length,
      0,
      'a failed event must wait out its backoff',
    );

    clock.advance(600_001);
    assert.equal(
      (await harness.stores.outbox.claimPending(ORG, 'd1', 30_000, clock.nowIso(), 10)).length,
      1,
      'and becomes claimable once it elapses',
    );
  });

  it('lets only one of two racing dispatchers hold the lease', async () => {
    const clock = createTestClock();
    const harness = await oneEvent(clock);

    const [a, b] = await Promise.all([
      harness.stores.outbox.claimPending(ORG, 'd1', 30_000, clock.nowIso(), 10),
      harness.stores.outbox.claimPending(ORG, 'd2', 30_000, clock.nowIso(), 10),
    ]);
    assert.equal(a.length + b.length, 1, 'exactly one dispatcher may hold the event');
  });

  it('refuses a stale dispatcher on both markDispatched and markFailed', async () => {
    const clock = createTestClock();
    const harness = await oneEvent(clock);
    const [claimed] = await harness.stores.outbox.claimPending(
      ORG,
      'd1',
      30_000,
      clock.nowIso(),
      10,
    );
    const generation = claimed.leaseGeneration;

    // Wrong owner.
    assert.equal(
      await harness.stores.outbox.markDispatched(ORG, 'ev-1', 'd2', generation, clock.nowIso()),
      false,
    );
    assert.equal(
      await harness.stores.outbox.markFailed(
        ORG, 'ev-1', 'd2', generation, 'x', undefined, clock.nowIso(), clock.nowIso(),
      ),
      undefined,
    );

    // Wrong generation.
    assert.equal(
      await harness.stores.outbox.markDispatched(ORG, 'ev-1', 'd1', generation - 1, clock.nowIso()),
      false,
    );

    // EXPIRED LEASE, before recovery has run. The outcome must not depend on
    // whether a sweep happened to fire.
    clock.advance(31_000);
    assert.equal(
      await harness.stores.outbox.markDispatched(ORG, 'ev-1', 'd1', generation, clock.nowIso()),
      false,
      'an expired dispatch lease completes nothing',
    );
    assert.equal(
      await harness.stores.outbox.markFailed(
        ORG, 'ev-1', 'd1', generation, 'x', undefined, clock.nowIso(), clock.nowIso(),
      ),
      undefined,
    );
  });

  it('recovers an event a dispatcher died holding, rather than stranding it', async () => {
    // Without recovery an event claimed into `dispatching` by a dispatcher
    // that crashed stays there forever: never delivered, never retried, never
    // dead-lettered, and invisible to the backlog measure meant to notice it.
    const clock = createTestClock();
    const harness = await oneEvent(clock);
    await harness.stores.outbox.claimPending(ORG, 'dies', 30_000, clock.nowIso(), 10);
    assert.equal((await harness.stores.outbox.load(ORG, 'ev-1'))?.dispatchState, 'dispatching');

    clock.advance(31_000);
    const recovery = await harness.stores.outbox.recoverExpiredDispatchLeases(clock.nowIso(), 10);
    assert.equal(recovery.recovered, 1);
    assert.equal(recovery.deadLettered, 0);

    const event = await harness.stores.outbox.load(ORG, 'ev-1');
    assert.equal(event?.dispatchState, 'pending');
    assert.equal(event?.leaseOwner, undefined);
    assert.equal(event?.attempt, 1, 'recovery does not spend an attempt');

    // And it can be delivered by somebody else.
    const consumer = countingConsumer(clock, harness.stores.inbox);
    const dispatcher = createEventDispatcher({
      outbox: harness.stores.outbox,
      subscribers: [consumer.consumer],
      nowIso: () => clock.nowIso(),
      workerId: 'd2',
    });
    assert.equal((await dispatcher.drain(ORG, 10))[0].outcome, 'dispatched');
    assert.deepEqual(consumer.effects, ['ev-1']);
  });

  it('dead-letters an event abandoned on its last attempt', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [
      { eventId: 'ev-1', eventType: 'test.happened', maxAttempts: 1 },
    ]);

    await harness.stores.outbox.claimPending(ORG, 'dies', 30_000, clock.nowIso(), 10);
    clock.advance(31_000);
    const recovery = await harness.stores.outbox.recoverExpiredDispatchLeases(clock.nowIso(), 10);

    assert.equal(recovery.deadLettered, 1);
    assert.equal((await harness.stores.outbox.load(ORG, 'ev-1'))?.dispatchState, 'failed');
    const letters = await harness.stores.jobs.deadLetters({
      organizationId: ORG,
      originKind: 'event',
    });
    assert.equal(letters.length, 1);
    assert.equal(letters[0].failureCode, DURABLE_FAILURE.dispatchAbandoned);
  });

  it('settles an exhausted event and its dead-letter row together', async () => {
    // THE ATOMICITY DEFECT. The adapter persisted `dispatch_state = failed`
    // and then, in a SECOND round trip, inserted the dead-letter row. A crash
    // between them left terminal undeliverable work with no monitored record —
    // the exact outcome the dead-letter table exists to prevent.
    const clock = createTestClock();
    const harness = createHarness(clock);
    await succeedWithEvents(harness, [
      { eventId: 'ev-1', eventType: 'test.happened', maxAttempts: 1 },
    ]);

    const [claimed] = await harness.stores.outbox.claimPending(
      ORG,
      'd1',
      30_000,
      clock.nowIso(),
      10,
    );
    const marked = await harness.stores.outbox.markFailed(
      ORG,
      'ev-1',
      'd1',
      claimed.leaseGeneration,
      DURABLE_FAILURE.consumerThrew,
      'downstream refused',
      clock.nowIso(),
      clock.nowIso(),
    );

    assert.equal(marked?.deadLettered, true);
    // Both halves, after one call. Neither exists without the other.
    assert.equal((await harness.stores.outbox.load(ORG, 'ev-1'))?.dispatchState, 'failed');
    const letters = await harness.stores.jobs.deadLetters({
      organizationId: ORG,
      originKind: 'event',
    });
    assert.equal(letters.length, 1);
    assert.equal(letters[0].originId, 'ev-1');
  });

  it('cannot leave an event dispatching forever across a crash and a tick', async () => {
    // The end-to-end statement: a dispatcher dies mid-delivery, the scheduler
    // ticks, and the event is delivered rather than stranded.
    const clock = createTestClock();
    const harness = await oneEvent(clock);

    await harness.stores.outbox.claimPending(ORG, 'dies', 30_000, clock.nowIso(), 10);
    clock.advance(31_000);

    const consumer = countingConsumer(clock, harness.stores.inbox);
    const dispatcher = createEventDispatcher({
      outbox: harness.stores.outbox,
      subscribers: [consumer.consumer],
      nowIso: () => clock.nowIso(),
      workerId: 'd2',
    });
    const scheduler = createScheduler({
      stores: harness.stores,
      worker: harness.worker('w2'),
      dispatcher,
      nowIso: () => clock.nowIso(),
    });

    const tick = await scheduler.tick(ORG);
    assert.equal(tick.dispatchRecovered, 1, 'the tick recovers the abandoned dispatch');
    assert.deepEqual(consumer.effects, ['ev-1'], 'and the fact is delivered');
    assert.equal((await harness.stores.outbox.load(ORG, 'ev-1'))?.dispatchState, 'dispatched');
  });

  it('dispatches an event nobody subscribes to rather than failing it', async () => {
    // A fact with no listener yet is not a defect. Retrying it five times and
    // dead-lettering would fill the monitored failure path with events whose
    // only fault is being early.
    const clock = createTestClock();
    const harness = await oneEvent(clock);
    const dispatcher = createEventDispatcher({
      outbox: harness.stores.outbox,
      subscribers: [],
      nowIso: () => clock.nowIso(),
      workerId: 'd1',
    });
    assert.equal((await dispatcher.drain(ORG, 10))[0].outcome, 'dispatched');
    assert.equal(
      (await harness.stores.jobs.deadLetters({ organizationId: ORG })).length,
      0,
    );
  });
});
