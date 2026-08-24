/**
 * THE CANONICAL EFFECTIVE-AUTHORITY MODEL — AI-01 Batch 4A, round 3.
 *
 * Four surfaces decide what a person may do on this platform: the AI control
 * plane (`security/actor.ts`), the AI administration console
 * (`admin/rbac.ts`), the agent runtime (`agents/service/agentRbac.ts`) and the
 * workflow runtime (`workflows/service/workflowRbac.ts`). This file drives all
 * four from ONE subject and asserts they agree, because the two findings this
 * batch closes were both cases of them not agreeing.
 *
 *   HIGH-1  FAILED PROMOTION MUST NEVER CREATE A NEW CAPABILITY.
 *
 *           The COMPLETE promotion matrix runs below: every ordered pair of
 *           team roles, against every way the change can fail — the membership
 *           write failing, and the compensating revert failing on top of it —
 *           with the ACTUAL capability sets captured before and after and
 *           compared. Nothing is asserted about labels; the assertion is that
 *           the set after a failure is a subset of the set before it.
 *
 *   HIGH-2  ORGANIZATION MEMBERSHIP CAN NEVER CREATE PLATFORM AUTHORITY.
 *
 *           `platform_admin` is a SEEDED ROW in `public.roles`
 *           (`20260711050001_cortex_tenancy_rls_and_seed.sql`), so a membership
 *           row can point at it and the membership directory will faithfully
 *           report it. A subject with `globalRoles: []` and
 *           `membership.roles: ['platform_admin']` must receive no platform
 *           authority, no `agent.run.read.platform`, no
 *           `workflow.run.read.platform`, no platform approvals, no platform
 *           controls and no cross-tenant read.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTHORITY_LADDER,
  capabilitiesForRoles,
  hasPlatformAuthority,
  MEMBERSHIP_ROLE_VOCABULARY,
  membershipAuthorityRank,
  PLATFORM_AUTHORITY_ROLES,
  resolveActor,
  resolveEffectiveAuthority,
  type AuthenticatedSubject,
  type SubjectMembership,
} from '../../supabase/functions/server/ai/security/actor.ts';
import type { AICapability } from '../../supabase/functions/server/ai/contracts/policy.ts';
import {
  resolveAdminActor,
  resolveAdminRole,
  scopeAllows,
} from '../../supabase/functions/server/ai/admin/rbac.ts';
import {
  AGENT_ROLE_CAPABILITIES,
  readScopeFor,
  resolveAgentActor,
} from '../../supabase/functions/server/ai/agents/service/agentRbac.ts';
import {
  resolveWorkflowActor,
  workflowReadScopeFor,
} from '../../supabase/functions/server/ai/workflows/service/workflowRbac.ts';
import {
  organizationRoleForTeamRole,
  resolveTrustedGlobalRoles,
  TEAM_ROLES,
  type TeamRole,
} from '../../supabase/functions/server/teamAuthorization.ts';

const ORG = 'org-marq';
const OTHER_ORG = 'org-acme';

const TENANCY_OPTIONS = {
  defaultOrganizationId: 'default-org',
  allowList: [] as readonly string[],
  // Kept FALSE. Every subject below holds a real membership, so nothing here
  // depends on the single-tenant fallback — and nothing here may start to.
  allowDefaultOrganization: false,
};

/**
 * A subject as `index.tsx` assembles one.
 *
 * `teamRole` on the membership is the row's own provenance, written by
 * `public.marq_sync_team_membership` (migration 20260820120000). Passing `null`
 * models a row that predates it, which the authority model must read at the
 * key's WEAKEST meaning.
 */
function subject(input: {
  readonly trusted: TeamRole | null;
  readonly membershipRoles: readonly string[];
  readonly membershipTeamRole?: string | null;
  readonly globalExtras?: readonly string[];
  readonly organizationId?: string;
  readonly memberships?: readonly SubjectMembership[];
}): AuthenticatedSubject {
  const membership: SubjectMembership = {
    organizationId: input.organizationId ?? ORG,
    roles: input.membershipRoles,
    ...(input.membershipTeamRole ? { teamRole: input.membershipTeamRole } : {}),
  };
  return {
    subjectId: 'subject-1',
    email: 'subject@marq.test',
    actorType: 'team_user',
    globalRoles: [...(input.globalExtras ?? []), ...(input.trusted ? [input.trusted] : [])],
    memberships: input.memberships ?? [membership],
  };
}

/** A CONSISTENT account at `role`: both systems agree, provenance recorded. */
function consistent(role: TeamRole, organizationId = ORG): AuthenticatedSubject {
  return subject({
    trusted: role,
    membershipRoles: [organizationRoleForTeamRole(role)],
    membershipTeamRole: role,
    organizationId,
  });
}

