/**
 * The generic OpenAI-compatible self-hosted adapter — AI-01 Batch 4E.
 *
 * Driven against a stub `fetch`, like every other adapter suite: NO NETWORK,
 * NO VENDOR ACCOUNT, NO SPEND. What is under test is the adapter's whole
 * contract with the control plane —
 *
 *   one attempt, never a retry
 *   the OpenAI-compatible wire format in, a normalized completion out
 *   every failure mapped onto the platform taxonomy
 *   the Authorization header present exactly when a credential resolved
 *   the tenant handed to the credential layer and NEVER to the endpoint
 *
 * — plus the one rule this adapter has that no previous adapter needed: a
 * credential-optional provider must not become a way around a customer's
 * `tenant_only` funding policy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSelfHostedProvider } from '../providers/selfHostedProvider.ts';
import { validateSelfHostedDefinition } from '../providers/selfHosted/definition.ts';
import type { SelfHostedProviderDefinition } from '../providers/selfHosted/definition.ts';
import type { FetchLike } from '../providers/openaiProvider.ts';
import type { AIProviderInvocation } from '../contracts/provider.ts';
import type {
  CredentialTenant,
  ProviderCredentialAvailability,
  ProviderCredentialResolver,
  ResolvedProviderCredential,
} from '../providers/credentials/contracts.ts';
import type { AIProviderConfigurationRecord } from '../providers/credentials/credentialStore.ts';
import { createExecutionFundingLatch, unresolvedFunding } from '../providers/credentials/executionFunding.ts';
import { AIError } from '../contracts/errors.ts';

const PROVIDER_ID = 'marq_inference';
const MODEL_ID = 'llama-3.3-70b-instruct';
const BASE_URL = 'https://inference.marq.example.com/v1';
const ORGANIZATION_ID = 'org-4e';

// ── Fixtures ────────────────────────────────────────────────────────────────

function definitionFor(credentialRequired: boolean): SelfHostedProviderDefinition {
  const record: AIProviderConfigurationRecord = {
    configurationId: 'pvc_selfhosted1',
    providerKey: PROVIDER_ID,
    displayName: 'MARQ Inference',
    scope: 'platform',
    enabled: true,
    certification: 'certified',
    configuration: {
      runtime: 'openai_compatible',
      baseUrl: BASE_URL,
      credentialRequired: credentialRequired ? 'true' : 'false',
      'model.0.id': MODEL_ID,
      'model.0.textGeneration': 'true',
      'model.0.structuredOutput': 'true',
      'model.0.chatCompletions': 'true',
      'model.0.zeroDataRetention': 'true',
      'model.0.maxOutputTokens': '8192',
      'model.0.maxContextTokens': '128000',
      'model.0.promptMicroUsdPer1k': '0',
      'model.0.completionMicroUsdPer1k': '0',
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'operator',
    updatedBy: 'operator',
  };
  const result = validateSelfHostedDefinition(record);
  if (result.ok !== true) throw new Error(`fixture is invalid: ${result.reasons.join('; ')}`);
  return result.definition;
}

/**
 * A resolver double.
 *
 * Records the tenant it was asked about, so the test can prove the adapter
 * hands it over rather than reading it — and prove it never reaches the wire.
 */
function stubResolver(
  answer: ResolvedProviderCredential | undefined,
  options: { configured?: boolean } = {},
): ProviderCredentialResolver & { readonly seen: (CredentialTenant | undefined)[] } {
  const seen: (CredentialTenant | undefined)[] = [];
  const availability: ProviderCredentialAvailability = {
    providerId: PROVIDER_ID,
    configured: options.configured ?? answer !== undefined,
    source: answer?.source ?? 'none',
    environmentCredentialPresent: false,
    checkedAt: '2026-09-01T00:00:00.000Z',
  };
  return {
    seen,
    describe: () => availability,
    resolve: (_providerId, tenant) => {
      seen.push(tenant);
      return Promise.resolve(answer);
    },
    refresh: () => Promise.resolve(),
    snapshot: () => [availability],
  };
}

interface Captured {
  readonly url: string;
  readonly init: RequestInit;
}

function capturingFetch(respond: () => Response | Promise<Response>): {
  readonly fetchImpl: FetchLike;
  readonly calls: Captured[];
} {
  const calls: Captured[] = [];
  return {
    calls,
    fetchImpl: (url, init) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(respond());
    },
  };
}

