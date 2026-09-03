-- ============================================================================
-- ROLLBACK — AI-01 Batch 4E, self-hosted / OpenAI-compatible providers
-- Reverses: 20260903120000_ai_self_hosted_providers.sql
-- ============================================================================
--
-- WHAT THIS REVERSES, AND WHAT IT CANNOT.
--
-- The forward migration added ONE shape constraint and ONE predicate function,
-- and corrected one column comment. All three are reversed here.
--
-- IT DOES NOT DELETE DATA. Any self-hosted provider configuration an
-- administrator defined stays exactly where it is. That is deliberate: removing
-- a shape constraint is not a reason to destroy an operator's configuration,
-- and the runtime remains the authority on whether such a row may become a
-- callable endpoint — after this rollback, as before it, an endpoint is dialled
-- only if the runtime endpoint policy accepted it.
--
-- WHAT IS TRUE AFTER RUNNING THIS. The database will once again accept nested
-- JSON and credential-shaped keys in `configuration`. The runtime still refuses
-- both, so the exposure is that the COLUMN can hold something the platform will
-- not use — not that an unsafe endpoint becomes reachable.
-- ============================================================================

BEGIN;

-- The constraint before the function it calls, so nothing is left pointing at a
-- definition that has been dropped.
ALTER TABLE cortex.ai_provider_configuration
  DROP CONSTRAINT IF EXISTS ai_provider_configuration_shape;

DROP FUNCTION IF EXISTS cortex.ai_provider_configuration_shape_is_safe(JSONB);

-- The Batch 4C column comment, restored verbatim. Leaving the 4E text behind
-- after a 4E rollback would make the schema's own documentation describe a
-- constraint that is no longer applied.
COMMENT ON COLUMN cortex.ai_provider_configuration.configuration IS
  'AI-01 Batch 4C. Non-secret provider configuration only: base URLs, region hints, '
  'deployment names. No validator exists at the database layer; whoever adds an '
  'operator-supplied endpoint write path owns adding one.';

COMMIT;
