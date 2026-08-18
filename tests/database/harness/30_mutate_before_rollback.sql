-- ============================================================================
-- Membership bootstrap harness — what happens between the bootstrap and the
-- rollback.
--
-- H1's regression needs the world to have MOVED ON before the rollback runs.
-- Two things happen here, and each one is a row the old `updated_at =
-- created_at` rollback got wrong:
--
--   1. A NEW member joins. `updated_at = created_at` is true of their row too,
--      so the old rollback would have soft-deleted a membership created after
--      it, by somebody else, for a person it never admitted.
--
--   2. An administrator RE-ROLES one of the bootstrap's own rows. The old
--      rollback skipped it (its `updated_at` had moved) which was accidentally
--      right — but for a reason that has nothing to do with provenance, and the
--      new rollback must skip it for the reason that does: the ledger says what
--      the bootstrap wrote, and this row no longer matches it.
-- ============================================================================

-- 1. A member who joins AFTER the bootstrap, through the console's invite path.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-4000-8000-0000000e0005', 'late@marq.test',
        '{"marq_team": true, "team_role": "admin"}'::jsonb, '{}'::jsonb);

INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
SELECT o.id, '00000000-0000-4000-8000-0000000e0005', r.id, 'active', now()
FROM public.organizations o
JOIN public.roles r
  ON r.key = 'org_admin' AND r.scope = 'platform' AND r.is_system = true AND r.organization_id IS NULL
WHERE o.slug = 'marq' AND o.deleted_at IS NULL;

-- 2. An administrator promotes the analyst the bootstrap admitted as a
--    `team_member`. The `organization_memberships_set_updated_at` trigger moves
--    `updated_at`; the ledger still holds the old role and the old timestamp.
UPDATE public.organization_memberships m
SET role_id = (
  SELECT r.id FROM public.roles r
  WHERE r.key = 'org_admin' AND r.scope = 'platform' AND r.is_system = true AND r.organization_id IS NULL
)
FROM public.organizations o
WHERE o.id = m.organization_id
  AND o.slug = 'marq'
  AND m.user_id = '00000000-0000-4000-8000-00000000bbb2'
  AND m.deleted_at IS NULL;

-- A guard on the harness itself: if the trigger ever stopped moving
-- `updated_at`, the scenario below would silently stop testing anything.
DO $$
DECLARE
  v_moved BOOLEAN;
BEGIN
  SELECT m.updated_at <> l.row_updated_at INTO v_moved
  FROM cortex.membership_bootstrap_log l
  JOIN public.organization_memberships m ON m.id = l.membership_id
  WHERE l.user_id = '00000000-0000-4000-8000-00000000bbb2';
  ASSERT v_moved, 'harness: the re-role did not change updated_at, so the modified-row scenario is vacuous';
END $$;
