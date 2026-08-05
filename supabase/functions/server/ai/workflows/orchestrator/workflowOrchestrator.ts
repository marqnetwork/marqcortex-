/**
 * The Workflow Orchestrator (AI-01 Batch 3B).
 *
 * THE SINGLE AUTHORITY OVER WORKFLOW EXECUTION.
 *
 *   WORKFLOWS PLAN. AGENTS PROPOSE. THE ORCHESTRATOR DECIDES.
 *   THE AI CONTROL PLANE EXECUTES.
 *
 * A definition is data. A plan is a compiled, digested artefact. This module is
 * the only thing that turns either into an action, and it does so through ports:
 * an agent port over the certified Batch 3A orchestrator, a tool port over the
 * certified Batch 3A gateway, and a model port over the certified AI Control
 * Plane. It holds no provider, no credential store, no adapter and no second path.
 *
 * THE NODE SEQUENCE, IN THE ORDER IT ACTUALLY RUNS:
 *
 *   administrative state   the kill switch and the master switch, re-read from
 *                          durable settings BEFORE anything else
 *   deadline and limits    steps, branch count, branch depth, retries, wait gate
 *   cursor selection       one node, on the main path or in exactly one branch,
 *                          chosen deterministically
 *   input mapping          resolved from a bounded, typed value space
 *   approval gate          park durably before doing the thing, never after
 *   optimize               context selection, dedup, trimming, manifest
 *   classify               deterministic task complexity
 *   route                  minimum-capable profile, fully explained
 *   cache                  tenant-scoped, policy-versioned, safe on miss
 *   cost preflight         platform, organization, actor, node, workflow
 *   reserve                a run-scoped hold, so two nodes cannot share headroom
 *   execute                agent / tool / model through its port, never directly
 *   validate               the node's declared output contract
 *   reconcile              measured tokens and cost, attribution, variance
 *   output mapping         validated values into the workflow's scratch space
 *   checkpoint             immutable, versioned, resumable
 *   persist                one compare-and-swap; a lost race is never merged
 *
 * DURABILITY IS NOT A PHASE AT THE END. The run is persisted before an action
 * executes and again after it completes, so an isolate that dies mid-tool leaves a
 * run that plainly says `waiting_for_tool` at a known checkpoint rather than one
 * that looks idle and has already called something.
 *
 * PARALLELISM IS LOGICAL, EXECUTION IS DETERMINISTIC — and that is a decision
 * worth stating plainly rather than discovering. Branches have independent state,
 * independent ledgers, independent failure handling and real join semantics; what
 * they do not have is simultaneous execution inside one isolate. The engine
 * interleaves them one node at a time in branch-id order, because every mutation
 * is a compare-and-swap on ONE run record: two genuinely concurrent branches would
 * contend on every write, and the loser would have to discard work it had already
 * done. Serialised interleaving gives bounded fan-out, deterministic joins and
 * reproducible tests, and it is what makes `serialize_parallel_work` a real cost
 * lever rather than a label.
 *
 * WHAT THIS MODULE DELIBERATELY CANNOT DO: reach a provider, read a credential,
 * write a settings record, move a platform budget, mutate an agent run, or edit an
 * audit record. Each lives behind a port it is given or a layer it has no import
 * for, and the boundary scan asserts the absence of the imports.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Logger } from '../../observability/logger.ts';
import type { Metrics } from '../../observability/metrics.ts';
import type { AgentRunActor } from '../../agents/orchestrator/agentOrchestrator.ts';
import type { ModelExecutionPort } from '../../agents/orchestrator/controlPlaneBridge.ts';
import type { ModelProfileRegistry } from '../../agents/runtime/modelRouting.ts';
import { indicativeCostMicroUsd } from '../../agents/runtime/modelRouting.ts';
import { canonicalBytes, digestValue } from '../../agents/runtime/digest.ts';
import { describeIssues, isFailure } from '../../security/validation.ts';

import type {
  WorkflowAgentNode,
  WorkflowConditionNode,
  WorkflowDefinition,
  WorkflowModelNode,
  WorkflowNode,
  WorkflowParallelNode,
  WorkflowToolNode,
  WorkflowTransformNode,
} from '../contracts/workflow.ts';
import type {
  WorkflowBranchRecord,
  WorkflowCheckpoint,
  WorkflowJoinRecord,
  WorkflowNodeRecord,
  WorkflowRunContext,
  WorkflowRunOperation,
  WorkflowRunRecord,
  WorkflowRunState,
} from '../contracts/runtime.ts';
import {
  WORKFLOW_CHECKPOINT_BOUNDS,
  WORKFLOW_HISTORY_BOUNDS,
  isTerminalWorkflowState,
} from '../contracts/runtime.ts';
import type { WorkflowFailureCode } from '../contracts/failures.ts';
import {
  isNodeRetryable,
  isWorkflowError,
  terminalStateFor,
  workflowFailure,
} from '../contracts/failures.ts';
import type { WorkflowRegistry } from '../registry/workflowRegistry.ts';
import type { WorkflowPlan } from '../planner/workflowPlanner.ts';
import { nextNodeId, planWorkflow } from '../planner/workflowPlanner.ts';
import { assertWorkflowTransition, PAUSABLE_STATES } from '../runtime/stateMachine.ts';
import { edgesFrom } from '../runtime/graph.ts';
import type { WorkflowRunFacts, WorkflowValueSpace } from '../runtime/mapping.ts';
import { applyOutputMapping, resolveMapping, resolvePath } from '../runtime/mapping.ts';
import type { PredicateRegistry } from '../runtime/predicates.ts';
import { evaluatePredicate } from '../runtime/predicates.ts';
import type { TransformRegistry } from '../runtime/transforms.ts';
import { runTransform } from '../runtime/transforms.ts';
import type { ResolvedContextSection } from '../runtime/tokenOptimizer.ts';
import { optimizeWorkflowContext } from '../runtime/tokenOptimizer.ts';
import { classifyTaskComplexity } from '../runtime/complexity.ts';
import { isWorkflowRoutingRefused, routeWorkflowProfile } from '../runtime/profileRouter.ts';
import {
  decideWorkflowCost,
  emptyWorkflowCostLedger,
  projectWorkflowStepCost,
  recordAvoidedCost,
  releaseWorkflowCost,
  reserveWorkflowCost,
  settleWorkflowCost,
} from '../runtime/costOptimizer.ts';
import type { WorkflowCachePort } from '../runtime/cache.ts';
import { buildCacheKey, cacheEligibilityFor, isEntryUsable } from '../runtime/cache.ts';
import {
  appendBounded,
  buildAvoidedCallRecord,
  emptyWorkflowTokenLedger,
  recordAvoidedTokens,
  recordWorkflowEstimate,
  reconcileWorkflowUsage,
} from '../runtime/ledgers.ts';
import {
  branchesToCancel,
  evaluateJoin,
  initialJoinRecord,
  mergeBranchOutputs,
  recordBranchArrival,
} from '../runtime/joins.ts';
import type { WorkflowCheckpointStore, WorkflowRunStore } from '../persistence/ports.ts';
import type { WorkflowApprovalGate } from '../approvals/workflowApprovalGate.ts';
import type { WorkflowAuditWriter } from '../observability/workflowAudit.ts';
import { WORKFLOW_AUDIT_EVENT } from '../observability/workflowAudit.ts';
import type { AgentExecutionPort } from './agentBridge.ts';
import type { ToolExecutionPort } from './toolBridge.ts';

/** Administrative and health facts the engine re-reads before every node. */
export interface WorkflowRuntimeState {
  readonly aiEnabled: boolean;
  readonly executionAvailable: boolean;
  readonly degraded: boolean;
  readonly requireCertifiedProviders: boolean;
  readonly requireCertifiedWorkflows: boolean;
  readonly configurationVersion: number;
}

export interface WorkflowOrchestratorDependencies {
  readonly registry: WorkflowRegistry;
  readonly profiles: ModelProfileRegistry;
  readonly predicates: PredicateRegistry;
  readonly transforms: TransformRegistry;
  readonly agents: AgentExecutionPort;
  readonly tools: ToolExecutionPort;
  readonly models: ModelExecutionPort;
  readonly cache: WorkflowCachePort;
  readonly runs: WorkflowRunStore;
  readonly checkpoints: WorkflowCheckpointStore;
  readonly approvals: WorkflowApprovalGate;
  readonly audit: WorkflowAuditWriter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly metrics: Metrics;
  /** Settings and health, read live so an operator change lands immediately. */
  readonly runtimeState: () => WorkflowRuntimeState;
  /** Micro-USD still available under the MARQ lifetime ceiling. */
  readonly platformHeadroomMicroUsd: () => Promise<number>;
  /** Attempts the control plane may make per model step. Prices retry risk only. */
  readonly assumedProviderAttempts?: number;
  /** Micro-USD above which a node needs approval. Absent means no threshold. */
  readonly costApprovalThresholdMicroUsd?: number;
  /** True when high-risk nodes may be cached. Off unless a deployment opts in. */
  readonly highRiskCachingPermitted?: boolean;
  /** Optional per-organization and per-actor token/cost allowances. */
  readonly organizationHeadroom?: (
    organizationId: string,
  ) => Promise<{ readonly tokens?: number; readonly microUsd?: number }>;
}

export interface CreateWorkflowRunInput {
  readonly workflowId: string;
  readonly organizationId: string;
  readonly actor: AgentRunActor;
  readonly input: unknown;
  readonly requestId: string;
  readonly correlationId: string;
  readonly origin: WorkflowRunContext['origin'];
  readonly parentWorkflowRunId?: string;
}

export interface AdvanceWorkflowInput {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly actor: AgentRunActor;
  /** The driving caller's credential, for the control plane. Never stored. */
  readonly authorization: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly clientIp?: string;
}

