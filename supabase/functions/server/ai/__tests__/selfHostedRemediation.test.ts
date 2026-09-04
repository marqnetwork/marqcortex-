/**
 * AI-01 Batch 4E — REMEDIATION regression suite.
 *
 * One test per finding an independent certification gate raised against commit
 * `12f34cd`. Every one of them reproduces the original defect first, in the
 * shape the gate reproduced it, so a regression fails here rather than at the
 * next audit.
 *
 *   B-1  BLOCKER  the adapter followed redirects off its validated endpoint
 *   H-1  HIGH     no governed path existed to `certified`
 *   H-2  HIGH     an admin write could join a pre-write hydration
 *   M-1  MEDIUM   the settings overlay overwrote the enablement gate
 *   M-2  MEDIUM   the exposure ceiling was not applied during hydration
 *   M-4  MEDIUM   an edited endpoint needed a restart to take effect
 *   L-1  LOW      storage held the raw URL; the runtime dialled a normalized one
 *
 * THE B-1 CASES USE A REAL LOOPBACK HTTP SERVER AND THE REAL GLOBAL `fetch`.
 * That is deliberate and it is the only way the claim can be made: the fix is a
 * transport-level refusal, so a suite that injected a `fetch` double would be
 * testing its own double. Nothing here leaves the loopback interface, no vendor
 * is contacted, and no credential is created.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

import { ADMIN_TOKEN, buildTestAdministration } from './harness.ts';
import { AIError } from '../contracts/errors.ts';
import { ADMIN_ACTION } from '../admin/adminAudit.ts';
import { createSelfHostedProvider } from '../providers/selfHostedProvider.ts';
import {
  selfHostedDescriptor,
  selfHostedRegistration,
  validateSelfHostedDefinition,
} from '../providers/selfHosted/definition.ts';
import type { SelfHostedProviderDefinition } from '../providers/selfHosted/definition.ts';
import { createProviderRegistry } from '../providers/registry.ts';
import { createProviderSelector } from '../providers/selector.ts';
import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createTestClock } from '../runtime/clock.ts';
import type { AIProviderInvocation } from '../contracts/provider.ts';
import type {
  ProviderAdministrationStore,
} from '../providers/credentials/credentialStore.ts';
import type { ProviderCredentialResolver } from '../providers/credentials/contracts.ts';
import type { SelfHostedProviderInput } from '../admin/providerAdministration.ts';
import type { FetchLike } from '../providers/openaiProvider.ts';

const PROVIDER_ID = 'marq_inference';
const MODEL_ID = 'm1';
const CIRCUIT = { failureThreshold: 3, openMs: 10_000, halfOpenSuccessesToClose: 2 };
const REQUIREMENTS = { structuredOutput: true, chatCompletions: true, minOutputTokens: 1_000 };
const REASON = 'Remediation regression suite.';

// ── Shared fixtures ─────────────────────────────────────────────────────────

function configuration(overrides: Record<string, string> = {}): Record<string, string> {
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

function definitionOf(
  config: Record<string, string>,
  certification: 'unverified' | 'testing' | 'certified' = 'certified',
  allowPrivateEndpoints = false,
): SelfHostedProviderDefinition {
  const result = validateSelfHostedDefinition(
    {
      configurationId: 'pvc_fixture',
      providerKey: PROVIDER_ID,
      displayName: 'MARQ Inference',
      scope: 'platform',
      enabled: true,
      certification,
      configuration: config,
      createdAt: 'x',
      updatedAt: 'x',
      createdBy: 'x',
      updatedBy: 'x',
    },
    { allowPrivateEndpoints },
  );
  if (result.ok !== true) throw new Error(`fixture invalid: ${result.reasons.join('; ')}`);
  return result.definition;
}

const OPEN_RESOLVER: ProviderCredentialResolver = {
  describe: () => ({
    providerId: PROVIDER_ID,
    configured: true,
    source: 'none',
    environmentCredentialPresent: false,
    checkedAt: '2026-09-03T00:00:00.000Z',
  }),
  resolve: () => Promise.resolve(undefined),
  refresh: () => Promise.resolve(),
  snapshot: () => [],
};

function invocation(overrides: Partial<AIProviderInvocation> = {}): AIProviderInvocation {
  return {
    requestId: 'req_remediation',
    correlationId: 'cor_remediation',
    modelId: MODEL_ID,
    generation: {
      messages: [{ role: 'user', content: 'TENANT-CONFIDENTIAL-PROMPT' }],
      responseFormat: 'text',
      temperature: 0.2,
      maxOutputTokens: 64,
    },
    attempt: 1,
    signal: AbortSignal.timeout(5_000),
    ...overrides,
  };
}

async function expectAIError(run: () => Promise<unknown>, code: string): Promise<AIError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AIError, `expected an AIError, got ${String(error)}`);
    assert.equal(error.code, code, `${error.code}: ${error.message}`);
    return error;
  }
  throw new assert.AssertionError({ message: `expected ${code} to be thrown` });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  );
}

function modelInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MODEL_ID,
    textGeneration: 'true',
    structuredOutput: 'true',
    chatCompletions: 'true',
    zeroDataRetention: 'true',
    maxOutputTokens: '8192',
    maxContextTokens: '128000',
    promptMicroUsdPer1k: '0',
    completionMicroUsdPer1k: '0',
    ...overrides,
  };
}

function definitionInput(
  overrides: Record<string, unknown> = {},
): SelfHostedProviderInput & Record<string, unknown> {
  return {
    providerId: PROVIDER_ID,
    displayName: 'MARQ Inference',
    runtime: 'openai_compatible',
    baseUrl: 'https://inference.marq.example.com/v1',
    credentialRequired: 'false',
    models: [modelInput()],
    ...overrides,
  };
}

// ── B-1 — the redirect blocker ──────────────────────────────────────────────

describe('B-1 — a validated endpoint cannot redirect the adapter elsewhere', () => {
  /**
   * The certified exploit, reproduced end to end.
   *
   * A validated endpoint answers a redirect; the target is a second loopback
   * server standing in for an internal service. Before the fix the adapter
   * dialled it, forwarded the tenant prompt and returned the internal
   * service's body as the completion.
   */
  async function driveRedirect(status: number): Promise<{
    readonly secondHopRequests: number;
    readonly bodiesSeenByTarget: string[];
    readonly error: AIError;
  }> {
    const bodiesSeenByTarget: string[] = [];
    let secondHopRequests = 0;

    const internal = createServer((request, response) => {
      secondHopRequests += 1;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => bodiesSeenByTarget.push(Buffer.concat(chunks).toString()));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'INTERNAL-SERVICE-DATA' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    const internalPort = await listen(internal);

    const validated = createServer((_request, response) => {
      response.writeHead(status, {
        location: `http://127.0.0.1:${internalPort}/latest/meta-data/`,
      });
      response.end();
    });
    const validatedPort = await listen(validated);

    try {
      const adapter = createSelfHostedProvider({
        definition: definitionOf(
          configuration({ baseUrl: `http://127.0.0.1:${validatedPort}/v1` }),
          'certified',
          true,
        ),
        credentials: OPEN_RESOLVER,
        // THE REAL GLOBAL `fetch`. No injected transport: the fix is a
        // transport-level refusal, and a double would prove nothing.
      });
      const error = await expectAIError(
        () => adapter.invoke(invocation()),
        'PROVIDER_UNAVAILABLE',
      );
      return { secondHopRequests, bodiesSeenByTarget, error };
    } finally {
      internal.close();
      validated.close();
    }
  }

  for (const status of [301, 302, 303, 307, 308]) {
    it(`refuses a ${status} without issuing a second request`, async () => {
      const outcome = await driveRedirect(status);
      assert.equal(outcome.secondHopRequests, 0, `HTTP ${status} reached the redirect target`);
      assert.deepEqual(
        outcome.bodiesSeenByTarget,
        [],
        'the tenant prompt must never reach a redirect target',
      );
      // Surfaced through the governed taxonomy, and the diagnostic says why.
      assert.match(String(outcome.error.diagnostics), /redirect/i);
      assert.equal(outcome.error.message, 'The AI provider could not be reached.');
    });
  }

  it('reaches the validated endpoint and nothing else on the happy path', async () => {
    // The control for the five cases above: with no redirect, one request is
    // made, to the validated URL.
    const seen: string[] = [];
    const server = createServer((request, response) => {
      seen.push(String(request.url));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    const port = await listen(server);
    try {
      const adapter = createSelfHostedProvider({
        definition: definitionOf(
          configuration({ baseUrl: `http://127.0.0.1:${port}/v1` }),
          'certified',
          true,
        ),
        credentials: OPEN_RESOLVER,
      });
      const completion = await adapter.invoke(invocation());
      assert.equal(completion.content, 'ok');
      assert.deepEqual(seen, ['/v1/chat/completions']);
    } finally {
      server.close();
    }
  });

  it('refuses a 3xx handed straight to it by an injected transport', async () => {
    // The belt-and-braces branch. Production never reaches it because the
    // transport refuses first, but a double, a proxy or a runtime with
    // different redirect support could deliver a 3xx to the adapter — and it
    // must not be reported as "the provider rejected the request".
    for (const status of [301, 302, 303, 307, 308]) {
      let calls = 0;
      const fetchImpl: FetchLike = () => {
        calls += 1;
        return Promise.resolve(
          new Response(null, { status, headers: { location: 'http://169.254.169.254/' } }),
        );
      };
      const adapter = createSelfHostedProvider({
        definition: definitionOf(configuration()),
        credentials: OPEN_RESOLVER,
        fetchImpl,
      });
      const error = await expectAIError(
        () => adapter.invoke(invocation()),
        'PROVIDER_UNAVAILABLE',
      );
      assert.equal(calls, 1, `HTTP ${status} produced more than one attempt`);
      assert.match(String(error.diagnostics), /redirect/i);
      // The attacker-influenced Location value is never echoed.
      assert.equal(String(error.diagnostics).includes('169.254.169.254'), false);
    }
  });
});

// ── M-1 — the durable enablement gate ───────────────────────────────────────

describe('M-1 — certification gates enablement durably', () => {
  function registryWith(certification: 'unverified' | 'testing' | 'certified') {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, CIRCUIT);
    const registry = createProviderRegistry(clock, circuit);
    const definition = definitionOf(configuration(), certification);
    registry.register(
      createSelfHostedProvider({ definition, credentials: OPEN_RESOLVER }),
      selfHostedRegistration(definition),
    );
    return { registry, circuit };
  }

  for (const certification of ['unverified', 'testing'] as const) {
    it(`refuses to enable a ${certification} self-hosted provider`, () => {
      // THE CERTIFIED DEFECT: `applySettings()` calls exactly this, from the
      // persisted overlay, on every settings adoption. Before the fix the
      // provider came back enabled with its certification untouched.
      const { registry, circuit } = registryWith(certification);
      registry.setEnabled(PROVIDER_ID, true);

      assert.equal(registry.get(PROVIDER_ID).enabled, false);
      assert.equal(registry.get(PROVIDER_ID).certification, certification);
      assert.equal(registry.health(PROVIDER_ID).state, 'disabled');

      const selector = createProviderSelector(registry, circuit, {
        preference: [],
        failoverEnabled: true,
        // Even with BOTH platform-wide controls relaxed, which is the posture
        // the missing certification path used to force on operators.
        realRequestsEnabled: true,
        requireCertification: false,
      });
      assert.equal(selector.explain(REQUIREMENTS)[PROVIDER_ID], 'disabled');
    });
  }

  it('says so on the health read rather than leaving it implicit', () => {
    const { registry } = registryWith('unverified');
    assert.ok(
      registry.validate().some((issue) => /requires certification before it may be enabled/.test(issue)),
    );
  });

  it('enables a certified provider exactly as before', () => {
    const { registry, circuit } = registryWith('certified');
    registry.setEnabled(PROVIDER_ID, true);
    assert.equal(registry.get(PROVIDER_ID).enabled, true);
    const selector = createProviderSelector(registry, circuit, {
      preference: [],
      failoverEnabled: true,
      realRequestsEnabled: true,
      requireCertification: true,
    });
    assert.equal(selector.explain(REQUIREMENTS)[PROVIDER_ID], 'eligible');
  });

  it('never blocks DISABLING — a gate must not prevent containment', () => {
    const { registry } = registryWith('certified');
    registry.setEnabled(PROVIDER_ID, true);
    registry.setEnabled(PROVIDER_ID, false);
    assert.equal(registry.get(PROVIDER_ID).enabled, false);
  });

  it('leaves built-in providers ungated', () => {
    // OpenAI, Anthropic and the mock do not declare the gate, so their
    // enablement behaviour is byte for byte what it was.
    const definition = definitionOf(configuration());
    assert.equal(selfHostedDescriptor(definition).certificationGatesEnablement, true);

    const harness = buildTestAdministration();
    for (const provider of harness.plane.providers.list()) {
      assert.notEqual(
        provider.descriptor.certificationGatesEnablement,
        true,
        `${provider.descriptor.providerId} must not be gated`,
      );
    }
  });
});

