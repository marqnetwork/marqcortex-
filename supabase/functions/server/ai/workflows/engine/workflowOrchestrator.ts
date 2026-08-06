/**
 * The Workflow Execution Engine (AI-01 Batch 3B, Part 2).
 *
 * Drives a workflow run along a plan, one node at a time, through the Batch 3A
 * Agent Orchestrator. It decides ORDER and nothing else.
 *
 * ── WHAT THIS ENGINE IS NOT ALLOWED TO DECIDE ──────────────────────────────
 *
 * Whether an agent may call a model, which model, what it may spend, which
 * tools it may reach, whether a human must approve first, how many steps it
 * gets, whether it is looping, whether it is certified. Every one of those is
 * decided by the Agent Orchestrator on the child run, and the engine cannot
 * influence any of them because it holds no provider, no plane, no gateway and
 * no agent definition — only `WorkflowAgentPort`, which returns four fields.
 * See `engine/agentNodePort.ts` for why that boundary is a module rather than a
 * rule.
 *
 * ── THE ORDERING THAT MAKES RECOVERY REAL ──────────────────────────────────
 *
 * For every node, in this order and no other:
 *
 *   1. CREATE the child agent run. Durable, and inert — the orchestrator
 *      persists it in `created` and executes nothing.
 *   2. PERSIST the workflow record carrying `pendingNode`, with the child's id.
 *   3. DRIVE the child. This is the first moment anything external happens.
 *
 * An isolate that dies between 2 and 3 comes back, reads `pendingNode`, and
 * drives THE SAME child — no second agent run, no repeated effect. That is the
 * whole reason `create` and `drive` are separate calls on the port.
 *
 * The narrow window is between 1 and 2: a crash there leaves a child agent run
 * that no workflow points at. It is stated here rather than hidden because the
 * consequence is bounded and worth knowing — the orphan was never driven, so it
 * holds no spend and had no effect, and it reaches `expired` on its own
 * deadline. Closing the window entirely would need the orchestrator to accept a
 * caller-supplied run id, which is a change to Batch 3A's contract and not
 * something Part 2 should reach for.
 *
 * ── SEQUENTIAL MEANS SEQUENTIAL ────────────────────────────────────────────
 *
 * One current node. One successor, taken from the plan. A durable write after
 * every node that reaches a terminal outcome. No fan-out, no conditions, no
 * joins, no approvals at the workflow level, and NO RETRIES — a node that fails
 * fails the run. `maxAttempts` is carried on the plan and never spent, and a
 * failed run is restarted as a NEW run, never reopened.
 *
 * ── NODES ARE SEQUENCED, NOT CHAINED BY DATA ───────────────────────────────
 *
 * Every node receives the workflow run's validated input. There is no mapping
 * of node N's output into node N+1's input, because a mapping language is a
 * expression evaluator, and an expression evaluator is the same machinery
 * conditions need — which is Part 3. What Part 2 does record is each node's
 * output DIGEST, so the data flow that arrives later has something to be
 * checked against. Pretending to chain data by quietly passing the previous
 * output would be a semantics nobody specified.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Logger } from '../../observability/logger.ts';
import type { Metrics } from '../../observability/metrics.ts';
import type { WorkflowPlan, WorkflowPlanStep } from '../contracts/plan.ts';
import type { WorkflowDefinition } from '../contracts/workflow.ts';
import type {
  WorkflowPendingNode,
  WorkflowRunContext,
  WorkflowRunOperation,
  WorkflowRunOrigin,
  WorkflowRunRecord,
  WorkflowRunState,
  WorkflowStepRecord,
  WorkflowTransitionRecord,
} from '../contracts/run.ts';
import type { WorkflowRegistry } from '../registry/workflowRegistry.ts';
import type { WorkflowRunStore } from '../persistence/ports.ts';
import type { AgentNodeHandle, WorkflowAgentActor, WorkflowAgentPort } from './agentNodePort.ts';
import {
  MAX_WORKFLOW_TRANSITION_HISTORY,
  WORKFLOW_RUN_BOUNDS,
  isTerminalWorkflowState,
} from '../contracts/run.ts';
import { WorkflowError, isWorkflowError, terminalStateFor, workflowFailure } from '../contracts/failures.ts';
import { assertTransition } from '../runtime/workflowStateMachine.ts';
import { isFailure } from '../../security/validation.ts';
// Canonical serialization only. `runtime/digest.ts` is a pure, bounded
// serializer with no agent semantics — the same one Part 1's plan digest uses —
// and duplicating it here would be a second canonical form to keep in step with
// the first. The boundary scan exempts it by name for exactly this reason.
import { canonicalBytes, digestValue } from '../../agents/runtime/digest.ts';

/** The administrative and health facts the engine reads before every advance. */
export interface WorkflowRuntimeState {
  readonly aiEnabled: boolean;
  readonly executionAvailable: boolean;
  readonly requireCertifiedWorkflows: boolean;
  readonly configurationVersion: number;
}

