/**
 * Self-hosted provider HYDRATION and RUNTIME GOVERNANCE — AI-01 Batch 4E.
 *
 * The suite that answers "what does a stored row actually DO to the running
 * platform?" It uses the real registry, the real selector, the real circuit
 * breaker, the real credential resolver with its real precedence and the real
 * AES-256-GCM cipher. The substitutions are time, identifiers, the storage
 * backend and the network — nothing that decides an outcome.
 *
 * FOUR CLAIMS IT EXISTS TO HOLD:
 *
 *   Only a VALIDATED definition ever reaches the registry, so no stored
 *   endpoint the policy refused is dialleable.
 *
 *   A self-hosted provider is governed by every control the built-in ones are:
 *   the real-request kill switch, certification, enablement and the model allow
 *   list. Nothing about it is special-cased anywhere above `ai/providers/`.
 *
 *   REGISTERING ONE CHANGES NOTHING ABOUT OPENAI OR ANTHROPIC. Their
 *   descriptors, credential resolution and eligibility are asserted before and
 *   after hydration.
 *
 *   Storage does not self-certify. A model row for a model no definition
 *   declares creates no runtime capability, and an uncertified definition
 *   serves nothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createTestClock } from '../runtime/clock.ts';
import { recordEnv } from '../runtime/env.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createProviderRegistry, OPEN_MODEL_POLICY } from '../providers/registry.ts';
import type { ModelPolicy, ProviderRegistry } from '../providers/registry.ts';
import { createProviderSelector } from '../providers/selector.ts';
import { createSelfHostedRegistrar } from '../providers/selfHosted/registrar.ts';
import { createOpenAIProvider, OPENAI_CREDENTIAL_PROFILE } from '../providers/openaiProvider.ts';
import {
  createAnthropicProvider,
  ANTHROPIC_CREDENTIAL_PROFILE,
} from '../providers/anthropicProvider.ts';
import { createProviderCredentialResolver } from '../providers/credentials/resolver.ts';
import { createMemoryProviderAdministrationStore } from '../providers/credentials/credentialStore.ts';
import type {
  AIProviderCertificationState,
  AIProviderConfigurationRecord,
  ProviderAdministrationStore,
} from '../providers/credentials/credentialStore.ts';
import { createSecretCipher, parseRootKey } from '../providers/credentials/secretCipher.ts';
import type { FetchLike } from '../providers/openaiProvider.ts';

const ROOT_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const PROVIDER_ID = 'marq_inference';
const MODEL_ID = 'llama-3.3-70b-instruct';
const CIRCUIT = { failureThreshold: 3, openMs: 10_000, halfOpenSuccessesToClose: 2 };
const REQUIREMENTS = { structuredOutput: true, chatCompletions: true, minOutputTokens: 1_000 };

// ── Fixtures ────────────────────────────────────────────────────────────────

function selfHostedConfiguration(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    runtime: 'openai_compatible',
    baseUrl: 'https://inference.marq.example.com/v1',
    credentialRequired: 'false',
    'model.0.id': MODEL_ID,
    'model.0.textGeneration': 'true',
    'model.0.structuredOutput': 'true',
    'model.0.chatCompletions': 'true',
    'model.0.zeroDataRetention': 'true',
    'model.0.maxOutputTokens': '8192',
    'model.0.maxContextTokens': '128000',
    'model.0.promptMicroUsdPer1k': '0',
    'model.0.completionMicroUsdPer1k': '0',
    ...overrides,
  };
}

function configurationRow(
  overrides: Partial<AIProviderConfigurationRecord> = {},
): AIProviderConfigurationRecord {
  return {
    configurationId: `pvc_${overrides.providerKey ?? PROVIDER_ID}`,
    providerKey: PROVIDER_ID,
    displayName: 'MARQ Inference',
    scope: 'platform',
    enabled: true,
    certification: 'certified' as AIProviderCertificationState,
    configuration: selfHostedConfiguration(),
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'operator',
    updatedBy: 'operator',
    ...overrides,
  };
}

interface Harness {
  readonly registry: ProviderRegistry;
  readonly store: ProviderAdministrationStore;
  readonly registrar: ReturnType<typeof createSelfHostedRegistrar>;
  readonly errors: string[];
  readonly registered: string[];
  readonly outbound: string[];
  readonly resolver: ReturnType<typeof createProviderCredentialResolver>;
  selector(options?: { realRequestsEnabled?: boolean; requireCertification?: boolean }): ReturnType<
    typeof createProviderSelector
  >;
}

/**
 * The production graph, minus the network.
 *
 * The registry, the selector, the circuit breaker, the credential resolver and
 * the cipher are all the real implementations, assembled in the same order
 * `bootstrap.ts` assembles them — including the getter-based cycle between the
 * registrar and the resolver.
 */
