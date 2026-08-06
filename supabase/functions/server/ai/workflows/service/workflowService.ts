/**
 * Workflow Runtime Service (AI-01 Batch 3B).
 *
 * The API-facing layer: authenticate, resolve the actor and the tenant, enforce
 * the capability, validate, call the orchestrator, and return a read model that
 * contains nothing a caller should not see. The same three responsibilities
 * `agents/service/agentRuntimeService.ts` owns, at the plan layer.
 *
 *   IDENTITY comes from the SAME authenticator the AI Guard and the agent
 *   runtime use, resolved through the same `resolveAgentActor`. There is no
 *   second credential path and nothing a caller sends influences the outcome.
 *
 *   READ MODELS ARE PROJECTIONS. A workflow run record carries a fact map, node
 *   records and ledgers. What leaves this layer is node states, timings,
 *   digests, costs and the fact KEYS — never a fact value, never an agent
 *   output, never a tool payload. An operator sees what happened, what it cost
 *   and why it stopped; the values that flowed between nodes are the tenant's
 *   business data and stay where they were written.
 *
 *   TENANT SCOPE ON EVERY READ. Every store call is keyed by the resolved
 *   organization. Only a platform reader may name another, and only for reads.
 *
 * WHAT IS DELIBERATELY NOT HERE: any way to create, edit, author or compose a
 * workflow. Definitions are registry-time decisions reviewed as code. A visual
 * builder and customer-authored workflows are explicitly out of scope, and an
 * API that could assemble a definition would be that scope arriving through the
 * back door.
 *
 * THE FINANCIAL VIEW LIVES HERE, and that is deliberate. Attribution has to
 * cross both layers — the agent runs a workflow started and the agent runs
 * nobody started from a workflow — so it is assembled where both stores are
 * already in scope, from the rows Batch 3A writes and the ledgers Batch 3B adds.
 * It computes nothing new.
 */

import type { AIAuthenticator } from '../../security/actor.ts';
import type { OrganizationResolutionOptions } from '../../security/tenancy.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Clock } from '../../runtime/clock.ts';
import type { AgentRuntimeActor } from '../../agents/service/agentRbac.ts';
import { resolveAgentActor } from '../../agents/service/agentRbac.ts';
import type { AgentRunStore } from '../../agents/persistence/ports.ts';
import type { AgentApprovalRequest } from '../../agents/contracts/runtime.ts';
import type { OptimizationLedger } from '../../optimization/optimizationLedger.ts';
import {
  cacheHitRate,
  coerceOptimizationLedger,
  optimizationScore,
} from '../../optimization/optimizationLedger.ts';
import type {
  AttributionSource,
  FinancialAttributionReport,
} from '../../optimization/financialAttribution.ts';
import { attributeFinancials } from '../../optimization/financialAttribution.ts';

import type { WorkflowDescriptor } from '../contracts/workflow.ts';
import type {
  WorkflowNodeRecord,
  WorkflowNodeState,
  WorkflowRunRecord,
  WorkflowRunState,
} from '../contracts/runtime.ts';
import { WORKFLOW_RUN_STATES, isTerminalWorkflowState } from '../contracts/runtime.ts';
import { workflowFailure } from '../contracts/failures.ts';
import type { WorkflowRegistry } from '../registry/workflowRegistry.ts';
import type { WorkflowRunStore } from '../persistence/workflowPorts.ts';
import type { WorkflowApprovalGate } from '../approvals/workflowApprovalGate.ts';
import type { WorkflowOrchestrator } from '../orchestrator/workflowOrchestrator.ts';
import type { WorkflowAuditRecord, WorkflowAuditWriter } from '../observability/workflowAudit.ts';
import { WORKFLOW_ACTIVE_STATES } from '../runtime/workflowStateMachine.ts';
import type { WorkflowCapability } from './workflowRbac.ts';
import {
  requireWorkflowCapability,
  workflowCapabilitiesOf,
  workflowReadScopeFor,
} from './workflowRbac.ts';
import { adoptOrCreateId } from '../../contracts/ids.ts';

