-- Shadow read telemetry — MCV2-S7.4.
--
-- WHY THIS EXISTS.
--
-- KV is the runtime storage authority and SQL is being backfilled behind it.
-- Before any read can be moved, the two stores have to be shown to agree on
-- real production traffic, and "shown" means durably, per observation, with the
-- disagreements kept — not a counter in an isolate that dies with the request.
--
-- WHAT IT IS NOT.
--
-- It is not a second copy of the business record and it is not an authority.
-- Nothing reads this table to answer a request. It holds classifications,
-- reason codes and presence booleans; the one identifier it carries is the
-- legacy KV key the observation was made on.
--
-- THE OBSERVED COLUMNS CARRY NO CHECK CONSTRAINT.
--
-- `sql_lifecycle_status` and `sql_outcome_type` record what the row actually
-- held. A CHECK on them would reject exactly the rows worth knowing about — a
-- status that is null, empty or not a schema value at all is a finding, and a
-- telemetry table that refuses to record a finding reports a clean migration by
-- construction. The classification columns, which this codebase produces, are
-- constrained; the observed columns, which the data produces, are not.

BEGIN;

CREATE TABLE IF NOT EXISTS public.shadow_read_telemetry (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity                     TEXT NOT NULL
                             CONSTRAINT shadow_read_telemetry_entity_check
                             CHECK (entity IN ('outcome')),
  legacy_kv_key              TEXT NOT NULL,
  classification             TEXT NOT NULL
                             CONSTRAINT shadow_read_telemetry_classification_check
                             CHECK (classification IN (
                               'match', 'partial', 'mismatch',
                               'sql_missing', 'kv_missing', 'both_missing', 'error'
                             )),
  severity                   TEXT NOT NULL
                             CONSTRAINT shadow_read_telemetry_severity_check
                             CHECK (severity IN ('info', 'low', 'high')),
  kv_present                 BOOLEAN NOT NULL,
  sql_present                BOOLEAN NOT NULL,
  kv_conversion              TEXT NOT NULL
                             CONSTRAINT shadow_read_telemetry_kv_conversion_check
                             CHECK (kv_conversion IN ('converted', 'not_converted', 'unknown')),
  sql_conversion             TEXT NOT NULL
                             CONSTRAINT shadow_read_telemetry_sql_conversion_check
                             CHECK (sql_conversion IN ('converted', 'not_converted', 'unknown')),
  -- Observed, never compared against KV: lifecycle is not the conversion axis.
  sql_lifecycle_status       TEXT,
  sql_lifecycle_status_valid BOOLEAN NOT NULL,
  sql_outcome_type           TEXT,
  detail                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.shadow_read_telemetry IS
  'MCV2-S7.4 KV/SQL shadow read observations. Diagnostics only — never an authority, never read to answer a request.';
COMMENT ON COLUMN public.shadow_read_telemetry.legacy_kv_key IS
  'The canonical join axis: outcomes.legacy_kv_key = ''outcome:{submissionId}''.';
COMMENT ON COLUMN public.shadow_read_telemetry.sql_lifecycle_status IS
  'Observed outcomes.status (open/closed/archived, or whatever the row held). Recorded, never compared.';

CREATE INDEX IF NOT EXISTS shadow_read_telemetry_org_observed_idx
  ON public.shadow_read_telemetry (organization_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS shadow_read_telemetry_classification_idx
  ON public.shadow_read_telemetry (organization_id, classification, observed_at DESC);

CREATE INDEX IF NOT EXISTS shadow_read_telemetry_legacy_key_idx
  ON public.shadow_read_telemetry (organization_id, legacy_kv_key);

ALTER TABLE public.shadow_read_telemetry ENABLE ROW LEVEL SECURITY;

-- Members of the tenant may read their own observations. There is deliberately
-- no INSERT, UPDATE or DELETE policy: writes arrive only through the
-- SECURITY DEFINER function below, executed by the service role.
DROP POLICY IF EXISTS shadow_read_telemetry_select ON public.shadow_read_telemetry;
CREATE POLICY shadow_read_telemetry_select
  ON public.shadow_read_telemetry
  FOR SELECT
  USING (
    cortex.is_platform_admin()
    OR cortex.is_organization_member(organization_id)
  );

-- The one write path.
--
-- Insert-only by construction: this function names one table and one verb. It
-- does not touch `outcomes`, it does not touch the key-value store, and there
-- is no code path in this migration that updates or deletes anything — a shadow
-- read that could write to the stores it observes would not be a shadow read.
CREATE OR REPLACE FUNCTION public.record_shadow_read_telemetry(
  p_organization_id            UUID,
  p_entity                     TEXT,
  p_legacy_kv_key              TEXT,
  p_classification             TEXT,
  p_severity                   TEXT,
  p_kv_present                 BOOLEAN,
  p_sql_present                BOOLEAN,
  p_kv_conversion              TEXT,
  p_sql_conversion             TEXT,
  p_sql_lifecycle_status       TEXT,
  p_sql_lifecycle_status_valid BOOLEAN,
  p_sql_outcome_type           TEXT,
  p_detail                     JSONB,
  p_observed_at                TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.shadow_read_telemetry (
    organization_id, entity, legacy_kv_key, classification, severity,
    kv_present, sql_present, kv_conversion, sql_conversion,
    sql_lifecycle_status, sql_lifecycle_status_valid, sql_outcome_type,
    detail, observed_at
  )
  VALUES (
    p_organization_id, p_entity, p_legacy_kv_key, p_classification, p_severity,
    p_kv_present, p_sql_present, p_kv_conversion, p_sql_conversion,
    p_sql_lifecycle_status, p_sql_lifecycle_status_valid, p_sql_outcome_type,
    COALESCE(p_detail, '{}'::jsonb), COALESCE(p_observed_at, now())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_shadow_read_telemetry(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TIMESTAMPTZ
) IS
  'Insert one MCV2-S7.4 shadow read observation. Insert-only; touches no business table and no key-value record.';

-- The Edge function calls this with the service role.
REVOKE ALL ON FUNCTION public.record_shadow_read_telemetry(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_shadow_read_telemetry(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TIMESTAMPTZ
) TO service_role;

COMMIT;
