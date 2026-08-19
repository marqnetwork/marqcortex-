-- ============================================================================
-- AI-01 Batch 4A remediation — roll back the MARQ membership lifecycle
-- WARNING: Run only in staging/dev, and only when the lifecycle must be undone.
--
-- WHAT THIS FILE DOES, AND WHAT IT DELIBERATELY DOES NOT
--
-- It drops the FUNCTIONS this migration added. It does not touch a single row
-- of `auth.users` or `public.organization_memberships`, and that restraint is
-- the design, not an omission:
--
--   * The memberships the lifecycle created were created by an administrator
--     inviting or re-roling somebody. They are the console's work, not this
--     migration's, and a migration rollback that revoked a colleague's access
--     because a DDL change was being reverted would be doing something nobody
--     asked for.
--
--   * The `app_metadata` stamps were applied by a reviewed roster with its own
--     ledger and its own reversal. Undoing them belongs to
--     `cortex.unstamp_team_roster`, driven by artifact — see below.
--
-- REVERSING THE WHOLE THING, IN ORDER
--
-- If the intent is to return a deployment to "no MARQ team memberships and no
-- stamped accounts", run these in this order and no other. Each step assumes
-- the one before it:
--
--   1. Reverse each stamping artifact, WHILE THIS MIGRATION IS STILL APPLIED —
--      `cortex.unstamp_team_roster` is dropped by the file you are reading:
--
--        SELECT artifact, COUNT(*) FROM cortex.team_roster_stamp_log
--        WHERE reverted_at IS NULL GROUP BY artifact;
--
--        node scripts/roster/stamp-team-roster.mjs --artifact=<id> --unstamp --apply
--
--      Unstamped accounts stop being team accounts at once: `verifyTeamToken`
--      refuses them, and the AI path grants them no role.
--
--   2. Roll back the bootstrap, which soft-deletes the memberships IT created
--      and leaves every other membership alone:
--
--        psql -f supabase/migrations/rollbacks/20260818120000_rollback_membership_bootstrap.sql
--
--      Memberships created by the CONSOLE are not in that ledger and survive on
--      purpose. Revoking one is an administrative act:
--      `SELECT public.marq_revoke_team_membership('<user id>');` — also before
--      running this file.
--
--   3. Run this file.
--
-- A NOTE ON WHAT REMAINS
--
-- `cortex.membership_lifecycle_log` and `cortex.team_roster_stamp_log` are kept.
-- They are the record of who was granted what and when, and a rollback that
-- erased its own audit trail would leave nobody able to answer that question
-- afterwards. Both are internal to the `cortex` schema, granted to nobody, and
-- the tenancy rollback's `DROP SCHEMA cortex CASCADE` removes them when the
-- whole tenancy model goes.
-- ============================================================================

BEGIN;

-- Guard: refuse to strip the lifecycle while a stamping artifact is still live.
-- Dropping `unstamp_team_roster` with unreversed stamps on the table would
-- strand them — the ledger would survive with nothing able to read it back out,
-- and the accounts would stay stamped with no supported way to undo it.
DO $$
DECLARE
  v_live INTEGER := 0;
BEGIN
  IF to_regclass('cortex.team_roster_stamp_log') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_live
    FROM cortex.team_roster_stamp_log WHERE reverted_at IS NULL;
  END IF;

  IF v_live > 0 THEN
    RAISE EXCEPTION
      'membership lifecycle rollback refused: % stamping record(s) are still live. Reverse them first (step 1 in this file''s header) — dropping cortex.unstamp_team_roster now would leave them with no supported reversal.',
      v_live;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.marq_sync_team_membership(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.marq_revoke_team_membership(UUID, UUID);
DROP FUNCTION IF EXISTS cortex.stamp_team_roster(JSONB, INTEGER, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS cortex.unstamp_team_roster(TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS cortex.marq_organization_id_strict();
DROP FUNCTION IF EXISTS cortex.system_role_id(TEXT);
DROP FUNCTION IF EXISTS cortex.organization_role_for_team_role(TEXT);
DROP FUNCTION IF EXISTS cortex.team_roles();

DO $$
BEGIN
  RAISE NOTICE 'membership lifecycle rollback: functions dropped. Memberships, stamps and both provenance ledgers were left untouched — see the header for the ordered reversal.';
END $$;

COMMIT;
