-- ============================================================================
-- MCV2-S4 — Schema validation tests
-- Run after migrations. Expects all checks to pass (no failures raised).
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Tables exist
  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (
      'organizations', 'roles', 'permissions', 'role_permissions',
      'organization_memberships', 'organization_settings'
    )) = 6, 'Expected 6 public tenancy tables';

  -- cortex schema exists
  ASSERT (SELECT COUNT(*) FROM information_schema.schemata
    WHERE schema_name = 'cortex') = 1, 'cortex schema missing';

  -- Primary keys
  ASSERT (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND constraint_type = 'PRIMARY KEY') = 1, 'organizations PK missing';

  -- Foreign keys on memberships
  ASSERT (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'organization_memberships'
      AND constraint_type = 'FOREIGN KEY') >= 3,
    'organization_memberships FK count too low';

  -- Status constraint on organizations
  ASSERT (SELECT COUNT(*) FROM information_schema.check_constraints cc
    JOIN information_schema.constraint_column_usage ccu
      ON cc.constraint_name = ccu.constraint_name
    WHERE ccu.table_name = 'organizations' AND ccu.column_name = 'status') >= 1,
    'organizations status check missing';

  -- RLS enabled
  ASSERT (SELECT COUNT(*) FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'organizations' AND rowsecurity = true) = 1,
    'RLS not enabled on organizations';

  ASSERT (SELECT COUNT(*) FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'organization_memberships' AND rowsecurity = true) = 1,
    'RLS not enabled on organization_memberships';

  -- Helper functions
  ASSERT (SELECT COUNT(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cortex' AND p.proname = 'is_organization_member') = 1,
    'cortex.is_organization_member missing';

  -- Seed: MARQ org
  SELECT COUNT(*) INTO v_count FROM public.organizations
  WHERE slug = 'marq' AND deleted_at IS NULL;
  ASSERT v_count = 1, 'MARQ organization seed missing or duplicated';

  -- Seed: system roles
  SELECT COUNT(*) INTO v_count FROM public.roles
  WHERE is_system = true AND organization_id IS NULL
    AND key IN ('platform_admin', 'org_admin', 'team_member', 'team_viewer');
  ASSERT v_count = 4, 'Expected 4 system roles';

  -- Seed: permissions
  SELECT COUNT(*) INTO v_count FROM public.permissions;
  ASSERT v_count >= 6, 'Expected at least 6 permissions';

  RAISE NOTICE 'tenancy_schema.test.sql: ALL CHECKS PASSED';
END $$;
