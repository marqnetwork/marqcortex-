/**
 * Human approval gates (AI-01 Batch 3A).
 *
 * An approval is a durable object with a state machine of its own, not a flag
 * on a run. That is what makes the four properties below achievable:
 *
 *   IT SURVIVES A RESTART. The request is persisted before the run is parked,
 *   and the decision is persisted before the run is released. An isolate that
 *   dies between the two loses nothing: the approval is still pending, the run
 *   is still waiting, and the operator queue still shows it.
 *
 *   IT CANNOT BE REUSED. `singleUse` is not advisory. An approval moves
 *   pending → approved → consumed, each step an optimistic-concurrency write,
 *   so two actions cannot spend one approval even if they race — the second
 *   compare-and-swap loses and the second action is refused.
 *
 *   AUTHORITY IS RESOLVED SERVER-SIDE. The approver's roles come from the
 *   authenticated subject, and the roles that may decide come from the AGENT
 *   DEFINITION. Nothing a caller sends influences either. A caller who is not
 *   authorised gets `unauthorized` and an audit record, not a silent no-op.
 *
 *   THERE IS NO AUTOMATIC APPROVAL. No timeout that approves, no configuration
 *   that bypasses, no "approve if the estimated cost is small" shortcut. An
 *   approval that expires makes the run expire; it never becomes a yes.
 *
 * TENANT SCOPE IS CHECKED TWICE, deliberately. The store is keyed by
 * organization, so a cross-tenant read cannot even form a key — and the
 * decision path checks the approval's organization against the decider's
 * anyway, because "the key was right" and "this person may act on it" are
 * different claims and only one of them is about authorization.
 */

import type { AgentDefinition } from '../contracts/agent.ts';
import type { AgentAction } from '../contracts/actions.ts';
import type { AgentApprovalRequest, AgentApprovalState } from '../contracts/runtime.ts';
import { APPROVAL_BOUNDS } from '../contracts/runtime.ts';
import type { AgentApprovalStore } from '../persistence/ports.ts';
import { agentFailure } from '../contracts/failures.ts';
import type { Clock } from '../../runtime/clock.ts';

export interface ApprovalGateDependencies {
  readonly store: AgentApprovalStore;
  readonly clock: Clock;
  readonly newApprovalId: () => string;
}

export interface CreateApprovalInput {
  readonly action: AgentAction;
  readonly agent: AgentDefinition;
  readonly runId: string;
  readonly organizationId: string;
  readonly impactSummary: string;
  readonly dataAffected: readonly string[];
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
}

export interface ApprovalDecisionInput {
  readonly organizationId: string;
  readonly approvalId: string;
  readonly decision: 'approve' | 'reject';
  readonly reason: string;
  readonly deciderId: string;
  /** Roles resolved server-side from the authenticated subject. */
  readonly deciderRoles: readonly string[];
}

export interface ApprovalGate {
  /** Create a pending request. Persisted before the run is parked. */
  request(input: CreateApprovalInput): Promise<AgentApprovalRequest>;
  /** Record a decision. Refuses a stale, expired or unauthorised one. */
  decide(input: ApprovalDecisionInput): Promise<AgentApprovalRequest>;
  /**
   * Spend an approved request on its action. Refuses anything that is not
   * `approved`, not for this action, or already consumed.
   */
  consume(
    organizationId: string,
    approvalId: string,
    actionId: string,
  ): Promise<AgentApprovalRequest>;
  /** Read one, tenant-scoped. */
  get(organizationId: string, approvalId: string): Promise<AgentApprovalRequest | undefined>;
  /** The operator queue for one organization. */
  pending(organizationId: string, limit?: number): Promise<readonly AgentApprovalRequest[]>;
  /**
   * Mark an overdue request expired, durably.
   *
   * Called when a run is advanced or read. Expiry is derived from the stamp
   * rather than from a timer: a sweeper that has to be scheduled is a sweeper
   * that is not running in the deployment where it matters.
   */
  expireIfDue(request: AgentApprovalRequest): Promise<AgentApprovalRequest>;
}

const MAX_IMPACT_SUMMARY = 500;
const MAX_DATA_AFFECTED = 12;

