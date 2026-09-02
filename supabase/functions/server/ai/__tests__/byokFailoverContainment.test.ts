/**
 * Customer BYOK failover containment — AI-01 Batch 4D remediation (BLOCKER B-1).
 *
 * ── WHY THIS SUITE EXISTS, AND WHY EVERY CASE IS MULTI-PROVIDER ───────────
 *
 * Batch 4D shipped with 133 passing BYOK tests and a certified BLOCKER, and the
 * two facts have one cause: every one of those tests exercised a SINGLE
 * provider. The guarantee the batch sold — "a `tenant_only` organization's
 * traffic reaches its own vendor account or none" — was implemented as a
 * property of a provider CONFIGURATION, and the pipeline does not stop at one
 * provider.
 *
 * The certified sequence:
 *
 *   ACME declares `tenant_only` on OpenAI and stores their key.
 *   Their key stops opening — a root key rotated, a record tampered with.
 *   The resolver correctly REFUSES, and the adapter raises PROVIDER_AUTH_FAILED.
 *   That error is `failoverable: true`, so the pipeline moves to Anthropic.
 *   ACME has no Anthropic configuration, so the absent per-provider policy read
 *     as `platform` — and MARQ's Anthropic credential executed ACME's traffic,
 *     while ACME's console went on reporting `customer_byok` from an OpenAI row
 *     that still said `active`.
 *
 * So a test that proves containment MUST cross a provider boundary. Each case
 * below drives the resolver the way the pipeline's candidate loop drives it:
 * the same tenant object, carrying the same funding latch, asked about a second
 * provider after the first has refused.
 *
 * ── WHAT IS AND IS NOT SUBSTITUTED ────────────────────────────────────────
 *
 * NOT substituted: the real resolver with its real precedence, the real
 * AES-256-GCM cipher, the real store semantics, the real BYOK service that
 * writes the policy, and the real `createExecutionFundingResolver` /
 * `createExecutionFundingLatch`. The only thing modelled is the pipeline's
 * candidate LOOP, and it is modelled as the pipeline actually behaves —
 * `shouldFailover` is asked of the real `AIError` traits rather than assumed.
 *
 * ZERO PROVIDER CALLS. Nothing here reaches a network. The suite asserts on
 * which credential the resolver would hand an adapter, which is the decision
 * that precedes any vendor request.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CredentialTenant } from '../providers/credentials/contracts.ts';
import type { ExecutionFundingLatch } from '../providers/credentials/executionFunding.ts';
import type { StoredProviderCredential } from '../providers/credentials/credentialStore.ts';

import { AIError } from '../contracts/errors.ts';
import { shouldFailover } from '../providers/retry.ts';
import {
  createExecutionFundingLatch,
  createExecutionFundingResolver,
} from '../providers/credentials/executionFunding.ts';
import { strictestFundingPolicy } from '../providers/credentials/tenantPrecedence.ts';

import {
  ACME_SECRET,
  BYOK_PREVIOUS_ROOT_KEY,
  BYOK_PROVIDER,
  BYOK_REASON,
  BYOK_TOKEN,
  GLOBEX_SECRET,
  ORG,
  buildByokHarness,
  configureFor,
  type ByokHarness,
} from './byokFixtures.ts';

/** The second provider in the catalogue. The one the certified defect reached. */
const FAILOVER_PROVIDER = 'anthropic';

/**
 * A MARQ platform credential, written straight to the store.
 *
 * Direct rather than through the BYOK service, deliberately and necessarily:
 * the customer surface REFUSES `scope: 'platform'`, which is the separation
 * Batch 4D exists to enforce. This is MARQ's own estate, and arranging it is
 * the platform administration service's job in production.
 */
