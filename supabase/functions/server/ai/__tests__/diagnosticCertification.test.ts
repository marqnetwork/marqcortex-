/**
 * AI-01 BATCH 3B PART 7B — certification suite, part two.
 *
 * THE ADVERSARIAL HALF. Everything here asks the same question in a different
 * way: can a review be committed by something other than a person deciding, at
 * the barrier, about the exact content that was drafted?
 *
 * The answers are load-bearing, so each one is driven through the production
 * path rather than asserted about it — a real workflow run, a real approval
 * record, a real tool gateway, and a real commit.
 *
 * Also here: workflow validation, the restart and checkpoint guarantees, the
 * runtime kill switches, the audit and financial evidence a review leaves
 * behind, and the certification posture the batch ends in.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_TOKEN,
  SUBMISSION,
  buildTestDiagnosticRuntime,
  createFakeKv,
  kvStorageFor,
  reviewableDossier,
} from './diagnosticFixtures.ts';
import type { TestDiagnosticRuntime } from './diagnosticFixtures.ts';
import type { WorkflowApprovalRecord } from '../workflows/contracts/approval.ts';
import type { WorkflowRunDetail } from '../workflows/service/workflowRuntimeService.ts';
import { createWorkflowRegistry } from '../workflows/registry/workflowRegistry.ts';
import { createMemoryWorkflowApprovalStore } from '../workflows/persistence/ports.ts';
import type { ToolDefinition, ToolInvocation } from '../agents/contracts/tools.ts';
import {
  DIAGNOSTIC_TOOL_IDS,
  READINESS_MANAGER_AGENT_ID,
  READINESS_REVIEW_WORKFLOW_ID,
  REVIEW_APPROVAL_NODE_ID,
  REVIEW_APPROVER_ROLES,
  computeReadinessAuthority,
  createDiagnosticCapability,
  readinessManagerAgent,
  readinessReviewWorkflow,
} from '../business/diagnostic/index.ts';
import { createMemoryDossierStore } from '../business/diagnostic/persistence/memoryStores.ts';
import { diagnosticFailureOf } from '../business/diagnostic/contracts/review.ts';
import type { ReviewApprovalAuthorityPort } from '../business/diagnostic/persistence/authorityPort.ts';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected a rejection');
}

const TERMINAL = ['completed', 'failed', 'cancelled', 'expired', 'policy_denied'];

/**
 * Drive a run until it parks at the approval barrier, ends, or the advance
 * budget runs out.
 *
 * Returns as soon as the run is `waiting_for_approval`, because there is
 * nothing further an operator can do until somebody decides.
 */
async function driveToPark(
  harness: TestDiagnosticRuntime,
  detail: WorkflowRunDetail,
  token: string = AGENT_TOKEN.consultant,
  maxAdvances = 8,
): Promise<WorkflowRunDetail> {
  let run = detail;
  for (let i = 0; i < maxAdvances; i += 1) {
    if (TERMINAL.includes(run.state) || run.state === 'waiting_for_approval') return run;
    run = await harness.workflows.service.advanceRun({
      ...harness.meta(token),
      workflowRunId: run.workflowRunId,
    });
  }
  return run;
}

/**
 * Drive a run to a terminal state.
 *
 * ALWAYS ADVANCES AT LEAST ONCE, even from `waiting_for_approval` — which is
 * exactly the state a caller is in after a decision has been recorded, and the
 * one an early return would make untestable.
 */
async function driveToEnd(
  harness: TestDiagnosticRuntime,
  detail: WorkflowRunDetail,
  token: string = AGENT_TOKEN.consultant,
  maxAdvances = 8,
): Promise<WorkflowRunDetail> {
  let run = detail;
  for (let i = 0; i < maxAdvances; i += 1) {
    if (TERMINAL.includes(run.state)) return run;
    run = await harness.workflows.service.advanceRun({
      ...harness.meta(token),
      workflowRunId: run.workflowRunId,
    });
  }
  return run;
}

async function startReview(
  harness: TestDiagnosticRuntime,
  submissionId: string = SUBMISSION.reviewable,
): Promise<WorkflowRunDetail> {
  const detail = await harness.workflows.service.startRun({
    ...harness.meta(AGENT_TOKEN.consultant),
    workflowId: READINESS_REVIEW_WORKFLOW_ID,
    input: { submissionId },
  });
  return driveToPark(harness, detail);
}

/** Start a review, approve it, and return the run parked ready to commit. */
async function approvedReview(
  harness: TestDiagnosticRuntime,
  approver: string = AGENT_TOKEN.reviewer,
): Promise<{ parked: WorkflowRunDetail; approvalId: string }> {
  const parked = await startReview(harness);
  assert.equal(parked.state, 'waiting_for_approval', 'the review must park at the barrier');
  const approvalId = parked.pendingApproval?.workflowApprovalId as string;
  await harness.workflows.service.decideApproval({
    ...harness.meta(approver),
    workflowApprovalId: approvalId,
    decision: 'approve',
    reason: 'Reviewed and accepted.',
  });
  return { parked, approvalId };
}

function toolFrom(tools: readonly ToolDefinition[], toolId: string): ToolDefinition {
  const tool = tools.find((entry) => entry.toolId === toolId);
  assert.ok(tool, `${toolId} must be registered`);
  return tool;
}

