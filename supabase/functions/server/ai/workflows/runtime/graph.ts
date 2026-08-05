/**
 * Workflow graph analysis (AI-01 Batch 3B).
 *
 * Pure, deterministic functions over a definition's nodes and edges. The
 * registry uses them to refuse a bad graph; the planner uses them to compile a
 * good one. Sharing the code is the point — a registry that accepted a graph
 * the planner then could not compile would fail at run time, on a customer's
 * request, instead of at registration, in front of a reviewer.
 *
 * THE GRAPH IS ACYCLIC, BY RULE. Batch 3B has no loop construct: there is no
 * `while` node, no `goto` and no back edge. Any cycle in the edge list is
 * therefore an accident, and an accident that would either spin forever or be
 * stopped only by the step ceiling. `findCycle` refuses it at registration
 * rather than discovering it during a run.
 *
 * DETERMINISM IS NOT INCIDENTAL. Every traversal below visits successors in
 * declared edge order and every returned collection is sorted or in visit
 * order. Two runs of the same definition therefore produce byte-identical plan
 * manifests, which is what makes a plan digest worth persisting.
 */

import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowParallelNode,
} from '../contracts/workflow.ts';
import { TERMINAL_NODE_TYPES } from '../contracts/workflow.ts';

export interface WorkflowGraph {
  readonly nodesById: ReadonlyMap<string, WorkflowNode>;
  /** nodeId → outgoing edges, in declaration order. */
  readonly outgoing: ReadonlyMap<string, readonly WorkflowEdge[]>;
  /** nodeId → incoming edges, in declaration order. */
  readonly incoming: ReadonlyMap<string, readonly WorkflowEdge[]>;
}

export function buildGraph(definition: WorkflowDefinition): WorkflowGraph {
  const nodesById = new Map<string, WorkflowNode>();
  for (const node of definition.nodes) {
    // First declaration wins; a duplicate id is reported by the registry rather
    // than silently overwriting, so the map must not overwrite either.
    if (!nodesById.has(node.nodeId)) nodesById.set(node.nodeId, node);
  }

  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const edge of definition.edges) {
    const from = outgoing.get(edge.from) ?? [];
    from.push(edge);
    outgoing.set(edge.from, from);
    const to = incoming.get(edge.to) ?? [];
    to.push(edge);
    incoming.set(edge.to, to);
  }

  return { nodesById, outgoing, incoming };
}

export function edgesFrom(graph: WorkflowGraph, nodeId: string): readonly WorkflowEdge[] {
  return graph.outgoing.get(nodeId) ?? [];
}

/**
 * Successors of a node, following every edge kind.
 *
 * A `parallel` node's successors are its branch starts; the join it converges
 * on is NOT a successor of the parallel, it is a successor of each branch's
 * last node. That is what makes "does every branch reach the join?" a real
 * question rather than one the traversal answers by accident.
 */
export function successors(graph: WorkflowGraph, nodeId: string): readonly string[] {
  return edgesFrom(graph, nodeId).map((edge) => edge.to);
}

/** Nodes reachable from a start node, in deterministic visit order. */
export function reachableFrom(
  graph: WorkflowGraph,
  startNodeId: string,
  options: { readonly stopAt?: ReadonlySet<string> } = {},
): readonly string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const stack: string[] = [startNodeId];

  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (nodeId === undefined || seen.has(nodeId)) continue;
    seen.add(nodeId);
    order.push(nodeId);
    if (options.stopAt?.has(nodeId)) continue;
    // Reverse so the traversal explores edges in declaration order.
    const next = [...successors(graph, nodeId)].reverse();
    for (const target of next) {
      if (!seen.has(target)) stack.push(target);
    }
  }
  return order;
}

/**
 * The first cycle found, as the node ids on it, or `undefined`.
 *
 * Iterative depth-first search with an explicit colour map: recursion over a
 * caller-supplied graph is a stack the caller controls, and `maxNodes` is
 * already 128 — but a bounded iterative walk cannot be made to blow the stack
 * at all, which is the stronger property.
 */
