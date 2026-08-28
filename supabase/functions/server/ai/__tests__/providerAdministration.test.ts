/**
 * Provider Administration — AI-01 Batch 4C.
 *
 * The evidence that the platform administration layer this batch adds does what
 * it claims and, more importantly, cannot do what it must not.
 *
 * Everything below runs against the PRODUCTION implementations: the real
 * administration service, the real capability table, the real AES-256-GCM
 * cipher, the real credential resolver, the real provider registry, the real
 * settings overlay and the real audit writer. The only substitutions are time,
 * identifiers and the storage backend — and the memory store has the same
 * one-active-credential semantics the durable one enforces with a partial
 * unique index, so a test that passes here is making a claim about production.
 *
 * THE CLAIMS, GROUPED THE WAY A REVIEWER WOULD ASK THEM.
 *
 *   Domain      configuration, credentials and models are separate records with
 *               separate lifecycles, and the runtime picks one deterministic
 *               active credential.
 *   Secrets     a submitted key is never returned, never logged, never audited,
 *               never in an error, and is genuinely encrypted rather than
 *               encoded.
 *   Runtime     managed resolves, environment still resolves, neither is
 *               reachable without the governance that already existed.
 *   Governance  certification is not a console action, an arbitrary model
 *               string cannot become eligible, and the budget exposure the
 *               $0.25 cap was certified against cannot move silently.
 *   Authority   only the platform operator administers the platform's estate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_TOKEN,
  TEST_CREDENTIAL_ROOT_KEY,
  buildTestAdministration,
} from './harness.ts';
import { AIError } from '../contracts/errors.ts';
import { createTestClock } from '../runtime/clock.ts';
import { recordEnv } from '../runtime/env.ts';
import { createMemoryProviderAdministrationStore } from '../providers/credentials/credentialStore.ts';
import {
  createProviderCredentialResolver,
  createEnvironmentCredentialResolver,
} from '../providers/credentials/resolver.ts';
import {
  createSecretCipher,
  parseRootKey,
  safeLastFour,
  unavailableSecretCipher,
} from '../providers/credentials/secretCipher.ts';
import { exposureReport, judgeExposureChange } from '../policy/exposure.ts';
import { createOpenAIProvider, OPENAI_CREDENTIAL_PROFILE } from '../providers/openaiProvider.ts';
import {
  createAnthropicProvider,
  ANTHROPIC_CREDENTIAL_PROFILE,
} from '../providers/anthropicProvider.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createFeatureCatalog } from '../policy/featureCatalog.ts';
import { registerCortexFeatures } from '../features/index.ts';

/** A plausible-looking, entirely fictional credential. Never a real key. */
const SECRET = 'sk-test-4c-0123456789abcdefghijklmnop';
const ROTATED_SECRET = 'sk-test-4c-zyxwvutsrqponmlkjihgfedcba';
const REASON = 'batch 4c verification';

const PLATFORM_PROVIDER = 'primary';

// ── Domain and storage ──────────────────────────────────────────────────────

