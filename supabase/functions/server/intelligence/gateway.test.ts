import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupMockIntelligenceTestEnv, teardownIntelligenceTestEnv } from './testSetup.ts';
import { intelligenceGenerate, createIntelligenceRequest } from './gateway.ts';
import {
  registerProvider,
  getProvider,
  resetProviderRegistryForTests,
} from './providerRegistry.ts';
import { createMockProvider } from './providers/mockProvider.ts';
import { IntelligenceGatewayError } from './errors.ts';
import { getRecentTelemetry } from './telemetry.ts';

describe('Intelligence Gateway', () => {
  beforeEach(() => {
    setupMockIntelligenceTestEnv({
      INTELLIGENCE_PROVIDER: 'mock',
      INTELLIGENCE_MAX_RETRIES: '1',
      INTELLIGENCE_TIMEOUT_MS: '5000',
    });
  });

  afterEach(() => {
    teardownIntelligenceTestEnv();
  });

  it('returns deterministic mock success for narrative', async () => {
    const result = await intelligenceGenerate(
      createIntelligenceRequest({
        feature: 'narrative',
        modelProfile: 'narrative-default',
        messages: [{ role: 'user', content: 'Explain why now.' }],
        responseFormat: 'text',
      }),
    );
    assert.ok(result.content.includes('Mock narrative'));
    assert.equal(result.provider, 'mock');
    assert.equal(result.attempt, 1);
  });

  it('rejects duplicate provider registration', () => {
    assert.throws(() => registerProvider(createMockProvider()), /Duplicate provider registration/);
  });

  it('fails for missing provider', async () => {
    setupMockIntelligenceTestEnv({ INTELLIGENCE_PROVIDER: 'does-not-exist' });
    await assert.rejects(
      () =>
        intelligenceGenerate(
          createIntelligenceRequest({
            feature: 'narrative',
            modelProfile: 'narrative-default',
            messages: [{ role: 'user', content: 'test' }],
            responseFormat: 'text',
          }),
        ),
      IntelligenceGatewayError,
    );
  });

  it('fails for disabled provider scenario', async () => {
    await assert.rejects(
      () =>
        intelligenceGenerate(
          createIntelligenceRequest({
            feature: 'narrative',
            modelProfile: 'narrative-default',
            messages: [{ role: 'user', content: 'test' }],
            responseFormat: 'text',
            metadata: { scenario: 'disabled' },
          }),
        ),
      (err: IntelligenceGatewayError) => err.providerError.code === 'PROVIDER_DISABLED',
    );
  });

  it('fails for invalid json output', async () => {
    await assert.rejects(
      () =>
        intelligenceGenerate(
          createIntelligenceRequest({
            feature: 'analysis',
            modelProfile: 'analysis-default',
            messages: [{ role: 'user', content: 'test' }],
            responseFormat: 'json_object',
            metadata: { scenario: 'invalid_json' },
          }),
        ),
      (err: IntelligenceGatewayError) => err.providerError.code === 'INVALID_OUTPUT',
    );
  });

  it('records telemetry on success', async () => {
    await intelligenceGenerate(
      createIntelligenceRequest({
        feature: 'chat',
        modelProfile: 'chat-default',
        messages: [{ role: 'user', content: 'hello' }],
        responseFormat: 'text',
      }),
    );
    const records = getRecentTelemetry(5);
    assert.ok(records.some((r) => r.outcome === 'success' && r.feature === 'chat'));
  });

  it('preserves stable request id', async () => {
    const requestId = 'req-stable-123';
    const result = await intelligenceGenerate(
      createIntelligenceRequest({
        requestId,
        feature: 'narrative',
        modelProfile: 'narrative-default',
        messages: [{ role: 'user', content: 'test' }],
        responseFormat: 'text',
      }),
    );
    assert.equal(result.requestId, requestId);
  });
});

describe('Provider Registry', () => {
  beforeEach(() => setupMockIntelligenceTestEnv());
  afterEach(() => teardownIntelligenceTestEnv());

  it('lists registered providers', () => {
    const openai = getProvider('openai');
    const mock = getProvider('mock');
    assert.equal(openai.adapter.providerId, 'openai');
    assert.equal(mock.adapter.providerId, 'mock');
  });
});
