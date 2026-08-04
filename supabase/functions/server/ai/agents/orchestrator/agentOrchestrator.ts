/**
 * The Agent Orchestrator (AI-01 Batch 3A).
 *
 * THE SINGLE AUTHORITY OVER AGENT EXECUTION.
 *
 *   AGENTS PROPOSE. THE ORCHESTRATOR DECIDES. THE CONTROL PLANE EXECUTES.
 *
 * An agent's `propose` returns an intention. Nothing in this module trusts it:
 * every proposal is sealed into an action only after its type, capabilities,
 * targets, payload size, idempotency and contracts have been checked, and only
 * after the limit, token and cost preflights have said the run may afford it.
 * A proposal that fails any of those does not execute — it produces a typed
 * failure and, where the failure is terminal, a terminal run state.
 *
 * THE STEP SEQUENCE, IN THE ORDER IT ACTUALLY RUNS:
 *
 *   administrative state   the kill switch and the master switch, re-read from
 *                          durable settings, BEFORE anything else. An operator
 *                          who stopped AI stopped agent runs too.
 *   deadline and limits    steps, per-agent steps, retries, no-progress.
 *   propose                the agent's intention.
 *   seal                   contracts, capabilities, allow lists, idempotency.
 *   loop protection        fingerprints, handoff edges, cycles.
 *   token preflight        refuse BEFORE the control plane, not after.
 *   cost preflight         platform headroom, run ceilings, downgrade, approval.
 *   park                   persist the waiting state before doing the thing.
 *   execute                model via the control plane, tool via the gateway,
 *                          handoff via the registry, approval via the gate.
 *   reconcile              measured tokens and cost, attribution, variance.
 *   checkpoint             immutable, versioned, resumable.
 *   persist                one compare-and-swap; a lost race is not merged.
 *
 * DURABILITY IS NOT A PHASE AT THE END. The run is persisted before an action
 * executes and again after it completes, so an isolate that dies mid-tool
 * leaves a run that plainly says `waiting_for_tool` at a known checkpoint,
 * rather than a run that looks idle and has actually already called something.
 *
 * WHAT THIS MODULE DELIBERATELY CANNOT DO: reach a provider, read a credential,
 * write a settings record, move a budget, or mutate an audit record. Each of
 * those lives behind a port it is given, or behind a layer it has no import for.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { IdFactory } from '../../contracts/ids.ts';
import type { Logger } from '../../observability/logger.ts';
import type { Metrics } from '../../observability/metrics.ts';
import type {
  AgentDefinition,
  AgentHandoffContext,
  AgentObservation,
  AgentProposalInput,
} from '../contracts/agent.ts';
import type {
  AgentAction,
  AgentActionProposal,
  AgentContextContribution,
} from '../contracts/actions.ts';
import { ACTION_BOUNDS, CAPABILITY_FOR_ACTION, isAgentActionType } from '../contracts/actions.ts';
import type {
  AgentCheckpoint,
  AgentRunContext,
  AgentRunOperation,
  AgentRunRecord,
  AgentRunState,
  AgentStepRecord,
} from '../contracts/runtime.ts';
import {
  CHECKPOINT_BOUNDS,
  MAX_TRANSITION_HISTORY,
  isTerminalState,
} from '../contracts/runtime.ts';
import type { AgentFailureCode } from '../contracts/failures.ts';
import { agentFailure, isAgentRuntimeError, isStepRetryable, terminalStateFor } from '../contracts/failures.ts';
import type { AgentRegistry } from '../registry/agentRegistry.ts';
import type { AgentCheckpointStore, AgentRunStore } from '../persistence/ports.ts';
import type { ApprovalGate } from '../approvals/approvalGate.ts';
import type { ToolGateway } from '../tools/toolRegistry.ts';
import type { ModelExecutionPort } from './controlPlaneBridge.ts';
import type { ModelProfileRegistry, RoutingHealth } from '../runtime/modelRouting.ts';
import { isRoutingRefused, routeModelProfile } from '../runtime/modelRouting.ts';
import type { AgentAuditWriter } from '../observability/agentAudit.ts';
import { AGENT_AUDIT_EVENT } from '../observability/agentAudit.ts';
import { assertTransition, PAUSABLE_STATES } from '../runtime/stateMachine.ts';
import {
  checkPreStepLimits,
  checkProposalLimits,
  fingerprintAction,
  initialLoopState,
  recordLoopStep,
  remainingBudget,
} from '../runtime/limits.ts';
import {
  emptyTokenLedger,
  estimateModelStep,
  isTokenPreflightRefused,
  recordEstimate,
  reconcileUsage,
  tokenPreflight,
} from '../runtime/tokenIntelligence.ts';
import {
  decideCost,
  emptyCostLedger,
  projectStepCost,
  releaseCost,
  reserveCost,
  settleCost,
} from '../runtime/costPolicy.ts';
import { buildContext, type ContextInput, type ContextSectionKind } from '../runtime/contextBuilder.ts';
import { canonicalBytes, digestValue } from '../runtime/digest.ts';
import { isFailure, describeIssues } from '../../security/validation.ts';

/** Administrative and health facts the runtime re-reads before every step. */
export interface AgentRuntimeState {
  readonly aiEnabled: boolean;
  readonly executionAvailable: boolean;
  readonly degraded: boolean;
  /**
   * Certification requirements, one per population.
   *
   * Deliberately three fields rather than one. An independent review found that
   * a single `requireCertification` flag meant an operator hardening PROVIDER
   * certification silently also refused uncertified agents and tools — safe in
   * direction, invisible in effect, and impossible to reason about during an
   * incident. Providers, agents and tools are certified by different people
   * against different contracts.
   */
  readonly requireCertifiedProviders: boolean;
  readonly requireCertifiedAgents: boolean;
  readonly requireCertifiedTools: boolean;
  readonly configurationVersion: number;
}

/** The actor driving a run, resolved server-side. Never caller-asserted. */
export interface AgentRunActor {
  readonly actorId: string;
  readonly roles: readonly string[];
  /** Agent runtime capabilities (see `service/agentRbac.ts`). */
  readonly capabilities: readonly string[];
}

export interface AgentOrchestratorDependencies {
  readonly registry: AgentRegistry;
  readonly profiles: ModelProfileRegistry;
  readonly tools: ToolGateway;
  readonly runs: AgentRunStore;
  readonly checkpoints: AgentCheckpointStore;
  readonly approvals: ApprovalGate;
  readonly models: ModelExecutionPort;
  readonly audit: AgentAuditWriter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly metrics: Metrics;
  /** Settings and health, read live so an operator change lands immediately. */
  readonly runtimeState: () => AgentRuntimeState;
  /** Micro-USD still available under the MARQ lifetime ceiling. */
  readonly platformHeadroomMicroUsd: () => Promise<number>;
  /**
   * Attempts the control plane may make per model step. Used only to price the
   * retry risk; the plane's own feature limits are what actually bound it.
   */
  readonly assumedProviderAttempts?: number;
  /** Micro-USD above which a step needs approval. Absent means no threshold. */
  readonly costApprovalThresholdMicroUsd?: number;
}

export interface CreateRunInput {
  readonly agentId: string;
  readonly organizationId: string;
  readonly actor: AgentRunActor;
  readonly objective: string;
  readonly input: unknown;
  readonly requestId: string;
  readonly correlationId: string;
  readonly origin: AgentRunContext['origin'];
  readonly workflowId?: string;
  readonly parentRunId?: string;
}

export interface AdvanceInput {
  readonly organizationId: string;
  readonly runId: string;
  readonly actor: AgentRunActor;
  /** The driving caller's credential, for the control plane. Never stored. */
  readonly authorization: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly clientIp?: string;
}

