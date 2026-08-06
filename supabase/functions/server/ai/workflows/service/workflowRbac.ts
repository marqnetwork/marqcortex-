/**
 * Workflow runtime RBAC (AI-01 Batch 3B).
 *
 * DERIVED, NOT DECLARED. There is no second role table here. A workflow is a
 * plan made of agent runs and tool calls, so the question "may this person start
 * a workflow?" reduces to "may this person start the agent runs it is made of?"
 * — and Batch 3A already answers that, from the identity provider's roles,
 * through one table, enforced by capability rather than by role comparison.
 *
 * A second table mapping roles to workflow capabilities would be a second thing
 * to keep in step with the first, and the failure mode is specific and bad: a
 * role granted workflow creation but not agent creation would produce a run that
 * is authorised at the plan layer and refused at the first node, after the
 * platform had already created a durable run record.
 *
 * SO THE MAPPING IS ONE-TO-ONE AND STATED ONCE, BELOW. Reading it is the whole
 * of the authorization model for this surface:
 *
 *   workflow.run.create   ← agent.run.create
 *   workflow.run.read     ← agent.run.read
 *   workflow.run.control  ← agent.run.control
 *   workflow.approval.decide ← agent.approval.decide
 *   workflow.registry.read   ← agent.registry.read
 *   workflow.run.read.platform ← agent.run.read.platform
 *
 * TENANT SCOPE IS THE ACTOR'S, exactly as it is for agent runs, and the platform
 * reader's cross-tenant privilege remains a READ. There is no cross-tenant
 * control operation at any role, and adding one would require adding a
 * capability that does not exist.
 */

import type {
  AgentRuntimeActor,
  AgentRuntimeCapability,
} from '../../agents/service/agentRbac.ts';
import { hasAgentCapability, readScopeFor } from '../../agents/service/agentRbac.ts';
import { workflowFailure } from '../contracts/failures.ts';

export type WorkflowCapability =
  | 'workflow.run.create'
  | 'workflow.run.read'
  | 'workflow.run.control'
  | 'workflow.approval.decide'
  | 'workflow.registry.read'
  | 'workflow.run.read.platform';

/** The one place the derivation lives. */
const REQUIRES: Readonly<Record<WorkflowCapability, AgentRuntimeCapability>> = {
  'workflow.run.create': 'agent.run.create',
  'workflow.run.read': 'agent.run.read',
  'workflow.run.control': 'agent.run.control',
  'workflow.approval.decide': 'agent.approval.decide',
  'workflow.registry.read': 'agent.registry.read',
  'workflow.run.read.platform': 'agent.run.read.platform',
};

export function hasWorkflowCapability(
  actor: AgentRuntimeActor,
  capability: WorkflowCapability,
): boolean {
  return hasAgentCapability(actor, REQUIRES[capability]);
}

/** Enforce a capability. Names nothing the caller can act on. */
export function requireWorkflowCapability(
  actor: AgentRuntimeActor,
  capability: WorkflowCapability,
): void {
  if (hasWorkflowCapability(actor, capability)) return;
  throw workflowFailure('workflow_unauthorized', 'Your role does not permit this action.', {
    diagnostics:
      `actor=${actor.actorId} roles=${actor.roles.join(',')} required=${capability} ` +
      `(derived from ${REQUIRES[capability]})`,
  });
}

/** Every capability this actor holds on the workflow surface. */
export function workflowCapabilitiesOf(
  actor: AgentRuntimeActor,
): readonly WorkflowCapability[] {
  return (Object.keys(REQUIRES) as WorkflowCapability[])
    .filter((capability) => hasWorkflowCapability(actor, capability))
    .sort();
}

/**
 * The organization a read should be keyed by.
 *
 * Delegates to the agent runtime's own scope resolution rather than repeating
 * it: a platform reader may name another organization, everybody else gets their
 * own whatever they asked for, and the asymmetry is deliberate — a tenant
 * operator supplying somebody else's id is given their own data rather than an
 * error they could use to enumerate tenants.
 */
export function workflowReadScopeFor(actor: AgentRuntimeActor, requested?: string): string {
  return readScopeFor(actor, requested);
}
