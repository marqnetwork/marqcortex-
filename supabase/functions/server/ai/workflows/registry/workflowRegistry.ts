/**
 * The Workflow Registry (AI-01 Batch 3B, Part 1).
 *
 * The single answer to "which workflows exist, and what would each one do?".
 * Registration is the only way a workflow becomes runnable, and registration
 * both VALIDATES and PLANS.
 *
 * WHY REGISTRATION PLANS.
 *
 * A definition that validates can still be unplannable: its graph can have two
 * entry points, an orphaned node, or a cycle. Deferring that discovery to the
 * first run means finding it in production, on one tenant's request, at
 * whatever hour that request arrives. Planning at registration moves the same
 * discovery to assembly — loudly, on every instance, before anything serves
 * traffic — and it costs one graph walk over at most sixty-four nodes.
 *
 * It also gives the registry something better than a definition to hand out.
 * The plan is computed once and held, so every later reader — a console, an
 * approval, and in Part 2 an executor — sees the identical plan with the
 * identical digest, rather than each re-deriving one and hoping they agree.
 *
 * FAIL CLOSED, IN BOTH DIRECTIONS.
 *
 *   Registration fails closed. An invalid or unplannable definition is not
 *   "registered with a warning"; it is not registered.
 *
 *   Resolution fails closed. `require()` refuses a disabled workflow, a revoked
 *   one, and — where the deployment demands certification — an uncertified one.
 *   The typed failure distinguishes them, because "temporarily off" and "never
 *   reviewed" are different conversations.
 *
 * NO PRODUCTION WORKFLOWS SHIP IN THIS BATCH. The registry starts empty.
 * Business workflows are out of scope for Part 1, and inventing one to make a
 * console look populated would be exactly the shortcut this structure exists to
 * prevent. Fixtures used by the tests are registered by those tests, against
 * this same code.
 */

import type { WorkflowDefinition, WorkflowDescriptor } from '../contracts/workflow.ts';
import type { WorkflowPlan } from '../contracts/plan.ts';
import { describeWorkflow } from '../contracts/workflow.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { createWorkflowPlanner } from '../planner/workflowPlanner.ts';

export interface WorkflowRegistryOptions {
  /**
   * When true, only `certified` workflows may be resolved for execution.
   * Mirrors the agent registry's switch and is read live, so an operator
   * raising the bar does not need a deploy.
   */
  readonly requireCertification: () => boolean;
  /**
   * Whether an agent id names a registered agent. Optional, and passed straight
   * through to validation — see `validation/workflowValidation.ts` for why this
   * is a port and what its absence means.
   */
  readonly agentExists?: (agentId: string) => boolean;
}

export interface WorkflowRegistry {
  /** Register one definition. Throws on anything invalid, unplannable or duplicated. */
  register(definition: WorkflowDefinition): void;
  /** Register several, all or nothing. */
  registerAll(definitions: readonly WorkflowDefinition[]): void;
  /** Resolve for EXECUTION. Enforces enabled and certification. Throws. */
  require(workflowId: string): WorkflowDefinition;
  /** The plan computed at registration, with the same enforcement as `require`. */
  requirePlan(workflowId: string): WorkflowPlan;
  /** Resolve without enforcement, for reads. Undefined when unknown. */
  find(workflowId: string): WorkflowDefinition | undefined;
  /** The stored plan without enforcement. Undefined when unknown. */
  findPlan(workflowId: string): WorkflowPlan | undefined;
  list(): readonly WorkflowDescriptor[];
  size(): number;
  /** Re-check every registered workflow. Empty means the set is still coherent. */
  validate(): readonly string[];
}

interface Entry {
  readonly definition: WorkflowDefinition;
  readonly plan: WorkflowPlan;
}

export function createWorkflowRegistry(options: WorkflowRegistryOptions): WorkflowRegistry {
  const entries = new Map<string, Entry>();
  const planner = createWorkflowPlanner({ agentExists: options.agentExists });

  function registerOne(definition: WorkflowDefinition): void {
    const result = planner.inspect(definition);
    if (!result.ok) {
      throw workflowFailure('workflow_invalid_definition', 'Workflow definition is invalid.', {
        workflowId: definition?.workflowId,
        diagnostics: `${definition?.workflowId || '(no id)'}: ${result.problems.join('; ')}`,
      });
    }
    if (entries.has(definition.workflowId)) {
      throw workflowFailure('workflow_invalid_definition', 'Workflow is already registered.', {
        workflowId: definition.workflowId,
        diagnostics: `duplicate workflow registration: ${definition.workflowId}`,
      });
    }
    entries.set(definition.workflowId, { definition, plan: result.plan });
  }

  function requireEntry(workflowId: string): Entry {
    const entry = entries.get(workflowId);
    if (!entry) {
      throw workflowFailure('workflow_not_found', 'That workflow is not available.', {
        workflowId,
        diagnostics: `workflowId=${workflowId}`,
      });
    }
    const { certification, enabled } = entry.definition;
    // Revocation is checked before the enable switch on purpose: a revoked
    // workflow that also happens to be enabled must not read as merely enabled,
    // and revocation is a judgement that an operational toggle cannot undo.
    if (certification === 'revoked') {
      throw workflowFailure('workflow_uncertified', 'That workflow has been withdrawn.', {
        workflowId,
        diagnostics: `workflow ${workflowId} certification is revoked`,
      });
    }
    if (!enabled) {
      throw workflowFailure('workflow_disabled', 'That workflow is currently turned off.', {
        workflowId,
        diagnostics: `workflow ${workflowId} is disabled`,
      });
    }
    if (options.requireCertification() && certification !== 'certified') {
      throw workflowFailure(
        'workflow_uncertified',
        'That workflow is not certified for this deployment.',
        {
          workflowId,
          diagnostics: `workflow ${workflowId} certification is ${certification}`,
        },
      );
    }
    return entry;
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
        // All or nothing. A partially registered set leaves the runtime serving
        // some workflows and silently missing others, which is a harder state to
        // diagnose than a deployment that refused to start.
        for (const workflowId of added) entries.delete(workflowId);
        throw error;
      }
    },

    require: (workflowId) => requireEntry(workflowId).definition,

    requirePlan: (workflowId) => requireEntry(workflowId).plan,

    find: (workflowId) => entries.get(workflowId)?.definition,

    findPlan: (workflowId) => entries.get(workflowId)?.plan,

    list() {
      return [...entries.values()]
        .map((entry) => describeWorkflow(entry.definition))
        .sort((a, b) => a.workflowId.localeCompare(b.workflowId));
    },

    size: () => entries.size,

    validate() {
      // Re-planning rather than returning what registration found. The world can
      // move underneath a registered workflow — most obviously when the agent it
      // names is withdrawn — and a health check that replayed the old answer
      // would report a coherence it is no longer entitled to claim.
      return [...entries.keys()].sort().flatMap((workflowId) => {
        const entry = entries.get(workflowId) as Entry;
        const result = planner.inspect(entry.definition);
        if (result.ok) {
          return result.plan.digest === entry.plan.digest
            ? []
            : [`${workflowId}: plan digest no longer matches the plan stored at registration`];
        }
        return result.problems.map((problem) => `${workflowId}: ${problem}`);
      });
    },
  };
}