function completionResponse(
  overrides: Record<string, unknown> = {},
  status = 200,
): Response {
  return Response.json(
    {
      model: 'server-internal-name',
      choices: [{ message: { content: 'Self-hosted answer.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 },
      ...overrides,
    },
    { status },
  );
}

function invocation(overrides: Partial<AIProviderInvocation> = {}): AIProviderInvocation {
  return {
    requestId: 'req_4e_1',
    correlationId: 'cor_4e_1',
    modelId: MODEL_ID,
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

async function expectAIError(
  run: () => Promise<unknown>,
  code: string,
): Promise<AIError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AIError, `expected an AIError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  throw new assert.AssertionError({ message: `expected ${code} to be thrown` });
}

const MANAGED: ResolvedProviderCredential = {
  secret: 'self-hosted-secret-value',
  source: 'managed',
  category: 'platform_managed',
  credentialId: 'pvk_1',
};

// ── The happy path ──────────────────────────────────────────────────────────

describe('self-hosted adapter — successful completion', () => {
  it('normalizes a completion and its usage', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    const completion = await adapter.invoke(invocation());
    assert.equal(completion.content, 'Self-hosted answer.');
    assert.deepEqual(completion.usage, {
      promptTokens: 31,
      completionTokens: 7,
      totalTokens: 38,
    });
    assert.equal(completion.finishReason, 'stop');
    // The SELECTED model wins over whatever the server echoed, so cost
    // attribution and the completion cannot disagree about what ran.
    assert.equal(completion.modelId, MODEL_ID);
  });

  it('dials exactly the validated chat completions URL, once', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    await adapter.invoke(invocation());
    assert.equal(transport.calls.length, 1, 'the adapter must make exactly one attempt');
    assert.equal(transport.calls[0].url, `${BASE_URL}/chat/completions`);
    assert.equal(transport.calls[0].init.method, 'POST');
  });

  it('sends the OpenAI-compatible request body', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    await adapter.invoke(invocation({ generation: {
      messages: [
        { role: 'system', content: 'System rules.' },
        { role: 'user', content: 'User question.' },
      ],
      responseFormat: 'json_object',
      temperature: 0.2,
      maxOutputTokens: 900,
    } }));

    const body = JSON.parse(String(transport.calls[0].init.body)) as Record<string, unknown>;
    assert.equal(body.model, MODEL_ID);
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_tokens, 900);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'System rules.' },
      { role: 'user', content: 'User question.' },
    ]);
  });

  it('propagates the request id for correlation, and nothing else', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    await adapter.invoke(invocation({ requestId: 'req_correlate_me' }));
    const headers = transport.calls[0].init.headers as Record<string, string>;
    assert.equal(headers['X-Request-Id'], 'req_correlate_me');
    assert.equal(headers['Content-Type'], 'application/json');
    // No correlation id, no organization, no actor. One trace handle and no
    // identity.
    assert.deepEqual(Object.keys(headers).sort(), ['Content-Type', 'X-Request-Id']);
  });
});

// ── Credentials ─────────────────────────────────────────────────────────────

describe('self-hosted adapter — credentials', () => {
  it('omits Authorization when the provider needs no credential', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    const completion = await adapter.invoke(invocation());
    const headers = transport.calls[0].init.headers as Record<string, string>;
    // Not an empty header and not `Bearer undefined` — absent.
    assert.equal('Authorization' in headers, false);
    assert.equal(completion.credentialSource, 'none');
  });

  it('sends Authorization when a credential resolves', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(true),
      credentials: stubResolver(MANAGED),
      fetchImpl: transport.fetchImpl,
    });

    const completion = await adapter.invoke(invocation());
    const headers = transport.calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer self-hosted-secret-value');
    assert.equal(completion.credentialSource, 'platform_managed');
  });

  it('reports a customer BYOK credential as its own category', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(true),
      credentials: stubResolver({
        secret: 'tenant-key',
        source: 'managed',
        category: 'customer_byok',
        credentialId: 'pvk_tenant',
        organizationId: ORGANIZATION_ID,
      }),
      fetchImpl: transport.fetchImpl,
    });

    const completion = await adapter.invoke(invocation());
    assert.equal(completion.credentialSource, 'customer_byok');
  });

  it('refuses when a required credential does not resolve, and dials nothing', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(true),
      credentials: stubResolver(undefined),
      fetchImpl: transport.fetchImpl,
    });

    const error = await expectAIError(() => adapter.invoke(invocation()), 'PROVIDER_AUTH_FAILED');
    assert.equal(transport.calls.length, 0, 'a refused request must not reach the endpoint');
    // The caller-facing message names none of the several server-side reasons.
    assert.equal(error.message, 'The AI provider is not configured.');
  });

  it('refuses a whitespace-only credential rather than sending it', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(true),
      credentials: stubResolver({ secret: '   ', source: 'managed', category: 'platform_managed' }),
      fetchImpl: transport.fetchImpl,
    });

    await expectAIError(() => adapter.invoke(invocation()), 'PROVIDER_AUTH_FAILED');
    assert.equal(transport.calls.length, 0);
  });

  it('reports credential availability through the shared resolver', () => {
    const configured = createSelfHostedProvider({
      definition: definitionFor(true),
      credentials: stubResolver(MANAGED),
    });
    assert.equal(configured.hasCredentials(), true);
    assert.equal(configured.credentialStatus?.().source, 'managed');

    const bare = createSelfHostedProvider({
      definition: definitionFor(true),
      credentials: stubResolver(undefined),
    });
    assert.equal(bare.hasCredentials(), false);
    assert.equal(bare.credentialStatus?.().source, 'none');
  });
});

// ── Tenancy ─────────────────────────────────────────────────────────────────

describe('self-hosted adapter — tenancy', () => {
  it('hands the tenant to the credential layer and never to the endpoint', async () => {
    const transport = capturingFetch(() => completionResponse());
    const credentials = stubResolver(MANAGED);
    const adapter = createSelfHostedProvider({
      definition: definitionFor(true),
      credentials,
      fetchImpl: transport.fetchImpl,
    });

    const tenant: CredentialTenant = {
      organizationId: ORGANIZATION_ID,
      membershipVerified: true,
    };
    await adapter.invoke(invocation({ tenant }));

    assert.deepEqual(credentials.seen, [tenant], 'the resolver is the only consumer of the tenant');

    // THE CLAIM THAT MATTERS: nothing about the tenant reaches the wire.
    const serialized = JSON.stringify({
      url: transport.calls[0].url,
      headers: transport.calls[0].init.headers,
      body: String(transport.calls[0].init.body),
    });
    assert.equal(serialized.includes(ORGANIZATION_ID), false);
    assert.equal(serialized.includes('membershipVerified'), false);
    assert.equal(serialized.includes('organizationId'), false);
  });

  it('does not widen a tenant_only policy through a credential-optional provider', async () => {
    // THE BATCH 4D CONTAINMENT, IN THE ONE PLACE 4E COULD HAVE OPENED IT.
    // `resolve` returns undefined for a provider whose profile is not
    // `required`, without ever reaching its own funding refusal — so an
    // adapter that simply executed on "no credential" would serve a
    // `tenant_only` organization from MARQ-funded infrastructure.
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    const latch = createExecutionFundingLatch(unresolvedFunding(ORGANIZATION_ID));
    latch.observeTenantOnly();

    await expectAIError(
      () =>
        adapter.invoke(
          invocation({
            tenant: {
              organizationId: ORGANIZATION_ID,
              membershipVerified: true,
              funding: latch,
            },
          }),
        ),
      'PROVIDER_AUTH_FAILED',
    );
    assert.equal(transport.calls.length, 0, 'a tenant_only execution must not reach the endpoint');
  });

  it('refuses an unresolved funding policy for the same reason', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    // `unresolved` constrains exactly as `tenant_only` does — the whole point of
    // the Batch 4D remediation, and it must not loosen here.
    const latch = createExecutionFundingLatch(unresolvedFunding(ORGANIZATION_ID));
    await expectAIError(
      () =>
        adapter.invoke(
          invocation({
            tenant: {
              organizationId: ORGANIZATION_ID,
              membershipVerified: true,
              funding: latch,
            },
          }),
        ),
      'PROVIDER_AUTH_FAILED',
    );
    assert.equal(transport.calls.length, 0);
  });

  it('serves a platform-funded tenant on a credential-optional provider', async () => {
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    const completion = await adapter.invoke(
      invocation({
        tenant: { organizationId: ORGANIZATION_ID, membershipVerified: true },
      }),
    );
    assert.equal(completion.content, 'Self-hosted answer.');
    assert.equal(transport.calls.length, 1);
  });

  it('treats an unverified membership as no tenant at all', async () => {
    // The AI_ALLOW_DEFAULT_ORGANIZATION fallback confers no tenant identity, so
    // it neither grants a customer's credential nor inherits their policy —
    // the same reading the credential resolver applies.
    const transport = capturingFetch(() => completionResponse());
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: transport.fetchImpl,
    });

    const latch = createExecutionFundingLatch(unresolvedFunding(ORGANIZATION_ID));
    latch.observeTenantOnly();
    const completion = await adapter.invoke(
      invocation({
        tenant: {
          organizationId: ORGANIZATION_ID,
          membershipVerified: false,
          funding: latch,
        },
      }),
    );
    assert.equal(completion.content, 'Self-hosted answer.');
  });
});

// ── Failure taxonomy ────────────────────────────────────────────────────────

describe('self-hosted adapter — failure taxonomy', () => {
  function adapterFor(respond: () => Response | Promise<Response>) {
    const transport = capturingFetch(respond);
    return {
      transport,
      adapter: createSelfHostedProvider({
        definition: definitionFor(false),
        credentials: stubResolver(undefined, { configured: true }),
        fetchImpl: transport.fetchImpl,
      }),
    };
  }

  it('maps 401 and 403 to PROVIDER_AUTH_FAILED', async () => {
    for (const status of [401, 403]) {
      const { adapter } = adapterFor(() => new Response('denied', { status }));
      const error = await expectAIError(
        () => adapter.invoke(invocation()),
        'PROVIDER_AUTH_FAILED',
      );
      assert.match(String(error.diagnostics), new RegExp(`HTTP ${status}`));
    }
  });

  it('maps 429 to PROVIDER_RATE_LIMITED and reads retry-after', async () => {
    const { adapter } = adapterFor(
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '12' } }),
    );
    const error = await expectAIError(
      () => adapter.invoke(invocation()),
      'PROVIDER_RATE_LIMITED',
    );
    assert.equal(error.retryAfterSeconds, 12);
  });

  it('maps 5xx to PROVIDER_UNAVAILABLE', async () => {
    for (const status of [500, 502, 503]) {
      const { adapter } = adapterFor(() => new Response('boom', { status }));
      await expectAIError(() => adapter.invoke(invocation()), 'PROVIDER_UNAVAILABLE');
    }
  });

  it('maps a 4xx rejection to a non-retryable INVALID_MODEL_OUTPUT', async () => {
    const { adapter } = adapterFor(() => new Response('bad request', { status: 400 }));
    const error = await expectAIError(() => adapter.invoke(invocation()), 'INVALID_MODEL_OUTPUT');
    assert.equal(error.retryable, false);
  });

  it('maps a transport failure to PROVIDER_UNAVAILABLE', async () => {
    const adapter = createSelfHostedProvider({
      definition: definitionFor(false),
      credentials: stubResolver(undefined, { configured: true }),
      fetchImpl: () => Promise.reject(new TypeError('connect ECONNREFUSED')),
    });
    const error = await expectAIError(() => adapter.invoke(invocation()), 'PROVIDER_UNAVAILABLE');
    assert.match(String(error.diagnostics), /ECONNREFUSED/);
  });

  it('maps malformed JSON to INVALID_MODEL_OUTPUT', async () => {
    const { adapter } = adapterFor(
      () =>
        new Response('{"choices": [', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expectAIError(() => adapter.invoke(invocation()), 'INVALID_MODEL_OUTPUT');
  });

  it('maps an empty or absent completion to INVALID_MODEL_OUTPUT', async () => {
    for (const payload of [
      { choices: [{ message: { content: '' }, finish_reason: 'length' }] },
      { choices: [{ message: {}, finish_reason: 'stop' }] },
      { choices: [] },
      {},
    ]) {
      const { adapter } = adapterFor(() => Response.json(payload));
      await expectAIError(() => adapter.invoke(invocation()), 'INVALID_MODEL_OUTPUT');
    }
  });

  it('never leaks the credential into a diagnostic', async () => {
    const transport = capturingFetch(() => new Response('denied', { status: 401 }));
    const adapter = createSelfHostedProvider({
      definition: definitionFor(true),
      credentials: stubResolver(MANAGED),
      fetchImpl: transport.fetchImpl,
    });
    const error = await expectAIError(
      () => adapter.invoke(invocation()),
      'PROVIDER_AUTH_FAILED',
    );
    const serialized = `${error.message} ${String(error.diagnostics)}`;
    assert.equal(serialized.includes(MANAGED.secret), false);
  });

  it('defaults absent usage to zero rather than to NaN', async () => {
    const { adapter } = adapterFor(() =>
      Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    );
    const completion = await adapter.invoke(invocation());
    assert.deepEqual(completion.usage, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });
});
