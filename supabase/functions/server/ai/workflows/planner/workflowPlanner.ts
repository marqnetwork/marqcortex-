/**
 * The Workflow Planner (AI-01 Batch 3B, Part 1).
 *
 * Turns a workflow definition into an execution plan — or refuses, with every
 * reason it found. Nothing here executes, schedules, persists or reaches a
 * model; the planner is a pure function of the definition, which is what makes
 * its output digestible, comparable and reviewable before a run exists.
 *
 * THE ORDER OF THE QUESTIONS IS THE DESIGN.
 *
 *   1. IS THE DEFINITION STRUCTURALLY SOUND? Delegated to
 *      `validation/workflowValidation.ts`. Until it passes, a traversal is not
 *      meaningful: a dangling edge points at nothing and a duplicate node id
 *      makes "the node with this id" ambiguous. The planner never runs its
 *      graph analysis on a definition that failed here, so every step below is
 *      entitled to assume unique ids and edges between real nodes.
 *
 *   2. WHERE DOES IT START? Declared, or resolved as the one node nothing
 *      points at. Ambiguity is refused rather than broken by a rule like "the
 *      first one wins" — a plan that depends on declaration order is a plan
 *      that changes when someone reorders a list.
 *
 *   3. WHAT IS UNREACHABLE? Breadth-first from the start. An orphaned node is
 *      almost always a mistake — a rewired edge, a renamed id — and it is the
 *      kind of mistake that produces a workflow which quietly does less than it
 *      appears to.
 *
 *   4. IS THERE A CYCLE? Depth-first with three colours, reporting the actual
 *      path rather than the fact of one.
 *
 *   5. WHAT IS THE PLAN? Only once 2–4 are clean.
 *
 * Steps 3 and 4 both run before the planner gives up, so an author sees the
 * orphan AND the cycle in one pass. Step 2 does not: without a start node there
 * is nothing to be reachable from, and reporting "every node is unreachable"
 * would bury the one problem that matters.
 *
 * ── WHY EVERY CYCLE IS INVALID HERE ────────────────────────────────────────
 *
 * A cycle is a loop, and a loop needs an exit. An exit is a condition, and an
 * edge in this batch carries no condition — see the single-successor rule in
 * `validation/workflowValidation.ts`. So a cycle in a Part 1 graph is not a
 * bounded retry that the planner is being conservative about; it is a shape
 * with no way to terminate, and the planner would be describing an infinite
 * run. Bounded loops, if they are ever wanted, need the iteration ceiling and
 * the exit predicate that Part 2 introduces — and they will be a declared
 * construct, not a cycle that slipped through.
 *
 * There is no option to disable this check. A control that a setting can turn
 * into a no-op is a control that will be, during the incident it was built for.
 */

import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '../contracts/workflow.ts';
import type {
  WorkflowPlan,
  WorkflowPlanMetadata,
  WorkflowPlanResult,
  WorkflowPlanStep,
} from '../contracts/plan.ts';
import { WORKFLOW_BOUNDS } from '../contracts/workflow.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { validateWorkflowDefinition } from '../validation/workflowValidation.ts';
import type { WorkflowValidationOptions } from '../validation/workflowValidation.ts';
import { computePlanDigest } from './planDigest.ts';

export type WorkflowPlannerOptions = WorkflowValidationOptions;

export interface WorkflowPlanner {
  /** Plan, or throw a typed failure carrying every problem as diagnostics. */
  plan(definition: WorkflowDefinition): WorkflowPlan;
  /** Plan, or report every problem. The non-throwing form, for consoles. */
  inspect(definition: WorkflowDefinition): WorkflowPlanResult;
}

export function createWorkflowPlanner(options: WorkflowPlannerOptions = {}): WorkflowPlanner {
  return {
    inspect: (definition) => planWorkflow(definition, options),

    plan(definition) {
      const result = planWorkflow(definition, options);
      if (result.ok) return result.plan;
      throw workflowFailure('workflow_plan_failed', 'That workflow cannot be planned.', {
        workflowId: definition?.workflowId,
        diagnostics: `${definition?.workflowId || '(no id)'}: ${result.problems.join('; ')}`,
      });
    },
  };
}

