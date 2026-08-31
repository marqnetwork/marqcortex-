-- ---------------------------------------------------------------------------
-- ASSERT — AI-01 Batch 4C: who may touch these tables, and with what
--
-- Runs after the 4C migration, on a database whose 4C objects are owned by a
-- NOSUPERUSER role (see 05_4c_migration_owner.sql).
--
--   4C-P1  `service_role` holds EXACTLY the privileges the runtime needs, and
--          not one more — checked as a full matrix, so a widened grant fails
--          here rather than passing unnoticed
--   4C-P2  `authenticated` cannot READ a provider credential row
--   4C-P3  `authenticated` cannot MUTATE one — insert, update or delete
--   4C-P4  `anon` can do neither, on any of the three tables
--   4C-P5  neither browser role may EXECUTE the activation function
--   4C-P6  `service_role` MAY execute it
--   4C-P7  the RLS controls are still in force, and are a SECOND control
--          rather than the only one
--   4C-P8  the SECURITY DEFINER function's owner really can write through
--          FORCE ROW LEVEL SECURITY — the dependency the migration names
--
-- Both halves of 4C-P2 through 4C-P5 are asserted: the privilege system's own
-- answer (`has_table_privilege`), and an ACTUAL attempt made while SET ROLE'd
-- into the role. A catalogue that says "denied" and a statement that succeeds
-- would be the worst possible outcome, so neither is trusted alone.
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
  -- 4C-P1. The exact privilege matrix.
  --
  -- Enumerated in full — every privilege PostgreSQL defines for a table, for
  -- every role that matters — so that this file fails on a grant nobody
  -- intended just as loudly as on a grant that is missing. `ALL PRIVILEGES`
  -- would have satisfied "the runtime works" and failed here.
  -- -------------------------------------------------------------------------
  FOR v_role, v_table, v_privilege, v_expected IN
    SELECT * FROM (VALUES
      -- service_role: the runtime's own operations, and nothing beyond them.
      ('service_role', 'ai_provider_configuration', 'SELECT',     true),
      ('service_role', 'ai_provider_configuration', 'INSERT',     true),
      ('service_role', 'ai_provider_configuration', 'UPDATE',     true),
      ('service_role', 'ai_provider_configuration', 'DELETE',     false),
      ('service_role', 'ai_provider_configuration', 'TRUNCATE',   false),
      ('service_role', 'ai_provider_configuration', 'REFERENCES', false),
      ('service_role', 'ai_provider_configuration', 'TRIGGER',    false),

      -- No INSERT on the credential table: the only insert is inside the
      -- SECURITY DEFINER activation function, so that the supersede and the
      -- insert cannot be issued apart.
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

      -- The browser-facing roles hold nothing at all, on any of the three.
      ('authenticated', 'ai_provider_configuration', 'SELECT',     false),
      ('authenticated', 'ai_provider_configuration', 'INSERT',     false),
      ('authenticated', 'ai_provider_configuration', 'UPDATE',     false),
      ('authenticated', 'ai_provider_configuration', 'DELETE',     false),
      ('authenticated', 'ai_provider_configuration', 'TRUNCATE',   false),
      ('authenticated', 'ai_provider_configuration', 'REFERENCES', false),
      ('authenticated', 'ai_provider_configuration', 'TRIGGER',    false),
      ('authenticated', 'ai_provider_credential',    'SELECT',     false),
      ('authenticated', 'ai_provider_credential',    'INSERT',     false),
      ('authenticated', 'ai_provider_credential',    'UPDATE',     false),
      ('authenticated', 'ai_provider_credential',    'DELETE',     false),
      ('authenticated', 'ai_provider_credential',    'TRUNCATE',   false),
      ('authenticated', 'ai_provider_credential',    'REFERENCES', false),
      ('authenticated', 'ai_provider_credential',    'TRIGGER',    false),
      ('authenticated', 'ai_provider_model',         'SELECT',     false),
      ('authenticated', 'ai_provider_model',         'INSERT',     false),
      ('authenticated', 'ai_provider_model',         'UPDATE',     false),
      ('authenticated', 'ai_provider_model',         'DELETE',     false),
      ('authenticated', 'ai_provider_model',         'TRUNCATE',   false),
      ('authenticated', 'ai_provider_model',         'REFERENCES', false),
      ('authenticated', 'ai_provider_model',         'TRIGGER',    false),

      ('anon', 'ai_provider_configuration', 'SELECT',     false),
      ('anon', 'ai_provider_configuration', 'INSERT',     false),
      ('anon', 'ai_provider_configuration', 'UPDATE',     false),
      ('anon', 'ai_provider_configuration', 'DELETE',     false),
      ('anon', 'ai_provider_configuration', 'TRUNCATE',   false),
      ('anon', 'ai_provider_configuration', 'REFERENCES', false),
      ('anon', 'ai_provider_configuration', 'TRIGGER',    false),
      ('anon', 'ai_provider_credential',    'SELECT',     false),
      ('anon', 'ai_provider_credential',    'INSERT',     false),
      ('anon', 'ai_provider_credential',    'UPDATE',     false),
      ('anon', 'ai_provider_credential',    'DELETE',     false),
      ('anon', 'ai_provider_credential',    'TRUNCATE',   false),
      ('anon', 'ai_provider_credential',    'REFERENCES', false),
      ('anon', 'ai_provider_credential',    'TRIGGER',    false),
      ('anon', 'ai_provider_model',         'SELECT',     false),
      ('anon', 'ai_provider_model',         'INSERT',     false),
      ('anon', 'ai_provider_model',         'UPDATE',     false),
      ('anon', 'ai_provider_model',         'DELETE',     false),
      ('anon', 'ai_provider_model',         'TRUNCATE',   false),
      ('anon', 'ai_provider_model',         'REFERENCES', false),
      ('anon', 'ai_provider_model',         'TRIGGER',    false)
    ) AS matrix(role_name, table_name, privilege, expected)
  LOOP
    v_actual := has_table_privilege(v_role, 'cortex.' || v_table, v_privilege);
    IF v_actual IS DISTINCT FROM v_expected THEN
      v_problems := v_problems ||
        format(E'\n  %s on cortex.%s to %s: expected %s, got %s',
               v_privilege, v_table, v_role, v_expected, v_actual);
    END IF;
  END LOOP;

  IF v_problems <> '' THEN
    RAISE EXCEPTION '4C-P1: the privilege matrix is wrong:%', v_problems;
  END IF;

  -- PUBLIC holds nothing either, so no future role inherits access by default.
  IF has_table_privilege('public', 'cortex.ai_provider_credential', 'SELECT') THEN
    RAISE EXCEPTION '4C-P1: PUBLIC can read the credential table';
  END IF;

  RAISE NOTICE 'assert_4c_privileges: PASSED (4C-P1, the exact privilege matrix)';
