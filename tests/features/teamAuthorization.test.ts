/**
 * Team administration authorization.
 *
 * The reviewed defect: `POST /team/invite`, `PATCH /team/members/:id` and
 * `DELETE /team/members/:id` checked that the caller held a valid team token
 * and then acted on a `teamRole` read straight from the request body. Any
 * authenticated team member — a `viewer` included — could mint an admin,
 * promote themselves, or delete anyone. Authentication was standing in for
 * authorization.
 *
 * These tests are the negative cases. Each one describes a concrete escalation
 * an attacker with a legitimate low-privilege account would attempt, and pins
 * the refusal.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEAM_ROLES,
  authorizeMemberRemoval,
  authorizeRoleAssignment,
  authorizeTeamAdmin,
  isTeamRole,
  normalizeTeamRole,
  roleRank,
  type TeamRole,
} from '../../supabase/functions/server/teamAuthorization.ts';

/** A caller the server has provisioned, at a given role. */
const provisioned = (role: TeamRole) => ({ provisioned: true, role });

describe('team role normalisation', () => {
  it('defaults an unknown or missing role to the LEAST privileged', () => {
    // The delivered code defaulted a missing `teamRole` to 'admin' in three
    // places, which turns a data gap into a privilege grant.
    for (const value of [undefined, null, '', 'superadmin', 42, {}]) {
      assert.equal(normalizeTeamRole(value), 'viewer', `input: ${JSON.stringify(value)}`);
    }
  });

  it('accepts a declared role case-insensitively', () => {
    assert.equal(normalizeTeamRole('ADMIN'), 'admin');
    assert.equal(normalizeTeamRole('  Consultant '), 'consultant');
  });

  it('ranks roles strictly, with owner highest', () => {
    assert.equal(roleRank('viewer'), 0);
    assert.equal(roleRank('owner'), TEAM_ROLES.length - 1);
    assert.ok(roleRank('admin') > roleRank('consultant'));
    assert.ok(roleRank('consultant') > roleRank('viewer'));
  });

  it('rejects an undeclared role name', () => {
    assert.equal(isTeamRole('superadmin'), false);
    assert.equal(isTeamRole('admin'), true);
  });
});

describe('team admin gate', () => {
  it('rejects an unauthenticated caller with 401', () => {
    const result = authorizeTeamAdmin(null, null);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.status, 401);
  });

  it('rejects an authenticated non-admin with 403', () => {
    // The core finding: a valid token is not permission to administer the team.
    for (const role of ['viewer', 'reviewer', 'analyst', 'consultant'] as const) {
      const result = authorizeTeamAdmin('user-1', provisioned(role));
      assert.equal(result.ok, false, `${role} must not administer the team`);
      if (result.ok) return;
      assert.equal(result.failure.status, 403);
      assert.equal(result.failure.code, 'FORBIDDEN');
    }
  });

  it('admits an admin and an owner', () => {
    assert.equal(authorizeTeamAdmin('user-1', provisioned('admin')).ok, true);
    assert.equal(authorizeTeamAdmin('user-1', provisioned('owner')).ok, true);
  });

  // HIGH-2. The gate that did not exist: an authenticated account that the
  // server never provisioned is not a team member, whatever role it claims.
  it('rejects an authenticated account that is not a provisioned team account', () => {
    for (const role of TEAM_ROLES) {
      const result = authorizeTeamAdmin('stranger-1', { provisioned: false, role });
      assert.equal(result.ok, false, `an unprovisioned ${role} must not administer the team`);
      if (result.ok) return;
      assert.equal(result.failure.status, 403);
      // Reported as its own fact. "A colleague lacks the rank" and "a stranger
      // tried" are different events and an operator needs to tell them apart.
      assert.equal(result.failure.code, 'NOT_A_TEAM_ACCOUNT');
    }
  });

  it('rejects a caller with no authority at all', () => {
    const result = authorizeTeamAdmin('stranger-1', null);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'NOT_A_TEAM_ACCOUNT');
  });
});

describe('role assignment — privilege escalation', () => {
  const admin = { callerId: 'admin-1', callerRole: 'admin' as const };

  it('refuses a caller-invented role name', () => {
    const result = authorizeRoleAssignment({ ...admin, requestedRole: 'superadmin' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'INVALID_ROLE');
    assert.equal(result.failure.status, 400);
  });

  it('refuses assigning a role at or above the caller own', () => {
    // An admin who may mint another admin can hand out their own access without
    // an owner ever being involved — one admin becomes every admin.
    for (const requested of ['admin', 'owner'] as const) {
      const result = authorizeRoleAssignment({ ...admin, requestedRole: requested });
      assert.equal(result.ok, false, `admin must not assign ${requested}`);
      if (result.ok) return;
      assert.equal(result.failure.code, 'ROLE_ESCALATION');
      assert.equal(result.failure.status, 403);
    }
  });

  it('permits an owner to create an admin', () => {
    const result = authorizeRoleAssignment({
      callerId: 'owner-1',
      callerRole: 'owner',
      requestedRole: 'admin',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.role, 'admin');
  });

  it('refuses a caller changing their own role', () => {
    const result = authorizeRoleAssignment({
      callerId: 'owner-1',
      callerRole: 'owner',
      targetId: 'owner-1',
      requestedRole: 'admin',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'SELF_ROLE_CHANGE');
  });

  it('refuses re-roling a member who already outranks the caller', () => {
    // The escalation seen from the other end: demote the owner, then act
    // unopposed.
    const result = authorizeRoleAssignment({
      ...admin,
      targetId: 'owner-1',
      requestedRole: 'viewer',
      targetCurrentRole: 'owner',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'ROLE_ESCALATION');
  });

  it('permits an admin to assign a strictly lower role', () => {
    const result = authorizeRoleAssignment({ ...admin, requestedRole: 'consultant' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.role, 'consultant');
  });
});

describe('member removal', () => {
  const admin = { callerId: 'admin-1', callerRole: 'admin' as const };

  it('refuses self-removal', () => {
    const result = authorizeMemberRemoval({ ...admin, targetId: 'admin-1' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'SELF_REMOVAL');
  });

  it('refuses removing a member at or above the caller rank', () => {
    const result = authorizeMemberRemoval({
      ...admin,
      targetId: 'owner-1',
      targetCurrentRole: 'owner',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, 'ROLE_ESCALATION');
  });

  it('permits removing a lower-ranked member', () => {
    const result = authorizeMemberRemoval({
      ...admin,
      targetId: 'viewer-1',
      targetCurrentRole: 'viewer',
    });
    assert.equal(result.ok, true);
  });
});
