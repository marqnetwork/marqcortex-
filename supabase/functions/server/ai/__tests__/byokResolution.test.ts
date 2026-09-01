/**
 * Tenant-aware credential resolution — AI-01 Batch 4D.
 *
 * The administration suite proves a customer can STORE a credential. This one
 * proves the runtime EXECUTES WITH IT — and, more importantly, proves the four
 * things it must never do:
 *
 *   never serve one tenant on another tenant's credential;
 *   never serve MARQ's own execution on a customer's credential;
 *   never fall through to MARQ's credential when a customer's exists and will
 *     not open;
 *   never change what a tenant that has configured nothing executes on.
 *
 * WHAT IS UNDER TEST. The real `createProviderCredentialResolver`, the real
 * precedence decision, the real AES-256-GCM cipher with its real additional
 * authenticated data, and — for the end-to-end sections — the real control
 * plane, the real OpenAI and Anthropic adapters, the real selector, the real
 * spend guard and the real audit writer.
 *
 * NO REAL PROVIDER REQUEST IS MADE ANYWHERE IN THIS FILE. The adapters take an
 * injected `fetch`, exactly as the certified Batch 4A and 4B proofs do; the
 * transport never leaves the process, and the suite asserts on what WOULD have
 * been sent. Every credential in this file is fictional.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACME_SECRET,
  BYOK_PREVIOUS_ROOT_KEY,
  BYOK_PROVIDER,
  BYOK_REASON,
  BYOK_ROOT_KEY,
  BYOK_TOKEN,
  ENVIRONMENT_SECRET,
  GLOBEX_SECRET,
  ORG,
  PLATFORM_SECRET,
  buildByokHarness,
  configureFor,
} from './byokFixtures.ts';
import type { CredentialTenant } from '../providers/credentials/contracts.ts';
import { decideTenantCredential, fallbackPolicyOf } from '../providers/credentials/tenantPrecedence.ts';
import { createSecretCipher, parseRootKey } from '../providers/credentials/secretCipher.ts';
import { createProviderCredentialResolver } from '../providers/credentials/resolver.ts';
import { createMemoryProviderAdministrationStore } from '../providers/credentials/credentialStore.ts';
import { createTestClock } from '../runtime/clock.ts';
import { recordEnv } from '../runtime/env.ts';
import { createControlPlane } from '../controlPlane.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createMemorySink } from '../observability/logger.ts';
import { createMemorySpendStore } from '../policy/spendLedger.ts';
import { createMemorySettingsStore } from '../admin/settingsStore.ts';
import { createOpenAIProvider, type FetchLike } from '../providers/openaiProvider.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { executeAIHttpRequest } from '../http/httpAdapter.ts';
import { FEATURE } from '../features/index.ts';
import type { AIAuthenticator, AuthenticatedSubject } from '../security/actor.ts';

/** The tenant shape the pipeline builds from a resolved organization. */
const verified = (organizationId: string): CredentialTenant => ({
  organizationId,
  membershipVerified: true,
});

// ── The precedence decision, on its own ─────────────────────────────────────

