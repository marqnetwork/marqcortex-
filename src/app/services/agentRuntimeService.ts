/**
 * Agent runtime API client (AI-01 Batch 3A).
 *
 * The console's only route to the agent runtime surface, and deliberately thin
 * for the same two reasons `aiAdminService.ts` is:
 *
 *   IT DECIDES NOTHING. `capabilities` arrives from the server on the overview
 *   and the UI reads it to decide what to RENDER. Hiding a control is a
 *   courtesy, never a control — the server refuses the same operation whether
 *   or not a button was drawn.
 *
 *   IT INVENTS NO DEMO DATA. Every other service in this console falls back to
 *   seed data when the backend is off, which is right for a sales demo of a
 *   dashboard and wrong for an operations view: an operator reading fabricated
 *   run states, token counts and approval queues has been told a dangerous lie.
 *   With the backend disabled these functions say so instead.
 *
 * BATCH 3A IS READ-ONLY FROM THE CONSOLE. Runs are created by the product
 * surfaces that need them, not by an operator clicking "start an agent". What
 * an operator gets here is visibility — what is running, what it cost, what is
 * waiting on a human — plus the one control that is genuinely operational: a
 * decision on a pending approval.
 */

import { edgeFunctionBaseUrl } from '@/config/supabase.config';
import { isBackendEnabled } from '@/config/runtime';

const BASE = edgeFunctionBaseUrl;

// ── Server contracts ────────────────────────────────────────────────────────
//
// Mirrors of the server's read models, kept structural and partial on purpose:
// the console renders what it understands and ignores the rest, so a server
// that adds a field does not break a deployed console.

export type AgentRunState =
  | 'created'
  | 'validating'
  | 'planned'
  | 'waiting_for_budget'
  | 'running'
  | 'waiting_for_tool'
  | 'waiting_for_agent'
  | 'waiting_for_approval'
  | 'paused'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'budget_exhausted'
  | 'policy_denied';

export type AgentRuntimeCapability =
  | 'agent.run.create'
  | 'agent.run.read'
  | 'agent.run.control'
  | 'agent.approval.decide'
  | 'agent.registry.read'
  | 'agent.run.read.platform';

export interface AgentRunSummary {
  runId: string;
  organizationId: string;
  agentId: string;
  agentVersion: string;
  currentAgentId: string;
  state: AgentRunState;
  currentStep: number;
  stepCount: number;
  handoffCount: number;
  retryCount: number;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
  elapsedRuntimeMs: number;
  totalTokens: number;
  costMicroUsd: number;
  pendingApprovalId?: string;
  failure?: string;
  failureMessage?: string;
  workflowId?: string;
  parentRunId?: string;
}

export interface AgentApprovalView {
  approvalId: string;
  runId: string;
  actionId: string;
  organizationId: string;
  requestingAgentId: string;
  actionType: string;
  impactSummary: string;
  dataAffected: string[];
  estimatedAdditionalTokens: number;
  estimatedAdditionalCostMicroUsd: number;
  reason: string;
  authorizedApproverRoles: string[];
  expiresAt: string;
  createdAt: string;
  state: string;
}

export interface AgentRuntimeOverview {
  scope: 'organization' | 'platform';
  organizationId?: string;
  counts: Record<AgentRunState, number>;
  active: AgentRunSummary[];
  awaitingApproval: AgentRunSummary[];
  recentFailures: AgentRunSummary[];
  pendingApprovals: AgentApprovalView[];
  registeredAgents: number;
  registeredTools: number;
  capabilities: AgentRuntimeCapability[];
  generatedAt: string;
}

export interface AgentDescriptorView {
  agentId: string;
  displayName: string;
  purpose: string;
  owner: string;
  version: string;
  enabled: boolean;
  certification: string;
  safetyClass: string;
  capabilities: string[];
  allowedTools: string[];
  allowedModelProfiles: string[];
  allowedHandoffTargets: string[];
  limits: Record<string, number>;
}

export interface AgentStepView {
  stepId: string;
  sequence: number;
  agentId: string;
  actionType: string;
  reason: string;
  outcome: string;
  attempt: number;
  startedAt: string;
  latencyMs: number;
  failure?: string;
  inputDigest: string;
  outputDigest?: string;
  actualPromptTokens?: number;
  actualCompletionTokens?: number;
  actualCostMicroUsd?: number;
  providerId?: string;
  modelId?: string;
  modelProfileId?: string;
  toolId?: string;
  targetAgentId?: string;
  approvalId?: string;
}