export interface WorkflowControlInput {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly actor: AgentRunActor;
  readonly reason: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface WorkflowApprovalDecisionRequest extends WorkflowControlInput {
  readonly workflowApprovalId: string;
  readonly decision: 'approve' | 'reject';
}

export interface WorkflowOrchestrator {
  createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord>;
  /** Drive the run until it blocks, completes or fails. */
  advance(input: AdvanceWorkflowInput): Promise<WorkflowRunRecord>;
  pause(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  resume(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  cancel(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  decideApproval(input: WorkflowApprovalDecisionRequest): Promise<WorkflowRunRecord>;
  /** Fork a NEW run from a terminal one. Terminal records are never reopened. */
  retry(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  expireIfDue(input: WorkflowControlInput): Promise<WorkflowRunRecord>;
  latestCheckpoint(
    organizationId: string,
    workflowRunId: string,
  ): Promise<WorkflowCheckpoint | undefined>;
  /** The compiled plan for a registered workflow. Deterministic and cached. */
  planFor(workflowId: string): WorkflowPlan;
}

/**
 * Backstop on the drive loop.
 *
 * Not a limit: the workflow's own step ceiling is always the smaller of the two,
 * so reaching this means a node neither advanced the cursor nor stopped, which is
 * an engine defect rather than a runaway workflow. Ending the run is the safe
 * response either way.
 */
const MAX_DRIVE_ITERATIONS = 512;

/** What the cursor points at: one node, optionally inside one branch. */
interface Cursor {
  readonly nodeId: string;
  readonly branchId?: string;
}

export function createWorkflowOrchestrator(
  deps: WorkflowOrchestratorDependencies,
): WorkflowOrchestrator {
  const { registry, profiles, runs, checkpoints, approvals, audit, clock, ids } = deps;
  const assumedAttempts = Math.max(1, deps.assumedProviderAttempts ?? 2);

  /**
   * Compiled plans, memoised per (workflowId, version).
   *
   * Planning is deterministic and pure, so caching it changes nothing about the
   * result — it only avoids recompiling a graph on every node of every run. The
   * version is in the key, so a re-registered definition never serves a stale plan.
   */
  const planCache = new Map<string, WorkflowPlan>();

  function planFor(workflowId: string): WorkflowPlan {
    const definition = registry.require(workflowId);
    const key = `${definition.workflowId}@${definition.version}`;
    const cached = planCache.get(key);
    if (cached) return cached;
    const plan = planWorkflow(definition, {
      price: (profileId, promptTokens, completionTokens) => {
        const profile = profiles.find(profileId);
        return profile === undefined
          ? 0
          : indicativeCostMicroUsd(profile, promptTokens, completionTokens);
      },
    });
    planCache.set(key, plan);
    return plan;
  }

  // ── Small helpers ─────────────────────────────────────────────────────────

  function writeAudit(
    record: WorkflowRunRecord,
    facts: {
      event: (typeof WORKFLOW_AUDIT_EVENT)[keyof typeof WORKFLOW_AUDIT_EVENT];
      outcome: 'allowed' | 'denied' | 'executed' | 'failed' | 'recorded';
      requestId: string;
      correlationId: string;
      actorId: string;
      nodeId?: string;
      nodeType?: WorkflowNode['nodeType'];
      branchId?: string;
      nodeExecutionId?: string;
      executionRequestId?: string;
      childAgentRunId?: string;
      workflowApprovalId?: string;
      failure?: WorkflowFailureCode;
      reason?: string;
      detail?: Readonly<Record<string, unknown>>;
    },
  ): void {
    audit.record({
      event: facts.event,
      outcome: facts.outcome,
      requestId: facts.requestId,
      correlationId: facts.correlationId,
      workflowRunId: record.context.workflowRunId,
      workflowId: record.context.workflowId,
      workflowVersion: record.context.workflowVersion,
      organizationId: record.context.organizationId,
      actorId: facts.actorId,
      nodeId: facts.nodeId,
      nodeType: facts.nodeType,
      branchId: facts.branchId,
      nodeExecutionId: facts.nodeExecutionId,
      executionRequestId: facts.executionRequestId,
      childAgentRunId: facts.childAgentRunId,
      workflowApprovalId: facts.workflowApprovalId,
      state: record.state,
      failure: facts.failure,
      reason: facts.reason,
      detail: facts.detail,
    });
  }

  /** Apply a state change to a record. Validates, versions and records it. */
  function transition(
    record: WorkflowRunRecord,
    to: WorkflowRunState,
    operation: WorkflowRunOperation | 'step',
    options: { reason: string; actorId: string; failure?: WorkflowFailureCode },
  ): WorkflowRunRecord {
    assertWorkflowTransition({
      from: record.state,
      to,
      operation,
      currentVersion: record.runVersion,
      expectedVersion: record.runVersion,
      workflowRunId: record.context.workflowRunId,
    });

    const nowIso = clock.isoNow();
    const runVersion = record.runVersion + 1;
    const entry = {
      at: nowIso,
      from: record.state,
      to,
      operation,
      reason: options.reason.slice(0, 300),
      actorId: options.actorId,
      runVersion,
      ...(options.failure === undefined ? {} : { failure: options.failure }),
    };
    const transitions = [...record.transitions, entry];
    const overflow = Math.max(0, transitions.length - WORKFLOW_HISTORY_BOUNDS.transitions);

    return {
      ...record,
      state: to,
      runVersion,
      updatedAt: nowIso,
      transitions: transitions.slice(overflow),
      transitionsTruncated: record.transitionsTruncated + overflow,
      ...(options.failure === undefined ? {} : { failure: options.failure }),
      ...(isTerminalWorkflowState(to)
        ? {
            endedAt: nowIso,
            elapsedRuntimeMs: Math.max(0, clock.now() - Date.parse(record.createdAt)),
          }
        : {}),
    };
  }

  /** Persist a mutation under optimistic concurrency. */
  async function persist(
    next: WorkflowRunRecord,
    expectedVersion: number,
  ): Promise<WorkflowRunRecord> {
    await runs.save(next, expectedVersion);
    return next;
  }

  /** Bump the version without a state change, for a data-only mutation. */
  function touch(record: WorkflowRunRecord): WorkflowRunRecord {
    return { ...record, runVersion: record.runVersion + 1, updatedAt: clock.isoNow() };
  }

  async function loadRun(
    organizationId: string,
    workflowRunId: string,
  ): Promise<WorkflowRunRecord> {
    const record = await runs.load(organizationId, workflowRunId);
    if (!record) {
      throw workflowFailure('workflow_run_not_found', 'That workflow run could not be found.', {
        workflowRunId,
        diagnostics: `run ${workflowRunId} not found for organization ${organizationId}`,
      });
    }
    // The store is tenant-keyed, so this can only fire on a corrupt record — and a
    // record that disagrees with its own key is exactly where failing closed matters.
    if (record.context.organizationId !== organizationId) {
      throw workflowFailure(
        'tenant_isolation_violation',
        'That workflow run belongs to another organization.',
        { workflowRunId },
      );
    }
    return record;
  }

  /**
   * Refuse an ordinary control operation on a run that owes a human a decision.
   *
   * The state machine already refuses `pause` and `resume` from
   * `waiting_for_approval`. This is the second, independent guard, and it is not
   * redundancy: it keys on the PENDING APPROVAL rather than on the state, so a run
   * that somehow holds an undecided approval in any other state — a record written
   * by an older revision, a future code path — is still refused rather than driven
   * past its gate. The equivalent defect in the agent runtime was reachable through
   * the public API with ordinary permissions.
   */
  function assertNoPendingApproval(record: WorkflowRunRecord, operation: string): void {
    if (record.pendingApprovalId === undefined) return;
    throw workflowFailure(
      'approval_required',
      'This run is waiting for an approval decision.',
      {
        workflowRunId: record.context.workflowRunId,
        diagnostics:
          `${operation} refused: run holds undecided approval ${record.pendingApprovalId} ` +
          `in state ${record.state}`,
      },
    );
  }

  /** End a run terminally, persist it and record why. */
  async function terminate(
    record: WorkflowRunRecord,
    input: {
      readonly state: WorkflowRunState;
      readonly failure?: WorkflowFailureCode;
      readonly message: string;
      readonly diagnostics: string;
      readonly actorId: string;
      readonly requestId: string;
      readonly correlationId: string;
      readonly resultDigest?: string;
    },
  ): Promise<WorkflowRunRecord> {
    const operation: WorkflowRunOperation =
      input.state === 'completed'
        ? 'complete'
        : input.state === 'cancelled'
          ? 'cancel'
          : input.state === 'expired'
            ? 'expire'
            : 'fail';

    const next = transition(record, input.state, operation, {
      reason: input.message,
      actorId: input.actorId,
      failure: input.failure,
    });
    const finished: WorkflowRunRecord = {
      ...next,
      failureMessage: input.failure === undefined ? undefined : input.message,
      resultDigest: input.resultDigest ?? next.resultDigest,
      pendingApprovalId: undefined,
      pendingApprovalNodeId: undefined,
      pendingApprovalBranchId: undefined,
      activeBranchIds: [],
    };
    const saved = await persist(finished, record.runVersion);

    writeAudit(saved, {
      event: WORKFLOW_AUDIT_EVENT.runTerminated,
      outcome: input.failure === undefined ? 'recorded' : 'failed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actorId,
      failure: input.failure,
      reason: input.message,
      detail: {
        diagnostics: input.diagnostics,
        steps: saved.stepCount,
        totalTokens: saved.tokens.actualTotalTokens,
        costMicroUsd: saved.cost.actualMicroUsd,
        avoidedMicroUsd: saved.cost.avoidedMicroUsd,
      },
    });
    deps.metrics.increment('ai_workflow_runs_total', {
      state: saved.state,
      workflow: saved.context.workflowId,
    });
    return saved;
  }

  // ── Checkpoints ───────────────────────────────────────────────────────────

  async function writeCheckpoint(
    record: WorkflowRunRecord,
    output?: unknown,
  ): Promise<WorkflowRunRecord> {
    const version = record.checkpointVersion + 1;
    const previous = await checkpoints.latest(
      record.context.organizationId,
      record.context.workflowRunId,
    );

    const valuesBytes = canonicalBytes(record.values);
    if (valuesBytes === undefined || valuesBytes > WORKFLOW_CHECKPOINT_BOUNDS.maxValuesBytes) {
      throw workflowFailure(
        'persistence_failed',
        'This run produced more state than it may store.',
        {
          workflowRunId: record.context.workflowRunId,
          diagnostics:
            `checkpoint values ${valuesBytes ?? 'unserializable'} bytes exceeds ` +
            `${WORKFLOW_CHECKPOINT_BOUNDS.maxValuesBytes}`,
        },
      );
    }
    if (output !== undefined) {
      const outputBytes = canonicalBytes(output);
      if (outputBytes === undefined || outputBytes > WORKFLOW_CHECKPOINT_BOUNDS.maxOutputBytes) {
        throw workflowFailure(
          'persistence_failed',
          'This run produced more output than it may store.',
          {
            workflowRunId: record.context.workflowRunId,
            diagnostics:
              `checkpoint output ${outputBytes ?? 'unserializable'} bytes exceeds ` +
              `${WORKFLOW_CHECKPOINT_BOUNDS.maxOutputBytes}`,
          },
        );
      }
    }

    const outputDigests = Object.fromEntries(
      Object.entries(record.values)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, digestValue(value)]),
    );

    const body = {
      workflowRunId: record.context.workflowRunId,
      organizationId: record.context.organizationId,
      version,
      createdAt: clock.isoNow(),
      state: record.state,
      ...(record.currentNodeId === undefined ? {} : { nodeId: record.currentNodeId }),
      branches: record.branches,
      joins: record.joins,
      values: record.values,
      outputDigests,
      tokens: record.tokens,
      cost: record.cost,
      optimizationSummary: {
        totalTokensSaved: record.optimizations.reduce(
          (sum, entry) => sum + entry.totalTokensSaved,
          0,
        ),
        avoidedCalls: record.avoidedCalls.reduce((sum, entry) => sum + entry.avoidedCalls, 0),
        avoidedMicroUsd: record.cost.avoidedMicroUsd,
        cacheHits: record.cacheDecisions.filter((entry) => entry.outcome === 'hit').length,
      },
      approvalState: (record.pendingApprovalId === undefined ? 'none' : 'pending') as
        | 'none'
        | 'pending'
        | 'approved'
        | 'rejected'
        | 'expired',
      childAgentRunIds: record.childAgentRunIds,
      ...(previous === undefined ? {} : { previousDigest: previous.digest }),
      ...(output === undefined ? {} : { output }),
    };

    // The digest covers the checkpoint's own body including its link to the
    // previous one, so the chain is verifiable end to end rather than per entry.
    const checkpoint: WorkflowCheckpoint = { ...body, digest: digestValue(body) };
    await checkpoints.write(checkpoint);
    return { ...record, checkpointVersion: version };
  }

  // ── Value space ───────────────────────────────────────────────────────────

  function runFacts(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
    branchId: string | undefined,
  ): WorkflowRunFacts {
    return {
      workflowRunId: record.context.workflowRunId,
      workflowId: record.context.workflowId,
      workflowVersion: record.context.workflowVersion,
      state: record.state,
      stepCount: record.stepCount,
      retryCount: record.retryCount,
      branchId: branchId ?? '',
      branchDepth: record.branchDepth,
      actualPromptTokens: record.tokens.actualPromptTokens,
      actualCompletionTokens: record.tokens.actualCompletionTokens,
      actualTotalTokens: record.tokens.actualTotalTokens,
      actualCostMicroUsd: record.cost.actualMicroUsd,
      remainingTotalTokens: Math.max(
        0,
        definition.limits.maxTotalTokens - record.tokens.actualTotalTokens,
      ),
      remainingCostMicroUsd: Math.max(
        0,
        definition.limits.maxActualCostMicroUsd -
          record.cost.actualMicroUsd -
          record.cost.reservedMicroUsd,
      ),
      approvalState: record.pendingApprovalId === undefined ? 'none' : 'pending',
      elapsedRuntimeMs: record.elapsedRuntimeMs,
    };
  }

  function valueSpace(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
    branchId: string | undefined,
  ): WorkflowValueSpace {
    return {
      // The run's validated input, stored under a reserved key when the run was
      // created. Kept in `values` rather than in a separate field so a checkpoint
      // carries the whole value space in one place.
      input: record.values.__input__,
      values: record.values,
      run: runFacts(record, definition, branchId),
    };
  }

  // ── Cursor ────────────────────────────────────────────────────────────────

  /**
   * Which node runs next, deterministically.
   *
   * Branches first, in branch-id order, so interleaving is reproducible; the main
   * path only when no branch is active. A branch whose cursor has reached its join
   * is not "next" — it has ARRIVED, and `settleBranchArrivals` handles it before
   * this is asked again.
   */
  function selectCursor(record: WorkflowRunRecord): Cursor | undefined {
    const active = [...record.activeBranchIds].sort();
    for (const branchId of active) {
      const branch = record.branches.find((entry) => entry.branchId === branchId);
      if (!branch || branch.currentNodeId === undefined) continue;
      if (branch.state !== 'running' && branch.state !== 'pending') continue;
      return { nodeId: branch.currentNodeId, branchId };
    }
    if (record.currentNodeId !== undefined) return { nodeId: record.currentNodeId };
    return undefined;
  }

  function effectiveParallelWidth(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
  ): number {
    return Math.max(
      1,
      Math.min(record.parallelWidthOverride ?? definition.limits.maxParallelBranches,
        definition.limits.maxParallelBranches),
    );
  }

  /** Admit queued branches into free slots, in branch-id order. */
  function admitBranches(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
  ): WorkflowRunRecord {
    const width = effectiveParallelWidth(record, definition);
    const active = new Set(record.activeBranchIds);
    if (active.size >= width) return record;

    const queued = record.branches
      .filter((branch) => branch.state === 'pending' && !active.has(branch.branchId))
      .sort((a, b) => a.branchId.localeCompare(b.branchId));

    const admitted: string[] = [];
    for (const branch of queued) {
      if (active.size + admitted.length >= width) break;
      admitted.push(branch.branchId);
    }
    if (admitted.length === 0) return record;

    return {
      ...record,
      activeBranchIds: [...record.activeBranchIds, ...admitted].sort(),
      branches: record.branches.map((branch) =>
        admitted.includes(branch.branchId) ? { ...branch, state: 'running' as const } : branch,
      ),
    };
  }

  // ── Node bookkeeping ──────────────────────────────────────────────────────

  function attemptKey(cursor: Cursor): string {
    return cursor.branchId === undefined ? cursor.nodeId : `${cursor.nodeId}@${cursor.branchId}`;
  }

  function attemptsFor(record: WorkflowRunRecord, cursor: Cursor): number {
    return record.nodeAttempts[attemptKey(cursor)] ?? 0;
  }

  /** Record one node execution and move the cursor to `nextNode`. */
  function commitNode(
    record: WorkflowRunRecord,
    input: {
      readonly cursor: Cursor;
      readonly node: WorkflowNode;
      readonly outcome: WorkflowNodeRecord['outcome'];
      readonly inputDigest: string;
      readonly outputDigest?: string;
      readonly nextNode: string | undefined;
      readonly fields?: Partial<WorkflowNodeRecord>;
      readonly startedMs: number;
      readonly failure?: WorkflowFailureCode;
    },
  ): WorkflowRunRecord {
    const nowIso = clock.isoNow();
    const sequence = record.stepCount + 1;
    const attempt = attemptsFor(record, input.cursor) + 1;

    const nodeRecord: WorkflowNodeRecord = {
      nodeExecutionId: ids.next('wfn'),
      sequence,
      nodeId: input.node.nodeId,
      nodeType: input.node.nodeType,
      ...(input.cursor.branchId === undefined ? {} : { branchId: input.cursor.branchId }),
      attempt,
      startedAt: new Date(input.startedMs).toISOString(),
      completedAt: nowIso,
      latencyMs: Math.max(0, clock.now() - input.startedMs),
      outcome: input.outcome,
      inputDigest: input.inputDigest,
      estimatedPromptTokens: 0,
      estimatedCompletionTokens: 0,
      estimatedCostMicroUsd: 0,
      checkpointVersion: record.checkpointVersion,
      ...(input.outputDigest === undefined ? {} : { outputDigest: input.outputDigest }),
      ...(input.nextNode === undefined ? {} : { nextNodeId: input.nextNode }),
      ...(input.failure === undefined ? {} : { failure: input.failure }),
      ...input.fields,
    };

    const withCursor = moveCursor(record, input.cursor, input.nextNode);

    return {
      ...withCursor,
      stepCount: sequence,
      nodeAttempts: { ...record.nodeAttempts, [attemptKey(input.cursor)]: attempt },
      nodeHistory: appendBounded(
        record.nodeHistory,
        nodeRecord,
        WORKFLOW_HISTORY_BOUNDS.nodeHistory,
      ),
      elapsedRuntimeMs: Math.max(0, clock.now() - Date.parse(record.createdAt)),
    };
  }

  /** Point the cursor at `nextNode`, on the main path or inside a branch. */
  function moveCursor(
    record: WorkflowRunRecord,
    cursor: Cursor,
    nextNode: string | undefined,
  ): WorkflowRunRecord {
    if (cursor.branchId === undefined) {
      return { ...record, currentNodeId: nextNode };
    }
    return {
      ...record,
      branches: record.branches.map((branch) =>
        branch.branchId === cursor.branchId
          ? {
              ...branch,
              currentNodeId: nextNode,
              stepCount: branch.stepCount + 1,
            }
          : branch,
      ),
    };
  }

  /** Add tokens and cost to a branch's own ledger, when inside one. */
  function chargeBranch(
    record: WorkflowRunRecord,
    branchId: string | undefined,
    charge: { promptTokens: number; completionTokens: number; costMicroUsd: number },
  ): WorkflowRunRecord {
    if (branchId === undefined) return record;
    return {
      ...record,
      branches: record.branches.map((branch) =>
        branch.branchId === branchId
          ? {
              ...branch,
              promptTokens: branch.promptTokens + charge.promptTokens,
              completionTokens: branch.completionTokens + charge.completionTokens,
              costMicroUsd: branch.costMicroUsd + charge.costMicroUsd,
            }
          : branch,
      ),
    };
  }

  // ── Branch arrival and joins ──────────────────────────────────────────────

  /**
   * Close every branch whose cursor has reached its join, then evaluate the join.
   *
   * Runs before cursor selection on every iteration, so a branch that finished on
   * the previous iteration is settled before another node is chosen. Evaluating the
   * join lazily — only when somebody asks — is what would let a satisfied join sit
   * unfired while the engine waited for a branch that had already arrived.
   */
  async function settleBranchArrivals(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
    plan: WorkflowPlan,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    let current = record;

    for (const branchId of [...current.activeBranchIds].sort()) {
      const branch = current.branches.find((entry) => entry.branchId === branchId);
      if (!branch) continue;

      const arrivedAtJoin = branch.currentNodeId === branch.joinNodeId;
      const finished =
        branch.state === 'completed' || branch.state === 'failed' || branch.state === 'cancelled';
      if (!arrivedAtJoin && !finished) continue;

      const outcome: 'completed' | 'failed' | 'cancelled' =
        branch.state === 'failed' ? 'failed' : branch.state === 'cancelled' ? 'cancelled' : 'completed';

      const joinRecord = current.joins.find((entry) => entry.joinNodeId === branch.joinNodeId);
      if (!joinRecord) continue;

      const updatedJoin = recordBranchArrival(joinRecord, {
        branchId,
        outcome,
        workflowRunId: current.context.workflowRunId,
      });

      const closed: WorkflowBranchRecord = {
        ...branch,
        state: outcome,
        currentNodeId: undefined,
        endedAt: clock.isoNow(),
      };

      current = {
        ...current,
        branches: current.branches.map((entry) => (entry.branchId === branchId ? closed : entry)),
        joins: current.joins.map((entry) =>
          entry.joinNodeId === updatedJoin.joinNodeId ? updatedJoin : entry,
        ),
        activeBranchIds: current.activeBranchIds.filter((entry) => entry !== branchId),
        completedBranchIds:
          outcome === 'completed'
            ? [...current.completedBranchIds, branchId].sort()
            : current.completedBranchIds,
        failedBranchIds:
          outcome === 'failed'
            ? [...current.failedBranchIds, branchId].sort()
            : current.failedBranchIds,
      };

      writeAudit(current, {
        event: WORKFLOW_AUDIT_EVENT.branchClosed,
        outcome: outcome === 'completed' ? 'recorded' : 'failed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: branch.joinNodeId,
        branchId,
        reason: `branch ${branchId} ${outcome}`,
        detail: {
          steps: closed.stepCount,
          promptTokens: closed.promptTokens,
          completionTokens: closed.completionTokens,
          costMicroUsd: closed.costMicroUsd,
        },
      });

      current = admitBranches(current, definition);
      current = await evaluateAndMaybeFire(current, definition, plan, updatedJoin.joinNodeId, input);
      if (isTerminalWorkflowState(current.state)) return current;
    }

    return current;
  }

  /** Evaluate one join and, if satisfied or impossible, act on it. */
  async function evaluateAndMaybeFire(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
    plan: WorkflowPlan,
    joinNodeId: string,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    const joinPlan = plan.joinsByNodeId.get(joinNodeId);
    const joinRecord = record.joins.find((entry) => entry.joinNodeId === joinNodeId);
    if (!joinPlan || !joinRecord || joinRecord.satisfied) return record;

    const evaluation = evaluateJoin(joinRecord, joinPlan);

    writeAudit(record, {
      event: WORKFLOW_AUDIT_EVENT.joinEvaluated,
      outcome: evaluation.status === 'unsatisfiable' ? 'denied' : 'recorded',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: joinNodeId,
      reason: evaluation.reason,
      detail: {
        status: evaluation.status,
        diagnostics: evaluation.diagnostics,
        policy: joinPlan.policy,
      },
    });

    if (evaluation.status === 'waiting') return record;

    if (evaluation.status === 'unsatisfiable') {
      return terminate(record, {
        state: 'failed',
        failure: 'join_unsatisfied',
        message: evaluation.reason,
        diagnostics: evaluation.diagnostics,
        actorId: input.actor.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
    }

    // ── Satisfied ───────────────────────────────────────────────────────────
    const joinNode = plan.graph.nodesById.get(joinNodeId);
    if (!joinNode || joinNode.nodeType !== 'join') return record;

    // Cancel the arms the policy says are no longer needed, and credit the model
    // calls they will now never make. That is a genuine avoided call, priced
    // against the profile the cancelled node declared.
    const toCancel = branchesToCancel(joinRecord, joinPlan, record.branches);
    let current = record;
    for (const branchId of toCancel) {
      const branch = current.branches.find((entry) => entry.branchId === branchId);
      current = {
        ...current,
        branches: current.branches.map((entry) =>
          entry.branchId === branchId
            ? { ...entry, state: 'cancelled' as const, currentNodeId: undefined, endedAt: clock.isoNow() }
            : entry,
        ),
        activeBranchIds: current.activeBranchIds.filter((entry) => entry !== branchId),
      };
      if (branch) {
        current = creditCancelledBranch(current, plan, branch, input);
      }
      writeAudit(current, {
        event: WORKFLOW_AUDIT_EVENT.branchCancelled,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: joinNodeId,
        branchId,
        reason: 'the join was satisfied and the remaining branches were cancelled',
      });
    }

    // Merge in the PLANNED branch order, so the joined value does not depend on
    // arrival timing. Each branch contributes the value it wrote under its own id.
    const branchValues = new Map<string, unknown>();
    for (const branchId of joinRecord.expectedBranchIds) {
      const value = current.values[`__branch__${branchId}`];
      if (value !== undefined) branchValues.set(branchId, value);
    }
    const merged = mergeBranchOutputs(joinRecord, branchValues);

    const satisfied: WorkflowJoinRecord = {
      ...joinRecord,
      satisfied: true,
      satisfiedAt: clock.isoNow(),
    };

    const mappingContext = {
      workflowRunId: current.context.workflowRunId,
      nodeId: joinNodeId,
    };
    const values = applyOutputMapping(
      { ...current.values, __join__: merged },
      { merged, branches: merged },
      joinNode.outputMapping,
      mappingContext,
    );

    const next = nextNodeId(plan, joinNodeId, 'always');
    current = {
      ...current,
      joins: current.joins.map((entry) =>
        entry.joinNodeId === joinNodeId ? satisfied : entry,
      ),
      values,
      currentNodeId: next,
      branchDepth: Math.max(0, current.branchDepth - 1),
    };

    writeAudit(current, {
      event: WORKFLOW_AUDIT_EVENT.joinSatisfied,
      outcome: 'executed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: joinNodeId,
      reason: evaluation.reason,
      detail: {
        policy: joinPlan.policy,
        succeeded: evaluation.succeeded,
        failed: evaluation.failed,
        cancelled: toCancel.length,
        mergedBranches: Object.keys(merged).length,
        nextNodeId: next ?? '',
      },
    });

    // The fan-out is over; the main path owns execution again.
    if (current.state === 'waiting_for_parallel' || current.state === 'waiting_for_join') {
      current = transition(current, 'running', 'step', {
        reason: 'the join was satisfied',
        actorId: input.actor.actorId,
      });
    } else {
      current = touch(current);
    }
    return current;
  }

  /**
   * Credit the model calls a cancelled branch will never make.
   *
   * Only nodes the branch had NOT yet reached are credited, and only model nodes,
   * priced at the profile each one declared. Crediting the whole branch would
   * inflate the saving with work that had already been paid for.
   */
  function creditCancelledBranch(
    record: WorkflowRunRecord,
    plan: WorkflowPlan,
    branch: WorkflowBranchRecord,
    input: AdvanceWorkflowInput,
  ): WorkflowRunRecord {
    const executed = new Set(
      record.nodeHistory
        .filter((entry) => entry.branchId === branch.branchId)
        .map((entry) => entry.nodeId),
    );
    const branchPlan = plan.branchesById.get(branch.branchId);
    if (!branchPlan) return record;

    let current = record;
    for (const nodeId of branchPlan.nodeIds) {
      if (executed.has(nodeId)) continue;
      const node = plan.graph.nodesById.get(nodeId);
      if (!node || node.nodeType !== 'model') continue;
      const profile = profiles.find(node.modelProfileId);
      if (!profile) continue;

      const promptTokens = Math.ceil(node.tokenAllowance * 0.75);
      const completionTokens = node.tokenAllowance - promptTokens;
      const avoided = buildAvoidedCallRecord({
        nodeId,
        branchId: branch.branchId,
        at: clock.isoNow(),
        reason: 'cheaper_path_selected',
        avoidedCalls: 1,
        promptTokens,
        completionTokens,
        profile,
      });
      current = {
        ...current,
        avoidedCalls: appendBounded(
          current.avoidedCalls,
          avoided,
          WORKFLOW_HISTORY_BOUNDS.avoidedCalls,
        ),
        tokens: recordAvoidedTokens(current.tokens, promptTokens + completionTokens),
        cost: recordAvoidedCost(current.cost, avoided.avoidedMicroUsd),
      };
      writeAudit(current, {
        event: WORKFLOW_AUDIT_EVENT.callAvoided,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId,
        branchId: branch.branchId,
        reason: 'the branch was cancelled once the join was satisfied',
        detail: {
          avoidedMicroUsd: avoided.avoidedMicroUsd,
          avoidedTokens: promptTokens + completionTokens,
          comparedAgainstProfileId: profile.profileId,
          estimateVersion: avoided.estimateVersion,
        },
      });
    }
    return current;
  }

  // ── Node executors ────────────────────────────────────────────────────────

  interface NodeContext {
    readonly record: WorkflowRunRecord;
    readonly definition: WorkflowDefinition;
    readonly plan: WorkflowPlan;
    readonly cursor: Cursor;
    readonly node: WorkflowNode;
    readonly input: AdvanceWorkflowInput;
    readonly startedMs: number;
  }

  interface NodeOutcome {
    readonly record: WorkflowRunRecord;
    /** True when the run must stop here: blocked, waiting or terminal. */
    readonly stop: boolean;
  }

  /**
   * Park the run on a durable approval before the node executes.
   *
   * The approval is created and the run persisted BEFORE anything happens, so an
   * isolate that dies here leaves a pending approval and a waiting run rather than
   * an action that ran without one.
   */
  async function parkForApproval(
    context: NodeContext,
    estimates: { readonly tokens: number; readonly costMicroUsd: number },
    proposedAction: string,
  ): Promise<NodeOutcome> {
    const { record, definition, node, cursor, input } = context;
    const rule =
      node.approval ??
      (node.nodeType === 'approval' ? node.approval : undefined) ??
      // Reached only for a node whose approval is demanded by the TOOL rather than
      // by the definition. The workflow's own safety class supplies the roles, and
      // an hour is the platform's default decision window.
      {
        approverRoles: ['owner', 'admin'],
        expiresAfterMs: 3_600_000,
        impactSummary: `Node ${node.nodeId} requires a human decision before it runs.`,
        dataAffected: [node.nodeId],
      };

    // Stamped with the checkpoint this park is ABOUT TO WRITE, so a later approval
    // reads back the version it was authorised against and the conflict check means
    // "the run moved on while a human was deciding" rather than firing on the
    // parking write itself.
    const request = await approvals.request({
      workflowRunId: record.context.workflowRunId,
      workflowId: record.context.workflowId,
      organizationId: record.context.organizationId,
      nodeId: node.nodeId,
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      requestedBy: input.actor.actorId,
      rule,
      proposedAction,
      approvalReason: node.purpose,
      estimatedAdditionalTokens: estimates.tokens,
      estimatedAdditionalCostMicroUsd: estimates.costMicroUsd,
      checkpointVersion: record.checkpointVersion + 1,
    });

    let parked: WorkflowRunRecord = {
      ...record,
      pendingApprovalId: request.workflowApprovalId,
      pendingApprovalNodeId: node.nodeId,
      ...(cursor.branchId === undefined ? {} : { pendingApprovalBranchId: cursor.branchId }),
    };
    if (cursor.branchId !== undefined) {
      parked = {
        ...parked,
        branches: parked.branches.map((branch) =>
          branch.branchId === cursor.branchId
            ? { ...branch, state: 'waiting_for_approval' as const }
            : branch,
        ),
      };
    }

    parked = await writeCheckpoint(parked);
    const moved = transition(parked, 'waiting_for_approval', 'step', {
      reason: `node ${node.nodeId} needs a human decision`,
      actorId: input.actor.actorId,
    });
    const saved = await persist(moved, record.runVersion);

    writeAudit(saved, {
      event: WORKFLOW_AUDIT_EVENT.approvalRequested,
      outcome: 'recorded',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      workflowApprovalId: request.workflowApprovalId,
      reason: rule.impactSummary,
      detail: {
        expiresAt: request.expiresAt,
        authorizedRoles: request.authorizedRoles,
        estimatedAdditionalCostMicroUsd: estimates.costMicroUsd,
        estimatedAdditionalTokens: estimates.tokens,
        checkpointVersion: request.checkpointVersion,
      },
    });
    return { record: saved, stop: true };
  }

  /**
   * Has the approval this node needs already been granted and spent?
   *
   * Returns `true` when the node may proceed. Consuming the approval happens here,
   * once, before the node runs — not inside each executor, where four call sites
   * would each have to remember.
   */
  async function consumeApprovalIfHeld(context: NodeContext): Promise<boolean> {
    const { record, node, input } = context;
    if (record.pendingApprovalId === undefined) return false;
    if (record.pendingApprovalNodeId !== node.nodeId) return false;

    await approvals.consume(record.context.organizationId, record.pendingApprovalId, {
      nodeId: node.nodeId,
      checkpointVersion: record.checkpointVersion,
    });
    writeAudit(record, {
      event: WORKFLOW_AUDIT_EVENT.approvalDecided,
      outcome: 'allowed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: node.nodeId,
      workflowApprovalId: record.pendingApprovalId,
      reason: 'the approval was spent on the node it authorised',
    });
    return true;
  }

  function clearApproval(record: WorkflowRunRecord): WorkflowRunRecord {
    return {
      ...record,
      pendingApprovalId: undefined,
      pendingApprovalNodeId: undefined,
      pendingApprovalBranchId: undefined,
    };
  }

  async function executeCheckpointNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, plan, cursor, node, input } = context;
    const next = nextNodeId(plan, node.nodeId, 'always');
    const checkpointed = await writeCheckpoint(record);
    const committed = commitNode(checkpointed, {
      cursor,
      node,
      outcome: 'executed',
      inputDigest: digestValue({ nodeId: node.nodeId }),
      nextNode: next,
      startedMs: context.startedMs,
    });
    writeAudit(committed, {
      event: WORKFLOW_AUDIT_EVENT.checkpointWritten,
      outcome: 'executed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: node.nodeId,
      nodeType: 'checkpoint',
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      detail: { checkpointVersion: committed.checkpointVersion },
    });
    return { record: await persist(touch(committed), record.runVersion), stop: false };
  }

  async function executeWaitNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, plan, cursor, node, input } = context;
    if (node.nodeType !== 'wait') {
      throw workflowFailure('invalid_node', 'That node is not a wait.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
      });
    }
    const next = nextNodeId(plan, node.nodeId, 'always');
    // The wait is recorded on the run as a deadline, measured against the injected
    // clock. It is NOT a sleep: an isolate does not sit idle holding a run, and the
    // next advance after the instant passes continues from the following node.
    const waitUntil = new Date(clock.now() + node.waitMs).toISOString();
    const committed = commitNode(
      { ...record, waitUntil },
      {
        cursor,
        node,
        outcome: 'waiting',
        inputDigest: digestValue({ nodeId: node.nodeId, waitMs: node.waitMs }),
        nextNode: next,
        startedMs: context.startedMs,
      },
    );
    const checkpointed = await writeCheckpoint(committed);
    writeAudit(checkpointed, {
      event: WORKFLOW_AUDIT_EVENT.nodeExited,
      outcome: 'recorded',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: node.nodeId,
      nodeType: 'wait',
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      reason: 'the run is waiting before it continues',
      detail: { waitUntil, waitMs: node.waitMs },
    });
    return { record: await persist(touch(checkpointed), record.runVersion), stop: true };
  }

