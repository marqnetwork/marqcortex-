/**
 * The Anthropic adapter, driven through the whole governed path (AI-01 Batch 4B).
 *
 * Batch 4A proved the paid sequence for OpenAI. This suite is the SAME sequence
 * for Anthropic, and it exists to answer one question with evidence rather than
 * with architecture diagrams: does a second paid vendor participate in the
 * platform's governance, or does it merely coexist with it?
 *
 *   guard → policy → spend reservation → selection admits a billable provider →
 *   Anthropic adapter → reported usage → metered cost → spend ledger settlement
 *   → daily budget → audit attribution
 *
 * Nothing here is an Anthropic-specific code path, and that is the finding the
 * suite records. Every assertion below runs against the production registry,
 * selector, spend guard, ledger, budget engine, retry scheduler, circuit
 * breaker, audit writer and administration service. The ONLY substitution is
 * the adapter's injected `fetch`, so a green run means the failure modes left
 * for a live Anthropic proof are the vendor and the credential — not this
 * platform's wiring.
 *
 * Two assertions here are about the OTHER providers, deliberately. Certifying a
 * second billable vendor is not only a question of whether the new one works;
 * it is a question of what registering it did to the platform that was already
 * certified. See "the certified OpenAI baseline" at the bottom.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlane } from '../controlPlane.ts';
import { createAIAdministration } from '../admin/administration.ts';
import { createMemorySettingsStore } from '../admin/settingsStore.ts';
import { executeAIHttpRequest } from '../http/httpAdapter.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createMemorySink } from '../observability/logger.ts';
import { createCircuitBreaker } from '../providers/circuitBreaker.ts';
import { createProviderRegistry } from '../providers/registry.ts';
import { createAnthropicProvider } from '../providers/anthropicProvider.ts';
import { createOpenAIProvider, type FetchLike } from '../providers/openaiProvider.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createMemorySpendStore } from '../policy/spendLedger.ts';
import { withTimeout } from '../providers/timeout.ts';
import { AIError } from '../contracts/errors.ts';
import { FEATURE } from '../features/index.ts';
import type { AIAuthenticator, AuthenticatedSubject } from '../security/actor.ts';
import type { AIProviderInvocation } from '../contracts/provider.ts';

const ORGANIZATION_ID = 'marq-batch-4b-proof';
const PROVIDER_ID = 'anthropic';
/** The one model the certified Anthropic catalogue declares. */
const MODEL_ID = 'claude-haiku-4-5-20251001';
/** Declared by the adapter in Batch 1 and withdrawn from the catalogue in 4B. */
const UNCERTIFIED_MODEL_ID = 'claude-sonnet-4-5-20250929';
const CALLER_TOKEN = 'batch4b-caller';
const OPERATOR_TOKEN = 'batch4b-operator';

/** A placeholder credential. The transport below never leaves the process. */
const CREDENTIAL_ENV = recordEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-batch4b' });
const OPENAI_CREDENTIAL_ENV = recordEnv({ OPENAI_API_KEY: 'sk-test-batch4b' });

const PROMPT = 'Reply with exactly the two characters: OK';
const COMPLETION = 'OK';

/** Reported usage for the stubbed completion. Priced by the registry, not here. */
const USAGE = { input_tokens: 42, output_tokens: 3 };

/**
 * The metered cost Haiku 4.5's published rates imply for that usage:
 * 42 × 1,000/1000 + 3 × 5,000/1000 = 42 + 15 = 57 µUSD.
 *
 * Written out rather than computed from the descriptor, because a test that
 * derives the expected cost the same way the code does asserts nothing about
 * whether either is right.
 */
const EXPECTED_COST_MICRO_USD = 57;

/**
 * The pessimistic hold the spend guard takes for one chat request when
 * Anthropic is the only billable provider registered.
 *
 * 65,536 input bytes ÷ 4 = 16,384 prompt tokens at 1,000 µUSD/1k = 16,384.
 * 1,200 completion tokens at 5,000 µUSD/1k = 6,000. Times the feature's
 * 2-attempt allowance: (16,384 + 6,000) × 2 = 44,768 µUSD.
 */
const ANTHROPIC_ONLY_RESERVATION_MICRO_USD = 44_768;

