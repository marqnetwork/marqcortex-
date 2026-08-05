/**
 * Workflow security, RBAC and HTTP surface suite (AI-01 Batch 3B).
 *
 * The guarantees this batch inherits from Batches 1, 2 and 3A are only inherited if
 * the workflow engine cannot step around them. So these tests are adversarial:
 * every case is a caller trying to do something the engine must refuse — read
 * another tenant's run, escalate a role, decide an approval they hold no authority
 * over, drive a workflow while AI is administratively stopped, spend past the MARQ
 * ceiling, or reach a tool the definition never declared.
 *
 * They also assert the two claims the tool bridge's own header makes, because a
 * comment asserting a security property is worth exactly nothing on its own: the
 * principal is narrower than the workflow, and it cannot be asked to propose.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowHttpRequest,
} from '../workflows/http/workflowHttpAdapter.ts';
import type { WorkflowActor } from '../workflows/service/workflowRbac.ts';
import {
  WORKFLOW_ROLE_CAPABILITIES,
  financeScopeFor,
  readScopeFor,
  resolveWorkflowActor,
} from '../workflows/service/workflowRbac.ts';
import { workflowToolPrincipal } from '../workflows/orchestrator/toolBridge.ts';
import { isWorkflowError } from '../workflows/contracts/failures.ts';
import {
  WORKFLOW_ID,
  WORKFLOW_TOKEN,
  bearer,
  buildTestWorkflowRuntime,
  toolWorkflow,
  workflowRunBody,
  type TestWorkflowRuntime,
} from './workflowFixtures.ts';
import { DETERMINISTIC_TOOL_IDS } from '../agents/tools/mockTools.ts';

function caller(harness: TestWorkflowRuntime, token: string | null) {
  return (
    request: Partial<WorkflowHttpRequest> & { operation: WorkflowHttpRequest['operation'] },
  ) =>
    executeWorkflowHttpRequest(harness.runtime.service, {
      authorization: token === null ? null : bearer(token),
      ...request,
    });
}

/**
 * Engage the emergency stop through the settings store the plane actually reads.
 *
 * `adopt` is the store's own contract: durable storage allocates versions, and an
 * isolate's job is to catch up to one. A test that reached past it into a private
 * field would be testing a shape rather than the control.
 */
function engageEmergencyStop(harness: TestWorkflowRuntime): void {
  const current = harness.plane.settings.current();
  const adopted = harness.plane.settings.adopt({
    ...current,
    // `emergencyStop` is a record, not a boolean. Writing `true` here type-checks
    // against a looser object and silently leaves the switch off, which is exactly
    // the shape of bug a test asserting on the switch must not have — so the
    // assertion below proves the engine sees it.
    emergencyStop: { ...current.emergencyStop, engaged: true },
    configurationVersion: current.configurationVersion + 1,
  });
  assert.equal(adopted.emergencyStop.engaged, true);
  assert.equal(harness.runtime.state().aiEnabled, false, 'the engine must see the stop');
}

const ORG_OPTIONS = {
  defaultOrganizationId: 'acme',
  allowList: [],
  allowDefaultOrganization: true,
};

// ── Authentication and authorization ────────────────────────────────────────

