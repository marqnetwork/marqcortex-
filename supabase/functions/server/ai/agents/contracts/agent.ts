/**
 * Agent definition contracts (AI-01 Batch 3A).
 *
 * An agent definition is the declarative, versioned description of one
 * autonomous capability: who owns it, what it may do, what it may spend, what
 * it may talk to and when a human has to say yes first. It is the agent
 * equivalent of `contracts/policy.ts`'s feature descriptor, and it exists for
 * the same reason: governance that lives in data can be reviewed, diffed and
 * validated at registration, while governance that lives in an execution path
 * can only be discovered by reading the execution path.
 *
 * THE RULE THIS FILE ENCODES.
 *
 *   AGENTS PROPOSE. THE ORCHESTRATOR DECIDES. THE CONTROL PLANE EXECUTES.
 *
 * An agent's behaviour is a `propose` function. It returns an intention — call
 * a model, call a tool, hand off, ask for approval, finish — and nothing else.
 * It receives no provider, no adapter, no credential, no ledger and no mutable
 * runtime state. Everything it could use to act on its own is simply absent
 * from the type it is handed, which is a stronger guarantee than a rule saying
 * it must not.
 *
 * WHAT AN AGENT NEVER DECLARES: a provider, a model id, a vendor parameter, an
 * organization other than the run's, or a budget of its own. Model selection is
 * expressed as a *profile* (see `runtime/modelRouting.ts`) and resolved by the
 * existing AI Control Plane, exactly as a feature's model is today.
 */

import type { Validator } from '../../security/validation.ts';

/**
 * Capabilities an agent may hold. Deliberately coarse and few: a capability
 * answers "may this agent take this KIND of action at all", and the fine-grained
 * question ("which tool, which target") is answered by the allow lists below.
 * Two overlapping mechanisms at the same grain would be one too many.
 */
export type AgentCapability =
  /** May propose a model call through the AI Control Plane. */
  | 'agent.model.invoke'
  /** May propose a tool call through the tool gateway. */
  | 'agent.tool.invoke'
  /** May propose handing the run to another registered agent. */
  | 'agent.handoff.initiate'
  /** May be the TARGET of a handoff. Held by the receiving agent. */
  | 'agent.handoff.receive'
  /** May propose pausing the run for a human decision. */
  | 'agent.approval.request'
  /** May propose an explicit checkpoint between steps. */
  | 'agent.checkpoint.write';

export const AGENT_CAPABILITIES: readonly AgentCapability[] = [
  'agent.model.invoke',
  'agent.tool.invoke',
  'agent.handoff.initiate',
  'agent.handoff.receive',
  'agent.approval.request',
  'agent.checkpoint.write',
];

/**
 * What the agent is permitted to touch, in one word. Drives the default
 * approval posture and is recorded on every run so a reviewer can answer "what
 * class of thing was running?" without reading the definition.
 */
export type AgentSafetyClass =
  /** Reads platform metadata only. No tenant data, no writes. */
  | 'internal_readonly'
  /** Reads the run's own tenant data. No writes, no external effect. */
  | 'tenant_readonly'
  /** Writes tenant data inside the platform. No external effect. */
  | 'tenant_write'
  /** Causes an effect outside the platform. Always approval-gated. */
  | 'external_effect';

/**
 * Certification status. Only `certified` may run in a deployment that requires
 * certification, and `revoked` may never run anywhere — the distinction from
 * `enabled` is deliberate: disabling is operational, revoking is a judgement
 * about the agent itself and must not be undone by flipping a switch.
 */
export type AgentCertificationStatus = 'certified' | 'testing' | 'uncertified' | 'revoked';

/**
 * Hard ceilings. Every one of these is enforced by the orchestrator on every
 * step, and every one has a terminal outcome when it is reached — there is no
 * limit here that merely logs.
 */
export interface AgentLimits {
  /** Steps the whole run may take, across every agent. */
  readonly maxTotalSteps: number;
  /** Steps any single agent may take within one run. */
  readonly maxStepsPerAgent: number;
  readonly maxHandoffs: number;
  /** Step-level retries. A run-level retry forks a new run instead. */
  readonly maxRetries: number;
  /** Times one identical action fingerprint may repeat before it is a loop. */
  readonly maxRepeatedActions: number;
  /** Times one handoff edge may repeat before it is a cycle. */
  readonly maxRepeatedHandoffs: number;
  /** Wall-clock budget for the whole run, from creation. */
  readonly maxRuntimeMs: number;
  readonly maxPromptTokens: number;
  readonly maxCompletionTokens: number;
  readonly maxTotalTokens: number;
  /** Ceiling on the sum of pre-step estimates. Refuses before spending. */
  readonly maxEstimatedCostMicroUsd: number;
  /** Ceiling on measured cost. Refuses further steps once crossed. */
  readonly maxActualCostMicroUsd: number;
}