/**
 * The same hold when OpenAI is registered, whose gpt-4o is dearer:
 * (16,384 × 2,500/1000 + 1,200 × 10,000/1000) × 2 = 105,920 µUSD.
 *
 * This is the figure the certified Batch 4A ceiling was proved against, and the
 * suite pins it BOTH with and without Anthropic registered.
 */
const OPENAI_BASELINE_RESERVATION_MICRO_USD = 105_920;

const SUBJECTS: Readonly<Record<string, AuthenticatedSubject>> = {
  [CALLER_TOKEN]: {
    subjectId: 'proof-caller',
    email: 'proof@marq.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [{ organizationId: ORGANIZATION_ID, tier: 'internal', roles: ['consultant'] }],
  },
  [OPERATOR_TOKEN]: {
    subjectId: 'proof-operator',
    email: 'ops@marq.test',
    actorType: 'team_user',
    globalRoles: ['super_admin'],
    memberships: [{ organizationId: ORGANIZATION_ID, tier: 'internal', roles: ['owner'] }],
  },
};

const authenticator: AIAuthenticator = {
  authenticate: (authorization) => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    return Promise.resolve(token === undefined ? null : SUBJECTS[token] ?? null);
  },
};

// ── Vendor transport doubles ────────────────────────────────────────────────

function anthropicSuccess(): Response {
  return Response.json({
    model: MODEL_ID,
    content: [{ type: 'text', text: COMPLETION }],
    usage: USAGE,
    stop_reason: 'end_turn',
  });
}

interface OutboundCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/** A transport that plays a scripted sequence, repeating its last response. */
function scriptedFetch(
  outbound: OutboundCall[],
  responses: readonly (() => Response)[],
): FetchLike {
  let index = 0;
  return (url, init) => {
    outbound.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(next());
  };
}

// ── Plane assembly ──────────────────────────────────────────────────────────

interface ProofPlane {
  readonly outbound: OutboundCall[];
  readonly logs: { level: string; line: string }[];
  readonly plane: ReturnType<typeof createControlPlane>;
  readonly admin: ReturnType<typeof createAIAdministration>;
}

interface ProofOptions {
  /** Environment overrides, applied over the proof defaults. */
  readonly env?: Record<string, string>;
  /** Scripted vendor responses. Defaults to one success, repeated. */
  readonly responses?: readonly (() => Response)[];
  /** Withhold the Anthropic credential, to prove the unconfigured path. */
  readonly withoutCredentials?: boolean;
  /** Also register the certified OpenAI adapter, with its own credential. */
  readonly withOpenAI?: boolean;
}

