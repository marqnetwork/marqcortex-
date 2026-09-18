/**
 * BP-002 §17.26–§17.32 — tenancy, actors and BP-001.
 *
 * Seven required properties, and they are the ones the packet would fail on if
 * any of them were merely nearly true. Each is asserted about BEHAVIOUR — what
 * the runtime does — rather than about a field being present, because "the job
 * carries an actor" and "the job cannot act as the person who queued it" are
 * different claims and only the second one is worth anything.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTHORITY_REASON,
  type PolicyConstraint,
} from '../../authority/index.ts';
import {
  DURABLE_FAILURE,
  DurableRuntimeError,
  assertJobActor,
  createJobWorker,
  createMemoryDurableStores,
  evaluateJobAuthority,
  jobActorContext,
  type DurableJob,
  type JobHandlerDeclaration,
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

async function enqueueWriting(
  harness: ReturnType<typeof createHarness>,
  actor = serviceActor(ORG, ['job.run']),
) {
  await harness.stores.jobs.enqueue(
    {
      organizationId: ORG,
      jobType: 'test.write',
      idempotencyKey: 'k1',
      correlationId: 'corr-1',
      actor,
    },
    harness.clock.nowIso(),
  );
}

describe('§17.26 — a cross-tenant job read or claim is denied', () => {
  it('cannot be read, listed or claimed from another tenant', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const enqueued = await stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.read',
        idempotencyKey: 'k1',
        correlationId: 'corr-1',
        actor: serviceActor(),
      },
      clock.nowIso(),
    );

    assert.equal(await stores.jobs.load(OTHER_ORG, enqueued.job.jobId), undefined);
    assert.equal((await stores.jobs.list({ organizationId: OTHER_ORG })).length, 0);
    assert.equal(
      await stores.jobs.claim(OTHER_ORG, undefined, 'worker-a', 60_000, clock.nowIso()),
      undefined,
    );
    assert.equal(
      await stores.jobs.transition(OTHER_ORG, enqueued.job.jobId, 'cancelled', clock.nowIso()),
      undefined,
      'another tenant may not cancel this work either',
    );
  });

  it('refuses at enqueue when the actor belongs to a different tenant', async () => {
    // The strongest form: a cross-tenant job cannot be WRITTEN DOWN, so there
    // is nothing for a later check to have to catch.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await assert.rejects(
      () =>
        stores.jobs.enqueue(
          {
            organizationId: ORG,
            jobType: 'test.read',
            idempotencyKey: 'k1',
            correlationId: 'corr-1',
            actor: serviceActor(OTHER_ORG),
          },
          clock.nowIso(),
        ),
      (error: unknown) =>
        error instanceof DurableRuntimeError && error.code === DURABLE_FAILURE.tenantMismatch,
    );
  });
});

describe('§17.27 — cross-tenant event and inbox access is denied', () => {
  it('will not read another tenant’s event or its dead letters', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    harness.register(READ_ONLY_DECLARATION, async () => ({
      kind: 'succeeded',
      events: [{ eventId: 'ev-1', eventType: 'test.happened' }],
    }));
    await harness.stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.read',
        idempotencyKey: 'k1',
        correlationId: 'corr-1',
        actor: serviceActor(),
      },
      clock.nowIso(),
    );
    await harness.worker('worker-a').runOnce(ORG);

    assert.equal(await harness.stores.outbox.load(OTHER_ORG, 'ev-1'), undefined);
    assert.equal((await harness.stores.outbox.list({ organizationId: OTHER_ORG })).length, 0);
    assert.equal(
      (await harness.stores.outbox.claimPending(OTHER_ORG, 'd1', 30_000, clock.nowIso(), 10))
        .length,
      0,
    );
    assert.equal(await harness.stores.inbox.count(OTHER_ORG), 0);
    assert.equal(
      (await harness.stores.jobs.deadLetters({ organizationId: OTHER_ORG })).length,
      0,
    );
  });
});

describe('§17.28 — a job actor does not inherit the initiating human’s authority', () => {
  it('refuses to write down a job that acts as a person', async () => {
    // THE RULE, AT THE FIRST OF ITS THREE LAYERS. The other two are the
    // contract's type and the CHECK constraint on `durable_jobs`.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    await assert.rejects(
      () =>
        stores.jobs.enqueue(
          {
            organizationId: ORG,
            jobType: 'test.read',
            idempotencyKey: 'k1',
            correlationId: 'corr-1',
            actor: {
              actorId: 'user-1',
              actorType: 'human',
              organizationId: ORG,
              permissions: ['everything'],
            } as never,
          },
          clock.nowIso(),
        ),
      (error: unknown) =>
        error instanceof DurableRuntimeError &&
        error.code === DURABLE_FAILURE.authorityContextMissing,
    );
  });

  it('keeps the person as provenance, and gives the job only its own permissions', async () => {
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const enqueued = await stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.read',
        idempotencyKey: 'k1',
        correlationId: 'corr-1',
        actor: {
          actorId: 'service:sweep',
          actorType: 'service',
          organizationId: ORG,
          // The job's OWN narrow set, from the handler declaration — not a copy
          // of whatever the person who pressed the button happened to hold.
          permissions: ['job.run'],
          initiatedBy: { actorId: 'user-1', actorType: 'human' },
        },
      },
      clock.nowIso(),
    );

    const actor = jobActorContext(enqueued.job);
    assert.equal(actor.actorType, 'service');
    assert.deepEqual(actor.permissions, ['job.run']);
    assert.deepEqual(actor.roles, [], 'a job holds no roles; roles describe people');
    assert.equal(actor.initiatedBy?.actorId, 'user-1');
    assert.equal(actor.initiatedBy?.actorType, 'human');
  });

  it('gives a human-initiated job no more than a scheduled one', async () => {
    // Two jobs, same handler, one queued by an owner and one by a schedule. The
    // envelope the evaluator sees must be identical.
    const clock = createTestClock();
    const stores = createMemoryDurableStores();
    const byPerson = await stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.write',
        idempotencyKey: 'by-person',
        correlationId: 'c',
        actor: { ...serviceActor(), initiatedBy: { actorId: 'owner', actorType: 'human' } },
      },
      clock.nowIso(),
    );
    const byMachine = await stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.write',
        idempotencyKey: 'by-machine',
        correlationId: 'c',
        actor: serviceActor(),
      },
      clock.nowIso(),
    );

    assert.deepEqual(
      jobActorContext(byPerson.job).permissions,
      jobActorContext(byMachine.job).permissions,
    );
  });
});

describe('§17.29 — missing actor or authority context fails closed', () => {
  it('refuses an absent, malformed or permissionless actor', () => {
    const bad: unknown[] = [
      undefined,
      null,
      {},
      { actorId: 'a', actorType: 'service', organizationId: ORG },
      { actorId: '', actorType: 'service', organizationId: ORG, permissions: [] },
      { actorId: 'a', actorType: 'wizard', organizationId: ORG, permissions: [] },
      { actorId: 'a', actorType: 'service', organizationId: ORG, permissions: 'all' },
      { actorId: 'a', actorType: 'service', permissions: [] },
    ];
    for (const actor of bad) {
      assert.throws(
        () => assertJobActor(actor, ORG),
        (error: unknown) => error instanceof DurableRuntimeError,
        `expected ${JSON.stringify(actor)} to be refused`,
      );
    }
  });

  it('accepts an EMPTY permission list, because empty is a meaningful value', () => {
    // It denies. "This actor holds no permissions" is a fact the evaluator can
    // act on; refusing to record it would be refusing to model the safest actor.
    const actor = assertJobActor(
      { actorId: 'a', actorType: 'service', organizationId: ORG, permissions: [] },
      ORG,
    );
    assert.deepEqual(actor.permissions, []);
  });

  it('drops unreadable provenance without refusing the job', () => {
    // Provenance grants nothing, so a malformed `initiatedBy` makes the audit
    // trail poorer without making the execution less safe. Every OTHER field
    // throws, because every other field bounds what the job may do.
    const actor = assertJobActor(
      {
        actorId: 'a',
        actorType: 'service',
        organizationId: ORG,
        permissions: [],
        initiatedBy: { actorId: 42, actorType: 'human' },
      },
      ORG,
    );
    assert.equal(actor.initiatedBy, undefined);
  });
});

describe('§17.30 — a BP-001 DENY prevents execution', () => {
  it('never calls the handler, and dead-letters with the reason', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    let called = 0;
    harness.register(WRITING_DECLARATION, async () => {
      called += 1;
      return { kind: 'succeeded' };
    });

    // The actor lacks `job.run`, which the declaration requires.
    await enqueueWriting(harness, serviceActor(ORG, ['something.else']));
    const result = await harness.worker('worker-a').runOnce(ORG);

    assert.equal(called, 0, 'a denied job must not run');
    assert.equal(result.outcome, 'denied');
    assert.equal(result.failureCode, DURABLE_FAILURE.authorityDenied);
    assert.equal(result.decision?.decision, 'DENY');
    assert.ok(result.decision?.reasonCodes.includes(AUTHORITY_REASON.permissionMissing));

    const job = (await harness.stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(job.state, 'dead_letter', 'a denial is terminal, not a retry');

    // And the decision is in the audit trail, in the shape the existing writers
    // already accept: `authorityAuditDetail`'s `authority.`-prefixed keys,
    // unchanged and not re-spelled for this runtime.
    const entry = harness.audit.at(-1);
    assert.equal(entry?.outcome, 'denied');
    assert.equal(entry?.authority?.['authority.decision'], 'DENY');
    assert.equal(entry?.authority?.['authority.correlationId'], 'corr-1');
    assert.ok(
      String(entry?.authority?.['authority.reasonCodes']).includes(
        AUTHORITY_REASON.permissionMissing,
      ),
    );
  });

  it('denies work whose declared ceiling is below what the platform classifies', async () => {
    // A handler cannot make its own work look safer by declaring a low ceiling.
    // `classifyConsequence` takes the HIGHER of the platform floor and the
    // subsystem opinion, so understating it produces a denial, not a pass.
    const clock = createTestClock();
    const harness = createHarness(clock);
    const understated: JobHandlerDeclaration = {
      ...WRITING_DECLARATION,
      jobType: 'test.understated',
      requestedEffect: 'external_effect',
      reversible: false,
      consequenceCeiling: 'low',
    };
    let called = 0;
    harness.register(understated, async () => {
      called += 1;
      return { kind: 'succeeded' };
    });

    await harness.stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.understated',
        idempotencyKey: 'k1',
        correlationId: 'corr-1',
        actor: serviceActor(),
      },
      clock.nowIso(),
    );
    const result = await harness.worker('worker-a').runOnce(ORG);

    assert.equal(called, 0);
    assert.equal(result.outcome, 'denied');
    assert.ok(
      result.decision?.reasonCodes.includes(AUTHORITY_REASON.consequenceCeilingExceeded),
    );
  });

  it('denies a job whose actor and resource tenants disagree', () => {
    const job = {
      jobId: 'j1',
      organizationId: OTHER_ORG,
      jobType: 'test.write',
      attempt: 1,
      correlationId: 'c',
      actor: serviceActor(ORG, ['job.run']),
    } as unknown as DurableJob;

    const decision = evaluateJobAuthority({
      job,
      declaration: WRITING_DECLARATION,
      traceId: 't',
      nowIso: new Date().toISOString(),
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.tenantMismatch));
  });
});

describe('§17.31 — REQUIRE_APPROVAL never executes as ALLOW', () => {
  it('does not run the handler, and does not quietly retry until the policy changes', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    let called = 0;
    harness.register(WRITING_DECLARATION, async () => {
      called += 1;
      return { kind: 'succeeded' };
    });

    const requiresApproval: PolicyConstraint = {
      policyId: 'test.requires_approval',
      effect: 'require_approval',
      reason: 'a person must decide',
      actionTypes: ['test.write'],
    };

    await enqueueWriting(harness);
    const worker = createJobWorker({
      store: harness.stores.jobs,
      registry: harness.registry,
      nowIso: () => clock.nowIso(),
      workerId: 'worker-a',
      audit: { record: (entry) => harness.audit.push(entry) },
      policies: { constraints: () => [requiresApproval] },
    });

    const result = await worker.runOnce(ORG);

    assert.equal(called, 0, 'work awaiting a person must not happen');
    assert.equal(result.outcome, 'approval_required');
    assert.equal(result.failureCode, DURABLE_FAILURE.authorityApprovalRequired);
    assert.equal(result.decision?.decision, 'REQUIRE_APPROVAL');

    const job = (await harness.stores.jobs.list({ organizationId: ORG }))[0];
    assert.equal(
      job.state,
      'dead_letter',
      'terminal, so it cannot become an ALLOW by being retried until the policy moves',
    );
    assert.equal(
      await harness.stores.jobs.claim(ORG, undefined, 'worker-b', 60_000, clock.nowIso()),
      undefined,
    );
  });

  it('records the approval requirement in the audit trail', async () => {
    const clock = createTestClock();
    const harness = createHarness(clock);
    harness.register(WRITING_DECLARATION, async () => ({ kind: 'succeeded' }));
    await enqueueWriting(harness);

    const worker = createJobWorker({
      store: harness.stores.jobs,
      registry: harness.registry,
      nowIso: () => clock.nowIso(),
      workerId: 'worker-a',
      audit: { record: (entry) => harness.audit.push(entry) },
      policies: {
        constraints: () => [
          {
            policyId: 'p',
            effect: 'require_approval',
            reason: 'a person must decide',
            actionTypes: ['*'],
          },
        ],
      },
    });
    await worker.runOnce(ORG);

    const entry = harness.audit.at(-1);
    assert.equal(entry?.authority?.['authority.decision'], 'REQUIRE_APPROVAL');
    assert.equal(entry?.outcome, 'approval_required');
    assert.ok(entry?.authority?.['authority.approvalReason'] !== undefined);
  });
});

describe('§17.32 — no secret material is persisted in job or event fixtures', () => {
  it('finds no credential-shaped value anywhere in the durable records', async () => {
    // A source-level guard on the SUITE ITSELF. It is cheap, and the thing it
    // prevents — somebody reaching for a real-looking API key to make a fixture
    // feel realistic — is exactly the kind of thing that passes review.
    const clock = createTestClock();
    const harness = createHarness(clock);
    harness.register(READ_ONLY_DECLARATION, async () => ({
      kind: 'succeeded',
      result: { ok: true },
      events: [{ eventId: 'ev-1', eventType: 'test.happened', payload: { n: 1 } }],
    }));
    await harness.stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.read',
        idempotencyKey: 'k1',
        correlationId: 'corr-1',
        actor: serviceActor(),
        input: { subject: 'workflow-run-1' },
      },
      clock.nowIso(),
    );
    await harness.worker('worker-a').runOnce(ORG);

    const serialized = JSON.stringify({
      jobs: await harness.stores.jobs.list({ organizationId: ORG }),
      events: await harness.stores.outbox.list({ organizationId: ORG }),
    });

    const secretShapes = [
      /sk-[A-Za-z0-9]{16,}/,
      /\bBearer\s+[A-Za-z0-9._-]{16,}/i,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
      /"(?:api[_-]?key|secret|password|token|credential)"\s*:/i,
    ];
    for (const shape of secretShapes) {
      assert.equal(shape.test(serialized), false, `durable records match ${shape}`);
    }
  });
});

describe('inconsequential work is not evaluated, and cannot lie about being so', () => {
  it('skips the evaluation for a read-only handler', async () => {
    // Not a convenience: an ALLOW recorded on every tick of every sweep is how
    // an audit trail becomes something nobody reads.
    const clock = createTestClock();
    const harness = createHarness(clock);
    harness.register(READ_ONLY_DECLARATION, async () => ({ kind: 'succeeded' }));
    await harness.stores.jobs.enqueue(
      {
        organizationId: ORG,
        jobType: 'test.read',
        idempotencyKey: 'k1',
        correlationId: 'corr-1',
        // No `job.run`. A consequential handler would be denied for this.
        actor: serviceActor(ORG, []),
      },
      clock.nowIso(),
    );

    const result = await harness.worker('worker-a').runOnce(ORG);
    assert.equal(result.outcome, 'succeeded');
    assert.equal(result.decision, undefined, 'nothing was weighed, so nothing is recorded');
  });
});
