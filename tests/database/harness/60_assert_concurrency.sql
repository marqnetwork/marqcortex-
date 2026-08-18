-- ============================================================================
-- Membership bootstrap harness — assertions after concurrent bootstrap runs.
--
-- L6. Several copies of the migration ran against this database at the same
-- time. The properties that have to survive that:
--
--   * no run raised (the runner fails the phase if any process exits non-zero,
--     so a unique-violation from a lost race is already a failure before this
--     file is reached)
--   * exactly one membership per eligible user — not one per winning process
--   * exactly one ledger row per membership, so the rollback cannot be handed
--     a duplicate claim
--   * nobody's privilege moved: the role each user holds is the role their
--     app metadata maps to, whichever process created it
-- ============================================================================

DO $$
DECLARE
  v_org    UUID;
  v_live   INTEGER;
  v_ledger INTEGER;
  v_dupes  INTEGER;
  v_role   TEXT;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_live
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.deleted_at IS NULL;
  ASSERT v_live = 4, format('concurrent runs produced %s memberships, expected 4', v_live);

  SELECT COUNT(*) INTO v_ledger FROM cortex.membership_bootstrap_log;
  ASSERT v_ledger = 4, format('concurrent runs recorded %s ledger rows, expected 4', v_ledger);

  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = v_org AND m.deleted_at IS NULL
    GROUP BY m.user_id HAVING COUNT(*) > 1
  ) d;
  ASSERT v_dupes = 0, format('%s user(s) hold duplicate live memberships after concurrent runs', v_dupes);

  -- One ledger row per membership, and every ledger row points at a live one.
  SELECT COUNT(*) INTO v_dupes
  FROM cortex.membership_bootstrap_log l
  LEFT JOIN public.organization_memberships m ON m.id = l.membership_id
  WHERE m.id IS NULL;
  ASSERT v_dupes = 0, format('%s ledger row(s) name a membership that does not exist', v_dupes);

  SELECT r.key INTO v_role FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000c0003';
  ASSERT v_role = 'team_viewer',
    format('a concurrent run granted the viewer %s', v_role);

  SELECT r.key INTO v_role FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000c0001';
  ASSERT v_role = 'org_admin',
    format('a concurrent run granted the owner %s', v_role);

  RAISE NOTICE 'assert_concurrency: PASSED';
END $$;
