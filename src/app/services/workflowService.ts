/**
 * Workflow engine API client (AI-01 Batch 3B).
 *
 * The console's only route to the workflow surface, and deliberately thin for the
 * same two reasons `aiAdminService.ts` and `agentRuntimeService.ts` are:
 *
 *   IT DECIDES NOTHING. `capabilities` arrives from the server on the overview and
 *   the UI reads it to decide what to RENDER. Hiding a control is a courtesy, never
 *   a control — the server refuses the same operation whether or not a button was
 *   drawn, and refuses a finance read whether or not the section was rendered.
 *
 *   IT INVENTS NO DEMO DATA. Every other service in this console falls back to seed
 *   data when the backend is off, which is right for a sales demo of a dashboard and
 *   wrong for an operations view: an operator reading fabricated run states, token
 *   counts, costs and approval queues has been told a dangerous lie. With the
 *   backend disabled these functions say so instead.
 *
 * BATCH 3B IS READ-ONLY FROM THE CONSOLE, with one exception. Workflow runs are
 * created by the product surfaces that need them, not by an operator clicking
 * "start a workflow". What an operator gets here is visibility — what is running,
 * what it cost, what it avoided spending, what is waiting on a human — plus the one
 * control that is genuinely operational: a decision on a pending approval.
 *
 * A PROJECTION IS RENDERED AS AN ESTIMATE. `projectionIsEstimate` and the
 * projection's own `caveat` come from the server and are surfaced verbatim.
 * Presenting an extrapolated monthly burn as a measurement is how a platform ends
 * up in a budget conversation about a number that never existed.
 */

import { edgeFunctionBaseUrl } from '@/config/supabase.config';
import { isBackendEnabled } from '@/config/runtime';

const BASE = edgeFunctionBaseUrl;

// ── Server contracts ────────────────────────────────────────────────────────
//
// Mirrors of the server's read models, kept structural and partial on purpose: the
// console renders what it understands and ignores the rest, so a server that adds a
// field does not break a deployed console.

export type WorkflowRunState =
  | 'created'
  | 'validating'
  | 'planned'
  | 'ready'
  | 'running'
  | 'waiting_for_agent'
  | 'waiting_for_tool'
  | 'waiting_for_model'
  | 'waiting_for_parallel'
  | 'waiting_for_join'
  | 'waiting_for_approval'
  | 'paused'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'budget_exhausted'
  | 'policy_denied';

export type WorkflowCapability =
  | 'workflow.registry.read'
  | 'workflow.run.create'
  | 'workflow.run.read'
  | 'workflow.run.read.platform'
  | 'workflow.run.control'
  | 'workflow.approval.decide'
  | 'workflow.finance.read'
  | 'workflow.finance.read.platform';

export interface WorkflowRunSummary {
  workflowRunId: string;
  workflowId: string;
  workflowVersion: string;
  organizationId: string;
  state: WorkflowRunState;
  currentNodeId?: string;
  stepCount: number;
  retryCount: number;
  activeBranches: number;
  completedBranches: number;
  failedBranches: number;
  childAgentRuns: number;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
  elapsedRuntimeMs: number;
  totalTokens: number;
  costMicroUsd: number;
  avoidedMicroUsd: number;
  pendingApprovalId?: string;
  failure?: string;
  failureMessage?: string;
  parentWorkflowRunId?: string;
}

export interface WorkflowApprovalView {
  workflowApprovalId: string;
  workflowRunId: string;
  workflowId: string;
  nodeId: string;
  branchId?: string;
  organizationId: string;
  requestedBy: string;
  proposedAction: string;
  impactSummary: string;
  dataAffected: string[];
  estimatedAdditionalTokens: number;
  estimatedAdditionalCostMicroUsd: number;
  approvalReason: string;
  authorizedRoles: string[];
  expiresAt: string;
  singleUse: boolean;
  createdAt: string;
  state: string;
}

