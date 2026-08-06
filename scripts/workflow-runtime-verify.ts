/**
 * AI-01 Batch 3B runtime verification — mock mode.
 *
 * Drives a real workflow runtime over a real agent runtime over a real AI
 * Control Plane through every scenario the batch is required to demonstrate,
 * and prints a pass/fail line per scenario. This is a runtime check, not a unit
 * test: it assembles the runtime the way production does
 * (`createWorkflowRuntime` over `createAgentRuntime` over `createControlPlane`)
 * and goes in through the HTTP adapter, so what it exercises is the path a
 * browser would take.
 *
 * SAFETY. The plane is built with the mock adapter only and
 * `AI_ALLOW_REAL_REQUESTS` unset, so no vendor endpoint is contacted and the
 * MARQ spend ledger is never touched. The final scenario asserts exactly that.
 *
 *   node --experimental-strip-types scripts/workflow-runtime-verify.ts
 */

import {
  AGENT_TOKEN,
  FIXTURE_WORKFLOWS,
  WORKFLOW_ID,
  bearer,
  buildTestWorkflowRuntime,
  createFakeKv,
  cyclicWorkflow,
  workflowBody,
} from '../supabase/functions/server/ai/__tests__/workflowFixtures.ts';
import {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowHttpRequest,
} from '../supabase/functions/server/ai/workflows/http/workflowHttpAdapter.ts';
import {
  createKvWorkflowCheckpointStore,
  createKvWorkflowRunStore,
} from '../supabase/functions/server/ai/workflows/persistence/kvWorkflowStores.ts';
import {
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
} from '../supabase/functions/server/ai/agents/persistence/kvAgentStores.ts';
import { planWorkflow } from '../supabase/functions/server/ai/workflows/planner/workflowPlanner.ts';
import { createWorkflowRegistry } from '../supabase/functions/server/ai/workflows/registry/workflowRegistry.ts';
import {
  AGENT_ID,
  buildTestAgentRuntime,
} from '../supabase/functions/server/ai/__tests__/agentFixtures.ts';
import type { CreateRunRequest } from '../supabase/functions/server/ai/agents/service/agentRuntimeService.ts';
import { AGENT_MODEL_PROFILE } from '../supabase/functions/server/ai/agents/runtime/defaultProfiles.ts';

/** The typed agent run request the optimisation scenarios drive. */
const agentRun: CreateRunRequest = {
  agentId: AGENT_ID.primary,
  objective: 'Establish a deterministic finding for the supplied topic.',
  input: { topic: 'Intake handoffs', script: 'model_then_complete' },
};

const results: { scenario: string; ok: boolean; detail: string }[] = [];

function check(scenario: string, ok: boolean, detail: string): void {
  results.push({ scenario, ok, detail });
}

type Harness = ReturnType<typeof buildTestWorkflowRuntime>;

function caller(harness: Harness, token: string) {
  return (
    request: Partial<WorkflowHttpRequest> & { operation: WorkflowHttpRequest['operation'] },
  ) =>
    executeWorkflowHttpRequest(harness.runtime.service, {
      authorization: bearer(token),
      ...request,
    });
}

interface RunView {
  workflowRunId: string;
  state: string;
  plan: string[][];
  maxParallel: number;
  planDigest: string;
  checkpointVersion: number;
  nodeExecutions: number;
  agentRunIds: string[];
  factKeys: string[];
  pendingApprovalId?: string;
  failure?: string;
  terminalNodeId?: string;
  costMicroUsd: number;
  avoidedMicroUsd: number;
  optimizationScore: number;
  nodes: { nodeId: string; state: string; skipReason?: string }[];
}

function runOf(body: Record<string, unknown>): RunView {
  return body.run as unknown as RunView;
}

function nodeState(run: RunView, nodeId: string): string {
  return run.nodes.find((node) => node.nodeId === nodeId)?.state ?? 'missing';
}