function harness(
  options: {
    env?: Record<string, string>;
    allowPrivateEndpoints?: boolean;
    enabled?: boolean;
    modelPolicy?: ModelPolicy;
    store?: ProviderAdministrationStore;
  } = {},
): Harness {
  const clock = createTestClock();
  const circuit = createCircuitBreaker(clock, CIRCUIT);
  const store = options.store ?? createMemoryProviderAdministrationStore();
  const errors: string[] = [];
  const registered: string[] = [];
  const outbound: string[] = [];
  const env = recordEnv({
    OPENAI_API_KEY: 'sk-test-openai',
    ANTHROPIC_API_KEY: 'sk-test-anthropic',
    ...options.env,
  });

  const fetchImpl: FetchLike = (url) => {
    outbound.push(String(url));
    return Promise.resolve(
      Response.json({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  };

  let registry: ProviderRegistry | undefined;

  const registrar = createSelfHostedRegistrar({
    registry: () => registry,
    credentials: () => resolver,
    store,
    enabled: options.enabled ?? true,
    allowPrivateEndpoints: options.allowPrivateEndpoints,
    fetchImpl,
    now: () => clock.isoNow(),
    onError: (providerId, detail) => errors.push(`${providerId}: ${detail}`),
    onRegistered: (providerId) => registered.push(providerId),
  });

  const resolver = createProviderCredentialResolver({
    profiles: [OPENAI_CREDENTIAL_PROFILE, ANTHROPIC_CREDENTIAL_PROFILE],
    additionalProfiles: () => registrar.profiles(),
    clock,
    env,
    store,
    cipher: createSecretCipher(parseRootKey(ROOT_KEY)),
    scope: 'platform',
  });

  registry = createProviderRegistry(clock, circuit, options.modelPolicy ?? OPEN_MODEL_POLICY);
  registry.register(createOpenAIProvider({ env, credentials: resolver, clock }), {
    certification: 'certified',
  });
  registry.register(createAnthropicProvider({ env, credentials: resolver, clock }), {
    certification: 'certified',
  });

  return {
    registry,
    store,
    registrar,
    errors,
    registered,
    outbound,
    resolver,
    selector: (selectorOptions = {}) =>
      createProviderSelector(registry!, circuit, {
        preference: [],
        failoverEnabled: true,
        realRequestsEnabled: selectorOptions.realRequestsEnabled ?? true,
        requireCertification: selectorOptions.requireCertification ?? true,
      }),
  };
}

/** Descriptor facts, so "unchanged" can be asserted rather than asserted about. */
function snapshotOf(registry: ProviderRegistry, providerId: string) {
  const provider = registry.get(providerId);
  return {
    providerId: provider.descriptor.providerId,
    displayName: provider.descriptor.displayName,
    priority: provider.descriptor.priority,
    productionReady: provider.descriptor.productionReady,
    billable: provider.descriptor.billable,
    enabled: provider.enabled,
    certification: provider.certification,
    credential: provider.descriptor.credential,
    models: provider.descriptor.models.map((model) => model.modelId),
    hasCredentials: provider.adapter.hasCredentials(),
  };
}

// ── Hydration ───────────────────────────────────────────────────────────────

describe('self-hosted hydration — what registers', () => {
  it('registers a valid persisted definition', async () => {
    const h = harness();
    await h.store.saveConfiguration(configurationRow());

    const report = await h.registrar.hydrate();
    assert.equal(report.attempted, 1);
    assert.deepEqual(report.registered, [PROVIDER_ID]);
    assert.deepEqual(report.refused, []);

    const provider = h.registry.get(PROVIDER_ID);
    assert.equal(provider.descriptor.displayName, 'MARQ Inference');
    assert.deepEqual(
      provider.descriptor.models.map((model) => model.modelId),
      [MODEL_ID],
    );
    assert.equal(provider.enabled, true);
    assert.equal(provider.certification, 'certified');
  });

  it('skips a Batch 4C row that declares no runtime', async () => {
    const h = harness();
    // This is what an administered OpenAI configuration looks like: `{}`.
    await h.store.saveConfiguration(
      configurationRow({ providerKey: 'openai', configuration: {} }),
    );

    const report = await h.registrar.hydrate();
    assert.equal(report.attempted, 0, 'rows with no runtime key are not candidates');
    assert.deepEqual(report.refused, []);
    assert.deepEqual(h.errors, []);
  });

  it('does not register an invalid definition, and reports every reason', async () => {
    const h = harness();
    await h.store.saveConfiguration(
      configurationRow({
        configuration: selfHostedConfiguration({ baseUrl: 'https://169.254.169.254/latest' }),
      }),
    );

    const report = await h.registrar.hydrate();
    assert.deepEqual(report.registered, []);
    assert.equal(report.refused.length, 1);
    assert.match(report.refused[0].reasons!.join(' '), /metadata_address/);
    assert.equal(h.registry.find(PROVIDER_ID), undefined);
    assert.equal(h.errors.length, 1);
  });

  it('never makes an invalid stored endpoint callable', async () => {
    const h = harness();
    for (const [providerKey, baseUrl] of [
      ['sh_loopback', 'https://127.0.0.1:8000/v1'],
      ['sh_private', 'https://10.0.0.9/v1'],
      ['sh_plain', 'http://inference.example.com/v1'],
      ['sh_secret', 'https://inference.example.com/v1?api_key=abc'],
      ['sh_traversal', 'https://inference.example.com/v1/../admin'],
      ['sh_metadata', 'https://metadata.google.internal/v1'],
    ] as const) {
      await h.store.saveConfiguration(
        configurationRow({
          providerKey,
          configurationId: `pvc_${providerKey}`,
          configuration: selfHostedConfiguration({ baseUrl }),
        }),
      );
    }

    const report = await h.registrar.hydrate();
    assert.deepEqual(report.registered, []);
    assert.equal(report.refused.length, 6);
    // No adapter exists for any of them, so nothing can dial them.
    assert.deepEqual(h.registry.list().map((p) => p.descriptor.providerId).sort(), [
      'anthropic',
      'openai',
    ]);
    assert.deepEqual(h.outbound, []);
  });

  it('refuses a row that claims a built-in provider id', async () => {
    const h = harness();
    const before = snapshotOf(h.registry, 'openai');
    await h.store.saveConfiguration(
      configurationRow({
        providerKey: 'openai',
        configurationId: 'pvc_hostile',
        displayName: 'Not OpenAI',
        configuration: selfHostedConfiguration({
          baseUrl: 'https://attacker.example.com/v1',
        }),
      }),
    );

    const report = await h.registrar.hydrate();
    assert.deepEqual(report.registered, []);
    assert.equal(report.refused[0].providerId, 'openai');
    assert.match(report.refused[0].reasons!.join(' '), /built-in adapter/);
    // The reviewed adapter is untouched — same descriptor, same catalogue.
    assert.deepEqual(snapshotOf(h.registry, 'openai'), before);
  });

  it('does nothing at all when the capability is switched off', async () => {
    const h = harness({ enabled: false });
    await h.store.saveConfiguration(configurationRow());

    const report = await h.registrar.hydrate();
    assert.equal(report.attempted, 0);
    assert.equal(h.registry.find(PROVIDER_ID), undefined);
    assert.match(h.errors.join(' '), /AI_SELF_HOSTED_PROVIDERS_ENABLED/);
  });

  it('reports, rather than throws, when no store is configured', async () => {
    const clock = createTestClock();
    const registrar = createSelfHostedRegistrar({
      registry: () => createProviderRegistry(clock, createCircuitBreaker(clock, CIRCUIT)),
      credentials: () => {
        throw new Error('the resolver must not be reached with no store');
      },
      enabled: true,
      now: () => clock.isoNow(),
      onError: () => undefined,
    });
    const report = await registrar.hydrate();
    assert.equal(report.attempted, 0);
  });
});

describe('self-hosted hydration — idempotence and races', () => {
  it('is safe to run twice', async () => {
    const h = harness();
    await h.store.saveConfiguration(configurationRow());

    const first = await h.registrar.hydrate();
    const second = await h.registrar.hydrate();
    assert.deepEqual(first.registered, [PROVIDER_ID]);
    assert.deepEqual(second.registered, [], 'a registered provider is skipped, never re-registered');
    assert.deepEqual(second.refused, [], 'and skipping it is not an error');
    assert.equal(h.registry.list().length, 3);
  });

  it('coalesces concurrent hydrations onto one storage read', async () => {
    let reads = 0;
    const inner = createMemoryProviderAdministrationStore();
    const counting: ProviderAdministrationStore = {
      ...inner,
      listConfigurations: (scope) => {
        reads += 1;
        return inner.listConfigurations(scope);
      },
    };
    const h = harness({ store: counting });
    await h.store.saveConfiguration(configurationRow());

    const reports = await Promise.all([
      h.registrar.hydrate(),
      h.registrar.hydrate(),
      h.registrar.hydrate(),
    ]);
    assert.equal(reads, 1, 'three concurrent hydrations, one read');
    assert.equal(h.registry.list().length, 3, 'and exactly one registration');
    assert.deepEqual(reports[0].registered, [PROVIDER_ID]);
  });

  it('picks up a definition stored after the first hydration', async () => {
    const h = harness();
    await h.registrar.hydrate();
    assert.equal(h.registry.find(PROVIDER_ID), undefined);

    await h.store.saveConfiguration(configurationRow());
    const second = await h.registrar.hydrate();
    assert.deepEqual(second.registered, [PROVIDER_ID]);
  });

  it('leaves nothing half-registered when the registry refuses an adapter', async () => {
    const h = harness();
    // A definition whose provider id the registry already holds under another
    // adapter — the registrar's own guard catches this first, but the rollback
    // path is what protects a future registry refusal.
    await h.store.saveConfiguration(configurationRow());
    await h.registrar.hydrate();

    const profiles = h.registrar.profiles();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].providerId, PROVIDER_ID);
    // A profile exists for exactly the providers that registered.
    assert.deepEqual(
      profiles.map((profile) => profile.providerId),
      h.registrar.definitions().map((definition) => definition.providerId),
    );
  });
});

// ── The built-in estate is untouched ────────────────────────────────────────

describe('self-hosted hydration — the certified estate is unchanged', () => {
  it('leaves OpenAI and Anthropic exactly as they were', async () => {
    const h = harness();
    const before = {
      openai: snapshotOf(h.registry, 'openai'),
      anthropic: snapshotOf(h.registry, 'anthropic'),
    };

    await h.store.saveConfiguration(configurationRow());
    await h.registrar.hydrate();

    assert.deepEqual(snapshotOf(h.registry, 'openai'), before.openai);
    assert.deepEqual(snapshotOf(h.registry, 'anthropic'), before.anthropic);
  });

  it('leaves their credential resolution exactly as it was', async () => {
    const h = harness();
    const before = [h.resolver.describe('openai'), h.resolver.describe('anthropic')];

    await h.store.saveConfiguration(configurationRow());
    await h.registrar.hydrate();

    assert.deepEqual(
      [h.resolver.describe('openai'), h.resolver.describe('anthropic')].map((a) => ({
        providerId: a.providerId,
        configured: a.configured,
        source: a.source,
      })),
      before.map((a) => ({
        providerId: a.providerId,
        configured: a.configured,
        source: a.source,
      })),
    );

    const openai = await h.resolver.resolve('openai');
    assert.equal(openai?.secret, 'sk-test-openai');
    assert.equal(openai?.category, 'environment');
  });

  it('does not let a dynamic profile shadow a built-in one', async () => {
    // A registrar whose profiles claimed `openai` must not change how OpenAI
    // resolves. The registrar refuses such a definition, and the resolver
    // ignores it regardless — two independent reasons for the same guarantee.
    const clock = createTestClock();
    const resolver = createProviderCredentialResolver({
      profiles: [OPENAI_CREDENTIAL_PROFILE],
      additionalProfiles: () => [
        { providerId: 'openai', required: false, manageable: true },
      ],
      clock,
      env: recordEnv({ OPENAI_API_KEY: 'sk-test-openai' }),
    });
    assert.equal(resolver.describe('openai').source, 'environment');
    const resolved = await resolver.resolve('openai');
    assert.equal(resolved?.secret, 'sk-test-openai');
  });
});

// ── Runtime governance ──────────────────────────────────────────────────────

describe('self-hosted runtime — governed like every other provider', () => {
  it('is refused by the real-request kill switch', async () => {
    const h = harness();
    await h.store.saveConfiguration(configurationRow());
    await h.registrar.hydrate();

    // A self-hosted provider declares `billable: true` precisely so this holds.
    const off = h.selector({ realRequestsEnabled: false }).explain(REQUIREMENTS);
    assert.match(off[PROVIDER_ID], /AI_ALLOW_REAL_REQUESTS=false/);

    const on = h.selector({ realRequestsEnabled: true }).explain(REQUIREMENTS);
    assert.equal(on[PROVIDER_ID], 'eligible');
  });

  it('declares billable even when every model is priced at zero', async () => {
    const h = harness();
    await h.store.saveConfiguration(configurationRow());
    await h.registrar.hydrate();

    const provider = h.registry.get(PROVIDER_ID);
    assert.equal(provider.descriptor.billable, true);
    assert.equal(provider.descriptor.models[0].promptMicroUsdPer1k, 0);
    assert.equal(provider.descriptor.models[0].completionMicroUsdPer1k, 0);
  });

  it('an uncertified definition is registered but serves nothing', async () => {
    for (const certification of ['unverified', 'testing', 'degraded'] as const) {
      const h = harness();
      await h.store.saveConfiguration(configurationRow({ certification }));
      await h.registrar.hydrate();

      const provider = h.registry.get(PROVIDER_ID);
      // Visible in the console — that is where it gets certified.
      assert.equal(provider.certification, certification, certification);
      // And inert in the runtime, on both counts.
      assert.equal(provider.enabled, false, certification);
      assert.equal(provider.descriptor.productionReady, false, certification);
      assert.equal(h.selector().explain(REQUIREMENTS)[PROVIDER_ID], 'disabled', certification);
    }
  });

  it('a certified definition an operator disabled also serves nothing', async () => {
    const h = harness();
    await h.store.saveConfiguration(configurationRow({ enabled: false }));
    await h.registrar.hydrate();

    assert.equal(h.registry.get(PROVIDER_ID).enabled, false);
    assert.equal(h.selector().explain(REQUIREMENTS)[PROVIDER_ID], 'disabled');
  });

  it('a successful call cannot silently promote an uncertified provider', async () => {
    const h = harness();
    await h.store.saveConfiguration(configurationRow({ certification: 'unverified' }));
    await h.registrar.hydrate();

    // The registry promotes on success to `certified` only when the descriptor
    // says production ready — which for a self-hosted provider means MARQ has
    // already certified it. Otherwise the ceiling is `testing`.
    h.registry.recordSuccess(PROVIDER_ID, 120);
    assert.equal(h.registry.get(PROVIDER_ID).certification, 'testing');
    assert.equal(h.registry.get(PROVIDER_ID).enabled, false);
  });

  it('honours the administrative model allow list, which can only narrow', async () => {
    const allowList: ModelPolicy = {
      allowList: (providerId) => (providerId === PROVIDER_ID ? ['no-such-model'] : []),
      preferred: () => undefined,
    };
    const h = harness({ modelPolicy: allowList });
    await h.store.saveConfiguration(configurationRow());
    await h.registrar.hydrate();

    // Fails closed: a narrowing that matches nothing serves nothing. It can
    // never ADD a model the definition did not declare.
    assert.deepEqual(h.registry.models(PROVIDER_ID), []);
    assert.equal(h.registry.selectModel(PROVIDER_ID, REQUIREMENTS), undefined);
  });
});

describe('self-hosted runtime — storage does not self-certify', () => {
  it('a model row alone creates no runtime capability', async () => {
    const h = harness();
    await h.store.saveConfiguration(configurationRow());
    // An administered row for a model the DEFINITION does not declare. It is a
    // legitimate administration record; it is not a capability.
    await h.store.saveModel({
      modelRecordId: 'pvm_smuggled',
      configurationId: `pvc_${PROVIDER_ID}`,
      providerKey: PROVIDER_ID,
      modelId: 'gpt-4o',
      displayName: 'Smuggled',
      enabled: true,
      certification: 'certified',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      updatedBy: 'operator',
    });

    await h.registrar.hydrate();

    const served = h.registry.models(PROVIDER_ID).map((model) => model.modelId);
    assert.deepEqual(served, [MODEL_ID]);
    assert.equal(
      served.includes('gpt-4o'),
      false,
      'typing a model id into storage must not make it serviceable',
    );
    // And the row is still there — administration state, not capability.
    assert.equal((await h.store.listModels(`pvc_${PROVIDER_ID}`)).length, 1);
  });

  it('the descriptor catalogue comes only from the validated definition', async () => {
    const h = harness();
    await h.store.saveConfiguration(configurationRow());
    await h.registrar.hydrate();

    const declared = h.registry.get(PROVIDER_ID).descriptor.models;
    assert.equal(declared.length, 1);
    assert.equal(declared[0].providerId, PROVIDER_ID);
    assert.equal(declared[0].capabilities.maxContextTokens, 128_000);
  });
});

// ── Credential integration ──────────────────────────────────────────────────

describe('self-hosted runtime — credential resolver integration', () => {
  async function seedCredential(h: Harness, secret: string): Promise<void> {
    const cipher = createSecretCipher(parseRootKey(ROOT_KEY));
    const sealed = await cipher.seal(secret, {
      providerKey: PROVIDER_ID,
      scope: 'platform',
      credentialId: 'pvk_selfhosted',
    });
    await h.store.putActiveCredential({
      credentialId: 'pvk_selfhosted',
      configurationId: `pvc_${PROVIDER_ID}`,
      providerKey: PROVIDER_ID,
      credentialName: 'primary',
      status: 'active',
      fingerprint: await cipher.fingerprint(secret),
      secretVersion: 1,
      keyId: cipher.keyId ?? 'unknown',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'operator',
      sealed,
    });
  }

  it('resolves a managed credential for a provider registered by hydration', async () => {
    const h = harness();
    await h.store.saveConfiguration(
      configurationRow({
        configuration: selfHostedConfiguration({ credentialRequired: 'true' }),
      }),
    );
    await h.registrar.hydrate();
    await seedCredential(h, 'self-hosted-managed-secret');
    await h.resolver.refresh();

    const availability = h.resolver.describe(PROVIDER_ID);
    assert.equal(availability.configured, true);
    assert.equal(availability.source, 'managed');
    // NON-SECRET FACTS ONLY. There is no member of this shape a secret could
    // occupy, and the fingerprint is a keyed, truncated digest.
    assert.equal(JSON.stringify(availability).includes('self-hosted-managed-secret'), false);
    assert.ok(availability.fingerprint);

    const resolved = await h.resolver.resolve(PROVIDER_ID);
    assert.equal(resolved?.secret, 'self-hosted-managed-secret');
    assert.equal(resolved?.category, 'platform_managed');
  });

  it('sends the resolved credential and reports its category on the completion', async () => {
    const h = harness();
    await h.store.saveConfiguration(
      configurationRow({
        configuration: selfHostedConfiguration({ credentialRequired: 'true' }),
      }),
    );
    await h.registrar.hydrate();
    await seedCredential(h, 'self-hosted-managed-secret');
    await h.resolver.refresh();

    const completion = await h.registry.get(PROVIDER_ID).adapter.invoke({
      requestId: 'req_1',
      correlationId: 'cor_1',
      modelId: MODEL_ID,
      generation: {
        messages: [{ role: 'user', content: 'hello' }],
        responseFormat: 'text',
        temperature: 0.2,
        maxOutputTokens: 100,
      },
      attempt: 1,
      signal: new AbortController().signal,
    });
    assert.equal(completion.credentialSource, 'platform_managed');
    assert.deepEqual(h.outbound, [
      'https://inference.marq.example.com/v1/chat/completions',
    ]);
  });

  it('a credential-required provider with none configured is not selectable', async () => {
    const h = harness();
    await h.store.saveConfiguration(
      configurationRow({
        configuration: selfHostedConfiguration({ credentialRequired: 'true' }),
      }),
    );
    await h.registrar.hydrate();
    await h.resolver.refresh();

    assert.equal(h.registry.get(PROVIDER_ID).adapter.hasCredentials(), false);
    assert.equal(
      h.selector().explain(REQUIREMENTS)[PROVIDER_ID],
      'credentials not configured',
    );
  });

  it('fabricates no environment variable for a dynamic provider', async () => {
    const h = harness({
      env: {
        // A variable an operator might expect to work. Nothing reads it.
        MARQ_INFERENCE_API_KEY: 'should-never-be-read',
        SELFHOSTED_MARQ_INFERENCE_API_KEY: 'should-never-be-read',
      },
    });
    await h.store.saveConfiguration(
      configurationRow({
        configuration: selfHostedConfiguration({ credentialRequired: 'true' }),
      }),
    );
    await h.registrar.hydrate();

    assert.equal(h.registrar.profiles()[0].environmentVariable, undefined);
    assert.equal(await h.resolver.resolve(PROVIDER_ID), undefined);
  });
});

// ── Deployment configuration ────────────────────────────────────────────────

describe('self-hosted deployment configuration', () => {
  it('is off by default, and both switches are read from the environment', () => {
    const bare = loadControlPlaneConfig(recordEnv({}));
    assert.equal(bare.selfHosted.enabled, false);
    assert.equal(bare.selfHosted.allowPrivateEndpoints, false);

    const on = loadControlPlaneConfig(
      recordEnv({
        AI_SELF_HOSTED_PROVIDERS_ENABLED: 'true',
        AI_SELF_HOSTED_ALLOW_PRIVATE_ENDPOINTS: 'true',
      }),
    );
    assert.equal(on.selfHosted.enabled, true);
    assert.equal(on.selfHosted.allowPrivateEndpoints, true);
  });

  it('the private-endpoint exception reaches the validator and nothing else', async () => {
    const strict = harness();
    await strict.store.saveConfiguration(
      configurationRow({
        configuration: selfHostedConfiguration({ baseUrl: 'http://127.0.0.1:11434/v1' }),
      }),
    );
    assert.deepEqual((await strict.registrar.hydrate()).registered, []);

    const permissive = harness({ allowPrivateEndpoints: true });
    await permissive.store.saveConfiguration(
      configurationRow({
        configuration: selfHostedConfiguration({ baseUrl: 'http://127.0.0.1:11434/v1' }),
      }),
    );
    assert.deepEqual((await permissive.registrar.hydrate()).registered, [PROVIDER_ID]);
    // It is still billable, still certification-gated, still kill-switched.
    const provider = permissive.registry.get(PROVIDER_ID);
    assert.equal(provider.descriptor.billable, true);
    assert.match(
      permissive.selector({ realRequestsEnabled: false }).explain(REQUIREMENTS)[PROVIDER_ID],
      /AI_ALLOW_REAL_REQUESTS=false/,
    );
  });
});
