/**
 * BP-001 pilot integration — the agent tool call, end to end.
 *
 * The evaluator's own rules are asserted in
 * `platform/authority/__tests__/authorityEvaluator.test.ts`, over a pure
 * function with hand-built fixtures. THIS file asserts the things that only a
 * real runtime can answer, which are the two the packet reserves for the
 * integration (§10.11 and §10.13) plus the claim the whole packet rests on:
 *
 *   §10.11  the approval path reuses the EXISTING approval machinery — the same
 *           durable, single-use, server-side-authorised gate that was there
 *           before, not a second one wearing its name;
 *
 *   §10.13  the pilot still behaves exactly as it did when the decision is
 *           `ALLOW`, which is BP-001 §3.9's requirement that no working
 *           behaviour change outside the routing itself;
 *
 *   §10.12  a decision leaves structured, joinable evidence in the trail that
 *           already exists.
 *
 * WHY IT DRIVES THE REAL ORCHESTRATOR. A test that called the adapter directly
 * would prove the projection is well-formed and nothing about whether the
 * orchestrator enforces what comes back. Every case below starts a run through
 * `runtime.service` and reads the outcome the platform actually produced.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_ID,
  AGENT_TOKEN,
  FIXTURE_AGENTS,
  buildTestAgentRuntime,
} from './agentFixtures.ts';
import { isAgentRuntimeError } from '../agents/contracts/failures.ts';
import { AGENT_AUDIT_EVENT } from '../agents/observability/agentAudit.ts';
import type { AgentDefinition, AgentSafetyClass } from '../agents/contracts/agent.ts';
import { AUTHORITY_REASON } from '../../platform/authority/index.ts';

async function startRun(
  harness: ReturnType<typeof buildTestAgentRuntime>,
  script: string,
  options: { token?: string; agentId?: string } = {},
) {
  const meta = harness.meta(options.token ?? AGENT_TOKEN.consultant);
  const actor = await harness.runtime.service.authorize(meta);
  const run = await harness.runtime.service.createRun(
    actor,
    {
      agentId: options.agentId ?? AGENT_ID.primary,
      objective: 'Establish a deterministic finding for the supplied topic.',
      input: { topic: 'Intake handoffs', script },
    },
    meta,
  );
  return { actor, meta, run };
}

/** The fixture agents with one agent's safety class replaced. */
function withSafetyClass(agentId: string, safetyClass: AgentSafetyClass): readonly AgentDefinition[] {
  return FIXTURE_AGENTS.map((agent) =>
    agent.agentId === agentId ? { ...agent, safetyClass } : agent,
  );
}

async function authorityRecords(
  harness: ReturnType<typeof buildTestAgentRuntime>,
  token: string = AGENT_TOKEN.owner,
) {
  const actor = await harness.runtime.service.authorize(harness.meta(token));
  return harness.runtime.service
    .recentAudit(actor, 200)
    .filter((record) => record.event === AGENT_AUDIT_EVENT.actionDecided)
    .filter((record) => 'authority.decision' in record.detail);
}

// ── §10.13 — existing behaviour on ALLOW ────────────────────────────────────

describe('§10.13 — the pilot behaves exactly as before when the decision is ALLOW', () => {
  it('runs an unapproved-path tool call straight through to completion', async () => {
    // `tool_then_complete` calls the read-only summarize tool, which needed no
    // approval before this packet and must need none after it.
    const harness = buildTestAgentRuntime();
    const { actor, run } = await startRun(harness, 'tool_then_complete');
    assert.equal(run.state, 'completed');

    const steps = await harness.runtime.service.getRunSteps(actor, run.runId);
    const toolStep = steps.find(
      (step) => step.actionType === 'tool_call' && step.outcome === 'executed',
    );
    assert.ok(toolStep, 'the tool call actually ran');
    assert.equal(toolStep.toolId, 'tool.text.summarize_counts');
  });

  it('records the allow rather than staying silent about it', async () => {
    const harness = buildTestAgentRuntime();
    await startRun(harness, 'tool_then_complete');
    const records = await authorityRecords(harness);
    assert.equal(records.length, 1);
    assert.equal(records[0].detail['authority.decision'], 'ALLOW');
    assert.equal(records[0].outcome, 'allowed');
  });

  it('leaves the approval queue empty for an allowed call', async () => {
    const harness = buildTestAgentRuntime();
    await startRun(harness, 'tool_then_complete');
    const owner = await harness.runtime.service.authorize(harness.meta(AGENT_TOKEN.owner));
    assert.deepEqual(await harness.runtime.service.listPendingApprovals(owner), []);
  });
});

// ── §10.11 — the approval path is the existing machinery ────────────────────