describe('Batch 4D — the tenant precedence decision', () => {
  it('uses the tenant’s own credential when there is one', () => {
    const decision = decideTenantCredential({
      configurationPresent: true,
      configurationEnabled: true,
      activeCredentialPresent: true,
    });
    assert.equal(decision.action, 'tenant');
  });

  it('falls back to the platform for every "no usable credential" state', () => {
    // THREE DISTINCT REASONS, ONE OUTCOME. What differs is what the console
    // says; whether MARQ's key stands behind the tenant is decided by the
    // tenant's policy and by nothing else.
    for (const facts of [
      { configurationPresent: false, configurationEnabled: false, activeCredentialPresent: false },
      { configurationPresent: true, configurationEnabled: false, activeCredentialPresent: true },
      { configurationPresent: true, configurationEnabled: true, activeCredentialPresent: false },
    ]) {
      const decision = decideTenantCredential(facts);
      assert.equal(decision.action, 'platform', JSON.stringify(facts));
      assert.ok(decision.reason.length > 0);
    }
  });

  it('fails closed for a tenant whose policy is its own credential only', () => {
    for (const facts of [
      { configurationPresent: false, configurationEnabled: false, activeCredentialPresent: false },
      { configurationPresent: true, configurationEnabled: true, activeCredentialPresent: false },
    ]) {
      const decision = decideTenantCredential({ ...facts, fallback: 'tenant_only' });
      assert.equal(decision.action, 'fail_closed', JSON.stringify(facts));
      assert.match(decision.reason, /own credential only/);
    }
  });

  it('reads an absent fallback policy as the value that changes nothing', () => {
    // A row written before the column existed, or by an older service, must
    // behave exactly as it did in Batch 4C. Reading absent as `tenant_only`
    // would take a tenant's AI down on a migration.
    assert.equal(fallbackPolicyOf(undefined), 'platform');
    assert.equal(fallbackPolicyOf('platform'), 'platform');
    assert.equal(fallbackPolicyOf('tenant_only'), 'tenant_only');
  });

  it('names a state and never an identifier', () => {
    // The reason reaches an API response. It must name STATES, never credential
    // ids, fingerprints or organization ids — anything a caller could probe
    // another tenant with.
    for (const fallback of ['platform', 'tenant_only'] as const) {
      for (const present of [true, false]) {
        const decision = decideTenantCredential({
          configurationPresent: present,
          configurationEnabled: present,
          activeCredentialPresent: false,
          fallback,
        });
        assert.ok(!/pvk_|pvc_|fp_|k_/.test(decision.reason), decision.reason);
      }
    }
  });
});

// ── Resolution through the real resolver ────────────────────────────────────

