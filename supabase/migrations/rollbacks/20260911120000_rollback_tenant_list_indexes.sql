-- Rollback for 20260911120000_cortex_tenant_list_indexes.sql
--
-- Drops exactly the two indexes that migration creates. Nothing else in the
-- estate references them: an index is not a dependency, so dropping one changes
-- how a query is EXECUTED and never what it returns. The two list queries go
-- back to reading every tenant's rows, which is the state this rolled forward
-- from.

DROP INDEX IF EXISTS public.outcomes_organization_recorded_at_idx;
DROP INDEX IF EXISTS public.reports_organization_created_at_idx;
