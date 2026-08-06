/**
 * Workflow definition validation (AI-01 Batch 3B, Parts 1 and 3).
 *
 * Everything that can be judged about a definition WITHOUT walking its graph:
 * identity, governance, node shape, edge shape, expressions, mappings, and the
 * local rules that decide whether a graph traversal is even meaningful.
 * Reachability, cycles, loop bodies and the plan itself belong to the planner,
 * which runs after this passes.
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
 * ── THE SUCCESSOR RULES ────────────────────────────────────────────────────
 *
 * Part 1 had one rule: at most one outgoing edge, always. Part 3 replaces it
 * with two, one per node kind, and the pair is still a refusal of fan-out:
 *
 *   AGENT NODE      at most ONE outgoing edge, carrying no `when`. Two
 *                   successors from a node that does not choose between them is
 *                   a parallel branch, which needs a join to finish, which is
 *                   not in this batch.
 *
 *   CONDITION NODE  exactly TWO outgoing edges, one `when: true` and one
 *                   `when: false`. Not one — a branch with a single side is a
 *                   dead end half the time and the author should say where it
 *                   goes. Not three — there is no third value.
 *
 * The result is that the number of successors a run takes from any node is
 * always exactly one. Branching changed which one; it did not change how many.
 */

import type {
  WorkflowAgentNode,
  WorkflowConditionNode,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '../contracts/workflow.ts';
import {
  WORKFLOW_AGENT_ID_PATTERN,
  WORKFLOW_BOUNDS,
  WORKFLOW_CERTIFICATION_STATUSES,
  WORKFLOW_ID_PATTERN,
  WORKFLOW_NODE_ID_PATTERN,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_VERSION_PATTERN,
} from '../contracts/workflow.ts';
import type { ReferenceContext } from './expressionValidation.ts';
import { validateExpression, validateMapping } from './expressionValidation.ts';

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

  // Expressions and mappings reference nodes by id, so the id set has to exist
  // before they can be checked. It is built from the raw list rather than from
  // the validated one: a reference to a node that is itself malformed should
  // report the malformed node, not a phantom "unknown node" as well.
  const declaredIds = new Set(
    (definition.nodes ?? []).map((node) => node?.nodeId).filter((id): id is string => !!id),
  );
  problems.push(...nodeProblems(definition.nodes, options, declaredIds));

  // Edges are only judgeable against a known-good node set. Validating them
  // against a set that contains duplicates or unnamed entries would report
  // "unknown node" for problems that are really the node list's.
  const nodeIds = knownNodeIds(definition.nodes);
  problems.push(...edgeProblems(definition.edges, nodeIds, kindsOf(definition.nodes)));
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
  declaredIds: ReadonlySet<string>,
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
      // make every downstream answer — the plan, the digest, the metadata,
      // every reference to its output — depend on which copy was found first.
      problems.push(`${label}: duplicate nodeId`);
    } else {
      seen.add(node.nodeId);
    }

    if (!node.displayName?.trim()) problems.push(`${label}: displayName is empty`);

    if (!WORKFLOW_NODE_KINDS.includes(node.kind)) {
      problems.push(
        `${label}: kind ${String(node.kind)} is not supported — ` +
          'this batch has agent and condition nodes',
      );
      continue;
    }

    const references: ReferenceContext = {
      knownNodeIds: declaredIds,
      ownerNodeId: node.nodeId ?? '',
    };

    problems.push(
      ...(node.kind === 'condition'
        ? conditionNodeProblems(node, references, label)
        : agentNodeProblems(node, options, references, label)),
    );
  }

  return problems;
}

function agentNodeProblems(
  node: WorkflowAgentNode,
  options: WorkflowValidationOptions,
  references: ReferenceContext,
  label: string,
): string[] {
  const problems: string[] = [];

  if (!WORKFLOW_AGENT_ID_PATTERN.test(node.agentId ?? '')) {
    problems.push(`${label}: agentId must be dotted lower-case, e.g. agent.example.reviewer`);
  } else if (options.agentExists && !options.agentExists(node.agentId)) {
    problems.push(`${label}: references unregistered agent ${node.agentId}`);
  }

  const attempts = WORKFLOW_BOUNDS.nodeAttempts;
  if (!Number.isInteger(node.maxAttempts)) {
    problems.push(`${label}: maxAttempts must be an integer`);
  } else if (node.maxAttempts < attempts.min || node.maxAttempts > attempts.max) {
    problems.push(`${label}: maxAttempts must be between ${attempts.min} and ${attempts.max}`);
  }

  if (node.inputMapping !== undefined) {
    problems.push(...validateMapping(node.inputMapping, references, `${label}.inputMapping`));
  }
  if (node.outputMapping !== undefined) {
    // The one context where `source: 'result'` has a referent — see
    // `contracts/expression.ts`. An output mapping is by definition the thing
    // that reads what the node just produced.
    problems.push(
      ...validateMapping(
        node.outputMapping,
        { ...references, allowResult: true },
        `${label}.outputMapping`,
      ),
    );
  }
  for (const [field, contract] of [
    ['inputContract', node.inputContract],
    ['outputContract', node.outputContract],
  ] as const) {
    if (contract !== undefined && typeof contract.validate !== 'function') {
      problems.push(`${label}: ${field} must be a validator`);
    }
  }
  // A mapping without a contract produces a value nothing checks, which for an
  // OUTPUT means an untrusted value would become a referenceable node output.
  // The input side is safe without one — the agent's own contract still applies
  // downstream — so only the output pairing is enforced.
  if (node.outputMapping !== undefined && node.outputContract === undefined) {
    problems.push(
      `${label}: outputMapping needs an outputContract — ` +
        'a stored node output must have passed a declared schema to be trusted',
    );
  }

  return problems;
}

