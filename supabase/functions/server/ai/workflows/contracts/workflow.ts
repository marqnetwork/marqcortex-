/**
 * Workflow definition contracts (AI-01 Batch 3B, Parts 1 and 3).
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
 * a prompt, a tool or a budget — everything that could make a workflow act on
 * its own is simply absent from the type. What an agent is permitted to do is
 * already settled by its own definition and enforced by the orchestrator; a
 * workflow cannot widen it, and there is no field here through which it could
 * try.
 *
 * ── WHAT PART 3 ADDED ──────────────────────────────────────────────────────
 *
 * Part 1 shipped a one-member `WorkflowNodeKind` and a single-successor rule,
 * because an edge carried no condition and a fan-out without a join is a shape
 * that cannot finish. Part 3 supplies the missing piece — a condition node with
 * an explicit true and false edge — so branching is now representable, and
 * representable in exactly one form: TWO successors, chosen by a boolean, from
 * a node kind that exists to make the choice visible.
 *
 * ── WHAT PART 4 ADDS, AND THE SHAPE IT STILL REFUSES ───────────────────────
 *
 * Fan-out, in exactly one form: a `parallel` node that declares a bounded,
 * NAMED set of branches and the `join` node they all converge on. Part 3's
 * argument against fan-out was that a node with two successors both taken cannot
 * finish without a join — so the join is not optional, it is part of the same
 * declaration, and a parallel node without one is not representable.
 *
 * What is still refused is fan-out as a property of edges. Two plain edges out
 * of an agent node remain invalid, exactly as in Part 3, because that is a fan-
 * out whose convergence nobody declared. Parallelism has to be a node an
 * operator can see, with a policy an operator can read, or it is not available.
 *
 * There is still no approval node, no barrier that waits on something outside
 * the run, no nested parallel and no parallel node inside a loop — see
 * `planner/workflowPlanner.ts` for why the last of those is refused rather than
 * given a visit counter.
 *
 * Cycles have moved the same way: Part 1 refused all of them because a loop
 * needs an exit and an exit needs a condition. Now that conditions exist, a
 * cycle is permitted when — and only when — its closing edge declares an
 * iteration ceiling AND the loop body contains a node that can leave it. An
 * undeclared back edge is still an unbounded cycle and still refused.
 *
 * ── NO CHECKPOINT NODE ─────────────────────────────────────────────────────
 *
 * Part 3's brief allowed a `checkpoint` node kind "if needed". It is not: the
 * engine writes a durable, chained checkpoint after every node that completes,
 * so a checkpoint node would be a node that does nothing, costs a plan slot,
 * and lets an author believe checkpointing is something they opt into. The
 * guarantee is stronger when it is not a node.
 */

import type { Validator } from '../../security/validation.ts';
import type { WorkflowExpression } from './expression.ts';
import type { WorkflowMapping } from './mapping.ts';
import type { WorkflowJoinPolicy, WorkflowParallelFailurePolicy } from './parallel.ts';

/**
 * What a node does when the plan reaches it.
 *
 * Four members, and none of them can do another's job — which is the point: a
 * branch is always a node an operator can see in the plan, never a property of
 * an edge.
 *
 *   agent      runs a registered agent through the orchestrator
 *   condition  evaluates a declared expression and takes one of two edges
 *   parallel   opens a bounded, named set of branches
 *   join       merges what those branches produced, under a declared policy
 *
 * `parallel` and `join` arrive as a PAIR. Neither is meaningful alone, and the
 * definition makes that structural rather than conventional: a parallel node
 * names its join node, and a join node is refused unless exactly one parallel
 * node names it.
 */
export type WorkflowNodeKind = 'agent' | 'condition' | 'parallel' | 'join';

export const WORKFLOW_NODE_KINDS: readonly WorkflowNodeKind[] = [
  'agent',
  'condition',
  'parallel',
  'join',
];

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

interface WorkflowNodeBase {
  /** Unique within the workflow. Appears in plans, logs and metric labels. */
  readonly nodeId: string;
  /** One line, for the plan view and the operator console. */
  readonly displayName: string;
}

