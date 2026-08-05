/**
 * Workflow audit trail (AI-01 Batch 3B).
 *
 * A FOURTH trail, alongside the three that already exist, and the separation is
 * the point:
 *
 *   observability/audit.ts          what the platform DID — one record per AI
 *                                   request through the control plane.
 *   admin/adminAudit.ts             what an ADMINISTRATOR changed.
 *   agents/observability/…          what an AGENT proposed and the agent
 *                                   orchestrator decided about it.
 *   this module                     what a WORKFLOW planned, which node ran,
 *                                   which branch took which edge, what the
 *                                   optimizer trimmed, what the router chose and
 *                                   what the cache saved.
 *
 * The fourth question is not answerable from the other three. A model step appears
 * in the execution trail as a request and in the agent trail as a proposal; what
 * neither says is which workflow node wanted it, which condition sent the run down
 * this path, how much context was dropped before it, or which of three profiles the
 * router rejected. That is the record a reviewer needs when the question is "why
 * did this workflow cost that much?".
 *
 * JOINABLE BY CONSTRUCTION. Every record carries `requestId`, `correlationId`,
 * `workflowRunId`, `nodeId`, `branchId`, `organizationId` and `actorId`; a model
 * node additionally carries the control plane's own `requestId` and an agent node
 * the `childAgentRunId`. So one correlation id walks from the HTTP request, through
 * the workflow, into the agent run, into the execution trail, and out to the
 * provider attempt — with no joins to reconstruct.
 *
 * WHAT IS DELIBERATELY NOT STORED: prompts, completions, tool payloads, model
 * outputs and workflow values. Digests of all of them, and nothing else. The same
 * decision Batches 1 and 3A made, for the same reason — an audit store that
 * accumulates client business data is a liability that grows by itself.
 *
 * APPEND ONLY. `append`, `recent`, `size`. No update, no delete, no purge. The
 * boundary scan asserts the absence of a mutation method on the source.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { WorkflowFailureCode } from '../contracts/failures.ts';
import type { WorkflowNodeType } from '../contracts/workflow.ts';
import type { WorkflowRunState } from '../contracts/runtime.ts';

export const WORKFLOW_AUDIT_EVENT = {
  runCreated: 'ai.workflow.run.created',
  runStateChanged: 'ai.workflow.run.state_changed',
  planCompiled: 'ai.workflow.plan.compiled',
  planRejected: 'ai.workflow.plan.rejected',
  nodeEntered: 'ai.workflow.node.entered',
  nodeExited: 'ai.workflow.node.exited',
  nodeSkipped: 'ai.workflow.node.skipped',
  conditionEvaluated: 'ai.workflow.condition.evaluated',
  branchOpened: 'ai.workflow.branch.opened',
  branchClosed: 'ai.workflow.branch.closed',
  branchCancelled: 'ai.workflow.branch.cancelled',
  joinEvaluated: 'ai.workflow.join.evaluated',
  joinSatisfied: 'ai.workflow.join.satisfied',
  agentDelegated: 'ai.workflow.agent.delegated',
  toolInvoked: 'ai.workflow.tool.invoked',
  modelRouted: 'ai.workflow.model.routed',
  modelExecuted: 'ai.workflow.model.executed',
  contextOptimized: 'ai.workflow.context.optimized',
  complexityClassified: 'ai.workflow.complexity.classified',
  costEstimated: 'ai.workflow.cost.estimated',
  costReconciled: 'ai.workflow.cost.reconciled',
  budgetDenied: 'ai.workflow.budget.denied',
  cacheConsulted: 'ai.workflow.cache.consulted',
  callAvoided: 'ai.workflow.call.avoided',
  approvalRequested: 'ai.workflow.approval.requested',
  approvalDecided: 'ai.workflow.approval.decided',
  checkpointWritten: 'ai.workflow.checkpoint.written',
  retryScheduled: 'ai.workflow.retry.scheduled',
  limitReached: 'ai.workflow.limit.reached',
  runTerminated: 'ai.workflow.run.terminated',
} as const;

export type WorkflowAuditEvent =
  (typeof WORKFLOW_AUDIT_EVENT)[keyof typeof WORKFLOW_AUDIT_EVENT];

/** Bounded scalars. Anything larger belongs on the run record, not here. */
export type WorkflowAuditDetail = Readonly<Record<string, string | number | boolean>>;

export interface WorkflowAuditRecord {
  readonly workflowAuditId: string;
  readonly recordedAt: string;
  readonly event: WorkflowAuditEvent;
  readonly outcome: 'allowed' | 'denied' | 'executed' | 'failed' | 'recorded';

  // Trace identity — the whole point of the record.
  readonly requestId: string;
  readonly correlationId: string;
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly nodeId?: string;
  readonly nodeType?: WorkflowNodeType;
  readonly branchId?: string;
  readonly nodeExecutionId?: string;
  /** Control plane request id for a model node. The join to the AI trail. */
  readonly executionRequestId?: string;
  /** Agent run id for an agent node. The join to the agent trail. */
  readonly childAgentRunId?: string;
  readonly workflowApprovalId?: string;

  readonly organizationId: string;
  readonly actorId: string;

  readonly state?: WorkflowRunState;
  readonly failure?: WorkflowFailureCode;
  /** Caller-safe reason. Never a provider message or a storage message. */
  readonly reason?: string;
  readonly detail: WorkflowAuditDetail;
}

export interface WorkflowAuditStore {
  /** Persist one record. Must not throw — failures are the store's problem. */
  append(record: WorkflowAuditRecord): void | Promise<void>;
  recent(limit: number): readonly WorkflowAuditRecord[];
  size(): number;
}