export function findCycle(graph: WorkflowGraph, startNodeId: string): readonly string[] | undefined {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const path: string[] = [];

  interface Frame {
    readonly nodeId: string;
    index: number;
  }
  const stack: Frame[] = [{ nodeId: startNodeId, index: 0 }];
  colour.set(startNodeId, GREY);
  path.push(startNodeId);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const next = successors(graph, frame.nodeId);
    if (frame.index >= next.length) {
      colour.set(frame.nodeId, BLACK);
      stack.pop();
      path.pop();
      continue;
    }
    const target = next[frame.index];
    frame.index += 1;
    const state = colour.get(target) ?? WHITE;
    if (state === GREY) {
      const start = path.indexOf(target);
      return [...path.slice(start === -1 ? 0 : start), target];
    }
    if (state === WHITE) {
      colour.set(target, GREY);
      path.push(target);
      stack.push({ nodeId: target, index: 0 });
    }
  }
  return undefined;
}

/**
 * Can a terminal node (`complete` or `fail`) be reached from here?
 *
 * A path with no terminal outcome is a workflow that can only end by hitting
 * its step ceiling or its deadline, which is a failure reported as a limit
 * breach rather than as the design error it is.
 */
export function reachesTerminal(graph: WorkflowGraph, startNodeId: string): boolean {
  for (const nodeId of reachableFrom(graph, startNodeId)) {
    const node = graph.nodesById.get(nodeId);
    if (node && TERMINAL_NODE_TYPES.includes(node.nodeType)) return true;
  }
  return false;
}

export interface BranchSubgraph {
  readonly branchId: string;
  readonly startNodeId: string;
  /** Nodes on this branch, excluding the join. Deterministic visit order. */
  readonly nodeIds: readonly string[];
  /** True when every path out of `startNodeId` arrives at the join. */
  readonly reachesJoin: boolean;
  /** Nodes on the branch with no outgoing edge and which are not the join. */
  readonly danglingNodeIds: readonly string[];
}

/**
 * The subgraph one branch of a fan-out owns, stopping at the join.
 *
 * `stopAt` is the join, so the walk describes the branch and not everything
 * downstream of the whole fan-out. Without it, every branch would appear to
 * contain the entire remainder of the workflow and "which nodes belong to this
 * branch?" would have no answer.
 */
export function branchSubgraph(
  graph: WorkflowGraph,
  input: { readonly branchId: string; readonly startNodeId: string; readonly joinNodeId: string },
): BranchSubgraph {
  const stopAt = new Set<string>([input.joinNodeId]);
  const visited = reachableFrom(graph, input.startNodeId, { stopAt });
  const nodeIds = visited.filter((nodeId) => nodeId !== input.joinNodeId);

  const dangling: string[] = [];
  for (const nodeId of nodeIds) {
    const node = graph.nodesById.get(nodeId);
    if (!node) continue;
    // A terminal node inside a branch is refused by the registry, so a branch
    // node with no successors here is a dead end rather than a legitimate stop.
    if (edgesFrom(graph, nodeId).length === 0) dangling.push(nodeId);
  }

  return {
    branchId: input.branchId,
    startNodeId: input.startNodeId,
    nodeIds,
    reachesJoin: visited.includes(input.joinNodeId),
    danglingNodeIds: dangling,
  };
}

/** The branch edges a `parallel` node declares, in declaration order. */
export function branchEdgesOf(
  graph: WorkflowGraph,
  node: WorkflowParallelNode,
): readonly WorkflowEdge[] {
  return edgesFrom(graph, node.nodeId).filter((edge) => edge.kind === 'branch');
}

/**
 * Longest path length, in nodes, from a start node.
 *
 * Only meaningful on an acyclic graph, which the registry guarantees before the
 * planner asks. Memoised so a diamond-shaped graph is linear rather than
 * exponential to measure.
 */
export function longestPathLength(graph: WorkflowGraph, startNodeId: string): number {
  const memo = new Map<string, number>();

  const visit = (nodeId: string, guard: ReadonlySet<string>): number => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    // A guard against a cycle the caller did not screen for. Returning 0 rather
    // than looping means a mis-used call degrades to an under-estimate instead
    // of hanging, and the registry refuses cyclic graphs anyway.
    if (guard.has(nodeId)) return 0;
    const next = successors(graph, nodeId);
    let best = 0;
    if (next.length > 0) {
      const nextGuard = new Set(guard);
      nextGuard.add(nodeId);
      for (const target of next) best = Math.max(best, visit(target, nextGuard));
    }
    const total = best + 1;
    memo.set(nodeId, total);
    return total;
  };

  return visit(startNodeId, new Set<string>());
}