/**
 * When a human must decide before the orchestrator will execute a proposal.
 *
 * Note what is absent: an "auto-approve" option. There is no configuration in
 * this platform that makes an approval gate satisfy itself — a gate that can be
 * turned into a no-op by a setting is a gate that will be, during the incident
 * it was built for.
 */
export interface AgentApprovalPolicy {
  /** Tool risk classes that require approval before execution. */
  readonly requireForToolRisk: readonly ToolRiskClass[];
  /** Every handoff this agent initiates needs approval. */
  readonly requireForHandoff: boolean;
  /** The run's completion needs approval before it is accepted. */
  readonly requireForCompletion: boolean;
  /**
   * Roles permitted to decide. Resolved server-side against the authenticated
   * subject; a caller cannot assert one. Empty is invalid — an approval nobody
   * is authorised to grant is a run that can only expire.
   */
  readonly approverRoles: readonly string[];
  /** How long an approval request stays decidable. */
  readonly expiresAfterMs: number;
}

/** Risk classification for tools. Declared here so the policy above can name it. */
export type ToolRiskClass = 'read_only' | 'low' | 'moderate' | 'high';

export interface AgentCompletionCriteria {
  /** Fields the final output must carry for the run to be accepted. */
  readonly requiredOutputFields: readonly string[];
  /**
   * Whether an agent may complete a run it received by handoff. False means
   * only the entry agent may finish, so a delegated sub-task cannot silently
   * decide the whole run is done.
   */
  readonly terminalAfterHandoff: boolean;
}

/**
 * What the agent sees when it is asked for its next intention.
 *
 * Read-only, minimal and derived — the agent gets facts about the run, never
 * the run record itself. It cannot mutate a counter, a state, a ledger or a
 * checkpoint, because none of them are reachable from here.
 */
export interface AgentProposalInput {
  readonly runId: string;
  readonly agentId: string;
  readonly organizationId: string;
  readonly objective: string;
  /** The run's validated input, as accepted by the entry agent's contract. */
  readonly input: unknown;
  readonly stepCount: number;
  readonly stepsTakenByThisAgent: number;
  readonly handoffCount: number;
  /** Safe summary of the previous step's result. Never a raw completion. */
  readonly lastObservation?: AgentObservation;
  /** Present when this agent received the run from another agent. */
  readonly handoff?: AgentHandoffContext;
  /** What is left to spend. Lets an agent choose a cheaper intention itself. */
  readonly remaining: AgentRemainingBudget;
  /** Checkpoint version the proposal must be built against. */
  readonly checkpointVersion: number;
}

/**
 * The result of the previous step, as the agent is allowed to see it.
 *
 * Bounded and structural. A model completion arrives as its parsed, governed
 * output — the same object the control plane returned to the platform — plus a
 * digest; a tool result arrives as its validated output. Nothing raw, nothing
 * unbounded, and nothing from another tenant.
 */
export interface AgentObservation {
  readonly kind: 'model' | 'tool' | 'handoff' | 'approval';
  readonly ok: boolean;
  readonly digest: string;
  readonly output?: unknown;
  /** Failure code when `ok` is false. Never a raw provider message. */
  readonly failure?: string;
}

export interface AgentHandoffContext {
  readonly fromAgentId: string;
  readonly reason: string;
  /** Bounded payload the source agent chose to pass on. Already validated. */
  readonly payload: unknown;
  readonly receivedAt: string;
}

export interface AgentRemainingBudget {
  readonly steps: number;
  readonly handoffs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly actualCostMicroUsd: number;
  readonly runtimeMs: number;
}

/**
 * An agent's behaviour: state in, intention out.
 *
 * Deliberately synchronous-or-async but effect-free. An implementation that
 * reached for the network would be reaching past every control in this batch,
 * and the boundary scan asserts that agent modules do not import a provider,
 * a store or the control plane.
 */
