/**
 * Workflow RBAC (AI-01 Batch 3B).
 *
 * A FOURTH, SEPARATE QUESTION — and the separation is the point.
 *
 *   The workflow registry says what a WORKFLOW may do: which agents, which
 *   tools, which model profiles, what it may spend.
 *
 *   `agents/service/agentRbac.ts` says what a person may do to an AGENT RUN.
 *
 *   `admin/rbac.ts` says what a platform operator may CHANGE.
 *
 *   This module says what a PERSON may do to a WORKFLOW: start one, read one,
 *   control one, decide its approvals, read its money. A workflow's permission is
 *   never a person's permission, and a run started by somebody who may not read
 *   finance does not acquire the right by starting a workflow that reports it.
 *
 * FINANCE IS ITS OWN CAPABILITY, AND ITS OWN TENANT SCOPE. Cost data is
 * commercially sensitive in a way run state is not: an analyst who legitimately
 * watches workflow progress has no automatic business reading what every tenant
 * spends. So `workflow.finance.read` is granted separately from
 * `workflow.run.read`, and `workflow.finance.read.platform` separately again —
 * and the finance reads follow exactly the same tenant scope as the run reads, so
 * there is no path where a narrower read authorises a wider one.
 *
 * ROLES COME FROM THE IDENTITY PROVIDER, capabilities come from the table below,
 * and every enforcement point takes a capability rather than comparing a role. A
 * role comparison at a call site is a check that can be forgotten at the seventh
 * call site.
 *
 * NO CUSTOMER WORKFLOW MUTATION. There is no `workflow.registry.write`, because
 * there is no API that creates or edits a definition. Definitions are code,
 * reviewed as code.
 */

import type { AuthenticatedSubject } from '../../security/actor.ts';
import type { AIOrganization } from '../../contracts/request.ts';
import type { OrganizationResolutionOptions } from '../../security/tenancy.ts';
import { resolveOrganization } from '../../security/tenancy.ts';
import { AIError } from '../../contracts/errors.ts';
import { workflowFailure } from '../contracts/failures.ts';

export type WorkflowCapability =
  /** Read registered workflow definitions and their metadata. */
  | 'workflow.registry.read'
  /** Create a workflow run and execute its nodes. */
  | 'workflow.run.create'
  /** Read runs, nodes, branches and approvals for the actor's organization. */
  | 'workflow.run.read'
  /** Read runs across every organization. The platform operator only. */
  | 'workflow.run.read.platform'
  /** Pause, resume, cancel or retry a run. */
  | 'workflow.run.control'
  /** Decide a pending workflow approval. Subject to the node's roles too. */
  | 'workflow.approval.decide'
  /** Read cost, token and optimization reporting for the actor's organization. */
  | 'workflow.finance.read'
  /** Read finance across every organization. The platform operator only. */
  | 'workflow.finance.read.platform';

const READER: readonly WorkflowCapability[] = ['workflow.run.read', 'workflow.registry.read'];

const OPERATOR: readonly WorkflowCapability[] = [
  ...READER,
  'workflow.run.create',
  'workflow.run.control',
];

/**
 * Role → capability grants.
 *
 * `reviewer` reads and decides but cannot start a run: the role whose job is to
 * approve other people's work should not be able to create work that then asks
 * itself for approval. That is the same judgement `agentRbac.ts` makes, and the
 * two tables agree deliberately — a reviewer who could start a workflow would be
 * refused at its first agent node anyway, which is a worse way to learn the same
 * thing.
 *
 * `analyst` gets finance but not approval authority: reading what things cost and
 * authorising what they cost are different jobs.
 */
export const WORKFLOW_ROLE_CAPABILITIES: Readonly<
  Record<string, readonly WorkflowCapability[]>
