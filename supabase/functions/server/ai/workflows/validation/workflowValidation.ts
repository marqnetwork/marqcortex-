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
 * Part 1 had one rule: at most one outgoing edge, always. Part 3 made it two,
 * one per node kind. Part 4 makes it four, and the set is still a refusal of
 * UNDECLARED fan-out:
 *
 *   AGENT NODE      at most ONE outgoing edge, carrying no `when` and no
 *                   `branch`. Two plain successors from a node that neither
 *                   chooses between them nor declares a join is a fan-out whose
 *                   convergence nobody wrote down, and it is still refused.
 *
 *   CONDITION NODE  exactly TWO outgoing edges, one `when: true` and one
 *                   `when: false`. Not one — a branch with a single side is a
 *                   dead end half the time and the author should say where it
 *                   goes. Not three — there is no third value.
 *
 *   PARALLEL NODE   one edge per DECLARED branch, each naming the branch it
 *                   opens. Checked in `parallelValidation.ts`, because the rule
 *                   is about agreement between the edges and a branch list this
 *                   module cannot see from an edge alone.
 *
 *   JOIN NODE       at most ONE outgoing edge, like an agent node. The merge is
 *                   where several lines of execution become one again, so what
 *                   leaves it is a single successor.
 *
 *   APPROVAL NODE   at most ONE outgoing edge (Part 5). A barrier does not
 *                   branch: "where does an approved run go" must have one
 *                   answer, and what a REJECTION does is `onRejection` on the
 *                   node rather than a second edge — an edge would make refusal
 *                   look like an ordinary path through the workflow, which is
 *                   the one thing it must never look like.
 *
 * The result is that the number of successors a run takes from any node is
 * exactly one, EXCEPT at a parallel node, where it is exactly the number of
 * branches that node declared and the join is already named.
 */

import type {
  WorkflowAgentNode,
  WorkflowApprovalNode,
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
  isApprovalNode,
} from '../contracts/workflow.ts';
import { WORKFLOW_PARALLEL_BOUNDS } from '../contracts/parallel.ts';
import {
  WORKFLOW_APPROVAL_BOUNDS,
  WORKFLOW_APPROVER_ROLE_PATTERN,
  WORKFLOW_REJECTION_POLICIES,
} from '../contracts/approval.ts';
import { WORKFLOW_RETRY_BACKOFFS, WORKFLOW_RETRY_BOUNDS } from '../contracts/retry.ts';
import type { ReferenceContext } from './expressionValidation.ts';
import { validateExpression, validateMapping } from './expressionValidation.ts';
import { validateParallelStructure } from './parallelValidation.ts';

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
  // Parallel structure last: it is the only check that reads a node's branch
  // list against the edges leaving it, and running it after the node and edge
  // sets have been judged means it never reports "unknown branch node" for a
  // node the list above already reported as malformed.
  problems.push(...validateParallelStructure(definition));

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

  if (definition.maximumParallelBranches !== undefined) {
    const bounds = WORKFLOW_PARALLEL_BOUNDS;
    if (!Number.isInteger(definition.maximumParallelBranches)) {
      problems.push('maximumParallelBranches must be an integer');
    } else if (
      definition.maximumParallelBranches < bounds.minParallelBranches ||
      definition.maximumParallelBranches > bounds.maximumParallelBranches
    ) {
      // Only ever a NARROWING of the platform ceiling. A definition that could
      // raise it would make the bound a suggestion.
      problems.push(
        `maximumParallelBranches must be between ${bounds.minParallelBranches} and ` +
          `${bounds.maximumParallelBranches}`,
      );
    }
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

  const approvals = nodes.filter((node) => node?.kind === 'approval').length;
  if (approvals > WORKFLOW_BOUNDS.approvalNodes.max) {
    problems.push(
      `nodes declare ${approvals} approval nodes, above the ceiling of ` +
        `${WORKFLOW_BOUNDS.approvalNodes.max}`,
    );
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
          'this batch has agent, condition, parallel, join and approval nodes',
      );
      continue;
    }

    const references: ReferenceContext = {
      knownNodeIds: declaredIds,
      ownerNodeId: node.nodeId ?? '',
    };

    // Parallel and join nodes carry no expression, no mapping and no agent, so
    // there is nothing for this module to say about them — everything they
    // declare is a statement about the GRAPH, and `parallelValidation.ts` owns
    // that. Naming them here rather than falling through to the agent rules is
    // what stops a parallel node being reported as an agent node missing an id.
    if (node.kind === 'parallel' || node.kind === 'join') continue;

    if (isApprovalNode(node)) {
      problems.push(...approvalNodeProblems(node, label));
      continue;
    }

    problems.push(
      ...(node.kind === 'condition'
        ? conditionNodeProblems(node, references, label)
        : agentNodeProblems(node, options, references, label)),
    );
  }

  return problems;
}

