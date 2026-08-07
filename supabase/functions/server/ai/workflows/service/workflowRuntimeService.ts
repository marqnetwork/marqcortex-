/**
 * Workflow Runtime Service (AI-01 Batch 3B, Part 2).
 *
 * The API-facing layer: authenticate, resolve the actor and the tenant, enforce
 * the capability, call the engine, and return a read model that contains
 * nothing a caller should not see.
 *
 * THREE THINGS THIS LAYER OWNS AND THE ENGINE DOES NOT.
 *
 *   IDENTITY. The engine takes an actor; this is where an actor comes from.
 *   Roles, capabilities and the organization are resolved from the
 *   authenticated subject through the same authenticator port the AI Guard and
 *   the agent runtime use — there is no second credential path and nothing a
 *   caller sends influences the outcome. Both vocabularies are resolved here,
 *   from one subject, so a workflow can never execute an agent its operator may
 *   not (see `workflowRbac.ts`).
 *
 *   READ MODELS. A run record carries the validated input and every child agent
 *   run id. What leaves this layer is a projection: the input never does, and
 *   the child run ids do — they are the join key an operator needs to open the
 *   agent runtime's own view of what actually happened.
 *
 *   TENANT SCOPE ON EVERY READ. Every store call is keyed by the resolved
 *   organization. Only a platform reader may name another, and only for reads —
 *   there is no cross-tenant control operation at any role.
 *
 * WHAT IS DELIBERATELY NOT HERE: any way to create, edit or register a
 * workflow. Definitions are registry-time decisions made in code and reviewed
 * as code, exactly as agents are. An API that could define a workflow would be
 * the whole of Part 1's validation arriving through the back door.
 */

import type { AIAuthenticator } from '../../security/actor.ts';
import type { OrganizationResolutionOptions } from '../../security/tenancy.ts';
import type { WorkflowDescriptor } from '../contracts/workflow.ts';
import type { WorkflowPlan } from '../contracts/plan.ts';
import type {
  WorkflowRunOrigin,
  WorkflowRunRecord,
  WorkflowRunState,
  WorkflowStepRecord,
} from '../contracts/run.ts';
import type {
  WorkflowBranchState,
  WorkflowParallelGroup,
} from '../contracts/parallel.ts';
import type {
  WorkflowApprovalDecision,
  WorkflowApprovalRecord,
  WorkflowApprovalState,
  WorkflowPendingApproval,
  WorkflowRejectionPolicy,
} from '../contracts/approval.ts';
import type { WorkflowNodeAttempt } from '../contracts/retry.ts';
import type { UsageLedger } from '../../optimization/contracts/usage.ts';
import { emptyUsageLedger } from '../../optimization/contracts/usage.ts';
import { branchUsage, groupUsage, runUsage } from '../runtime/usageAttribution.ts';
import type { WorkflowApprovalGate } from '../approvals/workflowApprovalGate.ts';
import type { WorkflowRegistry } from '../registry/workflowRegistry.ts';
import type { WorkflowRunStore } from '../persistence/ports.ts';
import type {
  WorkflowOrchestrator,
  WorkflowRunActor,
} from '../engine/workflowOrchestrator.ts';
import type { WorkflowRuntimeActor, WorkflowRuntimeCapability } from './workflowRbac.ts';
import {
  requireWorkflowCapability,
  resolveWorkflowActor,
  workflowReadScopeFor,
} from './workflowRbac.ts';
import { ACTIVE_WORKFLOW_STATES } from '../runtime/workflowStateMachine.ts';
import { WORKFLOW_RUN_STATES } from '../contracts/run.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { adoptOrCreateId } from '../../contracts/ids.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Clock } from '../../runtime/clock.ts';

// ── Read models ─────────────────────────────────────────────────────────────

