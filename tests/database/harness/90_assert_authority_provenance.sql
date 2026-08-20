-- ============================================================================
-- AI-01 Batch 4A remediation, round 3 — HIGH-1 and the roster drift, against
-- the REAL functions in 20260820120000_marq_authority_provenance.sql.
--
-- Runs on a database that has been bootstrapped, given the lifecycle migration
-- and the authority-recovery migration, and then given this one — so every row
-- it inspects has been through the real backfill.
--
-- What it settles, and why reading the SQL cannot:
--
--   P1  THE BACKFILL DID NOT WIDEN. Every live membership carries provenance,
--       every value maps to its own row's key, and no row was given a role
--       above the band its key allows.
--
--   P2  THE BACKFILL READ DECISIONS, NOT `app_metadata`. An account left in a
--       half-applied promotion — `app_metadata` at `consultant`, a membership
--       row last SYNCED at `reviewer` — must be backfilled `reviewer`. Reading
--       the metadata bag would have written `consultant` and made the defect
--       permanent.
--
--   P3  THE MEMBERSHIP WRITE RECORDS WHAT IT WROTE, and reports `role_changed`
--       when the team role moves inside one organization key. `reviewer` ->
--       `consultant` does not move `role_id`; it is still a role change, and
--       provenance is what makes it observable.
--
--   P4  A ROSTER STAMP MOVES BOTH HALVES. Applying a roster at a new role
--       leaves `app_metadata` and the membership row AGREEING, so a re-stamp
--       cannot manufacture drift. The dry run reports what it would do to the
--       membership and writes nothing.
--
--   P5  THE STAMP STILL CANNOT MINT PLATFORM AUTHORITY. A roster naming
--       `platform_admin` is refused, `platform_role` survives a stamp
--       untouched, and no membership row anywhere points at the seeded
--       `platform_admin` role after any of it.
--
--   P6  THE DRIFT REPORT NAMES THE HALF-APPLIED ACCOUNT and resolves it to the
--       LOWER of the two roles — the same answer the server resolves.
-- ============================================================================

