-- ============================================================================
-- Membership bootstrap harness — the heuristic H1 replaced, demonstrated.
--
-- A regression test proves the new behaviour. This one proves the old behaviour
-- was wrong, on the same rows, in the same database — so the change is not
-- taken on trust, and so a future edit that quietly reintroduces the heuristic
-- has something that fails.
--
-- The old rollback selected its own rows as:
--
--     MARQ, status = 'active', deleted_at IS NULL,
--     a system role other than platform_admin,
--     updated_at = created_at
--
-- Evaluated here, that predicate matches memberships the bootstrap never
-- created — including one an administrator created before it ever ran. Every
-- one of those would have been soft-deleted by a rollback whose entire stated
-- purpose was to touch nothing but its own work.
-- ============================================================================

DO $$
DECLARE
  v_org        UUID;
  v_heuristic  INTEGER;
  v_collateral INTEGER;
  v_ledger     INTEGER;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL;

  CREATE TEMP TABLE _heuristic_matches ON COMMIT DROP AS
  SELECT m.id, m.user_id
  FROM public.organization_memberships m
  JOIN public.organizations o ON o.id = m.organization_id
  JOIN public.roles r ON r.id = m.role_id
  WHERE o.slug = 'marq'
    AND o.deleted_at IS NULL
    AND r.is_system = true
    AND r.key <> 'platform_admin'
    AND m.status = 'active'
    AND m.deleted_at IS NULL
    AND m.updated_at = m.created_at;

  SELECT COUNT(*) INTO v_heuristic FROM _heuristic_matches;
  SELECT COUNT(*) INTO v_ledger FROM cortex.membership_bootstrap_log;

  -- The collateral: rows the heuristic claims that the bootstrap did not create.
  SELECT COUNT(*) INTO v_collateral
  FROM _heuristic_matches h
  WHERE NOT EXISTS (
    SELECT 1 FROM cortex.membership_bootstrap_log l WHERE l.membership_id = h.id
  );

  ASSERT v_heuristic > v_ledger,
    format('the heuristic matched %s row(s) and the bootstrap created %s — the scenario no longer demonstrates the defect',
           v_heuristic, v_ledger);

  ASSERT v_collateral >= 1,
    'the heuristic matched nothing the bootstrap did not create, so this fixture no longer covers H1';

  -- Named, so the failure is a person and not a number: the pre-existing
  -- org_admin, created before the bootstrap and never edited since.
  ASSERT EXISTS (
    SELECT 1 FROM _heuristic_matches h
    WHERE h.user_id = '00000000-0000-4000-8000-0000000e0003'
  ), 'the pre-existing org_admin is no longer caught by the old heuristic';

  ASSERT NOT EXISTS (
    SELECT 1 FROM cortex.membership_bootstrap_log l
    WHERE l.user_id = '00000000-0000-4000-8000-0000000e0003'
  ), 'the ledger claims the bootstrap created the pre-existing org_admin';

  RAISE NOTICE 'assert_heuristic_was_unsafe: PASSED — the old predicate matched % row(s), % of them not the bootstrap''s',
    v_heuristic, v_collateral;
END $$;