export interface WorkflowOverview {
  scope: 'organization' | 'platform';
  organizationId: string;
  counts: Record<WorkflowRunState, number>;
  active: WorkflowRunSummary[];
  awaitingApproval: WorkflowRunSummary[];
  recentFailures: WorkflowRunSummary[];
  pendingApprovals: WorkflowApprovalView[];
  registeredWorkflows: number;
  capabilities: WorkflowCapability[];
  bottlenecks: { nodeId: string; runs: number }[];
  completedOutcomes: number;
  costPerSuccessfulRunMicroUsd: number;
  projectedMonthlyBurnMicroUsd: number;
  /** Always true. A projection is never presented as a measurement. */
  projectionIsEstimate: boolean;
  generatedAt: string;
}

export interface WorkflowDescriptorView {
  workflowId: string;
  name: string;
  description: string;
  owner: string;
  version: string;
  enabled: boolean;
  certification: string;
  safetyClass: string;
  nodeCount: number;
  edgeCount: number;
  nodeTypes: string[];
  allowedAgents: string[];
  allowedTools: string[];
  allowedModelProfiles: string[];
  limits: Record<string, number>;
  approvalNodeIds: string[];
  sideEffectingNodeIds: string[];
}

export interface WorkflowNodeView {
  nodeExecutionId: string;
  sequence: number;
  nodeId: string;
  nodeType: string;
  branchId?: string;
  attempt: number;
  startedAt: string;
  latencyMs: number;
  outcome: string;
  failure?: string;
  inputDigest: string;
  outputDigest?: string;
  actualPromptTokens?: number;
  actualCompletionTokens?: number;
  cachedTokens?: number;
  actualCostMicroUsd?: number;
  providerId?: string;
  modelId?: string;
  modelProfileId?: string;
  toolId?: string;
  agentId?: string;
  childAgentRunId?: string;
  nextNodeId?: string;
}

export interface WorkflowBranchView {
  branchId: string;
  parallelNodeId: string;
  joinNodeId: string;
  depth: number;
  state: string;
  currentNodeId?: string;
  stepCount: number;
  promptTokens: number;
  completionTokens: number;
  costMicroUsd: number;
  failure?: string;
}

export interface OptimizationScoreView {
  score: number;
  grade: string;
  formulaVersion: string;
  components: { component: string; value: number; weight: number; contribution: number; basis: string }[];
  penalties: { penalty: string; cap: number; reason: string }[];
  explanation: string;
}

export interface TokenOptimizationReportView {
  workflowRunId: string;
  optimizerDecisions: {
    nodeId: string;
    branchId?: string;
    originalContextTokens: number;
    finalContextTokens: number;
    duplicateTokensRemoved: number;
    historyTokensRemoved: number;
    retrievalTokensAvoided: number;
    memoryTokensAvoided: number;
    completionTokensReduced: number;
    cachedTokensUsed: number;
    totalTokensSaved: number;
    decision: string;
  }[];
  routingDecisions: {
    nodeId: string;
    requestedProfileId: string;
    selectedProfileId: string;
    selectionReason: string;
    expectedCostMicroUsd: number;
    downgraded: boolean;
    escalated: boolean;
    complexity: string;
    candidatesConsidered: string[];
    candidatesRejected: string[];
  }[];
  cacheDecisions: {
    nodeId: string;
    outcome: string;
    savedTokens: number;
    savedMicroUsd: number;
    reason: string;
  }[];
  avoidedCalls: {
    nodeId: string;
    reason: string;
    avoidedCalls: number;
    avoidedMicroUsd: number;
    comparedAgainstProfileId: string;
    estimateVersion: string;
  }[];
  totals: {
    originalContextTokens: number;
    finalContextTokens: number;
    duplicateTokensRemoved: number;
    historyTokensRemoved: number;
    retrievalTokensAvoided: number;
    memoryTokensAvoided: number;
    completionTokensReduced: number;
    cachedTokensUsed: number;
    totalTokensSaved: number;
    avoidedCalls: number;
    avoidedMicroUsd: number;
  };
  score: OptimizationScoreView;
}

