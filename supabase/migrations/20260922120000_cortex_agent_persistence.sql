-- ============================================================================
-- A2-P07 — AGENT RUNTIME PERSISTENCE: THE RELATIONAL AUTHORITY
--
-- Three tables that hold what `ai/agents/persistence/kvAgentStores.ts` holds
-- today, under the SAME three ports. NOTHING HERE IS AUTHORITATIVE YET. The
-- production bootstrap still constructs the key-value agent stores, this phase
-- does not change it, and these tables exist to be PROVEN equivalent before a
-- later, separately approved step decides whether anything moves.
--
-- The shape is BP-003's — a relational authority envelope around a bounded
-- JSONB record, the tenant in every primary key, composite foreign keys, NULL-
-- safe agreement between projection and payload — because the reasons for it
-- are the same and were argued at length in `20260921120000`. What is argued
-- HERE is every place the agent contract is NOT the workflow contract, because
-- the packet's rule is that agent constraints are derived from the agent
-- runtime as it actually behaves, not copied from the workflow tables.
--
-- ── WHERE THE AGENT CONTRACT DIFFERS, AND WHAT THAT CHANGES ────────────────
--
-- THE CHECKPOINT CHAIN IS NOT A WORKFLOW CHAIN. A workflow checkpoint's digest
-- covers its whole content including its predecessor, and `checkpointChain.ts`
-- verifies it link by link. An agent checkpoint's `progressDigest` is a digest
-- of its PROGRESS alone, and `previousDigest` is whatever `latest()` returned
-- when the checkpoint was written (`agentOrchestrator.ts`, `writeCheckpoint`).
-- Nothing reads the chain back to verify it. So the workflow table's
-- `(version = 1) = (previous_digest IS NULL)` rule would be a rule the agent
-- runtime never promised: after a crash between a checkpoint write and the
-- run's pointer save, `latest()` can name a checkpoint AHEAD of the pointer,
-- and a later write can legitimately carry a predecessor that is not
-- `version - 1`. A constraint that refused that would turn a recoverable crash
-- window into a persistence failure the key-value store never raises. It is
-- therefore NOT declared. What IS declared is what the agent contract does
-- promise: a written checkpoint is never rewritten (`agent_checkpoints_append_only`).
--
-- THE APPROVAL LIFECYCLE IS NOT A WORKFLOW LIFECYCLE. Five states, no
-- `withdrawn`, and — unlike the workflow gate — `approvalGate.ts`'s `expire()`
-- STAMPS `decidedAt`, and it runs whenever a request is past due in `decide()`
-- or `consume()` whatever state the request is in. So an `expired` request
-- always carries a decision stamp and MAY carry a consumption stamp (a spent
-- approval re-read after its window closed). The truth table below admits
-- exactly what the gate writes and nothing else.
--
-- LISTINGS ORDER DIFFERENTLY. Agent approvals list newest first, with no
-- tie-break of their own; workflow approvals list oldest first. The indexes
-- serve the agent orderings.
--
-- THE TENANT IS THE SAME PROBLEM. `context.organizationId` is admitted by the
-- same tenancy grammar that permits the slug-shaped `marq-cortex` default, and
-- `organization_id` here is a UUID with a foreign key. A tenant the relational
-- authority cannot name is a tenant these tables cannot hold; the adapter
-- fails closed on it rather than pretending, exactly as BP-003's does.
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--
-- NO FOREIGN KEY TO THE WORKFLOW TABLES. A workflow run names its child agent
-- runs (`childAgentRunIds`, `pendingNode.agentRunId`), and an agent run may
-- name a parent. Those references cross two authorities that cut over
-- SEPARATELY; a foreign key between them would make the order of two
-- independently approved migrations a correctness question.
--
-- NO BACKFILL, NO SHADOW WRITE, NO CUTOVER SWITCH, and no `_schema` column:
-- the key-value store stamps `_schema` onto its values because a blob has no
-- other way to say what it is. A table does.
--
-- Apply: staging/local only until explicitly approved for production.
-- Rollback: supabase/migrations/rollbacks/20260922120000_rollback_agent_persistence.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. agent_runs — the versioned, compare-and-swapped run record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_runs (
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- `run_<hex>`, minted by the runtime's id factory. TEXT for the reason
  -- `workflow_runs.workflow_run_id` gives: the kind prefix is part of the id.
  agent_run_id        TEXT NOT NULL,

  -- The two identity filters `AgentRunQuery` offers, projected out of the
  -- record's `context` so `matchesRunQuery` has an index behind it.
  agent_id            TEXT NOT NULL,
  actor_id            TEXT NOT NULL,

  -- The sixteen states of `AGENT_RUN_STATES`, verbatim.
  state               TEXT NOT NULL
                      CONSTRAINT agent_runs_state_check
                      CHECK (state IN ('created', 'validating', 'planned', 'waiting_for_budget',
                                       'running', 'waiting_for_tool', 'waiting_for_agent',
                                       'waiting_for_approval', 'paused', 'retrying',
                                       'completed', 'failed', 'cancelled', 'expired',
                                       'budget_exhausted', 'policy_denied')),

  -- THE CONCURRENCY TOKEN. `agent_run_save` writes only where this still
  -- equals what the caller read.
  run_version         INTEGER NOT NULL,

  -- The recovery pointer. Projected so a run whose chain tip is ahead of it —
  -- the checkpoint-before-pointer crash window — can be found without opening
  -- every record.
  checkpoint_version  INTEGER NOT NULL DEFAULT 0,

  -- DOMAIN TIME: the record's own `createdAt`/`updatedAt`, which is what the
  -- listing sorts by. Row time is `row_written_at`.
  created_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL,
  row_written_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  record              JSONB NOT NULL,

  CONSTRAINT agent_runs_pk PRIMARY KEY (organization_id, agent_run_id),

  CONSTRAINT agent_runs_id_present CHECK (length(trim(agent_run_id)) > 0),
  CONSTRAINT agent_runs_agent_present CHECK (length(trim(agent_id)) > 0),
  CONSTRAINT agent_runs_actor_present CHECK (length(trim(actor_id)) > 0),

  -- Version 0 is the compare-and-swap's "no record" sentinel; a stored run is
  -- created at 1 (`agentOrchestrator.ts`) and only ever moves up.
  CONSTRAINT agent_runs_version_positive CHECK (run_version >= 1),

  -- One checkpoint per step plus the entry checkpoint, under
  -- `AGENT_LIMIT_BOUNDS.maxTotalSteps` (64) and at most eight step-level
  -- retries each. 1024 is headroom over that product, not a limit on it: the
  -- purpose is to refuse a pointer no run can reach, never a real one.
  CONSTRAINT agent_runs_checkpoint_version_bounded
    CHECK (checkpoint_version >= 0 AND checkpoint_version <= 1024),

  -- THE PROJECTION AND THE PAYLOAD AGREE, OR THE ROW DOES NOT EXIST — and
  -- NULL-SAFELY, because `record ->> 'k' = col` is NULL for a missing key and a
  -- NULL CHECK PASSES. See `workflow_runs_record_agrees` for the defect that
  -- rule was learned from. The tenant is compared, not merely required.
  CONSTRAINT agent_runs_record_agrees CHECK (
    record #>> '{context,runId}'              IS NOT DISTINCT FROM agent_run_id
    AND record #>> '{context,organizationId}' IS NOT DISTINCT FROM organization_id::text
    AND record #>> '{context,agentId}'        IS NOT DISTINCT FROM agent_id
    AND record #>> '{context,actorId}'        IS NOT DISTINCT FROM actor_id
    AND record ->> 'state'                    IS NOT DISTINCT FROM state
    AND record ->> 'runVersion'               IS NOT DISTINCT FROM run_version::text
    AND record ->> 'checkpointVersion'        IS NOT DISTINCT FROM checkpoint_version::text
  ),

  -- BOUNDED. An agent run carries at most one pending action (input bounded at
  -- 64 KiB by `ACTION_BOUNDS`), 128 transitions, and one digest-only step
  -- record per step attempt. Two mebibytes is several times the largest record
  -- those bounds can produce: it refuses a runaway, never a legitimate run.
  CONSTRAINT agent_runs_record_bounded CHECK (pg_column_size(record) <= 2097152)
);

