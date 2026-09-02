/**
 * Organization spend governance — AI-01 Batch 4D remediation (certified HIGH-1).
 *
 * ── THE CERTIFIED DEFECT ──────────────────────────────────────────────────
 *
 * BLOCKER B-2's fix moved tenant-funded executions onto
 * `SPEND_SCOPE.organization(…)`. The ledger then applied ONE configured ceiling
 * to every scope it had ever seen, and that ceiling was `AI_MAX_SPEND_USD` —
 * MARQ's own $9 lifetime cap on money MARQ is invoiced for. So declaring
 * `tenant_only`, which is the act of taking MARQ off the invoice entirely,
 * silently bought a $9 LIFETIME ceiling on the customer's spend at their OWN
 * vendor account. After it, their AI stopped permanently.
 *
 * And nothing could see or move it: `budget()`, `resetSpend()` and
 * `increaseSpendCap()` were hardcoded to `SPEND_SCOPE.platform`, so no operator
 * surface anywhere read, reset or raised an organization ledger.
 *
 * ── THE DESIGN THIS SUITE ASSERTS ─────────────────────────────────────────
 *
 *   THE CEILING IS ITS OWN CONFIGURED VALUE. `AI_ORG_MAX_SPEND_USD`, and its
 *   default is the governed UNBOUNDED state rather than MARQ's number. A
 *   lifetime stop on money MARQ does not pay is a decision to make per
 *   customer, not to inherit; the per-organization ROLLING DAILY allowance in
 *   `budget.ts` is the instrument that bounds a tenant's consumption and it
 *   still applies on every request.
 *
 *   IT IS VISIBLE TO BOTH PARTIES. The customer reads their own ledger through
 *   `ai.byok.spend.view` on the customer surface; the platform operator reads
 *   any tenant's through `ai.admin.budget.organization` on MARQ's.
 *
 *   IT IS INDEPENDENTLY MOVABLE, BY THE PLATFORM OPERATOR ONLY. Raising or
 *   clearing one organization's ledger touches neither another organization's
 *   nor MARQ's, and the customer surface has no operation that moves a ceiling
 *   at all — there is no capability in `AIByokCapability` that could name one.
 *
 * ── WHAT IS SUBSTITUTED ───────────────────────────────────────────────────
 *
 * NOT substituted: the real administration service, the real RBAC resolver and
 * grant table, the real BYOK service and its own separate grant table, the real
 * ledger with its real reservation, settlement and cap arithmetic, the real
 * spend guard and the real `spendScopeFor` rule. Time, ids and storage are
 * in-memory.
 *
 * ZERO PROVIDER CALLS. The mock vendor is marked billable so a hold is really
 * taken; `realRequestsEnabled` is a constructor argument here and
 * `AI_ALLOW_REAL_REQUESTS` stays false throughout.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SpendGuard } from '../policy/spendGuard.ts';
import type { SpendLedger } from '../policy/spendLedger.ts';

import { AIError } from '../contracts/errors.ts';
import { ADMIN_ROLE_CAPABILITIES } from '../admin/rbac.ts';
import { BYOK_ROLE_CAPABILITIES } from '../byok/byokRbac.ts';
import { createSpendGuard } from '../policy/spendGuard.ts';
import {
  SPEND_SCOPE,
  UNBOUNDED_SPEND_CAP_MICRO_USD,
  createMemorySpendStore,
  createSpendLedger,
  isUnboundedSpendCap,
  organizationOfSpendScope,
  usdToMicroUsd,
} from '../policy/spendLedger.ts';
import { createProviderRegistry } from '../providers/registry.ts';
import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createTestClock } from '../runtime/clock.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';

import { ADMIN_TOKEN, buildTestAdministration } from './harness.ts';
import { BYOK_TOKEN, ORG, buildByokHarness } from './byokFixtures.ts';

const ORG_A = 'acme';
const ORG_B = 'globex';
const REASON = 'finance ticket 8812: enterprise agreement raises the tenant ceiling';

/** A bounded organization default, so the raise and reset paths are exercisable. */
const BOUNDED_ORG_ENV = { AI_ORG_MAX_SPEND_USD: '25' };

