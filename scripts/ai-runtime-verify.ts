/**
 * AI-01 Batch 1 runtime verification — mock mode.
 *
 * Drives a real control plane through every scenario the remediation is
 * required to demonstrate, and prints a pass/fail line per scenario. This is a
 * runtime check, not a unit test: it assembles the plane the way production
 * does (via `createControlPlane`) and goes in through the HTTP adapter, so what
 * it exercises is the request path a browser would take.
 *
 * SAFETY. The plane is built with the mock adapter only and
 * `AI_ALLOW_REAL_REQUESTS=false`, so no vendor endpoint is contacted and the
 * MARQ spend ledger is never touched. The final scenario asserts exactly that.
 *
 *   node --experimental-strip-types scripts/ai-runtime-verify.ts
 */

import { createControlPlane } from '../supabase/functions/server/ai/controlPlane.ts';
import { executeAIHttpRequest } from '../supabase/functions/server/ai/http/httpAdapter.ts';
import { loadControlPlaneConfig } from '../supabase/functions/server/ai/runtime/config.ts';
import { recordEnv } from '../supabase/functions/server/ai/runtime/env.ts';
import { createMockProvider } from '../supabase/functions/server/ai/providers/mockProvider.ts';
import { createTestClock } from '../supabase/functions/server/ai/runtime/clock.ts';
import { createMemorySpendStore, createSpendLedger, SPEND_SCOPE, usdToMicroUsd } from '../supabase/functions/server/ai/policy/spendLedger.ts';
import { FEATURE } from '../supabase/functions/server/ai/features/index.ts';
import type { AIAuthenticator, AuthenticatedSubject } from '../supabase/functions/server/ai/security/actor.ts';

const TOKEN = 'runtime-verify-token';
const results: { scenario: string; ok: boolean; detail: string }[] = [];

function check(scenario: string, ok: boolean, detail: string): void {
  results.push({ scenario, ok, detail });
}

function authenticator(subject: Partial<AuthenticatedSubject> = {}): AIAuthenticator {
  const resolved: AuthenticatedSubject = {
    subjectId: 'user-verify',
    email: 'consultant@marq.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [{ organizationId: 'acme', slug: 'acme', tier: 'enterprise', roles: ['consultant'] }],
    ...subject,
  };
  return {
    authenticate: (authorization) =>
      Promise.resolve(authorization === `Bearer ${TOKEN}` ? resolved : null),
  };
}

