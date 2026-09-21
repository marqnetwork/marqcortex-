-- ============================================================================
-- BP-003 / A2 — WORKFLOW RUNTIME PERSISTENCE: THE RELATIONAL AUTHORITY
--
-- Three tables that hold what `ai/workflows/persistence/kvWorkflowStores.ts`
-- holds today, under the SAME three ports. NOTHING HERE IS AUTHORITATIVE YET.
-- The production bootstrap still constructs the key-value stores, this packet
-- does not change it, and these tables exist to be PROVEN equivalent before a
-- later, separately reviewed packet decides whether anything moves.
--
-- ── WHY THE RECORD STAYS WHOLE ─────────────────────────────────────────────
--
-- A workflow run record is a designed object — `contracts/run.ts` argues for
-- every field it carries and for the several it refuses to carry. Normalizing
-- its steps, transitions, parallel groups, retries and usage ledger into five
-- more tables would not make the storage better; it would make the CONTRACT
-- different, and this packet is explicitly the one that changes persistence
-- without changing semantics.
--
-- So each table is a RELATIONAL AUTHORITY ENVELOPE around a bounded JSONB
-- record. The columns carry exactly what a query, a constraint, a foreign key,
-- an index or a concurrency check needs; the record carries the domain object
-- the ports already agreed on. A `workflow_runs` row and the JSON inside it
-- cannot disagree about identity, tenant, version or state, because
-- `workflow_runs_record_agrees` is a CHECK rather than a convention — a
-- projection that drifted from its own payload is how a compare-and-swap ends
-- up arbitrating a number nothing else reads.
--
-- ── THE TENANT IS IN THE PRIMARY KEY, NOT BESIDE IT ────────────────────────
--
-- The durable runtime gave each table a UUID surrogate and offered
-- `(id, organization_id)` for the next table to reference. These three have
-- NATURAL, TENANT-SCOPED identities already — the key-value store keys them
-- `org:{org}:ai:workflow_run:{id}`, so two organizations holding the same run
-- id is a shape the current authority permits — and a surrogate would add an
-- identifier the domain does not have and a uniqueness question the domain
-- has not asked. The primary key IS `(organization_id, <natural id>)`, so
-- every foreign key that references it carries the tenant by construction and
-- a cross-tenant checkpoint or approval is unrepresentable rather than merely
-- rejected.
--
-- ── CHECKPOINTS ARE APPEND-ONLY AT THE DATABASE ────────────────────────────
--
-- `WorkflowCheckpointStore` has no `save` and no `delete`, and the boundary
-- scan asserts their absence. That is a statement about the runtime. It says
-- nothing about a psql session, and the digest chain the recovery path
-- verifies rests on the checkpoints never having been edited by ANYTHING.
-- `workflow_checkpoints_append_only` is a BEFORE UPDATE trigger that refuses,
-- so the guarantee holds against the connection most likely to be used to
-- break it.
--
-- It refuses UPDATE and not DELETE, and the asymmetry is deliberate rather
-- than an omission: `organizations` cascades on delete, a run cascades to its
-- checkpoints, and a DELETE trigger would make deleting an organization fail.
-- Removal is therefore held by privilege and by the absent port: these tables
-- are internal runtime persistence, `20260921120001` leaves `anon` and
-- `authenticated` with no privilege on them at all, and the store contract has
-- no delete. EDITING — the thing the chain actually proves the absence of —
-- is held by the database itself.
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--
-- NO AGENT RUNTIME TABLES. Agent runs, checkpoints and approvals stay in the
-- key-value store. They are a later A2 slice and putting them here would make
-- this packet the broad KV rewrite it exists to avoid.
--
-- NO BACKFILL, NO SHADOW WRITE, NO CUTOVER SWITCH. There is no column here
-- that records where a record came from, because nothing has come from
-- anywhere: not one existing record is read, copied or rewritten by this
-- packet.
--
-- Apply: staging/local only until explicitly approved for production.
-- Rollback: supabase/migrations/rollbacks/20260921120000_rollback_workflow_persistence.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. workflow_runs — the versioned, compare-and-swapped run record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_runs (
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- `wfr_<32 hex>`, minted by `ai/contracts/ids.ts`. TEXT and not UUID: the
  -- kind prefix is part of the identifier by design — a workflow run and the
  -- agent runs it drives appear in the same log line — and stripping it to fit
  -- a column type would make the stored id a different id from the one every
  -- other record, log and read model carries.
  workflow_run_id     TEXT NOT NULL,

  -- The three list filters `WorkflowRunQuery` offers, projected out of the
  -- record's `context`. Not a denormalization for speed: `matchesWorkflowRunQuery`
  -- narrows on exactly these, and a filter answered by scanning JSON is a
  -- filter with no index behind it.
  workflow_id         TEXT NOT NULL,
  actor_id            TEXT NOT NULL,

  -- The thirteen states of `WORKFLOW_RUN_STATES`, verbatim. A state the engine
  -- cannot produce is refused here rather than stored and puzzled over later.
  state               TEXT NOT NULL
                      CONSTRAINT workflow_runs_state_check
                      CHECK (state IN ('created', 'validating', 'ready', 'running',
                                       'waiting_for_agent', 'waiting_for_branches',
                                       'waiting_for_approval', 'paused', 'completed',
                                       'failed', 'cancelled', 'expired', 'policy_denied')),

  -- THE CONCURRENCY TOKEN. `workflow_run_save` writes only where this still
  -- equals what the caller read, which is the whole of the guarantee that two
  -- isolates advancing one run cannot both succeed.
  run_version         INTEGER NOT NULL,

  -- The recovery pointer, projected so an operator can find a run whose chain
  -- is behind without opening every record.
  checkpoint_version  INTEGER NOT NULL DEFAULT 0,

  -- DOMAIN TIME, not row time. These are the record's own `createdAt` and
  -- `updatedAt` — the values `sortWorkflowRuns` orders by — so the index that
  -- serves the listing orders by the same fact the domain sorts by. Row time
  -- is `row_written_at`, and keeping them apart is what stops a re-write
  -- during a future backfill from reordering a tenant's history.
  created_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL,
  row_written_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  record              JSONB NOT NULL,

  CONSTRAINT workflow_runs_pk PRIMARY KEY (organization_id, workflow_run_id),

  CONSTRAINT workflow_runs_id_present CHECK (length(trim(workflow_run_id)) > 0),
  CONSTRAINT workflow_runs_workflow_present CHECK (length(trim(workflow_id)) > 0),
  CONSTRAINT workflow_runs_actor_present CHECK (length(trim(actor_id)) > 0),

  -- Version 0 is the "no record" sentinel the compare-and-swap contract uses;
  -- a STORED run always carries at least 1.
  CONSTRAINT workflow_runs_version_positive CHECK (run_version >= 1),
  CONSTRAINT workflow_runs_checkpoint_version_bounded
    CHECK (checkpoint_version >= 0 AND checkpoint_version <= 256),

  -- THE PROJECTION AND THE PAYLOAD AGREE, OR THE ROW DOES NOT EXIST. See the
  -- header. `->>` on a missing key yields NULL and the comparison fails, so a
  -- record that lost its context fails this too.
  -- EVERY COMPARISON IS `IS NOT DISTINCT FROM`, AND THAT IS THE WHOLE POINT.
  --
  -- `record ->> 'k' = col` is NULL when the key is missing, and a CHECK that
  -- evaluates to NULL PASSES. Written that way, this constraint would have
  -- admitted exactly the records it exists to refuse: one with no identity at
  -- all. `IS NOT DISTINCT FROM` is FALSE against a NOT NULL column, so a
  -- missing key is a refusal rather than a shrug.
  --
  -- The tenant is compared, not merely required to exist. A record whose JSON
  -- says one organization while the row says another is the single most
  -- dangerous shape this table could hold, and "organizationId IS NOT NULL"
  -- would have let every one of them through.
  CONSTRAINT workflow_runs_record_agrees CHECK (
    record #>> '{context,workflowRunId}'      IS NOT DISTINCT FROM workflow_run_id
    AND record #>> '{context,organizationId}' IS NOT DISTINCT FROM organization_id::text
    AND record #>> '{context,workflowId}'     IS NOT DISTINCT FROM workflow_id
    AND record #>> '{context,actorId}'        IS NOT DISTINCT FROM actor_id
    AND record ->> 'state'                    IS NOT DISTINCT FROM state
    AND record ->> 'runVersion'               IS NOT DISTINCT FROM run_version::text
    -- The recovery pointer is projected, so it is checked. A row claiming a
    -- chain position its own record does not is a run that resumes from the
    -- wrong link.
    AND record ->> 'checkpointVersion'        IS NOT DISTINCT FROM checkpoint_version::text
  ),

  -- BOUNDED, for the reason `durable_outbox.payload` is bounded: durable
  -- storage that accumulates without a ceiling becomes an uncontrolled second
  -- copy of a tenant's data. One mebibyte is roughly three times the largest
  -- record `WORKFLOW_RUN_BOUNDS` can produce — 256 steps, 128 transitions, a
  -- 32 KiB input and a usage row per child — so it refuses a runaway without
  -- ever refusing a legitimate run.
  CONSTRAINT workflow_runs_record_bounded CHECK (pg_column_size(record) <= 1048576)
);

