-- ═══════════════════════════════════════════════════════════════════════════
-- Tenant list indexes — the two queries that scan every tenant's rows
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS FIXES
--
-- `listOutcomes` and `listReports` are the only two repository queries that
-- filter on `organization_id` ALONE. Every other query on these tables reaches
-- them through an indexed parent key — `submission_id`, `report_id`,
-- `contact_id` — so the tenancy filter there runs over a handful of rows and
-- needs no index of its own.
--
-- These two do not. Their shape is
--
--     WHERE organization_id = $1 AND deleted_at IS NULL
--     ORDER BY <recorded_at|created_at> DESC
--     LIMIT n OFFSET m
--
-- and with no index leading on `organization_id`, PostgreSQL reads EVERY row in
-- the table, discards the other tenants', sorts what is left, and returns fifty.
-- One tenant opening their outcomes list pays for every other tenant's data.
-- That cost is invisible at demo scale and is the ordinary way a multi-tenant
-- product becomes slow — not gradually, but per-tenant, for reasons that do not
-- show up in any one tenant's usage.
--
-- WHY THE INDEXES LOOK LIKE THIS
--
--   organization_id first    the equality predicate, and the only one that
--                            separates tenants
--   <timestamp> DESC second  the ORDER BY, so the LIMIT is satisfied by walking
--                            the index rather than sorting the match set
--   WHERE deleted_at IS NULL partial: soft-deleted rows are never listed, so
--                            they do not belong in the index at all. It also
--                            matches the predicate exactly, which is what lets
--                            the planner use it.
--
-- A NOTE FOR AN OPERATOR WITH A LARGE TABLE
--
-- `CREATE INDEX` takes an ACCESS EXCLUSIVE lock for the duration of the build.
-- These tables are empty or near-empty at V1, so this is instantaneous. Against
-- an estate with millions of rows, build them with `CREATE INDEX CONCURRENTLY`
-- outside a transaction instead — which is why this migration does not use
-- CONCURRENTLY itself: it cannot run inside the transaction a migration runs in.
--
-- Additive and idempotent. It creates nothing that did not exist and changes no
-- row. The rollback drops exactly these two.

CREATE INDEX IF NOT EXISTS outcomes_organization_recorded_at_idx
  ON public.outcomes (organization_id, recorded_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS reports_organization_created_at_idx
  ON public.reports (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX public.outcomes_organization_recorded_at_idx IS
  'Serves listOutcomes: organization_id = $1 AND deleted_at IS NULL ORDER BY recorded_at DESC. Without it the query reads every tenant''s outcomes.';

COMMENT ON INDEX public.reports_organization_created_at_idx IS
  'Serves listReports: organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC. Without it the query reads every tenant''s reports.';