describe('§10.11 — REQUIRE_APPROVAL reuses the existing approval gate', () => {
  it('parks the run on the same durable approval object as before', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'approved_tool_then_complete');
    assert.equal(run.state, 'waiting_for_approval');

    const owner = await harness.runtime.service.authorize(harness.meta(AGENT_TOKEN.owner));
    const pending = await harness.runtime.service.listPendingApprovals(owner);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].runId, run.runId);
    assert.equal(pending[0].state, 'pending');
    // The approver roles still come from the AGENT DEFINITION, server-side.
    // Nothing about routing the decision through the platform evaluator may
    // change who is allowed to say yes.
    assert.ok(pending[0].authorizedApproverRoles.includes('owner'));
  });

  it('describes the pending action from the authority decision', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'approved_tool_then_complete');
    const owner = await harness.runtime.service.authorize(harness.meta(AGENT_TOKEN.owner));
    const [pending] = await harness.runtime.service.listPendingApprovals(owner);

    assert.ok(pending.impactSummary.length > 0);
    assert.ok(pending.impactSummary.includes('tool.workspace.record_note'));
    // Short stable tokens an operator can filter on, not prose.
    assert.ok(pending.dataAffected.includes('tool:tool.workspace.record_note'));
    assert.ok(pending.dataAffected.includes('effect:write'));
    assert.equal(run.state, 'waiting_for_approval');
  });

  it('releases the run on approval and executes exactly the approved call', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'approved_tool_then_complete');
    const ownerMeta = harness.meta(AGENT_TOKEN.owner);
    const owner = await harness.runtime.service.authorize(ownerMeta);

    const approved = await harness.runtime.service.submitApproval(
      owner,
      {
        runId: run.runId,
        approvalId: run.pendingApprovalId ?? '',
        decision: 'approve',
        reason: 'authorised by the owner',
      },
      ownerMeta,
    );
    assert.equal(approved.state, 'completed');

    const steps = await harness.runtime.service.getRunSteps(owner, run.runId);
    const toolStep = steps.find(
      (step) => step.actionType === 'tool_call' && step.outcome === 'executed',
    );
    assert.ok(toolStep, 'the approved tool call ran');
    assert.equal(toolStep.toolId, 'tool.workspace.record_note');
  });

  it('still refuses an approver the agent did not authorise', async () => {
    // The authority decision says a human must decide. WHICH human is still the
    // approval gate's question, and the answer must not have widened.
    const harness = buildTestAgentRuntime();
    const { actor, meta, run } = await startRun(harness, 'approved_tool_then_complete');

    await assert.rejects(
      () =>
        harness.runtime.service.submitApproval(
          actor,
          {
            runId: run.runId,
            approvalId: run.pendingApprovalId ?? '',
            decision: 'approve',
            reason: 'looks fine to me',
          },
          meta,
        ),
      (error: unknown) => isAgentRuntimeError(error) && error.failure === 'unauthorized',
    );

    const still = await harness.runtime.service.getRun(actor, run.runId);
    assert.equal(still.state, 'waiting_for_approval');
  });

  it('does not park a second time once an approval is pending', async () => {
    // The replay after approval re-enters the same code path. A decision that
    // parked again would make an approved run un-completable — which is the
    // regression the `pendingApprovalId` guard exists to prevent, now sitting
    // behind the evaluator instead of in front of it.
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'approved_tool_then_complete');
    const ownerMeta = harness.meta(AGENT_TOKEN.owner);
    const owner = await harness.runtime.service.authorize(ownerMeta);

    const approved = await harness.runtime.service.submitApproval(
      owner,
      {
        runId: run.runId,
        approvalId: run.pendingApprovalId ?? '',
        decision: 'approve',
        reason: 'authorised by the owner',
      },
      ownerMeta,
    );
    assert.equal(approved.state, 'completed');
    assert.deepEqual(await harness.runtime.service.listPendingApprovals(owner), []);
  });

  it('records the approval requirement as a decision, not as an allow', async () => {
    const harness = buildTestAgentRuntime();
    await startRun(harness, 'approved_tool_then_complete');
    const records = await authorityRecords(harness);
    const parked = records.find(
      (record) => record.detail['authority.decision'] === 'REQUIRE_APPROVAL',
    );
    assert.ok(parked, 'the requirement is in the trail');
    assert.equal(parked.outcome, 'recorded');
    assert.ok(
      String(parked.detail['authority.reasonCodes']).includes(
        AUTHORITY_REASON.policyRequiresApproval,
      ),
    );
    assert.equal(parked.detail['authority.withinEnvelopeCeiling'], true);
  });
});

// ── The envelope actually bounds the agent ──────────────────────────────────

