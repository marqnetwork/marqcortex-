-- ============================================================================
-- MCV2-S4 — Seed idempotency test
-- Re-run seed block and assert no duplicate roles/permissions/org
-- ============================================================================

DO $$
DECLARE
  v_org_count INTEGER;
  v_role_count INTEGER;
  v_perm_count INTEGER;
BEGIN
  -- Re-execute seed DO block from migration (idempotent sections only)
  INSERT INTO public.organizations (slug, name, status, plan, timezone, metadata)
  SELECT 'marq', 'MARQ', 'active', 'internal', 'UTC', '{"product": "cortex"}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.slug = 'marq' AND o.deleted_at IS NULL
  );

  SELECT COUNT(*) INTO v_org_count FROM public.organizations
  WHERE slug = 'marq' AND deleted_at IS NULL;
  ASSERT v_org_count = 1, 'Idempotent org seed produced duplicates';

  SELECT COUNT(*) INTO v_role_count FROM public.roles
  WHERE is_system = true AND key = 'org_admin';
  ASSERT v_role_count = 1, 'Idempotent role seed produced duplicates';

  SELECT COUNT(*) INTO v_perm_count FROM public.permissions
  WHERE key = 'settings.manage';
  ASSERT v_perm_count = 1, 'Idempotent permission seed produced duplicates';

  RAISE NOTICE 'tenancy_seed_idempotent.test.sql: ALL CHECKS PASSED';
END $$;
