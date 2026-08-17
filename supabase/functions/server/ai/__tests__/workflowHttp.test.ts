/**
 * The workflow runtime's HTTP surface, over the PRODUCTION ASSEMBLY
 * (AI-01 Batch 3B).
 *
 * Two things make this suite different from every other workflow suite in this
 * directory, and both are deliberate.
 *
 *   IT GOES THROUGH THE ADAPTER. Every call below is
 *   `executeWorkflowHttpRequest` — the pure function the edge routes hand a
 *   request to — so what is exercised is the whole request/response mapping:
 *   status codes, error shapes, field validation, the read models, and the
 *   authorization boundary as a caller actually meets it. The other suites call
 *   the service directly and cannot see any of that.
 *
 *   IT BOOTS THE REAL DEPLOYMENT. `initializeControlPlane` is the function the
 *   edge entry point calls: it reads configuration, decides what to register and
 *   returns the runtimes. So the workflow under test is the CERTIFIED diagnostic
 *   readiness review, registered the way a deployment registers it, driving the
 *   certified agent through the real tool gateway over durable storage. A
 *   hand-assembled fixture workflow would prove the adapter maps a request and
 *   would prove nothing about the capability this surface exists to expose.
 *
 * WHAT IS ASSERTED, IN ONE LINE EACH: an authorised operator can start, read,
 * approve and finish a review; nobody without the role can do any of it; no
 * tenant can see another's; the switch being off means the workflow cannot be
 * started at all; a rejection fails the run and a cancellation stops it; and
 * nothing in any response body carries a prompt, a credential, a server
 * diagnostic or a line of the client's business content.
 *
 * SAFETY. `AI_ALLOW_REAL_REQUESTS` is never set, so the mock adapter serves
 * every model step, no vendor endpoint is contacted and the MARQ ledger is never
 * spent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getWorkflowRuntime,
  initializeControlPlane,
  resetControlPlaneForTests,
} from '../bootstrap.ts';
import type { BootstrapDependencies } from '../bootstrap.ts';
import { recordEnv } from '../runtime/env.ts';
import { READINESS_REVIEW_WORKFLOW_ID } from '../business/diagnostic/index.ts';
import { createKvSubmissionDossierSource } from '../../diagnostic/submissionDossierSource.ts';
import { DIAGNOSTIC_QUESTION_CATALOGUE } from '../../diagnostic/questionCatalogue.ts';
import {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowHttpRequest,
  type WorkflowHttpResponse,
} from '../workflows/http/workflowHttpAdapter.ts';
import { DIAGNOSTIC_DOSSIERS, SUBMISSION } from './diagnosticFixtures.ts';
import { createFakeKv } from './agentFixtures.ts';
import type { FakeKv } from './agentFixtures.ts';

// ── The deployment, as the edge entry point supplies it ─────────────────────

const ORG = 'acme';
const OTHER_ORG = 'globex';

/**
 * The four people this surface has to tell apart.
 *
 * `consultant` is an operator: it may start, read and cancel, and it may NOT
 * decide an approval. `reviewer` is the mirror image: it may read and decide and
 * may not start. That separation is the whole reason the workflow has a barrier
 * in it, and the cases below assert it in both directions rather than only
 * proving the happy path works.
 *
 * `client` authenticates and holds a membership, so the organization resolves —
 * and holds no role the workflow grant table knows, so every operation is
 * refused for the reason that actually applies.
 */
const PEOPLE: Readonly<
  Record<string, { id: string; email: string; roles: string[]; organizationId: string }>
> = {
  'token-consultant': {
    id: 'user-consultant',
    email: 'consultant@acme.test',
    roles: ['consultant'],
    organizationId: ORG,
  },
  'token-reviewer': {
    id: 'user-reviewer',
    email: 'reviewer@acme.test',
    roles: ['reviewer'],
    organizationId: ORG,
  },
  'token-client': {
    id: 'user-client',
    email: 'client@acme.test',
    roles: ['client'],
    organizationId: ORG,
  },
  'token-other-tenant': {
    id: 'user-globex',
    email: 'consultant@globex.test',
    roles: ['consultant'],
    organizationId: OTHER_ORG,
  },
};

