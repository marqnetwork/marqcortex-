/**
 * Parallel and join validation (AI-01 Batch 3B, Part 4).
 *
 * Everything that decides whether a fan-out is a shape the engine can finish.
 * It runs at REGISTRATION, alongside the rest of `workflowValidation.ts`, so a
 * graph whose branches overlap or whose join is unreachable is refused when the
 * runtime is assembled rather than discovered by the first tenant who runs it.
 *
 * ── WHAT A BRANCH BODY MUST BE, AND WHY THE RULES ARE THIS TIGHT ───────────
 *
 * A branch body is the set of nodes reachable from a branch's head before the
 * join. Four properties are required of it, and each one exists because its
 * absence produces a run that cannot be reasoned about:
 *
 *   EXCLUSIVELY OWNED   No node may belong to two branches, or to a branch and
 *                       the main line. Branch state is branch-local, so a shared
 *                       node would have two cursors, two visit counts and two
 *                       outputs under one id — and the merge would have no
 *                       answer to "which one did the join take?".
 *
 *   ENTERED ONLY BY ITS PARALLEL NODE   A body node with an incoming edge from
 *                       outside the group could be reached without a branch
 *                       existing, which means executing branch-local work with
 *                       no branch to put it in.
 *
 *   ALWAYS REACHING THE JOIN   Every path out of the head must end at the join
 *                       node. A branch that could terminate somewhere else is a
 *                       branch that can finish without telling the join, and the
 *                       join would wait for it forever.
 *
 *   ACYCLIC AND BOUNDED   No loops inside a branch. Loop accounting is run-wide
 *                       and its counters are on the run's data state, not on a
 *                       branch; giving a branch its own loop would be a second
 *                       loop ledger with its own ceiling to keep in step.
 *
 * ── AND WHY THE JOIN IS PART OF THE PARALLEL NODE'S DECLARATION ────────────
 *
 * A join node exists only because a parallel node names it. Exactly one, never
 * two, never zero. That is what makes "which policy governs this merge" a
 * question with one answer, and it is why the join's policy and merge contract
 * can be resolved onto the parallel plan step at planning time.
 */

import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowJoinNode,
  WorkflowNode,
  WorkflowParallelNode,
} from '../contracts/workflow.ts';
import type { WorkflowJoinPolicy } from '../contracts/parallel.ts';
import { WORKFLOW_BOUNDS, isJoinNode, isParallelNode } from '../contracts/workflow.ts';
import {
  WORKFLOW_BRANCH_NAME_PATTERN,
  WORKFLOW_JOIN_POLICY_KINDS,
  WORKFLOW_PARALLEL_BOUNDS,
  WORKFLOW_PARALLEL_FAILURE_POLICIES,
} from '../contracts/parallel.ts';

/**
 * The fan-out ceiling actually in force for a node.
 *
 * The tightest of three, and it can only ever narrow: the platform bound, the
 * workflow's own declaration and the node's. Exported because the planner puts
 * this number on the plan step and the engine enforces it again before creating
 * a branch — one derivation, three enforcement points.
 */
export function effectiveBranchCeiling(
  definition: Pick<WorkflowDefinition, 'maximumParallelBranches'>,
  node: Pick<WorkflowParallelNode, 'maximumParallelBranches'>,
): number {
  const declared = [
    WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches,
    definition?.maximumParallelBranches,
    node?.maximumParallelBranches,
  ].filter((value): value is number => Number.isInteger(value) && (value as number) > 0);
  return Math.min(...declared);
}

/** Outgoing edges by source node, in declaration order. */
function outgoingIndex(
  edges: readonly WorkflowEdge[],
): ReadonlyMap<string, readonly WorkflowEdge[]> {
  const index = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (!edge?.from) continue;
    const list = index.get(edge.from);
    if (list) list.push(edge);
    else index.set(edge.from, [edge]);
  }
  return index;
}

function incomingIndex(
  edges: readonly WorkflowEdge[],
): ReadonlyMap<string, readonly WorkflowEdge[]> {
  const index = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (!edge?.to) continue;
    const list = index.get(edge.to);
    if (list) list.push(edge);
    else index.set(edge.to, [edge]);
  }
  return index;
}

