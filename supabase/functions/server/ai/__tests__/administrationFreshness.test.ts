/**
 * Administrative reads answer with what is in force, not what this isolate
 * happens to remember.
 *
 * The execution path was made isolate-aware first: a request refreshes before
 * the guard runs, so AI stops everywhere. The READ path was not, and that left
 * the console of an emergency kill switch able to report the opposite of the
 * truth during exactly the incident it exists for — operator A halts the
 * platform, operator B's console lands on another isolate and shows AI running.
 *
 * Every test here is the same shape: A changes something, B is asked, and B
 * must answer with A's change without B having served any traffic in between.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_TOKEN, buildTestAdministration } from './harness.ts';
import { buildIsolatePair, createFailingSettingsStore, executeNarrative } from './adminFixtures.ts';
import { createMemorySettingsStore } from '../admin/settingsStore.ts';

const HALT = 'incident 5150: runaway spend, halting AI';

describe('AI administration — reads are fresh across isolates', () => {
  it('reports an engaged kill switch through overview', async () => {
    const { a, b } = await buildIsolatePair();
    const opA = await a.actor(ADMIN_TOKEN.superAdmin);
    const opB = await b.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.setEmergencyStop(opA, true, HALT);

    const overview = await b.admin.overview(opB);
    assert.equal(overview.settings.emergencyStop.engaged, true);
    assert.equal(overview.effective.aiEnabled, false);
    assert.equal(overview.settings.configurationVersion, a.plane.settings.current().configurationVersion);
  });

  it('reports an engaged kill switch through settings', async () => {
    const { a, b } = await buildIsolatePair();
    const opA = await a.actor(ADMIN_TOKEN.superAdmin);
    const opB = await b.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.setEmergencyStop(opA, true, HALT);

    const settings = await b.admin.settings(opB);
    assert.equal(settings.emergencyStop.engaged, true);
    assert.equal(settings.emergencyStop.engagedBy, opA.actorId);
  });

  it('reports an engaged kill switch through diagnostics', async () => {
    const { a, b } = await buildIsolatePair();
    const opA = await a.actor(ADMIN_TOKEN.superAdmin);
    const opB = await b.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.setEmergencyStop(opA, true, HALT);

    const diagnostics = await b.admin.diagnostics(opB);
    assert.equal(
      diagnostics.versions.configurationVersion,
      a.plane.settings.current().configurationVersion,
    );
  });

  it('reports AI stopped through the health snapshot', async () => {
    const { a, b } = await buildIsolatePair();
    const opA = await a.actor(ADMIN_TOKEN.superAdmin);
    const opB = await b.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.setEmergencyStop(opA, true, HALT);

    // The `/ai/health` route refreshes before snapshotting; this is that path.
    await b.plane.refreshSettings();
    const health = b.plane.health();
    assert.equal(health.aiEnabled, false);
    assert.equal(health.emergencyStopEngaged, true);
    assert.equal(health.status, 'unhealthy');
    assert.ok(health.issues.some((issue) => issue.includes('emergency kill switch')));

    // And through the administrative surface, which carries the same snapshot.
    assert.equal((await b.admin.overview(opB)).health.status, 'unhealthy');
  });

  it('reports the latest AI-disabled state', async () => {
    const { a, b } = await buildIsolatePair();
    const opA = await a.actor(ADMIN_TOKEN.superAdmin);
    const opB = await b.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.updateSettings(opA, { aiEnabled: false }, 'planned maintenance');

    assert.equal((await b.admin.settings(opB)).aiEnabled, false);
    assert.equal((await b.admin.overview(opB)).effective.aiEnabled, false);
  });

  it('reports the latest provider and budget configuration', async () => {
    const { a, b } = await buildIsolatePair();
    const opA = await a.actor(ADMIN_TOKEN.superAdmin);
    const opB = await b.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.updateProvider(opA, 'primary', { enabled: false }, 'primary degraded');
    await a.admin.updateSettings(opA, { budget: { actorDailyMicroUsd: 4_321 } }, 'tighten actor cap');

    const views = await b.admin.providers(opB);
    const primary = views.find((view) => view.providerId === 'primary');
    assert.equal(primary?.enabled, false, 'a stale isolate showed a disabled provider as enabled');

    const budget = await b.admin.budget(opB);
    assert.equal(budget.daily.actorDailyMicroUsd, 4_321);
  });

  it('shows a released kill switch as released', async () => {
    const { a, b } = await buildIsolatePair();
    const opA = await a.actor(ADMIN_TOKEN.superAdmin);
    const opB = await b.actor(ADMIN_TOKEN.superAdmin);
    await a.admin.setEmergencyStop(opA, true, HALT);
    assert.equal((await b.admin.settings(opB)).emergencyStop.engaged, true);

    await a.admin.setEmergencyStop(opA, false, 'incident 5150 resolved');
    assert.equal((await b.admin.settings(opB)).emergencyStop.engaged, false);
    assert.equal((await b.admin.overview(opB)).effective.aiEnabled, true);
  });
});

describe('AI administration — a failed refresh keeps the last known state', () => {
  it('keeps a halted platform halted when storage becomes unreachable', async () => {
    const seed = createMemorySettingsStore();
    const first = buildTestAdministration({ settingsStore: seed });
    const seeder = await first.actor(ADMIN_TOKEN.superAdmin);
    await first.admin.setEmergencyStop(seeder, true, HALT);
    const halted = await seed.load();
    assert.ok(halted?.emergencyStop.engaged);

    let reachable = true;
    const flaky = {
      saves: 0,
      load: () => (reachable ? Promise.resolve(halted) : Promise.reject(new Error('kv down'))),
      save: () => Promise.resolve(),
    };
    const harness = buildTestAdministration({ settingsStore: flaky });
    await harness.admin.hydrate();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    assert.equal((await harness.admin.settings(operator)).emergencyStop.engaged, true);

    reachable = false;
    // No fallback to baseline: the last configuration this isolate knew is
    // still the safest thing it can serve, and a reachability problem must not
    // look like an administrator releasing the stop.
    const settings = await harness.admin.settings(operator);
    assert.equal(settings.emergencyStop.engaged, true);
    assert.equal((await harness.admin.overview(operator)).effective.aiEnabled, false);
    assert.equal((await executeNarrative(harness, ADMIN_TOKEN.teamAdmin)).served, false);
  });

  it('does not fall back to baseline when the record cannot be read at all', async () => {
    const unreadable = createFailingSettingsStore(undefined, 'kv down');
    const harness = buildTestAdministration({ settingsStore: unreadable });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.setEmergencyStop(operator, true, HALT).catch(() => undefined);
    // The engage could not persist, so the plane is correctly still running —
    // what matters is that a read does not invent a different answer.
    const settings = await harness.admin.settings(operator);
    assert.equal(settings.emergencyStop.engaged, false);
    assert.equal(settings.configurationVersion, 1);
  });
});

describe('AI administration — hydrate and refresh agree', () => {
  it('produces identical effective settings from one durable record', async () => {
    const shared = createMemorySettingsStore();
    const writer = buildTestAdministration({ settingsStore: shared });
    const operator = await writer.actor(ADMIN_TOKEN.superAdmin);
    await writer.admin.setEmergencyStop(operator, true, HALT);
    await writer.admin.updateSettings(
      operator,
      { retry: { baseDelayMs: 321 }, budget: { actorDailyMicroUsd: 2_222 } },
      'tune the platform',
    );

    const viaHydrate = buildTestAdministration({ settingsStore: shared });
    await viaHydrate.admin.hydrate();

    const viaRefresh = buildTestAdministration({ settingsStore: shared });
    await viaRefresh.plane.refreshSettings();

    assert.deepEqual(
      viaHydrate.plane.settings.current(),
      viaRefresh.plane.settings.current(),
      'the two paths that read one record disagreed about what it means',
    );
  });
});
