/**
 * Workflow definition contracts (AI-01 Batch 3B).
 *
 * A workflow definition is the declarative, versioned description of a plan:
 * which nodes exist, how they connect, which agents/tools/model profiles the
 * plan may reach, what it may spend, and where a human has to say yes. It is to
 * a workflow what `agents/contracts/agent.ts` is to an agent, and it exists for
 * the same reason: governance that lives in data can be diffed, reviewed and
 * validated at registration, while governance that lives in an execution path
 * can only be discovered by reading the execution path.
 *
 * THE RULE THIS FILE ENCODES.
 *
 *   WORKFLOWS PLAN. AGENTS PROPOSE. THE ORCHESTRATOR DECIDES.
 *   THE AI CONTROL PLANE EXECUTES.
 *
 * A definition carries no behaviour at all — no `propose`, no executor, no
 * closure that could reach a provider. It is a graph plus limits plus allow
 * lists. Everything that acts is on the other side of a port the orchestrator
 * holds, which is a stronger guarantee than a rule saying a definition must not
 * act.
 *
 * TOPOLOGY LIVES IN ONE PLACE. `edges` is the single declaration of the graph.
 * Nodes do NOT also carry their own successors, because two declarations of the
 * same fact are two declarations that eventually disagree — and a workflow
 * whose node says "go to B" while its edge list says "go to C" is a workflow
 * nobody can review. What a node declares is the shape of its own decision
 * (which branch ids a `parallel` opens, which policy a `join` applies), and the
 * registry cross-checks that against the edges.
 */

import type { Validator } from '../../security/validation.ts';

// ── Classification ──────────────────────────────────────────────────────────

/**
 * What the workflow is permitted to touch, in one word. Drives the default
 * approval posture and is recorded on every run, so a reviewer can answer "what
 * class of thing was running?" without reading the definition.
 */
export type WorkflowSafetyClass =
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
 * about the definition itself and must not be undone by flipping a switch.
 */
export type WorkflowCertificationStatus = 'certified' | 'testing' | 'uncertified' | 'revoked';

// ── Node types ──────────────────────────────────────────────────────────────

export const WORKFLOW_NODE_TYPES = [
  'agent',
  'model',
  'tool',
  'condition',
  'parallel',
  'join',
  'approval',
  'checkpoint',
  'wait',
  'transform',
  'complete',
  'fail',
] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export function isWorkflowNodeType(value: unknown): value is WorkflowNodeType {
  return typeof value === 'string' && (WORKFLOW_NODE_TYPES as readonly string[]).includes(value);
}

/** Node types that end a path. They have no outgoing edge, ever. */
export const TERMINAL_NODE_TYPES: readonly WorkflowNodeType[] = ['complete', 'fail'];

/**
 * Node types that can cause an effect the platform cannot take back.
 *
 * `tool` is here because a tool may write; `agent` is here because an agent may
 * call a tool. The planner uses this list to discover side-effecting nodes, and
 * the cache refuses to serve any of them.
 */
export const SIDE_EFFECTING_NODE_TYPES: readonly WorkflowNodeType[] = ['tool', 'agent'];

/** Node types that can cost money. Drives the planner's worst-case exposure. */
export const BILLABLE_NODE_TYPES: readonly WorkflowNodeType[] = ['model', 'agent'];

// ── Edges ───────────────────────────────────────────────────────────────────

/**
 * When an edge is taken.
 *
 *   always    the ordinary successor of a node that completed
 *   true/false  the two outcomes of a `condition`
 *   branch    one arm opened by a `parallel`. Carries a branch id.
 *   failure   the recovery path of a node whose failure policy routes rather
 *             than ending the workflow
 */
export type WorkflowEdgeKind = 'always' | 'true' | 'false' | 'branch' | 'failure';

export interface WorkflowEdge {
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly kind: WorkflowEdgeKind;
  /** Required on a `branch` edge, forbidden on every other kind. */
  readonly branchId?: string;
  /** One line for the operator console and the plan manifest. */
  readonly label?: string;
}

