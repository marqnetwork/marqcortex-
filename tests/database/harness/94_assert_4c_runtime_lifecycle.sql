-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4C: the runtime lifecycle, driven as `service_role`
--
-- Runs after 20260828120000_ai_provider_administration.sql, on a database whose
-- 4C objects are owned by a NOSUPERUSER role (see 05_4c_migration_owner.sql).
--
-- THE B-2 PROOF, AND WHY IT HAS TO BE THIS SHAPE.
--
-- The production gate found that the migration granted `service_role` nothing.
-- `service_role` bypasses ROW LEVEL SECURITY and does not bypass TABLE
-- PRIVILEGES, and these tables are in `cortex`, which no Supabase default
-- privilege covers — so every runtime call would have failed with `permission
-- denied for table`. Neither the text scan nor any TypeScript test could see
-- that, because both stop at the edge of the database.
--
-- So this file does not ask "is there a GRANT statement in the file". It SETS
-- ROLE service_role and performs, statement for statement, the operations
-- `supabase/functions/server/aiProviderAdministrationStore.ts` performs:
--
--   4C-R1   saveConfiguration        upsert on ai_provider_configuration
--   4C-R2   findConfiguration        the `is null` platform lookup the partial
--                                    unique index depends on
--   4C-R3   putActiveCredential      the activation RPC
--   4C-R4   activeCredential         the sealed-record read
--   4C-R5   listCredentials          the metadata-only projection
--   4C-R6   rotation                 a second activation supersedes the first,
--                                    atomically
--   4C-R8   revokeCredential         the update path
--   4C-R9   saveModel / listModels   the model upsert and read
--   4C-R10  one active credential    enforced by the database, not the caller
--   4C-R11  plaintext-shaped storage is rejected
--   4C-R12  scope constraints hold, for platform and for organization
--
-- Activation ATOMICITY is proved next door, in
-- `94b_assert_4c_activation_atomicity.sql`. It cannot be proved from inside a
-- plpgsql exception handler, because the handler opens a subtransaction that
-- would undo the supersede whether or not the function is atomic — so it has to
-- be asked at psql's statement level, where a failing RPC really is a failing
-- transaction. That distinction is the whole finding.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_status    TEXT;
  v_count     INTEGER;
  v_sealed    JSONB := '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXYtdmFsdWU=","ct":"Y2lwaGVy"}'::JSONB;
  v_org       UUID;
  v_failed    BOOLEAN;
  v_message   TEXT;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION '4C-R: the tenancy seed produced no organization to scope against';
  END IF;

  SET ROLE service_role;

  -- -------------------------------------------------------------------------
  -- 4C-R1. saveConfiguration — the upsert, twice, exactly as PostgREST issues
  -- it: INSERT ... ON CONFLICT (id) DO UPDATE. Two privileges, one statement.
  -- -------------------------------------------------------------------------
  INSERT INTO cortex.ai_provider_configuration
    (id, provider_key, display_name, scope, organization_id, enabled, certification,
     configuration, created_at, updated_at, created_by, updated_by)
  VALUES
    ('pvc_openai01', 'openai', 'OpenAI', 'platform', NULL, true, 'certified',
     '{}'::JSONB, NOW(), NOW(), 'usr_operator', 'usr_operator')
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at;

  INSERT INTO cortex.ai_provider_configuration
    (id, provider_key, display_name, scope, organization_id, enabled, certification,
     configuration, created_at, updated_at, created_by, updated_by)
  VALUES
    ('pvc_openai01', 'openai', 'OpenAI (renamed)', 'platform', NULL, true, 'certified',
     '{}'::JSONB, NOW(), NOW(), 'usr_operator', 'usr_operator')
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at;

  SELECT count(*) INTO v_count FROM cortex.ai_provider_configuration;
  IF v_count <> 1 THEN
    RAISE EXCEPTION '4C-R1: the upsert produced % rows, expected 1', v_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-R2. findConfiguration — `organization_id IS NULL`, not `= NULL`. The
  -- store is careful about this because the platform row is the one the partial
  -- unique index keys on, and `= NULL` would never find it.
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM cortex.ai_provider_configuration
     WHERE scope = 'platform' AND provider_key = 'openai' AND organization_id IS NULL
  ) THEN
    RAISE EXCEPTION '4C-R2: the platform configuration lookup found nothing';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-R3. putActiveCredential — through the RPC, which is the ONLY way the
  -- runtime writes a credential row. `service_role` holds no direct INSERT on
  -- this table, deliberately, so this call failing is the whole feature failing.
  -- -------------------------------------------------------------------------
  PERFORM cortex.ai_provider_credential_activate(
    'pvk_first0001', 'pvc_openai01', 'primary', v_sealed,
    'k_1a2b', 'fp_00000000000000ff', 'cdef', 1, NOW(), NULL, 'usr_operator');

  SELECT status INTO v_status FROM cortex.ai_provider_credential WHERE id = 'pvk_first0001';
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION '4C-R3: the first activation did not produce an active row (%)', v_status;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-R4/R5. The two credential reads the runtime performs: the sealed record
  -- for execution, and the metadata-only projection for the console.
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM cortex.ai_provider_credential
     WHERE configuration_id = 'pvc_openai01' AND status = 'active'
       AND encrypted_secret ->> 'alg' = 'AES-256-GCM'
  ) THEN
    RAISE EXCEPTION '4C-R4: the active-credential read returned no sealed record';
  END IF;

  PERFORM id, configuration_id, credential_name, status, fingerprint, last_four,
          secret_version, key_id, created_at, updated_at, rotated_at, revoked_at,
          created_by, revoked_by
     FROM cortex.ai_provider_credential
    WHERE configuration_id = 'pvc_openai01'
    ORDER BY created_at DESC;

  -- -------------------------------------------------------------------------
  -- 4C-R6. Rotation. The second activation supersedes the first in one
  -- transaction, and the history survives.
  -- -------------------------------------------------------------------------
  PERFORM cortex.ai_provider_credential_activate(
    'pvk_second002', 'pvc_openai01', 'rotated', v_sealed,
    'k_1a2b', 'fp_00000000000000aa', 'wxyz', 2, NOW(), NOW(), 'usr_operator');

  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_credential WHERE configuration_id = 'pvc_openai01';
  IF v_count <> 2 THEN
    RAISE EXCEPTION '4C-R6: rotation must keep the history, found % rows', v_count;
  END IF;

  SELECT status INTO v_status FROM cortex.ai_provider_credential WHERE id = 'pvk_first0001';
  IF v_status IS DISTINCT FROM 'superseded' THEN
    RAISE EXCEPTION '4C-R6: the previous credential is % rather than superseded', v_status;
  END IF;
  SELECT status INTO v_status FROM cortex.ai_provider_credential WHERE id = 'pvk_second002';
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION '4C-R6: the rotated credential is % rather than active', v_status;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-R8. revokeCredential — the one direct UPDATE the runtime makes on this
  -- table. The revocation-completeness constraint means it must carry both the
  -- time and the actor, which is exactly what the store sends.
  -- -------------------------------------------------------------------------
  UPDATE cortex.ai_provider_credential
     SET status = 'revoked', revoked_at = NOW(), revoked_by = 'usr_operator', updated_at = NOW()
   WHERE configuration_id = 'pvc_openai01' AND id = 'pvk_second002';

  SELECT status INTO v_status FROM cortex.ai_provider_credential WHERE id = 'pvk_second002';
  IF v_status IS DISTINCT FROM 'revoked' THEN
    RAISE EXCEPTION '4C-R8: the revocation did not land (%)', v_status;
  END IF;

  -- A revocation without its trail is refused, so an incident review can always
  -- ask "when, and by whom".
  v_failed := false;
  BEGIN
    UPDATE cortex.ai_provider_credential
       SET status = 'revoked', revoked_at = NULL, revoked_by = NULL
     WHERE id = 'pvk_first0001';
  EXCEPTION
    WHEN check_violation THEN
      v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R8: a revocation with no time and no actor was accepted';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-R9. saveModel and listModels — upsert on the composite key the store
  -- names in `onConflict`, then read.
  -- -------------------------------------------------------------------------
  INSERT INTO cortex.ai_provider_model
    (id, configuration_id, model_id, display_name, enabled, certification,
     created_at, updated_at, updated_by)
  VALUES
    ('pvm_gpt4omini', 'pvc_openai01', 'gpt-4o-mini', 'GPT-4o mini', true, 'certified',
     NOW(), NOW(), 'usr_operator')
  ON CONFLICT (configuration_id, model_id) DO UPDATE
    SET display_name = EXCLUDED.display_name, enabled = EXCLUDED.enabled;

  INSERT INTO cortex.ai_provider_model
    (id, configuration_id, model_id, display_name, enabled, certification,
     created_at, updated_at, updated_by)
  VALUES
    ('pvm_gpt4omini', 'pvc_openai01', 'gpt-4o-mini', 'GPT-4o mini (v2)', false, 'certified',
     NOW(), NOW(), 'usr_operator')
  ON CONFLICT (configuration_id, model_id) DO UPDATE
    SET display_name = EXCLUDED.display_name, enabled = EXCLUDED.enabled;

  SELECT count(*) INTO v_count FROM cortex.ai_provider_model WHERE configuration_id = 'pvc_openai01';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '4C-R9: the model upsert produced % rows, expected 1', v_count;
  END IF;

  -- A vendor model id that is not a MARQ identifier is fine; a `pvm_` row id
  -- that is not one is not. The two checks are separate, which is the B-1 fix.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_model
      (id, configuration_id, model_id, display_name, enabled, certification,
       created_at, updated_at, updated_by)
    VALUES
      ('wrong_prefix', 'pvc_openai01', 'gpt-4o', 'GPT-4o', true, 'certified',
       NOW(), NOW(), 'usr_operator');
  EXCEPTION
    WHEN check_violation THEN
      v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R9: a model row id without the pvm_ prefix was accepted';
  END IF;

  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_model
      (id, configuration_id, model_id, display_name, enabled, certification,
       created_at, updated_at, updated_by)
    VALUES
      ('pvm_badmodel1', 'pvc_openai01', '  spaces and $igns  ', 'Bad', true, 'certified',
       NOW(), NOW(), 'usr_operator');
  EXCEPTION
    WHEN check_violation THEN
      v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R9: a malformed vendor model id was accepted';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'assert_4c_runtime_lifecycle: PASSED (service_role drove the full 4C lifecycle)';
