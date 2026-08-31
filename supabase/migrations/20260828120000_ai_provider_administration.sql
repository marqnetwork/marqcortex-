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
-- ROW LEVEL SECURITY: DENY, ON ALL THREE, WITH NO POLICY ANYWHERE.
--
-- All three tables enable and FORCE row level security and NONE of them carries
-- a policy. With RLS enabled and no policy, every role that respects RLS is
-- denied every row; the service role reaches them because it holds `BYPASSRLS`,
-- and nothing else does.
--
-- An earlier revision gave `ai_provider_configuration` and `ai_provider_model` a
-- platform-admin SELECT policy on the reasoning that those rows are non-secret
-- and an operator reading them during an incident is legitimate. Those policies
-- were DEAD — no migration grants `authenticated` a table privilege in `cortex`
-- and this one revokes them explicitly — so they were removed rather than made
-- live. See the block at the foot of this file.
--
-- `ai_provider_credential` never had one, and that absence was always the point:
-- a policy admitting platform admins would put encrypted key material within
-- reach of a browser session token, and there is no operation an administrator
-- legitimately performs against these rows that does not go through the
-- administration API.
--
-- PRIVILEGES ARE SEPARATE FROM RLS, AND BOTH ARE REQUIRED.
--
-- `BYPASSRLS` exempts the service role from POLICIES. It grants no TABLE
-- PRIVILEGE — and these tables live in `cortex`, not `public`, so the Supabase
-- default privileges that blanket `public` never reach them. Without the
-- explicit grants at the foot of this file the runtime's own reads and writes
-- fail with `permission denied for table`, which is exactly what an independent
-- production gate found. Those grants are enumerated, minimal, and derived from
-- the operations the runtime actually performs.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Provider configuration
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cortex.ai_provider_configuration (
  -- TEXT, NOT UUID, AND NOT DATABASE-GENERATED.
  --
  -- Every identifier in the AI platform is minted by `contracts/ids.ts` and
  -- carries a kind prefix: `pvc_` here, `pvk_` for a credential, `pvm_` for a
  -- model record. The prefix is load-bearing — a credential id and a
  -- configuration id appear side by side in one audit record, and a reader has
  -- to tell them apart at a glance — so the identifier the service mints IS the
  -- identifier, and the column takes the format it actually produces.
  --
  -- Declaring these UUID would reject every write the service makes, which is
  -- exactly what an independent review of this batch found before it shipped.
  id                  TEXT PRIMARY KEY
                        CONSTRAINT ai_provider_configuration_id_format
                        CHECK (id ~ '^pvc_[A-Za-z0-9]{1,64}$'),
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
  --
  -- NOTHING WRITES A NON-EMPTY VALUE HERE YET, AND NOTHING VALIDATES ONE.
  -- Batch 4C's administration service always writes `{}` and offers no API
  -- field that reaches this column, so the absence of a validator is not a hole
  -- today. It becomes one the moment Batch 4E adds operator-supplied base URLs:
  -- an unvalidated URL in a column the runtime dials is a server-side request
  -- forgery surface. Whoever adds that write path OWNS adding the validator —
  -- allow-listed schemes, no private address ranges, and a refusal for anything
  -- shaped like key material.
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
  id                    TEXT PRIMARY KEY
                          CONSTRAINT ai_provider_credential_id_format
                          CHECK (id ~ '^pvk_[A-Za-z0-9]{1,64}$'),
  configuration_id      TEXT NOT NULL
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
  id                  TEXT PRIMARY KEY
                        CONSTRAINT ai_provider_model_id_format
                        CHECK (id ~ '^pvm_[A-Za-z0-9]{1,64}$'),
  configuration_id    TEXT NOT NULL
                        REFERENCES cortex.ai_provider_configuration(id) ON DELETE CASCADE,
  -- CONSTRAINT NAME, NOT COLUMN NAME.
  --
  -- This check was originally named `ai_provider_model_id_format` — the same
  -- name the primary key's check above already carries. PostgreSQL keys table
  -- constraints by (table, name), so the second CREATE TABLE clause was
  -- rejected outright with `check constraint "ai_provider_model_id_format"
  -- already exists` and the whole migration failed at parse-apply time. It had
  -- never been applied anywhere, so correcting it here is a correction to an
  -- unapplied file rather than a change to deployed schema.
  --
  -- The two checks guard two different things and now say so: the row's own
  -- `pvm_` identifier, and the VENDOR's model identifier — `gpt-4o`,
  -- `claude-sonnet-4-5-20250929` — which is not a MARQ identifier at all.
  model_id            TEXT NOT NULL
                        CONSTRAINT ai_provider_model_model_id_format
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
-- Atomic credential activation
-- ---------------------------------------------------------------------------
--
-- WHY THIS IS A FUNCTION AND NOT TWO CALLS FROM THE EDGE FUNCTION.
--
-- Activating a credential is two statements: supersede whatever is active, then
-- insert the new one. Issued as two PostgREST calls they are two transactions,
-- and anything that fails between them — a constraint violation, a dropped
-- connection, an exposed-schema misconfiguration — leaves the configuration
-- with ZERO active credentials.
--
-- That failure is the worst shape available. There is no un-supersede
-- operation, so recovery means entering a new secret; and in the meantime the
-- runtime resolves no managed credential and silently falls back to the
-- deployment environment variable. An operator who thought they had rotated a
-- key would be executing on the old one, with the console reporting a
-- successful rotation.
--
-- Two concurrent rotations from different isolates can interleave the same way.
-- The edge function's mutation lock is per-isolate and does not help.
--
-- A plpgsql function body is ONE transaction. The partial unique index
-- `ai_provider_credential_one_active` already guarantees that at most one row
-- is active; what was missing was atomicity in getting there, and this supplies
-- it. An independent review of this batch caught it before it shipped.
--
-- SECURITY DEFINER, and narrow: it takes exactly the columns a credential has,
-- writes exactly one row, and has no branch that reads a secret back out.
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
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cortex, public
AS $$
BEGIN
  -- Supersede first. If the insert below then fails, the whole function rolls
  -- back and the previous credential is still active — which is the entire
  -- reason these two statements share a transaction.
  UPDATE cortex.ai_provider_credential
     SET status = 'superseded',
         updated_at = p_created_at
   WHERE configuration_id = p_configuration_id
     AND status = 'active';

  INSERT INTO cortex.ai_provider_credential (
    id, configuration_id, credential_name, encrypted_secret, key_id,
    fingerprint, last_four, secret_version, status, created_at, updated_at,
    rotated_at, created_by
  ) VALUES (
    p_credential_id, p_configuration_id, p_credential_name, p_encrypted_secret,
    p_key_id, p_fingerprint, p_last_four, p_secret_version, 'active',
    p_created_at, p_created_at, p_rotated_at, p_created_by
  );
END;
$$;

-- The browser-facing roles cannot call it. `SECURITY DEFINER` means this
-- function runs with the owner's rights, so leaving the default PUBLIC EXECUTE
-- in place would hand any authenticated session a way to write a credential row
-- that RLS otherwise denies them entirely.
REVOKE ALL ON FUNCTION cortex.ai_provider_credential_activate(
  TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;

-- AND THEN THE ONE ROLE THAT MUST CALL IT GETS IT BACK.
--
-- `REVOKE ... FROM PUBLIC` on a function removes the DEFAULT execute privilege
-- that every role, service_role included, held only by virtue of being part of
-- PUBLIC. Revoking without re-granting therefore locked the edge function out of
-- the only path that writes a credential — `putActiveCredential` — and every
-- rotation would have failed with `permission denied for function
-- ai_provider_credential_activate`. An independent production gate found exactly
-- that, on a migration that had never been applied.
--
-- EXECUTE, to service_role, and to nothing else. `anon` and `authenticated`
-- stay revoked above; PUBLIC stays revoked; no role acquires this function by
-- default privilege again.
GRANT EXECUTE ON FUNCTION cortex.ai_provider_credential_activate(
  TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) TO service_role;

COMMENT ON FUNCTION cortex.ai_provider_credential_activate(
  TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) IS
  'AI-01 Batch 4C. Supersede the active credential and insert its replacement in one '
  'transaction, so a failed rotation cannot leave a configuration with no active '
  'credential. Service role only; not callable by anon or authenticated.';

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
REVOKE ALL ON cortex.ai_provider_configuration FROM PUBLIC, anon, authenticated;
REVOKE ALL ON cortex.ai_provider_credential    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON cortex.ai_provider_model         FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Service role privileges — enumerated, and no wider than the runtime is
-- ---------------------------------------------------------------------------
--
-- WHY THIS BLOCK EXISTS AT ALL.
--
-- `service_role` bypasses ROW LEVEL SECURITY. It does not bypass TABLE
-- PRIVILEGES, and the two are separate systems: RLS decides which rows a
-- statement may touch, `GRANT` decides whether the statement may run. Supabase
-- ships default privileges that blanket the `public` schema; these tables live
-- in `cortex` precisely so that blanket does not cover them, and the price of
-- that choice is that every privilege here has to be written down.
--
-- Without this block the runtime fails on its first call — `permission denied
-- for table ai_provider_configuration` — and provider administration is dead on
-- arrival while the rest of the platform runs normally. An independent
-- production gate found exactly that.
--
-- WHAT THE RUNTIME ACTUALLY DOES, read off `aiProviderAdministrationStore.ts`
-- rather than assumed. Every grant below traces to a line in that file:
--
--   ai_provider_configuration
--     SELECT   listConfigurations, findConfiguration, providerKeyOf
--     INSERT   saveConfiguration (upsert, first write)
--     UPDATE   saveConfiguration (upsert, ON CONFLICT DO UPDATE)
--
--   ai_provider_credential
--     SELECT   listCredentials (metadata columns), activeCredential
--     UPDATE   revokeCredential
--     — and NO INSERT. The only insert is inside
--       `ai_provider_credential_activate`, which is SECURITY DEFINER and writes
--       as its owner. Granting service_role a direct INSERT here would create a
--       second, non-atomic way to reach the state that function exists to make
--       atomic, so it is deliberately withheld.
--
--   ai_provider_model
--     SELECT   listModels
--     INSERT   saveModel (upsert, first write)
--     UPDATE   saveModel (upsert, ON CONFLICT DO UPDATE)
--
-- WHAT IS DELIBERATELY NOT GRANTED, on any of the three:
--
--   DELETE      — nothing in the runtime deletes a provider row. Configuration
--                 is disabled, credentials are revoked, models are turned off.
--                 A privilege for an operation that does not exist is a
--                 privilege available only to a mistake or an attacker.
--   TRUNCATE    — as above, and it would take the rotation history with it.
--   REFERENCES  — nothing outside this migration points at these tables.
--   TRIGGER     — no runtime path creates one.
--   ALL         — an enumeration is a decision; `ALL PRIVILEGES` is the absence
--                 of one, and it silently acquires whatever a future PostgreSQL
--                 adds to the set.
--
-- NOTHING IS GRANTED TO `anon` OR `authenticated`, here or anywhere. They are
-- revoked immediately above and denied by RLS besides. Both controls are kept:
-- the revoke survives somebody adding a policy, and the policy-less RLS
-- survives somebody adding a grant.
--
-- `USAGE ON SCHEMA cortex` was granted to service_role by
-- 20260711050001_cortex_tenancy_rls_and_seed.sql. It is re-asserted here so
-- this migration does not silently depend on a grant made five migrations ago;
-- the statement is idempotent and widens nothing.
GRANT USAGE ON SCHEMA cortex TO service_role;

GRANT SELECT, INSERT, UPDATE ON cortex.ai_provider_configuration TO service_role;
GRANT SELECT,         UPDATE ON cortex.ai_provider_credential    TO service_role;
GRANT SELECT, INSERT, UPDATE ON cortex.ai_provider_model         TO service_role;

-- NO POLICY ON ANY OF THE THREE TABLES. Service role only, for all of them.
--
-- An earlier revision of this migration created platform-admin SELECT policies
-- on the two non-secret tables, on the reasoning that an operator reading
-- configuration directly during an incident is legitimate. An independent
-- review pointed out that those policies were DEAD: no migration ever granted
-- `authenticated` table privileges in the `cortex` schema, and this file
-- revokes them explicitly above, so the policies could never be reached.
--
-- The dead policies were removed rather than made live. Granting `authenticated`
-- SELECT on two more tables to enable a read the administration API already
-- serves is privilege for no capability — and a policy that exists but cannot
-- fire is worse than none, because the next person to debug "why can't I read
-- this as a platform admin" reads it and hunts in the wrong place.
--
-- For the credential table the absence was always deliberate and is now the
-- rule for all three: with RLS enabled and no policy, every role that respects
-- RLS is denied every row. The service role reaches these rows because it holds
-- `BYPASSRLS` and the enumerated privileges above; nothing else holds either.
-- A reader of this file looking for the credential policy has found it: its
-- absence IS the control, and adding one would put encrypted key material
-- within reach of a browser session token for no operation the administration
-- API does not already provide.
--
-- ONE PRIVILEGE THIS FILE DEPENDS ON AND DOES NOT GRANT.
--
-- `ai_provider_credential_activate` is SECURITY DEFINER, so its INSERT and
-- UPDATE run as the migration's OWNER, and `FORCE ROW LEVEL SECURITY` above
-- applies RLS to the owner too. The function therefore requires its owner to
-- hold `BYPASSRLS` — which the role Supabase applies migrations as does. This
-- is stated rather than assumed because it is the kind of dependency that is
-- invisible until the day a deployment applies migrations as something else,
-- and `tests/database/harness/95_assert_4c_privileges.sql` proves it by
-- applying this file as a NOSUPERUSER role and then rotating a credential
-- through the function.

COMMIT;
