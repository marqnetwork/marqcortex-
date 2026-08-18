-- ============================================================================
-- Membership bootstrap harness — assertions after a SECOND identical run.
--
-- Idempotency is the property that makes the migration safe to leave in the
-- migration directory. It is also the property most likely to be quietly lost:
-- a change to the guard, the mapping or the ledger's conflict clause can turn a
-- no-op re-run into duplicate rows or a raised unique violation, and neither
-- shows up in a single-run test.
-- ============================================================================

DO $$
DECLARE
  v_org     UUID;
  v_ledger  INTEGER;
  v_live    INTEGER;
  v_touched INTEGER;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_ledger FROM cortex.membership_bootstrap_log;
  ASSERT v_ledger = 6, format('the re-run changed the ledger to %s row(s)', v_ledger);

  SELECT COUNT(*) INTO v_live
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.deleted_at IS NULL AND m.status = 'active';
  ASSERT v_live = 8, format('the re-run left %s live active memberships, expected 8', v_live);

  -- Nothing was UPDATEd either: every recorded row still carries the
  -- `updated_at` the first run wrote.
  SELECT COUNT(*) INTO v_touched
  FROM cortex.membership_bootstrap_log l
  JOIN public.organization_memberships m ON m.id = l.membership_id
  WHERE m.updated_at <> l.row_updated_at;
  ASSERT v_touched = 0, format('the re-run modified %s existing membership(s)', v_touched);

  RAISE NOTICE 'assert_rerun: PASSED';
END $$;