async function givePlatformCredential(
  harness: ByokHarness,
  providerId: string,
  secret: string,
): Promise<void> {
  const at = harness.clock.isoNow();
  await harness.store.saveConfiguration({
    configurationId: `pvc_platform${providerId}`,
    providerKey: providerId,
    displayName: providerId,
    scope: 'platform',
    enabled: true,
    credentialFallback: 'platform',
    certification: 'certified',
    configuration: {},
    createdAt: at,
    updatedAt: at,
    createdBy: 'marq-operator',
    updatedBy: 'marq-operator',
  });
  const sealed = await harness.cipher.seal(secret, {
    providerKey: providerId,
    scope: 'platform',
    credentialId: `pvk_platform${providerId}`,
  });
  const record: StoredProviderCredential = {
    credentialId: `pvk_platform${providerId}`,
    configurationId: `pvc_platform${providerId}`,
    providerKey: providerId,
    credentialName: 'primary',
    status: 'active',
    fingerprint: await harness.cipher.fingerprint(secret),
    secretVersion: 1,
    keyId: sealed.kid,
    createdAt: at,
    updatedAt: at,
    createdBy: 'marq-operator',
    sealed,
  };
  await harness.store.putActiveCredential(record);
}

/** The organization's declared funding, resolved exactly as the orchestrator does. */
async function latchFor(harness: ByokHarness, organizationId: string): Promise<ExecutionFundingLatch> {
  const funding = await createExecutionFundingResolver({ store: harness.store }).resolve({
    organizationId,
    membershipVerified: true,
  });
  return createExecutionFundingLatch(funding);
}

function tenantOf(organizationId: string, funding: ExecutionFundingLatch): CredentialTenant {
  return { organizationId, membershipVerified: true, funding };
}

/**
 * Drive the resolver the way the pipeline's candidate loop drives it.
 *
 * Returns what each candidate would have executed on, in order. The loop
 * advances only when the real `shouldFailover` says the real error permits it,
 * so a test cannot accidentally prove containment by modelling a pipeline that
 * never fails over in the first place.
 */
async function runCandidateLoop(
  harness: ByokHarness,
  tenant: CredentialTenant,
  candidates: readonly string[],
): Promise<readonly { provider: string; category?: string; secret?: string }[]> {
  const executed: { provider: string; category?: string; secret?: string }[] = [];
  for (const provider of candidates) {
    const resolved = await harness.resolver.resolve(provider, tenant);
    if (resolved === undefined) {
      // Exactly what the adapters raise when nothing resolved, and exactly the
      // trait the pipeline consults before trying the next candidate.
      const authFailed = new AIError('PROVIDER_AUTH_FAILED', 'The AI provider is not configured.');
      if (!shouldFailover(authFailed)) break;
      continue;
    }
    executed.push({ provider, category: resolved.category, secret: resolved.secret });
    break;
  }
  return executed;
}

/** Every credential MARQ owns in this harness, for a "was any of them used" scan. */
const MARQ_ANTHROPIC_SECRET = 'sk-ant-marq-platform-0000000000000000';
const MARQ_OPENAI_SECRET = 'sk-marq-platform-openai-00000000000';

