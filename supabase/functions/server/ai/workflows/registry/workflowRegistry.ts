/**
 * The Workflow Registry (AI-01 Batch 3B).
 *
 * Registration is the review gate. A definition that reaches `register` has its
 * identity, version, contracts, limits, graph, allow lists and approval posture
 * checked in one pass, and a definition that fails ANY of them is refused —
 * there is no partial registration, no warning-and-continue, and no runtime
 * discovery of a graph that could not have worked.
 *
 * WHY VALIDATION LIVES HERE AND NOT IN THE ORCHESTRATOR.
 *
 * Every problem this module rejects is a problem in DATA, not in an execution.
 * An unreachable node, a join nobody feeds, a branch that never terminates, a
 * tool the workflow never declared — all of them are visible without running
 * anything, and all of them are cheaper to find in a code review than in an
 * incident. The orchestrator's job is to enforce what happens at run time; the
 * registry's job is to make sure the thing it will enforce is coherent.
 *
 * NO INLINE PRODUCTION WORKFLOWS. Batch 3B ships no business workflow, and the
 * production registry starts empty. A deployment registers definitions
 * explicitly, in code, reviewed as code. There is no API that creates one —
 * customer-created workflows are out of scope, and an endpoint that could make
 * one would be the whole of that scope arriving through the back door.
 */

import type {
  WorkflowDefinition,
  WorkflowDescriptor,
  WorkflowJoinNode,
  WorkflowNode,
  WorkflowParallelNode,
} from '../contracts/workflow.ts';
import {
  PLATFORM_PLAN_BOUNDS,
  SEMANTIC_VERSION_PATTERN,
  TERMINAL_NODE_TYPES,
  WORKFLOW_BRANCH_ID_PATTERN,
  WORKFLOW_EDGE_ID_PATTERN,
  WORKFLOW_ID_PATTERN,
  WORKFLOW_LIMIT_BOUNDS,
  WORKFLOW_NODE_ID_PATTERN,
  describeWorkflow,
  isWorkflowNodeType,
} from '../contracts/workflow.ts';
import { workflowFailure } from '../contracts/failures.ts';
import type { WorkflowGraph } from '../runtime/graph.ts';
import {
  branchEdgesOf,
  branchSubgraph,
  buildGraph,
  edgesFrom,
  findCycle,
  reachableFrom,
  reachesTerminal,
} from '../runtime/graph.ts';

/** Node types whose only legal outgoing edge kind is `always`. */
const SEQUENTIAL_NODE_TYPES = [
  'agent',
  'model',
  'tool',
  'approval',
  'checkpoint',
  'wait',
  'transform',
  'join',
] as const;

export interface WorkflowRegistryDependencies {
  /** Read live: a deployment may require certification at any time. */
  readonly requireCertification: () => boolean;
  /** Agent ids that actually exist. Empty means "cannot check", not "none". */
  readonly knownAgentIds?: () => readonly string[];
  readonly knownToolIds?: () => readonly string[];
  readonly knownProfileIds?: () => readonly string[];
}

export interface WorkflowRegistry {
  register(definition: WorkflowDefinition): void;
  registerAll(definitions: readonly WorkflowDefinition[]): void;
  find(workflowId: string): WorkflowDefinition | undefined;
  /** The definition, or a typed refusal naming why it may not be used. */
  require(workflowId: string): WorkflowDefinition;
  list(): readonly WorkflowDescriptor[];
  describe(workflowId: string): WorkflowDescriptor | undefined;
  size(): number;
  /** Cross-definition problems found after registration. Never throws. */
  validate(): readonly string[];
}

function bounded(
  value: number,
  bounds: { readonly min: number; readonly max: number },
): boolean {
  return Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}

