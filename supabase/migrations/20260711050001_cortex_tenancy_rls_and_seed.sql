-- ============================================================================
-- MCV2-S4-IMPLEMENT-001 — Cortex Tenancy RLS, Helpers, and Seed
-- Depends on: 20260711050000_cortex_tenancy_foundation.sql
-- Rollback: supabase/migrations/rollbacks/20260711050000_rollback_tenancy.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- RLS helper functions (cortex schema — auth schema is not writable)
-- SECURITY DEFINER used only to avoid recursive RLS evaluation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cortex.current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, cortex
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION cortex.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'platform_role') = 'admin',
    false
  )
  OR EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id
    WHERE m.user_id = auth.uid()
      AND m.status = 'active'
      AND m.deleted_at IS NULL
      AND r.key = 'platform_admin'
      AND r.is_system = true
  );
$$;

CREATE OR REPLACE FUNCTION cortex.is_organization_member(target_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT CASE
    WHEN target_organization_id IS NULL THEN false
    WHEN cortex.is_platform_admin() THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.organization_id = target_organization_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.deleted_at IS NULL
    )
  END;
$$;

CREATE OR REPLACE FUNCTION cortex.is_organization_admin(target_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT CASE
    WHEN target_organization_id IS NULL THEN false
    WHEN cortex.is_platform_admin() THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      JOIN public.roles r ON r.id = m.role_id
      WHERE m.organization_id = target_organization_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.deleted_at IS NULL
        AND r.key = 'org_admin'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION cortex.has_permission(
  target_organization_id UUID,
  permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT CASE
    WHEN target_organization_id IS NULL OR permission_key IS NULL THEN false
    WHEN cortex.is_platform_admin() THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      JOIN public.role_permissions rp ON rp.role_id = m.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE m.organization_id = target_organization_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.deleted_at IS NULL
        AND p.key = lower(trim(permission_key))
    )
  END;
$$;

CREATE OR REPLACE FUNCTION cortex.user_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT m.organization_id
  FROM public.organization_memberships m
  WHERE m.user_id = auth.uid()
    AND m.status = 'active'
    AND m.deleted_at IS NULL
  UNION
  SELECT o.id
  FROM public.organizations o
  WHERE cortex.is_platform_admin();
$$;

REVOKE ALL ON FUNCTION cortex.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.is_organization_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.is_organization_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.has_permission(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.user_organization_ids() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cortex.current_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cortex.is_platform_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cortex.is_organization_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cortex.is_organization_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cortex.has_permission(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cortex.user_organization_ids() TO authenticated, service_role;

GRANT USAGE ON SCHEMA cortex TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners (Supabase best practice)
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_settings FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- organizations policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      cortex.is_platform_admin()
      OR id IN (SELECT cortex.user_organization_ids())
    )
  );

DROP POLICY IF EXISTS organizations_update_admin ON public.organizations;
CREATE POLICY organizations_update_admin ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND cortex.is_organization_admin(id)
  )
  WITH CHECK (
    deleted_at IS NULL
    AND cortex.is_organization_admin(id)
  );

DROP POLICY IF EXISTS organizations_insert_platform ON public.organizations;
CREATE POLICY organizations_insert_platform ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (cortex.is_platform_admin());

DROP POLICY IF EXISTS organizations_delete_platform ON public.organizations;
CREATE POLICY organizations_delete_platform ON public.organizations
  FOR DELETE TO authenticated
  USING (cortex.is_platform_admin());

-- ---------------------------------------------------------------------------
-- organization_memberships policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS memberships_select_org ON public.organization_memberships;
CREATE POLICY memberships_select_org ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      cortex.is_platform_admin()
      OR cortex.is_organization_member(organization_id)
    )
  );

DROP POLICY IF EXISTS memberships_insert_admin ON public.organization_memberships;
CREATE POLICY memberships_insert_admin ON public.organization_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    cortex.is_organization_admin(organization_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_id AND r.key = 'platform_admin'
    )
  );

