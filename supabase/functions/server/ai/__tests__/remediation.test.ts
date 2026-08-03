/**
 * Remediation regression suite — AI-01 Batch 1.
 *
 * One test per reviewed finding, written so that reintroducing the defect fails
 * here specifically. Each `describe` names the finding it pins.
 *
 * These run against the real control plane through `buildTestPlane`: real guard,
 * real policy engine, real pipeline, real governance, real audit writer. The
 * substitutions are a hand-driven clock, sequential ids and a mock adapter — no
 * production behaviour is stubbed out of the path under test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTestPlane, narrativeInput, sectionCopilotInput, stubAuthenticator, TEST_TOKEN } from './harness.ts';
import { executeAIHttpRequest, correlationIdFromHeaders } from '../http/httpAdapter.ts';
import { FEATURE } from '../features/index.ts';
import { createProviderRegistry } from '../providers/registry.ts';
import { createProviderSelector } from '../providers/selector.ts';
import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createRetryScheduler } from '../providers/retry.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSlidingWindowRateLimiter } from '../security/rateLimiter.ts';
import { AIError } from '../contracts/errors.ts';
import type { AIErrorCode } from '../contracts/errors.ts';

const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const envelope = (featureId: string, input: unknown, overrides: Record<string, unknown> = {}) => ({
  featureId,
  input,
  channel: 'team_console' as const,
  ...overrides,
});

const codeOf = (error: unknown): AIErrorCode | undefined =>
  error instanceof AIError ? error.code : undefined;

/** A body that PASSES validation, so a rejection can only be an authorization one. */
const blockAssistBody = (overrides: Record<string, unknown> = {}) => ({
  block_id: 'b1',
  block_type: 'proposal_executive_brief',
  title: 'Executive Brief',
  current_content: { text: 'Current narrative.' },
  action: 'ai_improve',
  context: { company: 'Acme', industry: 'Manufacturing' },
  ...overrides,
});

// ── B1 — anonymous AI execution ─────────────────────────────────────────────

describe('B1 — no AI route permits anonymous provider invocation', () => {
  const NAMED_ROUTES = [
    { path: 'POST /blocks/ai-assist', featureId: FEATURE.blockAssist },
    { path: 'POST /blocks/copilot-interpret', featureId: FEATURE.copilotPlan },
  ];

  it('declares no feature that admits an anonymous actor', () => {
    const { plane } = buildTestPlane();
    for (const descriptor of plane.catalog.list()) {
      assert.equal(
        descriptor.allowedActorTypes.includes('anonymous'),
        false,
        `${descriptor.featureId} admits anonymous actors`,
      );
    }
  });

  for (const route of NAMED_ROUTES) {
    it(`rejects an unauthenticated ${route.path} with zero provider calls`, async () => {
      const { plane, provider, backup } = buildTestPlane();
      await assert.rejects(
        () => plane.execute(envelope(route.featureId, {}), { authorization: null }),
        (error: unknown) => codeOf(error) === 'AUTH_REQUIRED',
      );
      // The assertion that matters: the refusal happened BEFORE any provider
      // was reached, so an unauthenticated caller cannot spend the budget.
      assert.equal(provider.calls.length, 0, 'primary provider was invoked');
      assert.equal(backup.calls.length, 0, 'backup provider was invoked');
    });

    it(`rejects an invalid credential on ${route.path} with zero provider calls`, async () => {
      const { plane, provider } = buildTestPlane();
      await assert.rejects(
        () => plane.execute(envelope(route.featureId, {}), { authorization: 'Bearer forged' }),
        (error: unknown) => codeOf(error) === 'AUTH_INVALID',
      );
      assert.equal(provider.calls.length, 0);
    });
  }
});

// ── B2 — authorization by server-resolved role ──────────────────────────────

