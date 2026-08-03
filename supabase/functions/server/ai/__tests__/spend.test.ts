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
  SPEND_SCOPE,
  committedMicroUsd,
  createMemorySpendStore,
  createSpendLedger,
  remainingMicroUsd,
  usdToMicroUsd,
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

  it('defaults the provider preference to mock first', () => {
    assert.equal(loadControlPlaneConfig(recordEnv({})).providerPreference[0], 'mock');
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
});
