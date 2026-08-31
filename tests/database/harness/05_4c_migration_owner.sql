-- ---------------------------------------------------------------------------
-- A stand-in for the role Supabase applies migrations as.
--
-- WHY THE 4C SCENARIOS DO NOT APPLY THEIR MIGRATIONS AS A SUPERUSER.
--
-- `cortex.ai_provider_credential_activate` is SECURITY DEFINER, so its INSERT
-- and UPDATE run as the FUNCTION'S OWNER — which is whoever applied the
-- migration. The same migration then puts `FORCE ROW LEVEL SECURITY` on the
-- table, and FORCE means row level security applies to the table's owner too.
--
-- A superuser sails through both, because superusers bypass RLS
-- unconditionally. So a harness that applies the migration as a superuser
-- would prove that the activation function works FOR A SUPERUSER and say
-- nothing at all about the deployment. The one question worth asking —
-- "does this function work when its owner is subject to the RLS the same file
-- enables?" — would go unasked, and the answer would arrive in production.
--
-- This role is therefore NOSUPERUSER, and holds exactly the two attributes the
-- role Supabase applies migrations as holds: it can create, and it has
-- `BYPASSRLS`. If the 4C migration ever comes to depend on more than that, the
-- scenarios fail here rather than in a deployment.
--
-- Run as the scratch cluster's owner, BEFORE any migration.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cortex_migration_owner') THEN
    CREATE ROLE cortex_migration_owner NOLOGIN NOSUPERUSER BYPASSRLS;
  END IF;
END $$;

-- What a migration needs in order to be a migration: a schema to create in, and
-- a database to create a schema in.
GRANT CREATE, USAGE ON SCHEMA public TO cortex_migration_owner;
GRANT CREATE ON DATABASE :"DBNAME" TO cortex_migration_owner;

-- The tenancy foundation puts foreign keys on `auth.users`, which in a real
-- project is owned by the auth service and reachable by the migration role.
-- REFERENCES is the privilege a foreign key actually requires; SELECT is what
-- the seed reads with.
GRANT USAGE ON SCHEMA auth TO cortex_migration_owner;
GRANT SELECT, REFERENCES ON auth.users TO cortex_migration_owner;
