-- ============================================================================
-- MED-2 — after the bootstrap has refused, nothing may remain.
--
-- The migration is one transaction, so a failure must take the memberships, the
-- provenance ledger and the ledger TABLE itself with it. "Failed loudly" and
-- "left half a roster behind" would be a worse outcome than the silent short
-- admission it replaces.
-- ============================================================================

DO $$
DECLARE
  v_org        UUID;
  v_memberships INTEGER;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_memberships
  FROM public.organization_memberships
  WHERE organization_id = v_org;

  IF v_memberships <> 0 THEN
    RAISE EXCEPTION 'MED-2: the failed bootstrap left % membership row(s) behind', v_memberships;
  END IF;

  -- The ledger is created inside the same transaction, so a rolled-back run
  -- leaves no table at all. Its presence would mean the DDL committed while the
  -- data did not.
  IF to_regclass('cortex.membership_bootstrap_log') IS NOT NULL THEN
    RAISE EXCEPTION 'MED-2: the failed bootstrap left its provenance ledger behind';
  END IF;

  -- And the viewer, whose role key WAS present, must not have been admitted
  -- alone. Admitting the users a broken catalog happens to cover is the exact
  -- partial success this refuses.
  IF EXISTS (
    SELECT 1 FROM public.organization_memberships
    WHERE user_id = '00000000-0000-4000-8000-0000000b0003'
  ) THEN
    RAISE EXCEPTION 'MED-2: the bootstrap admitted the users the broken catalog covered';
  END IF;

  RAISE NOTICE 'assert_med2_no_partial_state: PASSED';
END $$;