export interface WorkflowRunSummary {
  readonly workflowRunId: string;
  readonly organizationId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly planDigest: string;
  readonly state: WorkflowRunState;
  readonly currentNodeId?: string;
  readonly stepCount: number;
  readonly runVersion: number;
  readonly actorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deadlineAt: string;
  readonly elapsedRuntimeMs: number;
  readonly failure?: string;
  readonly failureMessage?: string;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  readonly correlationId: string;
  readonly configurationVersion: number;
  readonly checkpointVersion: number;
  readonly inputDigest: string;
  readonly resultDigest?: string;
  /** The join key into the agent runtime's own read models. */
  readonly childAgentRunIds: readonly string[];
  readonly pendingNode?: WorkflowRunRecord['pendingNode'];
  /** The decision this run is parked on, if it is parked on one (Part 5). */
  readonly pendingApproval?: WorkflowPendingApproval;
  /**
   * Attempt state per node, per line of execution (Part 5).
   *
   * Passed through whole: every field is a count, a bound, a classification or
   * a timestamp the platform itself produced, and none of it is tenant content.
   * This is what lets a console answer "why has this run not moved" — which is
   * usually "it is waiting ninety seconds for attempt three" — without a second
   * request.
   */
  readonly retries: readonly WorkflowNodeAttempt[];
  /**
   * What this run has actually spent (AI-01 Batch 3B, Part 6A).
   *
   * Measured, never estimated: these are provider-reported figures the agent
   * runtime reconciled onto its own child runs and this run's ledger rolled up
   * through the single accounting port. Retries are included — money spent on an
   * attempt that failed is money spent, and a console that showed only the
   * successful attempt would disagree with the invoice.
   */
  readonly actualInputTokens: number;
  readonly actualOutputTokens: number;
  readonly actualTotalTokens: number;
  readonly actualCostMicroUsd: number;
  /** Every parallel step, open and closed, without any branch's outputs. */
  readonly parallelGroups: readonly WorkflowParallelGroupView[];
  readonly steps: readonly WorkflowStepRecord[];
  readonly transitions: WorkflowRunRecord['transitions'];
  readonly transitionsTruncated: number;
  readonly startedAt?: string;
  readonly endedAt?: string;
}

/**
 * A parallel group as an operator may see it (AI-01 Batch 3B, Part 4).
 *
 * Branch OUTPUTS are absent, exactly as the run's `input` is: they are the
 * tenant's business data, they are what the merge contract judged, and a read
 * model that echoed them would make every console and screenshot a copy of
 * them. What is here is what an operator needs to answer "where is this run
 * stuck" — which branch, which cursor, which child agent run, and a digest to
 * compare against.
 */
export interface WorkflowBranchView {
  readonly branchId: string;
  readonly branchName: string;
  readonly ordinal: number;
  readonly state: WorkflowBranchState;
  readonly cursorNodeId?: string;
  readonly stepCount: number;
  readonly branchVersion: number;
  /** The join key into the agent runtime's own read models. */
  readonly childAgentRunIds: readonly string[];
  readonly pendingAgentRunId?: string;
  readonly resultDigest?: string;
  readonly failure?: string;
  /** The decision this branch is parked on, if any (Part 5). */
  readonly pendingApproval?: WorkflowPendingApproval;
  /**
   * What this branch's child agent runs actually spent (Part 6A).
   *
   * DERIVED from the run's usage ledger by filtering on `branchId`, not read
   * from a counter on the branch record — there is no such counter, deliberately,
   * because a second accumulator is a second thing that can disagree with the
   * first. It replaces the `tokensPlaceholder` / `costMicroUsdPlaceholder`
   * zeroes Parts 4 and 5 carried.
   */
  readonly actualTokens: number;
  readonly actualCostMicroUsd: number;
}

export interface WorkflowParallelGroupView {
  readonly groupId: string;
  readonly parallelNodeId: string;
  readonly joinNodeId: string;
  readonly joinPolicy: WorkflowParallelGroup['joinPolicy'];
  readonly failurePolicy: WorkflowParallelGroup['failurePolicy'];
  readonly state: WorkflowParallelGroup['state'];
  readonly joinedAt?: string;
  readonly joinDigest?: string;
  readonly groupVersion: number;
  /** The group's total spend. Derived from the ledger, never stored twice. */
  readonly actualTokens: number;
  readonly actualCostMicroUsd: number;
  readonly branches: readonly WorkflowBranchView[];
}

