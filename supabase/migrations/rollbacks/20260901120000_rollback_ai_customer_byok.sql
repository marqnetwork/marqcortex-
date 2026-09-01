-- ============================================================================
-- Rollback — AI-01 Batch 4D customer BYOK
--
-- WARNING: Run only in staging/dev.
--
-- ── WHAT THIS ROLLBACK DELIBERATELY DOES NOT DO ───────────────────────────
--
-- IT DOES NOT DELETE ANY CUSTOMER ROW.
--
-- That is the whole design of it, and it is worth stating why, because the
-- obvious rollback — drop the organization-scoped configurations and the
-- credentials under them — is wrong in a way that is expensive and silent.
--
-- Batch 4D created NO TABLE. It added a column, a constraint pair, a trigger
-- and an index to tables Batch 4C already owned and already holds production
-- rows in. A rollback that also deleted customer data would be deleting rows
-- the 4C schema is perfectly capable of holding, and it would destroy secret
-- material that is NOT RECOVERABLE — a stored credential is write-only by
-- design, so a dropped row means every affected customer must re-enter their
-- key from their vendor's console. Nobody should have to take that consequence
-- to reverse a schema change.
--
-- SO WHAT HAPPENS TO THOSE ROWS? They become INERT, which is the safe state.
-- With Batch 4D's code rolled back, the credential resolver reads only
-- platform-scoped rows — `listConfigurations('platform')` and a
-- `findConfiguration` with `organization_id IS NULL` — so an organization row
-- is never read, never resolved and never executed on. Every tenant returns to
-- the Batch 4C resolution: the platform managed credential, then the deployment
-- environment. Re-applying 4D brings the same rows back into service unchanged.
--
-- An operator who genuinely wants the customer credentials GONE removes them
-- deliberately, as a separate and explicitly destructive act. It is not
-- something a schema rollback should do on their behalf.
--
-- ── WHAT IT DOES NOT TOUCH, AND CANNOT ────────────────────────────────────
--
--   Batch 4C's three tables, their constraints, their indexes, their RLS
--   posture, their privileges, and `ai_provider_credential_activate`. All of it
--   survives; reversing 4D must not reverse 4C.
--
--   Environment credentials (OPENAI_API_KEY, ANTHROPIC_API_KEY). They are
--   deployment secrets. Nothing in Batch 4D read, copied or moved them.
--
--   The spend ledger, the audit trail, the KV store, and every tenancy object.
--
-- ── ONE CONSEQUENCE AN OPERATOR SHOULD EXPECT ─────────────────────────────
--
-- Dropping `credential_fallback` discards each customer's chosen fallback
-- policy. Re-applying the migration restores the column at its default,
-- `platform` — the value that changes nothing — so a customer who had chosen
-- `tenant_only` would silently return to having MARQ's credential stand behind
-- them. That is the safe direction for availability and the wrong direction for
-- a customer whose policy was deliberate, so it is stated here rather than
-- discovered: after a rollback and re-apply, customers who chose `tenant_only`
-- must be asked to choose it again.
-- ============================================================================

BEGIN;

-- The trigger before the function it calls, so nothing is left pointing at a
-- definition that has been dropped.
DROP TRIGGER IF EXISTS ai_provider_configuration_tenancy_immutable
  ON cortex.ai_provider_configuration;

DROP FUNCTION IF EXISTS cortex.ai_provider_configuration_tenancy_is_immutable();

DROP INDEX IF EXISTS cortex.ai_provider_configuration_organization_idx;

-- The constraints before the column. Dropping the column would take them with
-- it, but naming them makes the reversal explicit and symmetrical with the
-- migration that added them.
ALTER TABLE cortex.ai_provider_configuration
  DROP CONSTRAINT IF EXISTS ai_provider_configuration_platform_fallback;

ALTER TABLE cortex.ai_provider_configuration
  DROP CONSTRAINT IF EXISTS ai_provider_configuration_credential_fallback;

ALTER TABLE cortex.ai_provider_configuration
  DROP COLUMN IF EXISTS credential_fallback;

-- The Batch 4C table comments, restored verbatim. The 4D migration rewrote them
-- to describe both estates; leaving the 4D text behind after a 4D rollback
-- would make the schema's own documentation describe a batch that is no longer
-- applied — which is exactly the kind of drift a reviewer trusts a comment not
-- to have.
COMMENT ON TABLE cortex.ai_provider_configuration IS
  'AI-01 Batch 4C. Platform-owned AI provider configuration. Holds no secret material. '
  'Managed exclusively through the governed AI administration API; service role only.';

COMMENT ON TABLE cortex.ai_provider_credential IS
  'AI-01 Batch 4C. Encrypted AI provider credentials (AES-256-GCM, root key held in the '
  'edge function environment, never in this database). NO RLS POLICY EXISTS ON THIS TABLE '
  'BY DESIGN: service role only. There is no API, view or function that returns plaintext.';

COMMIT;
