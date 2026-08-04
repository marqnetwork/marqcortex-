/**
 * The Agent Registry (AI-01 Batch 3A).
 *
 * The single answer to "which agents exist and what is each one permitted to
 * do?". Registration is the only way an agent becomes runnable, and
 * registration validates — an agent whose limits are unbounded, whose handoff
 * targets do not exist, or whose declared capabilities contradict its allow
 * lists is refused at assembly, loudly, on every instance, rather than at 3am
 * on one run.
 *
 * FAIL CLOSED, IN BOTH DIRECTIONS.
 *
 *   Registration fails closed. An invalid definition is not "registered with a
 *   warning"; it is not registered, and a deployment that depends on it will not
 *   start with a silently degraded agent.
 *
 *   Resolution fails closed. `require()` refuses a disabled agent, a revoked
 *   agent, and — when the deployment demands certification — an uncertified one.
 *   The typed failure distinguishes the three, because "temporarily off" and
 *   "never reviewed" are different conversations.
 *
 * WHY THE HANDOFF GRAPH IS VALIDATED AS A GRAPH.
 *
 * A handoff target that is not registered is an obvious error. Two agents that
 * name each other is not an error at all — a review agent legitimately hands
 * back to a drafting agent — so the graph check does NOT reject cycles. It
 * rejects the things that are always wrong: an unknown target, a self-handoff,
 * and a target that cannot receive. Cyclic *behaviour* at runtime is caught by
 * the loop protection in `runtime/limits.ts`, which is where a bounded count
 * can actually be enforced; refusing cycles here would forbid a legitimate
 * topology to prevent a problem this registry cannot see.
 *
 * NO PRODUCTION AGENTS SHIP IN THIS BATCH. The registry starts empty. Business
 * agents are explicitly out of AI-01 Batch 3A's scope, and inventing one to make
 * the console look populated would be exactly the "inline production agent" the
 * batch forbids. Deterministic agents used by the tests and the runtime
 * verification script are registered by those callers, against this same code.
 */

import type {
  AgentCapability,
  AgentCertificationStatus,
  AgentDefinition,
  AgentDescriptor,
  AgentLimits,
} from '../contracts/agent.ts';
import { AGENT_CAPABILITIES, AGENT_LIMIT_BOUNDS, describeAgent } from '../contracts/agent.ts';
import { agentFailure } from '../contracts/failures.ts';
import { AIError } from '../../contracts/errors.ts';

/** Identifiers must be safe in a storage key, a log line and a metric label. */
const AGENT_ID = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_]*)+$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export interface AgentRegistryOptions {
  /**
   * When true, only `certified` agents may be resolved for execution.
   * Mirrors the control plane's `requireCertifiedProviders` and is read live,
   * so an operator raising the bar does not need a deploy.
   */
  readonly requireCertification: () => boolean;
}

export interface AgentRegistry {
  /** Register one definition. Throws on anything invalid or duplicated. */
  register(definition: AgentDefinition): void;
  /** Register several, validating the handoff graph across all of them. */
  registerAll(definitions: readonly AgentDefinition[]): void;
  /** Resolve for EXECUTION. Enforces enabled and certification. Throws. */
  require(agentId: string): AgentDefinition;
  /** Resolve without enforcement, for reads. Undefined when unknown. */
  find(agentId: string): AgentDefinition | undefined;
  list(): readonly AgentDescriptor[];
  size(): number;
  /** Cross-definition problems. Empty means the graph is coherent. */
  validate(): readonly string[];
}

