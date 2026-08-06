/**
 * Workflow approval gates (AI-01 Batch 3B).
 *
 * REUSE, NOT A SECOND GATE. Everything an approval has to guarantee — that it
 * survives a restart, that it cannot be spent twice, that authority is resolved
 * server-side, that expiry is derived on read and never becomes a yes — is
 * already implemented, certified and adversarially tested in
 * `agents/approvals/approvalGate.ts`, over the durable `AgentApprovalStore`.
 *
 * So a workflow approval IS an `AgentApprovalRequest`, in the same store, decided
 * through the same `ApprovalGate`. What this module adds is one thing the
 * certified gate cannot do: CREATE a request from a workflow node rather than
 * from an agent action. `ApprovalGate.request` takes an `AgentAction` and an
 * `AgentDefinition`, and a workflow approval node has neither — it has a node, an
 * impact summary and a list of approver roles the definition declared.
 *
 * WHY NOT WIDEN THE CERTIFIED GATE. Its `request` signature is what makes an
 * agent approval's authority provably come from the agent definition rather than
 * from the action asking for it. Adding a second shape to that function would
 * mean the property held for one caller and had to be re-argued for the other.
 * Constructing the record here, and routing every DECISION back through the
 * certified gate, keeps the single-use compare-and-swap — the part that actually
 * enforces anything — with exactly one implementation.
 *
 * THE FIELDS ARE MAPPED HONESTLY. `runId` carries the WORKFLOW run id, so the
 * operator queue and the tenant-scoped listing work unchanged. `actionId` is the
 * node execution id, so consuming an approval is still bound to one specific
 * thing. `requestingAgentId` carries `workflow:{workflowId}`, which is what
 * actually asked — writing a real agent id there would attribute a plan's
 * decision to an agent that never made it.
 */

import type { AgentApprovalRequest } from '../../agents/contracts/runtime.ts';
import type { AgentApprovalStore } from '../../agents/persistence/ports.ts';
import type { ApprovalGate } from '../../agents/approvals/approvalGate.ts';
import type { WorkflowApprovalNode } from '../contracts/workflow.ts';
import { WORKFLOW_BOUNDS } from '../contracts/workflow.ts';
import type { Clock } from '../../runtime/clock.ts';

export interface WorkflowApprovalRequestInput {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly organizationId: string;
  readonly node: WorkflowApprovalNode;
  /** Identity of this node execution. What the approval authorises, exactly. */
  readonly nodeExecutionId: string;
  readonly estimatedAdditionalTokens: number;
  readonly estimatedAdditionalCostMicroUsd: number;
}

export interface WorkflowApprovalGate {
  /** Open a gate. Persisted before the workflow run is parked. */
  request(input: WorkflowApprovalRequestInput): Promise<AgentApprovalRequest>;
  /** Every decision, consumption, read and expiry goes to the certified gate. */
  readonly gate: ApprovalGate;
}

export function createWorkflowApprovalGate(deps: {
  readonly store: AgentApprovalStore;
  readonly gate: ApprovalGate;
  readonly clock: Clock;
  readonly newApprovalId: () => string;
}): WorkflowApprovalGate {
  return {
    gate: deps.gate,

    async request(input) {
      const createdAtMs = deps.clock.now();
      const request: AgentApprovalRequest = {
        approvalId: deps.newApprovalId(),
        // The WORKFLOW run id. The operator queue lists approvals by run, and a
        // workflow gate belongs to the workflow run rather than to any one agent
        // run it may later start.
        runId: input.workflowRunId,
        actionId: input.nodeExecutionId,
        organizationId: input.organizationId,
        requestingAgentId: `workflow:${input.workflowId}`,
        // The nearest action type in the certified vocabulary, and an accurate
        // one: a workflow approval node proposes nothing except that a human
        // decide.
        actionType: 'request_approval',
        impactSummary: input.node.impactSummary.slice(0, WORKFLOW_BOUNDS.maxImpactSummary),
        dataAffected: (input.node.dataAffected ?? [])
          .slice(0, WORKFLOW_BOUNDS.maxDataAffected)
          .map((entry) => entry.slice(0, 120)),
        estimatedAdditionalTokens: Math.max(0, Math.floor(input.estimatedAdditionalTokens)),
        estimatedAdditionalCostMicroUsd: Math.max(
          0,
          Math.floor(input.estimatedAdditionalCostMicroUsd),
        ),
        reason: input.node.purpose,
        // From the WORKFLOW DEFINITION, never from anything at runtime. A plan
        // that could nominate its own approvers mid-run would be approving
        // itself with extra steps.
        authorizedApproverRoles: input.node.approverRoles,
        expiresAt: new Date(createdAtMs + input.node.expiresAfterMs).toISOString(),
        singleUse: true,
        createdAt: deps.clock.isoNow(),
        state: 'pending',
        approvalVersion: 1,
      };
      // `create` is insert-if-absent, so a duplicated id is a failure rather
      // than an overwrite of somebody else's pending decision.
      await deps.store.create(request);
      return request;
    },
  };
}