describe('Batch 4D — the resolver answers per tenant', () => {
  it('resolves a tenant’s own credential for that tenant', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    const resolved = await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.acme));

    assert.ok(resolved, 'nothing resolved for the tenant that configured a credential');
    assert.equal(resolved.secret, ACME_SECRET);
    assert.equal(resolved.category, 'customer_byok');
    assert.equal(resolved.organizationId, ORG.acme);
    assert.equal(resolved.source, 'managed');
  });

  it('never serves one tenant on another tenant’s credential', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);

    const acme = await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.acme));
    const globex = await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.globex));

    assert.equal(acme?.secret, ACME_SECRET);
    assert.equal(globex?.secret, GLOBEX_SECRET);
    assert.notEqual(acme?.secret, globex?.secret);
    assert.notEqual(acme?.credentialId, globex?.credentialId);
  });

  it('never lets one tenant’s credential become another tenant’s fallback', async () => {
    // THE CLAIM THIS BATCH MOST NEEDS. Acme has a credential; Globex has none.
    // Globex must resolve the PLATFORM path, never Acme's key — a "managed
    // credential exists for this provider" lookup that forgot its tenant
    // predicate would return Acme's here and nothing would fail.
    const harness = buildByokHarness({ env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET } });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    const globex = await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.globex));

    assert.ok(globex);
    assert.notEqual(globex.secret, ACME_SECRET, 'Globex was served Acme’s credential');
    assert.equal(globex.category, 'environment');
    assert.equal(globex.organizationId, undefined);
  });

  it('keeps MARQ’s own execution off every customer credential', async () => {
    // No tenant argument is the PLATFORM path, and it must read no
    // organization-owned row at all — even when the only managed credential in
    // storage belongs to a customer.
    const harness = buildByokHarness({ env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET } });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    const platform = await harness.resolver.resolve(BYOK_PROVIDER);

    assert.ok(platform);
    assert.notEqual(platform.secret, ACME_SECRET, 'MARQ executed on a customer’s credential');
    assert.equal(platform.category, 'environment');
  });

  it('ignores a tenant whose membership was not verified', async () => {
    // `membershipVerified: false` is the AI_ALLOW_DEFAULT_ORGANIZATION fallback
    // — an account with no membership row placed in the deployment's default
    // organization. It is not a statement that this caller belongs to that
    // customer, and it buys no access to that customer's vendor key.
    const harness = buildByokHarness({ env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET } });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    const resolved = await harness.resolver.resolve(BYOK_PROVIDER, {
      organizationId: ORG.acme,
      membershipVerified: false,
    });

    assert.ok(resolved);
    assert.notEqual(resolved.secret, ACME_SECRET);
    assert.equal(resolved.category, 'environment');
  });

  it('stops resolving a revoked credential on the next request', async () => {
    const harness = buildByokHarness({ env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET } });
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const configured = await harness.byok.configureCredential(
      actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON,
    );
    assert.equal(
      (await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.acme)))?.secret,
      ACME_SECRET,
    );

    await harness.byok.revokeCredential(
      actor, BYOK_PROVIDER, configured.credential.credentialId!, BYOK_REASON,
    );

    // NOT AT THE END OF A CACHE WINDOW. `resolve` reads storage on every
    // attempt and decrypts every time, which is the whole reason a revoked
    // credential stops working on the next request.
    const after = await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.acme));
    assert.notEqual(after?.secret, ACME_SECRET);
    assert.equal(after?.category, 'environment');
  });

  it('fails closed for a tenant whose policy forbids the platform credential', async () => {
    const harness = buildByokHarness({ env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET } });
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.setFallbackPolicy(actor, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);

    const resolved = await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.acme));

    assert.equal(resolved, undefined, 'a tenant_only tenant with no key resolved something');
    assert.ok(
      harness.resolutionErrors.some((line) => /own credential only/.test(line)),
      'the refusal was not reported to the operator channel',
    );
    // And the PLATFORM path is unaffected by that tenant's choice.
    assert.equal((await harness.resolver.resolve(BYOK_PROVIDER))?.category, 'environment');
  });

  it('refuses rather than falling through when a tenant’s credential will not open', async () => {
    // THE CASE THE PRECEDENCE EXISTS FOR. The tenant HAS a credential and the
    // platform cannot honour it — a root key rotated, a tampered record.
    // Falling through would move that customer's traffic onto MARQ's vendor
    // account at the exact moment their own key became unreadable, while the
    // console went on reporting `customer_byok` from a row that still says
    // `active`.
    //
    // Arranged by giving the RESOLVER a different root key than the service
    // sealed under, which is the real shape of a root key rotation rather than
    // a hand-corrupted record.
    const harness = buildByokHarness({
      env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET },
      resolverRootKey: BYOK_PREVIOUS_ROOT_KEY,
    });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    const resolved = await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.acme));

    assert.equal(resolved, undefined, 'the tenant fell through to the platform credential');
    // The operator is told the two key identities and the remedy — the one
    // failure whose remedy is not guessable from the symptom.
    const reported = harness.resolutionErrors.join('\n');
    assert.match(reported, /sealed under root key k_/);
    assert.match(reported, /must be re-entered/);
    // AND NEITHER THE SECRET NOR THE ROOT KEY IS IN IT.
    assert.ok(!reported.includes(ACME_SECRET));
    assert.ok(!reported.includes(BYOK_ROOT_KEY));
    assert.ok(!reported.includes(BYOK_PREVIOUS_ROOT_KEY));
  });

  it('does not open a ciphertext moved onto another tenant’s row', async () => {
    // THE AAD, ASKED DIRECTLY. An attacker holding UPDATE on the credential
    // table copies Acme's sealed record onto Globex's configuration. The
    // organization is authenticated but not encrypted, so the record does not
    // open under Globex's binding — cross-tenant credential reuse is refused by
    // the cipher and not merely by the query above it.
    const store = createMemoryProviderAdministrationStore();
    const cipher = createSecretCipher(parseRootKey(BYOK_ROOT_KEY));
    const clock = createTestClock();
    const sealed = await cipher.seal(ACME_SECRET, {
      providerKey: BYOK_PROVIDER,
      scope: 'organization',
      credentialId: 'pvk_acme',
      organizationId: ORG.acme,
    });

    // Opening it under its OWN binding works.
    assert.equal(
      await cipher.open(sealed, {
        providerKey: BYOK_PROVIDER,
        scope: 'organization',
        credentialId: 'pvk_acme',
        organizationId: ORG.acme,
      }),
      ACME_SECRET,
    );

    // Under ANOTHER TENANT's binding it does not.
    await assert.rejects(
      () => cipher.open(sealed, {
        providerKey: BYOK_PROVIDER,
        scope: 'organization',
        credentialId: 'pvk_acme',
        organizationId: ORG.globex,
      }),
      /cannot be read/,
    );
    // Nor under the PLATFORM scope, which is the promote-to-platform attack the
    // database trigger also refuses.
    await assert.rejects(
      () => cipher.open(sealed, {
        providerKey: BYOK_PROVIDER,
        scope: 'platform',
        credentialId: 'pvk_acme',
      }),
      /cannot be read/,
    );
    void store;
    void clock;
  });

  it('leaves a deployment with no managed storage exactly where Batch 4C left it', async () => {
    // NO STORE, NO CIPHER PATH AT ALL. Every tenant, and the platform, resolve
    // the environment — which is the pre-Batch-4C behaviour, unchanged.
    const harness = buildByokHarness({
      withoutStore: true,
      env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET },
    });

    assert.equal(
      (await harness.resolver.resolve(BYOK_PROVIDER, verified(ORG.acme)))?.secret,
      ENVIRONMENT_SECRET,
    );
    assert.equal((await harness.resolver.resolve(BYOK_PROVIDER))?.secret, ENVIRONMENT_SECRET);
  });

  it('falls through to the platform when tenant storage is unreachable', async () => {
    // A DATABASE BLIP MUST NOT BE AN AI OUTAGE FOR EVERY TENANT. Storage said
    // nothing, so we learned nothing about whether this tenant has a
    // credential; the pre-existing resolution stands, which is exactly what the
    // same failure does on the platform path.
    const clock = createTestClock();
    const errors: string[] = [];
    const unreachable = {
      listConfigurations: () => Promise.reject(new Error('PGRST106: schema not exposed')),
      listOrganizationConfigurations: () =>
        Promise.reject(new Error('PGRST106: schema not exposed')),
      findConfiguration: () => Promise.reject(new Error('PGRST106: schema not exposed')),
      saveConfiguration: () => Promise.reject(new Error('unreachable')),
      listCredentials: () => Promise.reject(new Error('unreachable')),
      activeCredential: () => Promise.reject(new Error('unreachable')),
      putActiveCredential: () => Promise.reject(new Error('unreachable')),
      revokeCredential: () => Promise.reject(new Error('unreachable')),
      listModels: () => Promise.reject(new Error('unreachable')),
      saveModel: () => Promise.reject(new Error('unreachable')),
    };

    const resolver = createProviderCredentialResolver({
      profiles: [{
        providerId: BYOK_PROVIDER,
        required: true,
        manageable: true,
        environmentVariable: 'MOCK_PROVIDER_KEY',
      }],
      clock,
      env: recordEnv({ MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET }),
      store: unreachable,
      cipher: createSecretCipher(parseRootKey(BYOK_ROOT_KEY)),
      onError: (providerId, detail) => errors.push(`${providerId}: ${detail}`),
    });

    const resolved = await resolver.resolve(BYOK_PROVIDER, verified(ORG.acme));
    assert.equal(resolved?.secret, ENVIRONMENT_SECRET);
    assert.equal(resolved?.category, 'environment');
    assert.ok(errors.some((line) => /unreachable for the authenticated tenant/.test(line)));
  });

  // ── The policy we DID read decides, even when the credential read failed ──
  //
  // REGRESSION, FOUND BY AN INDEPENDENT CERTIFICATION GATE. The configuration
  // read and the credential read shared one `try`, so a failure in EITHER was
  // answered "we learned nothing, fall through to the platform". That is true
  // of the first read and false of the second: by the time the credential read
  // runs, the configuration — and with it the tenant's own fallback policy — is
  // already in hand.
  //
  // The cost of conflating them fell on the customers who bought the strictest
  // guarantee the surface offers. A `tenant_only` organization — one whose
  // stated policy is that their traffic reaches their vendor account or none —
  // was moved onto MARQ's key by a transient read error, silently, while their
  // console went on reporting `customer_byok`. The refusal below is the only
  // answer consistent with what they were told, and it costs no availability
  // for the tenants who never opted in: a `platform` tenant still falls
  // through, and a tenant whose CONFIGURATION could not be read still falls
  // through, because that failure really does leave us knowing nothing.

  /** A store that answers configurations and refuses credential reads. */
  function credentialReadFails(
    store: ReturnType<typeof createMemoryProviderAdministrationStore>,
  ) {
    return {
      ...store,
      activeCredential: () => Promise.reject(new Error('PGRST301: statement timeout')),
    };
  }

  async function resolverOverPolicy(
    fallback: 'platform' | 'tenant_only',
  ): Promise<{
    resolved: Awaited<ReturnType<ReturnType<typeof createProviderCredentialResolver>['resolve']>>;
    errors: readonly string[];
  }> {
    const clock = createTestClock();
    const store = createMemoryProviderAdministrationStore();
    const at = clock.isoNow();
    await store.saveConfiguration({
      configurationId: 'cfg-acme',
      providerKey: BYOK_PROVIDER,
      displayName: 'OpenAI',
      scope: 'organization',
      organizationId: ORG.acme,
      enabled: true,
      credentialFallback: fallback,
      certification: 'certified',
      configuration: {},
      createdAt: at,
      updatedAt: at,
      createdBy: 'user-acme-admin',
      updatedBy: 'user-acme-admin',
    });

    const errors: string[] = [];
    const resolver = createProviderCredentialResolver({
      profiles: [{
        providerId: BYOK_PROVIDER,
        required: true,
        manageable: true,
        environmentVariable: 'MOCK_PROVIDER_KEY',
      }],
      clock,
      env: recordEnv({ MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET }),
      store: credentialReadFails(store),
      cipher: createSecretCipher(parseRootKey(BYOK_ROOT_KEY)),
      onError: (providerId, detail) => errors.push(`${providerId}: ${detail}`),
    });

    return { resolved: await resolver.resolve(BYOK_PROVIDER, verified(ORG.acme)), errors };
  }

  it('refuses rather than billing MARQ when a tenant_only credential cannot be read', async () => {
    const { resolved, errors } = await resolverOverPolicy('tenant_only');

    assert.equal(
      resolved,
      undefined,
      'a tenant_only organization was moved onto MARQ’s credential by a read error',
    );
    assert.ok(
      errors.some((line) => /credential could not be read/.test(line)),
      'the read failure must reach the operator channel',
    );
    assert.ok(
      errors.some((line) => /policy forbids the platform credential/.test(line)),
      'the refusal must say the policy — not the read — is what made it final',
    );
  });

  it('still falls through for a platform-policy tenant whose credential cannot be read', async () => {
    // THE OTHER HALF, AND IT MATTERS AS MUCH. This tenant's own stated policy is
    // that MARQ's credential stands behind them, so a read failure must not
    // take their AI down — the refusal above is a policy being honoured, not a
    // new failure mode for everybody.
    const { resolved } = await resolverOverPolicy('platform');

    assert.equal(resolved?.secret, ENVIRONMENT_SECRET);
    assert.equal(resolved?.category, 'environment');
  });
});

