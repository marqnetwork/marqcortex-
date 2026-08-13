/**
 * AI-01 Batch 3B Part 7B runtime verification — mock mode.
 *
 * Drives the REAL diagnostic review capability — the deterministic authority,
 * the five tools, the readiness manager and the review workflow — over a real
 * workflow runtime, a real agent runtime and a real AI Control Plane, and
 * prints a pass/fail line per scenario.
 *
 * This is a runtime check rather than a unit test: it assembles the runtime the
 * way production does and drives it through the workflow service, so what it
 * exercises is the path an operator's console would take.
 *
 * SAFETY. The plane is built with the mock adapter only and
 * `AI_ALLOW_REAL_REQUESTS` unset, so no vendor endpoint is contacted and the
 * MARQ spend ledger is never touched. The agent under test is the SHIPPED,
 * certified definition — nothing is swapped — and the last scenario drives a
 * copy with the flags cleared to show the refusal certification lifted.
 *
 *   node --experimental-strip-types scripts/diagnostic-review-verify.ts
 */

import {
  AGENT_TOKEN,
  SUBMISSION,
  buildTestDiagnosticRuntime,
  reviewableDossier,
} from '../supabase/functions/server/ai/__tests__/diagnosticFixtures.ts';
import type { TestDiagnosticRuntime } from '../supabase/functions/server/ai/__tests__/diagnosticFixtures.ts';
import type { WorkflowRunDetail } from '../supabase/functions/server/ai/workflows/service/workflowRuntimeService.ts';
import {
  DIAGNOSTIC_TOOL_IDS,
  READINESS_REVIEW_WORKFLOW_ID,
  computeReadinessAuthority,
  enforceReadinessFactLock,
  readinessManagerAgent,
  readinessReviewWorkflow,
} from '../supabase/functions/server/ai/business/diagnostic/index.ts';
import { diagnosticFailureOf } from '../supabase/functions/server/ai/business/diagnostic/contracts/review.ts';

const results: { scenario: string; ok: boolean; detail: string }[] = [];

function check(scenario: string, ok: boolean, detail: string): void {
  results.push({ scenario, ok, detail });
}

const TERMINAL = ['completed', 'failed', 'cancelled', 'expired', 'policy_denied'];

async function driveToPark(
  harness: TestDiagnosticRuntime,
  detail: WorkflowRunDetail,
): Promise<WorkflowRunDetail> {
  let run = detail;
  for (let i = 0; i < 8; i += 1) {
    if (TERMINAL.includes(run.state) || run.state === 'waiting_for_approval') return run;
    run = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: run.workflowRunId,
    });
  }
  return run;
}

async function driveToEnd(
  harness: TestDiagnosticRuntime,
  detail: WorkflowRunDetail,
): Promise<WorkflowRunDetail> {
  let run = detail;
  for (let i = 0; i < 8; i += 1) {
    if (TERMINAL.includes(run.state)) return run;
    run = await harness.workflows.service.advanceRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowRunId: run.workflowRunId,
    });
  }
  return run;
}

async function start(
  harness: TestDiagnosticRuntime,
  submissionId: string,
): Promise<WorkflowRunDetail> {
  return driveToPark(
    harness,
    await harness.workflows.service.startRun({
      ...harness.meta(AGENT_TOKEN.consultant),
      workflowId: READINESS_REVIEW_WORKFLOW_ID,
      input: { submissionId },
    }),
  );
}

async function failureOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return '(no refusal)';
  } catch (error) {
    return (
      diagnosticFailureOf(error) ??
      (error as { failure?: string; code?: string }).failure ??
      (error as { code?: string }).code ??
      'unknown'
    );
  }
}