function capabilitiesOf(s: AuthenticatedSubject, organizationId = ORG): readonly string[] {
  return [...resolveActor(s, organizationId, { allowAnonymous: false }).capabilities].sort();
}

/** Every capability any surface can grant, for one subject, as one flat set. */
function surfaceCapabilities(s: AuthenticatedSubject, organizationId = ORG): readonly string[] {
  const all = new Set<string>(capabilitiesOf(s, organizationId));

  const adminRole = resolveAdminRole(s);
  if (adminRole !== undefined) all.add(`admin:${adminRole}`);

  let agentCapabilities: readonly string[] = [];
  try {
    const agent = resolveAgentActor(s, organizationId, TENANCY_OPTIONS);
    agentCapabilities = agent.capabilities;
    for (const capability of agent.capabilities) all.add(`agent:${capability}`);
  } catch {
    // FORBIDDEN is an empty capability set, which is what we are recording.
  }

  try {
    const workflow = resolveWorkflowActor(s, organizationId, TENANCY_OPTIONS, agentCapabilities);
    for (const capability of workflow.capabilities) all.add(`workflow:${capability}`);
  } catch {
    // As above.
  }

  return [...all].sort();
}

// ===========================================================================
// A. THE MODEL'S TWO INVARIANTS, OVER THE WHOLE MATRIX
// ===========================================================================

describe('the canonical effective-authority model', () => {
  it('holds effectiveCapabilities ⊆ trustedTeamCapabilities for every combination', () => {
    for (const trusted of [...TEAM_ROLES, null] as const) {
      for (const key of ['org_admin', 'team_member', 'team_viewer']) {
        for (const provenance of [...TEAM_ROLES, null] as const) {
          const s = subject({
            trusted,
            membershipRoles: [key],
            membershipTeamRole: provenance,
          });
          const effective = new Set(capabilitiesOf(s));
          const trustedCapabilities = new Set<string>(
            trusted === null ? [] : capabilitiesForRoles([trusted]),
          );
          // The baseline every authenticated team member holds is applied after
          // the floor and is not an authority grant; `viewer` — the bottom of
          // the ladder — holds exactly it.
          const baseline = new Set<string>(capabilitiesForRoles(['reviewer']));

          for (const capability of effective) {
            assert.ok(
              trustedCapabilities.has(capability) || baseline.has(capability),
              `trusted=${trusted} key=${key} provenance=${provenance}: ` +
                `${capability} exceeds what the trusted team role permits`,
            );
          }
        }
      }
    }
  });

  it('holds effectiveCapabilities ⊆ safeMembershipCapabilities for every combination', () => {
    for (const trusted of [...TEAM_ROLES, null] as const) {
      for (const key of ['org_admin', 'team_member', 'team_viewer']) {
        for (const provenance of [...TEAM_ROLES, null] as const) {
          const membership: SubjectMembership = {
            organizationId: ORG,
            roles: [key],
            ...(provenance ? { teamRole: provenance } : {}),
          };
          const s = subject({ trusted, membershipRoles: [key], membershipTeamRole: provenance });

          const safeRole = AUTHORITY_LADDER[membershipAuthorityRank(membership)];
          const safeCapabilities = new Set<string>(capabilitiesForRoles([safeRole]));
          const baseline = new Set<string>(capabilitiesForRoles(['reviewer']));

          for (const capability of capabilitiesOf(s)) {
            assert.ok(
              safeCapabilities.has(capability) || baseline.has(capability),
              `trusted=${trusted} key=${key} provenance=${provenance}: ` +
                `${capability} exceeds what the membership row safely stands for`,
            );
          }
        }
      }
    }
  });

  it('reads an ambiguous key at its weakest meaning when the row carries no provenance', () => {
    // `team_member` is what `reviewer`, `analyst` and `consultant` all map to.
    // With nothing saying which, it is worth a `reviewer`.
    assert.equal(
      membershipAuthorityRank({ organizationId: ORG, roles: ['team_member'] }),
      AUTHORITY_LADDER.indexOf('reviewer'),
    );
    assert.equal(
      membershipAuthorityRank({ organizationId: ORG, roles: ['org_admin'] }),
      AUTHORITY_LADDER.indexOf('admin'),
    );
    assert.equal(
      membershipAuthorityRank({ organizationId: ORG, roles: ['team_viewer'] }),
      AUTHORITY_LADDER.indexOf('viewer'),
    );
  });

  it('honours trusted provenance, clamped to the key\'s ceiling', () => {
    assert.equal(
      membershipAuthorityRank({ organizationId: ORG, roles: ['team_member'], teamRole: 'consultant' }),
      AUTHORITY_LADDER.indexOf('consultant'),
    );
    // Provenance can never lift a row above the band its key allows: an
    // inconsistently written row reads no higher than the key alone would.
    assert.equal(
      membershipAuthorityRank({ organizationId: ORG, roles: ['team_member'], teamRole: 'owner' }),
      AUTHORITY_LADDER.indexOf('consultant'),
    );
    // And below the band it is taken at its lower word. Both directions fail low.
    assert.equal(
      membershipAuthorityRank({ organizationId: ORG, roles: ['org_admin'], teamRole: 'viewer' }),
      AUTHORITY_LADDER.indexOf('viewer'),
    );
  });

  it('is a no-op for a consistent account at every role', () => {
    for (const role of TEAM_ROLES) {
      assert.deepEqual(
        capabilitiesOf(consistent(role)),
        [...new Set([...capabilitiesForRoles([role]), ...capabilitiesForRoles(['reviewer'])])].sort(),
        `${role}: the model changed a consistent account`,
      );
    }
  });

  it('gives every surface the same effective role list', () => {
    for (const role of TEAM_ROLES) {
      const s = consistent(role);
      const canonical = [...resolveEffectiveAuthority(s, s.memberships[0]).roles].sort();
      try {
        assert.deepEqual([...resolveAgentActor(s, ORG, TENANCY_OPTIONS).roles].sort(), canonical);
      } catch {
        // `viewer` holds no agent capability and is refused outright.
        assert.equal(role, 'viewer');
      }
      try {
        assert.deepEqual(
          [...resolveWorkflowActor(s, ORG, TENANCY_OPTIONS, []).roles].sort(),
          canonical,
        );
      } catch {
        assert.equal(role, 'viewer');
      }
    }
  });
});

