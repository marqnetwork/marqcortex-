/**
 * Workflow definition contracts (AI-01 Batch 3B, Part 1).
 *
 * A workflow definition is the declarative, versioned description of how
 * several agents are meant to follow one another to reach an outcome. It is to
 * the agent runtime what `contracts/agent.ts` is to a single agent: governance
 * that lives in data, reviewable and diffable, validated once at registration
 * rather than discovered one run at a time.
 *
 * THE RULE THIS FILE ENCODES.
 *
 *   A WORKFLOW DESCRIBES AN ORDER. IT NEVER DESCRIBES AN EFFECT.
 *
 * A node names an agent. It does not carry a provider, a model, a credential,
 * a prompt, a tool, a budget or a piece of tenant data — everything that could
 * make a workflow act on its own is simply absent from the type. What an agent
 * is permitted to do is already settled by its own definition and enforced by
 * the orchestrator; a workflow cannot widen it, and there is no field here
 * through which it could try.
 *
 * WHAT PART 1 DELIBERATELY CANNOT EXPRESS.
 *
 * `WorkflowNodeKind` is a union of one. Conditions, parallel fan-out, joins and
 * approval nodes are Part 2, and the honest way to scope Part 1 is to make them
 * unrepresentable rather than to accept them into the schema and quietly ignore
 * them at planning time. A definition that needs branching is refused with a
 * message that says so, which is a better answer than a plan whose execution
 * semantics do not exist yet.
 */

import type { Validator } from '../../security/validation.ts';

/**
 * What a node does when the plan reaches it.
 *
 * One member today: run a registered agent. The union exists so Part 2 can add
 * `condition`, `parallel`, `join` and `approval` without reshaping every node,
 * every plan step and every consumer of this contract.
 */
export type WorkflowNodeKind = 'agent';

export const WORKFLOW_NODE_KINDS: readonly WorkflowNodeKind[] = ['agent'];

/**
 * Certification status, with the same three-way meaning agents carry: only
 * `certified` may run where certification is demanded, and `revoked` may never
 * run anywhere. Declared here rather than imported from the agent contracts
 * because a workflow's certification is a judgement about the workflow — the
 * two happen to share a vocabulary, not a source of truth.
 */
export type WorkflowCertificationStatus = 'certified' | 'testing' | 'uncertified' | 'revoked';

export const WORKFLOW_CERTIFICATION_STATUSES: readonly WorkflowCertificationStatus[] = [
  'certified',
  'testing',
  'uncertified',
  'revoked',
];

export interface WorkflowNode {
  /** Unique within the workflow. Appears in plans, logs and metric labels. */
  readonly nodeId: string;
  readonly kind: WorkflowNodeKind;
  /** The registered agent this node runs. Never a provider or a model. */
  readonly agentId: string;
  /** One line, for the plan view and the operator console. */
  readonly displayName: string;
  /**
   * Attempts this node may consume before the step is considered failed.
   * A planning-time ceiling, not a retry implementation — Part 2's executor
   * enforces it, and a plan that declares an unbounded one is refused here.
   */
  readonly maxAttempts: number;
}

/**
 * A directed transition between two nodes.
 *
 * There is no condition on an edge in Part 1, and that absence is what forces
 * the single-successor rule in `validation/workflowValidation.ts`: without a
 * predicate to choose between two outgoing edges, a node with two of them
 * describes a fan-out, and fan-out without a join is a shape this batch does
 * not know how to finish.
 */
export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
  /** Optional human label for the plan view. Never affects the plan digest. */
  readonly label?: string;
}

export interface WorkflowDefinition {
  readonly workflowId: string;
  readonly displayName: string;
  /** One line: what this workflow is for. */
  readonly purpose: string;
  readonly description: string;
  /** Team accountable for this workflow's behaviour. */
  readonly owner: string;
  /** Bumped whenever the graph, the contracts or the node set change. */
  readonly version: string;
  readonly enabled: boolean;
  readonly certification: WorkflowCertificationStatus;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  /**
   * Where the plan begins. Optional: when omitted the planner resolves the one
   * node nothing points at. Declaring it is not a shortcut past that check —
   * a declared start that is not reachable-from-nowhere still has to survive
   * cycle and reachability analysis.
   */
  readonly startNodeId?: string;
  /** The shape a run's input must have for this workflow to accept it. */
  readonly inputContract: Validator<unknown>;
  /** The shape this workflow's output must have to be accepted as complete. */
  readonly outputContract: Validator<unknown>;
}

/** A definition reduced to what an API or a console may see. */
export interface WorkflowDescriptor {
  readonly workflowId: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly description: string;
  readonly owner: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly certification: WorkflowCertificationStatus;
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** Distinct agent ids the graph names, sorted. */
  readonly agentIds: readonly string[];
}

export function describeWorkflow(definition: WorkflowDefinition): WorkflowDescriptor {
  const agentIds = [...new Set((definition.nodes ?? []).map((node) => node.agentId))].sort();
  return {
    workflowId: definition.workflowId,
    displayName: definition.displayName,
    purpose: definition.purpose,
    description: definition.description,
    owner: definition.owner,
    version: definition.version,
    enabled: definition.enabled,
    certification: definition.certification,
    nodeCount: definition.nodes?.length ?? 0,
    edgeCount: definition.edges?.length ?? 0,
    agentIds,
  };
}

/**
 * Ceilings on the shape of a graph.
 *
 * A registry that accepted a thousand-node workflow would have a planner in
 * name only: the plan is held whole in memory, digested whole, and rendered
 * whole in an operator console. These are the sizes the rest of the batch is
 * built for, and validation fails closed against them.
 */
export const WORKFLOW_BOUNDS = {
  nodes: { min: 1, max: 64 },
  edges: { min: 0, max: 128 },
  nodeAttempts: { min: 1, max: 8 },
  /** Longest chain a plan may describe. Equal to the node ceiling by design. */
  maxPlanDepth: 64,
} as const;

/** Node and workflow identifiers must be safe in a key, a log line and a label. */
export const WORKFLOW_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_]*)+$/;
export const WORKFLOW_NODE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const WORKFLOW_AGENT_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_]*)+$/;
export const WORKFLOW_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
