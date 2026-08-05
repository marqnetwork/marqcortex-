/**
 * The Workflow Planner (AI-01 Batch 3B).
 *
 * Compiles a registered definition into an executable plan: the reachable node
 * set, the branch and join dependency tables, and the worst case the run could
 * possibly reach in steps, retries, tokens and money.
 *
 * NO LANGUAGE MODEL BUILDS THIS PLAN, and that is a scope decision the batch
 * states explicitly. A plan is the artefact every subsequent control is
 * enforced against — the step ceiling, the token preflight, the cost preflight,
 * the join's expected branch set — so it has to be reproducible and reviewable.
 * A plan a model produced would be neither: two runs of the same definition
 * could disagree about how many steps exist, and an incident review could not
 * establish what the engine believed at the time.
 *
 * THE WORST CASE IS THE POINT.
 *
 * A definition's own limits bound what one run may spend. They do not say
 * whether the GRAPH can spend it: a graph with three branches, each holding a
 * model node with two retries, can reach nine model calls where a reader counted
 * three. The planner computes that number before anything runs and refuses the
 * plan when it crosses a platform bound — which is a design error caught at
 * planning time rather than a budget breach caught at spend time.
 *
 * MULTIPLICITY, NOT NODE COUNT. A node inside a fan-out executes once per branch
 * that contains it. Costing the node once would under-report every parallel
 * workflow, so each node carries the number of branch subgraphs it appears in
 * and every exposure figure is multiplied by it. Under-estimating is the one
 * direction a budget control must never fail in.
 *
 * DETERMINISTIC DIGEST. The manifest is canonicalised with sorted keys and
 * digested, and the digest is persisted on the run. A resumed run therefore
 * proves it is executing the same plan it started, and a definition edited
 * between two runs produces two visibly different digests.
 */

import type {
  WorkflowDefinition,
  WorkflowJoinNode,
  WorkflowJoinPolicy,
  WorkflowNode,
  WorkflowNodeType,
} from '../contracts/workflow.ts';
import {
  BILLABLE_NODE_TYPES,
  PLATFORM_PLAN_BOUNDS,
  SEMANTIC_VERSION_PATTERN,
  SIDE_EFFECTING_NODE_TYPES,
} from '../contracts/workflow.ts';
import { workflowFailure } from '../contracts/failures.ts';
import type { WorkflowGraph } from '../runtime/graph.ts';
import {
  branchEdgesOf,
  branchSubgraph,
  buildGraph,
  edgesFrom,
  findCycle,
  longestPathLength,
  reachableFrom,
} from '../runtime/graph.ts';
import { digestValue } from '../../agents/runtime/digest.ts';

/** Prices a hypothetical call so the planner can cost a model node. */
export type ProfilePricer = (
  profileId: string,
  promptTokens: number,
  completionTokens: number,
) => number;

export interface PlannedNode {
  readonly nodeId: string;
  readonly nodeType: WorkflowNodeType;
  /** Branch subgraphs this node appears in. At least 1. */
  readonly multiplicity: number;
  /** Attempts including the first. `1 + retry.maxAttempts`. */
  readonly maxAttempts: number;
  readonly billable: boolean;
  readonly sideEffecting: boolean;
  readonly requiresApproval: boolean;
  readonly cacheable: boolean;
  readonly worstCaseTokens: number;
  readonly worstCaseCostMicroUsd: number;
  /** Branch this node belongs to, when it sits inside exactly one fan-out arm. */
  readonly branchIds: readonly string[];
  readonly depth: number;
}

export interface PlannedBranch {
  readonly branchId: string;
  readonly parallelNodeId: string;
  readonly joinNodeId: string;
  readonly startNodeId: string;
  readonly nodeIds: readonly string[];
  readonly depth: number;
}

export interface PlannedJoin {
  readonly joinNodeId: string;
  readonly parallelNodeId: string;
  readonly policy: WorkflowJoinPolicy;
  /** Known from the plan, never from what has arrived. */
  readonly expectedBranchIds: readonly string[];
  readonly minimumSuccesses: number;
  readonly requiredBranchIds: readonly string[];
  readonly onSatisfied: 'cancel_remaining' | 'wait_all';
  readonly failurePolicy: 'fail_fast' | 'wait_all';
}

