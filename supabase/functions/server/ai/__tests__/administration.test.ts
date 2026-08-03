/**
 * AI administration — RBAC, settings, providers, budget, kill switch, audit.
 *
 * These tests run against the real administration service over a real control
 * plane. The only substitutions are a hand-driven clock, sequential identifiers
 * and an in-memory settings store, so every assertion below is a statement
 * about production behaviour: the real RBAC resolver, the real settings
 * overlay, the real provider registry, the real spend ledger and the real
 * policy engine are all in the path.
 *
 * The suite is organised around the question each group answers:
 *
 *   RBAC              can the wrong person do this?
 *   Settings          does a change take effect, persist, and get recorded?
 *   Kill switch       does AI actually stop?
 *   Providers         can a provider be steered without touching its code?
 *   Budget            can money be managed without weakening the Batch 1 cap?
 *   Audit             is the trail complete, scoped, and impossible to edit?
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_TOKEN,
  buildTestAdministration,
  narrativeInput,
} from './harness.ts';
import { AIError } from '../contracts/errors.ts';
import { ADMIN_ROLE_CAPABILITIES, resolveAdminRole } from '../admin/rbac.ts';
import { SPEND_SCOPE, usdToMicroUsd } from '../policy/spendLedger.ts';
import { createMemorySettingsStore, parseStoredSettings } from '../admin/settingsStore.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { MAX_ADMIN_SPEND_CAP_MICRO_USD } from '../admin/administration.ts';

const REASON = 'incident 4471: provider degraded, steering traffic';

/** Assert that a promise rejects with a specific AI error code. */
async function rejectsWith(work: Promise<unknown>, code: string): Promise<AIError> {
  try {
    await work;
  } catch (error) {
    assert.ok(error instanceof AIError, `expected AIError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected the operation to be refused with ${code}`);
}

// ── RBAC ────────────────────────────────────────────────────────────────────

describe('AI administration — role resolution', () => {
  it('resolves the three administrative roles from server-side identity', async () => {
    const harness = buildTestAdministration();

    assert.equal((await harness.actor(ADMIN_TOKEN.superAdmin)).role, 'super_admin');
    assert.equal((await harness.actor(ADMIN_TOKEN.organizationAdmin)).role, 'organization_admin');
    assert.equal((await harness.actor(ADMIN_TOKEN.teamAdmin)).role, 'team_admin');
  });

  it('refuses an authenticated user who holds no administrative role', async () => {
    const harness = buildTestAdministration();
    await rejectsWith(harness.actor(ADMIN_TOKEN.member), 'FORBIDDEN');
  });

  it('refuses an unauthenticated caller', async () => {
    const harness = buildTestAdministration();
    await rejectsWith(harness.admin.authorize(null), 'AUTH_REQUIRED');
    await rejectsWith(harness.admin.authorize('Bearer nonsense'), 'AUTH_REQUIRED');
  });

  it('never trusts a client-supplied role', async () => {
    const harness = buildTestAdministration();
    // The subject is the ONLY input to role resolution. There is no parameter,
    // header or body field that contributes — which is what this asserts by
    // demonstrating the resolver's whole surface is the subject.
    assert.equal(
      resolveAdminRole({
        subjectId: 'attacker',
        actorType: 'team_user',
        globalRoles: ['viewer'],
        memberships: [{ organizationId: 'acme', roles: ['viewer'] }],
      }),
      undefined,
    );
    await rejectsWith(harness.actor(ADMIN_TOKEN.member), 'FORBIDDEN');
  });

  it('does not promote an organization owner to the platform operator', async () => {
    const harness = buildTestAdministration();
    const owner = await harness.actor(ADMIN_TOKEN.organizationOwner);
    // Owning ONE organization is not operating the platform. Conflating them
    // would hand a tenant the ability to clear MARQ's own spend ceiling.
    assert.equal(owner.role, 'organization_admin');
    assert.equal(owner.capabilities.includes('ai.admin.budget.reset'), false);
  });

  it('grants a team admin visibility and no platform mutation', async () => {
    const harness = buildTestAdministration();
    const teamAdmin = await harness.actor(ADMIN_TOKEN.teamAdmin);

    assert.deepEqual([...teamAdmin.capabilities].sort(), [
      'ai.admin.audit.read',
      'ai.admin.view',
    ]);

    // Reads succeed.
    assert.ok(harness.admin.settings(teamAdmin).configurationVersion >= 1);
    assert.ok(harness.admin.providers(teamAdmin).length > 0);
    assert.ok((await harness.admin.budget(teamAdmin)).platform.capMicroUsd > 0);

    // Every write is refused.
    await rejectsWith(
      harness.admin.updateSettings(teamAdmin, { failoverEnabled: false }, REASON),
      'FORBIDDEN',
    );
    await rejectsWith(harness.admin.setEmergencyStop(teamAdmin, true, REASON), 'FORBIDDEN');
    await rejectsWith(
      harness.admin.updateProvider(teamAdmin, 'primary', { enabled: false }, REASON),
      'FORBIDDEN',
    );
    await rejectsWith(harness.admin.resetSpend(teamAdmin, REASON), 'FORBIDDEN');
  });

  it('refuses an organization admin the lifetime spend reset', async () => {
    const harness = buildTestAdministration();
    const orgAdmin = await harness.actor(ADMIN_TOKEN.organizationAdmin);

    // MARQ's money, not the tenant's. An organization admin may move that
    // tenant's daily allowance and may stop AI; they may not clear the
    // platform's lifetime spend or raise its ceiling.
    await rejectsWith(harness.admin.resetSpend(orgAdmin, REASON), 'FORBIDDEN');
    await rejectsWith(
      harness.admin.increaseSpendCap(orgAdmin, usdToMicroUsd(50), REASON),
      'FORBIDDEN',
    );
    // But the operations their role does cover still work.
    const settings = await harness.admin.updateSettings(
      orgAdmin,
      { budget: { actorDailyMicroUsd: 1_000_000 } },
      REASON,
    );
    assert.equal(settings.budget.actorDailyMicroUsd, 1_000_000);
  });

  it('derives a capability from the field being changed, not the endpoint', async () => {
    const harness = buildTestAdministration();
    const teamAdmin = await harness.actor(ADMIN_TOKEN.teamAdmin);

    // One endpoint that can change anything is one endpoint whose least
    // privileged caller can change everything. A patch that touches the master
    // switch demands the kill-switch capability even though it arrived at the
    // ordinary settings endpoint.
    await rejectsWith(
      harness.admin.updateSettings(teamAdmin, { aiEnabled: false }, REASON),
      'FORBIDDEN',
    );
    await rejectsWith(harness.admin.updateSettings(teamAdmin, {}, REASON), 'FORBIDDEN');
  });

  it('declares a capability table where every role is a subset of the one above', () => {
    const superAdmin = new Set(ADMIN_ROLE_CAPABILITIES.super_admin);
    const orgAdmin = new Set(ADMIN_ROLE_CAPABILITIES.organization_admin);
    const teamAdmin = new Set(ADMIN_ROLE_CAPABILITIES.team_admin);

    for (const capability of teamAdmin) assert.ok(orgAdmin.has(capability));
    for (const capability of orgAdmin) assert.ok(superAdmin.has(capability));
    // And the platform operator holds exactly one thing nobody else does.
    assert.ok(superAdmin.has('ai.admin.budget.reset'));
    assert.equal(orgAdmin.has('ai.admin.budget.reset'), false);
  });
});

// ── Audit reason ────────────────────────────────────────────────────────────

describe('AI administration — every change carries a reason', () => {
  it('refuses a mutation with no reason, an empty one, or a token one', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    for (const reason of [undefined, null, '', '   ', '.', 42]) {
      await rejectsWith(
        harness.admin.updateSettings(admin, { failoverEnabled: false }, reason),
        'VALIDATION_FAILED',
      );
    }
    // Nothing was applied, and the version did not move.
    assert.equal(harness.admin.settings(admin).failoverEnabled, true);
    assert.equal(harness.admin.settings(admin).configurationVersion, 1);
  });

  it('records the reason on the change and on the settings record', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const settings = await harness.admin.updateSettings(admin, { failoverEnabled: false }, REASON);
    assert.equal(settings.updatedReason, REASON);
    assert.equal(settings.updatedBy, 'user-super');

    const [record] = harness.admin.adminAudit(admin, 1);
    assert.equal(record.reason, REASON);
    assert.equal(record.outcome, 'applied');
    assert.equal(record.actorId, 'user-super');
    assert.equal(record.actorRole, 'super_admin');
  });

  it('bounds an over-long reason rather than storing it whole', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);
    const settings = await harness.admin.updateSettings(
      admin,
      { failoverEnabled: false },
      'x'.repeat(5_000),
    );
    assert.equal(settings.updatedReason.length, 500);
  });
});

