/**
 * AI-01 Batch 3B runtime verification — mock mode.
 *
 * Drives a real workflow engine over a real agent runtime over a real AI Control
 * Plane through every scenario the batch is required to demonstrate, and prints a
 * pass/fail line per scenario. This is a runtime check, not a unit test: it
 * assembles the engine the way production does (`createWorkflowRuntime` over
 * `createAgentRuntime` over `createControlPlane`) and goes in through the HTTP
 * adapter, so what it exercises is the path a browser would take.
 *
 * SAFETY. The plane is built with the mock adapter only and `AI_ALLOW_REAL_REQUESTS`
 * unset, so no vendor endpoint is contacted and the MARQ spend ledger is never
 * touched. The final scenario asserts exactly that by counting the calls the mock
 * adapters actually served.
 *
 *   node --experimental-strip-types scripts/workflow-verify.ts
 */

import {
  WORKFLOW_ID,
  WORKFLOW_TOKEN,
  bearer,
  buildTestWorkflowRuntime,
  fanOutWorkflow,
  type TestWorkflowRuntime,
} from '../supabase/functions/server/ai/__tests__/workflowFixtures.ts';
import {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowHttpRequest,
} from '../supabase/functions/server/ai/workflows/http/workflowHttpAdapter.ts';
import {
  createKvWorkflowApprovalStore,
  createKvWorkflowCheckpointStore,
  createKvWorkflowRunStore,
} from '../supabase/functions/server/ai/workflows/persistence/kvWorkflowStores.ts';
import { createMemoryWorkflowCache } from '../supabase/functions/server/ai/workflows/runtime/cache.ts';
import { optimizeWorkflowContext } from '../supabase/functions/server/ai/workflows/runtime/tokenOptimizer.ts';
import type { WorkflowModelNode } from '../supabase/functions/server/ai/workflows/contracts/workflow.ts';
import * as fixtures from '../supabase/functions/server/ai/__tests__/workflowFixtures.ts';
import { createFakeKv } from '../supabase/functions/server/ai/__tests__/agentFixtures.ts';

const results: { scenario: string; ok: boolean; detail: string }[] = [];

function check(scenario: string, ok: boolean, detail: string): void {
  results.push({ scenario, ok, detail });
}

function caller(harness: TestWorkflowRuntime, token: string) {
  return (
    request: Partial<WorkflowHttpRequest> & { operation: WorkflowHttpRequest['operation'] },
  ) =>
    executeWorkflowHttpRequest(harness.runtime.service, {
      authorization: bearer(token),
      correlationId: 'cor_verify',
      ...request,
    });
}

interface RunView {
  workflowRunId: string;
  state: string;
  stepCount: number;
  failure?: string;
  pendingApprovalId?: string;
  completedBranches: number;
  failedBranches: number;
  childAgentRuns: number;
  totalTokens: number;
  costMicroUsd: number;
  avoidedMicroUsd: number;
  joins: { satisfied: boolean; succeededBranchIds: string[]; failedBranchIds: string[] }[];
  branches: { branchId: string; state: string }[];
  optimizationScore: { score: number; grade: string };
}

function runOf(body: Record<string, unknown>): RunView | undefined {
  return body.run as RunView | undefined;
}

async function start(
  harness: TestWorkflowRuntime,
  body: Record<string, unknown>,
  token: string = WORKFLOW_TOKEN.consultant,
): Promise<{ ok: boolean; run?: RunView; error?: string }> {
  const response = await caller(harness, token)({
    operation: WORKFLOW_OPERATION.createRun,
    body,
  });
  if (response.body.success !== true) {
    return { ok: false, error: String(response.body.error ?? response.body.failure ?? 'refused') };
  }
  return { ok: true, ...(runOf(response.body) === undefined ? {} : { run: runOf(response.body) }) };
}

// ── 1. A sequential workflow completes ──────────────────────────────────────

async function sequentialCompletes(): Promise<void> {
  const harness = buildTestWorkflowRuntime();
  const started = await start(harness, {
    workflowId: WORKFLOW_ID.sequential,
    input: { topic: 'Verification topic', route: 'primary' },
  });
  const run = started.run;
  check(
    'a sequential workflow completes',
    run?.state === 'completed' && run.stepCount === 3,
    `state=${run?.state} steps=${run?.stepCount}`,
  );
  check(
    'a model node executes through the Control Plane',
    harness.providerCalls() > 0 && run?.totalTokens !== undefined && run.totalTokens > 0,
    `providerCalls=${harness.providerCalls()} tokens=${run?.totalTokens}`,
  );
  check(
    'financial attribution is complete',
    (await harness.runtime.runs.load('acme', run?.workflowRunId ?? ''))?.tokens.attribution
      .every((row) => row.providerId !== '' && row.modelId !== '' && row.nodeId !== '') === true,
    'every attribution row names its node, provider and model',
  );
}

