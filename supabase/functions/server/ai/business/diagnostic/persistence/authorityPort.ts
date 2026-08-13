/**
 * The approval-authority port (Part 7B, Phase 3).
 *
 * WHAT A COMMIT NEEDS TO KNOW, AND WHERE IT IS ALLOWED TO LEARN IT.
 *
 * `tool.diagnostic.commit_review_outcome` has to answer two questions before it
 * writes anything, and neither answer may come from its own input:
 *
 *   1. Is this agent run a NODE OF A WORKFLOW RUN, and which one?
 *   2. Does that workflow run carry a real, granted, unexpired, unspent
 *      approval for the node that authorises a commit?
 *
 * The first question is the load-bearing one. Its answer comes from
 * `WorkflowRunRecord.childAgentRunIds`, which the WORKFLOW ENGINE writes when it
 * creates a child run and which nothing on the agent side can influence: an
 * agent cannot add itself to a list it cannot reach. A direct agent run — one a
 * person started against the agent runtime, outside any workflow — appears in no
 * such list, so the lookup returns nothing and the commit is refused. That is
 * the whole of the "a direct agent run cannot commit" guarantee, and it is
 * structural rather than a rule the agent is asked to follow.
 *
 * ── WHY A PORT AND NOT THE STORES DIRECTLY ─────────────────────────────────
 *
 * The tools take this narrow interface, not a `WorkflowRunStore` and not the
 * approval gate. Three reasons, and the third is the one that matters:
 *
 *   The tool needs two reads and no writes, and an interface that cannot write
 *   is a stronger statement than a rule saying it does not.
 *
 *   A test can supply a hostile implementation — an approval that claims a role
 *   it was never granted, a run that claims a child it never created — and prove
 *   the tool still refuses.
 *
 *   The diagnostic capability never holds a workflow orchestrator, an approval
 *   gate or a run store. It reads two record shapes. A capability that could
 *   drive a workflow would be a second engine, and the platform has one.
 */

import type { WorkflowApprovalRecord } from '../../../workflows/contracts/approval.ts';
import type { WorkflowApprovalStore, WorkflowRunStore } from '../../../workflows/persistence/ports.ts';

/** The workflow run that owns one agent run. Identity only, never its data. */
export interface OwningWorkflowRun {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly organizationId: string;
  /** The actor the run belongs to. Compared against the approval's decider. */
  readonly actorId: string;
  readonly state: string;
}

export interface ReviewApprovalAuthorityPort {
  /**
   * Which workflow run created this agent run, if any.
   *
   * `undefined` is the honest answer for a direct agent run, and it is the
   * answer the commit tool turns into a refusal.
   */
  owningWorkflowRun(
    organizationId: string,
    agentRunId: string,
  ): Promise<OwningWorkflowRun | undefined>;
  /** Approvals belonging to one workflow run, in the tenant that asked. */
  approvalsForRun(
    organizationId: string,
    workflowRunId: string,
  ): Promise<readonly WorkflowApprovalRecord[]>;
}

/**
 * Runs a commit could conceivably belong to.
 *
 * A commit executes inside a node of a run that is still going, so a terminal
 * run is not a candidate — and narrowing the listing is what keeps the lookup
 * bounded on a tenant with a long history rather than dependent on a page size.
 */
const LIVE_STATES = [
  'created',
  'validating',
  'ready',
  'running',
  'waiting_for_agent',
  'waiting_for_branches',
  'waiting_for_approval',
  'paused',
] as const;

const RUN_LOOKUP_LIMIT = 200;

/**
 * The production port: the workflow engine's own two stores, read-only.
 *
 * Note what is not here — no `save`, no `consume`, no gate. Spending an approval
 * on releasing a barrier is the ENGINE's business and it has already happened by
 * the time a commit runs; spending one on a commit is recorded separately, in
 * the committed-review store, for exactly that reason.
 */
export function createWorkflowApprovalAuthorityPort(deps: {
  readonly runs: WorkflowRunStore;
  readonly approvals: WorkflowApprovalStore;
}): ReviewApprovalAuthorityPort {
  return {
    async owningWorkflowRun(organizationId, agentRunId) {
      const candidates = await deps.runs.list({
        organizationId,
        states: [...LIVE_STATES],
        limit: RUN_LOOKUP_LIMIT,
      });
      for (const record of candidates) {
        if (!record.childAgentRunIds.includes(agentRunId)) continue;
        // The store is keyed by organization, and the record's own context is
        // compared anyway. "The key was right" and "this record belongs to this
        // tenant" are different claims; only one of them is about isolation.
        if (record.context.organizationId !== organizationId) continue;
        return {
          workflowRunId: record.context.workflowRunId,
          workflowId: record.context.workflowId,
          organizationId: record.context.organizationId,
          actorId: record.context.actorId,
          state: record.state,
        };
      }
      return undefined;
    },

    approvalsForRun: (organizationId, workflowRunId) =>
      deps.approvals.list({ organizationId, workflowRunId }),
  };
}
