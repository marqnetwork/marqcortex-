-- ============================================================================
-- BP-002 / A1 — DURABLE RUNTIME FOUNDATION
--
-- Five tables and five functions that let work outlive the thing that asked
-- for it. Nothing here is a workflow engine: the workflow engine exists, it is
-- `ai/workflows/**`, and it stays. What did not exist — and what the gap map
-- names at "Long-running jobs ... BUILD NEW" — is a place for work to WAIT.
--
-- ── WHY POSTGRES AND NOTHING ELSE ──────────────────────────────────────────
--
-- The repository already has one durable authority and one concurrency
-- primitive: Postgres, and `kv_compare_and_swap_field` over it. A queue broker
-- would add a second durable authority, and two durable authorities disagree
-- the first time one of them is unavailable — a job committed to the broker and
-- not to Postgres is work the database cannot see, and a row written without
-- the broker is work no worker will run. `SELECT ... FOR UPDATE SKIP LOCKED` is
-- the same arbitration a broker performs, in the store that already holds the
-- business fact the job is about, inside the transaction that writes it.
--
-- ── WHY NOT THE KV STORE ───────────────────────────────────────────────────
--
-- `kv_compare_and_swap_field` arbitrates writers for ONE KNOWN KEY. Every
-- caller of it already knows which record it wants. A job queue asks the
-- opposite question — "give me ANY record that is due, that nobody else has,
-- cheapest first" — and answering it over a key-value store means scanning a
-- prefix, sorting in the isolate, and then racing every other isolate that
-- scanned the same prefix a millisecond earlier. That is not a concurrency bug
-- to be fixed with care; it is the absence of the index the question needs.
--
-- ── THE THREE THINGS THIS SCHEMA REFUSES TO REPRESENT ──────────────────────
--
--   A HUMAN JOB ACTOR. `durable_jobs_actor_not_human` is a CHECK, not a
--   convention. BP-001 §11 says a background job never inherits the authority
--   of the person who started it, and a rule that lives only in TypeScript is a
--   rule that holds until somebody inserts a row from a script. The person is
--   recorded — `initiated_by_actor_id` — as PROVENANCE. Provenance is not
--   authority, and the two are different columns so they can never be read as
--   one.
--
--   A CROSS-TENANT REFERENCE. Every table carries `organization_id`, every
--   cross-table foreign key carries it too, and every table offers the
--   composite `(id, organization_id)` for the next one to reference. The same
--   property the organizational spine and the strategic layer hold: a
--   cross-tenant row is not rejected at runtime, it cannot be written down.
--
--   AN UNBOUNDED PAYLOAD. `durable_outbox.payload` is capped by a CHECK.
--   BP-002 §6.3 asks for bounded event payloads and the reason is the one
--   `observability/audit.ts` already gives for prompts: an event log with no
--   ceiling becomes an uncontrolled second copy of every tenant's business
--   data, replicated to every consumer, retained forever.
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--
-- NO MIGRATION OF EXISTING RUNTIME STATE. Agent runs, workflow runs,
-- checkpoints and approvals stay in the KV store they are in. Moving them is
-- A2, it is explicitly out of scope for this packet, and doing it here would
-- put the riskiest data move in the repository inside the packet that
-- introduces the machinery it would move onto.
--
-- NO CRON EXPRESSION PARSER. `recurrence_interval_ms` is a deterministic
-- interval, which is the smallest thing that proves recurring scheduling.
-- A calendar recurrence ("the first Monday", "09:00 Europe/London") is a
-- timezone-and-DST product in its own right, and BP-002 §6.2 says not to build
-- one unless the repository already has one. It does not.
--
-- NO PRIORITY AGEING, NO TENANT QUOTA, NO DEPENDENCY GRAPH. Each is a real
-- requirement in the target architecture and none is an A1 invariant. They are
-- additive to this shape rather than reinterpretations of it.
--
-- Apply: staging/local only until explicitly approved for production.
-- Rollback: supabase/migrations/rollbacks/20260919120000_rollback_durable_runtime.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. durable_jobs — one unit of work that must survive the thing that made it
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.durable_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The handler key. Resolved through the registry in
  -- `platform/durable/registry.ts`; a job whose type nothing has registered is
  -- a job that fails closed rather than one that runs something approximate.
  job_type                TEXT NOT NULL,

  -- SIX STATES. `queued` covers "scheduled", "delayed" and "waiting to retry"
  -- because all three are the same fact — not claimable until `available_at` —
  -- and three names for one fact is three places for a claim predicate to
  -- disagree with itself.
  state                   TEXT NOT NULL DEFAULT 'queued'
                          CONSTRAINT durable_jobs_state_check
                          CHECK (state IN ('queued', 'leased', 'succeeded',
                                           'dead_letter', 'paused', 'cancelled')),

  -- Lower runs first. SMALLINT because a priority range wider than a signed
  -- short is a priority scheme nobody can reason about.
  priority                SMALLINT NOT NULL DEFAULT 100,

  -- THE ONLY TIME GATE. A delayed job and a job waiting out its backoff are
  -- the same row with a different stamp.
  available_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  attempt                 INTEGER NOT NULL DEFAULT 0,
  max_attempts            INTEGER NOT NULL DEFAULT 5,
  backoff_kind            TEXT NOT NULL DEFAULT 'exponential'
                          CONSTRAINT durable_jobs_backoff_check
                          CHECK (backoff_kind IN ('immediate', 'fixed', 'exponential')),
  backoff_base_ms         INTEGER NOT NULL DEFAULT 1000,
  backoff_max_ms          INTEGER NOT NULL DEFAULT 3600000,

  -- ── THE LEASE ────────────────────────────────────────────────────────────
  --
  -- `lease_generation` is the field that makes a stale worker harmless, and it
  -- is the one piece of this schema that is not obvious.
  --
  -- Owner alone is not enough. Worker A claims a job and stalls. Its lease
  -- expires, recovery returns the job to `queued`, worker B claims it and
  -- succeeds. Worker A now wakes up and writes its result. If the write only
  -- checked the owner, A's write would be refused — but only because the owner
  -- happens to have changed. Re-claimed by A ITSELF after expiry, the owner is
  -- identical and A's stale write lands on top of A's newer one.
  --
  -- The generation is bumped on every claim and never reused, so "the lease I
  -- was given" and "the lease that is live" are comparable even when the same
  -- worker holds both. Every settle carries the generation it was claimed at.
  lease_owner             TEXT,
  lease_generation        INTEGER NOT NULL DEFAULT 0,
  lease_expires_at        TIMESTAMPTZ,
  heartbeat_at            TIMESTAMPTZ,
  lease_ttl_ms            INTEGER NOT NULL DEFAULT 60000,

  -- ── IDENTITY AND IDEMPOTENCY ─────────────────────────────────────────────
  --
  -- Unique per tenant AND per type below. Enqueueing the same logical work
  -- twice is not an error the caller has to catch: the second insert conflicts,
  -- and the caller gets back the job that already exists.
  idempotency_key         TEXT NOT NULL,

  correlation_id          TEXT NOT NULL,
  causation_id            TEXT,
  schedule_id             UUID,

  -- ── THE ACTOR, AND THE PERSON WHO IS NOT IT ──────────────────────────────
  --
  -- `actor_permissions` is the job's OWN bounded permission set, put there by
  -- the handler declaration at enqueue time. It is deliberately NOT a copy of
  -- the enqueueing human's permissions: a person who may approve their own
  -- run's spending has that authority because they are present at the
  -- decision, and a job that inherited it would spend it unattended.
  actor_id                TEXT NOT NULL,
  actor_type              TEXT NOT NULL
                          CONSTRAINT durable_jobs_actor_type_check
                          CHECK (actor_type IN ('service', 'job', 'workflow',
                                                'ai_agent', 'integration')),
  actor_permissions       TEXT[] NOT NULL DEFAULT '{}',

  -- Provenance. Nullable, because a job materialized from a recurring schedule
  -- was set in motion by nobody.
  initiated_by_actor_id   TEXT,
  initiated_by_actor_type TEXT,

  input                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  result                  JSONB,
  failure_code            TEXT,
  failure_detail          TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,

  CONSTRAINT durable_jobs_id_org_uk UNIQUE (id, organization_id),

  -- THE IDEMPOTENCY GUARANTEE, AT THE DATABASE. BP-002 §7 asks for uniqueness
  -- where required; this is the where. Scoped by type as well as tenant so two
  -- unrelated handlers may legitimately use the same natural key.
  CONSTRAINT durable_jobs_idempotency_uk
    UNIQUE (organization_id, job_type, idempotency_key),

  -- THE BP-001 §11 RULE, AS A CONSTRAINT. See the header.
  CONSTRAINT durable_jobs_actor_not_human CHECK (actor_type <> 'human'),

  -- A leased job has an owner and an expiry; an unleased one has neither. The
  -- alternative — trusting every writer to clear both — is how a job ends up
  -- `queued` with a live lease and gets claimed twice.
  CONSTRAINT durable_jobs_lease_coherent CHECK (
    (state = 'leased') = (lease_owner IS NOT NULL)
    AND (state = 'leased') = (lease_expires_at IS NOT NULL)
  ),

  CONSTRAINT durable_jobs_attempts_bounded CHECK (
    attempt >= 0 AND max_attempts >= 1 AND max_attempts <= 50 AND attempt <= max_attempts
  ),
  CONSTRAINT durable_jobs_backoff_bounded CHECK (
    backoff_base_ms >= 0 AND backoff_max_ms >= backoff_base_ms AND backoff_max_ms <= 86400000
  ),
  CONSTRAINT durable_jobs_lease_ttl_bounded CHECK (
    lease_ttl_ms >= 1000 AND lease_ttl_ms <= 3600000
  ),
  CONSTRAINT durable_jobs_idempotency_present CHECK (length(trim(idempotency_key)) > 0),
  CONSTRAINT durable_jobs_correlation_present CHECK (length(trim(correlation_id)) > 0),
  -- Bounded, for the reason the header gives about payloads.
  CONSTRAINT durable_jobs_input_bounded CHECK (pg_column_size(input) <= 32768),
  CONSTRAINT durable_jobs_result_bounded CHECK (result IS NULL OR pg_column_size(result) <= 32768)
);