DO $$
DECLARE
  v_ladder   TEXT[] := ARRAY['viewer','reviewer','analyst','consultant','admin','owner'];
  -- A half-applied promotion, planted BEFORE this migration ran by
  -- 89_provenance_drift_fixture.sql.
  v_drifted  UUID := '00000000-0000-4000-8000-0000000c0001';
  -- This file's own subjects.
  v_mover    UUID := '00000000-0000-4000-8000-0000000c0002';
  v_rostered UUID := '00000000-0000-4000-8000-0000000c0003';
  v_org      UUID;
  v_result   JSONB;
  v_meta     JSONB;
  v_count    INTEGER;
  v_text     TEXT;
  v_failed   BOOLEAN;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  -- =======================================================================
  -- P1. The backfill did not widen.
  -- =======================================================================

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.deleted_at IS NULL
    AND r.key IN ('org_admin', 'team_member', 'team_viewer')
    AND m.team_role IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'P1: % live membership row(s) were left with no provenance', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.deleted_at IS NULL
    AND m.team_role IS NOT NULL
    AND cortex.organization_role_for_team_role(m.team_role) IS DISTINCT FROM r.key;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'P1: % membership row(s) carry provenance that does not map to their own key', v_count;
  END IF;

  -- No row may read above the ceiling of the key it holds. `team_member` tops
  -- out at `consultant`; `org_admin` at `owner`; `team_viewer` at `viewer`.
  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.deleted_at IS NULL
    AND m.team_role IS NOT NULL
    AND array_position(v_ladder, m.team_role) >
        array_position(v_ladder, CASE r.key
                                   WHEN 'org_admin'   THEN 'owner'
                                   WHEN 'team_member' THEN 'consultant'
                                   ELSE 'viewer'
                                 END);

  IF v_count > 0 THEN
    RAISE EXCEPTION 'P1: % membership row(s) were backfilled above their key''s ceiling', v_count;
  END IF;

  -- =======================================================================
  -- P2. The backfill read executed decisions, never the metadata bag.
  --
  -- `v_drifted` was planted with `app_metadata.team_role = 'consultant'` and a
  -- lifecycle log whose last successful sync was `reviewer`. THE FAILED
  -- PROMOTION MUST NOT HAVE BECOME PROVENANCE.
  -- =======================================================================

  SELECT m.team_role INTO v_text
  FROM public.organization_memberships m
  WHERE m.user_id = v_drifted AND m.organization_id = v_org AND m.deleted_at IS NULL;

  IF v_text IS DISTINCT FROM 'reviewer' THEN
    RAISE EXCEPTION 'P2: the half-applied account was backfilled %, expected reviewer — the backfill read app_metadata',
      COALESCE(v_text, 'NULL');
  END IF;

  SELECT u.raw_app_meta_data ->> 'team_role' INTO v_text FROM auth.users u WHERE u.id = v_drifted;
  IF v_text IS DISTINCT FROM 'consultant' THEN
    RAISE EXCEPTION 'P2: the fixture is not the case under test — app_metadata says %, expected consultant',
      COALESCE(v_text, 'NULL');
  END IF;

  -- =======================================================================
  -- P3. The membership write records what it wrote, and reports the move.
  -- =======================================================================

  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_mover, 'mover@marq.test', '{"marq_team": true, "team_role": "reviewer"}'::JSONB, '{}'::JSONB);

  v_result := public.marq_sync_team_membership(v_mover, 'reviewer');
  IF v_result ->> 'action' <> 'created' OR v_result ->> 'team_role' <> 'reviewer'
     OR v_result ->> 'role_key' <> 'team_member' THEN
    RAISE EXCEPTION 'P3: a first sync reported %, expected created/reviewer/team_member', v_result;
  END IF;

  -- Same key, different team role. `role_id` does not move; the authority does.
  v_result := public.marq_sync_team_membership(v_mover, 'consultant');
  IF v_result ->> 'action' <> 'role_changed' OR v_result ->> 'team_role' <> 'consultant'
     OR v_result ->> 'role_key' <> 'team_member' THEN
    RAISE EXCEPTION 'P3: reviewer -> consultant reported %, expected role_changed/consultant/team_member', v_result;
  END IF;

  SELECT m.team_role INTO v_text
  FROM public.organization_memberships m
  WHERE m.user_id = v_mover AND m.organization_id = v_org AND m.deleted_at IS NULL;
  IF v_text IS DISTINCT FROM 'consultant' THEN
    RAISE EXCEPTION 'P3: the row records %, expected consultant', COALESCE(v_text, 'NULL');
  END IF;

  -- Re-syncing the same role writes nothing and says so.
  v_result := public.marq_sync_team_membership(v_mover, 'consultant');
  IF v_result ->> 'action' <> 'unchanged' THEN
    RAISE EXCEPTION 'P3: an idempotent sync reported %, expected unchanged', v_result ->> 'action';
  END IF;

  -- An unrecognised role normalises DOWN, never up.
  v_result := public.marq_sync_team_membership(v_mover, 'manager');
  IF v_result ->> 'team_role' <> 'viewer' OR v_result ->> 'role_key' <> 'team_viewer' THEN
    RAISE EXCEPTION 'P3: the unrecognised role "manager" resolved to %, expected viewer/team_viewer', v_result;
  END IF;

  -- =======================================================================
  -- P4. A roster stamp moves both halves.
  -- =======================================================================

  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_rostered, 'rostered@marq.test',
          '{"marq_team": true, "team_role": "viewer", "platform_role": "admin"}'::JSONB, '{}'::JSONB);

  PERFORM public.marq_sync_team_membership(v_rostered, 'viewer');

  -- The dry run REPORTS the membership move and writes nothing.
  v_result := cortex.stamp_team_roster(
    jsonb_build_array(jsonb_build_object('user_id', v_rostered::TEXT, 'team_role', 'analyst')),
    1, 'provenance-probe-2026-08-20', TRUE);

  IF (v_result -> 'plan' -> 0 ->> 'membership_role') <> 'viewer'
     OR (v_result -> 'plan' -> 0 ->> 'membership_changes') <> 'true' THEN
    RAISE EXCEPTION 'P4: the dry run did not report the membership move: %', v_result -> 'plan';
  END IF;

  SELECT m.team_role INTO v_text
  FROM public.organization_memberships m
  WHERE m.user_id = v_rostered AND m.organization_id = v_org AND m.deleted_at IS NULL;
  IF v_text IS DISTINCT FROM 'viewer' THEN
    RAISE EXCEPTION 'P4: the DRY RUN moved the membership row to %', COALESCE(v_text, 'NULL');
  END IF;

  -- The applied run moves both.
  v_result := cortex.stamp_team_roster(
    jsonb_build_array(jsonb_build_object('user_id', v_rostered::TEXT, 'team_role', 'analyst')),
    1, 'provenance-probe-2026-08-20', FALSE);

  IF (v_result ->> 'stamped') <> '1' OR jsonb_array_length(v_result -> 'memberships') <> 1
     OR (v_result -> 'memberships' -> 0 ->> 'team_role') <> 'analyst' THEN
    RAISE EXCEPTION 'P4: the applied stamp did not synchronise the membership: %', v_result;
  END IF;

  SELECT u.raw_app_meta_data ->> 'team_role' INTO v_text FROM auth.users u WHERE u.id = v_rostered;
  IF v_text IS DISTINCT FROM 'analyst' THEN
    RAISE EXCEPTION 'P4: app_metadata says %, expected analyst', COALESCE(v_text, 'NULL');
  END IF;

  SELECT m.team_role INTO v_text
  FROM public.organization_memberships m
  WHERE m.user_id = v_rostered AND m.organization_id = v_org AND m.deleted_at IS NULL;
  IF v_text IS DISTINCT FROM 'analyst' THEN
    RAISE EXCEPTION 'P4: the membership row says %, expected analyst — the stamp left the two systems disagreeing',
      COALESCE(v_text, 'NULL');
  END IF;

  -- A SECOND stamp at a THIRD role. This is the re-stamping case: it must not
  -- accumulate drift either.
  PERFORM cortex.stamp_team_roster(
    jsonb_build_array(jsonb_build_object('user_id', v_rostered::TEXT, 'team_role', 'reviewer')),
    1, 'provenance-probe-2026-08-20', FALSE);

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.user_id = v_rostered
    AND m.organization_id = v_org
    AND m.deleted_at IS NULL
    AND m.team_role IS NOT DISTINCT FROM (u.raw_app_meta_data ->> 'team_role')
    AND m.team_role = 'reviewer';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'P4: re-stamping left the two authority systems disagreeing';
  END IF;

  -- =======================================================================
  -- P5. The stamp still cannot mint platform authority.
  -- =======================================================================

  SELECT u.raw_app_meta_data ->> 'platform_role' INTO v_text FROM auth.users u WHERE u.id = v_rostered;
  IF v_text IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'P5: the stamp did not preserve platform_role (found %)', COALESCE(v_text, 'NULL');
  END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM cortex.stamp_team_roster(
      jsonb_build_array(jsonb_build_object('user_id', v_rostered::TEXT, 'team_role', 'platform_admin')),
      1, 'provenance-probe-platform', FALSE);
  EXCEPTION WHEN OTHERS THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'P5: a roster naming platform_admin was accepted';
  END IF;

  -- `platform_admin` is not a team role, so the membership write normalises it
  -- to `viewer` rather than raising. Either outcome is safe; granting is not.
  PERFORM public.marq_sync_team_membership(v_rostered, 'platform_admin');

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.deleted_at IS NULL
    AND r.key = 'platform_admin'
    AND m.user_id IN (v_rostered, v_mover, v_drifted);

  IF v_count > 0 THEN
    RAISE EXCEPTION 'P5: a lifecycle or roster path produced % membership row(s) at the seeded platform_admin role', v_count;
  END IF;

  SELECT m.team_role INTO v_text
  FROM public.organization_memberships m
  WHERE m.user_id = v_rostered AND m.organization_id = v_org AND m.deleted_at IS NULL;
  IF v_text IS DISTINCT FROM 'viewer' THEN
    RAISE EXCEPTION 'P5: syncing "platform_admin" recorded provenance %, expected viewer', COALESCE(v_text, 'NULL');
  END IF;

  -- THE ROW THE FIXTURE PLANTED IS STILL THERE, AND IS STILL A MEMBERSHIP AT
  -- THE SEEDED `platform_admin` KEY (user `...e0004`).
  --
  -- That row is finding HIGH-2 as data, and this migration deliberately does
  -- NOT delete it: an organization membership pointing at a platform role is a
  -- legal row, and the defect was never the row — it was the server reading
  -- global platform authority out of it. Deleting it here would hide the case
  -- the server-side adversarial tests exist to prove is now harmless, and would
  -- be a migration silently revoking somebody's membership.
  --
  -- What must hold is that the backfill left it alone: no provenance, because
  -- its key is not one of the three the team ladder maps to.
  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.deleted_at IS NULL AND r.key = 'platform_admin' AND m.team_role IS NOT NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'P5: the backfill wrote team ladder provenance onto % platform_admin membership row(s)', v_count;
  END IF;

  -- Put the roster subject back where P4 left it, so P6 has an account whose
  -- two halves genuinely agree. The re-stamp is the repair path an operator
  -- would use, which is worth exercising here rather than editing rows by hand.
  PERFORM cortex.stamp_team_roster(
    jsonb_build_array(jsonb_build_object('user_id', v_rostered::TEXT, 'team_role', 'reviewer')),
    1, 'provenance-probe-2026-08-20', FALSE);

  -- =======================================================================
  -- P6. The drift report names the half-applied account, at the LOWER role.
  -- =======================================================================

  SELECT COUNT(*) INTO v_count
  FROM cortex.team_authority_drift() d
  WHERE d.user_id = v_drifted
    AND d.metadata_team_role = 'consultant'
    AND d.membership_team_role = 'reviewer'
    AND d.effective_team_role = 'reviewer';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'P6: the drift report did not name the half-applied account at the lower role';
  END IF;

  -- An account whose two halves agree is NOT drift.
  SELECT COUNT(*) INTO v_count
  FROM cortex.team_authority_drift() d
  WHERE d.user_id = v_rostered;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P6: an account whose two halves agree was reported as drifted';
  END IF;

  RAISE NOTICE 'assert_authority_provenance: PASSED';
END $$;
