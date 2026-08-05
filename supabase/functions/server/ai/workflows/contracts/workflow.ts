/**
 * Workflow definition contracts (AI-01 Batch 3B).
 *
 * THE RULE THIS FILE ENCODES:
 *
 *   WORKFLOWS PLAN. AGENTS PROPOSE. THE ORCHESTRATOR DECIDES.
 *   THE AI CONTROL PLANE EXECUTES.
 *
 * A workflow definition is a declarative, versioned, acyclic plan: which units
 * of work exist, what each depends on, when each is allowed to run and what has
 * to be true for the plan to continue. It contains no behaviour. There is no
 * `run` function on a node, no expression language, no template evaluation and
 * no place to put a script — everything a node does is delegated to a REGISTERED
 * AGENT or a REGISTERED TOOL, both of which are already governed by Batch 3A.
 *
 * That absence is the design. A workflow that could execute its own logic would
 * be a third execution path alongside the control plane and the agent runtime,
 * and every guarantee those two make would simply not apply to it.
 *
 * WHAT A WORKFLOW NEVER DECLARES: a provider, a model, a model profile, a
 * credential, a budget larger than the platform's, an organization other than
 * the run's, or an agent it is not the workflow author's to name. Model
 * selection remains the control plane's; agent permissions remain the agent
 * registry's; a workflow can only compose what already exists and is already
 * allowed.
 *
 * CONDITIONS AND JOINS ARE DATA, NOT CODE.
 *
 *   A CONDITION is a comparison against the workflow's FACT MAP — a bounded
 *   collection of scalars each completed node contributed. There is no
 *   expression parser, no arithmetic and no way to reference anything outside
 *   the map, because a workflow language with an evaluator is a workflow
 *   language with an injection surface.
 *
 *   A JOIN is a policy over a node's declared dependencies: all of them, any of
 *   them, or a quorum. Expressed as an enum and a number rather than as a
 *   predicate, so "what does this node wait for?" is answered by reading the
 *   definition rather than by executing it.
 */

/** What a node delegates its work to. Both targets are already governed. */
export type WorkflowNodeKind =
  /** Creates and drives one agent run through the certified agent runtime. */
  | 'agent'
  /** Calls one registered tool through the certified tool gateway. */
  | 'tool'
  /** Pauses the workflow for a human decision. Executes nothing. */
  | 'approval'
  /** Ends the workflow. Carries the outcome the plan reached. */
  | 'terminal';

export const WORKFLOW_NODE_KINDS: readonly WorkflowNodeKind[] = [
  'agent',
  'tool',
  'approval',
  'terminal',
];

/**
 * How many of a node's dependencies must have succeeded before it may run.
 *
 * `all` is the default and the only one that needs no further configuration.
 * `any` is a race the plan has declared it can tolerate; `quorum` is the middle
 * ground and requires an explicit count, because a quorum whose size is implied
 * is a quorum nobody agreed to.
 */
export type WorkflowJoinPolicy = 'all' | 'any' | 'quorum';

export interface WorkflowJoin {
  readonly policy: WorkflowJoinPolicy;
  /** Required when the policy is `quorum`. Ignored otherwise. */
  readonly quorum?: number;
}

/**
 * Comparisons a condition may make.
 *
 * Deliberately few, deliberately total, and deliberately without arithmetic. A
 * condition answers a question about a fact somebody already recorded; it does
 * not compute a new one.
 */
export type WorkflowConditionOperator =
  | 'exists'
  | 'absent'
  | 'equals'
  | 'not_equals'
  | 'gte'
  | 'lte'
  | 'is_true'
  | 'is_false';

/**
 * One comparison against the fact map.
 *
 * `fact` is a flat key of the form `nodeId.name`, produced by the node that
 * contributed it. It is a lookup, not a path expression: there is no traversal,
 * no wildcard and no index, so a fact key cannot reach anything the contributing
 * node did not deliberately publish.
 */
export interface WorkflowCondition {
  readonly fact: string;
  readonly operator: WorkflowConditionOperator;
  /** Compared value. Scalars only — the fact map holds nothing else. */
  readonly value?: string | number | boolean;
}

/**
 * A node's guard: every condition must hold.
 *
 * Conjunction only. Disjunction is expressible by giving a node two upstream
 * paths and an `any` join, which keeps the plan's branching visible in the graph
 * rather than hidden inside a boolean expression.
 */