describe('B2 — capability authorization uses server-resolved roles', () => {
  it('denies a role without the feature capability', async () => {
    const { plane, provider } = buildTestPlane({
      authenticator: stubAuthenticator(TEST_TOKEN, {
        roles: ['viewer'],
        memberships: [{ organizationId: 'acme', roles: ['viewer'] }],
      }),
    });
    await assert.rejects(
      () => plane.execute(envelope(FEATURE.blockAssist, blockAssistBody()), AUTH),
      (error: unknown) => codeOf(error) === 'CAPABILITY_DENIED',
    );
    assert.equal(provider.calls.length, 0);
  });

  it('grants a role that carries the capability', async () => {
    const { plane } = buildTestPlane({
      authenticator: stubAuthenticator(TEST_TOKEN, {
        roles: ['consultant'],
        memberships: [{ organizationId: 'acme', roles: ['consultant'] }],
      }),
    });
    const result = await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    assert.ok(result.requestId);
  });

  it('ignores a role asserted in the request body', async () => {
    // Roles come from the authenticator, never the payload. A body field named
    // `roles` must have no effect on what the caller may do.
    const { plane, provider } = buildTestPlane({
      authenticator: stubAuthenticator(TEST_TOKEN, {
        roles: ['viewer'],
        memberships: [{ organizationId: 'acme', roles: ['viewer'] }],
      }),
    });
    await assert.rejects(
      () =>
        plane.execute(
          envelope(FEATURE.blockAssist, blockAssistBody({ roles: ['owner'], actorRole: 'admin' })),
          AUTH,
        ),
      (error: unknown) => codeOf(error) === 'CAPABILITY_DENIED',
    );
    assert.equal(provider.calls.length, 0);
  });
});

// ── H1 — tenant isolation ───────────────────────────────────────────────────

describe('H1 — tenant boundary', () => {
  it('carries the resolved organization and its verification state into audit', async () => {
    const { plane } = buildTestPlane();
    await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    const [record] = plane.recentAudit(1);
    assert.equal(record.organizationId, 'acme');
    assert.equal(record.organizationMembershipVerified, true);
  });

  it('refuses a cross-tenant organization hint', async () => {
    const { plane, provider } = buildTestPlane();
    await assert.rejects(
      () =>
        plane.execute(envelope(FEATURE.narrative, narrativeInput()), {
          ...AUTH,
          organizationHint: 'globex',
        }),
      (error: unknown) => codeOf(error) === 'ORGANIZATION_NOT_RESOLVED',
    );
    assert.equal(provider.calls.length, 0, 'a cross-tenant attempt reached a provider');
  });

  it('fails a membership-less subject closed rather than bucketing it by default', async () => {
    const { plane } = buildTestPlane({
      authenticator: stubAuthenticator(TEST_TOKEN, { roles: ['consultant'], memberships: [] }),
    });
    await assert.rejects(
      () => plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH),
      (error: unknown) => codeOf(error) === 'ORGANIZATION_REQUIRED',
    );
  });

  it('marks an explicitly enabled single-tenant default as unverified in audit', async () => {
    const { plane } = buildTestPlane({
      env: { AI_ALLOW_DEFAULT_ORGANIZATION: 'true' },
      authenticator: stubAuthenticator(TEST_TOKEN, { roles: ['consultant'], memberships: [] }),
    });
    await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    const [record] = plane.recentAudit(1);
    assert.equal(record.organizationMembershipVerified, false);
  });
});

// ── H6 — correlation and request tracing ────────────────────────────────────