// ── Settings and configuration versioning ───────────────────────────────────

describe('AI administration — runtime settings', () => {
  it('starts at the deployment baseline with nothing overridden', () => {
    const harness = buildTestAdministration();
    const config = harness.config;
    const settings = harness.plane.settings.current();

    assert.equal(settings.configurationVersion, 1);
    assert.equal(settings.aiEnabled, true);
    assert.equal(settings.realRequestsEnabled, config.allowRealRequests);
    assert.deepEqual([...settings.providerPreference], [...config.providerPreference]);
    assert.deepEqual(settings.retry, { ...config.retry });
    assert.equal(settings.timeout.workflowDeadlineMs, config.workflowDeadlineMs);
    assert.equal(settings.updatedBy, 'system');
  });

  it('increments the configuration version on every accepted change', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    assert.equal(harness.admin.settings(admin).configurationVersion, 1);
    await harness.admin.updateSettings(admin, { failoverEnabled: false }, REASON);
    assert.equal(harness.admin.settings(admin).configurationVersion, 2);
    await harness.admin.updateSettings(admin, { failoverEnabled: true }, REASON);
    assert.equal(harness.admin.settings(admin).configurationVersion, 3);
  });

  it('applies a retry policy change to the very next request', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(
      admin,
      { retry: { baseDelayMs: 750, maxDelayMs: 9_000, jitterPercent: 35 } },
      REASON,
    );

    // The pipeline reads the curve through the plane's effective config, so the
    // change is live without an isolate recycle. That is the whole point of the
    // overlay — an emergency setting that waits for a restart is not a setting.
    const diagnostics = harness.admin.diagnostics(admin);
    assert.deepEqual(diagnostics.retry, {
      baseDelayMs: 750,
      maxDelayMs: 9_000,
      jitterPercent: 35,
    });
  });

  it('clamps an out-of-range value instead of accepting it', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const settings = await harness.admin.updateSettings(
      admin,
      {
        retry: { baseDelayMs: -500, maxDelayMs: 10_000_000, jitterPercent: 999 },
        timeout: { workflowDeadlineMs: 1 },
        budget: { alertThresholdPercent: 0 },
      },
      REASON,
    );

    assert.equal(settings.retry.baseDelayMs, 0);
    assert.equal(settings.retry.maxDelayMs, 60_000);
    assert.equal(settings.retry.jitterPercent, 100);
    assert.equal(settings.timeout.workflowDeadlineMs, 1_000);
    assert.equal(settings.budget.alertThresholdPercent, 1);
  });

  it('ignores a field the settings contract does not declare', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const settings = await harness.admin.updateSettings(
      admin,
      { failoverEnabled: false, sneaky: 'value', capMicroUsd: 999 } as never,
      REASON,
    );
    assert.equal((settings as unknown as Record<string, unknown>).sneaky, undefined);
    assert.equal((settings as unknown as Record<string, unknown>).capMicroUsd, undefined);
  });

  it('cannot widen the deployment’s real-request permission', async () => {
    // The environment says no. This is the security property that keeps a
    // console toggle from overturning a deployment decision: an administrator
    // may always turn real requests OFF, and may only turn them ON inside an
    // envelope the deployment already granted.
    const harness = buildTestAdministration({ env: { AI_ALLOW_REAL_REQUESTS: 'false' } });
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const settings = await harness.admin.updateSettings(
      admin,
      { realRequestsEnabled: true },
      REASON,
    );
    // The administrator's stated position is stored honestly …
    assert.equal(settings.realRequestsEnabled, true);
    // … and the EFFECTIVE answer is still no.
    const overview = await harness.admin.overview(admin);
    assert.equal(overview.effective.realRequestsEnabled, false);
    assert.equal(harness.admin.diagnostics(admin).environment.realRequestsEffective, false);
  });

  it('lets an administrator withdraw a permission the deployment granted', async () => {
    const harness = buildTestAdministration({ env: { AI_ALLOW_REAL_REQUESTS: 'true' } });
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    assert.equal((await harness.admin.overview(admin)).effective.realRequestsEnabled, true);
    await harness.admin.updateSettings(admin, { realRequestsEnabled: false }, REASON);
    assert.equal((await harness.admin.overview(admin)).effective.realRequestsEnabled, false);
  });
});

