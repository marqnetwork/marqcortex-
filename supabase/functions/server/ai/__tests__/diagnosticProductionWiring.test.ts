/**
 * The certified capability, through the PRODUCTION ASSEMBLY (Part 7E).
 *
 * Every other diagnostic suite builds its runtimes with `buildTestDiagnosticRuntime`,
 * which assembles the same components by hand. This one calls
 * `initializeControlPlane` — the function the edge entry point calls, the one
 * that reads configuration, decides what to register and hands the runtimes
 * back — and drives the review through the objects it returns.
 *
 * That distinction is the point. A capability can be correct in every unit and
 * still be unreachable, half-registered or registered where it should not be,
 * and none of those is a defect any of the other suites can see.
 *
 * WHAT IS INJECTED, AND WHAT IS NOT. The environment, the auth lookups, the
 * key-value port and the submission source are injected, exactly as `index.tsx`
 * injects them — and the submission source is the PRODUCTION one,
 * `diagnostic/submissionDossierSource.ts`, reading the `sub:{id}` rows this file
 * seeds and naming every answer's question and section from the question
 * catalogue. A memory store here would leave the one component that turns a
 * stored submission into a reviewable dossier untested by the suite whose whole
 * subject is the assembly. Everything downstream — the control plane, the agent
 * runtime, the tool gateway, the workflow engine, the approval gate, the
 * financial recorder and the certified definitions themselves — is production
 * code assembled by production code.
 *
 * SAFETY. `AI_ALLOW_REAL_REQUESTS` is never set, so the mock adapter serves
 * every model step, no vendor endpoint is contacted and the MARQ ledger is
 * never spent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getAgentRuntime,
  getControlPlane,
  getWorkflowRuntime,
  initializeControlPlane,
  resetControlPlaneForTests,
} from '../bootstrap.ts';
import type { BootstrapDependencies } from '../bootstrap.ts';
import { recordEnv } from '../runtime/env.ts';
import {
  DIAGNOSTIC_TOOL_IDS,
  READINESS_MANAGER_AGENT_ID,
  READINESS_REVIEW_WORKFLOW_ID,
} from '../business/diagnostic/index.ts';
import { createKvSubmissionDossierSource } from '../../diagnostic/submissionDossierSource.ts';
import { DIAGNOSTIC_QUESTION_CATALOGUE } from '../../diagnostic/questionCatalogue.ts';
import type { WorkflowRunDetail } from '../workflows/service/workflowRuntimeService.ts';
import { DIAGNOSTIC_DOSSIERS, SUBMISSION } from './diagnosticFixtures.ts';
import { createFakeKv } from './agentFixtures.ts';
import type { FakeKv } from './agentFixtures.ts';

// ── The deployment, as the edge entry point supplies it ─────────────────────

const ORG = 'acme';
const OTHER_ORG = 'globex';

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

function meta(token: string): { authorization: string; correlationId: string } {
  return { authorization: bearer(token), correlationId: 'cor_wiring' };
}

interface Deployment {
  readonly kv: FakeKv;
  readonly dossiers: ReturnType<typeof createKvSubmissionDossierSource>;
}

/**
 * The fixture submissions as a DEPLOYMENT stores them.
 *
 * A stored record keys answers by question id and names the industry; the
 * question text and the section come from the catalogue, which is the whole
 * reason the production source exists. The fixtures' answer TEXT is carried
 * over verbatim — it is keyword soup chosen to move every causal family — under
 * the manufacturing catalogue's own ids.
 *
 * COMPLETENESS IS PART OF THE FIXTURE'S MEANING. The dossier fixtures were
 * written against a six-question diagnostic; the real one asks fourteen, and
 * answering six of fourteen is a submission the agent escalates for low
 * confidence — correctly, and that is a fact about the submission rather than
 * about the wiring. `sub-reviewable` is therefore stored as a COMPLETED
 * diagnostic: the same six texts, cycled across all fourteen questions, so it
 * remains what its fixture says it is. `sub-empty` is stored empty, because
 * that is also what its fixture says.
 *
 * `sub-globex` is not seeded: key-value submissions have one owning tenant, so
 * a second tenant's row is not a state this store can be in. The cross-tenant
 * case below asserts on that owner instead.
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

/**
 * Bootstrap one deployment.
 *
 * `resetControlPlaneForTests` first, because the plane is memoised per isolate
 * — which is correct in production and would otherwise make the second case in
 * this file assert on the first case's decisions.
 */
