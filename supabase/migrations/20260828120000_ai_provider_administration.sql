-- ============================================================================
-- AI-01 Batch 4C — Provider Administration
-- Depends on: 20260711050000_cortex_tenancy_foundation.sql
--             20260711050001_cortex_tenancy_rls_and_seed.sql
-- Rollback:   supabase/migrations/rollbacks/20260828120000_rollback_ai_provider_administration.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION IS FOR.
--
-- Until now a MARQ provider credential lived in exactly one place: an
-- environment variable on the edge function. That made every credential change
-- a deployment, made rotation an engineering task, and made "which key is in
-- force?" a question only somebody with deployment access could answer.
--
-- These three tables are the platform administration layer for that. They do
-- NOT execute anything: the Cortex AI Control Plane remains the single
-- execution authority, and it reads these rows through one provider-neutral
-- credential resolver.
--
-- THREE TABLES BECAUSE THERE ARE THREE CONCEPTS, AND COLLAPSING THEM IS THE
-- DEFECT THIS BATCH EXISTS TO AVOID.
--
--   configuration   HOW Cortex talks to a provider and whether MARQ has it
--                   switched on. One per (scope, provider key).
--   credential      The secret material authorising that conversation. MANY
--                   per configuration — a rotation history — with at most one
--                   active at a time.
--   model           A model offered through the provider, separately enabled
--                   and separately certified.
--
-- "An API key exists" is not "this provider is certified", and neither is
-- "this model may serve production traffic". A schema with one row and one
-- boolean cannot express the difference, and a platform that cannot express
-- the difference eventually acts on the wrong one.
--
-- WHAT IS NOT HERE, DELIBERATELY.
--
--   NO PLAINTEXT COLUMN. `encrypted_secret` holds an AES-256-GCM record sealed
--   by the edge function against a root key that lives in the deployment
--   environment and NEVER in this database. Read access to these tables yields
--   ciphertext. There is no column, view or function here that returns a
--   provider secret.
--
--   NO DATA MIGRATION. Nothing copies an existing environment secret into
--   these tables. An operator who wants a managed credential enters it
--   deliberately, through the audited administration surface. Automatically
--   importing a production secret would take a value the deployment owns and
--   put a copy of it somewhere its owner did not choose.
--
--   NO SEED ROWS. A provider configuration is created when an administrator
--   first administers that provider. Seeding one for OpenAI and Anthropic
--   would put the platform in a state nobody authorised, on a surface whose
--   whole point is that state is authorised.
--
-- SCOPE IS PRESENT FROM DAY ONE, AND BATCH 4C REFUSES ALL BUT ONE VALUE.
--
-- `scope = 'platform'` is MARQ's own provider estate — the only thing Batch 4C
-- administers. `scope = 'organization'` is reserved for Batch 4D customer BYOK
-- and is rejected by every 4C write path. It is in the schema now so that 4D
-- admits a value rather than reshaping a table that by then has production
-- rows and production credentials in it.
--
-- ROW LEVEL SECURITY: DENY, WITH ONE NARROW READ.
--
-- All three tables enable RLS. `ai_provider_configuration` and
-- `ai_provider_model` carry a platform-admin SELECT policy, because those rows
-- are non-secret configuration and a platform operator reading them directly
-- during an incident is legitimate.
--
-- `ai_provider_credential` carries NO POLICY AT ALL. Not a platform-admin read,
-- not a self-read, nothing. With RLS enabled and no policy the table is denied
-- to every role that respects RLS, and only the service role — the edge
-- function, which holds the decryption key and has the audit trail wrapped
-- around it — can reach a row. A policy admitting platform admins would put
-- ciphertext within reach of a browser session token, and there is no operation
-- an administrator legitimately performs against these rows that does not go
-- through the administration API.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Provider configuration
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cortex.ai_provider_configuration (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The adapter's provider id: 'openai', 'anthropic'. Lower-case, bounded, and
  -- never free text an administrator typed: the administration service refuses
  -- a key the provider registry does not know, so a typo cannot create a
  -- configuration for a provider that does not exist.
  provider_key        TEXT NOT NULL
                        CONSTRAINT ai_provider_configuration_key_format
                        CHECK (provider_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  display_name        TEXT NOT NULL
                        CONSTRAINT ai_provider_configuration_display_name_length
                        CHECK (char_length(display_name) BETWEEN 1 AND 120),
  scope               TEXT NOT NULL DEFAULT 'platform'
                        CONSTRAINT ai_provider_configuration_scope
                        CHECK (scope IN ('platform', 'organization')),
  organization_id     UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  -- MARQ's governance decision. Distinct from `enabled`, which is operational,
  -- and from whether a credential exists, which is neither.
  certification       TEXT NOT NULL DEFAULT 'unverified'
                        CONSTRAINT ai_provider_configuration_certification
                        CHECK (certification IN
                          ('unverified', 'testing', 'certified', 'degraded', 'disabled')),
  -- Non-secret configuration only: base URLs, region hints, deployment names.
  -- The administration service bounds what may be written here and refuses
  -- anything that looks like key material.
  configuration       JSONB NOT NULL DEFAULT '{}'::JSONB
                        CONSTRAINT ai_provider_configuration_is_object
                        CHECK (jsonb_typeof(configuration) = 'object'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT NOT NULL,
  updated_by          TEXT NOT NULL,

  -- Scope and tenancy agree, structurally. A platform row cannot name a
  -- tenant and an organization row cannot omit one, so no query has to guess
  -- which kind of row it is holding.
  CONSTRAINT ai_provider_configuration_scope_tenancy CHECK (
    (scope = 'platform' AND organization_id IS NULL)
    OR (scope = 'organization' AND organization_id IS NOT NULL)
  )
);

-- One platform configuration per provider. Partial, because the same provider
-- key must remain available to an organization row in Batch 4D.
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configuration_platform_key
  ON cortex.ai_provider_configuration (provider_key)
  WHERE scope = 'platform';

-- One organization configuration per (tenant, provider). Reserved for 4D.
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_configuration_organization_key
  ON cortex.ai_provider_configuration (organization_id, provider_key)
  WHERE scope = 'organization';

CREATE INDEX IF NOT EXISTS ai_provider_configuration_scope_idx
  ON cortex.ai_provider_configuration (scope, provider_key);

COMMENT ON TABLE cortex.ai_provider_configuration IS
  'AI-01 Batch 4C. Platform-owned AI provider configuration. Holds no secret material. '
  'Managed exclusively through the governed AI administration API; service role only.';

-- ---------------------------------------------------------------------------
-- Provider credential
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cortex.ai_provider_credential (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id      UUID NOT NULL
                          REFERENCES cortex.ai_provider_configuration(id) ON DELETE CASCADE,
  credential_name       TEXT NOT NULL
                          CONSTRAINT ai_provider_credential_name_length
                          CHECK (char_length(credential_name) BETWEEN 1 AND 80),

  -- THE SEALED SECRET. AES-256-GCM, sealed in the edge function against a root
  -- key held in the deployment environment. The record carries its algorithm,
  -- its version, the root key's identity, a per-record initialisation vector
  -- and the ciphertext — and no plaintext. See
  -- ai/providers/credentials/secretCipher.ts.
  --
  -- The shape is asserted here rather than trusted, so a row written by
  -- anything other than the sealing code is rejected by the database instead of
  -- failing to decrypt hours later.
  encrypted_secret      JSONB NOT NULL
                          CONSTRAINT ai_provider_credential_sealed_shape CHECK (
                            jsonb_typeof(encrypted_secret) = 'object'
                            AND encrypted_secret ? 'v'
                            AND encrypted_secret ? 'alg'
                            AND encrypted_secret ? 'kid'
                            AND encrypted_secret ? 'iv'
                            AND encrypted_secret ? 'ct'
                            AND encrypted_secret ->> 'alg' = 'AES-256-GCM'
                          ),

  -- Identity of the root key the record was sealed under, denormalised out of
  -- the sealed record so an operator can find every credential affected by a
  -- root key rotation without decrypting anything.
  key_id                TEXT NOT NULL
                          CONSTRAINT ai_provider_credential_key_id_format
                          CHECK (key_id ~ '^k_[0-9a-f]{4,32}$'),

  -- A KEYED, TRUNCATED digest. Identifies a key without revealing it, and
  -- differs between deployments so it cannot be matched against a precomputed
  -- table. Not a hash of the secret alone, deliberately.
  fingerprint           TEXT NOT NULL
                          CONSTRAINT ai_provider_credential_fingerprint_format
                          CHECK (fingerprint ~ '^fp_[0-9a-f]{8,64}$'),

  -- At most four characters, and only when the secret was long enough for four
  -- characters to be a rounding error against its entropy. The constraint is
  -- the backstop: a caller cannot store a longer prefix by mistake.
  last_four             TEXT
                          CONSTRAINT ai_provider_credential_last_four_length
                          CHECK (last_four IS NULL OR char_length(last_four) BETWEEN 1 AND 4),

  secret_version        INTEGER NOT NULL DEFAULT 1
                          CONSTRAINT ai_provider_credential_version_positive
                          CHECK (secret_version >= 1),

  status                TEXT NOT NULL DEFAULT 'active'
                          CONSTRAINT ai_provider_credential_status
                          CHECK (status IN ('active', 'superseded', 'revoked')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at            TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  created_by            TEXT NOT NULL,
  revoked_by            TEXT,

  -- A revoked credential has a revocation; a live one does not. Without this
  -- the trail can say "revoked" with no record of when or by whom, which is
  -- the one thing an incident review will ask for.
  CONSTRAINT ai_provider_credential_revocation_complete CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL AND revoked_by IS NULL)
  )
);

-- EXACTLY ONE ACTIVE CREDENTIAL PER CONFIGURATION, enforced by the database.
--
-- Deterministic active-credential semantics were a Batch 4C requirement, and a
-- requirement enforced only in application code is a requirement that holds
-- until the second writer. Two active credentials would make the runtime pick,
-- and any tiebreak it could apply would be a guess about which key an operator
-- meant.
--
-- Multiple credential ROWS per configuration remain fully supported — that is
-- the rotation history, and it is what keeps Batch 4F from having to replace
-- this schema to get backup and regional credentials.
CREATE UNIQUE INDEX IF NOT EXISTS ai_provider_credential_one_active
  ON cortex.ai_provider_credential (configuration_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ai_provider_credential_configuration_idx
  ON cortex.ai_provider_credential (configuration_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_provider_credential_key_id_idx
  ON cortex.ai_provider_credential (key_id)
  WHERE status = 'active';

COMMENT ON TABLE cortex.ai_provider_credential IS
  'AI-01 Batch 4C. Encrypted AI provider credentials (AES-256-GCM, root key held in the '
  'edge function environment, never in this database). NO RLS POLICY EXISTS ON THIS TABLE '
  'BY DESIGN: service role only. There is no API, view or function that returns plaintext.';

COMMENT ON COLUMN cortex.ai_provider_credential.encrypted_secret IS
  'Sealed secret record. Contains no plaintext. Openable only by the edge function holding '
  'AI_CREDENTIAL_ENCRYPTION_KEY, and only for the exact (provider, scope, credential id) it '
  'was sealed against.';

-- ---------------------------------------------------------------------------
-- Provider model configuration
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cortex.ai_provider_model (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id    UUID NOT NULL
                        REFERENCES cortex.ai_provider_configuration(id) ON DELETE CASCADE,
  model_id            TEXT NOT NULL
                        CONSTRAINT ai_provider_model_id_format
                        CHECK (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  display_name        TEXT NOT NULL
                        CONSTRAINT ai_provider_model_display_name_length
                        CHECK (char_length(display_name) BETWEEN 1 AND 160),
  enabled             BOOLEAN NOT NULL DEFAULT false,
  -- Certification is a MARQ governance decision, recorded per model.
  --
  -- An administrator CANNOT set this to 'certified' through the Batch 4C API.
  -- The administration service derives it from the certified catalogue the
  -- adapters declare, so typing a model name into a console can never make that
  -- model production-eligible — which is precisely the failure mode the batch
  -- named. The column exists so the decision has somewhere to live and so a
  -- future certification workflow writes a row rather than a code change.
  certification       TEXT NOT NULL DEFAULT 'unverified'
                        CONSTRAINT ai_provider_model_certification
                        CHECK (certification IN
                          ('unverified', 'testing', 'certified', 'degraded', 'disabled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          TEXT NOT NULL,

  CONSTRAINT ai_provider_model_unique UNIQUE (configuration_id, model_id)
);

CREATE INDEX IF NOT EXISTS ai_provider_model_configuration_idx
  ON cortex.ai_provider_model (configuration_id, model_id);

COMMENT ON TABLE cortex.ai_provider_model IS
  'AI-01 Batch 4C. Per-provider model enablement and certification state. Holds no secret '
  'material. Certification is derived from the certified catalogue, never from console input.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE cortex.ai_provider_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortex.ai_provider_credential    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cortex.ai_provider_model         ENABLE ROW LEVEL SECURITY;

-- Forced, so a future table owner does not become an implicit bypass. The edge
-- function reaches these rows as the service role, which bypasses RLS at the
-- role level rather than the ownership level and is unaffected.
ALTER TABLE cortex.ai_provider_configuration FORCE ROW LEVEL SECURITY;
ALTER TABLE cortex.ai_provider_credential    FORCE ROW LEVEL SECURITY;
ALTER TABLE cortex.ai_provider_model         FORCE ROW LEVEL SECURITY;

-- No grants to the browser-facing roles. Belt and braces beside RLS: a policy
-- added carelessly in a future migration still cannot open a table the role has
-- no privilege on.
REVOKE ALL ON cortex.ai_provider_configuration FROM anon, authenticated;
REVOKE ALL ON cortex.ai_provider_credential    FROM anon, authenticated;
REVOKE ALL ON cortex.ai_provider_model         FROM anon, authenticated;

-- Platform operators may READ non-secret configuration directly. They may not
-- write it: every mutation must go through the administration API so that it is
-- capability-checked, validated against the provider registry, reason-bearing
-- and audited. A direct UPDATE would satisfy none of those.
DROP POLICY IF EXISTS ai_provider_configuration_platform_read ON cortex.ai_provider_configuration;
CREATE POLICY ai_provider_configuration_platform_read
  ON cortex.ai_provider_configuration
  FOR SELECT
  USING (cortex.is_platform_admin());

DROP POLICY IF EXISTS ai_provider_model_platform_read ON cortex.ai_provider_model;
CREATE POLICY ai_provider_model_platform_read
  ON cortex.ai_provider_model
  FOR SELECT
  USING (cortex.is_platform_admin());

-- cortex.ai_provider_credential: NO POLICY. Intentionally, permanently.
--
-- RLS is enabled and no policy exists, so every role that respects RLS is
-- denied every row. The service role reaches these rows and nothing else does.
-- A reader of this file looking for the credential policy has found it: its
-- absence IS the control, and adding one would put encrypted key material
-- within reach of a browser session token for no operation the administration
-- API does not already provide.

COMMIT;