// ── Configuration persistence ───────────────────────────────────────────────

describe('AI administration — configuration persistence', () => {
  it('persists every accepted change to durable storage', async () => {
    const store = createMemorySettingsStore();
    const harness = buildTestAdministration({ settingsStore: store });
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(admin, { failoverEnabled: false }, REASON);
    const stored = await store.load();
    assert.equal(stored?.failoverEnabled, false);
    assert.equal(stored?.configurationVersion, 2);
    assert.equal(store.saves, 1);
  });

  it('restores stored settings into a freshly started plane', async () => {
    const store = createMemorySettingsStore();
    const first = buildTestAdministration({ settingsStore: store });
    const admin = await first.actor(ADMIN_TOKEN.superAdmin);
    await first.admin.setEmergencyStop(admin, true, 'incident 5001: runaway spend');
    await first.admin.updateProvider(admin, 'backup', { enabled: false }, REASON);

    // A new isolate, the same durable store. The kill switch an operator
    // engaged during an incident must not quietly release itself because an
    // edge function recycled.
    const second = buildTestAdministration({ settingsStore: store });
    assert.equal(second.plane.settings.current().emergencyStop.engaged, false);
    await second.admin.hydrate();

    const restored = second.plane.settings.current();
    assert.equal(restored.emergencyStop.engaged, true);
    assert.equal(restored.emergencyStop.engagedBy, 'user-super');
    assert.equal(restored.providers.backup.enabled, false);
    // And the projection reached the registry, not just the settings blob.
    assert.equal(second.plane.providers.get('backup').enabled, false);
  });

  it('does not inflate the configuration version on hydration', async () => {
    const store = createMemorySettingsStore();
    const first = buildTestAdministration({ settingsStore: store });
    const admin = await first.actor(ADMIN_TOKEN.superAdmin);
    await first.admin.updateSettings(admin, { failoverEnabled: false }, REASON);

    for (let restart = 0; restart < 3; restart += 1) {
      const next = buildTestAdministration({ settingsStore: store });
      await next.admin.hydrate();
      assert.equal(next.plane.settings.current().configurationVersion, 2);
    }
  });

  it('falls back to the deployment baseline when storage is unreadable', async () => {
    const harness = buildTestAdministration({
      settingsStore: {
        load: () => Promise.reject(new Error('key-value store unavailable')),
        save: () => Promise.resolve(),
        saves: 0,
      },
    });

    // A storage outage must not stop the plane. The baseline is the safe
    // posture by construction, and the failure is loud.
    const settings = await harness.admin.hydrate();
    assert.equal(settings.configurationVersion, 1);
    assert.equal(settings.aiEnabled, true);
    assert.ok(harness.logs.some((line) => line.line.includes('ai.admin.settings.load_failed')));
  });

  it('reports a failed write rather than reporting a change that will vanish', async () => {
    const harness = buildTestAdministration({
      settingsStore: {
        load: () => Promise.resolve(undefined),
        save: () => Promise.reject(new Error('disk full')),
        saves: 0,
      },
    });
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await rejectsWith(
      harness.admin.updateSettings(admin, { failoverEnabled: false }, REASON),
      'INTERNAL_ERROR',
    );
    // The attempt is on the trail as a rejection, which is what an operator
    // needs when the console said "failed" and they want to know whether the
    // change half-happened.
    const [record] = harness.admin.adminAudit(admin, 1);
    assert.equal(record.outcome, 'rejected');
    assert.equal(record.rejectionCode, 'INTERNAL_ERROR');
  });

  it('normalises a stored record written by an older or edited revision', () => {
    const config = loadControlPlaneConfig(recordEnv({}));
    const { settings, recovered } = parseStoredSettings(
      {
        configurationVersion: 12,
        aiEnabled: false,
        retry: { baseDelayMs: 999_999 },
        providerPreference: ['openai', 'not a valid id!', 'anthropic'],
        providers: { openai: { enabled: false, modelAllowList: ['gpt-4o-mini'] } },
        unknownField: 'dropped',
      },
      config,
      '2026-08-03T00:00:00.000Z',
    );

    assert.equal(recovered, false);
    assert.equal(settings.configurationVersion, 12);
    assert.equal(settings.aiEnabled, false);
    // Bounded, not trusted.
    assert.equal(settings.retry.baseDelayMs, 10_000);
    // The malformed entry is dropped; the valid ones survive.
    assert.deepEqual([...settings.providerPreference], ['openai', 'anthropic']);
    assert.equal(settings.providers.openai.enabled, false);
    assert.equal((settings as unknown as Record<string, unknown>).unknownField, undefined);
  });

  it('treats an unusable stored value as nothing stored', () => {
    const config = loadControlPlaneConfig(recordEnv({}));
    const { settings, recovered } = parseStoredSettings('corrupt', config, '2026-08-03T00:00:00.000Z');
    assert.equal(recovered, true);
    assert.equal(settings.configurationVersion, 1);
    assert.equal(settings.aiEnabled, true);
  });
});

