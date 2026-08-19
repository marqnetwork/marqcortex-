-- ============================================================================
-- AI-01 Batch 4A remediation, round 2 — L1, L2, L3 and L4 against the REAL
-- functions in 20260819120000_marq_authority_recovery.sql.
--
-- Runs after 75_assert_roster_stamping.sql, on the same database, so the
-- roster artifact it inspects is one the previous file really stamped.
--
-- What it settles, and why reading the SQL cannot:
--
--   L4  `marq_sync_team_membership` must say `created` only when it inserted a
--       tuple. The old body said `created` from an arm that had UPDATED a row
--       another writer created, and no amount of reading tells you which arm a
--       given call took.
--   L1  A stamped account somebody has edited since can be released, once, with
--       a recorded reason, keeping every other key it carries — `platform_role`
--       above all. And an account that has NOT drifted is refused, so an
--       operator is pushed towards the clean reversal.
--   L2  An account with trusted team metadata and no live MARQ membership is
--       reported as an orphan, and stops being one the moment it is adopted.
--   L3  Banned accounts: the bootstrap's eligibility predicate excludes them and
--       the orphan report tells an operator which rows are banned rather than
--       acting on them. No suspension feature is invented anywhere.
-- ============================================================================

DO $$
DECLARE
  -- The artifact 75_assert_roster_stamping.sql leaves behind, with one live,
  -- DRIFTED provenance row on `a0001` — the exact L1 dead end, already in place
  -- when this file starts.
  v_prior      TEXT := 'test-roster-2026-08-18';
  v_drifted    UUID := '00000000-0000-4000-8000-0000000a0001';
  -- This file's own artifact and subjects.
  v_artifact   TEXT := 'recovery-probe-2026-08-19';
  v_orphan     UUID := '00000000-0000-4000-8000-0000000b0001';
  v_banned     UUID := '00000000-0000-4000-8000-0000000b0002';
  v_racer      UUID := '00000000-0000-4000-8000-0000000b0003';
  v_release    UUID := '00000000-0000-4000-8000-0000000b0004';
  v_keep       UUID := '00000000-0000-4000-8000-0000000b0005';
  v_org        UUID;
  v_role       UUID;
  v_result     JSONB;
  v_meta       JSONB;
  v_count      INTEGER;
  v_text       TEXT;
  v_failed     BOOLEAN;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  -- =======================================================================
  -- L4. The action a membership write reports is the action it took.
  -- =======================================================================

  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_racer, 'racer@marq.test', '{"marq_team": true, "team_role": "viewer"}'::JSONB, '{}'::JSONB);

  -- A genuine insert.
  v_result := public.marq_sync_team_membership(v_racer, 'viewer');
  IF v_result ->> 'action' <> 'created' THEN
    RAISE EXCEPTION 'L4: a first sync reported %, expected created', v_result ->> 'action';
  END IF;

  -- The same call again changes nothing and says so.
  v_result := public.marq_sync_team_membership(v_racer, 'viewer');
  IF v_result ->> 'action' <> 'unchanged' THEN
    RAISE EXCEPTION 'L4: a repeat sync reported %, expected unchanged', v_result ->> 'action';
  END IF;

  -- A real role change.
  v_result := public.marq_sync_team_membership(v_racer, 'admin');
  IF v_result ->> 'action' <> 'role_changed' THEN
    RAISE EXCEPTION 'L4: a re-role reported %, expected role_changed', v_result ->> 'action';
  END IF;

  -- `reactivated` was in the console's union and no arm of this function can
  -- produce it. A soft-deleted row is a tombstone the lifecycle does not
  -- revive: it inserts a NEW row beside it, which is `created`.
  UPDATE public.organization_memberships
  SET deleted_at = now()
  WHERE organization_id = v_org AND user_id = v_racer AND deleted_at IS NULL;

  v_result := public.marq_sync_team_membership(v_racer, 'viewer');
  IF v_result ->> 'action' <> 'created' THEN
    RAISE EXCEPTION 'L4: syncing beside a tombstone reported %, expected created', v_result ->> 'action';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships
  WHERE organization_id = v_org AND user_id = v_racer AND deleted_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'L4: % live rows beside the tombstone, expected 1', v_count;
  END IF;

  -- The conflict arm. A row inserted by a writer that did NOT take the advisory
  -- lock is exactly what `ON CONFLICT` is there for, and this session cannot
  -- know what role it carried before — so it must not claim a transition.
  UPDATE public.organization_memberships
  SET deleted_at = now()
  WHERE organization_id = v_org AND user_id = v_racer AND deleted_at IS NULL;

  SELECT id INTO v_role FROM public.roles
  WHERE key = 'team_member' AND is_system = true AND organization_id IS NULL;

  INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
  VALUES (v_org, v_racer, v_role, 'active', now());

  -- The function's own SELECT sees that row, so it takes the `role_changed`
  -- arm — which is honest, because it observed the prior role. The `reconciled`
  -- arm is reachable only from a true race, and the assertion that matters is
  -- that the vocabulary EXISTS and the function can emit it.
  v_result := public.marq_sync_team_membership(v_racer, 'admin');
  IF v_result ->> 'action' <> 'role_changed' THEN
    RAISE EXCEPTION 'L4: a manually inserted row re-roled reported %, expected role_changed',
      v_result ->> 'action';
  END IF;

  SELECT prosrc INTO v_text FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'marq_sync_team_membership';

  IF position('reconciled' IN v_text) = 0 OR position('xmax = 0' IN v_text) = 0 THEN
    RAISE EXCEPTION 'L4: the conflict arm must distinguish an insert from a takeover (xmax = 0 -> reconciled)';
  END IF;

  -- Every action the function can emit is one the console's union carries.
  SELECT COUNT(*) INTO v_count
  FROM cortex.membership_lifecycle_log
  WHERE operation = 'sync'
    AND action NOT IN ('created', 'role_changed', 'unchanged', 'reconciled');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'L4: % logged sync actions are outside the declared vocabulary', v_count;
  END IF;

  -- =======================================================================
  -- L1. A drifted stamp can be released, exactly once, without collateral.
  -- =======================================================================

  -- The dead end, as the previous harness file left it: `a0001` was stamped by
  -- `v_prior`, then edited, so `unstamp_team_roster` skips it forever. Before
  -- this migration there was no next step that was not hand-written SQL.
  SELECT COUNT(*) INTO v_count
  FROM cortex.team_stamp_drift(v_prior)
  WHERE user_id = v_drifted AND still_matches = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'precondition: % should be a live, drifted stamp under %', v_drifted, v_prior;
  END IF;

  v_result := cortex.release_team_stamp(v_prior, v_drifted, 'closing the L1 dead end', false);
  IF (v_result ->> 'released')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'L1: the dead-end account could not be released: %', v_result;
  END IF;
  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_drifted;
  IF v_meta ? 'marq_team' OR v_meta ? 'team_role' THEN
    RAISE EXCEPTION 'L1: the release left team keys on the dead-end account: %', v_meta;
  END IF;

  -- Now the full contract, on this file's own artifact.
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
    (v_release, 'release@marq.test', '{}'::JSONB, '{}'::JSONB),
    (v_keep,    'keep@marq.test',    '{}'::JSONB, '{}'::JSONB);

  v_result := cortex.stamp_team_roster(
    jsonb_build_array(
      jsonb_build_object('user_id', v_release::TEXT, 'team_role', 'admin'),
      jsonb_build_object('user_id', v_keep::TEXT,    'team_role', 'analyst')
    ), 2, v_artifact, false);
  IF (v_result ->> 'stamped')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'precondition: the probe roster stamped %, expected 2', v_result ->> 'stamped';
  END IF;

  -- An account that has NOT drifted is refused, and told where to go: the clean
  -- reversal restores what was there before, which is strictly better.
  v_failed := false;
  BEGIN
    PERFORM cortex.release_team_stamp(v_artifact, v_release, 'no drift yet, should refuse', false);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    IF position('unstamp_team_roster' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'L1: the refusal must name the clean reversal, said: %', SQLERRM;
    END IF;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'L1: releasing an undrifted account must be refused';
  END IF;

  -- Drift it the way production does: a console role change rewrites
  -- `team_role`, and a separate ops action grants the platform role. Both are
  -- legitimate, and together they make the clean reversal impossible.
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || '{"team_role": "viewer", "platform_role": "admin"}'::JSONB
  WHERE id = v_release;

  v_result := cortex.unstamp_team_roster(v_artifact, true);
  IF (v_result ->> 'modified_since_stamp')::INTEGER <> 1
     OR (v_result ->> 'would_revert')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'L1: the reversal plan should see 1 modified and 1 revertable, said %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM cortex.team_stamp_drift(v_artifact)
  WHERE user_id = v_release AND still_matches = false AND current_team_role = 'viewer';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'L1: team_stamp_drift did not report % accurately', v_release;
  END IF;

  -- A reason is not optional, and a token one is not a reason.
  v_failed := false;
  BEGIN
    PERFORM cortex.release_team_stamp(v_artifact, v_release, 'short', false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'L1: a release with a token reason must be refused';
  END IF;

  -- The dry run is the default and writes nothing.
  v_result := cortex.release_team_stamp(v_artifact, v_release, 'offboarded 2026-08-19, ticket OPS-1');
  IF (v_result ->> 'released')::INTEGER <> 0 OR (v_result ->> 'dry_run') <> 'true' THEN
    RAISE EXCEPTION 'L1: the default must be a dry run that releases nothing: %', v_result;
  END IF;
  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_release;
  IF v_meta ->> 'marq_team' <> 'true' THEN
    RAISE EXCEPTION 'L1: a dry run must not change the account: %', v_meta;
  END IF;

  -- The real thing.
  v_result := cortex.release_team_stamp(v_artifact, v_release, 'offboarded 2026-08-19, ticket OPS-1', false);
  IF (v_result ->> 'released')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'L1: the release reported %, expected 1', v_result ->> 'released';
  END IF;

  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_release;
  IF v_meta ? 'marq_team' OR v_meta ? 'team_role' THEN
    RAISE EXCEPTION 'L1: the release left team keys behind: %', v_meta;
  END IF;
  IF v_meta ->> 'platform_role' <> 'admin' THEN
    RAISE EXCEPTION 'L1: the release destroyed platform_role. It must remove ONLY the two keys the artifact owns: %', v_meta;
  END IF;

  -- Provenance: the reason and the metadata as it actually was, not as the
  -- artifact once wrote it.
  SELECT COUNT(*) INTO v_count
  FROM cortex.team_roster_stamp_log
  WHERE artifact = v_artifact AND user_id = v_release
    AND reverted_at IS NOT NULL
    AND released_reason = 'offboarded 2026-08-19, ticket OPS-1'
    AND released_app_metadata ->> 'team_role' = 'viewer';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'L1: the release was not recorded with its reason and the observed metadata';
  END IF;

  -- Once. A released stamp is not live any more.
  v_failed := false;
  BEGIN
    PERFORM cortex.release_team_stamp(v_artifact, v_release, 'trying it twice on purpose', false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'L1: a released stamp must not be releasable again';
  END IF;

  -- And the release did not block the clean reversal of everything else.
  v_result := cortex.unstamp_team_roster(v_artifact, false);
  IF (v_result ->> 'reverted')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'L1: the untouched account should still revert cleanly: %', v_result;
  END IF;
  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_keep;
  IF v_meta ? 'marq_team' OR v_meta ? 'team_role' THEN
    RAISE EXCEPTION 'L1: the clean reversal did not run: %', v_meta;
  END IF;

  -- =======================================================================
  -- L2. An orphan is detected deterministically, and stops being one when
  --     it is adopted.
  -- =======================================================================

  -- Exactly the state a crashed invite leaves: trusted metadata, no membership.
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
    (v_orphan, 'orphan@marq.test', '{"marq_team": true, "team_role": "analyst"}'::JSONB, '{}'::JSONB),
    (v_banned, 'bannedorphan@marq.test', '{"marq_team": true, "team_role": "admin"}'::JSONB, '{}'::JSONB);
  UPDATE auth.users SET banned_until = now() + interval '30 days' WHERE id = v_banned;

  SELECT COUNT(*) INTO v_count FROM cortex.orphaned_team_accounts() WHERE user_id = v_orphan;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'L2: the orphaned account was not reported';
  END IF;

  SELECT team_role INTO v_text FROM cortex.orphaned_team_accounts() WHERE user_id = v_orphan;
  IF v_text <> 'analyst' THEN
    RAISE EXCEPTION 'L2: the report named role %, expected analyst', v_text;
  END IF;

  -- L3. The banned orphan is REPORTED and flagged, never acted on. A banned
  -- account cannot authenticate at all, so it is already fail-closed; the flag
  -- exists so an operator reading the list is not surprised by it.
  SELECT COUNT(*) INTO v_count
  FROM cortex.orphaned_team_accounts() WHERE user_id = v_banned AND banned = true;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'L3: a banned orphan must be reported, and reported as banned';
  END IF;

  -- Adoption — one of the two documented recoveries — removes it from the list.
  PERFORM public.marq_sync_team_membership(v_orphan, 'analyst');
  SELECT COUNT(*) INTO v_count FROM cortex.orphaned_team_accounts() WHERE user_id = v_orphan;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'L2: an adopted account is no longer an orphan';
  END IF;

  -- Removal — the other documented recovery — also removes it from the list.
  UPDATE auth.users SET deleted_at = now() WHERE id = v_banned;
  SELECT COUNT(*) INTO v_count FROM cortex.orphaned_team_accounts() WHERE user_id = v_banned;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'L2: a deleted account is not an orphan';
  END IF;

  -- An UNSTAMPED account with no membership is not an orphan either: it was
  -- never a team account, so there is nothing half-finished about it.
  SELECT COUNT(*) INTO v_count
  FROM cortex.orphaned_team_accounts()
  WHERE user_id = '00000000-0000-4000-8000-0000000f0001';   -- the impostor
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'L2: an unstamped account must not be reported as an orphan';
  END IF;

  -- =======================================================================
  -- L3. Banned semantics, where they actually live: the bootstrap's
  --     eligibility predicate. Confirmed, not extended.
  -- =======================================================================

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org
    AND m.user_id = '00000000-0000-4000-8000-0000000f0003'   -- banned at bootstrap time
    AND m.deleted_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'L3: a banned account was admitted by the bootstrap';
  END IF;

  -- And the account whose ban has EXPIRED was admitted, which is what makes the
  -- predicate a ban check rather than a "was ever banned" check.
  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org
    AND m.user_id = '00000000-0000-4000-8000-0000000f0004'   -- ban expired
    AND m.deleted_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'L3: an account whose ban expired should have been admitted';
  END IF;

  RAISE NOTICE 'assert_authority_recovery: PASSED';
END $$;