// ── Per-node policy ─────────────────────────────────────────────────────────

export interface WorkflowNodeRetryPolicy {
  /** Attempts BEYOND the first. Zero means one attempt and no retry. */
  readonly maxAttempts: number;
  /** Deterministic backoff. Applied to the run's wait deadline, not a sleep. */
  readonly backoffMs: number;
}

/**
 * What happens when a node exhausts its retries.
 *
 *   fail_workflow   the run ends. The default and the safe one.
 *   route           follow the node's `failure` edge. Requires one to exist.
 *   continue        record the failure and take the `always` edge anyway. Only
 *                   legal on a node the definition marks `optional`.
 */
export type WorkflowNodeFailureBehavior = 'fail_workflow' | 'route' | 'continue';

/**
 * Whether repeating a node is safe.
 *
 *   replayable      re-running it produces the same effect. A restart may.
 *   at_most_once    it may have had an effect. A restart must NOT re-run it.
 */
export type WorkflowNodeIdempotency = 'replayable' | 'at_most_once';

export interface WorkflowNodeApprovalRule {
  /** Roles permitted to decide. Empty is invalid — see the registry. */
  readonly approverRoles: readonly string[];
  readonly expiresAfterMs: number;
  /** One sentence a human reads before deciding. */
  readonly impactSummary: string;
  /** Bounded list of what the approved action touches. */
  readonly dataAffected: readonly string[];
}

/**
 * How a value moves in and out of a node.
 *
 * Deliberately a declarative map rather than a function: `{ topic: 'input.topic' }`
 * says the node's `topic` field comes from the run input's `topic`. A function
 * would be code inside a definition, which is the thing this batch is built to
 * avoid. Paths are resolved by `runtime/mapping.ts` against a bounded, typed
 * value space — validated input, trusted node outputs and run metadata.
 */
export type WorkflowValueMapping = Readonly<Record<string, string>>;

/** Where a context section comes from and what it is allowed to cost. */
export interface WorkflowContextDeclaration {
  readonly sectionId: string;
  /** Which value space supplies it. See `runtime/mapping.ts`. */
  readonly source: string;
  /** Authority band. Drives ordering and fencing; never taken from content. */
  readonly authority:
    | 'system_instructions'
    | 'agent_definition'
    | 'objective'
    | 'checkpoint'
    | 'handoff_context'
    | 'approved_memory'
    | 'tool_result'
    | 'retrieved_evidence'
    | 'recent_history';
  /** Why this node needs it. Recorded on the manifest, read by a reviewer. */
  readonly relevanceReason: string;
  /** A required section is never dropped; the step is refused instead. */
  readonly required: boolean;
  readonly maxTokens: number;
  /** How stale the value may be before it is excluded. Zero means "any". */
  readonly maxAgeMs: number;
  readonly sensitivity: 'public' | 'internal' | 'tenant' | 'restricted';
  /** Tenant scope this section belongs to. Cross-tenant sections are refused. */
  readonly tenantScope: 'run_organization' | 'platform';
  readonly priority: number;
}

// ── Nodes ───────────────────────────────────────────────────────────────────

/** Fields every node carries, whatever it does. */
export interface WorkflowNodeBase {
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  /** One line: what this node is for. Shown in the console and the manifest. */
  readonly purpose: string;
  readonly inputMapping: WorkflowValueMapping;
  readonly outputMapping: WorkflowValueMapping;
  /** Workflow capabilities the node needs. Checked against the definition. */
  readonly requiredCapabilities: readonly string[];
  readonly timeoutMs: number;
  readonly retry: WorkflowNodeRetryPolicy;
  /** Tokens this node alone may spend. Zero for non-billable node types. */
  readonly tokenAllowance: number;
  /** Micro-USD this node alone may spend. Zero for non-billable node types. */
  readonly costAllowanceMicroUsd: number;
  readonly idempotency: WorkflowNodeIdempotency;
  readonly onFailure: WorkflowNodeFailureBehavior;
  /** An optional node may be skipped by the cost optimizer. */
  readonly optional: boolean;
  /** Present when this node requires a human decision before it executes. */
  readonly approval?: WorkflowNodeApprovalRule;
}

