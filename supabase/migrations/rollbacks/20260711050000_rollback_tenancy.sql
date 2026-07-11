-- ============================================================================
-- MCV2-S4-IMPLEMENT-001 — Rollback tenancy foundation
-- WARNING: Run only in staging/dev. Drops all Sprint 1 tenancy objects.
-- KV store is NOT affected.
-- ============================================================================

BEGIN;

-- Policies (reverse order)
DROP POLICY IF EXISTS org_settings_insert_admin ON public.organization_settings;
DROP POLICY IF EXISTS org_settings_update_admin ON public.organization_settings;
DROP POLICY IF EXISTS org_settings_select_member ON public.organization_settings;

DROP POLICY IF EXISTS role_permissions_modify_platform ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_select_authenticated ON public.role_permissions;

DROP POLICY IF EXISTS permissions_modify_platform ON public.permissions;
DROP POLICY IF EXISTS permissions_select_authenticated ON public.permissions;

DROP POLICY IF EXISTS roles_modify_platform ON public.roles;
DROP POLICY IF EXISTS roles_select_authenticated ON public.roles;

DROP POLICY IF EXISTS memberships_delete_admin ON public.organization_memberships;
DROP POLICY IF EXISTS memberships_update_admin ON public.organization_memberships;
DROP POLICY IF EXISTS memberships_insert_admin ON public.organization_memberships;
DROP POLICY IF EXISTS memberships_select_org ON public.organization_memberships;

DROP POLICY IF EXISTS organizations_delete_platform ON public.organizations;
DROP POLICY IF EXISTS organizations_insert_platform ON public.organizations;
DROP POLICY IF EXISTS organizations_update_admin ON public.organizations;
DROP POLICY IF EXISTS organizations_select_member ON public.organizations;

-- Tables (dependency order)
DROP TABLE IF EXISTS public.organization_settings CASCADE;
DROP TABLE IF EXISTS public.organization_memberships CASCADE;
DROP TABLE IF EXISTS public.role_permissions CASCADE;
DROP TABLE IF EXISTS public.permissions CASCADE;
DROP TABLE IF EXISTS public.roles CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;

-- Functions
DROP FUNCTION IF EXISTS cortex.user_organization_ids();
DROP FUNCTION IF EXISTS cortex.has_permission(UUID, TEXT);
DROP FUNCTION IF EXISTS cortex.is_organization_admin(UUID);
DROP FUNCTION IF EXISTS cortex.is_organization_member(UUID);
DROP FUNCTION IF EXISTS cortex.is_platform_admin();
DROP FUNCTION IF EXISTS cortex.current_user_id();
DROP FUNCTION IF EXISTS cortex.set_updated_at();

DROP SCHEMA IF EXISTS cortex CASCADE;

COMMIT;
