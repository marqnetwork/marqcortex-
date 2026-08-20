-- ===========================================================================
-- MARQ Cortex — AI-01 Batch 4A, Round 3 authority remediation
-- Depends on: 20260818120000_marq_team_membership_bootstrap.sql
--             20260818130000_marq_membership_lifecycle.sql
--             20260819120000_marq_authority_recovery.sql
-- Rollback:   supabase/migrations/rollbacks/20260820120000_rollback_authority_provenance.sql
--
-- Two independent findings, one shared cause: the platform was reading MORE
-- authority out of an `organization_memberships` row than the row can honestly
-- carry.
--
--   HIGH-1  FAILED PROMOTION MUST NEVER CREATE A NEW CAPABILITY.
--
--           The organization role key is AMBIGUOUS. `reviewer`, `analyst` and
--           `consultant` all map to `team_member`, so the key alone cannot say
--           which of the three a row stands for. The authority model read it at
--           its CEILING — `consultant` — and that turned a half-applied
--           promotion into a grant: `applyTeamRoleChange` writes the trusted
--           `app_metadata` first, so a promotion whose membership write failed
--           left `team_role = 'consultant'` beside a `team_member` row that
--           never moved, both halves scored `consultant`, and the FAILED
--           operation handed out `ai.analysis.run`, `ai.block.assist`,
--           `ai.copilot.plan`, `ai.section.copilot` and `ai.agent.execute`.
--
--           The server now reads an ambiguous key at its WEAKEST meaning unless
--           the row itself carries stronger trusted provenance. THIS MIGRATION
--           IS THAT PROVENANCE: `organization_memberships.team_role`, written by
--           the membership write and by nothing else, recording which team role
--           the row was actually written for. It moves only when a membership
--           write SUCCEEDS, which is exactly why reading it is safe where
--           reading the key's ceiling was not.
--
--   ROSTER DRIFT
--
--           `cortex.stamp_team_roster` wrote `app_metadata` and left the
--           membership row alone. Re-stamping a reviewed roster at a new role
--           therefore MANUFACTURED the disagreement HIGH-1 exploits: the trusted
--           half moved, the membership half did not, and the account sat in a
--           permanently half-applied role change that no lifecycle call had ever
--           made. The stamp now moves BOTH halves through the one authoritative
--           membership write, so a roster application is a complete authority
--           decision or it is no decision at all.
--
-- NOTHING HERE GRANTS. Every path is `cortex.organization_role_for_team_role`
-- and `public.marq_sync_team_membership` — the one mapping and the one write,
-- both of which already refuse to assign `platform_admin`. The backfill reads
-- only records of authority decisions that were REVIEWED AND EXECUTED (the
-- lifecycle log, the roster stamp log) and never the mutable `app_metadata`
-- bag; where it finds neither, it writes the weakest meaning of the key the row
-- already carries, which is what the server would have assumed anyway.
--
-- Reversible: `rollbacks/20260820120000_rollback_authority_provenance.sql`.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. `cortex.normalize_team_role` — ONE normalizer, mirroring the server
--
-- `normalizeTeamRole` in `teamAuthorization.ts` resolves anything it does not
-- recognise to `viewer`, the LEAST privileged role, because a data gap must
-- never be a privilege grant. This is that function in SQL, so the column and
-- the server cannot disagree about what an unrecognised string means.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cortex.normalize_team_role(p_team_role TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN lower(trim(COALESCE(p_team_role, ''))) = ANY (
             ARRAY['viewer', 'reviewer', 'analyst', 'consultant', 'admin', 'owner']
           )
           THEN lower(trim(p_team_role))
           ELSE 'viewer'
         END;
$$;

COMMENT ON FUNCTION cortex.normalize_team_role(TEXT) IS
  'Normalises a stored team role. Anything unrecognised resolves to viewer, the least privileged role — never to the most.';

REVOKE ALL ON FUNCTION cortex.normalize_team_role(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cortex.normalize_team_role(TEXT) TO service_role;

-- The normalizer and `cortex.team_roles()` must name the same six roles. A
-- seventh role added to one and not the other would silently normalise to
-- `viewer` — fail-closed, but wrong, and wrong quietly.
DO $$
DECLARE
  v_role TEXT;
BEGIN
  FOREACH v_role IN ARRAY cortex.team_roles() LOOP
    IF cortex.normalize_team_role(v_role) <> v_role THEN
      RAISE EXCEPTION 'authority provenance: cortex.normalize_team_role does not recognise the team role %', v_role;
    END IF;
  END LOOP;

  IF cortex.normalize_team_role('platform_admin') <> 'viewer'
     OR cortex.normalize_team_role('super_admin')  <> 'viewer'
     OR cortex.normalize_team_role('org_admin')    <> 'viewer'
     OR cortex.normalize_team_role(NULL)           <> 'viewer' THEN
    RAISE EXCEPTION 'authority provenance: cortex.normalize_team_role admitted a role the console cannot issue';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. THE PROVENANCE COLUMN
--
-- Nullable: every row written before this migration has none, and "none" is a
-- meaning the server understands — it reads the key at its weakest. The CHECK
-- names the six team roles literally rather than calling `team_roles()`,
-- because a CHECK may only reference immutable expressions and a constraint
-- that silently stopped being enforced would be worse than no constraint.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS team_role TEXT;

ALTER TABLE public.organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_team_role_check;

ALTER TABLE public.organization_memberships
  ADD CONSTRAINT organization_memberships_team_role_check
  CHECK (
    team_role IS NULL
    OR team_role IN ('viewer', 'reviewer', 'analyst', 'consultant', 'admin', 'owner')
  );

COMMENT ON COLUMN public.organization_memberships.team_role IS
  'The TEAM role this row was last written for, by public.marq_sync_team_membership and nothing else. Trusted provenance for the ambiguous organization role key (HIGH-1): it moves only when a membership write succeeds, so a half-applied promotion leaves it at the old role. NEVER a grant on its own — the server clamps it to the key''s ceiling.';

-- ---------------------------------------------------------------------------
-- 3. BACKFILL — FROM DECISIONS THAT WERE EXECUTED, NEVER FROM `app_metadata`
--
-- Three sources, most trustworthy first. The rule that governs all of them:
-- provenance is a record of an authority decision that was reviewed and
-- applied, so the mutable `raw_app_meta_data` bag — the very half that runs
-- AHEAD during a failed promotion — is not one of them. Backfilling from it
-- would enshrine any half-applied promotion standing at migration time as
-- permanent truth, which is the defect, written down.
--
--   (a) `cortex.membership_lifecycle_log` — the latest successful `sync` for
--       this (organization, user). This IS a membership write that happened.
--
--   (b) `cortex.team_roster_stamp_log` — the latest non-reverted reviewed
--       roster naming this account. An operator reviewed the artifact and
--       applied it; that is a decision, even though the old stamp only moved
--       one half.
--
--   (c) neither — the WEAKEST team role the row's own key can stand for. Not a
--       guess about the account: a statement that nothing is known, written in
--       the form the server would have assumed anyway.
--
-- Every source is clamped to the band the row's CURRENT key allows, so no
-- backfilled value can read higher than the key alone already did. A source
-- that names a role outside the band is taken at the band's floor.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_filled INTEGER;
BEGIN
  WITH banded AS (
    SELECT m.id,
           m.user_id,
           m.organization_id,
           r.key AS role_key,
           CASE r.key
             WHEN 'org_admin'   THEN 'admin'
             WHEN 'team_member' THEN 'reviewer'
             ELSE 'viewer'
           END AS band_floor,
           CASE r.key
             WHEN 'org_admin'   THEN 'owner'
             WHEN 'team_member' THEN 'consultant'
             ELSE 'viewer'
           END AS band_ceiling
    FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.team_role IS NULL
      AND m.deleted_at IS NULL
      AND r.key IN ('org_admin', 'team_member', 'team_viewer')
  ),
  sourced AS (
    SELECT b.*,
           COALESCE(
             (SELECT cortex.normalize_team_role(l.team_role)
                FROM cortex.membership_lifecycle_log l
               WHERE l.user_id = b.user_id
                 AND l.organization_id = b.organization_id
                 AND l.operation = 'sync'
                 AND l.team_role IS NOT NULL
               ORDER BY l.occurred_at DESC
               LIMIT 1),
             (SELECT cortex.normalize_team_role(s.team_role)
                FROM cortex.team_roster_stamp_log s
               WHERE s.user_id = b.user_id
                 AND s.reverted_at IS NULL
               ORDER BY s.stamped_at DESC
               LIMIT 1)
           ) AS observed
    FROM banded b
  ),
  ranked AS (
    SELECT s.id,
           s.band_floor,
           s.band_ceiling,
           s.observed,
           array_position(ARRAY['viewer','reviewer','analyst','consultant','admin','owner'], s.observed)     AS observed_rank,
           array_position(ARRAY['viewer','reviewer','analyst','consultant','admin','owner'], s.band_floor)   AS floor_rank,
           array_position(ARRAY['viewer','reviewer','analyst','consultant','admin','owner'], s.band_ceiling) AS ceiling_rank
    FROM sourced s
  )
  UPDATE public.organization_memberships m
  SET team_role = CASE
                    WHEN k.observed_rank IS NULL              THEN k.band_floor
                    WHEN k.observed_rank > k.ceiling_rank     THEN k.band_ceiling
                    WHEN k.observed_rank < k.floor_rank       THEN k.band_floor
                    ELSE k.observed
                  END
  FROM ranked k
  WHERE m.id = k.id;

  GET DIAGNOSTICS v_filled = ROW_COUNT;
  RAISE NOTICE 'authority provenance: backfilled team_role on % membership row(s)', v_filled;
END $$;

-- ---------------------------------------------------------------------------
-- 4. THE MEMBERSHIP WRITE NOW RECORDS ITS OWN PROVENANCE
--
-- `CREATE OR REPLACE`, same signature, same guards, same advisory lock, same
-- mapping assertion, same log — so there is still exactly ONE membership write.
-- Three things change:
--
--   * `team_role` is written on every insert and every update, from the team
--     role the CALLER asked for, normalised. Never from `app_metadata`.
--
--   * `role_changed` is now reported when the team role moves even though the
--     mapped KEY does not. `reviewer` -> `consultant` was previously reported
--     `unchanged` because `role_id` did not move — which was true of the row
--     and false of the authority, and provenance is precisely the thing that
--     makes the difference observable.
--
--   * the returned object carries `team_role`, so a caller can see what the row
--     now stands for rather than only which key it holds.
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
  v_org_id             UUID;
  v_role_key           TEXT;
  v_role_id            UUID;
  v_team_role          TEXT;
  v_membership_id      UUID;
  v_existing_role      UUID;
  v_existing_team_role TEXT;
  v_existing_status    TEXT;
  v_status             TEXT;
  v_action             TEXT;
  v_inserted           BOOLEAN;
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

  v_team_role := cortex.normalize_team_role(p_team_role);
  v_role_key  := cortex.organization_role_for_team_role(p_team_role);

  -- Structurally impossible from the mapping above, asserted anyway: a
  -- lifecycle that COULD mint platform administration should be unable to, not
  -- merely unlikely to.
  IF v_role_key = 'platform_admin' OR NOT (v_role_key = ANY (ARRAY['org_admin', 'team_member', 'team_viewer'])) THEN
    RAISE EXCEPTION 'marq_sync_team_membership: refusing to assign the organization role %', v_role_key;
  END IF;

  -- The provenance must MAP to the key being written. They are computed from
  -- the same argument through the same two functions, so a mismatch is a
  -- mapping defect rather than bad input — and the row that would record it is
  -- the row the authority model trusts.
  IF cortex.organization_role_for_team_role(v_team_role) <> v_role_key THEN
    RAISE EXCEPTION 'marq_sync_team_membership: provenance % does not map to the organization role % it would be written beside',
      v_team_role, v_role_key;
  END IF;

  v_org_id  := cortex.marq_organization_id_strict();
  v_role_id := cortex.system_role_id(v_role_key);

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'marq_sync_team_membership: the seeded system role % is missing from the catalog', v_role_key;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cortex.membership_bootstrap')::BIGINT);

  SELECT m.id, m.role_id, m.team_role, m.status
    INTO v_membership_id, v_existing_role, v_existing_team_role, v_existing_status
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org_id
    AND m.user_id = p_user_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF v_membership_id IS NULL THEN
    INSERT INTO public.organization_memberships (organization_id, user_id, role_id, team_role, status, joined_at, invited_by)
    VALUES (v_org_id, p_user_id, v_role_id, v_team_role, 'active', now(), p_actor_id)
    -- A concurrent creator is a lost race, not an error. Taking the update arm
    -- keeps the mapped role authoritative in both branches: the alternative,
    -- DO NOTHING, would leave the other session's role standing after an
    -- administrator explicitly asked for this one.
    ON CONFLICT (organization_id, user_id) WHERE deleted_at IS NULL
      DO UPDATE SET role_id = EXCLUDED.role_id, team_role = EXCLUDED.team_role
    RETURNING id, status, (xmax = 0) INTO v_membership_id, v_status, v_inserted;
    -- L4. `created` is claimed only for a tuple this statement inserted.
    v_action := CASE WHEN v_inserted THEN 'created' ELSE 'reconciled' END;
  ELSIF v_existing_role IS DISTINCT FROM v_role_id
     OR v_existing_team_role IS DISTINCT FROM v_team_role THEN
    UPDATE public.organization_memberships
    SET role_id = v_role_id, team_role = v_team_role
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
    ('sync', v_action, v_org_id, p_user_id, p_actor_id, v_team_role, v_role_key, v_membership_id);

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'membership_id',   v_membership_id,
    'role_key',        v_role_key,
    'team_role',       v_team_role,
    'status',          v_status,
    'action',          v_action
  );
END $$;

COMMENT ON FUNCTION public.marq_sync_team_membership(UUID, TEXT, UUID) IS
  'Authoritative MARQ membership write. Takes a user id and a team role; resolves the organization, the system role and the row''s team_role provenance internally. Reports created / role_changed / unchanged / reconciled.';

-- ---------------------------------------------------------------------------
-- 5. THE ROSTER STAMP MOVES BOTH HALVES
--
-- Same signature, same refusals, same dry-run default, same stamp log. The one
-- behavioural change is at the end of an APPLIED run: every stamped account is
-- put through `public.marq_sync_team_membership` at the role the roster named,
-- so `app_metadata` and the membership row leave the function agreeing.
--
-- WHY THIS IS THE RIGHT PLACE. The roster is the platform's reviewed answer to
-- "who is staff, at what role". Applying only half of that answer left every
-- re-stamp manufacturing the exact two-system disagreement the authority floor
-- exists to survive — permanently, with no lifecycle call to blame and no
-- failure reported. A roster that names a role and does not deliver it is not a
-- safer roster; it is a roster whose result nobody can predict.
--
-- IT STILL CANNOT GRANT MORE THAN THE ROSTER SAYS. The membership write maps
-- the role itself and refuses anything but the three organization keys, and the
-- roster's own validation already rejects every role outside
-- `cortex.team_roles()`. The whole function remains one statement to its
-- caller, so a membership write that fails rolls the stamp back with it.
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
  v_count       INTEGER;
  v_bad         TEXT[];
  v_org_id      UUID;
  v_plan        JSONB;
  v_stamped     INTEGER := 0;
  v_entry       RECORD;
  v_sync        JSONB;
  v_memberships JSONB := '[]'::JSONB;
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

  -- Shape. Everything downstream may assume a well-formed uuid and role.
  SELECT array_agg(DISTINCT entry::TEXT ORDER BY entry::TEXT) INTO v_bad
  FROM jsonb_array_elements(p_roster) AS entry
  WHERE jsonb_typeof(entry) <> 'object'
     OR entry ->> 'user_id' IS NULL
     OR entry ->> 'team_role' IS NULL
     OR entry ->> 'user_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: % malformed roster entr(y/ies): %', array_length(v_bad, 1), v_bad;
  END IF;

  -- Role. `platform_admin`, `platform_role`, `superadmin` and every other
  -- invention land here; the mapping's ELSE arm is not a fallback the roster
  -- may lean on.
  SELECT array_agg(DISTINCT entry ->> 'team_role' ORDER BY entry ->> 'team_role') INTO v_bad
  FROM jsonb_array_elements(p_roster) AS entry
  WHERE NOT (lower(trim(entry ->> 'team_role')) = ANY (cortex.team_roles()));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stamp_team_roster: the roster names role(s) the console cannot issue: %. Valid roles: %',
      v_bad, cortex.team_roles();
  END IF;

  -- Duplicates. Two rows for one person is two different intentions, and
  -- picking either is guessing.
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

  -- Every referenced id must be a live auth user.
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

  -- Not a customer. An account holding an active membership in any organization
  -- other than MARQ is somebody else's user, and stamping them internal staff is
  -- the accident this artifact exists to make impossible.
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

  -- The plan: what each account carries now, and what it would carry. Returned
  -- in both modes, so an applied run is self-documenting too.
  --
  -- `membership_role` and `membership_changes` are the drift the old stamp could
  -- create and never reported: what the MEMBERSHIP row stands for today, and
  -- whether applying this roster would move it.
  SELECT jsonb_agg(
           jsonb_build_object(
             'user_id',      r.uid,
             'team_role',    r.role,
             'was_stamped',  COALESCE(u.raw_app_meta_data ->> 'marq_team', '') = 'true',
             'current_role', u.raw_app_meta_data ->> 'team_role',
             'changes',      COALESCE(u.raw_app_meta_data ->> 'team_role', '') IS DISTINCT FROM r.role
                             OR COALESCE(u.raw_app_meta_data ->> 'marq_team', '') IS DISTINCT FROM 'true',
             'membership_role',    m.team_role,
             'membership_changes', COALESCE(m.team_role, '') IS DISTINCT FROM r.role
           ) ORDER BY r.uid
         )
    INTO v_plan
  FROM (
    SELECT entry ->> 'user_id' AS uid, lower(trim(entry ->> 'team_role')) AS role
    FROM jsonb_array_elements(p_roster) AS entry
  ) AS r
  JOIN auth.users u ON u.id = r.uid::UUID
  LEFT JOIN public.organization_memberships m
    ON m.user_id = r.uid::UUID
   AND m.organization_id = v_org_id
   AND m.deleted_at IS NULL;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'artifact',    p_artifact,
      'dry_run',     true,
      'roster',      v_count,
      'stamped',     0,
      'memberships', v_memberships,
      'plan',        v_plan
    );
  END IF;

  -- The stamp. Merged, never replaced: `platform_role` and every other key an
  -- account already carries survives, and only these two are written.
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

  -- Every roster entry must have been stamped AND recorded. A short write is a
  -- silent partial application, which is the class of failure MED-2 named.
  IF v_stamped <> v_count THEN
    RAISE EXCEPTION 'stamp_team_roster: recorded % of % roster entries; rolling back rather than applying part of a reviewed roster',
      v_stamped, v_count;
  END IF;

  -- THE SECOND HALF. One authoritative membership write per roster entry, at
  -- the role the roster named, so the stamp cannot leave the two systems
  -- disagreeing. Any failure raises and takes the whole stamp with it.
  FOR v_entry IN
    SELECT (entry ->> 'user_id')::UUID AS user_id,
           lower(trim(entry ->> 'team_role')) AS team_role
    FROM jsonb_array_elements(p_roster) AS entry
    ORDER BY 1
  LOOP
    v_sync := public.marq_sync_team_membership(v_entry.user_id, v_entry.team_role, NULL);
    v_memberships := v_memberships || jsonb_build_array(
      jsonb_build_object(
        'user_id',   v_entry.user_id,
        'team_role', v_sync ->> 'team_role',
        'role_key',  v_sync ->> 'role_key',
        'action',    v_sync ->> 'action'
      )
    );
  END LOOP;

  IF jsonb_array_length(v_memberships) <> v_count THEN
    RAISE EXCEPTION 'stamp_team_roster: synchronised % of % memberships; rolling back rather than leaving the two authority systems disagreeing',
      jsonb_array_length(v_memberships), v_count;
  END IF;

  RETURN jsonb_build_object(
    'artifact',    p_artifact,
    'dry_run',     false,
    'roster',      v_count,
    'stamped',     v_stamped,
    'memberships', v_memberships,
    'plan',        v_plan
  );
