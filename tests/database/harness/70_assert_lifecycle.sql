-- ============================================================================
-- Membership lifecycle — empirical assertions against the REAL functions.
--
-- Runs after the bootstrap, on the bootstrap's own fixture, so the state these
-- assertions start from is the state a real deployment starts from.
--
-- What it settles, and why none of it can be settled by reading the SQL:
--
--   HIGH-1  A demotion must move `role_id`. The console used to rewrite
--           `app_metadata` alone, and the membership kept `org_admin`.
--   MED-1   An invite must produce exactly ONE active MARQ membership for an
--           account that had none.
--   The role mapping, applied by the database rather than described in a
--   comment; idempotency; revocation, including revoking nothing twice; and
--   the refusals — an unknown user, a dead user, an invented role.
-- ============================================================================

DO $$
DECLARE
  v_owner    UUID := '00000000-0000-4000-8000-00000000aaa1';  -- admitted org_admin
  v_analyst  UUID := '00000000-0000-4000-8000-00000000bbb2';  -- admitted team_member
  v_fresh    UUID := '00000000-0000-4000-8000-0000000c0001';  -- created below: the new hire
  v_ghost    UUID := '00000000-0000-4000-8000-0000000dead0';  -- no auth.users row
  v_gone     UUID := '00000000-0000-4000-8000-0000000f0002';  -- deleted auth user
  v_suspended UUID := '00000000-0000-4000-8000-0000000e0002'; -- suspended membership
  v_org      UUID;
  v_result   JSONB;
  v_key      TEXT;
  v_count    INTEGER;
  v_status   TEXT;
  v_failed   BOOLEAN;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  -- -----------------------------------------------------------------------
  -- HIGH-1. The demotion the console could not perform.
  -- -----------------------------------------------------------------------
  SELECT r.key INTO v_key
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = v_owner AND m.deleted_at IS NULL;

  IF v_key <> 'org_admin' THEN
    RAISE EXCEPTION 'precondition: the owner should hold org_admin, holds %', v_key;
  END IF;

  v_result := public.marq_sync_team_membership(v_owner, 'viewer');

  IF v_result ->> 'action' <> 'role_changed' THEN
    RAISE EXCEPTION 'demotion reported action %, expected role_changed', v_result ->> 'action';
  END IF;

  SELECT r.key INTO v_key
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = v_owner AND m.deleted_at IS NULL;

  IF v_key <> 'team_viewer' THEN
    RAISE EXCEPTION 'HIGH-1: after admin -> viewer the membership still holds %, not team_viewer', v_key;
  END IF;

  -- And exactly one row: a demotion must not leave the old grant beside the new.
  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships
  WHERE organization_id = v_org AND user_id = v_owner AND deleted_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'HIGH-1: % live memberships after a demotion, expected 1', v_count;
  END IF;

  -- -----------------------------------------------------------------------
  -- Idempotency: the same role again writes nothing.
  -- -----------------------------------------------------------------------
  v_result := public.marq_sync_team_membership(v_owner, 'viewer');
  IF v_result ->> 'action' <> 'unchanged' THEN
    RAISE EXCEPTION 'a repeated sync reported %, expected unchanged', v_result ->> 'action';
  END IF;

  -- -----------------------------------------------------------------------
  -- Promotion, and the rest of the mapping, applied by the database.
  -- -----------------------------------------------------------------------
  PERFORM public.marq_sync_team_membership(v_owner, 'owner');
  SELECT r.key INTO v_key FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = v_owner AND m.deleted_at IS NULL;
  IF v_key <> 'org_admin' THEN
    RAISE EXCEPTION 'viewer -> owner left the membership at %', v_key;
  END IF;

  PERFORM public.marq_sync_team_membership(v_analyst, 'reviewer');
  SELECT r.key INTO v_key FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = v_analyst AND m.deleted_at IS NULL;
  IF v_key <> 'team_member' THEN
    RAISE EXCEPTION 'analyst -> reviewer left the membership at %', v_key;
  END IF;

  PERFORM public.marq_sync_team_membership(v_analyst, 'viewer');
  SELECT r.key INTO v_key FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = v_analyst AND m.deleted_at IS NULL;
  IF v_key <> 'team_viewer' THEN
    RAISE EXCEPTION 'analyst -> viewer left the membership at %', v_key;
  END IF;

  -- An unrecognised role is not an error and is not a guess: it is the least
  -- privileged key, the same answer `normalizeTeamRole` gives.
  PERFORM public.marq_sync_team_membership(v_analyst, 'manager');
  SELECT r.key INTO v_key FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = v_analyst AND m.deleted_at IS NULL;
  IF v_key <> 'team_viewer' THEN
    RAISE EXCEPTION 'the unrecognised role `manager` mapped to %, expected team_viewer', v_key;
  END IF;

  -- -----------------------------------------------------------------------
  -- MED-1. A new hire gets a membership at provisioning time.
  -- -----------------------------------------------------------------------
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_fresh, 'newhire@marq.test',
          '{"marq_team": true, "team_role": "consultant"}'::JSONB,
          '{"role": "team", "teamRole": "consultant"}'::JSONB);

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships WHERE user_id = v_fresh;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'precondition: the new hire should hold no membership, holds %', v_count;
  END IF;

  v_result := public.marq_sync_team_membership(v_fresh, 'consultant');

  IF v_result ->> 'action' <> 'created' THEN
    RAISE EXCEPTION 'MED-1: provisioning reported %, expected created', v_result ->> 'action';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships
  WHERE organization_id = v_org AND user_id = v_fresh AND deleted_at IS NULL AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'MED-1: % active MARQ membership(s) after an invite, expected exactly 1', v_count;
  END IF;

  SELECT r.key INTO v_key FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = v_fresh AND m.deleted_at IS NULL;
  IF v_key <> 'team_member' THEN
    RAISE EXCEPTION 'MED-1: the invited consultant holds %, expected team_member', v_key;
  END IF;

  -- The organization is the MARQ one, resolved inside the function. Nothing the
  -- caller passed could have named it.
  IF (v_result ->> 'organization_id')::UUID <> v_org THEN
    RAISE EXCEPTION 'the membership landed in organization %, not MARQ', v_result ->> 'organization_id';
  END IF;

  -- -----------------------------------------------------------------------
  -- A suspension is a decision. A role change does not reverse it.
  -- -----------------------------------------------------------------------
  PERFORM public.marq_sync_team_membership(v_suspended, 'owner');
  SELECT status INTO v_status FROM public.organization_memberships
  WHERE organization_id = v_org AND user_id = v_suspended AND deleted_at IS NULL;
  IF v_status <> 'suspended' THEN
    RAISE EXCEPTION 'a role change reactivated a suspended membership (status is now %)', v_status;
  END IF;

  -- -----------------------------------------------------------------------
  -- Revocation, twice. The second one revokes nothing and still succeeds.
  -- -----------------------------------------------------------------------
  v_result := public.marq_revoke_team_membership(v_fresh);
  IF (v_result ->> 'revoked')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'revocation reported % rows, expected 1', v_result ->> 'revoked';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships
  WHERE user_id = v_fresh AND deleted_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'a revoked member still holds % live membership(s)', v_count;
  END IF;

  v_result := public.marq_revoke_team_membership(v_fresh);
  IF (v_result ->> 'revoked')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'a second revocation reported % rows, expected 0', v_result ->> 'revoked';
  END IF;

  -- -----------------------------------------------------------------------
  -- Refusals.
  -- -----------------------------------------------------------------------
  v_failed := false;
  BEGIN
    PERFORM public.marq_sync_team_membership(v_ghost, 'admin');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a membership was created for an id with no auth.users row';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.marq_sync_team_membership(v_gone, 'admin');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a membership was created for a deleted auth user';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.marq_sync_team_membership(NULL, 'admin');
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a NULL user id was accepted';
  END IF;

  -- -----------------------------------------------------------------------
  -- H. `platform_admin` cannot be minted by this lifecycle, whatever is asked
  -- for. Every team role, and a literal attempt to name the role itself.
  -- -----------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count
  FROM unnest(cortex.team_roles() || ARRAY['platform_admin', 'superadmin', 'platform_role', '']) AS role
  WHERE cortex.organization_role_for_team_role(role) = 'platform_admin';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'the role mapping can emit platform_admin';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  JOIN cortex.membership_lifecycle_log l ON l.membership_id = m.id
  WHERE r.key = 'platform_admin';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'the lifecycle wrote a platform_admin membership';
  END IF;

  -- -----------------------------------------------------------------------
  -- Provenance: every operation above is on the record.
  -- -----------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count FROM cortex.membership_lifecycle_log
  WHERE user_id = v_owner AND operation = 'sync';
  -- Three: the demotion, the repeat that changed nothing, and the promotion.
  -- An `unchanged` sync is recorded too — "somebody asked" is a fact worth
  -- keeping, and a ledger that only records changes cannot answer who tried.
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'the lifecycle ledger holds % sync record(s) for the owner, expected 3', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM cortex.membership_lifecycle_log
  WHERE user_id = v_fresh AND operation = 'revoke';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'the lifecycle ledger holds % revoke record(s) for the new hire, expected 2', v_count;
  END IF;

  RAISE NOTICE 'assert_lifecycle: PASSED';
END $$;