// ── Read models ─────────────────────────────────────────────────────────────

export interface WorkflowRunSummary {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly organizationId: string;
  readonly state: WorkflowRunState;
  readonly currentWave: number;
  readonly totalWaves: number;
  readonly nodeExecutions: number;
  readonly actorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deadlineAt: string;
  readonly elapsedRuntimeMs: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly avoidedMicroUsd: number;
  readonly optimizationScore: number;
  readonly agentRunCount: number;
  readonly pendingApprovalId?: string;
  readonly failure?: string;
  readonly failureMessage?: string;
}

/** One node, with every content field reduced to a digest or a count. */
export interface WorkflowNodeView {
  readonly nodeId: string;
  readonly state: WorkflowNodeState;
  readonly wave: number;
  readonly attempts: number;
  readonly latencyMs: number;
  readonly startedAt?: string;
  readonly settledAt?: string;
  readonly agentRunId?: string;
  readonly approvalId?: string;
  readonly outputDigest?: string;
  readonly failure?: string;
  readonly failureMessage?: string;
  readonly skipReason?: string;
  readonly tokensUsed: number;
  readonly costMicroUsd: number;
  readonly avoidedMicroUsd: number;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  readonly correlationId: string;
  readonly configurationVersion: number;
  readonly checkpointVersion: number;
  readonly planDigest: string;
  readonly plan: readonly (readonly string[])[];
  readonly maxParallel: number;
  readonly nodes: readonly WorkflowNodeView[];
  /**
   * Fact KEYS only.
   *
   * The keys are the plan's own vocabulary and an operator needs them to read a
   * skipped branch. The VALUES are whatever a node published from a tenant's
   * data, and they never leave the record — which is why this is a list of
   * strings rather than a map.
   */
  readonly factKeys: readonly string[];
  readonly agentRunIds: readonly string[];
  readonly tokens: WorkflowRunRecord['tokens'];
  readonly cost: WorkflowRunRecord['cost'];
  readonly optimization: OptimizationLedger;
  readonly transitions: WorkflowRunRecord['transitions'];
  readonly transitionsTruncated: number;
  readonly terminalNodeId?: string;
}

export interface WorkflowApprovalView {
  readonly approvalId: string;
  readonly workflowRunId: string;
  readonly organizationId: string;
  readonly requestedBy: string;
  readonly impactSummary: string;
  readonly dataAffected: readonly string[];
  readonly reason: string;
  readonly authorizedApproverRoles: readonly string[];
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly state: string;
}

export interface WorkflowRuntimeOverview {
  readonly scope: 'organization' | 'platform';
  readonly organizationId?: string;
  readonly counts: Readonly<Record<WorkflowRunState, number>>;
  readonly active: readonly WorkflowRunSummary[];
  readonly awaitingApproval: readonly WorkflowRunSummary[];
  readonly recentFailures: readonly WorkflowRunSummary[];
  readonly pendingApprovals: readonly WorkflowApprovalView[];
  readonly registeredWorkflows: number;
  readonly capabilities: readonly WorkflowCapability[];
  readonly generatedAt: string;
}

/** The optimisation and financial view an operator reads. */
export interface OptimizationReport extends FinancialAttributionReport {
  readonly cacheHitRatePercent: number;
  /** Cache size and behaviour, when the deployment enabled one. */
  readonly cache?: {
    readonly size: number;
    readonly lookups: number;
    readonly hits: number;
    readonly misses: number;
    readonly stores: number;
    readonly evictions: number;
  };
}

// ── Projections ─────────────────────────────────────────────────────────────

