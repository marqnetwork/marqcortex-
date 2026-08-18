/**
 * Actor resolution.
 *
 * Turns a bearer token into a fully-resolved `AIActor`: identity, roles and the
 * capability grants those roles imply. Authentication itself is a port
 * (`AIAuthenticator`) implemented at the edge against Supabase Auth — the
 * control plane core stays free of any auth vendor.
 *
 * Capabilities, not roles, are what the policy engine enforces. Roles are an
 * organizational convenience that changes over time; capabilities are the
 * stable contract a feature is written against.
 */

import type { AIActor, AIActorType } from '../contracts/request.ts';
import type { AICapability } from '../contracts/policy.ts';
import { AIError } from '../contracts/errors.ts';

/** One organization the subject belongs to, as the identity provider sees it. */
export interface SubjectMembership {
  readonly organizationId: string;
  readonly slug?: string;
  readonly tier?: 'internal' | 'standard' | 'enterprise';
  readonly roles: readonly string[];
}

export interface AuthenticatedSubject {
  readonly subjectId: string;
  readonly email?: string;
  readonly actorType: AIActorType;
  /** Roles that are not organization-scoped (platform admin, service). */
  readonly globalRoles: readonly string[];
  readonly memberships: readonly SubjectMembership[];
}

/**
 * Authentication port. Returns `null` for an absent or invalid credential —
 * it never throws for a bad token, because "unauthenticated" is an expected
 * outcome, not an exception.
 */
export interface AIAuthenticator {
  authenticate(authorization: string | null): Promise<AuthenticatedSubject | null>;
}

/**
 * Role → capability grants. Declarative: granting a new role access to a
 * feature is an edit to this table, not to the execution path.
 */
export const ROLE_CAPABILITIES: Readonly<Record<string, readonly AICapability[]>> = {
  owner: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.block.assist',
    'ai.copilot.plan',
    'ai.section.copilot',
    'ai.agent.execute',
  ],
  admin: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.block.assist',
    'ai.copilot.plan',
    'ai.section.copilot',
    'ai.agent.execute',
  ],
  consultant: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.block.assist',
    'ai.copilot.plan',
    'ai.section.copilot',
    'ai.agent.execute',
  ],
  // Deliberately NOT granted `ai.agent.execute`. A reviewer reads and decides;
  // an agent run spends platform money and can call tools, and a role whose
  // job is to approve other people's work should not be able to start work
  // that then asks itself for approval.
  reviewer: ['ai.narrative.generate', 'ai.chat.converse'],
  analyst: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.agent.execute',
  ],
  /** Machine actors invoked by platform jobs (batch analysis, backfills). */
  service: ['ai.analysis.run', 'ai.narrative.generate', 'ai.agent.execute'],

  // ---------------------------------------------------------------------
  // ORGANIZATION ROLE KEYS
  //
  // The keys above are the console's team vocabulary, carried on the auth
  // record. The three below are the seeded system catalog in
  // `public.roles`, and they arrive on `SubjectMembership.roles`.
  //
  // Both vocabularies had to be here, because a role key that is not in this
  // table grants nothing. Until they were added, joining `roles(key)` into the
  // membership query changed what the query RETURNED and nothing about what
  // any actor could DO — an `org_admin` and a `team_viewer` still resolved to
  // the same capability set. The commit that added the join claimed otherwise;
  // this is the half that makes the claim true.
  //
  // The grants are set at the level the mapped team role already had, never
  // above it (`TEAM_ROLE_TO_ORGANIZATION_ROLE` in `teamAuthorization.ts`):
  //
  //   org_admin   <- admin, owner        => the admin grant, unchanged.
  //   team_member <- reviewer, analyst, consultant => the LEAST of the three,
  //                  which is `reviewer`. A membership row must not hand an
  //                  analyst capability to somebody the console calls a
  //                  reviewer, and the three collapse to one key here.
  //   team_viewer <- viewer              => nothing. `viewer` grants nothing
  //                  above, and read-only is the entire meaning of the role.
  //
  // Roles are additive: an actor holds their team role AND their membership
  // role, so a consultant keeps `ai.analysis.run` from `consultant` whatever
  // their membership key is. Nothing here can take a capability away, and
  // nothing here gives one the mapped team role did not already have.
  org_admin: [
    'ai.narrative.generate',
    'ai.analysis.run',
    'ai.chat.converse',
    'ai.block.assist',
    'ai.copilot.plan',
    'ai.section.copilot',
    'ai.agent.execute',
  ],
  team_member: ['ai.narrative.generate', 'ai.chat.converse'],
  team_viewer: [],
};

/**
 * Every authenticated team member gets this floor, so a member whose role row
 * is missing or misspelled is still able to use the console rather than
 * silently losing AI access. Escalation still requires an explicit role.
 */
const BASELINE_TEAM_CAPABILITIES: readonly AICapability[] = [
  'ai.narrative.generate',
  'ai.chat.converse',
];

export function capabilitiesForRoles(roles: readonly string[]): readonly AICapability[] {
  const granted = new Set<AICapability>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role.toLowerCase()] ?? []) {
      granted.add(capability);
    }
  }
  return [...granted].sort();
}

/**
 * Resolve the actor for a request. Throws `AUTH_REQUIRED` when the feature
 * needs an authenticated caller and none was supplied — anonymous execution is
 * only ever produced when the caller explicitly permits it.
 */
export function resolveActor(
  subject: AuthenticatedSubject | null,
  organizationId: string | null,
  options: { allowAnonymous: boolean },
): AIActor {
  if (!subject) {
    if (!options.allowAnonymous) {
      throw new AIError('AUTH_REQUIRED', 'Authentication is required for this AI feature.');
    }
    return {
      actorId: 'anonymous',
      actorType: 'anonymous',
      roles: [],
      capabilities: [],
    };
  }

  const membership = organizationId
    ? subject.memberships.find((m) => m.organizationId === organizationId)
    : undefined;

  const roles = [...subject.globalRoles, ...(membership?.roles ?? [])];
  const granted = new Set<AICapability>(capabilitiesForRoles(roles));
  if (subject.actorType === 'team_user') {
    for (const capability of BASELINE_TEAM_CAPABILITIES) granted.add(capability);
  }

  return {
    actorId: subject.subjectId,
    actorType: subject.actorType,
    subjectId: subject.subjectId,
    email: subject.email,
    roles: [...new Set(roles.map((r) => r.toLowerCase()))].sort(),
    capabilities: [...granted].sort(),
  };
}
