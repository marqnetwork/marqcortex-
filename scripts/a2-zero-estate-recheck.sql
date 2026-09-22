-- ============================================================================
-- A2 — THE FINAL ZERO-ESTATE RECHECK. READ ONLY.
--
-- Run immediately before any workflow or agent authority moves (Gate W), and
-- again after the freeze has been observed. It answers one question per domain:
-- does ANY runtime row exist, in the key-value store or in the SQL tables?
--
--   workflow_*  and  agent_*  keys in public.kv_store_324f4fbe, by KEY only
--   public.workflow_* and public.agent_* tables, if they exist yet
--
-- It reads no value. It writes nothing: the session is forced read-only before
-- the transaction opens, and the transaction itself is READ ONLY, so an edit to
-- this file that added a write would fail rather than execute.
--
-- The verdict is ZERO_ESTATE or ABORT_ZERO_BACKFILL_STRATEGY. On ABORT nothing
-- is dropped, ignored or copied: strategy selection is re-entered (A2-P05).
--
-- ROW SECURITY. The SQL runtime tables FORCE row-level security with no policy,
-- so a role that cannot bypass it counts ZERO rows in a table that holds
-- thousands — a false ZERO_ESTATE, which is the one wrong answer this check
-- exists to prevent. The session role is therefore inspected, and a role that
-- is neither superuser nor BYPASSRLS gets INCONCLUSIVE_ROW_SECURITY, never a
-- verdict it could not have observed.
--
-- The key patterns are the ones `ai/persistence/runtimeEstateCensus.ts` uses,
-- pinned equal by `runtimeEstateCensus.test.ts`.
-- ============================================================================

SET default_transaction_read_only = on;
BEGIN READ ONLY;

WITH kv AS (
  SELECT
    count(*) FILTER (WHERE key ~ '^org:[^:]+:ai:workflow_run:')        AS workflow_runs,
    count(*) FILTER (WHERE key ~ '^org:[^:]+:ai:workflow_checkpoint:') AS workflow_checkpoints,
    count(*) FILTER (WHERE key ~ '^org:[^:]+:ai:workflow_approval:')   AS workflow_approvals,
    count(*) FILTER (WHERE key ~ '^org:[^:]+:ai:agent_run:')           AS agent_runs,
    count(*) FILTER (WHERE key ~ '^org:[^:]+:ai:agent_checkpoint:')    AS agent_checkpoints,
    count(*) FILTER (WHERE key ~ '^org:[^:]+:ai:agent_approval:')      AS agent_approvals,
    count(*)                                                           AS inspected
  FROM public.kv_store_324f4fbe
),
-- A table that does not exist yet holds nothing. `query_to_xml` lets the count
-- be attempted only when the relation exists, without dynamic DDL.
sql AS (
  SELECT
    t.name,
    CASE WHEN to_regclass('public.' || t.name) IS NULL THEN NULL
         ELSE (xpath('/row/c/text()',
                     query_to_xml(format('SELECT count(*) AS c FROM public.%I', t.name), false, true, '')))[1]::text::bigint
    END AS n
  FROM unnest(ARRAY['workflow_runs', 'workflow_checkpoints', 'workflow_approvals',
                    'agent_runs', 'agent_checkpoints', 'agent_approvals']) AS t(name)
),
who AS (
  SELECT (r.rolsuper OR r.rolbypassrls) AS sees_every_row
  FROM pg_roles r WHERE r.rolname = current_user
),
sql_counts AS (
  SELECT jsonb_object_agg(name, n) AS counts,
         COALESCE(sum(n), 0) AS total,
         count(*) FILTER (WHERE n IS NULL) AS absent
  FROM sql
)
SELECT jsonb_build_object(
  'check', 'a2-zero-estate-recheck',
  'read_only', current_setting('transaction_read_only'),
  'kv', jsonb_build_object(
    'workflow', jsonb_build_object('runs', kv.workflow_runs, 'checkpoints', kv.workflow_checkpoints, 'approvals', kv.workflow_approvals),
    'agent',    jsonb_build_object('runs', kv.agent_runs,    'checkpoints', kv.agent_checkpoints,    'approvals', kv.agent_approvals),
    'inspected', kv.inspected),
  'sql', sql_counts.counts,
  'sql_tables_absent', sql_counts.absent,
  'role', current_user,
  'role_sees_every_row', who.sees_every_row,
  'verdict', CASE
    WHEN NOT COALESCE(who.sees_every_row, false) THEN 'INCONCLUSIVE_ROW_SECURITY'
    WHEN kv.workflow_runs + kv.workflow_checkpoints + kv.workflow_approvals
       + kv.agent_runs + kv.agent_checkpoints + kv.agent_approvals + sql_counts.total = 0
    THEN 'ZERO_ESTATE'
    ELSE 'ABORT_ZERO_BACKFILL_STRATEGY'
  END
)::text AS recheck
FROM kv, sql_counts, who;

COMMIT;
