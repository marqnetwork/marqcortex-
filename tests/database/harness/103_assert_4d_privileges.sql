-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4D: the privilege posture is UNCHANGED
--
-- Runs after 20260901120000_ai_customer_byok.sql, on a database whose objects
-- are owned by a NOSUPERUSER role.
--
-- WHY THIS FILE EXISTS WHEN 95_assert_4c_privileges.sql ALREADY PASSES.
--
-- It passes BEFORE 4D is applied. The question here is whether admitting
-- customer-owned rows into these tables changed who may touch them — and the
-- pressure to change it is real and specific: "a customer needs to read their
-- own credential status" is the sentence that ends with a SELECT grant to
-- `authenticated` and an RLS policy scoped by `organization_id`. It would work.
-- It would also put credential ciphertext one policy mistake away from a
-- browser session token, to serve a read the BYOK API already serves behind a
-- capability check, a tenant resolution and an audit record.
--
-- So Batch 4D grants NOTHING new to ANY role, and this asserts it as a full
-- matrix rather than as a spot check.
--
--   4D-P1  the complete privilege matrix, for all three roles and all three
--          tables — identical to the Batch 4C matrix
--   4D-P2  `anon` and `authenticated` cannot read a customer's configuration
--          or credential, by catalogue AND by attempt
--   4D-P3  `anon` and `authenticated` cannot EXECUTE the 4D trigger function
--   4D-P4  the trigger fires for `service_role` — a control that a privileged
--          writer can step around is not a control
--   4D-P5  the 4D column carries no column-level grant to a browser role
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_role      TEXT;
  v_table     TEXT;
  v_privilege TEXT;
  v_expected  BOOLEAN;
  v_actual    BOOLEAN;
  v_problems  TEXT := '';
BEGIN
  -- -------------------------------------------------------------------------
  -- 4D-P1. The exact matrix, after 4D. Enumerated in full so a grant nobody
  -- intended fails here as loudly as one that is missing.
  -- -------------------------------------------------------------------------
  FOR v_role, v_table, v_privilege, v_expected IN
    SELECT * FROM (VALUES
      ('service_role', 'ai_provider_configuration', 'SELECT',     true),
      ('service_role', 'ai_provider_configuration', 'INSERT',     true),
      ('service_role', 'ai_provider_configuration', 'UPDATE',     true),
      ('service_role', 'ai_provider_configuration', 'DELETE',     false),
      ('service_role', 'ai_provider_configuration', 'TRUNCATE',   false),
      ('service_role', 'ai_provider_configuration', 'REFERENCES', false),
      ('service_role', 'ai_provider_configuration', 'TRIGGER',    false),

      -- STILL no INSERT on the credential table, for the customer estate as
      -- much as for MARQ's: the only insert is inside the SECURITY DEFINER
      -- activation function, so the supersede and the insert cannot be issued
      -- apart and a customer's rotation cannot leave them with zero keys.
      ('service_role', 'ai_provider_credential',    'SELECT',     true),
      ('service_role', 'ai_provider_credential',    'INSERT',     false),
      ('service_role', 'ai_provider_credential',    'UPDATE',     true),
      ('service_role', 'ai_provider_credential',    'DELETE',     false),
      ('service_role', 'ai_provider_credential',    'TRUNCATE',   false),
      ('service_role', 'ai_provider_credential',    'REFERENCES', false),
      ('service_role', 'ai_provider_credential',    'TRIGGER',    false),

      ('service_role', 'ai_provider_model',         'SELECT',     true),
      ('service_role', 'ai_provider_model',         'INSERT',     true),
      ('service_role', 'ai_provider_model',         'UPDATE',     true),
      ('service_role', 'ai_provider_model',         'DELETE',     false),
      ('service_role', 'ai_provider_model',         'TRUNCATE',   false),
      ('service_role', 'ai_provider_model',         'REFERENCES', false),
      ('service_role', 'ai_provider_model',         'TRIGGER',    false),

      -- NOTHING, for either browser-facing role, on any of the three.
      ('authenticated', 'ai_provider_configuration', 'SELECT',   false),
      ('authenticated', 'ai_provider_configuration', 'INSERT',   false),
      ('authenticated', 'ai_provider_configuration', 'UPDATE',   false),
      ('authenticated', 'ai_provider_configuration', 'DELETE',   false),
      ('authenticated', 'ai_provider_credential',    'SELECT',   false),
      ('authenticated', 'ai_provider_credential',    'INSERT',   false),
      ('authenticated', 'ai_provider_credential',    'UPDATE',   false),
      ('authenticated', 'ai_provider_credential',    'DELETE',   false),
      ('authenticated', 'ai_provider_model',         'SELECT',   false),
      ('authenticated', 'ai_provider_model',         'INSERT',   false),
      ('authenticated', 'ai_provider_model',         'UPDATE',   false),
      ('authenticated', 'ai_provider_model',         'DELETE',   false),

      ('anon', 'ai_provider_configuration', 'SELECT', false),
      ('anon', 'ai_provider_configuration', 'INSERT', false),
      ('anon', 'ai_provider_configuration', 'UPDATE', false),
      ('anon', 'ai_provider_configuration', 'DELETE', false),
      ('anon', 'ai_provider_credential',    'SELECT', false),
      ('anon', 'ai_provider_credential',    'INSERT', false),
      ('anon', 'ai_provider_credential',    'UPDATE', false),
      ('anon', 'ai_provider_credential',    'DELETE', false),
      ('anon', 'ai_provider_model',         'SELECT', false),
      ('anon', 'ai_provider_model',         'INSERT', false),
      ('anon', 'ai_provider_model',         'UPDATE', false),
      ('anon', 'ai_provider_model',         'DELETE', false)
    ) AS matrix(role_name, table_name, privilege, expected)
  LOOP
    v_actual := has_table_privilege(v_role, 'cortex.' || v_table, v_privilege);
    IF v_actual <> v_expected THEN
      v_problems := v_problems || format(
        E'\n  %s on cortex.%s for %s: expected %s, got %s',
        v_privilege, v_table, v_role, v_expected, v_actual);
    END IF;
  END LOOP;

  IF v_problems <> '' THEN
    RAISE EXCEPTION '4D-P1: the privilege matrix changed under Batch 4D:%', v_problems;
  END IF;

  RAISE NOTICE 'assert_4d_privileges: PASSED (4D-P1, the privilege matrix is unchanged)';
