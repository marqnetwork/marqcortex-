/**
 * MARQ spend ceiling and real-request kill switch.
 *
 * Every assertion here is about money the platform is or is not allowed to
 * spend. They run against the real ledger, the real spend guard and the real
 * control plane — the only substitutions are a hand-driven clock and a mock
 * adapter declared billable, so a paid provider's economics can be exercised
 * without a vendor account.
 *
 * The suite is deliberately adversarial about the failure modes a check-then-
 * charge ledger has: concurrency at the boundary, a restart mid-window, a
 * request that fails after spending, and a cap that a caller might hope resets
 * on its own.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RESERVATION_TTL_MS,
  SPEND_SCOPE,
  committedMicroUsd,
  createMemorySpendStore,
  createSpendLedger,
  remainingMicroUsd,
  reservationFrom,
  usdToMicroUsd,
  type SpendLedger,
  type SpendRecord,
  type SpendStore,
} from '../policy/spendLedger.ts';
import { createKvSpendStore, spendKeyFor } from '../adapters/kvSpendStore.ts';
import { createSpendGuard } from '../policy/spendGuard.ts';
import { createProviderRegistry } from '../providers/registry.ts';
import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createTestClock } from '../runtime/clock.ts';
import { loadControlPlaneConfig, DEFAULT_MAX_SPEND_USD } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { AIError } from '../contracts/errors.ts';
import { buildTestPlane, narrativeInput, TEST_TOKEN } from './harness.ts';

const NINE_DOLLARS = usdToMicroUsd(9);
const now = () => new Date('2026-08-01T00:00:00.000Z').toISOString();

function ledgerWith(capMicroUsd: number, store: SpendStore = createMemorySpendStore()) {
  return { ledger: createSpendLedger({ store, capMicroUsd, now }), store };
}

describe('spend ledger — the $9 MARQ ceiling', () => {
  it('starts at zero usage with the full cap available', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const record = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(record.spentMicroUsd, 0);
    assert.equal(record.capMicroUsd, NINE_DOLLARS);
    assert.equal(remainingMicroUsd(record), NINE_DOLLARS);
  });

  it('grants a request comfortably below the cap', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(1), 'r1');
    assert.equal(decision.granted, true);
  });

  it('refuses a request projected to cross the cap', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const first = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(8), 'r1');
    assert.equal(first.granted, true);
    if (!first.granted) return;
    await ledger.settle(first.reservation, usdToMicroUsd(8));

    // $8 spent, $2 projected. The projection crosses $9, so it never runs.
    const second = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'r2');
    assert.equal(second.granted, false);
    if (second.granted) return;
    assert.equal(second.reason, 'insufficient_headroom');
  });

  it('admits spend landing exactly on the $9 boundary, then refuses the next', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const exact = await ledger.reserve(SPEND_SCOPE.platform, NINE_DOLLARS, 'r1');
    assert.equal(exact.granted, true, 'exactly the cap must fit');
    if (!exact.granted) return;
    await ledger.settle(exact.reservation, NINE_DOLLARS);

    const record = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(record.spentMicroUsd, NINE_DOLLARS);
    assert.equal(remainingMicroUsd(record), 0);

    const next = await ledger.reserve(SPEND_SCOPE.platform, 1, 'r2');
    assert.equal(next.granted, false);
    if (next.granted) return;
    assert.equal(next.reason, 'cap_reached');
  });

  it('accumulates across many calls rather than resetting per call', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    for (let i = 0; i < 9; i += 1) {
      const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(1), `r${i}`);
      assert.equal(decision.granted, true, `call ${i + 1} should fit`);
      if (!decision.granted) return;
      await ledger.settle(decision.reservation, usdToMicroUsd(1));
    }
    const record = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(record.spentMicroUsd, NINE_DOLLARS);
    assert.equal(record.attemptCount, 9);
    assert.equal((await ledger.reserve(SPEND_SCOPE.platform, 1, 'r10')).granted, false);
  });

  it('holds the cap under concurrent reservations at the boundary', async () => {
    // The defect a check-then-charge ledger has: ten simultaneous requests all
    // read the same under-cap balance and all pass. Reservations must contend.
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(1), `concurrent-${i}`),
      ),
    );
    const granted = decisions.filter((decision) => decision.granted);
    assert.equal(granted.length, 9, 'exactly nine $1 reservations fit under a $9 cap');

    const record = await ledger.read(SPEND_SCOPE.platform);
    assert.ok(
      committedMicroUsd(record) <= NINE_DOLLARS,
      `committed ${committedMicroUsd(record)} must never exceed the cap`,
    );
  });

  it('survives a restart because the ledger is not module memory', async () => {
    const store = createMemorySpendStore();
    const first = createSpendLedger({ store, capMicroUsd: NINE_DOLLARS, now });
    const decision = await first.reserve(SPEND_SCOPE.platform, usdToMicroUsd(7), 'r1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;
    await first.settle(decision.reservation, usdToMicroUsd(7));

    // A new ledger over the same store models a recycled edge isolate.
    const afterRestart = createSpendLedger({ store, capMicroUsd: NINE_DOLLARS, now });
    const record = await afterRestart.read(SPEND_SCOPE.platform);
    assert.equal(record.spentMicroUsd, usdToMicroUsd(7), 'a restart must not rediscover $0');
    assert.equal((await afterRestart.reserve(SPEND_SCOPE.platform, usdToMicroUsd(3), 'r2')).granted, false);
  });

  it('never resets on a timer, however far the clock moves', async () => {
    // A rolling window would have renewed several times over the span below.
    // This is a lifetime ceiling: only an authorised reset clears it.
    let clockIso = '2026-08-01T00:00:00.000Z';
    const store = createMemorySpendStore();
    const ledger = createSpendLedger({
      store,
      capMicroUsd: NINE_DOLLARS,
      now: () => clockIso,
    });

    const decision = await ledger.reserve(SPEND_SCOPE.platform, NINE_DOLLARS, 'r1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;
    await ledger.settle(decision.reservation, NINE_DOLLARS);

    for (const iso of ['2026-08-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2027-08-01T00:00:00.000Z']) {
      clockIso = iso;
      const record = await ledger.read(SPEND_SCOPE.platform);
      assert.equal(record.spentMicroUsd, NINE_DOLLARS, `still spent at ${iso}`);
      assert.equal(
        (await ledger.reserve(SPEND_SCOPE.platform, 1, `probe-${iso}`)).granted,
        false,
        `must still refuse at ${iso}`,
      );
    }
  });

  it('releases a reservation that never spent, freeing the headroom', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(9), 'r1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;

    assert.equal((await ledger.reserve(SPEND_SCOPE.platform, 1, 'r2')).granted, false);
    await ledger.release(decision.reservation);
    assert.equal((await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(9), 'r3')).granted, true);
  });

  it('does not double charge a reservation settled twice', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'r1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;
    await ledger.settle(decision.reservation, usdToMicroUsd(2));
    await ledger.settle(decision.reservation, usdToMicroUsd(2));
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).spentMicroUsd, usdToMicroUsd(2));
  });
});

describe('spend cap reset', () => {
  it('refuses a reset with no authorizing actor or reason', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    await assert.rejects(() => ledger.reset(SPEND_SCOPE.platform, { authorizedBy: '', reason: 'x' }));
    await assert.rejects(() => ledger.reset(SPEND_SCOPE.platform, { authorizedBy: 'ops', reason: '  ' }));
  });

  it('clears spend and records who authorised it and why', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const decision = await ledger.reserve(SPEND_SCOPE.platform, NINE_DOLLARS, 'r1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;
    await ledger.settle(decision.reservation, NINE_DOLLARS);

    const after = await ledger.reset(SPEND_SCOPE.platform, {
      authorizedBy: 'user-owner-1',
      reason: 'Q3 AI budget approved by finance',
      newCapMicroUsd: usdToMicroUsd(25),
    });

    assert.equal(after.spentMicroUsd, 0);
    assert.equal(after.capMicroUsd, usdToMicroUsd(25));
    assert.equal(after.resets.length, 1);
    assert.equal(after.resets[0].authorizedBy, 'user-owner-1');
    assert.equal(after.resets[0].clearedMicroUsd, NINE_DOLLARS);
    assert.equal(after.resets[0].previousCapMicroUsd, NINE_DOLLARS);
  });
});

/**
 * Raising the ceiling is the other half of budget management (AI-01 Batch 2),
 * and it is deliberately NOT the same operation as a reset. "We authorised more
 * money" and "we wiped the record of what was spent" are different decisions
 * with different blast radii; a platform that offers only the second forces an
 * operator who wanted the first to destroy the evidence to get it.
 */
