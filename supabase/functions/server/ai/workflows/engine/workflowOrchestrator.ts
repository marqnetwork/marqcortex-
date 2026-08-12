/**
 * The Workflow Execution Engine (AI-01 Batch 3B, Parts 2, 3, 4 and 5).
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
 * ── APPROVALS (PART 5) ─────────────────────────────────────────────────────
 *
 * An approval node parks its line of execution on a durable decision. The
 * ordering is the same three-phase discipline every other durable thing in this
 * engine follows, and for the same reason:
 *
 *   1. WRITE the approval record. Durable, pending, and inert.
 *   2. PERSIST the run — or the branch — carrying `pendingApproval`.
 *   3. Do nothing. There is no third phase, because the next thing that happens
 *      is a person deciding, through a completely different call path.
 *
 * An isolate that dies between 1 and 2 comes back, recomputes the approval's
 * DETERMINISTIC id, finds its own pending request and adopts it — no second row
 * in anybody's queue. One that dies between 2 and the decision loses nothing at
 * all: the request is pending, the run is parked, and both are durable.
 *
 * RELEASING A PARKED RUN SPENDS THE APPROVAL FIRST, and the order is deliberate
 * in the other direction from checkpoints: single-use is the stronger guarantee,
 * so the consume is committed before the transition that benefits from it. A
 * crash in between leaves an approval marked consumed and a run still parked,
 * which the next advance recognises — and ONLY recognises — because the binding
 * still matches exactly. Any real progress moves the checkpoint version, so
 * there is no path by which a spent approval releases a run twice.
 *
 * THE ENGINE NEVER DECIDES. It requests, it reads, it spends. `decide` lives on
 * the gate and is reached by a person through the service, which is why a
 * decision survives an isolate that was never driving the run.
 *
 * ── RETRIES (PART 5) ───────────────────────────────────────────────────────
 *
 * A node that fails may be tried again, up to the `maxAttempts` its definition
 * has carried since Part 1. A retry is A NEW CHILD AGENT RUN — never a second
 * drive of a child that already reached a terminal state — and it happens only
 * when `runtime/retryPolicy.ts` classifies the child's failure as transient.
 * Authorization, policy, budget, invalid definitions, invalid transitions and
 * approval rejections are decisions, and re-running a decision spends an agent
 * run to reach the same conclusion.
 *
 * The attempt is incremented, the backoff stamp computed and the pending node
 * cleared IN ONE VERSIONED WRITE with the failed step record. That is what
 * stops a crash mid-retry from either double-counting an attempt or abandoning
 * one. Nothing wakes a run up when a delay elapses — there is no scheduler in
 * this batch — so a run whose next attempt is not yet due is handed back
 * unchanged, having created nothing.
 *
 * What a failed branch does to its siblings is still the group's declared
 * failure policy, retries are still branch-local, and a failed run is still
 * restarted as a NEW run rather than reopened.
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
  WorkflowApprovalPlanStep,
  WorkflowConditionPlanStep,
  WorkflowParallelPlanStep,
} from '../contracts/plan.ts';
import type {
  WorkflowApprovalBinding,
  WorkflowApprovalRecord,
} from '../contracts/approval.ts';
import type { WorkflowNodeAttempt } from '../contracts/retry.ts';
import type { WorkflowApprovalGate } from '../approvals/workflowApprovalGate.ts';
import {
  MAX_WORKFLOW_TRANSITION_HISTORY,
  WORKFLOW_RUN_BOUNDS,
  isTerminalWorkflowState,
} from '../contracts/run.ts';
import { WORKFLOW_CHECKPOINT_BOUNDS } from '../contracts/checkpoint.ts';
import { WORKFLOW_PARALLEL_BOUNDS, isTerminalBranchState } from '../contracts/parallel.ts';
import { isAgentStep, isApprovalStep, isJoinStep, isParallelStep } from '../contracts/plan.ts';
import {
  WorkflowError,
  isWorkflowError,
  terminalStateFor,
  workflowFailure,
} from '../contracts/failures.ts';
import { assertTransition } from '../runtime/workflowStateMachine.ts';
import {
  applyAttempt,
  classifyChildFailure,
  clearAttempt,
  clearBranchAttempts,
  currentAttempt,
  findAttempt,
  nextAttemptRecord,
  retriesExhausted,
  retryDelayRemainingMs,
} from '../runtime/retryPolicy.ts';
import { emptyUsageLedger } from '../../optimization/contracts/usage.ts';
import { absorbChildUsage } from '../runtime/usageAttribution.ts';
import type { FinancialOutcome } from '../../financial/contracts/event.ts';
import type {
  WorkflowFinancialPort,
  WorkflowNodeCostDecision,
  WorkflowNodeFinancialFacts,
} from '../financial/contracts/emission.ts';
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
  /**
   * The approval gate (AI-01 Batch 3B, Part 5).
   *
   * The engine holds the GATE, not the store. It requests, reads and spends;
   * it has no method through which it could decide, which is what makes "the
   * engine never approves anything" a property of the type rather than a rule
   * somebody has to remember.
   */
  readonly approvals: WorkflowApprovalGate;
  readonly agents: WorkflowAgentPort;
  /**
   * The one path from execution to canonical financial evidence
   * (AI-01 Batch 3B, Integration Pass).
   *
   * REQUIRED, and required for the same reason the approval gate is: a
   * dependency that can be omitted is a dependency half the deployments omit.
   * A deployment that does not want financial recording injects
   * `createNoopWorkflowFinancialPort()`, which is an explicit statement rather
   * than an absence, and the engine's branches are identical either way.
   *
   * Note what the engine holds and what it does not. It holds a port with five
   * methods, none of which can create an agent run, write a checkpoint, spend an
   * approval or move a run's state. Every method resolves rather than throwing —
   * see `workflows/financial/workflowFinancialRecorder.ts` for the fail-open
   * decision — so no financial failure can stop a run from ending.
   */
  readonly financial: WorkflowFinancialPort;
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
  const { registry, runs, checkpoints, approvals, agents, financial, clock, ids, logger, metrics } =
    deps;

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

    // FINANCIAL FINALIZATION, AFTER THE TERMINAL STATE IS DURABLE AND NEVER
    // BEFORE IT (AI-01 Batch 3B, Integration Pass).
    //
    // The order is the whole of the fail-open policy, made structural. Running
    // it before the save would let a financial store outage hold a run open, and
    // a run that cannot end still has children spending real money. Running it
    // after means a crash in between leaves events pending against a terminal
    // run — which the next `advance` over that run finds and finalizes, because
    // finalization is idempotent and repeating it converges.
    //
    // Hooked HERE rather than at each terminal call site because `transition` is
    // the one place a run's state changes. Completion, typed failure,
    // cancellation, expiry and a policy denial all pass through it, so there is
    // no terminal path that can be added later and quietly skip settlement.
    if (terminal) await finalizeFinancials(next);

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

  // ── Financial evidence (AI-01 Batch 3B, Integration Pass) ─────────────────

  /**
   * The financial outcome a terminal workflow state bought.
   *
   * A total mapping over `TERMINAL_WORKFLOW_STATES`, so a state added to the run
   * contract without a financial meaning fails to type rather than silently
   * finalizing as something else. A non-terminal state has no outcome yet, which
   * is what `undefined` says.
   */
  function financialOutcomeFor(state: WorkflowRunState): FinancialOutcome | undefined {
    switch (state) {
      case 'completed':
        return 'succeeded';
      case 'failed':
        return 'failed';
      case 'cancelled':
        return 'cancelled';
      case 'expired':
        return 'expired';
      case 'policy_denied':
        return 'policy_denied';
      default:
        return undefined;
    }
  }

  /**
   * Settle what can be settled, and mark what never will be.
   *
   * BOUNDED — one tenant-scoped scan over the run's own events, capped by the
   * recorder — and IDEMPOTENT: already-settled events are left exactly as they
   * are, and a pending one becomes `unsettled_terminal` with its measurement
   * still ABSENT. Unknown spend is never converted to zero; it is reported as
   * unknown, which is what feeds Part 6C's settlement coverage.
   *
   * It never mutates the execution outcome. The run has already reached its
   * terminal state and been persisted by the time this runs, and nothing here
   * can write a run record.
   */
  async function finalizeFinancials(record: WorkflowRunRecord): Promise<void> {
    const outcome = financialOutcomeFor(record.state);
    if (outcome === undefined) return;
    const createdAt = Date.parse(record.createdAt);
    const report = await financial.finalizeRun({
      organizationId: record.context.organizationId,
      workflowId: record.context.workflowId,
      workflowRunId: record.context.workflowRunId,
      outcome,
      occurredAt: clock.now(),
      // A record whose creation stamp cannot be parsed still gets a scan; the
      // window simply starts at the epoch rather than the run. A narrower guess
      // could exclude the run's own events, and an event excluded from
      // finalization is spend that stays pending forever.
      fromMs: Number.isFinite(createdAt) ? createdAt : 0,
      // The run's own ledger, so a pending event whose child never reached a
      // terminal state — the shape a cancellation produces — settles at the
      // figure the accounting port actually measured instead of being reported
      // as unknown. Only a call with NO measurement anywhere becomes
      // `unsettled_terminal`.
      usageRows: record.usage?.rows ?? [],
    });
    if (report.degraded) {
      metrics.increment('ai.workflow.financial.finalize_degraded', {
        workflow: record.context.workflowId,
      });
    }
  }

  /**
   * The facts one node attempt is financially known by.
   *
   * IDENTITY AND DECLARED SIZES ONLY. There is no field here through which the
   * engine could state a cost, a baseline or a saving, which is what keeps the
   * engine from becoming a second opinion about money.
   *
   * `protectedWork` is established from the run's OWN step history: a node the
   * run reached only because a person approved something is approval-bound work,
   * and Part 6C's waste analysis must never label it waste. A branch's nodes see
   * their own branch's approvals and the main line's, and never a sibling's.
   */
  function nodeFinancialFacts(
    record: WorkflowRunRecord,
    step: WorkflowAgentPlanStep,
    options: {
      readonly actorId: string;
      readonly attempt: number;
      readonly branchId?: string;
      readonly groupId?: string;
      readonly agentRunId?: string;
      readonly agentVersion?: string;
      /**
       * The digest of the input this attempt will be given.
       *
       * Supplied only where the engine has actually built the input. Absent
       * means the production reuse resolver refuses to resolve — see
       * `contracts/emission.ts` for why an unbound exact key is the worst
       * defect this subsystem could ship.
       */
      readonly inputDigest?: string;
    },
  ): WorkflowNodeFinancialFacts {
    const approved = record.steps.some(
      (recorded) =>
        recorded.kind === 'approval' &&
        recorded.approvalDecision === 'approve' &&
        (recorded.branchId === undefined || recorded.branchId === options.branchId),
    );

    return {
      organizationId: record.context.organizationId,
      actorId: options.actorId,
      workflowId: record.context.workflowId,
      workflowVersion: record.context.workflowVersion,
      workflowRunId: record.context.workflowRunId,
      configurationVersion: record.configurationVersion,
      // The plan the run was ADMITTED under, from the run's own context. A
      // workflow whose plan has changed is a different workflow, and reuse
      // treats the digest as a version requirement rather than a label.
      planDigest: record.context.planDigest,
      nodeId: step.nodeId,
      ...(options.branchId === undefined ? {} : { branchId: options.branchId }),
      ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
      agentId: step.agentId,
      ...(options.agentRunId === undefined ? {} : { agentRunId: options.agentRunId }),
      ...(options.agentVersion === undefined ? {} : { agentVersion: options.agentVersion }),
      ...(options.inputDigest === undefined ? {} : { inputDigest: options.inputDigest }),
      attempt: options.attempt,
      maxAttempts: step.maxAttempts,
      protectedWork: approved,
      occurredAt: clock.now(),
    };
  }

  /**
   * Settle one node attempt from the run's OWN usage ledger.
   *
   * THE LEDGER ROW, NOT THE HANDLE. `absorbChildUsage` has already folded the
   * child's cumulative report through the one certified accounting port, and the
   * row it produced is the high-water mark for that child. Reading the row means
   * a re-observed child — the shape a restart produces — still settles at the
   * full measured figure even though its delta was zero, which is the crash
   * window between "usage arrived" and "the event was settled".
   *
   * Called only for a child that reached a terminal state. A child still running
   * has spent something and will spend more, and settling a partial figure would
   * close an event that the rest of the spend could then never reach.
   */
  async function settleNodeFinancials(
    record: WorkflowRunRecord,
    step: WorkflowAgentPlanStep,
    handle: AgentNodeHandle,
    options: {
      readonly actorId: string;
      readonly attempt: number;
      readonly branchId?: string;
      readonly groupId?: string;
    },
  ): Promise<void> {
    if (handle.state !== 'completed' && handle.state !== 'failed') return;

    const row = record.usage?.rows.find((candidate) => candidate.agentRunId === handle.agentRunId);
    if (row === undefined) {
      // The child reported no usage at all — an approval-shaped child, or one
      // that never reached a model. There is nothing measured to settle, and
      // inventing a zero here is exactly the conversion this batch forbids: the
      // event stays pending and terminal finalization marks it unsettled.
      return;
    }

    const facts = nodeFinancialFacts(record, step, {
      actorId: options.actorId,
      attempt: options.attempt,
      ...(options.branchId === undefined ? {} : { branchId: options.branchId }),
      ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
      agentRunId: handle.agentRunId,
      ...(handle.agentVersion === undefined ? {} : { agentVersion: handle.agentVersion }),
    });

    // RE-DERIVED, NOT REMEMBERED. The decision is a pure function of durable
    // facts, so the second isolate computes the identical plan and therefore the
    // identical event id. A decision cached in memory would be gone after a
    // restart, and the settlement would have nothing to attach itself to.
    const decision = await financial.decideNode(facts);
    if (decision === undefined) return;

    await financial.settleAttempt(facts, decision, {
      actualCostMicroUsd: row.attributed.actualCostMicroUsd,
      actualTokens: row.attributed.actualTotalTokens,
      outcome: handle.state === 'completed' ? 'succeeded' : 'failed',
      ...(handle.usage?.providerName === undefined && handle.usage?.modelName === undefined
        ? {}
        : {
            provider: {
              ...(handle.usage?.providerName === undefined
                ? {}
                : { providerName: handle.usage.providerName }),
              ...(handle.usage?.modelName === undefined
                ? {}
                : { modelName: handle.usage.modelName }),
            },
          }),
    });
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

    await withdrawApprovals(record, 'The run ended before this could be decided.');

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
        pendingApproval: undefined,
        parallelGroups: groups,
      },
    });
  }

  /**
   * Close every pending request a terminal run leaves behind.
   *
   * BEST EFFORT, and deliberately so. A run reaching a terminal state is the
   * decision that matters; an approval store that will not accept the closure
   * must not stop the run from ending, and the request expires on its own
   * deadline regardless. Failures are logged rather than swallowed.
   *
   * Withdrawal is never approval — see `approvals/workflowApprovalGate.ts`. All
   * this does is stop an undecidable question sitting at the top of a queue.
   */
  async function withdrawApprovals(
    record: WorkflowRunRecord,
    reason: string,
  ): Promise<void> {
    const pointers = [
      record.pendingApproval,
      ...(record.parallelGroups ?? []).flatMap((group) =>
        group.branches.map((branch) => branch.pendingApproval),
      ),
    ].filter((pointer): pointer is NonNullable<typeof pointer> => pointer !== undefined);

    for (const pointer of pointers) {
      try {
        const stored = await approvals.get(
          record.context.organizationId,
          pointer.workflowApprovalId,
        );
        if (stored) await approvals.withdraw(stored, reason);
      } catch (error) {
        logger.warn('ai.workflow.approval.withdraw_failed', {
          workflowRunId: record.context.workflowRunId,
          workflowApprovalId: pointer.workflowApprovalId,
          diagnostics: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
    plan: WorkflowPlan,
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

    const attempt = currentAttempt(record.retries, step.nodeId);

    // ── THE INPUT IS BUILT FIRST, AND ITS FAILURE IS HELD ────────────────────
    //
    // Reuse is keyed on the question actually being asked, so the decision needs
    // the input's digest — which means the input has to exist before the
    // decision is taken. Building it here rather than after would ordinarily
    // change which failure a broken run reports, so the failure is CAUGHT and
    // RE-THROWN in its original position: a refusal still wins over a rejected
    // input, exactly as it did before this pass.
    //
    // The one deliberate change is that an AVOIDED node now validates its input
    // mapping too. That is stricter, not looser, and it is required: the input is
    // what the exact reuse key is computed over, so a node whose input cannot be
    // built has no key and must not be answered from a cache.
    let nodeInput: unknown;
    let inputFailure: unknown;
    try {
      nodeInput = buildNodeInput(record, step, data);
    } catch (error) {
      inputFailure = error;
    }

    // ── THE DECISION, BEFORE THE CALL EXISTS ──────────────────────────────────
    //
    // Asked here and nowhere else, because this is the last moment at which "does
    // this call need to happen" is still a question. The facts carry NO child
    // agent run id, which is what makes avoidance available to them — see
    // `decideNode`: a node that already has a child has already made the call,
    // and no plan derived for it may claim the call was avoided.
    //
    // The plan is ADVICE. The engine reads it, and the engine acts; nothing
    // reachable from the port could have created the child itself.
    const decision = await financial.decideNode(
      nodeFinancialFacts(record, step, {
        actorId: input.actor.actorId,
        attempt,
        ...(inputFailure === undefined ? { inputDigest: digestValue(nodeInput) } : {}),
      }),
    );

    if (decision !== undefined && decision.refused) {
      // The optimiser refused. The only condition that produces a refusal is the
      // administrative kill switch, which `advance` also checks — so reaching
      // here means AI was disengaged between that check and this node.
      //
      // The refusal is RECORDED, and a refusal claims nothing: zero baseline,
      // zero saving, `not_applicable` settlement. No saving is fabricated merely
      // because execution stopped. Then the run ends, because executing a node
      // the platform has just refused would make the record a lie in the other
      // direction.
      await financial.recordAttempt(
        nodeFinancialFacts(record, step, { actorId: input.actor.actorId, attempt }),
        decision,
      );
      throw workflowFailure(
        'workflow_runtime_disabled',
        'AI execution is currently unavailable.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: step.nodeId,
          diagnostics: `node ${step.nodeId} was refused: ${decision.plan.reason}`,
        },
      );
    }

    // The held failure, re-thrown in the position it would have surfaced from
    // before the input moved. Everything below this line has a usable input.
    if (inputFailure !== undefined) throw inputFailure;

    if (decision !== undefined && decision.avoided) {
      return completeAvoidedNode(record, plan, step, data, input, decision, attempt);
    }

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
      attempt,
    };

    const started = await transition(record, {
      to: 'waiting_for_agent',
      operation: 'step',
      reason:
        attempt === 1
          ? `Node ${step.nodeId} handed to ${step.agentId}.`
          : `Node ${step.nodeId} handed to ${step.agentId} (attempt ${attempt}).`,
      actorId: input.actor.actorId,
      patch: {
        pendingNode,
        childAgentRunIds: [...record.childAgentRunIds, handle.agentRunId],
      },
    });

    // RECORDED AFTER THE POINTER IS DURABLE, and that ordering matters twice
    // over. The pending node is what a recovered isolate reads to know which
    // child to poll, so writing the financial event first would risk an event
    // naming a child run nothing points at. And an isolate that dies between
    // this write and the next is covered from the other side: `settleAttempt`
    // appends before it settles, so the event is created then instead.
    //
    // The event is emitted PENDING. No inference has happened yet — `drive` is
    // the first moment anything external occurs — and pending is not zero.
    if (decision !== undefined) {
      await financial.recordAttempt(
        nodeFinancialFacts(started, step, {
          actorId: input.actor.actorId,
          attempt,
          agentRunId: handle.agentRunId,
          ...(handle.agentVersion === undefined ? {} : { agentVersion: handle.agentVersion }),
        }),
        decision,
      );
    }
    return started;
  }

  /**
   * A node answered without a model call (AI-01 Batch 3B, Integration Pass).
   *
   * Reached only when Part 6A's admission said the call need not exist — a
   * declared deterministic path, or a prior output the Part 6B eligibility gate
   * validated. NO CHILD AGENT RUN IS CREATED, and that is what makes the
   * avoided-call event's zero actual cost a measurement rather than an
   * assumption: nothing ran, so nothing was billed.
   *
   * THE REUSED VALUE IS GOVERNED EXACTLY AS A GENERATED ONE IS. It goes through
   * `buildNodeOutput`, so the node's own declared output contract accepts or
   * refuses it before it becomes a trusted output. A reused answer that no longer
   * satisfies the contract fails the run rather than being stored — which is the
   * correct outcome, because a stale value that a later condition branches on is
   * worse than a call the platform had to make.
   *
   * A deterministic avoidance carries no value, so it can only answer a node with
   * no output contract. That is a real limitation and it is stated rather than
   * worked around: `DeterministicCapability` declares that a path exists, not
   * what it returns, and inventing a value here would be the optimiser producing
   * business data.
   */
  async function completeAvoidedNode(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    step: WorkflowAgentPlanStep,
    data: DataState,
    input: AdvanceWorkflowInput,
    decision: WorkflowNodeCostDecision,
    attempt: number,
  ): Promise<WorkflowRunRecord> {
    const startedAt = clock.isoNow();
    const facts = nodeFinancialFacts(record, step, {
      actorId: input.actor.actorId,
      attempt,
    });

    // Emitted BEFORE the node is recorded as done. An avoided call settles at
    // zero on `measured_absence` immediately — there is no later measurement to
    // wait for — so there is no window in which this event could be lost to a
    // crash and recovered by a settlement that never comes.
    await financial.recordAttempt(facts, decision);

    const output = buildNodeOutput(record, step, data, decision.reuse?.output);
    if (output.stored) data.outputs[step.nodeId] = output.value;
    data.nodeVisits[step.nodeId] = (data.nodeVisits[step.nodeId] ?? 0) + 1;
    advanceCursor(record, plan, step.nodeId, step.nextNodeId, data);

    const resultDigest = output.stored ? digestValue(output.value) : undefined;
    const stepRecord = completedStep(
      record,
      step,
      {
        nodeId: step.nodeId,
        kind: 'agent',
        startedAt,
        agentId: step.agentId,
        attempt,
        ...(resultDigest === undefined ? {} : { resultDigest }),
      },
      data,
    );

    const checkpoint = await writeCheckpoint(record, data, {
      nodeId: step.nodeId,
      state: 'running',
      ...(step.nextNodeId === undefined ? {} : { cursorNodeId: step.nextNodeId }),
    });

    metrics.increment('ai.workflow.node.avoided', {
      workflow: record.context.workflowId,
      node: step.nodeId,
      decision: decision.plan.decision,
    });
    logger.info('ai.workflow.node.avoided', {
      workflowRunId: record.context.workflowRunId,
      nodeId: step.nodeId,
      decision: decision.plan.decision,
      reason: decision.plan.reason,
      ...(decision.reuse === undefined ? {} : { reuseType: decision.reuse.reuseType }),
      ...(decision.reuse === undefined
        ? {}
        : { reusableResultId: decision.reuse.sourceReusableResultId }),
    });

    return transition(record, {
      to: 'running',
      operation: 'step',
      reason: `Node ${step.nodeId} was answered without a model call.`,
      actorId: input.actor.actorId,
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        checkpointVersion: checkpoint.version,
        checkpointDigest: checkpoint.digest,
        pendingNode: undefined,
        currentNodeId: step.nextNodeId,
        retries: clearAttempt(record.retries, step.nodeId),
        ...(resultDigest === undefined ? {} : { resultDigest }),
      },
    });
  }

  /**
   * May this node start its next attempt yet?
   *
   * Returns the milliseconds still to wait, which is zero for a node that has
   * never failed and for every `immediate` policy. A positive number means the
   * caller hands the run back untouched, having created nothing — see the
   * header for why this is a park rather than a scheduled wake-up.
   */
  function retryWaitMs(
    record: WorkflowRunRecord,
    nodeId: string,
    branchId?: string,
  ): number {
    return retryDelayRemainingMs(findAttempt(record.retries, nodeId, branchId), clock.now());
  }

  function logRetryWait(
    record: WorkflowRunRecord,
    nodeId: string,
    waitMs: number,
    branchId?: string,
  ): void {
    metrics.increment('ai.workflow.retry.not_due', {
      workflow: record.context.workflowId,
      node: nodeId,
    });
    logger.info('ai.workflow.retry.not_due', {
      workflowRunId: record.context.workflowRunId,
      nodeId,
      ...(branchId === undefined ? {} : { branchId }),
      waitMs,
      nextAttemptAt: findAttempt(record.retries, nodeId, branchId)?.nextAttemptAt,
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

    // ATTRIBUTED BEFORE THE OUTCOME IS JUDGED (AI-01 Batch 3B, Part 6A). A child
    // that failed after two model steps spent money on both, so the fold happens
    // here rather than on the success path — attributing only what succeeded
    // would under-report exactly the spend a savings figure must be read next
    // to. The fold is a delta over the child's cumulative totals, so observing
    // the same child twice adds nothing; see `runtime/usageAttribution.ts`.
    record = absorbChildUsage(record, {
      agentRunId: pending.agentRunId,
      nodeId: pending.nodeId,
      attempt: pending.attempt,
      ...(handle.usage === undefined ? {} : { usage: handle.usage }),
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

    // SETTLED BEFORE THE OUTCOME IS JUDGED, for the same reason the usage fold
    // above happens here: a child that failed after two model steps spent money
    // on both, and settling only the success path would drop exactly the spend a
    // savings figure has to be read next to.
    await settleNodeFinancials(record, step, handle, {
      actorId: input.actor.actorId,
      attempt: pending.attempt,
    });

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
      attempt: pending.attempt,
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
        // The node succeeded, so its attempt budget is no longer a live fact —
        // and a node inside a loop must start its next visit with a full one.
        // See `runtime/retryPolicy.ts`.
        retries: clearAttempt(record.retries, step.nodeId),
        ...(resultDigest === undefined ? {} : { resultDigest }),
      },
    });
    return { record: advanced, blocked: false };
  }

  /**
   * A main-line node whose child failed: retry it, or end the run.
   *
   * THE DECISION IS TAKEN IN ONE PLACE AND WRITTEN IN ONE TRANSITION. Whichever
   * way it goes, the failed step, the attempt state and the cleared pending
   * pointer become durable together — so a crash cannot leave a run that has
   * recorded a failure but not the attempt it spent, or an attempt it never
   * made.
   *
   * No checkpoint is written on either path. A checkpoint is a point a line of
   * execution RESUMES from, and a failed attempt is not one: the retry starts
   * from exactly the durable state the failed attempt started from, which is
   * what makes "retry" mean the same thing after a restart as before one.
   */
  async function failNode(
    record: WorkflowRunRecord,
    step: WorkflowPlanStep,
    pending: WorkflowPendingNode,
    handle: AgentNodeHandle,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    const maxAttempts = isAgentStep(step) ? step.maxAttempts : 1;
    const classification = classifyChildFailure(handle.failure);
    const exhausted = retriesExhausted(pending.attempt, maxAttempts);
    const willRetry = classification.retryable && !exhausted;

    metrics.increment('ai.workflow.node.failed', {
      workflow: record.context.workflowId,
      node: pending.nodeId,
      classification: classification.classification,
      retried: willRetry ? 'yes' : 'no',
    });

    const failure = willRetry
      ? 'workflow_node_failed'
      : classification.retryable && exhausted
        ? 'workflow_retry_exhausted'
        : 'workflow_node_failed';

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
      attempt: pending.attempt,
      failureClass: classification.classification,
      retryScheduled: willRetry,
      failure,
      checkpointVersion: record.checkpointVersion,
    };

    if (!willRetry) {
      logger.info('ai.workflow.node.not_retried', {
        workflowRunId: record.context.workflowRunId,
        nodeId: pending.nodeId,
        attempt: pending.attempt,
        maxAttempts,
        classification: classification.classification,
        diagnostics: classification.detail,
      });

      return transition(record, {
        to: 'failed',
        operation: 'fail',
        reason: exhausted && classification.retryable
          ? `Node ${pending.nodeId} failed on attempt ${pending.attempt} of ${maxAttempts}.`
          : `Node ${pending.nodeId} failed in agent run ${pending.agentRunId}.`,
        actorId: input.actor.actorId,
        failure,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          pendingNode: undefined,
          currentNodeId: undefined,
          failureMessage: handle.failureMessage ?? 'A step of this workflow did not complete.',
        },
      });
    }

    const attemptRecord = scheduleNodeRetry(record, step, pending, classification, handle);

    metrics.increment('ai.workflow.retry.scheduled', {
      workflow: record.context.workflowId,
      node: pending.nodeId,
      backoff: attemptRecord.backoff,
    });
    logger.info('ai.workflow.retry.scheduled', {
      workflowRunId: record.context.workflowRunId,
      nodeId: pending.nodeId,
      attempt: attemptRecord.attempt,
      maxAttempts,
      backoff: attemptRecord.backoff,
      delayMs: attemptRecord.delayMs,
      nextAttemptAt: attemptRecord.nextAttemptAt,
      childFailure: classification.childFailure,
    });

    // Back to `running` with the cursor ON THE SAME NODE. There is no
    // `retrying` state — see `contracts/run.ts` — and the cursor not moving is
    // precisely what makes the next drive pass start the node again.
    return transition(record, {
      to: 'running',
      operation: 'step',
      reason:
        `Node ${pending.nodeId} failed on attempt ${pending.attempt}; ` +
        `attempt ${attemptRecord.attempt} of ${maxAttempts} scheduled.`,
      actorId: input.actor.actorId,
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        pendingNode: undefined,
        currentNodeId: pending.nodeId,
        retries: applyAttempt(
          record.retries,
          attemptRecord,
          attemptRecord.attemptVersion - 1,
        ),
      },
    });
  }

  /** The attempt record a scheduled retry produces. A value, never a write. */
  function scheduleNodeRetry(
    record: WorkflowRunRecord,
    step: WorkflowPlanStep,
    pending: WorkflowPendingNode,
    classification: ReturnType<typeof classifyChildFailure>,
    handle: AgentNodeHandle,
    branch?: WorkflowBranchRecord,
  ): WorkflowNodeAttempt {
    const existing = findAttempt(record.retries, pending.nodeId, branch?.branchId);
    return nextAttemptRecord(existing, {
      nodeId: pending.nodeId,
      ...(branch === undefined
        ? {}
        : { branchId: branch.branchId, branchName: branch.branchName }),
      maxAttempts: isAgentStep(step) ? step.maxAttempts : 1,
      policy: isAgentStep(step) ? step.retryPolicy : { backoff: 'immediate' },
      failedAttempt: pending.attempt,
      nowMs: clock.now(),
      at: clock.isoNow(),
      failure: 'workflow_node_failed',
      classification: classification.classification,
      ...(classification.childFailure === undefined
        ? {}
        : { childFailure: classification.childFailure }),
      childAgentRunId: handle.agentRunId,
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
      readonly kind: 'agent' | 'condition' | 'parallel' | 'join' | 'approval';
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
      readonly attempt?: number;
      readonly workflowApprovalId?: string;
      readonly approvalDecision?: WorkflowStepRecord['approvalDecision'];
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
      // Defaults to 1 for the kinds that cannot retry — a condition, a join and
      // an approval each happen exactly once per visit, because none of them
      // executes anything that could transiently fail.
      attempt: facts.attempt ?? 1,
      ...(facts.workflowApprovalId === undefined
        ? {}
        : { workflowApprovalId: facts.workflowApprovalId }),
      ...(facts.approvalDecision === undefined
        ? {}
        : { approvalDecision: facts.approvalDecision }),
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

  // ── Approvals (Part 5) ────────────────────────────────────────────────────

  /**
   * Park the run on a human decision.
   *
   * The approval record is written FIRST and the run is parked second — see the
   * header. Nothing else happens here: there is no third phase, because what
   * comes next is a person deciding through a different call path entirely.
   *
   * `workflowRunVersion` is stamped as the version the park is ABOUT to
   * produce, not the one the record currently carries. That is what makes the
   * binding checkable later: while a run is parked on an approval nothing may
   * touch it — pause is refused from `waiting_for_approval` and every other
   * operation is terminal — so the number the approval names is the number the
   * run will still be at when the decision arrives.
   */
  async function runApprovalNode(
    record: WorkflowRunRecord,
    step: WorkflowApprovalPlanStep,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    const approval = await approvals.request({
      workflowRunId: record.context.workflowRunId,
      organizationId: record.context.organizationId,
      workflowId: record.context.workflowId,
      nodeId: step.nodeId,
      // The run's own actor, never the person who will decide.
      requestedBy: record.context.actorId,
      reason: step.reason,
      impactSummary: step.impactSummary,
      estimatedAdditionalTokens: step.estimatedAdditionalTokens,
      estimatedAdditionalCostMicroUsd: step.estimatedAdditionalCostMicroUsd,
      approverRoles: step.approverRoles,
      onRejection: step.onRejection,
      expiresAfterMs: step.expiresAfterMs,
      checkpointVersion: record.checkpointVersion,
      workflowRunVersion: record.runVersion + 1,
    });

    metrics.increment('ai.workflow.approval.requested', {
      workflow: record.context.workflowId,
      node: step.nodeId,
    });
    logger.info('ai.workflow.approval.requested', {
      workflowRunId: record.context.workflowRunId,
      workflowApprovalId: approval.workflowApprovalId,
      nodeId: step.nodeId,
      // A definition-authored role list, safe in a log line where a node output
      // never would be.
      authorizedRoles: approval.authorizedRoles.join(','),
      expiresAt: approval.expiresAt,
    });

    return transition(record, {
      to: 'waiting_for_approval',
      operation: 'step',
      reason: `Node ${step.nodeId} is waiting for an approval.`,
      actorId: input.actor.actorId,
      patch: {
        pendingApproval: {
          workflowApprovalId: approval.workflowApprovalId,
          nodeId: step.nodeId,
          requestedAt: approval.createdAt,
          expiresAt: approval.expiresAt,
        },
      },
    });
  }

  /**
   * Read the decision a parked run is waiting on, and act on it.
   *
   * Five outcomes, and only one of them moves the run forward. A pending
   * request produces NO WRITE at all — there is nothing new to persist, and a
   * write per poll would burn a run version on every operator refresh.
   */
  async function resolveApproval(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<{ readonly record: WorkflowRunRecord; readonly done: boolean }> {
    const pointer = record.pendingApproval;
    if (!pointer) {
      throw workflowFailure('workflow_persistence_failed', 'This run cannot be continued.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: 'run is waiting_for_approval with no pendingApproval',
      });
    }

    const step = stepFor(plan, pointer.nodeId);
    if (!step || !isApprovalStep(step)) {
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: pointer.nodeId,
          diagnostics: `pending approval node ${pointer.nodeId} is not an approval node`,
        },
      );
    }

    const approval = await approvals.expireIfDue(
      await approvals.require(record.context.organizationId, pointer.workflowApprovalId),
    );

    const binding: WorkflowApprovalBinding = {
      nodeId: step.nodeId,
      checkpointVersion: record.checkpointVersion,
      workflowRunVersion: record.runVersion,
    };

    switch (approval.approvalState) {
      case 'pending':
        return { record, done: true };

      case 'expired':
        // EXPIRY IS NEVER APPROVAL. It ends the run, and it ends it as a
        // failure rather than as the run's own `expired` state — that word is
        // reserved for a run that outlived its deadline, and this is a workflow
        // that did not get an answer it required.
        throw workflowFailure(
          'workflow_approval_expired',
          'This workflow was not approved in time.',
          {
            workflowRunId: record.context.workflowRunId,
            nodeId: step.nodeId,
            diagnostics:
              `approval ${approval.workflowApprovalId} expired at ${approval.expiresAt}`,
          },
        );

      case 'withdrawn':
        throw workflowFailure(
          'workflow_approval_conflict',
          'This run is waiting on an approval that was withdrawn.',
          {
            workflowRunId: record.context.workflowRunId,
            nodeId: step.nodeId,
            diagnostics: `approval ${approval.workflowApprovalId} was withdrawn`,
          },
        );

      case 'rejected':
        return { record: await applyRejection(record, step, approval, input), done: true };

      case 'consumed': {
        // A CRASH BETWEEN THE CONSUME AND THE TRANSITION, and nothing else.
        // The binding is re-checked here rather than trusted, and the only way
        // it still matches is that the release never happened — every form of
        // real progress moves the checkpoint version. Anything else is a replay
        // and is refused without touching the run.
        const stale = bindingProblem(approval, binding);
        if (stale) {
          throw workflowFailure(
            'workflow_approval_conflict',
            'That approval has already been used.',
            {
              workflowRunId: record.context.workflowRunId,
              nodeId: step.nodeId,
              diagnostics: `${approval.workflowApprovalId} already consumed: ${stale}`,
            },
          );
        }
        logger.info('ai.workflow.approval.release_resumed', {
          workflowRunId: record.context.workflowRunId,
          workflowApprovalId: approval.workflowApprovalId,
          nodeId: step.nodeId,
        });
        return { record: await releaseApproval(record, plan, step, approval, data, input), done: false };
      }

      default: {
        // Approved. SPEND IT FIRST — single use is the stronger guarantee, so
        // the consume is committed before the transition that benefits from it.
        const consumed = await approvals.consume(
          record.context.organizationId,
          approval.workflowApprovalId,
          binding,
        );
        return { record: await releaseApproval(record, plan, step, consumed, data, input), done: false };
      }
    }
  }

  /**
   * Does this approval still authorise movement from where the run is?
   *
   * A read-only mirror of the gate's own binding check, used on the recovery
   * path where the engine has to ASK before it acts rather than be told by a
   * refusal. The gate remains the enforcer — this never replaces a `consume`,
   * it only decides whether calling one is meaningful.
   */
  function bindingProblem(
    approval: WorkflowApprovalRecord,
    binding: WorkflowApprovalBinding,
  ): string | undefined {
    if (approval.nodeId !== binding.nodeId) return 'a different node';
    if ((approval.branchId ?? undefined) !== (binding.branchId ?? undefined)) {
      return 'a different branch';
    }
    if (approval.branchId !== undefined) {
      return approval.branchVersion === binding.branchVersion
        ? undefined
        : 'a branch version this branch has moved past';
    }
    if (approval.checkpointVersion !== binding.checkpointVersion) {
      return 'a checkpoint this run has moved past';
    }
    if (approval.workflowRunVersion !== binding.workflowRunVersion) {
      return 'a run version this run has moved past';
    }
    return undefined;
  }

  /** Move the run past a spent approval, exactly as a completed node would. */
  async function releaseApproval(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    step: WorkflowApprovalPlanStep,
    approval: WorkflowApprovalRecord,
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    data.nodeVisits[step.nodeId] = (data.nodeVisits[step.nodeId] ?? 0) + 1;
    advanceCursor(record, plan, step.nodeId, step.nextNodeId, data);

    // NO OUTPUT. An approval produces nothing referenceable — a later condition
    // must not be able to branch on "what the approver said", because the only
    // thing an approval decides is whether the run continues, and it has.
    const stepRecord = completedStep(
      record,
      step,
      {
        nodeId: step.nodeId,
        kind: 'approval',
        startedAt: record.pendingApproval?.requestedAt ?? approval.createdAt,
        workflowApprovalId: approval.workflowApprovalId,
        approvalDecision: 'approve',
      },
      data,
    );

    const checkpoint = await writeCheckpoint(record, data, {
      nodeId: step.nodeId,
      state: 'running',
      ...(step.nextNodeId === undefined ? {} : { cursorNodeId: step.nextNodeId }),
    });

    metrics.increment('ai.workflow.approval.consumed', {
      workflow: record.context.workflowId,
      node: step.nodeId,
    });
    logger.info('ai.workflow.approval.consumed', {
      workflowRunId: record.context.workflowRunId,
      workflowApprovalId: approval.workflowApprovalId,
      nodeId: step.nodeId,
      decidedBy: approval.decidedBy,
    });

    return transition(record, {
      to: 'running',
      operation: 'step',
      reason: `Approval ${step.nodeId} was granted.`,
      actorId: input.actor.actorId,
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        checkpointVersion: checkpoint.version,
        checkpointDigest: checkpoint.digest,
        pendingApproval: undefined,
        currentNodeId: step.nextNodeId,
      },
    });
  }

  /**
   * A human said no. What that does is the NODE's declared policy.
   *
   * `fail` raises a typed terminal failure and lets `terminate` end the run,
   * which is the same path every other terminal workflow failure takes. `cancel`
   * transitions directly, because cancellation is an operation rather than a
   * failure and a run cancelled by a declared policy should read in the history
   * exactly as one cancelled by an operator does.
   */
  async function applyRejection(
    record: WorkflowRunRecord,
    step: WorkflowApprovalPlanStep,
    approval: WorkflowApprovalRecord,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    metrics.increment('ai.workflow.approval.rejected', {
      workflow: record.context.workflowId,
      node: step.nodeId,
      policy: step.onRejection,
    });

    const stepRecord: WorkflowStepRecord = {
      stepId: ids.next('wfs'),
      sequence: record.steps.length,
      planIndex: step.index,
      nodeId: step.nodeId,
      kind: 'approval',
      iteration: countVisits(record, step.nodeId) + 1,
      workflowApprovalId: approval.workflowApprovalId,
      approvalDecision: 'reject',
      startedAt: record.pendingApproval?.requestedAt ?? approval.createdAt,
      completedAt: clock.isoNow(),
      latencyMs: Math.max(
        0,
        clock.now() - Date.parse(record.pendingApproval?.requestedAt ?? approval.createdAt),
      ),
      outcome: step.onRejection === 'cancel' ? 'cancelled' : 'failed',
      attempt: 1,
      failure: 'workflow_approval_rejected',
      checkpointVersion: record.checkpointVersion,
    };

    if (step.onRejection === 'cancel') {
      return transition(record, {
        to: 'cancelled',
        operation: 'cancel',
        reason: `Approval ${step.nodeId} was rejected.`,
        actorId: input.actor.actorId,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          pendingApproval: undefined,
          currentNodeId: undefined,
        },
      });
    }

    return transition(record, {
      to: 'failed',
      operation: 'fail',
      reason: `Approval ${step.nodeId} was rejected.`,
      actorId: input.actor.actorId,
      failure: 'workflow_approval_rejected',
      patch: {
        steps: [...record.steps, stepRecord],
        stepCount: record.steps.length + 1,
        pendingApproval: undefined,
        currentNodeId: undefined,
        failureMessage: 'A step of this workflow was not approved.',
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
  ): WorkflowAgentPlanStep | WorkflowConditionPlanStep | WorkflowApprovalPlanStep {
    const step = stepFor(plan, nodeId);
    if (!step || isParallelStep(step) || isJoinStep(step)) {
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowRunId: group.groupId,
          nodeId,
          diagnostics:
            `branch ${branch.branchName} cursor ${nodeId} is not an agent, condition or ` +
            `approval node in plan ${plan.digest}`,
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
    if (branch.state === 'waiting_for_approval') {
      return resolveBranchApproval(record, plan, group, branch, data, input);
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
    if (isApprovalStep(step)) {
      return parkBranchApproval(record, group, branch, step, input);
    }

    // A branch node whose next attempt is not yet due parks for the rest of
    // this advance, exactly as one waiting on a slow child does — so a sibling
    // is never held up by another branch's backoff.
    const waitMs = retryWaitMs(record, step.nodeId, branch.branchId);
    if (waitMs > 0) {
      logRetryWait(record, step.nodeId, waitMs, branch.branchId);
      return { record, blocked: true, settled: false };
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
    const attempt = currentAttempt(record.retries, step.nodeId, branch.branchId);

    // ── THE BRANCH DECISION, BEFORE THE CHILD EXISTS ─────────────────────────
    //
    // (AI-01 Batch 3B, Production Optimization Wiring.)
    //
    // Until this pass a branch node's decision was taken AFTER `agents.create`,
    // which made avoidance structurally unavailable to it: the facts carried a
    // child agent run id, and `decideNode` strips every avoidance input from a
    // node whose call already exists. The consequence was that a fan-out could
    // not benefit from reuse at all, and the reason given was that changing what
    // the join receives was a Part 4 decision nobody had taken.
    //
    // It is taken here, and it is the NARROWEST one available: an avoided branch
    // node produces the SAME declared output contract shape an executed one
    // produces, moves the branch cursor the same way, records the same step,
    // writes the same checkpoint and reaches the join through the same
    // `applyBranchOutcome`. Nothing about join policy, merge contracts, branch
    // schema validation, approval requirements or tenant isolation is relaxed.
    // The only difference is that no child agent run exists — which is what makes
    // the avoided-call event's zero actual cost a measurement rather than a
    // claim.
    //
    // The facts carry NO `agentRunId`, deliberately, because none exists yet.
    const decision = await financial.decideNode(
      nodeFinancialFacts(record, step, {
        actorId: input.actor.actorId,
        attempt,
        branchId: branch.branchId,
        groupId: group.groupId,
        inputDigest: digestValue(nodeInput),
      }),
    );

    if (decision !== undefined && decision.refused) {
      // The same refusal the main line takes, for the same single cause: the
      // administrative kill switch moved between `advance`'s check and this
      // node. Recorded — a refusal claims zero baseline and zero saving — and
      // then the run ends, because executing work the platform has just refused
      // would make the record a lie in the other direction.
      await financial.recordAttempt(
        nodeFinancialFacts(record, step, {
          actorId: input.actor.actorId,
          attempt,
          branchId: branch.branchId,
          groupId: group.groupId,
        }),
        decision,
      );
      throw workflowFailure('workflow_runtime_disabled', 'AI execution is currently unavailable.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: step.nodeId,
        diagnostics: `branch ${branch.branchId} node ${step.nodeId} was refused: ${decision.plan.reason}`,
      });
    }

    if (decision !== undefined && decision.avoided) {
      const avoided = await completeAvoidedBranchNode(
        record,
        group,
        branch,
        step,
        data,
        input,
        decision,
        attempt,
      );
      // `undefined` is a MISS: the avoided value could not satisfy the branch's
      // own declared output contract, so nothing was recorded, no event was
      // written and the node executes normally below. See the function.
      if (avoided !== undefined) return avoided;
    }

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
        attempt,
      },
      childAgentRunIds: [...branch.childAgentRunIds, handle.agentRunId],
    };

    const nextGroup = applyBranchProgress(group, updated, branch.branchVersion);

    const started = await transition(record, {
      to: 'waiting_for_branches',
      operation: 'step',
      reason:
        attempt === 1
          ? `Branch ${branch.branchName} handed ${step.nodeId} to ${step.agentId}.`
          : `Branch ${branch.branchName} handed ${step.nodeId} to ${step.agentId} ` +
            `(attempt ${attempt}).`,
      actorId: input.actor.actorId,
      patch: {
        parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
        childAgentRunIds: [...record.childAgentRunIds, handle.agentRunId],
      },
    });

    // ── THE BRANCH'S OWN FINANCIAL EVENT ──────────────────────────────────────
    //
    // Carrying `branchId` AND `groupId`, so branch, parallel-group and run
    // totals are all derivable by FILTERING one event set. There is no
    // per-branch accumulator here and none on the branch record — see
    // `contracts/parallel.ts` — so a branch total and a run total cannot be
    // summed as independent spend, because only one of them is stored.
    //
    // RE-DERIVED WITH THE CHILD'S IDENTITY, and the re-derivation is the control
    // that makes branch avoidance safe. The decision above was taken with no
    // child; this one is taken with one, and `decideNode` strips every avoidance
    // input from a node whose call already exists. So the plan recorded for an
    // EXECUTED branch node can never come back `reuse` or `deterministic`, and a
    // branch that fell through to execution cannot leave an avoided-call event
    // behind it — whatever the first decision said.
    const executedDecision = await financial.decideNode(
      nodeFinancialFacts(started, step, {
        actorId: input.actor.actorId,
        attempt,
        branchId: branch.branchId,
        groupId: group.groupId,
        agentRunId: handle.agentRunId,
        ...(handle.agentVersion === undefined ? {} : { agentVersion: handle.agentVersion }),
      }),
    );
    if (executedDecision !== undefined) {
      await financial.recordAttempt(
        nodeFinancialFacts(started, step, {
          actorId: input.actor.actorId,
          attempt,
          branchId: branch.branchId,
          groupId: group.groupId,
          agentRunId: handle.agentRunId,
          ...(handle.agentVersion === undefined ? {} : { agentVersion: handle.agentVersion }),
        }),
        executedDecision,
      );
    }

    return { record: started, blocked: false, settled: false };
  }

  /**
   * A BRANCH node answered without a model call
   * (AI-01 Batch 3B, Production Optimization Wiring).
   *
   * Reached only when Part 6A's admission said the call need not exist — a
   * declared deterministic path, or a prior output the Part 6B eligibility gate
   * validated. NO CHILD AGENT RUN IS CREATED.
   *
   * ── THE CONTRACT COMES FIRST, AND THE EVENT SECOND ────────────────────────
   *
   * The order is the whole of the safety argument, and it is the one place this
   * function deliberately differs from its main-line sibling. A branch whose
   * avoided value cannot satisfy its declared output contract MISSES: it returns
   * `undefined`, having written nothing at all, and the caller creates the child
   * and executes normally. If the event were emitted first, that fall-through
   * would leave an avoided-call event behind for a call that then happened —
   * zero actual cost, a full baseline "saved", and a provider invoice that
   * disagrees. Validating first makes that state unreachable rather than merely
   * unlikely.
   *
   * The main line fails the RUN on the same condition rather than falling
   * through, and that difference is intentional: a failed main-line node has no
   * sibling to strand, whereas failing one branch of a fan-out would apply a
   * join's failure policy to what is really a cache disagreement.
   *
   * ── COUNTED ONCE, ACROSS RESTARTS AND CONCURRENT ADVANCES ─────────────────
   *
   *   ONE EVENT. `recordAttempt` derives its id from the material execution
   *   identity — run, node, branch, attempt — so a second isolate deriving it
   *   again computes the same id and the store's insert-if-absent refuses it.
   *
   *   ONE COMPLETION. The branch reaches the join through `applyBranchOutcome`,
   *   the same function an executed branch reaches it through, which refuses a
   *   second outcome for one branch and reports that it refused.
   *
   *   ONE WRITE. `transition` compare-and-swaps on the run version and
   *   `applyBranchProgress` on the branch's own version, so a concurrent advance
   *   holding a stale view loses rather than overwriting.
   *
   *   NO CHILD AFTER A RESTART. The branch cursor has moved past this node and
   *   its state is `running` with no pending node, so the recovered isolate
   *   schedules the NEXT node — there is no path back into `beginBranchNode` for
   *   a node the branch has already left.
   */
  async function completeAvoidedBranchNode(
    record: WorkflowRunRecord,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    step: WorkflowAgentPlanStep,
    data: DataState,
    input: AdvanceWorkflowInput,
    decision: WorkflowNodeCostDecision,
    attempt: number,
  ): Promise<BranchTurn | undefined> {
    const startedAt = clock.isoNow();

    if (step.nextNodeId === undefined) {
      // Validation refuses a branch node with no successor, so this is a plan
      // that no longer matches the run. Not something to avoid around: fall
      // through and let the ordinary path raise the plan mismatch it always did.
      return undefined;
    }

    // ── THE BRANCH'S OWN DECLARED OUTPUT CONTRACT, APPLIED UNCHANGED ─────────
    //
    // The same `buildNodeOutput` an executed branch node's result passes
    // through, with the same branch scope, so the join is handed a value of
    // exactly the shape ordinary execution would have handed it. A reused value
    // is governed as a generated one and never more loosely.
    let output: { readonly stored: boolean; readonly value?: unknown };
    try {
      output = buildNodeOutput(record, step, data, decision.reuse?.output, branch);
    } catch (error) {
      if (!isWorkflowError(error)) throw error;
      // MISS. The avoided value is not an answer to this node. Nothing has been
      // written and no event has been emitted, so the caller executes normally.
      metrics.increment('ai.workflow.branch.avoidance_rejected', {
        workflow: record.context.workflowId,
        node: step.nodeId,
        failure: error.failure,
      });
      logger.info('ai.workflow.branch.avoidance_rejected', {
        workflowRunId: record.context.workflowRunId,
        branchId: branch.branchId,
        nodeId: step.nodeId,
        failure: error.failure,
        ...(decision.reuse === undefined
          ? {}
          : { reusableResultId: decision.reuse.sourceReusableResultId }),
      });
      return undefined;
    }

    const outputs = output.stored
      ? { ...branch.outputs, [step.nodeId]: output.value }
      : { ...branch.outputs };

    const outputBytes = canonicalBytes(outputs);
    if (outputBytes === undefined || outputBytes > WORKFLOW_PARALLEL_BOUNDS.maxBranchOutputsBytes) {
      // The same ceiling an executed branch is held to. Over it, this is not an
      // answer the branch may carry — a MISS rather than a failure, because a
      // freshly generated value might be smaller.
      metrics.increment('ai.workflow.branch.avoidance_rejected', {
        workflow: record.context.workflowId,
        node: step.nodeId,
        failure: 'workflow_output_rejected',
      });
      return undefined;
    }

    // ── EXACTLY ONE AVOIDED-CALL EVENT, AFTER THE CONTRACT AGREED ────────────
    const facts = nodeFinancialFacts(record, step, {
      actorId: input.actor.actorId,
      attempt,
      branchId: branch.branchId,
      groupId: group.groupId,
    });
    await financial.recordAttempt(facts, decision);

    const resultDigest = output.stored ? digestValue(output.value) : undefined;
    const reachedJoin = step.nextNodeId === group.joinNodeId;

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
        startedAt,
        agentId: step.agentId,
        // NO `childAgentRunId` AND NO `childState`. Nothing ran, and a step
        // record naming a child would be the one place an auditor could read
        // this as an execution that happened.
        branchId: branch.branchId,
        branchName: branch.branchName,
        attempt,
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

    metrics.increment('ai.workflow.branch.avoided', {
      workflow: record.context.workflowId,
      node: step.nodeId,
      decision: decision.plan.decision,
    });
    logger.info('ai.workflow.branch.avoided', {
      workflowRunId: record.context.workflowRunId,
      branchId: branch.branchId,
      nodeId: step.nodeId,
      decision: decision.plan.decision,
      reason: decision.plan.reason,
      ...(decision.reuse === undefined ? {} : { reuseType: decision.reuse.reuseType }),
      ...(decision.reuse === undefined
        ? {}
        : { reusableResultId: decision.reuse.sourceReusableResultId }),
    });

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: `Branch ${branch.branchName} answered ${step.nodeId} without a model call.`,
        actorId: input.actor.actorId,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          checkpointVersion: checkpoint.version,
          checkpointDigest: checkpoint.digest,
          parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
          retries: clearAttempt(record.retries, step.nodeId, branch.branchId),
        },
      }),
      blocked: false,
      settled,
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

    // Same fold as the main line, carrying the branch and group so a branch's
    // spend is derivable by filtering rather than accumulated a second time on
    // the branch record — see `contracts/parallel.ts` for why those fields were
    // deleted rather than filled in.
    record = absorbChildUsage(record, {
      agentRunId: pending.agentRunId,
      nodeId: pending.nodeId,
      branchId: branch.branchId,
      groupId: group.groupId,
      attempt: pending.attempt,
      ...(handle.usage === undefined ? {} : { usage: handle.usage }),
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

    // Settled before the branch outcome is judged — the same discipline the main
    // line follows, and the reason a branch that failed still carries the spend
    // it incurred into the run's totals.
    await settleNodeFinancials(record, step, handle, {
      actorId: input.actor.actorId,
      attempt: pending.attempt,
      branchId: branch.branchId,
      groupId: group.groupId,
    });

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
        attempt: pending.attempt,
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
          // BRANCH-LOCAL. The key includes this branch's id, so clearing it
          // cannot reach a sibling's count for the same node.
          retries: clearAttempt(record.retries, step.nodeId, branch.branchId),
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

    const maxAttempts = isAgentStep(step) ? step.maxAttempts : 1;
    const classification = classifyChildFailure(handle.failure);
    const exhausted = retriesExhausted(pending.attempt, maxAttempts);

    // A RETRY KEEPS THE BRANCH ALIVE. It is decided before the branch is
    // settled, because settling is irreversible — `applyBranchOutcome` refuses
    // a second outcome — and a branch that failed its first attempt has not
    // finished until its budget has.
    if (classification.retryable && !exhausted) {
      return retryBranchNode(record, group, branch, step, pending, classification, handle, input);
    }

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
      attempt: pending.attempt,
      failureClass: classification.classification,
      retryScheduled: false,
      failure: exhausted && classification.retryable
        ? 'workflow_retry_exhausted'
        : 'workflow_branch_failed',
      checkpointVersion: record.checkpointVersion,
    };

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: exhausted && classification.retryable
          ? `Branch ${branch.branchName} failed ${pending.nodeId} on attempt ` +
            `${pending.attempt} of ${maxAttempts}.`
          : `Branch ${branch.branchName} failed at ${pending.nodeId}.`,
        actorId: input.actor.actorId,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          parallelGroups: upsertGroup(record.parallelGroups, outcome.group),
          // The branch is settled, so its attempt records go with it — and only
          // its own. A sibling's counts for the very same node are a different
          // key and are untouched.
          retries: clearBranchAttempts(record.retries, branch.branchId),
        },
      }),
      blocked: false,
      settled: true,
    };
  }

  /**
   * A branch node that failed transiently and still has attempts.
   *
   * The branch goes back to `running` with its cursor ON THE SAME NODE, exactly
   * as the main line does. `applyBranchProgress` — not `applyBranchOutcome` —
   * because this is progress rather than a settlement: the branch has not
   * finished, and a settled branch takes no further work.
   */
  async function retryBranchNode(
    record: WorkflowRunRecord,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    step: WorkflowPlanStep,
    pending: WorkflowPendingNode,
    classification: ReturnType<typeof classifyChildFailure>,
    handle: AgentNodeHandle,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    const attemptRecord = scheduleNodeRetry(
      record,
      step,
      pending,
      classification,
      handle,
      branch,
    );
    const maxAttempts = isAgentStep(step) ? step.maxAttempts : 1;

    const progressed: WorkflowBranchRecord = {
      ...branch,
      state: 'running',
      branchVersion: branch.branchVersion + 1,
      cursorNodeId: pending.nodeId,
      pendingNode: undefined,
    };
    const nextGroup = applyBranchProgress(group, progressed, branch.branchVersion);

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
      attempt: pending.attempt,
      failureClass: classification.classification,
      retryScheduled: true,
      failure: 'workflow_branch_failed',
      checkpointVersion: record.checkpointVersion,
    };

    metrics.increment('ai.workflow.retry.scheduled', {
      workflow: record.context.workflowId,
      node: pending.nodeId,
      backoff: attemptRecord.backoff,
    });
    logger.info('ai.workflow.branch.retry_scheduled', {
      workflowRunId: record.context.workflowRunId,
      branchId: branch.branchId,
      nodeId: pending.nodeId,
      attempt: attemptRecord.attempt,
      maxAttempts,
      backoff: attemptRecord.backoff,
      nextAttemptAt: attemptRecord.nextAttemptAt,
    });

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason:
          `Branch ${branch.branchName} failed ${pending.nodeId} on attempt ` +
          `${pending.attempt}; attempt ${attemptRecord.attempt} of ${maxAttempts} scheduled.`,
        actorId: input.actor.actorId,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
          retries: applyAttempt(
            record.retries,
            attemptRecord,
            attemptRecord.attemptVersion - 1,
          ),
        },
      }),
      blocked: false,
      settled: false,
    };
  }

  /**
   * Park ONE BRANCH on a human decision (AI-01 Batch 3B, Part 5).
   *
   * The run stays `waiting_for_branches`. Only this branch stops, and it is
   * returned as `blocked` so the drive loop parks it for the rest of the
   * advance and moves on to its siblings — which is the whole reason a fan-out
   * with one approval in it is not a fan-out that stops.
   *
   * The binding is the BRANCH's version, not the run's: a sibling completing a
   * node legitimately writes a checkpoint and bumps the run version while this
   * branch sits untouched. See `contracts/approval.ts`.
   */
  async function parkBranchApproval(
    record: WorkflowRunRecord,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    step: WorkflowApprovalPlanStep,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    const approval = await approvals.request({
      workflowRunId: record.context.workflowRunId,
      organizationId: record.context.organizationId,
      workflowId: record.context.workflowId,
      nodeId: step.nodeId,
      branchId: branch.branchId,
      branchName: branch.branchName,
      requestedBy: record.context.actorId,
      reason: step.reason,
      impactSummary: step.impactSummary,
      estimatedAdditionalTokens: step.estimatedAdditionalTokens,
      estimatedAdditionalCostMicroUsd: step.estimatedAdditionalCostMicroUsd,
      approverRoles: step.approverRoles,
      onRejection: step.onRejection,
      expiresAfterMs: step.expiresAfterMs,
      checkpointVersion: record.checkpointVersion,
      workflowRunVersion: record.runVersion + 1,
      branchVersion: branch.branchVersion + 1,
    });

    const parked: WorkflowBranchRecord = {
      ...branch,
      state: 'waiting_for_approval',
      branchVersion: branch.branchVersion + 1,
      pendingApproval: {
        workflowApprovalId: approval.workflowApprovalId,
        nodeId: step.nodeId,
        branchId: branch.branchId,
        requestedAt: approval.createdAt,
        expiresAt: approval.expiresAt,
      },
    };
    const nextGroup = applyBranchProgress(group, parked, branch.branchVersion);

    metrics.increment('ai.workflow.approval.requested', {
      workflow: record.context.workflowId,
      node: step.nodeId,
    });
    logger.info('ai.workflow.branch.approval_requested', {
      workflowRunId: record.context.workflowRunId,
      branchId: branch.branchId,
      workflowApprovalId: approval.workflowApprovalId,
      nodeId: step.nodeId,
      expiresAt: approval.expiresAt,
    });

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: `Branch ${branch.branchName} is waiting for an approval at ${step.nodeId}.`,
        actorId: input.actor.actorId,
        patch: { parallelGroups: upsertGroup(record.parallelGroups, nextGroup) },
      }),
      blocked: true,
      settled: false,
    };
  }

  /**
   * Read the decision a parked BRANCH is waiting on, and act on it.
   *
   * A rejection settles the BRANCH — failed, or cancelled under
   * `onRejection: 'cancel'` — and what that does to its siblings is the group's
   * declared failure policy, decided afterwards by `decideJoin`. The engine
   * does not promote a branch's rejection into a run's outcome, because a
   * workflow that declared `wait_all` and `minimum_successes: 1` has already
   * said what one refused branch means.
   */
  async function resolveBranchApproval(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    const pointer = branch.pendingApproval;
    if (!pointer) {
      throw workflowFailure('workflow_persistence_failed', 'This run cannot be continued.', {
        workflowRunId: record.context.workflowRunId,
        diagnostics: `branch ${branch.branchId} is waiting_for_approval with no pendingApproval`,
      });
    }

    const step = branchStepFor(plan, group, branch, pointer.nodeId);
    if (!isApprovalStep(step)) {
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: pointer.nodeId,
          diagnostics: `branch pending approval node ${pointer.nodeId} is not an approval node`,
        },
      );
    }

    const approval = await approvals.expireIfDue(
      await approvals.require(record.context.organizationId, pointer.workflowApprovalId),
    );

    const binding: WorkflowApprovalBinding = {
      nodeId: step.nodeId,
      branchId: branch.branchId,
      checkpointVersion: record.checkpointVersion,
      workflowRunVersion: record.runVersion,
      branchVersion: branch.branchVersion,
    };

    if (approval.approvalState === 'pending') {
      return { record, blocked: true, settled: false };
    }

    if (approval.approvalState === 'expired' || approval.approvalState === 'withdrawn') {
      return settleBranchApproval(record, group, branch, step, approval, input, {
        state: 'failed',
        failure: 'workflow_approval_expired',
        reason: `Branch ${branch.branchName} was not approved in time at ${step.nodeId}.`,
      });
    }

    if (approval.approvalState === 'rejected') {
      return settleBranchApproval(record, group, branch, step, approval, input, {
        state: step.onRejection === 'cancel' ? 'cancelled' : 'failed',
        failure: 'workflow_approval_rejected',
        reason: `Branch ${branch.branchName} was rejected at ${step.nodeId}.`,
      });
    }

    if (approval.approvalState === 'consumed') {
      // The same crash-recovery window the main line has, judged the same way.
      const stale = bindingProblem(approval, binding);
      if (stale) {
        throw workflowFailure(
          'workflow_approval_conflict',
          'That approval has already been used.',
          {
            workflowRunId: record.context.workflowRunId,
            nodeId: step.nodeId,
            diagnostics: `${approval.workflowApprovalId} already consumed: ${stale}`,
          },
        );
      }
      return releaseBranchApproval(record, group, branch, step, approval, data, input);
    }

    const consumed = await approvals.consume(
      record.context.organizationId,
      approval.workflowApprovalId,
      binding,
    );
    return releaseBranchApproval(record, group, branch, step, consumed, data, input);
  }

  /** Move a branch past a spent approval, onto the next node of its body. */
  async function releaseBranchApproval(
    record: WorkflowRunRecord,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    step: WorkflowApprovalPlanStep,
    approval: WorkflowApprovalRecord,
    data: DataState,
    input: AdvanceWorkflowInput,
  ): Promise<BranchTurn> {
    if (step.nextNodeId === undefined) {
      // Validation refuses a branch node with no successor, so this is a plan
      // that no longer matches the run. Refusing beats guessing — a branch that
      // ends without telling the join is a join that waits forever.
      throw workflowFailure(
        'workflow_plan_mismatch',
        'This workflow has changed since the run started.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: step.nodeId,
          diagnostics: `branch approval ${step.nodeId} has no successor`,
        },
      );
    }

    const reachedJoin = step.nextNodeId === group.joinNodeId;
    const progressed: WorkflowBranchRecord = {
      ...branch,
      state: 'running',
      branchVersion: branch.branchVersion + 1,
      cursorNodeId: step.nextNodeId,
      pendingApproval: undefined,
      nodeVisits: {
        ...branch.nodeVisits,
        [step.nodeId]: (branch.nodeVisits[step.nodeId] ?? 0) + 1,
      },
      stepCount: branch.stepCount + 1,
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
        kind: 'approval',
        startedAt: branch.pendingApproval?.requestedAt ?? approval.createdAt,
        branchId: branch.branchId,
        branchName: branch.branchName,
        workflowApprovalId: approval.workflowApprovalId,
        approvalDecision: 'approve',
      },
      data,
    );

    const checkpoint = await writeCheckpoint(record, data, {
      nodeId: step.nodeId,
      state: 'waiting_for_branches',
      cursorNodeId: group.parallelNodeId,
      parallelGroups: upsertGroup(record.parallelGroups, nextGroup),
    });

    metrics.increment('ai.workflow.approval.consumed', {
      workflow: record.context.workflowId,
      node: step.nodeId,
    });

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: `Branch ${branch.branchName} was approved at ${step.nodeId}.`,
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

  /** End a branch on a refused, expired or withdrawn approval. */
  async function settleBranchApproval(
    record: WorkflowRunRecord,
    group: WorkflowParallelGroup,
    branch: WorkflowBranchRecord,
    step: WorkflowApprovalPlanStep,
    approval: WorkflowApprovalRecord,
    input: AdvanceWorkflowInput,
    closure: {
      readonly state: 'failed' | 'cancelled';
      readonly failure: 'workflow_approval_rejected' | 'workflow_approval_expired';
      readonly reason: string;
    },
  ): Promise<BranchTurn> {
    const outcome = applyBranchOutcome(
      group,
      branch.branchId,
      { state: closure.state, at: clock.isoNow(), failure: closure.failure },
      branch.branchVersion,
    );

    if (!outcome.applied) {
      metrics.increment('ai.workflow.branch.duplicate_completion', {
        workflow: record.context.workflowId,
        node: step.nodeId,
      });
      return { record, blocked: false, settled: false };
    }

    metrics.increment('ai.workflow.approval.rejected', {
      workflow: record.context.workflowId,
      node: step.nodeId,
      policy: step.onRejection,
    });

    const startedAt = branch.pendingApproval?.requestedAt ?? approval.createdAt;
    const stepRecord: WorkflowStepRecord = {
      stepId: ids.next('wfs'),
      sequence: record.steps.length,
      planIndex: step.index,
      nodeId: step.nodeId,
      kind: 'approval',
      iteration: countVisits(record, step.nodeId) + 1,
      branchId: branch.branchId,
      branchName: branch.branchName,
      workflowApprovalId: approval.workflowApprovalId,
      ...(approval.decision === undefined ? {} : { approvalDecision: approval.decision }),
      startedAt,
      completedAt: clock.isoNow(),
      latencyMs: Math.max(0, clock.now() - Date.parse(startedAt)),
      outcome: closure.state === 'cancelled' ? 'cancelled' : 'failed',
      attempt: 1,
      failure: closure.failure,
      checkpointVersion: record.checkpointVersion,
    };

    return {
      record: await transition(record, {
        to: 'waiting_for_branches',
        operation: 'step',
        reason: closure.reason,
        actorId: input.actor.actorId,
        patch: {
          steps: [...record.steps, stepRecord],
          stepCount: record.steps.length + 1,
          parallelGroups: upsertGroup(record.parallelGroups, outcome.group),
          retries: clearBranchAttempts(record.retries, branch.branchId),
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
        retries: [],
        // Empty, and empty means "nothing has been spent" rather than "spend is
        // unknown" — the run has created no child agent runs yet, so there is
        // nothing that could have spent anything.
        usage: emptyUsageLedger(input.organizationId),
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

      // The run's financial context, established once the run is durable. No
      // event: a run that has executed no node has spent nothing, and the
      // baseline that matters is the one each node's plan prices. See
      // `financial/contracts/emission.ts`.
      await financial.openRun({
        organizationId: input.organizationId,
        actorId: input.actor.actorId,
        workflowId: definition.workflowId,
        workflowVersion: definition.version,
        workflowRunId,
        configurationVersion: record.configurationVersion,
        occurredAt: now,
      });

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
      //
      // FINALIZATION IS REPEATED HERE, and repeating it is the point. An isolate
      // that died between persisting the terminal state and finishing settlement
      // left events pending against a run nothing will ever drive again; this is
      // the path a recovered isolate takes over that run, and finalization
      // converges — already-settled events are preserved, already-abandoned ones
      // are left alone, and only a still-pending one moves. Nothing here changes
      // the run: `finalizeRun` cannot write a run record.
      if (isTerminalWorkflowState(record.state)) {
        await finalizeFinancials(record);
        return record;
      }

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
      let record = await loadForControl(input);

      // CANCEL IS THE ESCAPE PATH FROM AN APPROVAL, and this is what makes it
      // one: the pending request is withdrawn so it stops sitting in a queue
      // nobody can clear. Withdrawal is never approval — the run is ending, not
      // proceeding.
      await withdrawApprovals(record, 'The run was cancelled.');

      // The children are stopped FIRST. Cancelling the workflow while leaving
      // its agent runs driving would be a cancellation in name only — the
      // effects the operator is trying to stop are the children's.
      if (record.pendingNode) {
        const pending = record.pendingNode;
        try {
          const handle = await agents.cancel({
            organizationId: record.context.organizationId,
            agentRunId: pending.agentRunId,
            actor: input.actor.agent,
            reason: `Parent workflow run ${record.context.workflowRunId} was cancelled.`,
            requestId: input.requestId,
            correlationId: record.context.correlationId,
          });

          // THE SPEND A CANCELLED CHILD ALREADY INCURRED, folded before the run
          // is closed (AI-01 Batch 3B, Integration Pass).
          //
          // A child stopped mid-flight had really spent money, and its last
          // observation was made during an advance that wrote nothing — a
          // blocked child produces no write, by design. Without this fold the
          // durable ledger would have no row for it, terminal finalization would
          // find no measurement, and the call would be reported as permanently
          // unknown when the platform had just been told the figure.
          //
          // It rides the SAME compare-and-swap as the cancellation below, so a
          // crash cannot leave the spend recorded against a run that is not
          // cancelled, or a cancelled run missing the spend.
          record = absorbChildUsage(record, {
            agentRunId: pending.agentRunId,
            nodeId: pending.nodeId,
            attempt: pending.attempt,
            ...(handle.usage === undefined ? {} : { usage: handle.usage }),
          });
        } catch (error) {
          // A child that cannot be cancelled must not block the parent's
          // cancellation: the operator's instruction is the more important of
          // the two, and the child has its own deadline.
          logger.warn('ai.workflow.child_cancel_failed', {
            workflowRunId: record.context.workflowRunId,
            childAgentRunId: pending.agentRunId,
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
        patch: {
          pendingNode: undefined,
          pendingApproval: undefined,
          currentNodeId: undefined,
          parallelGroups: groups,
        },
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

    // A request the run can no longer spend is withdrawn rather than left in a
    // queue. Unlike the child agent runs, an approval costs nothing to close —
    // it is a local write, not a fan of remote cancellations — so the argument
    // that keeps expiry from chasing children does not apply here.
    await withdrawApprovals(record, 'The run passed its deadline.');

    return transition(record, {
      to: 'expired',
      operation: 'expire',
      reason: 'The run passed its deadline.',
      actorId,
      failure: 'workflow_expired',
      patch: {
        failureMessage: 'This workflow run took longer than its deadline allowed.',
        pendingNode: undefined,
        pendingApproval: undefined,
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
        if (isApprovalStep(step)) {
          // Parking is the END of this advance, not a step within it: what
          // happens next is a person deciding, and there is nothing further to
          // drive until they do.
          return { record: await runApprovalNode(record, step, input), done: true };
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
        // THE RETRY GATE. A node whose next attempt is not yet due hands the
        // run back untouched, having created nothing — no child, no version, no
        // write. Nothing wakes it up when the delay elapses; a caller advances
        // the run again and it proceeds. See the header.
        const waitMs = retryWaitMs(record, step.nodeId);
        if (waitMs > 0) {
          logRetryWait(record, step.nodeId, waitMs);
          return { record, done: true };
        }

        return {
          record: await beginNode(record, plan, step, data, input, definition),
          done: false,
        };
      }

      case 'waiting_for_approval':
        return resolveApproval(record, admit(record).plan, data, input);

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
