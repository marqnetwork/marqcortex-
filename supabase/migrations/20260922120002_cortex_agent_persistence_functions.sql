-- ============================================================================
-- A2-P07 — AGENT RUNTIME PERSISTENCE: THE ATOMIC OPERATIONS
--
-- Twelve functions, and every operation the three agent stores perform is one
-- of them. Each takes `p_organization_id` and scopes every predicate by it, so
-- there is no argument through which a caller acting for one tenant can reach
-- another tenant's row.
--
--   agent_run_create          a run id is taken exactly once
--   agent_run_save            a version race resolves to one winner
--   agent_run_load            one run, in one tenant
--   agent_run_list            the filtered, bounded listing
--   agent_checkpoint_append   a checkpoint version is written exactly once
--   agent_checkpoint_read     one version
--   agent_checkpoint_latest   the highest version
--   agent_checkpoint_history  every version, numerically ordered
--   agent_approval_create     an approval id is taken exactly once
--   agent_approval_save       a decision race resolves to one decision
--   agent_approval_load       one approval, in one tenant
--   agent_approval_list       the operator queue and the per-run listing
--
-- ── THE ARBITRATION IS THE STATEMENT ──────────────────────────────────────
--
-- Create is one `INSERT ... ON CONFLICT DO NOTHING`; save is one
-- `UPDATE ... WHERE run_version = p_expected_version`. Nothing reads and then
-- decides — the key-value store's `kv_compare_and_swap_field` makes the same
-- promise, and a TypeScript read-then-write would give two isolates each "the
-- next step" of one agent run, which is two model calls and two tool effects.
-- The classifying SELECT after a failed save only picks the word the caller
-- hears; the write has already lost.
--
-- `saved | stale | missing`. The adapter collapses `missing` into the stale
-- failure because that is what the production authority reports today (the
-- key-value compare-and-swap cannot tell the two apart), and parity with
-- production is the acceptance gate. The richer word stays available here.
--
-- ── TIMESTAMPS ARE PASSED IN, AND ORDERING IS THE DOMAIN'S ────────────────
--
-- The domain's own stamps, never `now()`, so the ordering the index serves is
-- the ordering the domain sorts by and the harness clock drives both halves.
-- Listings order on the timestamp alone with `FETCH FIRST n ROWS WITH TIES`
-- and leave the final sort and cut to the SAME TypeScript comparators the
-- memory and key-value stores use (`persistence/ports.ts`), for BP-003's
-- reason: PostgreSQL collation cannot reproduce `localeCompare`, so only one
-- layer may decide a tie.
--
-- Apply: staging/local only until explicitly approved for production.
-- Rollback: supabase/migrations/rollbacks/20260922120000_rollback_agent_persistence.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Runs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_run_create(
  p_organization_id    UUID,
  p_agent_run_id       TEXT,
  p_agent_id           TEXT,
  p_actor_id           TEXT,
  p_state              TEXT,
  p_run_version        INTEGER,
  p_checkpoint_version INTEGER,
  p_created_at         TIMESTAMPTZ,
  p_updated_at         TIMESTAMPTZ,
  p_record             JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_run_create requires an organization';
  END IF;
  IF p_agent_run_id IS NULL OR length(trim(p_agent_run_id)) = 0 THEN
    RAISE EXCEPTION 'agent_run_create requires an agent run id';
  END IF;

  INSERT INTO public.agent_runs (
    organization_id, agent_run_id, agent_id, actor_id, state,
    run_version, checkpoint_version, created_at, updated_at, record
  ) VALUES (
    p_organization_id, p_agent_run_id, p_agent_id, p_actor_id, p_state,
    p_run_version, COALESCE(p_checkpoint_version, 0), p_created_at, p_updated_at, p_record
  )
  ON CONFLICT (organization_id, agent_run_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

COMMENT ON FUNCTION public.agent_run_create(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) IS
  'A2-P07 — insert an agent run if the id is free. FALSE means the id was taken; an existing run is never overwritten.';

CREATE OR REPLACE FUNCTION public.agent_run_save(
  p_organization_id    UUID,
  p_agent_run_id       TEXT,
  p_expected_version   INTEGER,
  p_state              TEXT,
  p_run_version        INTEGER,
  p_checkpoint_version INTEGER,
  p_updated_at         TIMESTAMPTZ,
  p_record             JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_run_save requires an organization';
  END IF;

  -- THE ARBITRATION: the comparison and the write are one statement.
  UPDATE public.agent_runs AS r
     SET state              = p_state,
         run_version        = p_run_version,
         checkpoint_version = COALESCE(p_checkpoint_version, r.checkpoint_version),
         updated_at         = p_updated_at,
         row_written_at     = now(),
         record             = p_record
   WHERE r.organization_id = p_organization_id
     AND r.agent_run_id    = p_agent_run_id
     AND r.run_version     = p_expected_version;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN 'saved';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agent_runs r
     WHERE r.organization_id = p_organization_id
       AND r.agent_run_id    = p_agent_run_id
  ) THEN
    RETURN 'stale';
  END IF;
  RETURN 'missing';
END;
$$;

COMMENT ON FUNCTION public.agent_run_save(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB) IS
  'A2-P07 — write an agent run only where run_version still matches what the caller read. saved | stale | missing.';

CREATE OR REPLACE FUNCTION public.agent_run_load(
  p_organization_id UUID,
  p_agent_run_id    TEXT
)
RETURNS SETOF public.agent_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_run_load requires an organization';
  END IF;
  RETURN QUERY
    SELECT r.* FROM public.agent_runs r
     WHERE r.organization_id = p_organization_id
       AND r.agent_run_id    = p_agent_run_id;
END;
$$;

-- NULL narrows nothing: the optional filters mirror `AgentRunQuery`.
CREATE OR REPLACE FUNCTION public.agent_run_list(
  p_organization_id UUID,
  p_states          TEXT[],
  p_agent_id        TEXT,
  p_actor_id        TEXT,
  p_limit           INTEGER
)
RETURNS SETOF public.agent_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_run_list requires an organization';
  END IF;

  -- The ports' own bounds — default 50, ceiling 200 — restated here.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  RETURN QUERY
    SELECT r.* FROM public.agent_runs r
     WHERE r.organization_id = p_organization_id
       AND (p_states IS NULL OR cardinality(p_states) = 0 OR r.state = ANY (p_states))
       AND (p_agent_id IS NULL OR r.agent_id = p_agent_id)
       AND (p_actor_id IS NULL OR r.actor_id = p_actor_id)
     ORDER BY r.created_at DESC
     FETCH FIRST v_limit ROWS WITH TIES;
END;
$$;

COMMENT ON FUNCTION public.agent_run_list(UUID, TEXT[], TEXT, TEXT, INTEGER) IS
  'A2-P07 — one tenant''s agent runs, narrowed, newest first, bounded, every boundary tie included for the domain sort.';

-- ---------------------------------------------------------------------------
-- 2. Checkpoints — written once, read forever
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_checkpoint_append(
  p_organization_id UUID,
  p_agent_run_id    TEXT,
  p_version         INTEGER,
  p_progress_digest TEXT,
  p_previous_digest TEXT,
  p_agent_id        TEXT,
  p_state           TEXT,
  p_step_count      INTEGER,
  p_created_at      TIMESTAMPTZ,
  p_record          JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_checkpoint_append requires an organization';
  END IF;

  INSERT INTO public.agent_checkpoints (
    organization_id, agent_run_id, version, progress_digest, previous_digest,
    agent_id, state, step_count, created_at, record
  ) VALUES (
    p_organization_id, p_agent_run_id, p_version, p_progress_digest, p_previous_digest,
    p_agent_id, p_state, p_step_count, p_created_at, p_record
  )
  ON CONFLICT (organization_id, agent_run_id, version) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

COMMENT ON FUNCTION public.agent_checkpoint_append(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, JSONB) IS
  'A2-P07 — append one agent checkpoint. FALSE means that version already exists; a written checkpoint is never overwritten.';

CREATE OR REPLACE FUNCTION public.agent_checkpoint_read(
  p_organization_id UUID,
  p_agent_run_id    TEXT,
  p_version         INTEGER
)
RETURNS SETOF public.agent_checkpoints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_checkpoint_read requires an organization';
  END IF;
  RETURN QUERY
    SELECT c.* FROM public.agent_checkpoints c
     WHERE c.organization_id = p_organization_id
       AND c.agent_run_id    = p_agent_run_id
       AND c.version         = p_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_checkpoint_latest(
  p_organization_id UUID,
  p_agent_run_id    TEXT
)
RETURNS SETOF public.agent_checkpoints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_checkpoint_latest requires an organization';
  END IF;
  -- The highest version, whatever the run's pointer says — exactly what the
  -- key-value store's `latest()` returns, and exactly what the orchestrator's
  -- `writeCheckpoint` chains from.
  RETURN QUERY
    SELECT c.* FROM public.agent_checkpoints c
     WHERE c.organization_id = p_organization_id
       AND c.agent_run_id    = p_agent_run_id
     ORDER BY c.version DESC
     LIMIT 1;
END;
$$;

-- Unbounded on purpose: the table's version ceiling bounds it, and a silently
-- truncated history is a history that is not the one the run wrote.
CREATE OR REPLACE FUNCTION public.agent_checkpoint_history(
  p_organization_id UUID,
  p_agent_run_id    TEXT
)
RETURNS SETOF public.agent_checkpoints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_checkpoint_history requires an organization';
  END IF;
  RETURN QUERY
    SELECT c.* FROM public.agent_checkpoints c
     WHERE c.organization_id = p_organization_id
       AND c.agent_run_id    = p_agent_run_id
     ORDER BY c.version ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Approvals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_approval_create(
  p_organization_id     UUID,
  p_agent_approval_id   TEXT,
  p_agent_run_id        TEXT,
  p_action_id           TEXT,
  p_requesting_agent_id TEXT,
  p_approval_state      TEXT,
  p_approval_version    INTEGER,
  p_created_at          TIMESTAMPTZ,
  p_expires_at          TIMESTAMPTZ,
  p_decided_at          TIMESTAMPTZ,
  p_consumed_at         TIMESTAMPTZ,
  p_updated_at          TIMESTAMPTZ,
  p_record              JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_approval_create requires an organization';
  END IF;

  INSERT INTO public.agent_approvals (
    organization_id, agent_approval_id, agent_run_id, action_id, requesting_agent_id,
    approval_state, approval_version, created_at, expires_at, decided_at,
    consumed_at, updated_at, record
  ) VALUES (
    p_organization_id, p_agent_approval_id, p_agent_run_id, p_action_id, p_requesting_agent_id,
    p_approval_state, p_approval_version, p_created_at, p_expires_at, p_decided_at,
    p_consumed_at, p_updated_at, p_record
  )
  ON CONFLICT (organization_id, agent_approval_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

COMMENT ON FUNCTION public.agent_approval_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) IS
  'A2-P07 — insert an agent approval if the id is free. FALSE means it was taken; nobody''s pending decision is overwritten.';

-- THE SINGLE-USE GUARANTEE, AS ONE STATEMENT.
CREATE OR REPLACE FUNCTION public.agent_approval_save(
  p_organization_id   UUID,
  p_agent_approval_id TEXT,
  p_expected_version  INTEGER,
  p_approval_state    TEXT,
  p_approval_version  INTEGER,
  p_decided_at        TIMESTAMPTZ,
  p_consumed_at       TIMESTAMPTZ,
  p_updated_at        TIMESTAMPTZ,
  p_record            JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_approval_save requires an organization';
  END IF;

  UPDATE public.agent_approvals AS a
     SET approval_state   = p_approval_state,
         approval_version = p_approval_version,
         decided_at       = p_decided_at,
         consumed_at      = p_consumed_at,
         updated_at       = p_updated_at,
         row_written_at   = now(),
         record           = p_record
   WHERE a.organization_id   = p_organization_id
     AND a.agent_approval_id = p_agent_approval_id
     AND a.approval_version  = p_expected_version;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN 'saved';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agent_approvals a
     WHERE a.organization_id   = p_organization_id
       AND a.agent_approval_id = p_agent_approval_id
  ) THEN
    RETURN 'stale';
  END IF;
  RETURN 'missing';
END;
$$;

COMMENT ON FUNCTION public.agent_approval_save(UUID, TEXT, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) IS
  'A2-P07 — write an approval only where approval_version still matches. saved | stale | missing. The single-use guarantee.';

CREATE OR REPLACE FUNCTION public.agent_approval_load(
  p_organization_id   UUID,
  p_agent_approval_id TEXT
)
RETURNS SETOF public.agent_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_approval_load requires an organization';
  END IF;
  RETURN QUERY
    SELECT a.* FROM public.agent_approvals a
     WHERE a.organization_id   = p_organization_id
       AND a.agent_approval_id = p_agent_approval_id;
END;
$$;

-- NEWEST FIRST — the agent ports' order (`byNewest`), not the workflow queue's.
CREATE OR REPLACE FUNCTION public.agent_approval_list(
  p_organization_id UUID,
  p_agent_run_id    TEXT,
  p_pending_only    BOOLEAN,
  p_limit           INTEGER
)
RETURNS SETOF public.agent_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'agent_approval_list requires an organization';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  RETURN QUERY
    SELECT a.* FROM public.agent_approvals a
     WHERE a.organization_id = p_organization_id
       AND (p_agent_run_id IS NULL OR a.agent_run_id = p_agent_run_id)
       AND (COALESCE(p_pending_only, FALSE) = FALSE OR a.approval_state = 'pending')
     ORDER BY a.created_at DESC
     FETCH FIRST v_limit ROWS WITH TIES;
END;
$$;

COMMENT ON FUNCTION public.agent_approval_list(UUID, TEXT, BOOLEAN, INTEGER) IS
  'A2-P07 — one tenant''s agent approvals, narrowed, newest first, bounded, every boundary tie included for the domain sort.';

-- ---------------------------------------------------------------------------
-- 4. Privilege — the runtime executes, nobody else does
-- ---------------------------------------------------------------------------
--
-- WHO WRITES, not who is authorized: may this actor start, decide or cancel
-- this run is answered by the agent SERVICE before any of these is reached.
REVOKE ALL ON FUNCTION public.agent_run_create(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_run_save(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_run_load(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_run_list(UUID, TEXT[], TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_checkpoint_append(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_checkpoint_read(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_checkpoint_latest(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_checkpoint_history(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_approval_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_approval_save(UUID, TEXT, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_approval_load(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_approval_list(UUID, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.agent_run_create(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_save(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_load(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_run_list(UUID, TEXT[], TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_checkpoint_append(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_checkpoint_read(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_checkpoint_latest(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_checkpoint_history(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_approval_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_approval_save(UUID, TEXT, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_approval_load(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_approval_list(UUID, TEXT, BOOLEAN, INTEGER) TO service_role;

COMMIT;