DROP POLICY IF EXISTS memberships_update_admin ON public.organization_memberships;
CREATE POLICY memberships_update_admin ON public.organization_memberships
  FOR UPDATE TO authenticated
  USING (cortex.is_organization_admin(organization_id))
  WITH CHECK (
    cortex.is_organization_admin(organization_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_id AND r.key = 'platform_admin'
    )
    AND (
      user_id <> auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = role_id AND r.key IN ('team_member', 'team_viewer')
      )
    )
  );

DROP POLICY IF EXISTS memberships_delete_admin ON public.organization_memberships;
CREATE POLICY memberships_delete_admin ON public.organization_memberships
  FOR DELETE TO authenticated
  USING (
    cortex.is_organization_admin(organization_id)
    AND user_id <> auth.uid()
  );

-- ---------------------------------------------------------------------------
-- roles policies — system catalog readable; writable by platform admin only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS roles_select_authenticated ON public.roles;
CREATE POLICY roles_select_authenticated ON public.roles
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS roles_modify_platform ON public.roles;
CREATE POLICY roles_modify_platform ON public.roles
  FOR ALL TO authenticated
  USING (cortex.is_platform_admin())
  WITH CHECK (cortex.is_platform_admin());

-- ---------------------------------------------------------------------------
-- permissions policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS permissions_select_authenticated ON public.permissions;
CREATE POLICY permissions_select_authenticated ON public.permissions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS permissions_modify_platform ON public.permissions;
CREATE POLICY permissions_modify_platform ON public.permissions
  FOR ALL TO authenticated
  USING (cortex.is_platform_admin())
  WITH CHECK (cortex.is_platform_admin());

-- ---------------------------------------------------------------------------
-- role_permissions policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS role_permissions_select_authenticated ON public.role_permissions;
CREATE POLICY role_permissions_select_authenticated ON public.role_permissions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS role_permissions_modify_platform ON public.role_permissions;
CREATE POLICY role_permissions_modify_platform ON public.role_permissions
  FOR ALL TO authenticated
  USING (cortex.is_platform_admin())
  WITH CHECK (cortex.is_platform_admin());

-- ---------------------------------------------------------------------------
-- organization_settings policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS org_settings_select_member ON public.organization_settings;
CREATE POLICY org_settings_select_member ON public.organization_settings
  FOR SELECT TO authenticated
  USING (
    cortex.is_platform_admin()
    OR cortex.has_permission(organization_id, 'settings.read')
    OR cortex.is_organization_member(organization_id)
  );

DROP POLICY IF EXISTS org_settings_update_admin ON public.organization_settings;
CREATE POLICY org_settings_update_admin ON public.organization_settings
  FOR UPDATE TO authenticated
  USING (
    cortex.is_platform_admin()
    OR cortex.has_permission(organization_id, 'settings.manage')
    OR cortex.is_organization_admin(organization_id)
  )
  WITH CHECK (
    cortex.is_platform_admin()
    OR cortex.has_permission(organization_id, 'settings.manage')
    OR cortex.is_organization_admin(organization_id)
  );

DROP POLICY IF EXISTS org_settings_insert_admin ON public.organization_settings;
CREATE POLICY org_settings_insert_admin ON public.organization_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    cortex.is_platform_admin()
    OR cortex.is_organization_admin(organization_id)
  );

-- ---------------------------------------------------------------------------
-- Idempotent seed — MARQ org, system roles, permissions, mappings
-- Does NOT create user memberships (see docs/MEMBERSHIP_BOOTSTRAP.md)
-- ---------------------------------------------------------------------------

INSERT INTO public.organizations (slug, name, status, plan, timezone, metadata)
SELECT 'marq', 'MARQ', 'active', 'internal', 'UTC', '{"product": "cortex"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations o
  WHERE o.slug = 'marq' AND o.deleted_at IS NULL
);

