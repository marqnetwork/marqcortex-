/**
 * Workflow runtime API client (AI-01 Batch 3B).
 *
 * The console's only route to the workflow runtime surface, and deliberately
 * thin for the same two reasons `agentRuntimeService.ts` is:
 *
 *   IT DECIDES NOTHING. `capabilities` arrives from the server on the overview
 *   and the UI reads it to decide what to RENDER. Hiding a control is a
 *   courtesy, never a control — the server refuses the same operation whether
 *   or not a button was drawn.
 *
 *   IT INVENTS NO DEMO DATA. An operator reading fabricated run states, approval
 *   queues or committed outcomes has been told a dangerous lie. With the backend
 *   disabled these functions say so instead.
 *
 * ── WHAT IS DIFFERENT FROM BATCH 3A ────────────────────────────────────────
 *
 * The agent console is read-only plus one decision, because agent runs are
 * created by the product surfaces that need them. A workflow run is not: the
 * diagnostic readiness review is HUMAN INITIATED and has no trigger, no timer
 * and no entry point other than an authorised person asking for it. So this
 * client can start one — and the server still decides whether the caller may,
 * whether the workflow is registered at all, and which submission they are
 * permitted to see.
 *
 * ── WHY `advance` EXISTS AS A SEPARATE CALL ────────────────────────────────
 *
 * Recording a decision does NOT move the run, deliberately: a decider is not
 * necessarily permitted to drive workflow runs — a reviewer may approve and may
 * not start — so advancing inside the decision would either execute agent runs
 * under somebody who may not start them, or quietly require every approver to be
 * an operator. The run picks the decision up on its next advance, and that is an
 * operator's call.
 */

import { edgeFunctionBaseUrl } from '@/config/supabase.config';
import { isBackendEnabled } from '@/config/runtime';

const BASE = edgeFunctionBaseUrl;

/**
 * The certified diagnostic readiness review.
 *
 * Named here so the console can offer it by name. It is NOT a claim that it is
 * available: the workflow is registered only where the deployment turned
 * `AI_DIAGNOSTIC_REVIEW_ENABLED` on, and the registry read below is what tells
 * an operator whether this deployment has.
 */
export const READINESS_REVIEW_WORKFLOW_ID = 'workflow.diagnostic.readiness_review';

// ── Server contracts ────────────────────────────────────────────────────────
//
// Mirrors of the server's read models, kept structural and partial on purpose:
// the console renders what it understands and ignores the rest, so a server
// that adds a field does not break a deployed console.

export type WorkflowRunState =
  | 'created'
  | 'validating'
  | 'planned'
  | 'running'
  | 'waiting_for_agent'
  | 'waiting_for_approval'
  | 'paused'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'policy_denied';

export type WorkflowRuntimeCapability =
  | 'workflow.run.create'
  | 'workflow.run.read'
  | 'workflow.run.control'
  | 'workflow.registry.read'
  | 'workflow.approval.read'
  | 'workflow.approval.decide'
  | 'workflow.run.read.platform';

export interface WorkflowRunSummary {
  workflowRunId: string;
  organizationId: string;
  workflowId: string;
  workflowVersion: string;
  state: WorkflowRunState;
  currentNodeId?: string;
  stepCount: number;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  elapsedRuntimeMs: number;
  failure?: string;
  failureMessage?: string;
}

/**
 * What a decision is ABOUT.
 *
 * Two bounded identifiers, one of them a digest of the sealed artefact. A digest
 * is a fingerprint of content and never content — which is what lets an approval
 * queue name its subject in front of an audience wider than the run itself.
 */
export interface WorkflowApprovalSubjectEvidence {
  subjectId: string;
  contentDigest: string;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  inputDigest: string;
  resultDigest?: string;
  childAgentRunIds: string[];
  pendingApproval?: {
    workflowApprovalId: string;
    nodeId: string;
    requestedAt: string;
    expiresAt: string;
  };
  actualTotalTokens: number;
  actualCostMicroUsd: number;
  steps: {
    nodeId: string;
    kind: string;
    outcome: string;
    startedAt?: string;
    failure?: string;
  }[];
  startedAt?: string;
  endedAt?: string;
}

