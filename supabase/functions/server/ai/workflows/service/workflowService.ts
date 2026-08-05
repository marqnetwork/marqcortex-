/**
 * Workflow Service (AI-01 Batch 3B).
 *
 * The API-facing layer: authenticate, resolve the actor and the tenant, enforce
 * the capability, validate the request, call the orchestrator, and return a read
 * model that contains nothing a caller should not see.
 *
 * THREE THINGS THIS LAYER OWNS AND THE ORCHESTRATOR DOES NOT.
 *
 *   IDENTITY. The orchestrator takes an actor; this is where an actor comes from.
 *   Roles, capabilities and the organization are resolved from the authenticated
 *   subject through the same authenticator port the AI Guard uses — there is no
 *   second credential path and nothing a caller sends influences the outcome.
 *
 *   READ MODELS. A run record carries validated node outputs, context manifests
 *   and step digests. What leaves this layer is a projection: no prompts, no
 *   completions, no tool payloads, no model outputs, and — deliberately — none of
 *   the workflow's `values` scratch space, which holds tenant business data. An
 *   operator sees what happened, what it cost and why it stopped, never the
 *   content.
 *
 *   TENANT SCOPE ON EVERY READ. Every store call is keyed by the resolved
 *   organization. Only a platform reader may name another, only for reads, and
 *   finance reads are gated on their own capability so a run reader cannot widen
 *   into a cost report.
 *
 * WHAT IS DELIBERATELY NOT HERE: any way to create a workflow, edit a definition,
 * add a node or change a limit. Those are registry-time decisions made in code and
 * reviewed as code. Customer-created workflows are explicitly out of scope for
 * this batch, and an API that could create one would be the whole of that scope
 * arriving through the back door.
 */

import type { AIAuthenticator } from '../../security/actor.ts';
import type { OrganizationResolutionOptions } from '../../security/tenancy.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Clock } from '../../runtime/clock.ts';
import type {
  WorkflowDescriptor,
  WorkflowNodeType,
} from '../contracts/workflow.ts';
import type {
  WorkflowApprovalRequest,
  WorkflowBranchRecord,
  WorkflowRunRecord,
  WorkflowRunState,
} from '../contracts/runtime.ts';
import { WORKFLOW_RUN_STATES, isTerminalWorkflowState } from '../contracts/runtime.ts';
import { workflowFailure } from '../contracts/failures.ts';
import type { WorkflowRegistry } from '../registry/workflowRegistry.ts';
import type { WorkflowRunStore } from '../persistence/ports.ts';
import type { WorkflowApprovalGate } from '../approvals/workflowApprovalGate.ts';
import type { WorkflowAuditRecord, WorkflowAuditWriter } from '../observability/workflowAudit.ts';
import type { WorkflowOrchestrator } from '../orchestrator/workflowOrchestrator.ts';
import type { WorkflowPlanManifest } from '../planner/workflowPlanner.ts';
import type { WorkflowActor, WorkflowCapability } from './workflowRbac.ts';
import {
  financeScopeFor,
  readScopeFor,
  requireWorkflowCapability,
  resolveWorkflowActor,
} from './workflowRbac.ts';
import { ACTIVE_WORKFLOW_STATES, FAILED_WORKFLOW_STATES } from '../runtime/stateMachine.ts';
import type {
  OptimizationSavingsSummary,
  WorkflowFinancialSummary,
} from '../analytics/financials.ts';
import {
  buildFinancialSummary,
  buildOptimizationSavingsSummary,
} from '../analytics/financials.ts';
import type { OptimizationScore } from '../runtime/optimizationScore.ts';
import { computeOptimizationScore } from '../runtime/optimizationScore.ts';
import { summarizeAvoidedCalls } from '../runtime/ledgers.ts';
import { adoptOrCreateId } from '../../contracts/ids.ts';

// ── Read models ─────────────────────────────────────────────────────────────

export interface WorkflowRunSummary {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly organizationId: string;
  readonly state: WorkflowRunState;
  readonly currentNodeId?: string;
  readonly stepCount: number;
  readonly retryCount: number;
  readonly activeBranches: number;
  readonly completedBranches: number;
  readonly failedBranches: number;
  readonly childAgentRuns: number;
  readonly actorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deadlineAt: string;
  readonly elapsedRuntimeMs: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly avoidedMicroUsd: number;
  readonly pendingApprovalId?: string;
  readonly failure?: string;
  readonly failureMessage?: string;
  readonly parentWorkflowRunId?: string;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  readonly correlationId: string;
  readonly configurationVersion: number;
  readonly checkpointVersion: number;
  readonly planDigest: string;
  readonly planManifestDigest: string;
  readonly resultDigest?: string;
  readonly tokens: WorkflowRunRecord['tokens'];
  readonly cost: WorkflowRunRecord['cost'];
  readonly transitions: WorkflowRunRecord['transitions'];
  readonly transitionsTruncated: number;
  readonly branches: readonly WorkflowBranchView[];
  readonly joins: WorkflowRunRecord['joins'];
  readonly childAgentRunIds: readonly string[];
  readonly optimizationScore: OptimizationScore;
  readonly limitsReached: readonly string[];
}