-- Resolve org id for seed (slug unique among active orgs)
DO $$
DECLARE
  v_org_id UUID;
  v_role_platform_admin UUID;
  v_role_org_admin UUID;
  v_role_team_member UUID;
  v_role_team_viewer UUID;
  v_perm RECORD;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = 'marq' AND deleted_at IS NULL
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'MARQ organization seed failed: organization not found';
  END IF;

  INSERT INTO public.roles (key, name, description, scope, is_system, organization_id)
  SELECT v.key, v.name, v.description, v.scope, v.is_system, v.organization_id
  FROM (
    VALUES
      ('platform_admin'::text, 'Platform Administrator'::text, 'Full platform access across organizations'::text, 'platform'::text, true, NULL::uuid),
      ('org_admin', 'Organization Administrator', 'Manage organization, members, and settings', 'platform', true, NULL),
      ('team_member', 'Team Member', 'Standard team access within an organization', 'platform', true, NULL),
      ('team_viewer', 'Team Viewer', 'Read-only team access within an organization', 'platform', true, NULL)
  ) AS v(key, name, description, scope, is_system, organization_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.key = v.key AND r.is_system = true AND r.organization_id IS NULL
  );

  SELECT id INTO v_role_platform_admin FROM public.roles WHERE key = 'platform_admin' AND is_system = true LIMIT 1;
  SELECT id INTO v_role_org_admin FROM public.roles WHERE key = 'org_admin' AND is_system = true LIMIT 1;
  SELECT id INTO v_role_team_member FROM public.roles WHERE key = 'team_member' AND is_system = true LIMIT 1;
  SELECT id INTO v_role_team_viewer FROM public.roles WHERE key = 'team_viewer' AND is_system = true LIMIT 1;

  INSERT INTO public.permissions (key, name, description)
  SELECT v.key, v.name, v.description
  FROM (
    VALUES
      ('organization.read', 'Read Organization', 'View organization profile and metadata'),
      ('organization.manage', 'Manage Organization', 'Update organization profile fields'),
      ('members.read', 'Read Members', 'View organization memberships'),
      ('members.manage', 'Manage Members', 'Invite, update, and remove members'),
      ('settings.read', 'Read Settings', 'View organization settings'),
      ('settings.manage', 'Manage Settings', 'Update organization settings')
  ) AS v(key, name, description)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.permissions p WHERE p.key = v.key
  );

  FOR v_perm IN
    SELECT p.id AS permission_id, p.key
    FROM public.permissions p
  LOOP
    IF v_role_platform_admin IS NOT NULL THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_role_platform_admin, v_perm.permission_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        WHERE rp.role_id = v_role_platform_admin AND rp.permission_id = v_perm.permission_id
      );
    END IF;

    IF v_role_org_admin IS NOT NULL AND v_perm.key IN (
      'organization.read', 'organization.manage',
      'members.read', 'members.manage',
      'settings.read', 'settings.manage'
    ) THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_role_org_admin, v_perm.permission_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        WHERE rp.role_id = v_role_org_admin AND rp.permission_id = v_perm.permission_id
      );
    END IF;

    IF v_role_team_member IS NOT NULL AND v_perm.key IN (
      'organization.read', 'members.read', 'settings.read'
    ) THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_role_team_member, v_perm.permission_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        WHERE rp.role_id = v_role_team_member AND rp.permission_id = v_perm.permission_id
      );
    END IF;

    IF v_role_team_viewer IS NOT NULL AND v_perm.key IN (
      'organization.read', 'members.read', 'settings.read'
    ) THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_role_team_viewer, v_perm.permission_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        WHERE rp.role_id = v_role_team_viewer AND rp.permission_id = v_perm.permission_id
      );
    END IF;
  END LOOP;

  INSERT INTO public.organization_settings (organization_id, settings, version)
  SELECT v_org_id, '{"brandingName": "MARQ Cortex"}'::jsonb, 1
  WHERE NOT EXISTS (
    SELECT 1 FROM public.organization_settings os WHERE os.organization_id = v_org_id
  );
END $$;

COMMIT;