  async function executeTransformNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, definition, plan, cursor, input } = context;
    const node = context.node as WorkflowTransformNode;
    const mappingContext = {
      workflowRunId: record.context.workflowRunId,
      nodeId: node.nodeId,
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
    };

    const resolved = resolveMapping(
      valueSpace(record, definition, cursor.branchId),
      node.inputMapping,
      mappingContext,
    );
    const output = runTransform(deps.transforms, node.transformId, {
      value: resolved,
      args: node.transformArguments,
      nowIso: clock.isoNow(),
      context: mappingContext,
    });

    let current: WorkflowRunRecord = {
      ...record,
      values: applyOutputMapping(record.values, output, node.outputMapping, mappingContext),
    };
    current = writeBranchValue(current, cursor, output);

    // A transform that exists INSTEAD OF a model call credits the avoided call,
    // priced against the profile the definition named. The registry already refused
    // a transform that claimed a saving without naming one.
    if (node.avoidsModelCall && node.avoidedProfileId !== undefined) {
      const profile = profiles.find(node.avoidedProfileId);
      if (profile) {
        const avoided = buildAvoidedCallRecord({
          nodeId: node.nodeId,
          ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
          at: clock.isoNow(),
          reason: 'deterministic_transform',
          avoidedCalls: 1,
          promptTokens: node.avoidedPromptTokens ?? 0,
          completionTokens: node.avoidedCompletionTokens ?? 0,
          profile,
        });
        current = {
          ...current,
          avoidedCalls: appendBounded(
            current.avoidedCalls,
            avoided,
            WORKFLOW_HISTORY_BOUNDS.avoidedCalls,
          ),
          tokens: recordAvoidedTokens(
            current.tokens,
            avoided.avoidedPromptTokens + avoided.avoidedCompletionTokens,
          ),
          cost: recordAvoidedCost(current.cost, avoided.avoidedMicroUsd),
        };
        writeAudit(current, {
          event: WORKFLOW_AUDIT_EVENT.callAvoided,
          outcome: 'recorded',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          nodeId: node.nodeId,
          nodeType: 'transform',
          ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
          reason: 'a deterministic transform answered this step',
          detail: {
            avoidedMicroUsd: avoided.avoidedMicroUsd,
            avoidedTokens: avoided.avoidedPromptTokens + avoided.avoidedCompletionTokens,
            comparedAgainstProfileId: profile.profileId,
            estimateVersion: avoided.estimateVersion,
          },
        });
      }
    }

    const next = nextNodeId(plan, node.nodeId, 'always');
    const committed = commitNode(current, {
      cursor,
      node,
      outcome: 'executed',
      inputDigest: digestValue(resolved),
      outputDigest: digestValue(output),
      nextNode: next,
      startedMs: context.startedMs,
    });
    const checkpointed = await writeCheckpoint(committed);
    return { record: await persist(touch(checkpointed), record.runVersion), stop: false };
  }

  async function executeConditionNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, definition, plan, cursor, input } = context;
    const node = context.node as WorkflowConditionNode;
    const mappingContext = {
      workflowRunId: record.context.workflowRunId,
      nodeId: node.nodeId,
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
    };

    const outcome = evaluatePredicate(deps.predicates, node.predicateId, {
      space: valueSpace(record, definition, cursor.branchId),
      args: node.predicateArguments,
      context: mappingContext,
    });

    const taken = nextNodeId(plan, node.nodeId, outcome.result ? 'true' : 'false');
    const notTaken = nextNodeId(plan, node.nodeId, outcome.result ? 'false' : 'true');

    writeAudit(record, {
      event: WORKFLOW_AUDIT_EVENT.conditionEvaluated,
      outcome: 'recorded',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: node.nodeId,
      nodeType: 'condition',
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      reason: outcome.explanation,
      detail: {
        predicateId: node.predicateId,
        result: outcome.result,
        // The SHAPE of what was compared, never the value. A condition's audit
        // record must not become a copy of a tenant's data.
        observed: outcome.observed,
        takenNodeId: taken ?? '',
        excludedNodeId: notTaken ?? '',
      },
    });

    let current = record;
    // A condition that excluded a path to a model node avoided that call. Credited
    // only when the excluded target IS a model node, so the figure is measurable
    // rather than a guess about the whole excluded subgraph.
    if (notTaken !== undefined) {
      const excluded = plan.graph.nodesById.get(notTaken);
      if (excluded && excluded.nodeType === 'model') {
        const profile = profiles.find(excluded.modelProfileId);
        if (profile) {
          const promptTokens = Math.ceil(excluded.tokenAllowance * 0.75);
          const completionTokens = excluded.tokenAllowance - promptTokens;
          const avoided = buildAvoidedCallRecord({
            nodeId: excluded.nodeId,
            ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
            at: clock.isoNow(),
            reason: 'condition_excluded_branch',
            avoidedCalls: 1,
            promptTokens,
            completionTokens,
            profile,
          });
          current = {
            ...current,
            avoidedCalls: appendBounded(
              current.avoidedCalls,
              avoided,
              WORKFLOW_HISTORY_BOUNDS.avoidedCalls,
            ),
            tokens: recordAvoidedTokens(current.tokens, promptTokens + completionTokens),
            cost: recordAvoidedCost(current.cost, avoided.avoidedMicroUsd),
          };
        }
      }
    }

    const committed = commitNode(current, {
      cursor,
      node,
      outcome: 'executed',
      inputDigest: digestValue({ predicateId: node.predicateId, args: node.predicateArguments }),
      outputDigest: digestValue({ result: outcome.result }),
      nextNode: taken,
      startedMs: context.startedMs,
    });
    const checkpointed = await writeCheckpoint(committed);
    return { record: await persist(touch(checkpointed), record.runVersion), stop: false };
  }

  async function executeParallelNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, definition, plan, cursor, input } = context;
    const node = context.node as WorkflowParallelNode;

    if (cursor.branchId !== undefined && record.branchDepth + 1 > definition.limits.maxBranchDepth) {
      throw workflowFailure('branch_limit_exceeded', 'This workflow nested branches too deeply.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
        branchId: cursor.branchId,
        diagnostics:
          `branch depth ${record.branchDepth + 1} exceeds limits.maxBranchDepth ` +
          `(${definition.limits.maxBranchDepth})`,
      });
    }

    const branchPlans = [...plan.manifest.branches]
      .filter((branch) => branch.parallelNodeId === node.nodeId)
      .sort((a, b) => a.branchId.localeCompare(b.branchId));

    if (branchPlans.length > definition.limits.maxParallelBranches) {
      throw workflowFailure('branch_limit_exceeded', 'This fan-out opens too many branches.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
        diagnostics:
          `${branchPlans.length} branches exceeds limits.maxParallelBranches ` +
          `(${definition.limits.maxParallelBranches})`,
      });
    }
    if (record.branches.length + branchPlans.length > WORKFLOW_HISTORY_BOUNDS.branches) {
      throw workflowFailure('branch_limit_exceeded', 'This run opened too many branches.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
        diagnostics: `branch table would exceed ${WORKFLOW_HISTORY_BOUNDS.branches} entries`,
      });
    }

    // ── Should the fan-out be serialized? ───────────────────────────────────
    //
    // Asked once, here, from the projected cost of running every arm's model nodes
    // concurrently against what the run can still afford. The answer is persisted
    // so a resumed run cannot widen a fan-out an earlier budget decision narrowed.
    const branchExposure = branchPlans.reduce((sum, branch) => {
      const nodeCost = branch.nodeIds.reduce((inner, nodeId) => {
        const branchNode = plan.graph.nodesById.get(nodeId);
        if (!branchNode || branchNode.nodeType !== 'model') return inner;
        return inner + branchNode.costAllowanceMicroUsd;
      }, 0);
      return sum + nodeCost;
    }, 0);
    const remaining = Math.max(
      0,
      definition.limits.maxEstimatedCostMicroUsd -
        record.cost.estimatedMicroUsd -
        record.cost.reservedMicroUsd,
    );
    const serialize = branchExposure > remaining && branchPlans.length > 1;

    const startedAt = clock.isoNow();
    const created: WorkflowBranchRecord[] = branchPlans.map((branch) => ({
      branchId: branch.branchId,
      parallelNodeId: node.nodeId,
      joinNodeId: branch.joinNodeId,
      ...(cursor.branchId === undefined ? {} : { parentBranchId: cursor.branchId }),
      depth: branch.depth,
      state: 'pending' as const,
      currentNodeId: branch.startNodeId,
      stepCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      costMicroUsd: 0,
      startedAt,
    }));

    const joinPlan = plan.joinsByNodeId.get(node.joinNodeId);
    if (!joinPlan) {
      throw workflowFailure('invalid_node', 'That fan-out has no planned join.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
        diagnostics: `join ${node.joinNodeId} is not in the compiled plan`,
      });
    }

    let current: WorkflowRunRecord = {
      ...record,
      branches: [...record.branches, ...created],
      joins: record.joins.some((entry) => entry.joinNodeId === node.joinNodeId)
        ? record.joins
        : [...record.joins, initialJoinRecord(joinPlan)],
      branchDepth: record.branchDepth + 1,
      ...(serialize ? { parallelWidthOverride: 1 } : {}),
      // The main path hands execution to the branches. It resumes at the join.
      currentNodeId: undefined,
    };
    current = admitBranches(current, definition);

    for (const branch of created) {
      writeAudit(current, {
        event: WORKFLOW_AUDIT_EVENT.branchOpened,
        outcome: 'allowed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: 'parallel',
        branchId: branch.branchId,
        reason: `branch ${branch.branchId} opened`,
        detail: {
          startNodeId: branch.currentNodeId ?? '',
          joinNodeId: branch.joinNodeId,
          depth: branch.depth,
          admitted: current.activeBranchIds.includes(branch.branchId),
          serialized: serialize,
        },
      });
    }

    const committed = commitNode(current, {
      cursor,
      node,
      outcome: 'executed',
      inputDigest: digestValue({ nodeId: node.nodeId, branches: branchPlans.map((b) => b.branchId) }),
      // `undefined` on purpose: the parallel node's successor is not a node, it is
      // a set of branches, and `moveCursor` must not point the main path anywhere.
      nextNode: undefined,
      startedMs: context.startedMs,
      fields: { nextNodeId: node.joinNodeId },
    });
    const withoutCursor: WorkflowRunRecord =
      cursor.branchId === undefined ? { ...committed, currentNodeId: undefined } : committed;

    const checkpointed = await writeCheckpoint(withoutCursor);
    const moved =
      checkpointed.state === 'waiting_for_parallel'
        ? touch(checkpointed)
        : transition(checkpointed, 'waiting_for_parallel', 'step', {
            reason: `fan-out ${node.nodeId} opened ${created.length} branches`,
            actorId: input.actor.actorId,
          });
    return { record: await persist(moved, record.runVersion), stop: false };
  }

  async function executeToolNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, definition, plan, cursor, input } = context;
    const node = context.node as WorkflowToolNode;
    const mappingContext = {
      workflowRunId: record.context.workflowRunId,
      nodeId: node.nodeId,
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
    };

    const resolved = resolveMapping(
      valueSpace(record, definition, cursor.branchId),
      node.inputMapping,
      mappingContext,
    );

    // An unapproved call to a tool that needs approval PARKS the run rather than
    // failing it. The approval, once granted, replays this exact node.
    const needsApproval = deps.tools.requiresApproval(definition, node);
    let current = record;
    if (needsApproval) {
      const held = await consumeApprovalIfHeld(context);
      if (!held) {
        const descriptor = deps.tools.describe(node.toolId);
        return parkForApproval(
          context,
          { tokens: 0, costMicroUsd: 0 },
          `Call ${node.toolId} (${descriptor?.sideEffect ?? 'unknown side effect'}) from node ${node.nodeId}.`,
        );
      }
      current = clearApproval(current);
    }

    // Park in `waiting_for_tool` BEFORE calling. An isolate that dies mid-call
    // leaves a run that says what it was doing, and the gateway's own durable
    // idempotency claim is what makes the repeat safe or refused.
    const parked =
      current.state === 'waiting_for_tool'
        ? touch(current)
        : transition(current, 'waiting_for_tool', 'step', {
            reason: `calling ${node.toolId}`,
            actorId: input.actor.actorId,
          });
    const waiting = await persist(parked, record.runVersion);

    // The key is derived from the run, the node and the branch — durable and
    // reproducible, so a replay after a restart presents the key the gateway
    // already saw rather than a fresh one that would let a non-idempotent tool run
    // twice.
    const idempotencyKey = `wf:${record.context.workflowRunId}:${node.nodeId}:${cursor.branchId ?? 'main'}:${attemptsFor(record, cursor)}`;

    writeAudit(waiting, {
      event: WORKFLOW_AUDIT_EVENT.toolInvoked,
      outcome: 'allowed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: node.nodeId,
      nodeType: 'tool',
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      reason: node.purpose,
      detail: { toolId: node.toolId, idempotencyKey },
    });

    const result = await deps.tools.execute({
      definition,
      node,
      workflowRunId: record.context.workflowRunId,
      organizationId: record.context.organizationId,
      actorId: input.actor.actorId,
      actorCapabilities: input.actor.capabilities,
      correlationId: input.correlationId,
      idempotencyKey,
      input: resolved,
      timeoutMs: node.timeoutMs,
      ...(record.pendingApprovalId === undefined
        ? {}
        : { workflowApprovalId: record.pendingApprovalId }),
    });

    let after: WorkflowRunRecord = {
      ...waiting,
      values: applyOutputMapping(waiting.values, result.output, node.outputMapping, mappingContext),
    };
    after = writeBranchValue(after, cursor, result.output);

    const next = nextNodeId(plan, node.nodeId, 'always');
    const committed = commitNode(after, {
      cursor,
      node,
      outcome: 'executed',
      inputDigest: digestValue(resolved),
      outputDigest: result.outputDigest,
      nextNode: next,
      startedMs: context.startedMs,
      fields: { toolId: node.toolId },
    });
    const checkpointed = await writeCheckpoint(committed);
    const resumed = transition(checkpointed, 'running', 'step', {
      reason: `${node.toolId} returned`,
      actorId: input.actor.actorId,
    });
    return { record: await persist(resumed, waiting.runVersion), stop: false };
  }

  async function executeAgentNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, definition, plan, cursor, input } = context;
    const node = context.node as WorkflowAgentNode;
    const mappingContext = {
      workflowRunId: record.context.workflowRunId,
      nodeId: node.nodeId,
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
    };

    if (!definition.allowedAgents.includes(node.agentId)) {
      throw workflowFailure('capability_denied', 'This workflow may not use that agent.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
        diagnostics: `agent ${node.agentId} is not in the workflow's allow list`,
      });
    }

    const resolved = resolveMapping(
      valueSpace(record, definition, cursor.branchId),
      node.inputMapping,
      mappingContext,
    );

    let current = record;
    if (node.approval !== undefined) {
      const held = await consumeApprovalIfHeld(context);
      if (!held) {
        return parkForApproval(
          context,
          { tokens: node.tokenAllowance, costMicroUsd: node.costAllowanceMicroUsd },
          `Delegate node ${node.nodeId} to agent ${node.agentId}.`,
        );
      }
      current = clearApproval(current);
    }

    // The workflow's own budget gate, applied BEFORE the child run is created. The
    // agent runtime then enforces its own limits on every step it takes; this is
    // the workflow refusing to start work it cannot pay for.
    const budgetDecision = await decideNodeCost(current, definition, {
      nodeAllowanceMicroUsd: node.costAllowanceMicroUsd,
      projectedMicroUsd: node.costAllowanceMicroUsd,
      childAgentMicroUsd: node.costAllowanceMicroUsd,
      cursor,
      node,
      input,
    });
    if (budgetDecision.deny) {
      throw workflowFailure(budgetDecision.failure, budgetDecision.reason, {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
        diagnostics: budgetDecision.diagnostics,
      });
    }
    if (budgetDecision.requireApproval) {
      return parkForApproval(
        context,
        { tokens: node.tokenAllowance, costMicroUsd: node.costAllowanceMicroUsd },
        `Delegate node ${node.nodeId} to agent ${node.agentId} at up to ${node.costAllowanceMicroUsd} micro-USD.`,
      );
    }

    const parked =
      current.state === 'waiting_for_agent'
        ? touch(current)
        : transition(current, 'waiting_for_agent', 'step', {
            reason: `delegating to ${node.agentId}`,
            actorId: input.actor.actorId,
          });
    const waiting = await persist(parked, record.runVersion);

    const result = await deps.agents.execute({
      agentId: node.agentId,
      organizationId: record.context.organizationId,
      actor: input.actor,
      objective: node.objective,
      input: resolved,
      requestId: input.requestId,
      correlationId: input.correlationId,
      authorization: input.authorization,
      ...(input.clientIp === undefined ? {} : { clientIp: input.clientIp }),
      workflowRunId: record.context.workflowRunId,
      origin: record.context.origin,
    });

    // The child run's MEASURED usage, folded in per provider and model. Nothing is
    // re-derived: the agent runtime already reconciled it against what the provider
    // reported, and a second estimate here could only disagree.
    let after: WorkflowRunRecord = {
      ...waiting,
      childAgentRunIds: appendBounded(
        waiting.childAgentRunIds,
        result.childAgentRunId,
        WORKFLOW_HISTORY_BOUNDS.childAgentRuns,
      ),
      handoffCount: waiting.handoffCount + result.handoffCount,
      tokens: result.attribution.reduce(
        (ledger, row) =>
          reconcileWorkflowUsage(ledger, {
            estimate: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            usage: {
              promptTokens: row.promptTokens,
              completionTokens: row.completionTokens,
              totalTokens: row.totalTokens,
            },
            cachedTokens: row.cachedTokens,
            costMicroUsd: row.costMicroUsd,
            key: {
              nodeId: node.nodeId,
              nodeType: 'agent',
              agentId: row.agentId,
              providerId: row.providerId,
              modelId: row.modelId,
              modelProfileId: '',
              feature: row.feature,
            },
          }),
        waiting.tokens,
      ),
      cost: settleWorkflowCost(waiting.cost, 0, result.costMicroUsd),
    };
    after = chargeBranch(after, cursor.branchId, {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costMicroUsd: result.costMicroUsd,
    });

    writeAudit(after, {
      event: WORKFLOW_AUDIT_EVENT.agentDelegated,
      outcome: result.completed ? 'executed' : result.failure === undefined ? 'recorded' : 'failed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: node.nodeId,
      nodeType: 'agent',
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      childAgentRunId: result.childAgentRunId,
      ...(result.failure === undefined ? {} : { failure: 'agent_step_failed' as const }),
      reason: result.failureMessage ?? `agent run ${result.state}`,
      detail: {
        agentId: node.agentId,
        childState: result.state,
        steps: result.stepCount,
        handoffs: result.handoffCount,
        totalTokens: result.totalTokens,
        costMicroUsd: result.costMicroUsd,
        pendingApprovalId: result.pendingApprovalId ?? '',
      },
    });

    // A child run that is still alive parks the workflow node with it. The workflow
    // must not treat an unfinished agent's partial progress as an answer, and it
    // must not continue past a node whose work has not happened.
    if (!result.completed) {
      if (result.waiting) {
        const checkpointed = await writeCheckpoint(after);
        return { record: await persist(touch(checkpointed), waiting.runVersion), stop: true };
      }
      throw workflowFailure(
        'agent_step_failed',
        result.failureMessage ?? 'That agent run did not complete.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: node.nodeId,
          diagnostics: `child run ${result.childAgentRunId} ended ${result.state} (${result.failure ?? 'no failure code'})`,
        },
      );
    }

    after = {
      ...after,
      values: applyOutputMapping(after.values, result.output, node.outputMapping, mappingContext),
    };
    after = writeBranchValue(after, cursor, result.output);

    const next = nextNodeId(plan, node.nodeId, 'always');
    const committed = commitNode(after, {
      cursor,
      node,
      outcome: 'executed',
      inputDigest: digestValue(resolved),
      ...(result.outputDigest === undefined ? {} : { outputDigest: result.outputDigest }),
      nextNode: next,
      startedMs: context.startedMs,
      fields: {
        agentId: node.agentId,
        childAgentRunId: result.childAgentRunId,
        actualPromptTokens: result.promptTokens,
        actualCompletionTokens: result.completionTokens,
        cachedTokens: result.cachedTokens,
        actualCostMicroUsd: result.costMicroUsd,
      },
    });
    const checkpointed = await writeCheckpoint(committed);
    const resumed = transition(checkpointed, 'running', 'step', {
      reason: `agent ${node.agentId} completed`,
      actorId: input.actor.actorId,
    });
    return { record: await persist(resumed, waiting.runVersion), stop: false };
  }

  /**
   * Decide whether a node may spend, and how.
   *
   * Shared by the agent and model executors so one cost policy governs both. It
   * returns a narrowed verdict rather than the whole decision, because the two
   * executors act on different subsets — a model node can be re-optimized and
   * re-routed, an agent node can only run or not.
   */
  async function decideNodeCost(
    record: WorkflowRunRecord,
    definition: WorkflowDefinition,
    args: {
      readonly nodeAllowanceMicroUsd: number;
      readonly projectedMicroUsd: number;
      readonly childAgentMicroUsd?: number;
      readonly cursor: Cursor;
      readonly node: WorkflowNode;
      readonly input: AdvanceWorkflowInput;
    },
  ): Promise<{
    readonly deny: boolean;
    readonly requireApproval: boolean;
    readonly failure: WorkflowFailureCode;
    readonly reason: string;
    readonly diagnostics: string;
  }> {
    const platformHeadroom = await deps.platformHeadroomMicroUsd();
    const organizationHeadroom = deps.organizationHeadroom
      ? await deps.organizationHeadroom(record.context.organizationId)
      : {};

    const projection = {
      baseMicroUsd: args.projectedMicroUsd,
      retryRiskMicroUsd: 0,
      repairMicroUsd: 0,
      parallelBranchMicroUsd: 0,
      childAgentMicroUsd: args.childAgentMicroUsd ?? 0,
      approvalResumeMicroUsd: 0,
      inputTokenMicroUsd: 0,
      outputTokenMicroUsd: 0,
      projectedMicroUsd: args.projectedMicroUsd,
    };

    const decision = decideWorkflowCost({
      projection,
      ledger: record.cost,
      limits: definition.limits,
      nodeAllowanceMicroUsd: args.nodeAllowanceMicroUsd,
      platformRemainingMicroUsd: platformHeadroom,
      ...(organizationHeadroom.microUsd === undefined
        ? {}
        : { organizationRemainingMicroUsd: organizationHeadroom.microUsd }),
      cheaperProfileAvailable: false,
      contextCompressible: false,
      completionReducible: false,
      parallelWorkSerializable: false,
      nodeOptional: args.node.optional,
      cacheAvailable: false,
      ...(deps.costApprovalThresholdMicroUsd === undefined
        ? {}
        : { approvalThresholdMicroUsd: deps.costApprovalThresholdMicroUsd }),
    });

    writeAudit(record, {
      event: WORKFLOW_AUDIT_EVENT.costEstimated,
      outcome: decision.action === 'deny' ? 'denied' : 'allowed',
      requestId: args.input.requestId,
      correlationId: args.input.correlationId,
      actorId: args.input.actor.actorId,
      nodeId: args.node.nodeId,
      nodeType: args.node.nodeType,
      ...(args.cursor.branchId === undefined ? {} : { branchId: args.cursor.branchId }),
      reason: decision.reason,
      detail: {
        decision: decision.action,
        projectedMicroUsd: decision.projection.projectedMicroUsd,
        totalProjectedWorkflowCostMicroUsd: decision.totalProjectedWorkflowCostMicroUsd,
        platformRemainingMicroUsd: platformHeadroom,
        blockedBy: decision.blockedBy ?? '',
      },
    });

    const failure: WorkflowFailureCode =
      decision.blockedBy === 'platform_ceiling' || decision.blockedBy === 'organization'
        ? 'cost_budget_exhausted'
        : decision.blockedBy === 'node_allowance'
          ? 'cost_budget_exhausted'
          : 'workflow_budget_exhausted';

    return {
      deny: decision.action === 'deny',
      requireApproval: decision.action === 'require_approval',
      failure,
      reason: decision.reason,
      diagnostics: decision.diagnostics,
    };
  }

  /** Store a branch's most recent output so the join can merge it. */
  function writeBranchValue(
    record: WorkflowRunRecord,
    cursor: Cursor,
    value: unknown,
  ): WorkflowRunRecord {
    if (cursor.branchId === undefined) return record;
    return {
      ...record,
      values: { ...record.values, [`__branch__${cursor.branchId}`]: value },
    };
  }

  // The model executor is long enough to warrant its own module-level function.
  const executeModelNode = createModelNodeExecutor();

  function createModelNodeExecutor(): (context: NodeContext) => Promise<NodeOutcome> {
    return async function executeModel(context: NodeContext): Promise<NodeOutcome> {
      const { record, definition, plan, cursor, input } = context;
      const node = context.node as WorkflowModelNode;
      const mappingContext = {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      };
      const space = valueSpace(record, definition, cursor.branchId);
      const resolved = resolveMapping(space, node.inputMapping, mappingContext);
      const inputDigest = digestValue(resolved);

      let current = record;
      if (node.approval !== undefined) {
        const held = await consumeApprovalIfHeld(context);
        if (!held) {
          return parkForApproval(
            context,
            { tokens: node.tokenAllowance, costMicroUsd: node.costAllowanceMicroUsd },
            `Run model node ${node.nodeId} on profile ${node.modelProfileId}.`,
          );
        }
        current = clearApproval(current);
      }

      // ── Optimize ────────────────────────────────────────────────────────────
      const sections: ResolvedContextSection[] = node.context.map((declaration) => {
        const value = resolvePath(space, declaration.source, mappingContext);
        return {
          declaration,
          content:
            value === undefined
              ? undefined
              : typeof value === 'string'
                ? value
                : JSON.stringify(value),
          // Approved memory is only ever included when a human signed it off. There
          // is no memory engine in Batch 3B, so nothing is approved and every such
          // section is excluded — which is the safe default rather than an omission.
          memoryApproved: false,
        };
      });

      const organizationHeadroom = deps.organizationHeadroom
        ? await deps.organizationHeadroom(current.context.organizationId)
        : {};

      const profileForAllowance = profiles.find(node.modelProfileId);
      const requestedCompletion = Math.min(
        profileForAllowance?.maxCompletionTokens ?? node.tokenAllowance,
        definition.limits.maxCompletionTokens,
      );

      const optimized = optimizeWorkflowContext({
        node,
        sections,
        systemInstructions:
          `You are executing node ${node.nodeId} of workflow ${definition.workflowId} ` +
          `(${definition.name}). Purpose: ${node.purpose}. Produce only the declared output ` +
          `fields: ${node.requiredOutputFields.join(', ')}.`,
        objective: node.objective,
        ceilings: {
          nodeTokens: node.tokenAllowance,
          workflowRemainingTokens: Math.max(
            0,
            definition.limits.maxTotalTokens - current.tokens.actualTotalTokens,
          ),
          workflowMaxPromptTokens: definition.limits.maxPromptTokens,
          workflowMaxCompletionTokens: definition.limits.maxCompletionTokens,
          ...(organizationHeadroom.tokens === undefined
            ? {}
            : { organizationRemainingTokens: organizationHeadroom.tokens }),
        },
        completionAllowance: requestedCompletion,
        organizationId: current.context.organizationId,
      });

      current = {
        ...current,
        optimizations: appendBounded(
          current.optimizations,
          {
            nodeId: node.nodeId,
            ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
            at: clock.isoNow(),
            originalContextTokens: optimized.savings.originalContextTokens,
            finalContextTokens: optimized.savings.finalContextTokens,
            duplicateTokensRemoved: optimized.savings.duplicateTokensRemoved,
            historyTokensRemoved: optimized.savings.historyTokensRemoved,
            retrievalTokensAvoided: optimized.savings.retrievalTokensAvoided,
            memoryTokensAvoided: optimized.savings.memoryTokensAvoided,
            completionTokensReduced: optimized.savings.completionTokensReduced,
            cachedTokensUsed: optimized.savings.cachedTokensUsed,
            totalTokensSaved: optimized.savings.totalTokensSaved,
            contextManifestDigest: optimized.manifest.digest,
            decision: optimized.decision.action,
          },
          WORKFLOW_HISTORY_BOUNDS.optimizations,
        ),
        tokens: recordAvoidedTokens(current.tokens, optimized.savings.totalTokensSaved),
      };

      writeAudit(current, {
        event: WORKFLOW_AUDIT_EVENT.contextOptimized,
        outcome: optimized.decision.action === 'deny' ? 'denied' : 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: 'model',
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
        reason: optimized.decision.reason,
        detail: {
          decision: optimized.decision.action,
          boundBy: optimized.decision.boundBy ?? '',
          originalContextTokens: optimized.savings.originalContextTokens,
          finalContextTokens: optimized.savings.finalContextTokens,
          duplicateTokensRemoved: optimized.savings.duplicateTokensRemoved,
          historyTokensRemoved: optimized.savings.historyTokensRemoved,
          retrievalTokensAvoided: optimized.savings.retrievalTokensAvoided,
          includedSections: optimized.manifest.included.length,
          excludedSections: optimized.manifest.excluded.length,
          manifestDigest: optimized.manifest.digest,
        },
      });

      if (optimized.decision.action === 'deny') {
        throw workflowFailure('token_budget_exhausted', optimized.decision.reason, {
          workflowRunId: current.context.workflowRunId,
          nodeId: node.nodeId,
          diagnostics: optimized.decision.diagnostics,
        });
      }
      if (optimized.decision.action === 'require_approval') {
        return parkForApproval(
          { ...context, record: current },
          {
            tokens: optimized.promptTokens + optimized.completionAllowance,
            costMicroUsd: node.costAllowanceMicroUsd,
          },
          `Run model node ${node.nodeId}; the actor token allowance is exhausted.`,
        );
      }

      // ── Classify ────────────────────────────────────────────────────────────
      const complexity = classifyTaskComplexity({
        node,
        safetyClass: definition.safetyClass,
        contextTokens: optimized.promptTokens,
        includedSections: optimized.manifest.included.length,
        evidenceSections: optimized.evidenceSections,
        deterministicAlternativeAvailable: false,
        multimodalInput: false,
      });

      writeAudit(current, {
        event: WORKFLOW_AUDIT_EVENT.complexityClassified,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: 'model',
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
        reason: complexity.explanation,
        detail: {
          classification: complexity.classification,
          score: complexity.score,
          formulaVersion: complexity.formulaVersion,
          impliedQuality: complexity.impliedQuality,
        },
      });

      // ── Route ───────────────────────────────────────────────────────────────
      const runtimeState = deps.runtimeState();
      const remainingCost = Math.max(
        0,
        Math.min(
          node.costAllowanceMicroUsd,
          definition.limits.maxEstimatedCostMicroUsd -
            current.cost.estimatedMicroUsd -
            current.cost.reservedMicroUsd,
        ),
      );

      const routing = routeWorkflowProfile(
        profiles,
        {
          allowedProfileIds: definition.allowedModelProfiles,
          requestedProfileId: node.modelProfileId,
          complexity: complexity.classification,
          declaredQualityFloor: node.minimumQuality,
          latencyObjective: 'interactive',
          estimatedPromptTokens: optimized.promptTokens,
          requestedCompletionTokens: optimized.completionAllowance,
          remainingTotalTokens: Math.max(
            0,
            definition.limits.maxTotalTokens - current.tokens.actualTotalTokens,
          ),
          costCeilingMicroUsd: remainingCost,
          requiresStructuredOutput: true,
        },
        {
          aiEnabled: runtimeState.aiEnabled,
          executionAvailable: runtimeState.executionAvailable,
          degraded: runtimeState.degraded,
          requireCertifiedProviders: runtimeState.requireCertifiedProviders,
        },
      );

      if (isWorkflowRoutingRefused(routing)) {
        const failureFor = {
          disabled: 'workflow_disabled_runtime',
          availability: 'routing_unavailable',
          capability: 'routing_unavailable',
          tokens: 'token_budget_exhausted',
          cost: 'cost_budget_exhausted',
        } as const;
        writeAudit(current, {
          event: WORKFLOW_AUDIT_EVENT.budgetDenied,
          outcome: 'denied',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          nodeId: node.nodeId,
          nodeType: 'model',
          ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
          failure: failureFor[routing.blockedBy],
          reason: routing.reason,
          detail: {
            blockedBy: routing.blockedBy,
            diagnostics: routing.diagnostics,
            candidatesConsidered: routing.candidatesConsidered.map((c) => c.profileId),
            candidatesRejected: routing.candidatesRejected.map(
              (c) => `${c.profileId}:${c.reason}`,
            ),
          },
        });
        throw workflowFailure(failureFor[routing.blockedBy], routing.reason, {
          workflowRunId: current.context.workflowRunId,
          nodeId: node.nodeId,
          diagnostics: routing.diagnostics,
        });
      }

      const profile = routing.profile;
      current = {
        ...current,
        routing: appendBounded(
          current.routing,
          {
            nodeId: node.nodeId,
            ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
            at: clock.isoNow(),
            requestedProfileId: node.modelProfileId,
            selectedProfileId: profile.profileId,
            candidatesConsidered: routing.candidatesConsidered.map((c) => c.profileId),
            candidatesRejected: routing.candidatesRejected.map((c) => `${c.profileId}:${c.reason}`),
            selectionReason: routing.selectionReason,
            expectedCostMicroUsd: routing.expectedCostMicroUsd,
            expectedLatencyClass: routing.expectedLatencyClass,
            downgraded: routing.downgraded,
            escalated: routing.escalated,
            complexity: complexity.classification,
          },
          WORKFLOW_HISTORY_BOUNDS.routing,
        ),
      };

      writeAudit(current, {
        event: WORKFLOW_AUDIT_EVENT.modelRouted,
        outcome: 'allowed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: 'model',
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
        reason: routing.selectionReason,
        detail: {
          requestedProfileId: node.modelProfileId,
          selectedProfileId: profile.profileId,
          featureId: profile.featureId,
          downgraded: routing.downgraded,
          escalated: routing.escalated,
          expectedCostMicroUsd: routing.expectedCostMicroUsd,
          expectedLatencyClass: routing.expectedLatencyClass,
          candidatesConsidered: routing.candidatesConsidered.length,
          candidatesRejected: routing.candidatesRejected.length,
        },
      });

      // ── Cache ───────────────────────────────────────────────────────────────
      const policyVersion = `settings.v${runtimeState.configurationVersion}`;
      const eligibility = cacheEligibilityFor({
        node,
        sideEffecting: false,
        highRisk: complexity.classification === 'high_risk',
        highRiskCachingPermitted: deps.highRiskCachingPermitted === true,
      });

      let cacheKey: string | undefined;
      if (eligibility.eligible) {
        cacheKey = buildCacheKey({
          workflowId: definition.workflowId,
          workflowVersion: definition.version,
          nodeId: node.nodeId,
          // The prompt identity comes from the ROUTED profile's feature, which is
          // the registered control plane feature whose prompt will actually render.
          promptId: profile.featureId,
          promptVersion: `${definition.version}:${profile.profileId}`,
          modelProfileId: profile.profileId,
          inputDigest,
          contextManifestDigest: optimized.manifest.digest,
          policyVersion,
          organizationId: current.context.organizationId,
        });

        const entry = await deps.cache.get(current.context.organizationId, cacheKey);
        const usable =
          entry === undefined
            ? { usable: false, reason: 'no entry' }
            : isEntryUsable(entry, {
                organizationId: current.context.organizationId,
                policyVersion,
                nowMs: clock.now(),
              });

        if (entry !== undefined && usable.usable) {
          // A hit that names what it avoided. The saving is the ORIGINAL call's
          // measured usage priced at the profile's declared rate — not a guess.
          const alreadyRan = current.nodeHistory.some(
            (history) => history.nodeId === node.nodeId && history.outcome === 'executed',
          );
          const avoided = buildAvoidedCallRecord({
            nodeId: node.nodeId,
            ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
            at: clock.isoNow(),
            reason: alreadyRan ? 'duplicate_step_suppressed' : 'cache_hit',
            avoidedCalls: 1,
            promptTokens: entry.promptTokens,
            completionTokens: entry.completionTokens,
            profile,
          });

          let hit: WorkflowRunRecord = {
            ...current,
            cacheDecisions: appendBounded(
              current.cacheDecisions,
              {
                nodeId: node.nodeId,
                ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
                at: clock.isoNow(),
                outcome: 'hit' as const,
                keyDigest: digestValue(cacheKey),
                savedTokens: entry.promptTokens + entry.completionTokens,
                savedMicroUsd: avoided.avoidedMicroUsd,
                reason: usable.reason,
              },
              WORKFLOW_HISTORY_BOUNDS.cacheDecisions,
            ),
            avoidedCalls: appendBounded(
              current.avoidedCalls,
              avoided,
              WORKFLOW_HISTORY_BOUNDS.avoidedCalls,
            ),
            tokens: recordAvoidedTokens(
              current.tokens,
              entry.promptTokens + entry.completionTokens,
            ),
            cost: recordAvoidedCost(current.cost, avoided.avoidedMicroUsd),
            values: applyOutputMapping(
              current.values,
              entry.output,
              node.outputMapping,
              mappingContext,
            ),
          };
          hit = writeBranchValue(hit, cursor, entry.output);

          writeAudit(hit, {
            event: WORKFLOW_AUDIT_EVENT.cacheConsulted,
            outcome: 'executed',
            requestId: input.requestId,
            correlationId: input.correlationId,
            actorId: input.actor.actorId,
            nodeId: node.nodeId,
            nodeType: 'model',
            ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
            reason: 'a cache entry answered this node and no provider was called',
            detail: {
              outcome: 'hit',
              savedTokens: entry.promptTokens + entry.completionTokens,
              savedMicroUsd: avoided.avoidedMicroUsd,
              comparedAgainstProfileId: profile.profileId,
              estimateVersion: avoided.estimateVersion,
            },
          });

          const next = nextNodeId(plan, node.nodeId, 'always');
          const committed = commitNode(hit, {
            cursor,
            node,
            outcome: 'cached',
            inputDigest,
            outputDigest: entry.outputDigest,
            nextNode: next,
            startedMs: context.startedMs,
            fields: { modelProfileId: profile.profileId, cachedTokens: entry.promptTokens },
          });
          const checkpointed = await writeCheckpoint(committed);
          return { record: await persist(touch(checkpointed), record.runVersion), stop: false };
        }

        current = {
          ...current,
          cacheDecisions: appendBounded(
            current.cacheDecisions,
            {
              nodeId: node.nodeId,
              ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
              at: clock.isoNow(),
              outcome: 'miss' as const,
              keyDigest: digestValue(cacheKey),
              savedTokens: 0,
              savedMicroUsd: 0,
              reason: usable.reason,
            },
            WORKFLOW_HISTORY_BOUNDS.cacheDecisions,
          ),
        };
      } else {
        current = {
          ...current,
          cacheDecisions: appendBounded(
            current.cacheDecisions,
            {
              nodeId: node.nodeId,
              ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
              at: clock.isoNow(),
              outcome: 'denied' as const,
              keyDigest: '',
              savedTokens: 0,
              savedMicroUsd: 0,
              reason: eligibility.reason,
            },
            WORKFLOW_HISTORY_BOUNDS.cacheDecisions,
          ),
        };
      }

      // ── Cost preflight, BEFORE the control plane ────────────────────────────
      const plannedNode = plan.nodesById.get(node.nodeId);
      const projection = projectWorkflowStepCost({
        profile,
        promptTokens: optimized.promptTokens,
        completionTokens: optimized.completionAllowance,
        maxAttempts: Math.max(assumedAttempts, plannedNode?.maxAttempts ?? 1),
        repairPossible: true,
        approvalResumeExpected: node.approval !== undefined,
      });

      const platformHeadroom = await deps.platformHeadroomMicroUsd();
      const costDecision = decideWorkflowCost({
        projection,
        ledger: current.cost,
        limits: definition.limits,
        nodeAllowanceMicroUsd: node.costAllowanceMicroUsd,
        platformRemainingMicroUsd: platformHeadroom,
        ...(organizationHeadroom.microUsd === undefined
          ? {}
          : { organizationRemainingMicroUsd: organizationHeadroom.microUsd }),
        cheaperProfileAvailable:
          definition.allowedModelProfiles.filter((id) => id !== profile.profileId).length > 0,
        contextCompressible: optimized.manifest.included.length > 3,
        completionReducible: optimized.completionAllowance > 256,
        parallelWorkSerializable: false,
        nodeOptional: node.optional,
        cacheAvailable: false,
        // A node being replayed under an approval has already had its cost decided
        // by a human. Re-applying the threshold would park it again on the approval
        // it is holding, which is a loop with a person in it.
        ...(record.pendingApprovalId === undefined &&
        deps.costApprovalThresholdMicroUsd !== undefined
          ? { approvalThresholdMicroUsd: deps.costApprovalThresholdMicroUsd }
          : {}),
      });

      writeAudit(current, {
        event: WORKFLOW_AUDIT_EVENT.costEstimated,
        outcome: costDecision.action === 'deny' ? 'denied' : 'allowed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: 'model',
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
        reason: costDecision.reason,
        detail: {
          decision: costDecision.action,
          baseMicroUsd: projection.baseMicroUsd,
          retryRiskMicroUsd: projection.retryRiskMicroUsd,
          repairMicroUsd: projection.repairMicroUsd,
          projectedMicroUsd: projection.projectedMicroUsd,
          totalProjectedWorkflowCostMicroUsd: costDecision.totalProjectedWorkflowCostMicroUsd,
          platformRemainingMicroUsd: platformHeadroom,
          blockedBy: costDecision.blockedBy ?? '',
        },
      });

      if (costDecision.action === 'deny') {
        const failure: WorkflowFailureCode =
          costDecision.blockedBy === 'workflow_estimate' ||
          costDecision.blockedBy === 'workflow_actual'
            ? 'workflow_budget_exhausted'
            : 'cost_budget_exhausted';
        throw workflowFailure(failure, costDecision.reason, {
          workflowRunId: current.context.workflowRunId,
          nodeId: node.nodeId,
          diagnostics: costDecision.diagnostics,
        });
      }
      if (costDecision.action === 'require_approval') {
        return parkForApproval(
          { ...context, record: current },
          {
            tokens: optimized.promptTokens + optimized.completionAllowance,
            costMicroUsd: projection.projectedMicroUsd,
          },
          `Run model node ${node.nodeId} at up to ${projection.projectedMicroUsd} micro-USD.`,
        );
      }
      if (costDecision.action === 'skip_optional_step') {
        const next = nextNodeId(plan, node.nodeId, 'always');
        const avoided = buildAvoidedCallRecord({
          nodeId: node.nodeId,
          ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
          at: clock.isoNow(),
          reason: 'optional_node_skipped',
          avoidedCalls: 1,
          promptTokens: optimized.promptTokens,
          completionTokens: optimized.completionAllowance,
          profile,
        });
        const skipped: WorkflowRunRecord = {
          ...current,
          avoidedCalls: appendBounded(
            current.avoidedCalls,
            avoided,
            WORKFLOW_HISTORY_BOUNDS.avoidedCalls,
          ),
          tokens: recordAvoidedTokens(
            current.tokens,
            optimized.promptTokens + optimized.completionAllowance,
          ),
          cost: recordAvoidedCost(current.cost, avoided.avoidedMicroUsd),
        };
        writeAudit(skipped, {
          event: WORKFLOW_AUDIT_EVENT.nodeSkipped,
          outcome: 'recorded',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          nodeId: node.nodeId,
          nodeType: 'model',
          ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
          reason: costDecision.reason,
          detail: {
            avoidedMicroUsd: avoided.avoidedMicroUsd,
            estimateVersion: avoided.estimateVersion,
          },
        });
        const committed = commitNode(skipped, {
          cursor,
          node,
          outcome: 'skipped',
          inputDigest,
          nextNode: next,
          startedMs: context.startedMs,
        });
        const checkpointed = await writeCheckpoint(committed);
        return { record: await persist(touch(checkpointed), record.runVersion), stop: false };
      }

      // ── Reserve, park, execute ──────────────────────────────────────────────
      const estimate = {
        promptTokens: optimized.promptTokens,
        completionTokens: optimized.completionAllowance,
        totalTokens: optimized.promptTokens + optimized.completionAllowance,
      };

      const reserved: WorkflowRunRecord = {
        ...current,
        cost: reserveWorkflowCost(current.cost, projection.projectedMicroUsd),
        tokens: recordWorkflowEstimate(current.tokens, estimate),
      };
      const parked =
        reserved.state === 'waiting_for_model'
          ? touch(reserved)
          : transition(reserved, 'waiting_for_model', 'step', {
              reason: `calling the control plane for ${node.nodeId}`,
              actorId: input.actor.actorId,
            });
      const waiting = await persist(parked, record.runVersion);

      let result;
      try {
        result = await deps.models.execute({
          featureId: profile.featureId,
          input: {
            agent_id: `workflow.${definition.workflowId}`,
            agent_purpose: node.purpose,
            objective: node.objective,
            context: optimized.built.text,
            output_fields: [...node.requiredOutputFields],
          },
          correlationId: input.correlationId,
          causationId: input.requestId,
          organizationId: waiting.context.organizationId,
          authorization: input.authorization,
          ...(input.clientIp === undefined ? {} : { clientIp: input.clientIp }),
        });
      } catch (error) {
        // The hold is released before the failure propagates: a node that never
        // reached a provider must not leave the run's budget looking spent.
        await persist(
          {
            ...waiting,
            cost: releaseWorkflowCost(waiting.cost, projection.projectedMicroUsd),
            runVersion: waiting.runVersion + 1,
            updatedAt: clock.isoNow(),
          },
          waiting.runVersion,
        );
        throw error;
      }

      // ── Validate the node's declared output contract ───────────────────────
      const raw = result.output as Record<string, unknown> | null;
      const unwrapped =
        raw !== null && typeof raw === 'object' && 'result' in raw ? raw.result : result.output;
      const payload =
        unwrapped !== null && typeof unwrapped === 'object'
          ? (unwrapped as Record<string, unknown>)
          : {};
      const missing = node.requiredOutputFields.filter((field) => payload[field] === undefined);

      const settled = settleWorkflowCost(
        waiting.cost,
        projection.projectedMicroUsd,
        result.costMicroUsd,
      );
      const reconciled = reconcileWorkflowUsage(waiting.tokens, {
        estimate,
        usage: result.usage,
        costMicroUsd: result.costMicroUsd,
        key: {
          nodeId: node.nodeId,
          nodeType: 'model',
          agentId: '',
          providerId: result.providerId,
          modelId: result.modelId,
          modelProfileId: profile.profileId,
          feature: profile.featureId,
        },
      });

      let after: WorkflowRunRecord = {
        ...waiting,
        tokens: reconciled,
        cost: settled,
      };
      after = chargeBranch(after, cursor.branchId, {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        costMicroUsd: result.costMicroUsd,
      });

      writeAudit(after, {
        event: WORKFLOW_AUDIT_EVENT.modelExecuted,
        outcome: missing.length === 0 ? 'executed' : 'failed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: 'model',
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
        executionRequestId: result.requestId,
        ...(missing.length === 0 ? {} : { failure: 'output_validation_failed' as const }),
        detail: {
          profileId: profile.profileId,
          featureId: profile.featureId,
          providerId: result.providerId,
          modelId: result.modelId,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          costMicroUsd: result.costMicroUsd,
          estimatedCostMicroUsd: projection.projectedMicroUsd,
          missingOutputFields: missing,
        },
      });

      if (missing.length > 0) {
        // Persist the measured cost BEFORE raising. The provider was paid whether or
        // not the answer was usable, and a retry that forgot the first attempt's
        // cost would under-report the bill by exactly the amount a repair costs.
        const persisted = await persist(touch(after), waiting.runVersion);
        throw workflowFailure(
          'output_validation_failed',
          'That node produced an output missing its declared fields.',
          {
            workflowRunId: persisted.context.workflowRunId,
            nodeId: node.nodeId,
            diagnostics: `missing output fields: ${missing.join(', ')}`,
          },
        );
      }

      after = {
        ...after,
        values: applyOutputMapping(after.values, payload, node.outputMapping, mappingContext),
      };
      after = writeBranchValue(after, cursor, payload);

      // Store the answer for the next identical request. A put failure is a warning,
      // never a run failure — see `createSafeWorkflowCache`.
      if (cacheKey !== undefined) {
        await deps.cache.put({
          key: cacheKey,
          organizationId: after.context.organizationId,
          workflowId: definition.workflowId,
          nodeId: node.nodeId,
          output: payload,
          outputDigest: digestValue(payload),
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          costMicroUsd: result.costMicroUsd,
          modelProfileId: profile.profileId,
          policyVersion,
          createdAt: clock.isoNow(),
          expiresAt: new Date(clock.now() + node.cacheTtlMs).toISOString(),
        });
        after = {
          ...after,
          cacheDecisions: appendBounded(
            after.cacheDecisions,
            {
              nodeId: node.nodeId,
              ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
              at: clock.isoNow(),
              outcome: 'stored' as const,
              keyDigest: digestValue(cacheKey),
              savedTokens: 0,
              savedMicroUsd: 0,
              reason: 'the answer was stored for the next identical request',
            },
            WORKFLOW_HISTORY_BOUNDS.cacheDecisions,
          ),
        };
      }

      const next = nextNodeId(plan, node.nodeId, 'always');
      const committed = commitNode(after, {
        cursor,
        node,
        outcome: 'executed',
        inputDigest,
        outputDigest: digestValue(payload),
        nextNode: next,
        startedMs: context.startedMs,
        fields: {
          modelProfileId: profile.profileId,
          providerId: result.providerId,
          modelId: result.modelId,
          executionRequestId: result.requestId,
          estimatedPromptTokens: estimate.promptTokens,
          estimatedCompletionTokens: estimate.completionTokens,
          estimatedCostMicroUsd: projection.projectedMicroUsd,
          actualPromptTokens: result.usage.promptTokens,
          actualCompletionTokens: result.usage.completionTokens,
          actualCostMicroUsd: result.costMicroUsd,
        },
      });
      const checkpointed = await writeCheckpoint(committed);
      const resumed = transition(checkpointed, 'running', 'step', {
        reason: `${node.nodeId} returned a valid output`,
        actorId: input.actor.actorId,
      });
      return { record: await persist(resumed, waiting.runVersion), stop: false };
    };
  }

  async function executeApprovalNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, plan, cursor, node, input } = context;
    const held = await consumeApprovalIfHeld(context);
    if (!held) {
      return parkForApproval(
        context,
        { tokens: 0, costMicroUsd: 0 },
        `Approve workflow ${record.context.workflowId} at node ${node.nodeId}.`,
      );
    }

    const cleared = clearApproval(record);
    const next = nextNodeId(plan, node.nodeId, 'always');
    const committed = commitNode(cleared, {
      cursor,
      node,
      outcome: 'executed',
      inputDigest: digestValue({ nodeId: node.nodeId }),
      nextNode: next,
      startedMs: context.startedMs,
      fields: { workflowApprovalId: record.pendingApprovalId },
    });
    const checkpointed = await writeCheckpoint(committed);
    let resumed = checkpointed;
    if (checkpointed.state !== 'running') {
      resumed = transition(checkpointed, 'running', 'step', {
        reason: 'the approval was granted',
        actorId: input.actor.actorId,
      });
    } else {
      resumed = touch(checkpointed);
    }
    return { record: await persist(resumed, record.runVersion), stop: false };
  }

  async function executeCompleteNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, definition, cursor, node, input } = context;
    const mappingContext = {
      workflowRunId: record.context.workflowRunId,
      nodeId: node.nodeId,
    };

    const output = resolveMapping(
      valueSpace(record, definition, cursor.branchId),
      node.inputMapping,
      mappingContext,
    );

    const validated = definition.outputContract.validate(output, 'output');
    if (isFailure(validated)) {
      throw workflowFailure(
        'output_validation_failed',
        'This workflow produced an output that does not match its contract.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: node.nodeId,
          diagnostics: describeIssues(validated.issues),
        },
      );
    }
    const missing = definition.completion.requiredOutputFields.filter(
      (field) => (output as Record<string, unknown>)[field] === undefined,
    );
    if (missing.length > 0) {
      throw workflowFailure(
        'output_validation_failed',
        'This workflow finished without the fields its completion criteria require.',
        {
          workflowRunId: record.context.workflowRunId,
          nodeId: node.nodeId,
          diagnostics: `missing completion fields: ${missing.join(', ')}`,
        },
      );
    }

    // A completion the definition says a human must sign off does NOT complete. It
    // parks, exactly as an approval-gated model node does, and the sealed output is
    // what a later approval releases.
    if (definition.completion.requireApproval) {
      const held = await consumeApprovalIfHeld(context);
      if (!held) {
        return parkForApproval(
          context,
          { tokens: 0, costMicroUsd: 0 },
          `Accept the completion of workflow ${record.context.workflowId}.`,
        );
      }
    }

    const accepted = validated.value;
    const resultDigest = digestValue(accepted);
    let current = clearApproval(record);
    current = await writeCheckpoint(current, accepted);
    current = commitNode(current, {
      cursor,
      node,
      outcome: 'executed',
      inputDigest: digestValue(output),
      outputDigest: resultDigest,
      nextNode: undefined,
      startedMs: context.startedMs,
    });

    const finished = await terminate(current, {
      state: 'completed',
      message: 'The workflow completed.',
      diagnostics: `completed at node ${node.nodeId}`,
      actorId: input.actor.actorId,
      requestId: input.requestId,
      correlationId: input.correlationId,
      resultDigest,
    });
    return { record: finished, stop: true };
  }

  async function executeFailNode(context: NodeContext): Promise<NodeOutcome> {
    const { record, cursor, node, input } = context;
    if (node.nodeType !== 'fail') {
      throw workflowFailure('invalid_node', 'That node is not a fail node.', {
        workflowRunId: record.context.workflowRunId,
        nodeId: node.nodeId,
      });
    }
    const committed = commitNode(record, {
      cursor,
      node,
      outcome: 'failed',
      inputDigest: digestValue({ nodeId: node.nodeId }),
      nextNode: undefined,
      startedMs: context.startedMs,
    });
    const finished = await terminate(committed, {
      state: 'failed',
      failure: 'policy_denied',
      message: `The workflow stopped: ${node.failureReason.slice(0, 200)}`,
      diagnostics: `reached declared fail node ${node.nodeId}`,
      actorId: input.actor.actorId,
      requestId: input.requestId,
      correlationId: input.correlationId,
    });
    return { record: finished, stop: true };
  }

  async function executeNode(context: NodeContext): Promise<NodeOutcome> {
    switch (context.node.nodeType) {
      case 'checkpoint':
        return executeCheckpointNode(context);
      case 'wait':
        return executeWaitNode(context);
      case 'transform':
        return executeTransformNode(context);
      case 'condition':
        return executeConditionNode(context);
      case 'parallel':
        return executeParallelNode(context);
      case 'tool':
        return executeToolNode(context);
      case 'agent':
        return executeAgentNode(context);
      case 'model':
        return executeModelNode(context);
      case 'approval':
        return executeApprovalNode(context);
      case 'complete':
        return executeCompleteNode(context);
      case 'fail':
        return executeFailNode(context);
      case 'join':
        // A join is a convergence point, not a node the cursor executes: branches
        // arrive at it and `settleBranchArrivals` fires it. Reaching here means the
        // main path pointed at a join, which the registry's edge-shape rules
        // prevent — so it is an engine defect, and failing closed is correct.
        throw workflowFailure('invalid_node', 'A join cannot be executed directly.', {
          workflowRunId: context.record.context.workflowRunId,
          nodeId: context.node.nodeId,
          diagnostics: 'the cursor pointed at a join node',
        });
    }
  }

  // ── Failure handling ──────────────────────────────────────────────────────

  /**
   * Turn a thrown failure into the run's or the branch's outcome.
   *
   * A retryable node failure inside its declared allowance leaves the run running
   * with its attempt counter advanced, so the loop re-executes the node. Everything
   * else applies the node's declared failure behaviour: end the run, follow the
   * failure edge, or — only for a node the definition marks optional — continue.
   */
  async function handleNodeFailure(
    hint: WorkflowRunRecord,
    definition: WorkflowDefinition,
    plan: WorkflowPlan,
    cursor: Cursor,
    node: WorkflowNode,
    error: unknown,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    // Re-read before writing. A node that failed part-way — a model call whose
    // reservation was released, a tool call that had already parked the run — has
    // moved the stored version on, and terminating against the version the caller
    // was holding would lose a race it should not be in.
    const record =
      (await runs.load(hint.context.organizationId, hint.context.workflowRunId)) ?? hint;
    const failure: WorkflowFailureCode = isWorkflowError(error) ? error.failure : 'model_step_failed';
    const message = error instanceof Error ? error.message : 'This run could not continue.';
    const diagnostics = isWorkflowError(error) ? error.diagnostics ?? message : String(error);

    // A LOST RACE IS NOT A RUN FAILURE. Another isolate holds this run and has
    // already advanced it; terminating here would let the loser of a race destroy
    // work the winner did.
    if (failure === 'stale_workflow_version' || failure === 'checkpoint_conflict') {
      writeAudit(record, {
        event: WORKFLOW_AUDIT_EVENT.nodeExited,
        outcome: 'denied',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
        failure,
        reason: 'another writer advanced this run first',
        detail: { diagnostics },
      });
      return record;
    }

    const attempts = attemptsFor(record, cursor);
    const maxAttempts = node.retry?.maxAttempts ?? 0;

    if (isNodeRetryable(failure) && attempts < maxAttempts) {
      const retrying = transition(record, 'retrying', 'step', {
        reason: message,
        actorId: input.actor.actorId,
        failure,
      });
      const counted: WorkflowRunRecord = {
        ...retrying,
        retryCount: retrying.retryCount + 1,
        nodeAttempts: { ...retrying.nodeAttempts, [attemptKey(cursor)]: attempts + 1 },
        // Deterministic backoff expressed as a wait deadline, not a sleep. An
        // isolate does not sit idle holding a run.
        ...(node.retry.backoffMs > 0
          ? { waitUntil: new Date(clock.now() + node.retry.backoffMs).toISOString() }
          : {}),
      };
      const saved = await persist(counted, record.runVersion);
      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.retryScheduled,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
        failure,
        reason: message,
        detail: { attempt: attempts + 1, maxAttempts, diagnostics },
      });
      const resumed = transition(saved, 'running', 'step', {
        reason: 'retrying after a recoverable node failure',
        actorId: input.actor.actorId,
      });
      return persist(resumed, saved.runVersion);
    }

    writeAudit(record, {
      event: WORKFLOW_AUDIT_EVENT.nodeExited,
      outcome: 'failed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
      failure,
      reason: message,
      detail: { diagnostics, attempts, maxAttempts, onFailure: node.onFailure },
    });

    // A failure inside a BRANCH fails the branch, not necessarily the run. The
    // join's failure policy is what decides whether the run survives, and it is
    // evaluated by `settleBranchArrivals` on the next iteration.
    if (cursor.branchId !== undefined && node.onFailure === 'fail_workflow') {
      const failed: WorkflowRunRecord = {
        ...record,
        branches: record.branches.map((branch) =>
          branch.branchId === cursor.branchId
            ? { ...branch, state: 'failed' as const, currentNodeId: undefined, failure, endedAt: clock.isoNow() }
            : branch,
        ),
      };
      return persist(touch(failed), record.runVersion);
    }

    if (node.onFailure === 'route') {
      const failureTarget = nextNodeId(plan, node.nodeId, 'failure');
      if (failureTarget !== undefined) {
        const routed = moveCursor(record, cursor, failureTarget);
        const running =
          routed.state === 'running'
            ? touch(routed)
            : transition(routed, 'running', 'step', {
                reason: `node ${node.nodeId} failed and routed to ${failureTarget}`,
                actorId: input.actor.actorId,
              });
        return persist(running, record.runVersion);
      }
    }

    if (node.onFailure === 'continue' && node.optional) {
      const target = nextNodeId(plan, node.nodeId, 'always');
      const skipped = moveCursor(record, cursor, target);
      const running =
        skipped.state === 'running'
          ? touch(skipped)
          : transition(skipped, 'running', 'step', {
              reason: `optional node ${node.nodeId} failed and was skipped`,
              actorId: input.actor.actorId,
            });
      return persist(running, record.runVersion);
    }

    const terminal = terminalStateFor(failure) ?? 'failed';
    return terminate(record, {
      state: terminal,
      failure,
      message,
      diagnostics,
      actorId: input.actor.actorId,
      requestId: input.requestId,
      correlationId: input.correlationId,
    });
  }

  // ── The drive loop ────────────────────────────────────────────────────────

  async function drive(
    initial: WorkflowRunRecord,
    definition: WorkflowDefinition,
    plan: WorkflowPlan,
    input: AdvanceWorkflowInput,
  ): Promise<WorkflowRunRecord> {
    let record = initial;
    const deadlineMs = Date.parse(record.deadlineAt);

    for (let iteration = 0; iteration < MAX_DRIVE_ITERATIONS; iteration += 1) {
      if (isTerminalWorkflowState(record.state)) return record;

      // 1 — Administrative state. The kill switch stops progression; it does not
      // end the run, so an operator who releases it can resume rather than having
      // destroyed work.
      const state = deps.runtimeState();
      if (!state.aiEnabled) {
        if (!PAUSABLE_STATES.includes(record.state)) return record;
        const paused = transition(record, 'paused', 'pause', {
          reason: 'AI execution is administratively stopped.',
          actorId: input.actor.actorId,
        });
        record = await persist(paused, record.runVersion);
        writeAudit(record, {
          event: WORKFLOW_AUDIT_EVENT.runStateChanged,
          outcome: 'denied',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          failure: 'workflow_disabled_runtime',
          reason: 'AI execution is administratively stopped.',
        });
        return record;
      }

      // 2 — Deadline.
      if (Number.isFinite(deadlineMs) && clock.now() >= deadlineMs) {
        return terminate(record, {
          state: 'expired',
          failure: 'workflow_expired',
          message: 'This run reached its time limit.',
          diagnostics: `deadline ${record.deadlineAt} passed`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      // 3 — A wait gate set by a `wait` node or a retry backoff.
      if (record.waitUntil !== undefined) {
        const waitMs = Date.parse(record.waitUntil);
        if (Number.isFinite(waitMs) && clock.now() < waitMs) return record;
        record = await persist(touch({ ...record, waitUntil: undefined }), record.runVersion);
      }

      // 4 — Step ceiling.
      if (record.stepCount >= definition.limits.maxTotalSteps) {
        return terminate(record, {
          state: 'failed',
          failure: 'node_retry_exhausted',
          message: 'This run reached its step limit.',
          diagnostics: `stepCount ${record.stepCount} reached limits.maxTotalSteps (${definition.limits.maxTotalSteps})`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }
      if (record.retryCount > definition.limits.maxRetries) {
        return terminate(record, {
          state: 'failed',
          failure: 'node_retry_exhausted',
          message: 'This run reached its retry limit.',
          diagnostics: `retryCount ${record.retryCount} above limits.maxRetries (${definition.limits.maxRetries})`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      // 5 — Settle any branch that has arrived at its join, then admit queued arms.
      const settled = await settleBranchArrivals(record, definition, plan, input);
      if (settled !== record) {
        record = settled;
        if (isTerminalWorkflowState(record.state)) return record;
      }
      const admitted = admitBranches(record, definition);
      if (admitted !== record) {
        record = await persist(touch(admitted), record.runVersion);
      }

      // 6 — Choose one node.
      const cursor = selectCursor(record);
      if (cursor === undefined) {
        // Nothing to run and nothing waiting: either every branch is closed and a
        // join is still unsatisfied, or the graph left the cursor nowhere. Both are
        // failures of the definition rather than of the execution, and both must be
        // reported rather than looped on.
        const unsatisfied = record.joins.find((join) => !join.satisfied);
        if (unsatisfied) {
          return terminate(record, {
            state: 'failed',
            failure: 'join_unsatisfied',
            message: 'This run has no path forward: a join can no longer be satisfied.',
            diagnostics:
              `join ${unsatisfied.joinNodeId} expected ${unsatisfied.expectedBranchIds.join(',')} ` +
              `and has ${unsatisfied.arrivedBranchIds.join(',') || 'none'}`,
            actorId: input.actor.actorId,
            requestId: input.requestId,
            correlationId: input.correlationId,
          });
        }
        return terminate(record, {
          state: 'failed',
          failure: 'invalid_edge',
          message: 'This run reached a point with no next node.',
          diagnostics: 'the cursor resolved to nothing and no join is outstanding',
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      const node = plan.graph.nodesById.get(cursor.nodeId);
      if (!node) {
        return terminate(record, {
          state: 'failed',
          failure: 'invalid_node',
          message: 'This run pointed at a node the plan does not contain.',
          diagnostics: `node ${cursor.nodeId} is not in the compiled plan`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      writeAudit(record, {
        event: WORKFLOW_AUDIT_EVENT.nodeEntered,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        ...(cursor.branchId === undefined ? {} : { branchId: cursor.branchId }),
        reason: node.purpose,
        detail: {
          attempt: attemptsFor(record, cursor) + 1,
          stepCount: record.stepCount,
          activeBranches: record.activeBranchIds.length,
        },
      });

      // 7 — Execute exactly one node.
      let outcome: NodeOutcome;
      try {
        outcome = await executeNode({
          record,
          definition,
          plan,
          cursor,
          node,
          input,
          startedMs: clock.now(),
        });
      } catch (error) {
        const handled = await handleNodeFailure(
          record,
          definition,
          plan,
          cursor,
          node,
          error,
          input,
        );
        if (isTerminalWorkflowState(handled.state)) return handled;
        record = handled;
        continue;
      }

      record = outcome.record;
      if (outcome.stop) return record;
    }

    return terminate(record, {
      state: 'failed',
      failure: 'node_retry_exhausted',
      message: 'This run stopped making progress and was ended.',
      diagnostics: `drive loop reached its ${MAX_DRIVE_ITERATIONS}-iteration backstop`,
      actorId: input.actor.actorId,
      requestId: input.requestId,
      correlationId: input.correlationId,
    });
  }

  // ── Public surface ────────────────────────────────────────────────────────

  return {
    planFor,

    async createRun(input) {
      const state = deps.runtimeState();
      if (!state.aiEnabled) {
        throw workflowFailure('workflow_disabled_runtime', 'AI execution is currently stopped.', {
          workflowId: input.workflowId,
          diagnostics: 'operational settings report AI disabled or the emergency stop engaged',
        });
      }

      const definition = registry.require(input.workflowId);
      const validated = definition.inputContract.validate(input.input, 'input');
      if (isFailure(validated)) {
        throw workflowFailure(
          'invalid_workflow_definition',
          'That input does not match what this workflow accepts.',
          {
            workflowId: input.workflowId,
            diagnostics: describeIssues(validated.issues),
          },
        );
      }

      // The plan is compiled BEFORE the run exists. A definition whose graph cannot
      // compile must never produce a run record at all: a persisted run pointing at
      // an uncompilable plan is a row somebody has to clean up by hand.
      const plan = planFor(input.workflowId);

      const nowMs = clock.now();
      const nowIso = clock.isoNow();
      const workflowRunId = ids.next('wfr');
      const context: WorkflowRunContext = {
        workflowRunId,
        workflowId: definition.workflowId,
        workflowVersion: definition.version,
        correlationId: input.correlationId,
        requestId: input.requestId,
        organizationId: input.organizationId,
        actorId: input.actor.actorId,
        actorRoles: input.actor.roles,
        origin: input.origin,
        ...(input.parentWorkflowRunId === undefined
          ? {}
          : { parentWorkflowRunId: input.parentWorkflowRunId }),
      };

      const record: WorkflowRunRecord = {
        context,
        runVersion: 1,
        state: 'created',
        currentNodeId: definition.initialNodeId,
        stepCount: 0,
        retryCount: 0,
        nodeAttempts: {},
        handoffCount: 0,
        branchDepth: 0,
        activeBranchIds: [],
        completedBranchIds: [],
        failedBranchIds: [],
        branches: [],
        joins: [],
        childAgentRunIds: [],
        tokens: emptyWorkflowTokenLedger(),
        cost: emptyWorkflowCostLedger(),
        // The validated input lives in the value space under a reserved key, so a
        // checkpoint carries the whole space in one place and a mapping reads it
        // through `input.*` like any other value.
        values: { __input__: validated.value },
        checkpointVersion: 0,
        planDigest: plan.digest,
        planManifestDigest: plan.manifestDigest,
        configurationVersion: state.configurationVersion,
        createdAt: nowIso,
        updatedAt: nowIso,
        deadlineAt: new Date(nowMs + definition.limits.maxRuntimeMs).toISOString(),
        elapsedRuntimeMs: 0,
        transitions: [],
        transitionsTruncated: 0,
        nodeHistory: [],
        optimizations: [],
        routing: [],
        cacheDecisions: [],
        avoidedCalls: [],
      };

      await runs.create(record);

      // The entry checkpoint. Version 1 exists before the first node, so a run
      // interrupted immediately still has a point to resume from.
      const checkpointed = await writeCheckpoint(record);

      // created → validating → planned → ready, each a real transition with its own
      // audit entry. Collapsing them would make "where did it fail?" ambiguous for
      // the three failures that happen before a node: a rejected input, a disabled
      // workflow and a plan above the platform bounds.
      let staged = transition(checkpointed, 'validating', 'start', {
        reason: 'validating the run against the workflow definition',
        actorId: input.actor.actorId,
      });
      staged = transition(staged, 'planned', 'start', {
        reason: `plan compiled: ${plan.manifest.nodes.length} reachable nodes`,
        actorId: input.actor.actorId,
      });
      staged = transition(staged, 'ready', 'start', {
        reason: 'definition, contract, limits and plan accepted',
        actorId: input.actor.actorId,
      });
      const saved = await persist(staged, record.runVersion);

      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.planCompiled,
        outcome: 'allowed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: `plan ${plan.digest} compiled`,
        detail: {
          planDigest: plan.digest,
          planManifestDigest: plan.manifestDigest,
          reachableNodes: plan.manifest.nodes.length,
          worstCaseSteps: plan.manifest.worstCaseSteps,
          worstCaseTotalTokens: plan.manifest.worstCaseTotalTokens,
          worstCaseCostMicroUsd: plan.manifest.worstCaseCostMicroUsd,
          maxParallelism: plan.manifest.maxParallelism,
          approvalNodes: plan.manifest.approvalNodeIds.length,
          sideEffectingNodes: plan.manifest.sideEffectingNodeIds.length,
        },
      });
      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.runCreated,
        outcome: 'allowed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: `run created for ${definition.workflowId}@${definition.version}`,
        detail: {
          safetyClass: definition.safetyClass,
          maxTotalSteps: definition.limits.maxTotalSteps,
          deadlineAt: saved.deadlineAt,
          configurationVersion: saved.configurationVersion,
        },
      });
      deps.metrics.increment('ai_workflow_runs_total', {
        state: 'created',
        workflow: definition.workflowId,
      });
      return saved;
    },

    async advance(input) {
      let record = await loadRun(input.organizationId, input.workflowRunId);
      if (isTerminalWorkflowState(record.state)) return record;

      // Expire before anything else: a run past its deadline is expired, not "about
      // to take one more node".
      const deadlineMs = Date.parse(record.deadlineAt);
      if (Number.isFinite(deadlineMs) && clock.now() >= deadlineMs) {
        return terminate(record, {
          state: 'expired',
          failure: 'workflow_expired',
          message: 'This run reached its time limit.',
          diagnostics: `deadline ${record.deadlineAt} passed`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      if (record.state === 'waiting_for_approval' || record.state === 'paused') {
        // Not an error: advancing a parked run is a no-op that returns its state, so
        // a caller polling a run does not accidentally resume it.
        return record;
      }

      const definition = registry.require(record.context.workflowId);
      const plan = planFor(record.context.workflowId);

      // A run whose stored plan digest disagrees with the plan compiled now is
      // executing against a definition that changed underneath it. Refusing is the
      // only safe answer: the step ceiling, the join's expected branches and the
      // cost exposure were all computed from the plan the run started with.
      if (record.planDigest !== plan.digest) {
        return terminate(record, {
          state: 'failed',
          failure: 'stale_workflow_version',
          message: 'This run was planned against a different version of its workflow.',
          diagnostics: `run plan ${record.planDigest}, current plan ${plan.digest}`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      // Walk the entry states forward one edge at a time. A record left in `created`
      // or `validating` by an isolate that died mid-creation is recoverable rather
      // than stuck, and each edge is still a real, audited transition.
      while (
        record.state === 'created' ||
        record.state === 'validating' ||
        record.state === 'planned' ||
        record.state === 'ready'
      ) {
        const to: WorkflowRunState =
          record.state === 'created'
            ? 'validating'
            : record.state === 'validating'
              ? 'planned'
              : record.state === 'planned'
                ? 'ready'
                : 'running';
        const moved = transition(record, to, 'start', {
          reason: to === 'running' ? 'starting the run' : `staging: ${to}`,
          actorId: input.actor.actorId,
        });
        record = await persist(
          to === 'running' ? { ...moved, startedAt: moved.startedAt ?? clock.isoNow() } : moved,
          record.runVersion,
        );
      }

      return drive(record, definition, plan, input);
    },

    async pause(input) {
      const record = await loadRun(input.organizationId, input.workflowRunId);
      assertNoPendingApproval(record, 'pause');
      const next = transition(record, 'paused', 'pause', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      const saved = await persist(next, record.runVersion);
      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.runStateChanged,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: input.reason,
      });
      return saved;
    },

    async resume(input) {
      const record = await loadRun(input.organizationId, input.workflowRunId);
      assertNoPendingApproval(record, 'resume');
      const next = transition(record, 'running', 'resume', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      const saved = await persist(next, record.runVersion);
      writeAudit(saved, {
        event: WORKFLOW_AUDIT_EVENT.runStateChanged,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: input.reason,
      });
      return saved;
    },

    async cancel(input) {
      const record = await loadRun(input.organizationId, input.workflowRunId);
      // Cancellation propagates: every open branch is cancelled with the run, so a
      // branch cannot outlive the run it belongs to.
      const cancelled: WorkflowRunRecord = {
        ...record,
        branches: record.branches.map((branch) =>
          branch.state === 'pending' ||
          branch.state === 'running' ||
          branch.state === 'waiting_for_approval'
            ? { ...branch, state: 'cancelled' as const, currentNodeId: undefined, endedAt: clock.isoNow() }
            : branch,
        ),
      };
      return terminate(cancelled, {
        state: 'cancelled',
        message: input.reason,
        diagnostics: `cancelled by ${input.actor.actorId}`,
        actorId: input.actor.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
    },

    async expireIfDue(input) {
      const record = await loadRun(input.organizationId, input.workflowRunId);
      if (isTerminalWorkflowState(record.state)) return record;
      const deadlineMs = Date.parse(record.deadlineAt);
      if (!Number.isFinite(deadlineMs) || clock.now() < deadlineMs) return record;
      return terminate(record, {
        state: 'expired',
        failure: 'workflow_expired',
        message: 'This run reached its time limit.',
        diagnostics: `deadline ${record.deadlineAt} passed`,
        actorId: input.actor.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
    },

    async decideApproval(input) {
      const record = await loadRun(input.organizationId, input.workflowRunId);
      if (record.state !== 'waiting_for_approval' || record.pendingApprovalId === undefined) {
        throw workflowFailure('invalid_node', 'That run is not waiting for an approval.', {
          workflowRunId: input.workflowRunId,
          diagnostics: `run state is ${record.state}`,
        });
      }
      if (record.pendingApprovalId !== input.workflowApprovalId) {
        throw workflowFailure('invalid_node', 'That approval does not belong to this run.', {
          workflowRunId: input.workflowRunId,
          diagnostics: `run is waiting on ${record.pendingApprovalId}`,
        });
      }

      const decided = await approvals.decide({
        organizationId: input.organizationId,
        workflowApprovalId: input.workflowApprovalId,
        decision: input.decision,
        reason: input.reason,
        deciderId: input.actor.actorId,
        deciderRoles: input.actor.roles,
      });

      writeAudit(record, {
        event: WORKFLOW_AUDIT_EVENT.approvalDecided,
        outcome: input.decision === 'approve' ? 'allowed' : 'denied',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        nodeId: decided.nodeId,
        ...(decided.branchId === undefined ? {} : { branchId: decided.branchId }),
        workflowApprovalId: decided.workflowApprovalId,
        reason: input.reason,
        detail: { decision: decided.state, checkpointVersion: decided.checkpointVersion },
      });

      if (input.decision === 'reject') {
        return terminate(record, {
          state: 'failed',
          failure: 'approval_rejected',
          message: 'A required approval was rejected.',
          diagnostics: `approval ${decided.workflowApprovalId} rejected by ${input.actor.actorId}`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      // The approval remains pending-on-the-node until the node consumes it. The
      // run returns to `running` so the next advance re-executes the node it was
      // parked on, with the approval in hand.
      let released = record;
      if (record.pendingApprovalBranchId !== undefined) {
        released = {
          ...released,
          branches: released.branches.map((branch) =>
            branch.branchId === record.pendingApprovalBranchId
              ? { ...branch, state: 'running' as const }
              : branch,
          ),
        };
      }
      const moved = transition(released, 'running', 'approve', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      return persist(moved, record.runVersion);
    },

    async retry(input) {
      const record = await loadRun(input.organizationId, input.workflowRunId);
      if (!isTerminalWorkflowState(record.state)) {
        throw workflowFailure('invalid_node', 'Only a finished run can be retried.', {
          workflowRunId: input.workflowRunId,
          diagnostics: `run state is ${record.state}`,
        });
      }
      // Terminal records are evidence. A retry is a NEW run that names its parent,
      // so the record of what happened the first time is untouched.
      const original = record.values.__input__;
      if (original === undefined) {
        throw workflowFailure('checkpoint_conflict', 'That run has nothing to retry from.', {
          workflowRunId: input.workflowRunId,
          diagnostics: 'the run record carries no validated input',
        });
      }

      return this.createRun({
        workflowId: record.context.workflowId,
        organizationId: record.context.organizationId,
        actor: input.actor,
        input: original,
        requestId: input.requestId,
        correlationId: input.correlationId,
        origin: record.context.origin,
        parentWorkflowRunId: record.context.workflowRunId,
      });
    },

    latestCheckpoint: (organizationId, workflowRunId) =>
      checkpoints.latest(organizationId, workflowRunId),
  };
}

/** Re-exported so the service layer can name an edge without importing the graph. */
export { edgesFrom };