describe('the agent cannot exceed its envelope', () => {
  it('denies a tool whose data classification is above the agent’s ceiling', async () => {
    // An `internal_readonly` agent reads platform metadata only. Every tool in
    // the deterministic set is scoped to the run's own organization, so the
    // data ceiling is what refuses this — a bound that lives in the envelope
    // and nowhere else in the runtime.
    const harness = buildTestAgentRuntime({
      agents: withSafetyClass(AGENT_ID.primary, 'internal_readonly'),
    });

    // A DENIAL IS TERMINAL, NOT AN EXCEPTION TO THE CALLER. That is the shape
    // the runtime already uses for a refused action — `agentRuns.test.ts`
    // asserts the same three facts for an undeclared tool — and routing the
    // decision through the platform evaluator does not change it.
    const { run } = await startRun(harness, 'tool_then_complete');
    assert.equal(run.state, 'policy_denied');
    assert.equal(run.failure, 'tool_denied');
    assert.equal(run.stepCount, 0, 'a denied action never becomes a step');
  });

  it('records that denial with its reason code', async () => {
    const harness = buildTestAgentRuntime({
      agents: withSafetyClass(AGENT_ID.primary, 'internal_readonly'),
    });
    await startRun(harness, 'tool_then_complete');

    const records = await authorityRecords(harness);
    const denied = records.find((record) => record.detail['authority.decision'] === 'DENY');
    assert.ok(denied, 'the denial is in the trail');
    assert.equal(denied.outcome, 'denied');
    assert.ok(
      String(denied.detail['authority.reasonCodes']).includes(
        AUTHORITY_REASON.dataCeilingExceeded,
      ),
    );
  });

  it('still refuses a tool outside the allow list, as it did before', async () => {
    // The orchestrator already refuses this at action-sealing time, BEFORE the
    // evaluator runs. Asserted here so that the pilot is on record as not
    // having moved, weakened or duplicated that check.
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'undeclared_tool');
    assert.equal(run.state, 'policy_denied');
    assert.equal(run.failure, 'tool_denied');
    assert.equal(run.stepCount, 0);
  });
});

// ── §10.12 — structured, joinable evidence ──────────────────────────────────

describe('§10.12 — the decision leaves structured evidence in the existing trail', () => {
  it('writes into the agent trail rather than a fourth one', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'tool_then_complete');
    const [record] = await authorityRecords(harness);

    // Joinable by construction: the record carries the run, the tenant and the
    // correlation id the rest of the platform uses.
    assert.equal(record.runId, run.runId);
    assert.equal(record.organizationId, run.organizationId);
    assert.equal(record.correlationId, 'cor_test_agent');
    assert.equal(record.actionType, 'tool_call');
  });

  it('carries machine-readable reason codes and the envelope it decided against', async () => {
    const harness = buildTestAgentRuntime();
    await startRun(harness, 'tool_then_complete');
    const [record] = await authorityRecords(harness);

    assert.equal(record.detail['authority.actionType'], 'agent.tool.call');
    assert.equal(record.detail['authority.resourceType'], 'agent.tool');
    assert.equal(record.detail['authority.requestedEffect'], 'read');
    // `medium`, not `low`, and the reason is worth stating: every tool in the
    // deterministic set is scoped to the run's own organization, so the data
    // floor puts even a read-only summarize call at `medium`. The agent's
    // envelope reaches `medium` too — derived from the same fold — so it is
    // allowed. A ceiling derived by any other route would disagree here.
    assert.equal(record.detail['authority.consequenceLevel'], 'medium');
    assert.equal(record.detail['authority.actorType'], 'ai_agent');
    assert.equal(record.detail['authority.tool'], 'tool.text.summarize_counts');
    assert.equal(
      record.detail['authority.envelopeId'],
      `agent:${AGENT_ID.primary}@1.0.0`,
    );
    // The MAJOR component, not the separators stripped out. `1.0.0` is version
    // 1 — not 100 — and the id above is what carries the full string.
    assert.equal(record.detail['authority.envelopeVersion'], 1);
    assert.ok(String(record.detail['authority.permissions']).includes('agent.tool.invoke'));
    assert.ok(String(record.detail['authority.evaluatedSteps']).includes('envelope'));
  });

  it('names the agent as the actor and never the person as the authority', async () => {
    // The claim that makes the pilot worth doing: a tool call is the AGENT's
    // action, bounded by the agent's envelope. The person who started the run
    // is provenance on the record, not a source of permission.
    const harness = buildTestAgentRuntime();
    await startRun(harness, 'tool_then_complete');
    const [record] = await authorityRecords(harness);
    assert.equal(record.detail['authority.actorType'], 'ai_agent');
    assert.equal(record.detail['authority.membershipVerified'], true);
  });

  it('holds only bounded scalars', async () => {
    const harness = buildTestAgentRuntime();
    await startRun(harness, 'tool_then_complete');
    const [record] = await authorityRecords(harness);
    for (const [key, value] of Object.entries(record.detail)) {
      assert.ok(
        ['string', 'number', 'boolean'].includes(typeof value),
        `${key} is ${typeof value}`,
      );
      if (typeof value === 'string') assert.ok(value.length <= 300, key);
    }
  });
});

// ── Tenant isolation through the real runtime ───────────────────────────────

describe('tenant isolation survives the pilot', () => {
  it('keeps a run and its authority records inside their own organization', async () => {
    const harness = buildTestAgentRuntime();
    const { run } = await startRun(harness, 'tool_then_complete');
    const [record] = await authorityRecords(harness);
    assert.equal(record.detail['authority.decision'], 'ALLOW');
    assert.equal(record.organizationId, run.organizationId);

    // The decision was made for the run's own tenant, which is the only tenant
    // the actor context can name — the adapter reads it from the run record and
    // has no way to be handed another.
    const owner = await harness.runtime.service.authorize(harness.meta(AGENT_TOKEN.owner));
    const readBack = await harness.runtime.service.getRun(owner, run.runId);
    assert.equal(readBack.organizationId, run.organizationId);
  });
});