export function toWorkflowRunSummary(record: WorkflowRunRecord): WorkflowRunSummary {
  const optimization = coerceOptimizationLedger(record.optimization);
  return {
    workflowRunId: record.context.workflowRunId,
    workflowId: record.context.workflowId,
    workflowVersion: record.context.workflowVersion,
    organizationId: record.context.organizationId,
    state: record.state,
    currentWave: record.currentWave,
    totalWaves: record.plan.waves.length,
    nodeExecutions: record.nodeExecutions,
    actorId: record.context.actorId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deadlineAt: record.deadlineAt,
    elapsedRuntimeMs: record.elapsedRuntimeMs,
    totalTokens: record.tokens.actualTotalTokens,
    costMicroUsd: record.cost.actualMicroUsd,
    avoidedMicroUsd: optimization.avoidedMicroUsd,
    optimizationScore: optimizationScore(optimization),
    agentRunCount: record.agentRunIds.length,
    ...(record.pendingApprovalId === undefined
      ? {}
      : { pendingApprovalId: record.pendingApprovalId }),
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    ...(record.failureMessage === undefined ? {} : { failureMessage: record.failureMessage }),
  };
}

function toNodeView(node: WorkflowNodeRecord): WorkflowNodeView {
  return {
    nodeId: node.nodeId,
    state: node.state,
    wave: node.wave,
    attempts: node.attempts,
    latencyMs: node.latencyMs,
    tokensUsed: node.tokensUsed,
    costMicroUsd: node.costMicroUsd,
    avoidedMicroUsd: node.avoidedMicroUsd,
    ...(node.startedAt === undefined ? {} : { startedAt: node.startedAt }),
    ...(node.settledAt === undefined ? {} : { settledAt: node.settledAt }),
    ...(node.agentRunId === undefined ? {} : { agentRunId: node.agentRunId }),
    ...(node.approvalId === undefined ? {} : { approvalId: node.approvalId }),
    ...(node.outputDigest === undefined ? {} : { outputDigest: node.outputDigest }),
    ...(node.failure === undefined ? {} : { failure: node.failure }),
    ...(node.failureMessage === undefined ? {} : { failureMessage: node.failureMessage }),
    ...(node.skipReason === undefined ? {} : { skipReason: node.skipReason }),
  };
}

export function toWorkflowRunDetail(record: WorkflowRunRecord): WorkflowRunDetail {
  return {
    ...toWorkflowRunSummary(record),
    correlationId: record.context.correlationId,
    configurationVersion: record.configurationVersion,
    checkpointVersion: record.checkpointVersion,
    planDigest: record.planDigest,
    plan: record.plan.waves,
    maxParallel: record.plan.maxParallel,
    nodes: Object.values(record.nodes)
      .map(toNodeView)
      .sort((a, b) => a.wave - b.wave || a.nodeId.localeCompare(b.nodeId)),
    factKeys: Object.keys(record.facts).sort(),
    agentRunIds: record.agentRunIds,
    tokens: record.tokens,
    cost: record.cost,
    optimization: coerceOptimizationLedger(record.optimization),
    transitions: record.transitions,
    transitionsTruncated: record.transitionsTruncated,
    ...(record.terminalNodeId === undefined ? {} : { terminalNodeId: record.terminalNodeId }),
  };
}

