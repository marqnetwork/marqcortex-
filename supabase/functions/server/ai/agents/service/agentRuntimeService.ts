/**
 * Agent Runtime Service (AI-01 Batch 3A).
 *
 * The API-facing layer: authenticate, resolve the actor and the tenant, enforce
 * the capability, validate the request, call the orchestrator, and return a
 * read model that contains nothing a caller should not see.
 *
 * THREE THINGS THIS LAYER OWNS AND THE ORCHESTRATOR DOES NOT.
 *
 *   IDENTITY. The orchestrator takes an actor; this is where an actor comes
 *   from. Roles, capabilities and the organization are resolved from the
 *   authenticated subject through the same authenticator port the AI Guard uses
 *   — there is no second credential path and nothing a caller sends influences
 *   the outcome.
 *
 *   READ MODELS. A run record carries checkpointed progress, agent
 *   observations and step digests. What leaves this layer is a projection: no
 *   prompts, no completions, no tool payloads, no handoff payloads. An operator
 *   sees what happened, what it cost and why it stopped — never the content.
 *
 *   TENANT SCOPE ON EVERY READ. Every store call is keyed by the resolved
 *   organization. Only a platform reader may name another, and only for reads.
 *
 * WHAT IS DELIBERATELY NOT HERE: any way to create an agent, edit a definition,
 * register a tool or change a limit. Those are registry-time decisions made in
 * code and reviewed as code. Customer-created agents are explicitly out of
 * scope for this batch, and an API that could create one would be the whole of
 * that scope arriving through the back door.
 */

import type { AIAuthenticator } from '../../security/actor.ts';
import type { OrganizationResolutionOptions } from '../../security/tenancy.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Clock } from '../../runtime/clock.ts';
import type { AgentDescriptor } from '../contracts/agent.ts';
import type { ToolDescriptor } from '../contracts/tools.ts';
import type {
  AgentApprovalRequest,
  AgentRunRecord,
  AgentRunState,
} from '../contracts/runtime.ts';
import type { AgentRegistry } from '../registry/agentRegistry.ts';
import type { ToolGateway } from '../tools/toolRegistry.ts';
import type { AgentRunStore } from '../persistence/ports.ts';
import type { ApprovalGate } from '../approvals/approvalGate.ts';
import type { AgentAuditRecord, AgentAuditWriter } from '../observability/agentAudit.ts';
import type { AgentOrchestrator, AgentRunActor } from '../orchestrator/agentOrchestrator.ts';
import type { AgentRuntimeActor, AgentRuntimeCapability } from './agentRbac.ts';
import { readScopeFor, requireAgentCapability, resolveAgentActor } from './agentRbac.ts';
import { ACTIVE_STATES } from '../runtime/stateMachine.ts';
import { AGENT_RUN_STATES, isTerminalState } from '../contracts/runtime.ts';
import { agentFailure } from '../contracts/failures.ts';
import { adoptOrCreateId } from '../../contracts/ids.ts';

// ── Read models ─────────────────────────────────────────────────────────────

export interface AgentRunSummary {
  readonly runId: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly currentAgentId: string;
  readonly state: AgentRunState;
  readonly currentStep: number;
  readonly stepCount: number;
  readonly handoffCount: number;
  readonly retryCount: number;
  readonly actorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deadlineAt: string;
  readonly elapsedRuntimeMs: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly pendingApprovalId?: string;
  readonly failure?: string;
  readonly failureMessage?: string;
  readonly workflowId?: string;
  readonly parentRunId?: string;
}

export interface AgentRunDetail extends AgentRunSummary {
  readonly correlationId: string;
  readonly configurationVersion: number;
  readonly checkpointVersion: number;
  readonly planDigest: string;
  readonly resultDigest?: string;
  readonly tokens: AgentRunRecord['tokens'];
  readonly cost: AgentRunRecord['cost'];
  readonly transitions: AgentRunRecord['transitions'];
  readonly transitionsTruncated: number;
  readonly handoffs: AgentRunRecord['handoffs'];
  readonly limitsReached: readonly string[];
}

