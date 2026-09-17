-- ============================================================================
-- ROLLBACK — CP-3 organizational spine
-- ============================================================================
--
-- Removes exactly what `20260917120000` and `20260917120001` added, and
-- nothing that predates them.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH:
--
--   * `organization_memberships`, `organizations`, `roles`, `permissions`,
--     `role_permissions` — the 2026-07-11 foundation. The spine builds on it
--     and does not own it.
--   * The `members.read` / `members.manage` permissions and their grants.
--
-- The two permission keys CP-3 seeded ARE removed, and their role grants with
-- them: they name tables that will not exist after this file runs, and a
-- permission that grants authority over nothing is a trap for the next reader.
--
-- Order matters. `team_memberships` references `teams` and `people`; `teams`
-- and `people` reference `departments`; `departments` references
-- `business_units` and `people`. Dropping in reverse dependency order means no
-- CASCADE is needed, and no CASCADE means this file cannot quietly take
-- something with it.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.team_memberships;

-- `departments.lead_person_id` points at `people`, and `people.department_id`
-- points back. The constraint goes first so neither table has to be dropped
-- with CASCADE.
ALTER TABLE IF EXISTS public.departments
  DROP CONSTRAINT IF EXISTS departments_lead_same_org;

DROP TABLE IF EXISTS public.teams;
DROP TABLE IF EXISTS public.people;
DROP TABLE IF EXISTS public.departments;
DROP TABLE IF EXISTS public.business_units;

-- The permission keys and their grants. `role_permissions` rows go first
-- because `permissions` is referenced with ON DELETE RESTRICT.
DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id
  AND p.key IN ('organization.structure.read', 'organization.structure.manage');

DELETE FROM public.permissions
WHERE key IN ('organization.structure.read', 'organization.structure.manage');

-- The unique constraint added purely so the spine's composite foreign keys had
-- a parent to reference. Nothing that predates CP-3 uses it.
ALTER TABLE IF EXISTS public.organizations
  DROP CONSTRAINT IF EXISTS organizations_id_self_uk;

COMMIT;
