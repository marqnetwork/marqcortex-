/**
 * The agent action contract (AI-01 Batch 3A).
 *
 * One provider-neutral vocabulary for everything an agent can ask for. An agent
 * emits a PROPOSAL; the orchestrator seals it into an ACTION after validating
 * it; only a sealed action is ever executed.
 *
 * WHY TWO TYPES AND NOT ONE.
 *
 * A proposal is untrusted input. It arrives from agent code, and agent code is
 * exactly the thing this batch declines to trust with authority. If the agent
 * could stamp its own `actionId`, `runId` and `createdAt`, then the identifiers
 * the audit trail is keyed by would be attacker-influenced in the one direction
 * that matters — an agent could reuse an id to make two different actions look
 * like one, or backdate an action out of a deadline check. So the orchestrator
 * mints those itself, from the injected id factory and the injected clock, and
 * the sealed action is the only thing any downstream stage accepts.
 *
 * The agent DOES supply `idempotencyKey`, because semantic identity is a
 * property of the intention and only the agent knows it: "look up invoice 42"
 * proposed twice is one operation, and the runtime cannot infer that from the
 * payload alone. A duplicate key is not silently accepted — the gateway either
 * replays the stored result (idempotent tools) or refuses (everything else).
 */

import type { AgentCapability } from './agent.ts';

export const AGENT_ACTION_TYPES = [
  'model_call',
  'tool_call',
  'handoff',
  'request_approval',
  'checkpoint',
  'complete',
  'fail',
  'pause',
] as const;

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

export function isAgentActionType(value: unknown): value is AgentActionType {
  return typeof value === 'string' && (AGENT_ACTION_TYPES as readonly string[]).includes(value);
}

/**
 * What the agent expects back. Recorded on the action and checked against what
 * actually arrived, so "the tool returned something else" is a typed failure
 * rather than a parse error three stages later.
 */
export interface AgentOutputExpectation {
  /** Top-level fields the result must carry. Empty means "unstructured". */
  readonly requiredFields: readonly string[];
  /** Ceiling on the serialized result the agent will accept. */
  readonly maxBytes: number;
}

/** Fields every proposal carries, whatever it proposes. */
export interface AgentActionProposalBase {
  readonly actionType: AgentActionType;
  /** Why. Required, bounded, and written into the audit record verbatim. */
  readonly reason: string;
  /** Semantic identity of the intention. See the module note. */
  readonly idempotencyKey: string;
  /** Optional caller-chosen id. Reusing one already seen is a hard failure. */
  readonly actionId?: string;
  readonly expectedOutput?: AgentOutputExpectation;
  /** Agent's own estimate. Advisory: the runtime computes its own and takes the larger. */
  readonly estimatedPromptTokens?: number;
  readonly estimatedCompletionTokens?: number;
  /** Per-action ceiling. Clamped by the tool's or the profile's own timeout. */
  readonly timeoutMs?: number;
}

export interface ModelCallProposal extends AgentActionProposalBase {
  readonly actionType: 'model_call';
  /** A profile, never a model or a provider. Resolved by the control plane. */
  readonly modelProfileId: string;
  /** What the model is being asked to do, in the agent's own words. */
  readonly objective: string;
  /** Structured context sections the builder will assemble and bound. */
  readonly context: readonly AgentContextContribution[];
}

/** One piece of context an agent offers. The builder decides what survives. */
export interface AgentContextContribution {
  readonly sectionId: string;
  readonly label: string;
  readonly content: string;
  /**
   * False for anything derived from tool output, retrieved evidence, model
   * output or another tenant's data — i.e. anything an instruction could have
   * been smuggled into. The builder fences untrusted sections so an instruction
   * inside them reads as data.
   */
  readonly trusted: boolean;
  /** Higher survives trimming. Ties break on declaration order. */
  readonly priority: number;
}

export interface ToolCallProposal extends AgentActionProposalBase {
  readonly actionType: 'tool_call';
  readonly toolId: string;
  readonly input: unknown;
}

export interface HandoffProposal extends AgentActionProposalBase {
  readonly actionType: 'handoff';
  readonly targetAgentId: string;
  /** Bounded payload validated against the TARGET's handoff contract. */
  readonly payload: unknown;
}

export interface RequestApprovalProposal extends AgentActionProposalBase {
  readonly actionType: 'request_approval';
  /** One sentence an approver can act on without reading the run. */
  readonly impactSummary: string;
  /** What the decision touches. Bounded labels, never records. */
  readonly dataAffected: readonly string[];
  readonly estimatedAdditionalTokens?: number;
  readonly estimatedAdditionalCostMicroUsd?: number;
}

export interface CheckpointProposal extends AgentActionProposalBase {
  readonly actionType: 'checkpoint';
  /** Bounded, serializable progress the agent wants to survive a restart. */
  readonly progress: unknown;
}

export interface CompleteProposal extends AgentActionProposalBase {
  readonly actionType: 'complete';
  /** Validated against the agent's declared output contract before acceptance. */
  readonly output: unknown;
}

export interface FailProposal extends AgentActionProposalBase {
  readonly actionType: 'fail';
  /** Machine-readable classification the agent chose. Bounded. */
  readonly failureReason: string;
}

export interface PauseProposal extends AgentActionProposalBase {
  readonly actionType: 'pause';
}

export type AgentActionProposal =
  | ModelCallProposal
  | ToolCallProposal
  | HandoffProposal
  | RequestApprovalProposal
  | CheckpointProposal
  | CompleteProposal
  | FailProposal
  | PauseProposal;

/**
 * A proposal the orchestrator has validated and stamped. Everything downstream
 * takes this type and never the proposal, so "was this checked?" is answered by
 * the signature rather than by reading the call site.
 */
export type AgentAction = AgentActionProposal & {
  readonly actionId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly organizationId: string;
  readonly createdAt: string;
  /** Capabilities the orchestrator confirmed the agent holds for this action. */
  readonly requiredCapabilities: readonly AgentCapability[];
  /** True when this action may not execute until an approval is granted. */
  readonly requiresApproval: boolean;
  readonly estimatedPromptTokens: number;
  readonly estimatedCompletionTokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly timeoutMs: number;
  /** Stable hash of the intention. The input to loop detection. */
  readonly fingerprint: string;
  /** Checkpoint version this action was authorised against. */
  readonly checkpointVersion: number;
};

/** Bounds a malformed or hostile proposal is rejected against. */
export const ACTION_BOUNDS = {
  reason: { min: 3, max: 300 },
  idempotencyKey: { min: 3, max: 128 },
  maxInputBytes: 64 * 1024,
  maxContextSections: 24,
  maxSectionChars: 8_000,
  maxExpectedOutputBytes: 128 * 1024,
  timeoutMs: { min: 100, max: 120_000 },
  maxDataAffected: 12,
  maxImpactSummary: 500,
} as const;

/** Capabilities each action type demands. Single source, enforced once. */
export const CAPABILITY_FOR_ACTION: Readonly<Record<AgentActionType, readonly AgentCapability[]>> = {
  model_call: ['agent.model.invoke'],
  tool_call: ['agent.tool.invoke'],
  handoff: ['agent.handoff.initiate'],
  request_approval: ['agent.approval.request'],
  checkpoint: ['agent.checkpoint.write'],
  // Finishing, failing and pausing are inherent to being a run participant.
  // Gating them behind a capability would let a misconfigured definition
  // produce an agent that cannot stop, which is the opposite of a control.
  complete: [],
  fail: [],
  pause: [],
};
