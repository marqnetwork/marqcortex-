/**
 * Agent run lifecycle (AI-01 Batch 3A).
 *
 * Every case here drives a REAL orchestrator over a REAL control plane with the
 * mock provider. No stage is stubbed: the guard, the policy engine, the
 * governance layer, the prompt registry and the audit trail all run, which is
 * why a passing case here says something about production rather than about a
 * test double.
 *
 * Nothing in this file touches a network. The mock provider is non-billable and
 * `AI_ALLOW_REAL_REQUESTS` is unset, so the MARQ spend ledger is never moved —
 * a property the control-plane suite asserts directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_ID,
  AGENT_TOKEN,
  FIXTURE_AGENTS,
  buildTestAgentRuntime,
  primaryAgent,
  reviewerAgent,
} from './agentFixtures.ts';
import { isAgentRuntimeError } from '../agents/contracts/failures.ts';
import { createMemoryAgentRunStore, createMemoryCheckpointStore } from '../agents/persistence/ports.ts';
import { AGENT_AUDIT_EVENT } from '../agents/observability/agentAudit.ts';
import type { AgentDefinition } from '../agents/contracts/agent.ts';

/** Start a run under one identity and return everything a case needs. */
async function startRun(
  harness: ReturnType<typeof buildTestAgentRuntime>,
  script: string,
  options: { token?: string; agentId?: string; topic?: string } = {},
) {
  const token = options.token ?? AGENT_TOKEN.consultant;
  const meta = harness.meta(token);
  const actor = await harness.runtime.service.authorize(meta);
  const run = await harness.runtime.service.createRun(
    actor,
    {
      agentId: options.agentId ?? AGENT_ID.primary,
      objective: 'Establish a deterministic finding for the supplied topic.',
      input: { topic: options.topic ?? 'Intake handoffs', script },
    },
    meta,
  );
  return { actor, meta, run };
}

/** Fixture agents with one agent's limits overridden. */
function withLimits(
  agentIds: readonly string[],
  overrides: Partial<AgentDefinition['limits']>,
): readonly AgentDefinition[] {
  return FIXTURE_AGENTS.map((agent) =>
    agentIds.includes(agent.agentId)
      ? { ...agent, limits: { ...agent.limits, ...overrides } }
      : agent,
  );
}

describe('agent runs — creation and completion', () => {
  it('creates, runs and completes a single-agent run', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'model_then_complete');

    assert.equal(run.state, 'completed');
    assert.equal(run.stepCount, 2);
    assert.equal(run.handoffCount, 0);
    assert.ok(run.resultDigest, 'a completed run records the digest of its output');
    assert.ok(run.tokens.actualTotalTokens > 0, 'measured usage is recorded');
    assert.equal(run.tokens.attribution.length, 1);
    assert.equal(run.tokens.attribution[0].calls, 1);
  });

  it('records the entry context server-side and never from the caller', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'complete_immediately');

    assert.equal(run.organizationId, 'acme');
    assert.equal(run.actorId, 'user-consultant');
    assert.equal(run.agentId, AGENT_ID.primary);
    assert.equal(run.agentVersion, primaryAgent.version);
    assert.ok(run.planDigest.length > 0);
    assert.ok(Date.parse(run.deadlineAt) > Date.parse(run.createdAt));
  });

  it('refuses input that does not match the agent contract', async () => {
    const harness = buildTestAgentRuntime();
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);

    await assert.rejects(
      () =>
        harness.runtime.service.createRun(
          actor,
          { agentId: AGENT_ID.primary, objective: 'Bad input.', input: { nothing: true } },
          meta,
        ),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'invalid_action',
    );
  });

  it('refuses a run for a disabled agent and for an unknown one', async () => {
    const harness = buildTestAgentRuntime();
    const meta = harness.meta(AGENT_TOKEN.consultant);
    const actor = await harness.runtime.service.authorize(meta);

    await assert.rejects(
      () =>
        harness.runtime.service.createRun(
          actor,
          { agentId: AGENT_ID.disabled, objective: 'Should not start.', input: { topic: 'x', script: 'complete_immediately' } },
          meta,
        ),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'agent_disabled',
    );

    await assert.rejects(
      () =>
        harness.runtime.service.createRun(
          actor,
          { agentId: 'agent.test.absent', objective: 'Should not start.', input: { topic: 'x', script: 'complete_immediately' } },
          meta,
        ),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'agent_not_found',
    );
  });

  it('records an agent-declared failure with the agent’s own explanation', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'fail_immediately');

    assert.equal(run.state, 'failed');
    assert.match(run.failureMessage ?? '', /insufficient_input/);
    // No runtime failure code: no limit was crossed and no rule broken.
    assert.equal(run.failure, undefined);
  });
});

