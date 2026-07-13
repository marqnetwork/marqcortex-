-- ============================================================================
-- MCV2-S5-VALIDATE-001 — Harden anonymous public-funnel INSERT policies
-- Additive fix: restrict status/scores/identity fields on anon INSERT only
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS leads_insert_anon ON public.leads;
CREATE POLICY leads_insert_anon ON public.leads
  FOR INSERT TO anon
  WITH CHECK (
    organization_id = cortex.marq_organization_id()
    AND status IN ('new', 'captured', 'exit_intent')
    AND created_by IS NULL
    AND updated_by IS NULL
  );

DROP POLICY IF EXISTS submissions_insert_anon ON public.submissions;
CREATE POLICY submissions_insert_anon ON public.submissions
  FOR INSERT TO anon
  WITH CHECK (
    organization_id = cortex.marq_organization_id()
    AND status = 'new'
    AND priority IN ('low', 'medium')
    AND completion_score IS NULL
    AND quality_score IS NULL
    AND ai_score IS NULL
    AND assigned_to IS NULL
    AND created_by IS NULL
    AND updated_by IS NULL
  );

COMMIT;
