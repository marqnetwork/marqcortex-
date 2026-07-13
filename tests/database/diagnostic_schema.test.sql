-- ============================================================================
-- MCV2-S5 — Diagnostic schema validation tests
-- Run after diagnostic migrations. Expects all checks to pass.
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (
      'lead_sources', 'leads', 'lead_tags', 'contacts', 'contact_methods',
      'submissions', 'submission_sections', 'diagnostic_answers',
      'diagnostic_scores', 'domain_scores', 'reports', 'report_versions', 'outcomes'
    )) = 13, 'Expected 13 diagnostic domain tables';

  -- organization_id on tenant tables
  ASSERT (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submissions'
      AND column_name = 'organization_id' AND is_nullable = 'NO') = 1,
    'submissions.organization_id must be NOT NULL';

  -- FK submissions -> organizations
  ASSERT (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'submissions'
      AND constraint_type = 'FOREIGN KEY') >= 3,
    'submissions FK count too low';

  -- legacy_kv_key on submissions
  ASSERT (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submissions'
      AND column_name = 'legacy_kv_key') = 1,
    'submissions.legacy_kv_key missing';

  -- RLS enabled
  ASSERT (SELECT COUNT(*) FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'submissions' AND rowsecurity = true) = 1,
    'RLS not enabled on submissions';

  ASSERT (SELECT COUNT(*) FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'leads' AND rowsecurity = true) = 1,
    'RLS not enabled on leads';

  -- Diagnostic helper functions
  ASSERT (SELECT COUNT(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cortex' AND p.proname = 'can_read_diagnostic') = 1,
    'cortex.can_read_diagnostic missing';

  -- Diagnostic permissions seeded
  SELECT COUNT(*) INTO v_count FROM public.permissions
  WHERE key IN ('diagnostic.read', 'diagnostic.write', 'diagnostic.manage');
  ASSERT v_count = 3, 'Expected 3 diagnostic permissions';

  -- Lead sources seed for MARQ
  SELECT COUNT(*) INTO v_count
  FROM public.lead_sources ls
  JOIN public.organizations o ON o.id = ls.organization_id
  WHERE o.slug = 'marq' AND ls.deleted_at IS NULL;
  ASSERT v_count >= 3, 'Expected at least 3 MARQ lead_sources';

  RAISE NOTICE 'diagnostic_schema.test.sql: ALL CHECKS PASSED';
END $$;
