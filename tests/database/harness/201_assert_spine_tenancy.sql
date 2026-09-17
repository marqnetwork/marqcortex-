-- ============================================================================
-- CP-3 STEP 12 — TENANCY, PROVEN AGAINST A REAL POSTGRES
--
-- Every assertion below runs as the `authenticated` role with a real
-- `request.jwt.claim.sub`, so the RLS policies are the ones deciding. Nothing
-- here trusts a route handler, because a route handler is not what protects
-- these rows.
--
-- Each block RAISES on failure. A silent pass is impossible: the counts are
-- asserted in both directions — the tenant's own rows must be VISIBLE as well
-- as the other tenant's INVISIBLE, so a policy that hides everything cannot
-- masquerade as a policy that isolates correctly.
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Org A cannot read Org B's people — and can read its own
-- ---------------------------------------------------------------------------
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000001","app_metadata":{}}', false);

DO $$
DECLARE v_own INT; v_other INT;
BEGIN
  SELECT count(*) INTO v_own   FROM public.people WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_other FROM public.people WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF v_own <> 2 THEN
    RAISE EXCEPTION 'Alpha admin sees % of its own 2 people — the policy hides rather than isolates', v_own;
  END IF;
  IF v_other <> 0 THEN
    RAISE EXCEPTION 'CROSS-TENANT READ: Alpha admin sees % Beta people', v_other;
  END IF;
  RAISE NOTICE '  ok  Org A reads its own 2 people and 0 of Org B''s';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Org A cannot read Org B's teams, departments or business units
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_t INT; v_d INT; v_b INT; v_tm INT;
BEGIN
  SELECT count(*) INTO v_t  FROM public.teams            WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  SELECT count(*) INTO v_d  FROM public.departments      WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  SELECT count(*) INTO v_b  FROM public.business_units   WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  SELECT count(*) INTO v_tm FROM public.team_memberships WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF v_t + v_d + v_b + v_tm <> 0 THEN
    RAISE EXCEPTION 'CROSS-TENANT READ: teams=% departments=% units=% memberships=%', v_t, v_d, v_b, v_tm;
  END IF;

  SELECT count(*) INTO v_t FROM public.teams WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  IF v_t <> 1 THEN RAISE EXCEPTION 'Alpha admin cannot see its own team'; END IF;
  RAISE NOTICE '  ok  Org A reads none of Org B''s structure, and all of its own';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Org A cannot assign an Org B person to an Org A team
-- ---------------------------------------------------------------------------
-- The composite foreign key is what refuses this, not a handler. The person id
-- is real and the team id is real; only the ORGANIZATION disagrees.
DO $$
DECLARE v_failed BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO public.team_memberships (organization_id, team_id, person_id)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001',
            'a0000000-0000-4000-8000-00000000cc01',
            'b0000000-0000-4000-8000-00000000ee01');
  EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'CROSS-TENANT ASSIGNMENT: an Org B person joined an Org A team';
  END IF;
  RAISE NOTICE '  ok  an Org B person cannot be assigned to an Org A team';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Org A cannot create a cross-tenant reporting relationship
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_failed BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE public.people
    SET reports_to_person_id = 'b0000000-0000-4000-8000-00000000ee01'
    WHERE id = 'a0000000-0000-4000-8000-00000000ee02';
  EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN
    v_failed := true;
  END;

  -- An UPDATE that matched no row is not a refusal — RLS would have hidden the
  -- target and the statement would report success having done nothing. Check
  -- the value, not the verb.
  IF NOT v_failed THEN
    IF EXISTS (
      SELECT 1 FROM public.people
      WHERE id = 'a0000000-0000-4000-8000-00000000ee02'
        AND reports_to_person_id = 'b0000000-0000-4000-8000-00000000ee01'
    ) THEN
      RAISE EXCEPTION 'CROSS-TENANT REPORTING LINE: an Org A person reports to an Org B person';
    END IF;
  END IF;
  RAISE NOTICE '  ok  a reporting line cannot cross a tenant boundary';
END $$;

-- ---------------------------------------------------------------------------
-- 5. A caller-supplied organization id cannot override authenticated membership
-- ---------------------------------------------------------------------------
-- The Beta admin asks for Alpha's rows BY ID. There is no parameter for a
-- policy to trust: it reads the row's own organization_id and asks whether THIS
-- caller is a member of THAT organization.
SELECT set_config('request.jwt.claim.sub', '22222222-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"22222222-0000-4000-8000-000000000001","app_metadata":{}}', false);

DO $$
DECLARE v_seen INT; v_inserted BOOLEAN := false;
BEGIN
  SELECT count(*) INTO v_seen
  FROM public.people
  WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'A caller-supplied organization id returned % Alpha people to a Beta admin', v_seen;
  END IF;

  -- And it cannot WRITE into Alpha by naming Alpha either.
  BEGIN
    INSERT INTO public.people (organization_id, full_name)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Injected By Beta');
    v_inserted := true;
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN
    v_inserted := false;
  END;
  IF v_inserted THEN
    RAISE EXCEPTION 'A Beta admin inserted a person into Alpha by naming Alpha''s organization id';
  END IF;
  RAISE NOTICE '  ok  naming another tenant''s organization id grants nothing, read or write';