export type WorkflowGuard = readonly WorkflowCondition[];

/** What a node publishes for later conditions to read. Scalars, bounded. */
export interface WorkflowFactDeclaration {
  /** Name the fact is published under, joined to the node id as `nodeId.name`. */
  readonly name: string;
  /**
   * Field of the node's result to read. For an agent node the result is the
   * accepted completion output; for a tool node it is the validated tool output.
   * A field that is missing or is not a scalar publishes nothing rather than
   * publishing a stringified object — a fact map that can hold a structure is a
   * fact map that can hold content.
   */
  readonly from: string;
}

export interface WorkflowNodeBase {
  readonly nodeId: string;
  readonly kind: WorkflowNodeKind;
  readonly displayName: string;
  /** One line: what this step of the plan is for. Shown to an operator. */
  readonly purpose: string;
  /** Node ids that must settle before this one is considered. Never cyclic. */
  readonly dependsOn: readonly string[];
  /** How many dependencies must have SUCCEEDED. Defaults to `all`. */
  readonly join?: WorkflowJoin;
  /** Additional conditions over the fact map. All must hold. */
  readonly when?: WorkflowGuard;
  /** Facts this node publishes when it succeeds. */
  readonly publishes?: readonly WorkflowFactDeclaration[];
  /**
   * True when the plan may continue if this node fails.
   *
   * Default false: a failure stops the workflow. A node marked optional records
   * its failure, publishes nothing, and lets downstream joins decide — which is
   * why `any` and `quorum` joins exist at all.
   */
  readonly optional?: boolean;
}

export interface WorkflowAgentNode extends WorkflowNodeBase {
  readonly kind: 'agent';
  /** A registered agent id. Resolved through the certified agent registry. */
  readonly agentId: string;
  /** The objective handed to the agent run. Bounded, never a template. */
  readonly objective: string;
  /**
   * Facts from the map to pass as the run's input, keyed by input field.
   *
   * A mapping, not an interpolation: the value of `input[key]` is the value of
   * the named fact, unchanged. There is no string building, so nothing a prior
   * node published can alter the SHAPE of what the next agent receives — only
   * the values of fields the plan declared.
   */
  readonly inputFromFacts?: Readonly<Record<string, string>>;
  /** Constant input fields. Merged under the mapped facts. */
  readonly input?: Readonly<Record<string, string | number | boolean>>;
}

export interface WorkflowToolNode extends WorkflowNodeBase {
  readonly kind: 'tool';
  /** A registered tool id. Executed through the certified tool gateway. */
  readonly toolId: string;
  readonly inputFromFacts?: Readonly<Record<string, string>>;
  readonly input?: Readonly<Record<string, string | number | boolean>>;
}

export interface WorkflowApprovalNode extends WorkflowNodeBase {
  readonly kind: 'approval';
  /** One sentence an approver can act on without reading the workflow. */
  readonly impactSummary: string;
  /** What the decision touches. Bounded labels, never records. */
  readonly dataAffected: readonly string[];
  /** Roles permitted to decide. Resolved server-side; never caller-asserted. */
  readonly approverRoles: readonly string[];
  readonly expiresAfterMs: number;
}

export interface WorkflowTerminalNode extends WorkflowNodeBase {
  readonly kind: 'terminal';
  /** The outcome reaching this node declares. */
  readonly outcome: 'succeeded' | 'failed';
}

export type WorkflowNode =
  | WorkflowAgentNode
  | WorkflowToolNode
  | WorkflowApprovalNode
  | WorkflowTerminalNode;

/**
 * Hard ceilings on one workflow run.
 *
 * Every one is enforced by the orchestrator and every one has a terminal
 * outcome. The token and cost ceilings bound the SUM of the agent runs the
 * workflow starts — a workflow that could start ten runs each inside its own
 * limits, with no ceiling of its own, would have no budget at all.
 */
export interface WorkflowLimits {
  /** Nodes the definition may declare. Bounds the plan itself. */
  readonly maxNodes: number;
  /** Nodes that may execute concurrently. The bound on bounded parallelism. */
  readonly maxParallel: number;
  /** Waves the planner may produce. Bounds the depth of the graph. */
  readonly maxWaves: number;
  /** Node executions the run may perform, across every wave and retry. */
  readonly maxNodeExecutions: number;
  /** Wall-clock budget for the whole workflow, from creation. */
  readonly maxRuntimeMs: number;
  /** Ceiling on the sum of the agent runs' measured tokens. */
  readonly maxTotalTokens: number;
  /** Ceiling on the sum of the agent runs' projected cost. */
  readonly maxEstimatedCostMicroUsd: number;
  /** Ceiling on the sum of the agent runs' measured cost. */
  readonly maxActualCostMicroUsd: number;
  /** Approval gates one run may open. */
  readonly maxApprovals: number;
}

