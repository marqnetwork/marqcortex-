-- ============================================================================
-- MCV2-S4 — RLS policy validation tests
-- Requires: migrations applied. Uses service_role context (postgres superuser
-- or service role bypasses RLS). Validates policy objects exist.
-- Live cross-tenant denial tests require two test JWT users — see README.
-- ============================================================================

DO $$
DECLARE
  v_policy_count INTEGER;
BEGIN
  -- organizations policies
  SELECT COUNT(*) INTO v_policy_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'organizations';
  ASSERT v_policy_count >= 3, 'organizations: expected at least 3 policies';

  -- memberships policies
  SELECT COUNT(*) INTO v_policy_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'organization_memberships';
  ASSERT v_policy_count >= 4, 'organization_memberships: expected at least 4 policies';

  -- settings policies
  SELECT COUNT(*) INTO v_policy_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'organization_settings';
  ASSERT v_policy_count >= 3, 'organization_settings: expected at least 3 policies';

  -- roles read policy for authenticated
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'roles'
      AND policyname = 'roles_select_authenticated'
  ), 'roles_select_authenticated policy missing';

  -- platform-only modify on permissions
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'permissions'
      AND policyname = 'permissions_modify_platform'
  ), 'permissions_modify_platform policy missing';

  -- Helper grants: authenticated can execute membership check
  ASSERT has_function_privilege('authenticated', 'cortex.is_organization_member(uuid)', 'EXECUTE'),
    'authenticated missing EXECUTE on cortex.is_organization_member';

  RAISE NOTICE 'tenancy_rls.test.sql: POLICY STRUCTURE CHECKS PASSED';
  RAISE NOTICE 'NOTE: Cross-tenant JWT tests require manual setup with two Auth users.';
END $$;

-- ---------------------------------------------------------------------------
-- Cross-tenant denial template (run manually with SET request.jwt.claim.sub)
-- ---------------------------------------------------------------------------
-- SET LOCAL role authenticated;
-- SET LOCAL request.jwt.claim.sub = '<user_a_uuid>';
-- SELECT COUNT(*) FROM organizations WHERE slug = 'other_org';  -- expect 0
-- RESET role;
