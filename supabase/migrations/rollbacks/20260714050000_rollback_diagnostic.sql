-- ============================================================================
-- Rollback: MCV2-S5-IMPLEMENT-002 Diagnostic Domain
-- Drops diagnostic tables and helper functions. KV store unaffected.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'report_versions', 'reports', 'outcomes', 'domain_scores', 'diagnostic_scores',
    'diagnostic_answers', 'submission_sections', 'submissions', 'lead_tags', 'leads',
    'contact_methods', 'contacts', 'lead_sources'
  ]
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t);
  END LOOP;
END $$;

DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id
  AND p.key IN ('diagnostic.read', 'diagnostic.write', 'diagnostic.manage');

DELETE FROM public.permissions
WHERE key IN ('diagnostic.read', 'diagnostic.write', 'diagnostic.manage');

DROP FUNCTION IF EXISTS cortex.can_manage_diagnostic(UUID);
DROP FUNCTION IF EXISTS cortex.can_write_diagnostic(UUID);
DROP FUNCTION IF EXISTS cortex.can_read_diagnostic(UUID);
DROP FUNCTION IF EXISTS cortex.marq_organization_id();

COMMIT;
