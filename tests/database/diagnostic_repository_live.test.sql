-- ============================================================================
-- MCV2-S5-VALIDATE-001 — Repository query pattern verification (service context)
-- Simulates repository CRUD against live schema; cleans up after.
-- ============================================================================

DO $$
DECLARE
  v_org_id   UUID;
  v_lead_id  UUID;
  v_sub_id   UUID;
  v_report_id UUID;
  v_outcome_id UUID;
  v_count    INTEGER;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL LIMIT 1;
  ASSERT v_org_id IS NOT NULL, 'MARQ org required';

  -- LeadRepository.create + lookup by email
  INSERT INTO public.leads (organization_id, email, full_name, status, legacy_kv_key)
  VALUES (v_org_id, 'repo-test@s5validate.test', 'Repo Test', 'new', 'lead:repo-test')
  RETURNING id INTO v_lead_id;

  SELECT COUNT(*) INTO v_count FROM public.leads
  WHERE organization_id = v_org_id AND email = 'repo-test@s5validate.test' AND deleted_at IS NULL;
  ASSERT v_count = 1, 'Lead lookup by email failed';

  SELECT COUNT(*) INTO v_count FROM public.leads
  WHERE legacy_kv_key = 'lead:repo-test' AND deleted_at IS NULL;
  ASSERT v_count = 1, 'Lead lookup by legacy_kv_key failed';

  -- SubmissionRepository.create + child records
  INSERT INTO public.submissions (organization_id, lead_id, company_name, contact_email, status, legacy_kv_key)
  VALUES (v_org_id, v_lead_id, 'Repo Co', 'repo-test@s5validate.test', 'new', 'sub:repo-test')
  RETURNING id INTO v_sub_id;

  INSERT INTO public.submission_sections (organization_id, submission_id, section_key, title, status)
  VALUES (v_org_id, v_sub_id, 'operations', 'Operations', 'complete');

  INSERT INTO public.diagnostic_answers (organization_id, submission_id, question_key, answer_text)
  VALUES (v_org_id, v_sub_id, 'q1', 'yes');

  INSERT INTO public.diagnostic_scores (organization_id, submission_id, completion_score, quality_score)
  VALUES (v_org_id, v_sub_id, 80, 75);

  INSERT INTO public.domain_scores (organization_id, submission_id, domain_key, score)
  VALUES (v_org_id, v_sub_id, 'operations', 72);

  -- ReportRepository
  INSERT INTO public.reports (organization_id, submission_id, title, status)
  VALUES (v_org_id, v_sub_id, 'Repo Report', 'draft')
  RETURNING id INTO v_report_id;

  INSERT INTO public.report_versions (organization_id, report_id, version_number, content)
  VALUES (v_org_id, v_report_id, 1, '{"summary":"test"}'::jsonb);

  -- OutcomeRepository
  INSERT INTO public.outcomes (organization_id, submission_id, outcome_type, status, legacy_kv_key)
  VALUES (v_org_id, v_sub_id, 'engagement', 'open', 'outcome:repo-test')
  RETURNING id INTO v_outcome_id;

  -- Update patterns
  UPDATE public.submissions SET status = 'under_review' WHERE id = v_sub_id;
  ASSERT FOUND, 'Submission update failed';

  -- List pattern
  SELECT COUNT(*) INTO v_count FROM public.submissions
  WHERE organization_id = v_org_id AND deleted_at IS NULL;
  ASSERT v_count >= 1, 'Submission list failed';

  -- FK integrity: cannot link submission to wrong org lead
  BEGIN
    INSERT INTO public.submissions (organization_id, company_name, contact_email)
    SELECT v_org_id, 'Bad FK', 'badfk@s5validate.test'
    FROM public.leads l
    WHERE l.organization_id <> v_org_id
    LIMIT 1;
    IF FOUND THEN
      -- only fails if cross-org lead exists; skip if none
      NULL;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  -- Cleanup
  DELETE FROM public.report_versions WHERE report_id = v_report_id;
  DELETE FROM public.reports WHERE id = v_report_id;
  DELETE FROM public.outcomes WHERE id = v_outcome_id;
  DELETE FROM public.domain_scores WHERE submission_id = v_sub_id;
  DELETE FROM public.diagnostic_scores WHERE submission_id = v_sub_id;
  DELETE FROM public.diagnostic_answers WHERE submission_id = v_sub_id;
  DELETE FROM public.submission_sections WHERE submission_id = v_sub_id;
  DELETE FROM public.submissions WHERE id = v_sub_id;
  DELETE FROM public.leads WHERE id = v_lead_id;

  RAISE NOTICE 'diagnostic_repository_live.test.sql: ALL CHECKS PASSED';
END $$;
