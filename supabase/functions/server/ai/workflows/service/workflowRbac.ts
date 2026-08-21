/**
 * Workflow runtime RBAC (AI-01 Batch 3B, Part 2).
 *
 * A FOURTH SEPARATE QUESTION, AND THE SEPARATION IS THE POINT.
 *
 *   The workflow registry says what a WORKFLOW is — which nodes, which agents,
 *   in which order.
 *
 *   The agent registry says what an AGENT may do — which tools, which model
 *   profiles, which handoff targets.
 *
 *   `agents/service/agentRbac.ts` says what a PERSON may do with agent runs.
 *
 *   This module says what a PERSON may do with WORKFLOW runs — start one, read
 *   one, pause or cancel one.
 *
 * A WORKFLOW PERMISSION IS NOT AN AGENT PERMISSION, AND CANNOT BECOME ONE.
 *
 * This is the load-bearing rule of the file. Every node of a workflow runs as a
 * child agent run, created through the Agent Orchestrator on behalf of the SAME
 * authenticated subject — so the agent runtime applies its own RBAC to that
 * person, independently, at every node. Somebody who may start a workflow but
 * holds no `agent.run.create` is refused at the first node, by the agent
 * runtime, not by a check this module remembered to make.
 *
 * That is why `resolveWorkflowActor` resolves BOTH vocabularies from one
 * subject and carries both. A workflow that could execute agents its operator
 * may not execute would be a privilege escalation with a plan attached, and the
 * shape of the actor is what makes it impossible rather than merely forbidden.
 */

import type { AuthenticatedSubject } from '../../security/actor.ts';
import { flooredRolesFor, hasPlatformAuthority } from '../../security/actor.ts';
import type { AIOrganization } from '../../contracts/request.ts';
import type { OrganizationResolutionOptions } from '../../security/tenancy.ts';
import type { WorkflowAgentActor } from '../engine/agentNodePort.ts';
import { resolveOrganization } from '../../security/tenancy.ts';
import { AIError } from '../../contracts/errors.ts';
import { workflowFailure } from '../contracts/failures.ts';

export type WorkflowRuntimeCapability =
  /** Create a workflow run and drive its nodes. */
  | 'workflow.run.create'
  /** Read runs and step history for the actor's organization. */
  | 'workflow.run.read'
  /** Pause, resume or cancel a run. */
  | 'workflow.run.control'
  /** Read the workflow registry and its plans. */
  | 'workflow.registry.read'
  /** Read the approval queue for the actor's organization (Part 5). */
  | 'workflow.approval.read'
  /** Answer an approval request (Part 5). */
  | 'workflow.approval.decide'
  /** Read runs across every organization. The platform operator only. */
  | 'workflow.run.read.platform';

const READER: readonly WorkflowRuntimeCapability[] = [
  'workflow.run.read',
  'workflow.registry.read',
  'workflow.approval.read',
];

const OPERATOR: readonly WorkflowRuntimeCapability[] = [
  ...READER,
  'workflow.run.create',
  'workflow.run.control',
];

/**
 * The capability to ANSWER an approval, held separately from the capability to
 * start a run (AI-01 Batch 3B, Part 5).
 *
 * `consultant` and `analyst` are operators and do not have it. That is a
 * deliberate separation of duties: somebody who starts a workflow should not be
 * the person who waves its approval gate through, and a grant table that gave
 * every operator both would make every approval node in the platform a formality
 * the requester could complete alone.
 *
 * It is not the only check. The gate ALSO requires one of the roles the approval
 * NODE declared, resolved server-side — so holding this capability lets a person
 * reach the queue, and the workflow's own definition decides which requests in
 * it they may answer.
 */
const APPROVER: readonly WorkflowRuntimeCapability[] = ['workflow.approval.decide'];

/**
 * Capabilities that reach BEYOND the actor's own organization.
 *
 * The mirror of `PLATFORM_CAPABILITIES` in `agents/service/agentRbac.ts`, for
 * the same reason and against the same finding (HIGH-2): the grant table is
 * keyed by role NAME, `platform_admin` is a seeded row in `public.roles`, and a
 * membership row pointed at it resolved cross-tenant workflow read authority for
 * a subject holding no trusted global role at all.
 *
 * ORGANIZATION MEMBERSHIP CAN NEVER CREATE PLATFORM AUTHORITY.
 */
const PLATFORM_CAPABILITIES: ReadonlySet<WorkflowRuntimeCapability> =
  new Set<WorkflowRuntimeCapability>(['workflow.run.read.platform']);

/**
 * Capabilities that an UNVERIFIED organization resolution may never carry.
 *
 * The mirror of `MEMBERSHIP_SCOPED_PRIVILEGED` in
 * `agents/service/agentRbac.ts`, for the same reason and against the same
 * finding (MED-A): with `AI_ALLOW_DEFAULT_ORGANIZATION` on, a team user holding
 * no membership row is admitted into the fallback organization with
 * `membershipVerified: false`, and this runtime granted them run creation, run
 * control and approval authority over a tenant nobody had confirmed they belong
 * to.
 *
 * The read capabilities are deliberately absent — an unaffiliated account may
 * still see the organization it was placed in and change nothing about it —
 * and `workflow.run.read.platform` stays gated by `hasPlatformAuthority`
 * alone, because genuinely global authority is not something the fallback
 * conferred.
 */
const MEMBERSHIP_SCOPED_PRIVILEGED: ReadonlySet<WorkflowRuntimeCapability> =
  new Set<WorkflowRuntimeCapability>([
    'workflow.run.create',
    'workflow.run.control',
    'workflow.approval.decide',
  ]);

