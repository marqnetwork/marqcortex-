-- ============================================================================
-- Membership bootstrap harness — assertions after the FIRST run.
--
-- Every assertion names a finding it exists for. An assertion that fires stops
-- the run (psql -v ON_ERROR_STOP=1), so the harness is green only if all of
-- them hold.
-- ============================================================================

DO $$
DECLARE
  v_org        UUID;
  v_created    INTEGER;
  v_ledger     INTEGER;
  v_role       TEXT;
  v_status     TEXT;
  v_deleted    TIMESTAMPTZ;
  v_count      INTEGER;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;
  ASSERT v_org IS NOT NULL, 'fixture: MARQ organization missing';

  -- -------------------------------------------------------------------------
  -- The bootstrap created exactly the six eligible, undecided users.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_created FROM cortex.membership_bootstrap_log;
  ASSERT v_created = 6,
    format('expected 6 bootstrap-created memberships, found %s', v_created);

  -- M4: NON-VACUOUS. A harness that admitted nobody would satisfy every
  -- negative assertion below while proving nothing at all.
  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.deleted_at IS NULL AND m.status = 'active';
  ASSERT v_count = 8,
    format('expected 8 live active memberships (6 created + 2 pre-existing), found %s', v_count);

  -- -------------------------------------------------------------------------
  -- L2/L3: the ONE role mapping, applied.
  -- -------------------------------------------------------------------------
  -- One statement per user, so a failure names the user and the role it got.
  SELECT r.key INTO v_role FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-00000000aaa1' AND m.deleted_at IS NULL;
  ASSERT v_role = 'org_admin', format('owner mapped to %s', v_role);

  SELECT r.key INTO v_role FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-00000000bbb2' AND m.deleted_at IS NULL;
  ASSERT v_role = 'team_member', format('analyst mapped to %s', v_role);

  SELECT r.key INTO v_role FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-00000000ccc3' AND m.deleted_at IS NULL;
  ASSERT v_role = 'team_viewer', format('viewer mapped to %s', v_role);

  SELECT r.key INTO v_role FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-00000000ddd4' AND m.deleted_at IS NULL;
  ASSERT v_role = 'team_viewer', format('a user with no asserted role mapped to %s', v_role);

  -- L2/L3, the escalation this closes: `manager` used to map to `org_admin`.
  SELECT r.key INTO v_role FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-00000000eee5' AND m.deleted_at IS NULL;
  ASSERT v_role = 'team_viewer', format('legacy manager mapped to %s, expected team_viewer', v_role);

  -- -------------------------------------------------------------------------
  -- M2: user_metadata cannot admit anybody.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count FROM public.organization_memberships m
    WHERE m.user_id = '00000000-0000-4000-8000-0000000f0001';
  ASSERT v_count = 0,
    'a user asserting role=team/teamRole=owner in USER metadata was admitted';

  SELECT COUNT(*) INTO v_count FROM public.organization_memberships m
    WHERE m.user_id IN (
      '00000000-0000-4000-8000-0000000f0002',  -- deleted
      '00000000-0000-4000-8000-0000000f0003'   -- banned
    );
  ASSERT v_count = 0, 'a deleted or banned auth user was admitted';

  -- An expired ban is not a ban: this one IS admitted, which is what keeps the
  -- ban check from being "exclude anybody who was ever banned".
  SELECT COUNT(*) INTO v_count FROM public.organization_memberships m
    WHERE m.user_id = '00000000-0000-4000-8000-0000000f0004' AND m.deleted_at IS NULL;
  ASSERT v_count = 1, 'a user whose ban has expired was not admitted';

  -- -------------------------------------------------------------------------
  -- H2: any historical membership blocks re-admission.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count FROM public.organization_memberships m
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000e0001';
  ASSERT v_count = 1,
    format('the soft-deleted member gained a %s-row membership history', v_count);

  SELECT deleted_at INTO v_deleted FROM public.organization_memberships m
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000e0001';
  ASSERT v_deleted IS NOT NULL, 'the soft-deleted membership was revived';

  -- And nothing about them reached the ledger, so the rollback has no claim on
  -- them either.
  SELECT COUNT(*) INTO v_count FROM cortex.membership_bootstrap_log
    WHERE user_id = '00000000-0000-4000-8000-0000000e0001';
  ASSERT v_count = 0, 'the bootstrap recorded a membership it did not create';

  -- Suspended stays suspended.
  SELECT status, COUNT(*) OVER () INTO v_status, v_count
  FROM public.organization_memberships m
  WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000e0002';
  ASSERT v_status = 'suspended' AND v_count = 1,
    format('the suspended membership is now status=%s across %s row(s)', v_status, v_count);

  -- A pre-existing member keeps the role they were given, not the mapped one.
  SELECT r.key INTO v_role FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.organization_id = v_org AND m.user_id = '00000000-0000-4000-8000-0000000e0003' AND m.deleted_at IS NULL;
  ASSERT v_role = 'org_admin',
    format('a pre-existing org_admin was re-roled to %s (their app metadata says viewer)', v_role);

  -- -------------------------------------------------------------------------
  -- platform_admin: never minted, never touched.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count
  FROM cortex.membership_bootstrap_log l
  JOIN public.roles r ON r.id = l.role_id
  WHERE r.key = 'platform_admin';
  ASSERT v_count = 0, 'the bootstrap created a platform_admin membership';

  SELECT COUNT(*) INTO v_count
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id
  WHERE m.user_id = '00000000-0000-4000-8000-0000000e0004'
    AND r.key = 'platform_admin' AND m.status = 'active' AND m.deleted_at IS NULL;
  ASSERT v_count = 1, 'the platform administrator membership was disturbed';

  -- -------------------------------------------------------------------------
  -- L1: every created membership carries a seeded platform-scope system role.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count
  FROM cortex.membership_bootstrap_log l
  JOIN public.roles r ON r.id = l.role_id
  WHERE r.scope <> 'platform' OR r.is_system IS DISTINCT FROM true OR r.organization_id IS NOT NULL;
  ASSERT v_count = 0, format('%s created membership(s) carry a role outside the seeded catalog', v_count);

  -- Nobody holds two live memberships anywhere.
  SELECT COUNT(*) INTO v_count FROM (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.deleted_at IS NULL
    GROUP BY m.organization_id, m.user_id
    HAVING COUNT(*) > 1
  ) d;
  ASSERT v_count = 0, format('%s (org, user) pair(s) hold duplicate live memberships', v_count);

  -- The ledger describes reality: role, status and updated_at as written.
  SELECT COUNT(*) INTO v_ledger
  FROM cortex.membership_bootstrap_log l
  JOIN public.organization_memberships m ON m.id = l.membership_id
  WHERE m.role_id = l.role_id AND m.status = l.status AND m.updated_at = l.row_updated_at;
  ASSERT v_ledger = 6, format('%s of 6 ledger rows match the membership they name', v_ledger);

  RAISE NOTICE 'assert_bootstrap: PASSED';
END $$;