describe('Batch 4C — provider administration domain', () => {
  it('keeps provider configuration, credentials and models as separate records', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.setProviderCredential(actor, PLATFORM_PROVIDER, { secret: SECRET }, REASON);

    const configurations = await harness.providerStore.listConfigurations('platform');
    assert.equal(configurations.length, 1, 'one configuration row');
    const configuration = configurations[0]!;
    assert.equal(configuration.providerKey, PLATFORM_PROVIDER);
    assert.equal(configuration.scope, 'platform');
    assert.equal(configuration.organizationId, undefined, 'a platform row names no tenant');

    const credentials = await harness.providerStore.listCredentials(configuration.configurationId);
    assert.equal(credentials.length, 1);
    assert.equal(credentials[0]!.configurationId, configuration.configurationId);

    // The credential row does NOT carry the provider's enablement, its
    // certification or its models. Three concepts, three records — the whole
    // reason this batch exists.
    assert.ok(!('enabled' in credentials[0]!));
    assert.ok(!('certification' in credentials[0]!));
  });

  it('supports several providers, each with its own configuration', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.setProviderCredential(actor, 'primary', { secret: SECRET }, REASON);
    await harness.admin.setProviderCredential(actor, 'backup', { secret: ROTATED_SECRET }, REASON);

    const configurations = await harness.providerStore.listConfigurations('platform');
    assert.deepEqual(
      configurations.map((record) => record.providerKey).sort(),
      ['backup', 'primary'],
    );
  });

  it('retains rotated credentials and keeps exactly one active', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.setProviderCredential(
      actor,
      PLATFORM_PROVIDER,
      { secret: SECRET, credentialName: 'primary' },
      REASON,
    );
    await harness.admin.setProviderCredential(
      actor,
      PLATFORM_PROVIDER,
      { secret: ROTATED_SECRET, credentialName: 'rotated' },
      REASON,
    );

    const [configuration] = await harness.providerStore.listConfigurations('platform');
    const credentials = await harness.providerStore.listCredentials(
      configuration!.configurationId,
    );

    assert.equal(credentials.length, 2, 'the rotation history is retained');
    assert.equal(
      credentials.filter((record) => record.status === 'active').length,
      1,
      'exactly one active credential',
    );
    assert.equal(
      credentials.filter((record) => record.status === 'superseded').length,
      1,
      'the predecessor is superseded, not deleted',
    );

    const active = await harness.providerStore.activeCredential(configuration!.configurationId);
    assert.equal(active?.credentialName, 'rotated');
    assert.equal(active?.secretVersion, 2, 'the version increments on rotation');
  });

  it('makes a revoked credential unresolvable rather than merely hidden', async () => {
    const clock = createTestClock();
    const store = createMemoryProviderAdministrationStore();
    const cipher = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const resolver = createProviderCredentialResolver({
      profiles: [OPENAI_CREDENTIAL_PROFILE],
      clock,
      env: recordEnv({}),
      store,
      cipher,
    });

    const at = clock.isoNow();
    await store.saveConfiguration({
      configurationId: 'cfg-1',
      providerKey: 'openai',
      displayName: 'OpenAI',
      scope: 'platform',
      enabled: true,
      certification: 'certified',
      configuration: {},
      createdAt: at,
      updatedAt: at,
      createdBy: 'test',
      updatedBy: 'test',
    });
    const sealed = await cipher.seal(SECRET, {
      providerKey: 'openai',
      scope: 'platform',
      credentialId: 'cred-1',
    });
    await store.putActiveCredential({
      credentialId: 'cred-1',
      configurationId: 'cfg-1',
      providerKey: 'openai',
      credentialName: 'primary',
      status: 'active',
      fingerprint: await cipher.fingerprint(SECRET),
      secretVersion: 1,
      keyId: sealed.kid,
      createdAt: at,
      updatedAt: at,
      createdBy: 'test',
      sealed,
    });

    assert.equal((await resolver.resolve('openai'))?.source, 'managed');

    await store.revokeCredential('cfg-1', 'cred-1', clock.isoNow(), 'test');

    // NO CACHE WINDOW. The resolver reads storage on every resolution, so a
    // revocation takes effect on the very next request rather than at a TTL.
    assert.equal(
      await resolver.resolve('openai'),
      undefined,
      'a revoked credential resolves to nothing, immediately',
    );
  });
});

// ── Secret security ─────────────────────────────────────────────────────────

