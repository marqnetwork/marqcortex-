-- ---------------------------------------------------------------------------
-- FIXTURE — plant an obstacle the 4C migration must fail on
--
-- Used by the "a failed migration leaves no partial 4C schema state" scenario.
--
-- WHY THIS OBSTACLE, AND NOT ANY OTHER.
--
-- The migration creates its three tables FIRST and defines the activation
-- function LAST. This plants a function with the migration's exact argument
-- list and an incompatible RETURN TYPE, which `CREATE OR REPLACE FUNCTION`
-- refuses ("cannot change return type of existing function") — so the migration
-- fails AFTER all three tables have been created inside its transaction.
--
-- That is the only failure position worth testing. A migration that failed on
-- its first statement would leave nothing behind whether or not it were
-- transactional, and would prove nothing. This one leaves nothing behind ONLY
-- because `BEGIN`/`COMMIT` wrap the whole file.
--
-- Runs as the migration owner, so the planted function's ownership matches
-- what the migration would have produced.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cortex.ai_provider_credential_activate(
  p_credential_id     TEXT,
  p_configuration_id  TEXT,
  p_credential_name   TEXT,
  p_encrypted_secret  JSONB,
  p_key_id            TEXT,
  p_fingerprint       TEXT,
  p_last_four         TEXT,
  p_secret_version    INTEGER,
  p_created_at        TIMESTAMPTZ,
  p_rotated_at        TIMESTAMPTZ,
  p_created_by        TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 'an incompatible pre-existing definition'::TEXT $$;