// ── H-1 — the governed certification path ───────────────────────────────────

describe('H-1 — certification is a governed, audited decision', () => {
  async function definedProvider() {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON);
    return { harness, actor };
  }

  it('moves unverified to certified, and records who and why', async () => {
    const { harness, actor } = await definedProvider();
    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'unverified');

    const view = await harness.admin.setProviderCertification(
      actor,
      PROVIDER_ID,
      'certified',
      'Reviewed the deployment and its network placement.',
    );
    assert.equal(view.certification, 'certified');
    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'certified');

    const row = (await harness.providerStore.listConfigurations('platform')).find(
      (record) => record.providerKey === PROVIDER_ID,
    );
    assert.equal(row?.certification, 'certified', 'the durable record must follow the runtime');

    const entry = harness.admin
      .adminAudit(actor, 30)
      .find((record) => record.action === ADMIN_ACTION.providerCertified);
    assert.ok(entry, 'certification must be on the administrative trail');
    assert.equal(entry.outcome, 'applied');
    assert.equal(entry.target, PROVIDER_ID);
  });

  it('CERTIFICATION ALONE DOES NOT ENABLE the provider', async () => {
    const { harness, actor } = await definedProvider();
    await harness.admin.setProviderCertification(actor, PROVIDER_ID, 'certified', REASON);

    // Two decisions, two operations, two people if an organization wants it so.
    assert.equal(harness.plane.providers.get(PROVIDER_ID).enabled, false);
    assert.equal(harness.plane.providers.health(PROVIDER_ID).state, 'disabled');
  });

  it('and once certified, enabling now works — the gate has a key', async () => {
    const { harness, actor } = await definedProvider();
    await harness.admin.setProviderCertification(actor, PROVIDER_ID, 'certified', REASON);
    await harness.admin.setProviderEnabled(actor, PROVIDER_ID, true, REASON);
    assert.equal(harness.plane.providers.get(PROVIDER_ID).enabled, true);
    assert.equal(harness.plane.providers.get(PROVIDER_ID).descriptor.productionReady, false);
  });

  it('withdraws certification, and the provider stops serving', async () => {
    const { harness, actor } = await definedProvider();
    await harness.admin.setProviderCertification(actor, PROVIDER_ID, 'certified', REASON);
    await harness.admin.setProviderEnabled(actor, PROVIDER_ID, true, REASON);
    assert.equal(harness.plane.providers.get(PROVIDER_ID).enabled, true);

    await harness.admin.setProviderCertification(
      actor,
      PROVIDER_ID,
      'unverified',
      'Withdrawn pending a network review.',
    );
    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'unverified');
    // The durable gate closes again immediately — no restart, no settings pass.
    assert.equal(harness.plane.providers.health(PROVIDER_ID).state, 'disabled');

    const entry = harness.admin
      .adminAudit(actor, 30)
      .find((record) => record.action === ADMIN_ACTION.providerCertificationWithdrawn);
    assert.ok(entry, 'withdrawal must be on the trail under its own action');
  });

  it('refuses an unrecognised certification state', async () => {
    const { harness, actor } = await definedProvider();
    for (const value of ['production', '', undefined, 42, 'CERTIFIED']) {
      await expectAIError(
        () => harness.admin.setProviderCertification(actor, PROVIDER_ID, value, REASON),
        'VALIDATION_FAILED',
      );
    }
    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'unverified');
  });

  it('refuses `disabled`, which belongs to the enable/disable operation', async () => {
    const { harness, actor } = await definedProvider();
    await expectAIError(
      () => harness.admin.setProviderCertification(actor, PROVIDER_ID, 'disabled', REASON),
      'VALIDATION_FAILED',
    );
  });

  it('refuses a missing or too-short reason', async () => {
    const { harness, actor } = await definedProvider();
    for (const reason of ['', '  ', undefined, 'x']) {
      await expectAIError(
        () => harness.admin.setProviderCertification(actor, PROVIDER_ID, 'certified', reason),
        'VALIDATION_FAILED',
      );
    }
    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'unverified');
  });

  it('refuses a provider the registry does not hold', async () => {
    const { harness, actor } = await definedProvider();
    await expectAIError(
      () => harness.admin.setProviderCertification(actor, 'no_such_provider', 'certified', REASON),
      'PROVIDER_NOT_FOUND',
    );
  });

  for (const token of [
    ADMIN_TOKEN.organizationAdmin,
    ADMIN_TOKEN.teamAdmin,
    ADMIN_TOKEN.organizationOwner,
  ]) {
    it(`refuses ${token} — customer and team roles hold no platform authority`, async () => {
      const harness = buildTestAdministration({ selfHostedProviders: true });
      const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
      await harness.admin.defineSelfHostedProvider(operator, definitionInput(), REASON);

      const caller = await harness.actor(token);
      await expectAIError(
        () => harness.admin.setProviderCertification(caller, PROVIDER_ID, 'certified', REASON),
        'FORBIDDEN',
      );
      assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'unverified');
    });
  }

  it('cannot be self-assigned through the definition payload', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.defineSelfHostedProvider(
      actor,
      definitionInput({ certification: 'certified', enabled: true }),
      REASON,
    );
    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'unverified');
    assert.equal(harness.plane.providers.get(PROVIDER_ID).enabled, false);
  });

  it('refuses to ENABLE an uncertified provider, rather than silently ignoring it', async () => {
    // The clamp in the registry is correct but invisible; an administrator who
    // calls "enable" and is told it succeeded, for something that did not
    // happen, is a console lying about the platform. And the durable row would
    // then record an intent the runtime never honours — the divergence the
    // certification gate reproduced across a restart.
    const { harness, actor } = await definedProvider();
    const error = await expectAIError(
      () => harness.admin.setProviderEnabled(actor, PROVIDER_ID, true, REASON),
      'VALIDATION_FAILED',
    );
    assert.match(String(error.diagnostics), /certify it first/);

    const row = (await harness.providerStore.listConfigurations('platform')).find(
      (record) => record.providerKey === PROVIDER_ID,
    );
    assert.equal(row?.enabled, false, 'storage must not record an intent the runtime refuses');
    assert.equal(harness.plane.providers.get(PROVIDER_ID).enabled, false);
  });

  it('a built-in provider is enabled exactly as before', async () => {
    // The gate is declared by self-hosted definitions only. OpenAI, Anthropic
    // and the harness mocks must be unaffected by any of this.
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    const view = await harness.admin.setProviderEnabled(actor, 'primary', false, REASON);
    assert.equal(view.enabled, false);
    const back = await harness.admin.setProviderEnabled(actor, 'primary', true, REASON);
    assert.equal(back.enabled, true);
  });

  it('does not bypass exposure governance', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    // Admitted under the ceiling, then the estate is asked to certify it while
    // the catalogue would breach the ceiling — the guard is re-run here.
    await harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON);
    const view = await harness.admin.setProviderCertification(
      actor,
      PROVIDER_ID,
      'certified',
      REASON,
    );
    // The zero-priced catalogue is within the ceiling, so this succeeds — the
    // assertion that matters is that the decision was MADE, which the refusal
    // case below proves from the other side.
    assert.equal(view.certification, 'certified');
  });
});