/** One node execution, with every content field reduced to a digest. */
export interface WorkflowNodeView {
  readonly nodeExecutionId: string;
  readonly sequence: number;
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  readonly branchId?: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
  readonly outcome: string;
  readonly failure?: string;
  readonly inputDigest: string;
  readonly outputDigest?: string;
  readonly estimatedPromptTokens: number;
  readonly estimatedCompletionTokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly actualPromptTokens?: number;
  readonly actualCompletionTokens?: number;
  readonly cachedTokens?: number;
  readonly actualCostMicroUsd?: number;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly modelProfileId?: string;
  readonly toolId?: string;
  readonly agentId?: string;
  readonly childAgentRunId?: string;
  readonly workflowApprovalId?: string;
  readonly executionRequestId?: string;
  readonly nextNodeId?: string;
  readonly checkpointVersion: number;
}

export interface WorkflowBranchView {
  readonly branchId: string;
  readonly parallelNodeId: string;
  readonly joinNodeId: string;
  readonly parentBranchId?: string;
  readonly depth: number;
  readonly state: string;
  readonly currentNodeId?: string;
  readonly stepCount: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costMicroUsd: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly failure?: string;
}

export interface WorkflowApprovalView {
  readonly workflowApprovalId: string;
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly branchId?: string;
  readonly organizationId: string;
  readonly requestedBy: string;
  readonly proposedAction: string;
  readonly impactSummary: string;
  readonly dataAffected: readonly string[];
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
  readonly approvalReason: string;
  readonly authorizedRoles: readonly string[];
  readonly expiresAt: string;
  readonly singleUse: boolean;
  readonly createdAt: string;
  readonly state: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly decisionReason?: string;
}

/** The token optimization report for one run. */
export interface TokenOptimizationReport {
  readonly workflowRunId: string;
  readonly optimizerDecisions: WorkflowRunRecord['optimizations'];
  readonly routingDecisions: WorkflowRunRecord['routing'];
  readonly cacheDecisions: WorkflowRunRecord['cacheDecisions'];
  readonly avoidedCalls: WorkflowRunRecord['avoidedCalls'];
  readonly totals: {
    readonly originalContextTokens: number;
    readonly finalContextTokens: number;
    readonly duplicateTokensRemoved: number;
    readonly historyTokensRemoved: number;
    readonly retrievalTokensAvoided: number;
    readonly memoryTokensAvoided: number;
    readonly completionTokensReduced: number;
    readonly cachedTokensUsed: number;
    readonly totalTokensSaved: number;
    readonly avoidedCalls: number;
    readonly avoidedMicroUsd: number;
  };
  readonly score: OptimizationScore;
}

/** The cost report for one run. */
export interface WorkflowCostReport {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly tokens: WorkflowRunRecord['tokens'];
  readonly cost: WorkflowRunRecord['cost'];
  readonly perNode: readonly {
    readonly nodeId: string;
    readonly nodeType: WorkflowNodeType;
    readonly branchId?: string;
    readonly attempts: number;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly costMicroUsd: number;
    readonly providerId?: string;
    readonly modelId?: string;
    readonly modelProfileId?: string;
  }[];
  readonly retryCostMicroUsd: number;
  readonly parallelBranchCostMicroUsd: number;
  readonly childAgentCostMicroUsd: number;
  readonly budgetUtilization: number;
}

/** The operator overview. Counts and a bounded window, never every run. */
export interface WorkflowOverview {
  readonly scope: 'organization' | 'platform';
  readonly organizationId: string;
  readonly counts: Readonly<Record<WorkflowRunState, number>>;
  readonly active: readonly WorkflowRunSummary[];
  readonly awaitingApproval: readonly WorkflowRunSummary[];
  readonly recentFailures: readonly WorkflowRunSummary[];
  readonly pendingApprovals: readonly WorkflowApprovalView[];
  readonly registeredWorkflows: number;
  readonly capabilities: readonly WorkflowCapability[];
  /** Nodes appearing most often as the last node of a failed or waiting run. */
  readonly bottlenecks: readonly { readonly nodeId: string; readonly runs: number }[];
  readonly completedOutcomes: number;
  readonly costPerSuccessfulRunMicroUsd: number;
  readonly projectedMonthlyBurnMicroUsd: number;
  readonly projectionIsEstimate: true;
  readonly generatedAt: string;
}

// ── Projections ─────────────────────────────────────────────────────────────