describe('spend cap increase', () => {
  it('refuses an increase with no authorizing actor or reason', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    await assert.rejects(() =>
      ledger.raiseCap(SPEND_SCOPE.platform, {
        authorizedBy: '',
        reason: 'x',
        newCapMicroUsd: usdToMicroUsd(25),
      }),
    );
    await assert.rejects(() =>
      ledger.raiseCap(SPEND_SCOPE.platform, {
        authorizedBy: 'ops',
        reason: '   ',
        newCapMicroUsd: usdToMicroUsd(25),
      }),
    );
  });

  it('raises the ceiling while preserving settled spend', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(4), 'r1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;
    await ledger.settle(decision.reservation, usdToMicroUsd(4));

    const after = await ledger.raiseCap(SPEND_SCOPE.platform, {
      authorizedBy: 'user-owner-1',
      reason: 'approved uplift for the Q3 pilot',
      newCapMicroUsd: usdToMicroUsd(25),
    });

    assert.equal(after.capMicroUsd, usdToMicroUsd(25));
    // Raising a ceiling is not forgiving the spend under it.
    assert.equal(after.spentMicroUsd, usdToMicroUsd(4));
    assert.equal(remainingMicroUsd(after), usdToMicroUsd(21));
    assert.equal(after.resets.at(-1)?.kind, 'cap_raise');
    assert.equal(after.resets.at(-1)?.clearedMicroUsd, 0);
    assert.equal(after.resets.at(-1)?.previousCapMicroUsd, NINE_DOLLARS);
  });

  it('leaves open reservations untouched', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'in-flight');
    assert.equal(decision.granted, true);

    const after = await ledger.raiseCap(SPEND_SCOPE.platform, {
      authorizedBy: 'user-owner-1',
      reason: 'headroom for the migration sprint',
      newCapMicroUsd: usdToMicroUsd(30),
    });

    // A request that was in flight when the ceiling moved must still be able to
    // settle its own hold — a reset would have discarded it.
    assert.equal(after.openReservations.length, 1);
    assert.equal(after.openReservations[0].reservationId, 'in-flight');
    if (!decision.granted) return;
    const settled = await ledger.settle(decision.reservation, usdToMicroUsd(1));
    assert.equal(settled.spentMicroUsd, usdToMicroUsd(1));
    assert.equal(settled.reservedMicroUsd, 0);
  });

  it('refuses to lower the ceiling', async () => {
    const { ledger } = ledgerWith(NINE_DOLLARS);
    // Lowering is a deployment change to AI_MAX_SPEND_USD, which the ledger
    // already honours on the next load. Allowing it here would let an
    // "increase" call quietly disable AI.
    await assert.rejects(() =>
      ledger.raiseCap(SPEND_SCOPE.platform, {
        authorizedBy: 'user-owner-1',
        reason: 'trying to lower the cap',
        newCapMicroUsd: usdToMicroUsd(1),
      }),
    );
    const record = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(record.capMicroUsd, NINE_DOLLARS);
  });

  it('survives a restart, so a raised ceiling is not re-stamped away', async () => {
    const store = createMemorySpendStore();
    const first = createSpendLedger({ store, capMicroUsd: NINE_DOLLARS, now });
    await first.raiseCap(SPEND_SCOPE.platform, {
      authorizedBy: 'user-owner-1',
      reason: 'approved uplift',
      newCapMicroUsd: usdToMicroUsd(25),
    });

    // A fresh isolate configured with the ORIGINAL environment cap. The raise
    // was an authorised change and must outlive the isolate that made it.
    const second = createSpendLedger({ store, capMicroUsd: NINE_DOLLARS, now });
    assert.equal((await second.read(SPEND_SCOPE.platform)).capMicroUsd, usdToMicroUsd(25));
  });
});