function buildProofPlane(options: ProofOptions = {}): ProofPlane {
  const outbound: OutboundCall[] = [];
  const fetchImpl = scriptedFetch(outbound, options.responses ?? [anthropicSuccess]);

  const config = loadControlPlaneConfig(
    recordEnv({
      AI_ALLOW_REAL_REQUESTS: 'true',
      AI_PROVIDER_PREFERENCE: 'anthropic,openai,mock',
      // The proof reaches Anthropic or it fails. Failing over to the mock would
      // let a synthetic completion be reported as a paid provider's answer.
      AI_FAILOVER_ENABLED: 'false',
      AI_MAX_SPEND_USD: '0.25',
      AI_DEFAULT_ORGANIZATION_ID: ORGANIZATION_ID,
      AI_ORGANIZATION_ALLOW_LIST: ORGANIZATION_ID,
      AI_ALLOW_DEFAULT_ORGANIZATION: 'false',
      AI_LOG_LEVEL: 'debug',
      AI_RETRY_BASE_DELAY_MS: '0',
      ...options.env,
    }),
  );

  const sink = createMemorySink();
  const settingsStore = createMemorySettingsStore();
  const clock = createTestClock();

  const providers: Parameters<typeof createControlPlane>[0]['providers'][number][] = [
    {
      adapter: createAnthropicProvider({
        env: options.withoutCredentials ? recordEnv({}) : CREDENTIAL_ENV,
        fetchImpl,
      }),
      certification: 'certified',
    },
  ];
  if (options.withOpenAI) {
    providers.push({
      adapter: createOpenAIProvider({
        env: OPENAI_CREDENTIAL_ENV,
        fetchImpl: (url, init) => {
          outbound.push({ url: String(url), body: JSON.parse(String(init.body)) });
          return Promise.resolve(
            Response.json({
              model: 'gpt-4o-mini',
              choices: [{ message: { content: COMPLETION }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 42, completion_tokens: 3, total_tokens: 45 },
            }),
          );
        },
      }),
      certification: 'certified',
    });
  }
  providers.push({ adapter: createMockProvider(), certification: 'testing' });

  const plane = createControlPlane({
    config,
    authenticator,
    providers,
    spendStore: createMemorySpendStore(),
    settingsSource: settingsStore,
    clock,
    ids: createSequentialIdFactory(),
    logSink: sink,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });

  const admin = createAIAdministration({
    plane,
    authenticator,
    settingsStore,
    clock,
    ids: createSequentialIdFactory('adm'),
    logger: plane.logger,
  });

  return { outbound, logs: sink.lines, plane, admin };
}

function chatRequest(correlationId: string) {
  return {
    featureId: FEATURE.chat,
    body: { message: PROMPT, section: 'general', sectionLabel: 'General', history: [] },
    authorization: `Bearer ${CALLER_TOKEN}`,
    organizationHint: ORGANIZATION_ID,
    correlationId,
    channel: 'team_console' as const,
  };
}

function metaOf(response: { body: Record<string, unknown> }): Record<string, unknown> {
  return (response.body.meta ?? {}) as Record<string, unknown>;
}

// ── 1. The paid sequence ────────────────────────────────────────────────────

describe('Anthropic governed path — the Batch 4B production sequence', () => {
  it('serves a real-mode request from Anthropic on the certified model', async () => {
    const { plane, outbound } = buildProofPlane();

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-1'));
    const meta = metaOf(response);

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(meta.provider, PROVIDER_ID);
    // No caller and no feature named a model. The feature declared what it
    // needs, the registry priced the candidates, the selector chose.
    assert.equal(response.body.model, MODEL_ID);
    assert.equal(meta.attempts, 1);

    assert.equal(outbound.length, 1, 'exactly one vendor call');
    assert.equal(outbound[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(outbound[0].body.model, MODEL_ID);
    assert.equal(outbound[0].body.max_tokens, 1_200);
    // The vendor difference that proves the neutral contract is neutral: the
    // system prompt left the message array and became a top-level parameter,
    // and no layer above the adapter knows that happened.
    assert.equal(typeof outbound[0].body.system, 'string');
    assert.ok(
      (outbound[0].body.messages as { role: string }[]).every((turn) => turn.role !== 'system'),
      'no system role survives into the Anthropic message array',
    );
  });

  it('normalises Anthropic token usage onto the platform contract', async () => {
    const { plane } = buildProofPlane();

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-2'));

    // input_tokens/output_tokens in, promptTokens/completionTokens/totalTokens
    // out — and the total is computed, because Anthropic does not send one.
    assert.deepEqual(metaOf(response).usage, {
      promptTokens: 42,
      completionTokens: 3,
      totalTokens: 45,
    });
  });

  it('reports the provider and the model together in one place', async () => {
    // The Batch 4A defect: `meta` carried the provider and not the model, so a
    // reader taking provenance from the one object that holds provenance got
    // `provider=openai model=null` for a correctly recorded request.
    const { plane } = buildProofPlane();

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-3'));
    const meta = metaOf(response);

    assert.equal(meta.provider, PROVIDER_ID);
    assert.equal(meta.model, MODEL_ID);
    // And the legacy top-level field keeps its name, position and meaning.
    assert.equal(response.body.model, MODEL_ID);
  });

  it('settles the metered cost onto the MARQ ceiling and the daily budget', async () => {
    const { plane } = buildProofPlane();

    const before = await plane.spendStatus();
    assert.equal(before.spentMicroUsd, 0);

    await executeAIHttpRequest(plane, chatRequest('cor-4b-4'));

    const after = await plane.spendStatus();
    assert.equal(after.spentMicroUsd, EXPECTED_COST_MICRO_USD, 'the ledger holds the metered cost');
    assert.equal(after.reservedMicroUsd, 0, 'the pessimistic hold was released on settlement');
    assert.equal(after.capMicroUsd, 250_000, 'the strict proof ceiling is what was enforced');

    const budget = plane.budgetState(ORGANIZATION_ID, SUBJECTS[CALLER_TOKEN].subjectId);
    assert.equal(budget.organization.spentMicroUsd, EXPECTED_COST_MICRO_USD);
    assert.equal(budget.actor.spentMicroUsd, EXPECTED_COST_MICRO_USD);
  });

  it('reserves the pessimistic worst case BEFORE the vendor is reached', async () => {
    // A ceiling one micro-USD below the hold must refuse the request outright.
    // Proving the reservation by its refusal is the only way to prove it ran
    // BEFORE the call: a hold taken afterwards could not have stopped anything.
    const { plane, outbound } = buildProofPlane({
      env: { AI_MAX_SPEND_USD: String((ANTHROPIC_ONLY_RESERVATION_MICRO_USD - 1) / 1_000_000) },
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-5'));

    assert.equal(response.status, 429);
    assert.equal(response.body.code, 'BUDGET_EXCEEDED');
    assert.equal(outbound.length, 0, 'no vendor call was made');
    assert.equal((await plane.spendStatus()).reservedMicroUsd, 0, 'no hold was stranded');
  });

  it('admits the request at exactly the hold it computes, and no less', async () => {
    const { plane, outbound } = buildProofPlane({
      env: { AI_MAX_SPEND_USD: String(ANTHROPIC_ONLY_RESERVATION_MICRO_USD / 1_000_000) },
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-6'));

    assert.equal(response.status, 200);
    assert.equal(outbound.length, 1);
    assert.equal((await plane.spendStatus()).spentMicroUsd, EXPECTED_COST_MICRO_USD);
  });

  it('attributes the paid call to a verified organization and actor in the audit trail', async () => {
    const { plane } = buildProofPlane();

    await executeAIHttpRequest(plane, chatRequest('cor-4b-7'));

    const record = plane.recentAudit(1)[0];
    assert.equal(record.outcome, 'success');
    assert.equal(record.organizationId, ORGANIZATION_ID);
    assert.equal(record.organizationMembershipVerified, true);
    assert.equal(record.actorId, SUBJECTS[CALLER_TOKEN].subjectId);
    assert.equal(record.providerId, PROVIDER_ID);
    assert.equal(record.modelId, MODEL_ID);
    assert.equal(record.costMicroUsd, EXPECTED_COST_MICRO_USD);
    assert.deepEqual(record.usage, { promptTokens: 42, completionTokens: 3, totalTokens: 45 });
    // Provenance without content: the trail carries digests, never the text.
    assert.ok(record.promptHash, 'the prompt is recorded by hash');
    assert.ok(record.inputDigest, 'the input is recorded by digest');
  });

  it('keeps the credential, the prompt and the completion out of the log', async () => {
    const { plane, logs } = buildProofPlane();

    await executeAIHttpRequest(plane, chatRequest('cor-4b-8'));

    const text = logs.map((entry) => entry.line).join('\n');
    assert.ok(logs.length > 0, 'the request produced log output to scan');
    assert.doesNotMatch(text, /sk-ant-test-batch4b|x-api-key|Authorization/i, 'no credential in the log');
    assert.ok(!text.includes(PROMPT), 'no prompt text in the log');
    assert.match(text, /"costMicroUsd":57/, 'the log carries the metered cost');
  });
});

// ── 2. The gates that must hold before Anthropic can spend ──────────────────

describe('Anthropic governed path — the gates', () => {
  it('is unavailable, and never called, without a credential', async () => {
    const { plane, outbound } = buildProofPlane({ withoutCredentials: true });

    const health = plane.health().providers.find((p) => p.providerId === PROVIDER_ID);
    assert.equal(health?.credentialsConfigured, false);
    assert.equal(health?.state, 'unavailable');
    assert.match(plane.health().selection[PROVIDER_ID], /credentials not configured/);

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-9'));
    assert.equal(outbound.length, 0, 'no vendor call was made');
    assert.notEqual(metaOf(response).provider, PROVIDER_ID);
    assert.equal((await plane.spendStatus()).spentMicroUsd, 0);
  });

  it('never reaches Anthropic while the real-request kill switch is off', async () => {
    const { plane, outbound } = buildProofPlane({ env: { AI_ALLOW_REAL_REQUESTS: 'false' } });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-10'));

    assert.equal(outbound.length, 0, 'no vendor call was made');
    assert.equal(metaOf(response).provider, 'mock');
    assert.match(
      plane.health().selection[PROVIDER_ID],
      /AI_ALLOW_REAL_REQUESTS=false/,
      'the refusal names the kill switch, not the credential',
    );
    assert.equal((await plane.spendStatus()).spentMicroUsd, 0, 'mock traffic never bills');
  });

  it('refuses a further execution once the emergency stop is engaged, with no second vendor call', async () => {
    const { plane, admin, outbound } = buildProofPlane();

    await executeAIHttpRequest(plane, chatRequest('cor-4b-11'));
    assert.equal(outbound.length, 1);

    const operator = await admin.authorize(`Bearer ${OPERATOR_TOKEN}`);
    await admin.setEmergencyStop(operator, true, 'Batch 4B: holding real execution off after the proof');

    const refused = await executeAIHttpRequest(plane, chatRequest('cor-4b-12'));

    assert.equal(refused.status, 503);
    assert.equal(refused.body.code, 'AI_DISABLED');
    assert.equal(outbound.length, 1, 'the stop was applied before the provider was reached');
    assert.equal(
      (await plane.spendStatus()).spentMicroUsd,
      EXPECTED_COST_MICRO_USD,
      'the refused request cost nothing',
    );
  });

  it('refuses an administrative allow list naming a model the adapter does not serve', async () => {
    const { plane, admin } = buildProofPlane();
    const operator = await admin.authorize(`Bearer ${OPERATOR_TOKEN}`);

    await assert.rejects(
      () =>
        admin.updateProvider(
          operator,
          PROVIDER_ID,
          { modelAllowList: [UNCERTIFIED_MODEL_ID] },
          'Batch 4B: attempt to permit a model outside the certified catalogue',
        ),
      (error: unknown) =>
        error instanceof AIError &&
        error.code === 'VALIDATION_FAILED' &&
        String(error.message).includes(UNCERTIFIED_MODEL_ID),
    );

    // Rejected, not partially applied: the catalogue is exactly what it was.
    assert.deepEqual(
      plane.providers.models(PROVIDER_ID).map((model) => model.modelId),
      [MODEL_ID],
    );
  });

  it('accepts an allow list naming the certified model, and still serves it', async () => {
    const { plane, admin, outbound } = buildProofPlane();
    const operator = await admin.authorize(`Bearer ${OPERATOR_TOKEN}`);

    await admin.updateProvider(
      operator,
      PROVIDER_ID,
      { modelAllowList: [MODEL_ID] },
      'Batch 4B: narrow the proof to the certified Anthropic model',
    );

    assert.deepEqual(
      plane.providers.models(PROVIDER_ID).map((model) => model.modelId),
      [MODEL_ID],
    );

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-13'));
    assert.equal(response.status, 200);
    assert.equal(outbound[0].body.model, MODEL_ID);
  });

  it('serves nothing when the permitted catalogue names only an uncertified model', () => {
    // The backstop for an allow list that reached storage some other way than
    // through the administration boundary above. Narrowing to nothing must take
    // the provider out of rotation — never fall back to the full catalogue.
    const clock = createTestClock();
    const circuit = createCircuitBreaker(clock, {
      failureThreshold: 5,
      openMs: 30_000,
      halfOpenSuccessesToClose: 2,
    });
    const registry = createProviderRegistry(clock, circuit, {
      allowList: () => [UNCERTIFIED_MODEL_ID],
      preferred: () => undefined,
    });
    registry.register(createAnthropicProvider({ env: CREDENTIAL_ENV }), {
      certification: 'certified',
    });

    assert.deepEqual(registry.models(PROVIDER_ID), []);
    assert.equal(
      registry.selectModel(PROVIDER_ID, {
        structuredOutput: false,
        chatCompletions: true,
        minOutputTokens: 1_200,
      }),
      undefined,
    );
    assert.ok(
      registry.validate().some((issue) => issue.includes('matches no declared model')),
      'the ignored narrowing is reported as a configuration issue',
    );
  });
});

// ── 3. Failure behaviour, applied by the control plane ──────────────────────

describe('Anthropic governed path — failure, retry, failover and the circuit', () => {
  it('normalises a rate limit and honours the vendor retry-after', async () => {
    const { plane, outbound } = buildProofPlane({
      responses: [
        () => new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
        anthropicSuccess,
      ],
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-14'));

    // The feature's 2-attempt allowance is spent on ONE provider: the rate
    // limit is retryable, so the plane retried Anthropic rather than giving up.
    assert.equal(response.status, 200);
    assert.equal(metaOf(response).provider, PROVIDER_ID);
    assert.equal(metaOf(response).attempts, 2);
    assert.equal(outbound.length, 2, 'one retry, not a storm');
  });

  it('stops at the feature attempt allowance rather than retrying indefinitely', async () => {
    const { plane, outbound } = buildProofPlane({
      responses: [() => new Response('slow down', { status: 429 })],
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-15'));

    assert.equal(response.status, 429);
    assert.equal(response.body.code, 'PROVIDER_RATE_LIMITED');
    assert.equal(outbound.length, 2, 'exactly the declared maxAttempts');
  });

  it('does not retry a request the vendor refused on its merits', async () => {
    // A 400 will fail identically on every attempt. Retrying it multiplies the
    // bill and the latency and changes nothing.
    const { plane, outbound } = buildProofPlane({
      responses: [() => new Response('bad request', { status: 400 })],
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-16'));

    assert.equal(response.status, 502);
    assert.equal(response.body.code, 'INVALID_MODEL_OUTPUT');
    assert.equal(outbound.length, 1, 'a terminal vendor rejection is not retried');
  });

  it('maps 529 overloaded onto provider unavailability and fails over when permitted', async () => {
    const { plane, outbound } = buildProofPlane({
      env: { AI_FAILOVER_ENABLED: 'true' },
      responses: [() => new Response('overloaded', { status: 529 })],
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-17'));

    assert.equal(response.status, 200);
    assert.equal(metaOf(response).provider, 'mock', 'the request was served by the next candidate');
    assert.ok(outbound.length >= 1, 'Anthropic was attempted before the failover');
  });

  it('does not fail over when the operator has turned failover off', async () => {
    const { plane } = buildProofPlane({
      responses: [() => new Response('overloaded', { status: 529 })],
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-18'));

    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'PROVIDER_UNAVAILABLE');
  });

  it('reconciles the reservation when the provider fails, stranding nothing', async () => {
    const { plane } = buildProofPlane({
      responses: [() => new Response('bad request', { status: 400 })],
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-19'));
    assert.equal(response.status, 502);

    const record = await plane.spendStatus();
    assert.equal(record.reservedMicroUsd, 0, 'the hold was closed, not left open');
    assert.equal(record.openReservations.length, 0, 'no reservation is outstanding');
    // A billable attempt whose true cost is unknown is charged its share of the
    // reservation rather than zero: a failing provider must not be able to burn
    // the ceiling invisibly.
    assert.equal(record.spentMicroUsd, ANTHROPIC_ONLY_RESERVATION_MICRO_USD);

    const failure = plane.recentAudit(1)[0];
    assert.equal(failure.outcome, 'failure');
    assert.equal(failure.providerId, PROVIDER_ID);
    assert.equal(failure.modelId, MODEL_ID);
    assert.equal(failure.errorCode, 'INVALID_MODEL_OUTPUT');
  });

  it('opens the circuit on repeated provider faults and then reports it as the reason', async () => {
    const { plane, outbound } = buildProofPlane({
      env: { AI_CIRCUIT_FAILURE_THRESHOLD: '2' },
      responses: [() => new Response('overloaded', { status: 529 })],
    });

    // Two attempts per request against a 2-fault threshold: one request opens it.
    await executeAIHttpRequest(plane, chatRequest('cor-4b-20'));
    const callsBefore = outbound.length;

    const health = plane.health().providers.find((p) => p.providerId === PROVIDER_ID);
    assert.equal(health?.circuit, 'open');
    assert.equal(health?.state, 'unavailable');
    assert.match(plane.health().selection[PROVIDER_ID], /circuit open/);

    const refused = await executeAIHttpRequest(plane, chatRequest('cor-4b-21'));
    assert.equal(outbound.length, callsBefore, 'an open circuit spends nothing at the vendor');
    assert.notEqual(metaOf(refused).provider, PROVIDER_ID);
  });

  it('normalises a deadline expiry as a provider timeout', async () => {
    // The per-attempt deadline is the control plane's, applied identically to
    // every adapter. What this proves is that the Anthropic adapter honours the
    // signal it is handed rather than running past it.
    const provider = createAnthropicProvider({
      env: CREDENTIAL_ENV,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });

    await assert.rejects(
      () =>
        withTimeout(5, PROVIDER_ID, (handle) =>
          provider.invoke({
            requestId: 'req_timeout',
            correlationId: 'cor_timeout',
            modelId: MODEL_ID,
            generation: {
              messages: [{ role: 'user', content: PROMPT }],
              responseFormat: 'text',
              temperature: 0,
              maxOutputTokens: 100,
            },
            attempt: 1,
            signal: handle.signal,
          } satisfies AIProviderInvocation),
        ),
      (error: unknown) => error instanceof AIError && error.code === 'PROVIDER_TIMEOUT',
    );
  });

  it('keeps the vendor error body in diagnostics and out of the caller-facing response', async () => {
    // Anthropic echoes request content in some 400 bodies, and that content may
    // be a tenant's business data. It is diagnostic material, not a message.
    const ECHOED = 'ACME-CONFIDENTIAL-REVENUE-FIGURE';
    const { plane } = buildProofPlane({
      responses: [
        () =>
          new Response(JSON.stringify({ error: { message: `invalid request: ${ECHOED}` } }), {
            status: 400,
          }),
      ],
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-26'));

    assert.equal(response.status, 502);
    assert.ok(
      !JSON.stringify(response.body).includes(ECHOED),
      'the vendor body never reaches the caller',
    );

    const record = plane.recentAudit(1)[0];
    assert.equal(record.outcome, 'failure');
    assert.ok(
      !JSON.stringify(record).includes(ECHOED),
      'nor is it copied into the audit record',
    );
  });
});

// ── 4. What registering a second paid vendor did to the first ───────────────

describe('Anthropic certification — the certified OpenAI baseline', () => {
  it('does not raise the hold the certified $0.25 ceiling was proved against', async () => {
    // The spend guard reserves the worst case across the FULL declared
    // catalogue of every billable provider — not the model that will be
    // selected. So a dear Anthropic model would silently raise the hold on
    // every OpenAI request too. Pinned by refusal at one micro-USD below the
    // Batch 4A figure, and admission at exactly it.
    const tight = buildProofPlane({
      withOpenAI: true,
      env: {
        AI_PROVIDER_PREFERENCE: 'openai,anthropic,mock',
        AI_MAX_SPEND_USD: String((OPENAI_BASELINE_RESERVATION_MICRO_USD - 1) / 1_000_000),
      },
    });
    const refused = await executeAIHttpRequest(tight.plane, chatRequest('cor-4b-22'));
    assert.equal(refused.body.code, 'BUDGET_EXCEEDED', 'the hold is not below the 4A figure');
    assert.equal(tight.outbound.length, 0);

    const exact = buildProofPlane({
      withOpenAI: true,
      env: {
        AI_PROVIDER_PREFERENCE: 'openai,anthropic,mock',
        AI_MAX_SPEND_USD: String(OPENAI_BASELINE_RESERVATION_MICRO_USD / 1_000_000),
      },
    });
    const served = await executeAIHttpRequest(exact.plane, chatRequest('cor-4b-23'));
    assert.equal(served.status, 200, 'the hold is not above the 4A figure either');
    assert.equal(metaOf(served).provider, 'openai');
  });

  it('leaves OpenAI first in preference order and unchanged in what it serves', async () => {
    const { plane, outbound } = buildProofPlane({
      withOpenAI: true,
      env: { AI_PROVIDER_PREFERENCE: 'openai,anthropic,mock' },
    });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-24'));

    assert.equal(metaOf(response).provider, 'openai');
    assert.equal(metaOf(response).model, 'gpt-4o-mini');
    assert.equal(response.body.model, 'gpt-4o-mini');
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].url, 'https://api.openai.com/v1/chat/completions');
    // 42 × 150/1000 + 3 × 600/1000 = 8.1 → 8 µUSD, exactly as Batch 4A settled.
    assert.equal((await plane.spendStatus()).spentMicroUsd, 8);
  });

  it('leaves the mock provider synthetic, free and non-production', async () => {
    const { plane, outbound } = buildProofPlane({ env: { AI_ALLOW_REAL_REQUESTS: 'false' } });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4b-25'));
    const meta = metaOf(response);

    assert.equal(response.status, 200);
    assert.equal(meta.provider, 'mock');
    assert.equal(meta.model, 'mock-standard');
    assert.equal(response.body.model, 'mock-standard');
    assert.equal(outbound.length, 0, 'the mock reaches no vendor');
    assert.equal((await plane.spendStatus()).spentMicroUsd, 0);
    assert.equal(
      plane.health().status,
      'degraded',
      'serving on a synthetic provider is never reported healthy',
    );
  });
});