/** One step, with every content field reduced to a digest. */
export interface AgentStepView {
  readonly stepId: string;
  readonly sequence: number;
  readonly agentId: string;
  readonly actionId: string;
  readonly actionType: string;
  readonly reason: string;
  readonly outcome: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
  readonly failure?: string;
  readonly inputDigest: string;
  readonly outputDigest?: string;
  readonly estimatedPromptTokens: number;
  readonly estimatedCompletionTokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly actualPromptTokens?: number;
  readonly actualCompletionTokens?: number;
  readonly actualCostMicroUsd?: number;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly modelProfileId?: string;
  readonly toolId?: string;
  readonly targetAgentId?: string;
  readonly approvalId?: string;
  readonly executionRequestId?: string;
  readonly checkpointVersion: number;
}

export interface AgentRunUsage {
  readonly runId: string;
  readonly tokens: AgentRunRecord['tokens'];
  readonly cost: AgentRunRecord['cost'];
  readonly stepCount: number;
  readonly handoffCount: number;
  readonly elapsedRuntimeMs: number;
}

/** The operator overview. Counts and a bounded window, never every run. */
export interface AgentRuntimeOverview {
  readonly scope: 'organization' | 'platform';
  readonly organizationId?: string;
  readonly counts: Readonly<Record<AgentRunState, number>>;
  readonly active: readonly AgentRunSummary[];
  readonly awaitingApproval: readonly AgentRunSummary[];
  readonly recentFailures: readonly AgentRunSummary[];
  readonly pendingApprovals: readonly AgentApprovalView[];
  readonly registeredAgents: number;
  readonly registeredTools: number;
  readonly capabilities: readonly AgentRuntimeCapability[];
  readonly generatedAt: string;
}

export interface AgentApprovalView {
  readonly approvalId: string;
  readonly runId: string;
  readonly actionId: string;
  readonly organizationId: string;
  readonly requestingAgentId: string;
  readonly actionType: string;
  readonly impactSummary: string;
  readonly dataAffected: readonly string[];
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
  readonly reason: string;
  readonly authorizedApproverRoles: readonly string[];
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly state: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
}

// ── Projections ─────────────────────────────────────────────────────────────

export function toRunSummary(record: AgentRunRecord): AgentRunSummary {
  return {
    runId: record.context.runId,
    organizationId: record.context.organizationId,
    agentId: record.context.agentId,
    agentVersion: record.context.agentVersion,
    currentAgentId: record.currentAgentId,
    state: record.state,
    currentStep: record.currentStep,
    stepCount: record.stepCount,
    handoffCount: record.handoffCount,
    retryCount: record.retryCount,
    actorId: record.context.actorId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deadlineAt: record.deadlineAt,
    elapsedRuntimeMs: record.elapsedRuntimeMs,
    totalTokens: record.tokens.actualTotalTokens,
    costMicroUsd: record.cost.actualMicroUsd,
    ...(record.pendingApprovalId === undefined
      ? {}
      : { pendingApprovalId: record.pendingApprovalId }),
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    ...(record.failureMessage === undefined ? {} : { failureMessage: record.failureMessage }),
    ...(record.context.workflowId === undefined ? {} : { workflowId: record.context.workflowId }),
    ...(record.context.parentRunId === undefined
      ? {}
      : { parentRunId: record.context.parentRunId }),
  };
}

/** Limit events, derived rather than stored, so they cannot drift. */
function limitsReached(record: AgentRunRecord): readonly string[] {
  const events: string[] = [];
  if (record.failure) events.push(record.failure);
  if (record.loop.noProgressStreak > 0) events.push(`no_progress_streak:${record.loop.noProgressStreak}`);
  if (record.retryCount > 0) events.push(`retries:${record.retryCount}`);
  const repeated = Object.values(record.loop.actionCounts).reduce(
    (max, count) => Math.max(max, count),
    0,
  );
  if (repeated > 1) events.push(`repeated_action:${repeated}`);
  return events;
}

export function toRunDetail(record: AgentRunRecord): AgentRunDetail {
  return {
    ...toRunSummary(record),
    correlationId: record.context.correlationId,
    configurationVersion: record.configurationVersion,
    checkpointVersion: record.checkpointVersion,
    planDigest: record.planDigest,
    ...(record.resultDigest === undefined ? {} : { resultDigest: record.resultDigest }),
    tokens: record.tokens,
    cost: record.cost,
    transitions: record.transitions,
    transitionsTruncated: record.transitionsTruncated,
    handoffs: record.handoffs,
    limitsReached: limitsReached(record),
  };
}

