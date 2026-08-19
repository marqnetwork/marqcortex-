-- ============================================================================
-- HIGH-3 — the reviewed roster stamping artifact, driven for real.
--
-- The thing this replaces was an `UPDATE auth.users … FROM (VALUES …)` in a
-- markdown file. Every assertion below is a way that paragraph could have gone
-- wrong in production with nobody able to tell afterwards.
--
-- Runs on its own users, created here, so nothing it stamps or reverses can
-- disturb the bootstrap fixture the other harness files assert over.
-- ============================================================================

-- Fresh subjects for this file. `u1`/`u2` are the roster; `cust` is a customer
-- who must be unstampable; `dead` is a closed account.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000a0001', 'roster1@marq.test', '{}'::JSONB,
   '{"role": "team", "teamRole": "owner"}'::JSONB),
  ('00000000-0000-4000-8000-0000000a0002', 'roster2@marq.test',
   '{"platform_role": "admin"}'::JSONB, '{}'::JSONB),
  ('00000000-0000-4000-8000-0000000a0003', 'customer@example.test', '{}'::JSONB, '{}'::JSONB),
  ('00000000-0000-4000-8000-0000000a0004', 'closed@marq.test', '{}'::JSONB, '{}'::JSONB);

UPDATE auth.users SET deleted_at = now() WHERE id = '00000000-0000-4000-8000-0000000a0004';

-- A live membership in ANOTHER organization. This is what makes `a0003` a
-- customer rather than a colleague, and it is the only signal the artifact will
-- accept for that — never `user_metadata`.
INSERT INTO public.organizations (slug, name, status, plan)
VALUES ('acme-customer', 'Acme (customer)', 'active', 'standard')
ON CONFLICT DO NOTHING;

INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
SELECT o.id, '00000000-0000-4000-8000-0000000a0003', r.id, 'active', now()
FROM public.organizations o
JOIN public.roles r ON r.key = 'team_member' AND r.scope = 'platform'
                   AND r.is_system = true AND r.organization_id IS NULL
WHERE o.slug = 'acme-customer' AND o.deleted_at IS NULL;

DO $$
DECLARE
  v_u1       UUID := '00000000-0000-4000-8000-0000000a0001';
  v_u2       UUID := '00000000-0000-4000-8000-0000000a0002';
  v_customer UUID := '00000000-0000-4000-8000-0000000a0003';
  v_closed   UUID := '00000000-0000-4000-8000-0000000a0004';
  v_artifact TEXT := 'test-roster-2026-08-18';
  v_roster   JSONB;
  v_result   JSONB;
  v_meta     JSONB;
  v_count    INTEGER;
  v_failed   BOOLEAN;
  v_message  TEXT;

