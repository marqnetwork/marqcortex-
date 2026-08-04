/**
 * Agent runtime audit trail (AI-01 Batch 3A).
 *
 * A THIRD trail, alongside the two that already exist, and the separation is
 * the point:
 *
 *   observability/audit.ts        what the platform DID — one record per AI
 *                                 request through the control plane.
 *   admin/adminAudit.ts           what an ADMINISTRATOR changed.
 *   this module                   what an AGENT proposed and what the
 *                                 ORCHESTRATOR decided about it.
 *
 * The third question is not answerable from the first two. A model step appears
 * in the execution trail as a request; what it does not say is which agent
 * wanted it, which limit nearly stopped it, which approval unblocked it, or
 * which of four proposals the orchestrator refused before this one. That is the
 * record a reviewer needs when the question is "why did the agent do that?".
 *
 * JOINABLE BY CONSTRUCTION. Every record carries `requestId`, `correlationId`,
 * `runId`, `stepId`, `actionId`, `attemptId`, `organizationId` and `actorId`,
 * and a model step additionally carries the control plane's own `requestId`. So
 * a single correlation id walks from the HTTP request, through the run, into
 * the execution trail, and out to the provider attempt — with no joins to
 * reconstruct and no ambiguity about which model call belonged to which step.
 *
 * WHAT IS DELIBERATELY NOT STORED: prompts, completions, tool payloads, handoff
 * payloads and agent progress. Digests of all of them, and nothing else. The
 * same decision Batch 1 made, for the same reason — an audit store that
 * accumulates client business data is a liability that grows by itself.
 *
 * APPEND ONLY. `append`, `recent`, `size`. No update, no delete, no purge. A
 * trail an operator can edit proves nothing about operators, and the boundary
 * scan asserts the absence of a mutation method on the source.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { AgentActionType } from '../contracts/actions.ts';
import type { AgentFailureCode } from '../contracts/failures.ts';
import type { AgentRunState } from '../contracts/runtime.ts';

export const AGENT_AUDIT_EVENT = {
  runCreated: 'ai.agent.run.created',
  runStateChanged: 'ai.agent.run.state_changed',
  agentSelected: 'ai.agent.selected',
  actionProposed: 'ai.agent.action.proposed',
  actionDecided: 'ai.agent.action.decided',
  modelRouted: 'ai.agent.model.routed',
  modelExecuted: 'ai.agent.model.executed',
  toolRequested: 'ai.agent.tool.requested',
  toolExecuted: 'ai.agent.tool.executed',
  handoff: 'ai.agent.handoff',
  approvalRequested: 'ai.agent.approval.requested',
  approvalDecided: 'ai.agent.approval.decided',
  tokenEstimated: 'ai.agent.tokens.estimated',
  tokenReconciled: 'ai.agent.tokens.reconciled',
  costEstimated: 'ai.agent.cost.estimated',
  costReconciled: 'ai.agent.cost.reconciled',
  budgetDenied: 'ai.agent.budget.denied',
  retryScheduled: 'ai.agent.retry.scheduled',
  limitReached: 'ai.agent.limit.reached',
  checkpointWritten: 'ai.agent.checkpoint.written',
  runTerminated: 'ai.agent.run.terminated',
} as const;

export type AgentAuditEvent = (typeof AGENT_AUDIT_EVENT)[keyof typeof AGENT_AUDIT_EVENT];

/** Bounded scalars. Anything larger belongs on the run record, not here. */
export type AgentAuditDetail = Readonly<Record<string, string | number | boolean>>;

export interface AgentAuditRecord {
  readonly agentAuditId: string;
  readonly recordedAt: string;
  readonly event: AgentAuditEvent;
  readonly outcome: 'allowed' | 'denied' | 'executed' | 'failed' | 'recorded';

  // Trace identity — the whole point of the record.
  readonly requestId: string;
  readonly correlationId: string;
  readonly runId: string;
  readonly stepId?: string;
  readonly actionId?: string;
  /** Attempt within a step. Distinguishes a retry from a fresh step. */
  readonly attemptId?: string;
  /** Control plane request id for a model step. The join to the AI trail. */
  readonly executionRequestId?: string;

