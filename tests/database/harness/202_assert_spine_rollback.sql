-- ============================================================================
-- CP-3 — the rollback removed the spine and spared the foundation.
--
-- Both halves are asserted. A rollback that drops too much passes a
-- "the spine is gone" check just as well as a correct one does.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'business_units', 'departments', 'people', 'teams', 'team_memberships'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_table
    ) THEN
      RAISE EXCEPTION 'the rollback left public.% behind', v_table;
    END IF;
  END LOOP;
  RAISE NOTICE '  ok  all five spine tables are gone';
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.permissions
    WHERE key IN ('organization.structure.read', 'organization.structure.manage')
  ) THEN
    RAISE EXCEPTION 'the rollback left a permission granting authority over tables that no longer exist';
  END IF;
  RAISE NOTICE '  ok  the two CP-3 permission keys and their grants are gone';
END $$;

-- The foundation. This is the half that catches a rollback which over-reaches.
DO $$
DECLARE v_table TEXT; v_perms INT; v_orgs INT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'organizations', 'organization_memberships', 'organization_settings',
    'roles', 'permissions', 'role_permissions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_table
    ) THEN
      RAISE EXCEPTION 'THE ROLLBACK DROPPED public.% — it does not own that table', v_table;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_perms FROM public.permissions
  WHERE key IN ('members.read', 'members.manage', 'organization.read', 'organization.manage');
  IF v_perms <> 4 THEN
    RAISE EXCEPTION 'the rollback removed foundation permissions: % of 4 remain', v_perms;
  END IF;

  SELECT count(*) INTO v_orgs FROM public.organizations;
  IF v_orgs < 2 THEN
    RAISE EXCEPTION 'the rollback removed organizations: % remain', v_orgs;
  END IF;

  RAISE NOTICE '  ok  the 2026-07-11 foundation, its permissions and its organizations are intact';
END $$;