-- THE CLAIM INDEX. The predicate of `durable_job_claim` exactly: queued rows,
-- this tenant, due now, cheapest and oldest first. Partial, because a queue's
-- history is overwhelmingly rows that will never be claimed again, and an index
-- that carries them makes every claim pay for them.
CREATE INDEX IF NOT EXISTS durable_jobs_claimable_idx
  ON public.durable_jobs (organization_id, job_type, available_at, priority, created_at)
  WHERE state = 'queued';

-- THE RECOVERY INDEX. Expired leases, across tenants, because lease recovery is
-- a platform sweep rather than a tenant action.
CREATE INDEX IF NOT EXISTS durable_jobs_expired_lease_idx
  ON public.durable_jobs (lease_expires_at)
  WHERE state = 'leased';

CREATE INDEX IF NOT EXISTS durable_jobs_org_recent_idx
  ON public.durable_jobs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS durable_jobs_correlation_idx
  ON public.durable_jobs (organization_id, correlation_id);
CREATE INDEX IF NOT EXISTS durable_jobs_schedule_idx
  ON public.durable_jobs (schedule_id) WHERE schedule_id IS NOT NULL;

DROP TRIGGER IF EXISTS durable_jobs_set_updated_at ON public.durable_jobs;
CREATE TRIGGER durable_jobs_set_updated_at
  BEFORE UPDATE ON public.durable_jobs
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.durable_jobs IS
  'BP-002 A1 — one unit of background work, durable in Postgres, claimed under an atomic lease.';