export function toWorkflowRunSummary(record: WorkflowRunRecord): WorkflowRunSummary {
  return {
    workflowRunId: record.context.workflowRunId,
    workflowId: record.context.workflowId,
    workflowVersion: record.context.workflowVersion,
    organizationId: record.context.organizationId,
    state: record.state,
    ...(record.currentNodeId === undefined ? {} : { currentNodeId: record.currentNodeId }),
    stepCount: record.stepCount,
    retryCount: record.retryCount,
    activeBranches: record.activeBranchIds.length,
    completedBranches: record.completedBranchIds.length,
    failedBranches: record.failedBranchIds.length,
    childAgentRuns: record.childAgentRunIds.length,
    actorId: record.context.actorId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deadlineAt: record.deadlineAt,
    elapsedRuntimeMs: record.elapsedRuntimeMs,
    totalTokens: record.tokens.actualTotalTokens,
    costMicroUsd: record.cost.actualMicroUsd,
    avoidedMicroUsd: record.cost.avoidedMicroUsd,
    ...(record.pendingApprovalId === undefined
      ? {}
      : { pendingApprovalId: record.pendingApprovalId }),
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    ...(record.failureMessage === undefined ? {} : { failureMessage: record.failureMessage }),
    ...(record.context.parentWorkflowRunId === undefined
      ? {}
      : { parentWorkflowRunId: record.context.parentWorkflowRunId }),
  };
}

function toBranchView(branch: WorkflowBranchRecord): WorkflowBranchView {
  return {
    branchId: branch.branchId,
    parallelNodeId: branch.parallelNodeId,
    joinNodeId: branch.joinNodeId,
    ...(branch.parentBranchId === undefined ? {} : { parentBranchId: branch.parentBranchId }),
    depth: branch.depth,
    state: branch.state,
    ...(branch.currentNodeId === undefined ? {} : { currentNodeId: branch.currentNodeId }),
    stepCount: branch.stepCount,
    promptTokens: branch.promptTokens,
    completionTokens: branch.completionTokens,
    costMicroUsd: branch.costMicroUsd,
    startedAt: branch.startedAt,
    ...(branch.endedAt === undefined ? {} : { endedAt: branch.endedAt }),
    ...(branch.failure === undefined ? {} : { failure: branch.failure }),
  };
}

/** Limit events, derived rather than stored, so they cannot drift. */
function limitsReached(record: WorkflowRunRecord): readonly string[] {
  const events: string[] = [];
  if (record.failure) events.push(record.failure);
  if (record.retryCount > 0) events.push(`retries:${record.retryCount}`);
  if (record.failedBranchIds.length > 0) {
    events.push(`failed_branches:${record.failedBranchIds.length}`);
  }
  if (record.parallelWidthOverride !== undefined) {
    events.push(`parallel_serialized:${record.parallelWidthOverride}`);
  }
  const unsatisfied = record.joins.filter((join) => !join.satisfied).length;
  if (unsatisfied > 0) events.push(`unsatisfied_joins:${unsatisfied}`);
  return events;
}

/**
 * Score one run.
 *
 * "Cheapest capable profile" is read as "routing did not escalate and did not
 * cross the quality floor" — the two things the router reports and the two that
 * actually distinguish a well-routed step from a lucky one.
 */
export function scoreRun(record: WorkflowRunRecord): OptimizationScore {
  const modelSteps = record.nodeHistory.filter((node) => node.nodeType === 'model').length;
  const cheapest = record.routing.filter((entry) => !entry.escalated).length;
  const cacheEligible = record.cacheDecisions.filter(
    (entry) => entry.outcome !== 'denied',
  ).length;
  const cacheHits = record.cacheDecisions.filter((entry) => entry.outcome === 'hit').length;
  const avoided = summarizeAvoidedCalls(record.avoidedCalls);
  const optionalNodes = record.nodeHistory.filter((node) => node.outcome === 'skipped').length;

  return computeOptimizationScore({
    originalContextTokens: record.optimizations.reduce(
      (sum, entry) => sum + entry.originalContextTokens,
      0,
    ),
    finalContextTokens: record.optimizations.reduce(
      (sum, entry) => sum + entry.finalContextTokens,
      0,
    ),
    stepsOnCheapestCapableProfile: cheapest,
    modelSteps,
    cacheHits,
    cacheEligibleSteps: cacheEligible,
    avoidedCalls: avoided.avoidedCalls,
    optionalNodes,
    retries: record.retryCount,
    totalSteps: record.stepCount,
    estimatedCostMicroUsd: record.cost.estimatedMicroUsd,
    actualCostMicroUsd: record.cost.actualMicroUsd,
    withinCostBudget: record.failure !== 'workflow_budget_exhausted' &&
      record.failure !== 'cost_budget_exhausted',
    withinLatencyObjective: record.failure !== 'workflow_expired',
    outputValidationPassed: record.failure !== 'output_validation_failed',
    completed: record.state === 'completed',
    // A downgrade below the declared floor is the router's own report, not a
    // guess: `downgraded` is set only when the quality floor could not be met.
    qualityFloorViolated: record.routing.some((entry) => entry.downgraded),
  });
}

export function toWorkflowRunDetail(record: WorkflowRunRecord): WorkflowRunDetail {
  return {
    ...toWorkflowRunSummary(record),
    correlationId: record.context.correlationId,
    configurationVersion: record.configurationVersion,
    checkpointVersion: record.checkpointVersion,
    planDigest: record.planDigest,
    planManifestDigest: record.planManifestDigest,
    ...(record.resultDigest === undefined ? {} : { resultDigest: record.resultDigest }),
    tokens: record.tokens,
    cost: record.cost,
    transitions: record.transitions,
    transitionsTruncated: record.transitionsTruncated,
    branches: record.branches.map(toBranchView),
    joins: record.joins,
    childAgentRunIds: record.childAgentRunIds,
    optimizationScore: scoreRun(record),
    limitsReached: limitsReached(record),
  };
}

