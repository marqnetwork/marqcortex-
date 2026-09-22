-- ============================================================================
-- A2-P07 — agent isolation and privilege, as the roles experience them.
--
-- The claim is BP-003's, total: THESE THREE TABLES HAVE NO CLIENT-FACING PATH.
-- `anon` and `authenticated` cannot read, write or execute; `service_role`
-- does the runtime's work. The role switch is asserted, so a suite that
-- silently ran as the superuser cannot report a result about nothing.
-- ============================================================================

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_user  UUID := '99999999-0000-4000-8000-000000000021';
  v_role  UUID;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'alpha-agent-operator@example.test')
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_role FROM public.roles WHERE key = 'org_admin' LIMIT 1;
  IF v_role IS NULL THEN
    INSERT INTO public.roles (key, name) VALUES ('org_admin', 'Org Admin') RETURNING id INTO v_role;
  END IF;

  INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status)
  VALUES (v_alpha, v_user, v_role, 'active')
  ON CONFLICT DO NOTHING;
END
$$;

DO $$
DECLARE
  v_policies INTEGER;
  v_bad      TEXT;
BEGIN
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('agent_runs', 'agent_checkpoints', 'agent_approvals');
  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'A2-P07 created % row-level policies; it must create none', v_policies;
  END IF;
  RAISE NOTICE '  ok  no policy exists on any agent persistence table';

  SELECT string_agg(c.relname, ', ') INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('agent_runs', 'agent_checkpoints', 'agent_approvals')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'row level security is not enabled AND forced on: %', v_bad;
  END IF;
  RAISE NOTICE '  ok  row level security is enabled and FORCED on all three agent tables';