export class AgentRuntimeError extends Error {
  readonly code: string;
  readonly failure?: string;
  readonly status: number;

  constructor(message: string, code: string, status: number, failure?: string) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    this.status = status;
    this.failure = failure;
  }

  /** True when the operator's role is the problem, not their input. */
  get isForbidden(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const BACKEND_DISABLED = new AgentRuntimeError(
  'The agent runtime requires the live backend. This console is running on demo data.',
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
    throw new AgentRuntimeError(
      'The agent runtime returned an unreadable response.',
      'INVALID_RESPONSE',
      response.status,
    );
  }

  if (!response.ok || payload.success !== true) {
    throw new AgentRuntimeError(
      typeof payload.error === 'string' ? payload.error : 'The agent runtime request failed.',
      typeof payload.code === 'string' ? payload.code : 'INTERNAL_ERROR',
      response.status,
      typeof payload.failure === 'string' ? payload.failure : undefined,
    );
  }

  return payload as T;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchAgentOverview(accessToken: string): Promise<AgentRuntimeOverview> {
  const { overview } = await call<{ overview: AgentRuntimeOverview }>(
    '/ai/agents/overview',
    accessToken,
  );
  return overview;
}

export async function fetchAgentRegistry(accessToken: string): Promise<AgentDescriptorView[]> {
  const { agents } = await call<{ agents: AgentDescriptorView[] }>(
    '/ai/agents/registry',
    accessToken,
  );
  return agents;
}

export async function fetchAgentRuns(
  accessToken: string,
  options: { states?: AgentRunState[]; limit?: number } = {},
): Promise<AgentRunSummary[]> {
  const query = new URLSearchParams();
  if (options.states?.length) query.set('state', options.states.join(','));
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  const { runs } = await call<{ runs: AgentRunSummary[] }>(
    `/ai/agents/runs${suffix}`,
    accessToken,
  );
  return runs;
}

export async function fetchAgentRunSteps(
  accessToken: string,
  runId: string,
): Promise<AgentStepView[]> {
  const { steps } = await call<{ steps: AgentStepView[] }>(
    `/ai/agents/runs/${encodeURIComponent(runId)}/steps`,
    accessToken,
  );
  return steps;
}

// ── The one operational control ─────────────────────────────────────────────
//
// `reason` is a required parameter rather than an optional field: the server
// refuses a decision without one, and making that structurally visible here is
// the client-side half of the same rule.

export async function decideAgentApproval(
  accessToken: string,
  input: { runId: string; approvalId: string; decision: 'approve' | 'reject'; reason: string },
): Promise<AgentRunSummary> {
  const { run } = await call<{ run: AgentRunSummary }>(
    `/ai/agents/runs/${encodeURIComponent(input.runId)}/approvals/${encodeURIComponent(input.approvalId)}`,
    accessToken,
    { method: 'POST', body: { decision: input.decision, reason: input.reason } },
  );
  return run;
}

// ── Presentation helpers ────────────────────────────────────────────────────

export function hasAgentCapability(
  capabilities: readonly AgentRuntimeCapability[] | undefined,
  capability: AgentRuntimeCapability,
): boolean {
  return capabilities?.includes(capability) ?? false;
}

/** Micro-USD as dollars, at the precision an operator actually reads. */
export function formatAgentCost(microUsd: number): string {
  if (!Number.isFinite(microUsd)) return '$0.00';
  const usd = microUsd / 1_000_000;
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Elapsed milliseconds as the shortest truthful string. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** States an operator reads as "in flight". */
export const AGENT_ACTIVE_STATES: readonly AgentRunState[] = [
  'created',
  'validating',
  'planned',
  'waiting_for_budget',
  'running',
  'waiting_for_tool',
  'waiting_for_agent',
  'retrying',
];

/** States that ended badly. Grouped so a console can count them in one pass. */
export const AGENT_FAILURE_STATES: readonly AgentRunState[] = [
  'failed',
  'expired',
  'budget_exhausted',
  'policy_denied',
];