/**
 * Every parallel and join problem in a definition.
 *
 * Returns a list rather than throwing, in the same order for the same input, so
 * an author fixing four mistakes fixes them once — the convention the rest of
 * validation follows.
 */
export function validateParallelStructure(definition: WorkflowDefinition): string[] {
  const nodes = definition?.nodes ?? [];
  const edges = definition?.edges ?? [];
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return [];

  const byId = new Map<string, WorkflowNode>();
  for (const node of nodes) if (node?.nodeId && !byId.has(node.nodeId)) byId.set(node.nodeId, node);

  const parallelNodes = nodes.filter(
    (node): node is WorkflowParallelNode => !!node && isParallelNode(node),
  );
  const joinNodes = nodes.filter((node): node is WorkflowJoinNode => !!node && isJoinNode(node));

  const problems: string[] = [];

  if (parallelNodes.length > WORKFLOW_BOUNDS.parallelNodes.max) {
    problems.push(
      `graph declares ${parallelNodes.length} parallel nodes, above the ceiling of ` +
        `${WORKFLOW_BOUNDS.parallelNodes.max}`,
    );
  }

  const outgoing = outgoingIndex(edges);
  const incoming = incomingIndex(edges);

  // Which branch owns which node, across the whole graph. Built as the bodies
  // are walked so an overlap between two branches of DIFFERENT parallel nodes is
  // caught as readily as one between two branches of the same node.
  const owner = new Map<string, string>();
  const joinOwners = new Map<string, string[]>();

  for (const node of parallelNodes) {
    problems.push(
      ...parallelNodeProblems(definition, node, byId, outgoing, incoming, owner, joinOwners),
    );
  }

  for (const join of joinNodes) {
    const owners = joinOwners.get(join.nodeId) ?? [];
    if (owners.length === 0) {
      problems.push(
        `node ${join.nodeId}: a join node must be named by exactly one parallel node, and none names it`,
      );
    } else if (owners.length > 1) {
      problems.push(
        `node ${join.nodeId}: named as the join of more than one parallel node (${owners
          .slice()
          .sort()
          .join(', ')})`,
      );
    }
    problems.push(...joinNodeProblems(join, outgoing));
  }

  // An edge may only carry `branch` when it leaves a parallel node. Reported
  // here rather than in the generic successor rules because only this module
  // knows which nodes are parallel.
  for (const edge of edges) {
    if (!edge || edge.branch === undefined) continue;
    const from = byId.get(edge.from);
    if (!from || !isParallelNode(from)) {
      problems.push(
        `edge ${edge.from} -> ${edge.to}: only an edge leaving a parallel node may declare branch`,
      );
    }
  }

  return problems;
}