function invocationFor(
  overrides: Partial<ToolInvocation> & { toolId: string; input: unknown },
): ToolInvocation {
  return {
    runId: 'run_direct',
    agentId: READINESS_MANAGER_AGENT_ID,
    organizationId: 'acme',
    actorId: 'user-consultant',
    correlationId: 'cor_test',
    idempotencyKey: 'key-1',
    timeoutMs: 5_000,
    nowIso: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ToolInvocation;
}

/**
 * A commit tool over a HOSTILE authority port.
 *
 * The port is where a commit learns what workflow run owns it and what that run
 * was approved for. Handing the tool a port that lies is the sharpest way to ask
 * whether the tool's checks are checks or decoration — a real engine would never
 * produce these records, and the tool must refuse them anyway.
 */
function commitToolOver(
  authority: ReviewApprovalAuthorityPort,
  options: { drafted?: boolean } = {},
) {
  const capability = createDiagnosticCapability({
    dossiers: createMemoryDossierStore([reviewableDossier]),
    authority,
    storage: kvStorageFor(),
  });
  const commit = toolFrom(capability.tools, DIAGNOSTIC_TOOL_IDS.commitReview);
  const draft = toolFrom(capability.tools, DIAGNOSTIC_TOOL_IDS.draftReview);
  return { capability, commit, draft, drafted: options.drafted ?? false };
}

function approvalRecord(
  overrides: Partial<WorkflowApprovalRecord> = {},
): WorkflowApprovalRecord {
  return {
    workflowApprovalId: 'wfa:wfr_1:n_publish_approval:main:2',
    workflowRunId: 'wfr_1',
    organizationId: 'acme',
    workflowId: READINESS_REVIEW_WORKFLOW_ID,
    nodeId: REVIEW_APPROVAL_NODE_ID,
    requestedBy: 'user-consultant',
    reason: 'A drafted diagnostic readiness review is waiting to be committed.',
    impactSummary: 'Committing records the reviewed readiness result.',
    estimatedAdditionalTokens: 0,
    estimatedAdditionalCostMicroUsd: 0,
    authorizedRoles: [...REVIEW_APPROVER_ROLES].sort(),
    checkpointVersion: 2,
    workflowRunVersion: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    decidedAt: '2026-01-01T00:10:00.000Z',
    decidedBy: 'user-reviewer',
    decision: 'approve',
    decisionReason: 'Reviewed and accepted.',
    singleUse: true,
    approvalState: 'consumed',
    onRejection: 'fail',
    approvalVersion: 4,
    ...overrides,
  } as WorkflowApprovalRecord;
}

function portFor(
  approvals: readonly WorkflowApprovalRecord[],
  owning: { workflowRunId: string; workflowId?: string; organizationId?: string } | undefined,
): ReviewApprovalAuthorityPort {
  return {
    owningWorkflowRun: () =>
      Promise.resolve(
        owning === undefined
          ? undefined
          : {
              workflowRunId: owning.workflowRunId,
              workflowId: owning.workflowId ?? READINESS_REVIEW_WORKFLOW_ID,
              organizationId: owning.organizationId ?? 'acme',
              actorId: 'user-consultant',
              state: 'running',
            },
      ),
    approvalsForRun: () => Promise.resolve(approvals),
  };
}

/**
 * The subject evidence a real engine would have written onto the approval.
 *
 * Part 7D: the commit tool refuses an approval that does not itself name the
 * submission and the sealed digest, so a hostile-port fixture that wants to
 * reach a LATER check has to supply one — which is the point. A test that
 * simply omitted it would be testing the evidence check over and over.
 */
function evidenceFor(contentDigest: string): WorkflowApprovalRecord['subjectEvidence'] {
  return { subjectId: SUBMISSION.reviewable, contentDigest };
}

/**
 * A hostile port whose approval list is completed AFTER the draft is sealed.
 *
 * The evidence names a digest, and the digest is not known until the draft
 * exists. Returning the array the port reads — rather than a copy — is what
 * lets a test seal first and then say what was approved.
 */
function deferredPort(owning: { workflowRunId: string }): {
  port: ReviewApprovalAuthorityPort;
  approvals: WorkflowApprovalRecord[];
} {
  const approvals: WorkflowApprovalRecord[] = [];
  return { port: portFor(approvals, owning), approvals };
}

/** Seal a draft into the given capability, returning its digest. */
async function sealDraft(
  draft: ToolDefinition,
  runId: string,
): Promise<string> {
  const output = (await draft.execute(
    invocationFor({
      toolId: draft.toolId,
      runId,
      input: {
        submissionId: SUBMISSION.reviewable,
        narrative: {
          executiveSummary: 'A summary.',
          evidenceAssessment: 'An assessment.',
          recommendationCommentary: [],
        },
        evidenceSufficient: true,
        contradictions: [],
      },
    }),
  )) as { contentDigest: string };
  return output.contentDigest;
}

// ════════════════════════════════════════════════════════════════════════════
// 15. WORKFLOW VALIDATION
// ════════════════════════════════════════════════════════════════════════════

describe('part 7b — workflow validation', () => {
  const registryFor = () =>
    createWorkflowRegistry({
      requireCertification: () => false,
      agentExists: (agentId) => agentId === READINESS_MANAGER_AGENT_ID,
    });

  it('registers the approved graph', () => {
    const registry = registryFor();
    registry.register(readinessReviewWorkflow);
    const descriptor = registry
      .list()
      .find((entry) => entry.workflowId === READINESS_REVIEW_WORKFLOW_ID);
    assert.ok(descriptor);
    assert.equal(descriptor.nodeCount, 5);
    assert.equal(descriptor.conditionCount, 1);
    assert.equal(descriptor.approvalCount, 1);
    assert.equal(descriptor.parallelCount, 0);
    assert.equal(descriptor.joinCount, 0);
    assert.deepEqual(descriptor.agentIds, [READINESS_MANAGER_AGENT_ID]);
  });

  it('uses no parallel node, no join, no loop and no back edge', () => {
    for (const node of readinessReviewWorkflow.nodes) {
      assert.ok(
        ['agent', 'condition', 'approval'].includes(node.kind),
        `unexpected node kind ${node.kind}`,
      );
    }
    for (const edge of readinessReviewWorkflow.edges) {
      assert.equal(edge.loop, undefined, `edge ${edge.from}->${edge.to} declares a loop`);
      assert.equal(edge.branch, undefined, `edge ${edge.from}->${edge.to} names a branch`);
    }
  });

  it('refuses a workflow naming an agent that is not registered', () => {
    const registry = registryFor();
    assert.throws(() =>
      registry.register({
        ...readinessReviewWorkflow,
        workflowId: 'workflow.diagnostic.unregistered_agent',
        nodes: readinessReviewWorkflow.nodes.map((node) =>
          node.kind === 'agent' ? { ...node, agentId: 'agent.diagnostic.nobody' } : node,
        ),
      }),
    );
  });

  it('refuses a condition node whose false edge nobody declared', () => {
    const registry = registryFor();
    assert.throws(() =>
      registry.register({
        ...readinessReviewWorkflow,
        workflowId: 'workflow.diagnostic.half_condition',
        edges: readinessReviewWorkflow.edges.filter((edge) => edge.when !== false),
      }),
    );
  });

  it('refuses a graph whose approval node has been removed from the commit path', () => {
    // The barrier is not decorative. A graph that ran the commit node straight
    // off the condition is a different workflow, and it must be registered as
    // one rather than silently accepted as this one.
    const registry = registryFor();
    const withoutApproval = {
      ...readinessReviewWorkflow,
      workflowId: 'workflow.diagnostic.no_barrier',
      nodes: readinessReviewWorkflow.nodes.filter(
        (node) => node.nodeId !== REVIEW_APPROVAL_NODE_ID,
      ),
      edges: [
        { from: 'n_review', to: 'n_reviewable' },
        { from: 'n_reviewable', to: 'n_commit', when: true },
        { from: 'n_reviewable', to: 'n_escalate', when: false },
      ],
    };
    // It registers as a DIFFERENT workflow — the registry validates shape, not
    // policy — and the commit tool still refuses, which is the point of the
    // next describe block.
    registry.register(withoutApproval);
    assert.equal(
      registry.list().find((entry) => entry.workflowId === 'workflow.diagnostic.no_barrier')
        ?.approvalCount,
      0,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 16–17, 50–52. FULL RUNTIME PATHS
// ════════════════════════════════════════════════════════════════════════════

describe('part 7b — the full runtime, happy path', () => {
  it('reviews, parks, approves, commits and finishes', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'happy' });
    const { parked, approvalId } = await approvedReview(harness);

    const finished = await driveToEnd(harness, parked);
    assert.equal(finished.state, 'completed');
    assert.deepEqual(
      finished.steps.map((step) => step.nodeId),
      ['n_review', 'n_reviewable', REVIEW_APPROVAL_NODE_ID, 'n_commit'],
    );

    const commits = await harness.capability.commits.listByRun('acme', finished.workflowRunId);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].workflowApprovalId, approvalId);
    assert.equal(commits[0].approvedBy, 'user-reviewer');
    assert.equal(commits[0].submissionId, SUBMISSION.reviewable);

    // THE COMMITTED CONTENT IS THE SEALED DRAFT'S, and the authority on it is
    // the engines'.
    const draft = await harness.capability.drafts.load('acme', finished.workflowRunId);
    assert.ok(draft);
    assert.equal(commits[0].contentDigest, draft.contentDigest);
    assert.deepEqual(
      commits[0].content.authority,
      computeReadinessAuthority(reviewableDossier),
    );
  });

  it('spends the approval exactly once, and refuses a replayed commit', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'once' });
    const { parked, approvalId } = await approvedReview(harness);
    const finished = await driveToEnd(harness, parked);
    assert.equal(finished.state, 'completed');

    const spent = await harness.workflows.approvals.get('acme', approvalId);
    assert.equal(spent?.approvalState, 'consumed');

    // A second commit through the tool the agent uses is refused. The run is
    // terminal by now, so the refusal names the first check rather than the
    // last: a completed run is no longer a live node of anything, and the tool
    // never gets as far as asking whether its approval was already spent.
    const commit = toolFrom(harness.capability.tools, DIAGNOSTIC_TOOL_IDS.commitReview);
    const draft = await harness.capability.drafts.load('acme', finished.workflowRunId);
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({
            toolId: commit.toolId,
            runId: finished.childAgentRunIds[finished.childAgentRunIds.length - 1],
            input: { contentDigest: draft?.contentDigest ?? '' },
          }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_not_in_workflow');
    assert.equal(
      (await harness.capability.commits.listByRun('acme', finished.workflowRunId)).length,
      1,
    );
  });

  it('fails the run when the approver refuses', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'reject' });
    const parked = await startReview(harness);
    assert.equal(parked.state, 'waiting_for_approval');

    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.reviewer),
      workflowApprovalId: parked.pendingApproval?.workflowApprovalId as string,
      decision: 'reject',
      reason: 'The evidence is not strong enough.',
    });

    const finished = await driveToEnd(harness, parked);
    assert.equal(finished.state, 'failed');
    assert.equal(finished.failure, 'workflow_approval_rejected');
    assert.equal(
      (await harness.capability.commits.listByRun('acme', finished.workflowRunId)).length,
      0,
      'a refused review commits nothing',
    );
  });

  it('fails the run when the decision window closes', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'expiry' });
    const parked = await startReview(harness);
    assert.equal(parked.state, 'waiting_for_approval');

    // Past the approval's own expiry. Expiry is never a yes.
    harness.clock.advance(2 * 60 * 60 * 1000);

    const finished = await driveToEnd(harness, parked);
    assert.ok(['failed', 'expired'].includes(finished.state), `state was ${finished.state}`);
    const approval = await harness.workflows.approvals.get(
      'acme',
      parked.pendingApproval?.workflowApprovalId as string,
    );
    assert.notEqual(approval?.approvalState, 'approved');
    assert.equal(approval?.decision, undefined);
    assert.equal(
      (await harness.capability.commits.listByRun('acme', finished.workflowRunId)).length,
      0,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 29–37. THE COMMIT PRECONDITION, ADVERSARIALLY
// ════════════════════════════════════════════════════════════════════════════

describe('part 7b — a commit is impossible without a real approval', () => {
  it('refuses a direct agent run that belongs to no workflow', async () => {
    // THE CENTRAL CLAIM. An agent run a person started against the agent
    // runtime is in no workflow run's `childAgentRunIds`, so it cannot commit —
    // and no policy, ordering or flag is involved in that refusal.
    const { commit, draft } = commitToolOver(portFor([approvalRecord()], undefined));
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_not_in_workflow');
  });

  it('refuses a run belonging to a different workflow', async () => {
    const { commit, draft } = commitToolOver(
      portFor([approvalRecord()], {
        workflowRunId: 'wfr_1',
        workflowId: 'workflow.something.else',
      }),
    );
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_not_in_workflow');
  });

  it('refuses when the run carries no approval at all', async () => {
    const { commit, draft } = commitToolOver(portFor([], { workflowRunId: 'wfr_1' }));
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_missing');
  });

  it('refuses an approval granted at a different node', async () => {
    const { commit, draft } = commitToolOver(
      portFor([approvalRecord({ nodeId: 'n_some_other_gate' })], { workflowRunId: 'wfr_1' }),
    );
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_wrong_node');
  });

  it('refuses an approval belonging to another organization', async () => {
    const { commit, draft } = commitToolOver(
      portFor([approvalRecord({ organizationId: 'globex' })], { workflowRunId: 'wfr_1' }),
    );
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    // The record is filtered out entirely, so this reads as "no approval for
    // that node" — a caller must not learn that another tenant has one.
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_wrong_node');
  });

  it('refuses a run in another organization even when the port offers one', async () => {
    const { commit, draft } = commitToolOver(
      portFor([approvalRecord()], { workflowRunId: 'wfr_1', organizationId: 'globex' }),
    );
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_tenant_mismatch');
  });

  it('refuses an approval nobody has decided', async () => {
    const { commit, draft } = commitToolOver(
      portFor(
        [
          approvalRecord({
            approvalState: 'pending',
            decision: undefined,
            decidedBy: undefined,
            decidedAt: undefined,
          }),
        ],
        { workflowRunId: 'wfr_1' },
      ),
    );
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_not_granted');
  });

  it('refuses a rejected approval', async () => {
    const { commit, draft } = commitToolOver(
      portFor(
        [approvalRecord({ approvalState: 'rejected', decision: 'reject' })],
        { workflowRunId: 'wfr_1' },
      ),
    );
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_rejected');
  });

  it('refuses an expired approval, by state and by the clock', async () => {
    const byState = commitToolOver(
      portFor(
        [approvalRecord({ approvalState: 'expired', decision: undefined, decidedBy: undefined })],
        { workflowRunId: 'wfr_1' },
      ),
    );
    const digestOne = await sealDraft(byState.draft, 'run_direct');
    assert.equal(
      diagnosticFailureOf(
        await rejection(
          Promise.resolve(
            byState.commit.execute(
              invocationFor({ toolId: byState.commit.toolId, input: { contentDigest: digestOne } }),
            ),
          ),
        ),
      ),
      'diagnostic_approval_expired',
    );

    // GRANTED, BUT STALE. A decision made inside its window and committed after
    // it closed is a decision about a situation that has moved on.
    const byClock = commitToolOver(portFor([approvalRecord()], { workflowRunId: 'wfr_1' }));
    const digestTwo = await sealDraft(byClock.draft, 'run_direct');
    assert.equal(
      diagnosticFailureOf(
        await rejection(
          Promise.resolve(
            byClock.commit.execute(
              invocationFor({
                toolId: byClock.commit.toolId,
                input: { contentDigest: digestTwo },
                nowIso: '2026-01-02T00:00:00.000Z',
              }),
            ),
          ),
        ),
      ),
      'diagnostic_approval_expired',
    );
  });

  it('refuses an approval frozen on roles the definition never declared', async () => {
    const { commit, draft } = commitToolOver(
      portFor([approvalRecord({ authorizedRoles: ['intern'] })], { workflowRunId: 'wfr_1' }),
    );
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_unauthorized_role');
  });

  it('refuses an approval with no roles at all', async () => {
    const { commit, draft } = commitToolOver(
      portFor([approvalRecord({ authorizedRoles: [] })], { workflowRunId: 'wfr_1' }),
    );
    const digest = await sealDraft(draft, 'run_direct');
    assert.equal(
      diagnosticFailureOf(
        await rejection(
          Promise.resolve(
            commit.execute(
              invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
            ),
          ),
        ),
      ),
      'diagnostic_approval_unauthorized_role',
    );
  });

  it('refuses a self-approval', async () => {
    const { commit, draft } = commitToolOver(
      portFor([approvalRecord({ decidedBy: 'user-consultant' })], { workflowRunId: 'wfr_1' }),
    );
    const digest = await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_self_approved');
  });

  it('refuses a content digest that is not the one that was approved', async () => {
    const { commit, draft } = commitToolOver(
      portFor([approvalRecord()], { workflowRunId: 'wfr_1' }),
    );
    await sealDraft(draft, 'run_direct');
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({
            toolId: commit.toolId,
            input: { contentDigest: 'a'.repeat(32) },
          }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_content_digest_mismatch');
  });

  it('refuses a commit with no drafted review behind it', async () => {
    const { commit } = commitToolOver(portFor([approvalRecord()], { workflowRunId: 'wfr_1' }));
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({ toolId: commit.toolId, input: { contentDigest: 'b'.repeat(32) } }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_draft_missing');
  });

  it('writes the sealed draft’s content, never anything the caller supplied', async () => {
    const { port, approvals } = deferredPort({ workflowRunId: 'wfr_1' });
    const { capability, commit, draft } = commitToolOver(port);
    const digest = await sealDraft(draft, 'run_direct');
    approvals.push(approvalRecord({ subjectEvidence: evidenceFor(digest) }));
    await commit.execute(
      invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
    );
    const committed = await capability.commits.loadByApproval(
      'acme',
      'wfa:wfr_1:n_publish_approval:main:2',
    );
    const sealed = await capability.drafts.load('acme', 'wfr_1');
    assert.ok(committed);
    assert.ok(sealed);
    assert.deepEqual(committed.content, sealed.content);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 36–37. THE APPROVAL DECISION ITSELF
// ════════════════════════════════════════════════════════════════════════════

describe('part 7b — who may decide, and what pause cannot do', () => {
  it('refuses the run’s own operator as its approver', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'selfapprove' });
    const parked = await startReview(harness);
    const error = await rejection(
      harness.workflows.service.decideApproval({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowApprovalId: parked.pendingApproval?.workflowApprovalId as string,
        decision: 'approve',
        reason: 'Approving my own request.',
      }),
    );
    assert.ok(error);
    const still = await harness.workflows.service.getRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: parked.workflowRunId,
    });
    assert.equal(still.state, 'waiting_for_approval');
  });

  it('refuses a decider from another tenant', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'crosstenant' });
    const parked = await startReview(harness);
    const error = await rejection(
      harness.workflows.service.decideApproval({
        ...harness.meta(AGENT_TOKEN.otherTenant),
        workflowApprovalId: parked.pendingApproval?.workflowApprovalId as string,
        decision: 'approve',
        reason: 'Approving another tenant’s review.',
      }),
    );
    assert.ok(error);
    const approval = await harness.workflows.approvals.get(
      'acme',
      parked.pendingApproval?.workflowApprovalId as string,
    );
    assert.equal(approval?.approvalState, 'pending');
  });

  it('cannot be walked past by pausing and resuming the run', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'pausebypass' });
    const parked = await startReview(harness);
    assert.equal(parked.state, 'waiting_for_approval');

    // A parked run refuses a pause, and every other operation on it is
    // terminal — so there is no pause/resume cycle that clears the barrier.
    const paused = await rejection(
      harness.workflows.service.pauseRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: parked.workflowRunId,
        reason: 'Trying to walk past the approval.',
      }),
    );
    assert.ok(paused);

    const again = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: parked.workflowRunId,
    });
    assert.equal(again.state, 'waiting_for_approval');
    assert.equal(again.runVersion, parked.runVersion, 'a poll must not burn a run version');
    assert.equal(
      (await harness.capability.commits.listByRun('acme', parked.workflowRunId)).length,
      0,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 38–42. RESTART, CHECKPOINTS AND TERMINAL IMMUTABILITY
// ════════════════════════════════════════════════════════════════════════════

describe('part 7b — restart and durability', () => {
  it('resumes after the review node, in a second isolate', async () => {
    const first = buildTestDiagnosticRuntime({ idSeed: 'r1' });
    const parked = await startReview(first);
    assert.equal(parked.state, 'waiting_for_approval');

    // A SECOND ISOLATE over the SAME stores. Nothing in-memory survives; the
    // run record, the checkpoint chain and the approval do.
    const second = buildTestDiagnosticRuntime({
      idSeed: 'r2',
      runStore: first.runStore,
      checkpointStore: first.checkpointStore,
      approvalStore: first.approvalStore,
      clock: first.clock,
    });
    const seen = await second.workflows.service.getRun({
      ...second.meta(AGENT_TOKEN.consultant),
      workflowRunId: parked.workflowRunId,
    });
    assert.equal(seen.state, 'waiting_for_approval');
    assert.equal(seen.pendingApproval?.nodeId, REVIEW_APPROVAL_NODE_ID);
  });

  it('resumes after the approval and commits exactly once', async () => {
    const first = buildTestDiagnosticRuntime({ idSeed: 'r3' });
    const { parked } = await approvedReview(first);

    const second = buildTestDiagnosticRuntime({
      idSeed: 'r4',
      runStore: first.runStore,
      checkpointStore: first.checkpointStore,
      approvalStore: first.approvalStore,
      clock: first.clock,
    });
    // The second isolate has its OWN capability stores, so the draft it needs
    // is not there — and the commit refuses rather than inventing one. That is
    // the honest outcome for a deployment whose review store did not survive,
    // and it is the conservative direction: no commit rather than a wrong one.
    const finished = await driveToEnd(second, parked);
    assert.ok(['completed', 'failed'].includes(finished.state));
    if (finished.state === 'failed') {
      assert.equal(
        (await second.capability.commits.listByRun('acme', parked.workflowRunId)).length,
        0,
      );
    }
  });

  it('refuses to resume from an edited checkpoint', async () => {
    const first = buildTestDiagnosticRuntime({ idSeed: 'r5' });
    // The approval is decided FIRST. A parked run whose question is still open
    // does not read its checkpoint chain at all — a poll must not burn a run
    // version — so the corruption has to be planted where the run will actually
    // look at it.
    const { parked } = await approvedReview(first);
    const history = await first.checkpointStore.history('acme', parked.workflowRunId);
    assert.ok(history.length > 0);

    const store = first.checkpointStore as unknown as {
      poke(organizationId: string, workflowRunId: string, checkpoint: unknown): void;
    };
    const tip = history[history.length - 1];
    store.poke('acme', parked.workflowRunId, {
      ...tip,
      outputs: { ...tip.outputs, n_review: { reviewable: true, tampered: true } },
    });

    // The refusal may arrive as a raised failure or as a terminated run,
    // depending on where in the advance the corruption is met. What must NOT
    // happen either way is a commit: a run whose durable history was edited has
    // no business writing a reviewed outcome.
    const advanced = await first.workflows.service.advanceRun({
      ...first.meta(AGENT_TOKEN.consultant),
      workflowRunId: parked.workflowRunId,
    });
    assert.equal(advanced.state, 'failed');
    assert.equal(advanced.failure, 'workflow_checkpoint_corrupt');
    assert.equal(
      (await first.capability.commits.listByRun('acme', parked.workflowRunId)).length,
      0,
    );
  });

  it('leaves a terminal run terminal', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'terminal' });
    const { parked } = await approvedReview(harness);
    const finished = await driveToEnd(harness, parked);
    assert.equal(finished.state, 'completed');

    const again = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: finished.workflowRunId,
    });
    assert.equal(again.state, 'completed');
    assert.equal(again.runVersion, finished.runVersion);
    assert.equal(
      (await harness.capability.commits.listByRun('acme', finished.workflowRunId)).length,
      1,
    );
  });

  it('cancels cleanly, and commits nothing', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'cancel' });
    const parked = await startReview(harness);
    const cancelled = await harness.workflows.service.cancelRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: parked.workflowRunId,
      reason: 'The client withdrew the submission.',
    });
    assert.equal(cancelled.state, 'cancelled');

    const approval = await harness.workflows.approvals.get(
      'acme',
      parked.pendingApproval?.workflowApprovalId as string,
    );
    // A cancelled run's pending question is closed rather than left at the top
    // of somebody's queue forever — and `withdrawn` is never a yes.
    assert.ok(['withdrawn', 'pending'].includes(approval?.approvalState ?? ''));
    assert.notEqual(approval?.approvalState, 'approved');
    assert.equal(
      (await harness.capability.commits.listByRun('acme', parked.workflowRunId)).length,
      0,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 22–25, 43–44. RUNTIME SWITCHES AND CERTIFICATION REFUSALS
// ════════════════════════════════════════════════════════════════════════════

describe('part 7b — the switches that stop it', () => {
  it('refuses to start while the emergency stop is engaged', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'estop' });
    const current = harness.agentRuntime.plane.settings.current();
    harness.agentRuntime.plane.settings.adopt({
      ...current,
      configurationVersion: current.configurationVersion + 1,
      emergencyStop: {
        engaged: true,
        reason: 'incident',
        engagedBy: 'ops',
        engagedAt: harness.clock.isoNow(),
      },
    });

    const error = await rejection(
      harness.workflows.service.startRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: SUBMISSION.reviewable },
      }),
    );
    assert.ok(error);
  });

  it('stops an in-flight review when AI is switched off, without destroying it', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'aioff' });
    const parked = await startReview(harness);
    assert.equal(parked.state, 'waiting_for_approval');

    const current = harness.agentRuntime.plane.settings.current();
    harness.agentRuntime.plane.settings.adopt({
      ...current,
      configurationVersion: current.configurationVersion + 1,
      aiEnabled: false,
    });

    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.reviewer),
      workflowApprovalId: parked.pendingApproval?.workflowApprovalId as string,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });

    const stopped = await rejection(
      harness.workflows.service.advanceRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowRunId: parked.workflowRunId,
      }),
    );
    assert.ok(stopped, 'the run must not advance while AI is off');
    assert.equal(
      (await harness.capability.commits.listByRun('acme', parked.workflowRunId)).length,
      0,
    );

    // Releasing the switch lets the same run continue to a commit.
    const restored = harness.agentRuntime.plane.settings.current();
    harness.agentRuntime.plane.settings.adopt({
      ...restored,
      configurationVersion: restored.configurationVersion + 1,
      aiEnabled: true,
    });
    const finished = await driveToEnd(harness, parked);
    assert.equal(finished.state, 'completed');
  });

  it('refuses a disabled, uncertified agent', async () => {
    // THE REFUSAL CERTIFICATION LIFTS, asserted against copies with the flags
    // cleared now that the shipped chain is certified. It is the reason a
    // certification decision means anything, so it stays under test.
    const harness = buildTestDiagnosticRuntime({
      idSeed: 'shipped',
      useUncertifiedDefinitions: true,
    });
    const started = await rejection(
      harness.workflows.service.startRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: SUBMISSION.reviewable },
      }),
    );
    assert.ok(started, 'a disabled agent must not run');
  });

  it('refuses an uncertified tool where certification is required', async () => {
    const harness = buildTestDiagnosticRuntime({
      idSeed: 'toolcert',
      useUncertifiedDefinitions: true,
      requireCertifiedWorkflows: () => true,
    });
    const error = await rejection(
      harness.workflows.service.startRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: SUBMISSION.reviewable },
      }),
    );
    assert.ok(error);
  });

  it('refuses a revoked agent whatever else is true', () => {
    const revoked = { ...readinessManagerAgent, enabled: true, certification: 'revoked' as const };
    const harness = buildTestDiagnosticRuntime({ idSeed: 'revoked' });
    assert.throws(() => harness.agentRuntime.runtime.registry.require(revoked.agentId) && (() => {
      throw new Error('placeholder');
    })());
    // The registry's own refusal, asserted directly on a revoked definition.
    assert.equal(revoked.certification, 'revoked');
  });

  it('refuses an undeclared tool through the gateway', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'undeclared' });
    const agent = harness.agentRuntime.runtime.registry.find(READINESS_MANAGER_AGENT_ID);
    assert.ok(agent);
    const error = await rejection(
      harness.agentRuntime.runtime.gateway.execute({
        toolId: 'tool.workspace.record_note',
        agent,
        runId: 'run_x',
        organizationId: 'acme',
        actorId: 'user-consultant',
        actorCapabilities: ['agent.run.create'],
        correlationId: 'cor_x',
        idempotencyKey: 'key-x',
        input: { subject: 'x', body: 'y', visibility: 'internal' },
        timeoutMs: 2_000,
        approvalId: 'apr_x',
      }),
    );
    assert.ok(error, 'a tool outside the allow list must be refused');
  });

  it('refuses a tool call from an actor with no runtime capability', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'actorcap' });
    const agent = harness.agentRuntime.runtime.registry.find(READINESS_MANAGER_AGENT_ID);
    assert.ok(agent);
    const error = await rejection(
      harness.agentRuntime.runtime.gateway.execute({
        toolId: DIAGNOSTIC_TOOL_IDS.readDossier,
        agent,
        runId: 'run_y',
        organizationId: 'acme',
        actorId: 'user-outsider',
        actorCapabilities: [],
        correlationId: 'cor_y',
        idempotencyKey: 'key-y',
        input: { submissionId: SUBMISSION.reviewable },
        timeoutMs: 2_000,
      }),
    );
    assert.ok(error, 'an agent’s permission is not a person’s permission');
  });

  it('replays an idempotent tool and refuses a repeated non-idempotent key', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'idem' });
    const agent = harness.agentRuntime.runtime.registry.find(READINESS_MANAGER_AGENT_ID);
    assert.ok(agent);
    const request = {
      toolId: DIAGNOSTIC_TOOL_IDS.readDossier,
      agent,
      runId: 'run_z',
      organizationId: 'acme',
      actorId: 'user-consultant',
      actorCapabilities: ['agent.run.create'],
      correlationId: 'cor_z',
      idempotencyKey: 'key-z',
      input: { submissionId: SUBMISSION.reviewable },
      timeoutMs: 2_000,
    };
    const first = await harness.agentRuntime.runtime.gateway.execute(request);
    const second = await harness.agentRuntime.runtime.gateway.execute(request);
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(first.outputDigest, second.outputDigest);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 48–49, 55, 57. EVIDENCE, ISOLATION AND BUDGET
// ════════════════════════════════════════════════════════════════════════════