export interface WorkflowAgentNode extends WorkflowNodeBase {
  readonly nodeType: 'agent';
  /** Must appear in the workflow's `allowedAgents`. */
  readonly agentId: string;
  /** The objective handed to the agent run. Bounded. */
  readonly objective: string;
}

export interface WorkflowModelNode extends WorkflowNodeBase {
  readonly nodeType: 'model';
  /** Must appear in the workflow's `allowedModelProfiles`. */
  readonly modelProfileId: string;
  readonly objective: string;
  readonly context: readonly WorkflowContextDeclaration[];
  /** Fields the parsed output must carry. Validated after the call. */
  readonly requiredOutputFields: readonly string[];
  /** Quality floor for routing. The router may not go below it. */
  readonly minimumQuality: 'baseline' | 'standard' | 'high';
  /** True when the node's answer may be served from cache. */
  readonly cacheable: boolean;
  readonly cacheTtlMs: number;
}

export interface WorkflowToolNode extends WorkflowNodeBase {
  readonly nodeType: 'tool';
  /** Must appear in the workflow's `allowedTools`. */
  readonly toolId: string;
}

export interface WorkflowConditionNode extends WorkflowNodeBase {
  readonly nodeType: 'condition';
  /** Registered predicate id. Never an expression string to be evaluated. */
  readonly predicateId: string;
  /** Bounded, typed arguments the predicate receives. */
  readonly predicateArguments: Readonly<Record<string, string | number | boolean>>;
}

export interface WorkflowParallelNode extends WorkflowNodeBase {
  readonly nodeType: 'parallel';
  /** The join this fan-out converges on. Must be a `join` node. */
  readonly joinNodeId: string;
}

export type WorkflowJoinPolicy = 'all' | 'any' | 'minimum_successes' | 'named_required_branches';

export interface WorkflowJoinNode extends WorkflowNodeBase {
  readonly nodeType: 'join';
  readonly policy: WorkflowJoinPolicy;
  /** Required when the policy is `minimum_successes`. */
  readonly minimumSuccesses?: number;
  /** Required when the policy is `named_required_branches`. */
  readonly requiredBranchIds?: readonly string[];
  /** What happens to still-running branches once the join is satisfied. */
  readonly onSatisfied: 'cancel_remaining' | 'wait_all';
  /** Whether a branch failure ends the fan-out immediately. */
  readonly failurePolicy: 'fail_fast' | 'wait_all';
}

export interface WorkflowApprovalNode extends WorkflowNodeBase {
  readonly nodeType: 'approval';
  readonly approval: WorkflowNodeApprovalRule;
}

export interface WorkflowCheckpointNode extends WorkflowNodeBase {
  readonly nodeType: 'checkpoint';
}

export interface WorkflowWaitNode extends WorkflowNodeBase {
  readonly nodeType: 'wait';
  /** Deterministic wait, measured against the injected clock. */
  readonly waitMs: number;
}

export interface WorkflowTransformNode extends WorkflowNodeBase {
  readonly nodeType: 'transform';
  /** Registered deterministic transform id. Never inline code. */
  readonly transformId: string;
  readonly transformArguments: Readonly<Record<string, string | number | boolean>>;
  /**
   * True when this transform exists INSTEAD OF a model call. The avoided-call
   * ledger credits it against the model profile named below, so a saving is
   * always measured against a versioned estimate rather than asserted.
   */
  readonly avoidsModelCall: boolean;
  readonly avoidedProfileId?: string;
  readonly avoidedPromptTokens?: number;
  readonly avoidedCompletionTokens?: number;
}

export interface WorkflowCompleteNode extends WorkflowNodeBase {
  readonly nodeType: 'complete';
}

