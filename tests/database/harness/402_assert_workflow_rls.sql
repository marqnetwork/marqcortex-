-- ============================================================================
-- BP-003 — isolation and privilege, as the roles actually experience them.
--
-- `SET ROLE` and session-scoped `set_config`, the shape BP-002's RLS assertion
-- settled on after its first version used `SET LOCAL` outside a transaction —
-- which PostgreSQL warns about and ignores, so every query ran as the
-- superuser and the suite reported a result about nothing. The role switch is
-- ASSERTED below so that cannot happen again in either direction.
--
-- ── THE CLAIM, AND IT IS STRONGER THAN THE ONE THIS FILE FIRST MADE ───────
--
-- An earlier version proved a member could read its own tenant's rows and no
-- other tenant's. That was the wrong claim for this packet: BP-003 replaces
-- storage under three existing ports, and the workflow SERVICE is and remains
-- the authorization surface for workflow state. A second read path straight to
-- the rows — one the service does not mediate, on tables whose `record` column
-- holds a run's validated input — is an API decision, not a persistence one.
--
-- So the claim is now total: THESE THREE TABLES HAVE NO CLIENT-FACING PATH AT
-- ALL. `anon` and `authenticated` cannot read them, cannot write them, and
-- cannot execute the runtime's functions. `service_role` does the work.
-- ============================================================================

-- A member of Alpha with an active membership and an admin role. The point is
-- that even a fully privileged member of the right tenant gets nothing here.
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_user  UUID := '99999999-0000-4000-8000-000000000011';
  v_role  UUID;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'alpha-workflow-operator@example.test')
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

-- ── BP-003 MINTS NO PERMISSION KEYS ────────────────────────────────────────
--
-- A key with no policy behind it is a grant that looks meaningful and governs
-- nothing — and a key this packet did not create is a key its rollback must
-- not delete. The fixture seeded `workflows.read` and `workflows.operate` as
-- PRE-EXISTING rows precisely so that `403` can prove they survive; what is
-- asserted here is that no POLICY anywhere consults them.
DO $$
DECLARE
  v_policies INTEGER;
BEGIN
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('workflow_runs', 'workflow_checkpoints', 'workflow_approvals');
  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'BP-003 created % row-level policies; it must create none', v_policies;
  END IF;
  RAISE NOTICE '  ok  no policy exists on any workflow persistence table';
END
$$;

-- RLS is on AND forced on all three, so the owner is not silently exempt.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('workflow_runs', 'workflow_checkpoints', 'workflow_approvals')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'row level security is not enabled AND forced on: %', v_bad;
  END IF;
  RAISE NOTICE '  ok  row level security is enabled and FORCED on all three tables';
