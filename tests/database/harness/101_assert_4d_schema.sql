-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4D: the schema the migration actually produced
--
-- Runs immediately after 20260901120000_ai_customer_byok.sql.
--
-- Everything here is a question a text scan of the migration cannot ask. Batch
-- 4C shipped with a text-scanning test and nothing else, and that test reported
-- the migration healthy while it contained two CHECK constraints with one name
-- — which PostgreSQL rejects outright — and while it granted `service_role`
-- nothing at all. A text scan proves ABSENCE well and BEHAVIOUR not at all.
--
--   4D-S1  the fallback column exists, with the right type and default
--   4D-S2  both fallback constraints exist, under DISTINCT names
--   4D-S3  the fallback CHECK actually refuses an unknown value
--   4D-S4  a platform row cannot carry a tenant fallback policy
--   4D-S5  the tenancy-immutability trigger exists, BEFORE UPDATE, FOR EACH ROW
--   4D-S6  the tenant enumeration index exists and is partial
--   4D-S7  Batch 4C's own objects all survived — tables, constraints, the two
--          partial unique indexes, the one-active index, the activation function
--   4D-S8  RLS is still ENABLED and FORCED on all three tables, with NO POLICY
--          on any of them. This is the control Batch 4D must not have relaxed
--          to let a customer read their own rows.
--   4D-S9  no column anywhere in the three tables is shaped to hold plaintext
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count   INTEGER;
  v_text    TEXT;
  v_name    TEXT;
  v_failed  BOOLEAN;
  v_org     UUID;
