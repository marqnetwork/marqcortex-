/**
 * Customer BYOK spend isolation — AI-01 Batch 4D remediation (BLOCKER B-2).
 *
 * ── THE CERTIFIED DEFECT ──────────────────────────────────────────────────
 *
 * `orchestrator.ts` reserved against `SPEND_SCOPE.platform` unconditionally,
 * before any credential was resolved, and `SPEND_SCOPE.organization()` existed
 * with no production call site at all. So a customer running entirely on their
 * own vendor account still drew down MARQ's lifetime ceiling — and could
 * exhaust it, denying AI to every other tenant and to MARQ's own features, over
 * spend MARQ was never billed for. The mirror case was equally wrong: that
 * customer was refused once MARQ's ceiling filled, for money they were paying
 * themselves.
 *
 * ── WHAT IS SUBSTITUTED HERE, AND WHAT IS NOT ─────────────────────────────
 *
 * NOT substituted: the real spend guard, the real ledger with its real
 * reservation, settlement, release and cap arithmetic, and the real
 * `spendScopeFor` rule. The mock provider stands in for a vendor and is marked
 * billable so a reservation is actually taken — it makes no network call, and
 * `realRequestsEnabled` is a constructor argument to this guard rather than the
 * deployment's `AI_ALLOW_REAL_REQUESTS`, which stays false throughout.
 *
 * ZERO PROVIDER CALLS. Nothing here reaches a vendor; the suite asserts on
 * ledger arithmetic, which is what happens before and after a call rather than
 * during one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SpendFunding, SpendGuard } from '../policy/spendGuard.ts';
import type { SpendLedger } from '../policy/spendLedger.ts';

import { createSpendGuard, spendScopeFor } from '../policy/spendGuard.ts';
import {
  SPEND_SCOPE,
  createMemorySpendStore,
  createSpendLedger,
  remainingMicroUsd,
  usdToMicroUsd,
} from '../policy/spendLedger.ts';
import { createProviderRegistry } from '../providers/registry.ts';
import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createTestClock } from '../runtime/clock.ts';
import { AIError } from '../contracts/errors.ts';
import { createSlidingWindowRateLimiter } from '../security/rateLimiter.ts';
import { createByokService } from '../byok/byokService.ts';
import { createAdminAuditWriter, createMemoryAdminAuditStore } from '../admin/adminAudit.ts';
import {
  BYOK_ORGANIZATION_OPTIONS,
  BYOK_PROVIDER,
  BYOK_REASON,
  BYOK_TOKEN,
  ORG,
  buildByokHarness,
  byokAuthenticator,
} from './byokFixtures.ts';

const NINE_DOLLARS = usdToMicroUsd(9);
const now = () => new Date('2026-09-02T00:00:00.000Z').toISOString();

const ACME = 'acme';
const GLOBEX = 'globex';

const TENANT_FUNDED: SpendFunding = { mode: 'tenant_only', organizationId: ACME };
const PLATFORM_FUNDED: SpendFunding = { mode: 'platform_allowed', organizationId: ACME };

/** One guard over one ledger, with a billable vendor so a hold is really taken. */
function guardWith(options: { cap?: number } = {}): { guard: SpendGuard; ledger: SpendLedger } {
  const clock = createTestClock();
  const circuit = createCircuitBreaker(clock, {
    failureThreshold: 5,
    openMs: 1_000,
    halfOpenSuccessesToClose: 1,
  });
  const registry = createProviderRegistry(clock, circuit);
  registry.register(
    createMockProvider({
      providerId: 'vendor',
      billable: true,
      pricing: { promptMicroUsdPer1k: 150, completionMicroUsdPer1k: 600 },
    }),
    { certification: 'certified' },
  );
  const ledger = createSpendLedger({
    store: createMemorySpendStore(),
    capMicroUsd: options.cap ?? NINE_DOLLARS,
    now,
  });
  const guard = createSpendGuard({
    ledger,
    registry,
    // A constructor argument, NOT the deployment switch. No vendor is reached.
    realRequestsEnabled: true,
    enforce: true,
  });
  return { guard, ledger };
}

const descriptor = {
  featureId: 'test.feature',
  requiredCapabilities: { structuredOutput: false, chatCompletions: true },
  limits: { maxInputBytes: 4_000, maxOutputTokens: 1_000, maxAttempts: 2 },
} as unknown as Parameters<SpendGuard['reserve']>[0];