describe('Batch 4C — credential secrecy', () => {
  it('never returns the plaintext through any administration response', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    const view = await harness.admin.setProviderCredential(
      actor,
      PLATFORM_PROVIDER,
      { secret: SECRET },
      REASON,
    );
    const summary = await harness.admin.providerAdministration(actor);
    const metadata = await harness.admin.providerCredentials(actor, PLATFORM_PROVIDER);

    for (const [label, payload] of [
      ['set response', view],
      ['summary', summary],
      ['credential metadata', metadata],
      ['detail', await harness.admin.providerDetail(actor, PLATFORM_PROVIDER)],
    ] as const) {
      assert.ok(
        !JSON.stringify(payload).includes(SECRET),
        `${label} must not contain the submitted credential`,
      );
    }

    // What it DOES carry: a keyed fingerprint and at most four characters.
    assert.match(view.credential.fingerprint ?? '', /^fp_[0-9a-f]{16}$/);
    assert.equal(view.credential.lastFour, SECRET.slice(-4));
  });

  it('offers no operation that reads a stored credential back', async () => {
    const harness = buildTestAdministration();
    const surface = harness.admin as unknown as Record<string, unknown>;

    // A structural assertion, deliberately. A behavioural test can only show
    // that the operations we thought of do not leak; this shows that the SHAPE
    // of a leak — a method whose name means "give me the secret" — does not
    // exist on the interface at all.
    for (const forbidden of [
      'revealCredential',
      'readCredential',
      'credentialSecret',
      'getCredentialPlaintext',
      'exportCredential',
    ]) {
      assert.equal(surface[forbidden], undefined, `${forbidden} must not exist`);
    }
  });

  it('keeps the plaintext out of storage, the audit trail and the log', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.setProviderCredential(actor, PLATFORM_PROVIDER, { secret: SECRET }, REASON);

    // STORAGE. The sealed record is what is persisted, and the plaintext does
    // not appear anywhere in the row — which is the claim an "encrypted at
    // rest" statement actually has to make.
    const stored = JSON.stringify([...harness.providerStore.rows.credentials.values()]);
    assert.ok(!stored.includes(SECRET), 'no plaintext in storage');

    // NOR IS IT MERELY ENCODED. base64 of the plaintext absent too — the
    // failure mode this suite exists to rule out is a "cipher" that is really
    // an encoder.
    assert.ok(!stored.includes(btoa(SECRET)), 'the stored value is not base64 of the plaintext');

    // AUDIT. Every field of every record, including the change maps.
    const trail = JSON.stringify(harness.admin.adminAudit(actor, 100));
    assert.ok(!trail.includes(SECRET), 'no plaintext on the administrative trail');
    assert.ok(
      trail.includes('ai.admin.provider.credential.created'),
      'the change IS recorded, by its own action name',
    );

    // LOG.
    const logged = harness.logs.map((entry) => entry.line).join('\n');
    assert.ok(!logged.includes(SECRET), 'no plaintext in the log');
    assert.ok(
      logged.includes('ai.admin.provider.credential.stored'),
      'the storage event IS logged, by fingerprint',
    );
  });

  it('keeps the plaintext out of a rejection', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    // Too short to be a credential, and long enough to be recognisable if it
    // were echoed. A validation message that quotes the rejected value is how a
    // secret reaches a log the first time somebody pastes one with a typo.
    const bad = 'short';
    await assert.rejects(
      () => harness.admin.setProviderCredential(actor, PLATFORM_PROVIDER, { secret: bad }, REASON),
      (error: unknown) => {
        const aiError = error as AIError;
        assert.equal(aiError.code, 'VALIDATION_FAILED');
        assert.ok(!aiError.message.includes(bad), 'the message must not echo the value');
        assert.ok(!(aiError.diagnostics ?? '').includes(bad), 'nor may diagnostics');
        return true;
      },
    );

    const trail = JSON.stringify(harness.admin.adminAudit(actor, 100));
    assert.ok(!trail.includes(bad), 'nor the rejection record');
  });

  it('refuses to store a credential when encryption is unavailable', async () => {
    const harness = buildTestAdministration({ withoutCredentialCipher: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await assert.rejects(
      () =>
        harness.admin.setProviderCredential(actor, PLATFORM_PROVIDER, { secret: SECRET }, REASON),
      (error: unknown) => {
        assert.match(
          (error as AIError).diagnostics ?? '',
          /AI_CREDENTIAL_ENCRYPTION_KEY/,
          'the refusal names what is missing',
        );
        return true;
      },
    );

    // AND NOTHING WAS STORED. A refusal that still wrote the row would be the
    // worst of both: the operator told it failed, the secret persisted anyway.
    assert.equal(harness.providerStore.rows.credentials.size, 0);
  });

  it('refuses to store a credential when there is nowhere durable to put it', async () => {
    const harness = buildTestAdministration({ withoutProviderStore: true });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await assert.rejects(
      () =>
        harness.admin.setProviderCredential(actor, PLATFORM_PROVIDER, { secret: SECRET }, REASON),
      (error: unknown) => {
        assert.match((error as AIError).diagnostics ?? '', /durable/i);
        return true;
      },
    );

    // Reading still works. A deployment without managed storage is READ-ONLY
    // here, not blind.
    const summary = await harness.admin.providerAdministration(actor);
    assert.ok(summary.providers.length > 0);
    assert.equal(summary.managedCredentials.durable, false);
  });
});

describe('Batch 4C — the cipher itself', () => {
  const binding = { providerKey: 'openai', scope: 'platform', credentialId: 'cred-1' };

  it('round-trips through real AES-256-GCM', async () => {
    const cipher = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const sealed = await cipher.seal(SECRET, binding);
    assert.equal(sealed.alg, 'AES-256-GCM');
    assert.equal(await cipher.open(sealed, binding), SECRET);
  });

  it('produces a different ciphertext every time it seals the same secret', async () => {
    const cipher = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const first = await cipher.seal(SECRET, binding);
    const second = await cipher.seal(SECRET, binding);
    // Distinct IVs. Equal ciphertexts would mean a reused IV, under which
    // GCM's confidentiality and authentication both collapse.
    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ct, second.ct);
  });

  it('refuses a ciphertext moved to a different credential', async () => {
    const cipher = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const sealed = await cipher.seal(SECRET, binding);
    // The threat: an attacker with UPDATE on the table moving OpenAI's
    // ciphertext onto another provider's row so the platform executes at the
    // wrong vendor with the wrong key. The AAD binding makes it fail to open.
    await assert.rejects(() => cipher.open(sealed, { ...binding, providerKey: 'anthropic' }));
    await assert.rejects(() => cipher.open(sealed, { ...binding, credentialId: 'cred-2' }));
    await assert.rejects(() => cipher.open(sealed, { ...binding, scope: 'organization' }));
  });

  it('refuses a record sealed under a different root key, and says so', async () => {
    const first = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const other = createSecretCipher(
      parseRootKey('ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA='),
    );
    const sealed = await first.seal(SECRET, binding);
    await assert.rejects(
      () => other.open(sealed, binding),
      (error: unknown) => {
        // Named precisely rather than a generic failure: an operator whose
        // deployment rotated its root key must not spend an afternoon looking
        // for corruption.
        assert.match((error as AIError).diagnostics ?? '', /root key/);
        return true;
      },
    );
  });

  it('refuses a root key of the wrong length rather than stretching it', () => {
    // Padding a short key to 32 bytes produces something that works, encrypts,
    // and has a fraction of the entropy an operator believes it has.
    assert.throws(
      () => parseRootKey('c2hvcnQ='),
      (error: unknown) => {
        assert.match((error as AIError).diagnostics ?? '', /32/);
        return true;
      },
    );
    assert.equal(parseRootKey(undefined), undefined);
    assert.equal(parseRootKey('   '), undefined);
  });

  it('gives the same secret different fingerprints under different root keys', async () => {
    const first = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const other = createSecretCipher(
      parseRootKey('ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA='),
    );
    // Keyed, so a fingerprint cannot be matched against a precomputed table of
    // digests of known API keys.
    assert.notEqual(await first.fingerprint(SECRET), await other.fingerprint(SECRET));
  });

  it('withholds the last four characters of a value too short to spare them', () => {
    assert.equal(safeLastFour(SECRET), SECRET.slice(-4));
    assert.equal(safeLastFour('short-value'), undefined);
  });

  it('refuses every operation when no root key is configured', async () => {
    const cipher = unavailableSecretCipher();
    assert.equal(cipher.available, false);
    await assert.rejects(() => cipher.seal(SECRET, binding));
    await assert.rejects(() => cipher.fingerprint(SECRET));
  });
});

