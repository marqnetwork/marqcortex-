-- ============================================================================
-- The rollback for 20260819120000, driven for real.
--
-- Runs immediately after 85, so it reverses a migration whose functions have
-- just been exercised rather than one that was only applied.
--
-- Three properties, and the third is the one a rollback file usually gets wrong:
--
--   1. The three added functions are gone.
--   2. `marq_sync_team_membership` still works, at the 20260818130000
--      reporting behaviour. A rollback that left a broken membership write
--      behind would take the console down to undo a reporting change.
--   3. THE RELEASE PROVENANCE SURVIVES. `released_reason` and
--      `released_app_metadata` record why an operator force-removed somebody's
--      team status. Dropping them to undo a DDL change would destroy the audit
--      record of the actions the migration exists to make auditable.
-- ============================================================================

DO $$
DECLARE
  v_racer  UUID := '00000000-0000-4000-8000-0000000b0003';
  v_count  INTEGER;
  v_result JSONB;
BEGIN
  -- 3. Provenance first, because it is what the rollback is most tempted to
  --    remove. It was written by 85 and must still be readable.
  SELECT COUNT(*) INTO v_count
  FROM cortex.team_roster_stamp_log
  WHERE released_reason IS NOT NULL AND released_app_metadata IS NOT NULL;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'rollback: the release provenance was destroyed, or never written';
  END IF;

  -- 1. The added functions are gone.
  FOR v_count IN
    SELECT COUNT(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cortex'
      AND p.proname IN ('release_team_stamp', 'team_stamp_drift', 'orphaned_team_accounts')
  LOOP
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'rollback: % recovery function(s) survived', v_count;
    END IF;
  END LOOP;

  -- 2. The membership write still works, and reports the pre-migration way.
  v_result := public.marq_sync_team_membership(v_racer, 'viewer');
  IF v_result ->> 'role_key' <> 'team_viewer' THEN
    RAISE EXCEPTION 'rollback: the membership write is broken, returned %', v_result;
  END IF;
  IF v_result ->> 'action' NOT IN ('created', 'role_changed', 'unchanged') THEN
    RAISE EXCEPTION 'rollback: the restored function reported %, outside its own vocabulary',
      v_result ->> 'action';
  END IF;

  -- The `reconciled` arm really is gone — this is the reporting rollback the
  -- file claims to be, not a no-op that left the new body in place.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'marq_sync_team_membership'
      AND position('reconciled' IN p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'rollback: the new reporting body is still installed';
  END IF;

  RAISE NOTICE 'assert_recovery_rollback: PASSED';
END $$;