BEGIN
  v_roster := jsonb_build_array(
    jsonb_build_object('user_id', v_u1::TEXT, 'team_role', 'admin'),
    jsonb_build_object('user_id', v_u2::TEXT, 'team_role', 'analyst')
  );

  -- ---------------------------------------------------------------------
  -- REFUSAL: an empty roster. "Stamp everyone" begins as "stamp nobody".
  -- ---------------------------------------------------------------------
  v_failed := false;
  BEGIN
    PERFORM cortex.stamp_team_roster('[]'::JSONB, 0, v_artifact, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true; v_message := SQLERRM;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an empty roster was accepted'; END IF;
  IF v_message NOT LIKE '%empty%' THEN
    RAISE EXCEPTION 'the empty roster was refused for the wrong reason: %', v_message;
  END IF;

  -- ---------------------------------------------------------------------
  -- REFUSAL: an id that matches no live auth user, and a closed account.
  -- ---------------------------------------------------------------------
  v_failed := false;
  BEGIN
    PERFORM cortex.stamp_team_roster(
      jsonb_build_array(jsonb_build_object(
        'user_id', '00000000-0000-4000-8000-00000000dead', 'team_role', 'admin')),
      1, v_artifact, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an unknown auth user id was stamped'; END IF;

  v_failed := false;
  BEGIN
    PERFORM cortex.stamp_team_roster(
      jsonb_build_array(jsonb_build_object('user_id', v_closed::TEXT, 'team_role', 'admin')),
      1, v_artifact, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a deleted auth user was stamped'; END IF;

  -- ---------------------------------------------------------------------
  -- REFUSAL: the same person twice. Two intentions, and no way to pick.
  -- ---------------------------------------------------------------------
  v_failed := false;
  BEGIN
    PERFORM cortex.stamp_team_roster(
      jsonb_build_array(
        jsonb_build_object('user_id', v_u1::TEXT, 'team_role', 'admin'),
        jsonb_build_object('user_id', v_u1::TEXT, 'team_role', 'viewer')),
      2, v_artifact, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true; v_message := SQLERRM;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a duplicate roster entry was accepted'; END IF;
  IF v_message NOT LIKE '%uplicate%' THEN
    RAISE EXCEPTION 'the duplicate was refused for the wrong reason: %', v_message;
  END IF;

  -- ---------------------------------------------------------------------
  -- REFUSAL: a role the console cannot issue — `platform_admin` included.
  -- ---------------------------------------------------------------------
  FOREACH v_message IN ARRAY ARRAY['platform_admin', 'superadmin', 'manager', ''] LOOP
    v_failed := false;
    BEGIN
      PERFORM cortex.stamp_team_roster(
        jsonb_build_array(jsonb_build_object('user_id', v_u1::TEXT, 'team_role', v_message)),
        1, v_artifact, false);
    EXCEPTION WHEN OTHERS THEN v_failed := true;
    END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'the roster accepted the role %', quote_literal(v_message);
    END IF;
  END LOOP;

  -- A malformed id is refused before anything is read from it.
  v_failed := false;
  BEGIN
    PERFORM cortex.stamp_team_roster(
      jsonb_build_array(jsonb_build_object('user_id', 'not-a-uuid', 'team_role', 'admin')),
      1, v_artifact, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a malformed user id was accepted'; END IF;

  -- ---------------------------------------------------------------------
  -- REFUSAL: a customer. The accident the artifact exists to prevent.
  -- ---------------------------------------------------------------------
  v_failed := false;
  BEGIN
    PERFORM cortex.stamp_team_roster(
      jsonb_build_array(
        jsonb_build_object('user_id', v_u1::TEXT, 'team_role', 'admin'),
        jsonb_build_object('user_id', v_customer::TEXT, 'team_role', 'admin')),
      2, v_artifact, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true; v_message := SQLERRM;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a member of another organization was stamped as MARQ staff'; END IF;
  IF v_message NOT LIKE '%another organization%' THEN
    RAISE EXCEPTION 'the customer was refused for the wrong reason: %', v_message;
  END IF;

  -- ATOMICITY. That roster held one valid entry and one refused one. The valid
  -- one must NOT have been stamped: a reviewed roster applies whole or not at
  -- all.
  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_u1;
  IF v_meta ? 'marq_team' THEN
    RAISE EXCEPTION 'a partially valid roster stamped its valid half';
  END IF;

  -- ---------------------------------------------------------------------
  -- REFUSAL: the count under review is the count applied.
  -- ---------------------------------------------------------------------
  v_failed := false;
  BEGIN
    PERFORM cortex.stamp_team_roster(v_roster, 3, v_artifact, false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a roster whose length disagreed with the expected count was applied'; END IF;

  -- ---------------------------------------------------------------------
  -- DRY RUN: a plan, and not one byte written.
  -- ---------------------------------------------------------------------
  v_result := cortex.stamp_team_roster(v_roster, 2, v_artifact);   -- default: dry run
  IF (v_result ->> 'dry_run')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'stamp_team_roster mutated by default; the default must be the plan';
  END IF;
  IF jsonb_array_length(v_result -> 'plan') <> 2 THEN
    RAISE EXCEPTION 'the dry run planned % entries, expected 2', jsonb_array_length(v_result -> 'plan');
  END IF;

  SELECT COUNT(*) INTO v_count FROM auth.users
  WHERE id IN (v_u1, v_u2) AND (raw_app_meta_data ->> 'marq_team') = 'true';
  IF v_count <> 0 THEN RAISE EXCEPTION 'the dry run stamped % account(s)', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM cortex.team_roster_stamp_log WHERE artifact = v_artifact;
  IF v_count <> 0 THEN RAISE EXCEPTION 'the dry run wrote % provenance row(s)', v_count; END IF;

  -- ---------------------------------------------------------------------
  -- APPLY.
  -- ---------------------------------------------------------------------
  v_result := cortex.stamp_team_roster(v_roster, 2, v_artifact, false);
  IF (v_result ->> 'stamped')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'the apply stamped %, expected 2', v_result ->> 'stamped';
  END IF;

  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_u1;
  IF (v_meta ->> 'marq_team') <> 'true' OR (v_meta ->> 'team_role') <> 'admin' THEN
    RAISE EXCEPTION 'the stamp did not take: %', v_meta;
  END IF;

  -- MERGED, not replaced: an unrelated key survives, and `platform_role` is
  -- neither written nor destroyed by a lifecycle that has no business with it.
  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_u2;
  IF (v_meta ->> 'platform_role') <> 'admin' THEN
    RAISE EXCEPTION 'the stamp destroyed an unrelated app_metadata key: %', v_meta;
  END IF;
  IF (v_meta ->> 'team_role') <> 'analyst' THEN
    RAISE EXCEPTION 'the stamp wrote the wrong role: %', v_meta;
  END IF;

  -- No `user_metadata` was read to decide any of this: `u1` claims `owner`
  -- there and was stamped `admin`, which is what the roster said.
  IF (SELECT raw_user_meta_data ->> 'teamRole' FROM auth.users WHERE id = v_u1) <> 'owner' THEN
    RAISE EXCEPTION 'fixture drift: u1 should still claim owner in user_metadata';
  END IF;

  -- PROVENANCE: user id, intended role, artifact, timestamp, and the before/after.
  SELECT COUNT(*) INTO v_count FROM cortex.team_roster_stamp_log
  WHERE artifact = v_artifact AND reverted_at IS NULL
    AND user_id IN (v_u1, v_u2)
    AND team_role IN ('admin', 'analyst')
    AND stamped_at IS NOT NULL
    AND stamped_by IS NOT NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'the ledger holds % complete provenance row(s), expected 2', v_count;
  END IF;

  IF (SELECT previous_app_metadata FROM cortex.team_roster_stamp_log
      WHERE artifact = v_artifact AND user_id = v_u2) ->> 'platform_role' <> 'admin' THEN
    RAISE EXCEPTION 'the ledger did not record what was there before the stamp';
  END IF;

  -- ---------------------------------------------------------------------
  -- RERUN: same roster, same artifact. Idempotent in the users AND the ledger.
  -- ---------------------------------------------------------------------
  v_result := cortex.stamp_team_roster(v_roster, 2, v_artifact, false);
  IF (v_result ->> 'stamped')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'the rerun stamped %, expected 2', v_result ->> 'stamped';
  END IF;

  SELECT COUNT(*) INTO v_count FROM cortex.team_roster_stamp_log
  WHERE artifact = v_artifact AND reverted_at IS NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'the rerun left % live provenance rows, expected 2', v_count;
  END IF;

  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_u1;
  IF (v_meta ->> 'team_role') <> 'admin' OR (v_meta ->> 'marq_team') <> 'true' THEN
    RAISE EXCEPTION 'the rerun changed the stamp: %', v_meta;
  END IF;

  -- ---------------------------------------------------------------------
  -- REVERSAL.
  -- ---------------------------------------------------------------------
  -- An unknown artifact is a typo, not a no-op.
  v_failed := false;
  BEGIN
    PERFORM cortex.unstamp_team_roster('no-such-artifact', false);
  EXCEPTION WHEN OTHERS THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unstamping an unknown artifact was silently accepted'; END IF;

  -- An account changed since the stamp belongs to whoever changed it.
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || '{"team_role": "owner"}'::JSONB
  WHERE id = v_u1;

  v_result := cortex.unstamp_team_roster(v_artifact);    -- dry run first
  IF (v_result ->> 'modified_since_stamp')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'the reversal plan saw % modified account(s), expected 1', v_result ->> 'modified_since_stamp';
  END IF;

  v_result := cortex.unstamp_team_roster(v_artifact, false);
  IF (v_result ->> 'reverted')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'the reversal reverted %, expected 1 (the untouched account only)', v_result ->> 'reverted';
  END IF;

  -- The untouched one is back to what it carried before, `platform_role` intact.
  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_u2;
  IF v_meta ? 'marq_team' OR v_meta ? 'team_role' THEN
    RAISE EXCEPTION 'the reversal left the stamp behind: %', v_meta;
  END IF;
  IF (v_meta ->> 'platform_role') <> 'admin' THEN
    RAISE EXCEPTION 'the reversal destroyed an unrelated key: %', v_meta;
  END IF;

  -- The modified one was left exactly as its editor left it.
  SELECT raw_app_meta_data INTO v_meta FROM auth.users WHERE id = v_u1;
  IF (v_meta ->> 'team_role') <> 'owner' THEN
    RAISE EXCEPTION 'the reversal overwrote an account somebody had edited: %', v_meta;
  END IF;

  RAISE NOTICE 'assert_roster_stamping: PASSED';
END $$;