function boot(
  overrides: {
    readonly env?: Record<string, string | undefined>;
    readonly withKv?: boolean;
    readonly withDossiers?: boolean;
    readonly kv?: FakeKv;
  } = {},
): Deployment {
  resetControlPlaneForTests();

  const kv = overrides.kv ?? createFakeKv();
  seedSubmissions(kv);
  // The production source, over the rows above. `ORG` owns the key-value
  // submissions here exactly as the MARQ organization owns them in a
  // deployment, and the source answers for nobody else.
  const dossiers = createKvSubmissionDossierSource({
    read: kv.read,
    ownerOrganizationId: () => Promise.resolve(ORG),
  });
  const withKv = overrides.withKv ?? true;
  const withDossiers = overrides.withDossiers ?? true;

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
        person === undefined
          ? null
          : { id: person.id, email: person.email, roles: person.roles },
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
    ...(withKv
      ? {
          kvWrite: (key: string, value: unknown) => {
            kv.poke(key, value);
            return Promise.resolve();
          },
          kvRead: kv.read,
          kvReadByPrefix: kv.readByPrefix,
          kvCompareAndSwapField: kv.compareAndSwap,
        }
      : {}),
    ...(withDossiers ? { diagnosticDossiers: dossiers } : {}),
  };

  initializeControlPlane(deps);
  return { kv, dossiers };
}

const TERMINAL = ['completed', 'failed', 'cancelled', 'expired', 'policy_denied'];

async function drive(
  detail: WorkflowRunDetail,
  options: { readonly stopAtApproval: boolean; readonly token?: string },
): Promise<WorkflowRunDetail> {
  const workflows = getWorkflowRuntime();
  assert.ok(workflows, 'the workflow runtime must exist');
  let run = detail;
  for (let step = 0; step < 8; step += 1) {
    if (TERMINAL.includes(run.state)) return run;
    if (options.stopAtApproval && run.state === 'waiting_for_approval') return run;
    run = await workflows.service.advanceRun({
      ...meta(options.token ?? 'token-consultant'),
      workflowRunId: run.workflowRunId,
    });
  }
  return run;
}