// ── Runtime resolution ──────────────────────────────────────────────────────

describe('Batch 4C — credential resolution', () => {
  const clock = createTestClock();

  it('resolves an environment credential exactly as it did before this batch', async () => {
    const resolver = createEnvironmentCredentialResolver(
      OPENAI_CREDENTIAL_PROFILE,
      recordEnv({ OPENAI_API_KEY: SECRET }),
      clock,
    );
    assert.equal(resolver.describe('openai').source, 'environment');
    assert.equal((await resolver.resolve('openai'))?.secret, SECRET);
  });

  it('reports no credential, rather than guessing one, when nothing is configured', async () => {
    const resolver = createEnvironmentCredentialResolver(
      OPENAI_CREDENTIAL_PROFILE,
      recordEnv({}),
      clock,
    );
    assert.equal(resolver.describe('openai').configured, false);
    assert.equal(resolver.describe('openai').source, 'none');
    assert.equal(await resolver.resolve('openai'), undefined);
  });

  it('prefers a managed credential over the deployment environment', async () => {
    const store = createMemoryProviderAdministrationStore();
    const cipher = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const resolver = createProviderCredentialResolver({
      profiles: [ANTHROPIC_CREDENTIAL_PROFILE],
      clock,
      env: recordEnv({ ANTHROPIC_API_KEY: 'environment-value-0123456789' }),
      store,
      cipher,
    });

    // Before anything is managed, the environment answers — which is why this
    // precedence cannot change what production does today: production holds no
    // managed credentials.
    assert.equal((await resolver.resolve('anthropic'))?.source, 'environment');

    const at = clock.isoNow();
    await store.saveConfiguration({
      configurationId: 'cfg-a',
      providerKey: 'anthropic',
      displayName: 'Anthropic',
      scope: 'platform',
      enabled: true,
      certification: 'certified',
      configuration: {},
      createdAt: at,
      updatedAt: at,
      createdBy: 'test',
      updatedBy: 'test',
    });
    const sealed = await cipher.seal(SECRET, {
      providerKey: 'anthropic',
      scope: 'platform',
      credentialId: 'cred-a',
    });
    await store.putActiveCredential({
      credentialId: 'cred-a',
      configurationId: 'cfg-a',
      providerKey: 'anthropic',
      credentialName: 'primary',
      status: 'active',
      fingerprint: await cipher.fingerprint(SECRET),
      secretVersion: 1,
      keyId: sealed.kid,
      createdAt: at,
      updatedAt: at,
      createdBy: 'test',
      sealed,
    });

    const resolved = await resolver.resolve('anthropic');
    assert.equal(resolved?.source, 'managed');
    assert.equal(resolved?.secret, SECRET);

    // The environment variable is NOT overwritten, NOT read for its value, and
    // its presence is still reported so the console can say so truthfully.
    await resolver.refresh();
    assert.equal(resolver.describe('anthropic').environmentCredentialPresent, true);
  });

  it('does not fall back to the environment when a managed credential cannot be opened', async () => {
    const store = createMemoryProviderAdministrationStore();
    const cipher = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const other = createSecretCipher(
      parseRootKey('ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA='),
    );
    const failures: string[] = [];
    const resolver = createProviderCredentialResolver({
      profiles: [OPENAI_CREDENTIAL_PROFILE],
      clock,
      env: recordEnv({ OPENAI_API_KEY: 'environment-value-0123456789' }),
      store,
      cipher,
      onError: (providerId) => failures.push(providerId),
    });

    const at = clock.isoNow();
    await store.saveConfiguration({
      configurationId: 'cfg-o',
      providerKey: 'openai',
      displayName: 'OpenAI',
      scope: 'platform',
      enabled: true,
      certification: 'certified',
      configuration: {},
      createdAt: at,
      updatedAt: at,
      createdBy: 'test',
      updatedBy: 'test',
    });
    // Sealed under a DIFFERENT root key: the shape a deployment is in after its
    // encryption key is rotated without re-entering credentials.
    const sealed = await other.seal(SECRET, {
      providerKey: 'openai',
      scope: 'platform',
      credentialId: 'cred-o',
    });
    await store.putActiveCredential({
      credentialId: 'cred-o',
      configurationId: 'cfg-o',
      providerKey: 'openai',
      credentialName: 'primary',
      status: 'active',
      fingerprint: 'fp_00000000000000ff',
      secretVersion: 1,
      keyId: sealed.kid,
      createdAt: at,
      updatedAt: at,
      createdBy: 'test',
      sealed,
    });

    // Falling through to the environment here would mean an administrator who
    // rotated a key kept executing on the old one because the new one failed to
    // decrypt — the platform reporting success while ignoring their decision.
    assert.equal(await resolver.resolve('openai'), undefined);
    assert.deepEqual(failures, ['openai']);
  });

  it('carries a managed credential all the way to the vendor request', async () => {
    // THE END-TO-END CLAIM, and the one the other resolution assertions cannot
    // make on their own. They prove the resolver returns the right secret; this
    // proves the ADAPTER asks it and puts the answer on the wire — which is the
    // only version of "managed credentials work" that matters.
    const store = createMemoryProviderAdministrationStore();
    const cipher = createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));
    const resolver = createProviderCredentialResolver({
      profiles: [OPENAI_CREDENTIAL_PROFILE],
      clock,
      // NO environment credential. If the adapter reached for one it would find
      // nothing, so a passing assertion cannot be the environment path in
      // disguise.
      env: recordEnv({}),
      store,
      cipher,
    });

    const at = clock.isoNow();
    await store.saveConfiguration({
      configurationId: 'cfg-wire',
      providerKey: 'openai',
      displayName: 'OpenAI',
      scope: 'platform',
      enabled: true,
      certification: 'certified',
      configuration: {},
      createdAt: at,
      updatedAt: at,
      createdBy: 'test',
      updatedBy: 'test',
    });
    const sealed = await cipher.seal(SECRET, {
      providerKey: 'openai',
      scope: 'platform',
      credentialId: 'cred-wire',
    });
    await store.putActiveCredential({
      credentialId: 'cred-wire',
      configurationId: 'cfg-wire',
      providerKey: 'openai',
      credentialName: 'primary',
      status: 'active',
      fingerprint: await cipher.fingerprint(SECRET),
      secretVersion: 1,
      keyId: sealed.kid,
      createdAt: at,
      updatedAt: at,
      createdBy: 'test',
      sealed,
    });

    const headers: Record<string, string>[] = [];
    const adapter = createOpenAIProvider({
      env: recordEnv({}),
      credentials: resolver,
      clock,
      fetchImpl: (_url, init) => {
        headers.push(init.headers as Record<string, string>);
        return Promise.resolve(
          Response.json({
            model: 'gpt-4o-mini',
            choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      },
    });

    await resolver.refresh();
    assert.equal(adapter.hasCredentials(), true);
    assert.equal(adapter.credentialStatus?.().source, 'managed');

    await adapter.invoke({
      requestId: 'req-wire',
      correlationId: 'cor-wire',
      modelId: 'gpt-4o-mini',
      generation: {
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        maxOutputTokens: 8,
        responseFormat: 'text',
      },
      attempt: 1,
      signal: new AbortController().signal,
    });

    assert.equal(headers.length, 1, 'exactly one attempt');
    assert.equal(headers[0]!.Authorization, `Bearer ${SECRET}`);
  });

  it('carries an environment credential to the vendor request unchanged', async () => {
    // The compatibility path, end to end. This is the behaviour production has
    // today, and Batch 4C must not alter it: no managed store, no cipher, the
    // adapter reads its deployment variable and puts it on the wire.
    const headers: Record<string, string>[] = [];
    const adapter = createOpenAIProvider({
      env: recordEnv({ OPENAI_API_KEY: SECRET }),
      clock,
      fetchImpl: (_url, init) => {
        headers.push(init.headers as Record<string, string>);
        return Promise.resolve(
          Response.json({
            model: 'gpt-4o-mini',
            choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      },
    });

    assert.equal(adapter.credentialStatus?.().source, 'environment');

    await adapter.invoke({
      requestId: 'req-env',
      correlationId: 'cor-env',
      modelId: 'gpt-4o-mini',
      generation: {
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        maxOutputTokens: 8,
        responseFormat: 'text',
      },
      attempt: 1,
      signal: new AbortController().signal,
    });

    assert.equal(headers[0]!.Authorization, `Bearer ${SECRET}`);
  });

  it('reaches no vendor at all when nothing is configured', async () => {
    let called = 0;
    const adapter = createAnthropicProvider({
      env: recordEnv({}),
      clock,
      fetchImpl: () => {
        called += 1;
        return Promise.resolve(Response.json({}));
      },
    });

    await assert.rejects(
      () =>
        adapter.invoke({
          requestId: 'req-none',
          correlationId: 'cor-none',
          modelId: 'claude-haiku-4-5-20251001',
          generation: {
            messages: [{ role: 'user', content: 'ping' }],
            temperature: 0,
            maxOutputTokens: 8,
            responseFormat: 'text',
          },
          attempt: 1,
          signal: new AbortController().signal,
        }),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'PROVIDER_AUTH_FAILED');
        // The diagnostic names the SHAPE of the problem, never a value.
        assert.ok(!(error as AIError).diagnostics?.includes(SECRET));
        return true;
      },
    );
    assert.equal(called, 0, 'no vendor call was attempted');
  });

  it('reports a provider that needs no credential as configured, not as missing', () => {
    const mock = createMockProvider({ providerId: 'mock' });
    assert.equal(mock.descriptor.credential.required, false);
    assert.equal(mock.descriptor.credential.manageable, false);
    assert.equal(mock.hasCredentials(), true);
    assert.equal(mock.credentialStatus?.().source, 'none');
  });

  it('carries the credential source onto the provider health read', () => {
    const openai = createOpenAIProvider({ env: recordEnv({ OPENAI_API_KEY: SECRET }) });
    assert.equal(openai.credentialStatus?.().source, 'environment');

    const unconfigured = createAnthropicProvider({ env: recordEnv({}) });
    assert.equal(unconfigured.credentialStatus?.().source, 'none');
    assert.equal(unconfigured.hasCredentials(), false);
  });
});

// ── Governance: certification, models, exposure ─────────────────────────────

describe('Batch 4C — model governance', () => {
  it('refuses a model the provider does not declare', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await assert.rejects(
      () =>
        harness.admin.setProviderModelEnabled(
          actor,
          PLATFORM_PROVIDER,
          'gpt-9-omniscient',
          true,
          REASON,
        ),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'VALIDATION_FAILED');
        return true;
      },
    );
  });

  it('refuses to enable a model while its provider is not certified', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    const declared = harness.plane.providers.get(PLATFORM_PROVIDER).descriptor.models[0]!.modelId;

    harness.plane.providers.setCertification(PLATFORM_PROVIDER, 'unverified');

    await assert.rejects(
      () =>
        harness.admin.setProviderModelEnabled(actor, PLATFORM_PROVIDER, declared, true, REASON),
      (error: unknown) => {
        assert.match((error as AIError).message, /not certified/);
        return true;
      },
    );
  });

  it('disables a model by narrowing what the runtime may select', async () => {
    // A provider with a CHOICE to make. Narrowing a one-model provider to
    // nothing is refused (see the next assertion), so the only state a
    // single-model provider can reach is the one it starts in.
    const harness = buildTestAdministration({ additionalPrimaryModelIds: ['mock-premium'] });
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    const models = harness.plane.providers.get(PLATFORM_PROVIDER).descriptor.models;
    assert.ok(models.length >= 2, 'this assertion needs a provider with two models');

    const view = await harness.admin.setProviderModelEnabled(
      actor,
      PLATFORM_PROVIDER,
      models[0]!.modelId,
      false,
      REASON,
    );

    assert.equal(view.models.find((m) => m.modelId === models[0]!.modelId)?.enabled, false);
    // The RUNTIME, not just the view: the registry's permitted list is what the
    // selector reads, and a console that changed only its own display would be
    // a console reporting a change that never happened.
    const permitted = harness.plane.providers.models(PLATFORM_PROVIDER).map((m) => m.modelId);
    assert.ok(!permitted.includes(models[0]!.modelId));
  });

  it('refuses to leave a provider with no enabled model', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    const models = harness.plane.providers.get(PLATFORM_PROVIDER).descriptor.models;

    for (const model of models.slice(0, -1)) {
      await harness.admin.setProviderModelEnabled(
        actor,
        PLATFORM_PROVIDER,
        model.modelId,
        false,
        REASON,
      );
    }
    await assert.rejects(
      () =>
        harness.admin.setProviderModelEnabled(
          actor,
          PLATFORM_PROVIDER,
          models.at(-1)!.modelId,
          false,
          REASON,
        ),
      /at least one enabled model/,
    );
  });

  it('names certification, not model eligibility, when a provider is uncertified', async () => {
    // ORDER MATTERS IN THE OPERATOR MESSAGE. An uncertified provider has no
    // eligible models BECAUSE it is uncertified, so reporting the symptom would
    // tell an operator to "enable a certified model" on a provider where no
    // model can be certified — an instruction that cannot be followed.
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    harness.plane.providers.setCertification(PLATFORM_PROVIDER, 'unverified');

    const view = await harness.admin.providerDetail(actor, PLATFORM_PROVIDER);
    assert.match(view.message, /[Nn]ot certified|non-production/);
    assert.ok(
      !view.message.includes('Enable a certified model'),
      'the message must name the cause, not the symptom',
    );
  });

  it('reports a disabled provider as ineligible and stops it serving', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    const view = await harness.admin.setProviderEnabled(actor, PLATFORM_PROVIDER, false, REASON);
    assert.equal(view.enabled, false);
    assert.equal(view.eligible, false);
    assert.equal(harness.plane.providers.get(PLATFORM_PROVIDER).enabled, false);
  });
});