export type AgentProposer = (
  input: AgentProposalInput,
) => AgentActionProposalLike | Promise<AgentActionProposalLike>;

/**
 * Structural placeholder for the proposal union, which lives in `actions.ts`.
 * Declared as `unknown`-shaped here rather than imported to keep the dependency
 * one-directional: actions know about agents, agents do not know about the
 * action module's internals.
 */
export interface AgentActionProposalLike {
  readonly actionType: string;
}

export interface AgentDefinition {
  readonly agentId: string;
  readonly displayName: string;
  /** One line: what this agent is for. Shown in the operator console. */
  readonly purpose: string;
  readonly description: string;
  /** Team accountable for this agent's behaviour. */
  readonly owner: string;
  /** Bumped whenever behaviour, contract or limits change. */
  readonly version: string;
  readonly enabled: boolean;
  readonly certification: AgentCertificationStatus;
  readonly safetyClass: AgentSafetyClass;
  readonly capabilities: readonly AgentCapability[];
  /** Tool ids this agent may propose. Anything else is denied. */
  readonly allowedTools: readonly string[];
  /** Model profile ids this agent may request. Never a model or provider. */
  readonly allowedModelProfiles: readonly string[];
  /** Agent ids this agent may hand off to. Never a wildcard. */
  readonly allowedHandoffTargets: readonly string[];
  /** The shape the run input must have for this agent to be the entry point. */
  readonly inputContract: Validator<unknown>;
  /** The shape this agent's completion output must have. */
  readonly outputContract: Validator<unknown>;
  /** The shape a handoff payload must have for this agent to receive one. */
  readonly handoffContract?: Validator<unknown>;
  readonly limits: AgentLimits;
  readonly approvals: AgentApprovalPolicy;
  readonly completion: AgentCompletionCriteria;
  readonly propose: AgentProposer;
}

/** A definition without its behaviour — what an API or console may see. */
export interface AgentDescriptor {
  readonly agentId: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly description: string;
  readonly owner: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly certification: AgentCertificationStatus;
  readonly safetyClass: AgentSafetyClass;
  readonly capabilities: readonly AgentCapability[];
  readonly allowedTools: readonly string[];
  readonly allowedModelProfiles: readonly string[];
  readonly allowedHandoffTargets: readonly string[];
  readonly limits: AgentLimits;
  readonly approvals: AgentApprovalPolicy;
  readonly completion: AgentCompletionCriteria;
}

export function describeAgent(definition: AgentDefinition): AgentDescriptor {
  return {
    agentId: definition.agentId,
    displayName: definition.displayName,
    purpose: definition.purpose,
    description: definition.description,
    owner: definition.owner,
    version: definition.version,
    enabled: definition.enabled,
    certification: definition.certification,
    safetyClass: definition.safetyClass,
    capabilities: definition.capabilities,
    allowedTools: definition.allowedTools,
    allowedModelProfiles: definition.allowedModelProfiles,
    allowedHandoffTargets: definition.allowedHandoffTargets,
    limits: definition.limits,
    approvals: definition.approvals,
    completion: definition.completion,
  };
}

/**
 * Ceilings on the ceilings.
 *
 * A registry that accepted `maxTotalSteps: 100000` would have limits in name
 * only: the run record's bounded history, the fingerprint map and the wall
 * clock all assume a small number. These are the values the persistence layer
 * is sized for, and registration fails closed against them.
 */
export const AGENT_LIMIT_BOUNDS = {
  maxTotalSteps: { min: 1, max: 64 },
  maxStepsPerAgent: { min: 1, max: 64 },
  maxHandoffs: { min: 0, max: 16 },
  maxRetries: { min: 0, max: 8 },
  maxRepeatedActions: { min: 1, max: 8 },
  maxRepeatedHandoffs: { min: 1, max: 8 },
  maxRuntimeMs: { min: 1_000, max: 900_000 },
  maxPromptTokens: { min: 1, max: 400_000 },
  maxCompletionTokens: { min: 1, max: 200_000 },
  maxTotalTokens: { min: 1, max: 600_000 },
  maxEstimatedCostMicroUsd: { min: 0, max: 2_000_000 },
  maxActualCostMicroUsd: { min: 0, max: 2_000_000 },
  approvalExpiresAfterMs: { min: 60_000, max: 604_800_000 },
} as const;
