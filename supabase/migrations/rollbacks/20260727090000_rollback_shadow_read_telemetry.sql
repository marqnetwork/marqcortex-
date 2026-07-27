-- ============================================================================
-- Rollback: MCV2-S7.4-REMEDIATION (G4) — Durable shadow-read telemetry sink
-- Removes the diagnostic aggregation table + RPC. KV was never affected, so
-- this rollback has no runtime impact.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.record_shadow_read_telemetry(TEXT, TEXT, TEXT[]);
DROP TABLE IF EXISTS public.shadow_read_telemetry;

COMMIT;
