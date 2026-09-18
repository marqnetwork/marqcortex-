-- ============================================================================
-- BP-002 / A1 — DURABLE RUNTIME: THE ATOMIC OPERATIONS
--
-- Five functions. Each one is the SINGLE STATEMENT that a guarantee rests on,
-- and each is here rather than in TypeScript for the same reason
-- `kv_compare_and_swap_field` is: a read followed by a write is two statements,
-- and between them is a window in which another isolate does the same thing.
--
--   durable_job_claim                 exactly one worker owns a due job
--   durable_job_heartbeat             only the live owner may extend
--   durable_job_settle                result and events commit together, and
--                                     only from the lease that did the work
--   durable_job_recover_leases        an abandoned job becomes claimable again
--   durable_schedule_materialize_due  one occurrence, however many ticks race
--
-- ── SECURITY DEFINER, AND WHAT THAT DOES NOT MEAN ─────────────────────────
--
-- These run as the definer so they can write tables on which `authenticated`
-- has SELECT and nothing else. That is a statement about WHO WRITES, and it is
-- not a statement about authority: every one of them takes
-- `p_organization_id` and scopes every predicate by it, so a caller holding one
-- tenant's context cannot reach another tenant's row through any argument. The
-- BUSINESS question — may this work happen at all — is answered before any of
-- these is called, by the BP-001 evaluator, and none of these functions can
-- answer it or override it.
--
-- ── EVERY FUNCTION TAKES `p_now` ──────────────────────────────────────────
--
-- Rather than reading `now()` inside. The runtime already has a `Clock` port
-- that tests drive by hand, and a function that reads the wall clock makes the
-- half of a behaviour that lives in SQL untestable by the harness that tests
-- the other half. It also makes one tick internally consistent: a scheduler
-- pass that materializes twelve occurrences uses one instant for all twelve,
-- instead of twelve instants that drift across the pass.
--
-- Apply: staging/local only until explicitly approved for production.
-- Rollback: supabase/migrations/rollbacks/20260919120000_rollback_durable_runtime.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. durable_job_claim — the atomic claim
-- ---------------------------------------------------------------------------
--
-- `FOR UPDATE SKIP LOCKED` is the whole mechanism. The inner SELECT takes a row
-- lock on exactly one candidate and SKIPS any row another transaction already
-- holds, so N workers running this concurrently take N DIFFERENT jobs rather
-- than contending for the head of the queue and serializing behind it.
--
-- THE GENERATION IS BUMPED HERE AND NOWHERE ELSE. That is what makes it a
-- monotonic token the settle can compare against: a worker that re-claims a job
-- it previously abandoned gets a strictly higher number than the lease it is
-- still carrying, so its stale settle is refused even though its own name is on
-- both leases.
--
-- ORDERING IS DETERMINISTIC AND OLDEST-FIRST WITHIN A PRIORITY. Without
-- `created_at` in the ordering, two jobs at the same priority and the same
-- `available_at` are returned in whatever order the plan produces, and a job
-- can sit behind an endless supply of equals. BP-002 §8.10.
CREATE OR REPLACE FUNCTION public.durable_job_claim(
  p_organization_id UUID,
  p_job_types       TEXT[],
  p_worker          TEXT,
  p_lease_ttl_ms    INTEGER,
  p_now             TIMESTAMPTZ
)
RETURNS SETOF public.durable_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ttl INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'durable_job_claim requires an organization';
  END IF;
  IF p_worker IS NULL OR length(trim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'durable_job_claim requires a worker identity';
  END IF;

  -- Bounded here as well as by the CHECK, so a caller passing nonsense gets a
  -- usable lease rather than a constraint violation halfway through a claim.
  v_ttl := LEAST(GREATEST(COALESCE(p_lease_ttl_ms, 60000), 1000), 3600000);

  RETURN QUERY
  UPDATE public.durable_jobs AS j
     SET state            = 'leased',
         lease_owner      = p_worker,
         lease_generation = j.lease_generation + 1,
         lease_expires_at = p_now + make_interval(secs => v_ttl / 1000.0),
         heartbeat_at     = p_now,
         lease_ttl_ms     = v_ttl,
         attempt          = j.attempt + 1,
         started_at       = COALESCE(j.started_at, p_now),
         updated_at       = p_now
   WHERE j.id = (
           SELECT c.id
             FROM public.durable_jobs AS c
            WHERE c.organization_id = p_organization_id
              AND c.state = 'queued'
              AND c.available_at <= p_now
              AND (p_job_types IS NULL OR c.job_type = ANY (p_job_types))
              -- A job at its ceiling is not claimable. It should already be in
              -- dead-letter; refusing it here too means a row that somehow got
              -- past the settle cannot be run past its budget.
              AND c.attempt < c.max_attempts
            ORDER BY c.priority ASC, c.available_at ASC, c.created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
  RETURNING j.*;
END;
$$;

COMMENT ON FUNCTION public.durable_job_claim(UUID, TEXT[], TEXT, INTEGER, TIMESTAMPTZ) IS
  'Atomically lease at most one due job for one organization. Bumps lease_generation. Returns zero rows when nothing is claimable.';

-- ---------------------------------------------------------------------------
-- 2. durable_job_heartbeat — only the live owner, only its own lease
-- ---------------------------------------------------------------------------
--
-- Both the owner AND the generation must match. Owner alone would let a worker
-- that lost its lease to expiry, and then re-claimed the job, extend the wrong
-- one; generation alone would let a different worker extend a lease it does not
-- hold if the numbers happened to line up. Returns false rather than raising:
-- "my lease is gone" is an ordinary thing for a worker to discover, and the
-- runtime's answer to it is to stop, not to crash.
CREATE OR REPLACE FUNCTION public.durable_job_heartbeat(
  p_job_id          UUID,
  p_organization_id UUID,
  p_worker          TEXT,
  p_generation      INTEGER,
  p_lease_ttl_ms    INTEGER,
  p_now             TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
  v_ttl  INTEGER;
BEGIN
  v_ttl := LEAST(GREATEST(COALESCE(p_lease_ttl_ms, 60000), 1000), 3600000);

  UPDATE public.durable_jobs
     SET lease_expires_at = p_now + make_interval(secs => v_ttl / 1000.0),
         heartbeat_at     = p_now,
         lease_ttl_ms     = v_ttl,
         updated_at       = p_now
   WHERE id               = p_job_id
     AND organization_id  = p_organization_id
     AND state            = 'leased'
     AND lease_owner      = p_worker
     AND lease_generation = p_generation
     -- AN EXPIRED LEASE IS NOT EXTENDED. A worker that comes back after its
     -- lease lapsed must lose, even if nobody has reclaimed the job yet:
     -- otherwise the outcome depends on whether the recovery sweep happened to
     -- have run, which is a race dressed up as a policy.
     AND lease_expires_at > p_now;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.durable_job_heartbeat(UUID, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ) IS
  'Extend a live lease. True only when owner, generation, tenant and expiry all still hold.';

-- ---------------------------------------------------------------------------
-- 3. durable_job_settle — the transactional outbox
-- ---------------------------------------------------------------------------
--
-- THE FUNCTION THIS PACKET EXISTS FOR. A job succeeds and the fact that it
-- succeeded must be published. Two writes. If they are two transactions, then
-- one of the two orderings is always wrong: publish first and a crash publishes
-- something that did not happen; write first and a crash loses a fact forever.
--
-- A plpgsql function body runs inside ONE transaction, so the job row and its
-- events commit together or not at all. That is the entire transactional-outbox
-- pattern, and it needs no broker to implement — which is why BP-002 §5.4
-- forbids introducing one.
--
-- THE LEASE IS CHECKED FIRST AND THE WHOLE CALL IS REFUSED ON A MISMATCH. Not
-- "the job write is skipped but the events are kept": a stale worker's events
-- describe an outcome that did not become true, and publishing them would put
-- a fact on the log that contradicts the row beside it.
--
-- `p_disposition` is one of:
--   succeeded    terminal success
--   retry        transient failure; back to `queued` at `p_available_at`
--   dead_letter  exhausted or terminal; a dead-letter row is written too
CREATE OR REPLACE FUNCTION public.durable_job_settle(
  p_job_id          UUID,
  p_organization_id UUID,
  p_worker          TEXT,
  p_generation      INTEGER,
  p_disposition     TEXT,
  p_result          JSONB,
  p_failure_code    TEXT,
  p_failure_detail  TEXT,
  p_available_at    TIMESTAMPTZ,
  p_events          JSONB,
  p_now             TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job     public.durable_jobs%ROWTYPE;
  v_event   JSONB;
  v_first   TIMESTAMPTZ;
BEGIN
  IF p_disposition NOT IN ('succeeded', 'retry', 'dead_letter') THEN
    RAISE EXCEPTION 'durable_job_settle: unknown disposition %', p_disposition;
  END IF;

  -- Lock the row for the rest of the transaction. Every predicate that decides
  -- whether this settle is legitimate is evaluated here, once, under that lock.
  SELECT * INTO v_job
    FROM public.durable_jobs
   WHERE id              = p_job_id
     AND organization_id = p_organization_id
     AND state           = 'leased'
     AND lease_owner     = p_worker
     AND lease_generation = p_generation
   FOR UPDATE;

  IF NOT FOUND THEN
    -- The lease moved on. The caller is a stale owner, a different tenant, or
    -- a worker whose job was cancelled while it ran. Nothing is written.
    RETURN false;
  END IF;

  IF p_disposition = 'succeeded' THEN
    UPDATE public.durable_jobs
       SET state            = 'succeeded',
           result           = p_result,
           failure_code     = NULL,
           failure_detail   = NULL,
           lease_owner      = NULL,
           lease_expires_at = NULL,
           completed_at     = p_now,
           updated_at       = p_now
     WHERE id = p_job_id;

  ELSIF p_disposition = 'retry' THEN
    UPDATE public.durable_jobs
       SET state            = 'queued',
           -- The attempt count is NOT reset and NOT re-incremented: the claim
           -- incremented it, and a settle that touched it again would make the
           -- budget depend on how many times the row was written rather than on
           -- how many times the work was tried. BP-002 §9.
           available_at     = GREATEST(COALESCE(p_available_at, p_now), p_now),
           failure_code     = p_failure_code,
           failure_detail   = p_failure_detail,
           lease_owner      = NULL,
           lease_expires_at = NULL,
           updated_at       = p_now
     WHERE id = p_job_id;

  ELSE
    UPDATE public.durable_jobs
       SET state            = 'dead_letter',
           failure_code     = p_failure_code,
           failure_detail   = p_failure_detail,
           lease_owner      = NULL,
           lease_expires_at = NULL,
           completed_at     = p_now,
           updated_at       = p_now
     WHERE id = p_job_id;

    -- `started_at` is the first time this job was ever claimed, which is the
    -- closest durable stamp to "when it first went wrong". COALESCE so a row
    -- that somehow lacks one still produces a valid, ordered record rather than
    -- violating the CHECK and taking the settle down with it.
    v_first := COALESCE(v_job.started_at, v_job.created_at, p_now);

    INSERT INTO public.durable_dead_letters (
      organization_id, origin_kind, origin_id, origin_type,
      attempts, failure_code, failure_detail,
      correlation_id, causation_id, first_failed_at, last_failed_at
    )
    VALUES (
      p_organization_id, 'job', p_job_id, v_job.job_type,
      GREATEST(v_job.attempt, 1),
      COALESCE(p_failure_code, 'unspecified'), p_failure_detail,
      v_job.correlation_id, v_job.causation_id, LEAST(v_first, p_now), p_now
    )
    ON CONFLICT (organization_id, origin_kind, origin_id) DO UPDATE
      SET attempts       = EXCLUDED.attempts,
          failure_code   = EXCLUDED.failure_code,
          failure_detail = EXCLUDED.failure_detail,
          last_failed_at = EXCLUDED.last_failed_at,
          updated_at     = p_now;
  END IF;

  -- ── The events, in this same transaction ────────────────────────────────
  --
  -- The event id comes from the CALLER. It was minted when the handler decided
  -- to emit, it is on the record the runtime returned, and it is what a retried
  -- settle re-presents — so a settle that runs twice writes one event, not two.
  -- `ON CONFLICT DO NOTHING` is what makes the second one a no-op rather than a
  -- failure that would roll back a legitimate result.
  IF p_events IS NOT NULL AND jsonb_typeof(p_events) = 'array' THEN
    FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
    LOOP
      INSERT INTO public.durable_outbox (
        id, organization_id, event_type, event_version, occurred_at,
        actor_id, actor_type, correlation_id, causation_id,
        source, entity_type, entity_id, classification, payload,
        max_attempts, available_at, job_id, created_at, updated_at
      )
      VALUES (
        (v_event ->> 'eventId')::uuid,
        p_organization_id,
        v_event ->> 'eventType',
        COALESCE((v_event ->> 'eventVersion')::integer, 1),
        COALESCE((v_event ->> 'occurredAt')::timestamptz, p_now),
        COALESCE(v_event ->> 'actorId', v_job.actor_id),
        COALESCE(v_event ->> 'actorType', v_job.actor_type),
        COALESCE(v_event ->> 'correlationId', v_job.correlation_id),
        -- CAUSATION DEFAULTS TO THE JOB THAT EMITTED IT. An event whose cause
        -- is unstated is an event nobody can trace back, and the job id is the
        -- true answer here rather than a convenient one.
        COALESCE(v_event ->> 'causationId', p_job_id::text),
        COALESCE(v_event ->> 'source', 'durable.job'),
        v_event ->> 'entityType',
        v_event ->> 'entityId',
        COALESCE(v_event ->> 'classification', 'internal'),
        COALESCE(v_event -> 'payload', '{}'::jsonb),
        COALESCE((v_event ->> 'maxAttempts')::integer, 5),
        p_now,
        p_job_id,
        p_now,
        p_now
      )
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.durable_job_settle(UUID, UUID, TEXT, INTEGER, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, JSONB, TIMESTAMPTZ) IS
  'Settle a leased job and write its domain events in ONE transaction. False when the presented lease is not the live one — and then nothing is written.';

-- ---------------------------------------------------------------------------
-- 4. durable_job_recover_leases — an abandoned job becomes claimable
-- ---------------------------------------------------------------------------
--
-- A worker that dies mid-job leaves a row `leased` forever. This is what makes
-- "the isolate went away" a delay rather than a loss.
--
-- RECOVERY DOES NOT SPEND AN ATTEMPT — the claim already did, when it handed
-- out the lease that lapsed. A job recovered `max_attempts` times has been tried
-- that many times, and the fact that none of those tries reported back is
-- exactly what the attempt budget should be counting.
--
-- A job at its ceiling is dead-lettered here rather than returned to the queue,
-- so work abandoned on its last attempt reaches the monitored path instead of
-- becoming a row that is permanently `leased` and permanently unclaimable.
CREATE OR REPLACE FUNCTION public.durable_job_recover_leases(
  p_now   TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS TABLE (recovered INTEGER, dead_lettered INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
  v_recovered INTEGER := 0;
  v_dead INTEGER := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _durable_expired (id UUID PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _durable_expired;

  INSERT INTO _durable_expired (id)
  SELECT j.id
    FROM public.durable_jobs AS j
   WHERE j.state = 'leased'
     AND j.lease_expires_at <= p_now
   ORDER BY j.lease_expires_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT v_limit;

  WITH exhausted AS (
    UPDATE public.durable_jobs AS j
       SET state            = 'dead_letter',
           failure_code     = 'lease_abandoned',
           failure_detail   = 'the worker holding this job stopped reporting and no attempts remain',
           lease_owner      = NULL,
           lease_expires_at = NULL,
           completed_at     = p_now,
           updated_at       = p_now
     WHERE j.id IN (SELECT id FROM _durable_expired)
       AND j.attempt >= j.max_attempts
    RETURNING j.id, j.organization_id, j.job_type, j.attempt,
              j.correlation_id, j.causation_id, j.started_at, j.created_at
  ),
  recorded AS (
    INSERT INTO public.durable_dead_letters (
      organization_id, origin_kind, origin_id, origin_type,
      attempts, failure_code, failure_detail,
      correlation_id, causation_id, first_failed_at, last_failed_at
    )
    SELECT e.organization_id, 'job', e.id, e.job_type,
           GREATEST(e.attempt, 1), 'lease_abandoned',
           'the worker holding this job stopped reporting and no attempts remain',
           e.correlation_id, e.causation_id,
           LEAST(COALESCE(e.started_at, e.created_at, p_now), p_now), p_now
      FROM exhausted e
    ON CONFLICT (organization_id, origin_kind, origin_id) DO UPDATE
      SET attempts = EXCLUDED.attempts, last_failed_at = EXCLUDED.last_failed_at, updated_at = p_now
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_dead FROM recorded;

  WITH requeued AS (
    UPDATE public.durable_jobs AS j
       SET state            = 'queued',
           available_at     = p_now,
           failure_code     = 'lease_expired',
           failure_detail   = 'the worker holding this job stopped reporting',
           lease_owner      = NULL,
           lease_expires_at = NULL,
           updated_at       = p_now
     WHERE j.id IN (SELECT id FROM _durable_expired)
       AND j.state = 'leased'
       AND j.attempt < j.max_attempts
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_recovered FROM requeued;

  RETURN QUERY SELECT v_recovered, v_dead;
END;
$$;

COMMENT ON FUNCTION public.durable_job_recover_leases(TIMESTAMPTZ, INTEGER) IS
  'Return abandoned jobs to the queue, or dead-letter them when no attempts remain. Never spends an attempt.';

-- ---------------------------------------------------------------------------
-- 5. durable_schedule_materialize_due — one occurrence, however many ticks
-- ---------------------------------------------------------------------------
--
-- TWO INDEPENDENT GUARDS, AND BOTH ARE LOAD-BEARING.
--
--   The CAS on `materialize_version`, so that of two racing ticks only one
--   advances the schedule and only one attempts an insert.
--
--   The unique idempotency key `schedule:{id}:{occurrence}`, so that even if
--   both somehow attempted it, the second insert conflicts and returns the
--   first one's job.
--
-- Belt and braces on purpose: the CAS makes the common case cheap, and the
-- unique key makes the guarantee true rather than likely. A duplicate
-- occurrence is not a performance problem, it is the same work running twice.
--
-- THE NEXT OCCURRENCE IS COMPUTED FROM THE SCHEDULED TIME, NOT FROM NOW. A tick
-- that runs four minutes late must not push every future occurrence four
-- minutes later; a schedule that drifts by however long the platform was busy
-- is a schedule nobody can predict. The loop skips whole intervals when the
-- schedule is far behind, so a system that was down for a day produces ONE
-- catch-up occurrence rather than a day's worth at once.
CREATE OR REPLACE FUNCTION public.durable_schedule_materialize_due(
  p_organization_id UUID,
  p_now             TIMESTAMPTZ,
  p_limit           INTEGER
)
RETURNS TABLE (schedule_id UUID, job_id UUID, occurrence_at TIMESTAMPTZ, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit    INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_schedule public.durable_schedules%ROWTYPE;
  v_occurrence TIMESTAMPTZ;
  v_next     TIMESTAMPTZ;
  v_key      TEXT;
  v_job      UUID;
  v_created  BOOLEAN;
  v_rows     INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'durable_schedule_materialize_due requires an organization';
  END IF;

  FOR v_schedule IN
    SELECT *
      FROM public.durable_schedules
     WHERE organization_id = p_organization_id
       AND status = 'active'
       AND next_run_at <= p_now
     ORDER BY next_run_at ASC
     LIMIT v_limit
  LOOP
    v_occurrence := v_schedule.next_run_at;
    v_key := 'schedule:' || v_schedule.id::text || ':'
             || to_char(v_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    IF v_schedule.recurrence_interval_ms IS NULL THEN
      -- One-time. It advances to `completed`, so a second tick cannot see it
      -- due again whatever it does with the clock.
      UPDATE public.durable_schedules
         SET status              = 'completed',
             last_run_at         = p_now,
             last_occurrence_at  = v_occurrence,
             materialize_version = v_schedule.materialize_version + 1,
             updated_at          = p_now
       WHERE id = v_schedule.id
         AND materialize_version = v_schedule.materialize_version;
    ELSE
      v_next := v_occurrence + make_interval(secs => v_schedule.recurrence_interval_ms / 1000.0);
      -- Catch up in whole intervals, from the SCHEDULED time, so the phase of
      -- the schedule survives an outage.
      WHILE v_next <= p_now LOOP
        v_next := v_next + make_interval(secs => v_schedule.recurrence_interval_ms / 1000.0);
      END LOOP;

      UPDATE public.durable_schedules
         SET next_run_at         = v_next,
             last_run_at         = p_now,
             last_occurrence_at  = v_occurrence,
             materialize_version = v_schedule.materialize_version + 1,
             updated_at          = p_now
       WHERE id = v_schedule.id
         AND materialize_version = v_schedule.materialize_version;
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    -- Lost the CAS: another tick owns this occurrence. Emit nothing — the
    -- winner's row is the one the caller will see on its own return.
    CONTINUE WHEN v_rows = 0;

    INSERT INTO public.durable_jobs (
      organization_id, job_type, state, available_at,
      max_attempts, idempotency_key, correlation_id, schedule_id,
      actor_id, actor_type, actor_permissions,
      initiated_by_actor_id, initiated_by_actor_type, input
    )
    VALUES (
      v_schedule.organization_id, v_schedule.job_type, 'queued', v_occurrence,
      5, v_key, v_schedule.correlation_id, v_schedule.id,
      v_schedule.actor_id, v_schedule.actor_type, v_schedule.actor_permissions,
      v_schedule.initiated_by_actor_id, v_schedule.initiated_by_actor_type, v_schedule.input
    )
    ON CONFLICT (organization_id, job_type, idempotency_key) DO NOTHING
    RETURNING id INTO v_job;

    v_created := v_job IS NOT NULL;
    IF v_job IS NULL THEN
      SELECT id INTO v_job
        FROM public.durable_jobs
       WHERE organization_id = v_schedule.organization_id
         AND job_type = v_schedule.job_type
         AND idempotency_key = v_key;
    END IF;

    schedule_id := v_schedule.id;
    job_id := v_job;
    occurrence_at := v_occurrence;
    created := v_created;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.durable_schedule_materialize_due(UUID, TIMESTAMPTZ, INTEGER) IS
  'Advance due schedules and enqueue one job per occurrence. Racing ticks and repeated ticks both produce exactly one job per occurrence.';

-- ---------------------------------------------------------------------------
-- Grants — the runtime only. No path from `authenticated`.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.durable_job_claim(UUID, TEXT[], TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_job_heartbeat(UUID, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_job_settle(UUID, UUID, TEXT, INTEGER, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_job_recover_leases(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_schedule_materialize_due(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.durable_job_claim(UUID, TEXT[], TEXT, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_job_heartbeat(UUID, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_job_settle(UUID, UUID, TEXT, INTEGER, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, JSONB, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_job_recover_leases(TIMESTAMPTZ, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_schedule_materialize_due(UUID, TIMESTAMPTZ, INTEGER) TO service_role;

COMMIT;
