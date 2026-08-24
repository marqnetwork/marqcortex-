-- ---------------------------------------------------------------------------
-- ROLLBACK — AI-01 BATCH 4A LOW-A (20260821120000_marq_provenance_rls_band)
--
-- Restores the two membership policies to the bodies 20260711050001 defined and
-- removes the band predicate. It touches NO membership row: the forward
-- migration changed none, so the reverse has none to put back.
--
-- WHAT ROLLING THIS BACK COSTS. The `team_role` column, the table CHECK on its
-- vocabulary, and `marq_sync_team_membership`'s refusal to record provenance
-- that does not map to its key all survive — they belong to 20260820120000,
-- not to this migration. What is given up is the RLS half: a direct
-- `authenticated` write, if a deployment ever grants one, could again set
-- provenance that disagrees with the row's key. The server still clamps such a
-- row to the key's ceiling and floors it against the trusted `app_metadata`
-- half, so it cannot read above the account's entitlement either way.
--
-- ORDERING. Roll this back BEFORE, or together with, 20260820120000 — never
-- after. This migration's policies reference `cortex.team_role_matches_role`,
-- which references `team_role`; dropping the column first would leave the
-- policies referencing a column that no longer exists.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. THE POLICIES, AS 20260711050001 WROTE THEM
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS memberships_insert_admin ON public.organization_memberships;
CREATE POLICY memberships_insert_admin ON public.organization_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    cortex.is_organization_admin(organization_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_id AND r.key = 'platform_admin'
    )
  );

DROP POLICY IF EXISTS memberships_update_admin ON public.organization_memberships;
CREATE POLICY memberships_update_admin ON public.organization_memberships
  FOR UPDATE TO authenticated
  USING (cortex.is_organization_admin(organization_id))
  WITH CHECK (
    cortex.is_organization_admin(organization_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_id AND r.key = 'platform_admin'
    )
    AND (
      user_id <> auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = role_id AND r.key IN ('team_member', 'team_viewer')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. THE BAND PREDICATE
--
-- Dropped only after both policies have stopped referencing it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS cortex.team_role_matches_role(TEXT, UUID);

-- ---------------------------------------------------------------------------
-- 3. POST-CONDITIONS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cortex' AND p.proname = 'team_role_matches_role'
  ) THEN
    RAISE EXCEPTION 'provenance RLS band rollback: cortex.team_role_matches_role still exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = 'public.organization_memberships'::regclass
      AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%team_role_matches_role%'
  ) THEN
    RAISE EXCEPTION 'provenance RLS band rollback: a policy still references the band predicate';
  END IF;

  -- The rollback must leave the tenant boundary exactly as it found it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.organization_memberships'::regclass
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'provenance RLS band rollback: row level security is no longer enabled and forced';
  END IF;

  IF (SELECT COUNT(*) FROM pg_policy WHERE polrelid = 'public.organization_memberships'::regclass) <> 4 THEN
    RAISE EXCEPTION 'provenance RLS band rollback: expected the four original membership policies';
  END IF;

  RAISE NOTICE 'provenance RLS band rollback: applied';
END $$;

COMMIT;