export function toWorkflowParallelGroupView(
  group: WorkflowParallelGroup,
  ledger: UsageLedger,
): WorkflowParallelGroupView {
  const group_ = groupUsage(ledger, group.groupId);
  return {
    actualTokens: group_.actualTotalTokens,
    actualCostMicroUsd: group_.actualCostMicroUsd,
    groupId: group.groupId,
    parallelNodeId: group.parallelNodeId,
    joinNodeId: group.joinNodeId,
    joinPolicy: group.joinPolicy,
    failurePolicy: group.failurePolicy,
    state: group.state,
    ...(group.joinedAt === undefined ? {} : { joinedAt: group.joinedAt }),
    ...(group.joinDigest === undefined ? {} : { joinDigest: group.joinDigest }),
    groupVersion: group.groupVersion,
    branches: group.branches.map((branch) => ({
      actualTokens: branchUsage(ledger, branch.branchId).actualTotalTokens,
      actualCostMicroUsd: branchUsage(ledger, branch.branchId).actualCostMicroUsd,
      branchId: branch.branchId,
      branchName: branch.branchName,
      ordinal: branch.ordinal,
      state: branch.state,
      ...(branch.cursorNodeId === undefined ? {} : { cursorNodeId: branch.cursorNodeId }),
      stepCount: branch.stepCount,
      branchVersion: branch.branchVersion,
      childAgentRunIds: branch.childAgentRunIds,
      ...(branch.pendingNode === undefined
        ? {}
        : { pendingAgentRunId: branch.pendingNode.agentRunId }),
      ...(branch.resultDigest === undefined ? {} : { resultDigest: branch.resultDigest }),
      ...(branch.failure === undefined ? {} : { failure: branch.failure }),
      ...(branch.pendingApproval === undefined
        ? {}
        : { pendingApproval: branch.pendingApproval }),
    })),
  };
}

/**
 * An approval as a decider may see it (AI-01 Batch 3B, Part 5).
 *
 * NOTHING IS REMOVED, because there was nothing to remove. Look at what the
 * record holds: identifiers, the definition-authored `reason` and
 * `impactSummary`, declared estimates, roles, versions and timestamps. There is
 * no node input, no node output, no merged value and no agent observation on a
 * `WorkflowApprovalRecord`, and there is no field for one — see
 * `contracts/approval.ts`.
 *
 * That is the design doing the work rather than this projection: an approval is
 * read by whoever holds the approver role, which is a WIDER audience than the
 * run itself, so the way to keep a tenant's business content off it is not to
 * filter it here but never to put it there. A read model that had to strip
 * fields would be one field away from forgetting to.
 *
 * The projection exists anyway, for the reason the run projections exist: the
 * stored shape is free to gain an internal field, and a view that spreads the
 * record would export it the day it appeared.
 */
export interface WorkflowApprovalView {
  readonly workflowApprovalId: string;
  readonly workflowRunId: string;
  readonly organizationId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly branchId?: string;
  readonly branchName?: string;
  readonly requestedBy: string;
  readonly reason: string;
  readonly impactSummary: string;
  /** Placeholder. Always the declared figure, or zero. */
  readonly estimatedAdditionalTokens: number;
  /** Placeholder. Always the declared figure, or zero. */
  readonly estimatedAdditionalCostMicroUsd: number;
  readonly authorizedRoles: readonly string[];
  readonly checkpointVersion: number;
  readonly workflowRunVersion: number;
  readonly branchVersion?: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decision?: WorkflowApprovalDecision;
  readonly decisionReason?: string;
  readonly consumedAt?: string;
  readonly singleUse: true;
  readonly approvalState: WorkflowApprovalState;
  readonly onRejection: WorkflowRejectionPolicy;
  readonly approvalVersion: number;
  readonly closureReason?: string;
}

