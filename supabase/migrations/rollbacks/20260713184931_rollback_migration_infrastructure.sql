-- ============================================================================
-- Rollback — MCV2-S6.2 migration infrastructure (telemetry tables only)
-- Does NOT drop diagnostic business tables. KV unaffected.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS migration_reconciliation_log_platform_admin ON public.migration_reconciliation_log;
DROP POLICY IF EXISTS migration_reconciliation_log_service_all ON public.migration_reconciliation_log;
DROP POLICY IF EXISTS migration_quarantine_platform_admin ON public.migration_quarantine;
DROP POLICY IF EXISTS migration_quarantine_service_all ON public.migration_quarantine;
DROP POLICY IF EXISTS migration_checkpoints_platform_admin ON public.migration_checkpoints;
DROP POLICY IF EXISTS migration_checkpoints_service_all ON public.migration_checkpoints;
DROP POLICY IF EXISTS migration_runs_platform_admin ON public.migration_runs;
DROP POLICY IF EXISTS migration_runs_service_all ON public.migration_runs;

DROP TRIGGER IF EXISTS migration_reconciliation_log_set_updated_at ON public.migration_reconciliation_log;
DROP TRIGGER IF EXISTS migration_quarantine_set_updated_at ON public.migration_quarantine;
DROP TRIGGER IF EXISTS migration_checkpoints_set_updated_at ON public.migration_checkpoints;
DROP TRIGGER IF EXISTS migration_runs_set_updated_at ON public.migration_runs;

DROP TABLE IF EXISTS public.migration_reconciliation_log CASCADE;
DROP TABLE IF EXISTS public.migration_quarantine CASCADE;
DROP TABLE IF EXISTS public.migration_checkpoints CASCADE;
DROP TABLE IF EXISTS public.migration_runs CASCADE;

COMMIT;