describe('B-2 — the scope rule itself', () => {
  it('sends a tenant-funded execution to that organization’s own scope', () => {
    assert.equal(spendScopeFor(TENANT_FUNDED), SPEND_SCOPE.organization(ACME));
  });

  it('leaves a platform-allowed execution on MARQ’s scope', () => {
    // Deliberate and conservative. MARQ's credential MAY serve this request, so
    // MARQ's ceiling is what has to bound it. An organization that holds its own
    // key but leaves the default policy in place therefore still reserves
    // against MARQ — over-protecting MARQ's ceiling, never under-protecting it,
    // and the customer's remedy is one console action.
    assert.equal(spendScopeFor(PLATFORM_FUNDED), SPEND_SCOPE.platform);
  });

  it('refuses to build a tenant scope with no tenant', () => {
    // `spend:org:undefined:lifetime` would pool every such request into one
    // shared bucket, which is the exact opposite of what this exists for.
    assert.equal(spendScopeFor({ mode: 'tenant_only' }), SPEND_SCOPE.platform);
    assert.equal(spendScopeFor(undefined), SPEND_SCOPE.platform);
  });
});

describe('B-2 — a BYOK request does not touch MARQ’s ceiling', () => {
  it('A — reserves and settles on the organization scope, leaving the platform untouched', async () => {
    const { guard, ledger } = guardWith();

    const handle = await guard.reserve(descriptor, 'req-byok-1', TENANT_FUNDED);
    assert.equal(handle.reserved, true, 'no hold was taken at all');

    const orgHeld = await ledger.read(SPEND_SCOPE.organization(ACME));
    const platformHeld = await ledger.read(SPEND_SCOPE.platform);
    assert.ok(orgHeld.reservedMicroUsd > 0, 'the organization scope holds nothing');
    assert.equal(platformHeld.reservedMicroUsd, 0, 'MARQ’s ceiling was reserved against');
    assert.equal(platformHeld.spentMicroUsd, 0);

    await handle.settle(1_000);

    const orgSettled = await ledger.read(SPEND_SCOPE.organization(ACME));
    const platformAfter = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(orgSettled.spentMicroUsd, 1_000, 'settlement did not land on the organization');
    assert.equal(orgSettled.reservedMicroUsd, 0, 'the hold was not converted');
    assert.equal(platformAfter.spentMicroUsd, 0, 'MARQ was billed for a customer’s own key');
    assert.equal(platformAfter.reservedMicroUsd, 0);
  });

  it('B — releases the organization’s hold when the request fails, still leaving the platform untouched', async () => {
    const { guard, ledger } = guardWith();

    const handle = await guard.reserve(descriptor, 'req-byok-2', TENANT_FUNDED);
    await handle.release();

    const org = await ledger.read(SPEND_SCOPE.organization(ACME));
    const platform = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(org.reservedMicroUsd, 0, 'the organization’s headroom was stranded');
    assert.equal(org.spentMicroUsd, 0, 'a released hold was charged');
    assert.equal(remainingMicroUsd(org), NINE_DOLLARS);
    assert.equal(platform.reservedMicroUsd, 0);
    assert.equal(platform.spentMicroUsd, 0);
  });

  it('C — the scope is fixed at reservation, so retries and failover cannot move it', async () => {
    // The handle closes over ONE reservation, and the reservation carries its
    // own scope: `settle` and `release` take that object rather than a scope, so
    // there is no call shape in which a request settles somewhere it did not
    // reserve. Retries and failover all happen inside the pipeline, after this
    // handle exists — which is what makes the scope stable by construction
    // rather than by discipline.
    const { guard, ledger } = guardWith();
    const handle = await guard.reserve(descriptor, 'req-byok-3', TENANT_FUNDED);

    // Several attempts' worth of settlement, exactly as a failed-over request
    // settles: once, at the end, for everything that burned.
    await handle.settle(2_500);
    await handle.settle(9_999); // idempotent — a second settle must not double-charge

    const org = await ledger.read(SPEND_SCOPE.organization(ACME));
    const platform = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(org.spentMicroUsd, 2_500);
    assert.equal(platform.spentMicroUsd, 0, 'a retry moved a tenant-funded execution onto MARQ');
  });

  it('D — a platform-funded request behaves exactly as it did before', async () => {
    const { guard, ledger } = guardWith();

    const handle = await guard.reserve(descriptor, 'req-platform-1', PLATFORM_FUNDED);
    assert.equal(handle.reserved, true);
    assert.ok((await ledger.read(SPEND_SCOPE.platform)).reservedMicroUsd > 0);

    await handle.settle(4_000);
    const platform = await ledger.read(SPEND_SCOPE.platform);
    const org = await ledger.read(SPEND_SCOPE.organization(ACME));
    assert.equal(platform.spentMicroUsd, 4_000);
    assert.equal(org.spentMicroUsd, 0, 'a platform-funded request was billed to a tenant');
  });

  it('D2 — omitting the funding argument is the Batch 4C behaviour, byte for byte', async () => {
    const { guard, ledger } = guardWith();
    const handle = await guard.reserve(descriptor, 'req-legacy-1');
    await handle.settle(500);
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).spentMicroUsd, 500);
  });
});