// ===========================================================================
// B. THE COMPLETE FAILED-PROMOTION MATRIX
// ===========================================================================

/**
 * The reachable states of an INCOMPLETE role change, named by which write
 * failed. `applyTeamRoleChange` writes the trusted `app_metadata` FIRST in
 * every direction, so the membership row is the half that can lag.
 */
const FAILURE_MODES = [
  {
    /** The membership write failed; the compensating revert put the account back. */
    label: 'membership write failed, compensation succeeded',
    trusted: (previous: TeamRole, _next: TeamRole) => previous,
    rowStaysAtPrevious: true,
  },
  {
    /** The membership write failed AND the revert failed. The worst state. */
    label: 'membership write failed, compensation ALSO failed',
    trusted: (_previous: TeamRole, next: TeamRole) => next,
    rowStaysAtPrevious: true,
  },
  {
    /**
     * The row moved and the trusted half did not. Unreachable through
     * `applyTeamRoleChange`, which writes `app_metadata` first — but reachable
     * through a direct database edit, and the model must survive it too.
     */
    label: 'membership write landed, trusted half did not',
    trusted: (previous: TeamRole, _next: TeamRole) => previous,
    rowStaysAtPrevious: false,
  },
] as const;

describe('HIGH-1: a failed promotion never creates a capability', () => {
  it('runs the complete promotion matrix and compares actual capabilities', () => {
    let promotions = 0;

    for (const previous of TEAM_ROLES) {
      for (const next of TEAM_ROLES) {
        if (TEAM_ROLES.indexOf(next) <= TEAM_ROLES.indexOf(previous)) continue;
        promotions += 1;

        // BEFORE: a consistent account at the previous role, on every surface.
        const before = surfaceCapabilities(consistent(previous));

        for (const mode of FAILURE_MODES) {
          const rowRole = mode.rowStaysAtPrevious ? previous : next;
          const after = surfaceCapabilities(
            subject({
              trusted: mode.trusted(previous, next),
              membershipRoles: [organizationRoleForTeamRole(rowRole)],
              membershipTeamRole: rowRole,
            }),
          );

          const added = after.filter((capability) => !before.includes(capability));
          assert.deepEqual(
            added,
            [],
            `${previous} -> ${next} (${mode.label}) ADDED ${added.join(', ')}`,
          );
        }
      }
    }

    assert.equal(promotions, 15, 'every ordered promotion pair was exercised');
  });

  it('adds no AI, agent, workflow, organization, console, admin or platform capability', () => {
    // The same matrix, read through the categories the finding names, so a
    // future capability in any of them is caught by name and not only by set
    // subtraction.
    const forbiddenPrefixes = ['ai.', 'agent:', 'workflow:', 'admin:'];

    for (const previous of TEAM_ROLES) {
      for (const next of TEAM_ROLES) {
        if (TEAM_ROLES.indexOf(next) <= TEAM_ROLES.indexOf(previous)) continue;

        const before = new Set(surfaceCapabilities(consistent(previous)));
        for (const mode of FAILURE_MODES) {
          const rowRole = mode.rowStaysAtPrevious ? previous : next;
          for (const capability of surfaceCapabilities(
            subject({
              trusted: mode.trusted(previous, next),
              membershipRoles: [organizationRoleForTeamRole(rowRole)],
              membershipTeamRole: rowRole,
            }),
          )) {
            if (!forbiddenPrefixes.some((prefix) => capability.startsWith(prefix))) continue;
            assert.ok(
              before.has(capability),
              `${previous} -> ${next} (${mode.label}) granted ${capability}`,
            );
          }
        }
      }
    }
  });

  it('the reviewer -> consultant case that the ceiling reading widened', () => {
    // The named instance. Both roles map to `team_member`, so the row does not
    // move at all and the key alone cannot tell the two apart.
    const before = capabilitiesOf(consistent('reviewer'));

    const halfPromoted = subject({
      trusted: 'consultant',                 // the trusted write landed
      membershipRoles: ['team_member'],      // the row never moved
      membershipTeamRole: 'reviewer',        // and its provenance says so
    });
    const after = capabilitiesOf(halfPromoted);

    assert.deepEqual(after, before, 'a failed promotion changed the capability set');
    for (const capability of [
      'ai.analysis.run',
      'ai.block.assist',
      'ai.copilot.plan',
      'ai.section.copilot',
      'ai.agent.execute',
    ] satisfies AICapability[]) {
      assert.equal(
        after.includes(capability),
        false,
        `${capability} survived a promotion that failed`,
      );
    }
  });

  it('a promotion that COMPLETES does grant, so the fix is not a blanket refusal', () => {
    const before = capabilitiesOf(consistent('reviewer'));
    const after = capabilitiesOf(consistent('consultant'));
    assert.ok(after.includes('ai.agent.execute'));
    assert.ok(after.length > before.length, 'a completed promotion must still grant');
  });

  it('a demotion still revokes in every failure mode', () => {
    for (const previous of TEAM_ROLES) {
      for (const next of TEAM_ROLES) {
        if (TEAM_ROLES.indexOf(next) >= TEAM_ROLES.indexOf(previous)) continue;

        const target = new Set(surfaceCapabilities(consistent(next)));
        // The trusted half falls first and the row lags — the reachable partial
        // demotion. Nothing above the NEW role may survive it.
        const partial = surfaceCapabilities(
          subject({
            trusted: next,
            membershipRoles: [organizationRoleForTeamRole(previous)],
            membershipTeamRole: previous,
          }),
        );
        const excess = partial.filter((capability) => !target.has(capability));
        assert.deepEqual(
          excess,
          [],
          `${previous} -> ${next}: a partial demotion left ${excess.join(', ')}`,
        );
      }
    }
  });
});

