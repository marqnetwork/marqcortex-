/**
 * Workflow runtime audit trail (AI-01 Batch 3B).
 *
 * A FOURTH trail, and the separation is the point:
 *
 *   observability/audit.ts        what the platform DID — one record per AI
 *                                 request through the control plane.
 *   admin/adminAudit.ts           what an ADMINISTRATOR changed.
 *   agents/observability/         what an AGENT proposed and what the agent
 *     agentAudit.ts               orchestrator decided about it.
 *   this module                   what the PLAN decided — which wave ran, which
 *                                 condition took which branch, which join
 *                                 waited, which node was skipped and why.
 *
 * The fourth question is not answerable from the other three. An agent run
 * appears in the agent trail as a run; what that trail cannot say is that the
 * run existed because node `draft` became ready when node `intake` published
 * `intake.confident=true`, or that node `review` never ran because a quorum of
 * two was never reached. "Why did the workflow do that?" is a question about the
 * plan, and this is the record that answers it.
 *
 * JOINABLE BY CONSTRUCTION. Every record carries `requestId`, `correlationId`,
 * `workflowRunId` and `organizationId`, and a node record additionally carries
 * the `agentRunId` it drove. So one correlation id walks from the HTTP request,
 * through the plan, into an agent run, into the execution trail, and out to the
 * provider attempt — with no joins to reconstruct.
 *
 * WHAT IS DELIBERATELY NOT STORED: node inputs, node outputs, fact VALUES and
 * agent completions. Fact KEYS are recorded because a key is the plan's own
 * vocabulary; a value is client data. Digests of everything else, and nothing
 * more — the same decision Batch 1 made, for the same reason.
 *
 * APPEND ONLY. `append`, `recent`, `size`. No update, no delete, no purge, and
 * the boundary scan asserts the absence of a mutation method on the source.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { WorkflowFailureCode } from '../contracts/failures.ts';
import type { WorkflowNodeState, WorkflowRunState } from '../contracts/runtime.ts';

export const WORKFLOW_AUDIT_EVENT = {
  runCreated: 'ai.workflow.run.created',
  runPlanned: 'ai.workflow.run.planned',
  runStateChanged: 'ai.workflow.run.state_changed',
  waveStarted: 'ai.workflow.wave.started',
  waveCompleted: 'ai.workflow.wave.completed',
  nodeAdmitted: 'ai.workflow.node.admitted',
  nodeSkipped: 'ai.workflow.node.skipped',
  nodeStarted: 'ai.workflow.node.started',
  nodeSucceeded: 'ai.workflow.node.succeeded',
  nodeFailed: 'ai.workflow.node.failed',
  factPublished: 'ai.workflow.fact.published',
  approvalRequested: 'ai.workflow.approval.requested',
  approvalDecided: 'ai.workflow.approval.decided',
  budgetDenied: 'ai.workflow.budget.denied',
  limitReached: 'ai.workflow.limit.reached',
  checkpointWritten: 'ai.workflow.checkpoint.written',
  optimizationRecorded: 'ai.workflow.optimization.recorded',
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
  readonly outcome: 'allowed' | 'denied' | 'executed' | 'failed' | 'recorded' | 'skipped';

  readonly requestId: string;
  readonly correlationId: string;
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly organizationId: string;
  readonly actorId: string;

  readonly nodeId?: string;
  readonly wave?: number;
  /** The agent run this node drove. The join to the agent runtime trail. */
  readonly agentRunId?: string;
  readonly approvalId?: string;

  readonly state?: WorkflowRunState;
  readonly nodeState?: WorkflowNodeState;
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
 * receive the record, and the failure surfaces through `onError` rather than
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
  readonly wave?: number;
  readonly agentRunId?: string;
  readonly approvalId?: string;
  readonly state?: WorkflowRunState;
  readonly nodeState?: WorkflowNodeState;
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
        organizationId: facts.organizationId,
        actorId: facts.actorId,
        nodeId: facts.nodeId,
        wave: facts.wave,
        agentRunId: facts.agentRunId,
        approvalId: facts.approvalId,
        state: facts.state,
        nodeState: facts.nodeState,
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
 * prefix operation. Not tenant-prefixed, like the agent trail: it is read only
 * by the platform operator surface, and each record carries its own
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
    // A write-through store holds nothing to read back; the composite store
    // answers reads from the in-memory ring.
    recent: () => [],
    size: () => 0,
  };
}