-- THE LISTING INDEX. `sortWorkflowRuns` is newest first, and every query
-- `WorkflowRunQuery` can express starts from one organization.
CREATE INDEX IF NOT EXISTS workflow_runs_org_recent_idx
  ON public.workflow_runs (organization_id, created_at DESC);

-- The three narrowing filters, each carrying the ordering column so a filtered
-- listing is still an index scan rather than a sort over the filtered set.
CREATE INDEX IF NOT EXISTS workflow_runs_org_state_recent_idx
  ON public.workflow_runs (organization_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_runs_org_workflow_recent_idx
  ON public.workflow_runs (organization_id, workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_runs_org_actor_recent_idx
  ON public.workflow_runs (organization_id, actor_id, created_at DESC);

COMMENT ON TABLE public.workflow_runs IS
  'BP-003 A2 — SQL implementation of WorkflowRunStore. NOT the production authority; KV still is.';
COMMENT ON COLUMN public.workflow_runs.run_version IS
  'Optimistic concurrency token. workflow_run_save writes only where this matches what the caller read.';
COMMENT ON COLUMN public.workflow_runs.created_at IS
  'The record''s own createdAt, not the row''s. Ordering must survive a future re-write.';

-- ---------------------------------------------------------------------------
-- 2. workflow_checkpoints — immutable, versioned, digest-chained
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_checkpoints (
  organization_id  UUID NOT NULL,
  workflow_run_id  TEXT NOT NULL,

  -- IDENTITY, NOT A CONCURRENCY TOKEN. A checkpoint's version never moves, so
  -- there is nothing to compare against — which is precisely why the primary
  -- key below IS the immutability guarantee: a second write of the same
  -- version is a key collision, not a lost update.
  version          INTEGER NOT NULL,

  digest           TEXT NOT NULL,
  -- Absent on version 1, and on nothing else. The chain is what lets recovery
  -- verify the store rather than trust it.
  previous_digest  TEXT,

  node_id          TEXT NOT NULL,
  state            TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  row_written_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  record           JSONB NOT NULL,

  CONSTRAINT workflow_checkpoints_pk
    PRIMARY KEY (organization_id, workflow_run_id, version),

  -- TENANT-SAFE BY CONSTRUCTION. The referenced key carries the organization,
  -- so a checkpoint pointing at another tenant's run is not a thing that can
  -- be written down and then detected.
  CONSTRAINT workflow_checkpoints_run_fk
    FOREIGN KEY (organization_id, workflow_run_id)
    REFERENCES public.workflow_runs (organization_id, workflow_run_id)
    ON DELETE CASCADE,

  -- Checkpoint versions start at 1 and are capped by the run's own execution
  -- ceiling: one checkpoint per node execution, 256 executions.
  CONSTRAINT workflow_checkpoints_version_bounded
    CHECK (version >= 1 AND version <= 256),
  CONSTRAINT workflow_checkpoints_digest_present CHECK (length(trim(digest)) > 0),
  CONSTRAINT workflow_checkpoints_node_present CHECK (length(trim(node_id)) > 0),

  -- Version 1 opens the chain and carries no predecessor; every later link
  -- must carry one. A break in either direction is a chain that cannot be
  -- verified, so it is refused rather than stored.
  CONSTRAINT workflow_checkpoints_chain_coherent
    CHECK ((version = 1) = (previous_digest IS NULL)),

  -- NULL-safe throughout, for the reason `workflow_runs_record_agrees` states
  -- at length. The tenant is compared here too: a checkpoint's own record
  -- names the organization it belongs to, and a chain whose links disagree
  -- with their rows about whose run they describe is not a chain anything
  -- should verify against.
  CONSTRAINT workflow_checkpoints_record_agrees CHECK (
    record ->> 'organizationId'     IS NOT DISTINCT FROM organization_id::text
    AND record ->> 'workflowRunId'  IS NOT DISTINCT FROM workflow_run_id
    AND record ->> 'version'        IS NOT DISTINCT FROM version::text
    AND record ->> 'digest'         IS NOT DISTINCT FROM digest
    AND record ->> 'nodeId'         IS NOT DISTINCT FROM node_id
    AND record ->> 'state'          IS NOT DISTINCT FROM state
    -- Nullable on both sides, and the parity is exact: absent in the record
    -- iff absent in the column.
    AND record ->> 'previousDigest' IS NOT DISTINCT FROM previous_digest
  ),

  -- `WORKFLOW_CHECKPOINT_BOUNDS.maxOutputsBytes` is 128 KiB and the parallel
  -- summaries are digests rather than branches, so half a mebibyte is ample
  -- headroom over the largest checkpoint the contract can produce.
  CONSTRAINT workflow_checkpoints_record_bounded CHECK (pg_column_size(record) <= 524288)
);

-- THE HISTORY INDEX, which is also the "latest" index read backwards. Numeric
-- ordering, unlike the key-value store's zero-padded lexicographic keys — the
-- padding exists there because a prefix scan has no other way to sort, and a
-- column that IS an integer needs no such arrangement.
CREATE INDEX IF NOT EXISTS workflow_checkpoints_run_version_idx
  ON public.workflow_checkpoints (organization_id, workflow_run_id, version);

-- ── APPEND-ONLY, AT THE DATABASE ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cortex.refuse_checkpoint_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'workflow_checkpoints is append-only: checkpoint % of run % may not be rewritten',
    OLD.version, OLD.workflow_run_id
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION cortex.refuse_checkpoint_mutation() IS
  'BP-003 — the digest chain rests on checkpoints never being edited, by the runtime or by anything else.';

DROP TRIGGER IF EXISTS workflow_checkpoints_append_only ON public.workflow_checkpoints;
CREATE TRIGGER workflow_checkpoints_append_only
  BEFORE UPDATE ON public.workflow_checkpoints
  FOR EACH ROW EXECUTE FUNCTION cortex.refuse_checkpoint_mutation();

COMMENT ON TABLE public.workflow_checkpoints IS
  'BP-003 A2 — SQL implementation of WorkflowCheckpointStore. Append-only and digest-chained. NOT the production authority.';

-- ---------------------------------------------------------------------------
-- 3. workflow_approvals — a human decision, spent exactly once
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_approvals (
  organization_id      UUID NOT NULL,

  -- Deterministic: `wfa:{runId}:{nodeId}:{branchId|main}:{checkpointVersion}`.
  -- A retried advance recomputes the SAME id, which is why creation is
  -- insert-if-absent rather than insert: refusing is what lets the gate read
  -- the existing request and adopt it if it is still pending.
  workflow_approval_id TEXT NOT NULL,

  workflow_run_id      TEXT NOT NULL,
  workflow_id          TEXT NOT NULL,
  node_id              TEXT NOT NULL,
  branch_id            TEXT,

  approval_state       TEXT NOT NULL
                       CONSTRAINT workflow_approvals_state_check
                       CHECK (approval_state IN ('pending', 'approved', 'rejected',
                                                 'expired', 'withdrawn', 'consumed')),

  -- THE SINGLE-USE GUARANTEE. Two advances racing to spend one approved
  -- request both read N and both try to write N+1; `workflow_approval_save`
  -- lets exactly one of them past.
  approval_version     INTEGER NOT NULL,

  created_at           TIMESTAMPTZ NOT NULL,
  -- Preserved as a column and not only inside the record because an expiry
  -- sweep asks "which of this tenant's pending approvals are past due" and
  -- that question wants an index.
  expires_at           TIMESTAMPTZ NOT NULL,
  decided_at           TIMESTAMPTZ,
  consumed_at          TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL,
  row_written_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  record               JSONB NOT NULL,

  CONSTRAINT workflow_approvals_pk
    PRIMARY KEY (organization_id, workflow_approval_id),

  CONSTRAINT workflow_approvals_run_fk
    FOREIGN KEY (organization_id, workflow_run_id)
    REFERENCES public.workflow_runs (organization_id, workflow_run_id)
    ON DELETE CASCADE,

  CONSTRAINT workflow_approvals_id_present CHECK (length(trim(workflow_approval_id)) > 0),
  CONSTRAINT workflow_approvals_node_present CHECK (length(trim(node_id)) > 0),
  CONSTRAINT workflow_approvals_version_positive CHECK (approval_version >= 1),

  -- ── THE LIFECYCLE, ALL SIX STATES, AS `workflowApprovalGate` WRITES THEM ──
  --
  -- Stated as a truth table over the state rather than as a set of clever
  -- equalities, because the clever version got it wrong: it read
  -- "(state = 'pending') = (both stamps absent)", which quietly requires every
  -- NON-pending state to carry a stamp — and `expired` and `withdrawn` carry
  -- neither.
  --
  -- THAT IS NOT AN EDGE CASE. `close()` in `approvals/workflowApprovalGate.ts`
  -- deliberately leaves `decidedAt` and `consumedAt` untouched for both,
  -- because NEITHER CLOSURE IS A DECISION — the header of that function says
  -- so, and `contracts/approval.ts` opens by arguing that a timed-out request
  -- must never be readable as one somebody answered. A constraint that demands
  -- a decision stamp on `expired` is a constraint that refuses
  -- `expireIfDue()`, and a workflow whose approval window closes would have
  -- failed to persist that fact.
  --
  --   pending    neither        the request is open
  --   expired    neither        the window closed; nobody answered
  --   withdrawn  neither        the run ended; nobody answered
  --   approved   decided        somebody said yes
  --   rejected   decided        somebody said no
  --   consumed   decided+spent  the yes was spent, once
  --
  -- `ELSE FALSE` rather than `ELSE TRUE`: a state this table has not been
  -- taught is refused, not waved through.
  CONSTRAINT workflow_approvals_lifecycle_coherent CHECK (
    CASE approval_state
      WHEN 'pending'   THEN decided_at IS NULL     AND consumed_at IS NULL
      WHEN 'expired'   THEN decided_at IS NULL     AND consumed_at IS NULL
      WHEN 'withdrawn' THEN decided_at IS NULL     AND consumed_at IS NULL
      WHEN 'approved'  THEN decided_at IS NOT NULL AND consumed_at IS NULL
      WHEN 'rejected'  THEN decided_at IS NOT NULL AND consumed_at IS NULL
      WHEN 'consumed'  THEN decided_at IS NOT NULL AND consumed_at IS NOT NULL
      ELSE FALSE
    END
  ),

  -- NULL-safe throughout, and the tenant is compared. See
  -- `workflow_runs_record_agrees`.
  CONSTRAINT workflow_approvals_record_agrees CHECK (
    record ->> 'organizationId'      IS NOT DISTINCT FROM organization_id::text
    AND record ->> 'workflowApprovalId' IS NOT DISTINCT FROM workflow_approval_id
    AND record ->> 'workflowRunId'   IS NOT DISTINCT FROM workflow_run_id
    AND record ->> 'workflowId'      IS NOT DISTINCT FROM workflow_id
    AND record ->> 'nodeId'          IS NOT DISTINCT FROM node_id
    AND record ->> 'approvalState'   IS NOT DISTINCT FROM approval_state
    AND record ->> 'approvalVersion' IS NOT DISTINCT FROM approval_version::text
    AND record ->> 'branchId'        IS NOT DISTINCT FROM branch_id
    -- ACTUAL true, not merely "not false". `(record -> 'singleUse')::text =
    -- 'true'` is NULL when the key is absent, and a NULL CHECK passes — so the
    -- one field on this record that states a guarantee about itself could have
    -- been omitted entirely.
    AND record -> 'singleUse'        IS NOT DISTINCT FROM 'true'::jsonb
  ),

  -- `contracts/approval.ts` forbids a payload: identifiers, a digest, two
  -- definition-authored strings bounded at 300 and 500 characters. 64 KiB is
  -- an order of magnitude more than that shape can reach, and far too small
  -- to hold the business content the record exists not to carry.
  CONSTRAINT workflow_approvals_record_bounded CHECK (pg_column_size(record) <= 65536)
);

-- THE OPERATOR QUEUE INDEX. Oldest first, pending only, one tenant — the exact
-- shape of `sortWorkflowApprovals` under `pendingOnly`. Partial, because a
-- tenant's decided approvals are overwhelmingly the rows the queue never wants
-- and an index that carried them would make every queue read pay for them.
CREATE INDEX IF NOT EXISTS workflow_approvals_pending_queue_idx
  ON public.workflow_approvals (organization_id, created_at)
  WHERE approval_state = 'pending';

-- The unfiltered listing, and the per-run listing the diagnostic authority
-- port asks for.
CREATE INDEX IF NOT EXISTS workflow_approvals_org_oldest_idx
  ON public.workflow_approvals (organization_id, created_at);
CREATE INDEX IF NOT EXISTS workflow_approvals_run_oldest_idx
  ON public.workflow_approvals (organization_id, workflow_run_id, created_at);

-- Due pending approvals, across tenants: an expiry sweep is a platform pass,
-- not a tenant action. Mirrors `durable_jobs_expired_lease_idx`.
CREATE INDEX IF NOT EXISTS workflow_approvals_due_idx
  ON public.workflow_approvals (expires_at)
  WHERE approval_state = 'pending';

COMMENT ON TABLE public.workflow_approvals IS
  'BP-003 A2 — SQL implementation of WorkflowApprovalStore. Single-use under approval_version CAS. NOT the production authority.';
COMMENT ON COLUMN public.workflow_approvals.approval_version IS
  'Optimistic concurrency for this approval alone. Two racing decisions resolve to one decision, not a merge.';

COMMIT;
