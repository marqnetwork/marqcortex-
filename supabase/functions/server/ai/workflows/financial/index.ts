/**
 * Live financial event emission — public surface
 * (AI-01 Batch 3B, Integration Pass).
 *
 * ── WHAT THIS TREE IS ──────────────────────────────────────────────────────
 *
 * The wire between workflow execution and the Financial Intelligence Engine, and
 * nothing else. It holds no ledger, no totals, no read model and no surface. It
 * takes execution facts from the Workflow Orchestrator, asks Parts 6A and 6B
 * what the work is worth and whether it needs to happen, and hands the artefacts
 * to Part 6C — which derives the canonical event.
 *
 * ── WHY IT LIVES UNDER `workflows/` AND NOT UNDER `financial/` ─────────────
 *
 * Because the dependency has to run this way. Part 6C is a reporting tree: the
 * boundary scan asserts it never imports the workflow engine, the agent
 * orchestrator, the control plane or a provider adapter, and that assertion is
 * what makes "financial intelligence cannot execute anything" checkable on the
 * source rather than argued from a reading. An adapter placed inside
 * `financial/` would have had to import the workflow engine to be useful, and
 * the claim would have died with it.
 *
 * So the adapter sits on the EXECUTION side of the boundary, imports downward
 * into the three accounting trees, and exports one port. Parts 6A, 6B and 6C
 * remain readable, and reviewable, without reading this.
 *
 * ── STILL DEFERRED ─────────────────────────────────────────────────────────
 *
 * Admin UI, HTTP routes, dashboards, autonomous recommendations, forecasting,
 * background workers and schedulers. This produces the events those surfaces
 * will read and produces no surface.
 */

export type {
  WorkflowFinalizationInput,
  WorkflowFinalizationReport,
  WorkflowFinancialPort,
  WorkflowFinancialRunContext,
  WorkflowNodeCostDecision,
  WorkflowNodeFinancialFacts,
  WorkflowNodeSettlement,
  WorkflowReuseEvidence,
} from './contracts/emission.ts';

export type {
  WorkflowNodeCostProfile,
  WorkflowNodeLimits,
} from './nodeCostProfile.ts';
export {
  DEFAULT_NODE_CAPABILITY_PROFILE,
  DEFAULT_NODE_QUALITY,
  DEFAULT_NODE_TASK_KIND,
  WORKFLOW_OPTIMIZATION_POLICY_VERSION,
  workflowNodeEnvelope,
  workflowNodeTask,
  workflowNodeTaskId,
  workflowPolicyVersionFor,
} from './nodeCostProfile.ts';

export type {
  WorkflowFinancialRecorderOptions,
  WorkflowReuseCandidate,
  WorkflowReuseResolver,
} from './workflowFinancialRecorder.ts';
export {
  createNoopWorkflowFinancialPort,
  createWorkflowFinancialRecorder,
} from './workflowFinancialRecorder.ts';