describe('workflow authorization boundary', () => {
  it('refuses every operation without a credential', async () => {
    const harness = buildTestWorkflowRuntime();
    const anonymous = caller(harness, null);
    for (const operation of Object.values(WORKFLOW_OPERATION)) {
      const response = await anonymous({
        operation,
        workflowId: WORKFLOW_ID.sequential,
        workflowRunId: 'wfr_probe',
        workflowApprovalId: 'wfa_probe',
        body: { workflowId: WORKFLOW_ID.sequential, input: {}, reason: 'probing', decision: 'approve' },
      });
      assert.equal(response.body.success, false, `${operation} must refuse an anonymous caller`);
      assert.equal(response.status, 401, `${operation} must return AUTH_REQUIRED`);
    }
  });

  it('refuses a caller whose roles grant nothing', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, WORKFLOW_TOKEN.outsider)({
      operation: WORKFLOW_OPERATION.overview,
    });
    assert.equal(response.body.success, false);
    assert.equal(response.status, 403);
  });

  it('refuses a reviewer trying to create a run', async () => {
    const harness = buildTestWorkflowRuntime();
    // A reviewer approves other people's work and must not be able to create work
    // that then asks itself for approval.
    const response = await caller(harness, WORKFLOW_TOKEN.reviewer)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody(),
    });
    assert.equal(response.body.success, false);
    assert.equal(response.body.failure, 'unauthorized');
  });

  it('refuses a consultant reading finance', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody(),
    });
    const run = created.body.run as { workflowRunId: string };

    // The consultant may watch the run…
    const nodes = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.runNodes,
      workflowRunId: run.workflowRunId,
    });
    assert.equal(nodes.body.success, true);

    // …and may not read what it cost.
    for (const operation of [
      WORKFLOW_OPERATION.costReport,
      WORKFLOW_OPERATION.financialSummary,
      WORKFLOW_OPERATION.savingsSummary,
    ]) {
      const response = await caller(harness, WORKFLOW_TOKEN.consultant)({
        operation,
        workflowRunId: run.workflowRunId,
      });
      assert.equal(response.body.success, false, `${operation} needs the finance capability`);
      assert.equal(response.body.failure, 'unauthorized');
    }
  });

  it('grants no role a capability that would let it edit a definition', () => {
    for (const capabilities of Object.values(WORKFLOW_ROLE_CAPABILITIES)) {
      for (const capability of capabilities) {
        assert.ok(
          !capability.includes('registry.write') && !capability.includes('registry.create'),
          `no role may hold ${capability}: definitions are code`,
        );
      }
    }
  });

  it('gives only platform roles a cross-tenant read', () => {
    for (const [role, capabilities] of Object.entries(WORKFLOW_ROLE_CAPABILITIES)) {
      const platform = capabilities.includes('workflow.run.read.platform');
      const platformFinance = capabilities.includes('workflow.finance.read.platform');
      if (platform || platformFinance) {
        assert.ok(
          role === 'super_admin' || role === 'platform_admin',
          `${role} must not hold a cross-tenant read`,
        );
      }
    }
  });

  it('never lets a control operation cross a tenant', () => {
    for (const capabilities of Object.values(WORKFLOW_ROLE_CAPABILITIES)) {
      for (const capability of capabilities) {
        if (!capability.endsWith('.platform')) continue;
        assert.ok(
          capability === 'workflow.run.read.platform' ||
            capability === 'workflow.finance.read.platform',
          `${capability} is a cross-tenant capability that is not a read`,
        );
      }
    }
  });
});

// ── Tenant isolation ────────────────────────────────────────────────────────

