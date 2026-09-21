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
     -- AN EXPIRED LEASE SETTLES NOTHING, AND THIS LINE WAS MISSING.
     --
     -- Owner and generation alone made the outcome depend on whether the
     -- recovery sweep had happened to run yet: a worker whose lease lapsed
     -- five minutes ago could still succeed, retry, dead-letter and EMIT
     -- EVENTS, purely because nobody had reclaimed the job. Recovery is a
     -- sweep on a timer, so "has it run" is a race, and a durability
     -- guarantee decided by a race is not one.
     --
     -- `durable_job_heartbeat` already refused a lapsed lease for exactly this
     -- reason and said so in its comment; the settle did not, and the
     -- in-memory store's `holdsLiveLease` did. Three places, two behaviours.
     -- They agree now, and `durablePostgresContract` asserts the predicate is
     -- here so the pair cannot drift apart again.
     AND lease_expires_at > p_now
   FOR UPDATE;

  IF NOT FOUND THEN
    -- The lease moved on, or ran out. The caller is a stale owner, a different
    -- tenant, a worker whose job was cancelled while it ran, or one whose lease
    -- expired. Nothing is written — not the result, and not the events.
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
-- 6. durable_job_transition — the legal operator transitions, and only those
-- ---------------------------------------------------------------------------
--
-- WHY THIS IS A FUNCTION AND NOT AN UPDATE IN THE ADAPTER.
--
-- The adapter's gateway takes equality predicates only, so cancellation — legal
-- from three source states — could not name its source in the WHERE clause and
-- was issued unconditioned. A succeeded or dead-lettered job could therefore be
-- cancelled, which the in-memory store refuses and which makes "terminal"
-- untrue in the only implementation that runs in production.
--
-- The repair is NOT "read the state, then update". That reintroduces the
-- time-of-check-to-time-of-use window this whole packet exists to close: the
-- job can be claimed, settled or recovered between the read and the write, and
-- the write would land on a state nobody checked.
--
-- So the legal transitions live HERE, in one statement, under one row lock.
-- The table below is the whole of the state machine an operator may drive:
--
--   queued  -> paused      hold it
--   paused  -> queued      release it
--   queued  -> cancelled   stop it before it starts
--   paused  -> cancelled   stop it while held
--   leased  -> cancelled   stop it MID-FLIGHT, which also clears the lease so
--                          the running worker's settle is refused rather than
--                          silently completing work the tenant asked to stop
--
-- Everything else returns no row, which the adapter reports as `undefined` —
-- the same answer the in-memory store gives, because the two are now the same
-- rules written twice rather than two sets of rules.
CREATE OR REPLACE FUNCTION public.durable_job_transition(
  p_job_id          UUID,
  p_organization_id UUID,
  p_to              TEXT,
  p_now             TIMESTAMPTZ
)
RETURNS SETOF public.durable_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from TEXT[];
BEGIN
  IF p_to NOT IN ('paused', 'queued', 'cancelled') THEN
    -- `succeeded` and `dead_letter` are OUTCOMES OF RUNNING WORK. A function
    -- that could assert them would make the record a claim rather than a
    -- history, so there is deliberately no way to ask for one here.
    RAISE EXCEPTION 'durable_job_transition: % is not an operator transition', p_to;
  END IF;

  v_from := CASE p_to
              WHEN 'paused'    THEN ARRAY['queued']
              WHEN 'queued'    THEN ARRAY['paused']
              ELSE                  ARRAY['queued', 'paused', 'leased']
            END;

  RETURN QUERY
  UPDATE public.durable_jobs AS j
     SET state            = p_to,
         -- CANCELLING A LEASED JOB CLEARS ITS LEASE. That is what makes the
         -- running worker's settle fail its owner-and-generation check rather
         -- than completing work that was cancelled while it ran.
         lease_owner      = CASE WHEN p_to = 'cancelled' THEN NULL ELSE j.lease_owner END,
         lease_expires_at = CASE WHEN p_to = 'cancelled' THEN NULL ELSE j.lease_expires_at END,
         completed_at     = CASE WHEN p_to = 'cancelled' THEN p_now ELSE j.completed_at END,
         updated_at       = p_now
   WHERE j.id = (
           SELECT c.id
             FROM public.durable_jobs AS c
            WHERE c.id              = p_job_id
              AND c.organization_id = p_organization_id
              AND c.state           = ANY (v_from)
            FOR UPDATE
         )
  RETURNING j.*;