/**
 * The actor, in the two vocabularies it needs.
 *
 * `capabilities` are workflow capabilities, checked by the service layer.
 * `agent` is the SAME person as the agent runtime sees them, resolved from the
 * same authenticated subject. Carrying both is deliberate: a person who may run
 * workflows but holds no agent-runtime permission is refused by the Agent
 * Orchestrator at the first node, which is exactly right — a workflow must not
 * be a way to acquire a permission its operator does not have.
 */
export interface WorkflowRunActor {
  readonly actorId: string;
  readonly roles: readonly string[];
  readonly capabilities: readonly string[];
  readonly agent: WorkflowAgentActor;
}

export interface WorkflowOrchestratorDependencies {
  readonly registry: WorkflowRegistry;
  readonly runs: WorkflowRunStore;
  readonly agents: WorkflowAgentPort;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly metrics: Metrics;
  /** Settings and health, read live so an operator change lands immediately. */
  readonly runtimeState: () => WorkflowRuntimeState;
}

export interface CreateWorkflowRunInput {
  readonly workflowId: string;
  readonly organizationId: string;
  readonly actor: WorkflowRunActor;
  readonly input: unknown;
  readonly requestId: string;
  readonly correlationId: string;
  readonly origin: WorkflowRunOrigin;
  /** Wall-clock budget for the whole run. Bounded by `WORKFLOW_RUN_BOUNDS`. */
  readonly runtimeMs?: number;
}

export interface AdvanceWorkflowInput {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly actor: WorkflowRunActor;
  /** The driving caller's credential, for the control plane. Never stored. */
  readonly authorization: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly clientIp?: string;
  /**
   * The version the caller believes the run is at.
   *
   * Optional, and when supplied it is enforced BEFORE anything is computed. A
   * console that read a run, showed it to somebody and then acted on that view
   * is asserting the view was still current; a run that moved on in between
   * gets a typed conflict rather than an action applied to a state nobody saw.
   */
  readonly expectedVersion?: number;
}

export interface WorkflowControlInput {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly actor: WorkflowRunActor;
  readonly reason: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly expectedVersion?: number;
}

