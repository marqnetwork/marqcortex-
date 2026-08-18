-- ============================================================================
-- AI-01 Batch 4A — Rollback the MARQ team membership bootstrap
-- WARNING: Run only in staging/dev, and only when the bootstrap must be undone.
--
-- The forward migration creates no schema objects, so there is nothing to drop.
-- What it creates is membership ROWS, and those cannot be removed blindly: an
-- administrator may have created or re-roled a membership since, and deleting
-- it would revoke access this migration never granted.
--
-- So the rollback is narrow by construction — it soft-deletes only memberships
-- that still look exactly as the bootstrap left them:
--
--   * in the MARQ organization
--   * status = 'active', never touched since creation (updated_at = created_at)
--   * carrying a system role that is NOT platform_admin
--
-- Soft delete, not DELETE: `deleted_at` is the tenancy model's own erasure, and
-- it leaves the audit trail intact.
-- ============================================================================

BEGIN;

UPDATE public.organization_memberships m
SET deleted_at = now()
FROM public.organizations o, public.roles r
WHERE o.id = m.organization_id
  AND o.slug = 'marq'
  AND o.deleted_at IS NULL
  AND r.id = m.role_id
  AND r.is_system = true
  AND r.key <> 'platform_admin'
  AND m.status = 'active'
  AND m.deleted_at IS NULL
  AND m.updated_at = m.created_at;

COMMIT;