describe('durable spend store', () => {
  function kvBacked() {
    const rows = new Map<string, unknown>();
    const store = createKvSpendStore({
      read: (key) => Promise.resolve(rows.get(key)),
      write: (key, value) => {
        rows.set(key, JSON.stringify(value));
        return Promise.resolve();
      },
    });
    return { store, rows };
  }

  it('round-trips a record through JSON storage', async () => {
    const { store, rows } = kvBacked();
    const ledger = createSpendLedger({ store, capMicroUsd: NINE_DOLLARS, now });
    const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(3), 'r1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;
    await ledger.settle(decision.reservation, usdToMicroUsd(3));

    assert.ok(rows.has(spendKeyFor(SPEND_SCOPE.platform)));
    const reloaded = createSpendLedger({ store, capMicroUsd: NINE_DOLLARS, now });
    assert.equal((await reloaded.read(SPEND_SCOPE.platform)).spentMicroUsd, usdToMicroUsd(3));
  });

  it('fails closed on an unreadable ledger rather than assuming zero spend', async () => {
    const rows = new Map<string, unknown>([[spendKeyFor(SPEND_SCOPE.platform), '{ not json']]);
    const store = createKvSpendStore({
      read: (key) => Promise.resolve(rows.get(key)),
      write: () => Promise.resolve(),
    });
    // A corrupt balance that read as $0 would hand the platform an unlimited
    // budget at exactly the moment it lost the ability to observe itself.
    await assert.rejects(() => store.load(SPEND_SCOPE.platform));
  });

  it('treats an absent row as a genuine zero balance', async () => {
    const { store } = kvBacked();
    assert.equal(await store.load(SPEND_SCOPE.platform), undefined);
  });
});

describe('spend guard and the real-request kill switch', () => {
  function guardWith(options: { realRequests: boolean; billable: boolean; cap?: number }) {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, {
      failureThreshold: 5,
      openMs: 1_000,
      halfOpenSuccessesToClose: 1,
    });
    const registry = createProviderRegistry(clock, circuit);
    registry.register(
      createMockProvider({
        providerId: 'vendor',
        billable: options.billable,
        pricing: { promptMicroUsdPer1k: 150, completionMicroUsdPer1k: 600 },
      }),
      { certification: 'certified' },
    );
    const ledger = createSpendLedger({
      store: createMemorySpendStore(),
      capMicroUsd: options.cap ?? NINE_DOLLARS,
      now,
    });
    const guard = createSpendGuard({
      ledger,
      registry,
      realRequestsEnabled: options.realRequests,
      enforce: true,
    });
    return { guard, ledger };
  }

  const descriptor = {
    featureId: 'test.feature',
    requiredCapabilities: { structuredOutput: false, chatCompletions: true },
    limits: { maxInputBytes: 4_000, maxOutputTokens: 1_000, maxAttempts: 2 },
  } as unknown as Parameters<ReturnType<typeof createSpendGuard>['reserve']>[0];

  it('reserves nothing when real requests are disabled', async () => {
    const { guard, ledger } = guardWith({ realRequests: false, billable: true });
    const handle = await guard.reserve(descriptor, 'req-1');
    assert.equal(handle.reserved, false);
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).reservedMicroUsd, 0);
  });

  it('reserves nothing for a non-billable provider even in real mode', async () => {
    // This is what keeps a full mock-mode test run from consuming the $9.
    const { guard, ledger } = guardWith({ realRequests: true, billable: false });
    const handle = await guard.reserve(descriptor, 'req-1');
    assert.equal(handle.reserved, false);
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).spentMicroUsd, 0);
  });

  it('reserves against the ceiling for a billable provider in real mode', async () => {
    const { guard, ledger } = guardWith({ realRequests: true, billable: true });
    const handle = await guard.reserve(descriptor, 'req-1');
    assert.equal(handle.reserved, true);
    assert.ok(handle.estimateMicroUsd > 0);
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).reservedMicroUsd, handle.estimateMicroUsd);
  });

  it('refuses with BUDGET_EXCEEDED once the ceiling is reached', async () => {
    const { guard, ledger } = guardWith({ realRequests: true, billable: true, cap: 100 });
    const first = await ledger.reserve(SPEND_SCOPE.platform, 100, 'seed');
    assert.equal(first.granted, true);
    if (!first.granted) return;
    await ledger.settle(first.reservation, 100);

    await assert.rejects(
      () => guard.reserve(descriptor, 'req-1'),
      (error: AIError) => error.code === 'BUDGET_EXCEEDED' && error.status === 429,
    );
  });

  it('keeps a caller-safe message free of ledger internals', async () => {
    const { guard, ledger } = guardWith({ realRequests: true, billable: true, cap: 100 });
    const seed = await ledger.reserve(SPEND_SCOPE.platform, 100, 'seed');
    if (!seed.granted) return;
    await ledger.settle(seed.reservation, 100);

    await guard.reserve(descriptor, 'req-1').then(
      () => assert.fail('expected a refusal'),
      (error: AIError) => {
        const body = error.toResponseBody('req-1', 'cor-1');
        assert.equal(JSON.stringify(body).includes('spend:marq'), false);
        assert.equal(JSON.stringify(body).includes('diagnostics'), false);
        assert.ok(error.diagnostics?.includes('cap='), 'detail belongs in diagnostics');
      },
    );
  });
});

