-- ============================================================================
-- BP-003 — RLS, as the `authenticated` role actually experiences it.
--
-- `SET ROLE` and session-scoped `set_config`, the shape BP-002's RLS assertion
-- settled on after its first version used `SET LOCAL` outside a transaction —
-- which PostgreSQL warns about and ignores, so every query ran as the
-- superuser and the suite reported a result about nothing. The role switch is
-- ASSERTED below so that cannot happen again in either direction.
--
-- The claim is narrow and total: an authenticated member may READ its own
-- tenant's workflow state, and may write NOTHING, anywhere, by any route.
-- ============================================================================

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_user  UUID := '99999999-0000-4000-8000-000000000011';
  v_role  UUID;
  v_perm  UUID;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'alpha-workflow-operator@example.test')
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_role FROM public.roles WHERE key = 'org_admin' LIMIT 1;
  IF v_role IS NULL THEN
    INSERT INTO public.roles (key, name) VALUES ('org_admin', 'Org Admin') RETURNING id INTO v_role;
  END IF;

  SELECT id INTO v_perm FROM public.permissions WHERE key = 'workflows.read';
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'the workflows.read permission was not seeded by the RLS migration';
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_id)
  VALUES (v_role, v_perm) ON CONFLICT DO NOTHING;

  INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status)
  VALUES (v_alpha, v_user, v_role, 'active')
  ON CONFLICT DO NOTHING;
END
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000011', false);
SELECT set_config('request.jwt.claims',
  '{"sub":"99999999-0000-4000-8000-000000000011","app_metadata":{}}', false);

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_beta  UUID := '22222222-2222-4222-8222-222222222222';
  v_mine  INTEGER;
  v_yours INTEGER;
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'the role switch did not take: running as %', current_user;
  END IF;

  SELECT count(*) INTO v_mine FROM public.workflow_runs WHERE organization_id = v_alpha;
  IF v_mine = 0 THEN RAISE EXCEPTION 'a member cannot read its OWN tenant''s runs'; END IF;
  RAISE NOTICE '  ok  a member reads its own tenant''s runs (% visible)', v_mine;

  SELECT count(*) INTO v_mine FROM public.workflow_checkpoints WHERE organization_id = v_alpha;
  IF v_mine = 0 THEN RAISE EXCEPTION 'a member cannot read its OWN tenant''s checkpoints'; END IF;
  SELECT count(*) INTO v_mine FROM public.workflow_approvals WHERE organization_id = v_alpha;
  IF v_mine = 0 THEN RAISE EXCEPTION 'a member cannot read its OWN tenant''s approvals'; END IF;
  RAISE NOTICE '  ok  a member reads its own tenant''s checkpoints and approvals';

  SELECT count(*) INTO v_yours FROM public.workflow_runs WHERE organization_id = v_beta;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: % of Beta''s runs are visible', v_yours; END IF;
  SELECT count(*) INTO v_yours FROM public.workflow_checkpoints WHERE organization_id = v_beta;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta''s checkpoints are visible'; END IF;
  SELECT count(*) INTO v_yours FROM public.workflow_approvals WHERE organization_id = v_beta;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta''s approvals are visible'; END IF;

  -- And an unqualified read — no WHERE at all — still shows only Alpha's.
  SELECT count(*) INTO v_yours
    FROM public.workflow_runs WHERE organization_id <> v_alpha;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: an unqualified read crossed tenants'; END IF;
  RAISE NOTICE '  ok  no workflow table leaks another tenant''s rows';
END
$$;

-- ── AND THERE IS NO WRITE PATH AT ALL ──────────────────────────────────────
--
-- Not "writes are filtered by tenant" — there is no INSERT, UPDATE or DELETE
-- policy on any of these three tables. A person with UPDATE on
-- `workflow_approvals` can write `approved` into a request nobody decided.
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_rows  INTEGER;
BEGIN
  BEGIN
    INSERT INTO public.workflow_runs (
      organization_id, workflow_run_id, workflow_id, actor_id, state,
      run_version, checkpoint_version, created_at, updated_at, record
    ) VALUES (
      v_alpha, 'wfr_impostor', 'wf.x', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_impostor","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1}'::jsonb);
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

  -- ── AND CANNOT REACH THE ENGINE'S OWN FUNCTIONS ─────────────────────────
  --
  -- The table policies would be beside the point if the SECURITY DEFINER
  -- functions were executable by anybody.
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_viafn', 'wf.x', 'u', 'running', 1, 0, now(), now(), '{}'::jsonb);
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_run_create';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot create a run through the function';
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

  BEGIN
    PERFORM public.workflow_run_list(v_alpha, NULL, NULL, NULL, 50);
    RAISE EXCEPTION 'an authenticated member EXECUTED workflow_run_list';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member reads through RLS, not through the runtime';
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
  SELECT count(*) INTO v_count
    FROM public.workflow_run_list(v_alpha, NULL, NULL, NULL, 50);
  IF v_count = 0 THEN RAISE EXCEPTION 'the service role could not list runs'; END IF;

  SELECT count(*) INTO v_count
    FROM public.workflow_checkpoint_history(v_alpha, 'wfr_alpha');
  IF v_count = 0 THEN RAISE EXCEPTION 'the service role could not read the chain'; END IF;

  v_saved := public.workflow_run_save(
    v_alpha, 'wfr_alpha', 2, 'completed', 3, 1, now(),
    '{"context":{"workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","actorId":"user_alpha"},"state":"completed","runVersion":3}'::jsonb);
  IF v_saved <> 'saved' THEN RAISE EXCEPTION 'the service role could not advance a run: %', v_saved; END IF;

  RAISE NOTICE '  ok  the service role runs the workflow persistence operations';
END
$$;
RESET ROLE;
