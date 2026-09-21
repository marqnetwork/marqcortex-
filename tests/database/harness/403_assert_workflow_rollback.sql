-- ============================================================================
-- BP-003 — what the rollback removed, and what it must not have touched.
--
-- The second half is the one that matters. BP-003 added a SQL implementation
-- BESIDE the existing workflow persistence and migrated nothing, so a rollback
-- that took the key-value store, the compare-and-swap function, the tenancy
-- foundation or the durable runtime with it would destroy live state to undo a
-- packet that moved none.
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename IN ('workflow_runs', 'workflow_checkpoints', 'workflow_approvals');
  IF v_count <> 0 THEN RAISE EXCEPTION '% BP-003 tables survived the rollback', v_count; END IF;
  RAISE NOTICE '  ok  all three workflow persistence tables are gone';

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'workflow\_%';
  IF v_count <> 0 THEN RAISE EXCEPTION '% BP-003 functions survived the rollback', v_count; END IF;
  RAISE NOTICE '  ok  all twelve workflow persistence functions are gone';

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'cortex' AND p.proname = 'refuse_checkpoint_mutation';
  IF v_count <> 0 THEN RAISE EXCEPTION 'the append-only trigger function survived the rollback'; END IF;
  RAISE NOTICE '  ok  the append-only trigger function is gone';

  -- ── AND IT REMOVED NOTHING IT DID NOT CREATE ────────────────────────────
  --
  -- An earlier draft of the rollback deleted the permission keys
  -- `workflows.read` and `workflows.operate` and their role grants. The
  -- forward migration created those with `WHERE NOT EXISTS`, so a row with
  -- that key may have been there first — and a rollback cannot tell the two
  -- apart. The fixture seeds all three of these as PRE-EXISTING rows, which is
  -- exactly the case the draft could not distinguish from its own.
  SELECT count(*) INTO v_count
    FROM public.permissions
   WHERE key IN ('bp003.sentinel.unrelated', 'workflows.read', 'workflows.operate');
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'the rollback deleted pre-existing permissions: % of 3 survived', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
   WHERE p.key = 'bp003.sentinel.unrelated';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'the rollback deleted a role grant on a pre-existing permission';
  END IF;
  RAISE NOTICE '  ok  every pre-existing permission and role grant survived the rollback';

  -- No policy can be left behind either, since none was created.
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('workflow_runs', 'workflow_checkpoints', 'workflow_approvals');
  IF v_count <> 0 THEN RAISE EXCEPTION '% workflow policies survived the rollback', v_count; END IF;

  -- ── AND THE EXISTING AUTHORITY IS UNTOUCHED ──────────────────────────────
  SELECT count(*) INTO v_count
    FROM pg_tables WHERE schemaname = 'public' AND tablename = 'kv_store_324f4fbe';
  IF v_count <> 1 THEN RAISE EXCEPTION 'THE KEY-VALUE STORE IS GONE — the rollback took live workflow state'; END IF;

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'kv_compare_and_swap_field';
  IF v_count <> 1 THEN RAISE EXCEPTION 'kv_compare_and_swap_field is gone — every existing store lost its concurrency primitive'; END IF;

  SELECT count(*) INTO v_count
    FROM pg_tables WHERE schemaname = 'public'
     AND tablename IN ('organizations', 'organization_memberships', 'permissions', 'roles');
  IF v_count <> 4 THEN RAISE EXCEPTION 'the tenancy foundation did not survive the rollback'; END IF;

  SELECT count(*) INTO v_count
    FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'durable\_%';
  IF v_count <> 5 THEN RAISE EXCEPTION 'the BP-002 durable runtime did not survive the rollback (% tables)', v_count; END IF;

  RAISE NOTICE '  ok  the KV store, its compare-and-swap, the tenancy foundation and the durable runtime are intact';
END
$$;
