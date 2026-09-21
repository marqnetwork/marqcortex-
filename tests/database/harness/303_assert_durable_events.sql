-- ============================================================================
-- BP-002 — outbox and inbox durability, executed.
--
-- Four defects are proven fixed here, and each one was invisible to every
-- in-memory test because the adapter and the reference store disagreed:
--
--   backoff was not honoured on the Postgres path
--   an abandoned dispatch lease stranded the event forever
--   an expired dispatcher could still complete the event
--   failure and dead-letter were two round trips with a gap between them
-- ============================================================================

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_now   TIMESTAMPTZ := now();
  v_event UUID;
  v_gen   INTEGER;
  v_count INTEGER;
  v_rec   RECORD;
  v_state TEXT;
BEGIN
  INSERT INTO public.durable_outbox (
    organization_id, event_type, actor_id, actor_type, correlation_id, source,
    max_attempts, available_at
  ) VALUES (v_alpha, 'test.happened', 'service:test', 'service', 'corr-alpha', 'test', 5, v_now)
  RETURNING id INTO v_event;

  -- ── A due event is claimed, once ────────────────────────────────────────
  SELECT lease_generation INTO v_gen
    FROM public.durable_outbox_claim(v_alpha, 'd1', 30000, v_now, 10) LIMIT 1;
  IF v_gen IS NULL THEN RAISE EXCEPTION 'a due event was not claimable'; END IF;

  SELECT count(*) INTO v_count FROM public.durable_outbox_claim(v_alpha, 'd2', 30000, v_now, 10);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a dispatching event was claimed again'; END IF;
  RAISE NOTICE '  ok  a due event is leased by exactly one dispatcher';

  -- ── A stale dispatcher settles nothing ──────────────────────────────────
  SELECT settled INTO v_state
    FROM public.durable_outbox_settle(v_alpha, v_event, 'd2', v_gen, true, NULL, NULL, NULL, v_now);
  IF v_state::boolean THEN RAISE EXCEPTION 'a foreign dispatcher marked the event dispatched'; END IF;

  SELECT settled INTO v_state
    FROM public.durable_outbox_settle(
      v_alpha, v_event, 'd1', v_gen - 1, true, NULL, NULL, NULL, v_now);
  IF v_state::boolean THEN RAISE EXCEPTION 'a stale generation marked the event dispatched'; END IF;

  -- EXPIRED, before recovery has run.
  SELECT settled INTO v_state
    FROM public.durable_outbox_settle(
      v_alpha, v_event, 'd1', v_gen, true, NULL, NULL, NULL, v_now + interval '1 hour');
  IF v_state::boolean THEN RAISE EXCEPTION 'an EXPIRED dispatch lease completed the event'; END IF;
  RAISE NOTICE '  ok  a stale, foreign or expired dispatcher completes nothing';

  -- ── Backoff is real: a failed event waits ───────────────────────────────
  SELECT settled INTO v_state
    FROM public.durable_outbox_settle(
      v_alpha, v_event, 'd1', v_gen, false, 'consumer.threw', 'nope',
      v_now + interval '10 minutes', v_now);
  IF NOT v_state::boolean THEN RAISE EXCEPTION 'the live dispatcher could not record a failure'; END IF;

  SELECT count(*) INTO v_count FROM public.durable_outbox_claim(v_alpha, 'd1', 30000, v_now, 10);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a failed event was re-claimed before its backoff'; END IF;

  SELECT count(*) INTO v_count
    FROM public.durable_outbox_claim(v_alpha, 'd1', 30000, v_now + interval '11 minutes', 10);
  IF v_count <> 1 THEN RAISE EXCEPTION 'a failed event was not claimable after its backoff'; END IF;
  RAISE NOTICE '  ok  backoff is honoured: a failed event waits, then returns';
END
$$;

-- ── An abandoned dispatch lease is recoverable ──────────────────────────────
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_now   TIMESTAMPTZ := now();
  v_event UUID;
  v_rec   RECORD;
  v_state TEXT;