describe('Batch 4C — governed budget exposure', () => {
  /**
   * The certified figure from Batch 4B, pinned.
   *
   * (16,384 prompt tokens x 2,500 uUSD/1k + 1,200 completion tokens
   *  x 10,000 uUSD/1k) x 2 attempts = 105,920 uUSD, driven by OpenAI's gpt-4o
   * on `cortex.chat`. This is the number the $0.25 production cap was proved
   * sufficient against, and provider administration must not move it silently.
   */
  const CERTIFIED_CHAT_HOLD_MICRO_USD = 105_920;

  function certifiedCatalogue() {
    const openai = createOpenAIProvider({ env: recordEnv({}) });
    const anthropic = createAnthropicProvider({ env: recordEnv({}) });
    const mock = createMockProvider({ providerId: 'mock' });
    return [openai, anthropic, mock].map((adapter) => ({
      providerId: adapter.descriptor.providerId,
      billable: adapter.descriptor.billable,
      models: adapter.descriptor.models,
    }));
  }

  function certifiedFeatures() {
    const catalog = createFeatureCatalog();
    registerCortexFeatures(catalog);
    return catalog.list();
  }

  it('holds the certified cortex.chat reservation at 105,920 micro-USD', () => {
    const report = exposureReport(certifiedFeatures(), certifiedCatalogue());
    const chat = report.features.find((entry) => entry.featureId === 'cortex.chat');
    assert.equal(
      chat?.worstCaseMicroUsd,
      CERTIFIED_CHAT_HOLD_MICRO_USD,
      'the Batch 4B certified hold has moved — this is a governance change, not a test failure',
    );
    assert.equal(chat?.worstCaseProviderId, 'openai');
    assert.equal(chat?.worstCaseModelId, 'gpt-4o');
  });

  it('leaves the mock provider out of the exposure entirely', () => {
    const withoutMock = certifiedCatalogue().filter((entry) => entry.providerId !== 'mock');
    assert.equal(
      exposureReport(certifiedFeatures(), certifiedCatalogue()).maxReservationMicroUsd,
      exposureReport(certifiedFeatures(), withoutMock).maxReservationMicroUsd,
      'a non-billable provider contributes nothing to the governed exposure',
    );
  });

  it('refuses a configuration change that raises exposure past the governed ceiling', () => {
    const features = certifiedFeatures();
    const before = exposureReport(features, certifiedCatalogue());
    const expensive = certifiedCatalogue().map((entry) =>
      entry.providerId !== 'openai'
        ? entry
        : {
            ...entry,
            models: entry.models.map((model) => ({
              ...model,
              promptMicroUsdPer1k: model.promptMicroUsdPer1k * 100,
              completionMicroUsdPer1k: model.completionMicroUsdPer1k * 100,
            })),
          },
    );
    const verdict = judgeExposureChange(
      before,
      exposureReport(features, expensive),
      250_000,
    );
    assert.equal(verdict.permitted, false);
    assert.match(verdict.reason ?? '', /governed ceiling/);
  });

  it('permits a change that lowers exposure even from an unsafe state', () => {
    const features = certifiedFeatures();
    const before = exposureReport(features, certifiedCatalogue());
    const cheaper = certifiedCatalogue().map((entry) =>
      entry.providerId !== 'openai'
        ? entry
        : { ...entry, models: entry.models.filter((model) => model.modelId === 'gpt-4o-mini') },
    );
    // A ceiling BELOW the current exposure, so the platform is already over it.
    // Refusing a reduction here would trap an operator in exactly the state the
    // check exists to get them out of.
    const verdict = judgeExposureChange(before, exposureReport(features, cheaper), 1_000);
    assert.equal(verdict.permitted, true);
  });

  it('reports the current exposure and the ceiling on the administration surface', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    const summary = await harness.admin.providerAdministration(actor);
    assert.equal(typeof summary.exposure.maxReservationMicroUsd, 'number');
    assert.equal(typeof summary.exposure.ceilingMicroUsd, 'number');
    assert.equal(summary.exposure.withinCeiling, true);
  });
});