END;
$$;

COMMENT ON FUNCTION public.durable_job_transition(UUID, UUID, TEXT, TIMESTAMPTZ) IS
  'Pause, resume or cancel under one row lock. Returns no row when the transition is not legal from the current state — terminal jobs stay terminal.';

-- ---------------------------------------------------------------------------
-- 7. durable_outbox_claim — dispatch, leased, and only when due
-- ---------------------------------------------------------------------------
--
-- The same shape as `durable_job_claim`, and it exists for two reasons the
-- adapter's read-then-update pair could not satisfy.
--
--   BACKOFF WAS NOT REAL. The adapter selected every `pending` row and never
--   compared `available_at`, so a failed event became immediately re-claimable
--   and the backoff written onto the row was a number nobody honoured — a
--   tight retry loop, which §9 forbids, wearing the word "backoff".
--
--   TWO DISPATCHERS COULD BOTH PICK THE SAME ROW and race on the conditional
--   update. One lost, which was safe, but it cost a read and a write per loser
--   on every pass. `FOR UPDATE SKIP LOCKED` makes N dispatchers take N
--   different events instead of contending for the head of the queue.
CREATE OR REPLACE FUNCTION public.durable_outbox_claim(
  p_organization_id UUID,
  p_worker          TEXT,
  p_lease_ttl_ms    INTEGER,
  p_now             TIMESTAMPTZ,
  p_limit           INTEGER
)
RETURNS SETOF public.durable_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ttl   INTEGER;
  v_limit INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'durable_outbox_claim requires an organization';
  END IF;
  IF p_worker IS NULL OR length(trim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'durable_outbox_claim requires a worker identity';
  END IF;

  v_ttl := LEAST(GREATEST(COALESCE(p_lease_ttl_ms, 30000), 1000), 3600000);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);

  RETURN QUERY
  UPDATE public.durable_outbox AS e
     SET dispatch_state   = 'dispatching',
         lease_owner      = p_worker,
         lease_generation = e.lease_generation + 1,
         lease_expires_at = p_now + make_interval(secs => v_ttl / 1000.0),
         attempt          = e.attempt + 1,
         updated_at       = p_now
   WHERE e.id IN (
           SELECT c.id
             FROM public.durable_outbox AS c
            WHERE c.organization_id = p_organization_id
              AND c.dispatch_state = 'pending'
              -- THE BACKOFF, HONOURED. See the header.
              AND c.available_at <= p_now
              AND c.attempt < c.max_attempts
            ORDER BY c.available_at ASC, c.created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT v_limit
         )
  RETURNING e.*;
END;
$$;

COMMENT ON FUNCTION public.durable_outbox_claim(UUID, TEXT, INTEGER, TIMESTAMPTZ, INTEGER) IS
  'Atomically lease due pending events for dispatch. Honours available_at, so a failed event waits out its backoff.';