export interface WorkflowOrchestrator {
  createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord>;
  /** Drive the run until it blocks, completes or fails. */
  advance(input: AdvanceWorkflowInput): Promise<WorkflowRunRecord>;
  pause(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  resume(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  cancel(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  /** Expire a run whose deadline has passed. Idempotent. */
  expireIfDue(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  load(organizationId: string, workflowRunId: string): Promise<WorkflowRunRecord | undefined>;
}

/**
 * Hard ceiling on one `advance` call.
 *
 * Not a limit on the workflow — the plan's own node count is that. This bounds
 * the DRIVE LOOP, so an invariant broken above it (a cursor that does not move,
 * a state that returns to itself) stops with a diagnostic instead of spinning
 * inside an edge isolate. Two internal transitions per node plus admission and
 * completion is the true worst case; the multiplier is slack, not headroom.
 */
const MAX_DRIVE_ITERATIONS = 4 * WORKFLOW_RUN_BOUNDS.maxStepHistory + 8;

export function createWorkflowOrchestrator(
  deps: WorkflowOrchestratorDependencies,
): WorkflowOrchestrator {
  const { registry, runs, agents, clock, ids, logger, metrics } = deps;

  // ── Small helpers ─────────────────────────────────────────────────────────

  function boundedRuntimeMs(requested: number | undefined): number {
    const bounds = WORKFLOW_RUN_BOUNDS.runtimeMs;
    if (typeof requested !== 'number' || !Number.isFinite(requested)) return bounds.default;
    return Math.min(bounds.max, Math.max(bounds.min, Math.floor(requested)));
  }

  async function requireRun(
    organizationId: string,
    workflowRunId: string,
  ): Promise<WorkflowRunRecord> {
    const record = await runs.load(organizationId, workflowRunId);
    if (!record) {
      // A run belonging to another tenant is indistinguishable from one that
      // does not exist, and that is the point: a caller must not be able to
      // probe for the existence of another organization's runs.
      throw workflowFailure('workflow_run_not_found', 'That run is not available.', {
        workflowRunId,
        diagnostics: `organizationId=${organizationId} workflowRunId=${workflowRunId}`,
      });
    }
    return record;
  }

  function assertExpectedVersion(record: WorkflowRunRecord, expected: number | undefined): void {
    if (expected === undefined || expected === record.runVersion) return;
    throw workflowFailure('stale_workflow_version', 'This run has changed since it was read.', {
      workflowRunId: record.context.workflowRunId,
      diagnostics: `caller expected version ${expected}, current ${record.runVersion}`,
    });
  }

  function ring(
    existing: readonly WorkflowTransitionRecord[],
    next: WorkflowTransitionRecord,
  ): { readonly transitions: readonly WorkflowTransitionRecord[]; readonly dropped: number } {
    const all = [...existing, next];
    if (all.length <= MAX_WORKFLOW_TRANSITION_HISTORY) return { transitions: all, dropped: 0 };
    const overflow = all.length - MAX_WORKFLOW_TRANSITION_HISTORY;
    return { transitions: all.slice(overflow), dropped: overflow };
  }

  /**
   * The ONE place a workflow run's state changes.
   *
   * Asserts the transition, stamps the history, increments the version and
   * writes through the store under optimistic concurrency. There is no other
   * path — a state assigned anywhere else would be a state the machine never
   * agreed to and the store never versioned.
   */
  async function transition(
    record: WorkflowRunRecord,
    options: {
      readonly to: WorkflowRunState;
      readonly operation: WorkflowRunOperation | 'step';
      readonly reason: string;
      readonly actorId: string;
      readonly failure?: WorkflowRunRecord['failure'];
      readonly patch?: Partial<WorkflowRunRecord>;
    },
  ): Promise<WorkflowRunRecord> {
    const { to, operation, reason, actorId } = options;
    assertTransition({
      from: record.state,
      to,
      operation,
      currentVersion: record.runVersion,
      expectedVersion: record.runVersion,
      workflowRunId: record.context.workflowRunId,
    });

    const at = clock.isoNow();
    const runVersion = record.runVersion + 1;
    const history = ring(record.transitions, {
      at,
      from: record.state,
      to,
      operation,
      reason,
      actorId,
      runVersion,
      ...(options.failure === undefined ? {} : { failure: options.failure }),
    });

    const terminal = isTerminalWorkflowState(to);
    const next: WorkflowRunRecord = {
      ...record,
      ...options.patch,
      runVersion,
      state: to,
      transitions: history.transitions,
      transitionsTruncated: record.transitionsTruncated + history.dropped,
      updatedAt: at,
      elapsedRuntimeMs: Math.max(0, clock.now() - Date.parse(record.createdAt)),
      ...(record.startedAt === undefined && to === 'running' ? { startedAt: at } : {}),
      ...(terminal ? { endedAt: at } : {}),
      ...(options.failure === undefined ? {} : { failure: options.failure }),
    };

    await runs.save(next, record.runVersion);

    metrics.increment('ai.workflow.transition', {
      workflow: record.context.workflowId,
      to,
      operation,
    });
    logger.info('ai.workflow.transition', {
      workflowRunId: record.context.workflowRunId,
      workflowId: record.context.workflowId,
      from: record.state,
      to,
      operation,
      runVersion,
    });

    return next;
  }

  /**
   * End a run on a typed failure.
   *
   * The terminal state comes from the failure's own trait table, so "what does
   * this failure do to a run" is answered in one place rather than at each
   * throw site. A failure with no terminal trait is about the request, not the
   * run, and reaching here with one is a programming error worth surfacing.
   */
  async function terminate(
    record: WorkflowRunRecord,
    error: WorkflowError,
    actorId: string,
  ): Promise<WorkflowRunRecord> {
    const to = terminalStateFor(error.failure) ?? 'failed';
    return transition(record, {
      to,
      operation: 'fail',
      reason: error.message,
      actorId,
      failure: error.failure,
      patch: {
        failureMessage: error.message,
        // The cursor is cleared so a terminal record cannot be read as "still
        // sitting on node three". What ran is in `steps`.
        currentNodeId: undefined,
        pendingNode: undefined,
      },
    });
  }

  /**
   * Re-admit the run against the registry AS IT IS NOW.
   *
   * A deployment can disable a workflow, withdraw its certification or change
   * its definition between two nodes of a live run. Resolving once at creation
   * and trusting it forever would let a run that is no longer permitted finish
   * on the strength of a decision made minutes ago, so admission is re-checked
   * every time the run passes through `validating`.
   *
   * The plan digest is the sharp end of it: a changed definition produces a
   * changed digest, and a run whose remaining nodes are not the nodes it was
   * admitted with is denied rather than migrated. Migrating it would mean
   * guessing which node of the new plan corresponds to the cursor of the old.
   */
  function admit(record: WorkflowRunRecord): { plan: WorkflowPlan; definition: WorkflowDefinition } {
    // `require` enforces registration, revocation, the enable switch and the
    // certification requirement, and throws the typed failure for each.
    const definition = registry.require(record.context.workflowId);
    const plan = registry.requirePlan(record.context.workflowId);

    if (plan.digest !== record.context.planDigest) {
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowId: record.context.workflowId,
          workflowRunId: record.context.workflowRunId,
          diagnostics:
            `run admitted against plan ${record.context.planDigest} ` +
            `(version ${record.context.workflowVersion}), registry now holds ${plan.digest} ` +
            `(version ${plan.version})`,
        },
      );
    }
    return { plan, definition };
  }

  function stepFor(plan: WorkflowPlan, nodeId: string): WorkflowPlanStep | undefined {
    return plan.steps.find((step) => step.nodeId === nodeId);
  }

  // ── Node execution ────────────────────────────────────────────────────────

  /**
   * Phase 1 and 2 of the ordering: create the child, then persist the pointer.
   * Nothing external has happened when this returns.
   */
  async function beginNode(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    step: WorkflowPlanStep,
    input: AdvanceWorkflowInput,
    definition: WorkflowDefinition,
  ): Promise<WorkflowRunRecord> {
    const handle = await agents.create({
      agentId: step.agentId,
      organizationId: record.context.organizationId,
      actor: input.actor.agent,
      objective: objectiveFor(definition, step),
      // Every node receives the run's input — the same value, validated once at
      // creation and read back from the record. See the header: Part 2
      // sequences nodes, it does not chain their data.
      input: record.input,
      requestId: input.requestId,
      correlationId: record.context.correlationId,
      origin: record.context.origin,
      workflowId: record.context.workflowId,
    });

    const pendingNode: WorkflowPendingNode = {
      nodeId: step.nodeId,
      agentId: step.agentId,
      agentRunId: handle.agentRunId,
      startedAt: clock.isoNow(),
      sequence: step.index,
    };

    return transition(record, {
      to: 'waiting_for_agent',
      operation: 'step',
      reason: `Node ${step.nodeId} handed to ${step.agentId}.`,
      actorId: input.actor.actorId,
      patch: {
        pendingNode,
        childAgentRunIds: [...record.childAgentRunIds, handle.agentRunId],
      },
    });
  }

  /**
   * Phase 3: drive the child, and record the node when it reaches a terminal
   * outcome.
   *
   * A child that is merely blocked produces NO write. There is nothing new to
   * persist — the child's own record already holds why it stopped — and a write
   * per poll would burn a version on every operator refresh, turning a console
   * into a source of `stale_workflow_version` for the engine.
   */
  async function driveNode(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    input: AdvanceWorkflowInput,
  ): Promise<{ readonly record: WorkflowRunRecord; readonly blocked: boolean }> {
    const pending = record.pendingNode;
    if (!pending) {
      throw workflowFailure(
        'workflow_persistence_failed',
        'This run cannot be continued.',
        {
          workflowRunId: record.context.workflowRunId,
          diagnostics: 'run is waiting_for_agent with no pendingNode',
        },
      );
    }

    const handle = await agents.drive({
      organizationId: record.context.organizationId,
      agentRunId: pending.agentRunId,
      actor: input.actor.agent,
      authorization: input.authorization,
      requestId: input.requestId,
      correlationId: record.context.correlationId,
      ...(input.clientIp === undefined ? {} : { clientIp: input.clientIp }),
    });

    if (handle.state === 'running' || handle.state === 'blocked') {
      logger.info('ai.workflow.node.waiting', {
        workflowRunId: record.context.workflowRunId,
        nodeId: pending.nodeId,
        childAgentRunId: pending.agentRunId,
        childState: handle.childState,
      });
      return { record, blocked: true };
    }

    const step = stepFor(plan, pending.nodeId);
    const completedAt = clock.isoNow();
    const stepRecord: WorkflowStepRecord = {
      stepId: ids.next('wfs'),
      sequence: pending.sequence,
      nodeId: pending.nodeId,
      agentId: pending.agentId,
      childAgentRunId: pending.agentRunId,
      childState: handle.childState,
      startedAt: pending.startedAt,
      completedAt,
      latencyMs: Math.max(0, clock.now() - Date.parse(pending.startedAt)),
      outcome: handle.state === 'completed' ? 'completed' : 'failed',
      // Always 1. Part 2 implements no retries, and a field that silently
      // stayed at 1 while retries existed would be worse than no field.
      attempt: 1,
      ...(handle.resultDigest === undefined ? {} : { resultDigest: handle.resultDigest }),
      ...(handle.state === 'completed' ? {} : { failure: 'workflow_node_failed' as const }),
      checkpointVersion: record.checkpointVersion + 1,
    };

    if (handle.state === 'failed') {
      // The child already decided. No retry, no second attempt, no skipping to
      // the next node — a workflow whose node failed has failed.
      metrics.increment('ai.workflow.node.failed', {
        workflow: record.context.workflowId,
        node: pending.nodeId,
      });
      const failed = await transition(record, {
        to: 'failed',
        operation: 'fail',
        reason: `Node ${pending.nodeId} failed in agent run ${pending.agentRunId}.`,
        actorId: input.actor.actorId,
        failure: 'workflow_node_failed',
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          checkpointVersion: record.checkpointVersion + 1,
          pendingNode: undefined,
          currentNodeId: undefined,
          failureMessage: handle.failureMessage ?? 'A step of this workflow did not complete.',
        },
      });
      return { record: failed, blocked: false };
    }

    // The durable write after a completed node: the step is recorded, the
    // checkpoint pointer advances and the cursor moves to the single successor.
    // Absent successor means the plan is finished; completion is the NEXT
    // transition, from `running`, so "the last node finished" and "the run
    // completed" are two facts with two versions.
    metrics.increment('ai.workflow.node.completed', {
      workflow: record.context.workflowId,
      node: pending.nodeId,
    });
    const advanced = await transition(record, {
      to: 'running',
      operation: 'step',
      reason: `Node ${pending.nodeId} completed.`,
      actorId: input.actor.actorId,
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        checkpointVersion: record.checkpointVersion + 1,
        pendingNode: undefined,
        currentNodeId: step?.nextNodeId,
        ...(stepRecord.resultDigest === undefined
          ? {}
          : { resultDigest: stepRecord.resultDigest }),
      },
    });
    return { record: advanced, blocked: false };
  }

