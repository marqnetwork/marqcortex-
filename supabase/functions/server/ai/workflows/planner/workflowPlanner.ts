/**
 * The Workflow Planner (AI-01 Batch 3B, Parts 1 and 3).
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
 *   4. ARE THE CYCLES BOUNDED AND ESCAPABLE? See below.
 *
 *   5. WHAT IS THE PLAN? Only once 2–4 are clean.
 *
 * Steps 3 and 4 both run before the planner gives up, so an author sees the
 * orphan AND the unbounded loop in one pass. Step 2 does not: without a start
 * node there is nothing to be reachable from, and reporting "every node is
 * unreachable" would bury the one problem that matters.
 *
 * ── CYCLES: FROM ALWAYS-INVALID TO BOUNDED-AND-ESCAPABLE ───────────────────
 *
 * Part 1 refused every cycle, and the reasoning was exact: a loop needs an
 * exit, an exit needs a condition, and Part 1 had no conditions — so a cycle
 * was a shape with no way to terminate. Part 3 supplies conditions, and the
 * refusal narrows to the two things that are still always wrong:
 *
 *   AN UNDECLARED BACK EDGE is an unbounded loop. Every edge that closes a
 *   cycle must carry `loop.maxIterations`. This is the direct successor to
 *   Part 1's rule, and it is why "no unbounded cycle may become valid" holds:
 *   depth-first search finds a back edge for EVERY cycle, so a cycle with no
 *   declared edge anywhere on it cannot slip through.
 *
 *   A LOOP WITH NO EXIT is bounded but pointless — it can only ever end by
 *   exhaustion, which is a typed failure. So the body must contain at least one
 *   node with a successor outside it, which in practice means a condition node
 *   with one branch leaving the loop. An author who wants "do this five times"
 *   still has to say what happens on the fifth.
 *
 * A declared `loop` that is NOT a back edge is refused too. It would suggest a
 * ceiling on a forward edge that can only be taken once, and a bound that never
 * binds is worse than no bound: it reads, in a review, as though something is
 * limited.
 */

import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowJoinNode,
  WorkflowNode,
  WorkflowParallelNode,
} from '../contracts/workflow.ts';
import type {
  WorkflowPlan,
  WorkflowPlanBranch,
  WorkflowPlanLoop,
  WorkflowPlanMetadata,
  WorkflowPlanResult,
  WorkflowPlanStep,
} from '../contracts/plan.ts';
import {
  WORKFLOW_BOUNDS,
  isAgentNode,
  isJoinNode,
  isParallelNode,
} from '../contracts/workflow.ts';
import { isAgentStep, isParallelStep } from '../contracts/plan.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { validateWorkflowDefinition } from '../validation/workflowValidation.ts';
import type { WorkflowValidationOptions } from '../validation/workflowValidation.ts';
import { effectiveBranchCeiling } from '../validation/parallelValidation.ts';
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

/** One edge, indexed by where it goes and how. */
interface Successor {
  readonly to: string;
  readonly when?: boolean;
  readonly edge: WorkflowEdge;
}

