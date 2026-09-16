-- ============================================================================
-- CP-3 — ORGANIZATIONAL SPINE: RLS AND PERMISSIONS
-- ============================================================================
--
-- No second permission system. The helpers seeded on 2026-07-11 —
-- `cortex.is_organization_member`, `cortex.is_organization_admin`,
-- `cortex.has_permission` — already answer every question these tables ask,
-- and every one of them resolves the caller from `auth.uid()` against an
-- ACTIVE, non-deleted `organization_memberships` row.
--
-- That last clause is the load-bearing one, and it is why "caller-supplied
-- organization id cannot override authenticated membership" is a property of
-- the database rather than a promise made by a route handler. A policy never
-- reads a parameter. It reads the row's own `organization_id` and asks whether
-- THIS caller is a member of THAT organization. A caller who sends somebody
-- else's organization id gets zero rows, because the rows they asked for are
-- not rows they can see.
--
-- ── PERMISSIONS ─────────────────────────────────────────────────────────────
--
-- Two new keys, following the existing dotted convention:
--
--   organization.structure.read    — see the shape of the organization
--   organization.structure.manage  — change it
--
-- `people.read` and `people.manage` are deliberately NOT introduced: the
-- catalog already has `members.read` / `members.manage`, and a person record is
-- the organization's representation of a member. A second vocabulary for the
-- same authority is how permission systems become impossible to reason about.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The two new permission keys, and their role grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_perm RECORD;
  v_role RECORD;
BEGIN
  INSERT INTO public.permissions (key, name, description)
  SELECT v.key, v.name, v.description
  FROM (
    VALUES
      ('organization.structure.read',
       'Read Organization Structure',
       'View business units, departments, teams, people and reporting lines'),
      ('organization.structure.manage',
       'Manage Organization Structure',
       'Create and change business units, departments, teams, people and relationships')
  ) AS v(key, name, description)
  WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = v.key);

  -- READ goes to everyone who can already read members: knowing how the
  -- organization is arranged is not privileged information to a colleague.
  FOR v_role IN
    SELECT DISTINCT r.id
    FROM public.roles r
    JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE p.key = 'members.read'
  LOOP
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_role.id, p.id
    FROM public.permissions p
    WHERE p.key = 'organization.structure.read'
      AND NOT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        WHERE rp.role_id = v_role.id AND rp.permission_id = p.id
      );
  END LOOP;

  -- MANAGE goes only to roles that can already manage members. Reshaping the
  -- organization is at least as consequential as changing who is in it.
  FOR v_role IN
    SELECT DISTINCT r.id
    FROM public.roles r
    JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE p.key = 'members.manage'
  LOOP
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_role.id, p.id
    FROM public.permissions p
    WHERE p.key = 'organization.structure.manage'
      AND NOT EXISTS (
        SELECT 1 FROM public.role_permissions rp
        WHERE rp.role_id = v_role.id AND rp.permission_id = p.id
      );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS — one shape, five tables
-- ---------------------------------------------------------------------------
-- SELECT  : an active member of the row's organization
-- INSERT  : plus `organization.structure.manage`
-- UPDATE  : same, and the row may not be moved to another organization
-- DELETE  : refused to everybody. These tables soft-delete; an UPDATE setting
--           `deleted_at` is the supported path, and it stays inside the same
--           policy surface. A hard DELETE would take reporting lines and team
--           memberships with it through CASCADE, silently.
-- ---------------------------------------------------------------------------

ALTER TABLE public.business_units   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.business_units   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.departments      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.people           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teams            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'business_units', 'departments', 'people', 'teams', 'team_memberships'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select_member ON public.%I', v_table, v_table);
    EXECUTE format($p$
      CREATE POLICY %I_select_member ON public.%I
        FOR SELECT TO authenticated
        USING (cortex.is_organization_member(organization_id))
    $p$, v_table, v_table);

    EXECUTE format('DROP POLICY IF EXISTS %I_insert_manage ON public.%I', v_table, v_table);
    EXECUTE format($p$
      CREATE POLICY %I_insert_manage ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'organization.structure.manage')
        )
    $p$, v_table, v_table);

    -- Both USING and WITH CHECK, and both on the SAME organization. USING alone
    -- would let an authorised writer move a row INTO another tenant: the old
    -- value passes the check, the new one is never examined.
    EXECUTE format('DROP POLICY IF EXISTS %I_update_manage ON public.%I', v_table, v_table);
    EXECUTE format($p$
      CREATE POLICY %I_update_manage ON public.%I
        FOR UPDATE TO authenticated
        USING (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'organization.structure.manage')
        )
        WITH CHECK (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'organization.structure.manage')
        )
    $p$, v_table, v_table);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------
-- No DELETE, to anybody. See the note above: soft deletion is the path.
GRANT SELECT, INSERT, UPDATE ON public.business_units   TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.departments      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.people           TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.teams            TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.team_memberships TO authenticated;

REVOKE ALL ON public.business_units   FROM anon;
REVOKE ALL ON public.departments      FROM anon;
REVOKE ALL ON public.people           FROM anon;
REVOKE ALL ON public.teams            FROM anon;
REVOKE ALL ON public.team_memberships FROM anon;

COMMIT;
