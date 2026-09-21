-- ============================================================================
-- ROLLBACK — BP-002 / A1 durable runtime foundation
--
-- Reverse dependency order, and NO CASCADE anywhere — the same rule the
-- strategic layer's rollback states, for the same reason: a CASCADE hides a
-- table this script forgot rather than failing on it.
--
--   durable_inbox         references durable_outbox
--   durable_outbox        references durable_jobs
--   durable_jobs          references durable_schedules
--   durable_dead_letters  references nothing but organizations
--
-- THE ORGANIZATIONS, THE SPINE AND THE KV STORE ARE NOT TOUCHED. This packet
-- added durable state beside the existing runtime and migrated none of it, so
-- there is nothing here to put back: every agent run, workflow run, checkpoint
-- and approval is exactly where it was. A rollback that took live runtime state
-- with it would be worse than one that fails.
--
-- THE FUNCTIONS GO TOO. A `durable_job_claim` with no `durable_jobs` behind it
-- is an executable grant that looks like a capability and is a runtime error.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.durable_inbox_recover_claims(TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.durable_inbox_settle(UUID, TEXT, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.durable_inbox_claim(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.durable_outbox_recover_leases(TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.durable_outbox_settle(UUID, UUID, TEXT, INTEGER, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.durable_outbox_claim(UUID, TEXT, INTEGER, TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.durable_job_transition(UUID, UUID, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.durable_schedule_materialize_due(UUID, TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.durable_job_recover_leases(TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS public.durable_job_settle(UUID, UUID, TEXT, INTEGER, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, JSONB, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.durable_job_heartbeat(UUID, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.durable_job_claim(UUID, TEXT[], TEXT, INTEGER, TIMESTAMPTZ);

DROP TABLE IF EXISTS public.durable_inbox;
DROP TABLE IF EXISTS public.durable_dead_letters;
DROP TABLE IF EXISTS public.durable_outbox;
DROP TABLE IF EXISTS public.durable_jobs;
DROP TABLE IF EXISTS public.durable_schedules;

-- The permission keys and their grants go with the tables. A key with no table
-- behind it is a grant that looks meaningful and governs nothing.
DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id
  AND p.key IN ('runtime.read', 'runtime.operate');

DELETE FROM public.permissions
WHERE key IN ('runtime.read', 'runtime.operate');

COMMIT;