describe('H6 — one trace id survives the full path', () => {
  it('returns the caller correlation id on success, in body and headers', async () => {
    const { plane } = buildTestPlane();
    const response = await executeAIHttpRequest(plane, {
      featureId: FEATURE.narrative,
      body: narrativeInput(),
      authorization: `Bearer ${TEST_TOKEN}`,
      correlationId: 'trace-abc-123',
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.correlationId, 'trace-abc-123');
    assert.equal(response.headers['X-Correlation-Id'], 'trace-abc-123');
    assert.equal(response.headers['X-Request-Id'], response.body.requestId);
  });

  it('returns a usable requestId on a FAILED request', async () => {
    // The defect: the failure path returned requestId '', so the one identifier
    // a support engineer needs to find the audit record did not survive.
    const { plane } = buildTestPlane();
    const response = await executeAIHttpRequest(plane, {
      featureId: FEATURE.blockAssist,
      body: { block_id: '', block_type: '', title: '', current_content: {}, action: 'ai_improve' },
      authorization: `Bearer ${TEST_TOKEN}`,
      correlationId: 'trace-fail-1',
    });
    assert.equal(response.status >= 400, true);
    assert.notEqual(response.body.requestId, '');
    assert.equal(response.body.correlationId, 'trace-fail-1');
    assert.equal(response.headers['X-Correlation-Id'], 'trace-fail-1');
  });

  it('mints a correlation id when a pre-guard failure has none', async () => {
    const { plane } = buildTestPlane();
    const response = await executeAIHttpRequest(plane, {
      featureId: 'cortex.does_not_exist',
      body: {},
      authorization: `Bearer ${TEST_TOKEN}`,
    });
    assert.equal(response.status, 404);
    assert.match(String(response.body.correlationId), /^cor_/);
    assert.notEqual(response.body.requestId, '');
  });

  it('links the returned requestId to the audit record', async () => {
    const { plane } = buildTestPlane();
    const response = await executeAIHttpRequest(plane, {
      featureId: FEATURE.narrative,
      body: narrativeInput(),
      authorization: `Bearer ${TEST_TOKEN}`,
      correlationId: 'trace-join-1',
    });
    const [record] = plane.recentAudit(1);
    assert.equal(record.requestId, response.body.requestId);
    assert.equal(record.correlationId, 'trace-join-1');
  });

  it('refuses an oversized or unsafe inbound trace header', () => {
    const oversized = 'a'.repeat(500);
    assert.equal(correlationIdFromHeaders(() => oversized), undefined);
    assert.equal(correlationIdFromHeaders(() => 'bad id\nwith newline'), undefined);
    assert.equal(correlationIdFromHeaders(() => 'trace-ok-1'), 'trace-ok-1');
  });
});

// ── H7 — durable audit ──────────────────────────────────────────────────────

describe('H7 — one terminal audit record per governed request', () => {
  it('records exactly one record for a success', async () => {
    const { plane } = buildTestPlane();
    await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    assert.equal(plane.recentAudit(50).length, 1);
  });

  it('records a failure with the attempts it actually made', async () => {
    // The defect: the failure path hardcoded `attempts: 0`, so a request that
    // burned two provider attempts and then failed was recorded as having made
    // none.
    const { plane, provider, backup } = buildTestPlane();
    provider.setScenario('unavailable');
    backup.setScenario('unavailable');

    await assert.rejects(() => plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH));

    const [record] = plane.recentAudit(1);
    assert.equal(record.outcome, 'failure');
    assert.ok(record.attempts > 0, `expected recorded attempts, got ${record.attempts}`);
    assert.equal(record.attempts, provider.calls.length + backup.calls.length);
    assert.ok(record.failedProviders.length > 0);
    assert.ok(record.errorCode);
  });

  it('records a guard rejection with its policy decision', async () => {
    const { plane } = buildTestPlane({
      authenticator: stubAuthenticator(TEST_TOKEN, {
        roles: ['viewer'],
        memberships: [{ organizationId: 'acme', roles: ['viewer'] }],
      }),
    });
    await assert.rejects(() => plane.execute(envelope(FEATURE.blockAssist, blockAssistBody()), AUTH));
    const [record] = plane.recentAudit(1);
    assert.equal(record.outcome, 'failure');
    assert.equal(record.errorCode, 'CAPABILITY_DENIED');
    assert.ok(record.policyRulesEvaluated.includes('capability.granted'));
  });

  it('stores digests, never raw prompt or completion text', async () => {
    const { plane } = buildTestPlane();
    await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    const [record] = plane.recentAudit(1);

    assert.match(record.inputDigest ?? '', /^[0-9a-f]{64}$/);
    assert.match(record.outputDigest ?? '', /^[0-9a-f]{64}$/);

    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes('Deterministic mock narrative'), false, 'completion text stored');
    assert.equal(serialized.includes('Acme Industrial'), false, 'prompt content stored');
  });

  it('carries prompt provenance on every record', async () => {
    const { plane } = buildTestPlane();
    await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    const [record] = plane.recentAudit(1);
    assert.equal(record.promptId, 'narrative.why_now');
    assert.ok(record.promptVersion);
    assert.match(record.promptHash ?? '', /^sha256:/);
  });
});

// ── B8 — safe external errors ───────────────────────────────────────────────

describe('B8 — provider detail never reaches a client', () => {
  it('omits diagnostics from the HTTP error body', async () => {
    const { plane, provider, backup } = buildTestPlane();
    provider.setScenario('unavailable');
    backup.setScenario('unavailable');

    const response = await executeAIHttpRequest(plane, {
      featureId: FEATURE.narrative,
      body: narrativeInput(),
      authorization: `Bearer ${TEST_TOKEN}`,
    });

    const serialized = JSON.stringify(response.body);
    assert.equal('diagnostics' in response.body, false);
    for (const leak of ['api.openai.com', 'api.anthropic.com', 'sk-', 'Authorization']) {
      assert.equal(serialized.includes(leak), false, `error body leaked ${leak}`);
    }
    assert.ok(response.body.code, 'a stable machine code is still returned');
  });

  it('keeps a raw throwable message out of the response but in diagnostics', () => {
    const error = new AIError('INTERNAL_ERROR', 'AI request failed.', {
      diagnostics: 'Error: connect ECONNREFUSED api.openai.com:443 key=sk-live-abc',
    });
    const body = JSON.stringify(error.toResponseBody('req-1', 'cor-1'));
    assert.equal(body.includes('sk-live-abc'), false);
    assert.equal(body.includes('api.openai.com'), false);
    assert.ok(error.diagnostics?.includes('sk-live-abc'), 'detail is retained server-side');
  });
});

