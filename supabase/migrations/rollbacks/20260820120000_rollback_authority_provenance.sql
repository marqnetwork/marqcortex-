-- ===========================================================================
-- ROLLBACK — 20260820120000_marq_authority_provenance.sql
--
-- Restores the two functions this migration replaced to the definitions the
-- previous migration (20260819120000) left, and removes what it added.
--
-- SAFE TO RUN, AND SAFE NOT TO. Dropping `organization_memberships.team_role`
-- removes provenance, which makes the server read every ambiguous key at its
-- WEAKEST meaning again. That is a narrowing, never a widening: nobody gains a
-- capability by this rollback. The reverse is the risk, and it is the correct
-- direction for a rollback to fail in.
--
-- The membership rows themselves are untouched. This never revokes a
-- membership, never changes a `role_id`, and never edits `app_metadata`.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The roster stamp, back to app_metadata only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cortex.stamp_team_roster(
  p_roster         JSONB,
  p_expected_count INTEGER,
  p_artifact       TEXT,
  p_dry_run        BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  MAX_ROSTER CONSTANT INTEGER := 200;
  v_count     INTEGER;
  v_bad       TEXT[];
  v_org_id    UUID;
  v_plan      JSONB;
  v_stamped   INTEGER := 0;
BEGIN
  IF p_artifact IS NULL OR trim(p_artifact) = '' THEN
    RAISE EXCEPTION 'stamp_team_roster: an artifact identifier is required so the stamp can be attributed and reversed';
  END IF;

  IF p_roster IS NULL OR jsonb_typeof(p_roster) <> 'array' THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster must be a JSON array of {"user_id", "team_role"} objects';
  END IF;

  v_count := jsonb_array_length(p_roster);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster is empty. Refusing to run: an empty roster is a mistake, never an instruction';
  END IF;

  IF v_count > MAX_ROSTER THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster holds % entries, above the reviewed maximum of %', v_count, MAX_ROSTER;
  END IF;

  IF p_expected_count IS NULL OR p_expected_count <> v_count THEN
    RAISE EXCEPTION 'stamp_team_roster: expected % entries, the roster holds %. The list that was reviewed is the list that is applied',
      COALESCE(p_expected_count, -1), v_count;
  END IF;

  SELECT array_agg(DISTINCT entry::TEXT ORDER BY entry::TEXT) INTO v_bad
  FROM jsonb_array_elements(p_roster) AS entry
  WHERE jsonb_typeof(entry) <> 'object'
     OR entry ->> 'user_id' IS NULL
     OR entry ->> 'team_role' IS NULL
     OR entry ->> 'user_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: % malformed roster entr(y/ies): %', array_length(v_bad, 1), v_bad;
  END IF;

  SELECT array_agg(DISTINCT entry ->> 'team_role' ORDER BY entry ->> 'team_role') INTO v_bad
  FROM jsonb_array_elements(p_roster) AS entry
  WHERE NOT (lower(trim(entry ->> 'team_role')) = ANY (cortex.team_roles()));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster names role(s) the console cannot issue: %. Valid roles: %',
      v_bad, cortex.team_roles();
  END IF;

  SELECT array_agg(DISTINCT uid ORDER BY uid) INTO v_bad
  FROM (
    SELECT entry ->> 'user_id' AS uid
    FROM jsonb_array_elements(p_roster) AS entry
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) AS d;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: duplicate roster entr(y/ies) for %', v_bad;
  END IF;

  SELECT array_agg(DISTINCT uid ORDER BY uid) INTO v_bad
  FROM (
    SELECT entry ->> 'user_id' AS uid
    FROM jsonb_array_elements(p_roster) AS entry
  ) AS r
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = r.uid::UUID
      AND (to_jsonb(u) ->> 'deleted_at') IS NULL
  );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: % roster id(s) match no live auth user: %', array_length(v_bad, 1), v_bad;
  END IF;

  v_org_id := cortex.marq_organization_id_strict();

  SELECT array_agg(DISTINCT uid ORDER BY uid) INTO v_bad
  FROM (
    SELECT entry ->> 'user_id' AS uid
    FROM jsonb_array_elements(p_roster) AS entry
  ) AS r
  WHERE EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = r.uid::UUID
      AND m.organization_id <> v_org_id
      AND m.deleted_at IS NULL
      AND m.status = 'active'
  );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: % roster id(s) hold an active membership in another organization and will not be stamped as MARQ staff: %',
      array_length(v_bad, 1), v_bad;
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'user_id',      r.uid,
             'team_role',    r.role,
             'was_stamped',  COALESCE(u.raw_app_meta_data ->> 'marq_team', '') = 'true',
             'current_role', u.raw_app_meta_data ->> 'team_role',
             'changes',      COALESCE(u.raw_app_meta_data ->> 'team_role', '') IS DISTINCT FROM r.role
                             OR COALESCE(u.raw_app_meta_data ->> 'marq_team', '') IS DISTINCT FROM 'true'
           ) ORDER BY r.uid
         )
    INTO v_plan
  FROM (
    SELECT entry ->> 'user_id' AS uid, lower(trim(entry ->> 'team_role')) AS role
    FROM jsonb_array_elements(p_roster) AS entry
  ) AS r
  JOIN auth.users u ON u.id = r.uid::UUID;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'artifact', p_artifact,
      'dry_run',  true,
      'roster',   v_count,
      'stamped',  0,
      'plan',     v_plan
    );
  END IF;

  WITH roster AS (
    SELECT (entry ->> 'user_id')::UUID AS user_id,
           lower(trim(entry ->> 'team_role')) AS team_role
    FROM jsonb_array_elements(p_roster) AS entry
  ),
  before AS (
    SELECT r.user_id, r.team_role, u.raw_app_meta_data AS previous
    FROM roster r
    JOIN auth.users u ON u.id = r.user_id
  ),
  stamped AS (
    UPDATE auth.users u
    SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::JSONB)
                            || jsonb_build_object('marq_team', true, 'team_role', b.team_role)
    FROM before b
    WHERE u.id = b.user_id
    RETURNING u.id, u.raw_app_meta_data
  )
  INSERT INTO cortex.team_roster_stamp_log
    (artifact, user_id, team_role, previous_app_metadata, stamped_app_metadata)
  SELECT p_artifact, b.user_id, b.team_role, COALESCE(b.previous, '{}'::JSONB), s.raw_app_meta_data
  FROM before b
  JOIN stamped s ON s.id = b.user_id
  ON CONFLICT (artifact, user_id) WHERE reverted_at IS NULL
    DO UPDATE SET team_role            = EXCLUDED.team_role,
                  stamped_app_metadata = EXCLUDED.stamped_app_metadata,
                  stamped_at           = now(),
                  stamped_by           = current_user;

  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  IF v_stamped <> v_count THEN
    RAISE EXCEPTION 'stamp_team_roster: recorded % of % roster entries; rolling back rather than applying part of a reviewed roster',
      v_stamped, v_count;
  END IF;

  RETURN jsonb_build_object(
    'artifact', p_artifact,
    'dry_run',  false,
    'roster',   v_count,
    'stamped',  v_stamped,
    'plan',     v_plan
  );