/** The planner as a free function. `createWorkflowPlanner` wraps this. */
export function planWorkflow(
  definition: WorkflowDefinition,
  options: WorkflowPlannerOptions = {},
): WorkflowPlanResult {
  const structural = validateWorkflowDefinition(definition, options);
  if (structural.length > 0) return { ok: false, problems: structural };

  const nodes = new Map(definition.nodes.map((node) => [node.nodeId, node]));
  const successors = successorIndex(definition.nodes, definition.edges);
  const predecessorCounts = predecessorIndex(definition.edges);

  const start = resolveStartNode(definition, predecessorCounts);
  if (!start.ok) return { ok: false, problems: start.problems };

  const reachable = reachableFrom(successors, start.nodeId);
  const loops = analyseLoops(definition.nodes, successors, start.nodeId);

  const problems: string[] = [
    ...unreachableProblems(nodes, reachable, start.nodeId),
    ...loops.problems,
    ...parallelInLoopProblems(nodes, loops.byHeader),
  ];
  if (problems.length > 0) return { ok: false, problems };

  const steps = buildSteps(definition, nodes, successors, start.nodeId, loops.byHeader);
  // The last thing that can still refuse a plan. Everything above proves the
  // graph is walkable; this proves the plan it produced is one the engine can
  // execute — a parallel step whose join is missing from the enumeration would
  // be a fan-out with nowhere to converge, discovered at run time.
  const planProblems = parallelPlanProblems(steps);
  if (planProblems.length > 0) return { ok: false, problems: planProblems };

  const plan: WorkflowPlan = {
    workflowId: definition.workflowId,
    version: definition.version,
    startNodeId: start.nodeId,
    steps,
    metadata: computeMetadata(definition, steps, start.nodeId, loops.byHeader),
    digest: computePlanDigest({
      workflowId: definition.workflowId,
      version: definition.version,
      startNodeId: start.nodeId,
      steps,
    }),
  };

  return { ok: true, plan };
}

// ── Graph indexes ───────────────────────────────────────────────────────────

/**
 * Successors by node id, in DETERMINISTIC order.
 *
 * For a condition node the order is [true, false] — fixed by meaning, not by
 * sorting, so a plan's enumeration does not change when someone renames a node.
 * For an agent node there is at most one. The whole plan's stability rests on
 * this ordering being a property of the definition rather than of the ids.
 */
function successorIndex(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): ReadonlyMap<string, readonly Successor[]> {
  const byFrom = new Map<string, Successor[]>();
  for (const edge of edges) {
    const entry: Successor = {
      to: edge.to,
      ...(edge.when === undefined ? {} : { when: edge.when }),
      edge,
    };
    const list = byFrom.get(edge.from);
    if (list) list.push(entry);
    else byFrom.set(edge.from, [entry]);
  }

  const index = new Map<string, readonly Successor[]>();
  for (const node of nodes) {
    const list = byFrom.get(node.nodeId) ?? [];
    if (node.kind === 'condition') {
      const trueEdge = list.find((entry) => entry.when === true);
      const falseEdge = list.find((entry) => entry.when === false);
      index.set(node.nodeId, [trueEdge, falseEdge].filter((entry): entry is Successor => !!entry));
    } else if (node.kind === 'parallel') {
      // DECLARED BRANCH ORDER, not edge order. The branch list is what a
      // reviewer approved and what the merge reads, so the plan enumerates the
      // fan-out the same way — reordering the `edges` array must not change a
      // plan digest, and reordering `branches` must.
      const rank = new Map(
        (node.branches ?? []).map((branch, ordinal) => [branch?.branchName, ordinal]),
      );
      const unranked = rank.size;
      index.set(
        node.nodeId,
        [...list].sort(
          (a, b) =>
            (rank.get(a.edge.branch ?? '') ?? unranked) -
            (rank.get(b.edge.branch ?? '') ?? unranked),
        ),
      );
    } else {
      index.set(node.nodeId, list);
    }
  }
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
 * names a real node, and the loop and reachability checks still apply to it.
 * An undeclared one is the node nothing points at, and there has to be exactly
 * one: none means every node has a predecessor, which now happens legitimately
 * whenever a loop returns to what would otherwise be the entry point — so a
 * workflow with a loop back to its first node must DECLARE its start.
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
        'no start node: every node has an incoming edge, so the graph has no entry point — ' +
          'a workflow whose loop returns to its first node must declare startNodeId',
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

function reachableFrom(
  successors: ReadonlyMap<string, readonly Successor[]>,
  startNodeId: string,
): ReadonlySet<string> {
  const seen = new Set<string>([startNodeId]);
  const queue: string[] = [startNodeId];

  // The `seen` guard is what makes this terminate on a cyclic graph — loops are
  // legal now, so reachability could not assume acyclicity even if it wanted to.
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of successors.get(current) ?? []) {
      if (seen.has(next.to)) continue;
      seen.add(next.to);
      queue.push(next.to);
    }
  }
  return seen;
}