export interface ControlInput {
  readonly organizationId: string;
  readonly runId: string;
  readonly actor: AgentRunActor;
  readonly reason: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface ApprovalDecisionRequest extends ControlInput {
  readonly approvalId: string;
  readonly decision: 'approve' | 'reject';
}

export interface AgentOrchestrator {
  createRun(input: CreateRunInput): Promise<AgentRunRecord>;
  /** Drive the run until it blocks, completes or fails. */
  advance(input: AdvanceInput): Promise<AgentRunRecord>;
  pause(input: ControlInput): Promise<AgentRunRecord>;
  resume(input: ControlInput): Promise<AgentRunRecord>;
  cancel(input: ControlInput): Promise<AgentRunRecord>;
  /** Record an approval decision and release or end the run. */
  decideApproval(input: ApprovalDecisionRequest): Promise<AgentRunRecord>;
  /** Fork a NEW run from a terminal one. Terminal records are never reopened. */
  retry(input: ControlInput): Promise<AgentRunRecord>;
  /** Expire a run whose deadline has passed. Idempotent. */
  expireIfDue(input: ControlInput): Promise<AgentRunRecord>;
  /** The latest checkpoint, for a resume or an operator read. */
  latestCheckpoint(organizationId: string, runId: string): Promise<AgentCheckpoint | undefined>;
}

/** What a checkpoint carries so a run can continue after an isolate restart. */
interface AgentProgressSnapshot {
  readonly objective: string;
  readonly input: unknown;
  readonly lastObservation?: AgentObservation;
  readonly handoff?: AgentHandoffContext;
}

const MAX_DRIVE_STEPS = 64;

export function createAgentOrchestrator(
  deps: AgentOrchestratorDependencies,
): AgentOrchestrator {
  const { registry, profiles, tools, runs, checkpoints, approvals, models, audit, clock, ids } = deps;
  const assumedAttempts = Math.max(1, deps.assumedProviderAttempts ?? 2);

  // ── Small helpers ─────────────────────────────────────────────────────────

  function health(): RoutingHealth {
    const state = deps.runtimeState();
    return {
      executionAvailable: state.executionAvailable,
      degraded: state.degraded,
      aiEnabled: state.aiEnabled,
      requireCertification: state.requireCertifiedProviders,
    };
  }

  function writeAudit(
    record: AgentRunRecord,
    facts: {
      event: (typeof AGENT_AUDIT_EVENT)[keyof typeof AGENT_AUDIT_EVENT];
      outcome: 'allowed' | 'denied' | 'executed' | 'failed' | 'recorded';
      requestId: string;
      correlationId: string;
      actorId: string;
      stepId?: string;
      actionId?: string;
      attemptId?: string;
      executionRequestId?: string;
      actionType?: AgentAction['actionType'];
      failure?: AgentFailureCode;
      reason?: string;
      detail?: Readonly<Record<string, unknown>>;
    },
  ): void {
    audit.record({
      event: facts.event,
      outcome: facts.outcome,
      requestId: facts.requestId,
      correlationId: facts.correlationId,
      runId: record.context.runId,
      organizationId: record.context.organizationId,
      actorId: facts.actorId,
      agentId: record.currentAgentId,
      agentVersion: record.currentAgentVersion,
      workflowId: record.context.workflowId,
      state: record.state,
      stepId: facts.stepId,
      actionId: facts.actionId,
      attemptId: facts.attemptId,
      executionRequestId: facts.executionRequestId,
      actionType: facts.actionType,
      failure: facts.failure,
      reason: facts.reason,
      detail: facts.detail,
    });
  }

  /** Apply a state change to a record. Validates, versions and records it. */
  function transition(
    record: AgentRunRecord,
    to: AgentRunState,
    operation: AgentRunOperation | 'step',
    options: { reason: string; actorId: string; failure?: AgentFailureCode },
  ): AgentRunRecord {
    assertTransition({
      from: record.state,
      to,
      operation,
      currentVersion: record.runVersion,
      expectedVersion: record.runVersion,
      runId: record.context.runId,
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
    const overflow = Math.max(0, transitions.length - MAX_TRANSITION_HISTORY);

    return {
      ...record,
      state: to,
      runVersion,
      updatedAt: nowIso,
      transitions: transitions.slice(overflow),
      transitionsTruncated: record.transitionsTruncated + overflow,
      ...(options.failure === undefined ? {} : { failure: options.failure }),
      ...(isTerminalState(to)
        ? {
            endedAt: nowIso,
            elapsedRuntimeMs: Math.max(0, clock.now() - Date.parse(record.createdAt)),
          }
        : {}),
    };
  }

  /** Persist a mutation under optimistic concurrency. */
  async function persist(next: AgentRunRecord, expectedVersion: number): Promise<AgentRunRecord> {
    await runs.save(next, expectedVersion);
    return next;
  }

  /**
   * Refuse an ordinary control operation on a run that owes a human a decision.
   *
   * The state machine already refuses `pause` and `resume` from
   * `waiting_for_approval`. This is the second, independent guard, and it is
   * not redundancy: it keys on the PENDING APPROVAL rather than on the state,
   * so a run that somehow holds an undecided approval in any other state — a
   * record written by an older revision, a future code path — is still refused
   * rather than driven past its gate. The defect this closes was reachable
   * through the public API with ordinary permissions.
   */
  function assertNoPendingApproval(record: AgentRunRecord, operation: string): void {
    if (record.pendingApprovalId === undefined) return;
    throw agentFailure('approval_required', 'This run is waiting for an approval decision.', {
      runId: record.context.runId,
      diagnostics:
        `${operation} refused: run holds undecided approval ${record.pendingApprovalId} ` +
        `in state ${record.state}`,
    });
  }

  async function loadRun(organizationId: string, runId: string): Promise<AgentRunRecord> {
    const record = await runs.load(organizationId, runId);
    if (!record) {
      throw agentFailure('run_not_found', 'That run could not be found.', {
        runId,
        diagnostics: `run ${runId} not found for organization ${organizationId}`,
      });
    }
    // The store is tenant-keyed, so this can only fire on a corrupt record —
    // and a record that disagrees with its own key is exactly the case where
    // failing closed matters.
    if (record.context.organizationId !== organizationId) {
      throw agentFailure('tenant_isolation_violation', 'That run belongs to another organization.', {
        runId,
      });
    }
    return record;
  }

  /** End a run terminally, persist it and record why. */
  async function terminate(
    record: AgentRunRecord,
    input: {
      readonly state: AgentRunState;
      readonly failure?: AgentFailureCode;
      readonly message: string;
      readonly diagnostics: string;
      readonly actorId: string;
      readonly requestId: string;
      readonly correlationId: string;
      readonly resultDigest?: string;
    },
  ): Promise<AgentRunRecord> {
    const operation: AgentRunOperation =
      input.state === 'completed' ? 'complete' : input.state === 'cancelled' ? 'cancel' :
      input.state === 'expired' ? 'expire' : 'fail';

    const next = transition(record, input.state, operation, {
      reason: input.message,
      actorId: input.actorId,
      failure: input.failure,
    });
    const finished: AgentRunRecord = {
      ...next,
      failureMessage: input.failure === undefined ? undefined : input.message,
      resultDigest: input.resultDigest ?? next.resultDigest,
      pendingAction: undefined,
      pendingApprovalId: undefined,
    };
    const saved = await persist(finished, record.runVersion);

    writeAudit(saved, {
      event: AGENT_AUDIT_EVENT.runTerminated,
      outcome: input.failure === undefined ? 'recorded' : 'failed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actorId,
      failure: input.failure,
      reason: input.message,
      detail: {
        diagnostics: input.diagnostics,
        steps: saved.stepCount,
        handoffs: saved.handoffCount,
        totalTokens: saved.tokens.actualTotalTokens,
        costMicroUsd: saved.cost.actualMicroUsd,
      },
    });
    deps.metrics.increment('ai_agent_runs_total', {
      state: saved.state,
      agent: saved.context.agentId,
    });
    return saved;
  }

  // ── Checkpoints ───────────────────────────────────────────────────────────

  async function writeCheckpoint(
    record: AgentRunRecord,
    progress: AgentProgressSnapshot,
    output?: unknown,
  ): Promise<AgentRunRecord> {
    const version = record.checkpointVersion + 1;
    const previous = await checkpoints.latest(record.context.organizationId, record.context.runId);

    const progressBytes = canonicalBytes(progress);
    if (progressBytes === undefined || progressBytes > CHECKPOINT_BOUNDS.maxProgressBytes) {
      throw agentFailure('persistence_failed', 'This run produced more state than it may store.', {
        runId: record.context.runId,
        diagnostics: `checkpoint progress ${progressBytes ?? 'unserializable'} bytes exceeds ${CHECKPOINT_BOUNDS.maxProgressBytes}`,
      });
    }
    if (output !== undefined) {
      const outputBytes = canonicalBytes(output);
      if (outputBytes === undefined || outputBytes > CHECKPOINT_BOUNDS.maxOutputBytes) {
        throw agentFailure('persistence_failed', 'This run produced more output than it may store.', {
          runId: record.context.runId,
          diagnostics: `checkpoint output ${outputBytes ?? 'unserializable'} bytes exceeds ${CHECKPOINT_BOUNDS.maxOutputBytes}`,
        });
      }
    }

    const checkpoint: AgentCheckpoint = {
      runId: record.context.runId,
      organizationId: record.context.organizationId,
      version,
      createdAt: clock.isoNow(),
      state: record.state,
      agentId: record.currentAgentId,
      stepCount: record.stepCount,
      progress,
      progressDigest: digestValue(progress),
      ...(output === undefined ? {} : { output }),
      ...(previous === undefined ? {} : { previousDigest: previous.progressDigest }),
    };
    await checkpoints.write(checkpoint);
    return { ...record, checkpointVersion: version };
  }

  async function readProgress(record: AgentRunRecord): Promise<AgentProgressSnapshot> {
    const checkpoint = await checkpoints.latest(
      record.context.organizationId,
      record.context.runId,
    );
    const progress = checkpoint?.progress as AgentProgressSnapshot | undefined;
    if (!progress || typeof progress !== 'object') {
      throw agentFailure('checkpoint_conflict', 'This run has no readable checkpoint to resume from.', {
        runId: record.context.runId,
        diagnostics: `no valid checkpoint at or below version ${record.checkpointVersion}`,
      });
    }
    return progress;
  }

  // ── Proposal sealing ──────────────────────────────────────────────────────

  /**
   * Turn an untrusted proposal into an authorised action, or refuse it.
   *
   * Every rejection below is a `?` a reviewer would otherwise have to ask of
   * the execution path: can an agent call a tool it did not declare, hand off
   * to an agent it does not know, reuse an action id, propose an unknown type,
   * or send a payload larger than the runtime will store? The answer is no, and
   * this is where it is no.
   */
  function sealAction(
    record: AgentRunRecord,
    agent: AgentDefinition,
    proposal: AgentActionProposal,
  ): AgentAction {
    const runId = record.context.runId;
    const reject = (message: string, diagnostics: string): never => {
      throw agentFailure('invalid_action', message, {
        runId,
        agentId: agent.agentId,
        diagnostics,
      });
    };

    if (!proposal || typeof proposal !== 'object' || !isAgentActionType(proposal.actionType)) {
      const declared = String((proposal as { actionType?: unknown } | undefined)?.actionType);
      reject(
        'That agent proposed an action the runtime does not recognise.',
        `unknown action type ${declared}`,
      );
    }

    const reason = proposal.reason?.trim() ?? '';
    if (
      reason.length < ACTION_BOUNDS.reason.min ||
      reason.length > ACTION_BOUNDS.reason.max
    ) {
      reject('That agent proposed an action without a usable reason.', `reason length ${reason.length}`);
    }

    const idempotencyKey = proposal.idempotencyKey?.trim() ?? '';
    if (
      idempotencyKey.length < ACTION_BOUNDS.idempotencyKey.min ||
      idempotencyKey.length > ACTION_BOUNDS.idempotencyKey.max
    ) {
      reject('That agent proposed an action without a usable idempotency key.', `key length ${idempotencyKey.length}`);
    }

    if (proposal.actionId !== undefined) {
      const reused = record.steps.some((step) => step.actionId === proposal.actionId);
      if (reused) {
        reject('That agent reused an action identifier.', `duplicate actionId ${proposal.actionId}`);
      }
    }

    const required = CAPABILITY_FOR_ACTION[proposal.actionType];
    const missing = required.filter((capability) => !agent.capabilities.includes(capability));
    if (missing.length > 0) {
      throw agentFailure('capability_denied', 'That agent may not take this kind of action.', {
        runId,
        agentId: agent.agentId,
        diagnostics: `missing capabilities: ${missing.join(', ')}`,
      });
    }

    // Per-type contracts.
    let target: string | undefined;
    let payload: unknown;
    switch (proposal.actionType) {
      case 'model_call': {
        if (!agent.allowedModelProfiles.includes(proposal.modelProfileId)) {
          throw agentFailure('capability_denied', 'That agent may not use that model profile.', {
            runId,
            agentId: agent.agentId,
            diagnostics: `profile ${proposal.modelProfileId} is not in the agent's allow list`,
          });
        }
        if (profiles.find(proposal.modelProfileId) === undefined) {
          reject('That agent asked for a model profile that does not exist.', `unknown profile ${proposal.modelProfileId}`);
        }
        const sections = proposal.context ?? [];
        if (sections.length > ACTION_BOUNDS.maxContextSections) {
          reject('That agent supplied more context sections than the runtime accepts.', `sections=${sections.length}`);
        }
        for (const section of sections) {
          if ((section.content?.length ?? 0) > ACTION_BOUNDS.maxSectionChars) {
            reject('That agent supplied an oversized context section.', `section ${section.sectionId} is ${section.content.length} characters`);
          }
        }
        if (!proposal.objective?.trim()) {
          reject('That agent proposed a model call with no objective.', 'objective is empty');
        }
        target = proposal.modelProfileId;
        payload = { objective: proposal.objective, sections: sections.map((s) => s.sectionId) };
        break;
      }
      case 'tool_call': {
        if (!agent.allowedTools.includes(proposal.toolId)) {
          throw agentFailure('tool_denied', 'That agent may not use that tool.', {
            runId,
            agentId: agent.agentId,
            diagnostics: `tool ${proposal.toolId} is not in the agent's allow list`,
          });
        }
        const bytes = canonicalBytes(proposal.input);
        if (bytes === undefined || bytes > ACTION_BOUNDS.maxInputBytes) {
          reject('That agent proposed a tool call the runtime will not carry.', `input ${bytes ?? 'unserializable'} bytes`);
        }
        target = proposal.toolId;
        payload = proposal.input;
        break;
      }
      case 'handoff': {
        if (!agent.allowedHandoffTargets.includes(proposal.targetAgentId)) {
          throw agentFailure('handoff_denied', 'That agent may not hand off to that agent.', {
            runId,
            agentId: agent.agentId,
            diagnostics: `target ${proposal.targetAgentId} is not in the agent's allow list`,
          });
        }
        const bytes = canonicalBytes(proposal.payload);
        if (bytes === undefined || bytes > ACTION_BOUNDS.maxInputBytes) {
          reject('That agent proposed a handoff the runtime will not carry.', `payload ${bytes ?? 'unserializable'} bytes`);
        }
        target = proposal.targetAgentId;
        payload = proposal.payload;
        break;
      }
      case 'request_approval': {
        if ((proposal.dataAffected?.length ?? 0) > ACTION_BOUNDS.maxDataAffected) {
          reject('That approval request names more data than the runtime records.', `dataAffected=${proposal.dataAffected.length}`);
        }
        if (!proposal.impactSummary?.trim()) {
          reject('That approval request has no impact summary.', 'impactSummary is empty');
        }
        payload = { impactSummary: proposal.impactSummary };
        break;
      }
      case 'checkpoint': {
        const bytes = canonicalBytes(proposal.progress);
        if (bytes === undefined || bytes > CHECKPOINT_BOUNDS.maxProgressBytes) {
          reject('That agent proposed a checkpoint larger than the runtime stores.', `progress ${bytes ?? 'unserializable'} bytes`);
        }
        payload = proposal.progress;
        break;
      }
      case 'complete': {
        const validated = agent.outputContract.validate(proposal.output, 'output');
        if (isFailure(validated)) {
          reject('That agent proposed a completion that does not match its output contract.', describeIssues(validated.issues));
        }
        const missingFields = agent.completion.requiredOutputFields.filter((field) => {
          const output = proposal.output as Record<string, unknown> | null;
          return typeof output !== 'object' || output === null || output[field] === undefined;
        });
        if (missingFields.length > 0) {
          reject('That agent proposed a completion missing required fields.', `missing: ${missingFields.join(', ')}`);
        }
        if (!agent.completion.terminalAfterHandoff && record.handoffCount > 0) {
          reject('That agent may not complete a run it received by handoff.', `agent ${agent.agentId} is not terminal after a handoff`);
        }
        payload = proposal.output;
        break;
      }
      case 'fail': {
        payload = { failureReason: proposal.failureReason?.slice(0, 200) ?? 'unspecified' };
        break;
      }
      case 'pause': {
        payload = {};
        break;
      }
    }

    const timeoutMs = Math.min(
      ACTION_BOUNDS.timeoutMs.max,
      Math.max(ACTION_BOUNDS.timeoutMs.min, proposal.timeoutMs ?? 30_000),
    );

    return {
      ...proposal,
      actionId: proposal.actionId ?? ids.next('act'),
      runId,
      agentId: agent.agentId,
      organizationId: record.context.organizationId,
      createdAt: clock.isoNow(),
      requiredCapabilities: required,
      requiresApproval: false,
      estimatedPromptTokens: Math.max(0, Math.floor(proposal.estimatedPromptTokens ?? 0)),
      estimatedCompletionTokens: Math.max(0, Math.floor(proposal.estimatedCompletionTokens ?? 0)),
      estimatedCostMicroUsd: 0,
      timeoutMs,
      fingerprint: fingerprintAction({
        agentId: agent.agentId,
        actionType: proposal.actionType,
        target,
        payload,
      }),
      checkpointVersion: record.checkpointVersion,
    };
  }

  // ── Context assembly for a model step ─────────────────────────────────────

  function contextInputsFor(
    agent: AgentDefinition,
    progress: AgentProgressSnapshot,
    contributions: readonly AgentContextContribution[],
  ): ContextInput[] {
    const inputs: ContextInput[] = [
      {
        sectionId: 'agent',
        kind: 'agent_definition' as ContextSectionKind,
        label: 'Agent remit',
        content: `${agent.displayName} (${agent.agentId}@${agent.version}) — ${agent.purpose}`,
        trusted: true,
        priority: 100,
      },
      {
        sectionId: 'objective',
        kind: 'objective' as ContextSectionKind,
        label: 'Run objective',
        content: progress.objective,
        // The objective originates from a caller, so it is fenced rather than
        // treated as instruction. The agent's remit above is the trusted part.
        trusted: false,
        priority: 90,
      },
    ];

    if (progress.lastObservation?.output !== undefined) {
      inputs.push({
        sectionId: 'observation',
        kind: 'tool_result' as ContextSectionKind,
        label: 'Previous step result',
        content: JSON.stringify(progress.lastObservation.output).slice(0, 8_000),
        trusted: false,
        priority: 80,
      });
    }
    if (progress.handoff) {
      inputs.push({
        sectionId: 'handoff',
        kind: 'handoff_context' as ContextSectionKind,
        label: `Handoff from ${progress.handoff.fromAgentId}`,
        content: JSON.stringify(progress.handoff.payload).slice(0, 8_000),
        trusted: false,
        priority: 85,
      });
    }

    for (const contribution of contributions) {
      inputs.push({
        ...contribution,
        // An agent's own contributions are never trusted context: the whole
        // point of the fence is that content flowing through an agent may have
        // come from a model or a tool.
        trusted: false,
        kind: 'retrieved_evidence' as ContextSectionKind,
      });
    }
    return inputs;
  }

  // ── The drive loop ────────────────────────────────────────────────────────

  async function drive(
    initial: AgentRunRecord,
    input: AdvanceInput,
  ): Promise<AgentRunRecord> {
    let record = initial;
    let progress = await readProgress(record);
    const deadlineMs = Date.parse(record.deadlineAt);

    for (let iteration = 0; iteration < MAX_DRIVE_STEPS; iteration += 1) {
      if (isTerminalState(record.state)) return record;

      // An action that was parked for approval is executed AS IT WAS SEALED,
      // not re-proposed. An approval authorises one specific action; asking the
      // agent again would produce a new action with a new id, and the approval
      // that was granted would either authorise nothing or be spent on
      // something a human never saw.
      let carried: AgentAction | undefined;
      if (record.pendingAction !== undefined && record.state === 'running') {
        const pending = record.pendingAction;
        if (record.pendingApprovalId !== undefined) {
          // Spending the approval is what makes it single-use. It happens here,
          // once, before the action runs — not inside each executor, where four
          // call sites would each have to remember.
          //
          // A FAILURE HERE RETURNS THE RUN TO ITS GATE. If the approval expired
          // between the decision and this step, or was consumed by a concurrent
          // drive, the run must go back to `waiting_for_approval` holding its
          // pending action rather than settling in `running` with an action
          // nobody can authorise. That stranded state is the defect this
          // recovery closes; the run stays recoverable — an operator can cancel
          // it, and its deadline still expires it.
          try {
            await approvals.consume(
              record.context.organizationId,
              record.pendingApprovalId,
              pending.actionId,
            );
          } catch (error) {
            const failure = isAgentRuntimeError(error) ? error.failure : 'approval_required';
            const returned = transition(record, 'waiting_for_approval', 'step', {
              reason: 'the approval could not be spent; the run is waiting again',
              actorId: input.actor.actorId,
              failure,
            });
            record = await persist(returned, record.runVersion);
            writeAudit(record, {
              event: AGENT_AUDIT_EVENT.approvalDecided,
              outcome: 'denied',
              requestId: input.requestId,
              correlationId: input.correlationId,
              actorId: input.actor.actorId,
              actionId: pending.actionId,
              actionType: pending.actionType,
              failure,
              reason: 'the approval could not be spent; the run returned to waiting',
              detail: {
                approvalId: record.pendingApprovalId ?? '',
                diagnostics: isAgentRuntimeError(error) ? error.diagnostics ?? '' : String(error),
              },
            });
            throw error;
          }
        }
        if (pending.actionType === 'request_approval') {
          // The agent asked for a decision and got one. There is nothing to
          // execute; the run simply continues.
          record = await persist(
            {
              ...record,
              pendingAction: undefined,
              pendingApprovalId: undefined,
              runVersion: record.runVersion + 1,
              updatedAt: clock.isoNow(),
            },
            record.runVersion,
          );
        } else {
          carried = pending;
        }
      }

      // 1 — Administrative state. The kill switch stops progression; it does
      // not end the run, so an operator who releases it can resume rather than
      // having destroyed work.
      const state = deps.runtimeState();
      if (!state.aiEnabled) {
        if (!PAUSABLE_STATES.includes(record.state)) return record;
        const paused = transition(record, 'paused', 'pause', {
          reason: 'AI execution is administratively stopped.',
          actorId: input.actor.actorId,
        });
        record = await persist(paused, record.runVersion);
        writeAudit(record, {
          event: AGENT_AUDIT_EVENT.runStateChanged,
          outcome: 'denied',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          failure: 'runtime_disabled',
          reason: 'AI execution is administratively stopped.',
        });
        return record;
      }

      const agent = registry.require(record.currentAgentId);

      // 2 — Deadline and counters.
      const violation = checkPreStepLimits({
        record,
        limits: agent.limits,
        nowMs: clock.now(),
        deadlineMs,
      });
      if (violation) {
        writeAudit(record, {
          event: AGENT_AUDIT_EVENT.limitReached,
          outcome: 'denied',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          failure: violation.failure,
          reason: violation.message,
          detail: { diagnostics: violation.diagnostics },
        });
        return terminate(record, {
          state: terminalStateFor(violation.failure) ?? 'failed',
          failure: violation.failure,
          message: violation.message,
          diagnostics: violation.diagnostics,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      // 3 — Ask the agent, unless an approved action is already in hand.
      const proposalInput: AgentProposalInput = {
        runId: record.context.runId,
        agentId: agent.agentId,
        organizationId: record.context.organizationId,
        objective: progress.objective,
        input: progress.input,
        stepCount: record.stepCount,
        stepsTakenByThisAgent: record.stepsByAgent[agent.agentId] ?? 0,
        handoffCount: record.handoffCount,
        lastObservation: progress.lastObservation,
        handoff: progress.handoff,
        remaining: remainingBudget(record, agent.limits, clock.now(), deadlineMs),
        checkpointVersion: record.checkpointVersion,
      };

      let action: AgentAction;
      if (carried !== undefined) {
        action = carried;
      } else {
        let proposal: AgentActionProposal;
        try {
          proposal = (await agent.propose(proposalInput)) as AgentActionProposal;
        } catch (error) {
          // An agent that throws is a defective agent, not a failed step: there
          // is no proposal to retry and nothing to fall back to.
          return terminate(record, {
            state: 'failed',
            failure: 'invalid_action',
            message: 'That agent could not decide what to do next.',
            diagnostics: `propose threw: ${error instanceof Error ? error.message : String(error)}`,
            actorId: input.actor.actorId,
            requestId: input.requestId,
            correlationId: input.correlationId,
          });
        }

        try {
          action = sealAction(record, agent, proposal);
        } catch (error) {
          const handled = await handleStepFailure(record, error, input, undefined);
          if (isTerminalState(handled.state)) return handled;
          record = handled;
          continue;
        }
      }

      writeAudit(record, {
        event: AGENT_AUDIT_EVENT.actionProposed,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        actionId: action.actionId,
        actionType: action.actionType,
        reason: action.reason,
        detail: { fingerprint: action.fingerprint },
      });

      // 4 — Loop protection.
      const loopViolation = checkProposalLimits({
        record,
        limits: agent.limits,
        fingerprint: action.fingerprint,
        handoffTarget: action.actionType === 'handoff' ? action.targetAgentId : undefined,
      });
      if (loopViolation) {
        writeAudit(record, {
          event: AGENT_AUDIT_EVENT.limitReached,
          outcome: 'denied',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          actionId: action.actionId,
          actionType: action.actionType,
          failure: loopViolation.failure,
          reason: loopViolation.message,
          detail: { diagnostics: loopViolation.diagnostics },
        });
        return terminate(record, {
          state: terminalStateFor(loopViolation.failure) ?? 'failed',
          failure: loopViolation.failure,
          message: loopViolation.message,
          diagnostics: loopViolation.diagnostics,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      // 5 — Execute.
      let outcome: StepOutcome;
      try {
        outcome = await executeAction({ record, agent, action, input, progress, deadlineMs });
      } catch (error) {
        const handled = await handleStepFailure(record, error, input, action);
        // A recoverable failure leaves the run running with its retry counter
        // advanced, so the loop re-proposes. Anything else is terminal and the
        // loop is over.
        if (isTerminalState(handled.state)) return handled;
        record = handled;
        continue;
      }

      record = outcome.record;
      progress = outcome.progress;

      if (outcome.stop) return record;
    }

    // The loop bound is a backstop, not a limit: the agent's own step ceiling is
    // always the smaller of the two, so reaching this means a step neither
    // advanced the counter nor stopped, which is a runtime defect rather than a
    // runaway agent. Ending the run is the safe response either way.
    return terminate(record, {
      state: 'failed',
      failure: 'no_progress',
      message: 'This run stopped making progress and was ended.',
      diagnostics: `drive loop reached its ${MAX_DRIVE_STEPS}-iteration backstop`,
      actorId: input.actor.actorId,
      requestId: input.requestId,
      correlationId: input.correlationId,
    });
  }

  interface StepContext {
    readonly record: AgentRunRecord;
    readonly agent: AgentDefinition;
    readonly action: AgentAction;
    readonly input: AdvanceInput;
    readonly progress: AgentProgressSnapshot;
    readonly deadlineMs: number;
  }

  interface StepOutcome {
    readonly record: AgentRunRecord;
    readonly progress: AgentProgressSnapshot;
    /** True when the run must stop here: blocked, waiting or terminal. */
    readonly stop: boolean;
  }

  /** Fold a completed step into the record and persist it. */
  async function commitStep(
    context: StepContext,
    result: {
      readonly nextState: AgentRunState;
      readonly outcome: AgentStepRecord['outcome'];
      readonly observation?: AgentObservation;
      readonly outputDigest?: string;
      readonly stepFields: Partial<AgentStepRecord>;
      readonly tokens?: AgentRunRecord['tokens'];
      readonly cost?: AgentRunRecord['cost'];
      readonly handoffTarget?: string;
      readonly progress: AgentProgressSnapshot;
      readonly reason: string;
      readonly stop: boolean;
      readonly resultDigest?: string;
      /** Caller-safe explanation when this step ends the run unsuccessfully. */
      readonly failureMessage?: string;
    },
  ): Promise<StepOutcome> {
    const { record, action, agent } = context;
    const nowIso = clock.isoNow();
    const sequence = record.stepCount + 1;

    const step: AgentStepRecord = {
      stepId: ids.next('stp'),
      sequence,
      agentId: agent.agentId,
      actionId: action.actionId,
      actionType: action.actionType,
      reason: action.reason,
      idempotencyKey: action.idempotencyKey,
      startedAt: nowIso,
      completedAt: nowIso,
      latencyMs: 0,
      outcome: result.outcome,
      attempt: 1,
      fingerprint: action.fingerprint,
      inputDigest: digestValue(action),
      estimatedPromptTokens: action.estimatedPromptTokens,
      estimatedCompletionTokens: action.estimatedCompletionTokens,
      estimatedCostMicroUsd: action.estimatedCostMicroUsd,
      checkpointVersion: record.checkpointVersion,
      ...result.stepFields,
      ...(result.outputDigest === undefined ? {} : { outputDigest: result.outputDigest }),
    };

    const stepsByAgent = { ...record.stepsByAgent };
    stepsByAgent[agent.agentId] = (stepsByAgent[agent.agentId] ?? 0) + 1;

    const loop = recordLoopStep(record.loop, {
      fingerprint: action.fingerprint,
      outputDigest: result.outputDigest,
      handoffTarget: result.handoffTarget,
      fromAgentId: result.handoffTarget === undefined ? undefined : agent.agentId,
    });

    const advanced: AgentRunRecord = {
      ...record,
      stepCount: sequence,
      currentStep: sequence,
      stepsByAgent,
      steps: [...record.steps, step],
      loop,
      repeatedActionCount: Math.max(
        record.repeatedActionCount,
        loop.actionCounts[action.fingerprint] ?? 0,
      ),
      ...(result.tokens === undefined ? {} : { tokens: result.tokens }),
      ...(result.cost === undefined ? {} : { cost: result.cost }),
      elapsedRuntimeMs: Math.max(0, clock.now() - Date.parse(record.createdAt)),
    };

    // The checkpoint is written BEFORE the state change is persisted, so a
    // failure between the two leaves a checkpoint the run has not yet claimed —
    // recoverable — rather than a state that claims a checkpoint that does not
    // exist.
    const checkpointed = await writeCheckpoint(
      advanced,
      result.progress,
      result.outcome === 'executed' && result.nextState === 'completed'
        ? (action.actionType === 'complete' ? action.output : undefined)
        : undefined,
    );

    const next =
      checkpointed.state === result.nextState
        ? { ...checkpointed, runVersion: checkpointed.runVersion + 1, updatedAt: nowIso }
        : transition(checkpointed, result.nextState, 'step', {
            reason: result.reason,
            actorId: context.input.actor.actorId,
          });

    const finished: AgentRunRecord = {
      ...next,
      ...(result.resultDigest === undefined ? {} : { resultDigest: result.resultDigest }),
      ...(result.failureMessage === undefined ? {} : { failureMessage: result.failureMessage }),
      ...(isTerminalState(result.nextState)
        ? { endedAt: nowIso, pendingAction: undefined, pendingApprovalId: undefined }
        : {}),
    };

    const saved = await persist(finished, record.runVersion);
    return { record: saved, progress: result.progress, stop: result.stop };
  }

  /** Execute one sealed action. */
  async function executeAction(context: StepContext): Promise<StepOutcome> {
    const { record, agent, action, input } = context;

    switch (action.actionType) {
      case 'pause': {
        const paused = await commitStep(context, {
          nextState: 'paused',
          outcome: 'executed',
          stepFields: {},
          progress: context.progress,
          reason: action.reason,
          stop: true,
        });
        return paused;
      }

      case 'fail': {
        // An agent that declares it cannot continue is not a RUNTIME failure —
        // no limit was crossed and no rule was broken — so the record carries
        // the agent's own explanation rather than a runtime failure code it
        // would be misleading to attribute.
        const failed = await commitStep(context, {
          nextState: 'failed',
          outcome: 'failed',
          stepFields: {},
          progress: context.progress,
          reason: action.reason,
          failureMessage: `The agent stopped: ${action.failureReason.slice(0, 200)}`,
          stop: true,
        });
        writeAudit(failed.record, {
          event: AGENT_AUDIT_EVENT.runTerminated,
          outcome: 'failed',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          actionId: action.actionId,
          reason: action.failureReason,
        });
        return failed;
      }

      case 'checkpoint': {
        return commitStep(context, {
          nextState: 'running',
          outcome: 'executed',
          stepFields: {},
          progress: { ...context.progress },
          reason: action.reason,
          stop: false,
        });
      }

      case 'complete': {
        // A completion the agent's policy says a human must sign off does NOT
        // complete. It parks, exactly as an approval-gated tool call does, and
        // the sealed completion is what a later approval releases.
        //
        // This gate was declared in `AgentApprovalPolicy` and enforced nowhere
        // until an independent review proved a run with `requireForCompletion:
        // true` completed with no approval at all. A governance control that
        // reads as enforced and is not is worse than one that is absent: an
        // agent author configures it and stops looking.
        if (agent.approvals.requireForCompletion && record.pendingApprovalId === undefined) {
          return parkForApproval(
            context,
            `Run ${record.context.runId} has finished and needs sign-off before it is accepted.`,
            [...agent.completion.requiredOutputFields].slice(0, 12),
            { tokens: 0, costMicroUsd: 0 },
          );
        }

        const output = action.output;
        const committed = await commitStep(context, {
          nextState: 'completed',
          outcome: 'executed',
          outputDigest: digestValue(output),
          resultDigest: digestValue(output),
          stepFields: {},
          progress: {
            ...context.progress,
            lastObservation: {
              kind: 'model',
              ok: true,
              digest: digestValue(output),
              output,
            },
          },
          reason: action.reason,
          stop: true,
        });
        writeAudit(committed.record, {
          event: AGENT_AUDIT_EVENT.runTerminated,
          outcome: 'recorded',
          requestId: input.requestId,
          correlationId: input.correlationId,
          actorId: input.actor.actorId,
          actionId: action.actionId,
          reason: 'completed',
          detail: {
            steps: committed.record.stepCount,
            costMicroUsd: committed.record.cost.actualMicroUsd,
          },
        });
        deps.metrics.increment('ai_agent_runs_total', {
          state: 'completed',
          agent: record.context.agentId,
        });
        return committed;
      }

      case 'request_approval':
        return parkForApproval(context, action.impactSummary, action.dataAffected ?? [], {
          tokens: action.estimatedAdditionalTokens ?? 0,
          costMicroUsd: action.estimatedAdditionalCostMicroUsd ?? 0,
        });

      case 'tool_call':
        return executeToolCall(context);

      case 'handoff':
        return executeHandoff(context);

      case 'model_call':
        return executeModelCall(context);
    }
  }

  /** Park the run on a durable approval. Persisted before anything waits. */
  async function parkForApproval(
    context: StepContext,
    impactSummary: string,
    dataAffected: readonly string[],
    estimates: { tokens: number; costMicroUsd: number },
  ): Promise<StepOutcome> {
    const { record, agent, action, input } = context;

    const request = await approvals.request({
      action,
      agent,
      runId: record.context.runId,
      organizationId: record.context.organizationId,
      impactSummary,
      dataAffected,
      estimatedAdditionalTokens: estimates.tokens,
      estimatedAdditionalCostMicroUsd: estimates.costMicroUsd,
    });

    const parked = await commitStep(
      {
        ...context,
        record: {
          ...record,
          pendingApprovalId: request.approvalId,
          // Stamped with the checkpoint this park is ABOUT TO WRITE, not the
          // one it was sealed against. `commitStep` writes exactly one
          // checkpoint, so the parked action's version is the version a later
          // approval will read back — and the conflict check then means what it
          // says: "the run moved on while a human was deciding", rather than
          // firing on the parking write itself.
          pendingAction: {
            ...action,
            requiresApproval: true,
            checkpointVersion: record.checkpointVersion + 1,
          },
        },
      },
      {
        nextState: 'waiting_for_approval',
        outcome: 'awaiting_approval',
        stepFields: { approvalId: request.approvalId },
        progress: context.progress,
        reason: action.reason,
        stop: true,
      },
    );

    writeAudit(parked.record, {
      event: AGENT_AUDIT_EVENT.approvalRequested,
      outcome: 'recorded',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      actionId: action.actionId,
      actionType: action.actionType,
      reason: impactSummary,
      detail: {
        approvalId: request.approvalId,
        expiresAt: request.expiresAt,
        approverRoles: request.authorizedApproverRoles,
        estimatedAdditionalCostMicroUsd: estimates.costMicroUsd,
      },
    });
    return parked;
  }

  async function executeToolCall(context: StepContext): Promise<StepOutcome> {
    const { record, agent, action, input } = context;
    if (action.actionType !== 'tool_call') {
      throw agentFailure('invalid_action', 'That action is not a tool call.', {
        runId: record.context.runId,
      });
    }

    // An unapproved call to a tool that needs approval parks the run rather
    // than failing it. The approval, once granted, replays this exact action.
    if (tools.requiresApproval(action.toolId, agent) && record.pendingApprovalId === undefined) {
      const descriptor = tools.describe(action.toolId);
      return parkForApproval(
        context,
        `Run ${record.context.runId} wants to call ${action.toolId}.`,
        [action.toolId, descriptor?.sideEffect ?? 'unknown_side_effect'],
        { tokens: 0, costMicroUsd: 0 },
      );
    }

    // ── Durable at-most-once, for a tool that is not safe to repeat ─────────
    //
    // The gateway's own store catches a repeat inside one drive loop and is
    // isolate-local, so on its own it guarantees nothing across a restart or a
    // second isolate. The run record is the authority.
    //
    // The check reads BOTH the claim list and the persisted step history: the
    // claim covers a call that was authorised, and the history covers one that
    // completed, so a record written before claims existed is still honoured.
    const toolDescriptor = tools.describe(action.toolId);
    const repeatable = toolDescriptor?.idempotency === 'idempotent';
    if (!repeatable) {
      const claimed =
        record.claimedToolKeys.includes(action.idempotencyKey) ||
        record.steps.some(
          (step) =>
            step.actionType === 'tool_call' &&
            // `executed` only. A step recorded while PARKING the same call for
            // approval carries the same key and has not run — counting it would
            // make every approval-gated tool refuse itself the moment a human
            // said yes, which is exactly what it did before this predicate was
            // narrowed.
            step.outcome === 'executed' &&
            step.idempotencyKey === action.idempotencyKey,
        );
      if (claimed) {
        throw agentFailure('invalid_action', 'That tool call has already been made.', {
          runId: record.context.runId,
          agentId: agent.agentId,
          diagnostics:
            `tool ${action.toolId} is non-idempotent and key ${action.idempotencyKey} ` +
            'is already claimed in this run',
        });
      }
    }

    // Park in `waiting_for_tool` BEFORE calling, and CLAIM THE KEY in the same
    // write. An isolate that dies mid-call leaves a run that says what it was
    // doing and a key that can never be reused — a non-idempotent tool that
    // errored may still have had its effect, so a spent claim is the only safe
    // reading. Two isolates racing this write contend on one compare-and-swap:
    // exactly one claims and calls, the other is refused before it can.
    //
    // AT-MOST-ONCE, NOT EXACTLY-ONCE. A crash between the claim and the call
    // means the tool never runs and the key is gone. That is the direction this
    // platform chooses, and it is stated plainly rather than dressed up.
    const parked = transition(record, 'waiting_for_tool', 'step', {
      reason: `calling ${action.toolId}`,
      actorId: input.actor.actorId,
    });
    const waiting = await persist(
      repeatable
        ? parked
        : { ...parked, claimedToolKeys: [...parked.claimedToolKeys, action.idempotencyKey] },
      record.runVersion,
    );

    writeAudit(waiting, {
      event: AGENT_AUDIT_EVENT.toolRequested,
      outcome: 'allowed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      actionId: action.actionId,
      actionType: 'tool_call',
      reason: action.reason,
      detail: { toolId: action.toolId, idempotencyKey: action.idempotencyKey },
    });

    const result = await tools.execute({
      toolId: action.toolId,
      agent,
      runId: record.context.runId,
      organizationId: record.context.organizationId,
      actorId: input.actor.actorId,
      actorCapabilities: input.actor.capabilities,
      correlationId: input.correlationId,
      idempotencyKey: action.idempotencyKey,
      input: action.input,
      timeoutMs: action.timeoutMs,
      approvalId: record.pendingApprovalId,
    });

    const observation: AgentObservation = {
      kind: 'tool',
      ok: true,
      digest: result.outputDigest,
      output: result.output,
    };

    const committed = await commitStep(
      { ...context, record: { ...waiting, pendingApprovalId: undefined, pendingAction: undefined } },
      {
        nextState: 'running',
        outcome: 'executed',
        observation,
        outputDigest: result.outputDigest,
        stepFields: { toolId: action.toolId },
        progress: { ...context.progress, lastObservation: observation },
        reason: action.reason,
        stop: false,
      },
    );

    writeAudit(committed.record, {
      event: AGENT_AUDIT_EVENT.toolExecuted,
      outcome: 'executed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      actionId: action.actionId,
      actionType: 'tool_call',
      detail: {
        toolId: action.toolId,
        outputDigest: result.outputDigest,
        latencyMs: result.latencyMs,
        replayed: result.replayed,
      },
    });
    return committed;
  }

  async function executeHandoff(context: StepContext): Promise<StepOutcome> {
    const { record, agent, action, input } = context;
    if (action.actionType !== 'handoff') {
      throw agentFailure('invalid_action', 'That action is not a handoff.', {
        runId: record.context.runId,
      });
    }

    const target = registry.require(action.targetAgentId);
    if (!target.capabilities.includes('agent.handoff.receive')) {
      throw agentFailure('handoff_denied', 'That agent cannot receive a handoff.', {
        runId: record.context.runId,
        agentId: agent.agentId,
        diagnostics: `${target.agentId} does not declare agent.handoff.receive`,
      });
    }
    if (target.handoffContract === undefined) {
      throw agentFailure('handoff_denied', 'That agent declares no handoff contract.', {
        runId: record.context.runId,
        agentId: agent.agentId,
        diagnostics: `${target.agentId} has no handoffContract`,
      });
    }
    const validated = target.handoffContract.validate(action.payload, 'payload');
    if (isFailure(validated)) {
      throw agentFailure('handoff_denied', 'That handoff payload does not match the target contract.', {
        runId: record.context.runId,
        agentId: agent.agentId,
        diagnostics: describeIssues(validated.issues),
      });
    }

    if (agent.approvals.requireForHandoff && record.pendingApprovalId === undefined) {
      return parkForApproval(
        context,
        `Run ${record.context.runId} wants to hand off from ${agent.agentId} to ${target.agentId}.`,
        [agent.agentId, target.agentId],
        { tokens: 0, costMicroUsd: 0 },
      );
    }

    const payloadDigest = digestValue(validated.value);
    const payloadBytes = canonicalBytes(validated.value) ?? 0;

    const parked = transition(record, 'waiting_for_agent', 'step', {
      reason: `handing off to ${target.agentId}`,
      actorId: input.actor.actorId,
    });
    const waiting = await persist(parked, record.runVersion);

    const handoffContext: AgentHandoffContext = {
      fromAgentId: agent.agentId,
      reason: action.reason,
      payload: validated.value,
      receivedAt: clock.isoNow(),
    };

    const handoffRecord = {
      handoffId: ids.next('hof'),
      at: clock.isoNow(),
      fromAgentId: agent.agentId,
      toAgentId: target.agentId,
      reason: action.reason,
      payloadDigest,
      payloadBytes,
      contextBytes: payloadBytes,
      estimatedCostMicroUsd: action.estimatedCostMicroUsd,
      actualCostMicroUsd: 0,
      resultingState: 'running' as AgentRunState,
    };

    const committed = await commitStep(
      {
        ...context,
        record: {
          ...waiting,
          currentAgentId: target.agentId,
          currentAgentVersion: target.version,
          handoffCount: waiting.handoffCount + 1,
          handoffs: [...waiting.handoffs, handoffRecord],
          pendingApprovalId: undefined,
          pendingAction: undefined,
        },
      },
      {
        nextState: 'running',
        outcome: 'executed',
        outputDigest: payloadDigest,
        stepFields: { targetAgentId: target.agentId },
        handoffTarget: target.agentId,
        progress: {
          ...context.progress,
          handoff: handoffContext,
          // The receiving agent starts from the handoff, not from the sending
          // agent's last observation — carrying that forward would be exactly
          // the "unrestricted agent conversation" this batch forbids.
          lastObservation: undefined,
        },
        reason: action.reason,
        stop: false,
      },
    );

    writeAudit(committed.record, {
      event: AGENT_AUDIT_EVENT.handoff,
      outcome: 'executed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      actionId: action.actionId,
      actionType: 'handoff',
      reason: action.reason,
      detail: {
        fromAgentId: agent.agentId,
        toAgentId: target.agentId,
        payloadDigest,
        payloadBytes,
        handoffCount: committed.record.handoffCount,
      },
    });
    return committed;
  }

  async function executeModelCall(context: StepContext): Promise<StepOutcome> {
    const { record, agent, action, input } = context;
    if (action.actionType !== 'model_call') {
      throw agentFailure('invalid_action', 'That action is not a model call.', {
        runId: record.context.runId,
      });
    }

    const remaining = remainingBudget(record, agent.limits, clock.now(), context.deadlineMs);

    // ── Context assembly ────────────────────────────────────────────────────
    const contextInputs = contextInputsFor(agent, context.progress, action.context ?? []);
    let built = buildContext(contextInputs, {
      budgetTokens: Math.max(1, Math.min(agent.limits.maxPromptTokens, remaining.promptTokens)),
    });

    // ── Routing ─────────────────────────────────────────────────────────────
    const routing = routeModelProfile(
      profiles,
      {
        allowedProfileIds: agent.allowedModelProfiles,
        requestedProfileId: action.modelProfileId,
        requiresStructuredOutput: true,
        complexity: 'standard',
        minimumQuality: 'standard',
        latency: 'interactive',
        safety: agent.safetyClass === 'external_effect' ? 'strict' : 'standard',
        remainingTotalTokens: remaining.totalTokens,
        remainingCostMicroUsd: Math.min(
          remaining.estimatedCostMicroUsd,
          remaining.actualCostMicroUsd,
        ),
        estimatedPromptTokens: built.manifest.estimatedPromptTokens,
        limits: agent.limits,
      },
      health(),
    );
    if (isRoutingRefused(routing)) {
      // The blocker decides the terminal state. Reporting an exhausted token
      // budget as a cost failure — or a provider outage as either — would put
      // three different operator responses behind one label.
      const failureFor = {
        disabled: 'runtime_disabled',
        availability: 'provider_unavailable',
        capability: 'capability_denied',
        tokens: 'token_budget_exhausted',
        cost: 'cost_budget_exhausted',
      } as const;
      writeAudit(record, {
        event: AGENT_AUDIT_EVENT.budgetDenied,
        outcome: 'denied',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        actionId: action.actionId,
        actionType: 'model_call',
        failure: failureFor[routing.blockedBy],
        reason: routing.reason,
        detail: { blockedBy: routing.blockedBy, diagnostics: routing.diagnostics },
      });
      throw agentFailure(failureFor[routing.blockedBy], routing.reason, {
        runId: record.context.runId,
        agentId: agent.agentId,
        diagnostics: routing.diagnostics,
      });
    }
    const profile = routing.profile;

    writeAudit(record, {
      event: AGENT_AUDIT_EVENT.modelRouted,
      outcome: 'allowed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      actionId: action.actionId,
      actionType: 'model_call',
      reason: routing.reason,
      detail: {
        profileId: profile.profileId,
        featureId: profile.featureId,
        downgraded: routing.downgraded,
        contextReduced: built.manifest.reduced,
        contextSections: built.manifest.included.length,
        contextExcluded: built.manifest.excluded.length,
      },
    });

    // ── Token preflight, BEFORE the control plane ───────────────────────────
    let completionAllowance = Math.min(profile.maxCompletionTokens, agent.limits.maxCompletionTokens);
    let estimate = estimateModelStep({
      promptText: built.text,
      maxCompletionTokens: completionAllowance,
      agentEstimate: {
        promptTokens: action.estimatedPromptTokens,
        completionTokens: action.estimatedCompletionTokens,
      },
    });

    let preflight = tokenPreflight({ ledger: record.tokens, limits: agent.limits, estimate });
    if (isTokenPreflightRefused(preflight) && preflight.reduceContextBy > 0) {
      // One deterministic compression attempt. Not a loop: a second pass that
      // still does not fit is a run that cannot afford this step, and grinding
      // the context down further would eventually send a prompt with no
      // evidence in it and call that success.
      built = buildContext(contextInputs, {
        budgetTokens: Math.max(
          1,
          built.manifest.budgetTokens - preflight.reduceContextBy,
        ),
      });
      estimate = estimateModelStep({
        promptText: built.text,
        maxCompletionTokens: completionAllowance,
        agentEstimate: {
          promptTokens: action.estimatedPromptTokens,
          completionTokens: action.estimatedCompletionTokens,
        },
      });
      preflight = tokenPreflight({ ledger: record.tokens, limits: agent.limits, estimate });
    }
    if (isTokenPreflightRefused(preflight)) {
      writeAudit(record, {
        event: AGENT_AUDIT_EVENT.budgetDenied,
        outcome: 'denied',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        actionId: action.actionId,
        actionType: 'model_call',
        failure: 'token_budget_exhausted',
        reason: 'This run reached its token allowance.',
        detail: { limit: preflight.limit, diagnostics: preflight.diagnostics },
      });
      throw agentFailure('token_budget_exhausted', 'This run reached its token allowance.', {
        runId: record.context.runId,
        agentId: agent.agentId,
        diagnostics: preflight.diagnostics,
      });
    }

    // ── Cost preflight, also BEFORE the control plane ───────────────────────
    const platformHeadroom = await deps.platformHeadroomMicroUsd();
    let projection = projectStepCost({
      profile,
      promptTokens: estimate.promptTokens,
      completionTokens: estimate.completionTokens,
      maxAttempts: assumedAttempts,
      repairPossible: true,
    });

    let decision = decideCost({
      projection,
      ledger: record.cost,
      limits: agent.limits,
      platformRemainingMicroUsd: platformHeadroom,
      cheaperProfileAvailable: agent.allowedModelProfiles.length > 1,
      contextCompressible: built.manifest.included.length > 3,
      completionReducible: completionAllowance > 256,
      // A step that is being replayed under an approval has already had its
      // cost decided by a human. Re-applying the threshold would park it again
      // on the approval it is holding, which is a loop with a person in it.
      approvalThresholdMicroUsd:
        record.pendingApprovalId === undefined ? deps.costApprovalThresholdMicroUsd : undefined,
    });

    if (decision.action === 'reduce_completion') {
      completionAllowance = Math.max(256, Math.floor(completionAllowance / 2));
      estimate = { ...estimate, completionTokens: completionAllowance, totalTokens: estimate.promptTokens + completionAllowance };
      projection = projectStepCost({
        profile,
        promptTokens: estimate.promptTokens,
        completionTokens: completionAllowance,
        maxAttempts: assumedAttempts,
        repairPossible: true,
      });
      decision = decideCost({
        projection,
        ledger: record.cost,
        limits: agent.limits,
        platformRemainingMicroUsd: platformHeadroom,
        cheaperProfileAvailable: false,
        contextCompressible: false,
        completionReducible: false,
        approvalThresholdMicroUsd: deps.costApprovalThresholdMicroUsd,
      });
    }

    writeAudit(record, {
      event: AGENT_AUDIT_EVENT.costEstimated,
      outcome: decision.action === 'deny' ? 'denied' : 'allowed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      actionId: action.actionId,
      actionType: 'model_call',
      reason: decision.reason,
      detail: {
        decision: decision.action,
        projectedMicroUsd: projection.projectedMicroUsd,
        retryRiskMicroUsd: projection.retryRiskMicroUsd,
        platformRemainingMicroUsd: platformHeadroom,
        estimatedTotalTokens: estimate.totalTokens,
      },
    });

    if (decision.action === 'deny') {
      throw agentFailure('cost_budget_exhausted', decision.reason, {
        runId: record.context.runId,
        agentId: agent.agentId,
        diagnostics: decision.diagnostics,
      });
    }
    if (decision.action === 'require_approval') {
      return parkForApproval(
        context,
        `Run ${record.context.runId} wants a model step costing up to ${projection.projectedMicroUsd} micro-USD.`,
        [profile.profileId],
        { tokens: estimate.totalTokens, costMicroUsd: projection.projectedMicroUsd },
      );
    }

    // ── Reserve, park, execute ──────────────────────────────────────────────
    const reservedLedger = reserveCost(record.cost, projection.projectedMicroUsd);
    const estimatedTokens = recordEstimate(record.tokens, estimate);

    const parked = await persist(
      {
        ...record,
        cost: reservedLedger,
        tokens: estimatedTokens,
        runVersion: record.runVersion + 1,
        updatedAt: clock.isoNow(),
      },
      record.runVersion,
    );

    let result;
    try {
      result = await models.execute({
        featureId: profile.featureId,
        input: {
          agent_id: agent.agentId,
          agent_purpose: agent.purpose,
          objective: action.objective,
          context: built.text,
          output_fields: [...(action.expectedOutput?.requiredFields ?? [])],
        },
        correlationId: input.correlationId,
        causationId: input.requestId,
        organizationId: record.context.organizationId,
        authorization: input.authorization,
        clientIp: input.clientIp,
      });
    } catch (error) {
      // The hold is released before the failure propagates: a step that never
      // reached a provider must not leave the run's budget looking spent.
      await persist(
        {
          ...parked,
          cost: releaseCost(parked.cost, projection.projectedMicroUsd),
          runVersion: parked.runVersion + 1,
          updatedAt: clock.isoNow(),
        },
        parked.runVersion,
      );
      throw error;
    }

    const settledCost = settleCost(
      parked.cost,
      projection.projectedMicroUsd,
      result.costMicroUsd,
    );
    const reconciledTokens = reconcileUsage(parked.tokens, {
      estimate,
      usage: result.usage,
      costMicroUsd: result.costMicroUsd,
      key: {
        agentId: agent.agentId,
        providerId: result.providerId,
        modelId: result.modelId,
        feature: profile.featureId,
      },
    });

    const output = (result.output as { result?: unknown; summary?: unknown }).result ?? result.output;
    const observation: AgentObservation = {
      kind: 'model',
      ok: true,
      digest: digestValue(output),
      output,
    };

    const committed = await commitStep(
      {
        ...context,
        record: {
          ...parked,
          tokens: reconciledTokens,
          cost: settledCost,
          pendingApprovalId: undefined,
          pendingAction: undefined,
        },
      },
      {
        nextState: 'running',
        outcome: 'executed',
        observation,
        outputDigest: observation.digest,
        stepFields: {
          modelProfileId: profile.profileId,
          providerId: result.providerId,
          modelId: result.modelId,
          executionRequestId: result.requestId,
          actualPromptTokens: result.usage.promptTokens,
          actualCompletionTokens: result.usage.completionTokens,
          actualCostMicroUsd: result.costMicroUsd,
          estimatedCostMicroUsd: projection.projectedMicroUsd,
        },
        tokens: reconciledTokens,
        cost: settledCost,
        progress: { ...context.progress, lastObservation: observation },
        reason: action.reason,
        stop: false,
      },
    );

    writeAudit(committed.record, {
      event: AGENT_AUDIT_EVENT.modelExecuted,
      outcome: 'executed',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      actionId: action.actionId,
      actionType: 'model_call',
      executionRequestId: result.requestId,
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
        outputDigest: observation.digest,
      },
    });
    return committed;
  }

  /**
   * Turn a thrown failure into the run's outcome.
   *
   * A retryable step failure — a tool that errored, a model that could not be
   * parsed — increments the retry counter and leaves the run running, so the
   * next iteration re-proposes. Everything else is a decision, and a decision
   * ends the run in the terminal state its failure code declares.
   */
  async function handleStepFailure(
    hint: AgentRunRecord,
    error: unknown,
    input: AdvanceInput,
    action: AgentAction | undefined,
  ): Promise<AgentRunRecord> {
    // Re-read before writing. A step that failed part-way — a model call whose
    // reservation was released, a tool call that had already parked the run —
    // has moved the stored version on, and terminating against the version the
    // caller was holding would lose the race it should not be in.
    const record = (await runs.load(hint.context.organizationId, hint.context.runId)) ?? hint;
    const failure = isAgentRuntimeError(error) ? error.failure : 'model_failed';
    const message = error instanceof Error ? error.message : 'This run could not continue.';
    const diagnostics = isAgentRuntimeError(error)
      ? error.diagnostics ?? message
      : String(error);

    // A LOST RACE IS NOT A RUN FAILURE. Another isolate holds this run and has
    // already advanced it; terminating here would let the loser of a race
    // destroy work the winner did — and, with the durable tool claim below, the
    // loser is precisely the caller that must fail harmlessly. The reloaded
    // record is returned as it stands.
    if (failure === 'stale_run_version' || failure === 'checkpoint_conflict') {
      writeAudit(record, {
        event: AGENT_AUDIT_EVENT.actionDecided,
        outcome: 'denied',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        actionId: action?.actionId,
        actionType: action?.actionType,
        failure,
        reason: 'another writer advanced this run first',
        detail: { diagnostics },
      });
      return record;
    }

    const agent = registry.find(record.currentAgentId);
    const maxRetries = agent?.limits.maxRetries ?? 0;

    if (isStepRetryable(failure) && record.retryCount < maxRetries) {
      const retrying = transition(record, 'retrying', 'step', {
        reason: message,
        actorId: input.actor.actorId,
        failure,
      });
      const saved = await persist(
        { ...retrying, retryCount: retrying.retryCount + 1 },
        record.runVersion,
      );
      writeAudit(saved, {
        event: AGENT_AUDIT_EVENT.retryScheduled,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        actionId: action?.actionId,
        failure,
        reason: message,
        detail: { retryCount: saved.retryCount, diagnostics },
      });
      const resumed = transition(saved, 'running', 'step', {
        reason: 'retrying after a recoverable step failure',
        actorId: input.actor.actorId,
      });
      return persist(resumed, saved.runVersion);
    }

    const terminal =
      terminalStateFor(failure) ??
      (isStepRetryable(failure) ? 'failed' : 'failed');

    writeAudit(record, {
      event: AGENT_AUDIT_EVENT.actionDecided,
      outcome: 'denied',
      requestId: input.requestId,
      correlationId: input.correlationId,
      actorId: input.actor.actorId,
      actionId: action?.actionId,
      actionType: action?.actionType,
      failure,
      reason: message,
      detail: { diagnostics },
    });

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

  // ── Public surface ────────────────────────────────────────────────────────

  return {
    async createRun(input) {
      const state = deps.runtimeState();
      if (!state.aiEnabled) {
        throw agentFailure('runtime_disabled', 'AI execution is currently stopped.', {
          agentId: input.agentId,
          diagnostics: 'operational settings report AI disabled or the emergency stop engaged',
        });
      }

      const agent = registry.require(input.agentId);

      const validated = agent.inputContract.validate(input.input, 'input');
      if (isFailure(validated)) {
        throw agentFailure('invalid_action', 'That input does not match what this agent accepts.', {
          agentId: input.agentId,
          diagnostics: describeIssues(validated.issues),
        });
      }

      const objective = input.objective.trim();
      if (objective.length < 3 || objective.length > 2_000) {
        throw agentFailure('invalid_action', 'A run needs an objective.', {
          agentId: input.agentId,
          diagnostics: `objective length ${objective.length}`,
        });
      }

      const nowMs = clock.now();
      const nowIso = clock.isoNow();
      const runId = ids.next('run');
      const context: AgentRunContext = {
        runId,
        correlationId: input.correlationId,
        requestId: input.requestId,
        organizationId: input.organizationId,
        actorId: input.actor.actorId,
        actorRoles: input.actor.roles,
        origin: input.origin,
        agentId: agent.agentId,
        agentVersion: agent.version,
        ...(input.workflowId === undefined ? {} : { workflowId: input.workflowId }),
        ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
      };

      const record: AgentRunRecord = {
        context,
        runVersion: 1,
        state: 'created',
        currentAgentId: agent.agentId,
        currentAgentVersion: agent.version,
        currentStep: 0,
        stepCount: 0,
        stepsByAgent: {},
        handoffCount: 0,
        retryCount: 0,
        repeatedActionCount: 0,
        tokens: emptyTokenLedger(),
        cost: emptyCostLedger(),
        loop: initialLoopState(agent.agentId),
        claimedToolKeys: [],
        checkpointVersion: 0,
        planDigest: digestValue({ agentId: agent.agentId, version: agent.version, objective }),
        configurationVersion: state.configurationVersion,
        createdAt: nowIso,
        updatedAt: nowIso,
        deadlineAt: new Date(nowMs + agent.limits.maxRuntimeMs).toISOString(),
        elapsedRuntimeMs: 0,
        transitions: [],
        transitionsTruncated: 0,
        steps: [],
        handoffs: [],
      };

      await runs.create(record);

      // The entry checkpoint. Version 1 exists before the first step, so a run
      // that is interrupted immediately still has a point to resume from.
      const progress: AgentProgressSnapshot = { objective, input: validated.value };
      const checkpointed = await writeCheckpoint(record, progress);

      // created → validating → planned, each a real transition with its own
      // audit entry. Collapsing them would make "where did it fail?" ambiguous
      // for the two failures that happen before a step: a rejected input and a
      // disabled agent.
      let staged = transition(checkpointed, 'validating', 'start', {
        reason: 'validating the run against the agent definition',
        actorId: input.actor.actorId,
      });
      staged = transition(staged, 'planned', 'start', {
        reason: 'agent, contract and limits accepted',
        actorId: input.actor.actorId,
      });
      const saved = await persist(staged, record.runVersion);

      writeAudit(saved, {
        event: AGENT_AUDIT_EVENT.runCreated,
        outcome: 'allowed',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: objective.slice(0, 200),
        detail: {
          agentVersion: agent.version,
          safetyClass: agent.safetyClass,
          maxTotalSteps: agent.limits.maxTotalSteps,
          deadlineAt: saved.deadlineAt,
          planDigest: saved.planDigest,
        },
      });
      return saved;
    },

    async advance(input) {
      let record = await loadRun(input.organizationId, input.runId);
      if (isTerminalState(record.state)) return record;

      // Expire before anything else: a run past its deadline is expired, not
      // "about to take one more step".
      const deadlineMs = Date.parse(record.deadlineAt);
      if (Number.isFinite(deadlineMs) && clock.now() >= deadlineMs) {
        return terminate(record, {
          state: 'expired',
          failure: 'run_expired',
          message: 'This run reached its time limit.',
          diagnostics: `deadline ${record.deadlineAt} passed`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      if (record.state === 'waiting_for_approval' || record.state === 'paused') {
        // Not an error: advancing a parked run is a no-op that returns its
        // state, so a caller polling a run does not accidentally resume it.
        return record;
      }

      // Walk the entry states forward one edge at a time. A record left in
      // `created` or `validating` by an isolate that died mid-creation is
      // recoverable rather than stuck, and each edge is still a real, audited
      // transition rather than a jump the state machine never saw.
      while (
        record.state === 'created' ||
        record.state === 'validating' ||
        record.state === 'planned'
      ) {
        const to: AgentRunState =
          record.state === 'created'
            ? 'validating'
            : record.state === 'validating'
              ? 'planned'
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

      return drive(record, input);
    },

    async pause(input) {
      const record = await loadRun(input.organizationId, input.runId);
      assertNoPendingApproval(record, 'pause');
      const next = transition(record, 'paused', 'pause', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      const saved = await persist(next, record.runVersion);
      writeAudit(saved, {
        event: AGENT_AUDIT_EVENT.runStateChanged,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: input.reason,
      });
      return saved;
    },

    async resume(input) {
      const record = await loadRun(input.organizationId, input.runId);
      assertNoPendingApproval(record, 'resume');
      const next = transition(record, 'running', 'resume', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      const saved = await persist(next, record.runVersion);
      writeAudit(saved, {
        event: AGENT_AUDIT_EVENT.runStateChanged,
        outcome: 'recorded',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        reason: input.reason,
      });
      return saved;
    },

    async cancel(input) {
      const record = await loadRun(input.organizationId, input.runId);
      return terminate(record, {
        state: 'cancelled',
        message: input.reason,
        diagnostics: `cancelled by ${input.actor.actorId}`,
        actorId: input.actor.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
    },

    async expireIfDue(input) {
      const record = await loadRun(input.organizationId, input.runId);
      if (isTerminalState(record.state)) return record;
      const deadlineMs = Date.parse(record.deadlineAt);
      if (!Number.isFinite(deadlineMs) || clock.now() < deadlineMs) return record;
      return terminate(record, {
        state: 'expired',
        failure: 'run_expired',
        message: 'This run reached its time limit.',
        diagnostics: `deadline ${record.deadlineAt} passed`,
        actorId: input.actor.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
    },

    async decideApproval(input) {
      const record = await loadRun(input.organizationId, input.runId);
      if (record.state !== 'waiting_for_approval' || record.pendingApprovalId === undefined) {
        throw agentFailure('invalid_action', 'That run is not waiting for an approval.', {
          runId: input.runId,
          diagnostics: `run state is ${record.state}`,
        });
      }
      if (record.pendingApprovalId !== input.approvalId) {
        throw agentFailure('invalid_action', 'That approval does not belong to this run.', {
          runId: input.runId,
          diagnostics: `run is waiting on ${record.pendingApprovalId}`,
        });
      }

      const decided = await approvals.decide({
        organizationId: input.organizationId,
        approvalId: input.approvalId,
        decision: input.decision,
        reason: input.reason,
        deciderId: input.actor.actorId,
        deciderRoles: input.actor.roles,
      });

      writeAudit(record, {
        event: AGENT_AUDIT_EVENT.approvalDecided,
        outcome: input.decision === 'approve' ? 'allowed' : 'denied',
        requestId: input.requestId,
        correlationId: input.correlationId,
        actorId: input.actor.actorId,
        actionId: decided.actionId,
        reason: input.reason,
        detail: { approvalId: decided.approvalId, decision: decided.state },
      });

      if (input.decision === 'reject') {
        return terminate(record, {
          state: 'failed',
          failure: 'approval_rejected',
          message: 'A required approval was rejected.',
          diagnostics: `approval ${decided.approvalId} rejected by ${input.actor.actorId}`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      // A stale pending action is refused rather than executed: the run may
      // have been checkpointed past the state the action was authorised
      // against, and running it anyway would act on a world that changed.
      const pending = record.pendingAction;
      if (pending && pending.checkpointVersion !== record.checkpointVersion) {
        return terminate(record, {
          state: 'failed',
          failure: 'checkpoint_conflict',
          message: 'The approved action no longer matches this run.',
          diagnostics: `action checkpoint ${pending.checkpointVersion}, run checkpoint ${record.checkpointVersion}`,
          actorId: input.actor.actorId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      }

      const released = transition(record, 'running', 'approve', {
        reason: input.reason,
        actorId: input.actor.actorId,
      });
      return persist(released, record.runVersion);
    },

    async retry(input) {
      const record = await loadRun(input.organizationId, input.runId);
      if (!isTerminalState(record.state)) {
        throw agentFailure('invalid_action', 'Only a finished run can be retried.', {
          runId: input.runId,
          diagnostics: `run state is ${record.state}`,
        });
      }
      // Terminal records are evidence. A retry is a NEW run that names its
      // parent, so the record of what happened the first time is untouched.
      const checkpoint = await checkpoints.latest(input.organizationId, input.runId);
      const progress = checkpoint?.progress as AgentProgressSnapshot | undefined;
      if (!progress) {
        throw agentFailure('checkpoint_conflict', 'That run has nothing to retry from.', {
          runId: input.runId,
          diagnostics: 'no readable checkpoint',
        });
      }

      return this.createRun({
        agentId: record.context.agentId,
        organizationId: record.context.organizationId,
        actor: input.actor,
        objective: progress.objective,
        input: progress.input,
        requestId: input.requestId,
        correlationId: input.correlationId,
        origin: record.context.origin,
        workflowId: record.context.workflowId,
        parentRunId: record.context.runId,
      });
    },

    latestCheckpoint: (organizationId, runId) => checkpoints.latest(organizationId, runId),
  };
}