export function toWorkflowApprovalView(request: AgentApprovalRequest): WorkflowApprovalView {
  return {
    approvalId: request.approvalId,
    workflowRunId: request.runId,
    organizationId: request.organizationId,
    requestedBy: request.requestingAgentId,
    impactSummary: request.impactSummary,
    dataAffected: request.dataAffected,
    reason: request.reason,
    authorizedApproverRoles: request.authorizedApproverRoles,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    state: request.state,
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
  /** Agent runs, for the financial view. Read-only at this layer. */
  readonly agentRuns: AgentRunStore;
  /** Cache behaviour, when the deployment enabled a cache. */
  readonly cacheStats?: () => {
    readonly size: number;
    readonly lookups: number;
    readonly hits: number;
    readonly misses: number;
    readonly stores: number;
    readonly evictions: number;
  };
}

export interface WorkflowRequestMeta {
  readonly authorization: string | null;
  readonly correlationId?: string;
  readonly organizationHint?: string;
  readonly clientIp?: string;
}

export interface CreateWorkflowRunRequest {
  readonly workflowId: string;
  /** Seed facts. Coerced to bounded scalars by the orchestrator. */
  readonly facts?: Readonly<Record<string, unknown>>;
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
  authorize(meta: WorkflowRequestMeta): Promise<AgentRuntimeActor>;
  createRun(
    actor: AgentRuntimeActor,
    request: CreateWorkflowRunRequest,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  getRun(
    actor: AgentRuntimeActor,
    workflowRunId: string,
    organizationId?: string,
  ): Promise<WorkflowRunDetail>;
  listRuns(
    actor: AgentRuntimeActor,
    request: ListWorkflowRunsRequest,
  ): Promise<readonly WorkflowRunSummary[]>;
  pauseRun(
    actor: AgentRuntimeActor,
    workflowRunId: string,
    reason: unknown,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  resumeRun(
    actor: AgentRuntimeActor,
    workflowRunId: string,
    reason: unknown,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  cancelRun(
    actor: AgentRuntimeActor,
    workflowRunId: string,
    reason: unknown,
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  submitApproval(
    actor: AgentRuntimeActor,
    request: {
      workflowRunId: string;
      approvalId: string;
      decision: 'approve' | 'reject';
      reason: unknown;
    },
    meta: WorkflowRequestMeta,
  ): Promise<WorkflowRunDetail>;
  listPendingApprovals(
    actor: AgentRuntimeActor,
    organizationId?: string,
    limit?: number,
  ): Promise<readonly WorkflowApprovalView[]>;
  listWorkflows(actor: AgentRuntimeActor): readonly WorkflowDescriptor[];
  overview(
    actor: AgentRuntimeActor,
    organizationId?: string,
  ): Promise<WorkflowRuntimeOverview>;
  /** Financial attribution and the optimisation score. A read, never a write. */
  optimization(
    actor: AgentRuntimeActor,
    organizationId?: string,
  ): Promise<OptimizationReport>;
  /** The workflow audit trail, scoped to what this actor may see. */
  recentAudit(actor: AgentRuntimeActor, limit?: number): readonly WorkflowAuditRecord[];
}

const MAX_REASON = 300;
const MIN_REASON = 3;

function requireReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    throw workflowFailure('invalid_workflow_action', 'A reason is required.', {
      diagnostics: `reason length ${reason.length} is outside ${MIN_REASON}–${MAX_REASON}`,
    });
  }
  return reason;
}

export function createWorkflowService(deps: WorkflowServiceDependencies): WorkflowService {
  const { orchestrator, registry, runs, approvals, audit, clock, ids } = deps;

  function trace(meta: WorkflowRequestMeta): { requestId: string; correlationId: string } {
    return {
      requestId: ids.next('req'),
      correlationId: adoptOrCreateId(meta.correlationId, 'cor', ids),
    };
  }

  /** Load a run the actor is entitled to see. Tenant scope is not negotiable. */
  async function loadScoped(
    actor: AgentRuntimeActor,
    workflowRunId: string,
    organizationId: string | undefined,
  ): Promise<WorkflowRunRecord> {
    const scope = workflowReadScopeFor(actor, organizationId);
    const record = await runs.load(scope, workflowRunId);
    if (!record) {
      // A run in another tenant and a run that does not exist give the same
      // answer on purpose: distinguishing them would turn this endpoint into a
      // way to test whether an id exists somewhere else.
      throw workflowFailure('workflow_run_not_found', 'That workflow run could not be found.', {
        workflowRunId,
        diagnostics: `workflow run ${workflowRunId} not visible to ${actor.actorId} in ${scope}`,
      });
    }
    return record;
  }

  return {
    async authorize(meta) {
      const subject = meta.authorization
        ? await deps.authenticator.authenticate(meta.authorization)
        : null;
      return resolveAgentActor(subject, meta.organizationHint, deps.organizationOptions);
    },

    async createRun(actor, request, meta) {
      requireWorkflowCapability(actor, 'workflow.run.create');
      const { requestId, correlationId } = trace(meta);

      const created = await orchestrator.createRun({
        workflowId: String(request.workflowId ?? ''),
        organizationId: actor.organization.organizationId,
        actor: { actorId: actor.actorId, roles: actor.roles, capabilities: actor.capabilities },
        requestId,
        correlationId,
        origin: {
          surface: request.surface ?? 'team_console',
          feature: (request.feature ?? 'workflow_runtime').slice(0, 60),
        },
        ...(request.facts === undefined ? {} : { facts: request.facts }),
      });

      // Created and driven in one call, for the same reason the agent service
      // does it: a run that is created and left un-driven is indistinguishable
      // from a stuck one, and the caller cannot tell which they have.
      const advanced = await orchestrator.advance({
        organizationId: actor.organization.organizationId,
        workflowRunId: created.context.workflowRunId,
        actor: { actorId: actor.actorId, roles: actor.roles, capabilities: actor.capabilities },
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
      const scope = workflowReadScopeFor(actor, request.organizationId);
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

    async pauseRun(actor, workflowRunId, reason, meta) {
      requireWorkflowCapability(actor, 'workflow.run.control');
      const record = await loadScoped(actor, workflowRunId, undefined);
      const { requestId, correlationId } = trace(meta);
      const paused = await orchestrator.pause({
        organizationId: record.context.organizationId,
        workflowRunId,
        actor: { actorId: actor.actorId, roles: actor.roles, capabilities: actor.capabilities },
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
      const runActor = {
        actorId: actor.actorId,
        roles: actor.roles,
        capabilities: actor.capabilities,
      };
      await orchestrator.resume({
        organizationId: record.context.organizationId,
        workflowRunId,
        actor: runActor,
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      // Resuming drives the plan: a resume that only changed a state field would
      // leave the operator holding a "running" workflow that never takes a wave.
      const advanced = await orchestrator.advance({
        organizationId: record.context.organizationId,
        workflowRunId,
        actor: runActor,
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
        actor: { actorId: actor.actorId, roles: actor.roles, capabilities: actor.capabilities },
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      return toWorkflowRunDetail(cancelled);
    },

    async submitApproval(actor, request, meta) {
      requireWorkflowCapability(actor, 'workflow.approval.decide');
      const record = await loadScoped(actor, request.workflowRunId, undefined);
      const { requestId, correlationId } = trace(meta);
      const runActor = {
        actorId: actor.actorId,
        roles: actor.roles,
        capabilities: actor.capabilities,
      };

      const decided = await orchestrator.decideApproval({
        organizationId: record.context.organizationId,
        workflowRunId: request.workflowRunId,
        approvalId: request.approvalId,
        decision: request.decision === 'reject' ? 'reject' : 'approve',
        actor: runActor,
        reason: requireReason(request.reason),
        requestId,
        correlationId,
      });

      if (isTerminalWorkflowState(decided.state)) return toWorkflowRunDetail(decided);

      const advanced = await orchestrator.advance({
        organizationId: record.context.organizationId,
        workflowRunId: request.workflowRunId,
        actor: runActor,
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toWorkflowRunDetail(advanced);
    },

    async listPendingApprovals(actor, organizationId, limit) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const scope = workflowReadScopeFor(actor, organizationId);
      const requests = await approvals.gate.pending(scope, limit);
      // Expiry is derived on read, so a queue never offers a decision that can
      // no longer be made.
      const settled = await Promise.all(
        requests.map((request) => approvals.gate.expireIfDue(request)),
      );
      return settled
        .filter(
          (request) => request.state === 'pending' && request.requestingAgentId.startsWith('workflow:'),
        )
        .map(toWorkflowApprovalView);
    },

    listWorkflows(actor) {
      requireWorkflowCapability(actor, 'workflow.registry.read');
      return registry.list();
    },

    async overview(actor, organizationId) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const scope = workflowReadScopeFor(actor, organizationId);

      const records = await runs.list({ organizationId: scope, limit: 200 });
      const counts = Object.fromEntries(
        WORKFLOW_RUN_STATES.map((state) => [state, 0]),
      ) as Record<WorkflowRunState, number>;
      for (const record of records) counts[record.state] += 1;

      const active = records
        .filter((record) => WORKFLOW_ACTIVE_STATES.includes(record.state))
        .slice(0, 20)
        .map(toWorkflowRunSummary);
      const awaitingApproval = records
        .filter((record) => record.state === 'waiting_for_approval')
        .slice(0, 20)
        .map(toWorkflowRunSummary);
      const recentFailures = records
        .filter((record) =>
          ['failed', 'policy_denied', 'budget_exhausted', 'expired'].includes(record.state),
        )
        .slice(0, 20)
        .map(toWorkflowRunSummary);

      const pendingApprovals = await this.listPendingApprovals(actor, organizationId, 20);

      return {
        scope: actor.platformReader && organizationId ? 'platform' : 'organization',
        organizationId: scope,
        counts,
        active,
        awaitingApproval,
        recentFailures,
        pendingApprovals,
        registeredWorkflows: registry.size(),
        capabilities: workflowCapabilitiesOf(actor),
        generatedAt: clock.isoNow(),
      };
    },

    async optimization(actor, organizationId) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const scope = workflowReadScopeFor(actor, organizationId);

      // BOTH POPULATIONS. Agent runs carry the attribution rows and the
      // optimisation ledgers; workflow runs carry the workflow id that makes a
      // row attributable to a plan. Reporting only one would understate spend
      // for any deployment that uses the other.
      const agentRecords = await deps.agentRuns.list({ organizationId: scope, limit: 200 });
      const workflowRecords = await runs.list({ organizationId: scope, limit: 200 });

      const workflowByRunId = new Map<string, string>();
      for (const workflowRun of workflowRecords) {
        for (const agentRunId of workflowRun.agentRunIds) {
          workflowByRunId.set(agentRunId, workflowRun.context.workflowId);
        }
      }

      const sources: AttributionSource[] = agentRecords.map((record) => {
        const workflowId = workflowByRunId.get(record.context.runId);
        return {
          organizationId: record.context.organizationId,
          ...(workflowId === undefined ? {} : { workflowId }),
          attribution: record.tokens.attribution,
          optimization: coerceOptimizationLedger(record.optimization),
        };
      });

      const report = attributeFinancials({
        scope: actor.platformReader && organizationId ? 'platform' : 'organization',
        organizationId: scope,
        sources,
        generatedAt: clock.isoNow(),
      });

      return {
        ...report,
        cacheHitRatePercent: cacheHitRate(report.optimization),
        ...(deps.cacheStats === undefined ? {} : { cache: deps.cacheStats() }),
      };
    },

    recentAudit(actor, limit = 50) {
      requireWorkflowCapability(actor, 'workflow.run.read');
      const bounded = Math.min(200, Math.max(1, Math.floor(limit)));
      if (actor.platformReader) return audit.recent(bounded);
      // FILTER FIRST, THEN SLICE — the same remediation the agent trail carries.
      // Reading `bounded` records and filtering afterwards shows a tenant fewer
      // rows than it asked for whenever a busier tenant's records sit in front
      // of its own, and an audit trail that silently under-reports is worse than
      // one that reports nothing. The scan is over the store's retained window,
      // which is capacity-bound, so this stays a bounded read.
      return audit
        .recent(audit.size())
        .filter((record) => record.organizationId === actor.organization.organizationId)
        .slice(0, bounded);
    },
  };
}
