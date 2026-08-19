-- ============================================================================
-- MED-2, second arm — nothing committed after a short write.
-- ============================================================================

DO $$
DECLARE
  v_org UUID;
  v_rows INTEGER;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_rows
  FROM public.organization_memberships WHERE organization_id = v_org;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'MED-2 (short write): % membership row(s) survived a run that could not admit everybody', v_rows;
  END IF;

  IF to_regclass('cortex.membership_bootstrap_log') IS NOT NULL THEN
    RAISE EXCEPTION 'MED-2 (short write): the provenance ledger survived a failed run';
  END IF;

  RAISE NOTICE 'assert_med2_silent_drop: PASSED';
END $$;
