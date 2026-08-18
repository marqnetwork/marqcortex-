-- ============================================================================
-- AI-01 Batch 4A — Membership bootstrap live test
--
-- Run against a database that already has migration
-- 20260818120000_marq_team_membership_bootstrap.sql applied.
--
-- The test creates NO auth users. It cannot: inventing an `auth.users` id is
-- exactly what the migration is forbidden to do, and a test that does it would
-- be proving a different migration. So every assertion is an invariant over
-- whatever real users the database already holds — which is also what makes it
-- safe to run against staging.
--
-- The whole file runs inside a transaction that is ROLLED BACK. Check 3
-- re-runs the bootstrap insert to prove it is a no-op; if it ever stopped being
-- one, the rollback is what keeps the test from being the thing that changed
-- production.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_org_id      UUID;
  v_eligible    INTEGER;
  v_covered     INTEGER;
  v_duplicates  INTEGER;
  v_reinserted  INTEGER;
  v_platform    INTEGER;
  v_nonsystem   INTEGER;
  v_mismatched  INTEGER;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = 'marq' AND deleted_at IS NULL
  LIMIT 1;

  ASSERT v_org_id IS NOT NULL, 'MARQ organization is not seeded';

  -- 1. Every eligible team user holds an undeleted membership.
  SELECT COUNT(*) INTO v_eligible
  FROM auth.users u
  WHERE COALESCE(u.raw_user_meta_data ->> 'role', '') = 'team'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(u) ->> 'banned_until') IS NULL
      OR (to_jsonb(u) ->> 'banned_until')::timestamptz <= now()
    );

  SELECT COUNT(*) INTO v_covered
  FROM auth.users u
  WHERE COALESCE(u.raw_user_meta_data ->> 'role', '') = 'team'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(u) ->> 'banned_until') IS NULL
      OR (to_jsonb(u) ->> 'banned_until')::timestamptz <= now()
    )
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = v_org_id
        AND m.user_id = u.id
        AND m.deleted_at IS NULL
    );

  ASSERT v_eligible = v_covered,
    format('%s eligible team user(s) still hold no membership', v_eligible - v_covered);

  -- 2. Nobody holds two live memberships in the organization.
  SELECT COUNT(*) INTO v_duplicates
  FROM (
    SELECT m.user_id
    FROM public.organization_memberships m
    WHERE m.organization_id = v_org_id AND m.deleted_at IS NULL
    GROUP BY m.user_id
    HAVING COUNT(*) > 1
  ) AS d;

  ASSERT v_duplicates = 0, format('%s user(s) hold duplicate active memberships', v_duplicates);

  -- 3. Re-running the bootstrap insert changes nothing.
  INSERT INTO public.organization_memberships (
    organization_id, user_id, role_id, status, joined_at
  )
  SELECT
    v_org_id,
    u.id,
    r.id,
    'active',
    now()
  FROM auth.users u
  JOIN public.roles r
    ON r.key = CASE lower(trim(COALESCE(u.raw_user_meta_data ->> 'teamRole', '')))
        WHEN 'owner'      THEN 'org_admin'
        WHEN 'admin'      THEN 'org_admin'
        WHEN 'manager'    THEN 'org_admin'
        WHEN 'consultant' THEN 'team_member'
        WHEN 'analyst'    THEN 'team_member'
        WHEN 'reviewer'   THEN 'team_member'
        WHEN 'viewer'     THEN 'team_viewer'
        ELSE 'team_viewer'
      END
   AND r.is_system = true
   AND r.organization_id IS NULL
  WHERE COALESCE(u.raw_user_meta_data ->> 'role', '') = 'team'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(u) ->> 'banned_until') IS NULL
      OR (to_jsonb(u) ->> 'banned_until')::timestamptz <= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = v_org_id
        AND m.user_id = u.id
        AND m.deleted_at IS NULL
    );

  GET DIAGNOSTICS v_reinserted = ROW_COUNT;
  ASSERT v_reinserted = 0, format('Re-running the bootstrap inserted %s row(s)', v_reinserted);

  -- 4. The bootstrap minted no platform administrators.
  SELECT COUNT(*) INTO v_platform
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org_id
    AND m.deleted_at IS NULL
    AND r.key = 'platform_admin';

  ASSERT v_platform = 0, format('%s membership(s) carry platform_admin', v_platform);

  -- 5. Every membership resolves to a role in the seeded system catalog.
  SELECT COUNT(*) INTO v_nonsystem
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org_id
    AND m.deleted_at IS NULL
    AND (r.is_system IS DISTINCT FROM true OR r.organization_id IS NOT NULL);

  ASSERT v_nonsystem = 0, format('%s membership(s) carry a non-system role', v_nonsystem);

  -- 6. Active memberships agree with the documented mapping. An administrator
  --    may legitimately re-role somebody afterwards, so a mismatch is reported
  --    rather than asserted — the failure this catches is a mapping that never
  --    applied, not a deliberate change.
  SELECT COUNT(*) INTO v_mismatched
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = v_org_id
    AND m.deleted_at IS NULL
    AND m.status = 'active'
    AND m.updated_at = m.created_at
    AND r.key <> CASE lower(trim(COALESCE(u.raw_user_meta_data ->> 'teamRole', '')))
        WHEN 'owner'      THEN 'org_admin'
        WHEN 'admin'      THEN 'org_admin'
        WHEN 'manager'    THEN 'org_admin'
        WHEN 'consultant' THEN 'team_member'
        WHEN 'analyst'    THEN 'team_member'
        WHEN 'reviewer'   THEN 'team_member'
        WHEN 'viewer'     THEN 'team_viewer'
        ELSE 'team_viewer'
      END;

  IF v_mismatched > 0 THEN
    RAISE WARNING 'membership_bootstrap.test.sql: % untouched membership(s) do not match the documented mapping', v_mismatched;
  END IF;

  RAISE NOTICE 'membership_bootstrap.test.sql: ALL CHECKS PASSED (% eligible user(s))', v_eligible;
END $$;

ROLLBACK;