/**
 * Every problem with a definition, as sentences a reviewer can act on.
 *
 * Returns a list rather than throwing on the first problem, because a
 * definition with four mistakes should be reported with four mistakes — fixing
 * them one deployment at a time is how a validation gate becomes something
 * people route around.
 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
  context: {
    readonly requireCertification: boolean;
    readonly knownAgentIds?: readonly string[];
    readonly knownToolIds?: readonly string[];
    readonly knownProfileIds?: readonly string[];
  },
): readonly string[] {
  const problems: string[] = [];
  const add = (problem: string): void => {
    problems.push(problem);
  };

  // ── Identity ──────────────────────────────────────────────────────────────
  if (!WORKFLOW_ID_PATTERN.test(definition.workflowId ?? '')) {
    add('workflowId must look like workflow.intake.triage');
  }
  if (!SEMANTIC_VERSION_PATTERN.test(definition.version ?? '')) {
    add(`version "${definition.version}" is not a semantic version (major.minor.patch)`);
  }
  if (!definition.name?.trim()) add('name is empty');
  if (!definition.description?.trim()) add('description is empty');
  if (!definition.owner?.trim()) add('owner is empty');
  if (typeof definition.inputContract?.validate !== 'function') {
    add('inputContract is not a validator');
  }
  if (typeof definition.outputContract?.validate !== 'function') {
    add('outputContract is not a validator');
  }
  if (definition.certification === 'revoked') {
    add('certification is revoked; a revoked workflow may never be registered');
  }
  if (context.requireCertification && definition.certification !== 'certified') {
    add(
      `certification is "${definition.certification}" but this deployment requires certified workflows`,
    );
  }

  // ── Limits ────────────────────────────────────────────────────────────────
  const limits = definition.limits;
  if (!limits) {
    add('limits are missing');
  } else {
    for (const [key, bounds] of Object.entries(WORKFLOW_LIMIT_BOUNDS)) {
      if (!(key in limits)) continue;
      const value = (limits as unknown as Record<string, number>)[key];
      const range = bounds as { readonly min: number; readonly max: number };
      if (typeof range.min !== 'number') continue;
      if (!bounded(value, range)) {
        add(`limits.${key} must be an integer between ${range.min} and ${range.max}, got ${value}`);
      }
    }
    if (limits.maxTotalTokens < limits.maxPromptTokens) {
      add('limits.maxTotalTokens must be at least limits.maxPromptTokens');
    }
    if (limits.maxActualCostMicroUsd > limits.maxEstimatedCostMicroUsd) {
      add('limits.maxActualCostMicroUsd must not exceed limits.maxEstimatedCostMicroUsd');
    }
  }

  // ── Node and edge inventory ───────────────────────────────────────────────
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    add('nodes is empty');
    return problems;
  }
  if (definition.nodes.length > WORKFLOW_LIMIT_BOUNDS.maxNodes) {
    add(`nodes exceeds the platform maximum of ${WORKFLOW_LIMIT_BOUNDS.maxNodes}`);
  }
  if (!Array.isArray(definition.edges)) {
    add('edges is missing');
    return problems;
  }
  if (definition.edges.length > WORKFLOW_LIMIT_BOUNDS.maxEdges) {
    add(`edges exceeds the platform maximum of ${WORKFLOW_LIMIT_BOUNDS.maxEdges}`);
  }

  const nodeIds = new Set<string>();
  for (const node of definition.nodes) {
    if (!WORKFLOW_NODE_ID_PATTERN.test(node.nodeId ?? '')) {
      add(`node id "${node.nodeId}" is not a valid node identifier`);
      continue;
    }
    if (nodeIds.has(node.nodeId)) add(`node "${node.nodeId}" is declared more than once`);
    nodeIds.add(node.nodeId);
    problems.push(...validateNode(node, definition, context));
  }

  const edgeIds = new Set<string>();
  for (const edge of definition.edges) {
    if (!WORKFLOW_EDGE_ID_PATTERN.test(edge.edgeId ?? '')) {
      add(`edge id "${edge.edgeId}" is not a valid edge identifier`);
    } else if (edgeIds.has(edge.edgeId)) {
      add(`edge "${edge.edgeId}" is declared more than once`);
    }
    edgeIds.add(edge.edgeId);
    if (!nodeIds.has(edge.from)) add(`edge "${edge.edgeId}" starts at unknown node "${edge.from}"`);
    if (!nodeIds.has(edge.to)) add(`edge "${edge.edgeId}" targets unknown node "${edge.to}"`);
    if (edge.kind === 'branch') {
      if (!WORKFLOW_BRANCH_ID_PATTERN.test(edge.branchId ?? '')) {
        add(`edge "${edge.edgeId}" is a branch edge without a valid branchId`);
      }
    } else if (edge.branchId !== undefined) {
      add(`edge "${edge.edgeId}" is a ${edge.kind} edge and must not carry a branchId`);
    }
  }

  if (!nodeIds.has(definition.initialNodeId ?? '')) {
    add(`initialNodeId "${definition.initialNodeId}" is not a declared node`);
    return problems;
  }

  // Anything below this point walks the graph, and walking a graph whose ids do
  // not resolve produces confusing follow-on errors rather than useful ones.
  if (problems.length > 0) return problems;

  problems.push(...validateGraph(definition));
  return problems;
}

/** Per-node checks that do not need the graph. */
function validateNode(
  node: WorkflowNode,
  definition: WorkflowDefinition,
  context: {
    readonly knownAgentIds?: readonly string[];
    readonly knownToolIds?: readonly string[];
    readonly knownProfileIds?: readonly string[];
  },
): readonly string[] {
  const problems: string[] = [];
  const at = `node "${node.nodeId}"`;

  if (!isWorkflowNodeType(node.nodeType)) {
    problems.push(`${at} declares unsupported node type "${String(node.nodeType)}"`);
    return problems;
  }
  if (!node.purpose?.trim()) problems.push(`${at} has no purpose`);
  if (!bounded(node.timeoutMs, WORKFLOW_LIMIT_BOUNDS.nodeTimeoutMs)) {
    problems.push(
      `${at} timeoutMs must be between ${WORKFLOW_LIMIT_BOUNDS.nodeTimeoutMs.min} and ` +
        `${WORKFLOW_LIMIT_BOUNDS.nodeTimeoutMs.max}`,
    );
  }
  if (!node.retry || !bounded(node.retry.maxAttempts, WORKFLOW_LIMIT_BOUNDS.nodeRetryAttempts)) {
    problems.push(
      `${at} retry.maxAttempts must be between ${WORKFLOW_LIMIT_BOUNDS.nodeRetryAttempts.min} and ` +
        `${WORKFLOW_LIMIT_BOUNDS.nodeRetryAttempts.max}`,
    );
  }
  if (node.retry && (!Number.isInteger(node.retry.backoffMs) || node.retry.backoffMs < 0)) {
    problems.push(`${at} retry.backoffMs must be a non-negative integer`);
  }
  if (!Number.isInteger(node.tokenAllowance) || node.tokenAllowance < 0) {
    problems.push(`${at} tokenAllowance must be a non-negative integer`);
  }
  if (!Number.isInteger(node.costAllowanceMicroUsd) || node.costAllowanceMicroUsd < 0) {
    problems.push(`${at} costAllowanceMicroUsd must be a non-negative integer`);
  }
  if (node.onFailure === 'continue' && !node.optional) {
    problems.push(`${at} may only use onFailure "continue" when it is declared optional`);
  }

  // An approval rule nobody is authorised to grant is a run that can only
  // expire, so an empty role list is a definition error rather than a policy.
  const rule = node.nodeType === 'approval' ? node.approval : node.approval;
  if (rule) {
    if (rule.approverRoles.length === 0) {
      problems.push(`${at} declares an approval nobody is authorised to decide`);
    }
    if (!bounded(rule.expiresAfterMs, WORKFLOW_LIMIT_BOUNDS.approvalExpiresAfterMs)) {
      problems.push(
        `${at} approval.expiresAfterMs must be between ` +
          `${WORKFLOW_LIMIT_BOUNDS.approvalExpiresAfterMs.min} and ` +
          `${WORKFLOW_LIMIT_BOUNDS.approvalExpiresAfterMs.max}`,
      );
    }
    if (!rule.impactSummary?.trim()) {
      problems.push(`${at} declares an approval with no impact summary`);
    }
  }

  switch (node.nodeType) {
    case 'agent': {
      if (!definition.allowedAgents.includes(node.agentId)) {
        problems.push(`${at} names agent "${node.agentId}", which the workflow does not declare`);
      }
      if (context.knownAgentIds && !context.knownAgentIds.includes(node.agentId)) {
        problems.push(`${at} names agent "${node.agentId}", which is not registered`);
      }
      if (!node.objective?.trim()) problems.push(`${at} has no objective`);
      break;
    }
    case 'model': {
      if (!definition.allowedModelProfiles.includes(node.modelProfileId)) {
        problems.push(
          `${at} names model profile "${node.modelProfileId}", which the workflow does not declare`,
        );
      }
      if (context.knownProfileIds && !context.knownProfileIds.includes(node.modelProfileId)) {
        problems.push(`${at} names model profile "${node.modelProfileId}", which is not registered`);
      }
      if (!node.objective?.trim()) problems.push(`${at} has no objective`);
      if (node.tokenAllowance <= 0) {
        problems.push(`${at} is a model node and must declare a positive tokenAllowance`);
      }
      if (node.costAllowanceMicroUsd <= 0) {
        problems.push(`${at} is a model node and must declare a positive costAllowanceMicroUsd`);
      }
      if (node.context.length > WORKFLOW_LIMIT_BOUNDS.maxContextSections) {
        problems.push(
          `${at} declares ${node.context.length} context sections, above the platform maximum of ` +
            `${WORKFLOW_LIMIT_BOUNDS.maxContextSections}`,
        );
      }
      const sectionIds = new Set<string>();
      for (const section of node.context) {
        if (sectionIds.has(section.sectionId)) {
          problems.push(`${at} declares context section "${section.sectionId}" twice`);
        }
        sectionIds.add(section.sectionId);
        if (!section.relevanceReason?.trim()) {
          problems.push(`${at} context section "${section.sectionId}" has no relevance reason`);
        }
        if (!Number.isInteger(section.maxTokens) || section.maxTokens <= 0) {
          problems.push(`${at} context section "${section.sectionId}" needs a positive maxTokens`);
        }
        if (section.tenantScope !== 'run_organization' && section.tenantScope !== 'platform') {
          problems.push(`${at} context section "${section.sectionId}" has an unknown tenant scope`);
        }
      }
      if (node.requiredOutputFields.length === 0) {
        problems.push(`${at} must declare at least one required output field`);
      }
      if (node.cacheable) {
        if (!Number.isInteger(node.cacheTtlMs) || node.cacheTtlMs <= 0) {
          problems.push(`${at} is cacheable and must declare a positive cacheTtlMs`);
        } else if (node.cacheTtlMs > WORKFLOW_LIMIT_BOUNDS.maxCacheTtlMs) {
          problems.push(
            `${at} cacheTtlMs exceeds the platform maximum of ${WORKFLOW_LIMIT_BOUNDS.maxCacheTtlMs}`,
          );
        }
        if (node.approval !== undefined) {
          problems.push(`${at} is approval-gated and must not be cacheable`);
        }
      }
      break;
    }
    case 'tool': {
      if (!definition.allowedTools.includes(node.toolId)) {
        problems.push(`${at} names tool "${node.toolId}", which the workflow does not declare`);
      }
      if (context.knownToolIds && !context.knownToolIds.includes(node.toolId)) {
        problems.push(`${at} names tool "${node.toolId}", which is not registered`);
      }
      break;
    }
    case 'condition': {
      if (!node.predicateId?.trim()) problems.push(`${at} names no predicate`);
      break;
    }
    case 'parallel': {
      if (!node.joinNodeId?.trim()) problems.push(`${at} names no join node`);
      break;
    }
    case 'join': {
      if (node.policy === 'minimum_successes') {
        if (!Number.isInteger(node.minimumSuccesses) || (node.minimumSuccesses ?? 0) < 1) {
          problems.push(`${at} uses minimum_successes and needs a positive minimumSuccesses`);
        }
      }
      if (node.policy === 'named_required_branches') {
        if (!node.requiredBranchIds || node.requiredBranchIds.length === 0) {
          problems.push(`${at} uses named_required_branches and names none`);
        }
      }
      break;
    }
    case 'approval': {
      if (!node.approval) problems.push(`${at} is an approval node with no approval rule`);
      break;
    }
    case 'wait': {
      if (!bounded(node.waitMs, WORKFLOW_LIMIT_BOUNDS.waitMs)) {
        problems.push(
          `${at} waitMs must be between ${WORKFLOW_LIMIT_BOUNDS.waitMs.min} and ` +
            `${WORKFLOW_LIMIT_BOUNDS.waitMs.max}`,
        );
      }
      break;
    }
    case 'transform': {
      if (!node.transformId?.trim()) problems.push(`${at} names no transform`);
      if (node.avoidsModelCall) {
        // A saving has to be measured against something. A transform that
        // claims to replace a model call without naming the profile it
        // replaced would let the avoided-call ledger record a number nobody
        // can check, which is the one thing that ledger must never do.
        if (!node.avoidedProfileId) {
          problems.push(`${at} claims to avoid a model call but names no profile to compare with`);
        } else if (!definition.allowedModelProfiles.includes(node.avoidedProfileId)) {
          problems.push(
            `${at} compares against profile "${node.avoidedProfileId}", which the workflow does not declare`,
          );
        }
        if (!((node.avoidedPromptTokens ?? 0) > 0) || !((node.avoidedCompletionTokens ?? 0) > 0)) {
          problems.push(`${at} claims to avoid a model call but declares no avoided token counts`);
        }
      }
      break;
    }
    case 'fail': {
      if (!node.failureReason?.trim()) problems.push(`${at} declares no failure reason`);
      break;
    }
    case 'checkpoint':
    case 'complete':
      break;
  }

  // A node that can cause an irreversible effect and has no approval attached
  // is only acceptable when the workflow itself is not classified as causing
  // external effects. This is the "unsafe side effects without approval" rule,
  // stated once and enforced at registration.
  if (
    definition.safetyClass === 'external_effect' &&
    (node.nodeType === 'tool' || node.nodeType === 'agent') &&
    node.approval === undefined
  ) {
    problems.push(
      `${at} can cause an external effect in an external_effect workflow and must be approval-gated`,
    );
  }

  return problems;
}