// ===========================================================================
// C. MEMBERSHIP CAN NEVER CREATE PLATFORM AUTHORITY
// ===========================================================================

describe('HIGH-2: organization membership never creates platform authority', () => {
  /** The exact subject the finding names. */
  const membershipPlatformAdmin: AuthenticatedSubject = {
    subjectId: 'impostor',
    email: 'impostor@example.test',
    actorType: 'team_user',
    globalRoles: [],
    memberships: [{ organizationId: ORG, roles: ['platform_admin'] }],
  };

  it('grants no platform authority at the model', () => {
    assert.equal(hasPlatformAuthority(membershipPlatformAdmin), false);
    const authority = resolveEffectiveAuthority(
      membershipPlatformAdmin,
      membershipPlatformAdmin.memberships[0],
    );
    assert.equal(authority.platform, false);
    assert.deepEqual([...authority.roles], [], 'the membership name did not survive');
  });

  it('grants no AI capability above the team baseline', () => {
    const actor = resolveActor(membershipPlatformAdmin, ORG, { allowAnonymous: false });
    assert.deepEqual(
      [...actor.capabilities].sort(),
      ['ai.chat.converse', 'ai.narrative.generate'],
      'a platform_admin membership row granted an AI capability',
    );
    assert.deepEqual([...actor.roles], [], 'the effective roles carry no platform name');
    assert.ok(
      actor.sourceRoles?.includes('platform_admin'),
      'the row is still reported for the audit record',
    );
  });

  it('grants no AI administration tier', () => {
    assert.equal(resolveAdminRole(membershipPlatformAdmin), undefined);
  });

  it('grants no agent authority at all — no run.read.platform, no approvals, no controls', () => {
    assert.throws(
      () => resolveAgentActor(membershipPlatformAdmin, ORG, TENANCY_OPTIONS),
      /not permitted/i,
      'a platform_admin membership row resolved an agent actor',
    );
  });

  it('grants no workflow authority at all — no run.read.platform, no approvals, no controls', () => {
    assert.throws(
      () => resolveWorkflowActor(membershipPlatformAdmin, ORG, TENANCY_OPTIONS, []),
      /not permitted/i,
    );
  });

  it('refuses every other name a membership row could carry', () => {
    // `public.roles` is a table. An operator can add a key to it tomorrow, and
    // a membership row can point at any of them. Nothing outside the
    // vocabulary may key a grant table.
    for (const invented of [
      'platform_admin',
      'super_admin',
      'service',
      'organization_admin',
      'team_admin',
      'root',
      'SUPER_ADMIN',
      ' platform_admin ',
    ]) {
      const s: AuthenticatedSubject = {
        subjectId: 'invented',
        actorType: 'team_user',
        globalRoles: [],
        memberships: [{ organizationId: ORG, roles: [invented] }],
      };
      const authority = resolveEffectiveAuthority(s, s.memberships[0]);
      assert.equal(authority.platform, false, `${invented} conferred platform authority`);
      assert.deepEqual([...authority.roles], [], `${invented} survived into the effective roles`);
      assert.throws(() => resolveAgentActor(s, ORG, TENANCY_OPTIONS));
      assert.throws(() => resolveWorkflowActor(s, ORG, TENANCY_OPTIONS, []));
    }
  });

  it('does not let a membership row lift an ordinary team member to the platform', () => {
    // The dangerous shape: a REAL consultant whose membership row has been
    // pointed at the seeded `platform_admin` role. The consultant's own
    // authority must survive; the platform's must not appear.
    const s = subject({
      trusted: 'consultant',
      membershipRoles: ['team_member', 'platform_admin'],
      membershipTeamRole: 'consultant',
    });

    assert.equal(hasPlatformAuthority(s), false);
    assert.equal(resolveAdminRole(s), 'team_admin', 'the consultant tier, not the platform one');

    const agent = resolveAgentActor(s, ORG, TENANCY_OPTIONS);
    assert.ok(agent.capabilities.includes('agent.run.create'), 'the consultant still operates');
    assert.equal(agent.capabilities.includes('agent.run.read.platform'), false);
    assert.equal(agent.platformReader, false);

    const workflow = resolveWorkflowActor(s, ORG, TENANCY_OPTIONS, agent.capabilities);
    assert.equal(workflow.capabilities.includes('workflow.run.read.platform'), false);
    assert.equal(workflow.platformReader, false);
  });

  it('a MARQ team owner is not a platform operator either', () => {
    // Finding M-B, still closed: the top of the team hierarchy is an
    // organization fact.
    const owner = consistent('owner');
    assert.equal(hasPlatformAuthority(owner), false);
    assert.equal(resolveAdminRole(owner), 'organization_admin');
    assert.equal(
      resolveAgentActor(owner, ORG, TENANCY_OPTIONS).capabilities.includes('agent.run.read.platform'),
      false,
    );
  });

  it('an EXPLICIT trusted platform administrator still holds everything', () => {
    // The fix must not have removed the platform operator. `platform_admin`
    // here arrives on `globalRoles`, which is `app_metadata.platform_role`.
    const operator: AuthenticatedSubject = {
      subjectId: 'operator',
      actorType: 'team_user',
      globalRoles: ['platform_admin', 'owner'],
      memberships: [{ organizationId: ORG, roles: ['org_admin'], teamRole: 'owner' }],
    };
    assert.equal(hasPlatformAuthority(operator), true);
    assert.equal(resolveAdminRole(operator), 'super_admin');

    const agent = resolveAgentActor(operator, ORG, TENANCY_OPTIONS);
    assert.ok(agent.capabilities.includes('agent.run.read.platform'));
    assert.equal(agent.platformReader, true);

    const workflow = resolveWorkflowActor(operator, ORG, TENANCY_OPTIONS, agent.capabilities);
    assert.ok(workflow.capabilities.includes('workflow.run.read.platform'));
    assert.equal(workflow.platformReader, true);
  });

  it('the platform role names and the membership vocabulary are disjoint', () => {
    for (const role of PLATFORM_AUTHORITY_ROLES) {
      assert.equal(
        MEMBERSHIP_ROLE_VOCABULARY.has(role),
        false,
        `${role} is readable from a membership row`,
      );
    }
  });
});