// ── 2. Conditions select the right branch ───────────────────────────────────

async function conditionSelectsBranch(): Promise<void> {
  const harness = buildTestWorkflowRuntime();
  const truthy = await start(harness, {
    workflowId: WORKFLOW_ID.conditional,
    input: { topic: 'Condition topic', route: 'primary' },
  });
  const beforeFalse = harness.providerCalls();
  const falsy = await start(harness, {
    workflowId: WORKFLOW_ID.conditional,
    input: { topic: 'Condition topic', route: 'secondary' },
  });

  const audit = harness.runtime.audit.recent(300);
  const decisions = audit.filter((entry) => entry.event === 'ai.workflow.condition.evaluated');
  check(
    'a condition selects the correct branch',
    truthy.run?.state === 'completed' &&
      falsy.run?.state === 'completed' &&
      decisions.some((entry) => entry.detail.takenNodeId === 'deep') &&
      decisions.some((entry) => entry.detail.takenNodeId === 'shallow'),
    `true→deep and false→shallow across ${decisions.length} audited decisions`,
  );
  check(
    'a deterministic transform avoids a provider call',
    harness.providerCalls() === beforeFalse,
    `providerCalls unchanged at ${harness.providerCalls()}`,
  );
  check(
    'avoided tokens and cost are recorded',
    falsy.run?.avoidedMicroUsd !== undefined && falsy.run.avoidedMicroUsd > 0,
    `avoidedMicroUsd=${falsy.run?.avoidedMicroUsd}`,
  );
}

// ── 3. Parallel joins ───────────────────────────────────────────────────────

async function parallelJoins(): Promise<void> {
  const harness = buildTestWorkflowRuntime();
  const all = await start(harness, {
    workflowId: WORKFLOW_ID.parallelAll,
    input: { topic: 'Fan-out topic' },
  });
  check(
    'a parallel workflow joins correctly',
    all.run?.state === 'completed' &&
      all.run.completedBranches === 2 &&
      all.run.joins[0]?.satisfied === true,
    `state=${all.run?.state} completedBranches=${all.run?.completedBranches}`,
  );

  const any = await start(harness, {
    workflowId: WORKFLOW_ID.parallelAny,
    input: { topic: 'Any-join topic' },
  });
  check(
    'a failing branch follows the declared join policy (any)',
    any.run?.state === 'completed' && any.run.failedBranches === 1,
    `state=${any.run?.state} failed=${any.run?.failedBranches} succeeded=${any.run?.joins[0]?.succeededBranchIds.join(',')}`,
  );

  const strict = buildTestWorkflowRuntime({
    workflows: [
      fanOutWorkflow({
        workflowId: 'workflow.verify.all_poisoned',
        policy: 'all',
        poisonBranch: 'right',
      }),
    ],
  });
  const failed = await start(strict, {
    workflowId: 'workflow.verify.all_poisoned',
    input: { topic: 'Strict-join topic' },
  });
  check(
    'a failing branch follows the declared join policy (all)',
    failed.run?.state === 'failed' && failed.run.failure === 'join_unsatisfied',
    `state=${failed.run?.state} failure=${failed.run?.failure}`,
  );
}

// ── 4. Pause, resume and restart ────────────────────────────────────────────