export interface WorkflowAgentNode extends WorkflowNodeBase {
  readonly kind: 'agent';
  /** The registered agent this node runs. Never a provider or a model. */
  readonly agentId: string;
  /**
   * Attempts this node may consume before the step is considered failed.
   * A planning-time ceiling, not a retry implementation — retries are not in
   * this batch, and a plan that declares an unbounded one is refused here.
   */
  readonly maxAttempts: number;
  /**
   * How this node's input is built. Absent means the run's validated input is
   * handed over unchanged, which is Part 2's behaviour and remains the default.
   */
  readonly inputMapping?: WorkflowMapping;
  /**
   * The shape the mapped input must satisfy before it leaves the workflow.
   *
   * This is the WORKFLOW's declaration of what it will hand the node, and it is
   * not a replacement for the agent's own input contract — the orchestrator
   * still enforces that downstream. Two contracts, both applied, neither
   * standing in for the other: this one is what the workflow author reviewed,
   * that one is what the agent author reviewed.
   */
  readonly inputContract?: Validator<unknown>;
  /** How this node's stored output is built from what the agent returned. */
  readonly outputMapping?: WorkflowMapping;
  /**
   * The shape the node's output must satisfy to become a TRUSTED output.
   *
   * A node with no output contract stores nothing referenceable — see
   * `contracts/checkpoint.ts`. That is deliberate: "trusted" means "passed a
   * declared schema", and a value nobody declared a schema for has not earned
   * the word.
   */
  readonly outputContract?: Validator<unknown>;
}

export interface WorkflowConditionNode extends WorkflowNodeBase {
  readonly kind: 'condition';
  /**
   * The decision. A data structure, never a string — see
   * `contracts/expression.ts` for why the language has no parser.
   */
  readonly expression: WorkflowExpression;
}

/**
 * One named branch of a parallel node.
 *
 * The name is not decoration. It is the merge key, the identity inside the
 * deterministic branch id, the thing `named_required_branches` names, and the
 * label an operator reads in the console — so it is declared once, here, and
 * every other use derives from it rather than from a position in a list.
 */
export interface WorkflowBranchDeclaration {
  readonly branchName: string;
  /** The first node of the branch body. Owned exclusively by this branch. */
  readonly startNodeId: string;
}

export interface WorkflowParallelNode extends WorkflowNodeBase {
  readonly kind: 'parallel';
  /**
   * The branches, in the order they will be merged.
   *
   * DECLARATION ORDER IS MERGE ORDER. It is not completion order and it is not
   * sorted by name: a merged value that depended on which branch finished first
   * would differ between two runs of the same workflow over the same data, and
   * a reviewer approving this list is approving the order too.
   */
  readonly branches: readonly WorkflowBranchDeclaration[];
  /** The join node every branch of this node converges on. */
  readonly joinNodeId: string;
  readonly failurePolicy: WorkflowParallelFailurePolicy;
  /**
   * A ceiling this workflow places on its own fan-out.
   *
   * May only LOWER the platform ceiling in `WORKFLOW_PARALLEL_BOUNDS`. Present
   * so a workflow that should never fan out past two says so in its definition
   * rather than relying on nobody adding a third branch later.
   */
  readonly maximumParallelBranches?: number;
}

export interface WorkflowJoinNode extends WorkflowNodeBase {
  readonly kind: 'join';
  readonly policy: WorkflowJoinPolicy;
  /**
   * REQUIRED. The shape the merged branch outputs must satisfy.
   *
   * Not optional, unlike an agent node's `outputContract`, and the asymmetry is
   * deliberate: an agent node with no contract simply stores nothing trusted,
   * which is a coherent choice. A join with no contract would promote whatever
   * several branches happened to produce into a single value later nodes branch
   * on, with nobody having declared what that value is. A merge is the one place
   * in this batch where the schema is the point.
   */
  readonly mergeContract: Validator<unknown>;
}

export type WorkflowNode =
  | WorkflowAgentNode
  | WorkflowConditionNode
  | WorkflowParallelNode
  | WorkflowJoinNode;