/** Certification, with the same meaning it has for agents and providers. */
export type WorkflowCertificationStatus = 'certified' | 'testing' | 'uncertified' | 'revoked';

export interface WorkflowDefinition {
  readonly workflowId: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly description: string;
  readonly owner: string;
  /** Bumped whenever the plan, its limits or its nodes change. */
  readonly version: string;
  readonly enabled: boolean;
  readonly certification: WorkflowCertificationStatus;
  /** The node the plan starts from. Must have no dependencies. */
  readonly entryNodeId: string;
  readonly nodes: readonly WorkflowNode[];
  readonly limits: WorkflowLimits;
}

/** A definition as an API or console may see it. Identical: there is no behaviour. */
export interface WorkflowDescriptor {
  readonly workflowId: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly description: string;
  readonly owner: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly certification: WorkflowCertificationStatus;
  readonly entryNodeId: string;
  readonly nodeCount: number;
  readonly nodes: readonly {
    readonly nodeId: string;
    readonly kind: WorkflowNodeKind;
    readonly displayName: string;
    readonly purpose: string;
    readonly dependsOn: readonly string[];
    readonly join: WorkflowJoin;
    readonly conditions: number;
    readonly optional: boolean;
    readonly agentId?: string;
    readonly toolId?: string;
  }[];
  readonly limits: WorkflowLimits;
}

export function describeWorkflow(definition: WorkflowDefinition): WorkflowDescriptor {
  return {
    workflowId: definition.workflowId,
    displayName: definition.displayName,
    purpose: definition.purpose,
    description: definition.description,
    owner: definition.owner,
    version: definition.version,
    enabled: definition.enabled,
    certification: definition.certification,
    entryNodeId: definition.entryNodeId,
    nodeCount: definition.nodes.length,
    nodes: definition.nodes.map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind,
      displayName: node.displayName,
      purpose: node.purpose,
      dependsOn: node.dependsOn,
      join: node.join ?? { policy: 'all' },
      conditions: node.when?.length ?? 0,
      optional: node.optional === true,
      ...(node.kind === 'agent' ? { agentId: node.agentId } : {}),
      ...(node.kind === 'tool' ? { toolId: node.toolId } : {}),
    })),
    limits: definition.limits,
  };
}

/**
 * Ceilings on the ceilings.
 *
 * The run record holds one entry per node and one per execution, and the planner
 * builds a wave list bounded by the node count. These are the sizes those
 * structures are built for, and registration fails closed against them — the
 * same decision `AGENT_LIMIT_BOUNDS` makes, for the same reason.
 */
export const WORKFLOW_LIMIT_BOUNDS = {
  maxNodes: { min: 1, max: 48 },
  maxParallel: { min: 1, max: 8 },
  maxWaves: { min: 1, max: 32 },
  maxNodeExecutions: { min: 1, max: 96 },
  maxRuntimeMs: { min: 1_000, max: 3_600_000 },
  maxTotalTokens: { min: 1, max: 2_000_000 },
  maxEstimatedCostMicroUsd: { min: 0, max: 10_000_000 },
  maxActualCostMicroUsd: { min: 0, max: 10_000_000 },
  maxApprovals: { min: 0, max: 16 },
  approvalExpiresAfterMs: { min: 60_000, max: 604_800_000 },
} as const;

/** Bounds a malformed or hostile definition is rejected against. */
export const WORKFLOW_BOUNDS = {
  displayName: { min: 1, max: 120 },
  purpose: { min: 1, max: 300 },
  objective: { min: 3, max: 2_000 },
  factName: { min: 1, max: 60 },
  maxFactsPerNode: 8,
  maxFactsTotal: 64,
  maxConditionsPerNode: 8,
  maxDependencies: 8,
  maxInputFields: 16,
  maxImpactSummary: 500,
  maxDataAffected: 12,
  /** Characters any single fact value may carry. Facts are labels, not content. */
  maxFactValueChars: 200,
} as const;