export interface WorkflowFailNode extends WorkflowNodeBase {
  readonly nodeType: 'fail';
  readonly failureReason: string;
}

export type WorkflowNode =
  | WorkflowAgentNode
  | WorkflowModelNode
  | WorkflowToolNode
  | WorkflowConditionNode
  | WorkflowParallelNode
  | WorkflowJoinNode
  | WorkflowApprovalNode
  | WorkflowCheckpointNode
  | WorkflowWaitNode
  | WorkflowTransformNode
  | WorkflowCompleteNode
  | WorkflowFailNode;

// ── Limits ──────────────────────────────────────────────────────────────────

/**
 * Hard ceilings. Every one is enforced by the orchestrator, and every one has a
 * terminal outcome when it is reached — there is no limit here that merely logs.
 */
export interface WorkflowLimits {
  readonly maxTotalSteps: number;
  readonly maxParallelBranches: number;
  readonly maxBranchDepth: number;
  readonly maxRetries: number;
  /** Agent handoffs across every child agent run this workflow creates. */
  readonly maxHandoffs: number;
  readonly maxRuntimeMs: number;
  readonly maxPromptTokens: number;
  readonly maxCompletionTokens: number;
  readonly maxTotalTokens: number;
  readonly maxEstimatedCostMicroUsd: number;
  readonly maxActualCostMicroUsd: number;
}

/**
 * Ceilings on the ceilings.
 *
 * A registry that accepted `maxTotalSteps: 100000` would have limits in name
 * only: the run record's bounded history, the branch table and the wall clock
 * all assume a small number. These are the values the persistence layer is
 * sized for, and registration fails closed against them.
 */
export const WORKFLOW_LIMIT_BOUNDS = {
  maxTotalSteps: { min: 1, max: 128 },
  maxParallelBranches: { min: 1, max: 8 },
  maxBranchDepth: { min: 1, max: 4 },
  maxRetries: { min: 0, max: 8 },
  maxHandoffs: { min: 0, max: 16 },
  maxRuntimeMs: { min: 1_000, max: 1_800_000 },
  maxPromptTokens: { min: 1, max: 800_000 },
  maxCompletionTokens: { min: 1, max: 400_000 },
  maxTotalTokens: { min: 1, max: 1_200_000 },
  maxEstimatedCostMicroUsd: { min: 0, max: 4_000_000 },
  maxActualCostMicroUsd: { min: 0, max: 4_000_000 },
  approvalExpiresAfterMs: { min: 60_000, max: 604_800_000 },
  nodeTimeoutMs: { min: 100, max: 600_000 },
  nodeRetryAttempts: { min: 0, max: 5 },
  waitMs: { min: 0, max: 600_000 },
  maxNodes: 128,
  maxEdges: 256,
  maxContextSections: 24,
  maxCacheTtlMs: 86_400_000,
} as const;

/**
 * Platform safety bounds the PLAN — not the definition — must fit inside.
 *
 * The definition's own limits bound what one run may do. These bound what the
 * planner is allowed to conclude a run COULD do in its worst case, which is a
 * different question: a definition can declare a modest token ceiling while its
 * graph admits a fan-out whose worst case is far larger, and the planner is
 * where that is caught.
 */
export const PLATFORM_PLAN_BOUNDS = {
  maxWorstCaseSteps: 512,
  maxWorstCaseTokens: 2_400_000,
  maxWorstCaseCostMicroUsd: 8_000_000,
  maxWorstCaseRetries: 256,
  maxReachableNodes: 128,
} as const;

// ── Completion and failure policy ───────────────────────────────────────────

export interface WorkflowCompletionCriteria {
  /** Fields the final output must carry for the run to be accepted. */
  readonly requiredOutputFields: readonly string[];
  /** True when a human must sign off before a completion is accepted. */
  readonly requireApproval: boolean;
}

export type WorkflowFailurePolicy =
  /** Any unhandled node failure ends the run. */
  | 'fail_fast'
  /** A node whose `onFailure` routes may continue; anything else ends the run. */
  | 'route_then_fail';