/** The planner as a free function. `createWorkflowPlanner` wraps this. */
export function planWorkflow(
  definition: WorkflowDefinition,
  options: WorkflowPlannerOptions = {},
): WorkflowPlanResult {
  const structural = validateWorkflowDefinition(definition, options);
  if (structural.length > 0) return { ok: false, problems: structural };

  const nodes = new Map(definition.nodes.map((node) => [node.nodeId, node]));
  const successors = successorIndex(definition.edges);
  const predecessorCounts = predecessorIndex(definition.edges);

  const start = resolveStartNode(definition, predecessorCounts);
  if (!start.ok) return { ok: false, problems: start.problems };

  const problems: string[] = [
    ...unreachableProblems(nodes, successors, start.nodeId),
    ...cycleProblems(definition.nodes, successors),
  ];
  if (problems.length > 0) return { ok: false, problems };

  const steps = buildSteps(nodes, successors, start.nodeId);
  if (!steps.ok) return { ok: false, problems: steps.problems };

  const plan: WorkflowPlan = {
    workflowId: definition.workflowId,
    version: definition.version,
    startNodeId: start.nodeId,
    steps: steps.steps,
    metadata: computeMetadata(definition, steps.steps, successors, start.nodeId),
    digest: computePlanDigest({
      workflowId: definition.workflowId,
      version: definition.version,
      startNodeId: start.nodeId,
      steps: steps.steps,
    }),
  };

  return { ok: true, plan };
}

// ── Graph indexes ───────────────────────────────────────────────────────────

/**
 * Successors by node id, each list sorted.
 *
 * Part 1's single-successor rule means every list holds at most one entry by
 * the time the planner sees it, but the index is built as a general adjacency
 * list: the traversals below are graph algorithms, and writing them against a
 * "one or none" shape would make them wrong rather than merely narrow.
 */
function successorIndex(edges: readonly WorkflowEdge[]): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = index.get(edge.from);
    if (existing) existing.push(edge.to);
    else index.set(edge.from, [edge.to]);
  }
  for (const list of index.values()) list.sort();
  return index;
}