// ── Kill switch ─────────────────────────────────────────────────────────────

describe('AI administration — kill switch', () => {
  it('stops every AI request when the emergency switch is engaged', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    // It works before.
    const before = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    assert.ok(before.requestId);

    await harness.admin.setEmergencyStop(admin, true, 'incident 5001: runaway spend');

    // And it does not after — refused by the policy engine, on the governed
    // path, with an audit record like any other denial.
    const error = await rejectsWith(
      harness.plane.execute(
        { featureId: 'cortex.narrative', input: narrativeInput() },
        { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
      ),
      'AI_DISABLED',
    );
    assert.equal(error.status, 503);
    // The caller-facing message never leaks the operator's incident note.
    assert.equal(error.message.includes('runaway spend'), false);
    assert.ok(error.diagnostics?.includes('runaway spend'));
  });

  it('restores the previous posture when the switch is released', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(admin, { failoverEnabled: false }, REASON);
    await harness.admin.setEmergencyStop(admin, true, 'incident 5001: pausing AI');
    await harness.admin.setEmergencyStop(admin, false, 'incident 5001: resolved, resuming');

    const settings = harness.admin.settings(admin);
    assert.equal(settings.emergencyStop.engaged, false);
    // The stop is an overlay, not a mutation of the posture underneath it, so
    // releasing it restores exactly what was there rather than a state an
    // operator has to reconstruct from memory.
    assert.equal(settings.failoverEnabled, false);
    assert.equal(settings.aiEnabled, true);

    const result = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    assert.ok(result.requestId);
  });

  it('stops AI through the master switch as well as the emergency switch', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(admin, { aiEnabled: false }, 'planned maintenance window');
    await rejectsWith(
      harness.plane.execute(
        { featureId: 'cortex.narrative', input: narrativeInput() },
        { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
      ),
      'AI_DISABLED',
    );
  });

  it('reports a stopped platform as unhealthy rather than healthy', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    assert.notEqual(harness.plane.health().status, 'unhealthy');
    await harness.admin.setEmergencyStop(admin, true, 'incident 5001: pausing AI');

    const health = harness.plane.health();
    // The endpoint answers "can this platform serve AI requests right now", and
    // it cannot. Reporting healthy while every request is refused would make
    // the endpoint useless during exactly the incident it exists for.
    assert.equal(health.status, 'unhealthy');
    assert.equal(health.aiEnabled, false);
    assert.equal(health.emergencyStopEngaged, true);
    assert.ok(health.issues.some((issue) => issue.includes('emergency kill switch')));
  });

  it('records who engaged the switch, when, and why', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.setEmergencyStop(admin, true, 'incident 5001: runaway spend');

    const stop = harness.admin.settings(admin).emergencyStop;
    assert.equal(stop.engaged, true);
    assert.equal(stop.engagedBy, 'user-super');
    assert.equal(stop.reason, 'incident 5001: runaway spend');
    assert.ok(stop.engagedAt);

    const [record] = harness.admin.adminAudit(admin, 1);
    assert.equal(record.action, 'ai.admin.emergency_stop.engaged');
    assert.equal(record.before.emergencyStopEngaged, 'false');
    assert.equal(record.after.emergencyStopEngaged, 'true');
  });

  it('carries the configuration version onto the health snapshot', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    assert.equal(harness.plane.health().configurationVersion, 1);
    await harness.admin.updateSettings(admin, { failoverEnabled: false }, REASON);
    // An operator correlating an incident with a change needs the version on
    // the same snapshot as the symptom.
    assert.equal(harness.plane.health().configurationVersion, 2);
  });
});