async function rejectsWith(work: Promise<unknown>, code: string): Promise<AIError> {
  try {
    await work;
  } catch (error) {
    assert.ok(error instanceof AIError, `expected AIError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected the operation to be refused with ${code}`);
}

// ── The configured ceiling ──────────────────────────────────────────────────

describe('HIGH-1 — an organization ceiling is its own configured value', () => {
  it('does not inherit AI_MAX_SPEND_USD', () => {
    // THE CERTIFIED DEFECT, AT ITS SOURCE. MARQ's $9 must not become a
    // customer's lifetime ceiling on their own vendor account.
    const config = loadControlPlaneConfig(recordEnv({ AI_MAX_SPEND_USD: '9' }));
    assert.equal(config.spend.maxPlatformMicroUsd, usdToMicroUsd(9));
    assert.notEqual(config.spend.maxOrganizationMicroUsd, config.spend.maxPlatformMicroUsd);
    assert.equal(config.spend.maxOrganizationMicroUsd, UNBOUNDED_SPEND_CAP_MICRO_USD);
  });

  it('defaults to the governed unbounded state, and says so', () => {
    const config = loadControlPlaneConfig(recordEnv({}));
    assert.ok(isUnboundedSpendCap(config.spend.maxOrganizationMicroUsd));
    // A NUMBER, not a special case: every ledger invariant holds for it with no
    // branch of its own, and `JSON.stringify` round-trips it (which `Infinity`
    // would not — it serialises as `null`).
    assert.equal(
      JSON.parse(JSON.stringify({ cap: config.spend.maxOrganizationMicroUsd })).cap,
      UNBOUNDED_SPEND_CAP_MICRO_USD,
    );
  });

  it('honours a configured organization default, and a deliberate zero', () => {
    assert.equal(
      loadControlPlaneConfig(recordEnv(BOUNDED_ORG_ENV)).spend.maxOrganizationMicroUsd,
      usdToMicroUsd(25),
    );
    // Zero is a DECISION — an operator stopping tenant-funded execution — and
    // is honoured rather than treated as absent.
    assert.equal(
      loadControlPlaneConfig(recordEnv({ AI_ORG_MAX_SPEND_USD: '0' })).spend
        .maxOrganizationMicroUsd,
      0,
    );
  });

  it('falls back to unbounded on a malformed value, never to MARQ’s number', () => {
    // The asymmetry with `AI_MAX_SPEND_USD` is deliberate: a typo must not
    // silently impose a small lifetime cap on a customer's own vendor account,
    // which is the certified defect arriving through a different door.
    for (const raw of ['not-a-number', '-5', '']) {
      assert.equal(
        loadControlPlaneConfig(recordEnv({ AI_ORG_MAX_SPEND_USD: raw })).spend
          .maxOrganizationMicroUsd,
        UNBOUNDED_SPEND_CAP_MICRO_USD,
        `AI_ORG_MAX_SPEND_USD=${raw}`,
      );
    }
  });

  it('gives each scope its own ceiling, chosen by the scope name', async () => {
    const ledger = createSpendLedger({
      store: createMemorySpendStore(),
      capMicroUsd: (scope) =>
        organizationOfSpendScope(scope) === undefined ? usdToMicroUsd(9) : usdToMicroUsd(25),
      now: () => '2026-09-02T00:00:00.000Z',
    });

    assert.equal((await ledger.read(SPEND_SCOPE.platform)).capMicroUsd, usdToMicroUsd(9));
    assert.equal(
      (await ledger.read(SPEND_SCOPE.organization(ORG_A))).capMicroUsd,
      usdToMicroUsd(25),
    );
    // The platform scope's NAME cannot be produced by the organization builder,
    // so no organization id can be mistaken for it.
    assert.equal(organizationOfSpendScope(SPEND_SCOPE.platform), undefined);
    assert.equal(organizationOfSpendScope(SPEND_SCOPE.organization(ORG_A)), ORG_A);
  });
});

// ── Visibility and independence, on MARQ's surface ──────────────────────────

describe('HIGH-1 — organization budget administration', () => {
  it('A — an organization status shows only that organization’s spend', async () => {
    const harness = buildTestAdministration({ env: BOUNDED_ORG_ENV });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    // Real spend on A's ledger and a different amount on B's, taken through the
    // ledger the execution path uses rather than written as a record.
    const a = await harness.plane.spendLedger.reserve(
      SPEND_SCOPE.organization(ORG_A),
      usdToMicroUsd(3),
      'req-a',
    );
    assert.ok(a.granted);
    await harness.plane.spendLedger.settle(a.reservation, usdToMicroUsd(3));

    const b = await harness.plane.spendLedger.reserve(
      SPEND_SCOPE.organization(ORG_B),
      usdToMicroUsd(7),
      'req-b',
    );
    assert.ok(b.granted);

    const viewA = await harness.admin.organizationBudget(operator, ORG_A);
    assert.equal(viewA.organizationId, ORG_A);
    assert.equal(viewA.scope, SPEND_SCOPE.organization(ORG_A));
    assert.equal(viewA.spentMicroUsd, usdToMicroUsd(3));
    assert.equal(viewA.reservedMicroUsd, 0, 'another tenant’s hold appeared on this ledger');
    assert.equal(viewA.capMicroUsd, usdToMicroUsd(25));
    assert.equal(viewA.remainingMicroUsd, usdToMicroUsd(22));

    const viewB = await harness.admin.organizationBudget(operator, ORG_B);
    assert.equal(viewB.spentMicroUsd, 0);
    assert.equal(viewB.reservedMicroUsd, usdToMicroUsd(7));

    // SAFE METADATA ONLY. Asserted over the serialised response, because the
    // claim is about what can reach a client rather than about a type.
    const serialised = JSON.stringify(viewA);
    for (const forbidden of ['secret', 'sealed', 'fingerprint', 'credential', 'apiKey', 'kid']) {
      assert.doesNotMatch(serialised, new RegExp(forbidden, 'i'), `${forbidden} reached the view`);
    }
  });

  it('B — raising organization A’s cap leaves organization B and the platform untouched', async () => {
    const harness = buildTestAdministration({ env: BOUNDED_ORG_ENV });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    const platformBefore = await harness.admin.budget(operator);
    const bBefore = await harness.admin.organizationBudget(operator, ORG_B);

    const raised = await harness.admin.increaseOrganizationSpendCap(
      operator,
      ORG_A,
      usdToMicroUsd(500),
      REASON,
    );
    assert.equal(raised.capMicroUsd, usdToMicroUsd(500));
    assert.equal(raised.organizationId, ORG_A);

    const bAfter = await harness.admin.organizationBudget(operator, ORG_B);
    assert.deepEqual(bAfter, bBefore, 'organization B’s ledger moved');

    const platformAfter = await harness.admin.budget(operator);
    assert.equal(
      platformAfter.platform.capMicroUsd,
      platformBefore.platform.capMicroUsd,
      'MARQ’s ceiling moved',
    );
    assert.deepEqual(platformAfter.resets, platformBefore.resets, 'MARQ’s history moved');
  });

  it('C — resetting organization A leaves organization B and the platform untouched', async () => {
    const harness = buildTestAdministration({ env: BOUNDED_ORG_ENV });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    for (const [organizationId, id] of [
      [ORG_A, 'r-a'],
      [ORG_B, 'r-b'],
    ] as const) {
      const decision = await harness.plane.spendLedger.reserve(
        SPEND_SCOPE.organization(organizationId),
        usdToMicroUsd(4),
        id,
      );
      assert.ok(decision.granted);
      await harness.plane.spendLedger.settle(decision.reservation, usdToMicroUsd(4));
    }
    const platformDecision = await harness.plane.spendLedger.reserve(
      SPEND_SCOPE.platform,
      usdToMicroUsd(2),
      'r-platform',
    );
    assert.ok(platformDecision.granted);
    await harness.plane.spendLedger.settle(platformDecision.reservation, usdToMicroUsd(2));

    const after = await harness.admin.resetOrganizationSpend(operator, ORG_A, REASON);
    assert.equal(after.spentMicroUsd, 0);
    // The history of the reset survives the reset — an auditor's whole point.
    assert.equal(after.lifetimeSpentMicroUsd, usdToMicroUsd(4));
    assert.equal(after.changes.at(-1)?.authorizedBy, operator.actorId);

    assert.equal(
      (await harness.admin.organizationBudget(operator, ORG_B)).spentMicroUsd,
      usdToMicroUsd(4),
      'organization B’s settled spend was cleared',
    );
    assert.equal(
      (await harness.admin.budget(operator)).platform.spentMicroUsd,
      usdToMicroUsd(2),
      'MARQ’s settled spend was cleared',
    );
  });

  it('a reset cannot move the ceiling, and a raise cannot lower it', async () => {
    const harness = buildTestAdministration({ env: BOUNDED_ORG_ENV });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    // Two decisions with different blast radii must not share one audit action.
    await rejectsWith(
      harness.admin.resetOrganizationSpend(operator, ORG_A, REASON, {
        newCapMicroUsd: usdToMicroUsd(1_000),
      }),
      'VALIDATION_FAILED',
    );
    await rejectsWith(
      harness.admin.increaseOrganizationSpendCap(operator, ORG_A, usdToMicroUsd(1), REASON),
      'VALIDATION_FAILED',
    );
    assert.equal(
      (await harness.admin.organizationBudget(operator, ORG_A)).capMicroUsd,
      usdToMicroUsd(25),
    );
  });

  it('refuses to raise an unbounded ceiling, and says what to do instead', async () => {
    // The governed default. The likely caller believes a customer is capped and
    // would otherwise walk away thinking they had fixed something.
    const harness = buildTestAdministration();
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    const before = await harness.admin.organizationBudget(operator, ORG_A);
    assert.equal(before.unbounded, true);

    const error = await rejectsWith(
      harness.admin.increaseOrganizationSpendCap(operator, ORG_A, usdToMicroUsd(500), REASON),
      'VALIDATION_FAILED',
    );
    assert.match(error.message, /AI_ORG_MAX_SPEND_USD/);
  });

  it('records each change on the administrative trail under its own action', async () => {
    const harness = buildTestAdministration({ env: BOUNDED_ORG_ENV });
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);

    await harness.admin.increaseOrganizationSpendCap(operator, ORG_A, usdToMicroUsd(60), REASON);
    await harness.admin.resetOrganizationSpend(operator, ORG_A, REASON);

    const trail = harness.admin.adminAudit(operator, 20);
    const actions = trail.map((record) => record.action);
    assert.ok(actions.includes('ai.admin.organization.spend.cap_raised'));
    assert.ok(actions.includes('ai.admin.organization.spend.reset'));
    // NOT the platform action names: "did anyone touch MARQ's ceiling?" must be
    // answerable by filtering on the action alone.
    assert.ok(!actions.includes('ai.admin.spend.cap_raised'));
    assert.ok(!actions.includes('ai.admin.spend.reset'));

    const raise = trail.find((record) => record.action === 'ai.admin.organization.spend.cap_raised');
    assert.equal(raise?.target, SPEND_SCOPE.organization(ORG_A));
    assert.equal(raise?.outcome, 'applied');
    assert.ok(raise?.reason.includes('8812'), 'the operator’s reason was not recorded');
  });
});

