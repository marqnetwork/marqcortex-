-- ============================================================================
-- MCV2-S6.2-IMPLEMENT-004 — Migration Infrastructure (Tables)
-- Additive only. KV remains authoritative. No runtime cutover.
-- Rollback: supabase/migrations/rollbacks/20260713184931_rollback_migration_infrastructure.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- migration_runs — lifecycle and aggregate counters per run
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.migration_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  migration_name      TEXT NOT NULL,
  mode                TEXT NOT NULL
                      CONSTRAINT migration_runs_mode_check
                      CHECK (mode IN ('inventory', 'simulation', 'backfill', 'reconcile', 'rollback')),
  status              TEXT NOT NULL DEFAULT 'running'
                      CONSTRAINT migration_runs_status_check
                      CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  requested_by        TEXT,
  source_namespace    TEXT,
  batch_size          INTEGER NOT NULL DEFAULT 50,
  last_cursor         TEXT,
  total_discovered    BIGINT NOT NULL DEFAULT 0,
  total_processed     BIGINT NOT NULL DEFAULT 0,
  total_inserted      BIGINT NOT NULL DEFAULT 0,
  total_updated       BIGINT NOT NULL DEFAULT 0,
  total_skipped       BIGINT NOT NULL DEFAULT 0,
  total_quarantined   BIGINT NOT NULL DEFAULT 0,
  total_failed        BIGINT NOT NULL DEFAULT 0,
  checksum            TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_runs_org_idx
  ON public.migration_runs (organization_id);

CREATE INDEX IF NOT EXISTS migration_runs_status_idx
  ON public.migration_runs (status);

CREATE INDEX IF NOT EXISTS migration_runs_mode_idx
  ON public.migration_runs (mode, migration_name);

CREATE INDEX IF NOT EXISTS migration_runs_namespace_idx
  ON public.migration_runs (source_namespace)
  WHERE source_namespace IS NOT NULL;

DROP TRIGGER IF EXISTS migration_runs_set_updated_at ON public.migration_runs;
CREATE TRIGGER migration_runs_set_updated_at
  BEFORE UPDATE ON public.migration_runs
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.migration_runs IS
  'KV migration run lifecycle. Service role / platform admin only.';

-- ---------------------------------------------------------------------------
-- migration_checkpoints — resumable cursor per namespace batch
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.migration_checkpoints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES public.migration_runs(id) ON DELETE CASCADE,
  namespace         TEXT NOT NULL,
  last_key          TEXT,
  batch_number      INTEGER NOT NULL DEFAULT 0,
  processed_count   BIGINT NOT NULL DEFAULT 0,
  checksum          TEXT,
  status            TEXT NOT NULL DEFAULT 'running'
                    CONSTRAINT migration_checkpoints_status_check
                    CHECK (status IN ('running', 'paused', 'completed', 'failed')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT migration_checkpoints_run_namespace_uidx UNIQUE (run_id, namespace)
);

CREATE INDEX IF NOT EXISTS migration_checkpoints_run_idx
  ON public.migration_checkpoints (run_id);

CREATE INDEX IF NOT EXISTS migration_checkpoints_status_idx
  ON public.migration_checkpoints (status);

DROP TRIGGER IF EXISTS migration_checkpoints_set_updated_at ON public.migration_checkpoints;
CREATE TRIGGER migration_checkpoints_set_updated_at
  BEFORE UPDATE ON public.migration_checkpoints
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.migration_checkpoints IS
  'Per-namespace checkpoint for resumable KV migration runs.';

-- ---------------------------------------------------------------------------
-- migration_quarantine — every skipped or invalid record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.migration_quarantine (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES public.migration_runs(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_namespace  TEXT NOT NULL,
  source_key        TEXT NOT NULL,
  source_payload    JSONB,
  reason_code       TEXT NOT NULL,
  reason_detail     TEXT,
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  retry_status      TEXT NOT NULL DEFAULT 'pending'
                    CONSTRAINT migration_quarantine_retry_status_check
                    CHECK (retry_status IN ('pending', 'retrying', 'resolved', 'abandoned')),
  retry_count       INTEGER NOT NULL DEFAULT 0,
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT,
  target_table      TEXT,
  target_record_id  UUID
);

CREATE INDEX IF NOT EXISTS migration_quarantine_run_idx
  ON public.migration_quarantine (run_id);

CREATE INDEX IF NOT EXISTS migration_quarantine_source_key_idx
  ON public.migration_quarantine (source_key);

CREATE INDEX IF NOT EXISTS migration_quarantine_org_idx
  ON public.migration_quarantine (organization_id);

CREATE INDEX IF NOT EXISTS migration_quarantine_reason_idx
  ON public.migration_quarantine (reason_code);

COMMENT ON TABLE public.migration_quarantine IS
  'Skipped or invalid KV records during migration. No silent drops.';

-- ---------------------------------------------------------------------------
-- migration_reconciliation_log — post-run validation results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.migration_reconciliation_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL REFERENCES public.migration_runs(id) ON DELETE CASCADE,
  domain                TEXT NOT NULL,
  source_count          BIGINT NOT NULL DEFAULT 0,
  target_count          BIGINT NOT NULL DEFAULT 0,
  missing_count         BIGINT NOT NULL DEFAULT 0,
  duplicate_count       BIGINT NOT NULL DEFAULT 0,
  orphan_count          BIGINT NOT NULL DEFAULT 0,
  mismatch_count        BIGINT NOT NULL DEFAULT 0,
  sample_size           INTEGER NOT NULL DEFAULT 0,
  sample_mismatch_count INTEGER NOT NULL DEFAULT 0,
  checksum_source       TEXT,
  checksum_target       TEXT,
  threshold_passed      BOOLEAN NOT NULL DEFAULT false,
  details               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_reconciliation_log_run_idx
  ON public.migration_reconciliation_log (run_id);

CREATE INDEX IF NOT EXISTS migration_reconciliation_log_domain_idx
  ON public.migration_reconciliation_log (domain);

COMMENT ON TABLE public.migration_reconciliation_log IS
  'KV vs SQL reconciliation results per domain and run.';

COMMIT;
