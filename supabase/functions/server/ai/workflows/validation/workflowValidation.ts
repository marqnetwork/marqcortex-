/**
 * Workflow definition validation (AI-01 Batch 3B, Part 1).
 *
 * Everything that can be judged about a definition WITHOUT walking its graph:
 * identity, governance, node shape, edge shape, and the local rules that decide
 * whether a graph traversal is even meaningful. Reachability, cycles and the
 * plan itself belong to the planner, which runs after this passes.
 *
 * The split is not cosmetic. These checks are total and cheap — they terminate
 * on any input, including a definition assembled by a caller who got it wrong
 * in four places at once. The planner's checks are not: a dangling edge would
 * send a traversal to a node that does not exist, and a duplicate node id would
 * make "the node with this id" ambiguous. So the planner is entitled to assume
 * a structurally sound graph, because it never runs on one that is not.
 *
 * EVERY PROBLEM, NOT THE FIRST. A definition with four mistakes should be fixed
 * once. The return is a list, ordered so the same definition always produces the
 * same message sequence, and it is the caller — the registry, the planner — that
 * decides whether a non-empty list is a throw or a report.
 *
 * ── THE SINGLE-SUCCESSOR RULE ──────────────────────────────────────────────
 *
 * A node may have at most one outgoing edge in Part 1. This is the load-bearing
 * scope decision of the whole batch, so it is worth stating plainly rather than
 * leaving it to be inferred from a message string:
 *
 *   An edge carries no condition. Two outgoing edges from one node therefore
 *   mean "take both" — a fan-out — and a fan-out has to converge at a join
 *   before the workflow can finish. Conditions, parallel execution and joins
 *   are Part 2. A planner that accepted fan-out today would have to invent
 *   execution semantics that do not exist, or emit a plan whose steps run in an
 *   order nothing guarantees.
 *
 * Refusing the shape is the honest answer. The refusal names the missing
 * capability, so the author reads a scope boundary and not a mystery.
 */

import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '../contracts/workflow.ts';
import {
  WORKFLOW_AGENT_ID_PATTERN,
  WORKFLOW_BOUNDS,
  WORKFLOW_CERTIFICATION_STATUSES,
  WORKFLOW_ID_PATTERN,
  WORKFLOW_NODE_ID_PATTERN,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_VERSION_PATTERN,
} from '../contracts/workflow.ts';

export interface WorkflowValidationOptions {
  /**
   * Whether an agent id names a registered agent.
   *
   * A port, not an import of the agent registry: the workflow foundation must
   * be assemblable — and testable — without standing up an agent runtime, and
   * a definition can be checked for structural soundness long before the
   * registry that will run it exists. When it is absent, agent references are
   * checked for SHAPE only, and the omission is the caller's decision to make
   * knowingly rather than a silent downgrade inside this module.
   */
  readonly agentExists?: (agentId: string) => boolean;
}

/** Everything judgeable from one definition, without traversing its graph. */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
  options: WorkflowValidationOptions = {},
): string[] {
  const problems: string[] = [];

  if (!definition) return ['definition is missing'];

  problems.push(...identityProblems(definition));
  problems.push(...nodeProblems(definition.nodes, options));

  // Edges are only judgeable against a known-good node set. Validating them
  // against a set that contains duplicates or unnamed entries would report
  // "unknown node" for problems that are really the node list's.
  const nodeIds = knownNodeIds(definition.nodes);
  problems.push(...edgeProblems(definition.edges, nodeIds));
  problems.push(...startNodeProblems(definition, nodeIds));

  return problems;
}

function identityProblems(definition: WorkflowDefinition): string[] {
  const problems: string[] = [];

  if (!WORKFLOW_ID_PATTERN.test(definition.workflowId ?? '')) {
    problems.push('workflowId must be dotted lower-case, e.g. workflow.proposal.review');
  }
  if (!WORKFLOW_VERSION_PATTERN.test(definition.version ?? '')) {
    problems.push('version must be semver, e.g. 1.0.0');
  }
  if (!definition.displayName?.trim()) problems.push('displayName is empty');
  if (!definition.purpose?.trim()) problems.push('purpose is empty');
  if (!definition.description?.trim()) problems.push('description is empty');
  if (!definition.owner?.trim()) problems.push('owner is empty');
  if (typeof definition.enabled !== 'boolean') problems.push('enabled must be a boolean');
  if (!WORKFLOW_CERTIFICATION_STATUSES.includes(definition.certification)) {
    problems.push('certification is not a recognised status');
  }
  if (typeof definition.inputContract?.validate !== 'function') {
    problems.push('inputContract must be a validator');
  }
  if (typeof definition.outputContract?.validate !== 'function') {
    problems.push('outputContract must be a validator');
  }

  return problems;
}