BEGIN
  INSERT INTO public.durable_outbox (
    organization_id, event_type, actor_id, actor_type, correlation_id, source, max_attempts
  ) VALUES (v_alpha, 'test.abandoned', 'service:test', 'service', 'c', 'test', 5)
  RETURNING id INTO v_event;

  PERFORM public.durable_outbox_claim(v_alpha, 'dies', 1000, v_now, 10);

  SELECT * INTO v_rec
    FROM public.durable_outbox_recover_leases(v_now + interval '5 minutes', 100);
  IF v_rec.recovered < 1 THEN RAISE EXCEPTION 'an abandoned dispatch lease was not recovered'; END IF;

  SELECT dispatch_state INTO v_state FROM public.durable_outbox WHERE id = v_event;
  IF v_state <> 'pending' THEN RAISE EXCEPTION 'a recovered event is not pending again'; END IF;
  RAISE NOTICE '  ok  a dispatcher that died does not strand its event';

  -- On its last attempt, it is dead-lettered instead — atomically.
  --
  -- A FRESH event, for the reason the job-side assertion records: lowering
  -- `max_attempts` on an event that has already spent an attempt makes the
  -- claim predicate `attempt < max_attempts` correctly refuse it, so there
  -- would be nothing leased for recovery to find.
  INSERT INTO public.durable_outbox (
    organization_id, event_type, actor_id, actor_type, correlation_id, source, max_attempts
  ) VALUES (v_alpha, 'test.abandoned2', 'service:test', 'service', 'c', 'test', 1)
  RETURNING id INTO v_event;

  PERFORM public.durable_outbox_claim(v_alpha, 'dies', 1000, v_now, 10);
  SELECT * INTO v_rec FROM public.durable_outbox_recover_leases(v_now + interval '5 minutes', 100);
  IF v_rec.dead_lettered < 1 THEN RAISE EXCEPTION 'exhausted abandoned dispatch was not dead-lettered'; END IF;

  SELECT dispatch_state INTO v_state FROM public.durable_outbox WHERE id = v_event;
  IF v_state <> 'failed' THEN RAISE EXCEPTION 'the exhausted event is not failed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.durable_dead_letters
     WHERE origin_kind = 'event' AND origin_id = v_event
  ) THEN RAISE EXCEPTION 'no dead-letter row for the exhausted event'; END IF;
  RAISE NOTICE '  ok  an exhausted abandoned event reaches the dead-letter path';
END
$$;

-- ── Exhausted failure and its dead-letter row are ONE transaction ───────────
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_now   TIMESTAMPTZ := now();
  v_event UUID;
  v_gen   INTEGER;
  v_rec   RECORD;
  v_state TEXT;
BEGIN
  INSERT INTO public.durable_outbox (
    organization_id, event_type, actor_id, actor_type, correlation_id, source, max_attempts
  ) VALUES (v_alpha, 'test.exhaust', 'service:test', 'service', 'c', 'test', 1)
  RETURNING id INTO v_event;

  SELECT lease_generation INTO v_gen
    FROM public.durable_outbox_claim(v_alpha, 'd1', 30000, v_now, 10) LIMIT 1;

  SELECT * INTO v_rec
    FROM public.durable_outbox_settle(
      v_alpha, v_event, 'd1', v_gen, false, 'consumer.threw', 'refused', NULL, v_now);

  IF NOT v_rec.settled THEN RAISE EXCEPTION 'the exhausted settle was refused'; END IF;
  IF NOT v_rec.dead_lettered THEN RAISE EXCEPTION 'the exhausted settle did not dead-letter'; END IF;

  -- BOTH halves, after ONE call. Neither can exist without the other, because
  -- one function body is one transaction.
  SELECT dispatch_state INTO v_state FROM public.durable_outbox WHERE id = v_event;
  IF v_state <> 'failed' THEN RAISE EXCEPTION 'the event is not failed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.durable_dead_letters
     WHERE origin_kind = 'event' AND origin_id = v_event AND failure_code = 'consumer.threw'
  ) THEN RAISE EXCEPTION 'terminal failure with no monitored dead-letter record'; END IF;
  RAISE NOTICE '  ok  an exhausted event and its dead-letter row commit together';
END
$$;

-- ── The inbox: claim, suppress, fail, retry, recover ────────────────────────
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_now   TIMESTAMPTZ := now();
  v_event UUID;
  v_row   public.durable_inbox%ROWTYPE;
  v_count INTEGER;