function conditionNodeProblems(
  node: WorkflowConditionNode,
  references: ReferenceContext,
  label: string,
): string[] {
  if (node.expression === undefined) return [`${label}: condition node has no expression`];
  return validateExpression(node.expression, references, label);
}

function edgeProblems(
  edges: readonly WorkflowEdge[] | undefined,
  nodeIds: ReadonlySet<string>,
  kinds: ReadonlyMap<string, string>,
): string[] {
  if (!Array.isArray(edges)) return ['edges must be an array'];

  const problems: string[] = [];
  const bound = WORKFLOW_BOUNDS.edges;
  if (edges.length > bound.max) {
    problems.push(`edges has ${edges.length} entries, above the ceiling of ${bound.max}`);
  }

  const seen = new Set<string>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  let declaredLoops = 0;

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
    // A self-edge is a one-node cycle. Even declared as a loop it is refused:
    // a node whose only successor is itself has no body to put an exit in, so
    // the exit rule could never be satisfied.
    if (edge.from === edge.to) problems.push(`${label}: an edge cannot leave and enter one node`);

    const key = `${edge.from} ${edge.to}`;
    if (seen.has(key)) problems.push(`${label}: duplicate edge`);
    seen.add(key);

    if (edge.when !== undefined && typeof edge.when !== 'boolean') {
      problems.push(`${label}: when must be true or false`);
    }

    if (edge.loop !== undefined) {
      declaredLoops += 1;
      problems.push(...loopBoundProblems(edge, label));
    }

    if (nodeIds.has(edge.from) && edge.from !== edge.to) {
      const list = outgoing.get(edge.from);
      if (list) list.push(edge);
      else outgoing.set(edge.from, [edge]);
    }
  }

  // See THE SUCCESSOR RULES at the top of this file. Reported in node-id order
  // so the same definition always produces the same message sequence.
  for (const nodeId of [...outgoing.keys()].sort()) {
    const list = outgoing.get(nodeId) ?? [];
    problems.push(...successorProblems(nodeId, kinds.get(nodeId), list));
  }

  // A condition node with NO outgoing edges never reached the loop above.
  for (const [nodeId, kind] of [...kinds.entries()].sort()) {
    if (kind === 'condition' && !outgoing.has(nodeId)) {
      problems.push(`node ${nodeId}: a condition node needs a true edge and a false edge`);
    }
  }

  if (declaredLoops > WORKFLOW_BOUNDS.maxTotalLoopIterations) {
    problems.push(`edges declare ${declaredLoops} loops, which exceeds what a run may spend`);
  }

  return problems;
}

function successorProblems(
  nodeId: string,
  kind: string | undefined,
  edges: readonly WorkflowEdge[],
): string[] {
  const problems: string[] = [];

  if (kind === 'condition') {
    const trueEdges = edges.filter((edge) => edge.when === true);
    const falseEdges = edges.filter((edge) => edge.when === false);
    const unlabelled = edges.filter((edge) => edge.when === undefined);

    if (unlabelled.length > 0) {
      problems.push(
        `node ${nodeId}: every edge out of a condition node must declare when: true or when: false`,
      );
    }
    if (trueEdges.length !== 1 || falseEdges.length !== 1) {
      problems.push(
        `node ${nodeId}: a condition node needs exactly one true edge and one false edge, ` +
          `found ${trueEdges.length} true and ${falseEdges.length} false`,
      );
    }
    return problems;
  }

  if (edges.some((edge) => edge.when !== undefined)) {
    problems.push(
      `node ${nodeId}: only a condition node may declare when on its outgoing edges`,
    );
  }
  if (edges.length > 1) {
    problems.push(
      `node ${nodeId} has ${edges.length} outgoing edges — an agent node takes exactly one ` +
        'successor, and branching belongs to a condition node',
    );
  }
  return problems;
}

function loopBoundProblems(edge: WorkflowEdge, label: string): string[] {
  const bound = WORKFLOW_BOUNDS.loopIterations;
  const max = edge.loop?.maxIterations;
  if (!Number.isInteger(max)) return [`${label}: loop.maxIterations must be an integer`];
  if ((max as number) < bound.min || (max as number) > bound.max) {
    return [`${label}: loop.maxIterations must be between ${bound.min} and ${bound.max}`];
  }
  return [];
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

function kindsOf(nodes: readonly WorkflowNode[] | undefined): ReadonlyMap<string, string> {
  const kinds = new Map<string, string>();
  for (const node of nodes ?? []) {
    if (node?.nodeId && !kinds.has(node.nodeId)) kinds.set(node.nodeId, node.kind);
  }
  return kinds;
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
