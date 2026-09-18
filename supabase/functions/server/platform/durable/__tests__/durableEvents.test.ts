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
  function countingConsumer(clock: ReturnType<typeof createTestClock>, inbox: ReturnType<typeof createMemoryDurableStores>['inbox']) {
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

  it('suppresses a CONCURRENT duplicate, which is the case a read-then-write loses', async () => {
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
    assert.equal(outcomes.filter((o) => o.outcome === 'suppressed').length, 2);
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

  it('survives a whole-event dispatcher retry when only one subscriber failed', async () => {
    // The property that makes retrying the WHOLE event safe: the subscriber
    // that already succeeded suppresses its duplicate, and only the failed one
    // runs again.
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
    assert.equal(first[0].outcome, 'retry');
    assert.deepEqual(good.effects, ['ev-1']);
    assert.equal(flakyCalls, 1);

    // The failed consumer's inbox row is cleared by an operator; the healthy
    // one's is not. Then the event is retried.
    await harness.stores.inbox.settle(
      ORG,
      'flaky',
      'ev-1',
      'processed',
      {},
      clock.nowIso(),
    );
    failNext = false;
    clock.advance(3_600_000);

    const second = await dispatcher.drain(ORG, 10);
    assert.equal(second[0].outcome, 'dispatched');
    assert.deepEqual(
      good.effects,
      ['ev-1'],
      'the healthy consumer must NOT run a second time on the retried event',
    );
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
      () => harness.stores.inbox.claim(OTHER_ORG, 'counter', event, clock.nowIso()),
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