export interface WorkflowPlanManifest {
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly initialNodeId: string;
  readonly nodes: readonly PlannedNode[];
  readonly branches: readonly PlannedBranch[];
  readonly joins: readonly PlannedJoin[];
  readonly approvalNodeIds: readonly string[];
  readonly sideEffectingNodeIds: readonly string[];
  readonly billableNodeIds: readonly string[];
  readonly cacheableNodeIds: readonly string[];
  readonly worstCaseSteps: number;
  readonly worstCaseRetries: number;
  readonly worstCasePromptTokens: number;
  readonly worstCaseCompletionTokens: number;
  readonly worstCaseTotalTokens: number;
  readonly worstCaseCostMicroUsd: number;
  readonly maxParallelism: number;
  readonly maxBranchDepth: number;
  readonly longestPathNodes: number;
}

export interface WorkflowPlan {
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly initialNodeId: string;
  readonly manifest: WorkflowPlanManifest;
  /** Digest over the plan's executable identity. Persisted on the run. */
  readonly digest: string;
  /** Digest over the whole manifest, including its advisory figures. */
  readonly manifestDigest: string;
  readonly nodesById: ReadonlyMap<string, PlannedNode>;
  readonly branchesById: ReadonlyMap<string, PlannedBranch>;
  readonly joinsByNodeId: ReadonlyMap<string, PlannedJoin>;
  readonly graph: WorkflowGraph;
}

export interface PlanOptions {
  /**
   * Prices a model node's worst case. Omitted, the planner falls back to the
   * node's declared cost allowance — which is the definition's own claim about
   * what the node may spend, and therefore a legitimate bound, but a weaker one
   * than a profile's indicative rate.
   */
  readonly price?: ProfilePricer;
}

/**
 * Compile a plan, or refuse.
 *
 * Every refusal here is a definition-level defect: a bad version, a cycle the
 * registry did not see, or a worst case above what the platform will admit. A
 * run never reaches a node with an uncompilable plan behind it.
 */