/**
 * An approval node is judged entirely on its governance, because governance is
 * all it has: it names no agent, carries no mapping and produces no output.
 *
 * Every field below is one an approver depends on or one the platform enforces
 * on their behalf, so every one of them is required rather than defaulted. A
 * node that declared no approver roles would be an approval nobody could give;
 * one that defaulted its roles to something sensible would be a workflow whose
 * authority came from a constant instead of from a review.
 */
function approvalNodeProblems(node: WorkflowApprovalNode, label: string): string[] {
  const problems: string[] = [];
  const bounds = WORKFLOW_APPROVAL_BOUNDS;

  const roles = node.approverRoles;
  if (!Array.isArray(roles)) {
    problems.push(`${label}: approverRoles must be an array`);
  } else if (roles.length < bounds.approverRoles.min || roles.length > bounds.approverRoles.max) {
    problems.push(
      `${label}: approverRoles must name between ${bounds.approverRoles.min} and ` +
        `${bounds.approverRoles.max} roles`,
    );
  } else {
    for (const role of roles) {
      if (typeof role !== 'string' || !WORKFLOW_APPROVER_ROLE_PATTERN.test(role)) {
        problems.push(
          `${label}: approver role ${String(role)} must be lower-case alphanumeric ` +
            'with underscores',
        );
      }
    }
    if (new Set(roles).size !== roles.length) {
      problems.push(`${label}: approverRoles contains a duplicate`);
    }
  }

  problems.push(...textProblems(node.reason, bounds.reason, `${label}: reason`));
  problems.push(
    ...textProblems(node.impactSummary, bounds.impactSummary, `${label}: impactSummary`),
  );

  if (!Number.isInteger(node.expiresAfterMs)) {
    problems.push(`${label}: expiresAfterMs must be an integer`);
  } else if (
    node.expiresAfterMs < bounds.expiresAfterMs.min ||
    node.expiresAfterMs > bounds.expiresAfterMs.max
  ) {
    problems.push(
      `${label}: expiresAfterMs must be between ${bounds.expiresAfterMs.min} and ` +
        `${bounds.expiresAfterMs.max}`,
    );
  }

  if (!WORKFLOW_REJECTION_POLICIES.includes(node.onRejection)) {
    problems.push(
      `${label}: onRejection must be one of ${WORKFLOW_REJECTION_POLICIES.join(', ')} — ` +
        'what a refusal does is declared, never assumed',
    );
  }

  for (const [field, value] of [
    ['estimatedAdditionalTokens', node.estimatedAdditionalTokens],
    ['estimatedAdditionalCostMicroUsd', node.estimatedAdditionalCostMicroUsd],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < bounds.estimate.min || value > bounds.estimate.max) {
      problems.push(
        `${label}: ${field} must be an integer between ${bounds.estimate.min} and ` +
          `${bounds.estimate.max}`,
      );
    }
  }

  return problems;
}

function textProblems(
  value: unknown,
  bounds: { readonly min: number; readonly max: number },
  label: string,
): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [`${label} is empty`];
  const length = value.trim().length;
  if (length < bounds.min || length > bounds.max) {
    return [`${label} must be between ${bounds.min} and ${bounds.max} characters`];
  }
  return [];
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

  problems.push(...retryPolicyProblems(node, label));

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

