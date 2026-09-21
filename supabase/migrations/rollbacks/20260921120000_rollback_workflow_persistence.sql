-- ============================================================================
-- ROLLBACK — BP-003 / A2 workflow runtime SQL persistence
--
-- Reverse dependency order, and NO CASCADE anywhere — the same rule the
-- durable runtime's rollback states, for the same reason: a CASCADE hides a
-- table this script forgot rather than failing on it.
--
--   workflow_approvals    references workflow_runs
--   workflow_checkpoints  references workflow_runs
--   workflow_runs         references organizations
--
-- THE KEY-VALUE STORE, ITS COMPARE-AND-SWAP FUNCTION, THE TENANCY FOUNDATION
-- AND THE DURABLE RUNTIME ARE NOT TOUCHED.
--
-- That is not a courtesy, it is the entire safety position of BP-003. This
-- packet added a SQL implementation BESIDE the existing workflow persistence
-- and migrated nothing: every workflow run, checkpoint and approval the
-- platform holds is still in `kv_store_324f4fbe` under
-- `org:{org}:ai:workflow_*`, still written through
-- `kv_compare_and_swap_field`, still read by the stores the production
-- bootstrap constructs. So there is nothing here to put back, and a rollback
-- that took live runtime state with it would be worse than one that fails.
--
-- THE FUNCTIONS GO TOO. A `workflow_run_save` with no `workflow_runs` behind
-- it is an executable grant that looks like a capability and is a runtime
-- error.
--
-- THE APPEND-ONLY TRIGGER FUNCTION GOES LAST, after the table whose trigger
-- depends on it.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.workflow_approval_list(UUID, TEXT, BOOLEAN, INTEGER);
DROP FUNCTION IF EXISTS public.workflow_approval_load(UUID, TEXT);
DROP FUNCTION IF EXISTS public.workflow_approval_save(UUID, TEXT, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.workflow_approval_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.workflow_checkpoint_history(UUID, TEXT);
DROP FUNCTION IF EXISTS public.workflow_checkpoint_latest(UUID, TEXT);
DROP FUNCTION IF EXISTS public.workflow_checkpoint_read(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.workflow_checkpoint_append(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.workflow_run_list(UUID, TEXT[], TEXT, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.workflow_run_load(UUID, TEXT);
DROP FUNCTION IF EXISTS public.workflow_run_save(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.workflow_run_create(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, JSONB);

DROP TABLE IF EXISTS public.workflow_approvals;
DROP TABLE IF EXISTS public.workflow_checkpoints;
DROP TABLE IF EXISTS public.workflow_runs;

-- After the table, because the trigger that used it is gone with it.
DROP FUNCTION IF EXISTS cortex.refuse_checkpoint_mutation();

-- The permission keys and their grants go with the tables. A key with no table
-- behind it is a grant that looks meaningful and governs nothing.
DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id
  AND p.key IN ('workflows.read', 'workflows.operate');

DELETE FROM public.permissions
WHERE key IN ('workflows.read', 'workflows.operate');

COMMIT;
