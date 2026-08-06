/**
 * The Workflow Registry (AI-01 Batch 3B).
 *
 * The single answer to "which workflows exist and what is each one allowed to
 * compose?". Registration is the only way a workflow becomes runnable, and
 * registration VALIDATES THE WHOLE PLAN — not the syntax of a definition, but
 * the properties that make it executable at all:
 *
 *   THE GRAPH IS ACYCLIC. Cycles are rejected here, at assembly, on every
 *   instance, rather than discovered at runtime by a step counter. This is the
 *   opposite of the decision `agents/registry/agentRegistry.ts` makes about
 *   handoff cycles, and deliberately so: an agent handoff cycle is a legitimate
 *   topology whose runtime behaviour is bounded by loop protection, whereas a
 *   dependency cycle in a plan is not a topology at all — there is no order in
 *   which those nodes can run, and no runtime bound can turn one into an order.
 *
 *   EVERY REFERENCE RESOLVES. Dependencies name declared nodes; fact conditions
 *   name facts some node publishes; agent nodes name agents the AGENT REGISTRY
 *   knows; tool nodes name tools the TOOL REGISTRY knows. A workflow cannot
 *   compose something that does not exist, and it cannot compose something it
 *   was not the author's to compose — the agent and tool registries remain the
 *   authority on what those are permitted to do.
 *
 *   THE PLAN CAN FINISH. There is at least one terminal node, the entry node has
 *   no dependencies, and every node is reachable from the entry. A definition
 *   with an unreachable node is not a smaller workflow with a dead branch; it is
 *   a plan whose author believed something would run that never will.
 *
 * FAIL CLOSED, IN BOTH DIRECTIONS — the same contract the agent registry has.
 * An invalid definition is not registered. `require()` refuses a disabled
 * workflow, a revoked one, and an uncertified one when the deployment demands
 * certification, with a typed failure that distinguishes the three.
 *
 * NO PRODUCTION WORKFLOWS SHIP IN THIS BATCH. The registry starts empty.
 * Business workflows and customer-authored workflows are both explicitly out of
 * scope, and inventing one to populate a console would be exactly the inline
 * production workflow the batch forbids.
 */

import type {
  WorkflowDefinition,
  WorkflowDescriptor,
  WorkflowLimits,
  WorkflowNode,
} from '../contracts/workflow.ts';
import {
  WORKFLOW_BOUNDS,
  WORKFLOW_LIMIT_BOUNDS,
  WORKFLOW_NODE_KINDS,
  describeWorkflow,
} from '../contracts/workflow.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { AIError } from '../../contracts/errors.ts';

/** Identifiers must be safe in a storage key, a log line and a metric label. */
const WORKFLOW_ID = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_]*)+$/;
const NODE_ID = /^[a-z][a-z0-9_]{0,47}$/;
const FACT_NAME = /^[a-z][a-z0-9_]{0,59}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export interface WorkflowRegistryOptions {
  /**
   * When true, only `certified` workflows may be resolved for execution. Read
   * live, so an operator raising the bar does not need a deploy — the same
   * contract the agent registry's certification switch has.
   */
  readonly requireCertification: () => boolean;
  /**
   * Does this agent exist and may it be composed? Injected rather than imported,
   * so the workflow registry validates against the REAL agent registry in
   * production and against a fixture set in a test, without either one importing
   * the other's assembly.
   */
  readonly agentExists: (agentId: string) => boolean;
  /** Does this tool exist? Same reasoning. */
  readonly toolExists: (toolId: string) => boolean;
  /**
   * Is this tool in that agent's allow list?
   *
   * Asked at REGISTRATION as well as at execution. The gateway refuses at
   * runtime whatever this answers, so this check adds no authority — what it
   * adds is the difference between a workflow that is rejected when it is
   * written and one that fails halfway through its first run.
   */
  readonly agentMayUseTool: (agentId: string, toolId: string) => boolean;
}