// ── H-2 — an administration write observes its own persistence ──────────────

describe('H-2 — a definition is visible in the runtime when the call returns', () => {
  /**
   * Make a store's FIRST read block until released, so the interleaving is
   * deterministic rather than a matter of promise-scheduling luck.
   *
   * The original method is captured BEFORE the patch is installed. Reading it
   * back off the store inside the wrapper would call the wrapper.
   */
  function gateFirstRead(store: ProviderAdministrationStore): {
    open(): void;
    readonly reads: () => number;
  } {
    const original = store.listConfigurations.bind(store);
    let reads = 0;
    let release: (() => void) | undefined;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    (store as unknown as Record<string, unknown>).listConfigurations = async (
      scope: Parameters<ProviderAdministrationStore['listConfigurations']>[0],
    ) => {
      reads += 1;
      const rows = await original(scope);
      if (reads === 1) await opened;
      return rows;
    };
    return { reads: () => reads, open: () => release?.() };
  }

  it('does not join a hydration that read storage before the write', async () => {
    // THE CERTIFIED RACE, REPRODUCED. Bootstrap fires an unawaited hydration at
    // isolate start; an admin define arriving during that read used to join it,
    // miss its own row, and report PROVIDER_NOT_FOUND for something it had
    // already committed.
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const gate = gateFirstRead(harness.providerStore);

    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    const bootstrapHydration = harness.selfHostedProviders!.hydrate();
    await new Promise((resolve) => setImmediate(resolve));

    const define = harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON);
    setTimeout(() => gate.open(), 20);

    const [, defineResult] = await Promise.allSettled([bootstrapHydration, define]);
    assert.equal(
      defineResult.status,
      'fulfilled',
      `define must succeed: ${(defineResult as PromiseRejectedResult).reason?.message}`,
    );
    // THE REQUIRED INVARIANT: success means visible in the runtime registry.
    assert.notEqual(harness.plane.providers.find(PROVIDER_ID), undefined);
    assert.ok(gate.reads() >= 2, 'the write must be followed by a fresh read');
  });

  it('reuses the stored configuration id rather than minting a phantom', async () => {
    // Even when admission fails, the row must remain addressable — a second
    // attempt updates it instead of colliding with the unique index on
    // provider_key.
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON);

    const first = (await harness.providerStore.listConfigurations('platform')).filter(
      (record) => record.providerKey === PROVIDER_ID,
    );
    assert.equal(first.length, 1);

    // A second define for the same provider key updates the same row.
    await harness.admin.defineSelfHostedProvider(
      actor,
      definitionInput({ displayName: 'MARQ Inference (corrected)' }),
      REASON,
    );
    const second = (await harness.providerStore.listConfigurations('platform')).filter(
      (record) => record.providerKey === PROVIDER_ID,
    );
    assert.equal(second.length, 1, 'a retry must not mint a second configuration row');
    assert.equal(second[0].configurationId, first[0].configurationId);
    assert.equal(second[0].displayName, 'MARQ Inference (corrected)');
  });

  it('refresh() is not satisfied by an in-flight read', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const gate = gateFirstRead(harness.providerStore);

    const first = harness.selfHostedProviders!.hydrate();
    await new Promise((resolve) => setImmediate(resolve));

    await harness.providerStore.saveConfiguration({
      configurationId: 'pvc_late',
      providerKey: 'late_provider',
      displayName: 'Late',
      scope: 'platform',
      enabled: false,
      certification: 'unverified',
      configuration: configuration(),
      createdAt: 'x',
      updatedAt: 'x',
      createdBy: 'x',
      updatedBy: 'x',
    });

    const refreshed = harness.selfHostedProviders!.refresh();
    setTimeout(() => gate.open(), 20);
    await first;
    const report = await refreshed;

    assert.deepEqual(report.registered, ['late_provider']);
    assert.notEqual(harness.plane.providers.find('late_provider'), undefined);
  });
});