describe('B-2 — one organization cannot spend or block another’s allowance', () => {
  it('E — an exhausted organization blocks neither the platform nor a second tenant', async () => {
    // A cap that admits exactly ONE of this descriptor's reservations
    // (1,000 prompt tokens at 150 + 1,000 completion tokens at 600, doubled for
    // the two permitted attempts = 1,500 µUSD), so ACME can genuinely exhaust
    // its own allowance while every other scope still has its full headroom.
    const { guard, ledger } = guardWith({ cap: 2_000 });

    const first = await guard.reserve(descriptor, 'req-acme-1', TENANT_FUNDED);
    await first.settle(1_500);
    assert.equal((await ledger.read(SPEND_SCOPE.organization(ACME))).spentMicroUsd, 1_500);

    await assert.rejects(
      () => guard.reserve(descriptor, 'req-acme-2', TENANT_FUNDED),
      (error: unknown) => {
        assert.ok(error instanceof AIError);
        assert.equal(error.code, 'BUDGET_EXCEEDED');
        // The message must name WHOSE allowance, because the remedy differs:
        // a tenant refusal is that organization's own ceiling and is raised for
        // that organization alone. Reading as "MARQ has run out" would send an
        // administrator to the wrong console and imply an outage that is not
        // happening.
        assert.match(error.message, /your organization/i);
        assert.match(error.diagnostics ?? '', new RegExp(SPEND_SCOPE.organization(ACME)));
        return true;
      },
    );

    // MARQ is untouched and still fully available.
    const platform = await ledger.read(SPEND_SCOPE.platform);
    assert.equal(platform.spentMicroUsd, 0, 'a tenant’s spend landed on MARQ’s ledger');
    assert.equal(platform.reservedMicroUsd, 0);
    const marqHandle = await guard.reserve(descriptor, 'req-marq-1', PLATFORM_FUNDED);
    assert.equal(marqHandle.reserved, true, 'an exhausted tenant blocked MARQ’s own execution');
    await marqHandle.release();

    // And so is the second tenant.
    const globexHandle = await guard.reserve(descriptor, 'req-globex-1', {
      mode: 'tenant_only',
      organizationId: GLOBEX,
    });
    assert.equal(globexHandle.reserved, true, 'one tenant’s exhaustion blocked another’s');
    await globexHandle.settle(300);
    assert.equal((await ledger.read(SPEND_SCOPE.organization(GLOBEX))).spentMicroUsd, 300);
    // ACME still carries exactly its own spend and none of GLOBEX's.
    assert.equal((await ledger.read(SPEND_SCOPE.organization(ACME))).spentMicroUsd, 1_500);
  });

  it('F — concurrent executions from two organizations reserve and settle independently', async () => {
    const { guard, ledger } = guardWith();

    const [acme, globex] = await Promise.all([
      guard.reserve(descriptor, 'req-concurrent-acme', TENANT_FUNDED),
      guard.reserve(descriptor, 'req-concurrent-globex', {
        mode: 'tenant_only',
        organizationId: GLOBEX,
      }),
    ]);

    await Promise.all([acme.settle(1_111), globex.settle(2_222)]);

    const acmeRecord = await ledger.read(SPEND_SCOPE.organization(ACME));
    const globexRecord = await ledger.read(SPEND_SCOPE.organization(GLOBEX));
    const platform = await ledger.read(SPEND_SCOPE.platform);

    assert.equal(acmeRecord.spentMicroUsd, 1_111);
    assert.equal(globexRecord.spentMicroUsd, 2_222);
    assert.equal(acmeRecord.reservedMicroUsd, 0);
    assert.equal(globexRecord.reservedMicroUsd, 0);
    assert.equal(platform.spentMicroUsd, 0, 'concurrent tenant spend leaked onto MARQ');
    assert.equal(platform.reservedMicroUsd, 0);
  });

  it('leaves a tenant’s ceiling raisable without touching MARQ’s', async () => {
    // The existing `raiseCap` already takes a scope, so an operator can widen
    // one customer's governed allowance without widening MARQ's own — no new
    // administrative surface was needed for that, and none was added.
    const { guard, ledger } = guardWith({ cap: 2_000 });

    const first = await guard.reserve(descriptor, 'req-raise-1', TENANT_FUNDED);
    await first.settle(1_500);
    await assert.rejects(() => guard.reserve(descriptor, 'req-raise-2', TENANT_FUNDED));

    await ledger.raiseCap(SPEND_SCOPE.organization(ACME), {
      authorizedBy: 'operator',
      reason: 'customer funds their own vendor account',
      newCapMicroUsd: 500_000,
    });

    const handle = await guard.reserve(descriptor, 'req-raise-3', TENANT_FUNDED);
    assert.equal(handle.reserved, true, 'raising the tenant’s ceiling did not admit its request');
    await handle.release();

    // MARQ's own ceiling is exactly where it was.
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).capMicroUsd, 2_000);
  });
});