// ===========================================================================
// D. THE DEFAULT ORGANIZATION, IF IT IS EVER TURNED ON
// ===========================================================================

describe('a privileged capability requires a verified membership', () => {
  const DEFAULT_ORG = 'default-org';

  /** A stamped team account with NO membership row anywhere. */
  const unaffiliated: AuthenticatedSubject = {
    subjectId: 'unaffiliated',
    email: 'newhire@marq.test',
    actorType: 'team_user',
    globalRoles: ['owner'],
    memberships: [],
  };

  it('AI_ALLOW_DEFAULT_ORGANIZATION stays false by default', async () => {
    const { loadControlPlaneConfig } = await import(
      '../../supabase/functions/server/ai/runtime/config.ts'
    );
    assert.equal(
      loadControlPlaneConfig({ get: () => undefined }).allowDefaultOrganization,
      false,
    );
  });

  it('fails closed with the fallback disabled', () => {
    assert.throws(
      () => resolveAgentActor(unaffiliated, undefined, TENANCY_OPTIONS),
      /organization/i,
    );
  });

  it('grants nothing privileged even when the fallback IS enabled', () => {
    // The requirement that does not depend on the switch staying off. With the
    // fallback on, `resolveOrganization` admits this account into the default
    // organization — and an `owner` team role would otherwise carry the full
    // privileged set into a tenant nobody has confirmed they belong to.
    const actor = resolveActor(unaffiliated, DEFAULT_ORG, { allowAnonymous: false });
    assert.deepEqual(
      [...actor.capabilities].sort(),
      ['ai.chat.converse', 'ai.narrative.generate'],
      'an unaffiliated account held a privileged capability in the default organization',
    );
    for (const capability of [
      'ai.analysis.run',
      'ai.block.assist',
      'ai.copilot.plan',
      'ai.section.copilot',
      'ai.agent.execute',
    ] satisfies AICapability[]) {
      assert.equal(actor.capabilities.includes(capability), false, `${capability} survived`);
    }
  });

  it('an account WITH a verified membership is unaffected', () => {
    const actor = resolveActor(consistent('owner'), ORG, { allowAnonymous: false });
    assert.ok(actor.capabilities.includes('ai.agent.execute'));
  });

  // =========================================================================
  // MED-A — ALL FOUR SURFACES, NOT ONLY THE AI CONTROL PLANE
  //
  // The assertion above covered `resolveActor` and stopped there, and that is
  // exactly how MED-A survived the previous round: the agent and workflow
  // runtimes read the same subject, resolved the same fallback organization,
  // and handed an account with no membership row `agent.run.create`,
  // `agent.run.control`, `agent.approval.decide` and their workflow
  // equivalents. The claim was "a privileged capability requires a verified
  // membership"; the proof only ever tested one of the four places that make
  // that decision.
  //
  // THE INVARIANT: unverified/default organization resolution must never grant
  // privileged AI, agent, workflow or admin authority.
  // =========================================================================
  const FALLBACK_ON = { ...TENANCY_OPTIONS, allowDefaultOrganization: true };

  /** Every capability that spends, controls or decides, by surface. */
  const AGENT_PRIVILEGED = [
    'agent.run.create',
    'agent.run.control',
    'agent.approval.decide',
    'agent.run.read.platform',
  ] as const;
  const WORKFLOW_PRIVILEGED = [
    'workflow.run.create',
    'workflow.run.control',
    'workflow.approval.decide',
    'workflow.run.read.platform',
  ] as const;

  /** A stamped account at `role`, holding no membership row anywhere. */
  const stampedButUnaffiliated = (role: string): AuthenticatedSubject => ({
    subjectId: `unaffiliated-${role}`,
    email: `${role}@marq.test`,
    actorType: 'team_user',
    globalRoles: [role],
    memberships: [],
  });

  for (const role of ['owner', 'admin', 'reviewer'] as const) {
    it(`default org + ${role} + no membership grants no privileged agent authority`, () => {
      const actor = resolveAgentActor(stampedButUnaffiliated(role), undefined, FALLBACK_ON);

      assert.equal(
        actor.organization.membershipVerified,
        false,
        'the fallback must never synthesize a verified membership',
      );
      assert.equal(actor.organization.organizationId, DEFAULT_ORG);
      assert.equal(actor.platformReader, false, 'no cross-tenant read from the fallback');

      for (const capability of AGENT_PRIVILEGED) {
        assert.equal(
          actor.capabilities.includes(capability),
          false,
          `${role} received ${capability} from an UNVERIFIED organization`,
        );
      }

      // The read scope may never widen past the organization the actor is in,
      // whatever the caller asks for.
      assert.equal(readScopeFor(actor, 'some-other-org'), DEFAULT_ORG);
    });

    it(`default org + ${role} + no membership grants no privileged workflow authority`, () => {
      const actor = resolveWorkflowActor(stampedButUnaffiliated(role), undefined, FALLBACK_ON, []);

      assert.equal(actor.organization.membershipVerified, false);
      assert.equal(actor.platformReader, false);

      for (const capability of WORKFLOW_PRIVILEGED) {
        assert.equal(
          actor.capabilities.includes(capability),
          false,
          `${role} received ${capability} from an UNVERIFIED organization`,
        );
      }

      assert.equal(workflowReadScopeFor(actor, 'some-other-org'), DEFAULT_ORG);
    });
  }

  it('default org + no membership leaves the admin surface with no organization scope', () => {
    // The admin tier is allowed to keep authority that is genuinely global.
    // What it may not keep is authority over an ORGANIZATION, and the scope is
    // where that is decided: an empty scope reaches no tenant's records at all.
    const actor = resolveAdminActor(stampedButUnaffiliated('owner'));

    assert.deepEqual(actor.organizationScope, [], 'an unaffiliated account held an organization scope');
    assert.equal(scopeAllows(actor, DEFAULT_ORG), false, 'the fallback organization was in scope');
    assert.equal(scopeAllows(actor, ORG), false);
    assert.equal(scopeAllows(actor, OTHER_ORG), false);
  });

  it('default org + forged user_metadata owner reaches nothing', () => {
    // The forged half never becomes a global role in the first place, so the
    // subject the runtimes see carries no team role at all — and an account
    // with no trusted role and no membership is refused outright rather than
    // being floored to a reader.
    assert.deepEqual(
      resolveTrustedGlobalRoles({
        app_metadata: {},
        user_metadata: { team_role: 'owner', marq_team: true, platform_role: 'admin' },
      }),
      [],
      'forged user_metadata produced a trusted global role',
    );

    const forged: AuthenticatedSubject = {
      subjectId: 'forger',
      actorType: 'team_user',
      globalRoles: [],
      memberships: [],
    };
    assert.throws(() => resolveAgentActor(forged, undefined, FALLBACK_ON), /not permitted/i);
    assert.throws(() => resolveWorkflowActor(forged, undefined, FALLBACK_ON, []), /not permitted/i);
    assert.throws(() => resolveAdminActor(forged), /not permitted/i);
  });

  it('default org + a membership-sourced platform_admin that no longer exists reaches nothing', () => {
    // The account was pointed at the seeded `platform_admin` role and then lost
    // its membership row entirely. Neither half may survive the other.
    const orphaned: AuthenticatedSubject = {
      subjectId: 'orphan',
      actorType: 'team_user',
      globalRoles: [],
      memberships: [],
    };
    assert.equal(hasPlatformAuthority(orphaned), false);
    assert.throws(() => resolveAgentActor(orphaned, undefined, FALLBACK_ON), /not permitted/i);
  });

  it('an EXPLICIT trusted global platform admin keeps global authority, but gains no membership', () => {
    // TASK 4. Genuinely global authority is not something the fallback
    // conferred, so the verified-membership rule does not take it away. What it
    // must NOT do is turn into a verified membership, or into organization
    // authority over the tenant the account happened to land in.
    const operator: AuthenticatedSubject = {
      subjectId: 'operator',
      actorType: 'team_user',
      globalRoles: ['platform_admin'],
      memberships: [],
    };

    const agent = resolveAgentActor(operator, undefined, FALLBACK_ON);
    assert.equal(
      agent.organization.membershipVerified,
      false,
      'platform authority must not become a verified membership',
    );
    assert.ok(
      agent.capabilities.includes('agent.run.read.platform'),
      'the explicit platform operator lost genuinely global read',
    );
    assert.equal(agent.platformReader, true);

    // Global READ survives. Organization-scoped privilege does not.
    for (const capability of ['agent.run.create', 'agent.run.control', 'agent.approval.decide'] as const) {
      assert.equal(
        agent.capabilities.includes(capability),
        false,
        `${capability} was granted over an organization with no verified membership`,
      );
    }

    const workflow = resolveWorkflowActor(operator, undefined, FALLBACK_ON, []);
    assert.ok(workflow.capabilities.includes('workflow.run.read.platform'));
    for (const capability of [
      'workflow.run.create',
      'workflow.run.control',
      'workflow.approval.decide',
    ] as const) {
      assert.equal(workflow.capabilities.includes(capability), false, `${capability} survived`);
    }

    // The platform scope rules still decide cross-tenant reads, and they are
    // unchanged: an explicit operator may name another organization.
    assert.equal(readScopeFor(agent, OTHER_ORG), OTHER_ORG);
    assert.equal(resolveAdminRole(operator), 'super_admin');
  });

  // =========================================================================
  // TASK 3 — POSITIVE CONTROL. The fix must not break legitimate members.
  // =========================================================================
  it('a VERIFIED member keeps every intended organization capability', () => {
    const member = consistent('owner');

    const agent = resolveAgentActor(member, ORG, TENANCY_OPTIONS);
    assert.equal(agent.organization.membershipVerified, true);
    for (const capability of [
      'agent.run.create',
      'agent.run.control',
      'agent.approval.decide',
      'agent.run.read',
      'agent.registry.read',
    ] as const) {
      assert.ok(agent.capabilities.includes(capability), `a verified owner lost ${capability}`);
    }

    const workflow = resolveWorkflowActor(member, ORG, TENANCY_OPTIONS, agent.capabilities);
    assert.equal(workflow.organization.membershipVerified, true);
    for (const capability of [
      'workflow.run.create',
      'workflow.run.control',
      'workflow.approval.decide',
      'workflow.run.read',
    ] as const) {
      assert.ok(workflow.capabilities.includes(capability), `a verified owner lost ${capability}`);
    }

    // …and still no platform authority, because they are not a platform operator.
    assert.equal(agent.platformReader, false);
    assert.equal(workflow.platformReader, false);
  });

  it('a verified member at every team role is unchanged by the MED-A cut', () => {
    // The cut keys off `membershipVerified`, so it must be a NO-OP for every
    // account that holds a real membership — at every rank, not only at owner.
    for (const role of TEAM_ROLES) {
      const subject = consistent(role);
      let capabilities: readonly string[] = [];
      try {
        capabilities = resolveAgentActor(subject, ORG, TENANCY_OPTIONS).capabilities;
      } catch {
        capabilities = []; // viewer holds no agent authority at all, by design
      }
      // The floor decides the rank; the MED-A cut must not have moved it. A
      // verified member's set is exactly what the certified grant table says
      // for the role their two systems agree on.
      assert.deepEqual(
        [...capabilities].sort(),
        [...new Set(AGENT_ROLE_CAPABILITIES[role] ?? [])].sort(),
        `${role} disagreed with the certified grant table after the MED-A cut`,
      );
    }
  });
});