/** Structural checks that need the whole graph. */
function validateGraph(definition: WorkflowDefinition): readonly string[] {
  const problems: string[] = [];
  const graph = buildGraph(definition);

  // ── Per-node edge shape ───────────────────────────────────────────────────
  for (const node of definition.nodes) {
    const outgoing = edgesFrom(graph, node.nodeId);
    const at = `node "${node.nodeId}"`;
    const byKind = {
      always: outgoing.filter((edge) => edge.kind === 'always'),
      truthy: outgoing.filter((edge) => edge.kind === 'true'),
      falsy: outgoing.filter((edge) => edge.kind === 'false'),
      branch: outgoing.filter((edge) => edge.kind === 'branch'),
      failure: outgoing.filter((edge) => edge.kind === 'failure'),
    };

    if (TERMINAL_NODE_TYPES.includes(node.nodeType)) {
      if (outgoing.length > 0) problems.push(`${at} is terminal and must have no outgoing edge`);
      continue;
    }

    if (node.nodeType === 'condition') {
      if (byKind.truthy.length !== 1 || byKind.falsy.length !== 1) {
        problems.push(`${at} is a condition and needs exactly one true edge and one false edge`);
      }
      if (byKind.always.length > 0 || byKind.branch.length > 0) {
        problems.push(`${at} is a condition and may only declare true, false and failure edges`);
      }
    } else if (node.nodeType === 'parallel') {
      if (byKind.branch.length < 2) {
        problems.push(`${at} is a parallel node and needs at least two branch edges`);
      }
      if (byKind.always.length > 0 || byKind.truthy.length > 0 || byKind.falsy.length > 0) {
        problems.push(`${at} is a parallel node and may only declare branch and failure edges`);
      }
      const branchIds = new Set<string>();
      for (const edge of byKind.branch) {
        if (edge.branchId !== undefined && branchIds.has(edge.branchId)) {
          problems.push(`${at} declares branch "${edge.branchId}" twice`);
        }
        if (edge.branchId !== undefined) branchIds.add(edge.branchId);
      }
      if (byKind.branch.length > definition.limits.maxParallelBranches) {
        problems.push(
          `${at} opens ${byKind.branch.length} branches, above limits.maxParallelBranches ` +
            `(${definition.limits.maxParallelBranches})`,
        );
      }
    } else if ((SEQUENTIAL_NODE_TYPES as readonly string[]).includes(node.nodeType)) {
      if (byKind.always.length !== 1) {
        problems.push(`${at} needs exactly one outgoing edge, found ${byKind.always.length}`);
      }
      if (byKind.branch.length > 0 || byKind.truthy.length > 0 || byKind.falsy.length > 0) {
        problems.push(`${at} may only declare an always edge and an optional failure edge`);
      }
    }

    if (byKind.failure.length > 1) {
      problems.push(`${at} declares more than one failure edge`);
    }
    if (node.onFailure === 'route' && byKind.failure.length !== 1) {
      problems.push(`${at} routes on failure but declares no failure edge`);
    }
    if (node.onFailure !== 'route' && byKind.failure.length > 0) {
      problems.push(`${at} declares a failure edge but does not route on failure`);
    }
  }

  // ── Acyclicity ────────────────────────────────────────────────────────────
  const cycle = findCycle(graph, definition.initialNodeId);
  if (cycle) {
    problems.push(
      `the graph contains a cycle (${cycle.join(' → ')}); Batch 3B workflows have no loop ` +
        'construct, so a cycle is an unbounded loop',
    );
    // Every check below traverses the graph. Doing so on a cyclic graph
    // produces noise rather than findings.
    return problems;
  }

  // ── Reachability ──────────────────────────────────────────────────────────
  const reachable = new Set(reachableFrom(graph, definition.initialNodeId));
  for (const node of definition.nodes) {
    if (!reachable.has(node.nodeId)) {
      problems.push(`node "${node.nodeId}" is unreachable from the initial node`);
    }
  }
  if (reachable.size > PLATFORM_PLAN_BOUNDS.maxReachableNodes) {
    problems.push(
      `${reachable.size} reachable nodes exceeds the platform maximum of ` +
        `${PLATFORM_PLAN_BOUNDS.maxReachableNodes}`,
    );
  }

  // ── Every path ends ───────────────────────────────────────────────────────
  if (!definition.nodes.some((node) => node.nodeType === 'complete')) {
    problems.push('the graph declares no complete node, so no run can succeed');
  }
  for (const nodeId of reachable) {
    const node = graph.nodesById.get(nodeId);
    if (!node || TERMINAL_NODE_TYPES.includes(node.nodeType)) continue;
    // A branch node's terminal outcome is its join, checked below. Asking it to
    // reach a `complete` node inside the branch would contradict the rule that
    // branches converge.
    if (!reachesTerminal(graph, nodeId) && !isInsideAnyBranch(definition, graph, nodeId)) {
      problems.push(`node "${nodeId}" has no path to a complete or fail node`);
    }
  }

  // ── Fan-out and joins ─────────────────────────────────────────────────────
  const joinOwners = new Map<string, string>();
  for (const node of definition.nodes) {
    if (node.nodeType !== 'parallel') continue;
    problems.push(...validateFanOut(definition, graph, node, joinOwners));
  }
  for (const node of definition.nodes) {
    if (node.nodeType !== 'join') continue;
    if (!joinOwners.has(node.nodeId)) {
      problems.push(
        `join "${node.nodeId}" is not the join of any parallel node, so its expected branches ` +
          'can never arrive',
      );
    }
  }

  return problems;
}

