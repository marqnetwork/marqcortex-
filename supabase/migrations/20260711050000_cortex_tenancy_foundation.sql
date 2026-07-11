-- ============================================================================
-- MCV2-S4-IMPLEMENT-001 — Cortex Tenancy Foundation (Tables)
-- Sprint: Tenancy and Identity Foundation
-- Status: Additive only — does not modify kv_store_324f4fbe or auth schema
-- Apply: staging/local only until explicitly approved for production
-- Rollback: supabase/migrations/rollbacks/20260711050000_rollback_tenancy.sql
-- ============================================================================

BEGIN;

-- Application helper schema (auth schema is not writable on Supabase)
CREATE SCHEMA IF NOT EXISTS cortex;

COMMENT ON SCHEMA cortex IS
  'Cortex tenancy RLS helpers and internal functions. Tables remain in public.';

-- ---------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cortex.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, cortex
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION cortex.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cortex.set_updated_at() TO service_role;

-- ---------------------------------------------------------------------------
-- 1. organizations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
              CONSTRAINT organizations_status_check
              CHECK (status IN ('active', 'suspended', 'archived')),
  plan        TEXT NOT NULL DEFAULT 'standard'
              CONSTRAINT organizations_plan_check
              CHECK (plan IN ('standard', 'enterprise', 'internal')),
  timezone    TEXT NOT NULL DEFAULT 'UTC',
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  CONSTRAINT organizations_slug_normalized CHECK (slug = lower(trim(slug))),
  CONSTRAINT organizations_metadata_no_secrets CHECK (
    NOT (metadata ? 'password')
    AND NOT (metadata ? 'api_key')
    AND NOT (metadata ? 'secret')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_active_uidx
  ON public.organizations (slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS organizations_status_idx
  ON public.organizations (status)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS organizations_set_updated_at ON public.organizations;
CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.organizations IS
  'Canonical tenant record. organization_id is the tenant boundary for all owned data.';

-- ---------------------------------------------------------------------------
-- 2. roles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  scope           TEXT NOT NULL
                  CONSTRAINT roles_scope_check
                  CHECK (scope IN ('platform', 'organization')),
  is_system       BOOLEAN NOT NULL DEFAULT false,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT roles_key_normalized CHECK (key = lower(trim(key))),
  CONSTRAINT roles_system_scope_consistency CHECK (
    (is_system = true AND organization_id IS NULL)
    OR (is_system = false AND organization_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_scope_key_system_uidx
  ON public.roles (scope, key)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS roles_org_key_uidx
  ON public.roles (organization_id, key)
  WHERE organization_id IS NOT NULL;

DROP TRIGGER IF EXISTS roles_set_updated_at ON public.roles;
CREATE TRIGGER roles_set_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.roles IS
  'Reusable role catalog. System roles (is_system=true) are platform-wide and read-only to org members.';

-- ---------------------------------------------------------------------------
-- 3. permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permissions_key_normalized CHECK (key = lower(trim(key)))
);

CREATE UNIQUE INDEX IF NOT EXISTS permissions_key_uidx
  ON public.permissions (key);

COMMENT ON TABLE public.permissions IS
  'Canonical permission catalog. Extend with stable dotted keys (e.g. settings.manage).';

-- ---------------------------------------------------------------------------
-- 4. role_permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id       UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS role_permissions_permission_idx
  ON public.role_permissions (permission_id);

COMMENT ON TABLE public.role_permissions IS
  'Maps roles to permissions. CASCADE on role delete; RESTRICT on permission delete.';

-- ---------------------------------------------------------------------------
-- 5. organization_memberships
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id         UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CONSTRAINT organization_memberships_status_check
                  CHECK (status IN ('active', 'invited', 'suspended')),
  invited_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_active_uidx
  ON public.organization_memberships (organization_id, user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
  ON public.organization_memberships (user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS organization_memberships_org_idx
  ON public.organization_memberships (organization_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS organization_memberships_set_updated_at ON public.organization_memberships;
CREATE TRIGGER organization_memberships_set_updated_at
  BEFORE UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.organization_memberships IS
  'Connects Supabase Auth users to organizations and roles. Future authority source; KV/runtime unchanged this sprint.';

-- ---------------------------------------------------------------------------
-- 6. organization_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT organization_settings_version_positive CHECK (version > 0)
);

DROP TRIGGER IF EXISTS organization_settings_set_updated_at ON public.organization_settings;
CREATE TRIGGER organization_settings_set_updated_at
  BEFORE UPDATE ON public.organization_settings
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.organization_settings IS
  'One canonical settings record per organization. KV settings:platform not migrated this sprint.';

COMMIT;