END
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000021', false);
SELECT set_config('request.jwt.claims',
  '{"sub":"99999999-0000-4000-8000-000000000021","app_metadata":{}}', false);

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_rows  INTEGER;
  v_table TEXT;
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'the role switch did not take: running as %', current_user;
  END IF;

  -- ── NO READ, NOT EVEN OF ITS OWN TENANT ─────────────────────────────────
  FOREACH v_table IN ARRAY ARRAY['agent_runs', 'agent_checkpoints', 'agent_approvals'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_rows;
      IF v_rows > 0 THEN
        RAISE EXCEPTION 'an authenticated member SELECTED % rows of %', v_rows, v_table;
      END IF;
      RAISE NOTICE '  ok  an authenticated member reads nothing from %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE '  ok  an authenticated member cannot SELECT %', v_table;
    END;
  END LOOP;

  -- ── NO WRITE, BY ANY ROUTE ──────────────────────────────────────────────
  BEGIN
    UPDATE public.agent_runs SET state = 'completed' WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member UPDATED % agent runs', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot complete an agent run';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot complete an agent run';
  END;

  BEGIN
    UPDATE public.agent_approvals SET approval_state = 'approved', decided_at = now()
     WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member APPROVED % agent requests', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot approve an agent action directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot approve an agent action directly';
  END;

  BEGIN
    DELETE FROM public.agent_checkpoints WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member DELETED % checkpoints', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot delete an agent checkpoint';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot delete an agent checkpoint';
  END;

  -- ── AND CANNOT EXECUTE ANY OF THE RUNTIME'S FUNCTIONS ───────────────────
  BEGIN
    PERFORM public.agent_run_create(v_alpha, 'run_viafn', 'a', 'u', 'running', 1, 0, now(), now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED agent_run_create';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot create an agent run through the function';
  END;
  BEGIN
    PERFORM public.agent_run_save(v_alpha, 'run_alpha', 2, 'completed', 3, 1, now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED agent_run_save';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot advance an agent run through the function';
  END;
  BEGIN
    PERFORM public.agent_approval_save(v_alpha, 'apr_alpha', 1, 'approved', 2, now(), NULL, now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED agent_approval_save';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot decide an agent approval through the function';
  END;
  BEGIN
    PERFORM public.agent_checkpoint_append(v_alpha, 'run_alpha', 9, 'x', 'y', 'a', 'running', 1, now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED agent_checkpoint_append';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot append an agent checkpoint';
  END;
  BEGIN
    PERFORM public.agent_run_list(v_alpha, NULL, NULL, NULL, 50);
    RAISE EXCEPTION 'an authenticated member EXECUTED agent_run_list';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot list agent runs through the function';
  END;
  BEGIN
    PERFORM public.agent_approval_list(v_alpha, NULL, TRUE, 50);
    RAISE EXCEPTION 'an authenticated member EXECUTED agent_approval_list';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot read the agent approval queue directly';
  END;
  BEGIN
    PERFORM public.agent_checkpoint_history(v_alpha, 'run_alpha');
    RAISE EXCEPTION 'an authenticated member EXECUTED agent_checkpoint_history';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot read an agent''s progress directly';
  END;
END
$$;

RESET ROLE;

SET ROLE anon;
DO $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'the role switch did not take: running as %', current_user;
  END IF;
  BEGIN
    SELECT count(*) INTO v_rows FROM public.agent_runs;
    IF v_rows > 0 THEN RAISE EXCEPTION 'anon SELECTED % agent runs', v_rows; END IF;
    RAISE NOTICE '  ok  an unauthenticated caller reads no agent state';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an unauthenticated caller cannot SELECT agent state';
  END;
  BEGIN
    PERFORM public.agent_run_load('11111111-1111-4111-8111-111111111111', 'run_alpha');
    RAISE EXCEPTION 'anon EXECUTED agent_run_load';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an unauthenticated caller cannot execute the agent functions';
  END;
END
$$;
RESET ROLE;

-- The service role CAN — which is what makes the above a boundary rather than
-- a broken deployment — and the functions keep it inside one tenant.
SET ROLE service_role;
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_beta  UUID := '22222222-2222-4222-8222-222222222222';
  v_count INTEGER;
  v_saved TEXT;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'the role switch did not take: running as %', current_user;
  END IF;

  SELECT count(*) INTO v_count FROM public.agent_run_list(v_alpha, NULL, NULL, NULL, 50);
  IF v_count = 0 THEN RAISE EXCEPTION 'the service role could not list agent runs'; END IF;
  SELECT count(*) INTO v_count FROM public.agent_checkpoint_history(v_alpha, 'run_alpha');
  IF v_count = 0 THEN RAISE EXCEPTION 'the service role could not read the agent chain'; END IF;
  SELECT count(*) INTO v_count FROM public.agent_approval_list(v_alpha, NULL, TRUE, 50);
  IF v_count = 0 THEN RAISE EXCEPTION 'the service role could not read the agent approval queue'; END IF;

  -- Beta, holding Alpha's ids, gets nothing and changes nothing.
  SELECT count(*) INTO v_count FROM public.agent_run_load(v_beta, 'run_alpha');
  IF v_count <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta loaded Alpha''s agent run'; END IF;
  SELECT count(*) INTO v_count FROM public.agent_checkpoint_history(v_beta, 'run_alpha');
  IF v_count <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta read Alpha''s agent checkpoints'; END IF;
  SELECT count(*) INTO v_count FROM public.agent_approval_load(v_beta, 'apr_alpha');
  IF v_count <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta loaded Alpha''s agent approval'; END IF;
  v_saved := public.agent_run_save(v_beta, 'run_alpha', 2, 'completed', 3, 1, now(),
    '{"context":{"runId":"run_alpha","organizationId":"22222222-2222-4222-8222-222222222222","agentId":"agent.primary","actorId":"user_alpha"},"state":"completed","runVersion":3,"checkpointVersion":1}'::jsonb);
  IF v_saved <> 'missing' THEN RAISE EXCEPTION 'TENANT BREACH: Beta''s save against Alpha''s run said %', v_saved; END IF;
  v_saved := public.agent_approval_save(v_beta, 'apr_alpha', 1, 'approved', 2, now(), NULL, now(), '{}'::jsonb);
  IF v_saved <> 'missing' THEN RAISE EXCEPTION 'TENANT BREACH: Beta decided Alpha''s approval: %', v_saved; END IF;
  RAISE NOTICE '  ok  another tenant holding Alpha''s ids reads nothing and writes nothing';

  v_saved := public.agent_run_save(v_alpha, 'run_alpha', 2, 'running', 3, 1, now(),
    '{"context":{"runId":"run_alpha","organizationId":"11111111-1111-4111-8111-111111111111","agentId":"agent.primary","actorId":"user_alpha"},"state":"running","runVersion":3,"checkpointVersion":1}'::jsonb);
  IF v_saved <> 'saved' THEN RAISE EXCEPTION 'the service role could not advance an agent run: %', v_saved; END IF;

  -- The shape `expire()` writes on a pending request: decided stamp, no spend.
  v_saved := public.agent_approval_save(v_alpha, 'apr_alpha', 1, 'expired', 2, now(), NULL, now(),
    '{"approvalId":"apr_alpha","runId":"run_alpha","actionId":"act_alpha","organizationId":"11111111-1111-4111-8111-111111111111","requestingAgentId":"agent.primary","state":"expired","approvalVersion":2,"singleUse":true,"expiresAt":"2026-09-22T11:00:50.000Z","decidedAt":"2026-09-22T11:01:00.000Z"}'::jsonb);
  IF v_saved <> 'saved' THEN RAISE EXCEPTION 'the runtime could not expire an agent approval: %', v_saved; END IF;

  RAISE NOTICE '  ok  the service role runs the agent persistence operations, expiry included';
END
$$;
RESET ROLE;