function parallelNodeProblems(
  definition: WorkflowDefinition,
  node: WorkflowParallelNode,
  byId: ReadonlyMap<string, WorkflowNode>,
  outgoing: ReadonlyMap<string, readonly WorkflowEdge[]>,
  incoming: ReadonlyMap<string, readonly WorkflowEdge[]>,
  owner: Map<string, string>,
  joinOwners: Map<string, string[]>,
): string[] {
  const label = `node ${node.nodeId}`;
  const problems: string[] = [];

  // ── The join it names ─────────────────────────────────────────────────────
  const join = typeof node.joinNodeId === 'string' ? byId.get(node.joinNodeId) : undefined;
  if (!join) {
    problems.push(`${label}: joinNodeId references unknown node ${String(node.joinNodeId)}`);
  } else if (!isJoinNode(join)) {
    problems.push(`${label}: joinNodeId ${node.joinNodeId} is a ${join.kind} node, not a join`);
  } else {
    const owners = joinOwners.get(join.nodeId);
    if (owners) owners.push(node.nodeId);
    else joinOwners.set(join.nodeId, [node.nodeId]);
  }

  if (!WORKFLOW_PARALLEL_FAILURE_POLICIES.includes(node.failurePolicy)) {
    problems.push(
      `${label}: failurePolicy ${String(node.failurePolicy)} is not one of ` +
        WORKFLOW_PARALLEL_FAILURE_POLICIES.join(', '),
    );
  }

  if (node.maximumParallelBranches !== undefined) {
    if (!Number.isInteger(node.maximumParallelBranches)) {
      problems.push(`${label}: maximumParallelBranches must be an integer`);
    } else if (
      node.maximumParallelBranches < WORKFLOW_PARALLEL_BOUNDS.minParallelBranches ||
      node.maximumParallelBranches > WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches
    ) {
      problems.push(
        `${label}: maximumParallelBranches must be between ` +
          `${WORKFLOW_PARALLEL_BOUNDS.minParallelBranches} and ` +
          `${WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches}`,
      );
    }
  }

  // ── The branch list ───────────────────────────────────────────────────────
  if (!Array.isArray(node.branches)) return [...problems, `${label}: branches must be an array`];

  const ceiling = effectiveBranchCeiling(definition, node);
  if (node.branches.length < WORKFLOW_PARALLEL_BOUNDS.minParallelBranches) {
    problems.push(
      `${label}: declares ${node.branches.length} branch(es) — a parallel node needs at least ` +
        `${WORKFLOW_PARALLEL_BOUNDS.minParallelBranches}, and one branch is a plain edge`,
    );
  }
  if (node.branches.length > ceiling) {
    problems.push(
      `${label}: declares ${node.branches.length} branches, above the effective ceiling of ${ceiling}`,
    );
  }

  const seenNames = new Set<string>();
  for (const [index, branch] of node.branches.entries()) {
    const branchLabel = `${label}.branches[${index}]`;
    if (!branch) {
      problems.push(`${branchLabel} is missing`);
      continue;
    }
    if (!WORKFLOW_BRANCH_NAME_PATTERN.test(branch.branchName ?? '')) {
      problems.push(`${branchLabel}: branchName must be lower-case alphanumeric with underscores`);
    } else if (seenNames.has(branch.branchName)) {
      // A duplicate name makes the merge key ambiguous and the deterministic
      // branch id non-unique, which are the two things the name exists to be.
      problems.push(`${branchLabel}: duplicate branchName ${branch.branchName}`);
    } else {
      seenNames.add(branch.branchName);
    }
    if (!byId.has(branch.startNodeId)) {
      problems.push(`${branchLabel}: startNodeId references unknown node ${String(branch.startNodeId)}`);
    }
  }

  // ── The edges that open them ──────────────────────────────────────────────
  const out = outgoing.get(node.nodeId) ?? [];
  const byBranchName = new Map<string, WorkflowEdge>();
  for (const edge of out) {
    if (edge.when !== undefined) {
      problems.push(`${label}: an edge out of a parallel node may not declare when`);
    }
    if (edge.loop !== undefined) {
      problems.push(`${label}: an edge out of a parallel node may not declare a loop bound`);
    }
    if (edge.branch === undefined) {
      problems.push(
        `${label}: edge -> ${edge.to} must declare which branch it opens`,
      );
      continue;
    }
    if (byBranchName.has(edge.branch)) {
      problems.push(`${label}: more than one edge opens branch ${edge.branch}`);
      continue;
    }
    byBranchName.set(edge.branch, edge);
  }

  for (const [name, edge] of byBranchName) {
    if (!seenNames.has(name)) {
      problems.push(`${label}: edge -> ${edge.to} opens undeclared branch ${name}`);
    }
  }

  if (join === undefined || !isJoinNode(join)) return problems;

  // ── The join's policy, against THIS node's branches ───────────────────────
  // Only here can the two be compared, and both comparisons catch a rename: a
  // required branch that no longer exists, and a minimum nothing can reach.
  problems.push(...requiredBranchNameProblems(node, join));
  if (
    join.policy?.kind === 'minimum_successes' &&
    Number.isInteger(join.policy.minimum) &&
    join.policy.minimum > node.branches.length
  ) {
    problems.push(
      `node ${join.nodeId}: requires ${join.policy.minimum} successes but ${node.nodeId} ` +
        `declares only ${node.branches.length} branches, so the join can never fire`,
    );
  }

  // ── The bodies ────────────────────────────────────────────────────────────
  for (const branch of node.branches) {
    if (!branch?.branchName || !byId.has(branch.startNodeId)) continue;
    const edge = byBranchName.get(branch.branchName);
    if (!edge) {
      problems.push(`${label}: branch ${branch.branchName} has no edge opening it`);
      continue;
    }
    if (edge.to !== branch.startNodeId) {
      problems.push(
        `${label}: branch ${branch.branchName} declares startNodeId ${branch.startNodeId} ` +
          `but its edge goes to ${edge.to}`,
      );
      continue;
    }
    problems.push(
      ...branchBodyProblems({
        parallelNodeId: node.nodeId,
        joinNodeId: join.nodeId,
        branchName: branch.branchName,
        startNodeId: branch.startNodeId,
        byId,
        outgoing,
        incoming,
        owner,
      }),
    );
  }

  return problems;
}