function predecessorIndex(edges: readonly WorkflowEdge[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  return counts;
}

// ── Step 2: the start node ──────────────────────────────────────────────────

type StartResolution =
  | { readonly ok: true; readonly nodeId: string }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * A declared start is taken as declared — validation has already confirmed it
 * names a real node, and the cycle and reachability checks still apply to it.
 * An undeclared one is the node nothing points at, and there has to be exactly
 * one: none means every node has a predecessor, which is only possible if the
 * graph is one closed loop; several means the definition describes more than
 * one workflow and the planner is not going to guess which.
 */
function resolveStartNode(
  definition: WorkflowDefinition,
  predecessorCounts: ReadonlyMap<string, number>,
): StartResolution {
  if (definition.startNodeId !== undefined) {
    return { ok: true, nodeId: definition.startNodeId };
  }

  const roots = definition.nodes
    .map((node) => node.nodeId)
    .filter((nodeId) => (predecessorCounts.get(nodeId) ?? 0) === 0)
    .sort();

  if (roots.length === 1) return { ok: true, nodeId: roots[0] };
  if (roots.length === 0) {
    return {
      ok: false,
      problems: [
        'no start node: every node has an incoming edge, so the graph has no entry point',
      ],
    };
  }
  return {
    ok: false,
    problems: [
      `ambiguous start node: ${roots.join(', ')} all have no incoming edge — ` +
        'declare startNodeId or connect the graph',
    ],
  };
}

// ── Step 3: reachability ────────────────────────────────────────────────────

function unreachableProblems(
  nodes: ReadonlyMap<string, WorkflowNode>,
  successors: ReadonlyMap<string, readonly string[]>,
  startNodeId: string,
): string[] {
  const seen = new Set<string>([startNodeId]);
  const queue: string[] = [startNodeId];

  // Breadth-first, and the `seen` guard is what makes this terminate on a
  // cyclic graph — reachability is asked BEFORE cycles are ruled out, so it
  // cannot assume the graph is acyclic.
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of successors.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  const unreachable = [...nodes.keys()].filter((nodeId) => !seen.has(nodeId)).sort();
  if (unreachable.length === 0) return [];
  return [
    `unreachable from ${startNodeId}: ${unreachable.join(', ')}`,
  ];
}

// ── Step 4: cycles ──────────────────────────────────────────────────────────

/**
 * Depth-first with three colours: unvisited, on the current path, finished.
 * Reaching a node that is on the current path is a back edge, and the segment
 * of the path from that node onward is the cycle — reported as the actual route
 * (`draft -> review -> draft`) rather than as the bare fact that one exists,
 * because the route is what an author has to edit.
 *
 * Roots are taken in declaration order and successors in sorted order, so the
 * same graph always reports the same cycles in the same sequence.
 */
function cycleProblems(
  nodes: readonly WorkflowNode[],
  successors: ReadonlyMap<string, readonly string[]>,
): string[] {
  const onPath = new Set<string>();
  const finished = new Set<string>();
  const path: string[] = [];
  const found: string[] = [];
  const reported = new Set<string>();

  const visit = (nodeId: string): void => {
    onPath.add(nodeId);
    path.push(nodeId);

    for (const next of successors.get(nodeId) ?? []) {
      if (onPath.has(next)) {
        const route = [...path.slice(path.indexOf(next)), next].join(' -> ');
        if (!reported.has(route)) {
          reported.add(route);
          found.push(route);
        }
        continue;
      }
      if (!finished.has(next)) visit(next);
    }

    path.pop();
    onPath.delete(nodeId);
    finished.add(nodeId);
  };

  // Recursion depth is bounded by the node ceiling (see WORKFLOW_BOUNDS.nodes),
  // which validation has already enforced by the time the planner runs.
  for (const node of nodes) {
    if (!finished.has(node.nodeId)) visit(node.nodeId);
  }

  return found.map((route) => `cycle: ${route}`);
}

// ── Step 5: the plan ────────────────────────────────────────────────────────

type StepResolution =
  | { readonly ok: true; readonly steps: readonly WorkflowPlanStep[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Walk the chain from the start node.
 *
 * A graph that is acyclic, fully reachable and single-successor IS a chain, so
 * the plan order is the walk order and there is nothing to tie-break — the
 * determinism of this plan is a property of the shape the validator enforces,
 * not of a sorting rule applied afterwards. When Part 2 makes fan-out
 * representable this walk becomes a topological order with an explicit
 * tie-break, and that is the point at which a tie-break earns its place.
 *
 * The iteration ceiling is a guard against a future edit, not against the
 * inputs this function can currently receive: cycles are already ruled out, so
 * a walk that exceeds the node count means an invariant above it has been
 * broken, and stopping with a diagnostic beats looping inside a planner.
 */
function buildSteps(
  nodes: ReadonlyMap<string, WorkflowNode>,
  successors: ReadonlyMap<string, readonly string[]>,
  startNodeId: string,
): StepResolution {
  const steps: WorkflowPlanStep[] = [];
  const visited = new Set<string>();
  let current: string | undefined = startNodeId;
  let index = 0;

  while (current !== undefined) {
    if (visited.has(current) || index > WORKFLOW_BOUNDS.maxPlanDepth) {
      return {
        ok: false,
        problems: [`plan walk did not terminate at ${current} — the graph is not a chain`],
      };
    }
    visited.add(current);

    const node = nodes.get(current);
    if (!node) {
      return { ok: false, problems: [`plan walk reached unknown node ${current}`] };
    }

    const next: string | undefined = (successors.get(current) ?? [])[0];
    steps.push({
      index,
      nodeId: node.nodeId,
      kind: node.kind,
      agentId: node.agentId,
      displayName: node.displayName,
      maxAttempts: node.maxAttempts,
      depth: index,
      nextNodeId: next,
      terminal: next === undefined,
    });

    current = next;
    index += 1;
  }

  return { ok: true, steps };
}

function computeMetadata(
  definition: WorkflowDefinition,
  steps: readonly WorkflowPlanStep[],
  successors: ReadonlyMap<string, readonly string[]>,
  startNodeId: string,
): WorkflowPlanMetadata {
  const agentIds = [...new Set(steps.map((step) => step.agentId))].sort();
  const terminalNodeIds = steps
    .filter((step) => (successors.get(step.nodeId) ?? []).length === 0)
    .map((step) => step.nodeId)
    .sort();

  return {
    nodeCount: definition.nodes.length,
    edgeCount: definition.edges.length,
    stepCount: steps.length,
    // Edges on the longest path, so a single-node workflow is depth zero
    // rather than depth one — depth counts transitions, not nodes.
    depth: steps.length === 0 ? 0 : steps[steps.length - 1].depth,
    agentIds,
    distinctAgentCount: agentIds.length,
    startNodeId,
    terminalNodeIds,
    maxAgentInvocations: steps.reduce((total, step) => total + step.maxAttempts, 0),
  };
}
