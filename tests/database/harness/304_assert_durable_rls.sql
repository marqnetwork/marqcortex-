-- ============================================================================
-- BP-002 — RLS, as the `authenticated` role actually experiences it.
--
-- `SET ROLE` and session-scoped `set_config`, the same shape
-- `201_assert_spine_tenancy.sql` uses. The first version of this file used
-- `SET LOCAL` outside a transaction, which PostgreSQL warns about and ignores —
-- so every query ran as the superuser, RLS was bypassed, and the suite reported
-- a tenant breach that was really a harness bug. An RLS assertion that does not
-- actually change role proves nothing, in either direction.
--
-- The claim being made is narrow and total: an authenticated member may READ
-- its own tenant's durable state, and may write NOTHING, anywhere.
-- ============================================================================

-- A member of Alpha, holding `runtime.read` through the seeded role catalog.
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_user  UUID := '99999999-0000-4000-8000-000000000001';
  v_role  UUID;
  v_perm  UUID;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'alpha-operator@example.test')
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_role FROM public.roles WHERE key = 'org_admin' LIMIT 1;
  IF v_role IS NULL THEN
    INSERT INTO public.roles (key, name) VALUES ('org_admin', 'Org Admin') RETURNING id INTO v_role;
  END IF;

  SELECT id INTO v_perm FROM public.permissions WHERE key = 'runtime.read';
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'the runtime.read permission was not seeded by the RLS migration';
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_id)
  VALUES (v_role, v_perm) ON CONFLICT DO NOTHING;

  INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status)
  VALUES (v_alpha, v_user, v_role, 'active')
  ON CONFLICT DO NOTHING;
END
$$;

-- Give Beta a dead letter, an event and a schedule, so "Beta's rows are
-- invisible" is a claim about rows that exist rather than about an empty table.
INSERT INTO public.durable_outbox (
  organization_id, event_type, actor_id, actor_type, correlation_id, source
) VALUES (
  '22222222-2222-4222-8222-222222222222', 'beta.secret', 'service:beta', 'service', 'c', 'test'
);
INSERT INTO public.durable_schedules (
  organization_id, schedule_key, job_type, next_run_at,
  actor_id, actor_type, actor_permissions, correlation_id
) VALUES (
  '22222222-2222-4222-8222-222222222222', 'beta.sweep', 'beta.sweep', now(),
  'service:beta', 'service', ARRAY[]::text[], 'c'
);
INSERT INTO public.durable_dead_letters (
  organization_id, origin_kind, origin_id, origin_type, attempts,
  failure_code, correlation_id, first_failed_at, last_failed_at
) VALUES (
  '22222222-2222-4222-8222-222222222222', 'job', gen_random_uuid(), 'beta.sweep', 1,
  'x', 'c', now(), now()
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims',
  '{"sub":"99999999-0000-4000-8000-000000000001","app_metadata":{}}', false);

DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_beta  UUID := '22222222-2222-4222-8222-222222222222';
  v_mine  INTEGER;
  v_yours INTEGER;
BEGIN
  IF current_user <> 'authenticated' THEN
    -- The harness bug this file was rewritten for. Asserted, so a silently
    -- ignored role switch can never again be read as a passing isolation test.
    RAISE EXCEPTION 'the role switch did not take: running as %', current_user;
  END IF;

  SELECT count(*) INTO v_mine FROM public.durable_jobs WHERE organization_id = v_alpha;
  IF v_mine = 0 THEN RAISE EXCEPTION 'a member cannot read its OWN tenant''s jobs'; END IF;
  RAISE NOTICE '  ok  a member reads its own tenant''s jobs (% visible)', v_mine;

  SELECT count(*) INTO v_yours FROM public.durable_jobs WHERE organization_id = v_beta;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: % of Beta''s jobs are visible', v_yours; END IF;

  SELECT count(*) INTO v_yours FROM public.durable_outbox WHERE organization_id = v_beta;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta''s events are visible'; END IF;

  SELECT count(*) INTO v_yours FROM public.durable_inbox WHERE organization_id = v_beta;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta''s inbox is visible'; END IF;

  SELECT count(*) INTO v_yours FROM public.durable_dead_letters WHERE organization_id = v_beta;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta''s dead letters are visible'; END IF;

  SELECT count(*) INTO v_yours FROM public.durable_schedules WHERE organization_id = v_beta;
  IF v_yours <> 0 THEN RAISE EXCEPTION 'TENANT BREACH: Beta''s schedules are visible'; END IF;
  RAISE NOTICE '  ok  no durable table leaks another tenant''s rows';
END
$$;

-- ── AND THERE IS NO WRITE PATH AT ALL ──────────────────────────────────────
--
-- Not "writes are filtered by tenant" — there is no INSERT, UPDATE or DELETE
-- policy on any of these tables. A person with UPDATE on `durable_jobs` can set
-- a job to succeeded on work that never ran, or clear a lease out from under a
-- worker mid-execution. The runtime owns its own state machine.
DO $$
DECLARE
  v_alpha UUID := '11111111-1111-4111-8111-111111111111';
  v_rows  INTEGER;
BEGIN
  BEGIN
    INSERT INTO public.durable_jobs (
      organization_id, job_type, idempotency_key, correlation_id,
      actor_id, actor_type, actor_permissions
    ) VALUES (v_alpha, 'test.sweep', 'rls-insert', 'c', 'service:x', 'service', ARRAY[]::text[]);
    RAISE EXCEPTION 'an authenticated member INSERTED a durable job';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot insert a job';
  END;

  BEGIN
    UPDATE public.durable_jobs SET state = 'succeeded' WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member UPDATED % durable jobs', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot update a job';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot update a job';
  END;

  BEGIN
    DELETE FROM public.durable_dead_letters WHERE organization_id = v_alpha;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN RAISE EXCEPTION 'an authenticated member DELETED % dead letters', v_rows; END IF;
    RAISE NOTICE '  ok  an authenticated member cannot delete a dead-letter record';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot delete a dead-letter record';
  END;

  -- ── AND CANNOT EXECUTE THE RUNTIME'S OWN FUNCTIONS ──────────────────────
  BEGIN
    PERFORM public.durable_job_claim(v_alpha, NULL, 'impostor', 60000, now());
    RAISE EXCEPTION 'an authenticated member EXECUTED durable_job_claim';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot claim work';
  END;

  BEGIN
    PERFORM public.durable_job_transition(
      'aaaaaaaa-0000-4000-8000-000000000001', v_alpha, 'cancelled', now());
    RAISE EXCEPTION 'an authenticated member EXECUTED durable_job_transition';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot cancel work directly';
  END;

  BEGIN
    PERFORM public.durable_inbox_claim(
      v_alpha, 'impostor', gen_random_uuid(), 't', 'c', NULL, 'x', 60000, now());
    RAISE EXCEPTION 'an authenticated member EXECUTED durable_inbox_claim';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '  ok  an authenticated member cannot claim a delivery';
  END;
END
$$;

RESET ROLE;

-- The service role CAN, which is what makes the above a boundary rather than a
-- broken deployment.
SET ROLE service_role;
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.durable_job_claim(
      '11111111-1111-4111-8111-111111111111', ARRAY['does.not.exist'], 'service-worker', 60000, now());
  RAISE NOTICE '  ok  the service role executes the runtime functions';
END
$$;
RESET ROLE;
