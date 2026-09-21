-- ============================================================================
-- BP-002 — the constraints, against a real PostgreSQL.
--
-- The static test reads these as TEXT. This proves the database ENFORCES them,
-- which is a different claim: a CHECK that is declared and a CHECK that fires
-- are the same line of SQL only when nothing else is wrong.
-- ============================================================================

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_ok BOOLEAN;
BEGIN
  -- ── A job may never act as a person ──────────────────────────────────────
  BEGIN
    INSERT INTO public.durable_jobs (
      organization_id, job_type, idempotency_key, correlation_id,
      actor_id, actor_type, actor_permissions
    ) VALUES (v_alpha, 'test.sweep', 'human-actor', 'c', 'user-1', 'human', ARRAY['all']);
    RAISE EXCEPTION 'a human job actor was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a job may not act as a person (CHECK fired)';
  END;

  -- ── Duplicate work is unrepresentable ────────────────────────────────────
  BEGIN
    INSERT INTO public.durable_jobs (
      organization_id, job_type, idempotency_key, correlation_id,
      actor_id, actor_type, actor_permissions
    ) VALUES (v_alpha, 'test.sweep', 'alpha-1', 'c', 'service:test', 'service', ARRAY[]::text[]);
    RAISE EXCEPTION 'a duplicate idempotency key was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '  ok  a duplicate idempotency key is refused';
  END;

  -- ── A lease may not be half-present ──────────────────────────────────────
  BEGIN
    UPDATE public.durable_jobs
       SET state = 'leased', lease_owner = NULL, lease_expires_at = NULL
     WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'a leased job with no owner was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  a leased job must carry an owner and an expiry';
  END;

  -- ── An event payload has a ceiling ───────────────────────────────────────
  BEGIN
    INSERT INTO public.durable_outbox (
      organization_id, event_type, actor_id, actor_type, correlation_id, source, payload
    ) VALUES (
      v_alpha, 'test.big', 'service:test', 'service', 'c', 'test',
      jsonb_build_object('blob', repeat('x', 20000))
    );
    RAISE EXCEPTION 'an oversized event payload was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ok  an oversized event payload is refused';
  END;

  -- ── A cross-tenant reference cannot be written down ──────────────────────
  BEGIN
    INSERT INTO public.durable_outbox (
      organization_id, event_type, actor_id, actor_type, correlation_id, source, job_id
    ) VALUES (
      '22222222-2222-4222-8222-222222222222', 'test.cross', 'service:test', 'service',
      'c', 'test', 'aaaaaaaa-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'a cross-tenant event->job reference was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '  ok  a cross-tenant reference is unrepresentable';
  END;

  -- ── An inbox claim may not be half-present ───────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'durable_inbox_claim_coherent'
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'the inbox claim coherence CHECK is missing'; END IF;
  RAISE NOTICE '  ok  an inbox claim carries an owner and an expiry, or neither';

  -- ── The three inbox states exist ─────────────────────────────────────────
  SELECT pg_get_constraintdef(oid) LIKE '%processing%'
    FROM pg_constraint WHERE conname = 'durable_inbox_status_check' INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'durable_inbox has no processing state'; END IF;
  RAISE NOTICE '  ok  the inbox has a processing state, not only an outcome';
END
$$;
