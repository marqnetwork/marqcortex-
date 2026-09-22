-- ============================================================================
-- A2-P07 — the agent constraints, as the database actually enforces them.
--
-- Two kinds of block: a shape the agent runtime cannot produce is a shape the
-- database refuses, AND a shape the agent runtime DOES produce — where it
-- differs from the workflow runtime — is a shape the database accepts.
-- ============================================================================

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_beta  UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  -- ── Projection and payload disagree ──────────────────────────────────────
  BEGIN
    PERFORM public.agent_run_create(
      v_alpha, 'run_liar', 'a', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"runId":"run_SOMETHING_ELSE","organizationId":"11111111-1111-4111-8111-111111111111","agentId":"a","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'an agent run row was stored whose columns disagree with its record';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an agent run row and its record cannot disagree about identity';
  END;

  BEGIN
    PERFORM public.agent_run_create(
      v_alpha, 'run_versionlie', 'a', 'u', 'running', 5, 0, now(), now(),
      '{"context":{"runId":"run_versionlie","organizationId":"11111111-1111-4111-8111-111111111111","agentId":"a","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'an agent run row was stored whose version disagrees with its record';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an agent run row and its record cannot disagree about version';
  END;

  BEGIN
    PERFORM public.agent_run_create(
      v_alpha, 'run_wrongtenant', 'a', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"runId":"run_wrongtenant","organizationId":"22222222-2222-4222-8222-222222222222","agentId":"a","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: an Alpha row carried a record that says Beta';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a record that says Beta cannot be stored on an Alpha row';
  END;

  BEGIN
    PERFORM public.agent_run_create(
      v_alpha, 'run_nocontext', 'a', 'u', 'running', 1, 0, now(), now(),
      '{"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'an agent run with no context was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an agent run record with no identity at all is refused, not waved through as NULL';
  END;

  BEGIN
    PERFORM public.agent_run_create(
      v_alpha, 'run_badstate', 'a', 'u', 'waiting_for_branches', 1, 0, now(), now(),
      '{"context":{"runId":"run_badstate","organizationId":"11111111-1111-4111-8111-111111111111","agentId":"a","actorId":"u"},"state":"waiting_for_branches","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'an agent run was stored in a workflow-only state';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a state outside AGENT_RUN_STATES is refused';
  END;

  -- `retrying` and `waiting_for_budget` are agent states the workflow tables
  -- do not know. They must persist here.
  PERFORM public.agent_run_create(
    v_alpha, 'run_retrying', 'a', 'u', 'retrying', 1, 0, now(), now(),
    '{"context":{"runId":"run_retrying","organizationId":"11111111-1111-4111-8111-111111111111","agentId":"a","actorId":"u"},"state":"retrying","runVersion":1,"checkpointVersion":0}'::jsonb);
  RAISE NOTICE '  ok  an agent-only state (retrying) persists';

  BEGIN
    PERFORM public.agent_run_create(
      '33333333-3333-4333-8333-333333333333', 'run_ghost', 'a', 'u', 'running', 1, 0, now(), now(),
      '{"context":{"runId":"run_ghost","organizationId":"33333333-3333-4333-8333-333333333333","agentId":"a","actorId":"u"},"state":"running","runVersion":1,"checkpointVersion":0}'::jsonb);
    RAISE EXCEPTION 'an agent run was stored for an organization that does not exist';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  an agent run cannot belong to an organization that does not exist';
  END;

  -- ── Cross-tenant references are unrepresentable ──────────────────────────
  BEGIN
    PERFORM public.agent_checkpoint_append(
      v_beta, 'run_alpha', 1, 'x', NULL, 'a', 'running', 0, now(),
      '{"runId":"run_alpha","organizationId":"22222222-2222-4222-8222-222222222222","version":1,"progressDigest":"x","agentId":"a","state":"running","stepCount":0}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: Beta wrote a checkpoint against Alpha''s run';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  a cross-tenant checkpoint reference is unrepresentable';
  END;

  BEGIN
    PERFORM public.agent_approval_create(
      v_beta, 'apr_stolen', 'run_alpha', 'act', 'a', 'pending', 1, now(), now(), NULL, NULL, now(),
      '{"approvalId":"apr_stolen","runId":"run_alpha","actionId":"act","organizationId":"22222222-2222-4222-8222-222222222222","requestingAgentId":"a","state":"pending","approvalVersion":1,"singleUse":true,"expiresAt":"x"}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: Beta requested an approval against Alpha''s run';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  a cross-tenant approval reference is unrepresentable';
  END;

  BEGIN
    PERFORM public.agent_checkpoint_append(
      v_alpha, 'run_alpha', 7, 'p7', 'p6', 'a', 'running', 3, now(),
      '{"runId":"run_alpha","organizationId":"22222222-2222-4222-8222-222222222222","version":7,"progressDigest":"p7","previousDigest":"p6","agentId":"a","state":"running","stepCount":3}'::jsonb);
    RAISE EXCEPTION 'TENANT BREACH: a checkpoint row and its record disagree about the tenant';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a checkpoint record cannot name a tenant other than its row''s';
  END;

  BEGIN
    PERFORM public.agent_checkpoint_append(
      v_alpha, 'run_alpha', 8, 'p8', NULL, 'a', 'running', 3, now(),
      '{"runId":"run_alpha","organizationId":"11111111-1111-4111-8111-111111111111","version":8,"agentId":"a","state":"running","stepCount":3}'::jsonb);
    RAISE EXCEPTION 'a checkpoint with no progress digest in its record was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a checkpoint record with no progress digest is refused';
  END;

  -- ── THE AGENT CHAIN IS NOT THE WORKFLOW CHAIN ────────────────────────────
  --
  -- After a crash between a checkpoint write and the pointer save, `latest()`
  -- can name a link ahead of the pointer, and the next write chains from it.
  -- A version-2 checkpoint with no predecessor, and one whose predecessor is
  -- not version 1, are both shapes `writeCheckpoint` can produce.
  PERFORM public.agent_checkpoint_append(
    v_alpha, 'run_alpha', 2, 'pdigest_2', 'pdigest_9', 'agent.primary', 'running', 1, now(),
    '{"runId":"run_alpha","organizationId":"11111111-1111-4111-8111-111111111111","version":2,"progressDigest":"pdigest_2","previousDigest":"pdigest_9","agentId":"agent.primary","state":"running","stepCount":1}'::jsonb);
  RAISE NOTICE '  ok  an agent checkpoint may chain from whatever latest() named';

  -- ── THE APPROVAL LIFECYCLE THE AGENT GATE ACTUALLY WRITES ────────────────
  BEGIN
    PERFORM public.agent_approval_create(
      v_alpha, 'apr_unspoken', 'run_alpha', 'act', 'a', 'consumed', 1, now(), now(), NULL, now(), now(),
      '{"approvalId":"apr_unspoken","runId":"run_alpha","actionId":"act","organizationId":"11111111-1111-4111-8111-111111111111","requestingAgentId":"a","state":"consumed","approvalVersion":1,"singleUse":true,"expiresAt":"x","consumedAt":"x"}'::jsonb);
    RAISE EXCEPTION 'an approval was consumed that nobody decided';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an agent approval cannot be spent without having been decided';
  END;

  BEGIN
    PERFORM public.agent_approval_create(
      v_alpha, 'apr_quiet', 'run_alpha', 'act', 'a', 'expired', 2, now(), now(), NULL, NULL, now(),
      '{"approvalId":"apr_quiet","runId":"run_alpha","actionId":"act","organizationId":"11111111-1111-4111-8111-111111111111","requestingAgentId":"a","state":"expired","approvalVersion":2,"singleUse":true,"expiresAt":"x"}'::jsonb);
    RAISE EXCEPTION 'an agent approval expired with no stamp — the agent gate always stamps expiry';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an EXPIRED agent approval must carry the stamp expire() writes';
  END;

  -- `expire()` on a request that was already spent keeps its consumedAt.
  PERFORM public.agent_approval_create(
    v_alpha, 'apr_spent_then_due', 'run_alpha', 'act', 'a', 'expired', 4, now(), now(), now(), now(), now(),
    '{"approvalId":"apr_spent_then_due","runId":"run_alpha","actionId":"act","organizationId":"11111111-1111-4111-8111-111111111111","requestingAgentId":"a","state":"expired","approvalVersion":4,"singleUse":true,"expiresAt":"x","decidedAt":"x","consumedAt":"x"}'::jsonb);
  RAISE NOTICE '  ok  an expired-after-spent agent approval persists, as the gate writes it';

  BEGIN
    PERFORM public.agent_approval_create(
      v_alpha, 'apr_withdrawn', 'run_alpha', 'act', 'a', 'withdrawn', 2, now(), now(), NULL, NULL, now(),
      '{"approvalId":"apr_withdrawn","runId":"run_alpha","actionId":"act","organizationId":"11111111-1111-4111-8111-111111111111","requestingAgentId":"a","state":"withdrawn","approvalVersion":2,"singleUse":true,"expiresAt":"x"}'::jsonb);
    RAISE EXCEPTION 'an agent approval was stored in a workflow-only state';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  withdrawn is a workflow state and is refused here';
  END;

  BEGIN
    PERFORM public.agent_approval_create(
      v_alpha, 'apr_stamplie', 'run_alpha', 'act', 'a', 'approved', 2, now(), now(), now(), NULL, now(),
      '{"approvalId":"apr_stamplie","runId":"run_alpha","actionId":"act","organizationId":"11111111-1111-4111-8111-111111111111","requestingAgentId":"a","state":"approved","approvalVersion":2,"singleUse":true,"expiresAt":"x"}'::jsonb);
    RAISE EXCEPTION 'an approval row said decided while its record said undecided';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  the decision stamp agrees with the record about being present';
  END;

  BEGIN
    PERFORM public.agent_approval_create(
      v_alpha, 'apr_silent', 'run_alpha', 'act', 'a', 'pending', 1, now(), now(), NULL, NULL, now(),
      '{"approvalId":"apr_silent","runId":"run_alpha","actionId":"act","organizationId":"11111111-1111-4111-8111-111111111111","requestingAgentId":"a","state":"pending","approvalVersion":1,"expiresAt":"x"}'::jsonb);
    RAISE EXCEPTION 'an approval was stored with no singleUse field';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a MISSING singleUse is refused, not waved through as NULL';
  END;

  BEGIN
    PERFORM public.agent_approval_create(
      v_alpha, 'apr_huge', 'run_alpha', 'act', 'a', 'pending', 1, now(), now(), NULL, NULL, now(),
      jsonb_build_object(
        'approvalId', 'apr_huge', 'runId', 'run_alpha', 'actionId', 'act',
        'organizationId', '11111111-1111-4111-8111-111111111111', 'requestingAgentId', 'a',
        'state', 'pending', 'approvalVersion', 1, 'singleUse', true, 'expiresAt', 'x',
        'smuggled', repeat('x', 200000)));
    RAISE EXCEPTION 'an oversized approval payload was stored';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an oversized approval payload is refused';
  END;
END
$$;

-- ── A WRITTEN CHECKPOINT CANNOT BE EDITED, BY ANYTHING ─────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.agent_checkpoints SET progress_digest = 'tampered'
     WHERE agent_run_id = 'run_alpha' AND version = 1;
    RAISE EXCEPTION 'a written agent checkpoint was rewritten';
  EXCEPTION WHEN restrict_violation THEN
    RAISE NOTICE '  ok  a written agent checkpoint cannot be rewritten, by anything';
  END;
END
$$;