async function startReview(submissionId: string): Promise<WorkflowRunDetail> {
  const workflows = getWorkflowRuntime();
  assert.ok(workflows);
  return drive(
    await workflows.service.startRun({
      ...meta('token-consultant'),
      workflowId: READINESS_REVIEW_WORKFLOW_ID,
      input: { submissionId },
    }),
    { stopAtApproval: true },
  );
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error ?? new Error('rejected');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIVATION IS A DEPLOYMENT DECISION
// ════════════════════════════════════════════════════════════════════════════

describe('part 7e — what the production assembly registers', () => {
  it('registers nothing when the deployment did not ask', () => {
    boot({ env: { AI_DIAGNOSTIC_REVIEW_ENABLED: undefined } });
    const agents = getAgentRuntime();
    const workflows = getWorkflowRuntime();
    assert.ok(agents && workflows);
    // OFF BY DEFAULT means the registries are empty, not that a disabled entry
    // appears in a console. A certified capability nobody activated is absent.
    assert.equal(agents.registry.find(READINESS_MANAGER_AGENT_ID), undefined);
    assert.equal(agents.tools.find(DIAGNOSTIC_TOOL_IDS.commitReview), undefined);
    assert.equal(workflows.registry.find(READINESS_REVIEW_WORKFLOW_ID), undefined);
  });

  it('registers nothing when the switch is on but storage is missing', () => {
    boot({ withKv: false });
    const agents = getAgentRuntime();
    const workflows = getWorkflowRuntime();
    assert.ok(agents && workflows);
    // A committed review is the record of a human decision AND the row that
    // refuses a replayed commit. Half a capability over an evicting store is a
    // worse outcome than none.
    assert.equal(agents.registry.find(READINESS_MANAGER_AGENT_ID), undefined);
    assert.equal(workflows.registry.find(READINESS_REVIEW_WORKFLOW_ID), undefined);
  });

  it('registers nothing when the switch is on but no submission source exists', () => {
    boot({ withDossiers: false });
    const agents = getAgentRuntime();
    const workflows = getWorkflowRuntime();
    assert.ok(agents && workflows);
    assert.equal(agents.registry.find(READINESS_MANAGER_AGENT_ID), undefined);
    assert.equal(workflows.registry.find(READINESS_REVIEW_WORKFLOW_ID), undefined);
  });

  it('registers the certified chain, and nothing beside it', () => {
    boot();
    const agents = getAgentRuntime();
    const workflows = getWorkflowRuntime();
    assert.ok(agents && workflows);

    const agent = agents.registry.find(READINESS_MANAGER_AGENT_ID);
    assert.ok(agent, 'the certified agent must be registered');
    assert.equal(agent.enabled, true);
    assert.equal(agent.certification, 'certified');

    // ONE AGENT, FIVE TOOLS, ONE WORKFLOW. The tool registry holds exactly the
    // agent's allow list: the mock tools are off by default, so a sixth
    // registered tool would be a capability that arrived without a decision.
    assert.equal(agents.registry.list().length, 1);
    assert.deepEqual(
      agents.tools.list().map((tool) => tool.toolId).sort(),
      [...agent.allowedTools].sort(),
    );
    assert.equal(workflows.registry.list().length, 1);
  });

  it('resolves the agent for execution where certification is required', () => {
    // The registry's execution path, not its listing. `require` is what the
    // orchestrator calls, and it is the check certification exists to pass.
    boot({ env: { AI_REQUIRE_CERTIFIED_AGENTS: 'true', AI_REQUIRE_CERTIFIED_TOOLS: 'true' } });
    const agents = getAgentRuntime();
    assert.ok(agents);
    const resolved = agents.registry.require(READINESS_MANAGER_AGENT_ID);
    assert.equal(resolved.agentId, READINESS_MANAGER_AGENT_ID);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE COMPLETE PATH, OVER THE ASSEMBLY A DEPLOYMENT GETS
// ════════════════════════════════════════════════════════════════════════════

describe('part 7e — the real execution path, end to end', () => {
  it('reviews, parks for a person, commits once, and records the money', async () => {
    const deployment = boot();
    const workflows = getWorkflowRuntime();
    assert.ok(workflows);

    const parked = await startReview(SUBMISSION.reviewable);
    assert.equal(parked.state, 'waiting_for_approval');
    assert.ok(parked.pendingApproval, 'the run must park at the approval barrier');

    // A CONSULTANT CANNOT ANSWER THEIR OWN BARRIER. The approval is the whole
    // reason this workflow has a human in it.
    const selfApproval = await rejection(
      workflows.service.decideApproval({
        ...meta('token-consultant'),
        workflowApprovalId: parked.pendingApproval.workflowApprovalId,
        decision: 'approve',
        reason: 'Approving my own review.',
      }),
    );
    assert.ok(selfApproval, 'a non-approver must not decide');

    const decided = await workflows.service.decideApproval({
      ...meta('token-reviewer'),
      workflowApprovalId: parked.pendingApproval.workflowApprovalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });
    assert.equal(decided.approvalState, 'approved');
    assert.equal(decided.decidedBy, 'user-reviewer');

    const finished = await drive(parked, { stopAtApproval: false });
    assert.equal(finished.state, 'completed');

    // DURABLE RECORDS, read back from the key-value rows the deployment wrote —
    // not from a store object this test is holding.
    const committed = deployment.kv
      .keys()
      .filter((key) => key.includes(':ai:diagnostic_review:'));
    assert.equal(committed.length, 1, 'exactly one committed review');
    assert.ok(
      committed[0].startsWith(`org:${ORG}:`),
      'the committed review is written under its tenant',
    );
    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_draft:')).length,
      1,
      'exactly one sealed draft',
    );

    // THE APPROVAL WAS SPENT, ONCE. A second advance must not commit again.
    const again = await drive(finished, { stopAtApproval: false });
    assert.equal(again.state, 'completed');
    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_review:')).length,
      1,
    );

    // THE FINANCIAL EVENT PATH. The workflow's own recorder, over the durable
    // ledger this deployment assembled — one canonical path from a node to an
    // event, and it is scoped to the tenant that ran.
    const events = await workflows.financialEvents.list({
      organizationId: ORG,
      window: { fromMs: 0, toMs: Date.now() + 60_000 },
      workflowRunId: finished.workflowRunId,
    });
    assert.ok(events.events.length > 0, 'the run recorded at least one financial event');
    for (const event of events.events) {
      assert.equal(event.organizationId, ORG);
      assert.equal(event.workflowId, READINESS_REVIEW_WORKFLOW_ID);
    }
    const otherTenant = await workflows.financialEvents.list({
      organizationId: OTHER_ORG,
      window: { fromMs: 0, toMs: Date.now() + 60_000 },
      workflowRunId: finished.workflowRunId,
    });
    assert.equal(otherTenant.events.length, 0, 'no financial event crosses a tenant');
  });

  it('escalates an unreviewable submission without reaching an approver', async () => {
    const deployment = boot();
    const run = await drive(await startReview(SUBMISSION.empty), { stopAtApproval: false });
    assert.equal(run.state, 'completed');
    assert.equal(
      run.steps.some((step) => step.kind === 'approval'),
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
      'nothing was committed',
    );
  });

  it('keeps one tenant out of another tenant’s submission', async () => {
    boot();
    const workflows = getWorkflowRuntime();
    assert.ok(workflows);
    // `globex` naming `acme`'s submission. The dossier tool keys by the run's
    // resolved organization, so the id simply does not resolve — and the run
    // fails rather than reviewing someone else's business.
    const run = await drive(
      await workflows.service.startRun({
        ...meta('token-other-tenant'),
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: SUBMISSION.reviewable },
      }),
      { stopAtApproval: false, token: 'token-other-tenant' },
    );
    // The run belongs to `globex` and is driven by `globex`. It still cannot
    // read the submission, because the dossier tool keys by the run's resolved
    // organization rather than by the id it was handed.
    assert.notEqual(run.state, 'completed');
    assert.equal(
      run.steps.some((step) => step.kind === 'approval'),
      false,
    );
  });

  it('stops the next step of a run in flight when the platform is stopped', async () => {
    const deployment = boot();
    const workflows = getWorkflowRuntime();
    const plane = getControlPlane();
    assert.ok(workflows && plane);

    const parked = await startReview(SUBMISSION.reviewable);
    await workflows.service.decideApproval({
      ...meta('token-reviewer'),
      workflowApprovalId: parked.pendingApproval?.workflowApprovalId as string,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });

    // THE EMERGENCY STOP, engaged between an approval and its commit — the
    // worst moment for it not to hold, and the reason the runtime reads the
    // switch per step rather than capturing it at assembly.
    const settings = plane.settings.current();
    plane.settings.adopt({
      ...settings,
      configurationVersion: settings.configurationVersion + 1,
      aiEnabled: false,
    });

    const stopped = await rejection(
      workflows.service.advanceRun({
        ...meta('token-consultant'),
        workflowRunId: parked.workflowRunId,
      }),
    );
    assert.ok(stopped, 'a stopped platform must not advance the run');
    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_review:')).length,
      0,
      'nothing commits while the platform is stopped',
    );

    // Releasing it lets the SAME run finish. A stop that lost the run would be
    // a stop nobody would dare use.
    const released = plane.settings.current();
    plane.settings.adopt({
      ...released,
      configurationVersion: released.configurationVersion + 1,
      aiEnabled: true,
    });
    const finished = await drive(parked, { stopAtApproval: false });
    assert.equal(finished.state, 'completed');
    assert.equal(
      deployment.kv.keys().filter((key) => key.includes(':ai:diagnostic_review:')).length,
      1,
    );
  });
});