function buildPlane(env: Record<string, string> = {}, auth = authenticator()) {
  const clock = createTestClock();
  const provider = createMockProvider({ providerId: 'primary', priority: 1 });
  const backup = createMockProvider({ providerId: 'backup', priority: 2 });
  const spendStore = createMemorySpendStore();
  const config = loadControlPlaneConfig(
    recordEnv({
      AI_PROVIDER_PREFERENCE: 'primary,backup',
      AI_RETRY_BASE_DELAY_MS: '0',
      AI_DEFAULT_ORGANIZATION_ID: 'acme',
      ...env,
    }),
  );
  const plane = createControlPlane({
    config,
    authenticator: auth,
    providers: [
      { adapter: provider, certification: 'certified' },
      { adapter: backup, certification: 'certified' },
    ],
    spendStore,
    clock,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  return { plane, provider, backup, clock, spendStore, config };
}

const NARRATIVE_INPUT = {
  type: 'why_now',
  context: {
    company: 'Acme Industrial',
    industry: 'Manufacturing',
    employee_estimate: 240,
    current_version: 'v3',
    assumptions: { support_tickets_per_week: 180, monthly_revenue: 950_000 },
    top_recommendation: {
      problem_title: 'Manual intake handoffs',
      severity_score: 8,
      confidence_score: 72,
      priority_score: { impact_score: 9, feasibility_score: 7, risk_score: 3, computed_priority: 8.1 },
      why_first: 'Constraint resolution precedes optimisation.',
    },
    recommendation_count: 5,
  },
};

const SECTION_INPUT = {
  section: 'next_step_offer',
  section_label: 'Next Step Offer',
  action: 'improve',
  current_content: { offer_name: 'Diagnostic Audit', price: 12_000, currency: 'USD', duration: 'Days 1-10' },
  context: { company: 'Acme Industrial' },
};

const http = (featureId: string, body: unknown, authorization: string | null, extra = {}) => ({
  featureId,
  body,
  authorization,
  ...extra,
});

async function run(): Promise<void> {
  // 1 — authenticated request succeeds
  {
    const { plane, provider } = buildPlane();
    const response = await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
    check(
      'authenticated AI request succeeds',
      response.status === 200 && response.body.success === true && provider.calls.length === 1,
      `status=${response.status} providerCalls=${provider.calls.length}`,
    );
  }

  // 2 — unauthenticated request fails, no provider call
  {
    const { plane, provider, backup } = buildPlane();
    const response = await executeAIHttpRequest(plane, http(FEATURE.blockAssist, {}, null));
    check(
      'unauthenticated request fails with zero provider calls',
      response.status === 401 && provider.calls.length === 0 && backup.calls.length === 0,
      `status=${response.status} code=${response.body.code} providerCalls=${provider.calls.length + backup.calls.length}`,
    );
  }

  // 3 — unauthorized role fails
  {
    const { plane, provider } = buildPlane(
      {},
      authenticator({ globalRoles: ['viewer'], memberships: [{ organizationId: 'acme', roles: ['viewer'] }] }),
    );
    const response = await executeAIHttpRequest(
      plane,
      http(
        FEATURE.blockAssist,
        {
          block_id: 'b1',
          block_type: 'proposal_executive_brief',
          title: 'Brief',
          current_content: { text: 'x' },
          action: 'ai_improve',
          context: { company: 'Acme' },
        },
        `Bearer ${TOKEN}`,
      ),
    );
    check(
      'unauthorized role fails',
      response.status === 403 && response.body.code === 'CAPABILITY_DENIED' && provider.calls.length === 0,
      `status=${response.status} code=${response.body.code}`,
    );
  }

  // 4 — cross-tenant request fails
  {
    const { plane, provider } = buildPlane();
    const response = await executeAIHttpRequest(
      plane,
      http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`, { organizationHint: 'globex' }),
    );
    check(
      'cross-tenant request fails',
      response.status === 403 && response.body.code === 'ORGANIZATION_NOT_RESOLVED' && provider.calls.length === 0,
      `status=${response.status} code=${response.body.code}`,
    );
  }

  // 5 — PII redacted before the adapter sees it
  {
    const { plane, provider } = buildPlane();
    await executeAIHttpRequest(
      plane,
      http(FEATURE.chat, { message: 'Send it to consultant@acme-client.com', history: [] }, `Bearer ${TOKEN}`),
    );
    const sent = JSON.stringify(provider.calls[0]?.generation.messages ?? []);
    check(
      'PII is redacted before the adapter sees input',
      !sent.includes('consultant@acme-client.com') && sent.includes('[REDACTED_EMAIL]'),
      sent.includes('[REDACTED_EMAIL]') ? 'email replaced with placeholder' : 'NO REDACTION OBSERVED',
    );
  }

  // 6 — budget reservation and recording
  {
    const store = createMemorySpendStore();
    const ledger = createSpendLedger({ store, capMicroUsd: usdToMicroUsd(9), now: () => new Date().toISOString() });
    const decision = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(2), 'verify-1');
    const reserved = decision.granted ? (await ledger.read(SPEND_SCOPE.platform)).reservedMicroUsd : -1;
    if (decision.granted) await ledger.settle(decision.reservation, usdToMicroUsd(2));
    const after = await ledger.read(SPEND_SCOPE.platform);
    check(
      'budget reservation and recording work',
      reserved === usdToMicroUsd(2) && after.spentMicroUsd === usdToMicroUsd(2) && after.reservedMicroUsd === 0,
      `reserved=${reserved} settled=${after.spentMicroUsd} outstanding=${after.reservedMicroUsd}`,
    );
  }

  // 7 — exact $9 cap stops execution
  {
    const store = createMemorySpendStore();
    const ledger = createSpendLedger({ store, capMicroUsd: usdToMicroUsd(9), now: () => new Date().toISOString() });
    const fill = await ledger.reserve(SPEND_SCOPE.platform, usdToMicroUsd(9), 'verify-fill');
    if (fill.granted) await ledger.settle(fill.reservation, usdToMicroUsd(9));
    const record = await ledger.read(SPEND_SCOPE.platform);
    const next = await ledger.reserve(SPEND_SCOPE.platform, 1, 'verify-next');
    check(
      'exact $9 cap stops execution',
      record.spentMicroUsd === usdToMicroUsd(9) && !next.granted,
      `spent=$${(record.spentMicroUsd / 1e6).toFixed(2)} nextGranted=${next.granted}`,
    );
  }

  // 8 — rate limit stops execution before a provider call
  {
    const { plane, provider } = buildPlane();
    let limited: Record<string, unknown> | undefined;
    for (let i = 0; i < 80 && !limited; i += 1) {
      const response = await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
      if (response.status === 429) limited = response.body;
    }
    const callsAtLimit = provider.calls.length;
    const after = await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
    check(
      'rate limit stops execution',
      limited !== undefined && after.status === 429 && provider.calls.length === callsAtLimit,
      `code=${limited?.code} callsAfterLimit=${provider.calls.length - callsAtLimit}`,
    );
  }

  // 9 — provider failover
  {
    const { plane, provider, backup } = buildPlane();
    provider.setScenario('unavailable');
    const response = await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
    const meta = response.body.meta as Record<string, unknown> | undefined;
    check(
      'provider failover works',
      response.status === 200 && meta?.provider === 'backup' && backup.calls.length > 0,
      `served by ${String(meta?.provider)} after ${provider.calls.length} primary attempt(s)`,
    );
  }

  // 10 — circuit breaker opens and recovers
  {
    const { plane, provider, backup, clock } = buildPlane({ AI_CIRCUIT_FAILURE_THRESHOLD: '2', AI_CIRCUIT_OPEN_MS: '1000' });
    provider.setScenario('unavailable');
    for (let i = 0; i < 3; i += 1) {
      await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
    }
    const opened = plane.health().providers.find((p) => p.providerId === 'primary')?.circuit;

    provider.setScenario(undefined);
    clock.advance(1_500);
    const halfOpen = plane.health().providers.find((p) => p.providerId === 'primary')?.circuit;

    // Two successful probes, because the default requires two consecutive
    // successes to close. One probe leaves it half-open, which is correct
    // behaviour but is not recovery.
    await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
    await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
    const recovered = plane.health().providers.find((p) => p.providerId === 'primary')?.circuit;

    check(
      'circuit breaker opens and recovers',
      opened === 'open' && halfOpen === 'half_open' && recovered === 'closed',
      `open→${opened} afterCooldown→${halfOpen} afterTwoProbes→${recovered} (backup absorbed ${backup.calls.length} while open)`,
    );
  }

  // 11 — output validation rejects malformed output
  {
    const { plane } = buildPlane();
    const response = await executeAIHttpRequest(
      plane,
      http(
        FEATURE.sectionCopilot,
        { ...SECTION_INPUT, section_label: 'Next Step Offer [[scenario:invalid_json]]' },
        `Bearer ${TOKEN}`,
      ),
    );
    check(
      'output validation rejects malformed output',
      response.status >= 400 && response.body.success !== true,
      `status=${response.status} code=${response.body.code}`,
    );
  }

  // 12 — fact lock prevents protected-field manipulation
  {
    const { plane } = buildPlane();
    const response = await executeAIHttpRequest(
      plane,
      http(
        FEATURE.sectionCopilot,
        {
          ...SECTION_INPUT,
          current_content: { offer_name: 'Diagnostic Audit', price: 1, currency: 'USD', duration: 'Days 1-10' },
          context: { company: 'Acme Industrial', locked_facts: { price: 12_000, currency: 'USD' } },
        },
        `Bearer ${TOKEN}`,
      ),
    );
    const proposed = response.body.proposed_content as Record<string, unknown> | undefined;
    check(
      'fact lock prevents protected-field manipulation',
      response.status === 200 && proposed?.price === 12_000,
      `price returned as ${String(proposed?.price)} (authority said 12000, caller echo said 1)`,
    );
  }

  // 13 — audit record persists, for a success and for a post-guard failure
  {
    const { plane } = buildPlane();
    await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
    // A cross-tenant attempt fails AFTER the guard has produced an identity, so
    // unlike an unauthenticated request it has an actor and organization to
    // audit against. Pre-guard rejections are counted and logged instead —
    // there is no identity to attribute them to.
    await executeAIHttpRequest(
      plane,
      http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`, { organizationHint: 'globex' }),
    );
    const records = plane.recentAudit(10);
    const success = records.find((r) => r.outcome === 'success');
    const failure = records.find((r) => r.outcome === 'failure');
    const raw = JSON.stringify(records);
    check(
      'audit record persists for success and post-guard failure',
      success !== undefined &&
        failure !== undefined &&
        !raw.includes('Deterministic mock narrative') &&
        !raw.includes('Acme Industrial'),
      `${records.length} record(s): success=${success?.requestId ? 'yes' : 'no'} failure=${failure?.errorCode ?? 'none'}; digests only`,
    );
  }

  // 14 — correlation id returns to the client
  {
    const { plane } = buildPlane();
    const ok = await executeAIHttpRequest(
      plane,
      http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`, { correlationId: 'runtime-trace-1' }),
    );
    const failed = await executeAIHttpRequest(
      plane,
      http(FEATURE.blockAssist, {}, null, { correlationId: 'runtime-trace-2' }),
    );
    check(
      'correlation ID returns to the client on success and failure',
      ok.body.correlationId === 'runtime-trace-1' &&
        failed.body.correlationId === 'runtime-trace-2' &&
        String(ok.body.requestId).length > 0 &&
        String(failed.body.requestId).length > 0,
      `success=${ok.body.correlationId} failure=${failed.body.correlationId}`,
    );
  }

  // 15 — health endpoint reports accurate state
  {
    const { plane } = buildPlane();
    const health = plane.health();
    check(
      'health endpoint reports accurate state',
      health.status === 'degraded' && health.issues.some((issue) => issue.includes('synthetic')),
      `status=${health.status} — mock-only must be degraded, never healthy`,
    );
  }

  // 16 — no real provider request occurs
  {
    const { plane, config } = buildPlane();
    await executeAIHttpRequest(plane, http(FEATURE.narrative, NARRATIVE_INPUT, `Bearer ${TOKEN}`));
    const spend = await plane.spendStatus();
    check(
      'no real provider request occurs and the MARQ ledger is untouched',
      config.allowRealRequests === false && spend.spentMicroUsd === 0 && spend.reservedMicroUsd === 0,
      `allowRealRequests=${config.allowRealRequests} spent=${spend.spentMicroUsd} reserved=${spend.reservedMicroUsd}`,
    );
  }
}

await run();

const width = Math.max(...results.map((r) => r.scenario.length));
console.log('\nAI-01 Batch 1 — runtime verification (mock mode)\n');
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.scenario.padEnd(width)}  ${result.detail}`);
}
const failures = results.filter((result) => !result.ok);
console.log(`\n${results.length - failures.length}/${results.length} scenarios passed.`);
process.exit(failures.length === 0 ? 0 : 1);
