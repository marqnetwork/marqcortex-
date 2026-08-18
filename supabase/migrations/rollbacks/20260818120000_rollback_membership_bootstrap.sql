-- ============================================================================
-- AI-01 Batch 4A — Rollback the MARQ team membership bootstrap
-- WARNING: Run only in staging/dev, and only when the bootstrap must be undone.
--
-- The forward migration creates membership ROWS, and those cannot be removed by
-- description. The previous version of this file tried, and identified its own
-- rows as:
--
--     status = 'active' AND updated_at = created_at
--
-- That is not provenance. `updated_at = created_at` is true of EVERY membership
-- nobody has edited yet, whoever created it and whenever — so this rollback
-- would have soft-deleted a membership an administrator created through the
-- console an hour ago, and a membership created by a completely different
-- process, with no way to tell any of them apart from its own. The one thing it
-- reliably excluded was a bootstrap row somebody HAD edited, which is the row it
-- most needed to leave alone anyway.
--
-- So the forward migration now records what it created, and this file reads
-- that ledger and nothing else:
--
--     cortex.membership_bootstrap_log
--
-- A row is soft-deleted only when the ledger names it AND the membership still
-- carries the role, the status and the exact `updated_at` the bootstrap wrote.
-- Any difference means somebody changed it since — and a changed row is theirs,
-- not this file's to reverse. Those are reported and skipped, never overwritten:
-- nothing here writes `role_id` or `status`, so a modified membership cannot be
-- destructively reset to what the bootstrap once put there.
--
-- Consequences of reading the ledger rather than guessing, all of them intended:
--
--   * A membership that existed BEFORE the bootstrap is untouched — it is not
--     in the ledger.
--   * A membership created AFTER the bootstrap, by the console or by hand, is
--     untouched — it is not in the ledger either.
--   * `platform_admin` is untouched, because the bootstrap never granted it and
--     therefore never recorded one. The explicit `key <> 'platform_admin'`
--     guard is kept below anyway: a rollback that could revoke platform
--     administration should be unable to, not merely unlikely to.
--
-- Soft delete, not DELETE: `deleted_at` is the tenancy model's own erasure, and
-- it leaves the audit trail intact. It also means the forward migration will not
-- re-admit these users on a later run — its guard refuses any user who already
-- holds a membership row, deleted included.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_recorded INTEGER := 0;
  v_reverted INTEGER := 0;
  v_modified INTEGER := 0;
BEGIN
  IF to_regclass('cortex.membership_bootstrap_log') IS NULL THEN
    RAISE NOTICE 'membership bootstrap rollback: no provenance ledger, so this migration never ran here. Nothing to undo.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_recorded
  FROM cortex.membership_bootstrap_log
  WHERE rolled_back_at IS NULL;

  WITH reverted AS (
    UPDATE public.organization_memberships m
    SET deleted_at = now()
    FROM cortex.membership_bootstrap_log l
    JOIN public.roles r ON r.id = l.role_id
    WHERE m.id = l.membership_id
      AND l.rolled_back_at IS NULL
      AND m.deleted_at IS NULL
      -- Still exactly as the bootstrap left it. Three columns, all recorded at
      -- insert time, none of them inferred.
      AND m.role_id   = l.role_id
      AND m.status    = l.status
      AND m.updated_at = l.row_updated_at
      -- Belt and braces on a role the bootstrap can never have written.
      AND r.key <> 'platform_admin'
    RETURNING m.id
  )
  UPDATE cortex.membership_bootstrap_log l
  SET rolled_back_at = now()
  FROM reverted
  WHERE l.membership_id = reverted.id;

  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  SELECT COUNT(*) INTO v_modified
  FROM cortex.membership_bootstrap_log l
  JOIN public.organization_memberships m ON m.id = l.membership_id
  WHERE l.rolled_back_at IS NULL
    AND m.deleted_at IS NULL
    AND (m.role_id <> l.role_id OR m.status <> l.status OR m.updated_at <> l.row_updated_at);

  RAISE NOTICE 'membership bootstrap rollback: % recorded, % reverted, % modified since creation and left alone',
    v_recorded, v_reverted, v_modified;
END $$;

COMMIT;