END $$;

COMMENT ON FUNCTION cortex.stamp_team_roster(JSONB, INTEGER, TEXT, BOOLEAN) IS
  'Validates and applies a reviewed internal-staff roster to auth.users app_metadata AND to the organization membership row, through the one authoritative membership write. Dry-run by default; refuses empty, oversized, duplicate, unknown, mis-roled and cross-organization entries; never leaves the two authority systems disagreeing.';

-- ---------------------------------------------------------------------------
-- 6. A DRIFT REPORT AN OPERATOR CAN ACT ON
--
-- Read-only. Names every live MARQ membership whose trusted `app_metadata` team
-- role and whose row provenance disagree — the state a half-applied role change
-- leaves behind, and the state the server now resolves at the LOWER of the two.
-- Without this, "your promotion did not take effect" is invisible until somebody
-- reports that a feature is missing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cortex.team_authority_drift()
RETURNS TABLE (
  user_id             UUID,
  email               TEXT,
  metadata_team_role  TEXT,
  membership_team_role TEXT,
  membership_role_key TEXT,
  effective_team_role TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH live AS (
    SELECT m.user_id,
           u.email::TEXT AS email,
           u.raw_app_meta_data ->> 'team_role' AS metadata_team_role,
           m.team_role AS membership_team_role,
           r.key AS membership_role_key
    FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    JOIN auth.users u ON u.id = m.user_id
    WHERE m.deleted_at IS NULL
      AND m.status = 'active'
      AND m.organization_id = cortex.marq_organization_id_strict()
  ),
  ranked AS (
    SELECT l.*,
           array_position(ARRAY['viewer','reviewer','analyst','consultant','admin','owner'],
                          cortex.normalize_team_role(l.metadata_team_role)) AS meta_rank,
           array_position(ARRAY['viewer','reviewer','analyst','consultant','admin','owner'],
                          COALESCE(l.membership_team_role,
                                   CASE l.membership_role_key
                                     WHEN 'org_admin'   THEN 'admin'
                                     WHEN 'team_member' THEN 'reviewer'
                                     ELSE 'viewer'
                                   END)) AS row_rank
    FROM live l
  )
  SELECT k.user_id,
         k.email,
         k.metadata_team_role,
         k.membership_team_role,
         k.membership_role_key,
         (ARRAY['viewer','reviewer','analyst','consultant','admin','owner'])[LEAST(k.meta_rank, k.row_rank)]
  FROM ranked k
  WHERE k.metadata_team_role IS NULL
     OR k.membership_team_role IS NULL
     OR cortex.normalize_team_role(k.metadata_team_role) IS DISTINCT FROM k.membership_team_role
  ORDER BY k.user_id;
$$;

COMMENT ON FUNCTION cortex.team_authority_drift() IS
  'Read-only. Every live MARQ membership whose app_metadata team role and row provenance disagree, with the effective role the server resolves — the LOWER of the two. Grants nothing.';

REVOKE ALL ON FUNCTION cortex.team_authority_drift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cortex.team_authority_drift() TO service_role;

-- ---------------------------------------------------------------------------
-- 7. POST-CONDITIONS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unbanded INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_memberships'
      AND column_name = 'team_role'
  ) THEN
    RAISE EXCEPTION 'authority provenance: organization_memberships.team_role was not created';
  END IF;

  -- No live row may carry provenance that does not map to its own key. The
  -- server clamps anyway; a row that needs clamping is a defect, not a state.
  SELECT COUNT(*) INTO v_unbanded
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.deleted_at IS NULL
    AND m.team_role IS NOT NULL
    AND cortex.organization_role_for_team_role(m.team_role) IS DISTINCT FROM r.key;

  IF v_unbanded > 0 THEN
    RAISE EXCEPTION 'authority provenance: % membership row(s) carry a team_role that does not map to their own role key', v_unbanded;
  END IF;

  RAISE NOTICE 'authority provenance: applied';
END $$;

COMMIT;