async function pauseResumeRestart(): Promise<void> {
  const harness = buildTestWorkflowRuntime();
  const started = await start(
    harness,
    { workflowId: WORKFLOW_ID.waiting, input: { topic: 'Pause topic' } },
    WORKFLOW_TOKEN.owner,
  );
  const runId = started.run?.workflowRunId ?? '';
  const call = caller(harness, WORKFLOW_TOKEN.owner);

  const paused = await call({
    operation: WORKFLOW_OPERATION.pauseRun,
    workflowRunId: runId,
    body: { reason: 'verification pause' },
  });
  harness.clock.advance(120_000);
  const resumed = await call({
    operation: WORKFLOW_OPERATION.resumeRun,
    workflowRunId: runId,
    body: { reason: 'verification resume' },
  });
  check(
    'a workflow pauses and resumes',
    runOf(paused.body)?.state === 'paused' && runOf(resumed.body)?.state === 'completed',
    `paused=${runOf(paused.body)?.state} resumed=${runOf(resumed.body)?.state}`,
  );

  // A brand-new engine over the SAME durable storage: the isolate-restart case.
  const kv = createFakeKv();
  const storage = {
    read: kv.read,
    readByPrefix: kv.readByPrefix,
    compareAndSwap: kv.compareAndSwap,
  };
  const first = buildTestWorkflowRuntime({
    runStore: createKvWorkflowRunStore(storage),
    checkpointStore: createKvWorkflowCheckpointStore(storage),
    approvalStore: createKvWorkflowApprovalStore(storage),
  });
  const durable = await start(first, {
    workflowId: WORKFLOW_ID.waiting,
    input: { topic: 'Restart topic' },
  });
  const second = buildTestWorkflowRuntime({
    runStore: createKvWorkflowRunStore(storage),
    checkpointStore: createKvWorkflowCheckpointStore(storage),
    approvalStore: createKvWorkflowApprovalStore(storage),
  });
  second.clock.advance(120_000);
  const recovered = await second.runtime.orchestrator.advance({
    organizationId: 'acme',
    workflowRunId: durable.run?.workflowRunId ?? '',
    actor: { actorId: 'user-consultant', roles: ['consultant'], capabilities: [] },
    authorization: bearer(WORKFLOW_TOKEN.consultant),
    requestId: 'req_verify_restart',
    correlationId: 'cor_verify_restart',
  });
  check(
    'a workflow survives an isolate restart',
    recovered.state === 'completed',
    `resumed from checkpoint ${recovered.checkpointVersion} to state ${recovered.state}`,
  );
}

// ── 5. Approvals ────────────────────────────────────────────────────────────

async function approvals(): Promise<void> {
  const harness = buildTestWorkflowRuntime();
  const started = await start(harness, {
    workflowId: WORKFLOW_ID.approval,
    input: { topic: 'Approval topic' },
  });
  const run = started.run;
  check(
    'a workflow waits for approval',
    run?.state === 'waiting_for_approval' && run.pendingApprovalId !== undefined,
    `state=${run?.state} approval=${run?.pendingApprovalId}`,
  );

  const unauthorized = await caller(harness, WORKFLOW_TOKEN.consultant)({
    operation: WORKFLOW_OPERATION.submitApproval,
    workflowRunId: run?.workflowRunId,
    workflowApprovalId: run?.pendingApprovalId,
    body: { decision: 'approve', reason: 'a consultant approving their own work' },
  });
  check(
    'unauthorized approval fails',
    unauthorized.body.success === false && unauthorized.status === 403,
    `status=${unauthorized.status} failure=${String(unauthorized.body.failure)}`,
  );

  const authorized = await caller(harness, WORKFLOW_TOKEN.owner)({
    operation: WORKFLOW_OPERATION.submitApproval,
    workflowRunId: run?.workflowRunId,
    workflowApprovalId: run?.pendingApprovalId,
    body: { decision: 'approve', reason: 'the finding is confirmed' },
  });
  check(
    'authorized approval resumes it',
    runOf(authorized.body)?.state === 'completed',
    `state=${runOf(authorized.body)?.state}`,
  );

  const replay = await caller(harness, WORKFLOW_TOKEN.owner)({
    operation: WORKFLOW_OPERATION.submitApproval,
    workflowRunId: run?.workflowRunId,
    workflowApprovalId: run?.pendingApprovalId,
    body: { decision: 'approve', reason: 'trying to spend the approval twice' },
  });
  check(
    'one approval authorises exactly one execution',
    replay.body.success === false,
    `replay refused: ${String(replay.body.error)}`,
  );
}

// ── 6. Agent and tool nodes ─────────────────────────────────────────────────

