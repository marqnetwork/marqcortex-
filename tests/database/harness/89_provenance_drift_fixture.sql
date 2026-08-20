-- ============================================================================
-- A HALF-APPLIED PROMOTION, PLANTED BEFORE THE PROVENANCE MIGRATION RUNS.
--
-- This is finding HIGH-1 as a row: `applyTeamRoleChange` wrote the trusted
-- `app_metadata` first, the membership write failed, and the compensating
-- revert failed too. The account is left carrying `team_role = 'consultant'`
-- beside a `team_member` row that was last SYNCED at `reviewer`.
--
-- It exists so `90_assert_authority_provenance.sql` can prove what the backfill
-- read. A backfill that read the metadata bag would write `consultant` here and
-- make a failed promotion permanent; a backfill that reads executed decisions
-- writes `reviewer`.
-- ============================================================================

DO $$
DECLARE
  v_drifted UUID := '00000000-0000-4000-8000-0000000c0001';
  v_org     UUID;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_drifted, 'halfpromoted@marq.test',
          '{"marq_team": true, "team_role": "reviewer"}'::JSONB, '{}'::JSONB);

  -- The membership write that DID land, at the role the account really held.
  PERFORM public.marq_sync_team_membership(v_drifted, 'reviewer');

  -- The trusted half of a promotion that then failed. Written directly, because
  -- that is precisely the state the lifecycle leaves behind when its second
  -- write and its compensating revert both fail.
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || '{"team_role": "consultant"}'::JSONB
  WHERE id = v_drifted;

  RAISE NOTICE 'provenance_drift_fixture: planted a half-applied promotion on %', v_drifted;
END $$;