  function objectiveFor(definition: WorkflowDefinition, step: WorkflowPlanStep): string {
    return `${definition.displayName}: ${step.displayName}`.slice(0, 200);
  }

  // ── Public operations ─────────────────────────────────────────────────────

  return {
    load: (organizationId, workflowRunId) => runs.load(organizationId, workflowRunId),

    async createRun(input) {
      // Resolution happens BEFORE a record exists. A run created against a
      // disabled or uncertified workflow would be a durable record of something
      // that may never execute, and the caller would learn about it one advance
      // later than they should.
      const definition = registry.require(input.workflowId);
      const plan = registry.requirePlan(input.workflowId);

      const validated = definition.inputContract.validate(input.input, 'input');
      if (isFailure(validated)) {
        throw workflowFailure('workflow_input_invalid', 'That input is not valid for this workflow.', {
          workflowId: input.workflowId,
          diagnostics: validated.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; '),
        });
      }

      // The contract says the SHAPE is right; the bound says the value is one
      // the store is sized to hold and re-hand to every node. A contract that
      // permits a 20,000-character string permits sixty-four copies of it
      // across a full-length plan.
      const inputBytes = canonicalBytes(validated.value);
      if (inputBytes === undefined || inputBytes > WORKFLOW_RUN_BOUNDS.maxInputBytes) {
        throw workflowFailure('workflow_input_invalid', 'That input is too large for this workflow.', {
          workflowId: input.workflowId,
          diagnostics:
            inputBytes === undefined
              ? 'input could not be canonically serialized'
              : `input is ${inputBytes} bytes, above the ceiling of ${WORKFLOW_RUN_BOUNDS.maxInputBytes}`,
        });
      }

      const now = clock.now();
      const createdAt = clock.isoNow();
      const workflowRunId = ids.next('wfr');
      const context: WorkflowRunContext = {
        workflowRunId,
        correlationId: input.correlationId,
        requestId: input.requestId,
        organizationId: input.organizationId,
        actorId: input.actor.actorId,
        actorRoles: input.actor.roles,
        origin: input.origin,
        workflowId: definition.workflowId,
        workflowVersion: definition.version,
        planDigest: plan.digest,
      };

      const record: WorkflowRunRecord = {
        context,
        runVersion: 1,
        state: 'created',
        stepCount: 0,
        childAgentRunIds: [],
        steps: [],
        transitions: [],
        transitionsTruncated: 0,
        checkpointVersion: 0,
        input: validated.value,
        inputDigest: digestValue(validated.value),
        configurationVersion: deps.runtimeState().configurationVersion,
        createdAt,
        updatedAt: createdAt,
        deadlineAt: new Date(now + boundedRuntimeMs(input.runtimeMs)).toISOString(),
        elapsedRuntimeMs: 0,
      };

      // Persisted before anything else can happen to it. A run that exists in
      // memory but not in the store is a run a second isolate cannot see.
      await runs.create(record);
      metrics.increment('ai.workflow.run.created', { workflow: definition.workflowId });
      logger.info('ai.workflow.run.created', {
        workflowRunId,
        workflowId: definition.workflowId,
        workflowVersion: definition.version,
        planDigest: plan.digest,
        organizationId: input.organizationId,
      });
      return record;
    },

    async advance(input) {
      let record = await requireRun(input.organizationId, input.workflowRunId);
      assertExpectedVersion(record, input.expectedVersion);

      // Terminal records are returned, never reopened and never re-driven.
      if (isTerminalWorkflowState(record.state)) return record;

      const expired = await expireIfPastDeadline(record, input.actor.actorId);
      if (expired) return expired;

      // A paused run is not advanced by asking again. `resume` is the operation
      // that starts it, and making `advance` do it implicitly would mean an
      // operator's pause could be undone by a background driver.
      if (record.state === 'paused') return record;

      const guard = deps.runtimeState();
      if (!guard.aiEnabled) {
        throw workflowFailure(
          'workflow_runtime_disabled',
          'AI execution is currently unavailable.',
          {
            workflowRunId: record.context.workflowRunId,
            diagnostics: 'ai execution is administratively disabled',
          },
        );
      }

      let iterations = 0;
      for (;;) {
        if ((iterations += 1) > MAX_DRIVE_ITERATIONS) {
          throw workflowFailure('workflow_persistence_failed', 'This run could not be advanced.', {
            workflowRunId: record.context.workflowRunId,
            diagnostics: `drive loop exceeded ${MAX_DRIVE_ITERATIONS} iterations in ${record.state}`,
          });
        }

        try {
          const outcome = await driveOnce(record, input);
          if (outcome.done) return outcome.record;
          record = outcome.record;
        } catch (error) {
          // A typed failure that names a terminal state ENDS the run, durably,
          // rather than propagating as an exception that leaves the record in
          // whatever state it was read in. Everything else is a request-level
          // problem and is raised to the caller untouched.
          if (isWorkflowError(error) && terminalStateFor(error.failure) !== undefined) {
            return await terminate(record, error, input.actor.actorId);
          }
          throw error;
        }
      }
    },

    async pause(input) {
      const record = await loadForControl(input);
      return transition(record, {
        to: 'paused',
        operation: 'pause',
        reason: input.reason,
        actorId: input.actor.actorId,
      });
    },

    async resume(input) {
      const record = await loadForControl(input);
      return transition(record, {
        to: 'running',
        operation: 'resume',
        reason: input.reason,
        actorId: input.actor.actorId,
      });
    },

    async cancel(input) {
      const record = await loadForControl(input);

      // The child is stopped FIRST. Cancelling the workflow while leaving its
      // agent run driving would be a cancellation in name only — the effects
      // the operator is trying to stop are the child's.
      if (record.pendingNode) {
        try {
          await agents.cancel({
            organizationId: record.context.organizationId,
            agentRunId: record.pendingNode.agentRunId,
            actor: input.actor.agent,
            reason: `Parent workflow run ${record.context.workflowRunId} was cancelled.`,
            requestId: input.requestId,
            correlationId: record.context.correlationId,
          });
        } catch (error) {
          // A child that cannot be cancelled must not block the parent's
          // cancellation: the operator's instruction is the more important of
          // the two, and the child has its own deadline.
          logger.warn('ai.workflow.child_cancel_failed', {
            workflowRunId: record.context.workflowRunId,
            childAgentRunId: record.pendingNode.agentRunId,
            diagnostics: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return transition(record, {
        to: 'cancelled',
        operation: 'cancel',
        reason: input.reason,
        actorId: input.actor.actorId,
        patch: { pendingNode: undefined, currentNodeId: undefined },
      });
    },

    async expireIfDue(input) {
      const record = await requireRun(input.organizationId, input.workflowRunId);
      assertExpectedVersion(record, input.expectedVersion);
      if (isTerminalWorkflowState(record.state)) return record;
      return (await expireIfPastDeadline(record, input.actor.actorId)) ?? record;
    },
  };

  // ── Internals used by the operations above ────────────────────────────────

  async function loadForControl(input: WorkflowControlInput): Promise<WorkflowRunRecord> {
    const record = await requireRun(input.organizationId, input.workflowRunId);
    assertExpectedVersion(record, input.expectedVersion);
    return record;
  }

  /** Returns the expired record, or undefined when the deadline has not passed. */
  async function expireIfPastDeadline(
    record: WorkflowRunRecord,
    actorId: string,
  ): Promise<WorkflowRunRecord | undefined> {
    const deadline = Date.parse(record.deadlineAt);
    if (!Number.isFinite(deadline) || clock.now() < deadline) return undefined;
    metrics.increment('ai.workflow.run.expired', { workflow: record.context.workflowId });
    return transition(record, {
      to: 'expired',
      operation: 'expire',
      reason: 'The run passed its deadline.',
      actorId,
      failure: 'workflow_expired',
      patch: {
        failureMessage: 'This workflow run took longer than its deadline allowed.',
        pendingNode: undefined,
        currentNodeId: undefined,
      },
    });
  }

  /**
   * One turn of the drive loop.
   *
   * `done` means the caller gets this record back: the run is terminal, or it
   * is waiting on a child that has not finished. Everything else loops.
   */
  async function driveOnce(
    record: WorkflowRunRecord,
    input: AdvanceWorkflowInput,
  ): Promise<{ readonly record: WorkflowRunRecord; readonly done: boolean }> {
    switch (record.state) {
      case 'created':
        return {
          record: await transition(record, {
            to: 'validating',
            operation: 'start',
            reason: 'Re-checking the workflow against the registry.',
            actorId: input.actor.actorId,
          }),
          done: false,
        };

      case 'validating': {
        const { plan } = admit(record);
        return {
          record: await transition(record, {
            to: 'ready',
            operation: 'start',
            reason: `Admitted against plan ${plan.digest.slice(0, 12)}.`,
            actorId: input.actor.actorId,
            patch: { currentNodeId: plan.startNodeId },
          }),
          done: false,
        };
      }

      case 'ready':
        return {
          record: await transition(record, {
            to: 'running',
            operation: 'start',
            reason: `Starting at node ${record.currentNodeId ?? '(unset)'}.`,
            actorId: input.actor.actorId,
          }),
          done: false,
        };

      case 'running': {
        const { plan, definition } = admit(record);

        // No cursor means the plan is finished. This is the only path to
        // `completed`, and it is reached between nodes — never while a child
        // is in flight.
        if (!record.currentNodeId) {
          return {
            record: await transition(record, {
              to: 'completed',
              operation: 'complete',
              reason: `All ${record.steps.length} node(s) completed.`,
              actorId: input.actor.actorId,
            }),
            done: true,
          };
        }

        const step = stepFor(plan, record.currentNodeId);
        if (!step) {
          // The cursor names a node the plan does not have. The digest check in
          // `admit` should make this unreachable; if it is reached, the run is
          // stopped rather than advanced past a node nobody can identify.
          throw workflowFailure('workflow_plan_mismatch', 'This workflow has changed since the run started.', {
            workflowRunId: record.context.workflowRunId,
            nodeId: record.currentNodeId,
            diagnostics: `cursor node ${record.currentNodeId} is not in plan ${plan.digest}`,
          });
        }

        return { record: await beginNode(record, plan, step, input, definition), done: false };
      }

      case 'waiting_for_agent': {
        const { plan } = admit(record);
        const outcome = await driveNode(record, plan, input);
        return {
          record: outcome.record,
          done: outcome.blocked || isTerminalWorkflowState(outcome.record.state),
        };
      }

      default:
        // `paused` and every terminal state are handled before the loop starts.
        return { record, done: true };
    }
  }
}
