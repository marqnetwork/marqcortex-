-- ============================================================================
-- BP-003 / A2 — WORKFLOW RUNTIME PERSISTENCE: RLS AND PERMISSIONS
--
-- Same helpers, same shape and same reasoning as the durable runtime's RLS,
-- restated rather than shared for the reason that file gives: a policy read
-- out of another migration is a policy nobody reads at all.
--
-- ── THE ASYMMETRY, AGAIN, AND SHARPER HERE ─────────────────────────────────
--
-- These three tables are READ by people and WRITTEN by the workflow engine.
-- Not mostly — exclusively, and the consequence of getting it wrong is worse
-- than it was for a job queue.
--
--   A person with UPDATE on `workflow_runs` can set `state` to `completed` on
--   a run that never executed a node, or move `run_version` and make the next
--   legitimate compare-and-swap lose to nobody.
--
--   A person with UPDATE on `workflow_approvals` can write `approved` into a
--   request nobody decided. `contracts/approval.ts` opens by stating that
--   there is no automatic approval and no configuration that bypasses one; a
--   write policy here would be exactly such a configuration.
--
--   A person with UPDATE on `workflow_checkpoints` can rewrite the state a run
--   resumes from. The append-only trigger in `20260921120000` already refuses
--   that, and this file makes it unreachable as well as refused, because two
--   independent reasons a thing cannot happen is the correct number for the
--   record an auditor is entitled to believe was not edited.
--
-- So there is NO INSERT, UPDATE OR DELETE POLICY FOR `authenticated` on any of
-- the three. RLS is enabled and FORCED, a SELECT policy exists, and every
-- write path is the service role through the SECURITY DEFINER functions in
-- `20260921120002`. That is not a gap for a later packet to fill: it is the
-- statement that the workflow engine owns its own state machine.
--
-- ── WHY `workflows.read` FOLLOWS `settings.read` ───────────────────────────
--
-- The durable runtime argued that a job queue is machinery and its audience is
-- whoever administers the platform. A workflow run is the same kind of thing
-- one layer up: what it exposes is which automated work is running, waiting,
-- stuck or failed. The strategic layer's keys follow membership because goals
-- are organizational INTENT and every member may see what their organization
-- is trying to do; a run record is not intent, it is execution.
--
-- `workflows.operate` exists on the same terms `runtime.operate` does: so that
-- "who may pause, resume or cancel a run" is a decision an organization can
-- make later without a schema change. Nothing here grants a write policy on
-- the strength of it — the workflow SERVICE is the authorization surface, it
-- already enforces workflow RBAC, and this packet does not touch it.
--
-- NO DIRECT DATABASE API FOR THE BROWSER. A tenant member may SELECT these
-- rows under their organization's policy; every mutation goes through the
-- service, which resolves the actor, checks the role and drives the engine.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Two permission keys, following the settings keys at the same level
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role RECORD;
  v_pair RECORD;
BEGIN
  INSERT INTO public.permissions (key, name, description)
  SELECT v.key, v.name, v.description
  FROM (
    VALUES
      ('workflows.read',
       'Read Workflow Runtime',
       'View workflow runs, checkpoints and approval requests for the organization'),
      ('workflows.operate',
       'Operate Workflow Runtime',
       'Pause, resume and cancel the organization''s workflow runs')
  ) AS v(key, name, description)
  WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = v.key);

  FOR v_pair IN
    SELECT * FROM (VALUES
      ('settings.read',   'workflows.read'),
      ('settings.manage', 'workflows.operate')
    ) AS t(source_key, target_key)
  LOOP
    FOR v_role IN
      SELECT DISTINCT r.id
      FROM public.roles r
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE p.key = v_pair.source_key
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_role.id, p.id
      FROM public.permissions p
      WHERE p.key = v_pair.target_key
        AND NOT EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = v_role.id AND rp.permission_id = p.id
        );
    END LOOP;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS — enabled and forced everywhere, SELECT only, never cross-tenant
-- ---------------------------------------------------------------------------
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
    -- FORCE, so the table owner is not silently exempt. Without it a migration
    -- or a psql session as the owner reads every tenant's rows, and the
    -- isolation this file claims would hold for everybody except the one
    -- connection most likely to be used to check it.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);

    EXECUTE format('DROP POLICY IF EXISTS %I_select_workflows ON public.%I', v_table, v_table);
    EXECUTE format($f$
      CREATE POLICY %I_select_workflows ON public.%I
        FOR SELECT TO authenticated
        USING (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'workflows.read')
        )
    $f$, v_table, v_table);

    -- Deliberately no INSERT, UPDATE or DELETE policy. See the header.
    -- `authenticated` gets SELECT and nothing else; the engine writes as
    -- `service_role`, which RLS does not apply to.
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END
$$;

COMMIT;