export function toWorkflowNodeViews(record: WorkflowRunRecord): readonly WorkflowNodeView[] {
  return record.nodeHistory.map((node) => ({
    nodeExecutionId: node.nodeExecutionId,
    sequence: node.sequence,
    nodeId: node.nodeId,
    nodeType: node.nodeType,
    ...(node.branchId === undefined ? {} : { branchId: node.branchId }),
    attempt: node.attempt,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
    latencyMs: node.latencyMs,
    outcome: node.outcome,
    inputDigest: node.inputDigest,
    estimatedPromptTokens: node.estimatedPromptTokens,
    estimatedCompletionTokens: node.estimatedCompletionTokens,
    estimatedCostMicroUsd: node.estimatedCostMicroUsd,
    checkpointVersion: node.checkpointVersion,
    ...(node.failure === undefined ? {} : { failure: node.failure }),
    ...(node.outputDigest === undefined ? {} : { outputDigest: node.outputDigest }),
    ...(node.actualPromptTokens === undefined
      ? {}
      : { actualPromptTokens: node.actualPromptTokens }),
    ...(node.actualCompletionTokens === undefined
      ? {}
      : { actualCompletionTokens: node.actualCompletionTokens }),
    ...(node.cachedTokens === undefined ? {} : { cachedTokens: node.cachedTokens }),
    ...(node.actualCostMicroUsd === undefined
      ? {}
      : { actualCostMicroUsd: node.actualCostMicroUsd }),
    ...(node.providerId === undefined ? {} : { providerId: node.providerId }),
    ...(node.modelId === undefined ? {} : { modelId: node.modelId }),
    ...(node.modelProfileId === undefined ? {} : { modelProfileId: node.modelProfileId }),
    ...(node.toolId === undefined ? {} : { toolId: node.toolId }),
    ...(node.agentId === undefined ? {} : { agentId: node.agentId }),
    ...(node.childAgentRunId === undefined ? {} : { childAgentRunId: node.childAgentRunId }),
    ...(node.workflowApprovalId === undefined
      ? {}
      : { workflowApprovalId: node.workflowApprovalId }),
    ...(node.executionRequestId === undefined
      ? {}
      : { executionRequestId: node.executionRequestId }),
    ...(node.nextNodeId === undefined ? {} : { nextNodeId: node.nextNodeId }),
  }));
}

export function toWorkflowApprovalView(
  request: WorkflowApprovalRequest,
): WorkflowApprovalView {
  return {
    workflowApprovalId: request.workflowApprovalId,
    workflowRunId: request.workflowRunId,
    workflowId: request.workflowId,
    nodeId: request.nodeId,
    ...(request.branchId === undefined ? {} : { branchId: request.branchId }),
    organizationId: request.organizationId,
    requestedBy: request.requestedBy,
    proposedAction: request.proposedAction,
    impactSummary: request.impactSummary,
    dataAffected: request.dataAffected,
    estimatedAdditionalTokens: request.estimatedAdditionalTokens,
    estimatedAdditionalCostMicroUsd: request.estimatedAdditionalCostMicroUsd,
    approvalReason: request.approvalReason,
    authorizedRoles: request.authorizedRoles,
    expiresAt: request.expiresAt,
    singleUse: request.singleUse,
    createdAt: request.createdAt,
    state: request.state,
    ...(request.decidedBy === undefined ? {} : { decidedBy: request.decidedBy }),
    ...(request.decidedAt === undefined ? {} : { decidedAt: request.decidedAt }),
    ...(request.decisionReason === undefined
      ? {}
      : { decisionReason: request.decisionReason }),
  };
}

// ── Service ─────────────────────────────────────────────────────────────────

export interface WorkflowServiceDependencies {
  readonly orchestrator: WorkflowOrchestrator;
  readonly registry: WorkflowRegistry;
  readonly runs: WorkflowRunStore;
  readonly approvals: WorkflowApprovalGate;
  readonly audit: WorkflowAuditWriter;
  readonly authenticator: AIAuthenticator;
  readonly organizationOptions: OrganizationResolutionOptions;
  readonly clock: Clock;
  readonly ids: IdFactory;
}

export interface WorkflowRequestMeta {
  readonly authorization: string | null;
  readonly correlationId?: string;
  readonly organizationHint?: string;
  readonly clientIp?: string;
}

export interface CreateWorkflowRunRequest {
  readonly workflowId: string;
  readonly input: unknown;
  readonly surface?: 'team_console' | 'client_portal' | 'system';
  readonly feature?: string;
}

export interface ListWorkflowRunsRequest {
  readonly states?: readonly WorkflowRunState[];
  readonly workflowId?: string;
  readonly limit?: number;
  /** Platform readers only. Ignored for everyone else. */
  readonly organizationId?: string;
}