describe('B-1 — a tenant_only execution never reaches MARQ, across providers', () => {
  /**
   * Arrange the certified scenario: a tenant_only customer on one provider, and
   * MARQ holding a perfectly good credential on the next one.
   */
  async function tenantOnlyAcmeWithMarqBehind(
    options: { storeAcmeKey?: boolean; resolverRootKey?: string } = {},
  ): Promise<ByokHarness> {
    const harness = buildByokHarness({ resolverRootKey: options.resolverRootKey });

    if (options.storeAcmeKey !== false) {
      await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    } else {
      // The policy has to exist even when the credential does not, and the only
      // way to declare it is on a configuration the service created — so store
      // a key, declare the policy, then revoke the key. That is also exactly
      // how a customer reaches this state in production.
      await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    }

    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.setFallbackPolicy(actor, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);

    if (options.storeAcmeKey === false) {
      const history = await harness.byok.credentials(actor, BYOK_PROVIDER);
      const active = history.find((record) => record.status === 'active');
      assert.ok(active, 'the fixture failed to store a credential to revoke');
      await harness.byok.revokeCredential(actor, BYOK_PROVIDER, active.credentialId, BYOK_REASON);
    }

    // MARQ's own credentials, on BOTH providers. If containment leaks anywhere,
    // there is something for it to leak onto.
    await givePlatformCredential(harness, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);
    await givePlatformCredential(harness, BYOK_PROVIDER, MARQ_OPENAI_SECRET);

    return harness;
  }

  it('A — a BYOK credential that will not decrypt does not fall through to MARQ on the next provider', async () => {
    // The resolver holds a DIFFERENT root key than the service sealed under, so
    // ACME's credential genuinely exists and genuinely will not open. That is
    // the state a root-key rotation leaves behind, produced without corrupting
    // a record by hand.
    const harness = await tenantOnlyAcmeWithMarqBehind({
      resolverRootKey: BYOK_PREVIOUS_ROOT_KEY,
    });
    const tenant = tenantOf(ORG.acme, await latchFor(harness, ORG.acme));

    const executed = await runCandidateLoop(harness, tenant, [BYOK_PROVIDER, FAILOVER_PROVIDER]);

    assert.deepEqual(
      executed,
      [],
      'a tenant_only organization whose own credential cannot be opened executed on something',
    );
  });

  it('B — a provider auth failure does not become a MARQ-funded execution on the next provider', async () => {
    // ACME holds no usable credential at all on either provider: the OpenAI one
    // is revoked, and they never configured the failover provider. This is the
    // shape a provider auth failure leaves the resolution in.
    const harness = await tenantOnlyAcmeWithMarqBehind({ storeAcmeKey: false });
    const tenant = tenantOf(ORG.acme, await latchFor(harness, ORG.acme));

    const executed = await runCandidateLoop(harness, tenant, [BYOK_PROVIDER, FAILOVER_PROVIDER]);

    assert.deepEqual(executed, [], 'a revoked tenant_only credential reached a MARQ credential');
  });

  it('C — an unavailable first provider does not license a MARQ-funded second one', async () => {
    const harness = await tenantOnlyAcmeWithMarqBehind({ storeAcmeKey: false });
    const tenant = tenantOf(ORG.acme, await latchFor(harness, ORG.acme));

    // PROVIDER_UNAVAILABLE never reaches the credential layer at all — the
    // adapter raises it after resolution — so the honest way to model it is to
    // skip the first candidate entirely and ask the question the pipeline asks
    // next: what would the SECOND provider execute on?
    const executed = await runCandidateLoop(harness, tenant, [FAILOVER_PROVIDER]);

    assert.deepEqual(
      executed,
      [],
      'a tenant_only organization was moved onto MARQ’s credential by an unrelated provider outage',
    );
  });

  it('D — a tenant_only organization cannot reach another organization’s credential', async () => {
    const harness = await tenantOnlyAcmeWithMarqBehind({ storeAcmeKey: false });

    // GLOBEX holds a perfectly good credential on the failover provider.
    await configureFor(harness, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET, FAILOVER_PROVIDER);

    const tenant = tenantOf(ORG.acme, await latchFor(harness, ORG.acme));
    const executed = await runCandidateLoop(harness, tenant, [BYOK_PROVIDER, FAILOVER_PROVIDER]);

    assert.deepEqual(executed, [], 'ACME executed on something while GLOBEX held the only key');

    // And the positive control: GLOBEX's own credential is genuinely there and
    // genuinely usable, so the refusal above is containment rather than an
    // empty store.
    const globexTenant = tenantOf(ORG.globex, await latchFor(harness, ORG.globex));
    const globexRun = await harness.resolver.resolve(FAILOVER_PROVIDER, globexTenant);
    assert.equal(globexRun?.category, 'customer_byok');
    assert.equal(globexRun?.organizationId, ORG.globex);
  });

  it('E — a platform-allowed organization still fails over onto MARQ’s credential', async () => {
    // The regression half. Containment must not have been bought by breaking
    // the failover every non-BYOK tenant depends on.
    const harness = buildByokHarness();
    await givePlatformCredential(harness, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);

    const tenant = tenantOf(ORG.acme, await latchFor(harness, ORG.acme));
    const executed = await runCandidateLoop(harness, tenant, [BYOK_PROVIDER, FAILOVER_PROVIDER]);

    assert.equal(executed.length, 1, 'legitimate platform failover stopped working');
    assert.equal(executed[0].provider, FAILOVER_PROVIDER);
    assert.equal(executed[0].category, 'platform_managed');
    assert.equal(executed[0].secret, MARQ_ANTHROPIC_SECRET);
  });

  it('F — tenant-owned cross-provider failover IS permitted, and stays tenant-owned', async () => {
    // THE PRODUCT ANSWER, stated by a test rather than left to inference.
    //
    // `tenant_only` constrains WHOSE credential may execute, not WHICH provider
    // may serve. An organization that brought keys for two vendors bought
    // resilience across both, and refusing the second would make the strict
    // policy a downgrade in availability for no gain in containment — the money
    // still reaches their own vendor account either way.
    const harness = await tenantOnlyAcmeWithMarqBehind({ storeAcmeKey: false });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, FAILOVER_PROVIDER);

    const tenant = tenantOf(ORG.acme, await latchFor(harness, ORG.acme));
    const executed = await runCandidateLoop(harness, tenant, [BYOK_PROVIDER, FAILOVER_PROVIDER]);

    assert.equal(executed.length, 1, 'a tenant_only organization lost failover to its own key');
    assert.equal(executed[0].provider, FAILOVER_PROVIDER);
    assert.equal(executed[0].category, 'customer_byok', 'the failover left the tenant’s estate');
    assert.notEqual(executed[0].secret, MARQ_ANTHROPIC_SECRET);
  });
});