export interface WorkflowRegistry {
  register(definition: WorkflowDefinition): void;
  registerAll(definitions: readonly WorkflowDefinition[]): void;
  /** Resolve for EXECUTION. Enforces enabled and certification. Throws. */
  require(workflowId: string): WorkflowDefinition;
  /** Resolve without enforcement, for reads. Undefined when unknown. */
  find(workflowId: string): WorkflowDefinition | undefined;
  list(): readonly WorkflowDescriptor[];
  size(): number;
  /** Problems across the registered set. Empty means every plan is coherent. */
  validate(): readonly string[];
}

export function createWorkflowRegistry(options: WorkflowRegistryOptions): WorkflowRegistry {
  const definitions = new Map<string, WorkflowDefinition>();

  function registerOne(definition: WorkflowDefinition): void {
    const problems = validateWorkflowDefinition(definition, options);
    if (problems.length > 0) {
      throw new AIError('INTERNAL_ERROR', 'Workflow definition is invalid.', {
        diagnostics: `${definition.workflowId || '(no id)'}: ${problems.join('; ')}`,
      });
    }
    if (definitions.has(definition.workflowId)) {
      throw new AIError('INTERNAL_ERROR', 'Workflow is already registered.', {
        diagnostics: `duplicate workflow registration: ${definition.workflowId}`,
      });
    }
    definitions.set(definition.workflowId, definition);
  }

  return {
    register: registerOne,

    registerAll(incoming) {
      const added: string[] = [];
      try {
        for (const definition of incoming) {
          registerOne(definition);
          added.push(definition.workflowId);
        }
      } catch (error) {
        // All or nothing. A partially registered set leaves the runtime holding
        // workflows whose neighbours exist and workflows whose neighbours do
        // not, which is the state this validation exists to prevent.
        for (const workflowId of added) definitions.delete(workflowId);
        throw error;
      }
    },

    require(workflowId) {
      const definition = definitions.get(workflowId);
      if (!definition) {
        throw workflowFailure('workflow_not_found', 'That workflow is not available.', {
          workflowId,
          diagnostics: `workflowId=${workflowId}`,
        });
      }
      if (definition.certification === 'revoked') {
        throw workflowFailure('workflow_uncertified', 'That workflow has been withdrawn.', {
          workflowId,
          diagnostics: `workflow ${workflowId} certification is revoked`,
        });
      }
      if (!definition.enabled) {
        throw workflowFailure('workflow_disabled', 'That workflow is currently turned off.', {
          workflowId,
          diagnostics: `workflow ${workflowId} is disabled`,
        });
      }
      if (options.requireCertification() && definition.certification !== 'certified') {
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

    find: (workflowId) => definitions.get(workflowId),

    list: () =>
      [...definitions.values()]
        .map(describeWorkflow)
        .sort((a, b) => a.workflowId.localeCompare(b.workflowId)),

    size: () => definitions.size,

    validate: () =>
      [...definitions.values()].flatMap((definition) =>
        validateWorkflowDefinition(definition, options).map(
          (problem) => `${definition.workflowId}: ${problem}`,
        ),
      ),
  };
}

/**
 * Everything that can be judged from one definition plus the registries it
 * composes.
 *
 * Returns EVERY problem rather than the first, because a definition with four
 * mistakes should be fixed once and not four times.
 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
  options: Pick<WorkflowRegistryOptions, 'agentExists' | 'toolExists' | 'agentMayUseTool'>,
): string[] {
  const problems: string[] = [];

  if (!WORKFLOW_ID.test(definition.workflowId ?? '')) {
    problems.push('workflowId must be dotted lower-case, e.g. workflow.example.intake');
  }
  if (!VERSION.test(definition.version ?? '')) problems.push('version must be semver, e.g. 1.0.0');
  if (!definition.displayName?.trim()) problems.push('displayName is empty');
  if (!definition.purpose?.trim()) problems.push('purpose is empty');
  if (!definition.description?.trim()) problems.push('description is empty');
  if (!definition.owner?.trim()) problems.push('owner is empty');

  const certifications = ['certified', 'testing', 'uncertified', 'revoked'];
  if (!certifications.includes(definition.certification)) {
    problems.push('certification is not a recognised status');
  }

  problems.push(...limitProblems(definition.limits));

  const nodes = definition.nodes ?? [];
  if (nodes.length === 0) {
    problems.push('a workflow must declare at least one node');
    return problems;
  }
  if (definition.limits && nodes.length > definition.limits.maxNodes) {
    problems.push(`declares ${nodes.length} nodes but limits.maxNodes is ${definition.limits.maxNodes}`);
  }

  const byId = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    if (!NODE_ID.test(node.nodeId ?? '')) {
      problems.push(`node id ${String(node.nodeId)} must be lower-case with underscores`);
      continue;
    }
    if (byId.has(node.nodeId)) {
      problems.push(`node ${node.nodeId} is declared twice`);
      continue;
    }
    byId.set(node.nodeId, node);
  }

  const published = new Set<string>();
  let totalFacts = 0;

  for (const node of byId.values()) {
    problems.push(...nodeProblems(node, byId, options));
    for (const fact of node.publishes ?? []) {
      if (!FACT_NAME.test(fact.name ?? '')) {
        problems.push(`node ${node.nodeId} publishes an invalid fact name ${String(fact.name)}`);
        continue;
      }
      published.add(`${node.nodeId}.${fact.name}`);
      totalFacts += 1;
    }
  }
  if (totalFacts > WORKFLOW_BOUNDS.maxFactsTotal) {
    problems.push(`publishes ${totalFacts} facts; the ceiling is ${WORKFLOW_BOUNDS.maxFactsTotal}`);
  }

  // Conditions can only read facts something publishes. A guard on a fact that
  // never exists is not a conservative default — it is a node that silently
  // never runs, which is the single hardest workflow defect to diagnose.
  for (const node of byId.values()) {
    for (const condition of node.when ?? []) {
      if (!published.has(condition.fact ?? '')) {
        problems.push(
          `node ${node.nodeId} tests fact ${String(condition.fact)}, which no node publishes`,
        );
      }
    }
    if (node.kind === 'agent' || node.kind === 'tool') {
      for (const factKey of Object.values(node.inputFromFacts ?? {})) {
        if (!published.has(factKey)) {
          problems.push(
            `node ${node.nodeId} maps fact ${factKey} into its input, but no node publishes it`,
          );
        }
      }
    }
  }

  const entry = byId.get(definition.entryNodeId ?? '');
  if (!entry) {
    problems.push(`entryNodeId ${String(definition.entryNodeId)} is not a declared node`);
  } else if ((entry.dependsOn ?? []).length > 0) {
    problems.push('the entry node must have no dependencies');
  }

  if (![...byId.values()].some((node) => node.kind === 'terminal')) {
    problems.push('a workflow must declare at least one terminal node');
  }

  problems.push(...graphProblems(byId, definition.entryNodeId));

  return problems;
}

function nodeProblems(
  node: WorkflowNode,
  byId: ReadonlyMap<string, WorkflowNode>,
  options: Pick<WorkflowRegistryOptions, 'agentExists' | 'toolExists' | 'agentMayUseTool'>,
): string[] {
  const problems: string[] = [];

  if (!WORKFLOW_NODE_KINDS.includes(node.kind)) {
    problems.push(`node ${node.nodeId} has unknown kind ${String(node.kind)}`);
    return problems;
  }
  if (!node.displayName?.trim()) problems.push(`node ${node.nodeId} has no displayName`);
  if (!node.purpose?.trim()) problems.push(`node ${node.nodeId} has no purpose`);

  const dependsOn = node.dependsOn ?? [];
  if (dependsOn.length > WORKFLOW_BOUNDS.maxDependencies) {
    problems.push(
      `node ${node.nodeId} depends on ${dependsOn.length} nodes; the ceiling is ${WORKFLOW_BOUNDS.maxDependencies}`,
    );
  }
  for (const dependency of dependsOn) {
    if (dependency === node.nodeId) {
      problems.push(`node ${node.nodeId} depends on itself`);
      continue;
    }
    if (!byId.has(dependency)) {
      problems.push(`node ${node.nodeId} depends on undeclared node ${dependency}`);
    }
  }

  const join = node.join ?? { policy: 'all' };
  if (join.policy === 'quorum') {
    const quorum = join.quorum ?? 0;
    if (!Number.isInteger(quorum) || quorum < 1 || quorum > dependsOn.length) {
      problems.push(
        `node ${node.nodeId} declares a quorum of ${String(join.quorum)} over ${dependsOn.length} dependencies`,
      );
    }
  }
  if ((join.policy === 'any' || join.policy === 'quorum') && dependsOn.length === 0) {
    problems.push(`node ${node.nodeId} declares a ${join.policy} join but depends on nothing`);
  }

  if ((node.when ?? []).length > WORKFLOW_BOUNDS.maxConditionsPerNode) {
    problems.push(`node ${node.nodeId} declares more conditions than the ceiling permits`);
  }
  if ((node.publishes ?? []).length > WORKFLOW_BOUNDS.maxFactsPerNode) {
    problems.push(`node ${node.nodeId} publishes more facts than the ceiling permits`);
  }

  switch (node.kind) {
    case 'agent': {
      if (!node.agentId?.trim()) {
        problems.push(`node ${node.nodeId} declares no agentId`);
      } else if (!options.agentExists(node.agentId)) {
        problems.push(`node ${node.nodeId} names agent ${node.agentId}, which is not registered`);
      }
      const objective = node.objective ?? '';
      if (
        objective.length < WORKFLOW_BOUNDS.objective.min ||
        objective.length > WORKFLOW_BOUNDS.objective.max
      ) {
        problems.push(`node ${node.nodeId} has an objective outside the permitted length`);
      }
      problems.push(...inputProblems(node.nodeId, node.inputFromFacts, node.input));
      break;
    }
    case 'tool': {
      if (!node.toolId?.trim()) {
        problems.push(`node ${node.nodeId} declares no toolId`);
      } else if (!options.toolExists(node.toolId)) {
        problems.push(`node ${node.nodeId} names tool ${node.toolId}, which is not registered`);
      }
      if (!node.onBehalfOfAgentId?.trim()) {
        problems.push(`node ${node.nodeId} declares no onBehalfOfAgentId for its tool call`);
      } else if (!options.agentExists(node.onBehalfOfAgentId)) {
        problems.push(
          `node ${node.nodeId} runs on behalf of agent ${node.onBehalfOfAgentId}, which is not registered`,
        );
      } else if (
        node.toolId?.trim() &&
        !options.agentMayUseTool(node.onBehalfOfAgentId, node.toolId)
      ) {
        problems.push(
          `node ${node.nodeId} calls ${node.toolId}, which is not in ${node.onBehalfOfAgentId}'s allow list`,
        );
      }
      problems.push(...inputProblems(node.nodeId, node.inputFromFacts, node.input));
      break;
    }
    case 'approval': {
      if (!(node.approverRoles?.length > 0)) {
        problems.push(`node ${node.nodeId} has no approverRoles — no one could ever decide`);
      }
      if (!node.impactSummary?.trim()) {
        problems.push(`node ${node.nodeId} has no impactSummary for its approver`);
      }
      const bound = WORKFLOW_LIMIT_BOUNDS.approvalExpiresAfterMs;
      if (
        typeof node.expiresAfterMs !== 'number' ||
        node.expiresAfterMs < bound.min ||
        node.expiresAfterMs > bound.max
      ) {
        problems.push(
          `node ${node.nodeId} must expire between ${bound.min} and ${bound.max} milliseconds`,
        );
      }
      if ((node.dataAffected ?? []).length > WORKFLOW_BOUNDS.maxDataAffected) {
        problems.push(`node ${node.nodeId} names more affected data than the ceiling permits`);
      }
      break;
    }
    case 'terminal': {
      if (node.outcome !== 'succeeded' && node.outcome !== 'failed') {
        problems.push(`node ${node.nodeId} declares an unknown terminal outcome`);
      }
      if ((node.publishes ?? []).length > 0) {
        problems.push(`node ${node.nodeId} is terminal and cannot publish facts`);
      }
      break;
    }
  }

  return problems;
}

function inputProblems(
  nodeId: string,
  fromFacts: Readonly<Record<string, string>> | undefined,
  constants: Readonly<Record<string, string | number | boolean>> | undefined,
): string[] {
  const fields = new Set([...Object.keys(fromFacts ?? {}), ...Object.keys(constants ?? {})]);
  if (fields.size > WORKFLOW_BOUNDS.maxInputFields) {
    return [`node ${nodeId} maps more input fields than the ceiling permits`];
  }
  return [];
}

/**
 * Reachability and acyclicity, answered together.
 *
 * A depth-first walk from the entry node marks what is reachable and detects a
 * back edge on the way. Doing both in one pass is not an optimisation — it means
 * a cycle in an unreachable region is reported as unreachable rather than as a
 * cycle, which is the more actionable of the two messages.
 */
function graphProblems(
  byId: ReadonlyMap<string, WorkflowNode>,
  entryNodeId: string,
): string[] {
  const problems: string[] = [];
  if (!byId.has(entryNodeId)) return problems;

  // Dependencies point BACKWARD (a node names what must precede it), so the
  // forward edges are built by inverting them.
  const forward = new Map<string, string[]>();
  for (const node of byId.keys()) forward.set(node, []);
  for (const node of byId.values()) {
    for (const dependency of node.dependsOn ?? []) {
      forward.get(dependency)?.push(node.nodeId);
    }
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>([...byId.keys()].map((id) => [id, WHITE]));

  const walk = (nodeId: string, path: readonly string[]): void => {
    colour.set(nodeId, GREY);
    for (const next of [...(forward.get(nodeId) ?? [])].sort()) {
      const state = colour.get(next);
      if (state === GREY) {
        problems.push(`dependency cycle: ${[...path, nodeId, next].join(' → ')}`);
        continue;
      }
      if (state === WHITE) walk(next, [...path, nodeId]);
    }
    colour.set(nodeId, BLACK);
  };

  walk(entryNodeId, []);

  const unreachable = [...byId.keys()].filter((id) => colour.get(id) === WHITE).sort();
  for (const nodeId of unreachable) {
    problems.push(`node ${nodeId} is not reachable from the entry node`);
  }

  return problems;
}

function limitProblems(limits: WorkflowLimits | undefined): string[] {
  if (!limits) return ['limits are missing'];
  const problems: string[] = [];

  for (const [key, bound] of Object.entries(WORKFLOW_LIMIT_BOUNDS)) {
    if (key === 'approvalExpiresAfterMs') continue;
    const value = (limits as unknown as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      problems.push(`limits.${key} must be an integer`);
      continue;
    }
    if (value < bound.min || value > bound.max) {
      problems.push(`limits.${key} must be between ${bound.min} and ${bound.max}`);
    }
  }

  if (limits.maxActualCostMicroUsd > limits.maxEstimatedCostMicroUsd) {
    problems.push(
      'limits.maxActualCostMicroUsd exceeds limits.maxEstimatedCostMicroUsd — ' +
        'the estimate ceiling must be the outer bound',
    );
  }
  if (limits.maxNodeExecutions < limits.maxNodes) {
    problems.push('limits.maxNodeExecutions is below limits.maxNodes — the plan could not finish');
  }

  return problems;
}