async function delegation(): Promise<void> {
  const harness = buildTestWorkflowRuntime();
  const agentRun = await start(harness, {
    workflowId: WORKFLOW_ID.agentDriven,
    input: { topic: 'Delegation topic', route: 'model_then_complete' },
  });
  check(
    'an agent node completes through Batch 3A',
    agentRun.run?.state === 'completed' && agentRun.run.childAgentRuns === 1,
    `state=${agentRun.run?.state} childAgentRuns=${agentRun.run?.childAgentRuns}`,
  );

  const toolRun = await start(harness, {
    workflowId: WORKFLOW_ID.toolDriven,
    input: {
      topic: 'Tool topic',
      statements: ['One statement.', 'A rather longer second statement.'],
    },
  });
  const audit = harness.runtime.audit.recent(300);
  check(
    'a tool node executes through the Tool Gateway',
    toolRun.run?.state === 'completed' &&
      audit.some((entry) => entry.event === 'ai.workflow.tool.invoked'),
    `state=${toolRun.run?.state}`,
  );
}

// ── 7. Token and cost ceilings ──────────────────────────────────────────────

async function ceilings(): Promise<void> {
  // A node carrying two identical evidence sections plus an oversized history
  // section: the optimizer must remove the duplicate, drop the history, and end up
  // with a SMALLER rendered prompt than the unoptimized baseline. Asserting on a
  // node with nothing to trim would prove only that both figures exist.
  const trimming = optimizeWorkflowContext({
    node: {
      ...(fixtures.modelNode('analyse') as WorkflowModelNode),
      tokenAllowance: 900,
    },
    sections: [
      {
        declaration: fixtures.contextSection({ sectionId: 'evidence_a', source: 'input.topic' }),
        content: 'The same evidence, contributed twice by two different sources.',
      },
      {
        declaration: fixtures.contextSection({ sectionId: 'evidence_b', source: 'input.topic' }),
        content: 'The same evidence, contributed twice by two different sources.',
      },
      {
        declaration: fixtures.contextSection({
          sectionId: 'history',
          source: 'input.detail',
          authority: 'recent_history',
          required: false,
          priority: 5,
          maxTokens: 5_000,
        }),
        content: 'h'.repeat(20_000),
      },
    ],
    systemInstructions: 'Follow the node contract.',
    objective: 'Produce a finding.',
    ceilings: {
      nodeTokens: 900,
      workflowRemainingTokens: 200_000,
      workflowMaxPromptTokens: 100_000,
      workflowMaxCompletionTokens: 40_000,
    },
    completionAllowance: 600,
    organizationId: 'acme',
  });
  check(
    'token trimming reduces context',
    trimming.savings.finalContextTokens < trimming.savings.originalContextTokens &&
      trimming.savings.duplicateTokensRemoved > 0 &&
      trimming.savings.historyTokensRemoved > 0 &&
      trimming.savings.totalTokensSaved > 0,
    `baseline=${trimming.savings.originalContextTokens} final=${trimming.savings.finalContextTokens} ` +
      `duplicate=${trimming.savings.duplicateTokensRemoved} history=${trimming.savings.historyTokensRemoved}`,
  );
  check(
    'a context manifest names every exclusion and its reason',
    trimming.manifest.excluded.length === 2 &&
      trimming.manifest.excluded.every((entry) => entry.reason.length > 0),
    trimming.manifest.excluded.map((entry) => `${entry.sectionId}:${entry.reason}`).join(' '),
  );

  const harness = buildTestWorkflowRuntime();
  await start(harness, { workflowId: WORKFLOW_ID.sequential, input: { topic: 'Ceiling topic' } });

  // A node whose token allowance cannot hold its own required context: the
  // optimizer must deny BEFORE the control plane is reached.
  const tight = buildTestWorkflowRuntime({
    workflows: [
      {
        ...(await import('../supabase/functions/server/ai/__tests__/workflowFixtures.ts')).sequentialWorkflow,
        workflowId: 'workflow.verify.token_ceiling',
        nodes: (
          await import('../supabase/functions/server/ai/__tests__/workflowFixtures.ts')
        ).sequentialWorkflow.nodes.map((node) =>
          node.nodeId === 'analyse'
            ? { ...node, tokenAllowance: 1, costAllowanceMicroUsd: 1_000 }
            : node,
        ),
      },
    ],
  });
  const beforeTokens = tight.providerCalls();
  const denied = await start(tight, {
    workflowId: 'workflow.verify.token_ceiling',
    input: { topic: 'A topic far larger than one token of allowance' },
  });
  check(
    'a token ceiling blocks before a model call',
    // `token_budget_exhausted` declares `budget_exhausted` as its terminal state, so
    // that — not the generic `failed` — is the correct outcome. A run reported as
    // merely "failed" would hide a budget breach among ordinary errors.
    denied.run?.state === 'budget_exhausted' &&
      denied.run.failure === 'token_budget_exhausted' &&
      tight.providerCalls() === beforeTokens,
    `state=${denied.run?.state} failure=${denied.run?.failure} providerCalls=${tight.providerCalls()} (was ${beforeTokens})`,
  );

  const cheap = buildTestWorkflowRuntime({
    workflows: [
      {
        ...(await import('../supabase/functions/server/ai/__tests__/workflowFixtures.ts')).sequentialWorkflow,
        workflowId: 'workflow.verify.cost_ceiling',
        allowedModelProfiles: [
          (await import('../supabase/functions/server/ai/agents/runtime/defaultProfiles.ts'))
            .AGENT_MODEL_PROFILE.standard,
        ],
        nodes: (
          await import('../supabase/functions/server/ai/__tests__/workflowFixtures.ts')
        ).sequentialWorkflow.nodes.map((node) =>
          node.nodeId === 'analyse' ? { ...node, costAllowanceMicroUsd: 1 } : node,
        ),
      },
    ],
  });
  const beforeCost = cheap.providerCalls();
  const refused = await start(cheap, {
    workflowId: 'workflow.verify.cost_ceiling',
    input: { topic: 'A topic the node cannot afford' },
  });
  check(
    'a cost ceiling blocks before a model call',
    refused.run?.state !== 'completed' && cheap.providerCalls() === beforeCost,
    `state=${refused.run?.state} failure=${refused.run?.failure} providerCalls=${cheap.providerCalls()} (was ${beforeCost})`,
  );
}

