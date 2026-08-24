-- ---------------------------------------------------------------------------
-- ASSERT — LOW-A: a membership write may not forge provenance
--
-- Runs after 20260821120000_marq_provenance_rls_band.sql.
--
-- The questions a static reader cannot answer, asked of the real database:
--
--   L-A1  the band predicate exists, and answers correctly for every
--         (team_role, key) pair the platform can produce
--   L-A2  both policies carry it
--   L-A3  a DIRECT write of unbanded provenance is refused — proved as
--         `authenticated`, through RLS, which is the path the finding names
--   L-A4  a BANDED write through the same path is accepted, so the lock is a
--         band and not a ban
--   L-A5  the vocabulary constraint still refuses a name off the ladder,
--         including the platform names
--   L-A6  `marq_sync_team_membership` still works — the authoritative writer
--         must not be caught by a lock aimed at direct writes
--   L-A7  RLS is still enabled AND forced, and the policy count is unchanged
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org      UUID;
  v_user     UUID;
  v_member   UUID;  -- role_id of team_member
  v_admin    UUID;  -- role_id of org_admin
  v_viewer   UUID;  -- role_id of team_viewer
  v_row      UUID;
  v_failed   BOOLEAN;
  v_count    INTEGER;
BEGIN
  v_org    := cortex.marq_organization_id_strict();
  v_member := cortex.system_role_id('team_member');
  v_admin  := cortex.system_role_id('org_admin');
  v_viewer := cortex.system_role_id('team_viewer');

  -- -------------------------------------------------------------------------
  -- L-A1. The predicate answers correctly across the whole mapping.
  -- -------------------------------------------------------------------------
  IF NOT cortex.team_role_matches_role('reviewer',   v_member) THEN
    RAISE EXCEPTION 'L-A1: reviewer should band to team_member';
  END IF;
  IF NOT cortex.team_role_matches_role('analyst',    v_member) THEN
    RAISE EXCEPTION 'L-A1: analyst should band to team_member';
  END IF;
  IF NOT cortex.team_role_matches_role('consultant', v_member) THEN
    RAISE EXCEPTION 'L-A1: consultant should band to team_member';
  END IF;
  IF NOT cortex.team_role_matches_role('admin',      v_admin)  THEN
    RAISE EXCEPTION 'L-A1: admin should band to org_admin';
  END IF;
  IF NOT cortex.team_role_matches_role('owner',      v_admin)  THEN
    RAISE EXCEPTION 'L-A1: owner should band to org_admin';
  END IF;
  IF NOT cortex.team_role_matches_role('viewer',     v_viewer) THEN
    RAISE EXCEPTION 'L-A1: viewer should band to team_viewer';
  END IF;
  -- NULL means "nothing is known" and is always valid.
  IF NOT cortex.team_role_matches_role(NULL, v_member) THEN
    RAISE EXCEPTION 'L-A1: NULL provenance must remain valid';
  END IF;
  -- The escalations the finding is about.
  IF cortex.team_role_matches_role('owner',  v_member) THEN
    RAISE EXCEPTION 'L-A1: owner must NOT band to team_member';
  END IF;
  IF cortex.team_role_matches_role('admin',  v_member) THEN
    RAISE EXCEPTION 'L-A1: admin must NOT band to team_member';
  END IF;
  IF cortex.team_role_matches_role('owner',  v_viewer) THEN
    RAISE EXCEPTION 'L-A1: owner must NOT band to team_viewer';
  END IF;
  IF cortex.team_role_matches_role('analyst', v_admin) THEN
    RAISE EXCEPTION 'L-A1: analyst must NOT band to org_admin';
  END IF;

  -- -------------------------------------------------------------------------
  -- L-A2. Both policies carry the predicate.
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = 'public.organization_memberships'::regclass
      AND p.polname = 'memberships_update_admin'
      AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%team_role_matches_role%'
  ) THEN
    RAISE EXCEPTION 'L-A2: memberships_update_admin does not constrain team_role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = 'public.organization_memberships'::regclass
      AND p.polname = 'memberships_insert_admin'
      AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%team_role_matches_role%'
  ) THEN
    RAISE EXCEPTION 'L-A2: memberships_insert_admin does not constrain team_role';
  END IF;

  -- -------------------------------------------------------------------------
  -- L-A5. The vocabulary constraint still refuses a name off the ladder.
  --
  -- Checked as the owner, which RLS does not apply to, so this proves the TABLE
  -- constraint rather than the policy.
  -- -------------------------------------------------------------------------
  SELECT m.id INTO v_row
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.role_id = v_member AND m.deleted_at IS NULL
  LIMIT 1;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'L-A5: the fixture holds no live team_member row to test against';
  END IF;

  FOR v_failed IN
    SELECT TRUE
  LOOP
    BEGIN
      UPDATE public.organization_memberships SET team_role = 'platform_admin' WHERE id = v_row;
      RAISE EXCEPTION 'L-A5: team_role = platform_admin was accepted';
    EXCEPTION
      WHEN check_violation THEN NULL;  -- expected
    END;

    BEGIN
      UPDATE public.organization_memberships SET team_role = 'super_admin' WHERE id = v_row;
      RAISE EXCEPTION 'L-A5: team_role = super_admin was accepted';
    EXCEPTION
      WHEN check_violation THEN NULL;  -- expected
    END;

    BEGIN
      UPDATE public.organization_memberships SET team_role = 'wizard' WHERE id = v_row;
      RAISE EXCEPTION 'L-A5: team_role = wizard was accepted';
    EXCEPTION
      WHEN check_violation THEN NULL;  -- expected
    END;
    EXIT;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- L-A6. The authoritative writer is unaffected.
  -- -------------------------------------------------------------------------
  SELECT m.user_id INTO v_user
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.deleted_at IS NULL AND m.role_id = v_member
  LIMIT 1;

  PERFORM public.marq_sync_team_membership(v_user, 'consultant', NULL);
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.user_id = v_user AND m.organization_id = v_org AND m.deleted_at IS NULL
      AND m.team_role = 'consultant' AND r.key = 'team_member'
  ) THEN
    RAISE EXCEPTION 'L-A6: marq_sync_team_membership could not record banded provenance';
  END IF;

  PERFORM public.marq_sync_team_membership(v_user, 'owner', NULL);
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.user_id = v_user AND m.organization_id = v_org AND m.deleted_at IS NULL
      AND m.team_role = 'owner' AND r.key = 'org_admin'
  ) THEN
    RAISE EXCEPTION 'L-A6: marq_sync_team_membership could not move both halves together';
  END IF;

  -- Put it back so later assertions see the fixture they expect.
  PERFORM public.marq_sync_team_membership(v_user, 'reviewer', NULL);

  -- -------------------------------------------------------------------------
  -- L-A7. The tenant boundary is unchanged.
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.organization_memberships'::regclass
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'L-A7: row level security is no longer enabled and forced';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_policy WHERE polrelid = 'public.organization_memberships'::regclass;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'L-A7: expected 4 membership policies, found %', v_count;
  END IF;

  -- No write grant may have been widened to reach the table directly.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_name = 'organization_memberships'
    AND grantee IN ('authenticated', 'anon')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'L-A7: a browser role holds % write grant(s) on organization_memberships', v_count;
  END IF;

  RAISE NOTICE 'assert_provenance_rls_band: PASSED';