function bearer(token: string): string {
  return `Bearer ${token}`;
}

/**
 * The fixture submissions as a DEPLOYMENT stores them.
 *
 * The same seeding `diagnosticProductionWiring.test.ts` performs, and for the
 * same reason: the production dossier source reads `sub:{id}` rows and names
 * every answer's question and section from the question catalogue, so a memory
 * store here would leave the component that turns a stored submission into a
 * reviewable dossier out of the path this suite is about.
 *
 * `sub-reviewable` is stored as a COMPLETED diagnostic — the fixture's six answer
 * texts cycled across all fourteen catalogue questions — because six of fourteen
 * is a submission the agent correctly escalates for low confidence, and this
 * suite needs the reviewable path to reach the approval barrier.
 */
function seedSubmissions(kv: FakeKv): void {
  const catalogue = DIAGNOSTIC_QUESTION_CATALOGUE.manufacturing;
  for (const dossier of DIAGNOSTIC_DOSSIERS) {
    if (dossier.organizationId !== ORG) continue;
    const complete = dossier.submissionId === SUBMISSION.reviewable;
    const answers =
      complete && dossier.answers.length > 0
        ? Object.fromEntries(
            catalogue.map((question, index) => [
              String(question.id),
              dossier.answers[index % dossier.answers.length].answer,
            ]),
          )
        : Object.fromEntries(
            dossier.answers.map((entry) => [String(entry.questionId), entry.answer]),
          );
    kv.poke(
      `sub:${dossier.submissionId}`,
      JSON.stringify({
        id: dossier.submissionId,
        company: dossier.company,
        industryId: 'manufacturing',
        employees: '11-50',
        submittedAt: dossier.submittedAt,
        status: dossier.status,
        answers,
      }),
    );
  }
}

interface Deployment {
  readonly kv: FakeKv;
  /** Issue one request through the adapter, as a route would. */
  call(
    request: Partial<WorkflowHttpRequest> & { operation: WorkflowHttpRequest['operation'] },
  ): Promise<WorkflowHttpResponse>;
}

/**
 * Bootstrap one deployment.
 *
 * `resetControlPlaneForTests` first, because the plane is memoised per isolate —
 * which is correct in production and would otherwise make the second case in
 * this file assert on the first case's registration decisions.
 */
function boot(
  overrides: { readonly env?: Record<string, string | undefined> } = {},
): Deployment {
  resetControlPlaneForTests();

  const kv = createFakeKv();
  seedSubmissions(kv);

  const deps: BootstrapDependencies = {
    env: recordEnv({
      AI_DIAGNOSTIC_REVIEW_ENABLED: 'true',
      // Memberships are verified below, so the default-organization fallback
      // stays off — the posture a real deployment runs in.
      AI_DEFAULT_ORGANIZATION_ID: ORG,
      ...overrides.env,
    }),
    getUser: (token: string) => {
      const person = PEOPLE[token];
      return Promise.resolve(
        person === undefined ? null : { id: person.id, email: person.email, roles: person.roles },
      );
    },
    listMemberships: (userId: string) => {
      const person = Object.values(PEOPLE).find((entry) => entry.id === userId);
      return Promise.resolve(
        person === undefined
          ? []
          : [{ organizationId: person.organizationId, tier: 'enterprise', roles: person.roles }],
      );
    },
    kvWrite: (key: string, value: unknown) => {
      kv.poke(key, value);
      return Promise.resolve();
    },
    kvRead: kv.read,
    kvReadByPrefix: kv.readByPrefix,
    kvCompareAndSwapField: kv.compareAndSwap,
    diagnosticDossiers: createKvSubmissionDossierSource({
      read: kv.read,
      ownerOrganizationId: () => Promise.resolve(ORG),
    }),
  };

  initializeControlPlane(deps);
  const runtime = getWorkflowRuntime();
  assert.ok(runtime, 'the production assembly must return a workflow runtime');

  return {
    kv,
    call: (request) =>
      executeWorkflowHttpRequest(runtime.service, {
        // The operator, unless a case says otherwise.
        authorization: bearer('token-consultant'),
        ...request,
      }),
  };
}

