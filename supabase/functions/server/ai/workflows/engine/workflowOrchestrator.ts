/**
 * The Workflow Execution Engine (AI-01 Batch 3B, Parts 2, 3 and 4).
 *
 * Drives a workflow run along a plan, through the Batch 3A Agent Orchestrator.
 * It decides ORDER and DATA FLOW, and nothing else.
 *
 * ── WHAT THIS ENGINE IS NOT ALLOWED TO DECIDE ──────────────────────────────
 *
 * Whether an agent may call a model, which model, what it may spend, which
 * tools it may reach, whether a human must approve first, how many steps it
 * gets, whether it is looping, whether it is certified. Every one of those is
 * decided by the Agent Orchestrator on the child run, and the engine cannot
 * influence any of them because it holds no provider, no plane, no gateway and
 * no agent definition — only `WorkflowAgentPort`. See `engine/agentNodePort.ts`
 * for why that boundary is a module rather than a rule.
 *
 * ── THE ORDERING THAT MAKES RECOVERY REAL ──────────────────────────────────
 *
 * For every agent node, in this order and no other:
 *
 *   1. CREATE the child agent run. Durable, and inert — the orchestrator
 *      persists it in `created` and executes nothing.
 *   2. PERSIST the workflow record carrying `pendingNode`, with the child's id.
 *   3. DRIVE the child. This is the first moment anything external happens.
 *
 * An isolate that dies between 2 and 3 comes back, reads `pendingNode`, and
 * drives THE SAME child — no second agent run, no repeated effect. That is why
 * `create` and `drive` are separate calls on the port.
 *
 * And for every node that finishes, agent or condition:
 *
 *   4. WRITE the checkpoint — append-only, chained to the one before it.
 *   5. SAVE the run record, pointing at that checkpoint by version AND digest.
 *
 * Checkpoint first, deliberately. A crash between 4 and 5 leaves a checkpoint
 * nothing points at, and the next advance rewrites the identical one and adopts
 * it (see `writeCheckpoint`). The reverse order would leave a run pointing at a
 * checkpoint that does not exist, which recovery cannot distinguish from a
 * deleted one — and must therefore refuse.
 *
 * ── PARALLEL BRANCHES (PART 4) ─────────────────────────────────────────────
 *
 * A parallel node opens a bounded, named set of BRANCHES, each with its own
 * cursor, its own trusted outputs, its own version and its own child agent runs.
 * They live on the run record — see `contracts/parallel.ts` — so a recycled
 * isolate resumes a fan-out rather than restarting one.
 *
 * THE SAME THREE-PHASE ORDERING APPLIES INSIDE A BRANCH, unchanged: create the
 * child, persist the branch's `pendingNode`, then drive. That is why branches
 * advance ONE AT A TIME through the drive loop rather than being fired off
 * together with `Promise.all` — the ordering guarantee is per branch, and a
 * batch of concurrent writes to one versioned record would be a batch of lost
 * updates. What is parallel here is the WORK: several agent runs are in flight
 * at once, each blocked on its own approval or its own model, and the engine
 * makes progress on whichever can move. What is serialized is the bookkeeping,
 * because there is one record and it has one version.
 *
 * A branch that cannot progress this pass — its child is running or blocked —
 * is skipped for the remainder of the advance rather than re-polled, so one slow
 * branch never starves its siblings and never spins the loop.
 *
 * THE JOIN FIRES ONCE. `decideJoin` refuses a group that already carries
 * `joinedAt`, and `closeGroup` refuses to set it twice; both read durable state,
 * because a flag in isolate memory is `false` again in the next isolate.
 *
 * ── STILL NO RETRIES ───────────────────────────────────────────────────────
 *
 * A node that fails fails its line of execution — the run for a main-line node,
 * the branch for a branch node — and what a failed branch does to its siblings
 * is the group's declared failure policy, not a decision this engine makes.
 * `maxAttempts` is carried on the plan and never spent, and a failed run is
 * restarted as a NEW run, never reopened.
 *
 * ── LOOPS ARE BOUNDED IN TWO PLACES ────────────────────────────────────────
 *
 * Each loop declares its own iteration ceiling, checked when its back edge is
 * taken. And the RUN has a ceiling on total node executions, checked before
 * every node. The second is what makes the first meaningful: per-loop bounds
 * multiply under nesting, and three nested loops of thirty-two would be
 * thirty-two thousand agent runs with every individual bound respected.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Logger } from '../../observability/logger.ts';
import type { Metrics } from '../../observability/metrics.ts';
import type { WorkflowPlan, WorkflowPlanStep } from '../contracts/plan.ts';
import type { WorkflowDefinition } from '../contracts/workflow.ts';
import type { WorkflowCheckpoint } from '../contracts/checkpoint.ts';
import type { WorkflowMetadataField } from '../contracts/expression.ts';
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
import type { WorkflowCheckpointStore, WorkflowRunStore } from '../persistence/ports.ts';
import type { AgentNodeHandle, WorkflowAgentActor, WorkflowAgentPort } from './agentNodePort.ts';
import type { EvaluationScope } from '../runtime/expressionEvaluator.ts';
import type { DataState } from './dataFlow.ts';
import type {
  WorkflowBranchRecord,
  WorkflowParallelGroup,
} from '../contracts/parallel.ts';
import type {
  WorkflowAgentPlanStep,
  WorkflowConditionPlanStep,
  WorkflowParallelPlanStep,
} from '../contracts/plan.ts';
import {
  MAX_WORKFLOW_TRANSITION_HISTORY,
  WORKFLOW_RUN_BOUNDS,
  isTerminalWorkflowState,
} from '../contracts/run.ts';
import { WORKFLOW_CHECKPOINT_BOUNDS } from '../contracts/checkpoint.ts';
import { WORKFLOW_PARALLEL_BOUNDS, isTerminalBranchState } from '../contracts/parallel.ts';
import { isAgentStep, isJoinStep, isParallelStep } from '../contracts/plan.ts';
import {
  WorkflowError,
  isWorkflowError,
  terminalStateFor,
  workflowFailure,
} from '../contracts/failures.ts';
import { assertTransition } from '../runtime/workflowStateMachine.ts';
import { evaluateExpression } from '../runtime/expressionEvaluator.ts';
import { applyMapping } from '../runtime/mapper.ts';
import {
  computeCheckpointDigest,
  digestOutputs,
  summarizeParallelGroups,
} from '../runtime/checkpointChain.ts';
import { decideJoin, mergeBranchOutputs } from '../runtime/joinPolicy.ts';
import {
  applyBranchOutcome,
  applyBranchProgress,
  closeGroup,
  openGroupOf,
  openParallelGroup,
  upsertGroup,
} from './branchScheduler.ts';
import { emptyDataState, recoverDataState } from './dataFlow.ts';
import { isFailure } from '../../security/validation.ts';
// Canonical serialization only. `runtime/digest.ts` is a pure, bounded
// serializer with no agent semantics — the same one the plan digest uses — and
// duplicating it would be a second canonical form to keep in step with the
// first. The boundary scan exempts it by name for exactly this reason.
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
  readonly checkpoints: WorkflowCheckpointStore;
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
 * Not a limit on the workflow — `maxNodeExecutions` is that, and it is the one
 * that binds. This bounds the DRIVE LOOP, so an invariant broken above it (a
 * cursor that does not move, a state that returns to itself) stops with a
 * diagnostic instead of spinning inside an edge isolate.
 */
const MAX_DRIVE_ITERATIONS = 4 * WORKFLOW_RUN_BOUNDS.maxNodeExecutions + 16;

/**
 * What one `advance` call remembers about itself.
 *
 * `parkedBranches` is the only piece of per-call state in the engine, and it is
 * deliberately NOT durable: "this branch's child had not moved when we last
 * looked" is true of one moment, and persisting it would mean the next advance
 * inherits a stale reason to skip a branch that has since finished. It is reset
 * on every call, which is exactly the lifetime the fact has.
 */
