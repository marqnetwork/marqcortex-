-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4C: credential activation is ATOMIC (4C-R7)
--
-- Runs after 94_assert_4c_runtime_lifecycle.sql, on the same database.
--
-- WHY THIS IS A FILE OF ITS OWN.
--
-- `cortex.ai_provider_credential_activate` supersedes the active credential and
-- then inserts its replacement. Issued as two PostgREST calls those are two
-- transactions, and anything failing between them leaves the configuration with
-- ZERO active credentials — after which the runtime resolves the deployment
-- environment variable instead, while the console reports a successful
-- rotation. An operator who thought they had rotated a key would be executing
-- on the old one.
--
-- The property under test is therefore "a FAILED activation leaves the previous
-- credential active", and it CANNOT be asked from inside a plpgsql
-- `EXCEPTION` block: that handler opens a subtransaction, and rolling back to
-- its savepoint would undo the supersede whether or not the function itself is
-- atomic. The test would pass on a non-atomic function.
--
-- So it is asked here, at psql's statement level, where each statement outside
-- an explicit transaction block is its own transaction — which is exactly what
-- a PostgREST RPC call is. `ON_ERROR_STOP` is lowered for precisely one
-- statement, the one that must fail, and raised again immediately.
--
-- The whole file runs as `service_role`, because that is the role that issues
-- the call in production.
-- ---------------------------------------------------------------------------

SET ROLE service_role;

-- A clean starting point: one configuration, one active credential.
INSERT INTO cortex.ai_provider_configuration
  (id, provider_key, display_name, scope, organization_id, enabled, certification,
   configuration, created_at, updated_at, created_by, updated_by)
VALUES
  ('pvc_atomic001', 'anthropic', 'Anthropic', 'platform', NULL, true, 'certified',
   '{}'::JSONB, NOW(), NOW(), 'usr_operator', 'usr_operator')
ON CONFLICT (id) DO NOTHING;

SELECT cortex.ai_provider_credential_activate(
  'pvk_atomicone', 'pvc_atomic001', 'in force',
  '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB,
  'k_1a2b', 'fp_0000000000000011', NULL, 1, NOW(), NULL, 'usr_operator');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cortex.ai_provider_credential
     WHERE id = 'pvk_atomicone' AND status = 'active'
  ) THEN
    RAISE EXCEPTION '4C-R7: the fixture credential is not active before the failing rotation';
  END IF;
END $$;

-- THE FAILING ROTATION, AS ITS OWN TRANSACTION.
--
-- The identifier violates `ai_provider_credential_id_format`, so the INSERT
-- inside the function raises AFTER the UPDATE that supersedes `pvk_atomicone`
-- has already run. If the two statements were not one transaction, the
-- supersede would survive and this configuration would be left with no active
-- credential at all.
\set ON_ERROR_STOP 0
SELECT cortex.ai_provider_credential_activate(
  'this-is-not-a-pvk-id', 'pvc_atomic001', 'doomed',
  '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB,
  'k_1a2b', 'fp_0000000000000022', NULL, 2, NOW(), NOW(), 'usr_operator');
\set ON_ERROR_STOP 1

DO $$
DECLARE
  v_status TEXT;
  v_active INTEGER;
  v_rows   INTEGER;
BEGIN
  SELECT status INTO v_status FROM cortex.ai_provider_credential WHERE id = 'pvk_atomicone';
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION
      '4C-R7: after a FAILED rotation the previous credential is "%" rather than active. '
      'The supersede committed without its insert, and this configuration has no credential '
      'in force while the console believes the rotation succeeded.', v_status;
  END IF;

  SELECT count(*) INTO v_active
    FROM cortex.ai_provider_credential
   WHERE configuration_id = 'pvc_atomic001' AND status = 'active';
  IF v_active <> 1 THEN
    RAISE EXCEPTION '4C-R7: expected exactly 1 active credential after the failure, found %',
      v_active;
  END IF;

  -- And the doomed row left nothing behind.
  SELECT count(*) INTO v_rows
    FROM cortex.ai_provider_credential WHERE configuration_id = 'pvc_atomic001';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '4C-R7: the failed activation left % rows behind, expected 1', v_rows;
  END IF;

  RAISE NOTICE
    'assert_4c_activation_atomicity: PASSED (a failed rotation left the previous credential '
    'in force)';
END $$;

-- A SUCCEEDING rotation issued the same way still supersedes, so the assertion
-- above is not passing because the function does nothing.
SELECT cortex.ai_provider_credential_activate(
  'pvk_atomictwo', 'pvc_atomic001', 'replacement',
  '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB,
  'k_1a2b', 'fp_0000000000000033', NULL, 2, NOW(), NOW(), 'usr_operator');

DO $$
DECLARE
  v_active TEXT;
BEGIN
  SELECT string_agg(id || ':' || status, ', ' ORDER BY id) INTO v_active
    FROM cortex.ai_provider_credential WHERE configuration_id = 'pvc_atomic001';
  IF v_active IS DISTINCT FROM 'pvk_atomicone:superseded, pvk_atomictwo:active' THEN
    RAISE EXCEPTION '4C-R7: a successful rotation produced "%"', v_active;
  END IF;
  RAISE NOTICE 'assert_4c_activation_atomicity: PASSED (a successful rotation supersedes)';
END $$;

RESET ROLE;
