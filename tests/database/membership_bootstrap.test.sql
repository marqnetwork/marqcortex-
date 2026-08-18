-- ============================================================================
-- AI-01 Batch 4A — Membership bootstrap live invariants
--
-- Run against a database that already has migration
-- 20260818120000_marq_team_membership_bootstrap.sql applied.
--
-- WHAT THIS FILE IS, AND WHAT IT IS NOT
--
-- It creates NO auth users. It cannot: inventing an `auth.users` id is exactly
-- what the migration is forbidden to do. So every assertion is an INVARIANT over
-- whatever real users the database already holds, which is also what makes it
-- safe to point at staging.
--
-- That is a real limitation, and it is why it is not the main evidence any more.
-- On a database with no eligible users this file asserts a set of true things
-- about nothing — the review's M4 finding. The scenarios that need specific
-- users, specific pre-existing memberships and a rollback live in
-- `scripts/membership-bootstrap-scenarios.mjs`, which builds its own database
-- with its own fixture and runs the real migration files against it.
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
  v_ledger_bad  INTEGER;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = 'marq' AND deleted_at IS NULL
  LIMIT 1;

  ASSERT v_org_id IS NOT NULL, 'MARQ organization is not seeded';

  -- 0. Say out loud how much this run is actually covering. A green result over
  --    zero eligible users is not evidence, and the notice is what stops it
  --    being read as if it were.
  SELECT COUNT(*) INTO v_eligible
  FROM auth.users u
  WHERE (u.raw_app_meta_data ->> 'marq_team') = 'true'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(u) ->> 'banned_until') IS NULL
      OR (to_jsonb(u) ->> 'banned_until')::timestamptz <= now()
    );

  IF v_eligible = 0 THEN
    RAISE WARNING 'membership_bootstrap.test.sql: no eligible user on this database — the checks below hold vacuously. Run scripts/membership-bootstrap-scenarios.mjs for the fixture-backed scenarios.';
  END IF;

  -- 1. Every eligible user either holds a membership or has a membership
  --    history that deliberately excludes them (removed, suspended, invited).
  SELECT COUNT(*) INTO v_covered
  FROM auth.users u
  WHERE (u.raw_app_meta_data ->> 'marq_team') = 'true'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(u) ->> 'banned_until') IS NULL
      OR (to_jsonb(u) ->> 'banned_until')::timestamptz <= now()
    )
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = v_org_id
        AND m.user_id = u.id
    );

  ASSERT v_eligible = v_covered,
    format('%s eligible user(s) hold no membership row at all', v_eligible - v_covered);

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

  -- 3. Re-running the bootstrap insert changes nothing. The predicate below is
  --    the migration's, including its guard on ANY existing row.
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
    ON r.key = CASE lower(trim(COALESCE(u.raw_app_meta_data ->> 'team_role', '')))
        WHEN 'owner'      THEN 'org_admin'
        WHEN 'admin'      THEN 'org_admin'
        WHEN 'consultant' THEN 'team_member'
        WHEN 'analyst'    THEN 'team_member'
        WHEN 'reviewer'   THEN 'team_member'
        WHEN 'viewer'     THEN 'team_viewer'
        ELSE 'team_viewer'
      END
   AND r.scope = 'platform'
   AND r.is_system = true
   AND r.organization_id IS NULL
  WHERE (u.raw_app_meta_data ->> 'marq_team') = 'true'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(u) ->> 'banned_until') IS NULL
      OR (to_jsonb(u) ->> 'banned_until')::timestamptz <= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = v_org_id
        AND m.user_id = u.id
    );

  GET DIAGNOSTICS v_reinserted = ROW_COUNT;
  ASSERT v_reinserted = 0, format('Re-running the bootstrap inserted %s row(s)', v_reinserted);

  -- 4. The bootstrap minted no platform administrators.
  SELECT COUNT(*) INTO v_platform
  FROM cortex.membership_bootstrap_log l
  JOIN public.roles r ON r.id = l.role_id
  WHERE r.key = 'platform_admin';

  ASSERT v_platform = 0, format('%s bootstrap membership(s) carry platform_admin', v_platform);

  -- 5. Every membership resolves to a role in the seeded system catalog.
  SELECT COUNT(*) INTO v_nonsystem
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org_id
    AND m.deleted_at IS NULL
    AND (r.is_system IS DISTINCT FROM true OR r.organization_id IS NOT NULL OR r.scope <> 'platform');

  ASSERT v_nonsystem = 0, format('%s membership(s) carry a non-system role', v_nonsystem);

  -- 6. Every ledger row names a membership that exists. A dangling claim would
  --    be a rollback pointed at nothing, or at somebody else's row.
  SELECT COUNT(*) INTO v_ledger_bad
  FROM cortex.membership_bootstrap_log l
  LEFT JOIN public.organization_memberships m ON m.id = l.membership_id
  WHERE m.id IS NULL;

  ASSERT v_ledger_bad = 0, format('%s ledger row(s) name a membership that does not exist', v_ledger_bad);

  -- 7. Bootstrap-created memberships that nobody has touched still agree with
  --    the documented mapping. An administrator may legitimately re-role
  --    somebody afterwards, so a mismatch is REPORTED rather than asserted —
  --    the failure this catches is a mapping that never applied, not a
  --    deliberate change. "Untouched" is read from the ledger, not guessed from
  --    a timestamp.
  SELECT COUNT(*) INTO v_mismatched
  FROM cortex.membership_bootstrap_log l
  JOIN public.organization_memberships m ON m.id = l.membership_id
  JOIN public.roles r ON r.id = m.role_id
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.updated_at = l.row_updated_at
    AND m.role_id = l.role_id
    AND r.key <> CASE lower(trim(COALESCE(u.raw_app_meta_data ->> 'team_role', '')))
        WHEN 'owner'      THEN 'org_admin'
        WHEN 'admin'      THEN 'org_admin'
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