END $$;

-- ---------------------------------------------------------------------------
-- 4C-R10. EXACTLY ONE ACTIVE CREDENTIAL, enforced by the database.
--
-- Written as the table OWNER rather than as `service_role`, because the point
-- is the INDEX and not the privilege: `service_role` holds no direct INSERT
-- here by design, so the only way to ask "would the database refuse a second
-- active row" is to try it as somebody who could otherwise write one.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sealed JSONB := '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB;
  v_failed BOOLEAN := false;
BEGIN
  -- Put the configuration back into a one-active state.
  UPDATE cortex.ai_provider_credential
     SET status = 'superseded', revoked_at = NULL, revoked_by = NULL
   WHERE configuration_id = 'pvc_openai01';

  INSERT INTO cortex.ai_provider_credential
    (id, configuration_id, credential_name, encrypted_secret, key_id, fingerprint,
     secret_version, status, created_at, updated_at, created_by)
  VALUES
    ('pvk_live00001', 'pvc_openai01', 'live', v_sealed, 'k_1a2b', 'fp_00000000000000cc',
     1, 'active', NOW(), NOW(), 'usr_operator');

  BEGIN
    INSERT INTO cortex.ai_provider_credential
      (id, configuration_id, credential_name, encrypted_secret, key_id, fingerprint,
       secret_version, status, created_at, updated_at, created_by)
    VALUES
      ('pvk_live00002', 'pvc_openai01', 'second live', v_sealed, 'k_1a2b',
       'fp_00000000000000dd', 1, 'active', NOW(), NOW(), 'usr_operator');
  EXCEPTION
    WHEN unique_violation THEN
      v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION
      '4C-R10: a SECOND active credential was accepted. The runtime would have to guess '
      'which key an operator meant.';
  END IF;

  -- Multiple credential ROWS remain fully supported — that is the rotation
  -- history, and a second SUPERSEDED row must be accepted.
  INSERT INTO cortex.ai_provider_credential
    (id, configuration_id, credential_name, encrypted_secret, key_id, fingerprint,
     secret_version, status, created_at, updated_at, created_by)
  VALUES
    ('pvk_history01', 'pvc_openai01', 'history', v_sealed, 'k_1a2b', 'fp_00000000000000ee',
     1, 'superseded', NOW(), NOW(), 'usr_operator');

  RAISE NOTICE 'assert_4c_runtime_lifecycle: PASSED (one active credential, many rows)';