// ── Reading a response without repeating the cast everywhere ────────────────

interface RunView {
  workflowRunId: string;
  workflowId: string;
  organizationId: string;
  actorId: string;
  state: string;
  resultDigest?: string;
  inputDigest: string;
  failure?: string;
  steps: { kind: string }[];
  pendingApproval?: { workflowApprovalId: string };
}

interface ApprovalView {
  workflowApprovalId: string;
  workflowRunId: string;
  nodeId: string;
  approvalState: string;
  reason: string;
  impactSummary: string;
  authorizedRoles: string[];
  decidedBy?: string;
  decision?: string;
  subjectEvidence?: { subjectId: string; contentDigest: string };
}

function runOf(response: WorkflowHttpResponse): RunView {
  return response.body.run as unknown as RunView;
}

function approvalOf(response: WorkflowHttpResponse): ApprovalView {
  return response.body.approval as unknown as ApprovalView;
}

const TERMINAL = ['completed', 'failed', 'cancelled', 'expired', 'policy_denied'];

/**
 * Advance a run through the HTTP surface until it settles.
 *
 * The service records an approval decision and deliberately does NOT advance the
 * run — a decider is not necessarily permitted to drive one — so an operator's
 * advance is what picks the decision up. That is the real operator loop, so it
 * is the loop this drives.
 */
async function drive(
  deployment: Deployment,
  run: RunView,
  options: { stopAtApproval: boolean; token?: string } = { stopAtApproval: true },
): Promise<RunView> {
  let current = run;
  for (let step = 0; step < 8; step += 1) {
    if (TERMINAL.includes(current.state)) return current;
    if (options.stopAtApproval && current.state === 'waiting_for_approval') return current;
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.advanceRun,
      ...(options.token === undefined ? {} : { authorization: bearer(options.token) }),
      workflowRunId: current.workflowRunId,
    });
    if (response.status !== 200) return current;
    current = runOf(response);
  }
  return current;
}

async function startReview(
  deployment: Deployment,
  submissionId: string,
  options: { stopAtApproval?: boolean } = {},
): Promise<RunView> {
  const started = await deployment.call({
    operation: WORKFLOW_OPERATION.startRun,
    body: { workflowId: READINESS_REVIEW_WORKFLOW_ID, input: { submissionId } },
  });
  assert.equal(started.status, 200, `start failed: ${JSON.stringify(started.body)}`);
  return drive(deployment, runOf(started), {
    stopAtApproval: options.stopAtApproval ?? true,
  });
}

/** Every operation, with well-formed parameters, so only the role is at issue. */
const EVERY_OPERATION: readonly Partial<WorkflowHttpRequest>[] = Object.values(
  WORKFLOW_OPERATION,
).map((operation) => ({
  operation,
  workflowRunId: 'wfr_probe',
  workflowApprovalId: 'wfa_probe',
  body: {
    workflowId: READINESS_REVIEW_WORKFLOW_ID,
    input: { submissionId: SUBMISSION.reviewable },
    decision: 'approve',
    reason: 'probing the surface',
  },
}));

// ════════════════════════════════════════════════════════════════════════════
// AUTHORIZATION
// ════════════════════════════════════════════════════════════════════════════

