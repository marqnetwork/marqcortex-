/**
 * Customer BYOK — AI-01 Batch 4D.
 *
 * The evidence that a customer organization can bring its own AI provider
 * credential, and that doing so cannot reach anything it must not.
 *
 * Everything below runs against the PRODUCTION implementations: the real BYOK
 * service, the real capability table, the real `resolveOrganization`, the real
 * AES-256-GCM cipher, the real credential resolver with its real precedence,
 * the real audited-mutation runner and the real append-only trail. The only
 * substitutions are time, identifiers, the storage backend and the identity
 * provider's answer about who a token belongs to.
 *
 * THE CLAIMS, GROUPED THE WAY A REVIEWER WOULD ASK THEM.
 *
 *   Lifecycle    a customer administrator can configure, rotate and revoke
 *                their own credential, and each is atomic and audited.
 *   Secrets      a submitted key is encrypted before persistence, never
 *                returned, never logged, never audited, never in an error.
 *   Isolation    customer A cannot read, replace or revoke customer B's
 *                credential — and cannot reach MARQ's.
 *   Authority    an ordinary member holds nothing; the platform operator holds
 *                nothing HERE; a stale membership row grants nothing.
 *   Governance   a customer cannot bring a key for a provider MARQ has not
 *                certified, and revocation is never blocked by platform state.
 *
 * Hostile cross-tenant scenarios live in `byokAdversarial.test.ts`; credential
 * RESOLUTION — which key the runtime actually executes with — lives in
 * `byokResolution.test.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACME_ROTATED,
  ACME_SECRET,
  BYOK_PROVIDER,
  BYOK_REASON,
  BYOK_TOKEN,
  GLOBEX_SECRET,
  ORG,
  buildByokHarness,
  cachedMembershipAuthenticator,
  configureFor,
  everythingWritten,
} from './byokFixtures.ts';
import { AIError } from '../contracts/errors.ts';

async function refuses(
  work: () => Promise<unknown>,
  code: string,
  message: string,
): Promise<AIError> {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof AIError, `${message}: expected an AIError, got ${String(error)}`);
    assert.equal(error.code, code, message);
    return error;
  }
  assert.fail(`${message}: the operation was permitted`);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

describe('Batch 4D — a customer administrator manages their own credential', () => {
  it('reports every manageable provider as unconfigured before anything is stored', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    const summary = await harness.byok.status(actor);

    assert.equal(summary.organizationId, ORG.acme, 'the answer names the resolved tenant');
    // The synthetic provider is ABSENT rather than listed as permanently
    // unavailable: a customer console that nags about something working exactly
    // as designed is a console people learn to ignore.
    assert.deepEqual(
      summary.providers.map((provider) => provider.providerId).sort(),
      ['anthropic', 'openai'],
    );

    const openai = summary.providers.find((p) => p.providerId === BYOK_PROVIDER);
    assert.ok(openai);
    assert.equal(openai.credential.status, 'not_configured');
    assert.equal(openai.credential.configured, false);
    assert.equal(openai.available, true);
    // The default policy is the one that changes nothing: MARQ's arrangement
    // stands behind a tenant that has configured nothing.
    assert.equal(openai.fallback, 'platform');
    assert.equal(openai.effectiveSource, 'platform');
  });

  it('stores a credential and reports it as this organization’s own', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    const view = await harness.byok.configureCredential(
      actor,
      BYOK_PROVIDER,
      { secret: ACME_SECRET, credentialName: 'acme primary' },
      BYOK_REASON,
    );

    assert.equal(view.credential.status, 'active');
    assert.equal(view.credential.configured, true);
    assert.equal(view.credential.credentialName, 'acme primary');
    assert.equal(view.credential.secretVersion, 1);
    assert.equal(view.effectiveSource, 'customer_byok');
    assert.match(view.message, /your organization's own credential/i);
    // A keyed digest and at most four characters. Neither narrows a search for
    // the secret meaningfully, and both are what make "is this the key I
    // stored?" answerable without the platform holding one.
    assert.match(view.credential.fingerprint ?? '', /^fp_[0-9a-f]{16}$/);
    assert.equal(view.credential.lastFour, ACME_SECRET.slice(-4));
  });

  it('writes the configuration at organization scope, owned by the resolved tenant', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    const rows = [...harness.store.rows.configurations.values()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scope, 'organization');
    assert.equal(rows[0].organizationId, ORG.acme);
    assert.equal(rows[0].providerKey, BYOK_PROVIDER);
    // Certification is COPIED from MARQ's registration. There is no request
    // field that reaches it, so a customer cannot certify a provider by
    // configuring a key for it.
    assert.equal(rows[0].certification, 'certified');
  });

  it('rotates atomically — one active credential, and the history survives', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON);

    const rotated = await harness.byok.configureCredential(
      actor,
      BYOK_PROVIDER,
      { secret: ACME_ROTATED },
      'rotating after a suspected exposure',
    );

    assert.equal(rotated.credential.status, 'active');
    assert.equal(rotated.credential.secretVersion, 2);
    assert.ok(rotated.credential.rotatedAt, 'the rotation is timestamped');

    const history = await harness.byok.credentials(actor, BYOK_PROVIDER);
    assert.equal(history.length, 2, 'the previous credential is retained as history');
    assert.deepEqual(
      history.map((record) => record.status).sort(),
      ['active', 'superseded'],
      'exactly one active credential, and the predecessor is superseded rather than deleted',
    );

    // THE ATOMICITY CLAIM, ASKED OF STORAGE. At no point may a configuration
    // hold zero active credentials or two: zero silently moves the tenant onto
    // MARQ's key while the console reports a successful rotation, and two makes
    // the runtime guess.
    const active = [...harness.store.rows.credentials.values()].filter(
      (record) => record.status === 'active',
    );
    assert.equal(active.length, 1);
    assert.notEqual(active[0].fingerprint, history.find((r) => r.status === 'superseded')?.fingerprint);
  });

  it('revokes, and the tenant returns to the platform arrangement', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const configured = await harness.byok.configureCredential(
      actor,
      BYOK_PROVIDER,
      { secret: ACME_SECRET },
      BYOK_REASON,
    );

    const view = await harness.byok.revokeCredential(
      actor,
      BYOK_PROVIDER,
      configured.credential.credentialId!,
      'the key was exposed in a support ticket',
    );

    assert.equal(view.credential.status, 'revoked');
    assert.equal(view.credential.configured, false);
    assert.ok(view.credential.revokedAt);
    // The tenant's own policy is `platform`, so their requests continue on
    // MARQ's arrangement. The message SAYS SO rather than implying containment
    // it does not have.
    assert.equal(view.effectiveSource, 'platform');
    assert.match(view.message, /revoked/i);
  });

  it('is idempotent on a second revoke', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const configured = await harness.byok.configureCredential(
      actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON,
    );
    const credentialId = configured.credential.credentialId!;

    await harness.byok.revokeCredential(actor, BYOK_PROVIDER, credentialId, BYOK_REASON);
    // An administrator clicking twice during an incident should get the state
    // they asked for, not a failure that makes them wonder whether the first
    // one worked.
    const second = await harness.byok.revokeCredential(
      actor, BYOK_PROVIDER, credentialId, BYOK_REASON,
    );
    assert.equal(second.credential.status, 'revoked');
  });

  it('lets a customer choose to use their own credential only', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    const view = await harness.byok.setFallbackPolicy(
      actor,
      BYOK_PROVIDER,
      'tenant_only',
      'our policy is that AI traffic reaches our vendor account or none',
    );

    assert.equal(view.fallback, 'tenant_only');
    // With no credential and no fallback, nothing would authenticate a request.
    // The console says so plainly rather than implying service continues.
    assert.equal(view.effectiveSource, 'none');
    assert.match(view.message, /your own credential only/i);
  });

  it('refuses a reason nobody wrote, on every mutation', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    await refuses(
      () => harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, ''),
      'VALIDATION_FAILED',
      'a credential change with no reason',
    );
    await refuses(
      () => harness.byok.setFallbackPolicy(actor, BYOK_PROVIDER, 'tenant_only', undefined),
      'VALIDATION_FAILED',
      'a policy change with no reason',
    );
    // AND THE ATTEMPT IS RECORDED. "Somebody tried and gave no reason" is the
    // half of an administrative trail that catches an attack.
    const rejected = harness.trail().filter((record) => record.outcome === 'rejected');
    assert.equal(rejected.length, 2);
    for (const record of rejected) assert.equal(record.rejectionCode, 'VALIDATION_FAILED');
  });
});

// ── Secrets ─────────────────────────────────────────────────────────────────

describe('Batch 4D — the submitted secret', () => {
  it('is encrypted before persistence: no plaintext reaches storage', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    // EVERY ROW, SERIALISED. Not a field-by-field check: a field-by-field check
    // asserts the fields somebody thought of, and the claim is about the whole
    // record.
    const persisted = JSON.stringify([
      ...harness.store.rows.configurations.values(),
      ...harness.store.rows.credentials.values(),
      ...harness.store.rows.models.values(),
    ]);
    assert.ok(
      !persisted.includes(ACME_SECRET),
      'the plaintext credential appears in persisted storage',
    );
    // And not a prefix of it either — an encoding that happened to preserve a
    // recognisable head would pass an exact-match check.
    assert.ok(!persisted.includes(ACME_SECRET.slice(0, 16)));

    // GENUINELY ENCRYPTED, not encoded. A base64 round trip would satisfy "the
    // plaintext is absent" and satisfy nothing else.
    const record = [...harness.store.rows.credentials.values()][0];
    assert.equal(record.sealed.alg, 'AES-256-GCM');
    assert.equal(record.sealed.v, 1);
    assert.match(record.sealed.kid, /^k_[0-9a-f]+$/);
    assert.ok(record.sealed.iv.length > 0 && record.sealed.ct.length > 0);
    assert.ok(
      !Buffer.from(record.sealed.ct, 'base64').toString('utf8').includes(ACME_SECRET),
      'the ciphertext decodes to the plaintext, so it is an encoding rather than encryption',
    );
  });

  it('uses a fresh initialisation vector per record', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    // THE SAME SECRET, TWICE. GCM's security collapses under IV reuse, and
    // sealing identical plaintext is the case where a derived IV would show.
    await harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON);
    await harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON);

    const records = [...harness.store.rows.credentials.values()];
    assert.equal(records.length, 2);
    assert.notEqual(records[0].sealed.iv, records[1].sealed.iv, 'the IV was reused');
    assert.notEqual(records[0].sealed.ct, records[1].sealed.ct);
  });

  it('never comes back through any operation on the surface', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const configured = await harness.byok.configureCredential(
      actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON,
    );

    // EVERY read this surface offers, serialised whole.
    const responses = JSON.stringify({
      configure: configured,
      status: await harness.byok.status(actor),
      credentials: await harness.byok.credentials(actor, BYOK_PROVIDER),
    });
    assert.ok(!responses.includes(ACME_SECRET), 'a response carried the plaintext credential');
    // And no ciphertext, no IV and no root key identity either. The customer has
    // no operation for any of them, and a field a customer cannot use is a field
    // that can only leak.
    const sealed = [...harness.store.rows.credentials.values()][0].sealed;
    assert.ok(!responses.includes(sealed.ct), 'a response carried the ciphertext');
    assert.ok(!responses.includes(sealed.iv), 'a response carried the initialisation vector');
    assert.ok(!responses.includes(sealed.kid), 'a response carried the root key identity');
  });

  it('never reaches a log line or an audit record', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON);
    await harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_ROTATED }, BYOK_REASON);

    const written = everythingWritten(harness);
    assert.ok(!written.includes(ACME_SECRET), 'the plaintext credential was logged or audited');
    assert.ok(!written.includes(ACME_ROTATED));
    assert.ok(!written.includes(ACME_SECRET.slice(0, 16)));

    // WHAT IS RECORDED INSTEAD. The fingerprint identifies a key without
    // revealing it, and is what makes "which key was in force when this
    // happened?" answerable from the trail without the trail ever holding one.
    const configured = harness
      .trail()
      .find((record) => record.action === 'ai.byok.credential.configured');
    assert.ok(configured, 'the configuration was recorded');
    assert.match(configured.after.credentialFingerprint ?? '', /^fp_[0-9a-f]+$/);
    assert.deepEqual(configured.organizationScope, [ORG.acme]);
    assert.equal(configured.actorRole, 'customer_byok_admin');
    assert.equal(configured.outcome, 'applied');
  });

  it('never appears in the error raised for a value the platform rejects', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    // A REALISTIC MISTAKE: a live key pasted with a stray character, so it
    // exceeds the bound. The refusal must name the BOUNDS and never the value —
    // an error that echoes its input is an error that logs a secret.
    const tooLong = `${ACME_SECRET}${'x'.repeat(9_000)}`;

    const error = await refuses(
      () => harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: tooLong }, BYOK_REASON),
      'VALIDATION_FAILED',
      'an over-long credential',
    );
    assert.ok(!error.message.includes(ACME_SECRET));
    assert.ok(!(error.diagnostics ?? '').includes(ACME_SECRET));
    assert.match(error.message, /between 8 and 8192 characters/);

    // And the REJECTION record carries nothing either.
    assert.ok(!everythingWritten(harness).includes(ACME_SECRET));
  });

  it('is refused outright when the deployment cannot encrypt it', async () => {
    // FAIL CLOSED. No base64, no plaintext column, no "store it now and encrypt
    // later". A credential that cannot be encrypted is not stored.
    const harness = buildByokHarness({ withoutCipher: true });
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    // INTERNAL_ERROR, not VALIDATION_FAILED. A deployment that cannot encrypt
    // is nobody's input, and telling an administrator their perfectly good
    // credential was rejected would send them to re-check the key.
    const error = await refuses(
      () => harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON),
      'INTERNAL_ERROR',
      'a credential submitted to a deployment with no root key',
    );
    assert.match(error.message, /cannot be stored in this deployment/i);
    assert.equal(harness.store.rows.credentials.size, 0, 'nothing was stored');

    const summary = await harness.byok.status(actor);
    assert.equal(summary.credentialStorage.available, false);
    // The blocker names a DEPLOYMENT state and never a variable name, a key
    // identity or anything else about MARQ's environment.
    assert.match(summary.credentialStorage.blocker ?? '', /secure credential encryption/i);
    assert.ok(!(summary.credentialStorage.blocker ?? '').includes('AI_CREDENTIAL_ENCRYPTION_KEY'));
  });
});

// ── Isolation ───────────────────────────────────────────────────────────────

describe('Batch 4D — one customer cannot reach another', () => {
  it('shows each administrator only their own organization’s state', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);

    const acme = await harness.byok.status(await harness.actor(BYOK_TOKEN.acmeAdmin));
    const globex = await harness.byok.status(await harness.actor(BYOK_TOKEN.globexAdmin));

    assert.equal(acme.organizationId, ORG.acme);
    assert.equal(globex.organizationId, ORG.globex);

    const acmeFingerprint = acme.providers.find((p) => p.providerId === BYOK_PROVIDER)!
      .credential.fingerprint;
    const globexFingerprint = globex.providers.find((p) => p.providerId === BYOK_PROVIDER)!
      .credential.fingerprint;
    assert.ok(acmeFingerprint && globexFingerprint);
    assert.notEqual(acmeFingerprint, globexFingerprint, 'the two tenants share a credential');

    // Neither answer contains any trace of the other tenant. Serialised whole,
    // because the claim is about the response and not about the fields somebody
    // thought to check.
    assert.ok(!JSON.stringify(acme).includes(ORG.globex));
    assert.ok(!JSON.stringify(globex).includes(ORG.acme));
    assert.ok(!JSON.stringify(acme).includes(globexFingerprint));
    assert.ok(!JSON.stringify(globex).includes(acmeFingerprint));
  });

  it('shows each administrator only their own credential history', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);

    const acmeHistory = await harness.byok.credentials(
      await harness.actor(BYOK_TOKEN.acmeAdmin), BYOK_PROVIDER,
    );
    const globexHistory = await harness.byok.credentials(
      await harness.actor(BYOK_TOKEN.globexAdmin), BYOK_PROVIDER,
    );

    assert.equal(acmeHistory.length, 1);
    assert.equal(globexHistory.length, 1);
    assert.notEqual(acmeHistory[0].credentialId, globexHistory[0].credentialId);
    assert.notEqual(acmeHistory[0].fingerprint, globexHistory[0].fingerprint);
    // AND NEITHER ENTRY CARRIES MARQ'S ROOT KEY IDENTITY OR AN INTERNAL
    // CONFIGURATION ID. The customer surface returns a NARROWED type rather
    // than forwarding the store's metadata record: a key identity is MARQ
    // deployment information a customer has no operation for, and a
    // configuration id is a value that could only ever be guessed with. Asked
    // of the serialised entry, so a field added upstream fails here.
    const rootKeyId = [...harness.store.rows.credentials.values()][0].keyId;
    assert.match(rootKeyId, /^k_[0-9a-f]+$/, 'the fixture really sealed under a root key');
    for (const entry of [...acmeHistory, ...globexHistory]) {
      const serialised = JSON.stringify(entry);
      assert.ok(!serialised.includes('keyId'), 'the history carried a root key identity field');
      assert.ok(!serialised.includes(rootKeyId), 'the history carried the root key identity');
      assert.ok(!serialised.includes('configurationId'), 'the history carried an internal id');
    }
  });

  it('gives one customer’s rotation no effect on another’s credential', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);

    const globexBefore = (
      await harness.byok.credentials(await harness.actor(BYOK_TOKEN.globexAdmin), BYOK_PROVIDER)
    )[0];

    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_ROTATED);

    const globexAfter = (
      await harness.byok.credentials(await harness.actor(BYOK_TOKEN.globexAdmin), BYOK_PROVIDER)
    )[0];
    assert.equal(globexAfter.status, 'active', 'a rotation reached across tenants');
    assert.equal(globexAfter.credentialId, globexBefore.credentialId);
    assert.equal(globexAfter.secretVersion, 1, 'Globex was not silently rotated');
  });

  it('refuses a credential id that belongs to another customer, as not-found', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    const globexCredential = (
      await (async () => {
        await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);
        return harness.byok.credentials(
          await harness.actor(BYOK_TOKEN.globexAdmin), BYOK_PROVIDER,
        );
      })()
    )[0];

    const acmeActor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    // NOT-FOUND, NOT FORBIDDEN. The credential is looked up within this
    // organization's own configuration, so another tenant's id is simply not in
    // the list — the same answer as an id that does not exist at all, which is
    // the answer that tells a prober nothing.
    await refuses(
      () => harness.byok.revokeCredential(
        acmeActor, BYOK_PROVIDER, globexCredential.credentialId, BYOK_REASON,
      ),
      'FEATURE_NOT_FOUND',
      'revoking another tenant’s credential',
    );

    const globexAfter = (
      await harness.byok.credentials(await harness.actor(BYOK_TOKEN.globexAdmin), BYOK_PROVIDER)
    )[0];
    assert.equal(globexAfter.status, 'active', 'the refused revoke still took effect');
  });

  it('refuses an organization hint the caller holds no membership in', async () => {
    const harness = buildByokHarness();
    // The hint is what a caller SAYS. It is admitted only when the
    // authenticated subject holds a verified membership in it, so it can narrow
    // a caller's authority and never widen it.
    await refuses(
      () => harness.actor(BYOK_TOKEN.acmeAdmin, ORG.globex),
      'ORGANIZATION_NOT_RESOLVED',
      'an administrator naming another customer',
    );

    const denied = harness.trail().find((r) => r.action === 'ai.byok.access.denied');
    assert.ok(denied, 'the attempt was recorded');
    assert.equal(denied.outcome, 'rejected');
    assert.equal(denied.actorId, 'user-acme-admin');
    assert.deepEqual(denied.organizationScope, [ORG.globex], 'the record names the target');
  });

  it('makes an administrator of two customers say which one they mean', async () => {
    const harness = buildByokHarness();

    // NO DEFAULT TENANT. Picking one of two equally valid memberships would be
    // guessing which customer a credential change is for, and the platform
    // would be right only by luck.
    await refuses(
      () => harness.actor(BYOK_TOKEN.dualAdmin),
      'ORGANIZATION_REQUIRED',
      'an administrator of two customers naming neither',
    );

    // Naming one works, and scopes everything that follows to it.
    const acmeActor = await harness.actor(BYOK_TOKEN.dualAdmin, ORG.acme);
    assert.equal(acmeActor.organization.organizationId, ORG.acme);
    const globexActor = await harness.actor(BYOK_TOKEN.dualAdmin, ORG.globex);
    assert.equal(globexActor.organization.organizationId, ORG.globex);
  });
});

// ── Authority ───────────────────────────────────────────────────────────────

describe('Batch 4D — who may manage a customer credential', () => {
  it('grants an organization administrator both capabilities and no more', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    assert.deepEqual([...actor.capabilities].sort(), ['ai.byok.manage', 'ai.byok.view']);
  });

  it('refuses an ordinary member of the same organization', async () => {
    const harness = buildByokHarness();
    // A real member of the tenant whose credential this is. Membership is not
    // administration: "which vendors does this customer hold accounts with" is
    // the customer's business rather than every seat's.
    await refuses(
      () => harness.actor(BYOK_TOKEN.acmeMember),
      'FORBIDDEN',
      'an ordinary member of the organization',
    );
    await refuses(
      () => harness.actor(BYOK_TOKEN.acmeConsultant),
      'FORBIDDEN',
      'a consultant at the organization',
    );
  });

  it('refuses the MARQ platform operator', async () => {
    const harness = buildByokHarness();
    // A platform operator has no tenant identity, so there is no organization
    // whose BYOK they are the administrator of. This is a REDUCTION in
    // reachable authority and it is deliberate: MARQ storing or replacing a
    // customer's own vendor key is a support operation with a customer-consent
    // question attached, and shipping it as a side effect of "the platform
    // operator can do everything" would answer that question by accident.
    await refuses(
      () => harness.actor(BYOK_TOKEN.platformOperator),
      'ORGANIZATION_REQUIRED',
      'the platform operator',
    );
    // And naming a customer does not help: they hold no membership there.
    await refuses(
      () => harness.actor(BYOK_TOKEN.platformOperator, ORG.acme),
      'ORGANIZATION_NOT_RESOLVED',
      'the platform operator naming a customer',
    );
  });

  it('refuses a membership row with no trusted role behind it', async () => {
    const harness = buildByokHarness();
    // FLOORED, NOT UNIONED. The trusted team role on the auth record and the
    // organization role on the membership row can disagree while a role change
    // is half-applied; reading a tier off the union reads it off whichever half
    // is still stale. Here that is the difference between being able to replace
    // a customer's vendor key and not.
    await refuses(
      () => harness.actor(BYOK_TOKEN.membershipOnly),
      'FORBIDDEN',
      'an org_admin membership row with no trusted role',
    );
  });

  it('refuses an account that belongs to no organization', async () => {
    const harness = buildByokHarness();
    await refuses(() => harness.actor(BYOK_TOKEN.orphan), 'ORGANIZATION_REQUIRED', 'an orphan');
  });

  it('refuses the default-organization fallback, however it is configured', async () => {
    // `AI_ALLOW_DEFAULT_ORGANIZATION` is a legitimate single-tenant console
    // convenience for ordinary reads. It is NOT a statement that an account
    // belongs to that customer, and it must not authorise storing, rotating or
    // revoking that customer's vendor credential.
    const harness = buildByokHarness({
      organizationOptions: {
        defaultOrganizationId: ORG.acme,
        allowList: [],
        allowDefaultOrganization: true,
      },
    });

    await refuses(
      () => harness.actor(BYOK_TOKEN.orphan),
      'FORBIDDEN',
      'an account placed in the default organization',
    );
  });

  it('refuses a membership resolved from a cache', async () => {
    // Every caller of this surface asks the authenticator for an authoritative
    // resolution, so this never fires in practice — which is exactly why it is
    // cheap to make the failure mode of a future caller forgetting a refusal
    // rather than a credential write authorised off a stale snapshot.
    const harness = buildByokHarness({ authenticator: cachedMembershipAuthenticator() });
    await refuses(
      () => harness.actor(BYOK_TOKEN.acmeAdmin),
      'FORBIDDEN',
      'a membership resolved from a cache',
    );
  });

  it('refuses an unauthenticated caller', async () => {
    const harness = buildByokHarness();
    await refuses(
      () => harness.byok.authorize(null, ORG.acme),
      'AUTH_REQUIRED',
      'no bearer token',
    );
    await refuses(
      () => harness.byok.authorize('Bearer not-a-real-token', ORG.acme),
      'AUTH_REQUIRED',
      'an unknown bearer token',
    );
  });
});

// ── Governance ──────────────────────────────────────────────────────────────

describe('Batch 4D — what a customer may configure', () => {
  it('refuses a provider that accepts no customer credential', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    // The synthetic provider. Refused by DESCRIPTOR rather than by a
    // `providerId === 'mock'` test, so a future keyless adapter is refused too
    // with no edit here.
    await refuses(
      () => harness.byok.configureCredential(actor, 'mock', { secret: ACME_SECRET }, BYOK_REASON),
      'VALIDATION_FAILED',
      'a credential for the synthetic provider',
    );
  });

  it('refuses a provider MARQ has not certified', async () => {
    // GOVERNANCE, NOT TIDINESS. If BYOK admitted an uncertified vendor, "bring
    // your own key" would become a way to route governed traffic through a
    // provider MARQ never reviewed.
    const harness = buildByokHarness({ catalogueOverrides: { certification: 'unverified' } });
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    const error = await refuses(
      () => harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON),
      'VALIDATION_FAILED',
      'a credential for an uncertified provider',
    );
    assert.match(error.message, /not certified/i);
    assert.equal(harness.store.rows.credentials.size, 0);
  });

  it('refuses a provider MARQ has switched off', async () => {
    const harness = buildByokHarness({ catalogueOverrides: { enabled: false } });
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await refuses(
      () => harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON),
      'VALIDATION_FAILED',
      'a credential for a disabled provider',
    );
  });

  it('refuses a provider that is not registered at all', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    // A customer cannot bring a provider into being by naming it in a path
    // segment, so a typo produces a clear refusal rather than a stored
    // configuration for something that will never execute.
    await refuses(
      () => harness.byok.configureCredential(actor, 'not-a-vendor', { secret: ACME_SECRET }, BYOK_REASON),
      'PROVIDER_NOT_FOUND',
      'a credential for an unregistered provider',
    );
  });

  it('never blocks revocation on platform state', async () => {
    // CONTAINMENT THAT AN UNRELATED PLATFORM STATE CAN BLOCK IS NOT
    // CONTAINMENT. A customer must be able to withdraw their credential
    // whatever MARQ has done to the provider since they stored it.
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const configured = await harness.byok.configureCredential(
      actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON,
    );

    // MARQ decertifies AND disables the provider after the customer stored
    // their key. The catalogue is read on every call, so this is what a
    // mid-flight decertification actually looks like to the service.
    harness.degradeCatalogue({ certification: 'disabled', enabled: false });

    // Configuring is now refused, which is the governance gate doing its job.
    await refuses(
      () => harness.byok.configureCredential(
        actor, BYOK_PROVIDER, { secret: ACME_ROTATED }, BYOK_REASON,
      ),
      'VALIDATION_FAILED',
      'storing a credential for a provider MARQ has withdrawn',
    );

    // Revoking is NOT.
    const revoked = await harness.byok.revokeCredential(
      actor,
      BYOK_PROVIDER,
      configured.credential.credentialId!,
      'containment during an incident',
    );
    assert.equal(revoked.credential.status, 'revoked');
  });
});