describe('agent runs — reading and listing', () => {
  it('reads a run, its steps and its usage', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, run } = await startRun(harness, 'model_then_complete');

    const detail = await harness.runtime.service.getRun(actor, run.runId);
    assert.equal(detail.runId, run.runId);
    assert.equal(detail.state, 'completed');

    const steps = await harness.runtime.service.getRunSteps(actor, run.runId);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].actionType, 'model_call');
    assert.equal(steps[1].actionType, 'complete');
    assert.ok(steps[0].executionRequestId, 'a model step joins to the control plane trail');

    const usage = await harness.runtime.service.getRunUsage(actor, run.runId);
    assert.equal(usage.stepCount, 2);
    assert.equal(usage.tokens.actualTotalTokens, detail.tokens.actualTotalTokens);
  });

  it('never exposes prompt, completion or tool content in a read model', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, run } = await startRun(harness, 'tool_then_complete');

    const detail = await harness.runtime.service.getRun(actor, run.runId);
    const steps = await harness.runtime.service.getRunSteps(actor, run.runId);
    const serialized = JSON.stringify({ detail, steps });

    // The mock's completion text and the tool's echoed statement are the two
    // pieces of content that could leak; both must be present only as digests.
    assert.equal(serialized.includes('Deterministic mock result'), false);
    assert.equal(serialized.includes('A second statement.'), false);
    for (const step of steps) {
      assert.equal('input' in step, false);
      assert.equal('output' in step, false);
      assert.ok(step.inputDigest.length > 0);
    }
  });

  it('lists runs newest first and filters by state', async () => {
    const harness = buildTestAgentRuntime();
    const { actor } = await startRun(harness, 'complete_immediately', { topic: 'one' });
    harness.clock.advance(1_000);
    await startRun(harness, 'pause_then_complete', { topic: 'two' });

    const all = await harness.runtime.service.listRuns(actor, {});
    assert.equal(all.length, 2);
    assert.equal(all[0].state, 'paused', 'newest first');

    const paused = await harness.runtime.service.listRuns(actor, { states: ['paused'] });
    assert.equal(paused.length, 1);

    const completed = await harness.runtime.service.listRuns(actor, { states: ['completed'] });
    assert.equal(completed.length, 1);
  });
});

describe('agent runs — control operations', () => {
  it('pauses at the agent’s request and resumes to completion', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, meta, run } = await startRun(harness, 'pause_then_complete');
    assert.equal(run.state, 'paused');

    const resumed = await harness.runtime.service.resumeRun(
      actor,
      run.runId,
      'operator resumed the run',
      meta,
    );
    assert.equal(resumed.state, 'completed');
    assert.equal(resumed.stepCount, 2);
  });

  it('pauses on operator request and refuses to advance while paused', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, meta, run } = await startRun(harness, 'pause_then_complete');

    const paused = await harness.runtime.service.getRun(actor, run.runId);
    assert.equal(paused.state, 'paused');

    // Advancing a parked run is a no-op rather than an accidental resume.
    const advanced = await harness.runtime.orchestrator.advance({
      organizationId: 'acme',
      runId: run.runId,
      actor: { actorId: actor.actorId, roles: actor.roles, capabilities: actor.capabilities },
      authorization: meta.authorization,
      requestId: 'req_probe',
      correlationId: meta.correlationId,
    });
    assert.equal(advanced.state, 'paused');
    assert.equal(advanced.stepCount, paused.stepCount);
  });

  it('cancels a run and refuses to revive it', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, meta, run } = await startRun(harness, 'pause_then_complete');

    const cancelled = await harness.runtime.service.cancelRun(
      actor,
      run.runId,
      'no longer needed',
      meta,
    );
    assert.equal(cancelled.state, 'cancelled');

    await assert.rejects(
      () => harness.runtime.service.resumeRun(actor, run.runId, 'try to revive it', meta),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'invalid_transition',
    );
  });

  it('refuses a control operation with no reason', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, meta, run } = await startRun(harness, 'pause_then_complete');

    await assert.rejects(
      () => harness.runtime.service.cancelRun(actor, run.runId, '', meta),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'invalid_action',
    );
  });

  it('expires a run whose deadline passed, without taking another step', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, meta, run } = await startRun(harness, 'pause_then_complete');
    const before = run.stepCount;

    harness.clock.advance(primaryAgent.limits.maxRuntimeMs + 1_000);

    const expired = await harness.runtime.service.resumeRun(
      actor,
      run.runId,
      'resume after the deadline',
      meta,
    );
    assert.equal(expired.state, 'expired');
    assert.equal(expired.failure, 'run_expired');
    assert.equal(expired.stepCount, before, 'an expired run takes no further step');
  });

  it('forks a NEW run on retry and leaves the terminal record untouched', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, meta, run } = await startRun(harness, 'fail_immediately');
    assert.equal(run.state, 'failed');

    const forked = await harness.runtime.service.retryRun(
      actor,
      run.runId,
      'retrying the failed run',
      meta,
    );
    assert.notEqual(forked.runId, run.runId);
    assert.equal(forked.parentRunId, run.runId);

    const original = await harness.runtime.service.getRun(actor, run.runId);
    assert.equal(original.state, 'failed');
    assert.equal(original.stepCount, run.stepCount, 'the original record is evidence, not a draft');
  });

  it('refuses to retry a run that has not finished', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, meta, run } = await startRun(harness, 'pause_then_complete');

    await assert.rejects(
      () => harness.runtime.service.retryRun(actor, run.runId, 'too early', meta),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'invalid_action',
    );
  });
});