function nodeProblems(
  nodes: readonly WorkflowNode[] | undefined,
  options: WorkflowValidationOptions,
): string[] {
  if (!Array.isArray(nodes)) return ['nodes must be an array'];

  const problems: string[] = [];
  const bound = WORKFLOW_BOUNDS.nodes;
  if (nodes.length < bound.min) problems.push('nodes is empty — a workflow needs a node to reach');
  if (nodes.length > bound.max) {
    problems.push(`nodes has ${nodes.length} entries, above the ceiling of ${bound.max}`);
  }

  const seen = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    const label = node?.nodeId ? `node ${node.nodeId}` : `node at index ${index}`;

    if (!node) {
      problems.push(`${label} is missing`);
      continue;
    }
    if (!WORKFLOW_NODE_ID_PATTERN.test(node.nodeId ?? '')) {
      problems.push(`${label}: nodeId must be lower-case alphanumeric with underscores`);
    } else if (seen.has(node.nodeId)) {
      // A duplicate id makes "the node with this id" ambiguous, which would
      // make every downstream answer — the plan, the digest, the metadata —
      // depend on which copy happened to be found first.
      problems.push(`${label}: duplicate nodeId`);
    } else {
      seen.add(node.nodeId);
    }

    if (!WORKFLOW_NODE_KINDS.includes(node.kind)) {
      problems.push(
        `${label}: kind ${String(node.kind)} is not supported — ` +
          'condition, parallel, join and approval nodes are not part of this batch',
      );
    }
    if (!WORKFLOW_AGENT_ID_PATTERN.test(node.agentId ?? '')) {
      problems.push(`${label}: agentId must be dotted lower-case, e.g. agent.example.reviewer`);
    } else if (options.agentExists && !options.agentExists(node.agentId)) {
      problems.push(`${label}: references unregistered agent ${node.agentId}`);
    }
    if (!node.displayName?.trim()) problems.push(`${label}: displayName is empty`);

    const attempts = WORKFLOW_BOUNDS.nodeAttempts;
    if (!Number.isInteger(node.maxAttempts)) {
      problems.push(`${label}: maxAttempts must be an integer`);
    } else if (node.maxAttempts < attempts.min || node.maxAttempts > attempts.max) {
      problems.push(`${label}: maxAttempts must be between ${attempts.min} and ${attempts.max}`);
    }
  }

  return problems;
}

function edgeProblems(
  edges: readonly WorkflowEdge[] | undefined,
  nodeIds: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(edges)) return ['edges must be an array'];

  const problems: string[] = [];
  const bound = WORKFLOW_BOUNDS.edges;
  if (edges.length > bound.max) {
    problems.push(`edges has ${edges.length} entries, above the ceiling of ${bound.max}`);
  }

  const seen = new Set<string>();
  const outDegree = new Map<string, number>();

  for (const [index, edge] of edges.entries()) {
    if (!edge) {
      problems.push(`edge at index ${index} is missing`);
      continue;
    }
    const label = `edge ${edge.from ?? '?'} -> ${edge.to ?? '?'}`;

    if (!nodeIds.has(edge.from)) {
      problems.push(`${label}: from references unknown node ${String(edge.from)}`);
    }
    if (!nodeIds.has(edge.to)) {
      problems.push(`${label}: to references unknown node ${String(edge.to)}`);
    }
    // A self-edge is a one-node cycle. The planner would find it, but naming it
    // here says what is wrong rather than reporting a cycle of length one.
    if (edge.from === edge.to) problems.push(`${label}: an edge cannot leave and enter one node`);

    const key = `${edge.from} ${edge.to}`;
    if (seen.has(key)) problems.push(`${label}: duplicate edge`);
    seen.add(key);

    if (nodeIds.has(edge.from) && edge.from !== edge.to) {
      outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    }
  }

  // See THE SINGLE-SUCCESSOR RULE at the top of this file. Reported in node-id
  // order so the same definition always produces the same message sequence.
  for (const nodeId of [...outDegree.keys()].sort()) {
    const degree = outDegree.get(nodeId) ?? 0;
    if (degree > 1) {
      problems.push(
        `node ${nodeId} has ${degree} outgoing edges — branching requires ` +
          'conditions, parallel execution and joins, which are not part of this batch',
      );
    }
  }

  return problems;
}

function startNodeProblems(
  definition: WorkflowDefinition,
  nodeIds: ReadonlySet<string>,
): string[] {
  const declared = definition.startNodeId;
  if (declared === undefined) return [];
  if (typeof declared !== 'string' || !nodeIds.has(declared)) {
    return [`startNodeId references unknown node ${String(declared)}`];
  }
  return [];
}

/**
 * Ids that unambiguously name exactly one node.
 *
 * A duplicated id is deliberately excluded rather than counted once: an edge
 * pointing at an ambiguous id should not be reported as valid, and the
 * duplication itself is already reported by `nodeProblems`.
 */
function knownNodeIds(nodes: readonly WorkflowNode[] | undefined): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const node of nodes ?? []) {
    if (!node?.nodeId) continue;
    counts.set(node.nodeId, (counts.get(node.nodeId) ?? 0) + 1);
  }
  const unique = new Set<string>();
  for (const [nodeId, count] of counts) if (count === 1) unique.add(nodeId);
  return unique;
}