export function toStepViews(record: AgentRunRecord): readonly AgentStepView[] {
  return record.steps.map((step) => ({
    stepId: step.stepId,
    sequence: step.sequence,
    agentId: step.agentId,
    actionId: step.actionId,
    actionType: step.actionType,
    reason: step.reason,
    outcome: step.outcome,
    attempt: step.attempt,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    latencyMs: step.latencyMs,
    inputDigest: step.inputDigest,
    estimatedPromptTokens: step.estimatedPromptTokens,
    estimatedCompletionTokens: step.estimatedCompletionTokens,
    estimatedCostMicroUsd: step.estimatedCostMicroUsd,
    checkpointVersion: step.checkpointVersion,
    ...(step.failure === undefined ? {} : { failure: step.failure }),
    ...(step.outputDigest === undefined ? {} : { outputDigest: step.outputDigest }),
    ...(step.actualPromptTokens === undefined
      ? {}
      : { actualPromptTokens: step.actualPromptTokens }),
    ...(step.actualCompletionTokens === undefined
      ? {}
      : { actualCompletionTokens: step.actualCompletionTokens }),
    ...(step.actualCostMicroUsd === undefined
      ? {}
      : { actualCostMicroUsd: step.actualCostMicroUsd }),
    ...(step.providerId === undefined ? {} : { providerId: step.providerId }),
    ...(step.modelId === undefined ? {} : { modelId: step.modelId }),
    ...(step.modelProfileId === undefined ? {} : { modelProfileId: step.modelProfileId }),
    ...(step.toolId === undefined ? {} : { toolId: step.toolId }),
    ...(step.targetAgentId === undefined ? {} : { targetAgentId: step.targetAgentId }),
    ...(step.approvalId === undefined ? {} : { approvalId: step.approvalId }),
    ...(step.executionRequestId === undefined
      ? {}
      : { executionRequestId: step.executionRequestId }),
  }));
}

export function toApprovalView(request: AgentApprovalRequest): AgentApprovalView {
  return {
    approvalId: request.approvalId,
    runId: request.runId,
    actionId: request.actionId,
    organizationId: request.organizationId,
    requestingAgentId: request.requestingAgentId,
    actionType: request.actionType,
    impactSummary: request.impactSummary,
    dataAffected: request.dataAffected,
    estimatedAdditionalTokens: request.estimatedAdditionalTokens,
    estimatedAdditionalCostMicroUsd: request.estimatedAdditionalCostMicroUsd,
    reason: request.reason,
    authorizedApproverRoles: request.authorizedApproverRoles,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    state: request.state,
    ...(request.decidedBy === undefined ? {} : { decidedBy: request.decidedBy }),
    ...(request.decidedAt === undefined ? {} : { decidedAt: request.decidedAt }),
  };
}

// ── Service ─────────────────────────────────────────────────────────────────

export interface AgentRuntimeServiceDependencies {
  readonly orchestrator: AgentOrchestrator;
  readonly registry: AgentRegistry;
  readonly tools: ToolGateway;
  readonly runs: AgentRunStore;
  readonly approvals: ApprovalGate;
  readonly audit: AgentAuditWriter;
  readonly authenticator: AIAuthenticator;
  readonly organizationOptions: OrganizationResolutionOptions;
  readonly clock: Clock;
  readonly ids: IdFactory;
}

export interface AgentRequestMeta {
  readonly authorization: string | null;
  readonly correlationId?: string;
  readonly organizationHint?: string;
  readonly clientIp?: string;
}

export interface CreateRunRequest {
  readonly agentId: string;
  readonly objective: string;
  readonly input: unknown;
  readonly workflowId?: string;
  readonly surface?: 'team_console' | 'client_portal' | 'system';
  readonly feature?: string;
}

export interface ListRunsRequest {
  readonly states?: readonly AgentRunState[];
  readonly agentId?: string;
  readonly limit?: number;
  /** Platform readers only. Ignored for everyone else. */
  readonly organizationId?: string;
}