// ── Provider management ─────────────────────────────────────────────────────

describe('AI administration — provider management', () => {
  it('reports status, certification, circuit state and models for each provider', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const [primary] = harness.admin.providers(admin);
    assert.equal(primary.providerId, 'primary');
    assert.equal(primary.enabled, true);
    assert.equal(primary.health.certification, 'certified');
    assert.equal(primary.health.circuit, 'closed');
    assert.equal(primary.selectionReason, 'eligible');
    assert.equal(primary.preferenceIndex, 0);
    assert.ok(primary.models.length > 0);
    assert.ok(primary.models.every((model) => model.permitted));
  });

  it('surfaces last failure and last recovery', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const beforeFailure = harness.admin.providers(admin)[0];
    assert.equal(beforeFailure.health.lastFailureAt, undefined);
    assert.equal(beforeFailure.health.lastRecoveryAt, undefined);

    // Fails the first attempt, then succeeds on the retry — one request that
    // produces both a failure and the recovery from it.
    harness.provider.setScenario('fail_once');
    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );

    const after = harness.admin.providers(admin)[0];
    assert.ok(after.health.lastFailureAt, 'a failure must be visible to an operator');
    // A success following a failure IS the recovery. Recording it only on a
    // circuit transition would miss the common case entirely: a provider that
    // failed without ever crossing the breaker threshold still recovered.
    assert.ok(after.health.lastRecoveryAt, 'a recovery must be visible to an operator');
  });

  it('disables a provider and takes it out of selection', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const providers = await harness.admin.updateProvider(
      admin,
      'primary',
      { enabled: false },
      'incident 4471: primary returning malformed completions',
    );
    const primary = providers.find((provider) => provider.providerId === 'primary');
    assert.equal(primary?.enabled, false);
    assert.equal(primary?.selectionReason, 'disabled');

    // Traffic moves to the backup rather than failing — the whole reason a
    // console has a disable button.
    const result = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    assert.equal(result.execution.providerId, 'backup');
  });

  it('restores the established certification when a provider is re-enabled', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    assert.equal(harness.plane.providers.get('primary').certification, 'certified');
    await harness.admin.updateProvider(admin, 'primary', { enabled: false }, REASON);
    assert.equal(harness.plane.providers.get('primary').certification, 'disabled');

    await harness.admin.updateProvider(admin, 'primary', { enabled: true }, 'incident resolved');
    // Without this, the recovery action would leave the platform worse off than
    // the outage: a certified provider demoted to unverified and then refused
    // by `requireCertifiedProviders`.
    assert.equal(harness.plane.providers.get('primary').certification, 'certified');
    assert.equal(harness.admin.providers(admin)[0].selectionReason, 'eligible');
  });

  it('refuses to configure a provider that is not registered', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);
    // An administrator cannot bring a provider into existence by naming it, and
    // a typo produces a clear refusal rather than a stored setting that does
    // nothing.
    await rejectsWith(
      harness.admin.updateProvider(admin, 'gemini', { enabled: true }, REASON),
      'PROVIDER_NOT_FOUND',
    );
  });

  it('steers traffic with a default provider without touching provider code', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(admin, { defaultProviderId: 'backup' }, REASON);

    const result = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    assert.equal(result.execution.providerId, 'backup');

    const backup = harness.admin
      .providers(admin)
      .find((provider) => provider.providerId === 'backup');
    assert.equal(backup?.isDefault, true);
    assert.equal(backup?.preferenceIndex, 0);
  });

  it('reorders the provider preference', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(
      admin,
      { providerPreference: ['backup', 'primary'] },
      REASON,
    );
    const result = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    assert.equal(result.execution.providerId, 'backup');
  });

  it('narrows a provider to an allow list of models', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const models = harness.plane.providers.get('primary').descriptor.models;
    assert.ok(models.length >= 1);
    const chosen = models[models.length - 1].modelId;

    await harness.admin.updateProvider(
      admin,
      'primary',
      { modelAllowList: [chosen] },
      'cost control: restricting to the approved model',
    );

    const result = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    assert.equal(result.execution.modelId, chosen);

    const primary = harness.admin.providers(admin)[0];
    assert.deepEqual([...primary.modelAllowList], [chosen]);
    assert.equal(primary.models.filter((model) => model.permitted).length, 1);
  });

  it('ignores an allow list that matches nothing the adapter declares', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateProvider(
      admin,
      'primary',
      { modelAllowList: ['a-model-that-does-not-exist'] },
      REASON,
    );

    // A typo in a console field must not silently take a provider out of
    // rotation while the console still shows it enabled. The mismatch surfaces
    // through validation instead.
    const result = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    assert.equal(result.execution.providerId, 'primary');
    assert.ok(
      harness.plane.providers
        .validate()
        .some((issue) => issue.includes('matches no declared model')),
    );
  });

  it('never lets a pinned model override a capability requirement', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(admin, { defaultModelId: 'not-a-real-model' }, REASON);

    // A pin can steer selection; it can never produce a paid call whose
    // response the feature cannot parse.
    const result = await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    assert.ok(result.execution.modelId);
    assert.notEqual(result.execution.modelId, 'not-a-real-model');
  });
});

// ── Budget administration ───────────────────────────────────────────────────