function unreachableProblems(
  nodes: ReadonlyMap<string, WorkflowNode>,
  reachable: ReadonlySet<string>,
  startNodeId: string,
): string[] {
  const unreachable = [...nodes.keys()].filter((nodeId) => !reachable.has(nodeId)).sort();
  if (unreachable.length === 0) return [];
  return [`unreachable from ${startNodeId}: ${unreachable.join(', ')}`];
}

// ── Step 4: loops ───────────────────────────────────────────────────────────

interface LoopAnalysis {
  readonly problems: readonly string[];
  /** Loop keyed by its HEADER — the node a back edge returns to. */
  readonly byHeader: ReadonlyMap<string, WorkflowPlanLoop>;
}

/**
 * Find every back edge, require each to be declared, and require each loop to
 * have a way out.
 *
 * Depth-first with three colours. An edge to a node that is currently ON the
 * search path is a back edge, and every cycle in a directed graph contains at
 * least one — which is what makes "every back edge is declared" equivalent to
 * "every cycle is bounded" rather than merely correlated with it.
 *
 * Roots are taken in declaration order and successors in their fixed
 * [true, false] order, so the same graph produces the same analysis every time.
 */
function analyseLoops(
  nodes: readonly WorkflowNode[],
  successors: ReadonlyMap<string, readonly Successor[]>,
  startNodeId: string,
): LoopAnalysis {
  const onPath = new Set<string>();
  const finished = new Set<string>();
  const path: string[] = [];
  const problems: string[] = [];
  const backEdges: { from: string; to: string; edge: WorkflowEdge }[] = [];

  const visit = (nodeId: string): void => {
    onPath.add(nodeId);
    path.push(nodeId);

    for (const next of successors.get(nodeId) ?? []) {
      if (onPath.has(next.to)) {
        backEdges.push({ from: nodeId, to: next.to, edge: next.edge });
        continue;
      }
      if (!finished.has(next.to)) visit(next.to);
    }

    path.pop();
    onPath.delete(nodeId);
    finished.add(nodeId);
  };

  // Start first so back edges are found relative to the real entry point, then
  // the rest in declaration order for the unreachable components validation has
  // not yet rejected.
  visit(startNodeId);
  for (const node of nodes) if (!finished.has(node.nodeId)) visit(node.nodeId);

  // Recursion depth is bounded by the node ceiling, enforced by validation.
  const declaredNotBack = new Set<WorkflowEdge>();
  for (const list of successors.values()) {
    for (const entry of list) if (entry.edge.loop !== undefined) declaredNotBack.add(entry.edge);
  }

  const byHeader = new Map<string, WorkflowPlanLoop>();
  for (const back of backEdges) {
    declaredNotBack.delete(back.edge);

    if (back.edge.loop === undefined) {
      problems.push(
        `unbounded loop: edge ${back.from} -> ${back.to} closes a cycle without ` +
          'declaring loop.maxIterations',
      );
      continue;
    }

    const body = loopBody(successors, back.to, back.from);
    const exits = [...body]
      .sort()
      .filter((nodeId) =>
        (successors.get(nodeId) ?? []).some((next) => !body.has(next.to)),
      );
    if (exits.length === 0) {
      problems.push(
        `loop ${back.to} -> ... -> ${back.from} has no exit: no node in its body has a ` +
          'successor outside it, so it can only end by exhaustion',
      );
      continue;
    }

    // Two back edges onto one header would give the header two ceilings. The
    // stricter one is not a merge anybody asked for, so it is refused.
    if (byHeader.has(back.to)) {
      problems.push(`node ${back.to} is the target of more than one loop edge`);
      continue;
    }
    byHeader.set(back.to, {
      maxIterations: back.edge.loop.maxIterations,
      fromNodeId: back.from,
      bodyNodeIds: [...body].sort(),
    });
  }

  for (const edge of declaredNotBack) {
    problems.push(
      `edge ${edge.from} -> ${edge.to} declares loop.maxIterations but does not close a cycle — ` +
        'a bound that never binds reads like a limit and is not one',
    );
  }

  return { problems: problems.sort(), byHeader };
}

