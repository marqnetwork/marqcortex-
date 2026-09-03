-- ============================================================================
-- AI-01 Batch 4E — Self-hosted / OpenAI-compatible providers
-- Depends on: 20260828120000_ai_provider_administration.sql
--             20260901120000_ai_customer_byok.sql
-- Rollback:   supabase/migrations/rollbacks/20260903120000_rollback_ai_self_hosted_providers.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION IS FOR, AND IT IS ONE THING.
--
-- Batch 4C created `cortex.ai_provider_configuration.configuration` and wrote
-- an open item into the column's own comment:
--
--   "NOTHING WRITES A NON-EMPTY VALUE HERE YET, AND NOTHING VALIDATES ONE.
--    ... It becomes [a hole] the moment Batch 4E adds operator-supplied base
--    URLs: an unvalidated URL in a column the runtime dials is a server-side
--    request forgery surface. Whoever adds that write path OWNS adding the
--    validator."
--
-- Batch 4E is that write path. The validator itself lives in the runtime —
-- `ai/providers/selfHosted/endpointPolicy.ts` and `.../definition.ts` — because
-- deciding whether a hostname is a loopback alias, an IPv4-mapped IPv6 literal
-- or a cloud metadata address is not something a CHECK constraint can do
-- honestly. It runs on BOTH sides: the administration surface validates before
-- it writes, and hydration validates again before it registers, so a row that
-- reached storage by any other means still cannot become a callable endpoint.
--
-- ── WHAT THIS MIGRATION ADDS: ONE SHAPE CONSTRAINT ────────────────────────
--
-- This adds the half a database CAN enforce, and only that half: the
-- configuration column holds a FLAT map of bounded TEXT values, and no key is
-- named like credential material.
--
-- That is defence in depth for two specific failures, both of which are about
-- what the column can HOLD rather than about what the runtime will DIAL:
--
--   NESTED, UNVALIDATED JSON. The 4E contract is a flat map of strings. A
--   nested object or array in this column would be a second schema living
--   inside a validated one — exactly the "arbitrary unvalidated JSON" the batch
--   forbids — and the runtime's own parser rejects it. Refusing it at the
--   storage layer means it cannot be present to be misread by anything written
--   later against this table, including code that is not the AI control plane.
--
--   A SECRET IN THE NON-SECRET COLUMN. Credentials belong in
--   `cortex.ai_provider_credential`, sealed. A key called `api_key` or
--   `password` here is somebody putting one in the wrong place, where it is not
--   encrypted and where every reader of this table can see it. The pattern
--   below is deliberately NARROW — it names only unambiguous words, so it
--   cannot reject the schema's own legitimate keys (`credentialRequired`,
--   `model.0.maxOutputTokens`) the way a broader one would.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
--
-- IT CREATES NO TABLE AND NO COLUMN. A self-hosted provider is a row in the
-- table Batch 4C already built, with a value in the column Batch 4C already
-- provided for exactly this. Its models are `cortex.ai_provider_model` rows and
-- its credential, where it needs one, is a `cortex.ai_provider_credential` row.
--
-- IT DOES NOT TRY TO VALIDATE A URL. There is no regex here that pretends to
-- decide whether an endpoint is safe to dial. A partial check in SQL beside a
-- complete one in the runtime would be worse than no check in SQL: a reader
-- would reasonably assume the database was the authority, and the two would
-- drift on the first address family somebody forgot.
--
-- IT SEEDS NOTHING. No provider, no endpoint, no model, no credential. A
-- self-hosted provider exists when a MARQ platform administrator defines one
-- through the governed API, and it serves traffic only once separately
-- certified.
--
-- IT CHANGES NO PRIVILEGE, NO POLICY AND NO GRANT. The three Batch 4C tables
-- remain service-role only with no RLS policy, which is the smaller surface and
-- the simpler true statement.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- The shape predicate
-- ---------------------------------------------------------------------------
--
-- A FUNCTION rather than an inline CHECK, because the predicate has to iterate
-- the object's members and a CHECK constraint may not contain a subquery. It is
-- IMMUTABLE and pure: it reads no table, no setting and no clock, so its answer
-- for a given value can never change underneath a constraint that depends on it.
--
-- Every identifier is schema-qualified and every operator is a built-in, so the
-- function's behaviour does not depend on the caller's `search_path`.
CREATE OR REPLACE FUNCTION cortex.ai_provider_configuration_shape_is_safe(config JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    -- The 4C constraint already asserts this; asserted again so the function is
    -- total rather than relying on its caller.
    jsonb_typeof(config) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(config)) <= 160
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(config) AS entry(key, value)
      WHERE
        -- FLAT AND TEXTUAL. No nested object, no array, no number, no boolean,
        -- no null. The runtime contract is a map of strings and this is that
        -- statement, enforced.
        jsonb_typeof(entry.value) <> 'string'
        OR length(entry.value #>> '{}') > 2048
        OR length(entry.key) > 120
        -- NARROW BY DESIGN. Only words that cannot appear in a legitimate 4E
        -- key. `token` and `credential` are deliberately ABSENT: the schema's
        -- own `credentialRequired`, `model.N.maxOutputTokens` and
        -- `model.N.maxContextTokens` contain them, and a constraint that
        -- rejects the schema it exists to protect is a constraint somebody
        -- will disable. The runtime's parser closes the rest with an allow
        -- list, which is a stronger control and the right place for it.
        OR entry.key ~* '(secret|password|passwd|api[-_]?key|access[-_]?key|private[-_]?key|connection[-_]?string|authorization|bearer)'
    );
