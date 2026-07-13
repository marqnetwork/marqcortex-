-- ============================================================================
-- MCV2-S6.2-IMPLEMENT-004 — Migration Infrastructure RLS
-- Restricted to service_role and platform admin only.
-- Rollback: supabase/migrations/rollbacks/20260713184931_rollback_migration_infrastructure.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- RLS: migration infrastructure tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.migration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_reconciliation_log ENABLE ROW LEVEL SECURITY;

-- migration_runs
DROP POLICY IF EXISTS migration_runs_service_all ON public.migration_runs;
CREATE POLICY migration_runs_service_all ON public.migration_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS migration_runs_platform_admin ON public.migration_runs;
CREATE POLICY migration_runs_platform_admin ON public.migration_runs
  FOR ALL
  TO authenticated
  USING (cortex.is_platform_admin())
  WITH CHECK (cortex.is_platform_admin());

-- migration_checkpoints
DROP POLICY IF EXISTS migration_checkpoints_service_all ON public.migration_checkpoints;
CREATE POLICY migration_checkpoints_service_all ON public.migration_checkpoints
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS migration_checkpoints_platform_admin ON public.migration_checkpoints;
CREATE POLICY migration_checkpoints_platform_admin ON public.migration_checkpoints
  FOR ALL
  TO authenticated
  USING (cortex.is_platform_admin())
  WITH CHECK (cortex.is_platform_admin());

-- migration_quarantine
DROP POLICY IF EXISTS migration_quarantine_service_all ON public.migration_quarantine;
CREATE POLICY migration_quarantine_service_all ON public.migration_quarantine
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS migration_quarantine_platform_admin ON public.migration_quarantine;
CREATE POLICY migration_quarantine_platform_admin ON public.migration_quarantine
  FOR ALL
  TO authenticated
  USING (cortex.is_platform_admin())
  WITH CHECK (cortex.is_platform_admin());

-- migration_reconciliation_log
DROP POLICY IF EXISTS migration_reconciliation_log_service_all ON public.migration_reconciliation_log;
CREATE POLICY migration_reconciliation_log_service_all ON public.migration_reconciliation_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS migration_reconciliation_log_platform_admin ON public.migration_reconciliation_log;
CREATE POLICY migration_reconciliation_log_platform_admin ON public.migration_reconciliation_log
  FOR ALL
  TO authenticated
  USING (cortex.is_platform_admin())
  WITH CHECK (cortex.is_platform_admin());

COMMIT;