describe('spend configuration', () => {
  it('defaults the ceiling to $9', () => {
    const config = loadControlPlaneConfig(recordEnv({}));
    assert.equal(config.spend.maxPlatformMicroUsd, usdToMicroUsd(DEFAULT_MAX_SPEND_USD));
    assert.equal(config.spend.maxPlatformMicroUsd, NINE_DOLLARS);
  });

  it('defaults real requests to OFF', () => {
    assert.equal(loadControlPlaneConfig(recordEnv({})).allowRealRequests, false);
  });

  it('defaults the provider preference to mock first while real requests are off', () => {
    assert.equal(loadControlPlaneConfig(recordEnv({})).providerPreference[0], 'mock');
  });

  it('moves mock LAST once real requests are authorised', () => {
    // A deployment that explicitly authorised real spending and still answered
    // every request from the mock would look healthy, cost nothing, and be
    // wrong about every answer it gave.
    const config = loadControlPlaneConfig(recordEnv({ AI_ALLOW_REAL_REQUESTS: 'true' }));
    assert.equal(config.providerPreference[0], 'openai');
    assert.equal(config.providerPreference.at(-1), 'mock');
  });

  it('honours an explicit preference over either default', () => {
    const config = loadControlPlaneConfig(
      recordEnv({ AI_ALLOW_REAL_REQUESTS: 'true', AI_PROVIDER_PREFERENCE: 'anthropic,openai' }),
    );
    assert.deepEqual([...config.providerPreference], ['anthropic', 'openai']);
  });

  it('falls back to $9 for a malformed or negative ceiling', () => {
    for (const raw of ['not-a-number', '-5', '']) {
      const config = loadControlPlaneConfig(recordEnv({ AI_MAX_SPEND_USD: raw }));
      assert.equal(config.spend.maxPlatformMicroUsd, NINE_DOLLARS, `AI_MAX_SPEND_USD=${raw}`);
    }
  });

  it('accepts a fractional ceiling without float drift', () => {
    const config = loadControlPlaneConfig(recordEnv({ AI_MAX_SPEND_USD: '2.50' }));
    assert.equal(config.spend.maxPlatformMicroUsd, 2_500_000);
  });

  it('defaults the reservation window to fifteen minutes', () => {
    const config = loadControlPlaneConfig(recordEnv({}));
    assert.equal(config.spend.reservationTtlMs, DEFAULT_RESERVATION_TTL_MS);
    assert.ok(
      config.spend.reservationTtlMs > config.workflowDeadlineMs,
      'a hold must outlive the request that owns it',
    );
  });

  it('bounds a reservation window a misconfiguration made too short', () => {
    // One second is far shorter than a request can run, and a hold that expired
    // mid-request would hand the same headroom to a second caller.
    const config = loadControlPlaneConfig(recordEnv({ AI_SPEND_RESERVATION_TTL_MS: '1000' }));
    assert.ok(config.spend.reservationTtlMs >= 60_000);
  });

  it('never lets the control plane hold expire before the workflow deadline', async () => {
    // The floor lives in the control plane, so assert it where it bites: a
    // configured window shorter than the deadline must not reclaim a hold from
    // a request that could still be running.
    const { plane, clock } = buildTestPlane({
      env: { AI_SPEND_RESERVATION_TTL_MS: '60000', AI_WORKFLOW_DEADLINE_MS: '600000' },
    });
    const decision = await plane.spendLedger.reserve(SPEND_SCOPE.platform, 1_000, 'long-running');
    assert.equal(decision.granted, true);

    clock.advance(600_000);
    const open = await plane.spendLedger.openReservations(SPEND_SCOPE.platform);
    assert.equal(open.length, 1, 'the hold outlives the longest request the plane will admit');
  });
});