/**
 * A directed transition between two nodes.
 *
 * `when` is required on the two edges leaving a condition node and forbidden
 * everywhere else, so a branch target is never ambiguous and a non-condition
 * node can never acquire one.
 *
 * `branch` is required on the edges leaving a PARALLEL node and forbidden
 * everywhere else. It names which declared branch the edge opens, so a fan-out
 * edge is never anonymous — an edge out of a parallel node that named no branch
 * would be a successor the merge has no key for.
 *
 * `loop` marks a back edge and declares its ceiling. An edge that closes a
 * cycle without one is an unbounded loop and is refused at registration.
 */
export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
  /** Optional human label for the plan view. Never affects the plan digest. */
  readonly label?: string;
  /** Which branch of a condition node this edge is. */
  readonly when?: boolean;
  /** Which declared branch of a parallel node this edge opens. */
  readonly branch?: string;
  readonly loop?: WorkflowLoopBound;
}

export interface WorkflowLoopBound {
  /**
   * Times this back edge may be taken within one run.
   *
   * Reaching it is a typed terminal failure, not a silent exit: a loop that ran
   * out of iterations did not satisfy its exit condition, and reporting that as
   * completion would be reporting a workflow that did not finish as one that did.
   */
  readonly maxIterations: number;
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
   * a declared start still has to survive cycle and reachability analysis.
   */
  readonly startNodeId?: string;
  /**
   * A workflow-wide ceiling on fan-out.
   *
   * Applies to every parallel node the graph contains, and may only lower the
   * platform ceiling. A per-node ceiling can still lower it further; neither can
   * raise it, and the engine re-checks both before it creates a branch.
   */
  readonly maximumParallelBranches?: number;
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
  readonly conditionCount: number;
  readonly parallelCount: number;
  readonly joinCount: number;
  /** The widest fan-out any single parallel node declares. Zero when there is none. */
  readonly maxBranchCount: number;
  /** Distinct agent ids the graph names, sorted. */
  readonly agentIds: readonly string[];
}

export function isAgentNode(node: WorkflowNode): node is WorkflowAgentNode {
  return node.kind === 'agent';
}

export function isConditionNode(node: WorkflowNode): node is WorkflowConditionNode {
  return node.kind === 'condition';
}

export function isParallelNode(node: WorkflowNode): node is WorkflowParallelNode {
  return node.kind === 'parallel';
}

export function isJoinNode(node: WorkflowNode): node is WorkflowJoinNode {
  return node.kind === 'join';
}

export function describeWorkflow(definition: WorkflowDefinition): WorkflowDescriptor {
  const nodes = definition.nodes ?? [];
  const agentIds = [
    ...new Set(nodes.filter(isAgentNode).map((node) => node.agentId)),
  ].sort();
  const parallelNodes = nodes.filter(isParallelNode);
  return {
    workflowId: definition.workflowId,
    displayName: definition.displayName,
    purpose: definition.purpose,
    description: definition.description,
    owner: definition.owner,
    version: definition.version,
    enabled: definition.enabled,
    certification: definition.certification,
    nodeCount: nodes.length,
    edgeCount: definition.edges?.length ?? 0,
    conditionCount: nodes.filter(isConditionNode).length,
    parallelCount: parallelNodes.length,
    joinCount: nodes.filter(isJoinNode).length,
    maxBranchCount: parallelNodes.reduce(
      (widest, node) => Math.max(widest, node.branches?.length ?? 0),
      0,
    ),
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
  /**
   * Ceiling on a declared loop bound, and on the total iterations one run may
   * spend across every loop. The second is what stops three nested loops of
   * thirty-two from being thirty-two thousand agent runs.
   */
  loopIterations: { min: 1, max: 32 },
  maxTotalLoopIterations: 64,
  /**
   * Parallel nodes one graph may declare.
   *
   * Each one costs a durable group on the run record, and the run-record ceiling
   * in `WORKFLOW_PARALLEL_BOUNDS.maxGroupsPerRun` is what a run can actually
   * spend — this bound keeps a definition from declaring more than a run could
   * ever execute, which is a mistake better caught at registration.
   */
  parallelNodes: { max: 4 },
} as const;

/** Node and workflow identifiers must be safe in a key, a log line and a label. */
export const WORKFLOW_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_]*)+$/;
export const WORKFLOW_NODE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const WORKFLOW_AGENT_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_]*)+$/;
export const WORKFLOW_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
