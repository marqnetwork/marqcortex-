-- ============================================================================
-- ROLLBACK — CP-4 strategic layer (goals, decisions, risks)
--
-- Reverse dependency order, and NO CASCADE anywhere. `decisions` and `risks`
-- both reference `goals` through composite foreign keys, so `goals` goes last;
-- a CASCADE would hide a table this script forgot rather than failing on it.
--
-- The ORGANIZATIONAL SPINE IS NOT TOUCHED. `goals.owner_person_id` references
-- `people`, and dropping `goals` removes that reference without removing a
-- single person — which is the property `202_assert_strategic_rollback.sql`
-- checks, because a rollback that takes the organization with it is worse than
-- one that fails.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.risks;
DROP TABLE IF EXISTS public.decisions;
DROP TABLE IF EXISTS public.goals;

-- The permission keys and their grants go too. A key with no table behind it
-- is a grant that looks meaningful and governs nothing.
DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id
  AND p.key IN ('strategy.read', 'strategy.manage');

DELETE FROM public.permissions
WHERE key IN ('strategy.read', 'strategy.manage');

COMMIT;
