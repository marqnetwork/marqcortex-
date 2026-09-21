-- ============================================================================
-- BP-003 / A2 — WORKFLOW RUNTIME PERSISTENCE: THE ATOMIC OPERATIONS
--
-- Twelve functions, and EVERY operation the three stores perform is one of
-- them. There is no generic select, no filter object and no query builder
-- anywhere in the adapter that calls these, which is what makes a cross-tenant
-- read unexpressible rather than merely unwritten: every function below takes
-- `p_organization_id` and scopes every predicate by it, so there is no
-- argument through which a caller holding one tenant's context can reach
-- another tenant's row.
--
--   workflow_run_create          a run id is taken exactly once
--   workflow_run_save            a version race resolves to one winner
--   workflow_run_load            one run, in one tenant
--   workflow_run_list            the filtered, ordered, bounded listing
--   workflow_checkpoint_append   a checkpoint version is written exactly once
--   workflow_checkpoint_read     one version
--   workflow_checkpoint_latest   the highest version
--   workflow_checkpoint_history  every version, numerically ordered
--   workflow_approval_create     an approval id is taken exactly once
--   workflow_approval_save       a decision race resolves to one decision
--   workflow_approval_load       one approval, in one tenant
--   workflow_approval_list       the operator queue and the per-run listing
--
-- ── THE ARBITRATION IS THE STATEMENT, NOT THE FUNCTION AROUND IT ───────────
--
-- `workflow_run_create` is one `INSERT ... ON CONFLICT DO NOTHING`.
-- `workflow_run_save` is one `UPDATE ... WHERE run_version = p_expected`.
-- Neither reads first and decides afterwards, because between a read and a
-- write is a window in which another isolate does the same thing — and for a
-- workflow run that window means two isolates each starting "the next node",
-- which is two child agent runs with two sets of effects.
--
-- The classifying SELECT after a failed save is NOT part of the arbitration.
-- The write has already lost by the time it runs; all it decides is which
-- sentence the caller is told, and it cannot turn a loss into a win.
--
-- ── WHY THE SAVES RETURN A WORD AND NOT A BOOLEAN ─────────────────────────
--
-- `saved`, `stale`, `missing`. SQL can tell "this run moved on" from "this run
-- was never here"; the key-value compare-and-swap cannot, and it reports both
-- as a lost swap.
--
-- THE ADAPTER DELIBERATELY COLLAPSES THE TWO, so the SQL stores present the
-- behaviour the CURRENT AUTHORITY presents rather than a better one. This
-- packet's acceptance gate is parity with what production does today; a store
-- that raised a more precise failure would be a store whose callers behave
-- differently after a cutover, which is exactly the thing a parity gate exists
-- to prevent. The richer signal is returned here and discarded there, so a
-- later packet can adopt it deliberately rather than rediscover it.
--
-- ── EVERY FUNCTION TAKES ITS TIMESTAMPS ───────────────────────────────────
--
-- Rather than reading `now()` inside, for the reason the durable runtime's
-- functions give: the runtime already has a `Clock` port that tests drive by
-- hand, and a function that reads the wall clock makes the half of a behaviour
-- that lives in SQL untestable by the harness that tests the other half. The
-- timestamps written here are the DOMAIN's — the record's own `createdAt` and
-- `updatedAt` — so the ordering an index serves is the ordering the domain
-- sorts by.
--
-- ── ORDERING: `WITH TIES`, AND WHY IT IS NOT DECORATION ───────────────────
--
-- The domain sorts in TypeScript — `sortWorkflowRuns`, `sortWorkflowApprovals`
-- in `persistence/ports.ts` — and both break ties on an identifier using
-- JavaScript's `localeCompare`. PostgreSQL cannot reproduce that ordering: for
-- `node_b` and `node-b` it disagrees with `localeCompare` under the default
-- collation AND under `"C"`. So these functions do NOT try to be the sort.
-- They order on the timestamp alone and use `FETCH FIRST n ROWS WITH TIES`, so
-- every row sharing the boundary instant comes back and the domain sort — the
-- same function the key-value store calls — decides the tie and the cut. The
-- listing is bounded, the ordering is the ports' own, and the two
-- implementations cannot disagree because only one of them is sorting.
--
-- Apply: staging/local only until explicitly approved for production.
-- Rollback: supabase/migrations/rollbacks/20260921120000_rollback_workflow_persistence.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. workflow_run_create — insert-if-absent
-- ---------------------------------------------------------------------------
--
-- Returns TRUE when this call created the run and FALSE when the id was
-- already taken. FALSE rather than an exception because a taken run id is an
-- ordinary thing for the engine to discover — the store turns it into a typed
-- `workflow_persistence_failed` — and because an exception would abort a
-- transaction the caller may be sharing.
CREATE OR REPLACE FUNCTION public.workflow_run_create(
  p_organization_id    UUID,
  p_workflow_run_id    TEXT,
  p_workflow_id        TEXT,
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
    RAISE EXCEPTION 'workflow_run_create requires an organization';
  END IF;
  IF p_workflow_run_id IS NULL OR length(trim(p_workflow_run_id)) = 0 THEN
    RAISE EXCEPTION 'workflow_run_create requires a workflow run id';
  END IF;

  INSERT INTO public.workflow_runs (
    organization_id, workflow_run_id, workflow_id, actor_id, state,
    run_version, checkpoint_version, created_at, updated_at, record
  ) VALUES (
    p_organization_id, p_workflow_run_id, p_workflow_id, p_actor_id, p_state,
    p_run_version, COALESCE(p_checkpoint_version, 0), p_created_at, p_updated_at, p_record
  )
  ON CONFLICT (organization_id, workflow_run_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

COMMENT ON FUNCTION public.workflow_run_create(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) IS
  'BP-003 — insert a workflow run if the id is free. FALSE means the id was taken; an existing run is never overwritten.';

-- ---------------------------------------------------------------------------
-- 2. workflow_run_save — the version compare-and-swap
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_run_save(
  p_organization_id    UUID,
  p_workflow_run_id    TEXT,
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
    RAISE EXCEPTION 'workflow_run_save requires an organization';
  END IF;

  -- THE ARBITRATION. One statement: the comparison and the write are the same
  -- operation, so two isolates that both read version N cannot both write N+1.
  UPDATE public.workflow_runs AS r
     SET state              = p_state,
         run_version        = p_run_version,
         checkpoint_version = COALESCE(p_checkpoint_version, r.checkpoint_version),
         updated_at         = p_updated_at,
         row_written_at     = now(),
         record             = p_record
   WHERE r.organization_id = p_organization_id
     AND r.workflow_run_id = p_workflow_run_id
     AND r.run_version     = p_expected_version;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN 'saved';
  END IF;

  -- The write has already lost. This only decides which word the caller hears.
  IF EXISTS (
    SELECT 1 FROM public.workflow_runs r
     WHERE r.organization_id = p_organization_id
       AND r.workflow_run_id = p_workflow_run_id
  ) THEN
    RETURN 'stale';
  END IF;
  RETURN 'missing';
END;
$$;

COMMENT ON FUNCTION public.workflow_run_save(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB) IS
  'BP-003 — write a run only where run_version still matches what the caller read. saved | stale | missing.';

-- ---------------------------------------------------------------------------
-- 3. workflow_run_load / 4. workflow_run_list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workflow_run_load(
  p_organization_id UUID,
  p_workflow_run_id TEXT
)
RETURNS SETOF public.workflow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'workflow_run_load requires an organization';
  END IF;
  RETURN QUERY
    SELECT r.* FROM public.workflow_runs r
     WHERE r.organization_id = p_organization_id
       AND r.workflow_run_id = p_workflow_run_id;
END;
$$;

COMMENT ON FUNCTION public.workflow_run_load(UUID, TEXT) IS
  'BP-003 — one run, in one tenant. Zero rows is the honest answer for a run another tenant owns.';

-- The listing. NULL narrows nothing — the three optional filters mirror
-- `WorkflowRunQuery`, where every field narrows and none widens.
CREATE OR REPLACE FUNCTION public.workflow_run_list(
  p_organization_id UUID,
  p_states          TEXT[],
  p_workflow_id     TEXT,
  p_actor_id        TEXT,
  p_limit           INTEGER
)
RETURNS SETOF public.workflow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'workflow_run_list requires an organization';
  END IF;

  -- The ports' own bounds — default 50, ceiling 200 — restated so a caller
  -- that bypassed `boundedLimit` still cannot ask for an unbounded scan.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  -- Newest first, and WITH TIES so the domain sort sees every row that shares
  -- the boundary instant. See the header for why this is not the sort.
  RETURN QUERY
    SELECT r.* FROM public.workflow_runs r
     WHERE r.organization_id = p_organization_id
       AND (p_states IS NULL OR cardinality(p_states) = 0 OR r.state = ANY (p_states))
       AND (p_workflow_id IS NULL OR r.workflow_id = p_workflow_id)
       AND (p_actor_id IS NULL OR r.actor_id = p_actor_id)
     ORDER BY r.created_at DESC
     FETCH FIRST v_limit ROWS WITH TIES;
END;
$$;

COMMENT ON FUNCTION public.workflow_run_list(UUID, TEXT[], TEXT, TEXT, INTEGER) IS
  'BP-003 — one tenant''s runs, narrowed, newest first, bounded, with every boundary tie included for the domain sort.';

-- ---------------------------------------------------------------------------
-- 5. workflow_checkpoint_append — written once, read forever
-- ---------------------------------------------------------------------------
--
-- The primary key IS the guarantee. There is no version to compare against
-- because a checkpoint's version never moves — it is the identity — so a
-- second write of the same version is a key collision rather than a lost
-- update, and the collision is what the store turns into
-- `workflow_checkpoint_conflict`.
CREATE OR REPLACE FUNCTION public.workflow_checkpoint_append(
  p_organization_id UUID,
  p_workflow_run_id TEXT,
  p_version         INTEGER,
  p_digest          TEXT,
  p_previous_digest TEXT,
  p_node_id         TEXT,
  p_state           TEXT,
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
    RAISE EXCEPTION 'workflow_checkpoint_append requires an organization';
  END IF;

  INSERT INTO public.workflow_checkpoints (
    organization_id, workflow_run_id, version, digest, previous_digest,
    node_id, state, created_at, record
  ) VALUES (
    p_organization_id, p_workflow_run_id, p_version, p_digest, p_previous_digest,
    p_node_id, p_state, p_created_at, p_record
  )
  ON CONFLICT (organization_id, workflow_run_id, version) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

COMMENT ON FUNCTION public.workflow_checkpoint_append(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) IS
  'BP-003 — append one checkpoint. FALSE means that version already exists; a written checkpoint is never overwritten.';

CREATE OR REPLACE FUNCTION public.workflow_checkpoint_read(
  p_organization_id UUID,
  p_workflow_run_id TEXT,
  p_version         INTEGER
)
RETURNS SETOF public.workflow_checkpoints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'workflow_checkpoint_read requires an organization';
  END IF;
  RETURN QUERY
    SELECT c.* FROM public.workflow_checkpoints c
     WHERE c.organization_id = p_organization_id
       AND c.workflow_run_id = p_workflow_run_id
       AND c.version         = p_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.workflow_checkpoint_latest(
  p_organization_id UUID,
  p_workflow_run_id TEXT
)
RETURNS SETOF public.workflow_checkpoints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'workflow_checkpoint_latest requires an organization';
  END IF;
  -- NUMERIC ordering, on a column that is an integer. The key-value store
  -- zero-pads its versions to six digits because a lexicographic prefix scan
  -- has no other way to sort them; nothing here needs that arrangement, and
  -- "the latest checkpoint" is an index read rather than a re-scan.
  RETURN QUERY
    SELECT c.* FROM public.workflow_checkpoints c
     WHERE c.organization_id = p_organization_id
       AND c.workflow_run_id = p_workflow_run_id
     ORDER BY c.version DESC
     LIMIT 1;
END;
$$;

-- Every checkpoint, oldest first, and DELIBERATELY UNBOUNDED. The run's own
-- ceiling bounds it — `WORKFLOW_RUN_BOUNDS.maxCheckpoints` is 256, one per
-- node execution, and the table's CHECK refuses a higher version — so a limit
-- here could only ever truncate a history the key-value store returns whole.
-- Recovery verifies the chain link by link; a silently short history is a
-- chain that verifies and is not the one the run wrote.
CREATE OR REPLACE FUNCTION public.workflow_checkpoint_history(
  p_organization_id UUID,
  p_workflow_run_id TEXT
)
RETURNS SETOF public.workflow_checkpoints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'workflow_checkpoint_history requires an organization';
  END IF;
  RETURN QUERY
    SELECT c.* FROM public.workflow_checkpoints c
     WHERE c.organization_id = p_organization_id
       AND c.workflow_run_id = p_workflow_run_id
     ORDER BY c.version ASC;
END;
$$;

COMMENT ON FUNCTION public.workflow_checkpoint_history(UUID, TEXT) IS
  'BP-003 — a run''s whole checkpoint chain, numerically ordered. Unbounded on purpose: the run''s own ceiling bounds it.';

-- ---------------------------------------------------------------------------
-- 6. workflow_approval_create / save / load / list
-- ---------------------------------------------------------------------------
--
-- Insert-if-absent, for the reason `contracts/approval.ts` gives: the engine
-- derives approval ids deterministically, so a duplicate is not a collision —
-- it is a retried advance recomputing the id of a request it already made.
-- Refusing rather than overwriting is what lets the gate tell those apart.
CREATE OR REPLACE FUNCTION public.workflow_approval_create(
  p_organization_id      UUID,
  p_workflow_approval_id TEXT,
  p_workflow_run_id      TEXT,
  p_workflow_id          TEXT,
  p_node_id              TEXT,
  p_branch_id            TEXT,
  p_approval_state       TEXT,
  p_approval_version     INTEGER,
  p_created_at           TIMESTAMPTZ,
  p_expires_at           TIMESTAMPTZ,
  p_decided_at           TIMESTAMPTZ,
  p_consumed_at          TIMESTAMPTZ,
  p_updated_at           TIMESTAMPTZ,
  p_record               JSONB
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
    RAISE EXCEPTION 'workflow_approval_create requires an organization';
  END IF;

  INSERT INTO public.workflow_approvals (
    organization_id, workflow_approval_id, workflow_run_id, workflow_id,
    node_id, branch_id, approval_state, approval_version,
    created_at, expires_at, decided_at, consumed_at, updated_at, record
  ) VALUES (
    p_organization_id, p_workflow_approval_id, p_workflow_run_id, p_workflow_id,
    p_node_id, p_branch_id, p_approval_state, p_approval_version,
    p_created_at, p_expires_at, p_decided_at, p_consumed_at, p_updated_at, p_record
  )
  ON CONFLICT (organization_id, workflow_approval_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

COMMENT ON FUNCTION public.workflow_approval_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) IS
  'BP-003 — insert an approval if the deterministic id is free. FALSE means a pending decision already exists and is not overwritten.';

-- THE SINGLE-USE GUARANTEE, AS ONE STATEMENT. Two advances racing to spend one
-- approved request both read version N and both try to write N+1; exactly one
-- UPDATE matches, and the loser is told the approval moved.
CREATE OR REPLACE FUNCTION public.workflow_approval_save(
  p_organization_id      UUID,
  p_workflow_approval_id TEXT,
  p_expected_version     INTEGER,
  p_approval_state       TEXT,
  p_approval_version     INTEGER,
  p_decided_at           TIMESTAMPTZ,
  p_consumed_at          TIMESTAMPTZ,
  p_updated_at           TIMESTAMPTZ,
  p_record               JSONB
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
    RAISE EXCEPTION 'workflow_approval_save requires an organization';
  END IF;

  UPDATE public.workflow_approvals AS a
     SET approval_state   = p_approval_state,
         approval_version = p_approval_version,
         decided_at       = p_decided_at,
         consumed_at      = p_consumed_at,
         updated_at       = p_updated_at,
         row_written_at   = now(),
         record           = p_record
   WHERE a.organization_id      = p_organization_id
     AND a.workflow_approval_id = p_workflow_approval_id
     AND a.approval_version     = p_expected_version;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN 'saved';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workflow_approvals a
     WHERE a.organization_id      = p_organization_id
       AND a.workflow_approval_id = p_workflow_approval_id
  ) THEN
    RETURN 'stale';
  END IF;
  RETURN 'missing';
END;
$$;

COMMENT ON FUNCTION public.workflow_approval_save(UUID, TEXT, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) IS
  'BP-003 — write a decision only where approval_version still matches. saved | stale | missing. This is the single-use guarantee.';

CREATE OR REPLACE FUNCTION public.workflow_approval_load(
  p_organization_id      UUID,
  p_workflow_approval_id TEXT
)
RETURNS SETOF public.workflow_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'workflow_approval_load requires an organization';
  END IF;
  RETURN QUERY
    SELECT a.* FROM public.workflow_approvals a
     WHERE a.organization_id      = p_organization_id
       AND a.workflow_approval_id = p_workflow_approval_id;
END;
$$;

-- OLDEST FIRST, and this is the one listing that is not newest first. An
-- approval queue is work, not history: the request that has been waiting
-- longest is the one closest to expiring and the one holding a run up.
CREATE OR REPLACE FUNCTION public.workflow_approval_list(
  p_organization_id UUID,
  p_workflow_run_id TEXT,
  p_pending_only    BOOLEAN,
  p_limit           INTEGER
)
RETURNS SETOF public.workflow_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'workflow_approval_list requires an organization';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  RETURN QUERY
    SELECT a.* FROM public.workflow_approvals a
     WHERE a.organization_id = p_organization_id
       AND (p_workflow_run_id IS NULL OR a.workflow_run_id = p_workflow_run_id)
       AND (COALESCE(p_pending_only, FALSE) = FALSE OR a.approval_state = 'pending')
     ORDER BY a.created_at ASC
     FETCH FIRST v_limit ROWS WITH TIES;
END;
$$;

COMMENT ON FUNCTION public.workflow_approval_list(UUID, TEXT, BOOLEAN, INTEGER) IS
  'BP-003 — one tenant''s approvals, narrowed, oldest first, bounded, with every boundary tie included for the domain sort.';

-- ---------------------------------------------------------------------------
-- 7. Privilege — the runtime writes, and nobody else executes
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER lets these write tables on which `authenticated` holds
-- SELECT and nothing else. That is a statement about WHO WRITES and not about
-- authority: the BUSINESS question — may this actor start, advance, decide or
-- cancel this run — is answered before any of these is reached, by the
-- workflow service's own RBAC, and none of these functions can answer it or
-- override it.
REVOKE ALL ON FUNCTION public.workflow_run_create(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_run_save(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_run_load(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_run_list(UUID, TEXT[], TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_checkpoint_append(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_checkpoint_read(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_checkpoint_latest(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_checkpoint_history(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_approval_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_approval_save(UUID, TEXT, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_approval_load(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_approval_list(UUID, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.workflow_run_create(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_run_save(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_run_load(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_run_list(UUID, TEXT[], TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_checkpoint_append(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_checkpoint_read(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_checkpoint_latest(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_checkpoint_history(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_approval_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_approval_save(UUID, TEXT, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_approval_load(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_approval_list(UUID, TEXT, BOOLEAN, INTEGER) TO service_role;

COMMIT;
