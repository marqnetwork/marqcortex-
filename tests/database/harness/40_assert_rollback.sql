-- ============================================================================
-- Membership bootstrap harness — assertions after the rollback.
--
-- This is H1's regression, stated as five properties the review named:
--
--   * a pre-existing active membership survives
--   * a membership created after the bootstrap survives
--   * a bootstrap-created membership is rolled back
--   * a modified bootstrap membership is not destructively overwritten
--   * platform_admin is untouched
-- ============================================================================

DO $$
DECLARE
  v_org      UUID;
  v_count    INTEGER;
  v_role     TEXT;
  v_deleted  TIMESTAMPTZ;
  v_status   TEXT;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  -- -------------------------------------------------------------------------
  -- A bootstrap-created membership IS rolled back.
  -- Five of the six: the sixth (the analyst) was re-roled and is handled below.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count
  FROM cortex.membership_bootstrap_log l
  JOIN public.organization_memberships m ON m.id = l.membership_id
  WHERE m.deleted_at IS NOT NULL AND l.rolled_back_at IS NOT NULL;
  ASSERT v_count = 5,
    format('expected 5 bootstrap memberships rolled back, found %s', v_count);

  FOR v_role IN
    SELECT unnest(ARRAY[
      '00000000-0000-4000-8000-00000000aaa1',
      '00000000-0000-4000-8000-00000000ccc3',
      '00000000-0000-4000-8000-00000000ddd4',
      '00000000-0000-4000-8000-00000000eee5',
      '00000000-0000-4000-8000-0000000f0004'
    ])
  LOOP
    SELECT m.deleted_at INTO v_deleted
    FROM public.organization_memberships m
    WHERE m.organization_id = v_org AND m.user_id = v_role::uuid;
    ASSERT v_deleted IS NOT NULL,
      format('bootstrap membership for %s was not rolled back', v_role);
  END LOOP;

  -- Soft delete, not DELETE: the row and its audit trail are still there.
  SELECT COUNT(*) INTO v_count
  FROM cortex.membership_bootstrap_log l
  JOIN public.organization_memberships m ON m.id = l.membership_id;
  ASSERT v_count = 6, format('%s of 6 bootstrap membership rows still exist', v_count);

  -- -------------------------------------------------------------------------
  -- A MODIFIED bootstrap membership is left alone — not reverted, and not
  -- destructively reset to the role the bootstrap once gave it.
  -- -------------------------------------------------------------------------
  SELECT m.deleted_at, r.key INTO v_deleted, v_role
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-00000000bbb2';
  ASSERT v_deleted IS NULL, 'the re-roled bootstrap membership was rolled back anyway';
  ASSERT v_role = 'org_admin',
    format('the re-roled membership is now %s — the rollback overwrote the administrator''s change', v_role);

  SELECT COUNT(*) INTO v_count FROM cortex.membership_bootstrap_log
  WHERE user_id = '00000000-0000-4000-8000-00000000bbb2' AND rolled_back_at IS NULL;
  ASSERT v_count = 1, 'the ledger claims a modified membership was rolled back';

  -- -------------------------------------------------------------------------
  -- A PRE-EXISTING active membership survives.
  -- -------------------------------------------------------------------------
  SELECT m.deleted_at, r.key INTO v_deleted, v_role
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000e0003';
  ASSERT v_deleted IS NULL, 'a membership that predates the bootstrap was revoked by its rollback';
  ASSERT v_role = 'org_admin', format('a pre-existing membership was re-roled to %s', v_role);

  -- -------------------------------------------------------------------------
  -- A membership created AFTER the bootstrap survives.
  -- -------------------------------------------------------------------------
  SELECT m.deleted_at INTO v_deleted
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000e0005';
  ASSERT v_deleted IS NULL, 'a membership created after the bootstrap was revoked by its rollback';

  -- -------------------------------------------------------------------------
  -- platform_admin is untouched.
  -- -------------------------------------------------------------------------
  SELECT m.deleted_at, m.status INTO v_deleted, v_status
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.organization_id = v_org
    AND m.user_id = '00000000-0000-4000-8000-0000000e0004'
    AND r.key = 'platform_admin';
  ASSERT v_deleted IS NULL AND v_status = 'active',
    format('the platform administrator membership is deleted_at=%s status=%s', v_deleted, v_status);

  -- The suspended and already-removed rows are still exactly as they were.
  SELECT m.status, m.deleted_at INTO v_status, v_deleted
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000e0002';
  ASSERT v_status = 'suspended' AND v_deleted IS NULL,
    format('the suspended membership is now status=%s deleted_at=%s', v_status, v_deleted);

  RAISE NOTICE 'assert_rollback: PASSED';
END $$;