describe('mock mode does not consume the MARQ budget', () => {
  it('leaves the ceiling untouched after a full governed request', async () => {
    // The property that makes a full test run safe: mock-served traffic is
    // non-billable, so it never reaches the ledger at all.
    const { plane } = buildTestPlane();
    const result = await plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput(), channel: 'team_console' },
      { authorization: `Bearer ${TEST_TOKEN}` },
    );
    assert.equal(result.cost.microUsd, 0);

    const spend = await plane.spendStatus();
    assert.equal(spend.spentMicroUsd, 0);
    assert.equal(spend.reservedMicroUsd, 0);
    assert.equal(spend.attemptCount, 0);
  });

  it('opens no reservation at all, so mock traffic cannot strand headroom', async () => {
    // Stronger than "spent nothing": a mock request must not even take a hold,
    // because a hold that is never settled is the failure mode this suite is
    // about. Nothing to leak means nothing to recover.
    const { plane } = buildTestPlane();
    await plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput(), channel: 'team_console' },
      { authorization: `Bearer ${TEST_TOKEN}` },
    );
    const open = await plane.spendLedger.openReservations(SPEND_SCOPE.platform);
    assert.equal(open.length, 0);
  });
});

/**
 * Orphaned reservations — the certification blocker this suite exists to close.
 *
 * The defect: reserved money was durable, but the record of WHICH request held
 * it lived in isolate memory. An isolate recycled between reserve and settle
 * left a hold that nothing could settle or release, so the headroom was gone
 * for good. Enough interrupted requests and the platform refuses every AI call
 * while having spent nothing.
 *
 * Every case below drives the ledger through a genuine instance boundary — a
 * second `createSpendLedger` over the same store, which is exactly what a
 * recycled edge isolate is.
 */