export interface AgentRuntimeService {
  /** Resolve the caller. Throws on anything unauthenticated or unpermitted. */
  authorize(meta: AgentRequestMeta): Promise<AgentRuntimeActor>;
  createRun(
    actor: AgentRuntimeActor,
    request: CreateRunRequest,
    meta: AgentRequestMeta,
  ): Promise<AgentRunDetail>;
  getRun(actor: AgentRuntimeActor, runId: string, organizationId?: string): Promise<AgentRunDetail>;
  listRuns(actor: AgentRuntimeActor, request: ListRunsRequest): Promise<readonly AgentRunSummary[]>;
  pauseRun(
    actor: AgentRuntimeActor,
    runId: string,
    reason: unknown,
    meta: AgentRequestMeta,
  ): Promise<AgentRunDetail>;
  resumeRun(
    actor: AgentRuntimeActor,
    runId: string,
    reason: unknown,
    meta: AgentRequestMeta,
  ): Promise<AgentRunDetail>;
  cancelRun(
    actor: AgentRuntimeActor,
    runId: string,
    reason: unknown,
    meta: AgentRequestMeta,
  ): Promise<AgentRunDetail>;
  retryRun(
    actor: AgentRuntimeActor,
    runId: string,
    reason: unknown,
    meta: AgentRequestMeta,
  ): Promise<AgentRunDetail>;
  submitApproval(
    actor: AgentRuntimeActor,
    request: { runId: string; approvalId: string; decision: 'approve' | 'reject'; reason: unknown },
    meta: AgentRequestMeta,
  ): Promise<AgentRunDetail>;
  listPendingApprovals(
    actor: AgentRuntimeActor,
    organizationId?: string,
    limit?: number,
  ): Promise<readonly AgentApprovalView[]>;
  getRunSteps(
    actor: AgentRuntimeActor,
    runId: string,
    organizationId?: string,
  ): Promise<readonly AgentStepView[]>;
  getRunUsage(
    actor: AgentRuntimeActor,
    runId: string,
    organizationId?: string,
  ): Promise<AgentRunUsage>;
  listAgents(actor: AgentRuntimeActor): readonly AgentDescriptor[];
  listTools(actor: AgentRuntimeActor): readonly ToolDescriptor[];
  overview(actor: AgentRuntimeActor, organizationId?: string): Promise<AgentRuntimeOverview>;
  /** The agent runtime audit trail, scoped to what this actor may see. */
  recentAudit(actor: AgentRuntimeActor, limit?: number): readonly AgentAuditRecord[];
}

const MAX_REASON = 300;
const MIN_REASON = 3;

function requireReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    throw agentFailure('invalid_action', 'A reason is required.', {
      diagnostics: `reason length ${reason.length} is outside ${MIN_REASON}–${MAX_REASON}`,
    });
  }
  return reason;
}

