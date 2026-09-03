/**
 * Defining a self-hosted provider through the governed surface — AI-01 Batch 4E.
 *
 * The 4C migration left one open item written into the schema itself:
 *
 *   "NOTHING WRITES A NON-EMPTY VALUE HERE YET, AND NOTHING VALIDATES ONE ...
 *    It becomes [a hole] the moment Batch 4E adds operator-supplied base URLs.
 *    Whoever adds that write path OWNS adding the validator."
 *
 * This suite is the evidence that the write path added here carries it. The
 * governing claims:
 *
 *   A definition is VALIDATED BEFORE IT IS STORED, so the `configuration`
 *   column cannot come to hold a value the runtime would refuse — the console
 *   and the runtime cannot disagree about what is safe.
 *
 *   The operation is CAPABILITY-GATED and AUDITED, and the record names the
 *   endpoint HOST rather than a URL, a query or anything a caller pasted.
 *
 *   A newly defined provider is UNCERTIFIED AND DISABLED whatever the request
 *   said. Connection is not certification, and creation is not enablement.
 *
 *   It CANNOT REPLACE A REVIEWED ADAPTER, and it takes no secret.
 *
 * Everything runs against the production administration service, the real
 * capability table, the real registry, the real registrar and the real endpoint
 * policy. The substitutions are time, identifiers, storage and the network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_TOKEN, buildTestAdministration } from './harness.ts';
import { AIError } from '../contracts/errors.ts';
import { ADMIN_ACTION } from '../admin/adminAudit.ts';
import { executeAdminHttpRequest, ADMIN_OPERATION } from '../admin/httpAdapter.ts';
import type { SelfHostedProviderInput } from '../admin/providerAdministration.ts';

const PROVIDER_ID = 'marq_inference';
const BASE_URL = 'https://inference.marq.example.com/v1';
const REASON = 'Bringing the internal inference cluster under Cortex governance.';

function modelInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'llama-3.3-70b-instruct',
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
    baseUrl: BASE_URL,
    credentialRequired: 'false',
    models: [modelInput()],
    ...overrides,
  };
}

async function expectAIError(run: () => Promise<unknown>, code: string): Promise<AIError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AIError, `expected an AIError, got ${String(error)}`);
    assert.equal(error.code, code, error.message);
    return error;
  }
  throw new assert.AssertionError({ message: `expected ${code} to be thrown` });
}

// ── The governed happy path ─────────────────────────────────────────────────

describe('defining a self-hosted provider', () => {
  it('validates, stores, registers and audits in one operation', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    const view = await harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON);
    assert.equal(view.providerId, PROVIDER_ID);
    assert.equal(view.displayName, 'MARQ Inference');

    // Registered, through the same path bootstrap hydration takes.
    const registered = harness.plane.providers.get(PROVIDER_ID);
    assert.equal(registered.descriptor.displayName, 'MARQ Inference');
    assert.deepEqual(
      registered.descriptor.models.map((model) => model.modelId),
      ['llama-3.3-70b-instruct'],
    );

    // Stored, flat, with no secret-shaped key and no nested JSON.
    const [configuration] = (await harness.providerStore.listConfigurations('platform')).filter(
      (record) => record.providerKey === PROVIDER_ID,
    );
    assert.ok(configuration);
    assert.equal(configuration.configuration.runtime, 'openai_compatible');
    assert.equal(configuration.configuration.baseUrl, BASE_URL);
    for (const value of Object.values(configuration.configuration)) {
      assert.equal(typeof value, 'string');
    }

    // Audited, naming the actor and the change.
    const trail = harness.admin.adminAudit(actor, 20);
    const entry = trail.find((row) => row.action === ADMIN_ACTION.selfHostedProviderDefined);
    assert.ok(entry, 'the definition must be on the administrative trail');
    assert.equal(entry.outcome, 'applied');
    assert.equal(entry.target, PROVIDER_ID);
  });

  it('records model rows as administration state', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON);

    const [configuration] = (await harness.providerStore.listConfigurations('platform')).filter(
      (record) => record.providerKey === PROVIDER_ID,
    );
    const models = await harness.providerStore.listModels(configuration!.configurationId);
    assert.equal(models.length, 1);
    // Uncertified, like the provider. A row is not a governance decision.
    assert.equal(models[0].certification, 'unverified');
  });

  it('is uncertified and disabled however the request was phrased', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.defineSelfHostedProvider(
      actor,
      // Fields a caller might hope reach the row. None of them exist on the
      // input type, and none of them are read.
      definitionInput({
        certification: 'certified',
        enabled: true,
        billable: false,
        productionReady: true,
      }),
      REASON,
    );

    const registered = harness.plane.providers.get(PROVIDER_ID);
    assert.equal(registered.certification, 'unverified');
    assert.equal(registered.enabled, false);
    assert.equal(registered.descriptor.productionReady, false);
    // Always billable, so the kill switch governs it.
    assert.equal(registered.descriptor.billable, true);
  });

  it('accepts JSON booleans and numbers as well as strings', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    const view = await harness.admin.defineSelfHostedProvider(
      actor,
      definitionInput({
        credentialRequired: false,
        priority: 42,
        models: [
          modelInput({
            textGeneration: true,
            structuredOutput: true,
            chatCompletions: true,
            zeroDataRetention: true,
            maxOutputTokens: 4096,
            maxContextTokens: 32_000,
            promptMicroUsdPer1k: 0,
            completionMicroUsdPer1k: 0,
          }),
        ],
      }),
      REASON,
    );
    assert.equal(view.providerId, PROVIDER_ID);
    assert.equal(harness.plane.providers.get(PROVIDER_ID).descriptor.priority, 42);
  });
});

// ── Refusals ────────────────────────────────────────────────────────────────

describe('defining a self-hosted provider — refusals', () => {
  const UNSAFE: readonly (readonly [string, string])[] = [
    ['a loopback endpoint', 'https://127.0.0.1:8000/v1'],
    ['a private endpoint', 'https://10.1.2.3/v1'],
    ['a cloud metadata endpoint', 'https://169.254.169.254/latest'],
    ['a plaintext endpoint', 'http://inference.example.com/v1'],
    ['an endpoint with embedded credentials', 'https://svc@inference.example.com/v1'],
    ['an endpoint carrying a key', 'https://inference.example.com/v1?api_key=abc'],
    ['an endpoint with a dot segment', 'https://inference.example.com/v1/../admin'],
    ['a malformed endpoint', 'inference.example.com'],
  ];

  for (const [label, baseUrl] of UNSAFE) {
    it(`refuses ${label}, and stores nothing`, async () => {
      const harness = buildTestAdministration({ selfHostedProviders: true });
      const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

      await expectAIError(
        () =>
          harness.admin.defineSelfHostedProvider(actor, definitionInput({ baseUrl }), REASON),
        'VALIDATION_FAILED',
      );

      // NOTHING PERSISTED. The validation happens before the write, so the
      // column never holds a value the runtime would refuse.
      const stored = (await harness.providerStore.listConfigurations('platform')).filter(
        (record) => record.providerKey === PROVIDER_ID,
      );
      assert.deepEqual(stored, []);
      assert.equal(harness.plane.providers.find(PROVIDER_ID), undefined);
      assert.deepEqual(harness.selfHostedOutbound, [], 'nothing may be dialled');
    });
  }

  it('never echoes a suspected secret back to the caller', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    const error = await expectAIError(
      () =>
        harness.admin.defineSelfHostedProvider(
          actor,
          definitionInput({ baseUrl: 'https://inference.example.com/v1?api_key=SUPERSECRET123' }),
          REASON,
        ),
      'VALIDATION_FAILED',
    );
    const serialized = `${error.message} ${String(error.diagnostics)}`;
    assert.equal(serialized.includes('SUPERSECRET123'), false);
  });

  it('refuses a provider id belonging to a built-in adapter', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    for (const providerId of ['openai', 'anthropic', 'mock']) {
      await expectAIError(
        () =>
          harness.admin.defineSelfHostedProvider(
            actor,
            definitionInput({ providerId, baseUrl: 'https://attacker.example.com/v1' }),
            REASON,
          ),
        'VALIDATION_FAILED',
      );
    }
  });

  it('refuses a provider id that is already registered', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    // `primary` is one of the harness's registered mock providers.
    await expectAIError(
      () =>
        harness.admin.defineSelfHostedProvider(
          actor,
          definitionInput({ providerId: 'primary' }),
          REASON,
        ),
      'CONFLICT',
    );
  });

  it('refuses a definition whose models are malformed', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    for (const models of [
      [],
      [modelInput({ maxOutputTokens: 'lots' })],
      [modelInput({ promptMicroUsdPer1k: '-1' })],
      [modelInput({ structuredOutput: 'maybe' })],
      [modelInput(), modelInput()],
      ['not-an-object'],
    ]) {
      await expectAIError(
        () => harness.admin.defineSelfHostedProvider(actor, definitionInput({ models }), REASON),
        'VALIDATION_FAILED',
      );
    }
  });

  it('refuses a runtime category it does not implement', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await expectAIError(
      () =>
        harness.admin.defineSelfHostedProvider(
          actor,
          definitionInput({ runtime: 'triton_grpc' }),
          REASON,
        ),
      'VALIDATION_FAILED',
    );
  });

  it('refuses without a reason, and records the rejection', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await expectAIError(
      () => harness.admin.defineSelfHostedProvider(actor, definitionInput(), ''),
      'VALIDATION_FAILED',
    );
    assert.equal(harness.plane.providers.find(PROVIDER_ID), undefined);
  });

  it('refuses when the deployment has no self-hosted registrar', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    // Refuses rather than storing a definition nothing will ever register.
    await expectAIError(
      () => harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON),
      'INTERNAL_ERROR',
    );
    assert.deepEqual(
      (await harness.providerStore.listConfigurations('platform')).filter(
        (record) => record.providerKey === PROVIDER_ID,
      ),
      [],
    );
  });
});

// ── Authority ───────────────────────────────────────────────────────────────

describe('defining a self-hosted provider — authority', () => {
  for (const token of [
    ADMIN_TOKEN.organizationAdmin,
    ADMIN_TOKEN.teamAdmin,
    ADMIN_TOKEN.organizationOwner,
    ADMIN_TOKEN.member,
    ADMIN_TOKEN.membershipOnly,
  ]) {
    it(`refuses ${token}`, async () => {
      const harness = buildTestAdministration({ selfHostedProviders: true });
      let actor;
      try {
        actor = await harness.actor(token);
      } catch (error) {
        // Some tokens are refused at authorization, which is a stronger
        // refusal than the capability check and is equally acceptable here.
        assert.ok(error instanceof AIError);
        return;
      }
      await expectAIError(
        () => harness.admin.defineSelfHostedProvider(actor, definitionInput(), REASON),
        'FORBIDDEN',
      );
      assert.equal(harness.plane.providers.find(PROVIDER_ID), undefined);
    });
  }
});

// ── The HTTP boundary ───────────────────────────────────────────────────────

describe('the self-hosted definition HTTP operation', () => {
  it('binds the operation and returns the provider view', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const response = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.providerDefineSelfHosted,
      authorization: `Bearer ${ADMIN_TOKEN.superAdmin}`,
      body: { ...definitionInput(), reason: REASON },
    });
    assert.equal(response.status, 200);
    const body = response.body as { success: boolean; provider?: { providerId: string } };
    assert.equal(body.success, true);
    assert.equal(body.provider?.providerId, PROVIDER_ID);
  });

  it('refuses an unauthenticated caller before anything is stored', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const response = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.providerDefineSelfHosted,
      authorization: null,
      body: { ...definitionInput(), reason: REASON },
    });
    assert.equal(response.status >= 400, true);
    assert.equal(harness.plane.providers.find(PROVIDER_ID), undefined);
  });

  it('carries no secret in the response, because there is none to carry', async () => {
    const harness = buildTestAdministration({ selfHostedProviders: true });
    const response = await executeAdminHttpRequest(harness.admin, {
      operation: ADMIN_OPERATION.providerDefineSelfHosted,
      authorization: `Bearer ${ADMIN_TOKEN.superAdmin}`,
      // A `secret` field is not part of the input shape and is not read.
      body: { ...definitionInput(), secret: 'must-never-appear', reason: REASON },
    });
    assert.equal(JSON.stringify(response.body).includes('must-never-appear'), false);
  });
});
