-- ============================================================================
-- A2-P07 — what the agent rollback removed, and what it must not have touched.
--
-- The agent tables were added BESIDE the key-value agent stores and migrated
-- nothing, so a rollback that took the key-value store, its compare-and-swap,
-- the BP-003 workflow persistence (including ITS checkpoint trigger function),
-- the durable runtime or the tenancy foundation would destroy live state to
-- undo a phase that moved none.
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM pg_tables
   WHERE schemaname = 'public' AND tablename IN ('agent_runs', 'agent_checkpoints', 'agent_approvals');
  IF v_count <> 0 THEN RAISE EXCEPTION '% agent tables survived the rollback', v_count; END IF;
  RAISE NOTICE '  ok  all three agent persistence tables are gone';

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('agent_run_create', 'agent_run_save', 'agent_run_load', 'agent_run_list',
                       'agent_checkpoint_append', 'agent_checkpoint_read', 'agent_checkpoint_latest',
                       'agent_checkpoint_history', 'agent_approval_create', 'agent_approval_save',
                       'agent_approval_load', 'agent_approval_list');
  IF v_count <> 0 THEN RAISE EXCEPTION '% agent functions survived the rollback', v_count; END IF;
  RAISE NOTICE '  ok  all twelve agent persistence functions are gone';

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'cortex' AND p.proname = 'refuse_agent_checkpoint_mutation';
  IF v_count <> 0 THEN RAISE EXCEPTION 'the agent append-only trigger function survived'; END IF;
  RAISE NOTICE '  ok  the agent append-only trigger function is gone';

  -- ── AND THE NEIGHBOURS ARE UNTOUCHED ────────────────────────────────────
  SELECT count(*) INTO v_count FROM pg_tables
   WHERE schemaname = 'public' AND tablename IN ('workflow_runs', 'workflow_checkpoints', 'workflow_approvals');
  IF v_count <> 3 THEN RAISE EXCEPTION 'the agent rollback took BP-003 workflow tables (% of 3 left)', v_count; END IF;

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'cortex' AND p.proname = 'refuse_checkpoint_mutation';
  IF v_count <> 1 THEN RAISE EXCEPTION 'the agent rollback took the WORKFLOW checkpoint trigger function'; END IF;

  SELECT count(*) INTO v_count FROM pg_trigger WHERE tgname = 'workflow_checkpoints_append_only';
  IF v_count <> 1 THEN RAISE EXCEPTION 'the workflow checkpoint trigger is gone'; END IF;

  SELECT count(*) INTO v_count FROM pg_tables WHERE schemaname = 'public' AND tablename = 'kv_store_324f4fbe';
  IF v_count <> 1 THEN RAISE EXCEPTION 'THE KEY-VALUE STORE IS GONE — the rollback took live agent state'; END IF;

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'kv_compare_and_swap_field';
  IF v_count <> 1 THEN RAISE EXCEPTION 'kv_compare_and_swap_field is gone'; END IF;

  SELECT count(*) INTO v_count FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'durable\_%';
  IF v_count <> 5 THEN RAISE EXCEPTION 'the durable runtime did not survive (% tables)', v_count; END IF;

  SELECT count(*) INTO v_count FROM pg_tables WHERE schemaname = 'public'
     AND tablename IN ('organizations', 'organization_memberships', 'permissions', 'roles');
  IF v_count <> 4 THEN RAISE EXCEPTION 'the tenancy foundation did not survive the rollback'; END IF;

  RAISE NOTICE '  ok  workflow persistence (and its trigger), KV, compare-and-swap, durable runtime and tenancy are intact';
END
$$;