export function planWorkflow(
  definition: WorkflowDefinition,
  options: PlanOptions = {},
): WorkflowPlan {
  if (!SEMANTIC_VERSION_PATTERN.test(definition.version ?? '')) {
    throw workflowFailure('invalid_workflow_definition', 'That workflow version is not usable.', {
      workflowId: definition.workflowId,
      diagnostics: `version "${definition.version}" is not a semantic version`,
    });
  }

  const graph = buildGraph(definition);
  if (!graph.nodesById.has(definition.initialNodeId)) {
    throw workflowFailure('invalid_workflow_definition', 'That workflow has no initial node.', {
      workflowId: definition.workflowId,
      diagnostics: `initial node "${definition.initialNodeId}" is not declared`,
    });
  }
  // The registry already refuses a cycle. Re-checking is not redundancy: the
  // planner's traversals and its longest-path measurement are only correct on
  // an acyclic graph, and a planner that assumed a property it did not verify
  // would hang rather than refuse if that assumption ever broke.
  const cycle = findCycle(graph, definition.initialNodeId);
  if (cycle) {
    throw workflowFailure('invalid_workflow_definition', 'That workflow graph contains a cycle.', {
      workflowId: definition.workflowId,
      diagnostics: `cycle: ${cycle.join(' → ')}`,
    });
  }

  const reachable = reachableFrom(graph, definition.initialNodeId);
  const reachableSet = new Set(reachable);

  // ── Branch and join tables ──────────────────────────────────────────────────
  const branches: PlannedBranch[] = [];
  const joins: PlannedJoin[] = [];
  /** nodeId → the branch ids whose subgraph contains it. */
  const branchMembership = new Map<string, Set<string>>();
  /** parallel nodeId → nesting depth, computed from the fan-out tree. */
  const parallelDepth = new Map<string, number>();

  const parallelNodes = definition.nodes
    .filter((node): node is Extract<WorkflowNode, { nodeType: 'parallel' }> =>
      node.nodeType === 'parallel',
    )
    .filter((node) => reachableSet.has(node.nodeId))
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  // Depth is resolved by walking the fan-out tree from the outermost parallels
  // inward. A parallel inside a branch is one level deeper than the parallel
  // that opened that branch, which is the number `maxBranchDepth` bounds.
  const branchOwnerOfNode = new Map<string, string>();
  for (const node of parallelNodes) {
    for (const edge of branchEdgesOf(graph, node)) {
      const branchId = edge.branchId ?? edge.edgeId;
      const subgraph = branchSubgraph(graph, {
        branchId,
        startNodeId: edge.to,
        joinNodeId: node.joinNodeId,
      });
      for (const nodeId of subgraph.nodeIds) {
        if (!branchOwnerOfNode.has(nodeId)) branchOwnerOfNode.set(nodeId, branchId);
      }
    }
  }

  const depthOf = (parallelNodeId: string, guard: ReadonlySet<string>): number => {
    const cached = parallelDepth.get(parallelNodeId);
    if (cached !== undefined) return cached;
    if (guard.has(parallelNodeId)) return 1;
    const owningBranch = branchOwnerOfNode.get(parallelNodeId);
    let depth = 1;
    if (owningBranch !== undefined) {
      const owner = parallelNodes.find((candidate) =>
        branchEdgesOf(graph, candidate).some(
          (edge) => (edge.branchId ?? edge.edgeId) === owningBranch,
        ),
      );
      if (owner) {
        const nextGuard = new Set(guard);
        nextGuard.add(parallelNodeId);
        depth = depthOf(owner.nodeId, nextGuard) + 1;
      }
    }
    parallelDepth.set(parallelNodeId, depth);
    return depth;
  };

  for (const node of parallelNodes) {
    const depth = depthOf(node.nodeId, new Set<string>());
    const join = definition.nodes.find(
      (candidate): candidate is WorkflowJoinNode =>
        candidate.nodeId === node.joinNodeId && candidate.nodeType === 'join',
    );
    if (!join) {
      throw workflowFailure('invalid_workflow_definition', 'That fan-out has no join.', {
        workflowId: definition.workflowId,
        nodeId: node.nodeId,
        diagnostics: `parallel node "${node.nodeId}" names join "${node.joinNodeId}", which is not a join node`,
      });
    }

    const branchIds: string[] = [];
    for (const edge of branchEdgesOf(graph, node)) {
      const branchId = edge.branchId ?? edge.edgeId;
      const subgraph = branchSubgraph(graph, {
        branchId,
        startNodeId: edge.to,
        joinNodeId: node.joinNodeId,
      });
      if (!subgraph.reachesJoin) {
        throw workflowFailure('invalid_workflow_definition', 'That branch never reaches its join.', {
          workflowId: definition.workflowId,
          nodeId: node.nodeId,
          branchId,
          diagnostics: `branch "${branchId}" cannot arrive at join "${node.joinNodeId}"`,
        });
      }
      branchIds.push(branchId);
      branches.push({
        branchId,
        parallelNodeId: node.nodeId,
        joinNodeId: node.joinNodeId,
        startNodeId: edge.to,
        nodeIds: subgraph.nodeIds,
        depth,
      });
      for (const nodeId of subgraph.nodeIds) {
        const memberships = branchMembership.get(nodeId) ?? new Set<string>();
        memberships.add(branchId);
        branchMembership.set(nodeId, memberships);
      }
    }

    const minimum =
      join.policy === 'all'
        ? branchIds.length
        : join.policy === 'any'
          ? 1
          : join.policy === 'minimum_successes'
            ? Math.max(1, Math.floor(join.minimumSuccesses ?? 1))
            : (join.requiredBranchIds ?? []).length;

    joins.push({
      joinNodeId: join.nodeId,
      parallelNodeId: node.nodeId,
      policy: join.policy,
      expectedBranchIds: [...branchIds].sort(),
      minimumSuccesses: minimum,
      requiredBranchIds: [...(join.requiredBranchIds ?? [])].sort(),
      onSatisfied: join.onSatisfied,
      failurePolicy: join.failurePolicy,
    });

    // A join whose minimum can never be met is a run that would wait until its
    // deadline. Refusing here turns a silent hang into a planning failure.
    if (minimum > branchIds.length) {
      throw workflowFailure('invalid_workflow_definition', 'That join can never be satisfied.', {
        workflowId: definition.workflowId,
        nodeId: join.nodeId,
        diagnostics: `join requires ${minimum} of ${branchIds.length} branches`,
      });
    }
  }

  // ── Per-node exposure ─────────────────────────────────────────────────────
  const price =
    options.price ??
    ((_profileId: string, _promptTokens: number, _completionTokens: number) => 0);

  const nodes: PlannedNode[] = [];
  let worstCaseSteps = 0;
  let worstCaseRetries = 0;
  let worstCasePromptTokens = 0;
  let worstCaseCompletionTokens = 0;
  let worstCaseCostMicroUsd = 0;

  for (const nodeId of [...reachable].sort()) {
    const node = graph.nodesById.get(nodeId);
    if (!node) continue;
    const memberships = [...(branchMembership.get(nodeId) ?? new Set<string>())].sort();
    const multiplicity = Math.max(1, memberships.length);
    const maxAttempts = 1 + Math.max(0, Math.floor(node.retry?.maxAttempts ?? 0));
    const billable = BILLABLE_NODE_TYPES.includes(node.nodeType);
    const depth =
      memberships.length === 0
        ? 0
        : Math.max(
            ...branches
              .filter((branch) => memberships.includes(branch.branchId))
              .map((branch) => branch.depth),
          );

    // Prompt and completion are split so the plan's token exposure can be
    // compared against the two separate ceilings the definition declares. A
    // single blended figure would pass a total check while breaching a prompt
    // one.
    let nodePromptTokens = 0;
    let nodeCompletionTokens = 0;
    let nodeCost = 0;
    if (node.nodeType === 'model') {
      // The node's own allowance is the ceiling for one attempt. Splitting it
      // three-quarters prompt / one-quarter completion mirrors how the token
      // optimizer actually budgets a step, and both halves are then bounded by
      // the allowance itself so the split can never inflate the total.
      nodePromptTokens = Math.ceil(node.tokenAllowance * 0.75);
      nodeCompletionTokens = node.tokenAllowance - nodePromptTokens;
      nodeCost = Math.max(
        node.costAllowanceMicroUsd,
        price(node.modelProfileId, nodePromptTokens, nodeCompletionTokens),
      );
    } else if (node.nodeType === 'agent') {
      // An agent node's cost is bounded by its declared allowance: the agent
      // runtime enforces its OWN limits on every step it takes, so the plan
      // does not attempt to re-derive an agent's internal worst case. What it
      // must not do is treat an agent node as free.
      nodePromptTokens = Math.ceil(node.tokenAllowance * 0.75);
      nodeCompletionTokens = node.tokenAllowance - nodePromptTokens;
      nodeCost = node.costAllowanceMicroUsd;
    }

    const worstTokens = (nodePromptTokens + nodeCompletionTokens) * maxAttempts * multiplicity;
    const worstCost = nodeCost * maxAttempts * multiplicity;

    nodes.push({
      nodeId,
      nodeType: node.nodeType,
      multiplicity,
      maxAttempts,
      billable,
      sideEffecting: SIDE_EFFECTING_NODE_TYPES.includes(node.nodeType),
      requiresApproval: node.nodeType === 'approval' || node.approval !== undefined,
      cacheable: node.nodeType === 'model' ? node.cacheable : false,
      worstCaseTokens: worstTokens,
      worstCaseCostMicroUsd: worstCost,
      branchIds: memberships,
      depth,
    });

    worstCaseSteps += maxAttempts * multiplicity;
    worstCaseRetries += (maxAttempts - 1) * multiplicity;
    worstCasePromptTokens += nodePromptTokens * maxAttempts * multiplicity;
    worstCaseCompletionTokens += nodeCompletionTokens * maxAttempts * multiplicity;
    worstCaseCostMicroUsd += worstCost;
  }

  // ── Parallelism ───────────────────────────────────────────────────────────
  //
  // Nested fan-outs multiply: two branches each containing a three-branch
  // parallel can have six arms open at once. Taking the maximum rather than the
  // product would under-report exactly the shape that most needs bounding.
  const parallelismAt = (parallelNodeId: string, guard: ReadonlySet<string>): number => {
    if (guard.has(parallelNodeId)) return 1;
    const node = parallelNodes.find((candidate) => candidate.nodeId === parallelNodeId);
    if (!node) return 1;
    const nextGuard = new Set(guard);
    nextGuard.add(parallelNodeId);
    let total = 0;
    for (const branch of branches.filter((entry) => entry.parallelNodeId === parallelNodeId)) {
      const nested = branch.nodeIds
        .map((nodeId) => parallelNodes.find((candidate) => candidate.nodeId === nodeId))
        .filter((candidate): candidate is Extract<WorkflowNode, { nodeType: 'parallel' }> =>
          candidate !== undefined,
        );
      const inner =
        nested.length === 0
          ? 1
          : Math.max(...nested.map((entry) => parallelismAt(entry.nodeId, nextGuard)));
      total += inner;
    }
    return Math.max(1, total);
  };

  const outermostParallels = parallelNodes.filter(
    (node) => (parallelDepth.get(node.nodeId) ?? 1) === 1,
  );
  const maxParallelism =
    outermostParallels.length === 0
      ? 1
      : Math.max(...outermostParallels.map((node) => parallelismAt(node.nodeId, new Set<string>())));
  const maxBranchDepth = branches.length === 0 ? 0 : Math.max(...branches.map((b) => b.depth));

  const manifest: WorkflowPlanManifest = {
    workflowId: definition.workflowId,
    workflowVersion: definition.version,
    initialNodeId: definition.initialNodeId,
    nodes,
    branches: [...branches].sort((a, b) => a.branchId.localeCompare(b.branchId)),
    joins: [...joins].sort((a, b) => a.joinNodeId.localeCompare(b.joinNodeId)),
    approvalNodeIds: nodes.filter((node) => node.requiresApproval).map((node) => node.nodeId),
    sideEffectingNodeIds: nodes.filter((node) => node.sideEffecting).map((node) => node.nodeId),
    billableNodeIds: nodes.filter((node) => node.billable).map((node) => node.nodeId),
    cacheableNodeIds: nodes.filter((node) => node.cacheable).map((node) => node.nodeId),
    worstCaseSteps,
    worstCaseRetries,
    worstCasePromptTokens,
    worstCaseCompletionTokens,
    worstCaseTotalTokens: worstCasePromptTokens + worstCaseCompletionTokens,
    worstCaseCostMicroUsd,
    maxParallelism,
    maxBranchDepth,
    longestPathNodes: longestPathLength(graph, definition.initialNodeId),
  };

  assertPlanWithinBounds(definition, manifest);

  return {
    workflowId: definition.workflowId,
    workflowVersion: definition.version,
    initialNodeId: definition.initialNodeId,
    manifest,
    // The EXECUTABLE identity: what the engine will actually do. Advisory
    // figures such as worst-case cost are excluded, so re-pricing a profile
    // does not invalidate a running workflow's plan identity while a genuine
    // graph change always does.
    digest: digestValue({
      workflowId: definition.workflowId,
      workflowVersion: definition.version,
      initialNodeId: definition.initialNodeId,
      nodes: nodes.map((node) => ({
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        multiplicity: node.multiplicity,
        maxAttempts: node.maxAttempts,
        branchIds: node.branchIds,
      })),
      branches: manifest.branches.map((branch) => ({
        branchId: branch.branchId,
        parallelNodeId: branch.parallelNodeId,
        joinNodeId: branch.joinNodeId,
        startNodeId: branch.startNodeId,
        nodeIds: branch.nodeIds,
      })),
      joins: manifest.joins,
    }),
    manifestDigest: digestValue(manifest),
    nodesById: new Map(nodes.map((node) => [node.nodeId, node])),
    branchesById: new Map(manifest.branches.map((branch) => [branch.branchId, branch])),
    joinsByNodeId: new Map(manifest.joins.map((join) => [join.joinNodeId, join])),
    graph,
  };
}