// ===========================================================================
// E. CROSS-TENANT AGENT AND WORKFLOW AUTHORIZATION
// ===========================================================================

describe('cross-tenant agent and workflow authorization', () => {
  it('a tenant operator asking for another organization gets their own', () => {
    const s = consistent('admin');
    const agent = resolveAgentActor(s, ORG, TENANCY_OPTIONS);
    assert.equal(readScopeFor(agent, OTHER_ORG), ORG, 'a tenant admin read another tenant');

    const workflow = resolveWorkflowActor(s, ORG, TENANCY_OPTIONS, agent.capabilities);
    assert.equal(workflowReadScopeFor(workflow, OTHER_ORG), ORG);
  });

  it('a membership-sourced platform role does not widen the read scope', () => {
    const s: AuthenticatedSubject = {
      subjectId: 'impostor',
      actorType: 'team_user',
      globalRoles: ['admin'],
      memberships: [{ organizationId: ORG, roles: ['org_admin', 'platform_admin'], teamRole: 'admin' }],
    };
    const agent = resolveAgentActor(s, ORG, TENANCY_OPTIONS);
    assert.equal(agent.platformReader, false);
    assert.equal(readScopeFor(agent, OTHER_ORG), ORG);

    const workflow = resolveWorkflowActor(s, ORG, TENANCY_OPTIONS, agent.capabilities);
    assert.equal(workflow.platformReader, false);
    assert.equal(workflowReadScopeFor(workflow, OTHER_ORG), ORG);
  });

  it('a subject cannot resolve into an organization they hold no membership in', () => {
    const s = consistent('owner', ORG);
    assert.throws(
      () => resolveAgentActor(s, OTHER_ORG, TENANCY_OPTIONS),
      /organization/i,
      'the default organization is disabled and a hint is not authority',
    );
    assert.throws(() => resolveWorkflowActor(s, OTHER_ORG, TENANCY_OPTIONS, []), /organization/i);
  });

  it('multi-organization membership floors against the RESOLVED organization only', () => {
    // An `admin` in MARQ and a `viewer` in ACME. Resolving into ACME must not
    // borrow the MARQ row's standing.
    const s: AuthenticatedSubject = {
      subjectId: 'multi',
      actorType: 'team_user',
      globalRoles: ['admin'],
      memberships: [
        { organizationId: ORG, roles: ['org_admin'], teamRole: 'admin' },
        { organizationId: OTHER_ORG, roles: ['team_viewer'], teamRole: 'viewer' },
      ],
    };

    const inMarq = resolveAgentActor(s, ORG, TENANCY_OPTIONS);
    assert.ok(inMarq.capabilities.includes('agent.approval.decide'));

    assert.throws(
      () => resolveAgentActor(s, OTHER_ORG, TENANCY_OPTIONS),
      /not permitted/i,
      'the ACME viewer row borrowed the MARQ admin row\'s authority',
    );

    assert.deepEqual(
      capabilitiesOf(s, OTHER_ORG),
      ['ai.chat.converse', 'ai.narrative.generate'],
      'the AI plane leaked MARQ authority into ACME',
    );
  });

  it('only an explicit platform operator may name another organization', () => {
    const operator: AuthenticatedSubject = {
      subjectId: 'operator',
      actorType: 'team_user',
      globalRoles: ['platform_admin', 'admin'],
      memberships: [{ organizationId: ORG, roles: ['org_admin'], teamRole: 'admin' }],
    };
    const agent = resolveAgentActor(operator, ORG, TENANCY_OPTIONS);
    assert.equal(readScopeFor(agent, OTHER_ORG), OTHER_ORG);

    const workflow = resolveWorkflowActor(operator, ORG, TENANCY_OPTIONS, agent.capabilities);
    assert.equal(workflowReadScopeFor(workflow, OTHER_ORG), OTHER_ORG);
  });
});
