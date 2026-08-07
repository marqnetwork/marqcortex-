/**
 * Approvals and retries (AI-01 Batch 3B, Part 5).
 *
 * The same two-layer split Parts 3 and 4 used, for the same reason.
 *
 *   UNIT, against `retryPolicy.ts`, `workflowApprovalGate.ts` and the state
 *   machine directly. Every failure classification, every backoff computation,
 *   every stale-attempt refusal, and every refusal the gate makes — an
 *   unauthorised decider, a wrong tenant, an expired window, a replay, a stale
 *   binding. These are decisions, so they are tested as decisions, with no run
 *   in the way and nothing to be flaky.
 *
 *   INTEGRATION, against the real engine over the real Batch 3A agent runtime
 *   over the real control plane. That an approval node actually parks a run,
 *   that an authorised decision actually releases it, that a second isolate
 *   actually finds the pending request, that a retry actually creates a second
 *   child agent run and never re-drives the first.
 *
 * The unit half proves the rule; the integration half proves the engine obeys
 * it. Neither on its own would.
 *
 * ── ONE THING THESE TESTS DELIBERATELY DO NOT ASSERT ───────────────────────
 *
 * That anything wakes a run up when a retry delay elapses. Nothing does — there
 * is no scheduler in this batch — and the two tests around
 * `PART5.retryDelayed` assert exactly the behaviour that exists: advancing
 * before the delay creates nothing, and advancing after it proceeds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAttempt,
  classifyChildFailure,
  clearAttempt,
  clearBranchAttempts,
  computeRetryDelayMs,
  currentAttempt,
  findAttempt,
  nextAttemptRecord,
  resolveRetryPolicy,
  retriesExhausted,
  retryDelayRemainingMs,
} from '../workflows/runtime/retryPolicy.ts';
import type { WorkflowNodeAttempt } from '../workflows/contracts/retry.ts';
import {
  DEFAULT_WORKFLOW_RETRY_POLICY,
  workflowAttemptKeyFor,
} from '../workflows/contracts/retry.ts';
import type { WorkflowApprovalRecord } from '../workflows/contracts/approval.ts';
import {
  WORKFLOW_APPROVAL_BOUNDS,
  workflowApprovalIdFor,
} from '../workflows/contracts/approval.ts';
import { createWorkflowApprovalGate } from '../workflows/approvals/workflowApprovalGate.ts';
import {
  createMemoryWorkflowApprovalStore,
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
} from '../workflows/persistence/ports.ts';
import {
  createMemoryAgentRunStore,
  createMemoryApprovalStore,
  createMemoryCheckpointStore,
} from '../agents/persistence/ports.ts';
import {
  OPERATION_SOURCES,
  OPERATION_TARGETS,
  PAUSABLE_STATES,
  TRANSITIONS,
  canTransition,
} from '../workflows/runtime/workflowStateMachine.ts';
import { isWorkflowError } from '../workflows/contracts/failures.ts';
import { validateWorkflowDefinition } from '../workflows/validation/workflowValidation.ts';
import { planWorkflow } from '../workflows/planner/workflowPlanner.ts';
import { isApprovalStep } from '../workflows/contracts/plan.ts';
import { createTestClock } from '../runtime/clock.ts';
import { AGENT_TOKEN } from './agentFixtures.ts';
import {
  APPROVER_ROLES,
  PART5,
  PART5_AGENTS,
  PART5_WORKFLOWS,
  WF5_AGENT,
  approvalNode,
  buildPart5Runtime,
  buildTestWorkflowRuntime,
  edge,
  emptyFlakyLog,
  flakyAgentPort,
  node,
} from './workflowFixtures.ts';
import type { FlakyPortLog } from './workflowFixtures.ts';

const TOPIC = { topic: 'quarterly readiness' };
const RUN_ID = 'wfr_test1';

function failureOf(error: unknown): string {
  assert.ok(isWorkflowError(error), `expected a WorkflowError, got ${String(error)}`);
  return error.failure;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    assert.fail('expected the call to be refused');
  } catch (error) {
    return error;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// UNIT — failure classification
// ════════════════════════════════════════════════════════════════════════════

describe('retry eligibility — failure classification', () => {
  it('retries only transient child failures', () => {
    for (const code of [
      'provider_unavailable',
      'model_failed',
      'tool_failed',
      'persistence_failed',
      'runtime_disabled',
    ]) {
      const verdict = classifyChildFailure(code);
      assert.equal(verdict.retryable, true, code);
      assert.equal(verdict.classification, 'transient', code);
      assert.equal(verdict.childFailure, code);
    }
  });

  it('never retries an authorization, policy, budget or definition decision', () => {
    // The brief's list, one code per class, asserted as a table rather than as
    // five separate tests — the claim is that the SET is closed, and a table is
    // the shape of that claim.
    const decisions: readonly (readonly [string, string])[] = [
      ['unauthorized', 'authorization'],
      ['capability_denied', 'authorization'],
      ['tenant_isolation_violation', 'authorization'],
      ['agent_disabled', 'policy'],
      ['loop_detected', 'policy'],
      ['step_limit_exceeded', 'policy'],
      ['token_budget_exhausted', 'budget'],
      ['cost_budget_exhausted', 'budget'],
      ['agent_not_found', 'invalid_definition'],
      ['invalid_action', 'invalid_definition'],
      ['invalid_transition', 'invalid_transition'],
      ['approval_rejected', 'approval_rejected'],
      ['approval_expired', 'approval_rejected'],
    ];

    for (const [code, classification] of decisions) {
      const verdict = classifyChildFailure(code);
      assert.equal(verdict.retryable, false, code);
      assert.equal(verdict.classification, classification, code);
    }
  });

  it('fails closed on a failure code it does not recognise', () => {
    // A seventeenth agent failure code added by a later batch must not acquire
    // a retry by being forgotten.
    const verdict = classifyChildFailure('some_code_from_a_future_batch');
    assert.equal(verdict.retryable, false);
    assert.equal(verdict.classification, 'unclassified');
  });

  it('fails closed on a child that failed with no code at all', () => {
    // Which is what an agent's own `fail` action produces: the agent judged its
    // work, and re-running a judgement is the one thing a retry cannot fix.
    for (const empty of [undefined, '', '   ']) {
      const verdict = classifyChildFailure(empty);
      assert.equal(verdict.retryable, false);
      assert.equal(verdict.classification, 'unclassified');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// UNIT — backoff and attempt bookkeeping
// ════════════════════════════════════════════════════════════════════════════

describe('retry backoff — deterministic metadata', () => {
  it('waits for nothing under immediate backoff', () => {
    assert.equal(computeRetryDelayMs({ backoff: 'immediate' }, 2), 0);
    assert.equal(computeRetryDelayMs({ backoff: 'immediate' }, 8), 0);
  });

  it('waits the declared delay, every time, under fixed_delay', () => {
    const policy = { backoff: 'fixed_delay', delayMs: 30_000 } as const;
    assert.equal(computeRetryDelayMs(policy, 2), 30_000);
    assert.equal(computeRetryDelayMs(policy, 3), 30_000);
    assert.equal(computeRetryDelayMs(policy, 8), 30_000);
  });

  it('doubles per prior retry under exponential, capped by maxDelayMs', () => {
    const policy = { backoff: 'exponential', delayMs: 10_000, maxDelayMs: 60_000 } as const;
    assert.equal(computeRetryDelayMs(policy, 2), 10_000);
    assert.equal(computeRetryDelayMs(policy, 3), 20_000);
    assert.equal(computeRetryDelayMs(policy, 4), 40_000);
    // Capped: 80_000 would exceed the declared ceiling.
    assert.equal(computeRetryDelayMs(policy, 5), 60_000);
    assert.equal(computeRetryDelayMs(policy, 12), 60_000);
  });

  it('never produces an unrepresentable delay from an absurd attempt number', () => {
    // 2 ** 4000 is Infinity, and an Infinity that reached a timestamp would
    // write `Invalid Date` onto a durable record.
    const delay = computeRetryDelayMs({ backoff: 'exponential', delayMs: 1_000 }, 4_000);
    assert.ok(Number.isFinite(delay));
    assert.ok(delay <= 900_000);
  });

  it('is deterministic — the same policy and attempt give the same delay', () => {
    const policy = { backoff: 'exponential', delayMs: 5_000 } as const;
    const first = Array.from({ length: 6 }, (_, i) => computeRetryDelayMs(policy, i + 2));
    const second = Array.from({ length: 6 }, (_, i) => computeRetryDelayMs(policy, i + 2));
    assert.deepEqual(first, second);
  });

  it('resolves an absent policy to immediate rather than to undefined', () => {
    assert.deepEqual(resolveRetryPolicy(undefined), DEFAULT_WORKFLOW_RETRY_POLICY);
    assert.equal(resolveRetryPolicy(undefined).backoff, 'immediate');
  });
});

describe('retry bookkeeping — attempts start at 1 and are keyed per line', () => {
  const attemptOf = (
    nodeId: string,
    branchId: string | undefined,
    overrides: Partial<WorkflowNodeAttempt> = {},
  ): WorkflowNodeAttempt => ({
    nodeId,
    ...(branchId === undefined ? {} : { branchId }),
    attempt: 2,
    maxAttempts: 3,
    backoff: 'immediate',
    delayMs: 0,
    attemptVersion: 1,
    ...overrides,
  });

  it('reads an absent record as attempt 1', () => {
    assert.equal(currentAttempt([], 'work'), 1);
    assert.equal(currentAttempt(undefined, 'work'), 1);
  });

  it('keys a branch attempt separately from the main line and from a sibling', () => {
    const retries = [
      attemptOf('work', undefined, { attempt: 2 }),
      attemptOf('work', 'wfb:r:fan:left', { attempt: 3 }),
      attemptOf('work', 'wfb:r:fan:right', { attempt: 1 }),
    ];
    assert.equal(currentAttempt(retries, 'work'), 2);
    assert.equal(currentAttempt(retries, 'work', 'wfb:r:fan:left'), 3);
    assert.equal(currentAttempt(retries, 'work', 'wfb:r:fan:right'), 1);
    // And the key really is the pair, not a string that could collide.
    assert.notEqual(
      workflowAttemptKeyFor('work', 'wfb:r:fan:left'),
      workflowAttemptKeyFor('work', undefined),
    );
  });

  it('reports exhaustion against the node ceiling', () => {
    assert.equal(retriesExhausted(1, 3), false);
    assert.equal(retriesExhausted(2, 3), false);
    assert.equal(retriesExhausted(3, 3), true);
    assert.equal(retriesExhausted(1, 1), true);
  });

  it('inserts a first attempt record against expected version 0', () => {
    const updated = applyAttempt([], attemptOf('work', undefined, { attemptVersion: 1 }), 0);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].attemptVersion, 1);
  });

  it('refuses a stale attempt write', () => {
    const stored = [attemptOf('work', undefined, { attemptVersion: 3 })];
    // Two isolates both saw this node fail; the loser must not double-count the
    // attempt or discard the winner's backoff stamp.
    const error = (() => {
      try {
        applyAttempt(stored, attemptOf('work', undefined, { attemptVersion: 3 }), 2);
        return undefined;
      } catch (thrown) {
        return thrown;
      }
    })();
    assert.equal(failureOf(error), 'stale_workflow_retry');
  });

  it('refuses an attempt write that does not carry the next version', () => {
    const stored = [attemptOf('work', undefined, { attemptVersion: 2 })];
    const error = (() => {
      try {
        applyAttempt(stored, attemptOf('work', undefined, { attemptVersion: 5 }), 2);
        return undefined;
      } catch (thrown) {
        return thrown;
      }
    })();
    assert.equal(failureOf(error), 'stale_workflow_retry');
  });

  it('clears one line of execution without touching another', () => {
    const retries = [
      attemptOf('work', undefined),
      attemptOf('work', 'wfb:r:fan:left'),
      attemptOf('work', 'wfb:r:fan:right'),
    ];

    const mainCleared = clearAttempt(retries, 'work');
    assert.equal(findAttempt(mainCleared, 'work'), undefined);
    assert.ok(findAttempt(mainCleared, 'work', 'wfb:r:fan:left'));
    assert.ok(findAttempt(mainCleared, 'work', 'wfb:r:fan:right'));

    const leftCleared = clearBranchAttempts(retries, 'wfb:r:fan:left');
    assert.equal(findAttempt(leftCleared, 'work', 'wfb:r:fan:left'), undefined);
    assert.ok(findAttempt(leftCleared, 'work', 'wfb:r:fan:right'));
    assert.ok(findAttempt(leftCleared, 'work'));
  });

  it('stamps nextAttemptAt only when the policy actually waits', () => {
    const nowMs = Date.UTC(2026, 0, 1);
    const immediate = nextAttemptRecord(undefined, {
      nodeId: 'work',
      maxAttempts: 3,
      policy: { backoff: 'immediate' },
      failedAttempt: 1,
      nowMs,
      at: new Date(nowMs).toISOString(),
      failure: 'workflow_node_failed',
      classification: 'transient',
    });
    assert.equal(immediate.attempt, 2);
    assert.equal(immediate.delayMs, 0);
    assert.equal(immediate.nextAttemptAt, undefined);
    assert.equal(retryDelayRemainingMs(immediate, nowMs), 0);

    const delayed = nextAttemptRecord(immediate, {
      nodeId: 'work',
      maxAttempts: 3,
      policy: { backoff: 'fixed_delay', delayMs: 30_000 },
      failedAttempt: 2,
      nowMs,
      at: new Date(nowMs).toISOString(),
      failure: 'workflow_node_failed',
      classification: 'transient',
    });
    assert.equal(delayed.attempt, 3);
    assert.equal(delayed.nextAttemptAt, new Date(nowMs + 30_000).toISOString());
    assert.equal(retryDelayRemainingMs(delayed, nowMs), 30_000);
    assert.equal(retryDelayRemainingMs(delayed, nowMs + 30_000), 0);
    // The version advances so a stale write can be caught.
    assert.equal(delayed.attemptVersion, immediate.attemptVersion + 1);
  });

  it('treats an unreadable backoff stamp as elapsed rather than as forever', () => {
    const corrupt: WorkflowNodeAttempt = {
      nodeId: 'work',
      attempt: 2,
      maxAttempts: 3,
      backoff: 'fixed_delay',
      delayMs: 30_000,
      nextAttemptAt: 'not-a-timestamp',
      attemptVersion: 1,
    };
    assert.equal(retryDelayRemainingMs(corrupt, Date.UTC(2026, 0, 1)), 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// UNIT — the state machine's approval rules
// ════════════════════════════════════════════════════════════════════════════

describe('waiting_for_approval — the state machine refuses a pause bypass', () => {
  it('has no edge from waiting_for_approval to paused', () => {
    assert.equal(canTransition('waiting_for_approval', 'paused'), false);
  });

  it('is not a pausable state, in either list that says so', () => {
    // Two lists of one fact is one place for them to drift, so the drift is
    // what is asserted — the same shape Part 2's suite used for PAUSABLE_STATES.
    assert.equal(PAUSABLE_STATES.includes('waiting_for_approval'), false);
    assert.equal(OPERATION_SOURCES.pause.includes('waiting_for_approval'), false);
    assert.deepEqual([...PAUSABLE_STATES].sort(), [...OPERATION_SOURCES.pause].sort());
  });

  it('cannot be resumed out of, because it was never paused', () => {
    assert.equal(OPERATION_SOURCES.resume.includes('waiting_for_approval'), false);
    assert.equal(OPERATION_TARGETS.resume.includes('waiting_for_approval'), false);
  });

  it('keeps cancel available as the explicit escape path', () => {
    assert.equal(OPERATION_SOURCES.cancel.includes('waiting_for_approval'), true);
    assert.equal(canTransition('waiting_for_approval', 'cancelled'), true);
  });

  it('cannot be completed out of — a decision is still outstanding', () => {
    assert.equal(OPERATION_SOURCES.complete.includes('waiting_for_approval'), false);
    assert.equal(canTransition('waiting_for_approval', 'completed'), false);
  });

  it('is reachable only from running, and only by the engine', () => {
    const sources = Object.entries(TRANSITIONS)
      .filter(([, targets]) => targets.includes('waiting_for_approval'))
      .map(([from]) => from);
    assert.deepEqual(sources, ['running']);
    // And no caller operation may produce it: the park is a `step`.
    for (const targets of Object.values(OPERATION_TARGETS)) {
      assert.equal(targets.includes('waiting_for_approval'), false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// UNIT — the approval gate
// ════════════════════════════════════════════════════════════════════════════

describe('the approval gate — authority, tenancy and single use', () => {
  function gateFixture() {
    const clock = createTestClock();
    const store = createMemoryWorkflowApprovalStore();
    return { clock, store, gate: createWorkflowApprovalGate({ store, clock }) };
  }

  const requestInput = (overrides: Record<string, unknown> = {}) => ({
    workflowRunId: RUN_ID,
    organizationId: 'acme',
    workflowId: 'workflow.p5.approval',
    nodeId: 'gate',
    requestedBy: 'user-consultant',
    reason: 'A person must confirm this workflow may continue.',
    impactSummary: 'Continuing runs the remaining steps.',
    estimatedAdditionalTokens: 1_200,
    estimatedAdditionalCostMicroUsd: 3_400,
    approverRoles: APPROVER_ROLES,
    onRejection: 'fail' as const,
    expiresAfterMs: 3_600_000,
    checkpointVersion: 0,
    workflowRunVersion: 4,
    ...overrides,
  });

  const binding = (overrides: Record<string, unknown> = {}) => ({
    nodeId: 'gate',
    checkpointVersion: 0,
    workflowRunVersion: 4,
    ...overrides,
  });

  it('writes a pending, single-use record carrying every declared fact', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());

    assert.equal(record.approvalState, 'pending');
    assert.equal(record.singleUse, true);
    assert.equal(record.approvalVersion, 1);
    assert.equal(record.workflowRunId, RUN_ID);
    assert.equal(record.organizationId, 'acme');
    assert.equal(record.nodeId, 'gate');
    assert.equal(record.requestedBy, 'user-consultant');
    assert.equal(record.onRejection, 'fail');
    assert.equal(record.checkpointVersion, 0);
    assert.equal(record.workflowRunVersion, 4);
    assert.equal(record.estimatedAdditionalTokens, 1_200);
    assert.equal(record.estimatedAdditionalCostMicroUsd, 3_400);
    assert.deepEqual(record.authorizedRoles, [...APPROVER_ROLES].sort());
    assert.equal(record.decidedAt, undefined);
    assert.equal(record.decision, undefined);
    assert.equal(record.consumedAt, undefined);
  });

  it('derives its id deterministically and adopts its own pending request', async () => {
    const { gate } = gateFixture();
    const first = await gate.request(requestInput());
    // The advance that wrote it died before parking the run. The next one
    // recomputes the identical id and must not mint a second row.
    const second = await gate.request(requestInput());

    assert.equal(
      first.workflowApprovalId,
      workflowApprovalIdFor(RUN_ID, 'gate', undefined, 0),
    );
    assert.equal(second.workflowApprovalId, first.workflowApprovalId);
    assert.equal(second.approvalVersion, 1);
    assert.equal((await gate.pending('acme')).length, 1);
  });

  it('gives a different id to a later visit, because the checkpoint moved', async () => {
    const { gate } = gateFixture();
    const first = await gate.request(requestInput({ checkpointVersion: 0 }));
    const later = await gate.request(requestInput({ checkpointVersion: 3 }));
    // Without this, "approve once, loop forever" would be representable.
    assert.notEqual(later.workflowApprovalId, first.workflowApprovalId);
  });

  it('refuses to re-request from a position whose question was already answered', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });

    const error = await rejection(gate.request(requestInput()));
    assert.equal(failureOf(error), 'workflow_approval_conflict');
  });

  it('records an authorised approval with its decider and reason', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    const decided = await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-reviewer',
      deciderRoles: ['reviewer'],
    });

    assert.equal(decided.approvalState, 'approved');
    assert.equal(decided.decision, 'approve');
    assert.equal(decided.decidedBy, 'user-reviewer');
    assert.equal(decided.decisionReason, 'Reviewed and accepted.');
    assert.equal(decided.approvalVersion, 2);
  });

  it('refuses a decider whose roles the node did not authorise', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    const error = await rejection(
      gate.decide({
        organizationId: 'acme',
        workflowApprovalId: record.workflowApprovalId,
        decision: 'approve',
        reason: 'I would like this to proceed.',
        deciderId: 'user-consultant',
        deciderRoles: ['consultant'],
      }),
    );
    assert.equal(failureOf(error), 'workflow_approval_unauthorized');
    // And the request is untouched, so somebody who does hold the role still can.
    const stored = await gate.get('acme', record.workflowApprovalId);
    assert.equal(stored?.approvalState, 'pending');
  });

  it('refuses a decider from another tenant as a not-found', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    const error = await rejection(
      gate.decide({
        organizationId: 'globex',
        workflowApprovalId: record.workflowApprovalId,
        decision: 'approve',
        reason: 'Approving a decision that is not mine.',
        deciderId: 'user-globex',
        deciderRoles: ['owner'],
      }),
    );
    // Not-found rather than forbidden: a caller must not be able to probe for
    // the existence of another organization's decisions.
    assert.equal(failureOf(error), 'workflow_approval_not_found');
    assert.equal((await gate.get('acme', record.workflowApprovalId))?.approvalState, 'pending');
  });

  it('tells an unauthorised caller nothing about the request state', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'reject',
      reason: 'Not this time.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });

    // Already decided AND unauthorised. The refusal must be the authority one:
    // "that was already rejected" would answer a question they may not ask.
    const error = await rejection(
      gate.decide({
        organizationId: 'acme',
        workflowApprovalId: record.workflowApprovalId,
        decision: 'approve',
        reason: 'Trying anyway.',
        deciderId: 'user-consultant',
        deciderRoles: ['consultant'],
      }),
    );
    assert.equal(failureOf(error), 'workflow_approval_unauthorized');
  });

  it('refuses a second decision on a request that was already decided', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    const decide = (decision: 'approve' | 'reject') =>
      gate.decide({
        organizationId: 'acme',
        workflowApprovalId: record.workflowApprovalId,
        decision,
        reason: 'A considered decision.',
        deciderId: 'user-owner',
        deciderRoles: ['owner'],
      });

    await decide('approve');
    assert.equal(failureOf(await rejection(decide('reject'))), 'workflow_approval_conflict');
  });

  it('needs a bounded reason for a decision', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    for (const reason of ['', '  ', 'x'.repeat(WORKFLOW_APPROVAL_BOUNDS.decisionReason.max + 1)]) {
      const error = await rejection(
        gate.decide({
          organizationId: 'acme',
          workflowApprovalId: record.workflowApprovalId,
          decision: 'approve',
          reason,
          deciderId: 'user-owner',
          deciderRoles: ['owner'],
        }),
      );
      assert.equal(failureOf(error), 'workflow_invalid_definition');
    }
  });

  it('expires rather than approves, and persists the expiry before refusing', async () => {
    const { clock, gate } = gateFixture();
    const record = await gate.request(requestInput({ expiresAfterMs: 60_000 }));
    clock.advance(60_001);

    const error = await rejection(
      gate.decide({
        organizationId: 'acme',
        workflowApprovalId: record.workflowApprovalId,
        decision: 'approve',
        reason: 'Approving after the window closed.',
        deciderId: 'user-owner',
        deciderRoles: ['owner'],
      }),
    );
    assert.equal(failureOf(error), 'workflow_approval_expired');

    // EXPIRY NEVER BECOMES APPROVAL, and the queue stops offering it.
    const stored = await gate.get('acme', record.workflowApprovalId);
    assert.equal(stored?.approvalState, 'expired');
    assert.equal(stored?.decision, undefined);
    assert.equal((await gate.pending('acme')).length, 0);
  });

  it('does not expire a request whose stamp is unreadable', async () => {
    // Guessing would turn a corrupt field into a run that dies for no reason.
    const { clock, store, gate } = gateFixture();
    const record = await gate.request(requestInput());
    await store.save({ ...record, expiresAt: 'not-a-timestamp', approvalVersion: 2 }, 1);
    clock.advance(10_000_000);

    const checked = await gate.expireIfDue(
      (await gate.get('acme', record.workflowApprovalId)) as WorkflowApprovalRecord,
    );
    assert.equal(checked.approvalState, 'pending');
  });

  it('spends an approval exactly once', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });

    const consumed = await gate.consume('acme', record.workflowApprovalId, binding());
    assert.equal(consumed.approvalState, 'consumed');
    assert.ok(consumed.consumedAt);

    const replay = await rejection(gate.consume('acme', record.workflowApprovalId, binding()));
    assert.equal(failureOf(replay), 'workflow_approval_conflict');
  });

  it('refuses to spend a rejected request', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'reject',
      reason: 'Not this time.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });
    const error = await rejection(gate.consume('acme', record.workflowApprovalId, binding()));
    assert.equal(failureOf(error), 'workflow_approval_rejected');
  });

  it('refuses to spend a request nobody has decided', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    const error = await rejection(gate.consume('acme', record.workflowApprovalId, binding()));
    assert.equal(failureOf(error), 'workflow_approval_conflict');
  });

  it('refuses a decision granted for a checkpoint the run has left', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });

    const error = await rejection(
      gate.consume('acme', record.workflowApprovalId, binding({ checkpointVersion: 1 })),
    );
    assert.equal(failureOf(error), 'stale_workflow_approval');
  });

  it('refuses a decision granted for a run version the run has left', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });

    const error = await rejection(
      gate.consume('acme', record.workflowApprovalId, binding({ workflowRunVersion: 9 })),
    );
    assert.equal(failureOf(error), 'stale_workflow_approval');
  });

  it('refuses a decision granted for a different node or branch', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });

    assert.equal(
      failureOf(
        await rejection(
          gate.consume('acme', record.workflowApprovalId, binding({ nodeId: 'other' })),
        ),
      ),
      'stale_workflow_approval',
    );
    assert.equal(
      failureOf(
        await rejection(
          gate.consume('acme', record.workflowApprovalId, binding({ branchId: 'wfb:x' })),
        ),
      ),
      'stale_workflow_approval',
    );
  });

  it('judges a branch approval on its branch version, not on run-wide numbers', async () => {
    // A sibling branch completing a node legitimately writes a checkpoint and
    // bumps the run version while this branch sits untouched, so enforcing them
    // here would make every branch approval unspendable by design.
    const { gate } = gateFixture();
    const record = await gate.request(
      requestInput({ branchId: 'wfb:r:fan:left', branchName: 'left', branchVersion: 2 }),
    );
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });

    const consumed = await gate.consume('acme', record.workflowApprovalId, {
      nodeId: 'gate',
      branchId: 'wfb:r:fan:left',
      // Both run-wide numbers have moved, and the branch has not.
      checkpointVersion: 7,
      workflowRunVersion: 21,
      branchVersion: 2,
    });
    assert.equal(consumed.approvalState, 'consumed');

    // But a branch that HAS moved is stale.
    const second = await gate.request(
      requestInput({
        nodeId: 'gate2',
        branchId: 'wfb:r:fan:left',
        branchName: 'left',
        branchVersion: 5,
      }),
    );
    await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: second.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });
    const error = await rejection(
      gate.consume('acme', second.workflowApprovalId, {
        nodeId: 'gate2',
        branchId: 'wfb:r:fan:left',
        checkpointVersion: 0,
        workflowRunVersion: 4,
        branchVersion: 6,
      }),
    );
    assert.equal(failureOf(error), 'stale_workflow_approval');
  });

  it('withdraws a pending request without ever making it a yes', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    const withdrawn = await gate.withdraw(record, 'The run was cancelled.');

    assert.equal(withdrawn.approvalState, 'withdrawn');
    assert.equal(withdrawn.decision, undefined);
    assert.equal(withdrawn.decidedBy, undefined);
    assert.equal((await gate.pending('acme')).length, 0);
  });

  it('leaves a decided request alone when a run is withdrawn around it', async () => {
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    const decided = await gate.decide({
      organizationId: 'acme',
      workflowApprovalId: record.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
      deciderId: 'user-owner',
      deciderRoles: ['owner'],
    });
    const after = await gate.withdraw(decided, 'The run was cancelled.');
    assert.equal(after.approvalState, 'approved');
  });

  it('never carries a node input, output or merged value', async () => {
    // The absence is the design, not this projection — there is no field for
    // one. Asserted on the stored record so a future field cannot appear
    // unnoticed.
    const { gate } = gateFixture();
    const record = await gate.request(requestInput());
    const keys = Object.keys(record);
    for (const forbidden of ['input', 'output', 'outputs', 'result', 'payload', 'merged']) {
      assert.equal(keys.includes(forbidden), false, `approval record exposes ${forbidden}`);
    }
    assert.equal(
      JSON.stringify(record).includes(TOPIC.topic),
      false,
      'approval record echoes run content',
    );
  });

  it('lists a tenant queue oldest first and never another tenant', async () => {
    const { clock, gate } = gateFixture();
    const first = await gate.request(requestInput({ nodeId: 'gate_a' }));
    clock.advance(1_000);
    const second = await gate.request(requestInput({ nodeId: 'gate_b' }));
    clock.advance(1_000);
    await gate.request(requestInput({ organizationId: 'globex', nodeId: 'gate_c' }));

    const queue = await gate.pending('acme');
    assert.deepEqual(
      queue.map((entry) => entry.workflowApprovalId),
      [first.workflowApprovalId, second.workflowApprovalId],
    );
    assert.equal((await gate.pending('globex')).length, 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// UNIT — definition and plan
// ════════════════════════════════════════════════════════════════════════════

describe('approval nodes — definition and plan', () => {
  it('plans an approval barrier with its governance resolved onto the step', () => {
    const result = planWorkflow(PART5.approval, { agentExists: () => true });
    assert.ok(result.ok);
    const step = result.plan.steps.find((entry) => entry.nodeId === 'gate');
    assert.ok(step && isApprovalStep(step));
    assert.deepEqual(step.approverRoles, APPROVER_ROLES);
    assert.equal(step.onRejection, 'fail');
    assert.equal(step.expiresAfterMs, 3_600_000);
    assert.equal(step.nextNodeId, 'work');
    assert.equal(step.estimatedAdditionalTokens, 1_200);
    assert.equal(result.plan.metadata.approvalNodeCount, 1);
  });

  it('refuses an approval node that authorises nobody', () => {
    const found = validateWorkflowDefinition(
      {
        ...PART5.approval,
        nodes: [approvalNode('gate', { approverRoles: [] }), ...PART5.approval.nodes.slice(1)],
      },
      { agentExists: () => true },
    );
    assert.ok(found.some((problem) => problem.includes('approverRoles')));
  });

  it('refuses an approval node that does not say what a rejection does', () => {
    const found = validateWorkflowDefinition(
      {
        ...PART5.approval,
        nodes: [
          approvalNode('gate', { onRejection: 'continue' as never }),
          ...PART5.approval.nodes.slice(1),
        ],
      },
      { agentExists: () => true },
    );
    assert.ok(found.some((problem) => problem.includes('onRejection')));
  });

  it('refuses an approval node with two successors', () => {
    const found = validateWorkflowDefinition(
      {
        ...PART5.approval,
        nodes: [
          ...PART5.approval.nodes,
          { ...node({ nodeId: 'other' }), outputContract: undefined },
        ],
        edges: [edge('gate', 'work'), edge('gate', 'other')],
      },
      { agentExists: () => true },
    );
    assert.ok(found.some((problem) => problem.includes('an approval node takes exactly one')));
  });

  it('refuses a retry policy that declares a backoff for retries it cannot take', () => {
    const found = validateWorkflowDefinition(
      {
        ...PART5.retryOnce,
        nodes: [
          {
            ...node({ nodeId: 'work', maxAttempts: 1 }),
            retryPolicy: { backoff: 'fixed_delay', delayMs: 1_000 },
          },
        ],
      },
      { agentExists: () => true },
    );
    assert.ok(found.some((problem) => problem.includes('maxAttempts is 1')));
  });

  it('refuses a delay on a policy that does not wait, and a wait with no delay', () => {
    const withDelay = validateWorkflowDefinition(
      {
        ...PART5.retryImmediate,
        nodes: [
          {
            ...node({ nodeId: 'work', maxAttempts: 3 }),
            retryPolicy: { backoff: 'immediate', delayMs: 1_000 },
          },
        ],
      },
      { agentExists: () => true },
    );
    assert.ok(withDelay.some((problem) => problem.includes('not permitted with immediate')));

    const withoutDelay = validateWorkflowDefinition(
      {
        ...PART5.retryImmediate,
        nodes: [
          {
            ...node({ nodeId: 'work', maxAttempts: 3 }),
            retryPolicy: { backoff: 'exponential' },
          },
        ],
      },
      { agentExists: () => true },
    );
    assert.ok(withoutDelay.some((problem) => problem.includes('delayMs must be an integer')));
  });

  it('moves the plan digest when a retry policy or an approval changes', () => {
    const digestOf = (definition: Parameters<typeof planWorkflow>[0]): string => {
      const result = planWorkflow(definition, { agentExists: () => true });
      assert.ok(result.ok);
      return result.plan.digest;
    };

    const base = digestOf(PART5.retryImmediate);
    assert.notEqual(base, digestOf(PART5.retryDelayed));

    // A changed impact summary is a different question put to a human, and a
    // reviewer who approved the first must not find the second under one digest.
    const approvalBase = digestOf(PART5.approval);
    assert.notEqual(
      approvalBase,
      digestOf({
        ...PART5.approval,
        nodes: [
          approvalNode('gate', { impactSummary: 'Continuing also deletes the draft.' }),
          ...PART5.approval.nodes.slice(1),
        ],
      }),
    );
    // And a changed approver list certainly is.
    assert.notEqual(
      approvalBase,
      digestOf({
        ...PART5.approval,
        nodes: [
          approvalNode('gate', { approverRoles: ['owner'] }),
          ...PART5.approval.nodes.slice(1),
        ],
      }),
    );
  });

  it('registers every Part 5 fixture without a single problem', () => {
    for (const definition of PART5_WORKFLOWS) {
      assert.deepEqual(
        validateWorkflowDefinition(definition, { agentExists: () => true }),
        [],
        definition.workflowId,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION — approvals, end to end
// ════════════════════════════════════════════════════════════════════════════

describe('approvals — the engine parks, and only a decision releases it', () => {
  async function startParked(workflowId: string, token = AGENT_TOKEN.consultant) {
    const harness = buildPart5Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(token),
      workflowId,
      input: TOPIC,
    });
    return { harness, detail };
  }

  it('parks on an approval node and creates a durable pending request', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);

    assert.equal(detail.state, 'waiting_for_approval');
    assert.equal(detail.currentNodeId, 'gate');
    assert.ok(detail.pendingApproval);
    assert.equal(detail.pendingApproval?.nodeId, 'gate');
    // Nothing has executed: a barrier runs no agent.
    assert.equal(detail.childAgentRunIds.length, 0);
    assert.equal(detail.stepCount, 0);

    const queue = await harness.workflows.approvals.pending('acme');
    assert.equal(queue.length, 1);
    assert.equal(queue[0].workflowApprovalId, detail.pendingApproval?.workflowApprovalId);
    assert.equal(queue[0].approvalState, 'pending');
    assert.equal(queue[0].workflowRunId, detail.workflowRunId);
  });

  it('does not move when advanced again while the decision is outstanding', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);

    const again = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    // NO WRITE AT ALL — a poll must not burn a run version.
    assert.equal(again.state, 'waiting_for_approval');
    assert.equal(again.runVersion, detail.runVersion);
  });

  it('resumes on an authorised approval and finishes the workflow', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);
    const approvalId = detail.pendingApproval?.workflowApprovalId as string;

    const decided = await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.reviewer),
      workflowApprovalId: approvalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });
    assert.equal(decided.approvalState, 'approved');
    assert.equal(decided.decidedBy, 'user-reviewer');

    const finished = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(finished.state, 'completed');
    assert.equal(finished.pendingApproval, undefined);

    // The barrier is in the history, with the decision it spent.
    const approvalStep = finished.steps.find((step) => step.kind === 'approval');
    assert.ok(approvalStep);
    assert.equal(approvalStep.workflowApprovalId, approvalId);
    assert.equal(approvalStep.approvalDecision, 'approve');
    assert.equal(approvalStep.outcome, 'completed');

    // And the approval is spent, once.
    const spent = await harness.workflows.approvals.get('acme', approvalId);
    assert.equal(spent?.approvalState, 'consumed');
    assert.ok(spent?.consumedAt);
  });

  it('refuses a decider who holds no approval capability', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);
    // A consultant is a full workflow OPERATOR — it started this run — and
    // still may not answer its approval. Separation of duties, enforced.
    const error = await rejection(
      harness.workflows.service.decideApproval({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowApprovalId: detail.pendingApproval?.workflowApprovalId as string,
        decision: 'approve',
        reason: 'Approving my own request.',
      }),
    );
    assert.equal(failureOf(error), 'workflow_unauthorized');

    const still = await harness.workflows.service.getRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(still.state, 'waiting_for_approval');
  });

  it('refuses a decider whose role the node did not authorise', async () => {
    // `reviewer` holds the capability and is not in this node's approver list.
    const { harness, detail } = await startParked(PART5.approvalOwnerOnly.workflowId);
    const error = await rejection(
      harness.workflows.service.decideApproval({
        ...harness.meta(AGENT_TOKEN.reviewer),
        workflowApprovalId: detail.pendingApproval?.workflowApprovalId as string,
        decision: 'approve',
        reason: 'Approving without the declared role.',
      }),
    );
    assert.equal(failureOf(error), 'workflow_approval_unauthorized');

    // The owner still can, which is what makes the refusal about the ROLE.
    const decided = await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.owner),
      workflowApprovalId: detail.pendingApproval?.workflowApprovalId as string,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });
    assert.equal(decided.approvalState, 'approved');
  });

  it('refuses a decider from another tenant', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);
    const error = await rejection(
      harness.workflows.service.decideApproval({
        ...harness.meta(AGENT_TOKEN.otherTenant),
        workflowApprovalId: detail.pendingApproval?.workflowApprovalId as string,
        decision: 'approve',
        reason: 'Approving another tenant a decision.',
      }),
    );
    // The other tenant is a consultant at globex, so the capability check bites
    // first. What matters is that it never reaches acme's record.
    assert.ok(
      ['workflow_unauthorized', 'workflow_approval_not_found'].includes(failureOf(error)),
      failureOf(error),
    );
    const untouched = await harness.workflows.approvals.get(
      'acme',
      detail.pendingApproval?.workflowApprovalId as string,
    );
    assert.equal(untouched?.approvalState, 'pending');
  });

  it('fails the run on a rejection, when the node declares fail', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);
    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.owner),
      workflowApprovalId: detail.pendingApproval?.workflowApprovalId as string,
      decision: 'reject',
      reason: 'This should not proceed.',
    });

    const ended = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(ended.state, 'failed');
    assert.equal(ended.failure, 'workflow_approval_rejected');
    const step = ended.steps.find((entry) => entry.kind === 'approval');
    assert.equal(step?.approvalDecision, 'reject');
    assert.equal(step?.outcome, 'failed');
  });

  it('cancels the run on a rejection, when the node declares cancel', async () => {
    const { harness, detail } = await startParked(PART5.approvalCancels.workflowId);
    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.owner),
      workflowApprovalId: detail.pendingApproval?.workflowApprovalId as string,
      decision: 'reject',
      reason: 'Stopping this cleanly.',
    });

    const ended = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    // The SAME rejection, a different declared outcome. That is the whole point
    // of `onRejection` being on the node rather than chosen by the engine.
    assert.equal(ended.state, 'cancelled');
    assert.equal(ended.steps.find((entry) => entry.kind === 'approval')?.outcome, 'cancelled');
  });

  it('fails the run when the decision window closes, and never approves it', async () => {
    const { harness, detail } = await startParked(PART5.approvalShort.workflowId);
    harness.clock.advance(60_001);

    const ended = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(ended.state, 'failed');
    assert.equal(ended.failure, 'workflow_approval_expired');

    const record = await harness.workflows.approvals.get(
      'acme',
      detail.pendingApproval?.workflowApprovalId as string,
    );
    assert.equal(record?.approvalState, 'expired');
    assert.equal(record?.decision, undefined);
  });

  it('refuses to spend one approval twice', async () => {
    const { harness, detail } = await startParked(PART5.approvalMidway.workflowId);
    const approvalId = detail.pendingApproval?.workflowApprovalId as string;

    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.owner),
      workflowApprovalId: approvalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });
    const finished = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(finished.state, 'completed');

    // Replaying the decision on a finished run cannot re-spend it.
    const replay = await rejection(
      harness.workflows.service.decideApproval({
        ...harness.meta(AGENT_TOKEN.owner),
        workflowApprovalId: approvalId,
        decision: 'approve',
        reason: 'Approving the same thing again.',
      }),
    );
    assert.equal(failureOf(replay), 'workflow_approval_conflict');
    assert.equal(
      (await harness.workflows.approvals.get('acme', approvalId))?.approvalState,
      'consumed',
    );
  });

  it('refuses a decision bound to a checkpoint the run has moved past', async () => {
    // The run parks at `gate` after `first` completed, so its approval names
    // checkpoint 1. Spending it against a later position must be refused.
    const { harness, detail } = await startParked(PART5.approvalMidway.workflowId);
    const approvalId = detail.pendingApproval?.workflowApprovalId as string;
    const stored = await harness.workflows.approvals.get('acme', approvalId);
    assert.ok(stored);
    assert.equal(stored.checkpointVersion, detail.checkpointVersion);

    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.owner),
      workflowApprovalId: approvalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });

    const error = await rejection(
      harness.workflows.approvals.consume('acme', approvalId, {
        nodeId: 'gate',
        checkpointVersion: stored.checkpointVersion + 1,
        workflowRunVersion: stored.workflowRunVersion,
      }),
    );
    assert.equal(failureOf(error), 'stale_workflow_approval');
  });

  it('refuses a decision bound to a run version the run has moved past', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);
    const approvalId = detail.pendingApproval?.workflowApprovalId as string;
    const stored = await harness.workflows.approvals.get('acme', approvalId);
    assert.ok(stored);
    // The park's own version is what the approval names.
    assert.equal(stored.workflowRunVersion, detail.runVersion);

    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.owner),
      workflowApprovalId: approvalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });

    const error = await rejection(
      harness.workflows.approvals.consume('acme', approvalId, {
        nodeId: 'gate',
        checkpointVersion: stored.checkpointVersion,
        workflowRunVersion: stored.workflowRunVersion + 1,
      }),
    );
    assert.equal(failureOf(error), 'stale_workflow_approval');
  });

  it('refuses pause and resume as a way past the barrier', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);

    // PAUSE IS REFUSED. An approval gate that could be paused would strand a
    // decision nobody could then act on — and pausing would move the run version
    // the approval is bound to.
    const paused = await rejection(
      harness.workflows.service.pauseRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: detail.workflowRunId,
        reason: 'Trying to pause past the gate.',
      }),
    );
    assert.equal(failureOf(paused), 'workflow_invalid_transition');

    // RESUME IS REFUSED TOO, and for the sharper reason: the run is not paused,
    // so releasing it this way would be naming a control operation instead of
    // making the decision.
    const resumed = await rejection(
      harness.workflows.service.resumeRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: detail.workflowRunId,
        reason: 'Trying to resume past the gate.',
      }),
    );
    assert.equal(failureOf(resumed), 'workflow_invalid_transition');

    const unchanged = await harness.workflows.service.getRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(unchanged.state, 'waiting_for_approval');
    assert.equal(unchanged.runVersion, detail.runVersion);
    assert.equal(unchanged.stepCount, 0);
  });

  it('cancels a parked run and withdraws the request nobody answered', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);
    const approvalId = detail.pendingApproval?.workflowApprovalId as string;

    const cancelled = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
      reason: 'Nobody is going to decide this.',
    });
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.pendingApproval, undefined);

    // The queue is cleared, and the request never became a yes.
    const record = await harness.workflows.approvals.get('acme', approvalId);
    assert.equal(record?.approvalState, 'withdrawn');
    assert.equal(record?.decision, undefined);
    assert.equal((await harness.workflows.approvals.pending('acme')).length, 0);
  });

  it('preserves a pending approval across an isolate restart', async () => {
    // Every durable store is created HERE and handed to both runtimes, which is
    // the only way the second one is genuinely a second isolate over the same
    // data rather than a fresh world that happens to share a run store.
    const stores = {
      runStore: createMemoryWorkflowRunStore(),
      checkpointStore: createMemoryWorkflowCheckpointStore(),
      approvalStore: createMemoryWorkflowApprovalStore(),
      agentRunStore: createMemoryAgentRunStore(),
      agentCheckpointStore: createMemoryCheckpointStore(),
      agentApprovalStore: createMemoryApprovalStore(),
    };

    const first = buildPart5Runtime(stores);
    const detail = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.approvalMidway.workflowId,
      input: TOPIC,
    });
    assert.equal(detail.state, 'waiting_for_approval');
    const approvalId = detail.pendingApproval?.workflowApprovalId as string;

    // A SECOND RUNTIME over the SAME stores. Nothing carries over in memory.
    // A distinct id seed, because two real isolates over one store do not share
    // an id counter — see `TestAgentRuntimeOptions.idSeed`.
    const second = buildPart5Runtime({ ...stores, clock: first.clock, idSeed: '2' });

    const recovered = await second.workflows.service.getRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(recovered.state, 'waiting_for_approval');
    assert.equal(recovered.pendingApproval?.workflowApprovalId, approvalId);
    assert.equal((await second.workflows.approvals.pending('acme')).length, 1);

    // And a decision taken in the new isolate releases the run recovered there.
    await second.workflows.service.decideApproval({
      ...second.meta(AGENT_TOKEN.owner),
      workflowApprovalId: approvalId,
      decision: 'approve',
      reason: 'Reviewed and accepted after the restart.',
    });
    const finished = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(finished.state, 'completed');
  });

  it('never returns run content through an approval read model', async () => {
    const { harness, detail } = await startParked(PART5.approval.workflowId);
    const view = await harness.workflows.service.getApproval({
      ...harness.meta(AGENT_TOKEN.reviewer),
      workflowApprovalId: detail.pendingApproval?.workflowApprovalId as string,
    });

    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes(TOPIC.topic), false, 'approval view echoes run input');
    for (const forbidden of ['input', 'output', 'outputs', 'payload', 'merged']) {
      assert.equal(Object.keys(view).includes(forbidden), false, forbidden);
    }
    // What it DOES carry is governance an approver needs to answer.
    assert.equal(view.impactSummary, 'Continuing runs the remaining steps of this workflow.');
    assert.deepEqual(view.authorizedRoles, [...APPROVER_ROLES].sort());
    assert.equal(view.singleUse, true);
  });
});

describe('approvals — inside a parallel branch', () => {
  it('parks one branch on a person while its sibling runs to completion', async () => {
    const harness = buildPart5Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.branchApproval.workflowId,
      input: TOPIC,
    });

    // THE RUN IS STILL A FAN-OUT, not a run blocked on a human: only the branch
    // that asked is waiting.
    assert.equal(detail.state, 'waiting_for_branches');
    const group = detail.parallelGroups[0];
    assert.ok(group);
    const left = group.branches.find((branch) => branch.branchName === 'left');
    const right = group.branches.find((branch) => branch.branchName === 'right');
    assert.equal(left?.state, 'waiting_for_approval');
    assert.ok(left?.pendingApproval);
    // The sibling finished — it was never held up.
    assert.equal(right?.state, 'completed');

    const queue = await harness.workflows.approvals.pending('acme');
    assert.equal(queue.length, 1);
    assert.equal(queue[0].branchName, 'left');
    assert.equal(queue[0].branchId, left?.branchId);
    assert.ok(typeof queue[0].branchVersion === 'number');

    // Deciding releases the branch, the join fires, and the run completes.
    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.reviewer),
      workflowApprovalId: queue[0].workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });
    const finished = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(finished.state, 'completed');
    const closed = finished.parallelGroups[0];
    assert.equal(closed?.state, 'joined');
    assert.equal(
      closed?.branches.find((branch) => branch.branchName === 'left')?.state,
      'completed',
    );
  });

  it('fails only the branch when its approval is rejected', async () => {
    const harness = buildPart5Runtime();
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.branchApproval.workflowId,
      input: TOPIC,
    });
    const queue = await harness.workflows.approvals.pending('acme');

    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.owner),
      workflowApprovalId: queue[0].workflowApprovalId,
      decision: 'reject',
      reason: 'This branch should not proceed.',
    });
    const ended = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });

    // The BRANCH failed; the group's `all` join policy is what turned that into
    // the run's outcome, which is the group's decision rather than the engine's.
    const group = ended.parallelGroups[0];
    assert.equal(
      group?.branches.find((branch) => branch.branchName === 'left')?.state,
      'failed',
    );
    assert.equal(
      group?.branches.find((branch) => branch.branchName === 'right')?.state,
      'completed',
    );
    assert.equal(ended.state, 'failed');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION — retries, end to end
// ════════════════════════════════════════════════════════════════════════════

describe('retries — the engine spends maxAttempts and no more', () => {
  function retryHarness(options: {
    readonly failures: number;
    readonly childFailure?: string;
  }): { harness: ReturnType<typeof buildPart5Runtime>; log: FlakyPortLog } {
    const log = emptyFlakyLog();
    const harness = buildPart5Runtime({
      wrapAgentPort: flakyAgentPort({
        agentId: WF5_AGENT.flaky,
        failures: options.failures,
        ...(options.childFailure === undefined ? {} : { childFailure: options.childFailure }),
        log,
      }),
    });
    return { harness, log };
  }

  it('retries a transient agent failure and completes on a later attempt', async () => {
    const { harness, log } = retryHarness({ failures: 1 });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryImmediate.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(log.failures, 1);

    // TWO CHILD AGENT RUNS, both real, both distinct. A retry is a new child.
    assert.equal(detail.childAgentRunIds.length, 2);
    assert.equal(new Set(detail.childAgentRunIds).size, 2);

    // The history records BOTH attempts, not only the one that worked.
    const attempts = detail.steps.filter((step) => step.nodeId === 'work');
    assert.deepEqual(attempts.map((step) => step.attempt), [1, 2]);
    assert.deepEqual(attempts.map((step) => step.outcome), ['failed', 'completed']);
    assert.equal(attempts[0].failureClass, 'transient');
    assert.equal(attempts[0].retryScheduled, true);

    // And the budget is released once the node succeeds.
    assert.equal(detail.retries.length, 0);
  });

  it('does not retry a failure that is a decision', async () => {
    const { harness, log } = retryHarness({ failures: 1, childFailure: 'capability_denied' });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryImmediate.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_node_failed');
    // ONE child, one attempt. Re-running an authorization decision would spend
    // an agent run to reach the same conclusion.
    assert.equal(detail.childAgentRunIds.length, 1);
    assert.equal(log.created.length, 1);
    const step = detail.steps.find((entry) => entry.nodeId === 'work');
    assert.equal(step?.attempt, 1);
    assert.equal(step?.failureClass, 'authorization');
    assert.equal(step?.retryScheduled, false);
  });

  it('does not retry a node whose ceiling is one attempt', async () => {
    const { harness } = retryHarness({ failures: 1 });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryOnce.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'failed');
    assert.equal(detail.childAgentRunIds.length, 1);
    // The failure is transient AND the budget was one, so this is exhaustion.
    assert.equal(detail.failure, 'workflow_retry_exhausted');
  });

  it('reaches a typed exhaustion failure after the last attempt', async () => {
    const { harness, log } = retryHarness({ failures: 3 });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryImmediate.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'failed');
    assert.equal(detail.failure, 'workflow_retry_exhausted');
    // EXACTLY maxAttempts, never a fourth.
    assert.equal(log.failures, 3);
    assert.equal(detail.childAgentRunIds.length, 3);
    assert.deepEqual(
      detail.steps.filter((step) => step.nodeId === 'work').map((step) => step.attempt),
      [1, 2, 3],
    );
  });

  it('never re-drives a child agent run that already failed', async () => {
    const { harness, log } = retryHarness({ failures: 2 });
    await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryImmediate.workflowId,
      input: TOPIC,
    });

    // THE NON-IDEMPOTENT DUPLICATE GUARD. Each child was driven exactly once;
    // a retry starts a NEW child rather than replaying effects that happened.
    const counts = new Map<string, number>();
    for (const id of log.driven) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      assert.equal(count, 1, `child ${id} was driven ${count} times`);
    }
    assert.equal(new Set(log.created).size, log.created.length);
  });

  it('persists backoff metadata and refuses to start before the delay elapses', async () => {
    const { harness, log } = retryHarness({ failures: 1 });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryDelayed.workflowId,
      input: TOPIC,
    });

    // Parked, not failed: the attempt is scheduled and not yet due.
    assert.equal(detail.state, 'running');
    assert.equal(detail.currentNodeId, 'work');
    assert.equal(detail.childAgentRunIds.length, 1);

    const attempt = detail.retries.find((entry) => entry.nodeId === 'work');
    assert.ok(attempt);
    assert.equal(attempt.attempt, 2);
    assert.equal(attempt.maxAttempts, 3);
    assert.equal(attempt.backoff, 'fixed_delay');
    assert.equal(attempt.delayMs, 30_000);
    assert.equal(attempt.lastClassification, 'transient');
    assert.equal(attempt.lastChildFailure, 'provider_unavailable');
    assert.ok(attempt.nextAttemptAt);

    // ADVANCING EARLY CREATES NOTHING. Nothing woke this run up, and nothing
    // needs to — see the suite header.
    const early = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(early.runVersion, detail.runVersion);
    assert.equal(early.childAgentRunIds.length, 1);
    assert.equal(log.created.length, 1);

    // ADVANCING AFTER IT ELAPSES PROCEEDS.
    harness.clock.advance(30_000);
    const resumed = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(resumed.state, 'completed');
    assert.equal(resumed.childAgentRunIds.length, 2);
  });

  it('records an exponential backoff that grows between attempts', async () => {
    const { harness } = retryHarness({ failures: 3 });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryExponential.workflowId,
      input: TOPIC,
    });

    const first = detail.retries.find((entry) => entry.nodeId === 'work');
    assert.ok(first);
    assert.equal(first.backoff, 'exponential');
    assert.equal(first.delayMs, 10_000);
    const firstDue = Date.parse(first.nextAttemptAt as string);

    harness.clock.advance(10_000);
    const second = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    const nextAttempt = second.retries.find((entry) => entry.nodeId === 'work');
    assert.ok(nextAttempt);
    assert.equal(nextAttempt.attempt, 3);
    // Doubled, deterministically.
    assert.equal(nextAttempt.delayMs, 20_000);
    assert.ok(Date.parse(nextAttempt.nextAttemptAt as string) > firstDue);
    assert.equal(nextAttempt.attemptVersion, first.attemptVersion + 1);
  });

  it('preserves attempt state across an isolate restart', async () => {
    const log = emptyFlakyLog();
    const stores = {
      runStore: createMemoryWorkflowRunStore(),
      checkpointStore: createMemoryWorkflowCheckpointStore(),
      approvalStore: createMemoryWorkflowApprovalStore(),
      agentRunStore: createMemoryAgentRunStore(),
      agentCheckpointStore: createMemoryCheckpointStore(),
      agentApprovalStore: createMemoryApprovalStore(),
    };

    const first = buildPart5Runtime({
      ...stores,
      wrapAgentPort: flakyAgentPort({ agentId: WF5_AGENT.flaky, failures: 1, log }),
    });
    const detail = await first.workflows.service.startRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.retryDelayed.workflowId,
      input: TOPIC,
    });
    assert.equal(detail.retries[0]?.attempt, 2);

    const second = buildPart5Runtime({ ...stores, clock: first.clock, idSeed: '2' });

    // THE NEW ISOLATE INHERITS THE COUNT, not a fresh budget.
    const recovered = await second.workflows.service.getRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(recovered.retries[0]?.attempt, 2);
    assert.equal(recovered.retries[0]?.maxAttempts, 3);
    assert.equal(recovered.retries[0]?.nextAttemptAt, detail.retries[0]?.nextAttemptAt);

    // And it honours the same backoff stamp rather than starting immediately.
    const early = await second.workflows.service.advanceRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: detail.workflowRunId,
    });
    assert.equal(early.runVersion, recovered.runVersion);
    assert.equal(early.childAgentRunIds.length, 1);
  });

  it('keeps a retry inside a branch local to that branch', async () => {
    const log = emptyFlakyLog();
    const harness = buildPart5Runtime({
      // One failure only: whichever branch reaches its node first spends it,
      // and the sibling must not lose an attempt to it.
      wrapAgentPort: flakyAgentPort({ agentId: WF5_AGENT.flaky, failures: 1, log }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.branchRetry.workflowId,
      input: TOPIC,
    });

    assert.equal(detail.state, 'completed');
    assert.equal(log.failures, 1);

    // The failed attempt and its retry are both recorded, both tagged with the
    // branch they belong to — and every branch step names one branch only.
    const failed = detail.steps.find(
      (step) => step.outcome === 'failed' && step.branchId !== undefined,
    );
    assert.ok(failed);
    assert.equal(failed.attempt, 1);
    assert.equal(failed.retryScheduled, true);

    const sameBranchRetry = detail.steps.find(
      (step) =>
        step.branchId === failed.branchId &&
        step.nodeId === failed.nodeId &&
        step.attempt === 2 &&
        step.outcome === 'completed',
    );
    assert.ok(sameBranchRetry, 'the retry ran in the branch that failed');

    // THE SIBLING NEVER RETRIED. Its node succeeded on attempt 1, which is what
    // "one branch's bad luck does not spend a sibling's budget" means concretely.
    const siblingSteps = detail.steps.filter(
      (step) => step.branchId !== undefined && step.branchId !== failed.branchId,
    );
    assert.ok(siblingSteps.length > 0);
    for (const step of siblingSteps) assert.equal(step.attempt, 1);

    // Three children: two for the retried branch, one for its sibling.
    assert.equal(detail.childAgentRunIds.length, 3);
    assert.equal(new Set(detail.childAgentRunIds).size, 3);
    // And no attempt record survives a completed run's nodes.
    assert.equal(detail.retries.length, 0);
  });

  it('leaves a branch that never failed with no attempt record at all', async () => {
    // The structural half of sibling isolation: the key includes the branch id,
    // so there is no filter under which one branch's failure could appear
    // against another. Asserted while a retry is actually pending.
    const log = emptyFlakyLog();
    const harness = buildTestWorkflowRuntime({
      workflows: [PART5.branchRetry],
      agents: PART5_AGENTS,
      wrapAgentPort: flakyAgentPort({ agentId: WF5_AGENT.flaky, failures: 1, log }),
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: PART5.branchRetry.workflowId,
      input: TOPIC,
    });

    const branchAttempts = detail.steps
      .filter((step) => step.branchId !== undefined)
      .reduce((seen, step) => seen.add(`${step.branchId}:${step.attempt}`), new Set<string>());
    // Two branches, and only one of them ever saw a second attempt.
    const withRetries = [...branchAttempts].filter((key) => key.endsWith(':2'));
    assert.equal(withRetries.length, 1);
  });
});