function isInsideAnyBranch(
  definition: WorkflowDefinition,
  graph: WorkflowGraph,
  nodeId: string,
): boolean {
  for (const node of definition.nodes) {
    if (node.nodeType !== 'parallel') continue;
    for (const edge of branchEdgesOf(graph, node)) {
      const subgraph = branchSubgraph(graph, {
        branchId: edge.branchId ?? edge.edgeId,
        startNodeId: edge.to,
        joinNodeId: node.joinNodeId,
      });
      if (subgraph.nodeIds.includes(nodeId)) return true;
    }
  }
  return false;
}

function validateFanOut(
  definition: WorkflowDefinition,
  graph: WorkflowGraph,
  node: WorkflowParallelNode,
  joinOwners: Map<string, string>,
): readonly string[] {
  const problems: string[] = [];
  const at = `parallel node "${node.nodeId}"`;

  const join = definition.nodes.find((candidate) => candidate.nodeId === node.joinNodeId);
  if (!join) {
    problems.push(`${at} names join "${node.joinNodeId}", which is not a declared node`);
    return problems;
  }
  if (join.nodeType !== 'join') {
    problems.push(`${at} names "${node.joinNodeId}", which is a ${join.nodeType} node, not a join`);
    return problems;
  }
  const existingOwner = joinOwners.get(join.nodeId);
  if (existingOwner !== undefined) {
    problems.push(
      `join "${join.nodeId}" is claimed by both "${existingOwner}" and "${node.nodeId}"; a join ` +
        'whose expected branch set has two sources cannot be satisfied deterministically',
    );
    return problems;
  }
  joinOwners.set(join.nodeId, node.nodeId);

  const branchEdges = branchEdgesOf(graph, node);
  const branchIds = branchEdges.map((edge) => edge.branchId ?? edge.edgeId);

  for (const edge of branchEdges) {
    const branchId = edge.branchId ?? edge.edgeId;
    const subgraph = branchSubgraph(graph, {
      branchId,
      startNodeId: edge.to,
      joinNodeId: join.nodeId,
    });
    if (!subgraph.reachesJoin) {
      problems.push(
        `branch "${branchId}" of ${at} never reaches join "${join.nodeId}", so the join can ` +
          'never be satisfied',
      );
    }
    for (const dangling of subgraph.danglingNodeIds) {
      problems.push(
        `branch "${branchId}" of ${at} ends at node "${dangling}", which has no outgoing edge`,
      );
    }
    for (const branchNodeId of subgraph.nodeIds) {
      const branchNode = graph.nodesById.get(branchNodeId);
      if (!branchNode) continue;
      if (TERMINAL_NODE_TYPES.includes(branchNode.nodeType)) {
        problems.push(
          `branch "${branchId}" of ${at} contains terminal node "${branchNodeId}"; a branch ends ` +
            'at its join, and failure is expressed through the node failure policy',
        );
      }
    }
  }

  const joinNode = join as WorkflowJoinNode;
  if (joinNode.policy === 'minimum_successes') {
    const minimum = joinNode.minimumSuccesses ?? 0;
    if (minimum > branchEdges.length) {
      problems.push(
        `join "${join.nodeId}" requires ${minimum} successes but only ${branchEdges.length} ` +
          'branches can arrive',
      );
    }
  }
  if (joinNode.policy === 'named_required_branches') {
    for (const required of joinNode.requiredBranchIds ?? []) {
      if (!branchIds.includes(required)) {
        problems.push(
          `join "${join.nodeId}" requires branch "${required}", which "${node.nodeId}" does not open`,
        );
      }
    }
  }

  return problems;
}

