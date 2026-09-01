-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4D: the rollback removed 4D, and NOTHING ELSE
--
-- Runs after rollbacks/20260901120000_rollback_ai_customer_byok.sql, on the
-- database the 4D assertions have already written customer rows into.
--
-- TWO CLAIMS, AND THE SECOND ONE IS THE UNUSUAL ONE.
--
--   4D-B1..B4  Every 4D object is gone: the column, both constraints, the
--              trigger, the trigger function, the index.
--
--   4D-B5..B7  Batch 4C is INTACT — all three tables, its constraints, its
--              indexes, its activation function, its RLS posture and its
--              privilege matrix. Reversing 4D must not reverse 4C.
--
--   4D-B8      THE CUSTOMER ROWS SURVIVED.
--
-- That last one asserts something a rollback is not usually expected to do, so
-- it is worth being explicit about why it is the right behaviour rather than an
-- oversight in the rollback file.
--
-- Batch 4D created no table. It added a column, two constraints, a trigger and
-- an index to tables Batch 4C already owns. A rollback that ALSO deleted
-- organization-scoped rows would be deleting data the 4C schema is perfectly
-- capable of holding — and it would destroy secret material that is NOT
-- RECOVERABLE, because a stored credential is write-only by design. Every
-- affected customer would have to re-enter their key from their vendor's
-- console. Nobody should have to take that consequence to reverse a schema
-- change.
--
-- With 4D's CODE rolled back, those rows are inert: the credential resolver
-- reads only platform-scoped rows, so an organization row is never read, never
-- resolved and never executed on. Every tenant returns to the Batch 4C
-- resolution. Re-applying 4D brings the same rows back into service unchanged,
-- and this file proves the rows are still there to be brought back.
--
--   4D-B9      The 4C table comments were restored, so the schema's own
--              documentation does not describe a batch that is no longer
--              applied.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count    INTEGER;
  v_text     TEXT;
  v_name     TEXT;
  v_problems TEXT := '';