async function main(): Promise<void> {
  // 1 — a sequential plan completes
  {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody(),
        })
      ).body,
    );
    check(
      'a sequential plan completes',
      run.state === 'completed' && run.terminalNodeId === 'done',
      `state=${run.state} terminal=${run.terminalNodeId ?? 'none'} agentRuns=${run.agentRunIds.length}`,
    );
  }

  // 2 — an independent layer runs as one bounded wave
  {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.parallel }),
        })
      ).body,
    );
    const widest = Math.max(...run.plan.map((wave) => wave.length));
    check(
      'a parallel layer runs as one bounded wave',
      run.state === 'completed' && widest <= run.maxParallel && run.agentRunIds.length === 3,
      `state=${run.state} waves=${run.plan.map((w) => w.join('+')).join(' → ')} widest=${widest}/${run.maxParallel}`,
    );
  }

  // 3 — a condition selects one branch and skips the other
  {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.conditional }),
        })
      ).body,
    );
    check(
      'a condition selects one branch and skips the other',
      run.state === 'completed' &&
        nodeState(run, 'approved') === 'succeeded' &&
        nodeState(run, 'rejected') === 'skipped',
      `approved=${nodeState(run, 'approved')} rejected=${nodeState(run, 'rejected')}`,
    );
  }

  // 4 — a quorum join tolerates an optional failure
  {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.quorum }),
        })
      ).body,
    );
    check(
      'a quorum join tolerates an optional failure',
      run.state === 'completed' && nodeState(run, 'c') === 'failed',
      `state=${run.state} a=${nodeState(run, 'a')} b=${nodeState(run, 'b')} c=${nodeState(run, 'c')}`,
    );
  }

  // 5 — a tool node runs under a named agent's permission
  {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.tool }),
        })
      ).body,
    );
    check(
      'a tool node runs through the certified gateway',
      run.state === 'completed' &&
        nodeState(run, 'lookup') === 'succeeded' &&
        run.agentRunIds.length === 0,
      `state=${run.state} lookup=${nodeState(run, 'lookup')} facts=${run.factKeys.join(',')}`,
    );
  }

  // 6, 7, 8 — approvals: park, unauthorised refusal, sign-off
  {
    const harness = buildTestWorkflowRuntime();
    const consultant = caller(harness, AGENT_TOKEN.consultant);
    const owner = caller(harness, AGENT_TOKEN.owner);

    const parked = runOf(
      (
        await consultant({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );
    check(
      'a plan parks on a human decision',
      parked.state === 'waiting_for_approval' && Boolean(parked.pendingApprovalId),
      `state=${parked.state} approval=${parked.pendingApprovalId ?? 'none'}`,
    );

    const unauthorised = await consultant({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: parked.workflowRunId,
      approvalId: parked.pendingApprovalId,
      body: { decision: 'approve', reason: 'approving my own request' },
    });
    check(
      'an unauthorised approver is refused',
      unauthorised.status === 403,
      `status=${unauthorised.status}`,
    );

    const approved = runOf(
      (
        await owner({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: parked.workflowRunId,
          approvalId: parked.pendingApprovalId,
          body: { decision: 'approve', reason: 'authorised by the owner' },
        })
      ).body,
    );
    const reused = await owner({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: parked.workflowRunId,
      approvalId: parked.pendingApprovalId,
      body: { decision: 'approve', reason: 'trying to reuse the approval' },
    });
    check(
      'an authorised sign-off releases the plan, and cannot be reused',
      approved.state === 'completed' && reused.status >= 400,
      `state=${approved.state} reuseStatus=${reused.status}`,
    );
  }

  // 9 — a parked plan survives a simulated isolate restart
  {
    const kv = createFakeKv();
    const options = {
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
    };
    const stores = () => ({
      runStore: createKvWorkflowRunStore(options),
      checkpointStore: createKvWorkflowCheckpointStore(options),
      agentRunStore: createKvAgentRunStore(options),
      agentCheckpointStore: createKvAgentCheckpointStore(options),
    });

    const first = buildTestWorkflowRuntime(stores());
    const parked = runOf(
      (
        await caller(first, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );

    // A brand new runtime — nothing in memory carries over.
    const second = buildTestWorkflowRuntime({
      ...stores(),
      approvalStore: first.approvalStore,
    });
    const resumed = runOf(
      (
        await caller(second, AGENT_TOKEN.owner)({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: parked.workflowRunId,
          approvalId: parked.pendingApprovalId,
          body: { decision: 'approve', reason: 'decided by a fresh isolate' },
        })
      ).body,
    );
    check(
      'a parked plan survives a simulated isolate restart',
      resumed.state === 'completed',
      `recovered state=${resumed.state} checkpoints=${resumed.checkpointVersion}`,
    );
  }

  // 10 — concurrent isolates cannot both advance one plan
  {
    const kv = createFakeKv();
    const options = {
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
    };
    const stores = () => ({
      runStore: createKvWorkflowRunStore(options),
      checkpointStore: createKvWorkflowCheckpointStore(options),
      agentRunStore: createKvAgentRunStore(options),
      agentCheckpointStore: createKvAgentCheckpointStore(options),
    });
    const isolateA = buildTestWorkflowRuntime(stores());
    const isolateB = buildTestWorkflowRuntime(stores());
    const parked = runOf(
      (
        await caller(isolateA, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );
    const both = await Promise.all([
      caller(isolateA, AGENT_TOKEN.owner)({
        operation: WORKFLOW_OPERATION.submitApproval,
        workflowRunId: parked.workflowRunId,
        approvalId: parked.pendingApprovalId,
        body: { decision: 'approve', reason: 'isolate A decides' },
      }),
      caller(isolateB, AGENT_TOKEN.owner)({
        operation: WORKFLOW_OPERATION.submitApproval,
        workflowRunId: parked.workflowRunId,
        approvalId: parked.pendingApprovalId,
        body: { decision: 'approve', reason: 'isolate B decides' },
      }),
    ]);
    const winners = both.filter((response) => response.status === 200).length;
    check(
      'concurrent isolates cannot both advance one plan',
      winners === 1,
      `winners=${winners}`,
    );
  }

  // 11 — a checkpoint is written per wave and cannot be rewritten
  {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.parallel }),
        })
      ).body,
    );
    const history = await harness.runtime.checkpoints.history('acme', run.workflowRunId);
    let rewriteRefused = false;
    try {
      await harness.runtime.checkpoints.write(history[0]);
    } catch {
      rewriteRefused = true;
    }
    check(
      'checkpoints are written per wave and are immutable',
      history.length >= 2 && rewriteRefused,
      `checkpoints=${history.length} rewriteRefused=${rewriteRefused}`,
    );
  }

  // 12 — an unorderable plan is refused before it can run
  {
    let plannerRefused = false;
    try {
      planWorkflow(cyclicWorkflow);
    } catch {
      plannerRefused = true;
    }
    let registryRefused = false;
    try {
      createWorkflowRegistry({
        requireCertification: () => false,
        agentExists: () => true,
        toolExists: () => true,
        agentMayUseTool: () => true,
      }).register(cyclicWorkflow);
    } catch {
      registryRefused = true;
    }
    check(
      'an unorderable plan is refused at registration and at planning',
      plannerRefused && registryRefused,
      `planner=${plannerRefused} registry=${registryRefused}`,
    );
  }

  // 13 — a run refuses to continue against an edited definition
  {
    const kv = createFakeKv();
    const options = {
      read: kv.read,
      readByPrefix: kv.readByPrefix,
      compareAndSwap: kv.compareAndSwap,
    };
    const stores = () => ({
      runStore: createKvWorkflowRunStore(options),
      checkpointStore: createKvWorkflowCheckpointStore(options),
      agentRunStore: createKvAgentRunStore(options),
      agentCheckpointStore: createKvAgentCheckpointStore(options),
    });
    const first = buildTestWorkflowRuntime(stores());
    const parked = runOf(
      (
        await caller(first, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody({ workflowId: WORKFLOW_ID.approval }),
        })
      ).body,
    );
    const definition = FIXTURE_WORKFLOWS.find(
      (workflow) => workflow.workflowId === WORKFLOW_ID.approval,
    );
    if (!definition) throw new Error('the approval fixture workflow is missing');
    const edited = {
      ...definition,
      limits: { ...definition.limits, maxParallel: 1 },
    };
    const second = buildTestWorkflowRuntime({
      ...stores(),
      approvalStore: first.approvalStore,
      workflows: [edited],
    });
    const after = runOf(
      (
        await caller(second, AGENT_TOKEN.owner)({
          operation: WORKFLOW_OPERATION.submitApproval,
          workflowRunId: parked.workflowRunId,
          approvalId: parked.pendingApprovalId,
          body: { decision: 'approve', reason: 'decided against an edited definition' },
        })
      ).body,
    );
    check(
      'a frozen plan refuses a definition that changed underneath it',
      after.state === 'failed' && after.failure === 'workflow_invalid',
      `state=${after.state} failure=${after.failure ?? 'none'}`,
    );
  }

  // 14 — tenant isolation
  {
    const harness = buildTestWorkflowRuntime();
    const run = runOf(
      (
        await caller(harness, AGENT_TOKEN.consultant)({
          operation: WORKFLOW_OPERATION.createRun,
          body: workflowBody(),
        })
      ).body,
    );
    const foreign = await caller(harness, AGENT_TOKEN.otherTenant)({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: run.workflowRunId,
    });
    const platform = await caller(harness, AGENT_TOKEN.platform)({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: run.workflowRunId,
      organizationId: 'acme',
    });
    check(
      'tenant isolation prevents cross-organization access',
      foreign.status === 404 && platform.status === 200,
      `foreign=${foreign.status} platformOperator=${platform.status}`,
    );
  }

  // 15 — the kill switch stops a new plan
  {
    const harness = buildTestWorkflowRuntime();
    const settings = harness.plane.settings.current();
    harness.plane.settings.adopt({
      ...settings,
      configurationVersion: settings.configurationVersion + 1,
      emergencyStop: {
        engaged: true,
        reason: 'runtime verification',
        engagedBy: 'ops',
        engagedAt: harness.clock.isoNow(),
      },
    });
    const refused = await caller(harness, AGENT_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowBody(),
    });
    check(
      'the emergency kill switch refuses a new plan',
      refused.status >= 400 && refused.body.failure === 'workflow_runtime_disabled',
      `status=${refused.status} failure=${String(refused.body.failure)}`,
    );
  }

  // 16 — the plan's decisions are auditable, and carry no fact values
  {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    await call({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowBody({ workflowId: WORKFLOW_ID.conditional }),
    });
    const records = (await call({ operation: WORKFLOW_OPERATION.audit, limit: 200 })).body
      .records as { event: string }[];
    const events = new Set(records.map((record) => record.event));
    const serialized = JSON.stringify(records);
    check(
      'the plan’s decisions are auditable and carry no fact values',
      events.has('ai.workflow.node.skipped') &&
        events.has('ai.workflow.wave.started') &&
        events.has('ai.workflow.run.terminated') &&
        !serialized.includes('Finding for gate'),
      `events=${events.size} contentLeak=${serialized.includes('Finding for gate')}`,
    );
  }

  // 17 — minimum-capable routing chooses a cheaper profile, and can be turned off
  {
    const optimised = buildTestAgentRuntime();
    const meta = optimised.meta(AGENT_TOKEN.consultant);
    const actor = await optimised.runtime.service.authorize(meta);
    const run = await optimised.runtime.service.createRun(actor, agentRun, meta);
    const steps = await optimised.runtime.service.getRunSteps(actor, run.runId);
    const optimisedProfile = steps.find((step) => step.actionType === 'model_call')?.modelProfileId;

    const certified = buildTestAgentRuntime({
      optimization: { contextReduction: false, minimumCapableRouting: false },
    });
    const baseMeta = certified.meta(AGENT_TOKEN.consultant);
    const baseActor = await certified.runtime.service.authorize(baseMeta);
    const baseRun = await certified.runtime.service.createRun(baseActor, agentRun, baseMeta);
    const baseSteps = await certified.runtime.service.getRunSteps(baseActor, baseRun.runId);
    const baseProfile = baseSteps.find((step) => step.actionType === 'model_call')?.modelProfileId;

    check(
      'minimum-capable routing is effective and reversible',
      optimisedProfile === AGENT_MODEL_PROFILE.compact &&
        baseProfile === AGENT_MODEL_PROFILE.standard,
      `optimised=${optimisedProfile ?? 'none'} switchedOff=${baseProfile ?? 'none'}`,
    );
  }

  // 18 — a cache hit avoids a call and charges nothing
  {
    const harness = buildTestAgentRuntime({
      optimization: { cacheEnabled: true, cacheTtlMs: 600_000 },
    });
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);
    const first = await harness.runtime.service.createRun(actor, agentRun, meta);
    const second = await harness.runtime.service.createRun(actor, agentRun, meta);
    check(
      'a cache hit avoids a call and charges nothing',
      first.optimization.avoidedCalls === 0 &&
        second.optimization.avoidedCalls === 1 &&
        second.cost.actualMicroUsd === 0 &&
        second.tokens.actualTotalTokens === 0,
      `firstAvoided=${first.optimization.avoidedCalls} secondAvoided=${second.optimization.avoidedCalls} ` +
        `secondCost=${second.cost.actualMicroUsd}`,
    );
  }

  // 19 — one tenant's cached answer is never served to another
  {
    const harness = buildTestAgentRuntime({
      optimization: { cacheEnabled: true, cacheTtlMs: 600_000 },
    });
    const acmeMeta = harness.meta(AGENT_TOKEN.consultant);
    const acme = await harness.runtime.service.authorize(acmeMeta);
    await harness.runtime.service.createRun(acme, agentRun, acmeMeta);

    const globexMeta = harness.meta(AGENT_TOKEN.otherTenant);
    const globex = await harness.runtime.service.authorize(globexMeta);
    const foreign = await harness.runtime.service.createRun(globex, agentRun, globexMeta);
    check(
      'one tenant’s cached answer is never served to another',
      foreign.optimization.avoidedCalls === 0,
      `foreignAvoidedCalls=${foreign.optimization.avoidedCalls}`,
    );
  }

  // 20 — the financial view attributes plan spend and reports avoided apart
  {
    const harness = buildTestWorkflowRuntime();
    const call = caller(harness, AGENT_TOKEN.consultant);
    await call({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowBody({ workflowId: WORKFLOW_ID.parallel }),
    });
    const report = (await call({ operation: WORKFLOW_OPERATION.optimization })).body
      .optimization as {
      rows: { workflowId?: string; costMicroUsd: number; feature: string }[];
      totals: { costMicroUsd: number; avoidedMicroUsd: number };
      optimizationScore: number;
      runsConsidered: number;
    };
    check(
      'the financial view attributes plan spend and reports avoided apart',
      report.rows.length > 0 &&
        report.rows.every((row) => row.workflowId === WORKFLOW_ID.parallel) &&
        report.totals.avoidedMicroUsd === 0,
      `rows=${report.rows.length} runs=${report.runsConsidered} score=${report.optimizationScore}`,
    );
  }

  // 21 — no real provider request occurs
  {
    const harness = buildTestWorkflowRuntime();
    const before = await harness.plane.spendStatus();
    await caller(harness, AGENT_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowBody({ workflowId: WORKFLOW_ID.parallel }),
    });
    const after = await harness.plane.spendStatus();
    const health = harness.plane.health();
    const usedMock = health.providers.every(
      (provider) => provider.providerId === 'primary' || provider.providerId === 'backup',
    );
    check(
      'no real provider request occurs',
      after.spentMicroUsd === before.spentMicroUsd && after.reservedMicroUsd === 0 && usedMock,
      `spent=${after.spentMicroUsd} reserved=${after.reservedMicroUsd} providers=${health.providers
        .map((provider) => provider.providerId)
        .join(',')}`,
    );
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const width = Math.max(...results.map((result) => result.scenario.length));
  process.stdout.write('\nAI-01 Batch 3B — workflow runtime verification (mock mode)\n');
  process.stdout.write('='.repeat(width + 12) + '\n');
  for (const result of results) {
    process.stdout.write(
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.scenario.padEnd(width)}  ${result.detail}\n`,
    );
  }
  const failed = results.filter((result) => !result.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} scenarios passed\n`);
  if (failed.length > 0) process.exit(1);
}

await main();