export function createApprovalGate(deps: ApprovalGateDependencies): ApprovalGate {
  const { store, clock } = deps;

  function isDue(request: AgentApprovalRequest, nowMs: number): boolean {
    const expiresMs = Date.parse(request.expiresAt);
    // An unreadable stamp is NOT treated as expired. Guessing would turn a
    // corrupt field into a run that dies for no reason; the run's own deadline
    // still bounds it, so the conservative direction is safe.
    return Number.isFinite(expiresMs) && expiresMs <= nowMs;
  }

  async function expire(request: AgentApprovalRequest): Promise<AgentApprovalRequest> {
    const expired: AgentApprovalRequest = {
      ...request,
      state: 'expired',
      decidedAt: clock.isoNow(),
      approvalVersion: request.approvalVersion + 1,
    };
    await store.save(expired, request.approvalVersion);
    return expired;
  }

  return {
    async request(input) {
      const createdAtMs = clock.now();
      const request: AgentApprovalRequest = {
        approvalId: deps.newApprovalId(),
        runId: input.runId,
        actionId: input.action.actionId,
        organizationId: input.organizationId,
        requestingAgentId: input.agent.agentId,
        actionType: input.action.actionType,
        impactSummary: input.impactSummary.slice(0, MAX_IMPACT_SUMMARY),
        dataAffected: input.dataAffected.slice(0, MAX_DATA_AFFECTED).map((entry) =>
          entry.slice(0, 120),
        ),
        estimatedAdditionalTokens: Math.max(0, Math.floor(input.estimatedAdditionalTokens)),
        estimatedAdditionalCostMicroUsd: Math.max(
          0,
          Math.floor(input.estimatedAdditionalCostMicroUsd),
        ),
        reason: input.action.reason,
        // From the AGENT DEFINITION, never from the action. An agent that could
        // nominate its own approvers would be approving itself with extra steps.
        authorizedApproverRoles: input.agent.approvals.approverRoles,
        expiresAt: new Date(createdAtMs + input.agent.approvals.expiresAfterMs).toISOString(),
        singleUse: true,
        createdAt: clock.isoNow(),
        state: 'pending',
        approvalVersion: 1,
      };
      // `create` is insert-if-absent, so a duplicated id is a failure rather
      // than an overwrite of somebody else's pending decision. The record is
      // written at version 1; version 0 is the store's way of saying "nothing
      // is here", and no stored approval ever carries it.
      await store.create(request);
      return request;
    },

    async decide(input) {
      const reason = input.reason?.trim() ?? '';
      if (
        reason.length < APPROVAL_BOUNDS.decisionReason.min ||
        reason.length > APPROVAL_BOUNDS.decisionReason.max
      ) {
        throw agentFailure('invalid_action', 'An approval decision needs a reason.', {
          diagnostics: `reason length ${reason.length} is outside the permitted range`,
        });
      }

      const stored = await store.load(input.organizationId, input.approvalId);
      if (!stored) {
        throw agentFailure('run_not_found', 'That approval request could not be found.', {
          diagnostics: `approval ${input.approvalId} not found for ${input.organizationId}`,
        });
      }
      // The store is already tenant-keyed. Checking again costs nothing and
      // means a future store that is not keyed cannot silently weaken this.
      if (stored.organizationId !== input.organizationId) {
        throw agentFailure(
          'tenant_isolation_violation',
          'That approval belongs to another organization.',
          { runId: stored.runId, diagnostics: 'approval organization mismatch' },
        );
      }

      const authorised = input.deciderRoles.some((role) =>
        stored.authorizedApproverRoles.includes(role.toLowerCase()),
      );
      if (!authorised) {
        throw agentFailure('unauthorized', 'Your role may not decide this approval.', {
          runId: stored.runId,
          diagnostics:
            `decider=${input.deciderId} roles=${input.deciderRoles.join(',') || 'none'} ` +
            `required=${stored.authorizedApproverRoles.join(',')}`,
        });
      }

      if (isDue(stored, clock.now())) {
        // Persist the expiry before refusing, so the queue does not keep
        // offering a decision that can no longer be made.
        const expired = await expire(stored);
        throw agentFailure('approval_expired', 'That approval request has expired.', {
          runId: expired.runId,
          diagnostics: `approval ${expired.approvalId} expired at ${expired.expiresAt}`,
        });
      }

      if (stored.state !== 'pending') {
        throw agentFailure('invalid_action', 'That approval has already been decided.', {
          runId: stored.runId,
          diagnostics: `approval ${stored.approvalId} is ${stored.state}`,
        });
      }

      const decided: AgentApprovalRequest = {
        ...stored,
        state: input.decision === 'approve' ? 'approved' : 'rejected',
        decidedAt: clock.isoNow(),
        decidedBy: input.deciderId,
        decisionReason: reason,
        approvalVersion: stored.approvalVersion + 1,
      };
      // A lost compare-and-swap here is two people deciding at once. The store
      // raises `stale_run_version`; the caller re-reads and finds the decision
      // that won, which is the correct outcome — not a merge.
      await store.save(decided, stored.approvalVersion);
      return decided;
    },

    async consume(organizationId, approvalId, actionId) {
      const stored = await store.load(organizationId, approvalId);
      if (!stored) {
        throw agentFailure('approval_required', 'That approval could not be found.', {
          diagnostics: `approval ${approvalId} not found`,
        });
      }
      if (stored.actionId !== actionId) {
        throw agentFailure('approval_required', 'That approval does not authorise this action.', {
          runId: stored.runId,
          diagnostics: `approval ${approvalId} authorises ${stored.actionId}, not ${actionId}`,
        });
      }
      if (isDue(stored, clock.now())) {
        const expired = await expire(stored);
        throw agentFailure('approval_expired', 'That approval expired before it was used.', {
          runId: expired.runId,
          diagnostics: `approval ${approvalId} expired at ${expired.expiresAt}`,
        });
      }
      if (stored.state === 'rejected') {
        throw agentFailure('approval_rejected', 'That action was rejected.', {
          runId: stored.runId,
          diagnostics: `approval ${approvalId} was rejected`,
        });
      }
      if (stored.state !== 'approved') {
        throw agentFailure('approval_required', 'That action has not been approved.', {
          runId: stored.runId,
          diagnostics: `approval ${approvalId} is ${stored.state}`,
        });
      }

      const consumed: AgentApprovalRequest = {
        ...stored,
        state: 'consumed',
        consumedAt: clock.isoNow(),
        approvalVersion: stored.approvalVersion + 1,
      };
      await store.save(consumed, stored.approvalVersion);
      return consumed;
    },

    get: (organizationId, approvalId) => store.load(organizationId, approvalId),

    pending: (organizationId, limit) =>
      store.list({ organizationId, pendingOnly: true, limit }),

    async expireIfDue(request) {
      if (request.state !== 'pending' || !isDue(request, clock.now())) return request;
      return expire(request);
    },
  };
}

/** Approval states from which a run can still be released. */
export function isDecidable(state: AgentApprovalState): boolean {
  return state === 'pending';
}