// ── H3 / H5 — provider eligibility and failover ─────────────────────────────

describe('H3/H5 — provider eligibility', () => {
  function selectorWith(options: {
    realRequests: boolean;
    requireCertification: boolean;
    certification?: 'unverified' | 'certified';
    billable?: boolean;
  }) {
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, {
      failureThreshold: 2,
      openMs: 1_000,
      halfOpenSuccessesToClose: 1,
    });
    const registry = createProviderRegistry(clock, circuit);
    registry.register(
      createMockProvider({ providerId: 'vendor', billable: options.billable ?? true }),
      { certification: options.certification ?? 'certified' },
    );
    const selector = createProviderSelector(registry, circuit, {
      preference: ['vendor'],
      failoverEnabled: true,
      realRequestsEnabled: options.realRequests,
      requireCertification: options.requireCertification,
    });
    return { selector, registry, circuit, clock };
  }

  const REQUIREMENTS = { structuredOutput: false, chatCompletions: true, minOutputTokens: 100 };

  it('refuses a billable provider while the kill switch is off', () => {
    const { selector } = selectorWith({ realRequests: false, requireCertification: false });
    assert.throws(
      () => selector.select(REQUIREMENTS),
      (error: unknown) => codeOf(error) === 'NO_PROVIDER_AVAILABLE',
    );
    assert.match(
      selector.explain(REQUIREMENTS).vendor,
      /AI_ALLOW_REAL_REQUESTS/,
      'the health report must name the kill switch as the reason',
    );
  });

  it('admits a non-billable provider while the kill switch is off', () => {
    const { selector } = selectorWith({
      realRequests: false,
      requireCertification: false,
      billable: false,
    });
    assert.equal(selector.select(REQUIREMENTS).length, 1);
  });

  it('refuses an uncertified provider when certification is required', () => {
    const { selector } = selectorWith({
      realRequests: true,
      requireCertification: true,
      certification: 'unverified',
    });
    assert.equal(selector.explain(REQUIREMENTS).vendor, 'certification not established');
  });

  it('skips a provider whose circuit is open', () => {
    const { selector, circuit } = selectorWith({ realRequests: true, requireCertification: false });
    circuit.recordFailure('vendor');
    circuit.recordFailure('vendor');
    assert.equal(selector.explain(REQUIREMENTS).vendor, 'circuit open');
  });

  it('fails over from a broken primary to a healthy secondary', async () => {
    const { plane, provider, backup } = buildTestPlane();
    provider.setScenario('unavailable');

    const result = await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
    assert.equal(result.execution.providerId, 'backup');
    assert.ok(result.execution.failedProviders.includes('primary'));
    assert.ok(backup.calls.length > 0);
  });

  it('reports every attempt when both providers fail', async () => {
    const { plane, provider, backup } = buildTestPlane();
    provider.setScenario('unavailable');
    backup.setScenario('unavailable');

    await assert.rejects(() => plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH));
    const [record] = plane.recentAudit(1);
    assert.deepEqual([...record.failedProviders].sort(), ['backup', 'primary']);
  });
});

// ── H10 — retry policy ──────────────────────────────────────────────────────

describe('H10 — retry honours Retry-After', () => {
  const OPTIONS = { baseDelayMs: 100, maxDelayMs: 30_000, jitterPercent: 0 };

  it('uses the provider stated delay over computed backoff', () => {
    const retry = createRetryScheduler(() => Promise.resolve(), () => 0);
    // Computed backoff for attempt 2 is 100ms. The provider asked for 5s.
    assert.equal(retry.delayFor(2, OPTIONS), 100);
    assert.equal(retry.delayFor(2, OPTIONS, 5), 5_000);
  });

  it('bounds an unreasonable Retry-After by the maximum delay', () => {
    const retry = createRetryScheduler(() => Promise.resolve(), () => 0);
    assert.equal(retry.delayFor(2, OPTIONS, 3_600), OPTIONS.maxDelayMs);
  });

  it('never waits before the first attempt', () => {
    const retry = createRetryScheduler(() => Promise.resolve(), () => 0);
    assert.equal(retry.delayFor(1, OPTIONS, 60), 0);
  });
});

// ── H9 — cost-weighted rate limiting ────────────────────────────────────────