describe('workflow HTTP adapter — authorization', () => {
  it('refuses every operation without a credential', async () => {
    const deployment = boot();
    for (const request of EVERY_OPERATION) {
      const response = await deployment.call({ ...request, authorization: null } as never);
      assert.equal(
        response.status,
        401,
        `${String(request.operation)} must require authentication`,
      );
      assert.equal(response.body.success, false);
    }
  });

  it('refuses every operation for a caller with no workflow role', async () => {
    const deployment = boot();
    for (const request of EVERY_OPERATION) {
      const response = await deployment.call({
        ...request,
        authorization: bearer('token-client'),
      } as never);
      assert.equal(response.status, 403, `${String(request.operation)} must require a role`);
      assert.equal(response.body.success, false);
    }
  });

  it('refuses every operation for an unknown credential', async () => {
    const deployment = boot();
    for (const request of EVERY_OPERATION) {
      const response = await deployment.call({
        ...request,
        authorization: bearer('token-forged'),
      } as never);
      assert.equal(response.status, 401, `${String(request.operation)} must verify the credential`);
    }
  });

  it('refuses a start from a reader-and-approver role, with a typed failure', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.startRun,
      authorization: bearer('token-reviewer'),
      body: {
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: SUBMISSION.reviewable },
      },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.failure, 'workflow_unauthorized');
    assert.equal('diagnostics' in response.body, false, 'server detail never reaches a caller');
  });

  it('refuses a decision from the operator who started the run', async () => {
    // The separation of duties the barrier exists for. A consultant holds
    // `workflow.run.create` and not `workflow.approval.decide`, so it cannot wave
    // through the approval on work it requested.
    const deployment = boot();
    const parked = await startReview(deployment, SUBMISSION.reviewable);
    assert.equal(parked.state, 'waiting_for_approval');
    assert.ok(parked.pendingApproval);

    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.decideApproval,
      workflowApprovalId: parked.pendingApproval.workflowApprovalId,
      body: { decision: 'approve', reason: 'Approving my own review.' },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.failure, 'workflow_unauthorized');
  });

  it('takes the tenant and the actor from the subject, never from the body', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.startRun,
      body: {
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: SUBMISSION.reviewable },
        // Every one of these is an attempt to assert something the server
        // resolves. `object()` and the adapter's field-by-field reads drop them.
        organizationId: OTHER_ORG,
        actorId: 'somebody-else',
        actorRoles: ['owner'],
        capabilities: ['workflow.approval.decide'],
        state: 'completed',
        origin: { surface: 'system', feature: 'forged' },
        runtimeMs: 86_400_000,
      },
    });
    assert.equal(response.status, 200);
    const run = runOf(response);
    assert.equal(run.organizationId, ORG, 'the organization is resolved, never asserted');
    assert.equal(run.actorId, 'user-consultant');
    assert.notEqual(run.state, 'completed', 'the state comes from the run, not from the body');
  });

  it('refuses an organization the subject does not hold', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.listRuns,
      organizationId: OTHER_ORG,
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'ORGANIZATION_NOT_RESOLVED');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ════════════════════════════════════════════════════════════════════════════

