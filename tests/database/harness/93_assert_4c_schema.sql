-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4C: the schema the migration actually produced
--
-- Runs immediately after 20260828120000_ai_provider_administration.sql.
--
-- Everything here is a question the previous 4C migration test could not ask.
-- That test read the file as TEXT and asserted on its shape, which is why it
-- reported the migration healthy while the file contained two CHECK constraints
-- with one name and PostgreSQL rejected it outright. A text scan can prove a
-- file does not CONTAIN something. Only a database can prove a file APPLIES.
--
--   4C-S1  the three tables exist, in `cortex`, with the columns the runtime
--          reads and writes by name
--   4C-S2  the constraints exist, under DISTINCT names — the B-1 regression
--   4C-S3  the indexes exist, including the two partial ones the domain model
--          depends on
--   4C-S4  the activation function exists, with the exact signature the store
--          calls and the SECURITY DEFINER property it relies on
--   4C-S5  row level security is ENABLED and FORCED on all three, with no
--          policy on any of them
--   4C-S6  no column anywhere in the three tables is shaped to hold plaintext
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count   INTEGER;
  v_name    TEXT;
  v_missing TEXT;
BEGIN
  -- -------------------------------------------------------------------------
  -- 4C-S1. The tables, and the columns the store names in its projections.
  -- -------------------------------------------------------------------------
  FOREACH v_name IN ARRAY ARRAY[
    'ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'cortex' AND c.relname = v_name AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION '4C-S1: cortex.% was not created', v_name;
    END IF;
  END LOOP;

  -- The exact column names `aiProviderAdministrationStore.ts` writes. A rename
  -- in either place breaks the runtime and nothing else would catch it: the
  -- store speaks to PostgREST by string, so the compiler has no opinion.
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'id', 'provider_key', 'display_name', 'scope', 'organization_id', 'enabled',
      'certification', 'configuration', 'created_at', 'updated_at', 'created_by', 'updated_by'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'cortex' AND table_name = 'ai_provider_configuration'
        AND column_name = expected
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '4C-S1: ai_provider_configuration is missing columns: %', v_missing;
  END IF;

  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'id', 'configuration_id', 'credential_name', 'encrypted_secret', 'key_id',
      'fingerprint', 'last_four', 'secret_version', 'status', 'created_at', 'updated_at',
      'rotated_at', 'revoked_at', 'created_by', 'revoked_by'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'cortex' AND table_name = 'ai_provider_credential'
        AND column_name = expected
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '4C-S1: ai_provider_credential is missing columns: %', v_missing;
  END IF;

  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'id', 'configuration_id', 'model_id', 'display_name', 'enabled', 'certification',
      'created_at', 'updated_at', 'updated_by'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'cortex' AND table_name = 'ai_provider_model'
        AND column_name = expected
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '4C-S1: ai_provider_model is missing columns: %', v_missing;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-S2. Every named constraint, present and DISTINCT.
  --
  -- The B-1 defect was two CHECK constraints called `ai_provider_model_id_format`
  -- on one table — the row's `pvm_` identifier and the VENDOR's model id. The
  -- names below are enumerated so that collapsing two guards into one name is a
  -- test failure rather than a migration that silently stops applying.
  -- -------------------------------------------------------------------------
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'ai_provider_configuration_id_format',
      'ai_provider_configuration_key_format',
      'ai_provider_configuration_display_name_length',
      'ai_provider_configuration_scope',
      'ai_provider_configuration_certification',
      'ai_provider_configuration_is_object',
      'ai_provider_configuration_scope_tenancy',
      'ai_provider_credential_id_format',
      'ai_provider_credential_name_length',
      'ai_provider_credential_sealed_shape',
      'ai_provider_credential_key_id_format',
      'ai_provider_credential_fingerprint_format',
      'ai_provider_credential_last_four_length',
      'ai_provider_credential_version_positive',
      'ai_provider_credential_status',
      'ai_provider_credential_revocation_complete',
      'ai_provider_model_id_format',
      'ai_provider_model_model_id_format',
      'ai_provider_model_display_name_length',
      'ai_provider_model_certification',
      'ai_provider_model_unique'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'cortex' AND con.conname = expected
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '4C-S2: missing constraints: %', v_missing;
  END IF;

  -- Two CHECKs on ai_provider_model, guarding two different columns. Before the
  -- fix there was one name for both and the migration did not apply at all.
  SELECT count(*) INTO v_count
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'cortex' AND c.relname = 'ai_provider_model'
     AND con.contype = 'c'
     AND con.conname IN ('ai_provider_model_id_format', 'ai_provider_model_model_id_format');
  IF v_count <> 2 THEN
    RAISE EXCEPTION
      '4C-S2: ai_provider_model must carry TWO distinctly named format checks, found %', v_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-S3. The indexes, including the two the domain model leans on.
  -- -------------------------------------------------------------------------
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'ai_provider_configuration_platform_key',
      'ai_provider_configuration_organization_key',
      'ai_provider_configuration_scope_idx',
      'ai_provider_credential_one_active',
      'ai_provider_credential_configuration_idx',
      'ai_provider_credential_key_id_idx',
      'ai_provider_model_configuration_idx'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_indexes WHERE schemaname = 'cortex' AND indexname = expected
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '4C-S3: missing indexes: %', v_missing;
  END IF;

  -- Partial and unique, both of them, or the guarantees they carry are not the
  -- guarantees the runtime was written against.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'cortex' AND indexname = 'ai_provider_credential_one_active'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%status%active%'
  ) THEN
    RAISE EXCEPTION '4C-S3: the one-active-credential index is not a partial unique index';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'cortex' AND indexname = 'ai_provider_configuration_platform_key'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%platform%'
  ) THEN
    RAISE EXCEPTION '4C-S3: the platform configuration index is not a partial unique index';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-S4. The activation function, by exact signature.
  --
  -- The store calls this by name with eleven named parameters. A signature that
  -- drifted would fail at runtime with PostgREST's "could not find the function"
  -- and nowhere earlier.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'cortex'
     AND p.proname = 'ai_provider_credential_activate'
     -- Argument TYPES, in order, without the parameter names — the names are
     -- asserted separately below because PostgREST binds by name while
     -- PostgreSQL resolves by type, and both have to be right.
     AND array_to_string(
           ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) AS t), ', ') =
         'text, text, text, jsonb, text, text, text, integer, timestamp with time zone, '
         || 'timestamp with time zone, text';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      '4C-S4: expected exactly one cortex.ai_provider_credential_activate with the '
      'runtime signature, found %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'cortex' AND p.proname = 'ai_provider_credential_activate'
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION '4C-S4: the activation function is not SECURITY DEFINER';
  END IF;

  -- The parameter names the store passes. PostgREST binds by NAME, so a renamed
  -- parameter is a runtime failure with a healthy-looking function.
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'p_credential_id', 'p_configuration_id', 'p_credential_name', 'p_encrypted_secret',
      'p_key_id', 'p_fingerprint', 'p_last_four', 'p_secret_version', 'p_created_at',
      'p_rotated_at', 'p_created_by'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'cortex' AND p.proname = 'ai_provider_credential_activate'
        AND expected = ANY (p.proargnames)
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '4C-S4: the activation function is missing parameters: %', v_missing;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-S5. RLS enabled, RLS forced, and no policy anywhere.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'cortex'
     AND c.relname IN ('ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model')
     AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      '4C-S5: expected RLS enabled AND forced on all three tables, got % of 3', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'cortex'
     AND tablename IN ('ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model');
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      '4C-S5: the three tables must carry NO policy — the absence is the control. Found %',
      v_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4C-S6. No column shaped to hold a plaintext credential.
  --
  -- The sealed record is JSONB and is constrained to the sealed shape (proved
  -- behaviourally in 94). What is asserted here is that no SECOND home for a
  -- secret was added beside it: no column whose name suggests one exists on any
  -- of the three tables.
  -- -------------------------------------------------------------------------
  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v_missing
    FROM information_schema.columns
   WHERE table_schema = 'cortex'
     AND table_name IN
         ('ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model')
     AND column_name ~ '(^|_)(secret|api_key|apikey|token|password|plaintext|key|credential)($|_)'
     -- The allowlist, enumerated so that adding a column has to pass through
     -- this file. Each of these is a NON-SECRET by construction:
     --   encrypted_secret  the sealed AES-256-GCM record; no plaintext, and its
     --                     shape is constrained (proved behaviourally in 94)
     --   secret_version    an integer counter
     --   key_id            the root key's IDENTITY — a truncated keyed digest
     --   credential_name   an operator's label for the credential
     --   provider_key      the ADAPTER's id — 'openai', 'anthropic'
     AND column_name NOT IN
         ('encrypted_secret', 'secret_version', 'key_id', 'credential_name', 'provider_key');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '4C-S6: columns shaped to hold plaintext credentials exist: %', v_missing;
  END IF;

  RAISE NOTICE 'assert_4c_schema: PASSED (tables, constraints, indexes, RPC, RLS)';
END $$;