/**
 * Walk one branch body and report everything wrong with it.
 *
 * Depth-first with an on-path set, so a cycle inside a branch is reported as a
 * cycle rather than exhausting the walk. The join node is a wall: the walk stops
 * there and never inspects what lies beyond, which is exactly the reading that
 * makes "every path reaches the join" checkable in one pass.
 */
function branchBodyProblems(options: {
  readonly parallelNodeId: string;
  readonly joinNodeId: string;
  readonly branchName: string;
  readonly startNodeId: string;
  readonly byId: ReadonlyMap<string, WorkflowNode>;
  readonly outgoing: ReadonlyMap<string, readonly WorkflowEdge[]>;
  readonly incoming: ReadonlyMap<string, readonly WorkflowEdge[]>;
  readonly owner: Map<string, string>;
}): string[] {
  const { parallelNodeId, joinNodeId, branchName, startNodeId, byId, outgoing, incoming, owner } =
    options;
  const label = `node ${parallelNodeId} branch ${branchName}`;
  const problems: string[] = [];
  const ownerKey = `${parallelNodeId}/${branchName}`;

  const body = new Set<string>();
  const onPath = new Set<string>();

  const visit = (nodeId: string): void => {
    if (nodeId === joinNodeId) return;
    if (onPath.has(nodeId)) {
      problems.push(`${label}: contains a cycle through ${nodeId} — a branch body may not loop`);
      return;
    }
    if (body.has(nodeId)) return;

    const node = byId.get(nodeId);
    if (!node) {
      problems.push(`${label}: reaches unknown node ${nodeId}`);
      return;
    }
    if (node.kind !== 'agent' && node.kind !== 'condition') {
      problems.push(
        `${label}: reaches ${node.kind} node ${nodeId} — a branch body holds agent and ` +
          'condition nodes only, and parallelism does not nest in this batch',
      );
      return;
    }

    const claimed = owner.get(nodeId);
    if (claimed !== undefined && claimed !== ownerKey) {
      problems.push(
        `${label}: node ${nodeId} is already owned by branch ${claimed} — a node may belong ` +
          'to at most one branch',
      );
      return;
    }
    owner.set(nodeId, ownerKey);
    body.add(nodeId);
    onPath.add(nodeId);

    // Entry protection. A body node may be entered only by the parallel node
    // that owns the branch, or from inside the same body.
    for (const edge of incoming.get(nodeId) ?? []) {
      if (edge.from === parallelNodeId) continue;
      const from = byId.get(edge.from);
      if (from && (from.kind === 'agent' || from.kind === 'condition') &&
        owner.get(edge.from) === ownerKey) {
        continue;
      }
      problems.push(
        `${label}: node ${nodeId} is entered from ${edge.from}, which is outside the branch — ` +
          'a branch body may only be entered through its parallel node',
      );
    }

    const successors = outgoing.get(nodeId) ?? [];
    if (successors.length === 0) {
      problems.push(
        `${label}: node ${nodeId} has no successor — every path in a branch must reach ` +
          `the join ${joinNodeId}`,
      );
    }
    for (const edge of successors) visit(edge.to);

    onPath.delete(nodeId);
  };

  visit(startNodeId);

  if (body.size > WORKFLOW_PARALLEL_BOUNDS.maxBranchBodyNodes) {
    problems.push(
      `${label}: body holds ${body.size} nodes, above the ceiling of ` +
        `${WORKFLOW_PARALLEL_BOUNDS.maxBranchBodyNodes}`,
    );
  }

  return problems;
}

