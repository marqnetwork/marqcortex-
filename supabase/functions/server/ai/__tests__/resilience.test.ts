/**
 * Resilience: circuit breaker transitions, health accuracy, timeout and
 * workflow-deadline behaviour.
 *
 * Time is injected everywhere here — every transition is driven by an explicit
 * `clock.advance`, never a sleep — so a cool-down boundary is asserted exactly
 * rather than approximately, and the suite cannot flake on a loaded machine.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createProviderRegistry } from '../providers/registry.ts';
import { createProviderSelector } from '../providers/selector.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { buildHealthSnapshot } from '../observability/health.ts';
import { createFeatureCatalog } from '../policy/featureCatalog.ts';
import { registerCortexFeatures } from '../features/index.ts';
import { createPromptRegistry } from '../prompts/registry.ts';
import { registerCortexPrompts } from '../prompts/catalog.ts';
import { createTestClock } from '../runtime/clock.ts';
import { withTimeout } from '../providers/timeout.ts';
import { AIError } from '../contracts/errors.ts';
import { buildTestPlane, narrativeInput, TEST_TOKEN } from './harness.ts';

const OPTIONS = { failureThreshold: 3, openMs: 10_000, halfOpenSuccessesToClose: 2 };
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const envelope = (featureId: string, input: unknown) => ({
  featureId,
  input,
  channel: 'team_console' as const,
});

describe('H4 — circuit breaker state machine', () => {
  it('starts closed and admits traffic', () => {
    const breaker = createCircuitBreaker(createTestClock(), OPTIONS);
    assert.equal(breaker.stateOf('p'), 'closed');
    assert.equal(breaker.canAttempt('p'), true);
  });

  it('opens only at the failure threshold, not before', () => {
    const breaker = createCircuitBreaker(createTestClock(), OPTIONS);
    assert.equal(breaker.recordFailure('p'), false);
    assert.equal(breaker.recordFailure('p'), false);
    assert.equal(breaker.stateOf('p'), 'closed', 'two failures must not open a threshold of three');
    assert.equal(breaker.recordFailure('p'), true);
    assert.equal(breaker.stateOf('p'), 'open');
    assert.equal(breaker.canAttempt('p'), false);
  });

  it('resets the failure run on an intervening success', () => {
    const breaker = createCircuitBreaker(createTestClock(), OPTIONS);
    breaker.recordFailure('p');
    breaker.recordFailure('p');
    breaker.recordSuccess('p');
    breaker.recordFailure('p');
    breaker.recordFailure('p');
    assert.equal(breaker.stateOf('p'), 'closed', 'failures must not accumulate across a success');
  });

  it('holds open for the full cool-down, then admits one probe', () => {
    const clock = createTestClock();
    const breaker = createCircuitBreaker(clock, OPTIONS);
    for (let i = 0; i < OPTIONS.failureThreshold; i += 1) breaker.recordFailure('p');

    clock.advance(OPTIONS.openMs - 1);
    assert.equal(breaker.stateOf('p'), 'open', 'must stay open until the cool-down elapses');

    clock.advance(1);
    assert.equal(breaker.stateOf('p'), 'half_open');
    assert.equal(breaker.canAttempt('p'), true, 'the first probe is admitted');
    assert.equal(breaker.canAttempt('p'), false, 'a second concurrent probe is not');
  });

  it('closes after enough consecutive half-open successes', () => {
    const clock = createTestClock();
    const breaker = createCircuitBreaker(clock, OPTIONS);
    for (let i = 0; i < OPTIONS.failureThreshold; i += 1) breaker.recordFailure('p');
    clock.advance(OPTIONS.openMs);

    breaker.canAttempt('p');
    breaker.recordSuccess('p');
    assert.equal(breaker.stateOf('p'), 'half_open', 'one success is not recovery');

    breaker.canAttempt('p');
    breaker.recordSuccess('p');
    assert.equal(breaker.stateOf('p'), 'closed');
  });

  it('re-opens immediately on a failed probe with a fresh cool-down', () => {
    const clock = createTestClock();
    const breaker = createCircuitBreaker(clock, OPTIONS);
    for (let i = 0; i < OPTIONS.failureThreshold; i += 1) breaker.recordFailure('p');
    clock.advance(OPTIONS.openMs);
    breaker.canAttempt('p');

    assert.equal(breaker.recordFailure('p'), true, 'a failed probe re-opens the circuit');
    assert.equal(breaker.stateOf('p'), 'open');
    clock.advance(OPTIONS.openMs - 1);
    assert.equal(breaker.stateOf('p'), 'open', 'the cool-down restarted, it did not continue');
  });

  it('keeps providers independent', () => {
    const breaker = createCircuitBreaker(createTestClock(), OPTIONS);
    for (let i = 0; i < OPTIONS.failureThreshold; i += 1) breaker.recordFailure('a');
    assert.equal(breaker.stateOf('a'), 'open');
    assert.equal(breaker.stateOf('b'), 'closed');
  });

  it('exposes its state and timing through a snapshot', () => {
    const clock = createTestClock();
    const breaker = createCircuitBreaker(clock, OPTIONS);
    for (let i = 0; i < OPTIONS.failureThreshold; i += 1) breaker.recordFailure('p');
    const snapshot = breaker.snapshot('p');
    assert.equal(snapshot.state, 'open');
    assert.equal(snapshot.consecutiveFailures, OPTIONS.failureThreshold);
    assert.equal(snapshot.opensUntilMs, (snapshot.openedAtMs ?? 0) + OPTIONS.openMs);
  });

  it('does not trip on a governance rejection', async () => {
    // A provider that answered correctly with unacceptable CONTENT is healthy.
    // Opening its circuit would take a working vendor out of rotation because a
    // prompt needs work.
    const { plane, provider } = buildTestPlane();
    provider.setScenario('guarantee_language');

    await plane.execute(envelope('cortex.narrative', narrativeInput()), AUTH).catch(() => undefined);

    const health = plane.health();
    const primary = health.providers.find((entry) => entry.providerId === 'primary');
    assert.equal(primary?.circuit, 'closed', 'a governance rejection opened a provider circuit');
  });

  it('does not trip on an authorization rejection', async () => {
    const { plane } = buildTestPlane();
    await plane
      .execute(envelope('cortex.narrative', narrativeInput()), { authorization: null })
      .catch(() => undefined);

    const health = plane.health();
    for (const provider of health.providers) {
      assert.equal(provider.circuit, 'closed', `${provider.providerId} circuit opened on an auth failure`);
    }
  });
});

describe('H5 — health reports real component state', () => {
  function snapshotWith(options: {
    realRequests: boolean;
    billable: boolean;
    productionReady: boolean;
    credentials?: boolean;
  }) {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, OPTIONS);
    const registry = createProviderRegistry(clock, circuit);
    registry.register(
      createMockProvider({
        providerId: 'vendor',
        billable: options.billable,
        productionReady: options.productionReady,
        credentials: options.credentials ?? true,
      }),
      { certification: 'certified' },
    );
    const selector = createProviderSelector(registry, circuit, {
      preference: ['vendor'],
      failoverEnabled: true,
      realRequestsEnabled: options.realRequests,
      requireCertification: true,
    });
    const catalog = createFeatureCatalog();
    registerCortexFeatures(catalog);
    const prompts = createPromptRegistry();
    registerCortexPrompts(prompts);

    return {
      snapshot: buildHealthSnapshot({
        registry,
        selector,
        catalog,
        prompts,
        clock,
        platformVersion: 'test',
        contractVersion: 'test',
      }),
      registry,
      circuit,
    };
  }

  it('reports unhealthy when the kill switch removes the only paid provider', () => {
    const { snapshot } = snapshotWith({
      realRequests: false,
      billable: true,
      productionReady: true,
    });
    assert.equal(snapshot.status, 'unhealthy');
    assert.match(snapshot.selection.vendor, /AI_ALLOW_REAL_REQUESTS/);
  });

  it('reports degraded — never healthy — when only a synthetic provider is eligible', () => {
    // A green light while every completion is synthetic is the most dangerous
    // state a health endpoint can report.
    const { snapshot } = snapshotWith({
      realRequests: false,
      billable: false,
      productionReady: false,
    });
    assert.equal(snapshot.status, 'degraded');
    assert.ok(snapshot.issues.some((issue) => issue.includes('synthetic')));
  });

  it('reports healthy when a production-ready provider is eligible', () => {
    const { snapshot } = snapshotWith({
      realRequests: true,
      billable: true,
      productionReady: true,
    });
    assert.equal(snapshot.status, 'healthy');
    assert.equal(snapshot.selection.vendor, 'eligible');
  });

  it('names missing credentials as the reason rather than reporting healthy', () => {
    const { snapshot } = snapshotWith({
      realRequests: true,
      billable: true,
      productionReady: true,
      credentials: false,
    });
    assert.equal(snapshot.status, 'unhealthy');
    assert.equal(snapshot.selection.vendor, 'credentials not configured');
  });

  it('retains a real failure reason and timestamp, not a default string', () => {
    const { registry } = snapshotWith({
      realRequests: true,
      billable: true,
      productionReady: true,
    });
    registry.recordFailure('vendor', 'upstream returned 503 after 3 attempts');
    const health = registry.health('vendor');
    assert.equal(health.lastError, 'upstream returned 503 after 3 attempts');
    assert.ok(health.checkedAt, 'a health record must carry when it was taken');
  });

  it('spends no money producing a health snapshot', () => {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, OPTIONS);
    const registry = createProviderRegistry(clock, circuit);
    const provider = createMockProvider({ providerId: 'vendor', billable: true });
    registry.register(provider, { certification: 'certified' });
    const selector = createProviderSelector(registry, circuit, {
      preference: ['vendor'],
      failoverEnabled: true,
      realRequestsEnabled: true,
      requireCertification: true,
    });
    const catalog = createFeatureCatalog();
    registerCortexFeatures(catalog);
    const prompts = createPromptRegistry();
    registerCortexPrompts(prompts);

    buildHealthSnapshot({
      registry,
      selector,
      catalog,
      prompts,
      clock,
      platformVersion: 'test',
      contractVersion: 'test',
    });
    // An uptime probe that costs a model call is a probe that bills the platform
    // once a minute forever.
    assert.equal(provider.calls.length, 0);
  });
});

describe('H10 — timeout behaviour', () => {
  it('reports a deadline expiry as a provider timeout', async () => {
    await assert.rejects(
      () =>
        withTimeout(5, 'vendor', (handle) =>
          new Promise((_resolve, reject) => {
            handle.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
        ),
      (error: unknown) => error instanceof AIError && error.code === 'PROVIDER_TIMEOUT',
    );
  });

  it('passes an abort signal the adapter can act on', async () => {
    let sawAbort = false;
    await withTimeout(5, 'vendor', (handle) =>
      new Promise<string>((resolve) => {
        handle.signal.addEventListener('abort', () => {
          sawAbort = true;
          resolve('cancelled');
        }, { once: true });
      }),
    );
    assert.equal(sawAbort, true);
  });

  it('does not rewrite an unrelated failure as a timeout', async () => {
    const original = new AIError('PROVIDER_AUTH_FAILED', 'bad key');
    await assert.rejects(
      () => withTimeout(10_000, 'vendor', () => Promise.reject(original)),
      (error: unknown) => error === original,
    );
  });

  it('surfaces a hung provider as a timeout through the governed path', async () => {
    const { plane, provider, backup } = buildTestPlane({ env: { AI_WORKFLOW_DEADLINE_MS: '5000' } });
    provider.setScenario('hang');
    backup.setScenario('hang');

    await assert.rejects(
      () => plane.execute(envelope('cortex.narrative', narrativeInput()), AUTH),
      (error: unknown) => error instanceof AIError && error.code === 'PROVIDER_TIMEOUT',
    );
  });
});
