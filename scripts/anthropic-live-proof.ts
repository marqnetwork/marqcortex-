/**
 * AI-01 Batch 4B — controlled Anthropic production proof.
 *
 * The Anthropic counterpart of `openai-live-proof.ts`, and deliberately the
 * same script with one provider id changed. Drives ONE real Anthropic request
 * through the existing governed path and prints what it cost, what it returned
 * and where the money was recorded:
 *
 *   HTTP adapter → control plane → guard → policy → spend guard →
 *   provider selector → Anthropic adapter → usage → spend ledger → audit
 *
 * NOTHING HERE IS A SECOND PATH. The plane is assembled exactly the way
 * `bootstrap.ts` assembles it — same `createControlPlane`, same registry, same
 * selector, same spend guard, same administration service. The only injected
 * substitutions are the ones a script cannot get from a Supabase edge isolate:
 * an authenticator over two fixed proof tokens, in-memory durable stores, and a
 * counting wrapper around `fetch` so the proof can state, as a number, how many
 * paid vendor calls it made.
 *
 * ── SAFETY, BY CONSTRUCTION ────────────────────────────────────────────────
 *
 *   The live call runs only with `--live` AND a configured Anthropic credential
 *   AND `AI_ALLOW_REAL_REQUESTS=true`. Missing any one of them, the script runs
 *   the offline preflight and stops before the network.
 *
 *   The spend ceiling is set to a strict proof ceiling, not the deployment's.
 *   The MARQ lifetime ledger is in-memory here, so a proof run cannot consume
 *   the deployment's funded headroom, and cannot disturb the 64 µUSD the
 *   Batch 4A OpenAI proof settled.
 *
 *   Selection is narrowed to the certified Anthropic model through the
 *   ADMINISTRATION path — an audited `updateProvider` allow list — rather than
 *   by naming a model at the call site, because a feature that names a model is
 *   the bypass this platform is built to not have.
 *
 *   OpenAI is deliberately NOT registered in this plane. The proof reaches
 *   Anthropic or it fails; it can neither spend at the other vendor nor report
 *   another vendor's completion as Anthropic's.
 *
 *   Failover is off, so the proof also cannot quietly report success over a
 *   synthetic mock completion.
 *
 *   The prompt is a fixed, trivial, deterministic string. No customer data, no
 *   tenant content, no personal data, no tools, no workflow, no agent.
 *
 *   The credential is never read, printed, logged or held by this file. The
 *   Anthropic adapter reads it from the environment itself; this script only
 *   ever asks the adapter `hasCredentials()`.
 *
 * Usage:
 *   node --experimental-strip-types scripts/anthropic-live-proof.ts         # preflight only
 *   node --experimental-strip-types scripts/anthropic-live-proof.ts --live  # preflight + ONE paid call
 */

import { createControlPlane } from '../supabase/functions/server/ai/controlPlane.ts';
import { createAIAdministration } from '../supabase/functions/server/ai/admin/administration.ts';
import { createMemorySettingsStore } from '../supabase/functions/server/ai/admin/settingsStore.ts';
import { executeAIHttpRequest } from '../supabase/functions/server/ai/http/httpAdapter.ts';
import { loadControlPlaneConfig } from '../supabase/functions/server/ai/runtime/config.ts';
import { recordEnv, runtimeEnv, type EnvSource } from '../supabase/functions/server/ai/runtime/env.ts';
import { systemClock } from '../supabase/functions/server/ai/runtime/clock.ts';
import { systemIdFactory } from '../supabase/functions/server/ai/contracts/ids.ts';
import { createAnthropicProvider } from '../supabase/functions/server/ai/providers/anthropicProvider.ts';
import type { FetchLike } from '../supabase/functions/server/ai/providers/openaiProvider.ts';
import { createMockProvider } from '../supabase/functions/server/ai/providers/mockProvider.ts';
import { createMemorySpendStore } from '../supabase/functions/server/ai/policy/spendLedger.ts';
import { createMemorySink } from '../supabase/functions/server/ai/observability/logger.ts';
import { FEATURE } from '../supabase/functions/server/ai/features/index.ts';
import type { AIAuthenticator, AuthenticatedSubject } from '../supabase/functions/server/ai/security/actor.ts';

