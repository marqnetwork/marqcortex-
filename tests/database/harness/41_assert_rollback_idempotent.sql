-- ============================================================================
-- Membership bootstrap harness — the rollback runs a second time.
--
-- A rollback that is not idempotent is a rollback nobody can safely re-run
-- after a partial failure. The ledger's `rolled_back_at` is what makes the
-- second run a no-op, and the soft delete would make it one anyway — this
-- asserts both, by pinning the exact counts the first run produced.
-- ============================================================================

DO $$
DECLARE
  v_org      UUID;
  v_reverted INTEGER;
  v_live     INTEGER;
  v_analyst  TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_reverted
  FROM cortex.membership_bootstrap_log WHERE rolled_back_at IS NOT NULL;
  ASSERT v_reverted = 5,
    format('the second rollback marked %s ledger rows reverted, expected the first run''s 5', v_reverted);

  SELECT COUNT(*) INTO v_live
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.deleted_at IS NULL AND m.status = 'active';
  ASSERT v_live = 4,
    format('the second rollback revoked more: %s live active memberships, expected 4', v_live);

  -- The modified row is still skipped, not caught on the second pass.
  SELECT m.deleted_at INTO v_analyst
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-00000000bbb2';
  ASSERT v_analyst IS NULL, 'the second rollback revoked the re-roled membership';

  RAISE NOTICE 'assert_rollback_idempotent: PASSED';
END $$;
