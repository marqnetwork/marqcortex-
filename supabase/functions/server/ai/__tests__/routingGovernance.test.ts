/**
 * AI-01 Batch 4F — routing, failover and economics, through the real plane.
 *
 * The unit suite (`routingPolicy.test.ts`) holds the policy's invariants as a
 * pure function. This one holds what happens when the policy is wired into the
 * execution path, the settings overlay and the administration surface: that a
 * strategy an administrator sets actually steers traffic, that it steers only
 * traffic the eligibility gates already admitted, that the request's paid
 * attempt budget is enforced rather than reported, and that a deployment can
 * cap what an administrator may do with any of it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AIError } from '../contracts/errors.ts';
import { FEATURE } from '../features/index.ts';
import { ADMIN_TOKEN, TEST_TOKEN, buildTestAdministration, buildTestPlane, narrativeInput } from './harness.ts';
import { parseStoredSettings } from '../admin/settingsStore.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { applyEnvelope, envelopeAdjustments, envelopeFrom } from '../runtime/envelope.ts';
import { baselineSettings, normalizeOperationalSettings } from '../runtime/operationalSettings.ts';

const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
/**
 * The administration harness authenticates the ROLE tokens, so a request that
 * exercises execution alongside administration presents one of those. It is a
 * caller here, not an operator: the AI Guard resolves it as an ordinary
 * authenticated subject, and nothing about being an administrator changes what
 * `plane.execute` will do for it.
 */
