-- ============================================================================
-- AI-01 Batch 4D — Customer BYOK (bring your own key)
-- Depends on: 20260711050000_cortex_tenancy_foundation.sql
--             20260711050001_cortex_tenancy_rls_and_seed.sql
--             20260828120000_ai_provider_administration.sql
-- Rollback:   supabase/migrations/rollbacks/20260901120000_rollback_ai_customer_byok.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION IS FOR.
--
-- A customer organization may now configure its own AI provider credential.
-- Their traffic then reaches their own vendor account under their own key,
-- instead of MARQ's.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ──────────────────────────
--
-- IT CREATES NO TABLE.
--
-- Batch 4C's schema was built for this and said so in its own text: `scope`
-- already admits `organization`, `organization_id` already exists with its FK
-- to `public.organizations`, the scope/tenancy CHECK already forbids a platform
-- row naming a tenant and an organization row omitting one, and the partial
-- unique index `ai_provider_configuration_organization_key` was already created
-- and already commented "Reserved for 4D".
--
-- A second set of tables for customer credentials would mean a second RLS
-- posture to keep aligned, a second privilege matrix to enumerate, a second
-- activation function to make atomic and a second place for a plaintext column
-- to be added by somebody who had not read the first. The whole point of
-- putting `scope` on every row in Batch 4C was so this batch admitted a value
-- rather than reshaping a table that already holds production rows.
--
-- IT SEEDS NOTHING. No organization, no configuration, no credential. Until a
-- customer administrator deliberately stores one, every tenant resolves exactly
-- where it resolved before this batch: the platform managed credential, then
-- the deployment environment.
--
-- IT COPIES NO SECRET. `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are deployment
-- secrets and are not read, referenced or moved by anything here.
--
-- ── WHAT IT ADDS: ONE COLUMN AND ONE TRIGGER ──────────────────────────────
--
--   credential_fallback   The CUSTOMER'S OWN policy: does MARQ's platform
--                         credential stand behind them when they have none of
--                         their own? Non-secret, defaulted to the value that
--                         changes nothing, and constrained so a platform row
--                         can never carry anything else.
--
--   an immutability
--   trigger               A configuration row's SCOPE and OWNING TENANT can
--                         never change after it is created.
--
-- THE TRIGGER IS THE SECURITY-RELEVANT HALF, so it is worth saying plainly what
-- it prevents. Without it, a single UPDATE — a bug in a future write path, a
-- careless support script, an attacker holding the service role — could
-- re-point an existing configuration at another organization, and every
-- credential row hanging off it would follow, because credentials are keyed by
-- configuration id.
--
-- That attack does NOT succeed even without this trigger: the sealed secret's
-- additional authenticated data binds the organization id, so a ciphertext
-- moved under another tenant simply fails to open, and the runtime refuses
-- rather than falling through. But "the cipher would catch it" is a statement
-- about the last line of defence, and a cross-tenant re-point that got as far
-- as the cipher would already have shown one customer another's credential
-- METADATA — the fingerprint, the rotation history, the last four characters.
-- The trigger refuses it at the first line instead, and costs one comparison.
--
-- ── WHAT IS PRESERVED, EXACTLY AS BATCH 4C LEFT IT ────────────────────────
--
--   RLS enabled AND forced on all three tables, with NO POLICY on any of them.
--   `anon` and `authenticated` revoked, and granted nothing anywhere.
--   `service_role` holding an ENUMERATED privilege set, with no DELETE, no
--   TRUNCATE and no direct INSERT on the credential table.
--   `ai_provider_credential_activate` SECURITY DEFINER, revoked from PUBLIC and
--   granted only to `service_role`.
--
-- All of that is re-asserted below rather than assumed, idempotently, and
-- widens nothing. A migration that depends on a grant made in another file and
-- does not say so is a migration that breaks silently the day that file
-- changes.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- The customer's own fallback policy
-- ---------------------------------------------------------------------------
--
-- TWO VALUES, AND THE DEFAULT IS THE ONE THAT CHANGES NOTHING.
--
--   'platform'     MARQ's platform resolution continues behind the tenant's
--                  own. A tenant that has not configured a credential, or has
--                  revoked one, executes exactly as it did before Batch 4D.
--
--   'tenant_only'  The tenant's own credential or nothing. Chosen by a customer
--                  whose policy is that their traffic must reach their vendor
--                  account and no other, so revoking their key stops their AI
--                  rather than quietly moving the bill to MARQ.
--
-- IT IS NOT A BOUNDARY BETWEEN TENANTS and must not be read as one. No value of
-- this admits one customer's credential to another customer's execution — that
-- is decided by `organization_id`, which the runtime takes from an
-- authenticated membership. This decides only whether MARQ's own credential
-- stands behind a tenant that has none.
ALTER TABLE cortex.ai_provider_configuration
  ADD COLUMN IF NOT EXISTS credential_fallback TEXT NOT NULL DEFAULT 'platform';

-- Added separately and guarded, because `ADD COLUMN ... CONSTRAINT` is not
-- idempotent under `IF NOT EXISTS` on the column: a re-run would leave the
-- column alone and then fail on a duplicate constraint name. PostgreSQL rejects
-- two constraints sharing a name on one table — the exact defect an independent
-- production gate found in the Batch 4C migration before it shipped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ai_provider_configuration_credential_fallback'
       AND conrelid = 'cortex.ai_provider_configuration'::REGCLASS
  ) THEN
    ALTER TABLE cortex.ai_provider_configuration
      ADD CONSTRAINT ai_provider_configuration_credential_fallback
      CHECK (credential_fallback IN ('platform', 'tenant_only'));
  END IF;
END;
$$;

-- A PLATFORM ROW CANNOT CARRY A TENANT POLICY.
--
-- `credential_fallback` describes what a CUSTOMER falls back to. On MARQ's own
-- rows the question is meaningless, and a platform row reading 'tenant_only'
-- would be a state nobody designed and every reader would have to interpret.
-- Structurally impossible is cheaper than documented.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ai_provider_configuration_platform_fallback'
       AND conrelid = 'cortex.ai_provider_configuration'::REGCLASS
  ) THEN
    ALTER TABLE cortex.ai_provider_configuration
      ADD CONSTRAINT ai_provider_configuration_platform_fallback
      CHECK (scope <> 'platform' OR credential_fallback = 'platform');
  END IF;
END;
$$;

COMMENT ON COLUMN cortex.ai_provider_configuration.credential_fallback IS
  'AI-01 Batch 4D. A CUSTOMER organization''s own policy: whether the MARQ platform '
  'credential applies when this organization has none of its own. Non-secret. Always '
  '''platform'' on a platform-scoped row, which a CHECK constraint enforces. It is not a '
  'boundary between tenants: no value of it admits one organization''s credential to '
  'another''s execution.';

-- ---------------------------------------------------------------------------
-- A configuration's tenancy is immutable
-- ---------------------------------------------------------------------------
--
-- SEE THE HEADER for why this exists. In one sentence: credentials are keyed by
-- configuration id, so re-pointing a configuration at another organization
-- would re-point every credential under it, and the cipher catching that at
-- decryption time is one line of defence too late to stop the metadata leak.
--
-- WHAT IT REFUSES: changing `scope`, or changing `organization_id`, on a row
-- that already exists. Everything else about a configuration stays editable —
-- `enabled`, `certification`, `credential_fallback`, `display_name`,
-- `configuration`, the audit columns — because those are what administration is
-- for.
--
-- WHY `IS DISTINCT FROM` RATHER THAN `<>`: `organization_id` is NULL on every
-- platform row, and `NULL <> NULL` is NULL, which is not TRUE, which would make
-- the check silently pass for exactly the conversion it most needs to refuse —
-- a platform row being handed a tenant, or a tenant row being stripped of one.
CREATE OR REPLACE FUNCTION cortex.ai_provider_configuration_tenancy_is_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = cortex, public
AS $$
BEGIN
  IF NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION
      'ai_provider_configuration.scope is immutable (% -> %) for configuration %',
      OLD.scope, NEW.scope, OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    -- The ids are NOT interpolated into the message. A trigger message reaches
    -- logs and, through PostgREST, error bodies; naming both tenants in it
    -- would make a refused cross-tenant write into a way to confirm that
    -- another organization's id exists.
    RAISE EXCEPTION
      'ai_provider_configuration.organization_id is immutable for configuration %',
      OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$$;

-- SECURITY INVOKER, deliberately — the default, stated because the sibling
-- function in Batch 4C is SECURITY DEFINER and a reader comparing them deserves
-- to know the difference is intended. This function needs no privilege of its
-- own: it reads OLD and NEW and raises. Making it DEFINER would give it the
-- owner's rights for no operation it performs.
REVOKE ALL ON FUNCTION cortex.ai_provider_configuration_tenancy_is_immutable()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ai_provider_configuration_tenancy_immutable
  ON cortex.ai_provider_configuration;

CREATE TRIGGER ai_provider_configuration_tenancy_immutable
  BEFORE UPDATE ON cortex.ai_provider_configuration
  FOR EACH ROW
  EXECUTE FUNCTION cortex.ai_provider_configuration_tenancy_is_immutable();

COMMENT ON FUNCTION cortex.ai_provider_configuration_tenancy_is_immutable() IS
  'AI-01 Batch 4D. Refuses any UPDATE that changes a provider configuration''s scope or '
  'owning organization. Credentials are keyed by configuration id, so re-pointing a '
  'configuration would re-point every credential under it. The sealed secret''s AAD binds '
  'the organization and would refuse the decryption anyway; this refuses the write.';

-- ---------------------------------------------------------------------------
-- Tenant lookup index
-- ---------------------------------------------------------------------------
--
-- The runtime resolves a tenant credential on EVERY attempt, keyed by
-- (organization, provider). The partial unique index Batch 4C created for that
-- key already serves it, and this index is deliberately NOT a duplicate of it:
-- it covers the enumeration the customer console does — "every provider THIS
-- organization has configured" — which has no provider key to match on.
CREATE INDEX IF NOT EXISTS ai_provider_configuration_organization_idx
  ON cortex.ai_provider_configuration (organization_id)
  WHERE scope = 'organization';

-- ---------------------------------------------------------------------------
-- Row level security and privileges — re-asserted, never widened
-- ---------------------------------------------------------------------------
--
-- Every statement below is idempotent and every one of them was already true
-- after Batch 4C. They are restated because this migration admits a new class
-- of row — a customer's — into tables whose entire access control is "service
-- role only, no policy, nothing granted to a browser role". A reader auditing
-- customer BYOK must be able to confirm that posture from THIS file rather than
-- by trusting that another one still says what it said.
--
-- NOTHING HERE ADDS A POLICY. With RLS enabled and no policy, every role that
-- respects RLS is denied every row; the service role reaches these rows because
-- it holds BYPASSRLS and the enumerated privileges below, and nothing else
-- holds either. A policy admitting `authenticated` to a customer's own rows
-- would put credential ciphertext one misconfiguration away from a browser
-- session token, to serve a read the BYOK API already serves behind a
-- capability check and an audit record.
--
-- NO NEW PRIVILEGE IS GRANTED. `credential_fallback` is a column on a table
-- `service_role` already holds SELECT, INSERT and UPDATE on; PostgreSQL grants
-- at table level here, so the existing grant covers it and no column-level
-- grant is needed or made.

ALTER TABLE cortex.ai_provider_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortex.ai_provider_credential    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortex.ai_provider_model         ENABLE ROW LEVEL SECURITY;

ALTER TABLE cortex.ai_provider_configuration FORCE ROW LEVEL SECURITY;
ALTER TABLE cortex.ai_provider_credential    FORCE ROW LEVEL SECURITY;
ALTER TABLE cortex.ai_provider_model         FORCE ROW LEVEL SECURITY;

REVOKE ALL ON cortex.ai_provider_configuration FROM PUBLIC, anon, authenticated;
REVOKE ALL ON cortex.ai_provider_credential    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON cortex.ai_provider_model         FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA cortex TO service_role;

GRANT SELECT, INSERT, UPDATE ON cortex.ai_provider_configuration TO service_role;
GRANT SELECT,         UPDATE ON cortex.ai_provider_credential    TO service_role;
GRANT SELECT, INSERT, UPDATE ON cortex.ai_provider_model         TO service_role;

COMMENT ON TABLE cortex.ai_provider_configuration IS
  'AI-01 Batch 4C/4D. AI provider configuration, platform-owned (scope = platform, '
  'organization_id NULL) and customer-owned (scope = organization, organization_id set). '
  'Holds no secret material. A row''s scope and owning organization are immutable after '
  'creation. Managed exclusively through the governed AI administration APIs; service '
  'role only.';

COMMENT ON TABLE cortex.ai_provider_credential IS
  'AI-01 Batch 4C/4D. Encrypted AI provider credentials (AES-256-GCM, root key held in the '
  'edge function environment, never in this database), for MARQ''s own estate and for '
  'customer organizations alike. The sealed record''s additional authenticated data binds '
  'the provider, the scope, the owning organization and the credential id, so a ciphertext '
  'moved to another row — another tenant''s included — cannot be opened. NO RLS POLICY '
  'EXISTS ON THIS TABLE BY DESIGN: service role only. There is no API, view or function '
  'that returns plaintext.';

COMMIT;
