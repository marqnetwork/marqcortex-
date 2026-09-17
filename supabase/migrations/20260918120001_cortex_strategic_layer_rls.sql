-- ============================================================================
-- CP-4 — STRATEGIC LAYER: RLS AND PERMISSIONS
--
-- Same shape as the spine's RLS, same helpers, same reasoning — and stated
-- again rather than shared, because a policy that is read out of another
-- migration is a policy nobody reads at all.
--
-- ── TWO NEW PERMISSION KEYS, NOT A NEW SYSTEM ──────────────────────────────
--
--   strategy.read    — see the organization's goals, decisions and risks
--   strategy.manage  — record and change them
--
-- Granted to whichever roles already hold `organization.structure.read` /
-- `organization.structure.manage`, which are themselves granted from
-- `members.read` / `members.manage`. The chain is deliberate: authority over
-- the organization's intent follows authority over its shape, and neither is
-- a new vocabulary.
--
-- ── WHY THESE ARE SEPARATE KEYS, AND WHY THEY ARE STILL GIVEN TO EVERYONE ──
--
-- `strategy.read` follows `members.read`, so every active member gets it — the
-- same reach the spine's SELECT policy has. It was tempting to make it scarcer
-- on the grounds that a risk register names what leadership fears and a
-- decision log names who chose what. That reasoning is not in the canon. ONT
-- 13.4, 14.8 and 17.6 describe these entities as governed organizational
-- records and say nothing about restricting them from the organization, and
-- Cortex's whole premise is shared organizational intelligence — a goals list
-- only administrators can see is a worse product and an invented access rule.
-- Inventing one would be exactly the drift this programme has avoided
-- elsewhere.
--
-- So why a separate key rather than reusing `organization.structure.read`?
-- Because it is SEPARABLE LATER. An organization that decides its risk
-- register should not be open to everyone revokes one key, from one role, with
-- no schema change and no forked table. The key exists so that decision stays
-- possible; the default grant is open because nothing yet says it should not be.
--
-- What the policy does NOT do is admit a non-member, and `strategy.manage`
-- follows `members.manage` — only `org_admin` and `platform_admin` hold it. A
-- team member and a team viewer read the organization's intent and change none
-- of it, which is the property `211_assert_strategic_tenancy.sql` proves.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The two new permission keys, and their role grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_role RECORD;
  v_pair RECORD;
BEGIN
  INSERT INTO public.permissions (key, name, description)
  SELECT v.key, v.name, v.description
  FROM (
    VALUES
      ('strategy.read',
       'Read Strategy',
       'View the organization''s goals, decisions and risks'),
      ('strategy.manage',
       'Manage Strategy',
       'Record and change goals, decisions and risks')
  ) AS v(key, name, description)
  WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = v.key);

  -- Each new key follows the structure key at the same level. A loop over the
  -- pairs rather than two near-identical blocks, so the two cannot drift.
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('organization.structure.read',   'strategy.read'),
      ('organization.structure.manage', 'strategy.manage')
    ) AS t(source_key, target_key)
  LOOP
    FOR v_role IN
      SELECT DISTINCT r.id
      FROM public.roles r
      JOIN public.role_permissions rp ON rp.role_id = r.id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE p.key = v_pair.source_key
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_role.id, p.id
      FROM public.permissions p
      WHERE p.key = v_pair.target_key
        AND NOT EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = v_role.id AND rp.permission_id = p.id
        );
    END LOOP;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS — one shape, three tables
-- ---------------------------------------------------------------------------
-- SELECT  : `strategy.read`   (NOT mere membership — see the header)
-- INSERT  : `strategy.manage`
-- UPDATE  : `strategy.manage`, and the row may not be moved to another tenant
-- DELETE  : refused to everybody. Soft deletion is the path, and a hard delete
--           would take the decisions and risks attached to a goal with it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.goals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risks     ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.goals     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.risks     FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['goals', 'decisions', 'risks']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select_strategy ON public.%I', v_table, v_table);
    EXECUTE format($p$
      CREATE POLICY %I_select_strategy ON public.%I
        FOR SELECT TO authenticated
        USING (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'strategy.read')
        )
    $p$, v_table, v_table);

    EXECUTE format('DROP POLICY IF EXISTS %I_insert_strategy ON public.%I', v_table, v_table);
    EXECUTE format($p$
      CREATE POLICY %I_insert_strategy ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'strategy.manage')
        )
    $p$, v_table, v_table);

    -- Both USING and WITH CHECK, on the SAME organization. USING alone would
    -- let an authorised writer move a row INTO another tenant: the old value
    -- passes the check and the new one is never examined.
    EXECUTE format('DROP POLICY IF EXISTS %I_update_strategy ON public.%I', v_table, v_table);
    EXECUTE format($p$
      CREATE POLICY %I_update_strategy ON public.%I
        FOR UPDATE TO authenticated
        USING (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'strategy.manage')
        )
        WITH CHECK (
          cortex.is_organization_member(organization_id)
          AND cortex.has_permission(organization_id, 'strategy.manage')
        )
    $p$, v_table, v_table);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------
-- No DELETE, to anybody.
GRANT SELECT, INSERT, UPDATE ON public.goals     TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.risks     TO authenticated;

REVOKE ALL ON public.goals     FROM anon;
REVOKE ALL ON public.decisions FROM anon;
REVOKE ALL ON public.risks     FROM anon;

COMMIT;