COMMENT ON COLUMN public.durable_jobs.lease_generation IS
  'Bumped on every claim, never reused. Distinguishes a stale lease from a live one held by the same worker.';
COMMENT ON COLUMN public.durable_jobs.initiated_by_actor_id IS
  'Provenance only. BP-001 §11: a job never inherits the authority of whoever set it in motion.';

-- ---------------------------------------------------------------------------
-- 2. durable_schedules — when work becomes due
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.durable_schedules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The stable name. Unique per tenant, so "make sure this schedule exists" is
  -- an upsert rather than a search.
  schedule_key            TEXT NOT NULL,
  job_type                TEXT NOT NULL,

  status                  TEXT NOT NULL DEFAULT 'active'
                          CONSTRAINT durable_schedules_status_check
                          CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),

  next_run_at             TIMESTAMPTZ NOT NULL,

  -- NULL means one-time. A one-time schedule materializes once and becomes
  -- `completed`; a recurring one advances. One column, two behaviours, and the
  -- NULL is what tells them apart — rather than a boolean that can disagree
  -- with the interval beside it.
  recurrence_interval_ms  BIGINT,

  last_run_at             TIMESTAMPTZ,
  last_occurrence_at      TIMESTAMPTZ,

  -- The CAS token. `durable_schedule_materialize_due` advances the schedule
  -- only if this still matches what it read, so two racing ticks cannot both
  -- advance it — and the loser materializes nothing rather than a duplicate.
  materialize_version     INTEGER NOT NULL DEFAULT 0,

  actor_id                TEXT NOT NULL,
  actor_type              TEXT NOT NULL
                          CONSTRAINT durable_schedules_actor_type_check
                          CHECK (actor_type IN ('service', 'job', 'workflow',
                                                'ai_agent', 'integration')),
  actor_permissions       TEXT[] NOT NULL DEFAULT '{}',
  initiated_by_actor_id   TEXT,
  initiated_by_actor_type TEXT,

  correlation_id          TEXT NOT NULL,
  input                   JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT durable_schedules_id_org_uk UNIQUE (id, organization_id),
  CONSTRAINT durable_schedules_key_uk UNIQUE (organization_id, schedule_key),
  CONSTRAINT durable_schedules_actor_not_human CHECK (actor_type <> 'human'),
  CONSTRAINT durable_schedules_key_present CHECK (length(trim(schedule_key)) > 0),
  CONSTRAINT durable_schedules_correlation_present CHECK (length(trim(correlation_id)) > 0),
  -- A FLOOR ON RECURRENCE. A schedule that fires every second is a tight retry
  -- loop wearing a different name, and BP-002 §9 forbids those. One minute is
  -- the smallest interval a scheduler tick can honour without the tick itself
  -- becoming the bottleneck.
  CONSTRAINT durable_schedules_interval_bounded CHECK (
    recurrence_interval_ms IS NULL
    OR (recurrence_interval_ms >= 60000 AND recurrence_interval_ms <= 31622400000)
  ),
  CONSTRAINT durable_schedules_input_bounded CHECK (pg_column_size(input) <= 32768)
);