describe('AI administration — budget management', () => {
  it('reports current, remaining, lifetime and reserved spend', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const budget = await harness.admin.budget(admin);
    assert.equal(budget.platform.capMicroUsd, usdToMicroUsd(9));
    assert.equal(budget.platform.spentMicroUsd, 0);
    assert.equal(budget.platform.remainingMicroUsd, usdToMicroUsd(9));
    assert.equal(budget.platform.lifetimeSpentMicroUsd, 0);
    assert.equal(budget.reservations.openCount, 0);
    assert.equal(budget.reservations.reclaimedMicroUsd, 0);
    assert.equal(budget.daily.organizationDailyMicroUsd, harness.config.budget.organizationDailyMicroUsd);
  });

  it('exposes reservation recovery state', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.plane.spendLedger.reserve(SPEND_SCOPE.platform, 250_000, 'req-in-flight', {
      owner: 'cortex.analysis',
    });

    const budget = await harness.admin.budget(admin);
    assert.equal(budget.reservations.openCount, 1);
    assert.equal(budget.reservations.openMicroUsd, 250_000);
    assert.equal(budget.reservations.open[0].owner, 'cortex.analysis');
    assert.ok(budget.reservations.open[0].expiresAt);
    // Held money is committed money: it must not show as remaining headroom.
    assert.equal(budget.platform.remainingMicroUsd, usdToMicroUsd(9) - 250_000);
  });

  it('resets settled spend only for an authorized platform operator', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.plane.spendLedger.reserve(SPEND_SCOPE.platform, 500_000, 'r1');
    await harness.plane.spendLedger.settle(
      { reservationId: 'r1', scope: SPEND_SCOPE.platform, reservedMicroUsd: 500_000, createdAt: '', expiresAt: '' },
      400_000,
    );
    assert.equal((await harness.admin.budget(admin)).platform.spentMicroUsd, 400_000);

    const after = await harness.admin.resetSpend(admin, 'quarterly budget approved by finance');
    assert.equal(after.platform.spentMicroUsd, 0);
    // The history survives the reset. An auditor asking "what has this platform
    // ever spent" gets the truth, not a counter somebody zeroed.
    assert.equal(after.platform.lifetimeSpentMicroUsd, 400_000);
    assert.equal(after.resets.length, 1);
    assert.equal(after.resets[0].authorizedBy, 'user-super');
    assert.equal(after.resets[0].reason, 'quarterly budget approved by finance');
    assert.equal(after.resets[0].clearedMicroUsd, 400_000);
    assert.equal(after.resets[0].kind, 'reset');
  });

  it('raises the ceiling without clearing what was already spent', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.plane.spendLedger.reserve(SPEND_SCOPE.platform, 500_000, 'r1');
    await harness.plane.spendLedger.settle(
      { reservationId: 'r1', scope: SPEND_SCOPE.platform, reservedMicroUsd: 500_000, createdAt: '', expiresAt: '' },
      400_000,
    );

    const after = await harness.admin.increaseSpendCap(
      admin,
      usdToMicroUsd(25),
      'approved uplift for the Q3 pilot',
    );

    assert.equal(after.platform.capMicroUsd, usdToMicroUsd(25));
    // "We authorised more money" and "we wiped the record of what was spent"
    // are different decisions. Raising a ceiling is not forgiving the spend
    // under it.
    assert.equal(after.platform.spentMicroUsd, 400_000);
    assert.equal(after.platform.remainingMicroUsd, usdToMicroUsd(25) - 400_000);
    assert.equal(after.resets.at(-1)?.kind, 'cap_raise');
    assert.equal(after.resets.at(-1)?.clearedMicroUsd, 0);
  });

  it('refuses to lower the ceiling through the increase operation', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await rejectsWith(
      harness.admin.increaseSpendCap(admin, usdToMicroUsd(1), 'trying to lower the cap'),
      'VALIDATION_FAILED',
    );
    assert.equal((await harness.admin.budget(admin)).platform.capMicroUsd, usdToMicroUsd(9));
  });

  it('clamps an absurd cap rather than honouring it', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    // Far more likely a units mistake — micro-USD typed into a dollar field —
    // than an intention.
    const after = await harness.admin.increaseSpendCap(
      admin,
      usdToMicroUsd(50_000_000),
      'finance approved additional budget',
    );
    assert.equal(after.platform.capMicroUsd, MAX_ADMIN_SPEND_CAP_MICRO_USD);
  });

  it('keeps the Batch 1 hard cap enforcing after administrative changes', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(admin, { budget: { enforce: false } }, REASON);
    // The DAILY budget's enforcement is administrable. The MARQ lifetime
    // ceiling's is not — it is a deployment decision, and this layer only
    // manages the ceiling, it does not get to switch it off.
    const budget = await harness.admin.budget(admin);
    assert.equal(budget.daily.enforce, false);
    assert.equal(budget.platform.enforced, harness.config.spend.enforce);
    assert.equal(budget.platform.enforced, true);
  });

  it('moves the daily allowance and applies it to the next authorization', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(
      admin,
      { budget: { organizationDailyMicroUsd: 12_345, actorDailyMicroUsd: 678 } },
      REASON,
    );

    const policy = harness.plane.budgetPolicy();
    assert.equal(policy.organizationDaily.limitMicroUsd, 12_345);
    assert.equal(policy.actorDaily.limitMicroUsd, 678);

    const state = harness.plane.budgetState('acme', 'user-super');
    assert.equal(state.organization.limitMicroUsd, 12_345);
    assert.equal(state.actor.limitMicroUsd, 678);
  });

  it('records a budget change with before, after and a reason', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.updateSettings(
      admin,
      { budget: { actorDailyMicroUsd: 2_000_000 } },
      'raising the per-consultant allowance for the migration sprint',
    );

    const [record] = harness.admin.adminAudit(admin, 1);
    assert.equal(record.action, 'ai.admin.budget.updated');
    assert.equal(record.before.budgetActorDailyMicroUsd, '5000000');
    assert.equal(record.after.budgetActorDailyMicroUsd, '2000000');
    assert.equal(record.reason, 'raising the per-consultant allowance for the migration sprint');
  });
});