/**
 * M-3 — abuse control on the customer credential surface.
 *
 * Lives in this file rather than a third one because it is the same shape of
 * claim: a bounded resource, keyed per organization, that one tenant must not
 * be able to exhaust for another.
 */
describe('M-3 — credential administration is rate limited per organization', () => {
  it('refuses a mutation burst without touching reads or another tenant', async () => {
    const clock = createTestClock();
    const harness = buildByokHarness();
    const limiter = createSlidingWindowRateLimiter(clock);
    const rule = { limit: 2, windowMs: 60_000 };

    // The real service, over the real administration, with the limiter injected
    // exactly as `bootstrap.ts` injects it.
    const limited = createByokService({
      authenticator: byokAuthenticator(),
      organizationOptions: BYOK_ORGANIZATION_OPTIONS,
      administration: harness.byok,
      trail: createAdminAuditWriter({
        store: createMemoryAdminAuditStore(50),
        clock,
        newAuditId: () => 'aud_test',
      }),
      rateLimit: { limiter, rule },
    });

    const acme = await limited.authorize(`Bearer ${BYOK_TOKEN.acmeAdmin}`, undefined);
    await limited.setFallbackPolicy(acme, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);
    await limited.setFallbackPolicy(acme, BYOK_PROVIDER, 'platform', BYOK_REASON);

    await assert.rejects(
      () => limited.setFallbackPolicy(acme, BYOK_PROVIDER, 'tenant_only', BYOK_REASON),
      (error: unknown) => {
        assert.ok(error instanceof AIError);
        assert.equal(error.code, 'RATE_LIMITED');
        assert.ok(error.retryAfterSeconds > 0, 'no retry hint was given');
        // Names nothing another tenant could be probed with.
        assert.doesNotMatch(error.message, /globex/i);
        return true;
      },
    );

    // Reads are deliberately unlimited — an administrator refreshing the panel
    // during an incident must not be locked out of looking.
    const status = await limited.status(acme);
    assert.equal(status.organizationId, ORG.acme);

    // And the second tenant has its own untouched allowance.
    const globex = await limited.authorize(`Bearer ${BYOK_TOKEN.globexAdmin}`, undefined);
    await limited.setFallbackPolicy(globex, BYOK_PROVIDER, 'tenant_only', BYOK_REASON);
  });

  it('is absent by default, so an un-injected deployment behaves as Batch 4D did', async () => {
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    for (let i = 0; i < 25; i += 1) {
      await harness.byok.setFallbackPolicy(actor, BYOK_PROVIDER, 'platform', BYOK_REASON);
    }
  });
});

describe('B-2 — an organization id never becomes an unsafe ledger key', () => {
  it('refuses an id that could address another scope', () => {
    // The scope becomes a KV key joined on `:`. An id carrying one could
    // address a different ledger entirely — including MARQ's. Two of the three
    // paths in `resolveOrganization` already validate; the sole-membership path
    // takes the value straight off a row, so the check is made here, where the
    // id first becomes a key.
    assert.throws(
      () => spendScopeFor({ mode: 'tenant_only', organizationId: 'acme:marq:platform' }),
      (error: unknown) => {
        assert.ok(error instanceof AIError);
        assert.equal(error.code, 'VALIDATION_FAILED');
        return true;
      },
    );
  });

  it('admits the identifiers the platform actually issues', () => {
    // A UUID from a membership row, and a slug-shaped id.
    assert.equal(
      spendScopeFor({ mode: 'tenant_only', organizationId: '3f2b1c4d-0000-4a5b-8c9d-1e2f3a4b5c6d' }),
      SPEND_SCOPE.organization('3f2b1c4d-0000-4a5b-8c9d-1e2f3a4b5c6d'),
    );
    assert.equal(
      spendScopeFor({ mode: 'tenant_only', organizationId: 'marq-cortex' }),
      SPEND_SCOPE.organization('marq-cortex'),
    );
  });
});
