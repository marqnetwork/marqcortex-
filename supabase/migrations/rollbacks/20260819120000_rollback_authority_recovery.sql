-- ============================================================================
-- AI-01 Batch 4A remediation, round 2 — roll back authority recovery
-- WARNING: Run only in staging/dev, and only when 20260819120000 must be undone.
--
-- WHAT THIS FILE DOES
--
--   * Drops the three functions 20260819120000 added:
--     `cortex.release_team_stamp`, `cortex.team_stamp_drift` and
--     `cortex.orphaned_team_accounts`.
--   * Restores `public.marq_sync_team_membership` to the reporting behaviour of
--     20260818130000 — `created` from both arms of the insert. Everything else
--     about the function is byte-identical between the two versions, so this is
--     a reporting rollback and not a behavioural one.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   * It does NOT drop `released_reason` or `released_app_metadata` from
--     `cortex.team_roster_stamp_log`. Those columns hold the provenance of
--     releases an operator has already performed — WHY a stamp was force-
--     removed and what the account carried at the time. Dropping them would
--     destroy the audit record of the very actions this migration exists to
--     make auditable, in order to undo a DDL change. The columns are nullable
--     and unread by 20260818130000, so leaving them costs nothing.
--
--     If a deployment genuinely requires the columns gone — a schema-diff gate,
--     say — do it as a separate, deliberate step after exporting the rows:
--
--       SELECT * FROM cortex.team_roster_stamp_log WHERE released_reason IS NOT NULL;
--       ALTER TABLE cortex.team_roster_stamp_log
--         DROP COLUMN released_reason, DROP COLUMN released_app_metadata;
--
--   * It does NOT touch `auth.users` or `public.organization_memberships`. Same
--     restraint, same reason, as the rollback for 20260818130000: releases and
--     memberships are operator decisions, not this file's to reverse.
--
-- AFTER RUNNING THIS, A DRIFTED STAMP IS AGAIN UNREVERTABLE without hand-written
-- SQL. That is the state finding L1 named. Reverse the drifted accounts BEFORE
-- rolling this back if you intend to unstamp them.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS cortex.release_team_stamp(TEXT, UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS cortex.team_stamp_drift(TEXT);
DROP FUNCTION IF EXISTS cortex.orphaned_team_accounts();

-- Restore the 20260818130000 body verbatim.
CREATE OR REPLACE FUNCTION public.marq_sync_team_membership(
  p_user_id   UUID,
  p_team_role TEXT,
  p_actor_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id          UUID;
  v_role_key        TEXT;
  v_role_id         UUID;
  v_membership_id   UUID;
  v_existing_role   UUID;
  v_existing_status TEXT;
  v_status          TEXT;
  v_action          TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'marq_sync_team_membership: a user id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id
      AND (to_jsonb(u) ->> 'deleted_at') IS NULL
  ) THEN
    RAISE EXCEPTION 'marq_sync_team_membership: % is not a live auth user', p_user_id;
  END IF;

  v_role_key := cortex.organization_role_for_team_role(p_team_role);

  IF v_role_key = 'platform_admin' OR NOT (v_role_key = ANY (ARRAY['org_admin', 'team_member', 'team_viewer'])) THEN
    RAISE EXCEPTION 'marq_sync_team_membership: refusing to assign the organization role %', v_role_key;
  END IF;

  v_org_id  := cortex.marq_organization_id_strict();
  v_role_id := cortex.system_role_id(v_role_key);

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'marq_sync_team_membership: the seeded system role % is missing from the catalog', v_role_key;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cortex.membership_bootstrap')::BIGINT);

  SELECT m.id, m.role_id, m.status
    INTO v_membership_id, v_existing_role, v_existing_status
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org_id
    AND m.user_id = p_user_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at, invited_by)
    VALUES (v_org_id, p_user_id, v_role_id, 'active', now(), p_actor_id)
    ON CONFLICT (organization_id, user_id) WHERE deleted_at IS NULL
      DO UPDATE SET role_id = EXCLUDED.role_id
    RETURNING id, status INTO v_membership_id, v_status;
    v_action := 'created';
  ELSIF v_existing_role IS DISTINCT FROM v_role_id THEN
    UPDATE public.organization_memberships
    SET role_id = v_role_id
    WHERE id = v_membership_id
    RETURNING status INTO v_status;
    v_action := 'role_changed';
  ELSE
    v_status := v_existing_status;
    v_action := 'unchanged';
  END IF;

  INSERT INTO cortex.membership_lifecycle_log
    (operation, action, organization_id, user_id, actor_id, team_role, role_key, membership_id)
  VALUES
    ('sync', v_action, v_org_id, p_user_id, p_actor_id, lower(trim(COALESCE(p_team_role, ''))), v_role_key, v_membership_id);

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'membership_id',   v_membership_id,
    'role_key',        v_role_key,
    'status',          v_status,
    'action',          v_action
  );
END $$;

COMMENT ON FUNCTION public.marq_sync_team_membership(UUID, TEXT, UUID) IS
  'Authoritative MARQ membership write. Takes a user id and a team role; resolves the organization and the system role internally.';

COMMIT;