export function toWorkflowApprovalView(
  record: WorkflowApprovalRecord,
): WorkflowApprovalView {
  return {
    workflowApprovalId: record.workflowApprovalId,
    workflowRunId: record.workflowRunId,
    organizationId: record.organizationId,
    workflowId: record.workflowId,
    nodeId: record.nodeId,
    ...(record.branchId === undefined ? {} : { branchId: record.branchId }),
    ...(record.branchName === undefined ? {} : { branchName: record.branchName }),
    requestedBy: record.requestedBy,
    reason: record.reason,
    impactSummary: record.impactSummary,
    estimatedAdditionalTokens: record.estimatedAdditionalTokens,
    estimatedAdditionalCostMicroUsd: record.estimatedAdditionalCostMicroUsd,
    authorizedRoles: record.authorizedRoles,
    checkpointVersion: record.checkpointVersion,
    workflowRunVersion: record.workflowRunVersion,
    ...(record.branchVersion === undefined ? {} : { branchVersion: record.branchVersion }),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.decidedAt === undefined ? {} : { decidedAt: record.decidedAt }),
    ...(record.decidedBy === undefined ? {} : { decidedBy: record.decidedBy }),
    ...(record.decision === undefined ? {} : { decision: record.decision }),
    ...(record.decisionReason === undefined ? {} : { decisionReason: record.decisionReason }),
    ...(record.consumedAt === undefined ? {} : { consumedAt: record.consumedAt }),
    singleUse: record.singleUse,
    approvalState: record.approvalState,
    onRejection: record.onRejection,
    approvalVersion: record.approvalVersion,
    ...(record.closureReason === undefined ? {} : { closureReason: record.closureReason }),
  };
}

/** The operator overview. Counts and a bounded window, never every run. */
export interface WorkflowRuntimeOverview {
  readonly scope: 'organization' | 'platform';
  readonly organizationId: string;
  readonly counts: Readonly<Record<WorkflowRunState, number>>;
  readonly active: readonly WorkflowRunSummary[];
  readonly recentFailures: readonly WorkflowRunSummary[];
  readonly registeredWorkflows: number;
  /** Requests waiting on a person in this organization (Part 5). */
  readonly pendingApprovals: number;
  readonly capabilities: readonly WorkflowRuntimeCapability[];
  readonly generatedAt: string;
}

// ── Projections ─────────────────────────────────────────────────────────────

export function toWorkflowRunSummary(record: WorkflowRunRecord): WorkflowRunSummary {
  return {
    workflowRunId: record.context.workflowRunId,
    organizationId: record.context.organizationId,
    workflowId: record.context.workflowId,
    workflowVersion: record.context.workflowVersion,
    planDigest: record.context.planDigest,
    state: record.state,
    ...(record.currentNodeId === undefined ? {} : { currentNodeId: record.currentNodeId }),
    stepCount: record.stepCount,
    runVersion: record.runVersion,
    actorId: record.context.actorId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deadlineAt: record.deadlineAt,
    elapsedRuntimeMs: record.elapsedRuntimeMs,
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    ...(record.failureMessage === undefined ? {} : { failureMessage: record.failureMessage }),
  };
}

/**
 * The detail view.
 *
 * `input` is absent, and its absence is the whole design of this function: the
 * record holds the caller's validated business data so nodes can be re-handed
 * it after a restart, and a read model that echoed it back would make every
 * console, log and screenshot a copy of that data.
 */
/**
 * The run's usage ledger, or an empty one.
 *
 * Records written before AI-01 Batch 3B Part 6A carry no ledger at all. An
 * empty one reports zeroes, which is the only honest projection available — and
 * the reason `runUsage` documents that a reader must treat it as "not measured"
 * rather than as "measured zero".
 */
function ledgerOf(record: WorkflowRunRecord): UsageLedger {
  return record.usage ?? emptyUsageLedger(record.context.organizationId);
}

