-- ============================================================================
-- BP-002 — what the rollback removed, and what it must not have touched.
--
-- A rollback that takes live state with it is worse than one that fails.
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM pg_tables
   WHERE schemaname = 'public' AND tablename LIKE 'durable\_%';
  IF v_count <> 0 THEN RAISE EXCEPTION '% durable tables survived the rollback', v_count; END IF;
  RAISE NOTICE '  ok  all five durable tables are gone';

  SELECT count(*) INTO v_count FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'durable\_%';
  IF v_count <> 0 THEN RAISE EXCEPTION '% durable functions survived the rollback', v_count; END IF;
  RAISE NOTICE '  ok  all twelve durable functions are gone';

  SELECT count(*) INTO v_count FROM public.permissions
   WHERE key IN ('runtime.read', 'runtime.operate');
  IF v_count <> 0 THEN RAISE EXCEPTION 'the runtime permission keys survived'; END IF;
  RAISE NOTICE '  ok  the two runtime permission keys and their grants are gone';

  -- AND THE FOUNDATION IS INTACT. The durable runtime was additive; rolling it
  -- back must not take the tenancy foundation, its permissions or its
  -- organizations with it.
  SELECT count(*) INTO v_count FROM public.organizations;
  IF v_count = 0 THEN RAISE EXCEPTION 'the rollback removed the organizations'; END IF;
  SELECT count(*) INTO v_count FROM public.permissions;
  IF v_count = 0 THEN RAISE EXCEPTION 'the rollback removed the permission catalog'; END IF;
  IF to_regclass('public.kv_store_324f4fbe') IS NULL THEN
    RAISE EXCEPTION 'the rollback removed the key-value store';
  END IF;
  RAISE NOTICE '  ok  the tenancy foundation, its permissions and the KV store are intact';
END
$$;