BEGIN
  INSERT INTO public.durable_outbox (
    organization_id, event_type, actor_id, actor_type, correlation_id, source
  ) VALUES (v_alpha, 'test.inbox', 'service:test', 'service', 'c', 'test')
  RETURNING id INTO v_event;

  -- First claim: ours, and it is `processing` — NOT `processed`.
  SELECT * INTO v_row FROM public.durable_inbox_claim(
    v_alpha, 'counter', v_event, 'test.inbox', 'c', NULL, 'c1', 60000, v_now);
  IF v_row.status <> 'processing' THEN RAISE EXCEPTION 'the claim is not processing'; END IF;
  IF v_row.lease_owner <> 'c1' THEN RAISE EXCEPTION 'the claim has the wrong owner'; END IF;
  RAISE NOTICE '  ok  a claim is written BEFORE the handler, as processing';

  -- A second consumer instance finds a live claim it does not own.
  SELECT * INTO v_row FROM public.durable_inbox_claim(
    v_alpha, 'counter', v_event, 'test.inbox', 'c', NULL, 'c2', 60000, v_now);
  IF v_row.lease_owner <> 'c1' THEN RAISE EXCEPTION 'a live claim was stolen'; END IF;
  RAISE NOTICE '  ok  a live claim is not taken from its owner';

  -- A stale owner cannot settle.
  SELECT count(*) INTO v_count FROM public.durable_inbox_settle(
    v_alpha, 'counter', v_event, 'c2', 1, 'processed', NULL, NULL, NULL, v_now);
  IF v_count <> 0 THEN RAISE EXCEPTION 'a foreign consumer settled the claim'; END IF;

  -- The owner records a FAILURE, which must stay re-claimable.
  SELECT count(*) INTO v_count FROM public.durable_inbox_settle(
    v_alpha, 'counter', v_event, 'c1', 1, 'failed', 'consumer.threw', 'nope', NULL, v_now);
  IF v_count <> 1 THEN RAISE EXCEPTION 'the owner could not record a failure'; END IF;

  SELECT * INTO v_row FROM public.durable_inbox_claim(
    v_alpha, 'counter', v_event, 'test.inbox', 'c', NULL, 'c1', 60000, v_now);
  IF v_row.status <> 'processing' OR v_row.lease_owner <> 'c1' THEN
    RAISE EXCEPTION 'a FAILED delivery was not re-claimable — the consumer would never run again';
  END IF;
  IF v_row.attempt <> 2 THEN RAISE EXCEPTION 'the re-claim did not count an attempt'; END IF;
  RAISE NOTICE '  ok  a failed delivery is re-claimable, so the retry reaches the consumer';

  -- Now it succeeds, and becomes permanently suppressed.
  PERFORM public.durable_inbox_settle(
    v_alpha, 'counter', v_event, 'c1', v_row.lease_generation, 'processed',
    NULL, NULL, '{"counted":true}'::jsonb, v_now);

  SELECT * INTO v_row FROM public.durable_inbox_claim(
    v_alpha, 'counter', v_event, 'test.inbox', 'c', NULL, 'c1', 60000, v_now);
  IF v_row.status <> 'processed' THEN RAISE EXCEPTION 'a processed delivery was re-claimed'; END IF;
  RAISE NOTICE '  ok  processed is terminal and suppresses every later delivery';

  -- A second CONSUMER gets its own effect: idempotency is per consumer.
  SELECT * INTO v_row FROM public.durable_inbox_claim(
    v_alpha, 'other', v_event, 'test.inbox', 'c', NULL, 'o1', 60000, v_now);
  IF v_row.status <> 'processing' THEN RAISE EXCEPTION 'a second consumer was suppressed'; END IF;
  RAISE NOTICE '  ok  idempotency is per consumer, not per event';
END
$$;

-- ── A consumer that died mid-effect is recovered, never into `processed` ────
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_now   TIMESTAMPTZ := now();
  v_event UUID;
  v_row   public.durable_inbox%ROWTYPE;
  v_n     INTEGER;
BEGIN
  INSERT INTO public.durable_outbox (
    organization_id, event_type, actor_id, actor_type, correlation_id, source
  ) VALUES (v_alpha, 'test.crash', 'service:test', 'service', 'c', 'test')
  RETURNING id INTO v_event;

  PERFORM public.durable_inbox_claim(
    v_alpha, 'crasher', v_event, 'test.crash', 'c', NULL, 'dies', 1000, v_now);

  v_n := public.durable_inbox_recover_claims(v_now + interval '5 minutes', 100);
  IF v_n < 1 THEN RAISE EXCEPTION 'an abandoned consumer claim was not recovered'; END IF;

  SELECT * INTO v_row FROM public.durable_inbox
   WHERE consumer_key = 'crasher' AND event_id = v_event;
  IF v_row.status <> 'failed' THEN
    RAISE EXCEPTION 'an abandoned claim was recovered to % — it must be failed', v_row.status;
  END IF;
  RAISE NOTICE '  ok  a consumer that died is released to failed, never to processed';

  -- And the next delivery actually runs.
  SELECT * INTO v_row FROM public.durable_inbox_claim(
    v_alpha, 'crasher', v_event, 'test.crash', 'c', NULL, 'c2', 60000,
    v_now + interval '6 minutes');
  IF v_row.lease_owner <> 'c2' THEN RAISE EXCEPTION 'the recovered delivery was not re-claimable'; END IF;
  RAISE NOTICE '  ok  and the next delivery re-runs it';
END
$$;
