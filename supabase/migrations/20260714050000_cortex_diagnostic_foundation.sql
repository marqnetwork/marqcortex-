-- ============================================================================
-- MCV2-S5-IMPLEMENT-002 — Cortex Diagnostic Domain Foundation (Tables)
-- Sprint: Diagnostic relational foundation — additive only
-- KV store remains authoritative; no runtime cutover this sprint
-- Rollback: supabase/migrations/rollbacks/20260714050000_rollback_diagnostic.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Lookup: lead_sources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT lead_sources_key_normalized CHECK (key = lower(trim(key)))
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_sources_org_key_active_uidx
  ON public.lead_sources (organization_id, key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS lead_sources_org_idx
  ON public.lead_sources (organization_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS lead_sources_set_updated_at ON public.lead_sources;
CREATE TRIGGER lead_sources_set_updated_at
  BEFORE UPDATE ON public.lead_sources
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMENT ON TABLE public.lead_sources IS
  'Lead attribution sources per organization. Maps from KV lead capture metadata.';

-- ---------------------------------------------------------------------------
-- contacts (before leads for optional FK)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legacy_kv_key   TEXT,
  full_name       TEXT,
  company_name    TEXT,
  primary_email   TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT contacts_primary_email_normalized CHECK (
    primary_email IS NULL OR primary_email = lower(trim(primary_email))
  )
);

CREATE INDEX IF NOT EXISTS contacts_org_idx
  ON public.contacts (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_email_idx
  ON public.contacts (organization_id, primary_email)
  WHERE deleted_at IS NULL AND primary_email IS NOT NULL;

DROP TRIGGER IF EXISTS contacts_set_updated_at ON public.contacts;
CREATE TRIGGER contacts_set_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

-- ---------------------------------------------------------------------------
-- contact_methods
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_methods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  method_type     TEXT NOT NULL
                  CONSTRAINT contact_methods_type_check
                  CHECK (method_type IN ('email', 'phone', 'website', 'other')),
  value           TEXT NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS contact_methods_contact_idx
  ON public.contact_methods (contact_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contact_methods_primary_uidx
  ON public.contact_methods (contact_id, method_type)
  WHERE deleted_at IS NULL AND is_primary = true;

DROP TRIGGER IF EXISTS contact_methods_set_updated_at ON public.contact_methods;
CREATE TRIGGER contact_methods_set_updated_at
  BEFORE UPDATE ON public.contact_methods
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_source_id  UUID REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  legacy_kv_key   TEXT,
  legacy_id       TEXT,
  email           TEXT NOT NULL,
  full_name       TEXT,
  company_name    TEXT,
  phone           TEXT,
  status          TEXT NOT NULL DEFAULT 'new'
                  CONSTRAINT leads_status_check
                  CHECK (status IN ('new', 'captured', 'exit_intent', 'converted', 'archived')),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT leads_email_normalized CHECK (email = lower(trim(email)))
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_legacy_kv_key_uidx
  ON public.leads (legacy_kv_key)
  WHERE legacy_kv_key IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS leads_org_email_active_uidx
  ON public.leads (organization_id, email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS leads_org_status_idx
  ON public.leads (organization_id, status)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

-- ---------------------------------------------------------------------------
-- lead_tags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag             TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT lead_tags_tag_normalized CHECK (tag = lower(trim(tag)))
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_tags_lead_tag_uidx
  ON public.lead_tags (lead_id, tag);

CREATE INDEX IF NOT EXISTS lead_tags_org_idx
  ON public.lead_tags (organization_id);

-- ---------------------------------------------------------------------------
-- submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  contact_id       UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  legacy_kv_key    TEXT,
  legacy_id        TEXT,
  company_name     TEXT NOT NULL,
  contact_name     TEXT,
  contact_email    TEXT NOT NULL,
  phone            TEXT,
  website          TEXT,
  industry         TEXT,
  industry_id      TEXT,
  status           TEXT NOT NULL DEFAULT 'new'
                   CONSTRAINT submissions_status_check
                   CHECK (status IN (
                     'new', 'under_review', 'report_ready', 'proposal_sent',
                     'won', 'lost', 'archived'
                   )),
  priority         TEXT NOT NULL DEFAULT 'medium'
                   CONSTRAINT submissions_priority_check
                   CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  completion_score INTEGER,
  quality_score    INTEGER,
  ai_score         INTEGER,
  roi_potential    TEXT,
  assigned_to      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT submissions_email_normalized CHECK (contact_email = lower(trim(contact_email))),
  CONSTRAINT submissions_completion_score_range CHECK (
    completion_score IS NULL OR (completion_score >= 0 AND completion_score <= 100)
  ),
  CONSTRAINT submissions_quality_score_range CHECK (
    quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100)
  ),
  CONSTRAINT submissions_ai_score_range CHECK (
    ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS submissions_legacy_kv_key_uidx
  ON public.submissions (legacy_kv_key)
  WHERE legacy_kv_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS submissions_org_status_idx
  ON public.submissions (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS submissions_org_email_idx
  ON public.submissions (organization_id, contact_email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS submissions_submitted_at_idx
  ON public.submissions (organization_id, submitted_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS submissions_set_updated_at ON public.submissions;
CREATE TRIGGER submissions_set_updated_at
  BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

-- ---------------------------------------------------------------------------
-- submission_sections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.submission_sections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id   UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  section_key     TEXT NOT NULL,
  title           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CONSTRAINT submission_sections_status_check
                  CHECK (status IN ('pending', 'in_progress', 'complete', 'skipped')),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT submission_sections_key_normalized CHECK (section_key = lower(trim(section_key)))
);

CREATE UNIQUE INDEX IF NOT EXISTS submission_sections_submission_key_uidx
  ON public.submission_sections (submission_id, section_key);

DROP TRIGGER IF EXISTS submission_sections_set_updated_at ON public.submission_sections;
CREATE TRIGGER submission_sections_set_updated_at
  BEFORE UPDATE ON public.submission_sections
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

-- ---------------------------------------------------------------------------
-- diagnostic_answers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.diagnostic_answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id   UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  section_id      UUID REFERENCES public.submission_sections(id) ON DELETE SET NULL,
  question_key    TEXT NOT NULL,
  answer_text     TEXT,
  answer_json     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT diagnostic_answers_question_normalized CHECK (question_key = lower(trim(question_key)))
);

CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_answers_submission_question_uidx
  ON public.diagnostic_answers (submission_id, question_key);

CREATE INDEX IF NOT EXISTS diagnostic_answers_submission_idx
  ON public.diagnostic_answers (submission_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS diagnostic_answers_set_updated_at ON public.diagnostic_answers;
CREATE TRIGGER diagnostic_answers_set_updated_at
  BEFORE UPDATE ON public.diagnostic_answers
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

-- ---------------------------------------------------------------------------
-- diagnostic_scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.diagnostic_scores (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id    UUID NOT NULL UNIQUE REFERENCES public.submissions(id) ON DELETE CASCADE,
  completion_score INTEGER,
  quality_score    INTEGER,
  ai_score         INTEGER,
  readiness_score  INTEGER,
  scored_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS diagnostic_scores_set_updated_at ON public.diagnostic_scores;
CREATE TRIGGER diagnostic_scores_set_updated_at
  BEFORE UPDATE ON public.diagnostic_scores
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

-- ---------------------------------------------------------------------------
-- domain_scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.domain_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id   UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  domain_key      TEXT NOT NULL,
  score           INTEGER NOT NULL,
  weight          NUMERIC(6, 3),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT domain_scores_domain_normalized CHECK (domain_key = lower(trim(domain_key))),
  CONSTRAINT domain_scores_score_range CHECK (score >= 0 AND score <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS domain_scores_submission_domain_uidx
  ON public.domain_scores (submission_id, domain_key);

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id   UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CONSTRAINT reports_status_check
                  CHECK (status IN ('draft', 'generating', 'ready', 'published', 'archived')),
  title           TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT reports_version_positive CHECK (current_version > 0)
);

CREATE INDEX IF NOT EXISTS reports_submission_idx
  ON public.reports (submission_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS reports_set_updated_at ON public.reports;
CREATE TRIGGER reports_set_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

-- ---------------------------------------------------------------------------
-- report_versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_id       UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  content         JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_published    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT report_versions_number_positive CHECK (version_number > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS report_versions_report_version_uidx
  ON public.report_versions (report_id, version_number);

-- ---------------------------------------------------------------------------
-- outcomes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id   UUID NOT NULL UNIQUE REFERENCES public.submissions(id) ON DELETE CASCADE,
  legacy_kv_key   TEXT,
  outcome_type    TEXT NOT NULL DEFAULT 'engagement'
                  CONSTRAINT outcomes_type_check
                  CHECK (outcome_type IN ('engagement', 'won', 'lost', 'nurture', 'other')),
  status          TEXT NOT NULL DEFAULT 'open'
                  CONSTRAINT outcomes_status_check
                  CHECK (status IN ('open', 'closed', 'archived')),
  value           JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS outcomes_legacy_kv_key_uidx
  ON public.outcomes (legacy_kv_key)
  WHERE legacy_kv_key IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS outcomes_set_updated_at ON public.outcomes;
CREATE TRIGGER outcomes_set_updated_at
  BEFORE UPDATE ON public.outcomes
  FOR EACH ROW EXECUTE FUNCTION cortex.set_updated_at();

COMMIT;