describe('B-1 — the constraint survives without the request-level pre-read', () => {
  /**
   * THE LATCH, ON ITS OWN.
   *
   * The pre-read is the primary mechanism and it can be unavailable: storage
   * may be unreachable, or a caller may supply no funding resolver at all. The
   * latch is why that degrades rather than concedes — the first per-provider
   * read that reveals `tenant_only` binds every candidate after it.
   *
   * So this case starts the execution UNCONSTRAINED, exactly as a failed
   * pre-read would, and proves the second provider is still contained.
   */
  it('latches on the first tenant_only configuration it observes', async () => {
    const harness = buildByokHarness({ resolverRootKey: BYOK_PREVIOUS_ROOT_KEY });
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.setFallbackPolicy(actor, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);
    await givePlatformCredential(harness, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);

    // As if the pre-read had failed: the execution begins platform_allowed.
    const latch = createExecutionFundingLatch({
      mode: 'platform_allowed',
      organizationId: ORG.acme,
      reason: 'pre-read unavailable',
    });
    const tenant = tenantOf(ORG.acme, latch);

    const executed = await runCandidateLoop(harness, tenant, [BYOK_PROVIDER, FAILOVER_PROVIDER]);

    assert.equal(latch.mode, 'tenant_only', 'the latch did not tighten on the observed policy');
    assert.deepEqual(executed, [], 'the failover reached MARQ after the latch should have closed');
  });

  it('never widens once tightened', async () => {
    const latch = createExecutionFundingLatch({
      mode: 'platform_allowed',
      organizationId: ORG.acme,
      reason: 'test',
    });
    latch.observeTenantOnly();
    latch.observeTenantOnly();
    assert.equal(latch.mode, 'tenant_only');
    // There is deliberately no operation that returns it — asserted structurally
    // so an added setter fails this test rather than silently reopening the door.
    assert.deepEqual(
      Object.keys(latch).filter((key) => key.startsWith('observe')).sort(),
      ['observeTenantOnly'],
    );
  });

  it('refuses a provider the tenant branch cannot even run for', async () => {
    // A provider MARQ does not accept a managed credential for skips the tenant
    // branch entirely. Before the remediation that fell silently into the
    // platform resolution, which for a tenant_only organization is the exact
    // outcome they declared must never happen.
    const harness = buildByokHarness({ env: { MOCK_PROVIDER_KEY: 'sk-env-marq-000000000000' } });
    const latch = createExecutionFundingLatch({
      mode: 'tenant_only',
      organizationId: ORG.acme,
      reason: 'test',
    });

    const resolved = await harness.resolver.resolve(
      BYOK_PROVIDER,
      tenantOf(ORG.acme, latch),
    );
    assert.equal(resolved, undefined, 'a tenant_only execution reached the deployment environment');
  });
});