export function createAgentRegistry(options: AgentRegistryOptions): AgentRegistry {
  const definitions = new Map<string, AgentDefinition>();

  function registerOne(definition: AgentDefinition): void {
    const problems = validateDefinition(definition);
    if (problems.length > 0) {
      throw new AIError('INTERNAL_ERROR', 'Agent definition is invalid.', {
        diagnostics: `${definition.agentId || '(no id)'}: ${problems.join('; ')}`,
      });
    }
    if (definitions.has(definition.agentId)) {
      throw new AIError('INTERNAL_ERROR', 'Agent is already registered.', {
        diagnostics: `duplicate agent registration: ${definition.agentId}`,
      });
    }
    definitions.set(definition.agentId, definition);
  }

  return {
    register(definition) {
      registerOne(definition);
      // A single registration can only be checked against what is already
      // present. `registerAll` is the entry point that validates a whole set.
      const issues = graphIssues(definitions, definition.agentId);
      if (issues.length > 0) {
        definitions.delete(definition.agentId);
        throw new AIError('INTERNAL_ERROR', 'Agent handoff graph is invalid.', {
          diagnostics: issues.join('; '),
        });
      }
    },

    registerAll(incoming) {
      const added: string[] = [];
      try {
        for (const definition of incoming) {
          registerOne(definition);
          added.push(definition.agentId);
        }
        const issues = added.flatMap((agentId) => graphIssues(definitions, agentId));
        if (issues.length > 0) {
          throw new AIError('INTERNAL_ERROR', 'Agent handoff graph is invalid.', {
            diagnostics: issues.join('; '),
          });
        }
      } catch (error) {
        // All or nothing. A partially registered set would leave the runtime
        // with agents whose targets exist and agents whose targets do not,
        // which is the state this validation exists to prevent.
        for (const agentId of added) definitions.delete(agentId);
        throw error;
      }
    },

    require(agentId) {
      const definition = definitions.get(agentId);
      if (!definition) {
        throw agentFailure('agent_not_found', 'That agent is not available.', {
          agentId,
          diagnostics: `agentId=${agentId}`,
        });
      }
      if (definition.certification === 'revoked') {
        throw agentFailure('agent_uncertified', 'That agent has been withdrawn.', {
          agentId,
          diagnostics: `agent ${agentId} certification is revoked`,
        });
      }
      if (!definition.enabled) {
        throw agentFailure('agent_disabled', 'That agent is currently turned off.', {
          agentId,
          diagnostics: `agent ${agentId} is disabled`,
        });
      }
      if (options.requireCertification() && definition.certification !== 'certified') {
        throw agentFailure('agent_uncertified', 'That agent is not certified for this deployment.', {
          agentId,
          diagnostics: `agent ${agentId} certification is ${definition.certification}`,
        });
      }
      return definition;
    },

    find: (agentId) => definitions.get(agentId),

    list() {
      return [...definitions.values()]
        .map(describeAgent)
        .sort((a, b) => a.agentId.localeCompare(b.agentId));
    },

    size: () => definitions.size,

    validate() {
      return [...definitions.keys()].flatMap((agentId) => graphIssues(definitions, agentId));
    },
  };
}

/**
 * Problems that involve more than one definition.
 *
 * Separated from `validateDefinition` because they can only be answered once
 * the other agents are present — and because a definition that is individually
 * valid and collectively broken produces a different, more useful message.
 */
function graphIssues(
  definitions: ReadonlyMap<string, AgentDefinition>,
  agentId: string,
): string[] {
  const definition = definitions.get(agentId);
  if (!definition) return [];
  const issues: string[] = [];

  for (const target of definition.allowedHandoffTargets) {
    if (target === agentId) {
      issues.push(`${agentId} lists itself as a handoff target`);
      continue;
    }
    const targetDefinition = definitions.get(target);
    if (!targetDefinition) {
      issues.push(`${agentId} hands off to unregistered agent ${target}`);
      continue;
    }
    if (!targetDefinition.capabilities.includes('agent.handoff.receive')) {
      issues.push(`${agentId} hands off to ${target}, which cannot receive handoffs`);
    }
    if (targetDefinition.handoffContract === undefined) {
      issues.push(`${agentId} hands off to ${target}, which declares no handoff contract`);
    }
  }

  return issues;
}

/**
 * Everything that can be judged from one definition alone.
 *
 * Returns every problem rather than the first, because a definition with four
 * mistakes should be fixed once and not four times.
 */