export function createWorkflowRegistry(deps: WorkflowRegistryDependencies): WorkflowRegistry {
  const definitions = new Map<string, WorkflowDefinition>();

  const validationContext = () => ({
    requireCertification: deps.requireCertification(),
    ...(deps.knownAgentIds === undefined ? {} : { knownAgentIds: deps.knownAgentIds() }),
    ...(deps.knownToolIds === undefined ? {} : { knownToolIds: deps.knownToolIds() }),
    ...(deps.knownProfileIds === undefined ? {} : { knownProfileIds: deps.knownProfileIds() }),
  });

  return {
    register(definition) {
      if (definitions.has(definition.workflowId)) {
        throw workflowFailure(
          'invalid_workflow_definition',
          'That workflow is already registered.',
          {
            workflowId: definition.workflowId,
            diagnostics: `duplicate workflow id ${definition.workflowId}`,
          },
        );
      }
      const problems = validateWorkflowDefinition(definition, validationContext());
      if (problems.length > 0) {
        throw workflowFailure('invalid_workflow_definition', 'That workflow definition is invalid.', {
          workflowId: definition.workflowId,
          diagnostics: `${definition.workflowId ?? '(no id)'}: ${problems.join('; ')}`,
        });
      }
      definitions.set(definition.workflowId, definition);
    },

    registerAll(incoming) {
      for (const definition of incoming) this.register(definition);
    },

    find: (workflowId) => definitions.get(workflowId),

    require(workflowId) {
      const definition = definitions.get(workflowId);
      if (!definition) {
        throw workflowFailure('workflow_not_found', 'That workflow is not available.', {
          workflowId,
          diagnostics: `workflow ${workflowId} is not registered`,
        });
      }
      if (!definition.enabled) {
        throw workflowFailure('workflow_disabled', 'That workflow is currently switched off.', {
          workflowId,
          diagnostics: `workflow ${workflowId} is disabled`,
        });
      }
      if (definition.certification === 'revoked') {
        throw workflowFailure('workflow_uncertified', 'That workflow has been withdrawn.', {
          workflowId,
          diagnostics: `workflow ${workflowId} certification is revoked`,
        });
      }
      if (deps.requireCertification() && definition.certification !== 'certified') {
        throw workflowFailure(
          'workflow_uncertified',
          'That workflow is not certified for this deployment.',
          {
            workflowId,
            diagnostics: `workflow ${workflowId} certification is ${definition.certification}`,
          },
        );
      }
      return definition;
    },

    list: () =>
      [...definitions.values()]
        .sort((a, b) => a.workflowId.localeCompare(b.workflowId))
        .map(describeWorkflow),

    describe(workflowId) {
      const definition = definitions.get(workflowId);
      return definition === undefined ? undefined : describeWorkflow(definition);
    },

    size: () => definitions.size,

    validate() {
      // Re-validation against the CURRENT context. A deployment that turns on
      // certification after registration has definitions that were legal when
      // they were registered and are not now, and reporting that is more useful
      // than pretending the registry is still coherent.
      const problems: string[] = [];
      const context = validationContext();
      for (const definition of definitions.values()) {
        for (const problem of validateWorkflowDefinition(definition, context)) {
          problems.push(`${definition.workflowId}: ${problem}`);
        }
      }
      return problems;
    },
  };
}
