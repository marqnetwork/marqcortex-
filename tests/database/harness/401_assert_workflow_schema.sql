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
      '{"context":{"workflowRunId":"wfr_SOMETHING_ELSE","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'a run row was stored whose columns disagree with its record';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a run row and its record cannot disagree about identity';
  END;

  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_versionlie', 'wf.x', 'u', 'running', 5, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_versionlie","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'a run row was stored whose version disagrees with its record';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a run row and its record cannot disagree about version';
  END;

  -- ── A state outside the engine's vocabulary ──────────────────────────────
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_badstate', 'wf.x', 'u', 'retrying', 1, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_badstate","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"retrying","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'a run was stored in a state the engine cannot produce';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a state outside WORKFLOW_RUN_STATES is refused';
  END;

  -- ── A run in an organization that does not exist ─────────────────────────
  BEGIN
    PERFORM public.workflow_run_create(
      '33333333-3333-4333-8333-333333333333', 'wfr_ghost', 'wf.x', 'u', 'running', 1, 0,
      now(), now(),
      '{"context":{"workflowRunId":"wfr_ghost","organizationId":"33333333-3333-4333-8333-333333333333","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
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

  -- ── AND AN APPROVED ONE CANNOT LACK ITS DECISION STAMP ───────────────────
  BEGIN
    PERFORM public.workflow_approval_create(
      v_alpha, 'wfa:unsigned', 'wfr_alpha', 'wf.review', 'gate', NULL, 'approved', 1,
      now(), now(), NULL, NULL, now(),
      '{"workflowApprovalId":"wfa:unsigned","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"approved","approvalVersion":1,"singleUse":true}'::jsonb);
    RAISE EXCEPTION 'an approval was approved with no decision stamp';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an approved request carries the moment somebody decided it';
  END;

  -- ── BUT expired AND withdrawn CARRY NEITHER STAMP, AND MUST PERSIST ──────
  --
  -- THE DEFECT THIS BLOCK EXISTS FOR. `workflowApprovalGate.close()` produces
  -- both states with `decidedAt` and `consumedAt` untouched, because neither
  -- closure is a decision. An earlier constraint here required every
  -- non-pending state to carry a stamp, which meant `expireIfDue()` and
  -- `withdraw()` could not be persisted at all — a workflow whose approval
  -- window closed would have failed to record it.
  PERFORM public.workflow_approval_create(
    v_alpha, 'wfa:timedout', 'wfr_alpha', 'wf.review', 'gate', NULL, 'expired', 2,
    now(), now(), NULL, NULL, now(),
    '{"workflowApprovalId":"wfa:timedout","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"expired","approvalVersion":2,"singleUse":true,"closureReason":"The decision window closed.","failure":"workflow_approval_expired"}'::jsonb);
  RAISE NOTICE '  ok  an EXPIRED approval persists with neither stamp';

  PERFORM public.workflow_approval_create(
    v_alpha, 'wfa:pulled', 'wfr_alpha', 'wf.review', 'gate', NULL, 'withdrawn', 2,
    now(), now(), NULL, NULL, now(),
    '{"workflowApprovalId":"wfa:pulled","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"withdrawn","approvalVersion":2,"singleUse":true,"closureReason":"The run ended."}'::jsonb);
  RAISE NOTICE '  ok  a WITHDRAWN approval persists with neither stamp';

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

  -- ── ...AND IT MAY NOT SIMPLY BE ABSENT ───────────────────────────────────
  --
  -- `(record -> 'singleUse')::text = 'true'` is NULL for a missing key, and a
  -- CHECK that evaluates to NULL PASSES. Written that way, the one field on
  -- this record that states a guarantee about itself could have been omitted.
  BEGIN
    PERFORM public.workflow_approval_create(
      v_alpha, 'wfa:silent', 'wfr_alpha', 'wf.review', 'gate', NULL, 'pending', 1,
      now(), now(), NULL, NULL, now(),
      '{"workflowApprovalId":"wfa:silent","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"pending","approvalVersion":1}'::jsonb);
    RAISE EXCEPTION 'an approval was stored with no singleUse field at all';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a MISSING singleUse is refused, not waved through as NULL';
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

-- ── A MISSING AUTHORITY FIELD IS A REFUSAL, NOT A NULL THAT PASSES ─────────
--
-- THE SECOND DEFECT THIS FILE EXISTS FOR. `record ->> 'k' = column` evaluates
-- to NULL when the key is absent, and PostgreSQL treats a NULL CHECK as
-- SATISFIED. Every agreement constraint was written that way, so a record with
-- no identity, no tenant and no version at all would have been stored — by the
-- very constraints whose job is to refuse exactly that.
--
-- Every case below is a record the engine cannot produce and the database must
-- not hold.
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_beta  UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  -- A run record with NO CONTEXT AT ALL.
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_nocontext', 'wf.x', 'u', 'running', 1, 0, now(), now(),
      '{"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'a run with no context was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a run record with no identity at all is refused';
  END;

  -- A run whose JSON names ANOTHER TENANT than its row.
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_wrongtenant', 'wf.x', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_wrongtenant","organizationId":"22222222-2222-4222-8222-222222222222","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: a row said Alpha while its record said Beta';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a record that says Beta cannot be stored on an Alpha row';
  END;

  -- A run with NO organizationId in its context — the case the old
  -- `IS NOT NULL` half-check was supposed to catch and the NULL semantics let
  -- through everywhere else.
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_notenant', 'wf.x', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_notenant","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'a run with no tenant in its record was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a run record with no tenant of its own is refused';
  END;

  -- A run whose record carries no version. Without a version its optimistic
  -- concurrency is meaningless, and the compare-and-swap would be arbitrating
  -- a number nothing else reads.
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_noversion', 'wf.x', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"workflowRunId":"wfr_noversion","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"running","checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'a run with no runVersion was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a run record with no version is refused';
  END;

  -- A run whose PROJECTED CHECKPOINT POINTER disagrees with its record. A row
  -- claiming a chain position its own record does not is a run that would
  -- resume from the wrong link.
  BEGIN
    PERFORM public.workflow_run_create(
      v_alpha, 'wfr_wrongpointer', 'wf.x', 'u', 'running', 1, 7, now(), now(),
      '{"context":{"workflowRunId":"wfr_wrongpointer","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.x","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":2}'::jsonb);
    RAISE EXCEPTION 'a run row and its record disagree about the checkpoint pointer';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  the checkpoint pointer is projected, so it is checked';
  END;

  -- A checkpoint whose record names another tenant.
  BEGIN
    PERFORM public.workflow_checkpoint_append(
      v_alpha, 'wfr_alpha', 5, 'd5', 'd4', 'n', 'running', now(),
      '{"workflowRunId":"wfr_alpha","organizationId":"22222222-2222-4222-8222-222222222222","version":5,"digest":"d5","previousDigest":"d4","nodeId":"n","state":"running"}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: a checkpoint row and its record disagree about the tenant';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a checkpoint record cannot name a tenant other than its row''s';
  END;

  -- A checkpoint with no digest in its record. The chain is the digests.
  BEGIN
    PERFORM public.workflow_checkpoint_append(
      v_alpha, 'wfr_alpha', 6, 'd6', 'd5', 'n', 'running', now(),
      '{"workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","version":6,"previousDigest":"d5","nodeId":"n","state":"running"}'::jsonb);
    RAISE EXCEPTION 'a checkpoint with no digest in its record was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a checkpoint record with no digest is refused';
  END;

  -- An approval whose record names another tenant.
  BEGIN
    PERFORM public.workflow_approval_create(
      v_alpha, 'wfa:crosstenant', 'wfr_alpha', 'wf.review', 'gate', NULL, 'pending', 1,
      now(), now(), NULL, NULL, now(),
      '{"workflowApprovalId":"wfa:crosstenant","workflowRunId":"wfr_alpha","organizationId":"22222222-2222-4222-8222-222222222222","workflowId":"wf.review","nodeId":"gate","approvalState":"pending","approvalVersion":1,"singleUse":true}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: an approval row and its record disagree about the tenant';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an approval record cannot name a tenant other than its row''s';
  END;

  -- An approval whose record disagrees with its row about the version — the
  -- number the single-use guarantee is arbitrated on.
  BEGIN
    PERFORM public.workflow_approval_create(
      v_alpha, 'wfa:versionlie', 'wfr_alpha', 'wf.review', 'gate', NULL, 'pending', 3,
      now(), now(), NULL, NULL, now(),
      '{"workflowApprovalId":"wfa:versionlie","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","approvalState":"pending","approvalVersion":1,"singleUse":true}'::jsonb);
    RAISE EXCEPTION 'an approval row and its record disagree about the version';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an approval row and its record cannot disagree about version';
  END;

  -- An approval whose record disagrees about the branch it belongs to. NULL on
  -- one side and a value on the other is a disagreement, not a match.
  BEGIN
    PERFORM public.workflow_approval_create(
      v_alpha, 'wfa:branchlie', 'wfr_alpha', 'wf.review', 'gate', NULL, 'pending', 1,
      now(), now(), NULL, NULL, now(),
      '{"workflowApprovalId":"wfa:branchlie","workflowRunId":"wfr_alpha","organizationId":"11111111-1111-4111-8111-111111111111","workflowId":"wf.review","nodeId":"gate","branchId":"branch_enrichment","approvalState":"pending","approvalVersion":1,"singleUse":true}'::jsonb);
    RAISE EXCEPTION 'a main-line approval row carried a branch record';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  branch identity agrees on both sides, NULL included';
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
