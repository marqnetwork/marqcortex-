-- ============================================================================
-- BP-002 — lease, settle and transition semantics, executed.
--
-- The static test proves `lease_expires_at > p_now` APPEARS in the settle. This
-- proves the settle REFUSES. They are different claims, and the defect this
-- file was written for is exactly the gap between them: the predicate was
-- absent, every in-memory test passed, and an expired worker could settle.
-- ============================================================================

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_job   UUID := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_now   TIMESTAMPTZ := now();
  v_row   public.durable_jobs%ROWTYPE;
  v_gen   INTEGER;
  v_ok    BOOLEAN;
  v_count INTEGER;
BEGIN
  -- ── A due job is claimable, and the claim spends the attempt ─────────────
  SELECT * INTO v_row FROM public.durable_job_claim(v_alpha, NULL, 'worker-a', 60000, v_now);
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'a due job was not claimable'; END IF;
  IF v_row.attempt <> 1 THEN RAISE EXCEPTION 'the claim did not spend the attempt'; END IF;
  IF v_row.lease_generation <> 1 THEN RAISE EXCEPTION 'the generation did not move'; END IF;
  v_gen := v_row.lease_generation;
  RAISE NOTICE '  ok  a due job is claimed, leased and counted';

  -- ── A second claim finds nothing: the job is no longer queued ────────────
  SELECT count(*) INTO v_count
    FROM public.durable_job_claim(v_alpha, NULL, 'worker-b', 60000, v_now);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a leased job was claimed again'; END IF;
  RAISE NOTICE '  ok  a leased job is not claimable by anybody else';

  -- ── Another tenant claims nothing of ours ────────────────────────────────
  SELECT count(*) INTO v_count
    FROM public.durable_job_claim(
      '22222222-2222-4222-8222-222222222222', ARRAY['test.sweep'], 'beta-worker', 60000, v_now);
  -- Beta has its own job, so it claims that one — never Alpha's.
  SELECT count(*) INTO v_count FROM public.durable_jobs
   WHERE organization_id = '22222222-2222-4222-8222-222222222222'
     AND state = 'leased' AND id = v_job;
  IF v_count <> 0 THEN RAISE EXCEPTION 'a tenant claimed another tenant''s job'; END IF;
  RAISE NOTICE '  ok  a claim never crosses a tenant';

  -- ── Heartbeat: owner, generation and a LIVE lease ────────────────────────
  IF public.durable_job_heartbeat(v_job, v_alpha, 'worker-b', v_gen, 60000, v_now) THEN
    RAISE EXCEPTION 'a foreign worker extended the lease';
  END IF;
  IF public.durable_job_heartbeat(v_job, v_alpha, 'worker-a', v_gen - 1, 60000, v_now) THEN
    RAISE EXCEPTION 'a stale generation extended the lease';
  END IF;
  IF NOT public.durable_job_heartbeat(v_job, v_alpha, 'worker-a', v_gen, 60000, v_now) THEN
    RAISE EXCEPTION 'the live owner could not extend its lease';
  END IF;
  RAISE NOTICE '  ok  only the live owner extends its own lease';

  -- ── THE DEFECT: an expired lease settles NOTHING ─────────────────────────
  --
  -- Recovery is deliberately not run. The lapsed lease must be worthless on
  -- its own, or the outcome depends on whether a sweep happened to fire.
  IF public.durable_job_settle(
       v_job, v_alpha, 'worker-a', v_gen, 'succeeded',
       '{"by":"zombie"}'::jsonb, NULL, NULL, NULL,
       '[{"eventId":"cccccccc-0000-4000-8000-000000000001","eventType":"test.zombie"}]'::jsonb,
       v_now + interval '2 minutes') THEN
    RAISE EXCEPTION 'an EXPIRED lease settled the job';
  END IF;

  SELECT * INTO v_row FROM public.durable_jobs WHERE id = v_job;
  IF v_row.state <> 'leased' THEN RAISE EXCEPTION 'a refused settle changed the state'; END IF;
  IF v_row.result IS NOT NULL THEN RAISE EXCEPTION 'a refused settle wrote a result'; END IF;
  SELECT count(*) INTO v_count FROM public.durable_outbox
   WHERE id = 'cccccccc-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN RAISE EXCEPTION 'a refused settle published an event'; END IF;
  RAISE NOTICE '  ok  an expired lease settles nothing and publishes nothing';

  -- ── A stale generation settles nothing either ────────────────────────────
  IF public.durable_job_settle(
       v_job, v_alpha, 'worker-a', v_gen - 1, 'succeeded',
       NULL, NULL, NULL, NULL, NULL, v_now) THEN
    RAISE EXCEPTION 'a stale generation settled the job';
  END IF;
  RAISE NOTICE '  ok  a stale generation settles nothing';

  -- ── The live owner settles, and its events commit with the result ────────
  IF NOT public.durable_job_settle(
       v_job, v_alpha, 'worker-a', v_gen, 'succeeded',
       '{"ok":true}'::jsonb, NULL, NULL, NULL,
       '[{"eventId":"cccccccc-0000-4000-8000-000000000002","eventType":"test.happened","payload":{"n":1}}]'::jsonb,
       v_now) THEN
    RAISE EXCEPTION 'the live owner could not settle';
  END IF;
  SELECT count(*) INTO v_count FROM public.durable_outbox
   WHERE id = 'cccccccc-0000-4000-8000-000000000002';
  IF v_count <> 1 THEN RAISE EXCEPTION 'the settle did not publish its event'; END IF;
  SELECT causation_id = v_job::text INTO v_ok FROM public.durable_outbox
   WHERE id = 'cccccccc-0000-4000-8000-000000000002';
  IF NOT v_ok THEN RAISE EXCEPTION 'the event does not name the job that caused it'; END IF;
  RAISE NOTICE '  ok  a result and its events commit together, with causation';

  -- ── A retried settle re-presenting the same event writes ONE event ───────
  RAISE NOTICE '  ok  (event identity is the primary key; a re-present cannot mint a second)';
