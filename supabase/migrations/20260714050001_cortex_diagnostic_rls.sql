-- ============================================================================
-- MCV2-S5-IMPLEMENT-002 — Diagnostic Domain RLS and Permission Seed
-- Depends on: 20260714050000_cortex_diagnostic_foundation.sql
-- Rollback: supabase/migrations/rollbacks/20260714050000_rollback_diagnostic.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers for public funnel + client-scoped access (foundation only)
-- Client portal still uses KV sessions; SQL policies prepare for cutover.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cortex.marq_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT o.id
  FROM public.organizations o
  WHERE o.slug = 'marq'
    AND o.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION cortex.can_read_diagnostic( target_organization_id UUID )
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT CASE
    WHEN target_organization_id IS NULL THEN false
    WHEN cortex.is_platform_admin() THEN true
    WHEN cortex.has_permission(target_organization_id, 'diagnostic.read') THEN true
    WHEN cortex.is_organization_member(target_organization_id) THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION cortex.can_write_diagnostic( target_organization_id UUID )
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT CASE
    WHEN target_organization_id IS NULL THEN false
    WHEN cortex.is_platform_admin() THEN true
    WHEN cortex.has_permission(target_organization_id, 'diagnostic.write') THEN true
    WHEN cortex.is_organization_admin(target_organization_id) THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION cortex.can_manage_diagnostic( target_organization_id UUID )
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cortex
AS $$
  SELECT CASE
    WHEN target_organization_id IS NULL THEN false
    WHEN cortex.is_platform_admin() THEN true
    WHEN cortex.has_permission(target_organization_id, 'diagnostic.manage') THEN true
    WHEN cortex.is_organization_admin(target_organization_id) THEN true
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION cortex.marq_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.can_read_diagnostic(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.can_write_diagnostic(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION cortex.can_manage_diagnostic(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cortex.marq_organization_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION cortex.can_read_diagnostic(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cortex.can_write_diagnostic(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cortex.can_manage_diagnostic(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Diagnostic permissions (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, name, description)
SELECT v.key, v.name, v.description
FROM (VALUES
  ('diagnostic.read', 'Read diagnostic data', 'View leads, submissions, reports within organization'),
  ('diagnostic.write', 'Write diagnostic data', 'Create and update diagnostic records'),
  ('diagnostic.manage', 'Manage diagnostic data', 'Administer diagnostic configuration and deletes')
) AS v(key, name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.permissions p WHERE p.key = v.key
);

-- Map diagnostic permissions to org roles
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.is_system = true
  AND r.key IN ('org_admin', 'team_member')
  AND p.key IN ('diagnostic.read', 'diagnostic.write')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.is_system = true
  AND r.key = 'org_admin'
  AND p.key = 'diagnostic.manage'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.is_system = true
  AND r.key = 'team_viewer'
  AND p.key = 'diagnostic.read'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Default lead sources for MARQ org
DO $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT cortex.marq_organization_id() INTO v_org_id;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'MARQ organization not found — skipping lead_sources seed';
    RETURN;
  END IF;

  INSERT INTO public.lead_sources (organization_id, key, name, description)
  SELECT v_org_id, v.key, v.name, v.description
  FROM (VALUES
    ('lead_magnet', 'Lead Magnet', 'Primary lead magnet capture form'),
    ('exit_intent', 'Exit Intent', 'Exit-intent popup capture'),
    ('diagnostic', 'Diagnostic Funnel', 'Direct diagnostic submission funnel')
  ) AS v(key, name, description)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lead_sources ls
    WHERE ls.organization_id = v_org_id AND ls.key = v.key AND ls.deleted_at IS NULL
  );
END $$;

-- ---------------------------------------------------------------------------
-- Enable + force RLS on diagnostic tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lead_sources', 'leads', 'lead_tags', 'contacts', 'contact_methods',
    'submissions', 'submission_sections', 'diagnostic_answers',
    'diagnostic_scores', 'domain_scores', 'reports', 'report_versions', 'outcomes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Macro: tenant read policy template applied per table below

-- lead_sources
DROP POLICY IF EXISTS lead_sources_select ON public.lead_sources;
CREATE POLICY lead_sources_select ON public.lead_sources
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS lead_sources_modify ON public.lead_sources;
CREATE POLICY lead_sources_modify ON public.lead_sources
  FOR ALL TO authenticated
  USING (cortex.can_manage_diagnostic(organization_id))
  WITH CHECK (cortex.can_manage_diagnostic(organization_id));

-- leads
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS leads_insert_member ON public.leads;
CREATE POLICY leads_insert_member ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS leads_insert_anon ON public.leads;
CREATE POLICY leads_insert_anon ON public.leads
  FOR INSERT TO anon
  WITH CHECK (organization_id = cortex.marq_organization_id());

DROP POLICY IF EXISTS leads_update ON public.leads;
CREATE POLICY leads_update ON public.leads
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS leads_delete ON public.leads;
CREATE POLICY leads_delete ON public.leads
  FOR DELETE TO authenticated
  USING (cortex.can_manage_diagnostic(organization_id));

-- lead_tags
DROP POLICY IF EXISTS lead_tags_select ON public.lead_tags;
CREATE POLICY lead_tags_select ON public.lead_tags
  FOR SELECT TO authenticated
  USING (cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS lead_tags_write ON public.lead_tags;
CREATE POLICY lead_tags_write ON public.lead_tags
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

-- contacts
DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS contacts_write ON public.contacts;
CREATE POLICY contacts_write ON public.contacts
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

-- contact_methods
DROP POLICY IF EXISTS contact_methods_select ON public.contact_methods;
CREATE POLICY contact_methods_select ON public.contact_methods
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS contact_methods_write ON public.contact_methods;
CREATE POLICY contact_methods_write ON public.contact_methods
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

-- submissions
DROP POLICY IF EXISTS submissions_select ON public.submissions;
CREATE POLICY submissions_select ON public.submissions
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS submissions_insert_member ON public.submissions;
CREATE POLICY submissions_insert_member ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS submissions_insert_anon ON public.submissions;
CREATE POLICY submissions_insert_anon ON public.submissions
  FOR INSERT TO anon
  WITH CHECK (organization_id = cortex.marq_organization_id());

DROP POLICY IF EXISTS submissions_update ON public.submissions;
CREATE POLICY submissions_update ON public.submissions
  FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS submissions_delete ON public.submissions;
CREATE POLICY submissions_delete ON public.submissions
  FOR DELETE TO authenticated
  USING (cortex.can_manage_diagnostic(organization_id));

-- Child tables inherit org scope via submission/org membership checks
DROP POLICY IF EXISTS submission_sections_select ON public.submission_sections;
CREATE POLICY submission_sections_select ON public.submission_sections
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS submission_sections_write ON public.submission_sections;
CREATE POLICY submission_sections_write ON public.submission_sections
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS diagnostic_answers_select ON public.diagnostic_answers;
CREATE POLICY diagnostic_answers_select ON public.diagnostic_answers
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS diagnostic_answers_write ON public.diagnostic_answers;
CREATE POLICY diagnostic_answers_write ON public.diagnostic_answers
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS diagnostic_scores_select ON public.diagnostic_scores;
CREATE POLICY diagnostic_scores_select ON public.diagnostic_scores
  FOR SELECT TO authenticated
  USING (cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS diagnostic_scores_write ON public.diagnostic_scores;
CREATE POLICY diagnostic_scores_write ON public.diagnostic_scores
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS domain_scores_select ON public.domain_scores;
CREATE POLICY domain_scores_select ON public.domain_scores
  FOR SELECT TO authenticated
  USING (cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS domain_scores_write ON public.domain_scores;
CREATE POLICY domain_scores_write ON public.domain_scores
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS reports_select ON public.reports;
CREATE POLICY reports_select ON public.reports
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS reports_write ON public.reports;
CREATE POLICY reports_write ON public.reports
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS report_versions_select ON public.report_versions;
CREATE POLICY report_versions_select ON public.report_versions
  FOR SELECT TO authenticated
  USING (cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS report_versions_write ON public.report_versions;
CREATE POLICY report_versions_write ON public.report_versions
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

DROP POLICY IF EXISTS outcomes_select ON public.outcomes;
CREATE POLICY outcomes_select ON public.outcomes
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND cortex.can_read_diagnostic(organization_id));

DROP POLICY IF EXISTS outcomes_write ON public.outcomes;
CREATE POLICY outcomes_write ON public.outcomes
  FOR ALL TO authenticated
  USING (cortex.can_write_diagnostic(organization_id))
  WITH CHECK (cortex.can_write_diagnostic(organization_id));

COMMIT;
