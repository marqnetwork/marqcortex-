-- ============================================================================
-- BP-003 / A2 — WORKFLOW RUNTIME PERSISTENCE: ISOLATION AND PRIVILEGE
--
-- THESE THREE TABLES HAVE NO CLIENT-FACING READ PATH, AND THAT IS THE WHOLE
-- OF THIS FILE.
--
-- ── WHY THERE IS NO POLICY HERE AT ALL ────────────────────────────────────
--
-- An earlier draft of this migration did what the durable runtime's RLS does:
-- minted two permission keys, copied role grants from the settings keys, and
-- gave `authenticated` a tenant-scoped SELECT policy on all three tables.
-- That was wrong for this packet, for two separate reasons.
--
--   IT IS NOT THIS PACKET'S DECISION TO MAKE. BP-003 replaces the storage
--   under three existing ports. The workflow SERVICE is, and remains, the
--   authorization surface for workflow state: it resolves the actor, applies
--   workflow RBAC and decides what a caller may see. Opening a second read
--   path straight to the rows — one the service does not mediate and whose
--   rules live in a different file — is an API design decision, and it would
--   have arrived inside a persistence-parity change nobody reviewed as an API
--   change.
--
--   THE ROWS ARE NOT SHAPED FOR IT. A `workflow_runs.record` is the whole run:
--   its plan binding, its step history, its transitions, its usage ledger and
--   its validated INPUT. `contracts/run.ts` argues that the input is the one
--   content field a run record may carry, and it is carried on the
--   understanding that the read models project it and never return it. A raw
--   SELECT on this table hands a browser the column the read models exist to
--   avoid handing it.
--
-- So: RLS is enabled and FORCED, `anon` and `authenticated` hold no privilege
-- on any of the three tables and no policy grants them any, and every read and
-- write goes through the runtime as `service_role`. With RLS forced and no
-- policy present, the tables deny by default — there is nothing to get the
-- predicate wrong in.
--
-- A future product requirement for direct database reads belongs in its own
-- reviewed API and security packet, which can add the keys, the policies and
-- the projection it decides on. Nothing here has to be undone first.
--
-- ── WHAT `FORCE` IS FOR, AND WHY THE FUNCTIONS STILL WORK ─────────────────
--
-- FORCE, so the table owner is not silently exempt. Without it a migration or
-- a psql session as the owner reads every tenant's rows, and the isolation
-- this file claims would hold for everybody except the one connection most
-- likely to be used to check it.
--
-- The SECURITY DEFINER functions in `20260921120002` are unaffected: they run
-- as the migration owner, which holds BYPASSRLS on this platform, and every
-- one of them scopes every predicate by `p_organization_id` in its own body.
-- Tenant isolation for the runtime is enforced by those predicates, not by a
-- policy — which is the correct place for it, because the runtime is the thing
-- that knows which tenant it is acting for. `402_assert_workflow_rls.sql`
-- proves both halves live: `authenticated` cannot read, write or execute
-- anything, and `service_role` can do the runtime's work.
--
-- NO PERMISSION KEYS ARE MINTED HERE. A key with no policy behind it is a
-- grant that looks meaningful and governs nothing — and a key this packet did
-- not create is a key its rollback must not delete.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'workflow_runs',
    'workflow_checkpoints',
    'workflow_approvals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);

    -- Idempotent, and it also cleans up after the draft described in the
    -- header: a re-run of this migration over a database that received the
    -- earlier version removes the policy that version created.
    EXECUTE format('DROP POLICY IF EXISTS %I_select_workflows ON public.%I', v_table, v_table);

    -- NO POLICY IS CREATED. With RLS forced and none present, every role
    -- without BYPASSRLS is denied by default.

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v_table);

    -- The runtime, and only the runtime.
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END
$$;

COMMIT;
