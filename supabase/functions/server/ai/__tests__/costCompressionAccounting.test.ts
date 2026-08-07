/**
 * Actual usage attribution (AI-01 Batch 3B, Part 6A).
 *
 * The unit half exercises the accounting port directly; the integration half
 * runs REAL workflows over the REAL agent runtime with a port that reports
 * spend, and asserts that the numbers that reach a read model are the numbers
 * the children actually reported.
 *
 * Every claim here is checked in the direction that can fail: that a repeat
 * observation adds NOTHING, that a retry's spend is NOT lost, that an approval
 * costs NOTHING, that a restart does NOT duplicate, and that a foreign
 * observation is REFUSED.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  attributeUsage,
  emptyUsageLedger,
  isCompressionError,
  retryUsage,
  rollupUsage,
  usageScopeIds,
} from '../optimization/index.ts';
import { projectAgentRun } from '../workflows/engine/agentNodePort.ts';
import type { AgentRunRecord } from '../agents/contracts/runtime.ts';
import { createMemoryWorkflowRunStore } from '../workflows/persistence/ports.ts';
import { createMemoryAgentRunStore } from '../agents/persistence/ports.ts';
import { AGENT_TOKEN } from './agentFixtures.ts';
import {
  EXECUTABLE,
  PART5,
  WF5_AGENT,
  buildPart5Runtime,
  buildTestWorkflowRuntime,
  emptyFlakyLog,
  meteredAgentPort,
  meteredFlakyAgentPort,
} from './workflowFixtures.ts';
import { ORG, OTHER_ORG, observation } from './costCompressionFixtures.ts';

const TOPIC = { topic: 'quarterly readiness' };

// ── The port, in isolation ──────────────────────────────────────────────────

describe('usage attribution port', () => {
  it('ATTRIBUTES a child agent run once', () => {
    const result = attributeUsage(emptyUsageLedger(ORG), observation({ agentRunId: 'run_1' }));
    assert.equal(result.applied.actualCostMicroUsd, 2_000);
    assert.equal(result.ledger.totals.actualTotalTokens, 1_500);
    assert.equal(result.ledger.rows.length, 1);
    assert.equal(result.idempotent, false);
  });

  it('IS IDEMPOTENT: the same cumulative report adds nothing the second time', () => {
    // The workflow polls a child many times. Folding cumulative totals on every
    // poll would multiply a run's cost by the number of times somebody looked.
    let ledger = emptyUsageLedger(ORG);
    for (let poll = 0; poll < 5; poll += 1) {
      const result = attributeUsage(ledger, observation({ agentRunId: 'run_1' }));
      ledger = result.ledger;
      if (poll > 0) assert.equal(result.idempotent, true);
    }
    assert.equal(ledger.totals.actualCostMicroUsd, 2_000);
    assert.equal(ledger.totals.actualTotalTokens, 1_500);
    assert.equal(ledger.rows.length, 1);
  });

  it('applies only the DELTA when a child spends more', () => {
    const first = attributeUsage(emptyUsageLedger(ORG), observation({ agentRunId: 'run_1' }));
    const second = attributeUsage(
      first.ledger,
      observation({
        agentRunId: 'run_1',
        cumulative: {
          actualInputTokens: 1_600,
          actualOutputTokens: 900,
          actualTotalTokens: 2_500,
          actualCostMicroUsd: 3_500,
        },
      }),
    );
    assert.equal(second.applied.actualCostMicroUsd, 1_500);
    assert.equal(second.ledger.totals.actualCostMicroUsd, 3_500);
    assert.equal(second.ledger.rows.length, 1);
  });

  it('IGNORES a stale observation rather than un-spending money', () => {
    const first = attributeUsage(emptyUsageLedger(ORG), observation({ agentRunId: 'run_1' }));
    const stale = attributeUsage(
      first.ledger,
      observation({
        agentRunId: 'run_1',
        cumulative: {
          actualInputTokens: 10,
          actualOutputTokens: 5,
          actualTotalTokens: 15,
          actualCostMicroUsd: 20,
        },
      }),
    );
    assert.equal(stale.applied.actualCostMicroUsd, 0);
    assert.equal(stale.ledger.totals.actualCostMicroUsd, 2_000);
  });

  it('COUNTS A RETRY AS SPEND: a new attempt is a new child, so a new row', () => {
    let ledger = emptyUsageLedger(ORG);
    ledger = attributeUsage(
      ledger,
      observation({ agentRunId: 'run_1', nodeId: 'work', attempt: 1 }),
    ).ledger;
    ledger = attributeUsage(
      ledger,
      observation({ agentRunId: 'run_2', nodeId: 'work', attempt: 2 }),
    ).ledger;

    assert.equal(ledger.rows.length, 2);
    assert.equal(ledger.totals.actualCostMicroUsd, 4_000);
    // The failed attempt is not netted off anywhere.
    assert.equal(retryUsage(ledger).actualCostMicroUsd, 2_000);
    assert.equal(rollupUsage(ledger, { scope: 'workflow_node', id: 'work' }).actualCostMicroUsd, 4_000);
  });

  it('ROLLS UP SEQUENTIALLY: node totals sum to the run total', () => {
    let ledger = emptyUsageLedger(ORG);
    for (const [runId, nodeId] of [
      ['run_1', 'first'],
      ['run_2', 'second'],
      ['run_3', 'third'],
    ] as const) {
      ledger = attributeUsage(ledger, observation({ agentRunId: runId, nodeId })).ledger;
    }

    const nodes = usageScopeIds(ledger, 'workflow_node');
    assert.deepEqual(nodes, ['first', 'second', 'third']);
    const summed = nodes.reduce(
      (total, nodeId) => total + rollupUsage(ledger, { scope: 'workflow_node', id: nodeId }).actualCostMicroUsd,
      0,
    );
    assert.equal(summed, ledger.totals.actualCostMicroUsd);
    assert.equal(rollupUsage(ledger, { scope: 'workflow_run' }).actualCostMicroUsd, 6_000);
  });

  it('ROLLS UP IN PARALLEL: branch totals sum to the group total', () => {
    let ledger = emptyUsageLedger(ORG);
    ledger = attributeUsage(
      ledger,
      observation({ agentRunId: 'run_1', nodeId: 'left_step', branchId: 'b_left', groupId: 'g1' }),
    ).ledger;
    ledger = attributeUsage(
      ledger,
      observation({ agentRunId: 'run_2', nodeId: 'right_step', branchId: 'b_right', groupId: 'g1' }),
    ).ledger;

    const left = rollupUsage(ledger, { scope: 'workflow_branch', id: 'b_left' });
    const right = rollupUsage(ledger, { scope: 'workflow_branch', id: 'b_right' });
    const group = rollupUsage(ledger, { scope: 'parallel_group', id: 'g1' });

    assert.equal(left.actualCostMicroUsd, 2_000);
    assert.equal(right.actualCostMicroUsd, 2_000);
    assert.equal(group.actualCostMicroUsd, left.actualCostMicroUsd + right.actualCostMicroUsd);
    assert.equal(group.actualCostMicroUsd, ledger.totals.actualCostMicroUsd);
  });

  it('REFUSES an observation from another tenant', () => {
    try {
      attributeUsage(
        emptyUsageLedger(ORG),
        observation({ agentRunId: 'run_1', organizationId: OTHER_ORG }),
      );
      assert.fail('expected a cross-tenant refusal');
    } catch (error) {
      assert.ok(isCompressionError(error));
      if (!isCompressionError(error)) return;
      assert.equal(error.failure, 'usage_tenant_mismatch');
    }
  });
});

// ── The port's source: the agent node projection ────────────────────────────

describe('agent node port usage projection', () => {
  const record = (tokens: number, cost: number): AgentRunRecord =>
    ({
      context: { runId: 'run_1' },
      state: 'completed',
      tokens: {
        actualPromptTokens: Math.floor(tokens * 0.7),
        actualCompletionTokens: tokens - Math.floor(tokens * 0.7),
        actualTotalTokens: tokens,
      },
      cost: { actualMicroUsd: cost },
    }) as unknown as AgentRunRecord;

  it('carries the child ledgers verbatim, never a recomputation', () => {
    const handle = projectAgentRun(record(1_500, 2_000));
    assert.deepEqual(handle.usage, {
      inputTokens: 1_050,
      outputTokens: 450,
      totalTokens: 1_500,
      costMicroUsd: 2_000,
    });
  });

  it('reports NO usage rather than a zeroed one when nothing was spent', () => {
    // "Not measured" and "measured zero" are different claims, and an approval
    // node is the case where the difference matters.
    assert.equal(projectAgentRun(record(0, 0)).usage, undefined);
  });

  it('reports usage for a FAILED child too — a failure that spent money spent it', () => {
    const failed = {
      ...record(800, 900),
      state: 'failed',
    } as unknown as AgentRunRecord;
    assert.equal(projectAgentRun(failed).state, 'failed');
    assert.equal(projectAgentRun(failed).usage?.costMicroUsd, 900);
  });
});

// ── Integration: real workflows, real agent runs ────────────────────────────

describe('workflow usage attribution — integration', () => {
  it('rolls a SEQUENTIAL chain up to the run', async () => {
    const harness = buildTestWorkflowRuntime({
      wrapAgentPort: meteredAgentPort({ inputTokens: 1_000, outputTokens: 400, costMicroUsd: 1_500 }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.chain.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(detail.childAgentRunIds.length, 3);
    // Three children at 1,400 tokens and 1,500 micro-USD each.
    assert.equal(detail.actualTotalTokens, 4_200);
    assert.equal(detail.actualInputTokens, 3_000);
    assert.equal(detail.actualOutputTokens, 1_200);
    assert.equal(detail.actualCostMicroUsd, 4_500);
  });

  it('rolls a PARALLEL fan-out up through its branches and its group', async () => {
    const harness = buildPart5Runtime({
      wrapAgentPort: meteredAgentPort({ inputTokens: 600, outputTokens: 200, costMicroUsd: 900 }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.branchRetry.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    const group = detail.parallelGroups[0];
    assert.equal(group.branches.length, 2);
    for (const branch of group.branches) {
      assert.equal(branch.actualTokens, 800);
      assert.equal(branch.actualCostMicroUsd, 900);
    }
    // The group is the sum of its branches, and the run is the sum of the group.
    assert.equal(
      group.actualCostMicroUsd,
      group.branches.reduce((sum, branch) => sum + branch.actualCostMicroUsd, 0),
    );
    assert.equal(detail.actualCostMicroUsd, group.actualCostMicroUsd);
  });

  it('COUNTS THE FAILED ATTEMPT: a retried node pays for both children', async () => {
    const log = emptyFlakyLog();
    const harness = buildPart5Runtime({
      wrapAgentPort: meteredFlakyAgentPort({
        agentId: WF5_AGENT.flaky,
        failures: 1,
        log,
        perChild: { inputTokens: 500, outputTokens: 100, costMicroUsd: 700 },
      }),
    });

    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryImmediate.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(log.failures, 1);
    assert.equal(detail.childAgentRunIds.length, 2);
    // TWO children, so TWO lots of spend. A ledger that kept only the
    // successful attempt would report 700 here and disagree with the invoice.
    assert.equal(detail.actualCostMicroUsd, 1_400);
    assert.equal(detail.actualTotalTokens, 1_200);
  });

  it('CHARGES NOTHING FOR AN APPROVAL — no inference, no observation, no cost', async () => {
    const harness = buildPart5Runtime({
      wrapAgentPort: meteredAgentPort({ inputTokens: 400, outputTokens: 100, costMicroUsd: 600 }),
    });
    const created = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.approval.workflowId,
      input: TOPIC,
    });

    assert.equal(created.state, 'waiting_for_approval');
    // The run has stopped for a person and has created no child agent run.
    assert.equal(created.childAgentRunIds.length, 0);
    assert.equal(created.actualCostMicroUsd, 0);
    assert.equal(created.actualTotalTokens, 0);

    const approval = created.pendingApproval;
    assert.ok(approval);
    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.owner),
      workflowApprovalId: approval.workflowApprovalId,
      decision: 'approve',
      reason: 'Confirmed by a person.',
    });

    const resumed = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });

    assert.equal(resumed.state, 'completed');
    // Exactly one child ran after the approval, so exactly one lot of spend.
    // The approval itself contributed nothing.
    assert.equal(resumed.childAgentRunIds.length, 1);
    assert.equal(resumed.actualCostMicroUsd, 600);
  });

  it('DOES NOT DUPLICATE ACROSS A RESTART', async () => {
    // A second isolate over the SAME stores re-drives the same child, observes
    // the same cumulative totals, computes a zero delta and changes nothing.
    const runStore = createMemoryWorkflowRunStore();
    const agentRunStore = createMemoryAgentRunStore();
    const metered = meteredAgentPort({
      inputTokens: 1_000,
      outputTokens: 500,
      costMicroUsd: 2_000,
    });

    const first = buildTestWorkflowRuntime({ runStore, agentRunStore, wrapAgentPort: metered });
    const created = await first.workflows.service.createRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: EXECUTABLE.chain.workflowId,
      input: TOPIC,
    });

    const done = await first.workflows.service.advanceRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });
    assert.equal(done.state, 'completed');
    const spent = done.actualCostMicroUsd;
    assert.equal(spent, 6_000);

    // A fresh runtime over the same stores. Re-reading and re-advancing a
    // completed run must not add a micro-USD.
    const second = buildTestWorkflowRuntime({
      runStore,
      agentRunStore,
      wrapAgentPort: metered,
      idSeed: '2',
    });
    const reread = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: created.workflowRunId,
    });
    assert.equal(reread.state, 'completed');
    assert.equal(reread.actualCostMicroUsd, spent);
    assert.equal(reread.actualTotalTokens, done.actualTotalTokens);
  });

  it('never lets a read model carry a second spend accumulator', async () => {
    // The branch record has no token or cost field at all — see
    // `contracts/parallel.ts`. The view's figures are derived from the ledger,
    // so a stored counter reappearing on the record would be caught here.
    const harness = buildPart5Runtime({
      wrapAgentPort: meteredAgentPort({ inputTokens: 600, outputTokens: 200, costMicroUsd: 900 }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.branchRetry.workflowId,
      input: TOPIC,
    });
    for (const branch of detail.parallelGroups[0].branches) {
      const fields = Object.keys(branch);
      assert.equal(fields.includes('tokensPlaceholder'), false);
      assert.equal(fields.includes('costMicroUsdPlaceholder'), false);
      assert.ok(fields.includes('actualTokens'));
    }
  });
});
