/**
 * Agent runtime RBAC (AI-01 Batch 3A).
 *
 * A SEPARATE QUESTION FROM AGENT PERMISSIONS, AND FROM AI ADMINISTRATION.
 *
 *   The agent registry says what an AGENT may do — which tools, which handoff
 *   targets, which model profiles.
 *
 *   This module says what a PERSON may do — start a run, read one, pause one,
 *   decide an approval. An agent's permission is never a person's permission,
 *   and a run started by someone who may not call tools does not acquire the
 *   right by delegating to an agent that may.
 *
 *   `admin/rbac.ts` says what a PLATFORM OPERATOR may change. That surface is
 *   platform-wide and its writes stop at `super_admin`; this one is tenant
 *   operations, which ordinary team roles legitimately perform inside their own
 *   organization.
 *
 * ROLES COME FROM THE IDENTITY PROVIDER, capabilities come from the table
 * below, and every enforcement point takes a capability rather than comparing a
 * role. That is the same shape the administration layer uses, for the same
 * reason: a role comparison at a call site is a check that can be forgotten at
 * the seventh call site.
 *
 * TENANT SCOPE IS PART OF THE ACTOR. A resolved actor carries the organization
 * the request belongs to, and every read and write in the service is keyed by
 * it. Only the platform operator gets `agent.run.read.platform`, and even that
 * is a READ — there is no cross-tenant control operation at any role.
 */

import type { AuthenticatedSubject } from '../../security/actor.ts';
import type { AIOrganization } from '../../contracts/request.ts';
import type { OrganizationResolutionOptions } from '../../security/tenancy.ts';
import { resolveOrganization } from '../../security/tenancy.ts';
import { AIError } from '../../contracts/errors.ts';
import { agentFailure } from '../contracts/failures.ts';

export type AgentRuntimeCapability =
  /** Create a run and execute its steps. */
  | 'agent.run.create'
  /** Read runs, steps, usage and approvals for the actor's organization. */
  | 'agent.run.read'
  /** Pause, resume, cancel or retry a run. */
  | 'agent.run.control'
  /** Decide a pending approval. Subject to the agent's approver roles too. */
  | 'agent.approval.decide'
  /** Read the agent registry and the tool registry. */
  | 'agent.registry.read'
  /** Read runs across every organization. The platform operator only. */
  | 'agent.run.read.platform';

const READER: readonly AgentRuntimeCapability[] = ['agent.run.read', 'agent.registry.read'];

const OPERATOR: readonly AgentRuntimeCapability[] = [
  ...READER,
  'agent.run.create',
  'agent.run.control',
];

/**
 * Role → capability grants.
 *
 * `reviewer` reads and decides but cannot start a run: the role whose job is to
 * approve other people's work should not be able to create work that then asks
 * itself for approval. That is the same judgement `security/actor.ts` makes
 * when it withholds `ai.agent.execute` from the same role, and the two tables
 * agree deliberately — a reviewer who could start a run would be refused at the
 * first model step anyway, which is a worse way to learn the same thing.
 */
export const AGENT_ROLE_CAPABILITIES: Readonly<
  Record<string, readonly AgentRuntimeCapability[]>
> = {
  super_admin: [...OPERATOR, 'agent.approval.decide', 'agent.run.read.platform'],
  platform_admin: [...OPERATOR, 'agent.approval.decide', 'agent.run.read.platform'],
  owner: [...OPERATOR, 'agent.approval.decide'],
  admin: [...OPERATOR, 'agent.approval.decide'],
  consultant: [...OPERATOR],
  analyst: [...OPERATOR],
  reviewer: [...READER, 'agent.approval.decide'],
  /** Machine actors invoked by platform jobs. No approval authority. */
  service: [...READER, 'agent.run.create', 'agent.run.control'],
};

export interface AgentRuntimeActor {
  readonly actorId: string;
  readonly email?: string;
  /** Lower-cased, de-duplicated roles as the identity provider reported them. */
  readonly roles: readonly string[];
  readonly capabilities: readonly AgentRuntimeCapability[];
  /** The organization this request is scoped to. Resolved, never asserted. */
  readonly organization: AIOrganization;
  /** True when this actor may read runs outside their own organization. */
  readonly platformReader: boolean;
}

function lower(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter((value) => value !== '');
}

/**
 * Resolve the runtime actor for a request.
 *
 * Throws rather than returning an empty actor: a caller with no qualifying role
 * asking for the agent runtime is a decision the platform should state and
 * record, not a silently empty result they will interpret as "nothing here".
 */
export function resolveAgentActor(
  subject: AuthenticatedSubject | null,
  organizationHint: string | undefined,
  options: OrganizationResolutionOptions,
): AgentRuntimeActor {
  if (!subject) {
    throw new AIError('AUTH_REQUIRED', 'Authentication is required for agent runs.');
  }

  const organization = resolveOrganization(subject, organizationHint, options);
  const membership = subject.memberships.find(
    (entry) => entry.organizationId === organization.organizationId,
  );
  const roles = [...new Set(lower([...subject.globalRoles, ...(membership?.roles ?? [])]))].sort();

  const granted = new Set<AgentRuntimeCapability>();
  for (const role of roles) {
    for (const capability of AGENT_ROLE_CAPABILITIES[role] ?? []) granted.add(capability);
  }

  if (granted.size === 0) {
    throw new AIError('FORBIDDEN', 'Your account is not permitted to use agent runs.', {
      diagnostics: `subject=${subject.subjectId} roles=${roles.join(',') || 'none'}`,
      securityContext: {
        subjectId: subject.subjectId,
        actorType: subject.actorType,
        roles,
        organizationId: organization.organizationId,
      },
    });
  }

  return {
    actorId: subject.subjectId,
    email: subject.email,
    roles,
    capabilities: [...granted].sort(),
    organization,
    platformReader: granted.has('agent.run.read.platform'),
  };
}

export function hasAgentCapability(
  actor: AgentRuntimeActor,
  capability: AgentRuntimeCapability,
): boolean {
  return actor.capabilities.includes(capability);
}

/** Enforce a capability. Names nothing the caller can act on. */
export function requireAgentCapability(
  actor: AgentRuntimeActor,
  capability: AgentRuntimeCapability,
): void {
  if (hasAgentCapability(actor, capability)) return;
  throw agentFailure('unauthorized', 'Your role does not permit this action.', {
    diagnostics: `actor=${actor.actorId} roles=${actor.roles.join(',')} required=${capability}`,
  });
}

/**
 * The organization a read should be keyed by.
 *
 * A platform reader may name another organization explicitly; everyone else
 * gets their own, whatever they asked for. The asymmetry is deliberate: a
 * tenant operator who supplies somebody else's organization id is not given an
 * error they could use to enumerate tenants — they are given their own data.
 */
export function readScopeFor(actor: AgentRuntimeActor, requested?: string): string {
  if (actor.platformReader && requested && requested.trim() !== '') return requested.trim();
  return actor.organization.organizationId;
}