export interface WorkflowFinancialSummaryView {
  /** Which of the two data sources produced these figures. */
  source: 'durable_run_records' | 'process_lifetime_metrics';
  generatedAt: string;
  organizationId?: string;
  runs: number;
  successfulRuns: number;
  failedRuns: number;
  activeRuns: number;
  totals: {
    estimatedMicroUsd: number;
    actualMicroUsd: number;
    reservedMicroUsd: number;
    avoidedMicroUsd: number;
    optimizationSavingsMicroUsd: number;
    totalTokens: number;
    cachedTokens: number;
    avoidedTokens: number;
    calls: number;
  };
  costPerSuccessfulRunMicroUsd: number;
  costPerFailedRunMicroUsd: number;
  costPerCompletedOutcomeMicroUsd: number;
  completedOutcomes: number;
  retryCostMicroUsd: number;
  repairCostMicroUsd: number;
  parallelBranchCostMicroUsd: number;
  cacheSavingsMicroUsd: number;
  routingSavingsMicroUsd: number;
  trimmingSavingsMicroUsd: number;
  budgetUtilization: number;
  projection: {
    isEstimate: boolean;
    projectedMonthlyBurnMicroUsd: number;
    windowDays: number;
    observedMicroUsd: number;
    caveat: string;
  };
  byDimension: Record<
    string,
    {
      key: string;
      runs: number;
      successfulRuns: number;
      failedRuns: number;
      actualMicroUsd: number;
      avoidedMicroUsd: number;
      totalTokens: number;
      calls: number;
    }[]
  >;
}

export interface OptimizationSavingsSummaryView {
  source: string;
  generatedAt: string;
  avoidedCalls: number;
  avoidedTokens: number;
  avoidedMicroUsd: number;
  cacheHits: number;
  cacheSavingsMicroUsd: number;
  duplicateTokensRemoved: number;
  historyTokensRemoved: number;
  retrievalTokensAvoided: number;
  memoryTokensAvoided: number;
  completionTokensReduced: number;
  totalTokensSaved: number;
  byReason: { reason: string; avoidedCalls: number; avoidedTokens: number; avoidedMicroUsd: number }[];
  /** More than one means the figures span a pricing-basis change. */
  estimateVersions: string[];
}

export class WorkflowServiceError extends Error {
  readonly code: string;
  readonly failure?: string;
  readonly status: number;

  constructor(message: string, code: string, status: number, failure?: string) {
    super(message);
    this.name = 'WorkflowServiceError';
    this.code = code;
    this.status = status;
    this.failure = failure;
  }