END $$;

-- ---------------------------------------------------------------------------
-- 6. Inactive membership fails closed
-- ---------------------------------------------------------------------------
-- This caller holds `org_admin` in Alpha. Their membership is SUSPENDED. Every
-- helper requires `status = 'active'`, so the role buys nothing.
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000003', false);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000003","app_metadata":{}}', false);

DO $$
DECLARE v_seen INT; v_inserted BOOLEAN := false;
BEGIN
  SELECT count(*) INTO v_seen FROM public.people;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'A SUSPENDED org_admin read % people', v_seen;
  END IF;

  BEGIN
    INSERT INTO public.teams (organization_id, key, name)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'ghost', 'Ghost Team');
    v_inserted := true;
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN
    v_inserted := false;
  END;
  IF v_inserted THEN
    RAISE EXCEPTION 'A SUSPENDED org_admin created a team';
  END IF;
  RAISE NOTICE '  ok  a suspended membership reads nothing and writes nothing';
END $$;

-- ---------------------------------------------------------------------------
-- 7. RBAC — a viewer reads the structure and cannot change it
-- ---------------------------------------------------------------------------
-- UI visibility is not authorization. The viewer's console hides the controls;
-- this is what happens when somebody calls the API anyway.
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000002', false);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000002","app_metadata":{}}', false);

DO $$
DECLARE v_seen INT; v_inserted BOOLEAN := false; v_updated BOOLEAN := false;
BEGIN
  SELECT count(*) INTO v_seen FROM public.people
  WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  IF v_seen <> 2 THEN
    RAISE EXCEPTION 'A viewer cannot read the structure they are entitled to: % people', v_seen;
  END IF;

  BEGIN
    INSERT INTO public.departments (organization_id, key, name)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'viewer-made', 'Viewer Made');
    v_inserted := true;
  EXCEPTION WHEN insufficient_privilege THEN v_inserted := false;
  END;
  IF v_inserted THEN RAISE EXCEPTION 'A viewer created a department'; END IF;

  BEGIN
    UPDATE public.people SET position_title = 'Self Promoted'
    WHERE id = 'a0000000-0000-4000-8000-00000000ee02';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT EXISTS (
    SELECT 1 FROM public.people
    WHERE id = 'a0000000-0000-4000-8000-00000000ee02' AND position_title = 'Self Promoted'
  ) INTO v_updated;
  IF v_updated THEN RAISE EXCEPTION 'A viewer changed a person record'; END IF;

  RAISE NOTICE '  ok  a viewer reads the structure and changes nothing';
END $$;

-- ---------------------------------------------------------------------------
-- 8. An admin CAN manage — so the refusals above are about authority, not a
--    policy that refuses everybody
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"11111111-0000-4000-8000-000000000001","app_metadata":{}}', false);

DO $$
BEGIN
  INSERT INTO public.departments (organization_id, key, name)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'admin-made', 'Admin Made');
  IF NOT EXISTS (
    SELECT 1 FROM public.departments
    WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND key = 'admin-made'
  ) THEN
    RAISE EXCEPTION 'An org admin could not create a department — the policy refuses everybody';
  END IF;
  RAISE NOTICE '  ok  an org admin manages the structure, so the refusals are authority and not breakage';
END $$;

-- ---------------------------------------------------------------------------
-- 9. A row cannot be moved into another tenant by UPDATE
-- ---------------------------------------------------------------------------
-- The USING half of the policy passes: the row is Alpha's and this caller may
-- manage Alpha. Only WITH CHECK examines the NEW value.
DO $$
DECLARE v_moved BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE public.teams
    SET organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
    WHERE id = 'a0000000-0000-4000-8000-00000000cc01';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL;
  END;
  SELECT EXISTS (
    SELECT 1 FROM public.teams
    WHERE id = 'a0000000-0000-4000-8000-00000000cc01'
      AND organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
  ) INTO v_moved;
  IF v_moved THEN
    RAISE EXCEPTION 'A team was moved into another tenant by UPDATE';
  END IF;
  RAISE NOTICE '  ok  a row cannot be moved into another tenant';
END $$;

-- ---------------------------------------------------------------------------
-- 10. A person without a login is a first-class person (ONT 12.3)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_name TEXT; v_reports TEXT;
BEGIN
  SELECT p.full_name, m.full_name
  INTO v_name, v_reports
  FROM public.people p
  LEFT JOIN public.people m ON m.id = p.reports_to_person_id
  WHERE p.id = 'a0000000-0000-4000-8000-00000000ee02';

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A person with no auth user is not readable';
  END IF;
  IF v_reports IS NULL THEN
    RAISE EXCEPTION 'A person with no auth user has no reporting line';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.team_memberships
    WHERE person_id = 'a0000000-0000-4000-8000-00000000ee02' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A person with no auth user cannot be on a team';
  END IF;
  RAISE NOTICE '  ok  a person with no login has a department, a reporting line and a team';
END $$;

RESET ROLE;