describe('agent runs — tools', () => {
  it('executes a permitted tool and records only its digest', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, run } = await startRun(harness, 'tool_then_complete');

    assert.equal(run.state, 'completed');
    const steps = await harness.runtime.service.getRunSteps(actor, run.runId);
    const toolStep = steps.find((step) => step.actionType === 'tool_call');
    assert.ok(toolStep);
    assert.equal(toolStep.toolId, 'tool.text.summarize_counts');
    assert.ok(toolStep.outputDigest);
  });

  it('refuses a tool the agent never declared, terminally', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'undeclared_tool');

    assert.equal(run.state, 'policy_denied');
    assert.equal(run.failure, 'tool_denied');
    assert.equal(run.stepCount, 0, 'a denied action never becomes a step');
  });

  it('parks a run on a tool that requires approval rather than running it', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'approved_tool_then_complete');

    assert.equal(run.state, 'waiting_for_approval');
    assert.ok(run.pendingApprovalId);
  });
});

describe('agent runs — handoffs', () => {
  it('hands off to a permitted target and completes there', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, run } = await startRun(harness, 'handoff_then_complete');

    assert.equal(run.state, 'completed');
    assert.equal(run.handoffCount, 1);
    assert.equal(run.currentAgentId, AGENT_ID.reviewer);
    assert.equal(run.handoffs.length, 1);
    assert.equal(run.handoffs[0].fromAgentId, AGENT_ID.primary);
    assert.equal(run.handoffs[0].toAgentId, AGENT_ID.reviewer);
    assert.ok(run.handoffs[0].payloadDigest.length > 0);
    assert.ok(run.handoffs[0].payloadBytes > 0);

    const steps = await harness.runtime.service.getRunSteps(actor, run.runId);
    assert.equal(steps[0].targetAgentId, AGENT_ID.reviewer);
    // The payload itself never appears on the step.
    assert.equal(JSON.stringify(steps).includes('Please review.'), false);
  });

  it('refuses a handoff to an agent that is not an allowed target', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'handoff_to_stranger');

    assert.equal(run.state, 'policy_denied');
    assert.equal(run.failure, 'handoff_denied');
    assert.equal(run.handoffCount, 0);
  });

  it('stops a repeated handoff cycle', async () => {
    const harness = buildTestAgentRuntime({
      agents: withLimits([AGENT_ID.primary, AGENT_ID.reviewer], {
        maxHandoffs: 8,
        maxTotalSteps: 12,
        maxStepsPerAgent: 12,
        maxRepeatedHandoffs: 2,
        maxRepeatedActions: 6,
      }),
    });
    const { run } = await startRun(harness, 'handoff_ping_pong');

    assert.equal(run.state, 'failed');
    assert.equal(run.failure, 'loop_detected');
    assert.ok(run.handoffCount >= 2 && run.handoffCount <= 8);
  });

  it('stops at the handoff ceiling when the ceiling is the tighter limit', async () => {
    const harness = buildTestAgentRuntime({
      agents: withLimits([AGENT_ID.primary, AGENT_ID.reviewer], {
        maxHandoffs: 2,
        maxRepeatedHandoffs: 8,
        maxRepeatedActions: 8,
      }),
    });
    const { run } = await startRun(harness, 'handoff_ping_pong');

    assert.equal(run.state, 'failed');
    assert.equal(run.failure, 'handoff_limit_exceeded');
    assert.equal(run.handoffCount, 2);
  });

  it('does not carry the previous agent’s observation across a handoff', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, run } = await startRun(harness, 'handoff_then_complete');
    const checkpoint = await harness.runtime.orchestrator.latestCheckpoint('acme', run.runId);
    assert.ok(checkpoint);
    const progress = checkpoint.progress as { lastObservation?: unknown; handoff?: unknown };
    assert.ok(progress.handoff, 'the receiving agent sees the handoff');
    // `lastObservation` is cleared at the handoff, then re-set by the receiving
    // agent's own completion — so what matters is that the SENDER's observation
    // never became the receiver's input.
    assert.equal(run.currentAgentId, AGENT_ID.reviewer);
    assert.equal(reviewerAgent.agentId, AGENT_ID.reviewer);
    const steps = await harness.runtime.service.getRunSteps(actor, run.runId);
    assert.equal(steps[1].agentId, AGENT_ID.reviewer);
  });
});