/**
 * Role → capability grants.
 *
 * Deliberately the same shape as `AGENT_ROLE_CAPABILITIES`, including the
 * judgement that `reviewer` reads and approves but does not start. A reviewer
 * who could start a workflow would be starting agent runs it may then be asked
 * to approve — and would in any case be refused by the agent runtime at the
 * first node, which is a worse way to learn the same thing.
 */
export const WORKFLOW_ROLE_CAPABILITIES: Readonly<
  Record<string, readonly WorkflowRuntimeCapability[]>
> = {
  super_admin: [...OPERATOR, ...APPROVER, 'workflow.run.read.platform'],
  platform_admin: [...OPERATOR, ...APPROVER, 'workflow.run.read.platform'],
  owner: [...OPERATOR, ...APPROVER],
  admin: [...OPERATOR, ...APPROVER],
  consultant: [...OPERATOR],
  analyst: [...OPERATOR],
  reviewer: [...READER, ...APPROVER],
  /**
   * Machine actors invoked by platform jobs.
   *
   * NOT an approver, and this is the sharpest case for the separation: an
   * approval exists to put a human in the path, and a service account that could
   * answer one would be an automatic approval wearing a role name.
   */
  service: [...READER, 'workflow.run.create', 'workflow.run.control'],
};

export interface WorkflowRuntimeActor {
  readonly actorId: string;
  readonly email?: string;
  /** Lower-cased, de-duplicated roles as the identity provider reported them. */
  readonly roles: readonly string[];
  readonly capabilities: readonly WorkflowRuntimeCapability[];
  /** The organization this request is scoped to. Resolved, never asserted. */
  readonly organization: AIOrganization;
  /** True when this actor may read runs outside their own organization. */
  readonly platformReader: boolean;
  /** The SAME person, in the agent runtime's vocabulary. See the header. */
  readonly agent: WorkflowAgentActor;
}

function lower(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter((value) => value !== '');
}

/**
 * Resolve the workflow actor for a request.
 *
 * Throws rather than returning an empty actor: a caller with no qualifying role
 * asking for the workflow runtime is a decision the platform should state and
 * record, not a silently empty result they will read as "nothing here".
 *
 * `agentCapabilities` is supplied by the caller rather than computed here, so
 * this module never becomes a second, drifting copy of the agent runtime's
 * grant table. The assembly resolves it through `agentRbac.resolveAgentActor`
 * — the same function the agent runtime's own service uses.
 */
export function resolveWorkflowActor(
  subject: AuthenticatedSubject | null,
  organizationHint: string | undefined,
  options: OrganizationResolutionOptions,
  agentCapabilities: readonly string[],
): WorkflowRuntimeActor {
  if (!subject) {
    throw new AIError('AUTH_REQUIRED', 'Authentication is required for workflow runs.');
  }

  const organization = resolveOrganization(subject, organizationHint, options);
  const membership = subject.memberships.find(
    (entry) => entry.organizationId === organization.organizationId,
  );
  // FLOORED, not unioned (H-A). The trusted `app_metadata` team role and the
  // membership row can disagree while a role change is half-applied, and the
  // union grants whichever half is still stale — here that is the difference
  // between holding `workflow.approval.decide` and not. `flooredRolesFor` grants
  // no more than the lower of the two, and is a no-op whenever they agree.
  const roles = [...new Set(lower([...flooredRolesFor(subject, membership)]))].sort();

  const granted = new Set<WorkflowRuntimeCapability>();
  for (const role of roles) {
    for (const capability of WORKFLOW_ROLE_CAPABILITIES[role] ?? []) granted.add(capability);
  }

  // HIGH-2. Cross-tenant authority survives only for a subject whose TRUSTED
  // global roles carry it. A membership row cannot put it back.
  if (!hasPlatformAuthority(subject)) {
    for (const capability of PLATFORM_CAPABILITIES) granted.delete(capability);
  }

  // MED-A. A PRIVILEGED CAPABILITY REQUIRES A VERIFIED MEMBERSHIP, ALWAYS.
  // Read off the ONE tenant resolver's own answer, exactly as the agent runtime
  // and `resolveActor` do.
  if (!organization.membershipVerified) {
    for (const capability of MEMBERSHIP_SCOPED_PRIVILEGED) granted.delete(capability);
  }

  if (granted.size === 0) {
    throw new AIError('FORBIDDEN', 'Your account is not permitted to use workflow runs.', {
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
    ...(subject.email === undefined ? {} : { email: subject.email }),
    roles,
    capabilities: [...granted].sort(),
    organization,
    platformReader: granted.has('workflow.run.read.platform'),
    agent: { actorId: subject.subjectId, roles, capabilities: agentCapabilities },
  };
}

export function hasWorkflowCapability(
  actor: WorkflowRuntimeActor,
  capability: WorkflowRuntimeCapability,
): boolean {
  return actor.capabilities.includes(capability);
}

/** Enforce a capability. Names nothing the caller can act on. */
export function requireWorkflowCapability(
  actor: WorkflowRuntimeActor,
  capability: WorkflowRuntimeCapability,
): void {
  if (hasWorkflowCapability(actor, capability)) return;
  throw workflowFailure('workflow_unauthorized', 'Your role does not permit this action.', {
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
export function workflowReadScopeFor(
  actor: WorkflowRuntimeActor,
  requested?: string,
): string {
  if (actor.platformReader && requested && requested.trim() !== '') return requested.trim();
  return actor.organization.organizationId;
}