CREATE INDEX IF NOT EXISTS durable_schedules_due_idx
  ON public.durable_schedules (organization_id, next_run_at)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS durable_schedules_set_updated_at ON public.durable_schedules;
CREATE TRIGGER durable_schedules_set_updated_at
  BEFORE UPDATE ON public.durable_schedules
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.durable_schedules IS
  'BP-002 A1 — one-time, delayed and interval-recurring schedules. Materialization is idempotent per occurrence.';

-- Now that schedules exist, jobs may point at them — tenant-safely.
ALTER TABLE public.durable_jobs
  DROP CONSTRAINT IF EXISTS durable_jobs_schedule_same_org;
ALTER TABLE public.durable_jobs
  ADD CONSTRAINT durable_jobs_schedule_same_org
  FOREIGN KEY (schedule_id, organization_id)
  REFERENCES public.durable_schedules (id, organization_id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. durable_outbox — a fact, and the promise that it will be delivered
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.durable_outbox (
  -- THE EVENT ID IS THE PRIMARY KEY. Not a separate `event_id` column beside a
  -- row id: two identifiers for one fact is two things a retry can re-mint, and
  -- BP-002 §17.22 requires that a dispatch retry does not mint a new event id.
  -- With one column there is nothing to re-mint.
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  event_type              TEXT NOT NULL,
  event_version           INTEGER NOT NULL DEFAULT 1,
  occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  actor_id                TEXT NOT NULL,
  actor_type              TEXT NOT NULL,

  correlation_id          TEXT NOT NULL,
  causation_id            TEXT,

  -- Which subsystem stated this fact. Free text by design: the platform does
  -- not own the vocabulary of every subsystem that will emit.
  source                  TEXT NOT NULL,
  entity_type             TEXT,
  entity_id               TEXT,

  classification          TEXT NOT NULL DEFAULT 'internal'
                          CONSTRAINT durable_outbox_classification_check
                          CHECK (classification IN ('public', 'internal',
                                                    'confidential', 'restricted')),

  payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  dispatch_state          TEXT NOT NULL DEFAULT 'pending'
                          CONSTRAINT durable_outbox_dispatch_check
                          CHECK (dispatch_state IN ('pending', 'dispatching',
                                                    'dispatched', 'failed')),
  attempt                 INTEGER NOT NULL DEFAULT 0,
  max_attempts            INTEGER NOT NULL DEFAULT 5,
  available_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner             TEXT,
  lease_generation        INTEGER NOT NULL DEFAULT 0,
  lease_expires_at        TIMESTAMPTZ,
  failure_code            TEXT,
  failure_detail          TEXT,

  -- The job this fact came out of, when it came out of one.
  job_id                  UUID,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at           TIMESTAMPTZ,

  CONSTRAINT durable_outbox_id_org_uk UNIQUE (id, organization_id),
  CONSTRAINT durable_outbox_type_present CHECK (length(trim(event_type)) > 0),
  CONSTRAINT durable_outbox_source_present CHECK (length(trim(source)) > 0),
  CONSTRAINT durable_outbox_correlation_present CHECK (length(trim(correlation_id)) > 0),
  CONSTRAINT durable_outbox_version_bounded CHECK (event_version >= 1 AND event_version <= 999),
  CONSTRAINT durable_outbox_attempts_bounded CHECK (
    attempt >= 0 AND max_attempts >= 1 AND max_attempts <= 50 AND attempt <= max_attempts
  ),
  CONSTRAINT durable_outbox_dispatch_coherent CHECK (
    (dispatch_state = 'dispatching') = (lease_owner IS NOT NULL)
  ),
  -- THE PAYLOAD CEILING. See the header. 16 KiB is generous for identifiers
  -- and scalars and far too small to hold a document, which is the distinction
  -- that matters.
  CONSTRAINT durable_outbox_payload_bounded CHECK (pg_column_size(payload) <= 16384),

  CONSTRAINT durable_outbox_job_same_org
    FOREIGN KEY (job_id, organization_id)
    REFERENCES public.durable_jobs (id, organization_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS durable_outbox_dispatchable_idx
  ON public.durable_outbox (organization_id, available_at, created_at)
  WHERE dispatch_state = 'pending';
-- THE BACKLOG-AGE MEASURE. BP-002 §13 asks for "oldest pending outbox age", and
-- a cross-tenant index is what makes that one row read instead of a scan.
CREATE INDEX IF NOT EXISTS durable_outbox_backlog_idx
  ON public.durable_outbox (created_at)
  WHERE dispatch_state IN ('pending', 'dispatching');
CREATE INDEX IF NOT EXISTS durable_outbox_correlation_idx
  ON public.durable_outbox (organization_id, correlation_id);

DROP TRIGGER IF EXISTS durable_outbox_set_updated_at ON public.durable_outbox;
CREATE TRIGGER durable_outbox_set_updated_at
  BEFORE UPDATE ON public.durable_outbox
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.durable_outbox IS
  'BP-002 A1 — immutable domain events, written in the same transaction as the state change they describe.';

-- ---------------------------------------------------------------------------
-- 4. durable_inbox — proof that a consumer has already seen this
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.durable_inbox (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- WHO has seen it. Idempotency is per consumer, not per event: two consumers
  -- of the same event must each get their one effect, and a single "processed"
  -- flag on the event would give the second one nothing.
  consumer_key            TEXT NOT NULL,
  event_id                UUID NOT NULL,
  event_type              TEXT NOT NULL,

  status                  TEXT NOT NULL DEFAULT 'processed'
                          CONSTRAINT durable_inbox_status_check
                          CHECK (status IN ('processed', 'failed')),
  processed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  correlation_id          TEXT,
  causation_id            TEXT,
  failure_code            TEXT,
  failure_detail          TEXT,
  result                  JSONB,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- THE IDEMPOTENCY GUARANTEE. BP-002 §6.5: "uniqueness must enforce
  -- idempotency at the database layer where practical." Here it is practical,
  -- so here it is enforced — the consumer inserts FIRST and treats a conflict
  -- as "already done", which means the suppression survives two isolates
  -- racing, not merely two sequential deliveries.
  CONSTRAINT durable_inbox_once_uk UNIQUE (organization_id, consumer_key, event_id),
  CONSTRAINT durable_inbox_consumer_present CHECK (length(trim(consumer_key)) > 0),
  CONSTRAINT durable_inbox_result_bounded CHECK (result IS NULL OR pg_column_size(result) <= 16384),

  CONSTRAINT durable_inbox_event_same_org
    FOREIGN KEY (event_id, organization_id)
    REFERENCES public.durable_outbox (id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS durable_inbox_consumer_idx
  ON public.durable_inbox (organization_id, consumer_key, processed_at DESC);

DROP TRIGGER IF EXISTS durable_inbox_set_updated_at ON public.durable_inbox;
CREATE TRIGGER durable_inbox_set_updated_at
  BEFORE UPDATE ON public.durable_inbox
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.durable_inbox IS
  'BP-002 A1 — one row per (consumer, event). The unique key is what makes a duplicate delivery one logical effect.';

-- ---------------------------------------------------------------------------
-- 5. durable_dead_letters — work that failed for the last time
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.durable_dead_letters (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  origin_kind             TEXT NOT NULL
                          CONSTRAINT durable_dead_letters_origin_check
                          CHECK (origin_kind IN ('job', 'event')),
  origin_id               UUID NOT NULL,
  origin_type             TEXT NOT NULL,

  attempts                INTEGER NOT NULL,
  failure_code            TEXT NOT NULL,
  failure_detail          TEXT,

  correlation_id          TEXT NOT NULL,
  causation_id            TEXT,

  first_failed_at         TIMESTAMPTZ NOT NULL,
  last_failed_at          TIMESTAMPTZ NOT NULL,

  -- Recovery is RECORDED, not automatic. Requeueing exhausted work without a
  -- person deciding to is how a permanent failure becomes an infinite one.
  recovery_state          TEXT NOT NULL DEFAULT 'unrecovered'
                          CONSTRAINT durable_dead_letters_recovery_check
                          CHECK (recovery_state IN ('unrecovered', 'requeued', 'abandoned')),
  recovered_at            TIMESTAMPTZ,
  recovered_job_id        UUID,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT durable_dead_letters_id_org_uk UNIQUE (id, organization_id),
  -- One dead-letter row per piece of work. A second exhaustion of the same job
  -- is impossible — it is already terminal — and a duplicate row would double
  -- every count built on this table.
  CONSTRAINT durable_dead_letters_origin_uk UNIQUE (organization_id, origin_kind, origin_id),
  CONSTRAINT durable_dead_letters_attempts_positive CHECK (attempts >= 1),
  CONSTRAINT durable_dead_letters_order CHECK (last_failed_at >= first_failed_at)
);

CREATE INDEX IF NOT EXISTS durable_dead_letters_open_idx
  ON public.durable_dead_letters (organization_id, last_failed_at DESC)
  WHERE recovery_state = 'unrecovered';

DROP TRIGGER IF EXISTS durable_dead_letters_set_updated_at ON public.durable_dead_letters;
CREATE TRIGGER durable_dead_letters_set_updated_at
  BEFORE UPDATE ON public.durable_dead_letters
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.durable_dead_letters IS
  'BP-002 A1 — exhausted jobs and undeliverable events. Nothing is dropped silently.';

COMMIT;