describe('workflow HTTP adapter — validation', () => {
  it('refuses a malformed workflow id before anything is created', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.startRun,
      body: { workflowId: '../../etc/passwd', input: { submissionId: SUBMISSION.reviewable } },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['workflowId']);
  });

  it('refuses a run id that is not a safe identifier', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: 'not a valid id!',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['workflowRunId']);
  });

  it('refuses a decision that is neither approve nor reject', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.decideApproval,
      authorization: bearer('token-reviewer'),
      workflowApprovalId: 'wfa_probe',
      body: { decision: 'maybe', reason: 'undecided for now' },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['decision']);
  });

  it('refuses a decision with no reason, and never invents one', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.decideApproval,
      authorization: bearer('token-reviewer'),
      workflowApprovalId: 'wfa_probe',
      body: { decision: 'approve' },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['reason']);
  });

  it('refuses a cancellation with no reason', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.cancelRun,
      workflowRunId: 'wfr_probe',
      body: {},
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.fields, ['reason']);
  });

  it('refuses an input the workflow’s own contract rejects', async () => {
    const deployment = boot();
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.startRun,
      body: { workflowId: READINESS_REVIEW_WORKFLOW_ID, input: { submissionId: '' } },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
  });

  it('rejects an operation the union does not declare', async () => {
    const deployment = boot();
    const response = await deployment.call({ operation: 'workflow.run.destroy' as never });
    assert.equal(response.status, 404);
  });

  it('offers no operation that edits a run’s history', () => {
    const mutations = Object.values(WORKFLOW_OPERATION).filter((operation) =>
      /delete|edit|patch|purge|rewrite|reopen/i.test(operation),
    );
    assert.deepEqual(mutations, []);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE SWITCH IS OFF BY DEFAULT, AND THE SURFACE FAILS CLOSED
// ════════════════════════════════════════════════════════════════════════════

describe('workflow HTTP adapter — the deployment switch', () => {
  it('cannot start the review when the deployment did not ask for it', async () => {
    const deployment = boot({ env: { AI_DIAGNOSTIC_REVIEW_ENABLED: undefined } });
    const response = await deployment.call({
      operation: WORKFLOW_OPERATION.startRun,
      body: {
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: SUBMISSION.reviewable },
      },
    });
    // NOT REGISTERED, therefore NOT STARTABLE. The refusal comes from the
    // registry, so mounting the surface cannot activate a capability.
    assert.equal(response.status, 404);
    assert.equal(response.body.failure, 'workflow_not_found');
  });

  it('shows an empty registry rather than a disabled entry', async () => {
    const deployment = boot({ env: { AI_DIAGNOSTIC_REVIEW_ENABLED: undefined } });
    const response = await deployment.call({ operation: WORKFLOW_OPERATION.listWorkflows });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.workflows, []);

    const overview = await deployment.call({ operation: WORKFLOW_OPERATION.overview });
    assert.equal(
      (overview.body.overview as { registeredWorkflows: number }).registeredWorkflows,
      0,
    );
  });

  it('publishes the certified workflow once the deployment asks', async () => {
    const deployment = boot();
    const response = await deployment.call({ operation: WORKFLOW_OPERATION.listWorkflows });
    const workflows = response.body.workflows as {
      workflowId: string;
      certification: string;
      enabled: boolean;
      approvalCount: number;
    }[];
    assert.equal(workflows.length, 1);
    assert.equal(workflows[0].workflowId, READINESS_REVIEW_WORKFLOW_ID);
    assert.equal(workflows[0].certification, 'certified');
    assert.equal(workflows[0].enabled, true);
    assert.equal(workflows[0].approvalCount, 1, 'the review stops for a person exactly once');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE AUTHORISED PATH, END TO END, THROUGH THE SURFACE
// ════════════════════════════════════════════════════════════════════════════

describe('workflow HTTP adapter — the operator’s path', () => {
  it('starts, parks with a named subject, approves, and commits once', async () => {
    const deployment = boot();

    const parked = await startReview(deployment, SUBMISSION.reviewable);
    assert.equal(parked.state, 'waiting_for_approval');
    assert.ok(parked.pendingApproval, 'the run must park at the approval barrier');

    // THE QUEUE, AS AN APPROVER READS IT. `subjectEvidence` is what makes the
    // entry answerable: which submission, and the digest of the sealed draft.
    const queue = await deployment.call({
      operation: WORKFLOW_OPERATION.listApprovals,
      authorization: bearer('token-reviewer'),
    });
    assert.equal(queue.status, 200);
    const pending = queue.body.approvals as unknown as ApprovalView[];
    assert.equal(pending.length, 1);
    assert.equal(pending[0].nodeId, 'n_publish_approval');
    assert.equal(pending[0].approvalState, 'pending');
    assert.ok(pending[0].subjectEvidence, 'the queue entry must name its subject');
    assert.equal(pending[0].subjectEvidence.subjectId, SUBMISSION.reviewable);
    assert.match(
      pending[0].subjectEvidence.contentDigest,
      /^[a-f0-9]{8,64}$/,
      'the digest is a fingerprint, never content',
    );
    assert.deepEqual(pending[0].authorizedRoles, ['owner', 'reviewer']);

    // The same record read singly, by id.
    const single = await deployment.call({
      operation: WORKFLOW_OPERATION.getApproval,
      authorization: bearer('token-reviewer'),
      workflowApprovalId: pending[0].workflowApprovalId,
    });
    assert.equal(single.status, 200);
    assert.equal(
      approvalOf(single).subjectEvidence?.contentDigest,
      pending[0].subjectEvidence.contentDigest,
    );

    // THE DECISION, by a declared role, with a reason the server insisted on.
    const decided = await deployment.call({
      operation: WORKFLOW_OPERATION.decideApproval,
      authorization: bearer('token-reviewer'),
      workflowApprovalId: pending[0].workflowApprovalId,
      body: { decision: 'approve', reason: 'Reviewed the draft and accepted it.' },
    });
    assert.equal(decided.status, 200);
    assert.equal(approvalOf(decided).approvalState, 'approved');
    assert.equal(approvalOf(decided).decidedBy, 'user-reviewer');
    assert.equal(approvalOf(decided).decision, 'approve');

    // THE FINAL OUTCOME, visible through the surface.
    const finished = await drive(deployment, parked, { stopAtApproval: false });
    assert.equal(finished.state, 'completed');
    assert.ok(finished.resultDigest, 'a completed run publishes a result digest');

    const read = await deployment.call({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: finished.workflowRunId,
    });
    assert.equal(read.status, 200);
    assert.equal(runOf(read).state, 'completed');
    assert.equal(runOf(read).workflowId, READINESS_REVIEW_WORKFLOW_ID);

    // COMMITTED EXACTLY ONCE, read back from the rows the deployment wrote.
    const committed = deployment.kv
      .keys()
      .filter((key) => key.includes(':ai:diagnostic_review:'));
    assert.equal(committed.length, 1, 'exactly one committed review');
    assert.ok(committed[0].startsWith(`org:${ORG}:`), 'written under its tenant');

    // The approval was spent. A second advance must not commit again.
    await drive(deployment, finished, { stopAtApproval: false });
    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_review:')).length,
      1,
    );

    // And the run is listed, and counted, for the operator.
    const listed = await deployment.call({
      operation: WORKFLOW_OPERATION.listRuns,
      states: ['completed'],
    });
    assert.equal((listed.body.runs as unknown[]).length, 1);
  });

  it('records a rejection as a refusal, and commits nothing', async () => {
    const deployment = boot();
    const parked = await startReview(deployment, SUBMISSION.reviewable);
    assert.ok(parked.pendingApproval);

    const decided = await deployment.call({
      operation: WORKFLOW_OPERATION.decideApproval,
      authorization: bearer('token-reviewer'),
      workflowApprovalId: parked.pendingApproval.workflowApprovalId,
      body: { decision: 'reject', reason: 'The narrative overstates the evidence.' },
    });
    assert.equal(decided.status, 200);
    assert.equal(approvalOf(decided).approvalState, 'rejected');

    // `onRejection: 'fail'` — a refused review is a decision somebody made, not
    // a run that was called off.
    const settled = await drive(deployment, parked, { stopAtApproval: false });
    assert.equal(settled.state, 'failed');
    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_review:')).length,
      0,
      'a rejected review commits nothing',
    );
  });

  it('cancels a parked run, and refuses to cancel it twice', async () => {
    const deployment = boot();
    const parked = await startReview(deployment, SUBMISSION.reviewable);

    const cancelled = await deployment.call({
      operation: WORKFLOW_OPERATION.cancelRun,
      workflowRunId: parked.workflowRunId,
      body: { reason: 'The client withdrew the submission.' },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(runOf(cancelled).state, 'cancelled');

    // TERMINAL IS TERMINAL. The existing state rules decide, and the surface
    // reports their verdict rather than pretending the second call worked.
    const again = await deployment.call({
      operation: WORKFLOW_OPERATION.cancelRun,
      workflowRunId: parked.workflowRunId,
      body: { reason: 'Trying again.' },
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.failure, 'workflow_invalid_transition');

    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_review:')).length,
      0,
      'a cancelled run commits nothing',
    );
  });

  it('reports the escalated outcome for a submission that cannot be reviewed', async () => {
    const deployment = boot();
    const settled = await startReview(deployment, SUBMISSION.empty, { stopAtApproval: false });
    assert.equal(settled.state, 'completed');
    assert.equal(
      settled.steps.some((step) => step.kind === 'approval'),
      false,
      'an escalation must never reach the approval barrier',
    );
    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_escalation:')).length,
      1,
    );
    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_review:')).length,
      0,
    );

    // The approver's queue stays empty: there was never a question to ask.
    const queue = await deployment.call({
      operation: WORKFLOW_OPERATION.listApprovals,
      authorization: bearer('token-reviewer'),
    });
    assert.deepEqual(queue.body.approvals, []);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TENANT ISOLATION
// ════════════════════════════════════════════════════════════════════════════

describe('workflow HTTP adapter — tenant isolation', () => {
  it('gives one tenant no read of another tenant’s run', async () => {
    const deployment = boot();
    const parked = await startReview(deployment, SUBMISSION.reviewable);

    const foreign = await deployment.call({
      operation: WORKFLOW_OPERATION.getRun,
      authorization: bearer('token-other-tenant'),
      workflowRunId: parked.workflowRunId,
    });
    // NOT FOUND rather than FORBIDDEN: the scope is applied to the storage KEY,
    // so there is no response difference a caller could use to probe.
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.failure, 'workflow_run_not_found');

    const foreignList = await deployment.call({
      operation: WORKFLOW_OPERATION.listRuns,
      authorization: bearer('token-other-tenant'),
    });
    assert.deepEqual(foreignList.body.runs, []);
  });

  it('gives one tenant no decision on another tenant’s approval', async () => {
    const deployment = boot();
    const parked = await startReview(deployment, SUBMISSION.reviewable);
    assert.ok(parked.pendingApproval);

    const foreign = await deployment.call({
      operation: WORKFLOW_OPERATION.decideApproval,
      authorization: bearer('token-other-tenant'),
      workflowApprovalId: parked.pendingApproval.workflowApprovalId,
      body: { decision: 'approve', reason: 'Approving another tenant’s work.' },
    });
    assert.notEqual(foreign.status, 200);

    const foreignQueue = await deployment.call({
      operation: WORKFLOW_OPERATION.listApprovals,
      authorization: bearer('token-other-tenant'),
    });
    assert.deepEqual(foreignQueue.body.approvals, []);

    // And the request is still pending for the tenant it belongs to.
    const mine = await deployment.call({
      operation: WORKFLOW_OPERATION.getApproval,
      authorization: bearer('token-reviewer'),
      workflowApprovalId: parked.pendingApproval.workflowApprovalId,
    });
    assert.equal(approvalOf(mine).approvalState, 'pending');
  });

  it('cannot review a submission that belongs to another tenant', async () => {
    const deployment = boot();
    const settled = await drive(
      deployment,
      runOf(
        await deployment.call({
          operation: WORKFLOW_OPERATION.startRun,
          authorization: bearer('token-other-tenant'),
          body: {
            workflowId: READINESS_REVIEW_WORKFLOW_ID,
            input: { submissionId: SUBMISSION.reviewable },
          },
        }),
      ),
      { stopAtApproval: false, token: 'token-other-tenant' },
    );
    assert.notEqual(settled.state, 'completed');
    assert.equal(
      settled.steps.some((step) => step.kind === 'approval'),
      false,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WHAT NEVER LEAVES THE SURFACE
// ════════════════════════════════════════════════════════════════════════════

describe('workflow HTTP adapter — what never reaches a caller', () => {
  it('returns no prompt, no credential, no diagnostic and no client content', async () => {
    const deployment = boot();

    const bodies: unknown[] = [];
    const parked = await startReview(deployment, SUBMISSION.reviewable);
    assert.ok(parked.pendingApproval);

    for (const request of [
      { operation: WORKFLOW_OPERATION.overview },
      { operation: WORKFLOW_OPERATION.listWorkflows },
      { operation: WORKFLOW_OPERATION.listRuns },
      { operation: WORKFLOW_OPERATION.getRun, workflowRunId: parked.workflowRunId },
      {
        operation: WORKFLOW_OPERATION.listApprovals,
        authorization: bearer('token-reviewer'),
      },
      {
        operation: WORKFLOW_OPERATION.getApproval,
        authorization: bearer('token-reviewer'),
        workflowApprovalId: parked.pendingApproval.workflowApprovalId,
      },
    ] as Partial<WorkflowHttpRequest>[]) {
      bodies.push((await deployment.call(request as never)).body);
    }

    const decided = await deployment.call({
      operation: WORKFLOW_OPERATION.decideApproval,
      authorization: bearer('token-reviewer'),
      workflowApprovalId: parked.pendingApproval.workflowApprovalId,
      body: { decision: 'approve', reason: 'Reviewed the draft and accepted it.' },
    });
    bodies.push(decided.body);
    const finished = await drive(deployment, parked, { stopAtApproval: false });
    bodies.push(
      (
        await deployment.call({
          operation: WORKFLOW_OPERATION.getRun,
          workflowRunId: finished.workflowRunId,
        })
      ).body,
    );

    const serialized = JSON.stringify(bodies);

    // THE CLIENT'S OWN WORDS. The run's `input` is not projected and neither is
    // any node output, so the answers this submission was seeded with must not
    // appear anywhere in any response.
    const reviewable = DIAGNOSTIC_DOSSIERS.find(
      (dossier) => dossier.submissionId === SUBMISSION.reviewable,
    );
    assert.ok(reviewable, 'the reviewable fixture must exist');
    // Without this the loop below could pass by having nothing to look for.
    assert.ok(reviewable.answers.length > 0, 'the fixture must carry answers to look for');
    for (const answer of reviewable.answers) {
      assert.equal(
        serialized.includes(answer.answer),
        false,
        'a client answer reached an HTTP response',
      );
    }
    assert.equal(
      serialized.includes(reviewable.company),
      false,
      'the client company name reached an HTTP response',
    );

    // SERVER DETAIL AND SECRETS. `diagnostics` is the field that carries the
    // former; the latter has no field and must have no accidental one.
    for (const forbidden of [
      'diagnostics',
      'Bearer',
      'token-consultant',
      'token-reviewer',
      'apiKey',
      'api_key',
      'authorization',
      'messages',
      'completion',
      'promptText',
      'systemPrompt',
    ]) {
      assert.equal(
        serialized.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `an HTTP response carries ${forbidden}`,
      );
    }
  });

  it('names a run’s input only as a digest', async () => {
    const deployment = boot();
    const parked = await startReview(deployment, SUBMISSION.reviewable);
    const read = await deployment.call({
      operation: WORKFLOW_OPERATION.getRun,
      workflowRunId: parked.workflowRunId,
    });
    const body = read.body.run as Record<string, unknown>;
    assert.equal('input' in body, false, 'the run projection must not echo its input');
    assert.match(String(body.inputDigest), /^[a-f0-9]{8,64}$/);
  });
});
