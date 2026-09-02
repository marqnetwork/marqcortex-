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
import type {
  ProviderAdministrationStore,
  StoredProviderCredential,
} from '../providers/credentials/credentialStore.ts';

import { AIError } from '../contracts/errors.ts';
import { shouldFailover } from '../providers/retry.ts';
import {
  createExecutionFundingLatch,
  createExecutionFundingResolver,
  marqFundingPermitted,
  tenantFundedExecution,
  unresolvedFunding,
} from '../providers/credentials/executionFunding.ts';
import { strictestFundingPolicy } from '../providers/credentials/tenantPrecedence.ts';
import { spendScopeFor } from '../policy/spendGuard.ts';
import { SPEND_SCOPE } from '../policy/spendLedger.ts';

import {
  ACME_SECRET,
  BYOK_PREVIOUS_ROOT_KEY,
  BYOK_PROVIDER,
  BYOK_REASON,
  BYOK_TOKEN,
  ENVIRONMENT_SECRET,
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

    // EVERY observation is a MAX, not an assignment (BLOCKER-1). Told the two
    // weaker modes, in both orders, a tightened latch stays tightened — so no
    // ordering of providers, retries or failovers can walk an execution back
    // towards MARQ's chequebook.
    latch.observe('platform_allowed');
    assert.equal(latch.mode, 'tenant_only');
    latch.observe('unresolved');
    assert.equal(latch.mode, 'tenant_only');
    latch.observe('platform_allowed');
    assert.equal(latch.mode, 'tenant_only');

    // And the middle state is a one-way door of its own: `unresolved` is
    // stricter than `platform_allowed`, so it can be entered and not left.
    const unread = createExecutionFundingLatch(unresolvedFunding(ORG.acme));
    assert.equal(unread.mode, 'unresolved');
    unread.observe('platform_allowed');
    assert.equal(unread.mode, 'unresolved', 'an unresolved execution was widened');
    unread.observe('tenant_only');
    assert.equal(unread.mode, 'tenant_only');
    unread.observe('unresolved');
    assert.equal(unread.mode, 'tenant_only');

    // There is deliberately no operation that returns it — asserted structurally
    // so an added setter fails this test rather than silently reopening the
    // door. `observe` is here and is safe BECAUSE it takes the stricter of the
    // two; the assertions above are what prove that, and this one is what
    // forces a future third method to come with its own proof.
    assert.deepEqual(
      Object.keys(latch).filter((key) => key.startsWith('observe')).sort(),
      ['observe', 'observeTenantOnly'],
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

  it('resolves to `unresolved`, never platform_allowed, when the estate cannot be read', async () => {
    // THE CERTIFIED BLOCKER-1 CORRECTION, AT ITS SOURCE.
    //
    // The first remediation degraded here, and the degradation was the whole of
    // the residual: an organization declaring `tenant_only` on OpenAI has no
    // Anthropic row, so one failed read plus a provider order that reaches
    // Anthropic first was enough for MARQ's credential to serve them. Unknown is
    // now its own state and it is STRICTER than `platform_allowed`, not equal
    // to it.
    const reported: string[] = [];
    const resolver = createExecutionFundingResolver({
      store: {
        listOrganizationConfigurations: () => Promise.reject(new Error('PGRST301: statement timeout')),
      } as never,
      onError: (detail) => reported.push(detail),
    });

    const funding = await resolver.resolve({ organizationId: ORG.acme, membershipVerified: true });

    assert.equal(funding.mode, 'unresolved');
    assert.equal(marqFundingPermitted(funding.mode), false, 'MARQ funding stayed permitted');
    assert.equal(tenantFundedExecution(funding.mode), true);
    // The organization rides along, because the ledger scope is derived from
    // this same answer and a contained execution must be held on the tenant's
    // own scope rather than MARQ's.
    assert.equal(funding.organizationId, ORG.acme);
    assert.ok(reported.some((line) => /could not be read/.test(line)), 'the failure was not reported');
    // The reason is operator-safe: no key identity, no connection string, no
    // customer secret — it reaches an audit record and a log line.
    assert.doesNotMatch(funding.reason, /PGRST301|password|secret/i);
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

/**
 * ── BLOCKER-1 — AN UNKNOWABLE FUNDING POLICY FAILS CLOSED ─────────────────
 *
 * The first remediation made funding a property of the execution and carried it
 * as a latch. An independent re-certification then proved the guarantee still
 * rested on ONE read succeeding, and that the residual was not narrow:
 *
 *   The estate pre-read degraded an unreadable policy to `platform_allowed`.
 *   An organization with `tenant_only` on OpenAI has NO Anthropic row — the
 *     ordinary state, and the original defect's own premise.
 *   So one failed read, plus anything that reaches Anthropic first (an open
 *     OpenAI circuit alone arranges it), left nothing to tighten the latch —
 *     and MARQ's Anthropic credential executed that customer's traffic on
 *     MARQ's ledger.
 *
 * The correction is that unknown is now its own state, STRICTER than
 * `platform_allowed`, established before the provider loop rather than
 * discovered inside it. Every case below arranges the unknowable policy by
 * making the runtime's own read of real, service-written state fail — and then
 * asks whether MARQ's credential executes.
 *
 * ZERO PROVIDER CALLS. As above, the assertions are on which credential the
 * resolver would hand an adapter.
 */

/** A store whose reads fail exactly where a test says they should. */
function faultedStore(
  store: ByokHarness['store'],
  faults: {
    readonly estate?: boolean;
    readonly configurationFor?: readonly string[];
    readonly credential?: boolean;
    readonly everything?: boolean;
  },
): ProviderAdministrationStore {
  const fail = (what: string): never => {
    throw new Error(`PGRST301: ${what} read timed out`);
  };
  return {
    ...store,
    listOrganizationConfigurations(organizationId: string) {
      if (faults.estate || faults.everything) return Promise.reject(new Error('PGRST301: estate read timed out'));
      return store.listOrganizationConfigurations(organizationId);
    },
    findConfiguration(scope: 'platform' | 'organization', providerKey: string, organizationId?: string) {
      if (faults.everything) return Promise.reject(new Error('PGRST301: configuration read timed out'));
      if (faults.configurationFor?.includes(providerKey)) fail('configuration');
      return store.findConfiguration(scope, providerKey, organizationId);
    },
    activeCredential(configurationId: string) {
      if (faults.credential || faults.everything) {
        return Promise.reject(new Error('PGRST301: credential read timed out'));
      }
      return store.activeCredential(configurationId);
    },
  } as ProviderAdministrationStore;
}

/**
 * The funding the ORCHESTRATOR would resolve, over the store the RUNTIME reads.
 *
 * The same call `orchestrator.ts` makes, over the same faulted store the
 * resolver was handed — because a test that resolved funding from a healthy
 * store and then executed against a broken one would be proving nothing about
 * the sequence the defect lives in.
 */
async function fundingOver(
  store: ProviderAdministrationStore,
  organizationId: string,
  membershipVerified = true,
): Promise<ExecutionFundingLatch> {
  const funding = await createExecutionFundingResolver({ store }).resolve({
    organizationId,
    membershipVerified,
  });
  return createExecutionFundingLatch(funding);
}

describe('BLOCKER-1 — an unknowable funding policy never reopens MARQ-funded execution', () => {
  it('A — a failed pre-read plus a skipped tenant_only provider does not reach MARQ’s Anthropic key', async () => {
    // THE CERTIFIED SEQUENCE, EXACTLY.
    //
    // ACME declares tenant_only on OpenAI and holds a real key there. The
    // estate read fails. OpenAI is SKIPPED — an open circuit, a provider MARQ
    // disabled, a selection that ordered Anthropic first; the pipeline models
    // all of them the same way, by never asking the credential layer about
    // OpenAI at all. So nothing observes the tenant_only row, and before this
    // remediation nothing tightened the latch.
    const real = buildByokHarness();
    await configureFor(real, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    const acme = await real.actor(BYOK_TOKEN.acmeAdmin);
    await real.byok.setFallbackPolicy(acme, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);
    await givePlatformCredential(real, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);

    // The runtime now reads through a store whose ESTATE read fails. The
    // per-provider reads still work — this is one failed read, not two, which
    // is precisely the certification's correction to the commit's claim.
    const runtime = faultedStore(real.store, { estate: true });
    const harness = buildByokHarness({ resolverStore: runtime });
    // Same rows, same cipher key: the second harness reads the first's store.
    const latch = await fundingOver(runtime, ORG.acme);

    assert.equal(latch.mode, 'unresolved', 'a failed estate read did not contain the execution');

    const executed = await runCandidateLoop(
      harness,
      tenantOf(ORG.acme, latch),
      // OpenAI skipped entirely. Anthropic first, where ACME has no row at all.
      [FAILOVER_PROVIDER],
    );

    assert.deepEqual(
      executed,
      [],
      'MARQ’s Anthropic credential executed a customer whose funding policy could not be read',
    );
  });

  it('B — a failed pre-read plus a provider with no tenant configuration does not reach MARQ', async () => {
    const real = buildByokHarness();
    await givePlatformCredential(real, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);
    await givePlatformCredential(real, BYOK_PROVIDER, MARQ_OPENAI_SECRET);

    // ACME has NO organization configuration anywhere. Before the remediation
    // this read as `platform` on every provider and MARQ served them.
    const runtime = faultedStore(real.store, { estate: true });
    const harness = buildByokHarness({ resolverStore: runtime });
    const latch = await fundingOver(runtime, ORG.acme);

    assert.equal(latch.mode, 'unresolved');

    const executed = await runCandidateLoop(
      harness,
      tenantOf(ORG.acme, latch),
      [BYOK_PROVIDER, FAILOVER_PROVIDER],
    );

    assert.deepEqual(executed, [], 'MARQ’s credential served an execution with no readable policy');
  });

  it('C — a failed pre-read plus a failed first tenant read does not reach MARQ', async () => {
    const real = buildByokHarness();
    await configureFor(real, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    await givePlatformCredential(real, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);
    await givePlatformCredential(real, BYOK_PROVIDER, MARQ_OPENAI_SECRET);

    // BOTH reads fail on the first provider — the state the commit claimed was
    // required for the defect. It is contained here as well, and by the same
    // one mechanism rather than by a second special case.
    const runtime = faultedStore(real.store, { estate: true, configurationFor: [BYOK_PROVIDER] });
    const harness = buildByokHarness({ resolverStore: runtime });
    const latch = await fundingOver(runtime, ORG.acme);

    const executed = await runCandidateLoop(
      harness,
      tenantOf(ORG.acme, latch),
      [BYOK_PROVIDER, FAILOVER_PROVIDER],
    );

    assert.deepEqual(executed, [], 'a partial resolver failure moved a customer onto MARQ’s key');
    assert.equal(latch.mode, 'unresolved', 'the latch loosened somewhere in the loop');
  });

  it('D — every Cortex read failing does not license the deployment ENVIRONMENT credential', async () => {
    // The environment key is the last resort and the one a storage outage makes
    // most reachable: it needs no `cortex` row at all. So it is the credential
    // the certification named, and it is refused for the same reason as the
    // managed one — MARQ is billed for both.
    const real = buildByokHarness();
    await configureFor(real, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    const acme = await real.actor(BYOK_TOKEN.acmeAdmin);
    await real.byok.setFallbackPolicy(acme, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);

    const runtime = faultedStore(real.store, { everything: true });
    const harness = buildByokHarness({
      resolverStore: runtime,
      env: { MOCK_PROVIDER_KEY: ENVIRONMENT_SECRET },
    });
    const latch = await fundingOver(runtime, ORG.acme);

    assert.equal(latch.mode, 'unresolved');

    const executed = await runCandidateLoop(
      harness,
      tenantOf(ORG.acme, latch),
      [BYOK_PROVIDER, FAILOVER_PROVIDER],
    );

    assert.deepEqual(executed, [], 'the deployment environment credential served an unknown policy');

    // The positive control: that environment key IS reachable, so the refusal
    // above is containment and not an empty deployment.
    const platformRun = await harness.resolver.resolve(BYOK_PROVIDER);
    assert.equal(platformRun?.source, 'environment');
    assert.equal(platformRun?.secret, ENVIRONMENT_SECRET);
  });

  it('E — a healthy platform_allowed policy still fails over onto MARQ’s credential', async () => {
    // THE REGRESSION HALF, AND THE REASON `unresolved` IS A THIRD STATE RATHER
    // THAN A GLOBAL SWITCH. Containment applies to executions whose funding is
    // tenant-owned or unknown. A request whose policy was READ and permits
    // MARQ's credential keeps every bit of its resilience.
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    const acme = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.setFallbackPolicy(acme, BYOK_PROVIDER, 'platform', BYOK_REASON);
    await givePlatformCredential(harness, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);

    const latch = await fundingOver(harness.store, ORG.acme);
    assert.equal(latch.mode, 'platform_allowed');

    // The tenant's own OpenAI key answers first — that is what they configured.
    // The failover question is what this case is about, so ask the second
    // provider the way the pipeline asks it after the first has failed.
    const executed = await runCandidateLoop(
      harness,
      tenantOf(ORG.acme, latch),
      [FAILOVER_PROVIDER],
    );

    assert.equal(executed.length, 1, 'legitimate MARQ failover was disabled by the remediation');
    assert.equal(executed[0].category, 'platform_managed');
    assert.equal(executed[0].secret, MARQ_ANTHROPIC_SECRET);
  });

  it('F — a healthy tenant_only policy still fails over onto the tenant’s OWN second key', async () => {
    // The accepted Batch 4D policy, unchanged: `tenant_only` constrains whose
    // credential may execute, not which provider may serve.
    const harness = buildByokHarness();
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    await configureFor(harness, BYOK_TOKEN.acmeAdmin, ACME_SECRET, FAILOVER_PROVIDER);
    const acme = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await harness.byok.setFallbackPolicy(acme, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);
    await givePlatformCredential(harness, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);

    const latch = await fundingOver(harness.store, ORG.acme);
    assert.equal(latch.mode, 'tenant_only');

    const executed = await runCandidateLoop(
      harness,
      tenantOf(ORG.acme, latch),
      [FAILOVER_PROVIDER],
    );

    assert.equal(executed.length, 1, 'a tenant_only organization lost failover to its own key');
    assert.equal(executed[0].category, 'customer_byok');
    assert.equal(executed[0].secret, ACME_SECRET);
    assert.notEqual(executed[0].secret, MARQ_ANTHROPIC_SECRET);
  });

  it('G — an unknown policy never reaches another organization’s valid credential', async () => {
    const real = buildByokHarness();
    // GLOBEX holds the only working key on the failover provider.
    await configureFor(real, BYOK_TOKEN.globexAdmin, GLOBEX_SECRET, FAILOVER_PROVIDER);
    await givePlatformCredential(real, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);

    const runtime = faultedStore(real.store, { estate: true });
    const harness = buildByokHarness({ resolverStore: runtime });
    const latch = await fundingOver(runtime, ORG.acme);
    assert.equal(latch.mode, 'unresolved');

    const executed = await runCandidateLoop(
      harness,
      tenantOf(ORG.acme, latch),
      [BYOK_PROVIDER, FAILOVER_PROVIDER],
    );

    assert.deepEqual(executed, [], 'an unknown-policy execution reached another tenant’s credential');

    // Containment is per tenant, not a platform-wide stop: GLOBEX, whose own
    // estate read also fails, still executes on the key it can prove is theirs.
    const globexLatch = await fundingOver(runtime, ORG.globex);
    assert.equal(globexLatch.mode, 'unresolved');
    const globexRun = await harness.resolver.resolve(
      FAILOVER_PROVIDER,
      tenantOf(ORG.globex, globexLatch),
    );
    assert.equal(globexRun?.category, 'customer_byok', 'a provable tenant credential was refused');
    assert.equal(globexRun?.organizationId, ORG.globex);
    assert.equal(globexRun?.secret, GLOBEX_SECRET);
  });

  it('H — an open circuit on the declaring provider cannot bypass the funding constraint', async () => {
    // The open circuit is the reason A is reachable with ONE failed read, and
    // it deserves its own case: an execution whose only tenant_only row is on a
    // provider the pipeline never asks about must still be contained.
    //
    // Modelled as the pipeline models it — the declaring provider is simply not
    // a candidate — and asserted for BOTH the readable and unreadable policy,
    // because the constraint must not depend on which of the two it is.
    const real = buildByokHarness();
    await configureFor(real, BYOK_TOKEN.acmeAdmin, ACME_SECRET, BYOK_PROVIDER);
    const acme = await real.actor(BYOK_TOKEN.acmeAdmin);
    await real.byok.setFallbackPolicy(acme, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);
    await givePlatformCredential(real, FAILOVER_PROVIDER, MARQ_ANTHROPIC_SECRET);

    // 1. Policy readable. The pre-read carries it past the open circuit.
    const readable = buildByokHarness({ resolverStore: real.store });
    const readableLatch = await fundingOver(real.store, ORG.acme);
    assert.equal(readableLatch.mode, 'tenant_only');
    assert.deepEqual(
      await runCandidateLoop(readable, tenantOf(ORG.acme, readableLatch), [FAILOVER_PROVIDER]),
      [],
      'an open circuit on the declaring provider released the declared policy',
    );

    // 2. Policy unreadable. `unresolved` carries the same refusal.
    const runtime = faultedStore(real.store, { estate: true });
    const unreadable = buildByokHarness({ resolverStore: runtime });
    const unreadableLatch = await fundingOver(runtime, ORG.acme);
    assert.equal(unreadableLatch.mode, 'unresolved');
    assert.deepEqual(
      await runCandidateLoop(unreadable, tenantOf(ORG.acme, unreadableLatch), [FAILOVER_PROVIDER]),
      [],
      'an open circuit on the declaring provider released an unknown policy',
    );
  });

  it('the spend scope and the credential decision come from ONE predicate', async () => {
    // Requirement 8 of the finding, asserted rather than asserted about: an
    // execution MARQ may not serve must not be held on MARQ's ledger, or a
    // transient storage fault silently bills MARQ for traffic it was barred
    // from carrying.
    for (const mode of ['platform_allowed', 'unresolved', 'tenant_only'] as const) {
      const scope = spendScopeFor({ mode, organizationId: ORG.acme });
      assert.equal(
        scope === SPEND_SCOPE.platform,
        marqFundingPermitted(mode),
        `the ledger scope disagreed with credential eligibility for ${mode}`,
      );
    }
    assert.equal(spendScopeFor({ mode: 'unresolved', organizationId: ORG.acme }), SPEND_SCOPE.organization(ORG.acme));
  });

  it('an unverified membership is answered without a read, so an outage cannot contain it', async () => {
    // The population that must NOT pay the availability cost: an account with
    // no membership row, placed in the deployment's default organization. No
    // customer's funding policy applies to it, so there is nothing to fail to
    // read — and this branch is taken before any storage call, which is what
    // makes that true rather than merely intended.
    let reads = 0;
    const counting = {
      listOrganizationConfigurations: () => {
        reads += 1;
        return Promise.reject(new Error('PGRST301: estate read timed out'));
      },
    } as never;

    const funding = await createExecutionFundingResolver({ store: counting }).resolve({
      organizationId: ORG.acme,
      membershipVerified: false,
    });

    assert.equal(funding.mode, 'platform_allowed');
    assert.equal(funding.organizationId, undefined, 'an unverified caller bought a tenant scope');
    assert.equal(reads, 0, 'an unverified membership reached storage');
  });
});