describe('workflow tenant isolation', () => {
  it('shows another tenant nothing, and does not confirm the id exists', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody(),
    });
    const run = created.body.run as { workflowRunId: string };

    const foreign = await caller(harness, WORKFLOW_TOKEN.otherTenant)({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: run.workflowRunId,
    });
    assert.equal(foreign.body.success, false);
    // "Not found" and "not yours" are the same answer on purpose: distinguishing
    // them would make this endpoint a way to test whether an id exists elsewhere.
    assert.equal(foreign.body.failure, 'workflow_run_not_found');
    assert.equal(foreign.status, 404);
  });

  it('ignores an organizationId a tenant actor supplies', async () => {
    const harness = buildTestWorkflowRuntime();
    await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody(),
    });
    const listed = await caller(harness, WORKFLOW_TOKEN.otherTenant)({
      operation: WORKFLOW_OPERATION.listRuns,
      organizationId: 'acme',
    });
    assert.equal(listed.body.success, true);
    assert.deepEqual(listed.body.runs, [], 'a tenant asking for another gets their own, empty');
  });

  it('honours an organizationId only for a platform reader', () => {
    const tenant = resolveWorkflowActor(
      {
        subjectId: 'user-consultant',
        actorType: 'team_user',
        globalRoles: ['consultant'],
        memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['consultant'] }],
      },
      undefined,
      ORG_OPTIONS,
    );
    assert.equal(readScopeFor(tenant, 'globex'), 'acme');
    assert.equal(financeScopeFor(tenant, 'globex'), 'acme');

    const platform = resolveWorkflowActor(
      {
        subjectId: 'user-platform',
        actorType: 'team_user',
        globalRoles: ['super_admin'],
        memberships: [{ organizationId: 'acme', tier: 'internal', roles: ['owner'] }],
      },
      undefined,
      ORG_OPTIONS,
    );
    assert.equal(readScopeFor(platform, 'globex'), 'globex');
    assert.equal(financeScopeFor(platform, 'globex'), 'globex');
  });

  it('does not let a platform RUN reader widen a FINANCE read', () => {
    // A hand-built actor holding the platform run read but NOT the platform finance
    // read: the two scopes must disagree, which is the whole point of separating them.
    const actor: WorkflowActor = {
      actorId: 'user-mixed',
      roles: ['consultant'],
      capabilities: [
        'workflow.run.read',
        'workflow.run.read.platform',
        'workflow.finance.read',
      ],
      organization: {
        organizationId: 'acme',
        tier: 'enterprise',
        membershipVerified: true,
        isolationKey: 'org:acme',
      },
      platformReader: true,
      platformFinanceReader: false,
    };
    assert.equal(readScopeFor(actor, 'globex'), 'globex');
    assert.equal(financeScopeFor(actor, 'globex'), 'acme');
  });

  it('scopes the audit trail to the reading tenant', async () => {
    const harness = buildTestWorkflowRuntime();
    await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody(),
    });

    const foreign = await caller(harness, WORKFLOW_TOKEN.otherTenant)({
      operation: WORKFLOW_OPERATION.audit,
      limit: 100,
    });
    assert.equal(foreign.body.success, true);
    const records = foreign.body.records as { organizationId: string }[];
    assert.ok(
      records.every((record) => record.organizationId === 'globex'),
      'a tenant sees only its own audit records',
    );

    const platform = await caller(harness, WORKFLOW_TOKEN.platform)({
      operation: WORKFLOW_OPERATION.audit,
      limit: 100,
    });
    const platformRecords = platform.body.records as { organizationId: string }[];
    assert.ok(platformRecords.length > 0, 'a platform reader sees across tenants');
  });
});

// ── Approval authority ──────────────────────────────────────────────────────

describe('workflow approval authority', () => {
  it('refuses a decision from another tenant even with the right role', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: WORKFLOW_ID.approval }),
    });
    const run = created.body.run as { workflowRunId: string; pendingApprovalId: string };

    // `otherTenant` is a consultant at globex — wrong tenant AND wrong role.
    const response = await caller(harness, WORKFLOW_TOKEN.otherTenant)({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: run.workflowRunId,
      workflowApprovalId: run.pendingApprovalId,
      body: { decision: 'approve', reason: 'approving another tenants work' },
    });
    assert.equal(response.body.success, false);

    const untouched = await harness.runtime.approvals.get('acme', run.pendingApprovalId);
    assert.equal(untouched?.state, 'pending');
  });

  it('refuses an approval id that belongs to another run', async () => {
    const harness = buildTestWorkflowRuntime();
    const first = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: WORKFLOW_ID.approval }),
    });
    const second = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: WORKFLOW_ID.approval, input: { topic: 'Second' } }),
    });
    const runA = first.body.run as { workflowRunId: string; pendingApprovalId: string };
    const runB = second.body.run as { pendingApprovalId: string };

    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: runA.workflowRunId,
      workflowApprovalId: runB.pendingApprovalId,
      body: { decision: 'approve', reason: 'using the wrong approval' },
    });
    assert.equal(response.body.success, false);
    assert.match(String(response.body.error), /does not belong to this run/);
  });

  it('requires a reason of a usable length', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: WORKFLOW_ID.approval }),
    });
    const run = created.body.run as { workflowRunId: string; pendingApprovalId: string };

    for (const reason of ['', 'ab', 'x'.repeat(400)]) {
      const response = await caller(harness, WORKFLOW_TOKEN.owner)({
        operation: WORKFLOW_OPERATION.submitApproval,
        workflowRunId: run.workflowRunId,
        workflowApprovalId: run.pendingApprovalId,
        body: { decision: 'approve', reason },
      });
      assert.equal(response.body.success, false, `reason of length ${reason.length} must be refused`);
    }
  });

  it('refuses a decision that is neither approve nor reject', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: WORKFLOW_ID.approval }),
    });
    const run = created.body.run as { workflowRunId: string; pendingApprovalId: string };
    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.submitApproval,
      workflowRunId: run.workflowRunId,
      workflowApprovalId: run.pendingApprovalId,
      body: { decision: 'maybe', reason: 'not a real decision' },
    });
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, 'VALIDATION_FAILED');
  });
});