export function validateDefinition(definition: AgentDefinition): string[] {
  const problems: string[] = [];

  if (!AGENT_ID.test(definition.agentId ?? '')) {
    problems.push('agentId must be dotted lower-case, e.g. agent.example.reviewer');
  }
  if (!VERSION.test(definition.version ?? '')) problems.push('version must be semver, e.g. 1.0.0');
  if (!definition.displayName?.trim()) problems.push('displayName is empty');
  if (!definition.purpose?.trim()) problems.push('purpose is empty');
  if (!definition.description?.trim()) problems.push('description is empty');
  if (!definition.owner?.trim()) problems.push('owner is empty');
  if (typeof definition.propose !== 'function') problems.push('propose must be a function');
  if (typeof definition.inputContract?.validate !== 'function') {
    problems.push('inputContract must be a validator');
  }
  if (typeof definition.outputContract?.validate !== 'function') {
    problems.push('outputContract must be a validator');
  }

  const capabilities = definition.capabilities ?? [];
  const unknown = capabilities.filter(
    (capability) => !AGENT_CAPABILITIES.includes(capability as AgentCapability),
  );
  if (unknown.length > 0) problems.push(`unknown capabilities: ${unknown.join(', ')}`);
  if (new Set(capabilities).size !== capabilities.length) {
    problems.push('capabilities contains duplicates');
  }

  // Allow lists and capabilities have to agree in BOTH directions. A tool list
  // without the capability is a permission that can never be used; a capability
  // without a list is a capability that can never be exercised — and the second
  // one reads, in a review, as though the agent can call tools.
  if (definition.allowedTools?.length > 0 && !capabilities.includes('agent.tool.invoke')) {
    problems.push('allowedTools is non-empty but agent.tool.invoke is not declared');
  }
  if (capabilities.includes('agent.tool.invoke') && !(definition.allowedTools?.length > 0)) {
    problems.push('agent.tool.invoke is declared but allowedTools is empty');
  }
  if (
    definition.allowedHandoffTargets?.length > 0 &&
    !capabilities.includes('agent.handoff.initiate')
  ) {
    problems.push('allowedHandoffTargets is non-empty but agent.handoff.initiate is not declared');
  }
  if (
    capabilities.includes('agent.handoff.initiate') &&
    !(definition.allowedHandoffTargets?.length > 0)
  ) {
    problems.push('agent.handoff.initiate is declared but allowedHandoffTargets is empty');
  }
  if (
    definition.allowedModelProfiles?.length > 0 &&
    !capabilities.includes('agent.model.invoke')
  ) {
    problems.push('allowedModelProfiles is non-empty but agent.model.invoke is not declared');
  }
  if (capabilities.includes('agent.model.invoke') && !(definition.allowedModelProfiles?.length > 0)) {
    problems.push('agent.model.invoke is declared but allowedModelProfiles is empty');
  }
  if (capabilities.includes('agent.handoff.receive') && definition.handoffContract === undefined) {
    problems.push('agent.handoff.receive is declared but no handoffContract is provided');
  }

  const certifications: readonly AgentCertificationStatus[] = [
    'certified',
    'testing',
    'uncertified',
    'revoked',
  ];
  if (!certifications.includes(definition.certification)) {
    problems.push('certification is not a recognised status');
  }

  problems.push(...limitProblems(definition.limits));

  const approvals = definition.approvals;
  if (!approvals) {
    problems.push('approvals policy is missing');
  } else {
    if (!(approvals.approverRoles?.length > 0)) {
      problems.push('approvals.approverRoles is empty — no one could ever decide');
    }
    const bound = AGENT_LIMIT_BOUNDS.approvalExpiresAfterMs;
    if (
      typeof approvals.expiresAfterMs !== 'number' ||
      approvals.expiresAfterMs < bound.min ||
      approvals.expiresAfterMs > bound.max
    ) {
      problems.push(
        `approvals.expiresAfterMs must be between ${bound.min} and ${bound.max}`,
      );
    }
    // An external effect is the one class of action a platform cannot take back.
    // Refusing to register such an agent without a handoff or tool approval gate
    // is cheaper than discovering the gap from its consequences.
    if (
      definition.safetyClass === 'external_effect' &&
      approvals.requireForToolRisk.length === 0
    ) {
      problems.push('external_effect agents must require approval for at least one tool risk class');
    }
  }

  if (!definition.completion) problems.push('completion criteria are missing');

  return problems;
}

function limitProblems(limits: AgentLimits | undefined): string[] {
  if (!limits) return ['limits are missing'];
  const problems: string[] = [];

  for (const [key, bound] of Object.entries(AGENT_LIMIT_BOUNDS)) {
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

  // Cross-field coherence. Each of these describes a limit set that is
  // internally contradictory — the run would hit one ceiling in a way that
  // makes another unreachable, which reads as a control that is not one.
  if (limits.maxStepsPerAgent > limits.maxTotalSteps) {
    problems.push('limits.maxStepsPerAgent exceeds limits.maxTotalSteps');
  }
  if (limits.maxTotalTokens < limits.maxPromptTokens) {
    problems.push('limits.maxTotalTokens is below limits.maxPromptTokens');
  }
  if (limits.maxTotalTokens < limits.maxCompletionTokens) {
    problems.push('limits.maxTotalTokens is below limits.maxCompletionTokens');
  }
  if (limits.maxActualCostMicroUsd > limits.maxEstimatedCostMicroUsd) {
    problems.push(
      'limits.maxActualCostMicroUsd exceeds limits.maxEstimatedCostMicroUsd — ' +
        'the estimate ceiling must be the outer bound',
    );
  }

  return problems;
}