BEGIN
  -- -------------------------------------------------------------------------
  -- 4D-S1. The column.
  -- -------------------------------------------------------------------------
  SELECT data_type, column_default, is_nullable
    INTO v_text, v_name, v_failed
    FROM information_schema.columns
   WHERE table_schema = 'cortex'
     AND table_name = 'ai_provider_configuration'
     AND column_name = 'credential_fallback';
  IF v_text IS NULL THEN
    RAISE EXCEPTION '4D-S1: cortex.ai_provider_configuration.credential_fallback is missing';
  END IF;
  IF v_text <> 'text' THEN
    RAISE EXCEPTION '4D-S1: credential_fallback is %, expected text', v_text;
  END IF;
  IF v_name IS NULL OR v_name NOT LIKE '%platform%' THEN
    -- The default is what makes this migration a no-op for every existing row.
    -- Without it, applying 4D would have to backfill, and a backfill that
    -- missed a row would leave a NOT NULL column with no value.
    RAISE EXCEPTION
      '4D-S1: credential_fallback default is %, expected ''platform''', coalesce(v_name, 'NULL');
  END IF;

  SELECT is_nullable = 'NO'
    INTO v_failed
    FROM information_schema.columns
   WHERE table_schema = 'cortex' AND table_name = 'ai_provider_configuration'
     AND column_name = 'credential_fallback';
  IF NOT v_failed THEN
    RAISE EXCEPTION '4D-S1: credential_fallback is nullable; a NULL policy has no meaning';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-S2. Both constraints, under DISTINCT names.
  --
  -- PostgreSQL identifies constraints by (table, name), so two sharing a name
  -- makes the migration unapplicable anywhere. That is not hypothetical: it is
  -- the exact defect an independent production gate found in Batch 4C.
  -- -------------------------------------------------------------------------
  SELECT count(DISTINCT conname) INTO v_count
    FROM pg_constraint
   WHERE conrelid = 'cortex.ai_provider_configuration'::REGCLASS
     AND conname IN (
       'ai_provider_configuration_credential_fallback',
       'ai_provider_configuration_platform_fallback'
     );
  IF v_count <> 2 THEN
    RAISE EXCEPTION
      '4D-S2: expected two distinctly named fallback constraints, found %', v_count;
  END IF;

  SELECT id INTO v_org FROM public.organizations WHERE slug = 'acme' AND deleted_at IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION '4D-S2: the 4D tenant fixture did not run; later assertions would be vacuous';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-S3. The fallback CHECK refuses an unknown value.
  --
  -- Asked by ATTEMPTING it, not by reading `pg_constraint.consrc`. A constraint
  -- that exists and permits everything is a constraint that reads correctly and
  -- does nothing.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, credential_fallback,
       created_by, updated_by)
    VALUES ('pvc_4dS3', 'openai', 'OpenAI', 'organization', v_org, 'whatever_i_like',
            'harness', 'harness');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4D-S3: an unknown credential_fallback value was accepted';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-S4. A platform row cannot carry a tenant fallback policy.
  -- -------------------------------------------------------------------------
  v_failed := FALSE;
  BEGIN
    INSERT INTO cortex.ai_provider_configuration
      (id, provider_key, display_name, scope, organization_id, credential_fallback,
       created_by, updated_by)
    VALUES ('pvc_4dS4', 'anthropic', 'Anthropic', 'platform', NULL, 'tenant_only',
            'harness', 'harness');
  EXCEPTION WHEN check_violation THEN
    v_failed := TRUE;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '4D-S4: a platform-scoped row accepted a tenant fallback policy';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-S5. The immutability trigger, with the timing the guarantee depends on.
  --
  -- BEFORE UPDATE and FOR EACH ROW. An AFTER trigger would raise after the row
  -- had already been written and the statement would still roll back — correct,
  -- but it would also have fired every other AFTER trigger and taken every
  -- write-ahead cost of a change that was never legal. A STATEMENT-level
  -- trigger has no OLD/NEW at all and could not make the comparison.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'cortex'
     AND c.relname = 'ai_provider_configuration'
     AND t.tgname = 'ai_provider_configuration_tenancy_immutable'
     AND NOT t.tgisinternal
     -- tgtype bit 0 = ROW, bit 1 = BEFORE, bit 4 = UPDATE
     AND (t.tgtype & 1) = 1
     AND (t.tgtype & 2) = 2
     AND (t.tgtype & 16) = 16;
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      '4D-S5: the tenancy-immutability trigger is missing, or is not BEFORE UPDATE FOR EACH ROW';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'cortex'
       AND p.proname = 'ai_provider_configuration_tenancy_is_immutable'
       -- SECURITY INVOKER, deliberately: it reads OLD and NEW and raises, so it
       -- needs no privilege of its own. DEFINER would hand it the owner's
       -- rights for no operation it performs.
       AND p.prosecdef = FALSE
  ) THEN
    RAISE EXCEPTION
      '4D-S5: the trigger function is missing, or is SECURITY DEFINER when it should not be';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-S6. The tenant enumeration index, and it is PARTIAL.
  --
  -- Partial because the customer console's question is "every provider THIS
  -- organization has configured", and platform rows carry a NULL tenant. A
  -- full index would carry every platform row for no query.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM pg_indexes
   WHERE schemaname = 'cortex'
     AND tablename = 'ai_provider_configuration'
     AND indexname = 'ai_provider_configuration_organization_idx'
     AND indexdef ILIKE '%WHERE%scope%organization%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '4D-S6: the partial tenant enumeration index is missing';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-S7. BATCH 4C SURVIVED. Every object 4D depends on and must not disturb.
  -- -------------------------------------------------------------------------
  FOREACH v_name IN ARRAY ARRAY[
    'ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'cortex' AND c.relname = v_name AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION '4D-S7: cortex.% no longer exists', v_name;
    END IF;
  END LOOP;

  SELECT string_agg(expected, ', ') INTO v_text
    FROM unnest(ARRAY[
      'ai_provider_configuration_platform_key',
      'ai_provider_configuration_organization_key',
      'ai_provider_credential_one_active'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_indexes
      WHERE schemaname = 'cortex' AND indexname = expected
   );
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION '4D-S7: Batch 4C indexes are missing after 4D: %', v_text;
  END IF;

  SELECT string_agg(expected, ', ') INTO v_text
    FROM unnest(ARRAY[
      'ai_provider_configuration_scope',
      'ai_provider_configuration_scope_tenancy',
      'ai_provider_credential_sealed_shape',
      'ai_provider_credential_revocation_complete',
      'ai_provider_credential_status'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint WHERE conname = expected
   );
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION '4D-S7: Batch 4C constraints are missing after 4D: %', v_text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'cortex'
       AND p.proname = 'ai_provider_credential_activate'
       AND p.prosecdef = TRUE
  ) THEN
    RAISE EXCEPTION
      '4D-S7: the Batch 4C activation function is missing or is no longer SECURITY DEFINER';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4D-S8. RLS: ENABLED, FORCED, and STILL NO POLICY.
  --
  -- THE ONE CONTROL BATCH 4D WAS MOST LIKELY TO RELAX. "A customer needs to
  -- read their own rows" is exactly the sentence that ends with a policy
  -- admitting `authenticated` to a table holding credential ciphertext. The
  -- customer reads their rows through the governed BYOK API, behind a
  -- capability check and an audit record, served by the service role.
  -- -------------------------------------------------------------------------
  FOREACH v_name IN ARRAY ARRAY[
    'ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model'
  ] LOOP
    SELECT count(*) INTO v_count
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'cortex' AND c.relname = v_name
       AND c.relrowsecurity = TRUE AND c.relforcerowsecurity = TRUE;
    IF v_count <> 1 THEN
      RAISE EXCEPTION '4D-S8: RLS is not both ENABLED and FORCED on cortex.%', v_name;
    END IF;

    SELECT count(*) INTO v_count
      FROM pg_policies WHERE schemaname = 'cortex' AND tablename = v_name;
    IF v_count <> 0 THEN
      RAISE EXCEPTION
        '4D-S8: cortex.% has % policy/policies. Service role only is the access control; '
        'a policy here puts credential ciphertext within reach of a browser session token.',
        v_name, v_count;
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 4D-S9. No column anywhere is shaped to hold plaintext.
  --
  -- Batch 4D added a column to a table holding credential material, which is
  -- the moment a `secret`, `api_key` or `plaintext` column gets added beside
  -- it "just for the customer's reference".
  -- -------------------------------------------------------------------------
  -- The SAME predicate and the SAME allowlist as the Batch 4C assertion, on
  -- purpose. A 4D-shaped paraphrase would be a second definition of "shaped to
  -- hold plaintext" that could drift from the first, and the allowlist is where
  -- the thinking is: each entry is a non-secret by construction, and adding a
  -- column to these tables has to pass through it.
  --
  --   encrypted_secret     the sealed AES-256-GCM record; no plaintext
  --   secret_version       an integer counter
  --   key_id               the root key's IDENTITY — a truncated keyed digest
  --   credential_name      an operator's label
  --   provider_key         the ADAPTER's id — 'openai', 'anthropic'
  --   credential_fallback  Batch 4D's own addition: a two-valued policy enum,
  --                        constrained by CHECK to 'platform' or 'tenant_only'
  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v_text
    FROM information_schema.columns
   WHERE table_schema = 'cortex'
     AND table_name IN
         ('ai_provider_configuration', 'ai_provider_credential', 'ai_provider_model')
     AND column_name ~ '(^|_)(secret|api_key|apikey|token|password|plaintext|key|credential)($|_)'
     AND column_name NOT IN
         ('encrypted_secret', 'secret_version', 'key_id', 'credential_name', 'provider_key',
          'credential_fallback');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION '4D-S9: a plaintext-shaped column exists: %', v_text;
  END IF;

  RAISE NOTICE
    'assert_4d_schema: PASSED (fallback column and constraints, immutability trigger, '
    'tenant index, Batch 4C intact, RLS forced with no policy, no plaintext column)';
END;
$$;
