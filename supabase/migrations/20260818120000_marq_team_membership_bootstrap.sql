-- ============================================================================
-- AI-01 Batch 4A — MARQ team membership bootstrap
-- Depends on: 20260711050000_cortex_tenancy_foundation.sql
--             20260711050001_cortex_tenancy_rls_and_seed.sql
-- Rollback:   supabase/migrations/rollbacks/20260818120000_rollback_membership_bootstrap.sql
--
-- WHY THIS EXISTS
--
-- The tenancy seed creates the MARQ organization, the system role catalog and
-- the permission mappings, and then deliberately stops: it creates no user
-- memberships, because a migration must not invent `auth.users` ids. The
-- documented consequence was a manual procedure
-- (architecture/database/MEMBERSHIP_BOOTSTRAP.md) that production never ran —
-- `public.organization_memberships` holds zero active rows, so every operator
-- authenticates successfully, resolves NO verified organization, and the AI
-- guard fails the request closed at `resolveOrganization`.
--
-- Failing closed is correct. Having nobody to admit is not. This migration
-- closes the gap the only way that keeps both properties: it derives REAL user
-- ids from `auth.users` rather than inventing them, and it grants nothing that
-- the auth record does not already assert.
--
-- WHAT IT WILL NOT DO
--
--   * It creates no organization. If the MARQ organization is absent the
--     migration is a no-op and says so — a bootstrap that conjures a tenant is
--     a default tenant by another name.
--   * It creates no `auth.users` row, and never writes to the auth schema.
--   * It never assigns `platform_admin`. That role is granted by a person,
--     through the admin API, with ops approval — not by a backfill.
--   * It never revives a membership somebody deleted, and never re-activates a
--     membership somebody suspended: the guard is "no UNDELETED membership
--     exists", so an `invited` or `suspended` row is left exactly as it is.
--
-- IDEMPOTENCY
--
-- The insert is guarded by NOT EXISTS on (organization, user, deleted_at IS
-- NULL), which is the same predicate as the partial unique index
-- `organization_memberships_active_uidx`. Re-running inserts nothing and
-- changes nothing — including after a role is later changed by an
-- administrator, because this migration never updates an existing row.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_org_id       UUID;
  v_eligible     INTEGER := 0;
  v_inserted     INTEGER := 0;
  v_duplicates   INTEGER := 0;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = 'marq' AND deleted_at IS NULL
  LIMIT 1;

  IF v_org_id IS NULL THEN
    -- No organization, no bootstrap. Creating one here would manufacture the
    -- fallback tenant this whole design refuses to have.
    RAISE NOTICE 'membership bootstrap skipped: no active organization with slug = marq';
    RETURN;
  END IF;

  -- Eligibility is read from the auth record, which is writable only through
  -- the service-role admin API — a server-side fact, not a caller assertion.
  --
  -- `deleted_at` and `banned_until` are read through `to_jsonb(u)` rather than
  -- as columns on purpose: they are GoTrue-managed and their presence varies
  -- with the Supabase platform version. A missing key yields NULL, which reads
  -- as "not deleted" / "not banned" — the same answer the column would give on
  -- a healthy account — so the migration cannot fail on a schema it does not
  -- own.
  CREATE TEMP TABLE _marq_membership_candidates ON COMMIT DROP AS
  SELECT
    u.id AS user_id,
    CASE lower(trim(COALESCE(u.raw_user_meta_data ->> 'teamRole', '')))
      -- Documented mapping (MEMBERSHIP_BOOTSTRAP.md), extended to cover the
      -- roles the console actually issues today (TEAM_ROLES in
      -- supabase/functions/server/teamAuthorization.ts).
      WHEN 'owner'      THEN 'org_admin'
      WHEN 'admin'      THEN 'org_admin'
      WHEN 'manager'    THEN 'org_admin'
      WHEN 'consultant' THEN 'team_member'
      WHEN 'analyst'    THEN 'team_member'
      WHEN 'reviewer'   THEN 'team_member'
      WHEN 'viewer'     THEN 'team_viewer'
      -- Missing or unrecognised resolves to the LEAST privileged role, the
      -- same way `normalizeTeamRole` does. A data gap must never widen access.
      ELSE 'team_viewer'
    END AS role_key
  FROM auth.users u
  WHERE COALESCE(u.raw_user_meta_data ->> 'role', '') = 'team'
    AND (to_jsonb(u) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(u) ->> 'banned_until') IS NULL
      OR (to_jsonb(u) ->> 'banned_until')::timestamptz <= now()
    );

  SELECT COUNT(*) INTO v_eligible FROM _marq_membership_candidates;

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  SELECT
    v_org_id,
    c.user_id,
    r.id,
    'active',
    now()
  FROM _marq_membership_candidates c
  JOIN public.roles r
    ON r.key = c.role_key
   AND r.is_system = true
   AND r.organization_id IS NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = v_org_id
      AND m.user_id = c.user_id
      AND m.deleted_at IS NULL
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Post-condition, asserted rather than assumed: the bootstrap must never be
  -- the reason a user holds two live memberships in one organization.
  SELECT COUNT(*) INTO v_duplicates
  FROM (
    SELECT m.user_id
    FROM public.organization_memberships m
    WHERE m.organization_id = v_org_id
      AND m.deleted_at IS NULL
    GROUP BY m.user_id
    HAVING COUNT(*) > 1
  ) AS d;

  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'membership bootstrap aborted: % user(s) hold duplicate active memberships', v_duplicates;
  END IF;

  RAISE NOTICE 'membership bootstrap: % eligible team user(s), % membership(s) created', v_eligible, v_inserted;
END $$;

COMMIT;