describe('orphaned reservation recovery', () => {
  const TTL_MS = 600_000;

  /** A clock the test moves by hand, in the ISO shape the ledger reads. */
  function movableClock(startIso = '2026-08-01T00:00:00.000Z') {
    let ms = Date.parse(startIso);
    return {
      now: () => new Date(ms).toISOString(),
      advance: (deltaMs: number) => {
        ms += deltaMs;
      },
    };
  }

  /** Model a restart: a brand-new ledger instance over the same durable store. */
  function restart(store: SpendStore, clock: { now: () => string }, cap = NINE_DOLLARS): SpendLedger {
    return createSpendLedger({
      store,
      capMicroUsd: cap,
      now: clock.now,
      reservationTtlMs: TTL_MS,
    });
  }

  it('carries a still-valid reservation across an instance restart', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const before = restart(store, clock);

    const decision = await before.reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'req-1', {
      owner: 'cortex.narrative',
    });
    assert.equal(decision.granted, true);

    // The isolate dies here. Nothing settles, nothing releases.
    const after = restart(store, clock);
    const record = await after.read(SPEND_SCOPE.platform);
    assert.equal(record.reservedMicroUsd, usdToMicroUsd(2), 'the hold must survive the restart');

    const open = await after.openReservations(SPEND_SCOPE.platform);
    assert.equal(open.length, 1);
    assert.equal(open[0].reservationId, 'req-1');
    assert.equal(open[0].reservedMicroUsd, usdToMicroUsd(2));
    assert.equal(open[0].owner, 'cortex.narrative', 'a recovered hold must name its owner');
    assert.ok(Number.isFinite(Date.parse(open[0].expiresAt)), 'and carry a readable expiry');
  });

  it('does not reclaim a reservation that is still within its window', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const first = restart(store, clock);
    const decision = await first.reserve(SPEND_SCOPE.platform, usdToMicroUsd(9), 'req-1');
    assert.equal(decision.granted, true);

    // One millisecond before expiry. Reclaiming here would hand the same $9 to
    // a second request while the first is still running.
    clock.advance(TTL_MS - 1);
    const after = restart(store, clock);
    const record = await after.read(SPEND_SCOPE.platform);
    assert.equal(record.reservedMicroUsd, usdToMicroUsd(9));
    assert.equal(record.reclaimedCount, 0);
    assert.equal(
      (await after.reserve(SPEND_SCOPE.platform, 1, 'req-2')).granted,
      false,
      'headroom is still held, so the next request is still refused',
    );
  });

  it('reclaims an expired reservation from a new instance', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const first = restart(store, clock);
    const decision = await first.reserve(SPEND_SCOPE.platform, usdToMicroUsd(9), 'req-1');
    assert.equal(decision.granted, true);

    clock.advance(TTL_MS);
    const after = restart(store, clock);
    const record = await after.read(SPEND_SCOPE.platform);

    assert.equal(record.reservedMicroUsd, 0, 'the orphaned hold is returned');
    assert.equal(record.spentMicroUsd, 0, 'and no spend was invented');
    assert.equal(record.reclaimedMicroUsd, usdToMicroUsd(9));
    assert.equal(record.reclaimedCount, 1);
    assert.equal((await after.openReservations(SPEND_SCOPE.platform)).length, 0);
    assert.equal(
      (await after.reserve(SPEND_SCOPE.platform, usdToMicroUsd(9), 'req-2')).granted,
      true,
      'the full ceiling is available again',
    );
  });

  it('persists the reclamation, so it is not re-derived on every read', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    await restart(store, clock).reserve(SPEND_SCOPE.platform, usdToMicroUsd(4), 'req-1');
    clock.advance(TTL_MS);
    await restart(store, clock).read(SPEND_SCOPE.platform);

    const persisted = await store.load(SPEND_SCOPE.platform);
    assert.ok(persisted);
    assert.equal(persisted.reservedMicroUsd, 0);
    assert.equal(persisted.openReservations.length, 0);
  });

  it('settles a recovered reservation after a restart, charging the real cost', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const before = restart(store, clock);
    const decision = await before.reserve(SPEND_SCOPE.platform, usdToMicroUsd(3), 'req-1');
    assert.equal(decision.granted, true);

    // A new isolate finds the hold, rehydrates a handle from durable metadata
    // alone, and settles it. No in-memory ownership is involved anywhere.
    const after = restart(store, clock);
    const open = await after.openReservations(SPEND_SCOPE.platform);
    assert.equal(open.length, 1);
    const settled = await after.settle(reservationFrom(SPEND_SCOPE.platform, open[0]), usdToMicroUsd(1));

    assert.equal(settled.spentMicroUsd, usdToMicroUsd(1), 'measured cost, not the estimate');
    assert.equal(settled.reservedMicroUsd, 0, 'and the hold is fully released');
    assert.equal(settled.attemptCount, 1);
  });

  it('still charges a settlement that arrives after its hold was reclaimed', async () => {
    // Fail-closed: the reclaim returned headroom, but the vendor call really
    // happened. Under-counting real spend is the one error the ceiling cannot
    // survive, so a late settlement charges.
    const store = createMemorySpendStore();
    const clock = movableClock();
    const before = restart(store, clock);
    const decision = await before.reserve(SPEND_SCOPE.platform, usdToMicroUsd(3), 'req-1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;

    clock.advance(TTL_MS);
    const after = restart(store, clock);
    assert.equal((await after.read(SPEND_SCOPE.platform)).reservedMicroUsd, 0);

    const settled = await after.settle(decision.reservation, usdToMicroUsd(2));
    assert.equal(settled.spentMicroUsd, usdToMicroUsd(2));
    assert.equal(settled.attemptCount, 1);
  });

  it('does not double charge across a restart, because closed ids are durable', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const before = restart(store, clock);
    const decision = await before.reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'req-1');
    assert.equal(decision.granted, true);
    if (!decision.granted) return;
    await before.settle(decision.reservation, usdToMicroUsd(2));

    const after = restart(store, clock);
    await after.settle(decision.reservation, usdToMicroUsd(2));
    assert.equal((await after.read(SPEND_SCOPE.platform)).spentMicroUsd, usdToMicroUsd(2));
  });

  it('never takes a second hold for a reservation id that is already open', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const ledger = restart(store, clock);
    await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'req-1');
    await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'req-1');

    const record = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(record.reservedMicroUsd, usdToMicroUsd(2), 'a retry must not hold twice');
    assert.equal(record.openReservations.length, 1);
  });

  /**
   * A store seeded with a row in the OLD shape: a reserved total and no hold
   * metadata, which is exactly what the previous revision left behind.
   */
  function storeWithOrphanedReserve(reservedMicroUsd: number, updatedAt: string): SpendStore {
    const rows = new Map<string, SpendRecord>([
      [
        SPEND_SCOPE.platform,
        {
          scope: SPEND_SCOPE.platform,
          spentMicroUsd: 0,
          reservedMicroUsd,
          capMicroUsd: NINE_DOLLARS,
          attemptCount: 0,
          updatedAt,
          resets: [],
          openReservations: [],
          closedReservationIds: [],
          reclaimedMicroUsd: 0,
          reclaimedCount: 0,
        },
      ],
    ]);
    return {
      load: (scope) => Promise.resolve(rows.get(scope)),
      save: (record) => {
        rows.set(record.scope, record);
        return Promise.resolve();
      },
    };
  }

  it('reclaims reserved money inherited from a record with no hold metadata', async () => {
    // A row written by the previous revision: a reserved total and no way to
    // know who owns it. It is time-boxed from the moment it is first observed,
    // then returned — otherwise every pre-upgrade orphan would be permanent.
    const clock = movableClock();
    const store = storeWithOrphanedReserve(usdToMicroUsd(9), clock.now());

    const ledger = restart(store, clock);
    assert.equal(
      (await ledger.read(SPEND_SCOPE.platform)).reservedMicroUsd,
      usdToMicroUsd(9),
      'not reclaimed on sight — the grace window has to pass first',
    );

    clock.advance(TTL_MS);
    const record = await restart(store, clock).read(SPEND_SCOPE.platform);
    assert.equal(record.reservedMicroUsd, 0);
    assert.equal(record.reclaimedMicroUsd, usdToMicroUsd(9));
  });

  it('keeps the grace window anchored, so later writes cannot extend it forever', async () => {
    const clock = movableClock();
    const store = storeWithOrphanedReserve(usdToMicroUsd(1), clock.now());

    // Unrelated traffic keeps writing the record while the orphan waits.
    for (let i = 0; i < 5; i += 1) {
      clock.advance(TTL_MS / 5);
      const ledger = restart(store, clock);
      const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(1), `busy-${i}`);
      assert.equal(decision.granted, true);
      if (!decision.granted) return;
      await ledger.settle(decision.reservation, 0);
    }

    const record = await restart(store, clock).read(SPEND_SCOPE.platform);
    assert.equal(record.reservedMicroUsd, 0, 'the anchor is durable, so the orphan still expires');
  });

  it('holds the cap exactly under concurrent reservations spanning a reclaim', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const first = restart(store, clock);
    const wave = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        first.reserve(SPEND_SCOPE.platform, usdToMicroUsd(1), `wave-a-${i}`),
      ),
    );
    assert.equal(wave.filter((decision) => decision.granted).length, 9);

    const record = await first.read(SPEND_SCOPE.platform);
    assert.equal(record.openReservations.length, 9, 'every grant has exactly one durable hold');
    assert.equal(
      record.openReservations.reduce((sum, hold) => sum + hold.reservedMicroUsd, 0),
      record.reservedMicroUsd,
      'the cached total always equals the sum of the holds',
    );

    // All nine are abandoned. After expiry a second wave contends for the same
    // ceiling and must be bounded identically.
    clock.advance(TTL_MS);
    const after = restart(store, clock);
    const second = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        after.reserve(SPEND_SCOPE.platform, usdToMicroUsd(1), `wave-b-${i}`),
      ),
    );
    assert.equal(second.filter((decision) => decision.granted).length, 9);
    assert.ok(committedMicroUsd(await after.read(SPEND_SCOPE.platform)) <= NINE_DOLLARS);
  });

  it('holds the exact $9 boundary after a reclaim cycle', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const first = restart(store, clock);
    await first.reserve(SPEND_SCOPE.platform, usdToMicroUsd(9), 'abandoned');
    clock.advance(TTL_MS);

    const after = restart(store, clock);
    const exact = await after.reserve(SPEND_SCOPE.platform, NINE_DOLLARS, 'exact');
    assert.equal(exact.granted, true, 'exactly the cap must still fit');
    if (!exact.granted) return;
    await after.settle(exact.reservation, NINE_DOLLARS);

    const record = await after.read(SPEND_SCOPE.platform);
    assert.equal(record.spentMicroUsd, NINE_DOLLARS);
    assert.equal(remainingMicroUsd(record), 0);
    const next = await after.reserve(SPEND_SCOPE.platform, 1, 'over');
    assert.equal(next.granted, false);
    if (next.granted) return;
    assert.equal(next.reason, 'cap_reached');
    // Settled spend is NOT reclaimable. Only holds expire; money that was spent
    // stays spent however far the clock moves.
    clock.advance(TTL_MS * 100);
    assert.equal(
      (await restart(store, clock).read(SPEND_SCOPE.platform)).spentMicroUsd,
      NINE_DOLLARS,
    );
  });

  it('clears spent AND reserved on an authorised reset', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const ledger = restart(store, clock);

    const spent = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(4), 'settled-1');
    assert.equal(spent.granted, true);
    if (!spent.granted) return;
    await ledger.settle(spent.reservation, usdToMicroUsd(4));
    await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(5), 'stranded-1');

    const before = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(committedMicroUsd(before), NINE_DOLLARS, 'the ceiling is fully committed');

    const after = await ledger.reset(SPEND_SCOPE.platform, {
      authorizedBy: 'user-owner-1',
      reason: 'orphaned reservations cleared after an incident',
    });

    assert.equal(after.spentMicroUsd, 0);
    assert.equal(after.reservedMicroUsd, 0, 'a reset that left holds behind would not restore AI');
    assert.equal(after.openReservations.length, 0);
    assert.equal(after.resets[0].clearedMicroUsd, usdToMicroUsd(4));
    assert.equal(after.resets[0].clearedReservedMicroUsd, usdToMicroUsd(5));
    assert.equal(after.resets[0].clearedReservationCount, 1);
    assert.equal(
      (await ledger.reserve(SPEND_SCOPE.platform, NINE_DOLLARS, 'post-reset')).granted,
      true,
    );
  });

  it('leaves both spent and reserved intact when a reset is not authorised', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const ledger = restart(store, clock);
    await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(5), 'stranded-1');

    await assert.rejects(() =>
      ledger.reset(SPEND_SCOPE.platform, { authorizedBy: '   ', reason: 'clear it' }),
    );
    await assert.rejects(() =>
      ledger.reset(SPEND_SCOPE.platform, { authorizedBy: 'ops', reason: '' }),
    );

    const record = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(record.reservedMicroUsd, usdToMicroUsd(5), 'an unauthorised reset changes nothing');
    assert.equal(record.openReservations.length, 1);
    assert.equal(record.resets.length, 0);
  });

  it('round-trips hold metadata through key-value storage', async () => {
    const rows = new Map<string, unknown>();
    const store = createKvSpendStore({
      read: (key) => Promise.resolve(rows.get(key)),
      write: (key, value) => {
        rows.set(key, JSON.stringify(value));
        return Promise.resolve();
      },
    });
    const clock = movableClock();
    await restart(store, clock).reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'req-1', {
      owner: 'cortex.analysis',
    });

    const open = await restart(store, clock).openReservations(SPEND_SCOPE.platform);
    assert.equal(open.length, 1);
    assert.equal(open[0].reservationId, 'req-1');
    assert.equal(open[0].owner, 'cortex.analysis');

    clock.advance(TTL_MS);
    assert.equal((await restart(store, clock).read(SPEND_SCOPE.platform)).reservedMicroUsd, 0);
  });
});