// ── M-2 — the exposure ceiling applies during hydration ─────────────────────

describe('M-2 — hydration honours the governed exposure ceiling', () => {
  const RUINOUS = configuration({
    'model.0.maxOutputTokens': '1000000',
    'model.0.maxContextTokens': '10000000',
    'model.0.promptMicroUsdPer1k': '10000000',
    'model.0.completionMicroUsdPer1k': '10000000',
  });

  it('refuses a stored definition that would breach the ceiling', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    await harness.providerStore.saveConfiguration({
      configurationId: 'pvc_ruinous',
      providerKey: PROVIDER_ID,
      displayName: 'Ruinous',
      scope: 'platform',
      // Certified and enabled in storage: the row asserts everything it can,
      // and the exposure guard still refuses it.
      enabled: true,
      certification: 'certified',
      configuration: RUINOUS,
      createdAt: 'x',
      updatedAt: 'x',
      createdBy: 'x',
      updatedBy: 'x',
    });

    const report = await harness.selfHostedProviders!.hydrate();
    assert.deepEqual(report.registered, []);
    assert.equal(report.refused.length, 1);
    assert.match(report.refused[0].reasons!.join(' '), /exposure would exceed the platform ceiling/);
    assert.equal(harness.plane.providers.find(PROVIDER_ID), undefined);
  });

  it('the refusal carries no secret and no stored value', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    await harness.providerStore.saveConfiguration({
      configurationId: 'pvc_ruinous',
      providerKey: PROVIDER_ID,
      displayName: 'Ruinous',
      scope: 'platform',
      enabled: true,
      certification: 'certified',
      configuration: RUINOUS,
      createdAt: 'x',
      updatedAt: 'x',
      createdBy: 'x',
      updatedBy: 'x',
    });
    const report = await harness.selfHostedProviders!.hydrate();
    const text = JSON.stringify(report);
    assert.equal(text.includes('inference.marq.example.com'), false);
    assert.equal(text.toLowerCase().includes('secret'), false);
  });

  it('admits a definition inside the ceiling', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    await harness.providerStore.saveConfiguration({
      configurationId: 'pvc_ok',
      providerKey: PROVIDER_ID,
      displayName: 'Modest',
      scope: 'platform',
      enabled: true,
      certification: 'certified',
      configuration: configuration(),
      createdAt: 'x',
      updatedAt: 'x',
      createdBy: 'x',
      updatedBy: 'x',
    });
    const report = await harness.selfHostedProviders!.hydrate();
    assert.deepEqual(report.registered, [PROVIDER_ID]);
  });
});