-- ---------------------------------------------------------------------------
-- 8. durable_outbox_settle — dispatched, or failed AND dead-lettered together
-- ---------------------------------------------------------------------------
--
-- THE ATOMICITY THAT WAS MISSING. The adapter persisted `dispatch_state =
-- failed` and then, in a SECOND round trip, inserted the dead-letter row. A
-- crash between them left terminal undeliverable work with no monitored
-- record — which is precisely the outcome the dead-letter table exists to make
-- impossible, produced by the code that maintains it.
--
-- One function body is one transaction, so the event's terminal state and its
-- dead-letter row commit together or not at all. The same argument
-- `durable_job_settle` makes about a result and its events.
--
-- THE LEASE IS CHECKED THE WAY THE JOB'S IS: owner, generation AND expiry. A
-- dispatcher whose lease lapsed must not complete the event merely because
-- recovery has not swept it yet.
CREATE OR REPLACE FUNCTION public.durable_outbox_settle(
  p_organization_id UUID,
  p_event_id        UUID,
  p_worker          TEXT,
  p_generation      INTEGER,
  p_dispatched      BOOLEAN,
  p_failure_code    TEXT,
  p_failure_detail  TEXT,
  p_available_at    TIMESTAMPTZ,
  p_now             TIMESTAMPTZ
)
RETURNS TABLE (settled BOOLEAN, dead_lettered BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event     public.durable_outbox%ROWTYPE;
  v_exhausted BOOLEAN;
BEGIN
  SELECT * INTO v_event
    FROM public.durable_outbox
   WHERE id               = p_event_id
     AND organization_id  = p_organization_id
     AND dispatch_state   = 'dispatching'
     AND lease_owner      = p_worker
     AND lease_generation = p_generation
     AND lease_expires_at > p_now
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  IF p_dispatched THEN
    UPDATE public.durable_outbox
       SET dispatch_state   = 'dispatched',
           lease_owner      = NULL,
           lease_expires_at = NULL,
           dispatched_at    = p_now,
           updated_at       = p_now
     WHERE id = p_event_id;
    RETURN QUERY SELECT true, false;
    RETURN;
  END IF;

  v_exhausted := v_event.attempt >= v_event.max_attempts;

  UPDATE public.durable_outbox
     SET dispatch_state   = CASE WHEN v_exhausted THEN 'failed' ELSE 'pending' END,
         lease_owner      = NULL,
         lease_expires_at = NULL,
         -- An exhausted event keeps its stamp: there is no next attempt to
         -- schedule, and moving it would suggest there were.
         available_at     = CASE
                              WHEN v_exhausted THEN v_event.available_at
                              ELSE GREATEST(COALESCE(p_available_at, p_now), p_now)
                            END,
         failure_code     = p_failure_code,
         failure_detail   = p_failure_detail,
         updated_at       = p_now
   WHERE id = p_event_id;

  IF v_exhausted THEN
    INSERT INTO public.durable_dead_letters (
      organization_id, origin_kind, origin_id, origin_type,
      attempts, failure_code, failure_detail,
      correlation_id, causation_id, first_failed_at, last_failed_at
    )
    VALUES (
      p_organization_id, 'event', p_event_id, v_event.event_type,
      GREATEST(v_event.attempt, 1),
      COALESCE(p_failure_code, 'unspecified'), p_failure_detail,
      v_event.correlation_id, v_event.causation_id,
      LEAST(v_event.created_at, p_now), p_now
    )
    ON CONFLICT (organization_id, origin_kind, origin_id) DO UPDATE
      SET attempts       = EXCLUDED.attempts,
          failure_code   = EXCLUDED.failure_code,
          failure_detail = EXCLUDED.failure_detail,
          last_failed_at = EXCLUDED.last_failed_at,
          updated_at     = p_now;
  END IF;

  RETURN QUERY SELECT true, v_exhausted;
END;
$$;

COMMENT ON FUNCTION public.durable_outbox_settle(UUID, UUID, TEXT, INTEGER, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Mark a leased event dispatched, or failed — writing the dead-letter row in the SAME transaction when attempts are exhausted. False when the presented lease is not the live one.';

-- ---------------------------------------------------------------------------
-- 9. durable_outbox_recover_leases — a dispatcher that died
-- ---------------------------------------------------------------------------
--
-- Without this an event claimed into `dispatching` by a dispatcher that then
-- crashed stays `dispatching` forever: never delivered, never retried, never
-- dead-lettered, and invisible to the pending-backlog measure that is supposed
-- to notice exactly this. The job side had recovery from the start; the event
-- side did not, and a fact that is silently never published is the same class
-- of loss as work that is silently never run.
--
-- Recovery does not spend an attempt — the claim that lapsed already did.
CREATE OR REPLACE FUNCTION public.durable_outbox_recover_leases(
  p_now   TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS TABLE (recovered INTEGER, dead_lettered INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit     INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
  v_recovered INTEGER := 0;
  v_dead      INTEGER := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _durable_outbox_expired (id UUID PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _durable_outbox_expired;

  INSERT INTO _durable_outbox_expired (id)
  SELECT e.id
    FROM public.durable_outbox AS e
   WHERE e.dispatch_state = 'dispatching'
     AND e.lease_expires_at <= p_now
   ORDER BY e.lease_expires_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT v_limit;

  WITH exhausted AS (
    UPDATE public.durable_outbox AS e
       SET dispatch_state   = 'failed',
           lease_owner      = NULL,
           lease_expires_at = NULL,
           failure_code     = 'dispatch_abandoned',
           failure_detail   = 'the dispatcher holding this event stopped reporting and no attempts remain',
           updated_at       = p_now
     WHERE e.id IN (SELECT id FROM _durable_outbox_expired)
       AND e.attempt >= e.max_attempts
    RETURNING e.id, e.organization_id, e.event_type, e.attempt,
              e.correlation_id, e.causation_id, e.created_at
  ),
  recorded AS (
    INSERT INTO public.durable_dead_letters (
      organization_id, origin_kind, origin_id, origin_type,
      attempts, failure_code, failure_detail,
      correlation_id, causation_id, first_failed_at, last_failed_at
    )
    SELECT x.organization_id, 'event', x.id, x.event_type,
           GREATEST(x.attempt, 1), 'dispatch_abandoned',
           'the dispatcher holding this event stopped reporting and no attempts remain',
           x.correlation_id, x.causation_id, LEAST(x.created_at, p_now), p_now
      FROM exhausted x
    ON CONFLICT (organization_id, origin_kind, origin_id) DO UPDATE
      SET attempts = EXCLUDED.attempts, last_failed_at = EXCLUDED.last_failed_at, updated_at = p_now
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_dead FROM recorded;

  WITH requeued AS (
    UPDATE public.durable_outbox AS e
       SET dispatch_state   = 'pending',
           available_at     = p_now,
           lease_owner      = NULL,
           lease_expires_at = NULL,
           failure_code     = 'dispatch_lease_expired',
           failure_detail   = 'the dispatcher holding this event stopped reporting',
           updated_at       = p_now
     WHERE e.id IN (SELECT id FROM _durable_outbox_expired)
       AND e.dispatch_state = 'dispatching'
       AND e.attempt < e.max_attempts
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_recovered FROM requeued;

  RETURN QUERY SELECT v_recovered, v_dead;
END;
$$;

COMMENT ON FUNCTION public.durable_outbox_recover_leases(TIMESTAMPTZ, INTEGER) IS
  'Return abandoned dispatch leases to pending, or dead-letter them when no attempts remain. Never spends an attempt.';

-- ---------------------------------------------------------------------------
-- 10. durable_inbox_claim — the right to run a consumer, once, with a lease
-- ---------------------------------------------------------------------------
--
-- THE FUNCTION THAT REPLACES "INSERT `processed`, THEN RUN THE HANDLER".
--
-- That ordering claimed an effect before it happened. A process that died in
-- between left a permanent suppression for work that was never done, and a
-- handler that threw left a `failed` row that every later delivery conflicted
-- with — so the failed consumer sat out every retry while the event was marked
-- delivered. Both are LOST EFFECTS, not limitations.
--
-- This claims `processing` with a lease instead, and returns the row as it now
-- stands whatever happened. The caller reads the answer off the row:
--
--   status = processing AND lease_owner = me   I own it; run the handler
--   status = processed                         terminal; suppress, correctly
--   status = processing AND somebody else      in flight; do nothing, and do
--                                              NOT report success upstream
--
-- Returning the row in every case, rather than nothing on a conflict, is what
-- lets the caller tell "already done" from "somebody else is doing it". The
-- previous contract collapsed those into one `undefined` and the dispatcher
-- read both as success.
--
-- A `failed` row and an EXPIRED `processing` row are both re-claimable, which
-- is the whole point: the dispatcher will deliver again, and the consumer that
-- failed or died is the one that must run.
CREATE OR REPLACE FUNCTION public.durable_inbox_claim(
  p_organization_id UUID,
  p_consumer_key    TEXT,
  p_event_id        UUID,
  p_event_type      TEXT,
  p_correlation_id  TEXT,
  p_causation_id    TEXT,
  p_worker          TEXT,
  p_lease_ttl_ms    INTEGER,
  p_now             TIMESTAMPTZ
)
RETURNS SETOF public.durable_inbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.durable_inbox%ROWTYPE;
  v_ttl INTEGER;
BEGIN
  IF p_worker IS NULL OR length(trim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'durable_inbox_claim requires a consumer identity';
  END IF;
  v_ttl := LEAST(GREATEST(COALESCE(p_lease_ttl_ms, 60000), 1000), 3600000);

  SELECT * INTO v_row
    FROM public.durable_inbox
   WHERE organization_id = p_organization_id
     AND consumer_key    = p_consumer_key
     AND event_id        = p_event_id
   FOR UPDATE;

  IF NOT FOUND THEN
    -- First delivery. INSERT ... ON CONFLICT DO NOTHING rather than a plain
    -- insert, because two isolates can reach this line together; the loser
    -- re-reads and falls through to the in-flight answer below.
    INSERT INTO public.durable_inbox (
      organization_id, consumer_key, event_id, event_type,
      status, processed_at, attempt, lease_owner, lease_generation,
      lease_expires_at, correlation_id, causation_id
    )
    VALUES (
      p_organization_id, p_consumer_key, p_event_id, p_event_type,
      'processing', p_now, 1, p_worker, 1,
      p_now + make_interval(secs => v_ttl / 1000.0), p_correlation_id, p_causation_id
    )
    ON CONFLICT (organization_id, consumer_key, event_id) DO NOTHING
    RETURNING * INTO v_row;

    IF FOUND THEN
      RETURN NEXT v_row;
      RETURN;
    END IF;

    SELECT * INTO v_row
      FROM public.durable_inbox
     WHERE organization_id = p_organization_id
       AND consumer_key    = p_consumer_key
       AND event_id        = p_event_id
     FOR UPDATE;
  END IF;

  -- TERMINAL. The effect happened; suppressing every later delivery is the
  -- guarantee, not a failure.
  IF v_row.status = 'processed' THEN
    RETURN NEXT v_row;
    RETURN;
  END IF;

  -- Somebody else owns a live claim. Return it unchanged; the caller must not
  -- run the handler and must not report the delivery as done.
  IF v_row.status = 'processing' AND v_row.lease_expires_at > p_now THEN
    RETURN NEXT v_row;
    RETURN;
  END IF;

  -- `failed`, or a `processing` claim whose owner stopped reporting. Both are
  -- ours to take.
  UPDATE public.durable_inbox
     SET status           = 'processing',
         attempt          = attempt + 1,
         lease_owner      = p_worker,
         lease_generation = lease_generation + 1,
         lease_expires_at = p_now + make_interval(secs => v_ttl / 1000.0),
         failure_code     = NULL,
         failure_detail   = NULL,
         updated_at       = p_now
   WHERE organization_id = p_organization_id
     AND consumer_key    = p_consumer_key
     AND event_id        = p_event_id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
END;
$$;

COMMENT ON FUNCTION public.durable_inbox_claim(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ) IS
  'Claim the right to run one consumer on one event. Always returns the row as it stands: the caller owns it only when status is processing and lease_owner is theirs.';

-- ---------------------------------------------------------------------------
-- 11. durable_inbox_settle — only the owner, only a live claim
-- ---------------------------------------------------------------------------
--
-- A consumer that stalled past its lease, was recovered, and is now settling
-- under the lapsed claim would otherwise be able to mark `processed` an effect
-- a newer owner is still running — and `processed` is terminal, so that would
-- permanently suppress the delivery that was actually going to work.
CREATE OR REPLACE FUNCTION public.durable_inbox_settle(
  p_organization_id UUID,
  p_consumer_key    TEXT,
  p_event_id        UUID,
  p_worker          TEXT,
  p_generation      INTEGER,
  p_status          TEXT,
  p_failure_code    TEXT,
  p_failure_detail  TEXT,
  p_result          JSONB,
  p_now             TIMESTAMPTZ
)
RETURNS SETOF public.durable_inbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('processed', 'failed') THEN
    -- `processing` is a claim and is issued only by `durable_inbox_claim`.
    RAISE EXCEPTION 'durable_inbox_settle: % is not a settlement', p_status;
  END IF;

  RETURN QUERY
  UPDATE public.durable_inbox AS i
     SET status           = p_status,
         processed_at     = p_now,
         lease_owner      = NULL,
         lease_expires_at = NULL,
         failure_code     = p_failure_code,
         failure_detail   = p_failure_detail,
         result           = p_result,
         updated_at       = p_now
   WHERE i.organization_id  = p_organization_id
     AND i.consumer_key     = p_consumer_key
     AND i.event_id         = p_event_id
     AND i.status           = 'processing'
     AND i.lease_owner      = p_worker
     AND i.lease_generation = p_generation
     AND i.lease_expires_at > p_now
  RETURNING i.*;
END;
$$;

COMMENT ON FUNCTION public.durable_inbox_settle(UUID, TEXT, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ) IS
  'Record how one consumer''s processing went. Returns no row when the presented claim is not the live one.';

-- ---------------------------------------------------------------------------
-- 12. durable_inbox_recover_claims — a consumer that died mid-effect
-- ---------------------------------------------------------------------------
--
-- Returns abandoned claims to `failed` rather than deleting them, so the
-- attempt history survives and an operator can see that something died here.
-- `failed` is re-claimable, which is what makes the next delivery run.
--
-- A claim is NOT recovered into `processed`. Whether the effect happened is
-- exactly what nobody knows when a consumer dies mid-handler, and guessing yes
-- is the guess that loses the effect permanently.
CREATE OR REPLACE FUNCTION public.durable_inbox_recover_claims(
  p_now   TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit     INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
  v_recovered INTEGER := 0;
BEGIN
  WITH expired AS (
    SELECT i.id
      FROM public.durable_inbox AS i
     WHERE i.status = 'processing'
       AND i.lease_expires_at <= p_now
     ORDER BY i.lease_expires_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT v_limit
  ),
  released AS (
    UPDATE public.durable_inbox AS i
       SET status           = 'failed',
           lease_owner      = NULL,
           lease_expires_at = NULL,
           failure_code     = 'consumer_abandoned',
           failure_detail   = 'the consumer holding this delivery stopped reporting',
           updated_at       = p_now
     WHERE i.id IN (SELECT id FROM expired)
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_recovered FROM released;

  RETURN v_recovered;
END;
$$;

COMMENT ON FUNCTION public.durable_inbox_recover_claims(TIMESTAMPTZ, INTEGER) IS
  'Release abandoned processing claims to failed, so the next delivery re-runs them. Never recovers into processed.';

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

REVOKE ALL ON FUNCTION public.durable_job_transition(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_outbox_claim(UUID, TEXT, INTEGER, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_outbox_settle(UUID, UUID, TEXT, INTEGER, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_outbox_recover_leases(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_inbox_claim(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_inbox_settle(UUID, TEXT, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.durable_inbox_recover_claims(TIMESTAMPTZ, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.durable_job_transition(UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_outbox_claim(UUID, TEXT, INTEGER, TIMESTAMPTZ, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_outbox_settle(UUID, UUID, TEXT, INTEGER, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_outbox_recover_leases(TIMESTAMPTZ, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_inbox_claim(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_inbox_settle(UUID, TEXT, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.durable_inbox_recover_claims(TIMESTAMPTZ, INTEGER) TO service_role;

COMMIT;