END $$;

-- ---------------------------------------------------------------------------
-- 4C-R11. PLAINTEXT-SHAPED STORAGE IS REJECTED.
--
-- The sealed-shape constraint is the database's own refusal to hold anything
-- that is not an AES-256-GCM record. It is the backstop for the case the whole
-- batch exists to prevent: a code path that writes a credential without
-- sealing it. Every rejection below is a shape somebody could plausibly write.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_shape   JSONB;
  v_label   TEXT;
  v_failed  BOOLEAN;
BEGIN
  FOR v_label, v_shape IN
    SELECT * FROM (VALUES
      ('a bare plaintext key',        '{"secret":"sk-live-0123456789abcdef"}'::JSONB),
      ('a plaintext field beside it', '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","secret":"sk-live-x"}'::JSONB),
      ('base64, not encryption',      '{"v":1,"alg":"base64","kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB),
      ('no algorithm at all',         '{"v":1,"kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB),
      ('no ciphertext',               '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXY="}'::JSONB),
      ('no initialisation vector',    '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","ct":"Y3Q="}'::JSONB),
      ('no key identity',             '{"v":1,"alg":"AES-256-GCM","iv":"aXY=","ct":"Y3Q="}'::JSONB),
      ('a JSON string, not a record', '"sk-live-0123456789abcdef"'::JSONB),
      ('a JSON array',                '["sk-live-0123456789abcdef"]'::JSONB)
    ) AS shapes(label, shape)
  LOOP
    v_failed := false;
    BEGIN
      INSERT INTO cortex.ai_provider_credential
        (id, configuration_id, credential_name, encrypted_secret, key_id, fingerprint,
         secret_version, status, created_at, updated_at, created_by)
      VALUES
        ('pvk_plain0001', 'pvc_openai01', 'plaintext attempt', v_shape, 'k_1a2b',
         'fp_00000000000000ff', 1, 'superseded', NOW(), NOW(), 'usr_operator');
    EXCEPTION
      WHEN check_violation THEN
        v_failed := true;
    END;
    IF NOT v_failed THEN
      DELETE FROM cortex.ai_provider_credential WHERE id = 'pvk_plain0001';
      RAISE EXCEPTION '4C-R11: the database accepted % as a sealed credential record', v_label;
    END IF;
  END LOOP;

  -- The key identity and fingerprint columns are shaped too, so a caller cannot
  -- store a raw key where an identifier belongs.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_credential
      (id, configuration_id, credential_name, encrypted_secret, key_id, fingerprint,
       secret_version, status, created_at, updated_at, created_by)
    VALUES
      ('pvk_badkeyid1', 'pvc_openai01', 'raw key as identity',
       '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB,
       'sk-live-0123456789abcdef', 'fp_00000000000000ff', 1, 'superseded',
       NOW(), NOW(), 'usr_operator');
  EXCEPTION
    WHEN check_violation THEN
      v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R11: a raw key was accepted in the key_id column';
  END IF;

  -- `last_four` is at most four characters, so a caller cannot smuggle a longer
  -- prefix of the secret into a column designed to be a rounding error.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_credential
      (id, configuration_id, credential_name, encrypted_secret, key_id, fingerprint,
       last_four, secret_version, status, created_at, updated_at, created_by)
    VALUES
      ('pvk_longtail1', 'pvc_openai01', 'long tail',
       '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB,
       'k_1a2b', 'fp_00000000000000ff', '0123456789abcdef', 1, 'superseded',
       NOW(), NOW(), 'usr_operator');
  EXCEPTION
    WHEN check_violation THEN
      v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R11: a sixteen-character last_four was accepted';
  END IF;

  RAISE NOTICE 'assert_4c_runtime_lifecycle: PASSED (plaintext-shaped storage refused)';
END $$;

-- ---------------------------------------------------------------------------
-- 4C-R12. SCOPE CONSTRAINTS.
--
-- `scope` and `organization_id` must agree structurally, so no query has to
-- guess which kind of row it is holding — and the two partial unique indexes
-- must key on the right things, because Batch 4D's customer BYOK rows land in
-- the same table beside the platform's own.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org    UUID;
  v_org2   UUID;
  v_failed BOOLEAN;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;

  -- A platform row naming a tenant is refused.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_badplat01', 'anthropic', 'Bad', 'platform', v_org, 'usr_x', 'usr_x');
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R12: a platform-scoped row naming an organization was accepted';
  END IF;

  -- An organization row with no tenant is refused.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_badorg001', 'anthropic', 'Bad', 'organization', NULL, 'usr_x', 'usr_x');
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R12: an organization-scoped row with no organization was accepted';
  END IF;

  -- A scope outside the vocabulary is refused.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_badscope1', 'anthropic', 'Bad', 'global', NULL, 'usr_x', 'usr_x');
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R12: a scope outside (platform, organization) was accepted';
  END IF;

  -- A SECOND platform row for the same provider is refused by the partial
  -- unique index — one platform configuration per provider, structurally.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_dupopenai', 'openai', 'OpenAI again', 'platform', NULL, 'usr_x', 'usr_x');
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R12: a second platform configuration for openai was accepted';
  END IF;

  -- The SAME provider key remains available to an organization row, which is
  -- what keeps Batch 4D from having to reshape a table holding production
  -- credentials.
  INSERT INTO cortex.ai_provider_configuration
    (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
  VALUES ('pvc_tenant001', 'openai', 'Tenant OpenAI', 'organization', v_org, 'usr_x', 'usr_x');

  -- …but only once per tenant.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_tenant002', 'openai', 'Tenant OpenAI again', 'organization', v_org,
            'usr_x', 'usr_x');
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R12: a second organization configuration for the same tenant was accepted';
  END IF;

  -- A provider key the registry could never produce is refused by shape.
  v_failed := false;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, created_by, updated_by)
    VALUES ('pvc_badkey001', 'Open AI!', 'Bad', 'platform', NULL, 'usr_x', 'usr_x');
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4C-R12: a malformed provider key was accepted';
  END IF;

  -- Cleanup, so the rollback assertion counts rows it can attribute.
  DELETE FROM cortex.ai_provider_configuration WHERE id = 'pvc_tenant001';

  RAISE NOTICE 'assert_4c_runtime_lifecycle: PASSED (platform and organization scope)';
END $$;