> = {
  super_admin: [
    ...OPERATOR,
    'workflow.approval.decide',
    'workflow.run.read.platform',
    'workflow.finance.read',
    'workflow.finance.read.platform',
  ],
  platform_admin: [
    ...OPERATOR,
    'workflow.approval.decide',
    'workflow.run.read.platform',
    'workflow.finance.read',
    'workflow.finance.read.platform',
  ],
  owner: [...OPERATOR, 'workflow.approval.decide', 'workflow.finance.read'],
  admin: [...OPERATOR, 'workflow.approval.decide', 'workflow.finance.read'],
  consultant: [...OPERATOR],
  analyst: [...OPERATOR, 'workflow.finance.read'],
  reviewer: [...READER, 'workflow.approval.decide'],
  /** Machine actors invoked by platform jobs. No approval, no finance. */
  service: [...READER, 'workflow.run.create', 'workflow.run.control'],
};

export interface WorkflowActor {
  readonly actorId: string;
  readonly email?: string;
  /** Lower-cased, de-duplicated roles as the identity provider reported them. */
  readonly roles: readonly string[];
  readonly capabilities: readonly WorkflowCapability[];
  /** The organization this request is scoped to. Resolved, never asserted. */
  readonly organization: AIOrganization;
  /** True when this actor may read runs outside their own organization. */
  readonly platformReader: boolean;
  /** True when this actor may read finance outside their own organization. */
  readonly platformFinanceReader: boolean;
}

function lower(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter((value) => value !== '');
}

/**
 * Resolve the workflow actor for a request.
 *
 * Throws rather than returning an empty actor: a caller with no qualifying role
 * asking for the workflow surface is a decision the platform should state and
 * record, not a silently empty result they will read as "nothing here".
 */
export function resolveWorkflowActor(
  subject: AuthenticatedSubject | null,
  organizationHint: string | undefined,
  options: OrganizationResolutionOptions,
): WorkflowActor {
  if (!subject) {
    throw new AIError('AUTH_REQUIRED', 'Authentication is required for workflow runs.');
  }

  const organization = resolveOrganization(subject, organizationHint, options);
  const membership = subject.memberships.find(
    (entry) => entry.organizationId === organization.organizationId,
  );
  const roles = [...new Set(lower([...subject.globalRoles, ...(membership?.roles ?? [])]))].sort();

  const granted = new Set<WorkflowCapability>();
  for (const role of roles) {
    for (const capability of WORKFLOW_ROLE_CAPABILITIES[role] ?? []) granted.add(capability);
  }

  if (granted.size === 0) {
    throw new AIError('FORBIDDEN', 'Your account is not permitted to use workflows.', {
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
    platformReader: granted.has('workflow.run.read.platform'),
    platformFinanceReader: granted.has('workflow.finance.read.platform'),
  };
}

export function hasWorkflowCapability(
  actor: WorkflowActor,
  capability: WorkflowCapability,
): boolean {
  return actor.capabilities.includes(capability);
}

/** Enforce a capability. Names nothing the caller can act on. */
export function requireWorkflowCapability(
  actor: WorkflowActor,
  capability: WorkflowCapability,
): void {
  if (hasWorkflowCapability(actor, capability)) return;
  throw workflowFailure('unauthorized', 'Your role does not permit this action.', {
    diagnostics: `actor=${actor.actorId} roles=${actor.roles.join(',')} required=${capability}`,
  });
}

/**
 * The organization a RUN read should be keyed by.
 *
 * A platform reader may name another organization explicitly; everyone else gets
 * their own, whatever they asked for. The asymmetry is deliberate: a tenant
 * operator who supplies somebody else's organization id is not handed an error
 * they could use to enumerate tenants — they are handed their own data.
 */
export function readScopeFor(actor: WorkflowActor, requested?: string): string {
  if (actor.platformReader && requested && requested.trim() !== '') return requested.trim();
  return actor.organization.organizationId;
}

/**
 * The organization a FINANCE read should be keyed by.
 *
 * Separate from `readScopeFor` and gated on a separate capability, so holding
 * `workflow.run.read.platform` does not silently widen a finance report. The two
 * are asserted to follow the same rule shape by the RBAC suite.
 */
export function financeScopeFor(actor: WorkflowActor, requested?: string): string {
  if (actor.platformFinanceReader && requested && requested.trim() !== '') return requested.trim();
  return actor.organization.organizationId;
}
