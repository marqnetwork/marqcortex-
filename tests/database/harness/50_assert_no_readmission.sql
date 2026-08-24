-- ============================================================================
-- Membership bootstrap harness — the bootstrap runs a THIRD time, after the
-- rollback.
--
-- H2, from the other direction. The rollback soft-deletes; the forward
-- migration refuses any user who already holds a membership row, deleted
-- included. So a rolled-back operator does NOT quietly come back on the next
-- deploy, and the pair does not oscillate.
--
-- If this ever fails, the two halves disagree about what a tombstone means, and
-- the rollback has become a way to re-run the bootstrap with fresh timestamps.
-- ============================================================================

DO $$
DECLARE
  v_org    UUID;
  v_ledger INTEGER;
  v_live   INTEGER;
  v_rows   INTEGER;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_ledger FROM cortex.membership_bootstrap_log;
  ASSERT v_ledger = 6,
    format('the post-rollback run recorded new memberships: ledger holds %s row(s), expected 6', v_ledger);

  -- Only what survived the rollback: the re-roled analyst, the pre-existing
  -- org_admin, the platform administrator and the late joiner. Four live active
  -- memberships (the suspended row is live but not active), and not one of the
  -- rolled-back operators re-admitted.
  SELECT COUNT(*) INTO v_live
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.deleted_at IS NULL AND m.status = 'active';
  ASSERT v_live = 4,
    format('the post-rollback run left %s live memberships, expected 4', v_live);

  -- Nobody gained a second row alongside their tombstone.
  SELECT COUNT(*) INTO v_rows FROM (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = v_org
    GROUP BY m.user_id
    HAVING COUNT(*) > 1
  ) d;
  ASSERT v_rows = 0,
    format('%s user(s) hold a membership row alongside a rolled-back one', v_rows);

  RAISE NOTICE 'assert_no_readmission: PASSED';
END $$;