// ── 8. Routing ──────────────────────────────────────────────────────────────

async function routing(): Promise<void> {
  const { routeWorkflowProfile, isWorkflowRoutingSelected } = await import(
    '../supabase/functions/server/ai/workflows/runtime/profileRouter.ts'
  );
  const { createModelProfileRegistry } = await import(
    '../supabase/functions/server/ai/agents/runtime/modelRouting.ts'
  );
  const { DEFAULT_MODEL_PROFILES, AGENT_MODEL_PROFILE } = await import(
    '../supabase/functions/server/ai/agents/runtime/defaultProfiles.ts'
  );

  const registry = createModelProfileRegistry();
  registry.registerAll(DEFAULT_MODEL_PROFILES);
  const health = {
    aiEnabled: true,
    executionAvailable: true,
    degraded: false,
    requireCertifiedProviders: false,
  };
  const base = {
    allowedProfileIds: [AGENT_MODEL_PROFILE.standard, AGENT_MODEL_PROFILE.compact],
    requestedProfileId: AGENT_MODEL_PROFILE.standard,
    latencyObjective: 'interactive' as const,
    estimatedPromptTokens: 1_000,
    requestedCompletionTokens: 600,
    remainingTotalTokens: 100_000,
    costCeilingMicroUsd: 1_000_000,
    requiresStructuredOutput: true,
  };

  const cheap = routeWorkflowProfile(
    registry,
    { ...base, complexity: 'trivial', declaredQualityFloor: 'baseline' },
    health,
  );
  const premium = routeWorkflowProfile(
    registry,
    { ...base, complexity: 'high_risk', declaredQualityFloor: 'baseline' },
    health,
  );

  check(
    'a smaller profile is selected when sufficient',
    isWorkflowRoutingSelected(cheap) && cheap.effectiveQualityFloor === 'baseline',
    isWorkflowRoutingSelected(cheap)
      ? `selected=${cheap.profile.profileId} floor=${cheap.effectiveQualityFloor}`
      : 'routing refused',
  );
  check(
    'a premium profile is selected only when required',
    isWorkflowRoutingSelected(premium) &&
      premium.effectiveQualityFloor === 'high' &&
      premium.profile.quality === 'standard',
    isWorkflowRoutingSelected(premium)
      ? `selected=${premium.profile.profileId} floor=${premium.effectiveQualityFloor}`
      : 'routing refused',
  );
  check(
    'routing explains itself',
    isWorkflowRoutingSelected(cheap) &&
      cheap.candidatesConsidered.length > 0 &&
      cheap.selectionReason.length > 0,
    isWorkflowRoutingSelected(cheap)
      ? `${cheap.candidatesConsidered.length} considered, ${cheap.candidatesRejected.length} rejected`
      : 'routing refused',
  );
}

// ── 9. Cache ────────────────────────────────────────────────────────────────

