-- ============================================================================
-- Rollback — AI-01 Batch 4C provider administration
--
-- WARNING: Run only in staging/dev.
--
-- THIS DESTROYS MANAGED PROVIDER CREDENTIALS. They are encrypted, so nothing
-- readable leaves with them, but they are also NOT RECOVERABLE: a managed
-- credential is write-only secret material by design, so a dropped row means
-- the key must be re-entered from the vendor's console.
--
-- What this rollback does NOT touch, and cannot:
--   - environment credentials (OPENAI_API_KEY, ANTHROPIC_API_KEY). They are
--     deployment secrets. This migration never read, copied or moved them, so
--     removing it leaves them exactly as they were and the runtime falls back
--     to them — which is the whole point of keeping the compatibility source.
--   - the spend ledger, the audit trail, the KV store, or any tenancy object.
-- ============================================================================

BEGIN;

-- The function first: it references the credential table, and dropping the
-- table under it would leave a broken definition behind.
DROP FUNCTION IF EXISTS cortex.ai_provider_credential_activate(
  TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
);

-- Credentials first: they reference the configuration, and dropping the parent
-- with CASCADE would take them with it silently. Naming the table here makes
-- the destructive step explicit in the rollback's own text.
DROP TABLE IF EXISTS cortex.ai_provider_credential;
DROP TABLE IF EXISTS cortex.ai_provider_model;
DROP TABLE IF EXISTS cortex.ai_provider_configuration;

COMMIT;