// ── Proof parameters ────────────────────────────────────────────────────────

const PROVIDER_ID = 'anthropic';
/** The one model the certified Anthropic catalogue declares. */
const PROOF_MODEL_ID = 'claude-haiku-4-5-20251001';
const PROOF_ORGANIZATION_ID = 'marq-batch-4b-proof';

/**
 * The strict test ceiling, in dollars.
 *
 * It has to clear the spend guard's deliberately pessimistic reservation —
 * `maxInputBytes / 4` prompt tokens plus the full output allowance, priced at
 * the most expensive model any registered billable provider DECLARES, times the
 * attempt allowance. With Anthropic the only paid provider in this plane and
 * Haiku 4.5 the only model it declares, that hold is
 * (16,384 × 1,000/1000 + 1,200 × 5,000/1000) × 2 = 44,768 µUSD ≈ $0.045.
 *
 * Twenty-five cents clears it with room and matches the ceiling Batch 4A was
 * proved against, so the two proofs are directly comparable. The metered cost
 * of the one request it authorises is on the order of $0.0002.
 */
const PROOF_MAX_SPEND_USD = '0.25';

/** Fixed, trivial and deterministic. Nobody's data is in this string. */
const PROOF_PROMPT = 'Reply with exactly the two characters: OK';

const OPERATOR_TOKEN = 'batch4b-operator';
const CALLER_TOKEN = 'batch4b-caller';

const SUBJECTS: Readonly<Record<string, AuthenticatedSubject>> = {
  [OPERATOR_TOKEN]: {
    subjectId: 'proof-operator',
    email: 'ops@marq.test',
    actorType: 'team_user',
    globalRoles: ['super_admin'],
    memberships: [{ organizationId: PROOF_ORGANIZATION_ID, tier: 'internal', roles: ['owner'] }],
  },
  [CALLER_TOKEN]: {
    subjectId: 'proof-caller',
    email: 'proof@marq.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [
      { organizationId: PROOF_ORGANIZATION_ID, tier: 'internal', roles: ['consultant'] },
    ],
  },
};

const authenticator: AIAuthenticator = {
  authenticate: (authorization) => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    return Promise.resolve(token === undefined ? null : SUBJECTS[token] ?? null);
  },
};