describe('interrupted requests cannot permanently disable AI', () => {
  const TTL_MS = 600_000;
  const descriptor = {
    featureId: 'test.feature',
    requiredCapabilities: { structuredOutput: false, chatCompletions: true },
    limits: { maxInputBytes: 4_000, maxOutputTokens: 1_000, maxAttempts: 2 },
  } as unknown as Parameters<ReturnType<typeof createSpendGuard>['reserve']>[0];

  function movableClock(startIso = '2026-08-01T00:00:00.000Z') {
    let ms = Date.parse(startIso);
    return {
      now: () => new Date(ms).toISOString(),
      advance: (deltaMs: number) => {
        ms += deltaMs;
      },
    };
  }

  /** A fresh guard + ledger over a shared store: one edge isolate's lifetime. */
  function isolate(store: SpendStore, clock: { now: () => string }, capMicroUsd: number) {
    const testClock = createTestClock();
    const circuit = createCircuitBreaker(testClock, {
      failureThreshold: 5,
      openMs: 1_000,
      halfOpenSuccessesToClose: 1,
    });
    const registry = createProviderRegistry(testClock, circuit);
    registry.register(
      createMockProvider({
        providerId: 'vendor',
        billable: true,
        pricing: { promptMicroUsdPer1k: 150, completionMicroUsdPer1k: 600 },
      }),
      { certification: 'certified' },
    );
    const ledger = createSpendLedger({
      store,
      capMicroUsd,
      now: clock.now,
      reservationTtlMs: TTL_MS,
    });
    const guard = createSpendGuard({ ledger, registry, realRequestsEnabled: true, enforce: true });
    return { guard, ledger };
  }

  /**
   * Nineteen requests that reserve and are then killed mid-flight, each in its
   * own isolate. This is the scenario that took the platform down: with
   * ownership in isolate memory the nineteenth request found a ceiling fully
   * committed to holds nothing could ever settle, and every request after it
   * failed forever, with $0 actually spent.
   */
  async function nineteenInterruptedRequests(store: SpendStore, clock: ReturnType<typeof movableClock>, cap: number) {
    let refusals = 0;
    let grants = 0;
    for (let i = 0; i < 19; i += 1) {
      const { guard } = isolate(store, clock, cap);
      try {
        // Reserve, then the isolate is recycled. No settle, no release.
        await guard.reserve(descriptor, `interrupted-${i}`);
        grants += 1;
      } catch (error) {
        assert.ok(error instanceof AIError && error.code === 'BUDGET_EXCEEDED');
        refusals += 1;
      }
      // Far less than the TTL: nothing ages out during the run itself.
      clock.advance(1_000);
    }
    assert.equal(grants, 18, 'eighteen holds fit under the sized ceiling');
    assert.equal(refusals, 1, 'and the nineteenth request is refused with $0 spent');
    return refusals;
  }

  function capForNineteen(store: SpendStore, clock: ReturnType<typeof movableClock>) {
    // Size the ceiling so eighteen holds fit and the nineteenth cannot.
    const estimate = isolate(store, clock, NINE_DOLLARS).guard.estimateFor(descriptor);
    return estimate * 19 - 1;
  }

  it('recovers on its own once the abandoned holds expire', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const cap = capForNineteen(store, clock);

    const refusals = await nineteenInterruptedRequests(store, clock, cap);
    assert.ok(refusals > 0, 'the interrupted run really does exhaust the ceiling');

    const stalled = await isolate(store, clock, cap).ledger.read(SPEND_SCOPE.platform);
    assert.equal(stalled.spentMicroUsd, 0, 'not one cent was actually spent');
    assert.ok(stalled.reservedMicroUsd > 0, 'yet the ceiling is fully committed to holds');

    // Wall clock passes. Every abandoned hold ages out.
    clock.advance(TTL_MS);
    const recovered = isolate(store, clock, cap);
    const handle = await recovered.guard.reserve(descriptor, 'after-expiry');
    assert.equal(handle.reserved, true, 'AI must work again without human intervention');
    await handle.settle(1_000);

    const record = await recovered.ledger.read(SPEND_SCOPE.platform);
    assert.equal(record.spentMicroUsd, 1_000);
    assert.ok(record.reclaimedCount >= 18, 'and the recovery is visible on the record');
  });

  it('recovers immediately on an authorised reset, before any expiry', async () => {
    const store = createMemorySpendStore();
    const clock = movableClock();
    const cap = capForNineteen(store, clock);

    const refusals = await nineteenInterruptedRequests(store, clock, cap);
    assert.ok(refusals > 0);

    const operator = isolate(store, clock, cap);
    await operator.ledger.reset(SPEND_SCOPE.platform, {
      authorizedBy: 'user-owner-1',
      reason: 'clearing holds stranded by an isolate recycle',
    });

    const handle = await operator.guard.reserve(descriptor, 'after-reset');
    assert.equal(handle.reserved, true);
    await handle.release();
    const record = await operator.ledger.read(SPEND_SCOPE.platform);
    assert.equal(record.spentMicroUsd, 0);
    assert.equal(record.reservedMicroUsd, 0);
  });

  it('still refuses a request that would genuinely cross the ceiling', async () => {
    // Recovery must not turn into leniency: with the ceiling actually SPENT,
    // no amount of waiting reopens it.
    const store = createMemorySpendStore();
    const clock = movableClock();
    const { guard, ledger } = isolate(store, clock, NINE_DOLLARS);
    const seed = await ledger.reserve(SPEND_SCOPE.platform, NINE_DOLLARS, 'seed');
    assert.equal(seed.granted, true);
    if (!seed.granted) return;
    await ledger.settle(seed.reservation, NINE_DOLLARS);

    clock.advance(TTL_MS * 10);
    await assert.rejects(
      () => guard.reserve(descriptor, 'req-1'),
      (error: AIError) => error.code === 'BUDGET_EXCEEDED',
    );
  });
});