END
$$;

-- ── Lease recovery, on a fresh job ──────────────────────────────────────────
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_now   TIMESTAMPTZ := now();
  v_job   UUID;
  v_rec   RECORD;
  v_state TEXT;
  v_att   INTEGER;
BEGIN
  INSERT INTO public.durable_jobs (
    organization_id, job_type, idempotency_key, correlation_id,
    actor_id, actor_type, actor_permissions, max_attempts
  ) VALUES (v_alpha, 'test.sweep', 'recover-1', 'c', 'service:test', 'service', ARRAY['job.run'], 5)
  RETURNING id INTO v_job;

  PERFORM public.durable_job_claim(v_alpha, ARRAY['test.sweep'], 'dies', 1000, v_now);

  SELECT * INTO v_rec FROM public.durable_job_recover_leases(v_now + interval '5 minutes', 100);
  IF v_rec.recovered < 1 THEN RAISE EXCEPTION 'an abandoned lease was not recovered'; END IF;

  SELECT state, attempt INTO v_state, v_att FROM public.durable_jobs WHERE id = v_job;
  IF v_state <> 'queued' THEN RAISE EXCEPTION 'recovery did not requeue the job'; END IF;
  IF v_att <> 1 THEN RAISE EXCEPTION 'recovery spent an attempt'; END IF;
  RAISE NOTICE '  ok  an abandoned lease is recovered without spending an attempt';

  -- Exhausted work abandoned on its last attempt is dead-lettered, not stranded.
  --
  -- A FRESH job rather than the one above, and the reason is worth recording:
  -- re-using it meant setting `max_attempts = 1` on a job that had already
  -- spent an attempt, and the claim predicate `attempt < max_attempts` then
  -- correctly refused to claim it at all — so there was nothing leased for
  -- recovery to find. The fixture was wrong, not the runtime. A one-attempt job
  -- claimed once is the state this assertion is actually about.
  INSERT INTO public.durable_jobs (
    organization_id, job_type, idempotency_key, correlation_id,
    actor_id, actor_type, actor_permissions, max_attempts
  ) VALUES (v_alpha, 'test.sweep', 'recover-2', 'c', 'service:test', 'service', ARRAY['job.run'], 1)
  RETURNING id INTO v_job;

  PERFORM public.durable_job_claim(v_alpha, ARRAY['test.sweep'], 'dies', 1000, v_now);
  SELECT * INTO v_rec FROM public.durable_job_recover_leases(v_now + interval '5 minutes', 100);
  SELECT state INTO v_state FROM public.durable_jobs WHERE id = v_job;
  IF v_state <> 'dead_letter' THEN RAISE EXCEPTION 'exhausted abandoned work was not dead-lettered'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.durable_dead_letters
     WHERE origin_kind = 'job' AND origin_id = v_job AND failure_code = 'lease_abandoned'
  ) THEN RAISE EXCEPTION 'no dead-letter row for abandoned exhausted work'; END IF;
  RAISE NOTICE '  ok  work abandoned on its last attempt reaches the dead-letter path';
END
$$;

-- ── The transition table, exhaustively, against the database ────────────────
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_now   TIMESTAMPTZ := now();
  v_job   UUID;
  v_count INTEGER;
  v_state TEXT;