-- THE LISTING INDEX: newest first, one organization — `AgentRunQuery` cannot
-- express anything that does not start there.
CREATE INDEX IF NOT EXISTS agent_runs_org_recent_idx
  ON public.agent_runs (organization_id, created_at DESC);

-- The three narrowing filters, each carrying the ordering column.
CREATE INDEX IF NOT EXISTS agent_runs_org_state_recent_idx
  ON public.agent_runs (organization_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_org_agent_recent_idx
  ON public.agent_runs (organization_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_org_actor_recent_idx
  ON public.agent_runs (organization_id, actor_id, created_at DESC);

COMMENT ON TABLE public.agent_runs IS
  'A2-P07 — SQL implementation of AgentRunStore. NOT the production authority; KV still is.';
COMMENT ON COLUMN public.agent_runs.run_version IS
  'Optimistic concurrency token. agent_run_save writes only where this matches what the caller read.';

-- ---------------------------------------------------------------------------
-- 2. agent_checkpoints — immutable, versioned
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_checkpoints (
  organization_id  UUID NOT NULL,
  agent_run_id     TEXT NOT NULL,

  -- IDENTITY, NOT A CONCURRENCY TOKEN. The primary key below IS the
  -- immutability guarantee: a second write of one version is a key collision.
  version          INTEGER NOT NULL,

  -- A digest of the checkpoint's PROGRESS, not of the checkpoint. See the
  -- header: this is not the workflow chain and it is not verified as one.
  progress_digest  TEXT NOT NULL,
  -- Whatever `latest()` named when this was written. Nullable, and
  -- deliberately NOT constrained against `version` — see the header.
  previous_digest  TEXT,

  agent_id         TEXT NOT NULL,
  state            TEXT NOT NULL
                   CONSTRAINT agent_checkpoints_state_check
                   CHECK (state IN ('created', 'validating', 'planned', 'waiting_for_budget',
                                    'running', 'waiting_for_tool', 'waiting_for_agent',
                                    'waiting_for_approval', 'paused', 'retrying',
                                    'completed', 'failed', 'cancelled', 'expired',
                                    'budget_exhausted', 'policy_denied')),
  step_count       INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  row_written_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  record           JSONB NOT NULL,

  CONSTRAINT agent_checkpoints_pk
    PRIMARY KEY (organization_id, agent_run_id, version),

  -- TENANT-SAFE BY CONSTRUCTION: the referenced key carries the organization.
  CONSTRAINT agent_checkpoints_run_fk
    FOREIGN KEY (organization_id, agent_run_id)
    REFERENCES public.agent_runs (organization_id, agent_run_id)
    ON DELETE CASCADE,

  CONSTRAINT agent_checkpoints_version_bounded CHECK (version >= 1 AND version <= 1024),
  CONSTRAINT agent_checkpoints_step_count_nonnegative CHECK (step_count >= 0),
  CONSTRAINT agent_checkpoints_digest_present CHECK (length(trim(progress_digest)) > 0),
  CONSTRAINT agent_checkpoints_agent_present CHECK (length(trim(agent_id)) > 0),

  -- NULL-safe throughout; the tenant is compared.
  CONSTRAINT agent_checkpoints_record_agrees CHECK (
    record ->> 'organizationId'     IS NOT DISTINCT FROM organization_id::text
    AND record ->> 'runId'          IS NOT DISTINCT FROM agent_run_id
    AND record ->> 'version'        IS NOT DISTINCT FROM version::text
    AND record ->> 'progressDigest' IS NOT DISTINCT FROM progress_digest
    AND record ->> 'previousDigest' IS NOT DISTINCT FROM previous_digest
    AND record ->> 'agentId'        IS NOT DISTINCT FROM agent_id
    AND record ->> 'state'          IS NOT DISTINCT FROM state
    AND record ->> 'stepCount'      IS NOT DISTINCT FROM step_count::text
  ),

  -- `CHECKPOINT_BOUNDS`: progress 32 KiB, output 128 KiB, both enforced before
  -- a write. Half a mebibyte is ample headroom over their sum.
  CONSTRAINT agent_checkpoints_record_bounded CHECK (pg_column_size(record) <= 524288)
);

-- History ascending, and "latest" is the same index read backwards.
CREATE INDEX IF NOT EXISTS agent_checkpoints_run_version_idx
  ON public.agent_checkpoints (organization_id, agent_run_id, version);

-- ── APPEND-ONLY, AT THE DATABASE ────────────────────────────────────────────
--
-- ITS OWN FUNCTION, not BP-003's `cortex.refuse_checkpoint_mutation()`. That
-- one is owned by the workflow migration and dropped by the workflow rollback;
-- borrowing it would make rolling back one domain break the other's trigger,
-- or make one rollback unable to run while the other domain is installed.
CREATE OR REPLACE FUNCTION cortex.refuse_agent_checkpoint_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'agent_checkpoints is append-only: checkpoint % of run % may not be rewritten',
    OLD.version, OLD.agent_run_id
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION cortex.refuse_agent_checkpoint_mutation() IS
  'A2-P07 — a written agent checkpoint is a point a run resumes from; it is never edited, by the runtime or by anything else.';

-- UPDATE only, not DELETE, for the reason BP-003 gives: an organization or run
-- delete cascades here, and removal is held by privilege and the absent port.
DROP TRIGGER IF EXISTS agent_checkpoints_append_only ON public.agent_checkpoints;
CREATE TRIGGER agent_checkpoints_append_only
  BEFORE UPDATE ON public.agent_checkpoints
  FOR EACH ROW EXECUTE FUNCTION cortex.refuse_agent_checkpoint_mutation();

COMMENT ON TABLE public.agent_checkpoints IS
  'A2-P07 — SQL implementation of AgentCheckpointStore. Append-only. NOT the production authority.';

-- ---------------------------------------------------------------------------
-- 3. agent_approvals — a human decision, spent exactly once
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_approvals (
  organization_id      UUID NOT NULL,

  -- `apr_<hex>`, minted fresh per request. NOT deterministic like a workflow
  -- approval id; creation is still insert-if-absent so a collision is refused.
  agent_approval_id    TEXT NOT NULL,

  agent_run_id         TEXT NOT NULL,
  action_id            TEXT NOT NULL,
  requesting_agent_id  TEXT NOT NULL,

  approval_state       TEXT NOT NULL
                       CONSTRAINT agent_approvals_state_check
                       CHECK (approval_state IN ('pending', 'approved', 'rejected',
                                                 'expired', 'consumed')),

  -- THE SINGLE-USE GUARANTEE: two consumers racing on one approved request
  -- both read N and both try to write N+1; `agent_approval_save` lets one past.
  approval_version     INTEGER NOT NULL,

  created_at           TIMESTAMPTZ NOT NULL,
  expires_at           TIMESTAMPTZ NOT NULL,
  decided_at           TIMESTAMPTZ,
  consumed_at          TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL,
  row_written_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  record               JSONB NOT NULL,

  CONSTRAINT agent_approvals_pk
    PRIMARY KEY (organization_id, agent_approval_id),

  CONSTRAINT agent_approvals_run_fk
    FOREIGN KEY (organization_id, agent_run_id)
    REFERENCES public.agent_runs (organization_id, agent_run_id)
    ON DELETE CASCADE,

  CONSTRAINT agent_approvals_id_present CHECK (length(trim(agent_approval_id)) > 0),
  CONSTRAINT agent_approvals_action_present CHECK (length(trim(action_id)) > 0),
  CONSTRAINT agent_approvals_version_positive CHECK (approval_version >= 1),

  -- ── THE LIFECYCLE, AS `approvalGate.ts` ACTUALLY WRITES IT ──────────────
  --
  --   pending    neither          the request is open
  --   approved   decided          somebody said yes
  --   rejected   decided          somebody said no
  --   consumed   decided + spent  the yes was spent, once
  --   expired    decided, spent?  `expire()` stamps decidedAt; a request that
  --                               was already spent keeps its consumedAt
  --
  -- The `expired` row is the agent contract, not a loosened workflow rule:
  -- `expire()` runs in `decide()` and `consume()` whenever a request is due,
  -- before either checks the state, and writes `{ ...request, state:
  -- 'expired', decidedAt: now }`. A constraint that required `consumed_at IS
  -- NULL` there would refuse a write the production authority accepts today.
  -- `ELSE FALSE`: a state this table has not been taught is refused.
  CONSTRAINT agent_approvals_lifecycle_coherent CHECK (
    CASE approval_state
      WHEN 'pending'  THEN decided_at IS NULL     AND consumed_at IS NULL
      WHEN 'approved' THEN decided_at IS NOT NULL AND consumed_at IS NULL
      WHEN 'rejected' THEN decided_at IS NOT NULL AND consumed_at IS NULL
      WHEN 'consumed' THEN decided_at IS NOT NULL AND consumed_at IS NOT NULL
      WHEN 'expired'  THEN decided_at IS NOT NULL
      ELSE FALSE
    END
  ),

  -- NULL-safe throughout, the tenant compared, and the stamps agree with the
  -- record about PRESENCE. Their text cannot be compared — a JSON ISO string
  -- and a timestamptz rendered as text are different spellings of one instant
  -- — but a row that says "decided" while its record says "not decided" is a
  -- disagreement the lifecycle rule above would otherwise be arbitrating on
  -- the wrong side of.
  CONSTRAINT agent_approvals_record_agrees CHECK (
    record ->> 'organizationId'        IS NOT DISTINCT FROM organization_id::text
    AND record ->> 'approvalId'        IS NOT DISTINCT FROM agent_approval_id
    AND record ->> 'runId'             IS NOT DISTINCT FROM agent_run_id
    AND record ->> 'actionId'          IS NOT DISTINCT FROM action_id
    AND record ->> 'requestingAgentId' IS NOT DISTINCT FROM requesting_agent_id
    AND record ->> 'state'             IS NOT DISTINCT FROM approval_state
    AND record ->> 'approvalVersion'   IS NOT DISTINCT FROM approval_version::text
    AND (record ->> 'decidedAt' IS NULL)  = (decided_at IS NULL)
    AND (record ->> 'consumedAt' IS NULL) = (consumed_at IS NULL)
    AND (record ->> 'expiresAt' IS NOT NULL)
    -- ACTUAL true, not merely "not false" — a missing key must not pass.
    AND record -> 'singleUse'          IS NOT DISTINCT FROM 'true'::jsonb
  ),

  -- Identifiers, a one-sentence impact summary (500), at most twelve bounded
  -- data labels, the agent's reason, approver roles and a decision reason
  -- (300). 64 KiB is an order of magnitude over that shape.
  CONSTRAINT agent_approvals_record_bounded CHECK (pg_column_size(record) <= 65536)
);

-- THE OPERATOR QUEUE: pending only, one tenant, NEWEST FIRST — the agent
-- listing's order, which is the opposite of the workflow queue's.
CREATE INDEX IF NOT EXISTS agent_approvals_pending_queue_idx
  ON public.agent_approvals (organization_id, created_at DESC)
  WHERE approval_state = 'pending';

CREATE INDEX IF NOT EXISTS agent_approvals_org_recent_idx
  ON public.agent_approvals (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_approvals_run_recent_idx
  ON public.agent_approvals (organization_id, agent_run_id, created_at DESC);

-- Due pending approvals, across tenants: an expiry sweep is a platform pass.
CREATE INDEX IF NOT EXISTS agent_approvals_due_idx
  ON public.agent_approvals (expires_at)
  WHERE approval_state = 'pending';

COMMENT ON TABLE public.agent_approvals IS
  'A2-P07 — SQL implementation of AgentApprovalStore. Single-use under approval_version CAS. NOT the production authority.';

COMMIT;