export interface WorkflowApprovalView {
  workflowApprovalId: string;
  workflowRunId: string;
  organizationId: string;
  workflowId: string;
  nodeId: string;
  requestedBy: string;
  reason: string;
  impactSummary: string;
  authorizedRoles: string[];
  subjectEvidence?: WorkflowApprovalSubjectEvidence;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decision?: 'approve' | 'reject';
  decisionReason?: string;
  approvalState: string;
}

export interface WorkflowDescriptorView {
  workflowId: string;
  displayName: string;
  purpose: string;
  description: string;
  owner: string;
  version: string;
  enabled: boolean;
  certification: string;
  nodeCount: number;
  approvalCount: number;
  agentIds: string[];
}

export interface WorkflowRuntimeOverview {
  scope: 'organization' | 'platform';
  organizationId: string;
  counts: Record<WorkflowRunState, number>;
  active: WorkflowRunSummary[];
  recentFailures: WorkflowRunSummary[];
  registeredWorkflows: number;
  pendingApprovals: number;
  capabilities: WorkflowRuntimeCapability[];
  generatedAt: string;
}

export class WorkflowRuntimeError extends Error {
  readonly code: string;
  readonly failure?: string;
  readonly status: number;

  constructor(message: string, code: string, status: number, failure?: string) {
    super(message);
    this.name = 'WorkflowRuntimeError';
    this.code = code;
    this.status = status;
    this.failure = failure;
  }

  /** True when the operator's role is the problem, not their input. */
  get isForbidden(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /**
   * True when the workflow this deployment was asked for is not registered.
   *
   * The console renders this as "not enabled here" rather than as an error,
   * because it is the correct, expected state of a deployment that has not
   * turned the capability on.
   */
  get isUnavailable(): boolean {
    return this.failure === 'workflow_not_found' || this.status === 404;
  }
}

const BACKEND_DISABLED = new WorkflowRuntimeError(
  'The workflow runtime requires the live backend. This console is running on demo data.',
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
    throw new WorkflowRuntimeError(
      'The workflow runtime returned an unreadable response.',
      'INVALID_RESPONSE',
      response.status,
    );
  }

  if (!response.ok || payload.success !== true) {
    throw new WorkflowRuntimeError(
      typeof payload.error === 'string' ? payload.error : 'The workflow runtime request failed.',
      typeof payload.code === 'string' ? payload.code : 'INTERNAL_ERROR',
      response.status,
      typeof payload.failure === 'string' ? payload.failure : undefined,
    );
  }