export interface WorkflowService {
  /** Resolve the caller. Throws on anything unauthenticated or unpermitted. */
  authorize(meta: WorkflowRequestMeta): Promise<WorkflowActor>;
  listWorkflows(actor: WorkflowActor): readonly WorkflowDescriptor[];
  getWorkflow(
    actor: WorkflowActor,
    workflowId: string,
  ): { readonly descriptor: WorkflowDescriptor; readonly plan: WorkflowPlanManifest };
  createRun(
    actor: WorkflowActor,
    request: CreateWorkflowRunRequest,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  getRun(
    actor: WorkflowActor,
    workflowRunId: string,
    organizationId?: string,
  ): Promise<WorkflowRunDetail>;
  listRuns(
    actor: WorkflowActor,
    request: ListWorkflowRunsRequest,
  ): Promise<readonly WorkflowRunSummary[]>;
  getRunNodes(
    actor: WorkflowActor,
    workflowRunId: string,
    organizationId?: string,
  ): Promise<readonly WorkflowNodeView[]>;
  getBranchState(
    actor: WorkflowActor,
    workflowRunId: string,
    organizationId?: string,
  ): Promise<{
    readonly branches: readonly WorkflowBranchView[];
    readonly joins: WorkflowRunRecord['joins'];
  }>;
  pauseRun(
    actor: WorkflowActor,
    workflowRunId: string,
    reason: unknown,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  resumeRun(
    actor: WorkflowActor,
    workflowRunId: string,
    reason: unknown,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  cancelRun(
    actor: WorkflowActor,
    workflowRunId: string,
    reason: unknown,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  retryRun(
    actor: WorkflowActor,
    workflowRunId: string,
    reason: unknown,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  submitApproval(
    actor: WorkflowActor,
    request: {
      workflowRunId: string;
      workflowApprovalId: string;
      decision: 'approve' | 'reject';
      reason: unknown;
    },
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  listPendingApprovals(
    actor: WorkflowActor,
    organizationId?: string,
    limit?: number,
  ): Promise<readonly WorkflowApprovalView[]>;
  getTokenOptimizationReport(
    actor: WorkflowActor,
    workflowRunId: string,
    organizationId?: string,
  ): Promise<TokenOptimizationReport>;
  getCostReport(
    actor: WorkflowActor,
    workflowRunId: string,
    organizationId?: string,
  ): Promise<WorkflowCostReport>;
  getFinancialSummary(
    actor: WorkflowActor,
    organizationId?: string,
  ): Promise<WorkflowFinancialSummary>;
  getOptimizationSavingsSummary(
    actor: WorkflowActor,
    organizationId?: string,
  ): Promise<OptimizationSavingsSummary>;
  overview(actor: WorkflowActor, organizationId?: string): Promise<WorkflowOverview>;
  /** The workflow audit trail, scoped to what this actor may see. */
  recentAudit(actor: WorkflowActor, limit?: number): readonly WorkflowAuditRecord[];
}

const MAX_REASON = 300;
const MIN_REASON = 3;

function requireReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    throw workflowFailure('invalid_node', 'A reason is required.', {
      diagnostics: `reason length ${reason.length} is outside ${MIN_REASON}–${MAX_REASON}`,
    });
  }
  return reason;
}

export function createWorkflowService(deps: WorkflowServiceDependencies): WorkflowService {
  const { orchestrator, registry, runs, approvals, audit, clock, ids } = deps;

  function runActor(actor: WorkflowActor) {
    return {
      actorId: actor.actorId,
      roles: actor.roles,
      capabilities: actor.capabilities,
    };
  }

  function trace(meta: WorkflowRequestMeta): { requestId: string; correlationId: string } {
    return {
      requestId: ids.next('req'),
      correlationId: adoptOrCreateId(meta.correlationId, 'cor', ids),
    };
  }

  /** Load a run the actor is entitled to see. Tenant scope is not negotiable. */
  async function loadScoped(
    actor: WorkflowActor,
    workflowRunId: string,
    organizationId: string | undefined,
  ): Promise<WorkflowRunRecord> {
    const scope = readScopeFor(actor, organizationId);
    const record = await runs.load(scope, workflowRunId);
    if (!record) {
      // A run in another tenant and a run that does not exist are the same answer
      // on purpose: distinguishing them would turn this endpoint into a way to test
      // whether an id exists somewhere else.
      throw workflowFailure('workflow_run_not_found', 'That workflow run could not be found.', {
        workflowRunId,
        diagnostics: `run ${workflowRunId} not visible to ${actor.actorId} in scope ${scope}`,
      });
    }
    return record;
  }

  /** Every run in a finance scope, bounded. Shared by the two money reports. */
  async function financeRecords(
    actor: WorkflowActor,
    organizationId: string | undefined,
  ): Promise<{ readonly scope: string; readonly records: readonly WorkflowRunRecord[] }> {
    requireWorkflowCapability(actor, 'workflow.finance.read');
    const scope = financeScopeFor(actor, organizationId);
    const records = await runs.list({ organizationId: scope, limit: 200 });
    return { scope, records };
  }

  return {
    async authorize(meta) {
      const subject = meta.authorization
        ? await deps.authenticator.authenticate(meta.authorization)
        : null;
      return resolveWorkflowActor(subject, meta.organizationHint, deps.organizationOptions);
    },

    listWorkflows(actor) {
      requireWorkflowCapability(actor, 'workflow.registry.read');
      return registry.list();
    },

    getWorkflow(actor, workflowId) {
      requireWorkflowCapability(actor, 'workflow.registry.read');
      const descriptor = registry.describe(workflowId);
      if (!descriptor) {
        throw workflowFailure('workflow_not_found', 'That workflow is not available.', {
          workflowId,
          diagnostics: `workflow ${workflowId} is not registered`,
        });
      }
      // The plan manifest is metadata about the graph — node types, worst-case
      // exposure, approval points — and carries no tenant data at all, so a
      // registry reader may see it.
      return { descriptor, plan: orchestrator.planFor(workflowId).manifest };
    },

    async createRun(actor, request, meta) {
      requireWorkflowCapability(actor, 'workflow.run.create');
      const { requestId, correlationId } = trace(meta);

      const created = await orchestrator.createRun({
        workflowId: String(request.workflowId ?? ''),
        organizationId: actor.organization.organizationId,
        actor: runActor(actor),
        input: request.input,
        requestId,
        correlationId,
        origin: {
          surface: request.surface ?? 'team_console',
          feature: (request.feature ?? 'workflow_engine').slice(0, 60),
        },
      });

      // Created and driven in one call. A run that is created and then left
      // un-driven looks identical to a stuck one, and the caller has no way to tell
      // the difference — so creation starts it, and the response says exactly where
      // it got to.
      const advanced = await orchestrator.advance({
        organizationId: actor.organization.organizationId,
        workflowRunId: created.context.workflowRunId,
        actor: runActor(actor),
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toWorkflowRunDetail(advanced);
    },

    async getRun(actor, workflowRunId, organizationId) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      return toWorkflowRunDetail(await loadScoped(actor, workflowRunId, organizationId));
    },

    async listRuns(actor, request) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const scope = readScopeFor(actor, request.organizationId);
      const states = (request.states ?? []).filter((state) =>
        (WORKFLOW_RUN_STATES as readonly string[]).includes(state),
      );
      const records = await runs.list({
        organizationId: scope,
        ...(states.length > 0 ? { states } : {}),
        ...(request.workflowId === undefined ? {} : { workflowId: request.workflowId }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      return records.map(toWorkflowRunSummary);
    },

    async getRunNodes(actor, workflowRunId, organizationId) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      return toWorkflowNodeViews(await loadScoped(actor, workflowRunId, organizationId));
    },

    async getBranchState(actor, workflowRunId, organizationId) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const record = await loadScoped(actor, workflowRunId, organizationId);
      return { branches: record.branches.map(toBranchView), joins: record.joins };
    },

    async pauseRun(actor, workflowRunId, reason, meta) {
      requireWorkflowCapability(actor, 'workflow.run.control');
      const record = await loadScoped(actor, workflowRunId, undefined);
      const { requestId, correlationId } = trace(meta);
      const paused = await orchestrator.pause({
        organizationId: record.context.organizationId,
        workflowRunId,
        actor: runActor(actor),
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      return toWorkflowRunDetail(paused);
    },

    async resumeRun(actor, workflowRunId, reason, meta) {
      requireWorkflowCapability(actor, 'workflow.run.control');
      const record = await loadScoped(actor, workflowRunId, undefined);
      const { requestId, correlationId } = trace(meta);
      await orchestrator.resume({
        organizationId: record.context.organizationId,
        workflowRunId,
        actor: runActor(actor),
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      // Resuming drives the run: a resume that only changed a state field would
      // leave the operator holding a "running" run that never takes a node.
      const advanced = await orchestrator.advance({
        organizationId: record.context.organizationId,
        workflowRunId,
        actor: runActor(actor),
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toWorkflowRunDetail(advanced);
    },

    async cancelRun(actor, workflowRunId, reason, meta) {
      requireWorkflowCapability(actor, 'workflow.run.control');
      const record = await loadScoped(actor, workflowRunId, undefined);
      const { requestId, correlationId } = trace(meta);
      const cancelled = await orchestrator.cancel({
        organizationId: record.context.organizationId,
        workflowRunId,
        actor: runActor(actor),
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      return toWorkflowRunDetail(cancelled);
    },

    async retryRun(actor, workflowRunId, reason, meta) {
      requireWorkflowCapability(actor, 'workflow.run.control');
      requireWorkflowCapability(actor, 'workflow.run.create');
      const record = await loadScoped(actor, workflowRunId, undefined);
      if (!isTerminalWorkflowState(record.state)) {
        throw workflowFailure('invalid_node', 'Only a finished run can be retried.', {
          workflowRunId,
          diagnostics: `run state is ${record.state}`,
        });
      }
      const { requestId, correlationId } = trace(meta);
      const forked = await orchestrator.retry({
        organizationId: record.context.organizationId,
        workflowRunId,
        actor: runActor(actor),
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      const advanced = await orchestrator.advance({
        organizationId: forked.context.organizationId,
        workflowRunId: forked.context.workflowRunId,
        actor: runActor(actor),
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toWorkflowRunDetail(advanced);
    },

    async submitApproval(actor, request, meta) {
      requireWorkflowCapability(actor, 'workflow.approval.decide');
      const record = await loadScoped(actor, request.workflowRunId, undefined);
      const { requestId, correlationId } = trace(meta);

      const decided = await orchestrator.decideApproval({
        organizationId: record.context.organizationId,
        workflowRunId: request.workflowRunId,
        workflowApprovalId: request.workflowApprovalId,
        decision: request.decision === 'reject' ? 'reject' : 'approve',
        actor: runActor(actor),
        reason: requireReason(request.reason),
        requestId,
        correlationId,
      });

      if (isTerminalWorkflowState(decided.state)) return toWorkflowRunDetail(decided);

      const advanced = await orchestrator.advance({
        organizationId: record.context.organizationId,
        workflowRunId: request.workflowRunId,
        actor: runActor(actor),
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toWorkflowRunDetail(advanced);
    },

    async listPendingApprovals(actor, organizationId, limit) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const scope = readScopeFor(actor, organizationId);
      const requests = await approvals.pending(scope, limit);
      // Expiry is derived on read, so a queue never offers a decision that can no
      // longer be made.
      const settled = await Promise.all(
        requests.map((request) => approvals.expireIfDue(request)),
      );
      return settled
        .filter((request) => request.state === 'pending')
        .map(toWorkflowApprovalView);
    },

    async getTokenOptimizationReport(actor, workflowRunId, organizationId) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const record = await loadScoped(actor, workflowRunId, organizationId);
      const avoided = summarizeAvoidedCalls(record.avoidedCalls);
      const fold = (pick: (entry: WorkflowRunRecord['optimizations'][number]) => number): number =>
        record.optimizations.reduce((sum, entry) => sum + pick(entry), 0);

      return {
        workflowRunId,
        optimizerDecisions: record.optimizations,
        routingDecisions: record.routing,
        cacheDecisions: record.cacheDecisions,
        avoidedCalls: record.avoidedCalls,
        totals: {
          originalContextTokens: fold((entry) => entry.originalContextTokens),
          finalContextTokens: fold((entry) => entry.finalContextTokens),
          duplicateTokensRemoved: fold((entry) => entry.duplicateTokensRemoved),
          historyTokensRemoved: fold((entry) => entry.historyTokensRemoved),
          retrievalTokensAvoided: fold((entry) => entry.retrievalTokensAvoided),
          memoryTokensAvoided: fold((entry) => entry.memoryTokensAvoided),
          completionTokensReduced: fold((entry) => entry.completionTokensReduced),
          cachedTokensUsed: fold((entry) => entry.cachedTokensUsed),
          totalTokensSaved: fold((entry) => entry.totalTokensSaved),
          avoidedCalls: avoided.avoidedCalls,
          avoidedMicroUsd: avoided.avoidedMicroUsd,
        },
        score: scoreRun(record),
      };
    },

    async getCostReport(actor, workflowRunId, organizationId) {
      // A per-run cost report needs the finance capability, not just the run read.
      // Watching a run progress and reading what it cost are different permissions.
      requireWorkflowCapability(actor, 'workflow.finance.read');
      const scope = financeScopeFor(actor, organizationId);
      const record = await runs.load(scope, workflowRunId);
      if (!record) {
        throw workflowFailure('workflow_run_not_found', 'That workflow run could not be found.', {
          workflowRunId,
          diagnostics: `run ${workflowRunId} not visible to ${actor.actorId} in scope ${scope}`,
        });
      }

      const perNode = record.nodeHistory.map((node) => ({
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        ...(node.branchId === undefined ? {} : { branchId: node.branchId }),
        attempts: node.attempt,
        promptTokens: node.actualPromptTokens ?? 0,
        completionTokens: node.actualCompletionTokens ?? 0,
        costMicroUsd: node.actualCostMicroUsd ?? 0,
        ...(node.providerId === undefined ? {} : { providerId: node.providerId }),
        ...(node.modelId === undefined ? {} : { modelId: node.modelId }),
        ...(node.modelProfileId === undefined ? {} : { modelProfileId: node.modelProfileId }),
      }));

      const definition = registry.find(record.context.workflowId);
      const ceiling = definition?.limits.maxActualCostMicroUsd ?? 0;

      return {
        workflowRunId,
        workflowId: record.context.workflowId,
        tokens: record.tokens,
        cost: record.cost,
        perNode,
        // Read off the node history rather than estimated: a node whose attempt is
        // above 1 IS a retry, and its measured cost is what the retry cost.
        retryCostMicroUsd: record.nodeHistory
          .filter((node) => node.attempt > 1)
          .reduce((sum, node) => sum + (node.actualCostMicroUsd ?? 0), 0),
        parallelBranchCostMicroUsd: record.branches.reduce(
          (sum, branch) => sum + branch.costMicroUsd,
          0,
        ),
        childAgentCostMicroUsd: record.nodeHistory
          .filter((node) => node.nodeType === 'agent')
          .reduce((sum, node) => sum + (node.actualCostMicroUsd ?? 0), 0),
        budgetUtilization:
          ceiling > 0 ? Math.min(1, record.cost.actualMicroUsd / ceiling) : 0,
      };
    },

    async getFinancialSummary(actor, organizationId) {
      const { scope, records } = await financeRecords(actor, organizationId);
      // The ceiling is the largest any registered workflow declares, so utilization
      // is measured against something real rather than against a made-up total.
      const ceiling = registry
        .list()
        .reduce((max, descriptor) => Math.max(max, descriptor.limits.maxActualCostMicroUsd), 0);
      return buildFinancialSummary(records, {
        organizationId: scope,
        nowIso: clock.isoNow(),
        nowMs: clock.now(),
        ...(ceiling > 0 ? { budgetCeilingMicroUsd: ceiling * Math.max(1, records.length) } : {}),
      });
    },

    async getOptimizationSavingsSummary(actor, organizationId) {
      const { records } = await financeRecords(actor, organizationId);
      return buildOptimizationSavingsSummary(records, { nowIso: clock.isoNow() });
    },

    async overview(actor, organizationId) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const scope = readScopeFor(actor, organizationId);

      const records = await runs.list({ organizationId: scope, limit: 200 });
      const counts = Object.fromEntries(
        WORKFLOW_RUN_STATES.map((state) => [state, 0]),
      ) as Record<WorkflowRunState, number>;
      for (const record of records) counts[record.state] += 1;

      const active = records
        .filter((record) => ACTIVE_WORKFLOW_STATES.includes(record.state))
        .slice(0, 20)
        .map(toWorkflowRunSummary);
      const awaitingApproval = records
        .filter((record) => record.state === 'waiting_for_approval')
        .slice(0, 20)
        .map(toWorkflowRunSummary);
      const recentFailures = records
        .filter((record) => FAILED_WORKFLOW_STATES.includes(record.state))
        .slice(0, 20)
        .map(toWorkflowRunSummary);

      // A bottleneck is the node a stuck or failed run last sat on. Counting the
      // LAST node rather than every node is what makes the list actionable: a node
      // every run passes through is not a bottleneck, a node runs stop at is.
      const bottleneckCounts = new Map<string, number>();
      for (const record of records) {
        if (record.state === 'completed') continue;
        const last = record.currentNodeId ?? record.nodeHistory.at(-1)?.nodeId;
        if (last === undefined) continue;
        bottleneckCounts.set(last, (bottleneckCounts.get(last) ?? 0) + 1);
      }
      const bottlenecks = [...bottleneckCounts.entries()]
        .map(([nodeId, runs2]) => ({ nodeId, runs: runs2 }))
        .sort((a, b) => b.runs - a.runs || a.nodeId.localeCompare(b.nodeId))
        .slice(0, 10);

      const pending = await this.listPendingApprovals(actor, organizationId, 20);

      // Finance figures appear on the overview ONLY for an actor who may read
      // finance. Zero is not a lie here — it is what an actor without the
      // capability is shown, and the console renders the section conditionally on
      // the same capability list.
      const mayReadFinance = actor.capabilities.includes('workflow.finance.read');
      const summary = mayReadFinance
        ? buildFinancialSummary(records, {
            organizationId: scope,
            nowIso: clock.isoNow(),
            nowMs: clock.now(),
          })
        : undefined;

      return {
        scope: actor.platformReader && organizationId ? 'platform' : 'organization',
        organizationId: scope,
        counts,
        active,
        awaitingApproval,
        recentFailures,
        pendingApprovals: pending,
        registeredWorkflows: registry.size(),
        capabilities: actor.capabilities,
        bottlenecks,
        completedOutcomes: summary?.completedOutcomes ?? 0,
        costPerSuccessfulRunMicroUsd: summary?.costPerSuccessfulRunMicroUsd ?? 0,
        projectedMonthlyBurnMicroUsd: summary?.projection.projectedMonthlyBurnMicroUsd ?? 0,
        projectionIsEstimate: true,
        generatedAt: clock.isoNow(),
      };
    },

    recentAudit(actor, limit = 50) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const bounded = Math.min(200, Math.max(1, Math.floor(limit)));
      if (actor.platformReader) return audit.recent(bounded);
      // FILTER FIRST, THEN SLICE. Reading `bounded` records and filtering afterwards
      // shows a tenant fewer rows than it asked for whenever a busier tenant's
      // records sit in front of its own — an audit trail that silently under-reports
      // is worse than one that reports nothing. The scan is over the store's own
      // retained window, which is capacity-bound, so this stays a bounded read.
      return audit
        .recent(audit.size())
        .filter((record) => record.organizationId === actor.organization.organizationId)
        .slice(0, bounded);
    },
  };
}