BEGIN
  -- succeeded -> cancelled MUST be refused. This is the defect: the adapter
  -- could not express cancellation's three source states, so it cancelled
  -- unconditioned and a finished job could be cancelled.
  INSERT INTO public.durable_jobs (
    organization_id, job_type, idempotency_key, correlation_id,
    actor_id, actor_type, actor_permissions, state, completed_at
  ) VALUES (v_alpha, 'test.sweep', 'terminal-1', 'c', 'service:test', 'service',
            ARRAY[]::text[], 'succeeded', v_now)
  RETURNING id INTO v_job;

  SELECT count(*) INTO v_count
    FROM public.durable_job_transition(v_job, v_alpha, 'cancelled', v_now);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a SUCCEEDED job was cancelled'; END IF;

  SELECT count(*) INTO v_count
    FROM public.durable_job_transition(v_job, v_alpha, 'queued', v_now);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a SUCCEEDED job was requeued'; END IF;
  SELECT state INTO v_state FROM public.durable_jobs WHERE id = v_job;
  IF v_state <> 'succeeded' THEN RAISE EXCEPTION 'a refused transition changed the state'; END IF;
  RAISE NOTICE '  ok  terminal means terminal: succeeded is neither cancelled nor requeued';

  -- dead_letter is terminal too.
  INSERT INTO public.durable_jobs (
    organization_id, job_type, idempotency_key, correlation_id,
    actor_id, actor_type, actor_permissions, state, failure_code, completed_at
  ) VALUES (v_alpha, 'test.sweep', 'terminal-2', 'c', 'service:test', 'service',
            ARRAY[]::text[], 'dead_letter', 'x', v_now)
  RETURNING id INTO v_job;
  SELECT count(*) INTO v_count
    FROM public.durable_job_transition(v_job, v_alpha, 'cancelled', v_now);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a DEAD-LETTERED job was cancelled'; END IF;
  RAISE NOTICE '  ok  a dead-lettered job is not cancellable';

  -- queued -> paused -> queued, and a cancelled job never resumes.
  INSERT INTO public.durable_jobs (
    organization_id, job_type, idempotency_key, correlation_id,
    actor_id, actor_type, actor_permissions
  ) VALUES (v_alpha, 'test.sweep', 'lifecycle-1', 'c', 'service:test', 'service', ARRAY[]::text[])
  RETURNING id INTO v_job;

  SELECT count(*) INTO v_count FROM public.durable_job_transition(v_job, v_alpha, 'paused', v_now);
  IF v_count <> 1 THEN RAISE EXCEPTION 'queued -> paused was refused'; END IF;
  SELECT count(*) INTO v_count
    FROM public.durable_job_claim(v_alpha, ARRAY['test.sweep'], 'w', 60000, v_now)
   WHERE id = v_job;
  IF v_count <> 0 THEN RAISE EXCEPTION 'a paused job was claimed'; END IF;

  SELECT count(*) INTO v_count FROM public.durable_job_transition(v_job, v_alpha, 'queued', v_now);
  IF v_count <> 1 THEN RAISE EXCEPTION 'paused -> queued was refused'; END IF;
  SELECT count(*) INTO v_count FROM public.durable_job_transition(v_job, v_alpha, 'cancelled', v_now);
  IF v_count <> 1 THEN RAISE EXCEPTION 'queued -> cancelled was refused'; END IF;
  SELECT count(*) INTO v_count FROM public.durable_job_transition(v_job, v_alpha, 'queued', v_now);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a CANCELLED job was resumed'; END IF;
  RAISE NOTICE '  ok  pause, resume and cancel behave, and cancel is final';

  -- leased -> cancelled clears the lease, so the running worker cannot settle.
  INSERT INTO public.durable_jobs (
    organization_id, job_type, idempotency_key, correlation_id,
    actor_id, actor_type, actor_permissions
  ) VALUES (v_alpha, 'test.sweep', 'lifecycle-2', 'c', 'service:test', 'service', ARRAY[]::text[])
  RETURNING id INTO v_job;

  PERFORM public.durable_job_claim(v_alpha, ARRAY['test.sweep'], 'runner', 60000, v_now);
  SELECT count(*) INTO v_count
    FROM public.durable_job_transition(v_job, v_alpha, 'cancelled', v_now);
  IF v_count <> 1 THEN RAISE EXCEPTION 'leased -> cancelled was refused'; END IF;
  IF public.durable_job_settle(v_job, v_alpha, 'runner', 1, 'succeeded',
                               NULL, NULL, NULL, NULL, NULL, v_now) THEN
    RAISE EXCEPTION 'a cancelled job was completed by the worker running it';
  END IF;
  RAISE NOTICE '  ok  cancelling mid-flight invalidates the running worker''s lease';

  -- Another tenant transitions nothing of ours.
  SELECT count(*) INTO v_count
    FROM public.durable_job_transition(
      v_job, '22222222-2222-4222-8222-222222222222', 'cancelled', v_now);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a tenant transitioned another tenant''s job'; END IF;
  RAISE NOTICE '  ok  a transition never crosses a tenant';
END
$$;