  return payload as T;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchWorkflowOverview(
  accessToken: string,
): Promise<WorkflowRuntimeOverview> {
  const { overview } = await call<{ overview: WorkflowRuntimeOverview }>(
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
  options: { states?: WorkflowRunState[]; limit?: number } = {},
): Promise<WorkflowRunSummary[]> {
  const query = new URLSearchParams();
  if (options.states?.length) query.set('state', options.states.join(','));
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  const { runs } = await call<{ runs: WorkflowRunSummary[] }>(
    `/ai/workflows/runs${suffix}`,
    accessToken,
  );
  return runs;
}

export async function fetchWorkflowRun(
  accessToken: string,
  workflowRunId: string,
): Promise<WorkflowRunDetail> {
  const { run } = await call<{ run: WorkflowRunDetail }>(
    `/ai/workflows/runs/${encodeURIComponent(workflowRunId)}`,
    accessToken,
  );
  return run;
}

export async function fetchWorkflowApprovals(
  accessToken: string,
  options: { limit?: number } = {},
): Promise<WorkflowApprovalView[]> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  const { approvals } = await call<{ approvals: WorkflowApprovalView[] }>(
    `/ai/workflows/approvals${suffix}`,
    accessToken,
  );
  return approvals;
}

// ── Operator controls ───────────────────────────────────────────────────────
//
// `reason` is a required parameter rather than an optional field on the two
// calls that take one: the server refuses both without it, and making that
// structurally visible here is the client-side half of the same rule.

/**
 * Start a workflow run.
 *
 * `input` is passed through and validated by the WORKFLOW'S OWN declared input
 * contract, on the server. A shape check here would be a second, weaker opinion
 * about what a workflow accepts — and the console would be the copy that drifted.
 */
export async function startWorkflowRun(
  accessToken: string,
  input: { workflowId: string; input: unknown },
): Promise<WorkflowRunDetail> {
  const { run } = await call<{ run: WorkflowRunDetail }>('/ai/workflows/runs', accessToken, {
    method: 'POST',
    body: { workflowId: input.workflowId, input: input.input },
  });
  return run;
}

/** Drive a run that is parked — after a decision, or after a transient stop. */
export async function advanceWorkflowRun(
  accessToken: string,
  workflowRunId: string,
): Promise<WorkflowRunDetail> {
  const { run } = await call<{ run: WorkflowRunDetail }>(
    `/ai/workflows/runs/${encodeURIComponent(workflowRunId)}/advance`,
    accessToken,
    { method: 'POST', body: {} },
  );
  return run;
}

export async function cancelWorkflowRun(
  accessToken: string,
  input: { workflowRunId: string; reason: string },
): Promise<WorkflowRunDetail> {
  const { run } = await call<{ run: WorkflowRunDetail }>(
    `/ai/workflows/runs/${encodeURIComponent(input.workflowRunId)}/cancel`,
    accessToken,
    { method: 'POST', body: { reason: input.reason } },
  );
  return run;
}

export async function decideWorkflowApproval(
  accessToken: string,
  input: { workflowApprovalId: string; decision: 'approve' | 'reject'; reason: string },
): Promise<WorkflowApprovalView> {
  const { approval } = await call<{ approval: WorkflowApprovalView }>(
    `/ai/workflows/approvals/${encodeURIComponent(input.workflowApprovalId)}`,
    accessToken,
    { method: 'POST', body: { decision: input.decision, reason: input.reason } },
  );
  return approval;
}

// ── Presentation helpers ────────────────────────────────────────────────────

export function hasWorkflowCapability(
  capabilities: readonly WorkflowRuntimeCapability[] | undefined,
  capability: WorkflowRuntimeCapability,
): boolean {
  return capabilities?.includes(capability) ?? false;
}

/** States an operator reads as "in flight". */
export const WORKFLOW_ACTIVE_STATES: readonly WorkflowRunState[] = [
  'created',
  'validating',
  'planned',
  'running',
  'waiting_for_agent',
  'waiting_for_approval',
  'retrying',
];

/** States that ended, one way or another. */
export const WORKFLOW_TERMINAL_STATES: readonly WorkflowRunState[] = [
  'completed',
  'failed',
  'cancelled',
  'expired',
  'policy_denied',
];

export function isWorkflowTerminal(state: WorkflowRunState): boolean {
  return WORKFLOW_TERMINAL_STATES.includes(state);
}

/**
 * What a finished run actually produced, in an operator's words.
 *
 * The workflow has two honest terminals — a committed review and an escalation —
 * and a completed run is either. The distinction is visible in the run's steps:
 * a run that passed its approval node committed; one that never reached it
 * escalated. Anything else says what it says.
 */
export function describeWorkflowOutcome(run: WorkflowRunDetail): string {
  if (run.state === 'completed') {
    return run.steps.some((step) => step.kind === 'approval')
      ? 'Committed after approval'
      : 'Escalated without reaching an approver';
  }
  if (run.state === 'failed') return `Failed — ${run.failure ?? 'no reason recorded'}`;
  if (run.state === 'cancelled') return 'Cancelled by an operator';
  if (run.state === 'expired') return 'Expired before it finished';
  if (run.state === 'policy_denied') return 'Refused by policy';
  if (run.state === 'waiting_for_approval') return 'Waiting for a person';
  return 'In flight';
}
