/**
 * AI-01 BATCH 3B PART 7D — pre-enable remediation.
 *
 * Three findings from the Part 7C independent certification review, each driven
 * through the production path rather than asserted about:
 *
 *   F1  A hostile model cannot make a review record unrepresentable, and a
 *       record that would be unrepresentable is never sealed.
 *   F2  The committed review — the business record of record, and the row that
 *       refuses a replay — is durable, tenant-scoped and written exactly once.
 *   F3  The approval a person answers says WHAT it is about, in values that came
 *       from server-side state, and the commit proves the two agree.
 *
 * Every case here is a REGRESSION: each one fails on the code as Part 7C
 * reviewed it, which is the only thing that makes it evidence.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_TOKEN,
  DIAGNOSTIC_DOSSIERS,
  SUBMISSION,
  buildTestDiagnosticRuntime,
  createFakeKv,
  kvStorageFor,
  reviewableDossier,
} from './diagnosticFixtures.ts';
import type { FakeKv } from './diagnosticFixtures.ts';
import type { WorkflowRunDetail } from '../workflows/service/workflowRuntimeService.ts';
import type { ToolDefinition, ToolInvocation } from '../agents/contracts/tools.ts';
import type { DiagnosticSubmissionDossier } from '../business/diagnostic/contracts/dossier.ts';
import type { DiagnosticDossierStore } from '../business/diagnostic/persistence/ports.ts';
import type { WorkflowApprovalRecord } from '../workflows/contracts/approval.ts';
import type { WorkflowDefinition } from '../workflows/contracts/workflow.ts';
import type { ReviewApprovalAuthorityPort } from '../business/diagnostic/persistence/authorityPort.ts';
import {
  DIAGNOSTIC_TOOL_IDS,
  READINESS_MANAGER_AGENT_ID,
  READINESS_REVIEW_WORKFLOW_ID,
  REVIEW_APPROVAL_NODE_ID,
  REVIEW_APPROVER_ROLES,
  computeReadinessAuthority,
  createDiagnosticCapability,
  enforceReadinessFactLock,
  readinessReviewWorkflow,
} from '../business/diagnostic/index.ts';
import { createMemoryDossierStore } from '../business/diagnostic/persistence/memoryStores.ts';
import {
  FACT_LOCK_REPORT,
  REVIEW_BOUNDS,
  diagnosticFailureOf,
  reviewContentSchema,
} from '../business/diagnostic/contracts/review.ts';
import { AUTHORITATIVE_RECOMMENDATION_FIELDS } from '../business/diagnostic/contracts/readiness.ts';
import { isFailure } from '../security/validation.ts';
import { validateWorkflowDefinition } from '../workflows/validation/workflowValidation.ts';
import { committedReviewKeyFor } from '../business/diagnostic/persistence/kvDiagnosticStores.ts';

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

async function driveToPark(
  harness: ReturnType<typeof buildTestDiagnosticRuntime>,
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
  harness: ReturnType<typeof buildTestDiagnosticRuntime>,
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

async function startReview(
  harness: ReturnType<typeof buildTestDiagnosticRuntime>,
  submissionId: string = SUBMISSION.reviewable,
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

/** Start a review, park it, and approve it as a declared reviewer. */
async function approvedReview(
  harness: ReturnType<typeof buildTestDiagnosticRuntime>,
): Promise<{ parked: WorkflowRunDetail; approvalId: string }> {
  const parked = await startReview(harness);
  assert.equal(parked.state, 'waiting_for_approval');
  const approvalId = parked.pendingApproval?.workflowApprovalId as string;
  await harness.workflows.service.decideApproval({
    ...harness.meta(AGENT_TOKEN.reviewer),
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
    correlationId: 'cor_7d',
    idempotencyKey: 'key-1',
    timeoutMs: 5_000,
    nowIso: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ToolInvocation;
}

const NARRATIVE = {
  executiveSummary: 'A summary.',
  evidenceAssessment: 'An assessment.',
  recommendationCommentary: [],
};

/**
 * Recommendation entries no engine produced.
 *
 * Seventeen is the threshold that matters: each invented entry reports one path
 * per authoritative recommendation field, and four fields times seventeen is
 * sixty-eight against a declared ceiling of sixty-four.
 */
function inventedRecommendations(count: number, idPrefix = 'invented'): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    recommendationId: `${idPrefix}-${index}`,
    department: 'Fabricated Department',
    rank: 1,
    priorityScore: 99,
    qualified: true,
    dependencies: ['nothing'],
    note: 'the model made this up',
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// F1. FACT-LOCK PATH OVERFLOW
// ════════════════════════════════════════════════════════════════════════════

describe('part 7d F1 — a model cannot overflow the fact-lock report', () => {
  const authority = computeReadinessAuthority(reviewableDossier);

  it('reports 68 removals from 17 invented entries within the declared bound', () => {
    // THE EXACT SHAPE OF THE FINDING. Before Part 7D this produced 68 entries
    // against a 64-item schema, and the record could not be validated.
    const locked = enforceReadinessFactLock(
      { recommendations: inventedRecommendations(17) },
      authority,
    );

    assert.equal(
      locked.removedCount,
      17 * AUTHORITATIVE_RECOMMENDATION_FIELDS.length,
      'the lock must still act on every invented field',
    );
    assert.ok(
      locked.removedCount > REVIEW_BOUNDS.factLockPaths.max,
      'the fixture must actually exceed the bound, or it proves nothing',
    );
    assert.ok(
      locked.removed.length <= REVIEW_BOUNDS.factLockPaths.max,
      `report of ${locked.removed.length} is above the ceiling`,
    );
  });

  it('keeps the evidence that more paths existed, and says how many', () => {
    const locked = enforceReadinessFactLock(
      { recommendations: inventedRecommendations(20) },
      authority,
    );
    const last = locked.removed[locked.removed.length - 1];
    // NOT A SILENT TRUNCATION. The count that did not fit is on the record.
    assert.match(last, /^\+\d+ more fact-lock paths$/);
    const omitted = Number(/^\+(\d+)/.exec(last)?.[1]);
    assert.equal(
      locked.removed.length - 1 + omitted,
      locked.removedCount,
      'the kept entries plus the reported overflow must account for every path',
    );
  });

  it('is deterministic: the same hostile output summarises identically', () => {
    const first = enforceReadinessFactLock(
      { recommendations: inventedRecommendations(19) },
      authority,
    );
    const second = enforceReadinessFactLock(
      { recommendations: inventedRecommendations(19) },
      authority,
    );
    assert.deepEqual(first.removed, second.removed);
    assert.deepEqual(first.restored, second.restored);
  });

  it('bounds a path built from an absurdly long invented id', () => {
    // The recommendation id is the only unbounded segment of a reported path,
    // and it comes from model output. A 4,000-character id must not produce a
    // 4,000-character path against a 120-character field bound.
    const locked = enforceReadinessFactLock(
      { recommendations: inventedRecommendations(3, 'x'.repeat(4_000)) },
      authority,
    );
    for (const path of locked.removed) {
      assert.ok(
        path.length <= FACT_LOCK_REPORT.maxPathLength,
        `path of ${path.length} characters is above the text bound`,
      );
    }
  });

  it('still removes every invented entry, whatever the count', () => {
    // THE CORRECTION IS NOT WHAT WAS BOUNDED. A lock that reported less AND
    // corrected less would be the defect this fix is supposed to remove.
    const locked = enforceReadinessFactLock(
      { recommendations: inventedRecommendations(24) },
      authority,
    );
    const ids = (locked.content.recommendations as { recommendationId: string }[]).map(
      (entry) => entry.recommendationId,
    );
    assert.deepEqual(
      ids,
      authority.recommendations.map((entry) => entry.recommendationId),
      'the reconciled list must be exactly the authority’s',
    );
    assert.equal(
      ids.some((id) => id.startsWith('invented')),
      false,
      'an invented recommendation survived the lock',
    );
  });

  it('seals a valid record from the worst output the input schema permits', async () => {
    // MALICIOUS OUTPUT → BOUNDED VALID RECORD → NO POISONED DRAFT.
    const capability = createDiagnosticCapability({
      dossiers: createMemoryDossierStore([reviewableDossier]),
      authority: {
        owningWorkflowRun: () => Promise.resolve(undefined),
        approvalsForRun: () => Promise.resolve([]),
      },
      storage: kvStorageFor(),
    });
    const draft = toolFrom(capability.tools, DIAGNOSTIC_TOOL_IDS.draftReview);

    const output = (await draft.execute(
      invocationFor({
        toolId: draft.toolId,
        input: {
          submissionId: SUBMISSION.reviewable,
          narrative: NARRATIVE,
          evidenceSufficient: true,
          contradictions: [],
          // 24 is `proposedRecommendations`' declared maxItems — the most a
          // model can send through the gateway at all.
          proposedRecommendations: inventedRecommendations(24),
        },
      }),
    )) as { contentDigest: string; factLockRemoved: readonly string[] };

    const sealed = await capability.drafts.load('acme', 'agentrun:run_direct');
    assert.ok(sealed, 'the draft must be sealed');

    // The RECORD satisfies its own schema — which is what the workflow run
    // depends on, and what failed before Part 7D.
    const validated = reviewContentSchema.validate(sealed.content, 'sealed');
    assert.equal(isFailure(validated), false, 'the sealed record must be representable');
    assert.ok(sealed.content.factLockRemoved.length <= REVIEW_BOUNDS.factLockPaths.max);
    assert.equal(output.contentDigest, sealed.contentDigest);
  });

  it('seals nothing when the assembled record is not representable, and a clean retry works', async () => {
    // THE ORDERING PROOF. A dossier source that answers with a submission id no
    // record could carry makes the assembled content invalid; the tool must
    // refuse BEFORE it seals, because a sealed draft cannot be replaced and the
    // scope would be spent on a record nobody can validate.
    let corrupt = true;
    const dossiers: DiagnosticDossierStore = {
      load: (organizationId, submissionId) =>
        Promise.resolve(
          organizationId === 'acme' && submissionId === SUBMISSION.reviewable
            ? ({
                ...reviewableDossier,
                // Longer than `submissionId: str({ maxLength: 64 })` permits.
                ...(corrupt ? { submissionId: 's'.repeat(200) } : {}),
              } as DiagnosticSubmissionDossier)
            : undefined,
        ),
    };

    const kv = createFakeKv();
    const capability = createDiagnosticCapability({
      dossiers,
      authority: {
        owningWorkflowRun: () => Promise.resolve(undefined),
        approvalsForRun: () => Promise.resolve([]),
      },
      storage: kvStorageFor(kv),
    });
    const draft = toolFrom(capability.tools, DIAGNOSTIC_TOOL_IDS.draftReview);

    const error = await rejection(
      Promise.resolve(
        draft.execute(
          invocationFor({
            toolId: draft.toolId,
            input: {
              submissionId: SUBMISSION.reviewable,
              narrative: NARRATIVE,
              evidenceSufficient: true,
              contradictions: [],
            },
          }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_record_invalid');

    // NOTHING WAS WRITTEN. Not a draft, not anything.
    assert.deepEqual(kv.keys(), [], 'a refused draft must leave no durable trace');
    assert.equal(await capability.drafts.load('acme', 'agentrun:run_direct'), undefined);

    // AND A CLEAN RETRY SEALS. The scope was not spent by the refusal, which is
    // the whole reason the check runs before the write.
    corrupt = false;
    const output = (await draft.execute(
      invocationFor({
        toolId: draft.toolId,
        input: {
          submissionId: SUBMISSION.reviewable,
          narrative: NARRATIVE,
          evidenceSufficient: true,
          contradictions: [],
        },
      }),
    )) as { contentDigest: string; sealed: string };
    assert.equal(output.sealed, 'yes');
    const sealed = await capability.drafts.load('acme', 'agentrun:run_direct');
    assert.equal(sealed?.contentDigest, output.contentDigest);
  });

  it('completes a real run whose model invented eighteen recommendations', async () => {
    // THE SAME DEFECT, THROUGH THE WHOLE PATH: agent, gateway, tool, seal,
    // node output contract, barrier. Before Part 7D the run failed after the
    // draft was already sealed, leaving a scope that could never be re-drafted.
    const harness = buildTestDiagnosticRuntime({ idSeed: 'f1run' });
    const parked = await startReview(harness);
    assert.equal(parked.state, 'waiting_for_approval');
    const sealed = await harness.capability.drafts.load('acme', parked.workflowRunId);
    assert.ok(sealed);
    assert.equal(
      isFailure(reviewContentSchema.validate(sealed.content, 'sealed')),
      false,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F2. DURABLE COMMITTED REVIEW PERSISTENCE
// ════════════════════════════════════════════════════════════════════════════

describe('part 7d F2 — the committed review is durable and written once', () => {
  it('refuses to assemble the capability without durable storage', () => {
    const options = {
      dossiers: createMemoryDossierStore([reviewableDossier]),
      authority: {
        owningWorkflowRun: () => Promise.resolve(undefined),
        approvalsForRun: () => Promise.resolve([]),
      },
    };
    // FAIL CLOSED. Before Part 7D this call succeeded and quietly produced an
    // evicting isolate-local committed-review store.
    assert.throws(
      () => createDiagnosticCapability(options as never),
      /durable key-value storage/,
    );
    assert.throws(
      () =>
        createDiagnosticCapability({
          ...options,
          storage: { read: () => Promise.resolve(undefined) },
        } as never),
      /durable key-value storage/,
    );
  });

  it('keeps the committed review across a restart, and refuses the replay', async () => {
    const kv = createFakeKv();
    const harness = buildTestDiagnosticRuntime({ idSeed: 'f2restart', kv });
    const { parked, approvalId } = await approvedReview(harness);
    const finished = await driveToEnd(harness, parked);
    assert.equal(finished.state, 'completed');

    const before = await harness.capability.commits.loadByApproval('acme', approvalId);
    assert.ok(before, 'the commit must exist');

    // A SECOND ISOLATE. New capability, new stores, new runtime — the same
    // rows. Before Part 7D the store was a Map that died with the isolate.
    const restarted = buildTestDiagnosticRuntime({
      idSeed: 'f2restart',
      kv,
      runStore: harness.runStore,
      checkpointStore: harness.checkpointStore,
      approvalStore: harness.approvalStore,
    });
    assert.notEqual(
      restarted.capability.commits,
      harness.capability.commits,
      'the restart must build new store objects, or it proves nothing',
    );

    const after = await restarted.capability.commits.loadByApproval('acme', approvalId);
    assert.ok(after, 'the committed review must survive the restart');
    assert.equal(after.contentDigest, before.contentDigest);
    assert.deepEqual(after.content, before.content);

    // AND THE REPLAY WINDOW IS STILL CLOSED. This is the half that matters:
    // the row is what the commit tool reads to refuse a second commit, so a
    // lost row is a spent approval that can be spent again.
    //
    // Driven over a port that reports the run as still live and hands back the
    // REAL approval record — the strongest form of the replay: everything the
    // commit checks is genuine, and the only thing standing in the way is the
    // durable row the restart was supposed to lose.
    const storedApproval = await harness.approvalStore.load('acme', approvalId);
    assert.ok(storedApproval);
    const afterRestart = createDiagnosticCapability({
      dossiers: createMemoryDossierStore([...DIAGNOSTIC_DOSSIERS]),
      authority: hostilePort([storedApproval], parked.workflowRunId),
      storage: kvStorageFor(kv),
    });
    const commit = toolFrom(afterRestart.tools, DIAGNOSTIC_TOOL_IDS.commitReview);
    const error = await rejection(
      Promise.resolve(
        commit.execute(
          invocationFor({
            toolId: commit.toolId,
            runId: parked.childAgentRunIds[0],
            input: { contentDigest: before.contentDigest },
          }),
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_already_spent');
  });

  it('resolves two concurrent commits into exactly one durable record', async () => {
    const kv = createFakeKv();
    const capability = createDiagnosticCapability({
      dossiers: createMemoryDossierStore([reviewableDossier]),
      authority: hostilePort([grantedApproval()], 'wfr_conc'),
      storage: kvStorageFor(kv),
    });
    const draft = toolFrom(capability.tools, DIAGNOSTIC_TOOL_IDS.draftReview);
    const commit = toolFrom(capability.tools, DIAGNOSTIC_TOOL_IDS.commitReview);

    const sealedOutput = (await draft.execute(
      invocationFor({
        toolId: draft.toolId,
        input: {
          submissionId: SUBMISSION.reviewable,
          narrative: NARRATIVE,
          evidenceSufficient: true,
          contradictions: [],
        },
      }),
    )) as { contentDigest: string };

    // The approval must name the sealed draft — F3's check runs before this
    // one, and a fixture that skipped it would be testing that instead.
    const approval = grantedApproval({
      subjectEvidence: {
        subjectId: SUBMISSION.reviewable,
        contentDigest: sealedOutput.contentDigest,
      },
    });
    const racing = createDiagnosticCapability({
      dossiers: createMemoryDossierStore([reviewableDossier]),
      authority: hostilePort([approval], 'wfr_conc'),
      storage: kvStorageFor(kv),
    });
    const racingCommit = toolFrom(racing.tools, DIAGNOSTIC_TOOL_IDS.commitReview);
    void commit;

    const results = await Promise.allSettled([
      racingCommit.execute(
        invocationFor({ toolId: racingCommit.toolId, input: { contentDigest: sealedOutput.contentDigest } }),
      ),
      racingCommit.execute(
        invocationFor({
          toolId: racingCommit.toolId,
          idempotencyKey: 'key-2',
          input: { contentDigest: sealedOutput.contentDigest },
        }),
      ),
    ]);

    assert.equal(
      results.filter((entry) => entry.status === 'fulfilled').length,
      1,
      'exactly one commit may win the conditional write',
    );
    // ONE DURABLE ROW, counted in storage rather than through the port that
    // wrote it. The loser lost the compare-and-swap, not a Map lookup.
    const rows = kv.keys().filter((key) => key.includes(':ai:diagnostic_review:'));
    assert.equal(rows.length, 1, 'one approval must carry one committed review');
    assert.equal(
      (await racing.commits.listByRun('acme', 'wfr_conc')).length,
      1,
    );
  });

  it('keys every durable record by tenant, and never answers across one', async () => {
    const kv = createFakeKv();
    const acme = createDiagnosticCapability({
      dossiers: createMemoryDossierStore([reviewableDossier]),
      authority: hostilePort([], 'wfr_tenant'),
      storage: kvStorageFor(kv),
    });
    const globex = createDiagnosticCapability({
      dossiers: createMemoryDossierStore([
        { ...reviewableDossier, organizationId: 'globex' },
      ]),
      authority: hostilePort([], 'wfr_tenant'),
      storage: kvStorageFor(kv),
    });

    const acmeDraft = toolFrom(acme.tools, DIAGNOSTIC_TOOL_IDS.draftReview);
    const globexDraft = toolFrom(globex.tools, DIAGNOSTIC_TOOL_IDS.draftReview);
    const input = {
      submissionId: SUBMISSION.reviewable,
      narrative: NARRATIVE,
      evidenceSufficient: true,
      contradictions: [],
    };

    await acmeDraft.execute(invocationFor({ toolId: acmeDraft.toolId, input }));
    await globexDraft.execute(
      invocationFor({ toolId: globexDraft.toolId, organizationId: 'globex', input }),
    );

    // TWO ROWS UNDER ONE SCOPE NAME. The scope id is identical; the KEY is not,
    // because it cannot be formed without its organization.
    const draftRows = kv.keys().filter((key) => key.includes(':ai:diagnostic_draft:'));
    assert.equal(draftRows.length, 2);
    const acmeRow = await acme.drafts.load('acme', 'wfr_tenant');
    const globexRow = await acme.drafts.load('globex', 'wfr_tenant');
    assert.ok(acmeRow, 'acme’s row must resolve under its own tenant');
    assert.ok(globexRow, 'globex’s row must resolve under its own tenant');
    assert.equal(acmeRow?.organizationId, 'acme');
    assert.equal(globexRow?.organizationId, 'globex');
    assert.notEqual(acmeRow?.contentDigest, globexRow?.contentDigest);

    // And a commit written for one tenant is invisible to the other's key.
    assert.equal(
      committedReviewKeyFor('acme', 'wfa:x').startsWith(
        committedReviewKeyFor('globex', 'wfa:x').slice(0, 8),
      ),
      false,
      'two tenants must not share a committed-review key prefix',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F3. SELF-DESCRIBING HUMAN APPROVAL
// ════════════════════════════════════════════════════════════════════════════

/** A granted approval as the engine would have written it, for a hostile port. */
function grantedApproval(
  overrides: Partial<WorkflowApprovalRecord> = {},
): WorkflowApprovalRecord {
  return {
    workflowApprovalId: 'wfa:wfr_conc:n_publish_approval:main:2',
    workflowRunId: 'wfr_conc',
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

function hostilePort(
  approvals: readonly WorkflowApprovalRecord[],
  workflowRunId: string,
  organizationId = 'acme',
): ReviewApprovalAuthorityPort {
  return {
    owningWorkflowRun: () =>
      Promise.resolve({
        workflowRunId,
        workflowId: READINESS_REVIEW_WORKFLOW_ID,
        organizationId,
        actorId: 'user-consultant',
        state: 'running',
      }),
    approvalsForRun: () => Promise.resolve(approvals),
  };
}

describe('part 7d F3 — the approval says what it is about', () => {
  it('carries the submission and the sealed digest on the record a person reads', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'f3queue' });
    const parked = await startReview(harness);
    assert.equal(parked.state, 'waiting_for_approval');

    const sealed = await harness.capability.drafts.load('acme', parked.workflowRunId);
    assert.ok(sealed);

    // THE QUEUE READ MODEL, through the service a console would call. Before
    // Part 7D this view named a run and a node and nothing about the subject.
    const queue = await harness.workflows.service.listApprovals({
      ...harness.meta(AGENT_TOKEN.reviewer),
    });
    const entry = queue.find(
      (record) => record.workflowApprovalId === parked.pendingApproval?.workflowApprovalId,
    );
    assert.ok(entry, 'the approval must be in the reviewer’s queue');
    assert.ok(entry.subjectEvidence, 'the queue entry must say what it is about');
    assert.equal(entry.subjectEvidence.subjectId, SUBMISSION.reviewable);
    assert.equal(entry.subjectEvidence.contentDigest, sealed.contentDigest);

    // A HUMAN CAN ANSWER "WHAT AM I APPROVING" FROM THIS ENTRY ALONE — the
    // submission by name and the sealed content by digest, without reading the
    // run record, the checkpoint chain or the draft store.
    assert.equal(entry.nodeId, REVIEW_APPROVAL_NODE_ID);
    assert.equal(entry.workflowRunId, parked.workflowRunId);
  });

  it('binds the evidence before the request, and commits exactly what was approved', async () => {
    const harness = buildTestDiagnosticRuntime({ idSeed: 'f3commit' });
    const { parked, approvalId } = await approvedReview(harness);

    const approval = await harness.approvalStore.load('acme', approvalId);
    assert.ok(approval?.subjectEvidence);
    const finished = await driveToEnd(harness, parked);
    assert.equal(finished.state, 'completed');

    const committed = await harness.capability.commits.loadByApproval('acme', approvalId);
    assert.ok(committed);
    // APPROVED DIGEST == COMMITTED DIGEST, proved against the approval record
    // itself rather than against the caller's claim.
    assert.equal(committed.contentDigest, approval.subjectEvidence.contentDigest);
    assert.equal(committed.submissionId, approval.subjectEvidence.subjectId);

    const sealed = await harness.capability.drafts.load('acme', parked.workflowRunId);
    assert.equal(committed.contentDigest, sealed?.contentDigest);
    assert.deepEqual(committed.content, sealed?.content);
  });

  it('refuses an approval that names a different digest', async () => {
    const { commit, digest } = await sealedFixture();
    const error = await rejection(
      Promise.resolve(
        commit(
          grantedApproval({
            subjectEvidence: { subjectId: SUBMISSION.reviewable, contentDigest: 'f'.repeat(64) },
          }),
          digest,
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_evidence_mismatch');
  });

  it('refuses an approval that names a different submission', async () => {
    const { commit, digest } = await sealedFixture();
    const error = await rejection(
      Promise.resolve(
        commit(
          grantedApproval({
            subjectEvidence: { subjectId: SUBMISSION.thin, contentDigest: digest },
          }),
          digest,
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_evidence_mismatch');
  });

  it('refuses an approval that names no subject at all', async () => {
    // A record from before this field existed, or a definition that stopped
    // declaring one. Neither is a person deciding about specific content.
    const { commit, digest } = await sealedFixture();
    const error = await rejection(
      Promise.resolve(Promise.resolve(commit(grantedApproval(), digest))),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_evidence_mismatch');
  });

  it('refuses evidence lifted from another run’s sealed draft', async () => {
    // CROSS-RUN SUBSTITUTION. The approval is well formed and its evidence is a
    // real digest of a real sealed draft — another run's. The commit compares
    // against the draft in ITS OWN scope, so the substitution fails.
    const harness = buildTestDiagnosticRuntime({ idSeed: 'f3crossrun' });
    const other = await startReview(harness, SUBMISSION.hostile);
    const otherDraft = await harness.capability.drafts.load('acme', other.workflowRunId);
    assert.ok(otherDraft);

    const { commit, digest } = await sealedFixture();
    assert.notEqual(otherDraft.contentDigest, digest);
    const error = await rejection(
      Promise.resolve(
        commit(
          grantedApproval({
            subjectEvidence: {
              subjectId: otherDraft.submissionId,
              contentDigest: otherDraft.contentDigest,
            },
          }),
          digest,
        ),
      ),
    );
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_evidence_mismatch');
  });

  it('refuses an approval belonging to another tenant, evidence and all', async () => {
    const { commitFor, digest } = await sealedFixture();
    const tool = commitFor(
      hostilePort(
        [
          grantedApproval({
            organizationId: 'globex',
            subjectEvidence: { subjectId: SUBMISSION.reviewable, contentDigest: digest },
          }),
        ],
        'wfr_conc',
      ),
    );
    const error = await rejection(
      Promise.resolve(
        tool.execute(invocationFor({ toolId: tool.toolId, input: { contentDigest: digest } })),
      ),
    );
    // REFUSED BEFORE THE EVIDENCE IS REACHED, and that is the correct order: the
    // approval is filtered out by tenant while the node's approvals are being
    // selected, so this run carries no approval for the commit barrier at all.
    // Perfect evidence on another tenant's record buys nothing.
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_wrong_node');
  });

  it('refuses a replayed commit even with correct evidence', async () => {
    const { capability, commit, digest, approval } = await sealedFixture();
    await commit(approval, digest);
    assert.ok(await capability.commits.loadByApproval('acme', approval.workflowApprovalId));

    const error = await rejection(Promise.resolve(commit(approval, digest)));
    assert.equal(diagnosticFailureOf(error), 'diagnostic_approval_already_spent');
    assert.equal((await capability.commits.listByRun('acme', 'wfr_conc')).length, 1);
  });

  it('refuses a definition whose evidence comes from anywhere but a node output', () => {
    // THE GRAMMAR IS THE GUARANTEE. A caller's payload and a constant are the
    // two an author would reach for, and both are refused at registration.
    const withEvidence = (subjectId: unknown): WorkflowDefinition => ({
      ...readinessReviewWorkflow,
      nodes: readinessReviewWorkflow.nodes.map((node) =>
        node.nodeId === REVIEW_APPROVAL_NODE_ID
          ? ({
              ...node,
              subjectEvidence: {
                subjectId,
                contentDigest: {
                  source: 'node',
                  nodeId: 'n_review',
                  path: 'contentDigest',
                },
              },
            } as never)
          : node,
      ),
    });

    for (const [label, ref] of [
      ['input', { source: 'input', path: 'submissionId' }],
      ['literal', { source: 'literal', value: 'sub-reviewable' }],
      ['metadata', { source: 'metadata', field: 'organizationId' }],
      ['unknown node', { source: 'node', nodeId: 'n_nowhere', path: 'submissionId' }],
    ] as const) {
      const problems = validateWorkflowDefinition(withEvidence(ref));
      assert.ok(
        problems.some((problem) => /subjectEvidence\.subjectId/.test(problem)),
        `${label} evidence must be refused: ${problems.join('; ') || 'no problems reported'}`,
      );
    }

    // And the shipped definition, which reads two trusted node outputs, is
    // accepted — a validation rule that refused the real workflow would be a
    // rule nobody could satisfy.
    assert.deepEqual(
      validateWorkflowDefinition(readinessReviewWorkflow).filter((problem) =>
        /subjectEvidence/.test(problem),
      ),
      [],
    );
  });
});

/**
 * A capability with a sealed draft and a commit tool over a hostile port.
 *
 * The port is where a commit learns what it was approved for, so handing it
 * records a real engine would never write is the sharpest way to ask whether
 * the evidence check is a check.
 */
async function sealedFixture(): Promise<{
  capability: ReturnType<typeof createDiagnosticCapability>;
  digest: string;
  approval: WorkflowApprovalRecord;
  commit: (approval: WorkflowApprovalRecord, contentDigest: string) => Promise<unknown>;
  commitFor: (authority: ReviewApprovalAuthorityPort) => ToolDefinition;
}> {
  const kv = createFakeKv();
  const dossiers = createMemoryDossierStore([...DIAGNOSTIC_DOSSIERS]);
  const build = (authority: ReviewApprovalAuthorityPort) =>
    createDiagnosticCapability({ dossiers, authority, storage: kvStorageFor(kv) });

  const capability = build(hostilePort([], 'wfr_conc'));
  const draft = toolFrom(capability.tools, DIAGNOSTIC_TOOL_IDS.draftReview);
  const output = (await draft.execute(
    invocationFor({
      toolId: draft.toolId,
      input: {
        submissionId: SUBMISSION.reviewable,
        narrative: NARRATIVE,
        evidenceSufficient: true,
        contradictions: [],
      },
    }),
  )) as { contentDigest: string };

  // The draft is sealed under the OWNING RUN's scope, so a commit for that run
  // finds it. `reviewScopeFor` uses the workflow run id the port reports.
  const digest = output.contentDigest;
  const approval = grantedApproval({
    subjectEvidence: { subjectId: SUBMISSION.reviewable, contentDigest: digest },
  });

  return {
    capability,
    digest,
    approval,
    commitFor: (authority) =>
      toolFrom(build(authority).tools, DIAGNOSTIC_TOOL_IDS.commitReview),
    commit: async (record, contentDigest) => {
      const tool = toolFrom(
        build(hostilePort([record], 'wfr_conc')).tools,
        DIAGNOSTIC_TOOL_IDS.commitReview,
      );
      return await tool.execute(
        invocationFor({ toolId: tool.toolId, input: { contentDigest } }),
      );
    },
  };
}