  readonly organizationId: string;
  readonly actorId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly workflowId?: string;

  readonly state?: AgentRunState;
  readonly actionType?: AgentActionType;
  readonly failure?: AgentFailureCode;
  /** Caller-safe reason. Never a provider message or a storage message. */
  readonly reason?: string;
  readonly detail: AgentAuditDetail;
}

export interface AgentAuditStore {
  /** Persist one record. Must not throw — failures are the store's problem. */
  append(record: AgentAuditRecord): void | Promise<void>;
  recent(limit: number): readonly AgentAuditRecord[];
  size(): number;
}

const MAX_DETAIL_ENTRIES = 24;
const MAX_DETAIL_STRING = 200;
const MAX_REASON = 300;

/** Bound whatever a caller offers as detail. Never throws. */
export function boundDetail(values: Readonly<Record<string, unknown>>): AgentAuditDetail {
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
export function createMemoryAgentAuditStore(capacity: number): AgentAuditStore {
  const records: AgentAuditRecord[] = [];
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
 * Write to several stores. A failing durable store is isolated: the others
 * still receive the record, and the failure is surfaced through `onError`
 * rather than propagating into a run.
 */
export function createCompositeAgentAuditStore(
  primary: AgentAuditStore,
  secondaries: readonly AgentAuditStore[],
  onError: (error: unknown) => void,
): AgentAuditStore {
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

export interface AgentAuditFacts {
  readonly event: AgentAuditEvent;
  readonly outcome: AgentAuditRecord['outcome'];
  readonly requestId: string;
  readonly correlationId: string;
  readonly runId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly stepId?: string;
  readonly actionId?: string;
  readonly attemptId?: string;
  readonly executionRequestId?: string;
  readonly workflowId?: string;
  readonly state?: AgentRunState;
  readonly actionType?: AgentActionType;
  readonly failure?: AgentFailureCode;
  readonly reason?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface AgentAuditWriter {
  record(facts: AgentAuditFacts): AgentAuditRecord;
  recent(limit: number): readonly AgentAuditRecord[];
  size(): number;
}

export function createAgentAuditWriter(deps: {
  readonly store: AgentAuditStore;
  readonly clock: Clock;
  readonly newAuditId: () => string;
}): AgentAuditWriter {
  return {
    record(facts) {
      const record: AgentAuditRecord = {
        agentAuditId: deps.newAuditId(),
        recordedAt: deps.clock.isoNow(),
        event: facts.event,
        outcome: facts.outcome,
        requestId: facts.requestId,
        correlationId: facts.correlationId,
        runId: facts.runId,
        stepId: facts.stepId,
        actionId: facts.actionId,
        attemptId: facts.attemptId,
        executionRequestId: facts.executionRequestId,
        organizationId: facts.organizationId,
        actorId: facts.actorId,
        agentId: facts.agentId,
        agentVersion: facts.agentVersion,
        workflowId: facts.workflowId,
        state: facts.state,
        actionType: facts.actionType,
        failure: facts.failure,
        reason: facts.reason?.slice(0, MAX_REASON),
        detail: boundDetail(facts.detail ?? {}),
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
 * `ai:agent:audit:{yyyy-mm-dd}:{id}` — date-partitioned, so retention is a
 * prefix operation. Not tenant-prefixed, unlike run records: this trail is read
 * only by the platform operator surface, and the record carries its own
 * `organizationId` for the tenant-scoped filtering the service applies.
 */
export function createKvAgentAuditStore(options: {
  readonly write: (key: string, value: unknown) => Promise<void>;
  readonly retentionDays: number;
  readonly onError?: (error: unknown) => void;
}): AgentAuditStore {
  return {
    async append(record) {
      try {
        const day = record.recordedAt.slice(0, 10);
        await options.write(`ai:agent:audit:${day}:${record.agentAuditId}`, {
          ...record,
          _retentionDays: options.retentionDays,
          _schema: 'ai.agent.audit.v1',
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