END $$;

-- ---------------------------------------------------------------------------
-- 4C-P2 / 4C-P3 / 4C-P4. The catalogue's answer is not enough. Try it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role     TEXT;
  v_table    TEXT;
  v_sql      TEXT;
  v_label    TEXT;
  v_failed   BOOLEAN;
  v_leaked   TEXT := '';
BEGIN
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'ai_provider_credential', 'ai_provider_configuration', 'ai_provider_model'
    ] LOOP
      FOR v_label, v_sql IN
        SELECT * FROM (VALUES
          ('read',   'SELECT * FROM cortex.%1$I'),
          ('count',  'SELECT count(*) FROM cortex.%1$I'),
          ('insert', 'INSERT INTO cortex.%1$I (id) VALUES (''pvx_intrusion'')'),
          ('update', 'UPDATE cortex.%1$I SET id = id'),
          ('delete', 'DELETE FROM cortex.%1$I')
        ) AS attempts(label, statement)
      LOOP
        v_failed := false;
        BEGIN
          EXECUTE format('SET ROLE %I', v_role);
          EXECUTE format(v_sql, v_table);
        EXCEPTION
          WHEN insufficient_privilege THEN
            v_failed := true;
          WHEN OTHERS THEN
            -- Any other error means the statement got PAST the access check and
            -- failed for a downstream reason. That is not a denial.
            v_failed := false;
        END;
        RESET ROLE;
        IF NOT v_failed THEN
          v_leaked := v_leaked || format(E'\n  %s could %s cortex.%s', v_role, v_label, v_table);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF v_leaked <> '' THEN
    RAISE EXCEPTION '4C-P2/P3/P4: a browser-facing role reached a provider table:%', v_leaked;
  END IF;

  RAISE NOTICE
    'assert_4c_privileges: PASSED (4C-P2/P3/P4, anon and authenticated denied read and mutate '
    'on all three tables)';
END $$;

-- ---------------------------------------------------------------------------
-- 4C-P5 / 4C-P6. The activation function, which is the one path that WRITES a
-- credential row. SECURITY DEFINER makes an over-broad EXECUTE grant an
-- escalation, not merely an extra capability.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role   TEXT;
  v_failed BOOLEAN;
  v_leaked TEXT := '';
  v_sig    TEXT := 'cortex.ai_provider_credential_activate(TEXT, TEXT, TEXT, JSONB, TEXT, '
                   || 'TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT)';