END $$;

-- ---------------------------------------------------------------------------
-- L-A3 / L-A4 — THE POLICY PATH, AS `authenticated`
--
-- Run outside the DO block because they need a role change, and proved against
-- a real grant: the harness grants UPDATE to `authenticated` for the duration
-- of this file precisely because production does not, so the policy would
-- otherwise be unreachable and untested. The grant is revoked before the file
-- ends, and L-A7 above has already recorded that production holds none.
-- ---------------------------------------------------------------------------
GRANT SELECT, UPDATE ON public.organization_memberships TO authenticated;
-- The policies' own subqueries read `public.roles`, and so does the band
-- predicate. Without this the policy path fails for want of a read grant rather
-- than for the reason under test, which would make L-A3 pass vacuously.
GRANT SELECT ON public.roles TO authenticated;

DO $$
DECLARE
  v_org    UUID;
  v_admin  UUID;
  v_target UUID;
  v_row    UUID;
BEGIN
  v_org   := cortex.marq_organization_id_strict();
  v_admin := cortex.system_role_id('org_admin');

  -- An organization administrator, and somebody else's row for them to edit.
  SELECT m.user_id INTO v_admin
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.role_id = cortex.system_role_id('org_admin')
    AND m.deleted_at IS NULL AND m.status = 'active'
  LIMIT 1;

  SELECT m.id, m.user_id INTO v_row, v_target
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.role_id = cortex.system_role_id('team_member')
    AND m.deleted_at IS NULL AND m.user_id <> v_admin
  LIMIT 1;

  IF v_row IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'L-A3: the fixture does not provide an admin and a separate team_member row';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::TEXT, TRUE);
  PERFORM set_config('role', 'authenticated', TRUE);

  SET LOCAL ROLE authenticated;

  -- L-A3. Forging provenance above the row's own key must be refused.
  -- The refusal must come from the POLICY or the CHECK, never from a missing
  -- grant: a write that fails because `authenticated` cannot read `roles` would
  -- pass this assertion while proving nothing.
  BEGIN
    UPDATE public.organization_memberships SET team_role = 'owner' WHERE id = v_row;
    RESET ROLE;
    RAISE EXCEPTION 'L-A3: an administrator forged team_role = owner onto a team_member row';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM LIKE '%permission denied%' THEN
        RESET ROLE;
        RAISE EXCEPTION 'L-A3: refused for the WRONG reason (a missing grant, not the policy): %', SQLERRM;
      END IF;
      NULL;  -- row-level security policy violation: expected
    WHEN check_violation THEN NULL;  -- table constraint refused: also correct
  END;

  -- L-A4. A BANDED value through the same path is accepted, so this is a band
  -- and not a ban.
  BEGIN
    UPDATE public.organization_memberships SET team_role = 'analyst' WHERE id = v_row;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE EXCEPTION 'L-A4: a banded provenance write was refused: %', SQLERRM;
  END;

  RESET ROLE;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships WHERE id = v_row AND team_role = 'analyst'
  ) THEN
    RAISE EXCEPTION 'L-A4: the banded write did not land';
  END IF;

  RAISE NOTICE 'assert_provenance_rls_band: PASSED (policy path, L-A3 refused / L-A4 accepted)';
END $$;

REVOKE SELECT, UPDATE ON public.organization_memberships FROM authenticated;
REVOKE SELECT ON public.roles FROM authenticated;