// ── The platform estate, unchanged ──────────────────────────────────────────

describe('Batch 4D — Batch 4C behaviour is preserved exactly', () => {
  it('still prefers a managed platform credential over the environment', async () => {
    const store = createMemoryProviderAdministrationStore();
    const cipher = createSecretCipher(parseRootKey(BYOK_ROOT_KEY));
    const clock = createTestClock();

    await store.saveConfiguration({
      configurationId: 'pvc_platform',
      providerKey: BYOK_PROVIDER,
      displayName: 'OpenAI',
      scope: 'platform',
      enabled: true,
      certification: 'certified',
      configuration: {},
      createdAt: clock.isoNow(),
      updatedAt: clock.isoNow(),
      createdBy: 'operator',
      updatedBy: 'operator',
    });
    const sealed = await cipher.seal(PLATFORM_SECRET, {
      providerKey: BYOK_PROVIDER,
      scope: 'platform',
      credentialId: 'pvk_platform',
    });
    await store.putActiveCredential({
      credentialId: 'pvk_platform',
      configurationId: 'pvc_platform',
      providerKey: BYOK_PROVIDER,
      credentialName: 'primary',
      status: 'active',
      fingerprint: await cipher.fingerprint(PLATFORM_SECRET),
      secretVersion: 1,
      keyId: sealed.kid,
      createdAt: clock.isoNow(),
      updatedAt: clock.isoNow(),
      createdBy: 'operator',
      sealed,
    });

    const resolver = createProviderCredentialResolver({
      profiles: [{
        providerId: BYOK_PROVIDER,
        required: true,
        manageable: true,
        environmentVariable: 'MOCK_PROVIDER_KEY',
      }],
      clock,
      env: recordEnv({ MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET }),
      store,
      cipher,
    });

    const platform = await resolver.resolve(BYOK_PROVIDER);
    assert.equal(platform?.secret, PLATFORM_SECRET);
    assert.equal(platform?.category, 'platform_managed');

    // AND A TENANT WITH NO CONFIGURATION OF ITS OWN GETS EXACTLY THAT. This is
    // the compatibility claim in one assertion: every existing tenant, on the
    // day Batch 4D deploys, resolves precisely what it resolved the day before.
    const tenant = await resolver.resolve(BYOK_PROVIDER, verified(ORG.acme));
    assert.equal(tenant?.secret, PLATFORM_SECRET);
    assert.equal(tenant?.category, 'platform_managed');
  });

  it('still reports the platform snapshot without reading any tenant row', async () => {
    const harness = buildByokHarness({ env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET } });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    await harness.resolver.refresh();

    // `describe` is the SYNCHRONOUS availability probe the registry, the
    // selector and the spend guard all call. It is platform-scoped and stays
    // so: a customer's credential must not make a provider look configured
    // platform-wide, and it must not be reachable from a synchronous path with
    // no tenant in hand.
    const availability = harness.resolver.describe(BYOK_PROVIDER);
    assert.equal(availability.source, 'environment');
    assert.equal(availability.credentialId, undefined);
    assert.equal(availability.fingerprint, undefined);
  });
});