const ADMIN_CALLER = { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` };
const REASON = 'batch 4f routing verification';

function envelope(featureId: string, input: unknown) {
  return { featureId, input, channel: 'team_console' as const };
}

/** A plane whose two mocks charge, so the economics and the budget are real. */
function billablePlane(overrides: Record<string, string> = {}) {
  return buildTestPlane({
    billableProviders: true,
    env: { AI_ALLOW_REAL_REQUESTS: 'true', ...overrides },
    pricing: {
      primary: { promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 },
      backup: { promptMicroUsdPer1k: 100, completionMicroUsdPer1k: 200 },
    },
  });
}

describe('Batch 4F — the default strategy changes nothing', () => {
  it('serves from the preference order with no routing configured', async () => {
    const { plane } = buildTestPlane();
    const result = await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    assert.equal(result.execution.providerId, 'primary');
    assert.equal(plane.settings.current().routing.strategy, 'preference');
  });

  it('routes on preference even when the dearer provider is first', async () => {
    const { plane } = billablePlane();
    const result = await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    assert.equal(
      result.execution.providerId,
      'primary',
      'the default strategy must not start optimising on cost by itself',
    );
  });

  it('hydrates a settings record written before this batch existed', () => {
    const config = loadControlPlaneConfig(recordEnv({}));
    // Exactly the shape a pre-4F isolate persisted: no `routing` key at all.
    const { settings } = parseStoredSettings(
      { configurationVersion: 7, aiEnabled: true, failoverEnabled: true },
      config,
      '2026-01-01T00:00:00.000Z',
    );
    assert.equal(settings.routing.strategy, 'preference');
    assert.equal(settings.routing.maxProviders, config.routing.maxProviders);
  });
});

describe('Batch 4F — an administrator steers, within what the gates allow', () => {
  it('routes to the cheaper provider once the cost strategy is in force', async () => {
    const harness = buildTestAdministration({
      billableProviders: true,
      keylessProviders: true,
      env: { AI_ALLOW_REAL_REQUESTS: 'true' },
      pricing: {
        primary: { promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 },
        backup: { promptMicroUsdPer1k: 100, completionMicroUsdPer1k: 200 },
      },
    });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    const before = await harness.plane.execute(
      envelope(FEATURE.narrative, narrativeInput()),
      ADMIN_CALLER,
    );
    assert.equal(before.execution.providerId, 'primary');

    await harness.admin.updateSettings(operator, { routing: { strategy: 'cost' } }, REASON);

    const after = await harness.plane.execute(
      envelope(FEATURE.narrative, narrativeInput()),
      ADMIN_CALLER,
    );
    assert.equal(after.execution.providerId, 'backup', 'the cost strategy did not take effect');
  });

  it('cannot route to a provider an administrator disabled, under any strategy', async () => {
    const harness = buildTestAdministration({
      billableProviders: true,
      keylessProviders: true,
      env: { AI_ALLOW_REAL_REQUESTS: 'true' },
      pricing: {
        primary: { promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 },
        backup: { promptMicroUsdPer1k: 100, completionMicroUsdPer1k: 200 },
      },
    });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    // The cheapest provider on the platform, turned off. A cost strategy that
    // could reach it would be an eligibility bypass wearing an economics hat.
    await harness.admin.updateProvider(operator, 'backup', { enabled: false }, REASON);
    await harness.admin.updateSettings(operator, { routing: { strategy: 'cost' } }, REASON);

    const result = await harness.plane.execute(
      envelope(FEATURE.narrative, narrativeInput()),
      ADMIN_CALLER,
    );
    assert.equal(result.execution.providerId, 'primary');
  });

  it('demands the provider grant for a strategy change', async () => {
    const harness = buildTestAdministration();
    const teamAdmin = await harness.actor(ADMIN_TOKEN.teamAdmin);
    await assert.rejects(
      harness.admin.updateSettings(teamAdmin, { routing: { strategy: 'cost' } }, REASON),
      (error: AIError) => error.code === 'FORBIDDEN',
    );
    const organizationAdmin = await harness.actor(ADMIN_TOKEN.organizationAdmin);
    await assert.rejects(
      harness.admin.updateSettings(organizationAdmin, { routing: { strategy: 'cost' } }, REASON),
      (error: AIError) => error.code === 'FORBIDDEN',
    );
  });

  it('records the routing change on the administrative trail', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.updateSettings(
      operator,
      { routing: { strategy: 'resilience', maxProviders: 2 } },
      REASON,
    );
    const record = harness.admin.adminAudit(operator, 5)[0];
    assert.equal(String(record.after?.routingStrategy), 'resilience');
    assert.equal(String(record.after?.routingMaxProviders), '2');
  });

  it('keeps the current strategy when the value is not one the platform declares', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.updateSettings(operator, { routing: { strategy: 'cost' } }, REASON);
    const settings = await harness.admin.updateSettings(
      operator,
      { routing: { strategy: 'cheapest-possible' as never } },
      REASON,
    );
    assert.equal(
      settings.routing.strategy,
      'cost',
      'an unrecognised strategy must not silently re-steer a deliberate choice',
    );
  });
});

describe('Batch 4F — the deployment bounds the failover breadth', () => {
  it('caps an administrator to the deployment ceiling and says so', () => {
    const config = loadControlPlaneConfig(recordEnv({ AI_ROUTING_MAX_PROVIDERS: '2' }));
    const baseline = baselineSettings(config, '2026-01-01T00:00:00.000Z');
    const requested = normalizeOperationalSettings(baseline, { routing: { maxProviders: 6 } });
    const applied = applyEnvelope(requested, envelopeFrom(config));

    assert.equal(requested.routing.maxProviders, 6, 'normalisation applies only absolute bounds');
    assert.equal(applied.routing.maxProviders, 2, 'the envelope applies the deployment ceiling');
    assert.match(
      envelopeAdjustments(requested, applied).join(' '),
      /failover breadth capped at 2/,
    );
  });

  it('lets an administrator tighten the breadth freely', () => {
    const config = loadControlPlaneConfig(recordEnv({ AI_ROUTING_MAX_PROVIDERS: '4' }));
    const baseline = baselineSettings(config, '2026-01-01T00:00:00.000Z');
    const applied = applyEnvelope(
      normalizeOperationalSettings(baseline, { routing: { maxProviders: 1 } }),
      envelopeFrom(config),
    );
    assert.equal(applied.routing.maxProviders, 1);
  });

  it('does not fail over past the breadth, even when a second provider could serve', async () => {
    const { plane, provider } = buildTestPlane({ env: { AI_ROUTING_MAX_PROVIDERS: '1' } });
    provider.setScenario('unavailable');
    await assert.rejects(
      () => plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH),
      (error: AIError) => error.code === 'PROVIDER_UNAVAILABLE',
    );
  });

  it('still fails over inside the breadth', async () => {
    const { plane, provider } = buildTestPlane({ env: { AI_ROUTING_MAX_PROVIDERS: '2' } });
    provider.setScenario('unavailable');
    const result = await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    assert.equal(result.execution.providerId, 'backup');
  });
});

describe("Batch 4F — the request's billable attempt budget", () => {
  it('does not grant a fresh paid allowance to every failover candidate', async () => {
    // THE DEFECT THIS CLOSES. `cortex.narrative` permits two attempts and the
    // spend guard reserves for two. Before this batch the loop granted two to
    // EVERY candidate, so two paid providers meant four paid attempts against a
    // hold that covered two.
    const { plane, provider, backup } = billablePlane();
    provider.setScenario('unavailable');

    await assert.rejects(
      () => plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH),
      (error: AIError) => error.code === 'PROVIDER_UNAVAILABLE',
    );

    assert.equal(provider.calls.length, 2, 'the primary spent the whole paid allowance');
    assert.equal(backup.calls.length, 0, 'the backup was never dialled on a spent budget');

    const outcome = plane.routing.recent(1)[0];
    assert.equal(outcome.budgetExhausted, true);
    assert.equal(outcome.billableAttempts, 2);
    assert.equal(outcome.outcome, 'failure');
  });

  it('still fails over when the budget has room', async () => {
    const { plane, provider, backup } = billablePlane();
    // A vendor rejection that is failoverable but not retryable: one paid
    // attempt on the primary, leaving one for the backup.
    provider.setScenario('auth_failed');

    const result = await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);

    assert.equal(result.execution.providerId, 'backup');
    assert.equal(provider.calls.length, 1);
    assert.equal(backup.calls.length, 1);
    assert.equal(plane.routing.recent(1)[0].budgetExhausted, false);
  });

  it('does not spend the paid budget on a provider that charges nothing', async () => {
    // The mock is the last resort by design, and a total vendor outage must
    // still degrade to something rather than nothing.
    const { plane, provider, backup } = buildTestPlane();
    provider.setScenario('unavailable');

    const result = await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);

    assert.equal(result.execution.providerId, 'backup');
    assert.equal(provider.calls.length, 2, 'the free primary retried its full allowance');
    assert.equal(backup.calls.length, 1);
  });
});

describe('Batch 4F — the routing view', () => {
  it('reports the strategy, the breadth and the reconciled economics', async () => {
    const harness = buildTestAdministration({
      billableProviders: true,
      keylessProviders: true,
      env: { AI_ALLOW_REAL_REQUESTS: 'true' },
      pricing: {
        primary: { promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 },
        backup: { promptMicroUsdPer1k: 100, completionMicroUsdPer1k: 200 },
      },
    });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.plane.execute(envelope(FEATURE.narrative, narrativeInput()), ADMIN_CALLER);

    const view = harness.admin.routing(operator);
    assert.equal(view.strategy, 'preference');
    assert.equal(view.maxProviders, harness.config.routing.maxProviders);
    assert.equal(view.deploymentMaxProviders, harness.config.routing.maxProviders);
    assert.equal(view.summary.executions, 1);
    assert.equal(view.summary.decisions, 1);
    assert.equal(view.recent[0].servedProviderId, 'primary');
    assert.ok(
      view.recent[0].premiumMicroUsd > 0,
      'preferring the dearer provider is a premium, and it is measured',
    );
  });

  it('reports no premium once the platform is routing on cost', async () => {
    const harness = buildTestAdministration({
      billableProviders: true,
      keylessProviders: true,
      env: { AI_ALLOW_REAL_REQUESTS: 'true' },
      pricing: {
        primary: { promptMicroUsdPer1k: 2_500, completionMicroUsdPer1k: 10_000 },
        backup: { promptMicroUsdPer1k: 100, completionMicroUsdPer1k: 200 },
      },
    });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.updateSettings(operator, { routing: { strategy: 'cost' } }, REASON);
    await harness.plane.execute(envelope(FEATURE.narrative, narrativeInput()), ADMIN_CALLER);

    const view = harness.admin.routing(operator);
    assert.equal(view.strategy, 'cost');
    assert.equal(view.recent[0].premiumMicroUsd, 0);
    assert.equal(view.recent[0].servedProviderId, 'backup');
  });

  it('carries no prompt, completion or credential on a routing record', async () => {
    const harness = buildTestAdministration({ keylessProviders: true });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.plane.execute(envelope(FEATURE.narrative, narrativeInput()), ADMIN_CALLER);

    const serialized = JSON.stringify(harness.admin.routing(operator));
    for (const forbidden of ['apiKey', 'api_key', 'secret', 'credential', 'messages', 'prompt']) {
      assert.ok(
        !serialized.toLowerCase().includes(forbidden.toLowerCase()),
        `the routing view leaked ${forbidden}`,
      );
    }
  });

  it('refuses a caller with no administrative grant at all', async () => {
    const harness = buildTestAdministration();
    await assert.rejects(
      harness.actor(ADMIN_TOKEN.member).then((actor) => harness.admin.routing(actor)),
      (error: AIError) => error.code === 'FORBIDDEN',
    );
  });
});
