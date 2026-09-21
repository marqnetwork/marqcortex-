/**
 * BP-002 §17 — jobs, leases, retry and dead-letter.
 *
 * The packet lists fifteen required properties across these two groups. Each
 * `describe` names the item it discharges so a reviewer can walk §17 against
 * this file without inferring the mapping.
 *
 * Every assertion runs against the in-memory reference store, which is written
 * to refuse exactly what the database refuses — see `ports.ts`. The rules
 * themselves live in `lease.ts` and `retry.ts` as pure functions, and several
 * tests hit those directly: a rule that can be tested without standing up a
 * queue is a rule that gets tested.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DURABLE_FAILURE,
  DurableRuntimeError,
  attemptsExhausted,
  computeBackoffMs,
  compareClaimOrder,
  createMemoryDurableStores,
  holdsLiveLease,
  isClaimable,
  isStaleLease,
  type DurableJob,
  type JobLease,
} from '../index.ts';
import {
  ORG,
  OTHER_ORG,
  READ_ONLY_DECLARATION,
  WRITING_DECLARATION,
  createHarness,
  createTestClock,
  serviceActor,
} from './fixtures.ts';

function enqueueInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    jobType: 'test.read',
    idempotencyKey: 'k1',
    correlationId: 'corr-1',
    actor: serviceActor(),
    ...overrides,
  } as Parameters<ReturnType<typeof createMemoryDurableStores>['jobs']['enqueue']>[0];
}

describe('§17.1 — a queued job that is due can be claimed', () => {
  it('hands the job to the worker that asked, with a lease', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());

    const claim = await stores.jobs.claim(ORG, ['test.read'], 'worker-a', 60_000, clock.nowIso());

    assert.ok(claim, 'a due job should be claimable');
    assert.equal(claim.job.state, 'leased');
    assert.equal(claim.lease.owner, 'worker-a');
    // The claim spends the attempt. Nothing later re-spends it.
    assert.equal(claim.job.attempt, 1);
    assert.equal(claim.lease.generation, 1);
  });
});

describe('§17.2 — a future job cannot be claimed early', () => {
  it('leaves delayed work alone until its time', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const availableAt = new Date(clock.nowMs() + 60_000).toISOString();
    await stores.jobs.enqueue(enqueueInput({ availableAt }), clock.nowIso());

    assert.equal(
      await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso()),
      undefined,
      'delayed work must wait',
    );

    clock.advance(60_001);
    const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(claim, 'once due, the same job is claimable');
  });

  it('refuses a job whose availableAt cannot be read', () => {
    // A corrupt stamp makes the job UNCLAIMABLE rather than immediately
    // claimable — the opposite of the workflow engine's reading of an
    // unreadable retry stamp, and deliberately so. See `lease.ts`.
    const corrupt = {
      organizationId: ORG,
      state: 'queued',
      attempt: 0,
      maxAttempts: 5,
      availableAt: 'not-a-time',
    } as unknown as DurableJob;
    assert.equal(isClaimable(corrupt, ORG, Date.now()), false);
  });
});

describe('§17.3 — only one of two racing workers owns a live lease', () => {
  it('gives the job to exactly one of them', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());

    const [first, second] = await Promise.all([
      stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso()),
      stores.jobs.claim(ORG, undefined, 'worker-b', 60_000, clock.nowIso()),
    ]);

    const winners = [first, second].filter((claim) => claim !== undefined);
    assert.equal(winners.length, 1, 'exactly one worker may hold the job');
  });

  it('refuses the loser even when the loser is the same worker', async () => {
    // THE CASE `leaseGeneration` EXISTS FOR. Worker A claims, stalls, its lease
    // expires, it re-claims — and its FIRST lease must now be worthless even
    // though its own name is on the live one.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());

    const first = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(first);

    clock.advance(61_000);
    await stores.jobs.recoverExpiredLeases(clock.nowIso(), 10);

    const second = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(second);
    assert.equal(second.lease.owner, first.lease.owner, 'same worker, deliberately');
    assert.ok(
      second.lease.generation > first.lease.generation,
      'the generation must move even when the owner does not',
    );

    const job = await stores.jobs.load(ORG, first.job.jobId);
    assert.ok(job);
    assert.equal(holdsLiveLease(job, first.lease, clock.nowMs()), false);
    assert.equal(holdsLiveLease(job, second.lease, clock.nowMs()), true);
    assert.equal(isStaleLease(job, first.lease), true);
  });
});

describe('§17.4 — heartbeat extends only the correct live lease', () => {
  it('extends the live lease and refuses every other', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(claim);

    clock.advance(30_000);
    const extended = await stores.jobs.heartbeat(claim.lease, 60_000, clock.nowIso());
    assert.ok(extended, 'the live owner may extend');
    assert.ok(
      Date.parse(extended.expiresAt) > Date.parse(claim.lease.expiresAt),
      'extending must move the expiry forward',
    );

    const impostor: JobLease = { ...claim.lease, owner: 'worker-b' };
    assert.equal(await stores.jobs.heartbeat(impostor, 60_000, clock.nowIso()), undefined);

    const stale: JobLease = { ...claim.lease, generation: claim.lease.generation - 1 };
    assert.equal(await stores.jobs.heartbeat(stale, 60_000, clock.nowIso()), undefined);
  });

  it('refuses to extend a lease that has already lapsed', async () => {
    // Even before recovery has run. Otherwise the outcome depends on whether
    // the sweep happened to have fired, which is a race dressed up as a policy.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(claim);

    clock.advance(61_000);
    assert.equal(await stores.jobs.heartbeat(claim.lease, 60_000, clock.nowIso()), undefined);
  });
});

describe('§17.5 / §17.8 — a stale owner cannot complete, and cannot overwrite a newer result', () => {
  it('writes nothing at all when the lease has moved on', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());

    const first = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(first);

    clock.advance(61_000);
    await stores.jobs.recoverExpiredLeases(clock.nowIso(), 10);
    const second = await stores.jobs.claim(ORG, undefined, 'worker-b', 60_000, clock.nowIso());
    assert.ok(second);

    // The newer owner finishes first.
    assert.equal(
      await stores.jobs.settle(
        second.lease,
        { disposition: 'succeeded', result: { by: 'worker-b' } },
        clock.nowIso(),
      ),
      true,
    );

    // The stale owner now wakes up and tries to settle, with events.
    const staleSettled = await stores.jobs.settle(
      first.lease,
      {
        disposition: 'succeeded',
        result: { by: 'worker-a' },
        events: [{ eventId: 'ev-stale', eventType: 'test.stale' }],
      },
      clock.nowIso(),
    );

    assert.equal(staleSettled, false, 'a stale settle must be refused');

    const job = await stores.jobs.load(ORG, first.job.jobId);
    assert.deepEqual(job?.result, { by: 'worker-b' }, 'the newer result must survive');
    assert.equal(
      await stores.outbox.load(ORG, 'ev-stale'),
      undefined,
      'a refused settle must publish nothing — the result and the events are one operation',
    );
  });
});

describe('§17.6 — an expired lease can be recovered', () => {
  it('returns abandoned work to the queue without spending an attempt', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput({ maxAttempts: 5 }), clock.nowIso());
    const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(claim);

    clock.advance(61_000);
    const recovery = await stores.jobs.recoverExpiredLeases(clock.nowIso(), 10);
    assert.equal(recovery.recovered, 1);
    assert.equal(recovery.deadLettered, 0);

    const job = await stores.jobs.load(ORG, claim.job.jobId);
    assert.equal(job?.state, 'queued');
    assert.equal(job?.leaseOwner, undefined);
    assert.equal(
      job?.attempt,
      1,
      'recovery must not spend an attempt; the claim that lapsed already did',
    );
  });

  it('dead-letters work abandoned on its last attempt', async () => {
    // Otherwise it becomes a row that is permanently `leased` and permanently
    // unclaimable — lost rather than merely failed.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput({ maxAttempts: 1 }), clock.nowIso());
    const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(claim);

    clock.advance(61_000);
    const recovery = await stores.jobs.recoverExpiredLeases(clock.nowIso(), 10);
    assert.equal(recovery.deadLettered, 1);

    const job = await stores.jobs.load(ORG, claim.job.jobId);
    assert.equal(job?.state, 'dead_letter');
    assert.equal(job?.failureCode, DURABLE_FAILURE.leaseAbandoned);

    const letters = await stores.jobs.deadLetters({ organizationId: ORG });
    assert.equal(letters.length, 1);
    assert.equal(letters[0].originId, claim.job.jobId);
  });
});

describe('§17.7 — a successful job cannot execute again', () => {
  it('is no longer claimable once it has succeeded', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(claim);
    await stores.jobs.settle(claim.lease, { disposition: 'succeeded' }, clock.nowIso());

    clock.advance(600_000);
    assert.equal(
      await stores.jobs.claim(ORG, undefined, 'worker-b', 60_000, clock.nowIso()),
      undefined,
    );
  });
});

describe('§17.8 — cancellation prevents future claim and execution', () => {
  it('makes a queued job unclaimable', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const enqueued = await stores.jobs.enqueue(enqueueInput(), clock.nowIso());

    await stores.jobs.transition(ORG, enqueued.job.jobId, 'cancelled', clock.nowIso());
    assert.equal(
      await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso()),
      undefined,
    );
  });

  it('stops an already-running worker from settling', async () => {
    // BP-002 §8.9: cancellation must not be silently ignored by a stale worker.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(claim);

    await stores.jobs.transition(ORG, claim.job.jobId, 'cancelled', clock.nowIso());

    assert.equal(
      await stores.jobs.settle(claim.lease, { disposition: 'succeeded' }, clock.nowIso()),
      false,
      'a cancelled job may not be completed by the worker that was running it',
    );
    assert.equal((await stores.jobs.load(ORG, claim.job.jobId))?.state, 'cancelled');
  });

  it('refuses to bring a terminal job back', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const job = (await stores.jobs.list({ organizationId: ORG }))[0];
    await stores.jobs.transition(ORG, job.jobId, 'cancelled', clock.nowIso());

    assert.equal(
      await stores.jobs.transition(ORG, job.jobId, 'queued', clock.nowIso()),
      undefined,
      'terminal means terminal',
    );
  });
});

describe('§17.9 — paused work does not execute until it is resumed', () => {
  it('holds the job out of the queue and puts it back', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const job = (await stores.jobs.list({ organizationId: ORG }))[0];

    await stores.jobs.transition(ORG, job.jobId, 'paused', clock.nowIso());
    assert.equal(
      await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso()),
      undefined,
    );

    await stores.jobs.transition(ORG, job.jobId, 'queued', clock.nowIso());
    assert.ok(await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso()));
  });
});

describe('§17.10 — a duplicate idempotency key does not create duplicate work', () => {
  it('returns the job that already exists, and does not report it as created', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const first = await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const second = await stores.jobs.enqueue(enqueueInput(), clock.nowIso());

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.job.jobId, first.job.jobId);
    assert.equal((await stores.jobs.list({ organizationId: ORG })).length, 1);
  });

  it('scopes the key by type, so two handlers may use the same natural key', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput({ jobType: 'test.read' }), clock.nowIso());
    const other = await stores.jobs.enqueue(enqueueInput({ jobType: 'test.write' }), clock.nowIso());
    assert.equal(other.created, true);
  });
});

describe('§17.11 / §17.12 — a retryable failure increments the attempt and waits', () => {
  it('re-queues with a deterministic bounded backoff', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    let calls = 0;
    harness.register(READ_ONLY_DECLARATION, async () => {
      calls += 1;
      return { kind: 'retry', failureCode: 'transient' };
    });

    await harness.stores.jobs.enqueue(
      enqueueInput({ maxAttempts: 4, retry: { kind: 'exponential', baseMs: 1_000, maxMs: 60_000 } }),
      clock.nowIso(),
    );
    const worker = harness.worker('worker-a');

    const first = await worker.runOnce(ORG);
    assert.equal(first.outcome, 'retry');
    assert.equal(calls, 1);

    const job = (await harness.stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(job.state, 'queued');
    assert.equal(job.attempt, 1);
    // Attempt 2 waits `baseMs`. Deterministic, and recomputable by a reader.
    assert.equal(Date.parse(job.availableAt) - clock.nowMs(), 1_000);

    // It is NOT claimable before then, which is what makes the backoff real
    // rather than a number written on a row nobody honours.
    const tooSoon = await worker.runOnce(ORG);
    assert.equal(tooSoon.claimed, false);
    assert.equal(calls, 1);

    clock.advance(1_000);
    const afterBackoff = await worker.runOnce(ORG);
    assert.equal(afterBackoff.claimed, true);
    assert.equal(calls, 2);
  });

  it('doubles, and stops doubling at the ceiling', () => {
    const policy = { kind: 'exponential', baseMs: 1_000, maxMs: 8_000 } as const;
    assert.equal(computeBackoffMs(policy, 2), 1_000);
    assert.equal(computeBackoffMs(policy, 3), 2_000);
    assert.equal(computeBackoffMs(policy, 4), 4_000);
    assert.equal(computeBackoffMs(policy, 5), 8_000);
    assert.equal(computeBackoffMs(policy, 6), 8_000, 'the ceiling holds');
    // An enormous attempt number must not produce Infinity: an Infinity that
    // reached a timestamp would produce a row that can never become due again.
    assert.equal(computeBackoffMs(policy, 100_000), 8_000);
    assert.ok(Number.isFinite(computeBackoffMs({ kind: 'exponential', baseMs: 1, maxMs: 86_400_000 }, 9_999)));
  });

  it('never waits for the first attempt', () => {
    assert.equal(computeBackoffMs({ kind: 'immediate', baseMs: 5_000, maxMs: 9_000 }, 2), 0);
    assert.equal(computeBackoffMs({ kind: 'fixed', baseMs: 5_000, maxMs: 9_000 }, 7), 5_000);
  });
});

describe('§17.13 — attempt history survives a re-claim', () => {
  it('does not reset the count when a worker restarts', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput({ maxAttempts: 5 }), clock.nowIso());

    const first = await stores.jobs.claim(ORG, undefined, 'w1', 60_000, clock.nowIso());
    assert.ok(first);
    await stores.jobs.settle(
      first.lease,
      { disposition: 'retry', failureCode: 'transient', availableAt: clock.nowIso() },
      clock.nowIso(),
    );

    // Simulate the isolate dying and a different one taking over.
    const second = await stores.jobs.claim(ORG, undefined, 'w2', 60_000, clock.nowIso());
    assert.ok(second);
    assert.equal(second.job.attempt, 2, 'the second try is the second attempt, not the first');

    clock.advance(61_000);
    await stores.jobs.recoverExpiredLeases(clock.nowIso(), 10);
    const third = await stores.jobs.claim(ORG, undefined, 'w3', 60_000, clock.nowIso());
    assert.ok(third);
    assert.equal(third.job.attempt, 3);
  });
});

describe('§17.14 / §17.15 — exhaustion reaches dead-letter, and terminal never retries', () => {
  it('moves to dead-letter once the budget is spent', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    harness.register(READ_ONLY_DECLARATION, async () => ({
      kind: 'retry',
      failureCode: 'transient',
    }));

    await harness.stores.jobs.enqueue(
      enqueueInput({ maxAttempts: 2, retry: { kind: 'immediate', baseMs: 0, maxMs: 0 } }),
      clock.nowIso(),
    );
    const worker = harness.worker('worker-a');

    assert.equal((await worker.runOnce(ORG)).outcome, 'retry');
    assert.equal((await worker.runOnce(ORG)).outcome, 'dead_letter');

    const job = (await harness.stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(job.state, 'dead_letter');
    assert.equal(job.attempt, 2);

    const letters = await harness.stores.jobs.deadLetters({ organizationId: ORG });
    assert.equal(letters.length, 1);
    assert.equal(letters[0].attempts, 2);
    assert.equal(letters[0].correlationId, 'corr-1', 'correlation follows the work into failure');

    // And it is not claimable again — exhausted work is not silently retried.
    assert.equal(
      await harness.stores.jobs.claim(ORG, undefined, 'worker-b', 60_000, clock.nowIso()),
      undefined,
    );
  });

  it('dead-letters a handler-declared terminal failure with attempts still left', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    let calls = 0;
    harness.register(READ_ONLY_DECLARATION, async () => {
      calls += 1;
      return { kind: 'failed', failureCode: 'not_permitted' };
    });

    await harness.stores.jobs.enqueue(enqueueInput({ maxAttempts: 5 }), clock.nowIso());
    const result = await harness.worker('worker-a').runOnce(ORG);

    assert.equal(result.outcome, 'dead_letter');
    assert.equal(calls, 1, 'a judgement the handler made is not re-made four more times');
    assert.equal((await harness.stores.jobs.list({ organizationId: ORG }))[0].attempt, 1);
  });

  it('treats a thrown error as retryable, because a throw is not a judgement', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    harness.register(READ_ONLY_DECLARATION, async () => {
      throw new Error('a provider was unreachable');
    });

    await harness.stores.jobs.enqueue(enqueueInput({ maxAttempts: 3 }), clock.nowIso());
    const result = await harness.worker('worker-a').runOnce(ORG);

    assert.equal(result.outcome, 'retry');
    assert.equal(result.failureCode, DURABLE_FAILURE.handlerThrew);
  });

  it('agrees with the exhaustion predicate it uses', () => {
    assert.equal(attemptsExhausted(1, 3), false);
    assert.equal(attemptsExhausted(3, 3), true);
    assert.equal(attemptsExhausted(4, 3), true);
  });
});

describe('claim order is deterministic', () => {
  it('sorts by priority, then due time, then age', () => {
    // §8.10. Without the age tie-break a job can sit behind an endless supply
    // of equals.
    const base = {
      organizationId: ORG,
      state: 'queued' as const,
      attempt: 0,
      maxAttempts: 5,
    };
    const older = {
      ...base,
      jobId: 'b',
      priority: 100,
      availableAt: '2026-09-18T12:00:00.000Z',
      createdAt: '2026-09-18T11:00:00.000Z',
    } as unknown as DurableJob;
    const newer = {
      ...base,
      jobId: 'a',
      priority: 100,
      availableAt: '2026-09-18T12:00:00.000Z',
      createdAt: '2026-09-18T11:30:00.000Z',
    } as unknown as DurableJob;
    const urgent = {
      ...base,
      jobId: 'c',
      priority: 10,
      availableAt: '2026-09-18T12:00:00.000Z',
      createdAt: '2026-09-18T11:59:00.000Z',
    } as unknown as DurableJob;

    assert.deepEqual(
      [newer, older, urgent].sort(compareClaimOrder).map((job) => job.jobId),
      ['c', 'b', 'a'],
    );
  });
});

describe('a handler that nothing registered fails closed', () => {
  it('dead-letters rather than looping against a registry that will not change', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    harness.register(WRITING_DECLARATION, async () => ({ kind: 'succeeded' }));

    await harness.stores.jobs.enqueue(
      enqueueInput({ jobType: 'test.read', maxAttempts: 5 }),
      clock.nowIso(),
    );
    const result = await harness.worker('worker-a').runOnce(ORG, ['test.read']);

    assert.equal(result.outcome, 'dead_letter');
    assert.equal(result.failureCode, DURABLE_FAILURE.handlerMissing);
  });

  it('refuses to register the same job type twice', () => {
    const harness = createHarness();
    harness.register(READ_ONLY_DECLARATION, async () => ({ kind: 'succeeded' }));
    assert.throws(
      () => harness.register(READ_ONLY_DECLARATION, async () => ({ kind: 'succeeded' })),
      (error: unknown) => error instanceof DurableRuntimeError,
    );
  });

  it('refuses a declaration that writes and calls itself inconsequential', () => {
    // The cheapest bypass there could be: one boolean in the handler that is
    // being denied. Refused at registration.
    const harness = createHarness();
    assert.throws(
      () =>
        harness.register(
          { ...WRITING_DECLARATION, consequential: false },
          async () => ({ kind: 'succeeded' }),
        ),
      (error: unknown) =>
        error instanceof DurableRuntimeError && error.code === DURABLE_FAILURE.jobInvalid,
    );
  });
});

describe('another tenant is not visible', () => {
  it('will not load, list or claim across the boundary', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const enqueued = await stores.jobs.enqueue(enqueueInput(), clock.nowIso());

    assert.equal(await stores.jobs.load(OTHER_ORG, enqueued.job.jobId), undefined);
    assert.equal((await stores.jobs.list({ organizationId: OTHER_ORG })).length, 0);
    assert.equal(
      await stores.jobs.claim(OTHER_ORG, undefined, 'worker-a', 60_000, clock.nowIso()),
      undefined,
    );
  });
});

describe('an EXPIRED lease settles nothing, even before recovery has run', () => {
  it('refuses success, retry and dead-letter, and writes no event', async () => {
    // THE DEFECT THIS TEST EXISTS FOR. `durable_job_settle` checked owner and
    // generation but not expiry, so a worker whose lease had lapsed could
    // still settle — and emit events — purely because the recovery sweep had
    // not happened to run yet. Recovery is a sweep on a timer, so "has it run"
    // is a race, and a durability guarantee decided by a race is not one.
    //
    // RECOVERY IS DELIBERATELY NOT RUN in any of these. The point is that the
    // lapsed lease is worthless on its own.
    for (const settlement of [
      { disposition: 'succeeded' as const, result: { by: 'zombie' } },
      {
        disposition: 'retry' as const,
        failureCode: 'transient',
        availableAt: '2026-09-18T13:00:00.000Z',
      },
      { disposition: 'dead_letter' as const, failureCode: 'terminal' },
    ]) {
      const clock = createTestClock();
      const stores = createMemoryDurableStores();
      await stores.jobs.enqueue(enqueueInput({ maxAttempts: 5 }), clock.nowIso());
      const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
      assert.ok(claim);

      clock.advance(61_000);

      const settled = await stores.jobs.settle(
        claim.lease,
        {
          ...settlement,
          ...(settlement.disposition === 'retry'
            ? {}
            : { events: [{ eventId: 'ev-zombie', eventType: 'test.zombie' }] }),
        },
        clock.nowIso(),
      );

      assert.equal(settled, false, `${settlement.disposition} must be refused on a lapsed lease`);

      const job = await stores.jobs.load(ORG, claim.job.jobId);
      assert.equal(job?.state, 'leased', 'the job is still where it was, awaiting recovery');
      assert.equal(job?.result, undefined);
      assert.equal(job?.completedAt, undefined);
      assert.equal(
        await stores.outbox.load(ORG, 'ev-zombie'),
        undefined,
        'a refused settle publishes nothing',
      );
      assert.equal(
        (await stores.jobs.deadLetters({ organizationId: ORG })).length,
        0,
        'and dead-letters nothing',
      );
    }
  });

  it('still refuses after recovery hands the job to somebody else', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput({ maxAttempts: 5 }), clock.nowIso());
    const stale = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(stale);

    clock.advance(61_000);
    await stores.jobs.recoverExpiredLeases(clock.nowIso(), 10);
    const fresh = await stores.jobs.claim(ORG, undefined, 'worker-b', 60_000, clock.nowIso());
    assert.ok(fresh);

    assert.equal(
      await stores.jobs.settle(stale.lease, { disposition: 'succeeded' }, clock.nowIso()),
      false,
    );
    assert.equal(
      await stores.jobs.settle(fresh.lease, { disposition: 'succeeded' }, clock.nowIso()),
      true,
    );
  });
});

describe('the operator transition table, exhaustively', () => {
  async function jobIn(
    stores: ReturnType<typeof createMemoryDurableStores>,
    clock: ReturnType<typeof createTestClock>,
    state: 'queued' | 'paused' | 'leased' | 'succeeded' | 'dead_letter' | 'cancelled',
  ) {
    const enqueued = await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const jobId = enqueued.job.jobId;
    if (state === 'queued') return jobId;
    if (state === 'paused') {
      await stores.jobs.transition(ORG, jobId, 'paused', clock.nowIso());
      return jobId;
    }
    if (state === 'cancelled') {
      await stores.jobs.transition(ORG, jobId, 'cancelled', clock.nowIso());
      return jobId;
    }
    const claim = await stores.jobs.claim(ORG, undefined, 'w', 60_000, clock.nowIso());
    assert.ok(claim);
    if (state === 'leased') return jobId;
    await stores.jobs.settle(
      claim.lease,
      state === 'succeeded'
        ? { disposition: 'succeeded' }
        : { disposition: 'dead_letter', failureCode: 'terminal' },
      clock.nowIso(),
    );
    return jobId;
  }

  // The whole of the state machine an operator may drive. Written out rather
  // than sampled, because the defect was a transition nobody had enumerated:
  // the Postgres adapter could not express cancellation's three source states,
  // so it cancelled unconditionally and a SUCCEEDED job could be cancelled.
  const CASES: readonly [
    'queued' | 'paused' | 'leased' | 'succeeded' | 'dead_letter' | 'cancelled',
    'paused' | 'queued' | 'cancelled',
    boolean,
  ][] = [
    ['queued', 'paused', true],
    ['paused', 'queued', true],
    ['queued', 'cancelled', true],
    ['paused', 'cancelled', true],
    ['leased', 'cancelled', true],
    ['succeeded', 'cancelled', false],
    ['dead_letter', 'cancelled', false],
    ['cancelled', 'cancelled', false],
    ['cancelled', 'queued', false],
    ['succeeded', 'queued', false],
    ['succeeded', 'paused', false],
    ['dead_letter', 'queued', false],
    ['leased', 'paused', false],
    ['leased', 'queued', false],
    ['queued', 'queued', false],
    ['paused', 'paused', false],
  ];

  for (const [from, to, allowed] of CASES) {
    it(`${from} -> ${to} is ${allowed ? 'allowed' : 'refused'}`, async () => {
      const clock = createTestClock();
      const stores = createMemoryDurableStores();
      const jobId = await jobIn(stores, clock, from);
      const moved = await stores.jobs.transition(ORG, jobId, to, clock.nowIso());

      if (allowed) {
        assert.ok(moved, `${from} -> ${to} should be allowed`);
        assert.equal(moved.state, to);
      } else {
        assert.equal(moved, undefined, `${from} -> ${to} should be refused`);
        assert.equal(
          (await stores.jobs.load(ORG, jobId))?.state,
          from,
          'a refused transition leaves the job where it was',
        );
      }
    });
  }

  it('cancelling a LEASED job invalidates the running worker\'s lease', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    const claim = await stores.jobs.claim(ORG, undefined, 'worker-a', 60_000, clock.nowIso());
    assert.ok(claim);

    const cancelled = await stores.jobs.transition(
      ORG,
      claim.job.jobId,
      'cancelled',
      clock.nowIso(),
    );
    assert.equal(cancelled?.state, 'cancelled');
    assert.equal(cancelled?.leaseOwner, undefined);
    assert.equal(
      await stores.jobs.settle(claim.lease, { disposition: 'succeeded' }, clock.nowIso()),
      false,
      'the worker that was running it may not complete it',
    );
  });

  it('refuses a transition from another tenant', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const enqueued = await stores.jobs.enqueue(enqueueInput(), clock.nowIso());
    assert.equal(
      await stores.jobs.transition(OTHER_ORG, enqueued.job.jobId, 'cancelled', clock.nowIso()),
      undefined,
    );
    assert.equal((await stores.jobs.load(ORG, enqueued.job.jobId))?.state, 'queued');
  });
});
