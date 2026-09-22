-- ============================================================================
-- A2-P07 — AGENT RUNTIME PERSISTENCE: ISOLATION AND PRIVILEGE
--
-- THESE THREE TABLES HAVE NO CLIENT-FACING READ PATH. The position and the
-- reasons are BP-003's (`20260921120001`), and they apply with more force
-- here: an `agent_runs.record` carries a pending action's validated input and
-- an `agent_checkpoints.record` carries the run's progress snapshot, including
-- the objective and input it was started with. The agent SERVICE is, and
-- remains, the authorization surface for agent state; a second read path
-- straight to the rows would be an API decision arriving inside a persistence
-- change.
--
-- So: RLS enabled and FORCED, no policy at all (deny by default for every role
-- without BYPASSRLS), nothing granted to `anon` or `authenticated`, and the
-- runtime reaches the rows only as `service_role` through the SECURITY DEFINER
-- functions in `20260922120002`, each of which scopes every predicate by
-- `p_organization_id` in its own body.
--
-- NO PERMISSION KEYS ARE MINTED, so the rollback has none to delete.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'agent_runs',
    'agent_checkpoints',
    'agent_approvals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);

    -- NO POLICY IS CREATED.

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v_table);

    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END
$$;

COMMIT;