export function createAgentRuntimeService(
  deps: AgentRuntimeServiceDependencies,
): AgentRuntimeService {
  const { orchestrator, registry, tools, runs, approvals, audit, clock, ids } = deps;

  function runActor(actor: AgentRuntimeActor): AgentRunActor {
    return {
      actorId: actor.actorId,
      roles: actor.roles,
      capabilities: actor.capabilities,
    };
  }

  function trace(meta: AgentRequestMeta): { requestId: string; correlationId: string } {
    return {
      requestId: ids.next('req'),
      correlationId: adoptOrCreateId(meta.correlationId, 'cor', ids),
    };
  }

  /** Load a run the actor is entitled to see. Tenant scope is not negotiable. */
  async function loadScoped(
    actor: AgentRuntimeActor,
    runId: string,
    organizationId: string | undefined,
  ): Promise<AgentRunRecord> {
    const scope = readScopeFor(actor, organizationId);
    const record = await runs.load(scope, runId);
    if (!record) {
      // A run in another tenant and a run that does not exist are the same
      // answer on purpose: distinguishing them would turn this endpoint into a
      // way to test whether an id exists somewhere else.
      throw agentFailure('run_not_found', 'That run could not be found.', {
        runId,
        diagnostics: `run ${runId} not visible to ${actor.actorId} in scope ${scope}`,
      });
    }
    return record;
  }

  return {
    async authorize(meta) {
      // Authoritative: an agent run is `ai.agent.execute`, the capability a
      // demotion most needs to be able to take away at once (M-A).
      const subject = meta.authorization
        ? await deps.authenticator.authenticate(meta.authorization, { privileged: true })
        : null;
      return resolveAgentActor(subject, meta.organizationHint, deps.organizationOptions);
    },

    async createRun(actor, request, meta) {
      requireAgentCapability(actor, 'agent.run.create');
      const { requestId, correlationId } = trace(meta);

      const created = await orchestrator.createRun({
        agentId: String(request.agentId ?? ''),
        organizationId: actor.organization.organizationId,
        actor: runActor(actor),
        objective: String(request.objective ?? ''),
        input: request.input,
        requestId,
        correlationId,
        origin: {
          surface: request.surface ?? 'team_console',
          feature: (request.feature ?? 'agent_runtime').slice(0, 60),
        },
        ...(request.workflowId === undefined ? {} : { workflowId: request.workflowId }),
      });

      // Created and driven in one call. A run that is created and then left
      // un-driven looks identical to a stuck one, and the caller has no way to
      // tell the difference — so creation starts it, and the response says
      // exactly where it got to.
      const advanced = await orchestrator.advance({
        organizationId: actor.organization.organizationId,
        runId: created.context.runId,
        actor: runActor(actor),
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toRunDetail(advanced);
    },

    async getRun(actor, runId, organizationId) {
      requireAgentCapability(actor, 'agent.run.read');
      return toRunDetail(await loadScoped(actor, runId, organizationId));
    },

    async listRuns(actor, request) {
      requireAgentCapability(actor, 'agent.run.read');
      const scope = readScopeFor(actor, request.organizationId);
      const states = (request.states ?? []).filter((state) =>
        (AGENT_RUN_STATES as readonly string[]).includes(state),
      );
      const records = await runs.list({
        organizationId: scope,
        ...(states.length > 0 ? { states } : {}),
        ...(request.agentId === undefined ? {} : { agentId: request.agentId }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      return records.map(toRunSummary);
    },

    async pauseRun(actor, runId, reason, meta) {
      requireAgentCapability(actor, 'agent.run.control');
      const record = await loadScoped(actor, runId, undefined);
      const { requestId, correlationId } = trace(meta);
      const paused = await orchestrator.pause({
        organizationId: record.context.organizationId,
        runId,
        actor: runActor(actor),
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      return toRunDetail(paused);
    },

    async resumeRun(actor, runId, reason, meta) {
      requireAgentCapability(actor, 'agent.run.control');
      const record = await loadScoped(actor, runId, undefined);
      const { requestId, correlationId } = trace(meta);
      await orchestrator.resume({
        organizationId: record.context.organizationId,
        runId,
        actor: runActor(actor),
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      // Resuming drives the run: a resume that only changed a state field would
      // leave the operator holding a "running" run that never takes a step.
      const advanced = await orchestrator.advance({
        organizationId: record.context.organizationId,
        runId,
        actor: runActor(actor),
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toRunDetail(advanced);
    },

    async cancelRun(actor, runId, reason, meta) {
      requireAgentCapability(actor, 'agent.run.control');
      const record = await loadScoped(actor, runId, undefined);
      const { requestId, correlationId } = trace(meta);
      const cancelled = await orchestrator.cancel({
        organizationId: record.context.organizationId,
        runId,
        actor: runActor(actor),
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      return toRunDetail(cancelled);
    },

    async retryRun(actor, runId, reason, meta) {
      requireAgentCapability(actor, 'agent.run.control');
      requireAgentCapability(actor, 'agent.run.create');
      const record = await loadScoped(actor, runId, undefined);
      if (!isTerminalState(record.state)) {
        throw agentFailure('invalid_action', 'Only a finished run can be retried.', {
          runId,
          diagnostics: `run state is ${record.state}`,
        });
      }
      const { requestId, correlationId } = trace(meta);
      const forked = await orchestrator.retry({
        organizationId: record.context.organizationId,
        runId,
        actor: runActor(actor),
        reason: requireReason(reason),
        requestId,
        correlationId,
      });
      const advanced = await orchestrator.advance({
        organizationId: forked.context.organizationId,
        runId: forked.context.runId,
        actor: runActor(actor),
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toRunDetail(advanced);
    },

    async submitApproval(actor, request, meta) {
      requireAgentCapability(actor, 'agent.approval.decide');
      const record = await loadScoped(actor, request.runId, undefined);
      const { requestId, correlationId } = trace(meta);

      const decided = await orchestrator.decideApproval({
        organizationId: record.context.organizationId,
        runId: request.runId,
        approvalId: request.approvalId,
        decision: request.decision === 'reject' ? 'reject' : 'approve',
        actor: runActor(actor),
        reason: requireReason(request.reason),
        requestId,
        correlationId,
      });

      if (isTerminalState(decided.state)) return toRunDetail(decided);

      const advanced = await orchestrator.advance({
        organizationId: record.context.organizationId,
        runId: request.runId,
        actor: runActor(actor),
        authorization: meta.authorization,
        requestId,
        correlationId,
        ...(meta.clientIp === undefined ? {} : { clientIp: meta.clientIp }),
      });
      return toRunDetail(advanced);
    },

    async listPendingApprovals(actor, organizationId, limit) {
      requireAgentCapability(actor, 'agent.run.read');
      const scope = readScopeFor(actor, organizationId);
      const requests = await approvals.pending(scope, limit);
      // Expiry is derived on read, so a queue never offers a decision that can
      // no longer be made.
      const settled = await Promise.all(requests.map((request) => approvals.expireIfDue(request)));
      return settled.filter((request) => request.state === 'pending').map(toApprovalView);
    },

    async getRunSteps(actor, runId, organizationId) {
      requireAgentCapability(actor, 'agent.run.read');
      return toStepViews(await loadScoped(actor, runId, organizationId));
    },

    async getRunUsage(actor, runId, organizationId) {
      requireAgentCapability(actor, 'agent.run.read');
      const record = await loadScoped(actor, runId, organizationId);
      return {
        runId: record.context.runId,
        tokens: record.tokens,
        cost: record.cost,
        stepCount: record.stepCount,
        handoffCount: record.handoffCount,
        elapsedRuntimeMs: record.elapsedRuntimeMs,
      };
    },

    listAgents(actor) {
      requireAgentCapability(actor, 'agent.registry.read');
      return registry.list();
    },

    listTools(actor) {
      requireAgentCapability(actor, 'agent.registry.read');
      // Every registered tool, with its governance. Not filtered by agent: an
      // operator needs to see what exists and how it is classified, and a tool
      // descriptor carries no data — only its rules.
      return tools.list();
    },

    async overview(actor, organizationId) {
      requireAgentCapability(actor, 'agent.run.read');
      const scope = readScopeFor(actor, organizationId);

      const records = await runs.list({ organizationId: scope, limit: 200 });
      const counts = Object.fromEntries(
        AGENT_RUN_STATES.map((state) => [state, 0]),
      ) as Record<AgentRunState, number>;
      for (const record of records) counts[record.state] += 1;

      const active = records
        .filter((record) => ACTIVE_STATES.includes(record.state))
        .slice(0, 20)
        .map(toRunSummary);
      const awaitingApproval = records
        .filter((record) => record.state === 'waiting_for_approval')
        .slice(0, 20)
        .map(toRunSummary);
      const recentFailures = records
        .filter((record) =>
          ['failed', 'policy_denied', 'budget_exhausted', 'expired'].includes(record.state),
        )
        .slice(0, 20)
        .map(toRunSummary);

      const pending = await this.listPendingApprovals(actor, organizationId, 20);

      return {
        scope: actor.platformReader && organizationId ? 'platform' : 'organization',
        organizationId: scope,
        counts,
        active,
        awaitingApproval,
        recentFailures,
        pendingApprovals: pending,
        registeredAgents: registry.size(),
        registeredTools: tools.list().length,
        capabilities: actor.capabilities,
        generatedAt: clock.isoNow(),
      };
    },

    recentAudit(actor, limit = 50) {
      requireAgentCapability(actor, 'agent.run.read');
      const bounded = Math.min(200, Math.max(1, Math.floor(limit)));
      if (actor.platformReader) return audit.recent(bounded);
      // FILTER FIRST, THEN SLICE. Reading `bounded` records and filtering
      // afterwards showed a tenant fewer rows than it asked for whenever a
      // busier tenant's records sat in front of its own — an audit trail that
      // silently under-reports is worse than one that reports nothing. The
      // scan is over the store's own retained window, which is capacity-bound
      // (`auditBufferSize`), so this stays a bounded read.
      return audit
        .recent(audit.size())
        .filter((record) => record.organizationId === actor.organization.organizationId)
        .slice(0, bounded);
    },
  };
}