/**
 * The natural loop body for a back edge `from -> header`: every node reachable
 * from the header that can also reach `from`.
 *
 * This is the standard definition and it is the right one here: those are
 * exactly the nodes an iteration can pass through, which makes "does the loop
 * have an exit" a question about their successors and nothing else.
 */
function loopBody(
  successors: ReadonlyMap<string, readonly Successor[]>,
  header: string,
  from: string,
): ReadonlySet<string> {
  const forward = reachableFrom(successors, header);
  const body = new Set<string>([header, from]);

  for (const candidate of forward) {
    if (body.has(candidate)) continue;
    if (canReach(successors, candidate, from)) body.add(candidate);
  }
  return body;
}

function canReach(
  successors: ReadonlyMap<string, readonly Successor[]>,
  origin: string,
  target: string,
): boolean {
  const seen = new Set<string>([origin]);
  const queue = [origin];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of successors.get(current) ?? []) {
      if (next.to === target) return true;
      if (seen.has(next.to)) continue;
      seen.add(next.to);
      queue.push(next.to);
    }
  }
  return false;
}

// ── Step 5: the plan ────────────────────────────────────────────────────────

/**
 * Enumerate the nodes breadth-first from the start.
 *
 * Not an execution order — see the header of `contracts/plan.ts`. It is a
 * stable identity for every node plus its shortest distance from the entry
 * point, and the determinism comes from the fixed successor ordering rather
 * than from a sort applied afterwards.
 */