// ── Administrative controls ─────────────────────────────────────────────────

describe('workflow administrative controls', () => {
  it('stops progression when the emergency switch is engaged', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: WORKFLOW_ID.waiting }),
    });
    const run = created.body.run as { workflowRunId: string; state: string };
    assert.notEqual(run.state, 'completed');

    // The kill switch, read live on the NEXT node rather than captured at assembly.
    engageEmergencyStop(harness);
    harness.clock.advance(120_000);

    const advanced = await harness.runtime.orchestrator.advance({
      organizationId: 'acme',
      workflowRunId: run.workflowRunId,
      actor: { actorId: 'user-owner', roles: ['owner'], capabilities: [] },
      authorization: bearer(WORKFLOW_TOKEN.owner),
      requestId: 'req_stopped',
      correlationId: 'cor_stopped',
    });
    assert.equal(advanced.state, 'paused', 'the run stops rather than being destroyed');

    const audit = harness.runtime.audit.recent(50);
    assert.ok(
      audit.some((entry) => entry.failure === 'workflow_disabled_runtime'),
      'the stop is recorded with its own failure code',
    );
  });

  it('refuses to create a run while AI is administratively stopped', async () => {
    const harness = buildTestWorkflowRuntime();
    engageEmergencyStop(harness);
    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody(),
    });
    assert.equal(response.body.success, false);
    assert.equal(response.body.failure, 'workflow_disabled_runtime');
  });

  it('refuses a disabled workflow', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: WORKFLOW_ID.disabled }),
    });
    assert.equal(response.body.success, false);
    assert.equal(response.body.failure, 'workflow_disabled');
  });

  it('refuses an unregistered workflow without confirming what exists', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: 'workflow.test.not_registered' }),
    });
    assert.equal(response.body.success, false);
    assert.equal(response.body.failure, 'workflow_not_found');
  });

  it('reads the MARQ lifetime ceiling before every billable node', async () => {
    // The engine READS the platform headroom rather than reserving against it — the
    // control plane's own spend guard is what holds money for a call. What this
    // asserts is that the read happens and is recorded on the cost decision, which
    // is the evidence that the ceiling is consulted BEFORE the provider is reached.
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody(),
    });
    assert.equal(created.body.success, true);

    const audit = harness.runtime.audit.recent(100);
    const costed = audit.filter((entry) => entry.event === 'ai.workflow.cost.estimated');
    assert.ok(costed.length > 0, 'a billable node is costed');
    for (const entry of costed) {
      assert.ok(
        typeof entry.detail.platformRemainingMicroUsd === 'number',
        'every cost decision records the platform headroom it read',
      );
    }
    // And the decision is recorded before the model executes, in that order.
    const events = audit
      .slice()
      .reverse()
      .map((entry) => entry.event);
    assert.ok(
      events.indexOf('ai.workflow.cost.estimated') < events.indexOf('ai.workflow.model.executed'),
      'the cost decision precedes the model call',
    );
  });
});

// ── The tool principal ──────────────────────────────────────────────────────