// ── Authorization ───────────────────────────────────────────────────────────

describe('HIGH-1 — who may administer an organization ledger', () => {
  it('D — an ordinary customer member is denied, on both surfaces', async () => {
    const admin = buildTestAdministration({ env: BOUNDED_ORG_ENV });
    // On MARQ's surface a plain member resolves to no administrative role at all.
    await rejectsWith(admin.actor(ADMIN_TOKEN.member), 'FORBIDDEN');

    // On the customer surface a real member of the tenant is refused the actor
    // outright, so there is no capability to check afterwards.
    const byok = buildByokHarness({
      spend: {
        organizationSpendStatus: () => Promise.reject(new Error('must not be reached')),
        enforced: true,
      },
    });
    await rejectsWith(byok.actor(BYOK_TOKEN.acmeMember), 'FORBIDDEN');
    await rejectsWith(byok.actor(BYOK_TOKEN.acmeConsultant), 'FORBIDDEN');
  });

  it('E — a customer org admin may READ their own ledger and may move nothing', async () => {
    // THE PRODUCT DECISION, STATED BY A TEST. The permitted own-org budget
    // operation for a customer administrator is the READ. Raising or clearing a
    // governed ceiling is MARQ's act: a ledger a customer can raise for
    // themselves is not a ceiling, and clearing settled spend destroys MARQ's
    // record of what a tenant consumed.
    const ledger = createSpendLedger({
      store: createMemorySpendStore(),
      capMicroUsd: usdToMicroUsd(25),
      now: () => '2026-09-02T00:00:00.000Z',
    });
    const decision = await ledger.reserve(
      SPEND_SCOPE.organization(ORG.acme),
      usdToMicroUsd(5),
      'r1',
    );
    assert.ok(decision.granted);
    await ledger.settle(decision.reservation, usdToMicroUsd(5));

    const harness = buildByokHarness({
      spend: {
        organizationSpendStatus: (organizationId) =>
          ledger.read(SPEND_SCOPE.organization(organizationId)),
        enforced: true,
      },
    });
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);

    const view = await harness.byok.spend(actor);
    assert.equal(view.organizationId, ORG.acme);
    assert.equal(view.scope, SPEND_SCOPE.organization(ORG.acme));
    assert.equal(view.capMicroUsd, usdToMicroUsd(25));
    assert.equal(view.spentMicroUsd, usdToMicroUsd(5));
    assert.equal(view.remainingMicroUsd, usdToMicroUsd(20));
    assert.equal(view.unbounded, false);
    assert.equal(view.enforced, true);

    // SAFE METADATA ONLY.
    const serialised = JSON.stringify(view);
    for (const forbidden of ['secret', 'sealed', 'fingerprint', 'credential', 'apiKey', 'kid']) {
      assert.doesNotMatch(serialised, new RegExp(forbidden, 'i'), `${forbidden} reached the view`);
    }

    // AND THERE IS NO MUTATION TO CALL. Structural, not a capability check: the
    // service exposes no operation that moves a ceiling, so none can be reached
    // by a role change.
    for (const name of Object.keys(harness.byok)) {
      assert.doesNotMatch(name, /spendReset|increaseSpend|raiseCap|resetSpend/i);
    }
    assert.ok(!actor.capabilities.some((capability) => capability.includes('budget')));
  });

  it('F — the platform grant is explicit, and is not implied by MARQ’s own budget grant', async () => {
    // Capability, not scope widening. `ai.admin.budget.organization` is its own
    // entry in the grant table, so a future customer-facing budget role can be
    // granted without handing out MARQ's platform budget administration — and
    // the converse cannot happen by accident either.
    assert.ok(
      ADMIN_ROLE_CAPABILITIES.super_admin.includes('ai.admin.budget.organization'),
      'the platform operator cannot administer tenant ledgers',
    );
    for (const role of ['organization_admin', 'team_admin'] as const) {
      assert.ok(
        !ADMIN_ROLE_CAPABILITIES[role].includes('ai.admin.budget.organization'),
        `${role} acquired organization budget administration`,
      );
      assert.ok(!ADMIN_ROLE_CAPABILITIES[role].includes('ai.admin.budget.reset'));
    }

    // The two vocabularies do not overlap in either direction.
    const byokCapabilities = new Set<string>(Object.values(BYOK_ROLE_CAPABILITIES).flat());
    const platformCapabilities = new Set<string>(ADMIN_ROLE_CAPABILITIES.super_admin);
    for (const capability of byokCapabilities) {
      assert.ok(
        !platformCapabilities.has(capability),
        `${capability} appears in both capability sets`,
      );
    }
    assert.ok(!byokCapabilities.has('ai.admin.budget.organization'));

    // And an organization administrator on MARQ's surface is refused in fact,
    // not only in the table.
    const harness = buildTestAdministration({ env: BOUNDED_ORG_ENV });
    const orgAdmin = await harness.actor(ADMIN_TOKEN.organizationAdmin);
    await rejectsWith(harness.admin.organizationBudget(orgAdmin, ORG_A), 'FORBIDDEN');
    await rejectsWith(
      harness.admin.increaseOrganizationSpendCap(orgAdmin, ORG_A, usdToMicroUsd(500), REASON),
      'FORBIDDEN',
    );
    await rejectsWith(harness.admin.resetOrganizationSpend(orgAdmin, ORG_A, REASON), 'FORBIDDEN');
  });

  it('G — a forged organization id cannot administer another organization', async () => {
    const harness = buildTestAdministration({ env: BOUNDED_ORG_ENV });

    // An administrator of GLOBEX naming ACME. They hold no platform capability,
    // so the capability gate refuses before the id is even considered.
    const globexAdmin = await harness.actor(ADMIN_TOKEN.otherOrganizationAdmin);
    await rejectsWith(harness.admin.organizationBudget(globexAdmin, ORG_A), 'FORBIDDEN');
    await rejectsWith(
      harness.admin.increaseOrganizationSpendCap(globexAdmin, ORG_A, usdToMicroUsd(500), REASON),
      'FORBIDDEN',
    );

    // And nothing was written for the attempt.
    const operator = await harness.actor(ADMIN_TOKEN.superAdmin);
    assert.equal(
      (await harness.admin.organizationBudget(operator, ORG_A)).capMicroUsd,
      usdToMicroUsd(25),
    );

    // AN ID THAT COULD ADDRESS ANOTHER SCOPE IS REFUSED BEFORE IT BECOMES A KEY.
    // `spend:org:` + this + `:lifetime` would otherwise reach the platform
    // record, so the format check is a containment control rather than tidiness.
    for (const forged of ['acme:lifetime', 'marq:platform:lifetime', '../marq', '']) {
      await rejectsWith(harness.admin.organizationBudget(operator, forged), 'VALIDATION_FAILED');
    }

    // MARQ's own ledger is untouched by every attempt above.
    const platform = await harness.admin.budget(operator);
    assert.equal(platform.platform.spentMicroUsd, 0);
    assert.deepEqual(platform.resets, []);
  });

  it('a customer surface with no ledger refuses rather than reporting zero', async () => {
    // A console showing "$0.00 spent" for a ledger it could not reach would be
    // telling a customer something false about their own money.
    const harness = buildByokHarness();
    const actor = await harness.actor(BYOK_TOKEN.acmeAdmin);
    await rejectsWith(harness.byok.spend(actor), 'FEATURE_DISABLED');
  });
});

