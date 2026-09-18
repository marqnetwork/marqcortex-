-- ============================================================================
-- BP-002 / A1 — DURABLE RUNTIME: RLS AND PERMISSIONS
--
-- Same helpers, same shape and same reasoning as the spine's and the strategic
-- layer's RLS — stated again rather than shared, because a policy read out of
-- another migration is a policy nobody reads at all.
--
-- ── THE ASYMMETRY THAT MATTERS, AND WHY IT IS NOT A CONVENIENCE ────────────
--
-- These five tables are READ by people and WRITTEN by the runtime. Not "mostly"
-- — exclusively. A durable job's state is the outcome of an atomic claim, a
-- lease comparison and a settle; a person pressing a button cannot produce a
-- correct one, and a person with UPDATE on `durable_jobs` can set `state` to
-- `succeeded` on a job that never ran, or clear a `lease_owner` out from under
-- a worker that is mid-execution.
--
-- So there is NO INSERT, UPDATE OR DELETE POLICY ON ANY OF THESE TABLES for
-- `authenticated`. RLS is enabled, a SELECT policy exists, and every write path
-- is the service role going through the SECURITY DEFINER functions in
-- `20260919120002`. That is not a gap to be filled by a later packet: it is the
-- statement that the runtime owns its own state machine.
--
-- `runtime.operate` exists for the same reason a separate key existed for
-- strategy: so that "who may pause, cancel or requeue work" is a decision an
-- organization can make LATER without a schema change. Nothing in this packet
-- grants a write policy on the strength of it — it gates the operator
-- OPERATIONS the runtime exposes, and the runtime still performs them.
--
-- ── WHY THE GRANT FOLLOWS `settings.read` AND NOT `members.read` ───────────
--
-- The strategic layer followed the membership keys because goals and risks are
-- organizational INTENT, and everyone in an organization is entitled to see
-- what it is trying to do. A job queue is not intent; it is machinery. What it
-- exposes is operational — which automated work is backed up, which failed,
-- which tenant's sweep is behind — and the audience for that is the audience
-- that already administers the platform's settings, not every member.
--
-- Read is therefore `settings.read`-derived and write authority is
-- `settings.manage`-derived. Both are narrower than the spine's, deliberately,
-- and both are separable later.
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
      ('runtime.read',
       'Read Durable Runtime',
       'View durable jobs, schedules, events and failures for the organization'),
      ('runtime.operate',
       'Operate Durable Runtime',
       'Pause, resume, cancel and requeue the organization''s durable background work')
  ) AS v(key, name, description)
  WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = v.key);

  FOR v_pair IN
    SELECT * FROM (VALUES
      ('settings.read',   'runtime.read'),
      ('settings.manage', 'runtime.operate')
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
-- 2. RLS — enabled everywhere, SELECT only, never cross-tenant
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'durable_jobs',
    'durable_schedules',
    'durable_outbox',
    'durable_inbox',
    'durable_dead_letters'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    -- FORCE, so the table owner is not silently exempt. Without it a migration
    -- or a psql session as the owner reads every tenant's rows, and the
    -- isolation this file claims would hold for everybody except the one
    -- connection most likely to be used to check it.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);

    EXECUTE format('DROP POLICY IF EXISTS %I_select_runtime ON public.%I', v_table, v_table);
    EXECUTE format($f$
      CREATE POLICY %I_select_runtime ON public.%I
        FOR SELECT TO authenticated
        USING (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'runtime.read')
        )
    $f$, v_table, v_table);

    -- Deliberately no INSERT, UPDATE or DELETE policy. See the header.
    -- `authenticated` gets SELECT and nothing else; the runtime writes as
    -- `service_role`, which RLS does not apply to.
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END
$$;

COMMIT;