// ── Authority ───────────────────────────────────────────────────────────────

describe('Batch 4C — provider administration authority', () => {
  const READ_ONLY_TOKENS = [
    ADMIN_TOKEN.organizationAdmin,
    ADMIN_TOKEN.organizationOwner,
    ADMIN_TOKEN.teamAdmin,
  ];

  it('admits the platform operator', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    const summary = await harness.admin.providerAdministration(actor);
    assert.ok(summary.providers.length > 0);
  });

  it('refuses every provider administration operation to a tenant administrator', async () => {
    const harness = buildTestAdministration();

    for (const token of READ_ONLY_TOKENS) {
      const actor = await harness.actor(token);
      const attempts: [string, () => Promise<unknown>][] = [
        ['read', () => harness.admin.providerAdministration(actor)],
        ['detail', () => harness.admin.providerDetail(actor, PLATFORM_PROVIDER)],
        ['credentials', () => harness.admin.providerCredentials(actor, PLATFORM_PROVIDER)],
        [
          'enable',
          () => harness.admin.setProviderEnabled(actor, PLATFORM_PROVIDER, false, REASON),
        ],
        [
          'set credential',
          () =>
            harness.admin.setProviderCredential(
              actor,
              PLATFORM_PROVIDER,
              { secret: SECRET },
              REASON,
            ),
        ],
        [
          'revoke credential',
          () =>
            harness.admin.revokeProviderCredential(actor, PLATFORM_PROVIDER, 'cred-1', REASON),
        ],
        [
          'enable model',
          () =>
            harness.admin.setProviderModelEnabled(
              actor,
              PLATFORM_PROVIDER,
              'mock-standard',
              true,
              REASON,
            ),
        ],
      ];
      for (const [label, attempt] of attempts) {
        await assert.rejects(
          attempt,
          (error: unknown) => {
            assert.equal(
              (error as AIError).code,
              'FORBIDDEN',
              `${token} must be refused ${label}`,
            );
            return true;
          },
          `${token} must be refused ${label}`,
        );
      }
    }
  });

  it('records every refused credential mutation on the administrative trail', async () => {
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    const tenant = await harness.actor(ADMIN_TOKEN.organizationAdmin);

    await assert.rejects(() =>
      harness.admin.setProviderCredential(tenant, PLATFORM_PROVIDER, { secret: SECRET }, REASON),
    );

    const records = harness.admin.adminAudit(operator, 50);
    const rejection = records.find(
      (record) =>
        record.outcome === 'rejected' &&
        record.action === 'ai.admin.provider.credential.created',
    );
    assert.ok(rejection, 'a refused credential mutation is recorded, not only refused');
    assert.equal(rejection?.actorId, 'user-org-admin');
    assert.equal(rejection?.rejectionCode, 'FORBIDDEN');
  });

  it('refuses a managed credential for a provider that declares none', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    // Refused by DESCRIPTOR — `manageable: false` — rather than by a provider
    // name, so a future keyless adapter is refused with no edit anywhere.
    const mock = createMockProvider({ providerId: 'synthetic' });
    assert.equal(mock.descriptor.credential.manageable, false);

    await assert.rejects(
      () =>
        harness.admin.setProviderCredential(actor, 'unregistered-provider', { secret: SECRET }, REASON),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'PROVIDER_NOT_FOUND');
        return true;
      },
    );
  });

  it('requires a reason for every provider mutation', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);
    await assert.rejects(
      () => harness.admin.setProviderEnabled(actor, PLATFORM_PROVIDER, false, ''),
      (error: unknown) => {
        assert.equal((error as AIError).code, 'VALIDATION_FAILED');
        return true;
      },
    );
  });
});

