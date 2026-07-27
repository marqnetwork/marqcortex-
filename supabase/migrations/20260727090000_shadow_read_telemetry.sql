-- ============================================================================
-- MCV2-S7.4-REMEDIATION (G4) — Durable shadow-read telemetry sink
-- Additive only. KV remains authoritative. No runtime cutover, no reads served
-- from this table. Diagnostic aggregation only.
-- Rollback: supabase/migrations/rollbacks/20260727090000_rollback_shadow_read_telemetry.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- shadow_read_telemetry — cross-instance, restart-safe aggregation of KV↔SQL
-- shadow comparison outcomes. One row per (domain, status, mismatch_fields).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shadow_read_telemetry (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain            TEXT NOT NULL,
  status            TEXT NOT NULL
                    CONSTRAINT shadow_read_telemetry_status_check
                    CHECK (status IN (
                      'match', 'mismatch', 'partial',
                      'missing_sql', 'missing_kv', 'skipped', 'error'
                    )),
  -- Field PATHS only — never raw values or PII.
  mismatch_fields   TEXT[] NOT NULL DEFAULT '{}'::text[],
  occurrence_count  BIGINT NOT NULL DEFAULT 0,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The aggregation key. A UNIQUE constraint is required for the atomic
  -- INSERT ... ON CONFLICT upsert-increment used by the RPC below.
  CONSTRAINT shadow_read_telemetry_key_unique UNIQUE (domain, status, mismatch_fields)
);

CREATE INDEX IF NOT EXISTS shadow_read_telemetry_domain_status_idx
  ON public.shadow_read_telemetry (domain, status);

CREATE INDEX IF NOT EXISTS shadow_read_telemetry_last_observed_idx
  ON public.shadow_read_telemetry (last_observed_at);

COMMENT ON TABLE public.shadow_read_telemetry IS
  'MCV2-S7.4 durable shadow-read telemetry. Diagnostic aggregation only — never '
  'read by the runtime, never authoritative. Stores field paths only, no PII.';

-- ---------------------------------------------------------------------------
-- record_shadow_read_telemetry — atomic upsert-increment.
--
-- Concurrency: the INSERT ... ON CONFLICT DO UPDATE acquires a row lock on the
-- conflicting row, so concurrent writers from any edge instance fold into one
-- row without a read-modify-write race. Restart-safe: state lives in Postgres,
-- not in process memory.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_shadow_read_telemetry(
  p_domain          TEXT,
  p_status          TEXT,
  p_mismatch_fields TEXT[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.shadow_read_telemetry AS t
    (domain, status, mismatch_fields, occurrence_count, first_observed_at, last_observed_at)
  VALUES
    (p_domain, p_status, COALESCE(p_mismatch_fields, '{}'::text[]), 1, now(), now())
  ON CONFLICT (domain, status, mismatch_fields)
  DO UPDATE SET
    occurrence_count = t.occurrence_count + 1,
    last_observed_at = now();
$$;

COMMENT ON FUNCTION public.record_shadow_read_telemetry(TEXT, TEXT, TEXT[]) IS
  'MCV2-S7.4 atomic upsert-increment for durable shadow-read telemetry. '
  'Cross-instance and restart-safe. Invoked only from the background scheduler.';

-- RLS: enable and add no permissive policies. The runtime writes with the
-- service role (which bypasses RLS); anon/authenticated clients get no access.
ALTER TABLE public.shadow_read_telemetry ENABLE ROW LEVEL SECURITY;

-- The upsert RPC runs as SECURITY DEFINER; expose it to service_role only.
REVOKE ALL ON FUNCTION public.record_shadow_read_telemetry(TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_shadow_read_telemetry(TEXT, TEXT, TEXT[]) TO service_role;

COMMIT;