BEGIN
  -- -------------------------------------------------------------------------
  -- 4D-B1. The column is gone.
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'cortex' AND table_name = 'ai_provider_configuration'
       AND column_name = 'credential_fallback'
  ) THEN
    RAISE EXCEPTION '4D-B1: credential_fallback survived the rollback';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-B2. Both constraints are gone.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM pg_constraint
   WHERE conname IN (
     'ai_provider_configuration_credential_fallback',
     'ai_provider_configuration_platform_fallback'
   );
  IF v_count <> 0 THEN
    RAISE EXCEPTION '4D-B2: % 4D fallback constraint(s) survived the rollback', v_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-B3. The trigger AND its function are gone.
  --
  -- Both, because dropping only the trigger leaves an orphan function that the
  -- next `CREATE OR REPLACE` would silently reuse — including its body, which
  -- is what a re-apply is supposed to install fresh.
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'cortex'
       AND c.relname = 'ai_provider_configuration'
       AND t.tgname = 'ai_provider_configuration_tenancy_immutable'
  ) THEN
    RAISE EXCEPTION '4D-B3: the tenancy-immutability trigger survived the rollback';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'cortex'
       AND p.proname = 'ai_provider_configuration_tenancy_is_immutable'
  ) THEN
    RAISE EXCEPTION '4D-B3: the tenancy trigger function survived the rollback';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-B4. The index is gone.
  -- -------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'cortex'
       AND indexname = 'ai_provider_configuration_organization_idx'
  ) THEN
    RAISE EXCEPTION '4D-B4: the 4D tenant index survived the rollback';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-B5. Batch 4C's tables are all still here.
  -- -------------------------------------------------------------------------
  FOREACH v_name IN ARRAY ARRAY[
    'ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'cortex' AND c.relname = v_name AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION
        '4D-B5: reversing Batch 4D removed cortex.%, which belongs to Batch 4C', v_name;
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 4D-B6. Batch 4C's constraints, indexes and function are all still here.
  -- -------------------------------------------------------------------------
  SELECT string_agg(expected, ', ') INTO v_text
    FROM unnest(ARRAY[
      'ai_provider_configuration_scope',
      'ai_provider_configuration_scope_tenancy',
      'ai_provider_configuration_id_format',
      'ai_provider_credential_sealed_shape',
      'ai_provider_credential_revocation_complete',
      'ai_provider_credential_status',
      'ai_provider_credential_key_id_format',
      'ai_provider_credential_fingerprint_format'
    ]) AS expected
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected);
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION '4D-B6: reversing 4D removed Batch 4C constraints: %', v_text;
  END IF;

  SELECT string_agg(expected, ', ') INTO v_text
    FROM unnest(ARRAY[
      'ai_provider_configuration_platform_key',
      'ai_provider_configuration_organization_key',
      'ai_provider_configuration_scope_idx',
      'ai_provider_credential_one_active',
      'ai_provider_credential_configuration_idx',
      'ai_provider_model_configuration_idx'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_indexes WHERE schemaname = 'cortex' AND indexname = expected
   );
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION '4D-B6: reversing 4D removed Batch 4C indexes: %', v_text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'cortex'
       AND p.proname = 'ai_provider_credential_activate'
       AND p.prosecdef = TRUE
  ) THEN
    RAISE EXCEPTION
      '4D-B6: reversing 4D removed the Batch 4C activation function, or its SECURITY DEFINER';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-B7. The RLS posture and the privilege matrix are Batch 4C's again.
  -- -------------------------------------------------------------------------
  FOREACH v_name IN ARRAY ARRAY[
    'ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model'
  ] LOOP
    SELECT count(*) INTO v_count
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'cortex' AND c.relname = v_name
       AND c.relrowsecurity = TRUE AND c.relforcerowsecurity = TRUE;
    IF v_count <> 1 THEN
      RAISE EXCEPTION '4D-B7: RLS is no longer both ENABLED and FORCED on cortex.%', v_name;
    END IF;

    SELECT count(*) INTO v_count
      FROM pg_policies WHERE schemaname = 'cortex' AND tablename = v_name;
    IF v_count <> 0 THEN
      RAISE EXCEPTION '4D-B7: cortex.% acquired a policy', v_name;
    END IF;

    IF has_table_privilege('authenticated', 'cortex.' || v_name, 'SELECT')
       OR has_table_privilege('anon', 'cortex.' || v_name, 'SELECT') THEN
      RAISE EXCEPTION '4D-B7: a browser role can read cortex.% after the rollback', v_name;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('service_role', 'cortex.ai_provider_configuration', 'SELECT')
     OR has_table_privilege('service_role', 'cortex.ai_provider_credential', 'INSERT')
     OR has_table_privilege('service_role', 'cortex.ai_provider_credential', 'DELETE') THEN
    RAISE EXCEPTION '4D-B7: the service_role privilege matrix changed under the 4D rollback';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-B8. THE CUSTOMER ROWS SURVIVED. See the header for why this is right.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_configuration WHERE scope = 'organization';
  IF v_count < 2 THEN
    RAISE EXCEPTION
      '4D-B8: the rollback destroyed customer configurations (% left, expected at least 2). '
      'A stored credential is write-only and unrecoverable; reversing a schema change must '
      'not force every affected customer to re-enter their key.', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_credential c
    JOIN cortex.ai_provider_configuration p ON p.id = c.configuration_id
   WHERE p.scope = 'organization';
  IF v_count < 2 THEN
    RAISE EXCEPTION
      '4D-B8: the rollback destroyed customer credentials (% left, expected at least 2)',
      v_count;
  END IF;

  -- And the platform's own row is untouched beside them.
  SELECT count(*) INTO v_count
    FROM cortex.ai_provider_configuration WHERE scope = 'platform';
  IF v_count < 1 THEN
    RAISE EXCEPTION '4D-B8: the rollback destroyed the platform configuration';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-B9. The 4C table comments were restored.
  -- -------------------------------------------------------------------------
  SELECT obj_description('cortex.ai_provider_credential'::REGCLASS, 'pg_class') INTO v_text;
  IF v_text IS NULL OR v_text NOT LIKE '%Batch 4C.%' OR v_text LIKE '%4C/4D%' THEN
    RAISE EXCEPTION
      '4D-B9: the credential table still carries its Batch 4D comment after the rollback. '
      'The schema''s own documentation describes a batch that is no longer applied.';
  END IF;

  RAISE NOTICE
    'assert_4d_rollback: PASSED (4D removed cleanly, Batch 4C intact, customer rows '
    'preserved and inert, comments restored)';
END;
$$;