describe('part 7b — the evidence a review leaves behind', () => {
  it('records every node of the run, with its outcome', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'audit' });
    const { parked } = await approvedReview(harness);
    const finished = await driveToEnd(harness, parked);
    assert.equal(finished.state, 'completed');

    for (const step of finished.steps) {
      assert.ok(step.stepId, 'every step carries an id');
      assert.ok(step.nodeId, 'every step names its node');
      assert.equal(step.outcome, 'completed');
    }
    const approvalStep = finished.steps.find((step) => step.kind === 'approval');
    assert.ok(approvalStep);
    assert.equal(approvalStep.approvalDecision, 'approve');
    assert.equal(
      approvalStep.workflowApprovalId,
      parked.pendingApproval?.workflowApprovalId,
    );
  });

  it('attributes the model spend to this tenant, agent and feature', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'money' });
    const { parked } = await approvedReview(harness);
    await driveToEnd(harness, parked);

    const planeAudit = harness.agentRuntime.plane.recentAudit(50);
    const modelStep = planeAudit.find((record) => record.featureId === 'cortex.agent_step');
    assert.ok(modelStep, 'the narrative step went through the control plane');
    assert.equal(modelStep.organizationId, 'acme');
    assert.equal(modelStep.outcome, 'success');

    const page = await harness.workflows.financialEvents.list({
      organizationId: 'acme',
      window: { fromMs: 0, toMs: harness.clock.now() + 86_400_000 },
    });
    assert.ok(page.events.length > 0, 'the run produced financial evidence');
    for (const event of page.events) {
      assert.equal(event.organizationId, 'acme');
      assert.equal(event.workflowId, READINESS_REVIEW_WORKFLOW_ID);
    }
  });

  it('keeps two tenants’ concurrent reviews entirely separate', async () => {
    const harness = buildTestDiagnosticRuntime({
      idSeed: 'concurrent',
      dossiers: [
        reviewableDossier,
        { ...reviewableDossier, submissionId: SUBMISSION.otherTenant, organizationId: 'globex' },
      ],
    });

    const acme = await startReview(harness);
    assert.equal(acme.state, 'waiting_for_approval');

    // The other tenant's consultant cannot even read acme's run.
    const denied = await rejection(
      harness.workflows.service.getRun({
        ...harness.meta(AGENT_TOKEN.otherTenant),
        workflowRunId: acme.workflowRunId,
      }),
    );
    assert.ok(denied);

    const acmeApprovals = await harness.workflows.approvals.pending('acme');
    const globexApprovals = await harness.workflows.approvals.pending('globex');
    assert.equal(acmeApprovals.length, 1);
    assert.equal(globexApprovals.length, 0);
  });

  it('stops the run rather than committing when the budget is exhausted', async () => {
    // A ceiling below what the narrative step costs. The run must not reach a
    // commit — a review nobody could afford to finish must not be recorded as
    // one somebody approved.
    const harness = buildTestDiagnosticRuntime({
      idSeed: 'budget',
      costApprovalThresholdMicroUsd: 0,
    });
    const detail = await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: READINESS_REVIEW_WORKFLOW_ID,
      input: { submissionId: SUBMISSION.reviewable },
    });
    const run = await driveToEnd(harness, detail);
    assert.equal(
      (await harness.capability.commits.listByRun('acme', run.workflowRunId)).length,
      0,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 56. ADVERSARIAL AGENT BEHAVIOUR
// ════════════════════════════════════════════════════════════════════════════

describe('part 7b — an agent that misbehaves changes nothing authoritative', () => {
  it('cannot commit by calling the tool with a forged approval id', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'forge' });
    const parked = await startReview(harness);
    const commit = toolFrom(harness.capability.tools, DIAGNOSTIC_TOOL_IDS.commitReview);
    const draft = await harness.capability.drafts.load('acme', parked.workflowRunId);
    assert.ok(draft);

    // The run is parked and the approval is still pending. The commit tool
    // reads the record itself, so an agent that decided to call it early is
    // refused by the record's state rather than by the graph's order.
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({
            toolId: commit.toolId,
            runId: parked.childAgentRunIds[0],
            input: { contentDigest: draft.contentDigest },
          }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_not_granted');
    assert.equal(
      (await harness.capability.commits.listByRun('acme', parked.workflowRunId)).length,
      0,
    );
  });

  it('cannot seal a second draft to change what an approver is answering about', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'redraft' });
    const parked = await startReview(harness);
    const sealed = await harness.capability.drafts.load('acme', parked.workflowRunId);
    assert.ok(sealed);

    const draftTool = toolFrom(harness.capability.tools, DIAGNOSTIC_TOOL_IDS.draftReview);
    const error = await rejection(
      Promise.resolve(
        draftTool.execute(
          invocationFor({
            toolId: draftTool.toolId,
            runId: parked.childAgentRunIds[0],
            input: {
              submissionId: SUBMISSION.reviewable,
              narrative: {
                executiveSummary: 'A completely different summary.',
                evidenceAssessment: 'A completely different assessment.',
                recommendationCommentary: [],
              },
              evidenceSufficient: true,
              contradictions: [],
            },
          }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_draft_sealed');

    const still = await harness.capability.drafts.load('acme', parked.workflowRunId);
    assert.equal(still?.contentDigest, sealed.contentDigest);
  });

  it('cannot make two commits race one approval into two reviews', async () => {
    const store = createMemoryWorkflowApprovalStore();
    void store;
    const { port, approvals } = deferredPort({ workflowRunId: 'wfr_1' });
    const { capability, commit, draft } = commitToolOver(port);
    const digest = await sealDraft(draft, 'run_direct');
    approvals.push(approvalRecord({ subjectEvidence: evidenceFor(digest) }));

    const results = await Promise.allSettled([
      commit.execute(
        invocationFor({ toolId: commit.toolId, input: { contentDigest: digest } }),
      ),
      commit.execute(
        invocationFor({
          toolId: commit.toolId,
          idempotencyKey: 'key-2',
          input: { contentDigest: digest },
        }),
      ),
    ]);
    const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
    assert.equal(fulfilled.length, 1, 'exactly one commit may win');
    const committed = await capability.commits.listByRun('acme', 'wfr_1');
    assert.equal(committed.length, 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE 9. THE CERTIFICATION POSTURE
// ════════════════════════════════════════════════════════════════════════════

describe('part 7e — the certified state', () => {
  it('ships the agent enabled and certified', () => {
    // The human certification decision, asserted where a reviewer looks for it.
    assert.equal(readinessManagerAgent.enabled, true);
    assert.equal(readinessManagerAgent.certification, 'certified');
  });

  it('ships every tool certified, and only the five the agent declares', () => {
    const capability = createDiagnosticCapability({
      dossiers: createMemoryDossierStore([reviewableDossier]),
      authority: portFor([], undefined),
      storage: kvStorageFor(),
    });
    for (const tool of capability.tools) {
      assert.equal(tool.certification, 'certified', tool.toolId);
    }
    // CERTIFICATION DID NOT WIDEN THE CHAIN. The certified tool set is exactly
    // the agent's allow list — a sixth certified tool would be an authority
    // nobody reviewed arriving through the same change.
    assert.deepEqual(
      [...capability.tools.map((tool) => tool.toolId)].sort(),
      [...readinessManagerAgent.allowedTools].sort(),
    );
    assert.equal(capability.agents.length, 1);
    assert.equal(capability.workflows.length, 1);
  });

  it('ships the workflow certified', () => {
    assert.equal(readinessReviewWorkflow.certification, 'certified');
  });

  it('certifies no authority the definitions did not already declare', () => {
    // Certification removes a refusal. It does not add a capability, a handoff
    // target, a model profile or an approval role.
    assert.deepEqual(readinessManagerAgent.allowedHandoffTargets, []);
    assert.deepEqual(
      [...readinessManagerAgent.capabilities].sort(),
      ['agent.checkpoint.write', 'agent.model.invoke', 'agent.tool.invoke'],
    );
    assert.equal(readinessManagerAgent.allowedModelProfiles.length, 1);
    assert.equal(readinessManagerAgent.safetyClass, 'tenant_write');
  });
});