describe('B-1 — the funding policy is read across the whole estate', () => {
  it('takes the strictest declaration, whichever provider carries it', () => {
    const rows = [
      { scope: 'organization' as const, organizationId: ORG.acme, credentialFallback: 'platform' as const },
      { scope: 'organization' as const, organizationId: ORG.acme, credentialFallback: 'tenant_only' as const },
    ];
    assert.equal(strictestFundingPolicy(rows, ORG.acme), 'tenant_only');
  });

  it('reads another organization’s declaration as none of this one’s business', () => {
    const rows = [
      { scope: 'organization' as const, organizationId: ORG.globex, credentialFallback: 'tenant_only' as const },
    ];
    assert.equal(strictestFundingPolicy(rows, ORG.acme), 'platform');
  });

  it('ignores a platform row entirely', () => {
    const rows = [
      { scope: 'platform' as const, organizationId: undefined, credentialFallback: 'platform' as const },
    ];
    assert.equal(strictestFundingPolicy(rows, ORG.acme), 'platform');
  });

  it('degrades to platform_allowed when the estate cannot be read', async () => {
    // A refusal here would take AI down for every tenant on the platform,
    // including the majority who never opted into BYOK — see the module note.
    // The latch is what keeps that safe rather than merely pragmatic.
    const reported: string[] = [];
    const resolver = createExecutionFundingResolver({
      store: {
        listOrganizationConfigurations: () => Promise.reject(new Error('PGRST301: statement timeout')),
      } as never,
      onError: (detail) => reported.push(detail),
    });

    const funding = await resolver.resolve({ organizationId: ORG.acme, membershipVerified: true });

    assert.equal(funding.mode, 'platform_allowed');
    assert.ok(reported.some((line) => /could not be read/.test(line)), 'the failure was not reported');
  });

  it('gives an unverified membership no tenant funding at all', async () => {
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.setFallbackPolicy(actor, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);

    const funding = await createExecutionFundingResolver({ store: harness.store }).resolve({
      organizationId: ORG.acme,
      membershipVerified: false,
    });

    // Not the tenant's policy, and not the tenant's scope. An account placed in
    // the default organization by AI_ALLOW_DEFAULT_ORGANIZATION is not a member
    // of that customer.
    assert.equal(funding.mode, 'platform_allowed');
    assert.equal(funding.organizationId, undefined);
  });

  it('keeps the policy when the credential behind it is switched off', async () => {
    // `enabled` says "use my key"; the fallback policy says "and if you cannot,
    // whose key may you use instead?". Disabling a credential is not withdrawing
    // the funding statement attached to it — a customer who switches their key
    // off expecting their traffic to STOP must not find it on MARQ's account.
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.setFallbackPolicy(actor, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);

    const configuration = await harness.store.findConfiguration(
      'organization',
      BYOK_PROVIDER,
      ORG.acme,
    );
    assert.ok(configuration);
    await harness.store.saveConfiguration({ ...configuration, enabled: false });

    const funding = await createExecutionFundingResolver({ store: harness.store }).resolve({
      organizationId: ORG.acme,
      membershipVerified: true,
    });
    assert.equal(funding.mode, 'tenant_only');
  });
});

describe('B-1 — the failover trait itself is unchanged', () => {
  it('leaves PROVIDER_AUTH_FAILED failoverable for platform-funded execution', () => {
    // The remediation deliberately does NOT make this error non-failoverable
    // globally. Whether a failover candidate is legal is an EXECUTION POLICY
    // question, and answering it by disabling failover for everybody would take
    // resilience away from every platform-funded request to contain a case that
    // is already contained at the credential layer.
    assert.equal(shouldFailover(new AIError('PROVIDER_AUTH_FAILED', 'x')), true);
  });
});
