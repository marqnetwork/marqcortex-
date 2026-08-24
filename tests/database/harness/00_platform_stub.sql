-- ============================================================================
-- Supabase platform stub for the local membership-bootstrap harness.
--
-- The migrations under test depend on objects a Supabase project provides and a
-- bare Postgres does not: the `auth` schema, `auth.users`, `auth.uid()`,
-- `auth.jwt()`, and the `anon` / `authenticated` / `service_role` roles. This
-- file creates the smallest versions of those that let the real migration files
-- run unmodified.
--
-- The stub is deliberately close to the real thing where it matters:
--
--   * `auth.users` carries BOTH metadata bags — `raw_app_meta_data` and
--     `raw_user_meta_data` — because the whole point of the eligibility
--     remediation is that the migration reads one and never the other, and a
--     stub with only one column could not tell those apart.
--   * `deleted_at` and `banned_until` are present, because the migration reads
--     them through `to_jsonb(u)` precisely so it survives their absence, and a
--     test that omitted them would exercise the wrong branch.
--
-- It is NOT a security model. RLS behaviour is covered by the tenancy RLS suite
-- against a real project; nothing here asserts anything about policies.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT UNIQUE,
  raw_app_meta_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  banned_until       TIMESTAMPTZ
);

-- The session's claims, set per-connection by the harness. Unset means
-- "no authenticated user", which is what an anonymous request looks like.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
