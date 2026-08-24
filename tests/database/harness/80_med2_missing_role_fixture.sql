-- ============================================================================
-- MED-2 fixture — the seeded role catalog with `org_admin` removed.
--
-- The defect: the bootstrap joins each candidate to `public.roles` on the
-- mapped key, so a missing key removed its candidates from the INSERT with no
-- error and no non-zero exit. Every owner and admin would have been dropped and
-- the migration would have reported success.
--
-- This fixture creates that database. `80` runs before the bootstrap; the
-- runner expects the bootstrap to FAIL, and `81` asserts nothing survived.
-- ============================================================================

-- Removable only because no membership references it yet — which is the state
-- a fresh project is in, and the state in which the defect would have shipped.
DELETE FROM public.roles
WHERE key = 'org_admin' AND scope = 'platform' AND is_system = true AND organization_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roles WHERE key = 'org_admin') THEN
    RAISE EXCEPTION 'fixture: org_admin is still in the catalog; the scenario would not exercise MED-2';
  END IF;
END $$;

-- Stamped, eligible staff. Two map to the missing `org_admin`, one to a key
-- that is still present — so a bootstrap that "succeeds partially" would create
-- exactly one membership and say so cheerfully.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-0000000b0001', 'med2-owner@marq.test',
   '{"marq_team": true, "team_role": "owner"}'::JSONB, '{}'::JSONB),
  ('00000000-0000-4000-8000-0000000b0002', 'med2-admin@marq.test',
   '{"marq_team": true, "team_role": "admin"}'::JSONB, '{}'::JSONB),
  ('00000000-0000-4000-8000-0000000b0003', 'med2-viewer@marq.test',
   '{"marq_team": true, "team_role": "viewer"}'::JSONB, '{}'::JSONB);