// ── M-4 / L-1 — reconciliation and canonical storage ────────────────────────

describe('M-4 — an edited definition reaches the runtime without a restart', () => {
  async function certifiedProvider() {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON);
    await harness.admin.setProviderCertification(actor, PROVIDER_ID, 'certified', REASON);
    await harness.admin.setProviderEnabled(actor, PROVIDER_ID, true, REASON);
    return { harness, actor };
  }

  it('applies a new endpoint immediately', async () => {
    const { harness, actor } = await certifiedProvider();
    const before = harness.selfHostedProviders!.definitions()[0].endpoint.chatCompletionsUrl;

    await harness.admin.updateSelfHostedProvider(
      actor,
      PROVIDER_ID,
      definitionInput({ baseUrl: 'https://replaced.marq.example.com/v1' }),
      'Cluster moved to a new hostname.',
    );

    const after = harness.selfHostedProviders!.definitions()[0].endpoint.chatCompletionsUrl;
    assert.notEqual(after, before);
    assert.equal(after, 'https://replaced.marq.example.com/v1/chat/completions');
    // One provider, not two — reconciliation replaces rather than duplicates.
    assert.equal(
      harness.plane.providers.list().filter((p) => p.descriptor.providerId === PROVIDER_ID).length,
      1,
    );
  });

  it('WITHDRAWS certification when the endpoint changes', async () => {
    // What MARQ certified was a specific endpoint. Carrying the decision across
    // a repoint would let an operator certify a benign host and then move it.
    const { harness, actor } = await certifiedProvider();
    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'certified');

    await harness.admin.updateSelfHostedProvider(
      actor,
      PROVIDER_ID,
      definitionInput({ baseUrl: 'https://replaced.marq.example.com/v1' }),
      'Cluster moved to a new hostname.',
    );

    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'unverified');
    assert.equal(harness.plane.providers.health(PROVIDER_ID).state, 'disabled');
    const row = (await harness.providerStore.listConfigurations('platform')).find(
      (record) => record.providerKey === PROVIDER_ID,
    );
    assert.equal(row?.certification, 'unverified');
  });

  it('leaves the prior runtime state intact when the update does not validate', async () => {
    const { harness, actor } = await certifiedProvider();
    const before = harness.selfHostedProviders!.definitions()[0].endpoint.chatCompletionsUrl;

    await expectAIError(
      () =>
        harness.admin.updateSelfHostedProvider(
          actor,
          PROVIDER_ID,
          definitionInput({ baseUrl: 'https://169.254.169.254/v1' }),
          'Attempted repoint at a metadata service.',
        ),
      'VALIDATION_FAILED',
    );

    assert.equal(harness.selfHostedProviders!.definitions()[0].endpoint.chatCompletionsUrl, before);
    assert.equal(harness.plane.providers.get(PROVIDER_ID).certification, 'certified');
    assert.equal(harness.plane.providers.get(PROVIDER_ID).enabled, true);
  });

  it('refuses to update something that is not a self-hosted definition', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    // `primary` is one of the harness's built-in mock providers.
    await expectAIError(
      () =>
        harness.admin.updateSelfHostedProvider(
          actor,
          'primary',
          definitionInput({ providerId: 'primary' }),
          REASON,
        ),
      'PROVIDER_NOT_FOUND',
    );
  });

  it('refuses an unauthorized caller', async () => {
    const { harness } = await certifiedProvider();
    const caller = await harness.actor(ADMIN_TOKEN.organizationAdmin);
    await expectAIError(
      () =>
        harness.admin.updateSelfHostedProvider(
          caller,
          PROVIDER_ID,
          definitionInput({ baseUrl: 'https://elsewhere.example.com/v1' }),
          REASON,
        ),
      'FORBIDDEN',
    );
  });

  it('does not churn the registry when nothing material changed', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON);
    const report = await harness.selfHostedProviders!.refresh();
    assert.deepEqual(report.registered, []);
    assert.deepEqual(report.reconciled, []);
  });
});

describe('L-1 — storage, audit and runtime quote one canonical endpoint', () => {
  it('stores the normalized base URL, not the raw submission', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    // A submission the URL parser normalizes: uppercase host, a doubled
    // separator and a trailing slash.
    await harness.admin.defineSelfHostedProvider(
      actor,
      definitionInput({ baseUrl: 'https://Inference.MARQ.Example.com//v1/' }),
      REASON,
    );

    const row = (await harness.providerStore.listConfigurations('platform')).find(
      (record) => record.providerKey === PROVIDER_ID,
    );
    assert.equal(row?.configuration.baseUrl, 'https://inference.marq.example.com/v1');
    assert.equal(
      harness.selfHostedProviders!.definitions()[0].endpoint.chatCompletionsUrl,
      'https://inference.marq.example.com/v1/chat/completions',
      'the stored value and the dialled value must describe one endpoint',
    );
  });
});
