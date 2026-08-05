/**
 * Workflow approval gates (AI-01 Batch 3B).
 *
 * A workflow approval is a durable object with a state machine of its own, not a
 * flag on a run. That is what makes the five properties below achievable.
 *
 *   IT SURVIVES A RESTART. The request is persisted before the run is parked, and
 *   the decision is persisted before the run is released. An isolate that dies
 *   between the two loses nothing: the approval is still pending, the run is still
 *   waiting, and the operator queue still shows it.
 *
 *   IT CANNOT BE REUSED. `singleUse` is not advisory. An approval moves
 *   pending → approved → consumed, each step an optimistic-concurrency write, so
 *   two node executions cannot spend one approval even if they race — the second
 *   compare-and-swap loses and the second execution is refused.
 *
 *   IT IS CHECKPOINT-BOUND. The request records the checkpoint version it was
 *   raised against. A run that has moved past that checkpoint while a human was
 *   deciding does NOT execute the approved node: the approval authorised an action
 *   against a state of the world that has since changed, and acting on it anyway
 *   is the failure mode this field exists to prevent.
 *
 *   AUTHORITY IS RESOLVED SERVER-SIDE. The approver's roles come from the
 *   authenticated subject, and the roles that may decide come from the NODE's
 *   approval rule in the definition. Nothing a caller sends influences either.
 *
 *   THERE IS NO AUTOMATIC APPROVAL. No timeout that approves, no configuration
 *   that bypasses, no "approve if the estimated cost is small" shortcut. An
 *   approval that expires makes the run expire; it never becomes a yes.
 *
 * TENANT SCOPE IS CHECKED TWICE, deliberately. The store is keyed by organization,
 * so a cross-tenant read cannot even form a key — and the decision path checks the
 * approval's organization against the decider's anyway, because "the key was
 * right" and "this person may act on it" are different claims and only one of them
 * is about authorization.
 */

import type { Clock } from '../../runtime/clock.ts';
import type { WorkflowNodeApprovalRule } from '../contracts/workflow.ts';
import type { WorkflowApprovalRequest, WorkflowApprovalState } from '../contracts/runtime.ts';
import { WORKFLOW_APPROVAL_BOUNDS } from '../contracts/runtime.ts';
import type { WorkflowApprovalStore } from '../persistence/ports.ts';
import { workflowFailure } from '../contracts/failures.ts';

export interface WorkflowApprovalGateDependencies {
  readonly store: WorkflowApprovalStore;
  readonly clock: Clock;
  readonly newApprovalId: () => string;
}

export interface CreateWorkflowApprovalInput {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly organizationId: string;
  readonly nodeId: string;
  readonly branchId?: string;
  readonly requestedBy: string;
  readonly rule: WorkflowNodeApprovalRule;
  readonly proposedAction: string;
  readonly approvalReason: string;
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
  /** The checkpoint this approval is bound to. See the module header. */
  readonly checkpointVersion: number;
}

export interface WorkflowApprovalDecisionInput {
  readonly organizationId: string;
  readonly workflowApprovalId: string;
  readonly decision: 'approve' | 'reject';
  readonly reason: string;
  readonly deciderId: string;
  /** Roles resolved server-side from the authenticated subject. */
  readonly deciderRoles: readonly string[];
}

export interface WorkflowApprovalGate {
  /** Create a pending request. Persisted before the run is parked. */
  request(input: CreateWorkflowApprovalInput): Promise<WorkflowApprovalRequest>;
  /** Record a decision. Refuses a stale, expired or unauthorised one. */
  decide(input: WorkflowApprovalDecisionInput): Promise<WorkflowApprovalRequest>;
  /**
   * Spend an approved request on its node. Refuses anything that is not
   * `approved`, not for this node, already consumed, or bound to a checkpoint the
   * run has moved past.
   */
  consume(
    organizationId: string,
    workflowApprovalId: string,
    input: { readonly nodeId: string; readonly checkpointVersion: number },
  ): Promise<WorkflowApprovalRequest>;
  get(
    organizationId: string,
    workflowApprovalId: string,
  ): Promise<WorkflowApprovalRequest | undefined>;
  /** The operator queue for one organization. */
  pending(organizationId: string, limit?: number): Promise<readonly WorkflowApprovalRequest[]>;
  /**
   * Mark an overdue request expired, durably.
   *
   * Called when a run is advanced or read. Expiry is derived from the stamp rather
   * than from a timer: a sweeper that has to be scheduled is a sweeper that is not
   * running in the deployment where it matters.
   */
  expireIfDue(request: WorkflowApprovalRequest): Promise<WorkflowApprovalRequest>;
}