$$;

COMMENT ON FUNCTION cortex.ai_provider_configuration_shape_is_safe(JSONB) IS
  'AI-01 Batch 4E. True when a provider configuration is a flat object of bounded TEXT '
  'values with no credential-shaped key. Shape only — it makes no claim about whether an '
  'endpoint is safe to dial; that is decided by the runtime endpoint policy.';

-- The runtime executes as `service_role`, and a CHECK constraint is evaluated
-- as the writing role. A REVOKE here with no matching GRANT is how Batch 4C's
-- production gate found every write failing with `permission denied for
-- function`; this migration does not repeat it. The predicate reveals nothing —
-- it takes a value the caller already holds and returns a boolean — so the
-- default PUBLIC execute privilege is left in place and the runtime's role is
-- named explicitly.
GRANT EXECUTE ON FUNCTION cortex.ai_provider_configuration_shape_is_safe(JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- The constraint
-- ---------------------------------------------------------------------------
--
-- Added conditionally because PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`,
-- and this migration must be re-runnable like every other one in this tree.
--
-- EXISTING ROWS PASS. Every configuration Batch 4C or 4D wrote carries `{}`,
-- which satisfies the predicate trivially — so this adds a constraint to a
-- table that may already hold production rows without validating a single one
-- into failure.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_provider_configuration_shape'
      AND conrelid = 'cortex.ai_provider_configuration'::regclass
  ) THEN
    ALTER TABLE cortex.ai_provider_configuration
      ADD CONSTRAINT ai_provider_configuration_shape
      CHECK (cortex.ai_provider_configuration_shape_is_safe(configuration));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The column comment, corrected
-- ---------------------------------------------------------------------------
--
-- The 4C text said plainly that nothing wrote this column and nothing validated
-- it, and named the batch that would own the validator. Both halves are now
-- false, and a comment that stays false is worse than no comment: a reviewer
-- trusts it and stops looking.
COMMENT ON COLUMN cortex.ai_provider_configuration.configuration IS
  'AI-01 Batch 4C, validated by 4E. Non-secret provider configuration: a FLAT map of TEXT '
  'values. For a self-hosted provider it carries the runtime category, the API base URL, '
  'the credential requirement and the declared model catalogue. The shape is enforced by '
  'the ai_provider_configuration_shape constraint; the ENDPOINT is validated by the '
  'runtime endpoint policy (ai/providers/selfHosted/endpointPolicy.ts), which refuses '
  'non-https, loopback, private, link-local and cloud-metadata targets and anything shaped '
  'like key material — on the administration write path and again on every hydration. '
  'NEVER holds a credential: secrets live in cortex.ai_provider_credential, sealed.';

COMMIT;