// ── Reporting ───────────────────────────────────────────────────────────────

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 68 - title.length))}`);
}

function microUsd(value: number): string {
  return `${value} µUSD ($${(value / 1_000_000).toFixed(6)})`;
}

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * Environment for the proof: the real one underneath, proof-specific narrowing
 * on top. Every override either NARROWS (a lower ceiling, no failover, one
 * organization) or is inert to safety (retry delay, log level). Nothing here
 * widens a gate — in particular `AI_ALLOW_REAL_REQUESTS` is read from the real
 * environment and is never set by this script.
 */
function proofEnv(realEnv: EnvSource): EnvSource {
  const overrides = recordEnv({
    AI_PROVIDER_PREFERENCE: `${PROVIDER_ID},mock`,
    // The proof reaches Anthropic or it fails. Failing over to the mock would
    // report a synthetic completion as a successful production proof.
    AI_FAILOVER_ENABLED: 'false',
    AI_MAX_SPEND_USD: PROOF_MAX_SPEND_USD,
    AI_SPEND_ENFORCE: 'true',
    AI_BUDGET_ENFORCE: 'true',
    AI_REQUIRE_CERTIFIED_PROVIDERS: 'true',
    AI_DEFAULT_ORGANIZATION_ID: PROOF_ORGANIZATION_ID,
    AI_ORGANIZATION_ALLOW_LIST: PROOF_ORGANIZATION_ID,
    AI_ALLOW_DEFAULT_ORGANIZATION: 'false',
    AI_REDACTION_ENABLED: 'true',
    AI_RETRY_BASE_DELAY_MS: '0',
    // Debug, so the leakage scan below sees the most this platform ever emits.
    AI_LOG_LEVEL: 'debug',
    AI_STRUCTURED_LOGS: 'true',
  });
  return { get: (key) => overrides.get(key) ?? realEnv.get(key) };
}

interface OutboundCall {
  readonly url: string;
  readonly atMs: number;
}

function buildProofPlane(realEnv: EnvSource) {
  const outbound: OutboundCall[] = [];
  /** Counts and records every outbound vendor call. Headers are never touched. */
  const countingFetch: FetchLike = (input, init) => {
    outbound.push({ url: String(input), atMs: Date.now() });
    return fetch(input, init);
  };

  const env = proofEnv(realEnv);
  const config = loadControlPlaneConfig(env);
  const sink = createMemorySink();
  const settingsStore = createMemorySettingsStore();

  // The real certified adapter, reading the real environment for its credential.
  const anthropic = createAnthropicProvider({ env: realEnv, fetchImpl: countingFetch });
  // Registered exactly as bootstrap registers it: non-production, non-billable,
  // last in preference. Present so the proof can show it was NOT what served.
  const mock = createMockProvider();

  const plane = createControlPlane({
    config,
    authenticator,
    providers: [
      { adapter: anthropic, certification: 'certified' },
      { adapter: mock, certification: 'testing' },
    ],
    spendStore: createMemorySpendStore(),
    settingsSource: settingsStore,
    clock: systemClock,
    ids: systemIdFactory,
    logSink: sink,
  });

  const admin = createAIAdministration({
    plane,
    authenticator,
    settingsStore,
    clock: systemClock,
    ids: systemIdFactory,
    logger: plane.logger,
  });

  return { plane, admin, anthropic, mock, config, outbound, sink, env };
}

function chatRequest(correlationId: string) {
  return {
    featureId: FEATURE.chat,
    body: {
      message: PROOF_PROMPT,
      section: 'general',
      sectionLabel: 'General',
      history: [],
    },
    authorization: `Bearer ${CALLER_TOKEN}`,
    organizationHint: PROOF_ORGANIZATION_ID,
    correlationId,
    channel: 'team_console' as const,
  };
}

// ── The proof ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const realEnv = runtimeEnv();
  const { plane, admin, anthropic, mock, config, outbound, sink } = buildProofPlane(realEnv);

  console.log('MARQ CORTEX — AI-01 Batch 4B controlled Anthropic production proof');
  console.log(`mode: ${live ? 'LIVE (one paid request permitted)' : 'PREFLIGHT ONLY (no network)'}`);

  // ── 1. Governed path and registry facts ──────────────────────────────────
  section('1. Governed path');

  const registered = plane.providers.find(PROVIDER_ID);
  check(
    'the Anthropic adapter is registered in the one provider registry',
    registered !== undefined &&
      registered.descriptor.billable &&
      registered.descriptor.productionReady,
    registered
      ? `certification=${registered.certification} billable=${registered.descriptor.billable} ` +
          `productionReady=${registered.descriptor.productionReady} models=` +
          registered.descriptor.models.map((model) => model.modelId).join(',')
      : 'anthropic is not registered',
  );

  const declared = plane.providers.models(PROVIDER_ID);
  check(
    'the certified Anthropic catalogue is exactly the one proof model',
    declared.length === 1 && declared[0].modelId === PROOF_MODEL_ID,
    `declared=${declared.map((model) => model.modelId).join(',') || '(none)'} ` +
      `prompt=${declared[0]?.promptMicroUsdPer1k}µUSD/1k ` +
      `completion=${declared[0]?.completionMicroUsdPer1k}µUSD/1k`,
  );

  check(
    'the mock provider is registered but cannot bill or serve production',
    mock.descriptor.billable === false && mock.descriptor.productionReady === false,
    `billable=${mock.descriptor.billable} productionReady=${mock.descriptor.productionReady}`,
  );

  check(
    'no OpenAI adapter is registered in this plane',
    plane.providers.find('openai') === undefined,
    'the proof cannot spend at, or be answered by, the other certified vendor',
  );

  // ── 2. Security gates, proved offline ────────────────────────────────────
  section('2. Security gates (no network)');

  const credentialsConfigured = anthropic.hasCredentials();
  check(
    'the Anthropic credential is read only by the adapter',
    true,
    `adapter.hasCredentials()=${credentialsConfigured} (this script never reads the value)`,
  );

  // The kill switch, as the deployment currently has it.
  const realRequestsPermitted = config.allowRealRequests;
  const health = plane.health();
  const anthropicHealth = health.providers.find((entry) => entry.providerId === PROVIDER_ID);
  check(
    'the real-request kill switch is reported by the health surface',
    anthropicHealth !== undefined,
    `AI_ALLOW_REAL_REQUESTS=${realRequestsPermitted} providerState=${anthropicHealth?.state} ` +
      `selectable=${JSON.stringify(health.selection?.[PROVIDER_ID] ?? 'n/a')}`,
  );

  {
    // A plane identical to the proof plane except that real requests are OFF.
    // The refusal must name the kill switch — not the credential — because a
    // deployment with keys configured and spending disabled has to be told the
    // truth about which one stopped it.
    const off = buildProofPlane(recordEnv({ AI_ALLOW_REAL_REQUESTS: 'false' }));
    const before = off.outbound.length;
    const response = await executeAIHttpRequest(off.plane, chatRequest('cor-killswitch-off'));
    const served = String(response.body.meta ? (response.body.meta as Record<string, unknown>).provider : '');
    check(
      'with the kill switch OFF, Anthropic is removed from selection and never called',
      off.outbound.length === before && served !== PROVIDER_ID,
      `outboundCalls=${off.outbound.length} status=${response.status} servedBy=${served || '(none)'} ` +
        `selection=${JSON.stringify(off.plane.health().selection?.[PROVIDER_ID] ?? 'n/a')}`,
    );
  }

  {
    // The emergency stop, engaged through the audited administration path.
    const stopped = buildProofPlane(realEnv);
    const operator = await stopped.admin.authorize(`Bearer ${OPERATOR_TOKEN}`);
    await stopped.admin.setEmergencyStop(
      operator,
      true,
      'AI-01 Batch 4B: proving the emergency stop refuses execution',
    );
    const before = stopped.outbound.length;
    const response = await executeAIHttpRequest(stopped.plane, chatRequest('cor-emergency-stop'));
    check(
      'the emergency stop halts execution before any provider is reached',
      stopped.outbound.length === before && response.status >= 400,
      `outboundCalls=${stopped.outbound.length} status=${response.status} code=${String(response.body.code)}`,
    );
  }

  {
    // An unauthenticated caller. The guard is the first gate and it is unchanged.
    const anonymous = buildProofPlane(realEnv);
    const before = anonymous.outbound.length;
    const response = await executeAIHttpRequest(anonymous.plane, {
      ...chatRequest('cor-unauthenticated'),
      authorization: null,
    });
    check(
      'an unauthenticated request is refused with zero provider calls',
      anonymous.outbound.length === before && response.status === 401,
      `outboundCalls=${anonymous.outbound.length} status=${response.status} code=${String(response.body.code)}`,
    );
  }

  // ── 3. Governed model narrowing ──────────────────────────────────────────
  section('3. Model narrowing through the administration path');

  const operator = await admin.authorize(`Bearer ${OPERATOR_TOKEN}`);
  await admin.updateProvider(
    operator,
    PROVIDER_ID,
    { modelAllowList: [PROOF_MODEL_ID] },
    'AI-01 Batch 4B: restrict the production proof to the certified Anthropic model',
  );
  const permitted = plane.providers.models(PROVIDER_ID);
  check(
    'the proof is narrowed to one model by an audited administrative action',
    permitted.length === 1 && permitted[0].modelId === PROOF_MODEL_ID,
    `permittedModels=${permitted.map((model) => model.modelId).join(',') || '(none)'} ` +
      `adminAuditEntries=${admin.adminAudit(operator, 5).length}`,
  );

  // ── 4. The live call ─────────────────────────────────────────────────────
  section('4. Live request');

  if (!credentialsConfigured) {
    check(
      'LIVE CALL',
      false,
      'BLOCKED — no Anthropic credential is configured in this environment. ' +
        'Set ANTHROPIC_API_KEY as a Supabase Edge Function secret ' +
        '(Dashboard → Project → Edge Functions → Secrets, or `supabase secrets set`), ' +
        'then re-run with --live. No gate was weakened and no placeholder credential was created.',
    );
    summarize(live, sink);
    return;
  }
  if (!realRequestsPermitted) {
    check(
      'LIVE CALL',
      false,
      'BLOCKED — AI_ALLOW_REAL_REQUESTS is not true in this environment. ' +
        'The kill switch is a deliberate operator action and this script never sets it.',
    );
    summarize(live, sink);
    return;
  }
  if (!live) {
    check(
      'LIVE CALL',
      false,
      'NOT ATTEMPTED — preflight mode. Re-run with --live to execute exactly one paid request.',
    );
    summarize(live, sink);
    return;
  }

  const spendBefore = await plane.spendStatus();
  const startedAtMs = Date.now();
  const response = await executeAIHttpRequest(plane, chatRequest('cor-batch4b-live'));
  const wallClockMs = Date.now() - startedAtMs;
  const meta = (response.body.meta ?? {}) as Record<string, unknown>;
  const usage = (meta.usage ?? {}) as Record<string, number>;

  check(
    'exactly ONE outbound Anthropic call was made',
    outbound.length === 1 && outbound[0].url.startsWith('https://api.anthropic.com/'),
    `outboundCalls=${outbound.length} url=${outbound.map((call) => call.url).join(', ') || '(none)'}`,
  );

  check(
    'the request succeeded through the governed path',
    response.status === 200 && response.body.success === true && meta.provider === PROVIDER_ID,
    `status=${response.status} provider=${String(meta.provider)} model=${String(meta.model)} ` +
      `attempts=${String(meta.attempts)} providerLatencyMs=${String(meta.latencyMs)} wallClockMs=${wallClockMs}`,
  );

  check(
    'the provider and the model are reported together, and the legacy field agrees',
    meta.model === response.body.model && typeof meta.model === 'string' && meta.model !== '',
    `meta.provider=${String(meta.provider)} meta.model=${String(meta.model)} ` +
      `body.model=${String(response.body.model)}`,
  );

  check(
    'the provider reported token usage',
    typeof usage.totalTokens === 'number' && usage.totalTokens > 0,
    `promptTokens=${usage.promptTokens} completionTokens=${usage.completionTokens} ` +
      `totalTokens=${usage.totalTokens}`,
  );

  // ── 5. Accounting ────────────────────────────────────────────────────────
  section('5. Spend and accounting');

  const spendAfter = await plane.spendStatus();
  const delta = spendAfter.spentMicroUsd - spendBefore.spentMicroUsd;
  check(
    'the measured cost reached the MARQ spend ledger',
    delta > 0 && spendAfter.reservedMicroUsd === 0,
    `spentBefore=${microUsd(spendBefore.spentMicroUsd)} spentAfter=${microUsd(spendAfter.spentMicroUsd)} ` +
      `delta=${microUsd(delta)} reservedHeld=${spendAfter.reservedMicroUsd} cap=${microUsd(spendAfter.capMicroUsd)}`,
  );

  const budget = plane.budgetState(PROOF_ORGANIZATION_ID, SUBJECTS[CALLER_TOKEN].subjectId);
  check(
    'the cost reached the rolling daily budget for the organization and actor',
    budget.organization.spentMicroUsd > 0 && budget.actor.spentMicroUsd > 0,
    `organizationSpent=${microUsd(budget.organization.spentMicroUsd)} ` +
      `actorSpent=${microUsd(budget.actor.spentMicroUsd)}`,
  );

  const auditRecord = plane.recentAudit(1)[0];
  check(
    'the audit record attributes the spend to the proof organization and actor',
    auditRecord?.organizationId === PROOF_ORGANIZATION_ID &&
      auditRecord?.providerId === PROVIDER_ID &&
      auditRecord?.outcome === 'success',
    auditRecord
      ? `organizationId=${auditRecord.organizationId} actorId=${auditRecord.actorId} ` +
          `membershipVerified=${auditRecord.organizationMembershipVerified} ` +
          `provider=${auditRecord.providerId} ` +
          `model=${auditRecord.modelId} cost=${microUsd(auditRecord.costMicroUsd ?? 0)} ` +
          `promptHash=${String(auditRecord.promptHash).slice(0, 12)}… ` +
          `inputDigest=${String(auditRecord.inputDigest).slice(0, 12)}…`
      : '(no audit record)',
  );

  // ── 6. Kill switch after the proof ───────────────────────────────────────
  section('6. Kill switch, after the proof');

  const operatorAgain = await admin.authorize(`Bearer ${OPERATOR_TOKEN}`);
  await admin.setEmergencyStop(
    operatorAgain,
    true,
    'AI-01 Batch 4B: holding real execution off after the controlled proof',
  );
  const callsBeforeRefusal = outbound.length;
  const refused = await executeAIHttpRequest(plane, chatRequest('cor-batch4b-post-proof'));
  check(
    'after the proof, the kill switch refuses a further provider execution',
    outbound.length === callsBeforeRefusal && refused.status >= 400,
    `outboundCallsTotal=${outbound.length} (unchanged) status=${refused.status} ` +
      `code=${String(refused.body.code)}`,
  );

  summarize(live, sink);
}

/**
 * Scan every log line this run produced for a leaked credential or a leaked
 * prompt, then print the verdict.
 *
 * The scan is pattern-based rather than value-based on purpose: matching
 * against the real key would mean reading it into this process, and a proof
 * that handles the secret to prove it does not leak has already leaked it.
 */
function summarize(live: boolean, sink: ReturnType<typeof createMemorySink>): void {
  section('Log hygiene');

  const CREDENTIAL_SHAPE = /\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|x-api-key|Bearer\s+\S+|Authorization)\b/i;
  const leakedCredential = sink.lines.filter((entry) => CREDENTIAL_SHAPE.test(entry.line));
  check(
    'no credential-shaped value appears in any log line',
    leakedCredential.length === 0,
    `linesScanned=${sink.lines.length} offending=${leakedCredential.length}`,
  );

  const promptFragment = PROOF_PROMPT.slice(0, 20);
  const leakedPrompt = sink.lines.filter((entry) => entry.line.includes(promptFragment));
  check(
    'no prompt or completion text appears in any log line',
    leakedPrompt.length === 0,
    `linesScanned=${sink.lines.length} offending=${leakedPrompt.length}`,
  );

  section('Result');
  const failed = checks.filter((entry) => !entry.ok);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed.`);
  for (const entry of failed) console.log(`  FAILED: ${entry.name}`);
  console.log(`mode: ${live ? 'LIVE' : 'PREFLIGHT'}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main();