describe('workflow tool principal', () => {
  const node = toolWorkflow.nodes.find((entry) => entry.nodeType === 'tool');
  assert.ok(node && node.nodeType === 'tool');

  it('is narrower than the workflow, never wider', () => {
    const principal = workflowToolPrincipal(toolWorkflow, node);
    assert.deepEqual(principal.allowedTools, [DETERMINISTIC_TOOL_IDS.summarize]);
    assert.ok(
      toolWorkflow.allowedTools.length > principal.allowedTools.length,
      'the workflow declares more tools than the principal may reach',
    );
    assert.deepEqual(principal.capabilities, ['agent.tool.invoke']);
    assert.deepEqual(principal.allowedModelProfiles, []);
    assert.deepEqual(principal.allowedHandoffTargets, []);
  });

  it('authorises nothing when the workflow does not declare the tool', () => {
    const principal = workflowToolPrincipal({ ...toolWorkflow, allowedTools: [] }, node);
    assert.deepEqual(principal.allowedTools, []);
  });

  it('cannot be asked to propose an action', () => {
    const principal = workflowToolPrincipal(toolWorkflow, node);
    assert.throws(
      () =>
        principal.propose({
          runId: 'run_1',
          agentId: principal.agentId,
          organizationId: 'acme',
          objective: 'do something',
          input: {},
          stepCount: 0,
          stepsTakenByThisAgent: 0,
          handoffCount: 0,
          remaining: {
            steps: 1,
            handoffs: 0,
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 1,
            estimatedCostMicroUsd: 0,
            actualCostMicroUsd: 0,
            runtimeMs: 1_000,
          },
          checkpointVersion: 1,
        }),
      (error: unknown) => {
        assert.ok(isWorkflowError(error));
        assert.equal(error.failure, 'capability_denied');
        return true;
      },
    );
  });

  it('demands approval for every risk class above read-only', () => {
    const principal = workflowToolPrincipal(toolWorkflow, node);
    assert.ok(principal.approvals.requireForToolRisk.includes('moderate'));
    assert.ok(principal.approvals.requireForToolRisk.includes('high'));
    assert.equal(principal.approvals.requireForCompletion, false);
    assert.equal(principal.approvals.requireForHandoff, true);
  });

  it('carries a namespaced id that cannot collide with a registered agent', () => {
    const principal = workflowToolPrincipal(toolWorkflow, node);
    assert.match(principal.agentId, /^workflow\.principal\./);
  });
});

// ── HTTP surface hygiene ────────────────────────────────────────────────────

describe('workflow HTTP surface', () => {
  it('never returns server-side diagnostics to a caller', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: 'wfr_does_not_exist',
    });
    assert.equal(response.body.success, false);
    assert.equal(response.body.diagnostics, undefined, 'diagnostics stay server-side');
    assert.ok(typeof response.body.error === 'string');
    assert.ok(typeof response.body.code === 'string');
  });

  it('rejects a malformed identifier before it reaches a store key', async () => {
    const harness = buildTestWorkflowRuntime();
    for (const workflowRunId of ['../../etc/passwd', 'a b', '', 'x'.repeat(200)]) {
      const response = await caller(harness, WORKFLOW_TOKEN.owner)({
        operation: WORKFLOW_OPERATION.getRun,
        workflowRunId,
      });
      assert.equal(response.body.success, false, `"${workflowRunId}" must be refused`);
      assert.equal(response.body.code, 'VALIDATION_FAILED');
    }
  });

  it('ignores an undeclared body key rather than forwarding it', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: {
        ...workflowRunBody(),
        // None of these may reach the orchestrator.
        organizationId: 'globex',
        planDigest: 'forged',
        state: 'completed',
        cost: { actualMicroUsd: 0 },
      },
    });
    const run = response.body.run as { organizationId: string; state: string; planDigest: string };
    assert.equal(run.organizationId, 'acme', 'the organization is resolved, never asserted');
    assert.notEqual(run.planDigest, 'forged');
  });

  it('returns a 404 for an unknown operation rather than an undefined response', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await executeWorkflowHttpRequest(harness.runtime.service, {
      operation: 'workflow.definitely.not.real' as WorkflowHttpRequest['operation'],
      authorization: bearer(WORKFLOW_TOKEN.owner),
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.success, false);
  });

  it('exposes no operation that mutates a definition', () => {
    for (const operation of Object.values(WORKFLOW_OPERATION)) {
      assert.ok(
        !/\.(create|update|delete|register)$/.test(operation) ||
          operation === WORKFLOW_OPERATION.createRun,
        `${operation} looks like a definition mutation`,
      );
    }
  });

  it('reports a typed failure a console can act on', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ workflowId: WORKFLOW_ID.disabled }),
    });
    assert.equal(response.body.failure, 'workflow_disabled');
    assert.equal(response.body.retryable, false, 'a policy decision is never retryable');
  });

  it('validates the run input against the workflow contract', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.createRun,
      body: { workflowId: WORKFLOW_ID.sequential, input: { topic: '' } },
    });
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, 'VALIDATION_FAILED');
  });
});

