-- ============================================================================
-- MCV2-S5 — Diagnostic RLS policy presence tests (static SQL review)
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'submissions';
  ASSERT v_count >= 4, 'Expected at least 4 policies on submissions';

  SELECT COUNT(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'leads'
    AND policyname = 'leads_insert_anon';
  ASSERT v_count = 1, 'Anonymous lead insert policy missing';

  SELECT COUNT(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'submissions'
    AND policyname = 'submissions_insert_anon';
  ASSERT v_count = 1, 'Anonymous submission insert policy missing';

  RAISE NOTICE 'diagnostic_rls.test.sql: ALL CHECKS PASSED';
END $$;