/**
 * A declared retry policy has to agree with itself (AI-01 Batch 3B, Part 5).
 *
 * Two refusals, and both are about a field that reads as though it does
 * something and does not:
 *
 *   A DELAY ON `immediate` would appear in a review as a wait that never
 *   happens. `maxDelayMs` on `fixed_delay` is the same mistake — nothing grows,
 *   so nothing is capped.
 *
 *   A POLICY THAT WAITS AND DECLARES NO DELAY would silently behave as
 *   `immediate`, which is the opposite of what its author wrote down.
 *
 * A policy on a node whose `maxAttempts` is 1 is refused for the same family of
 * reasons: it declares a backoff for retries that can never happen.
 */
function retryPolicyProblems(node: WorkflowAgentNode, label: string): string[] {
  const policy = node.retryPolicy;
  if (policy === undefined) return [];

  const problems: string[] = [];
  const bounds = WORKFLOW_RETRY_BOUNDS;

  if (!WORKFLOW_RETRY_BACKOFFS.includes(policy.backoff)) {
    return [
      `${label}: retryPolicy.backoff must be one of ${WORKFLOW_RETRY_BACKOFFS.join(', ')}`,
    ];
  }

  if (node.maxAttempts === 1) {
    problems.push(
      `${label}: retryPolicy is declared but maxAttempts is 1 — ` +
        'a backoff for retries that cannot happen reads like a limit and is not one',
    );
  }

  if (policy.backoff === 'immediate') {
    if (policy.delayMs !== undefined) {
      problems.push(`${label}: retryPolicy.delayMs is not permitted with immediate backoff`);
    }
    if (policy.maxDelayMs !== undefined) {
      problems.push(`${label}: retryPolicy.maxDelayMs is not permitted with immediate backoff`);
    }
    return problems;
  }

  if (!Number.isInteger(policy.delayMs)) {
    problems.push(`${label}: retryPolicy.delayMs must be an integer for ${policy.backoff} backoff`);
  } else if (
    (policy.delayMs as number) < bounds.delayMs.min ||
    (policy.delayMs as number) > bounds.delayMs.max
  ) {
    problems.push(
      `${label}: retryPolicy.delayMs must be between ${bounds.delayMs.min} and ` +
        `${bounds.delayMs.max}`,
    );
  }

  if (policy.backoff === 'fixed_delay' && policy.maxDelayMs !== undefined) {
    problems.push(
      `${label}: retryPolicy.maxDelayMs is not permitted with fixed_delay backoff — ` +
        'a fixed delay does not grow, so there is nothing to cap',
    );
  }

  if (policy.backoff === 'exponential' && policy.maxDelayMs !== undefined) {
    if (!Number.isInteger(policy.maxDelayMs)) {
      problems.push(`${label}: retryPolicy.maxDelayMs must be an integer`);
    } else if (
      policy.maxDelayMs < bounds.maxDelayMs.min ||
      policy.maxDelayMs > bounds.maxDelayMs.max
    ) {
      problems.push(
        `${label}: retryPolicy.maxDelayMs must be between ${bounds.maxDelayMs.min} and ` +
          `${bounds.maxDelayMs.max}`,
      );
    }
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

  // A parallel node's successors are judged against its declared branch list,
  // which only `parallelValidation.ts` can see. Applying the one-successor rule
  // here would report every legitimate fan-out as a defect.
  if (kind === 'parallel') return problems;

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
      `node ${nodeId} has ${edges.length} outgoing edges — ` +
        (kind === 'join'
          ? 'a join node takes exactly one successor'
          : kind === 'approval'
            ? 'an approval node takes exactly one successor, and what a rejection does is ' +
              'declared in onRejection rather than as a second edge'
            : 'an agent node takes exactly one successor, and branching belongs to a condition ' +
              'node or a parallel node'),
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