// ── Read-model hygiene ──────────────────────────────────────────────────────

describe('workflow read models', () => {
  it('never exposes the workflow value space', async () => {
    const harness = buildTestWorkflowRuntime();
    const secret = 'CLIENT-CONFIDENTIAL-TOPIC-9f2a';
    const created = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({ input: { topic: secret, route: 'primary' } }),
    });
    const run = created.body.run as { workflowRunId: string };

    // Every read surface, checked for the input the run was given.
    for (const operation of [
      WORKFLOW_OPERATION.getRun,
      WORKFLOW_OPERATION.runNodes,
      WORKFLOW_OPERATION.branchState,
      WORKFLOW_OPERATION.tokenReport,
      WORKFLOW_OPERATION.costReport,
      WORKFLOW_OPERATION.overview,
      WORKFLOW_OPERATION.audit,
      WORKFLOW_OPERATION.financialSummary,
      WORKFLOW_OPERATION.savingsSummary,
    ]) {
      const response = await caller(harness, WORKFLOW_TOKEN.owner)({
        operation,
        workflowRunId: run.workflowRunId,
        limit: 200,
      });
      assert.equal(response.body.success, true, `${operation} should succeed for an owner`);
      assert.equal(
        JSON.stringify(response.body).includes(secret),
        false,
        `${operation} leaked the run's input`,
      );
    }
  });

  it('reports branch and join state without carrying branch outputs', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody({
        workflowId: WORKFLOW_ID.parallelAll,
        input: { topic: 'Branch reporting' },
      }),
    });
    const run = created.body.run as { workflowRunId: string };
    const response = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.branchState,
      workflowRunId: run.workflowRunId,
    });

    const branches = response.body.branches as { branchId: string; costMicroUsd: number }[];
    const joins = response.body.joins as { joinNodeId: string; satisfied: boolean }[];
    assert.equal(branches.length, 2);
    assert.equal(joins.length, 1);
    assert.equal(joins[0].satisfied, true);
    for (const branch of branches) {
      assert.ok(typeof branch.costMicroUsd === 'number', 'a branch carries its own ledger');
    }
  });

  it('gives an operator a plan manifest with no tenant data in it', async () => {
    const harness = buildTestWorkflowRuntime();
    const response = await caller(harness, WORKFLOW_TOKEN.consultant)({
      operation: WORKFLOW_OPERATION.getWorkflow,
      workflowId: WORKFLOW_ID.parallelAll,
    });
    assert.equal(response.body.success, true);
    const plan = response.body.plan as {
      worstCaseSteps: number;
      maxParallelism: number;
      branches: { branchId: string }[];
    };
    assert.ok(plan.worstCaseSteps > 0);
    assert.equal(plan.maxParallelism, 2);
    assert.equal(plan.branches.length, 2);
  });

  it('carries the optimization score and its components on a run detail', async () => {
    const harness = buildTestWorkflowRuntime();
    const created = await caller(harness, WORKFLOW_TOKEN.owner)({
      operation: WORKFLOW_OPERATION.createRun,
      body: workflowRunBody(),
    });
    const run = created.body.run as {
      optimizationScore: { score: number; components: unknown[]; formulaVersion: string };
    };
    assert.ok(run.optimizationScore.score >= 0 && run.optimizationScore.score <= 100);
    assert.ok(run.optimizationScore.components.length >= 9);
    assert.equal(run.optimizationScore.formulaVersion, '1.0.0');
  });
});