// ── The definition ──────────────────────────────────────────────────────────

export interface WorkflowDefinition {
  readonly workflowId: string;
  readonly name: string;
  readonly description: string;
  /** Team accountable for this workflow's behaviour. */
  readonly owner: string;
  /** Semantic version. Bumped whenever the graph, contracts or limits change. */
  readonly version: string;
  readonly enabled: boolean;
  readonly certification: WorkflowCertificationStatus;
  readonly safetyClass: WorkflowSafetyClass;
  /** The shape a run's input must have. */
  readonly inputContract: Validator<unknown>;
  /** The shape the run's accepted output must have. */
  readonly outputContract: Validator<unknown>;
  readonly initialNodeId: string;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  /** Agent ids any `agent` node may name. Never a wildcard. */
  readonly allowedAgents: readonly string[];
  /** Tool ids any `tool` node may name. Never a wildcard. */
  readonly allowedTools: readonly string[];
  /** Model profile ids any `model` node may name. Never a model or provider. */
  readonly allowedModelProfiles: readonly string[];
  readonly limits: WorkflowLimits;
  readonly completion: WorkflowCompletionCriteria;
  readonly failurePolicy: WorkflowFailurePolicy;
}

/** A definition without its contracts — what an API or console may see. */
export interface WorkflowDescriptor {
  readonly workflowId: string;
  readonly name: string;
  readonly description: string;
  readonly owner: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly certification: WorkflowCertificationStatus;
  readonly safetyClass: WorkflowSafetyClass;
  readonly initialNodeId: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodeTypes: readonly WorkflowNodeType[];
  readonly allowedAgents: readonly string[];
  readonly allowedTools: readonly string[];
  readonly allowedModelProfiles: readonly string[];
  readonly limits: WorkflowLimits;
  readonly completion: WorkflowCompletionCriteria;
  readonly failurePolicy: WorkflowFailurePolicy;
  readonly approvalNodeIds: readonly string[];
  readonly sideEffectingNodeIds: readonly string[];
}

export function describeWorkflow(definition: WorkflowDefinition): WorkflowDescriptor {
  const nodeTypes = [...new Set(definition.nodes.map((node) => node.nodeType))].sort();
  return {
    workflowId: definition.workflowId,
    name: definition.name,
    description: definition.description,
    owner: definition.owner,
    version: definition.version,
    enabled: definition.enabled,
    certification: definition.certification,
    safetyClass: definition.safetyClass,
    initialNodeId: definition.initialNodeId,
    nodeCount: definition.nodes.length,
    edgeCount: definition.edges.length,
    nodeTypes,
    allowedAgents: definition.allowedAgents,
    allowedTools: definition.allowedTools,
    allowedModelProfiles: definition.allowedModelProfiles,
    limits: definition.limits,
    completion: definition.completion,
    failurePolicy: definition.failurePolicy,
    approvalNodeIds: definition.nodes
      .filter((node) => node.nodeType === 'approval' || node.approval !== undefined)
      .map((node) => node.nodeId),
    sideEffectingNodeIds: definition.nodes
      .filter((node) => SIDE_EFFECTING_NODE_TYPES.includes(node.nodeType))
      .map((node) => node.nodeId),
  };
}

// ── Identifier grammars ─────────────────────────────────────────────────────

/** `workflow.intake.triage` — namespaced, lower case, no surprises in a key. */
export const WORKFLOW_ID_PATTERN = /^workflow\.[a-z0-9]+(\.[a-z0-9_]+)+$/;
/** `node.classify` or `classify_input`. Safe in a key, a log line and a URL. */
export const WORKFLOW_NODE_ID_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,63}$/;
export const WORKFLOW_EDGE_ID_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,63}$/;
export const WORKFLOW_BRANCH_ID_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,47}$/;
/** Strict semantic version. `1.0` and `v1.0.0` are both refused. */
export const SEMANTIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