export function createWorkflowApprovalGate(
  deps: WorkflowApprovalGateDependencies,
): WorkflowApprovalGate {
  const { store, clock } = deps;

  function isDue(request: WorkflowApprovalRequest, nowMs: number): boolean {
    const expiresMs = Date.parse(request.expiresAt);
    // An unreadable stamp is NOT treated as expired. Guessing would turn a corrupt
    // field into a run that dies for no reason; the run's own deadline still bounds
    // it, so the conservative direction is safe.
    return Number.isFinite(expiresMs) && expiresMs <= nowMs;
  }

  async function expire(request: WorkflowApprovalRequest): Promise<WorkflowApprovalRequest> {
    const expired: WorkflowApprovalRequest = {
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
      if (input.rule.approverRoles.length === 0) {
        // The registry already refuses this at registration. Refusing again here
        // means a definition that reached the engine through some other path
        // cannot create an approval nobody can grant — which would be a run that
        // can only expire.
        throw workflowFailure(
          'invalid_node',
          'That node requires an approval nobody is authorised to decide.',
          {
            workflowRunId: input.workflowRunId,
            workflowId: input.workflowId,
            nodeId: input.nodeId,
            diagnostics: 'approval rule declares no approver roles',
          },
        );
      }

      const createdAtMs = clock.now();
      const request: WorkflowApprovalRequest = {
        workflowApprovalId: deps.newApprovalId(),
        workflowRunId: input.workflowRunId,
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
        organizationId: input.organizationId,
        requestedBy: input.requestedBy,
        proposedAction: input.proposedAction.slice(0, WORKFLOW_APPROVAL_BOUNDS.impactSummary.max),
        impactSummary: input.rule.impactSummary.slice(
          0,
          WORKFLOW_APPROVAL_BOUNDS.impactSummary.max,
        ),
        dataAffected: input.rule.dataAffected
          .slice(0, WORKFLOW_APPROVAL_BOUNDS.maxDataAffected)
          .map((entry) => entry.slice(0, 120)),
        estimatedAdditionalTokens: Math.max(0, Math.floor(input.estimatedAdditionalTokens)),
        estimatedAdditionalCostMicroUsd: Math.max(
          0,
          Math.floor(input.estimatedAdditionalCostMicroUsd),
        ),
        approvalReason: input.approvalReason.slice(0, WORKFLOW_APPROVAL_BOUNDS.decisionReason.max),
        // From the NODE's rule in the DEFINITION, never from a caller. A workflow
        // that could nominate its own approvers would be approving itself with
        // extra steps.
        authorizedRoles: input.rule.approverRoles.map((role) => role.toLowerCase()),
        expiresAt: new Date(createdAtMs + input.rule.expiresAfterMs).toISOString(),
        singleUse: true,
        checkpointVersion: input.checkpointVersion,
        createdAt: clock.isoNow(),
        state: 'pending',
        // Written at version 1; version 0 is the store's way of saying "nothing is
        // here", and no stored approval ever carries it.
        approvalVersion: 1,
      };
      await store.create(request);
      return request;
    },

    async decide(input) {
      const reason = input.reason?.trim() ?? '';
      if (
        reason.length < WORKFLOW_APPROVAL_BOUNDS.decisionReason.min ||
        reason.length > WORKFLOW_APPROVAL_BOUNDS.decisionReason.max
      ) {
        throw workflowFailure('invalid_node', 'An approval decision needs a reason.', {
          diagnostics: `reason length ${reason.length} is outside the permitted range`,
        });
      }

      const stored = await store.load(input.organizationId, input.workflowApprovalId);
      if (!stored) {
        throw workflowFailure(
          'workflow_run_not_found',
          'That approval request could not be found.',
          {
            diagnostics: `approval ${input.workflowApprovalId} not found for ${input.organizationId}`,
          },
        );
      }
      // The store is already tenant-keyed. Checking again costs nothing and means a
      // future store that is not keyed cannot silently weaken this.
      if (stored.organizationId !== input.organizationId) {
        throw workflowFailure(
          'tenant_isolation_violation',
          'That approval belongs to another organization.',
          {
            workflowRunId: stored.workflowRunId,
            diagnostics: 'approval organization mismatch',
          },
        );
      }

      const authorised = input.deciderRoles.some((role) =>
        stored.authorizedRoles.includes(role.toLowerCase()),
      );
      if (!authorised) {
        throw workflowFailure('unauthorized', 'Your role may not decide this approval.', {
          workflowRunId: stored.workflowRunId,
          nodeId: stored.nodeId,
          diagnostics:
            `decider=${input.deciderId} roles=${input.deciderRoles.join(',') || 'none'} ` +
            `required=${stored.authorizedRoles.join(',')}`,
        });
      }

      if (isDue(stored, clock.now())) {
        // Persist the expiry BEFORE refusing, so the queue does not keep offering a
        // decision that can no longer be made.
        const expired = await expire(stored);
        throw workflowFailure('approval_expired', 'That approval request has expired.', {
          workflowRunId: expired.workflowRunId,
          nodeId: expired.nodeId,
          diagnostics: `approval ${expired.workflowApprovalId} expired at ${expired.expiresAt}`,
        });
      }

      if (stored.state !== 'pending') {
        throw workflowFailure('invalid_node', 'That approval has already been decided.', {
          workflowRunId: stored.workflowRunId,
          nodeId: stored.nodeId,
          diagnostics: `approval ${stored.workflowApprovalId} is ${stored.state}`,
        });
      }

      const decided: WorkflowApprovalRequest = {
        ...stored,
        state: input.decision === 'approve' ? 'approved' : 'rejected',
        decidedAt: clock.isoNow(),
        decidedBy: input.deciderId,
        decisionReason: reason,
        approvalVersion: stored.approvalVersion + 1,
      };
      // A lost compare-and-swap here is two people deciding at once. The store
      // raises `stale_workflow_version`; the caller re-reads and finds the decision
      // that won, which is the correct outcome — not a merge.
      await store.save(decided, stored.approvalVersion);
      return decided;
    },

    async consume(organizationId, workflowApprovalId, input) {
      const stored = await store.load(organizationId, workflowApprovalId);
      if (!stored) {
        throw workflowFailure('approval_required', 'That approval could not be found.', {
          diagnostics: `approval ${workflowApprovalId} not found`,
        });
      }
      if (stored.nodeId !== input.nodeId) {
        throw workflowFailure('approval_required', 'That approval does not authorise this node.', {
          workflowRunId: stored.workflowRunId,
          nodeId: input.nodeId,
          diagnostics: `approval ${workflowApprovalId} authorises ${stored.nodeId}, not ${input.nodeId}`,
        });
      }
      if (isDue(stored, clock.now())) {
        const expired = await expire(stored);
        throw workflowFailure('approval_expired', 'That approval expired before it was used.', {
          workflowRunId: expired.workflowRunId,
          nodeId: expired.nodeId,
          diagnostics: `approval ${workflowApprovalId} expired at ${expired.expiresAt}`,
        });
      }
      if (stored.state === 'rejected') {
        throw workflowFailure('approval_rejected', 'That node was rejected.', {
          workflowRunId: stored.workflowRunId,
          nodeId: stored.nodeId,
          diagnostics: `approval ${workflowApprovalId} was rejected`,
        });
      }
      if (stored.state !== 'approved') {
        throw workflowFailure('approval_required', 'That node has not been approved.', {
          workflowRunId: stored.workflowRunId,
          nodeId: stored.nodeId,
          diagnostics: `approval ${workflowApprovalId} is ${stored.state}`,
        });
      }
      // THE CHECKPOINT BINDING. An approval granted against checkpoint 7 does not
      // authorise a node execution at checkpoint 9: the run moved on while a human
      // was deciding, and the state the decision was made about no longer exists.
      if (stored.checkpointVersion !== input.checkpointVersion) {
        throw workflowFailure(
          'checkpoint_conflict',
          'The approved step no longer matches this run.',
          {
            workflowRunId: stored.workflowRunId,
            nodeId: stored.nodeId,
            diagnostics:
              `approval checkpoint ${stored.checkpointVersion}, run checkpoint ` +
              `${input.checkpointVersion}`,
          },
        );
      }

      const consumed: WorkflowApprovalRequest = {
        ...stored,
        state: 'consumed',
        consumedAt: clock.isoNow(),
        approvalVersion: stored.approvalVersion + 1,
      };
      await store.save(consumed, stored.approvalVersion);
      return consumed;
    },

    get: (organizationId, workflowApprovalId) => store.load(organizationId, workflowApprovalId),

    pending: (organizationId, limit) =>
      store.list({ organizationId, pendingOnly: true, limit }),

    async expireIfDue(request) {
      if (request.state !== 'pending' || !isDue(request, clock.now())) return request;
      return expire(request);
    },
  };
}

/** Approval states from which a run can still be released. */
export function isWorkflowApprovalDecidable(state: WorkflowApprovalState): boolean {
  return state === 'pending';
}