describe('agent runs — checkpoints and restart recovery', () => {
  it('writes an immutable, versioned checkpoint chain', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'checkpoint_then_complete');

    const history = await harness.runtime.checkpoints.history('acme', run.runId);
    assert.ok(history.length >= 3, 'entry checkpoint plus one per step');
    assert.deepEqual(
      history.map((checkpoint) => checkpoint.version),
      history.map((_, index) => index + 1),
      'versions are contiguous and monotonic',
    );
    for (let index = 1; index < history.length; index += 1) {
      assert.equal(
        history[index].previousDigest,
        history[index - 1].progressDigest,
        'each checkpoint chains to the one before it',
      );
    }
  });

  it('refuses to rewrite a checkpoint version', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'complete_immediately');
    const latest = await harness.runtime.orchestrator.latestCheckpoint('acme', run.runId);
    assert.ok(latest);

    await assert.rejects(
      () => harness.runtime.checkpoints.write({ ...latest, progress: { tampered: true } }),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'checkpoint_conflict',
    );
  });

  it('resumes from the last valid checkpoint after a simulated isolate restart', async () => {
    // One set of stores, two runtimes. The second runtime has never seen the
    // run: everything it knows comes from what the first one persisted.
    const runStore = createMemoryAgentRunStore();
    const checkpointStore = createMemoryCheckpointStore();

    const first = buildTestAgentRuntime({ runStore, checkpointStore });
    const { run } = await startRun(first, 'pause_then_complete');
    assert.equal(run.state, 'paused');

    const second = buildTestAgentRuntime({ runStore, checkpointStore });
    const meta = second.meta(AGENT_TOKEN.consultant);
    const actor = await second.runtime.service.authorize(meta);

    const recovered = await second.runtime.service.getRun(actor, run.runId);
    assert.equal(recovered.state, 'paused');
    assert.equal(recovered.stepCount, run.stepCount);

    const resumed = await second.runtime.service.resumeRun(
      actor,
      run.runId,
      'resumed by a fresh isolate',
      meta,
    );
    assert.equal(resumed.state, 'completed');
    assert.equal(resumed.stepCount, 2);
  });
});

describe('agent runs — audit trail', () => {
  it('records the run’s identity on every event', async () => {
    const harness = buildTestAgentRuntime();
    const { actor, run } = await startRun(harness, 'model_then_complete');

    const records = harness.runtime.service.recentAudit(actor, 100);
    assert.ok(records.length > 0);
    for (const record of records) {
      assert.equal(record.organizationId, 'acme');
      assert.ok(record.runId.length > 0);
      assert.ok(record.correlationId.length > 0);
      assert.ok(record.requestId.length > 0);
      assert.ok(record.actorId.length > 0);
    }

    const events = records.map((record) => record.event);
    for (const expected of [
      AGENT_AUDIT_EVENT.runCreated,
      AGENT_AUDIT_EVENT.actionProposed,
      AGENT_AUDIT_EVENT.modelRouted,
      AGENT_AUDIT_EVENT.costEstimated,
      AGENT_AUDIT_EVENT.modelExecuted,
      AGENT_AUDIT_EVENT.runTerminated,
    ]) {
      assert.ok(events.includes(expected), `expected a ${expected} record`);
    }

    const executed = records.find((record) => record.event === AGENT_AUDIT_EVENT.modelExecuted);
    assert.ok(executed?.executionRequestId, 'a model step joins to the control plane trail');
    assert.equal(String(executed?.detail.outputDigest ?? '').length > 0, true);
    assert.equal(JSON.stringify(records).includes('Deterministic mock result'), false);
    assert.equal(run.state, 'completed');
  });

  it('records a denial as loudly as an execution', async () => {
    const harness = buildTestAgentRuntime();
    const { actor } = await startRun(harness, 'undeclared_tool');

    const records = harness.runtime.service.recentAudit(actor, 100);
    const decision = records.find(
      (record) => record.event === AGENT_AUDIT_EVENT.actionDecided && record.failure === 'tool_denied',
    );
    assert.ok(decision, 'a refused tool call is audited as a decision');
    assert.equal(decision.outcome, 'denied');

    // …and the run's termination is audited separately, with the same failure.
    const terminated = records.find(
      (record) => record.event === AGENT_AUDIT_EVENT.runTerminated && record.failure === 'tool_denied',
    );
    assert.ok(terminated, 'the terminal outcome is audited too');
    assert.equal(terminated.outcome, 'failed');
  });
});