END
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000011', false);
SELECT set_config('request.jwt.claims',
  '{"sub":"99999999-0000-4000-8000-000000000011","app_metadata":{}}', false);

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_rows  INTEGER;
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'the role switch did not take: running as %', current_user;
  END IF;

  -- ── NO READ, NOT EVEN OF ITS OWN TENANT ─────────────────────────────────
  --
  -- The strong form. Not "a member reads only its own rows" — a member reads
  -- NOTHING, because the run record holds the run's validated input and the
  -- read models exist so a caller never receives it raw.
  BEGIN
    SELECT count(*) INTO v_rows FROM public.workflow_runs;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'an authenticated member SELECTED % workflow runs', v_rows;
    END IF;
    -- Zero rows without an error is also a pass: privilege may be refused, or
    -- the absent policy may filter everything. Either is "no client read path".
    RAISE NOTICE '  ok  an authenticated member reads no workflow runs at all';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot SELECT workflow runs';
  END;

  BEGIN
    SELECT count(*) INTO v_rows FROM public.workflow_checkpoints;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'an authenticated member SELECTED % checkpoints', v_rows;
    END IF;
    RAISE NOTICE '  ok  an authenticated member reads no checkpoints at all';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot SELECT checkpoints';
  END;

  BEGIN
    SELECT count(*) INTO v_rows FROM public.workflow_approvals;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'an authenticated member SELECTED % approvals', v_rows;
    END IF;
    RAISE NOTICE '  ok  an authenticated member reads no approvals at all';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot SELECT approvals';
  END;

  -- ── AND NO WRITE PATH, BY ANY ROUTE ─────────────────────────────────────
  BEGIN
    INSERT INTO public.workflow_runs (
      organization_id, workflow_run_id, workflow_id, actor_id, state,
      run_version, checkpoint_version, created_at, updated_at, record
    ) VALUES (
      v_alpha, 'wfr_impostor', 'wf.x', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_impostor","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'an authenticated member INSERTED a workflow run';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot insert a run';
  END;

  BEGIN
    UPDATE public.workflow_runs SET state = 'completed' WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member UPDATED % runs', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot complete a run that never ran';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot complete a run that never ran';
  END;

  BEGIN
    UPDATE public.workflow_approvals
       SET approval_state = 'approved', decided_at = now()
     WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member APPROVED % requests', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot approve their own request';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot approve their own request';
  END;

  BEGIN
    UPDATE public.workflow_checkpoints SET digest = 'tampered' WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member REWROTE % checkpoints', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot rewrite the chain';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot rewrite the chain';
  END;

  BEGIN
    DELETE FROM public.workflow_checkpoints WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member DELETED % checkpoints', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot delete a checkpoint';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot delete a checkpoint';
  END;

  BEGIN
    DELETE FROM public.workflow_runs WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member DELETED % runs', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot delete a run';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot delete a run';
  END;

  -- ── AND CANNOT REACH THE RUNTIME'S OWN FUNCTIONS ────────────────────────
  --
  -- The table privileges would be beside the point if the SECURITY DEFINER
  -- functions were executable by anybody: each of them runs as the owner.
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_viafn', 'wf.x', 'u', 'running', 1, 0, now(), now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_run_create';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot create a run through the function';
  END;

  BEGIN
    PERFORM public.workflow_run_save(
      v_alpha, 'wfr_alpha', 2, 'completed', 3, 1, now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_run_save';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot advance a run through the function';
  END;

  BEGIN
    PERFORM public.workflow_approval_save(
      v_alpha, 'wfa:wfr_alpha:gate:main:1', 1, 'approved', 2, now(), NULL, now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_approval_save';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot decide an approval through the function';
  END;

  BEGIN
    PERFORM public.workflow_checkpoint_append(
      v_alpha, 'wfr_alpha', 9, 'x', 'y', 'n', 'running', now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_checkpoint_append';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot append to the chain';
  END;

  -- The READ functions too. There is no client-facing route to these rows,
  -- and an executable listing would be exactly such a route.
  BEGIN
    PERFORM public.workflow_run_list(v_alpha, NULL, NULL, NULL, 50);
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_run_list';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot list runs through the function';
  END;

  BEGIN
    PERFORM public.workflow_run_load(v_alpha, 'wfr_alpha');
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_run_load';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot load a run through the function';
  END;

  BEGIN
    PERFORM public.workflow_approval_list(v_alpha, NULL, TRUE, 50);
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_approval_list';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot read the approval queue directly';
  END;

  BEGIN
    PERFORM public.workflow_checkpoint_history(v_alpha, 'wfr_alpha');
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_checkpoint_history';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot walk the chain directly';
  END;
END
$$;

RESET ROLE;

-- ── AND `anon` GETS NOTHING EITHER ─────────────────────────────────────────
SET ROLE anon;
DO $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'the role switch did not take: running as %', current_user;
  END IF;
  BEGIN
    SELECT count(*) INTO v_rows FROM public.workflow_runs;
    IF v_rows > 0 THEN RAISE EXCEPTION 'anon SELECTED % workflow runs', v_rows; END IF;
    RAISE NOTICE '  ok  an unauthenticated caller reads no workflow state';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an unauthenticated caller cannot SELECT workflow state';
  END;
END
$$;
RESET ROLE;

-- The service role CAN, which is what makes the above a boundary rather than a
-- broken deployment.
SET ROLE service_role;
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_count INTEGER;
  v_saved TEXT;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'the role switch did not take: running as %', current_user;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.workflow_run_list(v_alpha, NULL, NULL, NULL, 50);
  IF v_count = 0 THEN RAISE EXCEPTION 'the service role could not list runs'; END IF;

  SELECT count(*) INTO v_count
    FROM public.workflow_checkpoint_history(v_alpha, 'wfr_alpha');
  IF v_count = 0 THEN RAISE EXCEPTION 'the service role could not read the chain'; END IF;

  SELECT count(*) INTO v_count
    FROM public.workflow_approval_list(v_alpha, NULL, TRUE, 50);
  IF v_count = 0 THEN RAISE EXCEPTION 'the service role could not read the approval queue'; END IF;

  v_saved := public.workflow_run_save(
    v_alpha, 'wfr_alpha', 2, 'completed', 3, 1, now(),
    '{"context":{"workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","actorId":"user_alpha"},"state":"completed","runVersion":3,"checkpointVersion":1}'::jsonb);
  IF v_saved <> 'saved' THEN RAISE EXCEPTION 'the service role could not advance a run: %', v_saved; END IF;

  -- And it can persist a closure that carries no decision stamp, which is the
  -- shape `expireIfDue()` and `withdraw()` actually produce.
  v_saved := public.workflow_approval_save(
    v_alpha, 'wfa:wfr_alpha:gate:main:1', 1, 'expired', 2, NULL, NULL, now(),
    '{"workflowApprovalId":"wfa:wfr_alpha:gate:main:1","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"expired","approvalVersion":2,"singleUse":true,"closureReason":"The decision window closed.","failure":"workflow_approval_expired"}'::jsonb);
  IF v_saved <> 'saved' THEN RAISE EXCEPTION 'the runtime could not expire an approval: %', v_saved; END IF;

  RAISE NOTICE '  ok  the service role runs the workflow persistence operations, closures included';
END
$$;
RESET ROLE;