/**
 * Refuse a plan whose worst case the platform will not admit.
 *
 * Two sets of bounds are applied, and the difference matters. The DEFINITION's
 * limits are what a tenant declared it wanted; the PLATFORM's bounds are what
 * the persistence layer, the ledgers and the MARQ ceiling are sized for. A
 * definition can breach its own limits (a design error) or the platform's (a
 * refusal), and the diagnostics say which.
 */
function assertPlanWithinBounds(
  definition: WorkflowDefinition,
  manifest: WorkflowPlanManifest,
): void {
  const refuse = (diagnostics: string): never => {
    throw workflowFailure(
      'invalid_workflow_definition',
      'That workflow plan exceeds what the platform will run.',
      { workflowId: definition.workflowId, diagnostics },
    );
  };

  if (manifest.worstCaseSteps > PLATFORM_PLAN_BOUNDS.maxWorstCaseSteps) {
    refuse(
      `worst-case steps ${manifest.worstCaseSteps} exceeds the platform maximum of ` +
        `${PLATFORM_PLAN_BOUNDS.maxWorstCaseSteps}`,
    );
  }
  if (manifest.worstCaseTotalTokens > PLATFORM_PLAN_BOUNDS.maxWorstCaseTokens) {
    refuse(
      `worst-case tokens ${manifest.worstCaseTotalTokens} exceeds the platform maximum of ` +
        `${PLATFORM_PLAN_BOUNDS.maxWorstCaseTokens}`,
    );
  }
  if (manifest.worstCaseCostMicroUsd > PLATFORM_PLAN_BOUNDS.maxWorstCaseCostMicroUsd) {
    refuse(
      `worst-case cost ${manifest.worstCaseCostMicroUsd} micro-USD exceeds the platform maximum ` +
        `of ${PLATFORM_PLAN_BOUNDS.maxWorstCaseCostMicroUsd}`,
    );
  }
  if (manifest.worstCaseRetries > PLATFORM_PLAN_BOUNDS.maxWorstCaseRetries) {
    refuse(
      `worst-case retries ${manifest.worstCaseRetries} exceeds the platform maximum of ` +
        `${PLATFORM_PLAN_BOUNDS.maxWorstCaseRetries}`,
    );
  }
  if (manifest.nodes.length > PLATFORM_PLAN_BOUNDS.maxReachableNodes) {
    refuse(
      `${manifest.nodes.length} reachable nodes exceeds the platform maximum of ` +
        `${PLATFORM_PLAN_BOUNDS.maxReachableNodes}`,
    );
  }
  if (manifest.maxParallelism > definition.limits.maxParallelBranches) {
    refuse(
      `the graph can open ${manifest.maxParallelism} concurrent branches, above ` +
        `limits.maxParallelBranches (${definition.limits.maxParallelBranches})`,
    );
  }
  if (manifest.maxBranchDepth > definition.limits.maxBranchDepth) {
    refuse(
      `branch nesting reaches depth ${manifest.maxBranchDepth}, above limits.maxBranchDepth ` +
        `(${definition.limits.maxBranchDepth})`,
    );
  }
}

/** The node id the given edge kind leads to, or undefined. */
export function nextNodeId(
  plan: WorkflowPlan,
  nodeId: string,
  kind: 'always' | 'true' | 'false' | 'failure',
): string | undefined {
  return edgesFrom(plan.graph, nodeId).find((edge) => edge.kind === kind)?.to;
}
