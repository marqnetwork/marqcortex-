-- ============================================================================
-- BP-003 — the constraints, as the database actually enforces them.
--
-- Each block asserts that a shape the workflow engine cannot produce is a
-- shape the DATABASE cannot hold. A static read of the migration can show a
-- CHECK was declared; only this can show it fires.
-- ============================================================================

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_beta  UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  -- ── A run whose projection disagrees with its own payload ────────────────
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_liar', 'wf.x', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_SOMETHING_ELSE","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1}'::jsonb);
    RAISE EXCEPTION 'a run row was stored whose columns disagree with its record';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a run row and its record cannot disagree about identity';
  END;

  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_versionlie', 'wf.x', 'u', 'running', 5, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_versionlie","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1}'::jsonb);
    RAISE EXCEPTION 'a run row was stored whose version disagrees with its record';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a run row and its record cannot disagree about version';
  END;

  -- ── A state outside the engine's vocabulary ──────────────────────────────
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_badstate', 'wf.x', 'u', 'retrying', 1, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_badstate","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"retrying","runVersion":1}'::jsonb);
    RAISE EXCEPTION 'a run was stored in a state the engine cannot produce';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a state outside WORKFLOW_RUN_STATES is refused';
  END;

  -- ── A run in an organization that does not exist ─────────────────────────
  BEGIN
    PERFORM public.workflow_run_create(
      '33333333-3333-4333-8333-333333333333', 'wfr_ghost', 'wf.x', 'u', 'running', 1, 0,
      now(), now(),
      '{"context":{"workflowRunId":"wfr_ghost","organizationId":"33333333-3333-4333-8333-333333333333","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1}'::jsonb);
    RAISE EXCEPTION 'a run was stored for an organization that does not exist';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  a run cannot belong to an organization that does not exist';
  END;

  -- ── A CROSS-TENANT CHECKPOINT IS UNREPRESENTABLE ─────────────────────────
  --
  -- Beta naming Alpha's run. The referenced key carries the organization, so
  -- this is not rejected by a rule — there is no row it could point at.
  BEGIN
    PERFORM public.workflow_checkpoint_append(
      v_beta, 'wfr_alpha', 1, 'x', NULL, 'n', 'running', now(),
      '{"workflowRunId":"wfr_alpha","organizationId":"22222222-2222-4222-8222-222222222222","version":1,"digest":"x","nodeId":"n","state":"running"}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: Beta wrote a checkpoint against Alpha''s run';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  a cross-tenant checkpoint reference is unrepresentable';
  END;

  -- ── A CROSS-TENANT APPROVAL IS UNREPRESENTABLE ───────────────────────────
  BEGIN
    PERFORM public.workflow_approval_create(
      v_beta, 'wfa:stolen', 'wfr_alpha', 'wf.review', 'gate', NULL, 'pending', 1,
      now(), now(), NULL, NULL, now(),
      '{"workflowApprovalId":"wfa:stolen","workflowRunId":"wfr_alpha","organizationId":"22222222-2222-4222-8222-222222222222","workflowId":"wf.review","nodeId":"gate","approvalState":"pending","approvalVersion":1,"singleUse":true}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: Beta requested an approval against Alpha''s run';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  a cross-tenant approval reference is unrepresentable';
  END;

  -- ── THE CHAIN IS COHERENT OR IT IS NOT STORED ────────────────────────────
  BEGIN
    PERFORM public.workflow_checkpoint_append(
      v_alpha, 'wfr_alpha', 2, 'digest_2', NULL, 'node_two', 'running', now(),
      '{"workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","version":2,"digest":"digest_2","nodeId":"node_two","state":"running"}'::jsonb);
    RAISE EXCEPTION 'a checkpoint past version 1 was stored with no previous digest';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a link in the chain must name the link before it';
  END;

  BEGIN
    PERFORM public.workflow_checkpoint_append(
      v_alpha, 'wfr_alpha', 1, 'other', 'digest_0', 'node_one', 'running', now(),
      '{"workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","version":1,"digest":"other","previousDigest":"digest_0","nodeId":"node_one","state":"running"}'::jsonb);
    RAISE EXCEPTION 'checkpoint version 1 was stored with a predecessor';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  the first link opens the chain and has no predecessor';
  END;

  -- ── AN APPROVAL CANNOT BE CONSUMED WITHOUT HAVING BEEN DECIDED ───────────
  BEGIN
    PERFORM public.workflow_approval_create(
      v_alpha, 'wfa:unspoken', 'wfr_alpha', 'wf.review', 'gate', NULL, 'consumed', 1,
      now(), now(), NULL, now(), now(),
      '{"workflowApprovalId":"wfa:unspoken","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"consumed","approvalVersion":1,"singleUse":true}'::jsonb);
    RAISE EXCEPTION 'an approval was consumed that nobody decided';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an approval cannot be spent without having been decided';
  END;

  -- ── AND singleUse IS NOT ADVISORY ────────────────────────────────────────
  BEGIN
    PERFORM public.workflow_approval_create(
      v_alpha, 'wfa:reusable', 'wfr_alpha', 'wf.review', 'gate', NULL, 'pending', 1,
      now(), now(), NULL, NULL, now(),
      '{"workflowApprovalId":"wfa:reusable","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"pending","approvalVersion":1,"singleUse":false}'::jsonb);
    RAISE EXCEPTION 'an approval was stored claiming it was not single use';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a stored approval always says it is single use';
  END;

  -- ── AN UNBOUNDED PAYLOAD ─────────────────────────────────────────────────
  BEGIN
    PERFORM public.workflow_approval_create(
      v_alpha, 'wfa:huge', 'wfr_alpha', 'wf.review', 'gate', NULL, 'pending', 1,
      now(), now(), NULL, NULL, now(),
      jsonb_build_object(
        'workflowApprovalId', 'wfa:huge', 'workflowRunId', 'wfr_alpha',
        'organizationId', '11111111-1111-4111-8111-111111111111',
        'workflowId', 'wf.review', 'nodeId', 'gate',
        'approvalState', 'pending', 'approvalVersion', 1, 'singleUse', true,
        -- An approval carries identifiers and two bounded strings. A field
        -- holding a hundred kilobytes is business content on a record that
        -- exists not to carry any.
        'smuggled', repeat('x', 200000)));
    RAISE EXCEPTION 'an oversized approval payload was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an oversized approval payload is refused';
  END;
END
$$;

-- ── AND A WRITTEN CHECKPOINT CANNOT BE EDITED BY ANYTHING ──────────────────
--
-- Not "the store has no update method" — that is a statement about the
-- runtime. This is the statement about the database, and it is the one the
-- digest chain actually needs.
DO $$
BEGIN
  BEGIN
    UPDATE public.workflow_checkpoints
       SET digest = 'tampered'
     WHERE workflow_run_id = 'wfr_alpha' AND version = 1;
    RAISE EXCEPTION 'a written checkpoint was rewritten';
  EXCEPTION WHEN restrict_violation THEN
    RAISE NOTICE '  ok  a written checkpoint cannot be rewritten, by anything';
  END;
END
$$;
