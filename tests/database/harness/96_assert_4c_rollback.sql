-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4C: the rollback leaves no 4C schema state
--
-- Runs after rollbacks/20260828120000_rollback_ai_provider_administration.sql.
--
--   4C-B1  none of the three tables survives
--   4C-B2  the activation function does not survive
--   4C-B3  no index, constraint or comment belonging to 4C survives
--   4C-B4  nothing OUTSIDE 4C was taken with it — the tenancy foundation, the
--          seeded roles and the membership tables are all still there
--   4C-B5  the `cortex` schema itself survives, and so do the grants other
--          migrations made on it
--
-- 4C-B4 is the assertion that matters most. A rollback that removes its own
-- objects is ordinary; a rollback that quietly cascades into the tenancy model
-- is a data-loss incident, and the credential table's foreign key to
-- `ai_provider_configuration` is exactly the kind of edge a careless DROP
-- follows in the wrong direction.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_left TEXT;
BEGIN
  -- 4C-B1. The tables.
  SELECT string_agg(c.relname, ', ') INTO v_left
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'cortex' AND c.relname LIKE 'ai_provider%';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '4C-B1: 4C relations survived the rollback: %', v_left;
  END IF;

  -- 4C-B2. The function.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'cortex' AND p.proname = 'ai_provider_credential_activate'
  ) THEN
    RAISE EXCEPTION '4C-B2: the activation function survived the rollback';
  END IF;

  -- 4C-B3. Indexes and constraints go with their tables; assert it rather than
  -- assume it, because a leftover index name blocks a re-apply.
  SELECT string_agg(indexname, ', ') INTO v_left
    FROM pg_indexes WHERE schemaname = 'cortex' AND indexname LIKE 'ai_provider%';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '4C-B3: 4C indexes survived the rollback: %', v_left;
  END IF;

  SELECT string_agg(con.conname, ', ') INTO v_left
    FROM pg_constraint con
    LEFT JOIN pg_class c ON c.oid = con.conrelid
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE con.conname LIKE 'ai_provider%';
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '4C-B3: 4C constraints survived the rollback: %', v_left;
  END IF;

  -- 4C-B4. And nothing else went with them.
  IF NOT EXISTS (SELECT 1 FROM public.organizations) THEN
    RAISE EXCEPTION '4C-B4: the rollback took the organizations with it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles) THEN
    RAISE EXCEPTION '4C-B4: the rollback took the seeded role catalogue with it';
  END IF;
  FOR v_left IN
    SELECT unnest(ARRAY[
      'organizations', 'roles', 'permissions', 'role_permissions',
      'organization_memberships', 'organization_settings'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = v_left
    ) THEN
      RAISE EXCEPTION '4C-B4: the rollback dropped public.%', v_left;
    END IF;
  END LOOP;

  -- 4C-B5. The schema and the grants that were not 4C's to remove.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cortex') THEN
    RAISE EXCEPTION '4C-B5: the rollback dropped the cortex schema';
  END IF;
  IF NOT has_schema_privilege('service_role', 'cortex', 'USAGE') THEN
    RAISE EXCEPTION '4C-B5: the rollback removed service_role USAGE on cortex';
  END IF;
  IF NOT has_schema_privilege('authenticated', 'cortex', 'USAGE') THEN
    RAISE EXCEPTION '4C-B5: the rollback removed authenticated USAGE on cortex';
  END IF;

  RAISE NOTICE 'assert_4c_rollback: PASSED (4C removed cleanly, nothing else touched)';
END $$;