async function main(): Promise<void> {
  // ── 1. The deterministic authority ────────────────────────────────────────
  {
    const first = computeReadinessAuthority(reviewableDossier);
    const second = computeReadinessAuthority(reviewableDossier);
    check(
      'authority is deterministic',
      first.authorityDigest === second.authorityDigest,
      `digest ${first.authorityDigest.slice(0, 12)}…`,
    );
    check(
      'every recommendation clears both thresholds',
      first.recommendations.every(
        (entry) => entry.problemDensity >= 6 && entry.impactPotential >= 6,
      ),
      `${first.recommendations.length} recommendation(s)`,
    );
    check(
      'the portfolio is capped at seven',
      first.recommendations.length <= 7 && first.portfolio.cap === 7,
      `size=${first.recommendations.length} cap=${first.portfolio.cap}`,
    );
    check(
      'consistency validation passes on a scored submission',
      first.consistency.valid,
      `errors=${first.consistency.errors.length} warnings=${first.consistency.warnings.length}`,
    );
  }

  // ── 2. The fact lock ──────────────────────────────────────────────────────
  {
    const authority = computeReadinessAuthority(reviewableDossier);
    const locked = enforceReadinessFactLock(
      {
        readiness: { ...authority.readiness, overallScore: 100, band: 'Low' },
        recommendations: [
          { recommendationId: 'rec:invented', rank: 1, priorityScore: 10, qualified: true },
        ],
      },
      authority,
    );
    const readiness = locked.content.readiness as { overallScore: number };
    const reconciled = locked.content.recommendations as { recommendationId: string }[];
    check(
      'fact lock restores a changed authoritative value',
      readiness.overallScore === authority.readiness.overallScore &&
        locked.restored.includes('readiness.overallScore'),
      `restored ${locked.restored.length} path(s)`,
    );
    check(
      'fact lock removes an invented recommendation',
      !reconciled.some((entry) => entry.recommendationId === 'rec:invented') &&
        locked.removed.length > 0,
      `removed ${locked.removed.length} path(s)`,
    );
  }

  // ── 3. The happy path, end to end ─────────────────────────────────────────
  {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'v1' });
    const parked = await start(harness, SUBMISSION.reviewable);
    check(
      'a review parks at the approval barrier',
      parked.state === 'waiting_for_approval' && parked.pendingApproval !== undefined,
      `state=${parked.state} node=${parked.currentNodeId}`,
    );

    const approvalId = parked.pendingApproval?.workflowApprovalId as string;
    const decided = await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.reviewer),
      workflowApprovalId: approvalId,
      decision: 'approve',
      reason: 'Reviewed and accepted.',
    });
    check(
      'a declared role decides the approval',
      decided.approvalState === 'approved' && decided.decidedBy === 'user-reviewer',
      `${decided.approvalState} by ${String(decided.decidedBy)}`,
    );

    const finished = await driveToEnd(harness, parked);
    const commits = await harness.capability.commits.listByRun('acme', finished.workflowRunId);
    const draft = await harness.capability.drafts.load('acme', finished.workflowRunId);
    check(
      'the approved review commits exactly once',
      finished.state === 'completed' && commits.length === 1,
      `state=${finished.state} commits=${commits.length}`,
    );
    check(
      'the committed content is the sealed draft, and the authority is the engines’',
      commits[0]?.contentDigest === draft?.contentDigest &&
        commits[0]?.content.authority.authorityDigest ===
          computeReadinessAuthority(reviewableDossier).authorityDigest,
      `digest ${String(commits[0]?.contentDigest).slice(0, 12)}…`,
    );
    check(
      'the approval was spent, once',
      (await harness.workflows.approvals.get('acme', approvalId))?.approvalState === 'consumed',
      `approval ${approvalId}`,
    );
  }

  // ── 4. The escalation path ────────────────────────────────────────────────
  {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'v2' });
    const run = await driveToEnd(harness, await start(harness, SUBMISSION.empty));
    const escalations = await harness.capability.escalations.list('acme', run.workflowRunId);
    check(
      'an unreviewable submission escalates and never reaches an approver',
      run.state === 'completed' &&
        escalations.length === 1 &&
        !run.steps.some((step) => step.kind === 'approval'),
      `escalation=${escalations[0]?.reason ?? 'none'}`,
    );
  }

  // ── 5. A rejection, and an expiry ─────────────────────────────────────────
  {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'v3' });
    const parked = await start(harness, SUBMISSION.reviewable);
    await harness.workflows.service.decideApproval({
      ...harness.meta(AGENT_TOKEN.reviewer),
      workflowApprovalId: parked.pendingApproval?.workflowApprovalId as string,
      decision: 'reject',
      reason: 'The evidence is not strong enough.',
    });
    const rejected = await driveToEnd(harness, parked);
    const commits = await harness.capability.commits.listByRun('acme', rejected.workflowRunId);
    check(
      'a rejected review fails the run and commits nothing',
      rejected.state === 'failed' && commits.length === 0,
      `state=${rejected.state} failure=${String(rejected.failure)}`,
    );
  }
  {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'v4' });
    const parked = await start(harness, SUBMISSION.reviewable);
    harness.clock.advance(2 * 60 * 60 * 1000);
    const expired = await driveToEnd(harness, parked);
    const approval = await harness.workflows.approvals.get(
      'acme',
      parked.pendingApproval?.workflowApprovalId as string,
    );
    const commits = await harness.capability.commits.listByRun('acme', expired.workflowRunId);
    check(
      'an expired approval never becomes a yes',
      approval?.decision === undefined &&
        approval?.approvalState !== 'approved' &&
        commits.length === 0,
      `approval=${String(approval?.approvalState)} state=${expired.state}`,
    );
  }

  // ── 6. The commit precondition ────────────────────────────────────────────
  {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'v5' });
    const parked = await start(harness, SUBMISSION.reviewable);
    const commit = harness.capability.tools.find(
      (tool) => tool.toolId === DIAGNOSTIC_TOOL_IDS.commitReview,
    );
    const draft = await harness.capability.drafts.load('acme', parked.workflowRunId);

    const early = await failureOf(
      Promise.resolve(
        commit?.execute({
          toolId: DIAGNOSTIC_TOOL_IDS.commitReview,
          runId: parked.childAgentRunIds[0],
          agentId: readinessManagerAgent.agentId,
          organizationId: 'acme',
          actorId: 'user-consultant',
          correlationId: 'cor_verify',
          idempotencyKey: 'verify-early',
          input: { contentDigest: draft?.contentDigest ?? '' },
          timeoutMs: 5_000,
          nowIso: harness.clock.isoNow(),
        }) ?? Promise.reject(new Error('no commit tool')),
      ),
    );
    check(
      'a commit before the approval is refused',
      early === 'diagnostic_approval_not_granted',
      early,
    );

    const outside = await failureOf(
      Promise.resolve(
        commit?.execute({
          toolId: DIAGNOSTIC_TOOL_IDS.commitReview,
          runId: 'run_not_a_workflow_child',
          agentId: readinessManagerAgent.agentId,
          organizationId: 'acme',
          actorId: 'user-consultant',
          correlationId: 'cor_verify',
          idempotencyKey: 'verify-outside',
          input: { contentDigest: draft?.contentDigest ?? '' },
          timeoutMs: 5_000,
          nowIso: harness.clock.isoNow(),
        }) ?? Promise.reject(new Error('no commit tool')),
      ),
    );
    check(
      'a direct agent run outside the workflow cannot commit',
      outside === 'diagnostic_not_in_workflow',
      outside,
    );
  }

  // ── 7. Tenant isolation ───────────────────────────────────────────────────
  {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'v6' });
    const read = harness.capability.tools.find(
      (tool) => tool.toolId === DIAGNOSTIC_TOOL_IDS.readDossier,
    );
    const crossTenant = await failureOf(
      Promise.resolve(
        read?.execute({
          toolId: DIAGNOSTIC_TOOL_IDS.readDossier,
          runId: 'run_verify',
          agentId: readinessManagerAgent.agentId,
          organizationId: 'globex',
          actorId: 'user-globex',
          correlationId: 'cor_verify',
          idempotencyKey: 'verify-tenant',
          input: { submissionId: SUBMISSION.reviewable },
          timeoutMs: 5_000,
          nowIso: harness.clock.isoNow(),
        }) ?? Promise.reject(new Error('no read tool')),
      ),
    );
    check(
      'another tenant’s submission is not readable',
      crossTenant === 'diagnostic_submission_not_found',
      crossTenant,
    );
  }

  // ── 8. The certification posture ──────────────────────────────────────────
  {
    check(
      'the shipped agent is enabled and certified',
      readinessManagerAgent.enabled === true &&
        readinessManagerAgent.certification === 'certified',
      `enabled=${readinessManagerAgent.enabled} certification=${readinessManagerAgent.certification}`,
    );
    const shippedHarness = buildTestDiagnosticRuntime({ idSeed: 'v7' });
    check(
      'every shipped tool and the workflow are certified',
      shippedHarness.shipped.tools.every((tool) => tool.certification === 'certified') &&
        readinessReviewWorkflow.certification === 'certified',
      `${shippedHarness.shipped.tools.length} tool(s)`,
    );
    check(
      'certification did not widen the chain',
      shippedHarness.shipped.tools.length === readinessManagerAgent.allowedTools.length &&
        shippedHarness.shipped.tools.every((tool) =>
          readinessManagerAgent.allowedTools.includes(tool.toolId),
        ),
      `${readinessManagerAgent.allowedTools.length} declared tool(s)`,
    );

    // The refusal certification lifts, still under test.
    const harness = buildTestDiagnosticRuntime({
      idSeed: 'v8',
      useUncertifiedDefinitions: true,
    });
    const refused = await failureOf(
      harness.workflows.service.startRun({
        ...harness.meta(AGENT_TOKEN.consultant),
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        input: { submissionId: SUBMISSION.reviewable },
      }),
    );
    check(
      'an uncertified, disabled chain still refuses to run',
      refused !== '(no refusal)',
      refused,
    );
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const width = Math.max(...results.map((result) => result.scenario.length));
  process.stdout.write(
    '\nAI-01 Batch 3B Part 7B — diagnostic review verification (mock mode)\n',
  );
  process.stdout.write('='.repeat(width + 12) + '\n');
  for (const result of results) {
    process.stdout.write(
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.scenario.padEnd(width)}  ${result.detail}\n`,
    );
  }
  const failed = results.filter((result) => !result.ok);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} scenarios passed\n`,
  );
  if (failed.length > 0) process.exit(1);
}

await main();
