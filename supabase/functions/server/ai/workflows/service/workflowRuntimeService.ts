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
  readonly steps: readonly WorkflowStepRecord[];
  readonly transitions: WorkflowRunRecord['transitions'];
  readonly transitionsTruncated: number;
  readonly startedAt?: string;
  readonly endedAt?: string;
}

/** The operator overview. Counts and a bounded window, never every run. */
export interface WorkflowRuntimeOverview {
  readonly scope: 'organization' | 'platform';
  readonly organizationId: string;
  readonly counts: Readonly<Record<WorkflowRunState, number>>;
  readonly active: readonly WorkflowRunSummary[];
  readonly recentFailures: readonly WorkflowRunSummary[];
  readonly registeredWorkflows: number;
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
export function toWorkflowRunDetail(record: WorkflowRunRecord): WorkflowRunDetail {
  return {
    ...toWorkflowRunSummary(record),
    correlationId: record.context.correlationId,
    configurationVersion: record.configurationVersion,
    checkpointVersion: record.checkpointVersion,
    inputDigest: record.inputDigest,
    ...(record.resultDigest === undefined ? {} : { resultDigest: record.resultDigest }),
    childAgentRunIds: record.childAgentRunIds,
    ...(record.pendingNode === undefined ? {} : { pendingNode: record.pendingNode }),
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
}

export interface WorkflowRuntimeServiceDependencies {
  readonly orchestrator: WorkflowOrchestrator;
  readonly registry: WorkflowRegistry;
  readonly runs: WorkflowRunStore;
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
        capabilities: actor.capabilities,
        generatedAt: deps.clock.isoNow(),
      };
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