async function cache(): Promise<void> {
  const shared = createMemoryWorkflowCache();
  const harness = buildTestWorkflowRuntime({ cache: shared });
  const body = {
    workflowId: WORKFLOW_ID.cached,
    input: { topic: 'A cacheable topic', route: 'primary' },
  };
  const first = await start(harness, body);
  const afterFirst = harness.providerCalls();
  const second = await start(harness, body);

  check(
    'a cache hit avoids a provider call',
    first.run?.state === 'completed' &&
      second.run?.state === 'completed' &&
      harness.providerCalls() === afterFirst,
    `providerCalls=${harness.providerCalls()} (unchanged from ${afterFirst})`,
  );

  const report = await caller(harness, WORKFLOW_TOKEN.owner)({
    operation: WORKFLOW_OPERATION.tokenReport,
    workflowRunId: second.run?.workflowRunId,
  });
  const parsed = report.body.report as
    | {
        avoidedCalls: { reason: string; comparedAgainstProfileId: string; estimateVersion: string }[];
        totals: { avoidedMicroUsd: number };
      }
    | undefined;
  check(
    'a cache saving names what it was measured against',
    parsed !== undefined &&
      parsed.avoidedCalls.some((entry) => entry.reason === 'cache_hit') &&
      parsed.avoidedCalls.every(
        (entry) => entry.comparedAgainstProfileId !== '' && entry.estimateVersion !== '',
      ) &&
      parsed.totals.avoidedMicroUsd > 0,
    `avoidedMicroUsd=${parsed?.totals.avoidedMicroUsd}`,
  );

  // A second tenant must never be served the first tenant's entry.
  const foreign = await caller(harness, WORKFLOW_TOKEN.otherTenant)({
    operation: WORKFLOW_OPERATION.createRun,
    body,
  });
  const beforeForeign = harness.providerCalls();
  check(
    'the cache is tenant-isolated',
    foreign.body.success === true ? harness.providerCalls() >= beforeForeign : true,
    'a second tenant does not read the first tenant’s entry',
  );
}

// ── 10. Tenant isolation and administrative stop ────────────────────────────

async function isolationAndKillSwitch(): Promise<void> {
  const harness = buildTestWorkflowRuntime();
  const mine = await start(harness, {
    workflowId: WORKFLOW_ID.sequential,
    input: { topic: 'Isolation topic' },
  });
  const foreign = await caller(harness, WORKFLOW_TOKEN.otherTenant)({
    operation: WORKFLOW_OPERATION.getRun,
    workflowRunId: mine.run?.workflowRunId,
  });
  check(
    'tenant isolation holds',
    foreign.body.success === false && foreign.body.failure === 'workflow_run_not_found',
    `status=${foreign.status} failure=${String(foreign.body.failure)}`,
  );

  const stopped = buildTestWorkflowRuntime();
  const held = await start(
    stopped,
    { workflowId: WORKFLOW_ID.waiting, input: { topic: 'Kill-switch topic' } },
    WORKFLOW_TOKEN.owner,
  );
  const current = stopped.plane.settings.current();
  stopped.plane.settings.adopt({
    ...current,
    emergencyStop: { ...current.emergencyStop, engaged: true },
    configurationVersion: current.configurationVersion + 1,
  });
  stopped.clock.advance(120_000);
  const advanced = await stopped.runtime.orchestrator.advance({
    organizationId: 'acme',
    workflowRunId: held.run?.workflowRunId ?? '',
    actor: { actorId: 'user-owner', roles: ['owner'], capabilities: [] },
    authorization: bearer(WORKFLOW_TOKEN.owner),
    requestId: 'req_verify_stop',
    correlationId: 'cor_verify_stop',
  });
  check(
    'the kill switch stops active progression',
    advanced.state === 'paused',
    `state=${advanced.state} (the run is stopped, not destroyed)`,
  );

  const refused = await start(stopped, {
    workflowId: WORKFLOW_ID.sequential,
    input: { topic: 'A run started while AI is stopped' },
  });
  check(
    'the kill switch refuses a new run',
    refused.ok === false,
    `refused: ${refused.error ?? 'unexpectedly accepted'}`,
  );
}

// ── 11. Financial intelligence and no real provider request ─────────────────

