/**
 * Provider layer tests: circuit breaker, retry scheduling, capability-based
 * selection, and the two real vendor adapters driven against a stub `fetch`.
 *
 * The adapter tests exist to prove the multi-provider abstraction is real. They
 * assert that each adapter maps the SAME provider-neutral invocation onto its
 * own vendor wire format — including the two places the vendors genuinely
 * differ (system prompt placement, JSON mode) — and normalises both back to one
 * completion shape.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createTestClock } from '../runtime/clock.ts';
import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createRetryScheduler, shouldFailover, shouldRetrySameProvider } from '../providers/retry.ts';
import { createProviderRegistry } from '../providers/registry.ts';
import { createProviderSelector, estimateCostMicroUsd } from '../providers/selector.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createOpenAIProvider } from '../providers/openaiProvider.ts';
import { createAnthropicProvider } from '../providers/anthropicProvider.ts';
import { recordEnv } from '../runtime/env.ts';
import { AIError } from '../contracts/errors.ts';
import type { AIProviderInvocation } from '../contracts/provider.ts';

const CIRCUIT = { failureThreshold: 3, openMs: 10_000, halfOpenSuccessesToClose: 2 };

const REQUIREMENTS = { structuredOutput: true, chatCompletions: true, minOutputTokens: 1_000 };

function invocation(overrides: Partial<AIProviderInvocation> = {}): AIProviderInvocation {
  return {
    requestId: 'req_1',
    correlationId: 'cor_1',
    modelId: 'test-model',
    generation: {
      messages: [
        { role: 'system', content: 'System rules.' },
        { role: 'user', content: 'User question.' },
      ],
      responseFormat: 'text',
      temperature: 0.4,
      maxOutputTokens: 500,
    },
    attempt: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('circuit breaker', () => {
  it('stays closed below the failure threshold', () => {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    circuit.recordFailure('p');
    circuit.recordFailure('p');
    assert.equal(circuit.stateOf('p'), 'closed');
    assert.equal(circuit.canAttempt('p'), true);
  });

  it('opens at the threshold and reports the transition once', () => {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    assert.equal(circuit.recordFailure('p'), false);
    assert.equal(circuit.recordFailure('p'), false);
    assert.equal(circuit.recordFailure('p'), true, 'third failure opens the circuit');
    assert.equal(circuit.stateOf('p'), 'open');
    assert.equal(circuit.canAttempt('p'), false);
  });

  it('a success resets the consecutive failure count', () => {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    circuit.recordFailure('p');
    circuit.recordFailure('p');
    circuit.recordSuccess('p');
    circuit.recordFailure('p');
    circuit.recordFailure('p');
    assert.equal(circuit.stateOf('p'), 'closed');
  });

  it('half-opens after the cool-down and admits exactly one probe', () => {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    for (let i = 0; i < 3; i += 1) circuit.recordFailure('p');

    clock.advance(CIRCUIT.openMs - 1);
    assert.equal(circuit.canAttempt('p'), false);

    clock.advance(1);
    assert.equal(circuit.stateOf('p'), 'half_open');
    assert.equal(circuit.canAttempt('p'), true, 'first probe admitted');
    // Releasing all waiting traffic at once would re-create the overload the
    // breaker exists to prevent.
    assert.equal(circuit.canAttempt('p'), false, 'second concurrent probe rejected');
  });

  it('closes only after the configured number of half-open successes', () => {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    for (let i = 0; i < 3; i += 1) circuit.recordFailure('p');
    clock.advance(CIRCUIT.openMs);

    circuit.canAttempt('p');
    circuit.recordSuccess('p');
    assert.equal(circuit.stateOf('p'), 'half_open', 'one success is not enough');

    circuit.canAttempt('p');
    circuit.recordSuccess('p');
    assert.equal(circuit.stateOf('p'), 'closed');
  });

  it('a failed probe re-opens immediately with a fresh cool-down', () => {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    for (let i = 0; i < 3; i += 1) circuit.recordFailure('p');
    clock.advance(CIRCUIT.openMs);

    circuit.canAttempt('p');
    assert.equal(circuit.recordFailure('p'), true, 'failed probe re-opens the circuit');
    assert.equal(circuit.stateOf('p'), 'open');

    clock.advance(CIRCUIT.openMs - 1);
    assert.equal(circuit.stateOf('p'), 'open', 'cool-down restarted from the probe failure');
  });

  it('tracks providers independently', () => {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    for (let i = 0; i < 3; i += 1) circuit.recordFailure('p');
    assert.equal(circuit.stateOf('p'), 'open');
    assert.equal(circuit.stateOf('q'), 'closed');
  });
});

describe('retry scheduling', () => {
  const options = { baseDelayMs: 100, maxDelayMs: 1_000, jitterPercent: 0 };

  it('never waits before the first attempt', () => {
    const scheduler = createRetryScheduler(() => Promise.resolve(), () => 0.5);
    assert.equal(scheduler.delayFor(1, options), 0);
  });

  it('grows exponentially and stops at the ceiling', () => {
    const scheduler = createRetryScheduler(() => Promise.resolve(), () => 0.5);
    assert.equal(scheduler.delayFor(2, options), 100);
    assert.equal(scheduler.delayFor(3, options), 200);
    assert.equal(scheduler.delayFor(4, options), 400);
    assert.equal(scheduler.delayFor(10, options), 1_000, 'capped at maxDelayMs');
  });

  it('applies jitter symmetrically so the expected delay is unchanged', () => {
    const jittered = { ...options, jitterPercent: 50 };
    const low = createRetryScheduler(() => Promise.resolve(), () => 0).delayFor(2, jittered);
    const mid = createRetryScheduler(() => Promise.resolve(), () => 0.5).delayFor(2, jittered);
    const high = createRetryScheduler(() => Promise.resolve(), () => 1).delayFor(2, jittered);
    assert.equal(low, 50);
    assert.equal(mid, 100, 'centred jitter leaves the mean at the computed delay');
    assert.equal(high, 150);
  });

  it('retries only what the taxonomy marks retryable', () => {
    const retryable = new AIError('PROVIDER_UNAVAILABLE', 'down');
    const terminal = new AIError('VALIDATION_FAILED', 'bad input');
    assert.equal(shouldRetrySameProvider(retryable, 1, 2), true);
    assert.equal(shouldRetrySameProvider(retryable, 2, 2), false, 'attempts exhausted');
    assert.equal(shouldRetrySameProvider(terminal, 1, 2), false);
  });

  it('fails over only where another provider could help', () => {
    assert.equal(shouldFailover(new AIError('PROVIDER_TIMEOUT', 'slow')), true);
    assert.equal(shouldFailover(new AIError('OUTPUT_GUARD_BLOCKED', 'blocked')), true);
    assert.equal(shouldFailover(new AIError('CAPABILITY_DENIED', 'no')), false);
    assert.equal(shouldFailover(new AIError('VALIDATION_FAILED', 'no')), false);
  });
});

describe('provider registry and selector', () => {
  function build(
    options: {
      preference?: string[];
      fallback?: string;
      failover?: boolean;
      realRequests?: boolean;
      requireCertification?: boolean;
    } = {},
  ) {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    const registry = createProviderRegistry(clock, circuit);
    const selector = createProviderSelector(registry, circuit, {
      preference: options.preference ?? ['alpha', 'beta'],
      fallbackProviderId: options.fallback,
      failoverEnabled: options.failover ?? true,
      // These suites exercise ordering, capability matching and circuit
      // behaviour. The kill switch and certification gate have their own tests
      // below; here they are open so a rejection means what the test says.
      realRequestsEnabled: options.realRequests ?? true,
      requireCertification: options.requireCertification ?? false,
    });
    return { clock, circuit, registry, selector };
  }

  it('rejects a duplicate provider registration', () => {
    const { registry } = build();
    registry.register(createMockProvider({ providerId: 'alpha' }));
    assert.throws(() => registry.register(createMockProvider({ providerId: 'alpha' })), AIError);
  });

  it('orders candidates by configured preference, not registration order', () => {
    const { registry, selector } = build({ preference: ['beta', 'alpha'] });
    registry.register(createMockProvider({ providerId: 'alpha', priority: 1 }));
    registry.register(createMockProvider({ providerId: 'beta', priority: 2 }));
    assert.deepEqual(
      selector.select(REQUIREMENTS).map((candidate) => candidate.providerId),
      ['beta', 'alpha'],
    );
  });

  it('places the configured fallback last even when preference lists it first', () => {
    const { registry, selector } = build({ preference: ['beta', 'alpha'], fallback: 'beta' });
    registry.register(createMockProvider({ providerId: 'alpha' }));
    registry.register(createMockProvider({ providerId: 'beta' }));
    assert.deepEqual(
      selector.select(REQUIREMENTS).map((candidate) => candidate.providerId),
      ['alpha', 'beta'],
    );
  });

  it('returns a single candidate when failover is disabled', () => {
    const { registry, selector } = build({ failover: false });
    registry.register(createMockProvider({ providerId: 'alpha' }));
    registry.register(createMockProvider({ providerId: 'beta' }));
    assert.equal(selector.select(REQUIREMENTS).length, 1);
  });

  it('skips a provider with no credentials, and explains why', () => {
    const { registry, selector } = build();
    registry.register(createMockProvider({ providerId: 'alpha', credentials: false }));
    registry.register(createMockProvider({ providerId: 'beta' }));
    assert.deepEqual(
      selector.select(REQUIREMENTS).map((candidate) => candidate.providerId),
      ['beta'],
    );
    assert.equal(selector.explain(REQUIREMENTS).alpha, 'credentials not configured');
  });

  it('skips a provider whose circuit is open', () => {
    const { registry, circuit, selector } = build();
    registry.register(createMockProvider({ providerId: 'alpha' }));
    registry.register(createMockProvider({ providerId: 'beta' }));
    for (let i = 0; i < 3; i += 1) circuit.recordFailure('alpha');
    assert.deepEqual(
      selector.select(REQUIREMENTS).map((candidate) => candidate.providerId),
      ['beta'],
    );
  });

  it('skips a disabled provider', () => {
    const { registry, selector } = build();
    registry.register(createMockProvider({ providerId: 'alpha' }));
    registry.register(createMockProvider({ providerId: 'beta' }));
    registry.setEnabled('alpha', false);
    assert.equal(selector.explain(REQUIREMENTS).alpha, 'disabled');
  });

  it('skips a provider whose models cannot meet the token requirement', () => {
    const { registry, selector } = build({ preference: ['openai'] });
    registry.register(createOpenAIProvider({ env: recordEnv({ OPENAI_API_KEY: 'k' }) }));
    assert.equal(
      selector.explain({ ...REQUIREMENTS, minOutputTokens: 1_000_000 }).openai,
      'no model meets the requirements',
    );
  });

  it('throws NO_PROVIDER_AVAILABLE with the per-provider reasons attached', () => {
    const { registry, selector } = build();
    registry.register(createMockProvider({ providerId: 'alpha', credentials: false }));
    assert.throws(
      () => selector.select(REQUIREMENTS),
      (error: AIError) =>
        error.code === 'NO_PROVIDER_AVAILABLE' &&
        String(error.diagnostics).includes('credentials not configured'),
    );
  });

  it('picks the cheapest model that satisfies the requirements', () => {
    const { registry } = build();
    registry.register(createOpenAIProvider({ env: recordEnv({ OPENAI_API_KEY: 'k' }) }));
    const model = registry.selectModel('openai', REQUIREMENTS);
    // gpt-4o-mini is capable and an order of magnitude cheaper than gpt-4o.
    assert.equal(model?.modelId, 'gpt-4o-mini');
  });

  it('reports a deployment where only a non-production provider is usable', () => {
    const { registry } = build();
    registry.register(createMockProvider({ providerId: 'alpha' }));
    assert.ok(
      registry.validate().some((issue) => issue.includes('no production-ready AI provider')),
    );
  });

  it('reports a deployment with no credentials at all', () => {
    const { registry } = build();
    registry.register(createOpenAIProvider({ env: recordEnv({}) }));
    assert.ok(registry.validate().some((issue) => issue.includes('credentials')));
  });

  it('computes cost in integer micro-USD from the model rate card', () => {
    const { registry } = build();
    registry.register(createOpenAIProvider({ env: recordEnv({ OPENAI_API_KEY: 'k' }) }));
    const model = registry.selectModel('openai', REQUIREMENTS);
    assert.ok(model);
    // 1000 prompt tokens at 150 µUSD/1k + 500 completion at 600 µUSD/1k.
    assert.equal(
      estimateCostMicroUsd(model, { promptTokens: 1_000, completionTokens: 500 }),
      150 + 300,
    );
  });

  it('tracks health, promoting an answering provider out of unverified', () => {
    const { registry } = build();
    registry.register(createOpenAIProvider({ env: recordEnv({ OPENAI_API_KEY: 'k' }) }), {
      certification: 'unverified',
    });
    assert.equal(registry.health('openai').certification, 'unverified');
    registry.recordSuccess('openai', 420);
    const health = registry.health('openai');
    assert.equal(health.certification, 'certified');
    assert.equal(health.state, 'active');
    assert.equal(health.lastLatencyMs, 420);
  });
});

describe('OpenAI adapter', () => {
  const env = recordEnv({ OPENAI_API_KEY: 'sk-test' });

  function stubFetch(response: Response, capture?: { body?: unknown; headers?: HeadersInit }) {
    return async (_url: string, init: RequestInit) => {
      if (capture) {
        capture.body = JSON.parse(String(init.body));
        capture.headers = init.headers;
      }
      return response;
    };
  }

  it('reports missing credentials without attempting a call', async () => {
    const provider = createOpenAIProvider({ env: recordEnv({}) });
    assert.equal(provider.hasCredentials(), false);
    await assert.rejects(
      () => provider.invoke(invocation()),
      (error: AIError) => error.code === 'PROVIDER_AUTH_FAILED',
    );
  });

  it('sends messages in OpenAI chat format and normalises the completion', async () => {
    const capture: { body?: unknown } = {};
    const provider = createOpenAIProvider({
      env,
      fetchImpl: stubFetch(
        Response.json({
          model: 'gpt-4o-mini',
          choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
        }),
        capture,
      ),
    });

    const completion = await provider.invoke(invocation({ modelId: 'gpt-4o-mini' }));

    const body = capture.body as Record<string, unknown>;
    assert.equal(body.model, 'gpt-4o-mini');
    assert.deepEqual((body.messages as { role: string }[]).map((m) => m.role), ['system', 'user']);
    assert.equal(body.response_format, undefined, 'text requests set no response_format');
    assert.equal(completion.content, 'answer');
    assert.deepEqual(completion.usage, { promptTokens: 11, completionTokens: 5, totalTokens: 16 });
  });

  it('requests native JSON mode for structured features', async () => {
    const capture: { body?: unknown } = {};
    const provider = createOpenAIProvider({
      env,
      fetchImpl: stubFetch(
        Response.json({ choices: [{ message: { content: '{"a":1}' } }] }),
        capture,
      ),
    });
    await provider.invoke(
      invocation({
        generation: {
          messages: [{ role: 'user', content: 'json please' }],
          responseFormat: 'json_object',
          temperature: 0,
          maxOutputTokens: 100,
        },
      }),
    );
    assert.deepEqual((capture.body as Record<string, unknown>).response_format, {
      type: 'json_object',
    });
  });

  it('maps HTTP failures onto the taxonomy', async () => {
    const cases: [number, string][] = [
      [401, 'PROVIDER_AUTH_FAILED'],
      [429, 'PROVIDER_RATE_LIMITED'],
      [500, 'PROVIDER_UNAVAILABLE'],
      [400, 'INVALID_MODEL_OUTPUT'],
    ];
    for (const [status, code] of cases) {
      const provider = createOpenAIProvider({
        env,
        fetchImpl: stubFetch(new Response('upstream detail', { status })),
      });
      await assert.rejects(
        () => provider.invoke(invocation()),
        (error: AIError) => error.code === code,
        `HTTP ${status} should map to ${code}`,
      );
    }
  });

  it('keeps the vendor error body out of the caller-facing message', async () => {
    const provider = createOpenAIProvider({
      env,
      fetchImpl: stubFetch(new Response('prompt echoed back: client revenue is 4.2M', { status: 400 })),
    });
    await assert.rejects(
      () => provider.invoke(invocation()),
      (error: AIError) =>
        !error.message.includes('4.2M') && String(error.diagnostics).includes('4.2M'),
    );
  });

  it('treats an empty completion as a retryable model-output fault', async () => {
    const provider = createOpenAIProvider({
      env,
      fetchImpl: stubFetch(Response.json({ choices: [{ message: { content: '' } }] })),
    });
    await assert.rejects(
      () => provider.invoke(invocation()),
      (error: AIError) => error.code === 'INVALID_MODEL_OUTPUT' && error.retryable,
    );
  });

  it('treats a transport failure as provider unavailability', async () => {
    const provider = createOpenAIProvider({
      env,
      fetchImpl: () => Promise.reject(new Error('ECONNRESET')),
    });
    await assert.rejects(
      () => provider.invoke(invocation()),
      (error: AIError) => error.code === 'PROVIDER_UNAVAILABLE',
    );
  });
});

describe('Anthropic adapter', () => {
  const env = recordEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });

  function stubFetch(response: Response, capture?: { body?: unknown }) {
    return async (_url: string, init: RequestInit) => {
      if (capture) capture.body = JSON.parse(String(init.body));
      return response;
    };
  }

  it('lifts the system prompt out of the message array', async () => {
    // The concrete difference that proves the neutral contract is neutral:
    // OpenAI takes system as a message, Anthropic as a top-level parameter.
    const capture: { body?: unknown } = {};
    const provider = createAnthropicProvider({
      env,
      fetchImpl: stubFetch(
        Response.json({
          model: 'claude-haiku-4-5-20251001',
          content: [{ type: 'text', text: 'answer' }],
          usage: { input_tokens: 12, output_tokens: 6 },
          stop_reason: 'end_turn',
        }),
        capture,
      ),
    });

    const completion = await provider.invoke(invocation({ modelId: 'claude-haiku-4-5-20251001' }));

    const body = capture.body as Record<string, unknown>;
    assert.equal(body.system, 'System rules.');
    assert.deepEqual((body.messages as { role: string }[]).map((m) => m.role), ['user']);
    assert.equal(completion.content, 'answer');
    assert.deepEqual(completion.usage, { promptTokens: 12, completionTokens: 6, totalTokens: 18 });
  });

  it('prefills an assistant turn for JSON and restores the brace on the way out', async () => {
    const capture: { body?: unknown } = {};
    const provider = createAnthropicProvider({
      env,
      fetchImpl: stubFetch(
        Response.json({ content: [{ type: 'text', text: '"a":1}' }] }),
        capture,
      ),
    });

    const completion = await provider.invoke(
      invocation({
        generation: {
          messages: [{ role: 'user', content: 'json please' }],
          responseFormat: 'json_object',
          temperature: 0,
          maxOutputTokens: 100,
        },
      }),
    );

    const turns = (capture.body as Record<string, unknown>).messages as { role: string; content: string }[];
    assert.equal(turns[turns.length - 1].content, '{');
    assert.equal(completion.content, '{"a":1}');
    assert.deepEqual(JSON.parse(completion.content), { a: 1 });
  });

  it('ensures the conversation opens with a user turn', async () => {
    const capture: { body?: unknown } = {};
    const provider = createAnthropicProvider({
      env,
      fetchImpl: stubFetch(Response.json({ content: [{ type: 'text', text: 'ok' }] }), capture),
    });
    await provider.invoke(
      invocation({
        generation: {
          messages: [{ role: 'system', content: 'only a system prompt' }],
          responseFormat: 'text',
          temperature: 0,
          maxOutputTokens: 100,
        },
      }),
    );
    const turns = (capture.body as Record<string, unknown>).messages as { role: string }[];
    assert.equal(turns[0].role, 'user');
  });

  it('maps 529 overloaded to provider unavailability', async () => {
    const provider = createAnthropicProvider({
      env,
      fetchImpl: stubFetch(new Response('overloaded', { status: 529 })),
    });
    await assert.rejects(
      () => provider.invoke(invocation()),
      (error: AIError) => error.code === 'PROVIDER_UNAVAILABLE',
    );
  });

  it('is skipped rather than failing when no key is configured', () => {
    assert.equal(createAnthropicProvider({ env: recordEnv({}) }).hasCredentials(), false);
  });
});