END $$;

COMMENT ON FUNCTION cortex.stamp_team_roster(JSONB, INTEGER, TEXT, BOOLEAN) IS
  'Validates and applies a reviewed internal-staff roster to auth.users app_metadata. Dry-run by default; refuses empty, oversized, duplicate, unknown, mis-roled and cross-organization entries.';

-- ---------------------------------------------------------------------------
-- 2. The membership write, back to the 20260819120000 definition.
-- ---------------------------------------------------------------------------
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
  v_inserted        BOOLEAN;
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
    RETURNING id, status, (xmax = 0) INTO v_membership_id, v_status, v_inserted;
    v_action := CASE WHEN v_inserted THEN 'created' ELSE 'reconciled' END;
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
  'Authoritative MARQ membership write. Takes a user id and a team role; resolves the organization and the system role internally. Reports created / role_changed / unchanged / reconciled.';

-- ---------------------------------------------------------------------------
-- 3. Remove what the migration added.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS cortex.team_authority_drift();

ALTER TABLE public.organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_team_role_check;

ALTER TABLE public.organization_memberships
  DROP COLUMN IF EXISTS team_role;

DROP FUNCTION IF EXISTS cortex.normalize_team_role(TEXT);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_memberships'
      AND column_name = 'team_role'
  ) THEN
    RAISE EXCEPTION 'authority provenance rollback: organization_memberships.team_role still exists';
  END IF;

  RAISE NOTICE 'authority provenance rollback: applied';
END $$;

COMMIT;