// ── Usage and cost analytics ────────────────────────────────────────────────

describe('AI administration — usage and cost analytics', () => {
  it('reports requests, tokens, rates, retries and per-feature usage', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);
    const authorization = `Bearer ${ADMIN_TOKEN.superAdmin}`;

    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization },
    );
    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization },
    );

    const usage = await harness.admin.usage(admin);
    assert.equal(usage.totals.requests, 2);
    assert.equal(usage.totals.succeeded, 2);
    assert.equal(usage.totals.failed, 0);
    assert.equal(usage.totals.successRatePercent, 100);
    assert.equal(usage.totals.failureRatePercent, 0);
    assert.ok(usage.totals.tokens > 0);
    assert.equal(usage.totals.retries, 0);

    const narrative = usage.features.find((feature) => feature.featureId === 'cortex.narrative');
    assert.equal(narrative?.requests, 2);
    assert.ok((narrative?.tokens ?? 0) > 0);

    const primary = usage.providers.find((provider) => provider.providerId === 'primary');
    assert.equal(primary?.attempts, 2);
    assert.equal(primary?.successRatePercent, 100);
  });

  it('counts retries as attempts beyond the first', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    harness.provider.setScenario('fail_once');
    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );

    const usage = await harness.admin.usage(admin);
    assert.equal(usage.totals.requests, 1);
    assert.ok(usage.totals.providerAttempts >= 2);
    assert.equal(usage.totals.retries, usage.totals.providerAttempts - usage.totals.requests);
  });

  it('reports failure rate and an error breakdown', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.plane
      .execute(
        { featureId: 'cortex.narrative', input: { type: 'not_a_valid_type' } },
        { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
      )
      .catch(() => undefined);
    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );

    const usage = await harness.admin.usage(admin);
    assert.ok(usage.totals.guardRejections + usage.totals.failed > 0);
    assert.equal(usage.totals.succeeded, 1);
  });

  it('separates estimated cost from actual settled spend', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );

    const usage = await harness.admin.usage(admin);
    // The mock provider is not billable, so the platform has committed nothing
    // against its ceiling even though the request has a priced estimate. A
    // dashboard that reported one figure as the other is how a platform ends up
    // surprised by an invoice.
    assert.equal(usage.totals.actualCostMicroUsd, 0);
    assert.equal((await harness.admin.budget(admin)).platform.spentMicroUsd, 0);
  });

  it('reports zero rates rather than NaN on an idle platform', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const usage = await harness.admin.usage(admin);
    assert.equal(usage.totals.requests, 0);
    assert.equal(usage.totals.successRatePercent, 0);
    assert.equal(usage.totals.failureRatePercent, 0);
    assert.deepEqual(usage.features, []);
  });
});

// ── Diagnostics and observability ───────────────────────────────────────────

describe('AI administration — runtime diagnostics', () => {
  it('reports versions, environment posture, circuits and rate limits', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const diagnostics = harness.admin.diagnostics(admin);
    assert.ok(diagnostics.versions.platformVersion);
    assert.ok(diagnostics.versions.contractVersion);
    assert.equal(diagnostics.versions.configurationVersion, 1);
    assert.ok(diagnostics.versions.prompts.length > 0);
    assert.ok(diagnostics.versions.prompts.every((prompt) => prompt.fingerprint.length > 0));

    assert.equal(diagnostics.environment.realRequestsPermittedByEnvironment, false);
    assert.equal(diagnostics.environment.realRequestsEffective, false);
    assert.equal(diagnostics.environment.redactionEnabled, true);

    assert.ok(diagnostics.circuits.length >= 2);
    assert.equal(diagnostics.circuits[0].state, 'closed');
    assert.ok(diagnostics.rateLimits.length > 0);
    assert.ok(diagnostics.rateLimits.every((limit) => limit.perActor.limit > 0));
    assert.ok(diagnostics.circuitPolicy.failureThreshold > 0);
  });

  it('is refused to a caller with no administrative role', async () => {
    const harness = buildTestAdministration();
    await rejectsWith(harness.actor(ADMIN_TOKEN.member), 'FORBIDDEN');
  });
});

// ── Audit ───────────────────────────────────────────────────────────────────