export function toWorkflowRunDetail(record: WorkflowRunRecord): WorkflowRunDetail {
  const spent = runUsage(ledgerOf(record));
  return {
    ...toWorkflowRunSummary(record),
    actualInputTokens: spent.actualInputTokens,
    actualOutputTokens: spent.actualOutputTokens,
    actualTotalTokens: spent.actualTotalTokens,
    actualCostMicroUsd: spent.actualCostMicroUsd,
    correlationId: record.context.correlationId,
    configurationVersion: record.configurationVersion,
    checkpointVersion: record.checkpointVersion,
    inputDigest: record.inputDigest,
    ...(record.resultDigest === undefined ? {} : { resultDigest: record.resultDigest }),
    childAgentRunIds: record.childAgentRunIds,
    ...(record.pendingNode === undefined ? {} : { pendingNode: record.pendingNode }),
    ...(record.pendingApproval === undefined
      ? {}
      : { pendingApproval: record.pendingApproval }),
    retries: record.retries ?? [],
    parallelGroups: (record.parallelGroups ?? []).map((group) =>
      toWorkflowParallelGroupView(group, ledgerOf(record)),
    ),
    steps: record.steps,
    transitions: record.transitions,
    transitionsTruncated: record.transitionsTruncated,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
  };
}

// ── Requests ────────────────────────────────────────────────────────────────

/** What every request carries. Nothing here confers authority. */
export interface WorkflowRequestMeta {
  readonly authorization: string | null;
  readonly organizationId?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly clientIp?: string;
}

export interface StartWorkflowRunRequest extends WorkflowRequestMeta {
  readonly workflowId: string;
  readonly input: unknown;
  readonly origin?: WorkflowRunOrigin;
  readonly runtimeMs?: number;
}

export interface WorkflowRunRequest extends WorkflowRequestMeta {
  readonly workflowRunId: string;
  readonly expectedVersion?: number;
}

export interface WorkflowControlRequest extends WorkflowRunRequest {
  readonly reason: string;
}

/**
 * A decision (AI-01 Batch 3B, Part 5).
 *
 * Note what a caller does NOT supply: who they are, what roles they hold, or
 * which organization the approval belongs to. All three are resolved from the
 * authenticated subject, which is the whole of "approval authority is resolved
 * server-side" — there is no field on this request through which a caller could
 * assert authority, so there is nothing to validate away.
 */
export interface WorkflowApprovalDecisionRequest extends WorkflowRequestMeta {
  readonly workflowApprovalId: string;
  readonly decision: WorkflowApprovalDecision;
  readonly reason: string;
}

export interface WorkflowApprovalListRequest extends WorkflowRequestMeta {
  /** Only requests that can still be decided. Defaults to true — it is a queue. */
  readonly pendingOnly?: boolean;
  readonly workflowRunId?: string;
  readonly limit?: number;
}

export interface WorkflowRuntimeService {
  /** Create the run and drive it until it blocks, completes or fails. */
  startRun(request: StartWorkflowRunRequest): Promise<WorkflowRunDetail>;
  /** Create the run WITHOUT driving it. For a caller that schedules its own. */
  createRun(request: StartWorkflowRunRequest): Promise<WorkflowRunDetail>;
  advanceRun(request: WorkflowRunRequest): Promise<WorkflowRunDetail>;
  pauseRun(request: WorkflowControlRequest): Promise<WorkflowRunDetail>;
  resumeRun(request: WorkflowControlRequest): Promise<WorkflowRunDetail>;
  cancelRun(request: WorkflowControlRequest): Promise<WorkflowRunDetail>;
  expireRun(request: WorkflowControlRequest): Promise<WorkflowRunDetail>;
  getRun(request: WorkflowRunRequest): Promise<WorkflowRunDetail>;
  listRuns(
    request: WorkflowRequestMeta & { states?: readonly WorkflowRunState[]; limit?: number },
  ): Promise<readonly WorkflowRunSummary[]>;
  listWorkflows(request: WorkflowRequestMeta): Promise<readonly WorkflowDescriptor[]>;
  getPlan(request: WorkflowRequestMeta & { workflowId: string }): Promise<WorkflowPlan>;
  overview(request: WorkflowRequestMeta): Promise<WorkflowRuntimeOverview>;
  /**
   * Answer an approval (Part 5).
   *
   * Records the decision and returns. IT DOES NOT ADVANCE THE RUN, and the
   * omission is deliberate: a decider is not necessarily permitted to drive
   * workflow runs — `reviewer` holds `workflow.approval.decide` and not
   * `workflow.run.create` — so advancing here would either execute agent runs
   * under an actor who may not start them, or quietly require approvers to be
   * operators. The run picks the decision up on its next advance, by reading
   * the durable record.
   */
  decideApproval(request: WorkflowApprovalDecisionRequest): Promise<WorkflowApprovalView>;
  /** The approval queue for the actor's organization. Oldest first. */
  listApprovals(request: WorkflowApprovalListRequest): Promise<readonly WorkflowApprovalView[]>;
  getApproval(
    request: WorkflowRequestMeta & { workflowApprovalId: string },
  ): Promise<WorkflowApprovalView>;
}

