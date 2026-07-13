-- ============================================================================
-- MCV2-S5-VALIDATE-001 — Anonymous INSERT policy security review
-- Validates hardened anon policies block privileged field injection
-- ============================================================================

DO $$
DECLARE
  v_marq_id UUID;
  v_err     TEXT;
BEGIN
  SELECT id INTO v_marq_id FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL LIMIT 1;
  ASSERT v_marq_id IS NOT NULL, 'MARQ org required';

  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);

  -- Allowed: insert lead for MARQ with funnel status
  INSERT INTO public.leads (organization_id, email, status)
  VALUES (v_marq_id, 'anon-review@s5validate.test', 'new');

  INSERT INTO public.submissions (organization_id, company_name, contact_email, status, priority)
  VALUES (v_marq_id, 'Anon Co', 'anon-sub@s5validate.test', 'new', 'medium');

  -- Denied: privileged lead status
  BEGIN
    INSERT INTO public.leads (organization_id, email, status)
    VALUES (v_marq_id, 'anon-converted@s5validate.test', 'converted');
    ASSERT false, 'Anonymous must not insert converted lead status';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT ILIKE '%policy%' AND v_err NOT ILIKE '%row-level%' THEN
      RAISE;
    END IF;
  END;

  -- Denied: privileged submission status and scores
  BEGIN
    INSERT INTO public.submissions (organization_id, company_name, contact_email, status, priority, ai_score)
    VALUES (v_marq_id, 'Anon Bad', 'anon-bad@s5validate.test', 'won', 'urgent', 99);
    ASSERT false, 'Anonymous must not insert won/urgent/scored submission';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT ILIKE '%policy%' AND v_err NOT ILIKE '%row-level%' THEN
      RAISE;
    END IF;
  END;

  -- Denied: created_by injection
  BEGIN
    INSERT INTO public.submissions (organization_id, company_name, contact_email, created_by)
    VALUES (v_marq_id, 'Anon Co2', 'anon-sub2@s5validate.test', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    ASSERT false, 'Anonymous must not set created_by';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT ILIKE '%policy%' AND v_err NOT ILIKE '%row-level%' THEN
      RAISE;
    END IF;
  END;

  PERFORM set_config('role', 'postgres', true);

  DELETE FROM public.leads WHERE email LIKE '%@s5validate.test';
  DELETE FROM public.submissions WHERE contact_email LIKE '%@s5validate.test';

  RAISE NOTICE 'diagnostic_anon_policy_review.test.sql: ALL CHECKS PASSED';
END $$;