BEGIN
  -- 4C-P5. Neither browser role may call it — by catalogue…
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
      v_leaked := v_leaked || format(E'\n  %s holds EXECUTE by catalogue', v_role);
    END IF;

    -- …and by attempt.
    v_failed := false;
    BEGIN
      EXECUTE format('SET ROLE %I', v_role);
      PERFORM cortex.ai_provider_credential_activate(
        'pvk_intrusion', 'pvc_openai01', 'intrusion',
        '{"v":1,"alg":"AES-256-GCM","kid":"k_1a2b","iv":"aXY=","ct":"Y3Q="}'::JSONB,
        'k_1a2b', 'fp_0000000000009999', NULL, 1, NOW(), NULL, 'attacker');
    EXCEPTION
      WHEN insufficient_privilege THEN v_failed := true;
      WHEN OTHERS THEN v_failed := false;
    END;
    RESET ROLE;
    IF NOT v_failed THEN
      v_leaked := v_leaked || format(E'\n  %s successfully called the activation function', v_role);
    END IF;
  END LOOP;

  IF v_leaked <> '' THEN
    RAISE EXCEPTION
      '4C-P5: a browser-facing role can reach the SECURITY DEFINER activation function:%',
      v_leaked;
  END IF;

  -- Nothing the intruders tried landed.
  IF EXISTS (SELECT 1 FROM cortex.ai_provider_credential WHERE id = 'pvk_intrusion') THEN
    RAISE EXCEPTION '4C-P5: an intrusion credential row exists';
  END IF;

  -- 4C-P6. And the one role that must call it, can.
  IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION
      '4C-P6: service_role cannot EXECUTE the activation function. Every credential rotation '
      'in this deployment would fail with "permission denied for function".';
  END IF;

  RAISE NOTICE 'assert_4c_privileges: PASSED (4C-P5/P6, activation RPC authority)';
END $$;

-- ---------------------------------------------------------------------------
-- 4C-P7. RLS is a SECOND control, not the only one.
--
-- The revoke above and the policy-less RLS are deliberately redundant: the
-- revoke survives somebody adding a policy, and the policy-less RLS survives
-- somebody adding a grant. This asserts the second half is still standing by
-- GRANTING `authenticated` a SELECT and showing it still reads nothing.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rows INTEGER;
BEGIN
  -- Temporarily, and only here. This is the hypothetical the redundancy exists
  -- for: a future migration that grants a privilege without noticing the RLS.
  GRANT SELECT ON cortex.ai_provider_credential TO authenticated;

  SET ROLE authenticated;
  SELECT count(*) INTO v_rows FROM cortex.ai_provider_credential;
  RESET ROLE;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      '4C-P7: with a SELECT grant in place, authenticated read % credential rows. RLS with no '
      'policy is supposed to deny every row, and it is the control that survives a careless '
      'grant.', v_rows;
  END IF;

  REVOKE SELECT ON cortex.ai_provider_credential FROM authenticated;

  -- And the grant really is gone again, so this file leaves nothing behind.
  IF has_table_privilege('authenticated', 'cortex.ai_provider_credential', 'SELECT') THEN
    RAISE EXCEPTION '4C-P7: the temporary grant was not removed';
  END IF;

  RAISE NOTICE 'assert_4c_privileges: PASSED (4C-P7, RLS denies even with a grant in place)';
END $$;

-- ---------------------------------------------------------------------------
-- 4C-P8. The dependency the migration names in its own text.
--
-- `ai_provider_credential_activate` is SECURITY DEFINER, so it writes as its
-- OWNER, and `FORCE ROW LEVEL SECURITY` applies RLS to the owner too. The
-- function therefore requires an owner holding BYPASSRLS. This scratch database
-- applied the migration as a NOSUPERUSER role precisely so that requirement is
-- exercised rather than masked by superuser privileges — and this assertion
-- states it, so the next reader knows the earlier activations were a real test
-- of it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner    TEXT;
  v_super    BOOLEAN;
  v_bypass   BOOLEAN;
BEGIN
  SELECT pg_get_userbyid(p.proowner) INTO v_owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'cortex' AND p.proname = 'ai_provider_credential_activate';

  SELECT rolsuper, rolbypassrls INTO v_super, v_bypass FROM pg_roles WHERE rolname = v_owner;

  IF v_super THEN
    RAISE EXCEPTION
      '4C-P8: the 4C objects are owned by a SUPERUSER (%), so every activation in this run '
      'proved nothing about a deployment. Apply the migration as the NOSUPERUSER role in '
      '05_4c_migration_owner.sql.', v_owner;
  END IF;

  IF NOT v_bypass THEN
    RAISE EXCEPTION
      '4C-P8: the activation function is owned by %, which holds neither SUPERUSER nor '
      'BYPASSRLS. Under FORCE ROW LEVEL SECURITY with no policy, its INSERT cannot succeed.',
      v_owner;
  END IF;

  RAISE NOTICE
    'assert_4c_privileges: PASSED (4C-P8, activation proved under a NOSUPERUSER owner: %)',
    v_owner;
END $$;
