-- ---------------------------------------------------------------------------
-- Supabase platform grants on `public`, for the local harness.
--
-- A Supabase project grants the API roles table privileges on `public` as part
-- of the platform, not as part of any migration in this repository — which is
-- why the migrations under test grant on `cortex` and say nothing about
-- `public`. A bare PostgreSQL gives them nothing, so a harness that skipped
-- this would report "permission denied" for a role that has permission in every
-- real deployment, and the failure would look like a defect in the migration.
--
-- Run AFTER the migrations have created the tables, and as the session role.
--
-- `service_role` ONLY. `anon` and `authenticated` are deliberately left alone:
-- what they may reach is decided by the RLS policies the migrations install and
-- by the grants they make, and handing them blanket privileges here would make
-- every isolation assertion in this directory weaker than the deployment it
-- claims to model.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'platform_public_grants: service_role granted on public (anon and authenticated untouched)';
END $$;
