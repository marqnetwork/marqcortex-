/**
 * AI administration — durability, propagation and concurrency.
 *
 * THESE TESTS ARE EXPECTED TO FAIL ON THE CURRENT IMPLEMENTATION. They were
 * produced by an independent review of AI-01 Batch 2 and are committed as the
 * acceptance criteria for its remediation, not as a description of what the
 * platform does today. Do not relax an assertion here to make the suite green:
 * the suite going green IS the remediation.
 *
 * WHY 465 PASSING AI TESTS DID NOT CATCH ANY OF THIS.
 *
 * Every administration test that shipped with Batch 2 builds one control plane
 * in one process, changes a setting through it, and asserts on the same plane.
 * Under that shape the settings overlay is trivially correct — it is the same
 * object on both sides of the assertion. The defects below are all invisible
 * to it, because each one needs either a SECOND plane over the same durable
 * store, or a durable write that FAILS, and the existing harness produces
 * neither.
 *
 * The three groups map to the three blocking findings:
 *
 *   Propagation   an administrator's change reaches the isolate they happened
 *                 to talk to, and no other. The kill switch is the case that
 *                 matters: it is the platform's last defence against runaway
 *                 provider spend, and it currently stops one isolate.
 *
 *   Concurrency   settings are persisted by whole-record overwrite with no
 *                 precondition, so an unrelated edit from a second isolate
 *                 reverts an engaged kill switch, and two different
 *                 configurations are written under the same version number.
 *
 *   Ordering      the overlay is mutated before the durable write is attempted
 *                 and is not rolled back when that write fails, so a change the
 *                 operator was told had failed is live until the isolate
 *                 recycles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_TOKEN, buildTestAdministration } from './harness.ts';
import {
  NO_STORED_VERSION,
  createMemorySettingsStore,
  settingsConflict,
} from '../admin/settingsStore.ts';
import { AIError } from '../contracts/errors.ts';
import {
  buildIsolatePair,
  createFailingSettingsStore,
  createGatedSettingsStore,
  createRecordingSettingsStore,
  executeNarrative,
} from './adminFixtures.ts';

const HALT_REASON = 'incident 4471: runaway provider spend, stopping AI';
const TUNE_REASON = 'routine: widen retry backoff for a flaky upstream';

describe('AI administration — settings propagation across isolates', () => {
  it('stops AI on EVERY isolate when the kill switch is engaged', async () => {
    const { a, b } = await buildIsolatePair();

    // Both isolates are serving before the incident.
    assert.equal((await executeNarrative(a, ADMIN_TOKEN.teamAdmin)).served, true);
    assert.equal((await executeNarrative(b, ADMIN_TOKEN.teamAdmin)).served, true);

    const operator = await a.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.setEmergencyStop(operator, true, HALT_REASON);

    const onA = await executeNarrative(a, ADMIN_TOKEN.teamAdmin);
    const onB = await executeNarrative(b, ADMIN_TOKEN.teamAdmin);

    assert.equal(onA.served, false, 'the isolate that served the admin request must stop');
    // The one that matters. An emergency stop that depends on which isolate a
    // console request was routed to is not an emergency stop.
    assert.equal(
      onB.served,
      false,
      'a warm isolate that did not serve the admin request kept calling providers',
    );
    if (onB.served) return;
    assert.equal(onB.code, 'AI_DISABLED');
  });

  it('disables AI on every isolate when the master switch is turned off', async () => {
    const { a, b } = await buildIsolatePair();
    const operator = await a.actor(ADMIN_TOKEN.superAdmin);

    await a.admin.updateSettings(operator, { aiEnabled: false }, 'planned maintenance window');

    const onB = await executeNarrative(b, ADMIN_TOKEN.teamAdmin);
    assert.equal(onB.served, false, 'a second isolate ignored the master switch');
  });

  it('removes a disabled provider from rotation on every isolate', async () => {
    const { a, b } = await buildIsolatePair();
    const operator = await a.actor(ADMIN_TOKEN.superAdmin);

    await a.admin.updateProvider(operator, 'primary', { enabled: false }, 'primary is degraded');

    // B picks the change up when it next serves traffic. Cross-process
    // propagation cannot be synchronous, so "by B's next request" is both the
    // strongest achievable guarantee and the operationally meaningful one — B
    // must never route a request to a provider an operator has disabled.
    await executeNarrative(b, ADMIN_TOKEN.teamAdmin);

    assert.equal(
      b.plane.providers.find('primary')?.enabled,
      false,
      'a second isolate still considers a disabled provider eligible',
    );
  });

  it('applies a budget change on every isolate', async () => {
    const { a, b } = await buildIsolatePair();
    const operator = await a.actor(ADMIN_TOKEN.superAdmin);

    await a.admin.updateSettings(
      operator,
      { budget: { actorDailyMicroUsd: 12_345 } },
      'tighten per-actor allowance for the pilot',
    );

    await executeNarrative(b, ADMIN_TOKEN.teamAdmin);

    assert.equal(
      b.plane.settings.current().budget.actorDailyMicroUsd,
      12_345,
      'a second isolate is enforcing a stale budget',
    );
  });

  it('reports the same configuration version from every isolate', async () => {
    const { a, b } = await buildIsolatePair();
    const operator = await a.actor(ADMIN_TOKEN.superAdmin);

    await a.admin.setEmergencyStop(operator, true, HALT_REASON);
    await executeNarrative(b, ADMIN_TOKEN.teamAdmin);

    // An operator correlating an incident with a configuration version must not
    // get a different answer depending on which isolate answers the health probe.
    assert.equal(
      b.plane.health().configurationVersion,
      a.plane.health().configurationVersion,
      'two isolates report different configuration versions for one platform',
    );
  });
});

describe('AI administration — concurrent administrators', () => {
  it('does not let an unrelated edit revert an engaged kill switch', async () => {
    const { a, b, store } = await buildIsolatePair();
    const operatorA = await a.actor(ADMIN_TOKEN.superAdmin);
    const operatorB = await b.actor(ADMIN_TOKEN.superAdmin);

    // A halts the platform during an incident.
    await a.admin.setEmergencyStop(operatorA, true, HALT_REASON);
    // B, on another isolate, makes a routine change that has nothing to do with
    // the incident and never mentions the emergency stop.
    await b.admin.updateSettings(operatorB, { retry: { baseDelayMs: 99 } }, TUNE_REASON);

    const persisted = await store.load();
    assert.ok(persisted, 'settings should have been persisted');
    if (!persisted) return;

    assert.equal(
      persisted.emergencyStop.engaged,
      true,
      'a routine retry change silently released an engaged emergency stop',
    );
    // B's change is legitimate and should survive too — the requirement is a
    // merge or a rejected conflict, never a silent overwrite.
    assert.equal(persisted.retry.baseDelayMs, 99, "the second administrator's change was lost");
  });

  it('refuses or merges a write built on a stale configuration version', async () => {
    const { a, b, store } = await buildIsolatePair();
    const operatorA = await a.actor(ADMIN_TOKEN.superAdmin);
    const operatorB = await b.actor(ADMIN_TOKEN.superAdmin);

    const staleVersion = b.plane.settings.current().configurationVersion;
    await a.admin.setEmergencyStop(operatorA, true, HALT_REASON);

    // B is now demonstrably stale: it never observed A's write.
    assert.equal(
      b.plane.settings.current().configurationVersion,
      staleVersion,
      'precondition: B has not observed A',
    );

    // Either outcome is acceptable — a rejected conflict, or a merge that keeps
    // both changes. What is not acceptable is a silent last-write-wins.
    let conflicted = false;
    try {
      await b.admin.updateSettings(operatorB, { failoverEnabled: false }, TUNE_REASON);
    } catch {
      conflicted = true;
    }

    const persisted = await store.load();
    assert.ok(persisted);
    if (!persisted) return;

    if (!conflicted) {
      assert.equal(
        persisted.emergencyStop.engaged,
        true,
        'a stale write was accepted and discarded a newer safety-critical change',
      );
    }
  });

  it('never writes two different configurations under one version number', async () => {
    const store = createRecordingSettingsStore();
    const { a, b } = await buildIsolatePair({ settingsStore: store });
    const operatorA = await a.actor(ADMIN_TOKEN.superAdmin);
    const operatorB = await b.actor(ADMIN_TOKEN.superAdmin);

    await a.admin.setEmergencyStop(operatorA, true, HALT_REASON);
    await b.admin.updateSettings(operatorB, { retry: { baseDelayMs: 77 } }, TUNE_REASON);

    const { versions } = store;
    assert.equal(versions.length, 2, 'both writes should have reached storage');
    assert.equal(
      new Set(versions).size,
      versions.length,
      `two configurations were persisted under the same version: ${versions.join(', ')}`,
    );
    for (let index = 1; index < versions.length; index += 1) {
      assert.ok(
        versions[index] > versions[index - 1],
        `configuration version must increase monotonically, saw ${versions.join(' -> ')}`,
      );
    }
  });

  it('serialises two interleaved writes on one isolate without losing either', async () => {
    const store = createGatedSettingsStore();
    const harness = buildTestAdministration({ settingsStore: store });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    // A's write is held open inside durable storage, guaranteeing B reads and
    // writes while A is still in flight.
    const halting = harness.admin.setEmergencyStop(operator, true, HALT_REASON);
    await new Promise((resolve) => setImmediate(resolve));
    const tuning = harness.admin.updateSettings(operator, { retry: { baseDelayMs: 42 } }, TUNE_REASON);
    await new Promise((resolve) => setImmediate(resolve));
    store.releaseFirstWrite();
    await Promise.allSettled([halting, tuning]);

    const persisted = store.peek();
    assert.ok(persisted, 'a write should have landed');
    if (!persisted) return;
    assert.equal(
      persisted.emergencyStop.engaged,
      true,
      'the emergency stop was lost to an interleaved write',
    );
    assert.equal(persisted.retry.baseDelayMs, 42, 'the retry change was lost');
  });
});

describe('AI administration — persistence ordering', () => {
  it('does not apply a settings change whose durable write failed', async () => {
    const store = createFailingSettingsStore();
    const harness = buildTestAdministration({ settingsStore: store });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    const before = harness.plane.settings.current();
    assert.equal(before.aiEnabled, true);

    await assert.rejects(
      harness.admin.updateSettings(operator, { aiEnabled: false }, 'maintenance window'),
      'a failed durable write must surface as an error',
    );

    const after = harness.plane.settings.current();
    assert.equal(store.saves, 1, 'precondition: storage was asked and refused');
    // The operator was told the change failed. If it is live anyway, the console
    // and the platform disagree about whether AI is running.
    assert.equal(
      after.aiEnabled,
      true,
      'a change the operator was told had failed is live on this isolate',
    );
    assert.equal(
      after.configurationVersion,
      before.configurationVersion,
      'a failed change consumed a configuration version',
    );
  });

  it('does not release an engaged kill switch when the durable write fails', async () => {
    // The dangerous direction. An operator tries to RELEASE the stop, is told
    // the change failed, and walks away believing AI is still halted — while
    // this isolate has already resumed calling providers.
    const seeding = createMemorySettingsStore();
    const first = buildTestAdministration({ settingsStore: seeding });
    const seedOperator = await first.actor(ADMIN_TOKEN.superAdmin);
    await first.admin.setEmergencyStop(seedOperator, true, HALT_REASON);
    const halted = await seeding.load();
    assert.ok(halted?.emergencyStop.engaged, 'precondition: a halted configuration was stored');

    // A fresh isolate loads the halted posture, then loses its ability to write.
    const store = createFailingSettingsStore(halted);
    const harness = buildTestAdministration({ settingsStore: store });
    await harness.admin.hydrate();
    assert.equal(harness.plane.settings.current().emergencyStop.engaged, true);
    assert.equal((await executeNarrative(harness, ADMIN_TOKEN.teamAdmin)).served, false);

    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await assert.rejects(
      harness.admin.setEmergencyStop(operator, false, 'incident 4471 believed resolved'),
      'a failed durable write must surface as an error',
    );

    assert.equal(
      harness.plane.settings.current().emergencyStop.engaged,
      true,
      'a release the operator was told had failed took effect anyway',
    );
    assert.equal(
      (await executeNarrative(harness, ADMIN_TOKEN.teamAdmin)).served,
      false,
      'AI resumed serving after a release that was reported as failed',
    );
  });

  it('keeps the plane on the deployment baseline when storage cannot be read', async () => {
    // Not a defect — the current behaviour is correct and this pins it, so a
    // remediation that reorders `commit` cannot regress it by accident.
    const unreadable = {
      load: () => Promise.reject(new Error('kv unavailable')),
      save: () => Promise.resolve(),
      saves: 0,
    };
    const harness = buildTestAdministration({ settingsStore: unreadable });
    const hydrated = await harness.admin.hydrate();
    assert.equal(hydrated.aiEnabled, true);
    assert.equal(hydrated.emergencyStop.engaged, false);
    assert.equal((await executeNarrative(harness, ADMIN_TOKEN.teamAdmin)).served, true);
  });
});

describe('AI administration — compare-and-swap and cache freshness', () => {
  it('rejects a save whose expected version is stale', async () => {
    const store = createMemorySettingsStore();
    const harness = buildTestAdministration({ settingsStore: store });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.setEmergencyStop(operator, true, HALT_REASON);

    const stored = await store.load();
    assert.ok(stored);
    if (!stored) return;

    // Anything that did not observe the current version is refused outright.
    // This is the primitive every other concurrency guarantee is built on.
    await assert.rejects(
      store.save(stored, NO_STORED_VERSION),
      (error: unknown) => error instanceof AIError && error.code === 'CONFLICT',
    );
    await assert.rejects(
      store.save(stored, stored.configurationVersion - 1),
      (error: unknown) => error instanceof AIError && error.code === 'CONFLICT',
    );
    // The version it actually observed is accepted.
    await store.save({ ...stored, configurationVersion: stored.configurationVersion + 1 }, stored.configurationVersion);
  });

  it('surfaces a typed CONFLICT when a contended write cannot be applied', async () => {
    // A store that never agrees, so every retry loses. The service must give up
    // and say so rather than spinning or silently reporting success.
    const alwaysContended = {
      saves: 0,
      load: () => Promise.resolve(undefined),
      save: () => Promise.reject(settingsConflict(0, 99)),
    };
    const harness = buildTestAdministration({ settingsStore: alwaysContended });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    const error = await harness.admin
      .updateSettings(operator, { failoverEnabled: false }, 'contended change')
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    assert.ok(error instanceof AIError, 'a contended write must surface an AIError');
    if (!(error instanceof AIError)) return;
    assert.equal(error.code, 'CONFLICT');
    assert.equal(error.status, 409);
    // And nothing was applied, because nothing was ever persisted.
    assert.equal(harness.plane.settings.current().failoverEnabled, true);
  });

  it('records a rejected contended write on the administrative trail', async () => {
    const alwaysContended = {
      saves: 0,
      load: () => Promise.resolve(undefined),
      save: () => Promise.reject(settingsConflict(0, 99)),
    };
    const harness = buildTestAdministration({ settingsStore: alwaysContended });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin
      .updateSettings(operator, { failoverEnabled: false }, 'contended change')
      .catch(() => undefined);

    const rejected = harness.admin
      .adminAudit(operator, 20)
      .filter((record) => record.rejectionCode === 'CONFLICT');
    assert.ok(rejected.length > 0, 'a lost race must be visible on the trail');
  });

  it('serves a cached copy for the refresh interval, then re-reads', async () => {
    // A deployment that raises AI_SETTINGS_REFRESH_MS is choosing to trade
    // freshness for key-value reads. This pins what it is buying: the change is
    // invisible until the interval elapses, and visible immediately after.
    const { a, b } = await buildIsolatePair({ env: { AI_SETTINGS_REFRESH_MS: '5000' } });
    const operator = await a.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.setEmergencyStop(operator, true, HALT_REASON);

    // Inside the interval B is entitled to its cached answer.
    assert.equal((await executeNarrative(b, ADMIN_TOKEN.teamAdmin)).served, true);

    b.clock.advance(5_000);
    const afterExpiry = await executeNarrative(b, ADMIN_TOKEN.teamAdmin);
    assert.equal(afterExpiry.served, false, 'a stale cache never expired');
    if (afterExpiry.served) return;
    assert.equal(afterExpiry.code, 'AI_DISABLED');
  });

  it('never adopts a configuration older than the one it already holds', async () => {
    // A slow read that lands after a local write must not undo it. Versions are
    // globally unique, so "older" is unambiguous and the rule is simply that
    // refresh only ever moves forwards.
    const store = createMemorySettingsStore();
    const harness = buildTestAdministration({ settingsStore: store });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.setEmergencyStop(operator, true, HALT_REASON);

    const current = harness.plane.settings.current();
    // Storage rolls back to an older configuration behind the plane's back.
    await store.save(
      { ...current, configurationVersion: 1, emergencyStop: { engaged: false } },
      current.configurationVersion,
    );

    await harness.plane.refreshSettings();
    assert.equal(
      harness.plane.settings.current().emergencyStop.engaged,
      true,
      'a stale durable record undid a newer local configuration',
    );
  });
});