interface AdvanceSession {
  readonly parkedBranches: Set<string>;
  /**
   * The branch advanced on the previous turn, so the next turn starts after it.
   *
   * This is what makes the fan-out actually overlap: without it the loop would
   * keep choosing the lowest-ordinal branch that could move, driving branch one
   * to completion before branch two had created its first child — parallel in
   * name and sequential in effect. Round-robin gets every branch's child in
   * flight before any of them is driven twice.
   */
  lastBranchId?: string;
}

export function createWorkflowOrchestrator(
  deps: WorkflowOrchestratorDependencies,
): WorkflowOrchestrator {
  const { registry, runs, checkpoints, agents, clock, ids, logger, metrics } = deps;

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
   * throw site.
   */
  async function terminate(
    stale: WorkflowRunRecord,
    error: WorkflowError,
    actorId: string,
  ): Promise<WorkflowRunRecord> {
    // RE-READ FIRST. The failure may have been raised after several versioned
    // writes — a parallel step writes once per branch turn before the join can
    // reject a merge — and terminating against the version the drive loop last
    // held would lose the compare-and-swap and surface a
    // `stale_workflow_version` in place of the real reason the run stopped.
    //
    // A run that reached a terminal state in the meantime is returned as it is:
    // something else already ended it, and terminal means terminal.
    const record =
      (await runs.load(stale.context.organizationId, stale.context.workflowRunId)) ?? stale;
    if (isTerminalWorkflowState(record.state)) return record;

    const to = terminalStateFor(error.failure) ?? 'failed';

    // An open parallel group is closed with the run. Its branch children are
    // not chased here — a run terminating on a typed failure may be doing so
    // because the store or the registry is unhappy, and a fan of remote
    // cancellations is the wrong thing to attempt on that path. The record
    // still stops claiming that branches are running, which is what a reader
    // needs. `cancel` is the operation that stops children, and it does.
    const open = openGroupOf(record.parallelGroups);
    const groups =
      open === undefined
        ? record.parallelGroups
        : upsertGroup(
            record.parallelGroups,
            closeGroup(open, {
              state: 'failed',
              at: clock.isoNow(),
              failure: error.failure,
            }),
          );

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
        parallelGroups: groups,
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
   * every time the engine needs the plan.
   *
   * The plan digest is the sharp end of it: a changed definition produces a
   * changed digest, and a run whose remaining nodes are not the nodes it was
   * admitted with is denied rather than migrated. Migrating it would mean
   * guessing which node of the new plan corresponds to the cursor of the old.
   */
  function admit(record: WorkflowRunRecord): {
    plan: WorkflowPlan;
    definition: WorkflowDefinition;
  } {
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

  // ── Data flow ─────────────────────────────────────────────────────────────

  /**
   * Everything a condition or a mapping may see, assembled fresh per evaluation.
   *
   * Note what the metadata carries and what it does not: identity and counters,
   * never a credential, never a setting, never another run. `result` is passed
   * only where an output mapping is being applied.
   */
  function scopeFor(
    record: WorkflowRunRecord,
    data: DataState,
    result?: { readonly value: unknown },
  ): EvaluationScope {
    const metadata: Record<WorkflowMetadataField, string | number> = {
      workflowId: record.context.workflowId,
      workflowVersion: record.context.workflowVersion,
      planDigest: record.context.planDigest,
      organizationId: record.context.organizationId,
      stepCount: record.stepCount,
      checkpointVersion: record.checkpointVersion,
    };
    return {
      input: record.input,
      nodeOutputs: data.outputs,
      metadata,
      loopIterations: data.loopIterations,
      nodeVisits: data.nodeVisits,
      stepsCompleted: record.stepCount,
      ...(result === undefined ? {} : { result: result.value }),
    };
  }

  /**
   * The same scope, seen from inside a branch (Part 4).
   *
   * A branch sees the run's own trusted outputs — everything the main line
   * produced BEFORE the fan-out — with its own outputs layered over the top. It
   * does NOT see a sibling's, and the omission is the isolation: two branches
   * that both run a node called `draft` read their own, and neither can
   * condition on work the join has not yet accepted.
   *
   * Sibling outputs become visible exactly once, as the merged value the join
   * stores under the join node's id, after the merge contract has accepted it.
   */
  function branchScopeFor(
    record: WorkflowRunRecord,
    data: DataState,
    branch: WorkflowBranchRecord,
    result?: { readonly value: unknown },
  ): EvaluationScope {
    const base = scopeFor(record, data, result);
    return {
      ...base,
      nodeOutputs: { ...data.outputs, ...branch.outputs },
      nodeVisits: { ...data.nodeVisits, ...branch.nodeVisits },
      stepsCompleted: branch.stepCount,
    };
  }

  /**
   * Write the next checkpoint, chained to the current one.
   *
   * IDEMPOTENT BY DESIGN. A crash between the checkpoint write and the run save
   * leaves an orphan checkpoint, and the retried advance recomputes an
   * identical one. Rather than failing on the conflict, the existing record is
   * read and compared: byte-identical means the previous attempt got this far
   * and the work is simply already done. Anything else is a genuine conflict —
   * two isolates that computed DIFFERENT next states for one version — and that
   * is refused, because adopting either would discard the other's decision.
   */
  async function writeCheckpoint(
    record: WorkflowRunRecord,
    data: DataState,
    facts: {
      readonly nodeId: string;
      readonly cursorNodeId?: string;
      readonly state: WorkflowRunState;
      /**
       * The groups AS THEY WILL BE SAVED, not as the record currently holds
       * them. The checkpoint is written before the run record — see the header
       * — so the summary has to describe the state the run is moving to, and a
       * retry after a crash recomputes the identical one from the identical
       * inputs.
       */
      readonly parallelGroups?: readonly WorkflowParallelGroup[];
    },
  ): Promise<WorkflowCheckpoint> {
    const version = record.checkpointVersion + 1;
    if (version > WORKFLOW_RUN_BOUNDS.maxCheckpoints) {
      throw workflowFailure('workflow_loop_exhausted', 'This run has taken too many steps.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: `checkpoint ${version} exceeds the ceiling of ${WORKFLOW_RUN_BOUNDS.maxCheckpoints}`,
      });
    }

    const outputsBytes = canonicalBytes(data.outputs);
    if (outputsBytes === undefined || outputsBytes > WORKFLOW_CHECKPOINT_BOUNDS.maxOutputsBytes) {
      throw workflowFailure(
        'workflow_output_rejected',
        'This workflow has accumulated more data than a run may carry.',
        {
          workflowRunId: record.context.workflowRunId,
          diagnostics:
            outputsBytes === undefined
              ? 'accumulated outputs could not be canonically serialized'
              : `accumulated outputs are ${outputsBytes} bytes, above ${WORKFLOW_CHECKPOINT_BOUNDS.maxOutputsBytes}`,
        },
      );
    }

    const body: Omit<WorkflowCheckpoint, 'digest'> = {
      workflowRunId: record.context.workflowRunId,
      organizationId: record.context.organizationId,
      version,
      createdAt: clock.isoNow(),
      state: facts.state,
      nodeId: facts.nodeId,
      stepCount: record.steps.length + 1,
      ...(facts.cursorNodeId === undefined ? {} : { cursorNodeId: facts.cursorNodeId }),
      outputs: { ...data.outputs },
      outputsDigest: digestOutputs(data.outputs),
      loopIterations: { ...data.loopIterations },
      nodeVisits: { ...data.nodeVisits },
      parallel: summarizeParallelGroups(facts.parallelGroups ?? record.parallelGroups ?? []),
      ...(record.checkpointDigest === undefined
        ? {}
        : { previousDigest: record.checkpointDigest }),
    };
    const checkpoint: WorkflowCheckpoint = { ...body, digest: computeCheckpointDigest(body) };

    try {
      await checkpoints.write(checkpoint);
    } catch (error) {
      if (!isWorkflowError(error) || error.failure !== 'workflow_checkpoint_conflict') throw error;
      const existing = await checkpoints.read(
        record.context.organizationId,
        record.context.workflowRunId,
        version,
      );
      if (!existing || existing.digest !== checkpoint.digest) throw error;
      logger.info('ai.workflow.checkpoint.adopted', {
        workflowRunId: record.context.workflowRunId,
        version,
      });
      return existing;
    }

    metrics.increment('ai.workflow.checkpoint.written', {
      workflow: record.context.workflowId,
    });
    return checkpoint;
  }

  // ── Node execution ────────────────────────────────────────────────────────

  /**
   * Phase 1 and 2: build the node's input, create the child, persist the
   * pointer. Nothing external has happened when this returns.
   */
  async function beginNode(
    record: WorkflowRunRecord,
    step: WorkflowPlanStep,
    data: DataState,
    input: AdvanceWorkflowInput,
    definition: WorkflowDefinition,
  ): Promise<WorkflowRunRecord> {
    if (!isAgentStep(step)) {
      throw workflowFailure('workflow_persistence_failed', 'This run cannot be continued.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: `beginNode reached non-agent node ${step.nodeId}`,
      });
    }

    const nodeInput = buildNodeInput(record, step, data);

    const handle = await agents.create({
      agentId: step.agentId,
      organizationId: record.context.organizationId,
      actor: input.actor.agent,
      objective: `${definition.displayName}: ${step.displayName}`.slice(0, 200),
      input: nodeInput,
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
   * The value a node is handed.
   *
   * Three cases, and the middle one matters: a node with a contract but no
   * mapping still VALIDATES the run input against that contract. Declaring a
   * shape and having it ignored because no mapping was written would be the
   * worst kind of check — one that reads as present and is not.
   */
  function buildNodeInput(
    record: WorkflowRunRecord,
    step: WorkflowPlanStep & { kind: 'agent' },
    data: DataState,
    branch?: WorkflowBranchRecord,
  ): unknown {
    const scope = branch === undefined
      ? scopeFor(record, data)
      : branchScopeFor(record, data, branch);

    if (step.inputMapping) {
      const outcome = applyMapping(step.inputMapping, scope, step.inputContract);
      if (!outcome.ok) {
        throw workflowFailure(
          'workflow_mapping_failed',
          'This workflow could not prepare a step.',
          {
            workflowRunId: record.context.workflowRunId,
            nodeId: step.nodeId,
            diagnostics: `node ${step.nodeId} input mapping (${outcome.failure}): ${outcome.detail}`,
          },
        );
      }
      return outcome.value;
    }

    if (step.inputContract) {
      const validated = step.inputContract.validate(record.input, 'input');
      if (isFailure(validated)) {
        throw workflowFailure(
          'workflow_mapping_failed',
          'This workflow could not prepare a step.',
          {
            workflowRunId: record.context.workflowRunId,
            nodeId: step.nodeId,
            diagnostics: `node ${step.nodeId} input contract: ${validated.issues
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join('; ')}`,
          },
        );
      }
      return validated.value;
    }

    // Part 2's behaviour, and still the default: the run's validated input,
    // unchanged. Nodes are sequenced, not chained by data, unless a mapping
    // says otherwise.
    return record.input;
  }

  /**
   * Turn a child's accepted result into a TRUSTED node output, or nothing.
   *
   * A node with no output contract stores NOTHING referenceable, and that is
   * the definition of the word doing its work: "trusted" means "passed a
   * declared schema", so a value nobody declared a schema for does not become
   * one a later condition can branch on. It is still digested for the audit
   * trail — a reader can prove what a node produced without the platform
   * keeping it.
   */
  function buildNodeOutput(
    record: WorkflowRunRecord,
    step: WorkflowPlanStep & { kind: 'agent' },
    data: DataState,
    raw: unknown,
    branch?: WorkflowBranchRecord,
  ): { readonly stored: boolean; readonly value?: unknown } {
    if (!step.outputContract) return { stored: false };

    if (step.outputMapping) {
      const outcome = applyMapping(
        step.outputMapping,
        branch === undefined
          ? scopeFor(record, data, { value: raw })
          : branchScopeFor(record, data, branch, { value: raw }),
        step.outputContract,
      );
      if (!outcome.ok) {
        throw workflowFailure(
          'workflow_mapping_failed',
          'A step of this workflow produced something it could not record.',
          {
            workflowRunId: record.context.workflowRunId,
            nodeId: step.nodeId,
            diagnostics: `node ${step.nodeId} output mapping (${outcome.failure}): ${outcome.detail}`,
          },
        );
      }
      return { stored: true, value: outcome.value };
    }

    const validated = step.outputContract.validate(raw, 'output');
    if (isFailure(validated)) {
      throw workflowFailure(
        'workflow_output_rejected',
        'A step of this workflow produced something it could not record.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: step.nodeId,
          diagnostics: `node ${step.nodeId} output contract: ${validated.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; ')}`,
        },
      );
    }

    const bytes = canonicalBytes(validated.value);
    if (bytes === undefined || bytes > WORKFLOW_CHECKPOINT_BOUNDS.maxNodeOutputBytes) {
      throw workflowFailure(
        'workflow_output_rejected',
        'A step of this workflow produced something it could not record.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: step.nodeId,
          diagnostics:
            bytes === undefined
              ? `node ${step.nodeId} output could not be canonically serialized`
              : `node ${step.nodeId} output is ${bytes} bytes, above ${WORKFLOW_CHECKPOINT_BOUNDS.maxNodeOutputBytes}`,
        },
      );
    }
    return { stored: true, value: validated.value };
  }

  /**
   * Move the cursor to `to`, counting a loop iteration when the move is a back
   * edge, and refusing when a ceiling is reached.
   *
   * The engine identifies a back edge from the PLAN rather than from the edge
   * list: the loop header carries `fromNodeId`, so "we are moving to H from H's
   * declared loop source" is the whole test. That keeps the runtime free of
   * graph analysis, which the planner already did once and recorded.
   */
  function advanceCursor(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    from: string,
    to: string | undefined,
    data: DataState,
  ): void {
    if (to === undefined) return;
    const target = stepFor(plan, to);
    const loop = target?.loop;
    if (!loop || loop.fromNodeId !== from) return;

    const taken = (data.loopIterations[to] ?? 0) + 1;
    if (taken > loop.maxIterations) {
      throw workflowFailure(
        'workflow_loop_exhausted',
        'This workflow repeated a step more times than it is allowed to.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: to,
          diagnostics:
            `loop into ${to} would take iteration ${taken}, above its ceiling of ${loop.maxIterations}`,
        },
      );
    }

    const total = Object.values({ ...data.loopIterations, [to]: taken }).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (total > WORKFLOW_RUN_BOUNDS.maxNodeExecutions) {
      throw workflowFailure(
        'workflow_loop_exhausted',
        'This workflow repeated a step more times than it is allowed to.',
        {
          workflowRunId: record.context.workflowRunId,
          diagnostics: `total loop iterations ${total} exceeds the run ceiling`,
        },
      );
    }

    data.loopIterations[to] = taken;
    metrics.increment('ai.workflow.loop.iteration', {
      workflow: record.context.workflowId,
      node: to,
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
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<{ readonly record: WorkflowRunRecord; readonly blocked: boolean }> {
    const pending = record.pendingNode;
    if (!pending) {
      throw workflowFailure('workflow_persistence_failed', 'This run cannot be continued.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: 'run is waiting_for_agent with no pendingNode',
      });
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
    if (!step || !isAgentStep(step)) {
      throw workflowFailure('workflow_plan_mismatch', 'This workflow has changed since the run started.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: pending.nodeId,
        diagnostics: `pending node ${pending.nodeId} is not an agent node in plan ${plan.digest}`,
      });
    }

    if (handle.state === 'failed') {
      return { record: await failNode(record, step, pending, handle, input), blocked: false };
    }

    // The node succeeded. Its output becomes trusted state BEFORE the cursor
    // moves, so a condition on the next node sees what this one produced.
    const output = buildNodeOutput(record, step, data, handle.output);
    if (output.stored) data.outputs[step.nodeId] = output.value;
    data.nodeVisits[step.nodeId] = (data.nodeVisits[step.nodeId] ?? 0) + 1;
    advanceCursor(record, plan, step.nodeId, step.nextNodeId, data);

    const resultDigest = output.stored ? digestValue(output.value) : handle.resultDigest;
    const stepRecord = completedStep(record, step, {
      nodeId: step.nodeId,
      kind: 'agent',
      startedAt: pending.startedAt,
      agentId: pending.agentId,
      childAgentRunId: pending.agentRunId,
      childState: handle.childState,
      ...(resultDigest === undefined ? {} : { resultDigest }),
    }, data);

    const checkpoint = await writeCheckpoint(record, data, {
      nodeId: step.nodeId,
      state: 'running',
      ...(step.nextNodeId === undefined ? {} : { cursorNodeId: step.nextNodeId }),
    });

    metrics.increment('ai.workflow.node.completed', {
      workflow: record.context.workflowId,
      node: step.nodeId,
    });

    const advanced = await transition(record, {
      to: 'running',
      operation: 'step',
      reason: `Node ${step.nodeId} completed.`,
      actorId: input.actor.actorId,
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        checkpointVersion: checkpoint.version,
        checkpointDigest: checkpoint.digest,
        pendingNode: undefined,
        currentNodeId: step.nextNodeId,
        ...(resultDigest === undefined ? {} : { resultDigest }),
      },
    });
    return { record: advanced, blocked: false };
  }

  async function failNode(
    record: WorkflowRunRecord,
    step: WorkflowPlanStep,
    pending: WorkflowPendingNode,
    handle: AgentNodeHandle,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    // The child already decided. No retry, no second attempt, no skipping to
    // the next node — a workflow whose node failed has failed. No checkpoint is
    // written either: a checkpoint is a point a run RESUMES from, and this run
    // does not resume.
    metrics.increment('ai.workflow.node.failed', {
      workflow: record.context.workflowId,
      node: pending.nodeId,
    });
    const stepRecord: WorkflowStepRecord = {
      stepId: ids.next('wfs'),
      sequence: record.steps.length,
      planIndex: step.index,
      nodeId: pending.nodeId,
      kind: 'agent',
      iteration: countVisits(record, pending.nodeId) + 1,
      agentId: pending.agentId,
      childAgentRunId: pending.agentRunId,
      childState: handle.childState,
      startedAt: pending.startedAt,
      completedAt: clock.isoNow(),
      latencyMs: Math.max(0, clock.now() - Date.parse(pending.startedAt)),
      outcome: 'failed',
      attempt: 1,
      failure: 'workflow_node_failed',
      checkpointVersion: record.checkpointVersion,
    };

    return transition(record, {
      to: 'failed',
      operation: 'fail',
      reason: `Node ${pending.nodeId} failed in agent run ${pending.agentRunId}.`,
      actorId: input.actor.actorId,
      failure: 'workflow_node_failed',
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        pendingNode: undefined,
        currentNodeId: undefined,
        failureMessage: handle.failureMessage ?? 'A step of this workflow did not complete.',
      },
    });
  }

  function countVisits(record: WorkflowRunRecord, nodeId: string): number {
    return record.steps.filter((step) => step.nodeId === nodeId).length;
  }

  function completedStep(
    record: WorkflowRunRecord,
    plan: WorkflowPlanStep,
    facts: {
      readonly nodeId: string;
      readonly kind: 'agent' | 'condition' | 'parallel' | 'join';
      readonly startedAt: string;
      readonly agentId?: string;
      readonly childAgentRunId?: string;
      readonly childState?: string;
      readonly branchTaken?: boolean;
      readonly branchNodeId?: string;
      readonly branchId?: string;
      readonly branchName?: string;
      readonly mergedBranchCount?: number;
      readonly resultDigest?: string;
    },
    data: DataState,
  ): WorkflowStepRecord {
    void data;
    const completedAt = clock.isoNow();
    return {
      stepId: ids.next('wfs'),
      sequence: record.steps.length,
      planIndex: plan.index,
      nodeId: facts.nodeId,
      kind: facts.kind,
      iteration: countVisits(record, facts.nodeId) + 1,
      ...(facts.agentId === undefined ? {} : { agentId: facts.agentId }),
      ...(facts.childAgentRunId === undefined
        ? {}
        : { childAgentRunId: facts.childAgentRunId }),
      ...(facts.childState === undefined ? {} : { childState: facts.childState }),
      ...(facts.branchTaken === undefined ? {} : { branchTaken: facts.branchTaken }),
      ...(facts.branchNodeId === undefined ? {} : { branchNodeId: facts.branchNodeId }),
      ...(facts.branchId === undefined ? {} : { branchId: facts.branchId }),
      ...(facts.branchName === undefined ? {} : { branchName: facts.branchName }),
      ...(facts.mergedBranchCount === undefined
        ? {}
        : { mergedBranchCount: facts.mergedBranchCount }),
      startedAt: facts.startedAt,
      completedAt,
      latencyMs: Math.max(0, clock.now() - Date.parse(facts.startedAt)),
      outcome: 'completed',
      attempt: 1,
      ...(facts.resultDigest === undefined ? {} : { resultDigest: facts.resultDigest }),
      checkpointVersion: record.checkpointVersion + 1,
    };
  }

  /**
   * Evaluate a condition node and take its branch.
   *
   * The whole node: no child run, no agent, no external call, no clock read
   * that could vary. It reads durable state, produces a boolean, moves the
   * cursor and writes a checkpoint recording which way it went.
   *
   * The branch is recorded on the step, so an operator reading an incident can
   * see WHICH way a condition went without re-deriving it from data that has
   * since changed — and can see it without the run record ever holding the
   * values it branched on, which are represented by digests alone.
   */
  async function runConditionNode(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    step: WorkflowPlanStep & { kind: 'condition' },
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    const startedAt = clock.isoNow();
    const taken = evaluateExpression(step.expression, scopeFor(record, data));
    const target = taken ? step.trueNodeId : step.falseNodeId;

    data.nodeVisits[step.nodeId] = (data.nodeVisits[step.nodeId] ?? 0) + 1;
    advanceCursor(record, plan, step.nodeId, target, data);

    const stepRecord = completedStep(
      record,
      step,
      {
        nodeId: step.nodeId,
        kind: 'condition',
        startedAt,
        branchTaken: taken,
        branchNodeId: target,
      },
      data,
    );

    const checkpoint = await writeCheckpoint(record, data, {
      nodeId: step.nodeId,
      state: 'running',
      cursorNodeId: target,
    });

    metrics.increment('ai.workflow.condition.evaluated', {
      workflow: record.context.workflowId,
      node: step.nodeId,
      branch: taken ? 'true' : 'false',
    });
    logger.info('ai.workflow.condition.evaluated', {
      workflowRunId: record.context.workflowRunId,
      nodeId: step.nodeId,
      branch: taken,
      target,
    });

    return transition(record, {
      to: 'running',
      operation: 'step',
      reason: `Condition ${step.nodeId} evaluated ${taken} and took ${target}.`,
      actorId: input.actor.actorId,
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        checkpointVersion: checkpoint.version,
        checkpointDigest: checkpoint.digest,
        currentNodeId: target,
      },
    });
  }

  // ── Parallel branches and joins (Part 4) ──────────────────────────────────

  /**
   * Open a parallel step: create every branch, durably, and start none of them.
   *
   * The whole fan-out is written in ONE versioned transition before any branch
   * runs, so an isolate that dies immediately afterwards comes back to a
   * complete statement of the work rather than a partial set it would have to
   * guess the rest of. `openParallelGroup` refuses a second group for the same
   * node, which is what makes a retried advance land on "already started".
   */
  async function openParallelNode(
    record: WorkflowRunRecord,
    step: WorkflowParallelPlanStep,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    const group = openParallelGroup({
      workflowRunId: record.context.workflowRunId,
      step,
      existingGroups: record.parallelGroups ?? [],
      at: clock.isoNow(),
    });

    metrics.increment('ai.workflow.parallel.opened', {
      workflow: record.context.workflowId,
      node: step.nodeId,
    });
    logger.info('ai.workflow.parallel.opened', {
      workflowRunId: record.context.workflowRunId,
      nodeId: step.nodeId,
      joinNodeId: step.joinNodeId,
      // Joined into one field: a log sink takes scalars, and a branch NAME is a
      // definition-authored label rather than tenant data, so it is safe to
      // carry where an output never would be.
      branches: group.branches.map((branch) => branch.branchName).join(','),
      branchCount: group.branches.length,
      joinPolicy: group.joinPolicy.kind,
      failurePolicy: group.failurePolicy,
    });

    return transition(record, {
      to: 'waiting_for_branches',
      operation: 'step',
      reason: `Parallel ${step.nodeId} opened ${group.branches.length} branches.`,
      actorId: input.actor.actorId,
      patch: { parallelGroups: upsertGroup(record.parallelGroups, group) },
    });
  }

  function requireOpenGroup(record: WorkflowRunRecord): WorkflowParallelGroup {
    const group = openGroupOf(record.parallelGroups);
    if (!group) {
      throw workflowFailure('workflow_persistence_failed', 'This run cannot be continued.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: 'run is waiting_for_branches with no open parallel group',
      });
    }
    return group;
  }

  function branchStepFor(
    plan: WorkflowPlan,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    nodeId: string,
  ): WorkflowAgentPlanStep | WorkflowConditionPlanStep {
    const step = stepFor(plan, nodeId);
    if (!step || isParallelStep(step) || isJoinStep(step)) {
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowRunId: group.groupId,
          nodeId,
          diagnostics:
            `branch ${branch.branchName} cursor ${nodeId} is not an agent or condition node ` +
            `in plan ${plan.digest}`,
        },
      );
    }
    return step;
  }

  /** What one turn against one branch produced. */
  interface BranchTurn {
    readonly record: WorkflowRunRecord;
    /** True when the branch's child could not progress and the branch is parked. */
    readonly blocked: boolean;
    /** True when the branch reached a terminal state on this turn. */
    readonly settled: boolean;
  }

  /**
   * Advance ONE branch by one step.
   *
   * Every write here goes through `transition`, so a branch mutation is a
   * versioned write of the whole run record — and `applyBranchProgress` asserts
   * the branch's OWN version before the record is rebuilt, which is what stops
   * a second sweep holding a stale view of this branch from overwriting it.
   */
  async function advanceBranch(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    definition: WorkflowDefinition,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    if (branch.state === 'waiting_for_agent') {
      return driveBranchNode(record, plan, group, branch, data, input);
    }

    const cursor = branch.cursorNodeId;
    if (cursor === undefined) {
      throw workflowFailure('workflow_persistence_failed', 'This run cannot be continued.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: `branch ${branch.branchId} is ${branch.state} with no cursor`,
      });
    }

    const step = branchStepFor(plan, group, branch, cursor);
    if (step.kind === 'condition') {
      return runBranchCondition(record, plan, group, branch, step, data, input);
    }
    return beginBranchNode(record, definition, group, branch, step, data, input);
  }

  /**
   * Phases 1 and 2 for a branch node: build the input, create the child,
   * persist the branch's pointer. Nothing external has happened on return.
   */
  async function beginBranchNode(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    step: WorkflowAgentPlanStep,
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    const nodeInput = buildNodeInput(record, step, data, branch);

    const handle = await agents.create({
      agentId: step.agentId,
      // TENANT SCOPE. The child is created in the RUN's organization, never in
      // one a caller named — the same rule every other agent call in this engine
      // follows, and a branch is not an exception to it.
      organizationId: record.context.organizationId,
      actor: input.actor.agent,
      objective: `${definition.displayName}: ${branch.branchName}/${step.displayName}`.slice(0, 200),
      input: nodeInput,
      requestId: input.requestId,
      correlationId: record.context.correlationId,
      origin: record.context.origin,
      workflowId: record.context.workflowId,
    });

    const updated: WorkflowBranchRecord = {
      ...branch,
      state: 'waiting_for_agent',
      branchVersion: branch.branchVersion + 1,
      pendingNode: {
        nodeId: step.nodeId,
        agentId: step.agentId,
        agentRunId: handle.agentRunId,
        startedAt: clock.isoNow(),
        sequence: step.index,
      },
      childAgentRunIds: [...branch.childAgentRunIds, handle.agentRunId],
    };

    const nextGroup = applyBranchProgress(group, updated, branch.branchVersion);

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: `Branch ${branch.branchName} handed ${step.nodeId} to ${step.agentId}.`,
        actorId: input.actor.actorId,
        patch: {
          parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
          childAgentRunIds: [...record.childAgentRunIds, handle.agentRunId],
        },
      }),
      blocked: false,
      settled: false,
    };
  }

  /**
   * Phase 3 for a branch node: drive the child and record the outcome.
   *
   * A child that is merely blocked produces NO WRITE and parks the branch for
   * the rest of this advance — the same rule the main line follows, and the
   * reason one branch waiting on an approval does not stop its siblings.
   */
  async function driveBranchNode(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    const pending = branch.pendingNode;
    if (!pending) {
      throw workflowFailure('workflow_persistence_failed', 'This run cannot be continued.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: `branch ${branch.branchId} is waiting_for_agent with no pendingNode`,
      });
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
      logger.info('ai.workflow.branch.waiting', {
        workflowRunId: record.context.workflowRunId,
        branchId: branch.branchId,
        nodeId: pending.nodeId,
        childAgentRunId: pending.agentRunId,
        childState: handle.childState,
      });
      return { record, blocked: true, settled: false };
    }

    const step = branchStepFor(plan, group, branch, pending.nodeId);
    if (!isAgentStep(step)) {
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: pending.nodeId,
          diagnostics: `branch pending node ${pending.nodeId} is not an agent node`,
        },
      );
    }

    if (handle.state === 'failed') {
      return failBranch(record, plan, group, branch, step, pending, handle, input);
    }

    // The node succeeded. Its output becomes BRANCH-LOCAL trusted state before
    // the branch cursor moves, so a condition later in the same branch sees what
    // this node produced — and no sibling does.
    const output = buildNodeOutput(record, step, data, handle.output, branch);
    const outputs = output.stored
      ? { ...branch.outputs, [step.nodeId]: output.value }
      : { ...branch.outputs };

    const outputBytes = canonicalBytes(outputs);
    if (outputBytes === undefined || outputBytes > WORKFLOW_PARALLEL_BOUNDS.maxBranchOutputsBytes) {
      throw workflowFailure(
        'workflow_output_rejected',
        'A branch of this workflow accumulated more data than it may carry.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: step.nodeId,
          diagnostics:
            outputBytes === undefined
              ? `branch ${branch.branchName} outputs could not be canonically serialized`
              : `branch ${branch.branchName} outputs are ${outputBytes} bytes, above ` +
                `${WORKFLOW_PARALLEL_BOUNDS.maxBranchOutputsBytes}`,
        },
      );
    }

    const resultDigest = output.stored ? digestValue(output.value) : handle.resultDigest;
    const reachedJoin = step.nextNodeId === group.joinNodeId;
    if (step.nextNodeId === undefined) {
      // Validation refuses a branch node with no successor, so this is a plan
      // that no longer matches the run. Refusing beats guessing that the branch
      // meant to end here — a branch that ends without telling the join is a
      // join that waits forever.
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: step.nodeId,
          diagnostics: `branch node ${step.nodeId} has no successor and does not reach the join`,
        },
      );
    }

    const progressed: WorkflowBranchRecord = {
      ...branch,
      state: 'running',
      branchVersion: branch.branchVersion + 1,
      cursorNodeId: step.nextNodeId,
      pendingNode: undefined,
      outputs,
      nodeVisits: {
        ...branch.nodeVisits,
        [step.nodeId]: (branch.nodeVisits[step.nodeId] ?? 0) + 1,
      },
      stepCount: branch.stepCount + 1,
      ...(output.stored ? { contributionNodeId: step.nodeId } : {}),
    };

    let nextGroup = applyBranchProgress(group, progressed, branch.branchVersion);
    let settled = false;

    if (reachedJoin) {
      const outcome = applyBranchOutcome(
        nextGroup,
        branch.branchId,
        {
          state: 'completed',
          at: clock.isoNow(),
          ...(progressed.contributionNodeId === undefined
            ? {}
            : { contributionNodeId: progressed.contributionNodeId }),
          ...(resultDigest === undefined ? {} : { resultDigest }),
        },
        progressed.branchVersion,
      );
      nextGroup = outcome.group;
      settled = outcome.applied;
      if (!outcome.applied) {
        // A DUPLICATE COMPLETION. Deterministically ignored — see
        // `applyBranchOutcome`. Counted so an operator can see it happened.
        metrics.increment('ai.workflow.branch.duplicate_completion', {
          workflow: record.context.workflowId,
          node: step.nodeId,
        });
      }
    }

    const stepRecord = completedStep(
      record,
      step,
      {
        nodeId: step.nodeId,
        kind: 'agent',
        startedAt: pending.startedAt,
        agentId: pending.agentId,
        childAgentRunId: pending.agentRunId,
        childState: handle.childState,
        branchId: branch.branchId,
        branchName: branch.branchName,
        ...(resultDigest === undefined ? {} : { resultDigest }),
      },
      data,
    );

    const checkpoint = await writeCheckpoint(record, data, {
      nodeId: step.nodeId,
      state: 'waiting_for_branches',
      cursorNodeId: group.parallelNodeId,
      parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
    });

    metrics.increment('ai.workflow.branch.node_completed', {
      workflow: record.context.workflowId,
      node: step.nodeId,
    });

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: `Branch ${branch.branchName} completed ${step.nodeId}.`,
        actorId: input.actor.actorId,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          checkpointVersion: checkpoint.version,
          checkpointDigest: checkpoint.digest,
          parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
        },
      }),
      blocked: false,
      settled,
    };
  }

  /**
   * A branch node whose child failed.
   *
   * The BRANCH fails; what that does to the run is the group's failure policy,
   * decided afterwards by `decideJoin`. No checkpoint is written, for the same
   * reason a failed main-line node writes none: a checkpoint is a point a line
   * of execution resumes from, and this one does not resume.
   */
  async function failBranch(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    step: WorkflowPlanStep,
    pending: WorkflowPendingNode,
    handle: AgentNodeHandle,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    void plan;
    const outcome = applyBranchOutcome(
      group,
      branch.branchId,
      { state: 'failed', at: clock.isoNow(), failure: 'workflow_branch_failed' },
      branch.branchVersion,
    );

    if (!outcome.applied) {
      metrics.increment('ai.workflow.branch.duplicate_completion', {
        workflow: record.context.workflowId,
        node: pending.nodeId,
      });
      return { record, blocked: false, settled: false };
    }

    metrics.increment('ai.workflow.branch.failed', {
      workflow: record.context.workflowId,
      node: pending.nodeId,
    });

    const stepRecord: WorkflowStepRecord = {
      stepId: ids.next('wfs'),
      sequence: record.steps.length,
      planIndex: step.index,
      nodeId: pending.nodeId,
      kind: 'agent',
      iteration: countVisits(record, pending.nodeId) + 1,
      agentId: pending.agentId,
      childAgentRunId: pending.agentRunId,
      childState: handle.childState,
      branchId: branch.branchId,
      branchName: branch.branchName,
      startedAt: pending.startedAt,
      completedAt: clock.isoNow(),
      latencyMs: Math.max(0, clock.now() - Date.parse(pending.startedAt)),
      outcome: 'failed',
      attempt: 1,
      failure: 'workflow_branch_failed',
      checkpointVersion: record.checkpointVersion,
    };

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: `Branch ${branch.branchName} failed at ${pending.nodeId}.`,
        actorId: input.actor.actorId,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          parallelGroups: upsertGroup(record.parallelGroups, outcome.group),
        },
      }),
      blocked: false,
      settled: true,
    };
  }

  /** A condition node inside a branch. Pure, branch-local, and never a child run. */
  async function runBranchCondition(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    step: WorkflowPlanStep & { kind: 'condition' },
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    const startedAt = clock.isoNow();
    const taken = evaluateExpression(step.expression, branchScopeFor(record, data, branch));
    const target = taken ? step.trueNodeId : step.falseNodeId;

    const progressed: WorkflowBranchRecord = {
      ...branch,
      state: 'running',
      branchVersion: branch.branchVersion + 1,
      cursorNodeId: target,
      nodeVisits: {
        ...branch.nodeVisits,
        [step.nodeId]: (branch.nodeVisits[step.nodeId] ?? 0) + 1,
      },
      stepCount: branch.stepCount + 1,
    };

    let nextGroup = applyBranchProgress(group, progressed, branch.branchVersion);
    let settled = false;

    if (target === group.joinNodeId) {
      const outcome = applyBranchOutcome(
        nextGroup,
        branch.branchId,
        {
          state: 'completed',
          at: clock.isoNow(),
          ...(branch.contributionNodeId === undefined
            ? {}
            : { contributionNodeId: branch.contributionNodeId }),
        },
        progressed.branchVersion,
      );
      nextGroup = outcome.group;
      settled = outcome.applied;
    }

    const stepRecord = completedStep(
      record,
      step,
      {
        nodeId: step.nodeId,
        kind: 'condition',
        startedAt,
        branchTaken: taken,
        branchNodeId: target,
        branchId: branch.branchId,
        branchName: branch.branchName,
      },
      data,
    );

    const checkpoint = await writeCheckpoint(record, data, {
      nodeId: step.nodeId,
      state: 'waiting_for_branches',
      cursorNodeId: group.parallelNodeId,
      parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
    });

    void plan;

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: `Branch ${branch.branchName} condition ${step.nodeId} took ${target}.`,
        actorId: input.actor.actorId,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          checkpointVersion: checkpoint.version,
          checkpointDigest: checkpoint.digest,
          parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
        },
      }),
      blocked: false,
      settled,
    };
  }

  /**
   * Stop the branches a decision left running, children first.
   *
   * The child agent runs are cancelled BEFORE the branches are marked, for the
   * same reason `cancel` stops a child before it cancels a run: the effects an
   * operator — or a policy — is trying to stop belong to the children. A child
   * that refuses to cancel does not block the group, because the group's
   * decision has already been made and the child has its own deadline.
   */
  async function cancelBranches(
    record: WorkflowRunRecord,
    group: WorkflowParallelGroup,
    branchIds: readonly string[],
    reason: string,
    input: { readonly actor: WorkflowRunActor; readonly requestId: string },
  ): Promise<WorkflowParallelGroup> {
    let next = group;
    const at = clock.isoNow();

    for (const branchId of branchIds) {
      const branch = next.branches.find((candidate) => candidate.branchId === branchId);
      if (!branch || isTerminalBranchState(branch.state)) continue;

      if (branch.pendingNode) {
        try {
          await agents.cancel({
            organizationId: record.context.organizationId,
            agentRunId: branch.pendingNode.agentRunId,
            actor: input.actor.agent,
            reason,
            requestId: input.requestId,
            correlationId: record.context.correlationId,
          });
        } catch (error) {
          logger.warn('ai.workflow.branch_cancel_failed', {
            workflowRunId: record.context.workflowRunId,
            branchId: branch.branchId,
            childAgentRunId: branch.pendingNode.agentRunId,
            diagnostics: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const outcome = applyBranchOutcome(
        next,
        branchId,
        { state: 'cancelled', at },
        branch.branchVersion,
      );
      next = outcome.group;
      if (outcome.applied) {
        metrics.increment('ai.workflow.branch.cancelled', {
          workflow: record.context.workflowId,
          node: group.parallelNodeId,
        });
      }
    }

    return next;
  }

  /**
   * Ask the group what should happen, and do it.
   *
   * `whenWaiting` is what "nothing to do yet" means to the caller: after a
   * branch settles the drive loop should keep going, and when every remaining
   * branch is parked on a child it should hand the run back.
   */
  async function concludeGroup(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    group: WorkflowParallelGroup,
    data: DataState,
    input: AdvanceWorkflowInput,
    whenWaiting: boolean,
  ): Promise<{ readonly record: WorkflowRunRecord; readonly done: boolean }> {
    const decision = decideJoin(group);

    if (decision.kind === 'wait') return { record, done: whenWaiting };

    if (decision.kind === 'already_joined') {
      // Reached only if something evaluated a closed group. Nothing is done —
      // that IS the guarantee — and it is logged rather than swallowed.
      logger.warn('ai.workflow.join.duplicate', {
        workflowRunId: record.context.workflowRunId,
        groupId: group.groupId,
      });
      metrics.increment('ai.workflow.join.duplicate', {
        workflow: record.context.workflowId,
        node: group.parallelNodeId,
      });
      return { record, done: true };
    }

    if (decision.kind === 'fail') {
      const cancelled = await cancelBranches(
        record,
        group,
        decision.cancelBranchIds,
        `Parallel step ${group.parallelNodeId} ended: ${decision.reason}`,
        input,
      );
      const closed = closeGroup(cancelled, {
        state: 'failed',
        at: clock.isoNow(),
        failure: decision.failure,
      });

      metrics.increment('ai.workflow.parallel.failed', {
        workflow: record.context.workflowId,
        node: group.parallelNodeId,
        failure: decision.failure,
      });

      return {
        record: await transition(record, {
          to: terminalStateFor(decision.failure) ?? 'failed',
          operation: 'fail',
          reason: decision.reason,
          actorId: input.actor.actorId,
          failure: decision.failure,
          patch: {
            parallelGroups: upsertGroup(record.parallelGroups, closed),
            failureMessage: 'A parallel step of this workflow did not complete.',
            currentNodeId: undefined,
            pendingNode: undefined,
          },
        }),
        done: true,
      };
    }

    return { record: await fireJoin(record, plan, group, data, input, decision.reason,
      decision.cancelBranchIds), done: false };
  }

  /**
   * Fire the join: cancel the stragglers, merge in ordinal order, hold the
   * result to the declared merge contract, and move the run's cursor past it.
   *
   * The merge contract is applied BEFORE anything is stored, so the value that
   * becomes the join node's trusted output — the one later conditions branch on
   * and later mappings read — has passed a schema the workflow author wrote. A
   * merge that failed it stops the run rather than promoting several branches'
   * unvalidated work into one node output.
   */
  async function fireJoin(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    group: WorkflowParallelGroup,
    data: DataState,
    input: AdvanceWorkflowInput,
    reason: string,
    cancelBranchIds: readonly string[],
  ): Promise<WorkflowRunRecord> {
    const joinStep = stepFor(plan, group.joinNodeId);
    if (!joinStep || !isJoinStep(joinStep)) {
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: group.joinNodeId,
          diagnostics: `join ${group.joinNodeId} is not a join node in plan ${plan.digest}`,
        },
      );
    }

    const settledGroup = await cancelBranches(
      record,
      group,
      cancelBranchIds,
      `Join ${group.joinNodeId} fired before this branch finished.`,
      input,
    );

    const merged = mergeBranchOutputs(settledGroup);

    const mergedBytes = canonicalBytes(merged);
    if (mergedBytes === undefined || mergedBytes > WORKFLOW_PARALLEL_BOUNDS.maxMergedBytes) {
      throw workflowFailure(
        'workflow_merge_rejected',
        'This workflow produced more data in parallel than it can merge.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: group.joinNodeId,
          diagnostics:
            mergedBytes === undefined
              ? 'merged branch outputs could not be canonically serialized'
              : `merged branch outputs are ${mergedBytes} bytes, above ` +
                `${WORKFLOW_PARALLEL_BOUNDS.maxMergedBytes}`,
        },
      );
    }

    const validated = joinStep.mergeContract.validate(merged, 'merge');
    if (isFailure(validated)) {
      throw workflowFailure(
        'workflow_merge_rejected',
        'This workflow could not accept what its parallel branches produced.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: group.joinNodeId,
          diagnostics: `join ${group.joinNodeId} mergeContract: ${validated.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('; ')}`,
        },
      );
    }

    const startedAt = settledGroup.startedAt;
    const resultDigest = digestValue(validated.value);

    data.outputs[group.joinNodeId] = validated.value;
    data.nodeVisits[group.joinNodeId] = (data.nodeVisits[group.joinNodeId] ?? 0) + 1;

    const closed = closeGroup(settledGroup, {
      state: 'joined',
      at: clock.isoNow(),
      joinDigest: resultDigest,
    });

    const stepRecord = completedStep(
      record,
      joinStep,
      {
        nodeId: group.joinNodeId,
        kind: 'join',
        startedAt,
        mergedBranchCount: merged.completedBranches.length,
        resultDigest,
      },
      data,
    );

    const checkpoint = await writeCheckpoint(record, data, {
      nodeId: group.joinNodeId,
      state: 'running',
      parallelGroups: upsertGroup(record.parallelGroups, closed),
      ...(joinStep.nextNodeId === undefined ? {} : { cursorNodeId: joinStep.nextNodeId }),
    });

    metrics.increment('ai.workflow.join.fired', {
      workflow: record.context.workflowId,
      node: group.joinNodeId,
      policy: group.joinPolicy.kind,
    });
    logger.info('ai.workflow.join.fired', {
      workflowRunId: record.context.workflowRunId,
      groupId: group.groupId,
      nodeId: group.joinNodeId,
      reason,
      completedBranches: merged.completedBranches.join(','),
      failedBranches: merged.failedBranches.join(','),
      cancelledBranches: merged.cancelledBranches.join(','),
    });

    return transition(record, {
      to: 'running',
      operation: 'step',
      reason: `Join ${group.joinNodeId} fired: ${reason}`,
      actorId: input.actor.actorId,
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        checkpointVersion: checkpoint.version,
        checkpointDigest: checkpoint.digest,
        parallelGroups: upsertGroup(record.parallelGroups, closed),
        currentNodeId: joinStep.nextNodeId,
        resultDigest,
      },
    });
  }

  /**
   * One turn against the open group.
   *
   * Branches are considered in ORDINAL ORDER and the first one that can move is
   * moved. Deterministic, and it is why a test that runs a fan-out twice gets
   * the same step sequence both times.
   */
  async function driveBranches(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    definition: WorkflowDefinition,
    data: DataState,
    input: AdvanceWorkflowInput,
    session: AdvanceSession,
  ): Promise<{ readonly record: WorkflowRunRecord; readonly done: boolean }> {
    const group = requireOpenGroup(record);

    if (record.steps.length >= WORKFLOW_RUN_BOUNDS.maxNodeExecutions) {
      throw workflowFailure(
        'workflow_loop_exhausted',
        'This workflow took more steps than it is allowed to.',
        {
          workflowRunId: record.context.workflowRunId,
          diagnostics: `run reached the ceiling of ${WORKFLOW_RUN_BOUNDS.maxNodeExecutions} node executions`,
        },
      );
    }

    // ROUND-ROBIN, in ordinal order, resuming after the branch that moved last.
    // Deterministic — the same fan-out produces the same step sequence every
    // time — and fair, so no branch is driven to completion while a sibling has
    // not yet started.
    const ordered = [...group.branches].sort((a, b) => a.ordinal - b.ordinal);
    const previous = ordered.findIndex((branch) => branch.branchId === session.lastBranchId);
    const candidate = ordered
      .map((_, offset) => ordered[(previous + 1 + offset) % ordered.length])
      .find(
        (branch) =>
          !isTerminalBranchState(branch.state) && !session.parkedBranches.has(branch.branchId),
      );

    if (!candidate) {
      // Everything is settled or parked on a child that has not moved. Ask the
      // group once more — an `any` join whose one completion already arrived
      // fires here rather than waiting for branches it no longer needs.
      return concludeGroup(record, plan, group, data, input, true);
    }

    session.lastBranchId = candidate.branchId;
    const turn = await advanceBranch(record, plan, definition, group, candidate, data, input);

    if (turn.blocked) {
      session.parkedBranches.add(candidate.branchId);
      return { record: turn.record, done: false };
    }
    if (!turn.settled) return { record: turn.record, done: false };

    const settledGroup = openGroupOf(turn.record.parallelGroups);
    if (!settledGroup) return { record: turn.record, done: true };
    return concludeGroup(turn.record, plan, settledGroup, data, input, false);
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
        parallelGroups: [],
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

      // RECOVERY. The durable checkpoint chain is verified end to end before a
      // single node runs, so a resumed run either continues from state it can
      // prove, or does not continue.
      let data: DataState;
      try {
        data = await recoverDataState(record, checkpoints);
      } catch (error) {
        if (isWorkflowError(error) && terminalStateFor(error.failure) !== undefined) {
          return await terminate(record, error, input.actor.actorId);
        }
        throw error;
      }

      const session: AdvanceSession = { parkedBranches: new Set<string>() };

      let iterations = 0;
      for (;;) {
        if ((iterations += 1) > MAX_DRIVE_ITERATIONS) {
          throw workflowFailure('workflow_persistence_failed', 'This run could not be advanced.', {
            workflowRunId: record.context.workflowRunId,
            diagnostics: `drive loop exceeded ${MAX_DRIVE_ITERATIONS} iterations in ${record.state}`,
          });
        }

        try {
          const outcome = await driveOnce(record, input, data, session);
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
      // A run paused mid-fan-out resumes INTO the fan-out. Returning it to
      // plain `running` would put the cursor back on the parallel node, whose
      // job is to open a group — and opening one that already exists is refused
      // as a duplicate, correctly, which would strand the run.
      const open = openGroupOf(record.parallelGroups);
      return transition(record, {
        to: open === undefined ? 'running' : 'waiting_for_branches',
        operation: 'resume',
        reason: input.reason,
        actorId: input.actor.actorId,
      });
    },

    async cancel(input) {
      const record = await loadForControl(input);

      // The children are stopped FIRST. Cancelling the workflow while leaving
      // its agent runs driving would be a cancellation in name only — the
      // effects the operator is trying to stop are the children's.
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

      // Every in-flight BRANCH is stopped too, and its child with it. A
      // cancellation that stopped the run but left four branch agent runs
      // driving would be the same cancellation-in-name-only, four times over.
      const open = openGroupOf(record.parallelGroups);
      const groups =
        open === undefined
          ? record.parallelGroups
          : upsertGroup(
              record.parallelGroups,
              closeGroup(
                await cancelBranches(
                  record,
                  open,
                  open.branches
                    .filter((branch) => !isTerminalBranchState(branch.state))
                    .map((branch) => branch.branchId),
                  `Parent workflow run ${record.context.workflowRunId} was cancelled.`,
                  input,
                ),
                { state: 'cancelled', at: clock.isoNow() },
              ),
            );

      return transition(record, {
        to: 'cancelled',
        operation: 'cancel',
        reason: input.reason,
        actorId: input.actor.actorId,
        patch: { pendingNode: undefined, currentNodeId: undefined, parallelGroups: groups },
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

    // An open group is closed so an expired record cannot be read as still
    // running four branches. The children are NOT cancelled here, for the same
    // reason expiry does not cancel a single pending child: expiry is a sweep
    // over records whose deadline passed, each child carries its own deadline,
    // and turning a sweep into a fan of remote cancellations is how a sweep
    // stops finishing.
    const at = clock.isoNow();
    const open = openGroupOf(record.parallelGroups);
    const groups =
      open === undefined
        ? record.parallelGroups
        : upsertGroup(
            record.parallelGroups,
            closeGroup(open, { state: 'cancelled', at, failure: 'workflow_expired' }),
          );

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
        parallelGroups: groups,
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
    data: DataState,
    session: AdvanceSession,
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
            record: await completeRun(record, definition, data, input),
            done: true,
          };
        }

        // THE RUN-WIDE CEILING. Checked before every node, which is what makes
        // nested loops bounded rather than merely each individually bounded.
        if (record.steps.length >= WORKFLOW_RUN_BOUNDS.maxNodeExecutions) {
          throw workflowFailure(
            'workflow_loop_exhausted',
            'This workflow took more steps than it is allowed to.',
            {
              workflowRunId: record.context.workflowRunId,
              diagnostics: `run reached the ceiling of ${WORKFLOW_RUN_BOUNDS.maxNodeExecutions} node executions`,
            },
          );
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

        if (step.kind === 'condition') {
          return { record: await runConditionNode(record, plan, step, data, input), done: false };
        }
        if (isParallelStep(step)) {
          return { record: await openParallelNode(record, step, input), done: false };
        }
        if (isJoinStep(step)) {
          // The cursor never rests on a join. A join is executed by its GROUP,
          // from `waiting_for_branches`, and the cursor moves straight to the
          // join's successor when it fires — so a cursor sitting here means the
          // plan the run was admitted with is not the plan in the registry.
          throw workflowFailure(
            'workflow_plan_mismatch',
            'This workflow has changed since the run started.',
            {
              workflowRunId: record.context.workflowRunId,
              nodeId: step.nodeId,
              diagnostics: `cursor rests on join ${step.nodeId}, which is only reached through its group`,
            },
          );
        }
        return { record: await beginNode(record, step, data, input, definition), done: false };
      }

      case 'waiting_for_agent': {
        const { plan } = admit(record);
        const outcome = await driveNode(record, plan, data, input);
        return {
          record: outcome.record,
          done: outcome.blocked || isTerminalWorkflowState(outcome.record.state),
        };
      }

      case 'waiting_for_branches': {
        const { plan, definition } = admit(record);
        const outcome = await driveBranches(record, plan, definition, data, input, session);
        return {
          record: outcome.record,
          done: outcome.done || isTerminalWorkflowState(outcome.record.state),
        };
      }

      default:
        // `paused` and every terminal state are handled before the loop starts.
        return { record, done: true };
    }
  }

  /**
   * Finish the run, holding the last trusted output to the workflow's own
   * output contract.
   *
   * The check applies only when the terminal node stored a trusted output —
   * a node with no output contract stores nothing, and there is nothing to
   * validate. That is a real limit and it is stated rather than hidden: a
   * workflow that wants its result checked declares an output contract on the
   * node that produces it. Enforcing it unconditionally would fail every
   * workflow whose last node simply does work and returns nothing.
   */
  async function completeRun(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    const lastStep = record.steps[record.steps.length - 1];
    const finalOutput =
      lastStep === undefined ? undefined : data.outputs[lastStep.nodeId];

    if (finalOutput !== undefined) {
      const validated = definition.outputContract.validate(finalOutput, 'output');
      if (isFailure(validated)) {
        throw workflowFailure(
          'workflow_output_rejected',
          'This workflow finished with a result it could not accept.',
          {
            workflowRunId: record.context.workflowRunId,
            diagnostics: `workflow outputContract: ${validated.issues
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join('; ')}`,
          },
        );
      }
    }

    return transition(record, {
      to: 'completed',
      operation: 'complete',
      reason: `All ${record.steps.length} node execution(s) completed.`,
      actorId: input.actor.actorId,
    });
  }
}

/** Re-exported so the assembly can seed a run with no checkpoints. */
export { emptyDataState };