  /** True when the operator's role is the problem, not their input. */
  get isForbidden(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const BACKEND_DISABLED = new WorkflowServiceError(
  'The workflow engine requires the live backend. This console is running on demo data.',
  'BACKEND_DISABLED',
  503,
);

async function call<T>(
  path: string,
  accessToken: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  // No demo fallback, deliberately. See the module comment.
  if (!isBackendEnabled()) throw BACKEND_DISABLED;

  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new WorkflowServiceError(
      'The workflow engine returned an unreadable response.',
      'INVALID_RESPONSE',
      response.status,
    );
  }

  if (!response.ok || payload.success !== true) {
    throw new WorkflowServiceError(
      typeof payload.error === 'string' ? payload.error : 'The workflow request failed.',
      typeof payload.code === 'string' ? payload.code : 'INTERNAL_ERROR',
      response.status,
      typeof payload.failure === 'string' ? payload.failure : undefined,
    );
  }

  return payload as T;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchWorkflowOverview(accessToken: string): Promise<WorkflowOverview> {
  const { overview } = await call<{ overview: WorkflowOverview }>(
    '/ai/workflows/overview',
    accessToken,
  );
  return overview;
}

export async function fetchWorkflowRegistry(
  accessToken: string,
): Promise<WorkflowDescriptorView[]> {
  const { workflows } = await call<{ workflows: WorkflowDescriptorView[] }>(
    '/ai/workflows/registry',
    accessToken,
  );
  return workflows;
}

export async function fetchWorkflowRuns(
  accessToken: string,
  options: { states?: WorkflowRunState[]; workflowId?: string; limit?: number } = {},
): Promise<WorkflowRunSummary[]> {
  const query = new URLSearchParams();
  if (options.states?.length) query.set('state', options.states.join(','));
  if (options.workflowId !== undefined) query.set('workflowId', options.workflowId);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  const { runs } = await call<{ runs: WorkflowRunSummary[] }>(
    `/ai/workflows/runs${suffix}`,
    accessToken,
  );
  return runs;
}

export async function fetchWorkflowRunNodes(
  accessToken: string,
  workflowRunId: string,
): Promise<WorkflowNodeView[]> {
  const { nodes } = await call<{ nodes: WorkflowNodeView[] }>(
    `/ai/workflows/runs/${encodeURIComponent(workflowRunId)}/nodes`,
    accessToken,
  );
  return nodes;
}

export async function fetchWorkflowBranches(
  accessToken: string,
  workflowRunId: string,
): Promise<{ branches: WorkflowBranchView[]; joins: unknown[] }> {
  return call<{ branches: WorkflowBranchView[]; joins: unknown[] }>(
    `/ai/workflows/runs/${encodeURIComponent(workflowRunId)}/branches`,
    accessToken,
  );
}

export async function fetchTokenOptimizationReport(
  accessToken: string,
  workflowRunId: string,
): Promise<TokenOptimizationReportView> {
  const { report } = await call<{ report: TokenOptimizationReportView }>(
    `/ai/workflows/runs/${encodeURIComponent(workflowRunId)}/tokens`,
    accessToken,
  );
  return report;
}

export async function fetchWorkflowFinancialSummary(
  accessToken: string,
): Promise<WorkflowFinancialSummaryView> {
  const { summary } = await call<{ summary: WorkflowFinancialSummaryView }>(
    '/ai/workflows/finance',
    accessToken,
  );
  return summary;
}

export async function fetchOptimizationSavings(
  accessToken: string,
): Promise<OptimizationSavingsSummaryView> {
  const { summary } = await call<{ summary: OptimizationSavingsSummaryView }>(
    '/ai/workflows/savings',
    accessToken,
  );
  return summary;
}

// ── The one operational control ─────────────────────────────────────────────
//
// `reason` is a required parameter rather than an optional field: the server refuses
// a decision without one, and making that structurally visible here is the
// client-side half of the same rule.

export async function decideWorkflowApproval(
  accessToken: string,
  input: {
    workflowRunId: string;
    workflowApprovalId: string;
    decision: 'approve' | 'reject';
    reason: string;
  },
): Promise<WorkflowRunSummary> {
  const { run } = await call<{ run: WorkflowRunSummary }>(
    `/ai/workflows/runs/${encodeURIComponent(input.workflowRunId)}/approvals/${encodeURIComponent(
      input.workflowApprovalId,
    )}`,
    accessToken,
    { method: 'POST', body: { decision: input.decision, reason: input.reason } },
  );
  return run;
}

// ── Presentation helpers ────────────────────────────────────────────────────

export function hasWorkflowCapability(
  capabilities: readonly WorkflowCapability[] | undefined,
  capability: WorkflowCapability,
): boolean {
  return capabilities?.includes(capability) ?? false;
}

/** Micro-USD as dollars, at the precision an operator actually reads. */
export function formatWorkflowCost(microUsd: number): string {
  if (!Number.isFinite(microUsd)) return '$0.00';
  const usd = microUsd / 1_000_000;
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** A token count an operator can read at a glance. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/** States an operator reads as "in flight". */
export const WORKFLOW_ACTIVE_STATES: readonly WorkflowRunState[] = [
  'created',
  'validating',
  'planned',
  'ready',
  'running',
  'waiting_for_agent',
  'waiting_for_tool',
  'waiting_for_model',
  'waiting_for_parallel',
  'waiting_for_join',
  'retrying',
];

/** States that ended badly. Grouped so a console can count them in one pass. */
export const WORKFLOW_FAILURE_STATES: readonly WorkflowRunState[] = [
  'failed',
  'expired',
  'budget_exhausted',
  'policy_denied',
];