const MAX_DETAIL_ENTRIES = 24;
const MAX_DETAIL_STRING = 200;
const MAX_REASON = 300;

/** Bound whatever a caller offers as detail. Never throws. */
export function boundWorkflowDetail(
  values: Readonly<Record<string, unknown>>,
): WorkflowAuditDetail {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(values)) {
    if (Object.keys(out).length >= MAX_DETAIL_ENTRIES) break;
    if (value === undefined || value === null) continue;
    const boundedKey = key.slice(0, 60);
    if (typeof value === 'number') {
      out[boundedKey] = Number.isFinite(value) ? value : 0;
    } else if (typeof value === 'boolean') {
      out[boundedKey] = value;
    } else if (typeof value === 'string') {
      out[boundedKey] = value.slice(0, MAX_DETAIL_STRING);
    } else if (Array.isArray(value)) {
      out[boundedKey] = value.map((entry) => String(entry)).join(',').slice(0, MAX_DETAIL_STRING);
    } else {
      out[boundedKey] = '[object]';
    }
  }
  return out;
}

/** Bounded in-memory ring buffer. Always present, even with a durable store. */
export function createMemoryWorkflowAuditStore(capacity: number): WorkflowAuditStore {
  const records: WorkflowAuditRecord[] = [];
  return {
    append(record) {
      records.push(record);
      if (records.length > capacity) records.splice(0, records.length - capacity);
    },
    recent: (limit) => records.slice(-limit).reverse(),
    size: () => records.length,
  };
}

/**
 * Write to several stores. A failing durable store is isolated: the others still
 * receive the record, and the failure is surfaced through `onError` rather than
 * propagating into a run.
 */
export function createCompositeWorkflowAuditStore(
  primary: WorkflowAuditStore,
  secondaries: readonly WorkflowAuditStore[],
  onError: (error: unknown) => void,
): WorkflowAuditStore {
  return {
    append(record) {
      primary.append(record);
      for (const store of secondaries) {
        try {
          const result = store.append(record);
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch(onError);
          }
        } catch (error) {
          onError(error);
        }
      }
    },
    recent: (limit) => primary.recent(limit),
    size: () => primary.size(),
  };
}

export interface WorkflowAuditFacts {
  readonly event: WorkflowAuditEvent;
  readonly outcome: WorkflowAuditRecord['outcome'];
  readonly requestId: string;
  readonly correlationId: string;
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly nodeId?: string;
  readonly nodeType?: WorkflowNodeType;
  readonly branchId?: string;
  readonly nodeExecutionId?: string;
  readonly executionRequestId?: string;
  readonly childAgentRunId?: string;
  readonly workflowApprovalId?: string;
  readonly state?: WorkflowRunState;
  readonly failure?: WorkflowFailureCode;
  readonly reason?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface WorkflowAuditWriter {
  record(facts: WorkflowAuditFacts): WorkflowAuditRecord;
  recent(limit: number): readonly WorkflowAuditRecord[];
  size(): number;
}

export function createWorkflowAuditWriter(deps: {
  readonly store: WorkflowAuditStore;
  readonly clock: Clock;
  readonly newAuditId: () => string;
}): WorkflowAuditWriter {
  return {
    record(facts) {
      const record: WorkflowAuditRecord = {
        workflowAuditId: deps.newAuditId(),
        recordedAt: deps.clock.isoNow(),
        event: facts.event,
        outcome: facts.outcome,
        requestId: facts.requestId,
        correlationId: facts.correlationId,
        workflowRunId: facts.workflowRunId,
        workflowId: facts.workflowId,
        workflowVersion: facts.workflowVersion,
        nodeId: facts.nodeId,
        nodeType: facts.nodeType,
        branchId: facts.branchId,
        nodeExecutionId: facts.nodeExecutionId,
        executionRequestId: facts.executionRequestId,
        childAgentRunId: facts.childAgentRunId,
        workflowApprovalId: facts.workflowApprovalId,
        organizationId: facts.organizationId,
        actorId: facts.actorId,
        state: facts.state,
        failure: facts.failure,
        reason: facts.reason?.slice(0, MAX_REASON),
        detail: boundWorkflowDetail(facts.detail ?? {}),
      };
      deps.store.append(record);
      return record;
    },
    recent: (limit) => deps.store.recent(limit),
    size: () => deps.store.size(),
  };
}

/**
 * Durable trail over the platform key-value store.
 *
 * `ai:workflow:audit:{yyyy-mm-dd}:{id}` — date-partitioned, so retention is a
 * prefix operation. Not tenant-prefixed, unlike run records: this trail is read
 * only by the platform operator surface, and the record carries its own
 * `organizationId` for the tenant-scoped filtering the service applies.
 */
export function createKvWorkflowAuditStore(options: {
  readonly write: (key: string, value: unknown) => Promise<void>;
  readonly retentionDays: number;
  readonly onError?: (error: unknown) => void;
}): WorkflowAuditStore {
  return {
    async append(record) {
      try {
        const day = record.recordedAt.slice(0, 10);
        await options.write(`ai:workflow:audit:${day}:${record.workflowAuditId}`, {
          ...record,
          _retentionDays: options.retentionDays,
          _schema: 'ai.workflow.audit.v1',
        });
      } catch (error) {
        options.onError?.(error);
      }
    },
    // A write-through store holds nothing to read back; the composite store answers
    // reads from the in-memory ring.
    recent: () => [],
    size: () => 0,
  };
}