function buildSteps(
  definition: WorkflowDefinition,
  nodes: ReadonlyMap<string, WorkflowNode>,
  successors: ReadonlyMap<string, readonly Successor[]>,
  startNodeId: string,
  loops: ReadonlyMap<string, WorkflowPlanLoop>,
): readonly WorkflowPlanStep[] {
  const order: { nodeId: string; depth: number }[] = [];
  const seen = new Set<string>([startNodeId]);
  const queue: { nodeId: string; depth: number }[] = [{ nodeId: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift() as { nodeId: string; depth: number };
    order.push(current);
    for (const next of successors.get(current.nodeId) ?? []) {
      if (seen.has(next.to)) continue;
      seen.add(next.to);
      queue.push({ nodeId: next.to, depth: current.depth + 1 });
    }
  }

  return order.map((entry, index) => {
    const node = nodes.get(entry.nodeId) as WorkflowNode;
    const out = successors.get(entry.nodeId) ?? [];
    const loop = loops.get(entry.nodeId);
    const base = {
      index,
      nodeId: node.nodeId,
      displayName: node.displayName,
      depth: entry.depth,
      terminal: out.length === 0,
      ...(loop === undefined ? {} : { loop }),
    };

    if (isAgentNode(node)) {
      return {
        ...base,
        kind: 'agent' as const,
        agentId: node.agentId,
        maxAttempts: node.maxAttempts,
        ...(node.inputMapping === undefined ? {} : { inputMapping: node.inputMapping }),
        ...(node.inputContract === undefined ? {} : { inputContract: node.inputContract }),
        ...(node.outputMapping === undefined ? {} : { outputMapping: node.outputMapping }),
        ...(node.outputContract === undefined ? {} : { outputContract: node.outputContract }),
        ...(out[0] === undefined ? {} : { nextNodeId: out[0].to }),
      };
    }

    if (isParallelNode(node)) {
      // Validation guarantees the join exists, is a join node, and is named by
      // this node alone — so its policy and merge contract are resolved onto
      // BOTH steps here. The engine then reads one step to open the fan-out and
      // one to merge it, and neither has to look the other up mid-run.
      const join = nodes.get(node.joinNodeId) as WorkflowJoinNode;
      return {
        ...base,
        kind: 'parallel' as const,
        branches: planBranches(node, successors),
        joinNodeId: node.joinNodeId,
        joinPolicy: join.policy,
        failurePolicy: node.failurePolicy,
        maximumParallelBranches: effectiveBranchCeiling(definition, node),
        terminal: false,
      };
    }

    if (isJoinNode(node)) {
      const parallel = [...nodes.values()].find(
        (candidate): candidate is WorkflowParallelNode =>
          isParallelNode(candidate) && candidate.joinNodeId === node.nodeId,
      ) as WorkflowParallelNode;
      return {
        ...base,
        kind: 'join' as const,
        policy: node.policy,
        mergeContract: node.mergeContract,
        parallelNodeId: parallel.nodeId,
        branchNames: (parallel.branches ?? []).map((branch) => branch.branchName),
        ...(out[0] === undefined ? {} : { nextNodeId: out[0].to }),
      };
    }

    // Validation guarantees a condition node has exactly one true and one false
    // edge, and `successorIndex` orders them [true, false].
    return {
      ...base,
      kind: 'condition' as const,
      expression: node.expression,
      trueNodeId: out[0].to,
      falseNodeId: out[1].to,
      terminal: false,
    };
  });
}

/**
 * Resolve each branch's body once, at planning.
 *
 * The engine never re-derives a branch body: it reads `bodyNodeIds` to know
 * which nodes a branch may visit and follows the ordinary successor edges to
 * walk them. Resolving here is also what makes a branch's worst-case cost
 * countable before anything runs.
 *
 * The walk stops at the join, exactly as validation's does — and it is safe to
 * assume the shape validation proved, because a definition that failed it never
 * reaches the planner.
 */
function planBranches(
  node: WorkflowParallelNode,
  successors: ReadonlyMap<string, readonly Successor[]>,
): readonly WorkflowPlanBranch[] {
  return (node.branches ?? []).map((branch, ordinal) => ({
    branchName: branch.branchName,
    startNodeId: branch.startNodeId,
    ordinal,
    bodyNodeIds: branchBodyNodeIds(successors, branch.startNodeId, node.joinNodeId),
  }));
}

/** Breadth-first from the branch head, stopping at the join. Deterministic. */
function branchBodyNodeIds(
  successors: ReadonlyMap<string, readonly Successor[]>,
  startNodeId: string,
  joinNodeId: string,
): readonly string[] {
  const seen = new Set<string>([startNodeId]);
  const order: string[] = [];
  const queue: string[] = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const next of successors.get(current) ?? []) {
      if (next.to === joinNodeId || seen.has(next.to)) continue;
      seen.add(next.to);
      queue.push(next.to);
    }
  }
  return order;
}

/**
 * A parallel node inside a loop body, refused.
 *
 * A group's identity is `run + parallel node`, with no visit counter, so a
 * second entry would collide with the first and be refused as a duplicate mid-
 * run. Adding a counter is not the fix it looks like: it would make branch ids
 * depend on how many times a loop had gone round, which is precisely the kind of
 * identity a recovering isolate cannot recompute without replaying the loop.
 * Refusing the shape is the honest answer, and it is refused where the loop
 * bodies are known.
 */
