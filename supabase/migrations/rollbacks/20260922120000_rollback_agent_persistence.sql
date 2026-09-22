-- ============================================================================
-- ROLLBACK — A2-P07 agent runtime SQL persistence
--
-- Reverse dependency order and NO CASCADE, for BP-003's reason: a CASCADE
-- hides a table this script forgot rather than failing on it.
--
--   agent_approvals    references agent_runs
--   agent_checkpoints  references agent_runs
--   agent_runs         references organizations
--
-- NOTHING ELSE IS TOUCHED. Not the key-value store, which still holds every
-- agent run, checkpoint and approval the platform has, under
-- `org:{org}:ai:agent_*`. Not `kv_compare_and_swap_field`. Not the BP-003
-- workflow tables, and in particular NOT `cortex.refuse_checkpoint_mutation()`,
-- which is the WORKFLOW checkpoint trigger's function and belongs to that
-- migration — the agent trigger has its own function precisely so this
-- rollback can drop it without reaching across a domain. Not the durable
-- runtime, the tenancy foundation or any permission row.
--
-- The functions go with the tables: an executable grant on a function whose
-- table is gone is a capability that is a runtime error.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.agent_approval_list(UUID, TEXT, BOOLEAN, INTEGER);
DROP FUNCTION IF EXISTS public.agent_approval_load(UUID, TEXT);
DROP FUNCTION IF EXISTS public.agent_approval_save(UUID, TEXT, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.agent_approval_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.agent_checkpoint_history(UUID, TEXT);
DROP FUNCTION IF EXISTS public.agent_checkpoint_latest(UUID, TEXT);
DROP FUNCTION IF EXISTS public.agent_checkpoint_read(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.agent_checkpoint_append(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.agent_run_list(UUID, TEXT[], TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.agent_run_load(UUID, TEXT);
DROP FUNCTION IF EXISTS public.agent_run_save(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.agent_run_create(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, JSONB);

DROP TABLE IF EXISTS public.agent_approvals;
DROP TABLE IF EXISTS public.agent_checkpoints;
DROP TABLE IF EXISTS public.agent_runs;

-- After the table whose trigger used it.
DROP FUNCTION IF EXISTS cortex.refuse_agent_checkpoint_mutation();

COMMIT;
