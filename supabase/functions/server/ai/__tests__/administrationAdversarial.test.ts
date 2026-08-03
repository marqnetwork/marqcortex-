/**
 * AI administration — adversarial authorization, envelope and narrowing tests.
 *
 * PARTIALLY EXPECTED TO FAIL ON THE CURRENT IMPLEMENTATION. Produced by an
 * independent review of AI-01 Batch 2 and committed as remediation acceptance
 * criteria. Groups are marked with what they are for:
 *
 *   REGRESSION GUARD   behaviour that is correct today. These must keep
 *                      passing through the remediation — several of them pin
 *                      properties a fix in a neighbouring area could easily
 *                      break (a change to capability resolution is one edit
 *                      away from the tenant scoping of reads).
 *
 *   ACCEPTANCE         behaviour the batch claims and does not have. These
 *                      fail today, on purpose.
 *
 * The organising question is the one the review asked: an administrator is
 * trusted, so what can a trusted administrator do that the platform should
 * still refuse? Three answers turned out to matter — act outside their tenant,
 * loosen a bound the deployment set, and apply a narrowing that silently does
 * nothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_TOKEN, buildTestAdministration } from './harness.ts';
import { executeNarrative } from './adminFixtures.ts';
import { effectiveRealRequestsEnabled } from '../runtime/operationalSettings.ts';
import { SPEND_SCOPE, usdToMicroUsd } from '../policy/spendLedger.ts';
import { ADMIN_ACTION } from '../admin/adminAudit.ts';

const REASON = 'incident 4471: steering AI operations';

describe('AI administration — role matrix [REGRESSION GUARD]', () => {
  it('refuses an unauthenticated caller', async () => {
    const harness = buildTestAdministration();
    await assert.rejects(harness.actor('token-that-does-not-exist'));
    await assert.rejects(harness.admin.authorize(null));
  });

  it('refuses an authenticated user holding no administrative role', async () => {
    const harness = buildTestAdministration();
    await assert.rejects(harness.actor(ADMIN_TOKEN.member));
  });

  it('gives a team admin every read and no write', async () => {
    const harness = buildTestAdministration();
    const team = await harness.actor(ADMIN_TOKEN.teamAdmin);
    assert.equal(team.role, 'team_admin');

    assert.ok(harness.admin.settings(team));
    assert.ok(harness.admin.providers(team));
    assert.ok(await harness.admin.budget(team));
    assert.ok(harness.admin.diagnostics(team));

    await assert.rejects(harness.admin.updateSettings(team, { failoverEnabled: false }, REASON));
    await assert.rejects(harness.admin.setEmergencyStop(team, true, REASON));
    await assert.rejects(harness.admin.updateProvider(team, 'primary', { enabled: false }, REASON));
    await assert.rejects(harness.admin.resetSpend(team, REASON));
    await assert.rejects(harness.admin.increaseSpendCap(team, usdToMicroUsd(50), REASON));
  });

  it('does not promote the owner of one organization to platform operator', async () => {
    const harness = buildTestAdministration();
    const owner = await harness.actor(ADMIN_TOKEN.organizationOwner);
    assert.equal(owner.role, 'organization_admin');
    await assert.rejects(harness.admin.resetSpend(owner, REASON));
    await assert.rejects(harness.admin.increaseSpendCap(owner, usdToMicroUsd(50), REASON));
  });

  it('reserves the MARQ ceiling for the platform operator', async () => {
    const harness = buildTestAdministration();
    const org = await harness.actor(ADMIN_TOKEN.organizationAdmin);
    await assert.rejects(harness.admin.resetSpend(org, REASON));
    await assert.rejects(harness.admin.increaseSpendCap(org, usdToMicroUsd(50), REASON));

    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    assert.equal(operator.role, 'super_admin');
    assert.deepEqual(operator.organizationScope, []);
  });
});

describe('AI administration — tenant isolation', () => {
  it('never shows one tenant another tenant execution records [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration();
    await executeNarrative(harness, ADMIN_TOKEN.teamAdmin);

    const globex = await harness.actor(ADMIN_TOKEN.otherOrganizationAdmin);
    assert.deepEqual(globex.organizationScope, ['globex']);
    assert.equal(harness.admin.executionAudit(globex, 50).length, 0);
  });

  it('does not let one tenant admin halt AI for every other tenant [ACCEPTANCE]', async () => {
    const harness = buildTestAdministration();
    const globex = await harness.actor(ADMIN_TOKEN.otherOrganizationAdmin);

    // The emergency stop is platform-wide. An administrator whose scope is one
    // organization must not be able to stop AI for all of them — the same
    // argument the RBAC module uses to justify team admins being read-only.
    await assert.rejects(
      harness.admin.setEmergencyStop(globex, true, REASON),
      'an admin scoped to one tenant engaged the platform-wide emergency stop',
    );
    assert.equal(harness.plane.settings.current().emergencyStop.engaged, false);
  });

  it('does not let one tenant admin disable a provider for every tenant [ACCEPTANCE]', async () => {
    const harness = buildTestAdministration();
    const globex = await harness.actor(ADMIN_TOKEN.otherOrganizationAdmin);

    await assert.rejects(
      harness.admin.updateProvider(globex, 'primary', { enabled: false }, REASON),
      'an admin scoped to one tenant disabled a provider for the whole platform',
    );
    assert.equal(harness.plane.providers.find('primary')?.enabled, true);
  });

  it('does not let one tenant admin pin a model for every tenant [ACCEPTANCE]', async () => {
    const harness = buildTestAdministration();
    const globex = await harness.actor(ADMIN_TOKEN.otherOrganizationAdmin);

    await assert.rejects(
      harness.admin.updateSettings(globex, { defaultModelId: 'mock-standard' }, REASON),
      'an admin scoped to one tenant pinned a model platform-wide',
    );
  });
});

describe('AI administration — the deployment envelope', () => {
  it('cannot enable real requests the deployment withheld [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration({ env: { AI_ALLOW_REAL_REQUESTS: 'false' } });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(operator, { realRequestsEnabled: true }, REASON);

    assert.equal(
      effectiveRealRequestsEnabled(harness.plane.settings.current(), harness.config.allowRealRequests),
      false,
    );
  });

  it('can always withdraw a permission the deployment granted [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration({ env: { AI_ALLOW_REAL_REQUESTS: 'true' } });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    assert.equal(
      effectiveRealRequestsEnabled(harness.plane.settings.current(), harness.config.allowRealRequests),
      true,
    );

    await harness.admin.updateSettings(operator, { realRequestsEnabled: false }, REASON);
    assert.equal(
      effectiveRealRequestsEnabled(harness.plane.settings.current(), harness.config.allowRealRequests),
      false,
    );
  });

  it('cannot switch off certification enforcement the deployment required [ACCEPTANCE]', async () => {
    const harness = buildTestAdministration({ env: { AI_REQUIRE_CERTIFIED_PROVIDERS: 'true' } });
    assert.equal(harness.config.requireCertifiedProviders, true);
    const org = await harness.actor(ADMIN_TOKEN.organizationAdmin);

    await harness.admin.updateSettings(org, { requireCertifiedProviders: false }, REASON).catch(
      () => undefined,
    );

    assert.equal(
      harness.plane.settings.current().requireCertifiedProviders,
      true,
      'the console loosened a certification requirement the deployment set',
    );
  });

  it('cannot switch off budget enforcement the deployment required [ACCEPTANCE]', async () => {
    const harness = buildTestAdministration({ env: { AI_BUDGET_ENFORCE: 'true' } });
    assert.equal(harness.config.budget.enforce, true);
    const org = await harness.actor(ADMIN_TOKEN.organizationAdmin);

    await harness.admin.updateSettings(org, { budget: { enforce: false } }, REASON).catch(
      () => undefined,
    );

    assert.equal(
      harness.plane.settings.current().budget.enforce,
      true,
      'the console disabled budget enforcement the deployment required',
    );
  });

  it('cannot raise a daily ceiling above the deployment value [ACCEPTANCE]', async () => {
    const harness = buildTestAdministration({
      env: { AI_BUDGET_ORG_DAILY_MICRO_USD: '1000' },
    });
    const ceiling = harness.config.budget.organizationDailyMicroUsd;
    const org = await harness.actor(ADMIN_TOKEN.organizationAdmin);

    await harness.admin
      .updateSettings(org, { budget: { organizationDailyMicroUsd: 99_000_000_000 } }, REASON)
      .catch(() => undefined);

    assert.ok(
      harness.plane.settings.current().budget.organizationDailyMicroUsd <= ceiling,
      'the console raised a daily ceiling above the deployment value',
    );
  });

  it('can always tighten a daily ceiling [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration({
      env: { AI_BUDGET_ORG_DAILY_MICRO_USD: '1000' },
    });
    const org = await harness.actor(ADMIN_TOKEN.organizationAdmin);
    await harness.admin.updateSettings(org, { budget: { organizationDailyMicroUsd: 250 } }, REASON);
    assert.equal(harness.plane.settings.current().budget.organizationDailyMicroUsd, 250);
  });
});

describe('AI administration — kill switch and provider behaviour [REGRESSION GUARD]', () => {
  it('stops the very next request and restores service on release', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    assert.equal((await executeNarrative(harness, ADMIN_TOKEN.teamAdmin)).served, true);

    await harness.admin.setEmergencyStop(operator, true, REASON);
    const stopped = await executeNarrative(harness, ADMIN_TOKEN.teamAdmin);
    assert.equal(stopped.served, false);
    if (stopped.served) return;
    assert.equal(stopped.code, 'AI_DISABLED');

    await harness.admin.setEmergencyStop(operator, false, 'incident 4471 resolved');
    assert.equal((await executeNarrative(harness, ADMIN_TOKEN.teamAdmin)).served, true);
  });

  it('fails over to the backup when a provider is disabled', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.updateProvider(operator, 'primary', { enabled: false }, REASON);

    assert.equal((await executeNarrative(harness, ADMIN_TOKEN.teamAdmin)).served, true);
  });

  it('restores the established certification when a provider is re-enabled', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.updateProvider(operator, 'primary', { enabled: false }, REASON);
    await harness.admin.updateProvider(operator, 'primary', { enabled: true }, 'primary recovered');

    assert.equal(harness.plane.providers.find('primary')?.certification, 'certified');
  });

  it('fails closed when every provider is disabled', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.updateProvider(operator, 'primary', { enabled: false }, REASON);
    await harness.admin.updateProvider(operator, 'backup', { enabled: false }, REASON);

    const result = await executeNarrative(harness, ADMIN_TOKEN.teamAdmin);
    assert.equal(result.served, false);
    if (result.served) return;
    assert.equal(result.code, 'NO_PROVIDER_AVAILABLE');
  });

  it('refuses to configure a provider that is not registered', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await assert.rejects(
      harness.admin.updateProvider(operator, 'not-a-provider', { enabled: true }, REASON),
    );
  });
});

describe('AI administration — model allow list [ACCEPTANCE]', () => {
  it('never serves a model outside an administrator allow list', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    const allowList = ['no-such-model'];

    // A remediation may legitimately reject the write instead of applying it.
    // What it may not do is accept the narrowing and then ignore it.
    let rejected = false;
    try {
      await harness.admin.updateProvider(operator, 'primary', { modelAllowList: allowList }, REASON);
    } catch {
      rejected = true;
    }

    if (rejected) {
      assert.deepEqual(harness.plane.settings.current().providers.primary?.modelAllowList, undefined);
      return;
    }

    for (const model of harness.plane.providers.models('primary')) {
      assert.ok(
        allowList.includes(model.modelId),
        `allow list ${allowList.join(',')} was accepted but ${model.modelId} is still served`,
      );
    }
  });

  it('honours an allow list that names a real model [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.updateProvider(
      operator,
      'primary',
      { modelAllowList: ['mock-standard'] },
      REASON,
    );
    const served = harness.plane.providers.models('primary').map((model) => model.modelId);
    assert.deepEqual(served, ['mock-standard']);
  });
});

describe('AI administration — budget operations', () => {
  it('keeps the $9 lifetime ceiling as the default [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    const budget = await harness.admin.budget(operator);
    assert.equal(budget.platform.capMicroUsd, usdToMicroUsd(9));
  });

  it('preserves settled spend and open holds when the ceiling is raised [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    const first = await harness.plane.spendLedger.reserve(
      SPEND_SCOPE.platform,
      usdToMicroUsd(1),
      'hold-1',
      { owner: 'regression' },
    );
    assert.equal(first.granted, true);
    if (!first.granted) return;
    await harness.plane.spendLedger.settle(first.reservation, usdToMicroUsd(0.5));

    const second = await harness.plane.spendLedger.reserve(
      SPEND_SCOPE.platform,
      usdToMicroUsd(0.75),
      'hold-2',
      { owner: 'regression' },
    );
    assert.equal(second.granted, true);

    const raised = await harness.admin.increaseSpendCap(
      operator,
      usdToMicroUsd(20),
      'approved uplift for the pilot',
    );
    assert.equal(raised.platform.capMicroUsd, usdToMicroUsd(20));
    assert.equal(raised.platform.spentMicroUsd, usdToMicroUsd(0.5));
    assert.equal(raised.reservations.openCount, 1);
  });

  it('refuses to lower the ceiling through the increase operation [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await assert.rejects(harness.admin.increaseSpendCap(operator, usdToMicroUsd(1), REASON));
    await assert.rejects(harness.admin.increaseSpendCap(operator, -5, REASON));
    await assert.rejects(harness.admin.increaseSpendCap(operator, Number.NaN, REASON));
  });

  it('retains spend history across an authorised reset [REGRESSION GUARD]', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    const hold = await harness.plane.spendLedger.reserve(
      SPEND_SCOPE.platform,
      usdToMicroUsd(1),
      'hold-1',
    );
    assert.equal(hold.granted, true);
    if (!hold.granted) return;
    await harness.plane.spendLedger.settle(hold.reservation, usdToMicroUsd(0.5));

    const after = await harness.admin.resetSpend(operator, 'quarter close approved by finance');
    assert.equal(after.platform.spentMicroUsd, 0);
    assert.equal(after.platform.lifetimeSpentMicroUsd, usdToMicroUsd(0.5));
    assert.equal(after.resets.at(-1)?.kind, 'reset');
  });

  it('does not let a reset raise the spending ceiling [ACCEPTANCE]', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    const before = await harness.admin.budget(operator);

    // Clearing spend and authorising more money are different decisions with
    // different blast radii. One call must not do both, and must never record a
    // ceiling change under the reset action name.
    const after = await harness.admin
      .resetSpend(operator, 'routine reset', { newCapMicroUsd: usdToMicroUsd(9_000) })
      .catch(() => undefined);

    if (after) {
      assert.equal(
        after.platform.capMicroUsd,
        before.platform.capMicroUsd,
        'a reset raised the MARQ spending ceiling',
      );
    }

    const trail = harness.admin.adminAudit(operator, 10);
    const raised = trail.filter((record) => record.action === ADMIN_ACTION.spendCapRaised);
    const reset = trail.filter((record) => record.action === ADMIN_ACTION.spendReset);
    assert.ok(
      raised.length === 0 || reset.length === 0,
      'one call was recorded as both a reset and a ceiling change',
    );
  });
});

describe('AI administration — rejection auditing [REGRESSION GUARD]', () => {
  it('records a refused administrative access attempt', async () => {
    const harness = buildTestAdministration();
    await harness.admin.authorize(`Bearer ${ADMIN_TOKEN.member}`).catch(() => undefined);

    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    const denied = harness.admin
      .adminAudit(operator, 50)
      .filter((record) => record.action === ADMIN_ACTION.accessDenied);
    assert.ok(denied.length > 0);
    assert.equal(denied[0].outcome, 'rejected');
    assert.equal(denied[0].actorRole, 'unauthorized');
  });

  it('records a mutation refused for want of a capability', async () => {
    const harness = buildTestAdministration();
    const team = await harness.actor(ADMIN_TOKEN.teamAdmin);
    await harness.admin.setEmergencyStop(team, true, REASON).catch(() => undefined);

    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    const rejected = harness.admin
      .adminAudit(operator, 50)
      .filter((record) => record.outcome === 'rejected' && record.actorId === team.actorId);
    assert.ok(rejected.length > 0);
    assert.equal(rejected[0].rejectionCode, 'FORBIDDEN');
  });

  it('records a mutation refused for a missing reason', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.updateSettings(operator, { failoverEnabled: false }, '   ').catch(
      () => undefined,
    );

    const rejected = harness.admin
      .adminAudit(operator, 50)
      .filter((record) => record.rejectionCode === 'VALIDATION_FAILED');
    assert.ok(rejected.length > 0);
  });

  it('exposes no prompt content or credentials on the execution trail', async () => {
    const harness = buildTestAdministration();
    await executeNarrative(harness, ADMIN_TOKEN.teamAdmin);
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    const serialised = JSON.stringify(harness.admin.executionAudit(operator, 50));
    for (const needle of ['Acme Industrial', 'sk-', 'Bearer ', 'apiKey', 'api_key']) {
      assert.equal(serialised.includes(needle), false, `execution audit exposed ${needle}`);
    }
  });
});