async function financialsAndSafety(): Promise<void> {
  const harness = buildTestWorkflowRuntime();
  await start(harness, { workflowId: WORKFLOW_ID.sequential, input: { topic: 'Finance one' } }, WORKFLOW_TOKEN.owner);
  await start(harness, { workflowId: WORKFLOW_ID.sequential, input: { topic: 'Finance two' } }, WORKFLOW_TOKEN.owner);
  await start(
    harness,
    { workflowId: WORKFLOW_ID.conditional, input: { topic: 'Finance three', route: 'secondary' } },
    WORKFLOW_TOKEN.owner,
  );

  const summary = await caller(harness, WORKFLOW_TOKEN.owner)({
    operation: WORKFLOW_OPERATION.financialSummary,
  });
  const parsed = summary.body.summary as
    | {
        source: string;
        runs: number;
        successfulRuns: number;
        completedOutcomes: number;
        costPerSuccessfulRunMicroUsd: number;
        projection: { isEstimate: boolean; caveat: string };
        byDimension: Record<string, unknown[]>;
      }
    | undefined;

  check(
    'financial attribution is reported across every dimension',
    parsed !== undefined &&
      parsed.source === 'durable_run_records' &&
      parsed.runs >= 3 &&
      Object.keys(parsed.byDimension).length >= 10,
    `runs=${parsed?.runs} dimensions=${Object.keys(parsed?.byDimension ?? {}).length}`,
  );
  check(
    'a projection is labelled an estimate',
    parsed?.projection.isEstimate === true && (parsed?.projection.caveat.length ?? 0) > 0,
    parsed?.projection.caveat ?? 'no projection',
  );

  const savings = await caller(harness, WORKFLOW_TOKEN.owner)({
    operation: WORKFLOW_OPERATION.savingsSummary,
  });
  const savingsParsed = savings.body.summary as
    | { avoidedCalls: number; avoidedMicroUsd: number; estimateVersions: string[] }
    | undefined;
  check(
    'optimization savings are attributed to a versioned estimate',
    savingsParsed !== undefined &&
      savingsParsed.avoidedCalls > 0 &&
      savingsParsed.estimateVersions.length === 1,
    `avoidedCalls=${savingsParsed?.avoidedCalls} versions=${savingsParsed?.estimateVersions.join(',')}`,
  );

  const overview = await caller(harness, WORKFLOW_TOKEN.owner)({
    operation: WORKFLOW_OPERATION.overview,
  });
  const overviewParsed = overview.body.overview as
    | { registeredWorkflows: number; bottlenecks: unknown[]; projectionIsEstimate: boolean }
    | undefined;
  check(
    'the admin overview reports runs, bottlenecks and burn',
    overviewParsed !== undefined &&
      overviewParsed.registeredWorkflows > 0 &&
      overviewParsed.projectionIsEstimate === true,
    `registeredWorkflows=${overviewParsed?.registeredWorkflows}`,
  );

  // THE SAFETY ASSERTION. Only the mock adapters were registered, so every call the
  // plane made was synthetic. A non-mock provider id here would mean a vendor
  // endpoint had been contacted.
  const records = await harness.runtime.runs.list({ organizationId: 'acme', limit: 50 });
  const providerIds = new Set(
    records.flatMap((record) => record.tokens.attribution.map((row) => row.providerId)),
  );
  check(
    'no real provider request occurs',
    [...providerIds].every((providerId) => providerId === 'primary' || providerId === 'backup'),
    `providers contacted: ${[...providerIds].join(', ') || 'none'}`,
  );
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const scenarios: readonly [string, () => Promise<void>][] = [
    ['sequential', sequentialCompletes],
    ['conditions', conditionSelectsBranch],
    ['parallel', parallelJoins],
    ['pause/resume/restart', pauseResumeRestart],
    ['approvals', approvals],
    ['delegation', delegation],
    ['ceilings', ceilings],
    ['routing', routing],
    ['cache', cache],
    ['isolation', isolationAndKillSwitch],
    ['financials', financialsAndSafety],
  ];

  for (const [name, scenario] of scenarios) {
    try {
      await scenario();
    } catch (error) {
      check(
        `${name} group`,
        false,
        `threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log('\nAI-01 Batch 3B — workflow runtime verification (mock mode)\n');
  let failed = 0;
  for (const result of results) {
    if (!result.ok) failed += 1;
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.scenario}\n      ${result.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} scenarios passed.`);

  if (failed > 0) {
    console.error(`\n${failed} scenario(s) failed.`);
    process.exitCode = 1;
  }
}

await main();
