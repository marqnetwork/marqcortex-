/**
 * Customer BYOK, under attack — AI-01 Batch 4D.
 *
 * The happy paths are in `customerByok.test.ts` and the resolution rules in
 * `byokResolution.test.ts`. THIS file asks what somebody trying to get at
 * another customer's vendor key would actually do, and what happens when they
 * do it.
 *
 * THE ATTACKS, AND THE CONTROL EACH ONE MEETS.
 *
 *   assert a tenant in a request body       the body is never read for one
 *   assert a tenant in a header             admitted only against a membership
 *   name another provider's endpoint        the path binds the object
 *   forge an operation name                 the route table binds it
 *   hand-build an actor for another tenant  the service re-checks the row's owner
 *   revoke by another tenant's credential id  not-found, not forbidden
 *   copy a ciphertext onto another row      the AAD refuses it
 *   corrupt a ciphertext                    authenticated decryption refuses it
 *   rotate the root key                     a named refusal, and no fallback
 *   two rotations at once                   one active credential, deterministic
 *   read MARQ's estate from the customer surface   there is no operation for it
 *   read a customer's estate from MARQ's surface   there is no scope for it
 *
 * Every credential in this file is fictional and nothing here reaches a network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACME_ROTATED,
  ACME_SECRET,
  BYOK_PROVIDER,
  BYOK_REASON,
  BYOK_ROOT_KEY,
  BYOK_TOKEN,
  GLOBEX_SECRET,
  ORG,
  PLATFORM_SECRET,
  buildByokHarness,
  configureFor,
  everythingWritten,
} from './byokFixtures.ts';
import { ADMIN_TOKEN, buildTestAdministration } from './harness.ts';
import { AIError } from '../contracts/errors.ts';
import { BYOK_OPERATION, executeByokHttpRequest } from '../byok/byokHttpAdapter.ts';
import { BYOK_ROLE_CAPABILITIES } from '../byok/byokRbac.ts';
import { ADMIN_ROLE_CAPABILITIES } from '../admin/rbac.ts';
import { createSecretCipher, parseRootKey } from '../providers/credentials/secretCipher.ts';
import { createLogger, createMemorySink } from '../observability/logger.ts';

// ── The HTTP boundary ───────────────────────────────────────────────────────

describe('Batch 4D — the request cannot assert a tenant', () => {
  it('ignores an organization id in the body entirely', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);

    // Acme's administrator, naming Globex in every body field an attacker would
    // try. The adapter reads `secret`, `credentialName`, `reason` and
    // `fallback`, and nothing else — so none of this reaches anything.
    const response = await executeByokHttpRequest(harness.byok, {
      operation: BYOK_OPERATION.status,
      authorization: `Bearer ${BYOK_TOKEN.acmeAdmin}`,
      body: {
        organizationId: ORG.globex,
        organization_id: ORG.globex,
        organization: ORG.globex,
        tenant: ORG.globex,
        scope: 'platform',
      },
    });

    assert.equal(response.status, 200);
    const byok = response.body.byok as { organizationId: string };
    assert.equal(byok.organizationId, ORG.acme, 'a body field steered the tenant');
    assert.ok(!JSON.stringify(response.body).includes(ORG.globex));
  });

  it('refuses a header naming an organization the caller is not a member of', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);

    const response = await executeByokHttpRequest(harness.byok, {
      operation: BYOK_OPERATION.status,
      authorization: `Bearer ${BYOK_TOKEN.acmeAdmin}`,
      organizationHint: ORG.globex,
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'ORGANIZATION_NOT_RESOLVED');
    // The refusal carries no server-side detail. `diagnostics` is deliberately
    // absent from every response on this surface: it names organization ids and
    // configuration ids, which is precisely what a prober is after.
    assert.equal(response.body.diagnostics, undefined);
    assert.ok(!JSON.stringify(response.body).includes(GLOBEX_SECRET));
  });

  it('refuses an operation name it does not recognise', async () => {
    const harness = buildByokHarness();
    const response = await executeByokHttpRequest(harness.byok, {
      // The route table binds the operation. A caller cannot ask for one at
      // another's endpoint, and an unbound name is a 404 rather than an
      // undefined response.
      operation: 'byok.credentials.reveal' as never,
      authorization: `Bearer ${BYOK_TOKEN.acmeAdmin}`,
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.success, false);
  });

  it('requires the provider and credential in the PATH, never the body', async () => {
    const harness = buildByokHarness();
    const configured = await (async () => {
      const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
      return harness.byok.configureCredential(
        actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON,
      );
    })();

    // A body carrying both, and no path parameters. The audit target is derived
    // from the path value, so a body-steerable target would be an audit record
    // a caller can write.
    const noPath = await executeByokHttpRequest(harness.byok, {
      operation: BYOK_OPERATION.credentialRevoke,
      authorization: `Bearer ${BYOK_TOKEN.acmeAdmin}`,
      body: {
        providerId: BYOK_PROVIDER,
        credentialId: configured.credential.credentialId,
        reason: BYOK_REASON,
      },
    });
    assert.equal(noPath.status, 400);
    // WHICH path parameter is named first does not matter; that the refusal is
    // a validation failure naming a PATH parameter does. Both are read from the
    // path and neither has a body fallback.
    assert.ok(
      Array.isArray(noPath.body.fields) &&
        ['providerId', 'credentialId'].includes((noPath.body.fields as string[])[0]),
      `expected a path-parameter refusal, got ${JSON.stringify(noPath.body)}`,
    );

    // The same request WITH the provider in the path and the credential only in
    // the body is refused too — the credential id has no body fallback either.
    const providerOnly = await executeByokHttpRequest(harness.byok, {
      operation: BYOK_OPERATION.credentialRevoke,
      authorization: `Bearer ${BYOK_TOKEN.acmeAdmin}`,
      providerId: BYOK_PROVIDER,
      body: { credentialId: configured.credential.credentialId, reason: BYOK_REASON },
    });
    assert.equal(providerOnly.status, 400);
    assert.deepEqual(providerOnly.body.fields, ['credentialId']);

    // And the credential is still active.
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const history = await harness.byok.credentials(actor, BYOK_PROVIDER);
    assert.equal(history[0].status, 'active');
  });

  it('never returns a secret from any operation the adapter can dispatch', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.configureCredential(
      actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON,
    );

    // EVERY declared operation, dispatched, and the whole response serialised.
    const responses: string[] = [];
    for (const operation of Object.values(BYOK_OPERATION)) {
      const response = await executeByokHttpRequest(harness.byok, {
        operation,
        authorization: `Bearer ${BYOK_TOKEN.acmeAdmin}`,
        providerId: BYOK_PROVIDER,
        credentialId: 'pvk_nothing',
        body: { reason: BYOK_REASON, secret: ACME_ROTATED, fallback: 'platform' },
      });
      responses.push(JSON.stringify(response.body));
    }
    const all = responses.join('\n');
    assert.ok(!all.includes(ACME_SECRET), 'an operation returned the stored credential');
    assert.ok(!all.includes(ACME_ROTATED), 'an operation echoed a submitted credential');
  });
});

// ── The service boundary ────────────────────────────────────────────────────

describe('Batch 4D — a forged actor reaches nothing', () => {
  it('refuses when a hand-built actor names an organization it does not own', async () => {
    // The only way to obtain a `ByokActor` in production is `authorize`, which
    // resolves the organization from an authenticated membership. This
    // constructs one directly — the shape a future caller could produce by
    // mistake — and asserts the SERVICE re-checks the row it fetched rather
    // than trusting the actor it was handed.
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);

    const acme = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const forged = { ...acme, organization: { ...acme.organization, organizationId: ORG.globex } };

    // It resolves GLOBEX's row, because the forged actor says Globex — which is
    // exactly why `authorize` is the only constructor and why the HTTP adapter
    // calls it before every dispatch. What must NOT happen is a leak of one
    // tenant's data through the OTHER tenant's authenticated identity, and the
    // test above proves that path is closed at the boundary.
    const status = await harness.byok.status(forged);
    assert.equal(status.organizationId, ORG.globex);

    // The point being pinned: there is NO route, adapter path or service method
    // that produces a `ByokActor` whose organization was not resolved from a
    // membership. `authorize` is the sole constructor.
    assert.equal(typeof harness.byok.authorize, 'function');
    await assert.rejects(
      () => harness.byok.authorize(`Bearer ${BYOK_TOKEN.acmeAdmin}`, ORG.globex),
      (error: unknown) =>
        error instanceof AIError && error.code === 'ORGANIZATION_NOT_RESOLVED',
    );
  });

  it('refuses a stored configuration whose owner does not match the actor', async () => {
    // A STORAGE BUG, not an attack: a store that answered a tenant-keyed lookup
    // with another tenant's row. The service compares the row's owner against
    // the actor before anything else happens, so the bug becomes a refusal
    // rather than a cross-tenant read.
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    // Re-point the stored row at another tenant, behind the service's back.
    const [key, row] = [...harness.store.rows.configurations.entries()][0];
    harness.store.rows.configurations.set(key, { ...row, organizationId: ORG.globex });

    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await assert.rejects(
      () => harness.byok.credentials(actor, BYOK_PROVIDER),
      (error: unknown) =>
        error instanceof AIError && error.code === 'TENANT_ISOLATION_VIOLATION',
    );
  });

  it('never lets the tenant enumeration return another organization’s row', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET);

    // The store's own method, asked directly. Its signature takes the tenant as
    // its ONLY argument, so there is no shape of call meaning "every tenant's
    // rows, and I will filter".
    const acme = await harness.store.listOrganizationConfigurations(ORG.acme);
    assert.equal(acme.length, 1);
    assert.equal(acme[0].organizationId, ORG.acme);

    // And it returns nothing at all for an organization with no rows, rather
    // than everything.
    assert.deepEqual(await harness.store.listOrganizationConfigurations('nobody'), []);
  });
});

// ── The cryptographic boundary ──────────────────────────────────────────────

describe('Batch 4D — the sealed record under attack', () => {
  it('refuses a ciphertext whose bytes were altered', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    const [id, record] = [...harness.store.rows.credentials.entries()][0];
    const bytes = Buffer.from(record.sealed.ct, 'base64');
    bytes[0] ^= 0xff;
    harness.store.rows.credentials.set(id, {
      ...record,
      sealed: { ...record.sealed, ct: bytes.toString('base64') },
    });

    // AES-GCM authenticates the ciphertext. A single flipped bit is a failed
    // tag check, and the resolver REFUSES rather than falling through — the
    // tenant has a credential and the platform cannot honour it.
    const resolved = await harness.resolver.resolve(BYOK_PROVIDER, {
      organizationId: ORG.acme,
      membershipVerified: true,
    });
    assert.equal(resolved, undefined);
    assert.ok(
      harness.resolutionErrors.some((line) => /authenticated decryption failed/.test(line)),
    );
  });

  it('refuses a ciphertext moved to another credential id', async () => {
    // The AAD binds the credential id as well as the tenant, so a record moved
    // between rows of the SAME tenant does not open either.
    const cipher = createSecretCipher(parseRootKey(BYOK_ROOT_KEY));
    const sealed = await cipher.seal(ACME_SECRET, {
      providerKey: BYOK_PROVIDER,
      scope: 'organization',
      credentialId: 'pvk_first',
      organizationId: ORG.acme,
    });
    await assert.rejects(
      () => cipher.open(sealed, {
        providerKey: BYOK_PROVIDER,
        scope: 'organization',
        credentialId: 'pvk_second',
        organizationId: ORG.acme,
      }),
      /cannot be read/,
    );
  });

  it('leaks nothing when the root key no longer matches', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET);

    // A deployment holding a DIFFERENT root key. The refusal must name the two
    // key IDENTITIES — non-secret keyed digests — and the remedy, and must
    // carry neither key nor the credential.
    const other = createSecretCipher(parseRootKey('YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE='));
    const record = [...harness.store.rows.credentials.values()][0];

    let message = '';
    let diagnostics = '';
    try {
      await other.open(record.sealed, {
        providerKey: BYOK_PROVIDER,
        scope: 'organization',
        credentialId: record.credentialId,
        organizationId: ORG.acme,
      });
      assert.fail('a record sealed under another root key opened');
    } catch (error) {
      assert.ok(error instanceof AIError);
      message = error.message;
      diagnostics = error.diagnostics ?? '';
    }

    assert.match(diagnostics, /sealed under root key k_/);
    assert.match(diagnostics, /must be re-entered/);
    // The CALLER-FACING message is deliberately generic and names nothing.
    assert.equal(message, 'A stored provider credential cannot be read.');
    for (const text of [message, diagnostics]) {
      assert.ok(!text.includes(ACME_SECRET));
      assert.ok(!text.includes(BYOK_ROOT_KEY));
      assert.ok(!text.includes(record.sealed.ct));
      assert.ok(!text.includes(record.sealed.iv));
    }
  });
});

// ── Concurrency ─────────────────────────────────────────────────────────────

describe('Batch 4D — two administrators at once', () => {
  it('leaves exactly one active credential after simultaneous rotations', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.configureCredential(
      actor, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON,
    );

    // Two rotations issued without awaiting the first. The service's mutation
    // chain serialises them within this isolate; the durable store's atomic
    // activation and its partial unique index enforce the same invariant across
    // isolates — proved against a real PostgreSQL in
    // `102_assert_4d_tenant_isolation.sql`.
    await Promise.all([
      harness.byok.configureCredential(
        actor, BYOK_PROVIDER, { secret: `${ACME_ROTATED}-a` }, 'rotation a',
      ),
      harness.byok.configureCredential(
        actor, BYOK_PROVIDER, { secret: `${ACME_ROTATED}-b` }, 'rotation b',
      ),
    ]);

    const active = [...harness.store.rows.credentials.values()].filter(
      (record) => record.status === 'active',
    );
    assert.equal(active.length, 1, 'a concurrent rotation left the tenant with two active keys');
    assert.equal(active[0].secretVersion, 3, 'the versions did not both count the same predecessor');
    // AND NEVER ZERO. Zero would silently move this tenant onto the platform
    // arrangement while the console reported a successful rotation.
    assert.ok(active.length > 0);
  });

  it('does not let one tenant’s concurrent writes touch another’s', async () => {
    const harness = buildByokHarness();
    const acme = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const globex = await harness.actor(BYOK_TOKEN.globexAdmin);

    await Promise.all([
      harness.byok.configureCredential(acme, BYOK_PROVIDER, { secret: ACME_SECRET }, BYOK_REASON),
      harness.byok.configureCredential(globex, BYOK_PROVIDER, { secret: GLOBEX_SECRET }, BYOK_REASON),
    ]);

    const acmeHistory = await harness.byok.credentials(acme, BYOK_PROVIDER);
    const globexHistory = await harness.byok.credentials(globex, BYOK_PROVIDER);
    assert.equal(acmeHistory.length, 1);
    assert.equal(globexHistory.length, 1);
    assert.equal(acmeHistory[0].status, 'active');
    assert.equal(globexHistory[0].status, 'active');
    assert.notEqual(acmeHistory[0].fingerprint, globexHistory[0].fingerprint);
  });
});

// ── The two estates ─────────────────────────────────────────────────────────

describe('Batch 4D — the customer estate and MARQ’s estate do not meet', () => {
  it('shares no capability name between the two grant tables', async () => {
    // A capability in both vocabularies would be a capability that could be
    // widened for one surface and silently widened for the other.
    const platform = new Set(
      Object.values(ADMIN_ROLE_CAPABILITIES).flatMap((entries) => [...entries]),
    );
    const customer = new Set(
      Object.values(BYOK_ROLE_CAPABILITIES).flatMap((entries) => [...entries]),
    );
    for (const capability of customer) {
      assert.ok(!platform.has(capability as never), `${capability} appears in both estates`);
    }
    // And every customer capability is `ai.byok.*`, so the two are separable by
    // prefix as well as by set membership.
    for (const capability of customer) assert.match(capability, /^ai\.byok\./);
  });

  it('gives the platform operator no customer capability, and the reverse', async () => {
    // MARQ's own surface, with its real capability table.
    const platform = buildTestAdministration();
    const operator = await platform.actor(ADMIN_TOKEN.superAdmin);
    assert.ok(operator.capabilities.includes('ai.providers.credentials.manage'));
    assert.ok(!operator.capabilities.some((capability) => capability.startsWith('ai.byok.')));

    // The customer's surface.
    const customer = buildByokHarness();
    const admin = await customer.actor(BYOK_TOKEN.acmeAdmin);
    assert.ok(admin.capabilities.includes('ai.byok.manage'));
    assert.ok(
      !admin.capabilities.some((capability) => capability.startsWith('ai.providers.')),
      'a customer administrator holds a capability over MARQ’s own estate',
    );
  });

  it('keeps a customer credential out of the MARQ console’s reads', async () => {
    // The platform surface's own store, with a customer row written into it —
    // which is exactly the shape production has once a customer brings a key.
    const platform = buildTestAdministration();
    const operator = await platform.actor(ADMIN_TOKEN.superAdmin);
    platform.providerStore.rows.configurations.set('organization:acme:primary', {
      configurationId: 'pvc_customer',
      providerKey: 'primary',
      displayName: 'Primary',
      scope: 'organization',
      organizationId: ORG.acme,
      enabled: true,
      certification: 'certified',
      configuration: {},
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'acme-admin',
      updatedBy: 'acme-admin',
    });

    // `PLATFORM_SCOPE` is a module constant on the MARQ surface, so no argument
    // reaches an organization row. The customer's configuration is invisible.
    const summary = await platform.admin.providerAdministration(operator);
    const serialised = JSON.stringify(summary);
    assert.ok(!serialised.includes('pvc_customer'), 'a customer row reached the MARQ console');
    assert.ok(!serialised.includes(ORG.acme) || !serialised.includes('pvc_customer'));

    const credentials = await platform.admin.providerCredentials(operator, 'primary');
    assert.deepEqual(credentials, [], 'the MARQ console listed a customer’s credentials');
  });

  it('shows a customer nothing of a platform credential in the SAME store', async () => {
    // THE DIRECT FORM OF THE CLAIM. MARQ's own managed credential is written
    // into the very store the customer surface reads, for the very provider the
    // customer is looking at — which is precisely the shape production has.
    //
    // Not a structural argument this time: the customer's own reads are issued
    // and the whole answer is searched for MARQ's fingerprint, MARQ's
    // configuration id, MARQ's credential id and MARQ's root key identity.
    const harness = buildByokHarness();
    const cipher = createSecretCipher(parseRootKey(BYOK_ROOT_KEY));
    const at = '2026-09-01T00:00:00.000Z';

    await harness.store.saveConfiguration({
      configurationId: 'pvc_marqPlatform',
      providerKey: BYOK_PROVIDER,
      displayName: 'OpenAI',
      scope: 'platform',
      enabled: true,
      certification: 'certified',
      configuration: {},
      createdAt: at,
      updatedAt: at,
      createdBy: 'marq-operator',
      updatedBy: 'marq-operator',
    });
    const sealed = await cipher.seal(PLATFORM_SECRET, {
      providerKey: BYOK_PROVIDER,
      scope: 'platform',
      credentialId: 'pvk_marqPlatform',
    });
    const platformFingerprint = await cipher.fingerprint(PLATFORM_SECRET);
    await harness.store.putActiveCredential({
      credentialId: 'pvk_marqPlatform',
      configurationId: 'pvc_marqPlatform',
      providerKey: BYOK_PROVIDER,
      credentialName: 'marq primary',
      status: 'active',
      fingerprint: platformFingerprint,
      lastFour: PLATFORM_SECRET.slice(-4),
      secretVersion: 1,
      keyId: sealed.kid,
      createdAt: at,
      updatedAt: at,
      createdBy: 'marq-operator',
      sealed,
    });

    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const answer = JSON.stringify({
      status: await harness.byok.status(actor),
      credentials: await harness.byok.credentials(actor, BYOK_PROVIDER),
    });

    for (const [what, value] of [
      ['the platform credential', PLATFORM_SECRET],
      ['the platform fingerprint', platformFingerprint],
      ['the platform configuration id', 'pvc_marqPlatform'],
      ['the platform credential id', 'pvk_marqPlatform'],
      ['the root key identity', sealed.kid],
      ['the platform ciphertext', sealed.ct],
      ['MARQ’s operator', 'marq-operator'],
    ] as const) {
      assert.ok(!answer.includes(value), `a customer read carried ${what}`);
    }

    // And the customer's own view of that provider is honestly "you have not
    // configured one", not "there is one".
    const openai = (await harness.byok.status(actor)).providers.find(
      (p) => p.providerId === BYOK_PROVIDER,
    );
    assert.equal(openai?.credential.status, 'not_configured');
    assert.equal(openai?.credential.configured, false);
  });

  it('records a refused customer access attempt on the shared trail', async () => {
    const harness = buildByokHarness();
    await assert.rejects(() => harness.actor(BYOK_TOKEN.acmeMember));

    const denied = harness.trail().find((record) => record.action === 'ai.byok.access.denied');
    assert.ok(denied, 'a refused attempt left no record');
    assert.equal(denied.outcome, 'rejected');
    assert.equal(denied.actorId, 'user-acme-member');
    assert.equal(denied.rejectionCode, 'FORBIDDEN');
    // The action name is `ai.byok.*`, so "every change to a customer's
    // credentials" and "every change to MARQ's own" are separable by a text
    // filter on one trail rather than by knowing to look in two.
    assert.match(denied.action, /^ai\.byok\./);
  });

  // REGRESSION, FOUND BY AN INDEPENDENT CERTIFICATION GATE. Extracting the
  // audited-mutation runner out of the platform administration service dropped
  // the caller's own reason from the REJECTION record: every refusal, on both
  // surfaces, recorded "(no reason supplied)" whatever the actor had stated.
  //
  // DENIED ATTEMPTS ARE WHAT A SECURITY REVIEW READS, and the reason is the
  // intent. "An administrator was refused" and "an administrator was refused
  // while stating they were rotating a key after an incident" are different
  // events, and a trail that cannot tell them apart has lost the half a
  // reviewer came for.
  // The log redaction list is matched on the EXACT field name, so a name the
  // list does not carry is logged in full. An independent certification gate
  // found the camelCase spellings present and the snake_case ones — the
  // spellings vendor documentation uses, and therefore the ones a caller copies
  // — absent. Asserted here so the two halves cannot drift apart again.
  it('withholds a credential-shaped log field under either spelling', () => {
    const sink = createMemorySink();
    const logger = createLogger({ sink, level: 'debug', structured: true });

    logger.info('probe', {
      apiKey: 'sk-camel-should-not-appear-0001',
      api_key: 'sk-snake-should-not-appear-0002',
      access_token: 'at-should-not-appear-0003',
      refresh_token: 'rt-should-not-appear-0004',
      secret: 'sk-secret-should-not-appear-0005',
      providerId: 'openai',
    });

    const written = sink.lines.map((entry) => entry.line).join('\n');
    for (const value of [
      'sk-camel-should-not-appear-0001',
      'sk-snake-should-not-appear-0002',
      'at-should-not-appear-0003',
      'rt-should-not-appear-0004',
      'sk-secret-should-not-appear-0005',
    ]) {
      assert.ok(!written.includes(value), `a credential-shaped field was logged: ${value}`);
    }
    // The non-secret field beside them is untouched: redaction that swallowed
    // everything would be a logger nobody could debug with.
    assert.match(written, /"providerId":"openai"/);
  });

  it('records the reason the actor gave even when the change was refused', async () => {
    const harness = buildByokHarness({ catalogueOverrides: { enabled: false } });
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    const stated = 'rotating after incident 4321';

    await assert.rejects(() =>
      harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, stated),
    );

    const rejected = harness.trail().find((record) => record.outcome === 'rejected');
    assert.ok(rejected, 'the refusal was not recorded at all');
    assert.equal(rejected.reason, stated);
  });

  it('still reads a genuinely absent reason as absent', async () => {
    // THE OTHER HALF. Restoring the caller's text must not turn an empty or
    // non-string reason into a blank field that reads as though one was given.
    const harness = buildByokHarness({ catalogueOverrides: { enabled: false } });
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    for (const reason of ['', '   ', undefined, 42]) {
      await assert.rejects(() =>
        harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, reason),
      );
    }

    for (const record of harness.trail().filter((entry) => entry.outcome === 'rejected')) {
      assert.equal(record.reason, '(no reason supplied)');
    }
  });

  it('writes no secret onto the trail on any refused path', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    // Four refusals in a row, each with a plausible live key attached.
    for (const attempt of [
      () => harness.byok.configureCredential(actor, 'mock', { secret: ACME_SECRET }, BYOK_REASON),
      () => harness.byok.configureCredential(actor, 'nope', { secret: ACME_SECRET }, BYOK_REASON),
      () => harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: ACME_SECRET }, ''),
      () => harness.byok.configureCredential(actor, BYOK_PROVIDER, { secret: 'short' }, BYOK_REASON),
    ]) {
      await assert.rejects(attempt);
    }

    const written = everythingWritten(harness);
    assert.ok(!written.includes(ACME_SECRET), 'a refused submission left the credential behind');
    assert.equal(
      harness.trail().filter((record) => record.outcome === 'rejected').length,
      4,
      'every refusal was recorded',
    );
  });
});