// ── End to end, through the real control plane ──────────────────────────────

const MODEL_ID = 'gpt-4o-mini';
const CALLER = { acme: 'caller-acme', globex: 'caller-globex' } as const;

const SUBJECTS: Readonly<Record<string, AuthenticatedSubject>> = {
  [CALLER.acme]: {
    subjectId: 'exec-acme',
    email: 'user@acme.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [{ organizationId: ORG.acme, tier: 'enterprise', roles: ['consultant'] }],
  },
  [CALLER.globex]: {
    subjectId: 'exec-globex',
    email: 'user@globex.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [{ organizationId: ORG.globex, tier: 'standard', roles: ['consultant'] }],
  },
};

const executionAuthenticator: AIAuthenticator = {
  authenticate: (authorization) =>
    Promise.resolve(
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? SUBJECTS[authorization.slice('Bearer '.length)] ?? null
        : null,
    ),
};

/**
 * A real control plane whose OpenAI adapter holds the BYOK harness's resolver.
 *
 * NO NETWORK. The adapter's `fetch` is injected and records what would have
 * been sent, which is what makes the Authorization header assertable — and it
 * is the same substitution the certified Batch 4A and 4B proofs make.
 */
function buildExecutionPlane(
  harness: ReturnType<typeof buildByokHarness>,
  env: Record<string, string> = {},
) {
  const outbound: { url: string; authorization: string }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    outbound.push({ url: String(url), authorization: headers.Authorization ?? '' });
    return Promise.resolve(
      Response.json({
        model: MODEL_ID,
        choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 40, completion_tokens: 2, total_tokens: 42 },
      }),
    );
  };

  const config = loadControlPlaneConfig(
    recordEnv({
      AI_ALLOW_REAL_REQUESTS: 'true',
      AI_PROVIDER_PREFERENCE: 'openai,mock',
      AI_FAILOVER_ENABLED: 'false',
      AI_MAX_SPEND_USD: '0.25',
      AI_DEFAULT_ORGANIZATION_ID: ORG.marq,
      AI_ALLOW_DEFAULT_ORGANIZATION: 'false',
      AI_RETRY_BASE_DELAY_MS: '0',
      ...env,
    }),
  );

  const plane = createControlPlane({
    config,
    authenticator: executionAuthenticator,
    providers: [
      {
        // THE REAL ADAPTER, holding the SAME resolver the BYOK service writes
        // through. Two resolvers would make this test pass while production
        // failed.
        adapter: createOpenAIProvider({
          env: recordEnv({}),
          credentials: harness.resolver,
          fetchImpl,
        }),
        certification: 'certified',
      },
      { adapter: createMockProvider(), certification: 'testing' },
    ],
    spendStore: createMemorySpendStore(),
    settingsSource: createMemorySettingsStore(),
    clock: createTestClock(),
    ids: createSequentialIdFactory(),
    logSink: createMemorySink(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });

  return { plane, outbound };
}

