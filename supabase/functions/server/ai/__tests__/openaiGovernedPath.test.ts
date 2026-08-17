/**
 * The OpenAI adapter, driven through the whole governed path (AI-01 Batch 4A).
 *
 * The provider suite already proves the adapter speaks the OpenAI wire format
 * and maps vendor failures onto the taxonomy. What nothing proved until here is
 * the sequence a PAID request actually takes:
 *
 *   guard → policy → spend reservation → selection admits a billable provider →
 *   OpenAI adapter → reported usage → metered cost → spend ledger settlement →
 *   daily budget → audit attribution
 *
 * That sequence is the one the Batch 4A production proof executes against the
 * real vendor, and it is the one no other test exercises: every other suite
 * runs on the mock adapter, which is declared non-billable and therefore skips
 * the ledger entirely by design.
 *
 * The ONLY substitution here is the adapter's injected `fetch`. Everything else
 * — the registry, the selector with real requests authorised, the spend guard,
 * the ledger, the budget engine, the audit writer, the administration service
 * and its kill switch — is the production implementation. So a green run here
 * means the live proof's failure modes are the vendor and the credential, not
 * this platform's wiring.
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
import { createOpenAIProvider, type FetchLike } from '../providers/openaiProvider.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createMemorySpendStore } from '../policy/spendLedger.ts';
import { FEATURE } from '../features/index.ts';
import type { AIAuthenticator, AuthenticatedSubject } from '../security/actor.ts';

const ORGANIZATION_ID = 'marq-batch-4a-proof';
const MODEL_ID = 'gpt-4o-mini';
const CALLER_TOKEN = 'batch4a-caller';
const OPERATOR_TOKEN = 'batch4a-operator';

/** A placeholder credential. The transport below never leaves the process. */
const CREDENTIAL_ENV = recordEnv({ OPENAI_API_KEY: 'sk-test-batch4a' });

const PROMPT = 'Reply with exactly the two characters: OK';
const COMPLETION = 'OK';

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

/** Reported usage for the stubbed completion. Priced by the registry, not here. */
const USAGE = { prompt_tokens: 42, completion_tokens: 3, total_tokens: 45 };

/**
 * The metered cost the registry's published rates imply for that usage:
 * 42 × 150/1000 + 3 × 600/1000 = 6.3 + 1.8 = 8.1, rounded to 8 µUSD.
 *
 * Written out rather than computed from the descriptor because a test that
 * derives the expected cost the same way the code does asserts nothing about
 * whether either is right.
 */
const EXPECTED_COST_MICRO_USD = 8;

interface ProofPlane {
  readonly outbound: { url: string; body: Record<string, unknown> }[];
  readonly logs: { level: string; line: string }[];
  readonly plane: ReturnType<typeof createControlPlane>;
  readonly admin: ReturnType<typeof createAIAdministration>;
}

