-- ============================================================================
-- Rollback: MCV2-S7.4 shadow read telemetry
-- Drops the observation table and its single write function. The business
-- tables it observed are untouched, and so is the key-value store — nothing in
-- the forward migration wrote to either.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.record_shadow_read_telemetry(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TIMESTAMPTZ
);

DROP TABLE IF EXISTS public.shadow_read_telemetry CASCADE;

COMMIT;