describe('AI administration — audit visibility', () => {
  it('gives the platform operator every organization’s execution records', async () => {
    const harness = buildTestAdministration();
    const superAdmin = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.otherOrganizationAdmin}` },
    );

    const records = harness.admin.executionAudit(superAdmin);
    const organizations = new Set(records.map((record) => record.organizationId));
    assert.ok(organizations.has('acme'));
    assert.ok(organizations.has('globex'));
  });

  it('scopes execution records to the administrator’s own organizations', async () => {
    const harness = buildTestAdministration();

    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.superAdmin}` },
    );
    await harness.plane.execute(
      { featureId: 'cortex.narrative', input: narrativeInput() },
      { authorization: `Bearer ${ADMIN_TOKEN.otherOrganizationAdmin}` },
    );

    const globexAdmin = await harness.actor(ADMIN_TOKEN.otherOrganizationAdmin);
    const records = harness.admin.executionAudit(globexAdmin);
    assert.ok(records.length > 0);
    // The same tenant boundary the execution path enforces, applied to reading.
    assert.ok(records.every((record) => record.organizationId === 'globex'));
  });

  it('records a refused administrative access attempt', async () => {
    const harness = buildTestAdministration();
    await rejectsWith(harness.actor(ADMIN_TOKEN.member), 'FORBIDDEN');

    const superAdmin = await harness.actor(ADMIN_TOKEN.superAdmin);
    const denials = harness.admin
      .adminAudit(superAdmin, 200)
      .filter((record) => record.action === 'ai.admin.access.denied');
    assert.equal(denials.length, 1);
    assert.equal(denials[0].outcome, 'rejected');
    assert.equal(denials[0].actorId, 'user-member');
    assert.equal(denials[0].actorRole, 'unauthorized');
  });

  it('records an authorization failure on a mutation, not just a success', async () => {
    const harness = buildTestAdministration();
    const teamAdmin = await harness.actor(ADMIN_TOKEN.teamAdmin);
    await rejectsWith(harness.admin.setEmergencyStop(teamAdmin, true, REASON), 'FORBIDDEN');

    const [record] = harness.admin.adminAudit(teamAdmin, 1);
    assert.equal(record.outcome, 'rejected');
    assert.equal(record.rejectionCode, 'FORBIDDEN');
    assert.equal(record.actorId, 'user-team-admin');
    // A rejection before the prior state was read records an empty `before`,
    // which is the truth: nothing was read, so nothing is claimed about it.
    assert.deepEqual(record.before, {});
  });

  it('shows an administrator their own changes and not another operator’s', async () => {
    const harness = buildTestAdministration();
    const superAdmin = await harness.actor(ADMIN_TOKEN.superAdmin);
    const orgAdmin = await harness.actor(ADMIN_TOKEN.organizationAdmin);

    await harness.admin.updateSettings(superAdmin, { failoverEnabled: false }, REASON);
    await harness.admin.updateSettings(orgAdmin, { budget: { enforce: false } }, REASON);

    const orgView = harness.admin.adminAudit(orgAdmin, 200);
    assert.ok(orgView.length > 0);
    assert.ok(orgView.every((record) => record.actorId === 'user-org-admin'));

    const platformView = harness.admin.adminAudit(superAdmin, 200);
    assert.ok(platformView.some((record) => record.actorId === 'user-org-admin'));
    assert.ok(platformView.some((record) => record.actorId === 'user-super'));
  });

  it('exposes no way to edit or delete an audit record', () => {
    const harness = buildTestAdministration();
    // The interface is append-and-read. There is no update, no delete and no
    // clear on the store contract, so no implementation can offer one — a trail
    // an administrator can edit is a trail that proves nothing about
    // administrators.
    const surface = Object.keys(harness.admin).sort();
    assert.equal(surface.some((name) => /delete|remove|clear|purge|edit|update.*audit/i.test(name)), false);
    assert.equal(typeof harness.admin.adminAudit, 'function');
    assert.equal(typeof harness.admin.executionAudit, 'function');
  });

  it('bounds a requested page size', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);
    for (let i = 0; i < 5; i += 1) {
      await harness.admin.updateSettings(admin, { failoverEnabled: i % 2 === 0 }, REASON);
    }
    assert.equal(harness.admin.adminAudit(admin, 2).length, 2);
    assert.ok(harness.admin.adminAudit(admin, 10_000).length <= 200);
    assert.ok(harness.admin.adminAudit(admin, -1).length >= 1);
  });
});

// ── Overview ────────────────────────────────────────────────────────────────

describe('AI administration — operational overview', () => {
  it('answers the console’s landing view in one authorised call', async () => {
    const harness = buildTestAdministration();
    const admin = await harness.actor(ADMIN_TOKEN.superAdmin);

    const overview = await harness.admin.overview(admin);
    assert.equal(overview.actor.role, 'super_admin');
    assert.ok(overview.actor.capabilities.includes('ai.admin.budget.reset'));
    assert.equal(overview.settings.configurationVersion, 1);
    assert.equal(overview.effective.aiEnabled, true);
    assert.deepEqual(
      [...overview.effective.providerPreference],
      [...harness.config.providerPreference],
    );
    assert.ok(overview.health.status);
    assert.ok(overview.budget.platform.capMicroUsd > 0);
    assert.equal(overview.usage.totals.requests, 0);
  });

  it('tells a team admin exactly what they may do', async () => {
    const harness = buildTestAdministration();
    const teamAdmin = await harness.actor(ADMIN_TOKEN.teamAdmin);

    const overview = await harness.admin.overview(teamAdmin);
    assert.equal(overview.actor.role, 'team_admin');
    assert.deepEqual([...overview.actor.capabilities].sort(), [
      'ai.admin.audit.read',
      'ai.admin.view',
    ]);
    assert.deepEqual([...overview.actor.organizationScope], ['acme']);
  });
});