function parallelInLoopProblems(
  nodes: ReadonlyMap<string, WorkflowNode>,
  loops: ReadonlyMap<string, WorkflowPlanLoop>,
): string[] {
  const problems: string[] = [];
  for (const [header, loop] of [...loops.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const nodeId of loop.bodyNodeIds) {
      const node = nodes.get(nodeId);
      if (!node || (!isParallelNode(node) && !isJoinNode(node))) continue;
      problems.push(
        `${node.kind} node ${nodeId} is inside the loop headed by ${header} — a parallel step ` +
          'may not be re-entered, because its branch identities are derived without a visit count',
      );
    }
  }
  return problems.sort();
}

/** Every parallel step must find its join in the same plan, and vice versa. */
function parallelPlanProblems(steps: readonly WorkflowPlanStep[]): string[] {
  const byNodeId = new Map(steps.map((step) => [step.nodeId, step]));
  const problems: string[] = [];

  for (const step of steps) {
    if (!isParallelStep(step)) continue;
    const join = byNodeId.get(step.joinNodeId);
    if (!join || join.kind !== 'join') {
      problems.push(
        `node ${step.nodeId}: join ${step.joinNodeId} is not reachable in the plan, so the ` +
          'fan-out it opens could never converge',
      );
      continue;
    }
    for (const branch of step.branches) {
      if (!byNodeId.has(branch.startNodeId)) {
        problems.push(
          `node ${step.nodeId}: branch ${branch.branchName} starts at ${branch.startNodeId}, ` +
            'which is not in the plan',
        );
      }
    }
  }

  return problems.sort();
}

function computeMetadata(
  definition: WorkflowDefinition,
  steps: readonly WorkflowPlanStep[],
  startNodeId: string,
  loops: ReadonlyMap<string, WorkflowPlanLoop>,
): WorkflowPlanMetadata {
  const agentSteps = steps.filter(isAgentStep);
  const agentIds = [...new Set(agentSteps.map((step) => step.agentId))].sort();
  const parallelSteps = steps.filter(isParallelStep);

  return {
    nodeCount: definition.nodes.length,
    edgeCount: definition.edges.length,
    stepCount: steps.length,
    agentNodeCount: agentSteps.length,
    conditionNodeCount: steps.filter((step) => step.kind === 'condition').length,
    parallelNodeCount: parallelSteps.length,
    joinNodeCount: steps.filter((step) => step.kind === 'join').length,
    maxBranchCount: parallelSteps.reduce(
      (widest, step) => Math.max(widest, step.branches.length),
      0,
    ),
    // Edges on the longest shortest-path, so a single-node workflow is depth
    // zero rather than depth one — depth counts transitions, not nodes.
    depth: steps.reduce((deepest, step) => Math.max(deepest, step.depth), 0),
    agentIds,
    distinctAgentCount: agentIds.length,
    startNodeId,
    terminalNodeIds: steps.filter((step) => step.terminal).map((step) => step.nodeId).sort(),
    loopCount: loops.size,
    maxAgentInvocations: worstCaseInvocations(agentSteps, loops),
  };
}

/**
 * Worst case: each agent node's attempt ceiling, multiplied by the iteration
 * ceilings of every loop whose body contains it.
 *
 * Nested loops multiply, which is exactly the number an operator needs — three
 * nested loops of eight around one node is five hundred and twelve agent runs,
 * and that figure should be visible in the plan rather than discovered from a
 * bill. Capped at the run-wide iteration ceiling so a pathological definition
 * reports a bounded number rather than an astronomical one.
 */
function worstCaseInvocations(
  agentSteps: readonly { nodeId: string; maxAttempts: number }[],
  loops: ReadonlyMap<string, WorkflowPlanLoop>,
): number {
  let total = 0;
  for (const step of agentSteps) {
    let multiplier = 1;
    for (const loop of loops.values()) {
      if (loop.bodyNodeIds.includes(step.nodeId)) multiplier *= loop.maxIterations + 1;
    }
    total += step.maxAttempts * multiplier;
  }
  return Math.min(total, WORKFLOW_BOUNDS.maxPlanDepth * WORKFLOW_BOUNDS.loopIterations.max * 64);
}