// ── The ceiling that actually refuses ───────────────────────────────────────

/** One guard over one ledger, with a billable vendor so a hold is really taken. */
function guardWith(capForScope: (scope: string) => number): {
  guard: SpendGuard;
  ledger: SpendLedger;
} {
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
    capMicroUsd: capForScope,
    now: () => '2026-09-02T00:00:00.000Z',
  });
  return {
    ledger,
    guard: createSpendGuard({
      ledger,
      registry,
      // A constructor argument, NOT the deployment switch. No vendor is reached.
      realRequestsEnabled: true,
      enforce: true,
    }),
  };
}

const descriptor = {
  featureId: 'test.feature',
  requiredCapabilities: { structuredOutput: false, chatCompletions: true },
  limits: { maxInputBytes: 4_000, maxOutputTokens: 1_000, maxAttempts: 2 },
} as unknown as Parameters<SpendGuard['reserve']>[0];

describe('HIGH-1 — the ceiling an execution actually meets', () => {
  it('H — a tenant_only execution is governed by the ORGANIZATION cap', async () => {
    // MARQ's ceiling is a dollar and the tenant's is a hundred. A tenant-funded
    // execution must be admitted — before this remediation it would have been
    // refused at MARQ's number, for money MARQ was never billed.
    const { guard, ledger } = guardWith((scope) =>
      organizationOfSpendScope(scope) === undefined ? usdToMicroUsd(1) : usdToMicroUsd(100),
    );

    const handle = await guard.reserve(descriptor, 'req-tenant', {
      mode: 'tenant_only',
      organizationId: ORG_A,
    });
    assert.equal(handle.reserved, true);
    await handle.settle(usdToMicroUsd(2));

    assert.equal(
      (await ledger.read(SPEND_SCOPE.organization(ORG_A))).spentMicroUsd,
      usdToMicroUsd(2),
    );
    assert.equal(
      (await ledger.read(SPEND_SCOPE.platform)).spentMicroUsd,
      0,
      'a tenant-funded execution settled on MARQ’s ledger',
    );

    // And the organization's OWN ceiling is what refuses it. Fill it, then try.
    const filler = await ledger.reserve(
      SPEND_SCOPE.organization(ORG_A),
      usdToMicroUsd(98),
      'fill-a',
    );
    assert.ok(filler.granted);
    await ledger.settle(filler.reservation, usdToMicroUsd(98));

    const error = await rejectsWith(
      guard.reserve(descriptor, 'req-over', { mode: 'tenant_only', organizationId: ORG_A }),
      'BUDGET_EXCEEDED',
    );
    // The message names WHOSE allowance, because the remedy differs entirely.
    assert.match(error.message, /organization/i);
    assert.doesNotMatch(error.message, /platform/i);
  });

  it('H — an execution whose policy could not be read is governed the same way', async () => {
    // BLOCKER-1 and HIGH-1 meet here: an `unresolved` execution is refused MARQ's
    // credential, so it must not be held on MARQ's ledger either. The spend
    // scope and the credential decision come from one predicate.
    const { guard, ledger } = guardWith((scope) =>
      organizationOfSpendScope(scope) === undefined ? usdToMicroUsd(1) : usdToMicroUsd(100),
    );

    const handle = await guard.reserve(descriptor, 'req-unresolved', {
      mode: 'unresolved',
      organizationId: ORG_A,
    });
    assert.equal(handle.reserved, true);
    await handle.settle(usdToMicroUsd(2));

    assert.equal(
      (await ledger.read(SPEND_SCOPE.organization(ORG_A))).spentMicroUsd,
      usdToMicroUsd(2),
    );
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).spentMicroUsd, 0);
  });

  it('I — a platform-funded execution remains governed by MARQ’s cap', async () => {
    const { guard, ledger } = guardWith((scope) =>
      organizationOfSpendScope(scope) === undefined ? usdToMicroUsd(9) : usdToMicroUsd(100),
    );

    const handle = await guard.reserve(descriptor, 'req-platform', {
      mode: 'platform_allowed',
      organizationId: ORG_A,
    });
    assert.equal(handle.reserved, true);
    await handle.settle(usdToMicroUsd(2));

    assert.equal((await ledger.read(SPEND_SCOPE.platform)).spentMicroUsd, usdToMicroUsd(2));
    assert.equal(
      (await ledger.read(SPEND_SCOPE.organization(ORG_A))).spentMicroUsd,
      0,
      'a platform-funded execution settled on a tenant’s ledger',
    );

    // MARQ's ceiling still refuses at MARQ's number, with MARQ's message.
    const filler = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(7), 'fill-platform');
    assert.ok(filler.granted);
    await ledger.settle(filler.reservation, usdToMicroUsd(7));

    const error = await rejectsWith(
      guard.reserve(descriptor, 'req-over', { mode: 'platform_allowed', organizationId: ORG_A }),
      'BUDGET_EXCEEDED',
    );
    assert.match(error.message, /platform/i);
  });

  it('an unbounded organization ceiling never refuses, and still settles exactly', async () => {
    const { guard, ledger } = guardWith((scope) =>
      organizationOfSpendScope(scope) === undefined
        ? usdToMicroUsd(9)
        : UNBOUNDED_SPEND_CAP_MICRO_USD,
    );

    // Far past MARQ's $9, which is the whole point of the split.
    for (let i = 0; i < 5; i += 1) {
      const handle = await guard.reserve(descriptor, `req-${i}`, {
        mode: 'tenant_only',
        organizationId: ORG_A,
      });
      assert.equal(handle.reserved, true, `the unbounded ceiling refused request ${i}`);
      await handle.settle(usdToMicroUsd(20));
    }

    const record = await ledger.read(SPEND_SCOPE.organization(ORG_A));
    assert.equal(record.spentMicroUsd, usdToMicroUsd(100));
    assert.equal(record.reservedMicroUsd, 0, 'a hold leaked');
    assert.equal(record.openReservations.length, 0);
    assert.equal(record.attemptCount, 5);
    assert.ok(isUnboundedSpendCap(record.capMicroUsd));
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).spentMicroUsd, 0);
  });

  it('one organization can neither exhaust nor be refused by another’s ceiling', async () => {
    const { guard, ledger } = guardWith(() => usdToMicroUsd(10));

    const a = await guard.reserve(descriptor, 'a-1', { mode: 'tenant_only', organizationId: ORG_A });
    await a.settle(usdToMicroUsd(9));

    // A is nearly exhausted; B is untouched and still admitted.
    const b = await guard.reserve(descriptor, 'b-1', { mode: 'tenant_only', organizationId: ORG_B });
    assert.equal(b.reserved, true, 'organization B was refused by organization A’s spend');
    await b.settle(usdToMicroUsd(9));

    assert.equal(
      (await ledger.read(SPEND_SCOPE.organization(ORG_A))).spentMicroUsd,
      usdToMicroUsd(9),
    );
    assert.equal(
      (await ledger.read(SPEND_SCOPE.organization(ORG_B))).spentMicroUsd,
      usdToMicroUsd(9),
    );
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).spentMicroUsd, 0);
  });

  it('release and settle stay on the scope the hold was taken against', async () => {
    // Reservation and settlement invariants, unchanged by the scope split: the
    // reservation carries its scope, so there is no call shape in which a
    // request settles somewhere it did not reserve.
    const { guard, ledger } = guardWith(() => usdToMicroUsd(10));

    const held = await guard.reserve(descriptor, 'held', {
      mode: 'tenant_only',
      organizationId: ORG_A,
    });
    assert.ok((await ledger.read(SPEND_SCOPE.organization(ORG_A))).reservedMicroUsd > 0);
    await held.release();
    assert.equal((await ledger.read(SPEND_SCOPE.organization(ORG_A))).reservedMicroUsd, 0);
    assert.equal((await ledger.read(SPEND_SCOPE.organization(ORG_A))).spentMicroUsd, 0);

    // A second close is a no-op rather than a double charge.
    await held.settle(usdToMicroUsd(5));
    assert.equal((await ledger.read(SPEND_SCOPE.organization(ORG_A))).spentMicroUsd, 0);
    assert.equal((await ledger.read(SPEND_SCOPE.platform)).reservedMicroUsd, 0);
  });
});