END;
$$;

-- ---------------------------------------------------------------------------
-- 4D-P2. Denied by ATTEMPT, not only by catalogue.
--
-- A catalogue that says "denied" and a statement that succeeds would be the
-- worst possible outcome, so neither answer is trusted alone. Each attempt runs
-- in its own DO block with its own SET ROLE, because a failed statement inside
-- one block would abort the rest of it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role   TEXT;
  v_count  INTEGER;
  v_failed BOOLEAN;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET ROLE %I', v_role);

    v_failed := FALSE;
    BEGIN
      EXECUTE 'SELECT count(*) FROM cortex.ai_provider_configuration' INTO v_count;
    EXCEPTION WHEN insufficient_privilege THEN
      v_failed := TRUE;
    END;
    RESET ROLE;
    IF NOT v_failed THEN
      RAISE EXCEPTION
        '4D-P2: % read cortex.ai_provider_configuration. Customer configurations — which '
        'name every organization that has brought a key — are readable from a browser '
        'session token.', v_role;
    END IF;

    EXECUTE format('SET ROLE %I', v_role);
    v_failed := FALSE;
    BEGIN
      EXECUTE 'SELECT count(*) FROM cortex.ai_provider_credential' INTO v_count;
    EXCEPTION WHEN insufficient_privilege THEN
      v_failed := TRUE;
    END;
    RESET ROLE;
    IF NOT v_failed THEN
      RAISE EXCEPTION '4D-P2: % read cortex.ai_provider_credential', v_role;
    END IF;

    EXECUTE format('SET ROLE %I', v_role);
    v_failed := FALSE;
    BEGIN
      EXECUTE $q$UPDATE cortex.ai_provider_configuration SET enabled = TRUE$q$;
    EXCEPTION WHEN insufficient_privilege THEN
      v_failed := TRUE;
    END;
    RESET ROLE;
    IF NOT v_failed THEN
      RAISE EXCEPTION '4D-P2: % mutated cortex.ai_provider_configuration', v_role;
    END IF;
  END LOOP;

  RAISE NOTICE
    'assert_4d_privileges: PASSED (4D-P2, anon and authenticated denied read and mutate '
    'by attempt as well as by catalogue)';
END;
$$;

-- ---------------------------------------------------------------------------
-- 4D-P3 / 4D-P4 / 4D-P5. The trigger function, and the 4D column.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role     TEXT;
  v_count    INTEGER;
  v_acme     UUID;
  v_failed   BOOLEAN;
BEGIN
  -- 4D-P3. Neither browser role may execute the trigger function directly.
  -- It is SECURITY INVOKER and does nothing dangerous on its own, but a
  -- function reachable by a browser role is a function whose next revision
  -- has to be reviewed as browser-reachable.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(
         v_role,
         'cortex.ai_provider_configuration_tenancy_is_immutable()',
         'EXECUTE') THEN
      RAISE EXCEPTION '4D-P3: % may execute the 4D tenancy trigger function', v_role;
    END IF;
  END LOOP;

  -- 4D-P5. No column-level grant reached the 4D column either. A table-level
  -- REVOKE does not remove a column-level GRANT, so this is a separate
  -- question with a separate answer.
  SELECT count(*) INTO v_count
    FROM information_schema.column_privileges
   WHERE table_schema = 'cortex'
     AND table_name = 'ai_provider_configuration'
     AND column_name = 'credential_fallback'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_count <> 0 THEN
    RAISE EXCEPTION '4D-P5: a browser role holds a column privilege on credential_fallback';
  END IF;

  -- 4D-P4. The trigger fires for `service_role` — the privileged writer.
  --
  -- A control the runtime's own role can step around is not a control, and
  -- `service_role` is precisely the role an attacker with a leaked key would
  -- hold. `BYPASSRLS` bypasses row level security; it does not bypass triggers,
  -- and this asks the database to confirm that rather than assuming it.
  SELECT id INTO v_acme FROM public.organizations WHERE slug = 'acme' AND deleted_at IS NULL;
  IF v_acme IS NULL THEN
    RAISE EXCEPTION '4D-P4: the tenant fixture did not run';
  END IF;

  SET ROLE service_role;
  v_failed := FALSE;
  BEGIN
    UPDATE cortex.ai_provider_configuration
       SET scope = 'platform', organization_id = NULL
     WHERE scope = 'organization' AND organization_id = v_acme;
  EXCEPTION WHEN raise_exception OR check_violation THEN
    v_failed := TRUE;
  END;
  RESET ROLE;
  IF NOT v_failed THEN
    RAISE EXCEPTION
      '4D-P4: service_role promoted a customer configuration to platform scope. The role a '
      'leaked service key holds can move a customer''s credential onto MARQ''s execution '
      'path with one statement.';
  END IF;

  RAISE NOTICE
    'assert_4d_privileges: PASSED (4D-P3/P4/P5, trigger function not browser-executable, '
    'no column grant, and the tenancy guard binds service_role too)';
END;
$$;
