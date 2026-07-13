-- ============================================================================
-- MCV2-S5-VALIDATE-001 — Live diagnostic RLS validation (disposable fixtures)
-- Runs as postgres via Supabase CLI; uses SET ROLE for anon/authenticated.
-- All fixture data uses slug prefix s5validate_ and is deleted at end.
-- ============================================================================

DO $$
DECLARE
  v_marq_id       UUID;
  v_org_a_id      UUID;
  v_org_b_id      UUID;
  v_role_admin    UUID;
  v_role_member   UUID;
  v_user_a_admin  UUID := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_user_a_member UUID := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_user_b_admin  UUID := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_user_b_member UUID := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_sub_a_id      UUID;
  v_sub_b_id      UUID;
  v_lead_a_id     UUID;
  v_count         INTEGER;
  v_err           TEXT;
BEGIN
  SELECT id INTO v_marq_id FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL LIMIT 1;
  ASSERT v_marq_id IS NOT NULL, 'MARQ organization must exist';

  SELECT id INTO v_role_admin FROM public.roles WHERE key = 'org_admin' AND is_system = true LIMIT 1;
  SELECT id INTO v_role_member FROM public.roles WHERE key = 'team_member' AND is_system = true LIMIT 1;
  ASSERT v_role_admin IS NOT NULL AND v_role_member IS NOT NULL, 'System roles missing';

  -- Synthetic auth users for FK + JWT sub tests
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_user_a_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's5validate-a-admin@test.local', crypt('s5validate', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a_member, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's5validate-a-member@test.local', crypt('s5validate', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_b_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's5validate-b-admin@test.local', crypt('s5validate', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_b_member, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's5validate-b-member@test.local', crypt('s5validate', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- Disposable orgs
  SELECT id INTO v_org_a_id FROM public.organizations WHERE slug = 's5validate_org_a' AND deleted_at IS NULL;
  IF v_org_a_id IS NULL THEN
    INSERT INTO public.organizations (slug, name, status)
    VALUES ('s5validate_org_a', 'S5 Validate Org A', 'active')
    RETURNING id INTO v_org_a_id;
  END IF;

  SELECT id INTO v_org_b_id FROM public.organizations WHERE slug = 's5validate_org_b' AND deleted_at IS NULL;
  IF v_org_b_id IS NULL THEN
    INSERT INTO public.organizations (slug, name, status)
    VALUES ('s5validate_org_b', 'S5 Validate Org B', 'active')
    RETURNING id INTO v_org_b_id;
  END IF;

  -- Memberships (user IDs are synthetic — JWT sub only)
  INSERT INTO public.organization_memberships (organization_id, user_id, role_id, status, joined_at)
  VALUES
    (v_org_a_id, v_user_a_admin, v_role_admin, 'active', now()),
    (v_org_a_id, v_user_a_member, v_role_member, 'active', now()),
    (v_org_b_id, v_user_b_admin, v_role_admin, 'active', now()),
    (v_org_b_id, v_user_b_member, v_role_member, 'active', now())
  ON CONFLICT DO NOTHING;

  -- Seed submissions as postgres (bypass RLS)
  INSERT INTO public.submissions (organization_id, company_name, contact_email, status)
  VALUES (v_org_a_id, 'Org A Co', 'orga@s5validate.test', 'new')
  RETURNING id INTO v_sub_a_id;

  INSERT INTO public.submissions (organization_id, company_name, contact_email, status)
  VALUES (v_org_b_id, 'Org B Co', 'orgb@s5validate.test', 'new')
  RETURNING id INTO v_sub_b_id;

  INSERT INTO public.leads (organization_id, email, status)
  VALUES (v_org_b_id, 'lead-b@s5validate.test', 'new')
  RETURNING id INTO v_lead_a_id;

  -- -------------------------------------------------------------------------
  -- Cross-tenant denial: Org A admin cannot read Org B submission
  -- -------------------------------------------------------------------------
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT COUNT(*) INTO v_count FROM public.submissions WHERE id = v_sub_b_id;
  ASSERT v_count = 0, 'Cross-tenant: Org A admin must not read Org B submission';

  SELECT COUNT(*) INTO v_count FROM public.leads WHERE organization_id = v_org_b_id;
  ASSERT v_count = 0, 'Cross-tenant: Org A admin must not read Org B leads';

  -- Org A admin CAN read Org A submission
  SELECT COUNT(*) INTO v_count FROM public.submissions WHERE id = v_sub_a_id;
  ASSERT v_count = 1, 'Org A admin must read own org submission';

  -- -------------------------------------------------------------------------
  -- Team member can read but cannot delete (manage)
  -- -------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_user_a_member::text, true);

  SELECT COUNT(*) INTO v_count FROM public.submissions WHERE id = v_sub_a_id;
  ASSERT v_count = 1, 'Team member must read own org submission';

  BEGIN
    DELETE FROM public.submissions WHERE id = v_sub_a_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    ASSERT v_count = 0, 'Team member must not delete submissions';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT ILIKE '%policy%' AND v_err NOT ILIKE '%permission%' AND v_err NOT ILIKE '%row-level%' THEN
      RAISE;
    END IF;
  END;

  -- -------------------------------------------------------------------------
  -- Org admin can update own org submission
  -- -------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_user_a_admin::text, true);
  UPDATE public.submissions SET company_name = 'Org A Updated' WHERE id = v_sub_a_id;
  ASSERT FOUND, 'Org admin must update own org submission';

  -- -------------------------------------------------------------------------
  -- Anonymous: INSERT lead for MARQ org only
  -- -------------------------------------------------------------------------
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);

  INSERT INTO public.leads (organization_id, email, status)
  VALUES (v_marq_id, 'anon-lead@s5validate.test', 'new');

  BEGIN
    INSERT INTO public.leads (organization_id, email, status)
    VALUES (v_org_b_id, 'anon-bad@s5validate.test', 'new');
    ASSERT false, 'Anonymous must not insert lead for non-MARQ org';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT ILIKE '%policy%' AND v_err NOT ILIKE '%row-level%' THEN
      RAISE;
    END IF;
  END;

  -- Anonymous cannot SELECT submissions
  SELECT COUNT(*) INTO v_count FROM public.submissions;
  ASSERT v_count = 0, 'Anonymous must not read submissions';

  SELECT COUNT(*) INTO v_count FROM public.diagnostic_scores;
  ASSERT v_count = 0, 'Anonymous must not read diagnostic_scores';

  SELECT COUNT(*) INTO v_count FROM public.reports;
  ASSERT v_count = 0, 'Anonymous must not read reports';

  SELECT COUNT(*) INTO v_count FROM public.outcomes;
  ASSERT v_count = 0, 'Anonymous must not read outcomes';

  -- Anonymous cannot INSERT scores/reports/outcomes
  BEGIN
    INSERT INTO public.diagnostic_scores (organization_id, submission_id, completion_score)
    VALUES (v_marq_id, v_sub_a_id, 50);
    ASSERT false, 'Anonymous must not insert diagnostic_scores';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT ILIKE '%policy%' AND v_err NOT ILIKE '%row-level%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO public.reports (organization_id, submission_id, title)
    VALUES (v_marq_id, v_sub_a_id, 'Bad Report');
    ASSERT false, 'Anonymous must not insert reports';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT ILIKE '%policy%' AND v_err NOT ILIKE '%row-level%' THEN
      RAISE;
    END IF;
  END;

  -- Reset to postgres for cleanup
  PERFORM set_config('role', 'postgres', true);

  -- Cleanup disposable data
  DELETE FROM public.leads WHERE email LIKE '%@s5validate.test';
  DELETE FROM public.submissions WHERE contact_email LIKE '%@s5validate.test';
  DELETE FROM public.organization_memberships
  WHERE user_id IN (v_user_a_admin, v_user_a_member, v_user_b_admin, v_user_b_member);
  DELETE FROM public.organizations WHERE slug IN ('s5validate_org_a', 's5validate_org_b');
  DELETE FROM auth.users WHERE email LIKE 's5validate-%@test.local';

  RAISE NOTICE 'diagnostic_live_rls.test.sql: ALL LIVE RLS CHECKS PASSED';
END $$;