function joinNodeProblems(
  join: WorkflowJoinNode,
  outgoing: ReadonlyMap<string, readonly WorkflowEdge[]>,
): string[] {
  const label = `node ${join.nodeId}`;
  const problems: string[] = [];

  if (typeof join.mergeContract?.validate !== 'function') {
    problems.push(
      `${label}: mergeContract must be a validator — branch outputs only become a trusted ` +
        'node output by passing an explicitly declared merge schema',
    );
  }

  problems.push(...joinPolicyProblems(join.policy, label));

  const out = outgoing.get(join.nodeId) ?? [];
  if (out.length > 1) {
    problems.push(
      `${label} has ${out.length} outgoing edges — a join node takes exactly one successor`,
    );
  }
  for (const edge of out) {
    if (edge.when !== undefined) {
      problems.push(`${label}: only a condition node may declare when on its outgoing edges`);
    }
    if (edge.loop !== undefined) {
      problems.push(`${label}: an edge out of a join node may not declare a loop bound`);
    }
  }

  return problems;
}

function joinPolicyProblems(policy: WorkflowJoinPolicy | undefined, label: string): string[] {
  if (!policy || !WORKFLOW_JOIN_POLICY_KINDS.includes(policy.kind)) {
    return [
      `${label}: policy.kind must be one of ${WORKFLOW_JOIN_POLICY_KINDS.join(', ')}`,
    ];
  }

  if (policy.kind === 'minimum_successes') {
    if (!Number.isInteger(policy.minimum) || policy.minimum < 1) {
      return [`${label}: minimum_successes needs a minimum of at least 1`];
    }
    if (policy.minimum > WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches) {
      return [
        `${label}: minimum ${policy.minimum} exceeds the branch ceiling of ` +
          `${WORKFLOW_PARALLEL_BOUNDS.maximumParallelBranches}, so it can never be met`,
      ];
    }
  }

  if (policy.kind === 'named_required_branches') {
    if (!Array.isArray(policy.required) || policy.required.length === 0) {
      return [
        `${label}: named_required_branches needs at least one required branch — an empty ` +
          'list is an `any` join written in a way nobody reads as one',
      ];
    }
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const name of policy.required) {
      if (!WORKFLOW_BRANCH_NAME_PATTERN.test(name ?? '')) {
        problems.push(`${label}: required branch name ${String(name)} is not a valid branch name`);
      } else if (seen.has(name)) {
        problems.push(`${label}: required branch ${name} is listed more than once`);
      } else {
        seen.add(name);
      }
    }
    return problems;
  }

  return [];
}

/**
 * Do the join's required branch names exist on the parallel node that owns it?
 *
 * Separate from `joinPolicyProblems` because it needs both nodes, and it is the
 * check that catches the rename: a branch renamed from `compliance` to
 * `compliance_check` leaves a join requiring a branch nothing declares, and that
 * join would then be permanently unsatisfiable at runtime rather than refused at
 * registration.
 */
export function requiredBranchNameProblems(
  parallel: WorkflowParallelNode,
  join: WorkflowJoinNode,
): string[] {
  if (join.policy?.kind !== 'named_required_branches') return [];
  const declared = new Set((parallel.branches ?? []).map((branch) => branch?.branchName));
  return (join.policy.required ?? [])
    .filter((name) => !declared.has(name))
    .map(
      (name) =>
        `node ${join.nodeId}: requires branch ${name}, which ${parallel.nodeId} does not declare`,
    );
}
