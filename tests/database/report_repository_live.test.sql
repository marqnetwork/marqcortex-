-- ============================================================================
-- MQC-SVC-015 — Report repository query patterns, against the live schema.
--
-- The Deno suite (supabase/functions/server/repositories/__tests__/) proves
-- WHICH query `createReportRepository` issues. This proves that query is legal
-- and means what it is supposed to mean against a real PostgreSQL: the columns
-- exist, the constraints bite, and the organization filter actually isolates.
--
-- The asymmetry between the two tables is the thing most worth pinning:
--   `reports`          soft-deleted, so reads filter `deleted_at`.
--   `report_versions`  append-only, with NO `deleted_at` — a read that filtered
--                      it would type-check, pass the unit suite against a naive
--                      fake, and fail here.
--
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/database/report_repository_live.test.sql
-- Cleans up after itself.
-- ============================================================================

DO $$
DECLARE
  v_org_id     UUID;
  v_other_org  UUID;
  v_lead_id    UUID;
  v_sub_id     UUID;
  v_report_id  UUID;
  v_second_id  UUID;
  v_found_id   UUID;
  v_count      INTEGER;
  v_versions   INTEGER[];
BEGIN
  SELECT id INTO v_org_id FROM public.organizations WHERE slug = 'marq' AND deleted_at IS NULL LIMIT 1;
  ASSERT v_org_id IS NOT NULL, 'MARQ org required';

  -- A second tenant, so "organization-scoped" can be demonstrated rather than asserted.
  INSERT INTO public.organizations (slug, name)
  VALUES ('mqc-svc-015-other', 'Report Repository Isolation Fixture')
  RETURNING id INTO v_other_org;

  INSERT INTO public.leads (organization_id, email, status)
  VALUES (v_org_id, 'report-repo@mqc-svc-015.test', 'new')
  RETURNING id INTO v_lead_id;

  INSERT INTO public.submissions (organization_id, lead_id, company_name, contact_email)
  VALUES (v_org_id, v_lead_id, 'Report Repo Co', 'report-repo@mqc-svc-015.test')
  RETURNING id INTO v_sub_id;

  -- --------------------------------------------------------------------------
  -- createReport: the defaults the repository relies on are the schema's
  -- --------------------------------------------------------------------------
  INSERT INTO public.reports (organization_id, submission_id)
  VALUES (v_org_id, v_sub_id)
  RETURNING id INTO v_report_id;

  SELECT COUNT(*) INTO v_count FROM public.reports
  WHERE id = v_report_id AND status = 'draft' AND current_version = 1
    AND metadata = '{}'::jsonb AND deleted_at IS NULL;
  ASSERT v_count = 1, 'createReport defaults (draft / version 1 / empty metadata) are not the schema defaults';

  -- --------------------------------------------------------------------------
  -- getReportById / listReports: the organization filter isolates
  -- --------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count FROM public.reports
  WHERE id = v_report_id AND organization_id = v_other_org AND deleted_at IS NULL;
  ASSERT v_count = 0, 'a report is readable from another organization';

  -- --------------------------------------------------------------------------
  -- getReportBySubmission: a submission may carry MORE THAN ONE report, which
  -- is why the repository orders and limits instead of expecting one row.
  -- --------------------------------------------------------------------------
  INSERT INTO public.reports (organization_id, submission_id, created_at)
  VALUES (v_org_id, v_sub_id, now() + interval '1 second')
  RETURNING id INTO v_second_id;

  SELECT COUNT(*) INTO v_count FROM public.reports
  WHERE submission_id = v_sub_id AND deleted_at IS NULL;
  ASSERT v_count = 2, 'reports_submission_idx is not unique; two reports per submission must be possible';

  SELECT id INTO v_found_id FROM public.reports
  WHERE submission_id = v_sub_id AND organization_id = v_org_id AND deleted_at IS NULL
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  ASSERT v_found_id = v_second_id, 'getReportBySubmission must resolve to the most recent report';

  -- The soft-deleted one disappears from that same query.
  UPDATE public.reports SET deleted_at = now() WHERE id = v_second_id;
  SELECT id INTO v_found_id FROM public.reports
  WHERE submission_id = v_sub_id AND organization_id = v_org_id AND deleted_at IS NULL
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  ASSERT v_found_id = v_report_id, 'the deleted_at filter does not exclude a soft-deleted report';

  -- --------------------------------------------------------------------------
  -- report_versions: append-only, and the uniqueness the history depends on
  -- --------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'report_versions'
    AND column_name IN ('deleted_at', 'updated_at', 'updated_by');
  ASSERT v_count = 0,
    'report_versions gained an audit/soft-delete column — reportRepository.ts must be revisited';

  INSERT INTO public.report_versions (organization_id, report_id, version_number, content)
  VALUES (v_org_id, v_report_id, 1, '{"summary":"first"}'::jsonb);
  INSERT INTO public.report_versions (organization_id, report_id, version_number, content)
  VALUES (v_org_id, v_report_id, 2, '{"summary":"second"}'::jsonb);

  -- A repeated version number is refused, so a history cannot fork.
  BEGIN
    INSERT INTO public.report_versions (organization_id, report_id, version_number, content)
    VALUES (v_org_id, v_report_id, 2, '{"summary":"duplicate"}'::jsonb);
    ASSERT FALSE, 'report_versions accepted a duplicate (report_id, version_number)';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- version_number > 0 is enforced, not merely documented.
  BEGIN
    INSERT INTO public.report_versions (organization_id, report_id, version_number, content)
    VALUES (v_org_id, v_report_id, 0, '{}'::jsonb);
    ASSERT FALSE, 'report_versions accepted version_number 0';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- listReportVersions: oldest first, organization-scoped.
  SELECT array_agg(version_number ORDER BY version_number ASC) INTO v_versions
  FROM public.report_versions
  WHERE report_id = v_report_id AND organization_id = v_org_id;
  ASSERT v_versions = ARRAY[1, 2], 'listReportVersions does not read the history forward';

  SELECT COUNT(*) INTO v_count FROM public.report_versions
  WHERE report_id = v_report_id AND organization_id = v_other_org;
  ASSERT v_count = 0, 'report versions are readable from another organization';

  -- --------------------------------------------------------------------------
  -- createReportVersion's parent check: the FK alone does NOT enforce tenancy.
  -- The repository reads the parent in the caller's organization first, and
  -- this is the gap that read exists to close.
  -- --------------------------------------------------------------------------
  INSERT INTO public.report_versions (organization_id, report_id, version_number, content)
  VALUES (v_other_org, v_report_id, 99, '{"summary":"cross-tenant"}'::jsonb);
  SELECT COUNT(*) INTO v_count FROM public.report_versions
  WHERE report_id = v_report_id AND version_number = 99;
  ASSERT v_count = 1,
    'the database refused a cross-tenant version — the repository guard would be redundant, revisit it';
  DELETE FROM public.report_versions WHERE report_id = v_report_id AND version_number = 99;

  -- --------------------------------------------------------------------------
  -- updateReport: current_version stays positive
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE public.reports SET current_version = 0 WHERE id = v_report_id;
    ASSERT FALSE, 'reports accepted current_version 0';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE public.reports SET status = 'published', current_version = 2 WHERE id = v_report_id;
  ASSERT FOUND, 'updateReport pattern failed';

  -- Cleanup
  DELETE FROM public.report_versions WHERE report_id IN (v_report_id, v_second_id);
  DELETE FROM public.reports WHERE submission_id = v_sub_id;
  DELETE FROM public.submissions WHERE id = v_sub_id;
  DELETE FROM public.leads WHERE id = v_lead_id;
  DELETE FROM public.organizations WHERE id = v_other_org;

  RAISE NOTICE 'report_repository_live.test.sql: ALL CHECKS PASSED';
END $$;