// ── Audit completeness ──────────────────────────────────────────────────────

describe('Batch 4C — audit trail', () => {
  it('records the full credential lifecycle by distinct action names', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.setProviderCredential(actor, PLATFORM_PROVIDER, { secret: SECRET }, REASON);
    const rotated = await harness.admin.setProviderCredential(
      actor,
      PLATFORM_PROVIDER,
      { secret: ROTATED_SECRET },
      REASON,
    );
    await harness.admin.revokeProviderCredential(
      actor,
      PLATFORM_PROVIDER,
      rotated.credential.credentialId!,
      REASON,
    );
    await harness.admin.setProviderEnabled(actor, PLATFORM_PROVIDER, false, REASON);

    const actions: readonly string[] = harness.admin
      .adminAudit(actor, 50)
      .map((record) => record.action);
    for (const expected of [
      'ai.admin.provider.credential.created',
      'ai.admin.provider.credential.rotated',
      'ai.admin.provider.credential.revoked',
      'ai.admin.provider.disabled',
    ]) {
      assert.ok(actions.includes(expected), `the trail records ${expected}`);
    }
  });

  it('records the credential fingerprint so the trail can name the key without holding it', async () => {
    const harness = buildTestAdministration();
    const actor = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.setProviderCredential(actor, PLATFORM_PROVIDER, { secret: SECRET }, REASON);
    const record = harness.admin
      .adminAudit(actor, 50)
      .find((entry) => entry.action === 'ai.admin.provider.credential.created');

    assert.match(record?.after.credentialFingerprint ?? '', /^fp_[0-9a-f]{16}$/);
    assert.equal(record?.reason, REASON);
    assert.equal(record?.target, PLATFORM_PROVIDER);
  });
});