export interface WorkflowRuntimeServiceDependencies {
  readonly orchestrator: WorkflowOrchestrator;
  readonly registry: WorkflowRegistry;
  readonly runs: WorkflowRunStore;
  /** The SAME gate the engine holds. See `workflowRuntime.ts`. */
  readonly approvals: WorkflowApprovalGate;
  readonly authenticator: AIAuthenticator;
  readonly organizationOptions: OrganizationResolutionOptions;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /**
   * Agent-runtime capabilities for the authenticated subject.
   *
   * Injected rather than computed, so this service holds no copy of the agent
   * runtime's grant table. The assembly wires it to `resolveAgentActor`.
   */
  readonly agentCapabilitiesFor: (
    subject: Parameters<typeof resolveWorkflowActor>[0],
    organizationId: string,
  ) => readonly string[];
}

const DEFAULT_ORIGIN: WorkflowRunOrigin = { surface: 'team_console', feature: 'workflow' };

export function createWorkflowRuntimeService(
  deps: WorkflowRuntimeServiceDependencies,
): WorkflowRuntimeService {
  async function context(meta: WorkflowRequestMeta): Promise<{
    actor: WorkflowRuntimeActor;
    runActor: WorkflowRunActor;
    requestId: string;
    correlationId: string;
  }> {
    const subject = await deps.authenticator.authenticate(meta.authorization);
    // The organization is resolved BEFORE agent capabilities, because the agent
    // grant depends on the membership for that organization — resolving them in
    // the other order would grant against whichever membership came first.
    const provisional = resolveWorkflowActor(
      subject,
      meta.organizationId,
      deps.organizationOptions,
      [],
    );
    const agentCapabilities = deps.agentCapabilitiesFor(
      subject,
      provisional.organization.organizationId,
    );
    const actor = resolveWorkflowActor(
      subject,
      meta.organizationId,
      deps.organizationOptions,
      agentCapabilities,
    );

    return {
      actor,
      runActor: {
        actorId: actor.actorId,
        roles: actor.roles,
        capabilities: actor.capabilities,
        agent: actor.agent,
      },
      requestId: adoptOrCreateId(meta.requestId, 'req', deps.ids),
      correlationId: adoptOrCreateId(meta.correlationId, 'cor', deps.ids),
    };
  }

  /**
   * Load a run inside the actor's scope.
   *
   * The scope is applied to the KEY, not compared after the fact, so a run
   * belonging to another tenant is not found rather than found-and-refused —
   * there is no response difference a caller could use to probe for it.
   */
  async function readRun(
    actor: WorkflowRuntimeActor,
    meta: WorkflowRequestMeta,
    workflowRunId: string,
  ): Promise<WorkflowRunRecord> {
    const organizationId = workflowReadScopeFor(actor, meta.organizationId);
    const record = await deps.runs.load(organizationId, workflowRunId);
    if (!record) {
      throw workflowFailure('workflow_run_not_found', 'That run is not available.', {
        workflowRunId,
        diagnostics: `organizationId=${organizationId} workflowRunId=${workflowRunId}`,
      });
    }
    return record;
  }

  async function drive(
    request: WorkflowRunRequest,
    control: 'advance',
  ): Promise<WorkflowRunDetail> {
    const { actor, runActor, requestId, correlationId } = await context(request);
    requireWorkflowCapability(actor, 'workflow.run.create');
    void control;
    const record = await deps.orchestrator.advance({
      // Control operations are ALWAYS scoped to the actor's own organization.
      // A platform reader may read another tenant's run; nobody may drive one.
      organizationId: actor.organization.organizationId,
      workflowRunId: request.workflowRunId,
      actor: runActor,
      authorization: request.authorization,
      requestId,
      correlationId,
      ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
      ...(request.expectedVersion === undefined
        ? {}
        : { expectedVersion: request.expectedVersion }),
    });
    return toWorkflowRunDetail(record);
  }

  return {
    async createRun(request) {
      const { actor, runActor, requestId, correlationId } = await context(request);
      requireWorkflowCapability(actor, 'workflow.run.create');
      const record = await deps.orchestrator.createRun({
        workflowId: request.workflowId,
        organizationId: actor.organization.organizationId,
        actor: runActor,
        input: request.input,
        requestId,
        correlationId,
        origin: request.origin ?? DEFAULT_ORIGIN,
        ...(request.runtimeMs === undefined ? {} : { runtimeMs: request.runtimeMs }),
      });
      return toWorkflowRunDetail(record);
    },

    async startRun(request) {
      const created = await this.createRun(request);
      return drive(
        {
          authorization: request.authorization,
          workflowRunId: created.workflowRunId,
          ...(request.organizationId === undefined
            ? {}
            : { organizationId: request.organizationId }),
          ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
          ...(request.correlationId === undefined
            ? {}
            : { correlationId: request.correlationId }),
          ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
        },
        'advance',
      );
    },

    advanceRun: (request) => drive(request, 'advance'),

    async pauseRun(request) {
      const { actor, runActor, requestId, correlationId } = await context(request);
      requireWorkflowCapability(actor, 'workflow.run.control');
      const record = await deps.orchestrator.pause(
        controlInput(actor, runActor, request, requestId, correlationId),
      );
      return toWorkflowRunDetail(record);
    },

    async resumeRun(request) {
      const { actor, runActor, requestId, correlationId } = await context(request);
      requireWorkflowCapability(actor, 'workflow.run.control');
      const record = await deps.orchestrator.resume(
        controlInput(actor, runActor, request, requestId, correlationId),
      );
      return toWorkflowRunDetail(record);
    },

    async cancelRun(request) {
      const { actor, runActor, requestId, correlationId } = await context(request);
      requireWorkflowCapability(actor, 'workflow.run.control');
      const record = await deps.orchestrator.cancel(
        controlInput(actor, runActor, request, requestId, correlationId),
      );
      return toWorkflowRunDetail(record);
    },

    async expireRun(request) {
      const { actor, runActor, requestId, correlationId } = await context(request);
      requireWorkflowCapability(actor, 'workflow.run.control');
      const record = await deps.orchestrator.expireIfDue(
        controlInput(actor, runActor, request, requestId, correlationId),
      );
      return toWorkflowRunDetail(record);
    },

    async getRun(request) {
      const { actor } = await context(request);
      requireWorkflowCapability(actor, 'workflow.run.read');
      return toWorkflowRunDetail(await readRun(actor, request, request.workflowRunId));
    },

    async listRuns(request) {
      const { actor } = await context(request);
      requireWorkflowCapability(actor, 'workflow.run.read');
      const records = await deps.runs.list({
        organizationId: workflowReadScopeFor(actor, request.organizationId),
        ...(request.states === undefined ? {} : { states: request.states }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      return records.map(toWorkflowRunSummary);
    },

    async listWorkflows(request) {
      const { actor } = await context(request);
      requireWorkflowCapability(actor, 'workflow.registry.read');
      return deps.registry.list();
    },

    async getPlan(request) {
      const { actor } = await context(request);
      requireWorkflowCapability(actor, 'workflow.registry.read');
      // `requirePlan` enforces registration, the enable switch and the
      // certification requirement, so a plan for a withdrawn workflow is not
      // readable through this surface even by an operator who knows its id.
      return deps.registry.requirePlan(request.workflowId);
    },

    async overview(request) {
      const { actor } = await context(request);
      requireWorkflowCapability(actor, 'workflow.run.read');
      const organizationId = workflowReadScopeFor(actor, request.organizationId);
      const records = await deps.runs.list({ organizationId, limit: 200 });

      const counts = Object.fromEntries(
        WORKFLOW_RUN_STATES.map((state) => [state, 0]),
      ) as Record<WorkflowRunState, number>;
      for (const record of records) counts[record.state] += 1;

      return {
        scope: actor.platformReader && request.organizationId ? 'platform' : 'organization',
        organizationId,
        counts,
        active: records
          .filter((record) => ACTIVE_WORKFLOW_STATES.includes(record.state))
          .slice(0, 20)
          .map(toWorkflowRunSummary),
        recentFailures: records
          .filter((record) => record.state === 'failed' || record.state === 'policy_denied')
          .slice(0, 20)
          .map(toWorkflowRunSummary),
        registeredWorkflows: deps.registry.size(),
        pendingApprovals: (await deps.approvals.pending(organizationId, 200)).length,
        capabilities: actor.capabilities,
        generatedAt: deps.clock.isoNow(),
      };
    },

    async decideApproval(request) {
      const { actor } = await context(request);
      requireWorkflowCapability(actor, 'workflow.approval.decide');

      // THE ACTOR'S OWN ORGANIZATION, ALWAYS. A platform reader may READ another
      // tenant's runs; nobody decides another tenant's approvals, at any role.
      // A decision is an act on a tenant's work, and cross-tenant reads exist
      // for operators to see what happened rather than to change it.
      const decided = await deps.approvals.decide({
        organizationId: actor.organization.organizationId,
        workflowApprovalId: request.workflowApprovalId,
        decision: request.decision,
        reason: request.reason,
        deciderId: actor.actorId,
        // Resolved from the authenticated subject, never from the request.
        deciderRoles: actor.roles,
      });
      return toWorkflowApprovalView(decided);
    },

    async listApprovals(request) {
      const { actor } = await context(request);
      requireWorkflowCapability(actor, 'workflow.approval.read');
      const organizationId = workflowReadScopeFor(actor, request.organizationId);

      // One query, both filters, so a caller who supplies a run id AND asks for
      // the whole history gets exactly that rather than whichever of the two
      // the implementation happened to apply first.
      const records = await deps.approvals.list({
        organizationId,
        pendingOnly: request.pendingOnly !== false,
        ...(request.workflowRunId === undefined
          ? {}
          : { workflowRunId: request.workflowRunId }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      return records.map(toWorkflowApprovalView);
    },

    async getApproval(request) {
      const { actor } = await context(request);
      requireWorkflowCapability(actor, 'workflow.approval.read');
      const organizationId = workflowReadScopeFor(actor, request.organizationId);
      const record = await deps.approvals.get(organizationId, request.workflowApprovalId);
      if (!record) {
        throw workflowFailure('workflow_approval_not_found', 'That approval is not available.', {
          diagnostics:
            `organizationId=${organizationId} approval=${request.workflowApprovalId}`,
        });
      }
      return toWorkflowApprovalView(record);
    },
  };

  function controlInput(
    actor: WorkflowRuntimeActor,
    runActor: WorkflowRunActor,
    request: WorkflowControlRequest,
    requestId: string,
    correlationId: string,
  ) {
    return {
      organizationId: actor.organization.organizationId,
      workflowRunId: request.workflowRunId,
      actor: runActor,
      reason: request.reason,
      requestId,
      correlationId,
      ...(request.expectedVersion === undefined
        ? {}
        : { expectedVersion: request.expectedVersion }),
    };
  }
}