function buildProofPlane(env: Record<string, string> = {}): ProofPlane {
  const outbound: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    outbound.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return Promise.resolve(
      Response.json({
        model: MODEL_ID,
        choices: [{ message: { content: COMPLETION }, finish_reason: 'stop' }],
        usage: USAGE,
      }),
    );
  };

  const config = loadControlPlaneConfig(
    recordEnv({
      AI_ALLOW_REAL_REQUESTS: 'true',
      AI_PROVIDER_PREFERENCE: 'openai,mock',
      // The proof reaches OpenAI or it fails. Failing over to the mock would
      // let a synthetic completion be reported as a paid provider's answer.
      AI_FAILOVER_ENABLED: 'false',
      AI_MAX_SPEND_USD: '0.25',
      AI_DEFAULT_ORGANIZATION_ID: ORGANIZATION_ID,
      AI_ORGANIZATION_ALLOW_LIST: ORGANIZATION_ID,
      AI_ALLOW_DEFAULT_ORGANIZATION: 'false',
      AI_LOG_LEVEL: 'debug',
      AI_RETRY_BASE_DELAY_MS: '0',
      ...env,
    }),
  );

  const sink = createMemorySink();
  const settingsStore = createMemorySettingsStore();
  const clock = createTestClock();

  const plane = createControlPlane({
    config,
    authenticator,
    providers: [
      { adapter: createOpenAIProvider({ env: CREDENTIAL_ENV, fetchImpl }), certification: 'certified' },
      { adapter: createMockProvider(), certification: 'testing' },
    ],
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

describe('OpenAI governed path — the Batch 4A production sequence', () => {
  it('serves a real-mode request from OpenAI on the cheapest capable model', async () => {
    const { plane, outbound } = buildProofPlane();

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4a-1'));
    const meta = response.body.meta as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(meta.provider, 'openai');
    // Cheapest capable model wins without anybody naming one: the feature
    // declares requirements, the registry prices the candidates.
    assert.equal(response.body.model, MODEL_ID);
    assert.equal(meta.attempts, 1);

    assert.equal(outbound.length, 1, 'exactly one vendor call');
    assert.equal(outbound[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(outbound[0].body.model, MODEL_ID);
    assert.equal(outbound[0].body.max_tokens, 1_200);

    assert.deepEqual(meta.usage, { promptTokens: 42, completionTokens: 3, totalTokens: 45 });
  });

  it('settles the metered cost onto the MARQ ceiling and the daily budget', async () => {
    const { plane } = buildProofPlane();

    const before = await plane.spendStatus();
    assert.equal(before.spentMicroUsd, 0);

    await executeAIHttpRequest(plane, chatRequest('cor-4a-2'));

    const after = await plane.spendStatus();
    assert.equal(after.spentMicroUsd, EXPECTED_COST_MICRO_USD, 'the ledger holds the metered cost');
    assert.equal(after.reservedMicroUsd, 0, 'the pessimistic hold was released on settlement');
    assert.equal(after.capMicroUsd, 250_000, 'the strict proof ceiling is what was enforced');

    const budget = plane.budgetState(ORGANIZATION_ID, SUBJECTS[CALLER_TOKEN].subjectId);
    assert.equal(budget.organization.spentMicroUsd, EXPECTED_COST_MICRO_USD);
    assert.equal(budget.actor.spentMicroUsd, EXPECTED_COST_MICRO_USD);
  });

  it('attributes the paid call to a verified organization and actor in the audit trail', async () => {
    const { plane } = buildProofPlane();

    await executeAIHttpRequest(plane, chatRequest('cor-4a-3'));

    const record = plane.recentAudit(1)[0];
    assert.equal(record.outcome, 'success');
    assert.equal(record.organizationId, ORGANIZATION_ID);
    assert.equal(record.organizationMembershipVerified, true);
    assert.equal(record.actorId, SUBJECTS[CALLER_TOKEN].subjectId);
    assert.equal(record.providerId, 'openai');
    assert.equal(record.modelId, MODEL_ID);
    assert.equal(record.costMicroUsd, EXPECTED_COST_MICRO_USD);
    assert.deepEqual(record.usage, { promptTokens: 42, completionTokens: 3, totalTokens: 45 });
    // Provenance without content: the trail carries digests, never the text.
    assert.ok(record.promptHash, 'the prompt is recorded by hash');
    assert.ok(record.inputDigest, 'the input is recorded by digest');
  });

  it('never reaches OpenAI while the real-request kill switch is off', async () => {
    const { plane, outbound } = buildProofPlane({ AI_ALLOW_REAL_REQUESTS: 'false' });

    const response = await executeAIHttpRequest(plane, chatRequest('cor-4a-4'));

    assert.equal(outbound.length, 0, 'no vendor call was made');
    assert.equal((response.body.meta as Record<string, unknown>).provider, 'mock');
    assert.match(
      plane.health().selection.openai,
      /AI_ALLOW_REAL_REQUESTS=false/,
      'the refusal names the kill switch, not the credential',
    );
    assert.equal((await plane.spendStatus()).spentMicroUsd, 0, 'mock traffic never bills');
  });

  it('refuses a further execution once the emergency stop is engaged, with no second vendor call', async () => {
    const { plane, admin, outbound } = buildProofPlane();

    await executeAIHttpRequest(plane, chatRequest('cor-4a-5'));
    assert.equal(outbound.length, 1);

    const operator = await admin.authorize(`Bearer ${OPERATOR_TOKEN}`);
    await admin.setEmergencyStop(operator, true, 'Batch 4A: holding real execution off after the proof');

    const refused = await executeAIHttpRequest(plane, chatRequest('cor-4a-6'));

    assert.equal(refused.status, 503);
    assert.equal(refused.body.code, 'AI_DISABLED');
    assert.equal(outbound.length, 1, 'the stop was applied before the provider was reached');
    assert.equal(
      (await plane.spendStatus()).spentMicroUsd,
      EXPECTED_COST_MICRO_USD,
      'the refused request cost nothing',
    );
  });

  it('keeps the credential, the prompt and the completion out of the log', async () => {
    const { plane, logs } = buildProofPlane();

    await executeAIHttpRequest(plane, chatRequest('cor-4a-7'));

    const text = logs.map((entry) => entry.line).join('\n');
    assert.ok(logs.length > 0, 'the request produced log output to scan');
    assert.doesNotMatch(text, /sk-test-batch4a|Bearer|Authorization/i, 'no credential in the log');
    assert.ok(!text.includes(PROMPT), 'no prompt text in the log');
    assert.ok(!text.includes('[APPLY_START]'), 'no completion body in the log');
    // What SHOULD be there: the economics of the call.
    assert.match(text, /"costMicroUsd":8/, 'the log carries the metered cost');
  });
});