describe('H9 — rate limits are cost weighted', () => {
  const RULE = { limit: 8, windowMs: 60_000 };

  it('charges a heavy request more of the window than a cheap one', () => {
    const clock = createTestClock();
    const limiter = createSlidingWindowRateLimiter(clock);

    // Two heavy requests at cost 4 exhaust an 8-unit window; two cheap ones
    // would not have come close.
    assert.equal(limiter.consume('heavy', RULE, 4).allowed, true);
    assert.equal(limiter.consume('heavy', RULE, 4).allowed, true);
    assert.equal(limiter.consume('heavy', RULE, 1).allowed, false);

    assert.equal(limiter.consume('cheap', RULE, 1).remaining, 7);
  });

  it('defaults to one unit when no cost is given', () => {
    const clock = createTestClock();
    const limiter = createSlidingWindowRateLimiter(clock);
    assert.equal(limiter.consume('scope', RULE).remaining, 7);
  });

  it('stops a rate-limited request before any provider call', async () => {
    const { plane, provider } = buildTestPlane();
    let rejected: AIError | undefined;
    for (let i = 0; i < 60 && !rejected; i += 1) {
      try {
        await plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH);
      } catch (error) {
        if (codeOf(error) === 'RATE_LIMITED') rejected = error as AIError;
        else throw error;
      }
    }
    assert.ok(rejected, 'expected the actor limit to engage');
    const callsAtRejection = provider.calls.length;
    await assert.rejects(
      () => plane.execute(envelope(FEATURE.narrative, narrativeInput()), AUTH),
      (error: unknown) => codeOf(error) === 'RATE_LIMITED',
    );
    assert.equal(provider.calls.length, callsAtRejection, 'a rejected request reached a provider');
  });
});

// ── H2 — fact lock through the governed path ────────────────────────────────

describe('H2 — fact lock is enforced end to end', () => {
  it('restores commercial terms the model rewrote', async () => {
    const { plane, provider } = buildTestPlane();

    const result = await plane.execute<{ proposed_content: Record<string, unknown> }>(
      envelope(FEATURE.sectionCopilot, sectionCopilotInput()),
      AUTH,
    );

    assert.equal(result.output.proposed_content.price, 12_000);
    assert.equal(result.output.proposed_content.currency, 'USD');
    assert.ok(result.governance.factLockRestored.length > 0);
  });

  it('prefers locked_facts over the caller current_content echo', async () => {
    const { plane, provider } = buildTestPlane();

    const result = await plane.execute<{ proposed_content: Record<string, unknown> }>(
      envelope(
        FEATURE.sectionCopilot,
        sectionCopilotInput({
          // A caller trying to move the price by editing the echo.
          current_content: {
            offer_name: 'Diagnostic Audit',
            price: 1,
            currency: 'USD',
            duration: 'Days 1-10',
          },
          context: {
            company: 'Acme Industrial',
            locked_facts: { price: 12_000, currency: 'USD', duration: 'Days 1-10' },
          },
        }),
      ),
      AUTH,
    );

    assert.equal(result.output.proposed_content.price, 12_000, 'the explicit authority must win');
  });

  it('records the enforcement on the audit record', async () => {
    const { plane, provider } = buildTestPlane();
    await plane.execute(envelope(FEATURE.sectionCopilot, sectionCopilotInput()), AUTH);
    const [record] = plane.recentAudit(1);
    assert.ok(record.factLockRestored.length > 0);
  });
});

// ── B6 — PII redaction before egress ────────────────────────────────────────

describe('B6 — PII is redacted before the adapter sees it', () => {
  it('removes an email from the prompt the provider receives', async () => {
    const { plane, provider } = buildTestPlane();
    await plane.execute(
      envelope(
        FEATURE.chat,
        {
          message: 'Email the summary to consultant@acme-client.com and call +44 20 7946 0958.',
          history: [],
        },
      ),
      AUTH,
    );

    assert.equal(provider.calls.length, 1);
    const sent = JSON.stringify(provider.calls[0].generation.messages);
    assert.equal(sent.includes('consultant@acme-client.com'), false, 'email reached the provider');
    assert.ok(sent.includes('[REDACTED_EMAIL]'), 'redaction placeholder is absent');
  });

  it('records which categories were removed without recording the values', async () => {
    const { plane } = buildTestPlane();
    await plane.execute(
      envelope(FEATURE.chat, { message: 'Reach me at consultant@acme-client.com', history: [] }),
      AUTH,
    );
    const [record] = plane.recentAudit(1);
    assert.ok(record.redactedCategories.includes('email'));
    assert.equal(JSON.stringify(record).includes('acme-client.com'), false);
  });
});