function chatRequest(token: string, organizationId: string, correlationId: string) {
  return {
    featureId: FEATURE.chat,
    body: { message: 'Reply with OK', section: 'general', sectionLabel: 'General', history: [] },
    authorization: `Bearer ${token}`,
    organizationHint: organizationId,
    correlationId,
    channel: 'team_console' as const,
  };
}

describe('Batch 4D — execution resolves the authenticated tenant’s credential', () => {
  /**
   * ELIGIBILITY IS PLATFORM-WIDE; THE KEY IS PER TENANT.
   *
   * Whether a provider may serve at all is decided by the selector, from the
   * synchronous `hasCredentials()` probe — which is platform-scoped by contract
   * and stays so: making it tenant-aware would push a storage read into the
   * selector and the spend guard, both of which run synchronously on every
   * request. So MARQ credentialing a provider is what makes it SELECTABLE, and
   * customer BYOK decides WHICH KEY the selected provider executes with.
   *
   * These planes therefore carry MARQ's own environment credential, which is
   * exactly what production carries. The claim under test is that a tenant with
   * their own key executes on THEIRS rather than on MARQ's — and that a tenant
   * without one executes on MARQ's, unchanged.
   */
  const withPlatformCredential = { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET };

  it('sends the tenant’s own key, and records the provenance', async () => {
    const harness = buildByokHarness({ env: withPlatformCredential });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    const { plane, outbound } = buildExecutionPlane(harness);

    const response = await executeAIHttpRequest(
      plane,
      chatRequest(CALLER.acme, ORG.acme, 'cor-4d-1'),
    );

    assert.equal(response.status, 200);
    assert.equal(outbound.length, 1, 'exactly one provider call was prepared');
    // THE DEFINITIVE ASSERTION. The header the adapter WOULD have sent carries
    // the tenant's own key and no other.
    assert.equal(outbound[0].authorization, `Bearer ${ACME_SECRET}`);
    // AND EMPHATICALLY NOT MARQ's, which is present in this deployment and is
    // what the same request would have used the day before this batch.
    assert.notEqual(outbound[0].authorization, `Bearer ${ENVIRONMENT_SECRET}`);

    const record = plane.recentAudit(1)[0];
    assert.equal(record.organizationId, ORG.acme);
    assert.equal(record.organizationMembershipVerified, true);
    // PROVENANCE, AS A CATEGORY. Never the credential, never its id, never its
    // fingerprint — the trail says whose vendor account paid, and nothing that
    // would help anybody find the key.
    assert.equal(record.credentialSource, 'customer_byok');
    const serialised = JSON.stringify(record);
    assert.ok(!serialised.includes(ACME_SECRET), 'the audit record carried the credential');
  });

  it('serves two tenants on two different keys in one plane', async () => {
    // ONE PLANE, ONE RESOLVER, TWO TENANTS. A resolver that cached a resolution
    // per provider — the obvious optimisation — would serve the second tenant
    // whatever the first one warmed, and nothing would fail.
    const harness = buildByokHarness({ env: withPlatformCredential });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);
    const { plane, outbound } = buildExecutionPlane(harness);

    await executeAIHttpRequest(plane, chatRequest(CALLER.acme, ORG.acme, 'cor-4d-2a'));
    await executeAIHttpRequest(plane, chatRequest(CALLER.globex, ORG.globex, 'cor-4d-2b'));

    assert.equal(outbound.length, 2);
    assert.equal(outbound[0].authorization, `Bearer ${ACME_SECRET}`);
    assert.equal(outbound[1].authorization, `Bearer ${GLOBEX_SECRET}`);
  });

  it('serves a tenant with no credential of its own on the platform arrangement', async () => {
    // THE BACKWARD-COMPATIBILITY CLAIM, END TO END. Acme has brought a key;
    // Globex has not. Globex must execute exactly as it did before this batch —
    // on MARQ's own credential — and emphatically not on Acme's.
    const harness = buildByokHarness({ env: withPlatformCredential });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    const { plane, outbound } = buildExecutionPlane(harness);

    await executeAIHttpRequest(plane, chatRequest(CALLER.globex, ORG.globex, 'cor-4d-3'));

    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].authorization, `Bearer ${ENVIRONMENT_SECRET}`);
    assert.notEqual(outbound[0].authorization, `Bearer ${ACME_SECRET}`);
    const record = plane.recentAudit(1)[0];
    assert.equal(record.organizationId, ORG.globex);
    assert.equal(record.credentialSource, 'environment');
  });

  it('refuses rather than borrowing when a tenant’s own key will not open', async () => {
    // THE FAIL-CLOSED RULE, END TO END. Acme's credential exists and cannot be
    // opened — a root key rotation. MARQ's own credential IS present and would
    // work. The request must fail rather than quietly move Acme's traffic onto
    // MARQ's vendor account.
    const harness = buildByokHarness({
      env: withPlatformCredential,
      resolverRootKey: BYOK_PREVIOUS_ROOT_KEY,
    });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    const { plane, outbound } = buildExecutionPlane(harness);

    const response = await executeAIHttpRequest(
      plane,
      chatRequest(CALLER.acme, ORG.acme, 'cor-4d-5'),
    );

    assert.equal(outbound.length, 0, 'a provider call was prepared with MARQ’s credential');
    assert.equal(response.body.success, false);
    // The caller is told the provider is not configured. They are NOT told
    // which of several server-side facts produced that — distinguishing them
    // would let a caller probe another organization's credential state one
    // request at a time.
    assert.equal(response.body.code, 'PROVIDER_AUTH_FAILED');
    assert.ok(!JSON.stringify(response.body).includes(ACME_SECRET));
    assert.ok(!JSON.stringify(response.body).includes(ENVIRONMENT_SECRET));
  });

  it('leaves platform-wide eligibility to MARQ, and the key to the tenant', async () => {
    // THE LIMITATION, PINNED RATHER THAN DISCOVERED. A provider MARQ has not
    // credentialed is not selectable, whatever a customer has stored: the
    // selector's probe is synchronous and platform-scoped by contract. So a
    // customer's key changes WHICH KEY a selected provider uses; it does not by
    // itself bring a provider into service.
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    const { plane, outbound } = buildExecutionPlane(harness);

    const response = await executeAIHttpRequest(
      plane,
      chatRequest(CALLER.acme, ORG.acme, 'cor-4d-6'),
    );

    // The synthetic provider serves it, because the billable one was never
    // eligible. No vendor call was prepared with anybody's credential.
    assert.equal(response.status, 200);
    assert.equal(outbound.length, 0);
    assert.equal(plane.recentAudit(1)[0].providerId, 'mock');
  });

  it('respects the real-request kill switch even for a tenant with its own key', async () => {
    // A CUSTOMER'S OWN CREDENTIAL IS NOT A ROUTE AROUND MARQ'S GOVERNANCE.
    // `AI_ALLOW_REAL_REQUESTS=false` refuses every billable provider, and
    // bringing your own key does not make a billable provider unbillable.
    const harness = buildByokHarness({ env: withPlatformCredential });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    const { plane, outbound } = buildExecutionPlane(harness, {
      AI_ALLOW_REAL_REQUESTS: 'false',
    });

    const response = await executeAIHttpRequest(
      plane,
      chatRequest(CALLER.acme, ORG.acme, 'cor-4d-4'),
    );

    // The synthetic provider serves it, because that is what the platform does
    // when real requests are not authorised.
    assert.equal(response.status, 200);
    assert.equal(outbound.length, 0, 'a billable provider was called with real requests disabled');
    const record = plane.recentAudit(1)[0];
    assert.equal(record.providerId, 'mock');
    assert.equal(record.credentialSource, 'none');
  });
});
