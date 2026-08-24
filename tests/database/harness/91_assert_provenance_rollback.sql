-- ============================================================================
-- The provenance rollback removed what it added and restored what it replaced,
-- and it did so WITHOUT revoking anything.
--
-- A rollback that widened access would be worse than the finding it reverses,
-- and a rollback that revoked memberships would be an outage. Both directions
-- are asserted.
-- ============================================================================

DO $$
DECLARE
  v_mover UUID := '00000000-0000-4000-8000-0000000c0002';
  v_count INTEGER;
  v_result JSONB;
BEGIN
  -- The column and the report are gone.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'organization_memberships'
    AND column_name = 'team_role';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rollback: organization_memberships.team_role survived';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'cortex' AND p.proname IN ('team_authority_drift', 'normalize_team_role');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'rollback: % provenance function(s) survived', v_count;
  END IF;

  -- Memberships were not touched. Nobody lost access to a rollback.
  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  WHERE m.user_id = v_mover AND m.deleted_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'rollback: the membership row was removed (found %)', v_count;
  END IF;

  -- The restored membership write still works, and still refuses to mint
  -- platform administration.
  v_result := public.marq_sync_team_membership(v_mover, 'analyst');
  IF v_result ->> 'role_key' <> 'team_member' THEN
    RAISE EXCEPTION 'rollback: the restored membership write reported %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.deleted_at IS NULL AND r.key = 'platform_admin' AND m.user_id = v_mover;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'rollback: the restored membership write produced a platform_admin membership';
  END IF;

  -- The restored roster stamp still applies, and still writes app_metadata.
  v_result := cortex.stamp_team_roster(
    jsonb_build_array(jsonb_build_object('user_id', v_mover::TEXT, 'team_role', 'reviewer')),
    1, 'provenance-rollback-probe', FALSE);
  IF (v_result ->> 'stamped') <> '1' THEN
    RAISE EXCEPTION 'rollback: the restored roster stamp reported %', v_result;
  END IF;

  RAISE NOTICE 'assert_provenance_rollback: PASSED';
END $$;
